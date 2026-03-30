#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

SHARED_SCRIPTS = Path(__file__).resolve().parent
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from issue_mode_common import load_issue_mode_config  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--interval-seconds", type=int)
    parser.add_argument("--stale-seconds", type=int)
    parser.add_argument("--notify-topic", default="")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--max-iterations", type=int, default=0)
    parser.add_argument("--auto-dispatch-next", action="store_true")
    parser.add_argument("--auto-launch-next", action="store_true")
    parser.add_argument("--auto-accept-review", action="store_true")
    parser.add_argument("--auto-verify-change", action="store_true")
    return parser.parse_args()


def run_json(cmd: list[str], cwd: Path) -> dict[str, Any]:
    process = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
    if process.returncode != 0:
        raise RuntimeError(process.stderr.strip() or process.stdout.strip() or "command failed")
    return json.loads(process.stdout)


def state_path_for_change(repo_root: Path, change: str) -> Path:
    runs_dir = repo_root / "openspec" / "changes" / change / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    return runs_dir / "COORDINATOR-HEARTBEAT.state.json"


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def save_state(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def send_ntfy(topic: str, message: str) -> dict[str, Any]:
    if not topic:
        return {"sent": False, "reason": "notify_topic_missing", "message": message}

    request = urllib.request.Request(
        f"https://ntfy.sh/{topic}",
        data=message.encode("utf-8"),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read().decode("utf-8", errors="ignore").strip()
    except urllib.error.URLError as error:
        return {"sent": False, "reason": str(error), "message": message}

    return {"sent": True, "message": message, "response": body}


def snapshot_once(args: argparse.Namespace, repo_root: Path) -> dict[str, Any]:
    command = [
        sys.executable,
        ".codex/skills/openspec-shared/scripts/coordinator_tick.py",
        "--repo-root",
        ".",
        "--change",
        args.change,
    ]
    if args.stale_seconds:
        command.extend(["--stale-seconds", str(args.stale_seconds)])
    if args.auto_dispatch_next:
        command.append("--auto-dispatch-next")
    if args.auto_launch_next:
        command.append("--auto-launch-next")
    if args.auto_accept_review:
        command.append("--auto-accept-review")
    if args.auto_verify_change:
        command.append("--auto-verify-change")
    return run_json(
        command,
        cwd=repo_root,
    )


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    config = load_issue_mode_config(repo_root)
    heartbeat_config = config["coordinator_heartbeat"]
    interval_seconds = args.interval_seconds or int(heartbeat_config["interval_seconds"])
    stale_seconds = args.stale_seconds or int(heartbeat_config["stale_seconds"])
    notify_topic = args.notify_topic or str(heartbeat_config["notify_topic"])
    auto_dispatch_next = args.auto_dispatch_next or bool(heartbeat_config["auto_dispatch_next"])
    auto_launch_next = args.auto_launch_next or bool(heartbeat_config["auto_launch_next"])
    auto_accept_review = args.auto_accept_review or bool(heartbeat_config["auto_accept_review"])
    auto_verify_change = args.auto_verify_change or bool(heartbeat_config["auto_verify_change"])
    state_path = state_path_for_change(repo_root, args.change)
    state = load_state(state_path)
    iteration = 0

    while True:
        args.interval_seconds = interval_seconds
        args.stale_seconds = stale_seconds
        args.auto_dispatch_next = auto_dispatch_next
        args.auto_launch_next = auto_launch_next
        args.auto_accept_review = auto_accept_review
        args.auto_verify_change = auto_verify_change
        snapshot = snapshot_once(args, repo_root)
        event_key = json.dumps(
            {
                "next_action": snapshot.get("reconcile", {}).get("next_action"),
                "recommended_issue_id": snapshot.get("reconcile", {}).get("recommended_issue_id"),
                "decision": snapshot.get("decision", {}),
                "notification_message": snapshot.get("notification_message", ""),
                "dispatch": snapshot.get("dispatch", {}),
                "launch": snapshot.get("launch", {}),
            },
            ensure_ascii=False,
            sort_keys=True,
        )

        notification = {"sent": False, "reason": "no_state_change"}
        if snapshot.get("notification_message") and event_key != state.get("last_event_key"):
            notification = send_ntfy(notify_topic, str(snapshot["notification_message"]))
            state = {
                "last_checked_at": snapshot["checked_at"],
                "last_event_key": event_key,
                "last_notification": notification,
                "last_snapshot": snapshot,
            }
            save_state(state_path, state)
        else:
            state = {
                "last_checked_at": snapshot["checked_at"],
                "last_event_key": state.get("last_event_key", ""),
                "last_notification": state.get("last_notification", notification),
                "last_snapshot": snapshot,
            }
            save_state(state_path, state)

        snapshot["notification"] = notification
        snapshot["effective_config"] = {
            "interval_seconds": interval_seconds,
            "stale_seconds": stale_seconds,
            "notify_topic": notify_topic,
            "auto_dispatch_next": auto_dispatch_next,
            "auto_launch_next": auto_launch_next,
            "auto_accept_review": auto_accept_review,
            "auto_verify_change": auto_verify_change,
            "rra_gate_mode": config.get("rra", {}).get("gate_mode", "advisory"),
            "config_path": config["config_path"],
        }
        snapshot["state_path"] = str(state_path.relative_to(repo_root))
        print(json.dumps(snapshot, ensure_ascii=False, indent=2))

        iteration += 1
        if args.once:
            break
        if args.max_iterations > 0 and iteration >= args.max_iterations:
            break
        time.sleep(max(interval_seconds, 1))


if __name__ == "__main__":
    main()
