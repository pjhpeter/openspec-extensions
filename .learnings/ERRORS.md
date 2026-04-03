## [ERR-20260403-001] zsh_retry_loop_status_variable

**Logged**: 2026-04-03T16:25:00+08:00
**Priority**: low
**Status**: pending
**Area**: infra

### Summary
在 `zsh` 里把 `status` 当作普通变量使用会失败，因为它是只读特殊变量。

### Error
```text
zsh:1: read-only variable: status
```

### Context
- Command/operation attempted: 用 shell 循环轮询 `npm view openspec-extensions version dist-tags --json`
- Input or parameters used: `for i in ...; do ...; status=$?; ...; done`
- Environment details if relevant: 仓库默认 shell 是 `zsh`

### Suggested Fix
在 `zsh` 脚本里不要复用 `status` 作为临时变量名，改用 `exit_code`、`rc` 等普通变量。

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md

---
