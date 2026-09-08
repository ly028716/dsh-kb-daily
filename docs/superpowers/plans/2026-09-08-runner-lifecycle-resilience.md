# Runner 并发与生命周期韧性实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让每日 Runner 在重复触发、跨日期、插件重载、运行中停止和 Agent 会话持久化不可用时保持单飞、可取消、可重建且状态一致。

**架构：** 将 Runner 的单一 `inFlight` 改为按日期去重、按队列串行执行的请求调度器：同一日期共享 Promise，不同日期排队，避免同一个 Agent 并发驱动。停止时先取消正在执行本插件任务的 Agent，再等待队列收敛，最后释放插件拥有的 handle；新一轮插件加载通过稳定 `SessionId` 继续 resume，持久化不可用时使用受控 create 回退。

**技术栈：** TypeScript、Vitest、@deepseek-ai/dsh-agent Agent/AgentHandle、Cordis lifecycle effect。

---

### 任务 1：补充并发和停止场景的失败测试

**文件：**
- 修改：`tests/runner.spec.ts`
- 修改：`src/runner.ts`（仅为测试注入可控时间函数，若编译需要）

- [x] **步骤 1：编写重复 `runNow` 与日期切换测试**

测试固定时钟，验证同一天的两个 `runNow()` 只产生一次 Agent followup；切换到下一天后，新的调用不能复用旧日期 Promise，而是在旧运行收敛后执行下一天任务。

- [x] **步骤 2：运行测试验证失败**

运行：`pnpm exec vitest run tests/runner.spec.ts -t "deduplicates runNow calls and queues a date change"`

预期：FAIL，下一天的 followup 未被调用，说明当前单一 `inFlight` 错误合并了不同日期。

- [x] **步骤 3：编写运行中停止测试**

让 Agent 的 `whenIdle()` 保持 pending，`cancel({ kind: 'disposed' })` 释放它；调用 `stop()` 后断言先触发取消、最终状态为 `stopped`，且不会留下未处理的运行 Promise。

- [x] **步骤 4：运行测试验证失败**

运行：`pnpm exec vitest run tests/runner.spec.ts -t "cancels an active agent before waiting during stop"`

预期：FAIL，当前停止流程没有调用 Agent cancel，测试会保持 pending 或取消断言失败。

### 任务 2：实现按日期串行调度和可取消停止

**文件：**
- 修改：`src/runner.ts`
- 修改：`tests/runner.spec.ts`

- [x] **步骤 1：为 RunnerConfig 增加内部时钟注入**

增加可选 `now?: () => Date`，生产默认使用 `new Date()`；`runNow()` 和初始化状态统一通过该时钟计算本地日期，保证跨日期测试确定性。

- [x] **步骤 2：实现按日期请求去重和串行队列**

用 `Map<string, Promise<CheckOutcome>>` 保存排队/执行中的日期请求，用一个串行 tail 保证同一 Agent 不并发；重复请求返回已有 Promise，不同日期排在当前请求之后，显式 `retry(date)` 仍保留强制重试语义。

- [x] **步骤 3：运行并发测试确认通过**

运行：`pnpm exec vitest run tests/runner.spec.ts -t "deduplicates runNow calls and queues a date change"`

预期：PASS，两个日期各执行一次且顺序稳定。

- [x] **步骤 4：在停止前取消活动 Agent**

记录活动 Agent；停止时先对 Runner 拥有的 Agent 调用 `cancel({ kind: 'disposed' })`，再等待所有排队 Promise，最后 `dispose()` 每个 handle。停止过程中拒绝新的请求，并让最终状态稳定为 `stopped`。

- [x] **步骤 5：运行停止测试确认通过**

运行：`pnpm exec vitest run tests/runner.spec.ts -t "cancels an active agent before waiting during stop"`

预期：PASS，停止不再依赖模型自然结束才能收敛。

### 任务 3：覆盖插件重载和持久化缺失回退

**文件：**
- 修改：`tests/runner.spec.ts`
- 修改：`README.md`
- 修改：`README.zh.md`

- [x] **步骤 1：复用并验证现有重载测试**

先启动并停止一个 Runner，再用同一稳定 `agentId` 启动第二个 Runner；断言旧 handle 已释放、新 Runner 可以重新 resume，持久化不可用时只在本轮 create 回退一次。

- [x] **步骤 2：运行回退与重载测试**

运行：`pnpm exec vitest run tests/runner.spec.ts tests/plugin.spec.ts -t "persistence|restart|reload|dispos"`

预期：现有回退、handle 释放、插件生命周期测试全部通过。

- [x] **步骤 3：更新文档中的生命周期保证**

说明同日重复触发会合并、跨日期请求串行排队、插件卸载会取消并释放自有 Agent；没有 `sessionPersistence` 时会安全创建临时新会话，但不能承诺跨重启恢复历史。

### 任务 4：完整验证和交付检查

**文件：**
- 修改：`docs/superpowers/plans/2026-09-08-runner-lifecycle-resilience.md`

- [x] **步骤 1：运行核心验证**

运行：`pnpm run typecheck`、`pnpm run test`、`pnpm run build`、`pnpm run pack:inspect`

预期：全部退出码为 0，所有 Vitest 测试通过。

- [x] **步骤 2：检查差异和工作区**

运行：`git diff --check`、`git status --short --branch`

预期：无空白错误；仅包含本计划涉及的代码、测试、文档和计划文件。

- [ ] **步骤 3：使用中文 Conventional Commit 提交**

```bash
git add src/runner.ts tests/runner.spec.ts tests/plugin.spec.ts README.md README.zh.md docs/superpowers/plans/2026-09-08-runner-lifecycle-resilience.md
git commit -m "fix(运行器): 增强并发与生命周期韧性"
```
