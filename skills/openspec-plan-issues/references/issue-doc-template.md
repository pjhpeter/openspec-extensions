# Issue Doc Template

Use this template for `openspec/changes/<change>/issues/ISSUE-001.md`.
If the repository has `openspec/issue-mode.json`, fill `worker_worktree` and `validation` from that file.
If it does not, the default example becomes `.worktree/<change-name>/ISSUE-001` plus `pnpm lint` and `pnpm type-check`.

```md
---
issue_id: ISSUE-001
title: 用一句话描述这个 issue
worker_worktree: <repo issue worktree path>
allowed_scope:
  - src/example/path.ts
out_of_scope:
  - electron/
done_when:
  - 验收条件 1
  - 验收条件 2
validation:
  - <repo validation command 1>
  - <repo validation command 2>
depends_on:
  - none
---

# ISSUE-001 - 用一句话描述这个 issue

## Goal

说明这个 issue 的目标。

## Context

只保留 issue 执行 subagent 真正需要知道的上下文。

## Implementation Notes

- 现有模块
- 复用点
- 风险或边界

## Issue Execution Prompt

继续 OpenSpec change `<change-name>`，执行单个 issue。

- Issue: `ISSUE-001`
- Issue worktree (`worker_worktree`):
  - `<repo issue worktree path>`
- Allowed scope:
  - `src/example/path.ts`
- Out of scope:
  - `electron/`
- Done when:
  - 验收条件 1
- Validation:
  - `<repo validation command 1>`
  - `<repo validation command 2>`
```

Notes:

- Keep the frontmatter machine-readable.
- Keep the body concise.
- Prefer the dominant working language of the repository.
