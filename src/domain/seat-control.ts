import fs from "node:fs";
import path from "node:path";

import { changeDirPath, nowIso, readJson, writeJson, type JsonRecord } from "./change-coordinator";

export type SeatPhase =
  | "spec_readiness"
  | "issue_planning"
  | "issue_execution"
  | "change_acceptance"
  | "change_verify"
  | "ready_for_archive";

export type SeatBarrierMode = "inactive" | "observe" | "enforce";
export type SeatReasoningEffort = "low" | "medium" | "high" | "unknown";
export type SeatLifecycleStatus =
  | "launching"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type SeatFailureKind =
  | "startup"
  | "handoff_contract"
  | "workspace"
  | "validation"
  | "review_gate"
  | "tool_runtime"
  | "timeout"
  | "unknown";

export interface ActiveSeatDefinition {
  seat: string;
  role: string;
  gate_bearing: boolean;
  required: boolean;
  reasoning_effort: SeatReasoningEffort;
}

export interface ActiveSeatDispatchFile {
  schema_version: 1;
  change: string;
  dispatch_id: string;
  phase: SeatPhase;
  issue_id?: string;
  generated_at: string;
  barrier_mode: SeatBarrierMode;
  packet_path: string;
  seat_handoffs_path?: string;
  seats: ActiveSeatDefinition[];
}

export interface SeatStateError {
  kind: SeatFailureKind;
  message: string;
}

export interface SeatStateRecord {
  schema_version: 1;
  change: string;
  dispatch_id: string;
  phase: SeatPhase;
  issue_id?: string;
  seat: string;
  seat_key: string;
  agent_id: string;
  gate_bearing: boolean;
  required: boolean;
  reasoning_effort: SeatReasoningEffort;
  status: SeatLifecycleStatus;
  started_at: string;
  updated_at: string;
  completed_at?: string;
  last_checkpoint?: string;
  last_error?: SeatStateError;
}

export interface SeatBarrierSummary {
  active: boolean;
  blocking: boolean;
  mode: SeatBarrierMode;
  action: "" | "wait_for_gate_seats" | "resolve_seat_failure";
  dispatch_id: string;
  phase: string;
  issue_id?: string;
  required_missing: ActiveSeatDefinition[];
  required_running: SeatStateRecord[];
  required_failed: SeatStateRecord[];
  required_blocked: SeatStateRecord[];
  required_cancelled: SeatStateRecord[];
  required_completed: SeatStateRecord[];
}

type ActiveSeatDispatchIdentity = Pick<ActiveSeatDispatchFile, "phase" | "issue_id" | "seats">;

const SEAT_PHASES = new Set<SeatPhase>([
  "spec_readiness",
  "issue_planning",
  "issue_execution",
  "change_acceptance",
  "change_verify",
  "ready_for_archive",
]);
const BARRIER_MODES = new Set<SeatBarrierMode>(["inactive", "observe", "enforce"]);
const REASONING_EFFORTS = new Set<SeatReasoningEffort>(["low", "medium", "high", "unknown"]);
const SEAT_STATUSES = new Set<SeatLifecycleStatus>(["launching", "running", "blocked", "completed", "failed", "cancelled"]);
const SEAT_FAILURE_KINDS = new Set<SeatFailureKind>([
  "startup",
  "handoff_contract",
  "workspace",
  "validation",
  "review_gate",
  "tool_runtime",
  "timeout",
  "unknown",
]);
const TERMINAL_STATUSES = new Set<SeatLifecycleStatus>(["blocked", "completed", "failed", "cancelled"]);
const WAITING_STATUSES = new Set<SeatLifecycleStatus>(["launching", "running"]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new Error(`Invalid or missing seat-control field: ${field}`);
  }
  return text;
}

function optionalString(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid or missing seat-control field: ${field}`);
  }
  return value;
}

function requiredPhase(value: unknown, field: string): SeatPhase {
  const phase = requiredString(value, field) as SeatPhase;
  if (!SEAT_PHASES.has(phase)) {
    throw new Error(`Invalid seat phase: ${phase}`);
  }
  return phase;
}

function requiredBarrierMode(value: unknown, field: string): SeatBarrierMode {
  const mode = requiredString(value, field) as SeatBarrierMode;
  if (!BARRIER_MODES.has(mode)) {
    throw new Error(`Invalid seat barrier mode: ${mode}`);
  }
  return mode;
}

function requiredReasoningEffort(value: unknown, field: string): SeatReasoningEffort {
  const effort = requiredString(value, field) as SeatReasoningEffort;
  if (!REASONING_EFFORTS.has(effort)) {
    throw new Error(`Invalid seat reasoning effort: ${effort}`);
  }
  return effort;
}

function requiredStatus(value: unknown, field: string): SeatLifecycleStatus {
  const status = requiredString(value, field) as SeatLifecycleStatus;
  if (!SEAT_STATUSES.has(status)) {
    throw new Error(`Invalid seat lifecycle status: ${status}`);
  }
  return status;
}

function parseSeatFailureError(value: unknown): SeatStateError | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const kind = requiredString(value.kind, "last_error.kind") as SeatFailureKind;
  if (!SEAT_FAILURE_KINDS.has(kind)) {
    throw new Error(`Invalid seat failure kind: ${kind}`);
  }
  return {
    kind,
    message: requiredString(value.message, "last_error.message")
  };
}

function parseActiveSeatDefinition(value: unknown): ActiveSeatDefinition {
  if (!isRecord(value)) {
    throw new Error("Invalid seat definition payload.");
  }
  return {
    seat: requiredString(value.seat, "seat"),
    role: requiredString(value.role, "role"),
    gate_bearing: requiredBoolean(value.gate_bearing, "gate_bearing"),
    required: requiredBoolean(value.required, "required"),
    reasoning_effort: requiredReasoningEffort(value.reasoning_effort, "reasoning_effort")
  };
}

function parseSeatStateRecord(value: unknown): SeatStateRecord {
  if (!isRecord(value)) {
    throw new Error("Invalid seat-state payload.");
  }
  const record: SeatStateRecord = {
    schema_version: 1,
    change: requiredString(value.change, "change"),
    dispatch_id: requiredString(value.dispatch_id, "dispatch_id"),
    phase: requiredPhase(value.phase, "phase"),
    seat: requiredString(value.seat, "seat"),
    seat_key: requiredString(value.seat_key, "seat_key"),
    agent_id: requiredString(value.agent_id, "agent_id"),
    gate_bearing: requiredBoolean(value.gate_bearing, "gate_bearing"),
    required: requiredBoolean(value.required, "required"),
    reasoning_effort: requiredReasoningEffort(value.reasoning_effort, "reasoning_effort"),
    status: requiredStatus(value.status, "status"),
    started_at: requiredString(value.started_at, "started_at"),
    updated_at: requiredString(value.updated_at, "updated_at")
  };
  const issueId = optionalString(value.issue_id);
  if (issueId) {
    record.issue_id = issueId;
  }
  const completedAt = optionalString(value.completed_at);
  if (completedAt) {
    record.completed_at = completedAt;
  }
  const lastCheckpoint = optionalString(value.last_checkpoint);
  if (lastCheckpoint) {
    record.last_checkpoint = lastCheckpoint;
  }
  const lastError = parseSeatFailureError(value.last_error);
  if (lastError) {
    record.last_error = lastError;
  }
  return record;
}

function seatDefinitionsEqual(left: ActiveSeatDefinition[], right: ActiveSeatDefinition[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const normalize = (items: ActiveSeatDefinition[]): string[] => items.map((item) => JSON.stringify({
    seat: item.seat,
    role: item.role,
    gate_bearing: item.gate_bearing,
    required: item.required,
    reasoning_effort: item.reasoning_effort,
  })).sort();

  const leftItems = normalize(left);
  const rightItems = normalize(right);
  return leftItems.every((item, index) => item === rightItems[index]);
}

function activeSeatDispatchIdentityMatches(
  current: ActiveSeatDispatchFile,
  next: ActiveSeatDispatchIdentity
): boolean {
  return current.phase === next.phase
    && (current.issue_id ?? "") === (next.issue_id ?? "")
    && seatDefinitionsEqual(current.seats, next.seats);
}

export function normalizeSeatKey(seat: string): string {
  const normalized = seat
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "seat";
}

export function activeSeatDispatchPath(repoRoot: string, change: string): string {
  return path.join(changeDirPath(repoRoot, change), "control", "ACTIVE-SEAT-DISPATCH.json");
}

export function seatStateDir(repoRoot: string, change: string, dispatchId: string): string {
  return path.join(changeDirPath(repoRoot, change), "control", "seat-state", dispatchId);
}

export function seatStatePath(repoRoot: string, change: string, dispatchId: string, seatKey: string): string {
  return path.join(seatStateDir(repoRoot, change, dispatchId), `${seatKey}.json`);
}

export function isSeatFailureKind(value: string): value is SeatFailureKind {
  return SEAT_FAILURE_KINDS.has(value as SeatFailureKind);
}

export function isTerminalSeatStatus(status: SeatLifecycleStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function buildDispatchId(date = new Date()): string {
  const pad2 = (value: number): string => String(value).padStart(2, "0");
  return `DISPATCH-${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}T${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

export function readActiveSeatDispatch(repoRoot: string, change: string): ActiveSeatDispatchFile | null {
  const payload = readJson(activeSeatDispatchPath(repoRoot, change));
  if (Object.keys(payload).length === 0) {
    return null;
  }
  const seats = Array.isArray(payload.seats) ? payload.seats.map(parseActiveSeatDefinition) : [];
  if (seats.length === 0) {
    throw new Error("Active seat dispatch must include at least one seat.");
  }
  const record: ActiveSeatDispatchFile = {
    schema_version: 1,
    change: requiredString(payload.change, "change"),
    dispatch_id: requiredString(payload.dispatch_id, "dispatch_id"),
    phase: requiredPhase(payload.phase, "phase"),
    generated_at: requiredString(payload.generated_at, "generated_at"),
    barrier_mode: requiredBarrierMode(payload.barrier_mode, "barrier_mode"),
    packet_path: requiredString(payload.packet_path, "packet_path"),
    seats
  };
  const issueId = optionalString(payload.issue_id);
  if (issueId) {
    record.issue_id = issueId;
  }
  const handoffsPath = optionalString(payload.seat_handoffs_path);
  if (handoffsPath) {
    record.seat_handoffs_path = handoffsPath;
  }
  return record;
}

export function writeActiveSeatDispatch(repoRoot: string, change: string, state: ActiveSeatDispatchFile): void {
  writeJson(activeSeatDispatchPath(repoRoot, change), state as unknown as JsonRecord);
}

export function ensureActiveSeatDispatch(
  repoRoot: string,
  input: Omit<ActiveSeatDispatchFile, "dispatch_id" | "generated_at" | "schema_version">
): ActiveSeatDispatchFile {
  const next = planActiveSeatDispatch(repoRoot, input);
  writeActiveSeatDispatch(repoRoot, input.change, next);
  return next;
}

export function planActiveSeatDispatch(
  repoRoot: string,
  input: Omit<ActiveSeatDispatchFile, "dispatch_id" | "generated_at" | "schema_version">
): ActiveSeatDispatchFile {
  const current = readActiveSeatDispatch(repoRoot, input.change);
  const dispatchId = current && activeSeatDispatchIdentityMatches(current, input)
    ? current.dispatch_id
    : buildDispatchId();
  const next: ActiveSeatDispatchFile = {
    schema_version: 1,
    change: input.change,
    dispatch_id: dispatchId,
    phase: input.phase,
    generated_at: nowIso(),
    barrier_mode: input.barrier_mode,
    packet_path: input.packet_path,
    seats: input.seats
  };
  if (input.issue_id) {
    next.issue_id = input.issue_id;
  }
  if (input.seat_handoffs_path) {
    next.seat_handoffs_path = input.seat_handoffs_path;
  }
  return next;
}

export function readSeatStateRecord(filePath: string): SeatStateRecord | null {
  const payload = readJson(filePath);
  if (Object.keys(payload).length === 0) {
    return null;
  }
  return parseSeatStateRecord(payload);
}

export function writeSeatState(repoRoot: string, record: SeatStateRecord): string {
  const targetPath = seatStatePath(repoRoot, record.change, record.dispatch_id, record.seat_key);
  writeJson(targetPath, record as unknown as JsonRecord);
  return targetPath;
}

export function readSeatStatesForDispatch(repoRoot: string, change: string, dispatchId: string): SeatStateRecord[] {
  const targetDir = seatStateDir(repoRoot, change, dispatchId);
  if (!fs.existsSync(targetDir)) {
    return [];
  }
  return fs.readdirSync(targetDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => readSeatStateRecord(path.join(targetDir, name)))
    .filter((item): item is SeatStateRecord => item !== null);
}

export function summarizeSeatBarrier(
  manifest: ActiveSeatDispatchFile | null,
  seatStates: SeatStateRecord[]
): SeatBarrierSummary {
  const emptySummary: SeatBarrierSummary = {
    active: false,
    blocking: false,
    mode: "inactive",
    action: "",
    dispatch_id: "",
    phase: "",
    required_missing: [],
    required_running: [],
    required_failed: [],
    required_blocked: [],
    required_cancelled: [],
    required_completed: []
  };
  if (!manifest) {
    return emptySummary;
  }

  const stateBySeatKey = new Map<string, SeatStateRecord>();
  for (const state of seatStates) {
    stateBySeatKey.set(state.seat_key, state);
  }

  const summary: SeatBarrierSummary = {
    active: true,
    blocking: false,
    mode: manifest.barrier_mode,
    action: "",
    dispatch_id: manifest.dispatch_id,
    phase: manifest.phase,
    required_missing: [],
    required_running: [],
    required_failed: [],
    required_blocked: [],
    required_cancelled: [],
    required_completed: []
  };
  if (manifest.issue_id) {
    summary.issue_id = manifest.issue_id;
  }

  for (const seat of manifest.seats) {
    if (!seat.required || !seat.gate_bearing) {
      continue;
    }
    const state = stateBySeatKey.get(normalizeSeatKey(seat.seat));
    if (!state) {
      summary.required_missing.push(seat);
      continue;
    }
    if (WAITING_STATUSES.has(state.status)) {
      summary.required_running.push(state);
      continue;
    }
    if (state.status === "failed") {
      summary.required_failed.push(state);
      continue;
    }
    if (state.status === "blocked") {
      summary.required_blocked.push(state);
      continue;
    }
    if (state.status === "cancelled") {
      summary.required_cancelled.push(state);
      continue;
    }
    if (state.status === "completed") {
      summary.required_completed.push(state);
    }
  }

  if (summary.mode !== "enforce") {
    return summary;
  }
  if (
    summary.required_failed.length > 0
    || summary.required_blocked.length > 0
    || summary.required_cancelled.length > 0
  ) {
    summary.blocking = true;
    summary.action = "resolve_seat_failure";
    return summary;
  }
  if (summary.required_running.length > 0) {
    summary.blocking = true;
    summary.action = "wait_for_gate_seats";
  }
  return summary;
}

export function seatBarrierModeForGateMode(gateMode: "advisory" | "enforce"): SeatBarrierMode {
  return gateMode === "enforce" ? "enforce" : "observe";
}

export function buildSeatStateRecord(input: {
  change: string;
  dispatchId: string;
  phase: SeatPhase;
  issueId?: string;
  seat: string;
  agentId: string;
  gateBearing: boolean;
  required: boolean;
  reasoningEffort: SeatReasoningEffort;
  status: SeatLifecycleStatus;
  checkpoint?: string;
  error?: SeatStateError;
  previous?: SeatStateRecord | null;
}): SeatStateRecord {
  const timestamp = nowIso();
  const previous = input.previous ?? null;
  const record: SeatStateRecord = {
    schema_version: 1,
    change: input.change,
    dispatch_id: input.dispatchId,
    phase: input.phase,
    seat: input.seat,
    seat_key: normalizeSeatKey(input.seat),
    agent_id: input.agentId,
    gate_bearing: input.gateBearing,
    required: input.required,
    reasoning_effort: input.reasoningEffort,
    status: input.status,
    started_at: previous?.started_at ?? timestamp,
    updated_at: timestamp
  };
  if (input.issueId) {
    record.issue_id = input.issueId;
  }
  if (input.checkpoint || previous?.last_checkpoint) {
    record.last_checkpoint = input.checkpoint ?? previous?.last_checkpoint;
  }
  if (input.error) {
    record.last_error = input.error;
  }
  if (isTerminalSeatStatus(input.status)) {
    record.completed_at = timestamp;
  }
  return record;
}

export function assertTerminalOverwriteAllowed(previous: SeatStateRecord | null, allowOverwrite: boolean): void {
  if (!previous) {
    return;
  }
  if (isTerminalSeatStatus(previous.status) && !allowOverwrite) {
    throw new Error(
      `Seat \`${previous.seat}\` is already terminal with status \`${previous.status}\`; rerun with --allow-terminal-overwrite true to replace it.`
    );
  }
}
