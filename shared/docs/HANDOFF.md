## 2026-10-18 当前接续（Windows 0.3.1 已发布）

最新授权已完成 Windows x64 0.3.1 的清理与公开发行，正式三项位于 windows/release/0.3.1 和 https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.3.1 。共享/根/Windows 版本为0.3.1；旧发行、资产和 v0.3.0 Latest 保持，Mac 仍使用其完整0.3.0发行。用户随后明确授权本轮共享/Windows 源码、测试与文档提交推送至私有 main；排除发行、模型、构建/测试产物、清理审计、真实资料和密钥。当前 Windows 工作期间 macos/ 严格只读，下面的共享功能现包含在 Windows 0.3.1；Mac 须在本机补齐字号图标、同步配置并验证，后续提交/打包/发行另需用户授权。

Mac 本机接续入口：先读取 AGENTS.md、PROGRESS.md、shared/test/README.md 和本文，检查本机差异后安全同步 origin/main，不 reset/clean 或覆盖未提交工作。windows/ 在 Mac 保持只读，shared 继续为页面与业务唯一实现；允许在 Mac 本机完成必要的 macos/ 适配。具体补 macos/src/icons.tsx 的 FontDecrease/FontIncrease 导出及 macos/src/symbols.json 的真实字号减小/增大 SF Symbols 映射，沿 build:symbols 生成资源，不用文字或加减符号替代。

在 Mac 仓库根运行 sync:workspace 只生成根与本平台配置，核对 macos/package.json 为0.3.1；依赖仅在 macos/ 按冻结锁安装，不升级版本，Windows 配置/锁保持。完成 SF Symbols 资源后按测试说明运行完整离线单测、typecheck、check:architecture、check:workspace、build 和 Mac 可用的 functional-suite/原生专项。重点检查 Cmd缩放禁用、字号图标/同步、折叠动画及减少动态效果、分隔栏/弹窗/圆角滚动、提示词及技能纯文字、完整历史和 Local RAG 失败回退、生命周期与组件释放。Mac 旧测试需按现行折叠区和主提示词更新操作，不删保护断言；wait-for-async 用于异步 IPC/IndexedDB 条件。

Mac 测试仅合成账户/资料/采集端口与固定公开模型/音频，必要工作文件只放系统临时目录并在成功/失败/取消/退出清理；结果只终端/对话，GUI/原生串行。真实账户模型、真人音频/屏幕、已取消十分钟语音和历史占用/跳过目录不自动恢复；扬声器回录尚未修复。Windows 验证不计作 Mac 验收，文档只记录实现与入口。接续阶段不自动提交、推送、打包或发布，不改变 Windows 0.3.1、旧发行、Latest、标签或仓库设置。

最新第2/4/5组补充已按确认稿写入：面试追加段区分简历事实、JD岗位要求和skills参考资料；准备聊天采用精简稿，附件/网页/引用仅作资料，移除执行自定义指令的拼接，字段仍可编辑且仅在面试阶段应用；技能选材优先官方/标准/一手资料，关注版本和适用条件。Local RAG 只在搜索/条目读取故障或原15秒检索超时时回退，保留完整有效同库条目或无证据继续回答，原请求取消、参数/配置/身份错误、组件未就绪和模型失败仍停止。不重试、不增加模型调用，不改历史/存储格式、模型、effort、知识库选择或证据预算。检索失败通过独立活动/参考数据状态表示，不影响回退答案写入后续面试上下文。入口为 rag、rag-tools、desktop-ipc、profile-store、profile-proposal 单测与离线 profile-ui、chat-progress、interview-usage/context/stability 桌面专项；只用临时合成资料，不代表真实模型质量验收。

本地已按逐组确认更新第1–5组提示词。第5组明确资料更新意图、逐次保存确认和摘要不附联网说明；技能按钮直接请求真实联网筛选适量面试资料，不设固定写作字数、不凑数量。技能预览/提案/保存条目/回复及复制共用纯文字展示，网址与来源栏隐藏；原文、来源元数据和严格真实检索匹配仍保留。profile-ui 与 chat-progress 的技能断言改为纯文字及后台来源保留，普通聊天引用保持。用户随后要求第6组清理：已移除旧风格模块、状态、读取和拼接，真实旧键不改写；第7组已按进一步确认稿完善全部现用快捷请求，个人事实/贡献/摘要范围明确，直接发送与草稿入口的时序保持。“不生成技能”等明确否定在技能请求识别前排除，独立肯定请求仍生效，避免摘要补充误触发任务或丢失附件。第8组标题提示词已按确认稿写入 historyTitle.ts，通常10–20字、最多30字，主题简单可更短，仅使用明确主题/岗位，无明确主题时用“面试记录”；现有代码校验和调用生命周期保持。第7/8组入口为 profile-store、renderer/services/preparation、history-title 单测与离线 profile-ui、history-branding 桌面专项。旧版本风格兼容、技能篇幅和来源展示记录仅为历史状态。

本地共用界面另已按用户确认增加默认折叠/展开动画、个人信息弹窗编辑和分隔栏调整、100%页面缩放锁定、知识库上传/索引精简及组件排版，入口见测试说明。Windows 字号控件使用现有 Fluent FontDecrease/FontIncrease。用户明确要求 macos/ 只读：Mac 本机需补 macos/src/icons.tsx 的这两个导出、symbols.json 的对应 SF Symbols 映射并沿原流程生成图标，之后再构建/验证；共享逻辑不需要复制，不能将 Windows 验证描述为 Mac 已适配。

91ce5a6 工作区已局部撤销明确回应自动过滤、历史 textRef 引用、相关历史选择和 KnowledgeService 精确查询 LRU。回应按原 2200ms 条件正常自动提交；历史在原 120 条/64000 字节/每条 6000 字边界内完整发送各条原文和身份/问题关联；RAG 继续按末尾当前问题检索，重复查询执行原流程。用量统计、token 账本及重置、模型/effort/篇幅、片段去重、排队/取消/迟到保护、其他 0.3.0 功能和 Windows 原生修复保持。

原有工作已保留；0.3.1公开发行授权之后，用户又明确授权本次私有源码同步，先前阶段限制不阻止当前提交/推送，均不延伸为未来自动发布。当前 Windows 工作中 macos/ 严格只读，依赖不升级。shared 仍为页面和业务唯一实现，Mac 运行验证需在其本机执行。入口见 [测试说明](../test/README.md)，合成数据与离线宿主在系统临时目录运行并退出清理，结果只到终端/对话；正常退出并重开本地开发应用才能加载新构建，不中断真实应用。

以下发布与优化记录为历史状态；已发布 0.3.0 不包含本地撤销，历史单次提交/发行授权不适用于本轮。

> 2026-10-18：Windows 0.2.2 源码 8b77781 已同步私有 main；用户随后授权正式打包发布三项 Windows 资产到公开既有 v0.2.2，并将其设为 Latest。Mac 原有三项及全部旧发行/资产保持，macos/ 只读。剩余发行与清理文档按用户最新明确授权提交推送至私有 main，不提交发行文件、模型、清理审计或测试产物，不变更公开发行。实现、构建与隔离验证入口见 COMPONENTS.md、UPDATES.md、shared/test/README.md 与 AGENTS.md 首节；下文旧工作状态为历史记录。

# VoxCue 当前交接

当前 Windows 入口：test:windows:functional、test:windows:regression、test:installer:isolated、test:ui:dpi。模型及安装态验证使用自有系统临时根，结束清理，不动真实资料/凭据/缓存。窗口保存与快速重新登录、异步 IPC/IndexedDB 测试等待已修正；测试结果仅到终端/对话。Mac 专属 components-smoke 的异步等待适配由 Mac 本机继续，不在 Windows 改写。

> 2026-10-18 历史 Mac 主线合并记录：当时用户仅授权原样同步远端已有 Windows 文件，不在 Mac 修改其实现/配置或运行其原生测试，不上传 GitHub。源码版本 0.2.2，Windows 配置和 Copilot 专属清理留待 Windows 本机完成。以下 Windows 续作说明记录远端已合入实现。

> 用户已于 2026-10-17 恢复完整功能、稳定性和对抗性测试授权；下文旧暂停状态为历史。结果只在终端/对话，必要工作文件临时使用并清理，不保存报告/日志/截图/验收数表。当前在 Windows 续作，macos/ 只读；Mac 117 个旧占用目录和 Windows 349 个跳过目录不重试。

## Windows 当前接线与继续工作

透明窗口退出转发时的迟到 mouseout 必须重新命中坐标，不能无条件恢复穿透；原生回归覆盖鼠标仍在输入框时的这一交接。探针使用原生移动事件触发 Electron 的低层转发钩子，不能把仅设置光标位置当作等价的输入验证。

Windows 配置经本机生成器同步，构建边界为 shared/windows。`windows/electron/presentation.ts` 实现共享展示端口；运行时按系统版本声明 Acrylic 表面能力，应用主题、normal 置顶、转发穿透和任务栏恢复不调用 Mac API。`screenPermission.ts` 返回 not-required，申请/打开设置请求明确拒绝；检查本身不捕获屏幕。共享截图的取消、超时和内存约束保留。面试 Renderer 退出会恢复主窗口，单实例复用已打开窗口。

右上角窗口按钮需在内容后形成 no-drag 控制层；不可仅依靠视觉 z-index 覆盖页面拖动区域。Windows 分数 DPI 下浮窗移动固定手势起始尺寸并补偿回读，测试按原生像素网格检查位置、严格保持尺寸。CSS 滤镜以前缀属性在前、标准属性在后，保证生产压缩保留有效属性；强制高对比度使用不透明回退。共享偏好、60/30 曲线、Fluent 图标及历史存储键/内部布局保持；数据根迁移规则见 COMPONENTS.md。

命令见 shared/test/README.md。已改造的 Windows 脚本使用 test-workspace，自有临时 profile/文档/便携包结束清理；真实鼠标回归串行。其余旧硬件/真实安装脚本仍有持久化或真实环境副作用，不能直接运行。源码同步范围见本页首节，不用合成账户、捕获端口或图片代替真实服务/硬件/截图验收；完整退出重开才能加载新的 main/preload。

## 2026-10-17 故障恢复与测试入口

共享语音控制器现在及时结束初始化前 Worker 退出的等待；启动/停止清理失败仍退休旧实例、清除回调及旧积压/时间锚点并允许重新开始；尾段 Worker 退出或超时明确失败并清理待处理请求，启动过程中已报错不再广播 running。截图原生枚举支持及时取消、十秒期限、迟到结果退休及监听/计时器清理，不更换系统捕获或绕过权限。Mac Dock 隐藏同时避开最近 hide 与 show 的保护期，包含 show Promise 完成时间；隐藏在窗口显示操作后执行，保持原图标恢复和自动行为。

共用/Mac 回归已改为临时工作区及内存/终端结果；新增重复面试、透明度偏好对抗、原生展示竞态、真实 utilityProcess/ASR 合成音频、故障注入和测试中断清理入口。正常应用/真实资料不参与测试，现用原生组件占用时改在临时目录编译验证。命令及原生/合成边界见 shared/test/README.md；本轮验收数字与输出仅在终端/对话，不在文件中保存。完整退出并重开加载 main/preload 更新，勿中断现用应用。真实屏幕捕获须用独立严格入口检查，不以合成截图发送链路代替。

## 2026-10-17 清单 1–10 共用化

用户已明确授权全部 1–10 项共用，不为自动行为新增开关。设置共用透明度滑杆、0–100/默认 50/关闭 0、60/30 浮窗映射和本机保存；主题、屏幕权限入口、置顶/穿透/图标隐藏状态、用量链接同排右对齐、紧凑窗口布局和焦点外圈规则使用同一份 shared 界面。图标库及 Mac 左侧原生红绿灯/Windows 右侧控件差异保留。

纯 PresentationCapabilities 由可信平台策略经 BrowserWindow additionalArguments 传给 preload，只公开冻结布尔状态；缺省为待适配。NativePresentation 类型端口连接 Mac 的独立展示实现，Dock/应用外观/原生穿透实际调用已从 main 移至 macos/electron/presentation.ts；生命周期、授权和异步恢复竞态仍在 main。原生材质、系统主题、真实数据及 Windows 文件保持。

Windows 本机后续待办：接入透明度效果和应用原生主题、实现独立屏幕权限、透明空白鼠标穿透、面试期间任务栏图标隐藏/结束恢复，并完成本机编译与运行验收。当前共享控件允许保存滑杆，效果注明待适配；权限申请禁用，自动行为只显示实际状态/待适配，不执行假的成功回执。基本 normal 置顶及最小化沿用原行为。不要在 Mac 写 Windows 适配器或生成其构建。

后续每项新功能/界面调整在动代码前按 AGENTS 询问用户是否两平台同步并给出建议；已有明确范围不重复询问，本轮授权不延伸为未来默认授权。编译状态见 PROGRESS 最新节；测试仍暂停，没有运行或保存测试结果。正常结束当前面试、Cmd+Q 完全退出并重开加载 main/preload/Renderer，勿中断现用应用。

## 2026-10-17 Mac 面试 Dock 与持续置顶

修复结束面试后 Dock 恢复成默认 Electron 图标：show 前后均重设 VoxCue 图标；开发宿主包内默认 ICNS 改为 VoxCue，生成缓存包含图标摘要。主进程已编译，新宿主已生成，包内图标摘要及静态签名核对通过，旧运行宿主保留。正常结束后 Cmd+Q 完全退出并重开加载；没有启动窗口测试或修改待确认的共用设置。

面试浮窗显示时隐藏本应用 Dock 运行图标及主窗口；确认结束后恢复 Dock 和主窗口，退出时不恢复。浮窗使用 floating 层级，所有桌面/全屏可见，显示/恢复或置顶意外关闭时重设；失焦不重设层级、不抢键盘焦点。处理连续 Dock hide 间隔及 show 完成时新面试已打开的竞态，重复启动优先面试浮窗。Windows normal 置顶与主窗口最小化流程保持，不修改 Dock 全局偏好或固定项。

最新修复透明画布拦截鼠标：Mac 的透明留白、面板间隙和空提示区穿透后方应用，鼠标回到工具栏/面板/缩放热区/提示卡时恢复交互。使用受限布尔型 interview:mouse-passthrough 和官方 forward 移动事件，不禁用输入框焦点；按下/拖动/缩放时锁定，布局变化重算，卸载/重载回退穿透。公共契约、preload 和现有白名单断言已同步；Windows 不调用该接口。

本次需完全退出并重开以加载主进程更新；测试继续暂停，未执行窗口运行验收或保存测试结果。编译状态见 PROGRESS.md 最新节。

## 2026-10-17 Mac 连续透明度与浮窗

最新透明度入口为 0–100 连续滑杆，默认 50、0 关闭。主侧栏按全范围生效，面试浮窗面板/工具栏及模糊按原曲线的 60×滑杆比例取值，气泡/输入底色按 30×滑杆比例取值。滑杆 100 对应背景/阅读层 60/30，50 对应 30/15，全程连续，不再在 60 后停滞。数值为相对效果位置，不是窗口整体透光率。v2 数值键优先，旧四档只读映射 0/25/50/100。此前白/黑文字光晕、细描边与图标阴影均已移除，不再用字下晕底提高可读性。两端图形 18×16px；辅助功能时回退不透明。系统主题、原生材质、既有主题 IPC 不改，Windows 只读。

Renderer 类型与 Vite 构建成功，123 项 Windows 文件保持；测试仍暂停，无运行/截图或测试结果保存。正常重开加载后可即时拖动同步。

## 2026-10-17 Mac 应用原生外观联动

深色网页配浅色原生侧栏的问题已补上本应用主题同步：登录/主窗口通过受控 appearance:theme 设置 VoxCue 本进程 nativeTheme.themeSource，白名单为 light/dark/system，仅允许已注册窗口的主 frame，Windows 不应用。不修改 macOS 全局主题或其他应用，不替换原生 sidebar 材质，强档仍为零遮罩/零附加滤镜。

主进程、preload、Renderer 和契约类型均已编译；需 Cmd+Q 完全退出后重开。测试继续暂停，没有运行或保存测试结果，未进行本轮原生视觉验收；123 项 Windows 文件哈希保持。

## 2026-10-17 Mac SF Symbols

全部 45 个操作图标接口在 Mac 使用 SF Symbols，映射与 React 适配在 macos/src，公开 AppKit 生成器在 macos/native/SymbolBuilder.mm；工具/缓存/透明资源留本平台，无新 npm 或全局依赖。Vite 仅在 Mac 替换公共 icons 入口，构建拒绝混入 Fluent UI；Windows 默认原实现，品牌 Logo 保持。Mac Renderer 纳入类型/架构边界，图标专项单测在 Windows 跳过，禁止为跨平台测试在那里生成 Apple 资源。

148 模块架构、361 单测、类型、Mac build、图标/窗口/启动器/屏幕权限/聊天回归通过。隔离界面和完整符号浅深预览已目视检查，音频为合成 fixture；证据见 macos/test/results/sf-symbols-20261017，前态与只读核对在 macos/recovery/sf-symbols-20261017。正常 Cmd+Q 退出再双击 macos/VoxCue.app 加载新版；入口不编译/下载。不修改 Windows、不提交推送或发布，完整范围见根 PROGRESS 最新节。

## 2026-10-17 Mac 独立屏幕权限

开场新增独立屏幕权限状态，未授权仍允许纯语音面试。设置 → 面试设置 → 允许捕获屏幕提供申请、重新检查和固定系统设置入口，返回后刷新；仅用户点击申请才调用公开 Core Graphics 权限 API。检查/申请不读取像素或录屏，不自动开启“附截图”，真正截图继续实时检查权限。

Mac 新增主进程身份的 Node-API 绑定，完整 build 已包含 build:permissions；build:shared 不生成原生绑定。已更新本地开发宿主用途说明和 VoxCue.app，需 Cmd+Q 正常退出旧应用再双击 macos/VoxCue.app 加载本轮代码。没有改动真实用户资料、TCC 或 Windows 文件。

147 模块架构、356 单测、类型、Mac 构建及隔离权限/窗口/启动器/聊天回归通过。实际绑定验证已有 granted 权限及幂等请求；新增授权/拒绝/撤销 UI 为合成测试，不等于真人系统弹窗验收。旧报告曾位于 macos/test/results/screen-permission-20261017，现已清理，不再作为可用交付物；前态、Windows 123 项保留核对与历史清理审计在 macos/recovery/screen-permission-20261017。未运行十分钟语音、未提交推送或发布；详细范围见根 PROGRESS 最新节。

## 2026-10-17 Mac 原生模块与双击入口

最新限制与修正：先读根 AGENTS 的“平台之间只读”。Mac 不得写 windows，Windows 不得写 macos，涵盖间接脚本操作。Mac 构建已移除 Windows 输出，同步、格式化、图标生成与根构建保护也按宿主执行。Windows 现有 package.json、tsconfig.electron.json 漂移和 dist-electron/macos 旧产物须在 Windows 本机 corepack pnpm sync:workspace 后 build；当前 Mac 保留其字节，不跨平台修复或回滚此前工作。

Mac Dock/启动器从原图生成带 96px 透明留白的 1024px 衍生图（素材 832px），位于 macos/public；原件/Windows 图标保持。正在运行的旧应用需正常退出再双击 VoxCue.app，不重启 Dock 或清理全局缓存。此轮前态与只读核对在 macos/recovery/platform-boundaries-20261017，验证见 PROGRESS 最新节。

先读根 AGENTS 的最新授权与 macos/docs/MACOS_PORT.md。Mac Core Audio 双音源、共用 ASR 管线、原生窗口/Dock/保存退出及本地 VoxCue.app 入口已实现；Apple Silicon/macOS 14.2+，目录和依赖局部规则保持。Liquid Glass 已按 2026-10-17 用户要求取消，源码恢复到指定实施消息之前；材质/原生控件覆盖层和相关 IPC/专用测试已移除，当前仅保留此前标准 vibrancy。回滚未运行测试，现有启动产物已重新编译；清单和可恢复备份见 macos/recovery/rollback-liquid-glass-20261017。Windows WASAPI 原生实现保留，Mac 验证不代替 Windows 硬件/NSIS。源码前态与保留校验在 macos/recovery/native-audio-20261017，当前结果见 PROGRESS；没有发布安装包或提交/推送。

## 2026-10-17 工作区目录迁移

先阅读根 AGENTS.md 的最新目录规则和 WORKSPACE_LAYOUT.md。根入口自动选本机平台，安装依赖必须进入 windows 或 macos。Windows 现有依赖/构建/发行已整体迁移，shared 只保留唯一共用源码、模型与原件。Mac 已建立独立 arm64 安装与共享编译入口，不等同完整移植；没有新增安装包/签名或恢复语音实验。不要恢复根 node_modules 或 shared/node_modules。

迁移原态与映射在 macos/recovery/workspace-reorg-20261017；按指定文件/逻辑块恢复，不整库 reset/clean。用户最后要求清除全部既有历史测试产物，历史报告正文仅作记录，不再保证其截图/报告路径可用；后续两平台测试结果均零保留；旧脚本须先完成临时目录和清理改造再获准运行。真实账户数据/凭据/原件、存储键与用户目录不变，已有 shared/src/assets/chatgpt.svg 修改保留。构建/验证最终结果以根 PROGRESS.md 最新节为准。

2026-10-16最新完成：0.2.0清理、平台分类、336单测和42组桌面/原生/实际安装包回归通过，功能提交45af921已推送私有origin/main；公开[Windows v0.2.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.2.0)已发布并设Latest，三个服务端资产大小/SHA256、清单下载及生产分平台选版逐项核对。600,421,158字节，SHA256 92b8acb151bc83b7eef664804047993d063c6b0921f24e730cdb9c831d3d6aca，正式包与installer-stage保留；历史Windows/Mac分支、默认Windows和旧发行未改。用户要求不要10分钟语音，已停止、不计入验收、不重新启动；真人语音、真实账户和Mac真机仍未验收。

清理581个旧profile缓存目录（2207文件/917,572,989字节）和验收后4项隔离安装/下载副本（88文件/1,730,629,512字节），失败0；恢复基线、报告、截图、profile、用户资料、原件、凭据、依赖/模型和退役benchmark保持。证据在test/results/release-v0.2.0；被移除验证副本不再作为可用交付物。当前源码、根构建和正式安装包均为0.2.0，不需要重复发布。以下为历史记录。

2026-10-16最新发行：v0.1.2 Windows x64已打包验证并发布 https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.1.2 ，三项资产state/大小/SHA256和公开latest.yml下载逐项核对，已设为Latest供旧客户端过渡到分平台更新。实际installer-stage六组专项通过，安装包600,418,657字节，SHA256 e5bb67711871dad5915d3e6ab66ff0bb415c9fd4994b2f7e158c2a15f8dfbaa2；原0.1.0/0.1.1产物保留，没有提交或推送私有源码。根构建及installer-stage为0.1.2，正式文件在release/installer，本轮证据在test/results/release-v0.1.2。大文件前两次网络失败，按用户要求刷新草稿清除失败占位后第三次上传成功；不要重复发布。仍未签名，无Mac包，真人语音/真实账户/Mac真机未新增验收。

2026-10-16最新：完整功能回归及检查更新动画修复完成。315项单测、36组功能回归（含66种UI状态、真正原生/离线RAG/更新/隔离NSIS升级/ASAR与10分钟合成音频）通过；测试路径和过时夹具已修正，原失败日志保留。真人语音按用户选择稍后测试，真实账户与Mac真机未验收；旧报告已清理，现用入口见../test/README.md。根构建已更新，公开安装包未重打，未提交推送发布。test/results/platform-layout-functional-20261015-697d9556验证包及本轮安装/下载副本验收后移除，portable-current-VNSxgj等报告/截图与functional-20261015-697d9556审计仍在，不把已删除测试包当作交付物。

2026-10-15最新清理：AGENTS已更新为当前状态和长期保留/清理规则，删除test/results内265项过期合成运行目录/下载缓存及已验收便携副本，逻辑约7.64GB；保留必要报告/截图、各组最近结果、全部迁移/恢复快照与生产资源。platform-layout-20261015已移除，其验收证据仍在portable-current-kD1Dco及platform-folders-20261015；不要把该旧测试副本当作现存安装产物。业务源码未改，不重复打包/发布；核对与清单见WORKSPACE_CLEANUP最新节和test/results/workspace-tidy-20261015。

2026-10-15最新：生产源码已按shared/、windows/、macos/整理，测试源码/脚本/夹具集中test/shared与test/windows，旧test-results整体迁为test/results，全部恢复快照保留。根启动脚本仍为Start-VoxCue.cmd，编译入口为dist-electron/shared/electron/main.js；pnpm命令保持，ASAR/Worker/utilityProcess引用同步。仅清理确认过期编译输出与空目录，未改用户数据/凭据/模型/DLL/原件位置；benchmarks保留退役历史资料，未重新实验。未提交推送、重建交付安装包或发布；目录规则/旧路径映射见WORKSPACE_LAYOUT.md，以PROGRESS最新验证为准。

分平台更新仍为Windows x64/macOS Apple Silicon arm64独立筛选最高完整正式Release，不依赖统一Latest或Atom；Mac完整移植/签名/真机安装未完成。既有公开v0.1.1不含这些新代码，后续须先升级到含新逻辑的安装包。更新文件协议与过渡见UPDATES.md。

2026-10-15 最新：本轮统一main/跨平台边界与安全清理已完成，详见CROSS_PLATFORM_REFACTOR.md及PROGRESS首节。当前本地main=4247ef0，承接全部既有未提交功能；Windows/Mac=04448bb及其他原分支保留，不要把创建main当作已提交完整快照。没有提交推送或修改远端默认分支；GitHub连接器和git ls-remote均网络失败，远端实时状态未确认。

平台纯策略/路径位于shared/electron/platform，共享窗口配置/导航/入口在shared/electron/window.ts，main保留业务生命周期；backend/application不导入桌面策略。Windows完整窗口选项、76个Renderer文件、preload/公开契约和数据格式保持。sherpa Windows原生包固定1.13.8移为平台可选，打包仍明确要求；锁只同步分类，版本/完整性原样，原供应链及冻结锁校验通过。没有恢复任何撤除实验。

根目录最新Windows构建、134模块架构、类型/noUnused、295单测、14组桌面回归、真实无采样Worker/utilityProcess设备枚举及离线RAG通过。测试均隔离数据与合成账户，未使用真实凭据或启动音频采样；原并发PDF超时及离线元数据不足日志保留，正常独立/联网重跑通过，没有放宽门槛。Start-VoxCue.cmd继续使用根构建，不自动编译。build:shared只编译共享代码，完整build仍构建Windows助手；Mac未完成真机/权限/钥匙串/原生依赖/采集/分发，不虚称支持。

现有v0.1.1安装包保留，但不含本轮架构整理；本轮不打包、签名或发布。旧版本的发布状态和以下其他记录为历史信息，不是本轮操作授权。前态快照与审计在test/results/cross-platform-20261015，真实用户数据/凭据/原件/记录/派生数据均保留。

2026-10-15 最新：用户要求修复后再打包，五项对抗缺陷已修复，生产依赖四告警降为0；129模块架构/typecheck/build、279单测、39原探针通过。v0.1.1安装包600,425,395字节，SHA256 a24a76a683f5d4919499ce51917de4a863d1cb06339fde59760110a00d80a128，三项文件在release/installer。实际安装目录的缺陷UI/50轮取消/Copilot/进度/原生语音与资料、真实更新下载SHA512校验通过。已在正常GitHub浏览器会话发布 https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.1.1 ，公开API确认latest及三项资产哈希/大小，公开latest.yml下载核对通过，README下载版本已更新。旧v0.1.0含已修复缺陷且未上传。报告与截图在test/results/release-v0.1.1/。保留未提交工作与真实用户数据，没有推送私有源码。此节覆盖下面v0.1.0待登录/旧问题未修复的历史记录。

2026-10-15 最新安装包：用户已授权打包并发布。当前v0.1.0完整NSIS重建、实际包原生/双服务/聊天/恢复/安装升级/更新哈希验证通过，三项发行文件在release/installer；哈希与报告见test/results/release-v0.1.0及PROGRESS首节。公开NCFXZ/VoxCue-releases已初始化仅安装使用README的main，私有源码未推送。Release附件上传等待正常GitHub浏览器登录，当前不能称已发布；登录后用已有准备好的三项文件和release-notes发布，不重新提取凭据或混入builder-debug/测试文件。安装包未签名，使用说明见INSTALL.md。此节覆盖下文“本轮未打包”的历史状态。

2026-10-15 最新全界面检查：登录、聊天、个人信息、设置六页及菜单、知识库各态、记录与回答栏、开场和浮窗共66个状态，浅深主题及1280×800/960×680；局部修复设备卡片报错错位、表单高度/标签间距、长下拉名称、文档动作分组和错误行、紧凑上传区横排、主题错误颜色、记录选中按钮悬停对比度及标题重试尺寸。没有重写窗口/OAuth/存储或移除现有功能。清除24个无消费者类的42个CSS选择器及一个未用导入；引用图确认其余业务/图标在用。

过期生成条目1085个、35037文件、逻辑大小约5.04GB已删除，清单/验证在test/results/visual-cleanup-20261015。保留真实用户目录、原件、凭据、模型、依赖、私有/派生/历史数据和恢复基线。release/installer-stage与release-smoke暂存已清除，release/installer现有安装包保留，不能当作本轮版本；根目录构建已更新，正常退出后Start-VoxCue.cmd加载。没有打包、提交、推送或发布。现用界面入口见../test/README.md，清理边界见WORKSPACE_CLEANUP及PROGRESS最新节。

2026-10-15 修复 Copilot 登录后“Windows 凭据加密存储不可用”：根因是 SDK 1.0.21 的 empty 模式主动设置 COPILOT_DISABLE_KEYTAR=1，并非已确认的系统故障。CopilotRuntime 改用 copilot-cli 模式保留 OS vault，isolatedSession 显式保留原 empty 的能力限制，拒绝明文和继承外部凭据的边界不变。根目录构建已更新，正常退出后从 Start-VoxCue.cmd 重新启动并授权；不删除/迁移凭据、用户数据，也未打包、提交或发布。真实 runtime 启动环境/会话隔离、PKCE/取消及合成加密失败重试/双服务 UI 回归已通过；真实账户令牌写入与推理仍需用户正常授权验证，不能称已验收。报告 test/results/copilot-ui-Fh7dTB/report.json，基础检查见 PROGRESS 最新节。

2026-10-14 最新追加：GitHub Copilot 与 ChatGPT 双服务登录已接入，官方 SDK 浏览器 PKCE 流程无需用户创建 OAuth App；此前索要 Client ID 的问题作废。只保存身份/服务选择，SDK 系统加密存储凭据；拒绝明文回退，不借用环境令牌或 gh 凭据。模型/vendor/effort 与服务提示采用实际目录，逐回复保留来源；Copilot 私有推理不展示，搜索需要实际 runtime 工具能力。正式账户授权和推理仍由用户正常使用验证，勿以合成测试声称通过。固定 SDK/运行时、恢复边界见 已撤除的 Copilot 历史说明 和 ARCHITECTURE。

登录页统一按钮、图标对比度和间距，左侧内容居中、右侧预览随主题；箭头统一细折线。准备聊天正文开始后，公开进度自动收进“用时”且可展开。面试新问题在旧回答忙碌期间保留并补交，清空输入后新系统转写恢复回填；麦克风间断不清除系统问题。没有接入 AEC，扬声器回录仍需耳机等物理隔离。原生助手源未变时增量构建复用，勿为重编译停止正在进行的用户面试。最终检查/本地安装产物以 PROGRESS 首节为准；下文“尚未接入其他提供商”为旧记录。

2026-10-14 最新：截图中的长输出失败实际为技能引用校验失败。修复流式来源漏收、旧50项来源上限和同页片段/白名单追踪参数误匹配，保留真正无来源的保存阻止；补齐快速失败丢失已收预览的 IPC 竞争，失败快照没有可确认 changes。技能默认3–5项短说明，answer 不重复全文，来源先显示3条，其余折叠；只读预览与完整提案按技能分隔。有公开思考内容才保留旧状态，否则替换为空间更少的最新状态，当前状态也滑过高亮。用户已撤回中文偏好，公开摘要不设置语言要求；缺少摘要提示末尾“可以继续聊天。”已移除。没有迁移真实数据，模型实际语义/速度仍需真实使用检验。最新检查与本地安装产物以 PROGRESS 首节为准，后文中文偏好为先前记录。

2026-10-14 最新展示：准备聊天时间固定在进度最上方并带下分隔线；真实状态和公开思考主标题按顺序逐行排列，移除通用“推理摘要”标签。标题默认折叠，右侧 Fluent 细箭头仅悬停/键盘聚焦出现，当前标题滑过高亮支持减少动画偏好。准备输入框随手动输入/换行/折行/草稿恢复保持2–11行，超出内部滚动。公开摘要请求优先中文，服务语言仍不保证。沿用聊天 v1 元数据，新增 activities 的 status/reasoning 类型，旧正文/摘要读取保留；旧版没有状态顺序时仅按已有摘要显示，不自动补造或迁移。最新检查与安装产物以 PROGRESS 首节为准。

2026-10-14 最新聊天修复：准备聊天折叠展示服务实际返回的公开摘要、commentary 与搜索/读取/页内查找活动，新增每秒更新且完成/失败/停止后持久保存的处理用时；旧聊天无时间不补造。Responses 移除三分钟总时限，独立五分钟响应头等待/流静默计时，心跳与数据重置静默限制；显式取消与工具预算保留。按钮确认状态进入后续模型历史，“确认/确定/同意”等对最近有效提案本机处理并标 VoxCue 身份；缺少 JD 不阻止普通聊天，补充摘要不误触发技能研究。沿用聊天 v1 可选元数据，无真实数据迁移；真实服务长回答质量仍未验收，公开摘要详略由服务决定。最新验证与安装产物以 PROGRESS 首节为准，不使用下文旧产物描述判断版本。

2026-10-14 最新：接入 Windows x64 NSIS + electron-updater，设置新增“更新”。更新源固定独立公开 NCFXZ/VoxCue-releases；源码仓库经 GitHub 元数据确认仍私有，用户创建的发布仓库也已确认公开。pnpm package:installer 只生成本地文件，不上传/发布；开发/便携启动明确不可更新。启动主窗口后台检查下载，只有显式点击重启可安装；面试/开场预检阻止安装，安装准备期间阻止开场，复用现有本地保存握手。用户路径与数据格式不变。当前安装包未签名，真实 GitHub 在线更新在首个正式 Release 发布后验证；验证状态以 PROGRESS 最新项为准，详细操作见 docs/UPDATES.md。

2026-10-14 最新澄清：普通聊天/草稿/附件本机持久保存，关闭及退出登录不清空；面试浮窗只清空临时会话，历史记录继续保留。独立voxcue-preparation-chats v1数据库，关闭等待本地保存成功，失败保留窗口。资料提案逐步显示只读预览，完整校验后才能确认；缺少简历/JD时技能入口说明原因并可补充，不再无说明禁用。旧版本已丢失的内存聊天无法恢复，不读取真实用户目录来猜测恢复。验证/新数据库恢复边界见PROGRESS首节及ARCHITECTURE/PERSONAL_INFO。

2026-10-14 最新：发送圆按钮使用主题色，按最新比例反馈采用20px上箭头与20px麦克风，32px热区/8px间距。删除用户截图中的面试设置说明、知识库高级诊断及关于页介绍。模型/回答增加可选提供商显示元数据，通用提示随所选模型变化，回复/历史保留生成时的实际来源；旧字符串兼容，未知来源通用显示。真实ChatGPT登录/授权保留，尚未接入其他提供商。验证与构建状态见PROGRESS首节。

2026-10-14 最新交互：所有删除改为原按钮二次确认，侧栏确认按钮80×28px、内缩6px。用量重置也在原按钮变为“确认重置”，取消不清零，执行中防重复、失败保留统计；删除旧顶部/弹窗确认及用量下方确认区域。用户已撤回完成勾选/完成状态需求，没有添加。共享控件与业务store分工不变，没有新IPC。最新验证见PROGRESS首节，早期删除默认聚焦取消的弹窗描述已被此轮覆盖。

2026-10-14 最新：个人信息六项功能与全局字号重做完成，以 PROGRESS 首节及 PERSONAL_INFO.md 为准。当前侧栏直接编辑，底部取消/保存，无编辑弹窗/前后对比；指令单份，无目标岗位。AI 摘要/指令/有真实来源技能先展示待保存内容，确认后保存；技能更新主动询问，知识库只能用户选一个，本场主进程锁定资料与范围。旧键/原件保留，不迁移真实数据。

根目录构建已更新，正常退出后通过 Start-VoxCue.cmd 启动即可加载；不终止正在进行的用户面试。便携包尚未重建。基础检查106模块、类型、218单测及build通过，profile/UI UX/31状态字号与对齐等隔离桌面回归通过。字体18/15/14/12px，字号检查入口 test:ui:typography。未提交/推送/发布；真实模型与语音品质仍需实际使用验证。

以下为历史轮次，回答风格自动保存/前后对比已被最新方案覆盖。

2026-10-14 最新 UI 轮次：审查 19 项问题已修复/按用户反馈调整，历史修复见 PROGRESS 相应条目，现用检查入口见 ../test/README.md。根目录界面/主进程构建已更新；Start-VoxCue.cmd 使用当前输出，正常退出再启动可加载。便携包仍为下文上一轮清理版本，不含本轮 UI 修复。正在运行的原生采集进程会占用 native/bin/VoxCue.Audio.exe；不要为重编译终止用户面试或读取其数据。

最新交互：短圆头侧栏选中条；顶部仅个人信息与开始面试；回答风格自动保存；转写标题右侧只显示语音模型就绪提示；面试指令只输出直接可念的专业口语正文。记录仅标题搜索，详情支持重命名。新增可选 titleSource 兼容旧记录；手动标题优先，不迁移旧数据、不允许迟到自动任务/旧归档覆盖。session:state 布尔 IPC 和原生关闭保护同步公开契约，仍默认取消，显式退出避免重复确认。真实语音/模型输出质量未因此验收，旧试用不恢复。

常规页聊天偏好说明和三个快捷按钮已按最新要求删除，原输入框模型/思考强度及个人信息中的风格入口保留。新增主题色默认跟随系统，可选六色，自动保存并跨窗口同步，外观明暗设置独立；新偏好键 copilot-accent-color-v1 缺失/未知值默认 system，原数据/凭据不迁移。

本轮最终验证：106 模块零越层/运行时环、typecheck、34 文件 209 单测、完整 build 及相关桌面 smoke 通过；最新 UI/UX 报告 test/results/ui-ux-fixes-juesAh/report.json，7 组检查、Renderer 错误 0。主题色设置额外覆盖系统事件、自选保留、保存失败/恢复及重载，跨窗口和登录恢复由 UI/UX 覆盖。有效日志/合成截图均在忽略的 test-results，未提交/推送/发布；便携包版本以首段说明为准。

上一轮清理验收：106模块架构、类型、203单测及干净构建通过；最终相关42项回归、真实Paraformer停启/故障释放通过。该轮根目录启动构建和便携包已更新，最终包报告为 test/results/portable-current-FIeR9g/report.json：真实语音解码、utilityProcess、gap、原有知识库功能及废弃后端/模型不存在检查全部通过。下文此前轮次的结果仅为历史说明。

更新：2026-10-14。最新用户因 Qwen 未达标准，授权删除模型及相关代码并清理工作区。Qwen CPU/CUDA、下载/比较脚本、设置菜单和公开选择字段已撤除；语音固定 Paraformer CPU。保留现有知识库、聊天、面试上下文与 WASAPI 间断修复。恢复时以 PROGRESS 最新条目及 ARCHITECTURE 为准，不恢复已撤除实验。

旧配置读取时忽略已删除的模型/计算设备字段，继续保留音频设备、麦克风开关、回答模型和思考强度；不改真实用户数据。旧研究工程的代码/依赖/公开模型缓存和探针包删除，private 数据、标注、结果、索引与恢复基线保留且不执行。根依赖锁保持；未提交、推送或发布。

InterviewContext 主进程维护最近120条/约64KB原生终稿、问题链和独立标记的AI建议；暂停/重载保留，关闭/新场清空，取消/失败/不完整不污染建议。必要的面试者回答文字现会随问题上下文发送，开场说明已同步；麦克风仍不触发问题或自动回答。WASAPI单次间断分段恢复并提示，不完整片段不自动发送/进入标题；持续故障继续报错。105架构模块、类型、198单测/build、新上下文UI、原12项工作流、真实系统回环/Worker三次停启与崩溃释放通过；真实AI语义适应质量未验收。

此前知识库两个选择器已改为共享 Radix ChoiceMenu，修复大字号与主题/键盘焦点。Responses 有效档位不含 Ultra；GPT-6.1-Sol 最高 max，目录排序和能力过滤、旧 Ultra 设置读取为自动、参数专用错误已覆盖。该轮设置/RAG UI/面试档位/准备聊天烟测通过；真实账户 max 尚未调用验证。本轮 Start-VoxCue.cmd 根目录构建与 release-smoke/VoxCue-win32-x64 便携包均已更新，最终 portable-current-nzpAlf 验证真实Worker/utility、gap重置、上下文模块和离线RAG通过。

实际目录 C:\Users\fengk\OneDrive\Study\UoM\PhD\GitRepo\VoxCue，分支 codex/speech-recognition。本轮五阶段任务没有提交、推送或发布授权，Windows/Mac 分支保留。先核对 git status、PROGRESS.md 最新条目和 docs/ARCHITECTURE.md。禁止 reset/clean、整库恢复、覆盖新工作或未经后续授权推送。

保留知识库/简历原件、IndexedDB 名称版本与 stores、账户凭据、个人信息、面试记录和本机语音模型。旧用户目录中的派生数据未做清理或迁移；此前清理仅删除仓库废弃代码/工件；本轮新增知识索引，没有删除真实原件、凭据或旧派生数据。历史附加字段继续保留，不自动改写记录。

聊天和已确认面试问题通过 RagChatService 复用现有 AIChatService；默认 Local，可在设置切换受限 Function。原件上传自动索引，历史原件手动索引；原始标题任务仍不读取知识库。正式界面仅 ChatGPT 授权，Mock 只供显式隔离测试。OAuth、原音频不保存上传、麦克风/系统角色、开场设备/模型/effort 锁定、运行时自动回答、现有截图保护范围不变。

基础检查：pnpm check:architecture、pnpm typecheck、pnpm test、pnpm build。桌面检查：pnpm test:knowledge、test:settings、test:interview:workflow、test:interview:access、test:interview:effort、test:history、test:composer、test:conversations:status、test:ui:alignment、test:electron、test:floating、test:login。全部使用隔离目录和合成服务；不批量调用真实账户或采集真人音频。

Start-VoxCue.cmd 使用已构建输出，不自动编译；便携构建入口为 pnpm package:portable。现用实现见根 PROGRESS.md，回归入口与边界见 ../test/README.md；旧报告已清理；本轮未提交、推送或发布。

本轮修改前源码快照在忽略目录 test/results/workspace-cleanup-baseline/sources.json，只用于按文件/逻辑块恢复，不能覆盖后续工作；没有保存真实用户资料或读取封存题目。历史准确率失败不因撤除功能变为通过。真人语音准确率、物理设备/跨机/全部 DPI 和真实账户摘要/标题质量仍未完整验收。
