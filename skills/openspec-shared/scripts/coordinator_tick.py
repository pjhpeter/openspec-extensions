#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SHARED_SCRIPTS = Path(__file__).resolve().parent
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from issue_mode_common import load_issue_mode_config, now_iso  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--stale-seconds", type=int)
    parser.add_argument("--auto-dispatch-next", action="store_true")
    parser.add_argument("--auto-launch-next", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def run_json(cmd: list[str], cwd: Path) -> dict[str, Any]:
    process = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
    if process.returncode != 0:
        raise RuntimeError(process.stderr.strip() or process.stdout.strip() or "command failed")
    return json.loads(process.stdout)


def parse_iso8601(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def stale_seconds_for_issue(issue: dict[str, Any]) -> float | None:
    updated_at = parse_iso8601(str(issue.get("updated_at", "")))
    if updated_at is None:
        return None
    return (datetime.now(timezone.utc) - updated_at.astimezone(timezone.utc)).total_seconds()


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


def dispatch_next_issue(repo_root: Path, change: str, issue_id: str, dry_run: bool) -> dict[str, Any]:
    create_command = [
        sys.executable,
        ".codex/skills/openspec-dispatch-issue/scripts/create_worker_worktree.py",
        "--repo-root",
        ".",
        "--change",
        change,
        "--issue-id",
        issue_id,
    ]
    if dry_run:
        create_command.append("--dry-run")
    create_payload = run_json(create_command, cwd=repo_root)
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
            *(["--dry-run"] if dry_run else []),
        ],
        cwd=repo_root,
    )
    return {"create_worktree": create_payload, "render_dispatch": render_payload}


def worker_status(repo_root: Path, change: str, issue_id: str, dry_run: bool) -> dict[str, Any]:
    command = [
        sys.executable,
        ".codex/skills/openspec-shared/scripts/worker_status.py",
        "--repo-root",
        ".",
        "--change",
        change,
        "--issue-id",
        issue_id,
    ]
    if dry_run:
        command.append("--dry-run")
    return run_json(command, cwd=repo_root)


def launch_worker(repo_root: Path, change: str, issue_id: str, dry_run: bool) -> dict[str, Any]:
    command = [
        sys.executable,
        ".codex/skills/openspec-shared/scripts/worker_launch.py",
        "--repo-root",
        ".",
        "--change",
        change,
        "--issue-id",
        issue_id,
    ]
    if dry_run:
        command.append("--dry-run")
    return run_json(command, cwd=repo_root)


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    config = load_issue_mode_config(repo_root)
    heartbeat_config = config["coordinator_heartbeat"]
    stale_seconds = args.stale_seconds or int(heartbeat_config["stale_seconds"])
    auto_dispatch_next = args.auto_dispatch_next or bool(heartbeat_config["auto_dispatch_next"])
    auto_launch_next = args.auto_launch_next or bool(heartbeat_config["auto_launch_next"])

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
        "decision": {
            "action": "noop",
            "reason": reconcile.get("reason", ""),
        },
        "effective_config": {
            "stale_seconds": stale_seconds,
            "auto_dispatch_next": auto_dispatch_next,
            "auto_launch_next": auto_launch_next,
            "dry_run": args.dry_run,
            "config_path": config["config_path"],
        },
    }

    next_action = str(reconcile.get("next_action", ""))
    issue_id = str(reconcile.get("recommended_issue_id", ""))

    if next_action == "wait_for_active_issue" and issue_id:
        active_issue = next((item for item in reconcile.get("issues", []) if item.get("issue_id") == issue_id), {})
        age_seconds = stale_seconds_for_issue(active_issue)
        result["active_issue_age_seconds"] = age_seconds
        status_payload = worker_status(repo_root, args.change, issue_id, args.dry_run)
        result["active_issue_status"] = status_payload
        if age_seconds is not None and age_seconds >= stale_seconds:
            result["notification_message"] = render_stale_message(
                args.change,
                issue_id,
                status_payload.get("monitor", {}),
                age_seconds,
            )
            result["decision"] = {
                "action": "wait_stale_active_issue",
                "issue_id": issue_id,
                "reason": status_payload.get("reason", ""),
            }
        elif status_payload.get("status") in {"failed", "orphaned"}:
            result["notification_message"] = (
                f"⚠️ 需要处理: {args.change}/{issue_id} | {status_payload.get('reason', status_payload['status'])}"
            )
            result["decision"] = {
                "action": "inspect_active_issue",
                "issue_id": issue_id,
                "reason": status_payload.get("reason", ""),
            }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if next_action == "dispatch_next_issue" and issue_id:
        candidate_status = worker_status(repo_root, args.change, issue_id, args.dry_run)
        result["candidate_issue_status"] = candidate_status

        if candidate_status.get("status") in {"launching", "running"}:
            result["decision"] = {
                "action": "wait_existing_worker",
                "issue_id": issue_id,
                "reason": candidate_status.get("reason", ""),
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return

        if not candidate_status.get("launchable", True):
            result["decision"] = {
                "action": "manual_intervention_required",
                "issue_id": issue_id,
                "reason": candidate_status.get("reason", ""),
            }
            result["notification_message"] = (
                f"⚠️ 需要处理: {args.change}/{issue_id} | {candidate_status.get('reason', '无法自动启动')}"
            )
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return

        if auto_launch_next:
            launch_payload = launch_worker(repo_root, args.change, issue_id, args.dry_run)
            result["launch"] = launch_payload
            result["decision"] = {
                "action": "launch_next_worker",
                "issue_id": issue_id,
                "reason": launch_payload.get("status", ""),
            }
            result["notification_message"] = (
                f"✅ 完成: {args.change} | 已{'预演' if args.dry_run else ''}启动 {issue_id}"
            )
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return

        if auto_dispatch_next:
            dispatch_payload = dispatch_next_issue(repo_root, args.change, issue_id, args.dry_run)
            result["dispatch"] = dispatch_payload
            result["decision"] = {
                "action": "dispatch_next_issue",
                "issue_id": issue_id,
                "reason": "dispatch_prepared",
            }
            result["notification_message"] = (
                f"✅ 完成: {args.change} | 已{'预演' if args.dry_run else ''}准备 {issue_id} dispatch"
            )
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return

    if next_action != "wait_for_active_issue":
        result["notification_message"] = render_reconcile_message(args.change, reconcile)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
