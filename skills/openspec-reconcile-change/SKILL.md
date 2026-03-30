---
name: openspec-reconcile-change
description: Reconcile worker-owned issue progress artifacts for an OpenSpec change and decide the coordinator's next step. Use when the user asks to sync worker progress, collect issue state, continue a change after worker contexts, or advance the workflow based on `issues/*.progress.json` and `runs/*.json`.
---

# OpenSpec Reconcile Change

Use this skill in the coordinator session.

Read `issue-mode-contract.md` and `issue-mode-rra.md` first.
Use `router/coordinator-playbook.md` for the default coordinator flow.
When artifact state looks stale or suspicious, use `../openspec-monitor-worker/SKILL.md` as fallback observability instead of guessing.

## Workflow

1. Resolve the change name.
2. Run the bundled helper:
   ```bash
   python3 .codex/skills/openspec-reconcile-change/scripts/reconcile_issue_progress.py \
     --repo-root . \
     --change "<change-name>"
   ```
3. If the result is `coordinator_review` and you are accepting the issue, run the coordinator merge helper:
   ```bash
   python3 .codex/skills/openspec-reconcile-change/scripts/coordinator_merge_issue.py \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
   Add `--dry-run` to preview the merge inputs first, or `--commit-message "..."` to override the default acceptance commit message.
4. Read `tasks.md`, `control/BACKLOG.md`, the latest `control/ROUND-*.md` when present, plus the `issues/ISSUE-*.md` and `issues/*.progress.json` flagged by the helper. Read `runs/*.json` only when the helper summary is insufficient.
5. Normalize new findings into the active change-level backlog instead of leaving them only in chat.
6. Update coordinator-owned files only, such as `tasks.md`, change-level summaries, and control artifacts.
7. Follow the helper result:
   - `resolve_blocker` -> stop and surface blocker
   - `resolve_verify_failure` -> inspect the verify artifact and fix the failing validation or unchecked tasks
   - `coordinator_review` -> review the issue, then either accept it with `coordinator_merge_issue.py` or create `Must fix now` backlog items and send it back to repair
   - `dispatch_next_issue` -> prepare the next worker issue
   - `verify_change` -> run a change-level acceptance decision first, then move to `openspec-verify-change`
   - `ready_for_archive` -> verify has passed and the change can move to archive when desired
   - `wait_for_active_issue` -> do not force progress

## Rules

- Do not treat worker chat output as the source of truth when artifacts exist; prefer issue progress artifacts over run artifacts.
- Do not let workers update `tasks.md`, self-merge, or create the final git commit for an issue.
- Use issue docs to discover pending work that has not started yet.
- `coordinator_merge_issue.py` expects the coordinator worktree to start clean before it imports the worker diff and creates the acceptance commit.
- If a worker may be stuck or dead and artifacts are stale, inspect it with `openspec-monitor-worker` before redispatching.
- In subagent-first flows, prefer artifact-based reconcile and coordinator review; detached monitoring and heartbeat are fallback paths only.
- For complex changes, keep the active normalized backlog and round verdict on disk instead of in chat only.
- Do not dispatch, verify, or archive while unresolved `Must fix now` items remain in the active change-level backlog.
- If the user explicitly wants periodic polling or proactive notifications instead of one-shot reconcile, run `.codex/skills/openspec-shared/scripts/coordinator_heartbeat.py`.
- If the helper finds no issue artifacts, fall back to normal OpenSpec routing.
- If coordinator review accepts an issue, merge and commit it before dispatching the next dependent issue or moving to `verify`.

## Output Style

Keep the coordinator summary decision-oriented:

```text
已收敛 `<change-name>` 的 issue 状态。

- ISSUE-001: completed, review_required
- ISSUE-002: pending
- Must fix now: none
- 下一步: 为 ISSUE-002 生成 worker dispatch
```
