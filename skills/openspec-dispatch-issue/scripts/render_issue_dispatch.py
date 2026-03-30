#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SHARED_SCRIPTS = Path(__file__).resolve().parents[2] / "openspec-shared" / "scripts"
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from issue_mode_common import (  # noqa: E402
    issue_validation_commands,
    issue_worker_worktree_setting,
    parse_frontmatter,
    load_issue_mode_config,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--issue-id", required=True)
    parser.add_argument("--run-id", default="")
    parser.add_argument("--session-name", default="")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def require_list(frontmatter: dict[str, object], key: str) -> list[str]:
    value = frontmatter.get(key)
    if not isinstance(value, list) or not value:
        raise SystemExit(f"Issue doc missing required list field: {key}")
    return value


def require_str(frontmatter: dict[str, object], key: str) -> str:
    value = frontmatter.get(key)
    if not isinstance(value, str) or not value:
        raise SystemExit(f"Issue doc missing required field: {key}")
    return value


def render_dispatch(
    change: str,
    frontmatter: dict[str, object],
    worker_worktree: str,
    validation: list[str],
    repo_root: Path,
    run_id: str,
    session_name: str,
) -> str:
    issue_id = require_str(frontmatter, "issue_id")
    title = require_str(frontmatter, "title")
    allowed_scope = require_list(frontmatter, "allowed_scope")
    out_of_scope = require_list(frontmatter, "out_of_scope")
    done_when = require_list(frontmatter, "done_when")
    effective_run_id = run_id.strip() or f"RUN-<timestamp>-{issue_id}"

    def bullet_list(items: list[str]) -> str:
        return "\n".join(f"  - `{item}`" for item in items)

    session_label = session_name.strip() or "<optional-for-detached-launch>"

    return f"""继续 OpenSpec change `{change}`，执行单个 issue。

如果你已经是被启动的 detached/background worker，会话内直接执行这个 issue，不要再派生 subagent、worker 或新的 detached 会话。
只有 coordinator 主会话在人工派发时，才会把这个 dispatch 交给一个新的 subagent 或外部 worker。

- Issue: `{issue_id}` - {title}
- Worker worktree:
  - `{worker_worktree}`
- Workflow artifact repo root:
  - `{repo_root}`
- Run ID:
  - `{effective_run_id}`
- Detached worker session label:
  - `{session_label}`
- Allowed scope:
{bullet_list(allowed_scope)}
- Out of scope:
{bullet_list(out_of_scope)}
- Done when:
{bullet_list(done_when)}
- Validation:
{bullet_list(validation)}

开始后先写：
- `python3 .codex/skills/openspec-execute-issue/scripts/update_issue_progress.py start --repo-root "{repo_root}" --change "{change}" --issue-id "{issue_id}" --run-id "{effective_run_id}" --status in_progress --boundary-status working --next-action continue_issue --summary "已开始处理该 issue。"`

完成后回报：
- Issue
- Files
- Validation
- Progress Artifact
- Run Artifact
- Need Coordinator Update

停止前必须写：
- `python3 .codex/skills/openspec-execute-issue/scripts/update_issue_progress.py stop --repo-root "{repo_root}" --change "{change}" --issue-id "{issue_id}" --run-id "{effective_run_id}" --status completed --boundary-status review_required --next-action coordinator_review --summary "issue 边界内实现已完成，等待 coordinator 收敛。" --validation "lint=<pending-or-passed>" --validation "typecheck=<pending-or-passed>" --changed-file "<path>"`

如果阻塞，改写为：
- `status=blocked`
- `boundary-status=blocked`
- `next-action=resolve_blocker`
- `blocker=<concrete reason>`
"""


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    config = load_issue_mode_config(repo_root)
    issues_dir = repo_root / "openspec" / "changes" / args.change / "issues"
    issue_path = issues_dir / f"{args.issue_id}.md"
    dispatch_path = issues_dir / f"{args.issue_id}.dispatch.md"

    if not issue_path.exists():
        raise SystemExit(f"Issue doc not found: {issue_path}")

    frontmatter = parse_frontmatter(issue_path.read_text())
    if not frontmatter:
        raise SystemExit("Issue doc missing valid frontmatter.")

    worker_worktree, worktree_source = issue_worker_worktree_setting(
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
    dispatch_text = render_dispatch(
        args.change,
        frontmatter,
        worker_worktree,
        validation,
        repo_root,
        args.run_id,
        args.session_name,
    )
    if not args.dry_run:
        dispatch_path.write_text(dispatch_text)

    payload = {
        "change": args.change,
        "issue_id": require_str(frontmatter, "issue_id"),
        "worker_worktree": worker_worktree,
        "worker_worktree_source": worktree_source,
        "artifact_repo_root": str(repo_root),
        "run_id": args.run_id,
        "session_name": args.session_name,
        "validation": validation,
        "validation_source": validation_source,
        "config_path": config["config_path"],
        "dispatch_path": str(dispatch_path.relative_to(repo_root)),
        "dry_run": args.dry_run,
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
