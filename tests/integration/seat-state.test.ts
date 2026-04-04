import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TextDecoder } from "node:util";

import { runSeatStateCommand } from "../../src/commands/execute/seat-state";

function makeTempRepoRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openspec-seat-state-"));
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

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

test("writes one seat file and updates the same file on repeated writes", () => {
  const repoRoot = makeTempRepoRoot();
  const change = "demo-change";
  const dispatchId = "DISPATCH-20260404T120000";

  const first = captureStdout(() =>
    runSeatStateCommand([
      "set",
      "--repo-root", repoRoot,
      "--change", change,
      "--dispatch-id", dispatchId,
      "--phase", "issue_execution",
      "--issue-id", "ISSUE-001",
      "--seat", "Checker 1",
      "--status", "running",
      "--agent-id", "agent-check",
      "--gate-bearing", "true",
      "--required", "true",
      "--reasoning-effort", "medium",
      "--checkpoint", "validation_started"
    ])
  );
  assert.equal(first.exitCode, 0);
  const payload = JSON.parse(first.stdout.trim()) as Record<string, string>;
  const targetPath = path.join(repoRoot, payload.seat_state_path);
  assert.equal(fs.existsSync(targetPath), true);

  captureStdout(() =>
    runSeatStateCommand([
      "set",
      "--repo-root", repoRoot,
      "--change", change,
      "--dispatch-id", dispatchId,
      "--phase", "issue_execution",
      "--issue-id", "ISSUE-001",
      "--seat", "Checker 1",
      "--status", "completed",
      "--agent-id", "agent-check"
    ])
  );

  const record = readJson(targetPath);
  assert.equal(record.status, "completed");
  assert.equal(record.seat_key, "checker-1");
  assert.equal(record.last_checkpoint, "validation_started");
  assert.match(String(record.completed_at), /^\d{4}-\d{2}-\d{2}T/);
});

test("terminal overwrite requires explicit flag", () => {
  const repoRoot = makeTempRepoRoot();

  captureStdout(() =>
    runSeatStateCommand([
      "set",
      "--repo-root", repoRoot,
      "--change", "demo-change",
      "--dispatch-id", "DISPATCH-20260404T120000",
      "--phase", "issue_execution",
      "--issue-id", "ISSUE-001",
      "--seat", "Reviewer 1",
      "--status", "failed",
      "--agent-id", "agent-review",
      "--gate-bearing", "true",
      "--required", "true",
      "--reasoning-effort", "medium",
      "--failure-kind", "validation",
      "--failure-message", "lint failed"
    ])
  );

  assert.throws(
    () =>
      runSeatStateCommand([
        "set",
        "--repo-root", repoRoot,
        "--change", "demo-change",
        "--dispatch-id", "DISPATCH-20260404T120000",
        "--phase", "issue_execution",
        "--issue-id", "ISSUE-001",
        "--seat", "Reviewer 1",
        "--status", "launching",
        "--agent-id", "agent-review-2"
      ]),
    /allow-terminal-overwrite/
  );
});
