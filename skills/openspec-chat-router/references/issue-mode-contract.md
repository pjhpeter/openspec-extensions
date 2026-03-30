# OpenSpec Issue Mode Contract

Use this contract whenever a change is executed by coordinator + worker contexts.
The worker may be a spawned subagent or an external worker session.

Read `issue-mode-rra.md` as the change-level control-plane reference.

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

`persistent_host`, `coordinator_heartbeat`, and `worker_launcher` matter mainly for detached/background worker execution.
They are fallback infrastructure, not the default subagent-first path.

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
When subagents are available, prefer them as the default worker form factor.

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

Example:

```text
/path/to/project/.worktree/add-canvas-node-tree-sidebar/ISSUE-001/
```

## Change-Level Control Artifacts

When the change is complex enough that one pass is not reliable, keep change-level control artifacts on disk:

- `control/BACKLOG.md`
- `control/ROUND-*.md`

Use them to record:

- round target
- target mode
- acceptance criteria
- non-goals
- normalized backlog
- acceptance verdict
- next action

If these files exist, coordinator decisions about dispatch, review, verify, and archive should read them instead of relying on chat memory.

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
- `next_action`: `continue_issue` | `coordinator_review` | `dispatch_next_issue` | `verify_change` | `ready_for_archive` | `resolve_blocker` | `resolve_verify_failure`

## `RUN-*.json` Fields

Use one run artifact per worker context:

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

## Team Dispatch Artifact

When the coordinator uses explicit subagent-team orchestration, it may also render:

```text
openspec/changes/<change-name>/issues/ISSUE-001.team.dispatch.md
```

Use it as the coordinator-owned control packet for:

- round target
- target mode
- acceptance criteria
- normalized backlog handoff rules
- review / development / acceptance team topology

This artifact does not replace `ISSUE-*.progress.json`.
Execution state still comes from progress/run artifacts on disk.

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
Issue progress files are the execution state.
Control backlog and round reports are the acceptance state.
Team dispatch artifacts are the coordinator handoff state for explicit subagent-team rounds.
In issue mode, accepted code lands through coordinator review plus coordinator-owned merge and commit, not through worker self-merge.
