# macOS 1.3.5 → 1.3.6 更新交接

## 范围与接续方式

本清单用于把 Windows 本轮完成的全部产品改动同步到 macOS 1.3.6，包括接入、资料更新恢复、动画、布局、密钥输入修复，以及全量测试中确认的修复。**本次没有只需 Windows 用户获得的功能；原生实现不同的部分也须在 Mac 完成等效行为。** Windows 验证不能代替 Mac 本机、AppKit、签名安装包或真实服务商验证。

接续先读仓库 `AGENTS.md`、`PROGRESS.md`、本清单与 [双方联合交接](MOTION_KIMI_GEMINI_HANDOFF.md)，再核对当前 `git status`、`git diff` 和发行提交。联合交接保留双方的实现理由及历史语境；本清单不把其中历史测试记录作为本轮验收成绩，也不延续旧授权。最终待办以当前任务授权及 `PROGRESS.md` 为准。

完整源码移植范围为 `v1.3.5..v1.3.6`，本轮正式源码标签为 `v1.3.6`；版本唯一来源为 `shared/package.json` 的 `1.3.6`。`ecfe553` 是进入本轮前的 `main` 基线。移植按该完整范围逐项核对产品、测试及文档，不按作者或文件名整份覆盖另一层修改，也不依赖另填未来提交哈希。

特别注意：`v1.3.5` 标签对应此前 Mac 发行基线；其后的 Windows 1.3.5 提交还包含共享修复。因此 Mac 更新不能仅移植 `ecfe553` 之后的差异，还必须补齐下文 B01–B07 的 `v1.3.5..ecfe553` 共享补丁。

Windows 上 `macos/` 全树只读。本轮不会代写 Mac 配置、依赖锁、原生产物或签名材料；下面标为 Mac 本机处理的项目由 Mac 接续者实施，并持续更新 `PROGRESS.md` 的摘要和待办。详细实现留在本清单，不把测试成绩、截图或运行产物写入仓库。

## 对外更新说明

用户确认的中文五项如下；技术条目只作逐项展开，不擅自增加对外功能承诺：

- 新增 Kimi 和 Gemini API 支持，可用于面试准备和面试回答。
- 优化界面动画。
- 优化聊天与面试布局。
- 改进资料更新提案的生成与异常恢复，提高生成可靠性。
- 修复添加或更换 API 密钥时输入框闪烁的问题。

中英文发行文案见 [1.3.6_UPDATE.md](1.3.6_UPDATE.md)。保持两种语言含义一致，不能把准备聊天的搜索能力扩展描述成面试联网。

## 一、补齐 Mac 1.3.5 标签后的共享基线

这些改动来自 Windows 1.3.5 后续提交，属于 `v1.3.5..v1.3.6` 的完整移植范围；Mac 逐条确认源码是否已经包含，避免遗漏或重复实现。

| 编号 | 必须同步的行为与来源 | Mac 本机核对入口 |
|---|---|---|
| B01 | `shared/electron/backend/knowledge/host.ts` 追踪尚在发布的 `indexWrites`。取消首次建索引后，即使磁盘尚无 catalog 条目，失效／删除操作仍路由到该文档所属 worker，避免迟到写入留下索引。 | `knowledge-host.test.ts`；新合成文档首次索引期间取消、替换、删除，再重启检查资料／索引一致性。 |
| B02 | `libraryLayout.ts` 恢复中断的首次 `owner.json` 原子写入：只接纳严格 UUID 名称的 owner 临时文件，先完整验证目录和文件归属、硬链接数，再清理未完成写入。异常内容保留并明确拒绝，不放宽目录归属校验。 | `knowledge-core.test.ts`；中断恢复与未知文件、链接、错归属负例分开验证。 |
| B03 | `KnowledgePage.tsx` 捕获用户确认时的文档／知识库 revision，`stores/knowledge.ts` 接收并比对该 revision；确认期间内容变化时要求重新确认，不能改为执行时读取新 revision。 | `renderer/stores/knowledge.test.ts`、删除确认界面；确认后并发替换、切库、重载均不得误删。 |
| B04 | `contracts/uiMessages.ts` 补齐知识进程尚未退出、目录／索引归属异常保留资料、取消后重启的英文文案。 | `ui-language.test.ts`；用合成故障在英文界面检查可见提示，不把内部原文透出。 |
| B05 | `HistoryPage.tsx` 区分 `1 answer` 与 `{0} answers`，中文数量和计时保持既有格式。 | `ui-language.test.ts`、记录界面 0／1／多回答。 |
| B06 | `components/icons.tsx` 的 `personalInfoIconSize` 统一为 16px，个人信息按钮和相关入口沿用同一来源。 | `settings-location-smoke.mjs`、`ui-alignment-smoke.mjs`；浅深色、主窗口最小尺寸和 Retina 缩放。 |
| B07 | 同步上述共享测试与架构断言；`check-architecture.mjs` 的 sourceGraph 复用 TypeScript module-resolution cache，不改变依赖边界。Windows `interview-access-smoke.mjs` 将旧三柱 scale 取样更新为当前五根圆帽波形的宽／高／圆角、错相 delay、`input-wave-pulse` 与减少动态效果断言；`update-signing-smoke.mjs` 的 owner 临时编译夹具补齐 `backend/downloads.js`、`contracts/versions.js` 等实际依赖并保持原路径，不能缺依赖或放宽签名断言。Windows Sandbox、签名和发布实现不直接复制到 Mac。 | `git diff v1.3.5..ecfe553` 逐项对照；知识库、英文、图标、波形及签名完整性由 Mac 共用／平台等效入口和本机包验收覆盖。保留 Mac 现有凭据／签名身份，只用本机临时合成材料检验，不运行 Windows 夹具或初始化真实密钥。 |

## 二、Kimi、Gemini 与资料更新恢复

### A01–A07：连接与 Kimi

1. **A01，服务身份和顺序。** `contracts/apiConnections.ts` 加入 `kimi`、`gemini` 正式服务定义，顺序固定为 **OpenAI、Gemini、DeepSeek、Kimi**，清除相应旧停用身份判断。同步 `ipc/apiConnections.ts`、后台 API 装配、`ProviderIcon.tsx` 及 `src/assets/ai/{kimi,gemini}.svg`。Mac 使用同一契约和图标，不另建一份服务列表。
2. **A02，完整设置流程。** `ApiConnectionPanel.tsx` 沿用验证并保存、启用／禁用、更换、移除的既有流程；当前使用中的服务动作必须是“禁用”。模型目录刷新、失效、切换、重启、独立账户用量均保持请求归属。验证 `api-connections.test.ts`、`api-connection-ui.test.tsx`、`account-profile.test.ts` 及 API 设置界面。
3. **A03，凭据隔离。** Kimi/Gemini 接入系统原生密钥框及主进程凭据管理，Renderer 只得到状态与受控接口。不得增加 DOM 密码输入、localStorage／日志／VITE 密钥、明文回退或正式凭据助手测试捷径。同步 `api-credentials.test.ts`、`auth-storage.test.ts`、`desktop-ipc.test.ts`，并在 Mac 临时合成凭据环境验证。
4. **A04，Kimi 协议。** 新 `backend/api/kimi.ts` 使用 Moonshot 中国官方 `https://api.moonshot.cn/v1`，聊天走 Responses；目录只接纳适配器明确支持的 Kimi 模型，不能把目录里的 Chat Completions 模型全部当作 Responses 模型。已知模型的图片能力、`low/high/max` 思考和默认 `max` 沿用当前实现；附件不直接启用文件输入，非支持文档先转纯文本。
5. **A05，API 余额。** Kimi 官方余额接口读取 CNY 可用余额、代金及现金字段并严格校验格式。`services/accountUsageSummary.ts` 的共用 `formatApiBalance` 使用界面 locale、最少／最多两位小数和无千分位；`ApiConnectionPanel.tsx` 设置页与 `AccountUsageSummary.tsx` 面试用量共用该格式，亦覆盖既有 DeepSeek 余额，不能只修 Kimi 或一个位置。本机请求／输入 token／输出 token 仍按各自语义显示；Gemini 通过官方账单查看，不伪造余额或不存在的统计。
6. **A06，Kimi 错误。** `backend/api/service.ts` 识别 HTTP 状态与 HTTP 200 流内 `error` 两类失败，读取 `error.code`，区分余额、过载、RPM、TPM、TPD、并发限制。用户提示只带受控类型及必要数字，不转发含账户标识的服务商原文。覆盖不同分片、错误后停止、取消、模型目录失效与用量归属。
7. **A07，Kimi 资料恢复。** 严格 `json_schema` 解码和共用资料 schema 必须保留，不能退回仅提示词约束。`apiKeyEndpoint.profileRecovery: 'preview'` 让格式失败可见地重新生成；不能恢复 25 秒的私有缓冲重试窗口。长思考、字段顺序变化、缩进 JSON、字符串跨 chunk、停止和迟到回写分别验证 `api-chat.test.ts`、`profile-store.test.ts` 与资料提案界面。

### A08–A16：Gemini 原生适配

1. **A08，原生接口。** 新 `backend/api/gemini.ts` 访问 `https://generativelanguage.googleapis.com/v1beta`，使用 `x-goog-api-key`、官方 `models` 目录、原生 `contents`／`parts` 和 `streamGenerateContent`。不要为适配 OpenAI 夹具把 wire 格式改为 `data`／Responses。
2. **A09，能力边界。** 只接纳支持 `generateContent` 的 Gemini 文本生成模型，排除图像专用、audio、TTS、live、embedding、robotics、computer-use 等专用模型。图片／PDF、搜索、思考级别由当前已知模型表和明确规则决定；未知型号可按目录提供的基本能力使用，但不得仅按新版本号推断支持搜索、图片或任意思考级别。2.5 使用 budget 映射，已知新模型使用 level；保留默认值及输入校验。
3. **A10，流与用量。** 正确处理 Google SSE 的 CRLF 事件分隔、JSON 跨分片、思考／正文／grounding、完成原因、空内容和中途失败。用量包含适配器当前计算的思考输出 token，拒绝负数、非安全整数及异常格式；不得把一次重试计作多个本机完成请求。验证 `gemini-api.test.ts` 与账户用量集成。
4. **A11，短重试。** 模型目录和生成请求仅在未收到内容且 HTTP 失败时重发：503 按 1 秒、3 秒等待；429 仅有 `google.rpc.RetryInfo` 且等待不超过 15 秒时重发，实际等待取该次基准与 RetryInfo 的较大值。两类共用最多两次重发上限。400、长／无 RetryInfo 的 429、已收到内容后的失败不能被该机制重复发送；等待必须响应取消。
5. **A12，重试活动。** 自动重试使用 `gemini-retry` 活动，进行中为 `processing`，完成更新为“已自动重试”。保留活动合并和资料恢复的既有语义；不能为测试而改成被恢复层覆盖的 `waiting`。英文翻译与中文同步。
6. **A13，搜索额度降级。** 带官方搜索的生成请求在任何内容之前遇到 429，可切为不带搜索的请求一次，并加入 `noWebSearchInstructions`。这与 A11 的短等待重试是两层机制，分别验证计数；第二次仍失败则明确报模型／服务限额。返回的 `searched` 必须对应实际 grounding，不能因曾发过搜索工具就标为已联网。
7. **A14，底部提示过滤。** 后端继续返回完整 warning“Google 搜索额度已用完，本次未联网回答。”并保留降级活动。`stores/preparation.ts` 只按行过滤这一条底部展示文案；组合中的知识库警告、其他模型提示仍显示。后端断言 warning 和前端断言隐藏并不矛盾，不能删除全部 warning 来通过测试。
8. **A15，资料结构化输出。** Gemini 3 及以上资料请求使用 `generationConfig.responseMimeType: 'application/json'` 与共用 `profileFormat.format.schema` 的 `responseJsonSchema`，不重复追加提示词 schema。Gemini 2.x 保持当前提示词策略。面试请求不加资料 schema。严格解析、缩进、跨 chunk 字符串、格式修复、提案完整性、确认／拒绝／替换与取消沿用共用生命周期。
9. **A16，真实兼容性待验。** Gemini 3.x “原生 schema ＋ Google 搜索”组合需要 Mac 在可用的隔离服务环境另验；历史记录不能证明该组合已验证。当前没有 schema＋搜索遇 400 自动去 schema 重试；不能因旧夹具不识别原生格式而撤回 schema 或临时加入另一产品路径。若发现真实不兼容，先按具体失败最小修复并补测试，再补本清单。

### A17–A20：统一搜索和资料约束

1. **A17，官方搜索路由。** 准备聊天只使用当前选择的服务商及模型自己支持的官方搜索，不跨服务商兜底。Kimi/Moonshot、Gemini/Google 与既有 OpenAI/DeepSeek 分支分别验证。模型不支持时保持明确的非搜索行为。
2. **A18，面试绝不搜索。** 面试 IPC 保持 `webSearch: false`；Gemini 面试请求没有 `google_search`，Kimi 也不发送其网页工具。面试可使用 Kimi/Gemini 回答，但不因此获得面试联网。共享测试与 Mac 实际面试调用分别检查。
3. **A19，公开查询边界。** `backend/chat/input.ts` 的 `publicWebSearchInstructions` 供相应适配器共用：搜索只用于公开资料，不能把个人资料、私密附件、RAG 内容转成搜索查询。无搜索请求使用相应约束；资料提案只信任实际可核对的来源，不以模型自称搜索代替 grounding。
4. **A20，既有服务回归。** `ChatGPTService` 的受控 endpoint 配置为 Kimi 提供 base／models／搜索指令／profileRecovery 扩展，但必须保持既有 OpenAI、DeepSeek、ChatGPT、Copilot 路径的授权、取消、资料、模型缓存与错误语义。同步 `api-chat.test.ts`、`account-profile.test.ts`、`api-connections.test.ts` 及共用集成，不能整文件回退共享服务。

## 三、界面与视觉同步（单独核对）

### U01–U09：搜索建议、来源与聊天／面试布局

1. **U01，内容顺序。** `PreparationMessage.tsx` 与 `ChatSources.tsx` 将 Google 搜索建议放在“用时”分割线下、普通来源及回答正文上。Google 建议始终展示；普通来源超过三条的原有折叠仍保留。没有真实 grounding 不显示伪造 Google 已搜索状态；实际有搜索而必须展示的建议缺失时按后台规则丢弃不完整输出。
2. **U02，官方内容与隔离。** `GoogleSearchSuggestions.tsx` 保留服务返回的 HTML／链接，在 `srcDoc` iframe 中渲染；sandbox 仅 `allow-same-origin`，没有脚本、弹窗或顶层导航权限。内部 CSP 限定 `default-src 'none'`、内联样式、`data:`／精确 `https://www.gstatic.com` 图片，禁止 base／form，referrer 为 none。点击和中键走 `openChatLink` 受控 URL 校验；打开失败显示已有错误。
3. **U03，主页面安全边界。** `shared/index.html` 只增加 Google 必需的精确图片 origin，保留 favicon 来源校验、无 referrer 和 `connect-src 'self'`。`electron/window.ts` 拒绝非 `about:srcdoc` 的 frame 导航。不能为建议链接放开任意远程图片、Renderer 网络或 frame 导航。
4. **U04，透明与间距。** Google 外层底板、阴影和装饰渐变隐藏，页面透明，不能在深色出现整条白底。上下外部间距为 8px；与普通来源之间为 6px。iframe 声明 `color-scheme: light dark` 并继承应用实际主题，动态高度取实际 body 边界与 `scrollHeight`，防止高 DPI 多出竖向滚动条。
5. **U05，logo 光学对齐。** 保留 Google 提供的浅深两套 SVG、彩色路径和深色白圆。共同 headline 槽固定 28×28px、图形在槽内居中；外部仅加 `align-self:flex-start;margin-top:2px`，按名义 32px 首 chip 与 28px 槽的一半高度差定位，使多行时 logo 保持第一行位置，不随整块多行内容居中。深色图形 28px 并向下补偿 0.64px，浅色图形沿用其原尺寸，两种主题的横向光学对齐保持。`api-interactive-preview.mjs` 的 `checkGoogleSearch` 对浅深色、单行／两行分别取四条官方彩色 path 的 `getBBox` 并经 `getScreenCTM` 转换，排除深色白圆及 SVG 外框。先严格验证 line-height 20px、上下 padding 各 5px，并独立按当前 DPR 对原 1 CSS px 边框的整物理像素量化推导实际 chip 高度及两行／间距；不能把实际高度硬编码为 32／68px。槽位／首行关系保留 1/64 CSS px；彩色 G 实测中心差显式扣除 `(32−量化后chip高度)/2` 后，保留非对称 viewBox 余量的 1/8 CSS px 光学残差限制，跨主题及单／两行横向中心均验证。分数 DPR 下实际中心差不宣称绝对为零；这是 CSS／SVG 几何验证，不代称逐像素光栅化验收，详见 T14。
6. **U06，官方排版与两行预览。** 正式组件保留 Google 返回的 carousel 排版，当前没有生产自动换行改造。此前两行截图是明确隔离的合成排版原型；不能把预览搜索词、回答、强制换行 CSS 或测试入口带进正式包。若未来实际返回多行，按原 HTML 检查高度、第二行起点、完整可见和链接。
7. **U07，跨主题测量方式。** 永久 API 界面夹具已按 T13 从旧 `.suggestions` 简化片段迁移到实际消费的 `shared/test/fixtures/google-search-suggestions.html` 官方完整结构，使用 `.container/.headline/.carousel/.chip` 和两套原始 SVG；不再恢复 `Synthetic search suggestion` 旧展示。Mac 使用该唯一来源，在相同窗口、缩放和排版模式下比较浅深主题；清除 Playwright `colorScheme` 模拟后用应用菜单切换，检查子 iframe 的实际颜色、透明底板、无阴影、branding 和布局稳定，并按 U05 单独核对光学中心。分别测单行与两行样例，不混为一个基线。官方样例所属 API 已弃用，本轮仅复用其公开 `renderedContent` 结构，不恢复旧 API。
8. **U08，气泡尺寸。** `styles.css` 准备聊天用户气泡、面试转写／提问／回答统一上下 8px、左右 12px。图片提问、字号预览、登录面试预览继承该值，移除原来覆盖 padding 的特例；保留字体、圆角、图片布局、动画和工具区。实际气泡边界与文本可见区都检查，不能只测一个选择器字符串。
9. **U09，面试主题。** 实际面试及两种面试预览沿用 `interviewAppearance.ts` 的固定深色；准备聊天支持浅深色。不要为了生成浅色面试截图改 `interviewAlwaysDark`。Mac 仍保持现有 AppKit 材质与辅助功能降级，比较内容几何时控制相同字号与透明度。

### U10–U20：动画过程与稳定几何

1. **U10，共享参数。** 保留 240ms 主时长及 `cubic-bezier(0.2,0,0,1)`；加入 180ms 退出时长、`cubic-bezier(0.22,1,0.36,1)` 强调曲线、旧内容 0.4 时长淡出、新内容延迟 0.15 时长淡入。录音播放器仍为 340ms，只统一曲线；颜色／悬停的短反馈不做无关统一。
2. **U11，参数消费者。** 设置开关、disclosure 箭头、个人资料折叠、悬浮截图按钮／计数、悬浮收起箭头和 `ActionTransition.tsx` 复用共享参数，不恢复原硬编码时长。保留 `prefers-reduced-motion`、透明度辅助功能、焦点和键盘反馈，不增加 hover 文案。
3. **U12，页面交叉淡变。** `page-motion.css` 位移继续由 `screen-enter/screen-exit` 负责，另一个动画只控制透明度；旧页面先淡出、新页面延后淡入，避免文字重影。保留原名称，相关生命周期与发出消息动画仍依赖它们。
4. **U13，按钮标签交叉淡变。** 删除确认、下载、侧栏更新等按钮按进入／离开的目标状态分别设置 duration／delay longhand，位移保持全程。不能用新 transition shorthand 覆盖减少动态效果时的 `transition: none`。
5. **U14，折叠不裁文字。** `content-reveal.css` 与聊天组件提示在收起时先完成短透明度退出，再随高度收拢；展开仍沿用原策略。保持账户配额 skeleton 的无过渡规则，避免过度覆盖所有折叠组件。
6. **U15，窄窗口首帧。** ≤1150px 打开个人信息时，聊天列／输入列宽度连续过渡。旧简历条及其窄屏提示动画已按用户本轮要求退役，见 T12，不再恢复该 chip 或其 hint 动画期望。`client-update-ui-smoke.mjs` 继续逐帧测输入区不能先变宽再收窄，稳定后的静态对齐另测。
7. **U16，侧面板边框。** 个人信息与记录回答侧栏的 border-width 随收起过渡，不首帧丢 1px 边框；退出透明度使用 180ms 及主曲线。不要清理／回退同一 `styles.css` 中另一方的 Google 或气泡修复。
8. **U17，弹窗位移。** `modal-motion.css` 入场为透明度与 translateY 8→0px，遮罩仅淡入；退出为 0→4px、180ms，`modal-motion.ts` 移除计时器读取同一退出参数。保留 `modal-fade-in` 名称，不改成会改变测量尺寸的 scale，确保高度动画、集合 resize、裁切和原生框定位一致。
9. **U18，打断续播算法。** 新纯工具 `motion-continuation.ts` 在取消旧 WAAPI 动画前读取当前位置速度；同方向携速并限制贝塞尔 y1≤1，反向只缩短时长。时长按剩余行程缩短，下限 `min(D,120ms)`，不把原短动画拉长；延迟期／已结束不携速。极端速度受限幅，测试不能要求无条件数值精确连续。
10. **U19，续播接入。** `useHeightTransition`、`useNoticeStackMotion`、`ActionTransition` 和 `AnimatedCollection` 普通位移分别维护 travel／from／start，取消清理状态。纯工具不得反向依赖组件或其他模块，保留架构白名单及 `motion-continuation.test.ts`、`interview-height-transition.test.ts`。
11. **U20，保留的既有设计。** `.response-steps > li` 仅设置直接步骤行，避免嵌套 Markdown 列表每行一字。思考标题流光保持 linear，完整周期及停顿沿用既有值；转圈加载保持 linear。没有采用 `content-visibility:auto`，长对话布局性能优化仍为待决定项，不在 Mac 擅自恢复被撤回方案。

## 四、原生 API 密钥输入修复：Mac 必须等效处理

1. **N01，共享时序。** `ApiKeyDialog.tsx` 等待全部名为 `modal-fade-in` 的 CSSAnimation 完成后再创建／定位原生输入框，包含 entered／disposed 守卫；ResizeObserver 仅在入场后调度布局。关闭、切换或取消先结束生命周期，旧测量／旧请求不得让原生框复现。
2. **N02，Windows 行为说明。** Windows `ApiKeyPrompt.cs` 先以 opacity 0 创建，完成位置、显示、当前主题同步绘制后再设为可见，防止白／黑错误首帧。它是本次“密钥输入框不闪烁”的一个平台实现，不是可以从 Mac 更新中省略的 Windows 专属功能。
3. **N03，Mac 对应实现位置。** Mac 使用 `macos/electron/apiKeyPrompt.ts` + `macos/native/SecureInput.mm`：begin 安装初始隐藏的 NSSecureTextField；layout 先完成坐标、字体、Aqua／DarkAqua 与 `layoutSubtreeIfNeeded`，再更新隐藏状态并同步 `displayIfNeeded`。mask/reveal 的新控件也先隐藏挂载，完成主题、frame、font 和布局后再恢复原可见状态，保留内容和选区；不改成 Renderer 明文框，不改变现有取消及内容清理路径。
4. **N04，原生验证颗粒度。** `macos/test/scripts/api-key-field-smoke.mjs` 保留遮蔽／显示、focus、Tab、Enter、取消和 Renderer 不含密钥的合成检查。新增 `api-key-dialog-smoke.mjs` 运行真实 `ApiKeyDialog`、生产 IPC 校验和 AppKit 编辑器，检查入场动画期间不暴露、浅深主题首次显示几何、眼睛切换及内容保留、弹窗内主题切换、应用缩放、反复更换／添加／快速取消；可用现有 `VOXCUE_TEST_SCALE_FACTOR` 执行五档桌面缩放。该显式临时输入夹具仅绑定真实 SecureInput 端口，账户／凭据存储／HTTP 复用既有离线合成夹具，普通 UI 的原生端口与正式凭据助手禁用围栏不变。AppKit probe 只返回状态、几何、主题、字体、backing scale 和长度，不返回密钥或保存像素。状态／几何断言不代称像素首帧验收；移动缩放、Retina 实际绘制与最终包仍须对应本机／guest 验证，桥接单测不能代替真实弹窗视觉检查。
5. **N05，安全与身份。** 原生测试只输入 owner 临时合成密钥，不读取真实 Keychain／账号。保持 4096 字符限制、禁用拼写／替换／自动补全、清理旧字段内容、取消后销毁；Mac 的既有凭据 helper、升级读取、签名身份及受保护恢复原件不变，不重新生成证书或更换 Keychain identity。

N04 与 T16 的实际原生衔接由 `api-key-dialog-smoke.mjs` 末尾覆盖：打开真实 AppKit 字段，确认 native-close／三类 IPC 生命周期监听相对基线各增加一条后，对同一 owner 执行真实 Renderer crash；在原 5 秒期限内核对字段消失、监听回到基线且 BrowserWindow／WebContents／native handle 均保持。probe 的可选 owner handle 先与本进程 `NSApp.windows` 内现存 NSView 身份匹配再查字段，不直接解引用传入地址，不依赖 keyWindow 或失焦来判定字段已清除。该末尾场景正常关闭原应用，不新增窗口或 fresh Page 恢复框架；reload／重试仍由共享 T16 入口分别覆盖。

## 五、搜索数据生命周期、契约与安全

| 编号 | 需同步且不得弱化的边界 | 主要入口 |
|---|---|---|
| S01 | Chat 契约承载 Google HTML，最大 100000 字符；IPC 校验字段、长度、来源及请求归属。流式部分、replace／discard、停止、切服务后的迟到事件正确清空／拒绝，不串到新消息。 | `contracts/chat.ts`、`ipc/chat.ts`、`desktop-ipc.test.ts`、`api-chat.test.ts`。 |
| S02 | 搜索建议与来源元数据仅在内存；Google 联网正文沿用最多 730 天的历史保留策略，只供历史查看，不拼进后续模型上下文。不能通过把 HTML 落盘解决重载展示。 | `services/chats.ts`、`services/preparation.ts`、`stores/preparation.ts`、`chat-storage.test.ts`、`profile-store.test.ts`。 |
| S03 | 用户可见错误使用受控消息，不透传服务商账户、密钥、原始响应或敏感 URL。429 降级、503 重试、invalid key、403、404、400、SSE 中途错误分层处理。 | `api/service.ts`、`api/gemini.ts`、`uiMessages.ts`、API 单测及语言检查。 |
| S04 | Google HTML 的脚本、内联事件、危险链接、表单、iframe／顶层导航、网络、超长内容与损坏片段使用隔离负例验证；正式包不包含 Mock／测试入口，也不在真实失败后切成合成服务。 | `google-search-suggestions.test.tsx`、`source-favicon.test.tsx`、架构检查、API 界面专项、最终包安全检查。 |
| S05 | 保持 contextIsolation、sandbox、nodeIntegration 边界，preload 运行时只依赖 Electron；公开契约变动同步 Renderer／main／preload／检查，后台不反向依赖 UI。 | `check:architecture`、`architecture.test.ts`、`platform.test.ts`、Mac 最终包安全专项。 |

## 六、测试中修复与夹具同步清单

本节记录需要同步的**源码／夹具改变及对应验收入口**，不记录测试成绩。最终发行前将本轮新发现的修复逐条补入，不能用“Windows 全部通过”替代具体内容。

| 编号 | 修复或核对事项 | Mac 接续要求 |
|---|---|---|
| T01 | 本轮已修复 `account-profile.test.ts` 首次模型目录裁剪：按 provider wire 格式处理，Gemini 裁剪原生 `models`，其他相应目录裁剪 `data`。旧的通用 `page.data.slice(...)` 会制造 TypeError 后被包装成 network_error。 | 同步夹具修复，保留缓存／强刷／账户归属断言，不把产品协议改成夹具格式。Gemini 2.5 集成不能替代 3.x 原生 schema 测试。 |
| T02 | 本轮已修复 `api-interactive-preview.cjs`：同时识别 `generationConfig.responseMimeType` 与 `responseJsonSchema` 的原生组合，仍支持 Gemini 2.x 提示词 schema；新增两种格式的资料提案集成用例。 | 同步夹具及两类集成断言，不撤回 native schema，也不把 2.x 策略一并替换；夹具只在显式隔离环境启用，正式包拒绝。 |
| T03 | 本轮已修复 `source-favicon.test.tsx` 的精确 CSP 预期，包含 `https://www.gstatic.com`，同时保留 favicon hostname、referrer、connect-src 等安全断言。 | 同步断言，不扩大任意远程 origin，不删 Google 必需图片源。 |
| T04 | `profile-selection-smoke.mjs` 等待有限入场动画完成后测稳定标题几何，断言本身不放宽。 | 把稳定坐标检查与逐帧动画连续性测试分开执行，不用任意长 sleep 掩盖竞态。 |
| T05 | `client-update-ui-smoke.mjs`、`chat-progress-smoke.mjs` 追加窄窗口宽度连续及嵌套列表样式检查；算法测试同步 effect／travel 等真实接口。 | 同步源码及断言；Mac 保持实际 Liquid Glass／AppKit 场景，不用关闭材质获得几何通过。 |
| T06 | 本轮补齐 `contracts/uiMessages.ts` 中 Kimi RPM／TPM／TPD／并发四类限额“有数字／无数字”的八种受控英文模板，并在 `ui-language.test.ts` 覆盖。提示保留等待时机和累计充值等级说明，不透传服务商账户原文。 | 同步八种模板及测试；英文界面触发各类合成失败，检查插值数字、单位、重试建议及其他错误的既有翻译。 |
| T07 | 本轮仅清理 Windows 两个旧 `builder-debug.yml`；原始 1.3.5 `latest.yml` 按摘要复制到 `windows/release/1.3.5/`，旧 EXE／APPX 留在原处作为恢复／升级基线。 | 这是清理及基线保存措施，不是待复制的产品功能；Mac 不改 Windows 目录。Mac 原始 1.3.5 清单／安装资产仍须按 R05 保护，不能据此假设 Mac 归档已建立。 |
| T08 | `windows/test/scripts/store-sandbox-smoke.mjs` 新增 `--nsis-upgrade-1.3.5` 和 `--appx-upgrade-1.3.5`，固定原始 1.3.5 SHA256。NSIS 基线对照公开 GitHub 原 EXE 及签名清单，APPX 使用已提交商店的保护原件；只读复制后检查原件未变。NSIS 1.3.5 纳入签名更新缓存 offer 和 RAG 持久化覆盖，两种升级均核对既有分库索引布局。 | Mac 不复制 Windows 入口、哈希或缓存协议；使用本机真实签名 1.3.5 包完成等效 1.3.5→1.3.6 安装／自然重启、资料与组件持久化、已校验签名的更新缓存 offer 检查。1.3.5 已分库，升级 1.3.6 应保留 `ragRevision`；不能沿用跨入 1.3.5 的旧布局测试预期而要求重建索引，也不能只测 1.3.3 升级代替。 |
| T09 | `shared/test/scripts/server-061-reference.mjs` 原只核对服务端版本 0.6.1，本轮沿用旧 0.5.3 参考模式，增加固定 HEAD `3440a2517ad3e4d2ee486c76023d229a0ec17fa8` 及 tracked clean 守卫；`shared/test/README.md` 顶部入口补完整 commit。HEAD 不符或受控文件有修改即拒绝，不修改服务端来迁就客户端测试。 | Mac 以 `VOXCUE_TEST_SERVER_ROOT` 指向该干净固定参考，在 `macos/` 运行 `node ../shared/test/scripts/account-erasure-receipt-smoke.mjs`，覆盖来源账号无会话验密与注销回执。该专项只用合成账户、loopback 服务和临时 SQLite，不访问真实凭据；与使用干净 0.5.3／`3bceb615dbba900f669322c301fc4b5b473dfb15` 的旧版兼容矩阵分别设置参考和执行，不能互换或只按 package version 判定。 |
| T10 | `shared/test/scripts/api-interactive-preview.mjs` 默认 `--check-only` 不再沿用“三家已配置”数量，改为四家精确名称／顺序及各行状态／动作断言：OpenAI API、Gemini API、DeepSeek、Kimi；OpenAI／Gemini／Kimi 为“已配置＋启用”，DeepSeek 为“当前使用中＋禁用”。非 check 模式就绪日志也从旧两家改为实际四家。此项只更新测试颗粒度，不改产品。 | Mac 同步夹具与精确断言，在 `macos/` 运行 `node ../shared/test/scripts/api-interactive-preview.mjs --check-only`；不以放宽数量、忽略服务名称／顺序或省掉 Gemini/Kimi 状态来适配旧检查。 |
| T11 | `shared/test/scripts/interview-shortcuts-smoke.mjs` 在开始面试对话框切换 mode 前后，统一经 `settledStartBounds` 测量：先等 `.interview-access[aria-busy="false"]`，再等 subtree 中 computed endTime 有限的动画 finished（排除无限扫光），最后读 boundingBox。解决新弹窗位移入场中提前测量产生的亚像素差，保留原严格高度相等及 footer 几何／滚动断言。此项只修稳定态测量，不改产品。 | Mac 同步相同 barrier，运行 `node ../shared/test/scripts/interview-shortcuts-smoke.mjs`；前后都先确认资料／权限检查和有限动画完成，再比较稳定几何。不能加宽浮点容差、改近似相等、忽略异常或用固定 sleep 替代生命周期等待；动画过程连续性另由对应专项验证。 |
| T12 | 用户本轮要求移除 composer 上方旧简历条。逐项删除 `PreparationPage.tsx` 的 `.resume-chip` JSX、其专用无消费者 imports；`styles.css` 全部 resume-chip 专用规则（含窄屏 hint 动画）；preparation store 的 `removeResume` 接口和方法；`uiMessages.ts` 五条仅供旧条使用且已无消费者的翻译。`delete-controls-smoke.mjs` 原“点击旧条删除简历”步骤改为断言旧条／移除按钮不存在，并读取 IndexedDB 确认原始合成简历的 id、baseId、name、blob 内容仍保存。 | Mac 同步上述移除及对应回归，不恢复 U15 已退役的 chip hint 动画。保留 `resume` state／load，它仍供 `PersonalInfoPanel.tsx` 的 legacy-resume 说明使用；历史原件、云同步、导入兼容与通用“简历原件”文案保留，不因删除展示条而清空数据库／历史资料或删除仍有消费者的共享能力。入口为 `delete-controls-smoke.mjs`、`client-update-ui-smoke.mjs`、`composer-smoke.mjs` 及个人信息／导入／云同步相关回归。此项不删除当前有效的 `GoogleSearchSuggestions`、来源和安全隔离路径；其他 UI 删除须先核对消费者并另逐项交接。 |
| T13 | 新增实际消费的 `shared/test/fixtures/google-search-suggestions.html`，提取 Google 公开完整 `renderedContent` HTML，保留原 CSS、SVG 路径及搜索目的链接；头注释记录官方来源、2026-11-26 取样日期、代码样例 Apache-2.0 许可及 Google 品牌归属。`api-interactive-preview.cjs` 从该文件读 HTML 并提取首 chip 的 link／label 为唯一来源；`api-interactive-preview.mjs` 的 `checkGoogleSearch` 改测官方 `.container/.chip` 及两套 SVG，移除旧 `.suggestions`／`Synthetic search suggestion` 简化展示。原位置、宽度、主题、协议、注入、sandbox、链接断言保留，新增透明外底板、无阴影与 branding 检查。 | Mac 同步唯一官方结构夹具与全部断言，在 `macos/` 运行 `node ../shared/test/scripts/api-interactive-preview.mjs --provider-logos --check-only`，在实际浅深主题和窄／宽容器检查，无需另造简化片段。来源为 `https://docs.cloud.google.com/generative-ai-app-builder/docs/grounded-gen`，许可说明随夹具保留；其中示例 API 已弃用，本轮只复用公开 widget 结构，继续用当前 Gemini 原生 API，不恢复旧 API 或把静态样例当作真实联网结果。 |
| T14 | 用户要求 Google logo 对齐第一行。`GoogleSearchSuggestions.tsx` 的 headline 仅新增 `align-self:flex-start;margin-top:2px`，按名义 32px 首 chip 与 28px 槽的高度差定位；保留原 28px 槽、深色 28px／0.64px 补偿、浅深横向光学位置及全部官方 SVG。避免两行建议时 logo 随整块内容垂直居中。 | Mac 同步该最小样式改动。`node ../shared/test/scripts/api-interactive-preview.mjs --gemini-completion --check-only`、`--provider-logos --check-only` 及完整 `--check-only` 都经 `checkGoogleSearch` 检查浅／深主题、单／两行的 `headline.y = 首 chip.y + 2px`、真实彩色 G 路径联合中心与首行／跨主题横向位置，保留原位置、间距、透明、无裁切和隔离检查。按 U05 独立验证 DPR 边框量化后推导 chip／两行高度，并显式列出实测光学中心差、名义到实际高度半差和补偿后残差；不加宽原几何／光学容差，不声称分数 DPR 实际中心差为零，不改变产品样式。两行只在 iframe 夹具临时克隆同一官方 chip 并设列布局，`finally` 移除克隆并恢复所有 style，动态高度也须恢复；不加入正式功能／生产自动换行，不把 SVG 外框或白圆边界当成彩色 G。可用现有五档 `VOXCUE_TEST_SCALE_FACTOR` 重跑 CSS／SVG 几何，不能据此宣称像素光栅化已验。 |
| T15 | 修复真实产品生命周期问题：Google iframe 触发的 `did-start-loading` 曾被误判为主页面重载，导致回答持久化为 failed／cancelled，也可能中止原生密钥配置、快捷键录入或面试启动。改用主帧跨文档导航围栏，真实主页面重载／跳转／销毁仍释放旧请求。实现范围为 `shared/electron/ipc/handle.ts`、`shared/electron/main.ts`、`shared/electron/ipc/apiConnections.ts`；详细分支和测试要求见下。 | Mac 同步全部共享实现，按真实 Electron frame 事件验证，再在 Mac 本机验证安全输入、快捷键录入与面试启动的 owner 生命周期。使用新增 `--gemini-completion`／`--navigation-lifetime` 定向入口及完整 `--check-only`；不能只看 Google HTML 出现或正文可见就判定成功，必须确认真实持久化完成且没有错误。 |
| T16 | Renderer 崩溃的 scoped 取消：`ipc/apiConnections.ts` 密钥 configure、`main.ts` 快捷键 capture 与面试 opening 分别补 `render-process-gone` listener，在各自 `finally`／end 路径解绑。取消与原任务 owner／controller 绑定；快捷键还核对窗口和 capture release 代次，防止旧崩溃事件结束新任务。保留 T15 的主文档导航过滤及原销毁／失焦／关闭围栏。 | Mac 同步三处共享实现，在 `macos/` 运行 `node ../shared/test/scripts/api-interactive-preview.mjs --renderer-owner-lifetimes --check-only`，按三业务分别真实 `forcefullyCrashRenderer()`：崩溃前请求 pending／capture active，崩溃后 owner signal 取消、handler 结束、新增 listener 释放；reload 后 renderer PID 必须改变并可重试。显式隔离夹具调用保存的旧 owner crash closure／旧 models 放行点，确认新任务仍 pending，随后分别完成合成 key 保存、正常结束 capture、实际打开并结束合成面试。不能用聊天 crash 代验这三类业务，也不能把这些测试注入入口加进产品。保留 `desktop-ipc.test.ts` 密钥结束矩阵的 renderer-gone 与三类 listener 归零断言，以及 `--navigation-lifetime` 的聊天 crash → abort → reload 场景；上述均为源码覆盖和 Mac 待执行验收入口，不表示本机或三业务已通过。 |
| T17 | SpeechHost 事件分发的窗口退役竞争：`main.ts` 的 emit 仅在 interview 分支快照当前 `coordinator`／`owner`，在业务调用之后、写 `InterviewContext` 之前及发送之前重验 owner 仍为当前且未销毁、coordinator 仍为同一个并仍指向 interview；最后用快照 `owner.webContents` 发送，避免再次读可能已变 null 的全局窗口。dictation／audio-test 分支职责不变。 | Mac 同步共享 guard，并通过 `interview-shortcuts-smoke.mjs` 保留正常合成 transcript 送达的正例，再在当前 `blocksInput` 处理中同步销毁唯一 owner 场次：退休事件不得写入 `InterviewContext` 或后续场次，uncaught／page errors 仍须为空。该用例验证同一 emit 内的同步重入边界，不伪装为旧 SpeechHost 代次跨新场景；另在 Mac 本机验证 AppKit 窗口销毁、结束／重新开始和输入恢复。此前有全局 interviewWindow 为 null 的错误线索，但原偶发问题的最初触发源尚未确定，不能把 status-error 分支描述成已确定原因或宣称根因穷尽。 |
| T18 | 面试右上“快捷键”说明隐藏后再显示的延迟：`main.ts` 原在普通隐藏的淡出结束后销毁帮助 BrowserWindow，重开需创建新 Renderer、加载页面并重复 native／rendererReady 双握手。`setInterviewShortcutsOpen(false)` 现只调用既有 `WindowVisibility.set(false)`，保留同场已 ready 的 helper；删去旧 hide 结束后的销毁回调，避免快速 hide／show 时旧回调销毁新显示状态。真正结束面试、helper 失败／崩溃、owner 重载仍沿原 `closeInterviewShortcuts` 销毁，不跨场缓存，不改原生淡入淡出／辅助功能降级。 | Mac 同步同场 hide／reuse，在 AppKit 本机验证帮助窗口父子关系、快捷键／右上按钮／原生关闭按钮的显隐、快速反向、失焦与面试结束。`interview-shortcuts-smoke.mjs` 三处旧“隐藏即 close”改验原生隐藏，比较同一 BrowserWindow／WebContents／文档标记／rendererRevision，验证快速 hide／show 保留最新显示；最终结束同时等待 owner 与 helper 的 close 事件后再断言 helper 已销毁，避免页面通知顺序造成假失败，不加固定 sleep、不削弱断言。原生 click-through、语言、透明度、按键释放及 uncaught／page errors 为空的检查保留；这是窗口复用行为与本机待验边界，不记录显示延迟成绩。 |
| T19 | 仅测试修复：`windows/test/scripts/interview-effort-smoke.mjs` 的 `checkRefresh` 在 ArrowDown dispatch 返回后原来立即比较 activeElement，但当前 Radix roving-focus 通过 `setTimeout(() => focusFirst(candidateNodes))` 在后续 task 移焦。改为获取真实第二项 option 的 ElementHandle，条件等待它等于 `document.activeElement`，随后保留原 `assert.ok`，并在 `finally` dispose handle；不增加 sleep、容差或阈值，不改 Radix、菜单产品逻辑、动画或 dist。 | Mac 本机入口为 `node test/scripts/interview-effort-smoke.mjs`；按其平台 `checkRefresh` 核对对应刷新与方向键焦点场景，如有同类即时取样，等待真实目标 option 获焦后再执行原严格断言，不能机械覆盖整份平台测试。滑块保存前后“焦点必须保持”的既有断言不变；关闭菜单后的焦点恢复沿用已有条件等待，不把所有焦点检查改成延迟采样。Mac 文件在 Windows 保持只读，由 Mac 接续者同步等效测试边界。 |
| T20 | 仅测试修复：`shared/test/scripts/interview-shortcuts-smoke.mjs` 的 reentrant／failed-load 两次新场选择原用不限角色的 `app.waitForEvent('window')`，而 reveal 也会自动创建 `#interview-shortcuts` helper，其异步 Page 通知存在被误取的静态候选路径。改为开场前快照已知 Page 集合，使用 15 秒有界 `waitNewInterview(previousPages, stage)` 条件轮询，只选择本轮新出现、仍存活且 URL 为 exact `#interview` 角色的 owner；终端输出 stage、native window ID、WebContents ID 与 URL，failed owner 同样收集 pageerror。保留原 toolbar、退休事件隔离、真实关闭／destroy、错误列表等断言，不改产品／dist，不用固定 sleep 或放宽断言绕过窗口选择。 | Mac 在本机运行 `node ../shared/test/scripts/interview-shortcuts-smoke.mjs`，同类多窗口场景按角色与代际识别 owner，不能只取第一个 Page 事件，也不机械覆盖平台专属脚本。误取 helper 目前只是静态候选，缺少原失败现场的 ID／URL 对照，不能写成已实测确认的根因；新增日志仅用于当次终端定位，不保存报告或测试成绩。 |
| T21 | 草稿立即 reload 的取证与压力入口：新合成输入已进入 React／store；退出 checkpoint 链的旧事务阻塞原因及真实产品修复见 T23，不能继续仅按测试取样问题处理。`shared/test/scripts/chat-progress-smoke.mjs` 在刷新前后严格比较完整草稿；catch 只输出合成 UI／IndexedDB 的 current、reload-checkpoint-v1、committed active row 等标识与草稿长度／首行／末尾摘要、末行存在性、禁用状态及 UI 存储错误。新增 `--repeat-final-reload=N`，默认 1、仅接受 1..30 整数；完整前置场景只跑一次，末尾重复真实 UI fill 20 行文本、确认显示 11 行、立即 Chromium reload、恢复后逐字核对与 11 行布局，多轮时首行加入唯一 iteration 标记防旧 checkpoint 假通过。原 30 秒超时、后续已存消息／reasoning 断言保留。 | Mac 必须同步 T23 的共享产品修复，再用同一共享脚本在本机真实 Chromium 验证，例如 `node ../shared/test/scripts/chat-progress-smoke.mjs --repeat-final-reload=20`；本节测试增强或 fake IndexedDB 单测不能代替实际立即刷新验收。保留 pagehide checkpoint，不加保存 barrier、等待 debounce、固定延时或新账户绕过边界，不调整超时／动画；源码修复本身不等于本机验收完成，证据与合成摘要只留当次终端。修复前的旧候选安装包已过期，修复后新包须完成验包、安装／升级等最终验收再发布。 |
| T22 | 仅测试诊断增强，前台丢失／hover 离开原因尚待实证：`windows/test/fixtures/WindowProbe.cs` 的 hover-candidate 使用同次 foreground HWND 快照，输出 actual／owned 目标的 HWND、PID、class 及 expected PID，原 owner／前台 guard 仍直接失败。`shared/test/scripts/updates-sidebar-smoke.mjs` 的 morph 采样只读记录最多 40 条 DOM pointer／focus 事件及 focus-visible；动画断言失败时输出 owned／实际前台、cursor、geometry、DOM 命中与焦点状态，保留原采样时长、输入、动画和严格断言。 | Mac 在本机运行 `node ../shared/test/scripts/updates-sidebar-smoke.mjs`；共用 `assert-download-button.mjs` 对组件／更新按钮失败另输出最多 40 条 pointer／focus 事件、hover／focus-visible、两个标签的实际 CSS／动画以及本进程窗口焦点、边界和 cursor。诊断监听在 `finally` 解绑，只写终端，不改既有输入步骤、时钟、15 秒等待或业务断言；`components-ui-smoke.mjs` 为对应重测入口。不能复制 Windows HWND 实现或通过切前台、移动输入、放宽断言来掩盖原因；不把候选环境因素描述为已证明根因，也不据此宣称界面问题已修复。 |
| T23 | 真实产品修复：`shared/src/services/chats.ts` 的旧 readwrite 事务在 get current 后等待旧 Renderer 的 JS 回调，最新 pagehide checkpoint 被排在该事务后；旧 document 退役可使 checkpoint 无法提交，导致新草稿回退。`Pruning` 现记录对应 `IDBTransaction`；hide 严格按“source 捕获最新 snapshot／清 pending → 尝试 abort 同 DB 旧 tx → 编码 checkpoint → 原 pagehide task 同步 put／commit／close”执行。旧 tx 全部可 abort 时，保留 restoredRows／inflight changed-row 完整编码及未变 row ID 的差量路径；只有 committing／finished 旧 tx 的 `DOMException InvalidStateError` 被忽略并标记 `changedBase`，其他异常仍抛出。该标记下本次 checkpoint 全行物化，防止旧 tx 已删／改基线中与 previous 同引用的行后，ID／partial 无法恢复。保留 Google 瞬态清理／730 天 TTL、350ms 普通保存防抖、数据 version／契约、附件 keep／removed 补偿和 File 原件，不涉及 RAG 调参。 | Mac 必须同步此共享修复，在本机跑 `chat-storage.test.ts` 的“目录读取尚未 resolve 就 pagehide”、committing、finished／complete 三种确定性边界及原附件恢复断言，再执行 T21 的真实 Chromium 立即 reload 多轮压力。新消息、多行草稿、旧／新 File 原件与未变历史差量均保留；仍可取消的旧 write 应受控 Abort，已 committing／finished 的旧 write 则按 changedBase 物化，不能把两类预期混在一起。原数据兼容、Google 持久化边界与附件保全一并回归，不以 fake IndexedDB 代替实际浏览器，不加等待保存的 barrier、固定延时、额外账户或放宽超时。一次性重型 observer 与 observe flag 不保留在最终脚本，只有 repeat 参数与轻量失败摘要；Mac 不移植临时探针。源码补丁与验证入口不构成通过成绩；过期候选包须在最终修复后重建并重验安装／升级。 |
| T24 | 仅测试诊断：`shared/test/scripts/legacy-profile-upgrade-smoke.mjs` 区分 seed browser storage、A／B account roundtrip、committed A erasure receipt 和 final cleanup 等关闭阶段，记录合成窗口 ID／WebContents ID／role／visible／crashed／loading、session close-request／close-ready(saved) 及原生 quit 生命周期事件，失败只在终端显示有界末段原生信息（最多 16000 字符）。body catch 先打印原异常；若 finally 清理也失败，使用 `AggregateError` 保留两者，不让关闭超时遮住初始原因。原 10 秒关闭期限、数据迁移／归属／附件／设置等断言不变，没有产品修复。 | Mac 在 `macos/` 用 `node ../shared/test/scripts/legacy-profile-upgrade-smoke.mjs` 验共用 seed、A／B 归属隔离、迁移合并与重启恢复消费者；按本机窗口／退出链取得等效诊断，不修改平台专属关闭实现或放宽期限。既有“服务端已提交 A 删除回执、原件仍待清理，冷启动先清 A 再恢复 B”的附加场景原本仅在 `process.platform === 'win32'` 分支，不能把其 Windows 记录当 Mac 已覆盖，也不直接移除 guard 或照搬 Windows 凭据／窗口机制；Mac 由本机临时合成 vault／安装环境按授权补等效验收。实际关闭异常的原因仍待对应重测证据，不把诊断增强描述成原因已确定或产品问题已修好，不保存报告／成绩。 |

**T25，资料引导打开面板的测试同步。** `profile-ui-smoke.mjs` 明确点击“查看个人资料”后，等待真实个人信息面板可见、有限动画完成，并严格确认顶栏 `aria-expanded=true`，再进入摘要编辑；删除随后按瞬时 `isVisible()` 判断而再次切换顶栏的 fallback。引导动作是 `openInfo()`，顶栏是 open／close toggle，不能用动画过程的几何可见性代替逻辑打开状态。保留原 20 秒期限、草稿／资料／编辑断言及产品行为；局部有界点击／公开状态／几何诊断只在失败时写终端，`finally` 释放。入口为 `node ../shared/test/scripts/profile-ui-smoke.mjs`，沿用五档 `VOXCUE_TEST_SCALE_FACTOR`。这是修补确定的夹具同步缺口，不表示已取证某次失败的完整时序或存在产品修复，不保存成绩。

**T26，账号删除错误密码后的异步状态等待。** `account-erasure-smoke.mjs` 在确认错误密码不会删除账号后，复用既有 `waitForAsync` 等待真实 `cloudAccount(status)` IPC 结果；避免 `waitForFunction(async ...)` 先把 Promise 视为 truthy，随后异步解析为 false 时不再重试。保留原默认 30 秒期限、仅对原 `retryAfterSeconds===1` 且精确 busy 文案的过滤、最终 `state.ok===true` 与用户 ID 严格断言；非 busy 错误不能当成就绪。该改动只修测试同步，不改产品、凭据或原生导出流程；`NATIVE_RESULT` 是既有保存对话框 cancel 结果，与账号 status 结果分别解释。入口为 `node ../shared/test/scripts/account-erasure-smoke.mjs`，五档缩放及指定独立服务端参考沿用原规则，不保存成绩。

T22 的 `ui-material-refinement-smoke.mjs` hover 定向诊断另记录最多 24 条带相对时间的 pointer 事件、8 条脚本 hover／move 目标及 steps，并在失败时输出本进程预期／焦点窗口、native cursor、content bounds 和 zoom。原输入、15 秒期限及几何／悬停断言不变，不重试 hover；`isTrusted` 不能区分自动输入与系统事件，轨迹不一致本身不证明原始输入来源。诊断只写终端，局部监听在 `finally` 解绑。

**T15 的逐项实现与 Mac 验证：**

1. `ipc/handle.ts` 提供单一纯判据 `isMainDocumentNavigation(details)`，条件严格为 `details.isMainFrame && !details.isSameDocument`。只把主 frame 的跨文档导航视作旧页面失效；不能把任意 `did-start-loading` 或首个子 frame 导航当成主文档重载。
2. `main.ts` 的 `releasePageRequests`、快捷键 capture、`interviewOpening` 三个消费者改监听 `did-start-navigation` 并调用同一判据；capture／opening 使用对应具名 listener 并在原清理路径解绑。各分支既有 destroyed／blur／closed、渲染进程退出、请求归属及取消围栏继续保留，不因修子 frame 误取消而放开真正失效的 owner。
3. `ipc/apiConnections.ts` 的配置 prompt 同样使用具名、过滤后的导航 listener，注册为 `.on` 并在 `finally` 解绑。不得用 `.once`：首次子 frame 事件应被忽略且保留后续真实主文档导航的取消能力。原 destroyed 取消及原生控件关闭清理不变。
4. `main.ts` 主窗口 `closed` 在 `win === mainWindow` 时补 `cancelActive()`，覆盖强制 `destroy()` 绕过普通关闭流程的情况；保留窗口归属检查，不能让旧窗口关闭取消新 owner。独立面试窗口的 loading listener 不属于此修复，不做全局替换。
5. `api-interactive-preview.mjs` 的每个聊天场景读取真实 `voxcue-preparation-chats` IndexedDB：消息须为 `completed`，`error`／`errorCode` 均不存在，DOM 不得有 `.message-error`。`--gemini-completion` 单独覆盖 Gemini 建议展示与完成持久化；`--navigation-lifetime` 用真实 iframe 插入／srcdoc 重载及主 frame 同文档 hash 变化检查 pending 请求存活，再验证真实 `page.reload()`、主 frame `webContents.loadURL()`、强制 owner `destroy()` 仍取消旧请求。完整 `--check-only` 也执行该生命周期场景；不通过合成一个“完成”结果绕开真实 IPC／存储／事件。
6. Mac 在 `macos/` 用 `node ../shared/test/scripts/api-interactive-preview.mjs --gemini-completion --check-only`、`--navigation-lifetime` 及完整 `--check-only` 检查共享行为；另外以 owner 合成资料串行验证 AppKit API 密钥框、快捷键录入和面试启动在子 frame 事件后继续有效，主页面导航、失焦／关闭和取消仍按原职责收尾。保持 Mac 菜单快捷键忽略恢复、原生输入销毁及监听解绑，不读取真实 Keychain／账号或采样真人音频。
7. 此前回答被标为 cancelled 的 Google 视觉截图不再作为现状证明；重新构建后，先确认消息真实 completed／无错误，再复核浅深主题、单／两行、首行 logo 对齐、透明底板与整个界面。临时截图只放 owner 系统临时目录，按规则清理，不把图像或测试成绩写入工作区。

**T16 的真实 crash 测试恢复边界（仅测试实现）：**

1. `api-interactive-preview.mjs` 的 `--navigation-lifetime` 与 `--renderer-owner-lifetimes` 共用 `recoverCrashedRenderer`。真实 Renderer 崩溃后，旧 Playwright Page session 会保持 crashed，不能把原生 reload 成功等同旧 locator 可继续使用；先等待同一 WebContents 的真实 `did-finish-load`，核对 BrowserWindow／WebContents ID 不变且 Renderer PID 已改变，再通过该 owner 的 loopback CDP endpoint 附加 fresh Page，随后才做 DOM 断言。
2. 恢复不新建替代窗口，不修改 Playwright 私有 `_crashed`，不伪造完成事件；附加 CDP 连接在 `finally` 断开，仍按既有 owner 清理流程关闭原应用。Mac 本机继续验证相同窗口恢复与原生控件收尾，不能以建立新 BrowserWindow 绕过旧 owner 的生命周期。
3. 三业务 probe 补齐产品 AI 服务启用 UI 前置：VoxCue 主账号登录不等于 AI 服务已连接，须先在 AI 服务页启用 Gemini，等待该行出现“禁用”动作后再读取模型目录。只用显式隔离的合成账号／密钥与响应；受控合成错误字段仅在终端截断观测，不写入文档或测试结果文件，不借此访问真实凭据。
4. 阶段日志仅用于终端定位；保留原异常，防止 `finally` 清理超时覆盖初始原因。上述是对真实 crash probe 的会话恢复、前置与异常处理修正，不增加产品入口或改变业务断言，也不表示专项已执行或通过。
5. CDP owned 端口初始化还须包含完整 `--check-only`：它在末尾也调用 `checkNavigationLifetime` 并真实 crash，不能只给两个专用 flag 分配端口。`crashProbe` 现统一覆盖 `checkOnly`／`rendererOwnerLifetimes`／`--navigation-lifetime`，避免完整路径拿到 undefined 端口；仅一行测试初始化修正，原 owned endpoint、相同窗口／WebContents、新 Renderer PID 断言均保留。

后续全量测试若发现新的产品、翻译、安全、取消或资源释放问题，由发行负责人按“问题、最小改动文件、Mac 等效实现、验收入口”继续逐项补入本节，不凭猜测增加策略。

## 七、Mac 本机验证排程与判据

所有命令在 Mac 的 `macos/` 平台目录运行，先检查 `--list` 和当前脚本；命令这里只定义入口，不表示已执行。依赖仅安装在当前平台目录，`sync:workspace` 只更新根及 Mac 生成配置，`windows/` 全树只读。

1. **V01，变更完整性。** 对照 `v1.3.5` 标签到最终 1.3.6 发行提交的全部 diff；确认 B/A/U/N/S/T 每项有实现或明确本机待办。核对版本唯一来源、更新文案、共享／平台生成差异、无意外模型／依赖升级、无真实资料和凭据、无额外分支。
2. **V02，静态与单元。** `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:workspace`、`pnpm test --exclude '../shared/test/unit/rag-accuracy.test.ts'`、`pnpm build`。先在当前平台目录运行 `pnpm exec vitest list --config ../shared/vitest.config.mjs --filesOnly --exclude '../shared/test/unit/rag-accuracy.test.ts'`，核对列表确实不含该旧文件，再执行单元命令；Mac 同样使用 `../shared` 相对路径并先核对列表，不能直接假定 glob 匹配。此前 `**/rag-accuracy.test.ts` 在当前 Windows Vitest root 下没有排除平台目录外的共享路径，不再使用该写法。本轮显式排除该整份测试文件：默认 `pnpm test` 会导入旧 `rag-quality100` 标签夹具，虽仅作纯函数／标签数量断言、没有执行真实模型准确率评测，仍为遵循用户不使用既有评测集的要求而跳过这一消费者；先前通用单元中的这类纯函数／标签检查不计作 RAG 功能验收。只调整本轮 CLI 排程，不改项目全局测试配置或断言，也不据此删除仍有消费者的旧数据文件。RAG 功能按 V08 用本轮新建资料及原功能单测验收。先对本轮 API／Google／动画／存储／IPC／知识库单元定位失败，再执行上述单元排程；不删除失败用例或放宽业务断言。类型与构建检查不受该排除影响。冻结依赖审计按项目既有入口做，不能未经授权升级依赖来消除告警。
3. **V03，共享功能矩阵。** `node ../shared/test/scripts/functional-suite.mjs --list --jobs=1` 确认清单，再执行当前 Mac 完整矩阵；账号／云协议使用指定独立服务端根，模型使用认证公开缓存。有依赖未就绪的项目单独列出，不报作通过。GUI／原生／推理串行，只在当前 UID 登录且解锁的控制台运行；纯协议能否并行以现有调度器审计边界为准。
4. **V04，API 定向。** 分别执行 Kimi/Gemini 的目录、校验、启禁、重启、模型能力、文本／支持附件、思考、搜索／面试无搜索、流内错误、重试、降级、取消、迟到事件、余额／用量、资料提案。隔离 HTTP/SSE 测试不能证明真实账号／全部模型可用；真实服务验证另明确所用模型和覆盖范围，不读取用户真实密钥。
5. **V05，视觉。** 现有 `ui-alignment`、`typography`、`provider-ui`、`composer`、`chat-progress`、`shimmer`、`profile-selection`、`client-update-ui`、`settings`、`history`、`interview-motion` 等入口加 `node test/scripts/ui-refinement-matrix.mjs --list` 的 Mac 组。检查浅深准备页、固定深色面试、官方 Google 单／双行样例、相同窗口和缩放、28px 光学中心、8px／12px 气泡、窄窗及长文本、不裁切、不溢出；按当前 Mac 五档矩阵执行，不拿 Windows DPI 成绩代验 Retina。
6. **V06，安全／对抗。** 跑既有 adversarial、IPC／URL／HTML／Markdown／数学渲染、凭据策略、账户隔离、超长／损坏输入、取消／切换／重载／销毁竞态、恶意来源和外部链接负例。保留沙箱／fuse／包内测试入口拒绝等检查；所有数据用本轮 owner 合成资料，不探测真实账号或 Keychain 内容。
7. **V07，稳定性。** 当前面试稳定性、生命周期、内存／进程释放、20 轮面试及既定 10 分钟语音长稳按当前调度器原时长执行；公开音频／合成采集端口运行真实 Worker／ASR。故障退出后恢复、后台切模型／设备、取消再启动都验证。不自动采样物理麦克风，不把公开音频原文作为准确率基准。300 长消息动画性能只观察现有策略，不擅自加入 content-visibility 优化。
8. **V08，RAG 功能完整性。** 只用本轮新建合成资料和既有认证模型，通过 fresh `rag-core-smoke.mjs`／`rag-ui-smoke.mjs` 功能场景及 knowledge 原功能单测验导入、首次索引、检索、引用、替换、删除、重启、取消／迟到写入、库切换及归属异常；与 B01–B03 同验。保留已调优模型、阈值和全部检索参数，跳过 V02 的旧评测集消费者，也不运行旧 `rag-validation-smoke.mjs`、`rag-colloquial-smoke.mjs` 等评测入口，不使用可能与训练重叠的数据。仍有消费者的旧数据文件不在本轮未经授权删除；功能完整性检查不构成准确率评价，不新增“性能更优”结论。
9. **V09，Mac 原生。** `api-key-field-smoke.mjs` 加 N04 真实弹窗；在 `macos/` 执行 `node ../shared/test/scripts/api-interactive-preview.mjs --renderer-owner-lifetimes --check-only`，按 T16 对密钥配置、快捷键录入和面试启动分别验证真实 Renderer crash、监听释放、新 PID 重试、旧 owner 回调不干扰新任务及正常收尾，再补 AppKit 实际安全输入／窗口交互。不能只用 `--navigation-lifetime` 的聊天 crash 推断三业务行为。凭据 vault／policy／upgrade、native-build、window／permission／launcher／更新等按现有 Mac 专项。只用合成临时钥匙串及自有窗口；不得为测试更改辅助功能／锁屏权限、签名身份或采样真人音频。原生截图测试仅按现有 owner 遮罩边界，像素不持久化、不送服务商。
10. **V10，回归颗粒度。** 失败先区分产品、夹具、依赖和平台环境；每个最小修复先定向重测，再重测受影响集成及最终包。算法、逐帧动画、稳定几何、AppKit 首帧、真实服务协议、最终安装分别记结论，不由其中一个外推其他层。成绩只在终端／对话报告，临时 profile／数据库／截图／trace 用系统临时目录并结束清理。

Mac 包与 VM 的具体信任边界沿用 [macos/docs/TEST_GUEST.md](../../macos/docs/TEST_GUEST.md)，公共排程见 [shared/test/README.md](../test/README.md)。不把旧文档里的时序成绩或历史授权当成当前运行事实。

## 八、Mac 构建、签名、升级与双渠道发布

此节用于 Mac 接续发行，不授权 Windows 进程修改或执行 Mac 平台内容。先完成当前授权下的 Mac 本机验收，再按既有身份发布。

1. **R01，版本与依赖。** 共享产品版本为 1.3.6；Mac 在本机执行当前 `sync:workspace`／检查流程生成根与 Mac 配置，锁文件／依赖只在 `macos/` 安装。Windows Store 的 2.3.6.0 是 Windows 商店包映射，Mac 仍为 1.3.6，不同步成 2.3.6.0。
2. **R02，原生构建。** 当前 `pnpm build` 走 `build:app-inputs` 与 launcher；app-inputs 包括图标、音频、权限、更新器与共享 TypeScript／Electron／Vite。共享类型／构建成功不等于原生 helper 或最终应用成功，保持既有每个签名构建入口。
3. **R03，签名身份。** `macos/local-signing-public.json` 为公开指纹基线，私钥仅在受保护 `macos/.tools/development-signing`。既有 development signing、Sparkle Ed25519 和凭据 helper 身份都保留；缺失／错配时失败，不自动生成、轮换或 ad-hoc 回退，不读取／提交私钥。
4. **R04，最终包。** `pnpm package:installer` 读取版本，生成 `macos/release/1.3.6/` 的 `VoxCue-1.3.6-arm64.zip`、`VoxCue-1.3.6-arm64.dmg`、`latest-mac.yml`。脚本拒绝覆盖已有 release 输出；ZIP 含 Sparkle 及 VoxCue 签名，manifest 含固定 minimumSystemVersion 与摘要，保持原 14.2 系统下限。需要增量时显式传经认证的旧签名发行目录 `--delta-from=<旧发行目录>`，不得用重打包 1.3.5 代替原件。
5. **R05，1.3.5 升级基线。** 保留原始 Mac 1.3.5 ZIP／DMG／清单／签名与必要旧增量资产。`package-upgrade-baselines`／guest 当前登记哪些旧版必须核对源码；要把 1.3.5→1.3.6 列为验收，先按固定来源／摘要登记真实 1.3.5 基线，不能把别的旧版本升级冒充此路径。验证用户资料／组件缓存复用、取消／失败恢复、增量失败全量兜底，以及旧版载入签名新版元数据形成缓存 offer 后的升级／重启语义。**1.3.5 已使用分库布局，升级到 1.3.6 保留 `ragRevision` 与索引，不预期重建；跨入 1.3.5 的旧版迁移断言不能套用本路径。**
6. **R06，最终资产验收。** 用 `VOXCUE_TEST_RELEASE_DIR` 指向实际最终发行目录，按 `package-security`、`package-runtimes`、`package-smoke --install-archive`、DMG／图标／签名／fuse 及 `package-guest-smoke.mjs` 当前流程验证。VM 消费未修改的正式包、不映射宿主真实 HOME／Keychain／私钥／音频设备；区分静态检查、安装态运行、首次安装和旧版升级。`--static-only` 不能代替动态安装验收。
7. **R07，GitHub。** Mac 原始资产附加到唯一 `NCFXZ/VoxCue` 的正式 `v1.3.6`；已有 Windows EXE／blockmap／latest.yml 必须保留，不创建第二个源码仓库或覆盖另一平台附件。保留当前签名与摘要，发布源码和许可证入口指向该主项目版本。验证匿名下载、大小、摘要及更新选择。
8. **R08，CNB。** 同步到 `voxcue-release/voxcue-release`，只放原始发行附件、公开版本索引及必要发布配置，不放应用源码／令牌。当前平台从 `macos/` 执行 `node ../shared/scripts/prepare-cnb-mirror.mjs --tag=v1.3.6 --platform=macos-arm64` 生成系统临时 CI 配置，执行前核对当前脚本参数；CI 校验 GitHub 公共原始字节，不能重打包／更换签名。组件目录若变化同步所有现用分卷、模型、运行时、许可证和固定 SHA256；若未变化也确认两源附件完整。
9. **R09，索引最后发布。** 完成 Mac 资产匿名下载、摘要、Range／更新清单校验后，按 `prepare-cnb-index.mjs --tag=v1.3.6` 生成并审核合并索引，保留 Windows 1.3.6、其他平台和历史记录。CNB `main/releases.json` 只列完整正式版本，保留大陆出口 IP 走 CNB／其他出口走 GitHub 的既有策略，不按语言／时区，不给客户端放仓库凭据。移除只为镜像临时提交的 CI 配置，按当前脚本流程执行。
10. **R10，平台交付边界。** Mac 不提交 Microsoft Store；Windows 的 GitHub／CNB／Store 已上传、已提交审核、已上线是不同状态，不由本清单推断。Mac 完成后在对话给出当前真实渠道状态与本机未覆盖项，更新接续摘要，不在仓库保存测试成绩或发布截图。

下载源与资产一致性细节见 [DOWNLOAD_CHANNELS.md](DOWNLOAD_CHANNELS.md)，此前 Windows 基线见 [WINDOWS_1.3.5_HANDOFF.md](WINDOWS_1.3.5_HANDOFF.md)。

## 九、清理与保留

- 清理前检查真实绝对路径、静态／动态入口、构建／测试消费者及占用，只删确认无用、当前任务所属的文件／临时产物。不通过整库 reset／clean 或批量删未知目录“清理”。
- 保护用户原件、真实资料、凭据、签名私钥、冻结 helper／恢复源码、现用依赖／模型、认证公共测试缓存及原始发行／升级基线。Mac 上 `windows/` 全树只读；不同平台历史产物不由当前端清理。
- 历史明确暂留的 Windows 349 个云占位目录不重试；Mac 117 个 fileproviderd 占用目录也不在此轮自动重试。其历史说明见 `shared/test/README.md`，不得为了清空工作区绕过占用或取得额外权限。
- 只有在源码消费检查确认弃用后，才删除被替代的测试文件；不能只从调度器移走失败入口然后把文件留在库中。官方 Google HTML 样例可作为明确测试输入，合成账号、结果、截图、trace、coverage 与 profile 不可提交。
- 完成／失败／取消时清理本轮拥有且已停止的系统临时目录；活跃 VM 映射、归属未知目录不动。复用经固定来源和摘要认证的公共模型／音频缓存，避免重复下载，不保留账户／凭据或测试成绩。

## 十、最终核对待办

- [x] 文档按完整 `v1.3.5..v1.3.6` 源码范围逐项核对，保留 B01–B07；正式源码标签规范为 `v1.3.6`，不依赖另填未来哈希。
- [x] 本轮测试中的修复和诊断增强已逐条写入 T01–T26，区分产品修复、夹具修复与待取证边界，不把测试入口描述成产品新功能。
- [ ] Mac N01–N05 原生密钥首帧、主题、缩放与取消实现／验收；共享等待结束不能代替 AppKit 视觉检查。
- [ ] 原生 schema＋Google 搜索真实组合、未知模型能力、面试不搜索、Kimi 严格解码与恢复分别确认；真实服务未覆盖时在交付对话明确说明。
- [ ] 官方 Google HTML 浅深色光学中心、透明底板、紧凑间距、单／双行样例，以及所有聊天／面试气泡逐项确认。
- [ ] 当前 Mac 全量矩阵、RAG 新合成资料功能、原生／长稳、最终签名包首次安装及 1.3.5 升级按第七、八节完成；结果只在终端／对话。
- [ ] Mac GitHub／CNB 原始资产与索引核对，Windows 资产／历史记录未丢失，临时资料和临时发布配置按规则清理。
