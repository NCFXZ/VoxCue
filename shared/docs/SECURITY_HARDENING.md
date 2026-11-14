# 桌面安全与任务生命周期加固

本文保存已发布 Windows 1.2.0 及后续沿用的安全与生命周期边界。原始逐项共享记录见[固定 Git 历史](https://github.com/NCFXZ/VoxCue/blob/bc53d15431d0984b7d79c59c77e279e1500f03a5/shared/docs/MACOS_1.2.0_HANDOFF.md)，当前执行范围以根 PROGRESS.md 为准；Mac 当前实现见 [1.2.3 说明](MACOS_1.2.3_RELEASE.md)，正式包门禁见 [guest 准备](../../macos/docs/TEST_GUEST.md)。未发布 Mac 中间版本的接续与候选凭据专项不再作为当前入口，测试结果只在终端／对话报告。

## 正式包与更新

- 正式包不读取开发页面、账号 API 或测试资料目录覆盖，不编入产品测试标志。开发页面仅允许 loopback；测试 owner 只接受已知开发宿主与 owner 目录内的入口，或经过严格校验的 inert 安装夹具。开发离线夹具仍在导入应用前设置自己的临时目录与网络边界。
- Chromium session 默认拒绝网页权限；只允许本应用主 frame 的剪贴板写入。音频与截图仍通过受控原生端口。正式 CSP 不允许任意 loopback 连接，开发服务器按 serve 模式加入所需连接。
- Windows 打包关闭 RunAsNode、NODE_OPTIONS 和 Node inspector，启用 ASAR 完整性与仅从 ASAR 加载，并核对生成 EXE 的实际 fuse 位。ASAR 完整性不替代外置原生组件的独立验证。
- Windows 剩余启动边界：`NodeCliInspect` 只限制 Node inspector，不关闭 Chromium renderer CDP。隔离验包仍可显式以 `--remote-debugging-port` 启动并在合法主 frame 中调用 `window.desktop`；无参数默认不监听，第二实例参数被忽略，通常需控制首次启动或重启。Windows 同用户已可读取 profile／使用其 DPAPI 能力，本项未认定为新增 OS 提权，也不阻断当前发行；五项 fuses 不能称为防御同用户恶意程序的完整边界。Mac 正式启动链独立拒绝相关调试参数，最终包验收使用下述隔离 guest 入口。[Electron CDP 启动参数](https://www.electronjs.org/docs/latest/api/command-line-switches#--remote-debugging-portport)、[Electron 44.10.0 Node inspector fuse 定义](https://raw.githubusercontent.com/electron/electron/v44.10.0/docs/tutorial/fuses.md)。
- Windows 的 LanceDB／ONNX 原生模块随包附带固定 x64 VC++ CRT 14.44.35211，放在相应绑定目录中，不依赖系统预装或新增全局 DLL 搜索策略。`windows/vc-runtime.json` 固定微软官方 VSIX、内嵌 redist／CAB、逐 DLL 及原许可证的 SHA-256；构建脚本仅静态提取并认证，公共源和认证缓存位于本平台 `.cache/vc-runtime`，不运行 redist 或 MSI。原微软许可保留于最终 `resources/licenses`，SDK／模型版本保持。
- Windows NSIS 更新清单中的目标文件包含 `voxcueSignature`。Ed25519 签名采用固定数组编码与 `voxcue-windows-update-v1` 用途隔离，绑定 Windows x64、版本、文件名、大小、SHA-512 与最低系统版本。
- 网络清单、持久缓存、恢复及安装前均重新认证；签名缺失、错误或未认证旧缓存不回退到仅摘要验证。新缓存使用独立 namespace，旧缓存不迁移为可信。NSIS 完整文件摘要、显式安装和保存握手继续使用现有实现。Store 不使用 NSIS 更新。
- 公钥唯一来源为 `windows/update-public-key.json`；打包在 ASAR 创建前将配置放入 `dist-electron/windows/electron/voxcue-update.json`，运行时只读取 ASAR 内配置，不信任资源目录外置公钥。私钥只在 owner 保护的忽略目录 `windows/.tools/update-signing/`；初始化、使用前检查所有者和 ACL，不输出私钥。初始化是显式一次性命令 `node scripts/update-signing.mjs --init`，已有身份时拒绝替换；正常打包不生成或轮换身份。私钥须独立保管，不能和发行仓库写权限同时失守。
- 独立清单签名不提供 Windows 发布者身份，也不能回溯保护旧客户端获取首个可信公钥的那次更新。发行前需制定首次迁移的独立核验方式；当前 Windows 发行阶段与渠道状态以根 PROGRESS.md 和 [1.2.0 发行记录](WINDOWS_1.2.0_RELEASE.md)为准。

### Windows 更新身份备份与同一身份恢复

本轮已按 owner 当前授权在本机交互终端完成现用 Windows 更新身份的加密备份，最初保存桌面，owner 随后将 `windows-update-key.encrypted.json` 移到其指定的工作区外个人备份目录。口令由 owner 亲自输入并确认，助手只核对文件元数据，未读取口令、密钥或备份内容。当前个人备份目录不视为离线保管；建议 owner 另存独立离线副本并将口令分开保管，不作为当前已授权发布的新增门禁。口令、密钥与备份内容不进入 Git、环境变量、命令行参数、日志或发行资产。

再次备份时，在 `windows/` 的本地交互终端执行以下命令，将示例改为 owner 选择的工作区外绝对路径；下面使用离线介质示例。目标父目录必须已存在；已有备份文件不覆盖。

```powershell
node scripts/update-signing.mjs --backup=X:\VoxCue-Offline\windows-update-key.encrypted.json
```

工具隐藏输入并二次确认至少 20 字符的口令。加密容器 `voxcue-windows-update-backup-v1` 固定使用 scrypt（N=131072、r=8、p=1，128 MiB 内存）派生 256 位密钥，配独立随机盐与 nonce，以 AES-256-GCM 认证公钥身份和私钥密文；参数属于此格式版本，不能静默改弱。受控口令、派生密钥和明文 Buffer 尽力清零。最低长度与多样性检查不等于口令强度保证，需使用独立随机长口令。

恢复前先从可信源码取得原 `windows/update-public-key.json`，不要运行 `--init` 生成新身份。仅在原私钥确实缺失时执行：

```powershell
node scripts/update-signing.mjs --restore=X:\VoxCue-Offline\windows-update-key.encrypted.json
```

恢复要求密文认证通过、恢复出的 Ed25519 公钥与已有固定公钥完全一致，并重新设置当前 owner 的私钥目录 ACL。已有私钥（包括损坏文件）一律拒绝覆盖；需先人工核实并保护原件。错口令、篡改或身份不匹配时不写入私钥。恢复不会更改公钥、轮换身份或提供新的信任回退。

演练入口 `node test/scripts/update-signing-smoke.mjs` 只使用自有临时合成身份，覆盖模拟丢失、恢复后原公钥验签、错口令／篡改拒绝和禁止覆盖。真实私钥与所有有效备份同时丢失时，现有固定公钥的自动更新链路无法再签发新更新；届时需要独立可信渠道安装迁移版本，不能通过放宽验签或任意替换公钥恢复。

## 任务与数据

- 知识库搜索的执行期限从子进程确认开始处理后计时；排队取消释放输入引用并确认退休。执行中的取消仍保留任务归属，故障 watchdog 保留。
- 故障语音 Worker 在停止采集后直接退休，不再向无法处理尾段的 Worker 等待 flush。正常停止的终稿顺序与积压保护保持。子进程输出在分行前按字节设上限。
- 云同步按单遍父子索引汇总状态，16ms 合并前移到引擎，避免每次 mark 都重新汇总；request／idle 返回前冲刷，错误、冲突、取消和完成及时发布，停止后不发迟到通知。保留原逐条持久化语义，不宣称整轮所有成本已线性。分块与元数据使用不同期限；受控取消绑定账号和 syncId，旧任务不能取消新同步。退出登录先取消并等待释放。
- 手机等待连接时不制作完整快照，认证完成后补最新状态；协议 v2 对 paired／snapshot 增加当前 socket、sequence 和随机 deliveryId 的处理确认，未确认时只保留最新快照，超时断开并沿现有授权／回执恢复；旧页面需重新打开，未引入差量协议。流式文字在发送边界短暂合并，结束／错误前冲刷，取消丢弃旧任务增量。命令去重缓存按会话安全回收，不对同一会话的副作用命令直接 LRU 淘汰。连接仍限可信私人局域网／热点，未引入新的 TLS 信任或配对协议。
- 资料 ZIP 支持有限期限及取消，等待子进程真实关闭后清理。凭据与服务选择写入复用既有原子文件工具，失败只清理本次临时文件。
- 同批同名原件在写入前整批拒绝。原件替换保留旧索引停用确认及原件数据库事务；新原件事务失败保留旧原件，新索引仍按现有生命周期异步建立。未来替换不额外积累历史原件备份；显式删除仅清理对应文档／知识库的旧备份，不在后台扫描或迁移真实历史资料。
- 知识库提示已按本轮授权改为“同名文件将替换旧文件”，英文同步；没有加入历史清理或恢复 UI。数据加密与图标域名请求说明见中英文 README。
- 新组件暂存以随机本地 IPC 租约判断操作是否存活，不靠 PID 或墙钟猜测；旧 PID-only 暂存保护，不追扫。新安装写归属标记；安装完成及后续服务启动时，在后继完整认证成功后对编译期可信前驱做完整文件认证与本应用消费者退出确认，再尽力回收。普通 status 复用首次检查，取消／退出阻止等待中的回收执行删除。现用、显式恢复基线、未知／损坏／重解析或无新标记的目录保留；不扫描真实历史目录。后续组件发行必须维护可信前驱清单，不能用可修改本地 manifest 自证可删。外部进程的任意映射不在现有消费者检查范围内，Windows 拒绝删除时不影响新包；递归删除不保证整体原子性。
- #13 的受控时钟回拨、Renderer bridge 重载清理与重新配对验证未复现旧画面冻结；保留现有 epoch 比较，不改系统时钟。
- Windows 固定 Copilot SDK 1.0.21 的原生隔离验证确认，其系统凭据槽与独立 CLI 共享，SDK 全局 logout 会移除 CLI 授权。VoxCue 改为只清本应用身份元数据，保留 generation／并发及身份核对，main 继续退休本应用 SDK 会话和进程；不删除共享凭据、不增加 token 存储或明文回退。系统 CLI 自身退出仍可能使 VoxCue 需要重新连接；没有宣称完整凭据命名空间已隔离。

## Windows 复审补充

- 准备页在读取历史附件前复用公开契约中的既有 turn／文本／文件数量及字节预算，超限时不分配附件 Buffer、不发送 IPC；合法上下文保持顺序和内容，串行读取前后检查取消，不另做历史裁剪。
- 模型目录复用有实际字节上限的 JSON 读取；模型目录和 SSE 的 JSON 解析失败只返回固定本地错误，原始响应片段不进入公开异常。JSON／云账号／同步／遥测／组件／更新元数据的超限或失败清理发起底层取消并消费取消错误，不等待其 Promise 结束；仍释放 reader 锁，等待本地文件关闭、暂存及租约清理，保持失败退避与原事件保留。
- Copilot 保留实际启动中的 SDK 引用；正常关停最多等待 5 秒，再由固定官方 SDK 强制退休。并发 stop 复用任务，关停期间不重开，generation 与 Promise 归属阻止旧启动／控制会话成功或失败影响新实例；不调用全局 logout、不删除共享凭据。
- 产品退出将 Codex／Copilot 的 stop Promise 与导出、图片／用量 writer 纳入同一个持久 `guardQuitDrain`，重复 quit 不能提前放行；移除 before-quit 中不等待且重复的 stop，避免主进程退出截断 SDK 的原有限停止／强制退休流程。不扩大停止预算、不改凭据语义；最终隔离包仍须单独核对主进程自然退出后无本包 SDK／utility 子进程。逐项与 Mac 回归见 S54。
- 语音 utility 的 stdout／stderr 立即排空并丢弃。语音／知识库停止后的旧请求最多再等 10 秒，实际 utility 退出前仍保留退休栅栏，拒绝替代进程、向旧进程发新任务及释放模型。正常排队取消仍等待确认，不提前放开预算；关闭 RPC 失败也执行退休。Qwen 和 Windows 采集消费 stdin 独立的 error 事件，避免 EPIPE 变成未处理异常，采集停止仍保留 close 前的尾包。
- 知识库提交成功后只逐出已替换／删除的内存 revision 和失效 grounding；磁盘历史不清理。多标题层级改为单调游标／按行索引，父项查找改 Map，保留分段、题目层级和稳定 ID，避免大题库重复扫描及大量参数展开。
- 图片和用量存储提供关闭写入并等待尾队列的 dispose。账号删除在销毁窗口后、清理文件前等待这些 writer，迟到的新写入拒绝；失败沿既有 committed marker 路径处理。普通退出复用原导出清理入口等待自有队列，普通 logout 不封闭仍需复用的存储。重复退出共用一批 drain，遥测关闭未结束时也不能绕过；`will-quit` 完成退休后以 setImmediate 重试退出，跨出当前原生事件。合成延迟写入覆盖清理后不重新创建资料，禁止用真实账号演练。
- 覆盖 Windows 适配器、WASAPI／截图／安装器及打包更新链路、共享 main／preload／IPC、账号和 SDK、语音／知识库／截图、组件／远程连接及 Renderer 核心状态和存储；展示组件与大型 vendor 依赖按风险点核对，不把静态审阅称为所有设备或第三方实现已完整验证。保持既有积压预算、手动恢复、Qwen CPU 算法、图标服务和历史资料保护，不升级依赖或新增 UI。

## 验证入口与平台边界

- `pnpm typecheck`、`pnpm check:architecture`、现有相关 Vitest 单元／协议回归、`pnpm build:shared`。
- `node ../shared/test/scripts/quit-drain-smoke.mjs` 在解锁控制台串行保留两个无窗口／禁网／独立 profile 的真实 Electron helper 夹具，覆盖空 drain 自然退出与未完成时重复退出；另通过中央 owner／离线入口加载真实产品 main，以自有 appData／userData／sessionData、关闭测试标志和空合成身份验证两个 SDK 延迟 stop 与 quit 重入，真实退出前两者必须完成。不 patch app.quit／exit，不启动真实 SDK、模型或读取凭据。`account-erasure-smoke.mjs --synthetic-dialog` 使用固定服务端引用与临时合成资料验证实际 main 的删除／重启及关闭绑定，teardown 失败会使脚本失败，不能仅凭功能断言提前宣称通过。
- `node test/scripts/security-package-smoke.mjs` 在自有系统临时目录构建 Windows 便携验证包，检查实际 fuse 位、PE 资源中的 ASAR header 摘要、ASAR 内更新公钥、CSP、薄包／凭据／外平台排除、固定 SDK 依赖及实际 unpacked PE x64，不启动正式应用；显式 `--with-screenshot-worker` 另验证打包后的截图 Worker 与原生依赖。
- `node test/scripts/update-signing-smoke.mjs` 只使用自有临时签名身份验证签名工具，不使用正式私钥。
- `node test/scripts/installer-path-smoke.mjs` 验证首次安装与既有同路径升级边界；完整安装引擎另用既有独立 GUID 合成入口。已注册安装目录完全缺失时，允许修复到原路径；损坏或非空未知目录仍拒绝。原生未引用的 `/D=同缺失路径` 会被 Builder 的 early `SetOutPath` 提前创建空目录，仍按未认证目录拒绝；默认注册原路径和 Node 引用参数的同路径修复可用，推荐正常启动安装器使用默认注册路径。
- 已加固正式包拒绝主进程 inspector 注入，原 Playwright `_electron` 正式包夹具在 owner 启动边界明确拒绝，不能靠恢复 fuses、修改包字节或测试环境变量放宽。`node test/scripts/store-package-smoke.mjs` 在自有系统临时目录构建真实生产 Store APPX，以 Windows Sandbox 的独立账号、空凭据环境、禁网及无宿主 profile 映射进行原生验收，仅用 renderer CDP／公开 preload 验证，不登录真实服务；正式 SDK 可能访问 guest 的空 vault，并未禁止其执行。启动前验证 guest SID 与宿主不同、guest profile 非重解析路径；无产品测试标志。普通开发 UI 夹具仍禁止正式凭据助手，并遵循已知宿主与 owned entry 的 owner 校验。
- `node test/scripts/store-sandbox-smoke.mjs --copilot-vault` 复用同一 Sandbox 生命周期，仅复制固定公开 SDK／node 与合成账号探针；不构建 APPX、不登录真实服务、不映射宿主资料。只在 guest 枚举凭据目标名，不读 CredentialBlob，输出仅脱敏布尔结果；验证原 SDK 共享行为与实际 VoxCue 本地退出策略。
- Windows `pnpm test:package` 指向现有 `store-package-smoke.mjs`：构建当前生产 APPX，在上述隔离 guest 验证实际 renderer 的合成个人资料、记录、IndexedDB 原件、主题／语言与快捷键重载保留；再以同版本开发 Electron 宿主在 APPX 包身份上下文只加载最终 ASAR 的 SDK、Paraformer／utilityProcess、KnowledgeHost 文档格式／检索／重开／删除及移动资源闭包，使用认证公共模型与音频。该原生入口仅在 guest 运行，既不修改产品 ASAR／fuses，也不执行产品 main；只消费最终包实际附带的 CRT，不给测试宿主额外补库或修改 PATH。结果以 nonce 绑定的原子文件回传，仅白名单布尔／阶段，临时资料随 guest 销毁。旧 owner 正式包测试及不可用参数退役，不保留可误用的死入口；当前资料格式重载与历史二进制升级分开。NSIS 独立合成引擎与交接 W20 的 Sandbox 真实全新安装／原 1.1.1 升级入口分别覆盖相应层次，最终候选仍须实际验收，不能以入口存在推定通过。
- macOS 全树在 Windows 只读：需其本机同步依赖声明／安装、截图 Worker 的 ASAR unpack、fuses 与正式包测试入口适配，并对共享改动补原生回归。Windows 成绩不代验 Mac。
- 保留组件启动摘要验证、语音积压与终稿保护、已保护的旧组件恢复目录和历史信任根。用户确认 Qwen CPU 长段性能按 CPU 能力限制接受，保持现有流式算法与分段策略，不列优化待办；AVX2／FMA 安全检测及协议修复保留。Copilot 的 macOS vault 本机验证及完整原生 runtime 安全／协议修复的构建验收按对应待办处理。

## macOS 当前边界

Mac 正式包与开发宿主分开：owner 测试只接受固定开发宿主及自有入口；最终产品、ASAR 和原生闭包在 [SIP／Gatekeeper guest](../../macos/docs/TEST_GUEST.md) 内分别验收。静态验包零产品启动，不恢复正式包 RunAsNode、inspector 或旧测试参数。Windows 本机结果不代验 Mac 原生行为。

正式签名前关闭 RunAsNode、NodeOptions、NodeCliInspect，开启 EmbeddedAsarIntegrity 与 OnlyLoadAppFromAsar，并对照真实 ASAR header 核验 `ElectronAsarIntegrity`。`ProductionMain.mm` 在进入 Electron Framework 前拒绝调试、伪造子进程及降低 sandbox／Web／证书安全的参数，清除 Node／DYLD／LD 注入环境，核对固定代码签名及资源封印；产品不包含 profile、Mock 或调试入口。

正式代码启用 Hardened Runtime，JIT 与 library-validation 例外只给实际需要的 Electron／Copilot／Python／Qwen 宿主，不向所有子进程开放 DYLD、unsigned executable memory 或 get-task-allow。自签名证书没有 Team ID，随包库加载仍须逐进程验证。`RuntimeIntegrity.h` 由正式入口和独立 verifier 共用，MLX 会话创建前验证真实签名资源，不信任旁边可一同改写的 build.json；静态校验仍有校验与使用间的并发修改窗口。

现用凭据助手为冻结 v11，仅接受固定正式父身份；旧正式 v1 仅作为实际发行恢复与升级来源。`Credentials.mm` 的 v10 密文算法与 `CredentialsHardened.mm` 的身份工具仍由 v11 消费，这不构成候选助手的构建或恢复入口。规范字节、同身份恢复、来源白名单、非交互维护及最终系统授权条件见 [Mac 凭据说明](../../macos/docs/CREDENTIALS.md)。

截图 host／Worker、sharp 和本平台 binding／libvips 随最终 ASAR 的 unpacked 闭包分发。语音 utility 排空输出，CoreAudio 以实际 close、Worker 以实际 exit 为退休证据；未确认退出时不替换采集或删除模型。Mac adapter 的有界自动重启保留取消归属、1／2／4 秒退避与终止错误分类，不能把发送 kill 当作退休证明。

系统音频按 HAL 首选声道映射原始 stream 与局部通道对，不以零值猜活跃通道或放大所有通道；未知多声道、越界／重叠和格式变化明确失败。拒权与授权静音都可能交付零 PCM，预检不读取样本，不能凭零值增加拒权警报。设备对照只使用 guest 固定虚拟输出与自有 aggregate，不采样真实硬件。

MLX 的 ready 期限为 180 秒，命令写入与回复合用 120 秒整次交换期限；坏 JSON／序号、半行、超长、阻塞或异常退出使 Rust／Python 链退休，不复用失效会话。现有上下文、端点、积压预算、Qwen 长段算法与 CPU 性能边界保持。

更新采用连接／首字节 30 秒和有效写入后的 120 秒空闲期限，持续有进展的下载不受旧总期限截断；中间进度按整数百分比合并。旧 ZIP 只在归属、版本、大小、摘要、签名及无活动消费者均确认后回收；未知遗留包、较新的待装包、链接和活动事务保留。签名材料 owner／0700／0600／普通单链接与真实路径检查、离线加密备份及同身份恢复见 [Mac 更新说明](../../macos/docs/UPDATES.md)。

保持 `captureProtectionSupported:false` 的真实能力边界，不宣称 Mac 可在屏幕共享中隐藏窗口。不自动购买 Developer ID／公证、轮换更新身份或迁移真实资料。共享附件、取消、SDK／utility 退休、账号删除和退出 drain 仍使用同一实现，在本机按当前排程回归；完整当前范围见 PROGRESS.md，未发布开发快照的逐项历史查 Git。
