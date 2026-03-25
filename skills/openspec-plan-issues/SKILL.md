---
name: openspec-plan-issues
description: Split an implementation-ready OpenSpec change into issue-sized work packages and create worker-facing issue documents. Use when the user asks to “拆成 issue”, “按 issue 模式继续”, “给出每个 issue 的边界”, “生成 issue 文档”, or similar requests about coordinator-managed multi-session execution.
---

# OpenSpec Plan Issues

Use this skill in the coordinator session after the change is implementation-ready.

Read these before writing issue docs:

- `../openspec-chat-router/references/issue-mode-contract.md`
- `../openspec-chat-router/references/issue-mode-config.md`
- `references/issue-doc-template.md`

## Goals

- split the change into bounded issues
- create worker-facing issue docs on disk
- keep issue boundaries stable enough for new sessions

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
6. Keep each issue doc explicit enough that a fresh worker session can execute it without additional coordinator narration.

## Rules

- Coordinator owns issue planning.
- Do not let worker sessions invent or rewrite issue boundaries ad hoc.
- Prefer 2-5 issues for a normal complex change. Split further only when boundaries are still mixed.
- Do not rewrite checked tasks in `tasks.md` unless the user explicitly asks for task remapping.
- Materialize `worker_worktree` and `validation` into each issue doc frontmatter, using repo defaults from `openspec/issue-mode.json` when present.

## Required Fields In Each Issue Doc

- `issue_id`
- `title`
- `worker_worktree`
- `allowed_scope`
- `out_of_scope`
- `done_when`
- `validation`

These should live in the issue doc frontmatter so downstream tools can generate dispatch prompts deterministically.

## Output

Keep the coordinator summary short:

```text
已为 `<change-name>` 拆出 3 个 issue。

- ISSUE-001: ...
- ISSUE-002: ...
- ISSUE-003: ...

下一步可以直接让我为 `ISSUE-001` 生成 worker dispatch。
```
