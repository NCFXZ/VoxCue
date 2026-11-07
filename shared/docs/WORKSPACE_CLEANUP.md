## 2026-11-07 Windows Store 1.0.1 重包清理

本轮构建及安装消费者结束后，复核真实绝对路径、全部祖先/内部无链接及文件排他访问，删除 `windows/release/store-stage`、`windows/release/store/resources` 和 `windows/release/store/builder-debug.yml`。共移除 8,047 个生成文件，逻辑大小 1,617,879,213 字节；四个现存 APPX 清理前后长度及修改时间一致。正式 1.0.1 APPX、全部旧发行/恢复包、NSIS 资产、模型依赖、凭据、固定缓存及 Mac 全树继续保留。

## 2026-11-07 Windows 1.0.0 清理边界

复核根、共享和 Windows 源码、静态/动态入口、Worker/preload、构建打包及测试调度消费者，未确认可独立删除的闲置业务代码。不为清理数量移除有效入口；现用依赖、固定公开测试缓存和工具保留，Mac 全树及历史明确跳过目录不清理。

本轮构建与验证消费者结束后，核对真实绝对路径、owner/task、全部祖先和内部链接及活动进程/文件占用，删除 Windows 的 installer-stage、store-stage、store/resources、.cache/installer-ui、两份 builder-debug.yml，以及本轮固定 0.5.3 服务端参考临时副本。共移除 16,503 个生成/临时文件、2,501 个目录，逻辑文件大小 3,235,902,115 字节；未触碰独立服务端现有 0.5.5 工作区。

正式 NSIS 三项分别保留在 windows/release/installer 和 windows/release/1.0.0；Store 1.0.0 APPX、0.6.9 正式 APPX 及任务栏调整前副本继续保留。上述九项当前正式/恢复资产的长度和修改时间在清理前后保持一致。其他发行恢复基线、原件、依赖、SDK、凭据和固定公开模型/音频缓存保留；按用户要求交付的截图只留在系统临时目录，不进入源码 Git。

## 2026-11-05 Mac 0.6.9 清理边界

本轮复核源码静态引用、动态类名、平台装配、Worker/preload、构建打包与按名称装配的测试入口，未确认可独立删除的闲置业务模块或弃用专项。无静态入边的入口、声明、平台适配器和动态图标替换均保留，不为清理数量删除功能。根、shared 与 Mac 顶层未发现本轮可删的重复源码或临时文件；Windows 全树及历史明确跳过目录保持只读/保护。

现用依赖、固定公开模型/音频缓存、工具、原始素材、签名/凭据助手/更新身份、全部正式发行与恢复基线保持。新合成资料、数据库、截图和运行副本仅使用 owner 系统临时目录，并由对应测试生命周期结束清理。固定服务端参考只读使用，本轮自建副本在最后使用后核对真实路径、归属及占用再清理；不触碰旧参考或真实资料。

本轮正式 Mac 三项资产仅归档于 `macos/release/0.6.9`，见 [Mac 发行索引](MACOS_0.6.9_RELEASE.md)；不进入源码 Git。打包与测试暂存按各自生命周期清理，不移除现用构建或历史发行。

## 2026-11-05 Windows 0.6.9 清理边界

本轮核对共享与 Windows 源码声明、静态引用及平台动态装配、Worker/preload、构建打包和测试矩阵消费者，未确认可独立删除的闲置业务模块或弃用专项。按 suite 名动态装配的测试及 `shared/test/temp.ts` 继续保留，不为清理数量移除业务、兼容读取或有效验证入口。

旧 ChatTools 独立菜单的唯一 JSX 生产者已移除；核对共享、双端前端、动态类名、构建与测试引用后，删除 `styles.css` 的 `.tool-menu-check`、两块 `.model-menu`、`.model-menu-label` 及其子元素共五个无消费者样式块。新模型/档位组合入口使用 `reasoning-effort-popup`；仍使用的模型、附件、验证码与 Mac 原生侧栏拖动样式保留。已被修正版替代的两个自有旧扫光动图按精确路径与独占句柄核对后清除，当前用户请求的修正版动图留在系统临时交付目录。

0.6.9 三项正式资产已归档于 `windows/release/0.6.9`；最终 ASAR 安装暂存保留为下轮比对基线，0.6.8 及历史正式资产与恢复基线保持。归档摘要与公开资产回读核对后，逐项复核精确真实路径、当前用户归属、祖先及目标无链接/重定向、文件独占访问，已清除安装器输出的三项重复资产与 builder-debug.yml，以及 installer-ui 的四个可重建文件；本轮两组临时界面审查截图也在目视完成后清理。一次性发布工具、辅助脚本、临时授权截图和匿名回读副本已在最后使用后按同样边界清理，系统 GitHub 凭据未触碰；用户请求的修正版动图继续保留。现用依赖、模型、索引、工具、原始素材、凭据及更新身份、历史跳过目录和独立服务端保持保护，不清理活跃或归属未知目录，`macos/` 全树只读。

## 2026-11-03 Mac 0.6.8 接续清理

核对前后端未使用声明、静态引用、平台动态装配、Worker/preload、构建打包与测试消费者；没有确认可独立删除的闲置业务模块或弃用专项。`shared/test/temp.ts` 仍由有效单测消费，临时验包入口仍有本机发行消费者，继续保留。冻结锁离线安装由 pnpm 整理本平台安装图，不手工拆删厂商依赖，不升级依赖/SDK/模型。根/shared/Mac 顶层未发现需清除的重复源码或 Finder 元数据，不重试历史跳过目录。

Windows 全树、旧 shared/server、原始素材、现用模型/索引/工具、签名及凭据/更新身份、全部历史发行与恢复基线保持。新合成账户、资料、数据库、运行副本与可选截图仅在本轮 owner 系统临时目录，结束清理；固定公开模型/音频缓存经摘要认证后复用。0.6.8 正式三项单独归档，不进入源码 Git。

本轮自建的临时截图目录、固定 0.5.3 服务端参考 checkout 和未使用的 GitHub CLI 副本已清理；删除前复核精确真实路径、当前 UID、无链接与独立 inode、无其他进程占用及逐文件独占锁。服务端参考副本另核对固定提交和干净状态，旧 `shared/server` 不动；当前正式归档与公开缓存继续保留。

## 2026-11-03 Windows 0.6.8 清理边界

先核对静态/动态入口、测试矩阵、Worker/preload 与构建消费者；未使用声明检查配合入口审查，保留现用业务、兼容路径及全部有效测试。测试流程按功能矩阵完整保留，仅合并调度与按需准备资源，不按文件数量删减功能。

窗口比例改为按高度保留后，移除已无消费者的旧宽度比例辅助函数。RAG 实现、专项与架构说明沿用 0.6.7。

核对精确绝对路径、工作区边界、各级无重定向及逐文件独占读取后，删除 `windows/.cache/installer-ui` 的四个可重建中间文件；`prepareInstallerUi` 会在实际消费前重新生成。`windows/release/installer` 中旧 0.6.6/0.6.7 安装文件、blockmap 和 latest.yml 仅在与各版本正式归档逐字节 SHA256 一致时清除，正式归档不动。Mac 全树、独立服务端、历史明确跳过目录、原始素材、现用依赖/固定模型/工具、身份凭据和恢复基线继续保护。合成 profile、数据库、运行包及结果只在 owner 系统临时目录，退出清理。

0.6.8 发行三项归档并完成线上回读后，以同样的路径、无重定向、无执行占用和逐文件独占句柄核对，清理本轮重新生成的四个 installer-ui 中间文件、与正式归档摘要相同的三个 installer 输出及 builder-debug.yml。正式 `windows/release/0.6.8` 三项和当前最终 ASAR 暂存基线保留；本轮自有系统临时辅助脚本、公开元数据副本和截图在交付复核后删除，不清理归属未知目录。

## 2026-11-02 Mac 0.6.7 接续清理

按静态引用图、平台动态装配、Worker/preload、构建打包和测试消费者核对，现用业务及兼容路径继续保留；退役故事素材、手动联网入口、旧引导卡及 token 展示代码沿用共享基线的删除状态。前后端未使用声明检查辅助确认，不按文件数量删除功能。

核对精确路径、各级无重定向、owner 普通文件及独立 inode、lsof 无占用与独占文件锁后，删除根目录可重建 Finder 元数据。权限资源重建后，仅清理本轮新产生、经路径/owner/生成标记/lsof核对无占用且由现用宿主替代的旧开发宿主副本；既有宿主历史目录不遍历清理。Windows 全树、旧 shared/server、原始素材、现用依赖/模型/工具、签名和凭据身份、全部发行/恢复基线及历史跳过目录保持；本轮合成资料、数据库、截图和验包暂存只在系统临时目录，结束清理，固定公开模型/音频缓存保留。

## 2026-11-02 Windows 0.6.7 清理边界

本轮合并远端 Mac 0.6.6 收尾，保留当前 Windows UI/功能；Windows 不编写 macos 树。确认新故事素材有实际消费者后，删除不再引用的 interview-landscape.jpg、interview-story-notebook.jpg、interview-story-path.jpg；清除已撤回的手动联网/旧引导卡、技能范围中文识别与 token 展示实现，保留兼容历史数据的字段和有效测试。前后端未使用声明检查与静态/动态入口审查配合，不按删除数量裁剪业务。

核对精确绝对路径、祖先/文件无重定向及逐文件独占访问后，清理 windows/.cache/installer-ui 的 brand.png、frontend.manifest、installer.nsh、VoxCue.Setup.UI.exe 四个可重建中间文件；prepareInstallerUi 在正式构建使用前完整生成，临时验包使用 owner 系统临时目录独立重建。现用依赖、公开模型/音频、原始素材、固定工具、全部发行/恢复基线、真实资料/凭据及历史明确跳过目录继续保护，不记录测试成绩或保存运行产物。

## 2026-10-31 Mac 0.6.6接续清理

当前Mac仅写客户端根/shared/macos，Windows全树和服务端参考只读。源码静态入边与平台动态装配、Worker/preload、构建/打包及测试入口逐项核对；无静态入边文件均为现用入口，保留业务与兼容读取。同步Mac清单时删除已退役speech-model-check对应命令，不恢复已删除测试源码。

仅清理根、shared、macos三个可重建Finder元数据文件；删除前逐项核对真实路径、普通文件/UID/独立inode、lsof无占用及文件锁。固定公开模型/音频缓存按目录和摘要校验后复用，执行副本和合成资料退出清理；当前依赖、工具、模型、签名/凭据/更新身份、全部历史发行、恢复基线和历史跳过路径保持保护。实际测试仅使用固定0.5.3服务端提交的系统临时只读副本，不替换旧shared/server。

## 2026-10-31 0.6.6接续清理

本轮Windows仅写客户端根/shared/windows，Mac和独立账号服务只读。按静态入边、动态平台/Worker/preload、构建/打包、测试矩阵和人工专项入口核对；前后端未使用声明检查不能取代入口审查，现用业务与兼容读取不为删除数量而移除。

删除退役的`shared/test/scripts/speech-model-check.mjs`及Windows的`speech-device-check.mjs`、`speech-reliability.mjs`、`speech-restart-native.mjs`，同步删除对应命令。它们依赖退役本地语料路径、旧控制器内部结构、硬件采样或工作区结果写入；现行公开音频/真实Worker、合成故障与长稳矩阵继续维护。有效的显式硬件专项及其播放夹具仍有消费者，保留。删除旧`--native-capture`桌面诊断分支和无生产消费者的captureInterviewScreen薄导出，改用严格owner遮罩的原生探针和实际截图入口。删除预览的停顿/回滚代码、参数及旧断言，现用提示为可见1秒后单次向下滚动。

按新AGENTS规则，固定公开测试模型/音频保留在本平台`.cache/test-components`与`.cache/test-public-audio`，按固定摘要验证、独立复制后使用，不提交Git；profile、数据库、截图、运行包和结果仍在owner系统临时目录并退出清理。除下述定向构建安全调整外，现用依赖/锁、构建、固定工具、全部正式发行/恢复基线、真实资料与凭据、历史明确跳过目录保持。

构建依赖审计中确认glob/minimatch通告后，统一到已使用的现代ASAR/Universal链，移除未使用的Squirrel安装器和EJS CLI jake链；由pnpm冻结安装管理依赖删除，不手工拆删厂商包。只定向更新Windows构建锁与共享策略，运行时依赖图不变，Mac锁仍由Mac本机生成。具体版本和逐项核对见0.6.6交接C052–C056。

## 2026-10-30 Mac客户端0.6.5接续清理边界

当前Mac接续只写客户端根/shared/macos，windows全树与两份服务端参考只读。逐项审查静态/动态平台、Worker/preload、构建打包和测试消费者；无静态入边的现用入口继续保留，没有为删除数量移除业务、兼容读取或有效夹具。

新增合成profile、数据库、公开模型/音频、临时签名应用、原生Keychain容器及可选截图仅使用owner系统临时目录，退出/失败/取消清理。正式发行三项与当前依赖/模型/工具、全部签名/凭据/host-id/更新身份、发行和恢复基线及历史跳过目录保护。下文Windows清理只记录此前已完成的本机操作，Mac不重试这些路径。

## 2026-10-30 Windows客户端0.6.5清理边界

本轮以已发布Mac0.6.3产品快照c37fa181为交接基线，独立服务端0.5.3和macos树只读。源码引用图逐项核对无静态入边的入口：Renderer main、主进程/preload、knowledge/speech Worker与平台动态适配器都有运行/打包/测试消费者，继续保留；严格未使用声明检查不代替动态入口审计，不按数量删除业务或兼容代码。

清理windows/.cache/installer-ui中的brand.png、frontend.manifest、installer.nsh、VoxCue.Setup.UI.exe四项可重建中间文件；package-installer在使用前通过prepareInstallerUi完整重建。安装/更新三项逐项摘要一致归档至windows/release/0.6.5后，删除release/installer中重复三项及builder-debug.yml。删除前核对精确绝对路径、祖先/后代无重定向和文件占用；逐文件持有允许删除但不允许其他读写的独占句柄后删除，不递归清除未知目录。正式归档、当前构建/验证基线、依赖/锁、模型/索引、固定运行时、签名/凭据/host-id/更新身份、恢复基线和历史跳过目录保护；owner临时捕获在复核后清理，不留工作区图片或报告。

## 2026-10-29 客户端0.6.3清理边界

逐项核对静态/动态平台、Worker、preload、打包和测试消费者后，删除styles.css中已退役账号布局的cloud-account-actions、cloud-session-list及其子选择器、cloud-account-dialog。组件展示文案集中到公共契约，移除ComponentsPanel重复映射；本地账号设置旧表单切换样式随功能拆分撤除。无静态入边的实际文件均为页面、Worker或平台动态入口，继续保留，不为数量删除业务模块或兼容读取。

Windows与服务端参考保持只读；现用依赖/模型/固定运行时、正式历史发行、恢复基线、全部签名/凭据/更新身份及历史跳过目录保护。测试只使用owner系统临时目录，退出清理，正式0.6.3安装/更新三项单独留在macos/release/0.6.3且不入源码Git。

## 2026-10-28 0.6.2源码清理边界

本次明确撤除付款/兑换/面试时长租约运行实现及专用测试；逐文件核对无消费者后删除，保留对应源码恢复副本直至交付完成。删除清单见MACOS_0.6.2_HANDOFF；独立服务端支付/订单/时长模块不进入客户端Git。官方AI用量、管理员/会话/容量/安全断言保留；无未来收费开关。

注销导出临时ZIP/截图、模型、数据库、构建和执行结果不入源码Git；退出按owner、真实路径、消费者和占用清理。公用模型、现用内容、历史跳过目录、发行和恢复基线保持。下文为历史记录，不构成当前全量或新清理授权。

## 2026-10-28：Windows客户端0.6.2

仅清理 `C:\Users\fengk\Documents\Repository\VoxCue\windows\.cache\installer-ui` 的4个旧生成文件：brand.png、frontend.manifest、installer.nsh、VoxCue.Setup.UI.exe，合计181443逻辑字节。`package-installer.mjs`在引用前调用`prepareInstallerUi()`完整重建；临时验包使用owner目录单独生成，不消费该旧目录。删除前验证精确绝对路径、工作区边界、祖先/后代无重定向、无进程引用及每文件独占读取；仅移除这一个已核对目录。

Renderer/backend无用声明检查及静态/动态模块、preload、Worker/utilityProcess、构建/打包与测试消费者审查不以删除数量为目标。Windows新拖动规则之外的旧拖动选择器仍被Mac使用，予以保留；共享原件、云恢复、索引与有效测试不清除。依赖/锁、模型/索引、现用构建/工具缓存、历史正式发行、恢复基线、真实资料/凭据及历史117/349跳过目录保持，macos与服务端0.5.1只读。新增测试资源及临时包由owner退出清理，不保存执行报告。

## 2026-10-28：客户端0.6.1

本轮按消费者、真实路径及占用核对工作区。源码中撤回的“等整库恢复再索引”接口和重复状态赋值已移除，沿用收到文件立即单任务索引、当前库已排队任务优先的简洁调度；不为扩大清理数量移除现用业务、兼容读取或测试夹具。

三处Finder `.DS_Store` 首轮删除共36876逻辑字节；其中 `macos/.DS_Store` 在预查时仍被Spotlight读取却被误删，已在清理审计中如实记录，不将其描述为合规的无占用删除。它是可重建元数据，不涉及源码或用户应用数据。最终改动后再次在同一条件操作中检查路径、lsof和独占锁，清理根目录重建的10244字节Finder缓存；任何占用或未知状态均跳过。纯路径/数量/状态审计在 `macos/recovery/client-061-cleanup-20261028`，不进入源码提交。

旧 `macos/.tools/electron-dev-previous-1793136374191` 已在历史文档明确列为恢复基线，因此保留；固定运行时/依赖缓存、模型/索引、全部发行、凭据/签名/更新身份以及历史117/349跳过目录保持，Windows专属和服务端0.5.1只读。测试产物仅在owner临时目录存在，退出清理，不把执行结果另存到工作区。

## 2026-10-28：Mac 0.6.0完整复验与发行清理

前后端未使用声明、静态/动态平台及Worker/preload/打包消费者复核通过；没有确认额外闲置业务模块。只合并聊天测试同源重复导入，并清理README/更新说明中被新共用界面取代的当前说明，0.5.9历史验包和所有历史发行记录保留。

本轮164份pnpm完整注册表元数据缓存（80004693逻辑字节）已核对真实路径、无重定向、lsof无占用及逐文件独占访问后隔离；最终同锁离线打包、ASAR运行时及Sparkle本地验包通过后，再核对owner/原164文件尺寸/lsof无占用并删除隔离副本。固定依赖/内容存储、模型/索引、现用构建、全部历史发行、恢复基线、固定签名/凭据助手/更新身份及历史117/349跳过目录保持。完整结果见[Mac0.6.0发行复验](MACOS_0.6.0_RELEASE.md)。

## 2026-10-27：客户端 0.6.0 整理

本轮服务端 shared/server 全树只读。核对静态导入、动态平台/Worker/preload、构建打包与测试消费者，移除旧登录说明的四个无用 CSS 选择器及 PreparationPage 的闲置 CSSProperties 导入；当前业务、兼容读取和有效评估夹具保留。测试入口适配新的主账号和 AI 设置，未恢复已经删除的产品入口。

windows/.cache/qwen-runtime-1.0.1-candidate-20261020 是历史打包中间归档，并非现用运行时目录。其 ZIP SHA256 与现用 qwen-windows-runtime-catalog.ts 及固定公开归档一致，公开资源仍可用，代码/构建无路径消费者；同目录派生清单、4份历史 npm 日志与1份2026-10-23遗留的 Vitest results.json 缓存（201字节）一并清理，当前测试配置已关闭该结果缓存。删除前检查绝对/真实路径在本工作区内、祖先及后代无重定向、无进程引用，每个普通文件可独占打开。合计8文件、713550090逻辑字节，空缓存目录随之移除。纯清理清单及状态在 windows/recovery/client-060-cleanup-20261027/{plan,result}.json。

最终验包发现 Packager 升级后遗留的旧嵌套依赖遮蔽当前版本。以 pnpm 的 hoistedLocations 为准逐包核对，删除不属于当前安装图的14个旧包（345文件、1198718字节），保留仍受管理的 asar/glob；同样核对路径、重定向、进程及逐文件独占访问。当前 Packager 正确使用锁定的 @electron/get 5.1.0。清单在同一恢复目录的 stale-build-dependencies-{plan,result}.json。本轮累计删除353文件、714748808逻辑字节，不等同磁盘实际可用空间增量。

正式模型/索引/运行时与信任根、当前构建、全部发行、恢复基线、真实资料/凭据、历史平台跳过目录保持。客户端依赖按安全审计做定向补丁升级，具体版本见共享清单和本轮进度。新增测试模型、截图和 profile 使用带所有权标记的临时目录，结束清理；不保存测试报告或合成资料至工作区。

## 2026-10-25：Mac 0.5.11 清理

核对静态/动态入口、Worker/preload、打包和有效测试消费者，Renderer/backend 的未使用声明检查无新增闲置业务代码，不为清理数量删除兼容路径或评估夹具。

`macos/.cache/launcher.iconset` 仅为 `build-icons.mjs` 生成 ICNS 的十张中间 PNG；实际应用使用 `macos/public/voxcue.icns`，构建标记及正式 PNG/ICNS 完整。核对绝对/真实路径、祖先/后代无符号链接、普通 PNG 文件身份和 lsof 无占用后，删除这十项共479209逻辑字节的可重建中间文件。固定工具、签名及凭据助手、模型/索引、现用构建、全部正式发行和恢复基线保留；Windows 专属及历史跳过目录不动。

本轮隔离 profile、模型、数据库、临时截图及打包暂存退出清理；Mac 0.5.11 的正式 DMG、签名 ZIP、latest-mac.yml 为交付物，源码提交排除所有包、模型、原始测试产物与凭据。

## 2026-10-25：Windows 0.5.11 清理与验收

用户授权本次完整清理/测试、问题修复复测、0.5.11 源码和 Windows 安装包上传并设 Latest，以及 Mac 审查交接。现用源码、依赖/锁、固定模型/运行时、正式历史发行、恢复基线、真实资料及历史跳过目录继续保护，macos/ 只读。

Renderer/backend 的 noUnusedLocals/noUnusedParameters、架构及动态平台/Worker/preload/打包入口检查通过，未确认额外可删除的业务源码。没有为清理数量删除兼容、评估或有效测试代码。旧 windows/.cache/installer-ui 的四项均由 prepareInstallerUi 完整生成；核对精确绝对路径、祖先与后代无重定向、无该目录执行中的进程及每个文件可独占打开后删除，共 181443 逻辑字节。新发行暂存和临时验收目录待验包及上传完成后再核对清理。

最终包与线上下载验证结束后，先核对保留于 windows/release/0.5.11 的三项正式文件与已验包摘要一致，再对 installer、installer-stage、installer-ui 缓存及本轮 audit 目录逐一检查绝对路径、所有祖先/后代无重定向、无该树执行中的进程、普通文件均可独占打开，然后清理。删除当前安装器工作树 4 文件/387395416 字节、stage 7719 文件/1564859461 字节、重新生成的 UI 缓存 4 文件/181443 字节，以及本轮 350 张截图/摘要与辅助脚本所在 audit 树 362 文件/19131983 字节。加上开始时的旧 UI 缓存，共清理 8093 文件、1971749746 逻辑字节；不等同磁盘可用空间增量。

完整结果、UI 目视与最终包/线上核对见 [Windows 0.5.11 验收](WINDOWS_0.5.11_VERIFICATION.md)。临时合成资料、公开模型/音频与截图不进入源码或安装包，系统临时模型/profile 由本轮 owner 生命周期退出清理；仅保留本版本三项正式 Windows 资产、现用构建及全部受保护/历史内容。没有为清理删除现用业务代码。

## 2026-10-25：Windows 0.5.10 发行与源码上传前整理

用户明确授权本次工作空间清理、源码上传、Windows正式包补充至既有v0.5.10并设Latest。前后端noUnusedLocals/noUnusedParameters检查通过；静态/动态平台、Worker、preload及测试入口继续有效，未发现可独立删除的业务源码，不为清理改变其他毛玻璃或现用功能。

正式包和相同stage的隔离原生验收结束后，先认证三项正式文件已复制到windows/release/0.5.10且SHA256一致，再核对installer与installer-stage精确绝对路径均位于本工作区windows/release内、所有后代无重定向、无进程从该树运行且每个普通文件可独占打开，随后删除本次生成的两棵工作树：7723个文件、1952251585逻辑字节。该大小不等同磁盘实际可用空间增量。临时发行脚本和元数据在本次完成后清理，不进入源码。

正式0.5.10三项、旧发行、当前dist/dist-electron、依赖/锁、模型/索引/Runtime、恢复基线及历史349个Windows跳过目录全部保留；macos只读，无签名/更新身份或真实安装变更。纯代码/测试/配置/文档按逐项审计清单提交私有main；版本、验收范围及在线认证结果见[Windows验收账本](WINDOWS_0.5.10_VERIFICATION.md)。本次发布不授权后续自动发行。

## 2026-10-25：Mac 0.5.10 发行前整理

已核对当前工作区42项退役文件删除：Mac旧内容控件/菜单/侧栏与局部背景绑定、Renderer替换层及其专属构建和测试，以及共用旧材质包装和面试输入区状态组件。核对静态导入、动态平台/Worker/preload入口、构建/打包和测试消费者；有效的音频、屏幕权限、凭据、更新、SF Symbols与系统侧栏能力保留。前后端noUnusedLocals/noUnusedParameters检查通过，没有为增加清理数量删除仍有消费者的业务、兼容代码或评估夹具。

清理当前README中重复且相互冲突的旧Mac展示说明，当前版本与平台边界单列；旧发行包和历史记录保持。正式发行、固定运行时/依赖/锁、模型/索引、恢复基线及现用构建保护；历史Mac占用元数据/目录和Windows349个跳过目录不重试，Windows专属只读。本次测试与下载模型使用自有系统临时目录并在退出清理，最终仅保留Mac 0.5.10的三项正式发行资产，不把测试资料或凭据打包。

## 2026-10-24：Windows 0.5.9 发行前整理

核对生产导入、动态平台/Worker/utilityProcess 入口和测试消费者，保留现用源码与本轮验收夹具；没有为扩大清理数量删除仍有消费者的代码。Windows 前后端另用 noUnusedLocals/noUnusedParameters 检查闲置声明，执行结果只在终端报告。

核对精确绝对路径、真实路径、无重定向、进程引用和独占文件访问后，删除 `windows/release/installer-stage` 中旧 0.5.8 生成暂存树；正式 0.5.8 安装器、blockmap 和摘要清单保持。删除 `windows/release/installer` 内两份与 `windows/release/0.5.5` 归档逐字节相同的旧安装器/blockmap，以及 `windows/release/0.5.8/builder-debug.yml` 构建诊断。正式历史发行、当前 dist/dist-electron、依赖/锁、模型、原件、索引、恢复基线和历史349个跳过目录均保留，macos/只读。

本次正式 Windows 0.5.9 三项资产单独保留在 `windows/release/0.5.9`；临时测试产物、上传辅助文件和重复打包暂存退出清理。源码提交不包含发行包、模型、清理审计、凭据或测试结果。

## 2026-10-24：0.5.9 源码整理

恢复完整验收后，重新核对全部新增生产模块、Worker/utilityProcess/preload、AppKit 展示端口与测试入口，前后端额外启用 noUnusedLocals/noUnusedParameters 检查均无闲置声明。截图查看器曾用的 titleAction 仍由知识库重命名使用，不能删除；截图原图存储、评估夹具和平台端口均有实际消费者。未为扩大清理数量删除现用文件，历史占用/跳过目录继续保留。

核对生产导入图、平台动态装配、Worker/utilityProcess/preload、打包和测试消费者后，清理已退役 mock 标记、记录数量、知识库说明/预览与旧用量操作的闲置 CSS，以及重复额度定义列表规则和未使用的快照键变量。动态生成的 resize-left/right、全部实际平台入口、旧数据兼容及现用评估夹具保留，不把“无静态入边”当作删除理由。

精确核对真实路径、普通文件身份、应用无消费者及 lsof 无占用后，删除根与 shared 的两个 `.DS_Store`，逻辑大小共22,536字节；不代表磁盘实际释放空间。纯路径/数量/删除状态见 `macos/recovery/workspace-cleanup-20261024/{plan,result}.json`，不含测试结果。以前受占用的 Mac 元数据和历史跳过目录不重试，Windows 专属只读。

本轮此前已移除知识库 Function Calling 的源码和专用测试，设置知识库 tab 的专属状态/模式接口亦已退役；保留主侧栏知识库管理、原件、现有模型与索引。锁和固定依赖/运行时、签名/更新身份、现用构建、发行、恢复基线和真实资料保持。本轮只上传核对后的源码，不上传构建/模型/包、截图/测试结果、清理审计或私密材料。

## 2026-10-23：0.5.7 分层与弃用代码清理

核对生产导入图、Vite 平台替换、原生动态装配、Worker/preload 与测试消费者后，删除已移除 Liquid Glass 开关的 React 实现、设置写入接口、专用 switch IPC/事件/生命周期、原生 configureSwitch/NSSwitch 分支及无消费者样式。现用自动下载 NSSwitch 由 content-controls 承载，保留；旧偏好只读兼容及辅助功能回退保留。删除旧手动知识库检索/预览的 store 状态与操作、无消费者 CSS、个人信息卡片内关闭移除后的 onClose 参数和对应旧入口测试；底层检索、RAG、取消/索引及三模式真实检索覆盖保留。删除知识库顶部旧 over-glass 属性选择器，实际已使用 standalone-glass 且继承统一36px尺寸。

Mac 替换插件从公共 Vite 配置迁至 macos/renderer.config.mjs，展示 props 抽至纯共享契约；这属于移动现用职责，不当作闲置源码删除。导入图中无静态入边的页面入口、Worker、动态平台/更新/语音模块和三个构建替换组件均有运行消费者，保留。能力驱动的外观设置统一后删除Mac AppearanceControl副本，shared保留旧macOS/Windows毛玻璃控件与主题策略。未发现其他可独立删除的业务文件；当前未提交原生源码、依赖/锁、模型/固定运行时、现用构建、发行和恢复基线保持，Windows只读及历史跳过目录保持。

## 2026-10-21：Mac 0.5.6 发行前清理

核对生产/测试静态消费者与动态入口、绝对/真实路径及lsof占用后，移除仓库根 `.DS_Store`（10,244逻辑字节）。该Finder元数据没有运行消费者；DMG安装布局使用的是镜像内独立 `.DS_Store`，不受影响。当前源码、测试及动态Worker/utilityProcess入口均保留，未发现需删除的独立业务模块。

保护本轮未提交修改、依赖与锁、正式模型、固定凭据助手及签名/更新身份、现用dist/dist-electron、发行和恢复基线。Windows专属只读；Mac历史117个占用目录和Windows349个跳过目录不重试。测试模型从明确授权缓存只读认证后复制到系统临时根，退出清理，正式源不执行组件status/download/remove；此前要求的合成截图交付物保持。

## 2026-10-20：Windows 0.5.3 源码同步前清理

核对当前生产/测试消费者和动态入口后，删除深色 ChatGPT 头像按旧图片路径匹配的三行样式；固定 SVG 现已内嵌，深色显示由现用 service-brand-icon 规则承担。另核对精确路径、普通文件身份及占用后，移除 windows/.cache/electron-build-cleanup-plan.json 这一未被脚本或文档引用的旧编译计划，逻辑大小 10,020 字节。

保留动态平台/Worker/原生入口、Qwen 回归与固定输入、依赖/锁、当前 dist/dist-electron、正式发行、模型/Runtime 和恢复基线。macos/ 继续只读，历史 349 个跳过目录不重试；不读取真实账户/资料，不替换真实安装或更改公开发行。按本次用户授权，仅将核对后的源码、测试、配置和文档提交推送，测试结果与清理审计不上传。

## 2026-10-20：Windows 0.5.1 版本与清理

共享版本源、根调度配置与 Windows 生成配置更新为 0.5.1；模型组件版本独立保留。macos/ 继续只读，Mac 本机接续时使用现有 sync-platform-manifests.mjs 同步其生成配置，不在 Windows 改写。

核对 Renderer/主进程静态引用、动态平台与 Worker 入口、脚本消费者和动态 CSS 类。删除 Qwen 原生进程中无人调用的 demo 静音阈值切换方法，以及只写不读的 total/open 字段；保留现用业务、测试和固定输入，不裁剪上游公共库接口。

临时目录清理限定为此前明确创建的 VoxCue-Qwen-*20261019 demo。先核对模型副本与保留基准的 SHA-256、绝对/解析路径、无重定向、进程引用与独占文件访问，再移除 64 个目标、6,354 个文件，逻辑大小 22,771,222,392 字节；其中 5 棵旧 demo 整体移除，其余仅清理列明的演示文件和旧构建/缓存。逻辑大小不代表实际释放空间，重复资源可能共享磁盘块。

保留 Integration 中完整模型基准、已发布模型资产、当前原生构建和构建工具链，另保留独立 GGUF 基准、上游来源、现用 dist/dist-electron、正式发行及恢复资料。未重试历史 349 个跳过目录，不读取真实账户/资料，不升级依赖或改变公开发行；验证仅用隔离合成数据，结果只到终端/对话。

## 2026-10-18：Windows 0.3.1 源码清理

核对 shared/src、shared/electron 与 windows/electron 的静态导入、动态平台装配、Worker/utilityProcess/preload、脚本入口和资源消费者。移除已删除界面说明遗留的 session-note 与 attachment-menu-hint 样式；provider-ui 按现行附件菜单检查文件/文件夹/搜索入口及说明不再出现，保留提供商切换和历史身份断言，并采用导入应用前阻断网络的宿主。弃用 answerStyle 已在本轮提示词整理时删除，不恢复旧存储读取。

未将无静态入边的动态入口、测试源码、固定输入或生成配置当作闲置文件删除；不拆删依赖、锁、现用构建/模型、发行或恢复基线。macos/ 严格只读，历史349个跳过目录不重试；不接触真实账户、原件和用户数据。回归及隔离安装负载入口见 shared/test/README.md，结果不记入本文。

## 2026-10-18：闲置源码副本与空编译目录

本轮在shared/macOS核对导入图、脚本入口、原生动态装配、同名文件差异、绝对/真实路径和lsof占用后，删除9份无消费者的“2”号源码副本：更新偏好、组件公开契约/IPC/Store、ActionTransition、ComponentsNotice、DownloadButton、SidebarUpdate及更新偏好单测。6份与正式文件同字节；另外3份为已被当前组件删除实现覆盖的旧代码，没有独立功能。正式文件摘要保持。

另移除根/shared/macOS的3个Finder缓存、6个空dist-electron副本和两棵空编译暂存树（共17个空目录）。总计12个普通文件、40,282逻辑字节，全部目标均无进程占用；该体积不代表实际磁盘可用空间增量。精确路径、数量及删除状态在macos/recovery/unused-source-cleanup-20261018/{plan,result}.json，仅为清理审计，不含测试结果。

无静态入边的运行入口、Worker/utilityProcess/preload、原生平台适配，以及通过模板生成的缩放样式均有实际消费者，保留。现用测试/固定输入、依赖/锁、当前构建和工具运行时、发行、签名密钥、真实原件及源码恢复基线继续保护；Windows专属目录只读，历史受占用/跳过的测试目录不重试。本轮不提交、推送或发布；必要回归结果仅到终端/对话，临时数据退出清理。

## 2026-10-18：源码同步前的本地发行清理

用户最新明确要求上传当前源码并删除本地安装包与模型。核对工作区 windows/release 的精确路径、后代无重定向及文件无占用后，移除修复安装包、blockmap 与 latest.yml，共 3 个普通文件、逻辑 233,247,356 字节。windows/release-smoke、shared/local-models/speech 与 shared/local-models/rag/multilingual-e5-small 已不存在；本次不重新下载。纯路径、用途、数量和删除状态在 windows/recovery/local-installer-cleanup-20261018/cleanup.json，不提交审计。

已安装应用及其数据目录保持，不将用户数据根纳入清理。源码、依赖、开发构建、恢复基线、公开 Windows/Mac 发行及 Latest 保留；macos/ 未改，349 个云占位目录不重试。当前源码同步不包含公开 0.2.2 安装包替换或后续自动发布。

## 2026-10-18：Windows 当前工作区

按当前用户清理要求，核对源码引用图、静态/动态入口、脚本消费者及精确路径/重定向/占用后，移除四份过时测试报告、已解压的 Node 工具压缩包、安装界面编译中间文件与旧工具日志，共 20 个普通文件、逻辑 37,587,310 字节。旧报告引用改为现用测试入口与架构说明，不复制保存结果；纯路径、用途、数量和删除状态见 windows/recovery/workspace-cleanup-20261018/cleanup.json。

未发现可独立删除的业务模块；动态平台入口、Worker/utilityProcess/preload、固定输入和测试助手保留。历史 shared 锁基准、依赖及平台锁、开发构建、当前本地修复安装包、未提交安装器修复和源码恢复基线保留。macos/ 未改，349 个云占位目录不重试；不读取/删除真实用户资料、凭据或已安装程序，不补回模型，不提交、推送或发布。

## 2026-10-18：Windows 0.2.2 发布后的安装包与模型

用户明确要求删除本地安装包和模型。已清理 C:\Users\fengk\Documents\Repository\VoxCue\windows\release（安装包、更新元数据及 installer-stage）、shared/local-models/speech、shared/local-models/rag/multilingual-e5-small，共 6,772 个普通文件、逻辑 1,530,865,885 字节；空模型容器一并移除。该体积为文件逻辑大小，不作为实际磁盘可用空间增量。纯路径/数量/删除状态在 windows/recovery/local-release-model-cleanup-20261018/cleanup.json，不含测试结果。

删除前核对生成/运行消费者、精确绝对/解析路径、各级无重定向与进程/文件占用。VoxCue 与旧数据根的 component-cache 均不存在，未触碰应用数据根、真实资料/凭据或已安装程序；源码、依赖、开发构建、恢复基线、工具下载缓存和线上发行保留。macos/ 严格只读，Windows 349 个已跳过的云占位目录未重试。模型后续由设置内既有首次下载流程准备，不自动补回。

## 2026-10-18：继续本机工作区清理

本轮按用户授权继续清理，暂不提交/上传 GitHub。此前经 AST 核对移除 22 处测试脚本的未使用 workspace 导入，平台约束继续由现用 test-workspace 入口承载。本次删除根 `.DS_Store` 与已被 `Reset.png` 同字节替代的 `macos/public/sf-symbols/RotateCcw.png`，共 2 个普通文件、13,285 字节；删除前核对真实路径、普通文件身份、消费者及 lsof 无占用。根 Finder 缓存可能由系统再次生成；Mac 目录的 `.DS_Store` 仍被系统索引进程占用，保留且不停止索引。

没有确认可删除的独立现用业务模块；保留动态装配、Worker/utilityProcess/preload、测试临时目录助手、依赖和锁文件、签名密钥、模型资源、发行产物、真实资料与源码恢复基线。Windows 专属目录只读，历史受占用保护目录及此前明确跳过的 Windows 云占位目录不重试。纯绝对路径、用途与删除/占用状态在 `macos/recovery/workspace-cleanup-20261018/{source-cleanup,files,continued-cleanup}.json`；功能回归不保存结果到本清理记录或其他文件。

## 2026-10-18 卸载旧版后的数据目录清理

用户明确授权清理旧安装版重新创建的 /Users/fengkuan_zhu/Library/Application Support/ai-interview-copilot。删除前核对完整路径/真实路径、子树无链接、旧版已卸载及新旧根均无进程占用；旧根没有 auth-data 或 IndexedDB。删除旧根的 38 个普通文件、19 个子目录、1,792,514 字节。VoxCue 新根及其全部数据保留，不移除其中的历史资料或凭据；不改变未来双目录冲突时停止并保护双方数据的启动规则。纯路径/数量/删除状态审计在 macos/recovery/legacy-profile-cleanup-20261018/cleanup.json，不保存资料内容。

## 2026-10-18 两套本地模型重置

用户明确要求删除模型以查看首次下载。核对固定下载/运行/构建消费者、真实路径、子树无链接及 lsof 无占用后，删除 shared/local-models/speech 与 shared/local-models/rag/multilingual-e5-small 两个模型包，共 13 个普通文件、373,253,584 字节。VoxCue/component-cache 尚不存在；未删除应用数据、公开模型发行、现有安装包或 Windows 专属内容。纯路径/数量/删除状态审计在 macos/recovery/model-reset-20261018/cleanup.json，不包含测试结果。

## 2026-10-18 Copilot 独立运行时清理

用户明确授权移除 GitHub Copilot 接入和独立运行时。从当前 shared/macOS 删除后台、IPC、路由和品牌素材，包管理器卸载 SDK/本平台运行时及独占依赖；源码恢复基线、原凭据与用户历史原位保护。Windows 专属源码/安装结果依照平台只读限制留待其本机清理，精确路径见 COMPONENTS.md。

核对精确路径、当前消费者、真实路径与进程占用后，删除 macos/release/copilot-runtime-v1.0.21 下六个独立发行文件，共 113,889,010 字节；不涉及模型或其他应用安装包。纯路径/数量/删除状态审计在 macos/recovery/copilot-removal-20261018/cleanup.json，不包含测试结果。公开同名运行时发行、附件及对应标签按授权删除。

# 工作区清理结果

## 2026-10-17：Windows 0.2.1 上传后的打包文件

私有源码与公开 v0.2.1 Windows 三项资产上传核验后，按用户确认只清理本工作区安装包与打包文件。删除 C:\Users\fengk\Documents\Repository\VoxCue\windows\release（NSIS、更新元数据、installer-stage 及本次失败打包暂存）和 C:\Users\fengk\Documents\Repository\VoxCue\windows\.cache\release-upload-v0.2.1（一次性上传辅助文件），共 8,785 个普通文件、逻辑 2,546,694,278 字节，删除失败 0；windows/release-smoke 已不存在。该数字为文件逻辑体积，不是磁盘可用空间变化测量。

删除前核对固定绝对/真实路径、无重定向、静态脚本消费者及无运行进程占用。工具依赖与缓存、现用 dist/dist-electron、源码、模型、恢复基线及真实用户数据保留。macos/ 全程只读，历史 Windows 349 个跳过目录和 Mac 117 个占用目录未重试。本次纯清理清单/数量/状态位于 windows/recovery/release-0.2.1-cleanup/{plan,result}.json，不含测试内容。

## 2026-10-17：共用设置完成后的闲置文件与冗余样式

删除两个精确目标：根 `.DS_Store`，以及被当前 revision 3 开发宿主替代的 `macos/.tools/electron-dev-previous-1792255575752`（revision 2）。共 269 个普通文件、14 个包内链接，逻辑文件体积 263,943,129 字节（约 264 MB），失败 0；不是实际可用磁盘空间变化的测量。执行前核对绝对/真实路径、无外部重定向、清单一致及 lsof 无占用；运行中 Electron 的文件 inode 对应现用宿主，未关闭或修改用户程序。旧宿主已移除，历史“保留旧运行副本”的记录不再表示该副本现存。

核对 164 个生产源码/工具模块的静态导入、动态装配及构建入口，没有确认可删除的独立业务模块；无静态入边的 Worker、进程、preload、平台适配和命令入口保留。额外 Renderer/Electron noUnused 类型检查无未用局部变量或参数；样式中无字面消费者的 resize-left/right 仍由动态类名生成，不删。移除 6 段已被现行共享规则完全覆盖的旧焦点/登录间距规则和一项过期标题栏高度扣减，共 28 行；保留现行视觉、键盘操作与共享设置行为。

CSS 格式/差异检查与 Mac Vite 生产构建通过，保留既有大分块提示；未运行单元、架构、UI 或原生测试，未截图或保存测试结果。原件、既有 SVG 修改、锁文件、现用宿主、模型/依赖、发行、真实用户数据和源码恢复基线保持；6 项重点保留文件及 123 项已知 Windows 文件摘要一致。Windows 全程只读，349 个此前跳过目录与 Mac 117 个受占用保护的旧测试目录不重试。清单/删除状态仅存于 `macos/recovery/workspace-tidy-20261017/{plan,result}.json`，不含测试结果。

## 2026-10-17：测试结果零保留与历史清理

按用户最新指令撤销“每类最近 5 次”保留策略，AGENTS.md、测试入口和目录文档统一改为结果仅在终端/内存显示，成功/失败均不持久化。必要隔离工作文件只使用操作系统临时目录并在结束、失败、取消时清理；禁止把运行产物转存 recovery。现有部分脚本仍会持久化报告/截图/profile，后续获准运行前必须先改造，当前未声称已全部改造，也未恢复测试。

按精确绝对路径、真实路径、生成用途和进程占用检查，删除 macos/test/results 下 101 项旧生成产物、4,420 个文件、193,340,866 字节，删除失败 0。其余 117 个旧目录被 OneDrive fileproviderd 占用，按被占用文件保护规则暂留；未停止同步或正常应用。Windows 349 个先前明确跳过的云占位目录未重试，123 项既有 Windows 文件哈希保持。不能宣称全部旧结果已删除。

测试源码、固定夹具、源码恢复基线、现用构建/运行时/依赖/模型和真实用户资料保留。本轮只有清理与文档更新，没有运行测试、截图、构建或打包。纯清理清单与状态在 macos/recovery/workspace-cleanup-20261017/test-output-purge-{plan,processes,summary}.json，不包含测试结果正文。被清理的旧报告/截图/诊断链接不再作为现存交付物；下文历史保留描述均已由本节取代。

## 2026-10-17：撤回界面实现后的工作区清理

删除 154 项、3,262 文件、390,122,789 字节，失败 0：撤回版本的玻璃/原生控件恢复副本及专用结果、无进程使用的旧 Electron 开发宿主、超过各类最近五次的可清理测试历史、可再生中间产物和目录缓存。现用生产模块均保留；没有拆删厂商依赖或模型。实施前可用源码基线保留于 macos/recovery/source-baseline-20261017，263 个条目摘要核对一致。清理清单/逐文件清单/消费者与结果见 macos/recovery/workspace-cleanup-20261017/{plan.json,entries.jsonl,consumers.json,result.json}。

退出软件后复核确认 VoxCue 无残留进程；68 个候选旧测试目录仍被 fileproviderd 占用，暂留为历史保留例外，不停止同步或强删。Windows 全程只读，349 个此前跳过的云占位目录不再遍历。183 项当前源码/原件/锁/运行时和 123 项 Windows 文件哈希保持；根三目录及局部依赖保持。没有运行测试、构建或打包。

此前文档引用的已移除玻璃测试、截图、恢复副本与旧宿主不再作为现存交付物；保留历史事实，不恢复撤回功能。

更新：2026-10-17。最新目录及保留策略见首节；以下旧 test/results 路径仅为历史运行记录，不作为当前可用交付物。

## 2026-10-17：SF Symbols 模块后的测试历史

按 Mac 每类最近 5 次规则删除 19 个过期生成目录、260 文件、逻辑 7,313,616 字节，失败 0。包括 rag-tools/core/coordinator、launcher-native、chat-progress、window-native；各类当前不超过 5 次，最新图标专项和原始失败诊断保留。删除前保存精确绝对路径，核对真实路径、无链接、生成消费者与进程占用；未停止正常应用。下文/PROGRESS 中 launcher-native-P2SOSP 旧引用已过期，不再作为现存产物。源代码、恢复基线、原件、依赖、模型和当前 Mac 原生资源保留，Windows 只读，349 个云占位目录继续跳过。

清单、进程/文档引用检查和结果位于 macos/recovery/sf-symbols-20261017/test-retention-{plan,process-check,result}.json；final-audit.json 同时记录 Windows 123 文件、原 Fluent 入口及既有 chatgpt.svg 字节保持、三目录与平台局部依赖/编译输出核对。

## 2026-10-17：屏幕权限模块后的测试历史

按 Mac 各测试类型最近 5 次规则，核对生成脚本、真实结果时间、绝对/真实路径、无链接及进程占用后，删除 18 个过期运行目录、220 文件、逻辑 5,530,854 字节，失败 0。涉及 rag-tools/core/coordinator、chat-progress 和 window-native，当前各类不超过 5 次；已删除的旧报告/截图不再作为现存交付物。集中验证报告、源码恢复基线、固定夹具、依赖/模型和真实用户资料保留。Windows 只读，349 个云占位目录继续跳过。

精确清单、进程检查和结果见 macos/recovery/screen-permission-20261017/test-retention-{plan,process-check,result}.json。此前开发宿主副本仍保留作恢复用途，没有停止正常应用或清理全局缓存。最终签名复核另清除当前开发宿主副本内 4 个 framework 目录的 com.apple.FinderInfo，移除前保存原值，严格签名验证通过；未修改厂商依赖、quarantine 或 File Provider 属性，审计见同目录 development-host-metadata-{before,result}.json。

## 2026-10-17：平台编译产物与本轮测试历史

Mac 构建原本同时输出 Windows 模块。修正编译入口与静态装配后，在本平台暂存编译并验证仅 shared/macos，随后替换 macos/dist-electron，移除其中旧 Windows 输出；81 项旧 Mac 生成文件已先保存精确清单及恢复快照。未来构建拒绝异平台输出，配置同步/格式化/图标生成也只写当前平台。Windows 的两项旧配置和旧 Mac 编译目录只读取报告，交由 Windows 本机处理；本轮 123 项 Windows 源码/配置/原生/编译文件字节保持。

本轮测试按各类最近 5 次清理 50 个过期 Mac 目录、444 文件、逻辑 4,917,165 字节，失败 0。删除前保存绝对路径清单、真实路径/无链接核对及目标进程占用检查，没有停止正常应用；最新验证与必要诊断保留。已删除的旧运行不再作为现存交付物。审计与恢复资料在 macos/recovery/platform-boundaries-20261017，包括 electron-output-cleanup-plan、windows-readonly-before、workspace-audit、test-retention-plan/process-check/result。共享 Logo 原件、Windows 图标、依赖/模型/发行、真实用户资料及恢复基线保留；349 个 Windows OneDrive 云占位目录未重新处理。

## 2026-10-17：Mac 原生适配后的测试历史保留

本轮原生音频、窗口和启动器完成后，按“平台 + 测试类型”各最近 5 次规则整理 Mac 新生成历史。按目录内真实结果修改时间排序，仅删除超额的 rag-tools、rag-core、rag-coordinator 隔离单测运行：92 个目录、684 文件、逻辑 606,921 字节，失败 0。各类余下最多 5 次；最新音频/窗口/启动器/聊天验证及本轮集中报告保留。已删除的旧运行不再作为可用交付物。

删除前形成绝对路径清单，逐项检查真实路径、子树无链接、测试生成入口及运行进程，未停止现有正常应用或触碰真实用户资料。源码前态、Windows 保持核对和清理审计另在 macos/recovery/native-audio-20261017；test-retention-plan.json、test-retention-process-check.json、test-retention-result.json 记录精确结果。未清理依赖/模型/发行或源码；Windows 剩余 349 个 OneDrive 云占位目录继续按用户要求跳过。

## 2026-10-17：三目录迁移与测试历史重置

按用户最新授权，将根目录非入口文件分别归入 windows、macos、shared，并同步实际依赖、构建、测试、资源与文档消费者。AGENTS/PROGRESS 保留根目录；root package.json 只转发本机平台命令，各平台有独立安装结果与锁，shared 仅声明共用依赖，不建立共享 node_modules。

删除前保存 291 项受版本控制文件的源码原态、SHA256、迁移清单和原锁；本次恢复资料在 macos/recovery/workspace-reorg-20261017，不混入普通测试历史。既有 SVG 修改、Logo/PNG/ICO、Windows 启动器与三份锁的 package/snapshot 字节核对通过。真实用户资料/凭据/聊天/面试历史、当前发行、生产模型、现用依赖与退役 benchmark 私有资料保留。

用户最后明确选择“直接删除所有历史测试，并从现在开始只保留5次历史测试，mac和windows分开”。因此旧 Mac 结果全部清空；Windows 已清理可访问的旧文件/目录，剩余 349 个 OneDrive 云占位目录按用户最后“跳过这步”的要求原位保留，不再自动重试、移动或删除（精确清单见 recovery 中 clear-history-result.json）。旧结果目录内仍被脚本使用的语音夹具和下载缓存先分别转入 shared/test/fixtures/speech-audio、windows/.cache/electron，再清理。后续各平台每类测试保留最近 5 次，依据真实运行/结果时间排序；文档引用不作为永久保留豁免。恢复基线与固定输入另行保护，历史报告正文不冒充仍存在的产物。

已停止本轮全部测试/清理等待进程；一次性删除工具二进制与 Swift 模块缓存另行按清单移除（106 文件、93,438,728 字节，task-tool-cleanup-plan/result）。

确认无用的 Qwen 下载残片、误建根包缓存及本轮过期本地生成结果共 22 项、119 文件、4,023,742 字节已按清单删除。最终单测新生成的 rag-tools 结果已按时间裁剪为 5 份。详细 local-cleanup-plan/result、clear-history-plan/result、retention-plan/result 和 final-path-integrity 在上述 recovery 目录；没有整库 reset/clean，没有按文件大小/忽略规则删除功能。

当前最终检查全部通过：配置同步、138 模块架构、三组类型、336 项单测、Mac 共享构建、隔离登录/聊天、原生 RAG utilityProcess、1 秒合成静音 ASR Worker。当前报告在 macos/test/results/workspace-check-20261017，具体范围见根 PROGRESS.md。Windows 原生和完整 Mac 移植仍需其对应后续验收；未打包/提交/推送/发布，未启动十分钟语音。

## 2026-10-16：0.2.0 清理与平台分类

本轮按用户授权整理并准备提交源码和发布安装包。核对静态导入、动态 Worker/utilityProcess、构建/打包入口和测试消费者后，138 个生产模块没有可删除的孤立业务模块；7 个无入边节点均为实际入口或声明。仅删除无消费者的 Shrink 图标导出及其 Fluent 导入、过期 interviewLayout.height 字段，现用语音、RAG、账户和存储完整保留。

6 份依赖 Windows 原生鼠标、WASAPI 权限或 Copilot Win32 运行时的桌面回归迁入 test/windows/scripts，权限和模拟语音夹具归入 test/windows/fixtures。共享 UI 回归通过显式可执行路径验证打包应用，具体 Windows 路径只在 Windows runner 中解析；不创建未实现的 Mac 测试目录。benchmarks 整体 Git 忽略，退役私有原件和历史结果原地保留。

删除前形成具体清单，并验证真实绝对路径、目录边界、重定向和运行进程。仅移除旧隔离 profile 中已知的 Chromium 缓存：581 个目录、2,207 个文件、逻辑大小 917,572,989 字节，失败 0。排除文档引用、各组最新结果、失败诊断和恢复基线；profile 数据、报告、截图、正式 release、根构建、模型/依赖、真实用户资料和凭据均保留。缓存不再作为可用验证产物；原始报告仍可追溯。

0.2.0验收后再移除4项可再生成副本：nsis-upgrade-L2pCyr的stage/artifacts，以及updates-native-1VRWID的Cache/pending与platform-cache/pending。88文件、1,730,629,512字节，失败0；先核对具体路径/链接/进程，再按清单删除。其报告、截图和profile保留，正式release/installer与installer-stage保留；已移除副本不再作为可用交付物。清单和结果在verification-cleanup-plan.json、verification-cleanup-result.json。

审计位于 test/results/release-v0.2.0：baseline、source-move-plan.json、cleanup-plan.json、cleanup-result.json。版本和上传状态以 PROGRESS 相应条目为准；旧报告已清理，现用入口见 ../test/README.md。

## 2026-10-16 功能回归生成副本移除

36组功能回归通过后，仅移除本轮5项可再生成内容：platform-layout-functional-20261015-697d9556便携副本、nsis-upgrade-ZsqYJX的stage/artifacts、updates-native-lR72ZR的Cache/pending和platform-cache/pending。共9,031文件、逻辑3,337,255,901字节，失败0；删除前形成具体清单，递归真实路径与重定向检查、工作区范围及各目标运行进程检查通过。测试NSIS应用已正常卸载，报告/截图/失败日志/合成资料/源码快照和既有恢复基线保留；正式release、根构建、真实用户数据/凭据/原件、benchmarks及模型/依赖未动。审计见test/results/functional-20261015-697d9556/cleanup-plan.json和cleanup-result.json，旧报告已清理，现用入口见../test/README.md。portable-current-VNSxgj/report.json仍为历史验证证据，所用测试包已经移除，不作为可用交付物。

## 2026-10-15 AGENTS更新与生成产物精简

AGENTS.md已将已完成任务的重复“最新授权”整理为当前状态，修正旧知识库“等待新方案”的过期描述，明确现用LanceDB/E5 RAG、Windows/macOS/shared生产目录、test测试边界、Mac仅Apple Silicon且未完成移植、当前安装包与工作树的差异。补充长期清理规则：先核对消费者/进程/真实路径；保留必要报告、截图、最近结果、失败日志与恢复快照，验收后的可再生成副本与缓存可移除；不清理原件、凭据、模型、依赖或正式发行。

本轮仅删除test/results中的265个过期合成测试目录/缓存目标，合计12,917文件、逻辑体积7,638,205,224字节，失败0。候选来自实际测试脚本的生成前缀；排除文档引用的运行目录、每组最近结果、恢复基线/迁移快照及账户授权相关目录。已验收的platform-layout-20261015便携副本移除，portable-current-kD1Dco/report.json及截图、原生/更新报告和平台整理快照保留；更新下载缓存清除，release/installer安装包与元数据仍保留。

删除前逐路径确认在test/results内、无重定向链接和使用该路径的运行进程；OneDrive占位文件按真实路径确认，不按reparse属性误删。所有删除结果有清单，源码/测试文件与恢复快照核对见本轮verification.json，架构136模块零越层/运行时环。没有业务改动、提交推送、重建安装包或发布；本轮不重复生成全套测试包/缓存。审计在test/results/workspace-tidy-20261015，含前态AGENTS、来源清单、保留依据、逐项结果和汇总。

## 2026-10-15 平台目录与test集中整理

生产源码按shared/、windows/、macos/划分，242个原文件均有最终去向；测试源码、测试脚本及夹具统一test/shared与test/windows，原Renderer旁单测不再混在生产目录。原test-results目录整体迁到test/results，内部截图、隔离资料和恢复基线全部保留，历史报告内旧路径不改写。根配置、公共素材、依赖、模型、native/bin助手输出及现有release产物维持用途和位置；benchmarks只留退役实验历史数据，未读取/删除原件或重新评测。

已清理71个被新路径编译模块替代的旧JS和10个生成空目录，并删除迁移后的旧源码空目录；每个旧产物先确认新产物存在、绝对路径留在dist-electron内再删除，没有清空构建目录。引用图136模块无孤立业务文件，七个无入边模块均为实际入口/声明/Worker/utilityProcess；额外noUnused及依赖核对未发现其他可安全删除模块或依赖，版本和锁文件保持。

目录/测试依赖边界、构建/启动/ASAR/原生进程引用同步。实际回归与限制以PROGRESS最新节为准；逐文件前态、最终映射、清理清单和日志在test/results/platform-folders-20261015，目录解释见WORKSPACE_LAYOUT.md。没有提交推送、生成交付安装包或发布，仅生成隔离便携验证目录。

## 2026-10-15 main / 跨平台架构整理

- 从最新本地HEAD建立main，承接全部191项既有修改/未跟踪内容；Windows/Mac及原工作分支保留，没有提交、推送、重置、强合并或修改远端默认分支。远端实时核对因网络失败未确认，只记录本地跟踪值。
- 审查src/electron/scripts/tests/docs/public/native及根配置的引用、动态入口、依赖和生成输出。删除无消费者的MODEL_ID导出；窗口配置/导航/加载共用，不改业务生命周期；纯平台策略由main装配，后台不反向依赖桌面策略。
- 没有删除整个源码文件或依赖，没有升级版本。Windows限定的sherpa-onnx-win-x64 1.13.8改为平台可选依赖；原Windows打包仍显式要求该原生包，锁文件只同步分类，包版本/完整性全部保持，原供应链与冻结锁校验通过。其余依赖均实际使用。
- 七个无入边源码均为启动/声明/进程/Worker入口；唯一同字节Logo副本是生成流程必需。全部脚本有用途，dist-electron没有孤立过期输出。未清空生成目录或历史证据，没有删除模型/依赖，也没有读取/删除真实原件、凭据、用户历史或benchmark派生数据；原生回归仅正常加载现有模型和使用合成资料。
- 修复旧login smoke过期定位器并保留图片加载断言；vitest仅收集源码测试，原41文件完整保留并新增平台测试；.gitignore补macOS元数据与崩溃转储。
- 134模块架构、类型、noUnused、42文件295单测、Windows构建、14组桌面回归及真实无采样Worker/utilityProcess/设备枚举、离线RAG通过。Windows三类窗口完整选项与前态一致，76个Renderer文件、preload/公开契约未变，无数据格式迁移。PDF并发冷启动超时原日志保留，独立完整重跑原5秒门槛通过。

详情见[CROSS_PLATFORM_REFACTOR](CROSS_PLATFORM_REFACTOR.md)。前态与审计位于test-results/cross-platform-20261015。没有重新打包/签名/发布，现有安装包不含本次整理；Mac仅完成静态策略与类型检查，实际移植待后续授权。

## 2026-10-15 全界面检查后的清理

- 对照全部 Renderer 消费者删除24个无引用类涉及的42个CSS选择器，包括旧登录、旧浮窗状态、旧知识库设置和无消费者的字号组合。保留动态拼接的 resize-left/resize-right；旧 .btn 为失配规则，按实际 ui-button 修正。删除 PreparationPage 未使用的 openChatLink 导入，真实打开链接接口及消费者保留。
- 架构引用图没有孤立业务模块。七个无入边文件均为 main/Renderer/preload/声明或按路径启动的 speech/knowledge 进程与 Worker；全部图标仍有消费者。Renderer 与后台额外 noUnusedLocals/noUnusedParameters 检查通过，没有为凑清理数量删除功能或依赖。
- 按已核实的 scripts/tests 生成前缀清理过期隔离测试输出，保留文档引用、每组最近输出、本轮截图和恢复基线；删除已过期的 release/installer-stage、release-smoke 以及中断的 copilot-dependencies 下载暂存。删除前逐路径检查真实绝对路径、工作区边界与链接，执行前复核生成目录白名单、保留清单和运行应用路径，使用 PowerShell Remove-Item -LiteralPath，不使用全库 clean/reset。
- 共删除1085个条目、35037个文件，文件逻辑大小合计5,036,656,979字节（约5.04GB），删除失败0。该数字是文件大小之和，不作为实际磁盘可用空间变化的测量。
- 保留根目录最新 dist/dist-electron、现有 release/installer 安装包及更新元数据、node_modules、依赖锁与本地包缓存、Paraformer/E5模型、语音夹具、benchmarks中的private/历史结果/派生数据、workspace-cleanup-baseline 和文档引用的必要报告。没有读取或修改真实 userData、原件、账户凭据或面试历史。

审计证据在忽略目录 `test-results/visual-cleanup-20261015/`：removed-selectors.json、source-audit.json、cleanup-plan.json、cleanup-result.json 和 verification.json。当前安装包为此前版本，暂存/便携目录已删除，本轮没有重新打包或发布；日常启动继续使用根目录 Start-VoxCue.cmd。

## UI 审查中的无引用样式清理

逐项核对Renderer代码后，移除src/styles.css中旧record-detail/detail-heading/record-columns、saved-transcript/saved-answer、composer-caption、floating-bottom/floating-notice、login-wordmark/login-loading规则及旧正文选择器。对应类名没有现存Renderer消费者；仅调整这些规则，不重排或整文件格式化。仍断言旧入口不存在的回归检查保留。

当前业务源码引用图未发现新的孤立模块。当前LanceDB、原件管理、Paraformer、账户、聊天、面试与记录仍实际使用，不按废弃项删除；恢复基线、已有派生数据和真实用户数据保留。

本次审查生成的10个隔离profile目录和已弃用的启动脚本也已清除；删除前验证每个绝对路径均在test-results/ui-ux-audit内。保留有效截图、复现值与可复现检查脚本。

架构106模块零越层/运行时环、类型、33文件203项测试、构建通过；独立userData与合成端口的25个Electron界面状态在清理后复查。旧审查报告已清理，现用界面入口见../test/README.md。未提交、推送或发布。

## 2026-10-14 本次范围

- 删除 Qwen 权重、CPU 解码 Worker、CUDA 子进程/能力检测/运行库、下载缓存、模型清单、比较脚本、专用夹具/测试及旧详细试用报告。删除语音识别模型/CPU-GPU 菜单、公开选项、转发与锁定分支，以及无人使用的提示 CSS。
- 保留固定 Paraformer CPU、Silero、模型文件完整性检查、开场安装检查、设备/权限检查、旧事件过滤、WASAPI 间断恢复和面试上下文。已存旧模型/计算设备字段读取时忽略，音频与回答偏好继续保留；不迁移真实存储。
- 删除独立 Orama/LanceDB 一次性对比工程的执行代码、独立依赖与重复公共模型缓存/探针包；删除依赖固定历史结果路径的5个策略/性能脚本及命令。当前知识库、E5/LanceDB 后端和其维护回归仍在使用，保留。
- 清除149个经绝对路径及工作区边界验证的条目，包括旧编译/便携输出、Qwen/CUDA 文件、生成截图、隔离 UI 测试目录和旧日志。清单在忽略的 `test-results/retired-cleanup-paths.json`，条目数不是文件数或磁盘释放量。新的验证结果、依赖和启动所需构建保留。
- 依据数据保护约定，已有 private 语料、标注、结果、派生索引/向量、恢复基线原地保留；没有读取或清理真实用户目录、简历/知识库原件、凭据、面试历史。未执行新的模型/精度实验。
- 源码引用图无其他孤立模块：无入边文件仅为 main、Renderer入口、preload、声明及由路径启动的 Worker/utilityProcess。Renderer/后台分别启用临时 noUnusedLocals/noUnusedParameters 检查通过；所有 package 脚本入口存在。根依赖锁没有因本次清理重写，已有未提交修改保留。
- 干净重建后语音打包只接受8个固定 Paraformer文件，防止残留实验模型重新进入包。

历史质量结论保留：Qwen 未达用户要求而撤除。其 GPU 单句曾比 CPU 慢55.1%，负载下出现积压，长句尾段约7.55秒，真正流式未实现。撤除不计作质量修复，也不证明 Paraformer 真人中英混读已达标。

## 本次验证

- 106源码模块架构检查：零越层、零运行时环；类型、干净构建通过。
- 33个测试文件、203项通过；移除的测试针对已撤除功能，保留功能没有删失败断言或降低门槛。新增旧设置兼容检查；Vite既有大chunk提示保留。
- `interview-effort-1791952259668`：Qwen/GPU菜单不存在，保留开场安装检查，回答模型/思考强度、确认锁定、重载与请求传参通过（隔离合成端口）。
- `speech-restart-JPs2KV`：真实WASAPI回环/Paraformer Worker，3轮启动暂停恢复、一次受控间断，均有终稿、零错误；麦克风关闭，不保存采集音频/转写正文。
- `speech-failure-1791952265325`：最终版本损坏模型拒绝、Worker/采集进程失败后的清理通过。移除仅为嵌套解码进程提供的dispose握手，停止继续先冲刷尾段，再释放Paraformer Worker；相关42项回归复测通过。
- `portable-current-FIeR9g/report.json`：最终便携包真实Paraformer语音解码、gap重置、utilityProcess/原生助手、面试上下文及原有知识库功能通过；包内语音目录严格等于8个固定模型/许可文件，废弃后端不存在。根目录构建与便携包已更新，没有提交、推送或发布。

## 2026-10-13 历史记录（以下不是当前能力清单）

用户当时授权撤除旧知识库内容索引方案并清理废弃代码/文件，该轮没有实现替代方案；后续授权的新知识库实现见当前 ARCHITECTURE 与 PROGRESS。

## 删除与简化

- 移除旧检索后台、解析/Embedding/重排/NLI/语义证据实验，以及 Hybrid、Lite+ 应用路径、流式证据协议和公开契约。
- 移除主进程装配、preload/IPC、Renderer 服务、自动同步/轮询、状态/取消/重试/问答校正、参考来源 UI、模式菜单及单场知识库选择。聊天和面试直接调用现有 AIChatService。
- 删除对应下载、评测、冻结、原生/桌面测试脚本与夹具；封存题目直接删除，未读取、解密或评测。旧方案和专项报告从文档中撤除，AGENTS/README/ARCHITECTURE/HANDOFF/PROGRESS 整理为当前状态。
- 删除独立运行依赖 @huggingface/tokenizers、mammoth、onnxruntime-node、pdfjs-dist、sqlite-vec，更新锁文件。其余根依赖的锁定版本与清理前一致；安装日志显示移除 125 个依赖包，未运行依赖安装脚本。
- 删除仓库内 e5/minilm/nli/reranker 模型目录，保留 local-models/speech。旧便携输出和编译输出清除后重新生成，避免已删除源码的 JS 残留。
- 引用图确认旧 InterviewPage 和 historyExamples 无入口/消费者后删除；删除无消费者的麦克风适配函数、2 个图标导出、37 条废弃 CSS 规则及旧改名/图标生成/置顶/账户诊断脚本。当前图标生成脚本保留。
- 清除 631 个旧生成工件入口（日志、截图、隔离测试目录和旧源码快照等），保留本轮验证、源码恢复基线及现有公开语音夹具/本机 Electron 打包缓存。此前失败的结论在 PROGRESS 中保留，不将撤除功能计为质量修复。

清理前源码/文档/脚本清单中有 86 个文件已删除；该数字不包含独立删除的专项测试/夹具、模型与生成工件。具体初始删除清单、修改文件和旧工件清单在忽略的 test-results/workspace-cleanup-baseline 与 cleanup-removed-artifacts.json。

## 数据与行为兼容

知识库保留创建/重命名/删除、导入/拖放、同名替换、文档删除和 TXT/Markdown 有界预览。PDF/Office 原字节继续保存，界面明确仅支持文本预览。导入不解析、不加载模型、不触发后台同步；准备聊天/面试不读取知识库原件或自动附带简历。

没有读取、删除或迁移真实 userData、IndexedDB、凭据、简历、个人信息、记录或旧派生数据库。IndexedDB 名称 copilot-local-documents、版本 1、bases/documents stores 和按 baseId 读取原件的浏览器索引保持兼容。旧记录的未知附加字段原样保留，新增回归验证标题修改不改写旧回答。原音频不保存/上传、OAuth 与窗口保护范围不变。

新的请求契约不再接受旧功能字段；主进程保留窗口/输入校验、模型/effort 开场锁定和请求取消。运行中的旧应用窗口应正常退出后使用 Start-VoxCue.cmd 启动新构建。

## 验证

| 检查              | 结果                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 架构              | 88 文件，零越层依赖、零运行时循环，频道覆盖通过                                                                                                                                                                |
| TypeScript / 构建 | typecheck、build 通过；既有 Vite 大 chunk 提示保留                                                                                                                                                             |
| 单元测试          | 25 文件、150 项通过                                                                                                                                                                                            |
| 原件管理桌面检查  | 导入、同名替换、文本预览、PDF 原字节、重载、改名、删除确认及旧 IPC 撤除通过                                                                                                                                    |
| 保留功能桌面回归  | settings、interview:workflow、interview:access、interview:effort、history、composer、conversations:status、ui:alignment、electron、floating、login、chat-response、conversations、login:entry 共 14 组脚本通过 |
| 本地语音文件推理  | 19 个现有合成/公开音频案例通过；sherpa 1.13.8 / ORT 1.28.2，无录音/下载                                                                                                                                        |
| 新便携包          | 打包及启动通过；真实语音 Worker 加载模型、utilityProcess 返回 idle、助手路径通过；包内仅 speech 模型，无旧后台目录/IPC                                                                                         |

修改前沙箱基线为 42 文件/622 项：615 通过、7 失败，包含本机 HTTP 与临时文件 rename 的访问限制。本轮在正常本机权限、隔离目录下完成最终测试；对应功能撤除后删除其专用测试，不通过修改断言或降低门槛保留假通过。

便携检查首次因新测试执行上下文没有全局 require 而失败；仅修正脚本的 createRequire，未修改产品来绕过检查，复测通过。上述测试未使用真实账户、真实用户资料或真人采集，不能替代真人准确率、物理热插拔/权限撤销、新电脑/全部 DPI、真实摘要与标题质量验收。

结果日志：test-results/cleanup-{architecture,typecheck,test,build,knowledge,speech-model,package,package-test}.log，以及 cleanup-smoke-*.log。新的便携检查报告在 test-results/portable-current-390CO3/report.json。

当前分支 codex/speech-recognition，全部工作未提交/推送。等待用户新方案，保留现有语音、账户、聊天和记录功能。
