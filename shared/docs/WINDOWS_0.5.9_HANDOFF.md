# Windows 0.5.9 逐项接续与验收

> 0.5.9→0.5.10 的最终差异、60项验收及完整文件清单统一见 [0.5.10完整交接](WINDOWS_0.5.10_HANDOFF.md)，配套 [Windows逐条查验提示词](WINDOWS_0.5.10_CODEX_PROMPT.md)。下文保留历史过程；已撤回的原生材质、遮挡和动画试验不再执行。

## 2026-10-25 共用界面接续（覆盖下文旧 Mac 展示说明）

- 最新统一圆形/胶囊动画：删除/重置、侧栏下载/取消/重启、结束面试确认均使用共用220ms ease和3px位移参数，整组图标文字交叉淡化；结束面试新增双层内容，不改二次点击结束/三秒取消/系统关闭确认等逻辑。相关控件所有状态去掉可见描边，键盘焦点轮廓和999px端帽保留。Windows本机运行delete-controls、updates-sidebar及interview-chrome，检查双向过渡、原操作保护和减少动态效果；固定圆形或固定胶囊按钮不增加触发行为。

- 最新侧栏更新动画：下载/取消/重启按钮统一删除按钮同款220ms ease宽度与整组内容淡化、3px位移，收起保留999px端帽，默认/悬停/聚焦去掉可见边框。键盘焦点轮廓、进度环、首秒禁止取消、收起侧栏不展开、面试禁装及保存确认保持。Windows运行updates-sidebar，复验浅深色、鼠标/键盘、减少动态效果及高DPI；其他下载按钮不改文字动画。

- 资料保存后的技能更新提示卡片，用户最新要求两端同步居中排列：“补充摘要/联网更新技能”在左、“暂不更新”在右，DOM与键盘顺序一致。Windows本机检查普通/窄窗口中的居中及换行布局。

- 最新用户明确两端推广固定端帽：所有共用删除/重置确认、面试结束确认及下载/更新按钮在胶囊收回圆形期间保持999px圆弧端帽，原宽度/文字动画及触发保护不改，覆盖下文“仅简历摘要”范围。收起侧栏的导航底板和账户卡片统一44×44居中圆角正方形；展开布局、系统侧栏材质及选中标记保持。Windows本机复验delete-controls、interview-chrome及updates-sidebar，检查圆角逐帧、快速切换、减少动态效果、浅深色收起/展开与高DPI。

- 最新删除动画选择覆盖下文试用方案：简历摘要删除按钮恢复原有220ms淡入淡出/位移和宽度过渡，撤回无淡化试用hook及内容层；仅对该按钮固定999px端帽，防止收起过程中50%圆角先变椭圆。Windows复验delete-controls的圆形/胶囊往返、胶囊变宽、快速取消再展开和减少动态效果；其他删除按钮保持原动画。

- 用户确认Mac/Windows同步：面试截图查看器的透明backdrop优先于通用弹窗遮罩，不压暗或虚化后方；面试记录查看器仍保留原遮罩。底部提示去掉描边并与顶部胶囊复用双层底色，减少透明度/高对比度仍实心。侧栏聊天记录删除按钮常态/确认/悬停/聚焦去掉描边，键盘焦点轮廓保留。Windows本机复验interview-chrome、interview-screenshot及delete-controls，检查浅深色、透明背景、提示底色和高DPI；Mac通过不代表Windows视觉通过。

- 用户确认Mac/Windows同步，先仅在简历摘要删除按钮试用新形变动画，其他删除/重置按钮不启用。用户追加取消文字淡入淡出：图标全程显示，文字在能完整容纳时整组显示，收起时立即隐藏文字并开始220ms连续缩回；固定胶囊端帽，不在收起开始时切换50%圆形样式导致椭圆。支持圆形/胶囊往返及胶囊尺寸/确认到忙碌内容变换，不缩放文字、不逐字裁切。中断采样当前帧继续，减少动态效果直接切换，保留二次确认/三秒取消/Esc/失焦/版本与忙碌保护；不人为延迟删除操作。

- 用户确认Mac/Windows同步：待发送截图右上角删除按钮使用独立深灰实心圆形底板、白色×、细浅边及柔和阴影，避免通用低透明按钮底色覆盖导致浅图不可读；悬停/聚焦提亮，20px按钮向内留4px，其他删除逻辑/禁用保护保持。

- 用户确认Mac/Windows同步：删除面试输入区自动回答旁的状态文字组件及专用样式（正在收听/回答/暂停等），保留顶部音频状态、恢复提示和真实采集流程。截图胶囊永久显示图标与“截图”文字，后接快捷键或数量，数量出现时隐藏快捷键，清空后恢复；32px高度保持，宽度按文字增加。

- 用户确认Mac/Windows同步：面试截图按钮常态改为胶囊，图标后显示Mac的⌃S或Windows的Ctrl+S，不显示Control全称；32px高度保持，用户追加有截图/捕获时只显示图标与数量，隐藏快捷键，清空后恢复快捷键；数量态宽76px。补上面试窗口内Control+S，复用同一按钮与既有忙碌/生成/未启用AI/五图上限保护，不注册全局快捷键；弹层打开、收起、输入法组合、重复或额外修饰键不触发。

- 用户确认Mac/Windows同步：顶部独立品牌胶囊匹配面试文字气泡与其面板底色叠加后的实际透明度。复用同一气泡填充与面板颜色/透明度两层，修正相同单层参数在独立胶囊上显得更透的问题；展开/收起一致，24px滤镜、按钮前景/悬停及其他面板保持，无障碍降级仍为实心。

- 用户确认Mac/Windows同步：截图查看器左右翻页按钮和页码胶囊去掉可见描边，尺寸、阴影、禁用箭头淡化及键盘焦点保持；仅面试转写/回答标题与输入框的深色底色混入10%白色，局部防重影底层同步调浅，24px模糊及大背景透视保持。浅色和减少透明度/高对比度保护不变。 Windows本机复验interview-chrome与interview-screenshot，检查滚动文字模糊、禁用/悬停/键盘焦点及高DPI。

- 最新共用紧凑输入：面试输入框默认一行、上下内边距10px/8px，多行增高至六行后内部滚动，清空收回；发送/截图按钮尺寸和材质保持。Windows本机复验interview-chrome和composer-resize，核对自动换行、连续换行/删除、截图附件、缩放、底部和箭头跟随；聊天原两行至十一行行为不变。

- 最新五项共用修正（覆盖下文旧遮挡方案）：记录搜索清除改为轻量圆形图标，清除后保留输入焦点；面试胶囊和输入区使用聊天24px模糊/底色/边框。顶部随正文滚入渐显，删除顶部裁切；底部改为最后36px渐出，返回最新按钮移到输入框外同级层，删除圆形挖空及其光晕。标题/输入区/箭头下方仅局部提供聊天页面底色，使透明窗口CSS滤镜真正模糊内容、不透出清晰重影，大背景继续透视。Windows本机运行interview-chrome（已加入棋盘格像素边缘衰减断言）、web-materials、interview-motion和interview-retry，复验高DPI、浅深色、缩放/输入区变高及减少透明度；不要以CSS字符串相同或Mac截图代替实际Windows效果。

- 新增两端共用标题毛玻璃：个人信息和记录AI回答顶部复用聊天顶部的模糊、底色和滚入渐显，正文延伸至固定标题后方；标题动态测高，首行/末行和滚动定位保留避让。Windows本机运行web-materials、profile-ui及history-branding专项，检查浅深色、960/1280宽度、面板展开/收起、缩放/换行和定位回答；Mac通过不代表Windows界面已验收。 Mac的profile-ui综合脚本在后续面试生成阶段因隔离环境缺知识库模型未完整通过；本机复验须按测试约定准备隔离模型夹具，不读取真实资料或将前段UI通过当作全脚本通过。

- 最终材质：用户已明确Mac/Windows同步，侧边栏之外所有玻璃统一聊天输入框的网页材质（24px blur、125%饱和度及同一底色曲线）。顶栏、标题、气泡、输入框、返回最新、菜单、提示及图片查看控件不再单独实现系统玻璃。局部系统绑定、几何IPC与专属测试已删除；此前Windows局部原生模糊待办取消，不应恢复该端口或启用整窗Acrylic来模糊面试主背景。Windows原有侧边栏系统材质保持，本机验收仍需执行。
- 两块面试大背景保持透明透视；共用正文在标题下18px渐入、输入框前36px渐出，返回最新圆形按钮下方单独遮挡，末行在渐出区之前完全可读。Windows复验高DPI、浅深色、减少透明度、输入区变高、图片翻页禁用、窗口圆角及收起/展开；运行interview-chrome、interview-motion、web-materials和interview-screenshot专项，不把Mac结果登记为Windows通过。

- 最新两端共用动画：整组220ms上移淡出、280ms进入，转写单独左移淡出/进入及回答240ms居中/让位；原生窗口先完成退出再缩小、先扩展再进入。保留草稿/隐藏转写阅读位置，串行切换并尊重减少动态效果；移除圆角clip-path，避免普通裁切轮廓与连续圆角切换。品牌工具栏材质与面试文字气泡一致，浅深色及减少透明度均须复验。Windows本机运行interview-motion-smoke.mjs与interview-chrome-smoke.mjs，检查动画中间帧/终帧圆角、快速点击、隐藏期间新转写、动态切换减少动态效果及关闭窗口；不要将Mac结果代替Windows验收。

- 最新四项已确认两端同步：面试标题/提示条/输入区/返回最新复用聊天材质与透明度；输入框40px连续轮廓、发送36px圆形。回答滚动区延伸到悬浮输入框后，标题/音频恢复/输入区动态测高保护首尾内容，阅读气泡原曲线保留。截图翻页禁用只淡化箭头而不淡化玻璃底板，覆盖下文“保持现状”；工具栏四边留白统一，品牌和其他控件32px。Windows本机复验`interview-chrome-smoke.mjs`（已加入功能矩阵）、`interview-screenshot-smoke.mjs`、`interview-ux-smoke.mjs`，特别是高DPI、输入区变化与音频恢复提示，不将Mac通过记录作Windows验收。

- 用户确认两端同步：面试品牌折叠按钮悬停/键盘聚焦使用中性胶囊底板，前景不随主题色高亮，展开/收起尺寸保持。Mac隔离窗口样式与构建检查通过，Windows本机复核。截图查看器禁用箭头的整层42%透明度导致与页码观感不同，用户明确保持现状。

- 用户最终确认按Liquid Glass之前的滑块映射两端同步：聊天100%、面试100%；面试100对应完整曲线60%，阅读层30%，不直接设完整100。普通材质恢复原底色公式；Mac恢复旧sidebar vibrancy并去掉实心底板，Windows继续其现有Acrylic。撤回12%底色及强制36/24px模糊方案。之后由用户在Windows本机单独调整，保留减少透明度/高对比度保护，不改旧偏好。

- 用户已确认两端下拉菜单高亮同步改为中性灰（20%透明灰色），文字/图标正常前景，不随系统强调色变化。共用样式及浅深/强调色切换断言同步；Mac本机验证，Windows界面仍须本机验收。以后涉及共用设计须先询问两端同步范围。

- Mac图标最新改为SF Symbols，仅Mac构建替换公共图标入口；Windows继续Fluent及共用内部控件和材质，无需SF资源或AppKit。
- 用户补充明确窗口控制保持平台原生：Mac主窗/登录窗恢复系统红绿灯及隐藏标题栏，shared按平台预留空间；Windows继续右上窗口按钮。内部控件仍共用，面试浮窗不增加系统标题栏。
- Mac现在直接使用当前Windows共用UI：圆形/胶囊按钮、Radix菜单、Fluent图标、网页毛玻璃、搜索/开关/进度条；旧原生展示及几何IPC全部撤除，旧方形按钮/菜单基础圆角同步清理。shared页面、业务、截图与RAG保持单一实现。
- 删除shared的原生展示契约、preload及主进程处理器，保留系统窗口/音频/权限/更新与登录契约；Windows重新构建时也必须同步preload/main/renderer，不能混用旧输出。Windows专属源码及锁在Mac未改。
- Mac新构建最低14.2/arm64；既有公开0.5.9资产不改写，此项不是新发行。Windows没有AppKit迁移或额外依赖任务。
- shared材质初始化只在class缺失时写入，避免MutationObserver触发持续requestAnimationFrame循环；新增250ms闲置检查，复现旧实现30次写入后验证修复。删除按钮两态保留同一图标尺寸；减少动态效果仍关闭抽屉/记录面板过渡。
- 默认functional-suite恢复全部共用产品UI测试，并加入使用固定公开临时模型/音频的600秒双路ASR测试；不使用测试专属Mac网页替身或原生菜单IPC stub。截图、删除及单次登录测试直接操作同一页面。
- 本轮Mac验证：895项单测、55组功能矩阵（包含对抗和20轮面试）、15组五档缩放通过；另行600秒语音稳定性通过，最大队列512ms、零错误。共用界面浅深色已目视核对。旧macOS实机和Windows本机验收仍待对应设备，不能登记为已通过。
- Windows本机提示词：阅读本节及PLATFORM_UI.md，保护未提交改动后同步shared源码，在windows目录执行sync:workspace、typecheck、check:architecture、check:workspace、build、test与functional-suite.mjs，串行复验浅深色、960/1280宽度、100–200% DPI、全部菜单/确认删除/个人信息技能操作/面试截图及窗口命中。只用隔离合成数据，不采样硬件或操作真实账户；逐项报告通过、失败与未测，不把Mac结果当作Windows结果，不自动发行。


本文是本次更新的最终交接清单。Windows 开发者须逐项检查源码、实际打包结果与本机行为，不能把 Mac 的通过结果登记为 Windows 通过。复制给 Windows Codex 的完整任务见 [WINDOWS_0.5.9_CODEX_PROMPT.md](WINDOWS_0.5.9_CODEX_PROMPT.md)。

## 2026-10-24 Windows 发行补充

用户在本机接续后追加授权清理、生成 Windows 安装包并补入既有公开 `NCFXZ/VoxCue-releases` 的 `v0.5.9`，同时将核对后的源码上传私有 `NCFXZ/VoxCue` 的 main；覆盖下文接续任务原有的暂不提交/发行限制，仅限本次。Windows 只增加 `VoxCue-Setup-0.5.9-x64.exe`、同名 `.blockmap` 和 `latest.yml`，不覆盖既有 Mac、旧版本或模型资产，不更改当前 Latest、签名身份或真实安装。

Windows 沿用既有 NSIS 和未配置 Authenticode 的发行方式；`package:installer` 只生成本地包，上传在完整负载核对之后单独执行。三项正式文件保留在 `windows/release/0.5.9`，打包暂存和诊断退出清理，不纳入源码提交。固定 Copilot/Codex、系统凭据保护、RAG v7、模型与索引保持；旧 ChatGPT 授权可能需要正常重新登录一次，不清理已有资料和记录。真实安装/升级、物理音频、触控板、多显示器、真实学生 Auto 和最终 LLM 质量不由隔离夹具代验。逐项运行结果仍只在终端/对话报告。

## 1. 基线、范围与状态

- 主实现提交：`a1d79ff42d1719e85817c39a20ac7d304c9536a5`；对比起点：`1630c65614c72ce0b9da3168a0eccec9404acbe4`。发行/交接补充继续进入私有 `NCFXZ/VoxCue` 的 `main`，开始时记录实际 HEAD。
- 版本唯一来源：`shared/package.json` 为 `0.5.9`，根与 Mac 已生成；Windows 的生成配置、平台固定依赖与锁须在 Windows 本机同步。Mac 未改写 `windows/`。
- Mac 0.5.9 已于2026-10-24正式发布，覆盖此前“只上传源码、不发行”；公开[发行页](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.5.9)仅新增 Mac DMG、ZIP、`latest-mac.yml`。保留原 Latest `v0.5.8`、Windows/模型/旧版本资产和真实安装。此项不授权 Windows 发行。
- 以本文最终行为为准。旧交接中的“独立连接 ChatGPT 用量”“软件自选主题色”“本地 Function Calling”“Mac 网页回退”“所有测试暂停”等已被覆盖，不能据旧段落恢复。
- 共用页面、布局、类型、持久化、账户与聊天业务、Local RAG 在 `shared/`。AppKit、Liquid Glass、SF Symbols 和承载实现只在 `macos/`；Windows 继续共享胶囊/圆形与毛玻璃，不移植 Mac 原生实现，也不复制整页。
- Windows 开发时 `macos/` 只读；只能按本文同步 `shared/` 和 Windows 本机适配。保护当前未提交工作，不执行 `reset --hard`、`clean -fdx` 或批量删除缓存/恢复目录。
- 固定模型、`qa-linked-v2`、真实原件/索引、代码签名/凭据/更新身份保持；不创建或轮换密钥，不访问其他软件的登录项，不更改系统安全策略。

## 2. Windows 同步、依赖和包内容（P）

下表每个 ID 都是独立检查项；Mac 交接时 Windows 项均待本机验收，不能沿用 Mac 结果。Windows 本机执行结果只在本轮终端/对话报告，文档保留入口与兼容约定。即使某命令成功，仍需检查它没有漏收本文对应场景。

| ID | 必须检查或完成的内容 | 入口与通过标准 |
| --- | --- | --- |
| P01 | 保护工作区，确认基线和版本 | 记录 `git status`/HEAD；保留本地修改再同步 main，不覆盖别人的工作。 |
| P02 | 补齐两个 Windows 固定平台包 | `windows/package.platform.json`：`@github/copilot-sdk-win32-x64`=`1.0.21`；`@openai/codex-win32-x64`=`npm:@openai/codex@0.164.0-win32-x64`。不得改成最新版。 |
| P03 | 生成 Windows 配置与锁 | 根执行 `pnpm sync:workspace`，在 `windows/` 本机安装并最小化更新锁，再用冻结锁确认可复现；根/Windows 均为0.5.9，保留 shared 的覆盖与 allowBuilds，尤其不启用不使用的 Koffi FFI 构建。不要复制 Mac node_modules/锁/原生二进制。 |
| P04 | 修正 Windows 便携/安装打包依赖 | `windows/scripts/package-portable.mjs` 显式复制固定 `@github/copilot-sdk`、Copilot win32-x64、`@openai/codex` 和 Codex win32-x64，递归依赖仍按现有平台过滤和版本布局处理；不包含未使用的 Koffi FFI。须以本机最终包复核。 |
| P05 | 运行时实际文件可执行 | 包内 Copilot wrapper、runtime.node及邻接资源和 Codex `vendor/x86_64-pc-windows-msvc/bin/codex.exe` 完整；执行路径指向包的真实 unpacked 文件，不能指向开发仓库、asar 虚拟路径或下载另一版运行时。发行补丁已在 shared 的 `copilotRuntimeConnection()` 中固定版本并经官方 `RuntimeConnection.forStdio` 传入真实 unpacked 路径，修复SDK自动发现时对ASAR虚拟路径chmod失败；Windows仍须整包实测，不回退到SDK自动路径。 |
| P06 | 更新旧包级断言 | `windows/test/scripts/packaged-smoke.mjs` 验证固定 Windows SDK/运行时**存在且能启动**，由 `package-runtimes-check.mjs` 从实际 ASAR 加载生产选择器并握手；继续禁止 Mac/Sparkle/SF Symbols、外平台二进制、ONNX Web、模型、密钥及开发/测试文件，不能简单删除全部排除断言。 |
| P07 | 最终包内运行时握手 | 使用临时空账户、无自动登录、无遥测/会话/推理的 Copilot ping，以及网络禁止的 Codex 空账户/伪造令牌 RPC 夹具，实际从 ASAR 加载并启动外部二进制。开发态握手通过不代表包内可执行。 |
| P08 | 正式模型仍外置 | 薄包不内嵌 Paraformer/E5/Qwen，首次下载采用现有固定清单/摘要；后续更新及移动位置复用已验证缓存；测试只使用临时模型副本/下载。 |
| P09 | 依赖边界与平台检查 | `pnpm check:architecture`、`check:workspace`、类型与构建通过；Renderer/preload 不导入 SDK、数据库或平台实现，SDK 仅专用后台适配器使用。 |
| P10 | 旧数据/安装身份保持 | 新运行时不改变现有应用ID、更新身份或凭据保护；旧记录/聊天/附件/个人信息/知识原件及模型索引均保留，真实安装不在自动测试中替换。 |

## 3. ChatGPT、Copilot、额度与请求（A）

| ID | 最终行为 | Windows 验收重点与源码 |
| --- | --- | --- |
| A01 | 登录页同时保留 ChatGPT / GitHub Copilot | `LoginPage.tsx`、`services/auth.ts`、main/preload；两项品牌、禁用/取消/重试及路由正确，不按模型名猜服务。 |
| A02 | ChatGPT 一次托管登录同时用于聊天、模型和额度 | 固定官方 Codex `0.164.0`；`backend/auth/managed.ts`、`chat/codexUsage.ts`、`chat/service.ts`。只使用应用自有会话/工作区，不读取用户 Codex 或其他软件凭据。 |
| A03 | 删除第二套额度授权 | 不出现“连接 ChatGPT 用量”或对应取消操作/独立绑定接口；打开设置和刷新不再打开 OAuth。旧 SIWC 需正常重新登录一次，不能用旧不透明身份冒充可用托管会话。 |
| A04 | 托管运行时只负责授权/账户 RPC | 不创建 Codex 线程、工具、命令或推理任务；原 ChatGPT Responses 流式、公开摘要、附件、网络搜索和资料提案保持。令牌只在主进程与官方进程之间，不进入 Renderer、日志或 URL；生产仍 keyring-only。 |
| A05 | 登录/退出与身份并发保护 | 取消和迟到登录不复活；刷新/模型结果属于同一账户；退出停止进程。Copilot 新增会话代次校验，退出期间及退出后迟到的本地身份/运行时身份读取不能恢复会话或授予访问。 |
| A06 | Copilot 固定 SDK/运行时 `1.0.21` | PKCE 系统浏览器授权；系统凭据库不可用时拒绝明文回退；不借用 gh/PAT/环境令牌。无工具、文件、终端、技能、远程会话等额外能力；仅实际网络搜索能力按既有流程开启。 |
| A07 | Copilot 模型来自实际账户目录 | 保留目录、厂商、effort、权限；Auto 用系统提示携带现有资料 schema，不强制原生 JSON Schema 或只含虚拟 auto 的限制，不强制未获确认的 reasoningSummary。 |
| A08 | Copilot 错误保留可靠诊断 | 保留服务实际状态码/结构化代码；query 类错误不再自行补 HTTP400；不向界面暴露原始凭据/运行时敏感错误。真实学生账户 Auto 是否恢复，需用户另行正常授权验证，合成请求不作保证。 |
| A09 | 账户额度来自官方快照 | `contracts/accountUsage.ts`、`chat/accountUsage.ts`、`chat/quota.ts`、`copilot/quota.ts`；权威预算、参考余额、准入状态分别处理，AI Credits/requests/percent 不混单位；未知/失败不填0。 |
| A10 | ChatGPT 只显示实际额度窗口及套餐 | 双窗口、仅周、多桶优先、未知桶/缺失数据；标题“5小时额度”“每周额度”。套餐来自明确官方元数据，Pro变体兼容，不按窗口数/余额猜套餐。 |
| A11 | 额度卡三行紧凑布局 | 标题一行，左重置倒计时/右剩余百分比一行，底部横条；摘要12px、同字号/字重/颜色；上下间距均4px；剩余不能挤回标题行。 |
| A12 | 重置显示为相对时间 | >=一天 `x天x小时后重置`，>=一小时 `x小时x分钟后重置`，不足一小时只显示分钟；分钟更新、到期等待官方数据，不自动恢复余额或编造日期。 |
| A13 | Copilot 有明确重置时用倒计时代替数量明细 | 先预算元数据，再精确兼容键，缺失时限时查询同账户公开 `account.getQuota`；只采用对应额度键的明确ISO日期。无重置时已用/剩余数量与百分比同排；没有“包含额度”或已用百分比行。 |
| A14 | 刷新骨架与最终卡片结构匹配 | 已知卡片数量、窗口与重置槽保持，但旧数值/进度隐藏；首次未知不虚构窗口；失败/切换清空，浅深扫光和减少动态效果正常。 |
| A15 | 官方用量链接和本地账本边界 | 账户设置删除本机累计token与重置按钮，逐回复用量和后台账本保留；官方链接可鼠标/键盘打开且不关闭设置。缺失/无限/耗尽/参考0/0/错误分开。 |
| A16 | 分类重试与取消 | `application/chatRetry.ts`、`ipc/chat.ts`、`ipc/interview.ts`；最多首次+3次，500/1000/2000ms；仅受控网络/等待/空闲超时/空响应及502/503/504。400/401/403/429、额度、身份、配置、完整性、未知错误不猜文案重试。停止立即中止等待并忽略迟到事件。 |

## 4. 共享界面、音频与平台材质（U）

| ID | 最终行为 | Windows 验收重点 |
| --- | --- | --- |
| U01 | 强调色只跟随系统 | 已删除软件主题色选择、旧偏好读写/监听；明暗主题选择保持，不更改系统偏好。Windows 横条/菜单使用共享控件与系统强调色。 |
| U02 | Mac 官方进度条/菜单只属 Mac | NSProgressIndicator Small/Bar 使用系统推荐自然尺寸，不染色/缩放，不用自绘或 NSLevelIndicator；NSMenu 保留图标/勾选/禁用。Windows 使用共享胶囊横条与菜单，不导入或模拟 AppKit。 |
| U03 | 账户卡片行距与悬停 | 姓名/邮箱间距2px，浅深背景/边框/阴影更轻；鼠标、键盘聚焦和菜单打开提亮，长字段省略，侧栏收起布局正常。 |
| U04 | 退出文字与危险色 | 确认文字统一“退出登录”，前景与删除同款红色，确认/取消行为保持；不会首次点击直接退出。 |
| U05 | 启动页修正 | Logo 保持原透明圆角，drop-shadow沿轮廓，不出现矩形直角；删除底部转圈，VoxCue文字柔和扫光；减少动态效果时静态。 |
| U06 | 个人信息展开才使用细聊天滚动条 | `.preparation-layout.has-personal-info`控制；收起恢复普通粗细/颜色，切页/重载/缩放不遗留。 |
| U07 | 输入框自动测量 | `useTextareaSize.ts`；自动折行、显式换行、粘贴、删除/清空即时更新高度，保留40px连续轮廓、上限、附件与发送布局。Mac投影专属，Windows检查共享输入。 |
| U08 | 两处停止按钮 | 聊天与面试为实心圆形、18px白色方块；按下即取消，等待重试时也可停止，真正禁用状态可区分。 |
| U09 | 音频测试不留结果文字 | 删除“已检测到声音/未检测到声音”及专用状态；运行中音量条和测试/停止保留，结束无空行，错误仍可见。合成麦克风/系统音频两路、切设备与关闭清理保持。 |
| U10 | 开始面试与面试设置标题去图标 | 删除开始标题前播放、设置标题前齿轮及无用占位；不移动正文或恢复旧底框。 |
| U11 | 面试设置顶部固定 | 标题/关闭固定，正文滚入顶部之后；共享覆盖检测和初始避让，Windows用聊天顶部同款毛玻璃，不能随正文滚走或盖住未滚动首行。 |
| U12 | 面试设置后方不压暗/额外虚化 | 透明 backdrop，仅标题自身材质对滚入内容虚化；仍阻止误操作背景，关闭/Esc后恢复焦点与交互。 |
| U13 | 服务标题简化 | `ProviderIdentity.tsx`：仅“ChatGPT”/“GitHub Copilot”，500字重，图标在左；不追加Auto/模型/厂商，保存元数据仍保留。 |
| U14 | 记录/管理顶部和按钮不消失 | 记录返回/导出/AI回答/删除、切路由/开关查看器、个人信息面板、上下滚动均保持位置和可用性；Mac已修复控件继承渐隐和迁移承载问题，Windows验证自身固定层和遮挡。 |
| U15 | 小窗与五档缩放 | 100/125/150/175/200%，浅深色、长标签、窄窗、键盘与减少动态效果；不能仅比较DOM样式，检查实际原生窗口/命中和遮挡。不同物理显示器/真实触控板另标明手工未验范围。 |
| U16 | 技能卡片编辑/删除入口 | 展开技能分区及单项后两按钮可见可用；编辑保存/取消、删除确认/取消、长正文滚动、小窗及重载持久化均需本机检查。Mac专项修复不透明技能卡片遮挡底层AppKit按钮：卡片内使用内容控件，不继承外层玻璃承载；只改`macos/src/contentControls.ts`，Windows继续使用shared现有按钮/布局/存储，不移植此原生修复。 |
| U17 | Mac顶部hover与个人信息边缘修复 | Mac面试工具栏采用AppKit Push over-glass，仅hover显示原生背景/阴影；个人信息按钮跨越滚动边界时保留原生控件并裁切。shared仅扩展受控展示契约/校验：主窗可选clip交集和面试固定工具栏hover类型，旧请求兼容。Windows不移植AppKit样式，继续本机复核个人信息所有按钮的滚动裁切、编辑/删除和工具栏原有行为。 |
| U18 | 删除图标展开尺寸一致 | 共享确认组件两态固定同一图标尺寸：紧凑14px、普通纯图标17px。Mac侧栏收起/展开均由同一AppKit按钮绘制，仅按钮hover显示背景，单独焦点不显示背景；原生trash为对应14pt/17pt且不随标题缩放。Windows继续共用网页控件，不移植AppKit。本机核对侧栏、技能、知识库、记录等删除按钮的展开/取消、图标尺寸、文字容纳及原悬停/焦点显示。 |

## 5. 面试截图全链路（S）

| ID | 最终行为 | 必测场景 |
| --- | --- | --- |
| S01 | 显式捕获草稿才进入本次输入 | 最多5张；捕获中计数胶囊、移除/清空、失败/取消/权限边界；不持续录屏、不在测试中采集真实桌面。 |
| S02 | 显式发送后先归档，再请求模型 | 原始发送字节与缩略图保存到本机 `userData/interview-images-v1`；落盘失败保留草稿并阻止模型请求；未发送草稿仍仅内存。 |
| S03 | 缩略图在问题气泡内部 | 文本与图片共用气泡背景/留白；纯图不显示“截图中的题目”，照片下显示“截图提问”；多图紧凑排布，仍能点击。 |
| S04 | 原图和缩略图分离，记录仅存ID | UUID `.image`/`.preview`；有界大小/格式/数量校验；Renderer不能传文件路径或原始字节写盘，子frame/额外字段/非法ID拒绝。 |
| S05 | 失败/停止/重试保留已发图片 | 重试复用原图，不重新捕获；成功、失败、取消、结束都能在该场记录找到已发送截图。图片不能自动带到下一题、下一场或RAG。 |
| S06 | 两个记录入口均可看原图 | 主阅读区“已发送截图”和AI回答面板；结束/重开记录、应用重启后仍能读取；旧无图记录正常，旧未存原图不能恢复。 |
| S07 | 查看器标题与布局 | 标题“截图”，右上保存紧挨关闭左侧；保存/关闭36px圆形区域、17px图标；无“原始大小”按钮；左右翻页与底部胶囊页码悬浮在图片上，扩大图片显示。 |
| S08 | 平台材质 | Windows三处悬浮控件用shared毛玻璃；Mac是真实Regular及contentView。浅深色前景不反转，箭头/页码可见，原生内容不能零宽。 |
| S09 | 查看器独立生命周期 | body portal避免滚动祖先裁切；关闭按钮/Esc/空白关闭、开关重入、切路由不留下遮罩/裁切或隐藏顶部按钮。默认焦点在关闭，关闭后恢复原焦点。 |
| S10 | 保存只在面试记录可用 | 实时面试隐藏保存且IPC拒绝；记录主窗按ID读取，经所属系统保存对话框导出原始字节；成功SHA256与原图一致，取消不报错，权限/空间错误可恢复。 |
| S11 | 悬停和鼠标区域稳定 | 保存默认只图标，悬停/键盘聚焦显示底板/阴影，不换图标大小/位置；中心及上下左右边缘均可命中，区域外不触发；覆盖背景拖动区域仍正确（查看器no-drag）。 |
| S12 | 图片键盘与指针手势 | 左右键翻页、到首尾不越界；两指像素滑动/惯性平移，捏合/Ctrl+滚轮缩放，行/页单位滚轮缩放；以指针为中心、有界拖拽、双击复位，换图重置。实际Windows鼠标/触控板事件须本机检查，不能用模拟事件推定硬件全部通过。 |
| S13 | 面试查看不压暗后方 | 实时面试透明backdrop，无保存；记录查看保留其模态背景。设置和图片弹层之间切换不串用遮罩。 |
| S14 | 文件缺失、损坏与读取迟到 | 缩略图缺失可读取独立预览，损坏/原图缺失显示可理解错误；快速翻页不显示上一张迟到结果，失败不触发错误模型请求。 |
| S15 | 删除记录清理不再引用的图片 | 保留其他记录共享引用，批次上限100；旧记录删除正常；清理失败单独提示，不假称记录没删除。测试禁止删除真实记录。 |
| S16 | 主进程需要完整重启 | 新IPC及原生绑定不能靠重载Renderer生效；检查历史旧进程产生“无效的截图操作”等错误时先确认运行的构建/进程，不据此恢复旧接口或任意路径保存。 |

## 6. Local RAG、数据与清理（R）

| ID | 最终行为 | Windows 检查标准 |
| --- | --- | --- |
| R01 | 单一 Local RAG | 退役 `ragTools.ts`、本地工具schema/continuation、模式状态/写入接口及设置中的知识库标签页；主侧栏管理、原件、自动索引保留。不是删除ChatGPT/Copilot原生网络搜索。 |
| R02 | 未选知识库严格跳过 | null/省略时不查询知识端口/模型/状态；指定时只查该库。标题生成仍走原始Provider，不意外注入知识资料。 |
| R03 | 固定 v7 来源优先 | `ragQuery.ts`、`ragSelection.ts`、`grounding.ts`；当前问题先判断来源，只有缺少可靠主题依据才借可信历史，不靠补口语关键词或远程问题改写。 |
| R04 | 连续追问链可信边界 | 最多6个可信终稿/已提交问题、每项200字、内部传输1000字；普通文本不能伪造内部历史；AI建议、截图默认问题和转写间断/暂停不跨越。原始问题/生成历史逐字保持。 |
| R05 | 项目隔离、换题和比较 | 标题归属不被正文偶然提及覆盖；明确换题覆盖旧来源，比较按来源分配原始候选预算；同文件近名项目按根隔离，明确陌生项目不借旧资料。不能声称所有比较与陌生文本都识别正确。 |
| R06 | 检索预算保持 | 原始60、候选12、证据最多5、15秒整次期限、48000 UTF-8字节、现有512token编码边界；预算/去重/取消不放宽，不把BM25、RRF和cosine原始分数混加。 |
| R07 | 匹配追问与版本校验 | 根下最多5个匹配追问，同库/文档/根/revision；优先实际命中内容，受控item按预期版本读取；跨根、重复、迟到或更新后的旧证据拒绝。 |
| R08 | 同题重试复用完整成功证据 | 仅当前请求作用域；身份含请求、模型配置、检索词、附件摘要与策略版本，每次核对已提交revision。部分/失败不缓存，变更/停止/结束释放，无跨请求LRU。 |
| R09 | 只读来源视图不迁移索引 | 固定E5 revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`、Q8 CPU、384维与`qa-linked-v2`保持；标题/来源/背景视图按库revision缓存在内存，暖态/冷态成本分开，不能重建真实索引。 |
| R10 | 索引与开场协调 | 面试期间拒绝新导入/重建；所选库正在索引时，开场检查和实际打开均拒绝排队；无库面试不等待知识核心。原件、串行提交/恢复、取消退休保持。 |
| R11 | 故障回退只限可用性问题 | 正常空证据可通用回答；知识可用性失败可partial/unavailable；参数、身份、配置、版本、完整性、模型未就绪与取消仍停止，不能吞掉这些错误。 |
| R12 | 冻结集仅评估，不拿分数调参 | 原120/240为开发回归，160为已知转移集；公开200和172均已观测，不能再称全新独立测试集。记录检索覆盖/无关及含糊误注入/项目污染，不能声称最终LLM答案准确率。 |
| R13 | 已知质量边界如实报告 | Mac复核772场景，公开集门槛未全部达到；仍有漏召回、比较不完整和无关/含糊误注入，保留已接受v7，不为“全绿”修改题目、事实、阈值或补关键词。真实账户/真人面试、长复杂文档/扫描PDF需另外验收。 |
| R14 | 旧数据与清理范围 | 已清理无消费者旧UI样式、重复规则、旧快照变量及两份Finder元数据；保留全部实际动态入口/评估夹具、模型/依赖/现用构建/发行/恢复。历史Mac117占用目录、Windows349跳过目录不重试删除。 |
| R15 | 迁移与重启保护 | 合成旧profile中的聊天、附件、主题、个人资料、知识原件、模型/索引哨兵与host身份保留；旧SIWC要求正常重新登录一次；不能将旧密文被保留等同旧授权仍可直接使用。 |

## 7. Mac 专属修复与发行边界（M）

这些项需要知道平台差异，但 Windows 不能照抄 Mac 实现。

| ID | Mac 0.5.9 内容 | Windows 对应处理 |
| --- | --- | --- |
| M01 | 仅macOS26+ Apple Silicon，直接要求NSGlassEffectView，不提供旧Mac网页回退 | Windows仍保留自身网页材质/原生系统适配；不要删除shared共同实现。 |
| M02 | 官方NSProgressIndicator/NSMenu恢复系统配色，删除软件颜色强制绘制 | Windows使用系统强调色胶囊/菜单，保留键盘/禁用/对比度。 |
| M03 | 截图箭头/计数实际Regular，contentView同帧设非零尺寸 | Windows保证共享毛玻璃和前景可见，不用AppKit。 |
| M04 | 顶部材质渐隐不带走按钮；更新/路由/模态后按窗口几何迁移控件，销毁顶部前迁出 | Windows按本机固定层/遮挡验证，保留相同共享布局。 |
| M05 | 保存始终复用同一个NSButton；边框布局固定，公开悬停跟踪用正确窗口坐标，不模拟按下 | Windows保持36px命中、17px图标与悬停无位移。 |
| M06 | 面试设置复用聊天Regular/原生标题，并按连续轮廓裁切；不移动面试窗口红绿灯 | Windows使用共享固定标题和毛玻璃，测试滚动/关闭/焦点。 |
| M07 | Mac package加入固定Copilot/Codex主包和darwin-arm64包，并以最终ASAR实际握手发现/修复Copilot虚拟执行路径 | Windows执行P02–P07，必须加入win32-x64并验证真实可执行路径。 |
| M08 | 正式DMG/更新ZIP/清单使用原证书与Ed25519；最低26.0，保留旧Latest | Windows暂不发布；正式发行需后续单独授权。Mac包不是Windows包的验收证据。 |

## 8. 本轮已验证与尚未验证

Mac及共用逻辑已执行：89个文件/902项单测；类型、边界/循环、工作区与完整构建；29组功能/原生矩阵加官方进度条专项；五档Mac缩放；Qwen CPU/Metal、实际Worker/AEC/重采样、模型切换/失败/取消、临时签名应用/离线缓存复用及实际进程/模型映射释放；截图真实AppKit中心/边缘命中、浅深实际图像与悬停坐标；Copilot退出竞态先复现后修复并重测登录。正式Mac包通过签名/摘要、DMG、实际AppKit、离线模型、ASAR双运行时和Sparkle生产ZIP校验；发布后实际应用选中公开0.5.9、认证清单、完整下载更新ZIP并校验SHA512，未替换真实安装。精确资产摘要见 [Mac更新说明](../../macos/docs/UPDATES.md)。

尚未代表通过：Windows UI/DPI/原生集成/打包/安装升级；真实账户授权与推理/学生计划/远端服务可用性；物理麦克风/系统声音、真人识别质量、物理多显示器或真实触控板；RAG全部质量门槛。自动测试不访问真实账户/资料、不采样硬件，不通过修改用户系统设置放行。

## 9. Windows 顺序执行命令

以下从仓库根运行；先检查脚本仍符合隔离边界。若本机脚本还是旧断言，先核对预期并最小修正，不删除失败断言、跳过矩阵或降低阈值。GUI/原生全部串行。

```powershell
# 保护未提交工作、同步main，并完成P02的平台固定依赖后
pnpm sync:workspace
# 在windows/安装所需固定依赖并审阅锁；之后用冻结锁确认可复现
pnpm --dir windows install --frozen-lockfile
pnpm typecheck
pnpm check:architecture
pnpm check:workspace
pnpm test
pnpm build
pnpm test:copilot:runtime
pnpm test:chatgpt:usage:runtime
pnpm test:chatgpt:single-login
pnpm test:copilot
pnpm test:windows:functional
pnpm test:windows:regression
pnpm test:ui:dpi
pnpm test:portable:native
pnpm test:installer:isolated
```

P03首次补依赖时冻结锁可能明确不匹配；应在Windows本机仅生成必要锁变更，再执行上面冻结安装，不要用非冻结安装偷偷升级无关依赖。`test:installer:isolated`只生成并检查自有临时负载，不运行生产安装器；真实安装/发布命令不是本次默认操作。旧 `test:audio:native`、真实权限提示/采样或生产安装器不得未经核对直接运行。

冻结RAG四组在Windows本机各串行复核一次，结果仅终端/对话，不修改题集/策略，不要求全命中；缺少必要条件时如实登记阻塞：

```powershell
cd windows
node ../shared/test/scripts/rag-unseen-oral-smoke.mjs
node ../shared/test/scripts/rag-unseen-oral-smoke.mjs --transfer
node ../shared/test/scripts/rag-unseen-oral-smoke.mjs --public
node ../shared/test/scripts/rag-unseen-oral-smoke.mjs --public-transfer
```

测试用自有合成账户/资料/捕获和固定公开临时模型/音频；如用户明确指定正式缓存，只读认证后复制至临时根，绝不直接对正式根执行组件status/download/remove。临时profile、数据库、模型、截图和探针退出清理，不保存包含真实资料/凭据的日志或截图；保留必要源码/测试修改与简洁交接结论。

## 10. 逐项验收的交付要求

Windows 本机接续适配入口：固定平台包在 `windows/package.platform.json`，配置由根 `sync:workspace` 仅生成本平台。包级检查包含 Copilot 邻接 DLL/Node 绑定、Codex EXE、精确版本和真实 unpacked 执行路径；Copilot 仅 stdio，Koffi 不构建、不入包。`test:portable:native` 与 `test:installer:isolated` 均纳入两个包内运行时握手，不执行生产安装器。

截图原生命中补充入口：在 `windows/` 串行执行 `node ../shared/test/scripts/interview-screenshot-smoke.mjs --native-hits`，使用同一合成图像/临时导出，检查 Windows 原生 HWND 下的中心/四边命中、HTCLIENT/no-drag、36px/17px 几何、浅深色图标稳定和区域外悬停。真实保存对话框及物理触控板仍须与合成对话框端口/事件区分。

共用旧夹具按当前行为适配：普通登录使用托管运行时合成取消/拒绝端口；未知错误不凭文案重试；已删除的知识库设置分类不恢复；官方用量链接用次要字号；账户卡菜单打开使用自身悬停色；新窗口读取同一合成系统强调色。额度布局等待原生实际内容尺寸，DOMRect 按 Chromium 的 1/64 CSS 像素布局单位核对精确 4px；不更改布局值或产品重试策略。Windows 迁移夹具要求旧 SIWC 重新登录，同时逐字节保留旧密文、host 身份、原件、附件和模型/索引哨兵。

Windows 记录页滚动条不得伸入固定工具栏。网页材质沿用正文向上滚入材质的布局，单独将垂直轨道上边距绑定 `--record-toolbar-height`；Mac 原生路径保持。`node test/scripts/history-scrollbar-smoke.mjs` 以实际滑块像素、滚动后的固定工具栏和导出按钮命中检查五档缩放、宽窄窗、浅深色及回答栏开关，预览仅在交互临时会话保留。

1. 对P/A/U/S/R/M每个ID报告 `通过 / 失败 / 阻塞 / 不适用`，附实际命令或检查动作；“不适用”必须说明平台理由，不把未跑写成通过。
2. 失败先判断产品、固定依赖打包、旧夹具还是环境阻塞；保留复现方式，按当前范围修复并定向重测，相关范围再回归。不得为绿灯删除检查、替换题目/事实、提高容错或升级SDK/模型。
3. 单独汇总 Windows 功能/UI、原生/打包、真实账户/硬件未验和RAG质量评估；报单测文件/项数、矩阵/DPI实际执行项及失败项，不照抄Mac数字。
4. 列出修改文件、固定依赖与锁差异、数据兼容风险和剩余待办。先不提交推送、不发布Windows安装包、不修改任何Latest/旧资产/真实安装；等待用户后续指示。

## 附录：本轮源码改动全清单

下列清单由 `git diff --name-status 1630c65614c72ce0b9da3168a0eccec9404acbe4..a1d79ff42d1719e85817c39a20ac7d304c9536a5` 生成，共183项；A新增、M修改、D删除。用于检查有没有漏掉实现、契约或测试，不能以清单中存在文件代替行为验收。发行跟进的文档、包级探针/适配另见main后续提交。

```text
M	AGENTS.md
M	PROGRESS.md
M	README.md
M	macos/electron/presentation.ts
M	macos/native/ContentControls.mm
M	macos/native/ScrollChrome.h
M	macos/native/ScrollChrome.mm
M	macos/package.json
M	macos/package.platform.json
M	macos/pnpm-lock.yaml
M	macos/pnpm-workspace.yaml
M	macos/scripts/build-sidebar-glass.mjs
M	macos/scripts/package-app.mjs
M	macos/src/MaterialSurface.tsx
M	macos/src/contentControls.ts
M	macos/src/interviewGlass.ts
M	macos/src/menuGlass.ts
M	macos/src/scrollChrome.ts
M	macos/src/sidebarGlass.css
M	macos/test/fixtures/SidebarGlassProbe.mm
M	macos/test/scripts/components-smoke.mjs
M	macos/test/scripts/content-controls-check.mjs
M	macos/test/scripts/icons-smoke.mjs
A	macos/test/scripts/image-save-hit-check.mjs
M	macos/test/scripts/login-controls-check.mjs
M	macos/test/scripts/package-smoke.mjs
A	macos/test/scripts/progress-controls-check.mjs
M	macos/test/scripts/sidebar-glass-smoke.mjs
M	macos/test/scripts/user-data-smoke.mjs
M	package.json
M	shared/docs/ARCHITECTURE.md
M	shared/docs/COMPONENTS.md
M	shared/docs/PLATFORM_UI.md
M	shared/docs/RAG_ARCHITECTURE.md
M	shared/docs/WINDOWS_0.5.7_HANDOFF.md
A	shared/docs/WINDOWS_0.5.9_HANDOFF.md
M	shared/docs/WORKSPACE_CLEANUP.md
A	shared/electron/application/chatRetry.ts
M	shared/electron/application/interviewContext.ts
M	shared/electron/application/knowledge.ts
A	shared/electron/application/providers.ts
M	shared/electron/application/rag.ts
M	shared/electron/application/ragContext.ts
A	shared/electron/application/ragDiagnostics.ts
A	shared/electron/application/ragQuery.ts
A	shared/electron/application/ragSelection.ts
D	shared/electron/application/ragTools.ts
A	shared/electron/backend/auth/managed.ts
M	shared/electron/backend/auth/service.ts
A	shared/electron/backend/chat/accountUsage.ts
A	shared/electron/backend/chat/codexUsage.ts
M	shared/electron/backend/chat/errors.ts
M	shared/electron/backend/chat/ports.ts
A	shared/electron/backend/chat/quota.ts
M	shared/electron/backend/chat/responses.ts
M	shared/electron/backend/chat/service.ts
A	shared/electron/backend/copilot/auth.ts
A	shared/electron/backend/copilot/errors.ts
A	shared/electron/backend/copilot/quota.ts
A	shared/electron/backend/copilot/runtime.ts
A	shared/electron/backend/copilot/service.ts
A	shared/electron/backend/copilot/storage.ts
A	shared/electron/backend/interview/images.ts
A	shared/electron/backend/knowledge/grounding.ts
M	shared/electron/backend/knowledge/host.ts
M	shared/electron/backend/knowledge/process.ts
M	shared/electron/backend/knowledge/service.ts
M	shared/electron/backend/knowledge/types.ts
A	shared/electron/contracts/accountUsage.ts
M	shared/electron/contracts/auth.ts
M	shared/electron/contracts/chat.ts
M	shared/electron/contracts/desktop.ts
A	shared/electron/contracts/interviewImages.ts
M	shared/electron/contracts/knowledge.ts
A	shared/electron/contracts/retrievalContext.ts
M	shared/electron/contracts/speech.ts
M	shared/electron/ipc/chat.ts
M	shared/electron/ipc/interview.ts
A	shared/electron/ipc/interviewImages.ts
M	shared/electron/main.ts
M	shared/electron/preload.ts
M	shared/electron/screenshot.ts
M	shared/package.json
M	shared/pnpm-workspace.yaml
M	shared/src/App.tsx
M	shared/src/assets/README.md
A	shared/src/assets/copilot.svg
M	shared/src/components/AudioCheck.tsx
M	shared/src/components/FloatingInterview.tsx
M	shared/src/components/HistoryDetail.tsx
A	shared/src/components/InterviewImageCanvas.tsx
A	shared/src/components/InterviewImages.tsx
M	shared/src/components/InterviewSettingsPanel.tsx
M	shared/src/components/LoginPage.tsx
M	shared/src/components/PreparationPage.tsx
M	shared/src/components/ProviderIdentity.tsx
M	shared/src/components/SettingsDialog.tsx
M	shared/src/components/Sidebar.tsx
M	shared/src/components/StartupScreen.tsx
M	shared/src/components/UsagePanel.tsx
M	shared/src/components/ui/modal.tsx
A	shared/src/components/useTextareaSize.ts
M	shared/src/platform/chromeGeometry.ts
M	shared/src/platform/webMaterials.css
M	shared/src/services/auth.ts
M	shared/src/services/contracts.ts
M	shared/src/services/history.ts
M	shared/src/services/historyPresentation.ts
A	shared/src/services/imageViewport.ts
M	shared/src/services/providers.ts
M	shared/src/stores/chatConnection.ts
M	shared/src/stores/history.ts
M	shared/src/stores/interview.ts
M	shared/src/stores/knowledgeIndex.ts
M	shared/src/styles.css
M	shared/src/systemAccent.ts
M	shared/test/README.md
A	shared/test/fixtures/rag-baseline.ts
A	shared/test/fixtures/rag-colloquial.ts
A	shared/test/fixtures/rag-oral-transfer.ts
A	shared/test/fixtures/rag-public-interview.ts
A	shared/test/fixtures/rag-public-transfer.ts
A	shared/test/fixtures/rag-quality.ts
A	shared/test/fixtures/rag-unseen-oral.ts
M	shared/test/scripts/chat-lifecycle-smoke.mjs
M	shared/test/scripts/chat-response-smoke.mjs
A	shared/test/scripts/chatgpt-single-login-smoke.mjs
A	shared/test/scripts/chatgpt-usage-runtime-smoke.mjs
M	shared/test/scripts/check-architecture.mjs
A	shared/test/scripts/composer-resize-smoke.mjs
M	shared/test/scripts/continuous-corners.mjs
A	shared/test/scripts/copilot-login-smoke.mjs
A	shared/test/scripts/copilot-runtime-smoke.mjs
M	shared/test/scripts/electron-smoke.mjs
M	shared/test/scripts/functional-suite.mjs
M	shared/test/scripts/install-ui-account.mjs
M	shared/test/scripts/interview-retry-smoke.mjs
M	shared/test/scripts/interview-screenshot-smoke.mjs
M	shared/test/scripts/interview-usage-offline.mjs
M	shared/test/scripts/interview-ux-smoke.mjs
M	shared/test/scripts/knowledge-host-smoke.mjs
M	shared/test/scripts/login-smoke.mjs
M	shared/test/scripts/offline-electron-entry.mjs
M	shared/test/scripts/provider-ui-smoke.mjs
A	shared/test/scripts/rag-colloquial-check.cjs
A	shared/test/scripts/rag-colloquial-smoke.mjs
M	shared/test/scripts/rag-core-smoke.mjs
M	shared/test/scripts/rag-ui-smoke.mjs
A	shared/test/scripts/rag-unseen-oral-check.cjs
A	shared/test/scripts/rag-unseen-oral-smoke.mjs
A	shared/test/scripts/rag-validation-smoke.mjs
M	shared/test/scripts/settings-smoke.mjs
M	shared/test/scripts/typography-smoke.mjs
M	shared/test/scripts/ui-ux-smoke.mjs
M	shared/test/scripts/web-materials-smoke.mjs
M	shared/test/unit/accent-contrast.test.ts
A	shared/test/unit/account-quota.test.ts
A	shared/test/unit/account-usage-store.test.ts
A	shared/test/unit/account-usage-ui.test.tsx
M	shared/test/unit/adversarial-regression.test.ts
M	shared/test/unit/architecture.test.ts
M	shared/test/unit/chat.test.ts
A	shared/test/unit/chatgpt-quota.test.ts
A	shared/test/unit/codex-usage-runtime.test.ts
A	shared/test/unit/copilot.test.ts
M	shared/test/unit/desktop-contract.types.ts
M	shared/test/unit/desktop-ipc.test.ts
A	shared/test/unit/history-images.test.ts
M	shared/test/unit/history-presentation.test.ts
A	shared/test/unit/image-viewport.test.ts
A	shared/test/unit/interview-images.test.ts
M	shared/test/unit/interview-screenshot-store.test.ts
M	shared/test/unit/knowledge-coordinator.test.ts
M	shared/test/unit/knowledge-core.test.ts
M	shared/test/unit/knowledge-index-store.test.ts
A	shared/test/unit/managed-auth.test.ts
M	shared/test/unit/personal-info.test.ts
M	shared/test/unit/providers.test.ts
A	shared/test/unit/rag-accuracy.test.ts
A	shared/test/unit/rag-grounding.test.ts
A	shared/test/unit/rag-reliability.test.ts
D	shared/test/unit/rag-tools.test.ts
M	shared/test/unit/rag.test.ts
```

### 发行跟进补充文件

- `shared/electron/backend/copilot/runtime.ts`：新增固定平台包版本校验及真实unpacked执行路径，使用官方stdio连接，不改SDK/模型/账户隔离。
- `shared/test/scripts/copilot-runtime-smoke.mjs`：开发态握手也复用生产路径选择，避免测试绕开修复。
- `macos/test/scripts/package-runtimes-smoke.mjs`：从最终ZIP的实际ASAR加载SDK，以无登录Copilot ping和断网空Codex账户RPC检查两个进程；曾真实复现ASAR chmod失败，修复后再验，不以文件存在代替可启动。
- 本次交接/任务/发行说明：`WINDOWS_0.5.9_HANDOFF.md`、`WINDOWS_0.5.9_CODEX_PROMPT.md`、`RELEASE_0.5.9.md`；AGENTS、README、PROGRESS、Mac更新和测试说明同步最新授权及实际状态。正式DMG/ZIP/清单不进入私有源码提交。
