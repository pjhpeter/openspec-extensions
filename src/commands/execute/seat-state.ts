import path from "node:path";

import {
  assertTerminalOverwriteAllowed,
  buildSeatStateRecord,
  isSeatFailureKind,
  normalizeSeatKey,
  readSeatStateRecord,
  seatStatePath,
  type SeatFailureKind,
  type SeatLifecycleStatus,
  type SeatPhase,
  type SeatReasoningEffort,
} from "../../domain/seat-control";
import { writeSeatState } from "../../domain/seat-control";

type ParsedArgs = {
  allowTerminalOverwrite: boolean;
  change: string;
  checkpoint: string;
  dispatchId: string;
  failureKind: string;
  failureMessage: string;
  gateBearing: string;
  issueId: string;
  phase: string;
  reasoningEffort: string;
  repoRoot: string;
  required: string;
  seat: string;
  status: string;
  agentId: string;
};

const HELP_TEXT = `Usage:
  openspec-extensions execute seat-state set --repo-root <path> --change <change> --dispatch-id <dispatch-id> --phase <phase> --seat <seat> --status <status> --agent-id <agent-id> [options]

Options:
  --issue-id <issue-id>
  --gate-bearing <true|false>
  --required <true|false>
  --reasoning-effort <low|medium|high|unknown>
  --checkpoint <checkpoint>
  --failure-kind <kind>
  --failure-message <message>
  --allow-terminal-overwrite <true|false>
`;

function parseBooleanLike(value: string, optionName: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(`${optionName} must be true or false`);
}

function requiredValue(value: string | undefined, optionName: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`Missing required option: ${optionName}`);
  }
  return normalized;
}

function parseArgs(argv: string[]): ParsedArgs | null {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP_TEXT);
    return null;
  }
  if (command !== "set") {
    throw new Error("Seat-state command must be: set");
  }

  const parsed: ParsedArgs = {
    allowTerminalOverwrite: false,
    change: "",
    checkpoint: "",
    dispatchId: "",
    failureKind: "",
    failureMessage: "",
    gateBearing: "",
    issueId: "",
    phase: "",
    reasoningEffort: "",
    repoRoot: "",
    required: "",
    seat: "",
    status: "",
    agentId: ""
  };

  let index = 1;
  while (index < argv.length) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token ?? ""}`);
    }
    if (value === undefined) {
      throw new Error(`Missing value for ${token}`);
    }

    switch (token) {
      case "--repo-root":
        parsed.repoRoot = value;
        break;
      case "--change":
        parsed.change = value;
        break;
      case "--dispatch-id":
        parsed.dispatchId = value;
        break;
      case "--phase":
        parsed.phase = value;
        break;
      case "--issue-id":
        parsed.issueId = value;
        break;
      case "--seat":
        parsed.seat = value;
        break;
      case "--status":
        parsed.status = value;
        break;
      case "--agent-id":
        parsed.agentId = value;
        break;
      case "--gate-bearing":
        parsed.gateBearing = value;
        break;
      case "--required":
        parsed.required = value;
        break;
      case "--reasoning-effort":
        parsed.reasoningEffort = value;
        break;
      case "--checkpoint":
        parsed.checkpoint = value;
        break;
      case "--failure-kind":
        parsed.failureKind = value;
        break;
      case "--failure-message":
        parsed.failureMessage = value;
        break;
      case "--allow-terminal-overwrite":
        parsed.allowTerminalOverwrite = parseBooleanLike(value, "--allow-terminal-overwrite");
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
    index += 2;
  }

  requiredValue(parsed.repoRoot, "--repo-root");
  requiredValue(parsed.change, "--change");
  requiredValue(parsed.dispatchId, "--dispatch-id");
  requiredValue(parsed.phase, "--phase");
  requiredValue(parsed.seat, "--seat");
  requiredValue(parsed.status, "--status");
  requiredValue(parsed.agentId, "--agent-id");
  return parsed;
}

function parseReasoningEffort(value: string, previous?: SeatReasoningEffort): SeatReasoningEffort {
  const normalized = value.trim();
  if (!normalized && previous) {
    return previous;
  }
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "unknown") {
    return normalized;
  }
  throw new Error("Invalid seat reasoning effort");
}

function parsePhase(value: string): SeatPhase {
  if (
    value === "spec_readiness"
    || value === "issue_planning"
    || value === "issue_execution"
    || value === "change_acceptance"
    || value === "change_verify"
    || value === "ready_for_archive"
  ) {
    return value;
  }
  throw new Error(`Invalid seat phase: ${value}`);
}

function parseStatus(value: string): SeatLifecycleStatus {
  if (
    value === "launching"
    || value === "running"
    || value === "blocked"
    || value === "completed"
    || value === "failed"
    || value === "cancelled"
  ) {
    return value;
  }
  throw new Error(`Invalid seat lifecycle status: ${value}`);
}

function parseFailureKind(value: string): SeatFailureKind {
  if (!isSeatFailureKind(value)) {
    throw new Error(`Invalid seat failure kind: ${value}`);
  }
  return value;
}

export function runSeatStateCommand(argv: string[]): number {
  const args = parseArgs(argv);
  if (!args) {
    return 0;
  }

  const repoRoot = path.resolve(args.repoRoot);
  const phase = parsePhase(requiredValue(args.phase, "--phase"));
  const status = parseStatus(requiredValue(args.status, "--status"));
  const seat = requiredValue(args.seat, "--seat");
  const seatKey = normalizeSeatKey(seat);
  const previous = readSeatStateRecord(seatStatePath(repoRoot, args.change, args.dispatchId, seatKey));

  assertTerminalOverwriteAllowed(previous, args.allowTerminalOverwrite);

  const gateBearing = args.gateBearing
    ? parseBooleanLike(args.gateBearing, "--gate-bearing")
    : previous?.gate_bearing;
  const required = args.required
    ? parseBooleanLike(args.required, "--required")
    : previous?.required;
  if (typeof gateBearing !== "boolean" || typeof required !== "boolean") {
    throw new Error("Missing required options for new seat-state record: --gate-bearing, --required");
  }
  const reasoningEffort = parseReasoningEffort(args.reasoningEffort, previous?.reasoning_effort);

  let error: { kind: SeatFailureKind; message: string } | undefined;
  if (status === "failed" || status === "blocked") {
    const failureKind = parseFailureKind(requiredValue(args.failureKind, "--failure-kind"));
    const failureMessage = requiredValue(args.failureMessage, "--failure-message");
    error = { kind: failureKind, message: failureMessage };
  } else if (args.failureKind || args.failureMessage) {
    throw new Error("--failure-kind and --failure-message are only valid for blocked or failed status");
  }

  const record = buildSeatStateRecord({
    previous,
    change: args.change,
    dispatchId: args.dispatchId,
    phase,
    issueId: args.issueId.trim() || previous?.issue_id,
    seat,
    agentId: requiredValue(args.agentId, "--agent-id"),
    gateBearing,
    required,
    reasoningEffort,
    status,
    checkpoint: args.checkpoint.trim() || undefined,
    error
  });
  const targetPath = writeSeatState(repoRoot, record);

  process.stdout.write(`${JSON.stringify({
    seat_state_path: path.relative(repoRoot, targetPath).split(path.sep).join("/"),
    change: record.change,
    dispatch_id: record.dispatch_id,
    phase: record.phase,
    issue_id: record.issue_id ?? "",
    seat: record.seat,
    status: record.status
  })}\n`);
  return 0;
}
