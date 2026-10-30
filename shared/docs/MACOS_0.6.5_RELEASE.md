# VoxCue 0.6.5 Mac发行索引

公开发行：[VoxCue 0.6.5](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.5)，发行ID `428910586`，Latest为v0.6.5。本文仅记录来源及资产元数据，不保存测试成绩或执行报告。

Mac比较基线为已发布0.6.3产品快照 `c37fa181156617c58bc3eb4a509334057d4a38f3`。共享0.6.5产品来源为 `71948317e625c3e464413c7ff424de800c75853a`；本轮Mac产品源码为 [`2607b5a837b1d8eaa97768f5514cd24ff91e4184`](https://github.com/NCFXZ/VoxCue/commit/2607b5a837b1d8eaa97768f5514cd24ff91e4184)，正常续接main及其后续交付文档，未回退旧提交。后续发行文档提交不改变包输入。

正式三项保留于 `macos/release/0.6.5`，不进入源码Git；Apple Silicon arm64、macOS14.2+，沿用既有本地代码签名、原凭据助手、host-id及Ed25519更新身份。

| 资产 | GitHub资产ID | 字节数 | SHA256 |
|---|---|---|---|
| [DMG](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.5/VoxCue-0.6.5-arm64.dmg) | 692660362 | 651433178 | `05eea4ba4bb8218829e610c0da41717fff215d133ae32b784b1fb1ffe70de9fb` |
| [签名ZIP](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.5/VoxCue-0.6.5-arm64.zip) | 692664286 | 605255485 | `70961a37e9974c52a7f8f78c483540f592586fc883c886022bd1cbab5d3ae840` |
| [latest-mac.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.5/latest-mac.yml) | 692666779 | 490 | `03cacc5fffaec54dce397ec538158ab66021ec9f6715940d9c670f242c96fa8a` |

既有Windows0.6.5安装/更新三项保持，不从Mac重新构建；本轮两处共享队列修复仍需Windows本机接续。独立服务端0.5.3/`3bceb615dbba900f669322c301fc4b5b473dfb15`仅作只读隔离参考，服务端及生产未作变更。真实本机安装未替换。

接续范围和待办见[PROGRESS](../../PROGRESS.md)，逐项要求见[Mac交接](MACOS_0.6.5_HANDOFF.md)，协议见[客户端统计v2](CLIENT_TELEMETRY.md)。
