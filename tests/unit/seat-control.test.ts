import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTerminalOverwriteAllowed,
  buildSeatStateRecord,
  normalizeSeatKey,
  summarizeSeatBarrier,
  type ActiveSeatDispatchFile,
} from "../../src/domain/seat-control";

function manifest(barrierMode: "inactive" | "observe" | "enforce" = "observe"): ActiveSeatDispatchFile {
  return {
    schema_version: 1,
    change: "demo-change",
    dispatch_id: "DISPATCH-20260404T120000",
    phase: "issue_execution",
    issue_id: "ISSUE-001",
    generated_at: "2026-04-04T12:00:00+08:00",
    barrier_mode: barrierMode,
    packet_path: "openspec/changes/demo-change/issues/ISSUE-001.team.dispatch.md",
    seats: [
      {
        seat: "Developer 1",
        role: "core implementation owner",
        gate_bearing: true,
        required: true,
        reasoning_effort: "high"
      },
      {
        seat: "Checker 1",
        role: "functional correctness / main path / edge cases",
        gate_bearing: true,
        required: true,
        reasoning_effort: "medium"
      }
    ]
  };
}

test("summarizeSeatBarrier exposes missing seats without blocking in observe mode", () => {
  const summary = summarizeSeatBarrier(manifest("observe"), []);

  assert.equal(summary.active, true);
  assert.equal(summary.mode, "observe");
  assert.equal(summary.blocking, false);
  assert.equal(summary.required_missing.length, 2);
  assert.equal(summary.action, "");
});

test("summarizeSeatBarrier blocks running and failed required seats in enforce mode", () => {
  const running = buildSeatStateRecord({
    change: "demo-change",
    dispatchId: "DISPATCH-20260404T120000",
    phase: "issue_execution",
    issueId: "ISSUE-001",
    seat: "Developer 1",
    agentId: "agent-dev",
    gateBearing: true,
    required: true,
    reasoningEffort: "high",
    status: "running"
  });
  const failed = buildSeatStateRecord({
    change: "demo-change",
    dispatchId: "DISPATCH-20260404T120000",
    phase: "issue_execution",
    issueId: "ISSUE-001",
    seat: "Checker 1",
    agentId: "agent-check",
    gateBearing: true,
    required: true,
    reasoningEffort: "medium",
    status: "failed",
    error: {
      kind: "validation",
      message: "pnpm type-check failed"
    }
  });

  const summary = summarizeSeatBarrier(manifest("enforce"), [running, failed]);
  assert.equal(summary.blocking, true);
  assert.equal(summary.action, "resolve_seat_failure");
  assert.equal(summary.required_running.length, 1);
  assert.equal(summary.required_failed.length, 1);
});

test("normalizeSeatKey creates stable slug", () => {
  assert.equal(normalizeSeatKey("Checker 1"), "checker-1");
  assert.equal(normalizeSeatKey(" Design reviewer #2 "), "design-reviewer-2");
});

test("terminal overwrite requires explicit opt-in", () => {
  const previous = buildSeatStateRecord({
    change: "demo-change",
    dispatchId: "DISPATCH-20260404T120000",
    phase: "issue_execution",
    issueId: "ISSUE-001",
    seat: "Checker 1",
    agentId: "agent-check",
    gateBearing: true,
    required: true,
    reasoningEffort: "medium",
    status: "completed"
  });

  assert.throws(() => assertTerminalOverwriteAllowed(previous, false), /allow-terminal-overwrite/);
  assert.doesNotThrow(() => assertTerminalOverwriteAllowed(previous, true));
});
