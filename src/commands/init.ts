import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  installExtensions,
  isOpenSpecInitialized,
  type InstallOptions,
  type InstallResult
} from "./install";

const INIT_HELP_TEXT = `Usage:
  openspec-extensions init [path] [--source-repo <path>] [--force] [--force-config] [--skip-gitignore] [--dry-run] [--openspec-tools <tools>] [--openspec-profile <profile>] [--openspec-force]
  openspec-extensions init --target-repo <path> [--source-repo <path>] [--force] [--force-config] [--skip-gitignore] [--dry-run] [--openspec-tools <tools>] [--openspec-profile <profile>] [--openspec-force]
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
  tools: string;
};

type OpenSpecInitStatus = {
  command: string[];
  fallback_command: string[];
  reason: string;
  runner: "openspec" | "npx" | "none";
  status: "executed" | "planned" | "skipped";
};

type InitResult = {
  dry_run: boolean;
  install: InstallResult;
  openspec_init: OpenSpecInitStatus;
};

export type InitDependencies = {
  runOpenSpecInit?: (request: OpenSpecInitRequest) => "openspec" | "npx";
};

function buildOpenSpecInitCommands(request: OpenSpecInitRequest): {
  fallbackCommand: string[];
  primaryCommand: string[];
} {
  const sharedArgs = ["init", "--tools", request.tools];
  if (request.profile) {
    sharedArgs.push("--profile", request.profile);
  }
  if (request.force) {
    sharedArgs.push("--force");
  }
  sharedArgs.push(request.targetRepo);

  return {
    fallbackCommand: ["npx", "--yes", "@fission-ai/openspec@latest", ...sharedArgs],
    primaryCommand: ["openspec", ...sharedArgs]
  };
}

function runCommand(command: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(command[0], command.slice(1), {
    encoding: "utf8"
  });
}

function commandFailureDetails(result: ReturnType<typeof spawnSync>): string {
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  return (stderr || stdout || result.error?.message || "command failed").trim();
}

function runPreferredOpenSpecInit(request: OpenSpecInitRequest): "openspec" | "npx" {
  const commands = buildOpenSpecInitCommands(request);
  const primary = runCommand(commands.primaryCommand);

  if (primary.status === 0) {
    return "openspec";
  }

  const primaryError = primary.error as NodeJS.ErrnoException | undefined;
  if (primaryError?.code === "ENOENT") {
    const fallback = runCommand(commands.fallbackCommand);
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
      "openspec-tools": { type: "string", default: "codex" },
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
  if (!values["openspec-tools"].trim()) {
    throw new Error("Missing required option: --openspec-tools");
  }

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

export function runInitCommand(
  argv: string[],
  dependencies: InitDependencies = {}
): number {
  const parsed = parseInitArgs(argv);
  if (!parsed) {
    return 0;
  }

  const targetRepo = realpathSync(path.resolve(parsed.targetRepo));
  const request: OpenSpecInitRequest = {
    force: parsed.openspecForce,
    profile: parsed.openspecProfile,
    targetRepo,
    tools: parsed.openspecTools
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
    const runner = (dependencies.runOpenSpecInit ?? runPreferredOpenSpecInit)(request);
    openspecInit = {
      command: commands.primaryCommand,
      fallback_command: commands.fallbackCommand,
      reason: "OpenSpec initialization completed before installing extension skills.",
      runner,
      status: "executed"
    };
  }

  const install = installExtensions(parsed, { skipOpenSpecPreflight: true });
  const result = {
    dry_run: parsed.dryRun,
    install,
    openspec_init: openspecInit
  } satisfies InitResult;

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}
