> 2026-10-20 Windows 0.5.5：[Windows x64 发行](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.5.5) 提供 EXE、blockmap 和 latest.yml，正式三项保留于 windows/release/0.5.5。资料提案支持逐字段/逐技能勾选、紧凑长内容、待保存标签与独立生成状态；来源问题逐项保留供审阅，仅卡片按钮保存。沿用现有组件和安装/更新信任配置，Mac 0.5.3、全部旧资产及既有 Latest 保留。发行完成后用户另行授权本次私有源码同步，详见 [Mac 逐项检查清单](MACOS_0.5.5_HANDOFF.md)，不再次改写公开资产。下文较早版本的当前状态均按历史理解。

> 2026-10-17：Mac 已新增免费 Sparkle/Ed25519 更新适配与独立 DMG/ZIP 构建。以下 Windows 发行记录与旧“Mac 待实现”描述为历史；Mac 当前流程见 [macos/docs/UPDATES.md](../../macos/docs/UPDATES.md)。测试结果零保留，历史结果路径不作为可用交付物。

> 2026-10-20 Windows 当前发行：[v0.5.1](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.5.1)，包含 Windows x64 安装包、blockmap 和 latest.yml，本地正式三项位于 windows/release/0.5.1。新增可选 Qwen3-ASR 0.6B CPU/CUDA 组件、四句缓冲和实际音频裁剪；Paraformer 与 Qwen 均为 800ms 静音收尾、终稿后 1000ms 自动提交检测。模型沿用独立 models-v1.0.0，不进入安装包。Mac 最新完整发行仍为 0.5.0，macos/ 只读；旧资产、发行及既有 v0.3.1 Latest 保留。此次仅公开发布 Windows 发行文件，不提交或推送私有源码。下文较早的“当前”描述按日期视为历史。

> 2026-10-19 当前发行：[v0.5.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.5.0)同时提供 Windows x64 的 exe、blockmap、latest.yml，以及 Mac 的 DMG、arm64 更新 ZIP、latest-mac.yml。Windows 三项按用户后续单独授权追加；Mac 资产、发行标题/说明、全部旧发行、既有 v0.3.1 Latest 和标签保持。Mac 沿用固定本地代码证书与原 Ed25519 密钥，Windows 仍未配置 Authenticode。共享/Windows 源码按追加授权同步私有 main，macos/ 只读；下文旧版及 Latest 描述属于历史状态。

# Windows 安装与分平台更新

## Windows 0.2.2 修复：安装衔接与卸载选择

首次安装默认位于当前用户程序目录，可通过“选择”更改位置；所选父目录使用 VoxCue 子文件夹。已有安装显示并锁定原路径，选择按钮置灰，更新或覆盖安装的 /D 参数不能改变目录。

Windows 自绘前端通过 customInstallMode 跳过隐藏的用户范围交互，固定为当前 Windows 用户安装；拒绝所有用户安装参数和已检测到的机器范围安装，不提权或替换其他用户程序，收到引擎开始信号后才显示进度。卸载只提供默认勾选的“保留用户数据”复选框，不二次确认；取消勾选后点击卸载，仅在交互卸载成功时清理当前用户的 VoxCue 与旧 ai-interview-copilot 应用数据根，先拒绝重定向目录，失败不显示成功。应用更新与静默卸载保留数据，命令行不能绕过复选框，外部原始文件保持。正式模板的隔离入口为 windows/ 下的 node test/scripts/installer-engine-smoke.mjs。

该修复已替换公开 v0.2.2 的 Windows 三项发行文件，旧 Windows 三项按用户进一步授权删除，Mac 及其他版本保持。已安装 Windows 0.2.2 的用户需手动重新下载覆盖安装；同版本修复不会触发版本升级提示。公开 [README](https://github.com/NCFXZ/VoxCue-releases#readme) 与发行说明已同步更新。本地构建、模型及验证副本使用系统临时目录并结束清理。

## 2026-10-18 Windows / Mac 0.2.2 发行

Windows x64 的 VoxCue-Setup-0.2.2-x64.exe、对应 .exe.blockmap 与 latest.yml 已追加到既有 [v0.2.2](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.2.2)，现为仓库 Latest。Mac 原有 DMG、arm64 ZIP 和 latest-mac.yml 保持原资产；全部旧发行及 Windows 0.2.1 文件保留。两平台继续独立选版，旧 Windows 客户端也可经 Latest 获取本次更新。

Windows 0.2.2 使用主程序风格的自绘安装/卸载窗口，保留 NSIS 后台、静默更新及用户数据保留规则。模型与 Copilot 运行时不进入新包，组件在设置内首次下载、校验并按版本/摘要缓存，升级不重复下载未变化模型。普通退出不启动安装；明确点击安装仍须本地保存成功且没有面试。Windows 安装包未配置 Authenticode 签名。

正式包检查使用 test:installer:artifact；node test/scripts/portable-native-smoke.mjs --installer-stage 在临时 profile 验证实际包内组件、缓存、ASR/RAG 和原生窗口，不运行真实安装器。发布仅上传三项 Windows 发行文件，先核对资产大小/摘要及公开更新清单，再提升 Latest；不改写 Mac 资产或仓库设置。本节之后旧版本的 Latest 和测试记录均为历史事实。

## 2026-10-18 共用更新设置与侧栏提醒

Windows/macOS 共用“设置 → 更新 → 自动下载更新”，默认沿用开启，偏好保存在 VoxCue 应用数据根的 update-settings.json。关闭后启动仍检查更新，只显示提醒；开启后自动下载新发现或当前已发现的更新。关闭开关不取消已开始的下载，可使用下载按钮单独取消。偏好读取失败时关闭自动下载，保存失败显示提示并保留原值；不会因此修改原生更新器的安装策略。

有更新时在侧栏 ChatGPT 可用状态同一行右侧显示下载图标；下载中仅显示主题色圆环，悬停/键盘聚焦仅显示红色取消图标，仍先显示进度至少一秒。侧栏所有状态固定为 32×32 图标操作范围，不显示百分比或取消文字，无障碍进度值与名称保留；设置内仍显示完整百分比和取消文字。下载完成显示重启安装图标，点击复用设置中的保存/确认流程；面试期间不可安装，普通退出不会安装。更新订阅属于主窗口生命周期，设置关闭后进度仍会刷新。

更新 IPC 新增固定的 set-auto-download 操作，仅接受单个布尔值且限定主窗口主 frame；不接受 URL、路径、命令或原生选项。原有分平台选版、摘要/签名校验及 Windows/macOS 原生安装器保持。开发/便携版继续显示更新不可用，不因新入口访问线上发行源。Windows 专属构建与原生安装验证须在其本机执行。

> 2026-10-17 测试保留规则已更新：全部既有测试产物按用户授权清理；下文旧 test/results/test-results 路径仅为历史运行记录，不作为当前可用交付物。当前验证见根 PROGRESS.md。

更新：2026-10-16。Windows x64 使用 NSIS 安装包与 electron-updater 6.8.9；electron-builder 固定 26.15.3。现有源码仓库 `NCFXZ/VoxCue` 保持私有，更新源为独立公开仓库 `NCFXZ/VoxCue-releases`。客户端不需要 GitHub 登录或令牌。

当前正式Windows版本为[v0.2.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.2.0)，已设为Latest。包含本轮面试展示、固定字号/工具栏缩放、截图发送和工作区整理。安装包600,421,158字节，SHA256 `92b8acb151bc83b7eef664804047993d063c6b0921f24e730cdb9c831d3d6aca`；三个服务端资产大小/摘要、公开清单下载和生产分平台选择器逐项核对通过。336项单测与42组桌面/原生/实际安装包回归通过，10分钟语音按用户要求取消且不计入验收。源码已推送私有NCFXZ/VoxCue的main（功能提交45af921），历史Windows/Mac和默认Windows保持。仅Windows x64，未签名、无Mac包；旧发行保留，证据见test/results/release-v0.2.0。

## 最新源码：Windows / Apple Silicon独立发行

本轮用户授权按平台分别查找最新完整正式版，保留全部既有更新交互，不做完整Mac移植。Windows目标x64，Mac仅原生arm64，不支持Intel或Universal更新包。运行时读取公开Releases列表并分页，排除草稿/预发布/未发布/上传未完成及缺少本平台所需文件的发行，按稳定版本号数字排序，与仓库统一Latest、列表顺序、发行标题无关。完整最高候选清单版本/文件/大小/SHA512必须一致，否则检查失败，不静默选择旧版。

允许两个平台放同一Release，也允许分开发布且版本不同，例如windows-v0.1.2与macos-v0.1.0。Tag无需被GitHub设为Latest，但须使用不含斜杠/空白的普通Tag字符（字母、数字、点、下划线、加号或连字符）；预发布开关必须关闭。稳定版本为major.minor.patch，可带SemVer构建元数据，预发布版本不进入本通道。发布文件协议如下：

| 目标                      | 必需文件                                                   |
| ------------------------- | ---------------------------------------------------------- |
| Windows x64               | latest.yml、VoxCue-Setup-<版本>-x64.exe、对应.exe.blockmap |
| macOS Apple Silicon arm64 | latest-mac.yml、VoxCue-<版本>-arm64.zip                    |

Mac DMG可供首次手动安装，但自动更新必须有arm64 ZIP；Mac清单可以包含其他条目，客户端只采用符合该命名的arm64 ZIP。文件名、清单version和内置应用版本须一致；同版本替换文件不会让已安装同版本客户端升级。清单应由构建流程生成，Mac将来构建时按上表设置artifactName；本轮没有添加Mac构建/签名配置。

建议先在草稿上传齐本平台文件并核对，再发布正式Release；两个平台互不要求对方文件齐全。列表每页100条、最多10页，索引每页8MiB、清单128KiB、整次查询45秒；达到上限、API限流、网络失败、没有对应平台完整发行或最高候选清单损坏时显示检查失败，可在原界面重试。不会用令牌绕过限流，也不会回退统一Latest或把旧页结果称最新。下载继续由原生electron-updater执行SHA512及现有签名配置校验，额外packages/外部URL/任意路径不会传给下载器。

本轮完成Windows实际本机下载/哈希和模拟列表的分平台验证；Mac只完成选择/Provider/类型测试，不代表真机启动、签名、下载安装或完整移植通过。macOS自动更新后续还需正确签名及真机验证，参见[electron-builder文档](https://www.electron.build/v26/docs/features/auto-update/)。GitHub列表字段/分页依据[官方REST文档](https://docs.github.com/en/rest/releases/releases)。

**旧客户端过渡：**已经安装的v0.1.1仍使用原全仓库Latest算法。当前v0.2.0已正式发布并设为Latest，旧安装版可在应用内升级或手动安装；升级后按平台独立查找。v0.1.1自身不含新选版算法，以下旧发行记录保留作历史证据。

此前修复包[v0.1.1](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.1.1)，600,425,395字节，SHA256 `a24a76a683f5d4919499ce51917de4a863d1cb06339fde59760110a00d80a128`，当时已通过安装目录/原生/更新下载与哈希回归并公开发布。五项对抗缺陷已修复，生产依赖审计0告警；当时公开API确认latest及三项服务端摘要一致，公开元数据下载核对通过。下面v0.1.0的包与待登录状态均为历史证据，不作为当前下载版本。

2026-10-15 用户已明确授权生成并发布安装包。当前完整 v0.1.0 已重建，安装包678,238,655字节，SHA-256为 `b4ddc5851cd45d7882fdb4dda0bbcde2c0181c61f54709c59a86a894a5dc5674`；三项发行文件与SHA512元数据已核对，实际打包与安装/更新回归通过。公开发行仓库已初始化仅含安装使用README的main，不包含私有源码历史。Release上传等待正常GitHub浏览器登录；发布状态以PROGRESS最新节及test/results/release-v0.1.0为准。安装使用见[INSTALL.md](../../windows/docs/INSTALL.md)。

## 用户行为

- 安装版首次进入主窗口后检查一次更新，按本机自动下载开关决定是否后台下载。设置 → 更新提供当前应用版本、自动下载开关、检查更新、下载进度、失败重试和重启并更新；侧栏提供对应快捷入口。
- 安装只由用户点击“重启并更新”触发。关闭应用不会自动安装。面试进行中或正在预检开场时，主进程拒绝安装；准备安装期间拒绝新的开场请求。
- 重启复用 session:request-close / session:close-ready 的请求 ID 与本地聊天保存握手。存在生成中回复或未保存个人编辑时默认取消；确认后停止生成并等待本地事务完成，失败/超时保留窗口及下载结果。
- 应用数据根统一为 `%APPDATA%/VoxCue`（Mac 为 `~/Library/Application Support/VoxCue`）；新版启动在 session 创建前原子迁移旧目录，成功后旧路径消失，冲突或占用则停止。IndexedDB、localStorage、凭据与既有原件/聊天/记录键及内容保留，更新不删除派生数据。NSIS 明确配置 `deleteAppDataOnUninstall: false`；安装文件与用户资料目录分离。
- 开发启动和现有便携版显示不可用，不连接线上更新源。现有用户首次需要手动安装 NSIS 版，后续版本才可以应用内升级。`Start-VoxCue.cmd` 继续使用现有构建，不自动编译。

## 本地构建

准备本平台依赖和 Windows 开发工具后，执行 `pnpm package:installer`。该命令构建应用，沿用 Packager 依赖复制方式创建独立 `release/installer-stage`，然后由 electron-builder 生成 NSIS；不要求本地模型，模型不进入新包。不会更改或覆盖 `release-smoke` 便携包，也不会发布。

仅以下三类发布文件供上传：

- `release/installer/VoxCue-Setup-<版本>-x64.exe`
- 对应 `.exe.blockmap`
- `release/installer/latest.yml`

`builder-debug.yml`、installer-stage、源码、`.git`、node_modules、测试资料、用户数据、密钥和令牌均不上传。`release/` 已 Git 忽略。

预打包路径跳过 Builder 的应用打包钩子，因此脚本在 staging resources 显式生成固定 GitHub 源的 app-update.yml。普通便携包没有该文件。库负责版本比较、SHA512 与可配置发布者签名校验，不接受 Renderer 提供更新 URL、命令或安装路径。下载失败不会显示“已是最新版本”。

## 发布

用户已创建公开的 `NCFXZ/VoxCue-releases`，只用于二进制分发，不更改源码仓库可见性。空仓库应先初始化仅描述安装与更新的 README，不推送源码历史。发布时在该仓库新建例如 `v0.1.0` 的正式 Release，将上述三个文件全部上传完成后再发布；不要将未完成的文件清单暴露为最新版本。后续先提升应用 package.json 的版本，再重新构建、验证和发布。预发布版本不会自动进入稳定更新。

0.2.0已按用户明确授权提交推送私有源码并公开发布三个发行文件；两仓库权限、历史分支与旧发行保持。安装包未配置Authenticode证书，实际检查为NotSigned；配置签名时须在本机/CI安全提供凭据及win.publisherName，凭据不得写入客户端、源码或版本元数据。

## 验证与恢复

- `pnpm test:updates`：实际主进程/IPC/preload/React/IndexedDB，外部 updater 端口为隔离夹具。覆盖检查/下载/进度/重试、非法调用者、面试阻止、取消、保存失败与成功重启后的草稿及附件恢复。
- `node test/windows/scripts/installer-ui-smoke.mjs updates`：在上述回归后用同一合成 profile 启动实际 NSIS staging，验证安装路径变化仍保留聊天草稿、附件原始字节及正确的应用版本。账户/updater 为夹具，不访问线上服务。
- `pnpm test:updates:native`：真实 NsisUpdater，经本机测试 HTTP 下载实际生成的 NSIS 安装包、拒绝损坏 SHA512、核对完整文件哈希，不安装或发布。
- `pnpm test:installer:upgrade`：独立应用 ID、无快捷方式的合成 NSIS 应用，在有所有权标记的系统临时目录中验证两个版本间的 localStorage、IndexedDB 原件字节及设置文件保留，随后只卸载该测试安装并清理临时内容；不访问真实 VoxCue 用户资料，结果仅输出终端。
- `node test/windows/scripts/packaged-smoke.mjs --installer-stage`：验证实际安装包所用完整目录的真实 Paraformer Worker、utilityProcess、原生组件与既有资料功能。默认命令仍验证原便携包。
- `node test/windows/scripts/installer-ui-smoke.mjs chat-progress`：用实际打包应用及隔离合成账户/HTTP/SSE 验证公开活动、处理用时、资料确认、重试和持久恢复；不访问真实账户或用户资料。copilot和adversarial两组使用同一Windows runner传入对应名称。

故障时在设置重试检查/下载/安装。已安装程序不会因下载失败被替换；本地保存失败不会关闭窗口。没有恢复旧语音实验、改变资料实现或迁移真实数据。
