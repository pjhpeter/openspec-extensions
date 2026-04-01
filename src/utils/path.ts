import path from "node:path";

export function ensurePathWithin(parent: string, target: string): void {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (relative === "" || relative === ".") {
    return;
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path \`${target}\` must stay within \`${parent}\`.`);
  }
}

export function displayPath(repoRoot: string, targetPath: string): string {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(targetPath));
  if (relative === "" || relative === ".") {
    return ".";
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.resolve(targetPath);
  }
  return relative.split(path.sep).join("/");
}

export function resolveRepoPath(repoRoot: string, rawPath: string): string {
  if (path.isAbsolute(rawPath)) {
    return path.resolve(rawPath);
  }
  return path.resolve(repoRoot, rawPath);
}

