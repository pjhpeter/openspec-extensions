# TypeScript Runtime Cutover Notes

## Current Status

- Standard runtime path is now `openspec-extensions ...`.
- User-facing docs, skills, and generated dispatch command text have been cut over to the TS CLI.
- The repository no longer ships Python installers, Python helper scripts, or Python-side tests.
- `npm run smoke:package` now validates the built tarball through:
  - `npm pack --json`
  - `npx --yes --package <tgz> openspec-extensions install --dry-run`
  - `npm install <tgz>` followed by the installed `openspec-extensions` bin

## Upgrade Guidance

- Node `>=20` is now the only runtime prerequisite for installation and execution.
- Existing target repos should upgrade through the TS installer and, when replacing an older install, use `--force` so legacy Python skill directories are removed.
- No workflow should depend on `python3 .codex/skills/...` command paths anymore.

1. Ensure Node `>=20`.
2. Install or expose the CLI through the package path you plan to ship.
3. Run:

```bash
openspec-extensions install --target-repo /path/to/target-repo
```

4. For a non-destructive check first, use:

```bash
openspec-extensions install --target-repo /path/to/target-repo --dry-run
```

5. In this source repository, run `npm run smoke:package` before release or handoff.

## Rollback Path

- Artifact schemas are unchanged in this migration, so no artifact migration or backfill is required for rollback.
- If a release candidate regresses, pin the previous known-good package or source-repo commit and rerun:

```bash
openspec-extensions install --target-repo /path/to/target-repo --force --force-config
```

- If you must roll back before reinstalling, use the previous package version or commit; there is no separate Python fallback layer in the current package anymore.
