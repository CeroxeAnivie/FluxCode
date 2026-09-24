<p align="center">
  <img src="assets/brand/hero.svg" alt="FluxCode — Your code. Your flow." width="100%" />
</p>

<p align="center"><strong>让编码保持连贯，让工具退到身后。</strong></p>
<p align="center">基于内置 Codex 的本地编码工作空间。项目、对话、变更与终端，在同一个桌面里自然衔接。</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-3b82f6?style=flat-square" alt="Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/desktop-Windows_x64-27272a?style=flat-square" alt="Windows x64" />
  <img src="https://img.shields.io/badge/version-0.1.0-27272a?style=flat-square" alt="Version 0.1.0" />
  <a href="docs/VERIFICATION.md"><img src="https://img.shields.io/badge/verification-evidence-27272a?style=flat-square" alt="Verification evidence" /></a>
</p>

<p align="center">
  <a href="#开始使用">开始使用</a> ·
  <a href="#为连续的工作而设计">使用体验</a> ·
  <a href="docs/ARCHITECTURE.md">架构</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a> ·
  <a href="CHANGELOG.md">更新记录</a>
</p>

---

## 一个工作空间，一条顺畅的路径

<img src="docs/images/desktop.png" alt="FluxCode 实际桌面：左侧项目与任务、中间对话及模型和推理强度、右侧文件、底部终端" width="100%" />

<sub>真实 Windows 桌面截图：打开本地项目后的起始工作区。所有可见控件均来自实际应用，不是概念渲染。</sub>

## 为连续的工作而设计

| 你正在做的事         | FluxCode 如何配合                                                       |
| :------------------- | :---------------------------------------------------------------------- |
| 从一个任务切到另一个 | 每个会话记住自己的模型和推理强度，重新打开仍可恢复                      |
| 开始新任务           | 沿用最近选择的模型，强度回到 **Off · 服务默认**                         |
| 调整推理投入         | 输入框旁直接选择；Off 不发送 `reasoning.effort`，与原生 `none` 明确区分 |
| 遇到失败或需要停止   | 保留未发送成功的输入，呈现错误；运行中的任务可停止                      |
| 长时间阅读和编辑指令 | 可调且记忆的字号、中文字体回退、正文与控件同步缩放                      |
| 查看代码和执行结果   | 文件预览、Git 差异、工具调用与终端输出留在当前工作区                    |

流畅是一项贯穿产品的约束：上下文连续、反馈清楚、选择可预期。
这份 [交互准则](docs/PRODUCT-EXPERIENCE.md) 约束之后的每一项功能。

## 开始使用

当前公开版本为 **0.1.0，Windows x86_64**。
仓库提供完整源码和安装包构建流程；正式签名发行尚未提供。

构建出的桌面安装包内置 Codex，使用者不必另外安装 Codex、Rust 或 Node.js。
Windows 需要 WebView2，安装程序使用 Tauri 标准检查流程。

1. 启动应用，进入 **设置**，填写 Responses 服务地址、模型 ID 和 API Key。
2. 打开本地项目，在输入框描述任务。
3. 按需选择模型与推理强度，发送后在工作区查看执行过程与变更。

API Key 可保存到系统凭据库，也可通过指定环境变量提供。
默认网络代理为 `http://127.0.0.1:14455/`，可在设置中调整。
终端与 Agent 默认 **完全访问，无逐次审批**，请使用可信项目和服务。
Git 功能需要本机 Git；项目自身的编译器和运行时仍由项目提供。

### 自己掌控配置

- **TOML**：连接、终端、代理与界面配置；编辑时保留注释。
- **AGENTS.md**：留给用户自定义，应用不会覆盖。
- **ENVIRONMENT.md**：单独描述宿主环境，不占用用户提示词文件。
- **独立执行环境**：应用使用自己的引擎状态目录，不修改全局 Codex 配置。

应用配置位于系统应用数据目录中的 `dev.fluxcode.desktop/fluxcode.toml`。
参见 [配置模板](config/fluxcode.example.toml) 与 [引擎兼容说明](docs/ENGINE-COMPATIBILITY.md)。

## 构建桌面应用

| 层                          | 固定版本 / 职责                                      |
| :-------------------------- | :--------------------------------------------------- |
| Rust 1.98.1 + Tauri 2       | 进程生命周期、系统凭据、文件、配置与 IPC 边界        |
| React 19.3 + TypeScript 7   | 会话交互、流式展示、文件和终端面板                   |
| Node 24.13.1 + pnpm 10.23.0 | 前端构建与验证                                       |
| Codex 0.156.1               | 内置执行引擎，通过 app-server 协议集成，SHA-256 固定 |

Windows 开发机需安装 Rust/MSVC、Visual Studio C++ Build Tools、Windows SDK、Node 和 pnpm。
项目提供 Rust 版本文件及依赖锁文件。

```powershell
$env:HTTP_PROXY = 'http://127.0.0.1:14455/'
$env:HTTPS_PROXY = $env:HTTP_PROXY
$env:ALL_PROXY = $env:HTTP_PROXY
$env:npm_config_proxy = $env:HTTP_PROXY
$env:npm_config_https_proxy = $env:HTTP_PROXY

pnpm install --frozen-lockfile
./scripts/prepare-engine.ps1
./scripts/dev.ps1 dev
```

构建安装包：`./scripts/dev.ps1 build`。
输出目录：`src-tauri/target/release/bundle/nsis/`。
浏览器开发页仅用于 UI 开发，本地文件与执行能力由桌面宿主提供。

### 工程质量

领域测试、Rust 边界测试、浏览器工作流测试，以及真实内置引擎和原生桌面集成测试
共同覆盖核心路径。引擎测试使用本地 Responses 服务，不需要生产凭据。

参见 [验证记录](docs/VERIFICATION.md)、[贡献指南](CONTRIBUTING.md)、
[发布流程](docs/RELEASE.md) 和 [安全说明](SECURITY.md)。
CI 工作流在 GitHub 托管 Windows runner 上执行，使用 runner 自身网络；本机开发命令遵循上面的代理配置。

## 当前边界

当前支持 Responses 协议与 Windows x64。终端是有超时和输出上限的命令面板，
尚不是完整交互式 PTY；文件面板为只读预览，文件修改由 Agent 工具执行。
各模型支持的推理强度由服务决定，界面不会静默替换你的选择。

macOS/Linux 安装包、自动更新与正式代码签名尚未提供。
干净机器的安装/升级/卸载验收和真实生产模型账户验收仍待完成。
这些边界不隐藏在展示图里；详细状态以验证记录为准。

## 开源与致谢

FluxCode 采用 **Apache-2.0**，参见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
内置 [OpenAI Codex](https://github.com/openai/codex) 原样分发，保留其许可证和声明；
依赖许可与必要源码随安装包附带。开源许可不授予模型服务或商标权。

FluxCode 是独立项目，与 OpenAI 无隶属或背书关系。

<p align="center"><sub>Your code. Your flow.</sub></p>
