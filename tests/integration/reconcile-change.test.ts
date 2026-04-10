import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import { reconcileChange } from "../../src/commands/reconcile";
import {
  issueReviewArtifactPath,
  phaseGateArtifactPath,
  phaseGateScopeToJson,
  type PhaseGate
} from "../../src/domain/change-coordinator";

const GATE_UPDATED_AT = "2099-01-01T00:00:00+00:00";

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

function writePhaseGateArtifact(repoRoot: string, change: string, phase: PhaseGate, status = "passed"): void {
  const artifactPath = phaseGateArtifactPath(repoRoot, change, phase);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify({
    phase,
    status,
    updated_at: GATE_UPDATED_AT,
    gate_scope: phaseGateScopeToJson(repoRoot, change, phase)
  }, null, 2));
}

function writeIssueReviewArtifact(repoRoot: string, change: string, issueId: string, status = "pass"): void {
  const artifactPath = issueReviewArtifactPath(repoRoot, change, issueId);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify({
    change,
    issue_id: issueId,
    status,
    run_id: `RUN-${issueId}`,
    changed_files: ["src/demo.ts"],
    updated_at: GATE_UPDATED_AT
  }, null, 2));
}

function writeIssueDoc(
  repoRoot: string,
  change: string,
  issueId = "ISSUE-001",
  options: { includeGateArtifacts?: boolean } = {}
): void {
  const changeDir = path.join(repoRoot, "openspec", "changes", change);
  const issuesDir = path.join(changeDir, "issues");
  const issuePath = path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.md`);
  fs.mkdirSync(path.dirname(issuePath), { recursive: true });
  fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
  fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
  fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [ ] 1.1 ship issue flow\n");
  fs.writeFileSync(path.join(issuesDir, "INDEX.md"), `- \`${issueId}\` \`1.1\`\n`);
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
  if (options.includeGateArtifacts !== false) {
    writePhaseGateArtifact(repoRoot, change, "spec_readiness");
    writePhaseGateArtifact(repoRoot, change, "issue_planning");
  }
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

function writeRouteDecision(repoRoot: string, change: string, payload: Record<string, unknown>): void {
  const routeDecisionPath = path.join(repoRoot, "openspec", "changes", change, "control", "ROUTE-DECISION.json");
  fs.mkdirSync(path.dirname(routeDecisionPath), { recursive: true });
  fs.writeFileSync(routeDecisionPath, JSON.stringify(payload, null, 2));
}

function writeRoundArtifact(repoRoot: string, change: string, roundName: string, contents: string): void {
  const roundPath = path.join(repoRoot, "openspec", "changes", change, "control", roundName);
  fs.mkdirSync(path.dirname(roundPath), { recursive: true });
  fs.writeFileSync(roundPath, contents);
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

test("reconcile surfaces recorded route decision", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    writeRouteDecision(repoRoot, "demo-change", {
      route: "complex",
      score: 4,
      summary: "改走复杂流程，因为已经跨模块并且需要 design review + issue 拆分。",
      rationale: ["跨模块", "需要 issue 拆分"],
      recommended_flow: "issue-mode -> subagent-team",
      updated_at: "2026-04-07T12:00:00+08:00"
    });

    const payload = reconcileChange({ repoRoot, change: "demo-change" });
    const routeDecision = payload.route_decision as Record<string, unknown>;
    const control = payload.control as Record<string, unknown>;
    const controlRouteDecision = control.route_decision as Record<string, unknown>;

    assert.equal(routeDecision.exists, true);
    assert.equal(routeDecision.valid, true);
    assert.equal(routeDecision.route, "complex");
    assert.equal(routeDecision.score, 4);
    assert.equal(routeDecision.recommended_flow, "issue-mode -> subagent-team");
    assert.deepEqual(routeDecision.rationale, ["跨模块", "需要 issue 拆分"]);
    assert.match(String(routeDecision.path), /control\/ROUTE-DECISION\.json$/);

    assert.equal(control.route_decision_path, String(routeDecision.path));
    assert.deepEqual(controlRouteDecision, routeDecision);
  });
});

test("reconcile tolerates malformed route decision artifact", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    const routeDecisionPath = path.join(repoRoot, "openspec", "changes", "demo-change", "control", "ROUTE-DECISION.json");
    fs.mkdirSync(path.dirname(routeDecisionPath), { recursive: true });
    fs.writeFileSync(routeDecisionPath, "{bad json\n");

    const payload = reconcileChange({ repoRoot, change: "demo-change" });
    const routeDecision = payload.route_decision as Record<string, unknown>;

    assert.equal(routeDecision.exists, true);
    assert.equal(routeDecision.valid, false);
    assert.equal(routeDecision.route, "");
    assert.match(String(routeDecision.error), /JSON|Expected|position/i);
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

test("missing spec gate blocks dispatch even when planning docs already exist", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change", "ISSUE-001", { includeGateArtifacts: false });
    initGitRepo(repoRoot);
    commitAll(repoRoot, "commit planning docs");

    const payload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(payload.next_action, "complete_spec_readiness_gate");
    assert.equal(payload.recommended_issue_id, "");
    assert.match(String(payload.reason), /spec_readiness gate 尚未记录通过/);
    assert.equal((payload.continuation_policy as Record<string, string>).mode, "resolve_or_inspect");
  });
});

test("missing issue_planning gate blocks first dispatch after design gate", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change", "ISSUE-001", { includeGateArtifacts: false });
    writePhaseGateArtifact(repoRoot, "demo-change", "spec_readiness");
    initGitRepo(repoRoot);
    commitAll(repoRoot, "commit planning docs");

    const payload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(payload.next_action, "complete_issue_planning_gate");
    assert.equal(payload.recommended_issue_id, "ISSUE-001");
    assert.match(String(payload.reason), /issue_planning gate 尚未记录通过/);
    assert.equal((payload.continuation_policy as Record<string, string>).mode, "resolve_or_inspect");
  });
});

test("team dispatch issue requires review gate before auto accept", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    writeIssueDoc(repoRoot, change, issueId);
    fs.writeFileSync(
      path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.team.dispatch.md`),
      "# team dispatch\n"
    );
    writeIssueProgress(repoRoot, change, {
      issueId,
      status: "completed",
      boundaryStatus: "review_required",
      nextAction: "coordinator_review",
      validation: { "pnpm lint": "passed", "pnpm type-check": "passed" },
      updatedAt: "2026-03-30T10:00:00+08:00"
    });
    const progressPath = path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.progress.json`);
    const progress = JSON.parse(fs.readFileSync(progressPath, "utf8")) as Record<string, unknown>;
    progress.run_id = `RUN-${issueId}`;
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));

    const payload = reconcileChange({ repoRoot, change });

    assert.equal(payload.next_action, "complete_issue_review_gate");
    assert.equal(payload.recommended_issue_id, issueId);
    assert.match(String(payload.reason), /team dispatch/);
  });
});

test("team dispatch issue can auto accept after review gate passes", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    writeIssueDoc(repoRoot, change, issueId);
    fs.writeFileSync(
      path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.team.dispatch.md`),
      "# team dispatch\n"
    );
    writeIssueProgress(repoRoot, change, {
      issueId,
      status: "completed",
      boundaryStatus: "review_required",
      nextAction: "coordinator_review",
      validation: { "pnpm lint": "passed", "pnpm type-check": "passed" },
      updatedAt: "2026-03-30T10:00:00+08:00"
    });
    const progressPath = path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.progress.json`);
    const progress = JSON.parse(fs.readFileSync(progressPath, "utf8")) as Record<string, unknown>;
    progress.run_id = `RUN-${issueId}`;
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
    writeIssueReviewArtifact(repoRoot, change, issueId);

    const payload = reconcileChange({ repoRoot, change });

    assert.equal(payload.next_action, "auto_accept_issue");
    assert.equal(payload.recommended_issue_id, issueId);
  });
});

test("stale completed round auto advances to the next pending issue", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    writeIssueDoc(repoRoot, change, "ISSUE-001");
    writeIssueDoc(repoRoot, change, "ISSUE-002");
    writeIssueModeConfig(repoRoot, { rra: { gate_mode: "enforce" } });
    writeIssueProgress(repoRoot, change, {
      issueId: "ISSUE-001",
      status: "completed",
      boundaryStatus: "accepted",
      nextAction: "",
    });
    writeRoundArtifact(repoRoot, change, "ROUND-04.md", `## Round Target
- 收敛 ISSUE-001

## Scope In Round
- ISSUE-001

## Acceptance Verdict
- accepted

## Next Action
- reconcile and continue
`);

    const payload = reconcileChange({ repoRoot, change });

    assert.equal(payload.next_action, "dispatch_next_issue");
    assert.equal(payload.recommended_issue_id, "ISSUE-002");
    assert.equal((payload.continuation_policy as Record<string, string>).mode, "continue_immediately");
    assert.match(String(payload.reason), /当前 round 只覆盖已收敛 issue/);
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
