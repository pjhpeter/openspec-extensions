#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("event", choices=["start", "checkpoint", "stop"])
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--issue-id", required=True)
    parser.add_argument("--run-id")
    parser.add_argument("--status", required=True)
    parser.add_argument("--boundary-status", default="")
    parser.add_argument("--next-action", default="")
    parser.add_argument("--summary", required=True)
    parser.add_argument("--blocker", default="")
    parser.add_argument("--validation", action="append", default=[])
    parser.add_argument("--changed-file", action="append", default=[])
    return parser.parse_args()


def parse_validation(entries: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for entry in entries:
        if "=" not in entry:
            raise SystemExit(f"Invalid validation entry: {entry}")
        key, value = entry.split("=", 1)
        result[key] = value
    return result


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def default_run_id(issue_id: str) -> str:
    stamp = datetime.now().astimezone().strftime("%Y%m%dT%H%M%S")
    return f"RUN-{stamp}-{issue_id}"


def issue_paths(repo_root: Path, change: str, issue_id: str) -> tuple[Path, Path, Path]:
    change_dir = repo_root / "openspec" / "changes" / change
    issues_dir = change_dir / "issues"
    runs_dir = change_dir / "runs"
    issues_dir.mkdir(parents=True, exist_ok=True)
    runs_dir.mkdir(parents=True, exist_ok=True)
    return change_dir, issues_dir / f"{issue_id}.progress.json", runs_dir


def latest_run_id(runs_dir: Path, issue_id: str) -> str | None:
    matches = sorted(runs_dir.glob(f"RUN-*-{issue_id}.json"))
    if not matches:
        return None
    return matches[-1].stem


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    _, progress_path, runs_dir = issue_paths(repo_root, args.change, args.issue_id)

    run_id = args.run_id or latest_run_id(runs_dir, args.issue_id) or default_run_id(args.issue_id)
    run_path = runs_dir / f"{run_id}.json"
    validation = parse_validation(args.validation)
    updated_at = now_iso()

    progress = read_json(progress_path)
    progress.update(
        {
            "change": args.change,
            "issue_id": args.issue_id,
            "status": args.status,
            "boundary_status": args.boundary_status,
            "next_action": args.next_action,
            "summary": args.summary,
            "blocker": args.blocker,
            "validation": validation,
            "changed_files": args.changed_file,
            "run_id": run_id,
            "updated_at": updated_at,
        }
    )
    write_json(progress_path, progress)

    run = read_json(run_path)
    run.update(
        {
            "run_id": run_id,
            "change": args.change,
            "issue_id": args.issue_id,
            "latest_event": args.event,
            "status": args.status,
            "boundary_status": args.boundary_status,
            "next_action": args.next_action,
            "summary": args.summary,
            "blocker": args.blocker,
            "validation": validation,
            "changed_files": args.changed_file,
            "updated_at": updated_at,
        }
    )
    write_json(run_path, run)

    payload = {
        "run_id": run_id,
        "progress_path": str(progress_path.relative_to(repo_root)),
        "run_path": str(run_path.relative_to(repo_root)),
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
