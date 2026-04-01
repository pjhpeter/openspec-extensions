# Repository Guidelines

## Project Structure & Module Organization
This repository packages OpenSpec issue-mode extensions for installation into other projects. Core runtime code lives in [`src/`](./src) and ships through the `openspec-extensions` CLI, while installable skill content lives in [`skills/`](./skills). [`templates/issue-mode.json`](./templates/issue-mode.json) provides the default `openspec/issue-mode.json` template installed alongside the skills.

## Build, Test, and Development Commands
The repository ships compiled CLI output from `dist/` plus raw `skills/` and `templates/` content.

- `npm install`: install local dependencies.
- `npm run build`: compile the TypeScript CLI into `dist/`.
- `npm run lint`: run ESLint on the TS source tree.
- `npm run type-check`: run `tsc --noEmit`.
- `npm test`: run the TS test suite.
- `npm run smoke:package`: validate the packed tarball through `npx` and installed-bin install flows.
- `openspec-ex init`: from an already selected repo root, initialize OpenSpec when needed and then install extension skills.
- `openspec-extensions init /path/to/repo`: path-explicit equivalent of `openspec-ex init`.
- `openspec-extensions install --help`: show installer options.
- `openspec-extensions install --target-repo /path/to/repo --dry-run`: preview copied skill directories, config install, and `.gitignore` updates for an already initialized OpenSpec repo.
- `openspec-extensions install --target-repo /path/to/repo --force --force-config`: overwrite existing installed skills and config in a target repo.

## Coding Style & Naming Conventions
Follow the existing layout and naming exactly so installed relative paths remain valid. Use `openspec-*` kebab-case for skill directories, keep TypeScript sources under `src/`, and use concise Markdown filenames such as `SKILL.md` plus focused reference docs under `references/`. Keep JSON templates compact and readable with 2-space indentation.

## Testing Guidelines
Validate changes with the standard TS pipeline: `npm run lint`, `npm run type-check`, `npm test`, and `npm run build`. For packaging or installer edits, also run `npm run smoke:package` and verify install behavior against a disposable target repo, including overwrite flows (`--force`, `--force-config`) and idempotent `.gitignore` handling. For skill content updates, confirm referenced relative paths still resolve after installation under `.codex/skills/`.

## Commit & Pull Request Guidelines
Use Conventional Commit style consistent with repo history, for example `feat(openspec): add worker recovery reference`. Keep commits focused on one extension or installer change. PRs should describe the user-visible effect, list commands used for verification, and mention any target-repo impact such as new installed files, config keys, or overwrite behavior. Include sample command output when changing installer semantics.
