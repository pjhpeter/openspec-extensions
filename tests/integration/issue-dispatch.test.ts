import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { renderIssueDispatch } from "../../src/renderers/issue-dispatch";

function withTempDir(run: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-issue-dispatch-"));
  try {
    run(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

function writeIssueDoc(
  repoRoot: string,
  contents: string,
  change = "demo-change",
  issueId = "ISSUE-001"
): string {
  const issuePath = path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.md`);
  fs.mkdirSync(path.dirname(issuePath), { recursive: true });
  fs.writeFileSync(issuePath, contents, "utf8");
  return issuePath;
}

test("renders issue dispatch and writes artifact", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(
      repoRoot,
      `---
issue_id: ISSUE-001
title: Render issue packet
worker_worktree: .worktree/demo-change/ISSUE-001
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - packet is ready
validation:
  - pnpm lint
---
`
    );
    fs.mkdirSync(path.join(repoRoot, "openspec", "changes", "demo-change", "control"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "openspec", "changes", "demo-change", "control", "ROUND-01.md"),
      `## Scope In Round
- ISSUE-001

## Acceptance Verdict
- accepted
`,
      "utf8"
    );

    const payload = renderIssueDispatch({
      change: "demo-change",
      issueId: "ISSUE-001",
      repoRoot,
      runId: "RUN-EXPLICIT-ISSUE-001"
    });
    const dispatchPath = path.join(repoRoot, payload.dispatch_path);
    const dispatchText = fs.readFileSync(dispatchPath, "utf8");

    assert.equal(payload.worker_worktree, ".worktree/demo-change/ISSUE-001");
    assert.equal(payload.worker_worktree_source, "issue_doc");
    assert.deepEqual(payload.validation, ["pnpm lint"]);
    assert.equal(payload.validation_source, "issue_doc");
    assert.equal(payload.control_gate.status, "approved_for_dispatch");
    assert.equal(payload.control_gate.action, "dispatch_next_issue");
    assert.match(dispatchText, /继续 OpenSpec change `demo-change`，执行单个 issue。/);
    assert.match(dispatchText, /Run ID:/);
    assert.match(dispatchText, /RUN-EXPLICIT-ISSUE-001/);
    assert.match(dispatchText, /Allowed scope:/);
    assert.match(dispatchText, /`src\/demo.ts`/);
    assert.match(dispatchText, /openspec-extensions execute update-progress start --repo-root/);
    assert.match(dispatchText, /openspec-extensions execute update-progress stop --repo-root/);
    assert.doesNotMatch(dispatchText, /python3 \.codex\/skills/);
  });
});

test("dry run returns payload without writing artifact and falls back to config validation", () => {
  withTempDir((repoRoot) => {
    const openspecDir = path.join(repoRoot, "openspec");
    fs.mkdirSync(openspecDir, { recursive: true });
    fs.writeFileSync(
      path.join(openspecDir, "issue-mode.json"),
      JSON.stringify(
        {
          validation_commands: ["pnpm lint", "pnpm type-check"],
          worker_worktree: {
            enabled: true,
            scope: "change",
            mode: "detach",
            base_ref: "HEAD",
            branch_prefix: "opsx"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    writeIssueDoc(
      repoRoot,
      `---
issue_id: ISSUE-001
title: Dry run packet
allowed_scope:
  - src/dry-run.ts
out_of_scope:
  - electron/
done_when:
  - packet is previewed
---
`
    );

    const payload = renderIssueDispatch({
      change: "demo-change",
      dryRun: true,
      issueId: "ISSUE-001",
      repoRoot
    });
    const dispatchPath = path.join(repoRoot, payload.dispatch_path);

    assert.equal(payload.dry_run, true);
    assert.equal(fs.existsSync(dispatchPath), false);
    assert.equal(payload.worker_worktree, ".worktree/demo-change");
    assert.equal(payload.validation_source, "config_default");
    assert.deepEqual(payload.validation, ["pnpm lint", "pnpm type-check"]);
    assert.equal(payload.control_gate.status, "not_applicable");
  });
});

test("fails when issue doc is missing required frontmatter fields", () => {
  withTempDir((repoRoot) => {
    writeIssueDoc(
      repoRoot,
      `---
issue_id: ISSUE-001
allowed_scope:
  - src/missing-title.ts
out_of_scope:
  - electron/
done_when:
  - packet is blocked
---
`
    );

    assert.throws(
      () =>
        renderIssueDispatch({
          change: "demo-change",
          issueId: "ISSUE-001",
          repoRoot
        }),
      /Issue doc missing required field: title/
    );
  });
});
