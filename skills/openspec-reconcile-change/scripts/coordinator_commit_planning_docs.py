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

from coordinator_change_common import planning_doc_status  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--commit-message", default="")
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


def git_output(repo_root: Path, *args: str) -> str:
    return decode_output(run_command(["git", *args], cwd=repo_root).stdout)


def default_commit_message(change: str) -> str:
    return f"opsx({change}): commit planning docs"


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    planning_docs = planning_doc_status(repo_root, args.change)
    if not planning_docs["git_available"]:
        raise SystemExit("Planning-doc commit requires a git repository.")

    repo_relative_paths = list(planning_docs["paths"])
    if not repo_relative_paths:
        raise SystemExit(f"No planning docs found for change `{args.change}`.")

    commit_message = args.commit_message.strip() or default_commit_message(args.change)
    result = {
        "change": args.change,
        "commit_message": commit_message,
        "paths": repo_relative_paths,
        "status_lines": planning_docs["status_lines"],
        "dirty_paths": planning_docs["dirty_paths"],
        "needs_commit": planning_docs["needs_commit"],
        "dry_run": args.dry_run,
    }

    if not planning_docs["needs_commit"]:
        result["status"] = "already_committed"
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if args.dry_run:
        result["status"] = "ready_to_commit"
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    run_command(["git", "add", "--", *repo_relative_paths], cwd=repo_root)
    run_command(["git", "commit", "-m", commit_message, "--", *repo_relative_paths], cwd=repo_root)
    result["status"] = "committed"
    result["commit_sha"] = git_output(repo_root, "rev-parse", "HEAD")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
