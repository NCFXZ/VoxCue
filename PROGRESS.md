# VoxCue 当前进度

## 当前开发进度

**2026-11-21 · macOS 1.3.2，Windows 1.3.0。** Mac 的源码、安装包与更新清单使用主仓标签 `v1.3.2`。Windows 基线为 `v1.3.0`（`669c44a`），安装版沿用 `v1.2.3`（`fae85ca`）的 Ed25519 更新身份。Microsoft Store 2.3.0.0 已提交认证。[Mac 发行入口](https://github.com/NCFXZ/VoxCue/releases/tag/v1.3.2) · [Windows 发行页](https://github.com/NCFXZ/VoxCue/releases/tag/v1.3.0)

- Mac 1.3.2 沿用 1.3.1 的发布正文并补充 GPT-6.2 Astra 和 Sol。GitHub 上的 1.3.1 发行及远端标签已撤下。本机保留已认证的 1.3.1 正式包，用于覆盖升级测试。[Mac 1.3.2 更新日志](docs/1.3.2_MACOS_UPDATE.md) · [Windows 1.3.0 更新日志](docs/1.3.0_WINDOWS_UPDATE.md) · [Windows 开发交接](shared/docs/WINDOWS_1.3.0_HANDOFF.md)
- 账号服务 0.6.1 已上线。迁移云来源时可以不创建会话直接验密。注销响应丢失后，桌面端再查询结果，再按账号清理本机资料。[账号协议](shared/docs/WINDOWS_1.3.0_HANDOFF.md#独立账号服务的协议与发布依赖)
- 开始面试按连接方式显示用量。准备聊天、实时面试和历史回答按当时的服务商显示标志。聊天标志保留原尺寸与间距，去掉灰色圆角底。已移除回答结束后的网页搜索提示。Windows 原生密钥框支持圆点遮挡与显隐，迁移和注销的密码框也支持显隐。[AI 服务与界面](shared/docs/WINDOWS_1.3.0_HANDOFF.md#ai-服务授权和模型选择)
- Windows 安装版与商店版已完成正式 1.2.3 升级及全新安装验收，商店原生凭据输入按系统包身份复验。安装程序、差分索引和更新清单已发布至 `NCFXZ/VoxCue`。Microsoft Store Submission 11（`1152921505702467958`）已接收 x64 包、中英文各四张新版截图和各六条更新说明。提交后进入 Pre-processing，通过认证后自动发布。[验证入口](shared/docs/WINDOWS_1.3.0_HANDOFF.md#验证入口与发行前待验) · [商店提交状态](https://partner.microsoft.com/en-us/dashboard/products/9PBBVWZXMBPW/overview)
- macOS 当前开发版本为 1.3.2。双击 `macos/VoxCue.app` 或执行 `pnpm start` 都会打开固定签名的本机构建（`com.voxcue.app`），可使用冻结的 v11 助手。修改源码后执行 `pnpm build` 更新该应用。`pnpm dev` 单独运行热重载宿主。Node 24.22.1、冻结依赖及公开测试组件位于 `macos/`。
- macOS 1.3.2 内置 Codex 0.171.0，订阅模型目录按实际运行时版本请求。原 1.3.1 GitHub 正式包内置 0.164.0。回归入口为 `model-catalog.test.ts`、`codex-usage-runtime.test.ts` 和 `pnpm test:chatgpt:usage:runtime`。[运行组件](shared/docs/COMPONENTS.md)
- 聊天、主设置和面试浮窗共用的模型菜单中，模型与「刷新模型列表」的高亮胶囊左右对齐，滚动条使用弹层边侧留白。回归入口为 `macos/test/scripts/interview-effort-smoke.mjs`。Windows 本机复验时，将 `windows/test/scripts/interview-effort-smoke.mjs` 的侧边检查同步到胶囊边缘和滚动视口边界。
- Mac 对齐范围包括 SF Symbols（真实面试胶囊的录音波形保留动画）、AppKit 密钥输入、凭据维护、手机 HTTPS/WSS 预配、麦克风录音与转写分流、旧 Qwen 离线断句、知识库物理子进程依赖，以及损坏更新 ZIP 的同版本恢复。账号变更对照独立服务 0.6.1（`3440a25`），知识库卡片汇总本轮全部文档的索引进度，RAG 以合成原件验证功能。准备聊天、面试与历史回答、登录和设置预览统一使用透明服务商标志。开发态与正式 1.2.3 签名升级的入口见 [macOS 开发交接](docs/1.3.0_MACOS_UPDATE.md) 和 [隔离 guest 说明](macos/docs/TEST_GUEST.md)。

- 资料迁移遇到已保存目标的回执时，选择来源后会继续清理旧索引等来源资料。「下一步」在等待期间显示加载图标。Mac 打包在签名前检查知识库与语音子进程的共用模块。迁移回归入口为 `account-transfer-smoke.mjs`。
- 面试准备页与资料菜单可定位到设置的「资料冲突」。个人信息与简历原件、单场面试与截图、单个知识库与文件各算一份。弹窗默认宽 560px，随窄窗口缩小。标题下提示「选择需要保留的资料。」，两行文字与右侧全选、关闭按钮垂直居中。可逐条选择云端或本地，也可按版本全选。列表滚动时标题栏使用与设置页相同的毛玻璃效果。确认后弹窗或单项菜单立即关闭。当前账号在后台逐项核对并应用所选版本，资料旁的云图标展示同步进度；未选、版本改变或处理失败的冲突可再次选择。恢复历史迁移文件时保留云端封包的字段顺序；无截图的面试在两端已相同时可清除中断遗留的冲突标记。验证入口为 `shared/test/unit/cloud-sync.test.ts` 和 `macos/test/scripts/sync-conflicts-smoke.mjs`。
- Mac 面试胶囊展开或收起时复用透明画布，通过眼睛／带斜线的眼睛图标表示面试窗口在屏幕共享中的可见性。桌面启动复用本次已核验的账号状态，知识库对账共用目录快照，组件完整性校验排在主界面首次绘制后。

- 手机在开场确认时按当时显示的设备授权分享，等待配对与重连均可关闭监听。面试解除静音与 Core Audio 共用时钟，采集丢样记入本场历史，听写和设备测试空闲后释放识别模型。
- 整库保留云端时批量核对并清理本地独有原件；迁移与云恢复按库分批发布全文索引。迁移预览按目录读取面试资料，个人字段共用一个来源条目额度。Sparkle 安装失败后可在同一进程重试，启动恢复待安装 ZIP 时复用本轮同一文件的校验结果。回归入口为 `cloud-sync.test.ts`、`account-import-plan.test.ts`、`profile-import-removal.test.ts` 和 `update-driver.test.ts`。

### Mac 1.3.0 复审

- 录音：录音和静音边界以 Core Audio 采集时钟定位。系统时间跳变时，识别器结束旧片段，从新的墙钟时间继续转写。回归入口为 `speech-input-state.test.ts`。
- 迁移：整库迁出按库清理来源索引正文和恢复版本。单场面试的迁移回执与同步封包共用 4,095 张截图上限。旧面试的内嵌预览按场读取，逐张核对修订。回归入口为 `knowledge-core.test.ts` 和 `profile-import-removal.test.ts`。
- 云同步：按修订删除面试记录成功后，再核对剩余引用并清理截图，允许中断后续清。删除知识库前核对云端成员。分类停用后停止后续自动传输和本地写回，全部停用时跳过定期清单扫描。面试冲突按批复核截图引用。回归入口为 `cloud-sync.test.ts`。
- 已知并发边界：删除面试记录时会清理其专属截图，并保留检查时已知的共享截图。账号服务 0.6.1 删除时只核对截图自身的修订；其他设备在最后一次检查后新增的引用仍可能失去原图。[服务端删除逻辑](https://github.com/NCFXZ/VoxCue-server/blob/3440a2517ad3e4d2ee486c76023d229a0ec17fa8/src/backups.ts#L505-L515)
- Mac 更新与退出：更新 ZIP 丢失或损坏可在当前进程重新下载。断电恢复时复用已核实的归档，退出可中止校验。Sparkle 安装失败时释放本次本地更新服务。确认重启更新或退出账号后，原窗口先暂停输入再保存草稿，失败时恢复编辑。回归入口为 `update-driver.test.ts`、`updates-smoke.mjs` 和 `chat-lifecycle-smoke.mjs`。

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

- Windows 1.3.2 候选以正式 1.3.0 为升级基线，对应商店包身份版本 2.3.2.0。应用内置 Codex 0.171.0，账号切换和更新前锁定旧窗口输入直到草稿保存完成，保存失败后恢复编辑。关闭同步类别会使该类别尚未提交的整组冲突决定失效。验收范围见 [1.3.2 更新与复测](shared/docs/WINDOWS_1.3.2_HANDOFF.md)和 [1.3.1 逐项交接](shared/docs/WINDOWS_1.3.1_HANDOFF.md)。
- Windows 发行前检查使用 `test:windows:functional`、`test:windows:regression`、`test:ui:dpi` 及 `store-sandbox-smoke.mjs`。安装版与商店版的覆盖升级分别使用 `--nsis-upgrade-1.3.0` 和 `--appx-upgrade-1.3.0`。GitHub 安装包与更新清单追加到主仓已有 `v1.3.2` 发行，Microsoft Store 更新说明沿用该发行正文。
- Mac 正式包首次安装和 1.3.1 → 1.3.2 升级使用临时隔离客机。可从固定的 Apple 恢复镜像新装，或者从指定的 Cirrus 镜像准备基线。启动后核实来宾 SIP、Gatekeeper 和签名执行状态，再运行正式包验收。客机准备、验收和清理入口见 [隔离客机说明](macos/docs/TEST_GUEST.md)。
- 1.3.0 已知语音识别限制已记入双端交接。语气词误转成普通词时可能触发自动回答并消耗额度，用户可关闭面试浮窗的「自动回答」，核对后手动发送。[自动提问与转写](shared/docs/WINDOWS_1.3.0_HANDOFF.md#面试设备实时识别与自动提问)
- 历史版本 `v1.2.3` 可从[主仓发行页](https://github.com/NCFXZ/VoxCue/releases/tag/v1.2.3)和[历史分发页](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.3)获取，包含 Mac DMG、ZIP、`latest-mac.yml` 与三项 Windows 资产。
- Mac 对应源码为主仓 [`macos-v1.2.3`](https://github.com/NCFXZ/VoxCue/tree/macos-v1.2.3)（`4fe22ec`）。原 `v1.2.3` 仍指向 Windows 发行提交 `fae85ca665505b314fee784a0dddc091f337ffd5`，两端源码均可从主仓标签归档获取。
- [Mac 1.2.3 交接](shared/docs/MACOS_1.2.3_HANDOFF.md) 已补充相对已发 1.2.2 的完整共享范围。共享记录界面修复需在 Windows 本机补验，既有 Windows 安装资产不改写。
- 未发布 Mac 中间版本与凭据候选已清理，当前入口仅保留 v1／v11；已发布 GitHub 发行、标签和安装资产不改。仍有效的 guest 准备与门禁迁入 [当前验收说明](macos/docs/TEST_GUEST.md)，历史开发细节查 Git。
- 1.2.3 验收结束时已清理当轮下载环境、依赖、临时模型副本、工具、VM／快照、截图、日志和合成资料。固定签名、冻结 v1／v11 助手、OneDrive 正式恢复原件及本地正式 `macos/release/1.2.3` 保留；再次构建须按冻结锁恢复当前平台环境。签名与隔离 guest 入口见 [Mac 发行说明](shared/docs/MACOS_1.2.3_RELEASE.md)。
- Microsoft Store 2.2.3.0 对应 Submission 10（`1152921505702404063`）。准备本次 2.3.0.0 更新时，Partner Center 的已发布商品详情对应 Submission 10。[Partner Center](https://partner.microsoft.com/en-us/dashboard/products/9PBBVWZXMBPW/overview)
- 固定 Paraformer 的极短中文识别限制保留，不更换模型或放宽断言；本机合成验证不能代称物理设备、真实语音或真实订阅授权验收。验证入口见 [客户端测试说明](shared/test/README.md)。

## 发行与恢复基线

- Windows 1.2.2 的两个 GitHub 发行页资产已撤回，源码标签 `windows-v1.2.2` 与本地正式原件继续用于升级和恢复。Microsoft Store 2.2.2.0（Submission 9）保持上架。既有 1.2.2 不会自动降级。
- Mac `v1.2.2`、安装包和更新文件保留，两个旧发行页继续仅面向 macOS。[VoxCue](https://github.com/NCFXZ/VoxCue/releases/tag/v1.2.2) · [VoxCue-releases](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.2)
- 源码、固定组件和新客户端更新使用公开的 `NCFXZ/VoxCue`；旧客户端的 `NCFXZ/VoxCue-releases` 保持兼容。保留原更新签名、Store 身份、冻结助手和正式恢复原件，不清理现用模型/依赖。源码为 AGPL-3.0-only，第三方组件沿用各自许可。[第三方声明](THIRD_PARTY_NOTICES.md)
