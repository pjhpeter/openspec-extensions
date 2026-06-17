import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { parseArgs } from "node:util";

import {
  inferWorkerWorktreeScope,
  issueWorkerWorktreePath,
  loadIssueModeConfig,
  type IssueModeConfig,
  workerBranchName,
} from "../domain/issue-mode";
import { readJson, type JsonRecord } from "../domain/change-coordinator";
import { buildWorkerPatch } from "../git/merge";
import { displayPath, resolveRepoPath } from "../utils/path";

const ARCHIVE_HELP_TEXT = `Usage:
  openspec-extensions archive change --repo-root <path> --change <change> [--archive-command <command>] [--skip-cleanup] [--dry-run]
`;

type ParsedArchiveArgs = {
  archiveCommand: string;
  change: string;
  dryRun: boolean;
  repoRoot: string;
  skipCleanup: boolean;
};

function parseChangeArgs(argv: string[]): ParsedArchiveArgs | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      "archive-command": { type: "string", default: "" },
      change: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { short: "h", type: "boolean", default: false },
      "repo-root": { type: "string" },
      "skip-cleanup": { type: "boolean", default: false }
    },
    strict: true
  });

  if (values.help) {
    process.stdout.write(ARCHIVE_HELP_TEXT);
    return null;
  }
  if (!values["repo-root"] || !values.change) {
    throw new Error("Missing required options: --repo-root, --change");
  }

  return {
    archiveCommand: values["archive-command"],
    change: values.change,
    dryRun: values["dry-run"],
    repoRoot: path.resolve(values["repo-root"]),
    skipCleanup: values["skip-cleanup"]
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

function runShell(command: string, cwd: string): SpawnSyncReturns<string> {
  const process = spawnSync(command, {
    cwd,
    encoding: "utf8",
    shell: true
  });
  if (process.status !== 0) {
    const message = process.stderr.trim() || process.stdout.trim() || "archive command failed";
    throw new Error(message);
  }
  return process;
}

function canonicalPath(targetPath: string): string {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function worktreeIsRegistered(repoRoot: string, targetPath: string): boolean {
  const process = runCommand(["git", "worktree", "list", "--porcelain"], repoRoot);
  const target = canonicalPath(targetPath);
  for (const line of process.stdout.split(/\r?\n/)) {
    if (!line.startsWith("worktree ")) {
      continue;
    }
    const candidate = canonicalPath(line.slice("worktree ".length).trim());
    if (candidate === target) {
      return true;
    }
  }
  return false;
}

function branchExists(repoRoot: string, branchName: string): boolean {
  const process = runCommand(["git", "show-ref", "--verify", `refs/heads/${branchName}`], repoRoot, false);
  return process.status === 0;
}

function slugifyBranchFragment(value: string): string {
  const slug = value.replace(/[^A-Za-z0-9._/-]+/g, "-").replace(/^[./-]+|[./-]+$/g, "").replace(/\/{2,}/g, "/");
  return slug || "worker";
}

function changeBranchName(config: IssueModeConfig, change: string): string {
  const prefix = slugifyBranchFragment(config.worker_worktree.branch_prefix).replace(/^\/+|\/+$/g, "");
  const changeSlug = slugifyBranchFragment(change).replaceAll("/", "-");
  return prefix ? `${prefix}/${changeSlug}` : changeSlug;
}

type CleanupTarget = {
  branchNames: string[];
  issueIds: string[];
  scope: "change" | "issue";
  source: "config_default" | "issue_doc";
  worktree: string;
  worktreeRelative: string;
};

type DeferredArchiveMerge = {
  changedFiles: string[];
  issueIds: string[];
  reason: string;
  required: boolean;
  requiredAction: string;
  requiredCommand: string;
  statusCommand: string;
  worktree: string;
  worktreeRelative: string;
};

function mergeChangeCommand(change: string): string {
  return `openspec-extensions reconcile merge-change --repo-root . --change ${JSON.stringify(change)}`;
}

function reconcileStatusCommand(change: string): string {
  return `openspec-extensions reconcile change --repo-root . --change ${JSON.stringify(change)}`;
}

function emptyDeferredArchiveMerge(change: string): DeferredArchiveMerge {
  return {
    changedFiles: [],
    issueIds: [],
    reason: "",
    required: false,
    requiredAction: "",
    requiredCommand: "",
    statusCommand: reconcileStatusCommand(change),
    worktree: "",
    worktreeRelative: "",
  };
}

function issueDocIds(repoRoot: string, change: string): string[] {
  const issuesDir = path.join(repoRoot, "openspec", "changes", change, "issues");
  if (!fs.existsSync(issuesDir)) {
    return [];
  }

  return fs.readdirSync(issuesDir)
    .filter((name) => /^ISSUE-.*\.md$/.test(name))
    .filter((name) => !name.endsWith(".dispatch.md") && !name.endsWith(".team.dispatch.md"))
    .sort()
    .map((name) => path.basename(name, ".md"));
}

function issueProgressId(fileName: string, progress: JsonRecord): string {
  return String(progress.issue_id ?? path.basename(fileName, ".progress.json")).trim();
}

function acceptedIssueIds(repoRoot: string, change: string): string[] {
  const issuesDir = path.join(repoRoot, "openspec", "changes", change, "issues");
  if (!fs.existsSync(issuesDir)) {
    return [];
  }

  return fs.readdirSync(issuesDir)
    .filter((name) => name.endsWith(".progress.json"))
    .flatMap((name) => {
      const progress = readJson(path.join(issuesDir, name));
      if (progress.status !== "completed" || String(progress.boundary_status ?? "").trim() !== "accepted") {
        return [];
      }
      return [issueProgressId(name, progress)];
    })
    .filter(Boolean)
    .sort();
}

function isGitWorktreeRoot(repoRoot: string, targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) {
    return false;
  }
  const process = runCommand(["git", "-C", targetPath, "rev-parse", "--show-toplevel"], repoRoot, false);
  return process.status === 0 && canonicalPath(process.stdout.trim()) === canonicalPath(targetPath);
}

function changeWorktreeDiff(repoRoot: string, change: string, config: IssueModeConfig) {
  const scope = String(config.worker_worktree.scope ?? "shared").trim() || "shared";
  if (!config.worker_worktree.enabled || scope !== "change") {
    return {
      changedFiles: [],
      worktree: "",
      worktreeRelative: "",
    };
  }

  const worktreeRelative = path.posix.join(config.worktree_root.replace(/\\/g, "/"), change);
  const worktree = resolveRepoPath(repoRoot, worktreeRelative);
  if (!isGitWorktreeRoot(repoRoot, worktree)) {
    return {
      changedFiles: [],
      worktree,
      worktreeRelative: displayPath(repoRoot, worktree),
    };
  }

  const patch = buildWorkerPatch(repoRoot, worktree);
  return {
    changedFiles: patch.changedFiles,
    worktree,
    worktreeRelative: displayPath(repoRoot, worktree),
  };
}

function deferredArchiveMerge(repoRoot: string, change: string, config: IssueModeConfig): DeferredArchiveMerge {
  const issueIds = acceptedIssueIds(repoRoot, change);
  const worktreeDiff = changeWorktreeDiff(repoRoot, change, config);
  const reasons: string[] = [];
  if (issueIds.length > 0) {
    reasons.push("accepted issue work is still deferred");
  }
  if (worktreeDiff.changedFiles.length > 0) {
    reasons.push("change worktree still differs from the coordinator root");
  }
  const required = reasons.length > 0;

  if (!required) {
    return emptyDeferredArchiveMerge(change);
  }

  const requiredCommand = issueIds.length > 0 ? mergeChangeCommand(change) : "";
  const requiredAction = requiredCommand
    ? `Run ${requiredCommand}, rerun ${reconcileStatusCommand(change)}, then archive with openspec-extensions archive change.`
    : `Merge the change worktree into the coordinator repo root, rerun ${reconcileStatusCommand(change)}, then archive with openspec-extensions archive change.`;

  return {
    changedFiles: worktreeDiff.changedFiles,
    issueIds,
    reason: reasons.join("; "),
    required,
    requiredAction,
    requiredCommand,
    statusCommand: reconcileStatusCommand(change),
    worktree: worktreeDiff.worktree,
    worktreeRelative: worktreeDiff.worktreeRelative,
  };
}

function ensureNoDeferredArchiveMerge(pendingMerge: DeferredArchiveMerge, change: string): DeferredArchiveMerge {
  if (!pendingMerge.required) {
    return pendingMerge;
  }

  // 归档会清理 worktree，必须先把实现落回主工作区。
  throw new Error(
    `Change ${change} is not ready for archive: ${pendingMerge.reason}. ` +
    `${pendingMerge.requiredAction} Do not run raw openspec archive directly.`
  );
}

function addCleanupTarget(
  targets: Map<string, CleanupTarget>,
  repoRoot: string,
  target: {
    branchName?: string;
    issueId?: string;
    scope: "change" | "issue" | "shared";
    source: "config_default" | "issue_doc";
    worktree: string;
    worktreeRelative: string;
  }
): void {
  if (target.scope === "shared") {
    return;
  }
  if (path.resolve(target.worktree) === path.resolve(repoRoot)) {
    return;
  }

  const key = canonicalPath(target.worktree);
  let current = targets.get(key);
  if (!current) {
    current = {
      branchNames: [],
      issueIds: [],
      scope: target.scope,
      source: target.source,
      worktree: target.worktree,
      worktreeRelative: target.worktreeRelative,
    };
    targets.set(key, current);
  }

  if (target.issueId && !current.issueIds.includes(target.issueId)) {
    current.issueIds.push(target.issueId);
  }
  if (target.branchName && !current.branchNames.includes(target.branchName)) {
    current.branchNames.push(target.branchName);
  }
}

function collectCleanupTargets(repoRoot: string, change: string, config: IssueModeConfig): CleanupTarget[] {
  const targets = new Map<string, CleanupTarget>();
  const issueIds = issueDocIds(repoRoot, change);

  for (const issueId of issueIds) {
    const [worktreePath, worktreeRelative, source] = issueWorkerWorktreePath(repoRoot, change, issueId, config);
    const scope = inferWorkerWorktreeScope(repoRoot, worktreePath, config, change, issueId);
    addCleanupTarget(targets, repoRoot, {
      branchName:
        String(config.worker_worktree.mode ?? "").trim() === "branch"
          ? workerBranchName(config, change, issueId, scope)
          : "",
      issueId,
      scope,
      source,
      worktree: worktreePath,
      worktreeRelative: worktreeRelative,
    });
  }

  const scope = String(config.worker_worktree.scope ?? "shared").trim() || "shared";
  if (config.worker_worktree.enabled && scope === "change") {
    const worktreeRelative = path.posix.join(config.worktree_root.replace(/\\/g, "/"), change);
    const worktreePath = resolveRepoPath(repoRoot, worktreeRelative);
    addCleanupTarget(targets, repoRoot, {
      branchName:
        String(config.worker_worktree.mode ?? "").trim() === "branch" ? changeBranchName(config, change) : "",
      scope: "change",
      source: "config_default",
      worktree: worktreePath,
      worktreeRelative: displayPath(repoRoot, worktreePath),
    });
  }

  return [...targets.values()].sort((left, right) => left.worktreeRelative.localeCompare(right.worktreeRelative));
}

function cleanupChangeWorktree(repoRoot: string, change: string, config: IssueModeConfig, dryRun: boolean) {
  const targets = collectCleanupTargets(repoRoot, change, config);
  if (targets.length === 0) {
    return {
      required: false,
      worktree: "",
      removed: false,
      registered: false,
      branch_deleted: false,
      targets: [],
    };
  }

  const entries = targets.map((target) => {
    const existedBefore = fs.existsSync(target.worktree);
    const registeredBefore = worktreeIsRegistered(repoRoot, target.worktree);
    const branchNames = [...target.branchNames];
    const branchesExistedBefore = branchNames.filter((branchName) => branchExists(repoRoot, branchName));

    return {
      branch_deleted: false,
      branch_names: branchNames,
      branch_names_existing: branchesExistedBefore,
      exists: existedBefore,
      issue_ids: [...target.issueIds],
      registered: registeredBefore,
      removed: dryRun ? existedBefore || registeredBefore : false,
      scope: target.scope,
      source: target.source,
      worktree: target.worktree,
      worktree_relative: target.worktreeRelative,
    };
  });

  if (dryRun) {
    return {
      required: true,
      worktree: targets.length === 1 ? targets[0]?.worktree ?? "" : "",
      removed: entries.some((entry) => entry.removed),
      registered: entries.some((entry) => entry.registered),
      branch_deleted: entries.some((entry) => entry.branch_names_existing.length > 0),
      targets: entries,
    };
  }

  let shouldPrune = false;
  for (const entry of entries) {
    if (entry.registered && entry.exists) {
      runCommand(["git", "worktree", "remove", "--force", entry.worktree], repoRoot);
      shouldPrune = true;
      continue;
    }
    if (entry.exists) {
      fs.rmSync(entry.worktree, { recursive: true, force: true });
    }
    if (entry.registered) {
      shouldPrune = true;
    }
  }

  if (shouldPrune) {
    runCommand(["git", "worktree", "prune"], repoRoot);
  }

  for (const entry of entries) {
    const existsAfter = fs.existsSync(entry.worktree);
    const registeredAfter = worktreeIsRegistered(repoRoot, entry.worktree);
    entry.removed = !existsAfter && !registeredAfter && (entry.exists || entry.registered);
  }

  for (const entry of entries) {
    for (const branchName of entry.branch_names_existing) {
      if (branchExists(repoRoot, branchName)) {
        runCommand(["git", "branch", "-D", branchName], repoRoot);
      }
    }
    entry.branch_deleted = entry.branch_names_existing.length > 0
      && entry.branch_names_existing.every((branchName) => !branchExists(repoRoot, branchName));
  }

  return {
    required: true,
    worktree: targets.length === 1 ? targets[0]?.worktree ?? "" : "",
    removed: entries.some((entry) => entry.removed),
    registered: entries.some((entry) => entry.registered),
    branch_deleted: entries.some((entry) => entry.branch_deleted),
    targets: entries,
  };
}

export function archiveChange(args: ParsedArchiveArgs) {
  const config = loadIssueModeConfig(args.repoRoot);
  const archiveCommand = args.archiveCommand.trim() || `openspec archive "${args.change}"`;
  const pendingMerge = deferredArchiveMerge(args.repoRoot, args.change, config);
  const result: Record<string, unknown> = {
    archive_allowed: !pendingMerge.required,
    change: args.change,
    archive_command: archiveCommand,
    dry_run: args.dryRun,
    pending_merge: pendingMerge,
    cleanup_skipped: args.skipCleanup
  };

  if (args.dryRun) {
    result.archived = false;
    result.cleanup = cleanupChangeWorktree(args.repoRoot, args.change, config, true);
    return result;
  }

  ensureNoDeferredArchiveMerge(pendingMerge, args.change);
  const archiveProcess = runShell(archiveCommand, args.repoRoot);
  result.archived = true;
  result.archive_stdout = archiveProcess.stdout.trim();
  result.archive_stderr = archiveProcess.stderr.trim();
  result.cleanup = args.skipCleanup
    ? {
        required: false,
        worktree: "",
        removed: false,
        registered: false,
        branch_deleted: false
      }
    : cleanupChangeWorktree(args.repoRoot, args.change, config, false);
  return result;
}

export function runArchiveCommand(argv: string[]): number {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === "-h" || subcommand === "--help") {
    process.stdout.write(ARCHIVE_HELP_TEXT);
    return 0;
  }
  if (subcommand !== "change") {
    throw new Error(`Unknown archive command: ${subcommand}`);
  }

  const parsed = parseChangeArgs(rest);
  if (!parsed) {
    return 0;
  }
  process.stdout.write(`${JSON.stringify(archiveChange(parsed), null, 2)}\n`);
  return 0;
}
