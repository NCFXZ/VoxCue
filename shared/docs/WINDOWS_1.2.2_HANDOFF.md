# Windows 1.2.0 → 1.2.2 更新及本机验收交接

**适用基线**　Windows 正式源码为 `v1.2.0`（`0bc1cd4261c56598a6341adfb11aca99913e9cf9`），目标发行标签为 `v1.2.2`，共享版本为 1.2.2。两者之间的 `macos-v1.2.0`、`macos-v1.2.1` 为 Mac 快照，Windows 从自己的 1.2.0 直接接续。下列各项均待 Windows 执行。目标标签发布后，以其指向的提交核对差异，并验收由对应 Windows 源码构建的安装包。

Windows 本机先查 `git status --short --branch`、`git diff --name-status v1.2.0` 和未跟踪文件，保留现有工作。本次 Mac 工作区自该标签以来，`windows/` 的受版本控制文件无差异；下文明确列出的 Windows 适配须在 Windows 上实施。Windows 上保持 `macos/` 全树只读。先读 [项目规则](../../AGENTS.md)、[当前范围](../../PROGRESS.md) 和 [Windows 1.2.0 发行索引](WINDOWS_1.2.0_RELEASE.md)。

本轮按用户要求保留仓库中的测试源码，删除全部测试环境及测试产物。下次在 Windows 按仓库清单从固定公开来源重新准备测试工具、下载并核验模型／音频，重新建立临时 Sandbox、合成账号和资料。历史文档中的 VM、截图、候选包及临时目录均不能作为输入。历史正式发行原件按其发行来源和原始摘要另行核验。

## 先补 Windows 专属适配

| 编号 | 本机操作和验收条件 |
| --- | --- |
| W001 | 根目录执行 `pnpm sync:workspace`，核对共享 1.2.2、根及 Windows 生成配置、`AGPL-3.0-only`。Windows 的 Store 版本公式给出 `2.2.2.0`，在最终 MSIX 清单再核对。只在 Windows 平台目录安装冻结依赖。 |
| W002 | 在 `windows/scripts/package-portable.mjs` 给 `**/dist-electron/shared/electron/backend/cancellable.js` 增加 ASAR 单文件展开规则。以最终包验证物理文件存在且能从语音 utility 加载，包括关闭自动重连的普通启动、停止和重启。 |
| W003 | 适配离线 full 的 Windows named-pipe 缺席探测。只允许当前进程拥有的精确组件端点；分别测正常监听、退出后端点缺席和其他进程同前缀端点。拒绝外部网络和未拥有的端点。 |
| W004 | Windows WASAPI 当前未启用 Mac 的自动重连策略。测本平台原有手动重连、旧子进程真实 close、Worker exit 和迟到事件，保持未退休时不并发开第二个采集。若另有启用要求，须先补本机错误分类和重连生命周期。 |
| W005 | Windows 设备枚举目前将子进程 JSON 断言成设备数组。应在平台适配器验证条数、设备字段类型及长度，再交给共享消费者。分别测合法／空列表、畸形和超限响应，完成本机合成设备及失败回归。 |
| W006 | 将 `windows/electron/updates.ts` 的标记校验、`windows/scripts/package-portable.mjs` 的标记、`package-installer.mjs` 的仓库校验及 `windows/electron-builder.config.cjs` 的 repo 指向 `NCFXZ/VoxCue`。同步 `security-package-smoke.mjs`、`updates-native-smoke.mjs`、`components-check.mjs` 中旧仓断言和模拟 URL。更新与事实不符的私有源码说明。保留已有 Ed25519 公钥、签名及摘要验证。 |
| W007 | 在便携包、NSIS 安装后目录及 Store 包中加入并核对根 `LICENSE`、`THIRD_PARTY_NOTICES.md`；保留模型、依赖和随附素材原许可。版本、许可、第三方许可链接及其错误提示须与实际包一致。 |
| W008 | Windows 的 `interview-context-smoke.mjs`、`interview-effort-smoke.mjs`、`interview-access-smoke.mjs`、`interview-workflow-smoke.mjs` 须显式进入合成 VoxCue 主账号并按用例连接 AI，再等待会话／模型就绪。复用共享隔离夹具，保留原面试、权限、窗口和键盘断言。 |

## 1.2.1 阶段的共享修改

下表保留 [1.2.1 交接](WINDOWS_1.2.1_HANDOFF.md) 的原编号，可直接按该文定位实现、完整断言与当时发现的问题。其发行仓库、版本与 latest 描述为当时记录，1.2.2 的来源采用本页 W006。

| 编号 | Windows 要复现的行为 |
| --- | --- |
| S001 | Paraformer 空闲时仅保留有界历史；固定合成短音未被本机 VAD 接纳，退出预卷范围后，下一条问题的识别结果与 fresh 引擎一致。 |
| S002 | VAD 接纳后送入 500ms／8000 个 16kHz 样本历史和当前帧。晚接纳保留首音节，自然静音、暂停和停止保留尾稿。 |
| S003 | 空闲不持续创建／解码流；终稿释放旧状态，切模型、取消和长静音不产生重复终稿。入口为 `speech-engine-preroll.test.ts`。 |
| S004 | 共享控制器对恢复任务和启动等待校验归属；旧任务不会在取消、切换或关闭后写回。 |
| S005 | 真实 close／exit 前禁止替换；失败信号、已发 kill 和迟到 ACK 不视为资源已释放。 |
| S006 | 只有已启用的适配器采用 1／2／4 秒和最多三次的恢复预算；稳定 30 秒并有近期 ACK 才补预算。Windows 的实际状态见 W004。 |
| S007 | 暂停、关闭、切模型取消退避／加载；残缺音频不触发自动回答；耗尽后的错误和手动重连动作归属正确。 |
| S008 | 中英文恢复、取消、耗尽等提示在窄面试窗、深浅主题和原生缩放下可读，操作有无障碍名称。 |
| S009 | 恢复卡不遮挡设备状态提示及工具栏。 |
| S010 | `interview-ux-smoke.mjs` 实际触发 hover 并检查交叠位置命中，不以 z-index 数字代验。 |
| S011 | 浮窗 UI 夹具先确认目标窗口；Windows 核对自己的前台窗口和命中结果。 |
| S012 | 用最终 ASAR 的实际截图 Worker、sharp、本机 binding 和 libvips 对合成图做连续编码、非法输入、取消、超时与退出验证。 |
| S013 | 截图 Worker 故障不影响其他 Worker，取消后不写回，释放后能重试。 |
| S014 | 离线完整入口从 `vitest/package.json` 定位本机 Vitest CLI，使用 Windows 冻结依赖。 |
| S015 | 网络守卫只允许测试定义的 loopback、确属本进程的 self-IPv4／端口及精确组件端点；named pipe 见 W003。 |
| S016 | 本机合成语音必须先有真实非空自然终稿，再检查 filler 不自动回答、手动仍能提交、正常问题仍自动回答。 |
| S017 | 用已认证公开模型和文件 PCM 验证 VAD 负例、500ms 预卷、首音节、实际处理确认和尾稿；不采样真实硬件。 |
| S018 | 服务端集成通过 `VOXCUE_TEST_SERVER_ROOT` 指向干净的服务端 0.5.3／`3bceb615dbba900f669322c301fc4b5b473dfb15`；模型、profile 和必要截图遵循各自的缓存／系统临时目录规则。 |
| B001 | Composer 图标按语义比对；弹出层退出、深浅色、焦点和可访问名称保持。 |
| B002 | Qwen 测试显式给出合成 runtime 路径；碎片输出、能力、对齐、错误与 EPIPE 用实际协议检查。 |
| B003 | 完整排程包括 `quit-drain` 和 `utility-retirement`；覆盖取消、高输出、父退出和真实子进程树退休。 |
| B004 | 测试临时目录和嵌套进程有明确归属；Windows 使用本机解锁门禁与 owned HWND，活跃／未知目录保留。 |

## 1.2.2 新增与验证中修复

| 编号 | 实现及 Windows 逐条验收 |
| --- | --- |
| A01 | **启动恢复 AI 登录。** 分别用 ChatGPT 和 Copilot 成功连接，再重启。只有上次成功连接的服务会自动验证，设置与侧栏随验证结果更新；直接发消息应复用原会话。新装、一直未连或主动断开后，启动和查看设置均跳过供应商验证。断开后再手动连接成功，下次启动重新验证；重连取消或失败仍跳过。 |
| A02 | **明确选择服务。** 点击指定服务的「连接」只检查该服务；有效会话复用并载入模型／额度，确认为空才启动正常官方授权。两个服务分开测，新账号、升级账号、断开后重连和反向切换均覆盖。 |
| A03 | **首次用户操作继续执行。** 有存量会话时首次按 Enter 或点击发送／重试、选择模型、生成技能、开始 AI 面试、显式重试历史标题，加载模型后继续原操作。核对输入草稿、附件、键盘焦点、单击只发一次；在加载期间关闭窗口／面板、切换会话或资料后旧动作不写回。 |
| A04 | **额度和模型。** 确认服务前不提前请求；实际连接后模型、AI 设置额度、侧边栏刷新和 AI 面试窗口各按原作用域工作。额度为零保留 0%、进度和重置时间，额外用量用中性提示；受限、暂不可用与真零各有独立反馈。 |
| A05 | **ChatGPT 授权与拒绝。** 固定官方 Codex 和 VoxCue 专属运行目录处理网页登录与系统凭据。明确凭据拒绝、一般不可用和普通取消分别报告；一个服务暂停后可继续另一服务，应用重启后可再主动尝试。Mac 的 `login status` 原生预检未装配在 Windows，须通过实际 Windows Credential Manager／官方 runtime 的已知反馈核对本机行为，不借用本机个人 Codex 授权。 |
| A06 | **GitHub Copilot 授权与拒绝。** SDK 的本地拒绝与 `needs-plaintext-consent` 分别显示拒绝与不可用，均在本次启动暂停该服务并停止 VoxCue 自有 SDK 子进程。不写明文；后台额度、模型、聊天和排队请求不再弹框。浏览器取消和远端 403 不锁定，断开仅清 VoxCue 账号元数据；用合成 CLI 标记核对不会登出共享 CLI。 |
| A07 | **修复取消后重连被旧 OAuth 请求堵住。** 令 SDK 的 advance 永不返回，取消后重新连接可开始新流程。能确认取消就释放，取消未确认则先退役自有 runtime；晚到旧拒绝／成功不锁新会话、不写入账号。额度超时同样要能继续加载模型。窗口离开、并发与正常退出都覆盖。 |
| A08 | **AI 设置连接提示。** 仅两条 AI 服务按钮下方的反馈区精简故障和操作，分别检查明确拒绝、其他连接失败、浏览器取消、授权超时及断开警告；切换中英文，原始诊断不外泄。账号、用量等其他位置继续使用各自原有反馈。 |
| A09 | **本地坏资料恢复。** 旧 `auth-data/credentials.bin` 验证版本和字段，云会话校验 origin、用户、会话、令牌和时间，遥测票据校验结构、installationId 与内部绑定。坏 JSON／加密 null／字段错误与缺文件分开；过期但结构有效不等于损坏。 |
| A10 | **保存旧密文。** 只读状态检查不自动清云会话；针对该账号主动恢复后，原加密文件先写到独立的 `.recovery` 副本。备份写失败不能覆盖原件，一个账号恢复不重置其他账号或遥测证明。真实本地存储故障不得被当作可恢复数据而继续登录；远端伪造同名错误码无效。在 Windows 用系统加密适配器和临时合成资料验证。 |
| A11 | **组件与更新发行源。** 共享更新查询及固定组件下载切至 `NCFXZ/VoxCue`。核对匿名分页、最高完整稳定 Windows 版本、缺失／跨平台／草稿资产、签名、大小和摘要；Windows 需要同条稳定发行的 `latest.yml`、`VoxCue-Setup-<版本>-x64.exe` 及同名 `.exe.blockmap`；只有模型或 Mac 完整资产的发行不触发 Windows 客户端升级。历史 1.2.0 仍请求内置旧仓，首次跨仓升级须保留过渡或从可信新安装包手动更新；新包再查新仓。 |
| A12 | **帮助与许可证。** 中英文指南分别打开 `/install/?lang=zh-CN`、`/en/install/?lang=en`，显式语言覆盖网站原偏好。「关于」显示 GitHub 源码、AGPL-3.0-only 及第三方许可；只允许受控外链，打开失败可重试。组件标识、公开模型字节及更新签名公钥继续沿用既有值。 |
| A13 | **组件和登录界面。** 三处组件未就绪横幅按 740px 上限居中，主窗窄宽、两主题和现有五档 DPI 均验证；登录输入聚焦使用柔和深色阴影和原边框／位移，保留键盘反馈、减弱动画及高对比适配。 |
| A14 | **组件解包与检索。** 组件安装只用现用流式解包与摘要校验。验证越界／路径冲突、损坏／摘要不符、取消及重试。RAG 删去无消费者的四个旧函数，复验真实查询、上下文、准确性和 grounding；固定模型、索引和现有检索行为保持。 |
| A15 | **远程协议。** LAN 命令解析、地址选择、标识、固定时间比较和限流抽到共享纯协议文件，保留既有服务导出。验证配对、合法命令、越界字段、非私网、失效租约、重复连接和取消；远端不能访问主进程文件或凭据。 |
| A16 | **附件与面试外观。** 聊天文件预检复用公开契约，上限为每条 20 件、单个 20 MiB；同时继续执行整轮上下文预算。验证拖入文件夹、同名替换、超限拒绝和取消。实际面试与预览复用同一固定深色参数，核对显示设置、实际浮窗、两个预览与两主题。 |
| A17 | **隔离回归夹具。** 主账号和 AI 连接分别显式建立；ChatGPT/Copilot 单登录、聊天、会话状态、面试 effort、UI 对齐／材质用各自状态。授权浏览器、系统凭据、SDK 原生和后端 HTTP 为不同验证层，须分别说明。实测正常 OAuth 取消重试时同时检查没有触发另一服务。 |

## Mac 专属改动与 Windows 对照

| Mac 变化 | Windows 对照范围 |
| --- | --- |
| 1.2.1 的 M001–M004 修正 HAL 多声道／多流选择和设备监听注册竞态，在 Mac 适配器启用有界自动重连。 | Windows 复核 WASAPI 声道掩码、设备变化、固定虚拟回放及自己的失败状态。共享恢复逻辑见 S004–S007。 |
| 1.2.1 的 M005–M009 冻结凭据助手及构建身份，防止链接重定向覆盖，并修正包目录真实路径和语音依赖展开。1.2.2 的 v11 创建时按中文或英文命名，仅从 1.1.1 的三种既定名称复制一个来源；核心资料可读后才无弹窗清理，开发候选 v6–v10 及无关条目保留。 | Windows 沿用 Electron Safe Storage／DPAPI。只移植共享的坏资料保留、主动恢复与错误反馈，验证多个 Windows 凭据、账号和更新签名身份的隔离。打包展开对应 W002。 |
| Mac 的隐藏登录窗先取得应用持久语言，真实系统框由 macOS 控制；120 秒超时和未来请求退休单独处理。 | Windows 启动和账号恢复继续使用本平台路径；验证冷启动、切换语言、登录／主窗选路、保存资料与合成账号重登。真实 AI 服务系统凭据行为另外按 A05、A06 核对。 |
| Mac 云账号与同源遥测改用 Electron 系统网络，遵循系统信任及代理，禁止 cookies、缓存、跨站重定向和 referrer。 | Windows 继续原网络适配器，核对请求端点、显式身份、取消、TLS 失败和本地资料保留。 |
| M010–M012 完善更新公钥备份只读验证、SIP／签名执行／Gatekeeper 的 guest 门禁和归档测试边界。Mac 更新驱动复用认证过的本地归档元数据，发布源切新仓。 | Windows 使用其已固定公钥、NSIS／Store 流程及禁网 Sandbox。在完整安装包测试签名／摘要、缓存选择、取消和重启；保护用户原件、正式版本及签名恢复材料。 |

Mac 精确行为及其系统门禁见 [1.2.1 平台差异](WINDOWS_1.2.1_HANDOFF.md)、[Mac 1.2.2 实现](MACOS_1.2.2_RELEASE.md) 和 [凭据交接](MACOS_1.2.2_CREDENTIAL_HANDOFF.md)。

## Windows 执行顺序

1. 根目录运行 `pnpm sync:workspace`，在平台目录按现有锁和依赖准备。依次运行根 `pnpm check:workspace`、`pnpm check:architecture`、`pnpm typecheck`、`pnpm test`、`pnpm build:shared`。核对 Windows 生成清单及 Store 版本，再检查 Mac 目录无变动。
2. 在 `windows/` 用 `node ../shared/test/scripts/functional-suite.mjs --list --jobs=1` 查看本机实际排程，执行 `node ../shared/test/scripts/functional-suite.mjs --jobs=1`。按风险补 `pnpm test:chatgpt:single-login`、`pnpm test:copilot`、`pnpm test:chat-response`、`pnpm test:conversations:status`、`pnpm test:interview:effort` 及 `node ../shared/test/scripts/language-smoke.mjs`。账号／组件定向入口包括 `cloud-account-smoke.mjs --login-check`、`components-ui-smoke.mjs`、`client-update-ui-smoke.mjs`（均在 `../shared/test/scripts/`）。
3. 在已解锁、当前 UID 交互桌面串行运行 `pnpm test:windows:regression` 与 `pnpm test:ui:dpi`；按前一版交接执行面试长稳和 `pnpm test:speech:soak`（600 秒）。W003 完成后运行 `node ../shared/test/scripts/interview-usage-offline.mjs --full`。输入仅限固定公开模型／音频和自有合成资料；本机 WASAPI 回放走隔离的合成设备。
4. 静态、功能和平台回归通过后，在当前授权范围内构建并核对 `package:portable`、`package:installer`、`package:store`。先核对 payload，再分别走 `test:installer:artifact`、`test:store:artifact`、`test:store:sandbox`、`test:updates:native`、`test:installer:upgrade`。Sandbox 用专属 SID 和只读白名单输入；在最终 ASAR 中实际加载截图、SDK、音频与检索子进程，确认签名或摘要错误不执行。
5. 使用保留的真实 Windows 1.2.0 原包装入独立环境，先写合成账号、设置、个人资料、简历、记录及索引，再升级新包。比对原件摘要、会话恢复、索引可检索、登录语言、快捷键及卸载／重装行为。已有 1.1.1 夹具用于兼容回归；应记录各自使用的旧包。保存资料的重新打开、归档替换、NSIS 升级和 Store 安装过程分别验收。
6. 记录 Windows 实际执行的发行资产及来源、失败原因和未验证边界，结果留在终端／对话。向 GitHub 上传和 Store 提交取决于 Windows 当轮授权。Windows 上不执行 macOS 钥匙串 ACL／partition、TCC、SIP、Core Audio、Sparkle、DMG 或本地签名钥匙串操作。

## 五档缩放、英文与安全检查

Windows 五档入口为 `node test/scripts/windows-suite.mjs --dpi`，依次运行 1、1.25、1.5、1.75、2 倍，每档 37 组。定向重测示例为 `node test/scripts/windows-suite.mjs --dpi --scale=1.25 typography updates language`。该入口接受位置参数形式的组名。Mac 的 `ui-refinement-matrix.mjs` 每档 42 组，含独立的 `cloud-login`、`management-scrollbars` 别名；Windows 需要定向检查时执行 `node ../shared/test/scripts/cloud-account-smoke.mjs --login-check` 或 `--scrollbars`。账号、删除与密码策略集成还依赖 S018 的参考服务端。

| 范围 | Windows 本机验收 |
| --- | --- |
| 共享几何与交互 | 运行 `ui-alignment`、`ui-refinement`、`ui-material-refinement`、`typography`、`web-materials`、`interview-typography`。检查两种主题和宽窄窗的字号、焦点、组件横幅、模型菜单、选区、列表溢出，以及预览和面试实窗的对齐。 |
| 登录、设置与额度 | 运行 `login`、`local-mode`、`language`、`settings`、`free-service`、`account-usage-overview`、`components-ui`、`updates` 和 `client-update-ui`。AI 供应商拒绝、取消及重试分别使用功能矩阵的 `chatgpt-single-login` 和 `copilot-login`，系统凭据窗口仅在对应平台隔离环境核对。 |
| 夹具 | `model-fixtures.mjs` 按组件清单核验公开模型，按固定版本和 SHA-256 核验两段公开语音。调度器一次准备所选组需要的资源，子进程使用自有临时 profile，Electron 从 `VOXCUE_TEST_SCALE_FACTOR` 设置启动缩放。原生 Windows 登录点击和 HWND／浮窗检查走平台套件。 |
| 无桌面检查 | 在 `windows/` 执行 `pnpm exec vitest run --config ../shared/vitest.config.mjs ui-language.test.ts runtime-policy.test.ts desktop-ipc.test.ts` 及 `node ../shared/test/scripts/check-architecture.mjs`。检查英文词条与占位符、用户资料原文、回调本地化、正式包的开发覆盖隔离、IPC 窗口和字段白名单及 preload 依赖。英文界面的可见正文、ARIA、裁切和持久语言另运行 `language-smoke.mjs`。 |

## 本轮回归修复

| 编号 | Windows 复验入口和条件 |
| --- | --- |
| R01 | **ChatGPT 登录提示。** `login-smoke.mjs` 在同一设置窗口先主动取消，再由合成的官方运行时接口报告授权未完成。逐字确认两次各自的提示、可用的连接按钮及空的 ChatGPT 会话。 |
| R02 | **重启恢复。** `local-mode-smoke.mjs` 在恢复的主窗验证离线进入、草稿和零次账号请求，再主动连接 AI。`telemetry-smoke.mjs` 在已登录的主窗验证账号恢复事件、唯一安装标识及持久化退避。`interview-typography-smoke.mjs` 重启后在主窗恢复 AI 连接，复核面试字号及透明度。三个入口均从初次登录或跳过登录开始，重启观察最终主窗。 |
| R03 | **后台会话。** `conversation-status-smoke.mjs` 先打开知识库并等待页面可见，再让受控的后台回复完成。沿用原断言，验证页面切换后的消息状态和未读标记。 |
| R04 | **模型列表及排版。** `typography-smoke.mjs` 重新加载后首次点击「聊天模型」直接显示模型列表；已有会话的入口从思考强度面板进入「选择模型」。两条路径均须在所属弹窗出现可选择的真实模型项，再检查两种主题的排版。 |
| R05 | **更新检查键盘焦点。** `updates-smoke.mjs` 在每个独立键盘场景开始前聚焦自有窗口和按钮。验证普通 Enter、重复长按 Space 仅强制检查一次，以及按 Tab 离开后等待完整五秒仍不触发检查。Windows 在当前解锁控制台复验，Mac 同时核对系统前台应用和实际焦点窗口。 |
| R06 | **更新后的资料恢复。** `updates-smoke.mjs` 首次启动在真实登录窗确认其无安装更新权限；模拟更新后等待已恢复的主窗，再核对草稿和原附件。Windows 的打包启动另行验证。Mac 原有 `user-data-smoke.mjs` 也在迁移后的再次启动等待主窗验证草稿和会话。 |
| R07 | **安装包夹带旧渲染资源。** Mac 的 File Provider 在构建目录留下四个副本，包括引用旧资源的 `index 3.html`、两个编号 PNG 和一个编号 JPG。Mac 打包阶段在临时副本中按 Vite／TypeScript 产出及公开资源来源核对，保留合法带数字的文件。Windows 在最终便携包、NSIS 和 Store 包检查 `app.asar` 的实际入口和资源引用；若发现同类文件，先确认原件、构建清单和使用方，再处理打包副本。 |
| R08 | **启动器的单实例退出。** Mac 开发启动器的第二个进程使用常规离线入口，在 Electron ready 前加载主程序。验证第二进程正常退出、原窗口恢复且始终只有一个窗口；失败诊断记录子进程信号和有界 stderr。Windows 在本机入口复验相同的单实例行为，Mac 启动器夹具修改仅适用于 Mac。 |
| R09 | **设置底部消息。** AI 服务的连接提示复用「关于与更新」说明的字号、行高及上下间距。运行 `chatgpt-single-login-smoke.mjs`，以真实合成连接失败，在中英文、深浅主题分别比较两处正文的字号、行高、字重、距分隔线与两侧的位置，核对 AI 的原前景色与更新说明的原灰色。 |
| R10 | **更新测试退出。** Mac 的 `update-cache-checks.mjs` 在验证结束或中途失败时，先停止临时回环服务并断开夹具特意挂起的下载连接，再等待 Electron 退出。正常中断用例仍要求更新驱动先自行取消、清理临时归档并保存冷却状态。Windows 使用本机更新测试复验慢速下载、取消、重启及到期后重试，验证异常也能释放临时端口和进程。 |
| R11 | **面试准备引导的说明。** `preparation-guide-smoke.mjs` 在同一渲染帧核对实际悬停按钮、其 `aria-describedby` 对应的可见说明、淡入淡出中间态以及按钮行位置。中英文、深浅主题、两种窗口宽度还要验证鼠标移开恢复默认文本、键盘聚焦最后一项及减少动态效果的行为。 |
| R12 | **缩放与窗口焦点。** `web-materials-smoke.mjs` 在模型菜单打开时检查实际悬停项的背景、强调色和胶囊边缘。Mac 夹具会重新激活自有测试应用并置前指定窗口；Windows 在解锁的独占控制台按五档缩放复验，尤其检查 1.25 倍，确认前台确为所属窗口且页面已获焦，再执行真实鼠标移入和原视觉断言。 |
| R13 | **正文流式来源。** 在 Windows 用 `chat-response-smoke.mjs` 的合成流分别观察两种顺序。来源注释先到时，正文链接出现即使用对应来源；正文先到时，形如域名的链接先显示域名，注释抵达即更新标题并加入来源区。两条路径都要在完成事件之前检查；另核对普通说明文字链接、带 `www.` 的域名、未确认来源的图标请求，以及完成后与重开会话的最终呈现。 |
| R14 | **冷启动只验证上一次成功连接的 AI。** 用 `chatgpt-single-login-smoke.mjs` 和 `copilot-login-smoke.mjs` 检查新装、首次跳过登录及断开后的零供应商访问。成功连接后冷启动，先在侧栏看到对应供应商和当前额度，再在设置看到「断开连接」，首次发送复用同一会话。系统凭据明确拒绝时只触发一次，本次运行的其他操作不重复读取；重启后可重新验证。断开后的重连取消／失败仍保持断开，只有重连成功才在下次启动恢复；成功换服务后只验证新选择。 |
| R15 | **额度百分比显示整数。** ChatGPT、Copilot 设置卡片、侧栏与面试摘要统一向下取整。用 `account-usage-ui.test.tsx` 和两个供应商登录专项验证 19%、19.99%、75.246% 分别显示 19%、19%、75%。数值进度条仍使用供应商返回的完整精度。 |
| R16 | **原生加密与重启恢复。** Mac 的 `cloud-native-vault-smoke.mjs` 使用 v11 签名测试助手及显式临时钥匙串，覆盖三个进程中的首次写入、重启解密、拒绝后保留原密文及再次启动恢复。Windows 在隔离用户下走本机 Electron `safeStorage`／DPAPI，用合成云会话和遥测证明验证加密落盘、同一用户跨进程恢复，以及存储不可用时保留原文件；按 Windows 原生格式验收。Mac 的 `v10` 密文前缀、钥匙串 ACL 和冻结助手身份由 Mac 单独验收。 |
| R17 | **面试与额度测试收尾。** 额度概览夹具通过当前 Copilot 会话验证接口提供合成账号。验证 175% 双服务切换，额度缺失时侧栏仍能显示已连接的服务，断开后显示未连接。面试徽标在 200% 缩放检查完中英文布局后，通过面试窗口的结束和确认按钮退出，再关闭主程序。 |
