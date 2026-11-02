# Windows 0.6.7 发行 / Windows 0.6.7 release

发布日期 / Published: 2026-11-02。

[公开发行 / Public release](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.7)，发行 ID `431943986`，设为 Latest。发布说明提供简体中文与 English。

产品源码输入为 [`f3d71cd8b183d328cf623e7b3bc29b35054adfe8`](https://github.com/NCFXZ/VoxCue/commit/f3d71cd8b183d328cf623e7b3bc29b35054adfe8)，版本唯一来源为 `shared/package.json = 0.6.7`。后续 README、进度和发行文档提交不改变包输入。

The installer was built from the source commit above. Later documentation-only commits do not change its contents. The sole version source is `shared/package.json`.

## 正式资产 / Release assets

三项文件本地归档于 `windows/release/0.6.7`，仅上传发行资产，不进入源码 Git。

These three files are archived locally under `windows/release/0.6.7` and uploaded as release assets, not committed to the source repository.

| 文件 / File | GitHub asset ID | Bytes | SHA256 |
| --- | --- | ---: | --- |
| [VoxCue-Setup-0.6.7-x64.exe](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.7/VoxCue-Setup-0.6.7-x64.exe) | 703105174 | 407577488 | `5a18f3edd2a586aa737e6fe169cb957a80e1f388e2111c40181496b49344365b` |
| [VoxCue-Setup-0.6.7-x64.exe.blockmap](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.7/VoxCue-Setup-0.6.7-x64.exe.blockmap) | 703107315 | 422201 | `a787f20a59beb94d418ca1e1567884ec7a26206459040793276466846ab3738f` |
| [latest.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.7/latest.yml) | 703107337 | 349 | `26a70ee506c60b0a45cf63559170f19d500674e154ef2684faad66b7387bf3b7` |

EXE 用于首次安装或手动升级；blockmap 和 latest.yml 用于应用内更新。构建沿用既有 Windows 签名配置，未新增签名身份。依赖及模型版本沿用本次已交付的 0.6.7 源码。

Use the EXE for installation or manual upgrades. The blockmap and latest.yml support in-app updates. The build retains the existing Windows signing configuration and introduces no new signing identity.

## 平台与接续 / Platforms and follow-up

- Windows 最新完整稳定发行为 0.6.7；Mac 保留 [0.6.6](MACOS_0.6.6_RELEASE.md)，按平台完整资产选版。
- 两仓库 README 提供中文和英文文件，公开更新说明仅描述用户可见变化。
- 历史发行、模型资源、签名与更新身份保持；官网及独立服务端未部署。
- Mac 0.6.7 仍需本机完成[逐项交接](MACOS_0.6.7_HANDOFF.md)、本平台依赖同步、验证和打包。

Windows uses the complete stable 0.6.7 release; Mac remains on 0.6.6. Each platform selects its own complete release. Both repositories provide Chinese and English README files. Existing releases, model resources, and signing/update identities are preserved. No website or server deployment is included. Mac 0.6.7 requires its own native validation and packaging.
