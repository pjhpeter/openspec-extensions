#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

SHARED_SCRIPTS = Path(__file__).resolve().parent
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from issue_mode_common import (  # noqa: E402
    load_issue_mode_config,
    resolve_repo_path,
    worker_branch_name,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--archive-command", default="")
    parser.add_argument("--skip-cleanup", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def decode_output(data: bytes) -> str:
    return data.decode("utf-8", errors="replace").strip()


def run_command(
    cmd: list[str],
    *,
    cwd: Path,
    check: bool = True,
) -> subprocess.CompletedProcess[bytes]:
    process = subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
    )
    if check and process.returncode != 0:
        message = decode_output(process.stderr) or decode_output(process.stdout) or "command failed"
        raise SystemExit(message)
    return process


def run_shell(command: str, *, cwd: Path) -> subprocess.CompletedProcess[str]:
    process = subprocess.run(
        command,
        cwd=str(cwd),
        shell=True,
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        message = process.stderr.strip() or process.stdout.strip() or "archive command failed"
        raise SystemExit(message)
    return process


def worktree_is_registered(repo_root: Path, path: Path) -> bool:
    process = run_command(["git", "worktree", "list", "--porcelain"], cwd=repo_root)
    lines = decode_output(process.stdout).splitlines()
    target = path.resolve()
    for line in lines:
        if not line.startswith("worktree "):
            continue
        candidate = Path(line.split(" ", 1)[1].strip()).resolve()
        if candidate == target:
            return True
    return False


def branch_exists(repo_root: Path, branch_name: str) -> bool:
    process = run_command(["git", "show-ref", "--verify", f"refs/heads/{branch_name}"], cwd=repo_root, check=False)
    return process.returncode == 0


def cleanup_change_worktree(repo_root: Path, change: str, config: dict[str, object], *, dry_run: bool) -> dict[str, object]:
    scope = str(config.get("worker_worktree", {}).get("scope", "shared")).strip() or "shared"
    if scope != "change":
        return {
            "required": False,
            "worktree": "",
            "removed": False,
            "registered": False,
            "branch_deleted": False,
        }

    worktree_path = resolve_repo_path(repo_root, (Path(str(config["worktree_root"])) / change).as_posix())
    registered = worktree_is_registered(repo_root, worktree_path) if worktree_path.exists() else False
    branch_deleted = False

    if dry_run:
        return {
            "required": True,
            "worktree": str(worktree_path),
            "removed": worktree_path.exists(),
            "registered": registered,
            "branch_deleted": False,
        }

    removed = False
    if registered:
        run_command(["git", "worktree", "remove", "--force", str(worktree_path)], cwd=repo_root)
        removed = True
    elif worktree_path.exists():
        shutil.rmtree(worktree_path)
        removed = True

    if str(config["worker_worktree"].get("mode", "")).strip() == "branch":
        branch_name = worker_branch_name(config, change, "ISSUE-000", scope="change")
        if branch_exists(repo_root, branch_name):
            run_command(["git", "branch", "-D", branch_name], cwd=repo_root)
            branch_deleted = True

    return {
        "required": True,
        "worktree": str(worktree_path),
        "removed": removed,
        "registered": registered,
        "branch_deleted": branch_deleted,
    }


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    config = load_issue_mode_config(repo_root)
    archive_command = args.archive_command.strip() or f'openspec archive "{args.change}"'

    result: dict[str, object] = {
        "change": args.change,
        "archive_command": archive_command,
        "dry_run": args.dry_run,
        "cleanup_skipped": args.skip_cleanup,
    }
    if args.dry_run:
        result["archived"] = False
        result["cleanup"] = cleanup_change_worktree(repo_root, args.change, config, dry_run=True)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    archive_process = run_shell(archive_command, cwd=repo_root)
    result["archived"] = True
    result["archive_stdout"] = archive_process.stdout.strip()
    result["archive_stderr"] = archive_process.stderr.strip()
    if args.skip_cleanup:
        result["cleanup"] = {
            "required": False,
            "worktree": "",
            "removed": False,
            "registered": False,
            "branch_deleted": False,
        }
    else:
        result["cleanup"] = cleanup_change_worktree(repo_root, args.change, config, dry_run=False)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
