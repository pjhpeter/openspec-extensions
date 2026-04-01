import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { parseArgs } from "node:util";

import { loadIssueModeConfig, type IssueModeConfig } from "../domain/issue-mode";
import { resolveRepoPath } from "../utils/path";

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

function cleanupChangeWorktree(repoRoot: string, change: string, config: IssueModeConfig, dryRun: boolean) {
  const scope = String(config.worker_worktree.scope ?? "shared").trim() || "shared";
  if (scope !== "change") {
    return {
      required: false,
      worktree: "",
      removed: false,
      registered: false,
      branch_deleted: false
    };
  }

  const worktreePath = resolveRepoPath(repoRoot, path.posix.join(config.worktree_root.replace(/\\/g, "/"), change));
  const exists = fs.existsSync(worktreePath);
  const registered = exists ? worktreeIsRegistered(repoRoot, worktreePath) : false;
  if (dryRun) {
    return {
      required: true,
      worktree: worktreePath,
      removed: exists,
      registered,
      branch_deleted: false
    };
  }

  let removed = false;
  if (registered) {
    runCommand(["git", "worktree", "remove", "--force", worktreePath], repoRoot);
    runCommand(["git", "worktree", "prune"], repoRoot);
    removed = true;
  } else if (exists) {
    fs.rmSync(worktreePath, { recursive: true, force: true });
    removed = true;
  }

  let branchDeleted = false;
  if (String(config.worker_worktree.mode ?? "").trim() === "branch") {
    const branchName = changeBranchName(config, change);
    if (branchExists(repoRoot, branchName)) {
      runCommand(["git", "branch", "-D", branchName], repoRoot);
      branchDeleted = true;
    }
  }

  return {
    required: true,
    worktree: worktreePath,
    removed,
    registered,
    branch_deleted: branchDeleted
  };
}

export function archiveChange(args: ParsedArchiveArgs) {
  const config = loadIssueModeConfig(args.repoRoot);
  const archiveCommand = args.archiveCommand.trim() || `openspec archive "${args.change}"`;
  const result: Record<string, unknown> = {
    change: args.change,
    archive_command: archiveCommand,
    dry_run: args.dryRun,
    cleanup_skipped: args.skipCleanup
  };

  if (args.dryRun) {
    result.archived = false;
    result.cleanup = cleanupChangeWorktree(args.repoRoot, args.change, config, true);
    return result;
  }

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
