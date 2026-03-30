#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from coordinator_heartbeat_runtime_common import (
    heartbeat_log_path,
    heartbeat_process_matches,
    heartbeat_state_path,
    iso_mtime,
    resolve_session_name,
    screen_matches,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--session-name", default="")
    return parser.parse_args()


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def read_log_tail(path: Path, max_lines: int = 20) -> list[str]:
    if not path.exists():
        return []
    return path.read_text(errors="ignore").splitlines()[-max_lines:]


def extract_control_gate_summary(state_payload: dict) -> dict:
    if not isinstance(state_payload, dict):
        return {}
    last_snapshot = state_payload.get("last_snapshot", {})
    if not isinstance(last_snapshot, dict):
        return {}
    reconcile = last_snapshot.get("reconcile", {})
    if not isinstance(reconcile, dict):
        return {}
    control = reconcile.get("control", {})
    if not isinstance(control, dict):
        return {}
    gate = control.get("gate", {})
    if not isinstance(gate, dict):
        return {}
    return {
        "mode": gate.get("mode", ""),
        "active": bool(gate.get("active", False)),
        "enforced": bool(gate.get("enforced", False)),
        "action": gate.get("action", ""),
        "recommended_issue_id": gate.get("recommended_issue_id", ""),
        "reason": gate.get("reason", ""),
    }


def build_summary(change: str, status: str, state_payload: dict, control_gate: dict) -> str:
    parts = [f"{change}: {status}"]

    if isinstance(state_payload, dict):
        snapshot = state_payload.get("last_snapshot", {})
        if isinstance(snapshot, dict):
            reconcile = snapshot.get("reconcile", {})
            if isinstance(reconcile, dict):
                next_action = str(reconcile.get("next_action", "")).strip()
                recommended_issue_id = str(reconcile.get("recommended_issue_id", "")).strip()
                if next_action:
                    next_part = f"next={next_action}"
                    if recommended_issue_id:
                        next_part += f"({recommended_issue_id})"
                    parts.append(next_part)

    if isinstance(control_gate, dict) and control_gate.get("active"):
        action = str(control_gate.get("action", "")).strip() or "none"
        mode = str(control_gate.get("mode", "")).strip() or "unknown"
        gate_part = f"gate={action}[{mode}]"
        if control_gate.get("enforced"):
            gate_part += " enforced"
        parts.append(gate_part)

    return " | ".join(parts)


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    session_name = resolve_session_name(args.change, args.session_name)
    screen_info = screen_matches(session_name)
    process_matches = heartbeat_process_matches(repo_root, args.change, session_name)
    log_path = heartbeat_log_path(repo_root, args.change)
    state_path = heartbeat_state_path(repo_root, args.change)
    state_payload = read_json(state_path)
    control_gate = extract_control_gate_summary(state_payload)
    status = "running" if screen_info["matches"] or process_matches else "stopped"

    result = {
        "status": status,
        "change": args.change,
        "session_name": session_name,
        "screen": {
            "available": screen_info["available"],
            "status": screen_info["status"],
            "matches": screen_info["matches"],
        },
        "process_matches": process_matches,
        "log_path": str(log_path),
        "log_exists": log_path.exists(),
        "log_updated_at": iso_mtime(log_path),
        "log_tail": read_log_tail(log_path, max_lines=10),
        "state_path": str(state_path),
        "state_exists": state_path.exists(),
        "state_updated_at": iso_mtime(state_path),
        "control_gate": control_gate,
        "summary": build_summary(args.change, status, state_payload, control_gate),
        "state": state_payload,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
