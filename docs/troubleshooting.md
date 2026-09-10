# 故障排查手册

本文优先使用合成 vault 和脱敏输出。不要为了排查问题上传真实笔记、完整报告、API key、访问令牌或个人绝对路径。

## 通用检查

在仓库根目录运行：

```sh
pnpm run typecheck
pnpm run test
pnpm run verify:core
```

确认包与 DSH loader 版本匹配，并记录操作系统、Node.js、pnpm、配置模式（单 Vault / 多 Vault）和 `writePolicy`。

## 插件无法加载

症状：插件未注册工具或 prompt section。

检查：

1. `vaultPath` 是否存在、是目录且可读。
2. `timeZone` 是否为有效 IANA 时区。
3. 是否同时配置了旧的 `vaultPath` 和 `vaults`。
4. 多 Vault 的 `id`、`agentId` 是否重复，路径是否嵌套或重叠。
5. 宿主是否提供 `agents`、`tools`、`systemPrompt` 和 `timer` 服务。

安全处理：不要通过把 `vaultPath` 改成更大的目录来绕过校验；应修正配置并使用最小权限目录。

## 日报没有生成

症状：runner 启动但日报文件不存在。

检查 `RunnerStatus`：

- `state: already-done`：目标日报已经存在，插件默认不会覆盖。
- `state: awaiting-approval`：等待宿主允许 `kb_write_report`。
- `state: rejected` 或 `timed-out`：审批结束，查看脱敏的 `lastError`。
- `state: failed`：检查 `lastError` 和 `diagnostics.toolCalls` 中失败次数。
- `state: stopped`：插件已经卸载或 runner 已停止。

确认 `reportDir` 可创建和写入，且没有 symlink/junction 段。不要手动删除已有报告来强行重试，先确认是否真的需要新的日期或明确的维护者操作。

## 审批没有弹出或写入被拒绝

`writePolicy: ask` 需要宿主 approval 通道。没有 approval 通道时会 fail closed；这是安全行为，不是写入失败的理由。

检查：

1. 宿主是否启用了 approval 服务。
2. 工具名称是否为当前 Vault 对应的 `kb_write_report` 或 `kb_<id>_write_report`。
3. 是否观察到 `kb-daily.approval-required`、`kb-daily.approval-rejected` 或 `kb-daily.approval-timeout`。

只有在审查过 vault 范围后才考虑 `writePolicy: allow`。

## 权限与路径错误

症状：`read_failed`、`write_failed`、`list_failed`，或错误包含 symlink/junction、permission denied、path escapes。

检查：

- 当前运行账户对 vault 有读取权限，对 `reportDir` 有创建/写入权限。
- `reportDir` 是 vault 内的普通目录，不是 junction 或 symbolic link。
- Windows 上确认创建 junction 所需的开发者模式或权限；Linux/macOS 上确认目录执行权限。
- 用临时合成目录复现，不要扩大服务账户权限作为第一步。

## Git diff 不可用

`kb_read_diff` 在非 Git vault、无历史、二进制文件、不可读文件或 diff 超过 128 KiB 时返回稳定错误。检查：

```sh
git -C <synthetic-vault> status --short
git -C <synthetic-vault> rev-parse --verify HEAD
```

Git 不可用不会自动阻止日报；报告应把 Git 来源缺失作为限制说明，仍保留工具返回的 vault-relative 路径和扫描统计。

## 日志与诊断不完整

runner 诊断只保证安全摘要：`durationMs`、`filesRead`、`truncationCount` 和每个工具的调用/失败计数。若计数为零，先确认宿主是否提供 `tools/result` 事件以及 `toolNames` 是否传入当前 runner。

不要通过打开工具参数、笔记内容或完整报告日志来“补充诊断”；这会扩大敏感数据暴露面。应提交事件名、状态和脱敏后的错误类别。

## 卸载、重载和 Agent 会话问题

卸载会停止 timer、取消本插件拥有的 Agent、等待运行收敛并释放插件创建的 handle。若重载后无法恢复会话：

1. 确认 `agentId` 没有在多个 Vault 间复用。
2. 确认宿主配置了可用的 `sessionPersistence`。
3. 接受持久化不可用时创建新 Agent 的降级行为；不要手动复制 session 文件。
4. 运行 `pnpm run test`，重点查看 runner 生命周期、重复 `runNow()`、日期切换和停止测试。
