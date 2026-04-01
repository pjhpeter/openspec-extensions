import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../../src/cli/index";

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
