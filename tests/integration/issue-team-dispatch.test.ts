import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runIssueTeamDispatchRenderer } from "../../src/renderers/issue-team-dispatch";

function makeTempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openspec-issue-team-dispatch-"));
}

function captureStdout(run: () => number): { exitCode: number; stdout: string } {
  const originalWrite = process.stdout.write;
  let stdout = "";

  process.stdout.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
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

function createStubWorktree(repoRoot: string, relativePath: string): void {
  const worktreePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.writeFileSync(path.join(worktreePath, ".git"), "gitdir: /tmp/fake-worktree\n");
}

test("renders team dispatch from issue and control artifacts", () => {
  const repoRoot = makeTempRepo();
  const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
  const issuesDir = path.join(changeDir, "issues");
  const controlDir = path.join(changeDir, "control");
  fs.mkdirSync(issuesDir, { recursive: true });
  fs.mkdirSync(controlDir, { recursive: true });

  fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: \u63a5\u5165 team dispatch
worker_worktree: .worktree/demo-change/ISSUE-001
allowed_scope:
  - src/dispatch.ts
out_of_scope:
  - electron/
done_when:
  - \u8f93\u51fa team packet
validation:
  - pnpm lint
  - pnpm type-check
---
`);
  fs.writeFileSync(path.join(controlDir, "BACKLOG.md"), `## Must Fix Now
- [ ] \u4fee\u590d ISSUE-001 gate
`);
  fs.writeFileSync(path.join(controlDir, "ROUND-01.md"), `## Round Target
- \u8ba9 ISSUE-001 \u8fdb\u5165 subagent team \u4e3b\u94fe

## Target Mode
- quality

## Acceptance Criteria
- packet \u53ef\u76f4\u63a5\u53d1\u7ed9 coordinator

## Scope In Round
- ISSUE-001

## Acceptance Verdict
- accepted

## Next Action
- \u7ee7\u7eed dispatch ISSUE-001
`);
  fs.writeFileSync(
    path.join(issuesDir, "ISSUE-001.progress.json"),
    JSON.stringify(
      {
        changed_files: ["src/dispatch.ts", "node_modules/react/index.js", "coverage/lcov.info"],
        validation: {
          lint: "passed",
          typecheck: "pending",
        },
      },
      null,
      2
    )
  );
  createStubWorktree(repoRoot, ".worktree/demo-change/ISSUE-001");

  const { exitCode, stdout } = captureStdout(() =>
    runIssueTeamDispatchRenderer([
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--issue-id",
      "ISSUE-001",
    ])
  );
  const payload = JSON.parse(stdout.trim()) as Record<string, unknown>;
  const dispatchPath = path.join(repoRoot, String(payload.team_dispatch_path));
  const seatHandoffsPath = path.join(repoRoot, String(payload.seat_handoffs_path));
  const activeSeatDispatch = JSON.parse(
    fs.readFileSync(path.join(repoRoot, String(payload.active_seat_dispatch_path)), "utf8")
  ) as { seats: Array<{ gate_bearing: boolean; required: boolean; seat: string }> };
  const dispatchText = fs.readFileSync(dispatchPath, "utf8");
  const seatHandoffsText = fs.readFileSync(seatHandoffsPath, "utf8");

  assert.equal(exitCode, 0);
  assert.match(String(payload.dispatch_id), /^DISPATCH-\d{8}T\d{6}$/);
  assert.match(String(payload.active_seat_dispatch_path), /ACTIVE-SEAT-DISPATCH\.json$/);
  assert.match(String(payload.seat_state_dir), /control\/seat-state\/DISPATCH-\d{8}T\d{6}$/);
  assert.equal((payload.control_state as { latest_round: { target_mode: string } }).latest_round.target_mode, "quality");
  assert.equal((payload.reasoning_policy as { development_group: string }).development_group, "high");
  assert.equal((payload.reasoning_policy as { check_group: string }).check_group, "medium");
  assert.equal((payload.reasoning_policy as { review_group: string }).review_group, "medium");
  assert.deepEqual(payload.tool_resource_guard, {
    max_concurrent_seats: "rendered_topology",
    min_open_files: 16384,
    on_resource_error: "recover_and_rerun_gate",
    rerun_scope: "active_dispatch",
    resource_errors: ["EMFILE", "ENFILE", "Too many open files"]
  });
  assert.match(String(payload.seat_handoffs_path), /ISSUE-001\.seat-handoffs\.md$/);
  assert.match(dispatchText, /subagent team \u4e3b\u94fe/);
  assert.match(dispatchText, /Seat Handoff Source/);
  assert.match(dispatchText, /Spawned seat subagent \u5fc5\u987b\u4f7f\u7528\u5355\u72ec\u7684 seat handoff artifact/);
  assert.match(dispatchText, /Development group: 3 subagents/);
  assert.match(dispatchText, /Check group: 2 subagents/);
  assert.match(dispatchText, /Review group: 1 subagent/);
  assert.match(dispatchText, /Developer 1: core implementation owner/);
  assert.match(dispatchText, /Checker 2: direct dependency regression risk, tests, evidence gaps/);
  assert.match(dispatchText, /Reviewer 1: scope-first target path \/ direct dependency \/ evidence pass or fail/);
  assert.match(dispatchText, /## Gate Barrier/);
  assert.match(dispatchText, /## Tool Resource Guardrails/);
  assert.match(dispatchText, /ulimit -n/);
  assert.match(dispatchText, /16384/);
  assert.match(dispatchText, /Too many open files/);
  assert.match(dispatchText, /rerun the current checker\/reviewer gate from the active dispatch/);
  assert.match(dispatchText, /never self-certify or skip that gate/);
  assert.match(dispatchText, /dispatch_id=`DISPATCH-\d{8}T\d{6}`/);
  assert.match(dispatchText, /ACTIVE-SEAT-DISPATCH\.json/);
  assert.match(dispatchText, /seat-state/);
  assert.match(dispatchText, /Development group: implementation seats only write progress \/ handoff；它们不参与 seat barrier/);
  assert.match(dispatchText, /execute seat-state set --repo-root/);
  assert.match(dispatchText, /--gate-bearing false --required false --reasoning-effort high/);
  assert.match(dispatchText, /\u6700\u957f 1 \u5c0f\u65f6\u7684 blocking wait/);
  assert.match(dispatchText, /\u4e0d\u8981\u5f53\u4f5c `explorer` sidecar/);
  assert.match(dispatchText, /final status/);
  assert.match(dispatchText, /\u5c31\u5e94\u5c3d\u5feb\u5173\u95ed/);
  assert.match(dispatchText, /agent \u914d\u989d/);
  assert.match(dispatchText, /agent \/ runtime \u4e0d\u652f\u6301 subagent \u6216 delegation/);
  assert.match(dispatchText, /\u4e32\u884c round contract/);
  assert.match(dispatchText, /Do not activate this serial fallback just because the main session can code locally/);
  assert.match(dispatchText, /When delegation is available, the coordinator stays orchestration-only/);
  assert.match(dispatchText, /development -> check -> repair -> review/);
  assert.match(dispatchText, /\u4e00\u6b21\u53ea\u5904\u7406\u8fd9\u4e2a issue/);
  assert.match(dispatchText, /Gate-bearing subagent roster with seat \/ agent_id \/ status/);
  assert.match(dispatchText, /Launch with `reasoning_effort=high`/);
  assert.match(dispatchText, /Launch with `reasoning_effort=medium`/);
  assert.match(dispatchText, /Current changed-file focus:/);
  assert.match(dispatchText, /Current review starting scope:/);
  assert.match(dispatchText, /Excluded incidental paths from review focus:/);
  assert.match(dispatchText, /`src\/dispatch.ts`/);
  assert.match(dispatchText, /`node_modules\/react\/index.js`/);
  assert.match(dispatchText, /`coverage\/lcov.info`/);
  assert.match(dispatchText, /lint=passed/);
  assert.match(dispatchText, /typecheck=pending/);
  assert.match(dispatchText, /\u9ed8\u8ba4\u6392\u9664 `node_modules`\u3001`dist`\u3001`build`\u3001`\.next`\u3001`coverage`/);
  assert.match(dispatchText, /Target mode:/);
  assert.match(dispatchText, /`quality`/);
  assert.match(dispatchText, /ISSUE-001/);
  assert.match(dispatchText, /pnpm lint/);
  assert.match(dispatchText, /\u4fee\u590d ISSUE-001 gate/);
  assert.match(dispatchText, /ISSUE-REVIEW-ISSUE-001\.json/);
  assert.match(dispatchText, /openspec-extensions execute update-progress start --repo-root/);
  assert.match(dispatchText, /openspec-extensions execute update-progress checkpoint --repo-root/);
  assert.match(dispatchText, /development seat \u4e0d\u5141\u8bb8\u81ea\u5df1\u5199 `stop`/);
  assert.match(dispatchText, /\u628a\u76f8\u5173 validation \u6807\u8bb0\u56de `pending`/);
  assert.match(dispatchText, /development seat 的 seat-state 只用于审计和恢复；真正阻塞当前 round 的 gate-bearing barrier 只看 checker \/ reviewer/);
  assert.match(dispatchText, /development seat \u4e0d\u662f\u5f53\u524d issue \u7684 validation \/ check \/ review owner/);
  assert.match(dispatchText, /\u5f53\u524d round \u7684 seat \u7ed3\u679c\u4e00\u65e6\u5df2\u7ecf\u5f52\u5e76\u8fdb round output \u6216 gate artifact/);
  assert.doesNotMatch(dispatchText, /\u5c40\u90e8 validation|\u5c40\u90e8\u6821\u9a8c/);
  assert.doesNotMatch(dispatchText, /python3 \.codex\/skills/);
  assert.match(seatHandoffsText, /# Seat Handoffs for ISSUE-001/);
  assert.match(seatHandoffsText, /seat-local source of truth/);
  assert.match(seatHandoffsText, /active seat dispatch:/);
  assert.match(seatHandoffsText, /dispatch_id:/);
  assert.match(seatHandoffsText, /seat_state_dir:/);
  assert.match(seatHandoffsText, /## Development 2 \(dependent module or integration owner\)/);
  assert.match(seatHandoffsText, /\u4f60\u4e0d\u662f coordinator/);
  assert.match(seatHandoffsText, /\u4e0d\u8981\u81ea\u884c\u62c9\u8d77\u3001\u66ff\u6362\u6216\u534f\u8c03\u5176\u4ed6 development \/ check \/ review seat/);
  assert.match(seatHandoffsText, /`openspec-extensions dispatch lifecycle`/);
  assert.match(seatHandoffsText, /\u4f9d\u8d56\u6a21\u5757 \/ \u96c6\u6210\u5c42\u53d8\u66f4\u6458\u8981/);
  assert.match(seatHandoffsText, /\u4e0d\u8981\u51b3\u5b9a\u662f\u5426\u9700\u8981\u989d\u5916 checker \/ reviewer/);
  assert.match(seatHandoffsText, /## Checker 1 \(functional correctness \/ main path \/ edge cases\)/);
  assert.match(seatHandoffsText, /## Reviewer 1 \(scope-first pass \/ fail owner\)/);
  assert.deepEqual(
    activeSeatDispatch.seats.filter((seat) => seat.seat.startsWith("Developer")).map((seat) => ({
      gate_bearing: seat.gate_bearing,
      required: seat.required
    })),
    [
      { gate_bearing: false, required: false },
      { gate_bearing: false, required: false },
      { gate_bearing: false, required: false }
    ]
  );
  assert.deepEqual(
    activeSeatDispatch.seats.filter((seat) => !seat.seat.startsWith("Developer")).map((seat) => ({
      gate_bearing: seat.gate_bearing,
      required: seat.required
    })),
    [
      { gate_bearing: true, required: true },
      { gate_bearing: true, required: true },
      { gate_bearing: true, required: true }
    ]
  );
});

test("falls back to issue-local round contract when latest round is still planning", () => {
  const repoRoot = makeTempRepo();
  const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
  const issuesDir = path.join(changeDir, "issues");
  const controlDir = path.join(changeDir, "control");
  fs.mkdirSync(issuesDir, { recursive: true });
  fs.mkdirSync(controlDir, { recursive: true });

  fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: \u751f\u547d\u5468\u671f\u6267\u884c
worker_worktree: .
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - \u5171\u4eab\u6a21\u5757\u5df2\u7ecf\u843d\u5730
validation:
  - pnpm lint
---
`);
  fs.writeFileSync(path.join(controlDir, "ROUND-01.md"), `## Round Target
- \u63a8\u8fdb issue planning \u901a\u8fc7\u5ba1\u67e5\uff0c\u5e76\u5b8c\u6210\u89c4\u5212\u6587\u6863\u63d0\u4ea4\u3002

## Target Mode
- release

## Acceptance Criteria
- proposal / design / tasks / issue \u6587\u6863\u4ee5 coordinator commit \u56fa\u5316

## Scope In Round
- proposal.md
- design.md
- tasks.md
- issues/INDEX.md
- issues/ISSUE-001.md

## Next Action
- commit planning docs
- dispatch ISSUE-001
`);

  const { stdout } = captureStdout(() =>
    runIssueTeamDispatchRenderer([
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--issue-id",
      "ISSUE-001",
    ])
  );
  const payload = JSON.parse(stdout.trim()) as Record<string, unknown>;
  const dispatchText = fs.readFileSync(path.join(repoRoot, String(payload.team_dispatch_path)), "utf8");
  const seatHandoffsText = fs.readFileSync(path.join(repoRoot, String(payload.seat_handoffs_path)), "utf8");

  assert.match(dispatchText, /\u63a8\u8fdb ISSUE-001 \u5b8c\u6210\u5f00\u53d1\u3001\u68c0\u67e5\u3001\u4fee\u590d\u3001\u5ba1\u67e5\u56de\u5408\u3002/);
  assert.match(dispatchText, /`ISSUE-001`/);
  assert.match(dispatchText, /ISSUE-001 \u7684\u76ee\u6807\u8303\u56f4\u8fbe\u6210/);
  assert.match(dispatchText, /\u5b8c\u6210 ISSUE-001 \u7684\u5f53\u524d round \u540e\uff0c\u7531 coordinator \u6536\u655b\u5f00\u53d1 \/ \u68c0\u67e5 \/ \u5ba1\u67e5\u7ed3\u679c\u3002/);
  assert.doesNotMatch(dispatchText, /proposal \/ design \/ tasks \/ issue \u6587\u6863\u4ee5 coordinator commit \u56fa\u5316/);
  assert.doesNotMatch(dispatchText, /`proposal.md`/);
  assert.doesNotMatch(dispatchText, /commit planning docs/);
  assert.match(seatHandoffsText, /## Development 1 \(core implementation owner\)/);
  assert.doesNotMatch(seatHandoffsText, /dispatch_next_issue/);
  assert.doesNotMatch(seatHandoffsText, /control-plane ready/);
});

test("stale completed round does not block the next pending issue in enforce mode", () => {
  const repoRoot = makeTempRepo();
  const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
  const issuesDir = path.join(changeDir, "issues");
  const controlDir = path.join(changeDir, "control");
  fs.mkdirSync(issuesDir, { recursive: true });
  fs.mkdirSync(controlDir, { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "openspec", "issue-mode.json"),
    JSON.stringify({
      rra: {
        gate_mode: "enforce",
      },
    }, null, 2)
  );

  fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: 已完成的上一轮
worker_worktree: .worktree/demo-change
allowed_scope:
  - src/issue-001.ts
out_of_scope:
  - electron/
done_when:
  - ISSUE-001 已完成
validation:
  - pnpm lint
---
`);
  fs.writeFileSync(path.join(issuesDir, "ISSUE-002.md"), `---
issue_id: ISSUE-002
title: 下一轮待派发 issue
worker_worktree: .worktree/demo-change
allowed_scope:
  - src/issue-002.ts
out_of_scope:
  - electron/
done_when:
  - ISSUE-002 已派发
validation:
  - pnpm lint
---
`);
  fs.writeFileSync(
    path.join(issuesDir, "ISSUE-001.progress.json"),
    JSON.stringify({
      issue_id: "ISSUE-001",
      status: "completed",
      boundary_status: "accepted",
      next_action: "",
    }, null, 2)
  );
  fs.writeFileSync(path.join(controlDir, "ROUND-04.md"), `## Round Target
- 收敛 ISSUE-001

## Scope In Round
- ISSUE-001

## Acceptance Verdict
- accepted

## Next Action
- reconcile and continue
`);
  createStubWorktree(repoRoot, ".worktree/demo-change");

  const { exitCode, stdout } = captureStdout(() =>
    runIssueTeamDispatchRenderer([
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--issue-id",
      "ISSUE-002",
    ])
  );
  const payload = JSON.parse(stdout.trim()) as Record<string, unknown>;

  assert.equal(exitCode, 0);
  assert.equal((payload.control_gate as { status: string }).status, "approved_for_dispatch");
  assert.equal((payload.control_gate as { action: string }).action, "dispatch_next_issue");
  assert.match(String((payload.control_gate as { reason: string }).reason), /当前 round 只覆盖已收敛 issue/);
});

test("team dispatch blocks when dedicated worker workspace is not ready", () => {
  const repoRoot = makeTempRepo();
  const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
  const issuesDir = path.join(changeDir, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });
  fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: 缺少 workspace
worker_worktree: .worktree/demo-change/ISSUE-001
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - packet is blocked
validation:
  - pnpm lint
---
`);

  assert.throws(
    () =>
      runIssueTeamDispatchRenderer([
        "--repo-root",
        repoRoot,
        "--change",
        "demo-change",
        "--issue-id",
        "ISSUE-001"
      ]),
    /Issue workspace for ISSUE-001 is not ready/
  );
});
