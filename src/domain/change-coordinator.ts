import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export const REVIEW_ARTIFACT_FILE_NAME = "CHANGE-REVIEW.json";
export const VERIFY_ARTIFACT_FILE_NAME = "CHANGE-VERIFY.json";

const TASK_ID_PATTERN = "\\d+(?:\\.\\d+)+";

export type JsonRecord = Record<string, unknown>;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function nowIso(): string {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteMinutes / 60);
  const remainingMinutes = absoluteMinutes % 60;

  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}${sign}${pad2(offsetHours)}:${pad2(remainingMinutes)}`;
}

export function parseIso8601(value: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value.replace("Z", "+00:00"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function readJson(filePath: string): JsonRecord {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonRecord;
}

export function writeJson(filePath: string, payload: JsonRecord): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function changeDirPath(repoRoot: string, change: string): string {
  return path.join(repoRoot, "openspec", "changes", change);
}

export function planningDocPaths(repoRoot: string, change: string): string[] {
  const changeDir = changeDirPath(repoRoot, change);
  const issuesDir = path.join(changeDir, "issues");
  const basePaths = [
    path.join(changeDir, "proposal.md"),
    path.join(changeDir, "design.md"),
    path.join(changeDir, "tasks.md"),
    path.join(issuesDir, "INDEX.md")
  ];

  const issueDocs = fs.existsSync(issuesDir)
    ? fs.readdirSync(issuesDir)
        .filter((name) => /^ISSUE-.*\.md$/.test(name))
        .filter((name) => !name.endsWith(".dispatch.md") && !name.endsWith(".team.dispatch.md"))
        .sort()
        .map((name) => path.join(issuesDir, name))
    : [];

  const result: string[] = [];
  for (const currentPath of [...basePaths, ...issueDocs]) {
    if (fs.existsSync(currentPath) && !result.includes(currentPath)) {
      result.push(currentPath);
    }
  }
  return result;
}

function runCommand(cmd: string[], cwd: string, check = true): SpawnSyncReturns<string> {
  const process = spawnSync(cmd[0] as string, cmd.slice(1), {
    cwd,
    encoding: "utf8"
  });
  if (check && process.status !== 0) {
    const message = process.stderr.trim() || process.stdout.trim() || "command failed";
    throw new Error(message);
  }
  return process;
}

export function extractStatusPaths(line: string): string[] {
  const payload = line.slice(3).trim();
  if (!payload) {
    return [];
  }
  if (payload.includes(" -> ")) {
    return payload
      .split(" -> ")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [payload];
}

export function planningDocStatus(repoRoot: string, change: string): JsonRecord {
  const paths = planningDocPaths(repoRoot, change);
  const repoRelativePaths = paths.map((currentPath) => path.relative(repoRoot, currentPath).split(path.sep).join("/"));

  const result: JsonRecord = {
    git_available: false,
    paths: repoRelativePaths,
    status_lines: [],
    dirty_paths: [],
    needs_commit: false,
    ready: false
  };

  if (repoRelativePaths.length === 0) {
    return result;
  }

  const insideWorktree = runCommand(["git", "rev-parse", "--is-inside-work-tree"], repoRoot, false);
  if (insideWorktree.status !== 0) {
    return result;
  }

  result.git_available = true;
  const statusProcess = runCommand(
    ["git", "status", "--short", "--untracked-files=all", "--", ...repoRelativePaths],
    repoRoot
  );
  const statusLines = statusProcess.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const dirtyPaths: string[] = [];

  for (const line of statusLines) {
    for (const currentPath of extractStatusPaths(line)) {
      if (!dirtyPaths.includes(currentPath)) {
        dirtyPaths.push(currentPath);
      }
    }
  }

  result.status_lines = statusLines;
  result.dirty_paths = dirtyPaths;
  result.needs_commit = statusLines.length > 0;
  result.ready = statusLines.length === 0;
  return result;
}

export function verifyArtifactPath(repoRoot: string, change: string): string {
  return path.join(changeDirPath(repoRoot, change), "runs", VERIFY_ARTIFACT_FILE_NAME);
}

export function reviewArtifactPath(repoRoot: string, change: string): string {
  return path.join(changeDirPath(repoRoot, change), "runs", REVIEW_ARTIFACT_FILE_NAME);
}

export function issueTaskMapping(changeDir: string): Record<string, string[]> {
  const indexPath = path.join(changeDir, "issues", "INDEX.md");
  if (!fs.existsSync(indexPath)) {
    return {};
  }

  const mapping: Record<string, string[]> = {};
  for (const line of fs.readFileSync(indexPath, "utf8").split(/\r?\n/)) {
    const tokens = [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]?.trim() ?? "");
    if (tokens.length < 2) {
      continue;
    }

    const issueId = tokens[0] as string;
    if (!issueId.startsWith("ISSUE-")) {
      continue;
    }

    const taskIds: string[] = [];
    for (const token of tokens.slice(1)) {
      if (new RegExp(`^${TASK_ID_PATTERN}$`).test(token) && !taskIds.includes(token)) {
        taskIds.push(token);
      }
    }
    if (taskIds.length > 0) {
      mapping[issueId] = taskIds;
    }
  }

  return mapping;
}

export function syncTasksForIssues(
  repoRoot: string,
  change: string,
  issueIds: string[],
  dryRun = false
): JsonRecord {
  const changeDir = changeDirPath(repoRoot, change);
  const tasksPath = path.join(changeDir, "tasks.md");
  const result: JsonRecord = {
    tasks_path: path.relative(repoRoot, tasksPath).split(path.sep).join("/"),
    index_path: path.join("openspec", "changes", change, "issues", "INDEX.md"),
    mapped_issue_ids: [],
    unmapped_issue_ids: [],
    mapped_task_ids: [],
    updated_task_ids: [],
    already_completed_task_ids: [],
    missing_task_ids: [],
    changed: false
  };

  if (!fs.existsSync(tasksPath)) {
    result.reason = "tasks_missing";
    return result;
  }

  const mapping = issueTaskMapping(changeDir);
  const taskIds: string[] = [];
  for (const issueId of issueIds) {
    const mapped = mapping[issueId] ?? [];
    if (mapped.length === 0) {
      (result.unmapped_issue_ids as string[]).push(issueId);
      continue;
    }
    (result.mapped_issue_ids as string[]).push(issueId);
    for (const taskId of mapped) {
      if (!taskIds.includes(taskId)) {
        taskIds.push(taskId);
      }
    }
  }
  result.mapped_task_ids = taskIds;
  if (taskIds.length === 0) {
    return result;
  }

  const lines = fs.readFileSync(tasksPath, "utf8").split(/\r?\n/);
  const foundTaskIds = new Set<string>();

  for (const taskId of taskIds) {
    const pattern = new RegExp(`^(\\s*-\\s*\\[)( |x)(\\]\\s+${taskId.replace(".", "\\.")}\\b.*)$`);
    let matched = false;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      const match = line.match(pattern);
      if (!match) {
        continue;
      }

      matched = true;
      foundTaskIds.add(taskId);
      if (match[2] === "x") {
        (result.already_completed_task_ids as string[]).push(taskId);
      } else {
        lines[index] = `${match[1]}x${match[3]}`;
        (result.updated_task_ids as string[]).push(taskId);
        result.changed = true;
      }
      break;
    }

    if (!matched) {
      (result.missing_task_ids as string[]).push(taskId);
    }
  }

  if (result.changed && !dryRun) {
    fs.writeFileSync(tasksPath, `${lines.join("\n")}\n`);
  }

  return result;
}

export function incompleteTasks(tasksPath: string): Array<{ line: string; task_id: string }> {
  if (!fs.existsSync(tasksPath)) {
    return [];
  }

  const pattern = new RegExp(`^\\s*-\\s*\\[ \\]\\s+(${TASK_ID_PATTERN})\\b(.*)$`);
  const result: Array<{ line: string; task_id: string }> = [];
  for (const line of fs.readFileSync(tasksPath, "utf8").split(/\r?\n/)) {
    const match = line.match(pattern);
    if (!match) {
      continue;
    }
    result.push({
      line: line.trim(),
      task_id: (match[1] as string).trim()
    });
  }
  return result;
}

export function latestIssueUpdatedAt(issues: JsonRecord[]): Date | null {
  let latest: Date | null = null;
  for (const issue of issues) {
    const updatedAt = parseIso8601(String(issue.updated_at ?? ""));
    if (!updatedAt) {
      continue;
    }
    if (!latest || updatedAt > latest) {
      latest = updatedAt;
    }
  }
  return latest;
}

export function artifactIsCurrent(issues: JsonRecord[], artifact: JsonRecord): boolean {
  const verifiedAt = parseIso8601(String(artifact.updated_at ?? ""));
  if (!verifiedAt) {
    return false;
  }
  const latestIssueAt = latestIssueUpdatedAt(issues);
  if (!latestIssueAt) {
    return true;
  }
  return verifiedAt >= latestIssueAt;
}

export function reviewArtifactIsCurrent(issues: JsonRecord[], artifact: JsonRecord): boolean {
  return artifactIsCurrent(issues, artifact);
}

export function verificationArtifactIsCurrent(issues: JsonRecord[], artifact: JsonRecord): boolean {
  return artifactIsCurrent(issues, artifact);
}
