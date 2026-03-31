---
name: openspec-dispatch-issue
description: Generate source-of-truth dispatch artifacts for one OpenSpec issue, prepare a subagent handoff, or create/reuse the issue worktree boundary. Use when the coordinator asks for “ISSUE-001 的派发模板”, “派发下一个 issue”, “创建 ISSUE-001 的 issue worktree”, “准备 issue worktree”, “直接开 subagent 做 ISSUE-001”, or similar requests after issue docs already exist.
---

# OpenSpec Dispatch Issue

Use this skill in the coordinator session after issue docs have been created.

Read `issue-mode-contract.md`, `issue-mode-config.md`, `issue-mode-rra.md`, and `router/coordinator-playbook.md` first.

## Workflow

1. Resolve the change and issue. If the user did not name an issue, prefer the recommended pending issue from `openspec-reconcile-change`.
2. Read the latest change-level control artifacts when they exist and confirm that the issue is approved for dispatch in the current round.
3. If issue-planning or acceptance `Must fix now` items still block this dispatch, stop and fix the backlog first.
4. Create or reuse the issue worktree boundary (`worker_worktree`):
   ```bash
   python3 .codex/skills/openspec-dispatch-issue/scripts/create_worker_worktree.py \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
   If the user only wants to preview the target path without creating it yet, add `--dry-run`.
5. Render the team dispatch first for the default subagent-team path:
   ```bash
   python3 .codex/skills/openspec-dispatch-issue/scripts/render_subagent_team_dispatch.py \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
6. If the user explicitly wants one bounded issue-only handoff instead of the default subagent-team round, also render the standard issue dispatch:
   ```bash
   python3 .codex/skills/openspec-dispatch-issue/scripts/render_issue_dispatch.py \
     --repo-root . \
     --change "<change-name>" \
     --issue-id "<issue-id>"
   ```
7. Use the generated dispatch artifact plus the created/reused worktree as the source of truth when sending work to the coordinator-owned subagent team, or to one bounded issue-only subagent when the user explicitly narrowed the path.
8. In runtimes with delegation:
   - default to `ISSUE-*.team.dispatch.md` for the approved issue round
   - use `ISSUE-*.dispatch.md` only when the user explicitly narrowed execution to one issue-only subagent
9. Keep implementation inside that issue worktree and return review, merge, and commit to the coordinator.

## Rules

- Dispatch must be generated from the issue doc on disk.
- Issue worktree defaults come from `worker_worktree` in `openspec/issue-mode.json`; if it is missing, fall back to `.worktree/<change-name>/<issue-id>/`.
- Do not improvise scope boundaries from memory when an issue doc exists.
- If the issue doc is missing required frontmatter fields, fix the issue doc first.
- If the active change-level round still has unresolved `Must fix now` items that block dispatch, do not launch issue execution yet.
- Default to rendering `ISSUE-*.team.dispatch.md`; only use the single-issue dispatch when the user explicitly narrows execution.
- The coordinator owns handoff, review, merge, and final commit for the issue.
- Dispatch artifacts are for coordinator-owned subagents; `ISSUE-*.team.dispatch.md` is the default complex-change handoff.

## Output

Prefer a short coordinator response:

```text
已为 `ISSUE-001` 准备 issue dispatch。

- Team Dispatch: openspec/changes/<change>/issues/ISSUE-001.team.dispatch.md
- Dispatch: openspec/changes/<change>/issues/ISSUE-001.dispatch.md
- Issue worktree (`worker_worktree`): .worktree/<change>/ISSUE-001
- Worktree status: created or reused
- Round gate: approved for dispatch
- 默认下一步是把 team dispatch 交给 coordinator 主会话编排 subagent team
```
