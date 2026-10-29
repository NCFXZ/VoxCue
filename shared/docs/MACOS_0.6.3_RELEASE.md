# VoxCue 0.6.3 Mac发行索引

公开发行：[VoxCue 0.6.3](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.3)，发行ID `427903282`。此文只记录来源与资产元数据，不保存测试成绩或执行报告。

客户端基线：`8eb42a79fe804531f010749ff46635bf320f5308`（0.6.2）。产品源码快照：`c37fa181156617c58bc3eb4a509334057d4a38f3`，已正常推送既有私有`NCFXZ/VoxCue/main`；后续仅续记发行元数据、下载说明与接续状态，产品输入保持。

正式三项保留在`macos/release/0.6.3`，不进入源码Git；Apple Silicon arm64、macOS14.2+，沿用既有代码签名、凭据助手及Ed25519更新身份。

| 资产 | GitHub资产ID | 字节数 | SHA256 |
|---|---|---|---|
| [DMG](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.3/VoxCue-0.6.3-arm64.dmg) | 688658918 | 651418631 | `339855465d21c6a861dff0fbb2ac1ddf6bf9b00f7669b31e0c11a3f9cd43a2b4` |
| [签名ZIP](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.3/VoxCue-0.6.3-arm64.zip) | 688661624 | 605248877 | `c7e3624d4a89a1fae9e2f67b743689d0f6ce8191787b126a291a93aa6a77de25` |
| [latest-mac.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.3/latest-mac.yml) | 688663703 | 490 | `72c6acfad9ae558ead524e4650d47c3887720bf1b9545efc04bd13906545eb29` |

开始时的21个既有发行及115个资产保持原ID、状态、大小和摘要，包括历史Windows/Mac及模型。Latest保留v0.6.2（发行ID427234068）；按平台完整稳定资产选版，Mac当前0.6.3、Windows当前0.6.2。Windows0.6.3需在本机同步配置、完成原生/DPI/NSIS验收后再补三项；真实本机安装未替换。

服务端：本轮代码/测试/配置/依赖/数据库/部署均未修改，固定参考0.5.2/`472541cc80c77439f02c45d0bf0aed913b036134`仅用于客户端合成隔离联调；本机旧shared/server参考保留。统计接收/聚合/管理页仍待后续独立服务端实现，不能据客户端发行声称已上线。

完整更新：[Windows客户端C001–C082](WINDOWS_0.6.3_HANDOFF.md)、[逐文件审计](CLIENT_0.6.3_FILE_AUDIT.md)、[服务端S001–S036/M001–M026待适配](SERVER_FOR_CLIENT_0.6.3_HANDOFF.md)、[Windows Codex提示词](WINDOWS_0.6.3_CODEX_PROMPT.md)、[统计协议](CLIENT_TELEMETRY.md)。Mac原生/包成绩不代替Windows本机验收；Windows更新配置、专属文案断言、DPI/原生/NSIS仍须接续。
