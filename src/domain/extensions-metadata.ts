import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const EXTENSIONS_PACKAGE_NAME = "openspec-extensions";
const PACKAGE_JSON_PATH = path.resolve(__dirname, "../../package.json");

export const EXTENSIONS_METADATA_RELATIVE_PATH = path.join("openspec", "openspec-extensions.json");

export type ExtensionsMetadataRecorder = "init" | "install";

export interface ExtensionsMetadata {
  metadata_version: 1;
  package_name: typeof EXTENSIONS_PACKAGE_NAME;
  initialized_version: string;
  installed_version: string;
  updated_at: string;
  recorded_by: ExtensionsMetadataRecorder;
}

export interface ExtensionsMetadataWriteResult {
  invalid_json: boolean;
  metadata: ExtensionsMetadata;
  path: string;
  status: "installed" | "overwritten";
}

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(filePath: string): {
  invalidJson: boolean;
  payload: JsonObject;
} {
  try {
    const payload = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return {
      invalidJson: false,
      payload: isRecord(payload) ? payload : {}
    };
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return {
        invalidJson: true,
        payload: {}
      };
    }
    throw error;
  }
}

export function readOwnPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as { version?: unknown };
  return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
}

export function writeExtensionsMetadata(options: {
  dryRun: boolean;
  recordedBy: ExtensionsMetadataRecorder;
  targetRepo: string;
}): ExtensionsMetadataWriteResult {
  const metadataPath = path.join(options.targetRepo, EXTENSIONS_METADATA_RELATIVE_PATH);
  const existedBefore = existsSync(metadataPath);
  const currentVersion = readOwnPackageVersion();
  const existing = existedBefore ? readJsonObject(metadataPath) : { invalidJson: false, payload: {} };
  const initializedVersion = typeof existing.payload.initialized_version === "string" && existing.payload.initialized_version.trim()
    ? existing.payload.initialized_version.trim()
    : currentVersion;
  const metadata: ExtensionsMetadata = {
    metadata_version: 1,
    package_name: EXTENSIONS_PACKAGE_NAME,
    initialized_version: initializedVersion,
    installed_version: currentVersion,
    updated_at: new Date().toISOString(),
    recorded_by: options.recordedBy
  };

  if (!options.dryRun) {
    mkdirSync(path.dirname(metadataPath), { recursive: true });
    // 单独记录插件版本，避免和 issue-mode 配置覆盖策略耦合。
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  }

  return {
    invalid_json: existing.invalidJson,
    metadata,
    path: EXTENSIONS_METADATA_RELATIVE_PATH.split(path.sep).join("/"),
    status: existedBefore ? "overwritten" : "installed"
  };
}
