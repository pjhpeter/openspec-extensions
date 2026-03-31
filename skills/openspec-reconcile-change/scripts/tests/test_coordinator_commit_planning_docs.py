from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "coordinator_commit_planning_docs.py"


def run(cmd: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, check=True)


def git(repo_root: Path, *args: str) -> str:
    return run(["git", *args], cwd=repo_root).stdout.strip()


class CoordinatorCommitPlanningDocsTest(unittest.TestCase):
    def test_commits_only_planning_docs_for_change(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change = "demo-change"
            change_dir = repo_root / "openspec" / "changes" / change
            issues_dir = change_dir / "issues"
            src_dir = repo_root / "src"
            issues_dir.mkdir(parents=True, exist_ok=True)
            src_dir.mkdir(parents=True, exist_ok=True)

            run(["git", "init"], cwd=repo_root)
            run(["git", "config", "user.name", "Test User"], cwd=repo_root)
            run(["git", "config", "user.email", "test@example.com"], cwd=repo_root)

            (src_dir / "keep.ts").write_text("export const keep = 1;\n")
            run(["git", "add", "."], cwd=repo_root)
            run(["git", "commit", "-m", "init repo"], cwd=repo_root)

            (change_dir / "proposal.md").write_text("# proposal\n")
            (change_dir / "design.md").write_text("# design\n")
            (change_dir / "tasks.md").write_text("- [ ] 1.1 split work\n")
            (issues_dir / "INDEX.md").write_text("- `ISSUE-001` `1.1`\n")
            (issues_dir / "ISSUE-001.md").write_text(textwrap.dedent(
                """\
                ---
                issue_id: ISSUE-001
                title: Demo issue
                worker_worktree: .
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
            (src_dir / "keep.ts").write_text("export const keep = 2;\n")

            process = run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--repo-root",
                    str(repo_root),
                    "--change",
                    change,
                ],
                cwd=repo_root,
            )

            payload = json.loads(process.stdout)
            status = git(repo_root, "status", "--short")
            head_message = git(repo_root, "log", "-1", "--pretty=%s")
            committed_files = git(repo_root, "show", "--pretty=", "--name-only", "HEAD")

        self.assertEqual(payload["status"], "committed")
        self.assertEqual(head_message, f"opsx({change}): commit planning docs")
        self.assertIn(" M src/keep.ts", f" {status}")
        self.assertIn(f"openspec/changes/{change}/proposal.md", committed_files)
        self.assertIn(f"openspec/changes/{change}/design.md", committed_files)
        self.assertIn(f"openspec/changes/{change}/tasks.md", committed_files)
        self.assertIn(f"openspec/changes/{change}/issues/INDEX.md", committed_files)
        self.assertIn(f"openspec/changes/{change}/issues/ISSUE-001.md", committed_files)
        self.assertNotIn("src/keep.ts", committed_files)


if __name__ == "__main__":
    unittest.main()
