# OpenSpec Coordinator Playbook

Use this reference for the default issue-mode coordinator path.

This is the normal flow when the runtime supports delegation and the user wants the coordinator to keep working inside the active session.

## Default Flow

1. Run `dispatch-issue` to create or reuse the issue worktree and render the dispatch from disk.
2. Spawn exactly one worker subagent for that issue.
3. Pass the generated dispatch content or file to that subagent as the source of truth.
4. Have the subagent follow `openspec-execute-issue`, including issue-local progress and run artifacts.
5. Reconcile from disk before deciding the next step.
6. If the issue is `review_required`, review it in the coordinator session, then merge and commit it from the coordinator session.
7. Repeat for the next issue, then keep `verify` and `archive` in the coordinator session.

## Rules

- one worker context handles one issue only
- do not let workers update `tasks.md`
- do not let workers self-merge or create the final git commit
- prefer artifact-based reconcile over chat memory
- use detached/background automation only when the user explicitly wants work to continue outside the active parent session or needs proactive notifications

## Practical Checks

- before dispatch: issue doc exists and scope is explicit
- before reconcile: read `issues/*.progress.json` first
- before merge: coordinator worktree is clean enough for the review/merge step
- before verify/archive: all issue-level work is already accepted by the coordinator
