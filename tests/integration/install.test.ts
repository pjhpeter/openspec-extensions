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

import { runInstallCommand, type InstallDependencies } from "../../src/commands/install";
import { readOwnPackageVersion } from "../../src/domain/extensions-metadata";

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

function readExtensionsMetadata(targetRepo: string): {
  initialized_version: string;
  installed_version: string;
  package_name: string;
  recorded_by: string;
} {
  return JSON.parse(readFileSync(path.join(targetRepo, "openspec", "openspec-extensions.json"), "utf8")) as {
    initialized_version: string;
    installed_version: string;
    package_name: string;
    recorded_by: string;
  };
}

function readIssueModeConfig(targetRepo: string): {
  rra: { gate_mode: string };
  subagent_team: {
    auto_accept_spec_readiness: boolean;
    auto_accept_issue_planning: boolean;
    auto_accept_issue_review: boolean;
    auto_accept_change_acceptance: boolean;
    auto_archive_after_verify: boolean;
  };
} {
  return JSON.parse(readFileSync(path.join(targetRepo, "openspec", "issue-mode.json"), "utf8")) as {
    rra: { gate_mode: string };
    subagent_team: {
      auto_accept_spec_readiness: boolean;
      auto_accept_issue_planning: boolean;
      auto_accept_issue_review: boolean;
      auto_accept_change_acceptance: boolean;
      auto_archive_after_verify: boolean;
    };
  };
}

function withCapturedStdout(fn: () => Promise<number>): Promise<{ exitCode: number; stdout: string }> {
  let stdout = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;

  return fn()
    .then((exitCode) => ({
      exitCode,
      stdout
    }))
    .finally(() => {
      process.stdout.write = originalWrite;
    });
}

function runInstallForTest(argv: string[], dependencies: InstallDependencies = {}): Promise<number> {
  return runInstallCommand(argv, {
    isInteractiveTerminal: () => false,
    promptIssueModeAutomationPreference: () => "semi-auto",
    ...dependencies
  });
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

test("install dry-run reports TS-only skill set", async () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo, [".claude/skills"]);

  const result = await withCapturedStdout(() => runInstallForTest([
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

test("install writes skills, config, and gitignore entries", async () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo, [".claude/skills"]);
  const result = await withCapturedStdout(() => runInstallForTest([
    "--target-repo",
    targetRepo
  ]));
  const payload = JSON.parse(result.stdout) as {
    config: { path: string; status: string };
    gitignore: { added_entries: string[]; updated: boolean };
    installed_skill_dirs: string[];
    metadata: {
      installed_version: string;
      path: string;
      recorded_by: string;
      status: string;
    };
    target_skill_roots: string[];
  };
  const metadata = readExtensionsMetadata(targetRepo);

  assert.equal(result.exitCode, 0);
  assert.equal(payload.config.status, "installed");
  assert.equal(payload.metadata.status, "installed");
  assert.equal(payload.metadata.path, "openspec/openspec-extensions.json");
  assert.equal(payload.metadata.recorded_by, "install");
  assert.equal(payload.metadata.installed_version, readOwnPackageVersion());
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
  assert.equal(metadata.package_name, "openspec-extensions");
  assert.equal(metadata.recorded_by, "install");
  assert.equal(metadata.initialized_version, readOwnPackageVersion());
  assert.equal(metadata.installed_version, readOwnPackageVersion());
  assert.deepEqual(
    collectRelativeFiles(path.join(targetRepo, ".claude", "skills")).filter((filePath) => filePath.endsWith(".py")),
    []
  );

  const gitignore = readFileSync(path.join(targetRepo, ".gitignore"), "utf8");
  assert.match(gitignore, /\.cache\/\n/);
  assert.match(gitignore, /\.worktree\/\n/);
});

test("install writes skills into every configured OpenSpec tool root", async () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo, [".claude/skills", ".codex/skills"]);

  const result = await withCapturedStdout(() => runInstallForTest([
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

test("install --force removes legacy Python runtime paths", async () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo, [".claude/skills"]);
  const legacySkillDir = path.join(targetRepo, ".codex", "skills", "openspec-shared");
  const legacyHeartbeat = path.join(targetRepo, "scripts", "openspec_worker_status.py");

  mkdirSync(path.join(legacySkillDir, "scripts"), { recursive: true });
  writeFileSync(path.join(legacySkillDir, "scripts", "issue_mode_common.py"), "# legacy\n");
  mkdirSync(path.dirname(legacyHeartbeat), { recursive: true });
  writeFileSync(legacyHeartbeat, "# legacy\n");

  const result = await withCapturedStdout(() => runInstallForTest([
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

test("install updates repo plugin metadata even when issue-mode config is preserved", async () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo, [".claude/skills"]);
  mkdirSync(path.join(targetRepo, "openspec"), { recursive: true });
  writeFileSync(path.join(targetRepo, "openspec", "issue-mode.json"), JSON.stringify({
    rra: { gate_mode: "enforce" }
  }, null, 2));
  writeFileSync(path.join(targetRepo, "openspec", "openspec-extensions.json"), JSON.stringify({
    metadata_version: 1,
    package_name: "openspec-extensions",
    initialized_version: "0.1.5",
    installed_version: "0.1.8",
    updated_at: "2026-01-01T00:00:00.000Z",
    recorded_by: "install"
  }, null, 2));

  const result = await withCapturedStdout(() => runInstallForTest([
    "--target-repo",
    targetRepo
  ]));
  const payload = JSON.parse(result.stdout) as {
    config: { status: string };
    metadata: {
      initialized_version: string;
      installed_version: string;
      recorded_by: string;
      status: string;
    };
  };
  const metadata = readExtensionsMetadata(targetRepo);

  assert.equal(result.exitCode, 0);
  assert.equal(payload.config.status, "preserved");
  assert.equal(payload.metadata.status, "overwritten");
  assert.equal(payload.metadata.initialized_version, "0.1.5");
  assert.equal(payload.metadata.installed_version, readOwnPackageVersion());
  assert.equal(metadata.initialized_version, "0.1.5");
  assert.equal(metadata.installed_version, readOwnPackageVersion());
  assert.equal(metadata.recorded_by, "install");
});

for (const testCase of [
  {
    expected: {
      autoArchiveAfterVerify: false,
      autoAcceptChangeAcceptance: false,
      autoAcceptIssuePlanning: false,
      autoAcceptIssueReview: false,
      autoAcceptSpecReadiness: false,
      gateMode: "advisory"
    },
    preference: "semi-auto" as const
  },
  {
    expected: {
      autoArchiveAfterVerify: false,
      autoAcceptChangeAcceptance: false,
      autoAcceptIssuePlanning: true,
      autoAcceptIssueReview: true,
      autoAcceptSpecReadiness: true,
      gateMode: "enforce"
    },
    preference: "full-auto" as const
  }
]) {
  test(`install --force-config overwrites issue-mode config with the ${testCase.preference} automation profile`, async () => {
    const targetRepo = createTargetRepo();
    seedOpenSpecRepo(targetRepo, [".claude/skills"]);
    writeFileSync(path.join(targetRepo, "openspec", "issue-mode.json"), JSON.stringify({
      rra: { gate_mode: "advisory" },
      subagent_team: {
        auto_accept_spec_readiness: false,
        auto_accept_issue_planning: false,
        auto_accept_issue_review: false,
        auto_accept_change_acceptance: false,
        auto_archive_after_verify: false
      }
    }, null, 2));

    let promptCalls = 0;
    const result = await withCapturedStdout(() => runInstallForTest([
      "--target-repo",
      targetRepo,
      "--force-config"
    ], {
      isInteractiveTerminal() {
        return true;
      },
      promptIssueModeAutomationPreference() {
        promptCalls += 1;
        return testCase.preference;
      }
    }));
    const payload = JSON.parse(result.stdout) as {
      config: { status: string };
    };
    const config = readIssueModeConfig(targetRepo);

    assert.equal(result.exitCode, 0);
    assert.equal(promptCalls, 1);
    assert.equal(payload.config.status, "overwritten");
    assert.equal(config.rra.gate_mode, testCase.expected.gateMode);
    assert.equal(config.subagent_team.auto_accept_spec_readiness, testCase.expected.autoAcceptSpecReadiness);
    assert.equal(config.subagent_team.auto_accept_issue_planning, testCase.expected.autoAcceptIssuePlanning);
    assert.equal(config.subagent_team.auto_accept_issue_review, testCase.expected.autoAcceptIssueReview);
    assert.equal(config.subagent_team.auto_accept_change_acceptance, testCase.expected.autoAcceptChangeAcceptance);
    assert.equal(config.subagent_team.auto_archive_after_verify, testCase.expected.autoArchiveAfterVerify);
  });
}

test("install --force-config skips the automation prompt when issue-mode config does not exist yet", async () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo, [".claude/skills"]);

  const result = await withCapturedStdout(() => runInstallForTest([
    "--target-repo",
    targetRepo,
    "--force-config"
  ], {
    isInteractiveTerminal() {
      return true;
    },
    promptIssueModeAutomationPreference() {
      throw new Error("should not prompt when install is creating issue-mode config for the first time");
    }
  }));
  const payload = JSON.parse(result.stdout) as {
    config: { status: string };
  };
  const config = readIssueModeConfig(targetRepo);

  assert.equal(result.exitCode, 0);
  assert.equal(payload.config.status, "installed");
  assert.equal(config.rra.gate_mode, "advisory");
  assert.equal(config.subagent_team.auto_accept_issue_review, true);
});

test("install rejects repos that have not been initialized with OpenSpec", async () => {
  const targetRepo = createTargetRepo();

  await assert.rejects(
    () => runInstallForTest(["--target-repo", targetRepo, "--dry-run"]),
    /Target repo is not initialized with OpenSpec/
  );
});

test("install rejects initialized repos without OpenSpec-managed skill directories", async () => {
  const targetRepo = createTargetRepo();
  seedInitializedRepoWithoutSkills(targetRepo);

  await assert.rejects(
    () => runInstallForTest(["--target-repo", targetRepo, "--dry-run"]),
    /Target repo has no OpenSpec-managed skill directories/
  );
});
