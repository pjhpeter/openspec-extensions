---
name: openspec-reconcile-change
description: Reconcile issue progress artifacts for an OpenSpec change and decide the coordinator's next step. Use when the user asks to sync issue progress, collect issue state, continue a change after issue execution contexts, or advance the workflow based on `issues/*.progress.json` and `runs/*.json`.
---

# OpenSpec Reconcile Change

Use this skill in the coordinator session.

## Session Startup Update Check

- 如果这是当前主会话首次触发任一 `openspec-extensions` skill，先做一次非阻塞版本检查，再继续 reconcile。
- 如果仓库里有 `openspec/openspec-extensions.json`，先读取其中的 `installed_version` 作为仓库记录版本。
- 版本检查优先比较 npm 最新版本与仓库记录版本；如果仓库元数据缺失，再退回比较当前已安装 CLI 版本。
- 版本检查只做 best-effort；检查失败时直接跳过，不要阻塞当前收敛流程。
- 如果发现 npm 有更新版本，只打印一条高亮提醒，然后继续执行，不要把升级当成当前 reconcile 的 blocker。
- 高亮提醒统一使用这句：
  - `【更新提醒】检测到 openspec-extensions 有新版本。可先退出到命令行执行 \`npm update -g openspec-extensions\` 更新 openspec-extensions，再执行 \`openspec-ex install --target-repo /path/to/your/project --force --force-config\` 刷新当前仓库插件；当前流程继续，不受这条提醒影响。`

Read `issue-mode-contract.md` and `issue-mode-rra.md` first.
Use `router/coordinator-playbook.md` for the default coordinator flow.

## Workflow

1. Resolve the change name.
2. Run the bundled helper:
   ```bash
   openspec-extensions reconcile change \
     --repo-root . \
     --change "<change-name>"
   ```
3. If the result is `commit_planning_docs`, run the planning-doc commit helper immediately:
   ```bash
   openspec-extensions reconcile commit-planning-docs \
     --repo-root . \
     --change "<change-name>"
   ```
   Add `--dry-run` to preview the commit boundary first, or `--commit-message "..."` to override the default planning-doc commit message.
4. If the result is `coordinator_review` and you are accepting the issue, or the result is `auto_accept_issue`, run the coordinator merge helper immediately:
   ```bash
   openspec-extensions reconcile merge-issue \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
   Add `--dry-run` to preview the merge inputs first, or `--commit-message "..."` to override the default acceptance commit message.
5. Read `tasks.md`, `control/BACKLOG.md`, the latest `control/ROUND-*.md` when present, plus the `issues/ISSUE-*.md` and `issues/*.progress.json` flagged by the helper. Read `runs/*.json` only when the helper summary is insufficient.
6. Normalize new findings into the active change-level backlog instead of leaving them only in chat.
7. Update coordinator-owned files only, such as `tasks.md`, change-level summaries, and control artifacts.
8. Follow the helper result:
   - `resolve_blocker` -> stop and surface blocker
   - `review_change_code` -> run change-level code review now:
     ```bash
     openspec-extensions review change \
       --repo-root . \
       --change "<change-name>"
     ```
     then rerun reconcile immediately
   - `resolve_change_review_failure` -> inspect `runs/CHANGE-REVIEW.json`, fix the blocking review findings, then rerun reconcile before verify
   - `resolve_verify_failure` -> inspect the verify artifact and fix the failing validation or unchecked tasks
   - `commit_planning_docs` -> commit `proposal.md` / `design.md` / `tasks.md` / `issues/INDEX.md` / `ISSUE-*.md` immediately, then rerun reconcile and keep advancing without waiting for user confirmation
   - `auto_accept_issue` -> run `openspec-extensions reconcile merge-issue` immediately, then rerun reconcile and keep advancing without waiting for user confirmation
   - `complete_issue_review_gate` -> current issue is still missing the team check/review gate artifact; normalize checker/reviewer verdicts into `runs/ISSUE-REVIEW-<issue>.json`, then rerun reconcile
   - `coordinator_review` -> review the issue, then either accept it with `openspec-extensions reconcile merge-issue` or create `Must fix now` backlog items and send it back to repair
   - `resolve_issue_review_failure` -> current issue's team review gate failed; repair first, then refresh `runs/ISSUE-REVIEW-<issue>.json`
   - `await_planning_docs_commit_confirmation` -> semi-auto pause before the coordinator-owned planning-doc commit that must happen before the first issue dispatch
   - `await_issue_dispatch_confirmation` -> semi-auto pause before the first issue dispatch after issue planning
   - `dispatch_next_issue` -> prepare the next approved issue and, in the default path, continue through subagent-team; this is not a terminal checkpoint
   - `await_next_issue_confirmation` -> semi-auto pause before dispatching the next pending issue
   - `verify_change` -> run change-level verify now
   - `await_verify_confirmation` -> semi-auto pause before running verify
   - `archive_change` -> verify has passed and config allows immediate archive
   - `ready_for_archive` -> verify has passed, but archive still expects manual confirmation
   - `wait_for_active_issue` -> do not force progress

## Rules

- Do not treat issue-execution chat output as the source of truth when artifacts exist; prefer issue progress artifacts over run artifacts.
- Only treat control-plane artifacts under `openspec/changes/<change>/...` as issue-mode workflow state; do not reinterpret unrelated repo-root helper files such as `task_plan.md`, `findings.md`, or `progress.md` as control-plane corruption, workflow noise, or a reason to pause reconcile.
- Do not let issue execution subagents update `tasks.md`, self-merge, or create the final git commit for an issue.
- Use issue docs to discover pending work that has not started yet.
- `openspec-extensions reconcile merge-issue` expects a clean coordinator worktree only when the issue uses an isolated worker worktree; shared workspace mode commits the current repo-root issue diff directly.
- When multiple issues in the same change share one change-level worktree, `openspec-extensions reconcile merge-issue` should resync that worktree to the latest accepted commit before the next issue starts.
- If artifacts are stale or suspicious, inspect the issue workspace and run artifacts directly before redispatching.
- In subagent-first flows, prefer artifact-based reconcile and coordinator review over any process-liveness heuristics.
- For complex changes, keep the active normalized backlog and round verdict on disk instead of in chat only.
- Do not dispatch, verify, or archive while unresolved `Must fix now` items remain in the active change-level backlog.
- If the helper finds no issue artifacts, fall back to normal OpenSpec routing.
- Read `continuation_policy` from the helper output before deciding whether a pause is intentional.
- Before the first issue dispatch, the coordinator must create a dedicated planning-doc commit for `proposal.md` / `design.md` / `tasks.md` / `issues/INDEX.md` / `ISSUE-*.md`.
- If `continuation_policy.mode=continue_immediately`, do not stop at `control-plane ready`, `checkpoint`, or a chat summary; continue the action now.
- The same rule applies after an external disconnect or a fresh reconnect: rerun reconcile from disk, then honor `continuation_policy` instead of treating the resumed chat as a new manual checkpoint.
- If `commit_planning_docs` is emitted, do not skip straight to issue execution; commit the planning docs first, rerun reconcile, and only then honor `dispatch_next_issue`.
- If `automation_profile=full_auto` and the helper emits `dispatch_next_issue`, do not stop to ask the user; render the next team dispatch or continue the subagent-team loop immediately.
- If `auto_accept_issue_review=true` and the helper emits `auto_accept_issue`, do not stop to ask the user; merge/commit the issue immediately and continue.
- If the current issue came from `ISSUE-*.team.dispatch.md`, do not accept/merge it until `runs/ISSUE-REVIEW-<issue>.json` exists, is current, and passed.
- `dispatch_next_issue` means the first approved issue after the planning-doc commit, or the next pending issue after an accepted issue, should be dispatched immediately; it must not be reframed as a terminal control-plane checkpoint.
- If coordinator review accepts an issue, merge and commit it before dispatching the next dependent issue or moving to `verify`.
- Do not move from "all issues completed" to `verify` until `runs/CHANGE-REVIEW.json` exists, is current, and has `status=passed`.
- Read `automation_profile`, `automation`, and `continuation_policy` from the helper output before deciding whether a pause is intentional or indicates a stuck flow.

## Output Style

Keep the coordinator summary decision-oriented:

```text
已收敛 `<change-name>` 的 issue 状态。

- ISSUE-001: completed, review_required
- ISSUE-002: pending
- Must fix now: none
- 下一步: 为 ISSUE-002 渲染 team dispatch，并继续 subagent-team 执行
```
