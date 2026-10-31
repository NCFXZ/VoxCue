# VoxCue 0.6.6 Mac发行索引

公开发行：[VoxCue 0.6.6](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.6)，发行ID `430147173`，Latest保持v0.6.6。本文仅记录来源及正式资产元数据，不保存测试成绩或执行报告。

共享产品来源为371e8ce，Mac正常续接Windows发行文档aaf7995；本轮Mac产品源码为 [`ff2fea76109dc9577d8f2e339877ba812126bc4f`](https://github.com/NCFXZ/VoxCue/commit/ff2fea76109dc9577d8f2e339877ba812126bc4f)。后续交付文档提交不改变包输入。此前Mac0.6.5产品基线2607b5a837b1d8eaa97768f5514cd24ff91e4184及历史发行保持。

正式三项保留于 `macos/release/0.6.6`，不进入源码Git；Apple Silicon arm64、macOS14.2+，沿用既有本地代码签名、原凭据助手、host-id及Ed25519更新身份。运行时依赖、SDK、模型/hash及RAG v7保持，构建锁按共享安全策略在Mac本机生成。

| 资产 | GitHub资产ID | 字节数 | SHA256 |
|---|---|---|---|
| [DMG](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.6/VoxCue-0.6.6-arm64.dmg) | 696482406 | 652840284 | `aef4e1877661dffc6ac6c3da1080d58b0899a812589ba6b0d74d4fe3d0927135` |
| [签名ZIP](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.6/VoxCue-0.6.6-arm64.zip) | 696485288 | 606549446 | `95452ab02382343f7f178304d785850ca6ca55a4df0bd39ad139c417abe4d2e3` |
| [latest-mac.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.6/latest-mac.yml) | 696492778 | 490 | `af08e2eb286e12e2a73638c9b1472750604c417694c59fc1c314487723c8f14d` |

Mac同步共享0.6.6界面、截图编码及模型切换修复，并修正分数缩放时顶部胶囊四边留白；普通胶囊随控件/内边距自然定高，登录紧凑预览仍保留原48px。Mac截图继续使用Electron路径，C040原生快速取屏为可选后续功能。逐项范围与验证入口见[交接](MACOS_0.6.6_HANDOFF.md)和[测试说明](../test/README.md)。

同一发行的Windows安装器、blockmap、latest.yml保持原ID/大小/摘要，见[Windows索引](WINDOWS_0.6.6_RELEASE.md)；本轮共享胶囊自然高度修复仍留Windows后续本机复核，不从Mac重建其安装包。公开发行README的两端下载入口同步为0.6.6，提交为f859feec1c2fcdaeeb221888d2779f026b61538a。

独立服务端0.5.3/3bceb615dbba900f669322c301fc4b5b473dfb15仅作只读隔离参考，旧shared/server不改动，不操作生产或部署官网。正式应用未替换到本机Applications；真实账户、物理音频、实际权限撤销和新硬件仍按[进度](../../PROGRESS.md)中的条件分别验收。
