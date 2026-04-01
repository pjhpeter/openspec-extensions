import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  automationProfile,
  extractOpenWorkItems,
  issueWorkerWorktreeSetting,
  loadIssueModeConfig,
  readChangeControlState,
} from "../../src/domain/issue-mode";

function withTempDir(run: (repoRoot: string) => void): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-ts-"));
  try {
    run(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("extractOpenWorkItems ignores placeholder list items", () => {
  const items = extractOpenWorkItems([
    "- None.",
    "- \u65e0",
    "- \u6682\u65e0",
    "- n/a",
  ]);

  assert.deepEqual(items, []);
});

test("extractOpenWorkItems keeps real list items", () => {
  const items = extractOpenWorkItems([
    "- \u8865\u9f50 ISSUE-002 \u547d\u4ee4\u8986\u76d6\u77e9\u9635",
    "- add preload transport follow-up change",
  ]);

  assert.deepEqual(items, [
    "\u8865\u9f50 ISSUE-002 \u547d\u4ee4\u8986\u76d6\u77e9\u9635",
    "add preload transport follow-up change",
  ]);
});

test("extractOpenWorkItems ignores completed and placeholder checkbox items", () => {
  const items = extractOpenWorkItems([
    "- [ ] None",
    "- [ ] \u65e0\u5f85\u5904\u7406\u9879",
    "- [ ] \u771f\u6b63\u5f85\u529e\u4e8b\u9879",
    "- [x] \u5df2\u5b8c\u6210\u4e8b\u9879",
  ]);

  assert.deepEqual(items, ["\u771f\u6b63\u5f85\u529e\u4e8b\u9879"]);
});

test("loadIssueModeConfig defaults to shared workspace when config is missing", () => {
  withTempDir((repoRoot) => {
    const config = loadIssueModeConfig(repoRoot);
    const [workerWorktree, source] = issueWorkerWorktreeSetting(repoRoot, "demo-change", "ISSUE-001", config);

    assert.equal(config.worker_worktree.enabled, false);
    assert.equal(config.worker_worktree.scope, "shared");
    assert.equal(config.subagent_team.auto_accept_issue_review, true);
    assert.equal(automationProfile(config), "semi_auto");
    assert.equal(workerWorktree, ".");
    assert.equal(source, "config_default");
  });
});

test("loadIssueModeConfig keeps legacy worker fields and strips detached worker legacy keys", () => {
  withTempDir((repoRoot) => {
    const openspecDir = path.join(repoRoot, "openspec");
    fs.mkdirSync(openspecDir, { recursive: true });
    fs.writeFileSync(
      path.join(openspecDir, "issue-mode.json"),
      JSON.stringify(
        {
          worktree_root: ".worktree",
          validation_commands: ["pnpm lint"],
          worker_worktree: {
            mode: "branch",
            base_ref: "main",
            branch_prefix: "demo",
          },
          rra: {
            gate_mode: "enforce",
          },
          subagent_team: {
            auto_accept_spec_readiness: true,
            auto_accept_issue_planning: true,
            auto_accept_issue_review: true,
            auto_accept_change_acceptance: true,
            auto_archive_after_verify: true,
          },
          codex_home: "~/.codex",
          persistent_host: {
            kind: "screen",
          },
          coordinator_heartbeat: {
            auto_launch_next: true,
          },
          worker_launcher: {
            session_prefix: "legacy",
          },
        },
        null,
        2
      )
    );

    const config = loadIssueModeConfig(repoRoot);
    const configAsRecord = config as unknown as Record<string, unknown>;

    assert.equal(config.worktree_root, ".worktree");
    assert.deepEqual(config.validation_commands, ["pnpm lint"]);
    assert.equal(config.worker_worktree.enabled, true);
    assert.equal(config.worker_worktree.scope, "issue");
    assert.equal(config.worker_worktree.mode, "branch");
    assert.equal(config.worker_worktree.base_ref, "main");
    assert.equal(config.worker_worktree.branch_prefix, "demo");
    assert.equal(config.rra.gate_mode, "enforce");
    assert.equal(config.subagent_team.auto_accept_spec_readiness, true);
    assert.equal(config.subagent_team.auto_accept_issue_planning, true);
    assert.equal(config.subagent_team.auto_accept_issue_review, true);
    assert.equal(config.subagent_team.auto_accept_change_acceptance, true);
    assert.equal(config.subagent_team.auto_archive_after_verify, true);
    assert.equal(Object.hasOwn(configAsRecord, "codex_home"), false);
    assert.equal(Object.hasOwn(configAsRecord, "persistent_host"), false);
    assert.equal(Object.hasOwn(configAsRecord, "coordinator_heartbeat"), false);
    assert.equal(Object.hasOwn(configAsRecord, "worker_launcher"), false);
  });
});

test("issueWorkerWorktreeSetting uses shared workspace for explicit shared config", () => {
  withTempDir((repoRoot) => {
    const openspecDir = path.join(repoRoot, "openspec");
    fs.mkdirSync(openspecDir, { recursive: true });
    fs.writeFileSync(
      path.join(openspecDir, "issue-mode.json"),
      JSON.stringify(
        {
          worktree_root: ".worktree",
          worker_worktree: {
            enabled: false,
            mode: "detach",
            base_ref: "HEAD",
            branch_prefix: "opsx",
          },
        },
        null,
        2
      )
    );

    const config = loadIssueModeConfig(repoRoot);
    const [workerWorktree, source] = issueWorkerWorktreeSetting(repoRoot, "demo-change", "ISSUE-001", config);

    assert.equal(config.worker_worktree.enabled, false);
    assert.equal(config.worker_worktree.scope, "shared");
    assert.equal(workerWorktree, ".");
    assert.equal(source, "config_default");
  });
});

test("issueWorkerWorktreeSetting uses one worktree path per change in change scope", () => {
  withTempDir((repoRoot) => {
    const openspecDir = path.join(repoRoot, "openspec");
    fs.mkdirSync(openspecDir, { recursive: true });
    fs.writeFileSync(
      path.join(openspecDir, "issue-mode.json"),
      JSON.stringify(
        {
          worktree_root: ".worktree",
          worker_worktree: {
            enabled: true,
            scope: "change",
            mode: "detach",
            base_ref: "HEAD",
            branch_prefix: "opsx",
          },
        },
        null,
        2
      )
    );

    const config = loadIssueModeConfig(repoRoot);
    const [firstWorktree, firstSource] = issueWorkerWorktreeSetting(repoRoot, "demo-change", "ISSUE-001", config);
    const [secondWorktree, secondSource] = issueWorkerWorktreeSetting(repoRoot, "demo-change", "ISSUE-002", config);

    assert.equal(config.worker_worktree.enabled, true);
    assert.equal(config.worker_worktree.scope, "change");
    assert.equal(firstWorktree, ".worktree/demo-change");
    assert.equal(secondWorktree, ".worktree/demo-change");
    assert.equal(firstSource, "config_default");
    assert.equal(secondSource, "config_default");
  });
});

test("readChangeControlState extracts structured round contract and backlog", () => {
  withTempDir((repoRoot) => {
    const controlDir = path.join(repoRoot, "openspec", "changes", "demo-change", "control");
    fs.mkdirSync(controlDir, { recursive: true });

    fs.writeFileSync(
      path.join(controlDir, "BACKLOG.md"),
      [
        "# Backlog",
        "",
        "## Must Fix Now",
        "- [ ] \u4fee\u590d ISSUE-002 gate",
        "",
        "## Should Fix If Cheap",
        "- \u8865\u4e00\u6761\u8f7b\u91cf\u65e5\u5fd7",
        "",
        "## Defer",
        "- \u5ef6\u540e\u5904\u7406\u975e\u5173\u952e\u91cd\u6784",
        "",
      ].join("\n")
    );

    fs.writeFileSync(
      path.join(controlDir, "ROUND-02.md"),
      [
        "# Round 2",
        "",
        "## Round Target",
        "- \u8ba9 ISSUE-001 \u8fbe\u5230\u53ef\u63a5\u53d7\u72b6\u6001",
        "",
        "## Target Mode",
        "- release",
        "",
        "## Acceptance Criteria",
        "- \u4e3b\u8def\u5f84\u53ef\u7528",
        "- \u6821\u9a8c\u547d\u4ee4\u80fd\u8dd1\u901a",
        "",
        "## Non-Goals",
        "- \u4e0d\u5904\u7406\u989d\u5916\u91cd\u6784",
        "",
        "## Scope In Round",
        "- ISSUE-001",
        "- src/feature.ts",
        "",
        "## Normalized Backlog",
        "- Must fix now: \u4fee\u590d ISSUE-001 \u56de\u5f52",
        "",
        "## Fixes Completed",
        "- \u8865\u9f50 ISSUE-001 \u7684\u6309\u94ae\u72b6\u6001",
        "",
        "## Re-review Result",
        "- \u5df2\u8986\u76d6\u53d7\u5f71\u54cd\u4e3b\u8def\u5f84",
        "",
        "## Acceptance Verdict",
        "- pass with noted debt",
        "",
        "## Next Action",
        "- \u53ef\u4ee5\u7ee7\u7eed verify\uff0c\u5fc5\u8981\u65f6\u8865\u505a ISSUE-001 follow-up",
        "",
      ].join("\n")
    );

    const state = readChangeControlState(repoRoot, "demo-change") as Record<string, unknown>;
    const backlog = state.backlog as Record<string, unknown>;
    const latestRound = state.latest_round as Record<string, unknown>;
    const mustFixNow = backlog.must_fix_now as Record<string, unknown>;
    const shouldFixIfCheap = backlog.should_fix_if_cheap as Record<string, unknown>;
    const defer = backlog.defer as Record<string, unknown>;

    assert.equal(state.enabled, true);
    assert.deepEqual(mustFixNow.open_items, ["\u4fee\u590d ISSUE-002 gate"]);
    assert.deepEqual(shouldFixIfCheap.open_items, ["\u8865\u4e00\u6761\u8f7b\u91cf\u65e5\u5fd7"]);
    assert.deepEqual(defer.open_items, ["\u5ef6\u540e\u5904\u7406\u975e\u5173\u952e\u91cd\u6784"]);
    assert.equal(latestRound.round_target, "\u8ba9 ISSUE-001 \u8fbe\u5230\u53ef\u63a5\u53d7\u72b6\u6001");
    assert.equal(latestRound.target_mode, "release");
    assert.deepEqual(latestRound.acceptance_criteria, ["\u4e3b\u8def\u5f84\u53ef\u7528", "\u6821\u9a8c\u547d\u4ee4\u80fd\u8dd1\u901a"]);
    assert.deepEqual(latestRound.non_goals, ["\u4e0d\u5904\u7406\u989d\u5916\u91cd\u6784"]);
    assert.deepEqual(latestRound.scope_in_round, ["ISSUE-001", "src/feature.ts"]);
    assert.deepEqual(latestRound.fixes_completed, ["\u8865\u9f50 ISSUE-001 \u7684\u6309\u94ae\u72b6\u6001"]);
    assert.deepEqual(latestRound.re_review_result, ["\u5df2\u8986\u76d6\u53d7\u5f71\u54cd\u4e3b\u8def\u5f84"]);
    assert.equal(latestRound.acceptance_status, "accepted");
    assert.equal(latestRound.allows_verify, true);
    assert.deepEqual(latestRound.referenced_issue_ids, ["ISSUE-001"]);
  });
});
