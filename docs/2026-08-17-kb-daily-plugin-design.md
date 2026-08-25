# dsh-kb-daily 插件设计规格

- 日期：2026-08-17
- 状态：设计已获用户批准（本文件待用户书面审查）
- 范围：DeepSeek Harness 插件 `dsh-kb-daily`，第一阶段（只读每日摘要/索引/日报）

## 背景与目标

用户希望在 DeepSeek Harness 中创建一个插件，每天自动分析和整理本地 Markdown 知识库（如 Obsidian 库）。目标是"打开 dsh 就会补跑今天的分析，日报落盘到知识库，积累成可搜索的档案"。

### 需求决策记录（已确认）

1. **知识库形态**：本地 Markdown 文件/文件夹（Obsidian 风格）。
2. **最终目标四阶段**（YAGNI 拆分，逐阶段交付）：
   - 阶段 1（本规格）：每日摘要/索引/日报 —— 只读扫描 + 写日报文件。
   - 阶段 2：自动归档/打标签（写源文件，需更强审批）。
   - 阶段 3：去重/清理建议清单（由用户确认后执行）。
   - 阶段 4：笔记间关联分析（引用关系、backlinks 建议）。
3. **日报产出位置**：写入知识库内文件 `Daily/YYYY-MM-DD.md`。
4. **使用习惯**：dsh 偶尔打开 → 需要"打开时补跑"。
5. **实现路线**：方案 1 —— 宿主侧补跑检查 + 专用"知识库工作日会话"。
6. **工具作用域**：v1 全局注册（任何会话可用）；后续用 agent preset + `isolate` realm 限定到 kb 会话。
7. **插件存放**：先在仓库 checkout 内作为 `examples/kb-daily` 开发（吃全套构建/测试工具链）；跑通后可抽成独立的 `dsh-plugin` 话题仓库发布。
8. **写盘策略**：默认 `ask`（写日报前走审批询问），可配置 `allow` 自动放行。

## 架构

一个宿主侧插件包 `dsh-kb-daily`（仅 Node 侧，无浏览器半），通过 `cordis.yml` overlay 挂载进现有 web 组合。复用 dsh 已有机制，不触碰任何内核：

- **专用知识库会话**：稳定 id `kb-daily`，依赖 `sessionPersistence` 持久化，重启后可 `resume`；与日常聊天会话完全隔离，随时可打开查看进度、中断、审阅日报。
- **宿主侧逻辑**：打开时补跑检查 + 每小时跨午夜复查定时器（普通 Node 定时器）。
- **模型工具与提示词区段**：注册到 `ctx.tools` / `ctx.systemPrompt`，作用域全局（任何会话都能说"帮我分析下知识库"）。

### 依赖的服务

`ctx.agents`、`ctx.sessions`、`ctx.systemPrompt`、`ctx.tools`、`ctx.sessionPersistence`（resume 所需；缺失时退化为每次新建会话）。LLM 适配器由现有组合提供。

## 组件

| 组件 | 职责 |
|---|---|
| `src/index.ts`（插件入口） | 校验配置（vaultPath 必须存在且可读，否则加载失败）；注册提示词区段与工具；补跑检查；每小时 tick；create/resume 专用 agent 并 `followup()`；in-flight 防并发标志 |
| `src/tools/kb-list-modified.ts` | 只读。入参 `since`（ISO 日期，默认今天）；返回 vaultPath 下 mtime ≥ since 的文件相对路径+大小 |
| `src/tools/kb-read.ts` | 只读。入参相对路径；强制解析后必须仍在 vaultPath 内（防路径穿越），带截断上限 |
| `src/tools/kb-write-report.ts` | 唯一写工具。路径由"今天的日期"计算（`<reportDir>/<yyyy-MM-dd>.md`），不接受模型输入的路径；文件已存在则直接失败（拒绝覆盖）；走标准工具流水线，受审批策略约束 |
| `src/prompt.ts` | 提示词区段（order 约 200）：每日任务说明 + 日报格式（中文、含来源文件相对路径）+ 规则（只读、不修改源文件） |
| 配置 | `vaultPath`、`reportDir`（默认 `Daily`）、`timezone`（默认系统本地）、`agentId`（默认 `kb-daily`）、`provider`/`model`（可选，缺省靠 `agent/request` 补齐）、`writePolicy`（`ask` 默认 / `allow`）、`checkIntervalMs`（默认 60 分钟） |

## 数据流

```
插件加载 ──校验配置──> 注册区段+工具 ──> 计算 todayPath
                                          │ 存在? ──是──> 无事（今天已生成）
                                          └ 否 ──> maybeRun()

maybeRun():
  in-flight 标志检查
  → ctx.agents.get('kb-daily') 已存在? 是 → followup()
  → 否 → resume(resumeSessionId)；失败（首次/无持久化）→ create(sessionId)
  → handle.agent.followup(任务消息)        // 唤醒驱动器

kb-daily agent 回合：
  读提示词区段 → kb_list_modified → kb_read×N → kb_write_report
  → 写盘（已存在则拒）→ 回合结束 → 日报文件生成

每小时 tick：
  重算今天；新的一天且日报缺失 → maybeRun()   // 跨午夜/跨天不遗漏
```

关键机制（均已核实存在于仓库 API）：

- `ctx.systemPrompt.section({ name, order, text })` 注册区段，随调用 fiber 一并 dispose。
- `ctx.agents.create/resume()` 返回 `AgentHandle = { agent, dispose }`；setup 是受信任的组装代码，**只能在创建 resolve 之后驱动 agent**。
- `agent.followup(message)` 将普通 next-turn 消息排队并唤醒驱动器（任务触发用）；`agent.inject()` 不唤醒（v1 不用）。
- 工具经 `ctx.tools` 注册后 schema 自动进入提示词组装。
- 写审批可挂 `tools/pre-execute` 监听器；`kb-write-report` 的执行走标准工具流水线。

## 错误处理

| 场景 | 行为 |
|---|---|
| 配置错误（vaultPath 不存在/不可读） | 插件加载失败，报错信息明确（与其他 dsh 插件一致） |
| create/resume 失败（无持久化后端、无工厂） | 记录日志放弃本次；下个 tick / 重启时重试 |
| 模型/工具失败 | 回合以错误结束、日报未生成；内存 `attemptedToday` 守卫防止**同一天内反复重试骚扰**——失败或审批拒绝后当日不再自动触发，重启或次日自动补（v1 限制） |
| 写盘被拒（审批拒绝/文件已存在） | 工具返回明确结果，绝不覆盖已有日报 |
| 并发触发 | `in-flight` 标志保证单飞；写盘幂等（存在即失败） |
| 安全 | `kb-read` 路径包含性校验；`kb-write-report` 不接受模型指定路径 |

## 测试

- **单测**：
  - 日期/日报路径计算（固定时区）。
  - `kb-read` 路径包含性（`../` 穿越即拒）。
  - `kb-write-report` 拒绝覆盖已存在文件。
  - `kb-list-modified` 用临时目录 fixture 按 mtime 过滤。
- **集成**：用仓库现成的 `llm-mock-server` 组合 headless 运行，mock 模型驱动 kb-daily agent 走完全链路，断言 `Daily/YYYY-MM-DD.md` 生成。
- **手工验证**：`dsh web --patch examples/kb-daily/cordis.yml` 挂上插件，观察 kb-daily 会话与日报文件。

## 已知限制（v1）

- 同一天内失败/被拒后不自动重试（内存守卫），重启或次日自动补。
- 只补当天，不回填错过的历史日期（未来阶段可加 backfill）。
- 写盘依赖审批策略；用户拒绝则当日跳过。
- 专用会话依赖 `sessionPersistence`；无持久化后端时 `resume` 拒绝 → 退化为每次新建会话。
- 日报内容质量取决于模型；插件只保证链路与文件落地。
- "即使 dsh 未打开也要准点执行"不在 v1 范围（dsh 不运行则插件不运行）；如需，未来用 OS 级定时任务启动 headless。

## 未来工作（后续阶段）

- 阶段 2：自动归档/打标签（写源文件，需更强审批）。
- 阶段 3：去重/清理建议清单。
- 阶段 4：笔记关联分析。
- 工具作用域限定到 kb-daily agent（agent preset + `isolate` realm）。
- 回填错过的日期。
- OS 级定时任务启动 headless 实现准点执行。
