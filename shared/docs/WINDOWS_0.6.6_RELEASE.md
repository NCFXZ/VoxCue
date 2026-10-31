# Windows 0.6.6 发行

发布日期：2026-10-31。公开发行：[VoxCue 0.6.6 · Windows x64](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.6)，发行ID `430147173`，已设为Latest。本文仅保存来源与正式资产元数据，不保存测试报告或成绩。

产品源码输入为 [`371e8ce320b2972cc99790417e06a7bfb81509ab`](https://github.com/NCFXZ/VoxCue/commit/371e8ce320b2972cc99790417e06a7bfb81509ab)。之后的发行文档提交不改变包输入；版本唯一来源为`shared/package.json=0.6.6`。

## 正式资产

本地三项归档于`windows/release/0.6.6`，不进入源码Git。仅这三项上传公开发行仓库，源码、模型、依赖目录、调试文件、用户资料和凭据不随发行上传。

| 文件 | GitHub资产ID | 字节数 | SHA256 |
| --- | --- | ---: | --- |
| [Windows x64安装包](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.6/VoxCue-Setup-0.6.6-x64.exe) | 696328292 | 406486757 | `d4dee23a6c76e4e29acad8748514c67033d06c359a4914dedbc1cf7bbcd2d9a5` |
| [blockmap](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.6/VoxCue-Setup-0.6.6-x64.exe.blockmap) | 696329626 | 421104 | `50fdbe137103c6bea68fe1352e0ab5756e29f1413e2ce39df6f6f4b3fc27f797` |
| [latest.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.6/latest.yml) | 696329678 | 349 | `854a3879347e0ff8fe83749b03ba4b7ce00e3027b582f01f935aeed58725f0b9` |

首次安装或手动升级下载EXE；blockmap及latest.yml供应用内更新。清单由正式构建生成，包含安装包大小及SHA512。Windows沿用既有未配置Authenticode的发行方式，未新增或轮换签名身份。

## 用户可见变化

- 恢复面试背景透明度调节，设置预览与实际面试同步字号和材质。
- 新增可滚动图文预览，优化顶部渐隐、细滚动条、胶囊材质及生成光标；可见1秒后仅向下提示一次，用户操作立即接管。
- 柔化聊天与面试的思考扫光，对齐问题反馈链接。
- 加快Windows截图，修复语音模型切换时偶发的积压误停。

逐项源码变化和Mac本机要求见[0.6.5→0.6.6交接](MACOS_0.6.6_HANDOFF.md)。

## 更新与接续

- 仓库Latest为v0.6.6；客户端仍按本平台完整稳定资产选版，Windows为0.6.6，Mac仍为[既有0.6.5完整发行](MACOS_0.6.5_RELEASE.md)。
- 保留既有Mac资产、旧发行及models-v1.0.0资源；不改写Mac签名、更新身份或Windows现有用户资料，模型与索引继续复用。
- 公开发行仓库README已同步Windows 0.6.6和Mac 0.6.5的下载链接，移除指向已标记不可用旧版的入口及已退役的时长兑换描述；独立官网未部署。
- Mac 0.6.6的本机配置/锁、CPU/Metal切换、截图适配、权限/窗口和签名验包仍按交接文档接续。
