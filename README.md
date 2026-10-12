# AI Interview Copilot

Windows 桌面应用前端：准备聊天、个人信息与简历、面试记录和知识库管理。

## 启动

当前电脑已安装项目依赖并完成构建，可直接双击项目根目录的 `Start-Copilot.cmd` 打开软件，无需在终端中配置 pnpm。此入口使用现有构建，源代码修改后需要重新构建。

需要 Windows 10/11、Node.js 22 或更新版本，以及 pnpm（可通过 `corepack enable` 启用）。

```powershell
pnpm install
pnpm dev
```

启动已构建的应用：

```powershell
pnpm build
pnpm start
```

验证：

```powershell
pnpm test
pnpm build
pnpm test:electron
pnpm test:floating
pnpm test:composer
```

`test:electron` 会启动真实 Electron，测试界面及窗口操作，并在 `test-results/` 保存截图。`pnpm dev:web` 仅预览网页，窗口按钮需要在 Electron 中使用。

## 当前功能

- 参考截图实现毛玻璃侧栏、大面积留白、底部输入框；无档案、项目、邀请、付费等功能。
- Windows 原生 Acrylic 背景材质；顶部与侧栏共用同一层磨砂背景。系统版本、透明效果设置可能影响原生材质显示。
- 主界面是 ChatGPT 式的面试准备聊天，支持 Mock 流式回复、停止回复、新对话和复制。
- 输入框支持“＋”菜单添加文件/文件夹、直接拖放文件/文件夹、附件移除与仅附件发送；支持文档及 PNG/JPG/WebP，每条消息最多 20 个文件、每个最多 20 MB。附件只保留在当前聊天会话内，不自动替换简历或写入知识库。
- 输入框包含网络搜索开关和 GPT 通用/推理模型选择，均明确标注 Mock。发送时固定该条消息的模型、搜索和附件快照；服务接口预留这些参数。目前未联网检索、上传/解析附件或连接实际模型，切换模型不会调用真实服务。
- 个人信息侧面板：姓名、目标岗位、个人背景和 JD 的本地编辑与保存。
- 聊天支持明确标注的“姓名：… / 岗位：… / JD：…”格式。识别出更新提案后，需点击“确认更新”才会保存。
- 上传/替换/移除简历，原始文件保存在本机 IndexedDB；未接入 AI 简历解析。
- 面试记录时间线、转写与回答详情、删除确认、空状态和单独的模拟示例。准备聊天不会写入面试记录。
- 知识库创建、重命名、删除、文件选择与拖放导入、同名文件替换、文档移除、TXT/Markdown 文本预览。
- 知识库支持 PDF、Word、PowerPoint、Excel、TXT 和 Markdown；单文件最多 20 MB，每次最多 20 个。PDF/Office 仅保存原始文件，解析与检索服务尚未接入。
- 浅色/深色/系统主题，选择保存在本地；用户菜单仅设置和退出登录。
- 设置仅包含外观主题；退出登录为模拟会话退出，可返回本地演示。
- 自定义标题栏：拖动、最小化、最大化/还原、关闭。
- 按钮与导航使用 Microsoft Fluent UI 官方 React 图标。

- 点击“开始面试”打开独立透明悬浮窗口：顶部工具条、左侧转写、右侧回答，支持置顶、隐藏转写面板、最小化、结束并返回主窗口。
- 悬浮面试支持模拟转写、暂停/继续、自动或手动 Mock 回答、手动输入问题；结束后保存到本地面试记录。
- Windows 截图保护默认开启，工具条可主动切换为允许截图/共享。关闭再打开后恢复保护；采用 Electron 标准 `setContentProtection` 接口，不保证所有捕获软件均遵守，未逐一验证会议软件。

所有 AI 回复、转写和示例面试记录均为 Mock，界面明确标记模拟状态。不采集音频、不连接 ChatGPT API、不进行真实认证。模型和音频设置尚未开放。不包含截图采集、隐藏录制或会议检测规避功能。

个人信息保存在本机 localStorage，简历和知识库文档保存在 IndexedDB。聊天消息仅保留在当前应用会话内，点击新对话或退出模拟会话会清空聊天，但保留个人信息和本地文件。知识库不会被自动用于 Mock 聊天检索。

## 结构

`electron/` 主进程与隔离 preload；`src/components/` 展示组件；`src/components/ui/` 可组合基础组件（Radix + CVA 与原生模态对话框）；`src/stores/` Zustand 状态与异步生命周期；`src/services/` Mock 聊天、个人信息、历史记录和本地文档管理服务。认证、语音识别、AI 模型和知识库检索接口留待后续接入。

桌面测试使用独立的测试用户目录，不修改用户已有的简历、知识库和个人信息。可运行 `node scripts/electron-smoke.mjs --dev` 检查 Vite 与 Electron 开发模式。

`node scripts/floating-smoke.mjs` 验证独立悬浮窗口、原生保护状态及显式切换、重新打开恢复保护、模拟转写与回答、面板/置顶切换和历史记录保存。可追加 `--dev` 测试开发模式。预览截图仅在测试显式关闭截图保护后生成；原生状态断言不代表已验证所有系统截图或屏幕共享工具。接口说明见 [Electron 窗口保护文档](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable)。

第一阶段提供开发运行和本地构建，不包含 Windows 安装包发布配置。

`pnpm test:composer` 使用隔离的 Electron 用户目录检查附件菜单、文件/文件夹选择、拖放、移除、发送后清空、搜索与模型快照及无效文件校验。输入框预览保存在 `test-results/composer-light.png` 和 `test-results/composer-dark.png`。
