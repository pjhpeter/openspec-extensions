# OpenSpec Coordinator Playbook

Use this reference for the default issue-mode coordinator path.
Read `../issue-mode-rra.md` when the change needs explicit round targets, normalized backlog, and acceptance gates.

This is the normal flow when the runtime supports delegation and the user wants the coordinator to keep working inside the active session.

## Default Flow

1. Get the change to proposal/design-ready state, then run a spec-readiness design review for the current target mode. In this gate, the topology is 1 design author plus 2 design reviewers, and task splitting must not start before both reviewers pass. If `auto_accept_spec_readiness=true`, do not pause for human sign-off once the gate is satisfied.
2. After spec-readiness passes, run `plan-issues` to create or refresh `tasks.md` plus the issue breakdown, then review that task-splitting result before dispatching work. If `auto_accept_issue_planning=true`, do not pause for human sign-off once `tasks.md` and the issue docs are dispatch-ready.
3. Dispatch only issues that are approved for the active round.
4. By default, render the subagent-team lifecycle packet and use it as the round control packet.
5. Explicitly set `reasoning_effort` when spawning subagents:
   - design author: `xhigh`
   - any code-writing implementation or verify-fix subagent: `xhigh`
   - design reviewers, planning authors, checkers, reviewers, and closeout-only subagents: `medium`
6. For every phase, treat the launched phase seats as gate-bearing participants:
   - record agent ids, seat names, and running/completed status
   - use `default` or `worker` style delegation for those gate seats; do not use `explorer` for design-review, check, or review gates
   - if unattended progression matters, wait up to 1 hour for those gate-bearing subagents instead of short polling
   - do not advance, auto-accept, or close the phase while any required gate-bearing subagent is still running
7. For bounded implementation slices that are explicitly narrowed to one issue-only execution subagent, spawn exactly one issue-only subagent for one approved issue.
8. Pass the generated dispatch content or file to the issue execution subagent or team as the source of truth.
9. Have code-writing subagents follow `openspec-execute-issue`, including issue-local progress and run artifacts.
10. Reconcile from disk, normalize any findings into the change-level backlog, and decide whether the issue passes the round.
11. If `auto_accept_issue_review=true` and the issue-local validation passed, accept/merge/commit it immediately from the coordinator session. Otherwise review it manually in the coordinator session first.
12. After all approved issues are completed, run a change-level `/review` against the current change diff and write `runs/CHANGE-REVIEW.json`.
13. Only after that review passes, run the change-level acceptance decision and then `verify` / `archive`.

## Rules

- one issue-scoped execution context handles one issue only
- use subagent-team rounds as the default issue-mode coordinator topology
- do not let subagents inherit the session-wide reasoning default blindly; set role-based `reasoning_effort` explicitly
- `auto_accept_*` only removes human sign-off after gate-bearing subagents have all finished and their verdicts are in hand
- do not pass a gate while any required reviewer/checker for that gate is still running
- do not close unfinished gate-bearing subagents early
- gate-bearing review/check subagents must not be treated as `explorer` sidecars
- fall back to the single-issue execution path only when the user explicitly narrows execution to one issue-only subagent or the current step is already a bounded single-issue handoff
- keep a change-level normalized backlog and round verdict for complex changes
- do not let issue execution subagents update `tasks.md`
- do not let issue execution subagents self-merge or create the final git commit
- prefer artifact-based reconcile over chat memory
- do not dispatch new issue work while `Must fix now` items from the current planning or acceptance round are still open
- do not move from "all issues completed" to `verify` or `archive` without both a passed change-level `/review` and a change-level acceptance decision
- even in unattended mode, coordinator-owned merge/commit boundaries remain in the coordinator session
