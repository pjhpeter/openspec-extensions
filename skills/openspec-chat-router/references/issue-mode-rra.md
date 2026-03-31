# OpenSpec Issue Mode RRA Model

Use this reference when a complex OpenSpec change should be governed by a change-level review, repair, re-review, and acceptance loop instead of chat memory.

`issue-mode` and RRA solve different problems:

- `issue-mode` is the execution plane:
  - issue docs
  - issue team dispatch packets
  - worker workspaces
  - `issues/*.progress.json`
  - `runs/*.json`
  - reconcile
- RRA is the control plane:
  - round target
  - acceptance criteria
  - normalized backlog
  - acceptance verdict
  - next action

Together, they turn a long-running change into a bounded sequence of reviewable rounds.
