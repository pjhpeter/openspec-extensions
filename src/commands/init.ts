import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { readOwnPackageVersion } from "../domain/extensions-metadata";
import {
  installExtensions,
  isOpenSpecInitialized,
  type InstallOptions,
  type InstallResult
} from "./install";

const OPENSPEC_NPM_PACKAGE = "@fission-ai/openspec@~1.2.0";
const EXTENSIONS_NPM_PACKAGE = "openspec-extensions";
const SELF_UPDATE_SKIP_ENV = "OPENSPEC_EXTENSIONS_SKIP_SELF_UPDATE_CHECK";
const PACKAGE_VERSION = readOwnPackageVersion();
const BUNDLED_NODE_BIN_PATH = path.join("node_modules", ".bin");
const ISSUE_MODE_CONFIG_PATH = path.join("openspec", "issue-mode.json");

const INIT_HELP_TEXT = `Usage:
  openspec-extensions init [path] [--source-repo <path>] [--force] [--force-config] [--skip-gitignore] [--dry-run] [--openspec-tools <tools>] [--openspec-profile <profile>] [--openspec-force]
  openspec-extensions init --target-repo <path> [--source-repo <path>] [--force] [--force-config] [--skip-gitignore] [--dry-run] [--openspec-tools <tools>] [--openspec-profile <profile>] [--openspec-force]

Notes:
  Omit --openspec-tools to keep the official OpenSpec tool selector interactive.
  Interactive terminals may offer to upgrade the local openspec-extensions CLI before continuing init.
  Interactive terminals also ask which issue-mode automation style to install when writing openspec/issue-mode.json.
`;

type JsonObject = Record<string, unknown>;
type ProcessEnvMap = Record<string, string | undefined>;

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

type IssueModeAutomationPreference = "semi-auto" | "full-auto";

type InitResult = {
  dry_run: boolean;
  install: InstallResult;
  openspec_init: OpenSpecInitStatus;
};

export type InitDependencies = {
  checkForPackageUpdate?: () => PackageUpdateStatus | null | Promise<PackageUpdateStatus | null>;
  confirmPackageUpdate?: (status: PackageUpdateStatus) => boolean | Promise<boolean>;
  isInteractiveTerminal?: () => boolean;
  promptIssueModeAutomationPreference?: () =>
    | IssueModeAutomationPreference
    | Promise<IssueModeAutomationPreference>;
  relaunchWithLatestVersion?: (status: PackageUpdateStatus, argv: string[]) => number | Promise<number>;
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

const ISSUE_MODE_AUTOMATION_OVERRIDES: Record<IssueModeAutomationPreference, JsonObject> = {
  "semi-auto": {
    rra: {
      gate_mode: "advisory"
    },
    subagent_team: {
      auto_accept_spec_readiness: false,
      auto_accept_issue_planning: false,
      auto_accept_issue_review: false,
      auto_accept_change_acceptance: false,
      auto_archive_after_verify: false
    }
  },
  "full-auto": {
    rra: {
      gate_mode: "enforce"
    },
    subagent_team: {
      auto_accept_spec_readiness: true,
      auto_accept_issue_planning: true,
      auto_accept_issue_review: true,
      auto_accept_change_acceptance: true,
      auto_archive_after_verify: true
    }
  }
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

function commandPackageRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

export function withBundledOpenSpecPath(
  env: ProcessEnvMap,
  packageRoot: string = commandPackageRoot()
): ProcessEnvMap {
  const bundledNodeBin = path.join(packageRoot, BUNDLED_NODE_BIN_PATH);
  if (!existsSync(bundledNodeBin)) {
    return { ...env };
  }

  const normalizedBundledNodeBin = path.resolve(bundledNodeBin);
  const currentPathEntries = (env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .filter((entry) => path.resolve(entry) !== normalizedBundledNodeBin);

  return {
    ...env,
    // 优先使用随包安装的 openspec，避免全新环境还得先手装官方 CLI。
    PATH: [bundledNodeBin, ...currentPathEntries].join(path.delimiter)
  };
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
      `A newer version of ${EXTENSIONS_NPM_PACKAGE} is available (${status.latest_version}; current: ${status.current_version}). Upgrade the local CLI and continue this init? [Y/n] `
    ))
      .trim()
      .toLowerCase();

    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    readline.close();
  }
}

async function promptIssueModeAutomationPreference(): Promise<IssueModeAutomationPreference> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr
  });

  try {
    for (;;) {
      const answer = (await readline.question(
        "Choose the issue-mode automation style to install: [1] Semi-automatic and controllable (recommended) [2] Fully automatic and hands-off [1/2] "
      ))
        .trim()
        .toLowerCase();

      if (answer === "" || answer === "1" || answer === "semi" || answer === "semi-auto") {
        return "semi-auto";
      }
      if (answer === "2" || answer === "full" || answer === "full-auto" || answer === "auto") {
        return "full-auto";
      }

      process.stderr.write("Please enter 1 or 2.\n");
    }
  } finally {
    readline.close();
  }
}

function relaunchWithLatestVersion(status: PackageUpdateStatus, argv: string[]): number {
  // 先升级本地 CLI，再重跑当前 init，避免“确认升级”只影响这一轮进程。
  process.stderr.write(
    `Upgrading local ${EXTENSIONS_NPM_PACKAGE} to ${status.latest_version} before continuing init...\n`
  );
  const installResult = spawnSync(
    "npm",
    ["install", "-g", `${EXTENSIONS_NPM_PACKAGE}@${status.latest_version}`],
    {
      stdio: "inherit"
    }
  );

  if (installResult.status !== 0) {
    if (installResult.error?.message) {
      throw new Error(`Failed to upgrade ${EXTENSIONS_NPM_PACKAGE}: ${installResult.error.message}`);
    }
    if (installResult.signal) {
      throw new Error(`Upgrade of ${EXTENSIONS_NPM_PACKAGE} terminated by signal ${installResult.signal}`);
    }
    throw new Error(`Failed to upgrade ${EXTENSIONS_NPM_PACKAGE}: npm install exited with code ${installResult.status}`);
  }

  const rerunResult = spawnSync(
    "openspec-ex",
    ["init", ...argv],
    {
      env: {
        ...process.env,
        [SELF_UPDATE_SKIP_ENV]: "1"
      },
      stdio: "inherit"
    }
  );

  if (typeof rerunResult.status === "number") {
    return rerunResult.status;
  }
  if (rerunResult.error?.message) {
    throw new Error(`Failed to rerun ${EXTENSIONS_NPM_PACKAGE} after upgrade: ${rerunResult.error.message}`);
  }
  if (rerunResult.signal) {
    throw new Error(`Upgraded ${EXTENSIONS_NPM_PACKAGE} init terminated by signal ${rerunResult.signal}`);
  }
  throw new Error(`Failed to rerun ${EXTENSIONS_NPM_PACKAGE} after upgrade.`);
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
  return relaunch(packageUpdate, argv);
}

// 不显式传工具时把终端直接交给 OpenSpec，让官方选择器继续可用。
function resolveOpenSpecCommandMode(request: OpenSpecInitRequest): OpenSpecCommandMode {
  return request.tools ? "captured" : "interactive";
}

function runCommand(command: string[], mode: OpenSpecCommandMode): OpenSpecCommandResult {
  const env = withBundledOpenSpecPath(process.env);

  if (mode === "interactive") {
    return spawnSync(command[0], command.slice(1), {
      env,
      stdio: "inherit"
    });
  }

  return spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    env
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

function shouldPromptForIssueModeAutomation(targetRepo: string, parsed: InitOptions, interactive: boolean): boolean {
  if (!interactive || parsed.dryRun) {
    return false;
  }

  const configPath = path.join(targetRepo, ISSUE_MODE_CONFIG_PATH);
  return parsed.forceConfig || !existsSync(configPath);
}

async function resolveIssueModeConfigOverrides(
  targetRepo: string,
  parsed: InitOptions,
  dependencies: InitDependencies
): Promise<JsonObject> {
  const interactiveTerminal = dependencies.isInteractiveTerminal ?? isInteractiveTerminal;
  if (!shouldPromptForIssueModeAutomation(targetRepo, parsed, interactiveTerminal())) {
    return {};
  }

  const resolvePreference =
    dependencies.promptIssueModeAutomationPreference ?? promptIssueModeAutomationPreference;
  const preference = await resolvePreference();
  // 这里显式写全关键开关，避免模板默认值漂移后和用户选择不一致。
  return ISSUE_MODE_AUTOMATION_OVERRIDES[preference];
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

  const configOverrides = await resolveIssueModeConfigOverrides(targetRepo, parsed, dependencies);

  // dry-run 且尚未初始化时，只有显式传了工具列表才能可靠推导目标 skills 目录。
  const install = installExtensions(parsed, {
    allowMissingSkillRoots: openspecInit.status === "planned",
    configOverrides,
    plannedOpenSpecTools: openspecInit.status === "planned" ? parsed.openspecTools : undefined,
    recordedBy: "init",
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
