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
6. For bounded implementation slices that are explicitly narrowed to one issue worker, spawn exactly one worker subagent for one approved issue.
7. Pass the generated dispatch content or file to the worker or team as the source of truth.
8. Have code-writing subagents follow `openspec-execute-issue`, including issue-local progress and run artifacts.
9. Reconcile from disk, normalize any findings into the change-level backlog, and decide whether the issue passes the round.
10. If `auto_accept_issue_review=true` and the issue-local validation passed, accept/merge/commit it immediately from the coordinator session. Otherwise review it manually in the coordinator session first.
11. After all approved issues are completed, run a change-level `/review` against the current change diff and write `runs/CHANGE-REVIEW.json`.
12. Only after that review passes, run the change-level acceptance decision and then `verify` / `archive`.

## Rules

- one worker context handles one issue only
- use subagent-team rounds as the default issue-mode coordinator topology
- do not let subagents inherit the session-wide reasoning default blindly; set role-based `reasoning_effort` explicitly
- fall back to the single-worker issue path only when the user explicitly narrows execution to one issue worker or the current step is already a bounded worker handoff
- keep a change-level normalized backlog and round verdict for complex changes
- do not let workers update `tasks.md`
- do not let workers self-merge or create the final git commit
- prefer artifact-based reconcile over chat memory
- do not dispatch new issue work while `Must fix now` items from the current planning or acceptance round are still open
- do not move from "all issues completed" to `verify` or `archive` without both a passed change-level `/review` and a change-level acceptance decision
- even in unattended mode, coordinator-owned merge/commit boundaries remain in the coordinator session
