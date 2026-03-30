# OpenSpec Extensions

集中管理 OpenSpec `issue-mode` 扩展 skills 的仓库。

这个仓库的目标很明确：

- 用自然语言驱动 OpenSpec，而不是要求用户背 slash command
- 把复杂变更拆成 issue，并把 backlog / round / acceptance 放到磁盘
- 以 subagent 或 subagent-team 作为唯一推荐执行主链
- 由 coordinator 负责 reconcile、review、merge、commit、verify、archive

这里不再保留 detached worker、heartbeat、monitor-worker 这一套 fallback runtime。

## 仓库里有什么

```text
.
├── README.md
├── scripts/
│   └── install_openspec_extensions.py
├── skills/
│   ├── openspec-chat-router/
│   ├── openspec-plan-issues/
│   ├── openspec-dispatch-issue/
│   ├── openspec-execute-issue/
│   ├── openspec-reconcile-change/
│   ├── openspec-subagent-team/
│   └── openspec-shared/
└── templates/
    └── issue-mode.json
```

## Skill 说明

| Skill | 作用 |
| --- | --- |
| `openspec-chat-router` | 自然语言路由到正确的 OpenSpec 阶段 |
| `openspec-plan-issues` | 把已可实现的 change 拆成多个 issue，并生成 issue 文档 |
| `openspec-dispatch-issue` | 为某个 issue 生成 dispatch，并创建或复用 issue worktree |
| `openspec-execute-issue` | 在单个 issue worker context 中执行实现并写进度工件 |
| `openspec-reconcile-change` | 从 `issues/*.progress.json` 和 `runs/*.json` 收敛 coordinator 状态 |
| `openspec-subagent-team` | 用 subagent team 跑整个复杂变更生命周期的开发 / 检查 / 修复 / 审查回合 |
| `openspec-shared` | 提供共享脚本、配置逻辑和 verify 相关能力 |

## 默认执行模型

复杂任务的默认路径是：

1. 主会话把 change 补到 implementation-ready。
2. 主会话做 change 级 spec-readiness review。
3. 用 `plan-issues` 生成 `issues/INDEX.md` 和各个 `ISSUE-*.md`。
4. 主会话做 issue-planning review，确认边界、ownership、依赖和 acceptance。
5. 只为当前 round 已批准的 issue 创建或复用 worktree，并生成 dispatch / team dispatch。
6. 复杂 change 的默认入口就是 subagent team；只有在显式收窄到单个 issue worker 时，才走单 worker subagent。
7. worker 只写 issue-local progress 和 run 工件，不自合并、不自提交。
8. 主会话用 `reconcile` 从磁盘工件收敛状态，并整理 change 级 backlog / round verdict。
9. 主会话 review、merge、commit。
10. 所有必要 issue 都 accept 后，再做 change 级 acceptance，然后进入 `verify` / `archive`。

## 配置契约

当前支持的 `openspec/issue-mode.json` 字段如下：

```json
{
  "worktree_root": ".worktree",
  "validation_commands": ["pnpm lint", "pnpm type-check"],
  "worker_worktree": {
    "mode": "detach",
    "base_ref": "HEAD",
    "branch_prefix": "opsx"
  },
  "rra": {
    "gate_mode": "advisory"
  },
  "subagent_team": {
    "auto_advance_after_design_review": false,
    "auto_advance_after_issue_planning_review": false,
    "auto_advance_to_next_issue_after_issue_pass": false,
    "auto_run_change_verify": false,
    "auto_archive_after_verify": false
  }
}
```

说明：

- `worktree_root`、`worker_worktree.*` 仍是 active 配置
- `validation_commands` 是 issue 默认校验命令
- `worker_worktree` 继续保留，不再作为 fallback 遗留物，而是作为 issue 隔离边界和 coordinator merge 的收敛目录
- `rra.gate_mode` 控制 RRA 这个 change-level control plane 是“给建议”还是“做硬门禁”
  - `advisory`：
    - 继续计算 round backlog / round scope / verify 放行这些 gate
    - 但只把结果写进 dispatch packet 和 reconcile 输出，不直接阻断流程
    - 适合半自动模式，或者你希望 coordinator 可以看到 gate 结论但保留人工裁量的场景
  - `enforce`：
    - 命中 gate 时会把 RRA 结论变成硬约束
    - 例如当前 round 还有 `Must fix now` 未处理，或某个 issue 不在当前 round scope 内，就会直接阻止 dispatch
    - 所有 issue 做完但 round 还没明确放行 verify 时，也会强制下一步先回到 change-level acceptance
    - 适合全自动模式，或者你希望整个生命周期严格服从 round contract 的场景
  - 可以把它理解成：
    - `advisory` = 红灯会提示，但不会强制拦车
    - `enforce` = 红灯就是红灯，不满足条件就不能继续
- `subagent_team.*` 控制 subagent team 是否自动跨 phase 推进：
  - `auto_advance_after_design_review`：spec-readiness 通过后自动进入 issue planning
  - `auto_advance_after_issue_planning_review`：issue planning 通过后自动派发当前 round 的 issue
  - `auto_advance_to_next_issue_after_issue_pass`：单个 issue 审查通过后自动进入下一个 issue 或 change acceptance
  - `auto_run_change_verify`：change acceptance 通过后自动进入 verify
  - `auto_archive_after_verify`：verify 通过后自动进入 archive
- `subagent_team.*` 不负责决定默认入口拓扑：
  - issue-mode 下，coordinator 默认入口就是 `openspec-subagent-team`
  - 单 worker issue path 只在显式收窄到一个 issue worker 时使用
- runtime 会基于这些值派生一个 automation profile：
  - `semi_auto`：`rra.gate_mode=advisory` 且五个 `subagent_team` 开关全为 `false`
  - `full_auto`：`rra.gate_mode=enforce` 且五个 `subagent_team` 开关全为 `true`
  - `custom`：其余任意组合

## 配置示例

### 半自动配置

适合需要人工查看设计文档、人工确认 issue planning、人工决定 verify / archive 的项目。

```json
{
  "worktree_root": ".worktree",
  "validation_commands": ["pnpm lint", "pnpm type-check"],
  "worker_worktree": {
    "mode": "detach",
    "base_ref": "HEAD",
    "branch_prefix": "opsx"
  },
  "rra": {
    "gate_mode": "advisory"
  },
  "subagent_team": {
    "auto_advance_after_design_review": false,
    "auto_advance_after_issue_planning_review": false,
    "auto_advance_to_next_issue_after_issue_pass": false,
    "auto_run_change_verify": false,
    "auto_archive_after_verify": false
  }
}
```

说明：

- spec-readiness review 通过后会暂停，等待 coordinator 人工确认，再进入 issue planning
- issue-planning review 通过后会暂停，等待 coordinator 人工确认后再派发 issue
- 单个 issue 审查通过后会暂停，等待 coordinator 决定是否派发下一 issue
- change acceptance 通过后会暂停，等待 coordinator 决定是否运行 verify
- verify 通过后会暂停，等待 coordinator 决定是否 archive
- RRA gate 会持续给出 round backlog / round scope / verify 放行建议，但不会硬性阻断流程
- `worker_worktree` 继续保留，作为 issue 隔离边界和 coordinator merge 的收敛目录

### 全自动配置

适合目标是“真正无人值守推进整个复杂变更生命周期”的项目。这里的关键不是去掉 coordinator，而是让 coordinator 根据 `subagent_team.*` 开关自动跨阶段推进。

```json
{
  "worktree_root": ".worktree",
  "validation_commands": ["pnpm lint", "pnpm type-check"],
  "worker_worktree": {
    "mode": "detach",
    "base_ref": "HEAD",
    "branch_prefix": "opsx"
  },
  "rra": {
    "gate_mode": "enforce"
  },
  "subagent_team": {
    "auto_advance_after_design_review": true,
    "auto_advance_after_issue_planning_review": true,
    "auto_advance_to_next_issue_after_issue_pass": true,
    "auto_run_change_verify": true,
    "auto_archive_after_verify": true
  }
}
```

说明：

- `rra.gate_mode=enforce` 让全自动推进仍然服从 round contract，而不是无条件往下跑
- `subagent_team` 现在已经覆盖：
  - design review 通过后自动进入 issue planning
  - issue planning review 通过后自动派发当前 round 的 issue
  - 单个 issue 审查通过后自动进入下一个 issue 或 change acceptance
  - change acceptance 通过后自动进入 verify
  - verify 通过后自动 archive
- coordinator 仍然存在，只是不再需要在每个 review gate 之间人工点下一步
- 如果 RRA gate 不允许继续，流程会回到 change-level control，而不是盲目前推

## 安装到目标项目

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project
```

预览安装结果：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --dry-run
```

覆盖已有同名 skills：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --force
```

覆盖已有的 `openspec/issue-mode.json`：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --force-config
```

安装器会写入：

- `.codex/skills/openspec-chat-router`
- `.codex/skills/openspec-plan-issues`
- `.codex/skills/openspec-dispatch-issue`
- `.codex/skills/openspec-execute-issue`
- `.codex/skills/openspec-reconcile-change`
- `.codex/skills/openspec-subagent-team`
- `.codex/skills/openspec-shared`
- `openspec/issue-mode.json`

并在需要时向目标项目 `.gitignore` 追加：

```text
.worktree/
openspec/changes/*/runs/CHANGE-VERIFY.json
```

## 当前状态

现在这套扩展的稳定执行模型是：

- 主链只有 coordinator + subagents
- `worker_worktree` 作为 issue 边界与 merge 隔离层继续保留
- 复杂 change 在 issue-mode 下默认从 `openspec-subagent-team` 入口进入；单 worker path 是特例，不是默认入口
- `subagent_team.*` 覆盖 `spec_readiness -> issue_planning -> issue_execution -> change_acceptance -> verify -> archive` 全流程
- 通过 `openspec/issue-mode.json` 可以切换 `semi_auto`、`full_auto` 或自定义混合模式
