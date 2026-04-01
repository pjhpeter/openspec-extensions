import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TextDecoder } from "node:util";

import { runUpdateProgressCommand } from "../../src/commands/execute/update-progress";

function makeTempRepoRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openspec-update-progress-"));
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function captureStdout(run: () => number): { exitCode: number; stdout: string } {
  const originalWrite = process.stdout.write;
  let stdout = "";

  process.stdout.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    if (typeof chunk === "string") {
      stdout += chunk;
    } else if (chunk instanceof Uint8Array) {
      stdout += new TextDecoder("utf8").decode(chunk);
    } else {
      stdout += String(chunk);
    }

    const callback = rest.find((value) => typeof value === "function") as ((error?: Error | null) => void) | undefined;
    if (callback) {
      callback();
    }
    return true;
  }) as typeof process.stdout.write;

  try {
    return { exitCode: run(), stdout };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function progressPath(repoRoot: string, change: string, issueId: string): string {
  return path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.progress.json`);
}

function runPath(repoRoot: string, change: string, runId: string): string {
  return path.join(repoRoot, "openspec", "changes", change, "runs", `${runId}.json`);
}

test("creates progress and run artifacts with explicit run id", () => {
  const repoRoot = makeTempRepoRoot();
  const change = "demo-change";
  const issueId = "ISSUE-001";
  const explicitRunId = "RUN-EXPLICIT-ISSUE-001";

  const { exitCode, stdout } = captureStdout(() =>
    runUpdateProgressCommand([
      "start",
      "--repo-root", repoRoot,
      "--change", change,
      "--issue-id", issueId,
      "--run-id", explicitRunId,
      "--status", "in_progress",
      "--boundary-status", "working",
      "--next-action", "continue_issue",
      "--summary", "started",
      "--blocker", "",
      "--validation", "lint=passed",
      "--validation", "type-check=passed",
      "--changed-file", "src/a.ts",
      "--changed-file", "src/b.ts"
    ])
  );
  assert.equal(exitCode, 0);

  const payload = JSON.parse(stdout.trim()) as Record<string, string>;
  assert.equal(payload.run_id, explicitRunId);
  assert.equal(payload.progress_path, `openspec/changes/${change}/issues/${issueId}.progress.json`);
  assert.equal(payload.run_path, `openspec/changes/${change}/runs/${explicitRunId}.json`);

  const progress = readJson(progressPath(repoRoot, change, issueId));
  const run = readJson(runPath(repoRoot, change, explicitRunId));

  assert.equal(progress.change, change);
  assert.equal(progress.issue_id, issueId);
  assert.equal(progress.status, "in_progress");
  assert.equal(progress.boundary_status, "working");
  assert.equal(progress.next_action, "continue_issue");
  assert.equal(progress.summary, "started");
  assert.deepEqual(progress.validation, { lint: "passed", "type-check": "passed" });
  assert.deepEqual(progress.changed_files, ["src/a.ts", "src/b.ts"]);
  assert.equal(progress.run_id, explicitRunId);
  assert.match(String(progress.updated_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);

  assert.equal(run.run_id, explicitRunId);
  assert.equal(run.issue_id, issueId);
  assert.equal(run.latest_event, "start");
  assert.deepEqual(run.validation, { lint: "passed", "type-check": "passed" });
});

test("updates existing artifact by reusing latest run id when run id is omitted", () => {
  const repoRoot = makeTempRepoRoot();
  const change = "demo-change";
  const issueId = "ISSUE-001";
  const runIdA = "RUN-20260101T120000-ISSUE-001";
  const runIdB = "RUN-20260102T120000-ISSUE-001";

  const runsDir = path.join(repoRoot, "openspec", "changes", change, "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(runPath(repoRoot, change, runIdA), JSON.stringify({ run_id: runIdA }, null, 2));
  fs.writeFileSync(runPath(repoRoot, change, runIdB), JSON.stringify({ run_id: runIdB, keep: "x" }, null, 2));

  const { stdout } = captureStdout(() =>
    runUpdateProgressCommand([
      "checkpoint",
      "--repo-root", repoRoot,
      "--change", change,
      "--issue-id", issueId,
      "--status", "in_progress",
      "--summary", "checkpoint reached",
      "--changed-file", "src/checkpoint.ts"
    ])
  );
  const payload = JSON.parse(stdout.trim()) as Record<string, string>;
  assert.equal(payload.run_id, runIdB);

  const run = readJson(runPath(repoRoot, change, runIdB));
  assert.equal(run.run_id, runIdB);
  assert.equal(run.latest_event, "checkpoint");
  assert.equal(run.summary, "checkpoint reached");
  assert.equal(run.keep, "x");
});

test("generates default run id when no previous run exists", () => {
  const repoRoot = makeTempRepoRoot();
  const change = "demo-change";
  const issueId = "ISSUE-009";

  const { stdout } = captureStdout(() =>
    runUpdateProgressCommand([
      "start",
      "--repo-root", repoRoot,
      "--change", change,
      "--issue-id", issueId,
      "--status", "in_progress",
      "--summary", "new run"
    ])
  );
  const payload = JSON.parse(stdout.trim()) as Record<string, string>;
  assert.match(payload.run_id, /^RUN-\d{8}T\d{6}-ISSUE-009$/);

  const generatedRunPath = runPath(repoRoot, change, payload.run_id);
  assert.equal(fs.existsSync(generatedRunPath), true);
});

test("preserves existing fields when updating progress JSON object", () => {
  const repoRoot = makeTempRepoRoot();
  const change = "demo-change";
  const issueId = "ISSUE-123";
  const runId = "RUN-EXISTING-ISSUE-123";
  const issueProgressPath = progressPath(repoRoot, change, issueId);

  fs.mkdirSync(path.dirname(issueProgressPath), { recursive: true });
  fs.writeFileSync(issueProgressPath, JSON.stringify({ extra_field: "keep-me" }, null, 2));

  captureStdout(() =>
    runUpdateProgressCommand([
      "stop",
      "--repo-root", repoRoot,
      "--change", change,
      "--issue-id", issueId,
      "--run-id", runId,
      "--status", "completed",
      "--boundary-status", "review_required",
      "--next-action", "coordinator_review",
      "--summary", "done"
    ])
  );

  const progress = readJson(issueProgressPath);
  assert.equal(progress.extra_field, "keep-me");
  assert.equal(progress.status, "completed");
  assert.equal(progress.boundary_status, "review_required");
});

test("fails on invalid validation entry", () => {
  const repoRoot = makeTempRepoRoot();

  assert.throws(
    () =>
      runUpdateProgressCommand([
        "start",
        "--repo-root", repoRoot,
        "--change", "demo-change",
        "--issue-id", "ISSUE-001",
        "--status", "in_progress",
        "--summary", "bad validation",
        "--validation", "lint"
      ]),
    /Invalid validation entry: lint/
  );
});
