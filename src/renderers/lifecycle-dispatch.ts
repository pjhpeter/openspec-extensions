import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  issueReviewArtifactIsCurrent,
  issueReviewArtifactPath,
  issueReviewStatus,
  issueTeamDispatchPath,
  nowIso,
  planningDocStatus,
  phaseGateArtifactIsCurrent,
  phaseGateArtifactPath,
  phaseGateStatus,
  readJson,
  reviewArtifactIsCurrent,
  reviewArtifactPath,
  verificationArtifactIsCurrent,
  verifyArtifactPath,
  type PhaseGate,
  type JsonRecord
} from "../domain/change-coordinator";
import {
  automationProfile,
  loadIssueModeConfig,
  parseFrontmatter,
  readChangeControlState,
  type IssueModeConfig
} from "../domain/issue-mode";
import { renderIssueTeamDispatch, type IssueTeamDispatchPayload } from "./issue-team-dispatch";
import { displayPath } from "../utils/path";

const PHASES = new Set([
  "auto",
  "spec_readiness",
  "issue_planning",
  "issue_execution",
  "change_acceptance",
  "change_verify",
  "ready_for_archive"
]);

type ParsedArgs = {
  change: string;
  dryRun: boolean;
  issueId: string;
  phase: string;
  repoRoot: string;
};

type IssuePayload = JsonRecord & {
  boundary_status?: string;
  issue_id?: string;
  issue_path?: string;
  next_action?: string;
  progress_path?: string;
  status?: string;
  title?: string;
  updated_at?: string;
};

export type LifecycleDispatchPayload = {
  automation: {
    accept_change_acceptance: boolean;
    accept_issue_planning: boolean;
    accept_issue_review: boolean;
    accept_spec_readiness: boolean;
    archive_after_verify: boolean;
  };
  automation_profile: string;
  change: string;
  control_state: JsonRecord;
  dry_run: boolean;
  focus_issue_id: string;
  generated_at: string;
  issue_count: number;
  issue_team_dispatch: IssueTeamDispatchPayload | Record<string, never>;
  issue_team_dispatch_path: string;
  issue_team_seat_handoffs_path: string;
  latest_round_path: string;
  lifecycle_dispatch_path: string;
  phase: string;
  phase_reason: string;
  team_topology: TeamTopologyItem[];
};

type TeamTopologyItem = {
  count: number;
  key: string;
  label: string;
  reasoning_effort: string;
  reasoning_note: string;
  responsibility: string;
};

function parseCommandArgs(argv: string[]): ParsedArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      change: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "issue-id": { type: "string", default: "" },
      phase: { type: "string", default: "auto" },
      "repo-root": { type: "string" }
    },
    strict: true
  });

  if (!values["repo-root"] || !values.change) {
    throw new Error("Missing required options: --repo-root, --change");
  }
  if (!PHASES.has(values.phase)) {
    throw new Error(`Invalid phase: ${values.phase}`);
  }

  return {
    change: values.change,
    dryRun: values["dry-run"],
    issueId: values["issue-id"],
    phase: values.phase,
    repoRoot: path.resolve(values["repo-root"])
  };
}

function latestRoundArtifactPath(repoRoot: string, change: string): string {
  const controlDir = path.join(repoRoot, "openspec", "changes", change, "control");
  if (!fs.existsSync(controlDir)) {
    return "";
  }
  const matches = fs.readdirSync(controlDir).filter((name) => /^ROUND-.*\.md$/.test(name)).sort();
  if (matches.length === 0) {
    return "";
  }
  return path.join(controlDir, matches[matches.length - 1] as string);
}

function issueIdFromDoc(filePath: string): string {
  return path.basename(filePath, ".md");
}

function issueIdFromProgress(filePath: string): string {
  return path.basename(filePath, ".progress.json");
}

function collectIssues(repoRoot: string, change: string): IssuePayload[] {
  const issuesDir = path.join(repoRoot, "openspec", "changes", change, "issues");
  if (!fs.existsSync(issuesDir)) {
    return [];
  }

  const progressByIssue = new Map<string, string>();
  for (const name of fs.readdirSync(issuesDir).filter((current) => current.endsWith(".progress.json")).sort()) {
    progressByIssue.set(issueIdFromProgress(name), path.join(issuesDir, name));
  }

  const issueDocs = fs.readdirSync(issuesDir)
    .filter((name) => /^ISSUE-.*\.md$/.test(name))
    .filter((name) => !name.endsWith(".dispatch.md") && !name.endsWith(".team.dispatch.md"))
    .sort();

  const issues: IssuePayload[] = [];
  const seenIds = new Set<string>();

  for (const name of issueDocs) {
    const issuePath = path.join(issuesDir, name);
    const issueId = issueIdFromDoc(issuePath);
    const frontmatter = fs.existsSync(issuePath) ? parseFrontmatter(fs.readFileSync(issuePath, "utf8")) : {};
    const payload: IssuePayload = {
      issue_id: issueId,
      title: String(frontmatter.title ?? "").trim(),
      status: "pending",
      boundary_status: "",
      next_action: "",
      progress_path: "",
      issue_path: displayPath(repoRoot, issuePath)
    };

    const progressPath = progressByIssue.get(issueId);
    if (progressPath) {
      Object.assign(payload, readJson(progressPath));
      payload.progress_path = displayPath(repoRoot, progressPath);
    }

    issues.push(payload);
    seenIds.add(issueId);
  }

  for (const [issueId, progressPath] of progressByIssue.entries()) {
    if (seenIds.has(issueId)) {
      continue;
    }
    const payload = readJson(progressPath) as IssuePayload;
    payload.issue_id = String(payload.issue_id ?? issueId);
    payload.status = String(payload.status ?? "pending");
    payload.boundary_status = String(payload.boundary_status ?? "");
    payload.next_action = String(payload.next_action ?? "");
    payload.title = "";
    payload.progress_path = displayPath(repoRoot, progressPath);
    payload.issue_path = "";
    issues.push(payload);
  }

  return issues;
}

function currentVerifyState(repoRoot: string, change: string, issues: IssuePayload[]): JsonRecord {
  const artifact = readJson(verifyArtifactPath(repoRoot, change));
  const current = Object.keys(artifact).length > 0 && verificationArtifactIsCurrent(repoRoot, issues, artifact);
  const status = String(artifact.status ?? "").trim();
  return {
    artifact,
    current,
    status,
    passed: current && status === "passed",
    failed: current && status === "failed"
  };
}

function currentReviewState(repoRoot: string, change: string, issues: IssuePayload[]): JsonRecord {
  const artifact = readJson(reviewArtifactPath(repoRoot, change));
  const current = Object.keys(artifact).length > 0 && reviewArtifactIsCurrent(repoRoot, issues, artifact);
  const status = String(artifact.status ?? "").trim();
  return {
    artifact,
    current,
    status,
    passed: current && status === "passed",
    failed: current && status === "failed"
  };
}

function currentPhaseGateState(repoRoot: string, change: string, phase: PhaseGate): JsonRecord {
  const artifact = readJson(phaseGateArtifactPath(repoRoot, change, phase));
  const status = phaseGateStatus(artifact);
  const current = Object.keys(artifact).length > 0 && phaseGateArtifactIsCurrent(repoRoot, change, phase, artifact);
  return {
    artifact,
    current,
    path: displayPath(repoRoot, phaseGateArtifactPath(repoRoot, change, phase)),
    status: status.status,
    passed: current && status.passed,
    failed: current && status.failed
  };
}

function currentIssueReviewGateState(repoRoot: string, change: string, issue: IssuePayload): JsonRecord {
  const issueId = String(issue.issue_id ?? "").trim();
  if (!issueId || !fs.existsSync(issueTeamDispatchPath(repoRoot, change, issueId))) {
    return {
      artifact: {},
      current: true,
      failed: false,
      passed: true,
      path: "",
      required: false,
      status: "not_required"
    };
  }

  const artifact = readJson(issueReviewArtifactPath(repoRoot, change, issueId));
  const status = issueReviewStatus(artifact);
  const current = Object.keys(artifact).length > 0 && issueReviewArtifactIsCurrent(issue, artifact);
  return {
    artifact,
    current,
    failed: current && status.failed,
    passed: current && status.passed,
    path: displayPath(repoRoot, issueReviewArtifactPath(repoRoot, change, issueId)),
    required: true,
    status: status.status
  };
}

function focusIssueId(issues: IssuePayload[]): string {
  const predicates = [
    (issue: IssuePayload) => issue.status === "blocked",
    (issue: IssuePayload) => issue.boundary_status === "review_required" || issue.next_action === "coordinator_review",
    (issue: IssuePayload) => issue.status === "in_progress",
    (issue: IssuePayload) => issue.status === "pending" || issue.status === ""
  ];

  for (const predicate of predicates) {
    const found = issues.find(predicate);
    if (found?.issue_id) {
      return String(found.issue_id).trim();
    }
  }
  return "";
}

function determinePhase(
  repoRoot: string,
  change: string,
  issues: IssuePayload[],
  explicitIssueId: string,
  controlState: JsonRecord,
  config: IssueModeConfig
): [string, string, string] {
  const changeDir = path.join(repoRoot, "openspec", "changes", change);
  const proposalPath = path.join(changeDir, "proposal.md");
  const designPath = path.join(changeDir, "design.md");
  const tasksPath = path.join(changeDir, "tasks.md");
  const issuesIndexPath = path.join(changeDir, "issues", "INDEX.md");
  const issueDocs = issues.filter((issue) => issue.issue_path);

  const missingCore = [proposalPath, designPath]
    .filter((currentPath) => !fs.existsSync(currentPath))
    .map((currentPath) => path.basename(currentPath));
  if (missingCore.length > 0) {
    return ["spec_readiness", "", `变更基础文档未齐全：${missingCore.join(", ")}。`];
  }
  // 后续 planning / issue 文档即使已经存在，也不能跳过前置文档门禁。
  const specReadinessGate = currentPhaseGateState(repoRoot, change, "spec_readiness");
  if (specReadinessGate.failed === true) {
    return ["spec_readiness", "", `最近一次 spec_readiness gate 未通过；需先修订 proposal / design，并重新收敛 design author + review verdict，再更新 \`${specReadinessGate.path}\`。`];
  }
  if (specReadinessGate.passed !== true) {
    const hasLaterPlanningArtifacts = fs.existsSync(tasksPath) || fs.existsSync(issuesIndexPath) || issueDocs.length > 0;
    if (Object.keys(specReadinessGate.artifact as JsonRecord).length > 0 && specReadinessGate.current !== true) {
      return [
        "spec_readiness",
        "",
        `proposal / design 在最近一次 spec_readiness gate 后发生了变化；必须先重新完成 design review，并刷新 \`${specReadinessGate.path}\`，之后才能进入 issue planning。`
      ];
    }
    return [
      "spec_readiness",
      "",
      hasLaterPlanningArtifacts
        ? `设计文档已齐全，但 spec_readiness gate 还没有记录通过；即使 tasks / issue 文档已经存在，也必须先完成 1 个设计作者 + 2 个设计评审的门禁，并写入 \`${specReadinessGate.path}\`。`
        : `设计文档已齐全，但必须先经过 1 个设计作者和 2 个设计评审组成的 subagent team；评审通过并写入 \`${specReadinessGate.path}\` 后，才能进行任务拆分。`
    ];
  }

  if (!fs.existsSync(issuesIndexPath) || issueDocs.length === 0) {
    return [
      "issue_planning",
      "",
      "任务拆分 / issue 规划工件未完成，需先产出或修订 tasks.md、INDEX 和 ISSUE 文档。"
    ];
  }

  // 首个 issue execution 之前，必须有 planning gate 的显式通过记录。
  const issuePlanningGate = currentPhaseGateState(repoRoot, change, "issue_planning");
  if (issuePlanningGate.failed === true) {
    return ["issue_planning", "", `最近一次 issue_planning gate 未通过；需先修订 tasks / INDEX / ISSUE 文档，并重新收敛 planning verdict，再更新 \`${issuePlanningGate.path}\`。`];
  }
  if (issuePlanningGate.passed !== true) {
    if (Object.keys(issuePlanningGate.artifact as JsonRecord).length > 0 && issuePlanningGate.current !== true) {
      return [
        "issue_planning",
        "",
        `规划文档在最近一次 issue_planning gate 后发生了变化；必须先重新完成 planning review，并刷新 \`${issuePlanningGate.path}\`，之后才能开始首个 issue execution。`
      ];
    }
    return [
      "issue_planning",
      "",
      `tasks / INDEX / ISSUE 文档已存在，但 issue_planning gate 还没有记录通过；必须先完成 planning/check/review 门禁，并写入 \`${issuePlanningGate.path}\`，之后才能提交规划文档或派发首个 issue。`
    ];
  }

  const planningDocs = planningDocStatus(repoRoot, change);
  if (planningDocs.git_available === true && planningDocs.needs_commit === true) {
    return [
      "issue_planning",
      "",
      "任务拆分已完成，但 proposal / design / tasks / issue 文档尚未提交；需先提交规划文档后再开始首个 issue execution。"
    ];
  }

  const selectedIssueId = explicitIssueId.trim() || focusIssueId(issues);
  const reviewRequiredIssue = issues.find((issue) => issue.boundary_status === "review_required" || issue.next_action === "coordinator_review");
  if (reviewRequiredIssue) {
    const reviewGate = currentIssueReviewGateState(repoRoot, change, reviewRequiredIssue);
    if (reviewGate.required && reviewGate.failed === true) {
      return ["issue_execution", String(reviewRequiredIssue.issue_id ?? ""), `当前 issue 的 checker/reviewer gate 未通过；需先修复问题并重新更新 \`${reviewGate.path}\`。`];
    }
    if (reviewGate.required && reviewGate.passed !== true) {
      if (Object.keys(reviewGate.artifact as JsonRecord).length > 0 && reviewGate.current !== true) {
        return ["issue_execution", String(reviewRequiredIssue.issue_id ?? ""), `当前 issue 的 checker/reviewer gate 已过期；需先重新收敛检查/审查结论并刷新 \`${reviewGate.path}\`。`];
      }
      return ["issue_execution", String(reviewRequiredIssue.issue_id ?? ""), `当前 issue 使用了 team dispatch；在 merge 前必须先完成 checker/reviewer gate，并写入 \`${reviewGate.path}\`。`];
    }
  }
  const incomplete = issues.filter((issue) => String(issue.status ?? "").trim() !== "completed");
  if (incomplete.length > 0) {
    return ["issue_execution", selectedIssueId, "仍有 issue 未完成，继续执行当前 issue 回合。"];
  }

  const reviewState = currentReviewState(repoRoot, change, issues);
  if (reviewState.failed === true) {
    return ["change_acceptance", "", "全部 issue 已完成，但最近一次 change-level /review 未通过，需要先修复 review findings。"];
  }
  if (reviewState.passed !== true) {
    if (Object.keys(reviewState.artifact as JsonRecord).length > 0) {
      return ["change_acceptance", "", "全部 issue 已完成，但 change-level /review 工件已过期，需要重新运行后再决定是否 verify。"];
    }
    return ["change_acceptance", "", "全部 issue 已完成，需先对当前分支未 push 的代码运行 change-level /review（排除 openspec/changes/**），然后才能进入 verify。"];
  }

  const verifyState = currentVerifyState(repoRoot, change, issues);
  const latestRound = (controlState.latest_round as JsonRecord | undefined) ?? {};
  const autoAcceptChangeAcceptance = Boolean(config.subagent_team.auto_accept_change_acceptance);
  if (verifyState.passed === true) {
    return ["ready_for_archive", "", "最新 verify 已通过，change 可以进入归档收尾。"];
  }
  if (verifyState.failed === true) {
    return ["change_verify", "", "最近一次 verify 未通过，需要修复并重新验证。"];
  }
  if (autoAcceptChangeAcceptance && (controlState.enabled !== true || Boolean(latestRound.allows_verify))) {
    return ["change_verify", "", "全部 issue 已完成，配置允许自动进入 verify 阶段。"];
  }
  return ["change_acceptance", "", "全部 issue 已完成，进入 change 级 acceptance / verify 放行。"];
}

function phaseTargetMode(controlState: JsonRecord, phase: string): string {
  const latestRound = (controlState.latest_round as JsonRecord | undefined) ?? {};
  const targetMode = String(latestRound.target_mode ?? "").trim();
  if (targetMode) {
    return targetMode;
  }
  if (phase === "spec_readiness") {
    return "mvp";
  }
  if (phase === "issue_planning") {
    return "release";
  }
  if (phase === "change_acceptance" || phase === "change_verify" || phase === "ready_for_archive") {
    return "release";
  }
  return "quality";
}

function phaseGoal(phase: string, change: string, issueId: string, controlState: JsonRecord): string {
  const latestRound = (controlState.latest_round as JsonRecord | undefined) ?? {};
  const explicitGoal = String(latestRound.round_target ?? "").trim();
  if (explicitGoal) {
    return explicitGoal;
  }
  if (phase === "spec_readiness") {
    return `把 ${change} 的 proposal / design 补齐到可评审状态，并完成设计评审后再进入任务拆分。`;
  }
  if (phase === "issue_planning") {
    return `基于已通过的设计评审，产出 ${change} 的 tasks.md、INDEX 和 ISSUE 文档，并让任务拆分通过审查。`;
  }
  if (phase === "issue_execution") {
    return `推进 ${issueId || "当前 issue"} 完成开发、检查、修复、审查回合。`;
  }
  if (phase === "change_acceptance") {
    return `先对 ${change} 当前分支未 push 的代码运行 change-level /review（排除 openspec/changes/**），再确认它已达到 verify / archive 前的 change 级通过条件。`;
  }
  if (phase === "change_verify") {
    return `在已通过 change-level /review 后，对 ${change} 运行 change 级 verify，并处理验证失败或遗漏项。`;
  }
  return `${change} 已满足归档前条件，执行最终收尾。`;
}

function phaseAcceptanceCriteria(phase: string, issueId: string, issues: IssuePayload[]): string[] {
  if (phase === "spec_readiness") {
    return [
      "proposal / design 齐全且相互一致",
      "范围、约束、非目标足够清楚，足以进入任务拆分",
      "2 个 design review subagent 都给出通过结论，允许进入 plan-issues",
      "`runs/SPEC-READINESS.json` 是当前 proposal / design 的最新通过门禁"
    ];
  }
  if (phase === "issue_planning") {
    return [
      "tasks.md、INDEX 和 ISSUE 文档齐全且相互一致",
      "INDEX 和 ISSUE 文档可由新鲜 worker 直接消费",
      "每个 issue 的边界、ownership、validation 明确",
      "`runs/ISSUE-PLANNING.json` 是当前 planning 文档的最新通过门禁",
      "proposal / design / tasks / issue 文档已先由 coordinator 提交",
      "当前 round 已批准可派发 issue"
    ];
  }
  if (phase === "issue_execution") {
    return [
      `${issueId || "当前 issue"} 的目标范围达成`,
      "检查组发现的问题已被修复或显式降级",
      "审查组给出 pass 或 pass with noted debt",
      "team dispatch issue 已写入当前通过的 `runs/ISSUE-REVIEW-<issue>.json`"
    ];
  }
  if (phase === "change_acceptance") {
    const completedCount = issues.filter((issue) => String(issue.status ?? "").trim() === "completed").length;
    return [
      `已接受 issue 数量与计划一致，目前 completed=${completedCount}`,
      "CHANGE-REVIEW.json 为当前 issue 集合的最新 review 结果，且 verdict=pass",
      "change 级 Must fix now 已清空",
      "可以放行 verify"
    ];
  }
  if (phase === "change_verify") {
    return [
      "CHANGE-REVIEW.json 为当前 issue 集合的最新 review 结果，且 verdict=pass",
      "repository validation commands 全部通过",
      "tasks.md 不再包含未勾选项",
      "CHANGE-VERIFY.json 为当前 issue 集合的最新验证结果"
    ];
  }
  return [
    "最新 verify 已通过",
    "遗留 debt 已显式记录",
    "可以 archive"
  ];
}

function phaseScopeItems(repoRoot: string, phase: string, change: string, issueId: string, issues: IssuePayload[]): string[] {
  const changeDir = path.join(repoRoot, "openspec", "changes", change);
  if (phase === "spec_readiness") {
    return [
      displayPath(repoRoot, path.join(changeDir, "proposal.md")),
      displayPath(repoRoot, path.join(changeDir, "design.md"))
    ];
  }
  if (phase === "issue_planning") {
    return [
      displayPath(repoRoot, path.join(changeDir, "tasks.md")),
      displayPath(repoRoot, path.join(changeDir, "issues", "INDEX.md")),
      "openspec/changes/<change>/issues/ISSUE-*.md"
    ];
  }
  if (phase === "issue_execution") {
    return issueId ? [issueId] : issues.map((issue) => String(issue.issue_id ?? "")).filter(Boolean);
  }
  if (phase === "change_verify") {
    return [
      "control/BACKLOG.md",
      "tasks.md",
      "runs/CHANGE-REVIEW.json",
      "runs/CHANGE-VERIFY.json",
      "repo validation commands"
    ];
  }
  if (phase === "change_acceptance") {
    return ["control/BACKLOG.md", "runs/CHANGE-REVIEW.json", "current change diff for /review"];
  }
  return ["change-level accepted issues", "control/BACKLOG.md", "latest control/ROUND-*.md"];
}

function phaseCommandHints(repoRoot: string, change: string, phase: string): string[] {
  const commands = [
    `if [ -f "${path.join(repoRoot, "openspec", "issue-mode.json")}" ]; then cat "${path.join(repoRoot, "openspec", "issue-mode.json")}"; else echo "openspec/issue-mode.json not found; using shared-workspace fallback defaults"; fi`
  ];
  if (phase === "change_acceptance") {
    commands.push(`openspec-extensions review change --repo-root "${repoRoot}" --change "${change}"`);
    return commands;
  }
  if (phase === "change_verify") {
    commands.push(`openspec-extensions verify change --repo-root "${repoRoot}" --change "${change}"`);
    return commands;
  }
  if (phase === "ready_for_archive") {
    commands.push(`openspec-extensions archive change --repo-root "${repoRoot}" --change "${change}"`);
    return commands;
  }
  return commands;
}

function bulletList(items: string[]): string {
  if (items.length === 0) {
    return "  - none";
  }
  return items.filter(Boolean).map((item) => `  - ${item}`).join("\n");
}

function phaseTeamTopology(phase: string): TeamTopologyItem[] {
  if (phase === "spec_readiness") {
    return [
      {
        key: "design_author",
        label: "Design author",
        count: 1,
        responsibility: "负责起草或修订 proposal / design，吸收反馈并提交可评审版本。",
        reasoning_effort: "high",
        reasoning_note: "设计文档编写需要更强的上下文整合、方案权衡和风险推敲。"
      },
      {
        key: "design_review",
        label: "Design review",
        count: 2,
        responsibility: "负责从需求边界、技术可行性和交付风险角度做通过 / 不通过评审。",
        reasoning_effort: "medium",
        reasoning_note: "设计评审只做判定与阻塞缺口定位，不承担编写或编码。"
      }
    ];
  }
  if (phase === "issue_planning") {
    return [
      {
        key: "development_group",
        label: "Development group",
        count: 2,
        responsibility: "负责创建或修订 tasks.md、INDEX 和 ISSUE 文档。",
        reasoning_effort: "medium",
        reasoning_note: "任务拆分阶段默认使用更轻的快路径，不把 planning review 扩成重型多席位审查。"
      },
      {
        key: "check_group",
        label: "Check group",
        count: 1,
        responsibility: "负责检查 issue 文档字段、边界和 validation 是否可执行。",
        reasoning_effort: "medium",
        reasoning_note: "planning check 默认只做边界与可执行性校验，避免重型审查拖慢派发。"
      },
      {
        key: "review_group",
        label: "Review group",
        count: 1,
        responsibility: "负责裁决任务拆分是否达到可派发状态。",
        reasoning_effort: "medium",
        reasoning_note: "planning review 默认只保留一个硬门禁 seat，必要时再升级。"
      }
    ];
  }
  if (phase === "issue_execution") {
    return [
      {
        key: "development_group",
        label: "Development group",
        count: 3,
        responsibility: "负责创建或修订当前 phase 所需产物。",
        reasoning_effort: "high",
        reasoning_note: "当前 phase 预期会修改 repo 代码、测试或集成实现。"
      },
      {
        key: "check_group",
        label: "Check group",
        count: 2,
        responsibility: "负责在 issue 边界内找 defect、回归和证据缺口。",
        reasoning_effort: "medium",
        reasoning_note: "issue round 默认只激活功能/回归两个 checker seat，避免检查扩大成全仓扫描。"
      },
      {
        key: "review_group",
        label: "Review group",
        count: 1,
        responsibility: "负责基于 issue 边界、validation 和直接依赖风险做最终通过 / 不通过裁决。",
        reasoning_effort: "medium",
        reasoning_note: "issue round 默认只保留一个 scope-first reviewer，发现跨边界风险时再升级更多 seat。"
      }
    ];
  }
  if (phase === "change_acceptance") {
    return [
      {
        key: "development_group",
        label: "Development group",
        count: 1,
        responsibility: "负责修补当前 acceptance gate 暴露出的最小缺口。",
        reasoning_effort: "medium",
        reasoning_note: "change acceptance 默认使用轻量 closeout 拓扑，不再重复 issue 级重审。"
      },
      {
        key: "check_group",
        label: "Check group",
        count: 1,
        responsibility: "负责核对 change-level review、范围覆盖和遗留 blocker。",
        reasoning_effort: "medium",
        reasoning_note: "acceptance check 默认只保留一个 gate seat，用于快速核对放行条件。"
      },
      {
        key: "review_group",
        label: "Review group",
        count: 1,
        responsibility: "负责最终确认 change 是否可以进入 verify。",
        reasoning_effort: "medium",
        reasoning_note: "acceptance review 默认只保留一个硬门禁裁决 seat。"
      }
    ];
  }
  if (phase === "change_verify") {
    return [
      {
        key: "development_group",
        label: "Development group",
        count: 2,
        responsibility: "负责创建或修订当前 phase 所需产物。",
        reasoning_effort: "high",
        reasoning_note: "verify 修复默认保留实现与测试两个开发 seat，避免重型多席位 closeout。"
      },
      {
        key: "check_group",
        label: "Check group",
        count: 1,
        responsibility: "负责核对 verify 失败点、validation 结果和任务完成状态。",
        reasoning_effort: "medium",
        reasoning_note: "verify check 默认只保留一个 gate seat，用于快速复核放行条件。"
      },
      {
        key: "review_group",
        label: "Review group",
        count: 1,
        responsibility: "负责最终确认 verify 结果是否足以进入 archive。",
        reasoning_effort: "medium",
        reasoning_note: "verify review 默认只保留一个硬门禁裁决 seat。"
      }
    ];
  }
  return [
    {
      key: "development_group",
      label: "Development group",
      count: 1,
      responsibility: "负责创建或修订当前 phase 所需产物。",
      reasoning_effort: "medium",
      reasoning_note: "closeout phase 默认使用轻量拓扑，不重复 issue 级多人回合。"
    },
    {
      key: "check_group",
      label: "Check group",
      count: 1,
      responsibility: "负责核对 closeout 所需证据和收尾条件。",
      reasoning_effort: "medium",
      reasoning_note: "closeout check 默认只保留一个 gate seat。"
    },
    {
      key: "review_group",
      label: "Review group",
      count: 1,
      responsibility: "负责最终通过 / 不通过裁决。",
      reasoning_effort: "medium",
      reasoning_note: "closeout review 默认只保留一个硬门禁 seat。"
    }
  ];
}

function renderTeamTopology(items: TeamTopologyItem[]): string {
  return items.map((item) => [
    `- ${item.label}: ${item.count} subagent${item.count === 1 ? "" : "s"}`,
    `  - ${item.responsibility}`,
    `  - Launch with \`reasoning_effort=${item.reasoning_effort}\``,
    `  - Why: ${item.reasoning_note}`
  ].join("\n")).join("\n");
}

function renderGateBearingSeats(items: TeamTopologyItem[]): string {
  return items
    .map((item) => `- ${item.label}: ${item.count} required completion${item.count === 1 ? "" : "s"}`)
    .join("\n");
}

function phaseRoundLoop(phase: string): string {
  return phase === "spec_readiness" ? "设计编写 -> 双评审 -> 修订 -> 双评审" : "开发 -> 检查 -> 修复 -> 审查";
}

function phaseRequiredOutput(phase: string): string[] {
  if (phase === "spec_readiness") {
    return [
      "Phase target",
      "Gate-bearing subagent roster with seat / agent_id / status",
      "Gate artifact: runs/SPEC-READINESS.json",
      "Design author changes completed",
      "Reviewer 1 verdict",
      "Reviewer 2 verdict",
      "Normalized review gaps",
      "Next action"
    ];
  }
  if (phase === "issue_planning") {
    return [
      "Phase target",
      "Gate-bearing subagent roster with seat / agent_id / status",
      "Gate artifact: runs/ISSUE-PLANNING.json",
      "Normalized backlog",
      "Development changes completed",
      "Check result",
      "Review verdict",
      "Next action"
    ];
  }
  return [
    "Phase target",
    "Gate-bearing subagent roster with seat / agent_id / status",
    "Normalized backlog",
    "Development changes completed",
    "Check result",
    "Review verdict",
    "Next action"
  ];
}

function phaseSeatGuardrails(phase: string): string[] {
  const guardrails = [
    "这份 lifecycle packet 只给主控 coordinator 使用；不要把整份 packet 原样转发给任一 seat subagent 当作可执行清单。",
    "启动 design-author / design-review / planning / check / review seat 时，不要 fork 整个 coordinator 线程或完整聊天历史；只传当前 seat-local handoff 和必要文件引用。",
    "已被拉起的 seat subagent 不是 coordinator；它们只能完成当前 seat 的局部目标，然后把结果交回主控会话。",
    "“如果 runtime 不支持 delegation，则由主会话串行推进” 这条 fallback 只适用于没有成功拉起 subagent 的主控会话，不适用于已启动的 seat subagent。",
    "一旦当前 phase 的 gate-bearing seat 已成功拉起，若 seat 结果回收失败或回收链路不稳定，这本身就是 blocker；coordinator 只能重拉该 seat 或停下，不允许把当前 gate 改成主会话 serial pass 自行补 verdict。",
    "如果 seat-local handoff 与 inherited coordinator / router / default prompt 冲突，以 seat-local handoff 为准。",
    "seat subagent 如果发现没有稳定的回收链路，只能回传当前 seat 的 blocker 或结果，然后停止；不要自行启用 serial fallback。"
  ];

  if (phase === "spec_readiness") {
    return [
      ...guardrails,
      "spec_readiness 的 design author / reviewers 只允许处理 proposal / design / spec 评审，不允许提前拆 tasks 或创建 ISSUE 文档。",
      "spec_readiness 的任一 seat 都不允许运行 `openspec-extensions worktree create`、`dispatch issue-team`、`execute update-progress`、`reconcile`、`review change`、`verify change` 或 `archive change`。",
      "如果 design author / reviewer 已经启动，但结果没有稳定回收出来，不允许直接把 spec_readiness 视为通过；只能重拉 seat 或显式停下处理 blocker。",
      "design reviewer 只输出 verdict、evidence、blocking gap；不要写代码、不要创建 worktree、不要写 issue progress / run 工件，也不要自行进入 issue execution。"
    ];
  }

  if (phase === "issue_planning") {
    return [
      ...guardrails,
      "issue_planning seat 只允许修订 planning 文档和给出 planning verdict；不要写 repo 产品代码，不要创建 issue worktree，不要启动 issue execution。",
      "如果 planning gate 的 seat 已经启动，但 verdict 没有稳定回收出来，不允许直接提交 planning docs 或继续 dispatch issue；先处理 seat blocker 或重拉 gate。",
      "只有主控 coordinator 才能在 planning 通过后提交规划文档，并决定是否继续 dispatch 下一个 issue。"
    ];
  }

  return [
    ...guardrails,
    "issue / acceptance / verify / archive 阶段的 seat 也不得自我升级成 coordinator；创建或复用 worktree、merge/commit、phase accept、verify、archive 一律由主控会话决定。"
  ];
}

function renderPhasePacket(
  repoRoot: string,
  change: string,
  phase: string,
  phaseReason: string,
  issueId: string,
  controlState: JsonRecord,
  config: IssueModeConfig,
  issues: IssuePayload[],
  issueTeamDispatchPath: string,
  issueTeamSeatHandoffsPath: string
): string {
  const latestRound = (controlState.latest_round as JsonRecord | undefined) ?? {};
  const backlog = (controlState.backlog as JsonRecord | undefined) ?? {};
  const targetMode = phaseTargetMode(controlState, phase);
  const roundGoal = phaseGoal(phase, change, issueId, controlState);
  const acceptanceCriteria = phaseAcceptanceCriteria(phase, issueId, issues);
  const nonGoals = Array.isArray(latestRound.non_goals) ? (latestRound.non_goals as string[]) : [];
  const scopeItems = phaseScopeItems(repoRoot, phase, change, issueId, issues);
  const mustFixNow = ((backlog.must_fix_now as JsonRecord | undefined)?.open_items as string[] | undefined) ?? [];
  const shouldFixIfCheap = ((backlog.should_fix_if_cheap as JsonRecord | undefined)?.open_items as string[] | undefined) ?? [];
  const deferredItems = ((backlog.defer as JsonRecord | undefined)?.open_items as string[] | undefined) ?? [];
  const teamTopology = phaseTeamTopology(phase);
  const requiredOutput = phaseRequiredOutput(phase);
  const autoAcceptSpecReadiness = config.subagent_team.auto_accept_spec_readiness;
  const autoAcceptIssuePlanning = config.subagent_team.auto_accept_issue_planning;
  const autoAcceptIssueReview = config.subagent_team.auto_accept_issue_review;
  const autoAcceptChangeAcceptance = config.subagent_team.auto_accept_change_acceptance;
  const autoArchiveAfterVerify = config.subagent_team.auto_archive_after_verify;
  const automationMode = automationProfile(config);
  const commandHints = phaseCommandHints(repoRoot, change, phase);
  // spec_readiness packet 常被主控摘给 seat subagent，看清 coordinator/seat 边界能避免 reviewer 越权推进后续 phase。
  const seatGuardrails = phaseSeatGuardrails(phase);
  const coordinatorCommandsSection = commandHints.length > 0
    ? `## Coordinator Commands\n\n${bulletList(commandHints)}\n\n`
    : "";
  const validationCommands = config.validation_commands.length > 0 ? config.validation_commands : ["none"];
  const configRefreshSection = `## Phase Config Refresh

- Before starting this phase, reread \`openspec/issue-mode.json\` if it exists.
- Do not rely on the previous phase's config snapshot; if the file changed, the latest contents win.
- Confirm these active rules before you spawn or continue phase seats:
  - \`worker_worktree.enabled=${String(config.worker_worktree.enabled).toLowerCase()}\`
  - \`worker_worktree.scope=${config.worker_worktree.scope}\`
  - \`worker_worktree.mode=${config.worker_worktree.mode}\`
  - \`validation_commands=${validationCommands.join(" | ")}\`
  - \`rra.gate_mode=${config.rra.gate_mode}\`
  - \`subagent_team.auto_accept_spec_readiness=${String(autoAcceptSpecReadiness).toLowerCase()}\`
  - \`subagent_team.auto_accept_issue_planning=${String(autoAcceptIssuePlanning).toLowerCase()}\`
  - \`subagent_team.auto_accept_issue_review=${String(autoAcceptIssueReview).toLowerCase()}\`
  - \`subagent_team.auto_accept_change_acceptance=${String(autoAcceptChangeAcceptance).toLowerCase()}\`
  - \`subagent_team.auto_archive_after_verify=${String(autoArchiveAfterVerify).toLowerCase()}\`

`;

  const phaseNextStep = phase === "spec_readiness"
    ? (autoAcceptSpecReadiness
      ? "当前 phase 的 gate-bearing subagent 全部完成且 verdict 满足条件后，coordinator 自动通过 design review，并进入任务拆分 / issue planning"
      : "1 个设计作者和 2 个设计评审全部完成并收齐通过结论后暂停，等待人工确认后再进入任务拆分 / issue planning")
    : phase === "issue_planning"
      ? (autoAcceptIssuePlanning
        ? "当前 phase 的 gate-bearing subagent 全部完成且 verdict 满足条件后，coordinator 自动通过 issue planning 评审，先提交 proposal / design / tasks / issue 文档，再立即派发当前 round 已批准的 issue，不要停在 control-plane ready"
        : "审查组 verdict 全部收齐并通过后，先由 coordinator 提交 proposal / design / tasks / issue 文档；提交完成后，再等待人工确认是否进入 issue execution")
      : phase === "issue_execution"
        ? (autoAcceptIssueReview
          ? "当前 round 的 gate-bearing subagent 全部完成、issue 校验通过且审查 verdict 满足条件后，coordinator 自动接受并合并该 issue，然后进入下一个 issue 或 change acceptance"
          : "审查组 verdict 全部收齐并通过后暂停，等待人工确认是否继续派发下一个 issue")
        : phase === "change_acceptance"
          ? (autoAcceptChangeAcceptance
            ? "当前 phase 的 gate-bearing subagent 全部完成、change-level /review 已通过后，coordinator 自动通过 change acceptance 并运行 verify"
            : "审查组 verdict 全部收齐并通过后暂停，等待人工确认后再运行 verify")
          : phase === "change_verify"
            ? (autoArchiveAfterVerify ? "verify 通过后自动进入 archive" : "verify 通过后暂停，等待人工确认后再 archive")
            : (autoArchiveAfterVerify ? "直接进入 archive / closeout" : "等待人工确认后再 archive / closeout");

  const phaseSpecificRules = phase === "spec_readiness"
    ? [
        "spec_readiness 使用专用拓扑，不复用通用的 3-3-3 team shape。",
        "Design author 负责补 proposal / design，不在 design review 通过前做任务拆分。",
        "Design author 启动时使用 `reasoning_effort=high`；2 个 design review subagent 使用 `reasoning_effort=medium`。",
        "2 个 design review subagent 直接给出 pass / fail 和 blocking gap，不单独再设 check group。",
        "coordinator 只有在收齐 gate-bearing verdict 并写入 `runs/SPEC-READINESS.json` 后，才允许把 spec_readiness 视为通过。",
        "只有 2 个 reviewer 都通过，才允许进入 plan-issues / 任务拆分。",
        autoAcceptSpecReadiness
          ? "当 `auto_accept_spec_readiness=true` 时，coordinator 在 gate-bearing 设计评审 subagent 全部完成并收齐通过结论后，不等待人工签字，直接把 design review 视为通过并进入 plan-issues。"
          : "审查组通过后默认停住，先让人看 design，再决定是否进入 plan-issues。"
      ]
    : phase === "issue_planning"
      ? [
          "开发组负责基于已通过的设计评审产出或修订 tasks.md、INDEX 和 ISSUE 文档。",
          "issue planning 不以写 repo 代码为目标，本 phase 默认使用 2 个开发 seat + 1 个 checker + 1 个 reviewer 的快路径，全部使用 `reasoning_effort=medium`。",
          "检查组确认 allowed_scope / out_of_scope / done_when / validation 可执行。",
          "planning check/review 默认只看 tasks.md、INDEX、ISSUE frontmatter 和当前 round contract，不做无关扩展阅读。",
          "coordinator 只有在收齐 gate-bearing verdict 并写入 `runs/ISSUE-PLANNING.json` 后，才允许把 issue_planning 视为通过。",
          "issue planning 通过后，coordinator 必须先把 proposal / design / tasks / issue 文档提交成一次独立 commit，然后才允许开始首个 issue execution。",
          "如果 reconcile 先给出 `commit_planning_docs`，那表示必须先提交规划文档；只有提交完成后，后续 `dispatch_next_issue` 才表示立即继续派发，不要把 `control-plane ready` 当作 terminal checkpoint。",
          autoAcceptIssuePlanning
            ? "当 `auto_accept_issue_planning=true` 时，coordinator 在当前 phase 的 gate-bearing planning/check/review subagent 全部完成并收齐 verdict 后，不等待人工签字；它会先提交 proposal / design / tasks / issue 文档，再派发当前 round 已批准的 issue，不要停在 `control-plane ready`。"
            : "审查组通过后默认停住，先让 coordinator 提交规划文档并人工确认，再 dispatch issue。"
        ]
      : phase === "issue_execution"
        ? [
            "开发组可以按 issue team dispatch 调起实现型 subagent。",
            "issue round 默认使用 3 个开发 seat + 2 个 checker + 1 个 reviewer 的快路径；编码型开发 subagent 使用 `reasoning_effort=high`，检查组和审查组使用 `reasoning_effort=medium`。",
            "team dispatch 下的 development seat 只负责实现和 progress start/checkpoint；如果当前改动让既有校验失效，只把相关 validation 回写成 `pending`，不要在该 seat 内完成 validation / check / review，也不要自己把 issue 标成 `completed + review_required`。",
            "checker / reviewer 必须先看 `changed_files`（若 progress artifact 已记录），没有时先看 `allowed_scope` 和 issue validation，再按需扩到直接依赖面。",
            "默认不要读取 `node_modules`、`dist`、`build`、`.next`、`coverage` 这类生成/供应商目录；只有当前 issue 明确把这些路径写进 `allowed_scope` 时才允许查看。",
            "不要把 issue check/review 扩成 repo-wide 扫描；只有出现跨边界架构风险或证据争议时，coordinator 才升级更多 checker / reviewer seat。",
            "checker / reviewer 全部通过后，coordinator 必须先写当前通过的 `runs/ISSUE-REVIEW-<issue>.json`，再把 issue 收敛到 `review_required` 并决定是否 merge。",
            autoAcceptIssueReview
              ? "当 `auto_accept_issue_review=true` 时，coordinator 会在 gate-bearing check/review subagent 全部完成、`runs/ISSUE-REVIEW-<issue>.json` 已通过且 issue-local validation 全部通过后自动接受并 merge 当前 issue，再继续后续 phase。"
              : "审查组通过后默认停住，让 coordinator 先确认是否派发下一个 issue。",
            "审查组不通过则回到开发组下一轮。"
          ]
        : phase === "change_acceptance"
          ? [
              "change acceptance 先要求 coordinator 对当前分支未 push 的代码运行 change-level /review（排除 `openspec/changes/**`），并落盘 `runs/CHANGE-REVIEW.json`。",
              "开发组只补 change-level review 或 acceptance 暴露出的缺口，不再随意扩 issue scope。",
              "change acceptance 默认不是编码 phase；使用 1 个开发 seat + 1 个 checker + 1 个 reviewer 的轻量 gate，全部使用 `reasoning_effort=medium`。",
              "检查组确认已接受 issue 能覆盖请求范围。",
              "只有 change-level /review 通过后，才允许继续进入 verify。",
              autoAcceptChangeAcceptance
                ? "当 `auto_accept_change_acceptance=true` 时，coordinator 在 gate-bearing 审查 subagent 全部完成且 change-level /review 通过后不等待人工签字，直接把 change acceptance 视为通过并切到 verify。"
                : "审查组通过后默认停住，让 coordinator 先确认是否运行 verify。"
            ]
          : phase === "change_verify"
            ? [
                "进入 verify 前，change-level /review 必须已经通过；该 review 的范围是当前分支未 push 的代码，并排除 `openspec/changes/**`。",
                "开发组只处理 verify 失败所暴露的缺口，不再随意新增 issue。",
                "verify 默认使用 2 个开发 seat + 1 个 checker + 1 个 reviewer 的快路径；如果 verify 暴露出代码/测试缺口，开发组 subagent 使用 `reasoning_effort=high`，检查组和审查组使用 `reasoning_effort=medium`。",
                "检查组负责运行并检查 repo validation、tasks completion、verify artifact。",
                autoArchiveAfterVerify ? "verify 通过后自动进入 archive 阶段。" : "verify 通过后默认停住，让 coordinator 先确认是否 archive。"
              ]
            : [
                "不再新增 issue。",
                "archive 收尾阶段默认使用 1 个开发 seat + 1 个 checker + 1 个 reviewer 的轻量 closeout 拓扑，全部使用 `reasoning_effort=medium`。",
                "仅允许 closeout / archive 所需收尾。",
                "若发现 blocker，重新回到 change_acceptance。"
              ];

  const issueTeamSection = issueTeamDispatchPath
    ? `## Issue Team Dispatch\n\n- Current issue packet:\n  - \`${issueTeamDispatchPath}\`\n${issueTeamSeatHandoffsPath ? `- Seat-local handoff packet for spawned seats:\n  - \`${issueTeamSeatHandoffsPath}\`\n- 当 development / check / review seat 已经缩窄到单个 seat-local 任务时，只传这个 handoff packet 里的对应小节，不要再把 coordinator packet 原样转发给它们。\n` : ""}\n`
    : "";

  return `继续 OpenSpec change \`${change}\`，以 subagent team 主链推进整个复杂变更生命周期。

当前 packet 不是只针对 issue execution，而是整个 change 的当前 lifecycle phase。

## Lifecycle Phase

- Phase:
  - \`${phase}\`
- Phase reason:
  - ${phaseReason}
- Automation profile:
  - \`${automationMode}\`
- Target mode:
  - \`${targetMode}\`
- Round goal:
  - ${roundGoal}
- Acceptance criteria:
${bulletList(acceptanceCriteria)}
- Non-goals:
${bulletList(nonGoals)}
- Scope in phase:
${bulletList(scopeItems)}

${configRefreshSection}## Team Topology

${renderTeamTopology(teamTopology)}

## Gate Barrier

- Gate-bearing seats for this phase:
${renderGateBearingSeats(teamTopology)}
- Barrier rules:
  - 当前 phase 里真正拉起的这些 gate-bearing subagent 必须记录 seat、\`agent_id\` 和状态。
  - 对 gate-bearing subagent 使用最长 1 小时的 blocking wait，不要 30 秒短轮询。
  - 任一 required gate-bearing subagent 仍在运行时，不允许提前通过当前 phase。
  - 任一 required gate-bearing subagent 仍在运行时，不允许提前关闭它。
  - gate-bearing subagent 一旦进入最终态，且其 verdict / blocker / artifact 更新已经被主控收敛并落盘，就应尽快关闭，避免历史 seat 持续占用 agent 配额。
  - design review / check / review 这类 gate-bearing seat 不要当作 \`explorer\` sidecar。
  - \`auto_accept_*\` 只跳过人工签字，不跳过 gate-bearing subagent 的完成等待。

## Coordinator Rules

- 主代理负责整个 change 的 lifecycle orchestration，不只负责单个 issue。
- 开始当前 phase 前必须重新读取 \`openspec/issue-mode.json\`（若存在），确认 worktree、validation、gate mode 和 auto-accept 规则没有变化。
- 如果 \`openspec/issue-mode.json\` 在 phase 之间发生变化，以最新文件内容为准，先重算当前 phase 规则，再决定是否继续。
- 当前 phase 的标准循环是：${phaseRoundLoop(phase)}。
- 拉起 subagent 时必须显式设置 \`reasoning_effort\`，不要直接继承当前会话的全局默认值。
- gate-bearing subagent 的 \`agent_id\`、seat 和完成状态必须落盘或写入 round 输出，不能只留在聊天里。
- 对当前 phase 的 gate-bearing subagent 使用最长 1 小时的 blocking wait，不要短轮询后提前返回。
- 不要把当前 phase 的 gate-bearing review/check seat 当成 \`explorer\` sidecar。
- 审查通过才允许进入下一 phase。
- 审查不通过则回到开发组下一轮。
- 任一 required gate-bearing subagent 仍在运行时，不允许 accept 当前 phase，也不允许关闭这些 subagent。
- 当前 phase 的 seat 结果一旦已经归并进 round 输出 / gate artifact，且后续不再需要继续追问该 seat，就应主动关闭已完成的 subagent，再启动下一轮或下一 phase 的新 seat。
- backlog / round / stop decision 必须落盘，不留在聊天里。
- 如果当前 runtime 不支持 delegation / subagent，不要阻塞在 team topology；把当前 packet 当作主会话的本地 coordinator playbook，按同样的 phase 规则串行推进。
- 无 delegation 时，\`issue_execution\` 仍然一次只处理一个 approved issue；主会话自己执行 development / check / repair / review，并继续写 issue-local progress / run 工件。
- 当前自动推进开关：
  - \`subagent_team.auto_accept_spec_readiness=${String(autoAcceptSpecReadiness).toLowerCase()}\`
  - \`subagent_team.auto_accept_issue_planning=${String(autoAcceptIssuePlanning).toLowerCase()}\`
  - \`subagent_team.auto_accept_issue_review=${String(autoAcceptIssueReview).toLowerCase()}\`
  - \`subagent_team.auto_accept_change_acceptance=${String(autoAcceptChangeAcceptance).toLowerCase()}\`
  - \`subagent_team.auto_archive_after_verify=${String(autoArchiveAfterVerify).toLowerCase()}\`
  - \`rra.gate_mode=${config.rra.gate_mode}\`

## Seat Handoff Guardrails
${bulletList(seatGuardrails)}

## Current Backlog

- Must fix now:
${bulletList(mustFixNow)}
- Should fix if cheap:
${bulletList(shouldFixIfCheap)}
- Defer:
${bulletList(deferredItems)}

## Phase-Specific Rules
${bulletList(phaseSpecificRules)}

${coordinatorCommandsSection}${issueTeamSection}## Required Output

${requiredOutput.map((item, index) => `${index + 1}. ${item}`).join("\n")}

## Exit Condition

- 当前 phase 审查通过：
  - ${phaseNextStep}
- 当前 phase 审查不通过：
  - 回到开发组，开始下一轮
`;
}

export function renderLifecycleDispatch(args: ParsedArgs): LifecycleDispatchPayload {
  const controlDir = path.join(args.repoRoot, "openspec", "changes", args.change, "control");
  fs.mkdirSync(controlDir, { recursive: true });

  const config = loadIssueModeConfig(args.repoRoot);
  const controlState = readChangeControlState(args.repoRoot, args.change);
  const issues = collectIssues(args.repoRoot, args.change);

  const [phase, detectedIssueId, phaseReason] = args.phase === "auto"
    ? determinePhase(args.repoRoot, args.change, issues, args.issueId, controlState, config)
    : [args.phase, args.issueId.trim(), `phase 由显式参数 \`${args.phase}\` 指定。`];

  const focusIssue = args.issueId.trim() || detectedIssueId;
  let issueTeamDispatchPath = "";
  let issueTeamSeatHandoffsPath = "";
  let issueTeamDispatch: IssueTeamDispatchPayload | Record<string, never> = {};

  if (phase === "issue_execution" && focusIssue) {
    issueTeamDispatch = renderIssueTeamDispatch({
      repoRoot: args.repoRoot,
      change: args.change,
      issueId: focusIssue,
      targetMode: "",
      roundGoal: "",
      dryRun: args.dryRun
    });
    issueTeamDispatchPath = String(issueTeamDispatch.team_dispatch_path ?? "").trim();
    issueTeamSeatHandoffsPath = String(issueTeamDispatch.seat_handoffs_path ?? "").trim();
  }

  const lifecyclePacketPath = path.join(controlDir, "SUBAGENT-TEAM.dispatch.md");
  const packetText = renderPhasePacket(
    args.repoRoot,
    args.change,
    phase,
    phaseReason,
    focusIssue,
    controlState,
    config,
    issues,
    issueTeamDispatchPath,
    issueTeamSeatHandoffsPath
  );

  if (!args.dryRun) {
    fs.writeFileSync(lifecyclePacketPath, packetText);
  }

  const latestRoundPath = latestRoundArtifactPath(args.repoRoot, args.change);

  return {
    generated_at: nowIso(),
    change: args.change,
    phase,
    phase_reason: phaseReason,
    focus_issue_id: focusIssue,
    lifecycle_dispatch_path: displayPath(args.repoRoot, lifecyclePacketPath),
    issue_team_dispatch_path: issueTeamDispatchPath,
    issue_team_seat_handoffs_path: issueTeamSeatHandoffsPath,
    issue_team_dispatch: issueTeamDispatch,
    latest_round_path: latestRoundPath ? displayPath(args.repoRoot, latestRoundPath) : "",
    automation: {
      accept_spec_readiness: config.subagent_team.auto_accept_spec_readiness,
      accept_issue_planning: config.subagent_team.auto_accept_issue_planning,
      accept_issue_review: config.subagent_team.auto_accept_issue_review,
      accept_change_acceptance: config.subagent_team.auto_accept_change_acceptance,
      archive_after_verify: config.subagent_team.auto_archive_after_verify
    },
    automation_profile: automationProfile(config),
    team_topology: phaseTeamTopology(phase),
    control_state: controlState,
    issue_count: issues.length,
    dry_run: args.dryRun
  };
}

export function runLifecycleDispatchRenderer(argv: string[]): number {
  const payload = renderLifecycleDispatch(parseCommandArgs(argv));
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 0;
}
