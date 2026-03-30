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
    "auto_advance_after_design_review": false,
    "auto_advance_after_issue_planning_review": false,
    "auto_advance_to_next_issue_after_issue_pass": false,
    "auto_run_change_verify": false,
    "auto_archive_after_verify": false
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
- `subagent_team.auto_advance_after_design_review`: continue from spec-readiness into issue planning automatically after proposal/design/tasks review passes.
- `subagent_team.auto_advance_after_issue_planning_review`: dispatch the first approved issue automatically after issue planning review passes.
- `subagent_team.auto_advance_to_next_issue_after_issue_pass`: dispatch the next pending issue automatically after the current issue passes review.
- `subagent_team.auto_run_change_verify`: continue from change acceptance into change-level verify automatically.
- `subagent_team.auto_archive_after_verify`: continue from a passed verify result into archive automatically.

## Current Contract

`worktree_root`, `worker_worktree.*`, `validation_commands`, `rra.gate_mode`, and `subagent_team.*` are the active issue-mode config surface.

## Practical Rule

Issue docs should still materialize `worker_worktree` and `validation` in frontmatter whenever possible.
The repo config is a reusable default layer, not a replacement for clear issue docs.

`worker_worktree` is part of the intended steady-state contract. It is kept as the issue-isolation and coordinator-merge boundary for the subagent-team flow.

## Automation Profiles

The runtime derives a profile from `rra.gate_mode` plus the five `subagent_team.*` switches:

- `semi_auto`: `rra.gate_mode=advisory` and all five `subagent_team` switches are `false`
- `full_auto`: `rra.gate_mode=enforce` and all five `subagent_team` switches are `true`
- `custom`: any mixed combination

`rra.gate_mode` still matters in both modes:

- `advisory` keeps round gates visible without hard-blocking progression
- `enforce` turns those gates into hard constraints so unattended flow still stays inside the round contract

## Example Profiles

### Semi-Automatic

Use this when a human should still inspect design review, issue planning, verify, and archive checkpoints.

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
    "auto_advance_after_design_review": false,
    "auto_advance_after_issue_planning_review": false,
    "auto_advance_to_next_issue_after_issue_pass": false,
    "auto_run_change_verify": false,
    "auto_archive_after_verify": false
  }
}
```

Behavior:

- design review pass pauses before issue planning
- issue-planning review pass pauses before first dispatch
- issue pass pauses before dispatching the next issue
- change acceptance pauses before verify
- verify pass pauses before archive
- RRA keeps emitting guidance, but does not hard-block progression

### Full-Automatic

Use this when subagent-team should own the full lifecycle, not just issue execution.

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
    "gate_mode": "enforce"
  },
  "subagent_team": {
    "auto_advance_after_design_review": true,
    "auto_advance_after_issue_planning_review": true,
    "auto_advance_to_next_issue_after_issue_pass": true,
    "auto_run_change_verify": true,
    "auto_archive_after_verify": true
  }
}
```

Behavior:

- design review pass automatically enters issue planning
- issue planning pass automatically dispatches approved issues
- issue pass automatically advances to the next issue or change acceptance
- change acceptance automatically enters verify
- verify pass automatically advances into archive

## Lifecycle Switch Map

- `spec_readiness -> issue_planning`: `subagent_team.auto_advance_after_design_review`
- `issue_planning -> issue_execution`: `subagent_team.auto_advance_after_issue_planning_review`
- `issue_execution -> next_issue_or_change_acceptance`: `subagent_team.auto_advance_to_next_issue_after_issue_pass`
- `change_acceptance -> verify`: `subagent_team.auto_run_change_verify`
- `verify -> archive`: `subagent_team.auto_archive_after_verify`
