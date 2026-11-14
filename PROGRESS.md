# VoxCue 当前进度

更新于 2026-11-14。Windows、macOS 均已发行 1.2.3；Microsoft Store 2.2.3.0 已提交，通过认证后自动发布。版本唯一来源为 `shared/package.json`。本轮 Mac 接续已收尾，`windows/` 全树保持只读。

## 当前实现

- Windows 适配器启用共享音频自动重连：等待旧 WASAPI 进程关闭与 Worker 退休，按 1、2、4 秒有界恢复；权限、协议、损坏数据及未确认退出保留终止错误。双路故障显示实际阻止恢复的设备原因，手动停止保持严格尾段检查。[实施与发行说明](shared/docs/WINDOWS_1.2.3_RELEASE.md)
- Windows 云账号、云同步与同源遥测通过现有平台端口使用系统代理和证书信任，保持无浏览器 cookies、无缓存/来源、拒绝重定向与取消语义，不改变系统全局设置或官方供应商运行时。
- 保留上次成功连接的 AI 服务启动恢复、侧栏与设置额度一致、回复生成时查看网页来源，以及资料读取和编辑恢复；恢复状态与设备错误使用完整中英文提示。
- 云端下载知识库后的同库刷新保留当前文档行和阅读位置，读取请求与选择版本分别管理；换库和关闭仍隔离迟到结果，后台刷新不作废当前库的导入、删除或重命名。
- 云端恢复返回实际落盘修订，下载索引与修复扫描使用有效后端状态合并同一文档；此前状态读取在提交后过期，缺失或失效索引仍可重建。
- Mac 1.2.2 的凭据助手与升级边界沿用既有设计；Windows 的官方运行时完全无响应仍明确报错并允许以后重试，不声称两端系统授权窗口一致。[Mac 凭据交接](shared/docs/MACOS_1.2.2_CREDENTIAL_HANDOFF.md)
- Mac 接续文档已区分 Windows 对齐既有能力与实际共享 Bug 修复，并列出 Mac 本机验收边界。[Mac 1.2.3 接续](shared/docs/MACOS_1.2.3_HANDOFF.md)
- Mac 配置同步至 1.2.3，继续复用固定签名、Qwen 运行时和冻结凭据助手。升级夹具新增正式 1.2.2 ZIP 的摘要认证与 ASAR 数据兼容检查，保留 1.1.1 的既有 Sparkle 路径；普通正式产品启动／退出不代称登录后资料读取。[Mac 发行说明](shared/docs/MACOS_1.2.3_RELEASE.md)
- 窄窗记录标题重试按钮在 AI 回答卡左侧可见列内换行，回答计数与导出摘要共用单复数文案；中英与长错误的几何／命中回归覆盖该布局。
- 聊天生命周期夹具在进程重启时等待恢复后的主窗口，避免误登录隐藏语言窗口；补充采集停止失败原因保留断言，不改变生产功能或降低原断言。
- 凭据归档夹具严格区分正常拒权与启动失败、信号、超时及未退休后代，确认进程退休后再清理合成资源。归档 v5 在特定无效 partition 拒权组合中的 ACL 写等待不算拒权成功，冻结原件不改；现用产品仍采用 v11。同步调用和强杀的清理边界见[测试说明](shared/test/README.md)。

## 发行状态与接续

- 代码已在 `main` 推送，两个仓库的 `v1.2.3` 均为 Latest：[VoxCue](https://github.com/NCFXZ/VoxCue/releases/tag/v1.2.3) · [VoxCue-releases](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.3)。新增 Mac DMG、ZIP 与 `latest-mac.yml`，保留原三项 Windows 资产；累计中英文说明按平台区分。
- Mac 对应源码为主仓 [`macos-v1.2.3`](https://github.com/NCFXZ/VoxCue/tree/macos-v1.2.3)（`4fe22ec`）。原 `v1.2.3` 仍指向 Windows 发行提交 `fae85ca665505b314fee784a0dddc091f337ffd5`，两端源码均可从主仓标签归档获取。
- [Mac 1.2.3 交接](shared/docs/MACOS_1.2.3_HANDOFF.md) 已补充相对已发 1.2.2 的完整共享范围。共享记录界面修复需在 Windows 本机补验，既有 Windows 安装资产不改写。
- 本轮下载环境、依赖、临时模型副本、工具、VM／快照、截图、日志和合成资料已清除。固定签名、冻结助手、OneDrive 原件及本地正式 `macos/release/1.2.3` 保留；再次构建须按冻结锁恢复当前平台环境。签名与隔离 guest 入口见 [Mac 发行说明](shared/docs/MACOS_1.2.3_RELEASE.md)。
- Microsoft Store 2.2.3.0 的 Submission 10（`1152921505702404063`）已受理，交接时为 Pre-processing，设置为通过认证后立即发布；认证及实际上线仍需分别核对，交接时线上为 Submission 9 的 2.2.2.0。[Partner Center 状态](https://partner.microsoft.com/en-us/dashboard/products/9PBBVWZXMBPW/overview)
- 固定 Paraformer 的极短中文识别限制保留，不更换模型或放宽断言；本机合成验证不能代称物理设备、真实语音或真实订阅授权验收。验证入口见 [客户端测试说明](shared/test/README.md)。

## 发行与恢复基线

- Windows 1.2.2 的两个 GitHub 发行页资产已撤回，源码标签 `windows-v1.2.2` 与本地正式原件继续用于升级和恢复。Microsoft Store 2.2.2.0（Submission 9）保持上架。既有 1.2.2 不会自动降级。
- Mac `v1.2.2`、安装包和更新文件保留，两个旧发行页继续仅面向 macOS。[VoxCue](https://github.com/NCFXZ/VoxCue/releases/tag/v1.2.2) · [VoxCue-releases](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.2)
- 源码、固定组件和新客户端更新使用公开的 `NCFXZ/VoxCue`；旧客户端的 `NCFXZ/VoxCue-releases` 保持兼容。保留原更新签名、Store 身份、冻结助手和正式恢复原件，不清理现用模型/依赖。源码为 AGPL-3.0-only，第三方组件沿用各自许可。[第三方声明](THIRD_PARTY_NOTICES.md)
