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
        self.assertFalse(payload["automation"]["accept_spec_readiness"])
        self.assertEqual(payload["automation_profile"], "semi_auto")
        self.assertEqual(payload["team_topology"][0]["label"], "Design author")
        self.assertEqual(payload["team_topology"][0]["count"], 1)
        self.assertEqual(payload["team_topology"][0]["reasoning_effort"], "xhigh")
        self.assertEqual(payload["team_topology"][1]["label"], "Design review")
        self.assertEqual(payload["team_topology"][1]["count"], 2)
        self.assertEqual(payload["team_topology"][1]["reasoning_effort"], "medium")
        self.assertIn("proposal / design", dispatch_text)
        self.assertIn("spec_readiness", dispatch_text)
        self.assertIn("Design author: 1 subagent", dispatch_text)
        self.assertIn("Design review: 2 subagents", dispatch_text)
        self.assertIn("Launch with `reasoning_effort=xhigh`", dispatch_text)
        self.assertIn("Launch with `reasoning_effort=medium`", dispatch_text)
        self.assertIn("当前 phase 的标准循环是：设计编写 -> 双评审 -> 修订 -> 双评审", dispatch_text)
        self.assertIn("## Gate Barrier", dispatch_text)
        self.assertIn("Design author: 1 required completion", dispatch_text)
        self.assertIn("Design review: 2 required completions", dispatch_text)
        self.assertIn("最长 1 小时的 blocking wait", dispatch_text)
        self.assertIn("不要当作 `explorer` sidecar", dispatch_text)
        self.assertIn("1 个设计作者和 2 个设计评审全部完成并收齐通过结论后暂停，等待人工确认后再进入任务拆分 / issue planning", dispatch_text)
        self.assertIn("subagent_team.auto_accept_spec_readiness=false", dispatch_text)

    def test_allows_auto_accept_spec_readiness_when_config_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            change_dir.mkdir(parents=True)
            (change_dir / "proposal.md").write_text("# proposal\n")
            (change_dir / "design.md").write_text("# design\n")
            (repo_root / "openspec" / "issue-mode.json").parent.mkdir(parents=True, exist_ok=True)
            (repo_root / "openspec" / "issue-mode.json").write_text(textwrap.dedent(
                """\
                {
                  "subagent_team": {
                    "auto_accept_spec_readiness": true
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
        self.assertTrue(payload["automation"]["accept_spec_readiness"])
        self.assertIn("当前 phase 的 gate-bearing subagent 全部完成且 verdict 满足条件后，coordinator 自动通过 design review，并进入任务拆分 / issue planning", dispatch_text)
        self.assertIn("subagent_team.auto_accept_spec_readiness=true", dispatch_text)

    def test_design_review_still_blocks_issue_planning_until_tasks_are_split(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            change_dir.mkdir(parents=True)
            (change_dir / "proposal.md").write_text("# proposal\n")
            (change_dir / "design.md").write_text("# design\n")

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
        self.assertIn("设计文档已齐全，但必须先经过 1 个设计作者和 2 个设计评审组成的 subagent team", payload["phase_reason"])
        self.assertIn("只有 2 个 reviewer 都通过，才允许进入 plan-issues / 任务拆分", dispatch_text)

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
                    "auto_accept_issue_planning": true
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
        self.assertTrue(payload["automation"]["accept_issue_planning"])
        self.assertIn("当前 phase 的 gate-bearing subagent 全部完成且 verdict 满足条件后，coordinator 自动通过 issue planning 评审并派发当前 round 已批准的 issue", dispatch_text)
        self.assertIn("subagent_team.auto_accept_issue_planning=true", dispatch_text)
        self.assertIn("tasks.md、INDEX 和 ISSUE 文档齐全且相互一致", dispatch_text)

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
        self.assertIn("Gate-bearing seats for this phase", lifecycle_text)
        self.assertIn("Development group: 3 subagents", issue_team_text)
        self.assertIn("Check group: 3 subagents", issue_team_text)
        self.assertIn("Review group: 3 subagents", issue_team_text)
        self.assertIn("Developer 2: dependent module or integration owner", issue_team_text)
        self.assertIn("Checker 2: architecture, data flow, concurrency, persistence risks", issue_team_text)
        self.assertIn("Reviewer 2: regression and operational risk pass / fail", issue_team_text)
        self.assertEqual(payload["team_topology"][0]["label"], "Development group")
        self.assertEqual(payload["team_topology"][0]["count"], 3)
        self.assertEqual(payload["team_topology"][0]["reasoning_effort"], "xhigh")
        self.assertEqual(payload["team_topology"][1]["reasoning_effort"], "medium")
        self.assertIn("Launch with `reasoning_effort=xhigh`", issue_team_text)
        self.assertIn("Launch with `reasoning_effort=medium`", issue_team_text)

    def test_enters_change_verify_phase_when_auto_verify_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            issues_dir = change_dir / "issues"
            control_dir = change_dir / "control"
            runs_dir = change_dir / "runs"
            issues_dir.mkdir(parents=True)
            control_dir.mkdir(parents=True)
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
            (runs_dir / "CHANGE-REVIEW.json").write_text(textwrap.dedent(
                """\
                {
                  "status": "passed",
                  "updated_at": "2026-03-30T10:05:00+08:00"
                }
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
                    "auto_accept_spec_readiness": true,
                    "auto_accept_issue_planning": true,
                    "auto_accept_issue_review": true,
                    "auto_accept_change_acceptance": true,
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
        self.assertTrue(payload["automation"]["accept_change_acceptance"])
        self.assertIn("coordinator_verify_change.py", dispatch_text)
        self.assertIn("subagent_team.auto_accept_change_acceptance=true", dispatch_text)
        self.assertIn("CHANGE-REVIEW.json 为当前 issue 集合的最新 review 结果", dispatch_text)

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
            (runs_dir / "CHANGE-REVIEW.json").write_text(textwrap.dedent(
                """\
                {
                  "status": "passed",
                  "updated_at": "2026-03-30T10:03:00+08:00"
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
        self.assertTrue(payload["automation"]["archive_after_verify"])
        self.assertIn('openspec archive "demo-change"', dispatch_text)
        self.assertIn("subagent_team.auto_archive_after_verify=true", dispatch_text)

    def test_change_acceptance_requires_change_review_before_verify(self) -> None:
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
                  "next_action": "",
                  "updated_at": "2026-03-30T10:00:00+08:00"
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

        self.assertEqual(payload["phase"], "change_acceptance")
        self.assertIn("需先对当前 change 修改的代码运行 /review", payload["phase_reason"])
        self.assertIn("coordinator_review_change.py", dispatch_text)
        self.assertIn("只有 change-level /review 通过后，才允许继续进入 verify", dispatch_text)
        self.assertIn("任一 required gate-bearing subagent 仍在运行时，不允许提前通过当前 phase", dispatch_text)


if __name__ == "__main__":
    unittest.main()
