# OpenSpec Extensions

集中管理 OpenSpec `issue-mode` 扩展 skills 的仓库。

这些扩展不是替代原生 OpenSpec，而是在已有 `change -> proposal/design/tasks -> apply -> verify -> archive` 工作流之上，补齐一套适合复杂任务的 coordinator + worker 多会话执行模式：

- 自然语言入口，不要求用户记 slash command
- change 拆分为可并行 issue
- 单 issue worker 会话边界约束
- worker 进度与 run 工件落盘
- coordinator 收敛 issue 状态
- worker 存活监控与恢复
- coordinator heartbeat 主动轮询 / 通知

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
│   ├── openspec-monitor-worker/
│   ├── openspec-reconcile-change/
│   └── openspec-shared/
└── templates/
    └── issue-mode.json
```

## 这些 skill 分别做什么

| Skill | 作用 | 典型话术 |
| --- | --- | --- |
| `openspec-chat-router` | 自然语言路由到正确的 OpenSpec 阶段 | `进入 openspec 模式`、`按 issue 模式继续` |
| `openspec-plan-issues` | 把已可实现的 change 拆成多个 issue，并生成 issue 文档 | `把这个 change 拆成 issue` |
| `openspec-dispatch-issue` | 为某个 issue 生成 worker dispatch，并创建或复用 worktree | `给我 ISSUE-001 的 worker 模板` |
| `openspec-execute-issue` | 在 worker 会话中只执行一个 issue，并写进度工件 | `本会话只处理 ISSUE-001` |
| `openspec-monitor-worker` | 看 worker 是否还活着、做到哪一步 | `看看 worker1 还活着吗` |
| `openspec-reconcile-change` | 从 `issues/*.progress.json` 和 `runs/*.json` 收敛 coordinator 状态 | `同步 worker 进度` |
| `openspec-shared` | 提供共享脚本、heartbeat 与配置逻辑 | 被其他扩展 skill 复用 |

## 前置依赖

这个仓库只提供扩展 skill，不包含原生 OpenSpec CLI 或基础 skills。目标项目里仍应具备原生流程能力，例如：

- `explore`
- `propose`
- `new`
- `ff`
- `continue`
- `apply`
- `verify`
- `sync-specs`
- `archive`

扩展 skill 的定位是：把复杂实现从“单会话硬做完”改成“主会话协调，多个 worker 会话按 issue 落地”。

## 安装到目标项目

把本仓库的扩展 skills 安装到目标项目：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project
```

先预览安装结果：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --dry-run
```

覆盖目标项目已有的同名 skills：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --force
```

覆盖目标项目已有的 `openspec/issue-mode.json`：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --force-config
```

安装器会写入：

- `.codex/skills/openspec-*`
- `.codex/skills/openspec-shared`
- `openspec/issue-mode.json`
- `scripts/openspec_coordinator_heartbeat.py`
- `scripts/openspec_coordinator_heartbeat_start.py`
- `scripts/openspec_coordinator_heartbeat_status.py`
- `scripts/openspec_coordinator_heartbeat_stop.py`

并在需要时向目标项目 `.gitignore` 追加：

```text
.worktree/
openspec/changes/*/runs/COORDINATOR-HEARTBEAT.state.json
openspec/changes/*/runs/COORDINATOR-HEARTBEAT.exec.log
```

如果要在安装时一并写入 heartbeat 默认通知配置：

```bash
python3 scripts/install_openspec_extensions.py \
  --target-repo /path/to/your/project \
  --notify-topic pjh-codex-task \
  --heartbeat-interval-seconds 60 \
  --heartbeat-stale-seconds 900
```

## 安装后怎么用

### 1. 先用自然语言进入 OpenSpec

安装后，优先从 `openspec-chat-router` 进入。用户不需要记命令名，直接说话即可。

常用入口话术：

- `进入 openspec 模式`
- `给我 openspec 话术模板`
- `按 issue 模式继续`
- `列出当前 change`
- `继续刚才那个 change`

其中：

- `进入 openspec 模式` 会先打印一份“自然语言话术模板 <-> OpenSpec 阶段”的速查表
- `按 issue 模式继续` 会先打印 coordinator / worker 双会话模板

### 2. 小任务：还是走原生 OpenSpec

如果任务不复杂，推荐继续使用原生流：

```text
propose -> apply -> archive
```

可直接这样说：

- `帮我起一个变更，把文档一次性补齐`
- `开始实现当前变更`
- `检查一下当前变更能不能归档`

### 3. 大任务：先补齐 change，再切 issue

如果实现会跨多个模块、需要并行、或者单会话太长，推荐：

```text
new -> ff -> plan-issues -> dispatch-issue -> execute-issue -> reconcile -> verify -> archive
```

推荐节奏：

1. 主会话把 `proposal / design / tasks` 补齐到可实现状态
2. 用 `openspec-plan-issues` 生成 `issues/INDEX.md` 和每个 `ISSUE-*.md`
3. 用 `openspec-dispatch-issue` 为某个 issue 生成 worker dispatch
4. 新开一个 worker 会话，只执行这一个 issue
5. worker 写 `progress.json` 和 `RUN-*.json`
6. 主会话用 `openspec-reconcile-change` 收敛状态，决定下一步
7. 如果希望主会话自动轮询并通知，启动 `scripts/openspec_coordinator_heartbeat.py`
8. 如果希望常驻 `screen` 托管，用 `start/status/stop` 三个脚本管理 heartbeat

## 可直接复制的话术模板

### 通用 OpenSpec 入口

| 自然语言话术 | 路由结果 |
| --- | --- |
| `帮我梳理一下这个需求` | `explore` |
| `帮我起一个变更，把文档补齐` | `propose` |
| `先建个 change，我想先看模板` | `new` |
| `把当前 change 的文档补齐到可以开始做` | `ff` |
| `继续刚才那个 change` | `continue` |
| `开始实现当前变更` | `apply` |
| `检查一下当前变更能不能归档` | `verify` |
| `把这个 change 的 delta spec 同步到主 spec` | `sync-specs` |
| `这个变更做完了，帮我归档` | `archive` |

### issue-mode coordinator 话术

这些话术适合主会话：

- `把 <change-name> 拆成可并行的 issue，并给出每个 issue 的边界和验收标准`
- `为 <change-name> 生成 issues/INDEX.md 和每个 issue 文档`
- `为 ISSUE-001 生成 worker dispatch 模板`
- `给 ISSUE-001 创建 worker worktree`
- `同步 <change-name> 当前所有 worker 的 issue 状态，并决定下一步`
- `看看 worker1 还活着吗`
- `开启 <change-name> 的 coordinator heartbeat，有结果就通知我`
- `启动 <change-name> 的 heartbeat`
- `看看 <change-name> 的 heartbeat 状态`
- `停止 <change-name> 的 heartbeat`

### worker 新会话模板

下面这段可以直接发给新的 worker 会话：

```text
继续 OpenSpec change `<change-name>`，执行单个 issue。

本会话只处理一个 issue：
- Issue: `ISSUE-001`
- Allowed scope:
  - `src/example/path.ts`
- Out of scope:
  - `electron/`
- Done when:
  - 验收条件 1
  - 验收条件 2
```

如果 issue 文档已经存在，也可以直接说：

- `执行 ISSUE-001`
- `本会话只处理 ISSUE-001`

## issue-mode 的工件约定

复杂任务进入 issue-mode 后，推荐目录如下：

```text
openspec/changes/<change-name>/
├── tasks.md
├── issues/
│   ├── INDEX.md
│   ├── ISSUE-001.md
│   ├── ISSUE-001.dispatch.md
│   ├── ISSUE-001.progress.json
│   └── ISSUE-002.progress.json
└── runs/
    ├── RUN-20260325T103000-ISSUE-001.json
    └── RUN-20260325T111500-ISSUE-002.json
```

关键规则：

- coordinator 负责 `tasks.md`、`verify`、`archive`
- worker 一次只处理一个 issue
- worker 不要直接改 `tasks.md`
- 真正的流程状态以 `issues/*.progress.json` 为准，不以聊天记录为准

## coordinator heartbeat

安装后，目标项目可以直接运行：

```bash
python3 scripts/openspec_coordinator_heartbeat.py \
  --change <change-name>
```

如果你希望 heartbeat 在判断出下一步只是机械动作时自动生成派发工件：

```bash
python3 scripts/openspec_coordinator_heartbeat.py \
  --change <change-name> \
  --auto-dispatch-next
```

如果你想让 heartbeat 挂在常驻 `screen` 里：

```bash
python3 scripts/openspec_coordinator_heartbeat_start.py \
  --change <change-name>
```

查看状态：

```bash
python3 scripts/openspec_coordinator_heartbeat_status.py \
  --change <change-name>
```

停止：

```bash
python3 scripts/openspec_coordinator_heartbeat_stop.py \
  --change <change-name>
```

## `openspec/issue-mode.json`

安装后会带一个默认配置模板：

```json
{
  "worktree_root": ".worktree",
  "validation_commands": [
    "pnpm lint",
    "pnpm type-check"
  ],
  "codex_home": "~/.codex",
  "persistent_host": {
    "kind": "screen"
  },
  "worker_worktree": {
    "mode": "detach",
    "base_ref": "HEAD",
    "branch_prefix": "opsx"
  },
  "coordinator_heartbeat": {
    "interval_seconds": 60,
    "stale_seconds": 900,
    "notify_topic": ""
  }
}
```

它用于提供仓库级默认值，例如：

- worker worktree 根目录
- 默认校验命令
- monitoring 查找 Codex 会话日志的位置
- 持久宿主类型：`screen` / `tmux` / `none`
- coordinator heartbeat 的轮询频率、stale 判定与默认通知 topic

建议 issue 文档里仍然显式写出 `worker_worktree` 和 `validation`，不要完全依赖默认值推断。

## 建议的使用方式

- 小任务直接走原生 OpenSpec，不必强行拆 issue
- 大任务先把 change 文档补齐，再切 issue，不要一边做一边临时发散
- 一个 worker 会话只做一个 issue，不要在同一会话里并发处理多个 issue
- 主会话在继续推进前，先跑一次 reconcile，不要靠聊天上下文猜当前状态

## Notes

- 这是扩展仓库，不包含原生 OpenSpec CLI 或原生 `openspec-apply-change` 等技能
- 各 skill 内的相对引用按同级目录组织，安装后落到目标项目 `.codex/skills/` 下继续工作
- `openspec-shared` 里的脚本为其他扩展 skills 提供共享配置与安装逻辑
