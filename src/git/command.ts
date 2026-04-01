import { spawnSync } from "node:child_process";

export type GitCommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export type GitBinaryCommandResult = {
  exitCode: number;
  stderr: string;
  stdout: Buffer;
};

type GitCommandOptions = {
  check?: boolean;
  cwd?: string;
  input?: Buffer | string;
  okCodes?: number[];
};

function ensureOk(
  exitCode: number,
  stderr: string,
  stdout: string,
  options: GitCommandOptions
): void {
  const okCodes = options.okCodes ?? [0];
  if ((options.check ?? true) && !okCodes.includes(exitCode)) {
    throw new Error(stderr.trim() || stdout.trim() || "git command failed");
  }
}

export function runGitCommand(
  args: string[],
  options: GitCommandOptions = {}
): GitCommandResult {
  const process = spawnSync("git", args, {
    cwd: options.cwd,
    input: options.input,
    encoding: "utf8",
  });
  const result: GitCommandResult = {
    exitCode: process.status ?? (process.error ? 1 : 0),
    stderr: process.stderr ?? process.error?.message ?? "",
    stdout: process.stdout ?? "",
  };
  ensureOk(result.exitCode, result.stderr, result.stdout, options);
  return result;
}

export function runGitBinaryCommand(
  args: string[],
  options: GitCommandOptions = {}
): GitBinaryCommandResult {
  const process = spawnSync("git", args, {
    cwd: options.cwd,
    input: options.input,
  });
  const stdout = Buffer.isBuffer(process.stdout) ? process.stdout : Buffer.from(process.stdout ?? "");
  const stderr = Buffer.isBuffer(process.stderr)
    ? process.stderr.toString("utf8")
    : (process.stderr ?? process.error?.message ?? "");
  const result: GitBinaryCommandResult = {
    exitCode: process.status ?? (process.error ? 1 : 0),
    stderr,
    stdout,
  };
  ensureOk(result.exitCode, result.stderr, result.stdout.toString("utf8"), options);
  return result;
}
