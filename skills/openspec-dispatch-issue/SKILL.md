---
name: openspec-dispatch-issue
description: Generate a worker dispatch prompt, prepare a subagent handoff, or create/reuse the worker git worktree for one OpenSpec issue. Use when the coordinator asks for “ISSUE-001 的 worker 模板”, “派发下一个 issue”, “创建 ISSUE-001 的 worker worktree”, “准备 worker 目录”, “生成新的 worker prompt”, “直接开 subagent 做 ISSUE-001”, or similar requests after issue docs already exist.
---

# OpenSpec Dispatch Issue

Use this skill in the coordinator session after issue docs have been created.

Read `issue-mode-contract.md`, `issue-mode-config.md`, and `router/coordinator-playbook.md` first.

## Workflow

1. Resolve the change and issue. If the user did not name an issue, prefer the recommended pending issue from `openspec-reconcile-change`.
2. Create or reuse the worker git worktree:
   ```bash
   python3 .codex/skills/openspec-dispatch-issue/scripts/create_worker_worktree.py \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
   If the user only wants to preview the target path without creating it yet, add `--dry-run`.
3. Render the dispatch:
   ```bash
   python3 .codex/skills/openspec-dispatch-issue/scripts/render_issue_dispatch.py \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
4. Use the generated dispatch file plus the created/reused worktree as the source of truth when sending work to a worker.
5. In runtimes with delegation, prefer handing that dispatch directly to one spawned worker subagent.
6. Keep the worker inside that issue worktree and return review, merge, and commit to the coordinator.

## Rules

- Dispatch must be generated from the issue doc on disk.
- Worker worktree defaults come from `openspec/issue-mode.json`; if it is missing, fall back to `.worktree/<change-name>/<issue-id>/`.
- Do not improvise scope boundaries from memory when an issue doc exists.
- If the issue doc is missing required frontmatter fields, fix the issue doc first.
- The coordinator owns handoff, review, merge, and final commit for the issue.
- Spawned subagents and detached workers follow the same issue boundary contract.
- Do not default to suggesting a separate worker chat or heartbeat; mention detached/background paths only when the user explicitly wants them.

## Output

Prefer a short coordinator response:

```text
已为 `ISSUE-001` 生成 worker dispatch。

- Dispatch: openspec/changes/<change>/issues/ISSUE-001.dispatch.md
- Worker worktree: .worktree/<change>/ISSUE-001
- Worktree status: created or reused
- 直接把这个 dispatch 交给一个 subagent 即可
```
