import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import {
  incompleteTasks,
  nowIso,
  readJson,
  reviewArtifactIsCurrent,
  reviewArtifactPath,
  syncTasksForIssues,
  verifyArtifactPath,
  writeJson,
  type JsonRecord
} from "../domain/change-coordinator";
import { loadIssueModeConfig } from "../domain/issue-mode";

const VERIFY_HELP_TEXT = `Usage:
  openspec-extensions verify change --repo-root <path> --change <change> [--dry-run]
`;

type ParsedVerifyArgs = {
  change: string;
  dryRun: boolean;
  repoRoot: string;
};

type IssueProgressPayload = JsonRecord & {
  issue_id?: string;
  status?: string;
  updated_at?: string;
};

function parseChangeArgs(argv: string[]): ParsedVerifyArgs | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      change: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { short: "h", type: "boolean", default: false },
      "repo-root": { type: "string" }
    },
    strict: true
  });

  if (values.help) {
    process.stdout.write(VERIFY_HELP_TEXT);
    return null;
  }
  if (!values["repo-root"] || !values.change) {
    throw new Error("Missing required options: --repo-root, --change");
  }

  return {
    change: values.change,
    dryRun: values["dry-run"],
    repoRoot: path.resolve(values["repo-root"])
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

function runValidationCommand(command: string, repoRoot: string): JsonRecord {
  const process = spawnSync(command, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: true
  });
  const stderr = process.stderr ?? process.error?.message ?? "";
  return {
    command,
    status: process.status === 0 ? "passed" : "failed",
    exit_code: process.status ?? 1,
    stdout_tail: (process.stdout ?? "").split(/\r?\n/).filter(Boolean).slice(-20),
    stderr_tail: stderr.split(/\r?\n/).filter(Boolean).slice(-20)
  };
}

export function verifyChange(args: ParsedVerifyArgs): JsonRecord {
  const changeDir = path.join(args.repoRoot, "openspec", "changes", args.change);
  const issues = collectIssueProgress(changeDir);
  const incompleteIssueIds = [...new Set(
    issues
      .filter((issue) => String(issue.status ?? "").trim() !== "completed")
      .map((issue) => String(issue.issue_id ?? "").trim())
      .filter(Boolean)
  )].sort();
  const completedIssueIds = issues
    .filter((issue) => String(issue.status ?? "").trim() === "completed")
    .map((issue) => String(issue.issue_id ?? "").trim())
    .filter(Boolean);
  const tasksSync = syncTasksForIssues(args.repoRoot, args.change, completedIssueIds, args.dryRun);
  const tasksPath = path.join(changeDir, "tasks.md");
  const remainingTasks = incompleteTasks(tasksPath);
  const reviewPayload = readJson(reviewArtifactPath(args.repoRoot, args.change));
  const reviewCurrent = Object.keys(reviewPayload).length > 0 && reviewArtifactIsCurrent(args.repoRoot, issues, reviewPayload);
  const reviewStatus = String(reviewPayload.status ?? "").trim();
  const reviewPassed = reviewCurrent && reviewStatus === "passed";
  const config = loadIssueModeConfig(args.repoRoot);
  const validationCommands = [...config.validation_commands];

  let validationResults: JsonRecord[] = [];
  if (!args.dryRun && incompleteIssueIds.length === 0 && reviewPassed) {
    validationResults = validationCommands.map((command) => runValidationCommand(command, args.repoRoot));
  }

  const validationFailed = validationResults.some((item) => item.status !== "passed");
  const hasIncompleteTasks = remainingTasks.length > 0;

  let status = "passed";
  let summary = `Change ${args.change} passed coordinator verify.`;
  if (incompleteIssueIds.length > 0) {
    status = "failed";
    summary = `Change ${args.change} cannot verify: ${incompleteIssueIds.length} issue(s) not completed.`;
  } else if (Object.keys(reviewPayload).length === 0) {
    status = "failed";
    summary = `Change ${args.change} cannot verify: change-level /review has not been run.`;
  } else if (!reviewCurrent) {
    status = "failed";
    summary = `Change ${args.change} cannot verify: change-level /review is stale.`;
  } else if (reviewStatus !== "passed") {
    status = "failed";
    summary = `Change ${args.change} cannot verify: change-level /review did not pass.`;
  } else if (hasIncompleteTasks) {
    status = "failed";
    summary = `Change ${args.change} verify failed: tasks.md still has unchecked tasks.`;
  } else if (validationFailed) {
    status = "failed";
    summary = `Change ${args.change} verify failed: repository validation did not pass.`;
  } else if (args.dryRun) {
    summary = `Change ${args.change} verify dry-run completed.`;
  }

  const artifact: JsonRecord = {
    change: args.change,
    status,
    summary,
    updated_at: nowIso(),
    dry_run: args.dryRun,
    completed_issue_ids: completedIssueIds,
    incomplete_issue_ids: incompleteIssueIds,
    change_review: {
      path: path.relative(args.repoRoot, reviewArtifactPath(args.repoRoot, args.change)).split(path.sep).join("/"),
      current: reviewCurrent,
      status: reviewStatus,
      summary: String(reviewPayload.summary ?? "").trim()
    },
    review_scope:
      reviewPayload.review_scope && typeof reviewPayload.review_scope === "object" && !Array.isArray(reviewPayload.review_scope)
        ? reviewPayload.review_scope
        : {},
    tasks_sync: tasksSync,
    remaining_tasks: remainingTasks,
    validation: validationResults,
    validation_commands: validationCommands
  };

  if (!args.dryRun) {
    writeJson(verifyArtifactPath(args.repoRoot, args.change), artifact);
  }
  return artifact;
}

export function runVerifyCommand(argv: string[]): number {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === "-h" || subcommand === "--help") {
    process.stdout.write(VERIFY_HELP_TEXT);
    return 0;
  }
  if (subcommand !== "change") {
    throw new Error(`Unknown verify command: ${subcommand}`);
  }

  const parsed = parseChangeArgs(rest);
  if (!parsed) {
    return 0;
  }
  process.stdout.write(`${JSON.stringify(verifyChange(parsed), null, 2)}\n`);
  return 0;
}
