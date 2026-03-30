from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "render_change_lifecycle_dispatch.py"


class RenderChangeLifecycleDispatchTest(unittest.TestCase):
    def test_detects_spec_readiness_when_core_docs_are_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            change_dir.mkdir(parents=True)
            (change_dir / "proposal.md").write_text("# proposal\n")

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
            dispatch_text = (repo_root / payload["lifecycle_dispatch_path"]).read_text()

        self.assertEqual(payload["phase"], "spec_readiness")
        self.assertEqual(payload["focus_issue_id"], "")
        self.assertFalse(payload["auto_advance"]["after_design_review"])
        self.assertEqual(payload["automation_profile"], "semi_auto")
        self.assertIn("proposal / design / tasks", dispatch_text)
        self.assertIn("spec_readiness", dispatch_text)
        self.assertIn("审查通过后暂停，等待人工确认后再进入 issue planning", dispatch_text)
        self.assertIn("subagent_team.auto_advance_after_design_review=false", dispatch_text)

    def test_allows_auto_advance_after_design_review_when_config_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            change_dir.mkdir(parents=True)
            (change_dir / "proposal.md").write_text("# proposal\n")
            (repo_root / "openspec" / "issue-mode.json").parent.mkdir(parents=True, exist_ok=True)
            (repo_root / "openspec" / "issue-mode.json").write_text(textwrap.dedent(
                """\
                {
                  "subagent_team": {
                    "auto_advance_after_design_review": true
                  }
                }
                """
            ))

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
            dispatch_text = (repo_root / payload["lifecycle_dispatch_path"]).read_text()

        self.assertEqual(payload["phase"], "spec_readiness")
        self.assertTrue(payload["auto_advance"]["after_design_review"])
        self.assertIn("审查通过后自动进入 issue planning", dispatch_text)
        self.assertIn("subagent_team.auto_advance_after_design_review=true", dispatch_text)

    def test_issue_planning_can_auto_dispatch_when_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            change_dir.mkdir(parents=True)
            (change_dir / "proposal.md").write_text("# proposal\n")
            (change_dir / "design.md").write_text("# design\n")
            (change_dir / "tasks.md").write_text("- [ ] 1.1 plan issues\n")
            (repo_root / "openspec" / "issue-mode.json").parent.mkdir(parents=True, exist_ok=True)
            (repo_root / "openspec" / "issue-mode.json").write_text(textwrap.dedent(
                """\
                {
                  "subagent_team": {
                    "auto_advance_after_issue_planning_review": true
                  }
                }
                """
            ))

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
            dispatch_text = (repo_root / payload["lifecycle_dispatch_path"]).read_text()

        self.assertEqual(payload["phase"], "issue_planning")
        self.assertTrue(payload["auto_advance"]["after_issue_planning_review"])
        self.assertIn("审查通过后自动派发当前 round 已批准的 issue", dispatch_text)
        self.assertIn("subagent_team.auto_advance_after_issue_planning_review=true", dispatch_text)

    def test_detects_issue_execution_and_renders_issue_packet(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            issues_dir = change_dir / "issues"
            control_dir = change_dir / "control"
            issues_dir.mkdir(parents=True)
            control_dir.mkdir(parents=True)

            (change_dir / "proposal.md").write_text("# proposal\n")
            (change_dir / "design.md").write_text("# design\n")
            (change_dir / "tasks.md").write_text("- [ ] 1.1 ship issue flow\n")
            (issues_dir / "INDEX.md").write_text("- `ISSUE-001` `1.1`\n")
            (issues_dir / "ISSUE-001.md").write_text(textwrap.dedent(
                """\
                ---
                issue_id: ISSUE-001
                title: 生命周期执行
                worker_worktree: .worktree/demo-change/ISSUE-001
                allowed_scope:
                  - src/demo.ts
                out_of_scope:
                  - electron/
                done_when:
                  - 输出 issue team packet
                validation:
                  - pnpm lint
                ---
                """
            ))
            (control_dir / "BACKLOG.md").write_text("## Must Fix Now\n- none\n")
            (control_dir / "ROUND-01.md").write_text(textwrap.dedent(
                """\
                ## Round Target
                - 推进 ISSUE-001

                ## Target Mode
                - quality

                ## Scope In Round
                - ISSUE-001

                ## Acceptance Criteria
                - ISSUE-001 可继续执行

                ## Next Action
                - 继续 ISSUE-001
                """
            ))

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
            lifecycle_text = (repo_root / payload["lifecycle_dispatch_path"]).read_text()
            issue_team_text = (repo_root / payload["issue_team_dispatch_path"]).read_text()

        self.assertEqual(payload["phase"], "issue_execution")
        self.assertEqual(payload["focus_issue_id"], "ISSUE-001")
        self.assertTrue(payload["issue_team_dispatch_path"].endswith("ISSUE-001.team.dispatch.md"))
        self.assertIn("Current issue packet", lifecycle_text)
        self.assertIn("ISSUE-001.team.dispatch.md", lifecycle_text)
        self.assertIn("Development group: 3 subagents", issue_team_text)
        self.assertIn("Check group: 3 subagents", issue_team_text)
        self.assertIn("Review group: 3 subagents", issue_team_text)

    def test_enters_change_verify_phase_when_auto_verify_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            issues_dir = change_dir / "issues"
            control_dir = change_dir / "control"
            issues_dir.mkdir(parents=True)
            control_dir.mkdir(parents=True)

            (change_dir / "proposal.md").write_text("# proposal\n")
            (change_dir / "design.md").write_text("# design\n")
            (change_dir / "tasks.md").write_text("- [x] 1.1 ship issue flow\n")
            (issues_dir / "INDEX.md").write_text("- `ISSUE-001` `1.1`\n")
            (issues_dir / "ISSUE-001.md").write_text(textwrap.dedent(
                """\
                ---
                issue_id: ISSUE-001
                title: 生命周期执行
                worker_worktree: .worktree/demo-change/ISSUE-001
                allowed_scope:
                  - src/demo.ts
                out_of_scope:
                  - electron/
                done_when:
                  - 输出 issue team packet
                validation:
                  - pnpm lint
                ---
                """
            ))
            (issues_dir / "ISSUE-001.progress.json").write_text(textwrap.dedent(
                """\
                {
                  "issue_id": "ISSUE-001",
                  "status": "completed",
                  "boundary_status": "accepted",
                  "next_action": ""
                }
                """
            ))
            (control_dir / "BACKLOG.md").write_text("## Must Fix Now\n- none\n")
            (control_dir / "ROUND-01.md").write_text(textwrap.dedent(
                """\
                ## Round Target
                - 完成 demo-change

                ## Acceptance Verdict
                - pass

                ## Next Action
                - run verify
                """
            ))
            (repo_root / "openspec" / "issue-mode.json").parent.mkdir(parents=True, exist_ok=True)
            (repo_root / "openspec" / "issue-mode.json").write_text(textwrap.dedent(
                """\
                {
                  "rra": {
                    "gate_mode": "enforce"
                  },
                  "subagent_team": {
                    "auto_advance_after_design_review": true,
                    "auto_advance_after_issue_planning_review": true,
                    "auto_advance_to_next_issue_after_issue_pass": true,
                    "auto_run_change_verify": true,
                    "auto_archive_after_verify": true
                  }
                }
                """
            ))

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
            dispatch_text = (repo_root / payload["lifecycle_dispatch_path"]).read_text()

        self.assertEqual(payload["phase"], "change_verify")
        self.assertEqual(payload["automation_profile"], "full_auto")
        self.assertTrue(payload["auto_advance"]["run_change_verify"])
        self.assertIn("coordinator_verify_change.py", dispatch_text)
        self.assertIn("subagent_team.auto_run_change_verify=true", dispatch_text)

    def test_ready_for_archive_reflects_auto_archive_switch(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            issues_dir = change_dir / "issues"
            runs_dir = change_dir / "runs"
            issues_dir.mkdir(parents=True)
            runs_dir.mkdir(parents=True)

            (change_dir / "proposal.md").write_text("# proposal\n")
            (change_dir / "design.md").write_text("# design\n")
            (change_dir / "tasks.md").write_text("- [x] 1.1 ship issue flow\n")
            (issues_dir / "INDEX.md").write_text("- `ISSUE-001` `1.1`\n")
            (issues_dir / "ISSUE-001.md").write_text(textwrap.dedent(
                """\
                ---
                issue_id: ISSUE-001
                title: 生命周期执行
                worker_worktree: .worktree/demo-change/ISSUE-001
                allowed_scope:
                  - src/demo.ts
                out_of_scope:
                  - electron/
                done_when:
                  - 输出 issue team packet
                validation:
                  - pnpm lint
                ---
                """
            ))
            (issues_dir / "ISSUE-001.progress.json").write_text(textwrap.dedent(
                """\
                {
                  "issue_id": "ISSUE-001",
                  "status": "completed",
                  "boundary_status": "accepted",
                  "next_action": "",
                  "updated_at": "2026-03-30T10:00:00+08:00"
                }
                """
            ))
            (runs_dir / "CHANGE-VERIFY.json").write_text(textwrap.dedent(
                """\
                {
                  "status": "passed",
                  "completed_issue_ids": ["ISSUE-001"],
                  "updated_at": "2026-03-30T10:05:00+08:00"
                }
                """
            ))
            (repo_root / "openspec" / "issue-mode.json").parent.mkdir(parents=True, exist_ok=True)
            (repo_root / "openspec" / "issue-mode.json").write_text(textwrap.dedent(
                """\
                {
                  "subagent_team": {
                    "auto_archive_after_verify": true
                  }
                }
                """
            ))

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
            dispatch_text = (repo_root / payload["lifecycle_dispatch_path"]).read_text()

        self.assertEqual(payload["phase"], "ready_for_archive")
        self.assertTrue(payload["auto_advance"]["archive_after_verify"])
        self.assertIn('openspec archive "demo-change"', dispatch_text)
        self.assertIn("subagent_team.auto_archive_after_verify=true", dispatch_text)


if __name__ == "__main__":
    unittest.main()
