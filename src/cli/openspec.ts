#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";

type BundledOpenSpecProxyDependencies = {
  resolveCliEntry?: () => string;
  spawn?: (
    command: string,
    args: string[],
    options: {
      stdio: "inherit";
    }
  ) => {
    error?: Error;
    signal?: string | null;
    status: number | null;
  };
};

export function resolveBundledOpenSpecCliEntry(): string {
  try {
    const packageEntry = require.resolve("@fission-ai/openspec");
    // 这里固定转发到包内官方 CLI，避免全新环境还要再装一遍 openspec。
    return path.resolve(path.dirname(packageEntry), "..", "bin", "openspec.js");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Bundled OpenSpec CLI is unavailable: ${message}`);
  }
}

export function runBundledOpenSpecCli(
  argv: string[],
  dependencies: BundledOpenSpecProxyDependencies = {}
): number {
  const resolveCliEntry = dependencies.resolveCliEntry ?? resolveBundledOpenSpecCliEntry;
  const cliEntry = resolveCliEntry();
  const spawn = dependencies.spawn ?? spawnSync;
  const result = spawn(process.execPath, [cliEntry, ...argv], {
    // 用当前 Node 进程拉起脚本，避免平台差异影响 shebang 解析。
    stdio: "inherit"
  });

  if (typeof result.status === "number") {
    return result.status;
  }
  if (result.error?.message) {
    throw new Error(`Failed to launch bundled OpenSpec CLI: ${result.error.message}`);
  }
  if (result.signal) {
    throw new Error(`Bundled OpenSpec CLI terminated by signal ${result.signal}`);
  }
  throw new Error("Bundled OpenSpec CLI failed to start.");
}

if (require.main === module) {
  try {
    process.exitCode = runBundledOpenSpecCli(process.argv.slice(2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
