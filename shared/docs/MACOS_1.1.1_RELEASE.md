# Mac 1.1.1 发行 / Mac 1.1.1 release

发布日期 / Published: 2026-11-10T14:58:59Z。完整三项已发布至 [v1.1.1](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.1.1)，Release ID 440499445，标记 Latest；中英文正文与 [发行说明](RELEASE_1.1.1.md) 一致。

Mac 安装包源码输入为 [e0a2a874bffbc37d5af57554074ade6fb7a8f446](https://github.com/NCFXZ/VoxCue/commit/e0a2a874bffbc37d5af57554074ade6fb7a8f446)，已推送私有源码 main，固定标签 v1.1.1 指向该输入。后续发行索引与 Windows 交接文档不改变已发布 Mac 资产；Windows 接续修复不能移动这个标签。

The Mac package was built from the source commit above. Later release-index and Windows handoff documentation do not change its production code or assets.

## 正式资产 / Release assets

本机保留于 macos/release/1.1.1/，不提交源码 Git。适用于 Apple Silicon arm64、macOS 14.2 及以上。

| 文件 / File | GitHub asset ID | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| [VoxCue-1.1.1-arm64.dmg](https://github.com/NCFXZ/VoxCue-releases/releases/download/v1.1.1/VoxCue-1.1.1-arm64.dmg) | 731807543 | 654342368 | 98b6fb4312b2933e4eb873406b5aadb21143cd49a4c45d838d000c489f96a954 |
| [VoxCue-1.1.1-arm64.zip](https://github.com/NCFXZ/VoxCue-releases/releases/download/v1.1.1/VoxCue-1.1.1-arm64.zip) | 731811058 | 608058445 | 9b567b8d7311424374dfb00e1a91af2ec109fed28d2da678f52329f99c4c982d |
| [latest-mac.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v1.1.1/latest-mac.yml) | 731817285 | 490 | a736bbc20a7e9a2e31a653de38d2390aebaadbbc1ed2db76f5f9dd078df579fe |

GitHub 资产长度与 SHA256 和本地一致。匿名生产更新器已选择 1.1.1 的本平台完整资产，认证签名清单并下载正式 ZIP，完成 SHA512 核验。DMG 用于安装／手动升级，ZIP 与清单用于应用内更新。

沿用固定本地代码签名、凭据助手与 Ed25519 更新身份，公开指纹见 macos/local-signing-public.json；未使用 Apple Developer ID 或公证。全部旧正式／恢复资产保持。

The DMG supports installation and manual upgrades. The signed ZIP and manifest support in-app updates. Existing code-signing, credential and update identities are retained; this is not an Apple Developer ID or notarized build.

## 变化、接续与边界 / Scope and follow-up

- 快捷键原生符号、Command 录入、转写显隐画布、动态帮助、退出保护、主题色 checkbox 和额度顺序等逐项来源见 [Mac 交接追加清单](MACOS_1.1.0_HANDOFF.md)；验证入口见 shared/test/README.md，不在本索引保存成绩。
- 最终负载入口覆盖移动资源依赖闭包与 ws 服务、私有路径拒绝、实际 SDK 子进程、文档与编码、离线索引及更新归档。真实 1.0.0 临时应用与同一合成 profile 的归档覆盖兼容，与 Sparkle 对最终归档的认证／暂存／取消分别核对，不把临时替换称为真实自动更新提交。
- 只用合成账户／资料、文件 TTS 和固定摘要公共模型／音频；空输出或误识别不作为语气词过滤证据。不证明真实订阅、物理采集、实际 iPhone／Android 键盘、安全区或私人网络权限。
- 局域网连接使用 HTTP／WS，仅用于可信私人网络／热点。独立官网、服务端与 Store 不部署。
- [Windows 1.1.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.1.0) 的三项资产 ID／长度／摘要保持，1.0.2 和 1.0.0 资产亦保持。全局 Latest 为 Mac-only 1.1.1 时，共享生产选择器针对 Windows 仍选完整 1.1.0。
- 用户已确认 Windows 由其本机按 [1.1.0 → 1.1.1 更新与测试交接](WINDOWS_1.1.1_HANDOFF.md) 接续；Windows 全树未由 Mac 修改，本轮 Mac 结果不替代 Windows 原生验收。
