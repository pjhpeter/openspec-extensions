#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

SHARED_SCRIPTS = Path(__file__).resolve().parent
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from issue_mode_common import (  # noqa: E402
    default_worker_run_id,
    display_path,
    load_issue_mode_config,
    now_iso,
    worker_exec_log_path,
    worker_last_message_path,
    worker_session_name,
    worker_session_state_path,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--issue-id", required=True)
    parser.add_argument("--run-id", default="")
    parser.add_argument("--session-name", default="")
    parser.add_argument("--host-kind", choices=["screen", "tmux", "none"])
    parser.add_argument("--force-relaunch", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def run_command(cmd: list[str], cwd: Path | None = None) -> tuple[int, str, str]:
    try:
        process = subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True)
    except FileNotFoundError as error:
        return 127, "", str(error)
    return process.returncode, process.stdout, process.stderr


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


def is_active_launch(payload: dict[str, Any]) -> bool:
    status = str(payload.get("status", ""))
    if status == "running":
        return True
    if status != "launching":
        return False
    deadline = parse_iso8601(str(payload.get("confirmation_deadline_at", "")))
    if deadline is None:
        return True
    return datetime.now().astimezone() <= deadline.astimezone()


def shell_join(items: list[str]) -> str:
    return " ".join(shlex.quote(item) for item in items)


def build_codex_exec_args(
    config: dict[str, Any],
    repo_root: Path,
    worktree: Path,
    last_message_path: Path,
) -> list[str]:
    launcher = config["worker_launcher"]
    args = [
        str(launcher["codex_bin"]),
        "exec",
        "-C",
        str(worktree),
        "--add-dir",
        str(repo_root),
        "-o",
        str(last_message_path),
    ]
    if launcher["json_output"]:
        args.append("--json")
    if launcher["bypass_approvals"]:
        args.append("--dangerously-bypass-approvals-and-sandbox")
    else:
        args.extend(["-s", str(launcher["sandbox_mode"])])
    args.append("-")
    return args


def build_worker_shell_command(
    repo_root: Path,
    dispatch_path: Path,
    codex_exec_args: list[str],
    log_path: Path,
) -> str:
    return (
        f"cd {shlex.quote(str(repo_root))} && "
        f"cat {shlex.quote(str(dispatch_path))} | "
        f"{shell_join(codex_exec_args)}"
        f" >> {shlex.quote(str(log_path))} 2>&1"
    )


def start_persistent_session(host_kind: str, session_name: str, shell_command: str, repo_root: Path) -> dict[str, Any]:
    if host_kind == "screen":
        code, stdout, stderr = run_command(["screen", "-dmS", session_name, "bash", "-lc", shell_command], cwd=repo_root)
        return {"ok": code == 0, "error": stderr.strip() or stdout.strip(), "command": shell_command}
    if host_kind == "tmux":
        code, stdout, stderr = run_command(["tmux", "new-session", "-d", "-s", session_name, shell_command], cwd=repo_root)
        return {"ok": code == 0, "error": stderr.strip() or stdout.strip(), "command": shell_command}

    try:
        process = subprocess.Popen(
            ["bash", "-lc", shell_command],
            cwd=str(repo_root),
            start_new_session=True,
        )
    except FileNotFoundError as error:
        return {"ok": False, "error": str(error), "command": shell_command}
    return {"ok": True, "pid": process.pid, "command": shell_command}


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    config = load_issue_mode_config(repo_root)
    host_kind = args.host_kind or str(config["persistent_host"]["kind"])
    session_name = args.session_name.strip() or worker_session_name(config, args.change, args.issue_id)
    run_id = args.run_id.strip() or default_worker_run_id(args.issue_id)
    session_path = worker_session_state_path(repo_root, args.change, args.issue_id)
    existing = read_json(session_path)

    if existing and is_active_launch(existing) and not args.force_relaunch:
        payload = {
            "status": "already_running",
            "change": args.change,
            "issue_id": args.issue_id,
            "run_id": existing.get("run_id", run_id),
            "session_name": existing.get("session_name", session_name),
            "worker_session_path": display_path(repo_root, session_path),
            "worker_session": existing,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    create_args = [
        sys.executable,
        ".codex/skills/openspec-dispatch-issue/scripts/create_worker_worktree.py",
        "--repo-root",
        ".",
        "--change",
        args.change,
        "--issue-id",
        args.issue_id,
    ]
    if args.dry_run:
        create_args.append("--dry-run")
    create_payload = run_json(create_args, cwd=repo_root)
    worktree = Path(str(create_payload["worktree"])).resolve()

    render_args = [
        sys.executable,
        ".codex/skills/openspec-dispatch-issue/scripts/render_issue_dispatch.py",
        "--repo-root",
        ".",
        "--change",
        args.change,
        "--issue-id",
        args.issue_id,
        "--run-id",
        run_id,
        "--session-name",
        session_name,
    ]
    if args.dry_run:
        render_args.append("--dry-run")
    render_payload = run_json(render_args, cwd=repo_root)
    dispatch_path = (repo_root / str(render_payload["dispatch_path"])).resolve()
    log_path = worker_exec_log_path(repo_root, args.change, run_id)
    last_message_path = worker_last_message_path(repo_root, args.change, run_id)
    codex_exec_args = build_codex_exec_args(config, repo_root, worktree, last_message_path)
    shell_command = build_worker_shell_command(repo_root, dispatch_path, codex_exec_args, log_path)
    attempt = int(existing.get("attempt", 0) or 0) + 1
    launched_at = datetime.now().astimezone()
    confirmation_deadline_at = launched_at + timedelta(seconds=int(config["worker_launcher"]["start_grace_seconds"]))

    session_payload = {
        "change": args.change,
        "issue_id": args.issue_id,
        "run_id": run_id,
        "session_name": session_name,
        "host_kind": host_kind,
        "status": "launching",
        "attempt": attempt,
        "dispatch_path": display_path(repo_root, dispatch_path),
        "worktree": display_path(repo_root, worktree),
        "log_path": display_path(repo_root, log_path),
        "last_message_path": display_path(repo_root, last_message_path),
        "launched_at": launched_at.isoformat(timespec="seconds"),
        "confirmation_deadline_at": confirmation_deadline_at.isoformat(timespec="seconds"),
        "confirmed_at": "",
        "last_seen_at": "",
        "failure_reason": "",
        "config_path": config["config_path"],
    }

    result: dict[str, Any] = {
        "status": "dry_run" if args.dry_run else "started",
        "change": args.change,
        "issue_id": args.issue_id,
        "run_id": run_id,
        "session_name": session_name,
        "dispatch": render_payload,
        "worktree": create_payload,
        "worker_session_path": display_path(repo_root, session_path),
        "worker_session": session_payload,
        "dry_run": args.dry_run,
        "launch_command": shell_command,
    }

    if args.dry_run:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    write_json(session_path, session_payload)
    launch_result = start_persistent_session(host_kind, session_name, shell_command, repo_root)
    if not launch_result.get("ok"):
        session_payload["status"] = "failed"
        session_payload["failure_reason"] = str(launch_result.get("error", "launch_failed"))
        session_payload["last_seen_at"] = now_iso()
        write_json(session_path, session_payload)
        result["status"] = "failed"
        result["launch_error"] = session_payload["failure_reason"]
        result["worker_session"] = session_payload
        print(json.dumps(result, ensure_ascii=False, indent=2))
        raise SystemExit(1)

    write_json(session_path, session_payload)
    result["host_start"] = launch_result
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
