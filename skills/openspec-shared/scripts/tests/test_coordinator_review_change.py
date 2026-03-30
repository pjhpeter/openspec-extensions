from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "coordinator_review_change.py"


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
          - pnpm lint
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


class CoordinatorReviewChangeTest(unittest.TestCase):
    def test_writes_passed_review_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            write_issue_doc(repo_root, "demo-change")
            write_issue_progress(repo_root, "demo-change", status="completed")

            process = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--repo-root",
                    str(repo_root),
                    "--change",
                    "demo-change",
                    "--review-command",
                    "printf 'VERDICT: pass\n'",
                ],
                capture_output=True,
                text=True,
                check=True,
            )

            payload = json.loads(process.stdout)
            artifact = json.loads((repo_root / "openspec" / "changes" / "demo-change" / "runs" / "CHANGE-REVIEW.json").read_text())

        self.assertEqual(payload["status"], "passed")
        self.assertEqual(payload["verdict"], "pass")
        self.assertEqual(artifact["status"], "passed")

    def test_refuses_review_when_issues_are_incomplete(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            write_issue_doc(repo_root, "demo-change")
            write_issue_progress(repo_root, "demo-change", status="in_progress")

            process = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--repo-root",
                    str(repo_root),
                    "--change",
                    "demo-change",
                    "--review-command",
                    "printf 'VERDICT: pass\n'",
                ],
                capture_output=True,
                text=True,
                check=True,
            )

            payload = json.loads(process.stdout)

        self.assertEqual(payload["status"], "failed")
        self.assertIn("not completed", payload["summary"])


if __name__ == "__main__":
    unittest.main()
