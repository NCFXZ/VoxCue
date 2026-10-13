# VoxCue 架构

更新：2026-10-13。以当前代码和 PROGRESS.md 为准。

## 职责与依赖

- src/components：展示和输入；src/stores：界面状态、异步生命周期、取消和跨对话归属；src/services：受控桌面接口适配、本机存储、内部测试实现。
- electron/main.ts：窗口、权限、服务装配及应用生命周期；electron/ipc：调用窗口校验、白名单路由和请求取消。
- electron/application/speech.ts：语音输入与面试的串行资源归属、确认配置和锁定；historyTitle.ts：后台标题队列及模型无关的 AI 接口协调。
- electron/backend/auth：系统浏览器授权和系统加密凭据；backend/chat：账户模型、Responses SSE/JSON、公开摘要、资料提案和本应用用量。
- electron/backend/speech：WASAPI 采集助手、独立 utilityProcess/Worker、本地 ASR/VAD。耗时推理不运行在 Renderer 或主进程。
- electron/contracts：DesktopAPI、频道和公开类型的唯一来源，只依赖同层纯类型或校验。preload 的运行时仅导入 electron，其他项目引用为 import type。

Renderer 不访问 Node、Electron 原生模块、后台实现、凭据或模型。backend 不反向依赖 application、IPC 或 React。AIChatService 供 IPC 和标题队列使用，不建立全局服务容器。架构检查验证静态边界、运行时循环和主进程/preload 双向频道覆盖。

## 聊天与面试回答

准备聊天通过 preparation store → chat service → preload → chat IPC → AIChatService.stream；面试回答通过 interview store → speech service → interview IPC → 同一 AI 接口。知识库参考连接已撤除，当前请求只使用用户输入、主动发送的附件和既有个人资料指令，不读取本地知识库文档。

请求保留 ID、取消语义和公开进度。事件只更新发起对话，切页/新建/切换对话不取消后台回答；显式停止、删除该对话、退出或关闭释放资源。最终正文和公开摘要校准流式事件。服务失败显示错误，不静默转为 Mock；不转发私有 reasoning/encrypted_content。

面试 IPC 对完整问题、模型与思考强度进行运行时校验，并核对主进程保存的开场配置。模型、设备和 effort 开场锁定；自动回答是可变的运行时选项。未知请求字段拒绝进入 AI 服务。

## 本机文档存储

知识库保留创建、重命名、删除、导入/拖放、同名替换和原件管理。个人简历、聊天附件和知识库文档相互独立。IndexedDB 数据库 copilot-local-documents、版本 1、bases/documents stores 及 baseId index 保持不变。这里的 IndexedDB index 仅用于按库读取原件，不承担内容搜索。

导入直接提交 IndexedDB 事务；不再触发文档解析、模型加载或后台同步。TXT/Markdown 保留有界文本预览，PDF/Office 保存原件并明确提示预览范围。旧本机派生数据未删除、读取或迁移，历史记录中的未知附加字段继续原样保存，正文不受影响。

## 语音与权限

设置 → 面试设置管理下场设备、麦克风禁用/测试、模型和 effort。开始弹窗只读确认并预检；主进程再检查一次。系统音频固定面试官，麦克风固定面试者，仅系统音频进入问题缓冲。明确禁用麦克风才跳过其权限，不自动替换失效设备。

SpeechCoordinator 保留确认副本；主窗口语音输入固定默认麦克风，不能抢占已确认面试。重载先同步保存已接收文字、释放旧服务，再使用本场配置自动开始。正常结束等待尾段；音频不保存、不上传。麦克风测试离开设置/分类或换设备时停止。

Windows 权限通过 getMediaAccessStatus 与 WASAPI 无采样初始化检查；check 在 Start/读取缓冲前返回并释放。隐私入口仅接受固定 ms-settings:privacy-microphone，不暴露任意 URL/命令。原生 helper 由 build:audio 构建，模型开发目录 local-models/speech，包内 resources/models/speech。

## 记录、窗口与凭据

记录使用既有 copilot-interview-history-v1，关闭前同步归档。主窗口通过 storage/focus 刷新；结束后标题任务由主进程排队，关闭浮窗不取消，退出登录/应用取消。标题只取面试官转录与已提交问题，不读取麦克风回答或本地资料；失败可重试，删除不复活。导出通过主窗口受限 IPC 和原生 TXT 保存弹窗。

沿用 %APPDATA%/ai-interview-copilot 和所有原存储键。登录为独立窗口、系统浏览器授权；凭据仅主进程管理并系统加密，刷新串行保存轮换令牌。保护继续使用既有 Electron setContentProtection，不扩大范围或保证所有软件遵守。浮窗固定置顶、收起/展开、缩放与结束确认保持现状。

## 构建与验证

基础检查：pnpm check:architecture、pnpm typecheck、pnpm test、pnpm build。相关桌面 smoke 使用独立 userData。pnpm package:portable 只打包当前运行依赖、语音模型和 WASAPI 助手；源码清理后先清除旧输出再构建，避免 TypeScript 留下已删除模块的 JS。

新电脑/全部多屏 DPI、真人长句和技术词准确率、物理热插拔/权限撤销、真实账户公开摘要和标题质量仍未完整验收。合成端口测试不能替代这些验收。
