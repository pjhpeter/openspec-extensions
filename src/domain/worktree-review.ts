import path from "node:path";
import { createHash } from "node:crypto";

import {
  artifactIsCurrent,
  buildReviewScope,
  type JsonRecord,
  type ReviewScope,
} from "./change-coordinator";
import {
  inferWorkerWorktreeScope,
  issueWorkerWorktreePath,
  loadIssueModeConfig,
} from "./issue-mode";
import {
  buildUntrackedPatch,
  ensureNoUnmerged,
  gitBinaryOutput,
  gitOutput,
  gitStatusLines,
  mergeBase,
  untrackedFiles,
} from "../git/merge";

const REVIEW_EXCLUDED_PATH = "openspec/changes";

type DeferredWorktreeScope = {
  issue_ids: string[];
  scope: ReviewScope;
  worker_worktree: string;
  worker_worktree_relative: string;
};

function splitNullOutput(data: Buffer): string[] {
  return data
    .toString("utf8")
    .split("\u0000")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueSortedPaths(paths: string[]): string[] {
  return [...new Set(paths.map((item) => item.trim()).filter(Boolean))].sort();
}

function reviewPathspecArgs(): string[] {
  return ["--", ".", `:(exclude)${REVIEW_EXCLUDED_PATH}/**`];
}

function isReviewExcludedPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized === REVIEW_EXCLUDED_PATH || normalized.startsWith(`${REVIEW_EXCLUDED_PATH}/`);
}

function patchFingerprint(patch: Buffer): string {
  return createHash("sha256").update(patch).digest("hex");
}

function hashReviewScope(baseRevision: string, upstreamRef: string, patch: Buffer): string {
  return createHash("sha256")
    .update(`upstream:${upstreamRef}\nbase:${baseRevision}\n`)
    .update(patch)
    .digest("hex");
}

function readScopeFingerprint(artifact: JsonRecord, field: "fingerprint" | "patch_fingerprint"): string {
  const reviewScope = artifact.review_scope;
  if (!reviewScope || typeof reviewScope !== "object" || Array.isArray(reviewScope)) {
    return "";
  }
  return String((reviewScope as JsonRecord)[field] ?? "").trim();
}

function deferredAcceptedIssueIds(issues: JsonRecord[]): string[] {
  return issues
    .filter((issue) =>
      String(issue.status ?? "").trim() === "completed" &&
      String(issue.boundary_status ?? "").trim() === "accepted"
    )
    .map((issue) => String(issue.issue_id ?? "").trim())
    .filter(Boolean)
    .sort();
}

function buildWorktreeReviewScope(
  repoRoot: string,
  workerWorktree: string,
  workerDisplay: string,
  issueIds: string[]
): ReviewScope {
  const rootHead = gitOutput(repoRoot, "rev-parse", "HEAD");
  const workerHead = gitOutput(workerWorktree, "rev-parse", "HEAD");
  const workerStatusLines = gitStatusLines(workerWorktree);
  ensureNoUnmerged(workerStatusLines, "Worker worktree");

  const baseRevision = mergeBase(repoRoot, rootHead, workerHead);
  const trackedPatch = gitBinaryOutput(workerWorktree, "diff", "--binary", "--find-renames", baseRevision, ...reviewPathspecArgs());
  const trackedFiles = splitNullOutput(
    gitBinaryOutput(workerWorktree, "diff", "--name-only", "-z", "--find-renames", baseRevision, ...reviewPathspecArgs())
  );
  const allUntrackedFiles = untrackedFiles(workerWorktree);
  const includedUntrackedFiles = allUntrackedFiles.filter((currentPath) => !isReviewExcludedPath(currentPath));
  const excludedUntrackedFiles = allUntrackedFiles.filter((currentPath) => isReviewExcludedPath(currentPath));
  const excludedTrackedFiles = splitNullOutput(
    gitBinaryOutput(workerWorktree, "diff", "--name-only", "-z", "--find-renames", baseRevision, "--", REVIEW_EXCLUDED_PATH)
  );
  const patch = Buffer.concat([trackedPatch, buildUntrackedPatch(workerWorktree, includedUntrackedFiles)]);
  const upstreamRef = `worker:${workerDisplay}`;

  return {
    upstream_ref: upstreamRef,
    base_revision: baseRevision,
    head_revision: workerHead,
    patch,
    changed_files: uniqueSortedPaths([...trackedFiles, ...includedUntrackedFiles]),
    excluded_changed_files: uniqueSortedPaths([...excludedTrackedFiles, ...excludedUntrackedFiles]),
    has_reviewable_changes: patch.length > 0,
    fingerprint: hashReviewScope(baseRevision, upstreamRef, patch),
    patch_fingerprint: patchFingerprint(patch),
    scope_source: "worker_worktree",
    worker_worktree: workerWorktree,
    worker_worktree_relative: workerDisplay,
    workspace_scope: "change",
    issue_ids: issueIds,
  };
}

export function deferredChangeWorktreeReviewScope(
  repoRoot: string,
  change: string,
  issues: JsonRecord[]
): DeferredWorktreeScope | null {
  const issueIds = deferredAcceptedIssueIds(issues);
  if (issueIds.length === 0) {
    return null;
  }

  const config = loadIssueModeConfig(repoRoot);
  const firstIssueId = issueIds[0] as string;
  const [workerWorktree, workerDisplay] = issueWorkerWorktreePath(repoRoot, change, firstIssueId, config);
  const workspaceScope = inferWorkerWorktreeScope(repoRoot, workerWorktree, config, change, firstIssueId);
  if (workspaceScope !== "change") {
    return null;
  }

  return {
    issue_ids: issueIds,
    scope: buildWorktreeReviewScope(repoRoot, workerWorktree, workerDisplay, issueIds),
    worker_worktree: workerWorktree,
    worker_worktree_relative: workerDisplay,
  };
}

export function buildChangeReviewScope(repoRoot: string, change: string, issues: JsonRecord[]): ReviewScope {
  const deferredScope = deferredChangeWorktreeReviewScope(repoRoot, change, issues);
  if (deferredScope) {
    return deferredScope.scope;
  }

  const scope = buildReviewScope(repoRoot);
  return {
    ...scope,
    patch_fingerprint: scope.patch_fingerprint || patchFingerprint(scope.patch),
    scope_source: "coordinator_branch",
  };
}

export function changeValidationRoot(repoRoot: string, change: string, issues: JsonRecord[]): string {
  return deferredChangeWorktreeReviewScope(repoRoot, change, issues)?.worker_worktree ?? repoRoot;
}

export function changeArtifactIsCurrent(
  repoRoot: string,
  change: string,
  issues: JsonRecord[],
  artifact: JsonRecord
): boolean {
  if (!artifactIsCurrent(issues, artifact)) {
    return false;
  }

  const fingerprint = readScopeFingerprint(artifact, "fingerprint");
  const artifactPatchFingerprint = readScopeFingerprint(artifact, "patch_fingerprint");
  if (!fingerprint && !artifactPatchFingerprint) {
    return true;
  }

  try {
    const currentScope = buildChangeReviewScope(repoRoot, change, issues);
    // worktree 合并后 base/upstream 会变，只能用 patch 指纹延续验收结论。
    return Boolean(fingerprint && currentScope.fingerprint === fingerprint) ||
      Boolean(artifactPatchFingerprint && currentScope.patch_fingerprint === artifactPatchFingerprint);
  } catch {
    return false;
  }
}

export function relativeValidationRoot(repoRoot: string, validationRoot: string): string {
  const relativePath = path.relative(repoRoot, validationRoot).split(path.sep).join("/");
  return relativePath || ".";
}
