# VoxCue 当前进度

更新日期：2026-11-07。仅保存当前基线、任务与接续入口；长期规则见 AGENTS.md，详细变更及发行事实见 shared/docs，验证结果仅终端/对话。

## 当前任务：Mac 1.0.0 验证与发行

- 本轮授权：优先验证资料导出，按 [Mac 逐项交接](shared/docs/MACOS_1.0.0_HANDOFF.md) 接续本次更新；清理确认无用文件/代码；完成 Mac 全量安全、稳定性、对抗、英文及视觉验证，修复后重测；提交推送源码并将 Mac 1.0.0 三项资产追加到 GitHub `v1.0.0`，设置 latest。测试期间维持生命周期内防休眠，控制台锁定或未知时停止。
- 用户明确目标为 1.0.0，唯一版本源为 `shared/package.json = 1.0.0`，只同步根和 Mac 生成配置；Windows Store 1.0.1 发布者维护及其树保持只读，既有公开 Windows 1.0.0 和 Store 维护资产保留。Windows 生成版本漂移及新增共享布局须留其本机复核；后续需依据已发行 Store 版本明确下一版本再同步，不能直接用漂移配置重包。
- 已接续原生导出保存、覆盖和取消，以及离线导出与归档取消生命周期；清理确认可重建的根 Finder 元数据，保留现用代码、依赖、缓存及发行恢复基线。固定 0.5.3 服务端仅作为系统临时目录内的原样只读客户端参考，不操作独立官网、服务端或真实账户/资料。
- 单周期英文额度复用账号卡片网格，利用箭头下方空位避免 Mac 字宽裁切，保持一行、230px 侧栏及原字号/颜色。五档、Qwen 和临时凭据专项复用持续桌面守卫；原生更新专项只清理本轮唯一偏好域，确认关联进程退出后回收专用临时根。细节见交接 M063–M066。
- 完整共享功能、Mac 默认原生、原时长长稳、全部五档界面、独立表单/原生凭据/Qwen/无障碍及临时图像目视复核已接续，视觉临时图像已清理。待办：最终签名打包、源码推送、GitHub 追加资产及匿名完整回读。真实账号、物理采样和自动化宿主无法触发的隐藏恢复不以合成测试代验。

## 已发行与恢复基线

- Windows [v1.0.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.0.0) 已公开，安装包输入为 `a47f7435ef7c233eee9da87a18261162dfaee65f`；资产、源码及 Microsoft Store 1.0.0 提交 3 上架记录见 [Windows 1.0.0 发行索引](shared/docs/WINDOWS_1.0.0_RELEASE.md)。本轮追加 Mac 资产时保留 Windows 资产 ID、大小及摘要。
- Windows Store 1.0.1 是发布者显示名称维护，保持商店 Name、Publisher 与包家族身份，包身份版本为 `2.0.1.0`。提交 4（`1152921505702342674`）记录为已提交认证，后续可获取状态由微软处理；来源和资产见 [Windows 1.0.1 发行索引](shared/docs/WINDOWS_1.0.1_RELEASE.md)。本轮不操作 Partner Center。
- Mac 当前公开完整资产为 [0.6.9](shared/docs/MACOS_0.6.9_RELEASE.md)。两端 0.6.9 及更早正式/恢复包保留；历史来源查对应发行索引与 Git，不重复累积验证记录。
- 固定签名、凭据助手、SDK、现用模型/依赖、原件及恢复基线继续保护；清理边界见 [工作区清理](shared/docs/WORKSPACE_CLEANUP.md)。RAG 模型、阈值、检索策略和索引兼容不变。

## 当前共享界面

- 额度与邮箱左对齐、头像与整块文字居中。ChatGPT 实际只返回一个周期时始终一行“ChatGPT 剩余 N%”，低于 20% 仅百分比标黄；双周期任一个低于 20% 时显示标题和两个周期，各自标黄。Mac 单周期卡片也使用既有网格，避免英文边缘裁切。
- 网页读取/查找活动复用域名来源胶囊，字号、内距与图标随活动行缩放。真实可用超链接及其子文本显示手形，提供浅深主题悬停与键盘焦点反馈；原始 URL、受控打开及复制原文保持。
- Mac 保留本机原生控件、固定签名与原更新驱动；Windows Store 安装版由 Microsoft Store 更新，独立安装版沿用原渠道。

## 验证与发行入口

- 从 `macos/` 执行 `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:workspace`、`pnpm test`、`pnpm audit`、`pnpm build`。另一平台生成配置只读报告；依赖仅使用本机现有锁。
- 完整功能使用 `shared/test/scripts/functional-suite.mjs --jobs=1`，五档使用 `macos/test/scripts/ui-refinement-matrix.mjs`，以当前 `--list` 为准；保留 20 轮面试、600 秒固定公开音频及全部五档。独立云凭据、表单、无障碍与 Qwen 入口见 [测试说明](shared/test/README.md)。GUI、原生、推理和长稳串行。
- 客户端联调显式设置 `VOXCUE_TEST_SERVER_ROOT` 到原样 0.5.3、`3bceb615dbba900f669322c301fc4b5b473dfb15` 的 owner 临时 checkout；不执行后端套件。公开缓存按固定来源/摘要验证后复制到临时根，结束清理临时账户、数据库、归档及截图。
- Mac 发行先验证固定签名，再执行 `pnpm package:installer`；以 `VOXCUE_TEST_RELEASE_DIR` 指向准确最终资产，串行执行 `package-runtimes-smoke.mjs` 与 `package-smoke.mjs --install-archive`。公开后用 `--install-archive --online` 匿名下载完整包、验签和摘要；源码和正式三项资产分别上传私有源码仓库及公开发行仓库。

## 独立官网与公开介绍

- 官网 `https://voxcue.com.cn/` 当前记录部署为 EdgeOne `dp5dhu06kprd`，中英文 Windows 入口共用 Microsoft Store 商品页 `9PBBVWZXMBPW`，Mac 入口保持 0.6.9 DMG。本轮不部署独立官网；后续升级链接须另行授权。
- 官网工作副本为 `C:/Users/fengk/.codex/visualizations/2026/11/06/01a1b1ae-1ea0-7541-8fbe-26c00390ca8c/voxcue-website`，使用其 README 的验证和打包入口。两仓库中英 README 只说明用途、功能与注意事项，不放版本日志、安装或开发步骤；隐藏功能和触发方式不进入公开介绍。
