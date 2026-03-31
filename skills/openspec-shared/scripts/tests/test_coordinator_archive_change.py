from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "coordinator_archive_change.py"


def run(cmd: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, check=True)


def git(repo_root: Path, *args: str) -> str:
    return run(["git", *args], cwd=repo_root).stdout.strip()


class CoordinatorArchiveChangeTest(unittest.TestCase):
    def test_archive_wrapper_cleans_change_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            (repo_root / "openspec").mkdir(parents=True, exist_ok=True)
            (repo_root / "openspec" / "issue-mode.json").write_text(textwrap.dedent(
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
            run(["git", "init"], cwd=repo_root)
            run(["git", "config", "user.name", "Test User"], cwd=repo_root)
            run(["git", "config", "user.email", "test@example.com"], cwd=repo_root)
            (repo_root / "README.md").write_text("demo\n")
            run(["git", "add", "."], cwd=repo_root)
            run(["git", "commit", "-m", "init"], cwd=repo_root)
            worktree_path = repo_root / ".worktree" / "demo-change"
            run(["git", "worktree", "add", "-b", "opsx/demo-change", str(worktree_path), "HEAD"], cwd=repo_root)

            process = run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--repo-root",
                    str(repo_root),
                    "--change",
                    "demo-change",
                    "--archive-command",
                    "python3 -c \"from pathlib import Path; Path('archived.flag').write_text('ok')\"",
                ],
                cwd=repo_root,
            )

            payload = json.loads(process.stdout)
            branches = git(repo_root, "branch", "--list", "opsx/demo-change")
            archive_flag = (repo_root / "archived.flag").read_text()

        self.assertTrue(payload["archived"])
        self.assertTrue(payload["cleanup"]["required"])
        self.assertTrue(payload["cleanup"]["removed"])
        self.assertTrue(payload["cleanup"]["branch_deleted"])
        self.assertEqual(archive_flag, "ok")
        self.assertEqual(branches, "")


if __name__ == "__main__":
    unittest.main()
