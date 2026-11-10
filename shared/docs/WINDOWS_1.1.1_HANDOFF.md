# Windows 1.1.0 → 1.1.1 更新与测试交接

更新日期：2026-11-10。本文提供逐项变化、Windows 接续动作、操作步骤与预期，不保存测试成绩。用户已确认由其在 Windows 端按本文接续；本文件不表示 Windows 原生验收已执行。

## 基线、版本与范围

- 对比起点为私有源码标签 [v1.1.0／6b81effabce08df1a3b5836848f2eebddeec9d09](https://github.com/NCFXZ/VoxCue/commit/6b81effabce08df1a3b5836848f2eebddeec9d09)，更新输入为 [v1.1.1／e0a2a874bffbc37d5af57554074ade6fb7a8f446](https://github.com/NCFXZ/VoxCue/commit/e0a2a874bffbc37d5af57554074ade6fb7a8f446)。Windows 1.1.0 正式安装包的产品输入为 d9b231a289780f0bc0d8e0b59e38d6a5e4c3c0bc；标签中的后续元数据不改变该包。
- 版本唯一来源 shared/package.json 已为 1.1.1。Mac 本轮未写入 windows/，因此 windows/package.json 仍为 1.1.0；Windows 端先按本机规则同步生成清单。不要把这种有意保留的漂移当作已经生成了 Windows 1.1.1。
- [公开 v1.1.1](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.1.1) 当前只含 Mac 的完整正式资产并标记 Latest。Windows 在完整 1.1.1 资产形成前仍应选择 [Windows 1.1.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.1.0)。Mac 资产与输入见 [Mac 发行索引](MACOS_1.1.1_RELEASE.md)。
- 本次净变化包括下面 W001–W032。局域网配对、仅转录、可编辑快捷键、记录阅读位置和 ws 打包修复已在 Windows 1.1.0 中存在；本次继续回归，不将其重新称为 Windows 1.1.1 新功能。
- 开始时读取 AGENTS.md、PROGRESS.md 和本机 status/diff，保留用户及远端后续工作。Windows 上 macos/ 全树只读；只在 Windows 安装依赖、生成配置和产物。已有 v1.1.0、v1.1.1 标签不得移动。

## 逐项变化与验收

W001–W028 说明版本、共享实现及验证维护；W029–W032 明确 Windows 本机接续要求。主观视觉检查必须结合实际状态、几何和中间帧，不能只检查字符串存在。

| 编号 | 更新／修改 | Windows 操作与预期 |
| --- | --- | --- |
| W001 | 共享唯一版本改为 1.1.1；根和 Mac 配置已同步，Windows 配置留待本机生成。 | 从已包含上述输入的 checkout 接续，执行本机 sync:workspace；根／shared／Windows 版本一致，Mac 文件不由 Windows 生成或修正。 |
| W002 | 设置中的窗口快捷键名称统一为“显示或隐藏面试窗口”。 | 主界面设置和场内设置都检查同一名称；英文为 Show or hide the interview window。 |
| W003 | 设置中的面试面板名称统一为“展开或收起面试面板”。 | 不再混用“收起或展开”；英文为 Expand or collapse interview panels，保存的绑定不变。 |
| W004 | 设置中的转写面板名称统一为“展开或收起转写面板”。 | 不再把面板描述成“显示或隐藏”；英文为 Expand or collapse the transcript panel。 |
| W005 | 场内帮助按窗口可见状态显示单一动作。 | 可见时显示“隐藏面试窗口”；全窗隐藏后从主进程状态核对“显示面试窗口”，恢复后再切回，隐藏时不强制显示帮助窗。 |
| W006 | 场内帮助按面试面板状态显示单一动作。 | 展开时只显示“收起面试面板”，折叠后只显示“展开面试面板”；快捷键、按钮和帮助状态一致。 |
| W007 | 场内帮助按转写面板状态显示单一动作。 | 转写展开时显示“收起转写面板”，收起后显示“展开转写面板”；折叠、恢复和场内设置往返后继续一致。 |
| W008 | 麦克风帮助跟随已确认的静音状态。 | 麦克风关闭时 Ctrl+Shift+M 显示“打开麦克风”，开启时显示“关闭麦克风”；切换失败或取消不能显示未提交的新状态。 |
| W009 | 系统音频帮助跟随已确认的静音状态。 | 远程面试中 Ctrl+Shift+A 随开关显示“打开系统音频”或“关闭系统音频”；既有仅转录模式禁用规则保持。 |
| W010 | 英文开关动词位置统一。 | 当前动作使用 Turn on/off the microphone 和 Turn on/off system audio；设置使用 Turn on or off …，不使用把 on/off 放在句末的旧写法。 |
| W011 | 每种语言为开关动作预留最长文本宽度。 | 同一语言中依次切换窗口、面试面板、转写、麦克风和系统音频，帮助卡片宽度稳定；隐藏的测宽文本不重复暴露给辅助技术。 |
| W012 | 帮助卡片按当前语言内容收紧。 | 中文不为英文预留大片空白；切到英文允许按最长英文文案变宽，切回中文恢复紧凑宽度。Windows 的 Ctrl+Shift 字符串不能被裁掉。 |
| W013 | 帮助内容取消撑满画布的底部空白，并收紧内边距和行距。 | 未连设备时普通快捷键最后一行后只留正常内边距；标题、关闭按钮和全部普通行可见，小屏允许受控滚动，不把关闭按钮挤出视口。 |
| W014 | 设备滚动快捷键只在设备真正连接后显示。 | 启动服务、扫码或 pending 审批都不能提前出现远程两行；电脑批准并认证连接后显示，断开后隐藏。 |
| W015 | 远程两行平滑展开／收起。 | 实际临时 HTTP／WS 配对和断开驱动逐帧高度变化；卡片底部锚点与宽度稳定，动画不反向跳跃；减少动态效果时直接完成。 |
| W016 | 帮助使用主进程最小只读状态快照。 | DesktopAPI/preload 改为 onInterviewShortcutsState／interview:shortcuts-state，包含版本与必要布尔状态；旧 onInterviewDeviceConnection／interview:device-connected 已移除，调用方不能混用。 |
| W017 | 状态更新受新文档就绪与 rendererRevision 约束。 | 切换音频、布局、全窗可见性和设备连接后及时同步；重载期间旧页不能确认新 revision，新页就绪后收到最新状态，迟到回执不能写回。 |
| W018 | 结束面试时增加 owner、webContents 和退出意图检查。 | 帮助打开／关闭、重载、窗口异常关闭及正常结束都不向已销毁页面发送通知；观察主进程未捕获异常，不能靠吞掉异常或移除断言通过。 |
| W019 | 帮助按可见卡片维护鼠标命中，IPC 仅允许本窗修改自身穿透。 | 若 Windows presentation 暴露该能力，透明预留区能点击到底层，卡片和关闭按钮接收输入；主窗／子 frame／其他窗口不能改变 owner 或帮助的命中状态。 |
| W020 | 删除账号确认框接入共用勾选动画，使用危险色勾。 | 浅／深主题分别检查勾选与取消的中间帧、红色勾、按压反馈和 Space；缺少密码或确认仍不能提交，忙时仍不能重复提交，只用合成账号删除。 |
| W021 | 删除确认标题的垃圾桶图标移到文字前。 | 图标在标题左侧，垂直居中且间距合理；中英文标题不覆盖关闭按钮，普通非危险对话框的图标位置不被顺带改动。 |
| W022 | 资料选择改为主题色勾／半选横线和半透明主题色外圈。 | 简历／职位描述／技能等勾选与半选使用当前主题色，普通选择不变成危险红；保存、保留原资料、展开技能等行为保持。 |
| W023 | 删除与资料选择复用同一动画、尺寸和键盘样式，并补透明度辅助功能降级。 | 正反动画、Space、焦点圈、减少动态效果、减少透明、高对比和 Windows forced-colors 下均清晰可辨；原生 checkbox 语义和提交门控保持。 |
| W024 | 额度统一为五小时在前、每周在后。 | 设置实时卡片、读取骨架及既有摘要共用排序；中英文及刷新过程中均检查，不能只改展示标题。 |
| W025 | 额度排序不修改官方快照。 | 给反向顺序输入，显示五小时优先但输入顺序保持；只有周额度时不伪造五小时窗口，剩余量、低余额和重置时间含义保持。 |
| W026 | 离线 Electron 夹具在加载正式模块前设置自有临时 profile。 | 正常启动、加载失败与取消都只触及 owner 临时 userData/sessionData；拒绝越出本轮临时根，不访问真实账号或系统凭据助手。 |
| W027 | 快捷键、面试动效、退出生命周期、删除确认、资料选择、额度与英文回归补齐。 | Windows 执行本轮共享测试，保留真实菜单、按键、几何、动画、IPC 和生命周期断言。Mac 的 AppKit 输入、Dock 等分支不作为 Windows 结果。 |
| W028 | 侧栏更新按钮形变补悬停／焦点／位置诊断。 | updates-sidebar --diagnostics 可打印状态转换，失败时保留中间帧和最终透明度／宽度断言；先排查窗口焦点、原生鼠标事件及位置变化，不放宽失败条件。 |
| W029 | Windows 快捷键行为保持，补平台差异防回归。 | 默认 Ctrl+Shift；设置、实时预览、帮助和截图按钮继续字符格式，不显示 Mac 符号。Ctrl／Shift／Alt 任一加主键可录入，裸键、纯修饰键及 Command／Super 非法；IPC 不能由 Renderer 伪造 Mac 开关。 |
| W030 | Windows 五档 DPI 调度需要本机补入遗漏专项。 | 当前 windows-suite --dpi 未包含 interview-shortcuts、history-scroll、account-usage-overview、updates；在 Windows 调度器白名单加入这四组并执行全部五档，保留所有原组、原超时与断言。不要在 Mac 代改 windows/。 |
| W031 | 补真实 1.1.0 → 1.1.1 资料兼容验证。 | 现有 installer-upgrade 是 0.1.0→0.2.0 的合成 Electron 应用，installer-engine 是惰性应用／独立 GUID，且旧版本白名单仅 0.5.1／1.0.0；两者都不能声称验证了真实 1.1.0 profile。另用真实旧正式负载与同一自有合成 profile 验证新包读取、原件、记录、设置和旧索引。 |
| W032 | 最终 Windows 负载继续核对移动服务、资源闭包及 SDK。 | ws／qrcode-generator／@types/ws 已在 Windows 1.1.0 固定清单中，不重复升级。对这次最终 ASAR 启动 LAN 服务、读取全部移动依赖并拒绝桌面私有路径；通过 packaged-smoke 中的 checkPackageRuntimes 验证实际解包 SDK 子进程，不只检查开发 node_modules。 |

主要实现入口：shared/electron/contracts/shortcuts.ts、contracts/desktop.ts、preload.ts、main.ts、ipc/interviewShortcuts.ts；shared/src/components/InterviewShortcutHelp.tsx、FloatingInterviewShortcuts.tsx、ShortcutSettings.tsx、UsagePanel.tsx、ui/modal.tsx、services/accountUsageSummary.ts 和 styles.css。

## Mac 专属实现：Windows 保持自身策略

| 项目 | Mac 1.1.1 的差异 | Windows 接续要求 |
| --- | --- | --- |
| 快捷键字符 | ⌃、⌥、⇧、⌘、↩ 等原生符号，无连接加号；支持自定义 Command。 | 保持 Ctrl+Shift+M 等原字符、默认绑定和合法修饰键，不照搬 Mac 符号或开放 Command。 |
| Command 录入 | 仅 Mac 跟踪 Command 持键、兼容字母 metaKey／keyup 缺失，录入时临时忽略菜单快捷键。 | 不启用 Mac 菜单／Command 特例；继续验证 Windows 录入、冲突拒绝、取消和恢复默认。 |
| 转写闪烁修复 | Mac 在当前比例预留局部双面板画布，显隐只改逻辑布局。 | reserveTranscriptCanvas 只由 Mac 启用。保留 Windows 原固定画布、布局确认、拖动／缩放及选屏策略，补显隐回归。 |
| 帮助原生尺寸与层级 | Mac 最大 300 DIP 局部画布，原生 parent 为面试窗口。 | 当前 Windows 原生画布仍为 360 DIP，内容卡片按语言收紧；用 Windows 原生层级和命中验证关闭按钮可达，不硬套 Mac parent 断言或 300 DIP。 |
| 截图选屏 | Mac 现在按工具栏中心传 displayPoint。 | Windows 已有 HWND／工具栏与本机 DPI 选屏；可选参数为空时保留原路径，必须回归相邻大小屏和不同 DPI。 |
| 图标与原生绑定 | Mac 补 Keyboard 系统图标，去掉无消费者的 Search／Eye 映射；新增 AppKit 测试夹具。 | 不修改 Mac 图标、签名、原生二进制或夹具。Windows 图标及真实按键路径按本机消费者验证。 |
| 打包依赖 | Mac 本次补三项固定依赖与 ws 显式运行收集。 | Windows 1.1.0 已具备，不升级已有解析版本；只做冻结锁安装与最终包回归。 |

## Windows 接续顺序与命令

以下是待 Windows 本机执行的入口。先确认 checkout 含上述输入及本文，读取当地 AGENTS.md，并检查现有修改；每条命令均核对退出码，失败先定位修复后复验。GUI、原生、推理和长稳保持串行，当前用户须登录并解锁输入桌面；锁定／未知即停止，不改锁屏或辅助功能权限。

### 1. 同步本机清单与静态检查

在仓库根确认状态后，仅同步当前 Windows：

~~~powershell
git status --short
git diff
git rev-parse HEAD
pnpm sync:workspace
Set-Location windows
pnpm install --frozen-lockfile
pnpm typecheck
pnpm check:architecture
pnpm check:workspace
pnpm test
pnpm audit --prod
pnpm audit
pnpm build
~~~

Windows 本轮无需新增依赖或更换模型。若当前锁不能冻结安装，保留失败信息并查明漂移，不能借机升级。工作区检查对另一平台只读报告，不修正 macos/。

### 2. 准备只读参考和合成资料

- 客户端账户联调使用系统临时目录内的 VoxCue-server 0.5.3，固定源码 3bceb615dbba900f669322c301fc4b5b473dfb15；来源为 NCFXZ/VoxCue-server。设置 VOXCUE_TEST_SERVER_ROOT 指向这份临时参考，不 checkout、重置或部署现有服务端工作区。
- 优先复用 Windows 的 .cache/test-components 和固定公开音频缓存。只有已按目录与摘要认证的公共测试缓存可设置 VOXCUE_TEST_COMPONENT_CACHE；未设置时现有准备器会按固定目录下载并校验。临时 profile、数据库和模型副本继续走 owner 生命周期。
- 仅使用合成账户、资料、图片与本机文件 TTS；不读取真实登录／凭据，不采样物理音频或宿主屏幕。真实私人网络授权、手机键盘／安全区另列待验证。
- 以下命令均从 windows/ 执行，服务端环境变量应在运行前设置为这份实际存在且校验过的临时参考。

### 3. 先跑本轮定向回归，再跑完整共享矩阵

~~~powershell
node ../shared/test/scripts/functional-suite.mjs --list
node ../shared/test/scripts/functional-suite.mjs shortcut-settings interview-badge-layout interview-shortcuts language interview-motion interview-stability profile-selection account-erasure account-usage-overview updates updates-sidebar history-scroll mobile-ui mobile-bundle
node ../shared/test/scripts/functional-suite.mjs
~~~

完整入口包含安全／对抗、登录与账户、组件、知识库、聊天、面试、更新、20 轮面试及 600 秒公共文件音频长稳；不能只用定向组代替。只允许当前调度器已审计的纯 Node 协议组按其既有策略并行，其余均串行。

侧栏长按／取消及动画检查需要连续焦点。异常时可单独运行：

~~~powershell
node ../shared/test/scripts/updates-sidebar-smoke.mjs --diagnostics
~~~

### 4. Windows 原生与五档 DPI

Windows 原生默认清单含会采集宿主画面的 screenshot-performance --native --platform，本轮边界下显式排除该项，改跑无参数合成 4K 专项。其余原生组保持：

~~~powershell
$nativeSuites = @(
  'platform-native', 'login-actions-native', 'interview-access',
  'interview-effort', 'interview-layout', 'interview-workflow',
  'interview-context', 'updates-native', 'user-data',
  'telemetry-queue-native', 'speech-adversarial', 'speech-input-state',
  'echo-cancellation', 'wasapi-packets', 'electron-output',
  'components-native', 'presentation-native', 'rag-core', 'screenshot-monitor'
)
node test/scripts/windows-suite.mjs --windows @nativeSuites
node ../shared/test/scripts/screenshot-performance.mjs
~~~

先在 Windows 完成 W030 的四组调度补齐，再运行默认全部五档。这个调度器当前没有 --list 模式，清单以其源码为准，不照抄 Mac 参数：

~~~powershell
node test/scripts/windows-suite.mjs --dpi
~~~

覆盖 100／125／150／175／200%，每档均包含中英文、浅深主题、帮助窗动态状态、连接动画、checkbox 与额度顺序。出现失败保留原断言，修复消费者或夹具前置条件后定向复验，再按影响范围回归。

### 5. 实际文件识别与过滤

先准备并验证 Windows 固定公共组件缓存，再串行运行：

~~~powershell
node test/scripts/interview-real-audio-smoke.mjs --model=paraformer --cache=.cache/test-components --cases=ack,question,mixed,followup
node test/scripts/interview-real-audio-smoke.mjs --model=qwen --cache=.cache/test-components --cases=ack,question,mixed,followup
node test/scripts/interview-real-audio-smoke.mjs --model=paraformer --cache=.cache/test-components --all
node test/scripts/interview-real-audio-smoke.mjs --model=qwen --cache=.cache/test-components --all
~~~

Windows 使用现有 Huihui 文件 TTS 入口，不传 Mac 的 Metal 参数、不播放或录制硬件。必须保留真实 Controller→Worker→ACK、silence 非空终稿、自动／手动发送与记录关联；语气词无输出或被识别为其他字词时如实列为限制，不计作过滤成功，不扩张词表来掩盖识别误差。

### 6. 最终负载、安装和升级

先验证隔离打包和安装引擎：

~~~powershell
node test/scripts/portable-native-smoke.mjs --with-installer
node test/scripts/installer-upgrade-smoke.mjs
node test/scripts/installer-engine-smoke.mjs --previous-version=1.0.0
~~~

第一项产物仅位于测试临时根且不安装正式应用；后两项分别是合成 Electron／惰性应用的独立身份安装流程。不要把它们写成“真实 VoxCue 1.1.0 资料升级通过”。

另外完成 W031：在可丢弃来宾或严格 owner 临时安装副本中，校验真实 1.1.0 负载，创建合成个人资料、快捷键、主题／语言、面试记录／截图、知识库原件与旧索引；正常退出后换入这次最终 1.1.1 负载，核对原字节／元数据、读取位置、绑定、重开检索与重复启动。安装引擎提交、应用内更新暂存／取消、资料兼容分别记录覆盖范围；不覆盖真实用户的安装与 profile。

若 Windows 当前任务包含制作候选安装包，沿用现有入口并检查这次最终阶段：

~~~powershell
pnpm package:installer
node test/scripts/installer-artifact-smoke.mjs
node test/scripts/portable-native-smoke.mjs --installer-stage
~~~

必须核对这次 EXE、blockmap、latest.yml 与实际 ASAR 的一致性；包括 ws、移动 HTML／manifest 全部依赖、桌面文件拒绝、DOC／编码、RAG、实际 Copilot／Codex 子进程，以及生产应用拒绝测试入口。SDK 检查由 packaged-smoke 调用 package-runtimes-check 的导出函数，不能单独运行这个定义文件后因退出码为零就声称完成检查。

如需 Store 候选包／验收，按当前授权再执行：

~~~powershell
pnpm package:store
pnpm test:store:artifact
pnpm test:store:sandbox
~~~

1.1.1 按现有规则对应 APPX 身份版本 2.1.1.0，身份 Name／Publisher／PFN 保持。Sandbox 只在可丢弃来宾内给临时副本签名与安装；宿主不导入测试证书，原包摘要保持。真实 Store 更新必须禁用独立 GitHub 更新。本文不授权提交门户或发布 Windows 包。

## 更新渠道与结束交接

1. Mac-only v1.1.1 不能让 Windows 误选 Mac ZIP 或不完整 Windows 版本；在 Windows 本机用生产选择器核对完整稳定资产选择。
2. 本文不提供 Mac 的测试成绩作为 Windows 依据。真实账号、手机真机、网络权限与物理采集未覆盖时逐项说明；结果只在终端／对话，不向仓库提交报告、截图、trace 或 coverage。
3. 用户本轮确认的是 Windows 按文档接续测试。是否公开 Windows 资产、修改发行正文或更新 Store，按 Windows 当前任务的明确授权执行；若后来发布到既有 v1.1.1，保留已公开三项 Mac 资产、摘要、完整中英文内容及全部旧正式／恢复基线，不移动既有源码标签。
4. 修复后按风险复验；记录 Windows 实际输入 SHA、改动和未完成项，更新 PROGRESS.md 的接续摘要。最后消费者退出后核对 owner、真实路径及占用再清理本轮临时资料，现用依赖、认证公共缓存、凭据与历史保护目录保留。
