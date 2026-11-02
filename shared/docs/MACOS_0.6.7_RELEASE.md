# Mac 0.6.7 发行 / Mac 0.6.7 release

发布日期 / Published: 2026-11-02。

[公开发行 / Public release](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.7)，发行 ID `431943986`，保持 Latest。Mac 三项资产追加到现有发行，Windows 三项资产的 ID、大小与摘要保持，见 [Windows 发行记录](WINDOWS_0.6.7_RELEASE.md)。本文只记录来源及资产元数据，不保存测试成绩。

产品源码输入为 [`0178df3802e3018b67655f2fbd59593f9d29d546`](https://github.com/NCFXZ/VoxCue/commit/0178df3802e3018b67655f2fbd59593f9d29d546)，接续共享基线 `f3d71cd` 和 Windows 发行文档 `4895866`。版本唯一来源为 `shared/package.json = 0.6.7`；后续 README、进度和发行文档提交不改变包输入。

The Mac installer was built from the source commit above. Later documentation-only commits do not change its contents. Existing Windows release assets are preserved.

## 正式资产 / Release assets

三项文件归档于 `macos/release/0.6.7`，仅上传发行资产，不进入源码 Git。Apple Silicon arm64，macOS 14.2 及以上。

| 文件 / File | GitHub asset ID | Bytes | SHA256 |
| --- | --- | ---: | --- |
| [VoxCue-0.6.7-arm64.dmg](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.7/VoxCue-0.6.7-arm64.dmg) | 703277192 | 654075701 | `ed1a568eaf5eb4c705eb51145d67cf933b6bdb106f46633a574be3e2b7df1ea7` |
| [VoxCue-0.6.7-arm64.zip](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.7/VoxCue-0.6.7-arm64.zip) | 703282051 | 607775367 | `2e8c032fbe1982af9d73b34e27d32926c4467fddc0272fb859931c38ead52626` |
| [latest-mac.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.7/latest-mac.yml) | 703285651 | 490 | `27509cad9de4a2040b885254e68994c306ab677574a1be526235866d847d2521` |

DMG 用于首次安装和手动升级；ZIP 与 latest-mac.yml 用于应用内更新。沿用既有本地代码签名、凭据助手、host-id 和 Ed25519 更新身份；不新增身份，不等同 Developer ID 签名或公证。KaTeX 按共享安全策略统一为 0.18.2，运行时 SDK、语音及检索模型版本保持。

Use the DMG for installation or manual upgrades. The signed ZIP and latest-mac.yml support in-app updates. The existing local code-signing, credential and update identities are unchanged; this is not Developer ID signing or notarization. Runtime SDK and model versions remain unchanged.

## 接续 / Follow-up

- Mac 同步 0.6.7 共享功能，并修复英文截图按钮、默认转写标签、窄窗音频设备卡片和组件提示标点；中文界面及默认窗口尺寸保持。开发宿主和正式包增加按系统语言选择的英文权限用途资源，简体中文取原 Info.plist 文案。
- 两仓库的中文/英文 README 下载入口均更新到 Mac 0.6.7；公开发行仓库提交为 `278aa2f8d158465dfc7870a2841e404c052801f9` 和 `f029c16921275ab44389daf3ab5a12eb4510d965`。
- 验证入口见[测试说明](../test/README.md)及[逐项交接](MACOS_0.6.7_HANDOFF.md)。真实 AI 账户多语言质量、物理音频/权限撤销、触控板惯性和新硬件仍按条件单独验收；不以合成夹具代验。
- 正式应用未替换本机 Applications。历史发行、恢复基线、固定公开模型缓存及签名身份保持；Windows 全树、官网和独立服务端未改动。服务端 0.5.3/`3bceb615dbba900f669322c301fc4b5b473dfb15` 仅作为临时只读验证参考。
- 本轮共享英文布局细调留待 Windows 后续在本机复核；不从 Mac 重建或覆盖现有 Windows 0.6.7 安装资产。

Both repositories now link to the Mac 0.6.7 installer. Physical-device and real-account checks remain conditional, as documented in the handoff. The installed application, historical releases, recovery baselines and signing identities are preserved. No website or server deployment is included.
