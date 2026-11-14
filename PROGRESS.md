# VoxCue 当前进度

更新于 2026-11-14。macOS 和 Windows 当前发行均为 1.2.2，分别对应源码标签 `v1.2.2` 与 `windows-v1.2.2`。版本以 `shared/package.json` 为准。Windows 上一正式版本为 1.2.0，macOS 的凭据升级基线为 1.1.1。

## 当前实现

- Mac 凭据助手 v11 沿用既有签名身份。升级时仅从 1.1.1 的三个正式名称选择来源，在同一钥匙串复制并核对密钥。现有加密资料通过校验后才进入旧项清理。冻结助手、旧版本恢复原件及签名和更新身份继续保留。[凭据交接](shared/docs/MACOS_1.2.2_CREDENTIAL_HANDOFF.md)
- 启动时只向上次成功连接的 AI 服务验证会话，确认后在设置和侧栏显示状态与额度。新装或主动断开后跳过验证，再次连接成功后恢复自动连接。系统凭据被拒绝或不可用时，本次启动停止该服务的后续钥匙串请求。ChatGPT 和 Copilot 在设置及侧栏的额度百分比使用相同的向下取整规则。[Mac 版本说明](shared/docs/MACOS_1.2.2_RELEASE.md)
- 聊天在回复生成期间显示来源。已有来源信息的正文链接可立即展示来源名称，晚到的注释会更新对应链接及来源列表。
- 源码、自动更新和固定组件使用公开的 `NCFXZ/VoxCue`。旧客户端仍通过 `NCFXZ/VoxCue-releases` 获取本平台完整版本。源码按 AGPL-3.0-only 发行，模型、运行时和素材保留各自许可。[第三方声明](THIRD_PARTY_NOTICES.md)

## 发行与接续

- Apple Silicon 安装包、更新 ZIP 和 `latest-mac.yml` 使用同一固定签名身份。两个 1.2.2 发行页均提供 Windows x64 安装器、更新文件和 Windows 源码归档。[VoxCue](https://github.com/NCFXZ/VoxCue/releases/tag/v1.2.2) · [VoxCue-releases](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.2)
- Windows 1.2.2 已同步平台配置、公开发行源及随包许可。WASAPI 手动重连等待旧采集实际关闭，设备枚举校验原生返回。主动登录仅对可确认损坏的本地资料启用密文恢复。已移除无引用的组件样式和失效图标链接。[Windows 逐项交接](shared/docs/WINDOWS_1.2.2_HANDOFF.md)
- Windows 最终包包含个人资料在聊天存储恢复期间即可读取的修复；从 1.2.0 升级的隔离验收入口为 `windows/test/scripts/store-sandbox-smoke.mjs --nsis-upgrade`。极短中文语音的识别限制已记录。Microsoft Store 2.2.2.0 已提交认证，等待微软完成审核与自动发布。[Windows 发行索引](shared/docs/WINDOWS_1.2.2_RELEASE.md)
- 接续测试从保留的测试源码和正式发行包创建独立的合成环境，结束后清除测试专用虚拟机、资料和缓存。冻结助手、签名和恢复原件按项目规则保留。[客户端测试说明](shared/test/README.md)
