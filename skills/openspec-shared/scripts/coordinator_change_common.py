#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

REVIEW_ARTIFACT_FILE_NAME = "CHANGE-REVIEW.json"
VERIFY_ARTIFACT_FILE_NAME = "CHANGE-VERIFY.json"
TASK_ID_PATTERN = r"\d+(?:\.\d+)+"


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def parse_iso8601(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def change_dir_path(repo_root: Path, change: str) -> Path:
    return repo_root / "openspec" / "changes" / change


def verify_artifact_path(repo_root: Path, change: str) -> Path:
    return change_dir_path(repo_root, change) / "runs" / VERIFY_ARTIFACT_FILE_NAME


def review_artifact_path(repo_root: Path, change: str) -> Path:
    return change_dir_path(repo_root, change) / "runs" / REVIEW_ARTIFACT_FILE_NAME


def issue_task_mapping(change_dir: Path) -> dict[str, list[str]]:
    index_path = change_dir / "issues" / "INDEX.md"
    if not index_path.exists():
        return {}

    mapping: dict[str, list[str]] = {}
    for line in index_path.read_text().splitlines():
        tokens = [token.strip() for token in re.findall(r"`([^`]+)`", line)]
        if len(tokens) < 2:
            continue
        issue_id = tokens[0]
        if not issue_id.startswith("ISSUE-"):
            continue
        task_ids: list[str] = []
        for token in tokens[1:]:
            if re.fullmatch(TASK_ID_PATTERN, token) and token not in task_ids:
                task_ids.append(token)
        if task_ids:
            mapping[issue_id] = task_ids
    return mapping


def sync_tasks_for_issues(
    repo_root: Path,
    change: str,
    issue_ids: list[str],
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    change_dir = change_dir_path(repo_root, change)
    tasks_path = change_dir / "tasks.md"
    result: dict[str, Any] = {
        "tasks_path": str(tasks_path.relative_to(repo_root)),
        "index_path": str((change_dir / "issues" / "INDEX.md").relative_to(repo_root)),
        "mapped_issue_ids": [],
        "unmapped_issue_ids": [],
        "mapped_task_ids": [],
        "updated_task_ids": [],
        "already_completed_task_ids": [],
        "missing_task_ids": [],
        "changed": False,
    }

    if not tasks_path.exists():
        result["reason"] = "tasks_missing"
        return result

    mapping = issue_task_mapping(change_dir)
    task_ids: list[str] = []
    for issue_id in issue_ids:
        mapped = mapping.get(issue_id, [])
        if not mapped:
            result["unmapped_issue_ids"].append(issue_id)
            continue
        result["mapped_issue_ids"].append(issue_id)
        for task_id in mapped:
            if task_id not in task_ids:
                task_ids.append(task_id)
    result["mapped_task_ids"] = task_ids
    if not task_ids:
        return result

    lines = tasks_path.read_text().splitlines(keepends=True)
    found_task_ids: set[str] = set()

    for task_id in task_ids:
        pattern = re.compile(rf"^(\s*-\s*\[)( |x)(\]\s+{re.escape(task_id)}\b.*)$")
        matched = False
        for index, line in enumerate(lines):
            match = pattern.match(line)
            if not match:
                continue
            matched = True
            found_task_ids.add(task_id)
            if match.group(2) == "x":
                result["already_completed_task_ids"].append(task_id)
            else:
                lines[index] = f"{match.group(1)}x{match.group(3)}"
                result["updated_task_ids"].append(task_id)
                result["changed"] = True
            break
        if not matched:
            result["missing_task_ids"].append(task_id)

    if result["changed"] and not dry_run:
        tasks_path.write_text("".join(lines))
    return result


def incomplete_tasks(tasks_path: Path) -> list[dict[str, str]]:
    if not tasks_path.exists():
        return []

    result: list[dict[str, str]] = []
    pattern = re.compile(rf"^\s*-\s*\[ \]\s+({TASK_ID_PATTERN})\b(.*)$")
    for line in tasks_path.read_text().splitlines():
        match = pattern.match(line)
        if not match:
            continue
        result.append(
            {
                "task_id": match.group(1).strip(),
                "line": line.strip(),
            }
        )
    return result


def latest_issue_updated_at(issues: list[dict[str, Any]]) -> datetime | None:
    latest: datetime | None = None
    for issue in issues:
        updated_at = parse_iso8601(str(issue.get("updated_at", "")))
        if updated_at is None:
            continue
        if latest is None or updated_at > latest:
            latest = updated_at
    return latest


def artifact_is_current(issues: list[dict[str, Any]], artifact: dict[str, Any]) -> bool:
    verified_at = parse_iso8601(str(artifact.get("updated_at", "")))
    if verified_at is None:
        return False
    latest_issue_at = latest_issue_updated_at(issues)
    if latest_issue_at is None:
        return True
    return verified_at >= latest_issue_at


def review_artifact_is_current(issues: list[dict[str, Any]], artifact: dict[str, Any]) -> bool:
    return artifact_is_current(issues, artifact)


def verification_artifact_is_current(issues: list[dict[str, Any]], artifact: dict[str, Any]) -> bool:
    return artifact_is_current(issues, artifact)
