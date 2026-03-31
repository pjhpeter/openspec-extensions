# OpenSpec Coordinator Playbook

Use this reference for the default issue-mode coordinator path.
Read `../issue-mode-rra.md` when the change needs explicit round targets, normalized backlog, and acceptance gates.

This is the normal flow when the runtime supports delegation and the user wants the coordinator to keep working inside the active session.

## Default Flow

1. Get the change to proposal/design-ready state, then run a spec-readiness design review for the current target mode. In this gate, the topology is 1 design author plus 2 design reviewers, and task splitting must not start before both reviewers pass. If `auto_accept_spec_readiness=true`, do not pause for human sign-off once the gate is satisfied.
2. After spec-readiness passes, run `plan-issues` to create or refresh `tasks.md` plus the issue breakdown, then review that task-splitting result before dispatching work. If `auto_accept_issue_planning=true`, do not pause for human sign-off once `tasks.md` and the issue docs are dispatch-ready, and do not stop at a "control-plane ready" summary; immediately dispatch the first approved issue.
3. Dispatch only issues that are approved for the active round.
4. By default, render the subagent-team lifecycle packet and use it as the round control packet.
5. Explicitly set `reasoning_effort` when spawning subagents:
   - design author: `xhigh`
   - any code-writing implementation or verify-fix subagent: `xhigh`
   - design reviewers, planning authors, checkers, reviewers, and closeout-only subagents: `medium`
6. Default to the lighter fast path before escalating more seats:
   - issue planning: `2 development + 1 check + 1 review`
   - issue execution: `3 development + 2 check + 1 review`
   - change acceptance: `1 development + 1 check + 1 review`
   - change verify: `2 development + 1 check + 1 review`
   - only expand check/review seats when the current round surfaces cross-boundary architecture risk or unresolved evidence gaps
7. For every phase, treat the launched phase seats as gate-bearing participants:
   - record agent ids, seat names, and running/completed status
   - use `default` or `worker` style delegation for those gate seats; do not use `explorer` for design-review, check, or review gates
   - if unattended progression matters, wait up to 1 hour for those gate-bearing subagents instead of short polling
   - do not advance, auto-accept, or close the phase while any required gate-bearing subagent is still running
8. Checker/reviewer should start from `changed_files` in the issue progress artifact when available; otherwise start from `allowed_scope`, issue validation, and the approved round target.
9. Only expand checker/reviewer reading to direct dependencies or direct call chains when needed to prove a blocker or regression risk; do not default to repo-wide scanning or generated/vendor folders such as `node_modules`, `dist`, `build`, `.next`, or `coverage`.
10. For bounded implementation slices that are explicitly narrowed to one issue-only execution subagent, spawn exactly one issue-only subagent for one approved issue.
11. Pass the generated dispatch content or file to the issue execution subagent or team as the source of truth.
12. Have code-writing subagents follow `openspec-execute-issue`, including issue-local progress and run artifacts.
13. Reconcile from disk, normalize any findings into the change-level backlog, and decide whether the issue passes the round.
14. If `auto_accept_issue_review=true` and the issue-local validation passed, accept/merge/commit it immediately from the coordinator session. The shipped default turns this on so each validated issue lands as its own coordinator commit before the next issue starts. Otherwise review it manually in the coordinator session first.
15. After all approved issues are completed, run a change-level `/review` against the current change diff and write `runs/CHANGE-REVIEW.json`.
16. Only after that review passes, run the change-level acceptance decision and then `verify` / `archive`.

## Rules

- one issue-scoped execution context handles one issue only
- use subagent-team rounds as the default issue-mode coordinator topology
- do not let subagents inherit the session-wide reasoning default blindly; set role-based `reasoning_effort` explicitly
- `auto_accept_*` only removes human sign-off after gate-bearing subagents have all finished and their verdicts are in hand
- if reconcile emits `dispatch_next_issue`, the next approved issue should be rendered and dispatched immediately; this is not a terminal checkpoint
- do not pass a gate while any required reviewer/checker for that gate is still running
- do not close unfinished gate-bearing subagents early
- gate-bearing review/check subagents must not be treated as `explorer` sidecars
- checker/reviewer should be scope-first and diff-first; start from `changed_files` or `allowed_scope`, then expand only to direct dependencies when needed
- do not let issue rounds turn into repo-wide review sweeps by default
- do not let issue-round checker/reviewer read `node_modules`, `dist`, `build`, `.next`, `coverage`, or other generated/vendor trees unless the issue explicitly scopes them in
- fall back to the single-issue execution path only when the user explicitly narrows execution to one issue-only subagent or the current step is already a bounded single-issue handoff
- keep a change-level normalized backlog and round verdict for complex changes
- do not let issue execution subagents update `tasks.md`
- do not let issue execution subagents self-merge or create the final git commit
- prefer artifact-based reconcile over chat memory
- do not dispatch new issue work while `Must fix now` items from the current planning or acceptance round are still open
- do not move from "all issues completed" to `verify` or `archive` without both a passed change-level `/review` and a change-level acceptance decision
- even in unattended mode, coordinator-owned merge/commit boundaries remain in the coordinator session
