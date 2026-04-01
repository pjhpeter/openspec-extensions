# TypeScript Runtime Cutover Notes

## Current Status

- Standard runtime path is now `openspec-extensions ...`.
- User-facing docs, skills, and generated dispatch command text have been cut over to the TS CLI.
- `npm run smoke:package` now validates the built tarball through:
  - `npm pack --json`
  - `npx --yes --package <tgz> openspec-extensions install --dry-run`
  - `npm install <tgz>` followed by the installed `openspec-extensions` bin

## Compatibility Window

- Python is no longer part of the required runtime for standard usage.
- Python helper scripts are still shipped during the transition window as a compatibility fallback and rollback aid.
- New workflow guidance should target the TS CLI only.
- No new migration work should depend on `python3 .codex/skills/...` command paths.

## Upgrade Guidance

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

- During the compatibility window, installed Python helper scripts remain available as an emergency fallback, but they should not be the documented default path.

## Removal Criteria

Remove the Python fallback layer only after:

- package smoke stays green across at least one stable release cycle
- no required docs still point at Python entrypoints
- rollback guidance has been published and exercised
- no known parity gaps remain in installer, renderers, reconcile, review/verify/archive, worktree, or merge flows
