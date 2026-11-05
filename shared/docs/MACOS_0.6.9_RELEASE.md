# Mac 0.6.9 发行 / Mac 0.6.9 release

Mac 资产追加日期 / Mac assets added: 2026-11-05；最后一项资产创建于 `2026-11-05T19:40:06Z`。

[公开发行 / Public release](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.9)，发行 ID `435539098`，保持 Latest。Mac 三项追加到既有发行；Windows 三项资产的 ID、大小与摘要保持，见 [Windows 发行索引](WINDOWS_0.6.9_RELEASE.md)。

Mac 安装包源码输入为 [`ca91f21cd17e947da492b6d296dcbff6b2859bb7`](https://github.com/NCFXZ/VoxCue/commit/ca91f21cd17e947da492b6d296dcbff6b2859bb7)，接续 `563ca42`，已推送私有源码主分支。版本唯一来源为 `shared/package.json = 0.6.9`；后续验包夹具与发行文档提交不改变三项资产的输入。

The installer was built from the source commit above. Later test and documentation changes do not change its contents. Existing Windows assets are preserved.

## 正式资产 / Release assets

三项保留在 `macos/release/0.6.9`，仅作为公开发行资产上传。适用于 Apple Silicon arm64 和 macOS 14.2 及以上。

| 文件 / File | GitHub asset ID | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| [VoxCue-0.6.9-arm64.dmg](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.9/VoxCue-0.6.9-arm64.dmg) | 714571186 | 654128207 | `b46a2334f798a9a11768bdf0a2e4c9ed1077b3a8b5745a31c37f8640eec24723` |
| [VoxCue-0.6.9-arm64.zip](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.9/VoxCue-0.6.9-arm64.zip) | 714574496 | 607797831 | `905abf186e3a38228467e8117aa8377fadcc31685c491331f66294353ce6d7cc` |
| [latest-mac.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.9/latest-mac.yml) | 714579728 | 490 | `2e4d085a677202c901869c5256f6568b4a45baaf227b88008c1df2087cf95981` |

DMG 用于首次安装及手动升级；ZIP 与 latest-mac.yml 用于应用内更新。沿用既有固定本地代码签名、凭据助手、host-id 和 Ed25519 更新身份。该签名不等同 Apple Developer ID 或公证。

Use the DMG for installation or manual upgrades. The signed ZIP and manifest support in-app updates. The existing local code-signing, credential and update identities are unchanged.

## 接续 / Follow-up

- 同步共享 0.6.9 界面与交互，并修复 Mac 菜单和弹窗退出时 SVG 遮罩丢失导致图标变成实心方块。接续及夹具见 [Mac 逐项交接](MACOS_0.6.9_HANDOFF.md#mac-本机接续)，公开中英变更见 [发行说明](RELEASE_0.6.9.md)。
- Mac 新增持久检查缓存、签名清单再认证、完整包离线恢复、中断清理/冷却与异步退出屏障；显式安装仍由 Sparkle 验归档。详见 [Mac 更新设计](../../macos/docs/UPDATES.md#持久检查与完整包恢复)。
- 固定依赖、运行时、语音和检索模型、RAG 策略及数据兼容保持。真实账号、物理硬件、权限撤销和自动化宿主未能触发的原生隐藏恢复留本机条件验收；Windows 主动取消冷却与新增共用快照改动留 Windows 本机复核。
- 本机真实安装、全部历史发行与恢复基线保留；独立官网与服务端不部署。测试使用临时合成资料和固定公开缓存，结果仅终端/对话。
