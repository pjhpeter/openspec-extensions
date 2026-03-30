#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SHARED_SCRIPTS = Path(__file__).resolve().parents[2] / "openspec-shared" / "scripts"
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from coordinator_change_common import read_json, verification_artifact_is_current, verify_artifact_path  # noqa: E402
from issue_mode_common import automation_profile, load_issue_mode_config, read_change_control_state  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    return parser.parse_args()

def issue_id_from_doc(path: Path) -> str:
    return path.stem


def issue_id_from_progress(path: Path) -> str:
    return path.name.replace(".progress.json", "")


def collect_issues(repo_root: Path, change: str) -> list[dict[str, Any]]:
    issues_dir = repo_root / "openspec" / "changes" / change / "issues"
    progress_by_issue = {issue_id_from_progress(path): path for path in sorted(issues_dir.glob("*.progress.json"))}
    issue_docs = [path for path in sorted(issues_dir.glob("ISSUE-*.md")) if not path.name.endswith(".dispatch.md")]

    issues: list[dict[str, Any]] = []
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


def count_statuses(issues: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "pending": sum(1 for issue in issues if issue.get("status") in {"pending", ""}),
        "in_progress": sum(1 for issue in issues if issue.get("status") == "in_progress"),
        "completed": sum(1 for issue in issues if issue.get("status") == "completed"),
        "blocked": sum(1 for issue in issues if issue.get("status") == "blocked"),
    }


def determine_base_next_action(
    repo_root: Path,
    change: str,
    issues: list[dict[str, Any]],
    config: dict[str, Any],
) -> tuple[str, str, str]:
    subagent_team = config.get("subagent_team", {})
    auto_advance_after_issue_planning_review = bool(
        subagent_team.get("auto_advance_after_issue_planning_review", False)
    )
    auto_advance_to_next_issue_after_issue_pass = bool(
        subagent_team.get("auto_advance_to_next_issue_after_issue_pass", False)
    )
    auto_run_change_verify = bool(subagent_team.get("auto_run_change_verify", False))
    auto_archive_after_verify = bool(subagent_team.get("auto_archive_after_verify", False))

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
        completed = [issue for issue in issues if issue.get("status") == "completed"]
        if completed:
            if auto_advance_to_next_issue_after_issue_pass:
                return "dispatch_next_issue", pending[0]["issue_id"], f"{len(pending)} 个 issue 尚未开始，配置允许自动进入下一 issue。"
            return "await_next_issue_confirmation", pending[0]["issue_id"], f"{len(pending)} 个 issue 尚未开始，等待人工确认是否继续派发。"
        if auto_advance_after_issue_planning_review:
            return "dispatch_next_issue", pending[0]["issue_id"], f"{len(pending)} 个 issue 尚未开始，配置允许 issue planning 通过后自动派发。"
        return "await_issue_dispatch_confirmation", pending[0]["issue_id"], f"{len(pending)} 个 issue 尚未开始，等待人工确认是否开始 issue execution。"

    completed = [issue for issue in issues if issue.get("status") == "completed"]
    if completed and len(completed) == len(issues):
        verify_artifact = read_json(verify_artifact_path(repo_root, change))
        if verify_artifact and verification_artifact_is_current(issues, verify_artifact):
            if verify_artifact.get("status") == "passed":
                if auto_archive_after_verify:
                    return "archive_change", "", "全部 issue 已完成且 change 已通过 verify，配置允许自动 archive。"
                return "ready_for_archive", "", "全部 issue 已完成且 change 已通过 verify。"
            return "resolve_verify_failure", "", "全部 issue 已完成，但最近一次 verify 未通过。"
        if auto_run_change_verify:
            return "verify_change", completed[0]["issue_id"], "全部 issue 已完成，配置允许自动进入 verify。"
        return "await_verify_confirmation", completed[0]["issue_id"], "全部 issue 已完成，等待人工确认后再运行 verify。"

    return "inspect_change", issues[0]["issue_id"], "需要 coordinator 人工检查当前 change 状态。"


def determine_control_gate(
    control_state: dict[str, Any],
    issues: list[dict[str, Any]],
) -> tuple[str, str, str] | None:
    if not control_state.get("enabled"):
        return None

    must_fix_now_open = int(control_state.get("must_fix_now", {}).get("open_count", 0) or 0)
    pending = [issue for issue in issues if issue.get("status") in {"pending", ""}]
    completed = [issue for issue in issues if issue.get("status") == "completed"]

    if must_fix_now_open > 0 and (pending or (completed and len(completed) == len(issues))):
        return "resolve_round_backlog", "", f"当前 RRA backlog 仍有 {must_fix_now_open} 个 Must fix now 未处理。"

    latest_round = control_state.get("latest_round", {})
    dispatchable_issue_ids = {
        str(issue_id).strip()
        for issue_id in latest_round.get("referenced_issue_ids", [])
        if str(issue_id).strip()
    }
    if pending and latest_round.get("dispatch_gate_active") and dispatchable_issue_ids:
        approved_pending = [issue for issue in pending if issue.get("issue_id") in dispatchable_issue_ids]
        if approved_pending:
            approved_count = len(approved_pending)
            return (
                "dispatch_next_issue",
                approved_pending[0]["issue_id"],
                f"当前 round 已批准 {approved_count} 个待派发 issue。",
            )
        pending_count = len(pending)
        return (
            "update_round_scope",
            "",
            f"当前 round 未批准剩余 {pending_count} 个 pending issue 的派发，请更新 round scope。",
        )

    if completed and len(completed) == len(issues):
        if control_state.get("latest_round_path") and not latest_round.get("allows_verify", False):
            return "change_acceptance_required", "", "全部 issue 已完成，但当前 change-level round 尚未明确放行 verify。"

    return None


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    config = load_issue_mode_config(repo_root)
    issues = collect_issues(repo_root, args.change)
    control_state = read_change_control_state(repo_root, args.change)
    gate_mode = str(config.get("rra", {}).get("gate_mode", "advisory"))

    counts = count_statuses(issues)
    base_next_action, base_recommended_issue_id, base_reason = determine_base_next_action(repo_root, args.change, issues, config)
    control_gate = determine_control_gate(control_state, issues)
    next_action = base_next_action
    recommended_issue_id = base_recommended_issue_id
    reason = base_reason
    if control_gate is not None and gate_mode == "enforce":
        next_action, recommended_issue_id, reason = control_gate

    control_gate_payload = {
        "mode": gate_mode,
        "active": control_gate is not None,
        "enforced": control_gate is not None and gate_mode == "enforce",
        "action": control_gate[0] if control_gate is not None else "",
        "recommended_issue_id": control_gate[1] if control_gate is not None else "",
        "reason": control_gate[2] if control_gate is not None else "",
    }
    result = {
        "change": args.change,
        "issue_count": len(issues),
        "counts": counts,
        "next_action": next_action,
        "recommended_issue_id": recommended_issue_id,
        "reason": reason,
        "base_next_action": {
            "action": base_next_action,
            "recommended_issue_id": base_recommended_issue_id,
            "reason": base_reason,
        },
        "control": {
            **control_state,
            "gate": control_gate_payload,
        },
        "automation_profile": automation_profile(config),
        "automation": {
            "after_design_review": bool(config.get("subagent_team", {}).get("auto_advance_after_design_review", False)),
            "after_issue_planning_review": bool(
                config.get("subagent_team", {}).get("auto_advance_after_issue_planning_review", False)
            ),
            "to_next_issue_after_issue_pass": bool(
                config.get("subagent_team", {}).get("auto_advance_to_next_issue_after_issue_pass", False)
            ),
            "run_change_verify": bool(config.get("subagent_team", {}).get("auto_run_change_verify", False)),
            "archive_after_verify": bool(config.get("subagent_team", {}).get("auto_archive_after_verify", False)),
        },
        "issues": issues,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
