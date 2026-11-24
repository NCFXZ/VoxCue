# VoxCue 当前进度

## 当前版本与范围

**2026-11-24 · Windows 1.3.3 已发布。** 版本唯一来源为 `shared/package.json`。Windows 与根配置已同步为 `1.3.3`；本轮在 Windows 工作，`macos/` 保持只读，由 Mac 本机补齐新图标适配、生成配置、实现原生差分并验收。Windows 商店身份版本为 `2.3.3.0`，已提交认证。

当前任务包含清理确认无用的内容、全面验证、修复后复测、源码推送 GitHub `NCFXZ/VoxCue` 的 `main`，以及将 Windows 正式资产发布到同一 GitHub 仓库和 CNB `voxcue-release/voxcue-release`，提交 Microsoft Store。两端共享功能与界面同步；RAG 只验功能，不改已调优模型、阈值和检索参数。

## 实现与文档入口

- [双语公开更新日志](shared/docs/1.3.3_UPDATE.md)：按用户确定的五条文案发布。
- [1.3.2 → 1.3.3 双端改动与 Mac 逐项交接](shared/docs/MACOS_1.3.3_HANDOFF.md)：AI 工具调用、资料提案、独立账号与额度、UI、公告、下载和测试中修正的回归入口。UI 独立列出；明确 Mac 也需要网络增量更新，不能用先下载完整 ZIP 的 Sparkle 路径代称已支持增量。
- [下载渠道](shared/docs/DOWNLOAD_CHANNELS.md)：大陆出口 IP 使用匿名 CNB 索引和资产，其他地区使用 GitHub；保留固定签名／摘要、Windows NsisUpdater 增量及全量兜底。组件固定原件已经镜像到 CNB `models-v1.0.0`，包含索引、语音、对齐模型和运行时。测试 1.3.2 已撤下，不重建；正式资产完整后才合并公开索引。
- [公告配置](shared/docs/ANNOUNCEMENTS.md)与[空配置](shared/docs/announcements.json)：官网静态 JSON、双语文案、可选按钮、版本／登录状态过滤、到期时间、三次关闭及不再显示。客户端一次展示一条公告，完成更新优先；官网配置需要单独上传，仓库文件不会自动部署。
- [架构](shared/docs/ARCHITECTURE.md)、[更新链](shared/docs/UPDATES.md)、[组件](shared/docs/COMPONENTS.md)和[验证入口](shared/test/README.md)保存对应长期技术说明。

本轮关于页分组首行复用统一标题间距，公告与设置定位纳入完整功能及五档缩放入口；旧回归同步新文案、额度卡结构、独立账号操作和显示窗口二次确认，保留功能与安全断言。像素对齐检测保留小数布局坐标至最终物理像素换算，避免整数 `clientWidth` 提前取整造成误报，并明确检查两侧 24px 留白。离线夹具在进入 Electron fetch 前拒绝非允许请求，并将未捕获异常直接报告为失败，避免原生错误框掩盖问题；加入拒绝后取消的专项。商店中英文截图使用临时合成的多轮聊天、面试记录和知识库资料，不向正式包加入演示入口。

共享窗口导航保护在缩放重置前检查 WebContents 是否已销毁，防止加载失败关闭窗口后的迟到事件触发异常；单测及快捷键专项覆盖失败后迟到的加载完成事件，Mac 交接列为本机必验项。最终 Windows 包已纳入该修正；包级偏好播种采用真实设置界面，验证阶段不重写旧数据。

Windows 发行验证已完成。复验入口包括五档缩放、`store-sandbox-smoke.mjs` 的 `--nsis-current`、`--nsis-upgrade-1.3.2`、默认 Store 首装、`--appx-upgrade-1.3.2`，以及 `updates-differential-smoke.mjs` 的实际差分与故障兜底。保留已认证 1.3.2 原件及可复用公开模型／音频，不以 Windows 验证代替 Mac 本机验收。

## 发行状态与接续待办

- 源码已推送 GitHub `main`；[GitHub v1.3.3](https://github.com/NCFXZ/VoxCue/releases/tag/v1.3.3) 已正式发布 Windows 安装器、blockmap 和签名清单。
- [CNB v1.3.3](https://cnb.cool/voxcue-release/voxcue-release/-/releases/tag/v1.3.3) 已同步三项原件；匿名入口完成完整摘要、清单／blockmap 一致性和 Range 字节核对后，已发布 `main/releases.json`。组件与历史条目保留；本次临时流水线已移除。
- Microsoft Store `2.3.3.0` 已上传并提交 Submission 12（`1152921505702489003`），当前为认证中／预处理，尚未表示新版正式上架。中英文各五张丰富截图、实际支持的 API 服务描述及用户确定的五条更新说明均已保存。
- Mac 接续按逐项交接补齐 `LogIn`、`CommentEdit`、`ListSquare` 图标适配、原生增量更新、固定签名与本机验收；追加资产时保留 Windows 文件和已发布标签。
- 官网公告静态配置尚需独立部署；客户端配置读取和过滤已接入，仓库示例不会自动上线。
- 本轮临时 profile、截图、日志、只读服务端参考和失去消费者的打包辅助文件已按归属清理；正式资产、恢复基线及可复用公开缓存保留。

## 已发基线与保留边界

- Windows 当前已发基线为 `1.3.3`；Mac 当前已发基线仍为 [1.3.2](https://github.com/NCFXZ/VoxCue/releases/tag/v1.3.2)，待本机完成 1.3.3 交接。Windows 1.3.2 原始发行源码为 `9a553ab7140b93704e5566c999e1bf0e27bc10a7`；本地正式 1.3.2 安装器、blockmap、清单和 Store 原件保留用于升级验证，不以新生成文件冒充旧包。
- Microsoft Store 当前正式可用版本仍为 `2.3.2.0`（Submission 11，`1152921505702467958`）；`2.3.3.0` 已进入认证流程。[商店入口](https://partner.microsoft.com/en-us/dashboard/products/9PBBVWZXMBPW/overview)
- Mac 1.3.2 的固定签名、冻结 v1／v11 凭据助手、现用模型／依赖及正式恢复原件保留；Mac 1.3.3 原生、签名、隔离 guest 和增量更新依照交接逐项在本机完成。后续追加 Mac 资产保留已发 Windows 文件，不移动既有发行标签。
- 旧客户端的 `NCFXZ/VoxCue-releases` 下载兼容保持；新源码与发行使用 `NCFXZ/VoxCue`。源码为 AGPL-3.0-only，组件许可证见 [第三方声明](THIRD_PARTY_NOTICES.md)。
- 已知边界：固定轻量语音模型可能误识别极短语气词，用户可关闭自动回答后手动发送；云端 0.6.1 跨设备并发新增截图引用与删除之间仍有竞态，既有说明见 [1.3.0 交接](shared/docs/WINDOWS_1.3.0_HANDOFF.md)。本机合成验证不能替代真实订阅、物理音频或 Mac 原生验收。
