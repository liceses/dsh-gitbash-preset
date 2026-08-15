# dsh-gitbash-preset

DeepSeek Harness 插件：一键安装「极简模式 (Git Bash)」agent preset —— 把 DSH 自带极简模式中的 bash 调用映射到 Git for Windows 的 bash（MSYS），让 Windows 上的极简模式真正可用。

## About

DSH 自带的极简模式在 Windows 上无法使用，失败有两层原因：

1. **PTY 平台限制**：极简模式的持久 bash 依赖 PTY 后端，而 `@deepseek-ai/dsh-subprocess-local` 在 win32 上直接拒绝（`terminal inspection is unsupported on platform win32`），与 bash 是否存在无关；
2. **shell 缺失**：即便绕过 PTY，`@deepseek-ai/dsh-bash-local` 硬编码从 PATH 找 `bash`，Windows 上默认没有。

本插件交付一个可安装的预设变体：**同一套极简 persona + str_replace_editor 双工具表面**，但 bash 工具每次命令执行 `<git bash> -c <command>`，并通过沙箱感知门控保证不绕过安全边界。

## 特性

- **幂等安装**：插件启动时把打包的预设复制到用户预设根（`${DSH_HOME:-~/.dsh}/.agent-presets/minimal-gitbash/`），已存在则跳过，`force: true` 才覆盖；
- **自动探测 bash**：`GIT_BASH` 环境变量 → 常见安装目录（ProgramFiles / ProgramFiles(x86) / LOCALAPPDATA）→ PATH 中的 `bash.exe` → 兜底 `bash`，无需硬编码路径；
- **沙箱感知门控**：MSYS 运行时无法在 Windows 受限令牌沙箱内启动（无法创建 signal pipe），因此命令仅在"完全访问"策略下执行——不绕过沙箱，受限时给出明确升级指引；
- **极简不变**：固定 persona、`str_replace_editor`、无上下文压缩，与原极简模式一致。

## 工作原理

| 环节 | 说明 |
| --- | --- |
| 插件行 | `cordis.patch.yml` 在 web profile 组合中插入 `dsh-gitbash-preset`，启动时安装预设文件 |
| 预设组合 | `agent.cordis.yml` 中 `gitbash-shell` 组以 entry-local realm 提供 `shell` 服务，`tool-bash` 注册模型工具 |
| 执行器 | `gitbash-executor.mjs` 通过 host 的 `subprocess` 服务执行 `bash -c`，处理超时、后台、输出截断与错误诊断 |
| 沙箱门控 | `run`/`start` 校验策略：仅 `danger-full-access`（或部署无沙箱）放行，否则抛出带指引的错误 |

## 安装

```bash
dsh plugin --profile web add @icelily/dsh-gitbash-preset
```

或手动合并 `cordis.patch.yml` 到 profile patch 层。**重启 DSH 后生效**；重启后插件会自动安装预设（已存在则 no-op，不会覆盖你已有的版本）。

也可以不装插件，直接把 `agent-presets/minimal-gitbash/` 目录复制到 `~/.dsh/.agent-presets/`。

## 使用

1. Web 界面新建会话，选择 **极简模式 (Git Bash)**；
2. 二选一启用 bash：
   - 把会话沙箱切到**完全访问**，之后所有 bash 调用直接走 git bash；
   - 或保持 workspace-write，让模型在第一次调用失败后按提示用 `sandbox_permissions: "danger-full-access"` + justification 单次升级（走正常审批流程）。

## 配置

**预设配置**（`agent-presets/minimal-gitbash/agent.cordis.yml` 中 `gitbash-executor`）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `shellPath` | 自动探测 | 显式指定时优先（如 `'C:\\Program Files\\Git\\bin\\bash.exe'`） |
| `timeoutMs` | 120000 | 单次命令默认超时（上限 `maxTimeoutMs`） |
| `maxTimeoutMs` | 600000 | 超时上限 |
| `maxOutputBytes` | 64000 | 单流保留字节数（溢出写入 spill 文件） |
| `graceMs` | 3000 | 终止进程的 SIGTERM→SIGKILL 宽限 |

**插件配置**（`cordis.patch.yml` 插入行）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `force` | `false` | 预设已存在时是否用包内文件覆盖（保留用户额外文件） |

## 开发

```bash
npm run check   # 三个文件语法检查（插件、执行器、测试）
npm run test    # 单元测试：路径转换 / 探测优先级 / 配置校验，10 个用例
```

## 限制

- 会话沙箱为 workspace-write（或更窄）时，git bash 无法启动（MSYS 受限令牌限制），需切换完全访问或单次升级——这是沙箱边界，插件不绕过；
- 与原极简模式不同，bash 为**每次调用新 shell**（不保持 cd/export 状态）——Windows 上 PTY 持久会话不可用，此为替代设计。

## License

MIT
