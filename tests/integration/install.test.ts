import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runInstallCommand } from "../../src/commands/install";

const EXTENSION_SKILL_NAMES = [
  "openspec-chat-router",
  "openspec-plan-issues",
  "openspec-dispatch-issue",
  "openspec-execute-issue",
  "openspec-reconcile-change",
  "openspec-subagent-team"
];
const OPENSPEC_SKILL_MARKER = "openspec-onboard";

function expectedSkillDirs(targetSkillRoots: string[]): string[] {
  return targetSkillRoots.flatMap((skillsRoot) =>
    EXTENSION_SKILL_NAMES.map((skillName) => `${skillsRoot}/${skillName}`)
  );
}

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

function seedOpenSpecRepo(targetRepo: string, targetSkillRoots: string[] = [".claude/skills"]): void {
  mkdirSync(path.join(targetRepo, "openspec", "changes", "archive"), { recursive: true });
  mkdirSync(path.join(targetRepo, "openspec", "specs"), { recursive: true });
  writeFileSync(path.join(targetRepo, "openspec", "config.yaml"), "schema: spec-driven\n");
  for (const skillsRoot of targetSkillRoots) {
    const markerPath = path.join(targetRepo, skillsRoot, OPENSPEC_SKILL_MARKER, "SKILL.md");
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, "---\nname: openspec-onboard\n---\n");
  }
}

function seedInitializedRepoWithoutSkills(targetRepo: string): void {
  mkdirSync(path.join(targetRepo, "openspec", "changes", "archive"), { recursive: true });
  mkdirSync(path.join(targetRepo, "openspec", "specs"), { recursive: true });
  writeFileSync(path.join(targetRepo, "openspec", "config.yaml"), "schema: spec-driven\n");
}

function collectRelativeFiles(rootPath: string): string[] {
  if (!existsSync(rootPath)) {
    return [];
  }

  const files: string[] = [];

  function walk(currentPath: string, prefix: string): void {
    for (const entry of readdirSync(currentPath)) {
      const entryPath = path.join(currentPath, entry);
      const relativePath = prefix ? path.join(prefix, entry) : entry;
      if (statSync(entryPath).isDirectory()) {
        walk(entryPath, relativePath);
        continue;
      }
      files.push(relativePath.split(path.sep).join("/"));
    }
  }

  walk(rootPath, "");
  return files.sort();
}

test("install dry-run reports TS-only skill set", () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo, [".claude/skills"]);

  const result = withCapturedStdout(() => runInstallCommand([
    "--target-repo",
    targetRepo,
    "--dry-run"
  ]));
  const tsPayload = JSON.parse(result.stdout) as Record<string, unknown>;

  assert.equal(result.exitCode, 0);
  assert.deepEqual(tsPayload.target_skill_roots, [".claude/skills"]);
  assert.deepEqual(tsPayload.installed_skill_dirs, expectedSkillDirs([".claude/skills"]));
  assert.deepEqual(tsPayload.legacy_runtime_cleanup, {
    reason: "",
    removed_paths: [],
    skipped_paths: []
  });
});

test("install writes skills, config, and gitignore entries", () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo, [".claude/skills"]);
  const result = withCapturedStdout(() => runInstallCommand([
    "--target-repo",
    targetRepo
  ]));
  const payload = JSON.parse(result.stdout) as {
    config: { path: string; status: string };
    gitignore: { added_entries: string[]; updated: boolean };
    installed_skill_dirs: string[];
    target_skill_roots: string[];
  };

  assert.equal(result.exitCode, 0);
  assert.equal(payload.config.status, "installed");
  assert.equal(payload.gitignore.updated, true);
  assert.deepEqual(payload.target_skill_roots, [".claude/skills"]);
  assert.deepEqual(payload.installed_skill_dirs, expectedSkillDirs([".claude/skills"]));
  assert.deepEqual(payload.gitignore.added_entries, [
    ".worktree/",
    "openspec/changes/*/runs/CHANGE-REVIEW.json",
    "openspec/changes/*/runs/CHANGE-VERIFY.json"
  ]);
  assert.ok(existsSync(path.join(targetRepo, ".claude", "skills", "openspec-chat-router", "SKILL.md")));
  assert.ok(!existsSync(path.join(targetRepo, ".claude", "skills", "openspec-shared")));
  assert.ok(existsSync(path.join(targetRepo, "openspec", "issue-mode.json")));
  assert.deepEqual(
    collectRelativeFiles(path.join(targetRepo, ".claude", "skills")).filter((filePath) => filePath.endsWith(".py")),
    []
  );

  const gitignore = readFileSync(path.join(targetRepo, ".gitignore"), "utf8");
  assert.match(gitignore, /\.cache\/\n/);
  assert.match(gitignore, /\.worktree\/\n/);
});

test("install writes skills into every configured OpenSpec tool root", () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo, [".claude/skills", ".codex/skills"]);

  const result = withCapturedStdout(() => runInstallCommand([
    "--target-repo",
    targetRepo,
    "--dry-run"
  ]));
  const payload = JSON.parse(result.stdout) as {
    installed_skill_dirs: string[];
    target_skill_roots: string[];
  };

  assert.equal(result.exitCode, 0);
  assert.deepEqual(payload.target_skill_roots, [".claude/skills", ".codex/skills"]);
  assert.deepEqual(payload.installed_skill_dirs, expectedSkillDirs([".claude/skills", ".codex/skills"]));
});

test("install --force removes legacy Python runtime paths", () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo, [".claude/skills"]);
  const legacySkillDir = path.join(targetRepo, ".codex", "skills", "openspec-shared");
  const legacyHeartbeat = path.join(targetRepo, "scripts", "openspec_worker_status.py");

  mkdirSync(path.join(legacySkillDir, "scripts"), { recursive: true });
  writeFileSync(path.join(legacySkillDir, "scripts", "issue_mode_common.py"), "# legacy\n");
  mkdirSync(path.dirname(legacyHeartbeat), { recursive: true });
  writeFileSync(legacyHeartbeat, "# legacy\n");

  const result = withCapturedStdout(() => runInstallCommand([
    "--target-repo",
    targetRepo,
    "--force"
  ]));
  const payload = JSON.parse(result.stdout) as {
    installed_skill_dirs: string[];
    legacy_runtime_cleanup: {
      removed_paths: string[];
    };
  };

  assert.equal(result.exitCode, 0);
  assert.deepEqual(payload.installed_skill_dirs, expectedSkillDirs([".claude/skills"]));
  assert.deepEqual(payload.legacy_runtime_cleanup.removed_paths.sort(), [
    ".codex/skills/openspec-shared",
    "scripts/openspec_worker_status.py"
  ]);
  assert.ok(!existsSync(legacySkillDir));
  assert.ok(!existsSync(legacyHeartbeat));
});

test("install rejects repos that have not been initialized with OpenSpec", () => {
  const targetRepo = createTargetRepo();

  assert.throws(
    () => runInstallCommand(["--target-repo", targetRepo, "--dry-run"]),
    /Target repo is not initialized with OpenSpec/
  );
});

test("install rejects initialized repos without OpenSpec-managed skill directories", () => {
  const targetRepo = createTargetRepo();
  seedInitializedRepoWithoutSkills(targetRepo);

  assert.throws(
    () => runInstallCommand(["--target-repo", targetRepo, "--dry-run"]),
    /Target repo has no OpenSpec-managed skill directories/
  );
});
