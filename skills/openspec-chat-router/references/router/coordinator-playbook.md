# OpenSpec Coordinator Playbook

Use this reference for the default issue-mode coordinator path.
Read `../issue-mode-rra.md` when the change needs explicit round targets, normalized backlog, and acceptance gates.

This is the normal flow when the runtime supports delegation and the user wants the coordinator to keep working inside the active session.

## Default Flow

1. Get the change to implementation-ready state, then run a spec-readiness review for the current target mode. If `auto_accept_spec_readiness=true`, do not pause for human sign-off once the gate is satisfied.
2. Run `plan-issues`, then review the issue breakdown before dispatching work. If `auto_accept_issue_planning=true`, do not pause for human sign-off once the issue docs are dispatch-ready.
3. Dispatch only issues that are approved for the active round.
4. By default, render the subagent-team lifecycle packet and use it as the round control packet.
5. For bounded implementation slices that are explicitly narrowed to one issue worker, spawn exactly one worker subagent for one approved issue.
6. Pass the generated dispatch content or file to the worker or team as the source of truth.
7. Have code-writing subagents follow `openspec-execute-issue`, including issue-local progress and run artifacts.
8. Reconcile from disk, normalize any findings into the change-level backlog, and decide whether the issue passes the round.
9. If `auto_accept_issue_review=true` and the issue-local validation passed, accept/merge/commit it immediately from the coordinator session. Otherwise review it manually in the coordinator session first.
10. Repeat for the next approved issue, then run a change-level acceptance round before `verify` and `archive`.

## Rules

- one worker context handles one issue only
- use subagent-team rounds as the default issue-mode coordinator topology
- fall back to the single-worker issue path only when the user explicitly narrows execution to one issue worker or the current step is already a bounded worker handoff
- keep a change-level normalized backlog and round verdict for complex changes
- do not let workers update `tasks.md`
- do not let workers self-merge or create the final git commit
- prefer artifact-based reconcile over chat memory
- do not dispatch new issue work while `Must fix now` items from the current planning or acceptance round are still open
- do not move from "all issues completed" to `verify` or `archive` without a change-level acceptance decision
- even in unattended mode, coordinator-owned merge/commit boundaries remain in the coordinator session
