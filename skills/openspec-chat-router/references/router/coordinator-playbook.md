# OpenSpec Coordinator Playbook

Use this reference for the default issue-mode coordinator path.
Read `../issue-mode-rra.md` when the change needs explicit round targets, normalized backlog, and acceptance gates.

This is the normal flow when the runtime supports delegation and the user wants the coordinator to keep working inside the active session.

## Default Flow

1. Get the change to implementation-ready state, then run a spec-readiness review for the current target mode.
2. Run `plan-issues`, then review the issue breakdown before dispatching work.
3. Dispatch only issues that are approved for the active round.
4. When the user explicitly wants subagent team orchestration, render `ISSUE-*.team.dispatch.md` and use it as the round control packet.
5. For bounded implementation slices, spawn exactly one worker subagent for one approved issue.
6. Pass the generated dispatch content or file to the worker or team as the source of truth.
7. Have code-writing subagents follow `openspec-execute-issue`, including issue-local progress and run artifacts.
8. Reconcile from disk, normalize any findings into the change-level backlog, and decide whether the issue passes the round.
9. If the issue passes, review it in the coordinator session, then merge and commit it from the coordinator session.
10. Repeat for the next approved issue, then run a change-level acceptance round before `verify` and `archive`.

## Rules

- one worker context handles one issue only
- use explicit subagent-team rounds only when the user asks for team collaboration or the task already requires that topology
- keep a change-level normalized backlog and round verdict for complex changes
- do not let workers update `tasks.md`
- do not let workers self-merge or create the final git commit
- prefer artifact-based reconcile over chat memory
- do not dispatch new issue work while `Must fix now` items from the current planning or acceptance round are still open
- do not move from "all issues completed" to `verify` or `archive` without a change-level acceptance decision
