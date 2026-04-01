import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import { reconcileChange } from "../../src/commands/reconcile";

function withTempDir(run: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-reconcile-"));
  try {
    run(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

function git(repoRoot: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function initGitRepo(repoRoot: string): void {
  git(repoRoot, "init");
  git(repoRoot, "config", "user.name", "Test User");
  git(repoRoot, "config", "user.email", "test@example.com");
}

function commitAll(repoRoot: string, message: string): void {
  git(repoRoot, "add", ".");
  git(repoRoot, "commit", "-m", message);
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
  - 完成 demo issue
validation:
  - pnpm lint
---
`);
}

function writeIssueProgress(
  repoRoot: string,
  change: string,
  options: {
    issueId?: string;
    status: string;
    boundaryStatus?: string | null;
    nextAction?: string;
    validation?: Record<string, string>;
    updatedAt?: string;
  }
): void {
  const issueId = options.issueId ?? "ISSUE-001";
  const progressPath = path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.progress.json`);
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, JSON.stringify({
    issue_id: issueId,
    status: options.status,
    boundary_status: options.boundaryStatus ?? (options.status === "completed" ? "accepted" : ""),
    next_action: options.nextAction ?? "",
    validation: options.validation ?? {},
    updated_at: options.updatedAt ?? "2026-03-30T10:00:00+08:00"
  }, null, 2));
}

function writeIssueModeConfig(repoRoot: string, payload: Record<string, unknown>): void {
  const configPath = path.join(repoRoot, "openspec", "issue-mode.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2));
}

function writeChangeReviewArtifact(repoRoot: string, change: string, status = "passed", updatedAt = "2026-03-30T10:05:00+08:00"): void {
  const reviewPath = path.join(repoRoot, "openspec", "changes", change, "runs", "CHANGE-REVIEW.json");
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  fs.writeFileSync(reviewPath, JSON.stringify({
    change,
    status,
    updated_at: updatedAt
  }, null, 2));
}

test("semi_auto requires manual confirmation before first dispatch", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    initGitRepo(repoRoot);
    commitAll(repoRoot, "commit planning docs");

    const payload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(payload.automation_profile, "semi_auto");
    assert.equal((payload.automation as Record<string, boolean>).accept_issue_review, true);
    assert.equal(payload.next_action, "await_issue_dispatch_confirmation");
    assert.equal(payload.recommended_issue_id, "ISSUE-001");
    assert.equal((payload.continuation_policy as Record<string, string>).mode, "await_human_confirmation");
    assert.equal((payload.continuation_policy as Record<string, boolean>).pause_allowed, true);
  });
});

test("default issue review auto_accepts validated issue", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change", "ISSUE-001");
    writeIssueProgress(repoRoot, "demo-change", {
      issueId: "ISSUE-001",
      status: "completed",
      boundaryStatus: "review_required",
      nextAction: "coordinator_review",
      validation: { "pnpm lint": "passed", "pnpm type-check": "passed" }
    });

    const payload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(payload.automation_profile, "semi_auto");
    assert.equal((payload.automation as Record<string, boolean>).accept_issue_review, true);
    assert.equal(payload.next_action, "auto_accept_issue");
    assert.equal(payload.recommended_issue_id, "ISSUE-001");
    assert.equal((payload.continuation_policy as Record<string, string>).mode, "continue_immediately");
  });
});

test("auto_issue_planning dispatches first issue", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    writeIssueModeConfig(repoRoot, { subagent_team: { auto_accept_issue_planning: true } });
    initGitRepo(repoRoot);
    commitAll(repoRoot, "commit planning docs");

    const payload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(payload.next_action, "dispatch_next_issue");
    assert.equal(payload.recommended_issue_id, "ISSUE-001");
    assert.equal((payload.automation as Record<string, boolean>).accept_issue_planning, true);
    assert.equal((payload.continuation_policy as Record<string, string>).mode, "continue_immediately");
    assert.equal((payload.continuation_policy as Record<string, boolean>).pause_allowed, false);
    assert.equal((payload.continuation_policy as Record<string, boolean>).must_not_stop_at_checkpoint, true);
  });
});

test("first issue requires planning_doc_commit before dispatch", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    initGitRepo(repoRoot);

    const payload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(payload.next_action, "await_planning_docs_commit_confirmation");
    assert.equal(payload.recommended_issue_id, "ISSUE-001");
    assert.equal((payload.continuation_policy as Record<string, string>).mode, "await_human_confirmation");
    assert.equal((payload.planning_docs as Record<string, boolean>).needs_commit, true);
    assert.match(String(payload.reason), /需先提交规划文档/);
  });
});

test("auto_issue_planning commits docs before first dispatch", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    writeIssueModeConfig(repoRoot, { subagent_team: { auto_accept_issue_planning: true } });
    initGitRepo(repoRoot);

    const payload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(payload.next_action, "commit_planning_docs");
    assert.equal(payload.recommended_issue_id, "ISSUE-001");
    assert.equal((payload.continuation_policy as Record<string, string>).mode, "continue_immediately");
    assert.equal((payload.planning_docs as Record<string, boolean>).needs_commit, true);
    assert.match(String(payload.reason), /先自动提交规划文档/);
  });
});

test("verify step can pause or auto_run based on config", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    writeIssueProgress(repoRoot, "demo-change", { status: "completed" });
    writeChangeReviewArtifact(repoRoot, "demo-change");

    const manualPayload = reconcileChange({ repoRoot, change: "demo-change" });

    writeIssueModeConfig(repoRoot, { subagent_team: { auto_accept_change_acceptance: true } });
    const autoPayload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(manualPayload.next_action, "await_verify_confirmation");
    assert.equal(autoPayload.next_action, "verify_change");
    assert.equal((autoPayload.automation as Record<string, boolean>).accept_change_acceptance, true);
    assert.equal((manualPayload.continuation_policy as Record<string, string>).mode, "await_human_confirmation");
    assert.equal((autoPayload.continuation_policy as Record<string, string>).mode, "continue_immediately");
    assert.equal((autoPayload.continuation_policy as Record<string, boolean>).must_not_stop_at_checkpoint, true);
  });
});

test("verify pass can auto_archive when enabled", () => {
  withTempDir((repoRoot) => {
    const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
    const runsDir = path.join(changeDir, "runs");
    writeIssueDoc(repoRoot, "demo-change");
    writeIssueProgress(repoRoot, "demo-change", { status: "completed", updatedAt: "2026-03-30T10:00:00+08:00" });
    writeChangeReviewArtifact(repoRoot, "demo-change", "passed", "2026-03-30T10:03:00+08:00");
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, "CHANGE-VERIFY.json"), JSON.stringify({
      status: "passed",
      updated_at: "2026-03-30T10:05:00+08:00"
    }, null, 2));
    writeIssueModeConfig(repoRoot, { subagent_team: { auto_archive_after_verify: true } });

    const payload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(payload.next_action, "archive_change");
    assert.equal((payload.automation as Record<string, boolean>).archive_after_verify, true);
    assert.equal((payload.continuation_policy as Record<string, string>).mode, "continue_immediately");
  });
});

test("all_completed_requires_change_review_before_verify", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    writeIssueProgress(repoRoot, "demo-change", { status: "completed" });

    const payload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(payload.next_action, "review_change_code");
    assert.match(String(payload.reason), /需先运行 change-level \/review/);
    assert.equal((payload.continuation_policy as Record<string, string>).mode, "resolve_or_inspect");
  });
});
