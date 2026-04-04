import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import { reconcileChange } from "../../src/commands/reconcile";
import {
  buildSeatStateRecord,
  writeActiveSeatDispatch,
  writeSeatState,
  type ActiveSeatDispatchFile,
} from "../../src/domain/seat-control";
import { phaseGateArtifactPath, phaseGateScopeToJson, type PhaseGate } from "../../src/domain/change-coordinator";

const GATE_UPDATED_AT = "2099-01-01T00:00:00+00:00";

function withTempDir(run: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-reconcile-seat-barrier-"));
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

function writePhaseGateArtifact(repoRoot: string, change: string, phase: PhaseGate): void {
  const artifactPath = phaseGateArtifactPath(repoRoot, change, phase);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify({
    phase,
    status: "passed",
    updated_at: GATE_UPDATED_AT,
    gate_scope: phaseGateScopeToJson(repoRoot, change, phase)
  }, null, 2));
}

function writeIssueDoc(repoRoot: string, change: string): void {
  const changeDir = path.join(repoRoot, "openspec", "changes", change);
  const issuesDir = path.join(changeDir, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
  fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
  fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [ ] 1.1 ship issue flow\n");
  fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n");
  fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: Demo issue
worker_worktree: .worktree/demo-change/ISSUE-001
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
  writePhaseGateArtifact(repoRoot, change, "spec_readiness");
  writePhaseGateArtifact(repoRoot, change, "issue_planning");
}

function writeManifest(repoRoot: string, change: string, mode: "observe" | "enforce"): ActiveSeatDispatchFile {
  const manifest: ActiveSeatDispatchFile = {
    schema_version: 1,
    change,
    dispatch_id: "DISPATCH-20260404T120000",
    phase: "issue_execution",
    issue_id: "ISSUE-001",
    generated_at: "2026-04-04T12:00:00+08:00",
    barrier_mode: mode,
    packet_path: `openspec/changes/${change}/issues/ISSUE-001.team.dispatch.md`,
    seat_handoffs_path: `openspec/changes/${change}/issues/ISSUE-001.seat-handoffs.md`,
    seats: [
      {
        seat: "Checker 1",
        role: "functional correctness / main path / edge cases",
        gate_bearing: true,
        required: true,
        reasoning_effort: "medium"
      }
    ]
  };
  writeActiveSeatDispatch(repoRoot, change, manifest);
  return manifest;
}

test("observe mode exposes seat_barrier but does not change next_action", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    initGitRepo(repoRoot);
    commitAll(repoRoot, "commit planning docs");
    const manifest = writeManifest(repoRoot, "demo-change", "observe");
    writeSeatState(repoRoot, buildSeatStateRecord({
      change: manifest.change,
      dispatchId: manifest.dispatch_id,
      phase: manifest.phase,
      issueId: manifest.issue_id,
      seat: "Checker 1",
      agentId: "agent-check",
      gateBearing: true,
      required: true,
      reasoningEffort: "medium",
      status: "running"
    }));

    const payload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(payload.next_action, "await_issue_dispatch_confirmation");
    assert.equal((payload.seat_barrier as { mode: string }).mode, "observe");
    assert.equal((payload.seat_barrier as { required_running: unknown[] }).required_running.length, 1);
  });
});

test("enforce mode waits for running gate-bearing seats", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    initGitRepo(repoRoot);
    commitAll(repoRoot, "commit planning docs");
    const manifest = writeManifest(repoRoot, "demo-change", "enforce");
    writeSeatState(repoRoot, buildSeatStateRecord({
      change: manifest.change,
      dispatchId: manifest.dispatch_id,
      phase: manifest.phase,
      issueId: manifest.issue_id,
      seat: "Checker 1",
      agentId: "agent-check",
      gateBearing: true,
      required: true,
      reasoningEffort: "medium",
      status: "running"
    }));

    const payload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(payload.next_action, "wait_for_gate_seats");
    assert.equal((payload.continuation_policy as { mode: string }).mode, "wait_for_gate_seats");
  });
});

test("enforce mode resolves seat failure for failed or cancelled seats", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    initGitRepo(repoRoot);
    commitAll(repoRoot, "commit planning docs");
    const manifest = writeManifest(repoRoot, "demo-change", "enforce");
    writeSeatState(repoRoot, buildSeatStateRecord({
      change: manifest.change,
      dispatchId: manifest.dispatch_id,
      phase: manifest.phase,
      issueId: manifest.issue_id,
      seat: "Checker 1",
      agentId: "agent-check",
      gateBearing: true,
      required: true,
      reasoningEffort: "medium",
      status: "cancelled"
    }));

    const payload = reconcileChange({ repoRoot, change: "demo-change" });

    assert.equal(payload.next_action, "resolve_seat_failure");
    assert.equal((payload.seat_barrier as { required_cancelled: unknown[] }).required_cancelled.length, 1);
  });
});
