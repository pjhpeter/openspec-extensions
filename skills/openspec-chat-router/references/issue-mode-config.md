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
    "notify_topic": ""
  }
}
```

## Fields

- `worktree_root`: repo-relative root for worker git worktrees.
- `validation_commands`: repo-level default validation commands used when an issue doc does not override `validation`.
- `codex_home`: where monitoring should look for Codex session jsonl files.
- `persistent_host.kind`: `screen`, `tmux`, or `none`.
- `worker_worktree.mode`: `detach` or `branch`.
- `worker_worktree.base_ref`: base ref passed to `git worktree add`.
- `worker_worktree.branch_prefix`: prefix used when `mode=branch`.
- `coordinator_heartbeat.interval_seconds`: default polling interval for proactive coordinator checks.
- `coordinator_heartbeat.stale_seconds`: how old an active issue can be before heartbeat falls back to worker monitoring.
- `coordinator_heartbeat.notify_topic`: default ntfy topic used by the coordinator heartbeat helper.

## Practical Rule

Issue docs should still materialize `worker_worktree` and `validation` in frontmatter whenever possible.
The repo config is a reusable default layer, not a replacement for clear issue docs.
