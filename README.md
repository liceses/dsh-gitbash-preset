# dsh-gitbash-preset · 让 Windows 上的极简模式用上 Git Bash

> **English**: A DeepSeek Harness plugin that installs a "minimal (Git Bash)" agent preset, so on Windows the minimal mode's command tool runs Git for Windows bash instead of PowerShell.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933.svg)
[![DSH Plugin](https://img.shields.io/badge/DSH-plugin-4f46e5.svg)](https://github.com/liceses/awesome-dsh-plugin)
![Version](https://img.shields.io/badge/version-0.1.3-6b7280.svg)

DSH 的**极简模式**在 Windows 上不会给你 bash —— 官方按平台分叉，win32 那一支挂的是**持久 PowerShell**。
这个插件交付一个预设变体「**极简模式 (Git Bash)**」：persona 与 `str_replace_editor` 跟官方极简模式**逐字一致**，
只把命令工具换成 `bash`，每次调用真正跑在 **Git for Windows 的 bash（MSYS）** 上。

一句话：**Windows 上想要一个写 bash 的极简模式，装它。**

> [!IMPORTANT]
> **DSH 版本边界。** 本插件现在同时支持两条装配路径，装完即可在预设列表里选到：
> - **DSH 0.2.x**：`cordis.patch.yml` 除了安装器行，还 `insert` 一行
>   `@deepseek-ai/dsh-agent-preset` 声明（`id: minimal-gitbash`）—— 0.2.x 的预设注册表
>   **不再扫描用户预设目录**，预设必须以声明行出现。
> - **DSH 0.1.x**：安装器继续把预设文件写进 `${DSH_HOME:-~/.dsh}/.agent-presets/minimal-gitbash/`，
>   旧版启动时会读那个目录。
>
> 两条路径的组合内容由 `test/composition-sync.test.mjs` 强制保持一致。
>
> 另一处行为变更：Git Bash 在 Windows 上**无法**被 DSH 的 ACL 受限令牌沙箱包装（MSYS 起不来），
> 所以本执行器按**未隔离**运行并在结果里标注 `enforcement: gitbash-unconfined`，**不再要求会话切到完全访问**。
> 想恢复旧的「非完全访问就拒绝」行为，把 `requireFullAccess` 设为 `true`。

![插件管理页里的 @icelily/dsh-gitbash-preset](docs/screenshots/plugin-page.png)
*本机实拍（适配 0.2.x 之前的版本）：插件装上了、组件「运行中」，但预设列表里没有卡片 —— 那正是旧版「用户预设目录不再被读取」的现场表现；上面的声明行修掉了它。*

---

<a id="toc"></a>
## 目录

| 想了解 | 看这里 |
| --- | --- |
| 装前 / 装后到底差在哪 | [它改变了什么](#diff) |
| 三分钟装起来 | [快速开始](#quickstart) |
| 装完之后你得到什么 | [装完之后你得到什么](#preset) |
| 它和姊妹插件 dsh-all-gitbash 的区别 | [与 dsh-all-gitbash 的关系](#sibling) |
| 命令到底怎么跑起来的 | [工作原理](#how) |
| 有哪些可配的字段 | [配置](#config) |
| 出问题 / 不适用 | [已知限制](#limits) |
| 想改代码 | [开发](#dev) |

---

<a id="diff"></a>
## 它改变了什么

DSH 自带的极简模式是**按平台分叉**的（源码出处：`@deepseek-ai/dsh-web-app` 的
`presets/minimal.patch.yml`，同一套分叉也在 `dsh-sdk-minimal/cordis.patch.yml` 里）：

```yaml
# 官方 minimal 预设的 persistent-shell 组（节选，逐字来自包内文件）
- id: terminal-bash      # 持久 bash
  name: '@deepseek-ai/dsh-terminal-bash'
  disabled: !!js process.platform === 'win32'      # ← Windows 上关掉
- id: persistent-bash
  name: '@deepseek-ai/dsh-tool-bash-persistent'
  disabled: !!js process.platform === 'win32'      # ← Windows 上关掉
- id: terminal-pwsh      # 于是 Windows 拿到的是持久 PowerShell
  name: '@deepseek-ai/dsh-terminal-bash'
  disabled: !!js process.platform !== 'win32'
  config: { shellDialect: pwsh }
- id: persistent-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh-persistent'
  disabled: !!js process.platform !== 'win32'
```

也就是说：**Windows 上的极简模式没坏，只是命令工具是 PowerShell。** 本插件给的就是另一种选法。

| | 官方极简模式（POSIX） | 官方极简模式（Windows） | **本预设**（Windows） |
| --- | --- | --- | --- |
| 命令工具名 | `bash` | `pwsh` | `bash` |
| 命令落点 | `bash -c` | PowerShell | `<git bash> -c`（MSYS） |
| 会话状态 | 持久（`cd` / `export` 保留） | 持久（`$env:` 保留） | **每次调用新 shell**（不保留） |
| 路径写法 | `/home/...` | `C:\...`、`$env:NAME` | `/d/...`、`$NAME` |
| 文件工具 | `str_replace_editor` | `str_replace_editor` | `str_replace_editor`（同） |
| persona | 固定一句，`complete: true` | 同 | **逐字相同** |
| 后台命令 | 有 | 有 | **未启用**（`enableRunInBackground: false`） |

「每次调用新 shell」不是偷懒：Windows 上官方把持久 bash 整条支路关掉了（上面那两行 `disabled`），
而本插件的执行器是直接 `spawn` 一个 `bash -c`（见 [工作原理](#how)）—— 这是替代设计，不是等价实现。

---

<a id="quickstart"></a>
## 快速开始

**前置条件**：Windows；装了 **Git for Windows**；DSH 的 Node ≥ 20。

```bash
dsh plugin --profile desktop add @icelily/dsh-gitbash-preset
```

（profile 名按你的部署填：桌面版是 `desktop`，Web 版常见 `web`。）

装完 **重启 DSH**（插件行在启动时装配，声明行也在这时候进注册表）。

> **注意包名**：安装命令必须用**包名** `@icelily/dsh-gitbash-preset`，
> 不能写仓库名 `dsh-gitbash-preset` —— 后者在 npm 上不是这个包，会装失败。

然后：**新建会话 → 选「极简模式 (Git Bash)」**，`bash` 调用就直接走 Git Bash，
**默认（workspace-write）会话也能用**，不需要先切「完全访问」。

> ⚠️ **它不是被沙箱限制着跑的。** MSYS 在 Windows 受限令牌沙箱里无法初始化，所以这些命令
> **按未隔离执行**：结果的沙箱事实里会带 `enforcement: gitbash-unconfined`（Web GUI 终端卡片可见；
> 模型可见文本不含这一行，见 [已知限制](#limits)）。需要"宁可不跑也不越界"的部署，
> 请把 `requireFullAccess: true` 打开（见 [配置](#config)）。

---

<a id="preset"></a>
## 装完之后你得到什么

预设文件被复制到 `${DSH_HOME:-~/.dsh}/.agent-presets/minimal-gitbash/`（`lib/index.js:32-37`），
一共三个文件加一份测试。下面是**仓库里真实的内容**（不是示意）。

[`agent-presets/minimal-gitbash/preset.yml`](agent-presets/minimal-gitbash/preset.yml) —— 预设的显示信息：

```yaml
name: 极简模式 (Git Bash)
description: 极简模式的 Windows 变体：bash 调用映射到 Git for Windows 的 bash（MSYS）；MSYS 无法被 Windows 受限令牌沙箱包装，命令按未隔离运行并在结果中标注 gitbash-unconfined。
order: 6
```

> `order: 6` 排在官方四个预设之后（`standard` 标准模式=1 / `ptc` PTC 模式=2 /
> `minimal` 极简模式=3 / `cordis` 创造模式=4；顺序取自 `@deepseek-ai/dsh-web-app` 的 `presets/*.patch.yml`）。

[`agent-presets/minimal-gitbash/agent.cordis.yml`](agent-presets/minimal-gitbash/agent.cordis.yml) —— 预设挂的三个组：

```yaml
- id: persona                       # ① 与官方 minimal 逐字相同的一句话 persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: You are a helpful software engineer assistant.
    complete: true                  # 这段话就是完整系统提示，后面的装配监听器加不进字
    includeRuntimeContext: false    # 也不注入运行时上下文快照

- id: gitbash-shell                 # ② 会话内的 shell 服务 + bash 工具
  name: cordis:group
  group: true
  disabled: !!js process.platform !== 'win32'   # ← 非 Windows 直接禁用
  isolate: { shell: true }          # entry-local realm：只在本预设内顶替 shell 服务
  config:
    - id: gitbash-executor
      name: ./gitbash-executor.mjs  # 相对名：从预设目录加载（见「已知限制」）
      config: { timeoutMs: 120000, maxTimeoutMs: 600000, maxOutputBytes: 64000, maxSpillBytes: 67108864, graceMs: 3000 }
    - id: tool-bash
      name: '@deepseek-ai/dsh-tool-bash'
      config: { enableRunInBackground: false }

- id: filesystem                    # ③ 文件工具（与官方极简模式一致）
  name: cordis:group
  group: true
  isolate: { fs: true }
  config:
    - id: fs-local
      name: '@deepseek-ai/dsh-fs-local'
      config: { cwd: !!js process.env.DSH_CWD ?? process.cwd() }
    - id: str-replace-editor
      name: '@deepseek-ai/dsh-tool-str-replace-editor'
      config: { maxOutputChars: 16000 }
```

**模型看到的能力面因此只有两个工具**：`bash` 与 `str_replace_editor`；没有 pwsh 工具，
没有上下文压缩（跟官方极简模式的取舍一致）。

---

<a id="sibling"></a>
## 与 dsh-all-gitbash 的关系

同一个作者的姊妹插件 [**dsh-all-gitbash**](https://github.com/liceses/dsh-all-gitbash)
也把 Windows 上的命令引到 Git Bash，但**改的是完全不同的东西**：

| | **dsh-gitbash-preset**（本仓库） | [dsh-all-gitbash](https://github.com/liceses/dsh-all-gitbash) |
| --- | --- | --- |
| 一句话 | 给**极简模式**一个 bash 版预设 | 把**完整模式**（web）的 pwsh 执行器整个改道 bash |
| 作用对象 | `minimal` 预设里的命令工具 | 宿主已挂载的 `ctx.shell`（`dsh-pwsh-sandbox` 实例） |
| 生效范围 | **只影响选了本预设的会话** | **所有会话**（宿主全局） |
| 实现手段 | 交付一份 agent preset，`isolate: {shell:true}` 在会话 realm 内自供 `shell` | 运行时把执行器实例的 `argv()` 换成 `[<git bash>, '-c', 命令]`（原型方法遮蔽），并注册 `bash` 工具、移除 `pwsh` 工具、注入 PATH 垫片 |
| 工具面 | `bash` + `str_replace_editor` | 保留完整模式的全部工具，只是 `pwsh` 换成 `bash` |
| 开关 | 无（预设常驻，切换预设即切换） | 有：设置面板滑块 / `settings.yaml` 的 `enabled`，往返无损 |
| 安装 | `dsh plugin --profile web add @icelily/dsh-gitbash-preset` | `dsh plugin --profile web add @icelily/dsh-all-gitbash` |
| 包名 | `@icelily/dsh-gitbash-preset` | `@icelily/dsh-all-gitbash` |

**怎么选**：

- 只想在**极简模式**里写 bash、其他会话不动 → 装本插件；
- 想在**完整模式**下也全程 bash、还要一键开关 → 装 dsh-all-gitbash；
- 两个都装也可以：极简会话走本预设的 bash，其他会话走姊妹插件的 bash。
  两边都是 Git Bash，命令落点一致。

两者共用同一条沙箱边界：**MSYS 在 Windows 受限令牌沙箱里起不来**（无法创建 signal pipe），
所以两边都门控到 `danger-full-access` 并给升级指引 —— 都不绕过沙箱。

---

<a id="how"></a>
## 工作原理

一句话：**用一个会话内的 `shell` 服务顶替官方执行器，把每条命令变成 `"<git bash>" -c <命令>`。**

```
模型 ──bash 工具──► ctx.shell（本预设提供的 gitbash-executor）
                          │
                          ├─ 沙箱事实：不包装（MSYS 无法进受限令牌），结果标 gitbash-unconfined
                          │
                          └─ subprocess.spawn([ <git bash>, '-c', <命令> ])  ──► Git Bash (MSYS)
```

四个环节：

| 环节 | 说明 | 出处 |
| --- | --- | --- |
| 装配点 | `cordis.patch.yml` 往 profile 插件名单里 `insert` 两行：安装器 `dsh-gitbash-preset`（0.1.x 的目录机制），以及预设声明行 `preset-minimal-gitbash`（0.2.x 的注册表机制） | `cordis.patch.yml`、`lib/index.js:49-73` |
| 幂等安装 | 三个文件都在且没配 `force` → 只打一行日志返回；还会**逐字节**比对包内与已装文件，不一致时提示 `set force: true` | `lib/index.js:52-63` |
| 服务顶替 | 预设的 `gitbash-shell` 组 `isolate: { shell: true }`，在 entry-local realm 内 `ctx.provide('shell', executor)` —— 只在本预设内生效，不碰宿主的执行器 | `agent.cordis.yml`、`gitbash-executor.mjs` |
| 命令执行 | 每次调用 `subprocess.spawn([shellPath, '-c', command])`；固定注入 `NO_COLOR=1` / `TERM=dumb` / `PAGER=cat` / `GIT_PAGER=cat`，避免交互式分页器把输出卡住 | `gitbash-executor.mjs`（`ENV_OVERRIDES` / `spawnSpec`） |

### Git Bash 怎么找到的

`detectShellPath()` 按顺序取第一个**存在**的候选（`gitbash-executor.mjs:83-117`）：

1. 配置里的 `shellPath`（显式指定，优先级最高）；
2. 环境变量 `GIT_BASH`；
3. `%ProgramFiles%\Git\bin\bash.exe`；
4. `%ProgramFiles(x86)%\Git\bin\bash.exe`；
5. `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`；
6. 一个写死的兜底路径 `D:\applications\Git\bin\bash.exe`（作者本机遗留，对别人通常是无效候选，无害）；
7. PATH 逐目录找 `bash.exe`，**跳过 `System32` / `Sysnative` / `SysWOW64`** —— 那里是 Microsoft 的 WSL 启动器存根，
   用它当 shell 会在没装发行版时报「没有已安装的分发版」。这是 issue [#1](https://github.com/liceses/dsh-gitbash-preset/issues/1) 的修复；
8. 都不存在 → 返回裸名 `bash`，让 spawn 自己报出解析错误。

### 路径翻译的边界

`toWindowsPath()` 只做一件事：把 MSYS 的单字母盘符路径转成 Windows 路径（`gitbash-executor.mjs:54-64`）。
边界由单元测试逐条钉住（`test/gitbash-executor.test.mjs:23-45`）：

| 输入 | 输出 | 为什么 |
| --- | --- | --- |
| `/d/foo`、`/d/foo/bar.txt` | `D:\foo`、`D:\foo\bar.txt` | 盘符形，转 |
| `/d`、`/d/` | `D:\` | 同上 |
| `/usr/bin`、`/tmp/x` | **原样不动** | 只认「单字母 + `/` 或结尾」，否则 `/usr/bin` 会被拧成 `U:\sr\bin` |
| `D:\foo`、`D:/foo`、`\\server\share\x` | 原样通过 | 已经是 Windows / UNC 形态 |
| `foo/bar`、`''`、`undefined` | 原样通过 | 相对路径与空值不动 |

非 Windows 平台这个函数直接返回原值（`gitbash-executor.mjs:55`），整个 `gitbash-shell` 组也被
`process.platform !== 'win32'` 禁用 —— 所以这是**一个 Windows 专用插件**，不要指望它在 macOS / Linux 上做任何事。

---

<a id="config"></a>
## 配置

**预设配置**（`agent-presets/minimal-gitbash/agent.cordis.yml` 的 `gitbash-executor`）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `shellPath` | 自动探测 | 显式指定 Git Bash 路径时优先，可写 Windows 或 MSYS 形（如 `'C:\\Program Files\\Git\\bin\\bash.exe'`） |
| `cwd` | 不设 | 显式工作目录；不设时用请求的 workdir，再退回 `process.cwd()` |
| `timeoutMs` | `120000` | 单次命令默认超时 |
| `maxTimeoutMs` | `600000` | 单次请求超时的上限（`resolve` 里 `Math.min` 钳位） |
| `maxOutputBytes` | `64000` | 单流保留字节数，溢出写入 spill 文件 |
| `maxSpillBytes` | `67108864`（64 MB） | spill 文件上限 |
| `graceMs` | `3000` | 终止进程的 SIGTERM→SIGKILL 宽限 |
| `requireFullAccess` | `false` | `true` 时恢复旧策略：会话不是「完全访问」就拒绝执行并给升级指引；`false` 时按未隔离运行并在结果里标注 `gitbash-unconfined` |

数值字段必须是**正的有限数**，且三个时间字段不得大于 Node 的定时器上限 `2147483647`；
违反会在装配时抛 `TypeError`（`gitbash-executor.mjs` 的 `resolveConfig`，测试见 `shell-contract.test.mjs`）。

> `requireFullAccess` 的取舍：MSYS 在 Windows 受限令牌沙箱里根本无法初始化，所以「受限模式下的
> Git Bash」在物理上不存在。开着它只能拒绝执行（预设不可用），关掉它则是「照跑但如实标注未隔离」。
> 默认关，是为了让插件开箱即用；受监管环境请打开。

**插件配置**（`cordis.patch.yml` 插入的 `dsh-gitbash-preset` 行）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `force` | `false` | 预设已存在时，是否用包内文件覆盖（用户额外放进去的文件会保留） |

`force: true` 的典型用途见 [已知限制 → 升级路径](#limits-upgrade)。

---

<a id="tree"></a>
## 目录结构

```
dsh-gitbash-preset/
├── package.json                                    # 无依赖；dsh.bundle.patch 指向 cordis.patch.yml
├── cordis.patch.yml                                # 装配点：insert 安装器行 + 预设声明行（0.2.x）
├── LICENSE                                         # MIT
├── lib/
│   └── index.js                                    # 宿主半边（74 行）：启动时把预设复制进用户预设根
├── test/
│   └── composition-sync.test.mjs                   # 声明行与目录副本的组合一致性门禁
└── agent-presets/minimal-gitbash/                  # 会被整体复制到用户预设根（0.1.x 机制）
    ├── preset.yml                                  # 显示名 / 描述 / order
    ├── agent.cordis.yml                            # 预设的插件清单（persona + gitbash-shell + filesystem）
    ├── gitbash-executor.mjs                        # 会话内 shell 服务提供者（rc.2 契约）
    └── test/
        ├── gitbash-executor.test.mjs               # 纯函数用例（路径翻译 / 探测优先级 / 配置校验）
        └── shell-contract.test.mjs                 # ctx.shell 契约用例（resolve/execute/result/沙箱事实）
```

---

<a id="limits"></a>
## 已知限制

<a id="limits-version"></a>
### DSH 版本边界（0.2.x 已支持）

本插件早期只有一个装配机制：「把预设文件写进 `${DSH_HOME:-~/.dsh}/.agent-presets/<id>/`」。
这个目录**在 DSH 0.2.x 上已经没人读了** —— 官方把用户预设换成了 bundle 声明行。原文出处
（`@deepseek-ai/dsh-agent-preset-registry` 的 README）：

- 「定义使用普通插件行；**注册表不扫描目录**，也不接受 preset 路径。」
- 旧技能文本：`Before declaration rows, a user preset was a directory $DSH_HOME/.agent-presets/<id>/ … Nothing reads that directory any more.`

**现在的做法**：`cordis.patch.yml` 同时 `insert` 两条行 ——

1. 安装器 `dsh-gitbash-preset`（写目录，服务 0.1.x）；
2. 预设声明行 `preset-minimal-gitbash`（`@deepseek-ai/dsh-agent-preset`，`id: minimal-gitbash`），
   组合与 `agent.cordis.yml` 一致，执行器通过包内子路径导出
   `@icelily/dsh-gitbash-preset/executor` 引用（裸包名，从 profile 的 node_modules 解析，
   **不需要绝对路径**，也不依赖当前工作目录）。

两份组合内容由 `test/composition-sync.test.mjs` 强制一致，改一处忘记另一处会测试失败。

> 为什么不能把 `agent.cordis.yml` 直接 `cordis:include` 进声明行：include 会把该文件的目录设为
> 基准 URL，其后的裸包名（`@deepseek-ai/dsh-persona` 等）就会从预设目录解析而失败。

<a id="limits-upgrade"></a>
### 升级路径

安装器对已存在的预设默认 **no-op**。`0.1.3` 之前的版本装出的预设是坏的（用了 `dsh-persona` 旧的
`text` 字段，装配会报 `$.prefix missing required value`）。升级插件后要**显式**让它覆盖：

- 在插件行配置 `force: true`，或
- 删掉 `~/.dsh/.agent-presets/minimal-gitbash/` 再重启。

（`0.1.3` 起改用 `prefix`；本机核对 `@deepseek-ai/dsh-persona` 的 schema 确实是
`prefix` 必填、`complete` 默认 `false`、`includeRuntimeContext` 默认 `true`，与预设写法一致。）

> 声明行走的是插件包自身，不受这条 no-op 影响；只有「目录副本」需要 `force`。

### 其它

- **只对极简模式生效**。它交付的是一个 agent preset，只有**选了「极简模式 (Git Bash)」的会话**受影响。
  完整模式（web）下的 pwsh 工具、其他预设的命令工具，一律不动 —— 那正是
  [dsh-all-gitbash](https://github.com/liceses/dsh-all-gitbash) 要解决的事。
- **需要 Git for Windows**。没装的话探测链全部落空，最终返回裸名 `bash`，每条命令都会 spawn 失败。
  装了但不在标准目录时，用 `GIT_BASH` 环境变量或 `shellPath` 配置指路。
- **命令按未隔离运行**。MSYS 运行时无法在 Windows 受限令牌沙箱内初始化（创建不了 signal pipe），
  DSH 的 ACL runner 无法包装 Git Bash 的 argv —— 包了就是每条命令直接终止。所以执行器**照常执行并如实标注**
  `sandbox: { mode, denied: false, enforcement: 'gitbash-unconfined' }`：`dsh-tool-bash` 会把它放进结果的
  结构化沙箱事实，Web GUI 的终端卡片据此显示 `File sandbox: <mode>; enforcement: gitbash-unconfined`。
  **但模型可见的文本里没有这一行**（DSH 只在 `enforcement: 'partial'` 时追加提示），所以需要"模型自己也知道
  没有隔离"的场景，请打开 `requireFullAccess`，或在会话说明里写明这条边界。
  需要「不隔离就不跑」的部署，把 `requireFullAccess` 设为 `true` 恢复拒绝策略。
  **这不是沙箱绕过**：插件从不声称自己隔离，也不伪装成被隔离。
- **bash 不保持状态**。每次调用都是新 shell，`cd` / `export` 不会留到下一次；后台命令也没启用
  （`enableRunInBackground: false`）。这是「Windows 上官方持久 bash 支路被关掉」的替代设计，不是等价实现。
- **路径有两个域**。文件工具走 Node（Windows 路径 `D:\...`），bash 走 MSYS（POSIX 路径 `/d/...`）。
  两者都能接受 `D:/...` 这种正斜杠形式 —— 拿不准时用这个写法。`toWindowsPath` 只转单字母盘符形，
  `/usr/bin` 这类 MSYS 根路径不会被误转。
- **探测链里有一条作者本机遗留的写死路径** `D:\applications\Git\bin\bash.exe`
  （`gitbash-executor.mjs:89`）。对别的机器通常只是无效候选，无害；但它是本机痕迹，未擅自改动源码。
- **无卸载命令记录**。仓库里只有安装命令，没有对应的移除命令，所以这里也不写。

---

<a id="dev"></a>
## 开发

零依赖、零构建：`lib/index.js`、`cordis.patch.yml` 与 `agent-presets/` 都是入库的手写文件，改完直接跑。

```bash
npm run check   # 四个文件的语法检查（插件 / 执行器 / 两份测试）
npm run test    # 27 个用例：路径转换 / 探测优先级 / WSL 启动器防御 / 配置校验 /
                #            ctx.shell 契约（resolve・execute・result・沙箱事实）/ 组合一致性
```

测试里没有真 spawn：`gitbash-executor.test.mjs` 覆盖纯函数，`shell-contract.test.mjs` 用
假的 `ctx.subprocess` 验证接缝契约，`composition-sync.test.mjs` 比对两份组合。真实的 spawn 路径
要在活的 DSH 会话里验证（本机实测：`uname -o` → `Msys`、超时标记、非零退出、`gitbash-unconfined`）。

**改预设要注意两处**：

1. **声明行**（`cordis.patch.yml`）立刻生效 —— 保存 profile patch 会热重载，无需重启；
2. **目录副本**（`agent-presets/`）是「复制到用户预设根」的一次性动作，改了包内文件后，已经装过的机器
   **不会自动更新**（默认 no-op）；本地迭代要么配 `force: true`，要么先删掉已装目录。

改完跑一次 `npm test`，`composition-sync.test.mjs` 会拦住两份组合的不一致。

> 想在本地边改边试，也可以不装插件，直接把 `agent-presets/minimal-gitbash/` 复制到
> `~/.dsh/.agent-presets/` —— 但这条捷径同样受 [DSH 版本边界](#limits-version) 影响。

---

<a id="license"></a>
## 许可

MIT —— 见仓库根目录的 [`LICENSE`](LICENSE)（`Copyright (c) 2025 icelily`），
与 [`package.json`](package.json) 的 `license` 字段一致。

---

## 相关

- [dsh-all-gitbash](https://github.com/liceses/dsh-all-gitbash) —— 姊妹插件：把**完整模式**下所有 pwsh 命令改道 Git Bash（带一键开关）。
- [awesome-dsh-plugin](https://github.com/liceses/awesome-dsh-plugin) —— DSH 插件精选列表。
