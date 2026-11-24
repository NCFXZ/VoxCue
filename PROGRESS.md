# VoxCue 当前进度

## 当前版本与范围

**2026-11-24 · Windows 与 macOS 1.3.3 已发布到 GitHub 和 CNB。** 版本唯一来源为 `shared/package.json`，根和两个平台的配置均为 `1.3.3`。Windows 商店身份版本为 `2.3.3.0`，已提交认证。

本轮清理 Mac 工作区，执行源码、安全、稳定性、英文界面和五档缩放回归，并在隔离 guest 验证正式安装、覆盖升级、麦克风和截图授权。源码已推送到 VoxCue 主仓库，同一组 Mac 1.3.3 正式资产已同步到 GitHub 和 CNB。

本轮按 Mac 交接文档验证 1.3.3 已实现的改动，并在 `macos/` 使用固定签名的本地试用入口。Mac 依赖使用本平台锁定版本，复用 1.3.2 已签名的 Qwen 运行时。Mac 登录和退出登录共用 SF Symbols 适配，使用配套的 `iphone.and.arrow.right.inward` 和 `iphone.and.arrow.right.outward`，在 macOS 14 上构建时回退到配套方框箭头。新对话在 Mac 使用 `square.and.pencil`，共享默认适配使用方框铅笔，更新完成通知使用无外框项目符号列表。RAG 只用本轮合成资料验收功能，沿用已调优模型、阈值和检索参数。

Mac 使用 24 pt 生成 SF Symbols，按共享界面的各控件尺寸显示。账号操作及更新日志按钮为 16 px，新对话为 18 px。手机遥控页「自动回答」开关的圆点大小与 Windows 一致，均为 11 × 11 px。

Mac 的「个人信息」图标为 16 × 16 px。面试浮窗、登录及设置预览和播放器「选择录音」在两端共用 18 × 18 px 手绘波形。实际录音时波形随电平变化。

Mac 1.3.3 的主程序与音频助手签名包含 Hardened Runtime 的 Audio Input 授权，验包直接检查签名中的权限值。面试设置可独立检查所选麦克风，拒绝后提供系统设置入口。麦克风和截图分别在隔离 guest 验证首次系统弹窗、拒绝后的权限列表与重新授权；截图沿用独立的屏幕录制授权入口。

Mac 1.3.3 包含网络增量。下载器复用当前版本的本地已验证 ZIP，通过同源 Range 补齐新版 ZIP。差分不可用时回退全量，完成归档仍由原 Sparkle 安装链验签。增量打包、镜像与本机复验入口见 [Mac 更新设计](macos/docs/UPDATES.md#网络增量与全量兜底)。

## 实现与文档入口

- [双语公开更新日志](shared/docs/1.3.3_UPDATE.md)：沿用两端共用的五条文案，补充 Mac 麦克风授权修复。
- [1.3.2 → 1.3.3 双端改动与 Mac 逐项交接](shared/docs/MACOS_1.3.3_HANDOFF.md)：AI 工具调用、资料提案、独立账号与额度、UI、公告、下载和测试中修正的回归入口。UI 独立列出；明确 Mac 也需要网络增量更新，不能用先下载完整 ZIP 的 Sparkle 路径代称已支持增量。
- [下载渠道](shared/docs/DOWNLOAD_CHANNELS.md)：大陆出口 IP 使用匿名 CNB 索引和资产，其他地区使用 GitHub；保留固定签名／摘要、Windows NsisUpdater 增量及全量兜底。组件固定原件已经镜像到 CNB `models-v1.0.0`，包含索引、语音、对齐模型和运行时。测试 1.3.2 已撤下，不重建；正式资产完整后才合并公开索引。
- [公告配置](shared/docs/ANNOUNCEMENTS.md)与[发布文件](shared/docs/announcements.json)记录官网静态 JSON 的格式和待发布的双语欢迎公告。客户端一次展示一条公告，完成更新优先。
- [架构](shared/docs/ARCHITECTURE.md)、[更新链](shared/docs/UPDATES.md)、[组件](shared/docs/COMPONENTS.md)和[验证入口](shared/test/README.md)保存对应长期技术说明。

本轮关于页分组首行复用统一标题间距，公告与设置定位纳入完整功能及五档缩放入口；旧回归同步新文案、额度卡结构、独立账号操作和显示窗口二次确认，保留功能与安全断言。像素对齐检测保留小数布局坐标至最终物理像素换算，避免整数 `clientWidth` 提前取整造成误报，并明确检查两侧 24px 留白。离线夹具在进入 Electron fetch 前拒绝非允许请求，并将未捕获异常直接报告为失败，避免原生错误框掩盖问题；加入拒绝后取消的专项。商店中英文截图使用临时合成的多轮聊天、面试记录和知识库资料，不向正式包加入演示入口。

紧凑注册和重置密码表单保留容纳验证提示的空间。长对话追随滚动由浏览器确定实际底部位置，避免分数缩放时跳动。正式 1.3.2 覆盖升级夹具使用该版本实际的面试记录路径和索引结构。

共享窗口导航保护在缩放重置前检查 WebContents 是否已销毁，防止加载失败关闭窗口后的迟到事件触发异常；单测及快捷键专项覆盖失败后迟到的加载完成事件，Mac 交接列为本机必验项。最终 Windows 包已纳入该修正；包级偏好播种采用真实设置界面，验证阶段不重写旧数据。

Windows 发行验证已完成。复验入口包括五档缩放、`store-sandbox-smoke.mjs` 的 `--nsis-current`、`--nsis-upgrade-1.3.2`、默认 Store 首装、`--appx-upgrade-1.3.2`，以及 `updates-differential-smoke.mjs` 的实际差分与故障兜底。保留已认证 1.3.2 原件及可复用公开模型／音频，不以 Windows 验证代替 Mac 本机验收。

## 发行状态与接续待办

- 源码已推送 GitHub `main`；[GitHub v1.3.3](https://github.com/NCFXZ/VoxCue/releases/tag/v1.3.3) 已正式发布 Windows 安装器、blockmap、签名清单以及 Mac DMG、ZIP、增量计划和签名清单。Mac 资产已完成匿名下载核验。
- [CNB v1.3.3](https://cnb.cool/voxcue-release/voxcue-release/-/releases/tag/v1.3.3) 已同步 Windows 和 Mac 的发行原件，并更新双语发行说明。匿名下载核验通过后，已将 Mac 更新资产合并至 `main/releases.json`。Windows 资产、组件及历史条目已保留，临时镜像流水线已移除。
- Microsoft Store `2.3.3.0` 已上传并提交 Submission 12（`1152921505702489003`），当前为认证中／预处理，尚未表示新版正式上架。中英文各五张丰富截图、实际支持的 API 服务描述及用户确定的五条更新说明均已保存。
- Mac 归档增量与全量回退专项使用 1.3.2 官方 ZIP，正式安装和覆盖升级使用隔离 guest。客户端解析器已核对 CNB 匿名索引，两端均能发现 1.3.3。Mac 增量已通过公开 CNB Range 下载重组并核对签名归档。
- Mac 定向验证入口为共享公告、设置定位、独立额度、面试胶囊及 RAG 专项。Mac 更新驱动夹具已覆盖地区探测与发行检查，原有离线缓存和节流断言保留。
- 待在 Windows 本机将「个人信息」图标调整为 16 × 16 px，并复验共享的 18 × 18 px 录音波形、动画与紧凑账号表单。
- 官网欢迎公告配置已准备。由另一台电脑在 EdgeOne Pages 项目 `voxcue-website` 发布，随后核对公开地址 `/app/announcements.json`。
- 本轮临时 profile、截图、日志、只读服务端参考和失去消费者的打包辅助文件已按归属清理；正式资产、恢复基线及可复用公开缓存保留。

## 已发基线与保留边界

- Windows 和 Mac 当前已发基线为 `1.3.3`。Windows 1.3.2 原始发行源码为 `9a553ab7140b93704e5566c999e1bf0e27bc10a7`；本地正式 1.3.2 安装器、blockmap、清单和 Store 原件保留用于升级验证，不以新生成文件冒充旧包。
- Microsoft Store 当前正式可用版本仍为 `2.3.2.0`（Submission 11，`1152921505702467958`）；`2.3.3.0` 已进入认证流程。[商店入口](https://partner.microsoft.com/en-us/dashboard/products/9PBBVWZXMBPW/overview)
- Mac 1.3.2 的固定签名、冻结 v1／v11 凭据助手、现用模型／依赖及正式恢复原件保留；Mac 1.3.3 原生、签名、隔离 guest 和增量更新依照交接逐项在本机完成。后续追加 Mac 资产保留已发 Windows 文件，不移动既有发行标签。
- 旧客户端的 `NCFXZ/VoxCue-releases` 下载兼容保持；新源码与发行使用 `NCFXZ/VoxCue`。源码为 AGPL-3.0-only，组件许可证见 [第三方声明](THIRD_PARTY_NOTICES.md)。
- 已知边界：固定轻量语音模型可能误识别极短语气词，用户可关闭自动回答后手动发送；云端 0.6.1 跨设备并发新增截图引用与删除之间仍有竞态，既有说明见 [1.3.0 交接](shared/docs/WINDOWS_1.3.0_HANDOFF.md)。本机合成验证不能替代真实订阅、物理音频或 Mac 原生验收。
