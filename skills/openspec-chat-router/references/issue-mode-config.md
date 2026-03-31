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
    "enabled": false,
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
    "auto_accept_issue_review": true,
    "auto_accept_change_acceptance": false,
    "auto_archive_after_verify": false
  }
}
```

## Supported Fields

- `worktree_root`: repo-relative root for optional issue git worktrees when `worker_worktree.enabled=true`.
- `validation_commands`: repo-level default validation commands used when an issue doc does not override `validation`.
- `worker_worktree.enabled`: whether issues default to dedicated git worktrees. `false` means shared workspace mode and materializes `worker_worktree: .`.
- `worker_worktree.mode`: `detach` or `branch`.
- `worker_worktree.base_ref`: base ref passed to `git worktree add`.
- `worker_worktree.branch_prefix`: prefix used when `mode=branch`.
- `rra.gate_mode`: `advisory` or `enforce`.
- `subagent_team.auto_accept_spec_readiness`: automatically accept the spec-readiness gate once proposal/design have passed the dedicated `1` author + `2` reviewers design review, then continue into task splitting / issue planning without waiting for human sign-off.
- `subagent_team.auto_accept_issue_planning`: automatically accept the issue-planning gate once `tasks.md` plus INDEX/ISSUE docs are dispatch-ready, then dispatch the approved issue set without waiting for human sign-off.
- `subagent_team.auto_accept_issue_review`: automatically accept an eligible `review_required` issue after its issue-local validation passes, then merge/commit it and continue to the next issue or change acceptance. This is enabled in the shipped default config so each accepted issue lands as its own coordinator commit.
- `subagent_team.auto_accept_change_acceptance`: automatically accept the change-acceptance gate and continue into change-level verify.
- `subagent_team.auto_archive_after_verify`: continue from a passed verify result into archive automatically.

## Current Contract

`worktree_root`, `worker_worktree.*`, `validation_commands`, `rra.gate_mode`, and `subagent_team.*` are the active issue-mode config surface.

## Practical Rule

Issue docs should still materialize `worker_worktree` and `validation` in frontmatter whenever possible.
The repo config is a reusable default layer, not a replacement for clear issue docs.

`worker_worktree` stays in the contract, but it now supports two steady-state modes:

- shared workspace: `worker_worktree.enabled=false` or `worker_worktree: .` in the issue doc. This is the default. Issue execution happens in the coordinator repo root and acceptance commits are created from the shared workspace.
- isolated worktree: `worker_worktree.enabled=true` or an explicit `.worktree/<change>/<issue>` path in the issue doc. Use this only when you truly need per-issue isolation or parallel issue execution.

Backward compatibility note:

- older repos that already materialized `worktree_root` / `worker_worktree.mode` without an explicit `enabled` flag continue to be treated as isolated-worktree configs
- new templates write `worker_worktree.enabled=false` explicitly so the default is unambiguous

Important:

- `subagent_team.*` controls auto-advance behavior after the coordinator has already entered the subagent-team flow
- `subagent_team.*` only skips human sign-off; it does not skip waiting for the current phase's gate-bearing subagents to finish
- it does not choose the default coordinator entry topology
- in issue mode, the default coordinator entry is `openspec-subagent-team` regardless of whether the active automation profile is `semi_auto`, `full_auto`, or `custom`
- when reconcile emits `dispatch_next_issue`, that result means "continue now", not "stop at control-plane ready and wait for another instruction"
- even when `auto_accept_change_acceptance=true`, a passed change-level `/review` is still required before verify
- gate-bearing design-review / check / review seats should not be launched as `explorer`, and should use up to 1 hour blocking waits when unattended progression matters
- role-based `reasoning_effort` is currently a skill/dispatch contract, not an `issue-mode.json` field:
  - design-author subagent: `xhigh`
  - any code-writing implementation or verify-fix subagent: `xhigh`
  - design reviewers, planning authors, checkers, reviewers, and closeout-only subagents: `medium`
  - coordinator should pass these values explicitly when spawning, because many runtimes otherwise inherit the session-wide default

## Automation Profiles

The runtime derives a profile from `rra.gate_mode` plus the `subagent_team.*` switches:

- `semi_auto`: `rra.gate_mode=advisory`, while `spec_readiness`, `issue_planning`, `change_acceptance`, and `archive` still wait for manual confirmation. `auto_accept_issue_review` may be `false` or `true`; when it is `true`, issue execution still auto-commits each validated issue.
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
    "enabled": false,
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

- spec-readiness waits for human acceptance after the `1` author + `2` reviewers design review, then issue planning can start task splitting
- issue planning waits for human acceptance before first dispatch
- issue review waits for human acceptance before dispatching the next issue
- after all issues are done, coordinator must first run a passed change-level `/review`
- change acceptance waits for human acceptance before verify
- verify pass pauses before archive
- each phase still has to wait for its gate-bearing subagents to finish; the pause here refers to human sign-off, not subagent completion
- RRA keeps emitting guidance, but does not hard-block progression
- issues run in the shared repo workspace by default (`worker_worktree: .`)
- if you also want every validated issue to land as its own commit without changing the rest of the gate behavior, keep this profile and set `auto_accept_issue_review=true`

### Full-Automatic

Use this when subagent-team should own the full lifecycle, not just issue execution.

```json
{
  "worktree_root": ".worktree",
  "validation_commands": ["pnpm lint", "pnpm type-check"],
  "worker_worktree": {
    "enabled": false,
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

- spec-readiness is auto-accepted after design review and immediately enters task splitting / issue planning
- issue planning is auto-accepted and immediately dispatches approved issues
- a `dispatch_next_issue` result must be executed immediately; it must not be reframed as a terminal checkpoint or chat-only summary
- eligible issue review is auto-accepted and immediately merges/continues
- after all issues are done, coordinator still runs change-level `/review`; only a passed review can auto-advance into verify
- change acceptance is auto-accepted and immediately enters verify once that review has passed
- verify pass automatically advances into archive
- each auto-advance still waits for the phase's gate-bearing subagents to finish and for their verdicts to be collected
- issues run in the shared repo workspace by default; if you need per-issue isolation, opt back into `worker_worktree.enabled=true`

### Optional Isolated Worktree Mode

Use this only when you explicitly want per-issue git worktrees, for example to run independent issues in parallel.

```json
{
  "worktree_root": ".worktree",
  "validation_commands": ["pnpm lint", "pnpm type-check"],
  "worker_worktree": {
    "enabled": true,
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

- dispatch materializes `.worktree/<change>/<issue>` by default
- coordinator accepts an issue by importing the worker diff back into the coordinator repo and creating the acceptance commit
- do not use this as the default for strictly serial issues; it increases coordination cost and can duplicate work when later issues start from an older base

## Lifecycle Switch Map

- `spec_readiness -> issue_planning`: `subagent_team.auto_accept_spec_readiness`
- `issue_planning -> issue_execution`: `subagent_team.auto_accept_issue_planning`
- `issue_execution -> next_issue_or_change_acceptance`: `subagent_team.auto_accept_issue_review`
- `change_acceptance -> verify`: `subagent_team.auto_accept_change_acceptance`
- `verify -> archive`: `subagent_team.auto_archive_after_verify`
