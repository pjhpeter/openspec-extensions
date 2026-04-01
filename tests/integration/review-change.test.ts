import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { reviewChange } from "../../src/commands/review";

function withTempDir(run: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-review-change-"));
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
  - pnpm lint
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

test("reviewChange writes passed review artifact", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    writeIssueProgress(repoRoot, "demo-change", "completed");

    const payload = reviewChange({
      change: "demo-change",
      dryRun: false,
      repoRoot,
      reviewCommand: "printf 'VERDICT: pass\\n'"
    }) as { status: string; verdict: string };
    const artifact = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "openspec", "changes", "demo-change", "runs", "CHANGE-REVIEW.json"),
      "utf8"
    )) as { status: string };

    assert.equal(payload.status, "passed");
    assert.equal(payload.verdict, "pass");
    assert.equal(artifact.status, "passed");
  });
});

test("reviewChange refuses review when issues are incomplete", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    writeIssueProgress(repoRoot, "demo-change", "in_progress");

    const payload = reviewChange({
      change: "demo-change",
      dryRun: false,
      repoRoot,
      reviewCommand: "printf 'VERDICT: pass\\n'"
    }) as { status: string; summary: string };
    const artifact = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "openspec", "changes", "demo-change", "runs", "CHANGE-REVIEW.json"),
      "utf8"
    )) as { status: string };

    assert.equal(payload.status, "failed");
    assert.match(payload.summary, /not completed/);
    assert.equal(artifact.status, "failed");
  });
});
