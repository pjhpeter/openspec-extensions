import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runInitCommand, type InitDependencies } from "../../src/commands/init";
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

function runInitForTest(argv: string[], dependencies: InitDependencies = {}): Promise<number> {
  return runInitCommand(argv, {
    // 测试默认关闭交互检查，避免本地 TTY 把用例挂进更新提示。
    isInteractiveTerminal: () => false,
    // 交互用例如果只关心别的提示，默认选更保守的半自动配置。
    promptIssueModeAutomationPreference: () => "semi-auto",
    ...dependencies
  });
}

function createTargetRepo(): string {
  const targetRepo = mkdtempSync(path.join(os.tmpdir(), "openspec-bootstrap-"));
  writeFileSync(path.join(targetRepo, ".gitignore"), ".cache/\n");
  return realpathSync(targetRepo);
}

function successfulCommandResult(): {
  signal: string | null;
  status: number;
  stderr: string;
  stdout: string;
} {
  return {
    signal: null,
    status: 0,
    stderr: "",
    stdout: ""
  };
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

function readExtensionsMetadata(targetRepo: string): {
  initialized_version: string;
  installed_version: string;
  recorded_by: string;
} {
  const payload = JSON.parse(readFileSync(path.join(targetRepo, "openspec", "openspec-extensions.json"), "utf8")) as {
    initialized_version: string;
    installed_version: string;
    recorded_by: string;
  };
  return {
    initialized_version: payload.initialized_version,
    installed_version: payload.installed_version,
    recorded_by: payload.recorded_by
  };
}

test("init initializes OpenSpec before installing extension skills", async () => {
  const targetRepo = createTargetRepo();
  let initCalls = 0;

  const result = await withCapturedStdout(() => runInitForTest([
    targetRepo
  ], {
    runOpenSpecInit(request) {
      initCalls += 1;
      assert.equal(request.targetRepo, targetRepo);
      assert.equal(request.tools, undefined);
      assert.equal(request.profile, "");
      assert.equal(request.force, false);
      seedOpenSpecRepo(targetRepo, [".claude/skills"]);
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
      target_skill_roots: string[];
    };
  };

  assert.equal(result.exitCode, 0);
  assert.equal(initCalls, 1);
  assert.equal(payload.openspec_init.status, "executed");
  assert.equal(payload.openspec_init.runner, "openspec");
  assert.deepEqual(payload.openspec_init.command, [
    "openspec",
    "init",
    targetRepo
  ]);
  assert.deepEqual(payload.openspec_init.fallback_command, [
    "npx",
    "--yes",
    "@fission-ai/openspec@~1.2.0",
    "init",
    targetRepo
  ]);
  assert.equal(payload.install.config.status, "installed");
  assert.deepEqual(payload.install.target_skill_roots, [".claude/skills"]);
  assert.deepEqual(payload.install.installed_skill_dirs, expectedSkillDirs([".claude/skills"]));
  assert.ok(existsSync(path.join(targetRepo, "openspec", "config.yaml")));
  assert.ok(existsSync(path.join(targetRepo, "openspec", "issue-mode.json")));
  assert.ok(existsSync(path.join(targetRepo, "openspec", "openspec-extensions.json")));
  assert.deepEqual(readExtensionsMetadata(targetRepo), {
    initialized_version: readOwnPackageVersion(),
    installed_version: readOwnPackageVersion(),
    recorded_by: "init"
  });
});

test("init keeps the official OpenSpec tool selector interactive when tools are not preset", async () => {
  const targetRepo = createTargetRepo();
  const calls: Array<{ command: string[]; mode: string }> = [];

  const result = await withCapturedStdout(() => runInitForTest([
    targetRepo
  ], {
    runOpenSpecCommand(command, mode) {
      calls.push({ command, mode });
      seedOpenSpecRepo(targetRepo, [".claude/skills"]);
      return successfulCommandResult();
    }
  }));
  const payload = JSON.parse(result.stdout) as {
    openspec_init: {
      runner: string;
      status: string;
    };
    install: {
      installed_skill_dirs: string[];
      target_skill_roots: string[];
    };
  };

  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [
    {
      command: ["openspec", "init", targetRepo],
      mode: "interactive"
    }
  ]);
  assert.equal(payload.openspec_init.status, "executed");
  assert.equal(payload.openspec_init.runner, "openspec");
  assert.deepEqual(payload.install.target_skill_roots, [".claude/skills"]);
  assert.deepEqual(payload.install.installed_skill_dirs, expectedSkillDirs([".claude/skills"]));
});

test("init preserves explicit openspec tool selection", async () => {
  const targetRepo = createTargetRepo();
  let initCalls = 0;

  const result = await withCapturedStdout(() => runInitForTest([
    targetRepo,
    "--openspec-tools",
    "codex"
  ], {
    runOpenSpecInit(request) {
      initCalls += 1;
      assert.equal(request.targetRepo, targetRepo);
      assert.equal(request.tools, "codex");
      seedOpenSpecRepo(targetRepo, [".codex/skills"]);
      return "npx";
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
      installed_skill_dirs: string[];
      target_skill_roots: string[];
    };
  };

  assert.equal(result.exitCode, 0);
  assert.equal(initCalls, 1);
  assert.equal(payload.openspec_init.status, "executed");
  assert.equal(payload.openspec_init.runner, "npx");
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
    "@fission-ai/openspec@~1.2.0",
    "init",
    "--tools",
    "codex",
    targetRepo
  ]);
  assert.deepEqual(payload.install.target_skill_roots, [".codex/skills"]);
  assert.deepEqual(payload.install.installed_skill_dirs, expectedSkillDirs([".codex/skills"]));
});

test("init keeps explicit openspec tool selection non-interactive", async () => {
  const targetRepo = createTargetRepo();
  const calls: Array<{ command: string[]; mode: string }> = [];

  const result = await withCapturedStdout(() => runInitForTest([
    targetRepo,
    "--openspec-tools",
    "codex"
  ], {
    runOpenSpecCommand(command, mode) {
      calls.push({ command, mode });
      seedOpenSpecRepo(targetRepo, [".codex/skills"]);
      return successfulCommandResult();
    }
  }));
  const payload = JSON.parse(result.stdout) as {
    openspec_init: {
      runner: string;
      status: string;
    };
    install: {
      installed_skill_dirs: string[];
      target_skill_roots: string[];
    };
  };

  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [
    {
      command: ["openspec", "init", "--tools", "codex", targetRepo],
      mode: "captured"
    }
  ]);
  assert.equal(payload.openspec_init.status, "executed");
  assert.equal(payload.openspec_init.runner, "openspec");
  assert.deepEqual(payload.install.target_skill_roots, [".codex/skills"]);
  assert.deepEqual(payload.install.installed_skill_dirs, expectedSkillDirs([".codex/skills"]));
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
      autoArchiveAfterVerify: true,
      autoAcceptChangeAcceptance: true,
      autoAcceptIssuePlanning: true,
      autoAcceptIssueReview: true,
      autoAcceptSpecReadiness: true,
      gateMode: "enforce"
    },
    preference: "full-auto" as const
  }
]) {
  test(`init writes the ${testCase.preference} issue-mode automation profile`, async () => {
    const targetRepo = createTargetRepo();
    let promptCalls = 0;

    const result = await withCapturedStdout(() => runInitForTest([
      targetRepo
    ], {
      checkForPackageUpdate() {
        return null;
      },
      isInteractiveTerminal() {
        return true;
      },
      promptIssueModeAutomationPreference() {
        promptCalls += 1;
        return testCase.preference;
      },
      runOpenSpecInit() {
        seedOpenSpecRepo(targetRepo, [".claude/skills"]);
        return "openspec";
      }
    }));

    const config = readIssueModeConfig(targetRepo);

    assert.equal(result.exitCode, 0);
    assert.equal(promptCalls, 1);
    assert.equal(config.rra.gate_mode, testCase.expected.gateMode);
    assert.equal(config.subagent_team.auto_accept_spec_readiness, testCase.expected.autoAcceptSpecReadiness);
    assert.equal(config.subagent_team.auto_accept_issue_planning, testCase.expected.autoAcceptIssuePlanning);
    assert.equal(config.subagent_team.auto_accept_issue_review, testCase.expected.autoAcceptIssueReview);
    assert.equal(config.subagent_team.auto_accept_change_acceptance, testCase.expected.autoAcceptChangeAcceptance);
    assert.equal(config.subagent_team.auto_archive_after_verify, testCase.expected.autoArchiveAfterVerify);
  });
}

test("init skips the automation prompt when issue-mode config is preserved", async () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo, [".claude/skills"]);
  writeFileSync(path.join(targetRepo, "openspec", "issue-mode.json"), JSON.stringify({
    rra: { gate_mode: "enforce" },
    subagent_team: {
      auto_accept_spec_readiness: true,
      auto_accept_issue_planning: true,
      auto_accept_issue_review: true,
      auto_accept_change_acceptance: true,
      auto_archive_after_verify: true
    }
  }, null, 2));

  const result = await withCapturedStdout(() => runInitForTest([
    targetRepo
  ], {
    checkForPackageUpdate() {
      return null;
    },
    isInteractiveTerminal() {
      return true;
    },
    promptIssueModeAutomationPreference() {
      throw new Error("should not prompt when issue-mode config is preserved");
    },
    runOpenSpecInit() {
      throw new Error("should not rerun OpenSpec init");
    }
  }));

  const config = readIssueModeConfig(targetRepo);
  const metadata = readExtensionsMetadata(targetRepo);

  assert.equal(result.exitCode, 0);
  assert.equal(config.rra.gate_mode, "enforce");
  assert.equal(config.subagent_team.auto_accept_issue_review, true);
  assert.equal(metadata.installed_version, readOwnPackageVersion());
  assert.equal(metadata.recorded_by, "init");
});

test("init upgrades the local package and reruns when update is accepted", async () => {
  const targetRepo = createTargetRepo();
  let initCalls = 0;
  let upgradeStatus:
    | {
        current_version: string;
        latest_version: string;
      }
    | null = null;
  let relaunchedArgv: string[] | null = null;

  const result = await withCapturedStdout(() => runInitForTest([
    targetRepo
  ], {
    checkForPackageUpdate() {
      return {
        current_version: "0.1.6",
        latest_version: "0.1.7"
      };
    },
    confirmPackageUpdate(status) {
      assert.equal(status.current_version, "0.1.6");
      assert.equal(status.latest_version, "0.1.7");
      return true;
    },
    isInteractiveTerminal() {
      return true;
    },
    relaunchWithLatestVersion(status, argv) {
      upgradeStatus = status;
      relaunchedArgv = argv;
      return 0;
    },
    runOpenSpecInit() {
      initCalls += 1;
      throw new Error("should upgrade local package before rerunning init");
    }
  }));

  assert.equal(result.exitCode, 0);
  assert.equal(initCalls, 0);
  assert.deepEqual(upgradeStatus, {
    current_version: "0.1.6",
    latest_version: "0.1.7"
  });
  assert.deepEqual(relaunchedArgv, [targetRepo]);
  assert.equal(result.stdout, "");
});

test("init continues current version when update is declined", async () => {
  const targetRepo = createTargetRepo();
  let initCalls = 0;

  const result = await withCapturedStdout(() => runInitForTest([
    targetRepo
  ], {
    checkForPackageUpdate() {
      return {
        current_version: "0.1.6",
        latest_version: "0.1.7"
      };
    },
    confirmPackageUpdate() {
      return false;
    },
    isInteractiveTerminal() {
      return true;
    },
    runOpenSpecInit() {
      initCalls += 1;
      seedOpenSpecRepo(targetRepo, [".claude/skills"]);
      return "openspec";
    }
  }));
  const payload = JSON.parse(result.stdout) as {
    openspec_init: {
      runner: string;
      status: string;
    };
  };

  assert.equal(result.exitCode, 0);
  assert.equal(initCalls, 1);
  assert.equal(payload.openspec_init.status, "executed");
  assert.equal(payload.openspec_init.runner, "openspec");
});

test("init skips package update check outside interactive terminals", async () => {
  const targetRepo = createTargetRepo();
  let checkCalls = 0;

  const result = await withCapturedStdout(() => runInitForTest([
    targetRepo,
    "--dry-run"
  ], {
    checkForPackageUpdate() {
      checkCalls += 1;
      return {
        current_version: "0.1.6",
        latest_version: "0.1.7"
      };
    }
  }));
  const payload = JSON.parse(result.stdout) as {
    dry_run: boolean;
    openspec_init: {
      status: string;
    };
  };

  assert.equal(result.exitCode, 0);
  assert.equal(checkCalls, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.openspec_init.status, "planned");
});

test("init skips OpenSpec init when the repo is already initialized", async () => {
  const targetRepo = createTargetRepo();
  seedOpenSpecRepo(targetRepo, [".claude/skills"]);

  const result = await withCapturedStdout(() => runInitForTest([
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
      target_skill_roots: string[];
    };
  };

  assert.equal(result.exitCode, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.openspec_init.status, "skipped");
  assert.equal(payload.openspec_init.runner, "none");
  assert.equal(payload.install.dry_run, true);
  assert.deepEqual(payload.install.target_skill_roots, [".claude/skills"]);
  assert.deepEqual(payload.install.installed_skill_dirs, expectedSkillDirs([".claude/skills"]));
});

test("init dry-run plans OpenSpec init for clean repos", async () => {
  const targetRepo = createTargetRepo();

  const result = await withCapturedStdout(() => runInitForTest([
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
      target_skill_roots: string[];
    };
  };

  assert.equal(result.exitCode, 0);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.openspec_init.status, "planned");
  assert.equal(payload.openspec_init.runner, "none");
  assert.equal(payload.install.dry_run, true);
  assert.deepEqual(payload.install.target_skill_roots, []);
  assert.deepEqual(payload.install.installed_skill_dirs, []);
  assert.equal(existsSync(path.join(targetRepo, "openspec", "config.yaml")), false);
});

test("init dry-run plans skill roots from explicit openspec tool selection", async () => {
  const targetRepo = createTargetRepo();

  const result = await withCapturedStdout(() => runInitForTest([
    targetRepo,
    "--dry-run",
    "--openspec-tools",
    "claude,codex"
  ], {
    runOpenSpecInit() {
      throw new Error("dry-run should not run OpenSpec init");
    }
  }));
  const payload = JSON.parse(result.stdout) as {
    install: {
      installed_skill_dirs: string[];
      target_skill_roots: string[];
    };
    openspec_init: {
      status: string;
    };
  };

  assert.equal(payload.openspec_init.status, "planned");
  assert.deepEqual(payload.install.target_skill_roots, [".claude/skills", ".codex/skills"]);
  assert.deepEqual(payload.install.installed_skill_dirs, expectedSkillDirs([".claude/skills", ".codex/skills"]));
  assert.equal(existsSync(path.join(targetRepo, "openspec", "config.yaml")), false);
});
