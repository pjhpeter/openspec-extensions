import assert from "node:assert/strict";
import test from "node:test";

import { runBundledOpenSpecCli } from "../../src/cli/openspec";

test("openspec proxy forwards argv to the bundled CLI entry", () => {
  const calls: Array<{
    args: string[];
    command: string;
    options: { stdio: "inherit" };
  }> = [];

  const exitCode = runBundledOpenSpecCli([
    "--version"
  ], {
    resolveCliEntry: () => "/tmp/fake-openspec.js",
    spawn(command, args, options) {
      calls.push({ args, command, options });
      return {
        status: 0
      };
    }
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    {
      args: ["/tmp/fake-openspec.js", "--version"],
      command: process.execPath,
      options: { stdio: "inherit" }
    }
  ]);
});

test("openspec proxy reports a clear error when the bundled CLI is missing", () => {
  assert.throws(
    () =>
      runBundledOpenSpecCli([], {
        resolveCliEntry() {
          throw new Error("Cannot find module '@fission-ai/openspec/bin/openspec.js'");
        }
      }),
    /Cannot find module '@fission-ai\/openspec\/bin\/openspec\.js'/
  );
});
