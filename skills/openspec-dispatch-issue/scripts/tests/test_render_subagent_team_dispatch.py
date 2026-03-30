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
        self.assertIn("subagent team 主链", dispatch_text)
        self.assertIn("Development group: 3 subagents", dispatch_text)
        self.assertIn("Check group: 3 subagents", dispatch_text)
        self.assertIn("Review group: 3 subagents", dispatch_text)
        self.assertIn("Target mode:", dispatch_text)
        self.assertIn("`quality`", dispatch_text)
        self.assertIn("ISSUE-001", dispatch_text)
        self.assertIn("pnpm lint", dispatch_text)
        self.assertIn("修复 ISSUE-001 gate", dispatch_text)


if __name__ == "__main__":
    unittest.main()
