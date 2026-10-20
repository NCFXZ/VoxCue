## Mac 0.5.1与Qwen Metal入口

`renderer/stores/components.test.ts`与`components-ui-smoke.mjs`检查删除当前语音模型后切到另一已安装模型/CPU、持久化及页面重载；任一语音模型就绪不误报缺失，Qwen/CPU性能提示及设置入口准确。检查中/删除失败/无替代/旧revision保护和重新下载不抢回选择，音频与回答配置保持。

采集停顿专项覆盖Mac不补造静音、系统/麦克风进度仅由实际包确认；识别器关闭失败时仍等待其他实例释放。`speech-soak.mjs --seconds=300`可通过`VOXCUE_TEST_SPEECH_MODELS`与`VOXCUE_SPEECH_FIXTURE_DIR`使用自有临时模型/固定公开音频，退出前执行关闭握手并等待Worker终止。Qwen删除专项同时确认ASR safetensors及当前Q8_0 GGUF存在且无文件占用，不能以缺失旧BF16路径冒充释放检查。

ForcedAligner Q8_0对照使用`shared/native/qwen-speech/examples/aligner-bench.rs`和`macos/test/scripts/qwen-aligner-compare.py`：固定公开FLEURS中英文各20条、两种语速合成TTS、交替运行同一Rust计算/安全裁剪，比较逐词时间戳及加载/推理。GGUF/Q8_0单测覆盖符号、精度还原、坏比例、截断/计数/形状和名字映射；原BF16仍可对照。Mac组件1.0.1使用Q8_0，Windows旧组件/运行时保持BF16。数值只到终端，详情见QWEN_MACOS。

Mac Metal使用随应用固定签名的私有CPython/MLX运行时，原始BF16权重、500ms流式块；CPU保留Rust1000ms。`qwen-native-smoke`额外检查原版异步对齐期间仍有临时稿、实时新增音频不丢失、MLX/Rust实际后端及退出。原生Cargo测试覆盖有界队列、轮换、取消、工作线程失败和过期结果。`qwen-comparison-workspace.mjs --prepare`配合开发`VOXCUE_PYTHON`准备隔离工具/原始权重，`qwen-comparison-corpus.py`固定中英文FLEURS各20条，`qwen-compare.py --backend=rust|mlx|native`同配置比较速度、WER/CER，`--realtime-seconds=30`按20ms包输入双路；结果仅终端，工具/输入退出清理。数字书写差异仍计错，小样本不代表真人面试准确率，详见QWEN_MACOS。

Mac的`qwen-native-smoke.mjs <临时已认证组件>`使用原BF16 ASR、Q8_0或BF16对齐器及合成TTS验证Metal/CPU流式推理、四句实际裁剪、静音和EOF退出，并将推理/对齐耗时及活动音频窗口仅输出终端。`qwen-worker-smoke.mjs <临时已认证组件>`通过生产Mac utilityProcess/controller/Worker/AEC与44.1kHz重采样验证相同链路，捕获端口为合成输入。`audio-synthetic-smoke.mjs`覆盖Mac采集适配器的合成进程、分片、非有限样本拒绝、尾包和20轮真实退出。原audio-native入口会采集物理设备，不在本轮执行。

`components-ui-smoke.mjs`共用Metal/CUDA及无加速设备的菜单/禁用/下载/警告断言；`--memory-preview`仅向终端输出内存图片。共享桌面入口的`VOXCUE_TEST_SCALE_FACTOR=1/1.25/1.5/1.75/2`在Mac与Windows均只影响独立测试Electron，不改系统显示设置。Mac签名、临时完整应用与组件生命周期仍沿用原专项；详细平台装配见[QWEN_MACOS.md](../docs/QWEN_MACOS.md)。所有输出遵守下文零保留规则。

## Windows 0.5.1 对抗与界面回归（2026-10-20）

语音包边界单测增加 NaN/正负无穷采样拒绝，阻止损坏数据进入重采样与识别。浮窗专项检查实际置顶状态及原生同步事件不会递归调用置顶；Windows 展示端口另覆盖丢失层级后的缓存重置和正常置顶时不做多余重置。20 轮面试及四次重载仍检查窗口退出、主窗口恢复和预热后的内存增长。

界面矩阵沿用“个性化”名称、统一 8px 控件圆角及按音频静音累计1800ms、800ms分段计入其中的提交规则。ui-alignment 同时检查个人信息标签距标题分割线至少 16px、模型/思考强度同组，以及长名称、窄聊天列下发送按钮对齐；五档 DPI 复用相同检查。ChoiceMenu 按最近的原生 dialog 计算避让边界，组件界面专项将带 CPU 提示的模型控件滚到弹窗底边，检查菜单翻转后四边仍保留 8px 间距。组件原生专项使用完整有效的面试配置验证缺模型阻止开场，并以组件 ID 定位分组后的下载项，保留实际下载认证、取消、进程退出和独占句柄检查。

`windows/test/scripts/qwen-native-smoke.py <component> --device cpu --wave <固定合成 WAV>` 也执行真实 CPU 识别，检查中间稿、静音终稿和退出；省略 WAV 的 CPU 模式只覆盖加载及静音。CUDA 模式可用 `--require-crop` 检查四句裁剪，终端仅输出处理音频时长、最大窗口、裁剪次数等摘要。输入及 CUDA 缓存只放自有系统临时目录，结束清理，不采样物理设备。

## 构建目录身份与不透明设置（2026-10-19）

electron-output单测覆盖连续更新的目录身份、过期编译文件、部分写入失败回滚、未知原件/重定向/空编译拒绝和并发构建锁。实际构建回归核对正常输出身份与编号目录；仅编译/回滚暂存在系统临时目录，退出清理，不保存测试报告。

interview-ux检查设置在常规0/50/100及浅深色下均不透明、无背景滤镜，改变底层画面不改变设置内部像素；透明外围、阴影、首击关闭、自动保存与面试60/30独立规则保持。紧凑状态继续检查两路实际电平衰减、勾/警告、悬停原因与减少动态效果。专用设置原生材质及几何IPC已移除，Mac开发和Windows本机验收分别执行。

## 分层面试预览与图标比例（2026-10-19）

interview-ux-smoke检查24px/18px侧栏品牌、常规尺寸且随文字缩放的公共图标、开场说明位于操作分割线上方且无前往面试设置按钮。浮窗设置无完成/应用按钮；透明backdrop外围像素不变，面板在常规0–100及浅深色下保持不透明、向下阴影生效、dialog存在时原生穿透为false，首次点击面试区域仅关闭而不误触结束。预览与实际面试在相同滑块位置使用相同背景/阅读层，独立面试偏好沿用旧版60/30曲线。开场双音源测试和设置页无麦克风测试仍覆盖。interview-typography覆盖12–24字号与0–100效果位置、浅深色/窄屏、预览输入框及即时保存；Mac icons检查实际alpha边界/图文比例，typography检查36px控件及窄窗口。仅临时合成账户/资料/音频端口与离线响应，不采样硬件或保存测试结果；用户要求的合成截图可指定输出目录交付。

## 授权回调页面（2026-10-19）

auth既有loopback合成登录测试检查收到/无效/重复回调的HTML与HTTP状态、固定内嵌Logo、CSP/no-store/no-referrer/nosniff，以及页面无脚本、外部请求、授权参数或令牌；收到回调不显示未经验证的登录成功。platform检查开发共用PNG与安装版dist路径，避免Windows原生ICO误用于网页。真实账户、浏览器官方授权、原登录密文与系统钥匙串不参与；必要视觉检查使用独立临时浏览器profile和合成页面，只截取页面内存，不保存截图或报告。

## Mac 固定本地签名（2026-10-19）

Mac目录运行`node test/scripts/development-signing-smoke.mjs`，使用同一固定本地证书对开发/正式两组不同资源内容的临时Mach-O与内嵌助手签名，检查不同CDHash仍具有相同designated requirement、开发权限声明保留、嵌套标识正确和替代ad-hoc签名被拒绝；重复读取身份须不轮换证书。`--packaged`另外调用正式buildMacApp，在临时目录构建实际完整应用并检查固定身份及签名材料不入包，不读取发行Ed25519私钥、不生成安装包或修改公开发行。测试不接触真实登录密文或Safe Storage项；不能替代旧身份首次系统授权的人工验证。所有合成文件由test-workspace退出清理，结果仅终端。

## Mac 应用图标轮廓（2026-10-19）

Mac目录内运行 `node test/scripts/app-icon-smoke.mjs`，用临时透明合成图检查原生生成器保留原图透明通道、不增加底板或圆角裁切，以及透明留白、中心图案、十个尺寸表示和ICNS结构，并核对最新共享Logo原字节保持。只在系统临时目录生成夹具，退出清理；无需GUI或真实屏幕/音频。主侧栏Logo为24px，由截图界面专项核对。

## 截图暂存专项（2026-10-19）

`pnpm test:interview:screenshot` 使用隔离离线Electron宿主、合成账户/语音与合成屏幕图像，覆盖截图不发送、输入框预览、1/5至5/5展开计数、五张限制、移除后补拍、五图手动发送、纯文字/仅图片、失败保留及原图重试、浅深布局与记录不含图像。截图仅在内存，临时profile退出清理；不进行真实屏幕或音频采样。该入口还断言部分回答失败后的错误和重试位于回答气泡内；ui-refinement覆盖个人资料正文/编辑12px与标题14px，typography保留其他控件14px规范。单测interview-screenshot-store/desktop-ipc另覆盖自动回答不消费截图、停止、关闭/重置和迟到结果，以及ID/字段/数量和主进程释放校验。

# VoxCue 测试入口

Windows 0.5.0新增`node test/scripts/echo-cancellation-smoke.mjs`，`--runtime-bundle`检查临时ASAR，`--packaged`构建并清理临时完整便携布局（不生成安装器）；均使用真实Electron Worker、固定本地AEC3 WASM与sherpa重采样，推理替身只收集DSP输出。`wasapi-packets-smoke.mjs`编译生产C#纯转换器，用合成多声道包验证混音/QPC/标志/分片解码，不实例化音频设备；`electron-output-smoke.mjs`验证Windows真实无共享文件锁、部分写入回滚、并发锁和目录身份。它们纳入Windows原生矩阵；五档DPI增加interview-ux，保留原有六组。AEC单测覆盖延迟回声、独立同时人声、0/120ms声学延迟、35ms启动差/持续时钟漂移、参考失效/缺失、四档采样率、尾段/间断及20次重连；capture-drain与speech-restart检查管道末包/prepare/QPC/旧回调。全部结果只在终端，临时资料退出清理；不采样硬件或真实屏幕。

原生矩阵传入临时公开模型路径时，以及AEC `--packaged`入口，另以实际Paraformer/VAD/ONNX验证同一AEC Worker和44.1kHz/QPC失效后的连续输入、flush与退出；不使用推理替身通过该附加检查。

更新：2026-10-17。用户已重新授权完整功能、面试稳定性和对抗性测试及故障修复。Liquid Glass 及其专项仍已撤回，不恢复原 test:all、test:materials、test:readability 等入口。

## 结果零保留

测试结果仅在终端或内存中显示；成功和失败均不保存报告、日志、截图、录屏、trace、coverage、数据库或隔离 userData/profile，不再按“每类最近 5 次”保留。必要工作文件仅使用操作系统临时目录，结束、失败、取消和可捕获的退出信号均须清理；异常中断残留在下次运行前清除。不得复制到工作区、recovery 或归档目录。

共用和 Mac 回归入口已使用 test-workspace.mjs：每次运行创建操作系统临时目录，登记自有进程/子进程，正常结束、异常退出和可捕获的取消信号清理；下次启动只清理有自有标记且所有登记进程均已退出的遗留目录，不跟随根路径链接。截图只返回内存 Buffer，报告/日志只写终端；数据库、输入文档、配置和测试程序等必要工作文件只存在于临时目录。保留 test/results 子路径名以兼容既有隔离断言，它实际位于随机临时根内。单测临时库由 afterEach/退出清理，Vitest 结果缓存禁用。Windows 专属旧脚本仍有持久化行为，Mac 不改写或运行这些脚本，需在 Windows 本机先改造。不要改用真实 userData、删除失败断言或省略隔离。

## 当前入口

Windows 接续 53476ab 增加 `node ../shared/test/scripts/knowledge-host-smoke.mjs`：启动前断网、真实 utilityProcess 和正式 process/host、合成 KnowledgeService 工作，无 BrowserWindow；检查七类错误码、未知 wire 码、实际15秒 Local RAG 期限、取消/退出/关闭及迟到结果。离线用量专项包含 knowledge-host 单测。`node test/scripts/components-native-smoke.mjs` 在当前 Windows 开发构建直接复用正式组件下载与删除断言，固定公开模型只进入临时受管缓存，检查取消/校验、重载复用、真实模型释放、独占句柄及删除/重下后的原件和索引保留，不打包或执行安装器。共用矩阵纳入 knowledge-host，Windows --windows 矩阵纳入 components-native 和 rag-core；rag-core 补真实进程的参数/未就绪/损坏配置错误类别。`--windows` 后可指定固定清单内的专项名，仅重跑选定项，默认仍完整运行。所有入口串行 GUI/原生、临时数据退出清理，结果仅终端。

离线宿主默认不放行网络，只有自有临时fixture可显式声明 `loopbackPort` 或 `componentDownloads`；前者仅允许HTTP 127.0.0.1的该端口，后者限后台固定模型清单及对应下载资产，不放开账户/普通网页。updates-native 使用声明端口的合成HTTP，保留实际NsisUpdater摘要校验与拒绝安装，并断言外网/其他端口仍拒绝。角点原生跟手检查先用物理像素比较再换算DIP，保留3 DIP限值，避免Windows分数DPI坐标读回取整产生额外误差。组件删除仍在实际exit/ONNX释放后立即做无共享打开，不靠重试文件占用放行。

角点拖动起始比例取当前实际窗口高度，原生layout专项覆盖左右边角、持续更新与工具栏中心/顶部固定，Windows --windows 可重复指定 interview-layout 做串行稳定性检查；不修改系统DPI，也不放宽3 DIP误差限值。

Mac 0.3.1 本地修复增加知识库错误码跨进程回归：knowledge-host 与 rag 覆盖参数/配置/完整性/未就绪/关闭/取消不可回退、可用性故障回退和期限竞争；未知错误不降级。profile-ui 覆盖手动摘要保存、空聊天和重载后的单一技能更新入口。ui-refinement 与 interview-typography 在 Mac 覆盖 Cmd 缩放，前者使用合成触摸手势检查视觉缩放限制；不采样物理触控板。旧开发态桌面入口统一在应用导入前阻断网络，明确 Vite 预览及安装态固定模型下载按各自传输夹具处理。

Mac 0.3.1 发行授权后运行 dmg 与正式 package-smoke：固定公钥直接验证最终 ZIP 的 Ed25519 签名、签名元数据和 SHA512，核对应用内公钥、版本及 DMG/ZIP 内容一致。updates-native 会在系统偏好目录建立临时测试域，当前仅系统临时目录的范围不运行该入口，也不运行 package-smoke 的 --install-archive。更新编排、签名和回环 feed 由单测及合成 updates/updates-sidebar 检查，不能记作原生 Sparkle 替换验收。components 使用临时测试 .app 检查真实组件流程；正式发行仅保留已授权三项，打包暂存和验证资料退出清理。物理音频及真实屏幕采样继续不执行。

Windows 0.3.1 沿用完整离线单测、typecheck/build/check:architecture/check:workspace、windows-suite 共用功能/--windows 原生矩阵及 --dpi 五档缩放；GUI/原生串行。electron 在每次重载后先检查简历区默认折叠，再展开核对原件保留；conversation-status 容许0.01 CSS像素内的几何取整误差；interview-workflow 使用现行导出的主提示词识别合成面试请求，避免旧字面前缀误分流，保留临时稿/终稿/手动提交和原生交互断言。发行前另运行 installer-branding、installer-engine（0.3.0到当前版）与 portable-native --with-installer，在系统临时目录构建并核对实际安装负载、ASAR、组件下载/取消/释放及原生窗口，不执行生产安装器。components-check 先核对知识库区默认折叠，再展开检查模型未就绪时禁用、下载后的启用及设置入口，保留真实下载/取消/摘要拒绝/重试断言。仅验证通过后保留正式 exe、blockmap、latest.yml，模型与隔离资料退出清理；不记录测试结果。macos/ 只读，不能将 Windows 回归当作 Mac 验收。

第2/4/5组最新补充由 desktop-ipc、profile-store、profile-proposal 检查资料用途、准备聊天不拼接执行面试自定义指令、外部内容边界及技能来源质量规则。rag 单测检查 Local RAG 搜索失败、完整条目部分失败/移除、原15秒预算、挂起端口超时与迟到结果、超时/取消竞争、身份/配置/参数错误不回退及 Provider 只调用一次；Function Calling 与知识核心保护沿用原入口。profile-ui 使用离线合成端口检查普通准备聊天与面试失败后继续回答、模型/effort保持，回退答案仍进入后续追问上下文；chat-progress 保留实际 Responses/SSE 的提案确认、来源核验和取消保护，并按第7组确认稿检查补充摘要入口。结果仅终端，临时资料退出清理，GUI 串行。

第5组资料/技能提示词由 profile-store、profile-proposal、personal-info 单测及 profile-ui、chat-progress 桌面入口覆盖。技能按需联网、无固定写作字数，按钮继续直接发起任务；新增 plain-text 单测检查 Markdown/网址/引用的纯文字展示。桌面断言覆盖流式、完成、失败、保存及重载后的链接隐藏、显示内容复制、原文/来源元数据保留，以及普通聊天仍展示来源；确认/拒绝、实际搜索/来源匹配、取消/迟到和存储上限保护保持。截图仅内存、工作文件仅系统临时目录，结果不落盘。

第6组弃用风格清理由 profile-store 覆盖：有效/损坏旧键均不再读取、不进入请求，不影响个人资料与知识库选择加载，原键和已确认自定义指令保留。第7组由 profile-ui 检查确认稿的四个真实快捷入口、完整请求、草稿/附件保留、直接发送与等待手动发送/确认的时序；profile-store 检查三种缺失摘要的新完整模板正常发送、附件保留及确认前不落盘，并保留旧提示兼容。renderer/services/preparation 检查“不生成技能”等明确否定不触发研究，独立肯定请求仍生效。第8组 history-title 单测检查新提示词传递、短标题与原输出上限、队列及取消信号/迟到保护；history-branding 使用 offline-electron-entry、合成账户/组件/语音端口及响应，检查结束面试后的标题请求、关闭后完成和失败重试，同时保留记录浏览/导出断言。代码长度上限保持，提示词另要求通常10–20字、最多30字，简单主题可更短；专项只验证协议与合成生命周期，不代表真实标题质量。

本轮共用界面专项 `node ../shared/test/scripts/ui-refinement-smoke.mjs` 使用离线临时宿主，检查登录/主窗口100%缩放、五类资料默认折叠、展开/收起中间动画帧与减少动态效果、弹窗编辑、按钮文字完整、分隔栏拖动/双击复位、完整上传区在导入前后不变、索引百分比/完成状态和思考耗时字号。`typography-smoke.mjs` 与 `ui-alignment-smoke.mjs` 保留全部界面的浅深主题、最小窗口、控件/图标/长标题/溢出检查；个人信息编辑断言改为弹窗与背景操作禁用。profile-ui、components-ui、composer 和 interview-typography 保留资料确认/保存/冲突、下载/删除确认、附件与字号同步保护；它们的宿主同样在应用导入前阻断网络。GUI 串行运行，截图只在内存，全部临时资料退出清理，不用真实账户或硬件。

ui-refinement 还检查五类分区快速切换反转、编辑 Escape/焦点返回/保存失败保留草稿与重试、分隔栏方向键/Home/上下限/取消及失焦/窄窗口、长弹窗内部滚动及圆角轨道内缩。加 `--preview-dialog` 仅向终端输出内存图片，供工具直接显示，不写图片文件。Windows `node test/scripts/windows-suite.mjs --dpi` 包含 ui-refinement，可在其后指定专项名。settings、knowledge、chat-response、delete-controls、ui-ux、updates-sidebar 的桌面宿主同样在应用导入前阻断网络，资料折叠与编辑弹窗断言沿用当前实现。

ui-alignment 的聊天工具栏矩阵覆盖主窗口与个人信息的多组宽度、浅深色、长模型名、最多两行的控件排布，以及模型/思考同组、语音/发送对齐、32px尺寸和菜单操作；网络搜索仅在“＋”菜单勾选，外侧无独立按钮，重新打开菜单保留状态。加 `--preview-composer` 只输出内存图片。Windows 可用 `node test/scripts/windows-suite.mjs --dpi ui-alignment` 串行检查五档缩放，不改系统设置。

`node ../shared/test/scripts/interview-usage-offline.mjs` 从本机平台目录离线检查当前本地撤销后的面试行为；已发布 0.3.0 的优化属于历史状态。临时预加载脚本阻断 fetch、HTTP/HTTPS及Socket/TLS实际网络连接，测试注入内存HTTP/SSE、合成转写和向量，并用临时LanceDB。加`--full`运行当前平台全部共用/平台单测与Renderer测试，仅允许127.0.0.1合成HTTP连接，外部网络仍在DNS前阻断；每次运行先验证网络拦截器。原专项入口保留，覆盖明确回应正常自动提交和手动发送、无标点口语、识别修订、分段/短停顿、麦克风插话、排队纠正、关闭/暂停/重置、优化前/恢复后规则回放、跨话题及连续追问的完整原文时间线（含全部 AI 建议）、不生成 textRef/historySelection、精确120条/64000字节/每条6000字边界和 omittedOlderEntries。检索检查重复查询重新编码并执行数据库检索、知识库/模式/topK隔离、取消、并发/失败更新和模型卸载/关闭保护；revisions/模型缓存保持。CPU/本地检索计时和载荷字节只能说明相应离线环节，不能当作真实token扣量、模型答案质量、语音识别率或联网首字速度。结果仅终端，临时拦截脚本及数据库退出清理，不读取真实账户/资料，不启动GUI或硬件。

`node ../shared/test/scripts/interview-usage-smoke.mjs` 从本机平台目录使用临时合成账户、转写和 Provider 检查桌面IPC链路：明确回应按原静音节奏正常自动提交、关闭自动后手动发送、重复长文本逐条原文、实际发言/AI建议身份、口语纠正，以及长历史跨话题返回和连续追问始终完整发送保留窗口。每次请求与主进程保留窗口逐条比较，不生成 textRef/historySelection，模型/effort/默认篇幅保持。offline-electron-entry在应用导入前阻断Node、Electron net及页面HTTP/WebSocket，使用临时profile，不采样硬件或调用真实模型，不表示真人答案质量、识别率或网络首字延迟验收。重复检索由knowledge-core使用临时真实LanceDB与合成向量检查；结果仅到终端，临时数据退出清理。

Windows 上下文桌面入口 `pnpm test:interview:context` 与生命周期入口 `node ../shared/test/scripts/interview-stability-smoke.mjs` 同样在应用导入前阻断网络，和用量专项串行运行。前者检查角色、追问、间断、重载保留和新场隔离，后者检查20次面试启闭、重载、保存、窗口/置顶恢复和内存边界，组件就绪状态显式使用合成夹具，不下载模型。它们不代替真实账户、物理音频、原生鼠标专项或 Mac 本机验证。

IPC/IndexedDB 的异步条件使用 wait-for-async.mjs：在测试宿主中逐次 await page.evaluate 的结果再轮询，避免当前 Playwright 将 async 谓词的 Promise 当作真值而提前结束 waitForFunction。同步 DOM/动画谓词继续使用 waitForFunction。Windows 安装态取消/摘要失败检查同时等待实际下载任务结束，再断言暂存为空和摘要拒绝；不降低断言或保存诊断结果。

2026-10-18 Windows 本机同步 0.2.2 配置、Copilot 移除及组件首次下载打包方案；macos/ 仅通过 Git 拉齐后只读。以下入口使用合成账户/资料/采集端口，不读取真实凭据，不采样真人音频或屏幕。屏幕权限状态 not-required 表示无需单独申请，不能代替真实截图或音频硬件验收。

Windows 从 windows/ 运行下列已改造入口（先准备本机构建）：

当前 Windows 生成配置通过根 sync:workspace 同步，依赖在 windows/ 使用冻结锁。DPI 矩阵包含 interview-typography，在 100/125/150/175/200% 下检查面试字号；功能驱动实时转发终端进度。composer 补查异步读取时切换对话与拖入提示清理，presentation-native 使用原生鼠标核对登录背景拖动及按钮禁止拖动。

隔离安装态 packaged-smoke 追加 component-removal-check：真实 Worker/utilityProcess/ONNX 模型配合合成采集端口，检查使用中拒绝、删除期间阻止新任务/下载、进程退出、RAG 卸载后的模型删除、未知顶层原件/目录保护、重新下载和知识库/索引保留。它不读取真实应用缓存，不以等待固定时长替代退出/卸载与实际文件删除断言。

Windows 句柄检查使用临时 WindowProbe 的 exclusive 操作：在真实退出/卸载后、删除之前，对固定模型清单及标记逐项执行 Win32 无共享只读打开；任何占用立即失败，自身句柄立即关闭，不读取文件内容或重试占用。

```powershell
pnpm test:windows:functional
pnpm test:windows:regression
pnpm test:presentation:native
pnpm test:speech:adversarial
pnpm test:portable:native
pnpm test:installer:artifact
pnpm test:installer:isolated
pnpm test:ui:dpi
```

`test:portable:native -- --installer-stage` 可验证已生成的安装包暂存目录，不重复打包；临时 WAV、profile 和原生探针仍在系统临时根清理。`test:installer:artifact` 校验 NSIS 压缩数据、更新清单 SHA512、blockmap 及暂存目录与实际安装负载的文件摘要，不执行安装。生产打包使用 windows/.cache/electron-builder 保存工具依赖，不写全局构建缓存。

Windows 自绘安装窗入口为 `node test/scripts/installer-branding-smoke.mjs`，加 `--preview` 以内存图片展示安装、进度和完成状态。它编译正式界面源码及无安装内容的 NSIS 样例，串行检查简体/英文/繁体下的开始、取消、完成、静默流程、界面异常退出及引擎故障；失败须明确显示并可关闭，静默失败保留非零退出码。不运行生产安装器、不写注册表或快捷方式。界面采用主程序的表面、字号、蓝色圆角与 36px 高度，主操作为右下角常规宽度；NSIS 后台负责安装流程，跨进程窗口消息必须有界或异步，避免引擎等待完成时冻结界面。全部样例、UI 副本、探针和 NSIS 暂存使用本次系统临时根并清理。

`node test/scripts/installer-engine-smoke.mjs` 使用正式 electron-builder 配置及 NSIS 模板，安装一个不访问用户数据的微型程序。独立应用 GUID、无快捷方式，安装、合成新旧数据根与包均在本次系统临时目录，结束/失败/取消清理自有注册项和文件。覆盖原生文件夹选择、中文/空格路径、既有安装按钮置灰与后台目录锁定、手动安装、非静默应用内更新、静默更新、仅当前用户限制、卸载默认保留、取消勾选直接删除、缺少旧数据根以及重定向保护；断言真实负载和引擎完成，补足空负载预览没有包含的用户范围页。界面样例另检查复选框没有被说明文字遮挡。不能与其他桌面测试并行，不运行生产 VoxCue 安装器或创建真实模型缓存。

functional 使用共享矩阵；regression 顺序运行平台、面试权限/思考/布局/工作流/上下文、更新传输、合成资料迁移、语音故障和原生展示回归。矩阵模型使用固定资产/摘要下载到临时根，开发宿主注入临时路径，不填充真实缓存。presentation 使用真实 HWND、任务栏 UIAutomation 和鼠标检查 Acrylic、ICO、窗口按钮、置顶及留白穿透，只向自有测试窗口发送点击，并恢复鼠标位置。所有桌面/鼠标测试必须串行，不能与另一个 GUI 测试同时运行；窗口遮挡时拒绝向其他应用发送输入。speech:adversarial 使用合成 WASAPI 端口驱动真实 Windows 控制器/Worker，不采样硬件。

原生鼠标检查要求 Windows 保持解锁，输入桌面为 Default 且光标可读取；缩放/工作流在原生操作前复核，缩放在拖动后再次检查。屏保或锁屏导致环境失败，不能把读取失败返回的零坐标当作有效位置，也不能跳过原生尺寸/命中断言、自动解锁或更改系统屏保设置。

portable 在自有系统临时根生成无模型应用，通过真实组件服务检查首次下载、首秒进度、取消、校验失败及重试，再替换应用位置并阻断模型网络请求，以原缓存验证 ASR Worker、utilityProcess、E5/LanceDB 和 PDF/DOCX。installer:isolated 在同一临时根构建 NSIS、验证安装负载/清单/blockmap，然后运行安装态与原生展示；不执行安装器、不覆盖 release、不上传。ui:dpi 仅给各独立 Electron 进程传入 100/125/150/175/200% 缩放，顺序覆盖 ui-alignment、typography、interview-typography、components-ui 和 updates-sidebar 的浅深主题、最小窗口及键盘操作，不修改系统缩放。临时资料、模型和包在成功/失败/退出时清理，截图只在内存。

Windows 上述驱动将固定公开 WAV 临时下载为输入，不声明真人语音质量；临时包、profile、文档和探针同样由 test-workspace 管理。已改造的单项入口包含 platform-native、interview-access/effort/layout/workflow/context、updates-native、user-data、packaged；旧物理音频、原生权限/真实安装升级脚本仍需先核对零保留与真实环境副作用，不能直接运行。test:speech:package 由隔离便携包入口验证，避免旧脚本采样硬件或假设内嵌模型。单测仅收集 shared 和当前平台的 unit/renderer。

speech-desktop 的 profile/截图/结果改为临时目录、内存和终端，默认拒绝物理采样；后续须单独确认当次硬件范围并显式传 --hardware-audio。本轮不运行该硬件入口，安装态使用上面的合成/公开音频回归。

从本机平台目录执行；依赖、构建与公开样本需已准备：

```sh
node ../shared/test/scripts/check-architecture.mjs
./node_modules/.bin/vitest run --config ../shared/vitest.config.mjs
node ../shared/test/scripts/functional-suite.mjs
node ../shared/test/scripts/updates-sidebar-smoke.mjs
node ../shared/test/scripts/components-ui-smoke.mjs
node ../shared/test/scripts/ui-alignment-smoke.mjs
node ../shared/test/scripts/typography-smoke.mjs
node ../shared/test/scripts/run-electron-node.mjs ../shared/test/scripts/speech-model-check.mjs
node ../shared/test/scripts/run-electron-node.mjs ../shared/test/scripts/speech-soak.mjs --seconds=300
```

functional-suite 顺序覆盖共用界面与本机原生窗口/权限/图标/启动器、用户数据迁移、更新和模型缓存；Mac 矩阵同时包含 dmg，核对临时压缩镜像的 Finder 布局、Retina 素材、拖拽目标、签名及取消卸载清理。运行前使用正式固定资源目录/摘要在本次临时根准备模型，并下载固定 revision/摘要的官方公开音频。开发态测试通过独立宿主注入临时模型路径，安装态回归仍使用真实组件缓存；不补回工作区或真实 userData 的模型。interview-stability 为重复面试、重载、Dock/置顶与透明度联动；audio-pipeline 使用合成采集端口驱动真实 utilityProcess、控制器、ASR Worker，并验证进程强制退出后的恢复。Mac native-build 只在临时目录编译/签名验证原生音频、权限绑定和启动器，不覆盖现用组件。

interview-stability 在确认按钮可见、可用且有限动画结束后，于单个 Renderer 任务中触发关闭处理器，再等待真实关闭、保存、主窗口/Dock 恢复和内存检查，避免预期销毁页面与 Playwright 鼠标动作回执竞态；原生按钮命中和真实点击由平台原生专项独立检查，不忽略页面异常。Windows presentation-native 还覆盖输入区新位置之后到达的旧空白离开事件，防止原生转发切换重新启用输入区穿透。

floating 的合成拖动仍使用真实指针捕获、preload、IPC 和 BrowserWindow；Windows 运行时暂将 OS 光标停放在测试窗口运动范围外，退出时恢复，避免透明 HWND 移动扫过静止系统光标产生无按键转发事件并结束 CDP 手势。真实鼠标操作继续由 presentation-native 覆盖。interview-screenshot 明确检查按钮可访问名称及普通 title 缺失，五张上限、失败原图重试、仅图上下文隔离和结果不落盘断言保持。

updates-sidebar 使用合成更新器及独立临时账户，覆盖侧栏状态对齐、各状态固定 32×32、仅圆环进度/取消图标、设置内完整百分比、自动下载开关保存、关闭设置后的后台进度和明确点击安装。updates-smoke 的手动下载/面试阻止/保存恢复回归使用独立模型可用状态夹具，不下载模型或更新包，不调用真实安装器；这些回归不代替原生安装或 Windows 本机验收。截图只在内存，结束清理全部临时资料。

components-ui 使用持续更新的合成组件状态，检查进度事件不会重启按钮宽度过渡、单个模型下载时另一个按钮的真实状态、红色图标取消及首秒进度、宽/窄窗口的个人信息和聊天列动画、提示居中、焦点恢复与减少动态效果。不下载真实模型；必要资料仅在系统临时目录，结束清理。安装态 components 回归下载真实资源，仅放慢首个 RAG 响应的实际字节以稳定检查悬停和浅深主题；请求、响应内容、大小/摘要校验、离线推理和升级复用保持真实。

ui-alignment 与 typography 使用独立合成账户/模型/语音状态，检查登录、准备聊天、个人信息与编辑、全部设置分类、知识库、记录、菜单和面试浮窗；覆盖浅深色、长名称、错误提示与主窗口最小尺寸。几何断言须等待有限动画完成，检查输入工具和发送按钮的行内对齐、常规控件高度、图标中心、弹窗操作和横向溢出。typography 可用 `--preview=personal-dark,knowledge-documents-narrow-dark` 只在终端以内存 JPEG 展示指定状态；不写图片或报告，不代替真实账户/硬件或 Windows 本机验收。

上述默认功能矩阵不启动物理麦克风采样；audio-native 是独立硬件入口，涉及真实设备，须先确认当次采样范围且环境中没有真人音频，不作为合成音频矩阵的一部分自动执行。

截图发送、取消、失败、重试和内存隔离默认使用合成图像。真实屏幕捕获是独立严格入口 `node ../shared/test/scripts/interview-screenshot-smoke.mjs --native-capture`，需要本机权限实际生效，失败不降级为成功或自动绕过系统控制；仅返回图像尺寸等元数据，桌面像素不保存或发给 Provider。合成账户/HTTP/SSE、合成设备和公开样本均不证明真实订阅、真人语音质量或另一平台硬件已验收。本轮执行结果只在终端/对话中报告，不写报告文件、验收数表或截图。

本次删除 Mac 101 项旧测试产物、4,420 文件；117 个旧目录仍被 fileproviderd 占用，暂留待释放后处理。Windows 349 个云占位目录按用户先前要求不重试，本机对 Windows 保持只读。旧报告链接仅为历史记录，不作为现存交付物。测试源码、固定输入夹具、现用模型/依赖/构建、真实原件及源码恢复基线保留。

## 源码与边界

共用面试体验入口为`node ../shared/test/scripts/interview-ux-smoke.mjs`：隔离合成账户、组件下载替身、音频端口及模型响应，覆盖原组件提示、资料标记、权限行内分路10秒自检/仅电平事件、静音800ms收尾、音频静音累计1800ms自动回答（包含800ms分段）、延迟终稿与音频积压/重新开口保护、原地音频恢复、音频/模型即时设置及回答中变更后仅影响下一题、独立显示滑块及浅深色/较小浮窗。`interview-typography-smoke.mjs`覆盖字号/背景滑块边界、键盘、存储失败、重载/重启与跨窗口同步、文字图标缩放及原生100%缩放；`updates-sidebar-smoke.mjs`检查靠左更新图标及下载/安装交互。默认不保存截图；只有用户要求交付时传`--screenshots=<明确交付目录>`，其余临时文件退出删除。共享单测覆盖后台测试期限/令牌、资源独占、音频重连竞争、模型/effort验证、知识库名前缀与手动标题保护，以及preload契约。Mac测试不代表Windows原生已验收。

设备自动枚举单测`audio-devices.test.ts`覆盖打开/焦点/设备通知/可见性/定时、并发合并、错误恢复及卸载后的迟到结果。`interview-ux-smoke.mjs`追加主/浮窗设备自动更新、无刷新按钮、白色滑块与两端图标、透明度预览、无电平尾部状态及固定底部说明，按用户要求可交付0/75透明度对照截图。`interview-typography-smoke.mjs`沿用键盘/范围/跨窗口/存储失败与窄窗口验证，并检查预览透明度随偏好改变。

自动回答边界单测：`automatic-question.test.ts`、`speech-endpoint.test.ts`和`speech-progress.test.ts`，覆盖两种引擎的音频时间、未处理帧/包、迟到终稿和墙钟停顿不触发；`speech-store`/`interview-usage-offline`保留去重、排队、结束和手动提交回归。
## 识别器后台切换与设置排版（2026-10-20）

speech-switch/speech-progress/speech-host/speech-session/speech-store覆盖后台加载期间持续处理、双路空闲交接、300ms PCM及时间戳边界、候选预热事件隔离、失败/超时保留旧配置、暂停/结束取消、迟到保护、原问题和1800ms截止点、回答模型独立更新。desktop-ipc限定浮窗组件status只读。interview-ux覆盖切换中回答设置仍可编辑、失败回退、原回答快照，以及960/620/440宽度的浅深色横向标签/控件和窄屏单列；截图可仅内存预览，结果不落盘。

Mac `node test/scripts/speech-switch-smoke.mjs --download`在自有临时目录通过生产ComponentService下载/认证固定公开Paraformer、原始Qwen ASR与当前Q8_0 Aligner，使用44.1kHz合成音频、实际AEC/utilityProcess/两层Worker/原生识别器验证模型与Metal/CPU交接和释放。不是硬件采集或真人质量测试，不读真实账户/模型缓存；临时文件退出清理。Windows专属夹具及本机原生验收仍留待Windows接续。
