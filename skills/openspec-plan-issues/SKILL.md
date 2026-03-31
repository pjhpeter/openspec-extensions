---
name: openspec-plan-issues
description: Split a design-reviewed OpenSpec change into change-level tasks plus issue-sized work packages, then create issue-scoped execution docs. Use when the user asks to “拆成 issue”, “按 issue 模式继续”, “给出每个 issue 的边界”, “生成 issue 文档”, or similar requests about coordinator-managed multi-session execution.
---

# OpenSpec Plan Issues

Use this skill in the coordinator session after the proposal/design review has passed and the coordinator is ready to do task splitting.

Read `../openspec-chat-router/references/issue-mode-contract.md`, `../openspec-chat-router/references/issue-mode-config.md`, `../openspec-chat-router/references/issue-mode-rra.md`, and `references/issue-doc-template.md` first.

## Workflow

1. Resolve the change name.
2. Read:
   - `openspec/changes/<change>/proposal.md`
   - `openspec/changes/<change>/design.md`
   - `openspec/issue-mode.json` if present
3. Decide the issue breakdown using these rules:
   - one issue should touch one bounded slice of the codebase
   - avoid mixing UI, Electron, i18n, and data/model changes unless the change is tiny
   - if a candidate issue needs a long exception list, split it again
4. Create or refresh `openspec/changes/<change>/tasks.md` so the coordinator-owned task list matches the approved design review and the planned issue boundaries.
5. Create `openspec/changes/<change>/issues/INDEX.md` with:
   - issue list
   - short goal per issue
   - dependency order if any
6. Create one `ISSUE-*.md` per issue using the template reference.
7. Record the issue-planning review result in change-level control artifacts, for example:
   - `openspec/changes/<change>/control/BACKLOG.md`
   - `openspec/changes/<change>/control/ROUND-*.md`
8. Keep each issue doc explicit enough that a fresh issue-scoped subagent or execution context can act on it without additional coordinator narration.
9. Only move to dispatch once issue-planning `Must fix now` items are resolved or explicitly deferred.

## Rules

- Coordinator owns issue planning.
- Design review by the dedicated `1` author + `2` reviewers subagent team must pass before this skill becomes the next step.
- `tasks.md` belongs to issue planning in the complex-change path; it should be created or refreshed from the approved design review before dispatching issues.
- Split the change into bounded issue-scoped execution docs that stay stable across fresh sessions.
- Prefer 2-5 issues for a normal complex change. Split further only when boundaries are still mixed.
- One issue should touch one bounded slice of the codebase.
- Avoid mixing UI, Electron, i18n, and data/model changes unless the change is tiny.
- If a candidate issue needs a long exception list, split it again.
- Do not let downstream execution subagents invent or rewrite issue boundaries ad hoc.
- Do not rewrite checked tasks in `tasks.md` unless the user explicitly asks for task remapping or the approved issue plan makes the mapping incomplete.
- Materialize `worker_worktree` and `validation` into each issue doc frontmatter, using repo defaults from `openspec/issue-mode.json` when present. Installed config defaults should normally write the same change-level path such as `worker_worktree: .worktree/<change>` into every issue of that change; shared workspace mode should write `worker_worktree: .`.
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

下一步默认会直接进入 `ISSUE-001` 的 team dispatch / subagent-team 执行。
```
