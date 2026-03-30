#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

SHARED_SCRIPTS = Path(__file__).resolve().parents[2] / "openspec-shared" / "scripts"
if str(SHARED_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SHARED_SCRIPTS))

from coordinator_change_common import sync_tasks_for_issues  # noqa: E402
from issue_mode_common import display_path, issue_worker_worktree_path, load_issue_mode_config  # noqa: E402

UNMERGED_STATUSES = {"DD", "AU", "UD", "UA", "DU", "AA", "UU"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--change", required=True)
    parser.add_argument("--issue-id", required=True)
    parser.add_argument("--commit-message", default="")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def decode_output(data: bytes) -> str:
    return data.decode("utf-8", errors="replace").strip()


def run_command(
    cmd: list[str],
    *,
    cwd: Path,
    input_bytes: bytes | None = None,
    check: bool = True,
    ok_codes: set[int] | None = None,
) -> subprocess.CompletedProcess[bytes]:
    process = subprocess.run(
        cmd,
        cwd=str(cwd),
        input=input_bytes,
        capture_output=True,
    )
    if ok_codes is None:
        ok_codes = {0}
    if check and process.returncode not in ok_codes:
        message = decode_output(process.stderr) or decode_output(process.stdout) or "command failed"
        raise SystemExit(message)
    return process


def git_output(repo: Path, *args: str) -> str:
    process = run_command(["git", *args], cwd=repo)
    return decode_output(process.stdout)


def git_binary(repo: Path, *args: str) -> bytes:
    process = run_command(["git", *args], cwd=repo)
    return process.stdout


def git_status_lines(repo: Path) -> list[str]:
    output = git_output(repo, "status", "--porcelain")
    return [line for line in output.splitlines() if line.strip()]


def extract_status_paths(line: str) -> list[str]:
    payload = line[3:].strip()
    if not payload:
        return []
    if " -> " in payload:
        return [part.strip() for part in payload.split(" -> ") if part.strip()]
    return [payload]


def is_ignored_target_status(line: str, ignored_prefixes: list[str]) -> bool:
    paths = extract_status_paths(line)
    if not paths:
        return False
    for path in paths:
        normalized = path.strip("./")
        if not any(normalized == prefix or normalized.startswith(f"{prefix}/") for prefix in ignored_prefixes):
            return False
    return True


def ensure_no_unmerged(status_lines: list[str], *, label: str) -> None:
    for line in status_lines:
        code = line[:2]
        if code in UNMERGED_STATUSES or "U" in code:
            raise SystemExit(f"{label} has unresolved merge state: {line}")


def ensure_clean_target(repo: Path, *, ignored_prefixes: list[str]) -> None:
    status_lines = git_status_lines(repo)
    ensure_no_unmerged(status_lines, label="Coordinator worktree")
    remaining = [line for line in status_lines if not is_ignored_target_status(line, ignored_prefixes)]
    if remaining:
        raise SystemExit("Coordinator worktree must be clean before merge helper runs.")


def ensure_worker_exists(path: Path) -> None:
    process = run_command(
        ["git", "-C", str(path), "rev-parse", "--show-toplevel"],
        cwd=path.parent if path.parent.exists() else Path.cwd(),
        check=False,
    )
    if process.returncode != 0 or Path(decode_output(process.stdout)).resolve() != path.resolve():
        raise SystemExit(f"Worker worktree not found or not a git worktree: {path}")


def split_null_output(data: bytes) -> list[str]:
    items: list[str] = []
    for raw in data.split(b"\0"):
        if not raw:
            continue
        items.append(raw.decode("utf-8", errors="replace"))
    return items


def unique_paths(paths: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for path in paths:
        value = path.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def untracked_files(repo: Path) -> list[str]:
    process = run_command(
        ["git", "ls-files", "-z", "--others", "--exclude-standard"],
        cwd=repo,
    )
    return split_null_output(process.stdout)


def build_untracked_patch(repo: Path, paths: list[str]) -> bytes:
    patches: list[bytes] = []
    for rel_path in paths:
        candidate = repo / rel_path
        if not candidate.is_file():
            continue
        process = run_command(
            ["git", "diff", "--binary", "--no-index", "--", "/dev/null", rel_path],
            cwd=repo,
            check=False,
            ok_codes={0, 1},
        )
        if process.returncode == 1 and process.stdout:
            patches.append(process.stdout)
    return b"".join(patches)


def merge_base(repo: Path, left: str, right: str) -> str:
    return git_output(repo, "merge-base", left, right)


def build_worker_patch(
    repo_root: Path,
    worker_worktree: Path,
) -> tuple[bytes, str, list[str], list[str]]:
    root_head = git_output(repo_root, "rev-parse", "HEAD")
    worker_head = git_output(worker_worktree, "rev-parse", "HEAD")
    status_lines = git_status_lines(worker_worktree)
    ensure_no_unmerged(status_lines, label="Worker worktree")

    base_revision = merge_base(repo_root, root_head, worker_head)
    tracked_patch = git_binary(worker_worktree, "diff", "--binary", "--find-renames", base_revision)
    tracked_files = split_null_output(
        run_command(
            ["git", "diff", "--name-only", "-z", "--find-renames", base_revision],
            cwd=worker_worktree,
        ).stdout
    )
    extra_untracked = untracked_files(worker_worktree)
    patch = tracked_patch + build_untracked_patch(worker_worktree, extra_untracked)
    changed_files = unique_paths(tracked_files + extra_untracked)
    return patch, base_revision, changed_files, status_lines


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def issue_paths(repo_root: Path, change: str, issue_id: str) -> tuple[Path, Path, Path]:
    change_dir = repo_root / "openspec" / "changes" / change
    issues_dir = change_dir / "issues"
    runs_dir = change_dir / "runs"
    issues_dir.mkdir(parents=True, exist_ok=True)
    runs_dir.mkdir(parents=True, exist_ok=True)
    return change_dir, issues_dir / f"{issue_id}.progress.json", runs_dir


def latest_run_path(runs_dir: Path, issue_id: str) -> Path | None:
    matches = sorted(runs_dir.glob(f"RUN-*-{issue_id}.json"))
    if not matches:
        return None
    return matches[-1]


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def progress_and_run_paths(repo_root: Path, change: str, issue_id: str) -> tuple[Path, Path, Path | None]:
    _, progress_path, runs_dir = issue_paths(repo_root, change, issue_id)
    progress = read_json(progress_path)
    run_id = str(progress.get("run_id", "")).strip()
    run_path = runs_dir / f"{run_id}.json" if run_id else latest_run_path(runs_dir, issue_id)
    return progress_path, runs_dir, run_path


def ensure_review_ready(progress: dict[str, Any], issue_id: str, *, force: bool) -> None:
    if force:
        return
    if progress.get("status") != "completed":
        raise SystemExit(f"{issue_id} is not ready for coordinator merge: status must be completed.")
    if progress.get("boundary_status") != "review_required" and progress.get("next_action") != "coordinator_review":
        raise SystemExit(f"{issue_id} is not waiting for coordinator review.")


def current_target_ref(repo_root: Path) -> str:
    ref = git_output(repo_root, "rev-parse", "--abbrev-ref", "HEAD")
    return ref or "HEAD"


def default_commit_message(change: str, issue_id: str) -> str:
    return f"opsx({change}): accept {issue_id}"


def stage_and_commit(
    repo_root: Path,
    *,
    commit_message: str,
    extra_paths: list[Path],
) -> str:
    add_paths = ["git", "add", *[display_path(repo_root, path) for path in extra_paths]]
    run_command(add_paths, cwd=repo_root)
    run_command(["git", "commit", "-m", commit_message], cwd=repo_root)
    return git_output(repo_root, "rev-parse", "HEAD")


def apply_patch(repo_root: Path, patch: bytes) -> None:
    run_command(
        ["git", "apply", "--index", "--3way"],
        cwd=repo_root,
        input_bytes=patch,
    )


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    config = load_issue_mode_config(repo_root)
    worker_worktree, worker_display, worker_source = issue_worker_worktree_path(
        repo_root=repo_root,
        change=args.change,
        issue_id=args.issue_id,
        config=config,
    )
    ensure_worker_exists(worker_worktree)

    progress_path, _, run_path = progress_and_run_paths(repo_root, args.change, args.issue_id)
    if not progress_path.exists():
        raise SystemExit(f"Issue progress artifact not found: {progress_path}")
    progress = read_json(progress_path)
    ensure_review_ready(progress, args.issue_id, force=args.force)

    patch, base_revision, changed_files, worker_status = build_worker_patch(repo_root, worker_worktree)
    if not patch.strip():
        raise SystemExit(f"No reviewable changes found in worker worktree for {args.issue_id}.")

    target_ref = current_target_ref(repo_root)
    commit_message = args.commit_message.strip() or default_commit_message(args.change, args.issue_id)
    result: dict[str, Any] = {
        "change": args.change,
        "issue_id": args.issue_id,
        "target_ref": target_ref,
        "worker_worktree": str(worker_worktree),
        "worker_worktree_relative": worker_display,
        "worker_worktree_source": worker_source,
        "base_revision": base_revision,
        "changed_files": changed_files,
        "progress_path": display_path(repo_root, progress_path),
        "run_path": display_path(repo_root, run_path) if run_path else "",
        "commit_message": commit_message,
        "dry_run": args.dry_run,
        "worker_status_lines": worker_status,
    }

    if args.dry_run:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    worktree_root = str(config.get("worktree_root", "")).strip().strip("./")
    ignored_prefixes = [worktree_root] if worktree_root else []
    ensure_clean_target(repo_root, ignored_prefixes=ignored_prefixes)
    apply_patch(repo_root, patch)

    updated_at = now_iso()
    summary = f"Coordinator accepted and merged {args.issue_id} from {worker_display} into {target_ref}."
    tasks_sync = sync_tasks_for_issues(repo_root, args.change, [args.issue_id])

    progress["change"] = args.change
    progress["issue_id"] = args.issue_id
    progress["status"] = "completed"
    progress["boundary_status"] = "done"
    progress["next_action"] = ""
    progress["summary"] = summary
    progress["blocker"] = ""
    progress["changed_files"] = changed_files
    progress["updated_at"] = updated_at
    write_json(progress_path, progress)

    extra_paths = [progress_path]
    tasks_path = repo_root / tasks_sync["tasks_path"]
    if tasks_sync.get("changed") and tasks_path.exists():
        extra_paths.append(tasks_path)

    if run_path is not None:
        run = read_json(run_path)
        run["change"] = args.change
        run["issue_id"] = args.issue_id
        run["latest_event"] = "checkpoint"
        run["status"] = "completed"
        run["boundary_status"] = "done"
        run["next_action"] = ""
        run["summary"] = summary
        run["blocker"] = ""
        run["changed_files"] = changed_files
        run["updated_at"] = updated_at
        write_json(run_path, run)
        extra_paths.append(run_path)

    commit_sha = stage_and_commit(
        repo_root,
        commit_message=commit_message,
        extra_paths=extra_paths,
    )

    result["commit_sha"] = commit_sha
    result["commit_summary"] = summary
    result["tasks_sync"] = tasks_sync
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
