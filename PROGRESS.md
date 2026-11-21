# VoxCue 当前进度

## 当前开发进度

**2026-11-21 · Windows 1.3.0 已在 GitHub 发布，Microsoft Store 2.3.0.0 已提交认证。** Windows 源码标签为 `v1.3.0`（`669c44a`），安装版沿用 `v1.2.3`（`fae85ca`）的 Ed25519 更新身份。macOS 当前正式版为 `macos-v1.2.3`（`4fe22ec`），接续工作见下方交接。[GitHub 发行页](https://github.com/NCFXZ/VoxCue/releases/tag/v1.3.0)

- 用户可见的功能列在 [Windows 更新日志](docs/1.3.0_WINDOWS_UPDATE.md)。实现方法、历史行为、逐项修复与复验入口见 [Windows 开发交接](shared/docs/WINDOWS_1.3.0_HANDOFF.md)。
- 账号服务 0.6.1 已上线。迁移云来源时可以不创建会话直接验密。注销响应丢失后，桌面端再查询结果，再按账号清理本机资料。[账号协议](shared/docs/WINDOWS_1.3.0_HANDOFF.md#独立账号服务的协议与发布依赖)
- 开始面试按连接方式显示用量。准备聊天、实时面试和历史回答按当时的服务商显示标志。聊天标志保留原尺寸与间距，去掉灰色圆角底。已移除回答结束后的网页搜索提示。Windows 原生密钥框支持圆点遮挡与显隐，迁移和注销的密码框也支持显隐。[AI 服务与界面](shared/docs/WINDOWS_1.3.0_HANDOFF.md#ai-服务授权和模型选择)
- Windows 安装版与商店版已完成正式 1.2.3 升级及全新安装验收，商店原生凭据输入按系统包身份复验。安装程序、差分索引和更新清单已发布至 `NCFXZ/VoxCue`。Microsoft Store Submission 11（`1152921505702467958`）已接收 x64 包、中英文各四张新版截图和各六条更新说明。提交后进入 Pre-processing，通过认证后自动发布。[验证入口](shared/docs/WINDOWS_1.3.0_HANDOFF.md#验证入口与发行前待验) · [商店提交状态](https://partner.microsoft.com/en-us/dashboard/products/9PBBVWZXMBPW/overview)
- macOS 接续需在本机同步平台清单、补齐 SF Symbols、原生密钥输入与钥匙串、音频分流、旧 Qwen 组件、手机证书和更新 ZIP 恢复。用户可见效果与 Windows 逐项对齐，再从正式 Mac 1.2.3 升级验收。[macOS 开发交接](docs/1.3.0_MACOS_UPDATE.md)

## 1.2.3 已有实现

截至 2026-11-14，Windows、macOS 均已发行 1.2.3。Microsoft Store 2.2.3.0 已提交，设置为通过认证后自动发布。对应源码标签及发行渠道状态见下方历史记录。

- Windows 适配器启用共享音频自动重连：等待旧 WASAPI 进程关闭与 Worker 退休，按 1、2、4 秒有界恢复；权限、协议、损坏数据及未确认退出保留终止错误。双路故障显示实际阻止恢复的设备原因，手动停止保持严格尾段检查。[实施与发行说明](shared/docs/WINDOWS_1.2.3_RELEASE.md)
- Windows 云账号、云同步与同源遥测通过现有平台端口使用系统代理和证书信任，保持无浏览器 cookies、无缓存/来源、拒绝重定向与取消语义，不改变系统全局设置或官方供应商运行时。
- 保留上次成功连接的 AI 服务启动恢复、侧栏与设置额度一致、回复生成时查看网页来源，以及资料读取和编辑恢复；恢复状态与设备错误使用完整中英文提示。
- 云端下载知识库后的同库刷新保留当前文档行和阅读位置，读取请求与选择版本分别管理；换库和关闭仍隔离迟到结果，后台刷新不作废当前库的导入、删除或重命名。
- 云端恢复返回实际落盘修订，下载索引与修复扫描使用有效后端状态合并同一文档；此前状态读取在提交后过期，缺失或失效索引仍可重建。
- Mac 1.2.2 的凭据助手与升级边界沿用既有设计；Windows 的官方运行时完全无响应仍明确报错并允许以后重试，不声称两端系统授权窗口一致。[Mac 凭据交接](shared/docs/MACOS_1.2.2_CREDENTIAL_HANDOFF.md)
- Mac 接续文档已区分 Windows 对齐既有能力与实际共享 Bug 修复，并列出 Mac 本机验收边界。[Mac 1.2.3 接续](shared/docs/MACOS_1.2.3_HANDOFF.md)
- Mac 配置同步至 1.2.3，继续复用固定签名、Qwen 运行时和冻结凭据助手。升级夹具新增正式 1.2.2 ZIP 的摘要认证与 ASAR 数据兼容检查，保留 1.1.1 的既有 Sparkle 路径；普通正式产品启动／退出不代称登录后资料读取。[Mac 发行说明](shared/docs/MACOS_1.2.3_RELEASE.md)
- 窄窗记录标题重试按钮在 AI 回答卡左侧可见列内换行，回答计数与导出摘要共用单复数文案；中英与长错误的几何／命中回归覆盖该布局。
- 聊天生命周期夹具在进程重启时等待恢复后的主窗口，避免误登录隐藏语言窗口；补充采集停止失败原因保留断言，不改变生产功能或降低原断言。
- 凭据助手仅保留已弃用的 v1 和现用 v11：v1 对应 1.1.1 及以前的升级／恢复，1.2.2 与 1.2.3 沿用 v11。未发布 v2–v10 的独立源码、专项及工作区／OneDrive 备份退役；v11 仍使用的公用冻结源码与 v10 密文格式保留。v1 恢复入口仅认证原件，缺失即失败，不重新初始化或签名。

## 发行状态与接续

- 1.3.0 已知语音识别限制已记入双端交接。语气词误转成普通词时可能触发自动回答并消耗额度，用户可关闭面试浮窗的「自动回答」，核对后手动发送。[自动提问与转写](shared/docs/WINDOWS_1.3.0_HANDOFF.md#面试设备实时识别与自动提问)
- 历史版本 `v1.2.3` 可从[主仓发行页](https://github.com/NCFXZ/VoxCue/releases/tag/v1.2.3)和[历史分发页](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.3)获取，包含 Mac DMG、ZIP、`latest-mac.yml` 与三项 Windows 资产。
- Mac 对应源码为主仓 [`macos-v1.2.3`](https://github.com/NCFXZ/VoxCue/tree/macos-v1.2.3)（`4fe22ec`）。原 `v1.2.3` 仍指向 Windows 发行提交 `fae85ca665505b314fee784a0dddc091f337ffd5`，两端源码均可从主仓标签归档获取。
- [Mac 1.2.3 交接](shared/docs/MACOS_1.2.3_HANDOFF.md) 已补充相对已发 1.2.2 的完整共享范围。共享记录界面修复需在 Windows 本机补验，既有 Windows 安装资产不改写。
- 未发布 Mac 中间版本与凭据候选已清理，当前入口仅保留 v1／v11；已发布 GitHub 发行、标签和安装资产不改。仍有效的 guest 准备与门禁迁入 [当前验收说明](macos/docs/TEST_GUEST.md)，历史开发细节查 Git。
- 本轮下载环境、依赖、临时模型副本、工具、VM／快照、截图、日志和合成资料已清除。固定签名、冻结 v1／v11 助手、OneDrive 正式恢复原件及本地正式 `macos/release/1.2.3` 保留；再次构建须按冻结锁恢复当前平台环境。签名与隔离 guest 入口见 [Mac 发行说明](shared/docs/MACOS_1.2.3_RELEASE.md)。
- Microsoft Store 2.2.3.0 对应 Submission 10（`1152921505702404063`）。准备本次 2.3.0.0 更新时，Partner Center 的已发布商品详情对应 Submission 10。[Partner Center](https://partner.microsoft.com/en-us/dashboard/products/9PBBVWZXMBPW/overview)
- 固定 Paraformer 的极短中文识别限制保留，不更换模型或放宽断言；本机合成验证不能代称物理设备、真实语音或真实订阅授权验收。验证入口见 [客户端测试说明](shared/test/README.md)。

## 发行与恢复基线

- Windows 1.2.2 的两个 GitHub 发行页资产已撤回，源码标签 `windows-v1.2.2` 与本地正式原件继续用于升级和恢复。Microsoft Store 2.2.2.0（Submission 9）保持上架。既有 1.2.2 不会自动降级。
- Mac `v1.2.2`、安装包和更新文件保留，两个旧发行页继续仅面向 macOS。[VoxCue](https://github.com/NCFXZ/VoxCue/releases/tag/v1.2.2) · [VoxCue-releases](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.2)
- 源码、固定组件和新客户端更新使用公开的 `NCFXZ/VoxCue`；旧客户端的 `NCFXZ/VoxCue-releases` 保持兼容。保留原更新签名、Store 身份、冻结助手和正式恢复原件，不清理现用模型/依赖。源码为 AGPL-3.0-only，第三方组件沿用各自许可。[第三方声明](THIRD_PARTY_NOTICES.md)
