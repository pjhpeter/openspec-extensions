import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runIssueTeamDispatchRenderer } from "../../src/renderers/issue-team-dispatch";

function makeTempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openspec-issue-team-dispatch-"));
}

function captureStdout(run: () => number): { exitCode: number; stdout: string } {
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

  try {
    return { exitCode: run(), stdout };
  } finally {
    process.stdout.write = originalWrite;
  }
}

test("renders team dispatch from issue and control artifacts", () => {
  const repoRoot = makeTempRepo();
  const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
  const issuesDir = path.join(changeDir, "issues");
  const controlDir = path.join(changeDir, "control");
  fs.mkdirSync(issuesDir, { recursive: true });
  fs.mkdirSync(controlDir, { recursive: true });

  fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: \u63a5\u5165 team dispatch
worker_worktree: .worktree/demo-change/ISSUE-001
allowed_scope:
  - src/dispatch.ts
out_of_scope:
  - electron/
done_when:
  - \u8f93\u51fa team packet
validation:
  - pnpm lint
  - pnpm type-check
---
`);
  fs.writeFileSync(path.join(controlDir, "BACKLOG.md"), `## Must Fix Now
- [ ] \u4fee\u590d ISSUE-001 gate
`);
  fs.writeFileSync(path.join(controlDir, "ROUND-01.md"), `## Round Target
- \u8ba9 ISSUE-001 \u8fdb\u5165 subagent team \u4e3b\u94fe

## Target Mode
- quality

## Acceptance Criteria
- packet \u53ef\u76f4\u63a5\u53d1\u7ed9 coordinator

## Scope In Round
- ISSUE-001

## Acceptance Verdict
- accepted

## Next Action
- \u7ee7\u7eed dispatch ISSUE-001
`);
  fs.writeFileSync(
    path.join(issuesDir, "ISSUE-001.progress.json"),
    JSON.stringify(
      {
        changed_files: ["src/dispatch.ts", "node_modules/react/index.js", "coverage/lcov.info"],
        validation: {
          lint: "passed",
          typecheck: "pending",
        },
      },
      null,
      2
    )
  );

  const { exitCode, stdout } = captureStdout(() =>
    runIssueTeamDispatchRenderer([
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--issue-id",
      "ISSUE-001",
    ])
  );
  const payload = JSON.parse(stdout.trim()) as Record<string, unknown>;
  const dispatchPath = path.join(repoRoot, String(payload.team_dispatch_path));
  const dispatchText = fs.readFileSync(dispatchPath, "utf8");

  assert.equal(exitCode, 0);
  assert.equal((payload.control_state as { latest_round: { target_mode: string } }).latest_round.target_mode, "quality");
  assert.equal((payload.reasoning_policy as { development_group: string }).development_group, "xhigh");
  assert.equal((payload.reasoning_policy as { check_group: string }).check_group, "medium");
  assert.equal((payload.reasoning_policy as { review_group: string }).review_group, "medium");
  assert.match(dispatchText, /subagent team \u4e3b\u94fe/);
  assert.match(dispatchText, /Development group: 3 subagents/);
  assert.match(dispatchText, /Check group: 2 subagents/);
  assert.match(dispatchText, /Review group: 1 subagent/);
  assert.match(dispatchText, /Developer 1: core implementation owner/);
  assert.match(dispatchText, /Checker 2: direct dependency regression risk, tests, evidence gaps/);
  assert.match(dispatchText, /Reviewer 1: scope-first target path \/ direct dependency \/ evidence pass or fail/);
  assert.match(dispatchText, /## Gate Barrier/);
  assert.match(dispatchText, /\u6700\u957f 1 \u5c0f\u65f6\u7684 blocking wait/);
  assert.match(dispatchText, /\u4e0d\u8981\u5f53\u4f5c `explorer` sidecar/);
  assert.match(dispatchText, /Gate-bearing subagent roster with seat \/ agent_id \/ status/);
  assert.match(dispatchText, /Launch with `reasoning_effort=xhigh`/);
  assert.match(dispatchText, /Launch with `reasoning_effort=medium`/);
  assert.match(dispatchText, /Current changed-file focus:/);
  assert.match(dispatchText, /Current review starting scope:/);
  assert.match(dispatchText, /Excluded incidental paths from review focus:/);
  assert.match(dispatchText, /`src\/dispatch.ts`/);
  assert.match(dispatchText, /`node_modules\/react\/index.js`/);
  assert.match(dispatchText, /`coverage\/lcov.info`/);
  assert.match(dispatchText, /lint=passed/);
  assert.match(dispatchText, /typecheck=pending/);
  assert.match(dispatchText, /\u9ed8\u8ba4\u6392\u9664 `node_modules`\u3001`dist`\u3001`build`\u3001`\.next`\u3001`coverage`/);
  assert.match(dispatchText, /Target mode:/);
  assert.match(dispatchText, /`quality`/);
  assert.match(dispatchText, /ISSUE-001/);
  assert.match(dispatchText, /pnpm lint/);
  assert.match(dispatchText, /\u4fee\u590d ISSUE-001 gate/);
});

test("falls back to issue-local round contract when latest round is still planning", () => {
  const repoRoot = makeTempRepo();
  const changeDir = path.join(repoRoot, "openspec", "changes", "demo-change");
  const issuesDir = path.join(changeDir, "issues");
  const controlDir = path.join(changeDir, "control");
  fs.mkdirSync(issuesDir, { recursive: true });
  fs.mkdirSync(controlDir, { recursive: true });

  fs.writeFileSync(path.join(issuesDir, "ISSUE-001.md"), `---
issue_id: ISSUE-001
title: \u751f\u547d\u5468\u671f\u6267\u884c
worker_worktree: .
allowed_scope:
  - src/demo.ts
out_of_scope:
  - electron/
done_when:
  - \u5171\u4eab\u6a21\u5757\u5df2\u7ecf\u843d\u5730
validation:
  - pnpm lint
---
`);
  fs.writeFileSync(path.join(controlDir, "ROUND-01.md"), `## Round Target
- \u63a8\u8fdb issue planning \u901a\u8fc7\u5ba1\u67e5\uff0c\u5e76\u5b8c\u6210\u89c4\u5212\u6587\u6863\u63d0\u4ea4\u3002

## Target Mode
- release

## Acceptance Criteria
- proposal / design / tasks / issue \u6587\u6863\u4ee5 coordinator commit \u56fa\u5316

## Scope In Round
- proposal.md
- design.md
- tasks.md
- issues/INDEX.md
- issues/ISSUE-001.md

## Next Action
- commit planning docs
- dispatch ISSUE-001
`);

  const { stdout } = captureStdout(() =>
    runIssueTeamDispatchRenderer([
      "--repo-root",
      repoRoot,
      "--change",
      "demo-change",
      "--issue-id",
      "ISSUE-001",
    ])
  );
  const payload = JSON.parse(stdout.trim()) as Record<string, unknown>;
  const dispatchText = fs.readFileSync(path.join(repoRoot, String(payload.team_dispatch_path)), "utf8");

  assert.match(dispatchText, /\u63a8\u8fdb ISSUE-001 \u5b8c\u6210\u5f00\u53d1\u3001\u68c0\u67e5\u3001\u4fee\u590d\u3001\u5ba1\u67e5\u56de\u5408\u3002/);
  assert.match(dispatchText, /`ISSUE-001`/);
  assert.match(dispatchText, /ISSUE-001 \u7684\u76ee\u6807\u8303\u56f4\u8fbe\u6210/);
  assert.match(dispatchText, /\u5b8c\u6210 ISSUE-001 \u7684\u5f53\u524d round \u540e\uff0c\u7531 coordinator \u6536\u655b\u5f00\u53d1 \/ \u68c0\u67e5 \/ \u5ba1\u67e5\u7ed3\u679c\u3002/);
  assert.doesNotMatch(dispatchText, /proposal \/ design \/ tasks \/ issue \u6587\u6863\u4ee5 coordinator commit \u56fa\u5316/);
  assert.doesNotMatch(dispatchText, /`proposal.md`/);
  assert.doesNotMatch(dispatchText, /commit planning docs/);
});
