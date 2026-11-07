# Mac 1.0.0 发行 / Mac 1.0.0 release

Mac 资产追加日期 / Mac assets added: 2026-11-07；最后一项创建于 `2026-11-07T20:25:48Z`。三项已追加到既有 [v1.0.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.0.0)，发行 ID `437694751`，保持 Latest。匿名生产更新器已完成本平台完整包回读与签名/摘要认证；Windows 三项资产的 ID、大小与摘要保持，见 [Windows 发行索引](WINDOWS_1.0.0_RELEASE.md)。

Mac 安装包源码输入为 [`f6e06e3f62395c0d6b78bafdfceabb347c91ac27`](https://github.com/NCFXZ/VoxCue/commit/f6e06e3f62395c0d6b78bafdfceabb347c91ac27)，已推送私有源码主分支。唯一版本源为 `shared/package.json = 1.0.0`。后续发行文档提交不改变安装包内容。

The installer was built from the source commit above. Later release documentation does not change its contents.

## 正式资产 / Release assets

资产保留在 `macos/release/1.0.0`，仅上传公开发行，不提交源码 Git。适用于 Apple Silicon arm64、macOS 14.2 及以上。

| 文件 / File | GitHub asset ID | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| [VoxCue-1.0.0-arm64.dmg](https://github.com/NCFXZ/VoxCue-releases/releases/download/v1.0.0/VoxCue-1.0.0-arm64.dmg) | 721831578 | 654129976 | `64e8170b2b7b9b7c1da54a0fe0ac2aaf17331ac46dc2cf83d3e3311bf55b0fa3` |
| [VoxCue-1.0.0-arm64.zip](https://github.com/NCFXZ/VoxCue-releases/releases/download/v1.0.0/VoxCue-1.0.0-arm64.zip) | 721834534 | 607798274 | `5b0ce168419fc4f65fb6b1667276a12f3a2d0b65fd97867138c2463c6b98537f` |
| [latest-mac.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v1.0.0/latest-mac.yml) | 721840288 | 490 | `b474f21d72e3bd7d8dfabdfce744521a196eecca0e9116e4a168128a49f5dc0b` |

DMG 用于首次安装与手动升级；ZIP 和签名清单用于应用内更新。沿用固定本地代码签名、凭据助手、host-id 和 Ed25519 更新身份；本地签名不等同 Apple Developer ID 或公证。

Use the DMG for installation or manual upgrades. The signed ZIP and manifest support in-app updates. Existing code-signing, credential and update identities are retained.

## 接续与边界 / Follow-up and scope

- 同步 0.6.9 后的额度对齐、单周期呈现、网页活动来源胶囊与链接反馈，并修复 Mac 单周期英文的边缘裁切；详见 [逐项交接 M001–M066](MACOS_1.0.0_HANDOFF.md) 和 [中英发行说明](RELEASE_1.0.0.md)。
- 本机五档、Qwen 及临时凭据测试器使用持续桌面守卫；原生更新测试只认领本轮偏好域，确认关联进程退出后清理独占临时根。测试结果只在终端/对话，不进入本索引。
- Windows 树保持只读，已有 Windows 1.0.0 三项资产与 Store 1.0.1 维护基线保留，见 [Windows 发行索引](WINDOWS_1.0.0_RELEASE.md)。共享布局新增规则和生成版本漂移留其本机复核，不能将 Mac 结果代验 Windows。
- 依赖、模型、RAG 策略及数据兼容保持。测试仅使用合成账户/资料和固定公开资源，不证明真实订阅、物理音频或自动化宿主无法触发的隐藏恢复；Sparkle 最终归档在临时合成旧版本上认证暂存后取消，不替换真实安装。
- 历史正式及恢复基线、原件和现用缓存保留。临时账户、数据库、图像、模型运行副本及只读服务端参考按生命周期清理；独立官网与服务端不部署。
