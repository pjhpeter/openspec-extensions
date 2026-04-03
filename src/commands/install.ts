import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const SOURCE_SKILLS_ROOT = "skills";
const LEGACY_CODEX_SKILLS_ROOT = path.join(".codex", "skills");
const OPENSPEC_CONFIG_PATH = path.join("openspec", "config.yaml");
const CONFIG_TEMPLATE_PATH = path.join("templates", "issue-mode.json");
const TARGET_CONFIG_PATH = path.join("openspec", "issue-mode.json");
const SKILL_NAMES = [
  "openspec-chat-router",
  "openspec-plan-issues",
  "openspec-dispatch-issue",
  "openspec-execute-issue",
  "openspec-reconcile-change",
  "openspec-subagent-team"
];
const OPENSPEC_CORE_SKILL_NAMES = [
  "openspec-explore",
  "openspec-new-change",
  "openspec-continue-change",
  "openspec-apply-change",
  "openspec-ff-change",
  "openspec-sync-specs",
  "openspec-archive-change",
  "openspec-bulk-archive-change",
  "openspec-verify-change",
  "openspec-onboard",
  "openspec-propose"
];
// 与 openspec@1.2.0 的 tool -> skillsDir 约定保持一致。
const OPENSPEC_TOOL_SKILL_DIRS = {
  "amazon-q": ".amazonq",
  antigravity: ".agent",
  auggie: ".augment",
  claude: ".claude",
  cline: ".cline",
  codex: ".codex",
  codebuddy: ".codebuddy",
  continue: ".continue",
  costrict: ".cospec",
  crush: ".crush",
  cursor: ".cursor",
  factory: ".factory",
  gemini: ".gemini",
  "github-copilot": ".github",
  iflow: ".iflow",
  kilocode: ".kilocode",
  kiro: ".kiro",
  opencode: ".opencode",
  pi: ".pi",
  qoder: ".qoder",
  qwen: ".qwen",
  roocode: ".roo",
  trae: ".trae",
  windsurf: ".windsurf"
} as const;
const GITIGNORE_ENTRIES = [
  ".worktree/",
  "openspec/changes/*/runs/CHANGE-REVIEW.json",
  "openspec/changes/*/runs/CHANGE-VERIFY.json"
];
const LEGACY_RUNTIME_PATHS = [
  path.join(LEGACY_CODEX_SKILLS_ROOT, "openspec-shared"),
  path.join(LEGACY_CODEX_SKILLS_ROOT, "openspec-monitor-worker"),
  path.join("scripts", "openspec_coordinator_heartbeat.py"),
  path.join("scripts", "openspec_coordinator_heartbeat_start.py"),
  path.join("scripts", "openspec_coordinator_heartbeat_status.py"),
  path.join("scripts", "openspec_coordinator_heartbeat_stop.py"),
  path.join("scripts", "openspec_coordinator_tick.py"),
  path.join("scripts", "openspec_worker_launch.py"),
  path.join("scripts", "openspec_worker_status.py")
];
const LEGACY_CONFIG_KEYS = [
  "codex_home",
  "persistent_host",
  "coordinator_heartbeat",
  "worker_launcher"
];

const INSTALL_HELP_TEXT = `Usage:
  openspec-extensions install --target-repo <path> [--source-repo <path>] [--force] [--force-config] [--skip-gitignore] [--dry-run]
`;

type JsonObject = Record<string, unknown>;

export type InstallOptions = {
  dryRun: boolean;
  force: boolean;
  forceConfig: boolean;
  skipGitignore: boolean;
  sourceRepo: string;
  targetRepo: string;
};

export type InstallResult = {
  config: {
    invalid_json: boolean;
    legacy_keys_present: string[];
    overrides: JsonObject;
    path: string;
    status: "installed" | "overwritten" | "preserved";
  };
  dry_run: boolean;
  force: boolean;
  force_config: boolean;
  gitignore: {
    added_entries: string[];
    entries: string[];
    path: string;
    skipped: boolean;
    updated: boolean;
  };
  installed_skill_dirs: string[];
  target_skill_roots: string[];
  legacy_runtime_cleanup: {
    reason: string;
    removed_paths: string[];
    skipped_paths: string[];
  };
  overwritten_skill_dirs: string[];
  preserved_skill_dirs: string[];
  source_repo: string;
  target_repo: string;
};

type InstallExecutionOptions = {
  allowMissingSkillRoots?: boolean;
  configOverrides?: JsonObject;
  plannedOpenSpecTools?: string;
  skipOpenSpecPreflight?: boolean;
};

function commandRepoRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function openspecInitSuggestion(targetRepo: string): string {
  return `openspec-ex init ${JSON.stringify(targetRepo)}`;
}

function openspecToolSkillRoots(): string[] {
  return Array.from(new Set(Object.values(OPENSPEC_TOOL_SKILL_DIRS)))
    .sort()
    .map((toolDir) => relativePosix(path.join(toolDir, "skills")));
}

function ensureDirectory(targetPath: string, label: string): void {
  if (!existsSync(targetPath)) {
    throw new Error(`${label} does not exist: ${targetPath}`);
  }
  if (!lstatSync(targetPath).isDirectory()) {
    throw new Error(`${label} is not a directory: ${targetPath}`);
  }
}

function relativePosix(inputPath: string): string {
  return inputPath.split(path.sep).join("/");
}

function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const result: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (isJsonObject(current) && isJsonObject(value)) {
      result[key] = deepMerge(current, value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function deletePath(targetPath: string): void {
  if (lstatSync(targetPath).isDirectory()) {
    rmSync(targetPath, { recursive: true, force: true });
    return;
  }
  unlinkSync(targetPath);
}

function cleanupLegacyRuntime(
  targetRepo: string,
  options: {
    allowCleanup: boolean;
    dryRun: boolean;
  }
): {
  reason: string;
  removedPaths: string[];
  skippedPaths: string[];
} {
  const removedPaths: string[] = [];
  const skippedPaths: string[] = [];

  for (const relativePath of LEGACY_RUNTIME_PATHS) {
    const targetPath = path.join(targetRepo, relativePath);
    if (!existsSync(targetPath)) {
      continue;
    }
    if (!options.allowCleanup) {
      skippedPaths.push(relativePosix(relativePath));
      continue;
    }
    if (!options.dryRun) {
      deletePath(targetPath);
    }
    removedPaths.push(relativePosix(relativePath));
  }

  return {
    removedPaths,
    skippedPaths,
    reason: skippedPaths.length
      ? "Existing installed skill directories were preserved. Re-run with --force to upgrade skills and remove legacy runtime artifacts safely."
      : ""
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadJsonObject(filePath: string): {
  invalidJson: boolean;
  payload: JsonObject;
} {
  try {
    const payload = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isJsonObject(payload)) {
      return { invalidJson: false, payload: {} };
    }
    return { invalidJson: false, payload };
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return { invalidJson: true, payload: {} };
    }
    throw error;
  }
}

function inspectConfigState(options: {
  configStatus: string;
  overrides: JsonObject;
  sourceRepo: string;
  targetRepo: string;
}): {
  invalidJson: boolean;
  legacyKeysPresent: string[];
} {
  if (options.configStatus === "installed" || options.configStatus === "overwritten") {
    const template = JSON.parse(readFileSync(path.join(options.sourceRepo, CONFIG_TEMPLATE_PATH), "utf8")) as JsonObject;
    const payload = deepMerge(template, options.overrides);
    return {
      invalidJson: false,
      legacyKeysPresent: LEGACY_CONFIG_KEYS.filter((key) => Object.hasOwn(payload, key))
    };
  }

  const targetConfig = path.join(options.targetRepo, TARGET_CONFIG_PATH);
  if (!existsSync(targetConfig)) {
    return { invalidJson: false, legacyKeysPresent: [] };
  }

  const { invalidJson, payload } = loadJsonObject(targetConfig);
  return {
    invalidJson,
    legacyKeysPresent: LEGACY_CONFIG_KEYS.filter((key) => Object.hasOwn(payload, key))
  };
}

function validateSourceLayout(sourceRepo: string): void {
  ensureDirectory(sourceRepo, "Source repo");
  ensureDirectory(path.join(sourceRepo, SOURCE_SKILLS_ROOT), "Source skills root");
  const missing = SKILL_NAMES.filter((name) => !existsSync(path.join(sourceRepo, SOURCE_SKILLS_ROOT, name)));
  if (missing.length) {
    throw new Error(`Source repo is missing required skills: ${missing.join(", ")}`);
  }
  if (!existsSync(path.join(sourceRepo, CONFIG_TEMPLATE_PATH))) {
    throw new Error(`Source repo is missing config template: ${relativePosix(CONFIG_TEMPLATE_PATH)}`);
  }
}

function ensureTargetRepo(targetRepo: string): void {
  ensureDirectory(targetRepo, "Target repo");
}

export function isOpenSpecInitialized(targetRepo: string): boolean {
  return existsSync(path.join(targetRepo, OPENSPEC_CONFIG_PATH));
}

function ensureOpenSpecInitialized(targetRepo: string): void {
  if (isOpenSpecInitialized(targetRepo)) {
    return;
  }

  throw new Error(
    `Target repo is not initialized with OpenSpec. Run \`${openspecInitSuggestion(targetRepo)}\` or \`openspec init ${JSON.stringify(targetRepo)}\` first.`
  );
}

function detectOpenSpecSkillRoots(targetRepo: string): string[] {
  const roots = openspecToolSkillRoots().filter((skillsRoot) =>
    OPENSPEC_CORE_SKILL_NAMES.some((skillName) =>
      existsSync(path.join(targetRepo, skillsRoot, skillName, "SKILL.md"))
    )
  );

  return roots.sort();
}

function plannedSkillRootsFromOpenSpecTools(tools: string | undefined): string[] {
  if (!tools) {
    return [];
  }

  const normalized = tools.trim();
  if (!normalized || normalized === "none") {
    return [];
  }
  if (normalized === "all") {
    return openspecToolSkillRoots();
  }

  const roots = new Set<string>();
  for (const toolId of normalized.split(",").map((value) => value.trim()).filter(Boolean)) {
    const toolDir = OPENSPEC_TOOL_SKILL_DIRS[toolId as keyof typeof OPENSPEC_TOOL_SKILL_DIRS];
    if (!toolDir) {
      continue;
    }
    roots.add(relativePosix(path.join(toolDir, "skills")));
  }

  return Array.from(roots).sort();
}

function resolveTargetSkillRoots(options: {
  allowMissing: boolean;
  plannedOpenSpecTools?: string;
  targetRepo: string;
}): string[] {
  const detectedRoots = detectOpenSpecSkillRoots(options.targetRepo);
  if (detectedRoots.length > 0) {
    return detectedRoots;
  }

  const plannedRoots = plannedSkillRootsFromOpenSpecTools(options.plannedOpenSpecTools);
  if (options.allowMissing) {
    return plannedRoots;
  }

  throw new Error(
    `Target repo has no OpenSpec-managed skill directories. Run \`${openspecInitSuggestion(options.targetRepo)}\` or re-run \`openspec init ${JSON.stringify(options.targetRepo)}\` and select at least one skill-based AI tool before installing extensions.`
  );
}

function installSkillDirectories(options: {
  dryRun: boolean;
  force: boolean;
  sourceRepo: string;
  targetSkillRoots: string[];
  targetRepo: string;
}): {
  installedSkillDirs: string[];
  overwrittenSkillDirs: string[];
  preservedSkillDirs: string[];
} {
  const installedSkillDirs: string[] = [];
  const overwrittenSkillDirs: string[] = [];
  const preservedSkillDirs: string[] = [];

  for (const targetSkillsRoot of options.targetSkillRoots) {
    for (const skillName of SKILL_NAMES) {
      const sourceDir = path.join(options.sourceRepo, SOURCE_SKILLS_ROOT, skillName);
      const targetRelativeDir = path.join(targetSkillsRoot, skillName);
      const targetDir = path.join(options.targetRepo, targetRelativeDir);
      const displayPath = relativePosix(targetRelativeDir);

      if (existsSync(targetDir)) {
        if (!options.force) {
          preservedSkillDirs.push(displayPath);
          continue;
        }
        overwrittenSkillDirs.push(displayPath);
        if (!options.dryRun) {
          rmSync(targetDir, { recursive: true, force: true });
        }
      }

      if (!options.dryRun) {
        mkdirSync(path.dirname(targetDir), { recursive: true });
        cpSync(sourceDir, targetDir, { recursive: true });
      }
      installedSkillDirs.push(displayPath);
    }
  }

  return {
    installedSkillDirs,
    overwrittenSkillDirs,
    preservedSkillDirs
  };
}

function installConfigTemplate(options: {
  dryRun: boolean;
  forceConfig: boolean;
  overrides: JsonObject;
  sourceRepo: string;
  targetRepo: string;
}): {
  path: string;
  status: "installed" | "overwritten" | "preserved";
} {
  const sourceConfig = path.join(options.sourceRepo, CONFIG_TEMPLATE_PATH);
  const targetConfig = path.join(options.targetRepo, TARGET_CONFIG_PATH);
  const existedBefore = existsSync(targetConfig);

  if (existedBefore && !options.forceConfig) {
    return {
      path: relativePosix(TARGET_CONFIG_PATH),
      status: "preserved"
    };
  }

  const mergedConfig = deepMerge(
    JSON.parse(readFileSync(sourceConfig, "utf8")) as JsonObject,
    options.overrides
  );

  if (!options.dryRun) {
    mkdirSync(path.dirname(targetConfig), { recursive: true });
    writeFileSync(targetConfig, `${JSON.stringify(mergedConfig, null, 2)}\n`);
  }

  return {
    path: relativePosix(TARGET_CONFIG_PATH),
    status: existedBefore ? "overwritten" : "installed"
  };
}

function updateGitignore(targetRepo: string, dryRun: boolean): {
  addedEntries: string[];
  path: string;
} {
  const gitignorePath = path.join(targetRepo, ".gitignore");
  const content = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const lines = content.split(/\r?\n/);
  const missingEntries = GITIGNORE_ENTRIES.filter((entry) => !lines.includes(entry));

  if (!missingEntries.length) {
    return {
      addedEntries: [],
      path: ".gitignore"
    };
  }

  let updated = content;
  if (updated && !updated.endsWith("\n")) {
    updated += "\n";
  }
  updated += missingEntries.map((entry) => `${entry}\n`).join("");

  if (!dryRun) {
    writeFileSync(gitignorePath, updated);
  }

  return {
    addedEntries: missingEntries,
    path: ".gitignore"
  };
}

function parseInstallArgs(argv: string[]): InstallOptions | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "force-config": { type: "boolean", default: false },
      help: { short: "h", type: "boolean", default: false },
      "skip-gitignore": { type: "boolean", default: false },
      "source-repo": { type: "string", default: "" },
      "target-repo": { type: "string" }
    },
    strict: true
  });

  if (values.help) {
    process.stdout.write(INSTALL_HELP_TEXT);
    return null;
  }

  if (!values["target-repo"]) {
    throw new Error("Missing required option: --target-repo");
  }

  return {
    dryRun: values["dry-run"],
    force: values.force,
    forceConfig: values["force-config"],
    skipGitignore: values["skip-gitignore"],
    sourceRepo: values["source-repo"],
    targetRepo: values["target-repo"]
  };
}

export function installExtensions(
  parsed: InstallOptions,
  options: InstallExecutionOptions = {}
): InstallResult {
  const sourceRepo = realpathSync(path.resolve(parsed.sourceRepo || commandRepoRoot()));
  const targetRepo = realpathSync(path.resolve(parsed.targetRepo));

  if (sourceRepo === targetRepo) {
    throw new Error("Source repo and target repo must be different.");
  }

  validateSourceLayout(sourceRepo);
  ensureTargetRepo(targetRepo);
  if (!options.skipOpenSpecPreflight) {
    ensureOpenSpecInitialized(targetRepo);
  }
  const targetSkillRoots = resolveTargetSkillRoots({
    allowMissing: options.allowMissingSkillRoots ?? false,
    plannedOpenSpecTools: options.plannedOpenSpecTools,
    targetRepo
  });

  const installResult = installSkillDirectories({
    dryRun: parsed.dryRun,
    force: parsed.force,
    sourceRepo,
    targetSkillRoots,
    targetRepo
  });
  const legacyRuntimeCleanup = cleanupLegacyRuntime(targetRepo, {
    allowCleanup: installResult.preservedSkillDirs.length === 0,
    dryRun: parsed.dryRun
  });
  const config = installConfigTemplate({
    dryRun: parsed.dryRun,
    forceConfig: parsed.forceConfig,
    overrides: options.configOverrides ?? {},
    sourceRepo,
    targetRepo
  });
  const configState = inspectConfigState({
    configStatus: config.status,
    overrides: options.configOverrides ?? {},
    sourceRepo,
    targetRepo
  });

  const gitignore = parsed.skipGitignore
    ? {
        addedEntries: [],
        path: ""
      }
    : updateGitignore(targetRepo, parsed.dryRun);

  const result = {
    config: {
      invalid_json: configState.invalidJson,
      legacy_keys_present: configState.legacyKeysPresent,
      overrides: options.configOverrides ?? {},
      path: config.path,
      status: config.status
    },
    dry_run: parsed.dryRun,
    force: parsed.force,
    force_config: parsed.forceConfig,
    gitignore: {
      added_entries: gitignore.addedEntries,
      entries: GITIGNORE_ENTRIES,
      path: gitignore.path,
      skipped: parsed.skipGitignore,
      updated: gitignore.addedEntries.length > 0
    },
    installed_skill_dirs: installResult.installedSkillDirs,
    target_skill_roots: targetSkillRoots,
    legacy_runtime_cleanup: {
      reason: legacyRuntimeCleanup.reason,
      removed_paths: legacyRuntimeCleanup.removedPaths,
      skipped_paths: legacyRuntimeCleanup.skippedPaths
    },
    overwritten_skill_dirs: installResult.overwrittenSkillDirs,
    preserved_skill_dirs: installResult.preservedSkillDirs,
    source_repo: sourceRepo,
    target_repo: targetRepo
  } satisfies InstallResult;

  return result;
}

export function runInstallCommand(argv: string[]): number {
  const parsed = parseInstallArgs(argv);
  if (!parsed) {
    return 0;
  }

  const result = installExtensions(parsed);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}
