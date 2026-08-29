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


