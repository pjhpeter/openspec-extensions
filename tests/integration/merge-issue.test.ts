import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { mergeIssue } from "../../src/commands/merge-issue";

function withTempDir(run: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-merge-issue-"));
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

test("mergeIssue accepts and commits shared workspace changes", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    const runsDir = path.join(changeDir, "runs");
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(runsDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(srcDir, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Shared workspace issue
worker_worktree: .
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - complete shared workspace acceptance
validation:
  - pnpm lint
  - pnpm type-check
---
`);
    fs.writeFileSync(path.join(issuesDir, `${issueId}.progress.json`), JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      summary: "ready",
      validation: {
        lint: "passed",
        typecheck: "passed"
      },
      changed_files: ["src/demo.ts"],
      run_id: "RUN-20260331T000000-ISSUE-001",
      updated_at: "2026-03-31T00:00:00+08:00"
    }, null, 2));
    fs.writeFileSync(path.join(runsDir, "RUN-20260331T000000-ISSUE-001.json"), JSON.stringify({
      run_id: "RUN-20260331T000000-ISSUE-001",
      issue_id: issueId
    }, null, 2));

    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init change artifacts");
    fs.writeFileSync(path.join(srcDir, "demo.ts"), "export const demo = 2;\n");

    const payload = mergeIssue({
      change,
      commitMessage: "",
      dryRun: false,
      force: false,
      issueId,
      repoRoot
    }) as { changed_files: string[]; shared_workspace: boolean };
    const progress = JSON.parse(fs.readFileSync(path.join(issuesDir, `${issueId}.progress.json`), "utf8")) as { boundary_status: string; status: string };
    const runArtifact = JSON.parse(fs.readFileSync(path.join(runsDir, "RUN-20260331T000000-ISSUE-001.json"), "utf8")) as { boundary_status: string };
    const status = git(repoRoot, "status", "--short");
    const headMessage = git(repoRoot, "log", "-1", "--pretty=%s");

    assert.equal(payload.shared_workspace, true);
    assert.deepEqual(payload.changed_files, ["src/demo.ts"]);
    assert.equal(progress.boundary_status, "done");
    assert.equal(progress.status, "completed");
    assert.equal(runArtifact.boundary_status, "done");
    assert.equal(status, "");
    assert.equal(headMessage, `opsx(${change}): accept ${issueId}`);
  });
});

test("mergeIssue syncs change-scope worktree after acceptance", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    const runsDir = path.join(changeDir, "runs");
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(runsDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.mkdirSync(path.join(repoRoot, "openspec"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "openspec", "issue-mode.json"), JSON.stringify({
      worker_worktree: {
        enabled: true,
        scope: "change",
        mode: "branch",
        base_ref: "HEAD",
        branch_prefix: "opsx"
      }
    }, null, 2));
    fs.writeFileSync(path.join(srcDir, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Change workspace issue
worker_worktree: .worktree/${change}
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - complete change workspace acceptance
validation:
  - pnpm lint
  - pnpm type-check
---
`);
    fs.writeFileSync(path.join(issuesDir, `${issueId}.progress.json`), JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      summary: "ready",
      validation: {
        lint: "passed",
        typecheck: "passed"
      },
      changed_files: ["src/demo.ts"],
      run_id: "RUN-20260401T000000-ISSUE-001",
      updated_at: "2026-04-01T00:00:00+08:00"
    }, null, 2));
    fs.writeFileSync(path.join(runsDir, "RUN-20260401T000000-ISSUE-001.json"), JSON.stringify({
      run_id: "RUN-20260401T000000-ISSUE-001",
      issue_id: issueId
    }, null, 2));

    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init change artifacts");
    git(repoRoot, "worktree", "add", "-b", "opsx/demo-change", path.join(repoRoot, ".worktree", change), "HEAD");

    const workerRoot = path.join(repoRoot, ".worktree", change);
    const workerDemo = path.join(workerRoot, "src", "demo.ts");
    fs.writeFileSync(workerDemo, "export const demo = 2;\n");
    fs.writeFileSync(path.join(workerRoot, "src", "extra.ts"), "export const extra = 1;\n");

    const payload = mergeIssue({
      change,
      commitMessage: "",
      dryRun: false,
      force: false,
      issueId,
      repoRoot
    }) as { shared_workspace: boolean; workspace_scope: string };
    const workerStatus = git(workerRoot, "status", "--short");
    const syncedDemo = fs.readFileSync(workerDemo, "utf8");
    const headMessage = git(repoRoot, "log", "-1", "--pretty=%s");
    const workerHead = git(workerRoot, "rev-parse", "HEAD");
    const repoHead = git(repoRoot, "rev-parse", "HEAD");

    assert.equal(payload.shared_workspace, false);
    assert.equal(payload.workspace_scope, "change");
    assert.equal(workerStatus, "");
    assert.equal(syncedDemo, "export const demo = 2;\n");
    assert.equal(workerHead, repoHead);
    assert.equal(headMessage, `opsx(${change}): accept ${issueId}`);
  });
});

test("mergeIssue accepts issue-scope worktree changes", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    const runsDir = path.join(changeDir, "runs");
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(runsDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.mkdirSync(path.join(repoRoot, "openspec"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "openspec", "issue-mode.json"), JSON.stringify({
      worker_worktree: {
        enabled: true,
        scope: "issue",
        mode: "branch",
        base_ref: "HEAD",
        branch_prefix: "opsx"
      }
    }, null, 2));
    fs.writeFileSync(path.join(srcDir, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Issue workspace issue
worker_worktree: .worktree/${change}/${issueId}
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - complete issue workspace acceptance
validation:
  - pnpm lint
---
`);
    fs.writeFileSync(path.join(issuesDir, `${issueId}.progress.json`), JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      run_id: "RUN-20260402T000000-ISSUE-001",
      updated_at: "2026-04-02T00:00:00+08:00"
    }, null, 2));
    fs.writeFileSync(path.join(runsDir, "RUN-20260402T000000-ISSUE-001.json"), JSON.stringify({
      run_id: "RUN-20260402T000000-ISSUE-001",
      issue_id: issueId
    }, null, 2));

    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init issue artifacts");
    const workerRoot = path.join(repoRoot, ".worktree", change, issueId);
    git(repoRoot, "worktree", "add", "-b", `opsx/${change}/${issueId}`, workerRoot, "HEAD");
    fs.writeFileSync(path.join(workerRoot, "src", "demo.ts"), "export const demo = 3;\n");

    const payload = mergeIssue({
      change,
      commitMessage: "",
      dryRun: false,
      force: false,
      issueId,
      repoRoot
    }) as { shared_workspace: boolean; workspace_scope: string };

    assert.equal(payload.shared_workspace, false);
    assert.equal(payload.workspace_scope, "issue");
    assert.equal(fs.readFileSync(path.join(repoRoot, "src", "demo.ts"), "utf8"), "export const demo = 3;\n");
    assert.equal(git(repoRoot, "log", "-1", "--pretty=%s"), `opsx(${change}): accept ${issueId}`);
  });
});

test("mergeIssue dry-run leaves progress and run artifacts unchanged", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    const runsDir = path.join(changeDir, "runs");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(runsDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Dry run issue
worker_worktree: .
allowed_scope:
  - demo.ts
out_of_scope:
  - electron/
done_when:
  - keep artifacts unchanged
---
`);
    const progressPath = path.join(issuesDir, `${issueId}.progress.json`);
    const runPath = path.join(runsDir, "RUN-20260403T000000-ISSUE-001.json");
    fs.writeFileSync(progressPath, JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      run_id: "RUN-20260403T000000-ISSUE-001",
      updated_at: "2026-04-03T00:00:00+08:00"
    }, null, 2));
    fs.writeFileSync(runPath, JSON.stringify({
      run_id: "RUN-20260403T000000-ISSUE-001",
      issue_id: issueId,
      keep: true
    }, null, 2));
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init dry-run artifacts");
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 2;\n");

    const beforeProgress = fs.readFileSync(progressPath, "utf8");
    const beforeRun = fs.readFileSync(runPath, "utf8");
    const payload = mergeIssue({
      change,
      commitMessage: "",
      dryRun: true,
      force: false,
      issueId,
      repoRoot
    }) as { dry_run: boolean };

    assert.equal(payload.dry_run, true);
    assert.equal(fs.readFileSync(progressPath, "utf8"), beforeProgress);
    assert.equal(fs.readFileSync(runPath, "utf8"), beforeRun);
    assert.equal(git(repoRoot, "log", "-1", "--pretty=%s"), "init dry-run artifacts");
  });
});

test("mergeIssue force bypasses review-ready gate", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    fs.mkdirSync(issuesDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Force merge issue
worker_worktree: .
allowed_scope:
  - demo.ts
out_of_scope:
  - electron/
done_when:
  - force merge succeeds
---
`);
    fs.writeFileSync(path.join(issuesDir, `${issueId}.progress.json`), JSON.stringify({
      change,
      issue_id: issueId,
      status: "in_progress",
      boundary_status: "",
      next_action: "",
      updated_at: "2026-04-03T00:00:00+08:00"
    }, null, 2));
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init force artifacts");
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 2;\n");

    const payload = mergeIssue({
      change,
      commitMessage: "",
      dryRun: false,
      force: true,
      issueId,
      repoRoot
    }) as { commit_sha: string };

    assert.match(String(payload.commit_sha), /^[0-9a-f]{40}$/);
    assert.equal(git(repoRoot, "log", "-1", "--pretty=%s"), `opsx(${change}): accept ${issueId}`);
  });
});

test("mergeIssue falls back to latest run artifact when progress has no run_id", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    const runsDir = path.join(changeDir, "runs");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(runsDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Latest run fallback
worker_worktree: .
allowed_scope:
  - demo.ts
out_of_scope:
  - electron/
done_when:
  - latest run is updated
---
`);
    fs.writeFileSync(path.join(issuesDir, `${issueId}.progress.json`), JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      updated_at: "2026-04-03T00:00:00+08:00"
    }, null, 2));
    const olderRun = path.join(runsDir, "RUN-20260402T000000-ISSUE-001.json");
    const latestRun = path.join(runsDir, "RUN-20260404T000000-ISSUE-001.json");
    fs.writeFileSync(olderRun, JSON.stringify({ run_id: "RUN-20260402T000000-ISSUE-001" }, null, 2));
    fs.writeFileSync(latestRun, JSON.stringify({ run_id: "RUN-20260404T000000-ISSUE-001" }, null, 2));
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init latest-run artifacts");
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 2;\n");

    const payload = mergeIssue({
      change,
      commitMessage: "",
      dryRun: false,
      force: false,
      issueId,
      repoRoot
    }) as { run_path: string };
    const latestRunPayload = JSON.parse(fs.readFileSync(latestRun, "utf8")) as { boundary_status: string };

    assert.equal(payload.run_path, `openspec/changes/${change}/runs/RUN-20260404T000000-ISSUE-001.json`);
    assert.equal(latestRunPayload.boundary_status, "done");
  });
});

test("mergeIssue rejects when there are no reviewable changes", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    fs.mkdirSync(issuesDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: No-op merge issue
worker_worktree: .
allowed_scope:
  - demo.ts
out_of_scope:
  - electron/
done_when:
  - no reviewable changes
---
`);
    fs.writeFileSync(path.join(issuesDir, `${issueId}.progress.json`), JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      updated_at: "2026-04-03T00:00:00+08:00"
    }, null, 2));
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init no-op artifacts");

    assert.throws(
      () => mergeIssue({
        change,
        commitMessage: "",
        dryRun: false,
        force: false,
        issueId,
        repoRoot
      }),
      /No reviewable changes found/
    );
  });
});

test("mergeIssue leaves issue-scope worktree untouched after acceptance", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    const runsDir = path.join(changeDir, "runs");
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(runsDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.mkdirSync(path.join(repoRoot, "openspec"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "openspec", "issue-mode.json"), JSON.stringify({
      worker_worktree: {
        enabled: true,
        scope: "issue",
        mode: "branch",
        base_ref: "HEAD",
        branch_prefix: "opsx"
      }
    }, null, 2));
    fs.writeFileSync(path.join(srcDir, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Issue workspace issue
worker_worktree: .worktree/${change}/${issueId}
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - complete issue workspace acceptance
validation:
  - pnpm lint
  - pnpm type-check
---
`);
    fs.writeFileSync(path.join(issuesDir, `${issueId}.progress.json`), JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      summary: "ready",
      validation: {
        lint: "passed",
        typecheck: "passed"
      },
      changed_files: ["src/demo.ts"],
      run_id: "RUN-20260402T000000-ISSUE-001",
      updated_at: "2026-04-02T00:00:00+08:00"
    }, null, 2));
    fs.writeFileSync(path.join(runsDir, "RUN-20260402T000000-ISSUE-001.json"), JSON.stringify({
      run_id: "RUN-20260402T000000-ISSUE-001",
      issue_id: issueId
    }, null, 2));

    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init issue artifacts");
    git(
      repoRoot,
      "worktree",
      "add",
      "-b",
      "opsx/demo-change/ISSUE-001",
      path.join(repoRoot, ".worktree", change, issueId),
      "HEAD"
    );

    const workerRoot = path.join(repoRoot, ".worktree", change, issueId);
    const workerDemo = path.join(workerRoot, "src", "demo.ts");
    fs.writeFileSync(workerDemo, "export const demo = 3;\n");
    fs.writeFileSync(path.join(workerRoot, "src", "extra.ts"), "export const extra = 2;\n");

    const payload = mergeIssue({
      change,
      commitMessage: "",
      dryRun: false,
      force: false,
      issueId,
      repoRoot
    }) as { shared_workspace: boolean; workspace_scope: string };
    const repoStatus = git(repoRoot, "status", "--short");
    const workerStatus = git(workerRoot, "status", "--short");
    const repoHead = git(repoRoot, "rev-parse", "HEAD");
    const workerHead = git(workerRoot, "rev-parse", "HEAD");
    const repoDemo = fs.readFileSync(path.join(repoRoot, "src", "demo.ts"), "utf8");
    const workerDemoText = fs.readFileSync(workerDemo, "utf8");

    assert.equal(payload.shared_workspace, false);
    assert.equal(payload.workspace_scope, "issue");
    assert.equal(repoStatus, "?? .worktree/");
    assert.notEqual(workerStatus, "");
    assert.notEqual(workerHead, repoHead);
    assert.equal(repoDemo, "export const demo = 3;\n");
    assert.equal(workerDemoText, "export const demo = 3;\n");
  });
});

test("mergeIssue applies tracked rename and deletion from change-scope worktree", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    const runsDir = path.join(changeDir, "runs");
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(runsDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.mkdirSync(path.join(repoRoot, "openspec"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "openspec", "issue-mode.json"), JSON.stringify({
      worker_worktree: {
        enabled: true,
        scope: "change",
        mode: "branch",
        base_ref: "HEAD",
        branch_prefix: "opsx"
      }
    }, null, 2));
    fs.writeFileSync(path.join(srcDir, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(srcDir, "remove.ts"), "export const remove = true;\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Rename and delete issue
worker_worktree: .worktree/${change}
allowed_scope:
  - src/demo.ts
  - src/remove.ts
out_of_scope:
  - electron/
done_when:
  - complete rename and delete acceptance
validation:
  - pnpm lint
  - pnpm type-check
---
`);
    fs.writeFileSync(path.join(issuesDir, `${issueId}.progress.json`), JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      summary: "ready",
      validation: {
        lint: "passed",
        typecheck: "passed"
      },
      changed_files: ["src/demo.ts", "src/remove.ts"],
      run_id: "RUN-20260403T000000-ISSUE-001",
      updated_at: "2026-04-03T00:00:00+08:00"
    }, null, 2));
    fs.writeFileSync(path.join(runsDir, "RUN-20260403T000000-ISSUE-001.json"), JSON.stringify({
      run_id: "RUN-20260403T000000-ISSUE-001",
      issue_id: issueId
    }, null, 2));

    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init rename artifacts");
    git(repoRoot, "worktree", "add", "-b", "opsx/demo-change", path.join(repoRoot, ".worktree", change), "HEAD");

    const workerRoot = path.join(repoRoot, ".worktree", change);
    fs.renameSync(path.join(workerRoot, "src", "demo.ts"), path.join(workerRoot, "src", "renamed.ts"));
    fs.rmSync(path.join(workerRoot, "src", "remove.ts"));

    const payload = mergeIssue({
      change,
      commitMessage: "",
      dryRun: false,
      force: false,
      issueId,
      repoRoot
    }) as { changed_files: string[]; workspace_scope: string };
    const repoHead = git(repoRoot, "rev-parse", "HEAD");
    const workerHead = git(workerRoot, "rev-parse", "HEAD");
    const workerStatus = git(workerRoot, "status", "--short");

    assert.equal(payload.workspace_scope, "change");
    assert.equal(workerHead, repoHead);
    assert.equal(workerStatus, "");
    assert.ok(fs.existsSync(path.join(repoRoot, "src", "renamed.ts")));
    assert.equal(fs.existsSync(path.join(repoRoot, "src", "demo.ts")), false);
    assert.equal(fs.existsSync(path.join(repoRoot, "src", "remove.ts")), false);
    assert.ok(payload.changed_files.includes("src/demo.ts") || payload.changed_files.includes("src/renamed.ts"));
  });
});

test("mergeIssue accepts coordinator_review next_action without review_required boundary", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    fs.mkdirSync(issuesDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Review gate fallback
worker_worktree: .
allowed_scope:
  - demo.ts
out_of_scope:
  - electron/
done_when:
  - next_action gate is enough
---
`);
    fs.writeFileSync(path.join(issuesDir, `${issueId}.progress.json`), JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "not_ready",
      next_action: "coordinator_review",
      updated_at: "2026-04-04T00:00:00+08:00"
    }, null, 2));
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init review gate artifacts");
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 2;\n");

    const payload = mergeIssue({
      change,
      commitMessage: "",
      dryRun: true,
      force: false,
      issueId,
      repoRoot
    }) as { changed_files: string[]; dry_run: boolean };

    assert.equal(payload.dry_run, true);
    assert.deepEqual(payload.changed_files, ["demo.ts"]);
  });
});

test("mergeIssue dry-run skips dirty target enforcement for change worktrees", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    const runsDir = path.join(changeDir, "runs");
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(runsDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.mkdirSync(path.join(repoRoot, "openspec"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "openspec", "issue-mode.json"), JSON.stringify({
      worker_worktree: {
        enabled: true,
        scope: "change",
        mode: "branch",
        base_ref: "HEAD",
        branch_prefix: "opsx"
      }
    }, null, 2));
    fs.writeFileSync(path.join(srcDir, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(repoRoot, "README.md"), "clean\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Dirty target dry run
worker_worktree: .worktree/${change}
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - dry run ignores dirty target
---
`);
    fs.writeFileSync(path.join(issuesDir, `${issueId}.progress.json`), JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      run_id: "RUN-20260404T000000-ISSUE-001",
      updated_at: "2026-04-04T00:00:00+08:00"
    }, null, 2));
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init dirty dry-run artifacts");
    git(repoRoot, "worktree", "add", "-b", "opsx/demo-change", path.join(repoRoot, ".worktree", change), "HEAD");

    const workerRoot = path.join(repoRoot, ".worktree", change);
    fs.writeFileSync(path.join(workerRoot, "src", "demo.ts"), "export const demo = 2;\n");
    fs.writeFileSync(path.join(repoRoot, "README.md"), "dirty target\n");

    const payload = mergeIssue({
      change,
      commitMessage: "",
      dryRun: true,
      force: false,
      issueId,
      repoRoot
    }) as { changed_files: string[]; dry_run: boolean; shared_workspace: boolean; workspace_scope: string };

    assert.equal(payload.dry_run, true);
    assert.equal(payload.shared_workspace, false);
    assert.equal(payload.workspace_scope, "change");
    assert.deepEqual(payload.changed_files, ["src/demo.ts"]);
    assert.equal(git(repoRoot, "log", "-1", "--pretty=%s"), "init dirty dry-run artifacts");
    assert.equal(fs.readFileSync(path.join(repoRoot, "src", "demo.ts"), "utf8"), "export const demo = 1;\n");
    assert.equal(fs.readFileSync(path.join(repoRoot, "README.md"), "utf8"), "dirty target\n");
  });
});

test("mergeIssue rejects dirty coordinator target for change worktrees", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    const runsDir = path.join(changeDir, "runs");
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(runsDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.mkdirSync(path.join(repoRoot, "openspec"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "openspec", "issue-mode.json"), JSON.stringify({
      worker_worktree: {
        enabled: true,
        scope: "change",
        mode: "branch",
        base_ref: "HEAD",
        branch_prefix: "opsx"
      }
    }, null, 2));
    fs.writeFileSync(path.join(srcDir, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(repoRoot, "README.md"), "clean\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Dirty target reject
worker_worktree: .worktree/${change}
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - dirty target blocks merge
---
`);
    const progressPath = path.join(issuesDir, `${issueId}.progress.json`);
    fs.writeFileSync(progressPath, JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      run_id: "RUN-20260404T000000-ISSUE-001",
      updated_at: "2026-04-04T00:00:00+08:00"
    }, null, 2));
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init dirty reject artifacts");
    git(repoRoot, "worktree", "add", "-b", "opsx/demo-change", path.join(repoRoot, ".worktree", change), "HEAD");

    const workerRoot = path.join(repoRoot, ".worktree", change);
    fs.writeFileSync(path.join(workerRoot, "src", "demo.ts"), "export const demo = 2;\n");
    fs.writeFileSync(path.join(repoRoot, "README.md"), "dirty target\n");

    assert.throws(
      () => mergeIssue({
        change,
        commitMessage: "",
        dryRun: false,
        force: false,
        issueId,
        repoRoot
      }),
      /Coordinator worktree must be clean before merge helper runs/
    );

    const progress = JSON.parse(fs.readFileSync(progressPath, "utf8")) as { boundary_status: string; updated_at: string };
    assert.equal(progress.boundary_status, "review_required");
    assert.equal(progress.updated_at, "2026-04-04T00:00:00+08:00");
    assert.equal(fs.readFileSync(path.join(repoRoot, "src", "demo.ts"), "utf8"), "export const demo = 1;\n");
    assert.equal(git(repoRoot, "log", "-1", "--pretty=%s"), "init dirty reject artifacts");
  });
});

test("mergeIssue rejects missing worker worktree", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    fs.mkdirSync(issuesDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.mkdirSync(path.join(repoRoot, "openspec"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "openspec", "issue-mode.json"), JSON.stringify({
      worker_worktree: {
        enabled: true,
        scope: "change",
        mode: "branch",
        base_ref: "HEAD",
        branch_prefix: "opsx"
      }
    }, null, 2));
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Missing worker
worker_worktree: .worktree/${change}
allowed_scope:
  - demo.ts
out_of_scope:
  - electron/
done_when:
  - fail when worktree missing
---
`);
    fs.writeFileSync(path.join(issuesDir, `${issueId}.progress.json`), JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      updated_at: "2026-04-04T00:00:00+08:00"
    }, null, 2));
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init missing worker artifacts");

    assert.throws(
      () => mergeIssue({
        change,
        commitMessage: "",
        dryRun: false,
        force: false,
        issueId,
        repoRoot
      }),
      /Worker worktree not found or not a git worktree/
    );
  });
});

test("mergeIssue syncs tasks and run artifact with a shared timestamp", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    const runsDir = path.join(changeDir, "runs");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(runsDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [ ] 1.1 first task\n- [ ] 1.2 second task\n");
    fs.writeFileSync(path.join(issuesDir, "INDEX.md"), "- `ISSUE-001` `1.1`\n- `ISSUE-002` `1.2`\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: Task sync issue
worker_worktree: .
allowed_scope:
  - demo.ts
out_of_scope:
  - electron/
done_when:
  - tasks are synced on merge
---
`);
    const progressPath = path.join(issuesDir, `${issueId}.progress.json`);
    const runPath = path.join(runsDir, "RUN-20260404T000000-ISSUE-001.json");
    fs.writeFileSync(progressPath, JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      run_id: "RUN-20260404T000000-ISSUE-001",
      updated_at: "2026-04-04T00:00:00+08:00"
    }, null, 2));
    fs.writeFileSync(runPath, JSON.stringify({
      run_id: "RUN-20260404T000000-ISSUE-001",
      issue_id: issueId
    }, null, 2));
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init task sync artifacts");
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 2;\n");

    const payload = mergeIssue({
      change,
      commitMessage: "",
      dryRun: false,
      force: false,
      issueId,
      repoRoot
    }) as {
      tasks_sync: {
        changed: boolean;
        mapped_task_ids: string[];
        updated_task_ids: string[];
      };
    };
    const progress = JSON.parse(fs.readFileSync(progressPath, "utf8")) as { updated_at: string };
    const run = JSON.parse(fs.readFileSync(runPath, "utf8")) as { latest_event: string; updated_at: string };
    const tasksText = fs.readFileSync(path.join(changeDir, "tasks.md"), "utf8");
    const headFiles = git(repoRoot, "show", "--pretty=", "--name-only", "HEAD")
      .split(/\r?\n/)
      .filter(Boolean);

    assert.equal(payload.tasks_sync.changed, true);
    assert.deepEqual(payload.tasks_sync.mapped_task_ids, ["1.1"]);
    assert.deepEqual(payload.tasks_sync.updated_task_ids, ["1.1"]);
    assert.match(tasksText, /- \[x\] 1\.1 first task/);
    assert.match(tasksText, /- \[ \] 1\.2 second task/);
    assert.equal(run.latest_event, "checkpoint");
    assert.equal(run.updated_at, progress.updated_at);
    assert.match(progress.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    assert.ok(headFiles.includes(`openspec/changes/${change}/tasks.md`));
  });
});

test("mergeIssue leaves run_path empty when no run artifact exists", () => {
  withTempDir((repoRoot) => {
    const change = "demo-change";
    const issueId = "ISSUE-001";
    const changeDir = path.join(repoRoot, "openspec", "changes", change);
    const issuesDir = path.join(changeDir, "issues");
    fs.mkdirSync(issuesDir, { recursive: true });

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 1;\n");
    fs.writeFileSync(path.join(issuesDir, `${issueId}.md`), `---
issue_id: ${issueId}
title: No run artifact issue
worker_worktree: .
allowed_scope:
  - demo.ts
out_of_scope:
  - electron/
done_when:
  - merge works without run artifact
---
`);
    fs.writeFileSync(path.join(issuesDir, `${issueId}.progress.json`), JSON.stringify({
      change,
      issue_id: issueId,
      status: "completed",
      boundary_status: "review_required",
      next_action: "coordinator_review",
      updated_at: "2026-04-04T00:00:00+08:00"
    }, null, 2));
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "init no-run artifacts");
    fs.writeFileSync(path.join(repoRoot, "demo.ts"), "export const demo = 2;\n");

    const payload = mergeIssue({
      change,
      commitMessage: "",
      dryRun: false,
      force: false,
      issueId,
      repoRoot
    }) as { run_path: string };
    const headFiles = git(repoRoot, "show", "--pretty=", "--name-only", "HEAD")
      .split(/\r?\n/)
      .filter(Boolean);

    assert.equal(payload.run_path, "");
    assert.equal(fs.existsSync(path.join(changeDir, "runs")), false);
    assert.equal(headFiles.some((currentPath) => currentPath.includes("/runs/")), false);
  });
});
