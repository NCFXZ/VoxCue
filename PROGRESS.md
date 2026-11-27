# VoxCue 当前进度

## 当前发行任务

- macOS 1.3.6 的本机回归与最终签名包安装／升级验收已完成，当前待把原始 DMG、ZIP、增量计划和清单附加到 GitHub `NCFXZ/VoxCue` 与 CNB 的现有 `v1.3.6`，最后更新 CNB `main/releases.json`。源码直接使用 `main` 并以 `macos-v1.3.6` 标记；保留 Windows 的 `v1.3.6` 标签和资产，更新说明沿用 GitHub 原文。
- Mac 原生密钥字段在主题、字体、位置和布局就绪后显示；补齐真实弹窗、崩溃清理、Google 光学／实际缩放检查与失败诊断，以及资料面板、账号状态异步等待的测试同步。真实 1.3.5 升级基线已登记，区分保留分库 revision 与更早布局重建，并覆盖旧版签名缓存 offer。详细实现与入口见 [Mac 交接](shared/docs/MACOS_1.3.6_HANDOFF.md)。
- 已核对消费者并清理 Finder 元数据与无引用构建副本。现用依赖、认证公共缓存、签名材料及发行恢复基线保留，历史明确暂留目录不重试。临时合成资料和已停止 VM 待发布收尾统一清理；任务结束前保持屏幕与系统唤醒，不改锁屏策略。
- RAG 仅使用本轮新建合成资料验证完整功能，模型、阈值及检索参数保持。真实 Kimi／Gemini 服务组合未使用实际账户密钥验收，物理音频不采样；交付明确这些覆盖边界。
- Windows 1.3.6 已发布到 GitHub 与 CNB，正式源码标签 `v1.3.6` 指向 `6246268`；Store 2.3.6.0 已上传并提交认证，当前为 Submission 14 的预处理阶段。本机 `windows/` 全树只读，Mac 不提交 Microsoft Store。

## 1.3.6 实现摘要

- API 服务新增 Kimi 与 Gemini，顺序为 OpenAI、Gemini、DeepSeek、Kimi；沿用验证、启禁、更换、移除、模型目录和独立用量流程。Kimi 余额保留两位小数，两家服务均可用于准备聊天和面试回答。
- 准备聊天仅用当前服务商自己的官方搜索，面试不启用联网搜索。Google 官方建议位于用时分割线下方，使用透明、紧凑、浅深色对齐的隔离展示；搜索元数据仅在内存，联网历史文本不进入后续模型上下文。
- 保留 Kimi 严格资料解码及可见恢复、Gemini 3 及以上原生资料 schema、可取消的短重试与搜索额度降级；仅隐藏指定的底部额度提示，保留其他警告及后端状态。
- 动画复用共享参数并支持打断续播；聊天和面试气泡统一为上下 8px、左右 12px。原生 API 密钥框在弹窗入场和主题绘制就绪后显示。
- 清理输入区上方旧简历条、专用动作／样式／翻译，保留原件与同步、导入兼容；Google 预览统一使用实际消费的官方完整 HTML 夹具，移除旧简化展示。
- 修复 Google 子 frame 加载被误判为主页面重载而取消回答等 owner 任务的问题；导航围栏仅接受主帧跨文档事件，保留真实重载、跳转、销毁及原生密钥／快捷键录入／面试启动的取消与清理。
- 面试“快捷键”说明普通隐藏改为复用同场已就绪窗口，避免重开时重建 Renderer 和重复握手；结束、失败及 owner 重载仍销毁，入口为 `interview-shortcuts-smoke.mjs`，Mac 按交接 T18 本机验证。
- 逐条实现、测试修复、退役说明与 Mac 等效工作见 [macOS 1.3.5 → 1.3.6 交接](shared/docs/MACOS_1.3.6_HANDOFF.md)和 [双方联合交接](shared/docs/MOTION_KIMI_GEMINI_HANDOFF.md)。

## 1.3.5 升级与恢复基线

**2026-11-24 · macOS 和 Windows 1.3.5 已在 GitHub 与 CNB 正式发行。** 版本唯一来源为 `shared/package.json`，平台配置分别由本机同步。

- 侧栏、聊天记录、知识库卡片和文档、待发送附件及两个面试输入框采用非线性动画。跨行补位时在行边缘淡出和淡入。知识库详情平滑调整高度，到达上限后文档区滚动，关闭时原地淡出。
- 知识库按库使用独立索引目录和写进程。后台删除可跨重启恢复。由旧共享布局升级时先清理旧生成索引，再从保留的原件按库重建，沿用现有索引进度。现有分库索引继续使用。
- 开始面试时按本场音源预检权限。Mac 在首次使用时请求系统授权，拒绝后可从弹窗打开对应系统设置。同步了设备区域间距、录音波形和确认按钮宽度。
- Windows 接续修复了知识库归属记录写入中断、首次索引提交与删除并发、删除确认期间的文档或库变更，补齐知识库异常英文文案，校正英文面试记录的单数计数及「个人信息」的 16 × 16 px 图标。

## 实现与验证入口

- [1.3.6 中英文更新说明](shared/docs/1.3.6_UPDATE.md)及 [macOS 1.3.5 → 1.3.6 逐条交接](shared/docs/MACOS_1.3.6_HANDOFF.md)；此前升级细节见 [Windows 1.3.3 → 1.3.5 交接](shared/docs/WINDOWS_1.3.5_HANDOFF.md)。
- [动画优化与 Kimi、Gemini 联合交接](shared/docs/MOTION_KIMI_GEMINI_HANDOFF.md)：双方修改边界、技术路线、分层验证矩阵及待办；旧夹具错配先核验，不据此回退已有修复。
- [RAG 存储与迁移](shared/docs/RAG_ARCHITECTURE.md)。仅使用新建合成资料验收导入、查询、引用、替换、并行删除／索引和重建。验收入口为 `rag-core-smoke.mjs`、`knowledge-removal-smoke.mjs` 和 `knowledge-core.test.ts`。
- [共享测试](shared/test/README.md)、[Mac 正式包隔离验收](macos/docs/TEST_GUEST.md)及 [Mac 增量和全量回退](macos/docs/UPDATES.md#网络增量与全量兜底)。
- [下载渠道与发布顺序](shared/docs/DOWNLOAD_CHANNELS.md)。大陆出口使用 CNB 匿名索引，其他地区使用 GitHub。两边使用相同的正式原件、摘要和签名。现用组件位于两边的 `models-v1.0.0`。

## 发行状态与接续待办

- Windows 1.3.6 的 EXE、blockmap 和 Ed25519 签名清单已发布；CNB 公开索引包含 Windows 1.3.6，并保留两端的 1.3.5 和 1.3.3。现用本地组件仍为 `models-v1.0.0`。 [GitHub 1.3.6](https://github.com/NCFXZ/VoxCue/releases/tag/v1.3.6) · [CNB 1.3.6](https://cnb.cool/voxcue-release/voxcue-release/-/releases/tag/v1.3.6)
- Mac 1.3.5 的签名 DMG、ZIP、增量计划和清单，以及 Windows 1.3.5 的 EXE、blockmap、签名清单与 Store 包继续保留为升级恢复基线。Mac 1.3.6 已同步本平台配置与原生密钥显示顺序，正在本机全面验收，随后完成最终包安装／升级及双源发行。
- [GitHub 1.3.3](https://github.com/NCFXZ/VoxCue/releases/tag/v1.3.3)和 [CNB 1.3.3](https://cnb.cool/voxcue-release/voxcue-release/-/releases/tag/v1.3.3)保留两端正式原件作为升级基线。
- Windows Sandbox 升级入口为 `store-sandbox-smoke.mjs --nsis-upgrade-1.3.5` 和 `--appx-upgrade-1.3.5`，保留原 1.3.3 入口及固定摘要升级基线；1.3.5 → 1.3.6 覆盖签名缓存 offer／资料与 RAG 持久化，现有分库索引保留 `ragRevision`。
- Microsoft Store 2.3.6.0 已提交认证，Submission 14 为 `1152921505702524260`；2026-11-27 观察状态为 `In certification`／`Pre-processing`，通过后自动发布，尚未上架。中英文五条更新日志与新增 API 服务说明已同步，原有各六张截图保留。上一版 Submission 13 的 2.3.5.0 已在商店上线。
- [官网欢迎公告配置](shared/docs/ANNOUNCEMENTS.md)待在另一台电脑的 EdgeOne Pages 项目 `voxcue-website` 发布并核对 `/app/announcements.json`。
- 固定轻量语音模型可能误识别极短语气词。云端 0.6.1 跨设备并发新增截图引用与删除的既有竞态详见 [历史交接](shared/docs/WINDOWS_1.3.0_HANDOFF.md)。
