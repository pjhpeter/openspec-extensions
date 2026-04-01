import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  ensureIssueDispatchAllowed,
  inferWorkerWorktreeScope,
  isSharedWorkerWorkspace,
  issueWorkerWorktreePath,
  loadIssueModeConfig,
  readChangeControlState,
  workerBranchName,
} from "../domain/issue-mode";
import { runGitCommand } from "../git/command";

const WORKTREE_HELP_TEXT = `Usage:
  openspec-extensions worktree create --repo-root <path> --change <change> --issue-id <issue> [--mode <detach|branch>] [--base-ref <ref>] [--branch-name <name>] [--dry-run]
`;

type ParsedCreateArgs = {
  baseRef: string;
  branchName: string;
  change: string;
  dryRun: boolean;
  issueId: string;
  mode: "" | "branch" | "detach";
  repoRoot: string;
};

function parseCreateArgs(argv: string[]): ParsedCreateArgs | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      "base-ref": { type: "string", default: "" },
      "branch-name": { type: "string", default: "" },
      change: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { short: "h", type: "boolean", default: false },
      "issue-id": { type: "string" },
      mode: { type: "string", default: "" },
      "repo-root": { type: "string" },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(WORKTREE_HELP_TEXT);
    return null;
  }
  if (!values["repo-root"] || !values.change || !values["issue-id"]) {
    throw new Error("Missing required options: --repo-root, --change, --issue-id");
  }

  const mode = String(values.mode ?? "").trim();
  if (mode && mode !== "detach" && mode !== "branch") {
    throw new Error("`--mode` must be `detach` or `branch`.");
  }

  return {
    baseRef: values["base-ref"],
    branchName: values["branch-name"],
    change: values.change,
    dryRun: values["dry-run"],
    issueId: values["issue-id"],
    mode: mode as ParsedCreateArgs["mode"],
    repoRoot: path.resolve(values["repo-root"]),
  };
}

function canonicalPath(targetPath: string): string {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function worktreeExists(targetPath: string): boolean {
  const result = runGitCommand(["-C", targetPath, "rev-parse", "--show-toplevel"], { check: false });
  return result.exitCode === 0 && canonicalPath(result.stdout.trim()) === canonicalPath(targetPath);
}

export function createWorkerWorktree(args: ParsedCreateArgs): Record<string, unknown> {
  const config = loadIssueModeConfig(args.repoRoot);
  const controlState = readChangeControlState(args.repoRoot, args.change);
  const dispatchGate = ensureIssueDispatchAllowed(config, controlState, args.issueId);
  const [worktreePath, worktreeRelative, worktreeSource] = issueWorkerWorktreePath(
    args.repoRoot,
    args.change,
    args.issueId,
    config
  );
  const workspaceScope = inferWorkerWorktreeScope(args.repoRoot, worktreePath, config, args.change, args.issueId);

  let mode: "branch" | "detach" | "shared" = args.mode || config.worker_worktree.mode;
  let baseRef = args.baseRef || config.worker_worktree.base_ref;
  let branchName = args.branchName.trim();
  const sharedWorkspace = isSharedWorkerWorkspace(args.repoRoot, worktreePath);
  if (sharedWorkspace) {
    mode = "shared";
    baseRef = "";
    branchName = "";
  }
  if (mode === "branch" && !branchName) {
    branchName = workerBranchName(config, args.change, args.issueId, workspaceScope);
  }

  let existed = false;
  let created = false;
  if (sharedWorkspace) {
    existed = true;
  } else if (fs.existsSync(worktreePath)) {
    if (worktreeExists(worktreePath)) {
      existed = true;
    } else if (fs.statSync(worktreePath).isDirectory() && fs.readdirSync(worktreePath).length === 0) {
      existed = false;
    } else {
      throw new Error(`Target path exists but is not an empty git worktree: ${worktreePath}`);
    }
  }

  if (!sharedWorkspace && !existed && !args.dryRun) {
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    const command =
      mode === "detach"
        ? ["-C", args.repoRoot, "worktree", "add", "--detach", worktreePath, baseRef]
        : ["-C", args.repoRoot, "worktree", "add", "-b", branchName, worktreePath, baseRef];
    runGitCommand(command);
    created = true;
  }

  return {
    change: args.change,
    issue_id: args.issueId,
    worktree: worktreePath,
    worktree_relative: worktreeRelative,
    worktree_source: worktreeSource,
    workspace_scope: workspaceScope,
    control_gate: dispatchGate,
    config_path: config.config_path,
    config_exists: config.config_exists,
    mode,
    base_ref: baseRef,
    branch_name: branchName,
    shared_workspace: sharedWorkspace,
    created,
    existed,
    dry_run: args.dryRun,
  };
}

export function runWorktreeCommand(argv: string[]): number {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === "-h" || subcommand === "--help") {
    process.stdout.write(WORKTREE_HELP_TEXT);
    return 0;
  }
  if (subcommand !== "create") {
    throw new Error(`Unknown worktree command: ${subcommand}`);
  }

  const parsed = parseCreateArgs(rest);
  if (!parsed) {
    return 0;
  }

  process.stdout.write(`${JSON.stringify(createWorkerWorktree(parsed), null, 2)}\n`);
  return 0;
}
