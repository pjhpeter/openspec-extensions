#!/usr/bin/env node
/* global __dirname, process, require */

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function parsePackOutput(rawOutput) {
  const payload = JSON.parse(rawOutput);
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("npm pack --json did not return an array payload.");
  }
  return payload[payload.length - 1];
}

function verifyNpxInstall(repoRoot, tarballPath) {
  const targetRepo = createTempDir("opsx-smoke-npx-target-");
  try {
    writeGitignore(targetRepo);
    const stdout = run(
      "npx",
      ["--yes", "--package", tarballPath, "openspec-extensions", "install", "--target-repo", targetRepo, "--dry-run"],
      { cwd: repoRoot }
    );
    const payload = JSON.parse(stdout);

    assert.equal(payload.dry_run, true);
    assert.ok(Array.isArray(payload.installed_skill_dirs));
    assert.ok(payload.installed_skill_dirs.includes(".codex/skills/openspec-shared"));
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

function verifyInstalledBin(tarballPath) {
  const packageRepo = createTempDir("opsx-smoke-install-pkg-");
  const targetRepo = createTempDir("opsx-smoke-install-target-");
  try {
    writeGitignore(targetRepo);
    run("npm", ["init", "-y"], { cwd: packageRepo });
    run("npm", ["install", tarballPath], { cwd: packageRepo });

    const binPath = path.join(
      packageRepo,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "openspec-extensions.cmd" : "openspec-extensions"
    );
    const stdout = run(binPath, ["install", "--target-repo", targetRepo], { cwd: packageRepo });
    const payload = JSON.parse(stdout);

    assert.equal(payload.dry_run, false);
    assert.equal(payload.config.status, "installed");
    assert.ok(fs.existsSync(path.join(targetRepo, ".codex", "skills", "openspec-shared", "scripts", "issue_mode_common.py")));
    assert.ok(fs.existsSync(path.join(targetRepo, "openspec", "issue-mode.json")));

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
