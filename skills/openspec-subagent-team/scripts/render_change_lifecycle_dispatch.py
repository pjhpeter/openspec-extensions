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

from coordinator_change_common import (  # noqa: E402
    read_json,
    review_artifact_is_current,
    review_artifact_path,
    verification_artifact_is_current,
    verify_artifact_path,
)
from issue_mode_common import (  # noqa: E402
    automation_profile,
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
            "change_verify",
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
    current = bool(verify_payload) and verification_artifact_is_current(issues, verify_payload)
    status = str(verify_payload.get("status", "")).strip() if verify_payload else ""
    return {
        "artifact": verify_payload,
        "current": current,
        "status": status,
        "passed": current and status == "passed",
        "failed": current and status == "failed",
    }


def current_review_state(repo_root: Path, change: str, issues: list[dict[str, Any]]) -> dict[str, Any]:
    review_payload = read_json(review_artifact_path(repo_root, change))
    current = bool(review_payload) and review_artifact_is_current(issues, review_payload)
    status = str(review_payload.get("status", "")).strip() if review_payload else ""
    return {
        "artifact": review_payload,
        "current": current,
        "status": status,
        "passed": current and status == "passed",
        "failed": current and status == "failed",
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


def determine_phase(
    repo_root: Path,
    change: str,
    issues: list[dict[str, Any]],
    explicit_issue_id: str,
    *,
    control_state: dict[str, Any],
    config: dict[str, Any],
) -> tuple[str, str, str]:
    change_dir = repo_root / "openspec" / "changes" / change
    proposal_path = change_dir / "proposal.md"
    design_path = change_dir / "design.md"
    tasks_path = change_dir / "tasks.md"
    issues_index_path = change_dir / "issues" / "INDEX.md"

    missing_core = [path.name for path in (proposal_path, design_path) if not path.exists()]
    if missing_core:
        return "spec_readiness", "", f"变更基础文档未齐全：{', '.join(missing_core)}。"
    if not tasks_path.exists():
        return "spec_readiness", "", "设计文档已齐全，但必须先经过 1 个设计作者和 2 个设计评审组成的 subagent team；评审通过后才能进行任务拆分。"

    issue_docs = [issue for issue in issues if issue.get("issue_path")]
    if not issues_index_path.exists() or not issue_docs:
        return "issue_planning", "", "任务拆分 / issue 规划工件未完成，需先产出或修订 tasks.md、INDEX 和 ISSUE 文档。"

    selected_issue_id = explicit_issue_id.strip() or focus_issue_id(issues)
    incomplete = [issue for issue in issues if str(issue.get("status", "")).strip() != "completed"]
    if incomplete:
        return "issue_execution", selected_issue_id, "仍有 issue 未完成，继续执行当前 issue 回合。"

    review_state = current_review_state(repo_root, change, issues)
    if review_state["failed"]:
        return "change_acceptance", "", "全部 issue 已完成，但最近一次 change-level /review 未通过，需要先修复 review findings。"
    if not review_state["passed"]:
        if review_state["artifact"]:
            return "change_acceptance", "", "全部 issue 已完成，但 change-level /review 工件已过期，需要重新运行后再决定是否 verify。"
        return "change_acceptance", "", "全部 issue 已完成，需先对当前 change 修改的代码运行 /review，然后才能进入 verify。"

    verify_state = current_verify_state(repo_root, change, issues)
    latest_round = control_state.get("latest_round", {})
    auto_accept_change_acceptance = bool(config.get("subagent_team", {}).get("auto_accept_change_acceptance", False))
    if verify_state["passed"]:
        return "ready_for_archive", "", "最新 verify 已通过，change 可以进入归档收尾。"
    if verify_state["failed"]:
        return "change_verify", "", "最近一次 verify 未通过，需要修复并重新验证。"
    if auto_accept_change_acceptance and (not control_state.get("enabled") or bool(latest_round.get("allows_verify", False))):
        return "change_verify", "", "全部 issue 已完成，配置允许自动进入 verify 阶段。"
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
    if phase in {"change_acceptance", "change_verify", "ready_for_archive"}:
        return "release"
    return "quality"


def phase_goal(phase: str, change: str, issue_id: str, control_state: dict[str, Any]) -> str:
    latest_round = control_state.get("latest_round", {})
    explicit_goal = str(latest_round.get("round_target", "")).strip()
    if explicit_goal:
        return explicit_goal
    if phase == "spec_readiness":
        return f"把 {change} 的 proposal / design 补齐到可评审状态，并完成设计评审后再进入任务拆分。"
    if phase == "issue_planning":
        return f"基于已通过的设计评审，产出 {change} 的 tasks.md、INDEX 和 ISSUE 文档，并让任务拆分通过审查。"
    if phase == "issue_execution":
        return f"推进 {issue_id or '当前 issue'} 完成开发、检查、修复、审查回合。"
    if phase == "change_acceptance":
        return f"先对 {change} 当前代码运行 /review，再确认它已达到 verify / archive 前的 change 级通过条件。"
    if phase == "change_verify":
        return f"在已通过 change-level /review 后，对 {change} 运行 change 级 verify，并处理验证失败或遗漏项。"
    return f"{change} 已满足归档前条件，执行最终收尾。"


def phase_acceptance_criteria(phase: str, issue_id: str, issues: list[dict[str, Any]]) -> list[str]:
    if phase == "spec_readiness":
        return [
            "proposal / design 齐全且相互一致",
            "范围、约束、非目标足够清楚，足以进入任务拆分",
            "2 个 design review subagent 都给出通过结论，允许进入 plan-issues",
        ]
    if phase == "issue_planning":
        return [
            "tasks.md、INDEX 和 ISSUE 文档齐全且相互一致",
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
            "CHANGE-REVIEW.json 为当前 issue 集合的最新 review 结果，且 verdict=pass",
            "change 级 Must fix now 已清空",
            "可以放行 verify",
        ]
    if phase == "change_verify":
        return [
            "CHANGE-REVIEW.json 为当前 issue 集合的最新 review 结果，且 verdict=pass",
            "repository validation commands 全部通过",
            "tasks.md 不再包含未勾选项",
            "CHANGE-VERIFY.json 为当前 issue 集合的最新验证结果",
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
        ]
    if phase == "issue_planning":
        return [
            display_path(change_dir.parent.parent.parent, change_dir / "tasks.md"),
            display_path(change_dir.parent.parent.parent, change_dir / "issues" / "INDEX.md"),
            "openspec/changes/<change>/issues/ISSUE-*.md",
        ]
    if phase == "issue_execution":
        return [issue_id] if issue_id else [issue.get("issue_id", "") for issue in issues if issue.get("issue_id")]
    if phase == "change_verify":
        return [
            "control/BACKLOG.md",
            "tasks.md",
            "runs/CHANGE-REVIEW.json",
            "runs/CHANGE-VERIFY.json",
            "repo validation commands",
        ]
    if phase == "change_acceptance":
        return ["control/BACKLOG.md", "runs/CHANGE-REVIEW.json", "current change diff for /review"]
    return ["change-level accepted issues", "control/BACKLOG.md", "latest control/ROUND-*.md"]


def phase_command_hints(repo_root: Path, change: str, phase: str) -> list[str]:
    if phase == "change_acceptance":
        return [
            f'python3 .codex/skills/openspec-shared/scripts/coordinator_review_change.py --repo-root "{repo_root}" --change "{change}"'
        ]
    if phase == "change_verify":
        return [
            f'python3 .codex/skills/openspec-shared/scripts/coordinator_verify_change.py --repo-root "{repo_root}" --change "{change}"'
        ]
    if phase == "ready_for_archive":
        return [f'openspec archive "{change}"']
    return []


def bullet_list(items: list[str]) -> str:
    if not items:
        return "  - none"
    return "\n".join(f"  - {item}" for item in items if item)


def phase_team_topology(phase: str) -> list[dict[str, Any]]:
    if phase == "spec_readiness":
        return [
            {
                "key": "design_author",
                "label": "Design author",
                "count": 1,
                "responsibility": "负责起草或修订 proposal / design，吸收反馈并提交可评审版本。",
                "reasoning_effort": "xhigh",
                "reasoning_note": "设计文档编写需要更强的上下文整合、方案权衡和风险推敲。",
            },
            {
                "key": "design_review",
                "label": "Design review",
                "count": 2,
                "responsibility": "负责从需求边界、技术可行性和交付风险角度做通过 / 不通过评审。",
                "reasoning_effort": "medium",
                "reasoning_note": "设计评审只做判定与阻塞缺口定位，不承担编写或编码。",
            },
        ]
    if phase == "issue_planning":
        return [
            {
                "key": "development_group",
                "label": "Development group",
                "count": 2,
                "responsibility": "负责创建或修订 tasks.md、INDEX 和 ISSUE 文档。",
                "reasoning_effort": "medium",
                "reasoning_note": "任务拆分阶段默认使用更轻的快路径，不把 planning review 扩成重型多席位审查。",
            },
            {
                "key": "check_group",
                "label": "Check group",
                "count": 1,
                "responsibility": "负责检查 issue 文档字段、边界和 validation 是否可执行。",
                "reasoning_effort": "medium",
                "reasoning_note": "planning check 默认只做边界与可执行性校验，避免重型审查拖慢派发。",
            },
            {
                "key": "review_group",
                "label": "Review group",
                "count": 1,
                "responsibility": "负责裁决任务拆分是否达到可派发状态。",
                "reasoning_effort": "medium",
                "reasoning_note": "planning review 默认只保留一个硬门禁 seat，必要时再升级。",
            },
        ]
    if phase == "issue_execution":
        return [
            {
                "key": "development_group",
                "label": "Development group",
                "count": 3,
                "responsibility": "负责创建或修订当前 phase 所需产物。",
                "reasoning_effort": "xhigh",
                "reasoning_note": "当前 phase 预期会修改 repo 代码、测试或集成实现。",
            },
            {
                "key": "check_group",
                "label": "Check group",
                "count": 2,
                "responsibility": "负责在 issue 边界内找 defect、回归和证据缺口。",
                "reasoning_effort": "medium",
                "reasoning_note": "issue round 默认只激活功能/回归两个 checker seat，避免检查扩大成全仓扫描。",
            },
            {
                "key": "review_group",
                "label": "Review group",
                "count": 1,
                "responsibility": "负责基于 issue 边界、validation 和直接依赖风险做最终通过 / 不通过裁决。",
                "reasoning_effort": "medium",
                "reasoning_note": "issue round 默认只保留一个 scope-first reviewer，发现跨边界风险时再升级更多 seat。",
            },
        ]
    if phase == "change_acceptance":
        return [
            {
                "key": "development_group",
                "label": "Development group",
                "count": 1,
                "responsibility": "负责修补当前 acceptance gate 暴露出的最小缺口。",
                "reasoning_effort": "medium",
                "reasoning_note": "change acceptance 默认使用轻量 closeout 拓扑，不再重复 issue 级重审。",
            },
            {
                "key": "check_group",
                "label": "Check group",
                "count": 1,
                "responsibility": "负责核对 change-level review、范围覆盖和遗留 blocker。",
                "reasoning_effort": "medium",
                "reasoning_note": "acceptance check 默认只保留一个 gate seat，用于快速核对放行条件。",
            },
            {
                "key": "review_group",
                "label": "Review group",
                "count": 1,
                "responsibility": "负责最终确认 change 是否可以进入 verify。",
                "reasoning_effort": "medium",
                "reasoning_note": "acceptance review 默认只保留一个硬门禁裁决 seat。",
            },
        ]
    if phase == "change_verify":
        return [
            {
                "key": "development_group",
                "label": "Development group",
                "count": 2,
                "responsibility": "负责创建或修订当前 phase 所需产物。",
                "reasoning_effort": "xhigh",
                "reasoning_note": "verify 修复默认保留实现与测试两个开发 seat，避免重型多席位 closeout。",
            },
            {
                "key": "check_group",
                "label": "Check group",
                "count": 1,
                "responsibility": "负责核对 verify 失败点、validation 结果和任务完成状态。",
                "reasoning_effort": "medium",
                "reasoning_note": "verify check 默认只保留一个 gate seat，用于快速复核放行条件。",
            },
            {
                "key": "review_group",
                "label": "Review group",
                "count": 1,
                "responsibility": "负责最终确认 verify 结果是否足以进入 archive。",
                "reasoning_effort": "medium",
                "reasoning_note": "verify review 默认只保留一个硬门禁裁决 seat。",
            },
        ]
    return [
        {
            "key": "development_group",
            "label": "Development group",
            "count": 1,
            "responsibility": "负责创建或修订当前 phase 所需产物。",
            "reasoning_effort": "medium",
            "reasoning_note": "closeout phase 默认使用轻量拓扑，不重复 issue 级多人回合。",
        },
        {
            "key": "check_group",
            "label": "Check group",
            "count": 1,
            "responsibility": "负责核对 closeout 所需证据和收尾条件。",
            "reasoning_effort": "medium",
            "reasoning_note": "closeout check 默认只保留一个 gate seat。",
        },
        {
            "key": "review_group",
            "label": "Review group",
            "count": 1,
            "responsibility": "负责最终通过 / 不通过裁决。",
            "reasoning_effort": "medium",
            "reasoning_note": "closeout review 默认只保留一个硬门禁 seat。",
        },
    ]


def render_team_topology(items: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for item in items:
        lines.append(f"- {item['label']}: {item['count']} subagent{'s' if int(item['count']) != 1 else ''}")
        lines.append(f"  - {item['responsibility']}")
        lines.append(f"  - Launch with `reasoning_effort={item['reasoning_effort']}`")
        lines.append(f"  - Why: {item['reasoning_note']}")
    return "\n".join(lines)


def render_gate_bearing_seats(items: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for item in items:
        label = str(item["label"]).strip()
        count = int(item["count"])
        lines.append(f"- {label}: {count} required completion{'s' if count != 1 else ''}")
    return "\n".join(lines)


def phase_round_loop(phase: str) -> str:
    if phase == "spec_readiness":
        return "设计编写 -> 双评审 -> 修订 -> 双评审"
    return "开发 -> 检查 -> 修复 -> 审查"


def phase_required_output(phase: str) -> list[str]:
    if phase == "spec_readiness":
        return [
            "Phase target",
            "Gate-bearing subagent roster with seat / agent_id / status",
            "Design author changes completed",
            "Reviewer 1 verdict",
            "Reviewer 2 verdict",
            "Normalized review gaps",
            "Next action",
        ]
    return [
        "Phase target",
        "Gate-bearing subagent roster with seat / agent_id / status",
        "Normalized backlog",
        "Development changes completed",
        "Check result",
        "Review verdict",
        "Next action",
    ]


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
    team_topology = phase_team_topology(phase)
    round_loop = phase_round_loop(phase)
    required_output = phase_required_output(phase)
    subagent_team = config.get("subagent_team", {})
    auto_accept_spec_readiness = bool(subagent_team.get("auto_accept_spec_readiness", False))
    auto_accept_issue_planning = bool(subagent_team.get("auto_accept_issue_planning", False))
    auto_accept_issue_review = bool(subagent_team.get("auto_accept_issue_review", False))
    auto_accept_change_acceptance = bool(subagent_team.get("auto_accept_change_acceptance", False))
    auto_archive_after_verify = bool(subagent_team.get("auto_archive_after_verify", False))
    automation_mode = automation_profile(config)
    command_hints = phase_command_hints(repo_root, change, phase)
    coordinator_commands_section = ""
    if command_hints:
        coordinator_commands_section = f"## Coordinator Commands\n\n{bullet_list(command_hints)}\n\n"

    phase_next_step = {
        "spec_readiness": (
            "当前 phase 的 gate-bearing subagent 全部完成且 verdict 满足条件后，coordinator 自动通过 design review，并进入任务拆分 / issue planning"
            if auto_accept_spec_readiness
            else "1 个设计作者和 2 个设计评审全部完成并收齐通过结论后暂停，等待人工确认后再进入任务拆分 / issue planning"
        ),
        "issue_planning": (
            "当前 phase 的 gate-bearing subagent 全部完成且 verdict 满足条件后，coordinator 自动通过 issue planning 评审并派发当前 round 已批准的 issue"
            if auto_accept_issue_planning
            else "审查组 verdict 全部收齐并通过后暂停，等待人工确认后再进入 issue execution"
        ),
        "issue_execution": (
            "当前 round 的 gate-bearing subagent 全部完成、issue 校验通过且审查 verdict 满足条件后，coordinator 自动接受并合并该 issue，然后进入下一个 issue 或 change acceptance"
            if auto_accept_issue_review
            else "审查组 verdict 全部收齐并通过后暂停，等待人工确认是否继续派发下一个 issue"
        ),
        "change_acceptance": (
            "当前 phase 的 gate-bearing subagent 全部完成、change-level /review 已通过后，coordinator 自动通过 change acceptance 并运行 verify"
            if auto_accept_change_acceptance
            else "审查组 verdict 全部收齐并通过后暂停，等待人工确认后再运行 verify"
        ),
        "change_verify": (
            "verify 通过后自动进入 archive"
            if auto_archive_after_verify
            else "verify 通过后暂停，等待人工确认后再 archive"
        ),
        "ready_for_archive": (
            "直接进入 archive / closeout"
            if auto_archive_after_verify
            else "等待人工确认后再 archive / closeout"
        ),
    }[phase]

    phase_specific_rules = {
        "spec_readiness": [
            "spec_readiness 使用专用拓扑，不复用通用的 3-3-3 team shape。",
            "Design author 负责补 proposal / design，不在 design review 通过前做任务拆分。",
            "Design author 启动时使用 `reasoning_effort=xhigh`；2 个 design review subagent 使用 `reasoning_effort=medium`。",
            "2 个 design review subagent 直接给出 pass / fail 和 blocking gap，不单独再设 check group。",
            "只有 2 个 reviewer 都通过，才允许进入 plan-issues / 任务拆分。",
            (
                "当 `auto_accept_spec_readiness=true` 时，coordinator 在 gate-bearing 设计评审 subagent 全部完成并收齐通过结论后，不等待人工签字，直接把 design review 视为通过并进入 plan-issues。"
                if auto_accept_spec_readiness
                else "审查组通过后默认停住，先让人看 design，再决定是否进入 plan-issues。"
            ),
        ],
        "issue_planning": [
            "开发组负责基于已通过的设计评审产出或修订 tasks.md、INDEX 和 ISSUE 文档。",
            "issue planning 不以写 repo 代码为目标，本 phase 默认使用 2 个开发 seat + 1 个 checker + 1 个 reviewer 的快路径，全部使用 `reasoning_effort=medium`。",
            "检查组确认 allowed_scope / out_of_scope / done_when / validation 可执行。",
            "planning check/review 默认只看 tasks.md、INDEX、ISSUE frontmatter 和当前 round contract，不做无关扩展阅读。",
            (
                "当 `auto_accept_issue_planning=true` 时，coordinator 在当前 phase 的 gate-bearing planning/check/review subagent 全部完成并收齐 verdict 后，不等待人工签字，直接把 issue planning 视为通过并派发当前 round 已批准的 issue。"
                if auto_accept_issue_planning
                else "审查组通过后默认停住，先让 coordinator 人工确认，再 dispatch issue。"
            ),
        ],
        "issue_execution": [
            "开发组可以按 issue team dispatch 调起实现型 subagent。",
            "issue round 默认使用 3 个开发 seat + 2 个 checker + 1 个 reviewer 的快路径；编码型开发 subagent 使用 `reasoning_effort=xhigh`，检查组和审查组使用 `reasoning_effort=medium`。",
            "checker / reviewer 必须先看 `changed_files`（若 progress artifact 已记录），没有时先看 `allowed_scope` 和 issue validation，再按需扩到直接依赖面。",
            "默认不要读取 `node_modules`、`dist`、`build`、`.next`、`coverage` 这类生成/供应商目录；只有当前 issue 明确把这些路径写进 `allowed_scope` 时才允许查看。",
            "不要把 issue check/review 扩成 repo-wide 扫描；只有出现跨边界架构风险或证据争议时，coordinator 才升级更多 checker / reviewer seat。",
            (
                "当 `auto_accept_issue_review=true` 时，coordinator 会在 gate-bearing check/review subagent 全部完成且 issue-local validation 全部通过后自动接受并 merge 当前 issue，再继续后续 phase。"
                if auto_accept_issue_review
                else "审查组通过后默认停住，让 coordinator 先确认是否派发下一个 issue。"
            ),
            "审查组不通过则回到开发组下一轮。",
        ],
        "change_acceptance": [
            "change acceptance 先要求 coordinator 对当前 change 修改的代码运行 change-level /review，并落盘 `runs/CHANGE-REVIEW.json`。",
            "开发组只补 change-level review 或 acceptance 暴露出的缺口，不再随意扩 issue scope。",
            "change acceptance 默认不是编码 phase；使用 1 个开发 seat + 1 个 checker + 1 个 reviewer 的轻量 gate，全部使用 `reasoning_effort=medium`。",
            "检查组确认已接受 issue 能覆盖请求范围。",
            "只有 change-level /review 通过后，才允许继续进入 verify。",
            (
                "当 `auto_accept_change_acceptance=true` 时，coordinator 在 gate-bearing 审查 subagent 全部完成且 change-level /review 通过后不等待人工签字，直接把 change acceptance 视为通过并切到 verify。"
                if auto_accept_change_acceptance
                else "审查组通过后默认停住，让 coordinator 先确认是否运行 verify。"
            ),
        ],
        "change_verify": [
            "进入 verify 前，change-level /review 必须已经通过；不要跳过这一步直接运行 verify。",
            "开发组只处理 verify 失败所暴露的缺口，不再随意新增 issue。",
            "verify 默认使用 2 个开发 seat + 1 个 checker + 1 个 reviewer 的快路径；如果 verify 暴露出代码/测试缺口，开发组 subagent 使用 `reasoning_effort=xhigh`，检查组和审查组使用 `reasoning_effort=medium`。",
            "检查组负责运行并检查 repo validation、tasks completion、verify artifact。",
            (
                "verify 通过后自动进入 archive 阶段。"
                if auto_archive_after_verify
                else "verify 通过后默认停住，让 coordinator 先确认是否 archive。"
            ),
        ],
        "ready_for_archive": [
            "不再新增 issue。",
            "archive 收尾阶段默认使用 1 个开发 seat + 1 个 checker + 1 个 reviewer 的轻量 closeout 拓扑，全部使用 `reasoning_effort=medium`。",
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
- Automation profile:
  - `{automation_mode}`
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

{render_team_topology(team_topology)}

## Gate Barrier

- Gate-bearing seats for this phase:
{render_gate_bearing_seats(team_topology)}
- Barrier rules:
  - 当前 phase 里真正拉起的这些 gate-bearing subagent 必须记录 seat、`agent_id` 和状态。
  - 对 gate-bearing subagent 使用最长 1 小时的 blocking wait，不要 30 秒短轮询。
  - 任一 required gate-bearing subagent 仍在运行时，不允许提前通过当前 phase。
  - 任一 required gate-bearing subagent 仍在运行时，不允许提前关闭它。
  - design review / check / review 这类 gate-bearing seat 不要当作 `explorer` sidecar。
  - `auto_accept_*` 只跳过人工签字，不跳过 gate-bearing subagent 的完成等待。

## Coordinator Rules

- 主代理负责整个 change 的 lifecycle orchestration，不只负责单个 issue。
- 当前 phase 的标准循环是：{round_loop}。
- 拉起 subagent 时必须显式设置 `reasoning_effort`，不要直接继承当前会话的全局默认值。
- gate-bearing subagent 的 `agent_id`、seat 和完成状态必须落盘或写入 round 输出，不能只留在聊天里。
- 对当前 phase 的 gate-bearing subagent 使用最长 1 小时的 blocking wait，不要短轮询后提前返回。
- 不要把当前 phase 的 gate-bearing review/check seat 当成 `explorer` sidecar。
- 审查通过才允许进入下一 phase。
- 审查不通过则回到开发组下一轮。
- 任一 required gate-bearing subagent 仍在运行时，不允许 accept 当前 phase，也不允许关闭这些 subagent。
- backlog / round / stop decision 必须落盘，不留在聊天里。
- 当前自动推进开关：
  - `subagent_team.auto_accept_spec_readiness={str(auto_accept_spec_readiness).lower()}`
  - `subagent_team.auto_accept_issue_planning={str(auto_accept_issue_planning).lower()}`
  - `subagent_team.auto_accept_issue_review={str(auto_accept_issue_review).lower()}`
  - `subagent_team.auto_accept_change_acceptance={str(auto_accept_change_acceptance).lower()}`
  - `subagent_team.auto_archive_after_verify={str(auto_archive_after_verify).lower()}`
  - `rra.gate_mode={str(config.get("rra", {}).get("gate_mode", "advisory")).strip() or "advisory"}`

## Current Backlog

- Must fix now:
{bullet_list(must_fix_now)}
- Should fix if cheap:
{bullet_list(should_fix_if_cheap)}
- Defer:
{bullet_list(deferred_items)}

## Phase-Specific Rules
{bullet_list(phase_specific_rules)}

{coordinator_commands_section}{issue_team_section}## Required Output

{chr(10).join(f"{index}. {item}" for index, item in enumerate(required_output, start=1))}

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
        phase, detected_issue_id, phase_reason = determine_phase(
            repo_root,
            args.change,
            issues,
            args.issue_id,
            control_state=control_state,
            config=config,
        )
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
        "automation": {
            "accept_spec_readiness": bool(config.get("subagent_team", {}).get("auto_accept_spec_readiness", False)),
            "accept_issue_planning": bool(config.get("subagent_team", {}).get("auto_accept_issue_planning", False)),
            "accept_issue_review": bool(config.get("subagent_team", {}).get("auto_accept_issue_review", False)),
            "accept_change_acceptance": bool(
                config.get("subagent_team", {}).get("auto_accept_change_acceptance", False)
            ),
            "archive_after_verify": bool(config.get("subagent_team", {}).get("auto_archive_after_verify", False)),
        },
        "automation_profile": automation_profile(config),
        "team_topology": phase_team_topology(phase),
        "control_state": control_state,
        "issue_count": len(issues),
        "dry_run": args.dry_run,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
