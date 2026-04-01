#!/usr/bin/env node

import { runDispatchCommand } from "../commands/dispatch";
import { runInstallCommand } from "../commands/install";
import { runUpdateProgressCommand } from "../commands/execute/update-progress";

const HELP_TEXT = `OpenSpec Extensions CLI

Usage:
  openspec-extensions install [options]
  openspec-extensions dispatch issue [options]
  openspec-extensions dispatch issue-team [options]
  openspec-extensions execute update-progress <start|checkpoint|stop> [options]

Commands:
  install                 Install OpenSpec extension skills into a target repo.
  dispatch issue          Render a single issue dispatch packet.
  dispatch issue-team     Render a subagent-team issue dispatch packet.
  execute update-progress Update issue progress and run artifacts.
`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "-h" || command === "--help") {
    process.stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  if (command === "install") {
    return runInstallCommand(rest);
  }

  if (command === "dispatch") {
    return runDispatchCommand(rest);
  }

  if (command === "execute" && rest[0] === "update-progress") {
    return runUpdateProgressCommand(rest.slice(1));
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
