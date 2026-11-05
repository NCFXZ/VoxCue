# VoxCue 当前进度

更新日期：2026-11-05。仅保存当前基线、任务与接续入口；长期规则见 AGENTS.md，详细变更及发行事实见 shared/docs，验证结果仅终端/对话。

## 当前：0.6.9 清理、完整验证与发行

- 本轮先拉取至 `e98242a`，保留已有工作。版本唯一来源为 `shared/package.json = 0.6.9`，根及 Windows 生成配置已同步。用户授权清理确认无用内容，完整测试、修复与复测后提交/推送源码，并将 Windows 安装包上传至 `NCFXZ/VoxCue-releases` 的 `v0.6.9`；当前尚在验证，发行事实由 [Windows 索引](shared/docs/WINDOWS_0.6.9_RELEASE.md)记录。
- 用户明确此前全部改动同步 Windows 与 Mac，包括界面、交互及一小时更新检查缓存、长按 5 秒强查、完整包保留、中断下载清理与一小时自动下载冷却。当前 Windows 工作不写 `macos/`；共享实现与 Windows 适配已接通，Mac 原生适配必须在 Mac 本机完成，不能视作已完成双端验收。
- 完整增量、最终数值与逐项 Mac 操作见 [0.6.8→0.6.9 交接矩阵](shared/docs/MACOS_0.6.9_HANDOFF.md)，公开中英说明见 [发行说明](shared/docs/RELEASE_0.6.9.md)。矩阵区分产品修复、夹具适配和本机待实现项，不保留已撤回中间设计。
- 共享范围包含统一连续圆角、胶囊滚动条/菜单、6px 菜单内距、模型档位组合入口与连续滑块、浅深主题、文字选择、登录字段与验证码、单次演示、菜单/弹窗/页面/勾选动画、固定侧栏及单选中条、聊天折叠/复制/时间、来源图标、同步消息与设置行对齐、权限预检骨架扫光和知识库终点进度。测试中修复跳过登录时无效邮箱失焦插入错误导致按钮移位，以及正文规则覆盖截图缩略图控件光标；新增复测说明持续追加至交接矩阵。
- Windows 更新持久缓存、安全路径、完整包重新验摘要/签名与离线恢复、强查 IPC、取消冷却及退出清理屏障见 [更新设计](shared/docs/UPDATES.md)。显式安装、面试及保存握手、匿名本平台完整稳定资产选择保持。
- 清理按静态/动态/打包/测试消费者核对；没有确认可删的闲置业务模块，不为数量删除兼容读取和有效专项。已替换的自有旧动图清理，当前交付预览保留于系统临时目录；构建中间物在最终归档及回读后清理。边界见 [工作区清理](shared/docs/WORKSPACE_CLEANUP.md)。
- 不升级依赖、SDK、模型，不迁移真实数据、不更改签名身份。RAG 算法、模型、阈值、检索策略及索引兼容沿用既有基线，仅改进度展示并验证调用链。官网、独立服务端和 Mac 树不在 Windows 写入/部署范围。

## 验证与接续入口

- 当前平台目录执行 `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:workspace`、`pnpm test`、`pnpm audit` 和 `pnpm build`。另一平台生成配置只读报告，由其本机同步。
- 共享完整功能入口 `pnpm test:windows:functional`；保留 20 轮面试与 600 秒音频长稳。Windows 原生入口 `pnpm test:windows:regression`，五档 DPI 入口 `pnpm test:ui:dpi`，GUI/原生/推理/长稳串行且需解锁的 owner 控制台。专项、夹具及减少动态效果入口见 [验证说明](shared/test/README.md)。
- 最终安装/升级/卸载、运行时隔离、资产摘要、安装器界面与正式安装阶段由 Windows 既有 installer/packaged 专项验收；二进制和必要临时资料不进入源码 Git。
- Mac 接续先保护本机改动后拉取最终源码，按交接矩阵逐项执行；重点补齐原生持久缓存中签名材料、强查、完整包验证/复用、中断清理/冷却、异步退出屏障和本平台签名包流程。Windows 结果不能代验 Mac，自动化宿主不能触发的原生窗口隐藏可见性仍须本机人工核对。

## 已发行恢复基线

- 两端 0.6.8 已发行并归档；来源、资产与摘要分别见 [Windows 0.6.8](shared/docs/WINDOWS_0.6.8_RELEASE.md)、[Mac 0.6.8](shared/docs/MACOS_0.6.8_RELEASE.md)。既有用量预警及生命周期继续回归，详见 [0.6.8 Mac 交接](shared/docs/MACOS_0.6.8_HANDOFF.md)。
- 历史两端 0.6.7 资产及恢复基线保留，来源见 [Windows 0.6.7](shared/docs/WINDOWS_0.6.7_RELEASE.md)、[Mac 0.6.7](shared/docs/MACOS_0.6.7_RELEASE.md)。旧测试细节查文档及 Git，不在此重复累积。

## 独立官网与介绍文档

- 官网维持 EdgeOne 部署 `dp7shya5nsro`，`https://voxcue.com.cn/` 与 `/en/`，下载入口目前是已公开 0.6.8。工作副本位于 `C:/Users/fengk/.codex/visualizations/2026/11/02/01a19e50-4af5-7903-aed7-c297abc0cb90/voxcue-website`；中英、系统浅深主题与原演示已发布。本轮桌面发行不附带官网或服务端部署。
- 两仓库中英文 README 保持用途、功能与注意事项，不放版本日志、安装步骤或开发说明；隐藏功能及触发方式不进入公开介绍。发行细节使用专门发行文档。
