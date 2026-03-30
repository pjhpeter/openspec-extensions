# OpenSpec Issue Mode Contract

Use this contract whenever a change is executed by a coordinator plus issue-scoped worker contexts.
In the default path, workers are spawned subagents bounded to one issue and one issue worktree.

Read `issue-mode-rra.md` as the change-level control-plane reference.

## Repo Defaults

Projects may define reusable defaults in:

```text
openspec/issue-mode.json
```

Use it for:

- worker worktree root
- default validation commands
- worker git worktree creation mode
- change-level RRA gate mode
- subagent-team auto-advance switches

Issue docs should still materialize `worker_worktree` and `validation` when possible.
Helper scripts may fall back to the repo config when those fields are missing.

## Ownership

- Coordinator owns:
  - `tasks.md`
  - change-level backlog and round reports
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
  - run artifact for that worker context

Workers must not directly update `tasks.md`.
Workers must not merge their worktree back or create the final git commit for the issue.

## Directory Layout

For change `<change-name>`:

```text
openspec/changes/<change-name>/
├── control/
│   ├── BACKLOG.md
│   └── ROUND-01.md
├── tasks.md
├── issues/
│   ├── INDEX.md
│   ├── ISSUE-001.md
│   ├── ISSUE-001.dispatch.md
│   ├── ISSUE-001.team.dispatch.md
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

## Coordinator Reconcile Rules

1. Read all `issues/*.progress.json` first.
2. Read `control/BACKLOG.md` and the latest `control/ROUND-*.md` when they exist.
3. Read `issues/ISSUE-*.md` to discover pending issues that have not started yet.
4. Use `runs/*.json` only as supporting evidence, not as the source of truth.
5. Update `tasks.md` only after reconciling issue state from disk.
6. Default decisions:
   - unresolved `Must fix now` items in the active control backlog -> stop and resolve them before dispatch, verify, or archive
   - any `blocked` -> stop and resolve blocker
   - any `review_required` -> review that issue in its worker worktree first; if accepted, merge it back to the coordinator branch and create the commit before moving on
   - any issue doc without progress -> dispatch that next issue
   - all issues `completed` -> run a change-level acceptance round before moving to `verify`
   - if the latest verify artifact is current and passed -> move to `ready_for_archive`
   - if the latest verify artifact is current and failed -> stop and resolve verify failure

## Worker Rules

1. Read change artifacts and the assigned issue boundary.
2. Write or refresh the issue progress artifact at task start.
3. Implement only the assigned issue inside the assigned worker worktree.
4. Run required validation.
5. Update the issue progress artifact and run artifact before stopping.
6. Do not merge the worktree or create the final git commit.
7. Report the artifact paths back to the coordinator.

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
Issue progress files are the execution state.
Control backlog and round reports are the acceptance state.
Team dispatch artifacts are the coordinator handoff state for explicit subagent-team rounds.
In issue mode, accepted code lands through coordinator review plus coordinator-owned merge and commit, not through worker self-merge.
