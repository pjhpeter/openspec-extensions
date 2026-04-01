import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { parseArgs } from "node:util";

import { nowIso, readJson, reviewArtifactPath, writeJson, type JsonRecord } from "../domain/change-coordinator";

const DEFAULT_REVIEW_COMMAND = "codex review --uncommitted -";
const VERDICT_PATTERN = /^VERDICT:\s*(pass|fail)\s*$/i;

const REVIEW_HELP_TEXT = `Usage:
  openspec-extensions review change --repo-root <path> --change <change> [--dry-run] [--review-command <command>]
`;

type ParsedReviewArgs = {
  change: string;
  dryRun: boolean;
  repoRoot: string;
  reviewCommand: string;
};

type IssueProgressPayload = JsonRecord & {
  issue_id?: string;
  status?: string;
  updated_at?: string;
};

function parseChangeArgs(argv: string[]): ParsedReviewArgs | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      change: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { short: "h", type: "boolean", default: false },
      "repo-root": { type: "string" },
      "review-command": { type: "string", default: "" }
    },
    strict: true
  });

  if (values.help) {
    process.stdout.write(REVIEW_HELP_TEXT);
    return null;
  }
  if (!values["repo-root"] || !values.change) {
    throw new Error("Missing required options: --repo-root, --change");
  }

  return {
    change: values.change,
    dryRun: values["dry-run"],
    repoRoot: path.resolve(values["repo-root"]),
    reviewCommand: values["review-command"]
  };
}

function collectIssueProgress(changeDir: string): IssueProgressPayload[] {
  const issuesDir = path.join(changeDir, "issues");
  if (!fs.existsSync(issuesDir)) {
    return [];
  }

  const issueDocs = fs.readdirSync(issuesDir)
    .filter((name) => /^ISSUE-.*\.md$/.test(name))
    .filter((name) => !name.endsWith(".dispatch.md"))
    .sort();
  const payloads: IssueProgressPayload[] = [];

  for (const name of issueDocs) {
    const issueId = path.basename(name, ".md");
    const progressPath = path.join(issuesDir, `${issueId}.progress.json`);
    const payload: IssueProgressPayload = {
      issue_id: issueId,
      status: "pending",
      updated_at: ""
    };
    if (fs.existsSync(progressPath)) {
      payloads.push({ ...payload, ...readJson(progressPath) });
    } else {
      payloads.push(payload);
    }
  }

  const knownIssueIds = new Set(payloads.map((payload) => String(payload.issue_id ?? "")));
  for (const name of fs.readdirSync(issuesDir).filter((current) => current.endsWith(".progress.json")).sort()) {
    const issueId = name.replace(".progress.json", "");
    if (knownIssueIds.has(issueId)) {
      continue;
    }
    const payload = readJson(path.join(issuesDir, name)) as IssueProgressPayload;
    payload.issue_id = String(payload.issue_id ?? issueId);
    payloads.push(payload);
  }

  return payloads;
}

function buildReviewPrompt(change: string, completedIssueIds: string[]): string {
  const issueContext = completedIssueIds.length > 0 ? completedIssueIds.join(", ") : "none";
  return (
    `Review the current uncommitted code changes for OpenSpec change \`${change}\` before verify.\n` +
    `Completed issues in scope: ${issueContext}.\n` +
    "Focus on correctness, regressions, missing validation, and blockers that must be fixed before verify.\n" +
    "Respond in plain text.\n" +
    "The first line must be exactly one of:\n" +
    "VERDICT: pass\n" +
    "VERDICT: fail\n" +
    "If the verdict is fail, list only blocking findings that must be fixed before verify.\n"
  );
}

function parseVerdict(output: string): string {
  for (const rawLine of output.split(/\r?\n/)) {
    const match = rawLine.trim().match(VERDICT_PATTERN);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }
  return "unknown";
}

function tailLines(text: string, limit = 40): string[] {
  return text.split(/\r?\n/).filter(Boolean).slice(-limit);
}

function runReviewProcess(repoRoot: string, prompt: string, reviewCommand: string): SpawnSyncReturns<string> {
  if (reviewCommand !== DEFAULT_REVIEW_COMMAND) {
    return spawnSync(reviewCommand, {
      cwd: repoRoot,
      encoding: "utf8",
      input: prompt,
      shell: true
    });
  }

  return spawnSync("codex", ["review", "--uncommitted", "-"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: prompt
  });
}

export function reviewChange(args: ParsedReviewArgs): JsonRecord {
  const changeDir = path.join(args.repoRoot, "openspec", "changes", args.change);
  const issues = collectIssueProgress(changeDir);
  const completedIssueIds = issues
    .filter((issue) => String(issue.status ?? "").trim() === "completed")
    .map((issue) => String(issue.issue_id ?? "").trim())
    .filter(Boolean)
    .sort();
  const incompleteIssueIds = [...new Set(
    issues
      .filter((issue) => String(issue.status ?? "").trim() !== "completed")
      .map((issue) => String(issue.issue_id ?? "").trim())
      .filter(Boolean)
  )].sort();
  const reviewCommand = args.reviewCommand.trim() || DEFAULT_REVIEW_COMMAND;
  const reviewPrompt = buildReviewPrompt(args.change, completedIssueIds);

  const artifact: JsonRecord = {
    change: args.change,
    updated_at: nowIso(),
    dry_run: args.dryRun,
    completed_issue_ids: completedIssueIds,
    incomplete_issue_ids: incompleteIssueIds,
    review_prompt: reviewPrompt
  };

  if (incompleteIssueIds.length > 0) {
    artifact.status = "failed";
    artifact.summary = `Change ${args.change} cannot run change-level code review: ${incompleteIssueIds.length} issue(s) not completed.`;
    artifact.verdict = "fail";
    artifact.review_command = "";
    artifact.exit_code = null;
    artifact.stdout_tail = [];
    artifact.stderr_tail = [];
  } else if (args.dryRun) {
    artifact.status = "dry_run";
    artifact.summary = `Change ${args.change} code review dry-run completed.`;
    artifact.verdict = "unknown";
    artifact.review_command = reviewCommand;
    artifact.exit_code = null;
    artifact.stdout_tail = [];
    artifact.stderr_tail = [];
  } else {
    const process = runReviewProcess(args.repoRoot, reviewPrompt, reviewCommand);
    const stdout = process.stdout ?? "";
    const stderr = process.stderr ?? process.error?.message ?? "";
    const exitCode = process.status ?? (process.error ? 1 : 0);
    const verdict = parseVerdict(stdout);

    let status = "failed";
    let summary = `Change ${args.change} code review command failed.`;
    if (exitCode === 0 && verdict === "pass") {
      status = "passed";
      summary = `Change ${args.change} passed coordinator code review.`;
    } else if (exitCode === 0 && verdict === "fail") {
      summary = `Change ${args.change} code review found blocking issues.`;
    } else if (exitCode === 0) {
      summary = `Change ${args.change} code review completed but did not return a parseable verdict.`;
    }

    artifact.status = status;
    artifact.summary = summary;
    artifact.verdict = verdict;
    artifact.review_command = reviewCommand;
    artifact.exit_code = exitCode;
    artifact.stdout_tail = tailLines(stdout);
    artifact.stderr_tail = tailLines(stderr);
  }

  if (!args.dryRun) {
    writeJson(reviewArtifactPath(args.repoRoot, args.change), artifact);
  }
  return artifact;
}

export function runReviewCommand(argv: string[]): number {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === "-h" || subcommand === "--help") {
    process.stdout.write(REVIEW_HELP_TEXT);
    return 0;
  }
  if (subcommand !== "change") {
    throw new Error(`Unknown review command: ${subcommand}`);
  }

  const parsed = parseChangeArgs(rest);
  if (!parsed) {
    return 0;
  }
  process.stdout.write(`${JSON.stringify(reviewChange(parsed), null, 2)}\n`);
  return 0;
}
