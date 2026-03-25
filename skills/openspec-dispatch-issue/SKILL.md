---
name: openspec-dispatch-issue
description: Generate a worker dispatch prompt or create/reuse the worker git worktree for one OpenSpec issue. Use when the coordinator asks for “ISSUE-001 的 worker 模板”, “派发下一个 issue”, “创建 ISSUE-001 的 worker worktree”, “准备 worker 目录”, “生成新的 worker prompt”, or similar requests after issue docs already exist.
---

# OpenSpec Dispatch Issue

Use this skill in the coordinator session after issue docs have been created.

Read these first:

- `../openspec-chat-router/references/issue-mode-contract.md`
- `../openspec-chat-router/references/issue-mode-config.md`

## Workflow

1. Resolve the change name.
2. If the user named an issue, use it.
3. If not, prefer the recommended pending issue from `openspec-reconcile-change`.
4. Create or reuse the worker git worktree with the bundled helper:
   ```bash
   python3 .codex/skills/openspec-dispatch-issue/scripts/create_worker_worktree.py \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
   If the user only wants to preview the target path without creating it yet, add `--dry-run`.
5. Render the dispatch with the bundled helper:
   ```bash
   python3 .codex/skills/openspec-dispatch-issue/scripts/render_issue_dispatch.py \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
6. Use the generated dispatch file plus the created/reused worktree as the source of truth when sending work to a new worker session.

## Rules

- Dispatch must be generated from the issue doc on disk.
- Worker worktree defaults come from `openspec/issue-mode.json`.
- If the repo does not define that file, fall back to `.worktree/<change-name>/<issue-id>/`.
- Do not improvise scope boundaries from memory when an issue doc exists.
- If the issue doc is missing required frontmatter fields, fix the issue doc first.

## Output

Prefer a short coordinator response:

```text
已为 `ISSUE-001` 生成 worker dispatch。

- Dispatch: openspec/changes/<change>/issues/ISSUE-001.dispatch.md
- Worker worktree: .worktree/<change>/ISSUE-001
- Worktree status: created or reused
- 直接把这个 dispatch 发给新 worker 会话即可
```
