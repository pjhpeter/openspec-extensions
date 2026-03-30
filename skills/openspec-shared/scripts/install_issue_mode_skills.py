#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

SKILL_DIRECTORIES = [
    Path(".codex/skills/openspec-chat-router"),
    Path(".codex/skills/openspec-plan-issues"),
    Path(".codex/skills/openspec-dispatch-issue"),
    Path(".codex/skills/openspec-execute-issue"),
    Path(".codex/skills/openspec-reconcile-change"),
    Path(".codex/skills/openspec-subagent-team"),
    Path(".codex/skills/openspec-shared"),
]
CONFIG_PATH = Path("openspec/issue-mode.json")
GITIGNORE_ENTRIES = [
    ".worktree/",
    "openspec/changes/*/runs/CHANGE-VERIFY.json",
]
LEGACY_RUNTIME_PATHS = [
    Path(".codex/skills/openspec-monitor-worker"),
    Path("scripts/openspec_coordinator_heartbeat.py"),
    Path("scripts/openspec_coordinator_heartbeat_start.py"),
    Path("scripts/openspec_coordinator_heartbeat_status.py"),
    Path("scripts/openspec_coordinator_heartbeat_stop.py"),
    Path("scripts/openspec_coordinator_tick.py"),
    Path("scripts/openspec_worker_launch.py"),
    Path("scripts/openspec_worker_status.py"),
]
LEGACY_CONFIG_KEYS = [
    "codex_home",
    "persistent_host",
    "coordinator_heartbeat",
    "worker_launcher",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-repo", required=True, help="Target project root that should receive the issue-mode skills.")
    parser.add_argument(
        "--source-repo",
        default="",
        help="Optional source project root. Defaults to the repo that contains this installer.",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing installed skill directories.")
    parser.add_argument(
        "--force-config",
        action="store_true",
        help="Overwrite an existing openspec/issue-mode.json in the target repo.",
    )
    parser.add_argument(
        "--skip-gitignore",
        action="store_true",
        help="Do not modify the target repo .gitignore.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview actions without writing files.")
    return parser.parse_args()


def installer_repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def validate_source_layout(source_repo: Path) -> None:
    missing = [str(path) for path in SKILL_DIRECTORIES if not (source_repo / path).exists()]
    missing_config = not (source_repo / CONFIG_PATH).exists()
    if missing:
        raise SystemExit(f"Source repo is missing required skill directories: {', '.join(missing)}")
    if missing_config:
        raise SystemExit(f"Source repo is missing required config template: {CONFIG_PATH}")


def ensure_target_repo(target_repo: Path) -> None:
    if not target_repo.exists():
        raise SystemExit(f"Target repo does not exist: {target_repo}")
    if not target_repo.is_dir():
        raise SystemExit(f"Target repo is not a directory: {target_repo}")


def relative_str(path: Path) -> str:
    return path.as_posix()


def deep_merge(base: dict, override: dict) -> dict:
    result = dict(base)
    for key, value in override.items():
        current = result.get(key)
        if isinstance(current, dict) and isinstance(value, dict):
            result[key] = deep_merge(current, value)
            continue
        result[key] = value
    return result


def delete_path(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
        return
    path.unlink()


def cleanup_legacy_runtime(
    target_repo: Path,
    *,
    dry_run: bool,
    allow_cleanup: bool,
) -> tuple[list[str], list[str], str]:
    removed: list[str] = []
    skipped: list[str] = []
    for relative_path in LEGACY_RUNTIME_PATHS:
        target_path = target_repo / relative_path
        if not target_path.exists():
            continue
        if not allow_cleanup:
            skipped.append(relative_str(relative_path))
            continue
        if not dry_run:
            delete_path(target_path)
        removed.append(relative_str(relative_path))

    reason = ""
    if skipped:
        reason = "Existing installed skill directories were preserved. Re-run with --force to upgrade skills and remove legacy detached-worker artifacts safely."
    return removed, skipped, reason


def load_json_object(path: Path) -> tuple[dict, bool]:
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}, True
    if not isinstance(payload, dict):
        return {}, False
    return payload, False


def inspect_config_state(
    *,
    source_repo: Path,
    target_repo: Path,
    config_status: str,
    overrides: dict,
) -> tuple[list[str], bool]:
    if config_status in {"installed", "overwritten"}:
        payload = deep_merge(json.loads((source_repo / CONFIG_PATH).read_text()), overrides)
        return [key for key in LEGACY_CONFIG_KEYS if key in payload], False

    target_config = target_repo / CONFIG_PATH
    if not target_config.exists():
        return [], False
    payload, invalid_json = load_json_object(target_config)
    if invalid_json:
        return [], True
    return [key for key in LEGACY_CONFIG_KEYS if key in payload], False


def install_skill_directories(
    source_repo: Path,
    target_repo: Path,
    force: bool,
    dry_run: bool,
) -> tuple[list[str], list[str], list[str]]:
    installed: list[str] = []
    overwritten: list[str] = []
    preserved: list[str] = []

    for relative_dir in SKILL_DIRECTORIES:
        source_dir = source_repo / relative_dir
        target_dir = target_repo / relative_dir
        if target_dir.exists():
            if not force:
                preserved.append(relative_str(relative_dir))
                continue
            overwritten.append(relative_str(relative_dir))
            if not dry_run:
                shutil.rmtree(target_dir)

        if not dry_run:
            target_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(source_dir, target_dir)
        installed.append(relative_str(relative_dir))

    return installed, overwritten, preserved


def install_config_template(
    source_repo: Path,
    target_repo: Path,
    force_config: bool,
    overrides: dict,
    dry_run: bool,
) -> tuple[str, str]:
    source_config = source_repo / CONFIG_PATH
    target_config = target_repo / CONFIG_PATH
    existed_before = target_config.exists()

    if existed_before and not force_config:
        return relative_str(CONFIG_PATH), "preserved"

    merged_config = deep_merge(json.loads(source_config.read_text()), overrides)

    if not dry_run:
        target_config.parent.mkdir(parents=True, exist_ok=True)
        target_config.write_text(json.dumps(merged_config, ensure_ascii=False, indent=2) + "\n")
    return relative_str(CONFIG_PATH), "overwritten" if existed_before else "installed"


def update_gitignore(target_repo: Path, dry_run: bool) -> tuple[str, list[str]]:
    gitignore_path = target_repo / ".gitignore"
    if gitignore_path.exists():
        content = gitignore_path.read_text()
    else:
        content = ""

    lines = content.splitlines()
    missing_entries = [entry for entry in GITIGNORE_ENTRIES if entry not in lines]
    if not missing_entries:
        return ".gitignore", []

    updated = content
    if updated and not updated.endswith("\n"):
        updated += "\n"
    updated += "".join(f"{entry}\n" for entry in missing_entries)

    if not dry_run:
        gitignore_path.write_text(updated)
    return ".gitignore", missing_entries


def main() -> None:
    args = parse_args()
    source_repo = Path(args.source_repo).resolve() if args.source_repo else installer_repo_root()
    target_repo = Path(args.target_repo).resolve()

    if source_repo == target_repo:
        raise SystemExit("Source repo and target repo must be different.")

    validate_source_layout(source_repo)
    ensure_target_repo(target_repo)

    installed, overwritten, preserved = install_skill_directories(
        source_repo=source_repo,
        target_repo=target_repo,
        force=args.force,
        dry_run=args.dry_run,
    )
    removed_legacy_runtime, skipped_legacy_runtime, legacy_cleanup_reason = cleanup_legacy_runtime(
        target_repo,
        dry_run=args.dry_run,
        allow_cleanup=not preserved,
    )
    config_path, config_status = install_config_template(
        source_repo=source_repo,
        target_repo=target_repo,
        force_config=args.force_config,
        overrides={},
        dry_run=args.dry_run,
    )
    config_legacy_keys, config_invalid_json = inspect_config_state(
        source_repo=source_repo,
        target_repo=target_repo,
        config_status=config_status,
        overrides={},
    )

    gitignore_path = ""
    gitignore_added_entries: list[str] = []
    if not args.skip_gitignore:
        gitignore_path, gitignore_added_entries = update_gitignore(target_repo, args.dry_run)

    result = {
        "source_repo": str(source_repo),
        "target_repo": str(target_repo),
        "dry_run": args.dry_run,
        "force": args.force,
        "force_config": args.force_config,
        "installed_skill_dirs": installed,
        "overwritten_skill_dirs": overwritten,
        "preserved_skill_dirs": preserved,
        "legacy_runtime_cleanup": {
            "removed_paths": removed_legacy_runtime,
            "skipped_paths": skipped_legacy_runtime,
            "reason": legacy_cleanup_reason,
        },
        "config": {
            "path": config_path,
            "status": config_status,
            "overrides": {},
            "legacy_keys_present": config_legacy_keys,
            "invalid_json": config_invalid_json,
        },
        "gitignore": {
            "path": gitignore_path,
            "updated": bool(gitignore_added_entries),
            "added_entries": gitignore_added_entries,
            "skipped": args.skip_gitignore,
            "entries": GITIGNORE_ENTRIES,
        },
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
