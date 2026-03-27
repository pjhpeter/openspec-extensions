# Worker Monitoring

Use this reference when coordinator-side artifact reconcile is not enough and you need fallback observability for a detached/background worker context.

Project-specific defaults should come from `openspec/issue-mode.json` when present.
That file defines the worker worktree root, Codex session root, validation commands, and persistent host kind.

## Standard Worker Worktree Location

By default, worker worktrees should live under the project root:

```text
<repo-root>/.worktree/<change-name>/<issue-id>/
```

If `openspec/issue-mode.json` overrides `worktree_root`, use that path instead.
Issue doc frontmatter `worker_worktree` is allowed to override the repo default for one issue.

## Four Layers

### 1. Persistent Hosting

Detached workers are commonly hosted in `screen` so they do not die with the coordinator shell.
If the repo uses `tmux` or no host wrapper, follow `persistent_host.kind` from `openspec/issue-mode.json`.

What to inspect:

- named host session still exists
- detached vs attached state when available

What it tells you:

- whether the persistence host is still registered

What it does not tell you:

- whether the worker is actually making progress

### 2. Process-Level Observation

Inspect OS processes such as:

- persistent host wrapper such as `screen` or `tmux`
- `script`
- `codex exec -C <worktree>`

What it tells you:

- whether the worker process tree is still alive
- whether the worker likely exited, is orphaned, or never started correctly

### 3. Session File Tracking

Codex writes session streams under `<codex-home>/sessions/...jsonl`.
By default, `<codex-home>` is `~/.codex`, but monitoring should prefer the repo config.

For the target worktree, locate the newest matching jsonl and inspect recent signals:

- latest agent activity
- `function_call` / `function_call_output`
- `task_complete`
- validation commands from the issue doc or repo config

What it tells you:

- which stage the worker most likely reached
- whether validation started or completed

### 4. Worktree Result Observation

Inspect the worker worktree directly:

- `git status --short`

What it tells you:

- whether code changes started
- which files changed
- whether the worker may have reached validation or stop boundaries

## Decision Rules

- host missing + no matching process + no session activity + clean worktree
  Likely never started or died early.
- host missing + no matching process + dirty worktree + session file shows coding activity
  Worker likely exited after partial work; recover from worktree and session file before redispatch.
- matching process alive + session file shows recent validation commands
  Worker is likely still running validation; do not redispatch yet.
- no process alive + issue progress artifact is current
  Prefer normal reconcile; monitoring added little.

## Important Constraint

Monitoring data is not the workflow source of truth.

Use it only when:

- progress artifacts are stale
- progress artifacts are missing
- you suspect a dead or orphaned worker
- you need to reconstruct the likely current stage before deciding whether to redispatch
