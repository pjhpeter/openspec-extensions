import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  issueReviewArtifactIsCurrent,
  issueReviewArtifactPath,
  issueReviewStatus,
  issueTeamDispatchPath,
  nowIso,
  readJson,
  writeJson,
  type JsonRecord,
} from "../domain/change-coordinator";
import {
  inferWorkerWorktreeScope,
  isSharedWorkerWorkspace,
  issueWorkerWorktreePath,
  loadIssueModeConfig,
  parseFrontmatter,
} from "../domain/issue-mode";
import {
  applyGitPatch,
  buildWorkerPatch,
  currentTargetRef,
  ensureCleanTarget,
  ensureWorkerExists,
  stageAndCommit,
  syncReusableWorkerWorkspace,
  syncTasksAfterMerge,
} from "../git/merge";
import { displayPath } from "../utils/path";

const MERGE_ISSUE_HELP_TEXT = `Usage:
  openspec-extensions reconcile merge-issue --repo-root <path> --change <change> --issue-id <issue> [--commit-message <message>] [--dry-run] [--force]
`;

export type ParsedMergeIssueArgs = {
  change: string;
  commitMessage: string;
  dryRun: boolean;
  force: boolean;
  issueId: string;
  repoRoot: string;
};

function parseMergeIssueArgs(argv: string[]): ParsedMergeIssueArgs | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      change: { type: "string" },
      "commit-message": { type: "string", default: "" },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      help: { short: "h", type: "boolean", default: false },
      "issue-id": { type: "string" },
      "repo-root": { type: "string" },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(MERGE_ISSUE_HELP_TEXT);
    return null;
  }
  if (!values["repo-root"] || !values.change || !values["issue-id"]) {
    throw new Error("Missing required options: --repo-root, --change, --issue-id");
  }

  return {
    change: values.change,
    commitMessage: values["commit-message"],
    dryRun: values["dry-run"],
    force: values.force,
    issueId: values["issue-id"],
    repoRoot: path.resolve(values["repo-root"]),
  };
}

function issuePaths(repoRoot: string, change: string, issueId: string): {
  progressPath: string;
  runsDir: string;
} {
  const changeDir = path.join(repoRoot, "openspec", "changes", change);
  const issuesDir = path.join(changeDir, "issues");
  const runsDir = path.join(changeDir, "runs");
  return {
    progressPath: path.join(issuesDir, `${issueId}.progress.json`),
    runsDir,
  };
}

function latestRunPath(runsDir: string, issueId: string): string | null {
  if (!fs.existsSync(runsDir)) {
    return null;
  }
  const matches = fs
    .readdirSync(runsDir)
    .filter((name) => /^RUN-.*\.json$/.test(name) && name.endsWith(`-${issueId}.json`))
    .sort();
  if (matches.length === 0) {
    return null;
  }
  return path.join(runsDir, matches[matches.length - 1] as string);
}

function progressAndRunPaths(repoRoot: string, change: string, issueId: string): {
  progressPath: string;
  runPath: string | null;
} {
  const { progressPath, runsDir } = issuePaths(repoRoot, change, issueId);
  const progress = readJson(progressPath);
  const runId = String(progress.run_id ?? "").trim();
  return {
    progressPath,
    runPath: runId ? path.join(runsDir, `${runId}.json`) : latestRunPath(runsDir, issueId),
  };
}

function ensureReviewReady(progress: JsonRecord, issueId: string, force: boolean): void {
  if (force) {
    return;
  }
  if (progress.status !== "completed") {
    throw new Error(`${issueId} is not ready for coordinator merge: status must be completed.`);
  }
  if (progress.boundary_status !== "review_required" && progress.next_action !== "coordinator_review") {
    throw new Error(`${issueId} is not waiting for coordinator review.`);
  }
}

function ensureIssueTeamReviewReady(
  repoRoot: string,
  change: string,
  issueId: string,
  progress: JsonRecord,
  force: boolean
): void {
  if (force || !fs.existsSync(issueTeamDispatchPath(repoRoot, change, issueId))) {
    return;
  }

  const artifactPath = issueReviewArtifactPath(repoRoot, change, issueId);
  const artifact = readJson(artifactPath);
  const status = issueReviewStatus(artifact);
  const current = Object.keys(artifact).length > 0 && issueReviewArtifactIsCurrent(progress, artifact);
  if (current && status.passed) {
    return;
  }

  const displayPath = path.relative(repoRoot, artifactPath).split(path.sep).join("/");
  if (current && status.failed) {
    throw new Error(`${issueId} checker/reviewer gate failed; fix findings and refresh ${displayPath} before merge.`);
  }
  if (Object.keys(artifact).length > 0) {
    throw new Error(`${issueId} checker/reviewer gate is stale; refresh ${displayPath} before merge.`);
  }
  throw new Error(`${issueId} requires a passed checker/reviewer gate artifact before merge: ${displayPath}.`);
}

type IssueCommitContext = {
  doneWhen: string[];
  title: string;
};

function readIssueCommitContext(repoRoot: string, change: string, issueId: string): IssueCommitContext {
  const issuePath = path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.md`);
  if (!fs.existsSync(issuePath)) {
    return {
      doneWhen: [],
      title: "",
    };
  }

  const frontmatter = parseFrontmatter(fs.readFileSync(issuePath, "utf8"));
  const rawDoneWhen = frontmatter.done_when;
  const doneWhen = Array.isArray(rawDoneWhen)
    ? rawDoneWhen.map((value) => String(value).trim()).filter(Boolean)
    : [];

  return {
    doneWhen,
    title: String(frontmatter.title ?? "").trim(),
  };
}

function summarizeChangedFiles(changedFiles: string[], limit = 5): string[] {
  if (changedFiles.length <= limit) {
    return [...changedFiles];
  }
  return [...changedFiles.slice(0, limit), `(+${changedFiles.length - limit} more files)`];
}

function buildDefaultCommitMessage(
  change: string,
  issueId: string,
  context: IssueCommitContext,
  changedFiles: string[]
): string {
  const titleSuffix = context.title || context.doneWhen[0] || "";
  const subject = titleSuffix
    ? `opsx(${change}): accept ${issueId} ${titleSuffix}`
    : `opsx(${change}): accept ${issueId}`;

  const bodyLines: string[] = [];
  if (context.doneWhen.length > 0) {
    const acceptanceItems = context.doneWhen.slice(0, 3);
    const acceptanceSummary = acceptanceItems.join("; ");
    bodyLines.push(
      context.doneWhen.length > 3
        ? `- cover acceptance targets: ${acceptanceSummary}; (+${context.doneWhen.length - 3} more items)`
        : `- cover acceptance targets: ${acceptanceSummary}`
    );
  } else if (context.title) {
    bodyLines.push(`- accept the reviewed implementation for ${context.title}`);
  }

  const changedFileLines = summarizeChangedFiles(changedFiles);
  if (changedFileLines.length > 0) {
    bodyLines.push(`- merge reviewed changes touching ${changedFileLines.join(", ")}`);
  }
  bodyLines.push("- preserve the coordinator-owned acceptance commit boundary before the next issue");

  return bodyLines.length > 0 ? `${subject}\n\n${bodyLines.join("\n")}` : subject;
}

function ignoredWorktreePrefixes(configWorktreeRoot: string): string[] {
  const normalized = configWorktreeRoot.replace(/\\/g, "/").replace(/^[./]+/, "").replace(/\/+$/, "");
  return normalized ? [normalized] : [];
}

export function mergeIssue(args: ParsedMergeIssueArgs): JsonRecord {
  const config = loadIssueModeConfig(args.repoRoot);
  const [workerWorktree, workerDisplay, workerSource] = issueWorkerWorktreePath(
    args.repoRoot,
    args.change,
    args.issueId,
    config
  );
  const workspaceScope = inferWorkerWorktreeScope(args.repoRoot, workerWorktree, config, args.change, args.issueId);
  ensureWorkerExists(workerWorktree);

  const { progressPath, runPath } = progressAndRunPaths(args.repoRoot, args.change, args.issueId);
  if (!fs.existsSync(progressPath)) {
    throw new Error(`Issue progress artifact not found: ${progressPath}`);
  }
  const progress = readJson(progressPath);
  ensureReviewReady(progress, args.issueId, args.force);
  ensureIssueTeamReviewReady(args.repoRoot, args.change, args.issueId, progress, args.force);

  const workerPatch = buildWorkerPatch(args.repoRoot, workerWorktree);
  if (workerPatch.patch.length === 0 || workerPatch.patch.toString("utf8").trim() === "") {
    throw new Error(`No reviewable changes found in worker workspace for ${args.issueId}.`);
  }

  const sharedWorkspace = isSharedWorkerWorkspace(args.repoRoot, workerWorktree);
  const targetRef = currentTargetRef(args.repoRoot);
  const issueContext = readIssueCommitContext(args.repoRoot, args.change, args.issueId);
  const commitMessage = args.commitMessage.trim()
    || buildDefaultCommitMessage(args.change, args.issueId, issueContext, workerPatch.changedFiles);
  const result: JsonRecord = {
    change: args.change,
    issue_id: args.issueId,
    target_ref: targetRef,
    worker_worktree: workerWorktree,
    worker_worktree_relative: workerDisplay,
    worker_worktree_source: workerSource,
    workspace_scope: workspaceScope,
    base_revision: workerPatch.baseRevision,
    changed_files: workerPatch.changedFiles,
    progress_path: displayPath(args.repoRoot, progressPath),
    run_path: runPath ? displayPath(args.repoRoot, runPath) : "",
    commit_message: commitMessage,
    shared_workspace: sharedWorkspace,
    dry_run: args.dryRun,
    worker_status_lines: workerPatch.workerStatusLines,
  };

  if (args.dryRun) {
    return result;
  }

  if (!sharedWorkspace) {
    ensureCleanTarget(args.repoRoot, ignoredWorktreePrefixes(config.worktree_root));
    applyGitPatch(args.repoRoot, workerPatch.patch);
  }

  const updatedAt = nowIso();
  const summary = sharedWorkspace
    ? `Coordinator accepted ${args.issueId} from shared workspace ${workerDisplay} on ${targetRef}.`
    : `Coordinator accepted and merged ${args.issueId} from ${workerDisplay} into ${targetRef}.`;
  const tasksSync = syncTasksAfterMerge(args.repoRoot, args.change, args.issueId);

  progress.change = args.change;
  progress.issue_id = args.issueId;
  progress.status = "completed";
  progress.boundary_status = "done";
  progress.next_action = "";
  progress.summary = summary;
  progress.blocker = "";
  progress.changed_files = workerPatch.changedFiles;
  progress.updated_at = updatedAt;
  writeJson(progressPath, progress);

  const extraPaths = [progressPath];
  if (runPath) {
    const run = readJson(runPath);
    run.change = args.change;
    run.issue_id = args.issueId;
    run.latest_event = "checkpoint";
    run.status = "completed";
    run.boundary_status = "done";
    run.next_action = "";
    run.summary = summary;
    run.blocker = "";
    run.changed_files = workerPatch.changedFiles;
    run.updated_at = updatedAt;
    writeJson(runPath, run);
    extraPaths.push(runPath);
  }

  const repoRelativePaths = sharedWorkspace ? [...workerPatch.changedFiles] : [];
  for (const currentPath of extraPaths) {
    repoRelativePaths.push(displayPath(args.repoRoot, currentPath));
  }
  const tasksPath = String(tasksSync.tasks_path ?? "").trim();
  if (tasksSync.changed === true && tasksPath) {
    repoRelativePaths.push(tasksPath);
  }

  const commitSha = stageAndCommit(args.repoRoot, commitMessage, repoRelativePaths);
  if (!sharedWorkspace && workspaceScope === "change") {
    syncReusableWorkerWorkspace(workerWorktree, commitSha);
  }

  result.commit_sha = commitSha;
  result.commit_summary = summary;
  result.tasks_sync = tasksSync;
  return result;
}

export function runMergeIssueCommand(argv: string[]): number {
  const parsed = parseMergeIssueArgs(argv);
  if (!parsed) {
    return 0;
  }
  process.stdout.write(`${JSON.stringify(mergeIssue(parsed), null, 2)}\n`);
  return 0;
}
