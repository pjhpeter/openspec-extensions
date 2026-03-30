---
name: openspec-plan-issues
description: Split an implementation-ready OpenSpec change into issue-sized work packages and create worker-facing issue documents. Use when the user asks to “拆成 issue”, “按 issue 模式继续”, “给出每个 issue 的边界”, “生成 issue 文档”, or similar requests about coordinator-managed multi-session execution.
---

# OpenSpec Plan Issues

Use this skill in the coordinator session after the change is implementation-ready.

Read `../openspec-chat-router/references/issue-mode-contract.md`, `../openspec-chat-router/references/issue-mode-config.md`, `../openspec-chat-router/references/issue-mode-rra.md`, and `references/issue-doc-template.md` first.

## Workflow

1. Resolve the change name.
2. Read:
   - `openspec/changes/<change>/proposal.md`
   - `openspec/changes/<change>/design.md`
   - `openspec/changes/<change>/tasks.md`
   - `openspec/issue-mode.json` if present
3. Decide the issue breakdown using these rules:
   - one issue should touch one bounded slice of the codebase
   - avoid mixing UI, Electron, i18n, and data/model changes unless the change is tiny
   - if a candidate issue needs a long exception list, split it again
4. Create `openspec/changes/<change>/issues/INDEX.md` with:
   - issue list
   - short goal per issue
   - dependency order if any
5. Create one `ISSUE-*.md` per issue using the template reference.
6. Record the issue-planning review result in change-level control artifacts, for example:
   - `openspec/changes/<change>/control/BACKLOG.md`
   - `openspec/changes/<change>/control/ROUND-*.md`
7. Keep each issue doc explicit enough that a fresh worker session can execute it without additional coordinator narration.
8. Only move to dispatch once issue-planning `Must fix now` items are resolved or explicitly deferred.

## Rules

- Coordinator owns issue planning.
- Split the change into bounded, worker-facing issue docs that stay stable across fresh sessions.
- Prefer 2-5 issues for a normal complex change. Split further only when boundaries are still mixed.
- One issue should touch one bounded slice of the codebase.
- Avoid mixing UI, Electron, i18n, and data/model changes unless the change is tiny.
- If a candidate issue needs a long exception list, split it again.
- Do not let worker sessions invent or rewrite issue boundaries ad hoc.
- Do not rewrite checked tasks in `tasks.md` unless the user explicitly asks for task remapping.
- Materialize `worker_worktree` and `validation` into each issue doc frontmatter, using repo defaults from `openspec/issue-mode.json` when present.
- Each issue doc frontmatter must include `issue_id`, `title`, `worker_worktree`, `allowed_scope`, `out_of_scope`, `done_when`, and `validation` so downstream dispatch stays deterministic.
- For complex changes, the coordinator should update change-level backlog and round artifacts after issue planning instead of leaving approval state only in chat.
- Do not dispatch issue work while issue-planning `Must fix now` items remain open.

## Output

Keep the coordinator summary short:

```text
已为 `<change-name>` 拆出 3 个 issue，并完成当前 issue-plan round 的整理。

- ISSUE-001: ...
- ISSUE-002: ...
- ISSUE-003: ...
- Must fix now: none

下一步可以直接让我为 `ISSUE-001` 生成 worker dispatch。
```
