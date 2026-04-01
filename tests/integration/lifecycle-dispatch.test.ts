import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import { renderLifecycleDispatch } from "../../src/renderers/lifecycle-dispatch";

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
    assert.equal(payload.team_topology[0]?.reasoning_effort, "xhigh");
    assert.equal(payload.team_topology[1]?.label, "Design review");
    assert.equal(payload.team_topology[1]?.count, 2);
    assert.equal(payload.team_topology[1]?.reasoning_effort, "medium");
    assert.match(dispatchText, /proposal \/ design/);
    assert.match(dispatchText, /spec_readiness/);
    assert.match(dispatchText, /Design author: 1 subagent/);
    assert.match(dispatchText, /Design review: 2 subagents/);
    assert.match(dispatchText, /Launch with `reasoning_effort=xhigh`/);
    assert.match(dispatchText, /Launch with `reasoning_effort=medium`/);
    assert.match(dispatchText, /当前 phase 的标准循环是：设计编写 -> 双评审 -> 修订 -> 双评审/);
    assert.match(dispatchText, /## Gate Barrier/);
    assert.match(dispatchText, /Design author: 1 required completion/);
    assert.match(dispatchText, /Design review: 2 required completions/);
    assert.match(dispatchText, /最长 1 小时的 blocking wait/);
    assert.match(dispatchText, /不要当作 `explorer` sidecar/);
    assert.match(dispatchText, /1 个设计作者和 2 个设计评审全部完成并收齐通过结论后暂停/);
    assert.match(dispatchText, /subagent_team\.auto_accept_spec_readiness=false/);
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

    assert.equal(payload.phase, "issue_execution");
    assert.equal(payload.focus_issue_id, "ISSUE-001");
    assert.match(payload.issue_team_dispatch_path, /ISSUE-001\.team\.dispatch\.md$/);
    assert.match(lifecycleText, /Current issue packet/);
    assert.match(lifecycleText, /ISSUE-001\.team\.dispatch\.md/);
    assert.match(lifecycleText, /Gate-bearing seats for this phase/);
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
    assert.equal(payload.team_topology[0]?.label, "Development group");
    assert.equal(payload.team_topology[0]?.count, 3);
    assert.equal(payload.team_topology[0]?.reasoning_effort, "xhigh");
    assert.equal(payload.team_topology[1]?.reasoning_effort, "medium");
    assert.equal(payload.team_topology[1]?.count, 2);
    assert.equal(payload.team_topology[2]?.count, 1);
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
        auto_accept_change_acceptance: true,
        auto_archive_after_verify: true
      }
    }, null, 2));

    const payload = renderLifecycleDispatch({
      repoRoot,
      change: "demo-change",
      phase: "auto",
      issueId: "",
      dryRun: false
    });
    const dispatchText = fs.readFileSync(path.join(repoRoot, payload.lifecycle_dispatch_path), "utf8");

    assert.equal(payload.phase, "change_verify");
    assert.equal(payload.automation_profile, "full_auto");
    assert.equal(payload.automation.accept_change_acceptance, true);
    assert.match(dispatchText, /coordinator_verify_change\.py/);
    assert.match(dispatchText, /subagent_team\.auto_accept_change_acceptance=true/);
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
    assert.match(dispatchText, /coordinator_archive_change\.py/);
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

    const payload = renderLifecycleDispatch({
      repoRoot,
      change: "demo-change",
      phase: "auto",
      issueId: "",
      dryRun: false
    });
    const dispatchText = fs.readFileSync(path.join(repoRoot, payload.lifecycle_dispatch_path), "utf8");

    assert.equal(payload.phase, "change_acceptance");
    assert.match(payload.phase_reason, /需先对当前 change 修改的代码运行 \/review/);
    assert.match(dispatchText, /coordinator_review_change\.py/);
    assert.match(dispatchText, /只有 change-level \/review 通过后，才允许继续进入 verify/);
    assert.match(dispatchText, /任一 required gate-bearing subagent 仍在运行时，不允许提前通过当前 phase/);
  });
});
