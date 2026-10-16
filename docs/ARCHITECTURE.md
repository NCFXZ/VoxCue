# VoxCue 架构

更新：2026-10-16。以当前代码和 PROGRESS.md 为准。

## 实际目录与测试边界

生产源码按顶层shared/windows/macos划分，共用目录保留原components/stores/services与application/backend/ipc/contracts职责。Windows策略及WASAPI采集/权限检查/控制器/utilityProcess入口在windows/electron；Mac仅有macos/electron/platform.ts的Apple Silicon策略，未实现原生音频或完整移植。共享SpeechHost只接收由main/desktopResources注入的进程入口，不导入Windows采集实现；Windows控制器调用共享ASR Worker。

测试全部位于test/shared与test/windows；共享夹具在test/shared/fixtures，Windows权限、模拟语音及原生运行时夹具在test/windows/fixtures，结果/快照/验证包在忽略的test/results。依赖Win32鼠标、权限或Copilot原生运行时的回归归test/windows/scripts；共享打包UI回归接收可执行路径，由Windows runner负责实际路径和平台校验。未实现Mac真机测试时不创建空目录或套用Windows语音夹具。原colocated Renderer单测迁入test/shared/renderer；公开契约编译检查迁入test/shared/unit。生产源码禁止导入test，Windows/macOS专属实现禁止互相依赖，共用业务禁止导入平台实现，仅main与platform/index装配；原Renderer、preload、IPC、推理/数据库边界保持，架构扫描包含三类实际源码并检查无法解析的引用。

TypeScript使用根目录作为rootDir，在dist-electron内镜像三类源码，package.main与Start-VoxCue.cmd同步。main通过app.getAppPath定位dist/index.html，preload保持与main相邻且只运行时导入electron。Windows ASAR解包规则覆盖新的专属语音路径及共享Worker/契约/知识后台；模型、DLL、助手输出、userData与原始Logo位置不变。完整目录及旧路径映射见[WORKSPACE_LAYOUT.md](WORKSPACE_LAYOUT.md)。

## 分平台正式更新与Mac arm64范围

更新目标限定Windows x64及macOS Apple Silicon原生arm64；Intel/Universal Mac不在支持范围。backend/updates/releases.ts负责纯发行筛选、稳定数字版本比较及清单字段投影；provider.ts通过固定公开GitHub Releases列表API分页读取，再访问所选Release目录的本平台清单，driver.ts配置electron-updater公开custom Provider接口。不存在/releases/latest或Atom依赖，平台可独立采用不同版本/Tag；现有v0.1.1标签兼容，Tag/标题/统一Latest标记不用于版本排序。

资产是显式协议：Windows要求latest.yml及VoxCue-Setup-<稳定版本>-x64.exe与对应blockmap；Mac要求latest-mac.yml及VoxCue-<稳定版本>-arm64.zip。仅已发布、非草稿、非预发布且完整uploaded资产进入候选，按版本数字排序，同版本按发布时间/Tag稳定选择。最高候选的清单版本必须与文件名一致，files中的本架构URL必须是资产原名、大小与列表一致、SHA512合法；只投影该文件与受限minimumSystemVersion，丢弃额外packages/外部URL/任意路径。下载URL始终由固定仓库、所选Tag及文件原名构造。

网络读取使用更新器netSession的fetch、credentials=omit，不读取账户凭据、环境令牌或Renderer URL。每次检查45秒总期限，分页100条/最多10页，单页8MiB、清单128KiB；超限/分页或网络失败、无当前平台完整正式包、最高候选清单损坏均明确失败，不将旧版误称最新。生命周期dispose取消分页/清单读取，旧结果/事件仍受原Service守卫；原下载取消、SHA512、进度、缓存、签名与安装由原NsisUpdater/MacUpdater执行。

main保留原UpdateService装配和IPC，Renderer/公开契约不变。启动检查下载、手动重启、本机保存握手、面试互斥和普通退出不安装保持；开发/便携禁用，只有受支持平台的packaged且存在app-update.yml才创建驱动。该文件继续供原生缓存/签名配置，运行时Provider覆盖全仓库Latest选择。未改打包/发布配置，未新增依赖或变更数据格式。Mac这里只完成策略/适配代码，尚无Mac安装包或真机/签名/安装验收。

## 统一主线与平台边界

main 为唯一长期开发入口，Windows/Mac 保留历史引用；0.2.0 按用户授权提交推送完整功能和目录整理，远端默认 Windows 保持。共享 React/Store/存储、AIChatService、application、contracts 与 IPC 各保留一份实现，没有按系统复制业务；生产源码和测试按共用/平台差异组织，上传状态见 PROGRESS。

`shared/electron/platform/{types,windows,macos,index}.ts` 为无 Electron 运行时依赖的纯策略/路径解析。Windows 保留 Acrylic、ICO、AppUserModelId、全部窗口关闭后退出、现有保护支持标志、固定隐私入口、WASAPI 与打包 Copilot runtime 位置；macOS 使用 PNG、关闭窗口后驻留及钥匙串错误标签，不配置 Windows 材质/原生程序，也不宣称相同截图保护保证。非目标系统不声明原生支持。

`shared/electron/window.ts` 共用三类窗口选项、沙箱/preload、新窗口/导航限制及生产/开发 hash 入口；不持有业务状态，也不依赖 backend/application/IPC。main 在原有时点创建/加载窗口并保留授权切窗、关闭保存握手、重载取消、浮窗保护/normal置顶、中心缩放和资源释放。没有移动 userData、模型或原生文件。平台参数只从 main 注入后台；账户存储继续使用原 safeStorage 与 credentials.bin，Copilot继续官方独立运行时。未适配音频在 SpeechHost 创建 utilityProcess 前明确拒绝，WASAPI实现仍在原专用后端。

架构检查新增平台策略不可反向依赖业务/窗口、共享窗口不可依赖业务、backend/application不可直接依赖桌面策略/窗口；现有 Renderer、contracts、preload、推理和 Provider 限制保持。平台单测验证配置、资源位置、安全入口及不支持音频不启动进程，不能替代 Mac 真机。`build:shared` 为共享编译入口；完整 `build` 仍保留Windows原生编译，Mac仅arm64依赖、采集、外观、权限及构建分发待后续授权实施。

Electron 的 [窗口保护接口](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows) 不提供对所有捕获方式的相同保证；[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) 的系统后端不同。本轮保留已有同步加密 API，未升级 Electron 或改换凭据格式。完整本轮证据与后续边界见 CROSS_PLATFORM_REFACTOR.md。

对抗测试修复补充：准备聊天所有路由同时校验主窗口和主 frame；取消先退休原生请求槽，后续旧事件/结果均丢弃，主窗口重载也执行取消，与恢复为已停止的快照一致。HTTP 非成功正文独立执行取消、空闲计时与64 KiB上限。Renderer 的 storedValues 仅为本地数据的纯校验；聊天恢复按允许字段构造状态，历史嵌套损坏保留原始存储并显示错误，读取不执行迁移或删除。pnpm overrides 仅去除未调用的 LanceDB 可选提供器及 Mammoth CLI 解析依赖；打包遵循相同排除设置，实际文本 Embedder、DOCX 解析和语音路径不变。

## ChatGPT / Copilot 服务选择（最新）

`application/providers.ts` 的 SelectedChatService 在每次调用入口选择当前服务，复用既有 AIChatService、RAG 与标题队列，不按模型 ID 猜测认证来源。main 装配原 ChatGPT 服务和 `backend/copilot`，成功授权后原子保存 active service；旧安装缺少该字段仍选 ChatGPT。新增无参数 `auth:copilot-sign-in`，仅登录窗口主 frame 可调用，与 ChatGPT 共用单次登录锁和取消/关闭生命周期；preload、DesktopAPI 与编译期测试同步。

CopilotRuntime 使用固定官方 SDK 1.0.21 / Windows runtime 1.0.97，独立 userData 子目录、stdio 子进程及自有控制 session。PKCE 浏览器地址只允许 GitHub authorize + 127.0.0.1 回调；SDK 完成交换与系统加密保存，拒绝明文同意分支。VoxCue 的 copilot-session.json / service.json 仅含无凭据身份与服务标识。屏蔽继承的 Copilot/GitHub/gh/OTEL 配置和令牌环境变量，独立 gh 配置目录，不借用其他应用登录。注销调用自有 runtime logout 并删除身份，失败明确提示；退出释放 session/进程。原 ChatGPT OAuth 和 userData 根路径不变。

单人桌面使用 SDK `copilot-cli` 模式启用系统凭据库：固定版本的 `empty` 模式会强制禁用 keytar，导致浏览器授权进入明文同意分支。`isolatedSession` 显式保留原有隔离默认值，包括禁用 session 遥测、记忆、嵌入检索、自定义指令/插件/内置技能、定时任务和实验能力，缓存仅内存；控制和回答 session 共用该配置。原生 smoke 检查实际 spawn 环境与 SDK session.create 请求，防止再次禁用凭据库或误放开环境能力。

CopilotChatService 只使用服务实际模型目录的 ID/名称/vendor/effort。每个回答单独 SDK session：禁用配置/技能发现、文件钩子、host git、远程 session 和 session store；默认无工具，只有用户开启搜索且目录实际提供时才放行 web_search/web_fetch。拒绝文件/命令/沙箱绕过权限，本地资料工具仍走原受限 LocalTools。历史作为有角色的 JSON 数据提供，附件只用内存文本/Blob；完整结构化资料复用 ProfileAnswerStream 和抽取的 verifySkillProposal，不降低来源校验或用户确认。只传真实工具活动/来源和使用量，不传 SDK extended thinking、原始错误或凭据；Copilot 无公开摘要时只显示状态。五分钟静默限制由事件重置，取消屏蔽迟到事件并清理自有 session。

ModelProvider 增加可选 modelName/modelVendor，新增受请求 ID 约束的 provider 事件，让面试浮窗在正文开始前显示实际身份；最终结果校准并逐条持久保存，不改写历史。Renderer 没有 SDK、原生运行时或账户凭据依赖，架构检查对 SDK 入口和更新后台隔离增加约束。打包复制官方 Windows 可选依赖，main 使用 ASAR 外的物理 runtime.exe 路径；控制 session、浏览器流程和安装包启动均需实际原生验证。真实账户推理/订阅/联网兼容性不由合成回归保证，详见 COPILOT.md。

展示与语音恢复：ResponseProgress 在正文首次出现时折叠到“用时”，之后用户可自行展开，不随每个 chunk 重复关闭。系统问题 debounce 就绪状态在生成期间保留，回答完成后按本场状态补交；系统间断清除不完整问题，麦克风间断不影响系统缓冲。浮窗手动清空输入只覆盖当前转写版本，新系统稿到达恢复跟随；非空手动编辑保留。未引入 AEC 或修改原生采样路径。

更新边界：backend/updates/driver.ts 只在 Windows 安装包存在固定 app-update.yml 时加载 electron-updater；service.ts 管理单次检查/下载/安装、版本化状态、错误及释放。IPC 仅主窗口主 frame 的 status/check/download/install 四操作，拒绝额外字段；公开契约不包含 URL、路径、凭据、发布说明 HTML 或原生下载对象。Renderer 的 services/updates、stores/updates 和 UpdatesPanel 分别负责受控调用、订阅/迟到状态过滤及展示，架构检查限定 updater 只进入更新后台，禁止其访问账户/资料/音频后台。

main 装配面试活动与安装准备回调，开场预检/浮窗期间拒绝安装，installing 期间拒绝新开场。更新安装复用现有关闭请求 ID 与聊天 flush 成功确认，不提前调用 quitAndInstall；取消、失败、超时及安装错误恢复关闭保护，窗口与下载结果保留。autoInstallOnAppQuit 关闭，只有显式点击可安装。NSIS 使用独立 staging 与既有原生依赖复制布局，userData/存储格式/凭据不变。发布与验证边界见 UPDATES.md。

普通聊天最新边界：services/chats.ts负责独立IndexedDB voxcue-preparation-chats v1的state/files事务，preparation store负责恢复、串行合并写入和失败重试。元数据与附件引用原子提交，Blob按ID去重；只回收新聊天库中不再被任何消息/草稿引用的附件。旧原件DB/用户路径不变，不做自动迁移。退出/关闭不删除普通聊天；面试临时会话/归档继续使用原边界。

session:request-close仅向主窗口发送请求ID，Renderer先停止生成并flush本地聊天，以session:close-ready返回ID+成功布尔；主进程校验窗口/frame/字段/当前请求后才关闭，超时或失败保留窗口。事件/调用契约、preload、main、类型及桌面回归同步。未保存个人编辑/生成中仍可默认取消；保存的普通聊天无需清空确认。

profile-preview与可确认profileChanges分离：后台只投影受限的部分字符串/技能正文，无代码求值或原始JSON协议；Renderer显示只读卡片。完整响应仍由原有validateChanges及真实技能联网证据校验；预览不能确认，停止后迟到事件被请求取消语义过滤，恢复的未完成预览仍只读。

ModelProvider为纯显示元数据，由实际服务适配器附在ChatModel和ChatResult中，现有main/preload类型化返回原样传递，不新增IPC或接受Renderer指定来源。通用UI通过useModelProvider/providers读取当前模型的显示名及资料接收方；缺失时用通用名称，保留旧字符串来源兼容。准备聊天先采用请求模型的来源；面试浮窗未收到来源时保持未知。两者以完成结果校准并逐回复保存，历史来源不会随选中模型变化。OAuth与真实ChatGPT服务错误仍由现有适配器负责，不引入新的提供商注册框架或模型连接。

发送按钮共享send-button样式，32px主题色圆底、20px白色Fluent上箭头；主输入麦克风同为20px图标/32px热区。移除用户指定的设置说明和无引用诊断样式，保留真实错误与恢复入口。

删除与用量重置使用共享原按钮确认控件。ConfirmDeleteButton/ConfirmResetButton 复用相同的三秒确认、Esc/失焦取消、目标版本校验和执行锁；首次点击不调用业务，确认后才调用各自store。UsagePanel继续由chatConnection负责重置生命周期和错误；没有新IPC或完成动画。列表/详情删除保留既有数据边界，只移除独立确认弹窗/顶部提示；侧栏采用更紧凑的确认按钮。

## 个人信息重做（最新）

公开 profile 契约增加可选 language、单份 customInstructions 正文及附来源的 skills；目标岗位退出活跃字段，旧 role 只兼容存储。准备聊天始终提供当前资料及严格结构化 answer/changes；主进程校验字段与总预算，Renderer 只展示通过校验的提案并在明确确认后本机保存。技能新增/改写还要求真实完成的 web_search 与实际来源匹配；摘要变化使技能提案过期。没有 AI 直接存储工具或知识库选择提案。

PersonalInfoPanel 负责侧栏内编辑、取消/保存及删除确认，preparation store 负责请求、确认基线、取消、失败恢复和技能更新询问。手动修改点击保存即确认，AI 提案仅显示待保存内容，无前后对比；旧风格写入 UI 与直接上传替换简历的入口已撤除，原件读取保留。数据格式与恢复约定见 PERSONAL_INFO.md。

知识库选择独立于 AI 资料，UI 始终发送一个 ID 或 null。RagChatService/KnowledgeTools 限定单库、过滤越界结果并校验文档归属，null 跳过检索。SpeechCoordinator 保存主进程确认时深拷贝的资料/选择，本场回答只能使用该副本；interview IPC 拒绝 Renderer 额外覆盖字段。契约、校验、preload 调用方与编译期/桌面回归同步。沿用全部窗口、音频与凭据边界。

统一字号 token 为18/15/14/12px（标题/分区/正文和控件/辅助说明），共享角色规则覆盖全部 Renderer 窗口，不因明暗或窄窗改变字号。实际31状态检查见 test:ui:typography。

## 职责与依赖

- shared/src/components：展示和输入；shared/src/stores：界面状态、异步生命周期、取消和跨对话归属；shared/src/services：受控桌面接口适配、本机存储、内部测试实现。
- shared/electron/main.ts：窗口、权限、服务装配及应用生命周期；shared/electron/ipc：调用窗口校验、白名单路由和请求取消。
- shared/electron/application/speech.ts：语音输入与面试的串行资源归属、确认配置和锁定；historyTitle.ts：后台标题队列及模型无关的 AI 接口协调。
- shared/electron/backend/auth：系统浏览器授权和系统加密凭据；backend/chat：账户模型、Responses SSE/JSON、公开摘要、资料提案和本应用用量。
- shared/electron/application/knowledge.ts 与 rag*.ts：索引生命周期、共享上下文与两种 RAG 编排；backend/knowledge：本地解析、E5、LanceDB、不可变 revision 和原子 catalog，耗时任务在独立 utilityProcess。
- shared/electron/backend/speech：WASAPI 采集助手、独立 utilityProcess/Worker、本地 ASR/VAD。耗时推理不运行在 Renderer 或主进程。
- shared/electron/contracts：DesktopAPI、频道和公开类型的唯一来源，只依赖同层纯类型或校验。preload 的运行时仅导入 electron，其他项目引用为 import type。

Renderer 不访问 Node、Electron 原生模块、后台实现、凭据或模型。backend 不反向依赖 application、IPC 或 React。AIChatService 供 IPC 和标题队列使用，不建立全局服务容器。架构检查验证静态边界、运行时循环和主进程/preload 双向频道覆盖。

## 聊天与面试回答

chat:send 的失败结果增加可选 ChatPartialResponse，只含本请求已经收到的公开正文、公开摘要、只读 profilePreview、活动和来源，不包含 profileChanges/私有推理。IPC 在受控发送时累计受限快照，异常时与错误一并返回，解决快响应失败先于排队事件到达 Renderer 时丢失预览的竞争；成功路径仍用最终结果校准。ChatRequestError 保留错误码与快照，preparation store 在失败且未取消时补齐原对话消息，预览保持不可确认，迟到取消不写入。DesktopAPI/preload 沿用同一类型化频道，编译期明确禁止把失败快照当作提案；用户数据库版本/键不变，可选 errorCode 与预览正常持久保存。

来源收集同时处理 SSE output_item.done、注解和终态；只有完成的 web_search_call 才提供检索/打开/页内查找的工具证据。sourceKey 忽略片段和明确白名单追踪参数，不忽略域名、协议、路径或有效查询。最多300个唯一真实来源，避免显示用的旧50项上限影响后续引用验证；同页引用统一采用工具实际URL/标题。多余未匹配引用移除并明确警告，每项新增/改写技能仍须至少一个本次真实来源，否则整份提案不可保存；不能按同域猜测链接或用模型自称联网代替证据。旧资料与来源不批量改写。

技能默认指令与结构化 answer 描述要求3–5项核心技能、每项约120–220字和1–2个相关来源；已有未变更技能及最多10项/6000字硬限制保持。完整技能只放 changes，answer 简短说明等待确认，详细教程/口述稿/追问需用户明确要求。ChatSources 保留3条直接可见可点击来源，其余默认折叠，位于时间/公开进度之后；ProfileProposal 的只读技能预览复用完整提案的逐项间距和分隔线。skill_search_unverified/skill_sources_unverified 明确显示来源校验失败，与网络中断分开。

阶段合并复用 contracts/activity.ts：若新旧状态之间没有公开 reasoning 文本，删除旧空状态并追加最新状态；实际工具和公开说明保留。有公开思考内容才保留前一阶段。迟到完成事件不复活已替换状态；当前阶段与当前标题共用滑过高亮，结束/停止关闭，减少动画偏好同时生效。公开思考不设置语言要求，缺少摘要的提示文案移除“可以继续聊天。”，聊天权限行为保持。

准备聊天通过 preparation store → chat service → preload → chat IPC → AIChatService.stream；面试回答通过 interview store → speech service → interview IPC → 同一 AI 接口。本轮新授权接入 RagChatService，默认 Local RAG 在既有 AIChatService 之前检索本地证据；Function 模式使用同一核心的受限工具循环。记录标题继续使用原始 Provider，不读取知识库。详情见 RAG_ARCHITECTURE.md。

请求保留 ID、取消语义和公开进度。事件只更新发起对话，切页/新建/切换对话不取消后台回答；显式停止、删除该对话、退出或关闭释放资源。最终正文和公开摘要校准流式事件。服务失败显示错误，不静默转为 Mock；不转发私有 reasoning/encrypted_content。

Responses 不再使用三分钟总时限。backend/chat/responses.ts 分别限制等待 HTTP 响应头和流静默五分钟，任何收到的数据（含 SSE 心跳）重置静默计时；持续有数据的思考/搜索不因总时长被取消。显式取消仍立即生效，静默与响应头超时有独立错误码，不把它们统一显示为网络故障。已有工具轮数/调用预算保持。合成八分钟活跃流验证客户端行为，不代表真实服务一定持续返回或不会断开。

contracts/activity.ts 的 ChatActivity/mergeActivityLog 在后台和 Renderer 共用纯类型/合并规则，最多保留100条有稳定ID的公开记录；工具/摘要沿用服务端 item/part ID，阶段使用请求内顺序 ID。web_search_call 记录搜索词、读取和页内查找，状态更新补全同一动作而不覆盖已收到的细节；链接仅 HTTP(S)，剔除查询/片段和凭据。明确 phase=commentary 的公开消息单独作为活动，不混入结构化 answer/changes；普通私有 reasoning 事件仅表示正在思考。SSE/完整 JSON 的最终结果均校准公开摘要/活动，reasoning.summary 继续请求 auto。没有服务端动作时不构造步骤或命令。

preparation store 记录每次准备回复的 startedAt/durationMs，成功/失败/停止均固定最终用时；ResponseProgress 负责每秒显示、时间下方分隔线及逐行公开活动。字段作为可选消息元数据沿用 voxcue-preparation-chats v1 保存，无数据库升级/迁移，旧聊天没有用时就不补造。恢复中的未完成回复沿用已保存用时并标为停止，不计入应用关闭期间。取消及跨对话事件归属保持原规则。

ChatActivity 的 status/reasoning 两类记录用于准备聊天的时间线：主进程按真实事件切换阶段生成请求内顺序 ID，ReasoningSummary.entries 只投影有稳定 item/part ID 的公开文本，逐次更新原行；终态补齐同一 ID，不把旧标题挪到新状态后。完整 JSON 按 output 顺序生成 item added/done 与内容事件，与 SSE 共用相同处理链；私有推理内容不会进入活动契约。旧扁平 reasoningSummary 继续提供给其他既有调用方和旧聊天的显示降级，新版不猜测旧记录中缺失的状态顺序。所有记录仍在既有100项公开活动预算内，无额外账户调用。

services/responseProgress.ts 仅从公开 Markdown 标题/独立粗体行提取主标题，代码块不参与。ResponseProgress 每个标题独立默认折叠，没有“推理摘要”通用按钮；无标题正文直接显示，不生成标题。原生 details 保留键盘操作，Fluent 细折线箭头在文字后保留布局空间，只在悬停/聚焦时出现，展开后旋转。当前思考标题的文字滑过高亮在结束/停止后关闭，prefers-reduced-motion 禁用动画。公开摘要不设置语言偏好，直接展示服务原文；不增加翻译调用，正文仍遵循已有问题和个人指令。

PreparationPage 通过 useLayoutEffect 和 textarea 宽度 ResizeObserver，在用户输入、语音回填、草稿/对话恢复及窄窗折行后按当前实际行高重算高度。高度最小2行、最大11行，超过后内部滚动，缩短则收回；只修改准备聊天输入框，不影响发送/IME/语音/附件生命周期。

资料按钮确认的 applied/dismissed 状态随后续请求历史发送本机操作说明，AI 指令以当前已保存 profile 为准，不再次索要文字确认。最近有效提案的简短确认/拒绝由 preparation store 本地处理，使用 VoxCue 本机身份回执；技能联网同意单独处理，缺少摘要不发起搜索且不限制普通聊天。补充 JD 的草稿不再包含会被误识别为立即联网生成技能的未来用途说明。

准备聊天及附件按对话在本机持久保存，未发送初始草稿离开时生成可找回的草稿对话，关闭后恢复。失败/停止只允许重试当前对话的最后回答，复用原问题/附件，不重复用户消息、不覆盖当前输入草稿。面试 AI 独立取消，不停止采集；Answer 的可选 status/error 字段兼容旧记录，不迁移存储。迟到事件及完成结果均检查取消状态。

个人信息面板保留编辑草稿与保存基线；外部已确认提案更新后阻止旧稿覆盖，必须载入新资料再编辑。自定义指令为单份正文，AI 整理后等待提案确认；旧风格键只读兼容。

面试 IPC 对完整问题、模型与思考强度进行运行时校验，并核对主进程保存的开场配置。模型、设备和 effort 开场锁定；自动回答是可变的运行时选项。未知请求字段拒绝进入 AI 服务。

application/interviewContext.ts 在主进程维护本场原生终稿、已校验提交问题及完成的AI建议。main 仅将面试所属 SpeechHost 事件送入上下文；Renderer 不能提交或伪造麦克风上下文。按时间记录面试官/面试者、提交问题的前序ID、AI建议和转写间断，AI建议不视作实际口述。最近120条/约64KB、每条最多6000字，省略条数明确；无额外模型总结、凭据或磁盘读写。重载/暂停保留，关闭/新场清空。IPC 在生成前拍快照、成功且未取消后保存建议，迟到/失败/不完整结果不写入；RAG的末尾查询仍是当前问题。

面试输出规则由 interviewInstructions 在主进程统一提供：第一人称、专业且有逻辑的口语正文，实质性回答默认正常语速口述约60–90秒，当前问题/已确认自定义指令的明确时长、篇幅和格式要求优先；肯定、致谢、收尾或必要澄清保持简短。代码题使用带语言、保留换行缩进的Markdown围栏代码块，由既有MarkdownContent流式渲染与复制。不输出意图分析、作答建议、标题、整段引号或来源附录，纠错直接使用可口述的更正。RAG 引用规则遵循书面/口述格式，保留证据约束与不可信数据隔离；准备聊天仍使用其独立指令。

FloatingInterview在每个回答前直接展示已提交问题气泡；全软件去除原生title属性和按钮浮动文字，保留Modal可见标题、aria-label与焦点样式。contracts/interviewLayout为无原生依赖的共用几何工具，定义默认420×500转写、600×500回答及固定工具栏/下方透明提示空间。仅面板尺寸按比例改变，字体、控件、间距保持固定，浏览器通过视口CSS计算直接重排以展示更多内容，不使用整体transform或逐帧React状态更新。main以工具栏中心和顶部为锚点，按底角到锚点的向量投影计算尺寸，左右对称、向下扩缩；碰到工作区边缘限制扩展，不移走工具栏。相同指针位置直接跳过，原生DPI取整也不能触发重复setBounds。Renderer按帧合并最新指针意图，最多一个resize调用在途，结束先冲刷再释放；拖动期间暂时关闭面板backdrop-filter，结束恢复。左侧Expand图标，右侧水平镜像，手柄始终位于可见面板底角。Windows浮窗不使用原生整窗阴影，各可见组件保留对称局部阴影。新增只接受boolean的interview:transcript，由面试主frame调用、主进程保存可见性并收窄/恢复原生窗口，interview:state同步transcriptVisible，重载/收起保持；main/preload/DesktopAPI和编译/运行测试同步。

floating-notices位于面板下方独立预留区域，显示“此窗口未隐藏”或异常时不挤压/移动面板，长提示在此区域内滚动。interview store以speechWarnings按音源保存间断提示，同源健康activity或新有效segment清除，discontinuity终稿不视作恢复；speechError与回答error分开，running只清除语音错误。截图保护提示依据既有主进程返回状态显示，开启后消失，没有扩大保护能力或迁移数据。开场只读确认的知识库独占一行，音频设备与模型/effort分别成对并排。

面试回答输入区新增默认关闭的“附截图”，手动/自动提交问题时每次获取当前屏幕新截图；发送按钮前的屏幕截取按钮独立提交仅截图请求，并保留输入草稿和问题缓冲。公开InterviewAnswerRequest以screenshot='attach'/'only'区分，only分支禁止question；IPC继续校验面试主frame、本场模型/effort、字段白名单，不接受Renderer图片、路径或屏幕源ID。only请求只包含固定解题指令和当次图片，不带转写、对话历史、个人信息或RAG。失败/停止/重试保留请求模式，停止按钮阻止默认表单动作，避免控制立即变成发送按钮后误提交草稿。

main注入screenshot.ts原生捕获适配器，按面试浮窗所在显示器匹配desktopCapturer screen源；多屏无法匹配时明确报错，不静默选择其他屏幕。图像长边最多3840像素、编码最多8 MiB，优先PNG，过大转JPEG；Mac屏幕权限未获准明确失败，未宣称Mac真机验收。捕获前后检查AbortSignal和窗口销毁，取消后不进入Provider。截图只在主进程本次请求内存中作为ChatTurn.files传给既有ChatGPT input_image或Copilot blob链路；不经Renderer、剪贴板或磁盘，不存入历史。Answer仅增加可选screenshot模式元数据，旧存储键和无此字段的记录兼容。架构检查禁止截图适配器访问磁盘、账户、AI业务，也禁止application/backend直接导入该原生实现。沿用既有截图保护，不临时改变保护或隐藏窗口。

聊天与面试共用ResponseProgress，初始等待统一展示新版“正在思考”文字动画，移除旧圆点。Local RAG将实际检索标记为knowledge/thinking并以同一ID更新开始/完成，不能当作网页读取；真实web_search/open_page仍使用实际服务活动。公开思考、活动与用时位于response-progress底部分割线上方，正文之后自动折叠且可重新展开；不显示私有推理，不伪造实际工具步骤。面试复用已有公开摘要/活动字段，不改变历史数据格式。

contracts/chat.ts 的 reasoningEfforts 只含 Responses 参数有效值，不包含 Codex 客户端的 Ultra 模式。backend/chat/models.ts 对目录排序、去重并与已知模型官方范围取交集；目录缺失仅对已明确模型族使用官方能力，未知模型保持自动。GPT-6.1-Sol 的最高值为 max，参考 [官方模型文档](https://developers.openai.com/api/docs/models/gpt-6.1-sol)。旧面试设置的无效值读取为自动；参数拒绝不误判为 Function Calling 工具不支持。

## 本机文档存储

知识库保留创建、重命名、删除、导入/拖放、同名替换和原件管理。个人简历、聊天附件和知识库文档相互独立。IndexedDB 数据库 copilot-local-documents、版本 1、bases/documents stores 及 baseId index 保持不变。这里的 IndexedDB index 仅用于按库读取原件，不承担内容搜索。

导入先保存原件，再异步提交本地解析/Embedding/索引。PDF/DOCX/MD/TXT 可索引，其他 Office 原件保留；上传成功与可检索状态分开。替换先备份旧原件并持久停用旧索引，失败可重试。Renderer 经受控 IPC 与知识库 utilityProcess 通信。旧本机派生数据未删除、读取或迁移，历史记录中的未知附加字段继续原样保存，正文不受影响。

## 语音与权限

设置 → 面试设置管理下场设备、麦克风禁用/测试、模型和 effort。开始弹窗只读确认并预检；主进程再检查一次。系统音频固定面试官，麦克风固定面试者，仅系统音频进入问题缓冲。明确禁用麦克风才跳过其权限，不自动替换失效设备。

SpeechCoordinator 保留确认副本；主窗口语音输入固定默认麦克风，不能抢占已确认面试。重载先同步保存已接收文字、释放旧服务，再使用本场配置自动开始。正常结束等待尾段；音频不保存、不上传。麦克风测试离开设置/分类或换设备时停止。

Windows 权限通过 getMediaAccessStatus 与 WASAPI 无采样初始化检查；check 在 Start/读取缓冲前返回并释放。隐私入口仅接受固定 ms-settings:privacy-microphone，不暴露任意 URL/命令。原生 helper 由 build:audio 构建，模型开发目录 local-models/speech，包内 resources/models/speech。

语音固定为 Paraformer 中英 INT8 CPU，公开 SpeechOptions 仅含来源及音频设备，拒绝未知字段。旧设置不再读取或保存已撤除的 ASR/计算设备选择；无磁盘数据迁移。主进程、preload 和 Renderer 不加载原生推理。

backend/speech/models.ts 保留 Paraformer 固定文件列表和分块 SHA-256 校验；engine.ts/worker.ts 在独立 Worker 完成实时识别、Silero VAD、重采样与尾段冲刷。控制器继续串行停启、等待尾段、过滤旧 Worker 事件、保护两秒 PCM 队列；关闭释放 utilityProcess/Worker。面试结束期间尾段只归档，不触发新 AI 回答。

本次撤除 Qwen 专用 Worker/子进程/CUDA 库、动态模型目录和性能实验入口。包内语音模型按 Paraformer 文件白名单复制；清空旧编译/便携输出后重建，防止废弃 JavaScript/DLL/权重残留。sherpa 原生 CPU 依赖及当前知识库 E5/LanceDB 仍实际使用，保留。

原生助手保留 Windows 的 DATA_DISCONTINUITY 标记，不按位置跳跃自行判定丢帧。单次间断经公开 gap 事件提示，Worker reset受影响通道；旧尾段 reason=discontinuity 标记不完整，排除自动问题、模型事实和标题，导出保留标记。同一路10秒5次间断或积压/模型/设备故障仍停止。依据 [微软缓冲标记说明](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/ne-audioclient-_audclnt_bufferflags)，不把一次流状态切换等同于永久故障。epoch/Worker身份和启动尝试编号阻止旧回调影响新采集。

## 记录、窗口与凭据

记录使用既有 copilot-interview-history-v1，关闭前同步归档。主窗口通过 storage/focus 刷新；结束后标题任务由主进程排队，关闭浮窗不取消，退出登录/应用取消。标题只取面试官转录与已提交问题，不读取麦克风回答或本地资料；失败可重试，删除不复活。导出通过主窗口受限 IPC 和原生 TXT 保存弹窗。

手动重命名通过 history store → 既有本机存储服务完成，校验 1–80 字单行标题，始终读取最新记录并仅修改标题相关字段，保存失败保留原标题与输入。可选 titleSource 标记 manual/generated，旧记录无该字段仍兼容；不迁移或批量改写数据。手动保存设置 ready，自动标题成功/失败及迟到归档都不能覆盖手动标题；再次重命名仍可用，已删除记录不复活。列表按标题筛选，开始/结束日期选项按最新要求移除。

沿用 %APPDATA%/ai-interview-copilot 和所有原存储键。登录为独立窗口、系统浏览器授权；凭据仅主进程管理并系统加密，刷新串行保存轮换令牌。保护继续使用既有 Electron setContentProtection，不扩大范围或保证所有软件遵守。浮窗固定置顶、收起/展开、缩放与结束确认保持现状。

session:state沿用受控布尔IPC，仅主窗口主frame报告生成中、保存错误或未保存编辑，不传正文/附件/资料。main维护原生关闭确认（默认取消），批准后继续上述flush握手；普通聊天保留。显式退出登录先保存，再沿用登录窗口切换，避免重复确认。不改变userData、OAuth和既有存储键。

systemAccent hook 复用既有受控系统强调色 IPC，新增 copilot-accent-color-v1 本机外观偏好（system 或六种固定 HEX 白名单），缺失/未知值默认 system，不迁移旧设置。系统事件始终更新最近系统色，自选模式使用所选色；storage 及同窗口事件同步三个 Renderer。主题明暗变化只重新校准可读文字色，原始选定色仍用于选择背景/状态点。设置保存成功后才广播，失败明确展示；不需要新增 IPC 或访问系统设置。按最新反馈删除常规页聊天快捷说明/按钮及其回调，保留现有输入框/个人信息入口。

## 构建与验证

基础检查：pnpm check:architecture、pnpm typecheck、pnpm test、pnpm build。相关桌面 smoke 使用独立 userData。pnpm package:portable 只打包当前运行依赖、语音/RAG 模型和 WASAPI 助手；源码清理后先清除旧输出再构建，避免 TypeScript 留下已删除模块的 JS。

新电脑/全部多屏 DPI、真人长句和技术词准确率、物理热插拔/权限撤销、真实账户公开摘要和标题质量仍未完整验收。合成端口测试不能替代这些验收。
