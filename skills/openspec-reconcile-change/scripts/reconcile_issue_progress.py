#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SHARED_SCRIPTS = Path(__file__).resolve().parents[2] / "openspec-shared" / "scripts"
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from coordinator_change_common import read_json, verification_artifact_is_current, verify_artifact_path  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    return parser.parse_args()

def issue_id_from_doc(path: Path) -> str:
    return path.stem


def issue_id_from_progress(path: Path) -> str:
    return path.name.replace(".progress.json", "")


def collect_issues(repo_root: Path, change: str) -> list[dict]:
    issues_dir = repo_root / "openspec" / "changes" / change / "issues"
    progress_by_issue = {issue_id_from_progress(path): path for path in sorted(issues_dir.glob("*.progress.json"))}
    issue_docs = [path for path in sorted(issues_dir.glob("ISSUE-*.md")) if not path.name.endswith(".dispatch.md")]

    issues: list[dict] = []
    seen_ids: set[str] = set()

    for doc_path in issue_docs:
        issue_id = issue_id_from_doc(doc_path)
        payload = {
            "issue_id": issue_id,
            "status": "pending",
            "boundary_status": "",
            "next_action": "",
            "progress_path": "",
            "issue_path": str(doc_path.relative_to(repo_root)),
        }
        progress_path = progress_by_issue.get(issue_id)
        if progress_path:
            progress_payload = read_json(progress_path)
            payload.update(progress_payload)
            payload["progress_path"] = str(progress_path.relative_to(repo_root))
        issues.append(payload)
        seen_ids.add(issue_id)

    for issue_id, progress_path in progress_by_issue.items():
        if issue_id in seen_ids:
            continue
        payload = read_json(progress_path)
        payload.setdefault("issue_id", issue_id)
        payload["progress_path"] = str(progress_path.relative_to(repo_root))
        payload["issue_path"] = ""
        issues.append(payload)

    return issues


def count_statuses(issues: list[dict]) -> dict[str, int]:
    return {
        "pending": sum(1 for issue in issues if issue.get("status") in {"pending", ""}),
        "in_progress": sum(1 for issue in issues if issue.get("status") == "in_progress"),
        "completed": sum(1 for issue in issues if issue.get("status") == "completed"),
        "blocked": sum(1 for issue in issues if issue.get("status") == "blocked"),
    }


def determine_next_action(repo_root: Path, change: str, issues: list[dict]) -> tuple[str, str, str]:
    if not issues:
        return "no_issue_artifacts", "", "未找到 issue 工件。"

    blocked = [issue for issue in issues if issue.get("status") == "blocked"]
    if blocked:
        return "resolve_blocker", blocked[0]["issue_id"], f"{len(blocked)} 个 issue 处于 blocked。"

    review_required = [
        issue
        for issue in issues
        if issue.get("boundary_status") == "review_required"
        or issue.get("next_action") == "coordinator_review"
    ]
    if review_required:
        return "coordinator_review", review_required[0]["issue_id"], f"{len(review_required)} 个 issue 等待 coordinator 收敛。"

    in_progress = [issue for issue in issues if issue.get("status") == "in_progress"]
    if in_progress:
        return "wait_for_active_issue", in_progress[0]["issue_id"], f"{len(in_progress)} 个 issue 仍在执行中。"

    pending = [issue for issue in issues if issue.get("status") in {"pending", ""}]
    if pending:
        return "dispatch_next_issue", pending[0]["issue_id"], f"{len(pending)} 个 issue 尚未开始。"

    completed = [issue for issue in issues if issue.get("status") == "completed"]
    if completed and len(completed) == len(issues):
        verify_artifact = read_json(verify_artifact_path(repo_root, change))
        if verify_artifact and verification_artifact_is_current(issues, verify_artifact):
            if verify_artifact.get("status") == "passed":
                return "ready_for_archive", "", "全部 issue 已完成且 change 已通过 verify。"
            return "resolve_verify_failure", "", "全部 issue 已完成，但最近一次 verify 未通过。"
        return "verify_change", completed[0]["issue_id"], "全部 issue 已完成，可进入 verify。"

    return "inspect_change", issues[0]["issue_id"], "需要 coordinator 人工检查当前 change 状态。"


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    issues = collect_issues(repo_root, args.change)

    counts = count_statuses(issues)
    next_action, recommended_issue_id, reason = determine_next_action(repo_root, args.change, issues)
    result = {
        "change": args.change,
        "issue_count": len(issues),
        "counts": counts,
        "next_action": next_action,
        "recommended_issue_id": recommended_issue_id,
        "reason": reason,
        "issues": issues,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
