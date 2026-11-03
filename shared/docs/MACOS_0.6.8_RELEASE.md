# Mac 0.6.8 发行 / Mac 0.6.8 release

发布日期 / Published: 2026-11-03。

[公开发行 / Public release](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.8)，发行 ID `433044880`，保持 Latest。Mac 三项追加到既有发行；Windows 三项资产的 ID、大小和摘要保持，见 [Windows 发行索引](WINDOWS_0.6.8_RELEASE.md)。本文只记录来源、实现范围及资产元数据，不保存测试成绩。

Mac 产品源码输入为 [`a91b977068c8753378be8f919cafe62939533018`](https://github.com/NCFXZ/VoxCue/commit/a91b977068c8753378be8f919cafe62939533018)，接续共享基线 `c00b60a`。版本唯一来源为 `shared/package.json = 0.6.8`；后续发行说明和进度文档提交不改变安装包输入。

The Mac installer was built from the source commit above. Later documentation-only commits do not change its contents. Existing Windows release assets are preserved.

## 正式资产 / Release assets

三项归档于 `macos/release/0.6.8`，仅作为公开发行资产上传，不进入源码 Git。Apple Silicon arm64，macOS 14.2 及以上。

| 文件 / File | GitHub asset ID | Bytes | SHA256 |
| --- | --- | ---: | --- |
| [VoxCue-0.6.8-arm64.dmg](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.8/VoxCue-0.6.8-arm64.dmg) | 706864973 | 654078228 | `477b81c4a1862a86b8f1e6fac7314778d4bafabe6abbb20cdef30c8152523476` |
| [VoxCue-0.6.8-arm64.zip](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.8/VoxCue-0.6.8-arm64.zip) | 706872059 | 607777989 | `d5abe864ecbeca796d9708360230ffe2a4cfb84c7f500aa4788816b425c95815` |
| [latest-mac.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.8/latest-mac.yml) | 706879973 | 490 | `840b869b452ef029044d098e5092de0e319fb7bf68eeceddd742f6873431651c` |

DMG 用于首次安装和手动升级；ZIP 与 latest-mac.yml 用于应用内更新。沿用既有本地代码签名、凭据助手、host-id 和 Ed25519 更新身份，不新增或轮换身份；不等同 Developer ID 签名或 Apple 公证。依赖、运行时 SDK、语音与检索模型版本保持。

Use the DMG for installation or manual upgrades. The signed ZIP and latest-mac.yml support in-app updates. The existing local code-signing, credential and update identities are unchanged; this is not Developer ID signing or notarization. Dependency, runtime SDK and model versions remain unchanged.

## 接续 / Follow-up

- 同步 0.6.8 的完整额度选择、低用量主动预警、紧凑周期摘要、提示区和窗口比例规则。Mac 保留自然工具栏和原有窗口适配；低用量摘要使用账号卡完整宽度，避免最小窗口下双周期数值裁切。
- Mac 测试外层增加完整排程预览、定向复测与按需资源准备；保留原功能清单，并将完整用量组合追加至五档缩放。普通失败或子进程启动错误仍执行其余所选组并保留失败状态；锁定或未知控制台停止 GUI。
- RAG 实现、模型、目录契约和行为沿用 Mac 0.6.7 / `0178df3802e3018b67655f2fbd59593f9d29d546`，不包含 RAG 功能更新或语义质量优化。验证入口见[测试说明](../test/README.md)与[逐项交接](MACOS_0.6.8_HANDOFF.md)。
- 真实 AI 账户多语言质量、物理音频与权限撤销、触控板惯性、新硬件、旧系统实机和实际屏幕共享软件组合仍按条件验收，合成夹具不能代验。
- 本机正式安装、Windows 全树、全部历史发行和恢复基线保持原位；本轮官网及独立服务端保持原部署。固定公开测试缓存保留，临时合成资料及执行副本退出清理。共享侧栏布局修复留待 Windows 后续在本机复核，不从 Mac 重建其安装包。

Conditional real-account, physical-device and compatibility checks remain separate. The installed application, Windows tree, historical releases and recovery baselines are preserved. No website or server deployment is included.
