# VoxCue 当前进度

更新于 2026-11-13。macOS 1.2.2 对应源码标签为 `v1.2.2`，版本以 `shared/package.json` 为准。macOS 正式升级基线为 `v1.1.1`（`e0a2a87`），Windows 正式基线为 `v1.2.0`（`0bc1cd4`）。

## 当前实现

- Mac 凭据助手 v11 沿用既有签名身份。升级时仅从 1.1.1 的三个正式名称选择来源，在同一钥匙串复制并核对密钥。现有加密资料通过校验后才进入旧项清理。冻结助手、旧版本恢复原件及签名和更新身份继续保留。[凭据交接](shared/docs/MACOS_1.2.2_CREDENTIAL_HANDOFF.md)
- 启动时只向上次成功连接的 AI 服务验证会话，确认后在设置和侧栏显示状态与额度。新装或主动断开后跳过验证，再次连接成功后恢复自动连接。系统凭据被拒绝或不可用时，本次启动停止该服务的后续钥匙串请求。ChatGPT 和 Copilot 在设置及侧栏的额度百分比使用相同的向下取整规则。[Mac 版本说明](shared/docs/MACOS_1.2.2_RELEASE.md)
- 聊天在回复生成期间显示来源。已有来源信息的正文链接可立即展示来源名称，晚到的注释会更新对应链接及来源列表。
- 源码、自动更新和固定组件使用公开的 `NCFXZ/VoxCue`。旧客户端仍通过 `NCFXZ/VoxCue-releases` 获取本平台完整版本。源码按 AGPL-3.0-only 发行，模型、运行时和素材保留各自许可。[第三方声明](THIRD_PARTY_NOTICES.md)

## 发行与接续

- Apple Silicon 安装包、更新 ZIP 和 `latest-mac.yml` 使用同一固定签名身份。1.2.2 对应的两个发行入口为 [VoxCue](https://github.com/NCFXZ/VoxCue/releases/tag/v1.2.2) 和 [VoxCue-releases](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.2)。旧发行仓另附同一源码提交的归档。Windows 1.2.0 维持其原发行。
- Windows 在本机接续 W001–W008、共享改动和 R01–R17 回归，涵盖 Store 清单、打包更新、语音设备、连接恢复、额度和正式 1.2.0 升级。[Windows 逐项交接](shared/docs/WINDOWS_1.2.2_HANDOFF.md)
- 接续测试从保留的测试源码和正式发行包创建独立的合成环境，结束后清除测试专用虚拟机、资料和缓存。冻结助手、签名和恢复原件按项目规则保留。[客户端测试说明](shared/test/README.md)
