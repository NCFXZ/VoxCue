# Windows 1.0.1 发行索引 / Windows 1.0.1 release index

更新日期 / Updated: 2026-11-07。

当前状态：Store 发布者名称维护更新已重包并提交认证。提交 4 当前预处理，通过后自动发布；提交 3 已上架，旧 APPX 保留。 / Status: the Store publisher-name maintenance update has been repackaged and submitted for certification. Submission 4 is in preprocessing, with automatic publication after approval. Submission 3 is live, and its APPX is retained.

产品说明见 [1.0.1 简体中文 / English](RELEASE_1.0.1.md)。本索引只记录发行范围、资产元数据与实际提交状态，不保存测试成绩、报告或截图。

| 项目 / Item | 目标或当前状态 / Target or current state |
| --- | --- |
| 应用版本 / App version | `1.0.1`，唯一来源为 `shared/package.json` / sole source: `shared/package.json` |
| 安装包源码输入 / Package source | `20ada2f0d3ec6ea3909ae8a05c64642c21ad6416` |
| Store Identity 版本 / version | `2.0.1.0`，沿用主版本加一及末位零的映射 / existing major-plus-one, trailing-zero mapping |
| Store 产品 ID / product ID | `9PBBVWZXMBPW` |
| Identity Name | `NCFX.VoxCue`，不变 / unchanged |
| Publisher | `CN=CC9C4962-FFC8-44D9-A2C0-B446CBFD375A`，不变 / unchanged |
| PublisherDisplayName | `NCFX` → `F. Zhu` |
| APPX 目标 / target | `windows/release/store/VoxCue-Store-1.0.1-x64.appx` |
| APPX 字节数 / bytes | `600079269` |
| APPX SHA256 | `6b57aa0f35eea6d83aaa7b6c6dce557cf9bb9a309e4fb4a27e292da01f367e20` |
| Partner Center 提交 / submission | 提交 4 / submission 4；ID `1152921505702342674`；APPX 已上传并显示 Validated / uploaded and validated |
| 提交、认证与发布 / Submission, certification and publication | 2026-11-07 已提交认证，当前预处理，通过后自动发布；尚未确认新版本已上架 / Submitted on 2026-11-07, in preprocessing, automatic publication after approval; the update is not yet confirmed live |
| 已上架基线 / Live baseline | 提交 3 / submission 3，ID `1152921505702342173`；`1.0.0` APPX 保留 / APPX retained |

在 `windows/` 使用 `pnpm package:store` 重包，再运行 `pnpm test:store:artifact` 和 `pnpm test:store:sandbox`。Sandbox 只在可丢弃来宾内签署临时副本；宿主 APPX、固定 Publisher 和包家族身份保持。验包不能替代 Partner Center 认证或实际上架状态。

本轮构建暂存 `store-stage`、`store/resources` 和 `store/builder-debug.yml` 已按真实路径、链接及占用边界清理。正式 1.0.1 APPX 与全部旧正式/恢复包继续保留；中英商品版本说明已同步本次发布者名称维护内容。

Repackage with `pnpm package:store` from `windows/`, then use `pnpm test:store:artifact` and `pnpm test:store:sandbox`. Sandbox signing applies only to a temporary copy inside the disposable guest. The host APPX, fixed Publisher and package family identity are preserved. Package checks do not establish Partner Center certification or publication.

GitHub 独立 NSIS 安装版仍为已公开的 [Windows 1.0.0](WINDOWS_1.0.0_RELEASE.md)，本轮不重建或替换其资产。共享版本 `1.0.1` 仅同步根和 Windows 生成配置；Windows 不写 `macos/`。Mac 完整发行基线仍为 `0.6.9`，由 Mac 本机按既有交接清单接续、同步配置并独立发行。

The public GitHub NSIS installer remains [Windows 1.0.0](WINDOWS_1.0.0_RELEASE.md); its assets are not rebuilt or replaced in this round. Shared version `1.0.1` is synchronized only to root and Windows generated configuration. Windows does not write `macos/`. The complete Mac release remains `0.6.9`; local follow-up, configuration synchronization and release remain required on Mac.
