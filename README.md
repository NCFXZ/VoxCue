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
pnpm test:login
```

`test:electron` 会启动真实 Electron，测试界面及窗口操作，并在 `test-results/` 保存截图。`pnpm dev:web` 仅预览网页，窗口按钮需要在 Electron 中使用。

## 当前功能

- 参考截图实现毛玻璃侧栏、大面积留白、底部输入框；无档案、项目、邀请、付费等功能。
- Windows 原生 Acrylic 背景材质；顶部与侧栏共用同一层磨砂背景。系统版本、透明效果设置可能影响原生材质显示。
- 主界面是 ChatGPT 式的面试准备聊天，支持真实 ChatGPT 或明确标记的 Mock 回复、停止回复、新对话和复制；回答使用 Markdown/GFM 显示粗体、列表、引用、链接、行内代码、代码块与表格，代码块支持复制，适配浅深主题和流式输出。
- 输入框支持“＋”菜单添加文件/文件夹、直接拖放文件/文件夹、附件移除与仅附件发送；支持文档及 PNG/JPG/WebP，每条消息最多 20 个文件、每个最多 20 MB。附件只保留在当前聊天会话内，不自动替换简历或写入知识库。
- 输入框包含网络搜索、模型和 effort 选择，统一为紧凑控件和菜单，模型选项只显示名称与选中标记。ChatGPT 模式使用账户模型和实际搜索；Mock 模式明确标注模拟。发送时固定该条消息的模型、effort、搜索和附件快照。
- 个人信息侧面板：姓名、目标岗位、个人背景和 JD 的本地编辑与保存。
- ChatGPT 模式中，可直接在聊天上传简历、JD 或其他资料，或要求更新个人信息。AI 在同一次回答中提出姓名、目标岗位、岗位描述、个人背景的修改，展示修改前后对比；点击“确认更新”才保存，“保留旧版”不修改。个人信息在提案生成后又变化时，禁止旧提案覆盖较新的修改。Mock 仅识别明确的“姓名：… / 岗位：… / JD：…”文本，不解析附件。
- 个人信息面板仍可上传/替换/移除本机简历，原始文件保存在 IndexedDB。聊天生成资料提案不会自动替换该原始文件或知识库文档。
- 面试记录时间线、转写与回答详情、删除确认、空状态和单独的模拟示例。准备聊天不会写入面试记录。
- 知识库创建、重命名、删除、文件选择与拖放导入、同名文件替换、文档移除、TXT/Markdown 文本预览。
- 知识库支持 PDF、Word、PowerPoint、Excel、TXT 和 Markdown；单文件最多 20 MB，每次最多 20 个。PDF/Office 仅保存原始文件，解析与检索服务尚未接入。
- 浅色/深色/系统主题，选择保存在本地；用户菜单仅设置和退出登录。
- 设置仅包含外观主题；登录页支持系统浏览器 ChatGPT 授权和显式的 Mock 体验入口。登录与主界面分别使用独立窗口，登录后交接到主窗口，退出后返回登录窗口。
- 自定义标题栏：拖动、最小化、最大化/还原、关闭。
- 按钮与导航使用 Microsoft Fluent UI 官方 React 图标。

- 点击“开始面试”打开独立透明悬浮窗口：顶部工具条、左侧转写、右侧回答，支持置顶、隐藏转写面板、最小化、结束并返回主窗口。
- 悬浮面试支持模拟转写、暂停/继续、自动或手动 Mock 回答、手动输入问题；结束后保存到本地面试记录。
- Windows 截图保护默认开启，工具条可主动切换为允许截图/共享。关闭再打开后恢复保护；采用 Electron 标准 `setContentProtection` 接口，不保证所有捕获软件均遵守，未逐一验证会议软件。

ChatGPT 登录后，准备聊天使用真实 Responses 流式回答、账户返回的模型列表和可选网络搜索，展示搜索来源。Mock 体验与悬浮面试仍为模拟功能，界面明确标记。不采集音频；音频设置尚未开放。不包含截图采集、隐藏录制或会议检测规避功能。

个人信息保存在本机 localStorage，简历和知识库文档保存在 IndexedDB。聊天消息仅保留在当前应用会话内，新对话保留当前应用会话中的其他对话，侧栏支持切换和确认删除。退出或关闭应用后清空聊天，但保留个人信息和本地文件。知识库不会被自动用于 Mock 聊天检索。

## 结构

`electron/` 主进程与隔离 preload；`electron/backend/` 原生认证服务；`electron/contracts/` 公开 IPC 类型；`src/components/` 展示组件；`src/components/ui/` 可组合基础组件；`src/stores/` Zustand 状态；`src/services/` 服务适配与 Mock 实现。前后端逻辑在同一仓库分目录维护，当前无需远程服务器。项目协作背景见 `AGENTS.md`。

## ChatGPT 登录

按 OpenAI [本地应用登录文档](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)实现系统浏览器授权、PKCE、本机随机端口回调、state/nonce 与签名身份令牌校验。首次注册使用动态客户端，后续使用本机保存的客户端标识。应用不会收集 ChatGPT 密码，也不需要在前端填写 API Key。

凭据保存在 Electron 用户数据目录 `auth-data/credentials.bin`，通过 Windows 系统加密保护；令牌不会传入渲染器、localStorage 或 Git。退出时尝试撤销远端授权并清除本机令牌，网络失败会显示未确认撤销的提示。访问令牌接近过期时自动串行续期，并加密保存轮换后的刷新令牌；授权失效后需重新登录。若旧凭据无法解密，可主动重新登录，完成授权前保留原文件。

真实账户的浏览器授权需要用户亲自完成，尚未完成真实账户端到端验证。自动化测试验证授权发起、取消、拒绝回调、身份校验、加密存储及 Mock 体验退出；不使用真实账户或生产令牌。该流程面向本地个人应用，未实现商业托管认证服务器。

登录窗口默认 960×580，无标题栏、窗口按钮、外围留白或磨砂背景，保留圆角、左侧登录与右侧预览。可拖动欢迎区域移动窗口，使用 Alt+F4 关闭。主窗口保留完整窗口操作。模型选择采用支持键盘操作的自定义菜单。`pnpm test:login` 验证独立窗口交接、登录页和模型菜单；运行 `node scripts/login-smoke.mjs --dev` 验证开发模式。

桌面测试使用独立的测试用户目录，不修改用户已有的简历、知识库和个人信息。可运行 `node scripts/electron-smoke.mjs --dev` 检查 Vite 与 Electron 开发模式。

`node scripts/floating-smoke.mjs` 验证独立悬浮窗口、原生保护状态及显式切换、重新打开恢复保护、模拟转写与回答、面板/置顶切换和历史记录保存。可追加 `--dev` 测试开发模式。预览截图仅在测试显式关闭截图保护后生成；原生状态断言不代表已验证所有系统截图或屏幕共享工具。接口说明见 [Electron 窗口保护文档](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable)。

第一阶段提供开发运行和本地构建，不包含 Windows 安装包发布配置。

`pnpm test:composer` 使用隔离的 Electron 用户目录检查附件菜单、文件/文件夹选择、拖放、移除、发送后清空、搜索与模型快照及无效文件校验。输入框预览保存在 `test-results/composer-light.png` 和 `test-results/composer-dark.png`。

## 真实聊天与本应用用量

准备聊天通过主进程调用 OpenAI Responses API，使用 ChatGPT 登录授权。模型菜单来自账户返回的可用模型列表；开启网络搜索会请求实际 web_search 工具，并显示来源。账户或模型不支持时展示真实错误，不切换为模拟回答。主动添加并发送的聊天附件会随上下文发往 OpenAI；本地保存的简历和知识库文档不会自动作为附件上传。最多 100 条消息、20 个上下文附件，附件合计 32 MB。

侧栏“本应用用量”只累计本机当前账户收到的服务端 input/output/total token 与请求次数；停止或断流未返回用量的请求不计入，因此不代表账户总用量、剩余额度或账单。通过“账户用量”打开官方页面查看账户信息。统计独立保存在用户数据目录 chat-usage，不保存聊天内容。

依据 [模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[会话与续期](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)及 [预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)实现。真实调用受账户资格、工作区和模型策略限制。此次真实账户验证被现有凭据解密失败阻断，尚未确认生产端到端成功；本地测试使用模拟 HTTP/SSE 响应验证协议。

`pnpm test:conversations` 验证侧栏对话切换、取消删除、确认删除和新对话状态。`node scripts/chat-live-smoke.mjs --live` 是显式真实验证入口，会使用已有授权和少量账户用量；不属于默认自动化测试。

输入框模型旁可选择 Effort（思考强度），默认“低 · 更快”，也可选择自动。不支持调整的模型显示禁用菜单。档位以账户公布的能力为优先，官方已确认的 GPT-6 型号提供保守回退；较低 effort 有利于降低延迟，但网络、工具和模型负载仍会影响速度。每条消息保留本次实际发送的选择。

响应接收兼容 SSE 和合法的完整 Responses JSON；JSON 完整返回不会伪装成逐字流式输出。失败或停止后清除等待状态。`pnpm test:chat-response` 使用隔离的模拟传输检查界面、IPC 和原生服务链路，不代表生产账户验证成功。官方依据：[思考强度](https://developers.openai.com/api/docs/guides/reasoning)、[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)。
