import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { reviewChange } from "../../src/commands/review";

function withTempDir(run: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-review-change-"));
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

function initGitRepoWithUpstream(repoRoot: string): string {
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-review-change-remote-"));
  execFileSync("git", ["init", "--bare", remoteRoot], { encoding: "utf8" });
  initGitRepo(repoRoot);
  git(repoRoot, "remote", "add", "origin", remoteRoot);
  return remoteRoot;
}

function writeIssueDoc(repoRoot: string, change: string, issueId = "ISSUE-001"): void {
  const issuePath = path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.md`);
  fs.mkdirSync(path.dirname(issuePath), { recursive: true });
  fs.writeFileSync(issuePath, `---
issue_id: ${issueId}
title: Demo issue
worker_worktree: .worktree/${change}/${issueId}
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - complete demo issue
validation:
  - pnpm lint
---
`);
}

function writeIssueProgress(repoRoot: string, change: string, status: string): void {
  const progressPath = path.join(repoRoot, "openspec", "changes", change, "issues", "ISSUE-001.progress.json");
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, JSON.stringify({
    issue_id: "ISSUE-001",
    status,
    updated_at: "2026-03-30T10:00:00+08:00"
  }, null, 2));
}

test("reviewChange writes passed review artifact for unpushed code outside openspec changes", () => {
  withTempDir((repoRoot) => {
    const remoteRoot = initGitRepoWithUpstream(repoRoot);
    try {
      const srcDir = path.join(repoRoot, "src");
      const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
      writeIssueDoc(repoRoot, "demo-change");
      writeIssueProgress(repoRoot, "demo-change", "completed");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "demo.ts"), "export const demo = 1;\n");
      fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
      git(repoRoot, "add", ".");
      git(repoRoot, "commit", "-m", "init");
      git(repoRoot, "branch", "-M", "main");
      git(repoRoot, "push", "-u", "origin", "main");

      fs.writeFileSync(path.join(srcDir, "demo.ts"), "export const demo = 2;\n");
      fs.writeFileSync(path.join(changeDir, "design.md"), "# local docs change\n");
      git(repoRoot, "add", "src/demo.ts", path.join("openspec", "changes", "demo-change", "design.md"));
      git(repoRoot, "commit", "-m", "local unpushed change");
      fs.writeFileSync(path.join(srcDir, "untracked.ts"), "export const untracked = true;\n");

      const reviewCommand = [
        "node",
        "-e",
        JSON.stringify(
          "const { execFileSync } = require('node:child_process');" +
          "const files = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })" +
          ".trim().split(/\\r?\\n/).filter(Boolean).sort();" +
          "const ok = files.includes('src/demo.ts') && files.includes('src/untracked.ts') && !files.some((file) => file.startsWith('openspec/changes/'));" +
          "process.stdout.write(ok ? 'VERDICT: pass\\n' : 'VERDICT: fail\\n' + files.join('\\\\n') + '\\\\n');"
        )
      ].join(" ");
      const payload = reviewChange({
        change: "demo-change",
        dryRun: false,
        repoRoot,
        reviewCommand
      }) as {
        review_scope: { changed_files: string[] };
        status: string;
        verdict: string;
      };
      const artifact = JSON.parse(fs.readFileSync(
        path.join(repoRoot, "openspec", "changes", "demo-change", "runs", "CHANGE-REVIEW.json"),
        "utf8"
      )) as { review_scope: { changed_files: string[] }; status: string };

      assert.equal(payload.status, "passed");
      assert.equal(payload.verdict, "pass");
      assert.equal(artifact.status, "passed");
      assert.deepEqual(payload.review_scope.changed_files, ["src/demo.ts", "src/untracked.ts"]);
      assert.deepEqual(artifact.review_scope.changed_files, ["src/demo.ts", "src/untracked.ts"]);
    } finally {
      fs.rmSync(remoteRoot, { recursive: true, force: true });
    }
  });
});

test("reviewChange refuses review when issues are incomplete", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(repoRoot, "demo-change");
    writeIssueProgress(repoRoot, "demo-change", "in_progress");

    const payload = reviewChange({
      change: "demo-change",
      dryRun: false,
      repoRoot,
      reviewCommand: "printf 'VERDICT: pass\\n'"
    }) as { status: string; summary: string };
    const artifact = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "openspec", "changes", "demo-change", "runs", "CHANGE-REVIEW.json"),
      "utf8"
    )) as { status: string };

    assert.equal(payload.status, "failed");
    assert.match(payload.summary, /not completed/);
    assert.equal(artifact.status, "failed");
  });
});

test("reviewChange fails without an upstream tracking branch", () => {
  withTempDir((repoRoot) => {
    initGitRepo(repoRoot);
    writeIssueDoc(repoRoot, "demo-change");
    writeIssueProgress(repoRoot, "demo-change", "completed");
    fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "src", "demo.ts"), "export const demo = 1;\n");
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init");

    const payload = reviewChange({
      change: "demo-change",
      dryRun: false,
      repoRoot,
      reviewCommand: "printf 'VERDICT: pass\\n'"
    }) as { status: string; summary: string };

    assert.equal(payload.status, "failed");
    assert.match(payload.summary, /upstream tracking branch/);
  });
});
