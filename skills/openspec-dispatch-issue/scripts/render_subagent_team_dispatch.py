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

from issue_mode_common import (  # noqa: E402
    display_path,
    ensure_issue_dispatch_allowed,
    issue_progress_path,
    issue_validation_commands,
    issue_worker_worktree_setting,
    load_issue_mode_config,
    parse_frontmatter,
    read_change_control_state,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--issue-id", required=True)
    parser.add_argument("--target-mode", default="")
    parser.add_argument("--round-goal", default="")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def require_list(frontmatter: dict[str, object], key: str) -> list[str]:
    value = frontmatter.get(key)
    if not isinstance(value, list) or not value:
        raise SystemExit(f"Issue doc missing required list field: {key}")
    return [str(item).strip() for item in value if str(item).strip()]


def require_str(frontmatter: dict[str, object], key: str) -> str:
    value = frontmatter.get(key)
    if not isinstance(value, str) or not value.strip():
        raise SystemExit(f"Issue doc missing required field: {key}")
    return value.strip()


def bullet_list(items: list[str]) -> str:
    if not items:
        return "  - none"
    return "\n".join(f"  - {item}" for item in items)


def code_bullet_list(items: list[str]) -> str:
    if not items:
        return "  - `none`"
    return "\n".join(f"  - `{item}`" for item in items)


def issue_paths(repo_root: Path, change: str, issue_id: str) -> tuple[Path, Path, Path]:
    change_dir = repo_root / "openspec" / "changes" / change
    issues_dir = change_dir / "issues"
    issue_path = issues_dir / f"{issue_id}.md"
    team_dispatch_path = issues_dir / f"{issue_id}.team.dispatch.md"
    return change_dir, issue_path, team_dispatch_path


def render_dispatch(
    *,
    change: str,
    issue_id: str,
    title: str,
    allowed_scope: list[str],
    out_of_scope: list[str],
    done_when: list[str],
    validation: list[str],
    worker_worktree: str,
    repo_root: Path,
    progress_path: Path,
    control_state: dict[str, Any],
    dispatch_gate: dict[str, Any],
    target_mode_override: str,
    round_goal_override: str,
) -> str:
    latest_round = control_state.get("latest_round", {})
    backlog = control_state.get("backlog", {})
    target_mode = target_mode_override.strip() or str(latest_round.get("target_mode", "")).strip() or "mvp"
    round_goal = round_goal_override.strip() or str(latest_round.get("round_target", "")).strip() or f"推进 {issue_id} 到可接受状态"
    acceptance_criteria = list(latest_round.get("acceptance_criteria", []))
    non_goals = list(latest_round.get("non_goals", []))
    scope_in_round = list(latest_round.get("scope_in_round", []))
    fixes_completed = list(latest_round.get("fixes_completed", []))
    re_review_result = list(latest_round.get("re_review_result", []))
    acceptance_text = str(latest_round.get("acceptance_text", "")).strip() or "none"
    next_action_text = str(latest_round.get("next_action_text", "")).strip() or "none"
    gate_mode = str(dispatch_gate.get("mode", "advisory")).strip() or "advisory"
    gate_status = str(dispatch_gate.get("status", "not_applicable")).strip() or "not_applicable"
    gate_reason = str(dispatch_gate.get("reason", "")).strip() or "none"
    current_backlog = backlog.get("must_fix_now", {}).get("open_items", [])
    should_fix_if_cheap = backlog.get("should_fix_if_cheap", {}).get("open_items", [])
    deferred_items = backlog.get("defer", {}).get("open_items", [])

    return f"""继续 OpenSpec change `{change}`，以 subagent team 主链推进单个 issue。

这是 coordinator 主会话使用的 team dispatch packet。保持 subagent-team 主链，不要切回旧的 detached worker 运行方式。

## Round Contract

- Target mode:
  - `{target_mode}`
- Round goal:
  - {round_goal}
- Acceptance criteria:
{bullet_list(acceptance_criteria)}
- Non-goals:
{bullet_list(non_goals)}
- Scope in round:
{bullet_list(scope_in_round)}
- Current gate:
  - mode=`{gate_mode}`
  - status=`{gate_status}`
  - reason=`{gate_reason}`

## Issue Contract

- Issue:
  - `{issue_id}` - {title}
- Worker worktree:
  - `{worker_worktree}`
- Workflow artifact repo root:
  - `{repo_root}`
- Issue progress artifact:
  - `{display_path(repo_root, progress_path)}`
- Allowed scope:
{code_bullet_list(allowed_scope)}
- Out of scope:
{code_bullet_list(out_of_scope)}
- Done when:
{bullet_list(done_when)}
- Validation:
{bullet_list(validation)}

## Team Topology

- Development group: 3 subagents
  - Developer 1: core implementation owner
  - Developer 2: dependent module or integration owner
  - Developer 3: tests, fixtures, cleanup owner
  - Launch with `reasoning_effort=xhigh`
  - Why: 当前 issue round 预期会修改 repo 代码、测试或集成实现。
- Check group: 3 subagents
  - Checker 1: functional correctness, main path, edge cases
  - Checker 2: architecture, data flow, concurrency, persistence risks
  - Checker 3: regression risk, tests, evidence gaps
  - Launch with `reasoning_effort=medium`
  - Why: checker 只负责缺口识别、证据核对和最小修复建议。
- Review group: 3 subagents
  - Reviewer 1: target path pass / fail
  - Reviewer 2: regression and operational risk pass / fail
  - Reviewer 3: evidence completeness pass / fail
  - Launch with `reasoning_effort=medium`
  - Why: reviewer 只负责验收裁决、风险判断和证据充分性检查。

## Coordinator Responsibilities

- 主代理负责 orchestration、scope control、issue dedupe、normalized backlog、stop decision。
- 拉起 subagent 时必须显式设置 `reasoning_effort`，不要直接继承当前会话的全局默认值。
- 标准循环是：开发 -> 检查 -> 修复 -> 审查。
- 检查组结果必须先统一归并，再交给开发组修复；不要把原始检查碎片直接下发。
- 审查组负责最终通过/不通过判断；审查不通过就回到开发组开始下一轮。
- coordinator 继续拥有：
  - `control/BACKLOG.md`
  - latest `control/ROUND-*.md`
  - `tasks.md`
  - review / merge / commit
  - `verify`
  - `archive`

## Current Change-Level Backlog

- Must fix now:
{bullet_list(current_backlog)}
- Should fix if cheap:
{bullet_list(should_fix_if_cheap)}
- Defer:
{bullet_list(deferred_items)}

## Check Packet Rules

- 所有 checker 都读同一份 round contract 和 issue contract。
- checker subagent 启动时显式使用 `reasoning_effort=medium`。
- 只输出：
  - defect / gap 或 none
  - 为什么它会阻塞当前 `{target_mode}` 目标
  - 证据
  - 最小修复建议
- 不要输出纯风格建议，不要扩展需求。

## Development Packet Rules

- 先完成当前 issue 范围内的开发，再只处理 coordinator 批准进入本轮 backlog 的问题。
- 尽量按文件/模块 ownership 分配，减少写集重叠。
- 负责实现或修复 repo 代码的 development subagent 必须显式使用 `reasoning_effort=xhigh`。
- 执行代码实现的 subagent 必须先写：
  - `python3 .codex/skills/openspec-execute-issue/scripts/update_issue_progress.py start --repo-root "{repo_root}" --change "{change}" --issue-id "{issue_id}" --status in_progress --boundary-status working --next-action continue_issue --summary "已进入 subagent team repair round。"`
- 停止前必须写：
  - `python3 .codex/skills/openspec-execute-issue/scripts/update_issue_progress.py stop --repo-root "{repo_root}" --change "{change}" --issue-id "{issue_id}" --status completed --boundary-status review_required --next-action coordinator_review --summary "issue 边界内修复已完成，等待 coordinator 收敛。" --validation "lint=<pending-or-passed>" --validation "typecheck=<pending-or-passed>" --changed-file "<path>"`
- 不要自合并，不要更新 `tasks.md`。

## Review Packet Rules

- reviewer subagent 启动时显式使用 `reasoning_effort=medium`。
- 审查组只回答：
  - verdict: `pass` / `pass with noted debt` / `fail`
  - evidence
  - blocking gap 或 `none`
- `pass` 才允许结束本轮；`fail` 则回到开发组开始下一轮。
- 如果两三轮后仍停滞，优先缩 scope 或收紧目标，不要默认扩 backlog。

## Latest Round Signals

- Fixes completed:
{bullet_list(fixes_completed)}
- Re-review result:
{bullet_list(re_review_result)}
- Acceptance verdict:
  - {acceptance_text}
- Next action hint:
  - {next_action_text}

## Required Round Output

1. Round target
2. Normalized backlog
3. Fixes completed
4. Re-review result
5. Acceptance verdict
6. Next action
"""


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    config = load_issue_mode_config(repo_root)
    change_dir, issue_path, team_dispatch_path = issue_paths(repo_root, args.change, args.issue_id)
    control_state = read_change_control_state(repo_root, args.change)
    dispatch_gate = ensure_issue_dispatch_allowed(config, control_state, args.issue_id)

    if not issue_path.exists():
        raise SystemExit(f"Issue doc not found: {issue_path}")

    frontmatter = parse_frontmatter(issue_path.read_text())
    if not frontmatter:
        raise SystemExit("Issue doc missing valid frontmatter.")

    title = require_str(frontmatter, "title")
    allowed_scope = require_list(frontmatter, "allowed_scope")
    out_of_scope = require_list(frontmatter, "out_of_scope")
    done_when = require_list(frontmatter, "done_when")
    worker_worktree, worker_worktree_source = issue_worker_worktree_setting(
        repo_root=repo_root,
        change=args.change,
        issue_id=args.issue_id,
        config=config,
    )
    validation, validation_source = issue_validation_commands(
        repo_root=repo_root,
        change=args.change,
        issue_id=args.issue_id,
        config=config,
    )
    progress_path = issue_progress_path(repo_root, args.change, args.issue_id)
    dispatch_text = render_dispatch(
        change=args.change,
        issue_id=args.issue_id,
        title=title,
        allowed_scope=allowed_scope,
        out_of_scope=out_of_scope,
        done_when=done_when,
        validation=validation,
        worker_worktree=worker_worktree,
        repo_root=repo_root,
        progress_path=progress_path,
        control_state=control_state,
        dispatch_gate=dispatch_gate,
        target_mode_override=args.target_mode,
        round_goal_override=args.round_goal,
    )
    if not args.dry_run:
        change_dir.mkdir(parents=True, exist_ok=True)
        team_dispatch_path.write_text(dispatch_text)

    payload = {
        "change": args.change,
        "issue_id": args.issue_id,
        "team_dispatch_path": str(team_dispatch_path.relative_to(repo_root)),
        "worker_worktree": worker_worktree,
        "worker_worktree_source": worker_worktree_source,
        "progress_path": display_path(repo_root, progress_path),
        "validation": validation,
        "validation_source": validation_source,
        "control_gate": dispatch_gate,
        "control_state": control_state,
        "reasoning_policy": {
            "development_group": "xhigh",
            "check_group": "medium",
            "review_group": "medium",
        },
        "config_path": config["config_path"],
        "dry_run": args.dry_run,
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
