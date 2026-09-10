# `0.1.0-rc.8` → `0.2.0` 迁移说明

> `0.2.0` 是目标迁移版本。发布前请以对应 tag、CHANGELOG 和 release notes 为准；本说明不把尚未落地的报告结构、历史补报、上下文预算或增值分析能力写成当前 API。

## 迁移结论

- 现有单 Vault 配置字段保持兼容：`vaultPath`、`reportDir`、`timeZone`、`agentId`、`provider`、`model`、`writePolicy`、`checkIntervalMs` 以及扫描预算字段。
- `writePolicy` 默认仍为 `ask`，没有 approval 通道时继续 fail closed。
- 报告目标仍由本地日期和 `reportDir` 派生，模型不能提交任意输出路径。
- 报告写入仍使用独占创建，不覆盖已有日报。
- 路径穿越、symlink/junction、超大报告和 TOCTOU 回归测试属于升级验证重点。
- runner 继续提供 `status()`、`runNow()` 和 `retry(date)`；具体新增控制面以 `0.2.0` 发布说明为准。

## 升级前检查

1. 备份配置文件和 `Daily`（或自定义 `reportDir`）目录。
2. 记录当前包版本、DSH loader 版本、`agentId` 和最近一次 `RunnerStatus`。
3. 确认 vault 与报告目录使用最小权限，且报告目录不是 junction 或 symbolic link。
4. 确认没有把真实凭据、私有路径或笔记正文写入仓库、日志和 Issue。
5. 在合成 vault 上先运行核心门禁：

```sh
pnpm run verify:core
```

## 配置核对

升级后继续使用显式配置，并优先保留审批：

```yaml
config:
  vaultPath: <absolute-vault-path>
  reportDir: Daily
  timeZone: Asia/Shanghai
  agentId: kb-daily
  writePolicy: ask
  checkIntervalMs: 3600000
```

多 Vault 配置需要保证每个 `id` 与 `agentId` 唯一，路径不能相同、嵌套或重叠。不要把新版本试验配置与旧版本配置混在同一个 profile 中，先复制 profile 做回滚点。

## 升级后验证

使用合成 vault 验证：

- 插件加载后注册预期的四个工具；
- 缺少当天报告时能启动 Agent，已有报告时跳过且不覆盖；
- `writePolicy: ask` 能进入审批，拒绝和超时能反映在状态中；
- 重复 `runNow()` 不会重复驱动 Agent；
- 报告路径、symlink/junction 和权限边界仍然 fail closed；
- `RunnerStatus.diagnostics` 只包含耗时、读取文件数、截断次数和工具摘要；
- Git 不可用时日报仍能降级运行，并披露来源限制。

## 回滚

如果升级后发现行为异常：

1. 停止插件并保留脱敏状态、事件名称和错误类别。
2. 不要覆盖或删除已有日报；复制问题 vault 到临时目录复现。
3. 将 profile 恢复到升级前的锁定包版本或 Git commit。
4. 恢复升级前配置和 sessionPersistence 设置。
5. 使用同一组合成 vault 重新运行 `pnpm run verify:core`，再决定是否重新升级。

## 尚未包含在本次迁移中的计划

报告固定章节校验、历史日期/日期范围补报、文件优先级与上下文预算、主题聚类、重复洞察检测、日报间链接、项目模板和中英文输出策略都需要各自的兼容性设计。它们在实现并发布前不应被当作 `0.2.0` 已支持能力。
