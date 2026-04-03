# TypeScript Runtime Cutover Notes

## Current Status

- Standard runtime path is now `openspec-extensions ...`.
- User-facing docs, skills, and generated dispatch command text have been cut over to the TS CLI.
- The repository no longer ships Python installers, Python helper scripts, or Python-side tests.
- `openspec-ex init` is now the preferred one-shot entrypoint for fresh target repos.
- `npm run smoke:package` now validates the built tarball through:
  - `npm pack --json`
  - `npx --yes --package <tgz> openspec-ex init <repo> --dry-run`
  - `npx --yes --package <tgz> openspec-extensions install --dry-run`
  - `npm install <tgz>` followed by the installed `openspec-extensions` bin

## Upgrade Guidance

- Node `>=20` is now the only runtime prerequisite for installation and execution.
- Fresh target repos should use `openspec-ex init` from the repo root, or `openspec-extensions init <repo>` when scripting with an explicit path. The command tries `openspec init` first and falls back to `npx --yes @fission-ai/openspec@1.2.0 init`. Pass `--openspec-tools <tools>` only when you need to pin the upstream OpenSpec tool selection.
- Extension skill installs now follow the skill roots already configured by OpenSpec (for example `.claude/skills` or `.codex/skills`) instead of assuming Codex.
- The fallback package version is pinned intentionally so OpenSpec upgrades happen as an explicit compatibility decision instead of silently tracking `latest`.
- Existing target repos should upgrade through `openspec-extensions install --target-repo <repo>` and, when replacing an older install, use `--force` so legacy Python skill directories are removed.
- No workflow should depend on `python3 <toolDir>/skills/...` command paths anymore.

1. Ensure Node `>=20`.
2. Install or expose the CLI through the package path you plan to ship.
3. For a fresh repo, run:

```bash
cd /path/to/target-repo
openspec-ex init
```

4. For an already initialized OpenSpec repo, run:

```bash
openspec-extensions install --target-repo /path/to/target-repo
```

5. For a non-destructive check first, use:

```bash
openspec-extensions install --target-repo /path/to/target-repo --dry-run
```

6. In this source repository, run `npm run smoke:package` before release or handoff.

## Rollback Path

- Artifact schemas are unchanged in this migration, so no artifact migration or backfill is required for rollback.
- If a release candidate regresses, pin the previous known-good package or source-repo commit and rerun:

```bash
openspec-extensions install --target-repo /path/to/target-repo --force --force-config
```

- If you must roll back before reinstalling, use the previous package version or commit; there is no separate Python fallback layer in the current package anymore.
