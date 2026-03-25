#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from coordinator_heartbeat_runtime_common import (
    build_runner_args,
    build_screen_shell_command,
    heartbeat_log_path,
    heartbeat_process_matches,
    heartbeat_runner_path,
    resolve_session_name,
    run_command,
    screen_matches,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--session-name", default="")
    parser.add_argument("--interval-seconds", type=int)
    parser.add_argument("--stale-seconds", type=int)
    parser.add_argument("--notify-topic", default="")
    parser.add_argument("--auto-dispatch-next", action="store_true")
    parser.add_argument("--restart", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    runner = heartbeat_runner_path(repo_root)
    if not runner.exists():
        raise SystemExit(f"Heartbeat runner not found: {runner}")

    session_name = resolve_session_name(args.change, args.session_name)
    before = screen_matches(session_name)
    if not before["available"]:
        raise SystemExit(before["error"] or "screen is not available")

    log_path = heartbeat_log_path(repo_root, args.change)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    stopped_existing = False
    if before["matches"]:
        if not args.restart:
            result = {
                "status": "already_running",
                "change": args.change,
                "session_name": session_name,
                "log_path": str(log_path),
                "screen_matches": before["matches"],
                "process_matches": heartbeat_process_matches(repo_root, args.change, session_name),
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return
        run_command(["screen", "-S", session_name, "-X", "quit"])
        time.sleep(0.2)
        stopped_existing = True

    runner_args = build_runner_args(
        repo_root=repo_root,
        change=args.change,
        interval_seconds=args.interval_seconds,
        stale_seconds=args.stale_seconds,
        notify_topic=args.notify_topic,
        auto_dispatch_next=args.auto_dispatch_next,
    )
    shell_command = build_screen_shell_command(repo_root, runner_args, log_path)
    code, stdout, stderr = run_command(["screen", "-dmS", session_name, "bash", "-lc", shell_command])
    if code != 0:
        raise SystemExit(stderr.strip() or stdout.strip() or "failed to start screen session")

    time.sleep(0.2)
    after = screen_matches(session_name)
    result = {
        "status": "started" if after["matches"] else "unknown",
        "change": args.change,
        "session_name": session_name,
        "restarted": stopped_existing,
        "log_path": str(log_path),
        "screen_matches": after["matches"],
        "process_matches": heartbeat_process_matches(repo_root, args.change, session_name),
        "command": runner_args,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
