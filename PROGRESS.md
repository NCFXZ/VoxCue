# VoxCue 当前进度

更新于 2026-11-14。当前 Windows 目标版本为 1.2.3，应用“关于”、服务器上报、安装器和更新清单统一使用 1.2.3，Microsoft Store 包版本为 2.2.3.0。版本唯一来源为 `shared/package.json`。macOS 保持既有 1.2.2，本机不修改 `macos/`。

## 当前实现

- Windows 适配器启用共享音频自动重连：等待旧 WASAPI 进程关闭与 Worker 退休，按 1、2、4 秒有界恢复；权限、协议、损坏数据及未确认退出保留终止错误。双路故障显示实际阻止恢复的设备原因，手动停止保持严格尾段检查。[实施与发行说明](shared/docs/WINDOWS_1.2.3_RELEASE.md)
- Windows 云账号、云同步与同源遥测通过现有平台端口使用系统代理和证书信任，保持无浏览器 cookies、无缓存/来源、拒绝重定向与取消语义，不改变系统全局设置或官方供应商运行时。
- 保留上次成功连接的 AI 服务启动恢复、侧栏与设置额度一致、回复生成时查看网页来源，以及资料读取和编辑恢复；恢复状态与设备错误使用完整中英文提示。
- 云端下载知识库后的同库刷新保留当前文档行和阅读位置，读取请求与选择版本分别管理；换库和关闭仍隔离迟到结果，后台刷新不作废当前库的导入、删除或重命名。
- 云端恢复返回实际落盘修订，下载索引与修复扫描使用有效后端状态合并同一文档；此前状态读取在提交后过期，缺失或失效索引仍可重建。
- Mac 1.2.2 的凭据助手与升级边界沿用既有设计；Windows 的官方运行时完全无响应仍明确报错并允许以后重试，不声称两端系统授权窗口一致。[Mac 凭据交接](shared/docs/MACOS_1.2.2_CREDENTIAL_HANDOFF.md)
- Mac 接续文档已区分 Windows 对齐既有能力与实际共享 Bug 修复，并列出 Mac 本机验收边界。[Mac 1.2.3 接续](shared/docs/MACOS_1.2.3_HANDOFF.md)

## 当前任务与接续

- 验收后仅在 `main` 提交推送，向 `NCFXZ/VoxCue` 和 `NCFXZ/VoxCue-releases` 发布 Windows `v1.2.3`，匿名回读资产与摘要。发行说明只列用户可感知功能和修复，使用精简中英文；源码使用主仓标签与自动归档，不重复上传源码 ZIP。
- Microsoft Store 已准备 Submission 10（`1152921505702404063`）草稿及中英文更新说明，尚未上传新包或提交认证。按用户要求提交 `2.2.3.0`，分别核对受理、认证与实际上线状态。
- 固定 Paraformer 的极短中文识别限制保留，不更换模型或放宽断言；本机合成验证不能代称物理设备、真实语音或真实订阅授权验收。验证入口见 [客户端测试说明](shared/test/README.md)。

## 发行与恢复基线

- Windows 1.2.2 的两个 GitHub 发行页资产已撤回，源码标签 `windows-v1.2.2` 与本地正式原件继续用于升级和恢复。Microsoft Store 2.2.2.0（Submission 9）保持上架。既有 1.2.2 不会自动降级。
- Mac `v1.2.2`、安装包和更新文件保留，两个旧发行页继续仅面向 macOS。[VoxCue](https://github.com/NCFXZ/VoxCue/releases/tag/v1.2.2) · [VoxCue-releases](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.2)
- 源码、固定组件和新客户端更新使用公开的 `NCFXZ/VoxCue`；旧客户端的 `NCFXZ/VoxCue-releases` 保持兼容。保留原更新签名、Store 身份、冻结助手和正式恢复原件，不清理现用模型/依赖。源码为 AGPL-3.0-only，第三方组件沿用各自许可。[第三方声明](THIRD_PARTY_NOTICES.md)
