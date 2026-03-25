#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from datetime import datetime
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
    "coordinator_heartbeat": {
        "interval_seconds": 60,
        "stale_seconds": 900,
        "notify_topic": "",
        "auto_dispatch_next": False,
        "auto_launch_next": False,
    },
    "worker_launcher": {
        "session_prefix": "opsx-worker",
        "start_grace_seconds": 120,
        "launch_cooldown_seconds": 30,
        "max_launch_retries": 1,
        "codex_bin": "codex",
        "sandbox_mode": "danger-full-access",
        "bypass_approvals": True,
        "json_output": True,
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


def normalize_bool(value: object, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    return default


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

    coordinator_heartbeat = config.get("coordinator_heartbeat", {})
    if not isinstance(coordinator_heartbeat, dict):
        coordinator_heartbeat = {}
    interval_seconds = int(
        coordinator_heartbeat.get("interval_seconds", DEFAULT_CONFIG["coordinator_heartbeat"]["interval_seconds"])
    )
    stale_seconds = int(
        coordinator_heartbeat.get("stale_seconds", DEFAULT_CONFIG["coordinator_heartbeat"]["stale_seconds"])
    )
    if interval_seconds <= 0:
        raise SystemExit(f"{CONFIG_RELATIVE_PATH} field `coordinator_heartbeat.interval_seconds` must be > 0.")
    if stale_seconds <= 0:
        raise SystemExit(f"{CONFIG_RELATIVE_PATH} field `coordinator_heartbeat.stale_seconds` must be > 0.")
    notify_topic = str(
        coordinator_heartbeat.get("notify_topic", DEFAULT_CONFIG["coordinator_heartbeat"]["notify_topic"])
    ).strip()
    auto_dispatch_next = normalize_bool(
        coordinator_heartbeat.get(
            "auto_dispatch_next", DEFAULT_CONFIG["coordinator_heartbeat"]["auto_dispatch_next"]
        ),
        bool(DEFAULT_CONFIG["coordinator_heartbeat"]["auto_dispatch_next"]),
    )
    auto_launch_next = normalize_bool(
        coordinator_heartbeat.get("auto_launch_next", DEFAULT_CONFIG["coordinator_heartbeat"]["auto_launch_next"]),
        bool(DEFAULT_CONFIG["coordinator_heartbeat"]["auto_launch_next"]),
    )

    worker_launcher = config.get("worker_launcher", {})
    if not isinstance(worker_launcher, dict):
        worker_launcher = {}
    session_prefix = (
        str(worker_launcher.get("session_prefix", DEFAULT_CONFIG["worker_launcher"]["session_prefix"])).strip()
        or "opsx-worker"
    )
    start_grace_seconds = int(
        worker_launcher.get("start_grace_seconds", DEFAULT_CONFIG["worker_launcher"]["start_grace_seconds"])
    )
    launch_cooldown_seconds = int(
        worker_launcher.get(
            "launch_cooldown_seconds", DEFAULT_CONFIG["worker_launcher"]["launch_cooldown_seconds"]
        )
    )
    max_launch_retries = int(
        worker_launcher.get("max_launch_retries", DEFAULT_CONFIG["worker_launcher"]["max_launch_retries"])
    )
    if start_grace_seconds <= 0:
        raise SystemExit(f"{CONFIG_RELATIVE_PATH} field `worker_launcher.start_grace_seconds` must be > 0.")
    if launch_cooldown_seconds < 0:
        raise SystemExit(f"{CONFIG_RELATIVE_PATH} field `worker_launcher.launch_cooldown_seconds` must be >= 0.")
    if max_launch_retries < 0:
        raise SystemExit(f"{CONFIG_RELATIVE_PATH} field `worker_launcher.max_launch_retries` must be >= 0.")
    codex_bin = str(worker_launcher.get("codex_bin", DEFAULT_CONFIG["worker_launcher"]["codex_bin"])).strip() or "codex"
    sandbox_mode = (
        str(worker_launcher.get("sandbox_mode", DEFAULT_CONFIG["worker_launcher"]["sandbox_mode"])).strip()
        or "danger-full-access"
    )
    if sandbox_mode not in {"read-only", "workspace-write", "danger-full-access"}:
        raise SystemExit(
            f"{CONFIG_RELATIVE_PATH} field `worker_launcher.sandbox_mode` must be "
            "`read-only`, `workspace-write`, or `danger-full-access`."
        )
    bypass_approvals = normalize_bool(
        worker_launcher.get("bypass_approvals", DEFAULT_CONFIG["worker_launcher"]["bypass_approvals"]),
        bool(DEFAULT_CONFIG["worker_launcher"]["bypass_approvals"]),
    )
    json_output = normalize_bool(
        worker_launcher.get("json_output", DEFAULT_CONFIG["worker_launcher"]["json_output"]),
        bool(DEFAULT_CONFIG["worker_launcher"]["json_output"]),
    )

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
        "coordinator_heartbeat": {
            "interval_seconds": interval_seconds,
            "stale_seconds": stale_seconds,
            "notify_topic": notify_topic,
            "auto_dispatch_next": auto_dispatch_next,
            "auto_launch_next": auto_launch_next,
        },
        "worker_launcher": {
            "session_prefix": session_prefix,
            "start_grace_seconds": start_grace_seconds,
            "launch_cooldown_seconds": launch_cooldown_seconds,
            "max_launch_retries": max_launch_retries,
            "codex_bin": codex_bin,
            "sandbox_mode": sandbox_mode,
            "bypass_approvals": bypass_approvals,
            "json_output": json_output,
        },
        "config_path": str(CONFIG_RELATIVE_PATH),
        "config_exists": config_path.exists(),
    }


def default_worker_worktree_setting(config: dict[str, Any], change: str, issue_id: str) -> str:
    return (Path(config["worktree_root"]) / change / issue_id).as_posix()


def ensure_path_within(parent: Path, target: Path) -> None:
    try:
        target.relative_to(parent)
    except ValueError as error:
        raise SystemExit(f"Path `{target}` must stay within `{parent}`.") from error


def validate_issue_worker_worktree(repo_root: Path, raw_path: str, config: dict[str, Any]) -> str:
    candidate = raw_path.strip()
    if not candidate:
        raise SystemExit("Issue frontmatter `worker_worktree` must not be empty.")

    candidate_path = Path(candidate).expanduser()
    if candidate_path.is_absolute():
        raise SystemExit("Issue frontmatter `worker_worktree` must be repo-relative, not absolute.")

    resolved_path = (repo_root / candidate_path).resolve()
    ensure_path_within(repo_root, resolved_path)

    worktree_root = resolve_repo_path(repo_root, str(config["worktree_root"]))
    ensure_path_within(worktree_root, resolved_path)
    return candidate


def issue_worker_worktree_setting(
    repo_root: Path,
    change: str,
    issue_id: str,
    config: dict[str, Any],
) -> tuple[str, str]:
    frontmatter = read_issue_frontmatter(repo_root, change, issue_id)
    worker_worktree = frontmatter.get("worker_worktree")
    if isinstance(worker_worktree, str) and worker_worktree.strip():
        return validate_issue_worker_worktree(repo_root, worker_worktree, config), "issue_doc"
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


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def default_worker_run_id(issue_id: str) -> str:
    stamp = datetime.now().astimezone().strftime("%Y%m%dT%H%M%S")
    return f"RUN-{stamp}-{issue_id}"


def change_dir(repo_root: Path, change: str) -> Path:
    return repo_root / "openspec" / "changes" / change


def change_runs_dir(repo_root: Path, change: str) -> Path:
    runs_dir = change_dir(repo_root, change) / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    return runs_dir


def issue_progress_path(repo_root: Path, change: str, issue_id: str) -> Path:
    return change_dir(repo_root, change) / "issues" / f"{issue_id}.progress.json"


def run_artifact_path(repo_root: Path, change: str, run_id: str) -> Path:
    return change_runs_dir(repo_root, change) / f"{run_id}.json"


def worker_session_state_path(repo_root: Path, change: str, issue_id: str) -> Path:
    return change_runs_dir(repo_root, change) / f"{issue_id}.worker-session.json"


def worker_exec_log_path(repo_root: Path, change: str, run_id: str) -> Path:
    return change_runs_dir(repo_root, change) / f"{run_id}.worker.exec.log"


def worker_last_message_path(repo_root: Path, change: str, run_id: str) -> Path:
    return change_runs_dir(repo_root, change) / f"{run_id}.worker.last-message.txt"


def worker_session_name(config: dict[str, Any], change: str, issue_id: str) -> str:
    prefix = slugify_branch_fragment(config["worker_launcher"]["session_prefix"]).replace("/", "-").strip("-")
    change_slug = slugify_branch_fragment(change).replace("/", "-")
    issue_slug = slugify_branch_fragment(issue_id).replace("/", "-")
    if prefix:
        return f"{prefix}-{change_slug}-{issue_slug}"
    return f"{change_slug}-{issue_slug}"
