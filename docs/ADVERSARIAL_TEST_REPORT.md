# VoxCue 对抗性与稳定性测试报告

日期：2026-10-15。对象：当前工作树、根目录构建，以及 v0.1.0 安装包使用的 `release/installer-stage/VoxCue-win32-x64/VoxCue.exe`。本轮只增加测试证据和文档，没有修复业务代码、更新依赖或发布新包。所有账户、资料、损坏快照和网络故障均为隔离合成夹具，未修改真实用户目录。

## 后续修复复验：v0.1.1（2026-10-15）

用户随后明确“修复之后再打包”。F1–F5 已修复：错误正文加入取消/空闲超时/64 KiB上限；历史记录校验内层字段，失败时保留数据并显示错误；聊天快照在读取与 Store 恢复时按白名单构造；六条聊天路由拒绝子 frame/缺失 frame；重载取消并退休旧请求槽，旧服务即使忽略取消也不能发送事件或返回成功。

原39项探针不改断言全部通过（diagnostics-fixed.json），新增8项回归并入默认套件，41文件279项通过，129模块零越层/环，typecheck/build通过。依赖安装/编译并发期间曾出现原PDF测试5秒超时；安装与编译结束后，完整套件在原门槛下通过，没有延长时限或删除断言。未提权运行的localhost用例曾被沙箱EACCES拒绝，正常本机权限重跑通过，不作为产品故障。

实际Electron三组UI回归及原聊天保存/关闭/重启回归通过（adversarial-fixed-sCgSwz、chat-lifecycle-TQbYXM）。新安装目录同样通过三组UI检查（adversarial-fixed-ykNPXh）与Copilot五组（copilot-ui-u4Jut9），Renderer错误0。最终安装包、原生组件与更新验证以PROGRESS最新节及test-results/release-v0.1.1为准。

修复包已发布为[v0.1.1](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.1.1)。安装目录真实Paraformer Worker/utilityProcess/原生助手与离线资料模型/DOCX/PDF/三种检索、重启/删除通过（portable-current-JVsGYo）；仅sharp0.35.5，无旧sharp/sprintf-js。50轮取消竞态残留0，更新驱动完整包下载SHA512与坏包拒绝通过（updates-native-LtQqAs）。公开API逐项确认三项资产大小/服务端SHA256与本地一致、latest状态正确，实际下载公开latest.yml哈希一致。发布截图和复验汇总在release-v0.1.1，未上传旧包或私有源码。

依赖四条告警已通过去除未调用的传递依赖解决：LanceDB自带的可选transformers/OpenAI提供器未使用，本应用自己的固定文本Embedder继续保留；Mammoth的argparse只服务其独立CLI，VoxCue的extractRawText路径不使用。pnpm overrides与打包复制使用同一排除设置，未改变业务功能或通过审计ignore忽略公告。修复后生产依赖audit返回全部0，锁文件保留。打包 smoke 增加ASAR实际版本/目录检查，防止仅顶层更新、嵌套旧包仍被复制。原生组件测试继续验证DOCX/PDF与本地Embedding，不以移除功能声称修复。

以下为初测历史证据和当时限制，不代表v0.1.1仍存在同样缺陷。

结论：原有回归通过，新增对抗测试确认 **5 处应用缺陷**，另有 **4 条生产依赖安全公告**。不能据此认定当前版本已通过完整安全验收，建议修复后再公开发布。下文 P2 表示应修复的功能/防御缺陷；依赖公告自身的 high/moderate 不等于已证明应用可被利用。

## 已确认的应用问题

### F1：HTTP 错误响应的正文缺少空闲超时（P2）

- 位置：`electron/backend/chat/service.ts:88`，`checked()` 对非 2xx 响应直接等待 `response.json()`。请求头计时在返回响应头后已清除，正常 Responses 流的空闲计时尚未进入。
- 复现：本机 HTTP 服务立即返回 502 与 `application/json`，写出 `{"error":` 后保持连接；实际 ChatGPTService 使用此服务，空闲和请求头上限均配置为 25 ms。200 ms 后请求仍未结束；同组正常 200/SSE 静默响应按配置超时。
- 影响：代理或上游错误页卡住时，聊天会持续等待，并占用准备聊天的唯一原生请求槽。手动取消仍可释放。
- 边界：测试缩短了可配置时限，没有把 200 ms 当作生产默认时限；生产默认空闲上限为 300000 ms，此错误正文路径没有使用它。
- 建议：非成功响应也使用有取消、空闲时间及字节上限的正文读取；保留现有错误脱敏。

### F2：内层损坏的面试记录让整个界面变空（P2）

- 位置：`src/services/history.ts:33` 只检查 `answers`/`transcripts` 是数组；`src/components/HistoryPage.tsx:114` 随后直接访问答案的 provider。
- 复现：仅在隔离 localStorage 写入外层有效、`answers:[null]` 的一条记录，点击“面试记录”。实际安装版出现 `Cannot read properties of null (reading 'provider')`，React 根节点清空，侧栏也消失。已保存空白截图。
- 影响：单条异常记录阻断整个当前窗口，没有可见的损坏数据说明或恢复入口；损坏原数据仍在。
- 建议：加载时逐项验证，隔离异常记录并保留原始数据；增加界面错误边界，避免整窗口退出渲染。不要自动删除历史。

### F3：聊天快照的额外字段可覆盖 Store 动作（P2）

- 位置：`src/services/chats.ts:102` 和 `src/stores/preparation.ts:90` 两次展开存储对象，没有按允许字段重新构造状态。
- 复现：在隔离 IndexedDB 的结构有效快照中加入 `send:"corrupted-string"`，重载，输入文字并发送。实际安装版报 `l.send is not a function`，输入保留但无法发送；加载阶段没有显示聊天数据损坏提示。
- 影响：异常或被篡改的本地字段污染动作/运行时状态。此用例要求本地快照发生特定异常，不证明远程模型能写入此字段。
- 建议：读取与恢复均采用明确字段白名单，校验嵌套消息/选项/附件；不可将持久化对象直接展开进带函数的 Store。

### F4：准备聊天六个 IPC 路由缺少主 frame 校验（P2，防御缺口）

- 位置：`electron/ipc/chat.ts:24` 起的 models、usage、usage-reset、send、cancel、open-link；其 `requireMain` 在 `electron/main.ts:370` 只比较 WebContents。
- 复现：调用实际注册的 chat:models 处理器，保留合法主窗口 sender，换成不同 senderFrame；处理器仍返回模型，并调用模型端口。另一个窗口 sender 被正确拒绝。更新、知识库、面试等路由已有 frame 校验。
- 影响：若子 frame 获得 IPC 发送能力，以上路由不能在主进程拒绝它，违反既定主 frame 边界。
- 边界：这是处理器层的确定性测试。现有沙箱、preload 和导航限制仍在，本轮未证明任意远程网页能获取该 IPC 能力，不能称为已复现的远程越权或凭据泄漏。
- 建议：六个路由在服务调用前统一验证主窗口与主 frame，并补齐拒绝测试。

### F5：回答时重载窗口，旧请求占住聊天槽（P2）

- 位置：`electron/main.ts:271` 的主窗口 did-start-loading 只释放听写；聊天请求的生命周期位于 `electron/ipc/chat.ts:53`。
- 复现：通过正常界面启动一条受控延迟回答，重载主窗口。持久化恢复将回答显示为“已停止”，但原生 AbortSignal 未取消；新的实际 IPC 发送返回“请等待当前回答完成或停止后重试”。随后通过旧请求 ID 显式取消才释放。
- 影响：界面与后台状态不一致，用户失去旧请求的停止入口；新聊天被阻塞到旧回答完成或超时，重载后迟到内容也不能继续归属原界面订阅。
- 建议：明确重载语义。如果恢复为停止，须同时取消主进程对应请求；若要继续生成，需恢复请求订阅与停止能力。保留已收到文字，不能删除聊天来解决。

## 依赖审计告警：已确认被打包，未证明应用可达利用

`pnpm audit --prod --json` 返回 3 high、1 moderate。ASAR 清单独立确认打包了 LanceDB 的嵌套 `sharp@0.33.5`、其 Windows 原生插件，以及 `sprintf-js@1.0.3`。顶层 `sharp@0.35.5` 已较新，但不会替换嵌套旧版本。

| 依赖 | 公告 | 公告等级 | 公告修复版本 |
| --- | --- | --- | --- |
| sharp 0.33.5 | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)，libvips | high | ≥0.35.0 |
| sharp 0.33.5 | [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)，libheif | high | ≥0.35.4 |
| sharp 0.33.5 | [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)，librsvg | high | ≥0.35.5 |
| sprintf-js 1.0.3 | [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)，精度格式造成拒绝服务 | moderate | 审计未给已发布修复版 |

当前业务使用文本特征提取，没有找到对用户图片调用这份旧 sharp 的代码；sprintf-js 路径来自 mammoth 的 argparse。部分公告描述特定 Linux 条件，不可直接推广为当前 Windows 软件的 RCE。建议检查并消除不使用的传递依赖，或在兼容性验证后升级/约束版本，再复核实际安装包；不要只更新顶层版本。

## 已通过的验证与稳定性结果

| 项目 | 本轮结果 |
| --- | --- |
| 架构 | 128 模块，越层/运行时环均为 0 |
| 类型与构建 | 三组 TypeScript 检查、完整 build 通过；保留既有 695.74 KB 前端分块提示 |
| 原有单元回归 | 40 文件、271 项通过，包含 Markdown HTML/危险链接隔离、凭据错误脱敏、资料提案确认、工具与持久化边界 |
| 新增对抗探针 | 39 项中 35 通过、4 失败；四条失败断言原样保留，对应 F1–F4 |
| 实际安装版输入 | 7 个无效 IPC 请求均在 AI 端口前拒绝；Renderer 没有 Node/process/任意 invoke |
| 连续 IPC | 300 次顺序请求全部完成，正文事件和请求 ID 各 300，无串写 |
| 界面恢复 | 15 轮发送/重载，30 条消息均保留 |
| 并发/取消/迟到 | 50 轮：重复发送拒绝、错误 ID 不取消、正确 ID 取消、迟到正文阻止均通过，测试后台残留 0 |
| 聊天生命周期 | 实际 IndexedDB 保存失败保留窗口；进程重启恢复草稿/附件/正文，删除和退出重登录保留语义通过，3 组 |
| 面试工作流 | 设备错误/权限阻止、释放、设置锁定、临时/终稿去重、麦克风不触发问题、公开摘要、结束确认等 13 组通过 |
| Copilot | 实际安装目录官方 runtime 1.0.97、SDK 1.0.21 的系统凭据库配置、PKCE 生成/取消通过；合成适配器与切服务等 5 组通过 |
| 更新故障 | 检查/下载/重试、权限、面试阻止安装、保存失败阻止更新、保存后重启等 7 组通过；未执行线上更新 |
| 语音故障 | 损坏模型拒绝且不回退 Mock；真实 Worker 崩溃和本测试的采集子进程崩溃均释放采集，错误可见 |
| 语音持续运行 | 600.211 秒真实 ASR/VAD，双通道合成 PCM 共 1200.064 秒；最大排队 320 ms，终稿 177/临时事件 1548，错误 0，结束线程 ID -1 |
| 语音重复释放 | 12 次加载/静音输入/冲刷/终止；1200 帧均确认，所有线程终止，错误 0 |

内存观测：持续语音进程 RSS 首个样本 347.18 MiB，末样本 365.48 MiB；12 次独立 Worker 循环后父进程 RSS 54.73→58.30 MiB；安装版 15 轮重载的已采样主进程 RSS 143.23→144.08 MiB。存在缓存/分配增长，本轮没有证据将其定性为泄漏，也不能外推数小时稳定性。不同测试进程的 RSS 不可相加，界面数据只代表主进程。

额外性能观测：合成 Markdown 1000/4000/16000 个问题标题（约 54/219/885 KB），真实 parseText 耗时约 24/103/1245 ms。标题路径重复遍历历史标题，呈明显超线性增长；没有设置性能合格阈值，也未验证取消后整个 utilityProcess 的阻塞，所以作为后续压力测试线索，不计入五个已确认缺陷。

## 证据与复现

本轮原始证据集中于仓库 `test-results/adversarial-20261015/`，包含：

- `diagnostics.probe.ts`、`vitest.config.mjs`、`diagnostics.json`：F1–F4 的失败断言和通过项。独立执行 `pnpm exec vitest run --config test-results/adversarial-20261015/vitest.config.mjs`，当前预期退出 1；未纳入默认回归或删除失败断言。
- `desktop.mjs`、`desktop.json`、`history-corruption.png`、`chat-corruption.png`：实际安装版 F2/F3/F5、300 请求及 15 轮恢复。
- `cancellation.mjs`、`cancellation.json`：50 轮竞态检查。
- `speech-soak.json`、`native-cycles.mjs`、`native-cycles.json`：语音持续运行和线程释放原始采样。
- `dependency-audit.json`、`dependency-package.cjs`、`dependency-package.json`：公开公告原始结果及实际 ASAR 版本。
- `parser-probe.mjs`、`parser-probe.json`：标题数量压力观测。

既有脚本本轮输出：`chat-lifecycle-nD6rv6/report.json`、`interview-workflow-1791996945055`、`copilot-ui-VGsTMj/report.json`、`updates-h9GMGe/report.json`、`speech-failure-1791996734732/results.json`。这些目录均位于 `test-results/`，属于隔离测试数据。早期 desktop-partial.json 是测试脚本事件计数和 Playwright 参数修正过程，最终结论采用完成的 desktop.json，不把脚本错误当产品缺陷。

## 未覆盖的边界

没有真实账户的 ChatGPT/Copilot 完整授权保存、续期和在线推理验收；合成 RPC 不替代官方服务的订阅/组织策略测试。未使用真实个人资料、环境令牌或其他应用凭据。语音持续输入是合成夹具，故障测试仅开系统音频、不保存内容；没有真实麦克风、真人准确率、多机型、热拔插、休眠唤醒、数小时或数天 soak 验收。未执行恶意依赖漏洞利用、管理员/跨 Windows 用户攻击、证书 MITM、真实磁盘耗尽或掉电试验。原有安装/升级保留检查属于上一轮证据，本轮没有重装用户应用。

所有测试创建的桌面实例均已结束；用户数据与现有发行包保留。本轮没有提交、推送、上传 Release 或重新打安装包。
