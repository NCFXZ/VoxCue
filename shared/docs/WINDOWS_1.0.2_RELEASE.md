# Windows 1.0.2 发行索引 / Windows 1.0.2 release index

更新日期 / Updated: 2026-11-08。

当前状态：准备发行，尚未上传 1.0.2 安装包或提交商店更新。 / Status: release preparation; the 1.0.2 installer and Store update have not yet been published or submitted.

产品变化见 [简体中文 / English](RELEASE_1.0.2.md)，Mac 本机逐项接续见 [1.0.0 → 1.0.2](MACOS_1.0.2_HANDOFF.md)。本文仅记录发行输入、资产、实际发布状态及修复范围，不保存测试成绩、截图或运行报告。

## 范围与来源

| 项目 / Item | 目标或当前事实 / Target or current fact |
| --- | --- |
| 应用版本 / Application | `1.0.2`；唯一来源 `shared/package.json` |
| Windows 公开升级基线 / Public Windows baseline | `1.0.0`，包输入 `a47f7435ef7c233eee9da87a18261162dfaee65f` |
| Mac 公开完整基线 / Complete Mac baseline | `1.0.0`，包输入 `f6e06e3f62395c0d6b78bafdfceabb347c91ac27`；本轮不生成 Mac 包 |
| 远端后续工作 / Remote follow-up | `d131fa5540121fc89c1fe1429da0e7ee95e54ba4`；保留 Mac 发行与原生夹具提交，共用英文单周期额度网格并入 Windows 验证 |
| 源码与包输入 / Source and package input | 待最终冻结 / pending final freeze |
| 源码仓库 / Source repository | 私有 `NCFXZ/VoxCue`；不向公开发行仓库上传客户端源码或用户资料 |
| 公开发行仓库 / Public release repository | `NCFXZ/VoxCue-releases`；目标标签 `v1.0.2` |
| Store 基线 / Store baseline | 提交 4（`1152921505702342674`）的 1.0.1 发布者名称维护版；2026-11-08 Partner Center 概览确认最新产品已上架 |

Windows 上 `macos/` 全树保持原字节；Git 合入保留远端 Mac 提交，不通过覆盖另一平台工作树同步版本。旧版本正式资产、签名/更新身份、现用模型/依赖及恢复基线保持。

## GitHub Windows 安装与更新资产

| 文件 / File | Bytes | SHA256 | 发布状态 / Status |
| --- | --- | --- | --- |
| `VoxCue-Setup-1.0.2-x64.exe` | 407654519 | `0f71b41bb402b1aeeb2e93d1a5216c64911eeda3eef202f158854472a52f9b32` | 已构建，未上传 |
| `VoxCue-Setup-1.0.2-x64.exe.blockmap` | 422092 | `82a287d298fd76fc3affa69584e2cb9488d24b3862455f0b559ab1acd3cefea3` | 已构建，未上传 |
| `latest.yml` | 349 | `2a3cd9b22f30224b6439ad1c5f989ac72c46e8776dc80a263981fec82c6a502a` | 已构建，未上传 |

目标归档为 `windows/release/1.0.2/`；临时打包输出为 `windows/release/installer/`。正式公开后再记录准确 URL、release/asset ID、发布时间和匿名完整下载核对状态。Mac 完整 1.0.2 资产尚未由本机生成前，Mac 更新应继续选择已完整发布的 1.0.0，不能取用 Windows EXE/APPX 或把全局 Latest 当作 Mac 完整版本。

## Microsoft Store

| 项目 / Item | 目标或当前事实 / Target or current fact |
| --- | --- |
| 产品 ID / Product ID | `9PBBVWZXMBPW` |
| Identity Name | `NCFX.VoxCue` |
| Publisher | `CN=CC9C4962-FFC8-44D9-A2C0-B446CBFD375A` |
| PublisherDisplayName | `F. Zhu`，保持 1.0.1 维护后的值 |
| 包身份版本 / Package version | `2.0.2.0`；沿用共享主版本加一与末位零映射 |
| APPX | `windows/release/store/VoxCue-Store-1.0.2-x64.appx` |
| Bytes / SHA256 | 待构建 / pending build |
| 提交 / Submission | 尚未创建 1.0.2 提交 / not yet created |
| 认证与实际上架 / Certification and availability | 未提交 / not submitted |

商店版由 Microsoft Store 更新，不包含独立安装版的 `app-update.yml`。Sandbox 仅在可丢弃来宾内对临时 APPX 副本签名、安装和验证；不在宿主安装测试证书，不改变固定 Publisher。包内校验、Sandbox 运行、Partner Center Validated、提交认证和实际上架分别记录，不相互替代。

## 本轮发现与修复范围

- 旧 DOC 容器在进入固定 OLE 解析器前校验目录名称长度、类型、指针、图所有权与深度，拒绝循环、重复分支与指数展开，保留合法嵌套目录。
- 取消导入后保留任务/字节预算至实际响应或进程退出，DOC Worker 支持传递取消并等待终止；退出未确认时拒绝替代初始化，关闭和卸载有明确期限，保留原件与未完成任务的资源归属。
- DOCX 在 Mammoth 前校验同一私有 ZIP 输入及逐项实际解压、CRC/消费长度，最多 4096 项、32 MiB/项、64 MiB 累计，防止伪造声明绕过资源上限；原文字与索引兼容保持。
- 云同步控制请求的错误与 401 过期事件绑定账号代次，断开或切账号后旧操作不得覆盖新状态，新账号的实际新失败照常显示。
- 不支持文件的批次名单使用中性逗号分隔，英文提示兼容单个或多个文件；原文件名内的中文符号与 Unicode 保持，不对显示名单做全局字符替换。
- 真实 utility 进程边界夹具改为断言超时后的迟到回复不能提前结算、实际退出后才创建替代进程；保留取消分类、零 provider 和原 15 秒 RAG 期限检查。
- 云菜单夹具按点击展开检查；预览经真实 UI 追加合成文档，等待实际溢出和稳定入场后校验标题遮罩，不将短列表的正确透明行为误报为产品问题。包级组件提示严格匹配新的通用语音识别文案。
- Windows 原生鼠标探针改用虚拟桌面物理像素的绝对输入，移除相对加速绕行及覆盖最终事件的定位；保留精确坐标、原生命中、悬停和拖动断言，不改浮窗产品逻辑。
- 聊天专项保留原删除流程并补位置/动画回归；安装引擎保持旧 0.5.1 夹具，新增显式 1.0.0→1.0.2 参数。解析错误文案回归严格匹配新的完整提示，不放宽断言。
- 对应 Mac 操作与验收预期逐条进入独立接续清单，不以 Windows 结果标为 Mac 已完成。

## 验证入口与边界

- 当前平台执行完整类型、架构、工作区、严格未使用声明、单测、依赖审计和构建；依赖沿冻结版本，不借发行升级模型或 SDK。
- 共用功能矩阵保留原有 20 轮面试与 600 秒固定公共音频长稳，覆盖英文、对抗、账号、同步、更新、文档和界面；GUI/原生/推理串行，并使用持续的解锁桌面守卫。
- Windows 原生、五档 100/125/150/175/200% 缩放、最终 NSIS/APPX、隔离安装与 Store Sandbox 单独执行。物理采集不纳入本轮，屏幕处理使用归属明确的合成像素；不以合成验证冒充真实硬件验收。
- Paraformer 与 Qwen 的额外 WAV 全链路使用实际识别器和隔离回答计数，空转写不计过滤成功；语音 WAV 为本机 SAPI 合成，不宣称为真人录音。
- 客户端联调只使用 owner 系统临时目录内固定 0.5.3 / `3bceb615dbba900f669322c301fc4b5b473dfb15` 参考，现用服务端保持原样。
- 临时 profile、数据库、音频、截图和参考副本结束清理；可复用公共资源按固定摘要认证后保留。具体边界见 [工作区清理](WORKSPACE_CLEANUP.md)。
