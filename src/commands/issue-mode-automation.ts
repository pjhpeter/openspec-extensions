import { createInterface } from "node:readline/promises";

type JsonObject = Record<string, unknown>;

export type IssueModeAutomationPreference = "semi-auto" | "full-auto";

// 明确写全开关，避免模板默认值变化后悄悄改变已选 automation profile。
export const ISSUE_MODE_AUTOMATION_OVERRIDES: Record<IssueModeAutomationPreference, JsonObject> = {
  "semi-auto": {
    rra: {
      gate_mode: "advisory"
    },
    subagent_team: {
      auto_accept_spec_readiness: false,
      auto_accept_issue_planning: false,
      auto_accept_issue_review: false,
      auto_accept_change_acceptance: false,
      auto_archive_after_verify: false
    }
  },
  "full-auto": {
    rra: {
      gate_mode: "enforce"
    },
    subagent_team: {
      auto_accept_spec_readiness: true,
      auto_accept_issue_planning: true,
      auto_accept_issue_review: true,
      auto_accept_change_acceptance: false,
      auto_archive_after_verify: false
    }
  }
};

export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

export async function promptIssueModeAutomationPreference(): Promise<IssueModeAutomationPreference> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr
  });

  try {
    for (;;) {
      const answer = (await readline.question(
        "Choose the issue-mode automation style to install: [1] Semi-automatic and controllable (recommended) [2] Fully automatic through automated-test closeout [1/2] "
      ))
        .trim()
        .toLowerCase();

      if (answer === "" || answer === "1" || answer === "semi" || answer === "semi-auto") {
        return "semi-auto";
      }
      if (answer === "2" || answer === "full" || answer === "full-auto" || answer === "auto") {
        return "full-auto";
      }

      process.stderr.write("Please enter 1 or 2.\n");
    }
  } finally {
    readline.close();
  }
}
