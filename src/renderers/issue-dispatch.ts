import fs from "node:fs";
import path from "node:path";

import {
  collectIssueDispatchStateSnapshots,
  ensureIssueWorkerWorkspaceReady,
  ensureIssueDispatchAllowed,
  issueWorkerWorkspaceState,
  loadIssueModeConfig,
  parseFrontmatter,
  readChangeControlState,
  type IssueDispatchGate,
  type IssueModeConfig
} from "../domain/issue-mode";

type Frontmatter = Record<string, unknown>;

export interface RenderIssueDispatchArgs {
  change: string;
  dryRun?: boolean;
  issueId: string;
  repoRoot: string;
  runId?: string;
}

export interface RenderIssueDispatchResult {
  artifact_repo_root: string;
  change: string;
  config_path: string;
  control_gate: IssueDispatchGate;
  dispatch_path: string;
  dry_run: boolean;
  issue_id: string;
  run_id: string;
  validation: string[];
  validation_source: "issue_doc" | "config_default";
  worker_worktree: string;
  worker_worktree_source: "issue_doc" | "config_default";
  worker_workspace_exists: boolean;
  worker_workspace_ready: boolean;
  worker_workspace_scope: "shared" | "change" | "issue";
  worker_workspace_status: string;
}

function requireList(frontmatter: Frontmatter, key: string): string[] {
  const value = frontmatter[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Issue doc missing required list field: ${key}`);
  }

  const items = value
    .map((item) => String(item).trim())
    .filter(Boolean);
  if (!items.length) {
    throw new Error(`Issue doc missing required list field: ${key}`);
  }
  return items;
}

function requireString(frontmatter: Frontmatter, key: string): string {
  const value = frontmatter[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Issue doc missing required field: ${key}`);
  }
  return value.trim();
}

function issueValidationCommands(
  repoRoot: string,
  change: string,
  issueId: string,
  config: IssueModeConfig
): [string[], "issue_doc" | "config_default"] {
  const issuePath = path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.md`);
  const frontmatter = parseFrontmatter(fs.readFileSync(issuePath, "utf8"));
  const validation = frontmatter.validation;
  if (Array.isArray(validation)) {
    const items = validation
      .map((item) => String(item).trim())
      .filter(Boolean);
    if (items.length) {
      return [items, "issue_doc"];
    }
  }
  return [[...config.validation_commands], "config_default"];
}

function bulletList(items: string[]): string {
  return items.map((item) => `  - \`${item}\``).join("\n");
}

export function renderIssueDispatchMarkdown(
  change: string,
  frontmatter: Frontmatter,
  workerWorktree: string,
  validation: string[],
  repoRoot: string,
  runId: string,
  dispatchGate: IssueDispatchGate
): string {
  const issueId = requireString(frontmatter, "issue_id");
  const title = requireString(frontmatter, "title");
  const allowedScope = requireList(frontmatter, "allowed_scope");
  const outOfScope = requireList(frontmatter, "out_of_scope");
  const doneWhen = requireList(frontmatter, "done_when");
  const effectiveRunId = runId.trim() || `RUN-<timestamp>-${issueId}`;
  const gateStatus = dispatchGate.status.trim() || "not_applicable";
  const gateMode = dispatchGate.mode.trim() || "advisory";
  const gateReason = dispatchGate.reason.trim() || "none";

  return `继续 OpenSpec change \`${change}\`，执行单个 issue。

这是给单个 issue-only subagent 使用的 dispatch。保持当前 issue 边界，不要再派生新的 issue-only subagent、team，或扩大 scope。

- Issue: \`${issueId}\` - ${title}
- Issue workspace (\`worker_worktree\`):
  - \`${workerWorktree}\`
- Workflow artifact repo root:
  - \`${repoRoot}\`
- Run ID:
  - \`${effectiveRunId}\`
- RRA dispatch gate:
  - mode=\`${gateMode}\`
  - status=\`${gateStatus}\`
  - reason=\`${gateReason}\`
- Allowed scope:
${bulletList(allowedScope)}
- Out of scope:
${bulletList(outOfScope)}
- Done when:
${bulletList(doneWhen)}
- Validation:
${bulletList(validation)}

开始后先写：
- \`openspec-extensions execute update-progress start --repo-root "${repoRoot}" --change "${change}" --issue-id "${issueId}" --run-id "${effectiveRunId}" --status in_progress --boundary-status working --next-action continue_issue --summary "已开始处理该 issue。"\`

完成后回报：
- Issue
- Files
- Validation
- Progress Artifact
- Run Artifact
- Need Coordinator Update

停止前必须写：
- \`openspec-extensions execute update-progress stop --repo-root "${repoRoot}" --change "${change}" --issue-id "${issueId}" --run-id "${effectiveRunId}" --status completed --boundary-status review_required --next-action coordinator_review --summary "issue 边界内实现已完成，等待 coordinator 收敛。" --validation "lint=<pending-or-passed>" --validation "typecheck=<pending-or-passed>" --changed-file "<path>"\`

如果阻塞，改写为：
- \`status=blocked\`
- \`boundary-status=blocked\`
- \`next-action=resolve_blocker\`
- \`blocker=<concrete reason>\`
`;
}

export function renderIssueDispatch(args: RenderIssueDispatchArgs): RenderIssueDispatchResult {
  const repoRoot = path.resolve(args.repoRoot);
  const dryRun = Boolean(args.dryRun);
  const runId = args.runId ?? "";
  const config = loadIssueModeConfig(repoRoot);
  const controlState = readChangeControlState(repoRoot, args.change);
  const dispatchGate = ensureIssueDispatchAllowed(
    config,
    controlState,
    args.issueId,
    collectIssueDispatchStateSnapshots(repoRoot, args.change)
  );
  const issuesDir = path.join(repoRoot, "openspec", "changes", args.change, "issues");
  const issuePath = path.join(issuesDir, `${args.issueId}.md`);
  const dispatchPath = path.join(issuesDir, `${args.issueId}.dispatch.md`);

  if (!fs.existsSync(issuePath)) {
    throw new Error(`Issue doc not found: ${issuePath}`);
  }

  const frontmatter = parseFrontmatter(fs.readFileSync(issuePath, "utf8"));
  if (!Object.keys(frontmatter).length) {
    throw new Error("Issue doc missing valid frontmatter.");
  }

  const workerWorkspace = dryRun
    ? issueWorkerWorkspaceState(repoRoot, args.change, args.issueId, config)
    : ensureIssueWorkerWorkspaceReady(repoRoot, args.change, args.issueId, config);
  const [validation, validationSource] = issueValidationCommands(
    repoRoot,
    args.change,
    args.issueId,
    config
  );
  const dispatchText = renderIssueDispatchMarkdown(
    args.change,
    frontmatter,
    workerWorkspace.worktree_relative,
    validation,
    repoRoot,
    runId,
    dispatchGate
  );

  if (!dryRun) {
    fs.writeFileSync(dispatchPath, dispatchText, "utf8");
  }

  return {
    artifact_repo_root: repoRoot,
    change: args.change,
    config_path: config.config_path,
    control_gate: dispatchGate,
    dispatch_path: path.relative(repoRoot, dispatchPath).split(path.sep).join("/"),
    dry_run: dryRun,
    issue_id: requireString(frontmatter, "issue_id"),
    run_id: runId,
    validation,
    validation_source: validationSource,
    worker_worktree: workerWorkspace.worktree_relative,
    worker_worktree_source: workerWorkspace.worktree_source,
    worker_workspace_exists: workerWorkspace.exists,
    worker_workspace_ready: workerWorkspace.ready,
    worker_workspace_scope: workerWorkspace.workspace_scope,
    worker_workspace_status: workerWorkspace.status
  };
}
