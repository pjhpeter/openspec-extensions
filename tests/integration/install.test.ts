import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { runInstallCommand } from "../../src/commands/install";

const repoRoot = path.resolve(__dirname, "..", "..");
const pythonInstallerPath = path.join(repoRoot, "scripts", "install_openspec_extensions.py");

function withCapturedStdout(fn: () => number): { exitCode: number; stdout: string } {
  let stdout = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;

  try {
    return {
      exitCode: fn(),
      stdout
    };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function createTargetRepo(): string {
  const targetRepo = mkdtempSync(path.join(os.tmpdir(), "openspec-install-"));
  writeFileSync(path.join(targetRepo, ".gitignore"), ".cache/\n");
  return realpathSync(targetRepo);
}

test("install dry-run output matches Python installer", () => {
  const targetRepo = createTargetRepo();

  const pythonPayload = JSON.parse(execFileSync("python3", [
    pythonInstallerPath,
    "--target-repo",
    targetRepo,
    "--dry-run"
  ], {
    cwd: repoRoot,
    encoding: "utf8"
  })) as Record<string, unknown>;

  const result = withCapturedStdout(() => runInstallCommand([
    "--target-repo",
    targetRepo,
    "--dry-run"
  ]));
  const tsPayload = JSON.parse(result.stdout) as Record<string, unknown>;

  assert.equal(result.exitCode, 0);
  assert.deepEqual(tsPayload, pythonPayload);
});

test("install writes skills, config, and gitignore entries", () => {
  const targetRepo = createTargetRepo();
  const result = withCapturedStdout(() => runInstallCommand([
    "--target-repo",
    targetRepo
  ]));
  const payload = JSON.parse(result.stdout) as {
    config: { path: string; status: string };
    gitignore: { added_entries: string[]; updated: boolean };
    installed_skill_dirs: string[];
  };

  assert.equal(result.exitCode, 0);
  assert.equal(payload.config.status, "installed");
  assert.equal(payload.gitignore.updated, true);
  assert.deepEqual(payload.gitignore.added_entries, [
    ".worktree/",
    "openspec/changes/*/runs/CHANGE-REVIEW.json",
    "openspec/changes/*/runs/CHANGE-VERIFY.json"
  ]);
  assert.ok(payload.installed_skill_dirs.length > 0);
  assert.ok(existsSync(path.join(targetRepo, ".codex", "skills", "openspec-shared", "scripts", "issue_mode_common.py")));
  assert.ok(existsSync(path.join(targetRepo, "openspec", "issue-mode.json")));

  const gitignore = readFileSync(path.join(targetRepo, ".gitignore"), "utf8");
  assert.match(gitignore, /\.cache\/\n/);
  assert.match(gitignore, /\.worktree\/\n/);
});
