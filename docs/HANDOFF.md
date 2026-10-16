# VoxCue 当前交接

2026-10-16最新发行：v0.1.2 Windows x64已打包验证并发布 https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.1.2 ，三项资产state/大小/SHA256和公开latest.yml下载逐项核对，已设为Latest供旧客户端过渡到分平台更新。实际installer-stage六组专项通过，安装包600,418,657字节，SHA256 e5bb67711871dad5915d3e6ab66ff0bb415c9fd4994b2f7e158c2a15f8dfbaa2；原0.1.0/0.1.1产物保留，没有提交或推送私有源码。根构建及installer-stage为0.1.2，正式文件在release/installer，本轮证据在test/results/release-v0.1.2。大文件前两次网络失败，按用户要求刷新草稿清除失败占位后第三次上传成功；不要重复发布。仍未签名，无Mac包，真人语音/真实账户/Mac真机未新增验收。

2026-10-16最新：完整功能回归及检查更新动画修复完成。315项单测、36组功能回归（含66种UI状态、真正原生/离线RAG/更新/隔离NSIS升级/ASAR与10分钟合成音频）通过；测试路径和过时夹具已修正，原失败日志保留。真人语音按用户选择稍后测试，真实账户与Mac真机未验收，完整范围见FUNCTIONAL_TEST_REPORT.md。根构建已更新，公开安装包未重打，未提交推送发布。test/results/platform-layout-functional-20261015-697d9556验证包及本轮安装/下载副本验收后移除，portable-current-VNSxgj等报告/截图与functional-20261015-697d9556审计仍在，不把已删除测试包当作交付物。

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

过期生成条目1085个、35037文件、逻辑大小约5.04GB已删除，清单/验证在test/results/visual-cleanup-20261015。保留真实用户目录、原件、凭据、模型、依赖、私有/派生/历史数据和恢复基线。release/installer-stage与release-smoke暂存已清除，release/installer现有安装包保留，不能当作本轮版本；根目录构建已更新，正常退出后Start-VoxCue.cmd加载。没有打包、提交、推送或发布。详细界面对照和清理边界见UI_UX_REVIEW、WORKSPACE_CLEANUP及PROGRESS最新节。

2026-10-15 修复 Copilot 登录后“Windows 凭据加密存储不可用”：根因是 SDK 1.0.21 的 empty 模式主动设置 COPILOT_DISABLE_KEYTAR=1，并非已确认的系统故障。CopilotRuntime 改用 copilot-cli 模式保留 OS vault，isolatedSession 显式保留原 empty 的能力限制，拒绝明文和继承外部凭据的边界不变。根目录构建已更新，正常退出后从 Start-VoxCue.cmd 重新启动并授权；不删除/迁移凭据、用户数据，也未打包、提交或发布。真实 runtime 启动环境/会话隔离、PKCE/取消及合成加密失败重试/双服务 UI 回归已通过；真实账户令牌写入与推理仍需用户正常授权验证，不能称已验收。报告 test/results/copilot-ui-Fh7dTB/report.json，基础检查见 PROGRESS 最新节。

2026-10-14 最新追加：GitHub Copilot 与 ChatGPT 双服务登录已接入，官方 SDK 浏览器 PKCE 流程无需用户创建 OAuth App；此前索要 Client ID 的问题作废。只保存身份/服务选择，SDK 系统加密存储凭据；拒绝明文回退，不借用环境令牌或 gh 凭据。模型/vendor/effort 与服务提示采用实际目录，逐回复保留来源；Copilot 私有推理不展示，搜索需要实际 runtime 工具能力。正式账户授权和推理仍由用户正常使用验证，勿以合成测试声称通过。固定 SDK/运行时、恢复边界见 COPILOT.md 和 ARCHITECTURE。

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

2026-10-14 最新 UI 轮次：审查 19 项问题已修复/按用户反馈调整，见 PROGRESS 首节和 UI_UX_REVIEW 修复对照。根目录界面/主进程构建已更新；Start-VoxCue.cmd 使用当前输出，正常退出再启动可加载。便携包仍为下文上一轮清理版本，不含本轮 UI 修复。正在运行的原生采集进程会占用 native/bin/VoxCue.Audio.exe；不要为重编译终止用户面试或读取其数据。

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

Start-VoxCue.cmd 使用已构建输出，不自动编译；便携构建入口为 pnpm package:portable。当前验证结果见 PROGRESS.md 和 docs/RAG_TEST_REPORT.md；本轮未提交、推送或发布。

本轮修改前源码快照在忽略目录 test/results/workspace-cleanup-baseline/sources.json，只用于按文件/逻辑块恢复，不能覆盖后续工作；没有保存真实用户资料或读取封存题目。历史准确率失败不因撤除功能变为通过。真人语音准确率、物理设备/跨机/全部 DPI 和真实账户摘要/标题质量仍未完整验收。
