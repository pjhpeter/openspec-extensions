# OpenSpec Extensions

集中管理 OpenSpec `issue-mode` 扩展 skills 的仓库。

这些扩展不是替代原生 OpenSpec，而是在已有 `change -> proposal/design/tasks -> apply -> verify -> archive` 工作流之上，补齐一套适合复杂任务的 coordinator + worker 多会话执行模式：

- 自然语言入口，不要求用户记 slash command
- change 拆分为可并行 issue
- coordinator 创建或复用 issue worktree，并生成派发工件
- 默认由主会话直接拉起单 issue subagent
- issue 进度与 run 工件落盘
- coordinator 从磁盘工件收敛、review、merge、commit
- detached worker 监控、heartbeat、worker launch 作为显式 fallback

## 仓库里有什么

```text
.
├── README.md
├── scripts/
│   ├── install_openspec_extensions.py
│   ├── openspec_coordinator_heartbeat.py
│   ├── openspec_coordinator_heartbeat_start.py
│   ├── openspec_coordinator_heartbeat_status.py
│   ├── openspec_coordinator_heartbeat_stop.py
│   ├── openspec_coordinator_tick.py
│   ├── openspec_worker_launch.py
│   └── openspec_worker_status.py
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
| `openspec-dispatch-issue` | 为某个 issue 生成 dispatch，创建或复用 worktree，并可直接作为 subagent handoff 来源 | `给我 ISSUE-001 的 worker 模板`、`直接开 subagent 做 ISSUE-001` |
| `openspec-execute-issue` | 在单个 worker context 中只执行一个 issue，并写进度工件 | `本会话只处理 ISSUE-001` |
| `openspec-monitor-worker` | 观察 detached/background worker 是否还活着、做到哪一步 | `看看 worker1 还活着吗` |
| `openspec-reconcile-change` | 从 `issues/*.progress.json` 和 `runs/*.json` 收敛 coordinator 状态 | `同步 worker 进度` |
| `openspec-shared` | 提供共享脚本、heartbeat、coordinator tick、worker launch/status 与配置逻辑 | 被其他扩展 skill 复用 |

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

扩展 skill 的定位是：把复杂实现从“单会话硬做完”改成“主会话协调，多个单 issue worker context 按工件推进”，并且在支持 delegation 的运行时里默认优先 `subagent-first`。

## 默认执行模型

复杂任务的默认路径是：

1. 主会话先把 change 补到 implementation-ready。
2. 用 `openspec-plan-issues` 生成 `issues/INDEX.md` 和每个 `ISSUE-*.md`。
3. 用 `openspec-dispatch-issue` 创建或复用 issue worktree，并从 issue 文档渲染 dispatch。
4. 如果运行时支持 delegation，主会话直接拉起一个只处理该 issue 的 subagent。
5. worker 按 `openspec-execute-issue` 写 `issues/*.progress.json` 和 `runs/*.json`。
6. 主会话用 `openspec-reconcile-change` 从磁盘工件收敛状态。
7. 主会话 review、merge、commit，然后再进入 `verify` / `archive`。

只有当你明确希望后台脱机继续执行、主动轮询通知、或者恢复 detached worker 时，才进入 heartbeat / monitor / worker launch 这些 fallback 路径。

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
- `scripts/openspec_coordinator_tick.py`
- `scripts/openspec_worker_launch.py`
- `scripts/openspec_worker_status.py`

并在需要时向目标项目 `.gitignore` 追加：

```text
.worktree/
openspec/changes/*/runs/COORDINATOR-HEARTBEAT.state.json
openspec/changes/*/runs/COORDINATOR-HEARTBEAT.exec.log
openspec/changes/*/runs/ISSUE-*.worker-session.json
openspec/changes/*/runs/RUN-*.worker.exec.log
openspec/changes/*/runs/RUN-*.worker.last-message.txt
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

### 3. 大任务：默认走 subagent-first issue-mode

如果实现会跨多个模块、需要并行、或者单会话太长，推荐：

```text
new -> ff -> plan-issues -> dispatch-issue -> reconcile/review -> verify -> archive
```

推荐节奏：

1. 主会话把 `proposal / design / tasks` 补齐到可实现状态
2. 用 `openspec-plan-issues` 生成 `issues/INDEX.md` 和每个 `ISSUE-*.md`
3. 用 `openspec-dispatch-issue` 为某个 issue 生成 dispatch，并创建或复用该 issue worktree
4. 优先让主会话直接拉起一个只处理该 issue 的 subagent
5. worker 写 `progress.json` 和 `RUN-*.json`
6. 主会话用 `openspec-reconcile-change` 收敛状态，review 通过后 merge / commit
7. 只有当你明确需要后台自动化或 detached worker 时，再启用 heartbeat / monitor / worker launch

### 4. 后台自动化：只在显式需要时开启

这些路径不是默认主链，只在下面场景使用：

- 希望主会话退出后，流程继续后台跑
- 希望 coordinator 定时轮询并主动通知
- 希望自动派发或自动拉起下一个 detached worker
- 希望恢复一个看起来已经卡住或脱离主会话的 worker

## 可直接复制的话术模板

README 里的话术按四层理解最不容易乱：

### 1. 模式入口

- `进入 openspec 模式`
- `给我 openspec 话术模板`
- `按 issue 模式继续`
- `按 issue 模式继续 <change-name>`
- `继续刚才那个 change`

### 2. 主会话话术

这些话术适合 coordinator 主会话：

- `把 <change-name> 的文档补齐到可以开始做`
- `把 <change-name> 拆成可并行的 issue，并生成 issue 文档`
- `为 <issue-id> 生成 dispatch，并创建或复用 worker worktree`
- `为 <issue-id> 准备 dispatch，并直接开一个 subagent 执行`
- `收敛 <change-name> 当前 issue 状态，并决定下一步`
- `验证 <change-name> 是否可以归档`
- `把 <change-name> 的 delta spec 同步到主 spec`
- `归档 <change-name>`

### 3. 单 issue worker / subagent 话术

如果 issue 文档已经存在，通常这两句就够了：

- `执行 ISSUE-001`
- `本会话只处理 ISSUE-001`

如果你要手工复制一段完整上下文给 subagent 或外部 worker，可以用下面这个模板：

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

### 4. 后台自动化话术

这组只在你明确要 detached/background automation 时使用：

- `开启 <change-name> 的 coordinator heartbeat，有结果就通知我`
- `启动 <change-name> 的 heartbeat`
- `看看 <change-name> 的 heartbeat 状态`
- `停止 <change-name> 的 heartbeat`
- `看看 ISSUE-001 的 detached worker 还活着吗`

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

下面这些命令只服务于 fallback 的后台自动化路径。
默认的 subagent-first issue-mode 不要求 heartbeat 常驻。

安装后，目标项目可以直接运行：

```bash
python3 scripts/openspec_coordinator_heartbeat.py \
  --change <change-name>
```

如果你希望单次执行一轮收敛，而不是启动常驻 heartbeat：

```bash
python3 scripts/openspec_coordinator_tick.py \
  --change <change-name>
```

如果你希望 heartbeat 在判断出下一步只是机械动作时自动生成派发工件：

```bash
python3 scripts/openspec_coordinator_heartbeat.py \
  --change <change-name> \
  --auto-dispatch-next
```

如果你希望 heartbeat 在判定出 `dispatch_next_issue` 时直接启动下一个 detached worker：

```bash
python3 scripts/openspec_coordinator_heartbeat.py \
  --change <change-name> \
  --auto-launch-next
```

如果你想让 heartbeat 挂在常驻 `screen` 里：

```bash
python3 scripts/openspec_coordinator_heartbeat_start.py \
  --change <change-name>
```

常驻模式下同样可以开启自动启动：

```bash
python3 scripts/openspec_coordinator_heartbeat_start.py \
  --change <change-name> \
  --auto-launch-next
```

如果你只想人工预览下一次 detached worker 启动参数：

```bash
python3 scripts/openspec_worker_launch.py \
  --change <change-name> \
  --issue-id ISSUE-001 \
  --dry-run
```

如果你想看某个 detached worker 当前是否处于 `launching` / `running` / `failed` / `orphaned`：

```bash
python3 scripts/openspec_worker_status.py \
  --change <change-name> \
  --issue-id ISSUE-001
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
    "notify_topic": "",
    "auto_dispatch_next": true,
    "auto_launch_next": false
  },
  "worker_launcher": {
    "session_prefix": "opsx-worker",
    "start_grace_seconds": 120,
    "launch_cooldown_seconds": 30,
    "max_launch_retries": 1,
    "codex_bin": "codex",
    "sandbox_mode": "danger-full-access",
    "bypass_approvals": true,
    "json_output": true
  }
}
```

它用于提供仓库级默认值，例如：

- worker worktree 根目录
- 默认校验命令
- monitoring 查找 Codex 会话日志的位置
- 持久宿主类型：`screen` / `tmux` / `none`
- coordinator heartbeat 的轮询频率、stale 判定与默认通知 topic
- coordinator heartbeat 是否自动 dispatch / 自动 launch 下一个 worker
- worker launch 的 session 前缀、启动确认宽限期、失败重试节流与 Codex 启动参数

`persistent_host`、`coordinator_heartbeat` 和 `worker_launcher` 这些字段主要服务于 detached/background 路径。
默认的 subagent-first 主链通常不会直接用到它们。

当前模板里：

- `auto_dispatch_next=true`
- `auto_launch_next=false`

也就是 heartbeat 路径默认会自动准备下一轮 dispatch，但不会默认自动拉起新的 detached worker。要做到真正无人值守，请显式开启 `auto_launch_next`。

建议 issue 文档里仍然显式写出 `worker_worktree` 和 `validation`，不要完全依赖默认值推断。

## 建议的使用方式

- 小任务直接走原生 OpenSpec，不必强行拆 issue
- 大任务先把 change 文档补齐，再切 issue，不要一边做一边临时发散
- 默认优先一个 subagent 只做一个 issue，不要在同一 worker context 里并发处理多个 issue
- 主会话在继续推进前，先跑一次 reconcile，不要靠聊天上下文猜当前状态
- 真正的流程状态以 `issues/*.progress.json` 和 `runs/*.json` 为准；`worker-session.json` 只负责 detached launch 的 coordinator 侧 lease 与恢复

## Notes

- 这是扩展仓库，不包含原生 OpenSpec CLI 或原生 `openspec-apply-change` 等技能
- 各 skill 内的相对引用按同级目录组织，安装后落到目标项目 `.codex/skills/` 下继续工作
- `openspec-shared` 里的脚本为其他扩展 skills 提供共享配置与安装逻辑
