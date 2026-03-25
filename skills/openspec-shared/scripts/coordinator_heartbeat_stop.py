#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from coordinator_heartbeat_runtime_common import (
    heartbeat_process_matches,
    heartbeat_process_pids,
    resolve_session_name,
    run_command,
    screen_matches,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--session-name", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    session_name = resolve_session_name(args.change, args.session_name)
    before = screen_matches(session_name)
    if not before["available"]:
        raise SystemExit(before["error"] or "screen is not available")

    stopped = False
    if before["matches"]:
        code, stdout, stderr = run_command(["screen", "-S", session_name, "-X", "quit"])
        if code != 0:
            raise SystemExit(stderr.strip() or stdout.strip() or "failed to stop screen session")
        time.sleep(0.2)
        stopped = True

    pids = heartbeat_process_pids(repo_root, args.change, session_name)
    if pids:
        run_command(["kill", *pids])
        time.sleep(0.2)
        remaining = heartbeat_process_pids(repo_root, args.change, session_name)
        if remaining:
            run_command(["kill", "-9", *remaining])
            time.sleep(0.2)

    after = screen_matches(session_name)
    result = {
        "status": "stopped" if stopped and not after["matches"] else "already_stopped",
        "change": args.change,
        "session_name": session_name,
        "screen_matches_before": before["matches"],
        "screen_matches_after": after["matches"],
        "process_matches": heartbeat_process_matches(repo_root, args.change, session_name),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
