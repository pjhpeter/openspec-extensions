#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

SHARED_SCRIPTS = Path(__file__).resolve().parents[2] / "openspec-shared" / "scripts"
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from issue_mode_common import (  # noqa: E402
    issue_validation_commands,
    issue_worker_worktree_path,
    load_issue_mode_config,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worktree")
    parser.add_argument("--repo-root")
    parser.add_argument("--change")
    parser.add_argument("--issue-id")
    parser.add_argument("--session-name", "--screen-name", dest="session_name", default="")
    parser.add_argument("--host-kind", choices=["screen", "tmux", "none"])
    parser.add_argument("--codex-home", default="")
    parser.add_argument("--recent-limit", type=int, default=8)
    return parser.parse_args()


def run_command(cmd: list[str], cwd: str | None = None) -> tuple[int, str, str]:
    try:
        process = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    except FileNotFoundError as error:
        return 127, "", str(error)
    return process.returncode, process.stdout, process.stderr


def resolve_repo_root(args: argparse.Namespace) -> Path:
    if args.repo_root:
        return Path(args.repo_root).resolve()
    if args.worktree:
        return Path(args.worktree).resolve()
    raise SystemExit("Provide either --worktree or --repo-root with --change and --issue-id.")


def resolve_worktree(args: argparse.Namespace, repo_root: Path, config: dict[str, Any]) -> tuple[str, str]:
    if args.worktree:
        return os.path.abspath(args.worktree), "explicit_arg"
    if args.repo_root and args.change and args.issue_id:
        worktree_path, _, source = issue_worker_worktree_path(
            repo_root=repo_root,
            change=args.change,
            issue_id=args.issue_id,
            config=config,
        )
        return str(worktree_path), source
    raise SystemExit("Provide either --worktree or --repo-root with --change and --issue-id.")


def inspect_screen(session_name: str) -> dict[str, Any]:
    code, stdout, stderr = run_command(["screen", "-ls"])
    if code not in (0, 1):
        return {"kind": "screen", "available": False, "status": "error", "error": stderr.strip() or stdout.strip()}

    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    matches = [line for line in lines if session_name and session_name in line]
    if session_name:
        status = "active" if matches else "missing"
    else:
        status = "not_checked"
    return {
        "kind": "screen",
        "available": True,
        "status": status,
        "session_name": session_name,
        "matches": matches,
    }


def inspect_tmux(session_name: str) -> dict[str, Any]:
    code, stdout, stderr = run_command(["tmux", "list-sessions", "-F", "#{session_name}"])
    if code != 0:
        return {"kind": "tmux", "available": False, "status": "error", "error": stderr.strip() or stdout.strip()}

    sessions = [line.strip() for line in stdout.splitlines() if line.strip()]
    matches = [name for name in sessions if session_name and session_name in name]
    if session_name:
        status = "active" if matches else "missing"
    else:
        status = "not_checked"
    return {
        "kind": "tmux",
        "available": True,
        "status": status,
        "session_name": session_name,
        "matches": matches,
    }


def inspect_persistent_host(host_kind: str, session_name: str) -> dict[str, Any]:
    if host_kind == "none":
        return {"kind": "none", "available": False, "status": "disabled", "session_name": session_name, "matches": []}
    if host_kind == "tmux":
        return inspect_tmux(session_name)
    return inspect_screen(session_name)


def inspect_processes(worktree: str) -> dict[str, Any]:
    code, stdout, stderr = run_command(["ps", "-axww", "-o", "pid=,ppid=,stat=,command="])
    if code != 0:
        return {"status": "error", "error": stderr.strip()}

    matches = []
    for line in stdout.splitlines():
        if worktree in line or f"codex exec -C {worktree}" in line:
            matches.append(" ".join(line.split()))
    return {"status": "active" if matches else "missing", "matches": matches[:20]}


def inspect_session_files(worktree: str, codex_home: Path, recent_limit: int, validation_commands: list[str]) -> dict[str, Any]:
    sessions_root = codex_home / "sessions"
    if not sessions_root.exists():
        return {"status": "missing", "latest_session": "", "signals": {}, "validation_signals": []}

    candidates = sorted(sessions_root.rglob("*.jsonl"), key=lambda path: path.stat().st_mtime, reverse=True)
    latest_match: Path | None = None
    for path in candidates:
        try:
            text = path.read_text(errors="ignore")
        except OSError:
            continue
        if worktree in text:
            latest_match = path
            break

    if latest_match is None:
        return {"status": "missing", "latest_session": "", "signals": {}, "validation_signals": []}

    text = latest_match.read_text(errors="ignore")
    lines = text.splitlines()
    recent_lines = lines[-400:]
    keywords = {
        "function_call": "function_call",
        "function_call_output": "function_call_output",
        "agent_message": "agent_message",
        "task_complete": "task_complete",
    }
    signals: dict[str, dict[str, Any]] = {}
    for key, needle in keywords.items():
        matched = [line for line in recent_lines if needle in line]
        signals[key] = {
            "found": bool(matched),
            "recent": matched[-recent_limit:],
        }

    validation_signals = []
    for command in validation_commands:
        matched = [line for line in recent_lines if command in line]
        validation_signals.append(
            {
                "command": command,
                "found": bool(matched),
                "recent": matched[-recent_limit:],
            }
        )

    return {
        "status": "found",
        "latest_session": str(latest_match),
        "signals": signals,
        "validation_signals": validation_signals,
    }


def inspect_worktree(worktree: str) -> dict[str, Any]:
    if not Path(worktree).exists():
        return {"status": "missing", "error": "worktree_not_found"}

    code, stdout, stderr = run_command(["git", "status", "--short"], cwd=worktree)
    if code != 0:
        return {"status": "error", "error": stderr.strip() or stdout.strip()}
    changes = [line for line in stdout.splitlines() if line.strip()]
    return {"status": "dirty" if changes else "clean", "changes": changes}


def summarize(
    host_info: dict[str, Any],
    process_info: dict[str, Any],
    session_info: dict[str, Any],
    worktree_info: dict[str, Any],
) -> str:
    validation_started = any(signal.get("found") for signal in session_info.get("validation_signals", []))

    if process_info.get("status") == "active":
        if validation_started:
            return "worker 进程仍在运行，且最近已经进入校验相关阶段。"
        return "worker 进程仍在运行，当前更像是执行中而非已退出。"

    if worktree_info.get("status") == "dirty" and session_info.get("status") == "found":
        return "worker 进程看起来已退出，但工作树和会话文件显示已有部分进展，先恢复现场再决定是否重派。"

    if host_info.get("status") == "missing" and process_info.get("status") == "missing":
        return "没有看到持久托管或存活进程，worker 很可能已经退出。"

    return "需要结合 issue progress 工件再判断是否继续、重派或人工接管。"


def main() -> None:
    args = parse_args()
    repo_root = resolve_repo_root(args)
    config = load_issue_mode_config(repo_root)
    worktree, worktree_source = resolve_worktree(args, repo_root, config)
    codex_home = Path(args.codex_home).expanduser() if args.codex_home else Path(config["codex_home"]).expanduser()
    host_kind = args.host_kind or config["persistent_host"]["kind"]
    validation_commands = list(config["validation_commands"])
    validation_source = "config_default"
    if args.change and args.issue_id:
        validation_commands, validation_source = issue_validation_commands(
            repo_root=repo_root,
            change=args.change,
            issue_id=args.issue_id,
            config=config,
        )

    host_info = inspect_persistent_host(host_kind, args.session_name)
    process_info = inspect_processes(worktree)
    session_info = inspect_session_files(worktree, codex_home, args.recent_limit, validation_commands)
    worktree_info = inspect_worktree(worktree)

    result = {
        "repo_root": str(repo_root),
        "worktree": worktree,
        "worktree_source": worktree_source,
        "persistent_host": host_info,
        "process": process_info,
        "session_file": session_info,
        "worktree_state": worktree_info,
        "config": {
            "config_path": config["config_path"],
            "config_exists": config["config_exists"],
            "host_kind": host_kind,
            "codex_home": str(codex_home),
            "validation_commands": validation_commands,
            "validation_source": validation_source,
        },
        "summary": summarize(host_info, process_info, session_info, worktree_info),
    }
    if host_kind == "screen":
        result["screen"] = host_info
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
