from __future__ import annotations

import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from issue_mode_common import extract_open_work_items, load_issue_mode_config, read_change_control_state  # noqa: E402


class ExtractOpenWorkItemsTest(unittest.TestCase):
    def test_ignores_placeholder_list_items(self) -> None:
        items = extract_open_work_items([
            "- None.",
            "- 无",
            "- 暂无",
            "- n/a",
        ])

        self.assertEqual(items, [])

    def test_keeps_real_list_items(self) -> None:
        items = extract_open_work_items([
            "- 补齐 ISSUE-002 命令覆盖矩阵",
            "- add preload transport follow-up change",
        ])

        self.assertEqual(items, [
            "补齐 ISSUE-002 命令覆盖矩阵",
            "add preload transport follow-up change",
        ])

    def test_ignores_unchecked_placeholder_checkboxes_only(self) -> None:
        items = extract_open_work_items([
            "- [ ] None",
            "- [ ] 无待处理项",
            "- [ ] 真正待办事项",
            "- [x] 已完成事项",
        ])

        self.assertEqual(items, ["真正待办事项"])


class ReadChangeControlStateTest(unittest.TestCase):
    def test_extracts_structured_round_contract_and_backlog(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            control_dir = repo_root / "openspec" / "changes" / "demo-change" / "control"
            control_dir.mkdir(parents=True)
            (control_dir / "BACKLOG.md").write_text(textwrap.dedent(
                """\
                # Backlog

                ## Must Fix Now
                - [ ] 修复 ISSUE-002 gate

                ## Should Fix If Cheap
                - 补一条轻量日志

                ## Defer
                - 延后处理非关键重构
                """
            ))
            (control_dir / "ROUND-02.md").write_text(textwrap.dedent(
                """\
                # Round 2

                ## Round Target
                - 让 ISSUE-001 达到可接受状态

                ## Target Mode
                - release

                ## Acceptance Criteria
                - 主路径可用
                - 校验命令能跑通

                ## Non-Goals
                - 不处理额外重构

                ## Scope In Round
                - ISSUE-001
                - src/feature.ts

                ## Normalized Backlog
                - Must fix now: 修复 ISSUE-001 回归

                ## Fixes Completed
                - 补齐 ISSUE-001 的按钮状态

                ## Re-review Result
                - 已覆盖受影响主路径

                ## Acceptance Verdict
                - pass with noted debt

                ## Next Action
                - 可以继续 verify，必要时补做 ISSUE-001 follow-up
                """
            ))

            state = read_change_control_state(repo_root, "demo-change")

        self.assertTrue(state["enabled"])
        self.assertEqual(state["backlog"]["must_fix_now"]["open_items"], ["修复 ISSUE-002 gate"])
        self.assertEqual(state["backlog"]["should_fix_if_cheap"]["open_items"], ["补一条轻量日志"])
        self.assertEqual(state["backlog"]["defer"]["open_items"], ["延后处理非关键重构"])
        self.assertEqual(state["latest_round"]["round_target"], "让 ISSUE-001 达到可接受状态")
        self.assertEqual(state["latest_round"]["target_mode"], "release")
        self.assertEqual(state["latest_round"]["acceptance_criteria"], ["主路径可用", "校验命令能跑通"])
        self.assertEqual(state["latest_round"]["non_goals"], ["不处理额外重构"])
        self.assertEqual(state["latest_round"]["scope_in_round"], ["ISSUE-001", "src/feature.ts"])
        self.assertEqual(state["latest_round"]["fixes_completed"], ["补齐 ISSUE-001 的按钮状态"])
        self.assertEqual(state["latest_round"]["re_review_result"], ["已覆盖受影响主路径"])
        self.assertEqual(state["latest_round"]["acceptance_status"], "accepted")
        self.assertTrue(state["latest_round"]["allows_verify"])
        self.assertEqual(state["latest_round"]["referenced_issue_ids"], ["ISSUE-001"])


class LoadIssueModeConfigTest(unittest.TestCase):
    def test_ignores_legacy_detached_worker_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            openspec_dir = repo_root / "openspec"
            openspec_dir.mkdir(parents=True)
            (openspec_dir / "issue-mode.json").write_text(textwrap.dedent(
                """\
                {
                  "worktree_root": ".worktree",
                  "validation_commands": ["pnpm lint"],
                  "worker_worktree": {
                    "mode": "branch",
                    "base_ref": "main",
                    "branch_prefix": "demo"
                  },
                  "rra": {
                    "gate_mode": "enforce"
                  },
                  "subagent_team": {
                    "auto_accept_spec_readiness": true,
                    "auto_accept_issue_planning": true,
                    "auto_accept_issue_review": true,
                    "auto_accept_change_acceptance": true,
                    "auto_archive_after_verify": true
                  },
                  "codex_home": "~/.codex",
                  "persistent_host": {
                    "kind": "screen"
                  },
                  "coordinator_heartbeat": {
                    "auto_launch_next": true
                  },
                  "worker_launcher": {
                    "session_prefix": "legacy"
                  }
                }
                """
            ))

            config = load_issue_mode_config(repo_root)

        self.assertEqual(config["worktree_root"], ".worktree")
        self.assertEqual(config["validation_commands"], ["pnpm lint"])
        self.assertEqual(config["worker_worktree"]["mode"], "branch")
        self.assertEqual(config["worker_worktree"]["base_ref"], "main")
        self.assertEqual(config["worker_worktree"]["branch_prefix"], "demo")
        self.assertEqual(config["rra"]["gate_mode"], "enforce")
        self.assertTrue(config["subagent_team"]["auto_accept_spec_readiness"])
        self.assertTrue(config["subagent_team"]["auto_accept_issue_planning"])
        self.assertTrue(config["subagent_team"]["auto_accept_issue_review"])
        self.assertTrue(config["subagent_team"]["auto_accept_change_acceptance"])
        self.assertTrue(config["subagent_team"]["auto_archive_after_verify"])
        self.assertNotIn("codex_home", config)
        self.assertNotIn("persistent_host", config)
        self.assertNotIn("coordinator_heartbeat", config)
        self.assertNotIn("worker_launcher", config)


if __name__ == "__main__":
    unittest.main()
