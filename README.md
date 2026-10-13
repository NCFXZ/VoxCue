# VoxCue

Windows 桌面面试准备应用：ChatGPT 聊天、个人信息与简历、知识库原件管理、本地语音输入、独立面试悬浮窗口和面试记录。

## 启动

双击根目录 Start-VoxCue.cmd 使用已有构建。修改源码后先运行 pnpm build。需要 Windows 10/11、Node.js 22 或更新版本和 pnpm。

```powershell
pnpm install
pnpm download:speech
pnpm build
pnpm start
```

pnpm dev 启动开发环境；pnpm dev:web 仅预览网页，原生窗口和音频功能需要 Electron。语音模型显式下载至 local-models/speech，不提交权重；build 包含 Windows WASAPI 助手编译，使用系统 .NET Framework64 编译器。

## 当前功能

- 系统浏览器 ChatGPT 授权、账户模型与思考强度、Responses 流式回答、可选网络搜索、Markdown/GFM 和代码复制。只有真实公开摘要才提供折叠入口；失败不切换模拟服务，正式界面无 Mock/测试入口。
- 准备聊天支持附件/文件夹/拖放、语音输入、停止、对话切换与确认删除。切页或新建对话不会中断原对话；后台完成显示未读点。语音只填写已有草稿，不自动发送。
- 个人信息和回答风格本机保存；聊天更新资料先展示前后提案，由用户确认才保存。聊天附件、个人简历和知识库文档相互独立。
- 知识库创建、重命名、删除、导入/拖放、同名替换和文档删除。支持 PDF、Word、PowerPoint、Excel、TXT/Markdown 原件，每次最多 20 个、每个 20 MB；当前仅 TXT/Markdown 提供文本预览。
- 设置管理主题、账户与本应用用量、面试音频设备、麦克风禁用/测试、回答模型和思考强度。开场确认预检权限与设备，主进程再次检查；配置用于本场并锁定。
- 独立面试浮窗固定置顶，系统音频为面试官、麦克风为面试者，本地 ASR/VAD 双路转写。系统问题可手动提交，自动回答默认开启并可随时关闭；收起、展开、缩放和结束二次确认保持可用。
- 记录详情采用转录时间线和可展开回答栏，支持双向定位、后台 AI 标题、原生 TXT 导出和确认删除。旧模拟记录仅从 UI 过滤，存储保留。
- 浅色/深色/系统主题、共享毛玻璃和 Fluent UI 图标；应用 Logo 与 ChatGPT 服务图标独立。

旧知识库内容索引及参考功能已按用户要求撤除，等待新方案。导入只保存原件，准备聊天和面试不会检索或上传知识库文档，也不会自动附带本机简历。主动发送的聊天附件会随请求发送至 OpenAI。

## 数据与权限

沿用 %APPDATA%/ai-interview-copilot、既有 IndexedDB/localStorage 键，知识库/简历原件和面试记录保留。准备聊天只在本次应用会话内保存。凭据仅由主进程系统加密管理，令牌不进入 Renderer、localStorage 或日志；真实浏览器授权需用户亲自完成。

麦克风和系统音频必须明确开始，仅本机处理，不保存或上传原音频。启用的设备失效或权限检查失败时禁止开场；明确禁用麦克风才跳过其权限。截图保护沿用 Electron 标准接口，不保证所有捕获或共享工具都遵守。

本应用用量仅统计本机收到的服务端 token 与请求次数，不代表账户剩余额度；设置提供官方用量入口和确认重置。

## 开发与验证

```powershell
pnpm check:architecture
pnpm typecheck
pnpm test
pnpm build
pnpm test:knowledge
pnpm test:settings
pnpm test:interview:workflow
pnpm test:interview:access
pnpm test:history
pnpm test:electron
pnpm test:floating
pnpm test:composer
pnpm test:login
pnpm test:package
```

桌面测试使用独立用户目录和合成账户/设备端口，结果保存在忽略的 test-results。pnpm package:portable 输出本机便携程序至 release-smoke；无正式安装器、签名或发布配置。真实账户摘要/标题质量、真人长句/技术词准确率、物理热插拔、新电脑与全部 DPI 仍未完整验收。

职责和公开边界见 [架构](docs/ARCHITECTURE.md)，当前结果见 [进度](PROGRESS.md)，恢复入口见 [交接](docs/HANDOFF.md)，清理范围见 [清理报告](docs/WORKSPACE_CLEANUP.md)。
