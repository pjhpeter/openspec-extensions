import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import {
  artifactIsCurrent,
  incompleteTasks,
  planningDocStatus,
  reviewArtifactIsCurrent,
  syncTasksForIssues
} from "../../src/domain/change-coordinator";

function withTempDir(run: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-change-coordinator-"));
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

test("planningDocStatus reports only planning-doc dirty paths", () => {
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
    git(repoRoot, "commit", "-m", "init");

    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
    fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [ ] 1.1 split work\n");
    fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n");
    fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), "# issue\n");
    fs.writeFileSync(path.join(srcDir, "keep.ts"), "export const keep = 2;\n");

    const status = planningDocStatus(repoRoot, change) as {
      dirty_paths: string[];
      git_available: boolean;
      needs_commit: boolean;
      paths: string[];
    };

    assert.equal(status.git_available, true);
    assert.equal(status.needs_commit, true);
    assert.ok(status.paths.includes(`openspec/changes/${change}/proposal.md`));
    assert.ok(status.dirty_paths.includes(`openspec/changes/${change}/proposal.md`));
    assert.equal(status.dirty_paths.includes("src/keep.ts"), false);
  });
});

test("syncTasksForIssues marks mapped tasks complete", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    fs.mkdirSync(issuesDir, { recursive: true });

    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [ ] 1.1 first task\n- [ ] 1.2 second task\n");
    fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n- `ISSUE-002` `1.2`\n");

    const result = syncTasksForIssues(repoRoot, change, ["ISSUE-001"]) as {
      changed: boolean;
      mapped_task_ids: string[];
      updated_task_ids: string[];
    };
    const tasksText = fs.readFileSync(path.join(changeDir, "tasks.md"), "utf8");

    assert.equal(result.changed, true);
    assert.deepEqual(result.mapped_task_ids, ["1.1"]);
    assert.deepEqual(result.updated_task_ids, ["1.1"]);
    assert.match(tasksText, /- \[x\] 1\.1 first task/);
    assert.match(tasksText, /- \[ \] 1\.2 second task/);
  });
});

test("incompleteTasks returns unchecked task rows", () => {
  withTempDir((repoRoot) => {
    const tasksPath = path.join(repoRoot, "tasks.md");
    fs.writeFileSync(tasksPath, "- [x] 1.1 done\n- [ ] 1.2 pending task\n");

    const tasks = incompleteTasks(tasksPath);
    assert.deepEqual(tasks, [{ task_id: "1.2", line: "- [ ] 1.2 pending task" }]);
  });
});

test("artifact freshness compares artifact time against latest issue time", () => {
  const issues = [
    { issue_id: "ISSUE-001", updated_at: "2026-03-30T10:00:00+08:00" },
    { issue_id: "ISSUE-002", updated_at: "2026-03-30T10:05:00+08:00" }
  ];

  assert.equal(
    artifactIsCurrent(issues, { updated_at: "2026-03-30T10:06:00+08:00" }),
    true
  );
  assert.equal(
    reviewArtifactIsCurrent(issues, { updated_at: "2026-03-30T10:04:00+08:00" }),
    false
  );
});
