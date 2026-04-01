# OpenSpec Extensions TypeScript Migration Implementation Plan

## Document Control

- Status: Draft
- Date: 2026-04-01
- Parent design: `docs/ts-migration-tdd.md`
- Audience: maintainer, tech lead, implementers
- Goal: convert the TDD into an execution-ready implementation plan with phases, tasks, dependencies, and exit criteria

## 1. Plan Summary

This plan breaks the TypeScript migration into a sequence of low-risk deliverables.

Execution principles:

- preserve runtime behavior before improving structure
- migrate low-risk commands first
- keep Python entrypoints available until TypeScript parity is proven
- validate each phase with fixture-based or repo-based black-box tests
- avoid mixing packaging changes, git-heavy migration, and skill prompt cutover in the same phase

The plan assumes one maintainer or a small team can execute the work in serial. If multiple engineers are available, the plan can be parallelized by workstream after Phase 1.

## 2. Scope Baseline

In scope:

- npm package bootstrap
- TypeScript runtime library
- TypeScript CLI for all current Python helpers
- tests, fixtures, and parity verification
- command string migration in docs and skills

Out of scope for the first migration wave:

- workflow redesign
- artifact schema redesign
- replacing `git` CLI with a JS git library
- broad cleanup of vendored mirrors outside the final cutover needs

## 3. Success Criteria

The migration is successful when all of the following are true:

- every Python helper used by the skills has a TypeScript equivalent
- normal install and runtime paths no longer require Python
- generated markdown and JSON artifacts remain compatible
- git/worktree flows behave the same on representative fixtures
- docs and skill prompts use the TS/npm command path as the default
- the Python runtime can be removed without breaking the primary workflow

## 4. Workstreams

### WS1. Package and Build Foundation

Objective:

- establish the npm/TS project shape and release path

Primary outputs:

- `package.json`
- `tsconfig.json`
- build scripts
- CLI entrypoint

### WS2. Shared Domain and Utility Layer

Objective:

- port shared parsing, config, artifact, and markdown logic into reusable TypeScript modules

Primary outputs:

- `src/domain/*`
- `src/utils/*`
- fixture-based unit tests

### WS3. Low-Risk Command Migration

Objective:

- migrate installer and progress-helper commands first to unlock packaging and early confidence

Primary outputs:

- TS installer
- TS `update-progress`
- parity tests

### WS4. Renderer and Reconcile Migration

Objective:

- migrate deterministic renderers and reconcile logic while keeping output compatibility

Primary outputs:

- TS issue dispatch renderer
- TS issue team renderer
- TS lifecycle renderer
- TS reconcile command

### WS5. Coordinator Helper Migration

Objective:

- migrate bounded side-effect commands before touching the patch/worktree-heavy helpers

Primary outputs:

- planning-doc commit helper
- review helper
- verify helper
- archive helper

### WS6. Git-Heavy Helper Migration

Objective:

- migrate worktree creation and merge/apply behavior with strong integration coverage

Primary outputs:

- TS worktree helper
- TS merge helper
- repo-fixture tests for patch/apply/worktree flows

### WS7. Prompt and Distribution Cutover

Objective:

- switch docs, skills, and generated command strings to the TS runtime

Primary outputs:

- updated `README.md`
- updated `AGENTS.md`
- updated `SKILL.md`
- updated generated markdown command text

## 5. Phase Plan

### Phase 0. Repo Bootstrap

Objective:

- prepare the repository for a TS runtime without changing behavior

Tasks:

- IMP-001: add `package.json` with package name, engines, scripts, and `bin` entry
- IMP-002: add `tsconfig.json` and initial `src/` / `tests/` layout
- IMP-003: choose test runner and snapshot strategy
- IMP-004: add a build command that emits `dist/`
- IMP-005: document local dev commands in README or contributor docs

Dependencies:

- none

Exit criteria:

- `npm` or `pnpm` scripts can build the empty TS skeleton
- CLI entrypoint can print help
- repository has a stable runtime layout for future phases

Suggested issue split:

- `IMP-001 package bootstrap`
- `IMP-002 test harness bootstrap`

### Phase 1. Shared Core Port

Objective:

- port shared logic before any major command migration

Tasks:

- IMP-006: port config defaults and deep-merge logic from `issue_mode_common.py`
- IMP-007: port markdown section extraction and normalization helpers
- IMP-008: port frontmatter parsing with behavior parity
- IMP-009: port change-control and issue-artifact path helpers
- IMP-010: port worker worktree path and branch-name derivation
- IMP-011: port task-sync and artifact freshness logic from `coordinator_change_common.py`
- IMP-012: add unit fixtures for config parsing, frontmatter parsing, backlog parsing, and round parsing

Dependencies:

- Phase 0 complete

Exit criteria:

- shared TS modules cover the current Python feature surface needed by later commands
- unit tests pass for config, markdown, frontmatter, path, and artifact state helpers
- no command migration depends on Python-only shared code

Suggested issue split:

- `IMP-006 config and path helpers`
- `IMP-007 markdown and frontmatter parsing`
- `IMP-008 task and artifact state helpers`

### Phase 2. Installer and Progress Helper

Objective:

- unlock npm-first install flow and the lowest-risk runtime helper

Tasks:

- IMP-013: implement canonical TS installer command
- IMP-014: port duplicated installer behavior from both Python installers into one TS implementation
- IMP-015: keep overwrite, dry-run, `.gitignore`, and legacy cleanup semantics compatible
- IMP-016: port `update_issue_progress.py` to TS
- IMP-017: add parity tests comparing Python and TS installer outputs on fixture repos
- IMP-018: add parity tests for progress-artifact creation and update behavior

Dependencies:

- Phase 1 complete

Exit criteria:

- TS installer can replace both current installer scripts
- TS `update-progress` command produces compatible JSON artifacts
- install dry-run and real install behavior pass parity tests

Suggested issue split:

- `IMP-013 unified installer`
- `IMP-014 update-progress`

### Phase 3. Renderer Migration

Objective:

- migrate markdown packet generation and remove script-to-script subprocess chaining where possible

Tasks:

- IMP-019: port `render_issue_dispatch.py`
- IMP-020: port `render_subagent_team_dispatch.py`
- IMP-021: port `render_change_lifecycle_dispatch.py`
- IMP-022: replace lifecycle renderer child-process call to issue-team renderer with direct module invocation
- IMP-023: add markdown snapshot tests for issue dispatch, issue-team dispatch, and lifecycle packets
- IMP-024: add parity tests using current fixture repos and representative control-state permutations

Dependencies:

- Phase 1 complete
- Phase 2 recommended but not strictly required

Exit criteria:

- renderer outputs are snapshot-stable
- critical lifecycle scenarios match current Python behavior
- no renderer needs Python subprocess recursion

Suggested issue split:

- `IMP-019 issue dispatch renderer`
- `IMP-020 issue team dispatch renderer`
- `IMP-021 lifecycle renderer`

### Phase 4. Reconcile and Coordinator Bounded Helpers

Objective:

- migrate decision logic and bounded helper commands that do not require binary patch handling

Tasks:

- IMP-025: port `reconcile_issue_progress.py`
- IMP-026: port `coordinator_commit_planning_docs.py`
- IMP-027: port `coordinator_review_change.py`
- IMP-028: port `coordinator_verify_change.py`
- IMP-029: port `coordinator_archive_change.py`
- IMP-030: add tests for continuation policy, review gate, verify gate, archive gate, and planning-doc commit flows
- IMP-031: verify review and validation command tail-capture behavior stays compatible

Dependencies:

- Phase 1 complete
- Phase 3 complete for best coverage alignment

Exit criteria:

- coordinator commands produce compatible JSON artifacts
- continuation and gate logic matches current workflow expectations
- review/verify/archive flows pass integration fixtures

Suggested issue split:

- `IMP-025 reconcile`
- `IMP-026 planning-doc commit`
- `IMP-027 review and verify`
- `IMP-028 archive`

### Phase 5. Git-Heavy Helper Migration

Objective:

- migrate the highest-risk helpers only after the shared library and test harness are mature

Tasks:

- IMP-032: implement git wrapper module for command execution, stdout/stderr capture, and return-code handling
- IMP-033: port `create_worker_worktree.py`
- IMP-034: port `coordinator_merge_issue.py`
- IMP-035: port tracked patch generation behavior using `git diff --binary`
- IMP-036: port untracked-file patch generation behavior
- IMP-037: port `git apply`, staging, commit, and reusable worker resync logic
- IMP-038: add temporary-repo integration tests for worktree creation, merge-base computation, patch apply, shared-workspace mode, change-worktree mode, and issue-worktree mode

Dependencies:

- Phase 1 complete
- Phase 4 complete

Exit criteria:

- TS merge helper passes all representative repo-fixture tests
- worktree behavior matches Python helper outputs
- commit boundary and changed-file recording remain compatible

Suggested issue split:

- `IMP-032 git wrapper`
- `IMP-033 worktree helper`
- `IMP-034 merge helper core`
- `IMP-035 merge helper integration coverage`

### Phase 6. Command String Cutover

Objective:

- switch visible docs and skill contracts from Python commands to TS/npm commands

Tasks:

- IMP-039: update `README.md` install and runtime examples
- IMP-040: update `AGENTS.md` command references
- IMP-041: update all `SKILL.md` runtime command examples
- IMP-042: update generated markdown renderer text that currently embeds `python3 ...`
- IMP-043: add a compatibility note for the transition release if Python fallback still exists
- IMP-044: verify no remaining required Python command paths remain in user-facing docs

Dependencies:

- Phases 2 through 5 complete

Exit criteria:

- docs and skill prompts prefer TS/npm commands
- generated dispatch text no longer instructs users to run Python helpers
- migration docs clearly explain the new command path

Suggested issue split:

- `IMP-039 docs cutover`
- `IMP-040 generated command text cutover`

### Phase 7. Release Hardening and Python Removal

Objective:

- finalize the migration and remove Python as a required runtime

Tasks:

- IMP-045: run full parity suite across all migrated commands
- IMP-046: verify the built package works outside the source repo
- IMP-047: test npm install and `npx` execution on clean fixture repos
- IMP-048: remove or deprecate Python entrypoints
- IMP-049: publish release notes and upgrade guidance
- IMP-050: define post-release smoke checks and rollback path

Dependencies:

- all earlier phases complete

Exit criteria:

- npm package is self-sufficient for standard usage
- Python is no longer part of the required install path
- rollback artifacts and release notes are prepared

## 6. Dependency Graph

Hard dependencies:

- Phase 0 -> Phase 1
- Phase 1 -> Phase 2
- Phase 1 -> Phase 3
- Phase 3 -> Phase 4
- Phase 4 -> Phase 5
- Phase 5 -> Phase 6
- Phase 6 -> Phase 7

Soft dependencies:

- Phase 2 before Phase 3 improves confidence because install and helper invocation paths stabilize early
- Phase 3 before Phase 4 improves snapshot coverage for reconcile and lifecycle coordination

Parallelization opportunities:

- after Phase 1, renderer work and installer/progress work can run in parallel
- within Phase 4, review/verify/archive can be split if reconcile is stabilized first

## 7. Deliverables by Phase

| Phase | Deliverables |
| --- | --- |
| 0 | package skeleton, build scripts, CLI entrypoint, test harness |
| 1 | shared TS domain modules, unit fixtures, utility layer |
| 2 | unified TS installer, TS progress helper, parity tests |
| 3 | TS renderers, markdown snapshots, direct internal renderer wiring |
| 4 | TS reconcile and coordinator bounded helpers, integration tests |
| 5 | TS worktree and merge helpers, temporary-repo git integration suite |
| 6 | updated docs, updated skills, updated generated command text |
| 7 | built package validation, Python removal or deprecation, release artifacts |

## 8. Validation Matrix

| Area | Validation |
| --- | --- |
| Config and parsing | fixture-based unit tests |
| Installer | dry-run and real-install parity tests |
| Progress helper | artifact parity tests |
| Renderers | markdown snapshot tests plus fixture parity tests |
| Reconcile | JSON parity tests plus gate-behavior fixtures |
| Review/verify/archive | integration tests with temporary change repos |
| Worktree and merge | temporary-repo integration tests with real `git` |
| Distribution | built package smoke tests using `npx` or local package tarball |

## 9. Definition of Done per Issue

Each implementation issue should be considered done only when:

- the TS command or module exists
- the corresponding tests exist
- the old Python behavior has been compared on at least one representative fixture
- stdout/stderr and exit-code behavior are explicitly checked where applicable
- docs are updated if the issue changes a user-facing command path

## 10. Cutover Checklist

Before defaulting the project to the TS runtime:

- all phases through Phase 5 are complete
- all Python helper commands have TS equivalents
- no known parity gaps remain in installer, renderers, reconcile, review/verify/archive, worktree, or merge flows
- user-facing docs no longer require Python for standard operation
- npm package install path has been smoke-tested from built artifacts
- rollback instructions are documented

## 11. Risks and Mitigations

### Risk 1. Hidden behavior drift in frontmatter or markdown parsing

Mitigation:

- keep narrow parsing behavior
- add fixture tests before refactoring
- compare output against current Python runtime

### Risk 2. Git patch generation behaves differently in TS

Mitigation:

- keep using `git` CLI
- use real temporary repos in tests
- postpone merge-helper migration until the rest of the runtime is stable

### Risk 3. Docs cut over too early

Mitigation:

- do not switch command strings until Phases 2 through 5 are stable
- keep Python path available during preview releases

### Risk 4. Installer consolidation changes overwrite semantics

Mitigation:

- treat current installer JSON output as a compatibility contract
- add explicit parity fixtures for `--force`, `--force-config`, `--dry-run`, and `.gitignore` behavior

## 12. Recommended Milestones

Milestone 1:

- Phases 0 through 2 complete
- outcome: npm package skeleton exists and install/progress paths are migrated

Milestone 2:

- Phases 3 and 4 complete
- outcome: main deterministic workflow logic is migrated

Milestone 3:

- Phase 5 complete
- outcome: all high-risk git helpers are migrated and integration-tested

Milestone 4:

- Phases 6 and 7 complete
- outcome: docs are cut over and Python is no longer required

## 13. Tracking Recommendation

Recommended tracking model:

- create one epic per phase
- create one implementation issue per `IMP-xxx` task or per grouped issue split above
- require parity evidence in each issue description
- treat Phase 5 and Phase 7 as explicit release gates, not just more tasks

## 14. Immediate Next Actions

Recommended first actions after approving this plan:

1. Create the npm/TS skeleton in the repository.
2. Port shared parsing and config helpers before touching command entrypoints.
3. Build fixture coverage for current Python behavior so later migrations can compare against it.
4. Implement the unified TS installer as the first user-visible migration win.
