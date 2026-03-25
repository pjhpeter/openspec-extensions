---
name: openspec-reconcile-change
description: Reconcile worker-owned issue progress artifacts for an OpenSpec change and decide the coordinator's next step. Use when the user asks to sync worker progress, collect issue state, continue a change after worker sessions, or advance the workflow based on `issues/*.progress.json` and `runs/*.json`.
---

# OpenSpec Reconcile Change

Use this skill in the coordinator session.

Read `../openspec-chat-router/references/issue-mode-contract.md` before reconciling.
When artifact state looks stale or suspicious, use `../openspec-monitor-worker/SKILL.md` as a fallback observability layer instead of guessing.

## Goals

- rebuild coordinator state from disk
- avoid relying on chat memory
- decide the next safe workflow action

## Workflow

1. Resolve the change name.
2. Run the bundled helper:
   ```bash
   python3 .codex/skills/openspec-reconcile-change/scripts/reconcile_issue_progress.py \
     --repo-root . \
     --change "<change-name>"
   ```
3. Read:
   - `openspec/changes/<change>/tasks.md`
   - any `issues/ISSUE-*.md` and `issues/*.progress.json` flagged by the helper
   - supporting `runs/*.json` only when the helper summary is insufficient
4. Update coordinator-owned files only:
   - `tasks.md`
   - change-level summaries if this workflow uses them
5. Choose the next action using the helper result:
   - `resolve_blocker` -> stop and surface blocker
   - `coordinator_review` -> review or acknowledge the completed issue
   - `dispatch_next_issue` -> prepare the next worker issue
   - `verify_change` -> move to `openspec-verify-change`
   - `wait_for_active_issue` -> do not force progress

## Rules

- Do not treat worker chat output as the source of truth when artifacts exist.
- Do not let workers update `tasks.md`.
- Prefer issue progress artifacts over run artifacts.
- Use issue docs to discover pending work that has not started yet.
- If a worker may be stuck or dead and artifacts are stale, inspect it with `openspec-monitor-worker` before redispatching.
- If the helper finds no issue artifacts, fall back to normal OpenSpec routing.

## Output Style

Keep the coordinator summary decision-oriented:

```text
已收敛 `<change-name>` 的 issue 状态。

- ISSUE-001: completed, review_required
- ISSUE-002: pending
- 下一步: 为 ISSUE-002 生成 worker dispatch
```
