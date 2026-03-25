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


def render_dispatch(change: str, frontmatter: dict[str, object], worker_worktree: str, validation: list[str]) -> str:
    issue_id = require_str(frontmatter, "issue_id")
    title = require_str(frontmatter, "title")
    allowed_scope = require_list(frontmatter, "allowed_scope")
    out_of_scope = require_list(frontmatter, "out_of_scope")
    done_when = require_list(frontmatter, "done_when")

    def bullet_list(items: list[str]) -> str:
        return "\n".join(f"  - `{item}`" for item in items)

    return f"""继续 OpenSpec change `{change}`，执行单个 issue。

- Issue: `{issue_id}` - {title}
- Worker worktree:
  - `{worker_worktree}`
- Allowed scope:
{bullet_list(allowed_scope)}
- Out of scope:
{bullet_list(out_of_scope)}
- Done when:
{bullet_list(done_when)}
- Validation:
{bullet_list(validation)}

开始后先写：
- `openspec/changes/{change}/issues/{issue_id}.progress.json`
- `openspec/changes/{change}/runs/RUN-<timestamp>-{issue_id}.json`

完成后回报：
- Issue
- Files
- Validation
- Progress Artifact
- Run Artifact
- Need Coordinator Update
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
    dispatch_text = render_dispatch(args.change, frontmatter, worker_worktree, validation)
    dispatch_path.write_text(dispatch_text)

    payload = {
        "change": args.change,
        "issue_id": require_str(frontmatter, "issue_id"),
        "worker_worktree": worker_worktree,
        "worker_worktree_source": worktree_source,
        "validation": validation,
        "validation_source": validation_source,
        "config_path": config["config_path"],
        "dispatch_path": str(dispatch_path.relative_to(repo_root)),
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
