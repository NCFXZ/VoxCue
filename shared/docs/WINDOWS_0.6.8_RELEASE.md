# Windows 0.6.8 发行 / Windows 0.6.8 release

发布日期 / Published: 2026-11-03。

[公开发行 / Public release](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.8)，发行 ID `433044880`，设为 Latest，非预发行。发布说明提供简体中文与 English。

产品源码输入为 [`aebffb871d948d6cd1b71d95ddb419a711933e41`](https://github.com/NCFXZ/VoxCue/commit/aebffb871d948d6cd1b71d95ddb419a711933e41)，版本唯一来源为 `shared/package.json = 0.6.8`。后续进度、交接和发行文档提交不改变安装包输入。

The installer was built from the source commit above. Later documentation-only commits do not change its contents. The sole version source is `shared/package.json`.

## 正式资产 / Release assets

三项文件本地归档于 `windows/release/0.6.8`，仅上传发行资产，不进入源码 Git。

These three files are archived locally under `windows/release/0.6.8` and uploaded as release assets, not committed to the source repository.

| 文件 / File | GitHub asset ID | Bytes | SHA256 |
| --- | --- | ---: | --- |
| [VoxCue-Setup-0.6.8-x64.exe](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.8/VoxCue-Setup-0.6.8-x64.exe) | 706567961 | 407578769 | `71788edfd7efd769956eef7329cfa73770db8baa44e4ba3fcc957ac953caebff` |
| [VoxCue-Setup-0.6.8-x64.exe.blockmap](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.8/VoxCue-Setup-0.6.8-x64.exe.blockmap) | 706571185 | 422193 | `6f8142086386a3ec7f0932442d254acd3cfdf89bf3e400f461c20e41e8965876` |
| [latest.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.8/latest.yml) | 706571210 | 349 | `c0c232fa3c60f77fd5ecb782554e56a32badae81f7693f598475b64f96c7c855` |

EXE 用于首次安装或手动升级；blockmap 和 latest.yml 用于应用内更新。构建沿用既有 Windows 签名配置，本次 EXE 的 Authenticode 状态为 `NotSigned`；未新增或轮换签名身份。依赖、SDK 与模型版本沿用 0.6.7。

Use the EXE for installation or manual upgrades. The blockmap and latest.yml support in-app updates. This build retains the existing Windows signing configuration; the EXE is not Authenticode-signed. No signing identity, dependency, SDK, or model upgrade is included.

## 平台与接续 / Platforms and follow-up

- Windows 最新完整稳定发行为 0.6.8；Mac 保留 [0.6.7](MACOS_0.6.7_RELEASE.md)，按本平台完整稳定资产选版，不能仅凭 Latest 标签跨平台更新。
- 主要变化为低用量主动预警、三个界面的周期摘要、提示区滚动与中英文排版，以及分数 DPI 缩放和转写切换时的窗口尺寸保持。
- Mac 按 [M001–M046 逐项交接](MACOS_0.6.8_HANDOFF.md)完成本机同步、原生验证和签名打包；其中分别说明产品修改、测试中修复的代码/夹具，以及测试流程优化边界。
- RAG 产品代码、模型、参数、阈值和检索策略沿用 0.6.7。本次测试流程优化只涉及外层调度与资源准备，RAG 仅验面试功能调用链；不保留探索性 RAG 修改。
- 历史发行、模型资源、签名与更新身份保持。官网及独立服务端未部署，Mac 全树未从 Windows 修改。

Windows uses the complete stable 0.6.8 release; Mac remains on 0.6.7 until native validation and packaging. The Mac handoff lists each product and test-fixture change and defines test-orchestration limits. RAG implementation, models, parameters, thresholds, and retrieval strategy remain at the 0.6.7 baseline. Existing releases and identities are preserved. No website or server deployment is included.
