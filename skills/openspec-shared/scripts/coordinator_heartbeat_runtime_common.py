#!/usr/bin/env python3
from __future__ import annotations

import re
import shlex
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

LOG_FILE_NAME = "COORDINATOR-HEARTBEAT.exec.log"
STATE_FILE_NAME = "COORDINATOR-HEARTBEAT.state.json"
SESSION_PREFIX = "opsx-heartbeat"


def run_command(cmd: list[str], cwd: Path | None = None) -> tuple[int, str, str]:
    process = subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True)
    return process.returncode, process.stdout, process.stderr


def slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip(".-_")
    return slug or "change"


def resolve_session_name(change: str, session_name: str = "") -> str:
    if session_name.strip():
        return session_name.strip()
    return f"{SESSION_PREFIX}-{slugify(change)}"


def heartbeat_runner_path(repo_root: Path) -> Path:
    return repo_root / ".codex" / "skills" / "openspec-shared" / "scripts" / "coordinator_heartbeat.py"


def heartbeat_log_path(repo_root: Path, change: str) -> Path:
    return repo_root / "openspec" / "changes" / change / "runs" / LOG_FILE_NAME


def heartbeat_state_path(repo_root: Path, change: str) -> Path:
    return repo_root / "openspec" / "changes" / change / "runs" / STATE_FILE_NAME


def screen_listing() -> dict[str, Any]:
    code, stdout, stderr = run_command(["screen", "-ls"])
    if code not in (0, 1):
        return {
            "available": False,
            "status": "error",
            "error": stderr.strip() or stdout.strip(),
            "matches": [],
            "lines": [],
        }
    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    return {
        "available": True,
        "status": "ok",
        "error": "",
        "matches": [],
        "lines": lines,
    }


def screen_matches(session_name: str) -> dict[str, Any]:
    listing = screen_listing()
    if not listing["available"]:
        return listing
    matches = [line for line in listing["lines"] if session_name in line]
    listing["matches"] = matches
    listing["status"] = "active" if matches else "missing"
    return listing


def heartbeat_process_matches(repo_root: Path, change: str, session_name: str) -> list[str]:
    return [record["display"] for record in heartbeat_process_records(repo_root, change, session_name)]


def heartbeat_process_pids(repo_root: Path, change: str, session_name: str) -> list[str]:
    return [record["pid"] for record in heartbeat_process_records(repo_root, change, session_name)]


def heartbeat_process_records(repo_root: Path, change: str, session_name: str) -> list[dict[str, str]]:
    code, stdout, _ = run_command(["ps", "-axww", "-o", "pid=,ppid=,stat=,command="])
    if code != 0:
        return []

    runner = str(heartbeat_runner_path(repo_root))
    matches: list[dict[str, str]] = []
    for line in stdout.splitlines():
        lowered = line.lower()
        parts = line.split(maxsplit=3)
        if len(parts) < 4:
            continue
        pid, ppid, stat, command = parts
        if runner in line:
            matches.append({"pid": pid, "ppid": ppid, "stat": stat, "command": command, "display": " ".join(parts)})
            continue
        if session_name and session_name in line and "screen" in lowered:
            matches.append({"pid": pid, "ppid": ppid, "stat": stat, "command": command, "display": " ".join(parts)})
            continue
        if change and "coordinator_heartbeat.py" in line and change in line:
            matches.append({"pid": pid, "ppid": ppid, "stat": stat, "command": command, "display": " ".join(parts)})
    return matches[:20]


def build_runner_args(
    repo_root: Path,
    change: str,
    interval_seconds: int | None,
    stale_seconds: int | None,
    notify_topic: str,
    auto_dispatch_next: bool,
    auto_launch_next: bool,
    auto_accept_review: bool,
    auto_verify_change: bool,
) -> list[str]:
    runner = heartbeat_runner_path(repo_root)
    args = [sys.executable, str(runner), "--repo-root", str(repo_root), "--change", change]
    if interval_seconds is not None:
        args.extend(["--interval-seconds", str(interval_seconds)])
    if stale_seconds is not None:
        args.extend(["--stale-seconds", str(stale_seconds)])
    if notify_topic.strip():
        args.extend(["--notify-topic", notify_topic.strip()])
    if auto_dispatch_next:
        args.append("--auto-dispatch-next")
    if auto_launch_next:
        args.append("--auto-launch-next")
    if auto_accept_review:
        args.append("--auto-accept-review")
    if auto_verify_change:
        args.append("--auto-verify-change")
    return args


def build_screen_shell_command(repo_root: Path, runner_args: list[str], log_path: Path) -> str:
    command = " ".join(shlex.quote(item) for item in runner_args)
    return f"cd {shlex.quote(str(repo_root))} && exec {command} >> {shlex.quote(str(log_path))} 2>&1"


def iso_mtime(path: Path) -> str:
    if not path.exists():
        return ""
    return datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat(timespec="seconds")
