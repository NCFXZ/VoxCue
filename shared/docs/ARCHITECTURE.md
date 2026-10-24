# VoxCue 架构

## 2026-10-24 RAG 本地改造

单一 Local RAG、分类有限重试、请求作用域证据复用、主进程索引/开场互斥及可信追问检索共用 shared。保留原模型/索引和管理页面，唯一删除的设置界面是整个知识库分类。诊断仅测试注入；完整流程及兼容边界以 [RAG 架构](RAG_ARCHITECTURE.md) 为准，下文旧 Function 记录仅作历史。


当前跨平台 UI 以[共用布局与平台控件](PLATFORM_UI.md)为准：布局、业务与展示契约共用，Mac AppKit/Liquid Glass 实现单独维护。

## 面试生成重试

`ipc/interview.ts` 在同一问题与配置快照内管理首次请求和最多三次额外尝试；0.5/1/2 秒的等待与实际生成共用取消信号。停止、结束及窗口生命周期取消立即释放等待，不追加请求；每次尝试结束后拒绝其迟到事件。截图沿用主进程原有引用，成功后才消费，不重新捕获；仅成功答案进入本场 AI 建议上下文。

`contracts/chat.ts` 的 `interview-retry` 事件经现有类型化 `chat:event` 通道传递次数。Renderer 沿用同一回答；新尝试首次正文替换旧正文，避免混合多次输出。`InterviewAnswerStatus` 在服务名称旁用固定字号显示重试次数、失败或停止，初次生成占位仍随气泡阅读字号变化。最终失败通过 `InterviewAnswerFailure` 在对应回答下方显示固定字号的警示卡，保留错误原因、重试入口及部分正文；所有回答警告都放在对应 article 内随回答滚动，输入框上方无固定警告。全部窗口尺寸统一紧凑排版：标题和重试按钮同排，错误原因下一行，仅占一行高度并可内部滚动。警示卡与回答气泡共用 `--radius-interview-answer` 的32px连续角，按钮沿用14px连续角，状态标签与图标分别保留胶囊和圆形。相同生成错误不再重复出现在底部通知，其他错误保持。返回最新按钮浮于输入区上方。输入、用时及工具栏状态继续固定字号，面试提示词和自定义指令内容保持。

## Qwen Windows 与 Mac 接入

当前两平台Qwen组件均为1.0.1，复用原始BF16 ASR归档及固定Q8_0 Aligner。Windows第三份归档为已发布的Runtime 1.0.1，由`qwen-windows-runtime-catalog.ts`固定ZIP与逐文件摘要；Mac继续使用随应用签名的运行时，不下载Windows归档。历史1.0.0 BF16/Runtime信任根和公开资源保留；缓存路径包括组件版本与组合摘要，三份归档完整认证后才原子启用Windows新组件。

语音模型/推理设备的独立切换使用RecognitionRouter：原采集Worker保留AEC与连续输入，Recognizer将Paraformer/Qwen分别放在可释放的独立Worker；候选后台加载，两路当前VAD均空闲后用各路最多300ms处理后PCM预热并切换唯一事件来源。候选加载/预热失败或超时保留旧识别，暂停/结束/断流取消；等待加载不阻塞协调器的捕获串行队列。旧识别器关闭/Worker退出释放ONNX或原生进程。只改变识别配置时保留问题、草稿、1800ms截止点及排队/去重，音源或物理设备变更继续停启重连。回答模型/effort仍是当前回答原快照、后续问题新配置。

浮窗设置纵向分区、标签在控件上方，窄屏单列；读取/订阅组件状态以准确显示模型可用性。组件IPC仅为已授权面试主frame开放无额外字段的status，修改操作保持原授权。

语音模型与设备由 SpeechOptions 确认、主进程验证，Worker 通过固定受管组件路径加载 Rust 进程。四句缓冲及原版对齐器负责真实音频裁剪。Paraformer 与 Qwen 均在 0.8 秒静音后收尾；自动回答统一从最后一次系统语音结束起按已处理音频累计1800ms，800ms分段包含其中，不再从终稿到达后额外等待1000ms。两种引擎回传VAD静音起点，Worker确认处理进度，控制器标记各路未处理包；仅系统silence终稿就绪、音频进度到达截止点且无待检查系统音频才提交。识别/IPC延迟计入预算，墙钟等待不能代替静音证据；重新开口取消旧截止点，去重、忙时排队及结束保护保持。Windows具体原生进程和资源认证见 [QWEN_WINDOWS_HANDOFF.md](QWEN_WINDOWS_HANDOFF.md)。Mac平台通过可信运行时路径注入同一Worker/QwenEngine，ASR选择Metal/CPU，Mac对齐器使用Q8_0磁盘权重和原Rust CPU计算；平台硬件探测使用无模型、无音频的metal-check协议，开始与重连独立校验。Mac签名运行时属于应用原生资源，组件仅认证同一ASR/Aligner归档，平台缓存摘要独立。细节见 [QWEN_MACOS.md](QWEN_MACOS.md)。下文旧 2200ms 为历史基线，当前音频静音截止规则以此段为准。

## Windows 0.5.0 本地回声处理

Windows 0.5.3 将回环无 PCM 时的兼容静音移到 WASAPI 原生端。仅在已排空捕获缓冲、IAudioClock 的实际设备位置持续前进且 QPC/频率一致时输出静音，保留 50ms 余量；冻结、失效或时钟跳变丢弃不确定区间，不能用墙钟外推。迟到真实包与补齐范围重叠时发送间断，重新建立识别边界。麦克风不走回环补齐；共享控制器两路均不按定时器制造进度。

Windows SpeechController在同一共享Worker中装配固定本地echoCancellation模块；路径仅来自平台构造器，prepare完成后才启动WASAPI。所选render端点保持完整应用混音和原系统转写，仅双音源麦克风经过固定AEC3 WASM；不改变系统设备或音量，不增加UI开关。两路GetBuffer首样本的QPC（100ns转ms）是共同单调时钟，墙钟仅供转写时间。时间戳无效/主机静音旁路滤波并保留连续重采样，不改变ASR输入采样率；参考缺失最多等待80ms后保留麦克风。48kHz/10ms重采样、有限参考队列、滤波延迟补偿、间断和停止冲刷在Windows适配器完成。

原生助手停止后读完缓存，WasapiCapture等待close（含stdout末包），drainBeforeRetire保持回调有效直到两路停止，之后共享Worker flush并等待确认；退出、强制停止及DSP错误仍显式失败。开发和便携装配都包含AEC3 JS/WASM/license、sherpa和本机ONNX资源，不导入Mac模块。下方Windows旧退休顺序和未处理AEC的描述为历史基线。

## 当前共享面试上下文与检索（Windows 0.3.1；Mac 本地 0.3.1）

两阶段用量优化已在共享源码局部撤销；已发布 0.3.0 仍保留原优化行为。speech/QuestionBuffer 与 interview store 不做明确回应分类，系统终稿按原 2200ms 静音和自动回答条件提交，麦克风不触发回答；忙时排队、手动临时稿、片段去重、取消与迟到保护保持。

主进程 InterviewContext 每次序列化完整保留窗口，各条直接发送 text，保持 kind、at、questionId/previousQuestionId，包含真实发言、已提交问题、AI 建议和 gap。不生成 textRef/textReferenceRule 或 historySelection，不增加摘要/分类调用。原 120 条、64000 字节、每条 6000 字及 omittedOlderEntries 边界不变；当前问题仍在最后，RAG 仅在可信连续追问时派生有界检索主题。上下文快照、场次 revision 和迟到回答保护保持，记录格式不改。

KnowledgeService 每次查询执行既有串行检索，不再持有精确查询结果 LRU；revisions 和模型缓存、知识库隔离、检索排序/模式/topK、取消与模型卸载/关闭保持。用量统计/token 账本和重置由原有服务负责，不受本次撤销影响。

## 独立本地组件

共享 ComponentService 从固定资产下载并校验语音/RAG，按资源版本及摘要缓存到 userData/component-cache；应用版本不参与缓存键。shared 共用下载、取消/重试、状态和功能限制，主进程独立校验注册窗口主 frame，不开放 URL/路径/命令。Windows/macOS 新构建排除模型与 ONNX Web，保留 adm-zip、Node CPU 依赖和各平台原生助手；resources/voxcue-components.json 启用缓存，完整旧包仍沿原路径。开发模型完整时复用原目录，否则使用同一组件服务。Windows 锁及生成配置已在其本机同步，Mac 目录保持只读。详见[组件说明](COMPONENTS.md)。

## Windows 原生展示

转发退出可能带来迟到的 mouseout；共享 leave 处理重新命中事件坐标，不在可交互区域盲目开启穿透。真正的透明留白仍交给后方窗口，按下、选择、拖动和缩放锁定保持。

`windows/electron/presentation.ts` 通过 NativePresentation 端口按平台策略动态装配；不静态引入 Mac 模块。适配器可提供运行时能力，主进程在创建窗口前将其布尔描述交给沙箱 preload；能力不替代窗口、主 frame 和精确参数校验。Windows 11 22H2+ 的 Acrylic 沿用材质种类，共享 CSS 提供滑杆遮罩与 60/30 浮窗曲线，不调用 setOpacity。旧系统保留参数及不透明回退；forced-colors/减少透明偏好关闭滤镜，不改注册表或系统主题。

主题仅设置 VoxCue 的 nativeTheme.themeSource。面试使用 normal 置顶，显示/恢复/意外关闭置顶时重用共享 pinInterview，不定时聚焦。共用入口按窗口防止同步状态回调重入；Windows 发现 HWND 已失去置顶时先清除 Chromium 旧层级，再恢复 normal 置顶，避免缓存状态与原生窗口不一致。空白穿透使用 setIgnoreMouseEvents 的 forward，交互命中与按下/拖动锁定继续共用。主窗口隐藏并跳过任务栏，浮窗自身跳过任务栏；结束后在无新面试时恢复主窗口任务栏入口与源 ICO，不修改用户固定项。Renderer 意外退出沿用关闭释放流程并恢复主窗口。

Windows 屏幕能力返回 not-required，准确表示当前捕获方式无需 Mac 式单独申请；申请及打开设置不提供虚假流程。状态查询不枚举来源或读取像素。实际捕获仍由主进程在当次显式请求中检查并报错，草稿只在内存，Renderer获得缩略图和不透明ID。0.5.9起仅显式发送的截图另行归档，读取原图也须用户点击，不在捕获或权限查询时保存。

紧凑窗口的控制层在内容之后生成 no-drag 排除区，按钮本身也明确 no-drag，防止后生成的页面拖动区覆盖。Windows 浮窗移动端口以手势起始尺寸 setBounds，并补偿分数 DPI 的尺寸回读；原生像素网格决定坐标，静止鼠标不重复发原生移动。Mac 未实现此可选端口时保持原 setPosition 路径。CSS 中前缀滤镜先于标准滤镜，避免压缩后丢失有效标准声明。

## 面试浮窗移动

共享三条杠使用普通 no-drag 指针区域及 useInterviewWindowDrag，不再依赖会吞掉指针事件的 CSS 原生拖动。手势通过指针捕获、单帧合并和串行 IPC 发送 start/move/end；公开 DesktopAPI、preload、主进程白名单一致。interview:move 只接受当前浮窗主 frame 的单个阶段对象，拒绝坐标、其他窗口、额外字段和未知动作。位置从主进程 screen.getCursorScreenPoint 与开始时的窗口位置计算，仅改变当前浮窗位置；同一位置不重复设置，不接受 Renderer 原生参数。

移动期间禁止切换鼠标穿透，结束后重新命中工具栏/面板与透明空白；命中使用窗口位置加 clientX/clientY 重建屏幕点，不直接依赖转发输入的 screenX/screenY。松开、取消、失焦、窗口关闭和重载均退休手势，收起、转写布局或缩放开始也清除旧移动状态。浮窗回归使用合成鼠标坐标，但通过真实指针捕获、preload/IPC 和 BrowserWindow 检查实际位置与尺寸，不能将其描述为物理鼠标原生操作验收。实现共用，Windows 专属目录只读；本机未进行 Windows 真机拖动验证。

更新：2026-10-17。以当前代码和 PROGRESS.md 为准。

## 共用界面与平台适配约定

Windows 与 Mac 使用 shared/src 中同一份 React 页面、设置组件、状态和偏好校验/保存代码。Vite 从 shared 构建界面，依赖和输出分别留在当前平台；已有 Mac 图标适配在编译时替换统一入口。后续通用设置只维护一个入口、参数和交互，系统能力由共享契约连接 windows/、macos/ 的具体实现，不复制两套 UI，也不把原生细节直接放入通用设置组件。

用户已授权此前清单 1–10 全部共用：透明度滑杆、浮窗背景/阅读层联动、应用主题联动、屏幕权限入口、持续置顶、透明画布穿透、面试期间图标隐藏/结束恢复、用量链接对齐、紧凑窗口布局及移除蓝色焦点外圈。置顶、穿透和图标隐藏保持自动行为，仅提供只读状态，不新增开关。Windows/Mac 各自重建使用这份源码；不跨设备同步偏好值或用户数据。

contracts/presentation.ts 定义纯布尔能力和全 false 的待适配缺省值。可信 DesktopPlatform 策略指定能力以及可选 presentationFile，window.ts 经 BrowserWindow additionalArguments 传给沙箱 preload；preload 只挑选五个严格等于 true 的布尔值，冻结后作为 DesktopAPI.presentation 展示元数据。它不授予任何原生权限；main 仍独立校验调用窗口、主 frame、参数和本机能力。preload 没有增加本地运行时 import，contextIsolation/sandbox 等安全设置保持。

shared/electron/presentation.ts 仅定义 NativePresentation 类型端口；main 按当前平台策略动态装配 macos/electron/presentation.ts，不静态导入两平台。Mac 适配器只调用 Electron 原生展示 API，持有 Dock hide 节流计时器，接收图标和面试窗口存活查询；面试生命周期、关闭保存、授权与竞态仍由 main 协调。架构约束仅允许该适配器依赖 electron 与 type-only 类型端口，纯平台 types 仅增加对纯 PresentationCapabilities 的 type-only 引用。

滑杆的 0–100 参数、默认 50、保存与 60/30 浮窗映射共用；原生效果就绪时加 frosted-ui，穿透使用独立 mouse-passthrough-ui，Mac 字体/图标差异仍留 macos-ui。Windows 当前接线见本文首节，不再按历史待适配状态处理。后续新功能/界面调整先按 AGENTS 询问同步范围，本轮已明确授权的 1–10 不重复询问。

## Mac 面试窗口生命周期

main 在面试浮窗 ready-to-show 中先准备/显示浮窗，再经 NativePresentation 隐藏主窗口和应用图标。Mac 适配器调用 app.dock.hide，延迟期限取最近 hide 与 show 的较晚时间加 1100ms，show 调用前及 Promise 完成后都更新时间，避免快速结束后再次面试时 hide 被忽略；回调只在面试窗口仍存活且图标可见时执行。浮窗关闭取消待执行 hide，异步 app.dock.show 完成后 main 恢复主窗口；期间新面试已打开则重新安排隐藏，退出时释放计时器且不恢复图标。恢复失败明确提示，不修改系统 Dock 偏好或固定项。背景见 [Electron Dock API](https://www.electronjs.org/docs/latest/api/dock) 与[原生转换保护说明](https://github.com/electron/electron/issues/37487)。

共享 SpeechController 继续串行执行；初始化前的 Worker exit 立即拒绝加载并清除超时。失败清理先退休 epoch/回调，使用 allSettled 清理所有采集端并退休 Worker，保留首个启动故障。尾段请求可 resolve/reject，Worker 退出立即拒绝等待，超时/停止失败都标记 error 并清除旧实例；启动每次异步边界后重新检查状态，不让同步原生故障后误报 running。正常 Mac 尾包排空及 Windows 原退休顺序保持。

captureInterviewScreen 对原生 getSources 增加十秒期限及 AbortSignal 竞争，完成/失败/取消都移除监听与计时器；挂起或迟到的原生结果不阻挡请求退休，也不编码/发送已取消图片。仍只从受控面试请求按次捕获，权限、显示器匹配、大小限制和内存隔离保持，不增加原生截图回退或权限绕过。

Dock 恢复前及 show Promise 完成后均显式 setIcon(resources.icon)，避免只在启动时指定的图标被宿主默认图标覆盖。Mac 开发宿主生成器复制现有 ICNS 到包内并设置 CFBundleIconFile；缓存指纹包含图标 SHA256，图标变化时生成新宿主，保留旧运行副本。应用标识、权限说明和本地开发签名方式不变，不修改厂商 Electron、系统 Dock 或真实用户资料。

统一 pinInterview 入口在 Mac 使用 floating 层级，Windows 保留 normal。Mac 浮窗在显示、恢复及置顶被意外关闭时重新应用置顶，失焦不重设层级、不调用 focus；所有桌面及全屏可见通过 setVisibleOnAllWorkspaces 配置，在 Dock 已隐藏的应用模式下跳过额外进程类型切换。重复启动优先聚焦面试浮窗。结束确认、音频释放、原生材质与 Windows 最小化流程保持。当前仅完成编译，运行测试仍暂停。

透明的 BrowserWindow 矩形不会因网页背景不可见而自动成为鼠标空洞。Mac 在创建/重载浮窗时默认 setIgnoreMouseEvents(true, { forward: true })；FloatingInterview 根据鼠标屏幕位置与当前网页命中，保留工具栏、双面板、缩放热区及提示卡交互，其余透明画布穿透。外层容器 pointer-events:none、可见表面 auto，防止空容器占据网页命中。按下/拖动/缩放时不切换，mouseup 后释放锁再刷新；ResizeObserver 与 resize 处理布局变化，卸载释放监听并保留穿透，不轮询或抢焦点。

公开契约和 preload 使用布尔型 setInterviewMousePassthrough，发送固定 interview:mouse-passthrough；共享命中逻辑仅在 presentation.interviewMousePassthrough 就绪时订阅。主进程独立验证当前平台适配器/能力、当前浮窗、主 frame、恰好一个布尔参数，只调整该浮窗并跳过重复状态。没有任意窗口/原生选项/命令或路径输入。Windows 同样由本机适配器接入，公共契约编译断言与 preload 白名单保持同步。

## Mac 原生外观与界面主题

App 在登录/主窗口启动及主题偏好切换时，按 presentation.nativeTheme 能力调用受限 setNativeTheme。公开契约、preload 与 appearance:theme 频道一致；主进程校验已注册登录/主窗口、主 frame、恰好一个 light/dark/system 字符串和本机适配能力，再经类型端口调用 Mac 的 Electron nativeTheme.themeSource。它只覆盖 VoxCue 本进程的原生外观；system 移除覆盖并跟随系统，不写 macOS 偏好或影响其他应用。失败在界面提示，旧 effect 的异步回执不能覆盖新状态。

网页继续通过既有 copilot-theme 与媒体查询应用主题；原生外观变化后系统模式的媒体查询刷新，浮窗沿用存储/媒体事件。Mac sidebar vibrancy 材质保持，Windows 经本机适配器设置应用 nativeTheme；连续透明度仅调整网页表面，辅助功能时回退不透明。

## 共用连续毛玻璃设置

shared/src/frostedAppearance 仅为 Renderer 外观偏好，不调用原生材质或系统设置。设置使用原生 range 输入配合圆形滑块和连续填充轨道，范围 0–100、step=any，默认 50。v2 本机数值需为有限且在范围内的 JSON number；损坏值回退 50，旧 v1 四档只读映射为 0/25/50/100，不删除旧键。保存失败在界面提示。

WindowContent 在主/登录/面试各窗口挂载同一个偏好订阅，同窗口自定义事件与跨窗口 storage 事件只读应用 CSS 变量，不回写循环。主侧栏按常规滑杆 0–100 插值；面试背景使用独立本机偏好与滑块，总比例 scale=interviewValue/100，主设置预览与实际浮窗共用分层表面。frostedProfiles保存原始曲线，浮窗面板、工具栏和模糊从原曲线的 60×scale 取值，阅读/输入底色从 30×scale 取值。滑杆 100 对应背景/阅读层 60/30，50 对应 30/15，不再在 60 后停滞。拉满时面板浅/深不透明度 0.632/0.692、工具栏 0.768/0.804、阅读/输入 0.812/0.856、附加模糊 19.2px。主侧栏高透明度仅调整主题文字颜色，浮窗不响应该字色增强；文字阴影、细描边和图标 drop-shadow 全部撤除。60/30 为相对效果位置，不等于原生窗口整体透光率；辅助功能时各窗口均回退不透明并关闭背景滤镜。

滑杆不改变原生材质种类或窗口整体 alpha。Windows 已通过本机展示适配器按系统支持情况开启 frosted-ui，复用同一映射、设置组件和存储格式。

## Mac 界面图标

界面继续使用 shared/src/components/icons 的统一命名与随文字缩放的尺寸契约。Windows 默认解析原 Fluent React 实现；Mac 的 Vite 插件只把解析到该精确入口的相对导入映射至 macos/src/icons.tsx，不修改业务组件或判断运行时平台，构建拒绝任何 Fluent UI 模块进入 Mac Renderer。Mac renderer 目录加入本平台类型与架构检查，适用与共享 Renderer 相同的原生/后台访问禁令。

macos/src/symbols.json 对应全部公共语义图标接口。AppKit SymbolBuilder 通过 NSImage imageWithSystemSymbolName 和 regular/medium 配置生成本平台 192px 透明 PNG；React 用独立 SVG alpha mask 和 currentColor 显示，标准图形按真实透明像素边界拟合到20/24画布，字号小/大图形保留差异；shared CSS统一随字号缩放并保留独立大图标，旋转/镜像、键盘焦点及按钮无障碍名称。生成器缺失符号时明确失败，不混用图标。工具、系统版本指纹与资源仅在 Mac .tools/.cache/public，build:symbols 或 Mac Vite 构建/开发/测试入口准备；产品启动不编译或下载，不需 SF Symbols 应用、字体包或新增 npm 依赖。应用和 Provider Logo 原件保持。

## Mac 屏幕权限

macos/native/ScreenPermission.mm 用公开 Core Graphics 权限 API 和 Node-API 8，仅查询/申请授权，不进行捕获；请求异步运行于本进程工作线程，保持 Electron/TCC 应用身份。macos/electron/screenPermission 通过注入协调系统状态和固定设置入口，只依赖公开纯契约；架构检查拒绝其导入捕获、磁盘或业务。main 按 Mac 策略加载本平台绑定，shared IPC 校验主窗口主 frame 和三个操作白名单，preload 仅暴露不可变能力与固定调用。

InterviewAccessReport 的可选 screenCapture 与 AudioSource/checks 分开，不扩展音源类型、不改变 Windows 报告。屏幕权限不足不影响 audio ready 或纯语音开场，实际截图仍须实时授权；设置面板/开场焦点返回刷新，不持久化授权、不自动启用截图。开发宿主通过暂存签名后交换，保留运行中旧宿主；Node 头文件和原生产物都在 Mac 局部缓存/目录，Windows 不写入。

## 平台编译与写入隔离

当前平台对另一平台目录只读，覆盖代码、配置、依赖、图标、生成结果及同步/格式化/清理脚本。共享变更保持另一平台契约，待办由其本机同步。sync-platform-manifests 只生成根与当前平台配置；根构建/格式化先检查本平台配置，不能调用旧的跨平台写入命令。

Electron TypeScript 入口只含 shared/electron 与本平台 electron。平台策略通过白名单目录动态加载；main 根据所选策略的 speechProcess 路径装配同目录 access/capture，路径不来自 Renderer/IPC。原生控制器和共用 Worker 边界保持；架构检查禁止 shared 静态导入平台实现，防止 TypeScript 自动把另一平台加入输出。build-electron 在系统临时目录编译、拒绝异平台输出，核对后原地更新本平台受管文件并保留输出目录身份；写入失败使用临时备份回滚，同输出由进程锁串行保护；实际 Mac 启动回归还检查 require.cache 没有 Windows 模块。

check:workspace 增加项目文件与生成目录检查。厂商依赖内部的跨平台资料、恢复档案和受保护私有历史资料保留，不手工拆删。Windows 旧配置与 dist-electron/macos 本轮只报告，留待 Windows 本机 sync:workspace、build。Mac Dock/启动器取 macos/public 的带透明边距衍生图，原件/Windows ICO 保持。

## 2026-10-17 Mac 原生音频与窗口增量

共用SpeechCoordinator另管理audio-test资源归属：主窗口经dictation的test/test-stop调用传递固定音源与测试令牌，后台10秒期限，事件路由仅状态/电平，测试转写不外传。显式interview:reconnect-audio仅面试主frame可调用，只改变音源/设备，保留系统来源，成功后更新confirmed.options；当前模型/资料锁定不变。取消、停止、结束与迟到重连均保护已有会话。Renderer的自动提交状态与取消本次沿用原2200ms时序，取消不改原始转写和手动草稿。

macos/electron/speech 适配 Core Audio 助手，windows/electron/speech 继续适配 WASAPI；原队列/ASR Worker/冲刷控制器抽至 shared/electron/backend/speech/controller，通过小型 CaptureAdapter 注入设备枚举和采集。业务/IPC/Renderer 不导入原生助手或推理。Mac 的 drainBeforeRetire 先排空尾包，Windows 默认原退休顺序不变。主进程按平台装配开场权限检查和既有 SpeechHost，未复制业务。

Mac适配器通过可信preprocessorFile向同一Worker装配echoCancellation，路径不来自Renderer/IPC；准备握手完成后才开始采集。双音源时，以所选输出设备所有应用的混音作为WebRTC AEC3参考，仅处理麦克风后送入原ASR；单音源原路保留。原生共同单调时钟与独立转写墙钟分别传递；48kHz/10ms帧、80ms等待、有界参考、缺失旁路和滤波尾段冲刷在Mac预处理器内完成，间断重置两个ASR通道。运行时错误显式停止。Mac专属固定WASM依赖随应用复制，不改变Windows依赖/处理，也不更改系统设备或音量。

macos/native/AudioCapture.mm 使用输出设备专属私有 tap 与独立 HAL 麦克风，使用既有有界 PCM 协议，无视频/音频落盘。原生无锁有界队列、格式/设备/默认路由变化检查及异常显式失败；系统权限由短时零采样启动请求，不假借 screen 状态。Mac 开发宿主、用途说明、ad-hoc 签名及双击启动器均局部生成，不修改厂商 node_modules、用户资料或全局应用。

macos 平台策略启用 main/login 原生红绿灯与标准 sidebar vibrancy，Renderer 经 preload 使用受控展示端口；系统字体、原生菜单、Dock 恢复、保存后退出和单实例均仅作用于 Mac。面试 HUD 保留已确认布局。2026-10-22 本地 Mac 外观适配：材质、原生控件与承载实现均在 `macos/`；页面布局和业务逻辑继续共用 `shared/`。侧栏采用 `NSGlassEffectView Regular`，无着色、内部直角，实际 Electron 前景位于 `contentView`。启用时保存并清除窗口不透明底色，关闭/重载/失败时恢复；Liquid Glass设置开关按用户要求移除，保留旧系统和辅助功能回退，不改写其他表面的旧透明度参数。

侧栏折叠、个人信息和开始面试使用无着色原生 over-glass 按钮，分别为圆形与胶囊；仅开始面试文字/图标使用主题色。原生层按主窗口真实焦点和共享主题调整外观，菜单或设置打开时保留这些按钮的原生样式。

顶部与输入框直接使用相同的 AppKit `NSGlassEffectView Regular` 材质；共享消息边界进入顶部时渐显，无内容覆盖时背景透明。虚化由 AppKit 渲染，不宣称已实现 `NSScrollEdgeEffectStyle`。输入框采用 Regular，无着色，保留原 40px 连续轮廓。其实际网页前景由独立原生合成表面放进玻璃 `contentView`，React portal 仍属于同一共享状态树。输入前景持续跟随共享锚点的几何位置，随个人信息栏、侧栏动画与窗口尺寸同步，避免只监听尺寸而漏掉位置变化造成裁切。返回最新消息按钮使用同一 Regular 材质，前景仍复用共享箭头/加载三点，悬停不清除原生背景；macOS 27+ 通过公开 `effectIsInteractive` 启用系统玻璃交互提亮，26 保留 Regular 背景。聊天背景原生不透明底层阻止顶部/输入框采样桌面；聊天滚动铺满底部，渐隐移至整列底端，保留末尾阅读空间及暂停阅读行为。

账户和其他下拉菜单直接使用 NSMenu 的系统材质、布局与键盘跟踪。AppKit 没有公开的菜单 Regular/Clear 选择参数；不添加网页色罩或模拟玻璃。原项目的前置 SF Symbols 继续显示，macOS 27+ 显式设置 preferredImageVisibility=visible，避免系统默认隐藏已有图标；选中勾选仍由系统菜单承担。菜单按实际点击区域和原生菜单固有尺寸贴边定位。设置仍使用共享 dialog；原生覆盖层按共享对话框边界做路径差集避让，不能用异或产生轮廓外的矩形残影，避免输入框盖住设置。用户最新允许压暗或虚化，现选择一次统一压暗背景，保留后方 Glass 外观，关闭设置后恢复；不再添加整窗 sheet 虚化材质。

知识库与面试记录顶部沿用同一原生 Regular 覆盖层，按共享内容边界渐显；知识库创建为36px圆形 + over-glass，与侧栏开关同尺寸。记录状态标记和知识库说明/检索区移除，重命名紧邻标题。折叠侧栏收窄为84px，开关随共享锚点移动。面试记录搜索横跨主内容区，以原生 NSSearchField 的自然单行高度居中放入 Regular；查询仍由共享 React 状态筛选，仅保留搜索框内清除入口。普通 content area 按钮与弹出触发框应用于聊天页/面试页之外的操作区域，包括个人信息栏和设置，按钮按实际承载表面选择：原生玻璃上使用AppKit NSButton/NSPopUpButton Glass（over-glass），不透明内容区使用Push（content），单图标保持36px；下拉使用NSPopUpButton，保留原图标；聊天耗时及面试操作等按钮沿用原样；复制按钮仅按用户追加要求改为圆弧胶囊，保持原颜色、尺寸与业务行为。编辑、重命名和删除默认仅圆形图标，删除首次点击展开确认胶囊，二次才执行；原 Esc/失焦/超时取消保持。原生控件同步 details 的折叠状态及匿名内容裁切，避免隐藏的编辑/删除和选择框露出。面试记录详情顶部导出、AI回答面板、删除三个动作单独使用 AppKit Glass，删除展开后继续为玻璃胶囊。普通按钮的原生绘制层不接收点击，保留共享元素的真实指针、键盘、表单和文件选择流程；搜索文本通过有界展示端口同步，不新增业务状态来源。

面试浮窗及其预览、侧栏聊天记录紧凑按钮保持原尺寸；其他单图标操作统一36×36px，与侧栏开关一致，删除展开胶囊同为36px高，默认即使用危险红色；原生 SF Symbol 同步显式颜色，网页确认内容作光学居中微调。原生胶囊按钮启用 imageHugsTitle，将图标和标题作为一组居中；共享按钮统一控件行高，面试浮窗及预览保持原尺寸。聊天技能更新提示和三个建议入口按单独要求改为胶囊，输入框仍保留原40px连续轮廓。准备页原生标题按自然文字高度居中，与顶部按钮共用横向中心线；零尺寸隐藏锚点不创建前景投影，恢复聊天路由后重试；窗口缩放使在途几何过期时保留已安装的原生输入层，并以新布局重试，避免销毁正在编辑的前景。更新设置中的“自动下载更新”改为原生 NSSwitch，NSSwitch直接接收原生鼠标追踪，通过有界的appearance:content-toggle事件同步共享元素；键盘、保存和更新业务仍由原共享设置处理，此开关不依赖侧栏 Liquid Glass 偏好开启。

面试浮窗单独适配原生 Liquid Glass：工具栏、转写和回答面板使用 Clear、无着色；转写气泡、问题/回答、异常提示与输入框使用和主聊天输入框相同的 Regular。按共享 DOM 的真实几何及滚动裁切放置 AppKit 背板，网页仅在原生启用后清除旧色罩/模糊，原文字、选择、输入和业务状态保持在同一 Chromium 前景。顶部折叠/品牌、设置、截图保护、结束、拖动及面板顶部操作使用 NSButton Glass 背板，保留来源图标与品牌内容、32px 原尺寸和既有事件；不改主聊天输入框轮廓。展示端口仅限面试主 frame，材质类型、数量、几何及裁切有界；旧系统、关闭偏好与辅助功能回退旧外观，收起/切换/卸载清理原生背板。Clear 背板使用局部 DarkAqua 与协调浅色文字/状态前景，避免浅色主题在暗背景上出现暗字；面试窗口及其预览固定深色，主进程在面试窗口准备时设置局部DarkAqua，Regular阅读面、输入与over-glass按钮同用深色。

共享层仅增加有界几何、颜色、透明度和固定动作的主窗口及面试主 frame 展示端口和固定资源装配；材质不共享。仅运行本轮展示端口、偏好、平台边界和隔离 GUI 的定向检查，不恢复全量矩阵。仅使用合成账户/资料、受控背景与自有窗口，不访问真实账户/凭据或采样硬件，临时内容退出清理、结果只在终端/内存。不改 Windows 专属、依赖/锁、版本、发行或真实安装，不提交推送。

以下旧 Mac 未实现描述为此前状态，以此节和 PROGRESS 最新记录为准。

## 实际目录与测试边界

根目录仅保留协作、进度、README、无依赖命令转发与必要配置。共享业务、契约、测试/夹具、PNG、模型与通用文档在 shared；Windows 原生源码、测试、ICO、依赖、构建、发行和既有运行结果在 windows；Mac arm64 依赖、构建和本机运行结果在 macos。完整映射见 [WORKSPACE_LAYOUT.md](WORKSPACE_LAYOUT.md)。

共同依赖/命令由 shared/package.json 声明，平台 package.platform.json 只声明差异；sync-platform-manifests 生成根/平台入口和配置。根命令按宿主系统转发，各平台有独立 node_modules、缓存、锁和输出，不建立共用依赖软链接。TypeScript paths/typeRoots 和 Vite 平台解析器从本平台找依赖，并保留 package exports/browser 条件；共享源码不导入平台 node_modules。源码单测的 CommonJS require 使用当前平台 NODE_PATH；生产编译后的目录依照正常 Node 模块解析。

测试源码分别在 shared/test、windows/test、macos/test；根据 2026-10-17 用户最新指令，两平台运行结果仅在终端/内存显示，成功和失败均零保留，不再写 test/results。必要隔离工作文件仅使用操作系统临时目录，结束/失败/取消须清理；现有持久化脚本须先改造再获准运行，测试仍暂停。既有生成结果已按权限和占用情况清理，Mac 117 个被占用旧目录暂留，Windows 349 个先前明确跳过的目录不重试。源码迁移恢复资料与纯清理审计单独位于平台 recovery。单测只收集各目录 unit/renderer，排除生成结果和恢复快照。生产禁止导入任一平台 test，Windows/Mac 专属实现不得互相依赖；其余 Renderer、preload、IPC、推理/数据库边界保持。

各平台 dist-electron 只镜像 shared 与本平台 Electron 源码，main/preload 关系和 sandbox 不变；Vite 输出本平台 dist。开发 desktopResources 从 shared/local-models 解析模型，PNG 原件在 shared/public，Mac 原生图标衍生物在 macos/public，Windows ICO/helper 在 windows；打包路径仍为 app/public、resources/models/native，Windows 打包补充复制共享 PNG。userData、凭据和数据键不变。

Mac build 包含 Core Audio、共享编译和本地启动器；本机原生双音源、零采样预检、ASR、停止冲刷、窗口/Dock 与启动器已验证，真实账户、外接设备/真人质量与签名分发仍未验收。Windows build 保留 WASAPI 和既有 NSIS；本次不生成独立分发安装包。历史下文中旧根路径与 Mac 未实现状态以本页最新增量和 PROGRESS 为准。

## 分平台正式更新与Mac arm64范围

更新目标限定Windows x64及macOS Apple Silicon原生arm64；Intel/Universal Mac不在支持范围。backend/updates/releases.ts负责纯发行筛选、稳定数字版本比较及清单字段投影；provider.ts通过固定公开GitHub Releases列表API分页读取，再访问所选Release目录的本平台清单，driver.ts配置electron-updater公开custom Provider接口。不存在/releases/latest或Atom依赖，平台可独立采用不同版本/Tag；现有v0.1.1标签兼容，Tag/标题/统一Latest标记不用于版本排序。

资产是显式协议：Windows要求latest.yml及VoxCue-Setup-<稳定版本>-x64.exe与对应blockmap；Mac要求latest-mac.yml及VoxCue-<稳定版本>-arm64.zip。仅已发布、非草稿、非预发布且完整uploaded资产进入候选，按版本数字排序，同版本按发布时间/Tag稳定选择。最高候选的清单版本必须与文件名一致，files中的本架构URL必须是资产原名、大小与列表一致、SHA512合法；只投影该文件与受限minimumSystemVersion，丢弃额外packages/外部URL/任意路径。下载URL始终由固定仓库、所选Tag及文件原名构造。

网络读取使用更新器netSession的fetch、credentials=omit，不读取账户凭据、环境令牌或Renderer URL。每次检查45秒总期限，分页100条/最多10页，单页8MiB、清单128KiB；超限/分页或网络失败、无当前平台完整正式包、最高候选清单损坏均明确失败，不将旧版误称最新。生命周期dispose取消分页/清单读取，旧结果/事件仍受原Service守卫；原下载取消、SHA512、进度、缓存、签名与安装由原NsisUpdater/MacUpdater执行。

main保留原UpdateService装配和IPC，Renderer/公开契约不变。启动检查下载、手动重启、本机保存握手、面试互斥和普通退出不安装保持；开发/便携禁用，只有受支持平台的packaged且存在app-update.yml才创建驱动。该文件继续供原生缓存/签名配置，运行时Provider覆盖全仓库Latest选择。未改打包/发布配置，未新增依赖或变更数据格式。Mac这里只完成策略/适配代码，尚无Mac安装包或真机/签名/安装验收。

## 统一主线与平台边界

main 为唯一长期开发入口，Windows/Mac 保留历史引用；0.2.0 按用户授权提交推送完整功能和目录整理，远端默认 Windows 保持。共享 React/Store/存储、AIChatService、application、contracts 与 IPC 各保留一份实现，没有按系统复制业务；生产源码和测试按共用/平台差异组织，上传状态见 PROGRESS。

`shared/electron/platform/{types,windows,macos,index}.ts` 为无 Electron 运行时依赖的纯策略/路径解析。Windows 保留 Acrylic、ICO、AppUserModelId、全部窗口关闭后退出、现有保护支持标志、固定隐私入口、WASAPI；macOS 使用 PNG、关闭窗口后驻留及钥匙串错误标签，不配置 Windows 材质/原生程序，也不宣称相同截图保护保证。非目标系统不声明原生支持。

`shared/electron/window.ts` 共用三类窗口选项、沙箱/preload、新窗口/导航限制及生产/开发 hash 入口；不持有业务状态，也不依赖 backend/application/IPC。main 在原有时点创建/加载窗口并保留授权切窗、关闭保存握手、重载取消、浮窗保护/normal置顶、中心缩放和资源释放。没有移动 userData、模型或原生文件。平台参数只从 main 注入后台；账户存储继续使用原 safeStorage 与 credentials.bin。未适配音频在 SpeechHost 创建 utilityProcess 前明确拒绝，WASAPI实现仍在原专用后端。

架构检查新增平台策略不可反向依赖业务/窗口、共享窗口不可依赖业务、backend/application不可直接依赖桌面策略/窗口；现有 Renderer、contracts、preload、推理和 Provider 限制保持。平台单测验证配置、资源位置、安全入口及不支持音频不启动进程，不能替代 Mac 真机。`build:shared` 为共享编译入口；完整 `build` 仍保留Windows原生编译，Mac仅arm64依赖、采集、外观、权限及构建分发待后续授权实施。

Electron 的 [窗口保护接口](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows) 不提供对所有捕获方式的相同保证；[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) 的系统后端不同。本轮保留已有同步加密 API，未升级 Electron 或改换凭据格式。完整本轮证据与后续边界见 CROSS_PLATFORM_REFACTOR.md。

对抗测试修复补充：准备聊天所有路由同时校验主窗口和主 frame；取消先退休原生请求槽，后续旧事件/结果均丢弃，主窗口重载也执行取消，与恢复为已停止的快照一致。HTTP 非成功正文独立执行取消、空闲计时与64 KiB上限。Renderer 的 storedValues 仅为本地数据的纯校验；聊天恢复按允许字段构造状态，历史嵌套损坏保留原始存储并显示错误，读取不执行迁移或删除。pnpm overrides 仅去除未调用的 LanceDB 可选提供器及 Mammoth CLI 解析依赖；打包遵循相同排除设置，实际文本 Embedder、DOCX 解析和语音路径不变。

## 账户额度

当前生产 ChatGPT 登录、聊天和额度共用固定官方 Codex 0.164.0 的托管 OAuth。ManagedChatGPTAuth 通过公开 account/read、getAuthStatus（includeToken/refreshToken）向主进程取得同一有效会话；其工作区来自官方托管令牌，SIWC 的 encrypted_auth_metadata 不解码也不伪造。公开 AuthSession 仅含受限身份及过期时间，账户标识按用户/工作区稳定哈希；access/refresh 令牌、原生参数和路径不进入 Renderer。旧 SIWC 授权代码仅保留既有兼容与回归边界，生产构造器明确注入 managed；旧凭据不自动读取或移植，必要时用户正常重新登录一次。

ChatGPTService 按可信原生 access 的 chatgptAccountId 选择固定 https://chatgpt.com/backend-api/codex 的模型目录及 Responses，发送同一 Bearer/ChatGPT-Account-Id。继续复用所有原有输入、SSE/JSON、资料提案、来源验证、本地工具、取消和账本处理；不借 Codex 开放线程或本机工具，不接受 Renderer 提供端点。官方运行时负责托管令牌续期和 keyring-only 存储，使用本应用专属 CODEX_HOME；不记录 stderr、不使用环境令牌/明文回退，不读取其他 Codex 安装的登录项。此适配固定于运行时0.164.0，真实账户网络兼容性仍需用户在正常授权后确认。

账户额度只读取当前同一会话，核对官方快照的 accountId（若有）及读取前后身份；旧账户/退出期间的迟到结果丢弃。返回五小时/周则分别显示，缺失不补齐，读取失败不触发登录。已删除 connection_required、独立连接/取消 IPC、UI/store 状态和 usage-binding.bin 消费者；唯一授权入口是登录页，设置只提供额度刷新及官方文字链接。此前两套授权的实现描述由本段覆盖。

额度与音量横条沿 shared 唯一布局、语义和数值更新，Mac 有界 progress-bar 类型仅接受0–100及 content 承载，实际绘制为 NSProgressIndicator 的 determinate bar。Windows 保留 shared 胶囊轨道/填充（999px、corner-shape:round），不导入 AppKit。聊天与面试停止按钮共用发送的实心主题色样式，业务取消不变。

`contracts/accountUsage.ts` 是纯展示契约；`chat:account-usage` 仅接受主窗口主frame零参数请求。SelectedChatService/RagChatService委派当前服务的可选accountUsage能力，不以本地token账本代替。Copilot使用现有隔离控制会话的quota.refresh读取官方套餐和额度；读取前后核对同一身份，错误使用固定公开文案，原始SDK错误、提供商身份/账户标识及任意字段不出IPC。

backend/copilot/quota只投影账户快照，忽略准入状态与其他提供商；权威预算可展示比例及已用，参考余额不推算消费、比例或重置。失败/缺失保留null，0/0不判耗尽；AI Credits、请求数、token与未知单位分开，不做货币/token换算。兼容快照的tokenBasedBilling不能单独证明单位为AI Credits。现有本机账本与逐回复统计继续保留，设置页已移除本应用累计计数和重置入口。Renderer以加载代际和查询版本排除旧账户迟到结果，提供刷新和官方用量入口；查询时间字段不在界面展示，数据可能有服务聚合延迟。布局在shared，Mac继续使用现有AppKit content展示，不新增原生IPC或平台分叉。

## ChatGPT / GitHub Copilot 登录与模型服务

ChatGPTAuthService的本地HTTP回调页由backend/auth/callbackPage纯静态模板生成，main注入共用PNG品牌资源；开发从shared/public读取，安装版从dist读取，不依赖平台原生ICO或外网。页面适配浅深色/窄屏，固定文案区分收到/无效/已使用/不存在，收到授权仅提示返回应用继续验证。请求参数与账户、授权码、令牌不进入HTML；无脚本、表单或外部字体/资源，CSP仅放行样式SHA-256及data图片，响应no-store/no-referrer/nosniff。Host/方法/路径/state/PKCE、回调一次消费与后续身份验证/凭据写入保持原流程。

2026-10-24 恢复 GitHub Copilot，与 ChatGPT 共用登录页面和 AIChatService/RAG/标题队列。main 装配两套授权/模型适配器，通过 SelectedChatService 按成功登录后保存的服务选择路由，不能通过模型 ID 切换账户。service.json 缺失时沿用 ChatGPT；失败登录不覆盖选择。Copilot 公开身份保存在 copilot-session.json，OAuth 令牌仅由固定官方 SDK/原生运行时 1.0.21 的系统凭据库管理，禁止明文同意、环境令牌、gh 认证及任意命令/文件工具。运行时使用独立工作目录，禁用配置发现、技能、文件钩子和会话遥测；只开放已授权网络搜索及有界本地知识工具。SDK 仅允许 backend/copilot 适配器导入。auth:copilot-sign-in 仅接受登录窗口主 frame 的零参数调用；取消/退出释放对应流程。Mac 两个品牌按钮由 AppKit Glass 绘制，shared 保留唯一布局和点击逻辑；Windows 使用共用网页控件。既有凭据和用户历史保留。

展示与语音恢复：ResponseProgress 在正文首次出现时折叠到“用时”，之后用户可自行展开，不随每个 chunk 重复关闭。系统问题 debounce 就绪状态在生成期间保留，回答完成后按本场状态补交；系统间断清除不完整问题，麦克风间断不影响系统缓冲。浮窗手动清空输入只覆盖当前转写版本，新系统稿到达恢复跟随；非空手动编辑保留。未引入 AEC 或修改原生采样路径。

更新边界：backend/updates/driver.ts 只在 Windows 安装包存在固定 app-update.yml 时加载 electron-updater；service.ts 管理单次检查/下载/安装、版本化状态、错误及释放。IPC 仅主窗口主 frame 的 status/check/download/cancel/install 五操作，拒绝额外字段；公开契约不包含 URL、路径、凭据、发布说明 HTML 或原生下载对象。Renderer 的 services/updates、stores/updates 和 UpdatesPanel 分别负责受控调用、订阅/迟到状态过滤及展示，架构检查限定 updater 只进入更新后台，禁止其访问账户/资料/音频后台。

main 装配面试活动与安装准备回调，开场预检/浮窗期间拒绝安装，installing 期间拒绝新开场。更新安装复用现有关闭请求 ID 与聊天 flush 成功确认，不提前调用 quitAndInstall；取消、失败、超时及安装错误恢复关闭保护，窗口与下载结果保留。autoInstallOnAppQuit 关闭，只有显式点击可安装。NSIS 使用独立 staging 与既有原生依赖复制布局，userData/存储格式/凭据不变。发布与验证边界见 UPDATES.md。

普通聊天最新边界：services/chats.ts负责独立IndexedDB voxcue-preparation-chats v1的state/files事务，preparation store负责恢复、串行合并写入和失败重试。元数据与附件引用原子提交，Blob按ID去重；只回收新聊天库中不再被任何消息/草稿引用的附件。旧原件DB/用户路径不变，不做自动迁移。退出/关闭不删除普通聊天；面试临时会话/归档继续使用原边界。

session:request-close仅向主窗口发送请求ID，Renderer先停止生成并flush本地聊天，以session:close-ready返回ID+成功布尔；主进程校验窗口/frame/字段/当前请求后才关闭，超时或失败保留窗口。事件/调用契约、preload、main、类型及桌面回归同步。未保存个人编辑/生成中仍可默认取消；保存的普通聊天无需清空确认。

profile-preview与可确认profileChanges分离：后台只投影受限的部分字符串/技能正文，无代码求值或原始JSON协议；Renderer显示只读卡片。完整响应仍由原有validateChanges及真实技能联网证据校验；预览不能确认，停止后迟到事件被请求取消语义过滤，恢复的未完成预览仍只读。

ModelProvider为纯显示元数据，由实际服务适配器附在ChatModel和ChatResult中，现有main/preload类型化返回原样传递，不新增IPC或接受Renderer指定来源。通用UI通过useModelProvider/providers读取当前模型的显示名及资料接收方；缺失时用通用名称，保留旧字符串来源兼容。准备聊天先采用请求模型的来源；面试浮窗未收到来源时保持未知。两者以完成结果校准并逐回复保存，历史来源不会随选中模型变化。OAuth与真实ChatGPT服务错误仍由现有适配器负责，不引入新的提供商注册框架或模型连接。

发送按钮共享send-button样式，32px主题色圆底、20px白色Fluent上箭头；主输入麦克风同为20px图标/32px热区。移除用户指定的设置说明和无引用诊断样式，保留真实错误与恢复入口。

删除与用量重置使用共享原按钮确认控件。ConfirmDeleteButton/ConfirmResetButton 复用相同的三秒确认、Esc/失焦取消、目标版本校验和执行锁；首次点击不调用业务，确认后才调用各自store。UsagePanel继续由chatConnection负责重置生命周期和错误；没有新IPC或完成动画。列表/详情删除保留既有数据边界，只移除独立确认弹窗/顶部提示；侧栏采用更紧凑的确认按钮。

## 个人信息重做（最新）

公开 profile 契约增加可选 language、单份 customInstructions 正文及附来源的 skills；目标岗位退出活跃字段，旧 role 只兼容存储。准备聊天始终提供当前资料及严格结构化 answer/changes；主进程校验字段与总预算，Renderer 只展示通过校验的提案并在明确确认后本机保存。技能新增/改写还要求真实完成的 web_search 与实际来源匹配；摘要变化使技能提案过期。没有 AI 直接存储工具或知识库选择提案。

PersonalInfoPanel 负责默认折叠的资料展示、共用弹窗编辑/取消/保存及侧栏内删除确认；展开/收起采用 details 高度/透明度动画，减少动态效果时跳过。PreparationPage 提供受可用空间约束的分隔栏拖动、双击复位和键盘调整。preparation store 继续负责请求、确认基线、取消、失败恢复和技能更新询问；AI 提案及技能更新提示仅在聊天中展示。手动修改点击保存即确认，无前后对比；旧风格写入 UI 与直接上传替换简历的入口已撤除，原件读取保留。数据格式与恢复约定见 PERSONAL_INFO.md。

共享 Modal 外层负责圆角裁切，dialog-scroll 内层负责长内容滚动并给轨道上下内缩；设置的内部布局保持侧栏与内容分别滚动。浮窗字号按钮沿用同一偏好读写和同步机制，保存失败不改变字号，重试成功只清除该字号错误。

知识库选择独立于 AI 资料，UI 始终发送一个 ID 或 null。RagChatService 限定单库、过滤越界结果并校验文档归属，null/undefined 跳过所有检索和模型访问。SpeechCoordinator 保存主进程确认时深拷贝的资料/选择，本场回答只能使用该副本；interview IPC 拒绝 Renderer 额外覆盖字段。契约、校验、preload 调用方与编译期/桌面回归同步。沿用全部窗口、音频与凭据边界。

统一字号 token 为18/15/14/12px（标题/分区/正文和控件/辅助说明），共享角色规则覆盖全部 Renderer 窗口，不因明暗或窄窗改变字号。浅深主题与窄窗口回归入口见 test:ui:typography。

## 职责与依赖

- shared/src/components：展示和输入；shared/src/stores：界面状态、异步生命周期、取消和跨对话归属；shared/src/services：受控桌面接口适配、本机存储、内部测试实现。
- shared/electron/main.ts：窗口、权限、服务装配及应用生命周期；shared/electron/ipc：调用窗口校验、白名单路由和请求取消。
- shared/electron/application/speech.ts：音源自检与面试的串行资源归属、确认配置和锁定；historyTitle.ts：后台标题队列及模型无关的 AI 接口协调。
- shared/electron/backend/auth：系统浏览器授权和系统加密凭据；backend/chat：账户模型、Responses SSE/JSON、公开摘要、资料提案和本应用用量。
- shared/electron/application/knowledge.ts 与 rag*.ts：索引生命周期、共享上下文与两种 RAG 编排；backend/knowledge：本地解析、E5、LanceDB、不可变 revision 和原子 catalog，耗时任务在独立 utilityProcess。
- shared/electron/backend/speech：WASAPI 采集助手、独立 utilityProcess/Worker、本地 ASR/VAD。耗时推理不运行在 Renderer 或主进程。
- shared/electron/contracts：DesktopAPI、频道和公开类型的唯一来源，只依赖同层纯类型或校验。preload 的运行时仅导入 electron，其他项目引用为 import type。

Renderer 不访问 Node、Electron 原生模块、后台实现、凭据或模型。backend 不反向依赖 application、IPC 或 React。AIChatService 供 IPC 和标题队列使用，不建立全局服务容器。架构检查验证静态边界、运行时循环和主进程/preload 双向频道覆盖。

## 聊天与面试回答

chat:send 的失败结果增加可选 ChatPartialResponse，只含本请求已经收到的公开正文、公开摘要、只读 profilePreview、活动和来源，不包含 profileChanges/私有推理。IPC 在受控发送时累计受限快照，异常时与错误一并返回，解决快响应失败先于排队事件到达 Renderer 时丢失预览的竞争；成功路径仍用最终结果校准。ChatRequestError 保留错误码与快照，preparation store 在失败且未取消时补齐原对话消息，预览保持不可确认，迟到取消不写入。DesktopAPI/preload 沿用同一类型化频道，编译期明确禁止把失败快照当作提案；用户数据库版本/键不变，可选 errorCode 与预览正常持久保存。

来源收集同时处理 SSE output_item.done、注解和终态；只有完成的 web_search_call 才提供检索/打开/页内查找的工具证据。sourceKey 忽略片段和明确白名单追踪参数，不忽略域名、协议、路径或有效查询。最多300个唯一真实来源，避免显示用的旧50项上限影响后续引用验证；同页引用统一采用工具实际URL/标题。多余未匹配引用移除并明确警告，每项新增/改写技能仍须至少一个本次真实来源，否则整份提案不可保存；不能按同域猜测链接或用模型自称联网代替证据。旧资料与来源不批量改写。

当前共享第5组指令、结构化 answer 描述和技能按钮统一要求真实联网筛选适量面试准备资料，不设固定写作字数、不凑数量，完整内容只放 changes，answer 简短说明。技能选材优先官方文档、标准和可靠一手资料，关注版本/适用条件及分歧。sources 继续按真实工具结果匹配并保存，仅作后台核验；最多10项/每项6000字符等存储保护保持。PlainTextContent 共用于技能标题/正文、流式与失败预览、完整提案、已保存条目及技能聊天回复，Markdown 转为文字并隐藏网址/引用标记，复制采用显示文字；不改写原始内容或存储格式。技能回复根据已有请求任务/提案/预览元数据隐藏 ChatSources，普通聊天仍保留来源和 Markdown。skill_search_unverified/skill_sources_unverified 继续明确显示来源校验失败，未完成或校验失败不得确认；已发布0.3.0不包含这些0.3.1修改。

阶段合并复用 contracts/activity.ts：若新旧状态之间没有公开 reasoning 文本，删除旧空状态并追加最新状态；实际工具和公开说明保留。有公开思考内容才保留前一阶段。迟到完成事件不复活已替换状态；当前阶段与当前标题共用滑过高亮，结束/停止关闭，减少动画偏好同时生效。公开思考不设置语言要求，缺少摘要的提示文案移除“可以继续聊天。”，聊天权限行为保持。

准备聊天通过 preparation store → chat service → preload → chat IPC → AIChatService.stream；面试回答通过 interview store → speech service → interview IPC → 同一 AI 接口。本轮新授权接入 RagChatService，唯一 Local RAG 在既有 AIChatService 之前检索本地证据；自定义知识库工具循环已删除。记录标题继续使用原始 Provider，不读取知识库。详情见 RAG_ARCHITECTURE.md。

请求保留 ID、取消语义和公开进度。事件只更新发起对话，切页/新建/切换对话不取消后台回答；显式停止、删除该对话、退出或关闭释放资源。最终正文和公开摘要校准流式事件。服务失败显示错误，不静默转为 Mock；不转发私有 reasoning/encrypted_content。

Responses 不再使用三分钟总时限。backend/chat/responses.ts 分别限制等待 HTTP 响应头和流静默五分钟，任何收到的数据（含 SSE 心跳）重置静默计时；持续有数据的思考/搜索不因总时长被取消。显式取消仍立即生效，静默与响应头超时有独立错误码，不把它们统一显示为网络故障。已有工具轮数/调用预算保持。合成八分钟活跃流验证客户端行为，不代表真实服务一定持续返回或不会断开。

contracts/activity.ts 的 ChatActivity/mergeActivityLog 在后台和 Renderer 共用纯类型/合并规则，最多保留100条有稳定ID的公开记录；工具/摘要沿用服务端 item/part ID，阶段使用请求内顺序 ID。web_search_call 记录搜索词、读取和页内查找，状态更新补全同一动作而不覆盖已收到的细节；链接仅 HTTP(S)，剔除查询/片段和凭据。明确 phase=commentary 的公开消息单独作为活动，不混入结构化 answer/changes；普通私有 reasoning 事件仅表示正在思考。SSE/完整 JSON 的最终结果均校准公开摘要/活动，reasoning.summary 继续请求 auto。没有服务端动作时不构造步骤或命令。

preparation store 记录每次准备回复的 startedAt/durationMs，成功/失败/停止均固定最终用时；ResponseProgress 负责每秒显示、时间下方分隔线及逐行公开活动。字段作为可选消息元数据沿用 voxcue-preparation-chats v1 保存，无数据库升级/迁移，旧聊天没有用时就不补造。恢复中的未完成回复沿用已保存用时并标为停止，不计入应用关闭期间。取消及跨对话事件归属保持原规则。

ChatActivity 的 status/reasoning 两类记录用于准备聊天的时间线：主进程按真实事件切换阶段生成请求内顺序 ID，ReasoningSummary.entries 只投影有稳定 item/part ID 的公开文本，逐次更新原行；终态补齐同一 ID，不把旧标题挪到新状态后。完整 JSON 按 output 顺序生成 item added/done 与内容事件，与 SSE 共用相同处理链；私有推理内容不会进入活动契约。旧扁平 reasoningSummary 继续提供给其他既有调用方和旧聊天的显示降级，新版不猜测旧记录中缺失的状态顺序。所有记录仍在既有100项公开活动预算内，无额外账户调用。

services/responseProgress.ts 仅从公开 Markdown 标题/独立粗体行提取主标题，代码块不参与。ResponseProgress 每个标题独立默认折叠，没有“推理摘要”通用按钮；无标题正文直接显示，不生成标题。原生 details 保留键盘操作，Fluent 细折线箭头在文字后保留布局空间，只在悬停/聚焦时出现，展开后旋转。当前思考标题的文字滑过高亮在结束/停止后关闭，prefers-reduced-motion 禁用动画。公开摘要不设置语言偏好，直接展示服务原文；不增加翻译调用，正文仍遵循已有问题和个人指令。

PreparationPage 通过 useLayoutEffect 和 textarea 宽度 ResizeObserver，在用户输入、语音回填、草稿/对话恢复及窄窗折行后按当前实际行高重算高度。高度最小2行、最大11行，超过后内部滚动，缩短则收回；只修改准备聊天输入框，不影响发送/IME/语音/附件生命周期。

资料按钮确认的 applied/dismissed 状态随后续请求历史发送本机操作说明，AI 指令以当前已保存 profile 为准，不再次索要文字确认。最近有效提案的简短确认/拒绝由 preparation store 本地处理，使用 VoxCue 本机身份回执；技能联网同意单独处理，缺少摘要不发起搜索且不限制普通聊天。补充 JD 的草稿不再包含会被误识别为立即联网生成技能的未来用途说明。

准备聊天及附件按对话在本机持久保存，未发送初始草稿离开时生成可找回的草稿对话，关闭后恢复。失败/停止只允许重试当前对话的最后回答，复用原问题/附件，不重复用户消息、不覆盖当前输入草稿。面试 AI 独立取消，不停止采集；Answer 的可选 status/error 字段兼容旧记录，不迁移存储。迟到事件及完成结果均检查取消状态。

个人信息面板保留编辑草稿与保存基线；外部已确认提案更新后阻止旧稿覆盖，必须载入新资料再编辑。自定义指令为单份正文，AI 整理后等待提案确认；当前本地已移除旧回答风格状态、读取和提示词模块，不清理真实旧风格键。

面试 IPC 对完整问题、模型与思考强度进行运行时校验，并核对主进程保存的开场配置。模型、设备和 effort 开场锁定；自动回答是可变的运行时选项。未知请求字段拒绝进入 AI 服务。

application/interviewContext.ts 在主进程维护本场原生终稿、已校验提交问题及完成的AI建议。main 仅将面试所属 SpeechHost 事件送入上下文；Renderer 不能提交或伪造麦克风上下文。按时间记录面试官/面试者、提交问题的前序ID、AI建议和转写间断，AI建议不视作实际口述。最近120条/约64KB、每条最多6000字，省略条数明确；无额外模型总结、凭据或磁盘读写。重载/暂停保留，关闭/新场清空。IPC 在生成前拍快照、成功且未取消后保存建议，迟到/失败/不完整结果不写入；RAG 只对可信指代追问派生有界本地主题查询，生成问题与历史不变。

当前共享 0.3.1 的面试主提示词由 interviewInstructions 在主进程统一提供：第一人称、专业且有逻辑的自然口语，先回应问题，再讲理由和做法；不反问、索要资料或请求确认，含糊指代结合上下文理解，只有未知条件影响结论时才简短说明假设。知识库无相关内容仍依据通用专业知识回答；个人经历以确认资料和实际发言为准，不把通用方案当成真实经历，也不把资料缺失说成面试者没做过或答不上来。默认口述约60–90秒，明确时长、篇幅或格式要求优先，肯定/致谢/收尾简短回应。代码保留语言、换行和缩进，沿用既有MarkdownContent渲染与复制；AI建议不当作实际发言，缺失转写不补造。interview IPC 第2组追加本场资料、回答语言和补充要求，补充要求不能覆盖直接作答及个人事实依据规则；截图局部不清但题意可判断时继续回答，不猜测不可见内容。仅截图模式仍不附资料/历史/RAG。第3组RAG规则按需采用相关资料，未命中继续用通用专业知识回答，保留个人事实、引用格式和完整条目边界；自定义知识库 Function Calling 已退役，设置中的知识库分类已删除，原生网络搜索保持。检索流程、预算、取消及实际服务故障保护保持，详见 RAG_ARCHITECTURE.md；准备聊天保持独立指令。已发布0.3.0不包含这些0.3.1提示词修改。

准备聊天第4组主提示词在 shared/src/stores/preparation.ts，当前本地版本直接处理用户问题，信息不足先完成可确定部分，关键缺失影响结果时才简短询问；个人事实与示例/建议分开，网络来源真实引用，资料修改需确认保存，待确认提案不阻塞聊天。准备聊天按精简确认稿使用附件/网页/引用数据，不再拼接执行已保存自定义指令，字段保留供资料编辑；后台第5组资料提案协议保持；已弃用的第6组回答风格不再参与请求。第7组欢迎页自我介绍/项目经历按钮按进一步确认稿发送完整请求，未知个人事实明确占位或待补充，区分个人与团队成果；上传简历和补充缺失摘要限制更新范围，仅追加草稿，保留附件及手动发送/逐次确认。needsSkillResearch 排除明确否定的技能操作后再匹配肯定请求，不将摘要模板的“不生成技能”当作任务，原任务显式标记、缺失摘要检查和联网来源保护保持。模型/effort 和保存/取消保护保持，不将准备聊天的澄清规则追加到面试浮窗。第8组 historyTitle.ts 按确认提示词生成一到两个主要主题的短标题，通常10–20字、最多30字，简单主题可更短，无明确主题时回退“面试记录”；这些是提示词要求，既有代码输出上限及任务生命周期保持。

FloatingInterview在每个回答前直接展示已提交问题气泡；全软件去除原生title属性和按钮浮动文字，保留Modal可见标题、aria-label与焦点样式。contracts/interviewLayout为无原生依赖的共用几何工具，定义默认420×500转写、600×500回答及固定工具栏/下方透明提示空间。仅面板尺寸按比例改变，字体、控件、间距保持固定，浏览器通过视口CSS计算直接重排以展示更多内容，不使用整体transform或逐帧React状态更新。main以工具栏中心和顶部为锚点，按底角到锚点的向量投影计算尺寸，左右对称、向下扩缩；碰到工作区边缘限制扩展，不移走工具栏。相同指针位置直接跳过，原生DPI取整也不能触发重复setBounds。Renderer按帧合并最新指针意图，最多一个resize调用在途，结束先冲刷再释放；拖动期间暂时关闭面板backdrop-filter，结束恢复。左侧Expand图标，右侧水平镜像，手柄始终位于可见面板底角。Windows浮窗不使用原生整窗阴影，各可见组件保留对称局部阴影。新增只接受boolean的interview:transcript，由面试主frame调用、主进程保存可见性并收窄/恢复原生窗口，interview:state同步transcriptVisible，重载/收起保持；main/preload/DesktopAPI和编译/运行测试同步。

floating-notices位于面板下方独立预留区域，显示“此窗口未隐藏”或异常时不挤压/移动面板，长提示在此区域内滚动。interview store以speechWarnings按音源保存间断提示，同源健康activity或新有效segment清除，discontinuity终稿不视作恢复；speechError与回答error分开，running只清除语音错误。截图保护提示依据既有主进程返回状态显示，开启后消失，没有扩大保护能力或迁移数据。开场只读确认的知识库独占一行，音频设备与模型/effort分别成对并排。

面试输入区仅保留显式截图按钮，interview:screenshot受控IPC提供capture/remove/clear/archive四种操作，校验面试主frame及字段白名单。主进程暂存最多五张原图，捕获串行并可取消；捕获时Renderer只获取不透明ID和长边最多240px的JPEG缩略图，输入框展示可移除缩略图及数量/5。InterviewAnswerRequest只接收question及screenshotIds，不接受Renderer图片、路径、命令或屏幕源ID；ID须唯一、属于本场暂存且最多五个。显式发送先归档本次图片，保存失败保留草稿并阻止模型请求，成功后在对应问题下显示缩略图。发送不再次捕获，自动回答仅文字且不消费待发送图片。无文字的图片请求只使用固定解题指令与原图，不附转写、对话历史、个人资料或RAG。

main注入screenshot.ts原生捕获适配器，按浮窗所在显示器匹配desktopCapturer screen源；多屏无法匹配时明确报错，不静默选择其他屏幕。原图长边最多3840px、编码最多8MiB，优先PNG，过大转JPEG；权限、十秒期限、AbortSignal及窗口销毁保护保持。截图作为ChatTurn.files通过现有Provider图像接口发送，成功释放相应内存草稿，失败/停止保留供原图重试；移除后的失败回答不能静默重捕获。结束、关闭、重载清空内存暂存并取消在途捕获，迟到图像丢弃。沿用既有截图保护，不临时改变保护或隐藏窗口。

0.5.9的backend/interview/images.ts独立管理已发送图片，捕获适配器本身仍不访问磁盘。原始发送字节及缩略图分别保存在userData/interview-images-v1的UUID.image与UUID.preview，串行、临时文件原子写入及失败批次回收；重试按相同ID/字节幂等保存，不重新编码原图。记录仅存Answer.images的ID数组，不存base64或路径；缩略图在记录打开后按ID读取，原图只在点击时通过interview:image读取。该IPC仅接受主窗/面试主frame、有界ID和read/preview/save/remove，save与remove仅主窗可用，面试只读；save经系统保存对话框导出原始字节，Renderer不能指定写入路径或内容，拒绝路径、文件内容及符号链接。删除记录先保存元数据，再清理没有其他记录引用的原图与缩略图；文件读取失败显示明确状态，旧无图记录不迁移。共享InterviewImages将缩略图置于提问气泡内，纯图提问隐藏占位文字，标识在图片下方。查看器标题为“截图”，独立渲染在body弹层，左上标题、右上保存和关闭、图片两侧翻页；初始适应窗口显示，支持左右键翻页、滚轮/触控板锚点缩放与有界拖拽，双击复位；保存仅记录主窗的图标按钮，面试中隐藏并使用透明backdrop。Mac原生材质和控件观察body以覆盖Portal打开/关闭，不遗留遮罩及裁切。Mac排除缩略图的普通按钮投影，工具栏继续使用AppKit。图片不进入后续问题、RAG或TXT导出，TXT仅说明图片数量与应用内查看方式。

聊天与面试共用ResponseProgress，初始等待统一展示新版“正在思考”文字动画，移除旧圆点。Local RAG将实际检索标记为knowledge/thinking并以同一ID更新开始/完成，不能当作网页读取；真实web_search/open_page仍使用实际服务活动。公开思考、活动与用时位于response-progress底部分割线上方，正文之后自动折叠且可重新展开；不显示私有推理，不伪造实际工具步骤。面试复用已有公开摘要/活动字段，不改变历史数据格式。

contracts/chat.ts 的 reasoningEfforts 只含 Responses 参数有效值，不包含 Codex 客户端的 Ultra 模式。backend/chat/models.ts 对目录排序、去重并与已知模型官方范围取交集；目录缺失仅对已明确模型族使用官方能力，未知模型保持自动。GPT-6.1-Sol 的最高值为 max，参考 [官方模型文档](https://developers.openai.com/api/docs/models/gpt-6.1-sol)。旧面试设置的无效值读取为自动；参数拒绝仍保留准确错误分类，不自动短间隔重试。

## 本机文档存储

知识库保留创建、重命名、删除、导入/拖放、同名替换和原件管理。个人简历、聊天附件和知识库文档相互独立。IndexedDB 数据库 copilot-local-documents、版本 1、bases/documents stores 及 baseId index 保持不变。这里的 IndexedDB index 仅用于按库读取原件，不承担内容搜索。

导入先保存原件，再异步提交本地解析/Embedding/索引。PDF/DOCX/MD/TXT 可索引，其他 Office 原件保留；上传成功与可检索状态分开。替换先备份旧原件并持久停用旧索引，失败可重试。Renderer 经受控 IPC 与知识库 utilityProcess 通信。旧本机派生数据未删除、读取或迁移，历史记录中的未知附加字段继续原样保存，正文不受影响。

## 语音与权限

设置 → 面试设置管理下场设备、麦克风禁用/测试、模型和 effort。开始弹窗只读确认并预检；主进程再检查一次。系统音频固定面试官，麦克风固定面试者，仅系统音频进入问题缓冲。明确禁用麦克风才跳过其权限，不自动替换失效设备。

SpeechCoordinator 保留确认副本；开场音源自检不能抢占已确认面试，准备聊天不再提供语音输入。重载先同步保存已接收文字、释放旧服务，再使用本场配置自动开始。正常结束等待尾段；音频不保存、不上传。麦克风测试离开设置/分类或换设备时停止。

Windows 权限通过 getMediaAccessStatus 与 WASAPI 无采样初始化检查；check 在 Start/读取缓冲前返回并释放。隐私入口仅接受固定 ms-settings:privacy-microphone，不暴露任意 URL/命令。原生 helper 由 build:audio 构建，模型开发目录 local-models/speech，包内 resources/models/speech。

语音固定为 Paraformer 中英 INT8 CPU，公开 SpeechOptions 仅含来源及音频设备，拒绝未知字段。旧设置不再读取或保存已撤除的 ASR/计算设备选择；无磁盘数据迁移。主进程、preload 和 Renderer 不加载原生推理。

backend/speech/models.ts 保留 Paraformer 固定文件列表和分块 SHA-256 校验；engine.ts/worker.ts 在独立 Worker 完成实时识别、Silero VAD、重采样与尾段冲刷。控制器继续串行停启、等待尾段、过滤旧 Worker 事件、保护两秒 PCM 队列；关闭释放 utilityProcess/Worker。面试结束期间尾段只归档，不触发新 AI 回答。

本次撤除 Qwen 专用 Worker/子进程/CUDA 库、动态模型目录和性能实验入口。包内语音模型按 Paraformer 文件白名单复制；清空旧编译/便携输出后重建，防止废弃 JavaScript/DLL/权重残留。sherpa 原生 CPU 依赖及当前知识库 E5/LanceDB 仍实际使用，保留。

原生助手保留 Windows 的 DATA_DISCONTINUITY 标记，不按位置跳跃自行判定丢帧。单次间断经公开 gap 事件提示，Worker reset受影响通道；旧尾段 reason=discontinuity 标记不完整，排除自动问题、模型事实和标题，导出保留标记。同一路10秒5次间断或积压/模型/设备故障仍停止。依据 [微软缓冲标记说明](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/ne-audioclient-_audclnt_bufferflags)，不把一次流状态切换等同于永久故障。epoch/Worker身份和启动尝试编号阻止旧回调影响新采集。

## 记录、窗口与凭据

记录使用既有 copilot-interview-history-v1，关闭前同步归档。主窗口通过 storage/focus 刷新；结束后标题任务由主进程排队，关闭浮窗不取消，退出登录/应用取消。标题只取面试官转录与已提交问题，不读取麦克风回答或本地资料；失败可重试，删除不复活。导出通过主窗口受限 IPC 和原生 TXT 保存弹窗。

手动重命名通过 history store → 既有本机存储服务完成，校验 1–80 字单行标题，始终读取最新记录并仅修改标题相关字段，保存失败保留原标题与输入。可选 titleSource 标记 manual/generated，旧记录无该字段仍兼容；不迁移或批量改写数据。手动保存设置 ready，自动标题成功/失败及迟到归档都不能覆盖手动标题；再次重命名仍可用，已删除记录不复活。列表按标题筛选，开始/结束日期选项按最新要求移除。

共享 userData.ts 在 session/窗口创建前将旧 ai-interview-copilot 数据根原子重命名为 VoxCue，成功后旧路径消失；新旧目录均有内容、目录重定向或旧进程仍占用时停止。main 同时设置 userData/sessionData 为新根，测试覆盖根直接绕过真实迁移。所有原存储键及内部布局保持。登录为独立窗口、系统浏览器授权；凭据仅主进程管理并系统加密，刷新串行保存轮换令牌。保护继续使用既有 Electron setContentProtection，不扩大范围或保证所有软件遵守。浮窗固定置顶、收起/展开、缩放与结束确认保持现状。

session:state沿用受控布尔IPC，仅主窗口主frame报告生成中、保存错误或未保存编辑，不传正文/附件/资料。main维护原生关闭确认（默认取消），批准后继续上述flush握手；普通聊天保留。显式退出登录先保存，再沿用登录窗口切换，避免重复确认。不改变userData、OAuth和既有存储键。

systemAccent hook 复用既有受控系统强调色 IPC，新增 copilot-accent-color-v1 本机外观偏好（system 或六种固定 HEX 白名单），缺失/未知值默认 system，不迁移旧设置。系统事件始终更新最近系统色，自选模式使用所选色；storage 及同窗口事件同步三个 Renderer。主题明暗变化只重新校准可读文字色，原始选定色仍用于选择背景/状态点。设置保存成功后才广播，失败明确展示；不需要新增 IPC 或访问系统设置。按最新反馈删除常规页聊天快捷说明/按钮及其回调，保留现有输入框/个人信息入口。

## 构建与验证

基础检查：pnpm check:architecture、pnpm typecheck、pnpm test、pnpm build。相关桌面 smoke 使用独立 userData。pnpm package:portable 只打包当前运行依赖、语音/RAG 模型和 WASAPI 助手；源码清理后先清除旧输出再构建，避免 TypeScript 留下已删除模块的 JS。

新电脑/全部多屏 DPI、真人长句和技术词准确率、物理热插拔/权限撤销、真实账户公开摘要和标题质量仍未完整验收。合成端口测试不能替代这些验收。

## Mac 免费更新适配

`DesktopPlatform.updateDriverFile` 由可信平台策略选择，仅安装版主进程动态装配 `macos/electron/updates/driver`，不引入另一平台输出。共享 UpdateService 继续负责状态、面试保护与保存握手。Mac 复用固定 GitHub 分页选版及清单投影，再由 pinned Ed25519 公钥认证清单、流式下载/校验 SHA512；实际安装时临时 loopback feed 仅提供该 ZIP 给 `VoxCue.Updater.node`。Sparkle 内部进行归档 Ed25519 校验、替换和重启。Renderer/preload 无新增 URL、路径、密钥或安装命令接口。Mac 更新模块遵守与共享更新后台相同的凭据/聊天/音频/模型隔离检查。Windows 仍使用原 electron-updater。

2026-10-22展示层补充：Mac内容控件只同步外观，布局不随原生标记改变；几何按帧合并，NSButton图文缓存独立于几何。共享确认控件依据固有内容计算两态宽度，保留二次操作和取消边界。原生材质展示端口另用于主窗口卡片及面试设置预览（无动作能力，仍限制主帧、数量、样式、颜色和几何）；预览底景为独立原生渐变，Clear/Regular仍由NSGlassEffectView渲染。预览区域对网页背景做局部绘制裁切，关闭、滚动或回退时清除。浮窗设置使用同一内容控件/NSMenu转换，原面试控件尺寸保持。

面试设置顶部复用现用scroll-chrome的NSGlassEffectView Regular及原生标题，headerRadius仅该面试窗口固定标题可用，composer/follow/modal必须为空；不开放登录窗口或新的业务动作。共享Modal测量悬浮标题高度和正文覆盖量，初始避让后允许正文滚入，Windows用共用网页材质。Mac裁切原生顶部到对话框连续轮廓，未覆盖时关闭按钮为内容区，完全覆盖后进入实际glass.contentView，避免玻璃渐显令按钮一并消失。正文仍为共享Web滚动，不宣称NSScrollView或官方滚动边缘效果。

截图查看器的左右翻页与胶囊页码覆盖图片显示，不另占行列。content-controls的regular-overlay类型限定最多3项、44px高/160px宽，仅接受左右chevron空标题或1–5页码；不接受路径、字节或任意图形。Mac在Chromium前以实际NSGlassEffectView Regular及contentView绘制原生按钮/页码，命中与键盘语义仍来自共享DOM；Windows使用shared毛玻璃。记录保存按钮与关闭共用36px圆形区域/17px图标，Mac始终由同一NSButton绘制，原生悬停边框回调在控件进入最终窗口层级后同步并重绘，不在悬停时切换网页/原生图标；面试设置共享Modal显式透明backdrop，不压暗或虚化后方。

顶部按钮只在材质完全显示时进入header.contentView，其他阶段保留独立原生承载，避免继承材质渐隐；每次材质/模态状态更新都按已保存窗口几何重新定位，移除顶部先迁出控件。图片Regular的contentView同帧明确尺寸，不依赖后续AppKit布局才获得非零bounds。图片普通像素滚动平移（包括两指惯性），ctrl+wheel捏合/快捷滚轮及行/页滚轮缩放；不按滚动幅度猜测鼠标/触控板型号。

## 0.5.9 固定子进程的打包执行路径

Copilot主进程适配器通过`copilotRuntimeConnection()`核对固定1.0.21平台包，并以官方`RuntimeConnection.forStdio`选择`app.asar.unpacked`下真实可执行文件；不让SDK自动对ASAR虚拟路径chmod，也不使用环境指定的其他CLI。邻接runtime.node和资源随本平台包保留。Codex仍由既有`unpackedUsagePath()`处理固定0.164.0别名路径。两者不扩展到Renderer、不改SDK或凭据模式。最终包新增隔离ASAR握手探针，Windows依赖复制/包级断言和实际启动须其本机完成。
