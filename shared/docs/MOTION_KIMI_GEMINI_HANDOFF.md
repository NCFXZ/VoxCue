# 联合交接：动画优化、Kimi 与 Gemini 适配及界面修正

2026-11-26，Windows 本机。基线为 `main` 的 `ecfe553`，以下改动**全部未提交**。第一至五节保留 Claude 的交接记录，第六节合并 Codex 的接入、界面修正及双方接续测试边界。工作区中的改动相互叠加，接续时先看 `git status`／`git diff`，按具体职责、条件分支和选择器核对，不按整份文件划分作者或回退。

本文件中的验证方法不延续授权，实现原因和验证入口也不等同当前工作区的验收结论。第六节的静态核对和验证矩阵用于指导后续测试，不表示本次重新执行了全量、原生或服务商实测。

规则以 `AGENTS.md` 为准，这里只提醒和本次相关的几条：

- Windows 上 `macos/` 只读，Mac 端验收由 Mac 本机执行。
- 不读取真实密钥。需要实测服务商时，让用户在自己的终端里隐藏输入密钥（`Read-Host -AsSecureString`），只输出状态码和限额类型，用后清除。
- 不放宽失败断言。测试结果只留在终端，不写入工作区。

---

## 一、动画优化

### 目标

让动画统一、流畅，使用非线性缓动，消除跳变、重影和裁切，并让被打断的动画自然续播。

### 1. 共享参数（`shared/src/styles.css` 的 `:root`）

原有参数：

- `--panel-motion-duration: 240ms`
- `--panel-motion-easing: cubic-bezier(0.2, 0, 0, 1)`，即标准曲线

新增参数：

| 参数 | 值 | 用途 |
|---|---|---|
| `--panel-motion-exit-duration` | `180ms` | 退出比入场更快，用于弹窗退出、侧面板淡出 |
| `--panel-motion-emphasized-easing` | `cubic-bezier(0.22, 1, 0.36, 1)` | 较大形变的减速曲线，用于录音播放器和悬浮窗箭头 |
| `--fade-out-share` | `0.4` | 交叉淡变时，旧内容在前 40% 时长内淡出 |
| `--fade-in-delay-share` | `0.15` | 新内容延后 15% 再淡入 |
| `--button-morph-easing` | `var(--panel-motion-easing)` | 原为 `ease`，改为与全局一致 |
| `--button-morph-fade-out` / `-fade-in-delay` / `-fade-in` | 由上面的比例算出 | 按钮标签交叉淡变 |

**统一的硬编码时长和曲线：**

- 设置开关滑块：原 `0.18s` 默认 ease
- `.disclosure-chevron`：原 `150ms ease`
- 个人资料折叠区 `.profile-disclosure::details-content`：原 220/180ms `ease-out`
- 悬浮窗截图按钮及计数：原 180ms `ease`
- `.floating-collapse-chevron`
- `recordingPlayer.css` 的 `--motion`：保留 340ms，改用强调曲线
- `ActionTransition.tsx`：原写死 220ms `ease-out`，改为读取 `--button-morph-*`

只改颜色和悬停反馈的短 `ease` 保持不变，看不出线性感。

### 2. 交叉淡变去重影

数值依据：新旧内容同时用主曲线淡入淡出时，约 20% 时刻两者都是 50% 透明度，形成重影。改为旧内容在前 40% 时长内淡出、新内容延后 15% 淡入后，两者重叠的透明度峰值从 0.50 降到约 0.09。

- **页面切换**（`components/ui/page-motion.css`）
  - 在 `::view-transition-old/new` 上叠加第二个只控制透明度的动画（`view-fade-out` / `view-fade-in`）。动画列表里靠后的动画决定透明度，位移仍由原来的 `screen-exit` / `screen-enter` 全程负责。
  - 动画名称保持不变，因为 `settings-smoke`、`history-branding-smoke` 等测试按名称查找，`.sent-message-enter` 也共用 `screen-enter`。
- **按钮标签**
  - 涉及：删除确认、`.button-morph-*`、下载按钮、侧栏更新按钮。
  - 按「目标状态」分别设置 `transition-duration` / `transition-delay`：离开的标签缩短透明度时长，进入的标签延后淡入。位移仍是全程。
  - 只设置 longhand 属性，所以原有 `prefers-reduced-motion` 下的 `transition: none`（property 为 none）依然生效。

### 3. 提示折叠时文字被裁切

`components/ui/content-reveal.css`：

- 原先高度用前快的主曲线，透明度用后慢的 `ease-in-out`。折叠时高度收得比文字淡出快，文字在仍然可见时就被裁掉。
- 新增 `.interview-reveal[data-open='false']`，用 longhand 把透明度时长改为 `D × fade-out-share`，并改用主曲线。展开方向保持原样。
- `styles.css` 里 `.chat-settings-notices > .component-notice-reveal[data-open='false']` 做了同样处理。
- 用 longhand 是为了不覆盖 `.account-quota-skeleton > .interview-reveal { transition: none }`。

### 4. 窄窗口打开个人信息面板时首帧跳变（≤1150px）

原先 `:has(.personal-panel[data-open='true'])` 会在第一帧直接切换聊天区宽度、输入区宽度和简历提示的显隐，而聊天栏宽度要过 240ms 才收完。改法：

> 当前状态补注：用户本轮已要求退役 composer 上方旧简历条，下面 `.resume-chip small` 的提示动画仅为历史说明，不再恢复；删除范围、资料兼容与回归以 [Mac 1.3.6 交接 T12](MACOS_1.3.6_HANDOFF.md) 为准。

- `.chat-thread` 和 `.composer-area` 加 `width` 过渡。Chromium 会把 `min(...)` 和 `calc(...)` 按动画中的实际容器宽度逐帧插值，所以宽度连续变化；逐帧验证入口为 `client-update-ui-smoke`。
- `.resume-chip small` 从 `display: none` 改为：
  - `interpolate-size` 下宽度从 `auto` 过渡到 0；
  - 用 `margin-inline-start: -8px` 抵消 flex 的间距；
  - 透明度和 `visibility` 按方向分别设置时长和延迟。
- `.welcome h1` 的覆盖规则与基础值相同，没有跳变，所以未改。

### 5. 侧面板边框

`.personal-panel` 和 `.record-answer-panel` 收起时 `border-width: 0`，但后定义的 `transition` 列表里没有 `border-width`，导致 1px 边框在第一帧消失。已补入过渡并相应调整 `transition-delay` 列表。透明度同时改为 `--panel-motion-exit-duration` 加主曲线。

注意：`styles.css` 中较早的一条 `.personal-panel` transition 规则已被后面的规则完全覆盖，本次没有清理它。

### 6. 弹窗（`components/ui/modal-motion.css` 与 `.ts`）

- **入场：** `modal-fade-in` 改为透明度加 `translate: 0 8px → 0`，背景遮罩改用独立的 `modal-backdrop-fade-in`，只做透明度变化。用 `translate` 而不用 `scale`，是因为很多逻辑依赖 `getBoundingClientRect`，平移不改变测量尺寸，缩放会改变：
  - `useHeightTransition` 测量弹窗高度；
  - `AnimatedCollection` 的 `resizeDialog`；
  - `switchView` 的裁切计算。
- **原生输入框：** `ApiKeyDialog` 仍按名称等待 `modal-fade-in` 结束后才放置原生输入框，所以名称保持不变；Windows 原生验证入口为 `api-key-dialog-native.mjs`。
- **退出：** `modal-fade-out` 为透明度加 `translate: 0 0 → 0 4px`，时长取 `--panel-motion-exit-duration`（180ms）。`modal-motion.ts` 的移除计时器也改读这个参数。

### 7. 打断后的续播（新增 `components/ui/motion-continuation.ts`）

**问题：** Web Animations API 的动画被新目标打断后，会从当前位置以完整时长、静止起步重新开始，表现为「停一下再加速」或反向时拖沓。CSS 过渡反向时浏览器会自动缩短时长，WAAPI 没有这个行为。

**算法：**

- `runningMotion(animation, travel)`
  - 在取消旧动画**之前**调用。
  - 从 `effect.getTiming()` 读出时长、延迟和缓动，从 `getComputedTiming().localTime` 读出当前时刻。
  - 用三次贝塞尔求出当前时刻的进度斜率，换算成沿 `travel` 方向的速度（单位：位移/毫秒）。
  - 支持 `cubic-bezier()` 以及 `ease`、`linear` 等关键字。在延迟期内或动画已结束时，速度为 0。
- `continuedTiming(timing, running, next)`
  - **时长：** `D × min(1, 剩余距离 / 上段行程)`，下限为 `min(D, 120ms)`，不会把原本短于 120ms 的动画拉长。普通 240／340ms 动画的下限为 120ms。
  - **同方向续播**（携带速度沿新方向的分量 > 0）：保留原曲线的 x1、x2、y2，把 `y1` 设为 `x1 × 携带速度 × 新时长 / 剩余距离`，上限 1。在限幅及数值精度允许的范围内衔接当前速度；测试不能要求所有极端速度都无条件精确连续。
  - **反向：** 沿用原曲线，从静止开始，只缩短时长。

**接入位置：**

- `useHeightTransition.ts`：Track 记录 `from`。
- `useNoticeStackMotion.ts`：Position 记录 `start`。
- `ActionTransition.tsx`。
- `AnimatedCollection.tsx`：只用于普通位移分支，按节点记录 `travel`，`cancel()` 时清除。

**架构：** `check-architecture.mjs` 允许 `useHeightTransition` 依赖 `motion-continuation.ts`，同时规定 `motion-continuation.ts` 不得依赖其他模块。`architecture.test.ts` 增加了对应用例。

### 8. 撤回的项

思考标题流光（`reasoning-title-shine`）我曾改为 `ease-in-out`。但 `chat-progress-smoke` 和 `shimmer-smoke` 明确要求匀速扫过，并把慢起步判定为停顿。这是既定设计，所以恢复为 `linear`。转圈加载保持 `linear` 是正确的。

### 9. 长对话布局性能（未优化）

定向验收负载为 300 条合成长消息，在 1280px／880px 窗口比较侧栏和个人信息面板动画；120Hz 条件仅在本机屏幕支持时复核，运行数据只留终端／对话。

- 空对话与长对话分别验证，不能用空对话推断长对话的布局开销。
- 原因：这些动画改变的是 `width`、`margin` 等布局属性，每一帧都要重新排版整段对话。
- 可选的优化方向：给屏幕外的消息加 `content-visibility: auto`。但它会影响聊天的滚动跟随、定位高亮和记录页滚动，风险较大，用户尚未决定，所以没有做。

### 动画相关文件

- 样式：`shared/src/styles.css`、`components/recordingPlayer.css`、`components/ui/{page-motion,content-reveal,modal-motion}.css`
- 逻辑：`components/ui/{modal-motion,useHeightTransition,useNoticeStackMotion,AnimatedCollection,motion-continuation}.ts(x)`、`components/ActionTransition.tsx`
- 测试：
  - 新增 `test/unit/motion-continuation.test.ts`
  - `test/unit/interview-height-transition.test.ts`：模拟的播放器带上 effect，并断言反向时长减半
  - `test/scripts/client-update-ui-smoke.mjs`：新增断言，打开面板时输入区宽度不能先变宽再收窄
  - `test/scripts/profile-selection-smoke.mjs`：等入场动画结束后再测量标题位置，断言本身不变
  - `check-architecture.mjs`、`architecture.test.ts`

---

## 二、Kimi（`api.moonshot.cn/v1/responses`）

**实现原因与保护项：**

- **等待与长推理：** 服务端首字前等待和长推理可能持续较长时间，默认思考强度为 `max`；需要保留可见的处理状态及取消能力，不能用短缓冲窗口截断资料生成。
- **严格解码：** 必须保留。Kimi 的 `json_schema` 严格模式会按字母序输出字段，所以技能的 `title` 在 `content` 之后，这无法改变。只靠提示词约束 schema 不能保证长推理仍输出 JSON，因此撤回提示词单独约束的方案。

**修改：**

- `api/service.ts` 的 `kimiFailure`：
  - 流式响应可能是 HTTP 200 加流内 `error` 事件，原因写在 `code` 字段，`type` 只是事件名。现在 `rate_limit_exceeded` / `rate_limit_reached_error`、`exceeded_current_quota_error`、`engine_overloaded_error` 都能识别。
  - 限流时只从原文中读取 RPM、TPM、TPD 或并发数，以及上限数字，生成「已达到 Kimi 账户的每分钟请求次数上限（3 次）…」这类提示，不转发服务商原文（原文里带账户标识）。
- `chat/service.ts`：`apiKeyEndpoint.profileRecovery?: 'preview'`，`kimi.ts` 设为 `'preview'`。
  - 资料格式出错时改为可见地重新生成。
  - 不再走 25 秒的缓冲重试窗口，长推理时会因为 `AbortSignal.timeout(25000)` 报 `request_timeout`。
- `kimi.ts`：保留 `nativeProfileFormat: true`，并加注释说明原因。
- `styles.css`：`.response-steps li` 改为 `.response-steps > li`。原规则让思考过程里的 Markdown 列表也套用步骤行的网格布局，导致窄栏里每行只显示一个字。`chat-progress-smoke` 增加了对应断言。
- 测试：`test/unit/api-chat.test.ts` 增加了可见重新生成和流内错误事件的用例。

**其他：** DeepSeek 只有 `json_object` 模式，开启网页工具时不能指定非文本格式。它用自己的文本协议（意图标记、Markdown、`<profile_proposal>`），本身就能处理纯文字回复，不需要严格解码。这一点只做了说明，没有改代码。

---

## 三、Gemini（`generativelanguage.googleapis.com/v1beta`，`api/gemini.ts`）

### 1. 503 与 429 自动重试

- `send()` 替换原来的 `checked()`，用于模型目录请求和生成请求。
- 只在收到任何内容之前、对失败状态重发：
  - 503：分别在 1 秒和 3 秒后重发；
  - 429：只有附带 `google.rpc.RetryInfo`、且等待时间不超过 15 秒时才等待重发；与 503 共用最多两次重发的上限，每次等待取 RetryInfo 与该次 1 秒／3 秒基准等待中的较大值。这里的短等待重试与下一节仅切换一次的搜索降级是两层机制。
- 等待通过 `pause()` 响应取消信号。
- 重试期间推送状态 `{id:'gemini-retry', phase:'processing', detail:'模型服务繁忙，正在自动重试'}`，完成后标记为「已自动重试」。
- 状态用 `processing` 而不用 `waiting`，因为 `profileRecovery` 会改写 `waiting` 的 `detail`。
- 状态行会被后续状态替换，这是 `mergeActivityLog` 的规则。

### 2. 搜索额度用完时改为不联网

**问题与原因：** 带 `google_search` 的请求可能因搜索额度在收到内容前返回 429 `RESOURCE_EXHAUSTED`，且不附带 QuotaFailure 或 RetryInfo，而同一模型的不联网调用仍可能可用。准备聊天固定请求 `webSearch: true`（`stores/preparation.ts`），若不区分搜索额度与模型可用性，就会连不联网回答也一并阻断。

**修改：**

- 带搜索的生成请求在收到内容前返回 429 时，用 `bodyFor(..., false)` 去掉搜索、改用 `noWebSearchInstructions` 重发一次。
- 推送状态「Google 搜索额度已用完，改为不联网回答」，并返回 `warning`：「Google 搜索额度已用完，本次未联网回答。」
- 解析 grounding 时改用实际状态 `searched`。
- 并行工作在 `stores/preparation.ts` 里过滤掉了这条 warning，所以底部不显示它，这是他们的决定。
- 如果不联网重发后仍是 429，就报出模型本身的限额错误。

### 3. 原生结构化输出

**问题：** Gemini 原来只靠提示词约束格式（`profileSchemaInstructions`），不能保证低思考强度下始终输出合格 JSON，可能导致「资料更新提案不完整」；因此资料请求需要原生结构化输出约束。

**修改：**

- `GeminiModel.nativeProfileFormat = /^gemini-(?:[3-9]|[1-9]\d+)[.-]/`，即 Gemini 3 及以上。
- 资料请求加上 `generationConfig.responseMimeType: 'application/json'` 和 `responseJsonSchema: profileFormat.format.schema`，与 Kimi 严格解码共用同一份 schema，并且不再拼接提示词版 schema。
- Gemini 2.x 保持提示词方式，因为 2.x 的结构化输出不能和搜索工具同时使用。

**结构化输出与解析边界：**

- 资料输出使用共用 schema 的 `answer`、`changes`、`skillScope` 字段，解析不得依赖某次流式响应的分片数量或时序。
- `ProfileAnswerStream` 需要支持缩进 JSON（例如 `{\n  "answer": "`）及字符串中间被切开的分片；对应单测保留这些格式边界。

**独立待验：** 结构化输出和 Google 搜索同时使用仍需单独验证；若遇 400，应核对具体兼容性并按第五、六节的范围处理，不能把尚未实现的 schema 自动回退当成当前功能。

**测试：** `test/unit/gemini-api.test.ts` 新增了以下用例：

- 503 在 1 秒和 3 秒时重发；
- 重试上限、取消时不再重发、错误信息不含服务商原文；
- 429 只在等待时间较短时重发，模型目录同样会重试；
- 400 不重试；
- 搜索额度用完时改为不联网，以及改用后仍然失败的情况；
- 3.x 使用原生 schema，面试请求和 2.5 不使用。

另外，`contracts/uiMessages.ts` 增加了以下四条文案的英文翻译：重试中、已重试、搜索额度用完改为不联网、本次未联网回答。

### 服务商验证方法

以下仅为需要当次授权的验证方式，由用户在自己的终端里运行临时脚本，不代表已执行：

- 脚本放在会话临时目录，用 `powershell -NoProfile -ExecutionPolicy Bypass -File`。
- 用 `Read-Host -AsSecureString` 隐藏输入密钥，密钥只在子进程里使用，结束时清除。
- 只输出状态码、`quotaId`、字段顺序和合成内容的预览。
- 结束、失败或取消后删除临时脚本并清理相关状态。
- 注意：Google 的 SSE 使用 `\r\n` 分隔事件。

---

## 四、验证入口与依赖

- 共享单元、类型和架构检查按当前平台入口执行；本轮单元排程与旧 RAG 评测集排除方式见 [Mac 交接 V02](MACOS_1.3.6_HANDOFF.md)，不能将入口清单当作通过记录。
- 动画相关界面回归入口：`client-update-ui-smoke`、`components-ui-smoke`、`interview-chrome-smoke`、`floating-smoke`、`settings-smoke`、`history-branding-smoke`、`chat-progress-smoke`、`shimmer-smoke`、`ui-alignment-smoke`、`conversations-smoke`、`login-entry-smoke`、`composer-resize-smoke`、`announcement-ui-smoke`、`delete-controls-smoke`、`updates-sidebar-smoke`、`recording-smoke`、`language-smoke`、`profile-ui-smoke`、`profile-selection-smoke`、`interview-motion-smoke`、`ui-ux-smoke`、`ui-refinement-smoke`、`ui-material-refinement-smoke`、`typography-smoke`、`web-materials-smoke`、`provider-ui-smoke`、`interview-ux-smoke`、`shortcut-settings-smoke`、`settings-location-smoke`、`history-scroll-smoke`、`knowledge-smoke`。
- Windows 原生密钥框验证入口为 `api-key-dialog-native.mjs`，不能用静态 React 检查代替。
- 夹具错配核对：`account-profile.test.ts` 的 Gemini 原生目录格式若被旧夹具错误处理，可能包装为 `network_error`；`source-favicon.test.tsx` 必须与 `index.html` 的精确 `https://www.gstatic.com` 图片白名单保持一致。具体原因及修复颗粒度见第六节，不据此回退产品协议或放宽安全来源。
- `rag-ui-smoke` 依赖已就绪的本地知识库组件，否则「创建知识库」按钮按既有规则禁用；仅用本轮新建合成资料验功能，不调整检索参数或运行旧准确率集。
- `account-transfer-smoke`、`cloud-account-smoke`、`account-erasure-smoke`、`password-policy-smoke` 依赖 `VOXCUE_TEST_SERVER_ROOT` 指向 0.5.3 版服务端 `3bceb61` 的干净固定参考，独立于新版服务端专项。

## 五、待办

1. **Mac 本机验收：** 动画（弹窗位移、交叉淡变、窄窗口面板）以及 Kimi、Gemini 的界面。Mac 原生密钥输入框需要确认在入场上移结束后才放置。
2. **结构化输出加搜索：** 搜索额度恢复后，实测 Gemini 3.x 同时使用两者。若返回 400，可以在出现 400 时去掉 schema 重发，或在带搜索时退回提示词方式。
3. **长对话掉帧：** 是否用 `content-visibility: auto` 优化，需要用户决定，并配合滚动相关的回归测试。
4. **Gemini 429 提示：** 目前只显示笼统的「已达到调用限额」。如果 Google 带上了 QuotaFailure，可以参照 Kimi 写明限额类型。注意搜索额度的 429 不带任何细节。
5. **提交：** 本次改动和并行工作混在同一工作区，提交前要按功能分开整理，并由用户授权。

---

## 六、双方合并后的接续边界与验证颗粒度

### 1. 接入与界面的共同基线

下列内容与前述动画、恢复及结构化输出修改共同构成当前实现，不能为了迁就旧夹具撤回其中一层。

| 范围 | 当前约定与保护项 | 主要实现及验证入口 |
|---|---|---|
| API 服务 | 顺序为 OpenAI、Gemini、DeepSeek、Kimi；沿用验证、启用／禁用、更换、移除流程，当前使用的服务动作是「禁用」 | `contracts/apiConnections.ts`、`ApiConnectionPanel.tsx`、`api-connection-ui.test.tsx`、`api-connections.test.ts` |
| Kimi 余额 | 设置与面试账户用量均显示两位小数，不能只修一个位置 | `AccountUsageSummary.tsx`、`services/accountUsageSummary.ts`、`api-interactive-preview.mjs --provider-logos --check-only` |
| 搜索范围 | 准备聊天只用所选服务商及模型支持的官方搜索，不跨服务商兜底；面试请求 `webSearch: false`，Gemini 不发送搜索工具 | `ipc/interview.ts`、`api/gemini.ts`、`api/kimi.ts`、`gemini-api.test.ts`、`api-chat.test.ts` |
| 密钥输入 | 凭据留在主进程；原生框在 `modal-fade-in` 完成后显示和定位，Windows 按当前主题绘制首帧 | `ApiKeyDialog.tsx`、`windows/native/ApiKeyPrompt.cs`、`api-key-dialog-native.mjs`；不能用静态 React 测试代替原生验收 |
| Google 来源 | 搜索建议紧接「用时」分割线，随后是普通来源和正文；建议始终展开，普通来源超过三条仍可折叠 | `PreparationMessage.tsx`、`ChatSources.tsx`、`google-search-suggestions.test.tsx` |
| Google 隔离 | 保留返回的 HTML 和链接，在禁用脚本的 iframe 中显示；链接走受控打开接口；图片只允许精确来源，主页面 `connect-src 'self'` 不变 | `GoogleSearchSuggestions.tsx`、`shared/index.html`、`source-favicon.test.tsx`、API 界面回归的脚本／跳转隔离检查 |
| Google 布局 | 外层底板、阴影及装饰渐变不显示，上下间距 8px；隔离页面声明浅深色支持；高度兼顾实际内容和 `body.scrollHeight`，避免高 DPI 竖向溢出 | `GoogleSearchSuggestions.tsx`、`googleSearchSuggestions.css`；以实际主题和原始样例的绘制结果检查 |
| Google 图标 | 固定 28px 居中槽，保留两套 SVG 及深色白圆；深色图形 28px，向下补偿 0.64px，使彩色 G 中心和首条查询起点跨主题对齐 | 测有色 path 的联合可见边界／中心与首条 chip 坐标，不能只比较两个 SVG 的外框左边或用白圆边界代替彩色 G |
| 气泡 | 准备聊天用户消息，以及面试转写、提问、回答统一为上下 8px、左右 12px；图片提问和面试预览继承同一尺寸 | `styles.css` 的相应选择器、`composer-smoke.mjs` 及面试真实布局；不回滚同文件中的动画修改 |
| 面试外观 | 实际面试和两种面试预览固定深色，准备聊天支持浅深主题 | `interviewAppearance.ts`；不能为补浅色面试截图更改 `interviewAlwaysDark` |
| 搜索数据生命周期 | 建议／来源元数据仅在内存保留；Google 联网正文按现有规则最多保留 730 天，只供历史查看，不进入后续模型上下文；替换、丢弃、停止后的迟到事件遵守请求归属 | `services/chats.ts`、`services/preparation.ts`、`stores/preparation.ts`、`chat-storage.test.ts`、`profile-store.test.ts` |

**底部提示的层次区别：** 用户确认隐藏的只有完整文案「Google 搜索额度已用完，本次未联网回答。」。`stores/preparation.ts` 在展示前按行过滤它，组合中的知识库警告和其他模型提示仍保留。后端仍返回该 warning，保留降级过程活动和 `noWebSearchInstructions`；`gemini-api.test.ts` 继续断言后端 warning，`profile-store.test.ts` 断言底部不显示，两者并不冲突。不能用删后端 warning、删除所有 warning 或伪造已联网状态来满足界面要求。

### 2. 单行正式组件与两行排版预览

- 当前正式组件保留 Google 返回的 carousel 布局，没有加入生产自动换行。聊天中展示的两行截图来自显式隔离的临时排版预览，额外搜索词和回答为合成数据，不是已接通的正式换行功能或真实服务商结果。
- 历史限制：永久 API 界面夹具曾使用 `.suggestions` 简化合成片段，只能检查隔离、链接、主题和外围顺序，不能证明官方两套 SVG 的光学对齐。**本轮已替换该路径**：`shared/test/fixtures/google-search-suggestions.html` 为实际消费的官方完整 `renderedContent` 结构，夹具提取首 chip 链接／文字并按官方 `.container`／`.chip`、两套 SVG 验证，详见 [Mac 1.3.6 交接 T13](MACOS_1.3.6_HANDOFF.md)。不再恢复旧简化展示；官方样例所属 API 已弃用，本轮仅复用其公开 HTML 结构，不恢复旧 API。光学位置仍按同一窗口／主题／缩放的实际可见路径核对。
- 比较浅深主题时保持同一窗口尺寸、DPI、缩放和排版模式，检查彩色 G 的中心及首条搜索词起点。单行与两行原型分别比较，不能把两个排版模式的基线混成一个断言。
- Playwright 默认浅色模拟可能覆盖子 iframe 的媒体查询。实际主题回归先清除 `colorScheme` 模拟，再用应用菜单切换主题并等布局稳定；同时检查子页面主题、chip 颜色和透明底板的实际绘制，不能仅检查父页面 `.dark` 或 CSS 中写有 `transparent`。

### 3. 按层验证，避免把不同问题混为一次修复

| 层次 | 必须分开的场景与判据 | 验证入口 |
|---|---|---|
| 动画算法 | 同向携速、反向按行程缩短、延迟中／已结束无旧速度；取消前读取旧动画。数值算法与组件接入分别验证 | `motion-continuation.test.ts`、`interview-height-transition.test.ts` |
| 动画过程 | 页面位移与透明度是不同动画；旧标签前 40% 淡出、新标签延后 15% 淡入；窄窗口宽度与间距逐帧连续；思考流光和转圈仍为 linear | `client-update-ui-smoke.mjs`、`chat-progress-smoke.mjs`、`shimmer-smoke.mjs`、提示及面板相关 GUI 回归 |
| 稳定几何 | 标题、粘性区域、文字选择和气泡尺寸先等入场完成再测；与前一行的逐帧测试分开。保留 `screen-enter`、`screen-exit`、`modal-fade-in` 等生命周期依赖名称 | `profile-selection-smoke.mjs`、`composer-smoke.mjs`、设置／记录界面回归 |
| Kimi 协议与恢复 | 严格 schema、默认／显式思考、准备搜索／面试不搜索、HTTP 错误／HTTP 200 流内 error、脱敏、可见格式重试和取消分别覆盖；不恢复 25 秒私有缓冲窗口 | `api-chat.test.ts`、`api/kimi.ts`、`chat/service.ts` |
| Gemini 格式 | 3.x 资料请求的原生 schema、2.x 提示词 schema、面试无资料 schema；JSON 缩进、字符串跨 SSE chunk、CRLF 事件分隔分别覆盖 | `gemini-api.test.ts`、`api/gemini.ts`、共用资料流解析测试 |
| Gemini 重试与降级 | 模型目录／生成、503 上限、短／长／无 RetryInfo 的 429、400 不重试、收到正文后失败、取消分别覆盖；短等待重发与带搜索→不带搜索的一次切换分开计数 | `gemini-api.test.ts` |
| 搜索真实性 | 有实际 grounding、没有 grounding、建议缺失丢弃、搜索降级、普通回答、只隐藏指定底部提示分别覆盖；不因打开了工具便声称执行过搜索 | `gemini-api.test.ts`、`profile-store.test.ts`、Google 来源 GUI 回归 |
| 上层账户集成 | 每个供应商自己的目录、鉴权和响应格式；缓存与强刷、重启、账户归属、独立用量分别验证 | `account-profile.test.ts`、`api-connections.test.ts`、`api-interactive-preview.mjs` |
| 原生与平台 | Windows 原生密钥框和 GUI 串行使用合成资料；Mac 保持待本机验收；有服务端／组件依赖的测试与普通 UI 分开列出 | `api-key-dialog-native.mjs`、前述 GUI 入口及第四节依赖说明 |

不得把某一层的通过外推成服务商真实兼容性、全部平台、全模型或整体性能的通过。真实服务实测也不能代替取消、迟到事件、严格解析和账户隔离的可重复测试。

### 4. 当前静态核对发现的夹具／断言错配

以下是接续时应优先核验的具体线索。本次联合阅读没有修改这些测试或产品代码，也没有复跑第四节中的全量测试。

1. **账户目录夹具：** `account-profile.test.ts` 的跨供应商测试在首次截断目录时统一执行 `page.data.slice(0, 1)`，但 Gemini transport 返回 `{ models: [...] }`。mock 内的 TypeError 可被请求层包装成 `network_error`。先核对各供应商 wire 格式；不要为此把 Gemini 产品目录改成 OpenAI 格式、删除 Gemini 用例或降低缓存／强刷断言。该测试后续选到的第二个 Gemini 模型是 2.5，仍不能代替 3.x 原生格式覆盖。
2. **原生 schema 夹具：** `api-interactive-preview.cjs` 仅根据 system 提示词是否含 `JSON Schema` 决定返回 JSON，而 Gemini 3.x 已使用 `generationConfig.responseMimeType`／`responseJsonSchema` 且不再拼接提示词 schema。旧夹具可能错误回纯文字。先让夹具理解真实请求能力，不能为通过它撤掉原生结构化输出或恢复重复提示词约束。
3. **图片 CSP 断言：** `source-favicon.test.tsx` 仍精确期待旧三项 `img-src`，当前主页面和 Google 隔离文档已允许精确 `https://www.gstatic.com`。应分别保留 favicon hostname 校验、无 referrer、精确图片白名单和 `connect-src 'self'` 等约束，不能删掉 Google 所需 origin 或改成任意远程 origin 来迁就断言。

### 5. 后续操作边界

- 本轮是联合交接核对，不新增服务商密钥实测、提交、推送、发行或部署授权；旧文档的实测方法不自动转成待执行命令。
- 后续测试先核对当前 diff、所测层次、夹具请求／响应和动画所处阶段，再定位最小修复。若是夹具落后，修夹具并保留原业务断言；若是产品回归，修具体分支或选择器，不整文件回退，不放宽失败断言。
- `shared/src/styles.css`、`chat/service.ts`、`gemini.ts`、`stores/preparation.ts` 等同时包含双方修改。不能因文件属于某个功能而覆盖其中另一功能的修复。
- Gemini 3.x 原生 schema 与 Google 搜索的真实组合、Mac 本机、外部服务端依赖及长对话性能优化继续按第五节区分待验与待决定。schema＋搜索的 400 自动回退尚未实现，`content-visibility: auto` 也未获采用，不得为跑通旧夹具擅自加入。
- 测试结果仍仅留终端／对话；本节只保存行为基线、验证入口和未决边界，不累积本轮成绩、截图或运行产物。
