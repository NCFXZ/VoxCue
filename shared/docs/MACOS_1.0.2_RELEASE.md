# Mac 1.0.2 发行 / Mac 1.0.2 release

Mac 资产追加日期 / Mac assets added: 2026-11-08；最后一项创建于 `2026-11-08T17:33:46Z`。三项已追加到既有 [v1.0.2](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.0.2)，发行 ID `438326701`，保持 Latest，中英文发行说明已同步 Mac 安装与更新入口。匿名生产更新器已选中本平台完整包，认证更新元数据、下载正式 ZIP 并完成签名/SHA512 回读；Windows 三项资产的 ID、大小与摘要保持，见 [Windows 发行索引](WINDOWS_1.0.2_RELEASE.md)。

Mac 安装包源码输入为 [`dcc1b5f19791fc021c53d85d5cb276ea6efe474f`](https://github.com/NCFXZ/VoxCue/commit/dcc1b5f19791fc021c53d85d5cb276ea6efe474f)，已推送私有源码主分支。唯一版本源为 `shared/package.json = 1.0.2`。[后续升级夹具修正](https://github.com/NCFXZ/VoxCue/commit/87a317110ea3656963576c0c0d63353de87d5bee)及发行文档不改变生产代码或安装包内容。

The installer was built from the source commit above. Later test-fixture and release-documentation changes do not alter the production code or release assets.

## 正式资产 / Release assets

资产保留于 `macos/release/1.0.2/`，仅上传公开发行，不提交源码 Git。适用于 Apple Silicon arm64、macOS 14.2 及以上。

| 文件 / File | GitHub asset ID | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| [VoxCue-1.0.2-arm64.dmg](https://github.com/NCFXZ/VoxCue-releases/releases/download/v1.0.2/VoxCue-1.0.2-arm64.dmg) | 724670049 | 654223448 | `9f5ec490e2c40a8e2d1a709114d98267684f14995c8d5d7f6f560dc76597591d` |
| [VoxCue-1.0.2-arm64.zip](https://github.com/NCFXZ/VoxCue-releases/releases/download/v1.0.2/VoxCue-1.0.2-arm64.zip) | 724673549 | 607912229 | `090a9658bdbcb1705ccc4e059c9bf5dc9aba149df7492dab4c367a8b8985996c` |
| [latest-mac.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v1.0.2/latest-mac.yml) | 724678987 | 490 | `6460b3a2d5561fe56cd757808aadae37e741799b40a8b37b52ec4837a5b1e105` |

DMG 用于首次安装与手动升级；ZIP 和签名清单用于应用内更新。沿用固定本地代码签名、凭据助手、host-id 和 Ed25519 更新身份；签名指纹见 `macos/local-signing-public.json`。本地签名不等同 Apple Developer ID 或公证。

Use the DMG for installation or manual upgrades. The signed ZIP and manifest support in-app updates. Existing code-signing, credential and update identities are retained.

## 接续与边界 / Follow-up and scope

- 1.0.2 共用行为见 [中英发行说明](RELEASE_1.0.2.md)，逐项来源及本机补充见 [M068–M142 接续清单](MACOS_1.0.2_HANDOFF.md)。Mac 同步固定 DOC/编码依赖及最终包收集，既有依赖、模型、索引/数据库兼容和 RAG 策略保持。
- 最终 ASAR 验收覆盖 DOC、传统编码、精确文档检索及重开；DOC 取消限于真实 Worker 创建后的终止握手，不宣称已进入解析中。升级夹具使用真实已发行 1.0.0 临时副本、认证 RAG 缓存和同一合成 profile，保留原件、设置与旧索引。
- 归档覆盖升级的数据兼容与 Sparkle 对最终归档的认证/暂存/取消分别验收，不把临时归档替换称为真实自动更新提交，也不替换真实安装。
- 验证仅使用 owner 合成账户/资料、本机文件 TTS 和固定公开模型/音频；非空 silence 终稿、批准词表及真实音频 ACK 是过滤证据前提，空输出或误识别不计通过。不证明真实订阅、物理音频或自动化宿主无法触发的原生隐藏恢复；结果仅终端/对话，不进入本索引。
- Windows 全树只读，共享测试夹具维护仍由 Windows 本机复核，不以 Mac 结果代验。全部旧正式/恢复资产、原件、现用依赖及认证公共缓存保留；临时资料按 owner 生命周期清理，独立官网与服务端不部署。
