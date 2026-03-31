from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "coordinator_merge_issue.py"


def run(cmd: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, check=True)


def git(repo_root: Path, *args: str) -> str:
    return run(["git", *args], cwd=repo_root).stdout.strip()


class CoordinatorMergeIssueTest(unittest.TestCase):
    def test_accepts_and_commits_shared_workspace_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change = "demo-change"
            issue_id = "ISSUE-001"
            change_dir = repo_root / "openspec" / "changes" / change
            issues_dir = change_dir / "issues"
            runs_dir = change_dir / "runs"
            src_dir = repo_root / "src"
            issues_dir.mkdir(parents=True, exist_ok=True)
            runs_dir.mkdir(parents=True, exist_ok=True)
            src_dir.mkdir(parents=True, exist_ok=True)

            run(["git", "init"], cwd=repo_root)
            run(["git", "config", "user.name", "Test User"], cwd=repo_root)
            run(["git", "config", "user.email", "test@example.com"], cwd=repo_root)

            (src_dir / "demo.ts").write_text("export const demo = 1;\n")
            (issues_dir / f"{issue_id}.md").write_text(textwrap.dedent(
                f"""\
                ---
                issue_id: {issue_id}
                title: Shared workspace issue
                worker_worktree: .
                allowed_scope:
                  - src/demo.ts
                out_of_scope:
                  - electron/
                done_when:
                  - 完成 shared workspace 收敛
                validation:
                  - pnpm lint
                  - pnpm type-check
                ---
                """
            ))
            (issues_dir / f"{issue_id}.progress.json").write_text(json.dumps(
                {
                    "change": change,
                    "issue_id": issue_id,
                    "status": "completed",
                    "boundary_status": "review_required",
                    "next_action": "coordinator_review",
                    "summary": "ready",
                    "validation": {
                        "lint": "passed",
                        "typecheck": "passed",
                    },
                    "changed_files": ["src/demo.ts"],
                    "run_id": "RUN-20260331T000000-ISSUE-001",
                    "updated_at": "2026-03-31T00:00:00+08:00",
                },
                ensure_ascii=False,
                indent=2,
            ))

            run(["git", "add", "."], cwd=repo_root)
            run(["git", "commit", "-m", "init change artifacts"], cwd=repo_root)

            (src_dir / "demo.ts").write_text("export const demo = 2;\n")

            process = run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--repo-root",
                    str(repo_root),
                    "--change",
                    change,
                    "--issue-id",
                    issue_id,
                ],
                cwd=repo_root,
            )

            payload = json.loads(process.stdout)
            progress = json.loads((issues_dir / f"{issue_id}.progress.json").read_text())
            run_artifact = json.loads((runs_dir / "RUN-20260331T000000-ISSUE-001.json").read_text())
            status = git(repo_root, "status", "--short")
            head_message = git(repo_root, "log", "-1", "--pretty=%s")

        self.assertTrue(payload["shared_workspace"])
        self.assertEqual(payload["changed_files"], ["src/demo.ts"])
        self.assertEqual(progress["boundary_status"], "done")
        self.assertEqual(progress["status"], "completed")
        self.assertEqual(run_artifact["boundary_status"], "done")
        self.assertEqual(status, "")
        self.assertEqual(head_message, f"opsx({change}): accept {issue_id}")

    def test_change_scope_worktree_is_synced_after_acceptance(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            change = "demo-change"
            issue_id = "ISSUE-001"
            change_dir = repo_root / "openspec" / "changes" / change
            issues_dir = change_dir / "issues"
            runs_dir = change_dir / "runs"
            src_dir = repo_root / "src"
            issues_dir.mkdir(parents=True, exist_ok=True)
            runs_dir.mkdir(parents=True, exist_ok=True)
            src_dir.mkdir(parents=True, exist_ok=True)

            run(["git", "init"], cwd=repo_root)
            run(["git", "config", "user.name", "Test User"], cwd=repo_root)
            run(["git", "config", "user.email", "test@example.com"], cwd=repo_root)

            (repo_root / "openspec" / "issue-mode.json").parent.mkdir(parents=True, exist_ok=True)
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

            (src_dir / "demo.ts").write_text("export const demo = 1;\n")
            (issues_dir / f"{issue_id}.md").write_text(textwrap.dedent(
                f"""\
                ---
                issue_id: {issue_id}
                title: Change workspace issue
                worker_worktree: .worktree/{change}
                allowed_scope:
                  - src/demo.ts
                out_of_scope:
                  - electron/
                done_when:
                  - 完成 change workspace 收敛
                validation:
                  - pnpm lint
                  - pnpm type-check
                ---
                """
            ))
            (issues_dir / f"{issue_id}.progress.json").write_text(json.dumps(
                {
                    "change": change,
                    "issue_id": issue_id,
                    "status": "completed",
                    "boundary_status": "review_required",
                    "next_action": "coordinator_review",
                    "summary": "ready",
                    "validation": {
                        "lint": "passed",
                        "typecheck": "passed",
                    },
                    "changed_files": ["src/demo.ts"],
                    "run_id": "RUN-20260401T000000-ISSUE-001",
                    "updated_at": "2026-04-01T00:00:00+08:00",
                },
                ensure_ascii=False,
                indent=2,
            ))

            run(["git", "add", "."], cwd=repo_root)
            run(["git", "commit", "-m", "init change artifacts"], cwd=repo_root)
            run(["git", "worktree", "add", "-b", "opsx/demo-change", str(repo_root / ".worktree" / change), "HEAD"], cwd=repo_root)

            worker_src = repo_root / ".worktree" / change / "src" / "demo.ts"
            worker_src.write_text("export const demo = 2;\n")
            (repo_root / ".worktree" / change / "src" / "extra.ts").write_text("export const extra = 1;\n")

            process = run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--repo-root",
                    str(repo_root),
                    "--change",
                    change,
                    "--issue-id",
                    issue_id,
                ],
                cwd=repo_root,
            )

            payload = json.loads(process.stdout)
            worker_status = git(repo_root / ".worktree" / change, "status", "--short")
            synced_demo = worker_src.read_text()
            head_message = git(repo_root, "log", "-1", "--pretty=%s")
            worker_head = git(repo_root / ".worktree" / change, "rev-parse", "HEAD")
            repo_head = git(repo_root, "rev-parse", "HEAD")

        self.assertFalse(payload["shared_workspace"])
        self.assertEqual(payload["workspace_scope"], "change")
        self.assertEqual(worker_status, "")
        self.assertEqual(synced_demo, "export const demo = 2;\n")
        self.assertEqual(worker_head, repo_head)
        self.assertEqual(head_message, f"opsx({change}): accept {issue_id}")


if __name__ == "__main__":
    unittest.main()
