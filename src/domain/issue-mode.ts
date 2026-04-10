import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { deepMerge, type JsonObject } from "../utils/deep-merge";
import {
  extractMarkdownSections,
  normalizeMarkdownLabel,
  type SectionAliasMap,
} from "../utils/markdown";
import { displayPath, ensurePathWithin, resolveRepoPath } from "../utils/path";

const CONFIG_RELATIVE_PATH = "openspec/issue-mode.json";
const CONTROL_DIR_NAME = "control";
const ROUTE_DECISION_FILE_NAME = "ROUTE-DECISION.json";
const ROUND_FILE_PREFIX = "ROUND-";
const ROUND_FILE_SUFFIX = ".md";
const ISSUE_ID_PATTERN = /\bISSUE-\d+\b/gi;
const CHECKBOX_ITEM_RE = /^\s*(?:[-*+]|\d+\.)\s+\[(?<state>[ xX])\]\s+(?<text>.+?)\s*$/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+\.)\s+(?<text>.+?)\s*$/;
const PLACEHOLDER_WORK_ITEM_RE = /[\s`*_~\-.。\u3002,\uFF0C;\uFF1B:\uFF1A!?\uFF01\uFF1F(){}<>/\\]+/g;

const BACKLOG_SECTION_ALIASES: Record<string, string[]> = {
  must_fix_now: [
    "must fix now",
    "must-fix-now",
    "mustfixnow",
    "must fix",
    "\u5FC5\u987B\u7ACB\u5373\u4FEE\u590D",
    "\u5FC5\u987B\u4FEE\u590D",
    "\u7ACB\u5373\u4FEE\u590D",
  ],
  should_fix_if_cheap: [
    "should fix if cheap",
    "should-fix-if-cheap",
    "shouldfixifcheap",
    "\u5E94\u8BE5\u4FEE\u590D",
    "\u4F4E\u6210\u672C\u4FEE\u590D",
  ],
  defer: ["defer", "deferred", "\u5EF6\u540E", "\u5EF6\u671F", "\u6682\u7F13"],
};

const ROUND_SECTION_ALIASES: Record<string, string[]> = {
  round_target: ["round target", "\u76EE\u6807", "\u672C\u8F6E\u76EE\u6807", "\u8F6E\u6B21\u76EE\u6807"],
  target_mode: ["target mode", "\u76EE\u6807\u6A21\u5F0F", "\u6A21\u5F0F"],
  acceptance_criteria: ["acceptance criteria", "\u9A8C\u6536\u6807\u51C6", "\u9A8C\u6536\u6761\u4EF6"],
  non_goals: ["non-goals", "non goals", "\u975E\u76EE\u6807"],
  scope_in_round: ["scope in round", "round scope", "scope", "\u672C\u8F6E\u8303\u56F4", "\u8303\u56F4"],
  normalized_backlog: ["normalized backlog", "backlog", "\u89C4\u8303\u5316 backlog", "\u5F85\u529E"],
  fixes_completed: [
    "fixes or revisions completed",
    "fixes completed",
    "\u4FEE\u590D\u5B8C\u6210",
    "\u4FEE\u8BA2\u5B8C\u6210",
  ],
  re_review_result: [
    "re-review result",
    "re review result",
    "review result",
    "\u590D\u5BA1\u7ED3\u679C",
    "\u590D\u6838\u7ED3\u679C",
  ],
  acceptance_verdict: [
    "acceptance verdict",
    "verdict",
    "\u9A8C\u6536\u7ED3\u8BBA",
    "\u9A8C\u6536\u7ED3\u679C",
    "\u7ED3\u8BBA",
  ],
  next_action: ["next action", "next step", "\u4E0B\u4E00\u6B65", "\u540E\u7EED\u52A8\u4F5C", "\u540E\u7EED\u6B65\u9AA4"],
};

const ROUND_ACCEPT_KEYWORDS = [
  "accepted",
  "approve",
  "approved",
  "pass",
  "passed",
  "through",
  "\u901A\u8FC7",
  "\u5DF2\u901A\u8FC7",
  "\u63A5\u53D7",
  "\u5DF2\u63A5\u53D7",
  "\u5DF2\u9A8C\u6536",
  "\u53EF\u7EE7\u7EED",
];
const ROUND_REJECT_KEYWORDS = [
  "reject",
  "rejected",
  "fail",
  "failed",
  "blocked",
  "repair",
  "revise",
  "rework",
  "\u4E0D\u901A\u8FC7",
  "\u9A73\u56DE",
  "\u963B\u585E",
  "\u8FD4\u5DE5",
  "\u4FEE\u590D",
];
const VERIFY_ACTION_KEYWORDS = [
  "verify",
  "archive",
  "closeout",
  "ready for verify",
  "run verify",
  "\u5F52\u6863",
  "\u9A8C\u6536",
  "\u9A8C\u8BC1",
  "\u6536\u5C3E",
  "\u5173\u95ED",
];

const EMPTY_WORK_ITEM_SENTINELS = new Set([
  "none",
  "n/a",
  "na",
  "empty",
  "nothing",
  "noopenitems",
  "noopenitem",
  "noblocker",
  "noblockers",
  "\u65E0",
  "\u6682\u65E0",
  "\u6CA1\u6709",
  "\u65E0\u5F85\u529E",
  "\u65E0\u5F85\u5904\u7406\u9879",
  "\u65E0\u963B\u585E",
  "\u65E0\u963B\u585E\u9879",
]);

const SUBAGENT_TEAM_AUTOMATION_FIELDS = [
  "auto_accept_spec_readiness",
  "auto_accept_issue_planning",
  "auto_accept_issue_review",
  "auto_accept_change_acceptance",
  "auto_archive_after_verify",
] as const;

const WORKTREE_SCOPE_VALUES = new Set(["shared", "change", "issue"]);

export interface IssueModeConfig {
  worktree_root: string;
  validation_commands: string[];
  worker_worktree: {
    enabled: boolean;
    scope: "shared" | "change" | "issue";
    mode: "detach" | "branch";
    base_ref: string;
    branch_prefix: string;
  };
  rra: {
    gate_mode: "advisory" | "enforce";
  };
  subagent_team: Record<(typeof SUBAGENT_TEAM_AUTOMATION_FIELDS)[number], boolean>;
  config_path: string;
  config_exists: boolean;
}

export type IssueWorktreeSource = "issue_doc" | "config_default";

export interface IssueDispatchGate {
  action: string;
  active: boolean;
  allowed: boolean;
  blocking: boolean;
  enforced: boolean;
  issue_id: string;
  mode: string;
  reason: string;
  status: string;
}

export interface IssueDispatchStateSnapshot {
  boundary_status: string;
  issue_id: string;
  next_action: string;
  status: string;
}

export interface RoundDispatchWindow {
  approved_pending_issue_ids: string[];
  dispatch_gate_active: boolean;
  next_pending_issue_id: string;
  referenced_issue_ids: string[];
  stale_completed_round: boolean;
}

export const DEFAULT_CONFIG: Omit<IssueModeConfig, "config_path" | "config_exists"> = {
  worktree_root: ".worktree",
  validation_commands: ["pnpm lint", "pnpm type-check"],
  worker_worktree: {
    enabled: false,
    scope: "shared",
    mode: "detach",
    base_ref: "HEAD",
    branch_prefix: "opsx",
  },
  rra: {
    gate_mode: "advisory",
  },
  subagent_team: {
    auto_accept_spec_readiness: false,
    auto_accept_issue_planning: false,
    auto_accept_issue_review: true,
    auto_accept_change_acceptance: false,
    auto_archive_after_verify: false,
  },
};

const NORMALIZED_BACKLOG_SECTION_ALIASES = buildNormalizedAliasMap(BACKLOG_SECTION_ALIASES);
const NORMALIZED_ROUND_SECTION_ALIASES = buildNormalizedAliasMap(ROUND_SECTION_ALIASES);

function buildNormalizedAliasMap(map: Record<string, string[]>): SectionAliasMap {
  const result: SectionAliasMap = {};
  for (const [key, aliases] of Object.entries(map)) {
    result[key] = new Set(aliases.map((alias) => normalizeMarkdownLabel(alias)));
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const items: string[] = [];
  for (const value of values) {
    const text = String(value).trim();
    if (text && !items.includes(text)) {
      items.push(text);
    }
  }
  return items;
}

function normalizeBool(value: unknown, defaultValue: boolean): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeSubagentTeamFlags(raw: unknown): IssueModeConfig["subagent_team"] {
  const values = isRecord(raw) ? raw : {};
  const defaults = DEFAULT_CONFIG.subagent_team;
  return {
    auto_accept_spec_readiness: normalizeBool(
      values.auto_accept_spec_readiness,
      defaults.auto_accept_spec_readiness
    ),
    auto_accept_issue_planning: normalizeBool(values.auto_accept_issue_planning, defaults.auto_accept_issue_planning),
    auto_accept_issue_review: normalizeBool(values.auto_accept_issue_review, defaults.auto_accept_issue_review),
    auto_accept_change_acceptance: normalizeBool(
      values.auto_accept_change_acceptance,
      defaults.auto_accept_change_acceptance
    ),
    auto_archive_after_verify: normalizeBool(values.auto_archive_after_verify, defaults.auto_archive_after_verify),
  };
}

function issueIdFromIssueDocName(name: string): string {
  return name.replace(/\.md$/u, "");
}

function issueIdFromProgressName(name: string): string {
  return name.replace(/\.progress\.json$/u, "");
}

function issueIsPending(issue: Pick<IssueDispatchStateSnapshot, "status">): boolean {
  return issue.status === "pending" || issue.status === "";
}

function issueHasSettledRound(issue: IssueDispatchStateSnapshot): boolean {
  return issue.status === "completed" && issue.boundary_status !== "review_required" && issue.next_action !== "coordinator_review";
}

export function collectIssueDispatchStateSnapshots(repoRoot: string, change: string): IssueDispatchStateSnapshot[] {
  const issuesDir = path.join(repoRoot, "openspec", "changes", change, "issues");
  if (!fs.existsSync(issuesDir)) {
    return [];
  }

  const progressByIssue = new Map<string, string>();
  for (const name of fs.readdirSync(issuesDir).filter((current) => current.endsWith(".progress.json")).sort()) {
    progressByIssue.set(issueIdFromProgressName(name), path.join(issuesDir, name));
  }

  const snapshots: IssueDispatchStateSnapshot[] = [];
  const seenIds = new Set<string>();
  for (const name of fs.readdirSync(issuesDir).filter((current) => /^ISSUE-.*\.md$/u.test(current)).sort()) {
    if (name.endsWith(".dispatch.md") || name.endsWith(".team.dispatch.md")) {
      continue;
    }
    const issueId = issueIdFromIssueDocName(name);
    const progressPath = progressByIssue.get(issueId);
    const progress = progressPath && fs.existsSync(progressPath) ? (JSON.parse(fs.readFileSync(progressPath, "utf8")) as Record<string, unknown>) : {};
    snapshots.push({
      issue_id: issueId,
      status: normalizeOptionalString(progress.status) || "pending",
      boundary_status: normalizeOptionalString(progress.boundary_status),
      next_action: normalizeOptionalString(progress.next_action),
    });
    seenIds.add(issueId);
  }

  for (const [issueId, progressPath] of progressByIssue.entries()) {
    if (seenIds.has(issueId) || !fs.existsSync(progressPath)) {
      continue;
    }
    const progress = JSON.parse(fs.readFileSync(progressPath, "utf8")) as Record<string, unknown>;
    snapshots.push({
      issue_id: normalizeOptionalString(progress.issue_id) || issueId,
      status: normalizeOptionalString(progress.status) || "pending",
      boundary_status: normalizeOptionalString(progress.boundary_status),
      next_action: normalizeOptionalString(progress.next_action),
    });
  }

  return snapshots;
}

export function resolveRoundDispatchWindow(
  controlState: Record<string, unknown>,
  issues: IssueDispatchStateSnapshot[]
): RoundDispatchWindow {
  const latestRound = isRecord(controlState.latest_round) ? controlState.latest_round : {};
  const referencedIssueIds = normalizeStringList(latestRound.referenced_issue_ids);
  const pendingIssues = issues.filter(issueIsPending);
  const approvedPendingIssueIds = pendingIssues
    .map((issue) => issue.issue_id)
    .filter((issueId) => referencedIssueIds.includes(issueId));
  const issueById = new Map(issues.map((issue) => [issue.issue_id, issue] as const));
  const referencedKnownIssues = referencedIssueIds
    .map((issueId) => issueById.get(issueId))
    .filter((issue): issue is IssueDispatchStateSnapshot => Boolean(issue));

  return {
    approved_pending_issue_ids: approvedPendingIssueIds,
    dispatch_gate_active: latestRound.dispatch_gate_active === true && referencedIssueIds.length > 0,
    next_pending_issue_id: pendingIssues[0]?.issue_id ?? "",
    referenced_issue_ids: referencedIssueIds,
    // 旧 round 只覆盖已收敛 issue 时，允许 coordinator 续派下一个 pending issue。
    stale_completed_round:
      pendingIssues.length > 0 &&
      approvedPendingIssueIds.length === 0 &&
      referencedKnownIssues.length > 0 &&
      referencedKnownIssues.every(issueHasSettledRound),
  };
}

function normalizeWorkerWorktreeEnabled(payload: Record<string, unknown>): boolean {
  const workerWorktree = isRecord(payload.worker_worktree) ? payload.worker_worktree : null;
  if (workerWorktree && Object.hasOwn(workerWorktree, "enabled")) {
    return normalizeBool(workerWorktree.enabled, DEFAULT_CONFIG.worker_worktree.enabled);
  }

  const legacyConfigPresent = Boolean(
    workerWorktree &&
      (Object.hasOwn(workerWorktree, "mode") ||
        Object.hasOwn(workerWorktree, "base_ref") ||
        Object.hasOwn(workerWorktree, "branch_prefix"))
  );

  if (legacyConfigPresent || Object.hasOwn(payload, "worktree_root")) {
    return true;
  }

  return DEFAULT_CONFIG.worker_worktree.enabled;
}

function normalizeWorkerWorktreeScope(payload: Record<string, unknown>, enabled: boolean): "shared" | "change" | "issue" {
  const workerWorktree = isRecord(payload.worker_worktree) ? payload.worker_worktree : null;
  if (!workerWorktree) {
    return enabled ? "issue" : DEFAULT_CONFIG.worker_worktree.scope;
  }

  const explicitScope = String(workerWorktree.scope ?? "").trim();
  let scope = "";
  if (explicitScope) {
    scope = explicitScope;
  } else if (Object.hasOwn(workerWorktree, "enabled")) {
    scope = enabled ? "issue" : "shared";
  } else {
    const legacyConfigPresent =
      Object.hasOwn(workerWorktree, "mode") ||
      Object.hasOwn(workerWorktree, "base_ref") ||
      Object.hasOwn(workerWorktree, "branch_prefix");
    scope = legacyConfigPresent || Object.hasOwn(payload, "worktree_root") ? "issue" : DEFAULT_CONFIG.worker_worktree.scope;
  }

  if (!WORKTREE_SCOPE_VALUES.has(scope)) {
    throw new Error(`${CONFIG_RELATIVE_PATH} field \`worker_worktree.scope\` must be \`shared\`, \`change\`, or \`issue\`.`);
  }
  return scope as "shared" | "change" | "issue";
}

function collapseSectionLines(lines: string[]): string {
  const parts = lines.map((line) => line.trim()).filter(Boolean);
  return parts.join(" ").trim();
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

function textContainsKeyword(text: string, keywords: string[]): boolean {
  const haystack = text.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function roundAcceptanceStatus(text: string): "missing" | "rejected" | "accepted" | "unknown" {
  if (!text.trim()) {
    return "missing";
  }
  if (textContainsKeyword(text, ROUND_REJECT_KEYWORDS)) {
    return "rejected";
  }
  if (textContainsKeyword(text, ROUND_ACCEPT_KEYWORDS)) {
    return "accepted";
  }
  return "unknown";
}

function roundAllowsVerify(acceptanceText: string, nextActionText: string): boolean {
  if (roundAcceptanceStatus(acceptanceText) !== "accepted") {
    return false;
  }
  return textContainsKeyword(nextActionText || acceptanceText, VERIFY_ACTION_KEYWORDS);
}

function extractSectionItems(lines: string[]): string[] {
  const items: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("<!--")) {
      continue;
    }
    const checkboxMatch = line.match(CHECKBOX_ITEM_RE);
    if (checkboxMatch?.groups?.text) {
      items.push(checkboxMatch.groups.text.trim());
      continue;
    }
    const listMatch = line.match(LIST_ITEM_RE);
    if (listMatch?.groups?.text) {
      items.push(listMatch.groups.text.trim());
      continue;
    }
    items.push(line);
  }
  return dedupeStrings(items);
}

function isPlaceholderWorkItem(text: string): boolean {
  const normalized = text.replace(PLACEHOLDER_WORK_ITEM_RE, "").toLowerCase();
  return EMPTY_WORK_ITEM_SENTINELS.has(normalized);
}

export function extractOpenWorkItems(lines: string[]): string[] {
  const items: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("<!--")) {
      continue;
    }
    const checkboxMatch = line.match(CHECKBOX_ITEM_RE);
    if (checkboxMatch?.groups?.text && checkboxMatch?.groups?.state) {
      if (checkboxMatch.groups.state.trim().toLowerCase() === "x") {
        continue;
      }
      const text = checkboxMatch.groups.text.trim();
      if (!isPlaceholderWorkItem(text)) {
        items.push(text);
      }
      continue;
    }
    const listMatch = line.match(LIST_ITEM_RE);
    if (listMatch?.groups?.text) {
      const text = listMatch.groups.text.trim();
      if (!isPlaceholderWorkItem(text)) {
        items.push(text);
      }
    }
  }
  return dedupeStrings(items);
}

function expandUser(rawPath: string): string {
  if (rawPath === "~") {
    return os.homedir();
  }
  if (rawPath.startsWith("~/")) {
    return path.join(os.homedir(), rawPath.slice(2));
  }
  return rawPath;
}

export function parseFrontmatter(text: string): Record<string, unknown> {
  const lines = text.split(/\r?\n/);
  if (lines.length < 3 || lines[0]?.trim() !== "---") {
    return {};
  }

  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const line of lines.slice(1)) {
    const stripped = line.replace(/\s+$/g, "");
    if (stripped === "---") {
      if (currentKey !== null && currentList !== null) {
        result[currentKey] = currentList;
      }
      return result;
    }

    if (stripped.startsWith("  - ") || stripped.startsWith("- ")) {
      if (currentKey === null) {
        continue;
      }
      if (currentList === null) {
        currentList = [];
      }
      currentList.push(stripped.split("- ", 2)[1]?.trim() ?? "");
      continue;
    }

    if (!stripped.includes(":")) {
      continue;
    }

    if (currentKey !== null && currentList !== null) {
      result[currentKey] = currentList;
    }

    const delimiter = stripped.indexOf(":");
    const key = stripped.slice(0, delimiter).trim();
    const value = stripped.slice(delimiter + 1).trim();
    currentKey = key;
    if (value) {
      result[currentKey] = value;
      currentList = null;
    } else {
      currentList = [];
    }
  }

  return {};
}

function readIssueFrontmatter(repoRoot: string, change: string, issueId: string): Record<string, unknown> {
  const issuePath = path.join(repoRoot, "openspec", "changes", change, "issues", `${issueId}.md`);
  if (!fs.existsSync(issuePath)) {
    return {};
  }
  return parseFrontmatter(fs.readFileSync(issuePath, "utf8"));
}

function defaultWorkerWorktreeSetting(config: IssueModeConfig, change: string, issueId: string): string {
  const scope = String(config.worker_worktree.scope ?? "shared").trim() || "shared";
  if (!config.worker_worktree.enabled || scope === "shared") {
    return ".";
  }
  if (scope === "change") {
    return path.posix.join(config.worktree_root.replace(/\\/g, "/"), change);
  }
  return path.posix.join(config.worktree_root.replace(/\\/g, "/"), change, issueId);
}

function validateIssueWorkerWorktree(repoRoot: string, rawPath: string, config: IssueModeConfig): string {
  const candidate = rawPath.trim();
  if (!candidate) {
    throw new Error("Issue frontmatter `worker_worktree` must not be empty.");
  }

  const expandedPath = expandUser(candidate);
  if (path.isAbsolute(expandedPath)) {
    throw new Error("Issue frontmatter `worker_worktree` must be repo-relative, not absolute.");
  }

  const resolvedPath = path.resolve(repoRoot, expandedPath);
  ensurePathWithin(repoRoot, resolvedPath);
  if (path.resolve(resolvedPath) === path.resolve(repoRoot)) {
    return ".";
  }

  const worktreeRoot = resolveRepoPath(repoRoot, config.worktree_root);
  ensurePathWithin(worktreeRoot, resolvedPath);
  return candidate;
}

export function issueWorkerWorktreeSetting(
  repoRoot: string,
  change: string,
  issueId: string,
  config: IssueModeConfig
): [string, IssueWorktreeSource] {
  const frontmatter = readIssueFrontmatter(repoRoot, change, issueId);
  const workerWorktree = frontmatter.worker_worktree;
  if (typeof workerWorktree === "string" && workerWorktree.trim()) {
    return [validateIssueWorkerWorktree(repoRoot, workerWorktree, config), "issue_doc"];
  }
  return [defaultWorkerWorktreeSetting(config, change, issueId), "config_default"];
}

export function issueWorkerWorktreePath(
  repoRoot: string,
  change: string,
  issueId: string,
  config: IssueModeConfig
): [string, string, IssueWorktreeSource] {
  const [rawPath, source] = issueWorkerWorktreeSetting(repoRoot, change, issueId, config);
  const resolvedPath = resolveRepoPath(repoRoot, rawPath);
  return [resolvedPath, displayPath(repoRoot, resolvedPath), source];
}

export function isSharedWorkerWorkspace(repoRoot: string, targetPath: string): boolean {
  return path.resolve(targetPath) === path.resolve(repoRoot);
}

export function inferWorkerWorktreeScope(
  repoRoot: string,
  worktreePath: string,
  config: IssueModeConfig,
  change: string,
  issueId: string
): "shared" | "change" | "issue" {
  if (isSharedWorkerWorkspace(repoRoot, worktreePath)) {
    return "shared";
  }

  const worktreeRoot = resolveRepoPath(repoRoot, config.worktree_root);
  const relative = path.relative(path.resolve(worktreeRoot), path.resolve(worktreePath));
  if (!relative || relative === "." || relative.startsWith("..") || path.isAbsolute(relative)) {
    return "issue";
  }

  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length === 1 && parts[0] === change) {
    return "change";
  }
  if (parts.length === 2 && parts[0] === change && parts[1] === issueId) {
    return "issue";
  }
  return "issue";
}

function slugifyBranchFragment(value: string): string {
  const slug = value.replace(/[^A-Za-z0-9._/-]+/g, "-").replace(/^[./-]+|[./-]+$/g, "").replace(/\/{2,}/g, "/");
  return slug || "worker";
}

export function workerBranchName(
  config: IssueModeConfig,
  change: string,
  issueId: string,
  scope?: "shared" | "change" | "issue"
): string {
  const prefix = slugifyBranchFragment(config.worker_worktree.branch_prefix).replace(/^\/+|\/+$/g, "");
  const changeSlug = slugifyBranchFragment(change).replaceAll("/", "-");
  const scopeValue = scope ?? config.worker_worktree.scope;
  const issueSlug = slugifyBranchFragment(issueId).replaceAll("/", "-");

  if (prefix) {
    if (scopeValue === "change") {
      return `${prefix}/${changeSlug}`;
    }
    return `${prefix}/${changeSlug}/${issueSlug}`;
  }
  if (scopeValue === "change") {
    return changeSlug;
  }
  return `${changeSlug}/${issueSlug}`;
}

function backlogArtifactPath(repoRoot: string, change: string): string {
  return path.join(repoRoot, "openspec", "changes", change, CONTROL_DIR_NAME, "BACKLOG.md");
}

function routeDecisionArtifactPath(repoRoot: string, change: string): string {
  return path.join(repoRoot, "openspec", "changes", change, CONTROL_DIR_NAME, ROUTE_DECISION_FILE_NAME);
}

function latestRoundArtifactPath(repoRoot: string, change: string): string | null {
  const controlDir = path.join(repoRoot, "openspec", "changes", change, CONTROL_DIR_NAME);
  if (!fs.existsSync(controlDir)) {
    return null;
  }
  const matches = fs
    .readdirSync(controlDir)
    .filter((name) => name.startsWith(ROUND_FILE_PREFIX) && name.endsWith(ROUND_FILE_SUFFIX))
    .sort();
  if (matches.length === 0) {
    return null;
  }
  return path.join(controlDir, matches[matches.length - 1] as string);
}

function extractIssueIdsFromText(text: string): string[] {
  const matches = [...text.matchAll(ISSUE_ID_PATTERN)].map((match) => match[0].toUpperCase());
  return dedupeStrings(matches);
}

function readRouteDecisionState(repoRoot: string, change: string): Record<string, unknown> {
  const artifactPath = routeDecisionArtifactPath(repoRoot, change);
  if (!fs.existsSync(artifactPath)) {
    return {
      exists: false,
      path: "",
      valid: false,
      route: "",
      score: null,
      summary: "",
      rationale: [],
      recommended_flow: "",
      updated_at: "",
      error: "",
    };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as unknown;
    if (!isRecord(payload)) {
      throw new Error("route decision artifact must be a JSON object");
    }

    const rationale = normalizeStringList(payload.rationale ?? payload.evidence);

    return {
      exists: true,
      path: displayPath(repoRoot, artifactPath),
      valid: true,
      route: normalizeOptionalString(payload.route),
      score: normalizeOptionalNumber(payload.score),
      summary: normalizeOptionalString(payload.summary),
      rationale,
      recommended_flow: normalizeOptionalString(payload.recommended_flow ?? payload.recommended_entry),
      updated_at: normalizeOptionalString(payload.updated_at),
      error: "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 路由记录主要服务人工查看，不应因格式错误卡死整个 reconcile。
    return {
      exists: true,
      path: displayPath(repoRoot, artifactPath),
      valid: false,
      route: "",
      score: null,
      summary: "",
      rationale: [],
      recommended_flow: "",
      updated_at: "",
      error: message,
    };
  }
}

export function readChangeControlState(repoRoot: string, change: string): Record<string, unknown> {
  const backlogPath = backlogArtifactPath(repoRoot, change);
  const routeDecision = readRouteDecisionState(repoRoot, change);
  const latestRoundPath = latestRoundArtifactPath(repoRoot, change);

  const backlogSections = extractMarkdownSections(
    fs.existsSync(backlogPath) ? fs.readFileSync(backlogPath, "utf8") : "",
    NORMALIZED_BACKLOG_SECTION_ALIASES
  );
  const mustFixNowItems = extractOpenWorkItems(backlogSections.must_fix_now ?? []);
  const shouldFixIfCheapItems = extractOpenWorkItems(backlogSections.should_fix_if_cheap ?? []);
  const deferItems = extractOpenWorkItems(backlogSections.defer ?? []);

  const roundSections = extractMarkdownSections(
    latestRoundPath ? fs.readFileSync(latestRoundPath, "utf8") : "",
    NORMALIZED_ROUND_SECTION_ALIASES
  );
  const roundTargetItems = extractSectionItems(roundSections.round_target ?? []);
  const targetModeItems = extractSectionItems(roundSections.target_mode ?? []);
  const acceptanceCriteriaItems = extractSectionItems(roundSections.acceptance_criteria ?? []);
  const nonGoalItems = extractSectionItems(roundSections.non_goals ?? []);
  const scopeInRoundItems = extractSectionItems(roundSections.scope_in_round ?? []);
  const normalizedBacklogItems = extractSectionItems(roundSections.normalized_backlog ?? []);
  const fixesCompletedItems = extractSectionItems(roundSections.fixes_completed ?? []);
  const reReviewItems = extractSectionItems(roundSections.re_review_result ?? []);
  const acceptanceLines = roundSections.acceptance_verdict ?? roundSections.re_review_result ?? [];
  const acceptanceText = collapseSectionLines(acceptanceLines);
  const nextActionText = collapseSectionLines(roundSections.next_action ?? []);
  const scopeText = collapseSectionLines(roundSections.scope_in_round ?? []);
  const referencedIssueIds = extractIssueIdsFromText(`${scopeText} ${nextActionText}`);
  const acceptanceStatus = roundAcceptanceStatus(acceptanceText);

  return {
    enabled: fs.existsSync(backlogPath) || latestRoundPath !== null,
    backlog_path: fs.existsSync(backlogPath) ? displayPath(repoRoot, backlogPath) : "",
    route_decision_path: String(routeDecision.path ?? ""),
    route_decision: routeDecision,
    latest_round_path: latestRoundPath ? displayPath(repoRoot, latestRoundPath) : "",
    backlog: {
      must_fix_now: {
        open_count: mustFixNowItems.length,
        open_items: mustFixNowItems,
      },
      should_fix_if_cheap: {
        open_count: shouldFixIfCheapItems.length,
        open_items: shouldFixIfCheapItems,
      },
      defer: {
        open_count: deferItems.length,
        open_items: deferItems,
      },
    },
    must_fix_now: {
      open_count: mustFixNowItems.length,
      open_items: mustFixNowItems,
    },
    latest_round: {
      round_target: roundTargetItems[0] ?? "",
      round_target_items: roundTargetItems,
      target_mode: targetModeItems[0] ?? "",
      target_mode_items: targetModeItems,
      acceptance_criteria: acceptanceCriteriaItems,
      non_goals: nonGoalItems,
      scope_in_round: scopeInRoundItems,
      normalized_backlog: normalizedBacklogItems,
      fixes_completed: fixesCompletedItems,
      re_review_result: reReviewItems,
      acceptance_text: acceptanceText,
      acceptance_status: acceptanceStatus,
      next_action_text: nextActionText,
      allows_verify: roundAllowsVerify(acceptanceText, nextActionText),
      dispatch_gate_active: Boolean(latestRoundPath && referencedIssueIds.length > 0),
      referenced_issue_ids: referencedIssueIds,
    },
  };
}

export function evaluateIssueDispatchGate(
  config: IssueModeConfig,
  controlState: Record<string, unknown>,
  issueId: string,
  issues: IssueDispatchStateSnapshot[] = []
): IssueDispatchGate {
  const gateMode = String(config.rra.gate_mode || "advisory").trim() || "advisory";
  const normalizedIssueId = issueId.trim();
  const gate: IssueDispatchGate = {
    action: "",
    active: false,
    allowed: true,
    blocking: false,
    enforced: false,
    issue_id: normalizedIssueId,
    mode: gateMode,
    reason: "",
    status: "not_applicable",
  };

  if (controlState.enabled !== true) {
    return gate;
  }

  const mustFixNow = isRecord(controlState.must_fix_now) ? controlState.must_fix_now : {};
  const mustFixNowOpen = Number(mustFixNow.open_count ?? 0);
  if (mustFixNowOpen > 0) {
    gate.active = true;
    gate.blocking = true;
    gate.allowed = false;
    gate.status = "blocked_by_backlog";
    gate.action = "resolve_round_backlog";
    gate.reason = `当前 RRA backlog 仍有 ${mustFixNowOpen} 个 Must fix now 未处理。`;
    gate.enforced = gateMode === "enforce";
    return gate;
  }

  const roundDispatch = resolveRoundDispatchWindow(controlState, issues);
  const dispatchableIssueIds = new Set(roundDispatch.referenced_issue_ids);
  if (roundDispatch.dispatch_gate_active && dispatchableIssueIds.size > 0) {
    gate.active = true;
    if (dispatchableIssueIds.has(normalizedIssueId)) {
      gate.allowed = true;
      gate.status = "approved_for_dispatch";
      gate.action = "dispatch_next_issue";
      gate.reason = "当前 round 已批准该 issue 派发。";
    } else if (roundDispatch.stale_completed_round && roundDispatch.next_pending_issue_id === normalizedIssueId) {
      gate.allowed = true;
      gate.status = "approved_for_dispatch";
      gate.action = "dispatch_next_issue";
      gate.reason = "当前 round 只覆盖已收敛 issue；允许继续派发下一个 pending issue。";
    } else {
      gate.blocking = true;
      gate.allowed = false;
      gate.status = "blocked_by_round_scope";
      gate.action = "update_round_scope";
      gate.reason = "当前 round 未批准该 issue 派发，请更新 round scope。";
    }
  }

  gate.enforced = gate.blocking && gateMode === "enforce";
  return gate;
}

export function ensureIssueDispatchAllowed(
  config: IssueModeConfig,
  controlState: Record<string, unknown>,
  issueId: string,
  issues: IssueDispatchStateSnapshot[] = []
): IssueDispatchGate {
  const gate = evaluateIssueDispatchGate(config, controlState, issueId, issues);
  if (gate.enforced) {
    throw new Error(`Dispatch blocked by RRA gate: ${gate.reason || "unknown reason"}`);
  }
  return gate;
}

export function automationProfile(config: IssueModeConfig): "semi_auto" | "full_auto" | "custom" {
  const gateMode = String(config.rra.gate_mode || "advisory").trim() || "advisory";
  const team = config.subagent_team;
  const allEnabled = SUBAGENT_TEAM_AUTOMATION_FIELDS.every((field) => Boolean(team[field]));
  if (allEnabled && gateMode === "enforce") {
    return "full_auto";
  }
  if (
    gateMode === "advisory" &&
    !team.auto_accept_spec_readiness &&
    !team.auto_accept_issue_planning &&
    !team.auto_accept_change_acceptance &&
    !team.auto_archive_after_verify
  ) {
    return "semi_auto";
  }
  return "custom";
}

export function loadIssueModeConfig(repoRoot: string): IssueModeConfig {
  const configPath = path.join(repoRoot, CONFIG_RELATIVE_PATH);
  let payload: Record<string, unknown> = {};
  let config: JsonObject = DEFAULT_CONFIG as unknown as JsonObject;

  if (fs.existsSync(configPath)) {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      throw new Error(`${CONFIG_RELATIVE_PATH} must contain a JSON object.`);
    }
    payload = parsed;
    config = deepMerge(DEFAULT_CONFIG as unknown as JsonObject, parsed as JsonObject);
  }

  const worktreeRoot = String(config.worktree_root ?? DEFAULT_CONFIG.worktree_root).trim() || ".worktree";
  if (path.isAbsolute(worktreeRoot)) {
    throw new Error(`${CONFIG_RELATIVE_PATH} field \`worktree_root\` must be repo-relative.`);
  }

  let validationCommands = normalizeStringList(config.validation_commands);
  if (validationCommands.length === 0) {
    validationCommands = [...DEFAULT_CONFIG.validation_commands];
  }

  const workerWorktree = isRecord(config.worker_worktree) ? config.worker_worktree : {};
  let worktreeEnabled = normalizeWorkerWorktreeEnabled(payload);
  let worktreeScope = normalizeWorkerWorktreeScope(payload, worktreeEnabled);
  if (worktreeScope === "shared") {
    worktreeEnabled = false;
  } else if (!worktreeEnabled) {
    worktreeScope = "shared";
  }

  const worktreeModeRaw = String(workerWorktree.mode ?? DEFAULT_CONFIG.worker_worktree.mode).trim() || "detach";
  if (worktreeModeRaw !== "detach" && worktreeModeRaw !== "branch") {
    throw new Error(`${CONFIG_RELATIVE_PATH} field \`worker_worktree.mode\` must be \`detach\` or \`branch\`.`);
  }
  const worktreeMode = worktreeModeRaw as "detach" | "branch";

  const baseRef = String(workerWorktree.base_ref ?? DEFAULT_CONFIG.worker_worktree.base_ref).trim() || "HEAD";
  const branchPrefix =
    String(workerWorktree.branch_prefix ?? DEFAULT_CONFIG.worker_worktree.branch_prefix).trim() || "opsx";

  const rra = isRecord(config.rra) ? config.rra : {};
  const gateModeRaw = String(rra.gate_mode ?? DEFAULT_CONFIG.rra.gate_mode).trim() || "advisory";
  if (gateModeRaw !== "advisory" && gateModeRaw !== "enforce") {
    throw new Error(`${CONFIG_RELATIVE_PATH} field \`rra.gate_mode\` must be \`advisory\` or \`enforce\`.`);
  }
  const gateMode = gateModeRaw as "advisory" | "enforce";
  const subagentTeam = normalizeSubagentTeamFlags(payload.subagent_team);

  return {
    worktree_root: worktreeRoot,
    validation_commands: validationCommands,
    worker_worktree: {
      enabled: worktreeEnabled,
      scope: worktreeScope,
      mode: worktreeMode,
      base_ref: baseRef,
      branch_prefix: branchPrefix,
    },
    rra: {
      gate_mode: gateMode,
    },
    subagent_team: subagentTeam,
    config_path: CONFIG_RELATIVE_PATH,
    config_exists: fs.existsSync(configPath),
  };
}
