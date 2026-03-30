#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

SHARED_SCRIPTS = Path(__file__).resolve().parent
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from coordinator_change_common import (  # noqa: E402
    change_dir_path,
    incomplete_tasks,
    now_iso,
    read_json,
    sync_tasks_for_issues,
    verify_artifact_path,
    write_json,
)
from issue_mode_common import load_issue_mode_config  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def collect_issue_progress(change_dir: Path) -> list[dict[str, Any]]:
    issues_dir = change_dir / "issues"
    issue_docs = [path for path in sorted(issues_dir.glob("ISSUE-*.md")) if not path.name.endswith(".dispatch.md")]
    payloads: list[dict[str, Any]] = []

    for doc_path in issue_docs:
        issue_id = doc_path.stem
        progress_path = issues_dir / f"{issue_id}.progress.json"
        payload = {
            "issue_id": issue_id,
            "status": "pending",
            "updated_at": "",
        }
        if progress_path.exists():
            payload.update(read_json(progress_path))
        payloads.append(payload)

    for progress_path in sorted(issues_dir.glob("*.progress.json")):
        issue_id = progress_path.name.replace(".progress.json", "")
        if any(item.get("issue_id") == issue_id for item in payloads):
            continue
        payload = read_json(progress_path)
        payload.setdefault("issue_id", issue_id)
        payloads.append(payload)
    return payloads


def run_validation_command(command: str, repo_root: Path) -> dict[str, Any]:
    process = subprocess.run(
        command,
        cwd=str(repo_root),
        shell=True,
        capture_output=True,
        text=True,
    )
    return {
        "command": command,
        "status": "passed" if process.returncode == 0 else "failed",
        "exit_code": process.returncode,
        "stdout_tail": process.stdout.splitlines()[-20:],
        "stderr_tail": process.stderr.splitlines()[-20:],
    }


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    change_dir = change_dir_path(repo_root, args.change)
    issues = collect_issue_progress(change_dir)
    incomplete_issue_ids = sorted(
        {
            str(issue.get("issue_id", "")).strip()
            for issue in issues
            if str(issue.get("status", "")).strip() != "completed"
        }
    )

    completed_issue_ids = [
        str(issue.get("issue_id", "")).strip()
        for issue in issues
        if str(issue.get("status", "")).strip() == "completed" and str(issue.get("issue_id", "")).strip()
    ]
    tasks_sync = sync_tasks_for_issues(repo_root, args.change, completed_issue_ids, dry_run=args.dry_run)
    tasks_path = change_dir / "tasks.md"
    remaining_tasks = incomplete_tasks(tasks_path)

    config = load_issue_mode_config(repo_root)
    validation_commands = list(config["validation_commands"])
    validation_results: list[dict[str, Any]] = []
    if not args.dry_run:
        validation_results = [run_validation_command(command, repo_root) for command in validation_commands]

    validation_failed = any(item["status"] != "passed" for item in validation_results)
    has_incomplete_tasks = bool(remaining_tasks)
    has_incomplete_issues = bool(incomplete_issue_ids)

    status = "passed"
    summary = f"Change {args.change} passed coordinator verify."
    if has_incomplete_issues:
        status = "failed"
        summary = f"Change {args.change} cannot verify: {len(incomplete_issue_ids)} issue(s) not completed."
    elif has_incomplete_tasks:
        status = "failed"
        summary = f"Change {args.change} verify failed: tasks.md still has unchecked tasks."
    elif validation_failed:
        status = "failed"
        summary = f"Change {args.change} verify failed: repository validation did not pass."
    elif args.dry_run:
        summary = f"Change {args.change} verify dry-run completed."

    artifact = {
        "change": args.change,
        "status": status,
        "summary": summary,
        "updated_at": now_iso(),
        "dry_run": args.dry_run,
        "completed_issue_ids": completed_issue_ids,
        "incomplete_issue_ids": incomplete_issue_ids,
        "tasks_sync": tasks_sync,
        "remaining_tasks": remaining_tasks,
        "validation": validation_results,
        "validation_commands": validation_commands,
    }

    if not args.dry_run:
        write_json(verify_artifact_path(repo_root, args.change), artifact)

    print(json.dumps(artifact, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
