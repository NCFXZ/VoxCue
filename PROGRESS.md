# VoxCue 当前进度

更新日期：2026-11-07。仅保存当前基线、任务与接续入口；长期规则见 AGENTS.md，详细变更及发行事实见 shared/docs，验证结果仅终端/对话。

## 当前任务：Windows 1.0.0 验证与发行

- 当前授权：清理确认无用的文件/代码；Windows 全量安全、稳定性、对抗、英文及视觉/DPI/原生/安装验证，问题修复后重测；推送源码并公开发布 1.0.0 安装包，更新 Microsoft Store；编写 0.6.9→1.0.0 Mac 逐条接续文档。保留现有未提交工作、签名身份、模型/依赖、用户数据及发行恢复基线；Mac 全树只读，不操作独立官网或服务端。
- `shared/package.json = 1.0.0` 为当前待发行的正式版本；GitHub 和 Store 发布状态待完成。共享改动及本轮测试修复统一汇总至 `shared/docs/MACOS_1.0.0_HANDOFF.md`，Windows 验证不能代替 Mac 本机验收。

## 已发行基线：Windows 与 Mac 0.6.9

- 私有源码主分支的 0.6.9 基线已同步；公开 [v0.6.9](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.9) 包含 Windows 与 Mac 资产。准确打包输入与资产元数据见 [Mac 发行索引](shared/docs/MACOS_0.6.9_RELEASE.md)、[Windows 发行索引](shared/docs/WINDOWS_0.6.9_RELEASE.md) 及 [中英发行说明](shared/docs/RELEASE_0.6.9.md)。
- Mac 已接入一小时检查缓存、失败重放、强查、签名 envelope 重验、完整包离线恢复、中断冷却与异步退出屏障，见 [Mac 更新设计](macos/docs/UPDATES.md#持久检查与完整包恢复)。
- 共用 UI 增量和本机接续见 [0.6.8→0.6.9 交接矩阵](shared/docs/MACOS_0.6.9_HANDOFF.md)。退出快照保留独立 SVG 遮罩资源，修复 Mac 菜单和弹窗收起时图标变成实心方块。Windows 主动取消冷却和新增共用退出快照留其本机复核，Mac 未写 Windows 树。
- 清理边界见 [工作区清理](shared/docs/WORKSPACE_CLEANUP.md)。固定签名、凭据助手、依赖、SDK、模型和恢复基线保持；RAG 算法、阈值、检索策略和索引兼容无变化。本轮不操作真实资料、独立服务端或官网。

## 当前界面调整

- 共用侧栏的额度提示与邮箱文字左对齐，头像与右侧整块文字垂直居中。ChatGPT 仅返回一个周期时始终一行“ChatGPT 剩余 N%”，低于 20% 仅百分比标黄；同时返回五小时和周额度时，沿用任一低于 20% 后两行显示标题及双周期、各自标黄的逻辑。共享组件、摘要与样式供两端共用；Mac 本机界面复核待接续。
- 网页读取/查找活动复用现有域名来源胶囊，字号、内距与图标随活动行缩放；真正可点击的超链接及其子文本显示手形，并提供浅深主题的悬停与键盘焦点反馈。原始 URL、受控打开及复制原文保持；普通正文、禁用及无 href 元素保持原有光标。

## Windows Microsoft Store

- Partner Center 已保留 VoxCue 产品，Store ID `9PBBVWZXMBPW`。Windows 本机 `pnpm package:store` 使用商店标识构建 x64 APPX，应用版本仍来自 `shared/package.json`，商店包身份版本使用主版本加一及末位零。商店版通过 Microsoft Store 更新，独立 NSIS 发行版沿用原更新渠道。
- Microsoft Store 首版已可获取。沿用 Windows x64 APPX、免费定价、生产率分类、隐私链接、生成式 AI 披露、认证说明、`runFullTrust` 用途和 3+ 分级。「提交 2」于 2026-11-06 提交微软认证。中英文商品页均已替换为确认后的四张截图及配文，顺序为面试悬浮窗、面试准备、复盘和知识库，短描述和商品描述已同步。该提交通过认证后立即发布。
- 本机 Windows Sandbox 已启用。离线验证从解锁控制台启动，签名和信任仅在临时来宾内。商店任务栏使用各目标尺寸及浅深主题的透明图标资源。

## 验证与接续入口

- 当前平台目录执行 `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:workspace`、`pnpm test`、`pnpm audit` 和 `pnpm build`。另一平台生成配置只读报告，由其本机同步。
- Mac 使用 `shared/test/scripts/functional-suite.mjs`、`macos/test/scripts/ui-refinement-matrix.mjs` 与 [专项入口](shared/test/README.md)，保留 20 轮面试、600 秒音频与五档。GUI/原生/推理/长稳串行，仅使用 owner 临时合成资料和固定公开资源；联调只读使用固定 0.5.3 服务端参考，结束清理本轮临时副本。
- Mac 发行使用 `pnpm package:installer`、`package-runtimes-smoke.mjs` 与 `package-smoke.mjs --install-archive`，正式公开后用 `--online` 回读。真实账户、硬件与自动化宿主不能触发的原生隐藏恢复仍按本机条件验收，Windows 成绩不能代验 Mac。

## 已发行恢复基线

- 两端 0.6.8 已发行并归档；来源、资产与摘要分别见 [Windows 0.6.8](shared/docs/WINDOWS_0.6.8_RELEASE.md)、[Mac 0.6.8](shared/docs/MACOS_0.6.8_RELEASE.md)。既有用量预警及生命周期继续回归，详见 [0.6.8 Mac 交接](shared/docs/MACOS_0.6.8_HANDOFF.md)。
- 历史两端 0.6.7 资产及恢复基线保留，来源见 [Windows 0.6.7](shared/docs/WINDOWS_0.6.7_RELEASE.md)、[Mac 0.6.7](shared/docs/MACOS_0.6.7_RELEASE.md)。旧测试细节查文档及 Git，不在此重复累积。

## 独立官网与介绍文档

- 正式官网 `https://voxcue.com.cn/` 已发布到 EdgeOne 生产部署 `dp5dhu06kprd`。中英文首页及安装指南的 Windows 入口共用 Microsoft Store 商品页（商店按访客语言显示），桌面端使用深绿胶囊、MIT 许可的 Fluent Store Microsoft 图标和共享下载箭头，安装指南提供商店安装步骤，窄屏复制链接；Mac 继续提供 0.6.9 DMG，快速开始直接演示邮箱与密码登录。独立官网工作副本位于 `C:/Users/fengk/.codex/visualizations/2026/11/06/01a1b1ae-1ea0-7541-8fbe-26c00390ca8c/voxcue-website`，接续使用该副本 README 的验证和打包入口。中英文隐私页已上线客户端使用统计说明，当前部署包位于该副本的 `migration/voxcue-independent-20261106T222109Z.zip`。
- 两仓库中英文 README 保持用途、功能与注意事项，不放版本日志、安装步骤或开发说明；隐藏功能及触发方式不进入公开介绍。发行细节使用专门发行文档。
