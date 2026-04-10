import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { commitPlanningDocs } from "../../src/commands/reconcile";

function withTempDir(run: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-commit-planning-"));
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

test("commitPlanningDocs commits only planning docs for change", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(srcDir, "keep.ts"), "export const keep = 1;\n");
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init repo");

    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
    fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [ ] 1.1 split work\n");
    fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n");
    fs.writeFileSync(issuesDir + "/ISSUE-001.md", `---
issue_id: ISSUE-001
title: Demo issue
worker_worktree: .
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
    fs.writeFileSync(path.join(srcDir, "keep.ts"), "export const keep = 2;\n");

    const payload = commitPlanningDocs({
      change,
      commitMessage: "",
      dryRun: false,
      repoRoot
    }) as { commit_sha?: string; status: string };
    const status = git(repoRoot, "status", "--short");
    const headMessage = git(repoRoot, "log", "-1", "--pretty=%s");
    const headBody = git(repoRoot, "log", "-1", "--pretty=%B");
    const committedFiles = git(repoRoot, "show", "--pretty=", "--name-only", "HEAD");

    assert.equal(payload.status, "committed");
    assert.match(String(payload.commit_sha), /^[0-9a-f]{40}$/);
    assert.equal(headMessage, `opsx(${change}): commit planning docs`);
    assert.match(headBody, /- snapshot proposal, design, tasks, and issue docs before the first issue dispatch/);
    assert.match(headBody, /- keep the planning-doc commit boundary separate from issue execution/);
    assert.match(headBody, /- include proposal\.md, design\.md, tasks\.md, INDEX\.md; ISSUE-001/);
    assert.match(status, /src\/keep\.ts/);
    assert.match(committedFiles, new RegExp(`openspec/changes/${change}/proposal\\.md`));
    assert.match(committedFiles, new RegExp(`openspec/changes/${change}/design\\.md`));
    assert.match(committedFiles, new RegExp(`openspec/changes/${change}/tasks\\.md`));
    assert.match(committedFiles, new RegExp(`openspec/changes/${change}/issues/INDEX\\.md`));
    assert.match(committedFiles, new RegExp(`openspec/changes/${change}/issues/ISSUE-001\\.md`));
    assert.doesNotMatch(committedFiles, /src\/keep\.ts/);
  });
});
