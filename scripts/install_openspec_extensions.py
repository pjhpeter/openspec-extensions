#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

SOURCE_SKILLS_ROOT = Path("skills")
TARGET_SKILLS_ROOT = Path(".codex") / "skills"
CONFIG_TEMPLATE_PATH = Path("templates") / "issue-mode.json"
TARGET_CONFIG_PATH = Path("openspec") / "issue-mode.json"
SKILL_NAMES = [
    "openspec-chat-router",
    "openspec-plan-issues",
    "openspec-dispatch-issue",
    "openspec-execute-issue",
    "openspec-reconcile-change",
    "openspec-subagent-team",
    "openspec-shared",
]
GITIGNORE_ENTRIES = [
    ".worktree/",
    "openspec/changes/*/runs/CHANGE-VERIFY.json",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-repo", required=True, help="Target project root that should receive the OpenSpec extensions.")
    parser.add_argument(
        "--source-repo",
        default="",
        help="Optional source repo root. Defaults to the repo that contains this installer.",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing installed skill directories.")
    parser.add_argument(
        "--force-config",
        action="store_true",
        help="Overwrite an existing openspec/issue-mode.json in the target project.",
    )
    parser.add_argument("--skip-gitignore", action="store_true", help="Do not modify the target project's .gitignore.")
    parser.add_argument("--dry-run", action="store_true", help="Preview actions without writing files.")
    return parser.parse_args()


def installer_repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def ensure_directory(path: Path, label: str) -> None:
    if not path.exists():
        raise SystemExit(f"{label} does not exist: {path}")
    if not path.is_dir():
        raise SystemExit(f"{label} is not a directory: {path}")


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


def validate_source_layout(source_repo: Path) -> None:
    ensure_directory(source_repo, "Source repo")
    ensure_directory(source_repo / SOURCE_SKILLS_ROOT, "Source skills root")
    missing = [name for name in SKILL_NAMES if not (source_repo / SOURCE_SKILLS_ROOT / name).exists()]
    if missing:
        raise SystemExit(f"Source repo is missing required skills: {', '.join(missing)}")
    if not (source_repo / CONFIG_TEMPLATE_PATH).exists():
        raise SystemExit(f"Source repo is missing config template: {CONFIG_TEMPLATE_PATH}")


def ensure_target_repo(target_repo: Path) -> None:
    ensure_directory(target_repo, "Target repo")


def install_skill_directories(
    source_repo: Path,
    target_repo: Path,
    force: bool,
    dry_run: bool,
) -> tuple[list[str], list[str], list[str]]:
    installed: list[str] = []
    overwritten: list[str] = []
    preserved: list[str] = []

    for skill_name in SKILL_NAMES:
        source_dir = source_repo / SOURCE_SKILLS_ROOT / skill_name
        target_dir = target_repo / TARGET_SKILLS_ROOT / skill_name
        display_path = relative_str(TARGET_SKILLS_ROOT / skill_name)

        if target_dir.exists():
            if not force:
                preserved.append(display_path)
                continue
            overwritten.append(display_path)
            if not dry_run:
                shutil.rmtree(target_dir)

        if not dry_run:
            target_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(source_dir, target_dir)
        installed.append(display_path)

    return installed, overwritten, preserved


def install_config_template(
    source_repo: Path,
    target_repo: Path,
    force_config: bool,
    overrides: dict,
    dry_run: bool,
) -> tuple[str, str]:
    source_config = source_repo / CONFIG_TEMPLATE_PATH
    target_config = target_repo / TARGET_CONFIG_PATH
    existed_before = target_config.exists()

    if existed_before and not force_config:
        return relative_str(TARGET_CONFIG_PATH), "preserved"

    merged_config = deep_merge(json.loads(source_config.read_text()), overrides)

    if not dry_run:
        target_config.parent.mkdir(parents=True, exist_ok=True)
        target_config.write_text(json.dumps(merged_config, ensure_ascii=False, indent=2) + "\n")
    return relative_str(TARGET_CONFIG_PATH), "overwritten" if existed_before else "installed"


def update_gitignore(target_repo: Path, dry_run: bool) -> tuple[str, list[str]]:
    gitignore_path = target_repo / ".gitignore"
    content = gitignore_path.read_text() if gitignore_path.exists() else ""
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
    config_path, config_status = install_config_template(
        source_repo=source_repo,
        target_repo=target_repo,
        force_config=args.force_config,
        overrides={},
        dry_run=args.dry_run,
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
        "config": {
            "path": config_path,
            "status": config_status,
            "overrides": {},
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
