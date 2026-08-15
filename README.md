# dsh-gitbash-preset

DeepSeek Harness 插件：安装 **极简模式 (Git Bash)** agent preset —— 自带极简模式的 Windows 变体，把 bash 工具映射到 Git for Windows 的 bash（MSYS）。

## 为什么需要它

DSH 自带极简模式在 Windows 上无法工作，原因有两层：

1. 持久 bash 依赖 PTY 后端，而 `@deepseek-ai/dsh-subprocess-local` 在 win32 上直接拒绝（`terminal inspection is unsupported on platform win32`）；
2. 即使绕过，MSYS bash 也无法在 Windows 受限令牌沙箱（workspace-write）内启动（无法创建 signal pipe）。

本预设改用**每次调用新 shell**的普通 bash 工具，每次命令执行为 `<git bash> -c <command>`，并把执行网关限制在**完全访问**策略上（不绕过沙箱，失败时给出明确指引）。

## 安装

```bash
dsh plugin --profile web add link:D:\developing\DSH-plugin\dsh-gitbash-preset
```

或者手动把 `cordis.patch.yml` 合并进 profile 的 patch 层。重启后，插件在启动时把打包的 preset 安装到用户预设根（`${DSH_HOME:-~/.dsh}/.agent-presets/minimal-gitbash/`），已存在则跳过（配置 `force: true` 可强制覆盖）。

也可以不装插件，直接复制 `agent-presets/minimal-gitbash/` 目录到 `~/.dsh/.agent-presets/`。

## 使用

Web 界面新建会话时选择 **极简模式 (Git Bash)**，然后二选一：

- 把会话沙箱切到**完全访问**，之后所有 bash 调用直接走 git bash；
- 或保持 workspace-write，让模型在第一次调用失败后按提示用 `sandbox_permissions: "danger-full-access"` + justification 单次升级（走正常审批）。

bash 可执行文件自动探测：`GIT_BASH` 环境变量 → 常见安装目录（ProgramFiles / ProgramFiles(x86) / LOCALAPPDATA）→ PATH 中的 `bash.exe` → 兜底 `bash`。如需固定路径，可在 preset 的 `agent.cordis.yml` 中给 `gitbash-executor` 显式配置 `shellPath`。

## 开发

```bash
npm run check   # 语法检查
npm run test    # 单元测试（node --test）
```

## License

MIT
