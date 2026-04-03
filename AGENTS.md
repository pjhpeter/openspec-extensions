# Repository Guidelines

## Project Scope & Structure
This repository publishes the `openspec-extensions` npm package. It is no longer just an installer wrapper: it ships the TypeScript CLI, workflow renderers, coordinator logic, installable skills, and the default `issue-mode` template.

- [`src/cli/index.ts`](./src/cli/index.ts) defines the public CLI surface.
- [`src/commands/`](./src/commands) contains command handlers, including `execute/update-progress`.
- [`src/domain/`](./src/domain) contains change and issue-mode workflow logic.
- [`src/renderers/`](./src/renderers) renders dispatch packets and lifecycle output.
- [`src/git/`](./src/git) holds git command and merge helpers.
- [`src/utils/`](./src/utils) holds shared helpers.
- [`skills/`](./skills) contains installable `openspec-*` skill directories.
- [`templates/issue-mode.json`](./templates/issue-mode.json) is the installed default config.
- [`tests/`](./tests) is split into `cli`, `integration`, and `unit`.
- [`docs/`](./docs) contains migration and release notes.

`dist/` is generated build output. Do not edit it by hand.

## Build, Test, and Development Commands
- `npm install`: install local dependencies.
- `npm run build`: compile the TypeScript CLI into `dist/`.
- `npm run lint`: run ESLint on the TS source tree.
- `npm run type-check`: run `tsc --noEmit`.
- `npm test`: run the CLI, integration, and unit test suite.
- `npm run smoke:package`: validate the packed tarball through tarball, `npx`, and installed-bin flows.
- `openspec-ex init`: initialize OpenSpec when needed, then install extension skills into the current repo.
- `openspec-extensions init /path/to/repo`: path-explicit equivalent of `openspec-ex init`.
- `openspec-extensions install --target-repo /path/to/repo [--dry-run|--force|--force-config]`: install or preview installed skills and config.
- `openspec-extensions dispatch issue|issue-team|lifecycle`: render issue-mode dispatch packets.
- `openspec-extensions execute update-progress <start|checkpoint|stop>`: update issue progress and run artifacts.
- `openspec-extensions reconcile change|commit-planning-docs|merge-issue`: run coordinator reconciliation flows.
- `openspec-extensions review change`, `verify change`, `archive change`, `worktree create`: run change-level review, verification, archive, and workspace flows.

Use [`README.md`](./README.md) as the long-form product and workflow reference. Keep AGENTS concise and operational.

## Coding Style & Naming Conventions
- Keep TypeScript source under `src/` and preserve the current module split instead of collapsing command, domain, and renderer responsibilities together.
- Use `openspec-*` kebab-case for skill directories and keep skill docs as `SKILL.md` plus focused `references/` content.
- Preserve install-time relative paths exactly; many generated or installed references depend on them.
- Keep JSON files compact and readable with 2-space indentation.
- When changing CLI behavior, update the command help text, README usage docs, and relevant tests together.
- This repo has already completed the TS CLI cutover. Do not reintroduce Python runtime or installer compatibility paths unless the user explicitly asks for that rollback.

## Testing Guidelines
- Baseline validation for source changes is `npm run lint`, `npm run type-check`, and `npm test`.
- Run `npm run build` whenever the CLI, packaging surface, or emitted `dist/` contents could change.
- Run `npm run smoke:package` for installer changes, packaging changes, release work, or any change that might affect packed tarball contents or installed-bin behavior.
- Put command routing coverage in [`tests/cli`](./tests/cli), workflow and filesystem behavior in [`tests/integration`](./tests/integration), and pure logic in [`tests/unit`](./tests/unit).
- For skill or template edits, confirm installed relative paths still resolve under the OpenSpec-configured `<toolDir>/skills/` directories in a disposable target repo.
- When changing dispatch, reconcile, review, verify, archive, or worktree behavior, prefer integration coverage over unit-only coverage.

## Release & Publishing Guidelines
- Update [`package.json`](./package.json) and [`package-lock.json`](./package-lock.json) together when bumping the package version.
- Before publishing, run `npm run lint`, `npm run type-check`, `npm test`, `npm run build`, and `npm run smoke:package`.
- Publish with `npm publish --access public` only after the release checks pass.
- After publishing, verify the registry state with `npm view openspec-extensions version dist-tags --json`.
- Do not assume publish implies git commit, git tag, or git push; those remain separate user-authorized actions.

## Commit & Pull Request Guidelines
- Use Conventional Commit style consistent with repo history, for example `feat(reconcile): add change backlog sync` or `chore(release): bump version to 0.1.3`.
- Keep commits focused on one behavior change, installer change, or release step.
- PRs should describe the user-visible workflow impact, list verification commands actually run, and call out any target-repo effects such as installed files, config keys, or overwrite behavior.
- Include sample command output when changing CLI semantics, install output, or package publishing behavior.
