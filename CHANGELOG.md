# Changelog

## Unreleased

### 支持 DSH 0.2.x（预设声明行）

- `cordis.patch.yml` 除了安装器行，现在还会 `insert` 一行 `@deepseek-ai/dsh-agent-preset`
  声明（`id: minimal-gitbash`）。DSH 0.2.x 的预设注册表不再扫描
  `${DSH_HOME}/.agent-presets/`，预设必须以声明行出现 —— 这条修复让「装完在预设列表里找不到」
  不再发生（#7）。旧的目录写入保留，供 0.1.x 使用。
- `package.json` 新增子路径导出 `@icelily/dsh-gitbash-preset/executor`：声明行用裸包名引用执行器，
  不依赖绝对路径或当前工作目录。
- 新增 `test/composition-sync.test.mjs`：强制声明行里的组合与
  `agent-presets/minimal-gitbash/agent.cordis.yml` 保持一致。

### 适配 `@deepseek-ai/dsh-shell` 的新契约

- 执行器从旧的 `run()` / `start()` 改为 rc.2 的 `resolve()` + `execute()` → 句柄
  （`result()`、`observed.stdout/stderr`、`readOutput()`、`kill()`），并支持 `onExpiry`
  （`'kill'` 由执行器装超时，`'none'` 交给调用方）。旧实现不会被 `dsh-tool-bash` 调用。
- `resolve()` 补齐 `onExpiry` 与 `sandboxPolicy` 字段。

### 沙箱：改为「未隔离但如实标注」

- MSYS 在 Windows 受限令牌沙箱内无法初始化，DSH 的 ACL runner 无法包装 Git Bash 的 argv。
  因此默认**不再拒绝**受限会话里的命令，而是照常执行并在结果的沙箱事实里标注
  `sandbox: { mode, denied: false, enforcement: 'gitbash-unconfined' }`。
  `dsh-tool-bash` 会把 `enforcement` 放进结构化结果，Web GUI 的终端卡片据此显示
  `File sandbox: <mode>; enforcement: gitbash-unconfined`；**模型可见文本不含这一行**
  （DSH 只在 `enforcement: 'partial'` 时追加提示），需要模型也知道边界的场景请打开 `requireFullAccess`。
  这样默认（workspace-write）会话也能开箱即用（#8）。
- 新增配置 `requireFullAccess`（默认 `false`）：设为 `true` 可恢复旧的 fail-closed 行为
  （非「完全访问」一律拒绝并给升级指引）。
- `preset.yml` / 声明行的描述同步更新，不再宣称「需在完全访问下使用」。

### 测试

- 新增 `test/shell-contract.test.mjs`：用假的 `ctx.subprocess` 验证 `resolve` / `execute` /
  `result` / 沙箱事实 / `requireFullAccess` 分支，覆盖 12 个用例，可在任意平台运行（不 spawn bash）。
- `npm test` 合计 27 个用例。
