import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { parseArgs } from "node:util";

import { runMergeIssueCommand } from "./merge-issue";
import {
  issueReviewArtifactIsCurrent,
  issueReviewArtifactPath,
  issueReviewStatus,
  issueTeamDispatchPath,
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
import { automationProfile, loadIssueModeConfig, readChangeControlState, resolveRoundDispatchWindow, type IssueModeConfig } from "../domain/issue-mode";
import {
  readActiveSeatDispatch,
  readSeatStatesForDispatch,
  summarizeSeatBarrier,
  type SeatBarrierSummary,
} from "../domain/seat-control";

const PASSING_VALIDATION_STATUSES = new Set([
  "passed",
  "pass",
  "ok",
  "success",
  "succeeded",
  "skipped",
  "not_applicable",
  "not-applicable",
  "n/a"
]);

type ParsedChangeArgs = {
  change: string;
  repoRoot: string;
};

type CommitPlanningDocsArgs = ParsedChangeArgs & {
  commitMessage: string;
  dryRun: boolean;
};

type PlanningDocStatusPayload = {
  dirty_paths: string[];
  git_available: boolean;
  needs_commit: boolean;
  paths: string[];
  status_lines: string[];
};

type IssuePayload = JsonRecord & {
  boundary_status?: string;
  issue_id?: string;
  issue_path?: string;
  next_action?: string;
  progress_path?: string;
  status?: string;
};

const RECONCILE_HELP_TEXT = `Usage:
  openspec-extensions reconcile change --repo-root <path> --change <change>
  openspec-extensions reconcile commit-planning-docs --repo-root <path> --change <change> [--commit-message <message>] [--dry-run]
  openspec-extensions reconcile merge-issue --repo-root <path> --change <change> --issue-id <issue> [--commit-message <message>] [--dry-run] [--force]
`;

function parseChangeArgs(argv: string[]): ParsedChangeArgs | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      change: { type: "string" },
      help: { short: "h", type: "boolean", default: false },
      "repo-root": { type: "string" }
    },
    strict: true
  });

  if (values.help) {
    process.stdout.write(RECONCILE_HELP_TEXT);
    return null;
  }
  if (!values["repo-root"] || !values.change) {
    throw new Error("Missing required options: --repo-root, --change");
  }

  return {
    change: values.change,
    repoRoot: path.resolve(values["repo-root"])
  };
}

function parseCommitPlanningDocsArgs(argv: string[]): CommitPlanningDocsArgs | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      change: { type: "string" },
      "commit-message": { type: "string", default: "" },
      "dry-run": { type: "boolean", default: false },
      help: { short: "h", type: "boolean", default: false },
      "repo-root": { type: "string" }
    },
    strict: true
  });

  if (values.help) {
    process.stdout.write(RECONCILE_HELP_TEXT);
    return null;
  }
  if (!values["repo-root"] || !values.change) {
    throw new Error("Missing required options: --repo-root, --change");
  }

  return {
    change: values.change,
    commitMessage: values["commit-message"],
    dryRun: values["dry-run"],
    repoRoot: path.resolve(values["repo-root"])
  };
}

function runCommand(cmd: string[], cwd: string, check = true): SpawnSyncReturns<string> {
  const process = spawnSync(cmd[0] as string, cmd.slice(1), {
    cwd,
    encoding: "utf8"
  });
  if (check && process.status !== 0) {
    const message = process.stderr.trim() || process.stdout.trim() || "command failed";
    throw new Error(message);
  }
  return process;
}

function gitOutput(repoRoot: string, ...args: string[]): string {
  return runCommand(["git", ...args], repoRoot).stdout.trim();
}

function defaultCommitMessage(change: string): string {
  return `opsx(${change}): commit planning docs`;
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
    .filter((name) => !name.endsWith(".dispatch.md"))
    .sort();

  const issues: IssuePayload[] = [];
  const seenIds = new Set<string>();

  for (const name of issueDocs) {
    const issuePath = path.join(issuesDir, name);
    const issueId = issueIdFromDoc(issuePath);
    const payload: IssuePayload = {
      issue_id: issueId,
      status: "pending",
      boundary_status: "",
      next_action: "",
      progress_path: "",
      issue_path: path.relative(repoRoot, issuePath).split(path.sep).join("/")
    };
    const progressPath = progressByIssue.get(issueId);
    if (progressPath) {
      Object.assign(payload, readJson(progressPath));
      payload.progress_path = path.relative(repoRoot, progressPath).split(path.sep).join("/");
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
    payload.progress_path = path.relative(repoRoot, progressPath).split(path.sep).join("/");
    payload.issue_path = "";
    issues.push(payload);
  }

  return issues;
}

function countStatuses(issues: IssuePayload[]): Record<string, number> {
  return {
    pending: issues.filter((issue) => issue.status === "pending" || issue.status === "").length,
    in_progress: issues.filter((issue) => issue.status === "in_progress").length,
    completed: issues.filter((issue) => issue.status === "completed").length,
    blocked: issues.filter((issue) => issue.status === "blocked").length
  };
}

function issueValidationPassed(issue: IssuePayload): boolean {
  const validation = issue.validation;
  if (!validation || typeof validation !== "object" || Array.isArray(validation) || Object.keys(validation).length === 0) {
    return false;
  }
  return Object.values(validation).every((value) => PASSING_VALIDATION_STATUSES.has(String(value).trim().toLowerCase()));
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
    path: path.relative(repoRoot, phaseGateArtifactPath(repoRoot, change, phase)).split(path.sep).join("/"),
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
    path: path.relative(repoRoot, issueReviewArtifactPath(repoRoot, change, issueId)).split(path.sep).join("/"),
    required: true,
    status: status.status
  };
}

function determineBaseNextAction(
  repoRoot: string,
  change: string,
  issues: IssuePayload[],
  config: IssueModeConfig
): [string, string, string] {
  const autoAcceptIssuePlanning = config.subagent_team.auto_accept_issue_planning;
  const autoAcceptIssueReview = config.subagent_team.auto_accept_issue_review;
  const autoAcceptChangeAcceptance = config.subagent_team.auto_accept_change_acceptance;
  const autoArchiveAfterVerify = config.subagent_team.auto_archive_after_verify;
  const planningDocs = planningDocStatus(repoRoot, change);
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
    return ["complete_spec_readiness_gate", "", `变更基础文档未齐全：${missingCore.join(", ")}。`];
  }

  // reconcile 也要受显式文档门禁约束，不能只看 tasks / issue 文档是否已经生成。
  const specReadinessGate = currentPhaseGateState(repoRoot, change, "spec_readiness");
  if (specReadinessGate.failed === true) {
    return [
      "complete_spec_readiness_gate",
      "",
      `最近一次 spec_readiness gate 未通过；需先修订 proposal / design，并重新更新 ${specReadinessGate.path}。`
    ];
  }
  if (specReadinessGate.passed !== true) {
    const hasLaterPlanningArtifacts = fs.existsSync(tasksPath) || fs.existsSync(issuesIndexPath) || issueDocs.length > 0;
    if (Object.keys(specReadinessGate.artifact as JsonRecord).length > 0 && specReadinessGate.current !== true) {
      return [
        "complete_spec_readiness_gate",
        "",
        `proposal / design 在最近一次 spec_readiness gate 后发生变化；需先重新完成设计评审并刷新 ${specReadinessGate.path}。`
      ];
    }
    return [
      "complete_spec_readiness_gate",
      "",
      hasLaterPlanningArtifacts
        ? `spec_readiness gate 尚未记录通过；即使 tasks / issue 文档已经存在，也必须先完成文档评审并写入 ${specReadinessGate.path}。`
        : `设计文档已齐全，但必须先完成 spec_readiness gate，并写入 ${specReadinessGate.path}。`
    ];
  }

  if (!fs.existsSync(tasksPath) || !fs.existsSync(issuesIndexPath) || issueDocs.length === 0) {
    return ["plan_issues", "", "任务拆分 / issue 规划工件未完成，需先产出或修订 tasks.md、INDEX 和 ISSUE 文档。"];
  }

  // planning 文档存在不等于 planning gate 已过；首个 issue 派发前必须先收敛这道门。
  const issuePlanningGate = currentPhaseGateState(repoRoot, change, "issue_planning");
  const firstPlannedIssueId = String(issueDocs[0]?.issue_id ?? "");
  if (issuePlanningGate.failed === true) {
    return [
      "complete_issue_planning_gate",
      firstPlannedIssueId,
      `最近一次 issue_planning gate 未通过；需先修订 planning 文档，并重新更新 ${issuePlanningGate.path}。`
    ];
  }
  if (issuePlanningGate.passed !== true) {
    if (Object.keys(issuePlanningGate.artifact as JsonRecord).length > 0 && issuePlanningGate.current !== true) {
      return [
        "complete_issue_planning_gate",
        firstPlannedIssueId,
        `规划文档在最近一次 issue_planning gate 后发生变化；需先重新完成 planning review 并刷新 ${issuePlanningGate.path}。`
      ];
    }
    return [
      "complete_issue_planning_gate",
      firstPlannedIssueId,
      `issue_planning gate 尚未记录通过；必须先完成 planning/check/review 门禁，并写入 ${issuePlanningGate.path}。`
    ];
  }

  if (issues.length === 0) {
    return ["no_issue_artifacts", "", "未找到 issue 工件。"];
  }

  const blocked = issues.filter((issue) => issue.status === "blocked");
  if (blocked.length > 0) {
    return ["resolve_blocker", String(blocked[0]?.issue_id ?? ""), `${blocked.length} 个 issue 处于 blocked。`];
  }

  const reviewRequired = issues.filter((issue) => issue.boundary_status === "review_required" || issue.next_action === "coordinator_review");
  if (reviewRequired.length > 0) {
    const candidate = reviewRequired[0] as IssuePayload;
    const reviewGate = currentIssueReviewGateState(repoRoot, change, candidate);
    if (reviewGate.required && reviewGate.failed) {
      return [
        "resolve_issue_review_failure",
        String(candidate.issue_id ?? ""),
        `当前 issue 的 checker/reviewer gate 未通过；需先修复问题并重新更新 ${reviewGate.path}。`
      ];
    }
    if (reviewGate.required && reviewGate.passed !== true) {
      if (Object.keys(reviewGate.artifact as JsonRecord).length > 0 && reviewGate.current !== true) {
        return [
          "complete_issue_review_gate",
          String(candidate.issue_id ?? ""),
          `当前 issue 的 checker/reviewer gate 已过期；需先重新收敛检查/审查结论并刷新 ${reviewGate.path}，之后才能 merge。`
        ];
      }
      return [
        "complete_issue_review_gate",
        String(candidate.issue_id ?? ""),
        `当前 issue 使用了 team dispatch；在 merge 前必须先完成 checker/reviewer gate，并写入 ${reviewGate.path}。`
      ];
    }
    if (autoAcceptIssueReview && issueValidationPassed(candidate)) {
      return [
        "auto_accept_issue",
        String(candidate.issue_id ?? ""),
        "当前 issue 已完成且 issue-local validation 全部通过，配置允许 coordinator 自动接受并继续推进。"
      ];
    }
    if (autoAcceptIssueReview) {
      return [
        "coordinator_review",
        String(candidate.issue_id ?? ""),
        "当前 issue 等待 coordinator 收敛，但 issue-local validation 未全部通过，暂不自动接受。"
      ];
    }
    return ["coordinator_review", String(candidate.issue_id ?? ""), `${reviewRequired.length} 个 issue 等待 coordinator 收敛。`];
  }

  const inProgress = issues.filter((issue) => issue.status === "in_progress");
  if (inProgress.length > 0) {
    return ["wait_for_active_issue", String(inProgress[0]?.issue_id ?? ""), `${inProgress.length} 个 issue 仍在执行中。`];
  }

  const pending = issues.filter((issue) => issue.status === "pending" || issue.status === "");
  if (pending.length > 0) {
    const completed = issues.filter((issue) => issue.status === "completed");
    if (completed.length > 0) {
      if (autoAcceptIssueReview) {
        return ["dispatch_next_issue", String(pending[0]?.issue_id ?? ""), `${pending.length} 个 issue 尚未开始，配置允许自动进入下一 issue。`];
      }
      return ["await_next_issue_confirmation", String(pending[0]?.issue_id ?? ""), `${pending.length} 个 issue 尚未开始，等待人工确认是否继续派发。`];
    }
    if (planningDocs.git_available === true && planningDocs.needs_commit === true) {
      if (autoAcceptIssuePlanning) {
        return [
          "commit_planning_docs",
          String(pending[0]?.issue_id ?? ""),
          "issue planning 已通过，但 proposal / design / tasks / issue 文档尚未提交；配置允许 coordinator 先自动提交规划文档。"
        ];
      }
      return [
        "await_planning_docs_commit_confirmation",
        String(pending[0]?.issue_id ?? ""),
        "issue planning 已通过，但 proposal / design / tasks / issue 文档尚未提交；需先提交规划文档后再开始首个 issue execution。"
      ];
    }
    if (autoAcceptIssuePlanning) {
      return ["dispatch_next_issue", String(pending[0]?.issue_id ?? ""), `${pending.length} 个 issue 尚未开始，配置允许 issue planning 通过后自动派发。`];
    }
    return ["await_issue_dispatch_confirmation", String(pending[0]?.issue_id ?? ""), `${pending.length} 个 issue 尚未开始，等待人工确认是否开始 issue execution。`];
  }

  const completed = issues.filter((issue) => issue.status === "completed");
  if (completed.length > 0 && completed.length === issues.length) {
    const reviewState = currentReviewState(repoRoot, change, issues);
    if (reviewState.failed === true) {
      return ["resolve_change_review_failure", "", "全部 issue 已完成，但最近一次 change-level /review 未通过。"];
    }
    if (reviewState.passed !== true) {
      if (Object.keys(reviewState.artifact as JsonRecord).length > 0) {
        return ["review_change_code", "", "全部 issue 已完成，但 change-level /review 工件已过期，需要重新运行。"];
      }
      return ["review_change_code", "", "全部 issue 已完成，需先运行 change-level /review 再决定是否 verify。"];
    }

    const verifyArtifact = readJson(verifyArtifactPath(repoRoot, change));
    if (Object.keys(verifyArtifact).length > 0 && verificationArtifactIsCurrent(repoRoot, issues, verifyArtifact)) {
      if (verifyArtifact.status === "passed") {
        if (autoArchiveAfterVerify) {
          return ["archive_change", "", "全部 issue 已完成且 change 已通过 verify，配置允许自动 archive。"];
        }
        return ["ready_for_archive", "", "全部 issue 已完成且 change 已通过 verify。"];
      }
      return ["resolve_verify_failure", "", "全部 issue 已完成，但最近一次 verify 未通过。"];
    }
    if (autoAcceptChangeAcceptance) {
      return ["verify_change", String(completed[0]?.issue_id ?? ""), "全部 issue 已完成，配置允许自动进入 verify。"];
    }
    return ["await_verify_confirmation", String(completed[0]?.issue_id ?? ""), "全部 issue 已完成，等待人工确认后再运行 verify。"];
  }

  return ["inspect_change", String(issues[0]?.issue_id ?? ""), "需要 coordinator 人工检查当前 change 状态。"];
}

function determineControlGate(controlState: JsonRecord, issues: IssuePayload[]): [string, string, string] | null {
  if (controlState.enabled !== true) {
    return null;
  }

  const mustFixNowOpen = Number(((controlState.must_fix_now as JsonRecord | undefined)?.open_count ?? 0));
  const pending = issues.filter((issue) => issue.status === "pending" || issue.status === "");
  const completed = issues.filter((issue) => issue.status === "completed");

  if (mustFixNowOpen > 0 && (pending.length > 0 || (completed.length > 0 && completed.length === issues.length))) {
    return ["resolve_round_backlog", "", `当前 RRA backlog 仍有 ${mustFixNowOpen} 个 Must fix now 未处理。`];
  }

  const latestRound = (controlState.latest_round as JsonRecord | undefined) ?? {};
  const roundDispatch = resolveRoundDispatchWindow(controlState, issues.map((issue) => ({
    issue_id: String(issue.issue_id ?? "").trim(),
    status: String(issue.status ?? "").trim(),
    boundary_status: String(issue.boundary_status ?? "").trim(),
    next_action: String(issue.next_action ?? "").trim(),
  })));
  if (pending.length > 0 && roundDispatch.dispatch_gate_active && roundDispatch.referenced_issue_ids.length > 0) {
    if (roundDispatch.approved_pending_issue_ids.length > 0) {
      return [
        "dispatch_next_issue",
        roundDispatch.approved_pending_issue_ids[0] ?? "",
        `当前 round 已批准 ${roundDispatch.approved_pending_issue_ids.length} 个待派发 issue。`
      ];
    }
    if (roundDispatch.stale_completed_round && roundDispatch.next_pending_issue_id) {
      return [
        "dispatch_next_issue",
        roundDispatch.next_pending_issue_id,
        "当前 round 只覆盖已收敛 issue；coordinator 应继续派发下一个 pending issue。"
      ];
    }
    return ["update_round_scope", "", `当前 round 未批准剩余 ${pending.length} 个 pending issue 的派发，请更新 round scope。`];
  }

  if (completed.length > 0 && completed.length === issues.length) {
    if (String(controlState.latest_round_path ?? "").trim() && latestRound.allows_verify !== true) {
      return ["change_acceptance_required", "", "全部 issue 已完成，但当前 change-level round 尚未明确放行 verify。"];
    }
  }

  return null;
}

function continuationPolicy(nextAction: string, recommendedIssueId: string): JsonRecord {
  if (nextAction === "dispatch_next_issue") {
    const issueSuffix = recommendedIssueId ? ` \`${recommendedIssueId}\`` : "";
    return {
      mode: "continue_immediately",
      pause_allowed: false,
      human_confirmation_required: false,
      must_not_stop_at_checkpoint: true,
      summary: "当前阶段已经放行，coordinator 必须继续派发下一 issue。",
      instruction: `\`dispatch_next_issue\` 不是 terminal checkpoint；不要只停在 control-plane ready。 立即为${issueSuffix} 渲染 team dispatch，并继续 subagent-team 主链。`
    };
  }
  if (nextAction === "commit_planning_docs") {
    return {
      mode: "continue_immediately",
      pause_allowed: false,
      human_confirmation_required: false,
      must_not_stop_at_checkpoint: true,
      summary: "当前 change 已完成 issue planning，coordinator 必须先提交规划文档再开始首个 issue。",
      instruction: "`commit_planning_docs` 不是 terminal checkpoint；立即提交 proposal / design / tasks / issue 文档， 然后重新 reconcile 并继续主链。"
    };
  }
  if (nextAction === "auto_accept_issue") {
    const issueSuffix = recommendedIssueId ? ` \`${recommendedIssueId}\`` : "";
    return {
      mode: "continue_immediately",
      pause_allowed: false,
      human_confirmation_required: false,
      must_not_stop_at_checkpoint: true,
      summary: "当前 issue 已满足自动接受条件，coordinator 必须立即收敛并继续。",
      instruction: `\`auto_accept_issue\` 不是 terminal checkpoint；不要停在 control-plane ready。 立即接受并 merge${issueSuffix}，然后重新 reconcile 并继续主链。`
    };
  }
  if (nextAction === "verify_change") {
    return {
      mode: "continue_immediately",
      pause_allowed: false,
      human_confirmation_required: false,
      must_not_stop_at_checkpoint: true,
      summary: "当前 change 已满足自动 verify 条件，coordinator 必须继续执行 verify。",
      instruction: "`verify_change` 不是 terminal checkpoint；立即运行 verify，不要停在 control-plane ready。"
    };
  }
  if (nextAction === "archive_change") {
    return {
      mode: "continue_immediately",
      pause_allowed: false,
      human_confirmation_required: false,
      must_not_stop_at_checkpoint: true,
      summary: "当前 change 已满足自动 archive 条件，coordinator 必须继续归档。",
      instruction: "`archive_change` 不是 terminal checkpoint；立即执行 archive，不要停在 control-plane ready。"
    };
  }
  if ([
    "await_issue_dispatch_confirmation",
    "await_planning_docs_commit_confirmation",
    "await_next_issue_confirmation",
    "await_verify_confirmation",
    "ready_for_archive"
  ].includes(nextAction)) {
    return {
      mode: "await_human_confirmation",
      pause_allowed: true,
      human_confirmation_required: true,
      must_not_stop_at_checkpoint: false,
      summary: "当前状态允许暂停，等待人工确认。",
      instruction: "当前 next_action 需要人工确认，暂停是预期行为。"
    };
  }
  if (nextAction === "wait_for_active_issue") {
    return {
      mode: "wait_for_active_subagent",
      pause_allowed: false,
      human_confirmation_required: false,
      must_not_stop_at_checkpoint: false,
      summary: "当前 issue 仍在运行，应继续等待活跃 subagent。",
      instruction: "当前 next_action 是等待活跃 issue 完成，不应改成新的人工 checkpoint。"
    };
  }
  if (nextAction === "wait_for_gate_seats") {
    return {
      mode: "wait_for_gate_seats",
      pause_allowed: false,
      human_confirmation_required: false,
      must_not_stop_at_checkpoint: false,
      summary: "当前 dispatch 的 required gate-bearing seats 仍在运行，应继续等待。",
      instruction: "seat barrier 尚未收齐，不要提前 accept 当前 phase，也不要把等待改成人工 checkpoint。"
    };
  }
  return {
    mode: "resolve_or_inspect",
    pause_allowed: false,
    human_confirmation_required: false,
    must_not_stop_at_checkpoint: false,
    summary: "当前状态需要 coordinator 处理 blocker、review 或控制面缺口。",
    instruction: "按 next_action 先解决当前阻塞或收敛动作，再决定是否继续。"
  };
}

function readSeatBarrierSummary(repoRoot: string, change: string): SeatBarrierSummary {
  const manifest = readActiveSeatDispatch(repoRoot, change);
  if (!manifest) {
    return summarizeSeatBarrier(null, []);
  }
  return summarizeSeatBarrier(
    manifest,
    readSeatStatesForDispatch(repoRoot, change, manifest.dispatch_id)
  );
}

function seatBarrierReason(summary: SeatBarrierSummary): string {
  if (summary.action === "wait_for_gate_seats") {
    return `active dispatch \`${summary.dispatch_id}\` 仍有 ${summary.required_running.length} 个 required gate-bearing seats 在运行。`;
  }
  if (summary.action === "resolve_seat_failure") {
    return `active dispatch \`${summary.dispatch_id}\` 存在 required gate-bearing seat failure/blocker/cancelled，需先处理。`;
  }
  return "";
}

export function reconcileChange(args: ParsedChangeArgs): JsonRecord {
  const config = loadIssueModeConfig(args.repoRoot);
  const issues = collectIssues(args.repoRoot, args.change);
  const controlState = readChangeControlState(args.repoRoot, args.change);
  const gateMode = config.rra.gate_mode;
  const planningDocs = planningDocStatus(args.repoRoot, args.change);
  const seatBarrier = readSeatBarrierSummary(args.repoRoot, args.change);

  const counts = countStatuses(issues);
  const [baseAction, baseRecommendedIssueId, baseReason] = determineBaseNextAction(args.repoRoot, args.change, issues, config);
  const controlGate = determineControlGate(controlState, issues);

  let nextAction = baseAction;
  let recommendedIssueId = baseRecommendedIssueId;
  let reason = baseReason;
  const docGateBlockingAction = ["complete_spec_readiness_gate", "plan_issues", "complete_issue_planning_gate"].includes(nextAction);
  if (!docGateBlockingAction && seatBarrier.mode === "enforce" && seatBarrier.action) {
    nextAction = seatBarrier.action;
    recommendedIssueId = seatBarrier.issue_id ?? recommendedIssueId;
    reason = seatBarrierReason(seatBarrier);
  }
  if (controlGate !== null && gateMode === "enforce") {
    const seatBarrierBlockingAction = ["wait_for_gate_seats", "resolve_seat_failure"].includes(nextAction);
    if (!docGateBlockingAction && !seatBarrierBlockingAction && !(["review_change_code", "resolve_change_review_failure"].includes(nextAction) && controlGate[0] === "change_acceptance_required")) {
      [nextAction, recommendedIssueId, reason] = controlGate;
    }
  }

  const controlGatePayload = {
    mode: gateMode,
    active: controlGate !== null,
    enforced: controlGate !== null && gateMode === "enforce" && !(
      ["review_change_code", "resolve_change_review_failure"].includes(nextAction) &&
      controlGate !== null &&
      controlGate[0] === "change_acceptance_required"
    ),
    action: controlGate?.[0] ?? "",
    recommended_issue_id: controlGate?.[1] ?? "",
    reason: controlGate?.[2] ?? ""
  };

  return {
    change: args.change,
    issue_count: issues.length,
    counts,
    next_action: nextAction,
    recommended_issue_id: recommendedIssueId,
    reason,
    route_decision: (controlState.route_decision as JsonRecord | undefined) ?? {},
    continuation_policy: continuationPolicy(nextAction, recommendedIssueId),
    base_next_action: {
      action: baseAction,
      recommended_issue_id: baseRecommendedIssueId,
      reason: baseReason
    },
    control: {
      ...controlState,
      gate: controlGatePayload
    },
    automation_profile: automationProfile(config),
    automation: {
      accept_spec_readiness: config.subagent_team.auto_accept_spec_readiness,
      accept_issue_planning: config.subagent_team.auto_accept_issue_planning,
      accept_issue_review: config.subagent_team.auto_accept_issue_review,
      accept_change_acceptance: config.subagent_team.auto_accept_change_acceptance,
      archive_after_verify: config.subagent_team.auto_archive_after_verify
    },
    seat_barrier: seatBarrier,
    planning_docs: planningDocs,
    issues
  };
}

export function commitPlanningDocs(args: CommitPlanningDocsArgs): JsonRecord {
  const planningDocs = planningDocStatus(args.repoRoot, args.change) as PlanningDocStatusPayload;

  if (planningDocs.git_available !== true) {
    throw new Error("Planning-doc commit requires a git repository.");
  }

  const repoRelativePaths = planningDocs.paths ?? [];
  if (repoRelativePaths.length === 0) {
    throw new Error(`No planning docs found for change \`${args.change}\`.`);
  }

  const commitMessage = args.commitMessage.trim() || defaultCommitMessage(args.change);
  const result: JsonRecord = {
    change: args.change,
    commit_message: commitMessage,
    paths: repoRelativePaths,
    status_lines: planningDocs.status_lines ?? [],
    dirty_paths: planningDocs.dirty_paths ?? [],
    needs_commit: planningDocs.needs_commit === true,
    dry_run: args.dryRun
  };

  if (planningDocs.needs_commit !== true) {
    result.status = "already_committed";
    return result;
  }

  if (args.dryRun) {
    result.status = "ready_to_commit";
    return result;
  }

  runCommand(["git", "add", "--", ...repoRelativePaths], args.repoRoot);
  runCommand(["git", "commit", "-m", commitMessage, "--", ...repoRelativePaths], args.repoRoot);
  result.status = "committed";
  result.commit_sha = gitOutput(args.repoRoot, "rev-parse", "HEAD");
  return result;
}

export function runReconcileCommand(argv: string[]): number {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === "-h" || subcommand === "--help") {
    process.stdout.write(RECONCILE_HELP_TEXT);
    return 0;
  }
  if (subcommand !== "change") {
    if (subcommand === "commit-planning-docs") {
      const parsedCommitArgs = parseCommitPlanningDocsArgs(rest);
      if (!parsedCommitArgs) {
        return 0;
      }
      process.stdout.write(`${JSON.stringify(commitPlanningDocs(parsedCommitArgs), null, 2)}\n`);
      return 0;
    }
    if (subcommand === "merge-issue") {
      return runMergeIssueCommand(rest);
    }
    if (subcommand !== "commit-planning-docs") {
      throw new Error(`Unknown reconcile command: ${subcommand}`);
    }
  }

  const parsed = parseChangeArgs(rest);
  if (!parsed) {
    return 0;
  }
  process.stdout.write(`${JSON.stringify(reconcileChange(parsed), null, 2)}\n`);
  return 0;
}
