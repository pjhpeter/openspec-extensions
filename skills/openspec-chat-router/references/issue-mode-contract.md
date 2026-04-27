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
  - the planning-doc commit that snapshots `proposal.md` / `design.md` / `tasks.md` / `issues/INDEX.md` / `ISSUE-*.md` before the first issue dispatch
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

## Subagent Role Iron Laws

- Seat-local handoff beats inherited context. If the current subagent receives an explicit seat, scope, or ownership handoff, that handoff overrides inherited router defaults, coordinator habits, and generic workflow prompts.
- Only the coordinator owns control-plane actions:
  - render or refresh lifecycle / issue-team dispatch packets
  - define round scope, backlog, and continuation decisions
  - launch, replace, or close gate-bearing seats
  - reconcile disk state and decide whether a phase passes
  - merge, commit, verify, archive, and change-level review
  - use the "runtime cannot delegate, so continue serially" fallback
- A seat subagent must not self-promote into coordinator. If a seat was already launched successfully, it must not start coordinating sibling seats, running later phases, or applying coordinator-only fallback rules to itself.
- If a seat lacks required context or hits a runtime/result-return blocker, it must report the blocker and stop. It must not invent a new topology, spawn replacement workers on its own, or silently widen scope.
- Design-author, design-review, planning, check, and review seats are verdict producers for their current phase only. They must not continue into issue execution, issue acceptance, verify, or archive.
- Team-dispatch development seats are implementation-only seats:
  - write code only inside the assigned issue workspace and allowed scope
  - update issue progress / changed-files / pending-validation handoff
  - do not spawn or coordinate other development, check, repair, or review seats
  - do not claim validation or review passed
  - do not mark the issue `completed + review_required`
- Explicit issue-only execution subagents may run the bounded issue flow end to end inside their assigned issue workspace, but they still must not self-merge, create the final coordinator commit, or continue into change-level review / verify / archive.
- Checker and reviewer seats are scope-first readers:
  - start from `changed_files`, `allowed_scope`, issue validation, and approved round target
  - only expand to direct dependencies when needed to prove a blocker
  - do not default to repo-wide review sweeps

## Directory Layout

For change `<change-name>`:

```text
openspec/changes/<change-name>/
├── control/
│   ├── BACKLOG.md
│   ├── ROUTE-DECISION.json
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
    ├── ISSUE-REVIEW-ISSUE-001.json
    ├── SPEC-READINESS.json
    ├── ISSUE-PLANNING.json
    ├── CHANGE-REVIEW.json
    ├── RUN-20260325T103000-ISSUE-001.json
    └── RUN-20260325T111500-ISSUE-002.json
```

If isolated worktree mode is enabled, worker worktrees should normally live under the project root:

```text
shared scope: <repo-root>/
change scope: <repo-root>/.worktree/<change-name>/
issue scope: <repo-root>/.worktree/<change-name>/<issue-id>/
```

The installed template defaults to change scope, so serial issues in one change normally reuse `.worktree/<change-name>/`.
If repo config is missing, compatibility fallback remains shared workspace mode and `worker_worktree` materializes as `.`.

## Coordinator Reconcile Rules

1. Read all `issues/*.progress.json` first.
2. Read `control/ROUTE-DECISION.json`, `control/BACKLOG.md`, and the latest `control/ROUND-*.md` when they exist.
3. Read `issues/ISSUE-*.md` to discover pending issues that have not started yet.
4. Use `runs/*.json` only as supporting evidence, not as the source of truth.
5. Update `tasks.md` only after reconciling issue state from disk.
6. Default decisions:
   - unresolved `Must fix now` items in the active control backlog -> stop and resolve them before dispatch, verify, or archive
   - any `blocked` -> stop and resolve blocker
   - any `review_required` -> if `subagent_team.auto_accept_issue_review=true`, issue-local validation passed, and the team-dispatch issue review gate (when required) also passed, accept/commit it automatically; otherwise review it in the coordinator session first
   - after an issue is accepted, its code should already be captured in exactly one coordinator-owned commit before the next issue dispatch or change-level verify
   - if the accepted issue used a reusable change worktree, sync that worktree to the latest accepted commit before dispatching the next issue
   - if the first issue has not started yet and planning docs are still dirty in git -> create the coordinator-owned planning-doc commit first
   - any issue doc without progress -> dispatch that next issue only after the planning-doc commit already exists
   - all issues `completed` -> run a change-level acceptance round plus a change-level `/review` before moving to `verify`
   - if the latest verify artifact is current and passed -> move to `ready_for_archive`
   - if the latest verify artifact is current and failed -> stop and resolve verify failure

## Gate-Bearing Subagent Barrier

- In subagent-team flow, launched design-review, check, and review seats are gate-bearing participants for the current phase.
- The coordinator must record seat ownership, agent ids, and running/completed status for those gate-bearing subagents.
- `spec_readiness` only passes after the coordinator has normalized the current gate verdicts into `runs/SPEC-READINESS.json`.
- `issue_planning` only passes after the coordinator has normalized the current gate verdicts into `runs/ISSUE-PLANNING.json`.
- When an issue is executed through `ISSUE-*.team.dispatch.md`, merge readiness also depends on a current passed `runs/ISSUE-REVIEW-<issue>.json` recorded after checker/reviewer finish.
- `auto_accept_*` only skips human chat confirmation after the required gate-bearing subagents have all completed and their verdicts have been normalized.
- When reconcile emits `dispatch_next_issue`, the coordinator must continue immediately; this is not a terminal checkpoint and must not be rewritten as "control-plane ready, waiting for instruction".
- When reconcile emits `commit_planning_docs`, the coordinator must commit the planning docs first and rerun reconcile before starting the first issue execution.
- A phase must not pass while any required gate-bearing subagent for that phase is still running.
- Gate-bearing subagents must not be closed early before their completion state and verdict are collected.
- Once a gate-bearing subagent reaches a final status and its result has been normalized into the current round output or gate artifact, the coordinator should close that finished subagent before spawning more seats.
- Gate-bearing design-review / check / review seats must not be treated as `explorer` sidecars.
- For unattended progression, prefer up to 1 hour blocking waits for gate-bearing subagents instead of short polling.
- Before unattended gate-bearing batches, check `ulimit -n` when shell access is available; if the limit is below `16384`, recover or restart the tool session with a larger open-files limit before spawning checker/reviewer seats.
- Keep concurrently active seats within the rendered topology, and close final-state seats before launching another gate batch or lifecycle phase.
- `EMFILE`, `ENFILE`, or `Too many open files` is a tool-resource blocker, not a valid gate verdict. Recover or restart the tool session, clear stale running seats, and rerun the current gate from the active dispatch; never self-certify or skip the checker/reviewer gate.

## Worker Rules

1. Read change artifacts and the assigned issue boundary.
2. Write or refresh the issue progress artifact at task start.
3. Implement only the assigned issue inside the assigned worker workspace.
4. In the explicit issue-only worker path, run required validation. In team-dispatch `issue_execution`, development seats only hand off changed files and pending validation updates; checker/reviewer plus the coordinator own the validation/review gate.
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
`validation` covers command-based checks only; automated manual verification can still be required separately for user-visible behavior.
`worker_worktree: .` means shared workspace mode.
Explicit `.worktree/<change>` means change worktree mode.
Explicit `.worktree/<change>/<issue>` means issue-isolated worktree mode.

## Practical Rule

Chat text is not the workflow state.
Complexity triage for a concrete change should be written to `control/ROUTE-DECISION.json`.
Issue progress files are the execution state.
Control backlog and round reports are the acceptance state.
Team dispatch artifacts are the coordinator handoff state for the default subagent-team rounds in issue mode.
Only issue-mode artifacts under `openspec/changes/<change>/...` count as workflow state; unrelated repo-root helper files such as `task_plan.md`, `findings.md`, or `progress.md` must not be reclassified as control-plane corruption, workflow noise, or a reason to stop auto-continuation.
In issue mode, accepted code lands through coordinator review plus coordinator-owned acceptance commit, not through worker self-management.
When a change-level worktree is reused across serial issues, that worktree must be synced to the latest accepted commit after each accepted issue so later issues inherit the already-landed code.
The first issue execution also depends on a prior coordinator-owned planning-doc commit for `proposal.md` / `design.md` / `tasks.md` / `issues/INDEX.md` / `ISSUE-*.md`.
It also depends on a current passed `runs/ISSUE-PLANNING.json`; stale or missing planning gate artifacts mean the change is still in `issue_planning`.
When the issue is running under team dispatch, development seats do not close the issue on their own and are not the validation owner; they hand off changed files plus any validation entries reset to `pending`, then the coordinator records `runs/ISSUE-REVIEW-<issue>.json` after checker/reviewer pass and marks the issue `completed + review_required`.
Before verify, the coordinator must first write a current `runs/CHANGE-REVIEW.json` artifact from a change-level `/review` of the current change diff.
After that review passes, complex flow keeps the final automated test/validation and automated manual verification at change closeout rather than repeating them for every issue. For frontend or other browser-visible changes, prefer chrome devtools MCP to drive the affected main path during that final closeout step before the change is treated as verified; only fall back to another browser tool when chrome devtools MCP is unavailable.
After successful archive of a change that used change scope, the reusable worktree should be removed as part of archive cleanup.
When `subagent_team.auto_accept_*` is enabled, the gate is still coordinator-owned; it simply no longer waits for human chat confirmation before the coordinator accepts it.
It still requires the gate-bearing subagents for that phase to finish, and it does not authorize early phase completion or early subagent closure.
After an external disconnect or fresh reconnect, the coordinator should resume from those disk artifacts, rerun reconcile, and keep following `continuation_policy` instead of inventing a new soft checkpoint from chat history alone.
