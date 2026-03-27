# OpenSpec Background Automation

Use this reference only when the user explicitly wants detached/background automation.

Default issue-mode remains subagent-first:

- coordinator creates or reuses the issue worktree
- coordinator dispatches one worker subagent for one issue
- reconcile, review, merge, verify, and archive stay in the coordinator session

Background automation is fallback only. Do not route here just because issue-mode exists.

## When To Use

Use these paths only when the user explicitly asks for one of the following:

- proactive polling
- background automation
- detached worker execution outside the active parent session
- periodic notifications
- heartbeat lifecycle control
- persistent-host worker recovery

## `heartbeat`

If the user asks for proactive polling, heartbeat monitoring,主动通知, or automatic dispatch of obvious next steps, use:

```bash
python3 .codex/skills/openspec-shared/scripts/coordinator_heartbeat.py \
  --repo-root . \
  --change "<change-name>"
```

Use repo defaults from `openspec/issue-mode.json` when present.
Override `--notify-topic`, `--interval-seconds`, `--stale-seconds`, `--auto-dispatch-next`, or `--auto-launch-next` only when the user asked for different behavior.

## `heartbeat-start`

If the user asks to start a persistent heartbeat session, run:

```bash
python3 scripts/openspec_coordinator_heartbeat_start.py \
  --change "<change-name>"
```

Add `--auto-dispatch-next` only when the user explicitly wants automatic dispatch of the next mechanical step.
Add `--auto-launch-next` only when the user explicitly wants heartbeat to launch the next detached worker session as well.

## `heartbeat-status`

If the user asks whether heartbeat is still running or wants the current screen/session state, run:

```bash
python3 scripts/openspec_coordinator_heartbeat_status.py \
  --change "<change-name>"
```

## `heartbeat-stop`

If the user asks to stop the persistent heartbeat session, run:

```bash
python3 scripts/openspec_coordinator_heartbeat_stop.py \
  --change "<change-name>"
```

## `monitor-worker`

If the user asks whether a detached worker is still alive, wants to inspect its current stage, or needs to recover progress from a persistent host, OS processes, Codex session files, or worktree state, prefer `openspec-monitor-worker`.

Rules:

- treat monitoring as fallback observability only
- do not replace artifact-based reconcile with process inspection when `issues/*.progress.json` and `runs/*.json` are current
- prefer normal coordinator reconcile, review, or subagent dispatch when those can move the work forward without detached automation
