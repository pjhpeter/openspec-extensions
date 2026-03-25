---
name: openspec-monitor-worker
description: Observe an OpenSpec worker session through persistent host state, OS processes, Codex session jsonl files, and worktree state. Use when the user asks things like “worker 还活着吗”, “看看 worker 做到哪一步”, “监控 worker1”, “恢复 worker 当前状态”, or similar requests about fallback observability for issue-mode workers.
---

# OpenSpec Monitor Worker

Use this skill when coordinator-side reconcile is insufficient because worker progress artifacts are stale, missing, or suspicious.

Read these before monitoring:

- `../openspec-chat-router/references/issue-mode-config.md`
- `references/worker-monitoring.md`

## Purpose

- observe whether a worker is still alive
- recover likely execution stage from session files
- inspect whether code changes or validation already started

This skill does not replace `openspec-reconcile-change`.
Artifact-based state remains the workflow source of truth.

## Inputs

Prefer these inputs when available:

- worker worktree path
- or `repo-root + change + issue-id` so the skill can derive the worktree from issue doc frontmatter or repo defaults
- optional persistent host session name
- optional worker label such as `worker1`

If the user only gives a worker label and the worktree is still obvious from recent context, infer it briefly.

## Workflow

1. Run the bundled helper:
   ```bash
   python3 .codex/skills/openspec-monitor-worker/scripts/monitor_worker.py \
     --repo-root "/abs/path/to/repo" \
     --change "<change-name>" \
     --issue-id "<issue-id>" \
     --session-name "<optional-session-name>"
   ```
   Add `--host-kind screen|tmux|none` only when the repo config needs a temporary override.
   Or pass `--worktree` directly when the path is already known.
2. Interpret the four layers:
   - `persistent_host`: screen/tmux/none host state
   - `process`: `script` / `codex exec -C <worktree>` process tree still alive or not
   - `session_file`: latest Codex jsonl for that worktree and recent signals
   - `worktree`: `git status --short` changes in the worker worktree
3. Summarize what is known, what is inferred, and whether coordinator action is needed.

## Rules

- Monitoring is fallback observability only.
- Do not infer workflow completion from process liveness alone.
- Prefer explicit artifact updates over chat or process observations when both exist.
- If the worker looks dead but the worktree and session file show partial progress, recommend reconcile or manual recovery instead of blindly redispatching.
- Prefer worker worktree paths from issue docs or `openspec/issue-mode.json` instead of ad-hoc sibling directories.

## Output

Keep the output compact:

```text
Worker 观察结果：

- persistent_host: screen active
- process: codex exec 仍在运行
- session_file: 最近看到仓库校验命令
- worktree: 已修改 3 个文件

判断：worker 仍在执行验证阶段，先不要重派。
```
