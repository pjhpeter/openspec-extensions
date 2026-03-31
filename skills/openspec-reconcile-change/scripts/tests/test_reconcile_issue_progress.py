from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "reconcile_issue_progress.py"


def run(cmd: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, check=True)


def init_git_repo(repo_root: Path) -> None:
    run(["git", "init"], cwd=repo_root)
    run(["git", "config", "user.name", "Test User"], cwd=repo_root)
    run(["git", "config", "user.email", "test@example.com"], cwd=repo_root)


def commit_all(repo_root: Path, message: str) -> None:
    run(["git", "add", "."], cwd=repo_root)
    run(["git", "commit", "-m", message], cwd=repo_root)


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
    boundary_status: str | None = None,
    next_action: str = "",
    validation: dict[str, str] | None = None,
    updated_at: str = "2026-03-30T10:00:00+08:00",
) -> Path:
    progress_path = repo_root / "openspec" / "changes" / change / "issues" / f"{issue_id}.progress.json"
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    progress_path.write_text(json.dumps(
        {
            "issue_id": issue_id,
            "status": status,
            "boundary_status": boundary_status if boundary_status is not None else ("accepted" if status == "completed" else ""),
            "next_action": next_action,
            "validation": validation or {},
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


def write_change_review_artifact(
    repo_root: Path,
    change: str,
    *,
    status: str = "passed",
    updated_at: str = "2026-03-30T10:05:00+08:00",
) -> None:
    review_path = repo_root / "openspec" / "changes" / change / "runs" / "CHANGE-REVIEW.json"
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(json.dumps(
        {
            "change": change,
            "status": status,
            "updated_at": updated_at,
        },
        ensure_ascii=False,
        indent=2,
    ))


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
            init_git_repo(repo_root)
            commit_all(repo_root, "commit planning docs")

            payload = self.run_script(repo_root)

        self.assertEqual(payload["automation_profile"], "semi_auto")
        self.assertTrue(payload["automation"]["accept_issue_review"])
        self.assertEqual(payload["next_action"], "await_issue_dispatch_confirmation")
        self.assertEqual(payload["recommended_issue_id"], "ISSUE-001")
        self.assertEqual(payload["continuation_policy"]["mode"], "await_human_confirmation")
        self.assertTrue(payload["continuation_policy"]["pause_allowed"])

    def test_default_issue_review_auto_accepts_validated_issue(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change = "demo-change"
            write_issue_doc(repo_root, change, issue_id="ISSUE-001")
            write_issue_progress(
                repo_root,
                change,
                issue_id="ISSUE-001",
                status="completed",
                boundary_status="review_required",
                next_action="coordinator_review",
                validation={"pnpm lint": "passed", "pnpm type-check": "passed"},
            )

            payload = self.run_script(repo_root, change=change)

        self.assertEqual(payload["automation_profile"], "semi_auto")
        self.assertTrue(payload["automation"]["accept_issue_review"])
        self.assertEqual(payload["next_action"], "auto_accept_issue")
        self.assertEqual(payload["recommended_issue_id"], "ISSUE-001")
        self.assertEqual(payload["continuation_policy"]["mode"], "continue_immediately")

    def test_auto_issue_planning_dispatches_first_issue(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            write_issue_doc(repo_root, "demo-change")
            write_issue_mode_config(
                repo_root,
                {
                    "subagent_team": {
                        "auto_accept_issue_planning": True,
                    }
                },
            )
            init_git_repo(repo_root)
            commit_all(repo_root, "commit planning docs")

            payload = self.run_script(repo_root)

        self.assertEqual(payload["next_action"], "dispatch_next_issue")
        self.assertEqual(payload["recommended_issue_id"], "ISSUE-001")
        self.assertTrue(payload["automation"]["accept_issue_planning"])
        self.assertEqual(payload["continuation_policy"]["mode"], "continue_immediately")
        self.assertFalse(payload["continuation_policy"]["pause_allowed"])
        self.assertTrue(payload["continuation_policy"]["must_not_stop_at_checkpoint"])
        self.assertIn("不是 terminal checkpoint", payload["continuation_policy"]["instruction"])

    def test_first_issue_requires_planning_doc_commit_before_dispatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            write_issue_doc(repo_root, "demo-change")
            init_git_repo(repo_root)

            payload = self.run_script(repo_root)

        self.assertEqual(payload["next_action"], "await_planning_docs_commit_confirmation")
        self.assertEqual(payload["recommended_issue_id"], "ISSUE-001")
        self.assertEqual(payload["continuation_policy"]["mode"], "await_human_confirmation")
        self.assertTrue(payload["planning_docs"]["needs_commit"])
        self.assertIn("需先提交规划文档", payload["reason"])

    def test_auto_issue_planning_commits_docs_before_first_dispatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            write_issue_doc(repo_root, "demo-change")
            write_issue_mode_config(
                repo_root,
                {
                    "subagent_team": {
                        "auto_accept_issue_planning": True,
                    }
                },
            )
            init_git_repo(repo_root)

            payload = self.run_script(repo_root)

        self.assertEqual(payload["next_action"], "commit_planning_docs")
        self.assertEqual(payload["recommended_issue_id"], "ISSUE-001")
        self.assertEqual(payload["continuation_policy"]["mode"], "continue_immediately")
        self.assertTrue(payload["planning_docs"]["needs_commit"])
        self.assertIn("先自动提交规划文档", payload["reason"])

    def test_auto_issue_review_can_auto_accept_when_validation_passed(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change = "demo-change"
            write_issue_doc(repo_root, change, issue_id="ISSUE-001")
            write_issue_doc(repo_root, change, issue_id="ISSUE-002")
            write_issue_progress(
                repo_root,
                change,
                issue_id="ISSUE-001",
                status="completed",
                boundary_status="review_required",
                next_action="coordinator_review",
                validation={"pnpm lint": "passed", "pnpm type-check": "passed"},
            )
            write_issue_mode_config(
                repo_root,
                {
                    "subagent_team": {
                        "auto_accept_issue_review": True,
                    }
                },
            )

            payload = self.run_script(repo_root, change=change)

        self.assertEqual(payload["next_action"], "auto_accept_issue")
        self.assertEqual(payload["recommended_issue_id"], "ISSUE-001")
        self.assertTrue(payload["automation"]["accept_issue_review"])
        self.assertEqual(payload["continuation_policy"]["mode"], "continue_immediately")
        self.assertFalse(payload["continuation_policy"]["pause_allowed"])

    def test_verify_step_can_pause_or_auto_run_based_on_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            write_issue_doc(repo_root, "demo-change")
            write_issue_progress(repo_root, "demo-change", status="completed")
            write_change_review_artifact(repo_root, "demo-change")

            manual_payload = self.run_script(repo_root)

            write_issue_mode_config(
                repo_root,
                {
                    "subagent_team": {
                        "auto_accept_change_acceptance": True,
                    }
                },
            )
            auto_payload = self.run_script(repo_root)

        self.assertEqual(manual_payload["next_action"], "await_verify_confirmation")
        self.assertEqual(auto_payload["next_action"], "verify_change")
        self.assertTrue(auto_payload["automation"]["accept_change_acceptance"])
        self.assertEqual(manual_payload["continuation_policy"]["mode"], "await_human_confirmation")
        self.assertEqual(auto_payload["continuation_policy"]["mode"], "continue_immediately")
        self.assertTrue(auto_payload["continuation_policy"]["must_not_stop_at_checkpoint"])

    def test_verify_pass_can_auto_archive_when_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            runs_dir = change_dir / "runs"
            write_issue_doc(repo_root, "demo-change")
            write_issue_progress(repo_root, "demo-change", status="completed", updated_at="2026-03-30T10:00:00+08:00")
            write_change_review_artifact(repo_root, "demo-change", updated_at="2026-03-30T10:03:00+08:00")
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
        self.assertEqual(payload["continuation_policy"]["mode"], "continue_immediately")

    def test_all_completed_requires_change_review_before_verify(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            write_issue_doc(repo_root, "demo-change")
            write_issue_progress(repo_root, "demo-change", status="completed")

            payload = self.run_script(repo_root)

        self.assertEqual(payload["next_action"], "review_change_code")
        self.assertIn("需先运行 change-level /review", payload["reason"])
        self.assertEqual(payload["continuation_policy"]["mode"], "resolve_or_inspect")


if __name__ == "__main__":
    unittest.main()
