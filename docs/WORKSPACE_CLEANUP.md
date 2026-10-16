# 工作区清理结果

更新：2026-10-16（Asia/Shanghai）。最新main/平台架构整理与清理见首节，以下保留此前清理记录，不以历史条目判断当前能力。

## 2026-10-16：0.2.0 清理与平台分类

本轮按用户授权整理并准备提交源码和发布安装包。核对静态导入、动态 Worker/utilityProcess、构建/打包入口和测试消费者后，138 个生产模块没有可删除的孤立业务模块；7 个无入边节点均为实际入口或声明。仅删除无消费者的 Shrink 图标导出及其 Fluent 导入、过期 interviewLayout.height 字段，现用语音、RAG、账户和存储完整保留。

6 份依赖 Windows 原生鼠标、WASAPI 权限或 Copilot Win32 运行时的桌面回归迁入 test/windows/scripts，权限和模拟语音夹具归入 test/windows/fixtures。共享 UI 回归通过显式可执行路径验证打包应用，具体 Windows 路径只在 Windows runner 中解析；不创建未实现的 Mac 测试目录。benchmarks 整体 Git 忽略，退役私有原件和历史结果原地保留。

删除前形成具体清单，并验证真实绝对路径、目录边界、重定向和运行进程。仅移除旧隔离 profile 中已知的 Chromium 缓存：581 个目录、2,207 个文件、逻辑大小 917,572,989 字节，失败 0。排除文档引用、各组最新结果、失败诊断和恢复基线；profile 数据、报告、截图、正式 release、根构建、模型/依赖、真实用户资料和凭据均保留。缓存不再作为可用验证产物；原始报告仍可追溯。

0.2.0验收后再移除4项可再生成副本：nsis-upgrade-L2pCyr的stage/artifacts，以及updates-native-1VRWID的Cache/pending与platform-cache/pending。88文件、1,730,629,512字节，失败0；先核对具体路径/链接/进程，再按清单删除。其报告、截图和profile保留，正式release/installer与installer-stage保留；已移除副本不再作为可用交付物。清单和结果在verification-cleanup-plan.json、verification-cleanup-result.json。

审计位于 test/results/release-v0.2.0：baseline、source-move-plan.json、cleanup-plan.json、cleanup-result.json。版本和本轮验证/上传状态以 PROGRESS 最新节及 FUNCTIONAL_TEST_REPORT 为准。

## 2026-10-16 功能回归生成副本移除

36组功能回归通过后，仅移除本轮5项可再生成内容：platform-layout-functional-20261015-697d9556便携副本、nsis-upgrade-ZsqYJX的stage/artifacts、updates-native-lR72ZR的Cache/pending和platform-cache/pending。共9,031文件、逻辑3,337,255,901字节，失败0；删除前形成具体清单，递归真实路径与重定向检查、工作区范围及各目标运行进程检查通过。测试NSIS应用已正常卸载，报告/截图/失败日志/合成资料/源码快照和既有恢复基线保留；正式release、根构建、真实用户数据/凭据/原件、benchmarks及模型/依赖未动。审计见test/results/functional-20261015-697d9556/cleanup-plan.json和cleanup-result.json，完整验收范围见FUNCTIONAL_TEST_REPORT.md。portable-current-VNSxgj/report.json仍为历史验证证据，所用测试包已经移除，不作为可用交付物。

## 2026-10-15 AGENTS更新与生成产物精简

AGENTS.md已将已完成任务的重复“最新授权”整理为当前状态，修正旧知识库“等待新方案”的过期描述，明确现用LanceDB/E5 RAG、Windows/macOS/shared生产目录、test测试边界、Mac仅Apple Silicon且未完成移植、当前安装包与工作树的差异。补充长期清理规则：先核对消费者/进程/真实路径；保留必要报告、截图、最近结果、失败日志与恢复快照，验收后的可再生成副本与缓存可移除；不清理原件、凭据、模型、依赖或正式发行。

本轮仅删除test/results中的265个过期合成测试目录/缓存目标，合计12,917文件、逻辑体积7,638,205,224字节，失败0。候选来自实际测试脚本的生成前缀；排除文档引用的运行目录、每组最近结果、恢复基线/迁移快照及账户授权相关目录。已验收的platform-layout-20261015便携副本移除，portable-current-kD1Dco/report.json及截图、原生/更新报告和平台整理快照保留；更新下载缓存清除，release/installer安装包与元数据仍保留。

删除前逐路径确认在test/results内、无重定向链接和使用该路径的运行进程；OneDrive占位文件按真实路径确认，不按reparse属性误删。所有删除结果有清单，源码/测试文件与恢复快照核对见本轮verification.json，架构136模块零越层/运行时环。没有业务改动、提交推送、重建安装包或发布；本轮不重复生成全套测试包/缓存。审计在test/results/workspace-tidy-20261015，含前态AGENTS、来源清单、保留依据、逐项结果和汇总。

## 2026-10-15 平台目录与test集中整理

生产源码按shared/、windows/、macos/划分，242个原文件均有最终去向；测试源码、测试脚本及夹具统一test/shared与test/windows，原Renderer旁单测不再混在生产目录。原test-results目录整体迁到test/results，内部截图、隔离资料和恢复基线全部保留，历史报告内旧路径不改写。根配置、公共素材、依赖、模型、native/bin助手输出及现有release产物维持用途和位置；benchmarks只留退役实验历史数据，未读取/删除原件或重新评测。

已清理71个被新路径编译模块替代的旧JS和10个生成空目录，并删除迁移后的旧源码空目录；每个旧产物先确认新产物存在、绝对路径留在dist-electron内再删除，没有清空构建目录。引用图136模块无孤立业务文件，七个无入边模块均为实际入口/声明/Worker/utilityProcess；额外noUnused及依赖核对未发现其他可安全删除模块或依赖，版本和锁文件保持。

目录/测试依赖边界、构建/启动/ASAR/原生进程引用同步。实际回归与限制以PROGRESS最新节为准；逐文件前态、最终映射、清理清单和日志在test/results/platform-folders-20261015，目录解释见WORKSPACE_LAYOUT.md。没有提交推送、生成交付安装包或发布，仅生成隔离便携验证目录。

## 2026-10-15 main / 跨平台架构整理

- 从最新本地HEAD建立main，承接全部191项既有修改/未跟踪内容；Windows/Mac及原工作分支保留，没有提交、推送、重置、强合并或修改远端默认分支。远端实时核对因网络失败未确认，只记录本地跟踪值。
- 审查src/electron/scripts/tests/docs/public/native及根配置的引用、动态入口、依赖和生成输出。删除无消费者的MODEL_ID导出；窗口配置/导航/加载共用，不改业务生命周期；纯平台策略由main装配，后台不反向依赖桌面策略。
- 没有删除整个源码文件或依赖，没有升级版本。Windows限定的sherpa-onnx-win-x64 1.13.8改为平台可选依赖；原Windows打包仍显式要求该原生包，锁文件只同步分类，包版本/完整性全部保持，原供应链与冻结锁校验通过。其余依赖均实际使用。
- 七个无入边源码均为启动/声明/进程/Worker入口；唯一同字节Logo副本是生成流程必需。全部脚本有用途，dist-electron没有孤立过期输出。未清空生成目录或历史证据，没有删除模型/依赖，也没有读取/删除真实原件、凭据、用户历史或benchmark派生数据；原生回归仅正常加载现有模型和使用合成资料。
- 修复旧login smoke过期定位器并保留图片加载断言；vitest仅收集源码测试，原41文件完整保留并新增平台测试；.gitignore补macOS元数据与崩溃转储。
- 134模块架构、类型、noUnused、42文件295单测、Windows构建、14组桌面回归及真实无采样Worker/utilityProcess/设备枚举、离线RAG通过。Windows三类窗口完整选项与前态一致，76个Renderer文件、preload/公开契约未变，无数据格式迁移。PDF并发冷启动超时原日志保留，独立完整重跑原5秒门槛通过。

详情见[CROSS_PLATFORM_REFACTOR](CROSS_PLATFORM_REFACTOR.md)。前态与审计位于test-results/cross-platform-20261015。没有重新打包/签名/发布，现有安装包不含本次整理；Mac仅完成静态策略与类型检查，实际移植待后续授权。

## 2026-10-15 全界面检查后的清理

- 对照全部 Renderer 消费者删除24个无引用类涉及的42个CSS选择器，包括旧登录、旧浮窗状态、旧知识库设置和无消费者的字号组合。保留动态拼接的 resize-left/resize-right；旧 .btn 为失配规则，按实际 ui-button 修正。删除 PreparationPage 未使用的 openChatLink 导入，真实打开链接接口及消费者保留。
- 架构引用图没有孤立业务模块。七个无入边文件均为 main/Renderer/preload/声明或按路径启动的 speech/knowledge 进程与 Worker；全部图标仍有消费者。Renderer 与后台额外 noUnusedLocals/noUnusedParameters 检查通过，没有为凑清理数量删除功能或依赖。
- 按已核实的 scripts/tests 生成前缀清理过期隔离测试输出，保留文档引用、每组最近输出、本轮截图和恢复基线；删除已过期的 release/installer-stage、release-smoke 以及中断的 copilot-dependencies 下载暂存。删除前逐路径检查真实绝对路径、工作区边界与链接，执行前复核生成目录白名单、保留清单和运行应用路径，使用 PowerShell Remove-Item -LiteralPath，不使用全库 clean/reset。
- 共删除1085个条目、35037个文件，文件逻辑大小合计5,036,656,979字节（约5.04GB），删除失败0。该数字是文件大小之和，不作为实际磁盘可用空间变化的测量。
- 保留根目录最新 dist/dist-electron、现有 release/installer 安装包及更新元数据、node_modules、依赖锁与本地包缓存、Paraformer/E5模型、语音夹具、benchmarks中的private/历史结果/派生数据、workspace-cleanup-baseline 和文档引用的必要报告。没有读取或修改真实 userData、原件、账户凭据或面试历史。

审计证据在忽略目录 `test-results/visual-cleanup-20261015/`：removed-selectors.json、source-audit.json、cleanup-plan.json、cleanup-result.json 和 verification.json。当前安装包为此前版本，暂存/便携目录已删除，本轮没有重新打包或发布；日常启动继续使用根目录 Start-VoxCue.cmd。

## UI 审查中的无引用样式清理

逐项核对Renderer代码后，移除src/styles.css中旧record-detail/detail-heading/record-columns、saved-transcript/saved-answer、composer-caption、floating-bottom/floating-notice、login-wordmark/login-loading规则及旧正文选择器。对应类名没有现存Renderer消费者；仅调整这些规则，不重排或整文件格式化。仍断言旧入口不存在的回归检查保留。

当前业务源码引用图未发现新的孤立模块。当前LanceDB、原件管理、Paraformer、账户、聊天、面试与记录仍实际使用，不按废弃项删除；恢复基线、已有派生数据和真实用户数据保留。

本次审查生成的10个隔离profile目录和已弃用的启动脚本也已清除；删除前验证每个绝对路径均在test-results/ui-ux-audit内。保留有效截图、复现值与可复现检查脚本。

架构106模块零越层/运行时环、类型、33文件203项测试、构建通过；独立userData与合成端口的25个Electron界面状态在清理后复查。审查结果见docs/UI_UX_REVIEW.md。未提交、推送或发布。

## 2026-10-14 本次范围

- 删除 Qwen 权重、CPU 解码 Worker、CUDA 子进程/能力检测/运行库、下载缓存、模型清单、比较脚本、专用夹具/测试及旧详细试用报告。删除语音识别模型/CPU-GPU 菜单、公开选项、转发与锁定分支，以及无人使用的提示 CSS。
- 保留固定 Paraformer CPU、Silero、模型文件完整性检查、开场安装检查、设备/权限检查、旧事件过滤、WASAPI 间断恢复和面试上下文。已存旧模型/计算设备字段读取时忽略，音频与回答偏好继续保留；不迁移真实存储。
- 删除独立 Orama/LanceDB 一次性对比工程的执行代码、独立依赖与重复公共模型缓存/探针包；删除依赖固定历史结果路径的5个策略/性能脚本及命令。当前知识库、E5/LanceDB 后端和其维护回归仍在使用，保留。
- 清除149个经绝对路径及工作区边界验证的条目，包括旧编译/便携输出、Qwen/CUDA 文件、生成截图、隔离 UI 测试目录和旧日志。清单在忽略的 `test-results/retired-cleanup-paths.json`，条目数不是文件数或磁盘释放量。新的验证结果、依赖和启动所需构建保留。
- 依据数据保护约定，已有 private 语料、标注、结果、派生索引/向量、恢复基线原地保留；没有读取或清理真实用户目录、简历/知识库原件、凭据、面试历史。未执行新的模型/精度实验。
- 源码引用图无其他孤立模块：无入边文件仅为 main、Renderer入口、preload、声明及由路径启动的 Worker/utilityProcess。Renderer/后台分别启用临时 noUnusedLocals/noUnusedParameters 检查通过；所有 package 脚本入口存在。根依赖锁没有因本次清理重写，已有未提交修改保留。
- 干净重建后语音打包只接受8个固定 Paraformer文件，防止残留实验模型重新进入包。

历史质量结论保留：Qwen 未达用户要求而撤除。其 GPU 单句曾比 CPU 慢55.1%，负载下出现积压，长句尾段约7.55秒，真正流式未实现。撤除不计作质量修复，也不证明 Paraformer 真人中英混读已达标。

## 本次验证

- 106源码模块架构检查：零越层、零运行时环；类型、干净构建通过。
- 33个测试文件、203项通过；移除的测试针对已撤除功能，保留功能没有删失败断言或降低门槛。新增旧设置兼容检查；Vite既有大chunk提示保留。
- `interview-effort-1791952259668`：Qwen/GPU菜单不存在，保留开场安装检查，回答模型/思考强度、确认锁定、重载与请求传参通过（隔离合成端口）。
- `speech-restart-JPs2KV`：真实WASAPI回环/Paraformer Worker，3轮启动暂停恢复、一次受控间断，均有终稿、零错误；麦克风关闭，不保存采集音频/转写正文。
- `speech-failure-1791952265325`：最终版本损坏模型拒绝、Worker/采集进程失败后的清理通过。移除仅为嵌套解码进程提供的dispose握手，停止继续先冲刷尾段，再释放Paraformer Worker；相关42项回归复测通过。
- `portable-current-FIeR9g/report.json`：最终便携包真实Paraformer语音解码、gap重置、utilityProcess/原生助手、面试上下文及原有知识库功能通过；包内语音目录严格等于8个固定模型/许可文件，废弃后端不存在。根目录构建与便携包已更新，没有提交、推送或发布。

## 2026-10-13 历史记录（以下不是当前能力清单）

用户当时授权撤除旧知识库内容索引方案并清理废弃代码/文件，该轮没有实现替代方案；后续授权的新知识库实现见当前 ARCHITECTURE 与 PROGRESS。

## 删除与简化

- 移除旧检索后台、解析/Embedding/重排/NLI/语义证据实验，以及 Hybrid、Lite+ 应用路径、流式证据协议和公开契约。
- 移除主进程装配、preload/IPC、Renderer 服务、自动同步/轮询、状态/取消/重试/问答校正、参考来源 UI、模式菜单及单场知识库选择。聊天和面试直接调用现有 AIChatService。
- 删除对应下载、评测、冻结、原生/桌面测试脚本与夹具；封存题目直接删除，未读取、解密或评测。旧方案和专项报告从文档中撤除，AGENTS/README/ARCHITECTURE/HANDOFF/PROGRESS 整理为当前状态。
- 删除独立运行依赖 @huggingface/tokenizers、mammoth、onnxruntime-node、pdfjs-dist、sqlite-vec，更新锁文件。其余根依赖的锁定版本与清理前一致；安装日志显示移除 125 个依赖包，未运行依赖安装脚本。
- 删除仓库内 e5/minilm/nli/reranker 模型目录，保留 local-models/speech。旧便携输出和编译输出清除后重新生成，避免已删除源码的 JS 残留。
- 引用图确认旧 InterviewPage 和 historyExamples 无入口/消费者后删除；删除无消费者的麦克风适配函数、2 个图标导出、37 条废弃 CSS 规则及旧改名/图标生成/置顶/账户诊断脚本。当前图标生成脚本保留。
- 清除 631 个旧生成工件入口（日志、截图、隔离测试目录和旧源码快照等），保留本轮验证、源码恢复基线及现有公开语音夹具/本机 Electron 打包缓存。此前失败的结论在 PROGRESS 中保留，不将撤除功能计为质量修复。

清理前源码/文档/脚本清单中有 86 个文件已删除；该数字不包含独立删除的专项测试/夹具、模型与生成工件。具体初始删除清单、修改文件和旧工件清单在忽略的 test-results/workspace-cleanup-baseline 与 cleanup-removed-artifacts.json。

## 数据与行为兼容

知识库保留创建/重命名/删除、导入/拖放、同名替换、文档删除和 TXT/Markdown 有界预览。PDF/Office 原字节继续保存，界面明确仅支持文本预览。导入不解析、不加载模型、不触发后台同步；准备聊天/面试不读取知识库原件或自动附带简历。

没有读取、删除或迁移真实 userData、IndexedDB、凭据、简历、个人信息、记录或旧派生数据库。IndexedDB 名称 copilot-local-documents、版本 1、bases/documents stores 和按 baseId 读取原件的浏览器索引保持兼容。旧记录的未知附加字段原样保留，新增回归验证标题修改不改写旧回答。原音频不保存/上传、OAuth 与窗口保护范围不变。

新的请求契约不再接受旧功能字段；主进程保留窗口/输入校验、模型/effort 开场锁定和请求取消。运行中的旧应用窗口应正常退出后使用 Start-VoxCue.cmd 启动新构建。

## 验证

| 检查              | 结果                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 架构              | 88 文件，零越层依赖、零运行时循环，频道覆盖通过                                                                                                                                                                |
| TypeScript / 构建 | typecheck、build 通过；既有 Vite 大 chunk 提示保留                                                                                                                                                             |
| 单元测试          | 25 文件、150 项通过                                                                                                                                                                                            |
| 原件管理桌面检查  | 导入、同名替换、文本预览、PDF 原字节、重载、改名、删除确认及旧 IPC 撤除通过                                                                                                                                    |
| 保留功能桌面回归  | settings、interview:workflow、interview:access、interview:effort、history、composer、conversations:status、ui:alignment、electron、floating、login、chat-response、conversations、login:entry 共 14 组脚本通过 |
| 本地语音文件推理  | 19 个现有合成/公开音频案例通过；sherpa 1.13.8 / ORT 1.28.2，无录音/下载                                                                                                                                        |
| 新便携包          | 打包及启动通过；真实语音 Worker 加载模型、utilityProcess 返回 idle、助手路径通过；包内仅 speech 模型，无旧后台目录/IPC                                                                                         |

修改前沙箱基线为 42 文件/622 项：615 通过、7 失败，包含本机 HTTP 与临时文件 rename 的访问限制。本轮在正常本机权限、隔离目录下完成最终测试；对应功能撤除后删除其专用测试，不通过修改断言或降低门槛保留假通过。

便携检查首次因新测试执行上下文没有全局 require 而失败；仅修正脚本的 createRequire，未修改产品来绕过检查，复测通过。上述测试未使用真实账户、真实用户资料或真人采集，不能替代真人准确率、物理热插拔/权限撤销、新电脑/全部 DPI、真实摘要与标题质量验收。

结果日志：test-results/cleanup-{architecture,typecheck,test,build,knowledge,speech-model,package,package-test}.log，以及 cleanup-smoke-*.log。新的便携检查报告在 test-results/portable-current-390CO3/report.json。

当前分支 codex/speech-recognition，全部工作未提交/推送。等待用户新方案，保留现有语音、账户、聊天和记录功能。
