import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../../src/cli/index";
import { phaseGateArtifactPath, phaseGateScopeToJson, type PhaseGate } from "../../src/domain/change-coordinator";

const PACKAGE_VERSION = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as {
  version?: unknown;
};
const GATE_UPDATED_AT = "2099-01-01T00:00:00+00:00";

function git(repoRoot: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function initGitRepo(repoRoot: string): void {
  git(repoRoot, "init");
  git(repoRoot, "config", "user.name", "Test User");
  git(repoRoot, "config", "user.email", "test@example.com");
}

function writePhaseGateArtifact(repoRoot: string, change: string, phase: PhaseGate): void {
  const artifactPath = phaseGateArtifactPath(repoRoot, change, phase);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify({
    phase,
    status: "passed",
    updated_at: GATE_UPDATED_AT,
    gate_scope: phaseGateScopeToJson(repoRoot, change, phase)
  }, null, 2));
}

function captureStdout(run: () => Promise<number>): Promise<{ exitCode: number; stdout: string }> {
  const originalWrite = process.stdout.write;
  let stdout = "";

  process.stdout.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
    const callback = rest.find((value) => typeof value === "function") as ((error?: Error | null) => void) | undefined;
    if (callback) {
      callback();
    }
    return true;
  }) as typeof process.stdout.write;

  return run()
    .then((exitCode) => ({ exitCode, stdout }))
    .finally(() => {
      process.stdout.write = originalWrite;
    });
}

test("cli help exits successfully", async () => {
  const exitCode = await main(["--help"]);
  assert.equal(exitCode, 0);
});

test("cli long version flag exits successfully", async () => {
  const result = await captureStdout(() => main(["--version"]));

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), PACKAGE_VERSION.version);
});

test("cli short version flag exits successfully", async () => {
  const result = await captureStdout(() => main(["-v"]));

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), PACKAGE_VERSION.version);
});

test("cli init routes to command", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-cli-init-"));

  const result = await captureStdout(() =>
    main([
      "init",
      repoRoot,
      "--dry-run"
    ])
  );

  const payload = JSON.parse(result.stdout.trim()) as {
    dry_run: boolean;
    openspec_init: { status: string };
    install: { dry_run: boolean };
  };
  assert.equal(result.exitCode, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.openspec_init.status, "planned");
  assert.equal(payload.install.dry_run, true);
});

test("cli dispatch issue routes to renderer", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-cli-dispatch-"));
  const issuePath = path.join(repoRoot, "openspec", "changes", "demo-change", "issues", "ISSUE-001.md");
  fs.mkdirSync(path.dirname(issuePath), { recursive: true });
  fs.writeFileSync(issuePath, `---
issue_id: ISSUE-001
title: CLI dispatch
allowed_scope:
  - src/cli.ts
out_of_scope:
  - electron/
done_when:
  - dispatch rendered
---
`);

  const result = await captureStdout(() =>
    main([
      "dispatch",
      "issue",
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--issue-id",
      "ISSUE-001",
      "--dry-run"
    ])
  );

  const payload = JSON.parse(result.stdout.trim()) as { dispatch_path: string; dry_run: boolean };
  assert.equal(result.exitCode, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.dispatch_path, "openspec/changes/demo-change/issues/ISSUE-001.dispatch.md");
});

test("cli dispatch lifecycle routes to renderer", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-cli-lifecycle-"));
  const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");

  const result = await captureStdout(() =>
    main([
      "dispatch",
      "lifecycle",
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--dry-run"
    ])
  );

  const payload = JSON.parse(result.stdout.trim()) as { dry_run: boolean; phase: string };
  assert.equal(result.exitCode, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.phase, "spec_readiness");
});

test("cli reconcile change routes to command", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-cli-reconcile-"));
  const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
  const issuePath = path.join(changeDir, "issues", "ISSUE-001.md");
  fs.mkdirSync(path.dirname(issuePath), { recursive: true });
  fs.writeFileSync(path.join(changeDir, "proposal.md"), "# proposal\n");
  fs.writeFileSync(path.join(changeDir, "design.md"), "# design\n");
  fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [ ] 1.1 reconcile\n");
  fs.writeFileSync(path.join(changeDir, "issues", "INDEX.md"), "- `ISSUE-001` `1.1`\n");
  fs.writeFileSync(issuePath, `---
issue_id: ISSUE-001
title: Reconcile change
allowed_scope:
  - src/reconcile.ts
out_of_scope:
  - electron/
done_when:
  - reconcile rendered
---
`);
  writePhaseGateArtifact(repoRoot, "demo-change", "spec_readiness");
  writePhaseGateArtifact(repoRoot, "demo-change", "issue_planning");
  initGitRepo(repoRoot);

  const result = await captureStdout(() =>
    main([
      "reconcile",
      "change",
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change"
    ])
  );

  const payload = JSON.parse(result.stdout.trim()) as { next_action: string; recommended_issue_id: string };
  assert.equal(result.exitCode, 0);
  assert.equal(payload.next_action, "await_planning_docs_commit_confirmation");
  assert.equal(payload.recommended_issue_id, "ISSUE-001");
});

test("cli reconcile commit-planning-docs routes to command", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-cli-commit-planning-"));
  const issuePath = path.join(repoRoot, "openspec", "changes", "demo-change", "issues", "ISSUE-001.md");
  fs.mkdirSync(path.dirname(issuePath), { recursive: true });
  fs.writeFileSync(issuePath, `---
issue_id: ISSUE-001
title: Planning commit
allowed_scope:
  - src/planning.ts
out_of_scope:
  - electron/
done_when:
  - planning docs committed
---
`);
  initGitRepo(repoRoot);

  const result = await captureStdout(() =>
    main([
      "reconcile",
      "commit-planning-docs",
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--dry-run"
    ])
  );

  const payload = JSON.parse(result.stdout.trim()) as { dry_run: boolean; status: string };
  assert.equal(result.exitCode, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.status, "ready_to_commit");
});

test("cli reconcile merge-issue routes to command", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-cli-merge-issue-"));
  const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
  const issuesDir = path.join(changeDir, "issues");
  const runsDir = path.join(changeDir, "runs");
  fs.mkdirSync(issuesDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
  initGitRepo(repoRoot);
  fs.writeFileSync(path.join(repoRoot, "src.ts"), "export const demo = 1;\n");
  fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: Merge issue
worker_worktree: .
allowed_scope:
  - src.ts
out_of_scope:
  - electron/
done_when:
  - merge rendered
---
`);
  fs.writeFileSync(path.join(issuesDir, "ISSUE-001.progress.json"), JSON.stringify({
    change: "demo-change",
    issue_id: "ISSUE-001",
    status: "completed",
    boundary_status: "review_required",
    next_action: "coordinator_review",
    run_id: "RUN-20260402T000000-ISSUE-001",
    updated_at: "2026-04-02T00:00:00+08:00"
  }, null, 2));
  git(repoRoot, "add", ".");
  git(repoRoot, "commit", "-m", "init");
  fs.writeFileSync(path.join(repoRoot, "src.ts"), "export const demo = 2;\n");

  const result = await captureStdout(() =>
    main([
      "reconcile",
      "merge-issue",
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--issue-id",
      "ISSUE-001",
      "--dry-run"
    ])
  );

  const payload = JSON.parse(result.stdout.trim()) as { changed_files: string[]; dry_run: boolean; issue_id: string };
  assert.equal(result.exitCode, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.issue_id, "ISSUE-001");
  assert.deepEqual(payload.changed_files, ["src.ts"]);
});

test("cli review change routes to command", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-cli-review-"));
  const issuePath = path.join(repoRoot, "openspec", "changes", "demo-change", "issues", "ISSUE-001.md");
  const progressPath = path.join(repoRoot, "openspec", "changes", "demo-change", "issues", "ISSUE-001.progress.json");
  fs.mkdirSync(path.dirname(issuePath), { recursive: true });
  fs.writeFileSync(issuePath, `---
issue_id: ISSUE-001
title: Review change
allowed_scope:
  - src/review.ts
out_of_scope:
  - electron/
done_when:
  - review rendered
---
`);
  fs.writeFileSync(progressPath, JSON.stringify({
    issue_id: "ISSUE-001",
    status: "completed",
    updated_at: "2026-03-30T10:00:00+08:00"
  }, null, 2));

  const result = await captureStdout(() =>
    main([
      "review",
      "change",
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--dry-run"
    ])
  );

  const payload = JSON.parse(result.stdout.trim()) as { dry_run: boolean; status: string };
  assert.equal(result.exitCode, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.status, "dry_run");
});

test("cli verify change routes to command", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-cli-verify-"));
  const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
  const issuePath = path.join(changeDir, "issues", "ISSUE-001.md");
  const progressPath = path.join(changeDir, "issues", "ISSUE-001.progress.json");
  const reviewPath = path.join(changeDir, "runs", "CHANGE-REVIEW.json");
  fs.mkdirSync(path.dirname(issuePath), { recursive: true });
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  fs.writeFileSync(path.join(changeDir, "tasks.md"), "");
  fs.writeFileSync(issuePath, `---
issue_id: ISSUE-001
title: Verify change
allowed_scope:
  - src/verify.ts
out_of_scope:
  - electron/
done_when:
  - verify rendered
---
`);
  fs.writeFileSync(progressPath, JSON.stringify({
    issue_id: "ISSUE-001",
    status: "completed",
    updated_at: "2026-03-30T10:00:00+08:00"
  }, null, 2));
  fs.writeFileSync(reviewPath, JSON.stringify({
    change: "demo-change",
    status: "passed",
    updated_at: "2026-03-30T10:05:00+08:00"
  }, null, 2));

  const result = await captureStdout(() =>
    main([
      "verify",
      "change",
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--dry-run"
    ])
  );

  const payload = JSON.parse(result.stdout.trim()) as { dry_run: boolean; status: string };
  assert.equal(result.exitCode, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.status, "passed");
});

test("cli archive change routes to command", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-cli-archive-"));

  const result = await captureStdout(() =>
    main([
      "archive",
      "change",
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--dry-run"
    ])
  );

  const payload = JSON.parse(result.stdout.trim()) as { archived: boolean; dry_run: boolean };
  assert.equal(result.exitCode, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.archived, false);
});

test("cli worktree create routes to command", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-cli-worktree-"));
  const configPath = path.join(repoRoot, "openspec", "issue-mode.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    worker_worktree: {
      enabled: false
    }
  }, null, 2));

  const result = await captureStdout(() =>
    main([
      "worktree",
      "create",
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--issue-id",
      "ISSUE-001"
    ])
  );

  const payload = JSON.parse(result.stdout.trim()) as { mode: string; shared_workspace: boolean; worktree_relative: string };
  assert.equal(result.exitCode, 0);
  assert.equal(payload.mode, "shared");
  assert.equal(payload.shared_workspace, true);
  assert.equal(payload.worktree_relative, ".");
});
