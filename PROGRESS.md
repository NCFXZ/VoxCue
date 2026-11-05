# VoxCue 当前进度

更新日期：2026-11-05。仅保存当前基线、任务与接续入口；长期规则见 AGENTS.md，详细变更及发行事实见 shared/docs，验证结果仅终端/对话。

## 当前：Windows 0.6.9 已发行，Mac 本机验证与发行进行中

- 当前任务授权：先验证资料导出，再核对并清理无消费者文件/代码，完成 0.6.9 Mac 适配及本机全量安全、对抗、稳定、英文与视觉回归，修复后重测；最终推送源码并追加 Mac 安装/更新资产到 GitHub `v0.6.9`，保持 Latest。Windows 全树只读，独立官网与服务端不部署。
- Mac 接续基线为 `563ca42`；从 `shared/package.json = 0.6.9` 同步本平台生成配置。已接入一小时检查缓存、失败重放、强查、签名 envelope 重验、完整包离线恢复、中断冷却与异步退出屏障，详见 [Mac 更新设计](macos/docs/UPDATES.md#持久检查与完整包恢复)。
- 共用 UI 增量及本机接续见 [0.6.8→0.6.9 交接矩阵](shared/docs/MACOS_0.6.9_HANDOFF.md)。新增的退出快照修复保留 SVG 遮罩资源，避免 Mac 菜单和弹窗收起时图标变成实心方块。现阶段进行最终签名包验收，随后推送私有源码与追加公开 Mac 三项资产。
- Windows 0.6.9 的安装包源码输入为 `7e3cacb`，三项正式资产已在公开 `v0.6.9`（Latest）。来源及资产见 [Windows 发行索引](shared/docs/WINDOWS_0.6.9_RELEASE.md)；本轮不重建或覆盖。Windows 主动取消冷却边界和新增共用退出快照修复留其本机复核。
- 清理边界见 [工作区清理](shared/docs/WORKSPACE_CLEANUP.md)。固定签名、凭据助手、依赖、SDK、模型和恢复基线保持；RAG 算法、阈值、检索策略和索引兼容无变化。本轮不操作真实资料、独立服务端或官网。

## 验证与接续入口

- 当前平台目录执行 `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:workspace`、`pnpm test`、`pnpm audit` 和 `pnpm build`。另一平台生成配置只读报告，由其本机同步。
- Mac 使用 `shared/test/scripts/functional-suite.mjs`、`macos/test/scripts/ui-refinement-matrix.mjs` 与 [专项入口](shared/test/README.md)，保留 20 轮面试、600 秒音频与五档。GUI/原生/推理/长稳串行；仅 owner 临时合成资料，固定 0.5.3 服务端参考 `/private/tmp/voxcue-server-069-readonly` 只读使用并在任务结束清理。临时电源断言保持亮屏，不更改系统权限或锁屏设置。
- Mac 发行使用 `pnpm package:installer`、`package-runtimes-smoke.mjs` 与 `package-smoke.mjs --install-archive`，正式公开后用 `--online` 回读。真实账户、硬件与自动化宿主不能触发的原生隐藏恢复仍按本机条件验收，Windows 成绩不能代验 Mac。

## 已发行恢复基线

- 两端 0.6.8 已发行并归档；来源、资产与摘要分别见 [Windows 0.6.8](shared/docs/WINDOWS_0.6.8_RELEASE.md)、[Mac 0.6.8](shared/docs/MACOS_0.6.8_RELEASE.md)。既有用量预警及生命周期继续回归，详见 [0.6.8 Mac 交接](shared/docs/MACOS_0.6.8_HANDOFF.md)。
- 历史两端 0.6.7 资产及恢复基线保留，来源见 [Windows 0.6.7](shared/docs/WINDOWS_0.6.7_RELEASE.md)、[Mac 0.6.7](shared/docs/MACOS_0.6.7_RELEASE.md)。旧测试细节查文档及 Git，不在此重复累积。

## 独立官网与介绍文档

- 官网维持 EdgeOne 部署 `dp7shya5nsro`，`https://voxcue.com.cn/` 与 `/en/`，下载入口目前是已公开 0.6.8。工作副本位于 `C:/Users/fengk/.codex/visualizations/2026/11/02/01a19e50-4af5-7903-aed7-c297abc0cb90/voxcue-website`；中英、系统浅深主题与原演示已发布。本轮桌面发行不附带官网或服务端部署。
- 两仓库中英文 README 保持用途、功能与注意事项，不放版本日志、安装步骤或开发说明；隐藏功能及触发方式不进入公开介绍。发行细节使用专门发行文档。
