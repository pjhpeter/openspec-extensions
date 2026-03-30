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
  "worker_worktree": {
    "mode": "detach",
    "base_ref": "HEAD",
    "branch_prefix": "opsx"
  },
  "rra": {
    "gate_mode": "advisory"
  },
  "subagent_team": {
    "auto_advance_after_design_review": false
  }
}
```

## Supported Fields

- `worktree_root`: repo-relative root for issue git worktrees.
- `validation_commands`: repo-level default validation commands used when an issue doc does not override `validation`.
- `worker_worktree.mode`: `detach` or `branch`.
- `worker_worktree.base_ref`: base ref passed to `git worktree add`.
- `worker_worktree.branch_prefix`: prefix used when `mode=branch`.
- `rra.gate_mode`: `advisory` or `enforce`.
- `subagent_team.auto_advance_after_design_review`: whether lifecycle scheduling should automatically continue into issue planning after proposal/design/tasks review passes.

## Current Contract

`worktree_root`, `worker_worktree.*`, `validation_commands`, `rra.gate_mode`, and `subagent_team.*` are the active issue-mode config surface.

Legacy detached-worker keys such as:

- `codex_home`
- `persistent_host`
- `coordinator_heartbeat`
- `worker_launcher`

are no longer part of the supported contract.
If old repos still carry those keys, current helpers ignore them; remove them when you touch the config.

## Practical Rule

Issue docs should still materialize `worker_worktree` and `validation` in frontmatter whenever possible.
The repo config is a reusable default layer, not a replacement for clear issue docs.

## Recommended Future Switches

These names are recommended next-step switches for the subagent-team scheduler contract.
They are not implemented by the current parser/runtime yet:

- `subagent_team.auto_advance_after_issue_planning_review`
- `subagent_team.auto_advance_to_next_issue_after_issue_pass`
- `subagent_team.auto_run_change_verify`
- `subagent_team.auto_archive_after_verify`
