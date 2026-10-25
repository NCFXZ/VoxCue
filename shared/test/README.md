# 当前测试入口（2026-10-25）

面试新增interview-motion和interview-chrome共用专项，检查动画圆角、快速切换、减少动态效果及草稿/滚动保留；chrome用高对比合成文字证明标题、返回最新圆形箭头和输入框不被正文穿透，并验证末行可读。web-materials核对共用网页材质、菜单、顶部及浅深色。侧边栏之外已统一聊天输入框材质，本轮局部系统绑定及interview-backdrop测试已移除；Windows无需局部原生模糊适配，但实际界面/DPI仍须本机验收。

Mac图标最新使用SF Symbols；build:shared自动生成资源，pnpm test:icons检查56项资源及登录/主窗/设置/面试浅深色图标。Mac功能矩阵已加入icons；内部控件/材质仍共用。

Mac 运行与 Windows 相同的产品 Renderer；旧原生展示探针及其入口已删除。下文标有历史日期的 Liquid Glass/AppKit 专项记录保留供追溯，不再执行。

在本平台目录执行：

```sh
corepack pnpm typecheck
corepack pnpm check:architecture
corepack pnpm check:workspace
corepack pnpm build
corepack pnpm test
node ../shared/test/scripts/functional-suite.mjs
# Mac 追加缩放视觉矩阵与10分钟合成语音稳定性
node test/scripts/ui-refinement-matrix.mjs
node ../shared/test/scripts/functional-suite.mjs speech-soak
```

完整功能矩阵包含实际界面的登录、账户额度、聊天/取消/重试、个人信息/技能编辑删除、知识库与RAG、面试、截图归档/查看/保存、更新、组件、对抗输入和20轮面试稳定性；Mac追加音频合成、权限、窗口生命周期、固定凭据助手、14.2编译目标与隔离签名薄包。默认不测试旧发行安装包，不更新真实安装。`package-smoke.mjs`仅用于未来重新生成并明确指定的新发行包。

测试使用隔离合成账户/资料及固定公开临时模型，GUI串行、退出清理。共用UI测试在Mac通过不等于Windows本机/DPI通过，14.2编译/ABI通过不等于旧macOS实机通过。临时输出仅终端或本次测试目录。

---

## 技能卡片原生操作回归（2026-10-24）

在`macos/`执行`node test/scripts/sidebar-glass-smoke.mjs --skills-only`，使用断网合成账户/技能验证实际AppKit编辑和删除按钮：原生图标位于不透明卡片上方，浅深色、嵌套折叠、长内容滚动、小窗口、鼠标编辑保存、删除确认/取消及重载持久化。`--preview`可逐次查看临时窗口截图，回车继续，退出清理；不访问真实资料或采样硬件。Windows共享页面保持，由其本机验证对应行为，不在Mac运行网页界面代验。

同一入口追加个人信息简历/JD/指令/知识库选择/技能控件在上下边界半露出时的原生mask与完整几何、可见/裁切区域鼠标命中、无网页回切及非法clip拒绝；`node test/scripts/interview-glass-smoke.mjs`追加顶部5个持续存在的AppKit over-glass控件、仅hover显示边框、移出/单独键盘焦点不显示背景、悬停前后图标位置不变，以及原折叠、拖动、设置与结束确认流程。悬停验收同时比较实际原生截图的图标外围像素，避免仅凭内部状态判断背景已经绘制。预览只捕获隔离自有窗口，退出删除。

Mac的`node test/scripts/sidebar-glass-smoke.mjs --content-only`另检查32px侧栏删除在常态、确认、取消时的同一原生控件身份及图标宽高，并核对离开行后隐藏；36px知识库删除也比较两态原生图标尺寸。`--preview=content-sidebar-delete-confirm`可临时查看两态截图，退出清理。

`node test/scripts/sidebar-glass-smoke.mjs --delete-only`为删除控件独立定向入口，使用合成对话/知识库验证浅深色AppKit图标尺寸、仅按钮hover显示背景、展开/取消不换原生身份、行离开隐藏以及二次删除。`--preview=delete-icon-hover-dark`临时查看深色hover，退出清理。

## 2026-10-24 Windows 0.5.9 接续入口

先按 WINDOWS_0.5.9_HANDOFF.md 同步本机固定依赖/配置，macos/ 只读。`test:windows:functional`、`test:windows:regression`、`test:ui:dpi` 串行覆盖共享界面、本平台原生及五档缩放；旧夹具使用当前托管登录、系统强调色、账户卡悬停色和六个设置分类，保留未知错误不重试及原排版要求。额度窗口对照原生实际内容宽度，间距按 Chromium 的 1/64 CSS 像素单位核对 4px，避免分数 DPI 的浮点表示差异。

`test:portable:native` 和 `test:installer:isolated` 在自有临时根构建负载并检查薄包、固定 win32-x64 SDK/运行时、真实 ASAR 代码与 unpacked 可执行路径。包内 Copilot 使用 empty stdio ping；Codex 使用临时空 file store/伪造令牌和拒绝代理，无真实 OAuth/推理。Koffi 不构建、不入包；继续拒绝模型、外平台二进制、密钥和本项目开发/测试文件。隔离安装只检查负载，不执行生产安装器。

在 `windows/` 执行 `node ../shared/test/scripts/interview-screenshot-smoke.mjs --native-hits`，复用完整合成截图链路，另由 `image-save-hit-check.mjs` 检查实际 HWND 的中心/四边、HTCLIENT/no-drag、浅深色稳定图标和外部悬停；`ImageSaveDialog.cs` 仅操作精确 PID/HWND 所属系统保存对话框，以临时 profile 为默认目录，验证真实保存/取消及字节一致。真实触控板、多显示器、账户推理和物理采样另行区分，不由合成事件代验。所有产物退出清理，结果只到终端/对话。

`node test/scripts/history-scrollbar-smoke.mjs` 使用合成长记录，逐档检查100/125/150/175/200%下浅深色、1280/960宽度及回答栏开关。只给滑块临时标记色，从实际窗口像素定位轨道起点，确认不进入固定工具栏，并检查正文滚动及导出命中；不以 DOM 样式存在代替像素验证。`--scale=1.75` 可定向复测；交互终端的 `--preview` 仅在本次临时根保留两张自有窗口预览，回车或退出清理。

## 2026-10-24 Mac 0.5.9 最终发行包检查

用户授权本次Mac DMG/ZIP/清单发行。`node test/scripts/package-smoke.mjs --install-archive`在自有临时副本验证最终签名/摘要/DMG/应用/薄包模型与实际Sparkle归档校验后取消；`node test/scripts/package-runtimes-smoke.mjs`实际加载最终ASAR内固定SDK并完成Copilot无登录ping及断网Codex空账户RPC。后者曾复现SDK自动发现ASAR虚拟路径chmod失败，生产现用固定真实unpacked路径和官方stdio连接，开发握手同步该入口。所有测试串行、退出清理，不替换真实安装。Mac v0.5.9发布后`package-smoke.mjs --online`已通过公开0.5.9版本选择、签名清单认证、完整更新ZIP下载与SHA512校验，旧Latest和其他资产保持。Windows对应包内握手和打包依赖另见0.5.9交接，不能用Mac通过代验。

## 2026-10-24 0.5.9 完整验收已恢复

本轮完整单测为89文件/902项；Mac功能矩阵29组另加官方进度条专项、五档缩放及Qwen完整专项通过。修复Copilot退出并发读取后重跑单测与登录专项。冻结240/160/200/172检索评估只复核，公开集门槛未全部达到，不与功能测试通过混用；保留已接受v7，不调整模型/索引或评估标签。

用户重新授权完整测试、清理及 UI 对齐，覆盖下文暂停/截图定向限制。Mac 运行实际 AppKit/Liquid Glass、共用逻辑、隔离迁移/更新/打包及固定公开临时模型专项，GUI/原生串行；Windows 网页界面、DPI 及系统集成仅 Windows 本机执行。截图端到端及原生保存命中纳入 Mac 矩阵。默认矩阵为源码验收，使用临时签名应用检查打包；仅显式选择 package 时校验已生成的正式发行资产，源码上传不要求生成发行ZIP/DMG。progress-controls检查官方横条，image-save-hit检查真实AppKit命中；后者可加 --preview 串行查看浅深截图，临时图片随退出清理。使用隔离合成账户/资料/捕获，不访问真实凭据或采样硬件，临时资料退出清理。测试通过后仅提交推送 0.5.9 源码，不发布安装包或标签。

## 2026-10-24 面试已发送图片归档（截图定向测试已授权）

用户最新仅恢复新增截图功能的定向测试和修复，其他矩阵仍暂停。仅隔离合成账户/图像、自有窗口，无真实账户、屏幕/音频采样或模型调用，临时原图/导出/profile退出清理；Mac只测实际AppKit，Windows界面由Windows本机验收。

已执行通过24项：interview-images、history-images、image-viewport、interview-screenshot-store全部用例，以及desktop-ipc按“截图”筛选的5项。覆盖跨实例读取、原图字节、原子保存/回收/幂等、路径/符号链接/大小限制、引用与删除保护、发送/失败/停止/重试/迟到、存储失败阻止模型请求、主frame/角色/字段边界及保存取消/错误。不支持图片或未知错误不自动重试，旧UI夹具按现有规则修正，生产重试策略不变。

`pnpm test:interview:screenshot`已通过发送五图/纯图/纯文字、失败重试复用原图、气泡内缩略图与标签、记录ID/原图、面试隐藏保存、左右键、捏合缩放/像素平移/拖拽/复位、实际文件导出字节一致、取消/错误、关闭重开。`macos/test/scripts/image-save-hit-check.mjs`以实际AppKit合成鼠标事件检查浅/深及1280×800、1000×720：保存位于关闭左侧，20个内部点击与8个外部悬停点通过，悬停图标坐标一致；Regular箭头/页码非零布局、原生页码更新及关闭后的控件/遮罩清理通过。查看器no-drag消除背景拖动区域干扰；不执行系统安装或其他功能测试。

## 2026-10-24 官方组件与系统配色定向入口

Mac在macos/串行运行 `node test/scripts/sidebar-glass-smoke.mjs --theme-only` 和 `--progress-only`：检查标准NSMenu行无自定义view、图标/勾选/原生键盘/Escape、主题色选项移除及系统强调色事件；核对官方NSProgressIndicator Small/Bar自然尺寸/中心、五小时和每周0/25/43/100数值及内存像素、合成麦克风/系统电平和聊天/面试停止行为。额度卡片摘要同字号/颜色/行，间距4px，骨架与结果匹配。

共享 `settings-smoke.mjs` 验证无主题色选项、旧颜色偏好忽略、系统颜色热更新和重启，明暗主题仍可保存；`web-materials-smoke.mjs` 核对Windows共用菜单/胶囊及合成系统色事件。accent-contrast/account-usage-ui/desktop-ipc/architecture单测保持对比度、契约与边界验证。Windows网页界面检查只在Windows本机执行，Mac不启用VOXCUE_TEST_WEB_RENDERER代验；不需要模型。结果仅终端/对话，GUI及原生串行，所有资料/探针退出清理。

## 2026-10-24 RAG 定向入口

v7后新增公开题源验证入口为`rag-unseen-oral-smoke.mjs --public-transfer`，仍从本机平台目录运行，可设置`VOXCUE_RAG_UNSEEN_FEATURES=1`做内存逐题对照。该夹具在v7生产源码/编译后端冻结后编写，不导入旧题集：16个Go/Python/服务调用/消息/事务及公开设计主题各6轮，共96个连续场景，另加16个换题、8个比较、20个无关、16个无前文/间断/AI建议、8个未收录项目及8个缺失事实，共172个场景、16份参考资料。逐主题保留不同于前组的公开题源和官方事实来源，口语改写及短笔记仍由开发方整理，CPython锁问题明确限定3.12；不冒充独立真人访谈或真实公司当前架构。

新旧后端使用同一已冻结输入；只对原公开200题和新172题做评估，不按它们的分数来回调参。原200题protocol中的implementation为首次v6基线的历史记录，当前实际版本看UNSEEN_RUNTIME.selection；不为显示新版本而改动既有题集哈希。新组沿用事前90%/80%/5%/5%工程门槛及整段六轮统计，门槛不因结果改变。仅固定公开临时E5、隔离索引及截取证据的合成Provider，结果只终端/对话，退出清理；未评估最终生成质量或Windows本机原生。开发验证使用rag-grounding及knowledge-core机制测试和既有rag-validation夹具，公开评估前已冻结生产。

本轮公开题只评估入口：在本机平台目录执行 `VOXCUE_RAG_UNSEEN_FEATURES=1 node ../shared/test/scripts/rag-unseen-oral-smoke.mjs --public`（Windows先设置同名环境变量）。`fixtures/rag-public-interview.ts`固定200个场景：20个公开主题各6轮口语链、20个明确换题、10个比较、20个无关、20个无前文/间断/AI建议/未收录案例及10个缺失具体事实。题源逐主题保留JavaGuide、H5BP和System Design Primer链接，答案要点另附官方文档来源；中文笔记和口语追问是整理改写，并非公开原文全文或真实面试转写。Twitter/Pastebin属于公开设计练习，不冒充实际公司的当前生产架构；负载均衡会话保持另可参考NGINX官方`https://nginx.org/en/docs/http/load_balancing.html`，Twitter高扇出取舍的补充一手材料为Raffi Krikorian的公开演讲`https://www.infoq.com/presentations/Twitter-Timeline-Scalability/`。

公开集在首次检索前固定题目、资料、事实及门槛，并打印源码/编译后端和数据指纹；观察后不改生产实现、标签或门槛。`PUBLIC_SUMMARY`按所需事实是否实际注入统计首问、早/晚追问、换题、比较、无关/含糊误注入和已知案例污染，`PUBLIC_CHAIN`检查每个六轮链是否完整。事前工程门槛为独立明确首问覆盖90%、追问80%、无关误注入和已知案例污染各不超过5%，不是行业标准；未知案例误借资料单列，不被“已知案例无污染”掩盖。完整根与事实覆盖同时核对，空结果也必须是正常完成而非超时或故障。资料缺少具体事实时，相关背景既不算已回答，也不自动当作无关误注入；未调用真实生成模型，不验证其会否编造。只用固定公开临时E5及测试数据库，生产和真实资料不变，退出清理，结果只终端/对话；不提交或发布。看过结果后本集成为已知评估集，不能再宣称下一轮独立验证。

在本机平台目录执行 `pnpm typecheck`、`pnpm build:shared`、`pnpm check:architecture`，以及 rag、rag-reliability、rag-accuracy、knowledge-core、knowledge-parsing、knowledge-index-store、personal-info、desktop-ipc、chat、chat-responses、copilot 相关单测。Function 专用 rag-tools 已删除，不能再加入矩阵。`knowledge-host-smoke.mjs` 保留真实 utilityProcess 的错误、15秒期限、取消/退出与迟到结果回归。

`node ../shared/test/scripts/rag-validation-smoke.mjs` 自动在自有临时目录下载校验固定公开 RAG 模型，使用真实 E5/LanceDB 对照旧/新策略和候选池；夹具为100个合成问题加20个留出问题，检查旧成功案例保留、召回/排名、证据精度、误命中与暖态本地准备时间。无真实账户生成，不把该时间视为联网 TTFT；结果仅终端，模型/数据退出清理，不能使用正式缓存。

`node ../shared/test/scripts/rag-colloquial-smoke.mjs` 单独执行120个固定口语场景、19份合成资料的探索评估，覆盖技术词/省略表达、口语追问、中文项目、话题纠正、转写谐音、无答案和无前文的含糊问句。使用生产E5/LanceDB及上下文/证据编排，分别输出目标候选/证据覆盖、追问内容缺失、其他项目混入及空结果情况；相关但缺少具体事实的题单独统计，不把所有相关证据误计为假阳性。退出成功只表示评估完成和结构/隔离断言通过，不表示检索质量达标。Provider只截取实际证据，不调用真实AI或评价其答案。固定公开模型校验后仅在临时根使用，结果到终端，模型/索引/profile退出清理。两个平台共用此入口，Mac执行不代表Windows本机验收。

该入口可设置 `VOXCUE_RAG_AUDIT_ALL_CASES=1` 输出有界逐题覆盖/证据ID，用于内存中的前后对照；设置 `VOXCUE_RAG_AUDIT_ASSERT_QUALITY=1` 则额外要求固定题集的有答案场景均取得所需证据、无其他项目混入、无关/无主题场景不注入资料。未设置质量开关时仍是探索审计。题目与资料不能为通过断言而改写；这组已用于修复的合成题不是独立泛化准确率验证。

`node ../shared/test/scripts/rag-unseen-oral-smoke.mjs` 使用冻结 local-v5 后另写的240场景集合；它已用于本轮改进，现在是已知回归集。20份资料各含两个根问题；包含120个连续口语追问及项目切换、双项目比较、实际转写、间断、AI建议、无关问题和缺失事实。加 `--transfer` 切换到冻结v6后独立编写的160题、16份新资料，技术主题、项目名、事实及问法不导入旧集，包含同文件近名项目和更多连续口语追问。新集合首次观测后不再据其结果调整本轮生产实现，也不能再作为下一轮独立留出集。

两种集合都先冻结源码/编译后端指纹、题目/资料/所需事实标签，再以同一固定公开临时E5、真实LanceDB及生产InterviewContext/RagChatService执行，末尾核对源码、标签及索引版本未变。分别计全部目标根覆盖、全部所需事实覆盖、无其他项目的完整覆盖；无主题/无关问题单计误注入，缺失具体事实不冒充无关负样本。`wrongProjectCases`摘要只统计可回答项目题，陌生项目误借旧资料还须查看`unknown_project`分组，不能将前者为零解释为所有项目问题均无误判。默认输出分组和每组至多两个失败样例，`VOXCUE_RAG_UNSEEN_VERBOSE=1` 可输出全部合成逐题详情，`VOXCUE_RAG_UNSEEN_FEATURES=1` 输出逐题简要特征供内存对照。测试专用`VOXCUE_RAG_TEST_BACKEND`可指向修改前已冻结的编译后端，用同一夹具比较；不能用当前源码重新编译后冒充旧版。

结果仅终端/内存，退出清理全部临时模型、资料和profile。完成不表示所有题命中或生成答案正确，不调用真实账户，Mac结果不替代Windows本机验收。当前目标是满足常规面试辅助，优先项目隔离、无关误注入和连续追问的实用覆盖，不为全部通过增加特例。合成题由同一开发方编写，不是独立人工标注的真实面试样本。

Mac `node test/scripts/sidebar-glass-smoke.mjs --rag-settings-only` 使用真实 AppKit 菜单定向检查移除范围；共享 `settings-smoke.mjs` 检查知识库设置分类/模式入口已删除，其他设置保持；`composer-resize-smoke.mjs` 使用隔离合成窗口检查输入自动折行、连续换行及清空后高度/原生前景同步。GUI/原生必须串行，Windows需本机复验。下文 Function Calling 的旧记录均已由本轮退役方案覆盖。

2026-10-24 最新覆盖：test:chatgpt:single-login 通过断网合成底层运行时/网络端口，保留实际生产登录、聊天和额度装配，核对一次授权、登录后自动读取、刷新不再授权、同会话模型/回答、重启恢复及退出。managed-auth.test.ts 覆盖同会话聊天/图片/文本附件/额度、取消重试、迟到会话及退出警告；codex-usage-runtime 检查公开RPC交接、托管令牌限制、过期/API key/不透明SIWC拒绝。test:chatgpt:usage:runtime 的测试专属 file store 仅包含伪造令牌，断网核对实际固定运行时；生产始终 keyring-only。GUI offline 入口在main导入前替换凭据进程端口，其他UI夹具不会访问真实系统登录项。旧独立用量连接和绑定测试已移除，不再有第二套OAuth入口。Windows需本机同步依赖并验收。结果仅终端/内存，临时目录退出清理，无真实账户/硬件。

2026-10-24 定向增补：chatgpt-quota.test.ts 校验五小时+周、仅周、多桶优先及缺失/无效窗口；codex-usage-runtime.test.ts 校验独立环境、keyring-only、账户 RPC 白名单、登录取消及不安全 URL 拒绝。auth-storage 校验绑定元数据单独加密，不重写聊天凭据。test:chatgpt:usage:runtime 在独立空目录断网启动固定 Codex，仅用测试专属空 file store 避免访问系统凭据，验证 stdio 初始化/空账户；产品保持 keyring-only。test:copilot 增补 ChatGPT 合成连接取消/重试、双窗口、仅周、读取失败和浅深色。Mac sidebar-glass-smoke.mjs --progress-only 串行核对实际 NSProgressIndicator 与0/100像素差、合成麦克风/系统音量及聊天/面试实心停止的取消行为。上述不代表真实订阅或 Windows 原生验收，结果仅终端/内存，临时资料退出清理。

## 2026-10-24 账户额度定向入口

account-quota.test.ts覆盖官方单位、小数、重置、缺失/失败、参考0/0、准入状态隔离及身份/错误边界；account-usage-store.test.ts检查迟到结果与并发刷新；account-usage-ui.test.tsx检查未知不显示0、明确耗尽、加载骨架无虚构数字和ChatGPT官方窗口/连接入口。test:copilot通过断网合成账户验证设置的可用/耗尽/缺失/错误、浅深色与content刷新控件，并核对常规/最小窗口的全宽卡片、标签/数值紧凑同行、无溢出、首次/刷新延迟的骨架扫光与减少动态效果，以及文字超链接的目标/鼠标/键盘激活；Mac content-only和shared chat-response/settings保留官方入口与原账本兼容断言。已移除的UI本地重置不再作为验收对象，本机账本后台单测仍保留。结果仅终端/内存，临时资料退出清理；不读取真实账户余额或凭据。

## 2026-10-24 Copilot 恢复定向入口

`pnpm test:copilot` 用断网合成账户端口验证授权适配器、IPC 和页面的取消重试、服务路由、重启恢复及切回 ChatGPT；`pnpm test:copilot:runtime` 在禁用登录、凭据访问和遥测的 empty 模式启动固定官方原生进程并做 JSON-RPC ping，不创建账户或推理会话。Mac 原生登录由 `node test/scripts/sidebar-glass-smoke.mjs --login-only` 串行验证，两种品牌均为 Glass 胶囊。相关单测为 copilot/auth/auth-storage/desktop-ipc/providers/architecture。临时资料退出清理，不读取真实凭据；Windows 原生打包需本机接续。`--login-preview` 保持隔离登录窗口，关闭或终端 Enter 后清理；仅用户要求保存时指定 `--screenshots=<绝对目录>`。

## 0.5.8 最新界面定向入口

Mac当前仅支持macOS 26+ Liquid Glass，不再构建或测试旧Mac网页回退。`macos/test/scripts/ui-refinement-matrix.mjs`串行运行100/125/150/175/200%五档Electron缩放，每档一组实际Liquid Glass截图流程，共5组，包含捕获中的76×32px胶囊、1/5至5/5、移除/发送归零与失败重试。该入口不读取或下载模型，全部账户/语音/捕获均为合成，退出清理；不能代替物理多显示器DPI。

Mac在`macos/`运行`node test/scripts/sidebar-glass-smoke.mjs --content-only`，包含`handoff-content-check.mjs`的实际原生窗口像素检查；`--handoff-only`可独立复测新增的输入投影40%压暗/恢复、悬停/键盘、未保存/已保存提案及长记录顶部后方渲染/正文不被遮挡。明暗主题和窄窗均使用自有合成背景与窗口，解码像素只保留内存；用户明确要求截图时，可传`--screenshots=<绝对目录>`保存裁切到自有窗口的原生截图，省略参数仍不交付图片。`interview-glass-smoke.mjs`同时比较面试设置开关前后四个空白角落像素，不能用原生属性代替实际外观。`login-controls`的材质拒绝检查使用结构有效的越权modal-exclusion请求。

Mac旧回退预览及其专属源码、构建输出和测试已删除。原生绑定缺失/无效时，主进程拒绝创建Mac展示层；旧偏好不得关闭Liquid Glass。启动器和临时签名包检查最低系统26.0；原生ABI检查NSGlassEffectView为直接链接，固定Qwen运行时仍按原基线认证。

`node ../shared/test/scripts/ui-material-refinement-smoke.mjs`覆盖输入/提案按钮默认透明与真实悬停、主设置/知识库弹窗压暗且无光晕、面试设置背景透明、搜索20px内边距及原生清除、主/浮窗固定原曲线60%、居中字号、只保留深色面试、结束确认胶囊及阴影和记录详情顶部毛玻璃。记录检查包含材质高度、工具栏下正文像素不受覆盖、顶部实际虚化后方转写以及回到顶端清空，不能仅检查滤镜声明。只使用隔离合成账户/资料/音频端口，不保留截图或报告。共享默认矩阵新增此项，当前37组；Mac原生部分仍必须在Mac本机验收。

`frosted-appearance.test.ts`检查旧值和存储失败均不改变固定曲线、不读写原始偏好；`interview-typography`保留字号范围/键盘/保存失败/重载/跨窗口同步，改为验证背景控件已移除且材质固定；`interview-ux`继续覆盖原业务，并验证明暗系统输入下仍为深色、固定材质、面试设置无光晕且透明角落像素在开关设置前后不变，模态打开时仍禁用鼠标穿透。下文关于可调背景或白色面试的旧记录仅为历史。

## Windows 0.5.8 接续与截图入口

Windows的`windows-suite.mjs --dpi`包含`web-materials`、`ui-material-refinement`和`interview-screenshot`，每档12组、共60组，覆盖100/125/150/175/200%。`web-materials`的最小登录窗口容许分数DPI带来的1px原生取整，44px搜索高度按百分之一布局像素读取；胶囊、滤镜、边界及行为断言保持。窗口首次显示由平台生命周期单测及`presentation-native`实际窗口检查覆盖，不通过测试强制显示隐藏窗口。共享功能矩阵和DPI矩阵均在子项开始前停放真实指针，并在结束恢复。

用户明确要求交付截图时，可在`windows/`直接执行`node ../shared/test/scripts/<入口>-smoke.mjs --screenshots=<绝对目录>`。入口包括`web-materials`、`typography`、`ui-ux`、`delete-controls`、`components-ui`、`updates-sidebar`，以及原有`profile-selection`、`chat-progress`、`interview-typography`、`interview-ux`、`interview-retry`、`interview-screenshot`。新增共用截图助手仅在显式参数存在时写入指定目录，防止相对目录或文件名越界；普通矩阵继续零保留。所有界面仅使用隔离合成资料和受控服务端口，真实模型验证使用固定公开临时副本，不读取正式资料或采样硬件。

直接运行离线夹具时，宿主`app.getVersion()`使用当前平台生成配置中的VoxCue版本，避免把Electron宿主版本显示为软件版本；自有更新驱动仍可显式覆盖模拟版本，产品与打包入口不使用此测试替换。

## 0.5.8 跨平台 UI 与 Mac 原生验收

登录亮面原生控件定向入口：在 `macos/` 执行 `node test/scripts/sidebar-glass-smoke.mjs --login-only`，检查实际Glass胶囊、原品牌图标、浅黑/深白文字、悬停及合成登录命中；可追加 `--screenshots=<明确绝对目录>` 交付两种主题的原生截图。登录窗口仅开放固定品牌按钮和只读预览背景的有界展示请求；预览检查一个跟随主题亮度的官网首屏配色底景、三项Clear、五项Regular及上下边缘像素连续性和860×520布局，拒绝其他面试材质。`web-materials` 同时检查回退登录文字/面试预览毛玻璃、44px胶囊搜索、聚焦/输入/清除及两种主题，也支持显式截图目录。

侧栏更新操作定向入口：在 `macos/` 执行 `node test/scripts/sidebar-glass-smoke.mjs --updates-only`，使用合成更新驱动检查实际AppKit中性Push圆形/胶囊、浅深色、鼠标/键盘展开、首秒保护、取消与下载完成，收起侧栏始终36px图标。需要交付截图时追加 `--screenshots=<明确绝对目录>`；用户要求停留演示时追加`--preview`，保持在合成“重启以更新”，关闭窗口或终端Enter后退出清理，不执行真实安装。共用 `updates-sidebar` 核对同样的回退交互及自动下载/保存确认；`content-controls` 追加空白原生搜索框聚焦检查，覆盖系统胶囊、图标/编辑器间距及输入/清除/滚动。

`functional-suite.mjs` 在 Mac 默认先运行当前 Liquid Glass 的五组界面专项：`login-controls`（原生亮面登录、黑白文字及图文居中）、`sidebar-updates`（更新圆形/胶囊和收起侧栏）、`sidebar-glass`（实际输入/工具栏/原生菜单/缩放/失焦）、其内含 `content-controls`（所有内容页、复制、原生搜索、确认/删除/重置、开关/滑杆、设置预览/滚动和开场）、`component-controls`（固定提示条、原生进度/取消、组件状态），以及 `interview-glass`（实际 Clear/Regular、深色可读性、三点/箭头、输入、设置、拖动/缩放/重载及旧关闭偏好无效）。这些使用生产 Mac 构建和实际 AppKit，不禁用材质；原生探针只操作自有合成窗口。

0.5.9 起 Mac 不再构建或运行 Windows 的 shared 网页界面矩阵。Mac 随后运行共用后端/运行时/音频逻辑、明确支持实际 Mac 投影的单次登录/账户/输入换行夹具，以及其他 Mac 原生窗口、权限接口、图标、启动器/编译/迁移/更新/组件/临时包、合成采集、AEC、隔离钥匙串和固定签名入口。Mac 默认必须具备 Liquid Glass 绑定；入口拒绝在 Mac 选择 Windows 专属网页 UI 用例。`qwen-regression.mjs` 另覆盖真实 CPU/Metal 推理与后台切换。

`web-materials` 等网页 UI 用例在 Windows 本机核对 shared 胶囊/圆形、菜单、40px输入轮廓、顶部覆盖、返回按钮、悬停及设置/窄窗。Mac 的外观只由实际 AppKit 专项验收；Mac 共用单测/后端通过不能视为 Windows UI、DPI 或本机集成通过。本文后续旧版本矩阵数量/跨平台运行说明为历史，以本节平台边界为准。

所有模型从固定公开资源下载到自动清理的临时目录，或按明确授权缓存先认证再复制；不触碰真实资料/账户，不采样硬件。结果只在终端/内存，临时资料退出清理。测试源码/固定输入可入 Git，模型、构建/包、结果和私密材料不可入 Git。

## Mac 0.5.6 全量回归与发行入口

用户随后明确授权全量测试、UI复核、Mac发行及源码同步，覆盖下节此前的定向限制。使用 `pnpm test` 运行本平台全部单测，`pnpm build` 与 `pnpm build:updater` 编译完整Mac运行时；`functional-suite.mjs` 默认串行运行35组共享与9组Mac检查。另执行合成捕获、打包AEC、独立临时钥匙串升级、固定签名/打包、应用图标及Qwen专项，最后验证实际发行ZIP/DMG与线上更新。

模型必须通过 `VOXCUE_TEST_COMPONENT_CACHE` 明确指定授权缓存根。`components-smoke.mjs`、`qwen-regression.mjs`、`package-smoke.mjs` 已支持同一只读校验/临时复制流程，结束重新核对正式源，所有测试副本随自有临时根退出清理。复用模式不重复下载模型；组件下载控件/失败/取消继续由共享合成矩阵检查，原有实际下载分支保留供其他授权环境执行，不把本轮复用称为重新下载验收。

Qwen专项串行执行CPU/Metal原生流、实际裁剪、44.1kHz生产Worker/AEC、后台模型/设备切换、临时签名ASAR中的Qwen Worker及模型句柄释放/受管删除。最终包检查继续核对固定凭据助手字节、固定公钥、Ed25519/SHA512、DMG布局和真实离线ASR/RAG；发布后 `package-smoke.mjs --online` 只在隔离实际安装版进程中模拟旧版本并下载验证更新，不替换真实安装。

## Mac 0.5.6 此前定向接续与截图

上一轮用户要求暂不做全量测试（已由上节最新授权覆盖）。当时Mac本机同步生成配置，执行工作区/架构/类型检查及 `build:shared`；定向单测仅选 `desktop-ipc`、`interview-screenshot-store`、`verify-model-cache` 三个文件（44项），界面仅运行以下四个入口，GUI 串行。未运行默认完整矩阵、完整单测、原生语音、钥匙串、权限或正式包回归。

在 `macos/` 中直接运行 `node ../shared/test/scripts/<入口>-smoke.mjs`，入口为 `interview-retry`、`interview-typography`、`interview-screenshot`、`profile-selection`。这些合成界面入口不需要真实模型，不经 `functional-suite.mjs` 提前准备/下载模型。`interview-retry` 另覆盖三段等待停止、空回答、长错误、36px渐隐/末行、阅读暂停、三点/箭头及减少动态效果、最小窗口，以及等待/活动阶段结束、关闭、销毁的六个生命周期场景。

以上四个入口默认不保存图片。仅用户明确要求截图时传 `--screenshots=<聊天可视化目录绝对路径>`，保存应用窗口/控件的合成截图；不是采集用户真实屏幕。重试截图覆盖浅深主题、停止、空/部分正文失败与最小窗口，字号入口交付12/14/18/24px实际浮窗及设置预览，技能入口交付无来源提示的详情、勾选及保存状态。账户、资料、合成捕获和临时profile仍在系统临时根退出清理，截图不纳入Git。

模型复制机制只用8项合成小文件单测确认，不代表本轮已运行正式模型的CPU/Metal识别或验证真实缓存。后续需要时仍须明确指定授权路径、先验证再复制、退出清理；不能自动扫描真实用户目录。

## 0.5.6 回归与模型复用

新增 `interview-retry-smoke.mjs`，覆盖首次请求加三次重试、第四次恢复、耗尽/手动重试、部分正文替换、等待/活动请求停止、迟到输出与下一题；同时检查服务名旁固定字号状态和连续圆角。入口纳入共享功能矩阵（35项）及 Windows 五档DPI（每档9项）。`interview-screenshot-smoke.mjs` 检查警告随对应回答等量滚动、输入位置固定、与回答气泡共用32px连续角及原截图复用。

已有模型经明确授权可通过 `VOXCUE_TEST_COMPONENT_CACHE` 指定正式组件缓存根目录。`model-fixtures.mjs` 只读按固定清单核对标记、全部文件、大小和SHA256，然后复制至自有系统临时目录，并再次校验副本；不对原目录调用组件下载/修复/删除。每次创建独立副本，测试结束清理全部测试内容，保留正式原模型；不保留模型测试缓存。未提供此变量的其他开发环境仍可使用原固定公开下载夹具。`verify-model-cache.test.ts` 覆盖只读成功、损坏、缺失、额外文件、错误标记、链接拒绝、副本独立性和临时目标边界。

Windows 示例（PowerShell，源码根目录）：

```powershell
$env:VOXCUE_TEST_COMPONENT_CACHE = '<用户明确授权的 component-cache 绝对路径>'
pnpm test:windows:functional
pnpm test:windows:regression
pnpm test:ui:dpi
```

`windows/test/scripts/qwen-installed-smoke.mjs` 同样要求显式缓存根和开发机 `VOXCUE_PYTHON`。先只读校验已安装Qwen，再复制至自有临时根，使用固定公开音频串行执行CPU/CUDA、原生/生产Worker、六次后台切换和测试副本句柄释放；结束再次校验正式源哈希，清理副本和CUDA缓存。该入口不执行真实安装/删除，也不接触账户或采样硬件；用户安装不需要Python。组件下载/损坏/取消的既有测试继续在隔离数据上执行。

## Mac 0.5.5 回归入口

`functional-suite.mjs` 默认串行执行共享界面/业务及 Mac 原生矩阵。另在仓库根目录执行 `node macos/test/scripts/qwen-regression.mjs`，传入明确授权的 `VOXCUE_TEST_COMPONENT_CACHE` 时先认证再复制自有临时 Paraformer/Qwen 组件，依次检查 CPU/Metal 原生流式识别、实际裁剪、Worker/AEC、后台模型/设备切换及实际句柄释放与受管删除。`audio-synthetic-smoke.mjs` 使用合成捕获端口，不启动会采集物理设备的旧 audio-native 入口。

`credential-upgrade-smoke.mjs` 使用独立临时钥匙串，检查历史 ad-hoc 授权、固定助手跨版本与旧 v10 密文兼容。登录和 user-data 迁移夹具使用 Chromium 合成 Keychain；隔离 userData 本身并不能隔离系统 Safe Storage，禁止以该理由读取真实登录项。正式包检查使用 `package-smoke.mjs`，签名和更新验证仍使用既有固定身份/公钥，不替换真实安装。

## Windows 0.5.5 回归入口

资料提案专项 `profile-selection-smoke.mjs` 已纳入共享完整矩阵及 Windows 五档 DPI。入口覆盖多长字段紧凑排版、单滚动区详情、连续圆角及胶囊标签、勾选双向动画/键盘/减少动态效果、逐字段和逐技能保存/删除、保留未选已有内容及来源、重载持久化、文字确认不落盘，以及真实流式解析下姓名/技能分别完成后隐藏 loading。总标题不显示 loading，部分提案和停止不能保存。默认不保存图片，仅用户指定 `--screenshots` 时交付合成界面。

版本由共享源生成 Windows 0.5.5；共享矩阵 34 项，原生矩阵 15 项，五档 DPI 每档 8 项。依赖与锁保持现有版本，macos/ 只读；下列安装包、更新、公开模型和隔离安装引擎入口继续用于本版。

`node test/scripts/installer-ui-smoke.mjs profile-selection` 在实际安装器暂存 ASAR 中复用全部逐项资料检查，继续使用隔离账户与临时 userData；与包内 chat-progress、adversarial、updates 三项串行运行。

## Windows 0.5.3 本地接续入口

发行前使用 `windows-suite.mjs`、`--windows` 与 `--dpi` 分别串行检查共享功能、Windows 原生和五档缩放。`interview-typography-smoke.mjs` 另阻断独立 ChatGPT SVG 文件，实际解码登录、预览和面试回答标识并保留浅深色检查；固定标识随 Renderer 内嵌，记录及包级入口同样检查解码。正式安装器用 `installer-artifact-smoke.mjs` 核对 SHA512、blockmap 和实际负载，`portable-native-smoke.mjs --installer-stage` 运行同一 ASAR，`installer-engine-smoke.mjs` 以独立 GUID 验证 0.5.1→当前版本安装/更新/卸载与资料保护，不运行真实身份的安装器。

Windows 配置由共享版本源生成 0.5.3，沿用共享功能矩阵与 `windows/test/scripts/windows-suite.mjs` 的原生/五档 DPI 入口。GUI 语音夹具使用合成平台能力；实际 CUDA 探测由原生入口验证。Windows AEC 的源代码与 ASAR 夹具均经过 Recognizer/RecognitionRouter，不再替换已退到内层 Worker 的旧引擎入口。

`node test/scripts/qwen-component-smoke.mjs` 从当前生产目录真实下载 Windows Qwen 1.0.1 的原 ASR、Q8_0 和 Runtime 1.0.1。入口检查下载取消无半组件、三份归档及全部文件认证、离线复用、实际 CPU/CUDA/Worker、六次后台切换、独占句柄及受管删除，并保留临时合成的旧缓存哨兵；仅使用自有临时根与固定公开音频，退出清理。开发机 Python 通过 `VOXCUE_PYTHON` 指定，不属于用户安装依赖。

Qwen 原生 Python 入口先核对组件所在临时根的所有者标记，将 `CUDA_CACHE_PATH` 固定在该根；Worker 与切换入口同样使用各自 testRoot 的 GPU 缓存。推理结束、失败或取消后随测试根清理，不使用用户默认 GPU 编译缓存。

五档 DPI 默认完整执行；定位单项时可用 `windows-suite.mjs --dpi --scale=2 interview-ux` 只复测指定档位/入口，所有原断言保持。面试设置夹具在失败时仅输出该隔离页面的关闭/取消/指针事件类型与对话框状态，不保存图像或报告。

WASAPI `wasapi-packets-smoke.mjs` 在无硬件的 C# 探针中检查完整混音、分片、QPC 和 LoopbackSilence 的设备时钟前进、冻结、跳变、无效位置及迟到真实包。排空后补静音只使用 [IAudioClock 实际位置及频率](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclock-getposition)，保留 50ms 余量，不能外推墙钟；共享 speech-progress 检查两路停顿均不凭定时器推进。

`node test/scripts/qwen-regression.mjs --source=<固定公开1.0.0 staging内qwen目录> --build=<本次系统临时BuildRoot>` 先认证原包逐文件摘要，在自有临时根链接只读公开输入并复制本次新 CPU/CUDA EXE，通过生产组件认证器下载固定 Q8_0。固定上游 c5ef096 的中英文音频带 SHA256；同一个 aligner-bench 分别以 CPU/CUDA 比较 BF16/Q8_0 的逐词时间戳、安全切点和加载/推理。实际长语音裁剪夹具只压缩低于 -66dBFS、至少 300ms 的静音段至 160ms，非静音采样逐字节保留，原始音频仍用于时间戳对照。后续检查重叠双音源公平裁剪、生产 Worker/AEC、双向模型/设备切换、失败/取消及存在性前置的 Windows 独占句柄。重建入口增加 `-Examples` 与 `-Tests`；开发机可用 `VOXCUE_PYTHON` 指定 Python，用户安装不需要 Python。ASR 仍为原始 BF16，生产组件目录不引用尚未发布的新 Runtime。

`python windows/scripts/package-qwen-runtime.py <干净runtime> <输出目录> --version 1.0.1` 仅准备一个不可覆盖的新 Runtime ZIP 和逐文件固定摘要，不上传、覆盖旧资产或修改生产信任根。测试结果仅终端/内存；所有输入和运行资料在自有系统临时根，退出清理。原生/GUI 串行，不读真实账户/资料、不采样物理音频或屏幕。

`speech-progress.test.ts` 另覆盖 Qwen→Paraformer 的旧队列继承：超过 2 秒的已接受音频不误停，交接期间新增音频与旧队列一起追平，总队列仍不能超过原 30 秒；ACK 确认全部积压降至 2 秒内后恢复 Paraformer 原预算，乱序 ACK 仅扣减真实确认的音频。`qwen-regression.mjs --checks=switch` 可只复测实际六次切换及文件释放，省略该选项时执行完整矩阵。

`build-qwen.ps1 -Cpu -Tests` 分别检查应用引擎与实际引用的对齐库，不编译未随应用分发的上游 CLI。分词器原断言保留，可通过仅测试使用的 `VOXCUE_TEST_QWEN_ALIGNER` 指定自有临时根内、固定摘要认证的公开 vocab/merges/tokenizer_config，避免把模型夹具放入源码目录；未设置时保留原上游路径。

## Mac 0.5.1与Qwen Metal入口

`renderer/stores/components.test.ts`与`components-ui-smoke.mjs`检查删除当前语音模型后切到另一已安装模型/CPU、持久化及页面重载；任一语音模型就绪不误报缺失，Qwen/CPU性能提示及设置入口准确。检查中/删除失败/无替代/旧revision保护和重新下载不抢回选择，音频与回答配置保持。

采集停顿专项覆盖Mac不补造静音、系统/麦克风进度仅由实际包确认；识别器关闭失败时仍等待其他实例释放。`speech-soak.mjs --seconds=300`可通过`VOXCUE_TEST_SPEECH_MODELS`与`VOXCUE_SPEECH_FIXTURE_DIR`使用自有临时模型/固定公开音频，退出前执行关闭握手并等待Worker终止。Qwen删除专项同时确认ASR safetensors及当前Q8_0 GGUF存在且无文件占用，不能以缺失旧BF16路径冒充释放检查。

ForcedAligner Q8_0对照使用`shared/native/qwen-speech/examples/aligner-bench.rs`和`macos/test/scripts/qwen-aligner-compare.py`：固定公开FLEURS中英文各20条、两种语速合成TTS、交替运行同一Rust计算/安全裁剪，比较逐词时间戳及加载/推理。GGUF/Q8_0单测覆盖符号、精度还原、坏比例、截断/计数/形状和名字映射；原BF16仍可对照。两平台当前组件1.0.1使用Q8_0；Windows的1.0.0 BF16/Runtime旧资源保留，原始ASR不量化。数值只到终端，详情见QWEN_MACOS及本节Windows入口。

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

`pnpm test:interview:screenshot` 使用隔离离线Electron宿主、合成账户/语音与合成屏幕图像，覆盖截图不发送、输入框预览、1/5至5/5展开计数、五张限制、移除后补拍、五图手动发送、纯文字/仅图片、失败保留及原图重试、浅深布局。0.5.9源码增加已发送截图的独立文件归档、记录仅存ID、缩略图和原图查看断言；草稿仍只在内存，临时图片/profile退出清理，新增用例待恢复测试后执行。不进行真实屏幕或音频采样。该入口还断言部分回答失败后的错误和重试位于回答气泡内；ui-refinement覆盖个人资料正文/编辑12px与标题14px，typography保留其他控件14px规范。单测interview-screenshot-store/desktop-ipc另覆盖自动回答不消费截图、停止、关闭/重置和迟到结果，以及ID/字段/数量和主进程释放校验。

# VoxCue 测试入口

Windows 0.5.0新增`node test/scripts/echo-cancellation-smoke.mjs`，`--runtime-bundle`检查临时ASAR，`--packaged`构建并清理临时完整便携布局（不生成安装器）；均使用真实Electron Worker、固定本地AEC3 WASM与sherpa重采样，推理替身只收集DSP输出。`wasapi-packets-smoke.mjs`编译生产C#纯转换器，用合成多声道包验证混音/QPC/标志/分片解码，不实例化音频设备；`electron-output-smoke.mjs`验证Windows真实无共享文件锁、部分写入回滚、并发锁和目录身份。它们纳入Windows原生矩阵；五档DPI增加interview-ux，保留原有六组。AEC单测覆盖延迟回声、独立同时人声、0/120ms声学延迟、35ms启动差/持续时钟漂移、参考失效/缺失、四档采样率、尾段/间断及20次重连；capture-drain与speech-restart检查管道末包/prepare/QPC/旧回调。全部结果只在终端，临时资料退出清理；不采样硬件或真实屏幕。

原生矩阵传入临时公开模型路径时，以及AEC `--packaged`入口，另以实际Paraformer/VAD/ONNX验证同一AEC Worker和44.1kHz/QPC失效后的连续输入、flush与退出；不使用推理替身通过该附加检查。

更新：2026-10-17。用户已重新授权完整功能、面试稳定性和对抗性测试及故障修复。Liquid Glass 及其专项仍已撤回，不恢复原 test:all、test:materials、test:readability 等入口。

## Mac Liquid Glass 定向验证（2026-10-22）

最新定向检查还覆盖：投影CSS资源不可用时仍使用父文档已加载样式、文件选择控件保持裁切，浅色主窗口下预览在原生启用/回退时均保持深色且原生背板不被旧填充覆盖；主题/主题色的明暗半圆图标、AI/个人信息左置图标和无原生焦点外框、确认内容完整展开、创建弹窗按钮焦点前后宽度固定、原生关闭悬停反馈、用量重置连续展开帧响应、卡片内重复关闭移除、实际原生设置预览/底景、顶部标题/模态遮罩随路由更新、开始面试弹窗全部原生控件。浮窗顶部默认无背板，悬停才出现；设置菜单与主窗口共用NSMenu，齿轮不带底框，非圆弧表面按共享连续轮廓裁切。测试使用隔离合成账户/设备/响应与自有窗口，不保留截图或临时资料。

范围为本轮侧栏、顶部、输入框、返回最新按钮、菜单和设置遮挡相关改动，0.5.7 起加入默认完整矩阵。先在 `macos/` 执行 `pnpm build:sidebar-glass && pnpm build:shared`，再运行 `node test/scripts/sidebar-glass-smoke.mjs`；仅适用于 Apple Silicon/macOS 26+，交互玻璃与显式菜单图标可见性在 macOS 27+ 检查。

脚本使用离线合成账户、合成聊天回答、自有条纹背景与当前进程窗口。检查实际原生输入命中及共享发送流程、顶部无内容时透明/覆盖内容时 Regular、返回按钮同款材质、原40px连续轮廓、个人信息栏反复开合、侧栏折叠/展开、红绿灯位置、窗口缩放与暂停阅读；原生菜单检查附件、模型、思考、账户、主题与主题色，保留来源图标并核对系统可见性。设置检查原生控件保留、仅模态四周原生 halo、遮挡路径不能反转圆角、关闭后的恢复，以及历史偏好回退与重载。AppKit 菜单可能在系统进程呈现，不将缺少可读菜单窗口几何视为已完成像素定位验收。

管理页附加检查创建/重命名、移除的检索/状态元素、知识库与记录顶部滚动、84px折叠侧栏原生锚点、全宽 NSSearchField 实际输入/筛选和内置清除、个人信息折叠裁切、圆形编辑/重命名/删除与同高二次确认、记录详情玻璃工具栏、更新原生 NSSwitch 的鼠标/键盘与保存状态同步、设置内 content area 控件/菜单图标，以及普通图标按钮与侧栏的36px几何/档位/无着色一致，玻璃上的个人信息按钮为over-glass、知识库/记录正文/设置内容区为content、知识库编辑仅悬停显圆形、字体大小整组居中，以及删除/重置/知识库关闭36px、聊天记录紧凑删除32px、面试预览图标保持32px、胶囊图标/标题整体居中和聊天按钮不套用新增材质。`--content-only` 单独执行管理页/搜索检查；`--content-preview` 只暂停管理页预览，`--preview=<标签>` 只暂停指定预览，其他检查照常执行；使用交互终端。

测试探针仅临时编译，不进入应用；仅向自有窗口投递合成 AppKit 事件，不访问真实账户/资料，不捕获显示器或其他应用，不请求屏幕权限。结果只在终端/内存；`--preview` 在本次临时根输出合成预览并等待回车，结束/失败/取消清理。偏好兼容与端口拒绝等由 liquid-glass-preference、desktop-ipc、frosted-appearance、platform 四份定向单测检查，不以本入口代替完整功能回归。

组件展示专项：在 `macos/` 构建后运行 `node test/scripts/sidebar-glass-smoke.mjs --components-only`。组件服务在隔离进程中替换为合成状态，不下载/校验真实模型。覆盖缺失与CPU性能提示固定悬浮、1280/960px布局、顶部文字覆盖时的原生虚化、胶囊操作与阴影；逐项检查/下载时其他组件图标稳定及真正禁用；16px NSProgressIndicator、百分比、红字悬停取消、取消恢复、同高content确认胶囊及已就绪文字移除。`--content-only` 的更新开关检查另外要求AppKit实际鼠标命中NSSwitch，并同步共享保存状态及空格切换。

面试浮窗原生材质入口：在 `macos/` 构建后运行 `node test/scripts/interview-glass-smoke.mjs`；`--preview` 需交互终端。使用隔离合成语音、回答、失败与自有不透明背景，验证 Clear 面板、Regular 气泡/异常/输入、over-glass 按钮、保留网页前景和输入、转写开合、折叠、缩放、设置、拖动/重载、结束确认、主窗口浅/深主题下的面试固定深色及 Clear 前景对比、偏好关闭/恢复及非法展示调用拒绝，不采样硬件或读取真实资料。

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

第2/4/5组最新补充由 desktop-ipc、profile-store、profile-proposal 检查资料用途、准备聊天不拼接执行面试自定义指令、外部内容边界及技能来源质量规则。rag 单测检查 Local RAG 搜索失败、完整条目部分失败/移除、原15秒预算、挂起端口超时与迟到结果、超时/取消竞争、身份/配置/参数错误不回退及 Provider 只调用一次；Function Calling 已退役，知识核心保护保留。profile-ui 使用离线合成端口检查普通准备聊天与面试失败后继续回答、模型/effort保持，回退答案仍进入后续追问上下文；chat-progress 保留实际 Responses/SSE 的提案确认、来源核验和取消保护，并按第7组确认稿检查补充摘要入口。结果仅终端，临时资料退出清理，GUI 串行。

第5组资料/技能提示词由 profile-store、profile-proposal、personal-info 单测及 profile-ui、chat-progress 桌面入口覆盖。技能按需联网、无固定写作字数，按钮继续直接发起任务；新增 plain-text 单测检查 Markdown/网址/引用的纯文字展示。桌面断言覆盖流式、完成、失败、保存及重载后的链接隐藏、显示内容复制、原文/来源元数据保留，以及普通聊天仍展示来源；确认/拒绝、实际搜索/来源匹配、取消/迟到和存储上限保护保持。截图仅内存、工作文件仅系统临时目录，结果不落盘。

第6组弃用风格清理由 profile-store 覆盖：有效/损坏旧键均不再读取、不进入请求，不影响个人资料与知识库选择加载，原键和已确认自定义指令保留。第7组由 profile-ui 检查确认稿的四个真实快捷入口、完整请求、草稿/附件保留、直接发送与等待手动发送/确认的时序；profile-store 检查三种缺失摘要的新完整模板正常发送、附件保留及确认前不落盘，并保留旧提示兼容。renderer/services/preparation 检查“不生成技能”等明确否定不触发研究，独立肯定请求仍生效。第8组 history-title 单测检查新提示词传递、短标题与原输出上限、队列及取消信号/迟到保护；history-branding 使用 offline-electron-entry、合成账户/组件/语音端口及响应，检查结束面试后的标题请求、关闭后完成和失败重试，同时保留记录浏览/导出断言。代码长度上限保持，提示词另要求通常10–20字、最多30字，简单主题可更短；专项只验证协议与合成生命周期，不代表真实标题质量。

本轮共用界面专项 `node ../shared/test/scripts/ui-refinement-smoke.mjs` 使用离线临时宿主，检查登录/主窗口100%缩放、五类资料默认折叠、展开/收起中间动画帧与减少动态效果、弹窗编辑、按钮文字完整、分隔栏拖动/双击复位、完整上传区在导入前后不变、索引百分比/完成状态和思考耗时字号。`typography-smoke.mjs` 与 `ui-alignment-smoke.mjs` 保留全部界面的浅深主题、最小窗口、控件/图标/长标题/溢出检查；个人信息编辑断言改为弹窗与背景操作禁用。profile-ui、components-ui、composer 和 interview-typography 保留资料确认/保存/冲突、下载/删除确认、附件与字号同步保护；它们的宿主同样在应用导入前阻断网络。GUI 串行运行，截图只在内存，全部临时资料退出清理，不用真实账户或硬件。

ui-refinement 还检查五类分区快速切换反转、编辑 Escape/焦点返回/保存失败保留草稿与重试、分隔栏方向键/Home/上下限/取消及失焦/窄窗口、长弹窗内部滚动及圆角轨道内缩。加 `--preview-dialog` 仅向终端输出内存图片，供工具直接显示，不写图片文件。Windows `node test/scripts/windows-suite.mjs --dpi` 包含 ui-refinement，可在其后指定专项名。settings、knowledge、chat-response、delete-controls、ui-ux、updates-sidebar 的桌面宿主同样在应用导入前阻断网络，资料折叠与编辑弹窗断言沿用当前实现。

`typography-smoke.mjs` 通过 `continuous-corners.mjs` 检查每个实际页面的可见圆角、菜单及选中伪元素，并核对文本输入的I形及其他区域的默认箭头光标；已展开菜单核对与其aria-labelledby关联触发框的四角半径和曲线一致；授权返回页覆盖四种状态、宽窄布局和浅深色。切换圆弧基线时核对半径、尺寸及阴影数值不变，圆形和胶囊Switch分别保留各自轮廓。内存像素比较覆盖多档半径的连续角/圆弧差异、子内容裁切、外阴影及圆形控件；使用同图色块作颜色基准以兼容显示色彩配置。该检查核对四次超椭圆G3目标样式的原生渲染，不宣称Chromium的贝塞尔近似路径严格满足G3。可用既有VOXCUE_TEST_SCALE_FACTOR=1/1.25/1.5/1.75/2逐进程串行复核，不改系统缩放；图片只在内存、结果不落盘。`ui-ux-smoke.mjs --preview-latest`仅在终端展示输入区渐隐、圆形箭头和输出三点的内存图片。

ui-alignment 的聊天工具栏矩阵覆盖主窗口与个人信息的多组宽度、浅深色、长模型名、最多两行的控件排布，以及模型/思考同组、语音/发送对齐、32px尺寸和菜单操作；网络搜索仅在“＋”菜单勾选，外侧无独立按钮，重新打开菜单保留状态。加 `--preview-composer` 只输出内存图片。Windows 可用 `node test/scripts/windows-suite.mjs --dpi ui-alignment` 串行检查五档缩放，不改系统设置。

共用菜单封装`src/components/ui/dropdown-menu.tsx`协调同一renderer内只打开一个根菜单，替换关闭不恢复旧焦点，普通关闭和卸载保持清理。菜单选中仅尾部勾选，悬停/键盘当前项独立高亮。ui-ux沿用真实聊天列核对渐隐的左右覆盖及与输入区无缝连接，不拦截点击。

同类表面复核将附件菜单纳入实际页面矩阵，检查所有弹层的共用阴影、展开触发框在指针移开后仍保留反馈、已选项无常驻底色；同时核对主/面试输入框、浮窗、回答卡片和返回按钮的抬升阴影，以及状态标签的圆弧胶囊和紧凑操作的共用控件半径。保留弹层/触发框角形一致性、图标居中、工具行及表单几何检查。

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
