import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import {
  installExtensions,
  isOpenSpecInitialized,
  type InstallOptions,
  type InstallResult
} from "./install";

const OPENSPEC_NPM_PACKAGE = "@fission-ai/openspec@1.2.0";
const EXTENSIONS_NPM_PACKAGE = "openspec-extensions";
const SELF_UPDATE_SKIP_ENV = "OPENSPEC_EXTENSIONS_SKIP_SELF_UPDATE_CHECK";
const PACKAGE_VERSION = readPackageVersion();

const INIT_HELP_TEXT = `Usage:
  openspec-extensions init [path] [--source-repo <path>] [--force] [--force-config] [--skip-gitignore] [--dry-run] [--openspec-tools <tools>] [--openspec-profile <profile>] [--openspec-force]
  openspec-extensions init --target-repo <path> [--source-repo <path>] [--force] [--force-config] [--skip-gitignore] [--dry-run] [--openspec-tools <tools>] [--openspec-profile <profile>] [--openspec-force]

Notes:
  Omit --openspec-tools to keep the official OpenSpec tool selector interactive.
  Interactive terminals may offer to rerun init via the latest openspec-extensions package.
`;

type InitOptions = InstallOptions & {
  openspecForce: boolean;
  openspecProfile: string;
  openspecTools: string;
};

type OpenSpecInitRequest = {
  force: boolean;
  profile: string;
  targetRepo: string;
  tools?: string;
};

type OpenSpecCommandMode = "captured" | "interactive";

type OpenSpecCommandResult = {
  error?: {
    code?: string;
    message: string;
  };
  signal?: string | null;
  status: number | null;
  stderr?: Buffer | string | null;
  stdout?: Buffer | string | null;
};

type OpenSpecInitStatus = {
  command: string[];
  fallback_command: string[];
  reason: string;
  runner: "openspec" | "npx" | "none";
  status: "executed" | "planned" | "skipped";
};

type PackageUpdateStatus = {
  current_version: string;
  latest_version: string;
};

type InitResult = {
  dry_run: boolean;
  install: InstallResult;
  openspec_init: OpenSpecInitStatus;
};

export type InitDependencies = {
  checkForPackageUpdate?: () => PackageUpdateStatus | null | Promise<PackageUpdateStatus | null>;
  confirmPackageUpdate?: (status: PackageUpdateStatus) => boolean | Promise<boolean>;
  isInteractiveTerminal?: () => boolean;
  relaunchWithLatestVersion?: (argv: string[]) => number | Promise<number>;
  runOpenSpecInit?: (request: OpenSpecInitRequest) => "openspec" | "npx";
  runOpenSpecCommand?: (
    command: string[],
    mode: OpenSpecCommandMode
  ) => OpenSpecCommandResult;
};

type ParsedSemver = {
  core: [number, number, number];
  prerelease: Array<number | string>;
};

function buildOpenSpecInitCommands(request: OpenSpecInitRequest): {
  fallbackCommand: string[];
  primaryCommand: string[];
} {
  const sharedArgs = ["init"];
  // 只在用户显式指定时透传，避免默认把 Codex 写进 OpenSpec 基础配置。
  if (request.tools) {
    sharedArgs.push("--tools", request.tools);
  }
  if (request.profile) {
    sharedArgs.push("--profile", request.profile);
  }
  if (request.force) {
    sharedArgs.push("--force");
  }
  sharedArgs.push(request.targetRepo);

  return {
    fallbackCommand: ["npx", "--yes", OPENSPEC_NPM_PACKAGE, ...sharedArgs],
    primaryCommand: ["openspec", ...sharedArgs]
  };
}

function readPackageVersion(): string {
  const packageJsonPath = path.resolve(__dirname, "../../package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
}

function parseSemver(version: string): ParsedSemver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!match) {
    return null;
  }

  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]
      ? match[4].split(".").map((identifier) => (/^\d+$/.test(identifier) ? Number(identifier) : identifier))
      : []
  };
}

function compareSemverIdentifier(left: number | string, right: number | string): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "number") {
    return -1;
  }
  if (typeof right === "number") {
    return 1;
  }
  return left.localeCompare(right);
}

function comparePackageVersions(left: string, right: string): number {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (!parsedLeft || !parsedRight) {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  }

  for (let index = 0; index < parsedLeft.core.length; index += 1) {
    const difference = parsedLeft.core[index] - parsedRight.core[index];
    if (difference !== 0) {
      return difference;
    }
  }

  if (parsedLeft.prerelease.length === 0 && parsedRight.prerelease.length === 0) {
    return 0;
  }
  if (parsedLeft.prerelease.length === 0) {
    return 1;
  }
  if (parsedRight.prerelease.length === 0) {
    return -1;
  }

  const length = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = parsedLeft.prerelease[index];
    const rightIdentifier = parsedRight.prerelease[index];
    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }

    const difference = compareSemverIdentifier(leftIdentifier, rightIdentifier);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function parsePackageVersionOutput(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return trimmed;
  }
}

function checkForPackageUpdate(): PackageUpdateStatus | null {
  const result = spawnSync("npm", ["view", EXTENSIONS_NPM_PACKAGE, "version", "--json"], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return null;
  }

  const latestVersion = parsePackageVersionOutput(result.stdout);
  if (!latestVersion || comparePackageVersions(latestVersion, PACKAGE_VERSION) <= 0) {
    return null;
  }

  return {
    current_version: PACKAGE_VERSION,
    latest_version: latestVersion
  };
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

async function confirmPackageUpdate(status: PackageUpdateStatus): Promise<boolean> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr
  });

  try {
    const answer = (await readline.question(
      `检测到 ${EXTENSIONS_NPM_PACKAGE} 有新版本 ${status.latest_version}（当前 ${status.current_version}）。是否使用最新版本继续本次 init？[Y/n] `
    ))
      .trim()
      .toLowerCase();

    return answer === "" || answer === "y" || answer === "yes" || answer === "是";
  } finally {
    readline.close();
  }
}

function relaunchWithLatestVersion(argv: string[]): number {
  // 用 stderr 做交互提示，避免污染 stdout 的 JSON 输出。
  process.stderr.write(`将使用最新版本继续本次 init；当前安装不会被自动改写。\n`);
  const result = spawnSync(
    "npx",
    ["--yes", "--package", `${EXTENSIONS_NPM_PACKAGE}@latest`, "openspec-ex", "init", ...argv],
    {
      env: {
        ...process.env,
        [SELF_UPDATE_SKIP_ENV]: "1"
      },
      stdio: "inherit"
    }
  );

  if (typeof result.status === "number") {
    return result.status;
  }
  if (result.error?.message) {
    throw new Error(`Failed to run latest ${EXTENSIONS_NPM_PACKAGE}: ${result.error.message}`);
  }
  if (result.signal) {
    throw new Error(`Latest ${EXTENSIONS_NPM_PACKAGE} init terminated by signal ${result.signal}`);
  }
  throw new Error(`Failed to run latest ${EXTENSIONS_NPM_PACKAGE}.`);
}

async function maybeRelaunchWithLatestVersion(
  argv: string[],
  dependencies: InitDependencies
): Promise<number | null> {
  if (process.env[SELF_UPDATE_SKIP_ENV] === "1") {
    return null;
  }

  const interactiveTerminal = dependencies.isInteractiveTerminal ?? isInteractiveTerminal;
  if (!interactiveTerminal()) {
    return null;
  }

  const resolveUpdate = dependencies.checkForPackageUpdate ?? checkForPackageUpdate;
  const packageUpdate = await resolveUpdate();
  if (!packageUpdate) {
    return null;
  }

  const confirmUpdate = dependencies.confirmPackageUpdate ?? confirmPackageUpdate;
  if (!(await confirmUpdate(packageUpdate))) {
    return null;
  }

  const relaunch = dependencies.relaunchWithLatestVersion ?? relaunchWithLatestVersion;
  return relaunch(argv);
}

// 不显式传工具时把终端直接交给 OpenSpec，让官方选择器继续可用。
function resolveOpenSpecCommandMode(request: OpenSpecInitRequest): OpenSpecCommandMode {
  return request.tools ? "captured" : "interactive";
}

function runCommand(command: string[], mode: OpenSpecCommandMode): OpenSpecCommandResult {
  if (mode === "interactive") {
    return spawnSync(command[0], command.slice(1), {
      stdio: "inherit"
    });
  }

  return spawnSync(command[0], command.slice(1), {
    encoding: "utf8"
  });
}

function outputText(output: Buffer | string | null | undefined): string {
  if (typeof output === "string") {
    return output;
  }
  if (output instanceof Buffer) {
    return output.toString("utf8");
  }
  return "";
}

function commandFailureDetails(result: OpenSpecCommandResult): string {
  const stderr = outputText(result.stderr);
  const stdout = outputText(result.stdout);

  if (stderr || stdout) {
    return (stderr || stdout).trim();
  }
  if (result.error?.message) {
    return result.error.message.trim();
  }
  if (typeof result.status === "number") {
    return `command failed with exit code ${result.status}`;
  }
  if (result.signal) {
    return `command terminated by signal ${result.signal}`;
  }
  return "command failed";
}

function runPreferredOpenSpecInit(
  request: OpenSpecInitRequest,
  runOpenSpecCommand: (
    command: string[],
    mode: OpenSpecCommandMode
  ) => OpenSpecCommandResult = runCommand
): "openspec" | "npx" {
  const commands = buildOpenSpecInitCommands(request);
  const mode = resolveOpenSpecCommandMode(request);
  const primary = runOpenSpecCommand(commands.primaryCommand, mode);

  if (primary.status === 0) {
    return "openspec";
  }

  const primaryError = primary.error;
  if (primaryError?.code === "ENOENT") {
    const fallback = runOpenSpecCommand(commands.fallbackCommand, mode);
    if (fallback.status === 0) {
      return "npx";
    }

    throw new Error(`${commands.fallbackCommand.join(" ")}\n${commandFailureDetails(fallback)}`);
  }

  throw new Error(`${commands.primaryCommand.join(" ")}\n${commandFailureDetails(primary)}`);
}

function parseInitArgs(argv: string[]): InitOptions | null {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "force-config": { type: "boolean", default: false },
      help: { short: "h", type: "boolean", default: false },
      "openspec-force": { type: "boolean", default: false },
      "openspec-profile": { type: "string", default: "" },
      "openspec-tools": { type: "string", default: "" },
      "skip-gitignore": { type: "boolean", default: false },
      "source-repo": { type: "string", default: "" },
      "target-repo": { type: "string", default: "" }
    },
    strict: true
  });

  if (values.help) {
    process.stdout.write(INIT_HELP_TEXT);
    return null;
  }

  if (positionals.length > 1) {
    throw new Error("Expected at most one positional path argument.");
  }

  const positionalTarget = positionals[0] ?? "";
  const optionTarget = values["target-repo"];
  if (positionalTarget && optionTarget && path.resolve(positionalTarget) !== path.resolve(optionTarget)) {
    throw new Error("Positional path and --target-repo must match when both are provided.");
  }

  const targetRepo = positionalTarget || optionTarget || ".";

  return {
    dryRun: values["dry-run"],
    force: values.force,
    forceConfig: values["force-config"],
    openspecForce: values["openspec-force"],
    openspecProfile: values["openspec-profile"],
    openspecTools: values["openspec-tools"].trim(),
    skipGitignore: values["skip-gitignore"],
    sourceRepo: values["source-repo"],
    targetRepo
  };
}

export async function runInitCommand(
  argv: string[],
  dependencies: InitDependencies = {}
): Promise<number> {
  const parsed = parseInitArgs(argv);
  if (!parsed) {
    return 0;
  }

  const relaunchExitCode = await maybeRelaunchWithLatestVersion(argv, dependencies);
  if (relaunchExitCode !== null) {
    return relaunchExitCode;
  }

  const targetRepo = realpathSync(path.resolve(parsed.targetRepo));
  const request: OpenSpecInitRequest = {
    force: parsed.openspecForce,
    profile: parsed.openspecProfile,
    targetRepo,
    tools: parsed.openspecTools || undefined
  };
  const commands = buildOpenSpecInitCommands(request);

  let openspecInit: OpenSpecInitStatus;
  if (isOpenSpecInitialized(targetRepo)) {
    openspecInit = {
      command: commands.primaryCommand,
      fallback_command: commands.fallbackCommand,
      reason: "Target repo already contains openspec/config.yaml.",
      runner: "none",
      status: "skipped"
    };
  } else if (parsed.dryRun) {
    openspecInit = {
      command: commands.primaryCommand,
      fallback_command: commands.fallbackCommand,
      reason: "Target repo is missing openspec/config.yaml. Init would run OpenSpec first, then install extension skills.",
      runner: "none",
      status: "planned"
    };
  } else {
    const runner =
      dependencies.runOpenSpecInit ??
      ((openSpecRequest: OpenSpecInitRequest) =>
        runPreferredOpenSpecInit(openSpecRequest, dependencies.runOpenSpecCommand));
    openspecInit = {
      command: commands.primaryCommand,
      fallback_command: commands.fallbackCommand,
      reason: "OpenSpec initialization completed before installing extension skills.",
      runner: runner(request),
      status: "executed"
    };
  }

  // dry-run 且尚未初始化时，只有显式传了工具列表才能可靠推导目标 skills 目录。
  const install = installExtensions(parsed, {
    allowMissingSkillRoots: openspecInit.status === "planned",
    plannedOpenSpecTools: openspecInit.status === "planned" ? parsed.openspecTools : undefined,
    skipOpenSpecPreflight: true
  });
  const result = {
    dry_run: parsed.dryRun,
    install,
    openspec_init: openspecInit
  } satisfies InitResult;

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}
