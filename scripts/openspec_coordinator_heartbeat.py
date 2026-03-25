#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    runner = repo_root / ".codex" / "skills" / "openspec-shared" / "scripts" / "coordinator_heartbeat.py"
    if not runner.exists():
        print(f"Heartbeat runner not found: {runner}", file=sys.stderr)
        return 1
    command = [sys.executable, str(runner), "--repo-root", str(repo_root), *sys.argv[1:]]
    return subprocess.call(command)


if __name__ == "__main__":
    raise SystemExit(main())
