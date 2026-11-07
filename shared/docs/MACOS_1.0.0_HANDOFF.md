# VoxCue 0.6.9 → 1.0.0：macOS 逐项接续与验收清单

更新日期：2026-11-07。本文只记录变更、Mac 本机操作、预期和待办，不保存测试成绩、报告或运行产物。编号稳定，后续测试修复追加新编号。

## 基线、范围与执行边界

- 对照基线为私有源码 `be6784d047b4f5f3ca0bb62d8f5f6f374ba03985` 的 0.6.9；交接范围为该基线之后本轮最终源码差异，包括共享额度布局、网页活动域名胶囊与链接反馈、Windows Microsoft Store 渠道及验证期间纳入的修复。最终构建 SHA、提交和真实发布状态以本轮发行索引及 `PROGRESS.md` 为准；本轮目标为 1.0.0，不代表已经发布。
- `shared/package.json` 是 1.0.0 版本唯一来源。Windows 已有改动不能直接视为 Mac 本机验证；本文件也不宣称 Mac 原生、签名或安装验收完成。
- [0.6.9 交接](MACOS_0.6.9_HANDOFF.md)、[Mac 0.6.9 发行基线](MACOS_0.6.9_RELEASE.md)及[0.6.8 用量与生命周期清单](MACOS_0.6.8_HANDOFF.md)继续约束既有行为。本轮没有新增 RAG 算法、模型、索引兼容、账号迁移或签名身份变更。
- Windows 对 `macos/` 全树只读；Mac 接续时对 `windows/` 全树只读。所有 GUI、原生、推理和长稳在当前 UID 已登录且解锁的控制台串行执行；状态锁定或未知即停止。
- 只用 owner 临时合成账户、资料、图片和固定公开测试模型/音频；不读取真实账户或 Keychain 资料，不采样物理硬件。可复用的公开缓存先核对来源和摘要；profile、数据库及必要暂存位于系统临时目录，退出清理。结果仅终端/对话，不向工作区保存截图、trace、coverage 或测试报告。
- 清理先确认真实路径、入口、构建/测试消费者及占用，保留原件、现用依赖/模型、固定签名、凭据助手与正式发行恢复基线。独立官网与服务端不在桌面交接范围内。

表中共享组件简称均位于 `shared/src/components/`，摘要服务位于 `shared/src/services/`，共享烟测位于 `shared/test/scripts/`，共享单测位于 `shared/test/unit/`；平台文件给出完整相对路径。所有步骤均待 Mac 本机执行，不能用 Windows 结果填写完成状态。

## 共享额度显示与对齐

| ID | 文件、旧 → 新行为 | Mac 本机步骤与预期 |
| --- | --- | --- |
| M001 | `shared/src/styles.css`：低额度提示原来横跨头像列，改从邮箱文字所在列开始。 | 用五小时 71%、周 19% 的合成快照展开侧栏；测量邮箱、用量标题和数值行左边缘，预期一致。仍使用固定 230px 展开侧栏，不通过加宽侧栏或缩小字号容纳文字。 |
| M002 | `styles.css`：展开预警卡片的头像从只占邮箱行，改为跨邮箱及额度两行网格并垂直居中。 | 同 M001，比较头像垂直中心与邮箱至额度底边整块文字的中心；预期对齐。只返回单周期时使用原紧凑 flex 布局，头像也与右侧整块文字居中。 |
| M003 | `shared/src/services/accountUsageSummary.ts`、`AccountUsageSummary.tsx`：服务实际只返回一个 ChatGPT 周期时，低额度由“ChatGPT 用量”及周期名的两行，改为一行“ChatGPT 剩余 N%”。 | 分别只返回 300 分钟窗口与只返回 10080 分钟窗口；各检查 0、19、20、71%。预期所有数值均保持 provider 与剩余值同行，不生成缺失的另一个周期，不以返回 primary/secondary 的槽位猜周期。 |
| M004 | 同上：新增摘要 `inline` 仅适用于 `mode=sidebar`、ChatGPT、实际 `quotas.length=1`；不通过选中摘要只有一个值来猜单周期。 | 返回五小时及周两个健康周期，确认仍是原紧凑正常摘要；再把任一个设为低额度，确认展开双周期。两个周期的正常摘要即使只选中一个值，`inline` 仍为 false。 |
| M005 | `accountUsageSummary.ts`：单周期紧凑呈现不改变 `low` 与 `isAccountUsageLow` 的业务含义。 | 单周期依次返回 0、19、19.99、20、20.01%。预期严格低于 20% 才属低额度，0% 属低额度；显示整数向下取整，19.99% 显示 19% 而非 20%。不能为一行布局把低额度状态改成正常。 |
| M006 | `AccountUsageSummary.tsx`、`styles.css`：单周期低额度只给百分比内部 `.account-usage-percent.is-low` 标黄，不给整段“剩余 N%”标黄。 | 中英文及浅深主题分别看单周期 0%/19%；预期 provider 与“剩余”文字为既有正常辅助字色，只有 `0%`/`19%` 使用共享 warning 色。20%/71% 无黄色；不增加悬停说明。 |
| M007 | `AccountUsageSummary.tsx`：单周期根使用 `is-inline` 而不使用触发纵向布局的 `is-low`；低额度数值语义仍由摘要保留。 | 查看实际布局与 DOM；预期单周期 provider 和剩余值一行，外层 `small.account-usage-low` 的继承色不污染 provider 或“剩余”文字。只看根没有 `is-low` 不能判为没有低额度。 |
| M008 | `accountUsageSummary.ts`、`AccountUsageSummary.tsx`：双周期预警保持原显示选择及各自颜色。 | 逐一检查五小时/周 `[71,20,19,0]²` 全部组合；任一个严格低于 20% 时，预期第一行为“ChatGPT 用量”，第二行为“五小时 N% · 每周 N%”，真实存在的两个周期都显示，只有各自低额度值标黄。两者都不低时保持原正常摘要。 |
| M009 | 同上：0% 仍是真实耗尽值，100% 仍可与低周额度共同出现。 | 另验五小时 100%/周 19%、五小时 100%/周 0%、五小时 0%/周 71%。预期不把 0 当缺失、不隐藏健康周期；双周期数值行完整，不换成第三行或裁切百分比。 |
| M010 | `accountUsageSummary.ts`：单周期变化限定侧栏，默认 `summary`、开始面试的 `all` 模式及 Copilot 保持原行为。 | 用同一份单周期低额度快照分别查看侧栏、开始面试与原浮窗提示；侧栏采用新的一行，其他消费者沿用原标签/标题规则。切到 Copilot 低额度、不限量及未知状态，预期没有被套入 ChatGPT 单周期样式。 |
| M011 | `shared/src/components/Sidebar.tsx` 为既有消费者，无需新增独立实现；加载与连接状态继续由现有 store 管理。 | 覆盖正在读取、读取失败、空额度与断开连接；预期隐藏旧百分比，保留既有明确状态，不伪造 0%。切换 provider、刷新、退出和重启继续检查旧任务不写回。 |
| M012 | `styles.css`：预警网格选择器从外层 `.account-usage-low` 改为真正多行的 `.account-usage-summary.is-low`。 | 单周期低额度应走原 flex 卡片；双周期预警走新对齐网格。反复 19%→20%→19% 及单/双周期切换，预期邮箱仍省略长地址、头像和箭头不跳列，不残留多行空白。 |
| M013 | `styles.css`：预警网格仅在 `.sidebar:not(.collapsed)` 下启用。 | 在单周期低额度、双周期预警和正常状态分别收起/展开侧栏；预期收起时只有原头像按钮，文字/箭头保持隐藏，展开后对齐恢复。Mac 原生窗口控件所需收起宽度沿用本机既有 84px 规则，不移植 Windows 自绘侧栏宽度。 |
| M014 | `AccountUsageSummary.tsx`、`shared/electron/contracts/uiMessages.ts`：百分比片段按现有翻译完整文本切分，英文顺序沿用“19% remaining”。 | 中英单周期各检查 0/19/20/71%，预期英文为 `ChatGPT 19% remaining`，低额度只给前置百分比上色；中文为“ChatGPT 剩余 19%”。百分比处于字符串开头时不丢后缀、不重复数字；双周期英文沿用 `5h`、`Weekly`。 |
| M015 | `styles.css` 与既有共享主题参数：布局改动不更改字号、颜色令牌或无障碍名称。 | 中英 × 浅深 × 默认/最小窗口，检查长邮箱、五小时 100% 与 Weekly 19% 的完整度、标题与数值对齐和黄色辨识度；键盘打开用户菜单、Escape 关闭及焦点返回保持。Mac 实际材质和原生交通灯同时复核。 |

## 验证入口随行为更新

| ID | 文件、旧 → 新行为 | Mac 本机步骤与预期 |
| --- | --- | --- |
| M016 | `shared/test/unit/account-usage-summary.test.ts`：原“单周期侧栏等同普通摘要”的断言改为新侧栏契约。 | 在 Mac 完整单测中实际执行两种窗口 × 0/19/20/71% × 中英；预期只有侧栏单周期 `inline=true`，仅低额度带 percent 片段，summary/all 不带该片段；Copilot 保持原行为。 |
| M017 | `shared/test/unit/account-usage-ui.test.tsx`：增加单周期组件呈现与双周期保留断言。 | 核对可见全文、ChatGPT 标题、只有低百分比内部有 warning class、20% 边界无 warning；双周期仍有展开根及周期标签，健康五小时值不标黄。静态 render 断言不能代替本机真实像素与几何。 |
| M018 | `shared/test/scripts/free-service-smoke.mjs`：单周低额度旧文案改为紧凑剩余值；新增单行/双行区分及邮箱/头像几何断言。 | 在 Mac 执行原烟测；预期单周期同行、双周期标题在数值上方，提示起点与邮箱一致，头像与文字整块居中。保持原数值行不裁切断言及浅深色检查，不放宽阈值绕过失败。 |
| M019 | `free-service-smoke.mjs`：单周期低额度改验内部百分比黄色，整段值与标题不得黄；双周期沿用整周期值各自颜色。 | 分别观察单周 15%、五小时 100%/周 19% 及两者低额度；确认测试实际走到了单周期和双周期分支。原最小窗口、中英最长双周期和开始面试弹窗检查继续执行。 |
| M020 | `shared/test/scripts/account-usage-overview-smoke.mjs` 为未改动的完整展示消费者。 | 保留 16 双周期、8 单周期、Copilot 及连接异常场景；开始面试的 all 模式预期不因侧栏改动而改写。不得把 all 模式汇总图当侧栏布局验证。 |
| M021 | `macos/test/scripts/ui-refinement-matrix.mjs` 使用现有五档入口，不从 Windows 复制专属夹具。 | 本机先 `--list` 核对名称，再完整执行 100/125/150/175/200% 五档，至少逐档关注 free-service、account-usage-overview、language、ui-alignment、typography；不通过修改系统缩放或缩减原矩阵完成验收。 |

## Windows Microsoft Store 渠道与 Mac 保持项

| ID | 文件、旧 → 新行为 | Mac 接续动作与预期 |
| --- | --- | --- |
| M022 | `shared/electron/backend/updates/driver.ts`：Windows Store 进程不创建独立安装版的 electron-updater 驱动。 | 这是 Windows 专属分流，Mac 不补 `windowsStore` 开关、不切 Microsoft Store 更新。Mac 继续使用 `macos/electron/updates/driver.ts` 的既有本机适配器，核对启动装配仍选中该驱动。 |
| M023 | `shared/electron/contracts/updates.ts`、`uiMessages.ts`、`UpdatesPanel.tsx`：Store 不可用状态显示中英商店更新说明，并禁用自动下载开关。 | 共享页面保留这条契约及译文；正常 Mac 安装包不应显示 Microsoft Store 文案，也不应因此禁用自动下载。用合成正常 Mac 状态核对关于与更新页的开关、检查、下载和安装入口。 |
| M024 | `shared/electron/main.ts`：Store 进程不覆盖由包身份提供的 AppUserModelID；独立 Windows 安装版保持既有设置。 | 属 Windows 任务栏/包身份差异，Mac 无需移植。Mac 继续核对 launcher、菜单、窗口恢复及固定 bundle identity，不增设 Windows 标识。 |
| M025 | `windows/scripts/package-store.mjs`、`StoreAssets.cs`、`windows/package.platform.json`：增加 Windows x64 APPX 打包入口和透明图标资源。 | Windows 专属，无需新增 Mac APPX、商店身份或图标生成器；`windows/` 只读。共享应用版本为 1.0.0，Store 身份版本为独立打包元数据 `2.0.0.0`；不能把其主版本加一/末位零规则套到 Mac CFBundleVersion。 |
| M026 | `windows/scripts/package-portable.mjs`：增加互斥的 Store staging、路径/链接约束，APPX 排除 mammoth 的 Word 测试夹具，并仅在匹配 Electron ZIP 存在时使用缓存目录。 | 都是 Windows 打包逻辑，Mac 不复制这些过滤或缓存路径。本机继续检查正式包内运行时与所需解析资源完整；不能据此删除 mammoth 运行文件、既有 SDK、模型或 Mac 打包消费者。 |
| M027 | Mac 独立更新没有本轮新增产品行为，继续承接 0.6.9 的缓存、签名及恢复要求。 | 执行本机 updates-native 及签名包测试：一小时检查缓存、失败重放、5 秒强查、完整包离线恢复、自动下载关闭仍可恢复、中断清理/冷却、异步退出与 Sparkle 校验都保持。普通退出不得自动安装，安装前仍完成保存。 |
| M028 | Windows 1.0.0 与 Mac 资产可分先后发布，不改变本平台完整稳定资产选择。 | Mac 1.0.0 资产齐全前继续选择公开完整 Mac 0.6.9，不误取 Windows EXE/APPX，不因 Latest 标签产生空更新。Mac 发布时必须同时核对 DMG、更新 ZIP、签名清单的版本/平台/架构和摘要。 |

## Mac 本机配置、安全与发行待办

| ID | 文件、旧 → 新行为 | Mac 本机步骤与预期 |
| --- | --- | --- |
| M029 | `shared/package.json`：应用版本由 0.6.9 升至 1.0.0；根及当前平台配置由同步脚本生成。 | 拉取后从仓库根执行 `pnpm sync:workspace`，只生成根和 macos 当前平台配置；不要手改 `windows/`。核对 macos 的 package.json、tsconfig.json、tsconfig.electron.json、tsconfig.contracts.json、vite.config.mjs、pnpm-workspace.yaml 所有只读待同步项；`.npmrc` 若有实际漂移也交本机同步。不升级依赖/模型，不在根或 shared 安装 node_modules。 |
| M030 | 完整单测与边界检查沿用，不能把 Windows 上条件跳过视作 Mac 已验证。 | Mac 实际执行 interview-images 的文件符号链接拒绝与 user-data 的 SingletonLock 符号链接用例；同时保持目录链接/路径逃逸、主 frame/窗口 IPC、凭据加密拒绝回退、OAuth/受控 RPC、Markdown 与更新安全断言。 |
| M031 | 英文检测继续覆盖字面键、占位符、用户内容保留及实际界面泄漏/裁切。 | 执行 ui-language 单测和 language/settings 烟测，检查新增 Store 译文词表完整且正常 Mac 不显示该状态；单周期百分比前置由新组件单测及实际英文侧栏复核。用户内容和原始服务错误不得被强行改写。 |
| M032 | 功能与稳定性范围保持完整，不因本轮只改额度布局而减掉发行检查。 | 执行当前共享功能与 Mac 原生默认矩阵，保留账号/登录、资料/技能、聊天、知识库/RAG、同步/导出/删除、记录、截图/权限、音频/AEC、模型切换、组件、更新、安全对抗；RAG 只核对原调用链和行为，不调整模型、阈值或检索策略。 |
| M033 | `interview-stability-smoke.mjs` 与 `speech-soak.mjs` 保持原轮次/时长。 | 在 Mac 单独关注 20 轮面试及 600 秒固定公开音频的真实 ASR/VAD 双路长稳；不得缩短到脚本直接运行的默认时长，不以合成 Provider 证明真实 AI 账号或物理音频。 |
| M034 | Mac 签名与包身份沿用固定公开指纹及受保护本机私钥。 | 先执行 development-signing 检查，再本机正式打包。身份缺失/错配须失败，禁止新建、轮换或 ad-hoc 回退；不读取/提交私钥内容，不把 Windows 签名或包验证当作 Mac 成绩。 |
| M035 | 正式资产与源码分开交付。 | 源码只提交审核后的代码/文档；Mac DMG、ZIP 和签名清单在本机按现有入口构建、验包和公开回读。不提交依赖、模型、用户数据、凭据、构建中间物或测试结果；正式恢复基线继续保留。 |
| M036 | `shared/test/scripts/server-reference.mjs` 是客户端联调参考的 owning source；旧说明中的 0.5.2/shared/server 位置不能作为当前指令。 | 在 owner 系统临时目录准备原样只读 `VoxCue-server` 0.5.3、完整提交 `3bceb615dbba900f669322c301fc4b5b473dfb15` 的参考，并显式设置 `VOXCUE_TEST_SERVER_ROOT` 指向它。相邻工作副本若已是 0.5.5，不回退、不改写，也不以它替代固定参考。先核对 package 版本、HEAD 及受控文件无修改；客户端夹具仅使用临时合成数据库、内存邮件和自有 loopback，不执行后端套件、不修改服务器业务、不操作生产。参考副本退出清理；环境不匹配应先修正参考路径，不能放宽校验。 |

## 本轮追加的验证覆盖与入口修正

以下是已落地的测试/说明变化及其待验要求，不代表新增产品功能或已完成 Mac 验收。

| ID | 文件、旧 → 新行为 | Mac 接续动作与预期 |
| --- | --- | --- |
| M037 | `shared/test/unit/update-cache.test.ts`：新增对真实共享 Windows 更新驱动源码的隔离动态装配，分别验证 Store 与 NSIS 身份。 | 在 Mac 完整单测中保留这组纯隔离测试，预期 Store 即使存在合成 app-update.yml 也不请求 electron-updater 单例，NSIS 仍装配固定 feed/provider；不启动真实更新或读取正式凭据。该测试是 Windows 分流回归，不能替代 M027 的 Mac 原生驱动验收。 |
| M038 | 同一单测把 Store 无驱动结果接入实际 `UpdateService`，补齐强制检查、下载和安装拒绝路径。 | 预期所有调用保持 unavailable、没有可用版本、返回商店更新说明，安装准备与状态事件均不被误触发。保留原更新缓存/恢复/取消的所有断言；Mac 普通安装版的自动下载、强查、恢复和安装仍用本机 driver 继续验证。 |
| M039 | 新增 `windows/test/scripts/store-artifact-smoke.mjs` 与 Windows `test:store:artifact` 入口；根和 Windows 的 package.json 由平台同步脚本生成。 | Windows 专属，Mac 不执行或移植，不修改 windows 树。该入口核对最终 APPX 的身份/版本/x64、manifest/图标透明资源、无 NSIS feed、必要原生文件、无异平台/模型/凭据/开发入口，以及实际打包窗口沙箱、preload 白名单和打包登录测试入口拒绝；它不执行安装。Mac 仍按本机签名、DMG/ZIP、正式 ASAR 及原生运行时入口独立验包。 |
| M040 | `shared/test/README.md`：完整矩阵从过期固定组数改为当前 `--list`；联调说明从旧 0.5.2/shared/server 改为固定 0.5.3/3bceb615 与显式引用选择。 | 本机按当前调度器列出的全部组执行，不照抄旧组数或减少轮次；联调参考按 M036。说明仅纠正 owning source 和环境前置条件，不变更服务器业务。旧相邻 checkout 与历史参考保持原样，客户端仍仅创建临时合成资料和自有 loopback。 |
| M041 | `windows/test/scripts/qwen-fixtures.mjs`：固定公开测试音频从每次直接联网，改为本平台缓存命中先重验摘要；WAV 保留原三个摘要，TXT 新增同一上游 revision 原始字节的三个固定摘要。每次 fetch 有 30 秒超时，HTTP 错误明确包含状态码/资源名；认证后经随机 partial 和 rename 发布缓存，finally 清 partial。 | Windows 专属夹具，Mac 不复制 Windows 路径、缓存或产物，不因此改变生产 Qwen/ASR、模型、文本修整或 continuousWave 行为。若本机对应资源入口需要同类修复，只在 Mac 本机按其 owning fixture 接续：固定上游 `c5ef09646af6278d2ba8b8ceaf543ffb32d1a5dc`、WAV/TXT 原始摘要、缓存损坏明确拒绝而不静默覆盖、网络期限及所属 partial 清理；实际推理副本仍在 owner 临时目录。公开资源缓存可复用，合成账户/资料和测试结果不得进入缓存。 |
| M042 | `shared/test/scripts/desktop-guard.mjs` 新增小型运行期守卫，供 `functional-suite.mjs` 与 `windows/test/scripts/windows-suite.mjs` 复用；原 Windows 外层仅组前核对，改为所属 child 运行中每 2 秒复核。`desktop-guard.test.ts` 用假 child/计时覆盖失锁、探针错误、零码退出仍保留错误及释放。 | Windows 共享独占组、DPI 和原生矩阵在锁定、未知或 probe 报错时仅终止本轮拥有的 child，保留原始失败并停止后续组；退出、启动错误和超时清理 interval，已知失锁不再移动指针，恢复指针的异常不能掩盖先前失败。原 600 秒、20 轮、超时及隔离 Node 协议并行规则保持。Mac 保留现有平台守卫/会话装配，不复制 Windows probe 或改权限/防锁设置；本机验证 helper 接入既有 GUI 外层，并审查单独只运行 headless 原生/长稳时的会话守卫，不以 Windows 新守卫代验该路径。 |
| M043 | 新增 `windows/test/scripts/store-sandbox-smoke.mjs` 与 `test:store:sandbox`，用于正式 Store APPX 的可丢弃来宾安装及真实包身份更新 IPC 检查。 | Windows 专属，Mac 不执行或移植。该入口仅在来宾创建/信任测试签名证书，宿主正式包保持原字节；断网、禁音视频/剪贴板/打印机的来宾中检查实际 `process.windowsStore`、包身份版本和应用版本、正式本地账户及 preload/IPC 的 Store 更新拒绝。缺少环境、身份或调试能力必须失败，不能以普通 EXE 或模拟标志代验。它不等同微软商店认证/分发验收；Mac 仍按 M034–M035 验证自己的签名安装包。 |
| M044 | `store-sandbox-smoke.mjs`：复核发现通用测试临时目录标记在 Sandbox 关闭失败时可能被后续通用回收器误认领，改为专用 `voxcue-store-sandbox-` 前缀、专用 owner marker/kind，并在自清理时核对 kind、nonce、PID、真实临时父路径及无链接。 | Windows 专属安全修复，Mac 不运行 Sandbox。复核共享临时回收器只认领自身约定目录，不能把仍映射到外部进程、退出状态未知或归属未知的目录作为死 owner 垃圾删除；Windows 失败保留目录不再满足通用恢复清理条件。 |
| M045 | `store-sandbox-smoke.mjs`：Sandbox 功能预检由要求管理员权限的 DISM 查询，改为只读 `Win32_OptionalFeature` 的存在及 `InstallState=1` 检查。 | Windows 专属，不启用系统功能或触发 UAC；缺少/未启用时明确失败。Mac 不移植该 WMI 查询。M043 的包身份运行使用微软调试命令，其令牌与正常 AppId 激活不完全相同，只证明已安装包身份下的实际代码、preload 与 IPC；不能代替开始菜单激活、真实隐私权限或 Store 分发验收。 |
| M046 | `shared/test/scripts/free-service-smoke.mjs`：在既有英文双周期检查之后，新增实际界面的单周期矩阵：300/10080 分钟窗口 × 0/19/20/71% × 浅深主题；最小窗口 helper 接受 inline 参数，显式截图名称增加 `-single` 以区别双周期。 | Mac 在本机五档完整矩阵中保留这些共享场景：英文全文为 `ChatGPT N% remaining`，仅低于 20% 时前置百分比标黄，标题及“remaining”正常色；各状态仍核对一行、邮箱左对齐、头像居中及完整可见。两个周期各在 19% 检查最小窗口，helper 在 finally 恢复窗口尺寸；截图分支重新打开设置后返回 AI services，矩阵结束切回简体中文/AI 服务，再继续原双周期及面试验证。场景扩展不改变生产额度逻辑，也不替代 Mac 原生、真实账户或其它五档项。 |
| M047 | `shared/src/components/ResponseProgress.tsx`：实际网页活动行的旧下划线 URL 按钮改为复用 `SourceLink` 的域名来源胶囊/favicon；`sourceLink.css` 在活动行继承其字号，并按既有 12px 胶囊比例缩放内距、最小高度、间距和图标；两平台图标适配器均写固定 inline size，活动行局部 SVG 的宽高用带说明的 100% !important 跟随图标槽，未更改全局图标 API 或 Mac 树。`styles.css` 移除无消费者的旧按钮样式，保留活动详情缩进；`source-favicon.test.tsx` 补实际活动、中英、无效来源及普通正文隔离回归。 | Mac 本机用真实共享活动夹具检查“正在/已读取网页”和“查找网页内容”的域名胶囊，既有标题及活动状态不变。中英浅深、默认/最小窗口及五档缩放下，胶囊字号与该状态行一致，圆头/背景/焦点及 favicon 失败回退沿用来源组件，长域名不越界，无新增悬停提示。实际链接保留原 URL 并继续走受控 `openChatLink`/IPC 安全校验，非法协议或含凭据地址不生成链接/图标请求；消息原数据及原文复制保持。普通正文 URL 不扩大为胶囊。重建后串行执行 `chat-progress-smoke.mjs` 及对应五档界面复核：新增两处域名/href、字号与胶囊/图标比例及完整显示断言；实际点击仅由临时 opener 收集，仍走生产 IPC 并验证危险 URL 拒绝，finally 恢复端口。保留活动展开/收起、最终原文、失败反馈及来源图标等旧断言；显式要求截图时才导出 `progress-page-pill-light/dark`，不以静态 render 代替本机视觉/交互。 |
| M048 | `windows/test/fixtures/WindowProbe.cs`：测试停车先记录真实 anchor，注入单次可观察的相对移动，有界等待消费后再最终绝对定位；保留原 90ms 和精确 x/y 断言。 | Windows 专属夹具，Mac 不复制 Win32 注入、常量或系统设置。原先单像素异步事件可能晚到终点定位之后；单像素也可能无法形成可观察位移，因此改为一次较明确的相对移动，仅将其作为消费确认，不承诺中间物理位移。锁定、超时或最终坐标不符仍明确失败，不追加多次输入、不放宽容差、不恢复已撤回的坐标归一化；外部鼠标操作继续视为干扰并停止测试。Mac 本机保留自身原生指针和前台归属守卫。 |
| M049 | `shared/src/styles.css`：启用的真实 `a[href]` 及嵌套 strong/span 从普通正文默认/I-beam 改为手形，普通正文链接 hover/focus-visible 用既有主题色产生文字反馈并保留键盘轮廓；`sourceLink.css` 来源胶囊沿用 hover 背景/字色反馈并覆盖 focus-visible。`continuous-corners.mjs` 同步新光标契约：真实启用 href/来源胶囊及其子节点预期 pointer，普通按钮仍 default，禁用/无 href、普通正文 text 和预览例外不放宽。 | 本机重建后执行 `chat-response-smoke.mjs` 与 `chat-progress-smoke.mjs`，再在五档缩放下复核浅深主题：普通标题超链接、其 strong 子文本、正文来源胶囊、来源列表按钮和活动胶囊均为手形且 hover 字色可辨，真实键盘 Tab 往返后 focus-visible 轮廓清晰。普通正文仍为 text；禁用/aria-disabled、无 href 的锚点及其子元素不套用手形，fixture 用临时 inert 节点核对后清理。链接 href、受控打开、安全校验、消息原文复制及转换范围保持，无新增 tooltip。`chat-response` 的普通链接夹具使用真实 Markdown 粗体子元素，不通过注入产品 CSS 制造预期；仅用户要求截图时输出对应 hover 画面。 |
| M050 | `windows/test/scripts/windows-suite.mjs`：五档矩阵新增 `chat-progress` 与 `chat-response` 可选/默认组，覆盖网页活动胶囊及真实超链接悬停回归。 | Mac 现有矩阵已包含两组；本机执行 `node test/scripts/ui-refinement-matrix.mjs --suite=chat-progress,chat-response`，保留默认五档、中英浅深、图标比例和真实受控链接检查。该定向重测用于本轮新增链接变化，不能省略原完整矩阵，也不能把 CSS 静态规则代替真实 hover、focus-visible 和子节点手形检查。 |
| M051 | `shared/test/scripts/settings-smoke.mjs`：退出菜单图标像素探针在暂停动画及设置 currentTime 后，与独立 live SVG 参考采用同样的两次 requestAnimationFrame 绘制屏障，再测几何和抓取原生像素；同一冻结退出快照增加不改 DOM 的 A/A 重复捕获。 | Mac 本机按原五档、浅深主题执行 settings：先要求冻结快照 A/A 的 rect、DPR、clip、尺寸、scaleFactors 及字节数一致且最大通道差不超过 2，再保留原退出/参考最大差不超过 2、图标可见性和全部几何断言。该项修正测试探针的绘制同步，不改生产 snapshot、图标或阈值；像素不稳定时仍应失败，不能挑选较好帧或以 Windows 结果代替 Mac 真实 SVG/mask 复核。 |
| M052 | `shared/test/scripts/chat-response-smoke.mjs`：新增 hover 检查原先在 blur/move 和真实 hover 后立即取色，可能采到既有 button 180ms 颜色过渡的起点；改为先等非 hover/无 focus-visible 的基线及有限动画稳定，再真实 hover 并等待命中、有限过渡结束且字色确实改变。 | Mac 本机用普通正文链接、内联来源和来源列表按钮分别重测浅深主题及五档：hover 仍只实际触发一次，不注入 CSS/伪状态，不放宽颜色必须改变、手形及键盘焦点断言。超时输出 theme、link 类型/tag/href、hover/focus/命中/窗口焦点、实际颜色/背景及动画状态后失败；不靠固定睡眠、挑选较好帧或吞错通过。此项只同步真实界面反馈的测试时序，不修改产品颜色、过渡或链接业务。 |
| M053 | `shared/test/scripts/chat-response-smoke.mjs`：读取活动的旧“example.com/docs”可见全文等待改为新胶囊契约，定位实际 open_page 活动中的域名胶囊，同时精确校验完整 `https://example.com/docs` href。 | Mac 本机执行原状态阶段回归及五档：可见标签只显示 `example.com`，实际链接地址仍完整；不能为等待成功删掉 href 校验或改变 backend activity 的 detail/URL 数据契约。共享测试中同类旧可见文本假设须按 owning consumer 区分，不改本来验证原始元数据的单测。普通正文链接的显式截图交付增加同 locator 的 `chat-link-normal-light/dark`，与既有 hover 图配对；普通回归不导出图片。此项只同步已批准的新呈现与测试，保留状态轮次、时限和全部 hover/安全断言。 |
| M054 | `windows/scripts/package-store.mjs`：Store 打包入口先直接赋空 `CSC_LINK`、`WIN_CSC_LINK`、`CSC_KEY_PASSWORD`、`WIN_CSC_KEY_PASSWORD`，再动态导入 electron-builder 并启动 package-portable，阻断库初始化或 fallback 急切求值读取宿主签名输入；不读取、备份、输出或恢复这些变量原值。 | Windows 专属构建隔离，Mac 不移植清空本机正式签名环境，不改变固定签名身份或私钥使用要求；独立 Windows NSIS 打包入口也不变。复核 Store 构建本身与其子进程只看到这四个空值，APPX 仍由商店处理正式签名；来宾临时签名仅用于 M043 的隔离安装验证，不作为正式签名回退。 |
| M055 | `windows/test/scripts/store-sandbox-smoke.mjs`：宿主 Windows PowerShell 5 预检曾继承调用方 PowerShell 7 的模块搜索路径，误选不兼容的 Security 模块；现先移除子进程环境中 `PSModulePath` 的大小写变体，再仅向该子进程指定 Windows PowerShell 自身的官方 `Modules` 路径，并显式使用 UTF-8 输出和静默进度。 | Windows 专属测试运行时隔离，Mac 不复制 Windows 模块路径，不修改宿主 `PSModulePath`、ExecutionPolicy、模块、证书或系统配置。若本机夹具跨运行时启动工具，应按其 owning source 隔离子进程的工具/模块查找；保留错误即失败、签名必须 Valid 和发布者必须匹配的严格断言，不能通过静默错误或放宽信任条件绕过预检。此项不改变应用安装包及 M043 的真实来宾安装验证要求。 |
| M056 | `windows/test/scripts/store-sandbox-smoke.mjs`：Windows PowerShell 5 来宾曾按默认 ANSI 解码无 BOM 的 UTF-8 `config.json`，中文商店说明导致 JSON 未终止字符串错误；配置、运行时 JSON 及诊断文本现均显式按 UTF-8 读取，诊断重定向也显式写 UTF-8。 | Windows 专属来宾脚本修复，Mac 不沿用 ANSI 或依赖隐式编码检测；本机测试工具跨运行时传递中英文 JSON/诊断时应明确统一 UTF-8。保留 JSON 解析、版本/身份、Store 标记及更新禁用的严格失败条件，不替换中文内容、不吞解析错误，不改变产品 APPX 或认证/安装流程；实际安装验证继续按 M043，在 owner 临时来宾内执行并退出清理。 |
| M057 | `windows/test/scripts/store-sandbox-smoke.mjs`：现代 Windows Sandbox 的官方 CLI 即使没有 VM 也会保留 Server daemon；现以 `wsb list` 的严格 GUID 列表或空输出判断活动 VM，启动前要求零 VM、零 RemoteSession，启动后只有唯一新 ID 与本轮 launcher 的 RemoteSession 父链、PID/创建时间及路径同时确认才认领 VM。退出仅用官方 `wsb stop --id` 停止该 ID，确认其消失后才按原父链、PID、创建时间及路径精确关闭可能残留的本轮 viewer；不停止 daemon、其他 VM 或未知进程。owner stop nonce 只使测试失败，不能产生通过结果；VM 与本轮 UI 未确认退出时保留临时映射并报错。 | Windows 专属测试生命周期修复，Mac 不移植 Windows CLI 或进程名；本机隔离运行器须区分服务与实际实例，按可验证归属清理自有资源。保留解锁控制台守卫、正式 APPX 原字节摘要、nonce、真实 Store 身份/preload/IPC 及更新拒绝断言；不能把空 VM 列表等同于必须没有后台服务，也不能按进程名前缀批量杀进程或清理仍在映射的目录。此项只修测试，产品包、宿主证书、账号和系统配置保持。 |
| M058 | `windows/test/scripts/store-sandbox-smoke.mjs`：WinPS 5 直接调用 Node 并重定向 stderr 时，`ErrorActionPreference=Stop` 曾把首行原生错误转换为终止异常，丢失后续诊断；来宾现用 .NET ProcessStartInfo 以固定 Node/脚本路径及 owner 工作目录启动，禁用 shell 并发异步读取完整 UTF-8 stdout/stderr，有限等待、超时终止自有 inspector，并在非零退出时将退出码与完整双流诊断明确报错。 | Windows 专属验证工具修复；Mac 仍须按本机运行时完整保留原生子进程诊断并避免双流管道死锁。退出码、超时、JSON、Store 身份及实际 preload/IPC 断言继续严格失败；不把启动早期异常当作成功或改用 Mock，不修改应用 bootstrap 或正式 APPX。该项只保证能定位真实失败，不能据此宣称真实商店运行时已通过。 |
| M059 | `windows/test/scripts/store-sandbox-smoke.mjs`：`--inspect-brk` 的初始暂停原先只调用 Runtime.runIfWaitingForDebugger，Electron 尚未真正继续 bootstrap 就读取 resourcesPath；inspector 现先启用 Debugger 并捕获最初 Debugger.paused，显式 Debugger.resume，再在统一有限 deadline 内等待实际 process、非空 resourcesPath 与 getBuiltinModule 就绪，之后才构造 require 并查询 app ready；每次 CDP 命令也受剩余期限约束。 | Windows 专属隔离验证启动协议修复；Mac 若使用同类 CDP 初始暂停入口，须区分解除等待与继续执行，并等待真实运行时就绪。不得给 process/Electron 生产属性赋值、注入模拟 electron、跳过 bootstrap 异常或伪造结果；保留实际 windowsStore、packaged、版本、临时 userData、真实 preload/IPC 和独立更新驱动拒绝的全部断言。该项不改产品 bootstrap 或正式 APPX，也不代表 Store 本机验收已完成。 |
| M060 | `windows/test/scripts/store-sandbox-smoke.mjs`：Invoke-CommandInDesktopPackage 不继承启动 PowerShell 的环境，原来宾 `$env` 赋值无法隔离正式应用 profile；现移除该无效入口，在已捕获的最初 Debugger.paused 且 resume 之前，仅通过 Runtime.evaluate 设置本轮 `COPILOT_TEST_USER_DATA=$work\profile`、空 `VOXCUE_ACCOUNT_API`/`VITE_DEV_SERVER_URL` 并删除 `ELECTRON_RUN_AS_NODE`，精确核对四项状态后继续实际 bootstrap，由原 main 逻辑读取输入并选择临时目录。 | Windows 专属测试输入隔离修复；Mac 不照搬 DesktopPackage 或修改真实账户环境。这里仅设置合成夹具环境输入，不直接调用 app.setPath，也不改 resourcesPath、windowsStore、packaged、版本或任何业务结果；保留实际 userData 必须等于 owner 临时 profile 的严格断言，正式 auth:demo 拒绝守卫也不变。实际应用必须按自己的启动逻辑消费输入，不能靠暂停后改路径、伪造 API 或放宽断言通过。 |
| M061 | `windows/test/scripts/store-sandbox-smoke.mjs`：初始暂停中的环境表达式本为同步操作，现明确以 `awaitPromise:false` 求值，精确核对隔离输入后才 resume；后续实际业务求值仍等待 Promise。所有求值按 initial-env、bootstrap、app-ready、login-ready、enter-local、update-status、update-actions、driver、quit 标记阶段，CDP 错误、超时及表达式异常包含阶段标签。 | Windows 专属 CDP 验证时序及诊断修复；Mac 同类夹具须区分暂停中的同步表达式与继续执行后的异步业务，不能让 paused runtime 等待无法推进的 Promise。标签仅指明固定阶段，不读取额外环境或敏感值；原 deadline、退出码、profile、实际身份/版本、preload/IPC 和驱动拒绝断言保持，不伪造运行时状态或跳过失败。 |

## 本机执行顺序与入口

以下命令均为待执行步骤，不是已运行记录。除注明仓库根外，工作目录为 `macos/`；GUI、原生、推理和长稳之间保持串行。共享调度器只允许其已审计的隔离 Node 协议组并行，若需全串行可显式使用 `--jobs=1`。

1. 检查本机 `git status`/`git diff` 与接续 SHA，保护后续工作；在仓库根运行 `pnpm sync:workspace`，再回 `macos/` 核对本机生成差异。按 M036 准备固定只读 0.5.3 参考并显式设置 `VOXCUE_TEST_SERVER_ROOT`，再启动任何依赖它的客户端联调入口；具体版本/提交约束以当前 `server-reference.mjs` 为准。
2. 运行 `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:workspace`、`pnpm test`、`pnpm audit`，然后 `pnpm build`。依赖只沿用本机现有锁，不通过升级隐藏问题。
3. 运行 `node test/scripts/desktop-session-smoke.mjs`；确认当前控制台已登录且解锁后再执行后续 GUI/原生入口。守卫失败即停止。
4. 先用 `node ../shared/test/scripts/functional-suite.mjs --list` 核对当前完整组，再运行 `node ../shared/test/scripts/functional-suite.mjs --jobs=1`。该默认入口包括 `interview-stability` 的 20 轮和 `speech-soak` 的显式 `--seconds=600`；必须保留全部现有组及非零失败状态。
5. 定向追踪本轮额度显示可运行 `node ../shared/test/scripts/functional-suite.mjs free-service account-usage-overview language settings ui-alignment typography --jobs=1`。出现问题按 owning source 修复再重测，不能删除旧断言或缩减场景。
6. 五档视觉先 `node test/scripts/ui-refinement-matrix.mjs --list`，再完整运行 `node test/scripts/ui-refinement-matrix.mjs`。默认五档为 1、1.25、1.5、1.75、2；保留现有所有 suite，实际核对 M001–M021 的中英浅深、最小窗口、头像、邮箱、百分比和真实材质。只重跑单组时可用现有 `--suite=free-service,account-usage-overview,language`，单组不能替代完整矩阵。
7. 需要单独重测稳定性时运行 `node ../shared/test/scripts/functional-suite.mjs interview-stability speech-soak audio-pipeline adversarial --jobs=1`，由调度器准备固定公开资源并传入原 600 秒时长；不要直接省略 `speech-soak` 的时长参数。
8. 本机更新与身份关注 `node test/scripts/updates-native-smoke.mjs`、`node test/scripts/development-signing-smoke.mjs`，并保留默认矩阵的 launcher、window-native、screen-permission、native-build 等检查。真实权限/硬件或自动化宿主无法覆盖的隐藏恢复按本机条件另行验收，明确其未覆盖范围。
9. 执行 `pnpm package:installer`。对本次准确 release 目录使用 `VOXCUE_TEST_RELEASE_DIR` 指向最终资产后，串行执行 `node test/scripts/package-runtimes-smoke.mjs`、`node test/scripts/package-smoke.mjs --install-archive`；核对固定签名、公钥、arm64、正式打包内容、安装归档与摘要，而非另建测试包代替最终包。
10. Mac 资产公开完成后，在同一准确版本范围运行 `node test/scripts/package-smoke.mjs --install-archive --online`，匿名回读本平台完整资产并验证签名/摘要。更新最终发行索引与 `PROGRESS.md` 的真实状态，本文只保留需求、步骤和未完成待办。

后续新增项目从 **M062** 起追加，不重排上述编号。最终 SHA、Windows/Mac 发布状态和资产定位由发行索引承接，不在本清单记录测试分数或临时产物。
