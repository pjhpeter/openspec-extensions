#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

SHARED_SCRIPTS = Path(__file__).resolve().parents[2] / "openspec-shared" / "scripts"
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from coordinator_change_common import read_json, verification_artifact_is_current, verify_artifact_path  # noqa: E402
from issue_mode_common import (  # noqa: E402
    display_path,
    latest_round_artifact_path,
    load_issue_mode_config,
    now_iso,
    parse_frontmatter,
    read_change_control_state,
)

SKILLS_ROOT = Path(__file__).resolve().parents[2]
ISSUE_TEAM_RENDERER = SKILLS_ROOT / "openspec-dispatch-issue" / "scripts" / "render_subagent_team_dispatch.py"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument(
        "--phase",
        choices=[
            "auto",
            "spec_readiness",
            "issue_planning",
            "issue_execution",
            "change_acceptance",
            "ready_for_archive",
        ],
        default="auto",
    )
    parser.add_argument("--issue-id", default="")
    parser.add_argument("--dry-run", action="store_true")
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
        frontmatter = parse_frontmatter(doc_path.read_text()) if doc_path.exists() else {}
        payload = {
            "issue_id": issue_id,
            "title": str(frontmatter.get("title", "")).strip(),
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
        payload.setdefault("status", "pending")
        payload.setdefault("boundary_status", "")
        payload.setdefault("next_action", "")
        payload["title"] = ""
        payload["progress_path"] = str(progress_path.relative_to(repo_root))
        payload["issue_path"] = ""
        issues.append(payload)

    return issues


def current_verify_state(repo_root: Path, change: str, issues: list[dict[str, Any]]) -> dict[str, Any]:
    verify_payload = read_json(verify_artifact_path(repo_root, change))
    return {
        "artifact": verify_payload,
        "current": bool(verify_payload) and verification_artifact_is_current(issues, verify_payload),
        "passed": bool(verify_payload)
        and verification_artifact_is_current(issues, verify_payload)
        and str(verify_payload.get("status", "")).strip() == "passed",
    }


def focus_issue_id(issues: list[dict[str, Any]]) -> str:
    def choose(predicate: Any) -> str:
        for issue in issues:
            if predicate(issue):
                return str(issue.get("issue_id", "")).strip()
        return ""

    for predicate in (
        lambda issue: issue.get("status") == "blocked",
        lambda issue: issue.get("boundary_status") == "review_required"
        or issue.get("next_action") == "coordinator_review",
        lambda issue: issue.get("status") == "in_progress",
        lambda issue: issue.get("status") in {"pending", ""},
    ):
        selected = choose(predicate)
        if selected:
            return selected
    return ""


def determine_phase(repo_root: Path, change: str, issues: list[dict[str, Any]], explicit_issue_id: str) -> tuple[str, str, str]:
    change_dir = repo_root / "openspec" / "changes" / change
    proposal_path = change_dir / "proposal.md"
    design_path = change_dir / "design.md"
    tasks_path = change_dir / "tasks.md"
    issues_index_path = change_dir / "issues" / "INDEX.md"

    missing_core = [path.name for path in (proposal_path, design_path, tasks_path) if not path.exists()]
    if missing_core:
        return "spec_readiness", "", f"变更基础文档未齐全：{', '.join(missing_core)}。"

    issue_docs = [issue for issue in issues if issue.get("issue_path")]
    if not issues_index_path.exists() or not issue_docs:
        return "issue_planning", "", "issue 规划工件未完成，需先产出或修订 INDEX/ISSUE 文档。"

    selected_issue_id = explicit_issue_id.strip() or focus_issue_id(issues)
    incomplete = [issue for issue in issues if str(issue.get("status", "")).strip() != "completed"]
    if incomplete:
        return "issue_execution", selected_issue_id, "仍有 issue 未完成，继续执行当前 issue 回合。"

    verify_state = current_verify_state(repo_root, change, issues)
    if verify_state["passed"]:
        return "ready_for_archive", "", "最新 verify 已通过，change 可以进入归档收尾。"
    return "change_acceptance", "", "全部 issue 已完成，进入 change 级 acceptance / verify 放行。"


def phase_target_mode(control_state: dict[str, Any], phase: str) -> str:
    latest_round = control_state.get("latest_round", {})
    target_mode = str(latest_round.get("target_mode", "")).strip()
    if target_mode:
        return target_mode
    if phase == "spec_readiness":
        return "mvp"
    if phase == "issue_planning":
        return "release"
    if phase == "change_acceptance":
        return "release"
    return "quality"


def phase_goal(phase: str, change: str, issue_id: str, control_state: dict[str, Any]) -> str:
    latest_round = control_state.get("latest_round", {})
    explicit_goal = str(latest_round.get("round_target", "")).strip()
    if explicit_goal:
        return explicit_goal
    if phase == "spec_readiness":
        return f"把 {change} 的 proposal / design / tasks 补齐到 implementation-ready。"
    if phase == "issue_planning":
        return f"把 {change} 拆成可调度 issue，并让 issue 规划通过审查。"
    if phase == "issue_execution":
        return f"推进 {issue_id or '当前 issue'} 完成开发、检查、修复、审查回合。"
    if phase == "change_acceptance":
        return f"确认 {change} 已达到 verify / archive 前的 change 级通过条件。"
    return f"{change} 已满足归档前条件，执行最终收尾。"


def phase_acceptance_criteria(phase: str, issue_id: str, issues: list[dict[str, Any]]) -> list[str]:
    if phase == "spec_readiness":
        return [
            "proposal / design / tasks 齐全且相互一致",
            "范围、约束、非目标足够清楚",
            "任务已经可拆 issue",
        ]
    if phase == "issue_planning":
        return [
            "INDEX 和 ISSUE 文档可由新鲜 worker 直接消费",
            "每个 issue 的边界、ownership、validation 明确",
            "当前 round 已批准可派发 issue",
        ]
    if phase == "issue_execution":
        return [
            f"{issue_id or '当前 issue'} 的目标范围达成",
            "检查组发现的问题已被修复或显式降级",
            "审查组给出 pass 或 pass with noted debt",
        ]
    if phase == "change_acceptance":
        completed_count = sum(1 for issue in issues if str(issue.get("status", "")).strip() == "completed")
        return [
            f"已接受 issue 数量与计划一致，目前 completed={completed_count}",
            "change 级 Must fix now 已清空",
            "可以放行 verify",
        ]
    return [
        "最新 verify 已通过",
        "遗留 debt 已显式记录",
        "可以 archive",
    ]


def phase_scope_items(phase: str, change_dir: Path, issue_id: str, issues: list[dict[str, Any]]) -> list[str]:
    if phase == "spec_readiness":
        return [
            display_path(change_dir.parent.parent.parent, change_dir / "proposal.md"),
            display_path(change_dir.parent.parent.parent, change_dir / "design.md"),
            display_path(change_dir.parent.parent.parent, change_dir / "tasks.md"),
        ]
    if phase == "issue_planning":
        return [
            display_path(change_dir.parent.parent.parent, change_dir / "issues" / "INDEX.md"),
            "openspec/changes/<change>/issues/ISSUE-*.md",
        ]
    if phase == "issue_execution":
        return [issue_id] if issue_id else [issue.get("issue_id", "") for issue in issues if issue.get("issue_id")]
    return ["change-level accepted issues", "control/BACKLOG.md", "latest control/ROUND-*.md"]


def bullet_list(items: list[str]) -> str:
    if not items:
        return "  - none"
    return "\n".join(f"  - {item}" for item in items if item)


def render_phase_packet(
    *,
    repo_root: Path,
    change: str,
    phase: str,
    phase_reason: str,
    issue_id: str,
    control_state: dict[str, Any],
    config: dict[str, Any],
    issues: list[dict[str, Any]],
    issue_team_dispatch_path: str,
) -> str:
    change_dir = repo_root / "openspec" / "changes" / change
    latest_round = control_state.get("latest_round", {})
    backlog = control_state.get("backlog", {})
    target_mode = phase_target_mode(control_state, phase)
    round_goal = phase_goal(phase, change, issue_id, control_state)
    acceptance_criteria = phase_acceptance_criteria(phase, issue_id, issues)
    non_goals = list(latest_round.get("non_goals", []))
    scope_items = phase_scope_items(phase, change_dir, issue_id, issues)
    must_fix_now = backlog.get("must_fix_now", {}).get("open_items", [])
    should_fix_if_cheap = backlog.get("should_fix_if_cheap", {}).get("open_items", [])
    deferred_items = backlog.get("defer", {}).get("open_items", [])
    auto_advance_after_design_review = bool(
        config.get("subagent_team", {}).get("auto_advance_after_design_review", False)
    )

    phase_next_step = {
        "spec_readiness": (
            "审查通过后自动进入 issue planning"
            if auto_advance_after_design_review
            else "审查通过后暂停，等待人工确认后再进入 issue planning"
        ),
        "issue_planning": "审查通过后进入 issue execution",
        "issue_execution": "审查通过后进入下一个 issue 或 change acceptance",
        "change_acceptance": "审查通过后运行 verify，随后 archive",
        "ready_for_archive": "直接 archive 或做最终 closeout",
    }[phase]

    phase_specific_rules = {
        "spec_readiness": [
            "开发组负责补 proposal / design / tasks，不直接跳到 issue 执行。",
            "检查组只指出实现前仍会阻塞 issue 切分的缺口。",
            (
                "审查组通过后自动进入 plan-issues。"
                if auto_advance_after_design_review
                else "审查组通过后默认停住，先让人看 design / tasks，再决定是否进入 plan-issues。"
            ),
        ],
        "issue_planning": [
            "开发组负责修订 INDEX 和 ISSUE 文档。",
            "检查组确认 allowed_scope / out_of_scope / done_when / validation 可执行。",
            "审查组通过后才允许 dispatch issue。",
        ],
        "issue_execution": [
            "开发组可以按 issue team dispatch 调起实现型 subagent。",
            "检查组优先看回归、范围泄漏、证据缺口。",
            "审查组不通过则回到开发组下一轮。",
        ],
        "change_acceptance": [
            "开发组只补 change-level 收尾，不再随意扩 issue scope。",
            "检查组确认已接受 issue 能覆盖请求范围。",
            "审查组通过后才允许 verify。",
        ],
        "ready_for_archive": [
            "不再新增 issue。",
            "仅允许 closeout / archive 所需收尾。",
            "若发现 blocker，重新回到 change_acceptance。",
        ],
    }[phase]

    issue_team_section = ""
    if issue_team_dispatch_path:
        issue_team_section = (
            "## Issue Team Dispatch\n\n"
            f"- Current issue packet:\n  - `{issue_team_dispatch_path}`\n\n"
        )

    return f"""继续 OpenSpec change `{change}`，以 subagent team 主链推进整个复杂变更生命周期。

当前 packet 不是只针对 issue execution，而是整个 change 的当前 lifecycle phase。

## Lifecycle Phase

- Phase:
  - `{phase}`
- Phase reason:
  - {phase_reason}
- Target mode:
  - `{target_mode}`
- Round goal:
  - {round_goal}
- Acceptance criteria:
{bullet_list(acceptance_criteria)}
- Non-goals:
{bullet_list(non_goals)}
- Scope in phase:
{bullet_list(scope_items)}

## Team Topology

- Development group: 3 subagents
  - 负责创建或修订当前 phase 所需产物
- Check group: 3 subagents
  - 负责找 defect / gap / evidence 缺口
- Review group: 3 subagents
  - 负责最终通过 / 不通过裁决

## Coordinator Rules

- 主代理负责整个 change 的 lifecycle orchestration，不只负责单个 issue。
- 标准循环是：开发 -> 检查 -> 修复 -> 审查。
- 审查通过才允许进入下一 phase。
- 审查不通过则回到开发组下一轮。
- backlog / round / stop decision 必须落盘，不留在聊天里。
- 设计文档评审后的自动推进开关：
  - `subagent_team.auto_advance_after_design_review={str(auto_advance_after_design_review).lower()}`

## Current Backlog

- Must fix now:
{bullet_list(must_fix_now)}
- Should fix if cheap:
{bullet_list(should_fix_if_cheap)}
- Defer:
{bullet_list(deferred_items)}

## Phase-Specific Rules
{bullet_list(phase_specific_rules)}

{issue_team_section}## Required Output

1. Phase target
2. Normalized backlog
3. Development changes completed
4. Check result
5. Review verdict
6. Next action

## Exit Condition

- 当前 phase 审查通过：
  - {phase_next_step}
- 当前 phase 审查不通过：
  - 回到开发组，开始下一轮
"""


def render_issue_team_dispatch(
    *,
    repo_root: Path,
    change: str,
    issue_id: str,
    dry_run: bool,
) -> dict[str, Any]:
    command = [
        sys.executable,
        str(ISSUE_TEAM_RENDERER),
        "--repo-root",
        str(repo_root),
        "--change",
        change,
        "--issue-id",
        issue_id,
    ]
    if dry_run:
        command.append("--dry-run")
    process = subprocess.run(command, capture_output=True, text=True)
    if process.returncode != 0:
        raise SystemExit(process.stderr.strip() or process.stdout.strip() or "render_subagent_team_dispatch failed")
    return json.loads(process.stdout)


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    change_dir = repo_root / "openspec" / "changes" / args.change
    control_dir = change_dir / "control"
    control_dir.mkdir(parents=True, exist_ok=True)

    config = load_issue_mode_config(repo_root)
    control_state = read_change_control_state(repo_root, args.change)
    issues = collect_issues(repo_root, args.change)

    if args.phase == "auto":
        phase, detected_issue_id, phase_reason = determine_phase(repo_root, args.change, issues, args.issue_id)
    else:
        phase = args.phase
        detected_issue_id = args.issue_id.strip()
        phase_reason = f"phase 由显式参数 `{phase}` 指定。"

    focus_issue = args.issue_id.strip() or detected_issue_id
    issue_team_dispatch_path = ""
    issue_team_payload: dict[str, Any] = {}
    if phase == "issue_execution" and focus_issue:
        issue_team_payload = render_issue_team_dispatch(
            repo_root=repo_root,
            change=args.change,
            issue_id=focus_issue,
            dry_run=args.dry_run,
        )
        issue_team_dispatch_path = str(issue_team_payload.get("team_dispatch_path", "")).strip()

    lifecycle_packet_path = control_dir / "SUBAGENT-TEAM.dispatch.md"
    packet_text = render_phase_packet(
        repo_root=repo_root,
        change=args.change,
        phase=phase,
        phase_reason=phase_reason,
        issue_id=focus_issue,
        control_state=control_state,
        config=config,
        issues=issues,
        issue_team_dispatch_path=issue_team_dispatch_path,
    )
    if not args.dry_run:
        lifecycle_packet_path.write_text(packet_text)

    result = {
        "generated_at": now_iso(),
        "change": args.change,
        "phase": phase,
        "phase_reason": phase_reason,
        "focus_issue_id": focus_issue,
        "lifecycle_dispatch_path": str(lifecycle_packet_path.relative_to(repo_root)),
        "issue_team_dispatch_path": issue_team_dispatch_path,
        "issue_team_dispatch": issue_team_payload,
        "latest_round_path": display_path(repo_root, latest_round_artifact_path(repo_root, args.change))
        if latest_round_artifact_path(repo_root, args.change)
        else "",
        "auto_advance": {
            "after_design_review": bool(config.get("subagent_team", {}).get("auto_advance_after_design_review", False)),
        },
        "control_state": control_state,
        "issue_count": len(issues),
        "dry_run": args.dry_run,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
