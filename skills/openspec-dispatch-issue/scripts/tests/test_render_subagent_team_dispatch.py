from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "render_subagent_team_dispatch.py"


class RenderSubagentTeamDispatchTest(unittest.TestCase):
    def test_renders_team_dispatch_from_issue_and_control_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            issues_dir = change_dir / "issues"
            control_dir = change_dir / "control"
            issues_dir.mkdir(parents=True)
            control_dir.mkdir(parents=True)

            (issues_dir / "ISSUE-001.md").write_text(textwrap.dedent(
                """\
                ---
                issue_id: ISSUE-001
                title: 接入 team dispatch
                worker_worktree: .worktree/demo-change/ISSUE-001
                allowed_scope:
                  - src/dispatch.ts
                out_of_scope:
                  - electron/
                done_when:
                  - 输出 team packet
                validation:
                  - pnpm lint
                  - pnpm type-check
                ---
                """
            ))
            (control_dir / "BACKLOG.md").write_text(textwrap.dedent(
                """\
                ## Must Fix Now
                - [ ] 修复 ISSUE-001 gate
                """
            ))
            (control_dir / "ROUND-01.md").write_text(textwrap.dedent(
                """\
                ## Round Target
                - 让 ISSUE-001 进入 subagent team 主链

                ## Target Mode
                - quality

                ## Acceptance Criteria
                - packet 可直接发给 coordinator

                ## Scope In Round
                - ISSUE-001

                ## Acceptance Verdict
                - accepted

                ## Next Action
                - 继续 dispatch ISSUE-001
                """
            ))
            (issues_dir / "ISSUE-001.progress.json").write_text(textwrap.dedent(
                """\
                {
                  "changed_files": [
                    "src/dispatch.ts",
                    "node_modules/react/index.js",
                    "coverage/lcov.info"
                  ],
                  "validation": {
                    "lint": "passed",
                    "typecheck": "pending"
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
                    "--issue-id",
                    "ISSUE-001",
                ],
                capture_output=True,
                text=True,
                check=True,
            )

            payload = json.loads(process.stdout)
            dispatch_path = repo_root / payload["team_dispatch_path"]
            dispatch_text = dispatch_path.read_text()

        self.assertEqual(payload["control_state"]["latest_round"]["target_mode"], "quality")
        self.assertEqual(payload["reasoning_policy"]["development_group"], "xhigh")
        self.assertEqual(payload["reasoning_policy"]["check_group"], "medium")
        self.assertEqual(payload["reasoning_policy"]["review_group"], "medium")
        self.assertIn("subagent team 主链", dispatch_text)
        self.assertIn("Development group: 3 subagents", dispatch_text)
        self.assertIn("Check group: 2 subagents", dispatch_text)
        self.assertIn("Review group: 1 subagent", dispatch_text)
        self.assertIn("Developer 1: core implementation owner", dispatch_text)
        self.assertIn("Checker 2: direct dependency regression risk, tests, evidence gaps", dispatch_text)
        self.assertIn("Reviewer 1: scope-first target path / direct dependency / evidence pass or fail", dispatch_text)
        self.assertIn("## Gate Barrier", dispatch_text)
        self.assertIn("最长 1 小时的 blocking wait", dispatch_text)
        self.assertIn("不要当作 `explorer` sidecar", dispatch_text)
        self.assertIn("Gate-bearing subagent roster with seat / agent_id / status", dispatch_text)
        self.assertIn("Launch with `reasoning_effort=xhigh`", dispatch_text)
        self.assertIn("Launch with `reasoning_effort=medium`", dispatch_text)
        self.assertIn("Current changed-file focus:", dispatch_text)
        self.assertIn("Current review starting scope:", dispatch_text)
        self.assertIn("Excluded incidental paths from review focus:", dispatch_text)
        self.assertIn("`src/dispatch.ts`", dispatch_text)
        self.assertIn("`node_modules/react/index.js`", dispatch_text)
        self.assertIn("`coverage/lcov.info`", dispatch_text)
        self.assertIn("lint=passed", dispatch_text)
        self.assertIn("typecheck=pending", dispatch_text)
        self.assertIn("默认排除 `node_modules`、`dist`、`build`、`.next`、`coverage`", dispatch_text)
        self.assertIn("Target mode:", dispatch_text)
        self.assertIn("`quality`", dispatch_text)
        self.assertIn("ISSUE-001", dispatch_text)
        self.assertIn("pnpm lint", dispatch_text)
        self.assertIn("修复 ISSUE-001 gate", dispatch_text)
        self.assertIn("openspec-extensions execute update-progress start --repo-root", dispatch_text)
        self.assertIn("openspec-extensions execute update-progress stop --repo-root", dispatch_text)
        self.assertNotIn("python3 .codex/skills", dispatch_text)

    def test_falls_back_to_issue_local_round_contract_when_latest_round_is_still_planning(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change_dir = repo_root / "openspec" / "changes" / "demo-change"
            issues_dir = change_dir / "issues"
            control_dir = change_dir / "control"
            issues_dir.mkdir(parents=True)
            control_dir.mkdir(parents=True)

            (issues_dir / "ISSUE-001.md").write_text(textwrap.dedent(
                """\
                ---
                issue_id: ISSUE-001
                title: 生命周期执行
                worker_worktree: .
                allowed_scope:
                  - src/demo.ts
                out_of_scope:
                  - electron/
                done_when:
                  - 共享模块已经落地
                validation:
                  - pnpm lint
                ---
                """
            ))
            (control_dir / "ROUND-01.md").write_text(textwrap.dedent(
                """\
                ## Round Target
                - 推进 issue planning 通过审查，并完成规划文档提交。

                ## Target Mode
                - release

                ## Acceptance Criteria
                - proposal / design / tasks / issue 文档以 coordinator commit 固化

                ## Scope In Round
                - proposal.md
                - design.md
                - tasks.md
                - issues/INDEX.md
                - issues/ISSUE-001.md

                ## Next Action
                - commit planning docs
                - dispatch ISSUE-001
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
                    "--issue-id",
                    "ISSUE-001",
                ],
                capture_output=True,
                text=True,
                check=True,
            )

            payload = json.loads(process.stdout)
            dispatch_text = (repo_root / payload["team_dispatch_path"]).read_text()

        self.assertIn("推进 ISSUE-001 完成开发、检查、修复、审查回合。", dispatch_text)
        self.assertIn("`ISSUE-001`", dispatch_text)
        self.assertIn("ISSUE-001 的目标范围达成", dispatch_text)
        self.assertIn("完成 ISSUE-001 的当前 round 后，由 coordinator 收敛开发 / 检查 / 审查结果。", dispatch_text)
        self.assertNotIn("proposal / design / tasks / issue 文档以 coordinator commit 固化", dispatch_text)
        self.assertNotIn("`proposal.md`", dispatch_text)
        self.assertNotIn("commit planning docs", dispatch_text)


if __name__ == "__main__":
    unittest.main()
