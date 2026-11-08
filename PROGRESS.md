# VoxCue 当前进度

更新日期：2026-11-08。仅保存当前基线、任务与接续入口；长期规则见 AGENTS.md，详细变更及发行事实见 shared/docs，验证结果仅终端/对话。

## 当前任务：Mac 1.0.2

- 当前用户范围：优先资料导出，然后审查清理、完整安全/稳定/对抗、英文、视觉/五档、原生和安装更新验证，发现问题修复后复验；完成后提交推送源码，向既有 GitHub v1.0.2 追加 Mac 完整资产并保持 Latest。Mac 当前公开完整基线仍为 1.0.0，本轮尚未发行；Windows 已公开 1.0.2。
- 本机已同步共享 1.0.2 版本、生成配置及固定 `word-extractor@1.0.4` / `chardet@2.1.1`，未升级既有依赖或模型。Windows 全树只读；原件、数据库/索引兼容、签名/凭据/更新身份和全部正式/恢复基线保持。
- 本轮新增和测试夹具修正见 [Mac 接续清单 M135–M142](shared/docs/MACOS_1.0.2_HANDOFF.md)：最终包依赖与 DOC Worker/传统编码/检索/重开、真实 WAV→Controller/Worker→ACK→Renderer/provider、五档聊天滚动竞态、真实 1.0.0 归档覆盖升级资料保持、组件完整提示、本地化 voice 名称匹配、长按更新的失败专用诊断及旧版真实 RAG 缓存前提。
- 正式 Mac 资产保留于 `macos/release/1.0.2/`，源码输入为 `dcc1b5f19791fc021c53d85d5cb276ea6efe474f`；之后仅升级夹具与文档收尾，生产代码和资产保持。当前待办：提交推送收尾源码、上传 Mac 完整资产并保持 Latest，完成匿名在线回读及发行索引后交付。
- 短音节真实音频覆盖必须满足非空 silence 终稿和批准词表前提；空输出或误识别不计过滤通过，不扩词表或换模型代过。仅用 owner 合成账户/资料、本机文件 TTS 和认证公共模型/音频；不采样物理硬件，不访问真实账户或 Keychain 资料。
- GUI、原生和推理串行，持续核对当前 UID 已登录且解锁的控制台；临时防休眠只服务本轮运行。测试结果、截图与 profile 不留工作区。清理边界见 [工作区清理](shared/docs/WORKSPACE_CLEANUP.md)。

## 1.0.2 共用行为

- 知识库仅导入 PDF、Word（DOC/DOCX）、TXT、Markdown；批次先校验、合并不支持名单，支持传统文本编码，保留原件和索引兼容。DOC Worker、DOCX 实际 ZIP 展开预算、取消后的真实退出与容量归属见 [架构](shared/docs/ARCHITECTURE.md#本机文档存储)。
- 知识库错误归属、同步快照代次和账号切换后的迟到保护；同步状态菜单点击开合、实际内容自适应布局。自动发送仅拦截批准中文纯语气词/简短确认，保留原转写、草稿和手动发送及原 1800 ms 音频截止规则。
- 聊天中间内容切换动画、窗口运行期每聊天阅读位置/跟随状态；组件初读骨架、顶部提示居中及下载按钮首次宽度稳定；侧栏 AI 用量后台刷新保留旧值。中英及浅深主题共用。
- 完整逐项范围、保持基线和 owning source 见 [M068–M142 接续清单](shared/docs/MACOS_1.0.2_HANDOFF.md)；不以 Windows 验证代替 Mac 本机原生、签名或包验收。

## 验证入口

- 在 `macos/` 执行 `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:workspace`、`pnpm test`、`pnpm audit`、`pnpm build`；完整功能入口为 `node ../shared/test/scripts/functional-suite.mjs`，五档为 `node test/scripts/ui-refinement-matrix.mjs`。均可 `--list` 只读列排程，保留 20 轮面试及显式 600 秒音频。
- 独立表单、临时原生 vault、辅助功能、Qwen CPU/Metal 与真实 WAV 专项见 [测试入口](shared/test/README.md)。客户端联调仅使用固定 0.5.3 / `3bceb615dbba900f669322c301fc4b5b473dfb15` 服务端只读参考，放 owner 系统临时目录，不改独立服务端。
- 正式包使用 `pnpm package:installer`，再执行 `node test/scripts/package-runtimes-smoke.mjs`、`node test/scripts/package-smoke.mjs --install-archive`；公开完整资产后执行 `--online` 匿名签名/摘要回读。真实账户、硬件及自动化宿主不能触发的原生隐藏恢复按实际条件说明，不以合成覆盖代验。

## 当前发行与恢复基线

- Windows [GitHub 1.0.2](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.0.2) 已公开，源码/安装输入、资产摘要和渠道状态见 [Windows 发行索引](shared/docs/WINDOWS_1.0.2_RELEASE.md)。正式三项位于 `windows/release/1.0.2/`，Store 包位于 `windows/release/store/`；旧可运行预览保留。
- Microsoft Store ID `9PBBVWZXMBPW`。2026-11-08 最后观察：1.0.2 提交 5（`1152921505702346699`，包身份 `2.0.2.0`）预处理/认证中，通过后自动发布；尚未观察实际上架。提交 4 的 1.0.1 为已上架基线，仅发布者显示名改为 F. Zhu，固定包身份保持。实际状态以发行索引为准，不推断后续认证结果。
- Mac 公开 [1.0.0](shared/docs/MACOS_1.0.0_RELEASE.md) 安装输入为 `f6e06e3f62395c0d6b78bafdfceabb347c91ac27`；Windows 1.0.0 输入为 `a47f7435ef7c233eee9da87a18261162dfaee65f`。Mac 1.0.0 后续工作及原生夹具维护已保留合入，不用 Windows 快照覆盖 Mac 树。
- 两端全部旧正式/恢复包、固定签名/更新身份、现用依赖及认证公共缓存保留，包括 [Mac 0.6.8](shared/docs/MACOS_0.6.8_RELEASE.md)、[Windows 0.6.8](shared/docs/WINDOWS_0.6.8_RELEASE.md) 和旧 0.6.7 基线；历史细节查对应文档及 Git。

## 独立官网与介绍文档

- 官网 `https://voxcue.com.cn/` 既有 EdgeOne 项目 `makers-vmb1klm3vlre`，当前生产部署 `dpepxrh9jafl`（2026-11-07）。本轮客户端任务不修改官网、域名、DNS或服务端。中英下载入口现为 Mac、Windows、Microsoft Store；前两项仍直链 GitHub 1.0.0，商店 ID 保持。
- 官网工作副本：`C:/Users/fengk/.codex/visualizations/2026/11/07/01a1b7c5-614f-7d82-826a-b64c3c40ea3c/voxcue-website`；当前部署包为其 `migration/voxcue-independent-20261107T211159Z.zip`。原部署 `dp5dhu06kprd` 及 2026-11-06 副本保留回退，接续用该副本 README。
- 两仓库中英文 README 仅保留用途、功能和注意事项，不放版本日志、安装或开发说明；隐藏功能及触发方式不进入公开介绍。发行细节使用专门发行文档。
