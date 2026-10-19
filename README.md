# VoxCue

当前源码只保留 ChatGPT 登录，GitHub Copilot 接入已移除。[本地模型](shared/docs/COMPONENTS.md)集中在“设置 → 本地组件”首次下载，后续升级复用同版本缓存；主界面及相关页面只提供设置快捷入口。按钮内显示主题色圆环及百分比，悬停切换取消，容量显示 MB。Windows/macOS 当前打包均排除模型与 ONNX Web，保留 Node CPU 推理依赖；既有发行保持。

> 测试结果零保留：结果仅在终端/内存显示。已改造入口的必要工作文件使用系统临时目录并清理，不保存报告、日志、截图或 profile；旧硬件/安装脚本须先核对。Mac 117 个旧占用目录和 Windows 349 个此前跳过目录不重试；本轮在 Mac 本机修复，windows/ 严格只读。入口与边界见[测试说明](shared/test/README.md)。

面向 Windows x64/macOS Apple Silicon（arm64）共同开发的桌面面试准备应用，发行目标为 Windows x64 和 macOS Apple Silicon。ChatGPT 聊天、个人信息与简历、本地知识库检索与 RAG、本地语音输入、独立面试悬浮窗口和面试记录；Mac 具有原生音频、系统窗口和独立安装包构建，采用免费签名更新方案，不以 Intel Mac 为支持目标。

当前共享与Mac源码版本为 **0.5.0**，Mac arm64已发布至[v0.5.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.5.0)；Windows仍保留0.3.1配置及[现有安装包](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.3.1)，须在Windows本机同步、构建与验收，完整任务见[Windows 0.5.0接续提示词](shared/docs/WINDOWS_0.5.0_HANDOFF.md)。Mac发行提供DMG、签名自动更新ZIP和latest-mac.yml，沿用原Ed25519密钥及固定本地代码签名证书。本轮源码按用户最新单次授权同步私有main；两个平台按各自完整资产独立选版，全部Windows和历史资产、既有Latest保留。

已发布 0.3.0 增加面试字号调整与预览、全聊天区域文件拖放、受控本地模型删除，并改进登录布局和权限提示。该发行的两阶段用量优化包括明确回应自动过滤、重复历史原文引用、较早无关 AI 建议选择和精确检索缓存。

0.3.1 已撤销上述四项机制：明确回应恢复正常自动提交；每次发送既有 120 条/64000 字节、每条最多 6000 字窗口内完整原文；重复查询重新检索。用量统计/token 账本及重置、2200ms 静音与生命周期保护、模型/effort/默认篇幅、其他 0.3.0 功能和 Windows 修复保持。面试/准备聊天/资料及技能/标题提示词按确认稿调整；Local RAG 搜索或读取故障、超时后可继续回答，取消与配置/身份/模型错误保护保持。实现与入口见 [进度](PROGRESS.md) 和 [测试说明](shared/test/README.md)，依赖不升级。

## 开发与启动

0.5.0共用界面增加独立面试背景透明度和字号滑块、分层预览、不透明浮窗设置、自动应用与设备刷新、紧凑设备状态和记录知识库名称前缀；提示词沿用已确认的八组最小修改，指定主题技能允许缺少简历/JD，整套生成仍要求两者齐全。Mac以完整系统混音为参考在本地处理麦克风回声；合成音频检查不代表真实外放和同时说话质量验收。两平台使用同一共享实现，各自原生构建与验收独立进行。

开发使用原生 Node.js 24 LTS 与固定 pnpm 11.25.0。先在本机平台目录安装依赖：

```sh
# Mac Apple Silicon
cd macos
COREPACK_HOME="$PWD/.tools/corepack" ELECTRON_CACHE="$PWD/.cache/electron" corepack pnpm install --frozen-lockfile
```

Windows 在 `windows` 目录执行 `corepack pnpm install --frozen-lockfile`。无需在根目录或 shared 安装依赖，已存在的另一平台依赖保留。

安装后可回到根目录执行，命令会按当前系统转发：

```sh
corepack pnpm check:workspace
corepack pnpm check:architecture
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm start
```

Windows 也可双击 `windows/Start-VoxCue.cmd` 使用现有构建，启动器不自动编译。`dev` 启动开发模式，`dev:web` 仅预览网页。开发入口优先使用完整的 `shared/local-models`；模型缺失时在“设置 → 本地组件”下载并复用应用数据目录的缓存，也可运行 `download:speech`、`download:rag` 准备开发模型。Mac 的 `build` 构建 Core Audio 助手、共用 Electron/Renderer 和双击入口 `macos/VoxCue.app`；`build:shared` 仍只共享编译。双击入口直接打开已有构建，不弹终端或自动编译，可固定到 Dock，须保留在 macos 文件夹内。需要 Apple Silicon、macOS 14.2+ 与 Command Line Tools；真实账户服务与真人语音质量仍需使用者验证。详见 [Mac 原生适配与启动说明](macos/docs/MACOS_PORT.md)。

Windows x64 的 [v0.3.0 安装包](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.3.0/VoxCue-Setup-0.3.0-x64.exe) 自带运行库，普通用户无需开发工具；语音和知识库模型在设置中首次下载并校验，后续升级复用缓存。Windows 安装包未配置 Authenticode 签名；旧发行及资产保留。正式构建入口为 windows/ 下的 package:installer，仅安装包、blockmap 和 latest.yml 用于分发。Mac 的 DMG 首次安装与免费自动更新见 [Mac 更新说明](macos/docs/UPDATES.md)，共享流程详见[更新说明](shared/docs/UPDATES.md)。

Mac开发宿主、启动器与后续正式应用使用固定本地自签名证书；公开指纹在`macos/local-signing-public.json`，私密身份在被Git忽略的`macos/.tools/development-signing/`，请安全备份并在清理时保留。身份缺失/错配会停止构建，不自动换证书或回退ad-hoc；现有登录信息和Sparkle更新密钥保持。已发布旧安装包未自动重建，首次切换签名可能仍需一次授权。详见[固定本地签名与登录保留](macos/docs/MACOS_PORT.md#固定本地签名与登录保留)。

## 工作区与主线

`main` 是唯一长期开发主线；共享业务只保留一份，Windows/Mac 历史分支保留。

```text
AGENTS.md / PROGRESS.md / README.md / package.json / pnpm-workspace.yaml
windows/  专属源码、原生助手、测试源码、依赖、锁文件、构建和发行
macos/    Core Audio、系统窗口策略、双击启动器、arm64 依赖和构建
shared/   共用 src/electron/scripts、测试、模型、PNG/Logo 原件及文档
```

测试结果改为零保留；本次删除 101 项可清理旧产物、4,420 个文件，仍被占用或受平台只读限制的残留见上方说明。旧报告引用不作为现存交付物。源码恢复快照与纯清理审计单独放在平台 recovery，测试源码、固定输入夹具、现用依赖/模型和真实数据保留。

平台独立安装、独立构建；测试结果不保存。共用配置在 `shared`，平台差异在各自 `package.platform.json`。Mac 对 `windows/` 只读，Windows 对 `macos/` 只读，包括脚本的间接写入。修改声明后在本平台执行根 `corepack pnpm sync:workspace`，只生成根和本平台配置，另一平台留待其本机同步。构建只输出 shared 与当前平台，格式化/图标工具同样遵守边界。Windows 生成配置现已本机同步，编译目录只包含 shared/windows。完整目录见[工作区说明](shared/docs/WORKSPACE_LAYOUT.md)。退役 benchmark 的私有输入在 `shared/benchmarks`，Windows 实测结果在 `windows/benchmarks`，不恢复实验。

## 当前功能

Windows 清单 1–10 已接入当前共享界面及本机展示适配器，下文历史“待适配”由此说明取代：Windows 11 22H2+ 保持 Acrylic，使用共享 0–100 滑杆及独立面试背景偏好，旧系统保留参数并回退；应用原生主题、normal 置顶、透明留白穿透和任务栏入口隐藏/结束恢复自动生效，不改变全局设置或固定项。Windows 当前捕获方式无需单独申请，检查不截图，实际捕获仍可能失败。右上角窗口按钮有独立 no-drag 区域，浮窗拖动修正分数 DPI 的尺寸变化。完整退出重开加载新的 main/preload。

- 设置入口、透明度参数、浮窗联动、用量链接对齐、紧凑布局及蓝色焦点外圈移除已共用；两平台分别重建后使用同一份界面。置顶、空白穿透和面试图标隐藏保持自动行为，不新增开关。共享源码不代表跨设备同步实际偏好或用户数据。
- Mac 进入面试后自动隐藏本应用的 Dock 运行图标和主窗口，结束面试后恢复。面试浮窗保持置顶，切换桌面或进入全屏应用仍可见；工具栏周围、面板间隙等透明空白可直接点击后方应用，工具栏和面板保留操作。
- 共用设置 → 常规提供 0–100 毛玻璃透明度连续滑杆，默认 50，0 关闭。主界面按全范围调节；面试界面单独提供背景透明度滑杆（默认20），独立保存，不随毛玻璃滑杆变化，沿用背景60/阅读30的旧分段曲线，预览与实窗一致。浮窗设置使用不透明面板和层级阴影，外围保持清晰，外部首次点击仅关闭设置。旧四档只读映射，文字无光晕/描边；辅助功能使用不透明表面。Windows 11 22H2+ 沿用 Acrylic，旧系统保存参数并回退，不改变整个窗口的 alpha。
- 浅色/深色/跟随系统的网页与本应用原生主题通过各平台适配器联动，两端均不修改系统全局主题或原生材质种类。
- 共用设置 → 面试设置显示屏幕权限和自动窗口状态。Mac 沿用独立申请流程；Windows 当前捕获方式无需单独申请，实际捕获仍可能失败。查询不截图或录屏，不自动截取图像，纯语音可继续。Windows 面试使用 normal 置顶、透明留白穿透与任务栏入口隐藏/结束恢复，不改变用户固定项。
- Mac 界面操作图标统一采用 Apple SF Symbols，资源与工具留在 macos，原有布局、主题和品牌 Logo 保持；Windows 继续使用 Fluent UI。
- 当前工作区面试输入区移除“附截图”开关。发送按钮左侧的截图按钮只截取并暂存图像，在输入框显示可移除的缩略图，按钮展开显示当前数量/5，最多五张；点击发送才提交文字与图像，空文字可只发送截图。自动回答只发送文字，不消耗待发送截图。失败或停止保留原图供重试，不重新捕获；结束/关闭/重载清空。图像不写磁盘或面试记录，所选模型须支持图片。此行为尚未重新发行。 失败/停止后的重试操作位于回答气泡内。个人信息中简历、JD、自定义指令与技能的正文/编辑文本为12px，标题14px。 主界面左上角Logo为24px，VoxCue字样与18px页面标题一致，两平台应用图标使用用户最新提供的Logo，Mac保留原图圆角与透明边缘。
- 当前工作区面试回答默认按正常语速口述约60–90秒组织，当前问题或已确认自定义指令可覆盖时长/篇幅要求；代码题使用带语言、换行和缩进的代码框，支持流式显示与复制。回答上方显示对应问题气泡。全软件移除悬停说明，保留无障碍名称。浮窗转写/回答宽度约7:10，调整尺寸时各自宽高比保持，字号、按钮和工具栏大小固定，放大显示更多内容；缩放全程保持上方工具栏位置，下方面板围绕它扩缩。隐藏转写会收窄窗口并保留回答面板尺寸；左右底角使用互为镜像的缩放图标。未开启截图保护显示“此窗口未隐藏”，提示位于面板下方预留的透明区域，出现/消失不挤压或移动面板。转写异常恢复后清除。聊天/面试共用新版思考展示，初始为“正在思考”，公开思考与活动在正文分割线上方；实际本地检索与网页活动分别标识。开场确认中知识库独占一行，系统音频/麦克风、回答模型/思考强度分别成对并排。这些修改已包含在公开v0.2.0安装包中。
- v0.1.1 修复错误响应等待不结束、损坏记录空白界面、聊天快照字段覆盖动作、聊天 IPC frame 校验缺口及重载后旧请求阻塞。读取不删除或迁移原数据；现用回归入口见 [测试说明](shared/test/README.md)。
- 全界面按浅深主题统一表单高度、错误颜色和长名称处理，修正音频设备报错后的对齐、知识库紧凑上传/文档动作与记录按钮悬停对比度。默认及最小主窗口的检查入口见 [测试说明](shared/test/README.md)；最新修复安装包以 PROGRESS 为准。
- 登录按钮统一尺寸、图标位置及间距，内容区居中，预览跟随浅深主题；服务图标随主题调整对比度。展开箭头统一采用 Fluent 细折线。准备聊天一旦开始输出正文，公开思考和活动自动收进顶部“用时”，可再次展开。
- 面试系统问题在上一条回答期间到达，会在该回答完成后继续自动提交；麦克风间断不清除系统问题，手动清空输入后遇到新的系统转写恢复回填。麦克风仍不触发问题或自动回答。当前原生采集未接入声学回声消除，扬声器声音可能被麦克风收录，建议使用耳机。

- 当前共享技能生成通过真实联网筛选与已确认简历/JD相关的适量面试准备资料，不设固定写作字数，不凑数量；正文、提案和已保存条目使用纯文字，不展示链接或来源清单。真实来源继续后台核验，原文、元数据及十项存储上限保持。完整内容仅放待确认提案，来源校验失败仍保留只读预览并明确提示，不自动保存。已发布0.3.0不包含这些0.3.1提示词和展示调整。

- 系统浏览器 ChatGPT 授权、账户模型与思考强度、Responses 流式回答、可选网络搜索、Markdown/GFM 和代码复制。准备聊天用时置顶并带分隔线，按实际顺序逐行显示状态、公开思考标题及搜索/读页活动。标题默认折叠，右侧细箭头悬停或键盘聚焦出现；正在处理的标题有滑过高亮，遵循系统减少动画偏好。公开摘要不设置语言要求，直接展示服务原文。结束、失败或停止后用时和活动随聊天保存；不显示空入口或私有推理，失败不切换模拟服务，正式界面无 Mock/测试入口。
- 思考档位按账户目录和 Responses 模型能力筛选；GPT-6.1-Sol 官方最高为 max（最高），不提供无效 Ultra。保存的旧 Ultra 设置读取为自动，未知能力不发送 effort。
- 准备聊天、草稿及附件自动保存在本机，关闭或退出登录后仍可恢复，仅明确删除才移除。输入框按换行及自动折行在2–11行间增高或缩回，超过十一行内部滚动，窄窗与恢复草稿同步调整。支持文件夹/拖放、语音输入、停止、对话切换与失败重试；新建空白、切回恢复，后台完成显示未读点，上翻可返回最新。语音只填写草稿，不自动发送。
- 发送采用主题色圆形按钮与白色上箭头，和麦克风保持统一尺寸/对齐。通用提示按当前模型提供商显示资料接收方，每条回复和历史保留实际来源；缺失来源不猜测为ChatGPT。登录与推理使用 ChatGPT。
- 个人信息本机保存：姓名/语言、简历摘要、JD 摘要、单份自定义指令、技能及一个用户自选知识库。共享 0.3.1的五类资料默认折叠并有展开/收起动画，简历/JD/指令/技能在弹窗中编辑，保存后更新；姓名/语言仍在侧栏保存。AI 提案与技能更新提示只在聊天显示，确认后才更新资料。按钮或对最近有效提案输入“确认”均可保存，不重复要求文字确认；缺少 JD/简历时仍可继续聊天，补齐后才询问是否联网更新技能，技能保留本次真实搜索来源。没有独立目标岗位或官方题库。聊天附件、旧简历原件与知识库相互独立。
- 知识库原件管理、索引状态、重试/取消、强制重新索引与三模式检索。PDF、DOCX、TXT/Markdown 可本地解析；其他 Office 格式保留原件。每次最多 20 个、每个 20 MB；完整 Q&A 与追问可回取。
- 设置管理主题、账户与本应用用量、面试音频设备、麦克风禁用/测试、回答模型和思考强度。开场只读确认可直达面试设置，返回重新预检权限与设备，主进程再次检查；配置用于本场并锁定。知识库普通视图使用行为名称，检索方式/分数在高级选项中。
- 独立面试浮窗固定置顶，系统音频为面试官、麦克风为面试者，本地 ASR/VAD 双路转写。转写标题右侧提示语音模型是否就绪，不显示讲话或面试状态。系统问题可手动提交，自动回答默认开启并可随时关闭；当前 AI 回答可独立停止/重试，逐条服务身份与复制反馈，缩放支持键盘，收起、展开和结束二次确认保持可用。
- 面试回答要求第一人称自然口语、逻辑清楚且专业，只给可直接念出的正文；不加意图分析、作答建议、标题、整段引号或资料编号，肯定/致谢/收尾只作简短直接回应。不会因此编造个人经历；真实模型输出质量仍需实际使用检验。
- 面试回答结合本场近期问题、追问和面试者实际回答；AI 建议单独标记，不视作你已经说过的话。暂停/重载保留本场上下文，结束清空。短暂音频间断会提示并分段恢复，不完整片段不自动用于回答；持续中断仍停止报错。
- 记录列表仅保留标题搜索；详情可重命名标题，手动标题不会被自动生成或迟到归档覆盖。转录时间线和可展开回答栏支持双向定位、后台 AI 标题、原生 TXT 导出和确认删除。窄窗辅助栏覆盖显示；旧模拟记录仅从 UI 过滤，存储保留。
- 浅色/深色/系统外观与主题色分别设置；主题色默认跟随 Windows 系统，也可选蓝/青/绿/紫/橙/粉，自动保存并同步主窗口、登录和浮窗，浅深文字对比度自动校准。标题18px、分区标题15px、正文及控件14px、辅助说明12px；共享毛玻璃和 Fluent UI 图标，应用 Logo 与 ChatGPT 服务图标独立。

新方案采用 LanceDB + 本地 E5 q8 CPU，默认 Hybrid Search 与 Local RAG；设置可切换 Function Calling，两模式共用索引。准备聊天和已确认面试问题仅在用户选择的知识库检索相关证据，未选择则跳过检索，必要片段随既有 ChatGPT 请求发送至 OpenAI；不会上传整库。主动发送的聊天附件仍随请求发送。历史原件需手动索引，旧派生数据不迁移。真实账户工具资格、语义准确率及最终回答质量尚未验收。

详见 [个人信息交互与兼容](shared/docs/PERSONAL_INFO.md)，桌面回归入口 pnpm test:profile:ui；全局字号/视觉检查 pnpm test:ui:typography。

## 数据与权限

目录迁移规则只包含在当前新构建中。已发布/已安装的旧版仍使用旧路径，迁移后应使用新构建（本工作区可运行 macos/VoxCue.app），否则旧版会重新创建旧目录。

应用数据根目录为 Windows `%APPDATA%/VoxCue`、macOS `~/Library/Application Support/VoxCue`。首次运行新版会在会话创建前将旧 `ai-interview-copilot` 目录整体原子迁移，成功后旧路径消失；新旧目录均有内容或旧进程占用时停止，避免覆盖。已有 IndexedDB/localStorage 键不改，知识库/简历原件和面试记录保留。普通聊天使用独立本机数据库保存，关闭前等待写入成功，失败保留窗口；面试浮窗临时会话结束后清空，面试历史继续保留。资料提案生成时实时预览，完整生成与校验后才允许确认。凭据仅由主进程系统加密管理，令牌不进入 Renderer、localStorage 或日志；真实浏览器授权需用户亲自完成。

麦克风和系统音频必须明确开始，仅本机处理，不保存或上传原音频。启用的设备失效或权限检查失败时禁止开场；明确禁用麦克风才跳过其权限。截图保护沿用 Electron 标准接口，不保证所有捕获或共享工具都遵守。

面试回答会发送必要的本场问题、追问、面试者实际回答文字和相关资料片段；上下文在主进程内存按最近120条/约64KB限制，不混入其他场次。面试记录标题仍只使用问题，不发送麦克风回答或AI正文。

本应用用量仅统计本机收到的服务端 token 与请求次数，不代表账户剩余额度；设置提供官方用量入口。重置和删除均在原按钮二次确认，再次点击才执行，Esc、失焦或三秒后取消；不另开确认区域。

## 开发与验证

```powershell
pnpm check:architecture
pnpm typecheck
pnpm test
pnpm build
pnpm test:chat:progress
pnpm test:knowledge
pnpm test:rag:core
pnpm test:rag:ui
pnpm test:settings
pnpm test:ui:ux
pnpm test:interview:workflow
pnpm test:interview:access
pnpm test:history
pnpm test:electron
pnpm test:floating
pnpm test:composer
pnpm test:login
pnpm test:package
pnpm test:windows:functional
pnpm test:windows:regression
pnpm test:installer:isolated
pnpm test:ui:dpi
```

后续获准的桌面测试使用操作系统临时目录和合成账户/设备端口，运行结束、失败或取消均清理，不保存结果；现有持久化脚本须先改造再运行。pnpm package:portable 输出本机便携程序至 windows/release-smoke；pnpm package:installer 输出 NSIS、blockmap 和 latest.yml 至 windows/release/installer，固定 GitHub Releases 发布源但不自动发布。Windows仍无Authenticode证书，Mac使用固定本地自签名而非Developer ID证书；真实账户摘要/标题质量、真人长句/技术词准确率、物理热插拔、新电脑与全部 DPI 仍未完整验收。

Windows 安装/卸载窗沿用主程序的浅色、蓝色圆角按钮和字号，主操作为右对齐 140×36px；自绘界面由现有 Windows .NET Framework 工具编译，安装/卸载与静默更新仍使用 NSIS。可在 windows/ 执行 `node test/scripts/installer-branding-smoke.mjs --preview` 查看空负载原生样例，图片只在内存，临时文件结束清理。

职责和公开边界见 [架构](shared/docs/ARCHITECTURE.md)，RAG 细节见 [RAG 架构](shared/docs/RAG_ARCHITECTURE.md)，回归入口和验证边界见 [测试说明](shared/test/README.md)，当前实现见 [进度](PROGRESS.md)，恢复入口见 [交接](shared/docs/HANDOFF.md)，清理范围见 [清理记录](shared/docs/WORKSPACE_CLEANUP.md)。

语音固定使用 Paraformer 中英 INT8 + Silero，本机 CPU 实时转写；Qwen 试用与专用 CUDA 后端已按用户要求撤除，不再提供语音模型或 GPU 选择。已保存的旧选择字段读取时忽略，音频设备、回答模型与思考强度保持。原生采集分别使用 Windows WASAPI 与 macOS 14.2+ Core Audio，平台真机验证边界见各自文档。
