import fs from "node:fs";
import path from "node:path";

import { extractStatusPaths, syncTasksForIssues, type JsonRecord } from "../domain/change-coordinator";
import { runGitBinaryCommand, runGitCommand } from "./command";

const UNMERGED_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function canonicalPath(targetPath: string): string {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

export function gitOutput(repoRoot: string, ...args: string[]): string {
  return runGitCommand(args, { cwd: repoRoot }).stdout.trim();
}

export function gitBinaryOutput(repoRoot: string, ...args: string[]): Buffer {
  return runGitBinaryCommand(args, { cwd: repoRoot }).stdout;
}

export function gitStatusLines(repoRoot: string): string[] {
  return gitOutput(repoRoot, "status", "--porcelain")
    .split(/\r?\n/)
    .filter((line) => line.trim());
}

function isIgnoredTargetStatus(line: string, ignoredPrefixes: string[]): boolean {
  const paths = extractStatusPaths(line);
  if (paths.length === 0) {
    return false;
  }
  return paths.every((currentPath) => {
    const normalized = currentPath.replace(/\\/g, "/").replace(/^[./]+/, "");
    return ignoredPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  });
}

export function ensureNoUnmerged(statusLines: string[], label: string): void {
  for (const line of statusLines) {
    const code = line.slice(0, 2);
    if (UNMERGED_STATUSES.has(code) || code.includes("U")) {
      throw new Error(`${label} has unresolved merge state: ${line}`);
    }
  }
}

export function ensureCleanTarget(repoRoot: string, ignoredPrefixes: string[]): void {
  const statusLines = gitStatusLines(repoRoot);
  ensureNoUnmerged(statusLines, "Coordinator worktree");
  const remaining = statusLines.filter((line) => !isIgnoredTargetStatus(line, ignoredPrefixes));
  if (remaining.length > 0) {
    throw new Error("Coordinator worktree must be clean before merge helper runs.");
  }
}

export function ensureWorkerExists(targetPath: string): void {
  const result = runGitCommand(["-C", targetPath, "rev-parse", "--show-toplevel"], {
    check: false,
  });
  if (result.exitCode !== 0 || canonicalPath(result.stdout.trim()) !== canonicalPath(targetPath)) {
    throw new Error(`Worker worktree not found or not a git worktree: ${targetPath}`);
  }
}

function splitNullOutput(data: Buffer): string[] {
  return data
    .toString("utf8")
    .split("\u0000")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const currentPath of paths) {
    const value = currentPath.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function untrackedFiles(repoRoot: string): string[] {
  return splitNullOutput(
    runGitBinaryCommand(["ls-files", "-z", "--others", "--exclude-standard"], {
      cwd: repoRoot,
    }).stdout
  );
}

export function buildUntrackedPatch(repoRoot: string, paths: string[]): Buffer {
  const patches: Buffer[] = [];
  for (const relativePath of paths) {
    const candidate = path.join(repoRoot, relativePath);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      continue;
    }
    const result = runGitBinaryCommand(["diff", "--binary", "--no-index", "--", "/dev/null", relativePath], {
      check: false,
      cwd: repoRoot,
      okCodes: [0, 1],
    });
    if (result.exitCode === 1 && result.stdout.length > 0) {
      patches.push(result.stdout);
    }
  }
  return Buffer.concat(patches);
}

export function mergeBase(repoRoot: string, left: string, right: string): string {
  return gitOutput(repoRoot, "merge-base", left, right);
}

export function buildWorkerPatch(
  repoRoot: string,
  workerWorktree: string
): {
  baseRevision: string;
  changedFiles: string[];
  patch: Buffer;
  workerStatusLines: string[];
} {
  const rootHead = gitOutput(repoRoot, "rev-parse", "HEAD");
  const workerHead = gitOutput(workerWorktree, "rev-parse", "HEAD");
  const workerStatusLines = gitStatusLines(workerWorktree);
  ensureNoUnmerged(workerStatusLines, "Worker worktree");

  const baseRevision = mergeBase(repoRoot, rootHead, workerHead);
  const trackedPatch = gitBinaryOutput(workerWorktree, "diff", "--binary", "--find-renames", baseRevision);
  const trackedFiles = splitNullOutput(
    gitBinaryOutput(workerWorktree, "diff", "--name-only", "-z", "--find-renames", baseRevision)
  );
  const extraUntracked = untrackedFiles(workerWorktree);
  const patch = Buffer.concat([trackedPatch, buildUntrackedPatch(workerWorktree, extraUntracked)]);
  return {
    baseRevision,
    changedFiles: uniquePaths([...trackedFiles, ...extraUntracked]),
    patch,
    workerStatusLines,
  };
}

export function applyGitPatch(repoRoot: string, patch: Buffer): void {
  runGitCommand(["apply", "--index", "--3way"], {
    cwd: repoRoot,
    input: patch,
  });
}

export function currentTargetRef(repoRoot: string): string {
  return gitOutput(repoRoot, "rev-parse", "--abbrev-ref", "HEAD") || "HEAD";
}

export function stageAndCommit(repoRoot: string, commitMessage: string, repoRelativePaths: string[]): string {
  const stagedPaths = uniquePaths(repoRelativePaths);
  runGitCommand(["add", "-A", "--", ...stagedPaths], { cwd: repoRoot });
  runGitCommand(["commit", "-m", commitMessage], { cwd: repoRoot });
  return gitOutput(repoRoot, "rev-parse", "HEAD");
}

export function syncReusableWorkerWorkspace(workerWorktree: string, commitSha: string): void {
  runGitCommand(["reset", "--hard", commitSha], { cwd: workerWorktree });
  runGitCommand(["clean", "-fd"], { cwd: workerWorktree });
}

export function syncTasksAfterMerge(repoRoot: string, change: string, issueId: string): JsonRecord {
  return syncTasksForIssues(repoRoot, change, [issueId]);
}
