#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

SHARED_SCRIPTS = Path(__file__).resolve().parents[2] / "openspec-shared" / "scripts"
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from issue_mode_common import (  # noqa: E402
    display_path,
    ensure_issue_dispatch_allowed,
    is_shared_worker_workspace,
    issue_worker_worktree_path,
    load_issue_mode_config,
    read_change_control_state,
    worker_branch_name,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--issue-id", required=True)
    parser.add_argument("--mode", choices=["detach", "branch"])
    parser.add_argument("--base-ref")
    parser.add_argument("--branch-name")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def run_command(cmd: list[str]) -> tuple[int, str, str]:
    process = subprocess.run(cmd, capture_output=True, text=True)
    return process.returncode, process.stdout, process.stderr


def worktree_exists(path: Path) -> bool:
    code, stdout, _ = run_command(["git", "-C", str(path), "rev-parse", "--show-toplevel"])
    return code == 0 and Path(stdout.strip()).resolve() == path.resolve()


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    config = load_issue_mode_config(repo_root)
    control_state = read_change_control_state(repo_root, args.change)
    dispatch_gate = ensure_issue_dispatch_allowed(config, control_state, args.issue_id)
    worktree_path, worktree_display, worktree_source = issue_worker_worktree_path(
        repo_root=repo_root,
        change=args.change,
        issue_id=args.issue_id,
        config=config,
    )

    mode = args.mode or config["worker_worktree"]["mode"]
    base_ref = args.base_ref or config["worker_worktree"]["base_ref"]
    branch_name = args.branch_name or ""
    shared_workspace = is_shared_worker_workspace(repo_root, worktree_path)
    if shared_workspace:
        mode = "shared"
        base_ref = ""
        branch_name = ""
    if mode == "branch" and not branch_name:
        branch_name = worker_branch_name(config, args.change, args.issue_id)

    existed = False
    created = False

    if shared_workspace:
        existed = True
    elif worktree_path.exists():
        if worktree_exists(worktree_path):
            existed = True
        elif worktree_path.is_dir() and not any(worktree_path.iterdir()):
            existed = False
        else:
            raise SystemExit(f"Target path exists but is not an empty git worktree: {worktree_path}")

    if not shared_workspace and not existed and not args.dry_run:
        worktree_path.parent.mkdir(parents=True, exist_ok=True)
        command = ["git", "-C", str(repo_root), "worktree", "add"]
        if mode == "detach":
            command.extend(["--detach", str(worktree_path), base_ref])
        else:
            command.extend(["-b", branch_name, str(worktree_path), base_ref])
        code, stdout, stderr = run_command(command)
        if code != 0:
            raise SystemExit(stderr.strip() or stdout.strip() or "git worktree add failed")
        created = True

    payload = {
        "change": args.change,
        "issue_id": args.issue_id,
        "worktree": str(worktree_path),
        "worktree_relative": display_path(repo_root, worktree_path),
        "worktree_source": worktree_source,
        "control_gate": dispatch_gate,
        "config_path": config["config_path"],
        "config_exists": config["config_exists"],
        "mode": mode,
        "base_ref": base_ref,
        "branch_name": branch_name,
        "shared_workspace": shared_workspace,
        "created": created,
        "existed": existed,
        "dry_run": args.dry_run,
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
