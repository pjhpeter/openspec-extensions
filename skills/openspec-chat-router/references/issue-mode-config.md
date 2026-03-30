# OpenSpec Issue Mode Config

If a project wants issue-mode skills to be reusable without editing the skill bodies, put repo-specific defaults in:

```text
openspec/issue-mode.json
```

If this file is missing, the helpers fall back to these defaults:

```json
{
  "worktree_root": ".worktree",
  "validation_commands": ["pnpm lint", "pnpm type-check"],
  "codex_home": "~/.codex",
  "persistent_host": {
    "kind": "screen"
  },
  "worker_worktree": {
    "mode": "detach",
    "base_ref": "HEAD",
    "branch_prefix": "opsx"
  },
  "coordinator_heartbeat": {
    "interval_seconds": 60,
    "stale_seconds": 900,
    "notify_topic": "",
    "auto_dispatch_next": false,
    "auto_launch_next": false
  },
  "worker_launcher": {
    "session_prefix": "opsx-worker",
    "start_grace_seconds": 120,
    "launch_cooldown_seconds": 30,
    "max_launch_retries": 1,
    "codex_bin": "codex",
    "sandbox_mode": "danger-full-access",
    "bypass_approvals": true,
    "json_output": true
  }
}
```

Subagent-first flows usually ignore `persistent_host`, `coordinator_heartbeat`, and `worker_launcher`.
Those fields are fallback configuration for detached/background workers and proactive automation.

## Fields

- `worktree_root`: repo-relative root for worker git worktrees.
- `validation_commands`: repo-level default validation commands used when an issue doc does not override `validation`.
- `codex_home`: where monitoring should look for Codex session jsonl files.
- `persistent_host.kind`: `screen`, `tmux`, or `none`. Mainly used for detached/background workers.
- `worker_worktree.mode`: `detach` or `branch`.
- `worker_worktree.base_ref`: base ref passed to `git worktree add`.
- `worker_worktree.branch_prefix`: prefix used when `mode=branch`.
- `coordinator_heartbeat.interval_seconds`: default polling interval for proactive coordinator checks in detached/background automation mode.
- `coordinator_heartbeat.stale_seconds`: how old an active issue can be before heartbeat falls back to worker monitoring.
- `coordinator_heartbeat.notify_topic`: default ntfy topic used by the coordinator heartbeat helper.
- `coordinator_heartbeat.auto_dispatch_next`: whether heartbeat should prepare the next issue dispatch automatically.
- `coordinator_heartbeat.auto_launch_next`: whether heartbeat should keep the detached issue pipeline moving automatically; when enabled, heartbeat can launch the next worker, and by default also inherits to review acceptance and final verify unless explicitly overridden.
- `coordinator_heartbeat.auto_accept_review`: whether heartbeat should automatically accept `review_required` issues by merging the worker worktree back into the coordinator branch and creating the acceptance commit. If omitted, it inherits `auto_launch_next`.
- `coordinator_heartbeat.auto_verify_change`: whether heartbeat should automatically run change-level verify after all issues are completed. If omitted, it inherits `auto_accept_review`.
- `worker_launcher.session_prefix`: prefix for `screen` / `tmux` external worker session names.
- `worker_launcher.start_grace_seconds`: how long launcher confirmation can remain in `launching` before being considered failed.
- `worker_launcher.launch_cooldown_seconds`: cooldown window before a failed detached launch should be retried again.
- `worker_launcher.max_launch_retries`: maximum automatic relaunch attempts after the initial start.
- `worker_launcher.codex_bin`: Codex executable used by the detached worker launcher.
- `worker_launcher.sandbox_mode`: sandbox mode used when `bypass_approvals=false`.
- `worker_launcher.bypass_approvals`: whether detached worker launch uses `--dangerously-bypass-approvals-and-sandbox`.
- `worker_launcher.json_output`: whether detached worker launch adds `codex exec --json`.

## Practical Rule

Issue docs should still materialize `worker_worktree` and `validation` in frontmatter whenever possible.
The repo config is a reusable default layer, not a replacement for clear issue docs.
