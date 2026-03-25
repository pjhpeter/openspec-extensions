#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

CONFIG_RELATIVE_PATH = Path("openspec") / "issue-mode.json"
DEFAULT_CONFIG: dict[str, Any] = {
    "worktree_root": ".worktree",
    "validation_commands": [
        "pnpm lint",
        "pnpm type-check",
    ],
    "codex_home": "~/.codex",
    "persistent_host": {
        "kind": "screen",
    },
    "worker_worktree": {
        "mode": "detach",
        "base_ref": "HEAD",
        "branch_prefix": "opsx",
    },
}


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in override.items():
        current = result.get(key)
        if isinstance(current, dict) and isinstance(value, dict):
            result[key] = deep_merge(current, value)
            continue
        result[key] = value
    return result


def parse_frontmatter(text: str) -> dict[str, object]:
    lines = text.splitlines()
    if len(lines) < 3 or lines[0].strip() != "---":
        return {}

    result: dict[str, object] = {}
    current_key: str | None = None
    current_list: list[str] | None = None

    for line in lines[1:]:
        stripped = line.rstrip()
        if stripped == "---":
            if current_key is not None and current_list is not None:
                result[current_key] = current_list
            return result

        if stripped.startswith("  - ") or stripped.startswith("- "):
            if current_key is None:
                continue
            if current_list is None:
                current_list = []
            current_list.append(stripped.split("- ", 1)[1].strip())
            continue

        if ":" not in stripped:
            continue

        if current_key is not None and current_list is not None:
            result[current_key] = current_list

        key, value = stripped.split(":", 1)
        current_key = key.strip()
        value = value.strip()
        if value:
            result[current_key] = value
            current_list = None
        else:
            current_list = []

    return {}


def read_issue_frontmatter(repo_root: Path, change: str, issue_id: str) -> dict[str, object]:
    issue_path = repo_root / "openspec" / "changes" / change / "issues" / f"{issue_id}.md"
    if not issue_path.exists():
        return {}
    return parse_frontmatter(issue_path.read_text())


def normalize_string_list(values: object) -> list[str]:
    if not isinstance(values, list):
        return []
    items: list[str] = []
    for value in values:
        text = str(value).strip()
        if text and text not in items:
            items.append(text)
    return items


def load_issue_mode_config(repo_root: Path) -> dict[str, Any]:
    config_path = repo_root / CONFIG_RELATIVE_PATH
    config = dict(DEFAULT_CONFIG)

    if config_path.exists():
        payload = json.loads(config_path.read_text())
        if not isinstance(payload, dict):
            raise SystemExit(f"{CONFIG_RELATIVE_PATH} must contain a JSON object.")
        config = deep_merge(DEFAULT_CONFIG, payload)

    worktree_root = str(config.get("worktree_root", DEFAULT_CONFIG["worktree_root"])).strip() or ".worktree"
    if Path(worktree_root).is_absolute():
        raise SystemExit(f"{CONFIG_RELATIVE_PATH} field `worktree_root` must be repo-relative.")

    validation_commands = normalize_string_list(config.get("validation_commands"))
    if not validation_commands:
        validation_commands = list(DEFAULT_CONFIG["validation_commands"])

    codex_home = str(config.get("codex_home", DEFAULT_CONFIG["codex_home"])).strip() or str(DEFAULT_CONFIG["codex_home"])

    persistent_host = config.get("persistent_host", {})
    if not isinstance(persistent_host, dict):
        persistent_host = {}
    host_kind = str(persistent_host.get("kind", DEFAULT_CONFIG["persistent_host"]["kind"])).strip() or "screen"
    if host_kind not in {"screen", "tmux", "none"}:
        raise SystemExit(f"{CONFIG_RELATIVE_PATH} field `persistent_host.kind` must be `screen`, `tmux`, or `none`.")

    worker_worktree = config.get("worker_worktree", {})
    if not isinstance(worker_worktree, dict):
        worker_worktree = {}
    worktree_mode = str(worker_worktree.get("mode", DEFAULT_CONFIG["worker_worktree"]["mode"])).strip() or "detach"
    if worktree_mode not in {"detach", "branch"}:
        raise SystemExit(f"{CONFIG_RELATIVE_PATH} field `worker_worktree.mode` must be `detach` or `branch`.")

    base_ref = str(worker_worktree.get("base_ref", DEFAULT_CONFIG["worker_worktree"]["base_ref"])).strip() or "HEAD"
    branch_prefix = str(worker_worktree.get("branch_prefix", DEFAULT_CONFIG["worker_worktree"]["branch_prefix"])).strip() or "opsx"

    return {
        "worktree_root": worktree_root,
        "validation_commands": validation_commands,
        "codex_home": codex_home,
        "persistent_host": {
            "kind": host_kind,
        },
        "worker_worktree": {
            "mode": worktree_mode,
            "base_ref": base_ref,
            "branch_prefix": branch_prefix,
        },
        "config_path": str(CONFIG_RELATIVE_PATH),
        "config_exists": config_path.exists(),
    }


def default_worker_worktree_setting(config: dict[str, Any], change: str, issue_id: str) -> str:
    return (Path(config["worktree_root"]) / change / issue_id).as_posix()


def issue_worker_worktree_setting(
    repo_root: Path,
    change: str,
    issue_id: str,
    config: dict[str, Any],
) -> tuple[str, str]:
    frontmatter = read_issue_frontmatter(repo_root, change, issue_id)
    worker_worktree = frontmatter.get("worker_worktree")
    if isinstance(worker_worktree, str) and worker_worktree.strip():
        return worker_worktree.strip(), "issue_doc"
    return default_worker_worktree_setting(config, change, issue_id), "config_default"


def resolve_repo_path(repo_root: Path, raw_path: str) -> Path:
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (repo_root / path).resolve()


def issue_worker_worktree_path(
    repo_root: Path,
    change: str,
    issue_id: str,
    config: dict[str, Any],
) -> tuple[Path, str, str]:
    raw_path, source = issue_worker_worktree_setting(repo_root, change, issue_id, config)
    path = resolve_repo_path(repo_root, raw_path)
    return path, display_path(repo_root, path), source


def issue_validation_commands(
    repo_root: Path,
    change: str,
    issue_id: str,
    config: dict[str, Any],
) -> tuple[list[str], str]:
    frontmatter = read_issue_frontmatter(repo_root, change, issue_id)
    validation_commands = normalize_string_list(frontmatter.get("validation"))
    if validation_commands:
        return validation_commands, "issue_doc"
    return list(config["validation_commands"]), "config_default"


def display_path(repo_root: Path, path: Path) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return str(path)


def slugify_branch_fragment(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._/-]+", "-", value).strip("./-")
    slug = re.sub(r"/{2,}", "/", slug)
    return slug or "worker"


def worker_branch_name(config: dict[str, Any], change: str, issue_id: str) -> str:
    prefix = slugify_branch_fragment(config["worker_worktree"]["branch_prefix"]).strip("/")
    change_slug = slugify_branch_fragment(change).replace("/", "-")
    issue_slug = slugify_branch_fragment(issue_id).replace("/", "-")
    if prefix:
        return f"{prefix}/{change_slug}/{issue_slug}"
    return f"{change_slug}/{issue_slug}"
