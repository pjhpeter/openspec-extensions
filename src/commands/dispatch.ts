import { parseArgs } from "node:util";

import { runLifecycleDispatchRenderer } from "../renderers/lifecycle-dispatch";
import { renderIssueDispatch } from "../renderers/issue-dispatch";
import { runIssueTeamDispatchRenderer } from "../renderers/issue-team-dispatch";

const DISPATCH_HELP_TEXT = `Usage:
  openspec-extensions dispatch issue --repo-root <path> --change <change> --issue-id <issue> [--run-id <id>] [--dry-run]
  openspec-extensions dispatch issue-team --repo-root <path> --change <change> --issue-id <issue> [--target-mode <mode>] [--round-goal <goal>] [--dry-run]
  openspec-extensions dispatch lifecycle --repo-root <path> --change <change> [--phase <phase>] [--issue-id <issue>] [--dry-run]
`;

type IssueDispatchArgs = {
  change: string;
  dryRun: boolean;
  issueId: string;
  repoRoot: string;
  runId: string;
};

function parseIssueDispatchArgs(argv: string[]): IssueDispatchArgs | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      change: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { short: "h", type: "boolean", default: false },
      "issue-id": { type: "string" },
      "repo-root": { type: "string" },
      "run-id": { type: "string", default: "" }
    },
    strict: true
  });

  if (values.help) {
    process.stdout.write(DISPATCH_HELP_TEXT);
    return null;
  }

  if (!values["repo-root"] || !values.change || !values["issue-id"]) {
    throw new Error("Missing required options: --repo-root, --change, --issue-id");
  }

  return {
    change: values.change,
    dryRun: values["dry-run"],
    issueId: values["issue-id"],
    repoRoot: values["repo-root"],
    runId: values["run-id"]
  };
}

function runIssueDispatchCommand(argv: string[]): number {
  const parsed = parseIssueDispatchArgs(argv);
  if (!parsed) {
    return 0;
  }

  const payload = renderIssueDispatch({
    change: parsed.change,
    dryRun: parsed.dryRun,
    issueId: parsed.issueId,
    repoRoot: parsed.repoRoot,
    runId: parsed.runId
  });

  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return 0;
}

export function runDispatchCommand(argv: string[]): number {
  const [subcommand, ...rest] = argv;

  if (!subcommand || subcommand === "-h" || subcommand === "--help") {
    process.stdout.write(DISPATCH_HELP_TEXT);
    return 0;
  }

  if (subcommand === "issue") {
    return runIssueDispatchCommand(rest);
  }

  if (subcommand === "issue-team") {
    return runIssueTeamDispatchRenderer(rest);
  }

  if (subcommand === "lifecycle") {
    return runLifecycleDispatchRenderer(rest);
  }

  throw new Error(`Unknown dispatch command: ${subcommand}`);
}
