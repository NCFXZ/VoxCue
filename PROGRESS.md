# VoxCue 当前进度

## 当前版本与范围

**2026-11-24 · macOS 1.3.5 已正式发行，Windows 当前公开基线为 1.3.3。** 版本唯一来源为 `shared/package.json`，根和 Mac 配置已同步至 1.3.5。Windows 配置由 Windows 本机同步。

- 侧栏、聊天记录、知识库卡片和文档、待发送附件及两个面试输入框采用非线性动画。跨行补位时在行边缘淡出和淡入。知识库详情平滑调整高度，到达上限后文档区滚动，关闭时原地淡出。
- 知识库按库使用独立索引目录和写进程。后台删除可跨重启恢复。由旧共享布局升级时先清理旧生成索引，再从保留的原件按库重建，沿用现有索引进度。现有分库索引继续使用。
- 开始面试时按本场音源预检权限。Mac 在首次使用时请求系统授权，拒绝后可从弹窗打开对应系统设置。同步了设备区域间距、录音波形和确认按钮宽度。

## 实现与验证入口

- [1.3.5 中英文更新说明](shared/docs/1.3.5_UPDATE.md)及 [Windows 1.3.3 → 1.3.5 逐条交接](shared/docs/WINDOWS_1.3.5_HANDOFF.md)。
- [RAG 存储与迁移](shared/docs/RAG_ARCHITECTURE.md)。仅使用新建合成资料验收导入、查询、引用、替换、并行删除／索引和重建。验收入口为 `rag-core-smoke.mjs`、`knowledge-removal-smoke.mjs` 和 `knowledge-core.test.ts`。
- [共享测试](shared/test/README.md)、[Mac 正式包隔离验收](macos/docs/TEST_GUEST.md)及 [Mac 增量和全量回退](macos/docs/UPDATES.md#网络增量与全量兜底)。
- [下载渠道与发布顺序](shared/docs/DOWNLOAD_CHANNELS.md)。大陆出口使用 CNB 匿名索引，其他地区使用 GitHub。两边使用相同的正式原件、摘要和签名。现用组件位于两边的 `models-v1.0.0`。

## 发行状态与接续待办

- Mac 1.3.5 同一组签名 DMG、ZIP、增量计划和清单已发布。源代码位于 GitHub 的 `v1.3.5`。公开更新索引包含 Mac 1.3.5，保留 Windows 1.3.3 和历史资产。 [GitHub 1.3.5](https://github.com/NCFXZ/VoxCue/releases/tag/v1.3.5) · [CNB 1.3.5](https://cnb.cool/voxcue-release/voxcue-release/-/releases/tag/v1.3.5)
- [GitHub 1.3.3](https://github.com/NCFXZ/VoxCue/releases/tag/v1.3.3)和 [CNB 1.3.3](https://cnb.cool/voxcue-release/voxcue-release/-/releases/tag/v1.3.3)保留两端正式原件作为升级基线。
- 在 Windows 本机按交接同步 1.3.5，并完成原生、DPI、升级、签名和发布验收，再追加 Windows 发行资产和 CNB 索引。Microsoft Store 2.3.3.0 已提交认证（Submission 12，`1152921505702489003`）。
- [官网欢迎公告配置](shared/docs/ANNOUNCEMENTS.md)待在另一台电脑的 EdgeOne Pages 项目 `voxcue-website` 发布并核对 `/app/announcements.json`。
- 固定轻量语音模型可能误识别极短语气词。云端 0.6.1 跨设备并发新增截图引用与删除的既有竞态详见 [历史交接](shared/docs/WINDOWS_1.3.0_HANDOFF.md)。
