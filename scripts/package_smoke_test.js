#!/usr/bin/env node
/* global __dirname, process, require */

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EXTENSION_SKILL_NAMES = [
  "openspec-chat-router",
  "openspec-plan-issues",
  "openspec-dispatch-issue",
  "openspec-execute-issue",
  "openspec-reconcile-change",
  "openspec-subagent-team",
];
const OPENSPEC_SKILL_MARKER = "openspec-onboard";

function expectedSkillDirs(targetSkillRoots) {
  return targetSkillRoots.flatMap((skillsRoot) =>
    EXTENSION_SKILL_NAMES.map((skillName) => `${skillsRoot}/${skillName}`)
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "command failed").trim();
    throw new Error(`${command} ${args.join(" ")}\n${details}`);
  }

  return result.stdout.trim();
}

function writeGitignore(repoRoot) {
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), ".cache/\n");
}

function seedOpenSpecRepo(repoRoot, targetSkillRoots = [".claude/skills"]) {
  fs.mkdirSync(path.join(repoRoot, "openspec", "changes", "archive"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "openspec", "specs"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "openspec", "config.yaml"), "schema: spec-driven\n");
  for (const skillsRoot of targetSkillRoots) {
    const markerPath = path.join(repoRoot, skillsRoot, OPENSPEC_SKILL_MARKER, "SKILL.md");
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, "---\nname: openspec-onboard\n---\n");
  }
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function collectMatchingFiles(rootDir, predicate, currentDir = rootDir) {
  const matches = [];
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      matches.push(...collectMatchingFiles(rootDir, predicate, entryPath));
      continue;
    }
    if (predicate(entryPath)) {
      matches.push(path.relative(rootDir, entryPath));
    }
  }
  return matches.sort();
}

function parsePackOutput(rawOutput) {
  const payload = JSON.parse(rawOutput);
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("npm pack --json did not return an array payload.");
  }
  return payload[payload.length - 1];
}

function verifyTarballContents(tarballPath) {
  const entries = run("tar", ["-tf", tarballPath]).split("\n").filter(Boolean);

  assert.ok(entries.includes("package/dist/cli/index.js"));
  assert.ok(entries.includes("package/dist/cli/openspec.js"));
  assert.ok(entries.includes("package/skills/openspec-dispatch-issue/SKILL.md"));
  assert.equal(entries.includes("package/skills/openspec-shared/SKILL.md"), false);
  assert.equal(entries.some((entry) => entry.endsWith(".py")), false);

  return {
    mode: "tarball",
    entry_count: entries.length,
  };
}

function verifyNpxInstall(repoRoot, tarballPath) {
  const targetRepo = createTempDir("opsx-smoke-npx-target-");
  try {
    writeGitignore(targetRepo);
    seedOpenSpecRepo(targetRepo, [".claude/skills"]);
    const stdout = run(
      "npx",
      ["--yes", "--package", tarballPath, "openspec-extensions", "install", "--target-repo", targetRepo, "--dry-run"],
      { cwd: repoRoot }
    );
    const payload = JSON.parse(stdout);

    assert.equal(payload.dry_run, true);
    assert.deepEqual(payload.target_skill_roots, [".claude/skills"]);
    assert.deepEqual(payload.installed_skill_dirs, expectedSkillDirs([".claude/skills"]));
    assert.match(String(payload.source_repo), /node_modules\/openspec-extensions$/);
    assert.equal(String(payload.target_repo), fs.realpathSync.native(targetRepo));

    return {
      mode: "npx",
      source_repo: payload.source_repo,
      target_repo: payload.target_repo,
    };
  } finally {
    cleanup(targetRepo);
  }
}

function verifyInitDryRun(repoRoot, tarballPath) {
  const targetRepo = createTempDir("opsx-smoke-init-target-");
  try {
    writeGitignore(targetRepo);
    const stdout = run(
      "npx",
      ["--yes", "--package", tarballPath, "openspec-ex", "init", targetRepo, "--dry-run", "--openspec-tools", "claude,codex"],
      { cwd: repoRoot }
    );
    const payload = JSON.parse(stdout);

    assert.equal(payload.dry_run, true);
    assert.equal(payload.openspec_init.status, "planned");
    assert.deepEqual(payload.install.target_skill_roots, [".claude/skills", ".codex/skills"]);
    assert.deepEqual(payload.install.installed_skill_dirs, expectedSkillDirs([".claude/skills", ".codex/skills"]));

    return {
      mode: "init_dry_run",
      target_repo: targetRepo,
    };
  } finally {
    cleanup(targetRepo);
  }
}

function verifyInstalledBin(tarballPath) {
  const packageRepo = createTempDir("opsx-smoke-install-pkg-");
  const targetRepo = createTempDir("opsx-smoke-install-target-");
  try {
    writeGitignore(targetRepo);
    seedOpenSpecRepo(targetRepo, [".claude/skills"]);
    run("npm", ["init", "-y"], { cwd: packageRepo });
    run("npm", ["install", tarballPath], { cwd: packageRepo });

    const binPath = path.join(
      packageRepo,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "openspec-extensions.cmd" : "openspec-extensions"
    );
    const aliasBinPath = path.join(
      packageRepo,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "openspec-ex.cmd" : "openspec-ex"
    );
    const openspecBinPath = path.join(
      packageRepo,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "openspec.cmd" : "openspec"
    );
    const stdout = run(binPath, ["install", "--target-repo", targetRepo], { cwd: packageRepo });
    const payload = JSON.parse(stdout);
    const installedPackageRoot = path.join(packageRepo, "node_modules", "openspec-extensions");
    const bundledOpenSpecModuleEntry = require.resolve("@fission-ai/openspec", {
      paths: [installedPackageRoot]
    });
    const bundledOpenSpecEntry = path.join(path.dirname(bundledOpenSpecModuleEntry), "..", "bin", "openspec.js");
    const bundledOpenSpecPackageJson = path.join(path.dirname(path.dirname(bundledOpenSpecEntry)), "package.json");
    const bundledOpenSpecVersion = JSON.parse(
      fs.readFileSync(bundledOpenSpecPackageJson, "utf8")
    ).version;
    const openspecVersion = run(openspecBinPath, ["--version"], { cwd: packageRepo });

    assert.equal(payload.dry_run, false);
    assert.equal(payload.config.status, "installed");
    assert.deepEqual(payload.target_skill_roots, [".claude/skills"]);
    assert.deepEqual(payload.installed_skill_dirs, expectedSkillDirs([".claude/skills"]));
    assert.ok(fs.existsSync(path.join(targetRepo, ".claude", "skills", "openspec-chat-router", "SKILL.md")));
    assert.ok(!fs.existsSync(path.join(targetRepo, ".claude", "skills", "openspec-shared")));
    assert.ok(fs.existsSync(path.join(targetRepo, "openspec", "issue-mode.json")));
    assert.ok(fs.existsSync(aliasBinPath));
    assert.ok(fs.existsSync(openspecBinPath));
    assert.equal(openspecVersion, bundledOpenSpecVersion);
    assert.deepEqual(
      collectMatchingFiles(installedPackageRoot, (filePath) => filePath.endsWith(".py")),
      []
    );
    assert.deepEqual(
      collectMatchingFiles(targetRepo, (filePath) => filePath.endsWith(".py")),
      []
    );

    const gitignoreText = fs.readFileSync(path.join(targetRepo, ".gitignore"), "utf8");
    assert.match(gitignoreText, /\.worktree\/\n/);
    assert.match(gitignoreText, /openspec\/changes\/\*\/runs\/CHANGE-REVIEW\.json\n/);
    assert.match(gitignoreText, /openspec\/changes\/\*\/runs\/CHANGE-VERIFY\.json\n/);

    return {
      mode: "installed_bin",
      source_repo: payload.source_repo,
      target_repo: payload.target_repo,
    };
  } finally {
    cleanup(packageRepo);
    cleanup(targetRepo);
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const packOutput = parsePackOutput(run("npm", ["pack", "--json"], { cwd: repoRoot }));
  const tarballPath = path.join(repoRoot, packOutput.filename);

  try {
    const checks = [
      verifyTarballContents(tarballPath),
      verifyInitDryRun(repoRoot, tarballPath),
      verifyNpxInstall(repoRoot, tarballPath),
      verifyInstalledBin(tarballPath),
    ];

    process.stdout.write(`${JSON.stringify({
      checks,
      package: {
        filename: packOutput.filename,
        integrity: packOutput.integrity,
        shasum: packOutput.shasum,
        size: packOutput.size,
        unpackedSize: packOutput.unpackedSize,
      },
      success: true,
    }, null, 2)}\n`);
  } finally {
    if (fs.existsSync(tarballPath)) {
      fs.rmSync(tarballPath, { force: true });
    }
  }
}

main();
