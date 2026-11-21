# VoxCue 1.3.0 Windows 更新与 macOS 开发交接

本文对照正式 Windows 1.2.3 与 Windows 1.3.0，记录各项功能、修复和 Mac 本机接续工作。GitHub 版本为 `v1.3.0`，Microsoft Store 的 Windows x64 包身份版本为 `2.3.0.0`。两个渠道的实际发布与认证状态见[项目进度](../../PROGRESS.md)。用户可阅读较短的 [Windows 更新日志](../../docs/1.3.0_WINDOWS_UPDATE.md)。[版本唯一来源](../package.json) · [平台接口](../electron/platform/types.ts)

## 对照基线

| 要回答的问题 | 代码参照及处理 |
| --- | --- |
| 相对已发 Windows 1.2.3 改了什么？ | 以 Windows 发行标签 `v1.2.3`（`fae85ca`）为起点，核对至 Windows 1.3.0 的实现。发行后可用 `git diff v1.2.3..v1.3.0` 复查。 |
| Mac 已经有哪些改动？ | Mac 1.2.3 标签为 `macos-v1.2.3`（`4fe22ec`）。Windows 标签之后、Mac 标签之前已合入窄窗记录标题重试按钮换行和回答数单复数。这两项计入 Windows 1.2.3 到当前版本的差异，已发布的 Mac 1.2.3 已包含。 |
| 哪些属于本轮开发？ | `5bfc716` 是两个旧版发行标签之后、此次开发改动之前的维护提交。用 `git diff v1.2.3..5bfc716` 区分中间维护改动，使用 `git diff 5bfc716..v1.3.0` 单独查看新版实现。Windows 工作区保留 `macos/` 的平台文件，由 Mac 本机接续。 |
| 哪些属已有能力？ | WASAPI 有界重连、Mac Core Audio 采集、两端截图、初开面试显示快捷键说明和窗口透明度动画均可在 1.2.3 找到。下文列出它们本次改变的环节。既有发布和恢复基线见 [Windows 1.2.3](WINDOWS_1.2.3_RELEASE.md) 和 [Mac 1.2.3](MACOS_1.2.3_RELEASE.md)。 |

可按任务查阅 [UI 和交互](#ui-和交互) · [新增功能与共享技术路线](#新增功能与共享技术路线) · [Windows 原生集成](#windows-原生窗口组件与更新) · [macOS 开发顺序](#macos-开发顺序与验收) · [逐项核对](#修复与性能优化逐项核对) · [验证入口](#验证入口与发行前待验)

下文用当前源码和隔离夹具说明实现，并按正式 Windows 1.2.3 标签区分旧版行为。真实厂商账户的授权、额度及计费，实体音频与多屏设备表现，仍须按文末入口分别验收。Mac 原生适配和签名包验收另在 Mac 本机进行。历史候选包和独立账号服务的部署各有单独记录。

## UI 和交互

这里以用户打开的页面为顺序。React、样式和状态来自共享层，图标、原生安全输入、权限和窗口能力由平台提供。[共享样式](../src/styles.css) · [桌面材质](../src/platform/webMaterials.css)

### 设置、账户迁移与准备页

- **英文错误和警告。** 准备页、账户导出与云同步可用英文说明聊天目录损坏、资料确认记录读取失败、导出时账户变化、迁移记录异常和文件标识冲突。知识库导入、API 密钥操作、账户注销、音频设备占用以及 Kimi 与火山方舟的服务错误也补齐了英文提示。同一次回答同时出现用量保存失败和知识库长度警告时，两条各占一行，均使用当前界面语言。[界面词典](../electron/contracts/uiMessages.ts) · [提示翻译](../electron/contracts/uiLanguage.ts) · [同步错误](../src/stores/cloudSync.ts)
- **切换或展开时保持正文宽度。** 使用占宽式滚动条时，设置右侧正文、个人信息正文、「开始面试」弹窗、数据迁移的步骤和分组，以及面试中的模型与设备设置，均从原有右内边距中预留滚动条宽度。面试记录列表沿用系统按需显示滚动条的行为。内容溢出时才显示滚动条，标题、表单和页脚保持设计的左右边距。准备页聊天含可展开的长消息、思考过程、来源或技能时，居中阅读区两侧等宽预留。模型菜单的「选择模型」和「思考强度」两页各自在实际滚动区两侧等宽预留。手机转录的最近三条预览和完整展开使用同一滚动区，同样两侧等宽。居中区域在各自的滚动容器上使用 `scrollbar-gutter: stable both-edges`。这样即使没有滚动条，左右留白仍然相等。使用覆盖式滚动条时，浏览器不额外占位。两端视觉表现待本机复核。[桌面滚动区域](../src/styles.css) · [模型菜单](../src/components/reasoningEffortControl.css) · [手机转录](../src/mobile/styles.css)

- **登录页右侧的面试演示。** 1.2.3 已有打开后播放一次的转写、思考和回答演示。本次转写和回答按显示帧率更新，静止阶段保持同一播放值。发出的问题使用面试浮窗的小幅上移动画，转写与回答复用浮窗的底部跟随逻辑。正文出现时思考提示收起，播放完毕停在末行。画面离开可视区或页面隐藏时暂停，恢复可见后从原进度续播。同一次打开登录页期间，切换注册表单或调整窗口尺寸会保留播放进度。开启「减少动态效果」时直接显示完整示例。[演示界面](../src/components/InterviewPreview.tsx) · [播放时序](../src/components/ui/useLoginPreviewPlayback.ts)

- **新用户注册。** 邮箱验证码与「创建账号」之间新增「我已阅读并同意 VoxCue 用户服务协议。」仅协议名称显示为带下划线的超链接，句号在链接外。注册说明的普通文字和协议名统一继承整行的辅助字号与常规字重（12 CSS px、400），修复了登录表单的通用标签样式使句首变大、变粗的问题。注册同意框与「数据迁移」中的勾选框共用样式（`selection-option`）：16 × 16 px、6 px 圆角，选中标记、悬停和键盘焦点效果一致。勾选框默认未选。未勾选时，「创建账号」按钮禁用，按回车也无法提交注册。打开链接保留表单状态，离开注册再返回需重新勾选。Windows 和 macOS 共用注册表单。点击协议名时，注册窗口将当前显示语言作为唯一参数传入 `session:open-user-agreement`。主进程只接受 `zh-CN` 和 `en`，分别在系统浏览器打开 `https://voxcue.com.cn/user-agreement/`（VoxCue 用户服务协议）与 `https://voxcue.com.cn/en/user-agreement/`（VoxCue Terms of Service），其他语言值均拒绝。[注册表单](../src/components/CloudAccountPanel.tsx) · [官网地址定义](../electron/contracts/cloudAccount.ts)

  在 Windows 工作区完成开发构建后，可从 [Start-VoxCue.cmd](../../windows/Start-VoxCue.cmd) 进入注册页复核。中英文分别检查实际打开的协议地址，开启链接失败时表单显示错误并保留输入。[数据迁移勾选项](../src/components/AccountMigrationSelection.tsx) · [共享勾选框样式](../src/styles.css)

- **界面语言与版本。** 新打开的窗口先读当前分区已保存的界面语言。分区没有这项偏好时，采用主进程创建窗口时传入的当前界面语言。应用首次启动又没有偏好时，简体中文系统使用中文，其他系统语言使用英文。「设置 → 关于与更新」沿用 1.2.3 的共享清单读取方式，本轮显示 `1.3.0`。Windows Store 的 Appx 身份版本按平台公式生成，本轮目标为 `2.3.0.0`。[语言偏好](../src/stores/generalSettings.ts) · [窗口初始语言](../electron/window.ts) · [关于与更新](../src/components/SettingsDialog.tsx) · [Store 版本映射](../../windows/scripts/package-store.mjs)

- **跟随系统。** 在「通用 → 主题」中，Windows 的「跟随系统」使用左半实心、右半镂空的圆形图标（Fluent `DarkTheme24Filled`）。菜单项和选中后的按钮共用这一图形。Mac 已有对应的原生符号 `circle.lefthalf.filled`。[主题选择器](../src/components/SettingsDialog.tsx) · [Windows 图标](../src/components/icons.tsx) · [Mac 符号映射](../../macos/src/symbols.json)

- **本地账户登录。** 本地账户的副标题用一句话说明资料保存在本机，登录后可迁移至 VoxCue 账号。「登录」文字左侧显示 16 px 的账户人像，与同页「数据迁移」「导出资料」的图标尺寸一致。Windows 使用 Fluent 人像，Mac 使用原生 `person` 符号。[账户设置](../src/components/CloudAccountPanel.tsx) · [Mac 符号映射](../../macos/src/symbols.json)

- **账户额度提示。** 提示内容与读取失败原因相同时只显示现有错误行，保留原样式和读屏提示。[额度面板](../src/components/UsagePanel.tsx)

- **迁移来源与密码。** 弹窗统一使用「数据迁移」。副标题写明「迁移后，本机来源账户的所选资料将被删除，云端副本保留。」标题和副标题整体与关闭按钮垂直居中，密码输入提示紧接其下，移除输入框下方的在线验证长说明。来源选择框右对齐，占标签右侧可用宽度的三分之二，窄窗优先保证可读。来源列表及密码提示以 `***` 遮蔽邮箱用户名的中间部分，按长度最多显示开头两位和末尾一位。域名保留，显示名重复时加序号。菜单与触发器等宽，挂载到原生弹窗并按整个视口计算高度。支持方向键选择，Esc 收起时焦点返回触发器。[迁移弹窗](../src/components/AccountMigrationPanel.tsx) · [选择菜单](../src/components/ui/choice-menu.tsx)

- **资料迁移的来源账号密码。** 原来的输入框缺少眼睛按钮，输入错误时很难核对。现在默认显示圆点，点击右侧眼睛可查看或重新遮挡，鼠标切换后可继续键入。键盘用 Tab 到达「显示密码」或「隐藏密码」（英文 “Show password” 和 “Hide password”），可用空格或回车切换，Shift+Tab 返回输入框。关闭已显示密码的弹窗会清空淡出副本，再次打开为空。来源密码仍须验证。[共享密码框](../src/components/ui/password-input.tsx) · [迁移验收](../test/scripts/account-transfer-smoke.mjs)

- **注销账号的当前密码。** 注销确认窗也缺少显隐入口，现与迁移共用右侧眼睛、键盘操作和关闭时清空的行为。永久删除仍须勾选确认并验证当前密码。登录、注册、找回密码原已支持显隐，此次统一复用同一控件。[注销验收](../test/scripts/account-erasure-smoke.mjs) · [登录、注册和找回密码](../src/components/CloudAccountPanel.tsx)

- **选择资料与冲突提示。** 个人信息、面试记录、知识库三组默认收起，所有可迁移项默认勾选，空组禁用，支持逐项勾选和半选。单项冲突标红。组标题由仍然勾选的冲突项计算，取消最后一项便清除「部分冲突」。确认覆盖时按三类展示所选冲突和总数，可返回调整选择。[选择与确认界面](../src/components/AccountMigrationSelection.tsx)

- **迁移弹窗的长列表。** 迁移和冲突确认弹窗共用固定毛玻璃标题栏。列表滚到标题下方时渐显材质，回到顶部时清除，高对比或减少透明度时使用实色。展开或收起资料组时先计算最终高度，最高为视口高度的 85%，再用 240 毫秒的缓动逐渐减速到终点。超出部分在正文滚动，底部按钮保持可见。中途反向从当前高度继续，调整窗口大小时重新适配，开启减少动态效果时直接切换。[高度过渡](../src/components/ui/useHeightTransition.ts) · [固定标题栏](../src/components/ui/modal.tsx) · [长列表与标题栏回归](../test/scripts/account-transfer-smoke.mjs)

- **分类标题与首行。** 七个设置分类沿用「面试设置 → 面试方式」的间距，从标题下沿到正文第一个可见控件、卡片或文本行按样式预留 26 CSS 像素（18 + 8），回归按可见首行与面试设置的实测差值不超过 1 px 判断。账号页的已登录和本地账户两种状态共用这一基准。[设置样式](../src/styles.css) · [首行间距回归](../test/scripts/assert-settings-heading-gaps.mjs)

- **准备页提醒与设置定位。** 顶部的本地资料提醒和组件提醒沿用下拉菜单的出现、消失动效。本地提醒说明「本地账户与当前账号的资料分开保存。」关闭按钮平时透明，悬停时显示圆形底色。手动关闭后，该云账号在本机重启仍隐藏提醒，设置里的迁移入口继续可用。直接完成迁移时记录当时的本地资料版本，之后如有新的本地资料，提醒可再次出现。点击「前往设置」会滚动并移动键盘焦点到对应行。「数据迁移」的灰色高亮向左右各延伸 12 px、上下各延伸 2 px，覆盖两条分隔线及分数缩放下的边缘。[本地提醒](../src/components/LocalImportNotice.tsx) · [关闭偏好](../src/services/localImportNotice.ts) · [高亮样式](../src/styles.css)

- **缺少本地组件。** 两种语音识别都未就绪时，准备页的组件提醒和面试准备引导同时标出轻量与多语言两个下载选项。如果也需要补装知识库检索组件，该行一并高亮。知识库专用入口只定位检索组件。旧组件目录按实际可下载项目定位，目录加载期间点击提示会先打开组件页，等目录返回再按实际缺项定位一次。此时已就绪的组件保持普通背景。两组标题下方留白 12 px，高亮上缘距标题行框约 10 px。高亮铺满卡片内宽，末行贴合底部圆角。[定位目标选择](../src/services/componentSettingsTargets.ts) · [准备页](../src/components/PreparationPage.tsx) · [个人信息侧栏](../src/components/PersonalInfoPanel.tsx)

- **设置整区定位。** 从多语言识别的性能提示进入面试设置，语音模型、推理设备和下方 CPU 说明共用一块连续高亮。整区与数据迁移采用相同的边缘处理，左右各延伸 12 px，上下各延伸 2 px，覆盖分隔线。音频设备和远程连接的定位也覆盖对应设置区域。暗色模式使用冷灰色 `#40474c`，启用减少动态效果时短时静态显示。Windows 启用强制颜色时，目标区域用系统高亮色描边。定位时优先聚焦首个可用的按钮或输入框，全部禁用时聚焦首个目标行。高亮持续约 1.9 秒，再次定位会重新计时。[语音设置](../src/components/SpeechModelSettings.tsx) · [设置定位](../src/components/ui/useSettingsTarget.ts) · [共享样式](../src/styles.css)

- **CPU 性能提示。** 主窗口和面试浮窗的语音设置共用此提示。多语言语音识别选用 CPU 时，硬件检测完成后才显示最终建议。Windows 检测到 CUDA 时建议使用 CUDA，Mac 检测到 Metal 时建议使用 Metal，缺少可用加速时建议选择轻量语音识别。显示建议时仍使用已选的 CPU。检测尚在进行时，已就绪的轻量模型仍可选择，多语言模型须等硬件结果。提示文字和上方间距随面板的 240 ms 非线性曲线展开。切回加速设备或轻量模型时一起收回。下方内容随之移动，提示换行后按实际高度展开。启用「减少动态效果」时直接切换。[语音设置](../src/components/SpeechModelSettings.tsx) · [面板动效](../src/components/ui/content-reveal.css)

- **行内错误提示。** 账号表单、数据迁移、AI 服务、音频与模型设置、准备页、知识库、面试记录、面试浮窗和远程连接的错误提示按文字实际高度展开和收起。提示与周围留白共用 240 ms 的非线性过渡，带动下一行、重试按钮或底部操作区平滑移动。收起期间退出的重试按钮立即停止接收键盘和鼠标输入。开启「减少动态效果」后直接切换。[共享动效](../src/components/ui/content-reveal.tsx)

- **同步设置。** 当前账户的偏好加载期间显示「读取中…」，读取完成后显示各类开关。重启后，已启用同步且已有基线的普通条目显示「待核对同步状态」，直至本次核对完成。「立即同步」与「刷新容量」间隔 8 px，和分类开关共用右边线。设置、个人信息和相关管理区以 `ResizeObserver` 的边框盒、内容盒和内边距计算滚动条占宽，按实际显示比例对齐设备像素。含该占宽在内，操作行距设置正文左右边缘各 24 px。资料绑定到其他账号时，同一行左侧展开提示，两个按钮随可见高度保持居中。展开后，多行文字完整显示并与按钮居中对齐。[设置面板](../src/components/SyncSettingsPanel.tsx) · [同步状态](../src/services/cloudSync.ts) · [账户界面回归](../test/scripts/cloud-account-smoke.mjs)

- **个人信息与更新面板。** 个人信息里的知识库选择框在缺少检索组件时显示就绪提示，「前往设置」直接定位该组件。编辑基本信息时，底部保存栏随未保存更改或冲突展开。AI 资料提案在选择为空、资料已变化或保存出错时就地更新提示。「关于与更新」的状态说明随内容调整高度，打开链接失败或面试期间暂缓安装的提示也随正文展开。[个人信息](../src/components/PersonalInfoPanel.tsx) · [资料提案](../src/components/ProfileProposal.tsx) · [更新面板](../src/components/UpdatesPanel.tsx)

- **远程连接。** 桌面设置中的「连接设备」使用完整链环。已配对后，红色「断开连接」按钮和再次点击前的「确认断开连接」都使用带斜杠的链环（Link Off）。执行断开时显示进度图标。[远程连接设置](../src/components/RemoteConnection.tsx) · [二次确认按钮](../src/components/ui/confirm-delete-button.tsx)

### AI 服务、授权和模型选择

- **回答标题显示 API 服务商标志。** 1.3.0 新接入的八家 API 在准备聊天、实时面试和面试记录中与 AI 服务设置共用图标，按每条回答记录的来源显示。准备聊天能在同一对话内切换服务。面试须先结束本场才可切换服务，之后重看旧回答仍显示当时的标志。缺少来源的旧资料保留通用图标。[回答标识](../src/components/ProviderIdentity.tsx) · [服务商图标](../src/components/ProviderIcon.tsx) · [两家 API 的界面验收](../test/scripts/api-interactive-preview.mjs)

- **准备聊天的 Logo 外观。** 去掉服务商标志背后的灰色圆角底，浅色和深色主题均直接显示标志。只调整底色外观，图标仍为 18 × 18 CSS px，占位仍为 25 × 25 CSS px，标题行高仍为 25 CSS px，名称与占位仍相距 7 CSS px。[聊天样式](../src/styles.css) · [实窗验收](../test/scripts/api-interactive-preview.mjs)

- **授权状态与行距。** ChatGPT 和 GitHub Copilot 的服务名与下方邮箱或「未连接」之间留出 4 CSS 像素，标题行高与「远程连接」一致。等待浏览器授权时，原禁用按钮和旋转图标改为普通状态文字，使用与「未连接」相同的字号和颜色。右侧「取消授权」仍可点击。订阅额度区在读取、可用和错误状态之间按内容高度过渡。通用占位说明与错误文案在当前语言下相同时只显示一条错误。[AI 服务设置](../src/components/AIServicePanel.tsx) · [订阅额度](../src/components/UsagePanel.tsx) · [授权与布局回归](../test/scripts/copilot-login-smoke.mjs)

- **未连接 AI 时开始面试。** 点击「开始面试」直接打开「AI 服务」，ChatGPT 和 GitHub Copilot 两行都保持普通背景，用户可自行选择连接方式。其他操作若明确定位账号授权，服务商行沿用整行高亮。「连接」使用完整链环，「断开连接」与远程设备共用 Link Off。Windows 使用 Fluent 的 `Link24Regular` 与 `LinkOff24Regular`。[准备页](../src/components/PreparationPage.tsx) · [账号授权](../src/components/AIServicePanel.tsx) · [图标映射](../src/components/icons.tsx)

- **通过 API 开始面试。** 启用 API 密钥后，旧的「开始面试」确认窗仍尝试显示订阅额度，常把正常可用的连接显示成「AI 服务用量暂不可用」。现在该行标题为「AI服务用量」，内容为「{服务商} API计费」。英文为「AI service usage」和「{provider} API billing」。服务商名称随当前连接切换，例如「OpenAI API计费」和「OpenAI API billing」，API 只出现一次。通过 ChatGPT 或 GitHub Copilot 订阅连接时，确认窗继续显示订阅额度。API 设置详情仍展示本机请求数和输入／输出 token，已保存密钥的 DeepSeek、Kimi 另可刷新官方余额。新版正式包待复核中英文显示与连接切换。[开始面试确认窗](../src/components/PreparationPage.tsx) · [API 设置详情](../src/components/ApiConnectionPanel.tsx)

- **API 连接列表。** 「账号授权 / API 密钥」沿用面试方式的双段滑块。两种连接方式之间的切换保留 240 ms 双向滑动淡变。退出面板与进入面板各按自身快照尺寸绘制，裁剪从首帧到末帧都使用窗口坐标。八家 API 使用同一服务列表。添加密钥会展开详情，点击「启用」后才切换当前 AI 服务。一个 VoxCue 账户可保存多家配置，同一时间使用一个连接。「启用 / 禁用」分别用三角启动和方形停止图标。两组按钮共用标准尺寸，密钥行可添加或移除密钥，确认移除时保持宽度。启用时展开详情，禁用时保留密钥并收起详情，成功移除后也收起。点击服务名可单独展开该行。上下展开及淡入淡出遵循减少动态效果偏好，服务商图标、名称与操作按钮始终和相邻行对齐。[设置面板](../src/components/ApiConnectionPanel.tsx) · [界面回归](../test/scripts/api-interactive-preview.mjs)

- **详情与用量。** 当前启用的 API 展示本机请求数、输入和输出 token。已保存密钥的 DeepSeek 和 Kimi 还可在详情中刷新账户余额，未启用时也能单独查余额。用量卡保留细边框，窄窗可分行。卡片下方左侧用固定圆点表示已保存密钥，并提供更换入口，右侧是获取密钥和官方账单链接。链接使用手形指针，最底部的分隔线区分服务商。通义千问默认北京，切换地域会清空工作区草稿。已有密钥的服务需重新验证并保存才能改用新地域或工作区。地域和工作区并存时同排，地域选择器按当前语言最长选项定宽，工作区随剩余宽度收缩。只有一项时标签靠左，标准宽度的控件靠右。[用量与详情](../src/components/ApiConnectionPanel.tsx)

- **添加、更换 API 密钥。** 弹窗移除了服务商副标题，字段标签使用「{服务商} API 密钥」，空框留白。显示和隐藏使用眼睛图标，取消、验证并保存均有图标。格式无效或模型目录验证失败时，弹窗用当前主题的错误红色说明原因，自动聚焦新的空白安全输入框，可直接键入再验证。更换失败时继续使用原密钥。Windows 登录密码框也使用眼睛开关。Mac 的密钥原生输入和平台图标见交接清单。[密钥弹窗](../src/components/ApiKeyDialog.tsx) · [安全输入助手](../../windows/electron/apiKeyPrompt.ts)

- **API 密钥输入与显隐。** Windows 的原生编辑框曾在 Electron 的亚克力窗口里收到按键，画面却仍为空白。修复保留原生助手和主窗口下的子窗口层级，将输入面板设为完全不透明的分层子窗口（`WS_EX_LAYERED`，透明度字节 255），并在助手内嵌 Windows 10/11 兼容清单。英文操作名是 “Show key” 和 “Hide key”。浅色和深色真窗用合成密钥核对了键入后显示实心圆点、点眼睛显隐和验证保存。安装包粘贴专项在禁用宿主剪贴板重定向的 Windows Sandbox 中通过 `WM_PASTE` 核对同一控件的遮挡、显隐和提交。[原生编辑框](../../windows/native/ApiKeyPrompt.cs) · [兼容清单](../../windows/native/ApiKeyPrompt.manifest) · [真窗验收](../../windows/test/scripts/api-key-dialog-native.mjs) · [安装包粘贴验收](../../windows/test/scripts/store-sandbox-smoke.mjs)

  输入框在首次有效布局后聚焦。点击输入区或用鼠标切换眼睛后可继续键入，键盘激活眼睛时焦点留在按钮上，Tab 可继续前进。密钥由原生输入框交给主进程。检查圆点和字形时须采集包含原生子窗口的实际窗口画面。[显隐与焦点](../src/components/ApiKeyDialog.tsx)

- 聊天、面试前设置与浮窗内设置均提供「刷新模型列表」。刷新期间菜单保持展开并依据上下空间避让，模型与推理强度按当前服务恢复。支持显式档位的 API 模型另有「自动」，目录明确报告有效默认档位时显示「自动（档位）」。仅提供思考开关的型号使用按钮，其余分级型号使用滑块。[模型菜单](../src/components/ReasoningEffortControl.tsx) · [面试中设置](../src/components/InterviewSettingsPanel.tsx)

### 知识库、聊天与面试浮窗

- **移除聊天底部的网页搜索提示。** 先前使用没有搜索工具的模型时，即使只发「你好」，正常回复后输入框上方也会出现红字，容易误以为发送失败。现在移除这类提示。请求会向模型说明本次没有搜索工具，以便需要实时资料时在回答中说明。连接失败、余额不足或本机用量写入失败仍按各自原因提示。[Responses 请求](../electron/backend/chat/service.ts) · [其他 API 请求](../electron/backend/api/messages.ts) · [界面验收](../test/scripts/api-interactive-preview.mjs)

- **文档索引进度。** 升级清理期间，每份涉及的文档都在文件名下方、大小后的原状态位置同时显示「正在删除旧索引…」。已有可用新版索引的文件保留自己的状态。清理结束后，各行随各自任务显示「索引中 N%」「正在写入索引…」和「索引完成」。旧版曾显示完成的文档也会显示此次重建进度。通用失败提示为「知识库处理失败，请重试。」和「Knowledge processing failed. Please try again.」。[文档列表](../src/components/KnowledgePage.tsx) · [逐行状态判定](../src/services/knowledgeIndex.ts)

- **同步图标与弹层。** 云账户的知识库卡片、详情标题和文档行使用同一状态按钮。偏好已读且分类关闭时，仅将普通的未同步、待核对、已同步显示为「同步已关闭」。未同步、暂停和关闭共用斜线云，文字各自区分。正在同步、删除及暂停处理中保留进度，失败或冲突保留感叹号。已同步显示勾选云，本地账户隐藏按钮。面试记录等页面打开同步弹层时，先让已有错误说明参与完整高度测量，再展开外层。短说明在展开、收起途中都不会闪现滚动条。长说明超出可用高度时，可在弹层内滚动到「重试同步」。[弹层定位与过渡](../src/components/ui/dropdown-motion.ts) · [状态按钮](../src/components/SyncBadge.tsx) · [图标](../src/components/icons.tsx)

- **跟随最新内容。** 准备聊天、面试转写和面试回答在跟随底部时，随新消息、流式换行和内容高度变化平滑上滚。同一个动画逐帧读取最新底部位置，连续更新时保留滚动速度。手动向上阅读会暂停跟随，点击向下箭头从当前阅读位置平滑回到底部。开启系统「减少动态效果」时直接定位。[跟随滚动](../src/components/useFollowScroll.ts) · [聊天桌面回归](../test/scripts/conversations-smoke.mjs) · [面试桌面回归](../test/scripts/interview-usage-smoke.mjs)

- **打开聊天记录。** 从「新对话」、其他聊天或其他页面打开长记录时，先按目标对话的 ID 恢复阅读位置，再播放从下向上的 Tab 入场动画。准备页在 React 的布局阶段完成定位，第一帧即可看到目标消息。在当前主窗口内，原先跟随底部的记录定位至最新消息，原先上翻的记录恢复到先前位置，动画结束时无需再次定位。[准备页切换](../src/components/PreparationPage.tsx) · [阅读位置恢复](../src/components/useFollowScroll.ts)

- **发出消息。** 准备聊天的新消息与面试浮窗的新问题复用 Tab 入场的淡入、8 CSS px 上移和 240 ms 时长。聊天气泡、文字、发送时间与复制按钮一起移动。面试问题和附带的截图、标识一起移动。入场动画只绑定本次发出的消息组。手机端处于前台且已连接时，按场次和问题的累计条数为新问题播放同一入场动画。首次载入、重新同步或重连恢复的历史问题直接显示。列表跟随底部时，滚动与入场可同时进行。开启「减少动态效果」时直接显示。[消息入场](../src/lib/messageMotion.ts) · [共享动画](../src/lib/messageMotion.css) · [面试问题](../src/components/FloatingAnswer.tsx) · [手机问题列表](../src/mobile/App.tsx)

- **思考状态与正文分隔线。** 准备聊天在计时行下方原位更新「正在思考」「正在处理请求」等状态。初始提示和以状态开头的活动列表都保留上下各 8 CSS px，切换时文字基线稳定。活动中的状态文字和推理标题沿用 1.2.3 的扫光节奏，每次扫过 1 秒、停留 2.5 秒。聊天和面试均以首段非空白正文作为显示分隔线的条件。思考期间隐藏分隔线，保留思考区的回答在正文开始时淡入分隔线，淡入与详情收起共用 240 ms 时长及缓动曲线，后续追加正文时保持可见。聊天可点击耗时重新展开详情。[共享思考区](../src/components/ResponseProgress.tsx) · [状态间距、扫光与分隔线](../src/styles.css)

- **面试浮窗的进度提示与收起。** 面试计时行下方为当前状态保留一个位置。开始检索时，「正在检索本地资料」直接替换「正在思考」，完成后原位显示「已检索本地资料」，失败时显示具体原因或失败提示。其他具体状态和过程说明同样使用主提示字号（14 CSS px）。同一段公开推理摘要只展示一次，有摘要的回答保留展开入口。短回答只有临时提示时，首段正文到达或一次性返回完整回答，就可阅读正文。此时分隔线保持隐藏，浮窗保留上一帧的提示内容，禁用其交互，在 240 ms 内将高度和透明度降至零后再卸载。服务商信息行预留复制按钮的高度，收起前后保留 14 CSS px 的正文间距，最后一帧位置稳定。开启「减少动态效果」时直接切换。[面试状态与显示条件](../src/components/FloatingAnswer.tsx) · [收起时保留内容](../src/components/ui/content-reveal.tsx) · [浮窗过渡与间距](../src/components/interviewReveal.css)

- **面试错误卡片。** 在 Windows 175% 显示缩放下，展开后的长错误卡片底边可能被动画容器裁去一个设备像素。仅在错误卡片的动画容器上设置 `overflow-clip-margin: 1px`，为红色底边留出绘制范围。长错误仍在卡片内部滚动，滚到底时底边完整可见。[面试卡片裁剪样式](../src/components/interviewReveal.css)

- **流式回答中的网站图标。** 正文继续输出或补充来源时，已加载的行内引用保留同一个图标，表格单元格内的引用也一样。此前每次刷新 Markdown 都会重建链接和表格，图标重新进入加载状态，短暂显示地球占位。链接和表格现在复用固定的 Markdown 渲染组件，来源索引通过 React Context 更新。同一主机已加载的图标可保留原节点和就绪状态。尚待确认的行内来源显示地球图标，来源确认后才加载网站图标，加载失败时保留地球图标。[Markdown 渲染](../src/components/MarkdownContent.tsx) · [图标加载与回退](../src/components/SourceLink.tsx)

- **面试回答的光标。** 流式正文的光标紧随末尾可见内容，随文字自然折行或显式换行。Markdown 渲染时在最后一个可显示位置插入光标，行内布局不为光标额外占宽，行尾也能贴住末字。段落、嵌套列表与引用、表格末格和代码块末行均遵循该规则。开启「减少动态效果」时光标静止。复制读取原文，生成结束、停止或失败时光标消失。[正文与代码渲染](../src/components/MarkdownContent.tsx) · [浮窗显示条件](../src/components/FloatingAnswer.tsx)

- 聊天附件的移除按钮与输入框工具按钮同高，使用 32 px 正圆。首次点击展开确认文字，再次点击移除附件。[附件操作](../src/components/PreparationPage.tsx) · [二次确认按钮](../src/components/ui/confirm-delete-button.tsx)

- 聊天侧栏以直径 5 px 的正圆表示状态。从开始思考到正文输出结束，圆点以两秒为周期在灰色和主题色之间渐变，尺寸固定。回复完成后，未读显示主题色，已读显示灰色。开启减少动态效果时使用静态颜色。[侧栏状态](../src/components/Sidebar.tsx) · [会话状态回归](../test/scripts/conversation-status-smoke.mjs)

- **开始面试。** 打开弹窗即检查设备，等待结果时在相应状态位显示占位，并为读屏提供检查说明。摘要与权限列表列对齐，检查或启动报错时仍列出麦克风、系统音频、屏幕截图、远程连接和快捷键，并保留具体错误。未知音源显示「待确认」，停用音源显示「未启用」。已授权音源有近期有效电平时显示主题色三柱波形，暂无电平时显示勾。预览随页面隐藏而释放，重新可见时再开，预览失败单独提示。[设备清单](../src/components/InterviewAccessList.tsx) · [音源预览](../src/components/InterviewAudioPreview.tsx)

- **快捷键与窗口。** 每场首次显示快捷键说明和窗口淡入淡出沿用 1.2.3。新增可配置的「显示或隐藏快捷键说明」，默认 `Ctrl+Shift+/`。面试窗可见时按组合键切换说明，回答面板原有的键盘按钮仍可直接开关说明。升级旧绑定时，只在默认键未被占用时补上该动作。被占用则保留原绑定，让用户另行指定。Windows 的显示前处理抑制系统缩放动画。Windows 用线框和斜纹窗口区分截图保护开关。Mac 当前仍显示盾牌按钮并调用 Electron 的 `setContentProtection`，适配器报告保护能力为 `false`，实际屏蔽效果须以平台验证为准。[快捷键定义](../electron/contracts/shortcuts.ts) · [旧绑定升级](../electron/backend/shortcutPreferences.ts) · [窗口装配](../electron/main.ts) · [Windows 助手](../../windows/native/WindowMotion.cs)

- 语音切换、音频恢复和远程设备断连等提示卡悬浮在转写面板上方，收起转写时移到回答面板，下方内容保持原位置。提示卡与输入框共用毛玻璃材质和圆角参数，开合沿用下拉菜单动效。右上关闭按钮与标题垂直居中，上边距一致，右边距与标题左边距相同，悬停时显示圆形背景。卡片操作按钮增加左右留白，减少动态效果设置同样生效。[提示卡](../src/components/InterviewNotice.tsx) · [浮窗样式](../src/styles.css) · [毛玻璃材质](../src/platform/webMaterials.css)

- **自动录音设置。** 「设置 → 面试设置」新增「面试时自动录音」，默认关闭。勾选后，下次面试的本地语音采集进入运行状态时自动开始录音，面试中仍可用顶部胶囊按钮手动开始或停止。界面注明录音只保存在本机。[自动录音开关](../src/components/SpeechControls.tsx) · [面试浮窗](../src/components/FloatingInterview.tsx)

- **菜单与材质。** 显示设置使用白色滑块手柄，相关下拉选择器的展开箭头为 14 px。聊天和面试的模型选择器统一文字与图标间距。迁移来源、录音片段和侧栏账号菜单共用毛玻璃材质。侧栏菜单将主题底色与模糊背景合成，弹窗淡入后释放透明度图层，使越过边缘的菜单仍能模糊下方文字。[显示设置](../src/components/InterviewDisplayControls.tsx) · [菜单与材质](../src/platform/webMaterials.css)

- 设置、组件列表、启动检查和面试错误提示统一采用「轻量语音识别」（Paraformer）和「多语言语音识别」（Qwen）。处理器指令集检查失败时，提示使用与设置一致的名称，方便用户找到对应选项。[语音设置](../electron/contracts/speechSettings.ts) · [硬件检查](../electron/backend/speech/hardware.ts)

- 双向切换都在发起请求时同步显示状态说明和两个带图标的按钮。说明移到下拉框下方，可换行，与按钮垂直对齐并留出间距，操作区平滑展开和收起。「加载中」显示旋转图标，就绪后同一按钮变为「立即切换」，宽度固定为较长状态。「取消切换」在加载和就绪待交接两个阶段均可用。设置面板和浮窗提示共用这组操作。[切换操作](../src/components/SpeechSwitchActions.tsx) · [面试设置](../src/components/InterviewSettingsPanel.tsx)

- Mac 接续时，实际面试浮窗顶部胶囊的录音按钮及动画保留共享实现，其余界面图标使用 Mac 端资源。该按钮的录音波形采用主题色，只读取已开启音源的近期电平，连续向左滚动。每根线平滑伸缩，停止后从最后一帧过渡到居中的待机图标。约 240 毫秒的过渡期间再次开启会从当前形状继续。待机图标保持居中，减少动态效果设置会停用循环动画。[录音波形](../src/components/RecordingWave.tsx)

### 面试记录、截图和导出

- **截图滚轮缩放。** 面试中和面试记录共用截图查看器。鼠标指针放在要查看的细节上，向上滚放大、向下滚缩小，无需按 Ctrl。画布按滚轮刻度、像素比例和连续手势区分缩放与平移，Windows 另识别高分辨率鼠标的分数刻度。触控板双指滑动和惯性平移，捏合或 Ctrl 加滚轮缩放。鼠标拖动和双击复位沿用原有交互。读屏说明同步更新。[共享查看器](../src/components/InterviewImages.tsx) · [输入判定与指针锚点](../src/components/InterviewImageCanvas.tsx) · [手势用例](../test/unit/image-canvas-wheel.test.tsx) · [面试与历史双入口回归](../test/scripts/interview-screenshot-smoke.mjs)
- **截图失败与原图保存验收。** 共享回归在生成进度收起、失败提示展开后，用 End 和 Home 滚动回答区，核对失败提示与所属回答等量移动、输入框保持原位，重试沿用原截图。从 `windows/` 运行 `node ../shared/test/scripts/interview-screenshot-smoke.mjs --native-hits` 可另验查看器「保存图片」和「关闭截图」的中心及四边，使用测试窗口拥有的 Windows 保存对话框保存或取消，并比对导出的合成 PNG 与原图字节。合成像素、临时用户目录和导出文件均归本次测试所有。[共享截图回归](../test/scripts/interview-screenshot-smoke.mjs) · [Windows 原生保存专项](../../windows/test/scripts/image-save-hit-check.mjs)

- **回放控件与跟随。** 播放器有收起、悬停胶囊和展开三种形态，沿用工具栏毛玻璃。支持暂停、前后跳十秒、选段与定位到当前转写。单击进度条时，转写平滑滚到所选时间对应的字幕。途中再次单击或开始拖动，转写从当前位置承接原有滚动速度，跟随最新目标。目标反向时，转写先平滑减速再转向。慢拖微调时，同一句字幕保持稳定，跨句时平滑移至新字幕。按住进度条停止移动或直接松手，转写都会短暂减速，准确停在当前时间对应的字幕。启用「减少动态效果」时直接定位。使用进度条或「定位到当前位置」遇到静音间隙时，只在当前录音片段内查找最近的字幕。点击定位按钮会短时高亮目标字幕。自动跟随继续使用播放状态底色。片段菜单最高占弹出方向可用空间的三分之一，其余片段可滚动选择。点击有录音覆盖的转写可跳转，重叠发言可同时高亮。选中文字或点击行内「AI 回答」保留原操作。手动滚动暂停跟随，自动续段保留跟随状态，主动定位、选段、快进快退或拖动进度恢复跟随。[历史播放器](../src/components/RecordingPlayer.tsx) · [详情与转写](../src/components/HistoryDetail.tsx)

- **原问题与 AI 回答双向定位。** 1.2.3 已能在原问题与回答之间跳转。现在点击「AI 回答」会等待侧栏展开，再尽量把对应回答的开头对齐栏头下沿。和个人信息面板一样，可拖动侧栏左缘调宽，或聚焦左缘后用左右方向键每次调整 20 px。双击左缘或按 Home 恢复当前窗口下的默认宽度。在同一条面试详情中收起再打开，保留所选宽度。窄窗沿用抽屉布局。滚动回答时，固定标题的毛玻璃背景按实测滚动条宽度向右延伸，覆盖轨道顶部直到侧栏右缘，标题内容仍与正文对齐。点击「定位到原问题」滚动转写区，窄窗会收起回答栏。两种跳转都在目标滚动到位后才开始约 1.9 秒的灰色高亮。暗色模式的转写行与回答卡共用设置定位的冷灰色 `#40474c`，高亮随后自动淡出。再次点击可重新定位并计时，手动滚动可打断正在进行的定位。若该行仍在播放，灰色淡出后恢复播放底色。[历史详情与滚动逻辑](../src/components/HistoryDetail.tsx) · [共享调宽手柄](../src/components/ui/PanelResizeHandle.tsx) · [标题栏材质](../src/platform/webMaterials.css) · [定位计时](../src/components/ui/locationHighlight.ts)

- **删除失败与结束状态。** 删除失败的具体原因在详情正文中显示一次，左边缘与面试标题对齐。在浮窗中确认结束时，已有内容须保存成功才关闭。没有转写、回答、录音或收尾错误的空场次可直接关闭。转写收尾失败时，记录标为中断，详情的状态胶囊显示「转写可能不完整」。录音单独报错时，也会保留可归档的记录和录音错误原因。[结束与归档](../src/stores/interview.ts) · [历史详情](../src/components/HistoryDetail.tsx) · [详情样式](../src/styles.css)

- **导出选择。** 本场总共只有一段且可读时直接进入 WAV 另存窗口。多段默认展开「所有录音」并全选。有损坏片段时，组标签显示「所有可用录音」及数量，只选中可读项，即使仅剩一段可读也先展示选择器。坏段保留序号，显示「无法读取」并禁选。可整组或逐项勾选，部分选中时显示半选，折叠保留选择，选中项为空时禁用弹窗的导出动作。整场均不可读时，详情页隐藏录音导出入口。箭头悬停背景透明，键盘聚焦保留焦点环。弹窗随列表缓动伸缩，达到高度上限后正文滚动。[导出选择与交互](../src/components/RecordingPlayer.tsx)

## 新增功能与共享技术路线

### 账号隔离、升级与同机迁移

| 场景 | 1.3.0 工作区的实现与边界 |
| --- | --- |
| 从 1.2.3 首次进入 | 主进程用账户所有者标识的 SHA-256 选择 `account-profiles/<hash>` 和 `persist:voxcue-user-<hash>`，主窗、面试窗使用同一分区，登录窗使用 `persist:voxcue-login`。WAV 另存于 `interview-recordings-v1/<hash>` 下的场次目录。退出换号时取消原账号的请求，关闭旧窗口，等待写盘、知识库、媒体及 AI 运行时收尾后再加载登录表单。 |
| 旧版资料认领 | 有旧资料时，首次进入的本地账户或云账号先持久化为唯一认领者，再依次迁移原生文件和浏览器数据。中断后由同一认领者接续。复制快捷键、更新偏好、用量账本和截图。目标尚无索引及浏览器资料时，可保留旧 LanceDB 索引的已发布修订。浏览器通过两个隐藏窗口以 1 MiB 分块传输，每块确认后继续。迁入个人资料、面试历史、准备聊天及附件、简历、知识库原件及备份、主题与面试设置。云账号只接收自身的旧同步状态。旧分区与目标分区都有未完成的上传时，合并两份续传清单，同键保留目标条目。目标已有简历时，为不同 ID 的旧简历建立原件备份。订阅服务选择按原服务名迁入，初始标为未连接。旧订阅登录凭据和 Copilot 会话留在原目录，由新分区走正式授权。 |
| 选来源和验证密码 | 支持同机本地账户与云账号双向迁移，或云账号间迁移。当前账号从同机已有的其他云账号中选来源。有待迁资料的本地账户也可作为免密来源。云来源先查询原服务的能力，以 ID 和邮箱核实身份。支持 `password-only-v1` 时直接验密。旧版 v1 服务使用临时登录并退出，旧服务会话槽已满时可能挤掉最早设备。认证失败、未知协议、身份不匹配及退出临时会话失败会终止迁移。网络不可达、502/503/504 或部分停服页面才进入离线验证。本机在成功注册、密码登录或在线验证来源后，为该账号、邮箱和服务地址保存系统加密的 scrypt 随机盐校验记录。重置密码会清除该邮箱的旧记录，服务端确认账号停用时也会清除对应校验记录。旧版记录可读，无固定时限，连续输错跨重启限速。离线可取范围为这台机器上的副本。 |
| 预览、冲突与保存 | 手动迁移可选个人信息字段与简历、面试记录、知识库及库内原件。准备聊天和界面偏好仅参与上面的旧版升级认领。来源窗口使用隐藏沙箱且不加载 Desktop API。按个人字段、面试 ID、知识库 ID 和库内文档匹配，结合内容摘要判定冲突。同名不同 ID 的库可并存，同库同名替换保留目标文件 ID，跨库撞 ID 则分配新 ID。确认绑定选项和原快照。普通文档及短标题记录以元数据预览，候选冲突按需比摘要，确认后分块传输选中的正文。来源窗口在建立快照时仍会读取历史。缺少元数据和旧版长标题会提前读取。应用在暂停目标同步后复核选择与目标，所选历史和知识库原件在同一 IndexedDB 事务内提交，失败回滚相关个人资料。 |
| 同机迁移大小限制 | 迁移清单最多 8,192 项，非录音封包每项最多 64 MiB。清单中已知大小的封包与确认时补计的所选截图合计最多 512 MiB，分块读取每次最多 1 MiB。WAV 由主进程单独复制。 |
| 迁移截图、录音与清理来源 | 只取选中面试依赖的截图和 WAV。截图确认阶段复核原件、大小与摘要。已有相同录音可复用，ID 相同而时间或内容冲突则保留来源并报错。中断录音只复制合法 WAV 头声明的已写入前缀，按完整来源摘要决定能否迁出。目标确认提交后写迁出回执，再核对来源快照并移除选中项。新编辑、后来新增的片段及其他场次共用截图受保护。中断需再次解锁原来源后续办。来源云账号按条目、字段保存本机迁出标记，下载时隐藏已迁出资料，上传时将仍可见字段合回云副本。 |
| 本地资料提醒 | 个人资料、历史目录修订、知识库与原件修订分别计算摘要，日常仅重算有变的分类。启动、显式刷新和已授权迁移进行完整分类核对。兼容旧摘要并在资料相同时保留修订号。每个目标云账号以同一个偏好键记录手动关闭状态或已处理的修订，前者持续隐藏，后者允许新的本地资料再次触发。 |

源码与回归见 [账户装配](../electron/accountProfile.ts)、[升级认领](../electron/backend/legacyProfileClaim.ts)、[原生资料与索引](../electron/backend/legacyProfileFiles.ts)、[浏览器旧数据](../src/services/legacyBrowserData.ts)、[来源窗口](../electron/profileImportSource.ts)、[冲突和事务](../src/services/accountImportPlan.ts)、[迁移编排](../src/services/accountImport.ts)、[迁出回执](../electron/backend/accountImport.ts)、[迁移封包限制](../electron/contracts/restoreData.ts)、[在线来源验证](../electron/backend/cloud/client.ts)、[离线校验记录](../electron/backend/cloud/migrationPasswords.ts) 与 [来源同步过滤](../src/services/migrationSyncProtection.ts)。

### 云同步、资料恢复、导出与账号注销

| 场景 | 共享代码的改动 |
| --- | --- |
| 同步时机与配额 | 1.2.3 已有分类开关、本地/云端/基线三方比较及分块续传。现在先读取当前账号的偏好和基线。本地写入通知带上条目键，文件变更也标记所属库。同步逐类读取清单，同轮复用可用快照。轮询发现云端与本机相同时，仅在基线或父项等有变化时再写盘。对原件已删除的未完成上传，使用上传 ID 中止。若创建上传的回复丢失，则以原请求 ID 找回上传 ID 再中止。网络错误保留待办。上传确认后同基线保存 `cleanupPending`，重启可续清旧版本，依据当前头和修订保护新版本。首次或文件身份变化时，主进程读取原图和预览计算摘要。轮询命中缓存即可免读，实际上传时才把完整封包交给渲染器并复核。 |
| 面试结束自动续传 | 面试占用资源时，主进程返回标记 `deferred`（值为 `interview`），同步引擎暂缓当前任务，保留上传进度，条目不会因此记为「同步失败」。面试结束或启动失败并释放资源后，主进程通过 `cloud:sync-available` 通知主窗口。当前账号的同步引擎作废面试记录快照，立即重扫已启用的分类，续传未完成的数据，并纳入刚归档的记录及相关截图，无需手动点击「重试同步」。用户手动暂停的条目继续暂停，服务端要求的退避仍然生效。[面试生命周期](../electron/main.ts) · [通知与快照](../src/stores/cloudSync.ts) · [让出与重试](../src/services/cloudSync.ts) |
| 恢复与同步冲突 | 按 ID 读取目标知识库和文件，写入前再验修订和摘要。云端个人信息按原文和账号复核，面试记录按当前场次事务校验。保留单条本地手改标题时只回传该条。恢复云简历时在停旧索引前和原件写事务内两次核对 ID 归属。原件名兼容 255 个 UTF-16 码元，旧资料重名时保留扩展名、编号及完整 Unicode 字符。 |
| 可恢复的云面试备份 | 云端封装与恢复共用记录校验，单项封包上限 64 MiB。单场记录最多引用 4,095 张不同截图，加上记录本身最多占 4,096 个资源。同步各分类的本地条目数也受 4,096 项上限约束。每个下载块与最终封包均验摘要，面试 JSON 正文超过 8 MiB 时交给渲染器 Worker 解析。手动标题最多 80 个 UTF-16 码元，旧版超长自动标题分别校验知识库前缀和标题正文。同步优先处理记录依赖的截图。缺图可从同账号同 ID 的有效云端版本补回，全部依赖就绪后再提交记录。覆盖前登记失去引用的旧图，本地回收等到本轮恢复结束。云端待删除截图排在记录之后，仍有远端记录未同步完成时保留待删项。 |
| 历史写入和截图回收 | 1.2.3 的整份 localStorage 历史迁入文档 IndexedDB v2 的 `interviewRecords` 与 `interviewDirectory`，迁后核对完整记录及目录才清旧键。列表读目录，详情按场次读，自动云同步按修订复用摘要。删除或替换的图片分批登记，每批最多 100 项。桌面从目录的 `imageIds` 多值索引查是否仍有引用，清理与恢复互斥，保留失败批供重试。原件历史备份库另升至 v2，按文档或库的索引查主键回收。旧库作为来源只读，升级事务阻塞或失败可重试。 |
| ZIP 导出 | 1.2.3 已能导出三类资料。现在对来源账号标为已迁出的部分，按已公布的云头版本取回缺项并校验，导出个人资料、面试文字与截图、知识库及简历原件。普通云端未恢复项或未解决的冲突仍需先处理。遇到未知类型的已发布云资源时，主进程隐去资源名，仍保留其存在信息供导出核对，避免漏项却显示导出完成。WAV 从面试记录单独导出，资料 ZIP 沿用原布局。导出暂存和跨盘目标临时副本各用独立系统租约。同盘改名发布，跨盘先登记空文件身份，再复制和改名。中断后只清理租约已失效且归属确定的暂存，旧 PID 标记采用旧检查。逐张导出截图可取消。 |
| 删除账号与换号恢复 | 删除前按账号加密写入本机意图。仅支持 `accountDeletionReceipt: sha256-v1` 的服务使用 32 字节随机查询凭据，服务端仅存其摘要。响应丢失可凭原服务、账号与凭据查询，确认后才清理。旧服务声明 `accountDeletion: account-erasure-v1` 且缺少回执能力时，正常成功仍可收尾，丢失响应则保留意图。首次请求若被明确拒绝（如密码错误），撤销本次新意图。若之前的删除结果仍未知，重复请求被拒绝时继续保留该意图。清理按所属分区、认领结果、加密会话、遥测票据和事件归属进行，保留其他账号和无法确定归属的旧恢复副本。删除已经确认但本机清理失败，或本机回执读取出错时，暂时阻止该账号登录和迁移。下次启动先恢复删除事务，再启动遥测队列。删除时取消授权流程，对可退出的服务发起退出并等待剩余资源释放，即使部分步骤失败仍尽力收尾。账号操作失败返回原窗时，撤销本次关闭许可。 |

源码与回归见 [同步调度](../src/services/cloudSync.ts)、[云封包与写入](../src/services/cloudData.ts)、[按场次存储](../src/services/history.ts)、[截图回收](../src/services/historyImageRemoval.ts)、[原件备份](../src/services/originalBackups.ts)、[可读 ZIP](../src/services/accountExport.ts)、[导出暂存](../electron/backend/accountArchive.ts)、[跨盘发布](../electron/backend/accountExportOutput.ts)、[删除回执](../electron/backend/cloud/erasureReceipts.ts) 与 [按账号清设备数据](../electron/backend/cloud/eraseOwnerDeviceData.ts)。

### 独立账号服务的协议与发布依赖

**服务端能力。** 账号服务 0.6.1 于 2026-11-20 上线，生产源码为 `3440a25`，数据库为 SQLite schema 12。11 月 21 日匿名读取公网 `GET /v1/capabilities`（账号服务）和 `GET /v2/telemetry/capabilities`（遥测服务），两者均返回 0.6.1。该部署提交的 `GET /v1/capabilities` 声明 `profilePasswordVerification: password-only-v1` 和 `accountDeletionReceipt: sha256-v1`。桌面端按声明使用 `POST /v1/auth/verify-password` 验证迁移来源账号的密码，或用 `POST /v1/account/deletion-status` 查询结果未知的注销请求。无会话验密复用登录限速并只返回公开身份。注销先认证当前会话并校验密码，再在 SQLite 事务中重新认证会话，核对用户 ID 和密码摘要后提交删除与回执。独立服务仓的两个提交链接需有该仓库的访问权限，公开能力可直接从匿名接口核对。[线上能力清单](https://accounts.voxcue.com.cn/v1/capabilities) · [服务端部署记录](https://github.com/NCFXZ/VoxCue-server/blob/1b1217d669c48e23f3672e65bcfdd6f212ac7261/OPERATIONS.md#061-实际部署状态与回退) · [部署提交中的能力声明](https://github.com/NCFXZ/VoxCue-server/blob/3440a2517ad3e4d2ee486c76023d229a0ec17fa8/src/routes.ts) · [桌面端能力协商](../electron/backend/cloud/client.ts)

schema 11 保存删除回执，schema 12 为待回收分块增加可重试时间。每轮最多回收 32 个已到期的密文块，单个回收失败后推迟 60 秒再试。备份维护与到期用量清理独立。启动补建 `backup_uploads.resource_id` 和 `version_id` 关联索引，备份分页协议不变。复核入口为服务仓的 `test/account-deletion.test.ts`、`test/cloud-http.test.ts`、`test/backups.test.ts`、`test/recovery.test.ts`，冷备恢复须使用支持 schema 12 的 `scripts/snapshot.mjs`。

### AI 连接、模型与密钥

1.2.3 已有 ChatGPT 托管登录、GitHub Copilot、流式回答和本机用量。1.3.0 删除旧的独立 ChatGPT OAuth 回调实现。订阅仍使用 VoxCue 自己的 Codex 会话。目录请求从固定的 `client_version=0.164.0` 改为发送本机配套运行时版本，Windows x64 升至 `0.170.0`。客户端按目录中的可见性、可用性和 `minimal_client_version` 筛选 `models[].slug`，读取服务端声明的推理档位。回答沿用 `chatgpt.com/backend-api/codex/responses`，额度沿用 `account/rateLimits/read`。Copilot 沿用 SDK 的 `rpc.models.list`、`rpc.quota.refresh` 和所选完整模型 ID，在新目录缓存内去重、排除策略禁用的型号，并在发送前核对选定档位和明确声明的图片能力。[订阅目录及生成](../electron/backend/chat/service.ts) · [目录解析](../electron/backend/chat/models.ts) · [运行时版本校验](../electron/backend/chat/codexUsage.ts) · [Copilot](../electron/backend/copilot/service.ts)

每个 VoxCue 账户在自己的 `auth-data/api-keys` 目录中为每家 API 服务保存至多一份配置。`api-keys:configure` 只接收公开配置、请求 ID 和原生输入框的位置及主题，密钥由原生控件直接交主进程。候选配置须从认证目录读到至少一个兼容型号，主进程才将选定目的地和密钥一起系统加密，连同可公开读取的配置原子写入。列表只读公开配置，实际用密钥时再核对密文中的目的地。取消或验证失败保留原密钥。禁用只停用连接，主动移除才删除本机记录。单项配置损坏时仍可更换或移除，其他服务仍可用。获取密钥与官方账单按钮只打开固定的厂商地址。[设置 IPC](../electron/ipc/apiConnections.ts) · [候选验证](../electron/application/apiConnections.ts) · [密钥存储](../electron/backend/api/credentials.ts)

准备聊天与面试回答经 `RagChatService → SelectedChatService` 发送给当前连接，同名模型按所选服务路由。历史标题也接受含 `/` 的完整模型 ID，取消标题任务同时取消等待目录。三个选模入口均可手动刷新，准备聊天和面试前设置用 `chat:models(true)`，面试窗口用 `interview:models(true)`。把 ChatGPT 既有的五分钟目录缓存扩展到 Copilot 和八家 API。相同连接身份共享一次在途查询，目录查询限时 20 秒。单个读取者取消不影响其他读取者。主窗口每分钟及重新获得焦点时检查是否到期，到期才更新。面试浮窗在打开设置时读目录，也可手动强制刷新。相关鉴权和模型错误使目录过期，换连接、成功换密钥或移除密钥使旧请求失效。每个账号按服务分开记住聊天与面试的模型和强度，切回时优先恢复有效偏好，旧模型仍可用而仅强度失效时改为「自动」，原模型失效则用目录首项与「自动」。同服务后台刷新发现已下架型号则提示重选，空目录或加载失败不覆盖偏好。[目录缓存](../electron/backend/chat/modelCatalog.ts) · [历史标题](../electron/application/historyTitle.ts) · [选择偏好](../src/services/serviceModelPreferences.ts) · [路由测试](../test/unit/model-catalog.test.ts)

下表记录客户端实际构造的请求。首次验证和手动刷新均只读目录。账号的推理权限及计费须以实际响应确认。除 Gemini 原生目录外，均由主进程发送 Bearer 头。

| API 服务 | 模型目录 GET → 流式生成 POST | 发包与错误处理 |
| --- | --- | --- |
| OpenAI | `api.openai.com/v1/models` → `/v1/responses` | 解析 `data[].id`，保留微调完整 ID。过滤非文本、专用搜索和已列入非流式清单的 o1-pro、o3-pro、gpt-5.5-pro 及日期快照。已知支持严格结构化输出者用 `text.format`。gpt-5.2-pro、gpt-5.4-pro 等由指令携带 schema，在本机校验。按模型能力提供网页搜索。区分限频、余额不足及支出上限。 |
| Claude | `api.anthropic.com/v1/models` → `/v1/messages` | 客户端发送 `anthropic-version: 2026-10-21`。配置工作区时，目录与生成均带 `anthropic-workspace-id`。按 `has_more/last_id/after_id` 翻页，读取图片、PDF、思考能力，解析 Messages 原生流、拒答、截断及缓存用量。 思考块（含 `redacted_thinking`）开始时即显示思考状态，签名和不透明数据不进入显示正文。此版本的请求省略 `temperature`、`top_p`、`top_k`。[官方迁移说明](https://platform.claude.com/docs/en/api/migration-2026-10-21) · [流式事件](https://platform.claude.com/docs/en/build-with-claude/streaming) |
| Gemini | `generativelanguage.googleapis.com/v1beta/models` → `/v1beta/openai/chat/completions` | 目录用 `x-goog-api-key`，按 `nextPageToken` 翻页。选择支持 `generateContent` 的文本型号。生成用 Bearer，去除 `models/` 前缀，保留已选版本/别名。识别 `API_KEY_INVALID`。 |
| 通义千问 | 所选百炼地域的 `/api/v1/models` → `/compatible-mode/v1/chat/completions` | 按 `providers=qwen`、`capabilities=TG` 和页号查全目录，厂商报错、页号错误、总数非法或取得总数前遇到空页时放弃本轮结果。支持北京、新加坡、弗吉尼亚、东京、香港、法兰克福。东京、法兰克福须填工作区。弗吉尼亚目录固定用共享域名，推理按工作区路由。过滤不适用的专用型号。指定型号回传公开助手历史时用 `preserve_thinking: false`。 |
| DeepSeek | `api.deepseek.com/models` → `/chat/completions` | 按返回的模态及强度配置发送，接受带 `choices` 的流尾用量。余额另查 `GET /user/balance`。 |
| Kimi | `api.moonshot.cn/v1/models` → `/v1/chat/completions` | 按已知型号及目录标志映射思考与图片能力。指定 K3、K2.7-Code 型号将公开历史角色、文字和图片按原序作为引用续接。429 区分余额、过载和限频。余额另查 `GET /v1/users/me/balance`。 |
| 智谱 GLM | `open.bigmodel.cn/api/paas/v4/models` → `/api/paas/v4/chat/completions` | 仅国内通用 Key 的固定域名，按目录中的适配 ID 发包，按型号映射思考与图像、过滤独立助手。1211 使目录过期，按业务码区分余额不足（1113）、无权限（1220、1311）、限频（1302）、繁忙（1305）、支出或用量上限（1308、1310）和企业编程密钥用途不符（1315）。省略 `stream_options`，取末块用量。目录行为有本地协议夹具覆盖，实际账号可用型号仍待核验。 |
| 豆包／火山方舟 | `ark.cn-beijing.volces.com/api/v3/models` → `/api/v3/chat/completions` | 按发布状态、任务、端点及模态筛选账户目录，包含符合条件的其他品牌。已知 Seed 型号合并等效强度，使用基础模型版本 ID。区分模型未开通与仅可使用自建接入点两类错误。两款 261017 托管 DeepSeek Flash 型号直接取终态用量。 |

OpenAI Responses 将 TXT/MD 解码为文本，图片为 `input_image`，PDF、DOC(X)、PPT(X)、XLS(X) 按 `input_file` 提交。目录明确禁止图片时本地拒绝。Claude 仅在能力确认时发送图片或 PDF。六家兼容接口支持文本及已确认可读的图片，后七种非 Responses API 当前均不提供网页搜索工具。这些 API 的「自动」省略显式推理设置，明确档位取自目录或对应型号的适配规则。Responses 仅在模型目录或已知型号能力确认支持时附加搜索工具。请求需要搜索而工具不可用时，系统指令告知模型这一限制。Claude 和兼容流仅把思考事件转换为状态提示。Responses 则可显示模型支持的公开推理摘要。仅 DeepSeek、Kimi 支持官方余额。本机请求数、输入/输出 token 按账号、服务及密钥配置隔离。服务商端点、版本头及错误码是本次查看到的适配器行为。[目录与地域](../electron/backend/api/catalogs.ts) · [国内适配](../electron/backend/api/chineseProviders.ts) · [发包与流解析](../electron/backend/api/messages.ts) · [协议回归](../test/unit/api-chat.test.ts)

### 聊天、附件与流式回答

| 场景 | 当前实现 |
| --- | --- |
| 准备聊天并发与停止 | 每条对话独立持有请求及取消控制器。切到「新对话」或另一条记录，可在原回复继续生成时发送新问题。增量、结束和重试按所属对话处理。「停止」和「发送」使用独立的按钮节点，分别为普通按钮和表单提交按钮。点击停止时先阻止默认提交，再取消当前对话的请求。输入框已有的草稿留到下一次主动发送，其他对话继续生成。[准备页按钮](../src/components/PreparationPage.tsx) · [请求归属与取消](../src/stores/preparation.ts) · [聊天 IPC](../electron/ipc/chat.ts) |
| 旧会话与草稿重载 | 沿用原 IndexedDB 数据库及附件存储。首次写入时将 v1 整份聊天转换为 v2 目录和逐会话记录，此后按变更写入。选中会话才核对附件引用。发送前先验整段上下文（最多 20 个文件，单件 20 MiB，合计 32 MiB），再按主键读需要的原件。坏附件保留 ID 供恢复，其他会话仍可发送。编辑以 350 ms 合并。离页时通过已打开的数据库连接创建事务，保存最新会话、草稿及必要 Blob，重开先读检查点。有检查点的旧资料迁移只带仍被引用的附件。确认资料提案先登记回执，再按持久化的资料和会话核销。[会话存储](../src/services/chats.ts) · [发送预算](../src/services/chat.ts) · [确认回执](../src/services/profileConfirmations.ts) |
| 大文件处理及取消 | Responses、Claude 和兼容接口按整次请求估算，二进制按原始字节、TXT/MD 按原始字节的七倍。达到 4 MiB 用占位符和分块组装。二进制每 192 KiB 转 Base64，文本每 32 KiB 增量 UTF-8 解码和 JSON 转义，Kimi 历史文本保留内层转义。块间让出事件循环并检查取消。Copilot 按 Base64 长度或文本六倍估算，仅对达到 4 MiB 的 `session.send` 以分块编码填充一份 JSON-RPC 消息缓冲区，再由 SDK 写入原有管道，保留消息顺序和背压。[HTTP 附件](../electron/backend/chat/input.ts) · [Copilot 附件](../electron/backend/copilot/attachments.ts) |
| 正文、提案和本机用量 | SSE 增量解码跨块 UTF-8，接受 CR、LF、CRLF 换行，合并同一事件的多行 `data:`。即使响应头不标准，也能识别以 `id:`、`retry:` 或注释开头的事件流。解析正文时只消费 `data:`，收到 `[DONE]` 结束读取。Responses 按输出项、段落与终态补齐正文、恢复次序，遇到矛盾或没有有效结果时报错。结构化回答增量解码，资料提案预览每请求约 60 ms 合并，最终完整校验。公开推理摘要缓存到十万字符（含换行）。用量账本保留最近 1,000 个去重键，超过 200 字符的键用有类型标记的 SHA-256 表示，重置保留已见键。Messages/兼容流须有合规响应 ID、有效用量及终止事件才记账。可计入已报告用量的截断。[正文校验](../electron/backend/chat/responseText.ts) · [SSE](../electron/backend/chat/sse.ts) · [提案预览](../electron/backend/chat/profilePreviews.ts) · [用量](../electron/backend/chat/usage.ts) |
| 长对话显示与联网权限 | 准备页消息、面试回答、转写按行复用。桌面及手机直接显示流式 Markdown，首段、替换和终态立即显示。连续追加时，以最近一次 Markdown 渲染至布局提交耗时的三倍合并追加更新，调度间隔上限为 250 ms。同一调度适用于段落、列表、引用、链接、表格和代码块。复制、草稿、持久化仍读完整文本。Copilot 按每次请求和 SDK 报告的重定向来源检查目标与其所有 DNS 结果，限两个未结束解析。拒绝特殊地址、本机直连网段及取消/失败请求。最终连接由 SDK 管理。[显示调度](../src/lib/useStreamingMarkdown.ts) · [网页权限](../electron/backend/copilot/webPermission.ts) |

### 知识库检索与索引升级

- **检索条件和基线。** 1.2.3 已有 E5、LanceDB、RAG 和父子问答，索引为 `qa-linked-v2`，生成时使用 `local-v7-current-source-first`，最多取五个证据根。现用 `qa-linked-v3` 和 `bplus-selected-history-v1`。解析器在代码围栏外识别不超过 300 个 UTF-16 码元、以加粗「主问」或「追问」标签开头的口语稿行。准备聊天仍须当前请求明确要求用已选知识库。用当前 AI 服务判定意图，最多发送最近七条对话的文字。最新用户消息中的原文引句和独立检索词通过校验后才读取本地资料。面试从 1.2.3 的最多六条前文收窄为最近三条已提交问题或面试官终稿，每条至多 200 个 UTF-16 码元。可随前文一起检索的当前问题从 700 放宽至 6,000 个码元。前文合并相邻重复项，遇间断、暂停停止回溯，跳过面试者发言、AI 建议和默认截图题。[意图](../electron/application/knowledgeIntent.ts) · [面试上下文](../electron/application/interviewContext.ts) · [解析](../electron/backend/knowledge/chunks.ts)
- **评分。** 使用固定的 multilingual-e5-small Q8 CPU、384 维，清理口语填词、修复部分断开的英文词。向量输入超过 512 token 时保留问题首尾，BM25 仍使用清理后的问句。按主问分组，取组内分块最高正文余弦，再加 0.05 倍本库归一化的最高 BM25。独立问题要求第一组的当前问正文余弦 ≥0.8811。含追问线索或去空白及标点后不超过 10 个字符的问题可以跳过门槛，缺资料时仍可能误引。对这类问题，最近前文有 0.06 加分，明确回指取消加分。只选语义最接近的一条，当前分与前文分等权相加。该路径取代 1.2.3 的项目别名、最多 64 个重复标题后缀和最多 20,000 行背景向量均值。知识库后端的普通查询仍支持关键词、向量与混合搜索。知识库页面提供库和文档管理。[评分](../electron/backend/knowledge/grounding.ts) · [准入](../electron/backend/knowledge/service.ts)
- **取证与失败处理。** 最多六个主问，每组优先保留实际匹配项，再按父问关联补足至多五个追问，均须同根、同文档、同库、同修订。知识进程在同次回取时核对节选是否来自命中原文，并计算组合正文的摘要。本地检索和逐项回取共用 15 秒时限，意图判定与回答生成另计。应用层按条目 ID 和内容摘要去重，在 48,000 UTF-8 字节及原请求剩余字符数之内，优先装入主问及所选追问的组合正文，放不下时尝试已核实的命中节选。所选证据作为不可信 JSON 附在当前用户消息末尾。单条证据仍放不下时略过该条。连最小上下文与检索提示也放不下时才发送原对话并提示。只有可用性失败可降级，身份或完整性错误及主动取消终止。面试同题重试仅复用同版本、同输入的完整非空证据，普通准备聊天省去附件哈希。未选库时直接生成。已选库但没有相关命中时也可继续通用回答。[检索期限与预算](../electron/application/rag.ts) · [证据核验](../electron/backend/knowledge/evidence.ts) · [上下文](../electron/application/ragContext.ts)
- **并发与缓存。** 索引串行写入。普通索引写入与读取重叠时，可用独立只读进程读取已提交的快照。撤销或删除期间由主知识进程协调。整库删除与旧索引清理须等待读者释放。其他索引任务进行中，若选库缺少已提交快照则开场提示等待，面试期间拒绝新增导入/重建。启动时按目录打开固定表版本。生成检索遇到新快照，先逐份核对所选库的可用修订，再由已存分块向量和正文构建健康来源的词频及评分快照。随后的查询按命中取证。正文按磁盘字节计入最多 16 MiB 的常驻缓存。超限正文验证后仅在当次查询复用候选条目元数据。分块缓存估计超过 64 MiB 后保留词频统计、逐批读表评分。进程保留最多八个近期问句向量，当前问始终重编码。[读写协调](../electron/backend/knowledge/host.ts) · [数据库](../electron/backend/knowledge/service.ts)
- **升级与逐项进度。** 本地或云账号打开后，从活动目录、备份和升级记录判定无标记、v1、v2 旧索引归属。先持久化清理记录，再切目录和回收。中断可续办，混合库保留有效 v3 和恢复版本。归属或格式有误时报告并保留恢复资料。清理事件传播去重后的受影响 ID，可向新订阅窗口重放。完成或失败撤下。重读目录、检索组件就绪后从 IndexedDB 原件重建，仅当前可用索引显示完成。[清理与恢复](../electron/backend/knowledge/indexUpgrade.ts) · [按文件调度](../src/stores/knowledgeIndex.ts)
- **批量发布与删除。** 同次选择的待索引文件按库分组，每批 2–20 份，逐份暂存后共建一次全文索引并原子发布。页面一次最多接受 20 份，单份单独处理。单件 ≤20 MiB，IPC 在途 ≤40 MiB。某个成员失败时记录该文件错误，成功回滚后逐件重试其余仍有效的成员。整批被明确取消时结束该批。删除或替换使旧任务失效，替换/云恢复的门控持续到原件事务结束。重启按活动及备份目录回收确定无引用的暂存。单一正文损坏可隔离并通过重导修复。整库删除先记意图并阻止回写，再保留其他库的历史、全文索引与恢复点，分阶段清除目标库正文、原件、备份。归属不清暂停。统一文件名校验支持最长 255 个 UTF-16 码元。[批次](../electron/backend/knowledge/indexBatch.ts) · [整库删除](../electron/backend/knowledge/eraseLibrary.ts) · [原件门控](../src/services/knowledgeIndex.ts)

### 面试设备、实时识别与自动提问

自动提问沿用 1.2.3 的整段文字匹配。无截图时，若识别终稿只包含支持的语气词或简短回应（如「嗯」「啊」「好的」），草稿保留，用户可以手动发送。语气词后接实质问题时继续自动提问。声音未形成终稿时不会因此发题；若语音模型将语气词识别成其他词，开启自动回答会把误转文字作为普通问题提交，可能消耗额度。可关闭自动回答，核对转写后手动发送。[过滤与发送](../src/stores/interview.ts) · [文字匹配](../src/services/speech.ts) · [完整用例](../test/unit/automatic-question.test.ts)

- **启动检查。** 1.2.3 已有开场设备与权限检查。本次将弹窗内的手动音源测试改为实时电平预览。检查结束后，为获准音源开设带请求 ID 的采集会话，每路累积至少 80 ms 采样后上报一次 RMS 电平，跳过识别器加载。页面隐藏或关闭弹窗时释放预览，页面恢复可见时按同样条件重新预览，正式开场前等待预览停止。[设备列表](../src/components/InterviewAccessList.tsx) · [预览](../src/components/InterviewAudioPreview.tsx) · [会话协调](../electron/application/speech.ts)
- **音源和模型交接。** 「远程面试」可分别静音麦克风和系统音频，「现场面试」使用麦克风提问。1.2.3 已能在旧识别器工作的同时异步加载候选，等待所有启用音源停顿，再用每路最多 300 ms 的近期音频预热交接。现在可在候选就绪后点击「立即切换」，两个切换方向都可在加载或等待阶段点击「取消切换」。两路输入都关闭时，候选就绪即接管。强切清空预热历史并标记间断，旧包的迟到确认和错误不能推进新识别器的静音时钟。退休的 Qwen 通过关闭原生进程的输入管道中断卡住的请求。热切换的候选加载失败时保留原识别器。首次加载 Qwen、尚未开始采集时，也可保持原设备改用已安装的 Paraformer。[切换路由](../electron/backend/speech/recognition.ts) · [采集控制器](../electron/backend/speech/controller.ts) · [识别子进程收尾](../electron/backend/speech/recognizer-worker.ts) · [浮窗状态](../src/stores/interview.ts)
- **进程调度与积压。** 共享启动器尝试降低 Qwen 子进程优先级，并设置 Rayon 线程数为可用并行度的一半向下取整、限制 1–4。Mac Rust 程序随后按性能核数重设该值，最多 6，探测失败取 4。Windows 支持显式选择 CPU / 可用 CUDA，Mac arm64 支持 Rust CPU / MLX Metal，Metal 的异步对齐在 CPU。已请求从 Qwen 降至轻量且未确认音频合计达到 4 秒时，候选就绪即可接管。1.2.3 已有 Qwen 或其切换残余队列 30 秒、普通 Paraformer 2 秒的上限。本次在超出队列上限而实际丢包时登记转写可能不完整。当前模型为 Qwen 时停止采集，跳过积压推理、释放识别器，用户可在同场手动重连。轻量模型继续使用原有的有界恢复流程。录音队列独立排空。面试只发布提问音源的已处理进度，进入积压与最后确认立即通知，中间按 100 ms 音频进度合并，独立采集继续上报已启用音源的进度。Qwen 另按每路至少 80 ms 的间隔更新电平。[采集与进度](../electron/backend/speech/controller.ts) · [共享启动器](../electron/backend/speech/qwen.ts) · [Mac 原生线程设置](../native/qwen-speech/src/main.rs)
- **断句与发送。** 1.2.3 的应用阈值为 1,000 / 1,800 ms，当前从同一停声点起 500 ms 断句、累计 1,000 ms 才允许发送。「远程面试」看系统音频，「现场面试」看麦克风，开启自动回答的面试须同时拿到静音终稿、该路处理进度达到截止点且该路无待确认包。正在生成上一条回答时，满足条件的问题可等该回答结束再发。重新开口重计，迟到终稿沿用原截止点，暂停或间断片段不自动提交。桌面和手机手动编辑后按实际提交文本检查 6,000 个 UTF-16 代码单元上限，消费对应转写并保留原问题定位。自动发送及未修改草稿检查完整原文。[共享阈值](../electron/contracts/speechSettings.ts) · [问题缓冲](../src/services/speech.ts) · [自动提问用例](../test/unit/automatic-question.test.ts)
- **旧 Qwen 兼容。** Paraformer 沿用 Silero。新版 Qwen 原生源码在 `ready` 消息声明 500 ms，Worker 使用原生断句。若运行时声明 700 / 800 ms，或省略该字段（按 800 ms 处理），Worker 校验 `silero_vad.onnx` 的大小与 SHA-256，并为每路建立独立检测器。在 16 kHz、512 样本的完整帧上确认静音满 500 ms 后，结束并重开该路活动流，同包剩余采样沿用原时间轴。若原生先报告停顿，则按其声明或兼容默认值回推停声点。静音终稿等对应音频请求确认后才交给自动提问。四句裁剪、时长上限和手动收尾各自保留原原因。未知阈值、缺失或损坏的兼容资源会使相应模型加载失败。[协议](../electron/backend/speech/qwen.ts) · [兼容检测](../electron/backend/speech/qwenLegacyEndpoint.ts) · [原生 VAD](../native/qwen-speech/src/vad.rs)
- **组件与分发。** Windows 的开发启动仅从本地准备 Silero 资源，安装依赖及开发构建可选下载，离线可通过 `VOXCUE_SILERO_CACHE` 提供模型与 MIT 许可。开发准备阶段缺少资源仍可启动其他功能，选择依赖该资源的旧 Qwen 时会提示恢复。Portable、Installer、Store 共用严格暂存，按大小与 SHA-256 核对两份资源。`Start-VoxCue.cmd` 修复缺失的 CPU 助手时，若本机缺少固定 Rust 工具链，会另行下载。[Silero 清单](../scripts/silero-assets.mjs) · [Windows 暂存](../../windows/scripts/package-portable.mjs) · [启动修复](../../windows/scripts/build-audio.mjs)
- **Qwen 构建与交付。** 共享 Rust 宿主与内置 ASR 统一 Candle core/nn 0.11.1（旧 0.9.2），Cargo 锁定 zip 9.8.1（旧 7.4.0）。Windows 三种打包入口都使用受管组件目录，按需获取已发布的 Qwen Runtime 1.0.1，并按固定摘要验包。若另行构建新版 Qwen Runtime，构建机须预配 MSVC、Windows SDK、Rust MSVC 1.94 或更高版本、离线 Cargo 依赖和包含 VAD 导入库 `speech.lib` 的目录，CUDA 版另需 CUDA 12.9。`build-qwen.ps1` 的 `ToolchainRoot`、`BuildRoot`、`VadLibrary` 均接收目录。默认构建 CUDA，`-Cpu` 构建 CPU，分别加 `-Tests` 运行原生单测。用生成程序回放公开音频核对中间稿、终稿与时间戳。新版运行时另行生成带逐文件大小与 SHA-256 的 ZIP 清单，独立发布该资产，并在应用组件清单中固定新版本和校验值后，用户才能按需获取。ASR 所选 CUDA 后端失败会报错。CUDA 对齐器加载失败可退到 CPU。[运行时组件清单](../electron/backend/components/qwen-windows-runtime-catalog.ts) · [Qwen 构建](../native/qwen-speech/README.md) · [运行时打包](../../windows/scripts/package-qwen-runtime.py)

### 采集、回声、录音和历史回放

- **音频分流。** WASAPI 的 QPC、Core Audio process tap / 输入设备和主机时钟，以及双路 48 kHz / 10 ms 的 WebRTC AEC3 都是原有基础。本次把面试预处理放到共享采集控制器，系统原声供转写和录音，另取参考给麦克风消回声，关闭系统转写或录音仍可保留参考。现场模式缺少可选播放参考，或其启动失败且已确认释放时，提示回声消除不可用并继续麦克风面试。独立听写走原始采集。面试解除软静音时，Windows 按同域 QPC 时间戳裁掉开声前积压的样本，避免旧声音进入录音或转写。静音期间正在录制的片段保持时间连续。[控制器](../electron/backend/speech/controller.ts) · [Windows 时钟](../../windows/electron/speech/controller.ts)
- **Windows 双讲。** 麦克风录音在参考可信时采用消回声后的残差，转写单独选择等长静音或对齐原声。已对齐且近期有播放参考时，残差与原声能量比低于 5% 进入纯回声状态，以 12% 维持。已检测到回声、播放声间歇至少 80 ms 且满足近端能量和相关性条件时，保护后续约 200 ms 的原声音节。缺乏可信参考时保留原声。强外放盖住轻声时仍可能漏词。[Windows AEC](../../windows/electron/speech/echoCancellation.ts) · [采样级回归](../../windows/test/unit/recording-echo.test.ts)
- **录音和续录。** 自动录音默认关闭，开始前提示本场设置。语音运行时可手动起停，暂停语音会封存当前片段。恢复或重连后，若本场仍开启录音，则另建片段。手动停录或写盘故障会撤下续录请求。系统录音只对原声副本平滑调整电平。麦克风录音用 70 Hz 高通和 50 / 60 / 100 / 120 Hz 窄带滤波，在滤波后的信号上按包络对底噪做柔和衰减，该级增益最低为 0.65，句尾可沿用上一音节增益约 160 ms。两路各按 20 ms 窗口、约 −15 dBFS RMS 目标及半幅峰值上限处理，需要转采样时使用带限流式转换，随后按时钟与样本数对齐，混为本机每账户、每场次的 16 kHz、16 位单声道 PCM WAV。仅有录音的面试仍可归档，录音不进云备份，可随所选记录同机迁移。[电平](../electron/backend/speech/recordingChannel.ts) · [人声滤波](../electron/backend/speech/recordingVoiceFilter.ts) · [WAV 写盘](../electron/backend/speech/recording.ts)
- **慢盘和中断。** 录音仅收取开录至停录时间窗内的样本。手动停录时若启用了麦克风消回声，最多等待 150 ms 接收对齐后的尾音。写入队列限制为 8 MiB 或 2,048 项，先到的限制生效。迟到包只读取并改写已落盘的重叠区。写入中使用 `.wav.pending`，WAV 头标记最后完整检查点。正常停止后封存。写错但可恢复上一完整检查点时也可封存该前缀并上报错误。中断的 `.pending` 文件若有可验证的非空检查点，可按该前缀播放、导出和迁移。签发播放 URL 后即使文件增长或被封存改名，该 URL 的可读范围仍止于原检查点。已封存文件须校验头长与实际长度。遇到已知写入错误或写盘背压而停收时，先通知仍在排空。正常停录在排空后才发出停录状态。识别器可与写盘并行收尾。正常结束面试时等待已接收录音排空。若窗口意外关闭或应用退出时仍由语音子进程持有录音，宿主另发停录请求，最多给 1.5 秒收尾再终止进程。录音错误 `recordingError` 与转写尾段 `transcriptTailIncomplete` 独立，任一发生时均以 `interrupted` 保存现有文字，重连累计本场风险而下一场重置。退出分别等待录音与更新清理。[WAV 读取](../electron/backend/interview/recordings.ts) · [归档](../src/stores/interview.ts) · [语音宿主](../electron/backend/speech/host.ts)
- **Windows 设备断开。** 从 WASAPI 复制一包便归还设备缓冲，独立写线程承担转换及管道输出，队列 128 包、含在写数据至多 32 MiB。设备失效通知来自 stderr，stdout 仍可交付稍后到齐的完整 PCM，等两条管道均关闭后才换代。已确认发生可恢复的设备故障时，忽略最后一个不完整包，在本场报告音源间断。正常手动停止遇到不完整尾包会报错。损坏的 PCM 或原生写队列过载均终止采集，即使随后才收到该诊断也会阻止自动重启。[采集助手](../../windows/native/WasapiCapture.cs) · [恢复](../../windows/electron/speech/capture.ts) · [合成进程用例](../../windows/test/unit/wasapi-recovery.test.ts)
- **回放、定位和导出。** 主进程在当前账户的 Electron session 注册本地媒体协议，只向主窗口签发随机 URL，重读列表撤销旧授权。GET / HEAD 和单区间字节请求支持探测、拖动。以片段起点加播放进度关联字幕，onended 续播下一可读段，跳过未录间隔，暂停拖到末尾保持暂停。拖动期间用原生进度值实时选择字幕，松手时再提交音频跳转。单击轨道时也读取原生进度值，使字幕立即开始向所选位置滚动。连续输入只更新同一个动画帧循环的目标，临界阻尼从当前视口位置和速度计算后续位移。按住静止时循环继续减速至目标，在同一句上松手不会再启动一轮滚动。字幕索引按开始时间排序、前缀维护最晚结束时间，支持重叠高亮和静音处定位到本段最近字幕。总共一段且可读才跳过选段。一好一坏先显示全部原编号，坏段标「无法读取」并禁选。最终仅选一段另存 WAV，选多段新建「VoxCue - 面试标题」，同名目录编号、片段保留原序号，批量失败尝试撤回本次副本。删除先暂存录音目录，文字提交失败恢复，成功后清理，下次打开按文字是否仍在继续恢复或清理。[媒体授权和导出](../electron/ipc/recordings.ts) · [播放器](../src/components/RecordingPlayer.tsx) · [字幕滚动](../src/components/transcriptScrubScroll.ts) · [字幕索引](../src/services/transcriptTimeline.ts) · [删除恢复](../src/services/historyRecordingRemoval.ts)

### 手机连接、增量同步与 Windows HTTPS

1. 1.2.3 的协议 v2 已有局域网配对、断线恢复、手机控制、单帧在途和回执超时。本次在配对或恢复时协商增量能力。桌面以该连接**已确认**的快照为基准，可发送文字追加、行替换、旧行移出及控件变化。包含协议字段的差量消息小于完整快照正文的 UTF-8 字节数时才采用差量。首次、旧客户端、重连、换场、主动同步均发送整帧。手机校验基准序号、场次、修订及还原后的整份快照（最多 1 MiB），失配即请求整帧。15 秒未收到匹配的序号和投递 ID 时中止连接，原授权仍有两分钟恢复期。[协议与预算](../electron/contracts/remoteConnection.ts) · [差量生成及还原](../electron/contracts/remoteSnapshotDelta.ts) · [服务端](../electron/backend/remoteConnection/service.ts) · [手机端](../src/mobile/connection.ts)
2. 换手机授权时先清除上一授权的快照，再从电脑重新发布本场草稿。显式断开会清除手机草稿、输入法暂存和待同步状态。同一授权短时重连时以电脑当前草稿为准，手机以请求 ID 查询未确认操作的回执。手机发题时核对场次、草稿版本和实际提交长度，电脑在原列表末端同步新增回答行后即可回执，无需等 AI 生成完成。手机尚未回执时，浮窗保留最新状态引用，等前一帧获确认才生成下一份快照。换场或面试状态变化先通知主进程，使旧场操作及时失效。主进程复用 IPC 校验时的序列化结果。[桌面快照与回执](../src/services/remoteInterview.ts) · [手机联动回归](../test/unit/remote-interview.test.ts)
3. Windows 可为私网 IPv4 预配 TLS 身份。用户导入带密码的 PFX。脚本在内存中将所选私钥和证书链重新导出为空口令 PKCS#12，再用当前 Windows 用户的 DPAPI 加密，与公开证书链一起原子替换。启动时核对文件身份、实际监听 IP 的 SAN、证书链签名和有效期，解密后比对叶证书及整条链的指纹，再监听 HTTPS/WSS（最低 TLS 1.2）。手机须信任签发机构。首次无配置时仍可用私人热点 HTTP/WS，其凭证、转写与回答在网络上传输时为明文。即使是旧配置，识别到目录且具备解密适配后就登记 `remote-connection-tls.required`，可早于证书校验成功。标记仍在而目录消失时拒绝监听。证书和标记同时丢失、或整体回滚到启用前时无法识别配置历史。[预配程序](../../windows/scripts/configure-remote-tls.ps1) · [受控监听](../electron/backend/remoteConnection/tls.ts) · [Windows 解密适配](../../windows/electron/remoteTlsKey.ts) · [信任与恢复说明](REMOTE_CONNECTION.md)

## Windows 原生窗口、组件与更新

Windows x64 安装版继续从 `NCFXZ/VoxCue` 查找本平台资产完整的最高稳定版本。以 1.3.0 为例，候选需包含 `VoxCue-Setup-1.3.0-x64.exe`、同名 `.exe.blockmap` 和 `latest.yml`。选出候选后，客户端用沿自 1.2.3 的 Ed25519 公钥验证清单中该安装包条目的签名，签名绑定平台、版本、文件名、字节数、SHA-512 和最低系统版本。仅有 Windows 资产的发行不会触发 Mac 升级。Microsoft Store 的目标包为 `VoxCue-Store-1.3.0-x64.appx`，随商店更新。打包、首次外部可下载、商店提交及通过认证分别以发行记录为准。[选版](../electron/backend/updates/releases.ts) · [签名字段](../electron/backend/updates/windowsManifest.ts) · [Windows 更新入口](../../windows/electron/updates.ts) · [Store 包](../../windows/scripts/package-store.mjs)

| 操作 | 从 1.2.3 到当前工作区的变化 | 实现入口 |
| --- | --- | --- |
| 首次显示、隐藏后唤回 | 既有 `WindowVisibility` 从当前透明度过渡，支持反向和减少动态效果。新增 Windows DWM 助手在首次显示面试窗或说明窗前核对 HWND 与所属 PID，关闭系统额外的窗口过渡。助手失败仍可打开面试。普通显示走 `showInactive`，用户主动唤回可请求焦点。 | [装配](../electron/main.ts) · [DWM 助手](../../windows/native/WindowMotion.cs) · [可见性回归](../test/unit/window-visibility.test.ts) |
| 截图 | Windows 原生助手从面试窗口句柄取得边界与 DPI，以顶部工具栏锚点调用 Win32 选择显示器。Mac 检查屏幕录制权限后，由 Electron 按工具栏锚点定位显示器并匹配 `display_id`。本次共享编码入口先检查长宽和像素上限，再核对位图确有每像素 4 字节。完整、可转移的独立缓冲区直接交给 Worker，其余复制后交接。Windows 捕获失败时显示对应的系统捕获提示。 | [Windows 原生选屏](../../windows/native/Screenshot.cs) · [共享捕获](../electron/screenshot.ts) · [Worker 交接](../electron/backend/screenshot/host.ts) |
| 组件安装和删除 | 下载或校验可在遍历及分块读盘时取消。安装用 v3 暂存标记记录租约与目标，先核验新版目录再交换，保留可辨认的旧版目录供重启恢复。模型使用中拒绝删除时恢复原就绪状态。 | [组件事务](../electron/backend/components/service.ts) · [生命周期回归](../test/unit/components.test.ts) |
| 开发启动和打包 | `Start-VoxCue.cmd` 先检查 Electron 及共享构建物。音频或 CPU 助手缺失或为空才走对应修复。截图、窗口动画和原生密钥输入助手由同一脚本检查缺失、空文件及源码新旧，再用 .NET 编译器补建。Silero 启动时仅从本地准备资源，可将已校验的缓存模型和许可复制到原生目录。开发启动不联网补 Silero，缓存不全仍可启动其他功能。依赖安装或完整开发构建可尝试下载，正式打包必须备齐并校验 ONNX 模型及许可证。 | [启动入口](../../windows/Start-VoxCue.cmd) · [窗口助手构建](../../windows/scripts/build-window-helpers.mjs) · [Silero 准备](../../windows/scripts/prepare-silero.mjs) · [平台打包](../../windows/scripts/package-portable.mjs) |
| 更新恢复与安装 | 中断恢复去重并允许失败重试，遇临时文件占用可重读。清理日志先持久化。已完成安装包的摘要和签名只可在同轮检查、同一文件身份下复用一次。安装前独立重验，确认 NSIS 准备执行的绝对路径与验过的文件一致再允许安装。Mac 的归档和 Sparkle 驱动有自己的恢复流程。 | [Windows 更新驱动](../electron/backend/updates/driver.ts) · [缓存](../electron/backend/updates/cache.ts) · [Mac 驱动](../../macos/electron/updates/driver.ts) |

**知识库子进程的物理解包修复。** 早期 1.3.0 候选的 Store 升级反馈中，知识库子进程因找不到 `../atomicFile` 而启动失败。`KnowledgeHost` 从 `app.asar.unpacked` 启动 `backend/knowledge/process.js`。索引服务的批量写入、索引升级、删库模块均引用上一级的 `backend/atomicFile.js`，候选包仅在 ASAR 内收录该文件。Windows 的 Portable、NSIS 与 Store 共用的打包规则现显式物理解包 `backend/atomicFile.js` 和 `backend/cancellable.js`。NSIS、APPX 静态验包从编译入口递归核对实际相对模块的物理文件。Windows 标准安装器与 Store 包均已从各自的正式 1.2.3 原包升级。首次打开会重建旧索引；正常退出再启动后，检索仍返回原件中的正文，并复用升级生成的修订。[子进程入口](../electron/backend/knowledge/host.ts) · [Windows 打包规则](../../windows/scripts/package-portable.mjs) · [依赖闭包校验](../../windows/test/scripts/knowledge-process-closure.mjs)

**深账户目录下的知识库写入。** Windows 用户资料目录较深时，LanceDB 在发布索引时可能无法重命名临时文件，导致原件已导入而文档显示「索引失败」。Windows 适配器检查解析后的 `lance` 目录路径。超过 100 个字符时，为启动的主索引进程或独立读进程各建一个临时 NTFS 目录联接，LanceDB 经短路径读写原索引。子进程退出时释放联接。若宿主异常退出，下次打开同一索引时，仅在归属标记和目录身份吻合、宿主与记录的子进程都已退出时回收残留。账户归属、原件和索引的物理位置、检索模型及参数均沿用现有配置。此次修复后的整包导入与升级重建待复验。[Windows 路径适配](../../windows/electron/knowledgePath.ts) · [子进程生命周期](../electron/backend/knowledge/host.ts)

**Store 正式旧包升级。** 升级专项先验证正式 1.2.3 x64 APPX 的固定整包 SHA-256，再从该原件的 `app/resources/licenses/` 分别计算 `LICENSE` 与 `THIRD_PARTY_NOTICES.md` 的摘要，核对旧版安装目录的两份文件。旧包使用自身附带的声明，避免新版新增的第三方许可导致旧版阶段误报。新版安装与重启阶段均对照当前发行源码。默认基线升至 1.2.3，原 1.2.2 对照仍可通过 `--appx-upgrade-1.2.2` 运行。运行 `node test/scripts/store-sandbox-smoke.mjs --appx-upgrade` 时，在旧版写入合成资料和可检索索引，升级后核对原件、重建后的证据与修订。正常退出后以同一账户再启动，核对同一文档的命中正文和已提交修订。[固定旧包、逐版本许可与三次启动](../../windows/test/scripts/store-sandbox-smoke.mjs) · [包内检索与证据断言](../../windows/test/scripts/store-renderer-client.mjs)

## macOS 开发顺序与验收

### 先恢复可构建的 Apple Silicon 工作区

1. 在 Mac 的仓库根运行 `pnpm sync:workspace` 并检查当前平台生成差异。本次 Windows 只读检查报出六个 Mac 文件，包括 `package.json`、`tsconfig.json`、`tsconfig.electron.json`、`tsconfig.contracts.json`、`vite.config.mjs` 和 `pnpm-workspace.yaml`。依赖按 Mac 锁在 `macos/` 安装，在该目录运行 `pnpm check:workspace` 和 `pnpm check:architecture`。补齐下述平台图标后运行 `pnpm typecheck` 和共享构建。[配置生成器](../scripts/sync-platform-manifests.mjs) · [Mac 命令](../../macos/package.json)
2. 共享 Vite 在 Mac 上将桌面图标导入替换为 `macos/src/icons.tsx`。当前缺少 12 个导出。静态导入的 `ArrowRightLeft`、`LinkOff`、`CloudOffline`、`Pause`、`Locate`、`VisibleWindow`、`PrivateWindow`、`Minimize`、`BackTen`、`ForwardTen` 会阻塞 Vite 打包。密码控件动态查找 `Eye` 和 `EyeOff`，找不到时退回文字。在 Mac 端补齐符号映射和导出，然后运行 `pnpm build:symbols`、`pnpm build:shared`。`LinkOff` 使用 Mac 端的斜杠链环图标，在 ChatGPT、Copilot 和远程设备三处分别核对连接与断开，远程设备还要核对红色的二次确认状态。其余图标按下列页面验收。[Vite 平台解析](../vite.config.mjs) · [共享导出](../src/components/icons.tsx) · [Mac 导出](../../macos/src/icons.tsx) · [符号清单](../../macos/src/symbols.json)

**图标验收以使用位置为准。** Mac 的界面图标使用 macOS 端资源。唯一例外是实际面试界面顶部胶囊内的「开始录音／停止录音」按钮，保留整个共享按钮及 `RecordingWave` 的主题色、待机形状、按音源电平滚动、停止回落、快速再开和减少动态效果行为。同一胶囊里的设置、截图保护、结束等其他控件仍使用 Mac 图标。[实际面试胶囊](../src/components/FloatingInterview.tsx) · [波形与动画](../src/components/RecordingWave.tsx)

- **历史播放器**的「选择录音」目前直接导入静态 `RecordingWaveIcon`，会绕过 Vite 的平台图标替换。Mac 应经平台图标接口绘制选段符号。播放、暂停、定位、前后十秒、展开与收起也逐项核对 Mac 资源。[历史播放器](../src/components/RecordingPlayer.tsx)
- **登录页和设置的面试预览**目前都由 `InterviewPreview` 直接绘制静态 `RecordingWave`。按“实际面试界面”限定，预览中的静态图标列入 Mac 图标适配。分别打开这两个预览、历史详情和真实面试，对照图标来源。真实录音按钮还要测试开、停、动画中再次开启及减少动态效果。[面试预览](../src/components/InterviewPreview.tsx) · [登录入口](../src/components/LoginPage.tsx) · [设置入口](../src/components/InterviewFontSettings.tsx)

### 账户、凭据与持久化

- **Mac 签名应用。** 在已解锁的隔离会话以合成账号、专用测试钥匙串验证旧版资料认领、来源账号切换、离线验证旧格式及多年停服、旧服务满八设备时的兼容行为、删除回执重启及只擦除原账号。凭据维护现已遍历各账号的离线迁移验证和删除回执。仍需把所有账号 `auth-data/api-keys` 纳入保留旧钥匙串项的可读性校验。验证 API 密钥之外，还应检查按账号迁入的浏览器资料、打包后从本地资源加载解析 Worker、签名包恢复大面试记录、目录和截图依赖、跨盘 ZIP 暂存以及崩溃后复开。
- **直接复验。** 在平台目录运行 `pnpm test account-import legacy-profile legacy-browser migration-password profile-import local-import cloud-data cloud-sync account-export account-archive account-erasure history-repository`。在隔离桌面串行运行 `node ../shared/test/scripts/legacy-profile-upgrade-smoke.mjs` 和 `node ../shared/test/scripts/account-transfer-smoke.mjs`。后者要求服务代码为干净的 0.5.3 提交 `3bceb61`。相邻服务仓已升级时，可用 `VOXCUE_TEST_SERVER_ROOT` 指向对应旧检出。回执与无会话验密另用 0.6.1 隔离服务运行 `node ../shared/test/scripts/account-erasure-receipt-smoke.mjs`，脚本加载已编译的桌面主进程业务类，以 Node 和临时 SQLite 复验。另作长列表人工验收时，可为来源准备 60 条面试、48 个库及 10 项跨组冲突。覆盖取消、半选、逐类覆盖、保存及不同分区重开。

### AI 服务、聊天与检索

1. 在 Mac 平台装配 `promptApiKey/controlApiKey`，按窗口和请求归属处理布局、焦点、Tab/Shift+Tab、显隐、提交和取消，关窗、重载、换号后释放控件。先用专用钥匙串验收原生输入、系统加密和签名包读取。在旧钥匙串清理前，把各 profile 的 `auth-data/api-keys` 纳入当前密钥可读性检查。未知或不可读时保留旧条目。补眼睛及其他共用页面新增的 SF Symbols。[平台契约](../electron/platform/types.ts) · [凭据维护](../electron/application/credentialMaintenance.ts) · [Windows 行为参考](../../windows/electron/apiKeyPrompt.ts)
2. Windows Codex x64 为 0.170.0，Mac arm64 为 0.164.0。订阅以实际目录的 `minimal_client_version` 过滤。仓内没有将 0.166.0 绑定至两款 6.2 型号的生产判断，须用实际目录复核原记录所述最低版本。Mac 如需升级，须同步平台包、生成清单、Mac 锁和 `codexRuntimeVersion` 包身份检查，复验签名包 app-server 登录、目录、额度和回答。Copilot SDK 沿用 1.0.21。Mac 面试选模夹具仍调用已删除的 `modelEfforts`，应使用 `advertisedEfforts` 的数组入参，并覆盖三个选模入口。[运行时检查](../electron/backend/chat/codexUsage.ts) · [Mac 包](../../macos/package.platform.json) · [Mac 夹具](../../macos/test/scripts/interview-effort-smoke.mjs)
3. 在平台目录跑 `pnpm test api-chat api-connections api-credentials model-catalog account-profile chat-storage chat-responses copilot-attachments` 和 `pnpm test rag-grounding knowledge-core knowledge-host knowledge-coordinator knowledge-index-store knowledge-reconcile`。在已解锁 Mac 隔离桌面核对缺附件/健康会话、重载、取消及换模，入口为 `pnpm test:chat:progress`、`pnpm test:provider:ui` 和修订后的 `node test/scripts/interview-effort-smoke.mjs`。用 Mac 本机 Lance、已校验 E5 及 `pnpm test:rag:core`、`pnpm test:knowledge` 验证首次检索、混合索引升级中断恢复、批量发布和逐行进度。用两场面试和两个资料库核对证据、引用及来源归属，重启后重开资料。缺组件、坏文档和取消时检查错误提示与已有索引的恢复。

### 音频、录音与原生构建

1. **采集适配。** Mac AEC 在参考有效时仅给共享层一份残差，同时供录音和识别。Mac 待接入 `ConsumeAudio` 的可选第五参，以便保留对齐原声并单独传递转写帧。当前 `frames()` 先取样再复制到定长帧，需移植 Windows 的 `lane.buffer.take(length, frameSize)` 单次取样与补零。Core Audio 写线程当前复制整个定长 `Packet`，待改为只复制有效包头、采样字节和计数后再释放队列槽。Mac 未注入 captureClockNow，目前开声裁剪用首包锚定的墙钟映射，须对照 mHostTime 验证积压时的静音边界，必要时接入同域时钟。[共享接口](../electron/backend/speech/preprocessor.ts) · [Mac AEC](../../macos/electron/speech/echoCancellation.ts) · [Mac 适配器](../../macos/electron/speech/controller.ts) · [原生写线程](../../macos/native/AudioCapture.mm)
2. **资源和权限说明。** 开发宿主、正式包、开发启动器、音频助手和中英文权限说明仍写「不保存或上传音频」，改为默认关闭、用户开启后保存在本机。旧 Qwen 的 500 ms 兼容需要固定摘要的 silero_vad.onnx 及许可，当前只在音频助手同目录和 Paraformer 模型目录查找。Mac 打包的 silero-vad.gguf 用于原生 VAD，单装旧 Qwen 须另备 ONNX。验收只有旧 Qwen、同时安装 Paraformer、新运行时报告 500 ms、离线及资源损坏。[助手权限](../../macos/native/Info.plist) · [开发宿主](../../macos/scripts/prepare-runtime.mjs) · [正式包](../../macos/scripts/package-app.mjs) · [启动器](../../macos/scripts/build-launcher.mjs) · [中英本地化](../../macos/scripts/localize-usage-descriptions.mjs) · [资源校验](../electron/backend/speech/qwenLegacyEndpoint.ts)
3. **构建和夹具。** 在 Apple Silicon 用当前共享锁文件 `pnpm build:qwen`，生成签名 arm64 程序，分别验收 Rust CPU、MLX Metal 及异步 CPU 对齐。相同公开音频、模型及对齐器对照旧版中间稿、终稿、时间戳、恢复讲话、积压和退出。核对动态库架构、签名、许可、组件清单后更新 QWEN_MACOS.md 的旧 Candle 说明。interview-real-audio-smoke.mjs 的 1,800 ms 和 localStorage 整表改为 1,000 ms 和已提交 IndexedDB，可复用 Windows 的 evaluateHistory。echo-cancellation-smoke.mjs 仍把 preprocessorFile 传入旧 Worker，须覆盖实际由采集控制器启动的 DSP、两路采样与打包资源。开发态可跑 --runtime-bundle 的局部 ASAR。最终签名包动态测试走平台现有隔离 guest 入口。[Mac 构建](../../macos/scripts/build-qwen.mjs) · [Mac 公开音频](../../macos/test/scripts/interview-real-audio-smoke.mjs) · [Mac AEC](../../macos/test/scripts/echo-cancellation-smoke.mjs) · [最终包 guest](../../macos/test/scripts/package-guest-smoke.mjs)
4. **验收。** 在本机平台目录运行 `pnpm test automatic-question speech-endpoint speech-progress speech-switch speech-input-state speech-drain speech-host interview-recording recording-voice-filter transcript-timeline`。Windows 另有 `pnpm test wasapi-recovery capture-drain speech-restart recording-echo silero-startup` 和 `pnpm test:speech:aec`。Mac 运行 `pnpm test echo-cancellation` 和修订后的真实音频、打包 AEC 入口。解锁的隔离桌面串行运行 `pnpm test:history`、`node ../shared/test/scripts/recording-smoke.mjs`。两端实机均待验单路、双路、纯外放、本人单讲、正常及轻声插话后继续播放、静音恢复、设备断开前后的首尾音与长录音。低规格设备从 Qwen 切回 Paraformer 的反馈仍待复现。

### 手机证书、窗口、截图与更新

- **手机 HTTPS。** 接入 `DesktopPlatform.decryptRemoteTlsKey` 或等效的受控平台端口，同时提供本机证书预配和原子换证路径。当前共享读取器使用 Windows 的固定文件名及封装，Mac 需明确密文格式、旧身份兼容、结构和归属校验，以及从钥匙串取得 PFX/证书链指纹的边界。Mac 适配器现未提供解密方法。以隔离身份验证首次 HTTP、受信 HTTPS/WSS、标记存在但目录缺失时拒绝监听、无效换证保留旧身份、IP 不匹配、手机断线恢复与重新配对。验证手机对签发链的信任。[共享读取器](../electron/backend/remoteConnection/tls.ts) · [接口及返回值](../electron/platform/types.ts) · [Windows 参考用例](../../windows/test/unit/remote-connection-tls.test.ts)
- **窗口与截图。** Mac 继续使用已有 Electron 透明度过渡和原生材质，保留 `captureProtectionSupported: false`。现有 Mac 盾牌按钮可切换 Electron 保护请求，仍需实测系统捕获侧结果。在解锁控制台验收首次显示及再次唤回、说明窗快捷键、减少动态效果、鼠标穿透、屏幕录制授权和拒绝后的纯语音面试。以多屏、分数缩放、物理滚轮及触控板复核两处截图查看器。相同底层滚轮事件只能按事件特征判断。触发主窗崩溃、重载、换号与 Dock／菜单退出，核对旧页面请求取消、独立面试窗口、草稿保存和退出握手。[平台能力](../../macos/electron/platform.ts) · [屏幕权限](../../macos/test/scripts/screen-permission-smoke.mjs) · [窗口专项](../../macos/test/scripts/window-native-smoke.mjs) · [签名包截图](../../macos/test/scripts/package-screenshot-smoke.mjs)
- **Mac 更新 ZIP 下载完成后损坏（待实现）。** 在 Mac 驱动中先核实文件归属和类型，再作废已损坏的普通缓存文件并重下同一版本。有效缓存继续复用，符号链接或归属不明的文件应受保护。下载后按原摘要、签名和 Sparkle 安装流程验收。[更新驱动](../../macos/electron/updates/driver.ts)

### 验证真正的 1.2.3 升级

Mac 正式包升级允许表当前只有 1.1.1 和 1.2.2。补入经独立校验的原版 1.2.3 arm64 ZIP 的大小和 SHA-256，保留已有基线。在旧应用写入合成资料，从旧包升级并完成认领，按主窗口 URL 或就绪控件选择最终界面。认领中会先出现隐藏的来源和目标窗口。[正式基线](../../macos/test/scripts/package-upgrade-baselines.mjs) · [包内升级夹具](../../macos/test/scripts/package-upgrade-data.mjs) · [隔离 guest 入口](../../macos/test/scripts/package-guest-smoke.mjs)

Mac 现有包内升级专项在新旧两端都固定以版本 1 打开文档库，还检查自建的旧索引对象。新端应在认领人的分区用当前历史服务读取文档库 v2，核对原件字节、已提交的面试记录和聊天草稿，以及 v3 索引重建后可找回的证据。同时验证另一账户不可见。聊天库的 IndexedDB **物理版本仍是 1**，会话目录记录格式已变。Mac 旧用户目录重命名专项仍写入任意 localStorage 哨兵，应改为升级允许迁移的真实业务字段。Windows 对应夹具已用合成旧历史和用量账本验证认领者的分区路径、旧文件迁入、文档库 v2 的记录和目录修订，以及旧历史键清理。该夹具使用开发构建和合成旧数据，正式旧安装包另验。[Mac 目录迁移夹具](../../macos/test/scripts/user-data-smoke.mjs) · [Windows 对应夹具](../../windows/test/scripts/user-data-smoke.mjs) · [按账户验证的共享升级夹具](../test/scripts/legacy-profile-upgrade-smoke.mjs)

## 修复与性能优化逐项核对

原进度把同一用户操作分散在多轮审查里。下表按受影响功能归类，左列保留原轮次和编号，共 103 个历史审查编号，涵盖已接入的修复、被替换的试验方案和 Mac 待办。同一功能可能占多个编号。本版另有前面各节列出的功能和交互变更。「已替换」指后续实现已经接管该路径。标有 Mac 待实现的条目需在 Mac 本机开发。独立仓指 `VoxCue-server`，其发布独立于桌面应用。

### 账号、迁移与云同步

| 原轮次及编号 | 代码核对结果 | 源码或复核入口 |
| --- | --- | --- |
| 合并审查 2 | 删除原件后中止相应上传并释放名额。若创建请求未收到回复，用原请求 ID 找回上传 ID。网络失败保留待办。 | [同步引擎](../src/services/cloudSync.ts) · [回归](../test/unit/cloud-sync.test.ts) |
| 合并审查 8 | 同步轮次内复用当前分类清单。本机与云端数据相同时，基线及父项已一致即可跳过重复写入。 | [同步轮次与持久化](../src/services/cloudSync.ts) · [回归](../test/unit/cloud-sync.test.ts) |
| 合并审查 10 | 知识库原件按 ID 读取。云端覆盖前核对当前修订及内容，遇本地编辑进入冲突处理。 | [恢复与冲突复核](../src/services/cloudData.ts) · [回归](../test/unit/cloud-data.test.ts) |
| 全库追加 2 | 分类缓存个人信息、历史和知识库摘要。改标题只使历史失效，正式迁移仍完整复核。 | [分类修订](../src/services/localImportRevision.ts) · [迁移回归](../test/scripts/account-transfer-smoke.mjs) |
| 安全性能 2 | 恢复个人资料在异步摘要完成后复核原文和账号，本地刚保存的编辑进入冲突处理。 | [恢复写入](../src/services/cloudData.ts) · [并发编辑回归](../test/unit/cloud-data.test.ts) |
| 安全性能 5 | 导出源暂存按路径、归属标记和系统租约回收。旧版标记才使用保守 PID 判断。 | [导出与回收](../electron/backend/accountArchive.ts) · [残留目录回归](../test/unit/account-archive.test.ts) |
| 安全性能 7 | 来源云账户可按固定版本补齐迁出项的 ZIP 导出。范围为资料、记录及附图、知识库原件。WAV 单独导出。 | [归档编排](../src/services/accountExport.ts) · [完整导出回归](../test/unit/account-export.test.ts) |
| 安全性能 8 | 新同步基线连同 cleanupPending 持久化。断网后继续清理旧版本，保护云端现行版本。 | [同步与版本清理](../src/services/cloudSync.ts) · [断网重启回归](../test/unit/cloud-sync.test.ts) |
| 安全性能 15 | 预览推迟所选大文件及面试正文的跨窗传输。来源仍可读取正文计算快照，冲突按需比对。 | [来源快照](../electron/profileImportSource.ts) · [选择性读取回归](../test/unit/account-import-renderer.test.ts) |
| 异常恢复 2 | 云恢复写回前在同场记录上比较修订或原值。其他场次可独立修改。 | [同步写入](../src/services/cloudData.ts) · [并发回归](../test/unit/cloud-data.test.ts) |
| 异常恢复 3 | 截图按原图与预览文件身份复用封包摘要，上传时再取原件并核对。账户释放时失效。 | [截图存储](../electron/backend/interview/images.ts) · [同步调度](../src/services/cloudSync.ts) |
| 异常恢复 5 | 资料 ZIP 同盘改名发布，跨盘按目标文件身份和租约复制。逐图读取时响应取消。 | [源暂存与取消](../electron/backend/accountArchive.ts) · [资料导出](../test/unit/account-archive.test.ts) |
| 异常恢复 10 | 预览只登记截图身份。选中场次才核对其原件、大小、摘要，其他场次可独立迁移。 | [隔离来源读取](../electron/profileImportSource.ts) |
| 异常恢复 11 | 文件名校验覆盖 241–255 个 UTF-16 码元的旧名。升级遇重名时截短主体，保留完整字符、编号和扩展名。 | [文件名契约](../electron/contracts/knowledge.ts) · [恢复校验](../src/services/cloudData.ts) |
| 七项复查 6 | 原件备份库 v2 为文档和库建索引，删除枚举主键。来源只读，旧窗口占用或升级失败可重试。 | [备份库版本](../src/services/originalBackups.ts) · [备份回收](../test/renderer/services/knowledge.test.ts) · [旧库读取与版本保持](../test/unit/legacy-browser-data.test.ts) |
| 云恢复 1 | 云恢复简历在停用旧索引前和原件事务内核对 ID 归属，防止覆盖同 ID 普通文档。 | [原件事务](../src/services/knowledge.ts) · [云恢复及并发用例](../test/unit/cloud-data.test.ts) |
| 云恢复 2 | 覆盖记录前登记将失去引用的截图，恢复所需缺图先按块校验补齐，提交后才做清理。 | [截图清理](../src/services/historyImageRemoval.ts) · [云端恢复](../src/services/cloudData.ts) · [跨记录截图回归](../test/unit/cloud-sync.test.ts) |
| 云恢复 3 | 先写系统加密删除意图。服务声明 `sha256-v1` 时，删除请求只发送随机查询凭据的摘要。原凭据留在加密意图里，成功响应丢失后用于回执查询。 | [本机回执](../electron/backend/cloud/erasureReceipts.ts) · [隔离回归](../test/unit/account-erasure-receipts.test.ts) |
| 云恢复 4 | 删除后独立释放相关资源，Copilot 正在授权时取消，退出失败待其余清理结束后报告并留待重试。 | [资源释放](../electron/accountProfile.ts) · [退出失败回归](../test/unit/account-profile.test.ts) |
| 账号与回答 1 | 独立服务在验密前认证当前会话并读取账号与密码摘要。删除事务内重新认证同一会话、比对账号及摘要，期间撤权或改密则拒绝提交。 | 独立仓 `src/account-deletion.ts`、`test/account-deletion.test.ts` |
| 账号与回答 3 | 有 password-only-v1 时仅验密不占设备会话。旧版 v1 隔离登录兼容路径可能挤掉最早设备。 | [客户端协议选择](../electron/backend/cloud/client.ts) · [新旧服务及离线回归](../test/unit/migration-passwords.test.ts) |
| 窗口与持久化 3 | 账号服务 0.6.1（SQLite schema 12） 为每个失败分块单独延期，按批清理，用量维护独立运行。 | 独立仓 `src/backups.ts`、`test/backups.test.ts` |
| 窗口与持久化 4 | 独立服务给 backup_uploads 的 resource_id、version_id 补索引，保留原分页协议。 | 独立仓 `src/store.ts`、`test/recovery.test.ts` |
| 备份与高负载 1 | 记录使用与恢复一致的封包和截图依赖校验，大记录可交 Worker。提交前必须备齐依赖。 | [记录封装与恢复](../src/services/cloudData.ts) · [数据回归](../test/unit/cloud-data.test.ts) |
| 备份与高负载 3 | 来源密码曾在本机在线验证后，停服可用最后已验证密码迁移本机资料。旧格式校验记录继续可读，无固定到期日。连续五次错密起延迟 30 秒，随后加倍至最多 15 分钟，重启保留限速。 | [授权判断](../electron/backend/cloud/migrationPasswords.ts) · [多年停服与旧格式回归](../test/unit/migration-passwords.test.ts) |

### 历史归档、截图引用与回放

| 原轮次及编号 | 代码核对结果 | 源码或复核入口 |
| --- | --- | --- |
| 合并审查 1 | 删除前先恢复该场未归档草稿，活跃面试须先结束。再暂存 WAV 目录，文字删除失败则尝试恢复录音。重开时按该场记录是否仍存在决定还原或清理。 | [删除编排](../src/services/historyRecordingRemoval.ts) · [回归](../test/unit/history-images.test.ts) |
| 合并审查 7 | 逐段校验并保留原编号。连播和导出均跳过坏段，健康段独立可用。 | [片段检查](../electron/backend/interview/recordings.ts) · [桌面回归](../test/scripts/recording-smoke.mjs) |
| 合并审查 13 | 早先的整表读缓存已由 IndexedDB 正文、目录和单场事务取代。 | [历史服务](../src/services/history.ts) · [旧格式回归](../test/renderer/services/history.test.ts) |
| 全库追加 1 | 删除前登记图片 ID。恢复、迁移与回收协调，只清理当前账号已无引用的原图和缩略图。 | [截图清理](../src/services/historyImageRemoval.ts) · [截图桌面回归](../test/scripts/interview-screenshot-smoke.mjs) |
| 全库追加 3 | 按转写起点和最晚结束时间定位，复用同区间高亮，支持重叠和静音处最近字幕。 | [字幕时间索引](../src/services/transcriptTimeline.ts) · [回归](../test/unit/transcript-timeline.test.ts) |
| 安全性能 11 | 提交时保存音源和转写 ID。显式空列表代表手输。旧麦克风关联须 ID、音源和原文一致。 | [提问时记录](../src/stores/interview.ts) · [兼容回归](../test/unit/history-presentation.test.ts) |
| 安全性能 12 | 回答栏首次打开才挂载，缩略图按接近可视区加载。定位先挂载、滚动再高亮。 | [历史详情](../src/components/HistoryDetail.tsx) · [首次打开与定位回归](../test/scripts/history-branding-smoke.mjs) |
| 安全性能 14 | 自动云同步从历史目录取得场次 ID 和修订，需要正文时定向读取，可复用最近一次相同修订的封包。旧整表作为升级输入，缺少 IndexedDB 时保留兼容读取。 | [历史快照索引](../src/services/cloudData.ts) · [定向读取回归](../test/unit/cloud-data.test.ts) |
| 异常恢复 1 | 面试草稿用每场 Web Lock 隔离，按转写与回答行写入 IndexedDB。卸载时可写检查点。重开后跳过活跃场次，合并已持久化内容，恢复为中断记录或重试上次失败的完整归档。已结束的记录优先，归档完成再清理草稿。 | [面试草稿](../src/services/interviewDraft.ts) · [结束与恢复](../test/unit/interview-end.test.ts) |
| 窗口与持久化 6 | 截图分批登记，每批最多 100 张。当前库用目录 imageIds 索引查存活引用，避免跨场误删。 | [清理与重试](../src/services/historyImageRemoval.ts) · [跨批恢复与账号切换回归](../test/unit/history-images.test.ts) |
| 窗口与持久化 7 | 无转写 ID 的旧记录只回溯连续最多六段系统转写，仅唯一文本匹配提供定位。 | [历史定位](../src/services/historyPresentation.ts) · [歧义、标点、六段边界与麦克风](../test/unit/history-presentation.test.ts) |
| 历史与手机 1 | 正式历史按场次保存，目录与正文在同一文档库 v2。旧整表转换校验后才删旧键。同步和迁移按修订处理。 | [存储与旧库升级](../src/services/history.ts) · [存储回归](../test/unit/history-repository.test.ts) |

### 聊天、模型与流式显示

| 原轮次及编号 | 代码核对结果 | 源码或复核入口 |
| --- | --- | --- |
| 合并审查 9 | 按会话写 IndexedDB，合并连续草稿和流式更新，旧快照转换时保留附件引用。 | [保存时机](../src/stores/preparation.ts) · [回归](../test/unit/chat-storage.test.ts) |
| 合并审查 11 | 浮窗回答按行复用。内容、复制或重试状态改变时更新对应行。 | [回答行](../src/components/FloatingAnswer.tsx) · [面试专项](../test/scripts/interview-usage-smoke.mjs) |
| 合并审查 12 | 资料提案流式解析保留读取位置和未完成转义，流结束仍校验完整结构。 | [增量解码](../electron/backend/chat/profile.ts) · [回归](../test/unit/profile-proposal.test.ts) |
| 高负载 2 | 准备聊天按行复用 Markdown，资料提案缩小状态订阅。草稿编辑无需重排全部旧回答。 | [消息行](../src/components/PreparationMessage.tsx) · [桌面回归](../test/scripts/composer-smoke.mjs) |
| 高负载 5 | 大附件按编码成本决定是否分块，二进制按 192 KiB 分段转 Base64，批间可取消。 | [编码](../electron/backend/chat/input.ts) · [回归](../test/unit/chat.test.ts) |
| 高负载 7 | 资料提案预览按请求以 60 ms 合并。正文结构已解析完整后才发布提案预览。正常完成前刷新最后一份，取消后不再发布。 | [预览合并](../electron/backend/chat/profilePreviews.ts) · [流回归](../test/unit/profile-proposal.test.ts) |
| 安全性能 9 | Claude 和兼容协议用附件占位、可取消的分块 Base64 和 Blob 组装大图请求。 | [协议适配](../electron/backend/api/messages.ts) · [请求体回归](../test/unit/api-chat.test.ts) |
| 异常恢复 13 | SSE 按新增数据扫描，跨块保留 UTF-8、行和事件状态，维持容量上限与取消。 | [SSE 解析](../electron/backend/chat/sse.ts) · [流式应答回归](../test/unit/chat-responses.test.ts) |
| 异常恢复 14 | 浮窗转写列表和行分别复用。追加仍遍历列表，未变化行可跳过正文渲染。 | [转写行与列表](../src/components/FloatingTranscripts.tsx) |
| 异常恢复 16 | Copilot 发送前复用可取消的 Base64 分块编码，最终按 SDK 要求提供字符串。 | [附件编码](../electron/backend/chat/input.ts) · [Copilot 回归](../test/unit/copilot.test.ts) |
| 七项复查 1 | Copilot 网页权限逐次校验目标和 SDK 提供的重定向来源，最多并行两次尚未结束的系统 DNS 查询。许可请求 5 秒超时，系统解析结束后才释放名额。实际连接仍由 SDK 建立。 | [网络授权](../electron/backend/copilot/webPermission.ts) · [Copilot 回归](../test/unit/copilot.test.ts) |
| 七项复查 5 | Copilot 按估算上界选择大附件的 SDK JSON-RPC 消息在内存中分块编码，保留管道消息顺序、背压和取消。 | [附件与编码](../electron/backend/copilot/attachments.ts) · [实际 SDK 管道回归](../test/unit/copilot-attachments.test.ts) |
| 云恢复 7 | 大文本附件按 JSON 转义大小上界分块，保留跨块 UTF-8 与 Kimi 历史内层转义。就绪才发请求。 | [附件编码](../electron/backend/chat/input.ts) · [Responses 服务](../electron/backend/chat/service.ts) |
| 账号与回答 2 | Responses 按输出项与内容段校齐正文、拒答和终态补文。相互矛盾或缺有效结果时报错。 | [正文核对](../electron/backend/chat/responseText.ts) · [流式及结构化提案回归](../test/unit/chat-progress.test.ts) |
| 窗口与持久化 2 | 确认个人资料提案先记回执，重载后按资料和消息核对，聊天事务成功后才清除。 | [提案回执](../src/services/profileConfirmations.ts) · [重载后的下一次提问](../test/scripts/chat-progress-smoke.mjs) |
| 窗口与持久化 8 | 公开摘要仅在摘要段变化时重新拼接。十万字符上限含段间换行。 | [公开摘要](../electron/backend/chat/summary.ts) · [流式更新与终态](../test/unit/chat-summary.test.ts) |
| 窗口与持久化 9 | 超过 200 字符的响应 ID 转为带类型的 SHA-256，最多保留 1,000 个去重键。兼容旧账本及重置边界。 | [用量账本](../electron/backend/chat/usage.ts) · [旧格式、重置和去重回归](../test/unit/chat.test.ts) |
| 窗口与持久化 10 | 额度占位与读取错误在当前语言下相同才去重，保留带读屏语义的错误行。 | [设置组件](../src/components/UsagePanel.tsx) · [Electron 聊天专项](../test/scripts/chat-response-smoke.mjs) |
| 设备与草稿 2 | 普通编辑按 350 ms 合并，离页经已打开连接写草稿和附件检查点。重开合并，迁移仅带有效引用。 | [准备聊天的保存时机](../src/stores/preparation.ts) · [原桌面长草稿用例](../test/scripts/chat-progress-smoke.mjs) |
| 备份与高负载 4 | 准备页、浮窗和手机按渲染耗时合并追加的 Markdown。首段、替换、终态立即显示，最长等 250 ms。 | [显示节奏](../src/lib/useStreamingMarkdown.ts) · [格式与引用回归](../test/unit/markdown.test.tsx) |
| 附件与原生依赖 1 | 恢复只载入正文与引用。选中时查附件身份，发送前按预算读原件。缺失附件局限于引用它的请求。 | [聊天存储](../src/services/chats.ts) · [存储回归](../test/unit/chat-storage.test.ts) |

### 知识库与检索

| 原轮次及编号 | 代码核对结果 | 源码或复核入口 |
| --- | --- | --- |
| 合并审查 5 | 后台写入期间，有已提交版本时可启用独立读进程查询。开场准入和无可用快照仍受限制。 | [进程协调](../electron/backend/knowledge/host.ts) · [进程回归](../test/scripts/knowledge-host-smoke.mjs) |
| 合并审查 6 | 先用主问及所选追问的组合正文，超预算才改用同次回取已核验的命中节选，保留同来源、修订及父子归属。 | [摘录核验](../electron/backend/knowledge/evidence.ts) · [回归](../test/unit/rag.test.ts) |
| 高负载 3 | 知识进程核验命中节选、计算内容摘要，应用层核对来源，按摘要和条目 ID 去重并控制字符及 UTF-8 字节预算，跨进程结果有界。 | [知识库端](../electron/backend/knowledge/process.ts) · [应用层](../electron/application/rag.ts) |
| 安全性能 1 | 文档、库删除或替换期间阻止旧任务提交，异步读取前后复核任务归属。 | [读取与删除协调](../src/services/knowledgeIndex.ts) · [索引队列回归](../test/unit/knowledge-index-store.test.ts) |
| 安全性能 10 | 证据同时受剩余消息字符和 UTF-8 预算约束，连提示都放不下时发送原对话并返回空引用。 | [证据预算与发送](../electron/application/rag.ts) · [请求容量边界回归](../test/unit/rag.test.ts) |
| 安全性能 13 | 排队只存元数据，执行时按主键读取所属库和当前修订的原件。 | [索引调度](../src/stores/knowledgeIndex.ts) · [批量索引回归](../test/unit/knowledge-index-store.test.ts) |
| 安全性能 18 | 面试同题重试先读所选库的版本令牌，再计算含附件摘要的请求键。普通准备聊天跳过摘要计算。 | [请求范围与缓存键](../electron/application/rag.ts) · [版本及附件变化回归](../test/unit/rag-reliability.test.ts) |
| 异常恢复 4 | 持久化整库删除意图，阻止重导，重建并校验其他库后回收本库正文、原件、备份，可分阶段续作。 | [整库清除](../electron/backend/knowledge/eraseLibrary.ts) · [原件回归](../test/unit/knowledge-reconcile.test.ts) |
| 异常恢复 12 | 独立读进程切换快照时可按文件身份复用已验修订，发生变化须重新验证。 | [快照读取](../electron/backend/knowledge/service.ts) · [跨库快照回归](../test/unit/knowledge-core.test.ts) |
| 历史与手机 3 | 1.2.3 从项目标题提取别名，并另取最多 64 个跨文档重复标题后缀编码。1.3.0 取消这两项生成检索步骤，按主问分组评分。 | [当前评分](../electron/backend/knowledge/grounding.ts) |
| 备份与高负载 2 | 打开目录与固定表后按修订读正文，16 MiB 热缓存。建立 grounded 快照还须验证选库可用来源，隔离坏文档。 | [索引服务](../electron/backend/knowledge/service.ts) · [实际 Lance 回归](../test/unit/knowledge-core.test.ts) |
| 备份与高负载 6 | 同次选择的同库待索引文件分批处理，每批最多 20 份，暂存后一次建全文索引并发布。单份出错后先回滚，再分开重试其余有效文件。 | [文件选择与调度](../src/stores/knowledgeIndex.ts) · [真实选择入口回归](../test/unit/knowledge-selection.test.ts) |
| 附件与原生依赖 2 | 1.2.3 最多取 20,000 行计算背景向量均值。现行正文余弦和按已提交快照计算的 BM25 不依赖该均值。 | [现行检索](../electron/backend/knowledge/service.ts) |

### 采集、录音与识别

| 原轮次及编号 | 代码核对结果 | 源码或复核入口 |
| --- | --- | --- |
| 合并审查 3 | 尾段超时、进程退出或实际丢样时保留已归档内容，并记录转写可能不完整。 | [语音进程收尾](../electron/backend/speech/host.ts) · [回归](../test/unit/interview-end.test.ts) |
| 合并审查 4 | Windows 在复制设备包后立即归还 WASAPI 缓冲。有界写线程输出，共享 WAV 异步写盘。 | [Windows 采集](../../windows/native/WasapiCapture.cs) · [原生采集探针](../../windows/test/fixtures/WasapiPacketProbe.cs) |
| 合并审查 14 | Windows AEC 批量取环形缓冲并给短尾帧补零。Mac 自有 frames() 路径待移植。 | [共享缓冲](../electron/backend/speech/buffer.ts) · [Mac 待接续位置](../../macos/electron/speech/echoCancellation.ts) |
| 高负载 1 | 已知写盘故障或背压导致停收时先发布 `draining`，正常停录排空后才报告 `inactive`。识别器与慢盘分别收尾。关闭仍等待已接收的录音处理完毕。 | [语音控制器](../electron/backend/speech/controller.ts) · [慢盘回归](../test/unit/speech-drain.test.ts) |
| 高负载 4 | 迟到 PCM 只读、混合并写回已落盘的实际重叠区间。 | [混音与写盘](../electron/backend/speech/recording.ts) · [回归](../test/unit/interview-recording.test.ts) |
| 高负载 6 | 面试只发布提问音源进度，积压期按 100 ms 音频时间合并。积压开始与清空即时通知。 | [进度发布](../electron/backend/speech/controller.ts) · [回归](../test/unit/speech-input-state.test.ts) |
| 安全性能 3 | 中断文件按 WAV 头已提交前缀播放、导出。修复后仍可封存前缀，普通封存文件严格验长。 | [写入与封存](../electron/backend/speech/recording.ts) · [录音回归](../test/unit/interview-recording.test.ts) |
| 安全性能 4 | 录音写盘失败单独归档 `recordingError`，继续保存文字，尾段状态独立记录。 | [语音收尾](../electron/backend/speech/controller.ts) · [结束面试回归](../test/unit/interview-end.test.ts) |
| 异常恢复 7 | 识别背压实际丢样时累积转写不完整状态，跨同场手动重连和自动恢复保留。 | [语音会话](../electron/application/speech.ts) · [识别控制器](../electron/backend/speech/controller.ts) |
| 异常恢复 9 | 迁移中断录音复制有效 WAV 前缀，并保存来源完整摘要，清理前复核。 | [录音迁移](../electron/backend/profileRecordingTransfer.ts) · [迁出凭据](../electron/backend/profileMoveReceipt.ts) |
| 七项复查 7 | Mac 待实现。原生写线程仅复制短包头与有效字节，再归还队列槽位，验证背压及停止。 | [原生音频写线程](../../macos/native/AudioCapture.mm) |
| 设备与草稿 1 | Windows 设备失效通知后仍排尽旧进程输出的完整包，待双管道关闭再换代。协议损坏及排空时才到达的终止错误会阻止自动恢复。 | [Windows 采集适配器](../../windows/electron/speech/capture.ts) · [设备故障后交付完整包](../../windows/test/unit/wasapi-recovery.test.ts) · [管道关闭与截断](../../windows/test/unit/capture-drain.test.ts) |
| 附件与原生依赖 4 | Candle core/nn 升至 0.11.1、锁定 zip 9.8.1 仅反映构建源码，既发运行时的版本和摘要仍独立。 | [锁文件](../native/qwen-speech/Cargo.lock) · [构建说明](../native/qwen-speech/README.md) |

### 手机配对与远程操作

| 原轮次及编号 | 代码核对结果 | 源码或复核入口 |
| --- | --- | --- |
| 高负载 8 | 在 1.2.3 单帧在途及超时断连的基础上，浮窗先等手机回执再投影最新快照，换场或结束可先更新主进程的命令归属。 | [桌面状态](../src/services/remoteInterview.ts) · [回归](../test/unit/remote-interview.test.ts) |
| 安全性能 6 | 更换手机授权清掉旧快照，确认后发布本场草稿。同一授权短断线保留回执。 | [配对与重连](../electron/backend/remoteConnection/service.ts) · [配对回归](../test/unit/remote-connection-service.test.ts) |
| 异常恢复 6 | 主动断开时清除手机草稿、输入法暂存及待同步状态。短时失联可用原授权恢复，采纳电脑最新草稿，未确认操作查询原回执。 | [手机连接](../src/mobile/connection.ts) · [重连与断开](../test/unit/mobile-connection.test.ts) |
| 七项复查 2 | 手动编辑按实际提交文字限长。自动或未编辑的问题仍核对全部原文，保留正确音源和定位。 | [问题缓冲](../src/services/speech.ts) · [超限回归](../test/unit/automatic-question.test.ts) |
| 云恢复 6 | 发题先核场次，取原列表长度处的新增回答作接单依据并回执，避免扫描全部旧回答。 | [桌面提交](../src/stores/interview.ts) · [手机联动回归](../test/unit/remote-interview.test.ts) |
| 历史与手机 2 | Windows 支持预配受信 PFX，经当前用户 DPAPI 保护后用于 HTTPS/WSS，手机须信任签发链。 | [Windows 预配](../../windows/scripts/configure-remote-tls.ps1) · [Windows TLS 回归](../../windows/test/unit/remote-connection-tls.test.ts) |
| 历史与手机 4 | 声明增量能力的手机以已确认快照为基准收变更。失配请求整帧，重连与换场重置基准。 | [增量编码与校验](../electron/contracts/remoteSnapshotDelta.ts) · [实际 WebSocket 回归](../test/unit/mobile-lan-integration.test.ts) |
| 备份与高负载 5 | Windows 证书与必需标记分开保存，目录丢失而标记仍在时拒绝监听。换证失败保留原身份。 | [Windows 预配](../../windows/scripts/configure-remote-tls.ps1) · [实际 TLS 回归](../../windows/test/unit/remote-connection-tls.test.ts) |

### 窗口、更新与组件

| 原轮次及编号 | 代码核对结果 | 源码或复核入口 |
| --- | --- | --- |
| 安全性能 16 | 组件清单遍历、读流、摘要循环共用取消信号。重试重新核验。 | [组件校验](../electron/backend/components/service.ts) · [读取中取消与重试](../test/unit/components.test.ts) |
| 安全性能 17 | 组件安装以 v3 租约和 next/previous 目录分阶段提交，重启按归属恢复发布、回滚或清理。 | [安装事务与启动恢复](../electron/backend/components/service.ts) · [各中断阶段回归](../test/unit/components.test.ts) |
| 异常恢复 8 | 主窗口先完成保存握手。主进程并行等待更新清理与录音收尾，两项都结束后继续退出，失败分别记录。录音宿主等待旧进程退出有 10 秒上限，更新清理等待自身任务结算。 | [主进程退出](../electron/main.ts) · [录音退出](../test/unit/speech-host.test.ts) |
| 异常恢复 15 | 模型正被使用而拒绝删除时恢复就绪。若已开始删文件，仍须复核磁盘。 | [组件删除](../electron/backend/components/service.ts) · [组件回归](../test/unit/components.test.ts) |
| 异常恢复 17 | 尺寸校验后仅向截图 Worker 转移可证明独占的完整缓冲。切片、池或不可转移内存使用副本。 | [尺寸检查](../electron/screenshot.ts) · [缓冲区交接](../electron/backend/screenshot/host.ts) · [捕获回归](../test/unit/screenshot.test.ts) |
| 七项复查 3 | Mac 待实现。更新 ZIP 下载完成后如发现损坏，仅作废可确认归属的普通文件，重新下载同一版本并校验签名及摘要。 | [更新驱动](../../macos/electron/updates/driver.ts) |
| 七项复查 4 | Mac 待实现。正式包、开发宿主、启动器、音频助手及中英权限文案需说明用户启用后在本机保存录音。 | [正式包](../../macos/scripts/package-app.mjs) · [启动器](../../macos/scripts/build-launcher.mjs) · [助手](../../macos/native/Info.plist) |
| 云恢复 5 | Windows 的中断下载恢复复用在途任务。缓存临时占用解除后重读，清日志先落盘再改内存。 | [更新恢复](../electron/backend/updates/driver.ts) · [故障回归](../test/unit/update-cache.test.ts) |
| 窗口与持久化 1 | 涉及切换资料分区的账号操作失败且请求仍属于当前主窗时，撤回关闭许可及保存标记，用户继续编辑后下次关闭重新握手。 | [账号操作与主窗关闭](../electron/main.ts) |
| 窗口与持久化 5 | 主窗渲染崩溃或重载取消页面所属聊天、目录、归档及听写。等待旧页面保存的操作可失败退出。 | [主窗口与退出握手](../electron/main.ts) · [请求取消与归属](../electron/ipc/chat.ts) |
| 附件与原生依赖 3 | Windows 只在同轮恢复且文件身份相同才复用验包结果。安装前重验并核对 NSIS 准备执行的路径。 | [Windows 适配器](../electron/backend/updates/driver.ts) · [NSIS 更新器与合成下载文件回归](../../windows/test/scripts/updates-native-smoke.mjs) |

## 本轮验收发现及修正

以下问题来自 1.3.0 发行验收，独立于上列 103 个历史审查编号。

| 问题 | 可能影响 | 修改 | 复核入口 |
| --- | --- | --- | --- |
| 资料导出、知识库、云同步等路径的动态错误缺少英文，带有 `Error:` 前缀或同时出现两条警告时也会匹配失败。 | 英文界面的用户在恢复、重试或检查额度时会看到中文原因，可能漏读其中一条。 | 补齐 36 条有界面消费者的译文，初始化失败取实际错误消息，合并警告按行翻译并保留原顺序。 | [英文词典和组合提示回归](../test/unit/ui-language.test.ts) · [同步失败回归](../test/unit/cloud-sync-store.test.ts) |
| 退出账号后，登录表单可能先于旧分区的资源释放就绪。 | 用户立即换号时，新登录可能与旧账号的写盘、知识库或 AI 运行时收尾重叠。 | 退出时撤销旧请求并关闭旧窗口，登录窗等待旧分区释放后再加载表单。 | [主进程换号](../electron/main.ts) · [账号迁移与切换](../test/scripts/account-transfer-smoke.mjs) |
| 已确认注销的账号若认领过 1.2.3 默认浏览器分区，冷启动清理会临时打开隐藏窗口。 | Windows 在最后一个隐藏窗口关闭时可能自动退出，使原件或注销回执留到下一次启动，其他账号也可能无法进入主窗。 | 仅在恢复已确认注销、清理资料和核销回执期间，保留无可见窗口的进程。清理后再恢复当前账号；用户主动退出和普通最后窗口关闭仍沿用原逻辑。 | [启动恢复和窗口生命周期](../electron/main.ts) · [Windows 旧分区与回执冷启](../test/scripts/legacy-profile-upgrade-smoke.mjs) |
| Windows 登录窗缩至 860 × 580 后，演示中已滚出可见区的问题气泡仍参与原生命中判断。 | 顶部 72 CSS px 拖动带的右侧看似空白，按住却无法移动窗口。 | 仅在 Windows 登录窗，让只读演示及其后代退出原生拖动区域计算，由顶部条带承接拖动。以五档缩放、浅深主题、默认与最小尺寸核对条带左中右三点，并实际拖动窗口、点击表单。 | [登录样式](../src/styles.css) · [Windows 原生命中与操作](../../windows/test/scripts/login-actions-native-smoke.mjs) |
| Claude 流式响应只在收到思考增量时更新状态。 | 开始思考后界面仍可能显示等待；只有脱敏思考块时可能直接跳到输出正文。 | 收到 `thinking` 或 `redacted_thinking` 的开始事件即显示思考中，只转发活动状态。 | [Claude 流解析](../electron/backend/api/messages.ts) · [原始事件回归](../test/unit/api-chat.test.ts) |
| Windows 175% 缩放下，分别取整再相减会算错滚动条占宽。 | 设置同步按钮可能偏离 24 CSS px 边距的目标设备像素。个人信息、记录回答侧栏及管理列表标题也使用该测量。 | 用 `ResizeObserver` 的边框盒、内容盒减去边框和内边距，再按设备像素取整。同步页按实际绘制边缘检查，保留两按钮间距 8 CSS px。 | [滚动条测量](../src/platform/webMaterials.ts) · [同步设置几何](../test/scripts/account-erasure-smoke.mjs) · [管理列表与侧栏](../test/scripts/management-scrollbar-checks.mjs) |
| 手机页面直接依赖桌面面试展开组件。 | 桌面专用样式或后续依赖可能随公共动效进入手机页面。 | 将高度过渡与基础样式提取为独立组件，手机页面直接使用，桌面入口保留面试样式。 | [共享展开组件](../src/components/ui/content-reveal.tsx) · [手机页面回归](../test/unit/mobile-ui.test.tsx) · [依赖检查](../test/unit/architecture.test.ts) |
| 知识库后端从平台层导入数据库目录准备回调类型。 | 后端依赖平台声明，平台装配和知识库宿主难以独立检查。 | 由知识库后端声明回调，平台仅引用其类型并在装配时传入实现。架构检查继续拒绝反向运行时依赖。 | [回调定义](../electron/backend/knowledge/types.ts) · [宿主回归](../test/unit/knowledge-host.test.ts) · [架构回归](../test/unit/architecture.test.ts) |
| 公开说明仍称原始音频不保存，Windows 安装指南还把截屏写成即时发送且不留记录。 | 用户可能误判哪些资料保存在本机、何时向 AI 发送。 | 中英文说明写明自动录音默认关闭，开启后 WAV 存入当前账号本机记录、排除于云备份，并说明系统加密与本机资料的范围。安装指南写明每题最多五张截图，截取后可从草稿移除，随题提交后可在记录中查看。 | [中文说明](../../README.md) · [英文说明](../../README.en.md) · [Windows 安装指南](../../windows/docs/INSTALL.md) · [截图流程回归](../test/scripts/interview-screenshot-smoke.mjs) |

下表记录测试脚本自身的误报。这些问题仅修正夹具、取样或断言，无对应产品故障。

| 问题 | 可能影响 | 修改 | 复核入口 |
| --- | --- | --- | --- |
| 125% 缩放下，胶囊菜单参照单独复制宽度，实际项与参考项的右边缘落在半个设备像素的两侧。 | 对照图可能把一像素的参考定位偏差误报为菜单圆角被裁。 | 从实际项分别定位参照的四条边，核对取整后的设备像素位置一致，再按原采样点、原色差和轮廓外侧标准比较两图。 | [菜单圆角像素对照](../test/scripts/continuous-corners.mjs) |
| 面试浮窗样式回归在全页查找合成回答的结尾文字。 | 开场自动题与后续手动题有相同结尾时，脚本不能确定正在测量哪一张卡。 | 用手动问题的无障碍名称定位对应回答，在该卡内核对材质、滚动位置、末行可见性及与输入框的留白。 | [面试回答卡实测](../test/scripts/interview-chrome-smoke.mjs) |
| AI 服务设置按旧 DOM 查授权提示前的分隔线，额度卡按 CSS 网格属性判定间距，未连接时仍预期从首页进入原页面。 | 实际分隔线和两处 4 px 间距正确，或已按设计打开 AI 服务设置，脚本仍会报错。 | 从展开区域定位相邻授权行；分别量标题、摘要、进度条的边缘；断开后点击「开始面试」，核对打开的「AI 服务」标题。 | [ChatGPT 授权](../test/scripts/chatgpt-single-login-smoke.mjs) · [Copilot 额度](../test/scripts/copilot-login-smoke.mjs) · [断连入口](../test/scripts/account-usage-overview-smoke.mjs) |
| 知识库等待旧详情段落。免费服务测试在公告入场时测外层，并在整个浮窗查找手动提问的回答。 | 已显示的索引进度可能被漏读。公告过渡时的零高度会干扰占比；自动提问与手动提问的合成回答相同，也会造成重复匹配。 | 按文件名核对同一行的索引进度及完成文字。待公告展开后测实际气泡，检查前两条及第三条约半可见；回车提问后在该问题的回答卡内核对正文，再检查额度提示。 | [知识库状态行](../test/scripts/ui-refinement-smoke.mjs) · [免费服务公告与面试提问](../test/scripts/free-service-smoke.mjs) |
| 面试记录的英文长错误和浮窗切换模型后的状态在展开途中就被测量。重试提示按全页唯一项查找，长错误滚动底端用取整后的高度差判断。 | 展开中的裁剪、历史回答中的同名提示、分数缩放下的高度取整，都可能触发误报。 | 等展开后验证位置与命中，在对应回答内核对读屏提示。长错误滚到底后，再向下滚动应为零位移，末行须完整可见，外层位置和卡片底边像素另行核对。 | [记录标题](../test/scripts/typography-smoke.mjs) · [面试模型切换](../test/scripts/interview-ux-smoke.mjs) · [面试重试](../test/scripts/interview-retry-smoke.mjs) |
| 面试录音专项点击截图保护后立即读状态。截图专项在进度收起前测滚动，以分别取整的高度判断底端，原生保存命中参数也未接通。 | 状态或布局尚在变化时可能误报。分数缩放下，即使滚动已到底，整数高度计算也可能阻止后续光标和减少动态效果检查。 | 等保护按钮状态写回、进度收起和失败提示展开。以末条回答底边加底部内边距核对视口，保留 1 CSS px 精度，再用 End/Home 比较回答、提示及输入框位移。恢复 `--native-hits` 检查保存、取消和原图字节。 | [录音控制](../test/scripts/recording-smoke.mjs) · [截图及原生保存](../test/scripts/interview-screenshot-smoke.mjs) |
| 正式包升级夹具将 1.2.3 的九项快捷键直接用作 1.3.0 的完整期望值。 | Windows Sandbox 已安装新版并保留原有绑定，但新增的快捷键帮助使整份持久化快照比较失败，后续重启检查也无法继续。NSIS 与 Store 共用这段校验。 | 按目标版本列出完整预期。旧版九项必须全部逐值保留，包括夹具自定义的显示／隐藏窗口 `Control+Alt+K`。夹具的旧绑定均未占用 `Control+Shift+/`，1.3.0 必须将该组合分配给快捷键帮助。升级、全新安装和重启均精确比较完整绑定，其他增删改仍会报错，资料、历史和原件字节继续逐项比对。 | [正式包持久化校验](../../windows/test/scripts/store-renderer-client.mjs) · [共享快捷键定义](../electron/contracts/shortcuts.ts) |
| 面试回答选模浮层的旧断言把滚动列表底缘当作弹层的最后一行。 | 固定在列表下方的「刷新模型列表」及其间隔被误计入底部留白，使主窗口和面试浮窗可能误报上下不对齐。 | 分别从菜单上缘量到列表、从刷新行底缘量到菜单下缘，核对两侧设计内边距和列表到刷新行的 6 px。实际滚动列表，确认刷新行固定，并保留语音模型、回答模型及已选项文字和图标的水平对齐检查。 | [Windows 面试权限与选模](../../windows/test/scripts/interview-access-smoke.mjs) · [共享选模布局](../src/components/reasoningEffortControl.css) |
| 面试浮窗动效夹具手动暂停退出动画后，仍让真实超时保护结束该动画。 | 150% 缩放验收在跨进程读取状态时，原生窗口可能已按超时保护收起，使退出中应保持原尺寸的检查误报。 | 逐帧检查先等实际面板播放器暂停，再读取原生状态和完整窗口边界，手动结束该帧后再核对收起。单独让停住的动画触发真实超时保护，核对原生窗口确实收起并能正常展开。减少动态效果、实际播放和中途关闭继续经过各自的真实路径。 | [面试浮窗动效](../test/scripts/interview-motion-smoke.mjs) · [原生缩放与动画顺序](../src/components/useInterviewPanelMotion.ts) |
| Windows 组件移除专项仍从知识库宿主直接读取旧单子进程字段。 | 宿主改为管理主知识库进程和按需启动的读取进程后，夹具可能在真实卸载前报错，误判未知文件保护成功，并在下一步等到超时。 | 先执行真实向量检索，通过 Electron 记录本次知识库工具进程的 PID 和创建时间，再等原进程退出并以独占方式打开模型文件。对未知文件和目录均检查已实际卸载且拒绝删除。使用临时资料恢复白名单模型后，再查原件与索引。 | [Windows 组件移除](../../windows/test/scripts/component-removal-check.mjs) · [缓存与重启入口](../../windows/test/scripts/components-native-smoke.mjs) |
| Windows 原生布局测试在思考阶段检查容器本身的底边框。 | 正文尚未开始时分隔线应当隐藏，原断言会提前中止后续窗口布局和缩放检查。 | 思考时核对无可见分隔线，正文到达后核对实际绘制分隔线的伪元素、不透明度、厚度，以及它与公开摘要、计时行的位置。 | [Windows 窗口布局回归](../../windows/test/scripts/interview-layout-smoke.mjs) |

## 验证入口与发行前待验

Windows 安装版与商店版各有全新安装和正式 1.2.3 升级入口。商店版在系统分配的包身份下启动原生密钥编辑器，并核对测试窗口与编辑器的系统包全名相同，再实际粘贴合成值、切换显隐并提交。从包外直接运行 WindowsApps 内的助手会被 Windows 拒绝。安装版从实际 NSIS 安装目录启动同一编辑器。[包身份与原生输入](../../windows/test/scripts/package-native-check.cjs) · [安装与升级](../../windows/test/scripts/store-sandbox-smoke.mjs)

下表用于从正常用户入口复验。命令在当前平台目录执行，配置同步在仓库根执行。桌面回归使用已登录且解锁的隔离桌面串行运行。模型和公开音频按夹具要求校验，本机合成语音写入临时文件。合成厂商响应覆盖客户端选路与协议。表中的观察项注明脚本断言或人工复验，正式发行状态以相应渠道记录为准。

| 范围 | 入口及应观察的结果 |
| --- | --- |
| 注册同意、语言与版本 | `node ../shared/test/scripts/cloud-account-smoke.mjs` 使用固定旧服务与合成邮箱，检验未勾选时按钮、回车及表单提交均不发注册请求，打开协议保留状态，勾选后才可注册。`node ../shared/test/scripts/language-smoke.mjs` 检查已保存语言、全新分区中英文默认值、整句字号与字重、唯一链接及下划线。在同一注册窗口模拟中英文切换，让窗口语言与系统不同，核对勾选保持、传给 `shell.openExternal` 的地址和非法语言被拒绝。实际打开系统浏览器与线上协议正文另验。打开「设置 → 关于与更新」核对 `1.3.0`。分别运行 `pnpm test:installer:artifact`、`pnpm test:store:artifact` 检查 NSIS 清单、Appx 身份版本和应用自身版本。[账户回归](../test/scripts/cloud-account-smoke.mjs) · [双语回归](../test/scripts/language-smoke.mjs) · [Store 包校验](../../windows/test/scripts/store-artifact-smoke.mjs) |
| 设置、准备页、聊天、同步图标 | `pnpm test:settings`、`pnpm test:composer`、`pnpm test:conversations:status`、`pnpm test:knowledge`。再以 `node ../shared/test/scripts/local-mode-smoke.mjs`、`node ../shared/test/scripts/components-ui-smoke.mjs` 验本地账号布局、定位及提示。在混合库看两份待升级文件和一份已是 v3 的文件，只有前两行显示清理，随后分别进入写入、完成。偏好就绪后打开同步弹层核对分类关闭、暂停、失败。 |
| 准备聊天与流式引用 | `pnpm test:conversations` 从「新对话」进入长记录，核对首帧从下向上、恢复阅读位置、落定后无二次跳动。两条对话并发时，在输入框有草稿的情况下点停止，核对请求数、另一条回复和原草稿。`pnpm test:chat-response` 对照追加正文和补充来源前后的段落及表格，核对已加载图标的 DOM 节点和请求次数。`pnpm test:chat:progress` 核对状态基线、首段正文与分隔线，以及详情展开、收起和途中反向。 |
| 面试提示、错误卡片与登录演示 | `node ../shared/test/scripts/interview-retry-smoke.mjs` 核对检索中、成功、失败和其他活动原位替换，比较实际字号与文字位置，检查公开摘要只出现一次。分别检查短回答收起、带摘要回答的分隔线淡入和「减少动态效果」。在普通及最小窗口滚动长错误，比较底边与临时透明底边的像素，确认红线实际可见。`pnpm test:interview:screenshot` 核对新问题连同截图一起入场，并对照自然折行、显式换行、嵌套列表与引用、表格和代码的末字与光标位置。`pnpm test:login:entry` 核对演示续播、末行定位、切换表单及减少动态效果。 |
| 面试同步与状态弹层 | 开启面试记录同步后，`pnpm test:floating` 从浮窗结束合成面试，检查主窗口自动上传包含最后一问及转写的记录，徽标变为「已同步」。`pnpm test cloud-sync.test.ts` 检查从中断的分块续传、保留手动暂停和遵守服务端退避。`node test/scripts/history-scrollbar-smoke.mjs --sync-popover` 在 Windows 的 100%、125%、150%、175%、200% 缩放下逐帧检查短错误的弹层展开与收起，再滚动长错误到「重试同步」。 |
| 授权、API 密钥、模型 | `pnpm test:login`、`pnpm test:copilot`、`pnpm test:chatgpt:single-login`、`pnpm test:chatgpt:usage:runtime`、`pnpm test:provider:ui`。Windows 构建后运行 `node ../shared/test/scripts/api-interactive-preview.mjs --check-only`、`node test/scripts/api-key-field-smoke.mjs`、`pnpm test:interview:effort`。逐家以合成目录先返回一个型号，再加入第二个，刷新后核对聊天和面试发送完整 ID。验证更换密钥失败仍能使用原配置。官方实时可见型号、订阅权限及扣费留待对应账户验收。 |
| 旧资料、同机迁移与删除回执 | `node ../shared/test/scripts/legacy-profile-upgrade-smoke.mjs`。`node ../shared/test/scripts/account-transfer-smoke.mjs` 和旧版注销专项使用 `VOXCUE_TEST_SERVER_ROOT` 指向干净的 0.5.3、`3bceb61` 服务。新协议另设 `VOXCUE_TEST_SERVER_ROOT` 指向 0.6.1，或使用该版本的相邻 `VoxCue-server`。运行 `node ../shared/test/scripts/account-erasure-receipt-smoke.mjs`，覆盖八设备满额的无会话验密、错密、注销响应丢失、错误回执或账号、重建 SQLite 服务和桌面业务对象后的收尾。此项以临时加密适配器运行，签名包与系统凭据另验。0.5.3 对照的迁移界面脚本通过压低弹窗高度覆盖列表滚动。另作大数据量手动验收时，每个来源可用 60 条记录、48 个库。10 处冲突覆盖姓名、简历摘要、记录 01/20/40/60 和库 01/16/32/48。核对未选项、冲突覆盖、目标重开、源本机及云端副本。[旧服务固定参考](../test/scripts/server-reference.mjs) |
| 面试、录音、历史与截图 | `pnpm test:history`、`pnpm test:interview:screenshot`、`node ../shared/test/scripts/interview-ux-smoke.mjs`、`node ../shared/test/scripts/recording-smoke.mjs`（可用 `--browser-label-clicks`）。录音脚本覆盖键盘调整进度、静音处定位和暂停状态。用指针另验慢拖跨句、按住不动、快速往返、连续点击及点击后立即拖动，观察滚动中途能否承接新目标并减速停在对应字幕。Windows 另跑 `pnpm test:interview:access`、`pnpm test:interview:context`、`pnpm test:speech:aec`。真机听单路、双路、外放插话及句尾，核对重连前后首尾样本。 |
| Windows 断句、自动提问与换模 | `node test/scripts/interview-real-audio-smoke.mjs --model=paraformer --cache=.cache/test-components --all` 以系统 SAPI 合成问题和语气词，Paraformer 的问题组另含固定公开 WAV 短片。改用 `--model=qwen` 时须同时备齐经校验的轻量和 Qwen 组件。专项在受控队列下核对自然终稿、静音断句，以及音频处理到停声后 1,000 ms 且已无积压才发题。重新开口、积压和强制换模分别由 `pnpm test automatic-question speech-endpoint speech-progress speech-switch` 检查。实际进程的换模专项接收 Qwen 组件目录和固定的 16 kHz WAV，可用 `VOXCUE_TEST_COMPONENT_CACHE` 复用 Paraformer 缓存。[音频专项](../../windows/test/scripts/interview-real-audio-smoke.mjs) · [单场断言](../../windows/test/scripts/interview-real-audio-session.mjs) · [换模专项](../../windows/test/scripts/speech-switch-smoke.mjs) · [Qwen 识别 Worker](../../windows/test/scripts/qwen-worker-smoke.mjs) |
| 手机、更新、打包 | `pnpm test remote-connection-tls remote-connection-service mobile-connection mobile-lan-integration remote-interview` 在 Windows 查 TLS 与快照。共享构建后运行 `node ../shared/test/scripts/mobile-bundle-smoke.mjs`。Mac 验证共享手机逻辑，TLS 需先完成平台接入。Windows 用 `pnpm test update-cache updates windows-update-signature` 检查缓存、验签与安装前文件一致性。`pnpm test:updates:native` 使用实际 NSIS 更新器与本地合成下载字节复验下载、损坏及恢复，不执行安装。实际合成 NSIS 包的覆盖安装另有 `pnpm test:installer:upgrade`。Windows 包内助手、Silero 和许可由 Portable 安全检查与两种成品检查核对。Store 身份包在独立 Windows Sandbox 验证本机模块。Mac 按平台签名、DMG、更新 ZIP 及 guest 升级入口验收。 |
| 知识库与面试检索功能 | `pnpm test rag-grounding knowledge-core knowledge-host knowledge-index-store knowledge-reconcile`。本机 Lance 与经校验的 E5 用 `VOXCUE_TEST_RAG_MODEL` 及 `pnpm test:rag:core`。导入原件并建索引，核对检索片段、实际附到用户消息的证据、引用指向的资料与修订。换库、换号、换场及重启后复核隔离与已提交索引。缺组件、坏文档、取消和中断分别核对提示、恢复和健康资料可用性。 |

## 历史检索评估参考

本次 1.3.0 发行按上一节「知识库与面试检索功能」验收，使用临时合成文档核对导入、索引、证据注入、清理及升级后重启。以下资料用于追溯早期实验设计。

Windows `v1.2.3` 标签可复核当时交付的检索源码。原记录中的「最初基线、原 B+、仅改前文选择」属于另一次实验对照。当前仓内没有可直接复现这组三方实验的完整版本映射与对应 300 题金标包，无法据此核实历史命中率或耗时。

仓内可复核的公开资料诊断含两套夹具。从 `windows/` 执行 `node ../shared/test/scripts/rag-unseen-oral-smoke.mjs --public` 时，将 20 份公开主题资料入库，200 个改写口语场景和目标事实留在库外。它检查实际注入的证据，分别统计明确题、追问、无关题及跨项目误引。同脚本加 `--public-transfer` 改用另一套 16 份资料、172 个场景。脚本在 `PUBLIC_SUMMARY` 的 `checks` 与 `allChecksPassed` 字段中输出门槛判定，指标未达门槛本身不会令进程返回失败。两套夹具评价实际注入的证据，均不测试真实 AI 账户的最终回答质量。[公开评估设计](../test/fixtures/rag-public-interview.ts) · [迁移题包](../test/fixtures/rag-public-transfer.ts) · [评分及终态](../test/scripts/rag-unseen-oral-check.cjs)

按原更新记录，历史 300 题方案拟导入三组共 30 份准备文档。300 个测试问题和金标留在库外，每题重置上下文，只添加指定前文。在 228 道可答题上统计所需事实全覆盖率（含 15 道跨文档比较），在 72 道资料不足题上单列误引数及分母。同机同输入记录检索延迟 P50/P95。已查看结果的题包仅用于回归。BGE-M3、标题融合和独立题干向量属于原记录的对照设计。交付路径沿用 E5 和正文分块。[当前检索方案](RAG_ARCHITECTURE.md) · [真实模型回归入口](../test/scripts/rag-core-smoke.mjs)
