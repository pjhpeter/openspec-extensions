#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

SHARED_SCRIPTS = Path(__file__).resolve().parent
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from coordinator_change_common import now_iso, read_json, review_artifact_path, write_json  # noqa: E402

VERDICT_PATTERN = re.compile(r"^VERDICT:\s*(pass|fail)\s*$", re.IGNORECASE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--review-command",
        default="",
        help="Optional override command for tests or custom environments. Defaults to `codex review --uncommitted -`.",
    )
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


def build_review_prompt(change: str, completed_issue_ids: list[str]) -> str:
    issue_context = ", ".join(completed_issue_ids) if completed_issue_ids else "none"
    return (
        f"Review the current uncommitted code changes for OpenSpec change `{change}` before verify.\n"
        f"Completed issues in scope: {issue_context}.\n"
        "Focus on correctness, regressions, missing validation, and blockers that must be fixed before verify.\n"
        "Respond in plain text.\n"
        "The first line must be exactly one of:\n"
        "VERDICT: pass\n"
        "VERDICT: fail\n"
        "If the verdict is fail, list only blocking findings that must be fixed before verify.\n"
    )


def parse_verdict(output: str) -> str:
    for raw_line in output.splitlines():
        match = VERDICT_PATTERN.match(raw_line.strip())
        if match:
            return match.group(1).lower()
    return "unknown"


def tail_lines(text: str, limit: int = 40) -> list[str]:
    return text.splitlines()[-limit:]


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    change_dir = repo_root / "openspec" / "changes" / args.change
    issues = collect_issue_progress(change_dir)
    completed_issue_ids = sorted(
        str(issue.get("issue_id", "")).strip()
        for issue in issues
        if str(issue.get("status", "")).strip() == "completed" and str(issue.get("issue_id", "")).strip()
    )
    incomplete_issue_ids = sorted(
        {
            str(issue.get("issue_id", "")).strip()
            for issue in issues
            if str(issue.get("status", "")).strip() != "completed" and str(issue.get("issue_id", "")).strip()
        }
    )
    prompt = build_review_prompt(args.change, completed_issue_ids)

    artifact: dict[str, Any] = {
        "change": args.change,
        "updated_at": now_iso(),
        "dry_run": args.dry_run,
        "completed_issue_ids": completed_issue_ids,
        "incomplete_issue_ids": incomplete_issue_ids,
        "review_prompt": prompt,
    }

    if incomplete_issue_ids:
        artifact.update(
            {
                "status": "failed",
                "summary": f"Change {args.change} cannot run change-level code review: {len(incomplete_issue_ids)} issue(s) not completed.",
                "verdict": "fail",
                "review_command": "",
                "exit_code": None,
                "stdout_tail": [],
                "stderr_tail": [],
            }
        )
    elif args.dry_run:
        artifact.update(
            {
                "status": "dry_run",
                "summary": f"Change {args.change} code review dry-run completed.",
                "verdict": "unknown",
                "review_command": args.review_command.strip() or "codex review --uncommitted -",
                "exit_code": None,
                "stdout_tail": [],
                "stderr_tail": [],
            }
        )
    else:
        review_command = args.review_command.strip() or "codex review --uncommitted -"
        if args.review_command.strip():
            process = subprocess.run(
                review_command,
                cwd=str(repo_root),
                shell=True,
                capture_output=True,
                text=True,
                input=prompt,
            )
        else:
            process = subprocess.run(
                shlex.split(review_command),
                cwd=str(repo_root),
                capture_output=True,
                text=True,
                input=prompt,
            )

        verdict = parse_verdict(process.stdout)
        status = "failed"
        summary = f"Change {args.change} code review command failed."
        if process.returncode == 0 and verdict == "pass":
            status = "passed"
            summary = f"Change {args.change} passed coordinator code review."
        elif process.returncode == 0 and verdict == "fail":
            summary = f"Change {args.change} code review found blocking issues."
        elif process.returncode == 0:
            summary = f"Change {args.change} code review completed but did not return a parseable verdict."

        artifact.update(
            {
                "status": status,
                "summary": summary,
                "verdict": verdict,
                "review_command": review_command,
                "exit_code": process.returncode,
                "stdout_tail": tail_lines(process.stdout),
                "stderr_tail": tail_lines(process.stderr),
            }
        )

    if not args.dry_run:
        write_json(review_artifact_path(repo_root, args.change), artifact)

    print(json.dumps(artifact, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
