# VoxCue 当前进度

更新日期：2026-11-02。仅记录当前基线与接续事项；长期规则见 AGENTS.md，验证结果仅输出终端/对话。

## README 文档范围

- VoxCue 与 VoxCue-releases 的中英文 README 统一为软件用途、主要功能与注意事项；移除版本介绍、更新日志、安装步骤和开发说明。
- VoxCue 提供发行仓库下载入口，发行仓库提供不绑定版本号的安装包入口。发行详情仍由原有发布说明及内部交接文档维护。

## 当前基线：0.6.7 两端已发行

- 版本唯一来源为 `shared/package.json = 0.6.7`。Mac 接续共享基线 `f3d71cd`、Windows 发行说明 `4895866`，产品源码为 [`0178df3`](https://github.com/NCFXZ/VoxCue/commit/0178df3802e3018b67655f2fbd59593f9d29d546)。后续说明文档不改变安装包输入。
- [v0.6.7](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.7) 保持 Latest，包含两端各三项正式资产。来源与摘要见 [Windows 发行索引](shared/docs/WINDOWS_0.6.7_RELEASE.md)、[Mac 发行索引](shared/docs/MACOS_0.6.7_RELEASE.md)。两仓库均保留双语 README 与发布说明，公开介绍不披露隐藏内容及触发方式。
- 共享功能包括中英界面、简洁首页引导、可交互面试预览、技能生成/更新及逐项确认、模型按需联网、准备聊天显式使用知识库、共享公式渲染和收放动画。范围定义见 [M001–M052 交接](shared/docs/MACOS_0.6.7_HANDOFF.md)。
- Mac 同步本平台清单/锁与 KaTeX 0.18.2；修复英文截图按钮、默认转写标签、窄窗音频设备布局及组件提示标点。应用包/开发宿主增加按系统语言选择的英文权限说明，简体中文取原 Info.plist。中文界面和默认窗口尺寸保持。
- Mac 回归入口纳入语言/首页引导五档缩放；原生窗口按 ID 定位，中文预期夹具显式设置语言，悬停/菜单/权限流程等待实际焦点和窗口恢复。具体入口见[测试说明](shared/test/README.md)，不放宽几何、权限或取消断言。用户操作的原生导出步骤已收尾。
- 本轮源码及安装资产已提交 GitHub；消费者清理与修复复测已收尾。合成截图、服务端临时 checkout、重复验包暂存和本轮新产生的无用宿主副本已清理；正式三项仅归档在 `macos/release/0.6.7`，不进入源码 Git。

## 接续事项与保留边界

- 真实 AI 账户多语言质量、物理音频/权限撤销、触控板轻扫与惯性、新硬件仍按条件单独验收，不能用合成夹具代验。Windows 后续在本机复核本轮共享英文布局细调；现有 Windows 0.6.7 安装资产不从 Mac 重建或覆盖。
- 服务端只读参考固定为 0.5.3/`3bceb615dbba900f669322c301fc4b5b473dfb15`。后续测试用 `VOXCUE_TEST_SERVER_ROOT` 指向 owner 系统临时 checkout，旧 `shared/server` 保留；官网及独立服务端本轮未部署。
- Windows 全树只读；未替换本机 Applications。现用依赖/模型、固定签名/凭据/更新身份、全部历史发行和恢复基线保护。按[清理边界](shared/docs/WORKSPACE_CLEANUP.md)保留历史跳过目录，不清理归属未知或活跃目录。
- 测试仅使用 owner 临时合成资料和固定公开模型/音频，执行副本退出清理，校验后的公开缓存保留。临时防休眠仅覆盖本轮工作，结束释放。
- 入口：[架构](shared/docs/ARCHITECTURE.md)、[个人资料](shared/docs/PERSONAL_INFO.md)、[Mac 开发](macos/docs/MACOS_PORT.md)、[测试](shared/test/README.md)。
