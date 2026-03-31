# OpenSpec Issue Mode Contract

Use this contract whenever a change is executed by a coordinator plus issue-scoped worker contexts.
In the default path, the coordinator enters through subagent-team orchestration, and any issue-scoped workers stay bounded to one issue and one issue workspace.

Read `issue-mode-rra.md` as the change-level control-plane reference.

## Repo Defaults

Projects may define reusable defaults in:

```text
openspec/issue-mode.json
```

Use it for:

- worker workspace default
- default validation commands
- optional worker git worktree creation mode
- change-level RRA gate mode
- subagent-team auto-accept switches

Issue docs should still materialize `worker_worktree` and `validation` when possible.
Helper scripts may fall back to the repo config when those fields are missing.

## Ownership

- Coordinator owns:
  - `tasks.md`
  - change-level backlog and round reports
  - change-level progress summaries
  - review of completed issues
  - accepting completed issue changes back into the coordinator branch
  - the git commit created during acceptance
  - `verify`
  - `archive`
- Worker owns:
  - one issue only
  - one assigned issue workspace only
  - issue-local progress artifact
  - run artifact for that worker context

Workers must not directly update `tasks.md`.
Workers must not self-merge or create the final git commit for the issue.

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
    ├── CHANGE-REVIEW.json
    ├── RUN-20260325T103000-ISSUE-001.json
    └── RUN-20260325T111500-ISSUE-002.json
```

If isolated worktree mode is enabled, worker worktrees should normally live under the project root:

```text
<repo-root>/.worktree/<change-name>/<issue-id>/
```

If shared workspace mode is enabled, `worker_worktree` materializes as `.` and the issue executes directly in the repo root.

## Coordinator Reconcile Rules

1. Read all `issues/*.progress.json` first.
2. Read `control/BACKLOG.md` and the latest `control/ROUND-*.md` when they exist.
3. Read `issues/ISSUE-*.md` to discover pending issues that have not started yet.
4. Use `runs/*.json` only as supporting evidence, not as the source of truth.
5. Update `tasks.md` only after reconciling issue state from disk.
6. Default decisions:
   - unresolved `Must fix now` items in the active control backlog -> stop and resolve them before dispatch, verify, or archive
   - any `blocked` -> stop and resolve blocker
   - any `review_required` -> if `subagent_team.auto_accept_issue_review=true` and issue-local validation passed, accept/commit it automatically; otherwise review it in the coordinator session first
   - after an issue is accepted, its code should already be captured in exactly one coordinator-owned commit before the next issue dispatch or change-level verify
   - any issue doc without progress -> dispatch that next issue
   - all issues `completed` -> run a change-level acceptance round plus a change-level `/review` before moving to `verify`
   - if the latest verify artifact is current and passed -> move to `ready_for_archive`
   - if the latest verify artifact is current and failed -> stop and resolve verify failure

## Gate-Bearing Subagent Barrier

- In subagent-team flow, launched design-review, check, and review seats are gate-bearing participants for the current phase.
- The coordinator must record seat ownership, agent ids, and running/completed status for those gate-bearing subagents.
- `auto_accept_*` only skips human chat confirmation after the required gate-bearing subagents have all completed and their verdicts have been normalized.
- When reconcile emits `dispatch_next_issue`, the coordinator must continue immediately; this is not a terminal checkpoint and must not be rewritten as "control-plane ready, waiting for instruction".
- A phase must not pass while any required gate-bearing subagent for that phase is still running.
- Gate-bearing subagents must not be closed early before their completion state and verdict are collected.
- Gate-bearing design-review / check / review seats must not be treated as `explorer` sidecars.
- For unattended progression, prefer up to 1 hour blocking waits for gate-bearing subagents instead of short polling.

## Worker Rules

1. Read change artifacts and the assigned issue boundary.
2. Write or refresh the issue progress artifact at task start.
3. Implement only the assigned issue inside the assigned worker workspace.
4. Run required validation.
5. Update the issue progress artifact and run artifact before stopping.
6. Do not self-accept or create the final git commit.
7. Report the artifact paths back to the coordinator.

## `ISSUE-*.md` Frontmatter

Each issue doc should have machine-readable frontmatter:

```md
---
issue_id: ISSUE-001
title: 用一句话描述 issue
worker_worktree: .
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
`worker_worktree: .` means shared workspace mode. Explicit `.worktree/<change>/<issue>` means isolated worktree mode.

## Practical Rule

Chat text is not the workflow state.
Issue progress files are the execution state.
Control backlog and round reports are the acceptance state.
Team dispatch artifacts are the coordinator handoff state for the default subagent-team rounds in issue mode.
In issue mode, accepted code lands through coordinator review plus coordinator-owned acceptance commit, not through worker self-management.
Before verify, the coordinator must also write a current `runs/CHANGE-REVIEW.json` artifact from a change-level `/review` of the current change diff.
When `subagent_team.auto_accept_*` is enabled, the gate is still coordinator-owned; it simply no longer waits for human chat confirmation before the coordinator accepts it.
It still requires the gate-bearing subagents for that phase to finish, and it does not authorize early phase completion or early subagent closure.
