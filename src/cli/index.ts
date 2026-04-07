#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";

import { runArchiveCommand } from "../commands/archive";
import { runDispatchCommand } from "../commands/dispatch";
import { runInitCommand } from "../commands/init";
import { runInstallCommand } from "../commands/install";
import { runReconcileCommand } from "../commands/reconcile";
import { runReviewCommand } from "../commands/review";
import { runVerifyCommand } from "../commands/verify";
import { runWorktreeCommand } from "../commands/worktree";
import { runSeatStateCommand } from "../commands/execute/seat-state";
import { runUpdateProgressCommand } from "../commands/execute/update-progress";

const PACKAGE_VERSION = readPackageVersion();

const HELP_TEXT = `OpenSpec Extensions CLI

Usage:
  openspec-extensions -v
  openspec-extensions --version
  openspec-extensions init [path]
  openspec-extensions install [options]
  openspec-extensions dispatch issue [options]
  openspec-extensions dispatch issue-team [options]
  openspec-extensions dispatch lifecycle [options]
  openspec-extensions execute update-progress <start|checkpoint|stop> [options]
  openspec-extensions execute seat-state set [options]
  openspec-extensions reconcile change [options]
  openspec-extensions reconcile commit-planning-docs [options]
  openspec-extensions reconcile merge-issue [options]
  openspec-extensions review change [options]
  openspec-extensions verify change [options]
  openspec-extensions archive change [options]
  openspec-extensions worktree create [options]

Commands:
  init                    Initialize OpenSpec when needed, keep the official tool prompt when tools are not preset, ask which issue-mode automation style to install, and offer a local CLI upgrade in interactive terminals.
  install                 Install OpenSpec extension skills into a target repo and ask which issue-mode automation style to apply when --force-config overwrites config in interactive terminals.
  dispatch issue          Render a single issue dispatch packet.
  dispatch issue-team     Render a subagent-team issue dispatch packet.
  dispatch lifecycle      Render the change lifecycle dispatch packet.
  execute update-progress Update issue progress and run artifacts.
  execute seat-state      Update seat lifecycle state for the active dispatch.
  reconcile change        Reconcile change state and continuation policy.
  reconcile commit-planning-docs Commit planning docs for a change.
  reconcile merge-issue   Accept and merge one reviewed issue into the coordinator branch.
  review change           Run change-level coordinator review.
  verify change           Run change-level coordinator verify.
  archive change          Archive a change and clean up change worktree state.
  worktree create         Create or reuse a worker worktree for an issue.

Options:
  -h, --help              Show help.
  -v, --version           Show package version.
`;

function readPackageVersion(): string {
  const packageJsonPath = path.resolve(__dirname, "../../package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "-h" || command === "--help") {
    process.stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  // 兼容常见 CLI 习惯，版本号允许不带子命令直接查询
  if (command === "-v" || command === "--version") {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return 0;
  }

  if (command === "install") {
    return runInstallCommand(rest);
  }

  if (command === "init" || command === "bootstrap") {
    return runInitCommand(rest);
  }

  if (command === "dispatch") {
    return runDispatchCommand(rest);
  }

  if (command === "execute" && rest[0] === "update-progress") {
    return runUpdateProgressCommand(rest.slice(1));
  }

  if (command === "execute" && rest[0] === "seat-state") {
    return runSeatStateCommand(rest.slice(1));
  }

  if (command === "reconcile") {
    return runReconcileCommand(rest);
  }

  if (command === "review") {
    return runReviewCommand(rest);
  }

  if (command === "verify") {
    return runVerifyCommand(rest);
  }

  if (command === "archive") {
    return runArchiveCommand(rest);
  }

  if (command === "worktree") {
    return runWorktreeCommand(rest);
  }

  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

if (require.main === module) {
  void main(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  );
}
