# OpenSpec Extensions TypeScript Migration TDD

## Document Control

- Status: Draft
- Date: 2026-04-01
- Audience: maintainer, tech lead, implementers
- Scope: migrate `openspec-extensions` runtime helpers from Python to TypeScript and prepare the project for npm-first distribution

## 1. Summary

This document defines the technical design for migrating `openspec-extensions` from a Python-script-based runtime to a TypeScript-based runtime.

Today, the repository ships project-level skills plus a set of Python helpers that are invoked directly from `SKILL.md`, generated dispatch packets, and installer commands. The migration goal is not just to change language syntax. It is to:

- remove the Python runtime requirement for installation and normal operation
- make the project distributable as a first-class npm package
- keep workflow artifacts, CLI contracts, and behavior stable during the transition
- reduce duplicated installer logic and ad hoc Python module loading

The migration will be executed incrementally. We will preserve external behavior first, then simplify internal structure after the TypeScript runtime is in place.

## 2. Goals

- Provide a TypeScript implementation for all currently shipped Python runtime helpers.
- Preserve current artifact formats under `openspec/changes/**` and `.codex/skills/**`.
- Preserve existing coordinator and worker flow semantics.
- Keep generated markdown packets and JSON artifacts compatible with current skills.
- Consolidate duplicated installer behavior into one Node/TypeScript implementation.
- Enable npm CLI distribution for install and runtime helper execution.

## 3. Non-Goals

- Redesigning the OpenSpec workflow itself.
- Changing issue-mode control-plane semantics, gate rules, or artifact schemas except where explicitly required for compatibility fixes.
- Rewriting skill content or prompt semantics beyond replacing command invocation paths.
- Replacing git CLI operations with a pure-JS git implementation in this migration.
- Refactoring `web-v1/.codex` vendored mirrors as part of the first migration pass.

## 4. Current State

### 4.1 Runtime Inventory

The current Python runtime consists of:

- 14 non-test Python scripts under `skills/*/scripts`
- 1 top-level installer script under `scripts/install_openspec_extensions.py`
- 10 Python test files, mostly CLI-level black-box tests

The largest shared runtime modules are:

- `skills/openspec-shared/scripts/issue_mode_common.py`
- `skills/openspec-shared/scripts/coordinator_change_common.py`

The main behavior clusters are:

- Installer
  - `scripts/install_openspec_extensions.py`
  - `skills/openspec-shared/scripts/install_issue_mode_skills.py`
- Dispatch rendering
  - `create_worker_worktree.py`
  - `render_issue_dispatch.py`
  - `render_subagent_team_dispatch.py`
- Worker runtime
  - `update_issue_progress.py`
- Reconcile and coordinator actions
  - `reconcile_issue_progress.py`
  - `coordinator_commit_planning_docs.py`
  - `coordinator_merge_issue.py`
  - `coordinator_review_change.py`
  - `coordinator_verify_change.py`
  - `coordinator_archive_change.py`
- Lifecycle rendering
  - `render_change_lifecycle_dispatch.py`

### 4.2 Current Technical Constraints

- Python scripts are imported across skill folders via `sys.path.insert(...)`.
- Several scripts shell out to `git`, `codex review`, or repo-defined validation commands.
- Generated markdown and JSON artifacts are consumed by skills and by downstream coordinator logic.
- Skill docs and generated packets currently hardcode `python3 ...` command forms in many places.
- Installer logic exists in two parallel implementations with overlapping behavior.

## 5. Problem Statement

The current implementation works, but it creates packaging and runtime friction:

- npm packaging is awkward because the package still depends on a Python runtime.
- installation and execution environments must provide both Node and Python
- cross-platform behavior must account for Python availability and interpreter naming
- shared logic is packaged as script-local modules rather than a coherent library
- installer logic is duplicated and can drift
- behavior changes require synchronized edits across Python helpers, tests, and markdown command text

These issues increase maintenance cost and block a clean npm-first distribution strategy.

## 6. Target Architecture

### 6.1 Architectural Overview

The target runtime will be a single TypeScript package with:

- one public CLI entrypoint for install and maintenance operations
- one internal library for shared parsing, config, artifact, and git utilities
- thin command modules that map one-to-one to current Python helper responsibilities
- generated command strings that call the TypeScript CLI rather than `python3` scripts

High-level shape:

```text
openspec-extensions/
├── package.json
├── src/
│   ├── cli/
│   │   └── index.ts
│   ├── commands/
│   │   ├── install.ts
│   │   ├── dispatch/
│   │   ├── execute/
│   │   ├── reconcile/
│   │   └── shared/
│   ├── domain/
│   │   ├── issue-mode-config.ts
│   │   ├── control-state.ts
│   │   ├── issue-progress.ts
│   │   ├── round-contract.ts
│   │   └── tasks.ts
│   ├── renderers/
│   │   ├── issue-dispatch.ts
│   │   ├── issue-team-dispatch.ts
│   │   └── lifecycle-dispatch.ts
│   ├── git/
│   │   ├── exec.ts
│   │   ├── worktree.ts
│   │   ├── patch.ts
│   │   └── status.ts
│   └── utils/
│       ├── fs.ts
│       ├── json.ts
│       ├── markdown.ts
│       └── time.ts
└── tests/
    ├── fixtures/
    ├── integration/
    └── unit/
```

### 6.2 Runtime Model

- The npm package will ship compiled JS in `dist/`.
- Skill docs and generated markdown will invoke a stable CLI command, not individual source files.
- The CLI will expose subcommands that match current helper intent.
- Internal commands will call shared library functions directly instead of spawning sibling helper scripts.
- External tools will still be called through child processes where that matches current behavior.

## 7. Key Decisions and Tradeoffs

### Decision 1: Keep CLI Contracts Stable Before Internal Cleanup

We will preserve current inputs, outputs, and artifact semantics first.

Reason:

- current tests are largely black-box and therefore reusable
- the skills depend on behavior more than implementation language
- reducing behavioral drift is more important than immediate refactoring purity

Tradeoff:

- some TypeScript modules may initially mirror Python structure too closely

### Decision 2: Keep Using System `git`

We will continue to call the `git` CLI instead of replacing it with a JS git library.

Reason:

- current helpers already depend on nuanced `git diff --binary`, `git worktree`, `git apply`, and porcelain output
- matching those semantics in a JS git library would add risk and likely reduce compatibility

Tradeoff:

- the runtime remains dependent on `git` being available in PATH

### Decision 3: Prefer Function Calls Over Script-to-Script Subprocess Calls

In TypeScript, commands will import shared logic directly instead of spawning sibling helper commands where possible.

Reason:

- improves observability and testability
- removes failure modes caused by path resolution and recursive process spawning
- reduces duplicated serialization logic

Tradeoff:

- requires a cleaner module graph than the current Python layout

### Decision 4: Preserve Artifact Schemas

JSON artifact shapes and markdown packet structure will remain stable during migration.

Reason:

- these artifacts are part of the de facto runtime contract
- downstream skills and vendored mirrors rely on them

Tradeoff:

- some legacy field names may remain longer than ideal

### Decision 5: Use Narrow Parsers Where Current Behavior Is Intentional

We will not silently swap narrow handwritten parsing logic for broad generic parsing behavior unless compatibility is explicitly verified.

Example:

- frontmatter parsing currently uses a limited parser with specific list/value behavior

Tradeoff:

- code may initially look less elegant than using a general YAML parser
- compatibility risk is lower

## 8. Module Boundaries and Responsibilities

### 8.1 `src/cli`

Responsibilities:

- parse argv
- dispatch to command handlers
- normalize exit codes
- print stable JSON or text responses

Out of scope:

- domain logic
- direct artifact mutation beyond delegating to command handlers

### 8.2 `src/domain`

Responsibilities:

- parse and normalize issue-mode config
- load change control state
- parse issue docs and issue frontmatter
- compute automation profile, worker worktree settings, acceptance gates, and task state

Primary source mapping:

- `issue_mode_common.py`
- parts of `coordinator_change_common.py`

### 8.3 `src/renderers`

Responsibilities:

- render issue dispatch markdown
- render issue team dispatch markdown
- render lifecycle dispatch markdown
- keep markdown output deterministic

Primary source mapping:

- `render_issue_dispatch.py`
- `render_subagent_team_dispatch.py`
- `render_change_lifecycle_dispatch.py`

### 8.4 `src/git`

Responsibilities:

- wrap `git` execution
- parse status output
- manage worktree creation and reuse
- build tracked and untracked patches
- apply patches and sync reusable worktrees

Primary source mapping:

- `create_worker_worktree.py`
- `coordinator_merge_issue.py`
- portions of `coordinator_commit_planning_docs.py`
- portions of `coordinator_archive_change.py`

### 8.5 `src/commands`

Responsibilities:

- expose command-specific orchestration
- validate required inputs
- compose domain, renderer, and git services

Primary source mapping:

- all current Python entrypoint scripts

### 8.6 `src/utils`

Responsibilities:

- filesystem helpers
- JSON read/write helpers
- markdown section extraction helpers
- time formatting
- subprocess wrappers for non-git external commands

## 9. Proposed CLI Contract

The final command names may be refined during implementation, but the stable direction is:

```bash
openspec-extensions install --target-repo <path> [--force] [--force-config] [--dry-run]
openspec-extensions dispatch issue --repo-root . --change <change> --issue-id <issue>
openspec-extensions dispatch issue-team --repo-root . --change <change> --issue-id <issue>
openspec-extensions dispatch lifecycle --repo-root . --change <change> [--phase auto]
openspec-extensions execute update-progress start ...
openspec-extensions execute update-progress stop ...
openspec-extensions reconcile change --repo-root . --change <change>
openspec-extensions reconcile commit-planning-docs --repo-root . --change <change>
openspec-extensions reconcile merge-issue --repo-root . --change <change> --issue-id <issue>
openspec-extensions review change --repo-root . --change <change>
openspec-extensions verify change --repo-root . --change <change>
openspec-extensions archive change --repo-root . --change <change>
openspec-extensions worktree create --repo-root . --change <change> --issue-id <issue>
```

Design rules:

- command names should be stable and human-readable
- stdout JSON payloads should remain machine-consumable
- dry-run behavior must be explicit and deterministic
- command exit code semantics should match current expectations

## 10. Data Models and Contracts

### 10.1 Stable Artifacts

The following artifacts are compatibility-sensitive and must not change shape without a versioned migration:

- `openspec/issue-mode.json`
- `openspec/changes/<change>/issues/*.progress.json`
- `openspec/changes/<change>/runs/*.json`
- `openspec/changes/<change>/control/ROUND-*.md`
- `openspec/changes/<change>/control/BACKLOG.md`
- `openspec/changes/<change>/control/SUBAGENT-TEAM.dispatch.md`
- `openspec/changes/<change>/issues/*.dispatch.md`
- `openspec/changes/<change>/issues/*.team.dispatch.md`

### 10.2 TypeScript Types

We will define explicit TS interfaces for:

- `IssueModeConfig`
- `WorkerWorktreeConfig`
- `SubagentTeamConfig`
- `ChangeControlState`
- `LatestRoundContract`
- `IssueProgress`
- `RunArtifact`
- `DispatchGate`
- `PlanningDocStatus`
- `ReviewArtifact`
- `VerifyArtifact`

### 10.3 Validation Strategy

- use runtime validation only at external boundaries
- use typed internal structures after normalization
- prefer fail-fast errors for malformed config and required issue-doc fields

## 11. Script Mapping Plan

### Phase A: low-risk utilities and installers

- `scripts/install_openspec_extensions.py`
- `skills/openspec-shared/scripts/install_issue_mode_skills.py`
- `skills/openspec-execute-issue/scripts/update_issue_progress.py`

Why first:

- simple fs/json behavior
- low workflow risk
- immediate packaging value

### Phase B: pure renderers and reconcile logic

- `render_issue_dispatch.py`
- `render_subagent_team_dispatch.py`
- `render_change_lifecycle_dispatch.py`
- `reconcile_issue_progress.py`

Why second:

- mostly deterministic parsing and rendering
- behavior is easy to snapshot test
- high user-visible value

### Phase C: coordinator helpers with bounded side effects

- `coordinator_commit_planning_docs.py`
- `coordinator_review_change.py`
- `coordinator_verify_change.py`
- `coordinator_archive_change.py`

Why third:

- moderate shell/process interaction
- fewer patch-level git complexities than merge helper

### Phase D: highest-risk git helpers

- `create_worker_worktree.py`
- `coordinator_merge_issue.py`

Why last:

- involve worktrees, patch generation, patch application, and commit boundaries
- highest probability of subtle behavior drift

## 12. Migration Plan

### Step 1: introduce TS runtime skeleton

- add `package.json`
- add `tsconfig.json`
- add build output to `dist/`
- add CLI entrypoint
- add test runner and fixture structure

### Step 2: port shared parsing and config modules

- port `issue_mode_common.py`
- port reusable pieces of `coordinator_change_common.py`
- lock behavior with fixture-based unit tests

### Step 3: port installer and worker progress helper

- implement one canonical install command
- deprecate duplicate installer logic
- update docs to prefer npm/CLI install path

### Step 4: port renderers and reconcile

- replace Python renderer invocations with TS command handlers
- convert script-to-script subprocess chaining into internal function calls
- verify markdown output through snapshot comparisons

### Step 5: port coordinator commands

- preserve current stdout JSON shape
- preserve dry-run semantics
- preserve external command invocation and tail capture behavior

### Step 6: port git-heavy helpers

- add dedicated git wrapper utilities
- reproduce patch and worktree behavior with integration tests against temporary repos

### Step 7: flip skill and doc command strings

- replace `python3 .codex/skills/...` references with stable CLI invocation
- update README, AGENTS, `SKILL.md`, and generated packet templates

### Step 8: remove Python runtime dependency

- only after TS runtime parity is proven
- remove Python entrypoints from default docs
- optionally keep a short deprecation shim window if needed

## 13. Compatibility and Rollout Strategy

### 13.1 Compatibility Requirements

- No artifact schema changes in the first migration release.
- No mandatory workflow changes in the first migration release.
- Generated dispatch markdown should remain semantically equivalent.
- Existing issue-mode repositories should not require manual artifact migration.

### 13.2 Rollout Model

Recommended rollout:

1. ship TS runtime behind a preview command path
2. run dual verification in CI on representative fixtures
3. switch docs and skills to the TS CLI once parity is confirmed
4. remove Python from required runtime only after one stable release cycle

### 13.3 Rollback Plan

Rollback trigger:

- artifact drift
- patch/apply mismatch
- worktree lifecycle regression
- markdown packet incompatibility
- verification/review command behavior mismatch

Rollback method:

- keep Python scripts intact until TS parity release is proven
- keep skill command strings on Python during preview
- gate the final cutover behind passing fixture and integration suites
- if a release regresses behavior, republish docs and skills pointing back to Python commands

## 14. Error Handling

The TypeScript runtime will follow these rules:

- preserve fail-fast behavior for required inputs and malformed state
- return non-zero exit codes for command failure
- keep stdout reserved for structured result payloads where current commands do so
- prefer human-readable error messages on stderr
- preserve dry-run as a no-write mode
- preserve truncated output tails for review and validation commands

For shell commands:

- capture stdout, stderr, and exit code
- use explicit cwd
- avoid implicit shell execution unless the current command contract requires shell parsing
- isolate shell-based execution to narrow wrappers

## 15. Performance Considerations

Expected performance impact is neutral to slightly positive.

Reasons:

- renderers and parsers are lightweight
- Node startup cost is acceptable relative to current Python script startup cost
- removing script-to-script subprocess chaining should reduce overhead in lifecycle rendering

Specific optimizations:

- prefer direct function calls instead of child-process recursion
- avoid repeated config reloads within a single command execution
- reuse parsed artifact state inside command handlers

## 16. Security Notes

- The runtime will continue executing repo-defined validation commands; this is trusted-repo behavior and must remain explicit.
- Shell-based execution must be limited to cases where current contracts require shell interpretation.
- Path handling must continue to validate worktree paths stay within allowed roots.
- Generated branch names and worktree paths must remain sanitized.
- Installer commands must not overwrite user state unless `--force` or `--force-config` is explicitly set.

## 17. Testing Plan

### 17.1 Unit Tests

Cover:

- config normalization
- frontmatter parsing
- markdown section extraction
- backlog and round parsing
- worktree path computation
- continuation policy and gate decisions

### 17.2 Snapshot Tests

Cover:

- issue dispatch markdown
- issue team dispatch markdown
- lifecycle dispatch markdown

### 17.3 Integration Tests

Use temporary repos to validate:

- installer dry-run and real install
- `.gitignore` updates
- planning-doc commit behavior
- worktree creation and reuse
- merge helper patch generation and apply behavior
- archive cleanup behavior
- review/verify artifact generation

### 17.4 Parity Tests

For each migrated command:

- run Python version against fixture
- run TS version against same fixture
- compare stdout JSON or generated markdown
- compare written artifact contents

### 17.5 Release Gates

Before switching skills to the TS runtime:

- all migrated command parity tests pass
- all high-risk git integration tests pass
- generated markdown snapshots are reviewed
- install flow works from npm package contents, not just source tree

## 18. Open Questions

- Should the final runtime expose one CLI binary or also a small set of compatibility aliases?
- Do we want to keep exact artifact field ordering where JSON snapshots currently imply ordering?
- Should the npm package include a temporary Python fallback layer during migration, or should preview remain source-only until parity is complete?
- When `web-v1/.codex` mirroring resumes, should vendored mirrors be generated from built package artifacts or from source files?

## 19. Recommended Implementation Order

Recommended order for execution:

1. create package skeleton and shared TS domain modules
2. migrate installer plus `update_issue_progress`
3. migrate renderers plus reconcile logic
4. migrate coordinator review/verify/archive helpers
5. migrate worktree and merge helpers
6. switch skill command strings and generated packet commands
7. remove Python as a required runtime

## 20. Acceptance Criteria

This migration is complete when:

- all runtime helpers used by skills have TypeScript implementations
- the published npm package can install and run the extension without Python
- generated artifacts remain compatible with the current issue-mode workflow
- all current black-box scenarios have equivalent TS test coverage
- skill docs and README no longer require `python3` as the normal path
- the duplicated installer logic has been removed or reduced to one canonical implementation
