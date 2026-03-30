from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "coordinator_verify_change.py"


def write_issue_doc(repo_root: Path, change: str, issue_id: str = "ISSUE-001") -> None:
    issue_path = repo_root / "openspec" / "changes" / change / "issues" / f"{issue_id}.md"
    issue_path.parent.mkdir(parents=True, exist_ok=True)
    issue_path.write_text(textwrap.dedent(
        f"""\
        ---
        issue_id: {issue_id}
        title: Demo issue
        worker_worktree: .worktree/{change}/{issue_id}
        allowed_scope:
          - src/demo.ts
        out_of_scope:
          - electron/
        done_when:
          - 完成 demo issue
        validation:
          - true
        ---
        """
    ))


def write_issue_progress(repo_root: Path, change: str, *, status: str) -> None:
    progress_path = repo_root / "openspec" / "changes" / change / "issues" / "ISSUE-001.progress.json"
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    progress_path.write_text(json.dumps(
        {
            "issue_id": "ISSUE-001",
            "status": status,
            "updated_at": "2026-03-30T10:00:00+08:00",
        },
        ensure_ascii=False,
        indent=2,
    ))


def write_issue_mode_config(repo_root: Path) -> None:
    config_path = repo_root / "openspec" / "issue-mode.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(
        {
            "validation_commands": ["true"],
        },
        ensure_ascii=False,
        indent=2,
    ))


def write_change_review_artifact(repo_root: Path, change: str) -> None:
    review_path = repo_root / "openspec" / "changes" / change / "runs" / "CHANGE-REVIEW.json"
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(json.dumps(
        {
            "change": change,
            "status": "passed",
            "updated_at": "2026-03-30T10:05:00+08:00",
        },
        ensure_ascii=False,
        indent=2,
    ))


class CoordinatorVerifyChangeTest(unittest.TestCase):
    def test_verify_requires_prior_change_review(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            change_dir.mkdir(parents=True)
            (change_dir / "tasks.md").write_text("")
            write_issue_doc(repo_root, "demo-change")
            write_issue_progress(repo_root, "demo-change", status="completed")
            write_issue_mode_config(repo_root)

            process = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--repo-root",
                    str(repo_root),
                    "--change",
                    "demo-change",
                ],
                capture_output=True,
                text=True,
                check=True,
            )

            payload = json.loads(process.stdout)

        self.assertEqual(payload["status"], "failed")
        self.assertIn("/review has not been run", payload["summary"])

    def test_verify_passes_after_review_and_validation(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            change_dir.mkdir(parents=True)
            (change_dir / "tasks.md").write_text("")
            write_issue_doc(repo_root, "demo-change")
            write_issue_progress(repo_root, "demo-change", status="completed")
            write_issue_mode_config(repo_root)
            write_change_review_artifact(repo_root, "demo-change")

            process = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--repo-root",
                    str(repo_root),
                    "--change",
                    "demo-change",
                ],
                capture_output=True,
                text=True,
                check=True,
            )

            payload = json.loads(process.stdout)

        self.assertEqual(payload["status"], "passed")
        self.assertTrue(payload["change_review"]["current"])
        self.assertEqual(payload["change_review"]["status"], "passed")


if __name__ == "__main__":
    unittest.main()
