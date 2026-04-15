import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { issueReviewArtifactPath } from "../domain/change-coordinator";
import {
  collectIssueDispatchStateSnapshots,
  ensureIssueWorkerWorkspaceReady,
  ensureIssueDispatchAllowed,
  issueWorkerWorkspaceState,
  loadIssueModeConfig,
  parseFrontmatter,
  readChangeControlState,
  type IssueDispatchGate,
  type IssueModeConfig,
} from "../domain/issue-mode";
import {
  ensureActiveSeatDispatch,
  planActiveSeatDispatch,
  readSeatStatesForDispatch,
  seatBarrierModeForGateMode,
  seatStateDir,
  summarizeSeatBarrier,
  type ActiveSeatDefinition,
  type SeatBarrierSummary,
} from "../domain/seat-control";
import { displayPath } from "../utils/path";

type JsonRecord = Record<string, unknown>;

type ParsedArgs = {
  change: string;
  dryRun: boolean;
  issueId: string;
  repoRoot: string;
  roundGoal: string;
  targetMode: string;
};

export type IssueTeamDispatchArgs = ParsedArgs;

export type IssueTeamDispatchPayload = {
  active_seat_dispatch_path: string;
  change: string;
  config_path: string;
  control_gate: IssueDispatchGate;
  control_state: JsonRecord;
  dispatch_id: string;
  dry_run: boolean;
  issue_id: string;
  progress_path: string;
  reasoning_policy: {
    check_group: string;
    development_group: string;
    review_group: string;
  };
  seat_barrier: SeatBarrierSummary;
  seat_handoffs_path: string;
  seat_state_dir: string;
  team_dispatch_path: string;
  validation: string[];
  validation_source: "issue_doc" | "config_default";
  worker_worktree: string;
  worker_worktree_source: "issue_doc" | "config_default";
  worker_workspace_exists: boolean;
  worker_workspace_ready: boolean;
  worker_workspace_scope: "shared" | "change" | "issue";
  worker_workspace_status: string;
};

const REVIEW_EXCLUDED_DIRS = new Set(["node_modules", "dist", "build", ".next", "coverage"]);

function parseCommandArgs(argv: string[]): ParsedArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      change: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "issue-id": { type: "string" },
      "repo-root": { type: "string" },
      "round-goal": { type: "string", default: "" },
      "target-mode": { type: "string", default: "" },
    },
    strict: true,
  });

  if (!values["repo-root"] || !values.change || !values["issue-id"]) {
    throw new Error("Missing required options: --repo-root, --change, --issue-id");
  }

  return {
    change: values.change,
    dryRun: values["dry-run"],
    issueId: values["issue-id"],
    repoRoot: path.resolve(values["repo-root"]),
    roundGoal: values["round-goal"],
    targetMode: values["target-mode"],
  };
}

function requireList(frontmatter: JsonRecord, key: string): string[] {
  const value = frontmatter[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Issue doc missing required list field: ${key}`);
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function requireString(frontmatter: JsonRecord, key: string): string {
  const value = frontmatter[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Issue doc missing required field: ${key}`);
  }
  return value.trim();
}

function bulletList(items: string[]): string {
  if (items.length === 0) {
    return "  - none";
  }
  return items.map((item) => `  - ${item}`).join("\n");
}

function codeBulletList(items: string[]): string {
  if (items.length === 0) {
    return "  - `none`";
  }
  return items.map((item) => `  - \`${item}\``).join("\n");
}

function readProgressSnapshot(progressPath: string): JsonRecord {
  if (!fs.existsSync(progressPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(progressPath, "utf8")) as JsonRecord;
  } catch {
    return {};
  }
}

function normalizeStringList(items: unknown): string[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => String(item).trim()).filter(Boolean);
}

function pathParts(inputPath: string): string[] {
  return inputPath.split(/[\\/]/).filter((part) => part && part !== ".");
}

function pathHitsReviewExcludedDir(inputPath: string): boolean {
  return pathParts(inputPath).some((part) => REVIEW_EXCLUDED_DIRS.has(part));
}

function scopeMatchesPath(scope: string, inputPath: string): boolean {
  const scopeTokens = pathParts(scope);
  const pathTokens = pathParts(inputPath);
  if (scopeTokens.length === 0 || pathTokens.length === 0) {
    return false;
  }

  const shorterLength = Math.min(scopeTokens.length, pathTokens.length);
  for (let index = 0; index < shorterLength; index += 1) {
    if (scopeTokens[index] !== pathTokens[index]) {
      return false;
    }
  }
  return true;
}

function scopeExplicitlyAllowsReviewPath(inputPath: string, allowedScope: string[]): boolean {
  return allowedScope.some((scope) => pathHitsReviewExcludedDir(scope) && scopeMatchesPath(scope, inputPath));
}

function filterReviewFocusPaths(paths: string[], allowedScope: string[]): [string[], string[]] {
  const included: string[] = [];
  const excluded: string[] = [];

  for (const currentPath of paths) {
    if (pathHitsReviewExcludedDir(currentPath) && !scopeExplicitlyAllowsReviewPath(currentPath, allowedScope)) {
      excluded.push(currentPath);
      continue;
    }
    included.push(currentPath);
  }

  return [included, excluded];
}

function normalizeScopeItem(text: string): string {
  return text.trim().replace(/^`+|`+$/g, "").trim();
}

function scopeItemMentionsPlanningArtifact(scopeItem: string): boolean {
  const normalized = normalizeScopeItem(scopeItem);
  if (!normalized) {
    return false;
  }
  if (normalized.endsWith("proposal.md") || normalized.endsWith("design.md") || normalized.endsWith("tasks.md")) {
    return true;
  }
  if (normalized.endsWith("issues/INDEX.md")) {
    return true;
  }
  return normalized.endsWith(".md") && (
    normalized.startsWith("issues/ISSUE-") ||
    normalized.includes("/issues/ISSUE-") ||
    normalized.endsWith("ISSUE-*.md")
  );
}

function scopeItemTargetsIssueExecution(scopeItem: string, issueId: string): boolean {
  const normalized = normalizeScopeItem(scopeItem);
  if (!normalized) {
    return false;
  }
  if (normalized.toUpperCase() === issueId.toUpperCase()) {
    return true;
  }
  return normalized.endsWith(`${issueId}.progress.json`) || normalized.endsWith(`${issueId}.team.dispatch.md`);
}

function shouldReuseLatestRoundContract(latestRound: JsonRecord, issueId: string): boolean {
  const scopeInRound = normalizeStringList(latestRound.scope_in_round);
  if (scopeInRound.length === 0) {
    return false;
  }
  if (scopeInRound.some((item) => scopeItemMentionsPlanningArtifact(item))) {
    return false;
  }
  return scopeInRound.every((item) => scopeItemTargetsIssueExecution(item, issueId));
}

function validationSnapshotLines(progressSnapshot: JsonRecord): string[] {
  const validation = progressSnapshot.validation;
  if (!validation || typeof validation !== "object" || Array.isArray(validation)) {
    return ["none"];
  }

  const entries = Object.entries(validation).map(([key, value]) => `${key}=${value}`);
  return entries.length > 0 ? entries : ["none"];
}

function issueProgressPath(repoRoot: string, change: string, issueId: string): string {
  return path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.progress.json`);
}

function issueValidationCommands(
  frontmatter: JsonRecord,
  config: IssueModeConfig
): [string[], "issue_doc" | "config_default"] {
  const validation = normalizeStringList(frontmatter.validation);
  if (validation.length > 0) {
    return [validation, "issue_doc"];
  }
  return [[...config.validation_commands], "config_default"];
}

function issuePaths(repoRoot: string, change: string, issueId: string): [string, string, string] {
  const changeDir = path.join(repoRoot, "openspec", "changes", change);
  const issuesDir = path.join(changeDir, "issues");
  return [
    changeDir,
    path.join(issuesDir, `${issueId}.md`),
    path.join(issuesDir, `${issueId}.team.dispatch.md`),
  ];
}

function issueSeatHandoffsPath(repoRoot: string, change: string, issueId: string): string {
  return path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.seat-handoffs.md`);
}

function seatLensTitle(seat: string, role: string): string {
  return `${seat} (${role})`;
}

function issueTeamSeats(): ActiveSeatDefinition[] {
  return [
    // issue_execution 里的 development seat 只负责实现交接，不参与 gate barrier。
    { seat: "Developer 1", role: "core implementation owner", gate_bearing: false, required: false, reasoning_effort: "high" },
    { seat: "Developer 2", role: "dependent module or integration owner", gate_bearing: false, required: false, reasoning_effort: "high" },
    { seat: "Developer 3", role: "tests, fixtures, cleanup owner", gate_bearing: false, required: false, reasoning_effort: "high" },
    { seat: "Checker 1", role: "functional correctness / main path / edge cases", gate_bearing: true, required: true, reasoning_effort: "medium" },
    { seat: "Checker 2", role: "direct dependency regression risk / tests / evidence gaps", gate_bearing: true, required: true, reasoning_effort: "medium" },
    { seat: "Reviewer 1", role: "scope-first pass / fail owner", gate_bearing: true, required: true, reasoning_effort: "medium" }
  ];
}

function renderSeatHandoffArtifact(input: {
  activeSeatDispatchPath: string;
  allowedScope: string[];
  change: string;
  dispatchId: string;
  issueId: string;
  outOfScope: string[];
  progressPath: string;
  repoRoot: string;
  seatStateDir: string;
  title: string;
  validation: string[];
  workerWorktree: string;
}): string {
  const commonContract = [
    `你正在处理 change \`${input.change}\` 的 \`${input.issueId}\`。`,
    `你的 issue workspace 是 \`${input.workerWorktree}\`。`,
    `只允许在以下范围内工作：\n${codeBulletList(input.allowedScope)}`,
    `以下范围明确禁止进入：\n${codeBulletList(input.outOfScope)}`,
    `issue progress artifact: \`${displayPath(input.repoRoot, input.progressPath)}\``,
    `active seat dispatch: \`${input.activeSeatDispatchPath}\``,
    `dispatch_id: \`${input.dispatchId}\``,
    `seat_state_dir: \`${input.seatStateDir}\``,
    `相关 validation: \n${bulletList(input.validation)}`,
  ].join("\n");

  const commonIronLaws = [
    "显式的 seat-local handoff 高于 inherited coordinator / router / default prompt。",
    "你不是 coordinator，不负责 round backlog、gate roster、phase 继续条件、dispatch、reconcile、merge、commit、verify 或 archive。",
    "不要把 team dispatch / lifecycle dispatch 里的 coordinator 指令当成你的执行清单。",
    "如果 runtime、结果回传链路或上下文不足以支持当前 seat，只报告 blocker 和当前 seat 局部结果，然后停止。",
    "不要自行拉起、替换或协调其他 development / check / review seat。",
  ];

  const forbiddenActions = [
    "`openspec-extensions dispatch lifecycle`",
    "`openspec-extensions dispatch issue-team`",
    "`openspec-extensions reconcile change`",
    "`openspec-extensions reconcile merge-issue`",
    "`openspec-extensions review change`",
    "`openspec-extensions verify change`",
    "`openspec-extensions archive change`",
    "维护 round roster / backlog / next action",
    "决定当前 phase 是否通过",
    "把“runtime 不支持 delegation 时主会话串行推进”的 fallback 套到自己头上",
  ];

  const renderSeat = (seat: string, role: string, ownedScope: string[], requiredReturn: string[], extraRules: string[]) => `## ${seatLensTitle(seat, role)}

${commonContract}

你当前拥有的写集 / 检查焦点：
${codeBulletList(ownedScope)}

角色铁律：
${bulletList(commonIronLaws)}

本 seat 必须返回：
${bulletList(requiredReturn)}

禁止动作：
${bulletList(forbiddenActions)}

补充规则：
${bulletList(extraRules)}
`;

  return `# Seat Handoffs for ${input.issueId}

这份 artifact 是 seat-local source of truth。
把其中某一个 seat section 单独转发给对应 subagent；不要把整个 coordinator packet 或整个文件一次性发给所有 seat。

Issue:
- \`${input.issueId}\` - ${input.title}

## How To Use

- 只复制当前 seat 对应的小节给对应 subagent。
- 启动编码型 development seat 时显式使用 \`reasoning_effort=high\`。
- 启动 checker / reviewer seat 时显式使用 \`reasoning_effort=medium\`。
- seat subagent 不得继续后续 lifecycle phase；只返回本 seat 的局部结果、证据、blocker 和 artifact 更新。

${renderSeat(
  "Development 1",
  "core implementation owner",
  input.allowedScope,
  [
    "修改文件列表",
    "本 seat 完成的实现摘要",
    "需要 coordinator 继续等待 checker / reviewer 的说明",
    "必要的 `update-progress start` 或 `checkpoint` 变更"
  ],
  [
    "优先处理核心实现路径，不要擅自扩大需求。",
    "只允许写 `openspec-extensions execute update-progress start` 或 `checkpoint`，不要写 `stop`。",
    "不要宣称 validation / check / review 已通过。",
    "不要把 issue 标成 `completed + review_required`。"
  ]
)}

${renderSeat(
  "Development 2",
  "dependent module or integration owner",
  input.allowedScope,
  [
    "修改文件列表",
    "依赖模块 / 集成层变更摘要",
    "需要 checker 重点复核的直接依赖风险",
    "必要的 `update-progress checkpoint` 变更"
  ],
  [
    "只处理依赖模块、集成接缝和当前 issue 直接相关的兼容性问题。",
    "不要决定是否需要额外 checker / reviewer；如发现风险，只把风险写回 handoff。",
    "不要读取或修改 out-of-scope 模块，除非 coordinator 重新派单。"
  ]
)}

${renderSeat(
  "Development 3",
  "tests, fixtures, cleanup owner",
  input.allowedScope,
  [
    "修改文件列表",
    "测试 / fixture / cleanup 变更摘要",
    "仍需 checker 或 reviewer 确认的证据缺口",
    "必要的 `update-progress checkpoint` 变更"
  ],
  [
    "只补当前 issue 直接需要的测试、fixture 和 cleanup。",
    "不要把 cleanup 扩成顺手重构。",
    "不要做 coordinator 级别的验收判断。"
  ]
)}

${renderSeat(
  "Checker 1",
  "functional correctness / main path / edge cases",
  input.allowedScope,
  [
    "defect / gap 或 `none`",
    "为什么它阻塞当前 issue",
    "证据",
    "最小修复建议"
  ],
  [
    "先看 `changed_files`；没有时看 `allowed_scope` 和 validation。",
    "只在确认 blocker 或直接依赖风险时才扩大阅读。",
    "不要做 repo-wide 扫描，不要输出纯风格建议。"
  ]
)}

${renderSeat(
  "Checker 2",
  "direct dependency regression risk / tests / evidence gaps",
  input.allowedScope,
  [
    "regression risk 或 `none`",
    "证据",
    "是否需要补跑 validation 的建议",
    "最小修复建议"
  ],
  [
    "只检查直接依赖面和验证证据缺口。",
    "默认排除 `node_modules`、`dist`、`build`、`.next`、`coverage`，除非 issue 明确放进 allowed scope。",
    "不要决定 round 是否通过；只提交 verdict 和证据。"
  ]
)}

${renderSeat(
  "Reviewer 1",
  "scope-first pass / fail owner",
  input.allowedScope,
  [
    "verdict: `pass` / `pass with noted debt` / `fail`",
    "evidence",
    "blocking gap 或 `none`"
  ],
  [
    "优先看 `changed_files`、`allowed_scope`、validation 和 checker 已归并结果。",
    "不要把审查扩成全仓 review。",
    "你不是 merge owner；不要宣布 issue 已可 merge。"
  ]
)}
`;
}

function renderDispatch(input: {
  activeSeatDispatchPath: string;
  allowedScope: string[];
  change: string;
  controlState: JsonRecord;
  dispatchGate: IssueDispatchGate;
  dispatchId: string;
  doneWhen: string[];
  issueId: string;
  outOfScope: string[];
  progressPath: string;
  progressSnapshot: JsonRecord;
  repoRoot: string;
  roundGoalOverride: string;
  targetModeOverride: string;
  title: string;
  validation: string[];
  workerWorktree: string;
  seatHandoffsPath: string;
  seatStateDir: string;
}): string {
  const latestRound =
    input.controlState.latest_round &&
    typeof input.controlState.latest_round === "object" &&
    !Array.isArray(input.controlState.latest_round)
      ? (input.controlState.latest_round as JsonRecord)
      : {};
  const backlog =
    input.controlState.backlog &&
    typeof input.controlState.backlog === "object" &&
    !Array.isArray(input.controlState.backlog)
      ? (input.controlState.backlog as JsonRecord)
      : {};

  const reuseLatestRoundContract = shouldReuseLatestRoundContract(latestRound, input.issueId);
  const targetMode =
    input.targetModeOverride.trim() ||
    String(latestRound.target_mode || "").trim() ||
    "quality";
  let roundGoal = input.roundGoalOverride.trim();
  if (!roundGoal && reuseLatestRoundContract) {
    roundGoal = String(latestRound.round_target || "").trim();
  }
  if (!roundGoal) {
    roundGoal = `\u63a8\u8fdb ${input.issueId} \u5b8c\u6210\u5f00\u53d1\u3001\u68c0\u67e5\u3001\u4fee\u590d\u3001\u5ba1\u67e5\u56de\u5408\u3002`;
  }

  const acceptanceCriteria = reuseLatestRoundContract
    ? normalizeStringList(latestRound.acceptance_criteria)
    : [
        `${input.issueId} \u7684\u76ee\u6807\u8303\u56f4\u8fbe\u6210`,
        "\u68c0\u67e5\u7ec4\u53d1\u73b0\u7684\u95ee\u9898\u5df2\u88ab\u4fee\u590d\u6216\u663e\u5f0f\u964d\u7ea7",
        "\u5ba1\u67e5\u7ec4\u7ed9\u51fa pass \u6216 pass with noted debt",
      ];
  const nonGoals = reuseLatestRoundContract ? normalizeStringList(latestRound.non_goals) : ["none"];
  const scopeInRound = reuseLatestRoundContract ? normalizeStringList(latestRound.scope_in_round) : [input.issueId];
  const fixesCompleted = reuseLatestRoundContract ? normalizeStringList(latestRound.fixes_completed) : ["none"];
  const reReviewResult = reuseLatestRoundContract ? normalizeStringList(latestRound.re_review_result) : ["none"];
  const acceptanceText =
    (reuseLatestRoundContract ? String(latestRound.acceptance_text || "").trim() : "") || "none";
  const nextActionText =
    (reuseLatestRoundContract ? String(latestRound.next_action_text || "").trim() : "") ||
    `\u5b8c\u6210 ${input.issueId} \u7684\u5f53\u524d round \u540e\uff0c\u7531 coordinator \u6536\u655b\u5f00\u53d1 / \u68c0\u67e5 / \u5ba1\u67e5\u7ed3\u679c\u3002`;

  const currentBacklog =
    backlog.must_fix_now && typeof backlog.must_fix_now === "object" && !Array.isArray(backlog.must_fix_now)
      ? normalizeStringList((backlog.must_fix_now as JsonRecord).open_items)
      : [];
  const shouldFixIfCheap =
    backlog.should_fix_if_cheap &&
    typeof backlog.should_fix_if_cheap === "object" &&
    !Array.isArray(backlog.should_fix_if_cheap)
      ? normalizeStringList((backlog.should_fix_if_cheap as JsonRecord).open_items)
      : [];
  const deferredItems =
    backlog.defer && typeof backlog.defer === "object" && !Array.isArray(backlog.defer)
      ? normalizeStringList((backlog.defer as JsonRecord).open_items)
      : [];

  const changedFiles = normalizeStringList(input.progressSnapshot.changed_files);
  const [currentChangedFiles, excludedReviewPaths] = filterReviewFocusPaths(changedFiles, input.allowedScope);
  const currentValidation = validationSnapshotLines(input.progressSnapshot);
  const currentFocus = currentChangedFiles.length > 0 ? currentChangedFiles : input.allowedScope;
  const excludedReviewPathsSection =
    excludedReviewPaths.length > 0
      ? `- Excluded incidental paths from review focus:\n${codeBulletList(excludedReviewPaths)}\n`
      : "";

  return `\u7ee7\u7eed OpenSpec change \`${input.change}\`\uff0c\u4ee5 subagent team \u4e3b\u94fe\u63a8\u8fdb\u5355\u4e2a issue\u3002

\u8fd9\u662f coordinator \u4e3b\u4f1a\u8bdd\u4f7f\u7528\u7684 team dispatch packet\u3002\u4fdd\u6301 subagent-team \u4e3b\u94fe\uff0c\u4e0d\u8981\u5207\u56de\u65e7\u7684 detached worker \u8fd0\u884c\u65b9\u5f0f\u3002

\u5982\u679c\u5f53\u524d agent / runtime \u4e0d\u652f\u6301 subagent \u6216 delegation\uff0c\u4e0d\u8981\u5361\u4f4f\u3002\u628a\u8fd9\u4efd team dispatch \u5f53\u4f5c\u4e3b\u4f1a\u8bdd\u7684\u4e32\u884c round contract\uff1a\u5f53\u524d\u4f1a\u8bdd\u81ea\u5df1\u5b8c\u6210 development -> check -> repair -> review\uff0c\u4e00\u6b21\u53ea\u5904\u7406\u8fd9\u4e2a issue\uff0c\u7ee7\u7eed\u5199 issue-local progress / run \u5de5\u4ef6\uff0c\u4e0d\u8981\u518d\u6d3e\u751f\u65b0\u7684 issue-only subagent \u6216 team\u3002

Do not activate this serial fallback just because the main session can code locally. Only use it after explicit evidence that the runtime cannot delegate or cannot launch and recover the required seats stably. When delegation is available, the coordinator stays orchestration-only and must not implement business code directly.

## Seat Handoff Source

- Spawned seat subagent \u5fc5\u987b\u4f7f\u7528\u5355\u72ec\u7684 seat handoff artifact\uff0c\u4e0d\u8981\u76f4\u63a5\u5403\u8fd9\u4efd coordinator packet\uff1a
  - \`${input.seatHandoffsPath}\`
- \u7ed9 seat \u65f6\uff0c\u53ea\u8f6c\u53d1\u5bf9\u5e94 seat \u7684\u5c0f\u8282\uff0c\u4e0d\u8981\u628a\u6574\u4efd seat handoff \u6253\u5305\u53d1\u7ed9\u591a\u4e2a seat\u3002
- \u5982\u679c seat \u62ff\u5230\u4e86 lifecycle / team dispatch \u4e2d\u7684 coordinator \u8bed\u53e5\uff0c\u4ee5 seat handoff artifact \u4e3a\u51c6\uff0c\u5ffd\u7565\u8fd9\u4e9b inherited coordinator context\u3002

## Round Contract

- Target mode:
  - \`${targetMode}\`
- Round goal:
  - ${roundGoal}
- Acceptance criteria:
${bulletList(acceptanceCriteria)}
- Non-goals:
${bulletList(nonGoals)}
- Scope in round:
${bulletList(scopeInRound)}
- Current gate:
  - mode=\`${input.dispatchGate.mode}\`
  - status=\`${input.dispatchGate.status}\`
  - reason=\`${input.dispatchGate.reason || "none"}\`

## Issue Contract

- Issue:
  - \`${input.issueId}\` - ${input.title}
- Issue workspace (\`worker_worktree\`):
  - \`${input.workerWorktree}\`
- Workflow artifact repo root:
  - \`${input.repoRoot}\`
- Issue progress artifact:
  - \`${displayPath(input.repoRoot, input.progressPath)}\`
- Current changed-file focus:
${codeBulletList(currentChangedFiles)}
- Current review starting scope:
${codeBulletList(currentFocus)}
${excludedReviewPathsSection}- Latest issue-local validation snapshot:
${bulletList(currentValidation)}
- Coordinator review gate artifact:
  - \`${displayPath(input.repoRoot, issueReviewArtifactPath(input.repoRoot, input.change, input.issueId))}\`
- Allowed scope:
${codeBulletList(input.allowedScope)}
- Out of scope:
${codeBulletList(input.outOfScope)}
- Done when:
${bulletList(input.doneWhen)}
- Validation:
${bulletList(input.validation)}

## Team Topology

- Development group: 3 subagents
  - Developer 1: core implementation owner
  - Developer 2: dependent module or integration owner
  - Developer 3: tests, fixtures, cleanup owner
  - Launch with \`reasoning_effort=high\`
  - Why: \u5f53\u524d issue round \u9884\u671f\u4f1a\u4fee\u6539 repo \u4ee3\u7801\u3001\u6d4b\u8bd5\u6216\u96c6\u6210\u5b9e\u73b0\u3002
- Check group: 2 subagents
  - Checker 1: changed files / allowed scope functional correctness, main path, edge cases
  - Checker 2: direct dependency regression risk, tests, evidence gaps
  - Launch with \`reasoning_effort=medium\`
  - Why: checker \u9ed8\u8ba4\u8d70 scope-first \u5feb\u8def\u5f84\uff0c\u53ea\u68c0\u67e5\u5f53\u524d issue \u53d8\u66f4\u9762\u53ca\u5176\u76f4\u63a5\u4f9d\u8d56\u98ce\u9669\u3002
- Review group: 1 subagent
  - Reviewer 1: scope-first target path / direct dependency / evidence pass or fail
  - Launch with \`reasoning_effort=medium\`
  - Why: reviewer \u9ed8\u8ba4\u53ea\u4fdd\u7559\u4e00\u4e2a\u786c\u95e8\u7981 seat\uff0c\u5bf9\u5f53\u524d issue \u505a\u5feb\u901f\u88c1\u51b3\uff1b\u66f4\u91cd\u5ba1\u67e5\u53ea\u5728\u5347\u7ea7\u65f6\u542f\u52a8\u3002

## Gate Barrier

- Active dispatch:
  - dispatch_id=\`${input.dispatchId}\`
  - manifest=\`${input.activeSeatDispatchPath}\`
  - seat_state_dir=\`${input.seatStateDir}\`
- Gate-bearing seats for this round:
  - Development group: implementation seats only write progress / handoff；它们不参与 seat barrier
  - Check group: all launched checker seats must complete and be normalized before repair / review decisions
  - Review group: all launched reviewer seats must complete and be collected before the round can pass
- Barrier rules:
  - coordinator 在真正 spawn gate-bearing seat 前，先写一条 \`launching\` seat-state。
  - seat 接手后立刻把自己的 seat-state 更新为 \`running\`。
  - seat 结束后必须把自己的 seat-state 更新为 \`completed\`、\`failed\` 或 \`blocked\`。
  - \u8bb0\u5f55\u5f53\u524d round gate-bearing subagent \u7684 seat\u3001\`agent_id\` \u548c\u72b6\u6001\uff0c\u4e0d\u80fd\u53ea\u7559\u5728\u804a\u5929\u91cc\u3002
  - \u5bf9 gate-bearing subagent \u4f7f\u7528\u6700\u957f 1 \u5c0f\u65f6\u7684 blocking wait\uff0c\u4e0d\u8981 30 \u79d2\u77ed\u8f6e\u8be2\u3002
  - \u4efb\u4e00 required gate-bearing subagent \u4ecd\u5728\u8fd0\u884c\u65f6\uff0c\u4e0d\u5141\u8bb8\u63d0\u524d\u901a\u8fc7\u5f53\u524d round\u3002
  - \u4efb\u4e00 required gate-bearing subagent \u4ecd\u5728\u8fd0\u884c\u65f6\uff0c\u4e0d\u5141\u8bb8\u63d0\u524d\u5173\u95ed\u5b83\u3002
  - gate-bearing subagent \u4e00\u65e6\u8fdb\u5165 final status\uff0c\u4e14\u5176 verdict / blocker / artifact \u66f4\u65b0\u5df2\u88ab coordinator \u5f52\u4e00\u5e76\u843d\u76d8\uff0c\u5c31\u5e94\u5c3d\u5feb\u5173\u95ed\uff0c\u907f\u514d\u5386\u53f2 seat \u6301\u7eed\u5360\u7528 agent \u914d\u989d\u3002
  - gate-bearing check/review subagent \u4e0d\u8981\u5f53\u4f5c \`explorer\` sidecar\u3002
  - \`auto_accept_issue_review=true\` \u53ea\u8df3\u8fc7\u4eba\u5de5\u7b7e\u5b57\uff0c\u4e0d\u8df3\u8fc7 gate-bearing subagent \u7684\u5b8c\u6210\u7b49\u5f85\u3002

## Scope-First Review Focus

- checker / reviewer \u5148\u770b\u5f53\u524d issue progress \u91cc\u7684 \`changed_files\`\uff1b\u5982\u679c\u8fd8\u6ca1\u6709\uff0c\u5c31\u4ece \`allowed_scope\` \u5f00\u59cb\u3002
- \u9ed8\u8ba4\u53ea\u5ba1\u5f53\u524d issue \u53d8\u66f4\u9762\u3001\`allowed_scope\`\u3001issue validation \u548c\u76f4\u63a5\u4f9d\u8d56 / \u76f4\u63a5\u8c03\u7528\u94fe\u3002
- \u9ed8\u8ba4\u6392\u9664 \`node_modules\`\u3001\`dist\`\u3001\`build\`\u3001\`.next\`\u3001\`coverage\` \u8fd9\u7c7b\u751f\u6210/\u4f9b\u5e94\u5546\u76ee\u5f55\uff1b\u53ea\u6709\u5f53\u524d issue \u660e\u786e\u628a\u8fd9\u4e9b\u8def\u5f84\u5199\u8fdb \`allowed_scope\` \u65f6\u624d\u5141\u8bb8\u67e5\u770b\u3002
- \u53ea\u6709\u4e3a\u786e\u8ba4 blocker\u3001\u56de\u5f52\u6216\u76f4\u63a5\u4f9d\u8d56\u98ce\u9669\u65f6\uff0c\u624d\u5141\u8bb8\u6269\u5927\u9605\u8bfb\u8303\u56f4\u3002
- \u4e0d\u8981\u505a repo-wide \u626b\u63cf\uff0c\u4e0d\u8981\u6269\u5c55\u5230\u4e0e\u5f53\u524d issue \u65e0\u76f4\u63a5\u5173\u7cfb\u7684\u6a21\u5757\u3002

## Coordinator Responsibilities

- \u4e3b\u4ee3\u7406\u8d1f\u8d23 orchestration\u3001scope control\u3001issue dedupe\u3001normalized backlog\u3001stop decision\u3002
- \u62c9\u8d77 subagent \u65f6\u5fc5\u987b\u663e\u5f0f\u8bbe\u7f6e \`reasoning_effort\`\uff0c\u4e0d\u8981\u76f4\u63a5\u7ee7\u627f\u5f53\u524d\u4f1a\u8bdd\u7684\u5168\u5c40\u9ed8\u8ba4\u503c\u3002
- \u6807\u51c6\u5faa\u73af\u662f\uff1a\u5f00\u53d1 -> \u68c0\u67e5 -> \u4fee\u590d -> \u5ba1\u67e5\u3002
- gate-bearing subagent \u7684 seat\u3001\`agent_id\` \u548c\u5b8c\u6210\u72b6\u6001\u5fc5\u987b\u5199\u8fdb round \u8f93\u51fa\u6216\u63a7\u5236\u5de5\u4ef6\uff0c\u4e0d\u80fd\u53ea\u7559\u5728\u804a\u5929\u91cc\u3002
- \u5bf9 gate-bearing subagent \u4f7f\u7528\u6700\u957f 1 \u5c0f\u65f6\u7684 blocking wait\uff0c\u4e0d\u8981\u77ed\u8f6e\u8be2\u540e\u63d0\u524d\u8fd4\u56de\u3002
- \u5f53\u524d round \u7684 gate-bearing check/review subagent \u4e0d\u8981\u5f53\u4f5c \`explorer\` sidecar\u3002
- \u68c0\u67e5\u7ec4\u7ed3\u679c\u5fc5\u987b\u5148\u7edf\u4e00\u5f52\u5e76\uff0c\u518d\u4ea4\u7ed9\u5f00\u53d1\u7ec4\u4fee\u590d\uff1b\u4e0d\u8981\u628a\u539f\u59cb\u68c0\u67e5\u788e\u7247\u76f4\u63a5\u4e0b\u53d1\u3002
- \u5ba1\u67e5\u7ec4\u8d1f\u8d23\u6700\u7ec8\u901a\u8fc7/\u4e0d\u901a\u8fc7\u5224\u65ad\uff1b\u5ba1\u67e5\u4e0d\u901a\u8fc7\u5c31\u56de\u5230\u5f00\u53d1\u7ec4\u5f00\u59cb\u4e0b\u4e00\u8f6e\u3002
- \u4efb\u4e00 required gate-bearing subagent \u4ecd\u5728\u8fd0\u884c\u65f6\uff0c\u4e0d\u5141\u8bb8 accept \u5f53\u524d round\uff0c\u4e5f\u4e0d\u5141\u8bb8\u5173\u95ed\u8fd9\u4e9b subagent\u3002
- \u5f53\u524d round \u7684 seat \u7ed3\u679c\u4e00\u65e6\u5df2\u7ecf\u5f52\u5e76\u8fdb round output \u6216 gate artifact\uff0c\u4e14\u540e\u7eed\u4e0d\u518d\u9700\u8981\u8ffd\u95ee\u8be5 seat\uff0c\u5c31\u5e94\u4e3b\u52a8\u5173\u95ed\u5df2\u5b8c\u6210\u7684 subagent\uff0c\u518d\u542f\u52a8\u4e0b\u4e00\u8f6e seat\u3002
- checker / reviewer \u901a\u8fc7\u540e\uff0ccoordinator \u8981\u5148\u628a\u5f53\u524d round \u7ed3\u8bba\u5f52\u4e00\u5230 \`ISSUE-REVIEW-${input.issueId}.json\`\uff0c\u7136\u540e\u518d\u628a issue progress \u5199\u6210 \`completed + review_required\`\u3002
- coordinator \u7ee7\u7eed\u62e5\u6709\uff1a
  - \`control/BACKLOG.md\`
  - latest \`control/ROUND-*.md\`
  - \`tasks.md\`
  - review / merge / commit
  - \`verify\`
  - \`archive\`

## Current Change-Level Backlog

- Must fix now:
${bulletList(currentBacklog)}
- Should fix if cheap:
${bulletList(shouldFixIfCheap)}
- Defer:
${bulletList(deferredItems)}

## Check Packet Rules

- \u6240\u6709 checker \u90fd\u8bfb\u540c\u4e00\u4efd round contract \u548c issue contract\u3002
- checker subagent \u542f\u52a8\u65f6\u663e\u5f0f\u4f7f\u7528 \`reasoning_effort=medium\`\u3002
- \u5148\u770b\uff1a
  - \`changed_files\`\uff08\u82e5 progress artifact \u5df2\u8bb0\u5f55\uff09
  - \u5426\u5219\u770b \`allowed_scope\`
  - \u518d\u770b issue validation \u548c\u5f53\u524d round backlog
- \u9700\u8981\u65f6\u7531 checker \u8fd0\u884c\u6216\u590d\u6838 issue validation\uff0c\u5e76\u628a\u7ed3\u679c\u4e0e\u8bc1\u636e\u56de\u4f20 coordinator\u3002
- \u9ed8\u8ba4\u6392\u9664 \`node_modules\`\u3001\`dist\`\u3001\`build\`\u3001\`.next\`\u3001\`coverage\` \u8fd9\u7c7b\u76ee\u5f55\uff1b\u53ea\u6709\u5f53\u524d issue \u660e\u786e\u628a\u8fd9\u4e9b\u8def\u5f84\u5199\u8fdb \`allowed_scope\` \u65f6\u624d\u5141\u8bb8\u68c0\u67e5\u3002
- \u53ea\u6709\u4e3a\u786e\u8ba4 blocker \u6216\u76f4\u63a5\u4f9d\u8d56\u56de\u5f52\u65f6\uff0c\u624d\u5141\u8bb8\u6269\u5230\u76f8\u90bb\u8c03\u7528\u94fe\u3002
- \u53ea\u8f93\u51fa\uff1a
  - defect / gap \u6216 none
  - \u4e3a\u4ec0\u4e48\u5b83\u4f1a\u963b\u585e\u5f53\u524d \`${targetMode}\` \u76ee\u6807
  - \u8bc1\u636e
  - \u6700\u5c0f\u4fee\u590d\u5efa\u8bae
- \u4e0d\u8981\u8f93\u51fa\u7eaf\u98ce\u683c\u5efa\u8bae\uff0c\u4e0d\u8981\u6269\u5c55\u9700\u6c42\u3002
- \u4e0d\u8981\u505a repo-wide \u626b\u63cf\uff0c\u4e0d\u8981\u5bf9\u65e0\u5173\u76ee\u5f55\u505a\u6cdb\u5316\u68c0\u67e5\u3002
- checker \u7684\u8f93\u51fa\u5c5e\u4e8e\u5f53\u524d round \u7684\u786c\u95e8\u7981\u8f93\u5165\uff1b\u5728\u4e3b\u63a7 agent \u6536\u9f50\u6240\u6709 checker \u7ed3\u8bba\u524d\uff0c\u4e0d\u80fd\u63d0\u524d\u901a\u8fc7\u5f53\u524d round\u3002

## Development Packet Rules

- \u5148\u5b8c\u6210\u5f53\u524d issue \u8303\u56f4\u5185\u7684\u5f00\u53d1\uff0c\u518d\u53ea\u5904\u7406 coordinator \u6279\u51c6\u8fdb\u5165\u672c\u8f6e backlog \u7684\u95ee\u9898\u3002
- \u5c3d\u91cf\u6309\u6587\u4ef6/\u6a21\u5757 ownership \u5206\u914d\uff0c\u51cf\u5c11\u5199\u96c6\u91cd\u53e0\u3002
- \u8d1f\u8d23\u5b9e\u73b0\u6216\u4fee\u590d repo \u4ee3\u7801\u7684 development subagent \u5fc5\u987b\u663e\u5f0f\u4f7f\u7528 \`reasoning_effort=high\`\u3002
- coordinator 拉起 development seat 前先写：
  - \`openspec-extensions execute seat-state set --repo-root "${input.repoRoot}" --change "${input.change}" --dispatch-id "${input.dispatchId}" --phase issue_execution --issue-id "${input.issueId}" --seat "<Developer N>" --status launching --agent-id "<agent_id>" --gate-bearing false --required false --reasoning-effort high\`
- \u9996\u4e2a\u771f\u6b63\u5f00\u59cb\u5199\u4ee3\u7801\u7684 development seat \u5148\u5199\uff1a
  - \`openspec-extensions execute update-progress start --repo-root "${input.repoRoot}" --change "${input.change}" --issue-id "${input.issueId}" --status in_progress --boundary-status working --next-action continue_issue --summary "\u5df2\u8fdb\u5165 subagent team repair round\u3002"\`
- development seat 接手后先写：
  - \`openspec-extensions execute seat-state set --repo-root "${input.repoRoot}" --change "${input.change}" --dispatch-id "${input.dispatchId}" --phase issue_execution --issue-id "${input.issueId}" --seat "<Developer N>" --status running --agent-id "<agent_id>"\`
- development seat \u8fd4\u56de\u524d\u53ea\u5141\u8bb8\u5199 checkpoint\uff1a
  - \`openspec-extensions execute update-progress checkpoint --repo-root "${input.repoRoot}" --change "${input.change}" --issue-id "${input.issueId}" --status in_progress --boundary-status working --next-action continue_issue --summary "development seat \u5df2\u5b8c\u6210\u5f53\u524d\u5b9e\u73b0\uff0c\u7b49\u5f85 checker / reviewer\u3002" --validation "<repo-validation-command>=pending" --changed-file "<path>"\`
- development seat 结束前还要回写：
  - \`openspec-extensions execute seat-state set --repo-root "${input.repoRoot}" --change "${input.change}" --dispatch-id "${input.dispatchId}" --phase issue_execution --issue-id "${input.issueId}" --seat "<Developer N>" --status completed --agent-id "<agent_id>"\`
- development seat 的 seat-state 只用于审计和恢复；真正阻塞当前 round 的 gate-bearing barrier 只看 checker / reviewer。
- development seat \u4e0d\u5141\u8bb8\u81ea\u5df1\u5199 \`stop\` \u6216\u628a issue \u6807\u6210 \`completed + review_required\`\uff1b\u90a3\u4e2a\u72b6\u6001\u53ea\u80fd\u7531 coordinator \u5728 checker / reviewer gate \u901a\u8fc7\u540e\u7edf\u4e00\u843d\u76d8\u3002
- development seat \u53ea\u8d1f\u8d23\u5b9e\u73b0\u3001changed_files \u548c progress checkpoint\uff1b\u5982\u679c\u5f53\u524d\u6539\u52a8\u4f1a\u4f7f\u5df2\u6709\u6821\u9a8c\u7ed3\u8bba\u5931\u6548\uff0c\u5c31\u628a\u76f8\u5173 validation \u6807\u8bb0\u56de \`pending\`\uff0c\u4e0d\u8981\u5728\u672c seat \u5185\u5ba3\u79f0 \`passed\`\u3002
- development seat \u4e0d\u662f\u5f53\u524d issue \u7684 validation / check / review owner\uff1b\u8fd9\u4e9b\u7ed3\u8bba\u7531 checker / reviewer / coordinator \u5728\u540e\u7eed gate \u91cc\u6536\u655b\u3002
- \u4e0d\u8981\u81ea\u5408\u5e76\uff0c\u4e0d\u8981\u66f4\u65b0 \`tasks.md\`\u3002

## Review Packet Rules

- reviewer subagent \u542f\u52a8\u65f6\u663e\u5f0f\u4f7f\u7528 \`reasoning_effort=medium\`\u3002
- reviewer \u5148\u770b \`changed_files\`\u3001\`allowed_scope\`\u3001issue validation \u548c checker \u5df2\u5f52\u5e76\u7ed3\u679c\u3002
- \u9ed8\u8ba4\u6392\u9664 \`node_modules\`\u3001\`dist\`\u3001\`build\`\u3001\`.next\`\u3001\`coverage\` \u8fd9\u7c7b\u76ee\u5f55\uff1b\u53ea\u6709\u5f53\u524d issue \u660e\u786e\u628a\u8fd9\u4e9b\u8def\u5f84\u5199\u8fdb \`allowed_scope\` \u65f6\u624d\u5141\u8bb8\u5ba1\u67e5\u3002
- \u53ea\u6709\u4e3a\u786e\u8ba4\u5f53\u524d issue \u662f\u5426\u4f1a\u5f15\u5165\u76f4\u63a5\u4f9d\u8d56\u98ce\u9669\u65f6\uff0c\u624d\u5141\u8bb8\u6269\u5230\u76f4\u63a5\u8c03\u7528\u94fe\u3002
- \u5ba1\u67e5\u7ec4\u53ea\u56de\u7b54\uff1a
  - verdict: \`pass\` / \`pass with noted debt\` / \`fail\`
  - evidence
  - blocking gap \u6216 \`none\`
- \`pass\` \u624d\u5141\u8bb8\u7ed3\u675f\u672c\u8f6e\uff1b\`fail\` \u5219\u56de\u5230\u5f00\u53d1\u7ec4\u5f00\u59cb\u4e0b\u4e00\u8f6e\u3002
- \u4e0d\u8981\u505a repo-wide \u5ba1\u67e5\uff0c\u4e0d\u8981\u628a\u5f53\u524d round \u6269\u6210\u6574\u4e2a\u4ee3\u7801\u5e93 review\u3002
- \u5728\u4e3b\u63a7 agent \u6536\u9f50\u6240\u6709 reviewer verdict \u524d\uff0c\u4e0d\u5141\u8bb8\u63d0\u524d\u901a\u8fc7\u5f53\u524d round\uff0c\u4e5f\u4e0d\u5141\u8bb8\u63d0\u524d\u5173\u95ed reviewer subagent\u3002
- \u5982\u679c\u4e24\u4e09\u8f6e\u540e\u4ecd\u505c\u6ede\uff0c\u4f18\u5148\u7f29 scope \u6216\u6536\u7d27\u76ee\u6807\uff0c\u4e0d\u8981\u9ed8\u8ba4\u6269 backlog\u3002

## Latest Round Signals

- Fixes completed:
${bulletList(fixesCompleted)}
- Re-review result:
${bulletList(reReviewResult)}
- Acceptance verdict:
  - ${acceptanceText}
- Next action hint:
  - ${nextActionText}

## Required Round Output

1. Round target
2. Gate-bearing subagent roster with seat / agent_id / status
3. Normalized backlog
4. Fixes completed
5. Re-review result
6. Acceptance verdict
7. Next action
`;
}

export function renderIssueTeamDispatch(args: IssueTeamDispatchArgs): IssueTeamDispatchPayload {
  const config = loadIssueModeConfig(args.repoRoot);
  const [changeDir, issuePath, teamDispatchPath] = issuePaths(args.repoRoot, args.change, args.issueId);
  const seatHandoffsPath = issueSeatHandoffsPath(args.repoRoot, args.change, args.issueId);
  const controlState = readChangeControlState(args.repoRoot, args.change);
  const dispatchGate = ensureIssueDispatchAllowed(
    config,
    controlState,
    args.issueId,
    collectIssueDispatchStateSnapshots(args.repoRoot, args.change)
  );

  if (!fs.existsSync(issuePath)) {
    throw new Error(`Issue doc not found: ${issuePath}`);
  }

  const frontmatter = parseFrontmatter(fs.readFileSync(issuePath, "utf8")) as JsonRecord;
  if (Object.keys(frontmatter).length === 0) {
    throw new Error("Issue doc missing valid frontmatter.");
  }

  const title = requireString(frontmatter, "title");
  const allowedScope = requireList(frontmatter, "allowed_scope");
  const outOfScope = requireList(frontmatter, "out_of_scope");
  const doneWhen = requireList(frontmatter, "done_when");
  const workerWorkspace = args.dryRun
    ? issueWorkerWorkspaceState(args.repoRoot, args.change, args.issueId, config)
    : ensureIssueWorkerWorkspaceReady(args.repoRoot, args.change, args.issueId, config);
  const [validation, validationSource] = issueValidationCommands(frontmatter, config);
  const progressPath = issueProgressPath(args.repoRoot, args.change, args.issueId);
  const progressSnapshot = readProgressSnapshot(progressPath);
  const seatHandoffsDisplayPath = displayPath(args.repoRoot, seatHandoffsPath);
  const seatManifestInput = {
    change: args.change,
    phase: "issue_execution" as const,
    issue_id: args.issueId,
    barrier_mode: seatBarrierModeForGateMode(config.rra.gate_mode),
    packet_path: displayPath(args.repoRoot, teamDispatchPath),
    seat_handoffs_path: seatHandoffsDisplayPath,
    seats: issueTeamSeats()
  };
  const seatManifest = args.dryRun
    ? planActiveSeatDispatch(args.repoRoot, seatManifestInput)
    : ensureActiveSeatDispatch(args.repoRoot, seatManifestInput);
  const activeSeatDispatchPath = displayPath(
    args.repoRoot,
    path.join(args.repoRoot, "openspec", "changes", args.change, "control", "ACTIVE-SEAT-DISPATCH.json")
  );
  const seatStateDirPath = displayPath(args.repoRoot, seatStateDir(args.repoRoot, args.change, seatManifest.dispatch_id));
  const seatBarrier = summarizeSeatBarrier(
    seatManifest,
    readSeatStatesForDispatch(args.repoRoot, args.change, seatManifest.dispatch_id)
  );
  const dispatchText = renderDispatch({
    activeSeatDispatchPath,
    allowedScope,
    change: args.change,
    controlState,
    dispatchGate,
    dispatchId: seatManifest.dispatch_id,
    doneWhen,
    issueId: args.issueId,
    outOfScope,
    progressPath,
    progressSnapshot,
    repoRoot: args.repoRoot,
    roundGoalOverride: args.roundGoal,
    targetModeOverride: args.targetMode,
    title,
    validation,
    workerWorktree: workerWorkspace.worktree_relative,
    seatHandoffsPath: seatHandoffsDisplayPath,
    seatStateDir: seatStateDirPath,
  });
  // seat handoff 单独落盘，避免 development / check / review 直接吞 coordinator packet 后角色越界。
  const seatHandoffsText = renderSeatHandoffArtifact({
    activeSeatDispatchPath,
    allowedScope,
    change: args.change,
    dispatchId: seatManifest.dispatch_id,
    issueId: args.issueId,
    outOfScope,
    progressPath,
    repoRoot: args.repoRoot,
    seatStateDir: seatStateDirPath,
    title,
    validation,
    workerWorktree: workerWorkspace.worktree_relative,
  });

  if (!args.dryRun) {
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(teamDispatchPath, dispatchText);
    fs.writeFileSync(seatHandoffsPath, seatHandoffsText);
  }

  return {
    active_seat_dispatch_path: activeSeatDispatchPath,
    change: args.change,
    issue_id: args.issueId,
    dispatch_id: seatManifest.dispatch_id,
    seat_handoffs_path: seatHandoffsDisplayPath,
    seat_state_dir: seatStateDirPath,
    team_dispatch_path: path.relative(args.repoRoot, teamDispatchPath).split(path.sep).join("/"),
    worker_worktree: workerWorkspace.worktree_relative,
    worker_worktree_source: workerWorkspace.worktree_source,
    worker_workspace_exists: workerWorkspace.exists,
    worker_workspace_ready: workerWorkspace.ready,
    worker_workspace_scope: workerWorkspace.workspace_scope,
    worker_workspace_status: workerWorkspace.status,
    progress_path: displayPath(args.repoRoot, progressPath),
    validation,
    validation_source: validationSource,
    control_gate: dispatchGate,
    control_state: controlState,
    reasoning_policy: {
      development_group: "high",
      check_group: "medium",
      review_group: "medium"
    },
    config_path: config.config_path,
    dry_run: args.dryRun,
    seat_barrier: seatBarrier
  };
}

export function runIssueTeamDispatchRenderer(argv: string[]): number {
  const args = parseCommandArgs(argv);
  const payload = renderIssueTeamDispatch(args);

  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return 0;
}
