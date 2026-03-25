#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
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


def parse_iso8601(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def stale_seconds_for_issue(issue: dict[str, Any]) -> float | None:
    updated_at = parse_iso8601(str(issue.get("updated_at", "")))
    if updated_at is None:
        return None
    return (datetime.now(timezone.utc) - updated_at.astimezone(timezone.utc)).total_seconds()


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


def render_reconcile_message(change: str, reconcile: dict[str, Any]) -> str:
    next_action = reconcile.get("next_action", "")
    issue_id = reconcile.get("recommended_issue_id", "")
    reason = reconcile.get("reason", "")

    if next_action == "dispatch_next_issue":
        return f"⚠️ 需要处理: {change} | 派发 {issue_id}"
    if next_action == "coordinator_review":
        return f"⚠️ 需要处理: {change} | {issue_id} 等待 review"
    if next_action == "verify_change":
        return f"⚠️ 需要处理: {change} | 可以 verify"
    if next_action == "resolve_blocker":
        return f"❌ 失败: {change} | {issue_id} blocked"
    return f"⚠️ 需要处理: {change} | {reason or next_action}"


def render_stale_message(change: str, issue_id: str, monitor: dict[str, Any], age_seconds: float) -> str:
    process_status = monitor.get("process", {}).get("status", "unknown")
    host_status = monitor.get("persistent_host", {}).get("status", "unknown")
    age_minutes = int(age_seconds // 60)

    if process_status == "missing":
        return f"⚠️ 需要处理: {change}/{issue_id} | {age_minutes}m 未更新且 worker 已退出"
    if host_status in {"missing", "ambiguous"}:
        return f"⚠️ 需要处理: {change}/{issue_id} | {age_minutes}m 未更新，托管状态异常"
    return f"⚠️ 需要处理: {change}/{issue_id} | {age_minutes}m 未更新，建议人工确认"


def dispatch_next_issue(repo_root: Path, change: str, issue_id: str) -> dict[str, Any]:
    create_payload = run_json(
        [
            sys.executable,
            ".codex/skills/openspec-dispatch-issue/scripts/create_worker_worktree.py",
            "--repo-root",
            ".",
            "--change",
            change,
            "--issue-id",
            issue_id,
        ],
        cwd=repo_root,
    )
    render_payload = run_json(
        [
            sys.executable,
            ".codex/skills/openspec-dispatch-issue/scripts/render_issue_dispatch.py",
            "--repo-root",
            ".",
            "--change",
            change,
            "--issue-id",
            issue_id,
        ],
        cwd=repo_root,
    )
    return {"create_worktree": create_payload, "render_dispatch": render_payload}


def snapshot_once(args: argparse.Namespace, repo_root: Path) -> dict[str, Any]:
    reconcile = run_json(
        [
            sys.executable,
            ".codex/skills/openspec-reconcile-change/scripts/reconcile_issue_progress.py",
            "--repo-root",
            ".",
            "--change",
            args.change,
        ],
        cwd=repo_root,
    )

    result: dict[str, Any] = {
        "checked_at": now_iso(),
        "change": args.change,
        "reconcile": reconcile,
    }

    if reconcile.get("next_action") == "wait_for_active_issue":
        active_issue_id = str(reconcile.get("recommended_issue_id", ""))
        active_issue = next((issue for issue in reconcile.get("issues", []) if issue.get("issue_id") == active_issue_id), {})
        age_seconds = stale_seconds_for_issue(active_issue)
        result["active_issue_age_seconds"] = age_seconds
        if age_seconds is not None and age_seconds >= args.stale_seconds:
            monitor = run_json(
                [
                    sys.executable,
                    ".codex/skills/openspec-monitor-worker/scripts/monitor_worker.py",
                    "--repo-root",
                    ".",
                    "--change",
                    args.change,
                    "--issue-id",
                    active_issue_id,
                ],
                cwd=repo_root,
            )
            result["stale_monitor"] = monitor
            result["notification_message"] = render_stale_message(args.change, active_issue_id, monitor, age_seconds)
    else:
        result["notification_message"] = render_reconcile_message(args.change, reconcile)
        if args.auto_dispatch_next and reconcile.get("next_action") == "dispatch_next_issue":
            result["auto_dispatch"] = dispatch_next_issue(
                repo_root=repo_root,
                change=args.change,
                issue_id=str(reconcile.get("recommended_issue_id", "")),
            )

    return result


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    config = load_issue_mode_config(repo_root)
    heartbeat_config = config["coordinator_heartbeat"]
    interval_seconds = args.interval_seconds or int(heartbeat_config["interval_seconds"])
    stale_seconds = args.stale_seconds or int(heartbeat_config["stale_seconds"])
    notify_topic = args.notify_topic or str(heartbeat_config["notify_topic"])
    state_path = state_path_for_change(repo_root, args.change)
    state = load_state(state_path)
    iteration = 0

    while True:
        args.interval_seconds = interval_seconds
        args.stale_seconds = stale_seconds
        snapshot = snapshot_once(args, repo_root)
        event_key = json.dumps(
            {
                "next_action": snapshot.get("reconcile", {}).get("next_action"),
                "recommended_issue_id": snapshot.get("reconcile", {}).get("recommended_issue_id"),
                "reason": snapshot.get("reconcile", {}).get("reason"),
                "notification_message": snapshot.get("notification_message", ""),
                "auto_dispatch": snapshot.get("auto_dispatch", {}),
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
