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


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    session_name = resolve_session_name(args.change, args.session_name)
    screen_info = screen_matches(session_name)
    process_matches = heartbeat_process_matches(repo_root, args.change, session_name)
    log_path = heartbeat_log_path(repo_root, args.change)
    state_path = heartbeat_state_path(repo_root, args.change)
    state_payload = read_json(state_path)

    result = {
        "status": "running" if screen_info["matches"] or process_matches else "stopped",
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
        "state": state_payload,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
