from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "create_worker_worktree.py"


class CreateWorkerWorktreeTest(unittest.TestCase):
    def test_shared_workspace_mode_reuses_repo_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            openspec_dir = repo_root / "openspec"
            openspec_dir.mkdir(parents=True)
            (openspec_dir / "issue-mode.json").write_text(textwrap.dedent(
                """\
                {
                  "worker_worktree": {
                    "enabled": false
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

        self.assertEqual(Path(payload["worktree"]).resolve(), repo_root.resolve())
        self.assertEqual(payload["worktree_relative"], ".")
        self.assertEqual(payload["mode"], "shared")
        self.assertEqual(payload["base_ref"], "")
        self.assertEqual(payload["branch_name"], "")
        self.assertTrue(payload["shared_workspace"])
        self.assertFalse(payload["created"])
        self.assertTrue(payload["existed"])

    def test_change_scope_reuses_one_worktree_per_change(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            openspec_dir = repo_root / "openspec"
            openspec_dir.mkdir(parents=True)
            (openspec_dir / "issue-mode.json").write_text(textwrap.dedent(
                """\
                {
                  "worker_worktree": {
                    "enabled": true,
                    "scope": "change",
                    "mode": "branch",
                    "base_ref": "HEAD",
                    "branch_prefix": "opsx"
                  }
                }
                """
            ))
            subprocess.run(["git", "init"], cwd=str(repo_root), capture_output=True, text=True, check=True)
            subprocess.run(["git", "config", "user.name", "Test User"], cwd=str(repo_root), capture_output=True, text=True, check=True)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=str(repo_root), capture_output=True, text=True, check=True)
            (repo_root / "README.md").write_text("demo\n")
            subprocess.run(["git", "add", "."], cwd=str(repo_root), capture_output=True, text=True, check=True)
            subprocess.run(["git", "commit", "-m", "init"], cwd=str(repo_root), capture_output=True, text=True, check=True)

            first_process = subprocess.run(
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
            second_process = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--repo-root",
                    str(repo_root),
                    "--change",
                    "demo-change",
                    "--issue-id",
                    "ISSUE-002",
                ],
                capture_output=True,
                text=True,
                check=True,
            )

            first_payload = json.loads(first_process.stdout)
            second_payload = json.loads(second_process.stdout)

        self.assertEqual(first_payload["workspace_scope"], "change")
        self.assertEqual(second_payload["workspace_scope"], "change")
        self.assertTrue(first_payload["created"])
        self.assertFalse(second_payload["created"])
        self.assertEqual(first_payload["worktree_relative"], ".worktree/demo-change")
        self.assertEqual(second_payload["worktree_relative"], ".worktree/demo-change")
        self.assertEqual(first_payload["branch_name"], "opsx/demo-change")
        self.assertEqual(second_payload["branch_name"], "opsx/demo-change")


if __name__ == "__main__":
    unittest.main()
