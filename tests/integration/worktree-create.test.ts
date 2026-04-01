import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkerWorktree } from "../../src/commands/worktree";

function withTempDir(run: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-worktree-create-"));
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

test("createWorkerWorktree reuses repo root for shared workspace mode", () => {
  withTempDir((repoRoot) => {
    const configPath = path.join(repoRoot, "openspec", "issue-mode.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      worker_worktree: {
        enabled: false
      }
    }, null, 2));

    const payload = createWorkerWorktree({
      baseRef: "",
      branchName: "",
      change: "demo-change",
      dryRun: false,
      issueId: "ISSUE-001",
      mode: "",
      repoRoot
    }) as { base_ref: string; branch_name: string; created: boolean; existed: boolean; mode: string; shared_workspace: boolean; worktree: string; worktree_relative: string };

    assert.equal(path.resolve(payload.worktree), path.resolve(repoRoot));
    assert.equal(payload.worktree_relative, ".");
    assert.equal(payload.mode, "shared");
    assert.equal(payload.base_ref, "");
    assert.equal(payload.branch_name, "");
    assert.equal(payload.shared_workspace, true);
    assert.equal(payload.created, false);
    assert.equal(payload.existed, true);
  });
});

test("createWorkerWorktree reuses one change-scope worktree across issues", () => {
  withTempDir((repoRoot) => {
    const configPath = path.join(repoRoot, "openspec", "issue-mode.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      worker_worktree: {
        enabled: true,
        scope: "change",
        mode: "branch",
        base_ref: "HEAD",
        branch_prefix: "opsx"
      }
    }, null, 2));

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(repoRoot, "README.md"), "demo\n");
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init");

    const firstPayload = createWorkerWorktree({
      baseRef: "",
      branchName: "",
      change: "demo-change",
      dryRun: false,
      issueId: "ISSUE-001",
      mode: "",
      repoRoot
    }) as { branch_name: string; created: boolean; workspace_scope: string; worktree_relative: string };
    const secondPayload = createWorkerWorktree({
      baseRef: "",
      branchName: "",
      change: "demo-change",
      dryRun: false,
      issueId: "ISSUE-002",
      mode: "",
      repoRoot
    }) as { branch_name: string; created: boolean; workspace_scope: string; worktree_relative: string };

    assert.equal(firstPayload.workspace_scope, "change");
    assert.equal(secondPayload.workspace_scope, "change");
    assert.equal(firstPayload.created, true);
    assert.equal(secondPayload.created, false);
    assert.equal(firstPayload.worktree_relative, ".worktree/demo-change");
    assert.equal(secondPayload.worktree_relative, ".worktree/demo-change");
    assert.equal(firstPayload.branch_name, "opsx/demo-change");
    assert.equal(secondPayload.branch_name, "opsx/demo-change");
  });
});

test("createWorkerWorktree creates an issue-scoped worktree per issue", () => {
  withTempDir((repoRoot) => {
    const configPath = path.join(repoRoot, "openspec", "issue-mode.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      worker_worktree: {
        enabled: true,
        scope: "issue",
        mode: "branch",
        base_ref: "HEAD",
        branch_prefix: "opsx"
      }
    }, null, 2));

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(repoRoot, "README.md"), "demo\n");
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init");

    const firstPayload = createWorkerWorktree({
      baseRef: "",
      branchName: "",
      change: "demo-change",
      dryRun: false,
      issueId: "ISSUE-001",
      mode: "",
      repoRoot
    }) as { branch_name: string; created: boolean; workspace_scope: string; worktree_relative: string };
    const secondPayload = createWorkerWorktree({
      baseRef: "",
      branchName: "",
      change: "demo-change",
      dryRun: false,
      issueId: "ISSUE-002",
      mode: "",
      repoRoot
    }) as { branch_name: string; created: boolean; workspace_scope: string; worktree_relative: string };

    assert.equal(firstPayload.workspace_scope, "issue");
    assert.equal(secondPayload.workspace_scope, "issue");
    assert.equal(firstPayload.created, true);
    assert.equal(secondPayload.created, true);
    assert.equal(firstPayload.worktree_relative, ".worktree/demo-change/ISSUE-001");
    assert.equal(secondPayload.worktree_relative, ".worktree/demo-change/ISSUE-002");
    assert.equal(firstPayload.branch_name, "opsx/demo-change/ISSUE-001");
    assert.equal(secondPayload.branch_name, "opsx/demo-change/ISSUE-002");
  });
});

test("createWorkerWorktree blocks when enforce gate disallows dispatch", () => {
  withTempDir((repoRoot) => {
    const configPath = path.join(repoRoot, "openspec", "issue-mode.json");
    const backlogPath = path.join(repoRoot, "openspec", "changes", "demo-change", "control", "BACKLOG.md");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.mkdirSync(path.dirname(backlogPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      rra: {
        gate_mode: "enforce"
      },
      worker_worktree: {
        enabled: true,
        scope: "issue",
        mode: "detach",
        base_ref: "HEAD",
        branch_prefix: "opsx"
      }
    }, null, 2));
    fs.writeFileSync(backlogPath, "## Must Fix Now\n- fix blocking regression\n");

    assert.throws(
      () => createWorkerWorktree({
        baseRef: "",
        branchName: "",
        change: "demo-change",
        dryRun: false,
        issueId: "ISSUE-001",
        mode: "",
        repoRoot
      }),
      /Dispatch blocked by RRA gate/
    );
  });
});
