import fs from "node:fs";
import path from "node:path";

type UpdateProgressEvent = "start" | "checkpoint" | "stop";

interface ParsedArgs {
  event: UpdateProgressEvent;
  repoRoot: string;
  change: string;
  issueId: string;
  runId: string;
  status: string;
  boundaryStatus: string;
  nextAction: string;
  summary: string;
  blocker: string;
  validations: string[];
  changedFiles: string[];
}

function parseValidation(entries: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex === -1) {
      throw new Error(`Invalid validation entry: ${entry}`);
    }
    const key = entry.slice(0, separatorIndex);
    const value = entry.slice(separatorIndex + 1);
    result[key] = value;
  }
  return result;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function nowIso(): string {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteMinutes / 60);
  const remainingMinutes = absoluteMinutes % 60;

  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}${sign}${pad2(offsetHours)}:${pad2(remainingMinutes)}`;
}

function runStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}T${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
}

function defaultRunId(issueId: string): string {
  return `RUN-${runStamp()}-${issueId}`;
}

function issuePaths(repoRoot: string, change: string, issueId: string): { progressPath: string; runsDir: string } {
  const changeDir = path.join(repoRoot, "openspec", "changes", change);
  const issuesDir = path.join(changeDir, "issues");
  const runsDir = path.join(changeDir, "runs");
  fs.mkdirSync(issuesDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
  return {
    progressPath: path.join(issuesDir, `${issueId}.progress.json`),
    runsDir
  };
}

function latestRunId(runsDir: string, issueId: string): string | null {
  if (!fs.existsSync(runsDir)) {
    return null;
  }
  const suffix = `-${issueId}.json`;
  const matches = fs
    .readdirSync(runsDir)
    .filter((name) => name.startsWith("RUN-") && name.endsWith(suffix))
    .sort();
  if (matches.length === 0) {
    return null;
  }
  return matches[matches.length - 1].slice(0, -".json".length);
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(`JSON payload must be an object: ${filePath}`);
  }
  return payload as Record<string, unknown>;
}

function writeJson(filePath: string, payload: Record<string, unknown>): void {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function requiredValue(value: string | undefined, optionName: string): string {
  if (!value) {
    throw new Error(`Missing required option: ${optionName}`);
  }
  return value;
}

function parseArgs(argv: string[]): ParsedArgs {
  const event = argv[0];
  if (!event || (event !== "start" && event !== "checkpoint" && event !== "stop")) {
    throw new Error("Event must be one of: start, checkpoint, stop");
  }

  let repoRoot: string | undefined;
  let change: string | undefined;
  let issueId: string | undefined;
  let runId: string | undefined;
  let status: string | undefined;
  let boundaryStatus = "";
  let nextAction = "";
  let summary: string | undefined;
  let blocker = "";
  const validations: string[] = [];
  const changedFiles: string[] = [];

  let index = 1;
  while (index < argv.length) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    if (value === undefined) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--repo-root") {
      repoRoot = value;
    } else if (token === "--change") {
      change = value;
    } else if (token === "--issue-id") {
      issueId = value;
    } else if (token === "--run-id") {
      runId = value;
    } else if (token === "--status") {
      status = value;
    } else if (token === "--boundary-status") {
      boundaryStatus = value;
    } else if (token === "--next-action") {
      nextAction = value;
    } else if (token === "--summary") {
      summary = value;
    } else if (token === "--blocker") {
      blocker = value;
    } else if (token === "--validation") {
      validations.push(value);
    } else if (token === "--changed-file") {
      changedFiles.push(value);
    } else {
      throw new Error(`Unknown option: ${token}`);
    }

    index += 2;
  }

  return {
    event,
    repoRoot: requiredValue(repoRoot, "--repo-root"),
    change: requiredValue(change, "--change"),
    issueId: requiredValue(issueId, "--issue-id"),
    runId: runId ?? "",
    status: requiredValue(status, "--status"),
    boundaryStatus,
    nextAction,
    summary: requiredValue(summary, "--summary"),
    blocker,
    validations,
    changedFiles
  };
}

export function runUpdateProgressCommand(argv: string[]): number {
  const args = parseArgs(argv);
  const repoRoot = path.resolve(args.repoRoot);
  const { progressPath, runsDir } = issuePaths(repoRoot, args.change, args.issueId);
  const runId = args.runId || latestRunId(runsDir, args.issueId) || defaultRunId(args.issueId);
  const runPath = path.join(runsDir, `${runId}.json`);
  const validation = parseValidation(args.validations);
  const updatedAt = nowIso();

  const progress = readJsonObject(progressPath);
  Object.assign(progress, {
    change: args.change,
    issue_id: args.issueId,
    status: args.status,
    boundary_status: args.boundaryStatus,
    next_action: args.nextAction,
    summary: args.summary,
    blocker: args.blocker,
    validation,
    changed_files: args.changedFiles,
    run_id: runId,
    updated_at: updatedAt
  });
  writeJson(progressPath, progress);

  const run = readJsonObject(runPath);
  Object.assign(run, {
    run_id: runId,
    change: args.change,
    issue_id: args.issueId,
    latest_event: args.event,
    status: args.status,
    boundary_status: args.boundaryStatus,
    next_action: args.nextAction,
    summary: args.summary,
    blocker: args.blocker,
    validation,
    changed_files: args.changedFiles,
    updated_at: updatedAt
  });
  writeJson(runPath, run);

  const payload = {
    run_id: runId,
    progress_path: path.relative(repoRoot, progressPath),
    run_path: path.relative(repoRoot, runPath)
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return 0;
}
