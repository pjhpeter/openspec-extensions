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
    "auto_accept_spec_readiness": false,
    "auto_accept_issue_planning": false,
    "auto_accept_issue_review": false,
    "auto_accept_change_acceptance": false,
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
- `subagent_team.auto_accept_spec_readiness`: automatically accept the spec-readiness gate once proposal/design/tasks are implementation-ready, then continue into issue planning without waiting for human sign-off.
- `subagent_team.auto_accept_issue_planning`: automatically accept the issue-planning gate once INDEX/ISSUE docs are dispatch-ready, then dispatch the approved issue set without waiting for human sign-off.
- `subagent_team.auto_accept_issue_review`: automatically accept an eligible `review_required` issue after its issue-local validation passes, then merge/commit it and continue to the next issue or change acceptance.
- `subagent_team.auto_accept_change_acceptance`: automatically accept the change-acceptance gate and continue into change-level verify.
- `subagent_team.auto_archive_after_verify`: continue from a passed verify result into archive automatically.

## Current Contract

`worktree_root`, `worker_worktree.*`, `validation_commands`, `rra.gate_mode`, and `subagent_team.*` are the active issue-mode config surface.

## Practical Rule

Issue docs should still materialize `worker_worktree` and `validation` in frontmatter whenever possible.
The repo config is a reusable default layer, not a replacement for clear issue docs.

`worker_worktree` is part of the intended steady-state contract. It is kept as the issue-isolation and coordinator-merge boundary for the subagent-team flow.

Important:

- `subagent_team.*` controls auto-advance behavior after the coordinator has already entered the subagent-team flow
- it does not choose the default coordinator entry topology
- in issue mode, the default coordinator entry is `openspec-subagent-team` regardless of whether the active automation profile is `semi_auto`, `full_auto`, or `custom`

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

Use this when a human should still inspect design readiness, issue planning, issue acceptance, verify, and archive checkpoints.

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
    "auto_accept_spec_readiness": false,
    "auto_accept_issue_planning": false,
    "auto_accept_issue_review": false,
    "auto_accept_change_acceptance": false,
    "auto_archive_after_verify": false
  }
}
```

Behavior:

- spec-readiness waits for human acceptance before issue planning
- issue planning waits for human acceptance before first dispatch
- issue review waits for human acceptance before dispatching the next issue
- change acceptance waits for human acceptance before verify
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
    "auto_accept_spec_readiness": true,
    "auto_accept_issue_planning": true,
    "auto_accept_issue_review": true,
    "auto_accept_change_acceptance": true,
    "auto_archive_after_verify": true
  }
}
```

Behavior:

- spec-readiness is auto-accepted and immediately enters issue planning
- issue planning is auto-accepted and immediately dispatches approved issues
- eligible issue review is auto-accepted and immediately merges/continues
- change acceptance is auto-accepted and immediately enters verify
- verify pass automatically advances into archive

## Lifecycle Switch Map

- `spec_readiness -> issue_planning`: `subagent_team.auto_accept_spec_readiness`
- `issue_planning -> issue_execution`: `subagent_team.auto_accept_issue_planning`
- `issue_execution -> next_issue_or_change_acceptance`: `subagent_team.auto_accept_issue_review`
- `change_acceptance -> verify`: `subagent_team.auto_accept_change_acceptance`
- `verify -> archive`: `subagent_team.auto_archive_after_verify`
