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


if __name__ == "__main__":
    unittest.main()
