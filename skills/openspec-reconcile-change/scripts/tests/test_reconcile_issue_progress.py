from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "reconcile_issue_progress.py"


def write_issue_doc(repo_root: Path, change: str, issue_id: str = "ISSUE-001") -> Path:
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
    return issue_path


def write_issue_progress(
    repo_root: Path,
    change: str,
    *,
    issue_id: str = "ISSUE-001",
    status: str,
    updated_at: str = "2026-03-30T10:00:00+08:00",
) -> Path:
    progress_path = repo_root / "openspec" / "changes" / change / "issues" / f"{issue_id}.progress.json"
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    progress_path.write_text(json.dumps(
        {
            "issue_id": issue_id,
            "status": status,
            "boundary_status": "accepted" if status == "completed" else "",
            "next_action": "",
            "updated_at": updated_at,
        },
        ensure_ascii=False,
        indent=2,
    ))
    return progress_path


def write_issue_mode_config(repo_root: Path, payload: dict[str, object]) -> None:
    config_path = repo_root / "openspec" / "issue-mode.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


class ReconcileIssueProgressTest(unittest.TestCase):
    def run_script(self, repo_root: Path, change: str = "demo-change") -> dict[str, object]:
        process = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_PATH),
                "--repo-root",
                str(repo_root),
                "--change",
                change,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return json.loads(process.stdout)

    def test_semi_auto_requires_manual_confirmation_before_first_dispatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            write_issue_doc(repo_root, "demo-change")

            payload = self.run_script(repo_root)

        self.assertEqual(payload["automation_profile"], "semi_auto")
        self.assertEqual(payload["next_action"], "await_issue_dispatch_confirmation")
        self.assertEqual(payload["recommended_issue_id"], "ISSUE-001")

    def test_auto_issue_planning_dispatches_first_issue(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            write_issue_doc(repo_root, "demo-change")
            write_issue_mode_config(
                repo_root,
                {
                    "subagent_team": {
                        "auto_advance_after_issue_planning_review": True,
                    }
                },
            )

            payload = self.run_script(repo_root)

        self.assertEqual(payload["next_action"], "dispatch_next_issue")
        self.assertEqual(payload["recommended_issue_id"], "ISSUE-001")
        self.assertTrue(payload["automation"]["after_issue_planning_review"])

    def test_verify_step_can_pause_or_auto_run_based_on_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            write_issue_doc(repo_root, "demo-change")
            write_issue_progress(repo_root, "demo-change", status="completed")

            manual_payload = self.run_script(repo_root)

            write_issue_mode_config(
                repo_root,
                {
                    "subagent_team": {
                        "auto_run_change_verify": True,
                    }
                },
            )
            auto_payload = self.run_script(repo_root)

        self.assertEqual(manual_payload["next_action"], "await_verify_confirmation")
        self.assertEqual(auto_payload["next_action"], "verify_change")
        self.assertTrue(auto_payload["automation"]["run_change_verify"])

    def test_verify_pass_can_auto_archive_when_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            runs_dir = change_dir / "runs"
            write_issue_doc(repo_root, "demo-change")
            write_issue_progress(repo_root, "demo-change", status="completed", updated_at="2026-03-30T10:00:00+08:00")
            runs_dir.mkdir(parents=True, exist_ok=True)
            (runs_dir / "CHANGE-VERIFY.json").write_text(json.dumps(
                {
                    "status": "passed",
                    "updated_at": "2026-03-30T10:05:00+08:00",
                },
                ensure_ascii=False,
                indent=2,
            ))
            write_issue_mode_config(
                repo_root,
                {
                    "subagent_team": {
                        "auto_archive_after_verify": True,
                    }
                },
            )

            payload = self.run_script(repo_root)

        self.assertEqual(payload["next_action"], "archive_change")
        self.assertTrue(payload["automation"]["archive_after_verify"])


if __name__ == "__main__":
    unittest.main()
