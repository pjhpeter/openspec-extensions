import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { withBundledOpenSpecPath } from "../../src/commands/init";

test("withBundledOpenSpecPath prepends the bundled node bin", () => {
  const packageRoot = mkdtempSync(path.join(os.tmpdir(), "openspec-bundled-bin-"));
  const bundledNodeBin = path.join(packageRoot, "node_modules", ".bin");
  mkdirSync(bundledNodeBin, { recursive: true });

  const env = withBundledOpenSpecPath({
    PATH: ["/usr/bin", "/bin"].join(path.delimiter)
  }, packageRoot);

  assert.equal(env.PATH, [bundledNodeBin, "/usr/bin", "/bin"].join(path.delimiter));
});

test("withBundledOpenSpecPath keeps the bundled node bin unique", () => {
  const packageRoot = mkdtempSync(path.join(os.tmpdir(), "openspec-bundled-bin-"));
  const bundledNodeBin = path.join(packageRoot, "node_modules", ".bin");
  mkdirSync(bundledNodeBin, { recursive: true });

  const env = withBundledOpenSpecPath({
    PATH: ["/usr/bin", bundledNodeBin, "/bin"].join(path.delimiter)
  }, packageRoot);

  assert.equal(env.PATH, [bundledNodeBin, "/usr/bin", "/bin"].join(path.delimiter));
});

test("package manifest keeps openspec within the 1.2.x runtime range", () => {
  const packageJson = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
  ) as {
    dependencies?: Record<string, string>;
  };

  assert.equal(packageJson.dependencies?.["@fission-ai/openspec"], "~1.2.0");
});
