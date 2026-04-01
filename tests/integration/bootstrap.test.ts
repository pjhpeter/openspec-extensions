import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runInitCommand } from "../../src/commands/init";

const EXPECTED_SKILL_DIRS = [
  ".codex/skills/openspec-chat-router",
  ".codex/skills/openspec-plan-issues",
  ".codex/skills/openspec-dispatch-issue",
  ".codex/skills/openspec-execute-issue",
  ".codex/skills/openspec-reconcile-change",
  ".codex/skills/openspec-subagent-team"
];

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
  const targetRepo = mkdtempSync(path.join(os.tmpdir(), "openspec-bootstrap-"));
  writeFileSync(path.join(targetRepo, ".gitignore"), ".cache/\n");
  return realpathSync(targetRepo);
}

function seedOpenSpecRepo(targetRepo: string): void {
  mkdirSync(path.join(targetRepo, "openspec", "changes", "archive"), { recursive: true });
  mkdirSync(path.join(targetRepo, "openspec", "specs"), { recursive: true });
  writeFileSync(path.join(targetRepo, "openspec", "config.yaml"), "schema: spec-driven\n");
}

test("init initializes OpenSpec before installing extension skills", () => {
  const targetRepo = createTargetRepo();
  let initCalls = 0;

  const result = withCapturedStdout(() => runInitCommand([
    targetRepo
  ], {
    runOpenSpecInit(request) {
      initCalls += 1;
      assert.equal(request.targetRepo, targetRepo);
      assert.equal(request.tools, "codex");
      assert.equal(request.profile, "");
      assert.equal(request.force, false);
      seedOpenSpecRepo(targetRepo);
      return "openspec";
    }
  }));
  const payload = JSON.parse(result.stdout) as {
    openspec_init: {
      command: string[];
      fallback_command: string[];
      runner: string;
      status: string;
    };
    install: {
      config: { status: string };
      installed_skill_dirs: string[];
    };
  };

  assert.equal(result.exitCode, 0);
  assert.equal(initCalls, 1);
  assert.equal(payload.openspec_init.status, "executed");
  assert.equal(payload.openspec_init.runner, "openspec");
  assert.deepEqual(payload.openspec_init.command, [
    "openspec",
    "init",
    "--tools",
    "codex",
    targetRepo
  ]);
  assert.deepEqual(payload.openspec_init.fallback_command, [
    "npx",
    "--yes",
    "@fission-ai/openspec@latest",
    "init",
    "--tools",
    "codex",
    targetRepo
  ]);
  assert.equal(payload.install.config.status, "installed");
  assert.deepEqual(payload.install.installed_skill_dirs, EXPECTED_SKILL_DIRS);
  assert.ok(existsSync(path.join(targetRepo, "openspec", "config.yaml")));
  assert.ok(existsSync(path.join(targetRepo, "openspec", "issue-mode.json")));
});

test("init skips OpenSpec init when the repo is already initialized", () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo);

  const result = withCapturedStdout(() => runInitCommand([
    targetRepo,
    "--dry-run"
  ], {
    runOpenSpecInit() {
      throw new Error("should not run OpenSpec init");
    }
  }));
  const payload = JSON.parse(result.stdout) as {
    dry_run: boolean;
    openspec_init: {
      runner: string;
      status: string;
    };
    install: {
      dry_run: boolean;
      installed_skill_dirs: string[];
    };
  };

  assert.equal(result.exitCode, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.openspec_init.status, "skipped");
  assert.equal(payload.openspec_init.runner, "none");
  assert.equal(payload.install.dry_run, true);
  assert.deepEqual(payload.install.installed_skill_dirs, EXPECTED_SKILL_DIRS);
});

test("init dry-run plans OpenSpec init for clean repos", () => {
  const targetRepo = createTargetRepo();

  const result = withCapturedStdout(() => runInitCommand([
    targetRepo,
    "--dry-run"
  ], {
    runOpenSpecInit() {
      throw new Error("dry-run should not run OpenSpec init");
    }
  }));
  const payload = JSON.parse(result.stdout) as {
    dry_run: boolean;
    openspec_init: {
      runner: string;
      status: string;
    };
    install: {
      dry_run: boolean;
      installed_skill_dirs: string[];
    };
  };

  assert.equal(result.exitCode, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.openspec_init.status, "planned");
  assert.equal(payload.openspec_init.runner, "none");
  assert.equal(payload.install.dry_run, true);
  assert.deepEqual(payload.install.installed_skill_dirs, EXPECTED_SKILL_DIRS);
  assert.equal(existsSync(path.join(targetRepo, "openspec", "config.yaml")), false);
});
