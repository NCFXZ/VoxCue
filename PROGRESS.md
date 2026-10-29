# VoxCue 当前进度

更新日期：2026-10-29。本文只维护当前接续信息；长期规则见[AGENTS.md](AGENTS.md)，详细历史见`shared/docs/`及Git。

## 当前任务与范围

- 从客户端0.6.2提交`8eb42a7`开发0.6.3；版本源为`shared/package.json`，只生成根与当前平台配置。
- 精简AGENTS.md与本文，分离长期规则和任务记录；明确模块解耦、精简高效、最小改动三条编码规则。
- 侧栏及个人信息面板开合动画对齐记录页AI回答栏，优化聊天文件拖入提示；两项通过共享代码同时覆盖Windows/Mac；另追加知识库文档文件图标与Mac快捷键字形调整。Mac本机开发，Windows专属全树只读。
- 本轮追加客户端“跳过登录”及本地账户、独立导出和26项统计的共用客户端实现。用户新授权清理弃用内容、完整客户端/UI验收、修复复测后提交推送既有私有客户端main，并上传Mac 0.6.3安装/更新三项至既有公开发行仓库。保留现有Latest、Windows/历史/模型资产及真实安装；不发行未经Windows本机验证的包。
- 交付逐项Windows客户端更新、服务端待适配说明和Windows Codex接续提示词。服务端适配代码留给后续Windows任务，本轮服务端只读；提示词可授权独立仓库实现/隔离测试，不自动部署或写生产。
- 服务端0.5.2固定`472541cc80c77439f02c45d0bf0aed913b036134`，独立仓库与`shared/server/`只读；不修改代码、测试、配置、依赖、数据库或身份，不跑后端套件、迁移、构建、部署、重启或生产写入。

## 本轮实现摘要

- 根/Mac版本配置同步0.6.3，Windows配置留待本机同步，依赖锁保持。
- 用户追加将语音选择项、CPU性能提示和缺失组件提示统一为本地组件页的“轻量语音识别/多语言语音识别/知识库检索”；共用展示表作为唯一文案来源，内部模型ID/文件/推理行为保持。首次完整矩阵在此追加前中断，最终基于新文案重新完成验收。
- 完整审查追加AI统计退出收尾：未完成请求在关闭统计前记cancelled，迟到成功不改写；固定回归覆盖此生命周期，最终验收基于该实现。
- 用户追加面试两角缩放箭头向外：Mac修正为向外的SF Symbols，左右沿用镜像；Windows既有Fluent向外图标保持，缩放行为及原生几何不变。
- 统计由主进程随机安装ID及事件发生时的账户身份管理；固定类别/数字事件覆盖26项聚合所需数据，开发/普通测试不采集。2000条/30天有界原子队列、明确回执幂等补传、独立匿名传输、旧服务端24小时退避；不传正文/原件/音频/截图/邮箱或凭据。面试仅running开始计时，扣除暂停/休眠并保存崩溃检查点。协议及完整指标口径见[客户端统计](shared/docs/CLIENT_TELEMETRY.md)。
- 账户额度标题与同级标题统一正文字号；开场摘要、侧栏未连接/读取/不可用状态统一称为“AI 服务”，用量获取逻辑保持。
- 关于与更新页在资料保留说明右侧加入GitHub图标及“问题反馈”链接，打开既有公开VoxCue-releases仓库的Issues新建页；图标按中文字形视觉居中，链接复用“查看官方用量”的主题色与下划线；移除开发版线上更新说明，更新执行限制保持。
- 侧栏宽度、Mac侧栏开合按钮位置、个人信息栏及关联聊天布局共用240ms、`cubic-bezier(0.2, 0, 0, 1)`；参考回答栏沿用相同参数，隐藏延迟同步。
- 文件拖入界面采用居中文件图标卡片、分层说明、数量/大小标签及更轻的边框/背景；沿用原导入逻辑，保持浅深色、窄宽度、减少动态效果和高对比度适配。
- 知识库文档列表将聊天气泡换为共用文件图标（Windows Fluent / Mac SF Symbols）；Mac截图快捷键沿用Control字符U+2303，局部改用系统字体，与原生快捷键字形对齐，键位与触发逻辑保持。
- AGENTS.md补充持续更新本文及及时清理确认无用内容的要求，保留长期约定；本文合并重复进度与过期任务，历史记录改为文档索引，不作为新任务授权。

- 本地账户由主进程持久偏好管理，正常包可用且不进入demo；未登录不取得云端身份/权限，AI授权独立。设置和侧栏统一显示“本地账户”，设置仅保留信息行右侧登录按钮，复用最初独立登录窗口，不再显示登录/注册/找回密码表单；模式切换沿用保存、取消和归档撤销保护。
- 导出组件独立使用，沿用原分块归档与完整性校验，本地账户不请求云端；图标按平台采用官方导出图标，取消导出不显示提示。

## 接续待办

- Windows本机运行`node shared/scripts/sync-platform-manifests.mjs`生成0.6.3配置，核对本轮共享界面及本地账户、导出和反馈交互；Mac本机结果不替代Windows验收。
- 服务端统计接收、认证/限流、事件幂等入库、26项后台聚合/看板及同域名迁移留待新授权。当前服务端不支持新接口，客户端只暂存并退避，不能声称后台已收到或已展示数据；累计注册仍以服务端注册记录为准。
- 客户端实现、清理审查及Windows/服务端逐项交接已整理完成，当前正在正式Mac包验收。余下为源码提交推送、Mac 0.6.3三项上传及匿名下载/实际更新选版核对；沿用既有仓库与身份，Latest保持开始时的v0.6.2。

## 固定基线与现有行为

- 目标为Windows x64、macOS14.2+/Apple Silicon arm64；共用网页界面，分别采用Fluent/SF Symbols及现有系统材质，不恢复Liquid Glass。
- 固定依赖/锁、Copilot SDK1.0.21、Codex0.164.0、模型/索引/RAG v7、代码签名、凭据助手、host-id及Ed25519更新身份。
- 登录仅顶部72 CSS px条带拖动，保留Mac红绿灯；标题、表单、预览和交互控件不拖动。保持免费化，普通新密码NFC后8–128个Unicode码点、管理员15–128；不恢复计费/时长租约。
- 普通聊天/草稿/附件本机保存，切换不取消生成，显式停止/删除/退出才取消；关闭等待保存，失败保留窗口。资料更新须确认，导出与注销入口独立；注销沿用密码、确认及中断清理保护。
- 音频本机处理、音源分离，麦克风不触发自动回答；截图仅明确启用/点击后按次捕获。知识库保持单任务索引、完整文件落盘即入队、多库按当前库已收到文件优先。
- 用户真实资料、数据位置、存储键和历史跳过目录保持。更新固定匿名访问`NCFXZ/VoxCue-releases`并按本平台最高完整稳定版选包，不依赖统一Latest。
- 客户端联调只读使用原样固定后端参考，可经`VOXCUE_TEST_SERVER_ROOT`指定checkout；仅owner临时数据库、内存邮件及自有loopback，不操作生产。

## 验证入口

- 基础检查：根目录`pnpm check:architecture`、`pnpm typecheck`、`pnpm test`、`pnpm build:shared`。
- 本轮定向：本平台目录运行`node ../shared/test/scripts/composer-smoke.mjs`、`node ../shared/test/scripts/history-branding-smoke.mjs`及`node ../shared/test/scripts/profile-ui-smoke.mjs`；另含`knowledge-smoke.mjs`与`interview-screenshot-smoke.mjs`。profile-ui的面试检索部分需隔离RAG模型夹具或显式合成知识库端口，完整脚本说明见[测试入口](shared/test/README.md)。
- 新增`shared/test/scripts/local-mode-smoke.mjs`验证本机进入/退出/重启、云端权限隔离、独立AI/导出和设置顺序；`local-mode.test.ts`覆盖持久化失败及竞争，公开IPC断言同步。
- 统计专项：`telemetry.test.ts`与`desktop-ipc.test.ts`、本平台运行`node ../shared/test/scripts/telemetry-smoke.mjs`；事件、队列、退避、隐私和指标映射见[统计协议](shared/docs/CLIENT_TELEMETRY.md)。
- GUI串行并检查当前UID解锁状态；仅合成资料，结果只在终端/对话，临时内容退出清理。这里不保存执行成绩。

## 历史索引

- 0.6.3：[Windows客户端C001–C082](shared/docs/WINDOWS_0.6.3_HANDOFF.md)、[服务端S/M待适配](shared/docs/SERVER_FOR_CLIENT_0.6.3_HANDOFF.md)、[Windows提示词](shared/docs/WINDOWS_0.6.3_CODEX_PROMPT.md)、[逐文件审计](shared/docs/CLIENT_0.6.3_FILE_AUDIT.md)、[Mac发行索引](shared/docs/MACOS_0.6.3_RELEASE.md)。
- 0.6.2：[Mac交接C001–C050及文件差异](shared/docs/MACOS_0.6.2_HANDOFF.md)、[接续提示词](shared/docs/MACOS_0.6.2_CODEX_PROMPT.md)、[服务端0.5.2历史变化](shared/docs/SERVER_0.5.2_HANDOFF.md)。
- 0.6.1：[客户端交接](shared/docs/CLIENT_0.6.1_HANDOFF.md)、[Windows交接](shared/docs/WINDOWS_0.6.1_HANDOFF.md)。
- 0.6.0：[Mac交接](shared/docs/MACOS_0.6.0_HANDOFF.md)、[逐文件审计](shared/docs/CLIENT_0.6.0_FILE_AUDIT.md)、[Mac发行](shared/docs/MACOS_0.6.0_RELEASE.md)、[Windows发行](shared/docs/WINDOWS_0.6.0_RELEASE.md)。
- 设计与目录：[架构](shared/docs/ARCHITECTURE.md)、[RAG](shared/docs/RAG_ARCHITECTURE.md)、[工作区布局](shared/docs/WORKSPACE_LAYOUT.md)、[清理边界](shared/docs/WORKSPACE_CLEANUP.md)。更早版本按`shared/docs/`与Git历史查阅。
