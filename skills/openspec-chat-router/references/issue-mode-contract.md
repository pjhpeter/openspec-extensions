# OpenSpec Issue Mode Contract

Use this contract whenever a change is executed by coordinator + worker sessions.

## Repo Defaults

Projects may define reusable defaults in:

```text
openspec/issue-mode.json
```

Use it for:

- worker worktree root
- default validation commands
- Codex session root for monitoring
- persistent host kind
- worker git worktree creation mode

Issue docs should still materialize `worker_worktree` and `validation` when possible.
Helper scripts may fall back to the repo config when those fields are missing.

## Ownership

- Coordinator owns:
  - `tasks.md`
  - change-level progress summaries
  - review of completed issues
  - merging accepted worker worktrees back to the coordinator branch
  - the git commit created after merge
  - `verify`
  - `archive`
- Worker owns:
  - one issue only
  - one assigned issue worktree only
  - issue-local progress artifact
  - run artifact for that issue session

Workers must not directly update `tasks.md`.
Workers must not merge their worktree back or create the final git commit for the issue.

## Directory Layout

For change `<change-name>`:

```text
openspec/changes/<change-name>/
├── tasks.md
├── issues/
│   ├── INDEX.md
│   ├── ISSUE-001.md
│   ├── ISSUE-001.dispatch.md
│   ├── ISSUE-001.progress.json
│   └── ISSUE-002.progress.json
└── runs/
    ├── RUN-20260325T103000-ISSUE-001.json
    └── RUN-20260325T111500-ISSUE-002.json
```

Worker worktrees should normally live under the project root:

```text
<repo-root>/.worktree/<change-name>/<issue-id>/
```

Example:

```text
/path/to/project/.worktree/add-canvas-node-tree-sidebar/ISSUE-001/
```

## `ISSUE-*.progress.json` Fields

Keep these fields stable:

```json
{
  "change": "add-something",
  "issue_id": "ISSUE-001",
  "status": "in_progress",
  "boundary_status": "working",
  "next_action": "continue_issue",
  "summary": "已完成 issue 的第一个实现切片。",
  "blocker": "",
  "validation": {
    "lint": "pending",
    "typecheck": "pending"
  },
  "changed_files": [
    "src/example.ts"
  ],
  "updated_at": "2026-03-25T10:30:00+08:00"
}
```

Recommended enums:

- `status`: `pending` | `in_progress` | `completed` | `blocked`
- `boundary_status`: `working` | `review_required` | `done` | `blocked`
- `next_action`: `continue_issue` | `coordinator_review` | `dispatch_next_issue` | `verify_change` | `resolve_blocker`

## `RUN-*.json` Fields

Use one run artifact per worker session:

```json
{
  "run_id": "RUN-20260325T103000-ISSUE-001",
  "change": "add-something",
  "issue_id": "ISSUE-001",
  "status": "completed",
  "boundary_status": "review_required",
  "summary": "本次 worker 会话完成 issue 边界内实现并通过校验。",
  "validation": {
    "lint": "passed",
    "typecheck": "passed"
  },
  "changed_files": [
    "src/example.ts"
  ],
  "updated_at": "2026-03-25T11:00:00+08:00"
}
```

## Worker Rules

1. Read change artifacts and the assigned issue boundary.
2. Write or refresh the issue progress artifact at task start.
3. Implement only the assigned issue inside the assigned worker worktree.
4. Run required validation.
5. Update the issue progress artifact and run artifact before stopping.
6. Do not merge the worktree or create the final git commit.
7. Report the artifact paths back to the coordinator.

## Coordinator Reconcile Rules

1. Read all `issues/*.progress.json` first.
2. Read `issues/ISSUE-*.md` to discover pending issues that have not started yet.
3. Use `runs/*.json` only as supporting evidence, not as the source of truth.
4. Update `tasks.md` only after reconciling issue state from disk.
5. Default decisions:
   - any `blocked` -> stop and resolve blocker
   - any `review_required` -> review that issue in its worker worktree first; if accepted, merge it back to the coordinator branch and create the commit before moving on
   - any issue doc without progress -> dispatch that next issue
   - all issues `completed` -> move to `verify`
   - some issues still `pending` and none blocked -> dispatch next issue

## `ISSUE-*.md` Frontmatter

Each issue doc should have machine-readable frontmatter:

```md
---
issue_id: ISSUE-001
title: 用一句话描述 issue
worker_worktree: .worktree/<change-name>/ISSUE-001
allowed_scope:
  - src/example.ts
out_of_scope:
  - electron/
done_when:
  - 条件 1
validation:
  - <repo validation command 1>
  - <repo validation command 2>
depends_on:
  - none
---
```

This is the source of truth for dispatch generation.
If `worker_worktree` or `validation` is missing, helpers fall back to `openspec/issue-mode.json`.

## Practical Rule

Chat text is not the workflow state.
Issue progress files are the workflow state.
In issue mode, accepted code lands through coordinator review plus coordinator-owned merge and commit, not through worker self-merge.
