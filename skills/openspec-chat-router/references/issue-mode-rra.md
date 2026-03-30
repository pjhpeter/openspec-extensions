# OpenSpec Issue Mode RRA Model

Use this reference when a complex OpenSpec change should be governed by a change-level review, repair, re-review, and acceptance loop instead of chat memory.

`issue-mode` and RRA solve different problems:

- `issue-mode` is the execution plane:
  - issue docs
  - worker worktrees
  - `issues/*.progress.json`
  - `runs/*.json`
  - reconcile / monitor / heartbeat
- RRA is the control plane:
  - round target
  - acceptance criteria
  - normalized backlog
  - acceptance verdict
  - next action

Together, they turn a long-running change into a bounded sequence of reviewable rounds.

## Recommended Change-Level Control Artifacts

When the change is large enough that one pass is not reliable, the coordinator should keep change-level control artifacts on disk:

```text
openspec/changes/<change-name>/control/
├── BACKLOG.md
└── ROUND-01.md
```

Recommended ownership:

- coordinator owns `control/BACKLOG.md`
- coordinator owns `control/ROUND-*.md`
- workers may reference backlog item ids in reports but do not edit the control files directly

## Suggested Round Structure

Each round report should stay compact and decision-oriented:

1. Round target
2. Target mode: `mvp` | `release` | `quality` | `custom`
3. Acceptance criteria
4. Non-goals
5. Scope in round
6. Normalized backlog
7. Fixes or revisions completed
8. Re-review result
9. Acceptance verdict
10. Next action

Recommended backlog buckets:

- Must fix now
- Should fix if cheap
- Defer

## Lifecycle Mapping

### 1. Spec Readiness Round

Before `plan-issues`, the coordinator should review `proposal.md`, `design.md`, and `tasks.md`.

Goal:

- make the change implementation-ready

Typical acceptance criteria:

- scope is clear enough to split
- constraints and non-goals are explicit
- tasks are actionable
- obvious ambiguity is removed

Pass outcome:

- proceed to `plan-issues`

Fail outcome:

- revise change docs first

### 2. Issue Planning Round

After `plan-issues`, the coordinator should review the issue breakdown before dispatch.

Goal:

- approve issue boundaries and ownership

Typical acceptance criteria:

- each issue touches one bounded slice of the codebase
- dependencies are explicit
- `allowed_scope`, `out_of_scope`, `done_when`, and `validation` are usable by a fresh worker
- no unresolved `Must fix now` items remain in the issue plan

Pass outcome:

- approved issues may be dispatched

Fail outcome:

- revise issue docs or split the change differently

### 3. Issue Execution Rounds

After a worker reports progress, the coordinator should reconcile from disk, review the changed worktree, and decide whether the round passes.

Goal:

- accept or repair the issue slice that was just attempted

Typical acceptance criteria:

- behavior matches the requested issue scope
- regression risk is acceptable for the current target mode
- validation evidence is sufficient

Pass outcome:

- accept the issue, merge it, and move to the next approved issue or the change-level acceptance round

Fail outcome:

- create a normalized repair backlog and re-dispatch the issue or create a follow-up issue if the boundary changed materially

### 4. Change Acceptance Round

After all required issues are accepted, the coordinator should run one more change-level round before `verify` and `archive`.

Goal:

- decide whether the whole change is ready for change-level verify and closeout

Typical acceptance criteria:

- requested scope is covered by accepted issues
- deferred debt is explicit
- no unresolved `Must fix now` items remain at change level
- the change is ready for `verify`

Pass outcome:

- run `verify`, then `archive` when appropriate

Fail outcome:

- reopen the backlog and return to repair or follow-up issue planning

## Coordinator Rules

- Read worker artifacts from disk before deciding the next step.
- Keep one normalized backlog for the active change-level round instead of scattering decisions across chat turns.
- Do not move from issue planning to dispatch while `Must fix now` items are still open.
- Do not move from "all issues completed" to `verify` or `archive` without a change-level acceptance decision.
- Treat detached automation as an execution convenience, not a replacement for change-level acceptance criteria.

## Worker Rules

- Execute one approved issue only.
- Stay inside the assigned issue boundary.
- If new out-of-scope problems are discovered, report them as blockers or backlog candidates for the coordinator.
- Do not silently widen the issue scope just because the worker sees adjacent problems.

## Practical Rule

Chat text is not the workflow state.

- `issues/*.progress.json` and `runs/*.json` are the execution state.
- `control/BACKLOG.md` and `control/ROUND-*.md` are the acceptance and decision state.

If the change already has control artifacts, read them before dispatch, reconcile, verify, or archive decisions.
