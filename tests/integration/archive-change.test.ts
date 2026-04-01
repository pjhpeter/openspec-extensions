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
      cleanup: { branch_deleted: boolean; removed: boolean; required: boolean };
    };
    const branches = git(repoRoot, "branch", "--list", "opsx/demo-change");
    const archiveFlag = fs.readFileSync(path.join(repoRoot, "archived.flag"), "utf8");

    assert.equal(payload.archived, true);
    assert.equal(payload.cleanup.required, true);
    assert.equal(payload.cleanup.removed, true);
    assert.equal(payload.cleanup.branch_deleted, true);
    assert.equal(archiveFlag, "ok");
    assert.equal(branches, "");
  });
});
