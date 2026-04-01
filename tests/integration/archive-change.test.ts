import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { archiveChange } from "../../src/commands/archive";

function withTempDir(run: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-archive-change-"));
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

function writeIssueDoc(repoRoot: string, change: string, issueId: string, workerWorktree?: string): void {
  const issuesDir = path.join(repoRoot, "openspec", "changes", change, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });
  const frontmatter = [
    "---",
    `issue_id: ${issueId}`,
    "title: Demo issue",
    ...(workerWorktree ? [`worker_worktree: ${workerWorktree}`] : []),
    "---",
    "",
    "Body",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), frontmatter);
}

test("archiveChange cleans change worktree wrapper state", () => {
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

    const worktreePath = path.join(repoRoot, ".worktree", "demo-change");
    git(repoRoot, "worktree", "add", "-b", "opsx/demo-change", worktreePath, "HEAD");

    const payload = archiveChange({
      archiveCommand: `${JSON.stringify(process.execPath)} -e "require('node:fs').writeFileSync('archived.flag', 'ok')"`,
      change: "demo-change",
      dryRun: false,
      repoRoot,
      skipCleanup: false
    }) as {
      archived: boolean;
      cleanup: {
        branch_deleted: boolean;
        removed: boolean;
        required: boolean;
        targets: Array<{ worktree_relative: string }>;
      };
    };
    const branches = git(repoRoot, "branch", "--list", "opsx/demo-change");
    const archiveFlag = fs.readFileSync(path.join(repoRoot, "archived.flag"), "utf8");

    assert.equal(payload.archived, true);
    assert.equal(payload.cleanup.required, true);
    assert.equal(payload.cleanup.removed, true);
    assert.equal(payload.cleanup.branch_deleted, true);
    assert.deepEqual(payload.cleanup.targets.map((target) => target.worktree_relative), [".worktree/demo-change"]);
    assert.equal(archiveFlag, "ok");
    assert.equal(branches, "");
  });
});

test("archiveChange cleans issue-scoped worktrees for all issue docs", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
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

    writeIssueDoc(repoRoot, change, "ISSUE-001");
    writeIssueDoc(repoRoot, change, "ISSUE-002");

    const worktreeOne = path.join(repoRoot, ".worktree", change, "ISSUE-001");
    const worktreeTwo = path.join(repoRoot, ".worktree", change, "ISSUE-002");
    git(repoRoot, "worktree", "add", "-b", "opsx/demo-change/ISSUE-001", worktreeOne, "HEAD");
    git(repoRoot, "worktree", "add", "-b", "opsx/demo-change/ISSUE-002", worktreeTwo, "HEAD");

    const payload = archiveChange({
      archiveCommand: `${JSON.stringify(process.execPath)} -e "require('node:fs').writeFileSync('archived.flag', 'ok')"`,
      change,
      dryRun: false,
      repoRoot,
      skipCleanup: false
    }) as {
      archived: boolean;
      cleanup: {
        branch_deleted: boolean;
        removed: boolean;
        required: boolean;
        targets: Array<{ removed: boolean; worktree_relative: string }>;
      };
    };

    assert.equal(payload.archived, true);
    assert.equal(payload.cleanup.required, true);
    assert.equal(payload.cleanup.removed, true);
    assert.equal(payload.cleanup.branch_deleted, true);
    assert.deepEqual(
      payload.cleanup.targets.map((target) => target.worktree_relative),
      [".worktree/demo-change/ISSUE-001", ".worktree/demo-change/ISSUE-002"]
    );
    assert.ok(payload.cleanup.targets.every((target) => target.removed));
    assert.equal(fs.existsSync(worktreeOne), false);
    assert.equal(fs.existsSync(worktreeTwo), false);
    assert.equal(git(repoRoot, "branch", "--list", "opsx/demo-change/ISSUE-001"), "");
    assert.equal(git(repoRoot, "branch", "--list", "opsx/demo-change/ISSUE-002"), "");
  });
});

test("archiveChange cleans issue-doc worktree even when config is shared", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const configPath = path.join(repoRoot, "openspec", "issue-mode.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      worker_worktree: {
        enabled: false,
        scope: "shared",
        mode: "detach",
        base_ref: "HEAD",
        branch_prefix: "opsx"
      }
    }, null, 2));

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(repoRoot, "README.md"), "demo\n");
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init");

    writeIssueDoc(repoRoot, change, "ISSUE-001", ".worktree/demo-change");

    const worktreePath = path.join(repoRoot, ".worktree", change);
    git(repoRoot, "worktree", "add", "--detach", worktreePath, "HEAD");

    const payload = archiveChange({
      archiveCommand: `${JSON.stringify(process.execPath)} -e "require('node:fs').writeFileSync('archived.flag', 'ok')"`,
      change,
      dryRun: false,
      repoRoot,
      skipCleanup: false
    }) as {
      archived: boolean;
      cleanup: {
        branch_deleted: boolean;
        removed: boolean;
        required: boolean;
        targets: Array<{ worktree_relative: string }>;
      };
    };

    assert.equal(payload.archived, true);
    assert.equal(payload.cleanup.required, true);
    assert.equal(payload.cleanup.removed, true);
    assert.equal(payload.cleanup.branch_deleted, false);
    assert.deepEqual(payload.cleanup.targets.map((target) => target.worktree_relative), [".worktree/demo-change"]);
    assert.equal(fs.existsSync(worktreePath), false);
  });
});
