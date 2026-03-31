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


def read_progress_snapshot(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}


def normalize_string_list(items: Any) -> list[str]:
    if not isinstance(items, list):
        return []
    return [str(item).strip() for item in items if str(item).strip()]


REVIEW_EXCLUDED_DIRS = {"node_modules", "dist", "build", ".next", "coverage"}


def path_parts(path: str) -> tuple[str, ...]:
    return tuple(part for part in Path(path).parts if part not in {"", "."})


def path_hits_review_excluded_dir(path: str) -> bool:
    return any(part in REVIEW_EXCLUDED_DIRS for part in path_parts(path))


def scope_matches_path(scope: str, path: str) -> bool:
    scope_tokens = path_parts(scope)
    path_tokens = path_parts(path)
    if not scope_tokens or not path_tokens:
        return False
    return path_tokens[: len(scope_tokens)] == scope_tokens or scope_tokens[: len(path_tokens)] == path_tokens


def scope_explicitly_allows_review_path(path: str, allowed_scope: list[str]) -> bool:
    for scope in allowed_scope:
        if path_hits_review_excluded_dir(scope) and scope_matches_path(scope, path):
            return True
    return False


def filter_review_focus_paths(paths: list[str], allowed_scope: list[str]) -> tuple[list[str], list[str]]:
    included: list[str] = []
    excluded: list[str] = []
    for path in paths:
        if path_hits_review_excluded_dir(path) and not scope_explicitly_allows_review_path(path, allowed_scope):
            excluded.append(path)
            continue
        included.append(path)
    return included, excluded


def validation_snapshot_lines(payload: dict[str, Any]) -> list[str]:
    validation = payload.get("validation")
    if not isinstance(validation, dict) or not validation:
        return ["none"]
    return [f"{key}={value}" for key, value in validation.items() if str(key).strip()]


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
    progress_snapshot: dict[str, Any],
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
    current_changed_files = normalize_string_list(progress_snapshot.get("changed_files"))
    current_changed_files, excluded_review_paths = filter_review_focus_paths(current_changed_files, allowed_scope)
    current_validation = validation_snapshot_lines(progress_snapshot)
    current_focus = current_changed_files or allowed_scope
    excluded_review_paths_section = ""
    if excluded_review_paths:
        excluded_review_paths_section = (
            "- Excluded incidental paths from review focus:\n"
            f"{code_bullet_list(excluded_review_paths)}"
        )

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
- Issue workspace (`worker_worktree`):
  - `{worker_worktree}`
- Workflow artifact repo root:
  - `{repo_root}`
- Issue progress artifact:
  - `{display_path(repo_root, progress_path)}`
- Current changed-file focus:
{code_bullet_list(current_changed_files)}
- Current review starting scope:
{code_bullet_list(current_focus)}
{excluded_review_paths_section}
- Latest issue-local validation snapshot:
{bullet_list(current_validation)}
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
- Check group: 2 subagents
  - Checker 1: changed files / allowed scope functional correctness, main path, edge cases
  - Checker 2: direct dependency regression risk, tests, evidence gaps
  - Launch with `reasoning_effort=medium`
  - Why: checker 默认走 scope-first 快路径，只检查当前 issue 变更面及其直接依赖风险。
- Review group: 1 subagent
  - Reviewer 1: scope-first target path / direct dependency / evidence pass or fail
  - Launch with `reasoning_effort=medium`
  - Why: reviewer 默认只保留一个硬门禁 seat，对当前 issue 做快速裁决；更重审查只在升级时启动。

## Gate Barrier

- Gate-bearing seats for this round:
  - Development group: launched seats must complete or explicitly report no-op before round close
  - Check group: all launched checker seats must complete and be normalized before repair / review decisions
  - Review group: all launched reviewer seats must complete and be collected before the round can pass
- Barrier rules:
  - 记录当前 round gate-bearing subagent 的 seat、`agent_id` 和状态。
  - 对 gate-bearing subagent 使用最长 1 小时的 blocking wait，不要 30 秒短轮询。
  - 任一 required gate-bearing subagent 仍在运行时，不允许提前通过当前 round。
  - 任一 required gate-bearing subagent 仍在运行时，不允许提前关闭它。
  - gate-bearing check/review subagent 不要当作 `explorer` sidecar。
  - `auto_accept_issue_review=true` 只跳过人工签字，不跳过 gate-bearing subagent 的完成等待。

## Scope-First Review Focus

- checker / reviewer 先看当前 issue progress 里的 `changed_files`；如果还没有，就从 `allowed_scope` 开始。
- 默认只审当前 issue 变更面、`allowed_scope`、issue validation 和直接依赖 / 直接调用链。
- 默认排除 `node_modules`、`dist`、`build`、`.next`、`coverage` 这类生成/供应商目录；只有当前 issue 明确把这些路径写进 `allowed_scope` 时才允许查看。
- 只有为确认 blocker、回归或直接依赖风险时，才允许扩大阅读范围。
- 不要做 repo-wide 扫描，不要扩展到与当前 issue 无直接关系的模块。

## Coordinator Responsibilities

- 主代理负责 orchestration、scope control、issue dedupe、normalized backlog、stop decision。
- 拉起 subagent 时必须显式设置 `reasoning_effort`，不要直接继承当前会话的全局默认值。
- 标准循环是：开发 -> 检查 -> 修复 -> 审查。
- gate-bearing subagent 的 seat、`agent_id` 和完成状态必须写进 round 输出或控制工件，不能只留在聊天里。
- 对 gate-bearing subagent 使用最长 1 小时的 blocking wait，不要短轮询后提前返回。
- 当前 round 的 gate-bearing check/review subagent 不要当作 `explorer` sidecar。
- 检查组结果必须先统一归并，再交给开发组修复；不要把原始检查碎片直接下发。
- 审查组负责最终通过/不通过判断；审查不通过就回到开发组开始下一轮。
- 任一 required gate-bearing subagent 仍在运行时，不允许 accept 当前 round，也不允许关闭这些 subagent。
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
- 先看：
  - `changed_files`（若 progress artifact 已记录）
  - 否则看 `allowed_scope`
  - 再看 issue validation 和当前 round backlog
- 默认排除 `node_modules`、`dist`、`build`、`.next`、`coverage` 这类目录；只有当前 issue 明确把这些路径写进 `allowed_scope` 时才允许检查。
- 只有为确认 blocker 或直接依赖回归时，才允许扩到相邻调用链。
- 只输出：
  - defect / gap 或 none
  - 为什么它会阻塞当前 `{target_mode}` 目标
  - 证据
  - 最小修复建议
- 不要输出纯风格建议，不要扩展需求。
- 不要做 repo-wide 扫描，不要对无关目录做泛化检查。
- checker 的输出属于当前 round 的硬门禁输入；在主控 agent 收齐所有 checker 结论前，不能提前通过当前 round。

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
- reviewer 先看 `changed_files`、`allowed_scope`、issue validation 和 checker 已归并结果。
- 默认排除 `node_modules`、`dist`、`build`、`.next`、`coverage` 这类目录；只有当前 issue 明确把这些路径写进 `allowed_scope` 时才允许审查。
- 只有为确认当前 issue 是否会引入直接依赖风险时，才允许扩到直接调用链。
- 审查组只回答：
  - verdict: `pass` / `pass with noted debt` / `fail`
  - evidence
  - blocking gap 或 `none`
- `pass` 才允许结束本轮；`fail` 则回到开发组开始下一轮。
- 不要做 repo-wide 审查，不要把当前 round 扩成整个代码库 review。
- 在主控 agent 收齐所有 reviewer verdict 前，不允许提前通过当前 round，也不允许提前关闭 reviewer subagent。
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
2. Gate-bearing subagent roster with seat / agent_id / status
3. Normalized backlog
4. Fixes completed
5. Re-review result
6. Acceptance verdict
7. Next action
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
    progress_snapshot = read_progress_snapshot(progress_path)
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
        progress_snapshot=progress_snapshot,
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
