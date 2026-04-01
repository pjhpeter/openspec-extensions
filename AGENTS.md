# Repository Guidelines

## Project Structure & Module Organization
This repository packages OpenSpec issue-mode extensions for installation into other projects. Core content lives in [`skills/`](./skills): each `openspec-*` directory contains a `SKILL.md` plus any bundled `scripts/`, `references/`, or agent config files. [`scripts/install_openspec_extensions.py`](./scripts/install_openspec_extensions.py) is the entrypoint that copies these skills into a target repo. [`templates/issue-mode.json`](./templates/issue-mode.json) provides the default `openspec/issue-mode.json` template installed alongside the skills.

## Build, Test, and Development Commands
There is no build step; the repository ships source files directly.

- `openspec-extensions install --help`: show installer options.
- `openspec-extensions install --target-repo /path/to/repo --dry-run`: preview copied skill directories, config install, and `.gitignore` updates.
- `openspec-extensions install --target-repo /path/to/repo --force --force-config`: overwrite existing installed skills and config in a target repo.

## Coding Style & Naming Conventions
Follow the existing layout and naming exactly so installed relative paths remain valid. Use `openspec-*` kebab-case for skill directories, `snake_case.py` for Python helpers, and concise Markdown filenames such as `SKILL.md` and reference docs under `references/`. Python should stay stdlib-only unless the repository adds dependency management later; keep 4-space indentation, type hints, and `pathlib`-based filesystem handling, matching the installer. JSON templates should remain compact and readable with 2-space indentation.

## Testing Guidelines
This repository currently has no dedicated automated test suite. Validate changes by running the installer in `--dry-run` mode first, then against a disposable target repo when behavior changes. For installer edits, verify normal install, overwrite flows (`--force`, `--force-config`), and idempotent `.gitignore` handling. For skill content updates, confirm referenced relative paths still resolve after installation under `.codex/skills/`.

## Commit & Pull Request Guidelines
Use Conventional Commit style consistent with repo history, for example `feat(openspec): add worker recovery reference`. Keep commits focused on one extension or installer change. PRs should describe the user-visible effect, list commands used for verification, and mention any target-repo impact such as new installed files, config keys, or overwrite behavior. Include sample command output when changing installer semantics.
