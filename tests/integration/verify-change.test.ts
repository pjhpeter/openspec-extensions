import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyChange } from "../../src/commands/verify";

function withTempDir(run: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-verify-change-"));
  try {
    run(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

function writeIssueDoc(repoRoot: string, change: string, issueId = "ISSUE-001"): void {
  const issuePath = path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.md`);
  fs.mkdirSync(path.dirname(issuePath), { recursive: true });
  fs.writeFileSync(issuePath, `---
issue_id: ${issueId}
title: Demo issue
worker_worktree: .worktree/${change}/${issueId}
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - complete demo issue
validation:
  - true
---
`);
}

function writeIssueProgress(repoRoot: string, change: string, status: string): void {
  const progressPath = path.join(repoRoot, "openspec", "changes", change, "issues", "ISSUE-001.progress.json");
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, JSON.stringify({
    issue_id: "ISSUE-001",
    status,
    updated_at: "2026-03-30T10:00:00+08:00"
  }, null, 2));
}

function writeIssueModeConfig(repoRoot: string): void {
  const configPath = path.join(repoRoot, "openspec", "issue-mode.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    validation_commands: ["true"]
  }, null, 2));
}

function writeChangeReviewArtifact(repoRoot: string, change: string): void {
  const reviewPath = path.join(repoRoot, "openspec", "changes", change, "runs", "CHANGE-REVIEW.json");
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  fs.writeFileSync(reviewPath, JSON.stringify({
    change,
    status: "passed",
    updated_at: "2026-03-30T10:05:00+08:00"
  }, null, 2));
}

test("verifyChange requires prior change review", () => {
  withTempDir((repoRoot) => {
    const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "");
    writeIssueDoc(repoRoot, "demo-change");
    writeIssueProgress(repoRoot, "demo-change", "completed");
    writeIssueModeConfig(repoRoot);

    const payload = verifyChange({
      change: "demo-change",
      dryRun: false,
      repoRoot
    }) as { status: string; summary: string };

    assert.equal(payload.status, "failed");
    assert.match(payload.summary, /\/review has not been run/);
  });
});

test("verifyChange passes after review and validation", () => {
  withTempDir((repoRoot) => {
    const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "");
    writeIssueDoc(repoRoot, "demo-change");
    writeIssueProgress(repoRoot, "demo-change", "completed");
    writeIssueModeConfig(repoRoot);
    writeChangeReviewArtifact(repoRoot, "demo-change");

    const payload = verifyChange({
      change: "demo-change",
      dryRun: false,
      repoRoot
    }) as {
      change_review: { current: boolean; status: string };
      status: string;
    };

    assert.equal(payload.status, "passed");
    assert.equal(payload.change_review.current, true);
    assert.equal(payload.change_review.status, "passed");
  });
});
