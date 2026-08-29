# KB Daily 产品优化路线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 KB Daily 从“可运行的 Cordis 插件原型”升级为一个可独立安装、默认安全、可重复运行、能稳定产出本地 Markdown 知识库每日变更摘要的 DSH 社区插件。

**Architecture:** 保留现有的 `apply()`、专用 Agent、`kb_list_modified` / `kb_read` / `kb_write_report` 三工具和 Cordis effect 生命周期。优化分四阶段推进：先完成可发布性与安全基线，再提升摘要质量与成本可控性，然后补齐用户触发/失败恢复/通知，最后扩展到多 vault、历史回填和更深的知识库语义能力。

**Tech Stack:** TypeScript 6、ESM、pnpm、Vitest、Node.js `fs/promises`、Cordis、DeepSeek Harness 公共 `agents` / `tools` / `systemPrompt` / `timer` 服务、GitHub Actions。

**Spec:** `docs/2026-08-17-kb-daily-plugin-design.md`、`docs/2026-08-17-kb-daily-plugin.md`、`docs/superpowers/plans/2026-08-25-kb-daily-marketplace-readiness.md`。

## Global Constraints

- 只读扫描源笔记；唯一写入目标是配置 vault 内的日报目录。
- 默认 `writePolicy` 必须保持 `ask`；不得绕过宿主 `tools/pre-execute` 审批。
- 报告文件名由配置时区的本地日期决定；模型不得提交输出路径。
- 报告创建必须保持独占语义，不覆盖既有日报。
- 所有用户可控路径必须同时通过词法包含性和物理符号链接检查。
- 不引入向量数据库、远程知识库或强制 Python 运行时；本地 Markdown 是第一阶段唯一数据源。
- 所有日期相关测试必须使用固定时钟；禁止依赖执行机器的当前日期。
- 发布前必须通过 typecheck、全量测试、build、pack inspection 和真实 DSH profile smoke test。
- 在产品身份未决定前，不得同时使用 `@deepseek-ai/dsh-kb-daily` 和个人社区包名作为发布名称。
- “自动每日运行”只保证 DSH profile 正在运行时的启动补跑和 timer 检查；OS 级唤醒不属于本插件自身职责。

---

## 1. 产品能力定义

### 1.1 能力陈述

目标用户是使用 Obsidian 或普通 Markdown 文件夹记录研究、学习、项目和工作日志的 DSH 用户。插件在 DSH 启动或跨日检查时发现当天日报缺失，扫描当天修改过的 Markdown 文件，交给独立 Agent 生成中文 Markdown 摘要，并在用户批准后写入 vault 内的固定日报路径。

用户得到的结果不是一个通用 RAG，也不是长期记忆数据库，而是一份可靠的“今天发生了什么”的本地审阅产物。

### 1.2 产品定位

**Local Markdown Vault Daily Change Digest**：面向本地 Markdown vault 的每日变更摘要器。

差异化来自四点组合：

1. 以文件变更为触发条件，而不是依赖用户主动描述任务。
2. DSH 启动后自动补跑，不要求 DSH 在午夜持续运行。
3. 输出是固定路径、可搜索、可 Git 管理的 Markdown 日报。
4. 默认本地处理和审批写盘，不建立外部索引服务。

### 1.3 明确非目标

- 不替代 `dsh-obsidian` 一类完整 Obsidian 文件操作插件。
- 不替代 `dsh-library`、`dsh-kb-rag` 一类全文检索或向量 RAG 插件。
- 不负责自动整理、改写、删除或打标签源笔记。
- 不承诺 DSH 关闭时仍按时运行。
- 不在首个稳定版本支持多个 vault 的复杂编排、跨 vault 关联图或云端同步。

### 1.4 竞品定位依据

截至 2026-08-29，DeepSeek 官方页面将社区插件发现入口指向 GitHub `dsh-plugin` 主题；社区目录存在，但不是官方唯一商店。检索到的相邻能力包括：

| 方案 | 主要能力 | KB Daily 应采取的策略 |
| --- | --- | --- |
| [dsh-daily-digest](https://github.com/JingHao-Leon/dsh-daily-digest) | RSS 聚合并生成每日新闻 Markdown | 不竞争新闻聚合，强调本地 vault 变更 |
| [dsh-period-report](https://github.com/zhengjy01/dsh-period-report) | 从 DSH session 生成日/周/月报告 | 强调“笔记变更日报”，不做 session analytics |
| [dsh-obsidian](https://github.com/gxpppp/dsh-obsidian) | 25 个 Obsidian 工具和交互式编辑 | 保持轻量，只读源笔记、审批写日报 |
| [dsh-obsidian-second-brain](https://github.com/GongYuanCaiJi/dsh-obsidian-second-brain) | 第二大脑、搜索、重组、日常维护 | 不扩张成全套知识管理系统 |
| [dsh-library](https://github.com/PerryLink/dsh-library) | 文档索引、混合检索、引用校验 | 可作为互补能力，而非重复实现 |
| [dsh-agent-memory](https://dsh.pub/en/plugins/dsh-agent-memory/) | vault、daily notes、回顾和持久记忆 | 只聚焦“当天变更摘要”，避免记忆系统重叠 |

## 2. 能力契约

### 2.1 用户可见承诺

- 配置一个绝对 vault 路径即可启动。
- 每个本地日最多自动发起一次日报任务。
- 已存在的日报不会被覆盖。
- 默认写入需要宿主审批。
- 报告列出变更文件的 vault-relative 路径，并给出每个文件的摘要。
- 失败不会写入半成品报告，并且必须能通过日志或手动触发定位失败原因。

### 2.2 运行状态

| 状态 | 进入条件 | 退出条件 |
| --- | --- | --- |
| `disabled` | 插件未加载或配置无效 | 配置验证成功并加载 |
| `waiting` | 今日已有报告，或等待下一个 timer tick | 日期变化且报告缺失 |
| `scheduled` | 报告缺失且当天尚未尝试 | Agent handle 创建/恢复成功，任务进入队列 |
| `awaiting-approval` | Agent 调用 `kb_write_report`，策略为 `ask` | 用户批准或拒绝 |
| `created` | 独占写入成功 | 等待下一本地日 |
| `failed` | Agent、工具、审批或文件操作失败 | 记录原因；允许手动重试或进入下一本地日 |

同日自动去重是默认策略；手动重试必须是显式操作，不能破坏自动任务的幂等性。

### 2.3 数据边界和信任边界

- Agent 只能获得工具返回的 vault-relative 路径和文件内容。
- 模型不能指定报告路径，也不能通过 `kb_write_report` 写入任意文件。
- `vaultPath`、`reportDir`、文件路径和报告内容都需要有大小/格式约束。
- 插件本身以宿主 Node 权限运行；工具审批不是插件进程沙箱，因此 README 必须明确第三方代码风险。
- 符号链接、junction、路径穿越和报告覆盖必须失败关闭。

## 3. 路线总览

| 阶段 | 版本目标 | 核心结果 | 退出标准 |
| --- | --- | --- | --- |
| P0 | `0.1.x` release-ready | 可独立安装、测试全绿、路径安全 | clean checkout 可打包，真实 profile 可加载 |
| P1 | `0.2.x` useful digest | 摘要更可读、成本可控、结果可追溯 | 变更文件、摘要、统计和来源稳定输出 |
| P2 | `0.3.x` operator workflow | 手动触发、重试、通知、可观察 | 用户无需重启即可处理失败和查看状态 |
| P3 | `0.4.x+` ecosystem | 多 vault、历史回填、可选语义能力 | 不破坏 P0/P1 的安全和本地优先契约 |

P0 是发布阻塞项；P1 是让用户愿意每天使用的核心价值；P2/P3 只有在 P1 指标成立后再投入。

## 4. P0：可发布性和安全基线

P0 主要执行现有的 [marketplace readiness 计划](2026-08-25-kb-daily-marketplace-readiness.md)，本文件不重复发明第二套包发布规范。

### Task 1: 统一产品身份和安装契约

**Files:**

- Modify: `package.json`
- Create: `cordis.patch.yml`
- Create: `LICENSE`
- Create: `tests/package.spec.ts`
- Modify: `README.md`
- Modify: `README.zh.md`

**Interfaces:**

- 包必须声明 `dsh.bundle.patch`，并通过 patch 插入实际插件入口。
- npm/Git 安装后必须能由 `dsh plugin --profile <profile> add <spec>` 激活。
- `prepare` 或 `prepack` 必须在干净 checkout 生成 `lib/`。

- [ ] 确认最终包名、GitHub 仓库和兼容的 DSH release train；把决定写入 README compatibility table。
- [ ] 移除与打包文件不一致的 `./src/*` export，保留 `lib` 和类型声明的公开出口。
- [ ] 增加 `dsh.bundle.patch`、`cordis.patch.yml`、MIT `LICENSE`、`homepage`、`bugs` 和社区安装命令。
- [ ] 用 `tests/package.spec.ts` 验证包身份、manifest、patch、LICENSE 和 source export 约束。
- [ ] 在干净临时目录执行 `pnpm pack --dry-run`，确认包含 `lib/`、README、patch、LICENSE，不包含 `src/`、tests、cache 和 node_modules。

### Task 2: 修复确定性和路径安全

**Files:**

- Modify: `src/tools.ts`
- Modify: `src/paths.ts`
- Modify: `src/fs.ts`
- Modify: `tests/tools.spec.ts`
- Modify: `tests/paths.spec.ts`
- Modify: `tests/fs.spec.ts`

**Interfaces:**

- `ToolsConfig` 增加 `now?: () => Date`，生产环境缺省为 `() => new Date()`。
- 增加 `assertNoSymlinkSegments(vaultPath: string, absolutePath: string): Promise<void>`。
- `fs.ts` 导出 `MAX_REPORT_BYTES = 512 * 1024`。

- [ ] 先为 UTC 和 `Asia/Shanghai` 添加固定时钟测试，验证跨日期边界。
- [ ] 在 `readVaultFile` 读取前检查所有已存在路径段是否为符号链接。
- [ ] 在 `writeReport` 的 `mkdir` 前后检查路径，并在写入前再次检查；保留 `{ flag: 'wx' }`。
- [ ] 拒绝 UTF-8 字节数大于 `MAX_REPORT_BYTES` 的报告。
- [ ] 在支持符号链接的平台验证文件链接、目录 junction、路径穿越和覆盖保护。

### Task 3: 建立真实安装和 CI 门禁

**Files:**

- Create: `scripts/smoke-dsh.mjs`
- Create: `tests/packed-exports.spec.ts`
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- `pnpm run verify` 顺序执行 typecheck、test、build、pack inspection 和 `smoke:dsh`。
- smoke test 必须使用临时 `DSH_HOME`、临时 profile 和预先存在的当天日报，不能调用真实模型。

- [ ] 在 tarball 中安装包，并通过 `dsh --profile smoke --dump-config` 断言 `kb-daily` bundle layer 存在。
- [ ] CI 在 Ubuntu 上运行完整验证，以覆盖符号链接回归测试。
- [ ] README 写明当前实际支持的 Node、pnpm 和 DSH 版本，不把未验证版本称为 supported。

## 5. P1：摘要质量、成本和可追溯性

### Task 4: 增加变更范围和预算控制

**Files:**

- Modify: `src/index.ts`
- Modify: `src/tools.ts`
- Modify: `src/fs.ts`
- Modify: `src/prompt.ts`
- Modify: `tests/tools.spec.ts`
- Modify: `tests/fs.spec.ts`
- Modify: `README.md`
- Modify: `README.zh.md`

**Interfaces:**

- 配置新增可选字段：

```ts
maxFiles?: number
maxTotalBytes?: number
maxFileBytes?: number
```

- `kb_list_modified` 返回 `{ files, truncated, totalBytes }`，其中 `truncated` 表示由于预算而未返回全部文件。
- 配置值必须是正整数；达到预算时工具返回稳定错误码或明确的截断字段，不静默丢失范围。

- [ ] 为零文件、恰好达到上限、超过文件数、超过总字节数分别添加测试。
- [ ] 保持文件路径排序，使相同 vault 状态产生稳定输入顺序。
- [ ] prompt 要求 Agent 在报告开头说明扫描范围、文件数量和是否发生截断。
- [ ] README 说明预算不足时报告是不完整摘要，避免用户误认为全量覆盖。

### Task 5: 让报告成为可验证的变更记录

**Files:**

- Modify: `src/prompt.ts`
- Modify: `src/tools.ts`
- Modify: `tests/prompt.spec.ts`
- Modify: `tests/tools.spec.ts`
- Modify: `README.md`
- Modify: `README.zh.md`

**Interfaces:**

报告 Markdown 的稳定结构为：

```md
---
date: YYYY-MM-DD
timezone: Area/Location
source_count: 3
generated_by: dsh-kb-daily
---

# YYYY-MM-DD 知识库日报

## 今日概览
...

## 变更文件
### `notes/example.md`
- 修改时间：...
- 摘要：...
```

- [ ] prompt 强制输出 frontmatter、总览、变更文件逐项摘要和“无变更/发生截断”的明确说明。
- [ ] 工具结果保留 vault-relative path；报告中不得出现未经用户配置的绝对本机路径。
- [ ] 增加报告结构测试，验证模型输出指导的一致性，而不是测试具体模型文案。
- [ ] 后续可选加入内容 hash 或 Git commit 信息，但必须保持无 Git vault 可用。

### Task 6: 提供可选的 Git diff 价值增量

**Files:**

- Create: `src/git.ts`
- Modify: `src/tools.ts`
- Modify: `src/prompt.ts`
- Create: `tests/git.spec.ts`
- Modify: `tests/tools.spec.ts`

**Interfaces:**

- 新工具可命名为 `kb_read_diff`，参数为 vault-relative `path` 和可选 `since`。
- 非 Git vault 返回稳定的 `git_unavailable`，不得让整个日报失败。
- diff 必须有字节数上限和二进制/不可读文件拒绝策略。

- [ ] 先验证 Git vault、非 Git vault、文件无历史、diff 超限四种情况。
- [ ] prompt 仅在工具存在且返回可用 diff 时引用 diff；不能假定所有 vault 有 Git。
- [ ] 将该能力作为 P1 的可选增强，不阻塞基础日报。

## 6. P2：用户操作闭环和可观察性

### Task 7: 增加手动触发和显式重试

**Files:**

- Modify: `src/index.ts`
- Modify: `src/runner.ts`
- Create: `src/status.ts`
- Modify: `tests/runner.spec.ts`
- Modify: `tests/plugin.spec.ts`

**Interfaces:**

- `RunnerControl` 提供：

```ts
interface RunnerControl {
  runNow(): Promise<CheckOutcome>
  retry(date?: string): Promise<CheckOutcome>
  status(): RunnerStatus
}
```

- 自动 runner 继续遵守同日去重；`retry()` 只允许显式调用，并且仍受报告存在检查和 `wx` 写入保护。
- `RunnerStatus` 至少包含 `date`、`state`、`lastAttemptAt`、`lastError` 和 `reportPath`。

- [ ] 为成功、已存在、运行中、失败、显式重试分别添加状态测试。
- [ ] 将 `resume()` 的回退从“捕获所有异常”收窄为可识别的持久化不可用/会话不存在错误。
- [ ] 保证停止插件时取消 timer、等待在途任务、释放插件创建的 Agent handle。

### Task 8: 补齐日志、失败原因和通知边界

**Files:**

- Modify: `src/runner.ts`
- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `tests/runner.spec.ts`

**Interfaces:**

- 日志事件使用固定事件名：`kb-daily.started`、`kb-daily.skipped`、`kb-daily.created`、`kb-daily.failed`、`kb-daily.approval-required`。
- 日志不得包含 API key、完整笔记内容或宿主绝对路径之外不必要的敏感信息。

- [ ] 记录每次任务的 date、文件数、耗时、状态和错误类别。
- [ ] 替换无声的 `.catch(() => undefined)`，改为结构化记录后再隔离错误。
- [ ] 若宿主提供 notification 服务，再以可选适配器发送“日报创建/失败”通知；没有该服务时保持核心插件可运行。

## 7. P3：生态扩展

### Task 9: 多 vault 和配置 profile

**Files:**

- Modify: `src/index.ts`
- Modify: `src/runner.ts`
- Modify: `src/tools.ts`
- Modify: `src/prompt.ts`
- Modify: `tests/plugin.spec.ts`
- Modify: `README.md`
- Modify: `README.zh.md`

**Interfaces:**

- 保持现有单 vault 配置兼容；多 vault 使用显式数组配置，不依赖隐式扫描用户目录。
- 每个 vault 必须拥有独立 `agentId`、`reportDir`、时区和生命周期。

- [ ] 先定义多 vault 的配置 schema 和冲突规则，再实现并发策略。
- [ ] 禁止两个 vault 共享可变 runner 状态或报告锁。
- [ ] 在没有实际多 vault 用户需求前，不把该能力纳入稳定版默认配置。

### Task 10: 历史回填和周期报告

**Files:**

- Create: `src/backfill.ts`
- Modify: `src/runner.ts`
- Modify: `src/tools.ts`
- Create: `tests/backfill.spec.ts`
- Modify: `README.md`

**Interfaces:**

- 历史回填必须是显式操作，例如 `backfill(startDate, endDate)`，默认不执行。
- 每个日期独立检查报告存在性，不能覆盖已有日期。
- 必须设置最大日期跨度和总任务数，防止一次操作产生无限 Agent 任务。

- [ ] 先验证单日回填、已有报告跳过、跨月范围、反向日期和超范围拒绝。
- [ ] 复用 P0 的写入安全和 P1 的预算控制。
- [ ] 若回填成本/复杂度超过用户收益，保留为实验能力，不进入默认 profile。

## 8. 验收指标

以下是建议目标，不是当前已达成的数据；上线后通过匿名本地日志或用户反馈验证。

| 指标 | P0 目标 | P1 目标 | 说明 |
| --- | --- | --- | --- |
| clean checkout 安装成功率 | 100% CI smoke | 100% | 不能依赖开发机残留 `lib/` |
| 测试通过率 | 100% | 100% | 日期、路径和审批回归必须稳定 |
| 日报重复/覆盖率 | 0 次覆盖 | 0 次覆盖 | 由 `wx` 和报告存在检查共同保证 |
| 当日成功产出率 | 有日志可追踪 | 建议 ≥95% | 需区分模型、审批、文件错误 |
| 报告完整性 | 文件清单可验证 | ≥95% 无预算截断 | 预算截断必须显式提示 |
| 典型日报耗时 | 可测量 | 建议 p95 < 2 分钟 | 取决于文件数和模型路由 |
| 单日报告成本 | 可测量 | 用户可配置上限 | 通过文件/字节预算控制 |
| 手动恢复成功率 | P2 建立基线 | 建议 ≥90% | 失败后无需重启 DSH |

## 9. 发布门禁

进入社区市场前必须满足：

- [ ] 包名、仓库、README、LICENSE 和 patch manifest 身份一致。
- [ ] `pnpm install --frozen-lockfile` 在干净环境通过。
- [ ] `pnpm run verify` 通过。
- [ ] `pnpm pack --dry-run` 内容符合 allowlist。
- [ ] tarball 在临时 DSH profile 中出现正确 bundle layer。
- [ ] `writePolicy: ask` 和 `allow` 均有回归测试。
- [ ] 词法穿越、符号链接、junction、超大报告和报告覆盖均有测试。
- [ ] README 给出绝对 vault 路径、权限风险、审批行为、兼容版本和卸载方式。
- [ ] 至少提供一个脱敏演示：修改笔记 → Agent 扫描 → 审批 → 日报创建 → 第二次调用不覆盖。
- [ ] 社区目录提交时明确标注“非官方项目”，不要暗示 DeepSeek 官方背书。

## 10. 未决产品决策

这些问题必须在 P0 发布前由项目维护者明确，不应由实现者自行猜测：

1. 最终包身份是官方命名空间 `@deepseek-ai/dsh-kb-daily`，还是个人社区命名空间？
2. 首个社区发布目标兼容 DSH `rc.7`、`rc.8`，还是固定某一个经过 smoke test 的版本？
3. 报告默认语言是否永久固定为中文，还是增加 `reportLanguage` 配置？
4. “当天修改”应以文件 mtime 为唯一标准，还是在 Git vault 中优先使用 commit diff？
5. 用户拒绝审批后，是否允许同日通过手动命令再次申请？本计划建议允许显式重试，但不自动重试。
6. P1 是否需要跨文件主题归纳，还是保持逐文件摘要以控制 token 和可验证性？
7. 是否接受可选 notification 服务作为 P2 依赖，还是只提供 status/tool 查询？

## 11. 实施顺序和交付方式

推荐按以下顺序执行，每个任务独立提交并运行自己的测试：

1. Task 1：包身份和安装契约。
2. Task 2：确定性、符号链接防护和报告大小限制。
3. Task 3：tarball、DSH profile smoke test 和 CI。
4. Task 4：预算控制。
5. Task 5：稳定报告结构和来源可追溯性。
6. Task 6：可选 Git diff。
7. Task 7-8：手动重试、状态和日志。
8. Task 9-10：只有在 P1 用户反馈支持时再实现。

每个任务完成后必须运行与任务对应的最小测试，再运行 `pnpm run verify`；不得因为“代码能编译”就跳过打包产物和真实 profile 验证。

## 12. 自审结论

- 本路线把现有 marketplace readiness 计划归入 P0，没有重复定义包发布标准。
- P0 解决当前已知的测试失败、发布缺口和符号链接风险。
- P1 解决“日报有了但不一定好用”的范围、预算和可追溯性问题。
- P2 解决失败后用户必须重启 DSH、运行错误不可见的问题。
- P3 明确延后复杂的多 vault 和历史回填，避免过早把轻量插件做成知识管理平台。
- 当前仍需维护者先决定包身份、兼容版本和语言策略；这些决定会影响发布命令和配置 schema。



