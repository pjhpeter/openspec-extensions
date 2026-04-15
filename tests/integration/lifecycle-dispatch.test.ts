import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import { renderLifecycleDispatch } from "../../src/renderers/lifecycle-dispatch";
import { phaseGateArtifactPath, phaseGateScopeToJson, type PhaseGate } from "../../src/domain/change-coordinator";

const GATE_UPDATED_AT = "2099-01-01T00:00:00+00:00";

function withTempDir(run: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-lifecycle-dispatch-"));
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

test("detects spec_readiness when core docs are missing", () => {
  withTempDir((repoRoot) => {
    const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");

    const payload = renderLifecycleDispatch({
      repoRoot,
      change: "demo-change",
      phase: "auto",
      issueId: "",
      dryRun: false
    });
    const dispatchText = fs.readFileSync(path.join(repoRoot, payload.lifecycle_dispatch_path), "utf8");

    assert.equal(payload.phase, "spec_readiness");
    assert.equal(payload.focus_issue_id, "");
    assert.equal(payload.automation.accept_spec_readiness, false);
    assert.equal(payload.automation_profile, "semi_auto");
    assert.equal(payload.team_topology[0]?.label, "Design author");
    assert.equal(payload.team_topology[0]?.count, 1);
    assert.equal(payload.team_topology[0]?.reasoning_effort, "high");
    assert.equal(payload.team_topology[1]?.label, "Design review");
    assert.equal(payload.team_topology[1]?.count, 2);
    assert.equal(payload.team_topology[1]?.reasoning_effort, "medium");
    assert.match(dispatchText, /proposal \/ design/);
    assert.match(dispatchText, /spec_readiness/);
    assert.match(dispatchText, /Design author: 1 subagent/);
    assert.match(dispatchText, /Design review: 2 subagents/);
    assert.match(dispatchText, /Launch with `reasoning_effort=high`/);
    assert.match(dispatchText, /Launch with `reasoning_effort=medium`/);
    assert.match(dispatchText, /当前 phase 的标准循环是：设计编写 -> 双评审 -> 修订 -> 双评审/);
    assert.match(dispatchText, /## Gate Barrier/);
    assert.match(dispatchText, /Design author: 1 required completion/);
    assert.match(dispatchText, /Design review: 2 required completions/);
    assert.match(dispatchText, /最长 1 小时的 blocking wait/);
    assert.match(dispatchText, /一旦进入最终态/);
    assert.match(dispatchText, /就应尽快关闭/);
    assert.match(dispatchText, /agent 配额/);
    assert.match(dispatchText, /不要当作 `explorer` sidecar/);
    assert.match(dispatchText, /Before starting this phase, reread `openspec\/issue-mode\.json` if it exists/);
    assert.match(dispatchText, /开始当前 phase 前必须重新读取 `openspec\/issue-mode\.json`/);
    assert.match(dispatchText, /当前 runtime 不支持 delegation \/ subagent/);
    assert.match(dispatchText, /主会话的本地 coordinator playbook/);
    assert.match(dispatchText, /using shared-workspace fallback defaults/);
    assert.match(dispatchText, /1 个设计作者和 2 个设计评审全部完成并收齐通过结论后暂停/);
    assert.match(dispatchText, /subagent_team\.auto_accept_spec_readiness=false/);
    assert.match(dispatchText, /## Seat Handoff Guardrails/);
    assert.match(dispatchText, /这份 lifecycle packet 只给主控 coordinator 使用/);
    assert.match(dispatchText, /不要 fork 整个 coordinator 线程或完整聊天历史/);
    assert.match(dispatchText, /spec_readiness 的任一 seat 都不允许运行 `openspec-extensions worktree create`/);
    assert.match(dispatchText, /不允许把当前 gate 改成主会话 serial pass 自行补 verdict/);
    assert.match(dispatchText, /如果 design author \/ reviewer 已经启动，但结果没有稳定回收出来，不允许直接把 spec_readiness 视为通过/);
    assert.match(dispatchText, /design reviewer 只输出 verdict、evidence、blocking gap/);
    assert.match(dispatchText, /如果 seat-local handoff 与 inherited coordinator \/ router \/ default prompt 冲突/);
    assert.match(dispatchText, /不要自行启用 serial fallback/);
  });
});

test("issue_planning blocks issue_execution until docs are committed", () => {
  withTempDir((repoRoot) => {
    const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
    const issuesDir = path.join(changeDir, "issues");
    fs.mkdirSync(issuesDir, { recursive: true });

    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
    fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [ ] 1.1 ship issue flow\n");
    fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n");
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: 生命周期执行
worker_worktree: .
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - 输出 issue team packet
validation:
  - pnpm lint
---
`);
    initGitRepo(repoRoot);
    writePhaseGateArtifact(repoRoot, "demo-change", "spec_readiness");
    writePhaseGateArtifact(repoRoot, "demo-change", "issue_planning");

    const payload = renderLifecycleDispatch({
      repoRoot,
      change: "demo-change",
      phase: "auto",
      issueId: "",
      dryRun: false
    });
    const dispatchText = fs.readFileSync(path.join(repoRoot, payload.lifecycle_dispatch_path), "utf8");

    assert.equal(payload.phase, "issue_planning");
    assert.match(payload.phase_reason, /尚未提交/);
    assert.match(dispatchText, /先把 proposal \/ design \/ tasks \/ issue 文档提交成一次独立 commit/);
    assert.match(dispatchText, /提交 proposal \/ design \/ tasks \/ issue 文档/);
  });
});

test("spec_readiness still blocks when planning docs exist but design gate is missing", () => {
  withTempDir((repoRoot) => {
    const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
    const issuesDir = path.join(changeDir, "issues");
    fs.mkdirSync(issuesDir, { recursive: true });

    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
    fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [ ] 1.1 ship issue flow\n");
    fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n");
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: 生命周期执行
worker_worktree: .
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - 输出 issue team packet
validation:
  - pnpm lint
---
`);

    const payload = renderLifecycleDispatch({
      repoRoot,
      change: "demo-change",
      phase: "auto",
      issueId: "",
      dryRun: false
    });

    assert.equal(payload.phase, "spec_readiness");
    assert.match(payload.phase_reason, /即使 tasks \/ issue 文档已经存在/);
    assert.match(payload.phase_reason, /SPEC-READINESS\.json/);
  });
});

test("issue_planning still blocks when planning gate is missing", () => {
  withTempDir((repoRoot) => {
    const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
    const issuesDir = path.join(changeDir, "issues");
    fs.mkdirSync(issuesDir, { recursive: true });

    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
    fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [ ] 1.1 ship issue flow\n");
    fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n");
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: 生命周期执行
worker_worktree: .
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - 输出 issue team packet
validation:
  - pnpm lint
---
`);
    writePhaseGateArtifact(repoRoot, "demo-change", "spec_readiness");
    initGitRepo(repoRoot);
    commitAll(repoRoot, "commit planning docs");

    const payload = renderLifecycleDispatch({
      repoRoot,
      change: "demo-change",
      phase: "auto",
      issueId: "",
      dryRun: false
    });

    assert.equal(payload.phase, "issue_planning");
    assert.match(payload.phase_reason, /issue_planning gate 还没有记录通过/);
    assert.match(payload.phase_reason, /ISSUE-PLANNING\.json/);
  });
});

test("detects issue_execution and renders current issue packet", () => {
  withTempDir((repoRoot) => {
    const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
    const issuesDir = path.join(changeDir, "issues");
    const controlDir = path.join(changeDir, "control");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(controlDir, { recursive: true });

    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
    fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [ ] 1.1 ship issue flow\n");
    fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n");
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: 生命周期执行
worker_worktree: .worktree/demo-change/ISSUE-001
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - 输出 issue team packet
validation:
  - pnpm lint
---
`);
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.progress.json"), JSON.stringify({
      changed_files: ["src/demo.ts", "node_modules/vue/index.js"],
      validation: { lint: "passed" }
    }, null, 2));
    fs.writeFileSync(path.join(controlDir, "BACKLOG.md"), "## Must Fix Now\n- none\n");
    fs.writeFileSync(path.join(controlDir, "ROUND-01.md"), `## Round Target
- 推进 ISSUE-001

## Target Mode
- quality

## Scope In Round
- ISSUE-001

## Acceptance Criteria
- ISSUE-001 可继续执行

## Next Action
- 继续 ISSUE-001
`);
    initGitRepo(repoRoot);
    writePhaseGateArtifact(repoRoot, "demo-change", "spec_readiness");
    writePhaseGateArtifact(repoRoot, "demo-change", "issue_planning");
    commitAll(repoRoot, "commit planning docs");

    const payload = renderLifecycleDispatch({
      repoRoot,
      change: "demo-change",
      phase: "auto",
      issueId: "",
      dryRun: false
    });
    const lifecycleText = fs.readFileSync(path.join(repoRoot, payload.lifecycle_dispatch_path), "utf8");
    const issueTeamText = fs.readFileSync(path.join(repoRoot, payload.issue_team_dispatch_path), "utf8");
    const issueSeatHandoffsText = fs.readFileSync(path.join(repoRoot, payload.issue_team_seat_handoffs_path), "utf8");

    assert.equal(payload.phase, "issue_execution");
    assert.equal(payload.focus_issue_id, "ISSUE-001");
    assert.match(payload.dispatch_id, /^DISPATCH-\d{8}T\d{6}$/);
    assert.match(payload.active_seat_dispatch_path, /ACTIVE-SEAT-DISPATCH\.json$/);
    assert.match(payload.seat_state_dir, /control\/seat-state\/DISPATCH-\d{8}T\d{6}$/);
    assert.equal(payload.seat_barrier.mode, "observe");
    assert.equal(payload.seat_barrier.required_missing.length, 3);
    assert.match(payload.issue_team_dispatch_path, /ISSUE-001\.team\.dispatch\.md$/);
    assert.match(payload.issue_team_seat_handoffs_path, /ISSUE-001\.seat-handoffs\.md$/);
    assert.match(lifecycleText, /Current issue packet/);
    assert.match(lifecycleText, /ISSUE-001\.team\.dispatch\.md/);
    assert.match(lifecycleText, /Seat-local handoff packet for spawned seats/);
    assert.match(lifecycleText, /ISSUE-001\.seat-handoffs\.md/);
    assert.match(lifecycleText, /Gate-bearing seats for this phase/);
    assert.match(lifecycleText, /ACTIVE-SEAT-DISPATCH\.json/);
    assert.match(lifecycleText, /Current barrier summary/);
    assert.doesNotMatch(lifecycleText, /Development group: 3 required completions/);
    assert.match(lifecycleText, /Check group: 2 required completions/);
    assert.match(lifecycleText, /Review group: 1 required completion/);
    assert.match(lifecycleText, /issue_execution` 仍然一次只处理一个 approved issue/);
    assert.match(lifecycleText, /只负责实现和 progress start\/checkpoint/);
    assert.match(lifecycleText, /只把相关 validation 回写成 `pending`/);
    assert.match(lifecycleText, /当前 phase 的 seat 结果一旦已经归并进 round 输出 \/ gate artifact/);
    assert.doesNotMatch(lifecycleText, /局部验证/);
    assert.match(lifecycleText, /不要读取 `node_modules`、`dist`、`build`、`\.next`、`coverage`/);
    assert.match(issueTeamText, /Development group: 3 subagents/);
    assert.match(issueTeamText, /Check group: 2 subagents/);
    assert.match(issueTeamText, /Review group: 1 subagent/);
    assert.match(issueTeamText, /Developer 2: dependent module or integration owner/);
    assert.match(issueTeamText, /Checker 2: direct dependency regression risk, tests, evidence gaps/);
    assert.match(issueTeamText, /Reviewer 1: scope-first target path \/ direct dependency \/ evidence pass or fail/);
    assert.match(issueTeamText, /Excluded incidental paths from review focus:/);
    assert.match(issueTeamText, /`node_modules\/vue\/index\.js`/);
    assert.match(issueTeamText, /默认排除 `node_modules`、`dist`、`build`、`\.next`、`coverage`/);
    assert.match(issueSeatHandoffsText, /## Development 2 \(dependent module or integration owner\)/);
    assert.match(issueSeatHandoffsText, /只处理依赖模块、集成接缝和当前 issue 直接相关的兼容性问题/);
    assert.equal(payload.team_topology[0]?.label, "Development group");
    assert.equal(payload.team_topology[0]?.count, 3);
    assert.equal(payload.team_topology[0]?.reasoning_effort, "high");
    assert.equal(payload.team_topology[1]?.reasoning_effort, "medium");
    assert.equal(payload.team_topology[1]?.count, 2);
    assert.equal(payload.team_topology[2]?.count, 1);
  });
});

test("completed team dispatch issue stays in issue_execution until review gate exists", () => {
  withTempDir((repoRoot) => {
    const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
    const issuesDir = path.join(changeDir, "issues");
    fs.mkdirSync(issuesDir, { recursive: true });

    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
    fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [x] 1.1 ship issue flow\n");
    fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n");
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: 生命周期执行
worker_worktree: .
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - 输出 issue team packet
validation:
  - pnpm lint
---
`);
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.team.dispatch.md"), "# team dispatch\n");
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.progress.json"), JSON.stringify({
      issue_id: "ISSUE-001",
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      changed_files: ["src/demo.ts"],
      validation: { lint: "passed" },
      updated_at: "2026-03-30T10:00:00+08:00"
    }, null, 2));
    writePhaseGateArtifact(repoRoot, "demo-change", "spec_readiness");
    writePhaseGateArtifact(repoRoot, "demo-change", "issue_planning");
    initGitRepo(repoRoot);
    commitAll(repoRoot, "commit planning docs");

    const payload = renderLifecycleDispatch({
      repoRoot,
      change: "demo-change",
      phase: "auto",
      issueId: "",
      dryRun: false
    });

    assert.equal(payload.phase, "issue_execution");
    assert.equal(payload.focus_issue_id, "ISSUE-001");
    assert.match(payload.phase_reason, /checker\/reviewer gate/);
  });
});

test("enters change_verify phase when auto verify is enabled", () => {
  withTempDir((repoRoot) => {
    const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
    const issuesDir = path.join(changeDir, "issues");
    const controlDir = path.join(changeDir, "control");
    const runsDir = path.join(changeDir, "runs");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(controlDir, { recursive: true });
    fs.mkdirSync(runsDir, { recursive: true });

    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
    fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [x] 1.1 ship issue flow\n");
    fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n");
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: 生命周期执行
worker_worktree: .worktree/demo-change/ISSUE-001
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - 输出 issue team packet
validation:
  - pnpm lint
---
`);
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.progress.json"), JSON.stringify({
      issue_id: "ISSUE-001",
      status: "completed",
      boundary_status: "accepted",
      next_action: ""
    }, null, 2));
    fs.writeFileSync(path.join(controlDir, "BACKLOG.md"), "## Must Fix Now\n- none\n");
    fs.writeFileSync(path.join(controlDir, "ROUND-01.md"), `## Round Target
- 完成 demo-change

## Acceptance Verdict
- pass

## Next Action
- run verify
`);
    fs.writeFileSync(path.join(runsDir, "CHANGE-REVIEW.json"), JSON.stringify({
      status: "passed",
      updated_at: "2026-03-30T10:05:00+08:00"
    }, null, 2));
    fs.mkdirSync(path.join(repoRoot, "openspec"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "openspec", "issue-mode.json"), JSON.stringify({
      rra: { gate_mode: "enforce" },
      subagent_team: {
        auto_accept_spec_readiness: true,
        auto_accept_issue_planning: true,
        auto_accept_issue_review: true,
        auto_accept_change_acceptance: false,
        auto_archive_after_verify: false
      }
    }, null, 2));
    writePhaseGateArtifact(repoRoot, "demo-change", "spec_readiness");
    writePhaseGateArtifact(repoRoot, "demo-change", "issue_planning");

    const payload = renderLifecycleDispatch({
      repoRoot,
      change: "demo-change",
      phase: "auto",
      issueId: "",
      dryRun: false
    });
    const dispatchText = fs.readFileSync(path.join(repoRoot, payload.lifecycle_dispatch_path), "utf8");

    assert.equal(payload.phase, "change_acceptance");
    assert.equal(payload.automation_profile, "full_auto");
    assert.equal(payload.automation.accept_change_acceptance, false);
    assert.match(dispatchText, /subagent_team\.auto_accept_change_acceptance=false/);
    assert.match(dispatchText, /CHANGE-REVIEW\.json 为当前 issue 集合的最新 review 结果/);
  });
});

test("ready_for_archive reflects auto_archive switch", () => {
  withTempDir((repoRoot) => {
    const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
    const issuesDir = path.join(changeDir, "issues");
    const runsDir = path.join(changeDir, "runs");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(runsDir, { recursive: true });

    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
    fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [x] 1.1 ship issue flow\n");
    fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n");
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: 生命周期执行
worker_worktree: .worktree/demo-change/ISSUE-001
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - 输出 issue team packet
validation:
  - pnpm lint
---
`);
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.progress.json"), JSON.stringify({
      issue_id: "ISSUE-001",
      status: "completed",
      boundary_status: "accepted",
      next_action: "",
      updated_at: "2026-03-30T10:00:00+08:00"
    }, null, 2));
    fs.writeFileSync(path.join(runsDir, "CHANGE-REVIEW.json"), JSON.stringify({
      status: "passed",
      updated_at: "2026-03-30T10:03:00+08:00"
    }, null, 2));
    fs.writeFileSync(path.join(runsDir, "CHANGE-VERIFY.json"), JSON.stringify({
      status: "passed",
      completed_issue_ids: ["ISSUE-001"],
      updated_at: "2026-03-30T10:05:00+08:00"
    }, null, 2));
    fs.mkdirSync(path.join(repoRoot, "openspec"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "openspec", "issue-mode.json"), JSON.stringify({
      subagent_team: {
        auto_archive_after_verify: true
      }
    }, null, 2));
    writePhaseGateArtifact(repoRoot, "demo-change", "spec_readiness");
    writePhaseGateArtifact(repoRoot, "demo-change", "issue_planning");

    const payload = renderLifecycleDispatch({
      repoRoot,
      change: "demo-change",
      phase: "auto",
      issueId: "",
      dryRun: false
    });
    const dispatchText = fs.readFileSync(path.join(repoRoot, payload.lifecycle_dispatch_path), "utf8");

    assert.equal(payload.phase, "ready_for_archive");
    assert.equal(payload.automation.archive_after_verify, true);
    assert.match(dispatchText, /cat ".*openspec\/issue-mode\.json"/);
    assert.match(dispatchText, /openspec-extensions archive change --repo-root/);
    assert.match(dispatchText, /subagent_team\.auto_archive_after_verify=true/);
  });
});

test("change_acceptance requires change_review before verify", () => {
  withTempDir((repoRoot) => {
    const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
    const issuesDir = path.join(changeDir, "issues");
    const controlDir = path.join(changeDir, "control");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(controlDir, { recursive: true });

    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
    fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [x] 1.1 ship issue flow\n");
    fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n");
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: 生命周期执行
worker_worktree: .worktree/demo-change/ISSUE-001
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - 输出 issue team packet
validation:
  - pnpm lint
---
`);
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.progress.json"), JSON.stringify({
      issue_id: "ISSUE-001",
      status: "completed",
      boundary_status: "accepted",
      next_action: "",
      updated_at: "2026-03-30T10:00:00+08:00"
    }, null, 2));
    writePhaseGateArtifact(repoRoot, "demo-change", "spec_readiness");
    writePhaseGateArtifact(repoRoot, "demo-change", "issue_planning");

    const payload = renderLifecycleDispatch({
      repoRoot,
      change: "demo-change",
      phase: "auto",
      issueId: "",
      dryRun: false
    });
    const dispatchText = fs.readFileSync(path.join(repoRoot, payload.lifecycle_dispatch_path), "utf8");

    assert.equal(payload.phase, "change_acceptance");
    assert.match(payload.phase_reason, /需先对当前分支未 push 的代码运行 change-level \/review/);
    assert.match(dispatchText, /openspec-extensions review change --repo-root/);
    assert.match(dispatchText, /只有 change-level \/review 通过后，才允许继续进入 verify/);
    assert.match(dispatchText, /任一 required gate-bearing subagent 仍在运行时，不允许提前通过当前 phase/);
  });
});
