import { spawnSync } from "node:child_process";

export type GitCommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export function runGitCommand(
  args: string[],
  options: {
    check?: boolean;
    cwd?: string;
  } = {}
): GitCommandResult {
  const process = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
  });
  const result: GitCommandResult = {
    exitCode: process.status ?? (process.error ? 1 : 0),
    stderr: process.stderr ?? process.error?.message ?? "",
    stdout: process.stdout ?? "",
  };

  if ((options.check ?? true) && result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "git command failed");
  }
  return result;
}
