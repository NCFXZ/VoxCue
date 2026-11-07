# Windows 1.0.0 发行索引 / Windows 1.0.0 release index

更新日期 / Updated: 2026-11-07。

**当前状态：Windows 1.0.0 已在 GitHub 公开，三项 NSIS 资产已完成匿名完整回读；源码已推送。2026-11-07 Partner Center 确认 Microsoft Store“提交 3”已上架。后续发布者名称维护见 [1.0.1 发行索引](WINDOWS_1.0.1_RELEASE.md)。Mac 仍待本机接续与发行，当前完整 Mac 资产继续为 0.6.9。**

**Status: Windows 1.0.0 is public on GitHub, all three NSIS assets have been read back anonymously, and the source is pushed. Partner Center confirmed Microsoft Store submission 3 is live on 2026-11-07. See the [1.0.1 index](WINDOWS_1.0.1_RELEASE.md) for the subsequent publisher-name maintenance update. Mac still requires local work and release; the complete Mac release remains 0.6.9.**

本索引不保存测试成绩、运行报告或截图。公开产品说明见 [1.0.0 简体中文 / English](RELEASE_1.0.0.md)；Mac 按 [0.6.9 → 1.0.0 逐项接续清单](MACOS_1.0.0_HANDOFF.md)独立执行，不能以 Windows 结果替代本机验收。

## 来源与发布记录

| 项目 | 当前记录 |
| --- | --- |
| 版本唯一来源 | `shared/package.json = 1.0.0` |
| 对照源码基线 | 0.6.9，`be6784d047b4f5f3ca0bb62d8f5f6f374ba03985` |
| 本次安装包源码输入 SHA | `a47f7435ef7c233eee9da87a18261162dfaee65f` |
| 私有源码仓库及目标分支 | `NCFXZ/VoxCue`，`main` |
| 源码提交及推送状态 | `b8a8b0dd8b3474f3c8341947fe7ff77b0f49334f` 已推送，`ls-remote` 与本地一致；该提交包含后续测试工具及文档，不改变上述安装包输入 |
| 公开二进制发行仓库 | `NCFXZ/VoxCue-releases`；不向此仓库上传私有源码 |
| 发行 tag | `v1.0.0` |
| GitHub 发行标题 | `VoxCue 1.0.0` |
| GitHub release ID、URL、发布时间 | `437694751`；[v1.0.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.0.0)；`2026-11-07T17:35:20Z` |
| 草稿、预发行及 Latest 状态 | `draft=false`、`prerelease=false`；Latest release ID 同为 `437694751` |
| 本轮发行说明 | [RELEASE_1.0.0.md](RELEASE_1.0.0.md) |

本次安装包输入固定为 `a47f7435ef7c233eee9da87a18261162dfaee65f`。其后的测试工具修复及文档提交不改变生产负载和已公开安装包，不能把后续提交冒充打包输入；真实发行元数据继续单独记录。版本配置只从共享版本同步到根及 Windows；`macos/` 全树保持只读，生成漂移留 Mac 本机同步。

## Windows 独立安装版资产

本次公开资产仅为以下三项 Windows x64 文件。三项均已上传 GitHub，匿名完整下载的字节数与摘要和本地归档一致。

| 文件 | GitHub asset ID / 上传状态 | Bytes | SHA256 |
| --- | --- | ---: | --- |
| `VoxCue-Setup-1.0.0-x64.exe` | `721409623`，已公开 | 407594704 | `b4f350fbc4309176f1f946e39ba4342f5a8cf58500c4f0d842fa7a1ae70ce7be` |
| `VoxCue-Setup-1.0.0-x64.exe.blockmap` | `721413458`，已公开 | 422371 | `f2d85d4417932678b54679a33e507591460617ff4546560c86082aa9ba7f2722` |
| `latest.yml` | `721413485`，已公开 | 349 | `74aa127feee572801a69e6229b4956e2033af86c7a8941affafaa762f5027f6f` |

| 核对项 | 当前记录及后续待办 |
| --- | --- |
| 正式构建入口 | `pnpm package:installer`；当前保留正式资产与归档，构建暂存已清理 |
| 构建暂存清理 | stage、resources、cacheInstallerUI、build-debug 已清理；正式 NSIS 三项、Store APPX 及旧发行/恢复归档保留 |
| 正式三项归档位置 | 已复制至 `windows/release/1.0.0`，复制后三项 SHA256 与上表一致；旧发行与恢复基线保留 |
| 应用、清单及文件名版本 | `1.0.0`；安装包输入以上述固定 SHA 为准 |
| 安装包 size 与 SHA512 | `407594704`；`LRV5lO6uOh6f17QhC08uk7QHbN7elUfThcAS5sxSlt4U103fnl64V3jzJrRQ0jtssSMy0nzSIbcVdWzqYOqz9w==`；匿名 EXE 回读与公开清单一致 |
| EXE Authenticode 状态 | `NotSigned`；未新增或轮换身份 |
| 正式负载来源 | 已公开文件保持本次正式构建原字节；后续测试工具/文档提交不替换或改写该负载，原构建暂存不再作为现存文件引用 |
| 三项匿名完整下载 | 三项均为 HTTP `200`，完整字节数与 SHA256 和上表一致；EXE SHA512 与清单一致，公开 `latest.yml` 与本地归档逐字节一致 |
| 匿名分平台选版 | 生产选版实际返回 `windows-x64=1.0.0`、`macos-arm64=0.6.9`；Mac 1.0.0 未齐全时保持完整 0.6.9 回退 |

EXE 用于首次安装或手动升级，blockmap 和 `latest.yml` 用于独立安装版的应用内更新。继续使用固定匿名公开发行源、本平台完整稳定资产选择及现有摘要/签名校验；不以全局 Latest 标记替代平台完整性检查。

## Microsoft Store 包与提交

| 项目 | 当前记录或固定目标 |
| --- | --- |
| Store 产品 ID | `9PBBVWZXMBPW` |
| 打包入口 | 在 `windows/` 执行 `pnpm package:store` |
| APPX 输出 | `windows/release/store/VoxCue-Store-1.0.0-x64.appx` |
| APPX 内应用版本 | `1.0.0`，来自共享版本；不改写为商店身份版本 |
| Store Identity 版本 | `2.0.0.0`；只在 builder 元数据使用主版本加一及末位零的既有映射 |
| Identity Name | `NCFX.VoxCue` |
| Publisher | `CN=CC9C4962-FFC8-44D9-A2C0-B446CBFD375A` |
| PublisherDisplayName | `NCFX` |
| 平台与入口 | x64；`app\VoxCue.exe`；`Windows.FullTrustApplication` |
| 语言与能力 | `en-US`、`zh-CN`；保留 `runFullTrust` 用途与既有商品配置 |
| 本地 APPX Bytes / SHA256 | `600079408`；`f314b7c77691175561bd4ef4fce52b9c4df8003c4a52525ac1c2dbba9dd6323e` |
| 本地 APPX 签名状态 | 无签名的 Store-only 包；正式商店签名由微软处理 |
| Partner Center 提交号 | “提交 3”，submission ID `1152921505702342173`；本次 APPX 已上传并验证，已成功提交认证 |
| 中英发行说明与发布选项 | 中英 release notes 均为 `1.0.0`；现有 runFullTrust 用途说明在 500 字符限制内；认证通过后立即发布 |
| 认证、发布及可获取状态 | 2026-11-07 Partner Center 概览显示提交 3“你的最新产品现已在 Microsoft Store 上架” |

Store APPX 只上传 Partner Center，不作为上述 GitHub NSIS 三项资产的一部分。商店版由 Microsoft Store 更新，包内不得携带独立安装版的 `app-update.yml`。构建入口不导入本地签名凭据；最终商店签名与分发以微软实际处理状态为准。

Sandbox 验证只在可丢弃来宾内签署私有副本并建立测试信任，宿主正式 APPX 保持原字节。验证使用已安装包身份下的实际应用、preload 和 IPC，并确认真实 `process.windowsStore` 及更新拒绝；微软调试命令的令牌与正常 AppId 激活不完全相同，不能据此宣称开始菜单激活、全部隐私权限或商店认证已经验收。其适用边界见 [Invoke-CommandInDesktopPackage 官方说明](https://learn.microsoft.com/en-us/powershell/module/appx/invoke-commandindesktoppackage)。

## 0.6.9 → 1.0.0 产品范围

| 范围 | 本轮行为 |
| --- | --- |
| 侧栏提示对齐 | 多行低额度提示从邮箱文字所在列开始，不再横跨头像列；头像与邮箱及额度整块文字垂直居中。收起态保持原头像按钮及文字隐藏规则。 |
| ChatGPT 单周期 | 服务实际仅返回五小时或周额度时，侧栏始终一行“ChatGPT 剩余 N%”；严格低于 20% 时仅百分比标黄。英文沿用 `ChatGPT N% remaining`，不丢失百分比前后文字。 |
| ChatGPT 双周期 | 同时返回五小时和周额度时，任一严格低于 20% 后仍分标题和数值两行显示两个实际周期，各自标黄低额度值。20% 保持正常样式，0% 保留真实耗尽含义；健康状态继续使用原紧凑摘要。 |
| 其他额度消费者 | 新的一行规则只作用于侧栏实际单周期 ChatGPT；普通摘要、开始面试的完整额度展示、浮窗提示及 Copilot 沿用既有选择和状态语义。读取中、失败、空快照及断开不伪造数字。 |
| 网页活动域名来源 | 读取网页和查找网页内容的活动记录复用 `SourceLink` 域名胶囊及 favicon/通用图标回退，取代原下划线 URL 按钮；活动标题与状态、真实链接和受控打开路径保持。非法协议或含凭据地址不生成来源链接或图标请求。 |
| 活动行自适应字号与图标 | 网页活动胶囊继承所在行字号，内距、间距、最小高度及图标槽按既有胶囊比例缩放；局部 SVG 跟随图标槽，不更改全局图标 API，也不把普通正文 URL 扩大为胶囊。 |
| 超链接交互反馈 | 可用真实 href、来源胶囊及其嵌套文字显示手形光标；普通正文超链接与胶囊在 hover/focus-visible 时使用既有主题色提供反馈，键盘焦点保留清晰轮廓。普通正文仍可选择，普通按钮、禁用链接/控件和无 href 锚点不套用手形；受控 URL 校验、原文复制及无新增 tooltip 的边界保持。 |
| Store 更新分流 | Store 进程不创建独立安装版的 `electron-updater` 驱动，更新页显示中英 Microsoft Store 说明并禁用自动下载开关；独立 NSIS 更新渠道保持。 |
| Store 包身份与图标 | Store 进程保留系统包身份提供的 AppUserModelID；APPX 使用多尺寸及浅深主题的透明图标资源。原独立 Windows 标识不变。 |
| Windows 打包 | 增加互斥的 Store 暂存与路径/链接检查；APPX 排除 mammoth 的 Word 测试夹具，运行解析器保持；仅在匹配版本的 Electron ZIP 实际存在时使用本平台缓存。 |

RAG 算法、阈值、检索策略、索引兼容、生产模型和依赖版本均不属于本轮新增变更。没有账户迁移、真实数据改写或签名身份轮换。共享代码仍为双端单一实现；Windows 专属打包和商店行为不移植到 Mac。

## 验证期间的夹具、守卫及说明修正

以下记录已纳入源码的验证行为，不能写成新增产品功能，也不代表 Mac 已完成本机验收；逐项 Mac 对应动作见交接清单 M016–M021、M036 起的追加项目。

| 修正 | owning source 与保持项 |
| --- | --- |
| 单周期与英文实际界面覆盖 | `free-service-smoke.mjs` 区分单/双行，增加邮箱/头像几何及仅百分比颜色断言；新增两种单周期的英文、浅深主题、边界值及最小窗口检查，保留原数值完整可见和双周期断言。 |
| 活动胶囊与链接实际交互覆盖 | `source-favicon.test.tsx`、`chat-progress-smoke.mjs` 和 `chat-response-smoke.mjs` 增补真实活动胶囊、域名/href、字号及图标比例、受控点击、危险 URL 拒绝，以及普通粗体子链接和来源胶囊的 hover、手形与键盘焦点断言；`continuous-corners.mjs` 同步光标契约，Windows 五档矩阵加入 chat-progress/chat-response。 |
| 原生图标像素探针同步 | `settings-smoke.mjs` 为冻结退出快照及独立 live SVG 参考统一两次 rAF 绘制屏障，再量几何并捕获原生像素；增加同一冻结快照的 A/A 严格比较，保留原退出/参考差异及几何阈值，不修改生产 snapshot。 |
| Windows 测试指针停车 | `WindowProbe.cs` 先记录真实 anchor，以单次可观察的相对移动确认异步输入已被消费，再作最终绝对定位；保持原期限及精确终点断言，不通过容差放宽、重复输入或恢复已撤回坐标归一化绕过失败。 |
| Store 渠道与正式包覆盖 | `update-cache.test.ts` 动态核对 Store 不加载独立更新单例、实际 UpdateService 拒绝检查/下载/安装以及 NSIS 保持装配；`store-artifact-smoke.mjs` 核对最终 APPX 身份、图标、ASAR 生产安全、沙箱 preload 和正式包拒绝测试登录入口。 |
| Store 签名环境输入隔离 | `windows/scripts/package-store.mjs` 在动态导入 electron-builder 及启动 package-portable 前直接赋空 `CSC_LINK`、`WIN_CSC_LINK`、`CSC_KEY_PASSWORD`、`WIN_CSC_KEY_PASSWORD`，阻断库初始化或 fallback 急切求值读取宿主签名输入；不读取、备份、输出或恢复原值，不改变独立 NSIS 入口。Mac 对应边界见 M054，不把该清空规则移植到本机正式签名流程。 |
| Sandbox 清理边界 | `store-sandbox-smoke.mjs` 使用专用临时目录及 owner 标记，避免关闭失败后被通用测试回收器误删仍在映射的目录；按 kind、nonce、PID、真实路径和无链接条件自清理，未知或活跃归属不删除。 |
| Sandbox 功能预检 | 改用只读 `Win32_OptionalFeature` 状态，避免仅为查询 Sandbox 是否启用而要求管理员 DISM；缺少功能或未启用时明确失败，不自动启用系统功能、修改权限或触发 UAC。 |
| 运行期桌面守卫 | `desktop-guard.mjs` 由共享功能与 Windows 原生/DPI 外层复用，所属测试 child 运行中每两秒核对控制台；锁定、未知或探针错误时停止拥有的 child 和后续组，保留原始错误，清理守卫，不在失锁后移动指针。原长稳时长、超时和并行边界保留。 |
| 固定 Qwen 公开资源 | `windows/test/scripts/qwen-fixtures.mjs` 复用本平台缓存前重验 WAV/TXT 固定摘要；缺失资源的 fetch 有期限和明确 HTTP 错误，认证后以所属随机 partial/rename 发布缓存并在 finally 清 partial。固定上游 revision、音频内容、生产 Qwen/ASR、模型及推理行为保持。 |
| 当前执行入口与服务参考 | `shared/test/README.md` 改用当前 `--list` 而非历史固定组数；联调参考明确为只读 `VoxCue-server` 0.5.3、提交 `3bceb615dbba900f669322c301fc4b5b473dfb15`。不回退或改写相邻后续工作，显式引用原样固定参考副本，客户端仅使用临时合成资料与自有 loopback。 |

清理范围见 [工作区清理约定](WORKSPACE_CLEANUP.md)。本轮未确认可以独立删除的闲置业务代码，不为数量移除有效动态入口。现用依赖、固定公开缓存、工具、原件、凭据助手和历史正式发行/恢复基线保留；本轮固定服务端临时参考副本及已确认无用的构建暂存已清理，不将其列为现存运行资料。后续重跑仍按 owner 生命周期创建并清理临时资料。

## 验证与后续复核入口

除同步入口在仓库根执行外，下列命令的工作目录均为 `windows/`。此处保留验证入口和边界，不记录成绩；后续改动仍按对应风险复核。正式构建暂存已清理，重跑依赖暂存的入口时须明确重新构建范围，不能把新建临时包冒充已公开文件。GUI、原生、推理和长稳仅在当前 UID 已登录且解锁的控制台串行执行，锁定或未知状态立即停止。

| 范围 | 入口及必须保持的边界 |
| --- | --- |
| 配置与静态检查 | 根执行 `pnpm sync:workspace`，只生成根和 Windows 配置；随后 `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:workspace`、`pnpm test`、`pnpm audit`、`pnpm build`。不为过检查升级依赖或放宽断言。 |
| 完整共享功能与安全对抗 | 先 `node ../shared/test/scripts/functional-suite.mjs --list`，再 `pnpm test:windows:functional`；以当前全部组为准，保留账号、资料、知识库/RAG、同步、导出、删除、更新、安全对抗和真实本地运行时。 |
| 长稳与音频 | 保留默认矩阵的 20 轮面试及显式 600 秒双路 ASR/VAD；定向入口为 `node ../shared/test/scripts/functional-suite.mjs interview-stability speech-soak audio-pipeline adversarial --jobs=1`，不能使用短默认时长代替。 |
| Windows 原生 | `pnpm test:windows:regression`，保留当前全部原生组；不采样物理麦克风、系统音频或真实屏幕内容。 |
| 中英视觉与五档缩放 | `pnpm test:ui:dpi`；保留 1、1.25、1.5、1.75、2 全部档位及原全部组，关注 `free-service`、`language`、`ui-alignment`、`typography`、`chat-progress`、`chat-response`、登录、设置和面试浮窗；活动胶囊、真实链接 hover/focus-visible 以及菜单退出图标都需本机复核。单组重测不能代替完整矩阵。 |
| Qwen 实际组件与推理 | `node test/scripts/qwen-component-smoke.mjs`；按当前入口显式设置开发机 `VOXCUE_PYTHON`。复用已授权公开组件时用 `qwen-installed-smoke.mjs` 及显式 `VOXCUE_TEST_COMPONENT_CACHE`，先认证再复制到 owner 临时根，核对真实 CPU/CUDA、Worker、切换与释放。不能据合成语音或另一平台成绩宣称完成。 |
| 安装器流程与升级 | 沿用 `installer-branding-smoke.mjs`、`installer-engine-smoke.mjs` 和 `pnpm test:installer:isolated`；engine 的旧版夹具是 0.5.1，不代表真实 0.6.9 → 1.0.0 升级已验收，该路径仍须另行核对。 |
| 正式 NSIS 与正式负载 | `pnpm package:installer` 后运行 `pnpm test:installer:artifact`，再 `node test/scripts/portable-native-smoke.mjs --installer-stage` 复核本次正式暂存。`--with-installer` 的 owner 临时包不能冒充本次正式产物。 |
| 正式 Store 包 | `pnpm package:store` 后运行 `pnpm test:store:artifact`、`pnpm test:store:sandbox`；来宾仅使用当前正式 APPX 的临时副本，缺少身份、环境或调试能力必须失败。Sandbox 验证不能替代 Partner Center 认证和分发。 |
| GitHub 与 Store 实际发布 | GitHub 已公开，源码推送、三项完整匿名回读及生产分平台选版记录见上；Partner Center APPX 已 Validated，后续须提交认证并按实际状态记录 Store 发布，不把包校验状态当作认证完成。 |

## Mac 接续与发行保持项

- Mac 严格按 [逐项交接 M001 起](MACOS_1.0.0_HANDOFF.md)执行共享改动、测试期修正与本机原生验收；共享变更合入不代表 Mac 已完成。
- Mac 1.0.0 三项资产齐全并完成本机签名、安装和公开回读前，继续选择完整 [Mac 0.6.9 发行基线](MACOS_0.6.9_RELEASE.md)，不误取 EXE/APPX，也不因 GitHub 全局 Latest 而产生空更新。
- Mac 本机同步自己的生成配置，保留固定签名指纹与受保护私钥；缺失或错配即失败，不自动生成、轮换或回退 ad-hoc。Windows 不写 Mac 专属源码、配置、缓存、图标或产物。
- 独立官网和服务端不随本轮桌面发行部署；私有源码、正式二进制、模型/依赖、用户数据和测试结果按各自既有边界处理。
