#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

SHARED_SCRIPTS = Path(__file__).resolve().parent
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from issue_mode_common import (  # noqa: E402
    display_path,
    issue_progress_path,
    load_issue_mode_config,
    now_iso,
    run_artifact_path,
    worker_session_state_path,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--issue-id", required=True)
    parser.add_argument("--recent-limit", type=int, default=8)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def run_json(cmd: list[str], cwd: Path) -> dict[str, Any]:
    process = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
    if process.returncode != 0:
        raise RuntimeError(process.stderr.strip() or process.stdout.strip() or "command failed")
    return json.loads(process.stdout)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def parse_iso8601(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def monitor_worker(
    repo_root: Path,
    change: str,
    issue_id: str,
    session_name: str,
    recent_limit: int,
) -> dict[str, Any]:
    command = [
        sys.executable,
        ".codex/skills/openspec-monitor-worker/scripts/monitor_worker.py",
        "--repo-root",
        ".",
        "--change",
        change,
        "--issue-id",
        issue_id,
        "--recent-limit",
        str(recent_limit),
    ]
    if session_name:
        command.extend(["--session-name", session_name])
    return run_json(command, cwd=repo_root)


def determine_status(
    session_payload: dict[str, Any],
    progress_payload: dict[str, Any],
    monitor_payload: dict[str, Any],
) -> tuple[str, str]:
    progress_status = str(progress_payload.get("status", "")).strip()
    host_status = str(monitor_payload.get("persistent_host", {}).get("status", ""))
    process_status = str(monitor_payload.get("process", {}).get("status", ""))
    session_file_status = str(monitor_payload.get("session_file", {}).get("status", ""))
    worktree_payload = monitor_payload.get("worktree_state", monitor_payload.get("worktree", {}))
    if not isinstance(worktree_payload, dict):
        worktree_payload = {}
    worktree_status = str(worktree_payload.get("status", ""))
    alive = any(
        status == "active"
        for status in (host_status, process_status)
    ) or session_file_status == "found"

    if progress_status == "completed":
        return "completed", "issue progress 已完成。"
    if progress_status == "blocked":
        return "blocked", str(progress_payload.get("blocker", "")).strip() or "issue progress 标记为 blocked。"
    if progress_status == "in_progress":
        return "running", "issue progress 已进入 in_progress。"

    if alive:
        if str(session_payload.get("status", "")) == "launching":
            return "launching", "已检测到 worker 启动迹象，等待 issue progress 确认。"
        return "running", "检测到 worker 仍有活动信号。"

    session_status = str(session_payload.get("status", "")).strip()
    if session_status == "launching":
        deadline = parse_iso8601(str(session_payload.get("confirmation_deadline_at", "")))
        if deadline is not None and datetime.now().astimezone() > deadline.astimezone():
            return "failed", "worker 启动确认超时，且没有活动信号。"
        return "launching", "worker 处于启动宽限期内。"
    if session_status == "running":
        if worktree_status == "dirty" or session_file_status == "found":
            return "orphaned", "worker 失去进程/host 信号，但已有中间痕迹，需人工接管。"
        return "failed", "worker 运行状态丢失且没有继续活动。"
    if session_status in {"failed", "orphaned"}:
        return session_status, str(session_payload.get("failure_reason", "")).strip() or "沿用已有 launch 状态。"

    if worktree_status == "dirty" or session_file_status == "found":
        return "orphaned", "没有 launch lease，但发现 worker 痕迹。"

    return "pending", "尚未发现 worker 运行或 issue progress。"


def sync_worker_session(
    session_path: Path,
    session_payload: dict[str, Any],
    coordinator_status: str,
    progress_payload: dict[str, Any],
    dry_run: bool,
) -> dict[str, Any]:
    if not session_payload:
        return {}

    updated = dict(session_payload)
    if coordinator_status in {"completed", "blocked"}:
        updated["status"] = "exited"
        updated["outcome"] = coordinator_status
        if not updated.get("confirmed_at"):
            updated["confirmed_at"] = str(progress_payload.get("updated_at", "")).strip() or now_iso()
    else:
        updated["status"] = coordinator_status
        if coordinator_status == "running" and not updated.get("confirmed_at"):
            updated["confirmed_at"] = str(progress_payload.get("updated_at", "")).strip() or now_iso()

    if coordinator_status in {"running", "launching", "completed", "blocked"}:
        updated["last_seen_at"] = str(progress_payload.get("updated_at", "")).strip() or now_iso()
        if coordinator_status in {"running", "launching"}:
            updated["failure_reason"] = ""
    elif coordinator_status in {"failed", "orphaned"}:
        updated["failure_reason"] = updated.get("failure_reason") or coordinator_status

    if updated != session_payload and not dry_run:
        write_json(session_path, updated)
    return updated


def cooldown_expired(session_payload: dict[str, Any], cooldown_seconds: int) -> bool:
    if cooldown_seconds <= 0:
        return True
    reference = (
        str(session_payload.get("last_seen_at", "")).strip()
        or str(session_payload.get("confirmed_at", "")).strip()
        or str(session_payload.get("launched_at", "")).strip()
    )
    reference_at = parse_iso8601(reference)
    if reference_at is None:
        return True
    return datetime.now().astimezone() >= reference_at.astimezone() + timedelta(seconds=cooldown_seconds)


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    config = load_issue_mode_config(repo_root)
    session_path = worker_session_state_path(repo_root, args.change, args.issue_id)
    progress_path = issue_progress_path(repo_root, args.change, args.issue_id)
    session_payload = read_json(session_path)
    progress_payload = read_json(progress_path)
    run_id = str(progress_payload.get("run_id", "")).strip() or str(session_payload.get("run_id", "")).strip()
    run_path = run_artifact_path(repo_root, args.change, run_id) if run_id else None
    run_payload = read_json(run_path) if run_path and run_path.exists() else {}

    monitor_payload = monitor_worker(
        repo_root=repo_root,
        change=args.change,
        issue_id=args.issue_id,
        session_name=str(session_payload.get("session_name", "")).strip(),
        recent_limit=args.recent_limit,
    )
    coordinator_status, reason = determine_status(session_payload, progress_payload, monitor_payload)
    synced_session = sync_worker_session(
        session_path=session_path,
        session_payload=session_payload,
        coordinator_status=coordinator_status,
        progress_payload=progress_payload,
        dry_run=args.dry_run,
    )
    attempt = int(synced_session.get("attempt", session_payload.get("attempt", 0)) or 0)
    max_launch_retries = int(config["worker_launcher"]["max_launch_retries"])
    launch_cooldown_seconds = int(config["worker_launcher"]["launch_cooldown_seconds"])
    can_relaunch = (
        coordinator_status == "failed"
        and attempt <= max_launch_retries
        and cooldown_expired(synced_session or session_payload, launch_cooldown_seconds)
    )
    launchable = coordinator_status == "pending" or can_relaunch

    payload = {
        "change": args.change,
        "issue_id": args.issue_id,
        "status": coordinator_status,
        "reason": reason,
        "launchable": launchable,
        "can_relaunch": can_relaunch,
        "attempt": attempt,
        "max_launch_retries": max_launch_retries,
        "launch_cooldown_seconds": launch_cooldown_seconds,
        "worker_session_path": display_path(repo_root, session_path),
        "worker_session": synced_session or session_payload,
        "progress_path": display_path(repo_root, progress_path),
        "progress": progress_payload,
        "run_path": display_path(repo_root, run_path) if run_path else "",
        "run": run_payload,
        "monitor": monitor_payload,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
