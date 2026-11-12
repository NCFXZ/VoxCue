# macOS 1.2.0 专属待办与逐项验收

当前 Mac 实现和已迁移的安全入口见 [Mac 发行实现](MACOS_1.2.0_RELEASE.md)，接续状态见根 `PROGRESS.md`。下文保留原始要求；只有本机对应完整通过条件满足后才勾选，测试成绩仅在终端／对话。

本清单面向 Mac 本机接续 1.2.0，合并 [安全加固交接的 macOS 专属事项](SECURITY_HARDENING.md#macos-专属事项)、Claude M1–M16 及 Windows 复审发现的 Mac 影响。本文在 Windows 只读核对 Mac 源码后整理，所有复选框均为待办，未宣称 Mac 已实施或通过。共享功能的逐条变化另见 [1.2.0 共享交接](MACOS_1.2.0_HANDOFF.md)，此处只规定 Mac 专属修复和本机验收，不复制另一份共享实现。

## 执行边界与顺序

- [ ] **P0：确认工作区、平台和测试边界。** 先读根 `AGENTS.md`、`PROGRESS.md`，检查 status／diff，保留已有工作；仅在 Mac 修改 `macos/`，`windows/` 全树只读。仅用 owner 合成资料、独立临时目录、固定来源和摘要的公开模型／音频。GUI、原生及推理在当前 UID 已登录且解锁的控制台串行执行；锁定或未知立即停止。不采样麦克风、真实系统混音或宿主屏幕，不读取真实登录资料／Keychain 密文，不改系统隐私或辅助功能设置。测试结果仅终端／对话，结束清理自有 profile、图片和产物。
- [ ] **P0：本机同步 1.2.0 配置与依赖闭包。** 版本唯一来源为 `shared/package.json`；在 Mac 仓库根执行 `pnpm sync:workspace`，再在 `macos/` 安装冻结依赖。若新增直接 `sharp` 声明使 importer 漂移，先仅同步同版 0.35.5 的 Mac 锁项，再执行 `pnpm install --frozen-lockfile`；核对无 SDK／模型升级。同步只生成根与 Mac 配置，随后以 `pnpm check:workspace` 检查；Windows 漂移只读报告，不能为通过检查修改 Windows 文件，根和 `shared/` 不安装依赖。随后通过 `pnpm typecheck`、`pnpm check:architecture`、`pnpm test` 和 `pnpm build:shared`。这些是接续前置，不代表原生或正式包验收。
- [ ] **P0：先完成 M4，再修改 M1。** 未完成正式包启动隔离审计前，不运行 `pnpm test:package`、`package-smoke.mjs`、`package-temporary-smoke.mjs`、`package-upgrade-data.mjs` 或 `components-smoke.mjs`；不能把历史 README 中的命令当作安全批准。`--static-only` 当前也不保证零产品启动。完成 M4 后再启用 fuses／runtime，重新验证最终包。

后续按“隔离入口 → 构建与身份 → 原生生命周期 → 更新 → 最终包”执行。每项需同时满足对应通过条件和全局测试边界才勾选；缺设备、身份或隔离条件时保持未勾选，不能用 Windows 结果或普通开发环境替代。

## 已确认、建议在 Mac 实施

- [ ] **M4：收尾正式包测试隔离（高优先级）。**
  - 证据／风险：共享 Playwright 守卫已拒绝旧正式包路径，但 `macos/test/scripts/package-smoke.mjs` 在守卫之前仍直接以 `ELECTRON_RUN_AS_NODE=1` 启动正式二进制；`package-temporary-smoke.mjs` 仍消费它。RunAsNode 被关闭后，旧探针可能进入真实产品 bootstrap。
  - 最小执行：盘点全部 spawn／exec／Playwright、聚合脚本和 package 命令，包含直接导入 `_electron` 而绕过中央 owner 守卫／解锁检查的消费者；退役失效探针及无消费者入口，迁移仍需保留的覆盖。静态检查不得启动产品；运行正式 `.app` 需独立 OS 身份／可丢弃隔离环境，不共享宿主 userData、login Keychain 或真实服务。不能只换环境变量、临时 profile 或临时 Keychain 文件，也不能编产品测试标志、重开 inspector 或改包字节。
  - 与 M1 联动：Node inspector fuse 不关闭 renderer CDP；最终包测试须随正式启动链的 CDP 收口迁移。生产包继续允许测试以 CDP 连接时，不能宣称该启动风险已经关闭；仅在隔离 guest 中连接降低的是宿主资料暴露，不是关闭产品开关。既有 renderer／公开 API／原生闭包覆盖需保留，并以实际受保护最终包验收，不为测试重新开放调试入口。
  - 通过条件：所有正式包入口均在启动前完成隔离验证，失败时零产品启动；最终 ASAR／SDK／Worker／公开 preload／合成资料持久化仍有覆盖。历史发布二进制到 1.2.0 的升级另行验收，不能以页面重载代称。剩余静态、开发宿主及 OS 隔离入口的职责有明确说明。
  - 入口：`shared/test/scripts/electron-launch-policy.mjs`、`test-workspace.mjs`；上述 Mac 脚本仅在迁移后运行。`package-runtimes-smoke.mjs` 的开发宿主、空凭据和禁网边界也须复核后使用。另核查共享 `adversarial-smoke.mjs`、`chat-progress-smoke.mjs`、`profile-selection-smoke.mjs`、`updates-smoke.mjs` 的 `--app-executable`／`--packaged-bootstrap` 消费者：现有 owner 守卫拒绝正式包，但已知 Mac 开发 launcher 可能仍有实际用途，须区分开发入口后迁移或退役，不能直接恢复生产包注入。

- [ ] **M1：正式包 fuses、Hardened Runtime 与权限收口（高优先级，依赖 M4）。**
  - 证据／风险：`package-app.mjs` → `signMacApp` 默认正式签名走 `--options 0`，未设置正式 fuses；现有签名本身不足以阻止 RunAsNode、调试或动态注入。
  - 最小执行：最终签名前关闭 RunAsNode、NODE_OPTIONS、Node inspector，开启 ASAR 完整性及仅从 ASAR 加载；设置 Mac 所需完整性元数据。正式主程序及相应辅助进程启用 runtime，按进程证明所需 JIT／库验证例外，不向所有二进制一律开放 DYLD、unsigned memory 或 disable-library-validation。沿用固定证书，保护 Credentials helper 精确字节与 CDHash，不将通用重签循环套用到它；helper 自身防护与 M11 联动。
  - CDP 启动链：`NodeCliInspect` 不覆盖 Chromium 的 `--remote-debugging-port`。Mac 尚未复现，须审计 `.app`／launcher 的真实启动链，在该版本实际支持的 port／pipe 调试开关生效前阻止它们，包含动态端口及参数变体；不能仅关闭 Node inspector 或 DevTools 菜单后宣称收口。以自有隔离签名副本、合成 Keychain 和无敏感副作用的权限探针验证默认无监听、首启／重启带开关仍不能接入或借合法主 frame 调用受控能力，TCC／Keychain 不被借用；不访问真实凭据或采样硬件。与 M4 一起迁移最终包测试，再验证正常原生功能。[CDP 参数](https://www.electronjs.org/docs/latest/api/command-line-switches#--remote-debugging-portport)、[固定版本 fuse 定义](https://raw.githubusercontent.com/electron/electron/v44.10.0/docs/tutorial/fuses.md)。
  - 通过条件：核对最终 Mach-O 实际 fuse 位、`Info.plist` 的 `ElectronAsarIntegrity` 和真实 ASAR header；在自有签名副本上以无敏感副作用的合成载荷验证环境／调试注入和 ASAR 篡改被拒绝，正常 Electron／Sparkle／N-API／MLX 仍能加载。不得关闭 Chromium sandbox 来通过测试。
  - 入口：`macos/scripts/package-app.mjs`、`sign-app.mjs`、`development-signing.mjs`；扩展 `macos/test/scripts/development-signing-smoke.mjs`、`native-build-smoke.mjs` 和迁移后的最终包静态检查。现有脚本通过不自动等于覆盖新增 fuse／entitlement 断言。

- [ ] **M5：补截图 Worker 与原生依赖打包（高优先级）。**
  - 证据／风险：共享 host 固定从 `app.asar.unpacked` 启动截图 Worker，Mac unpack 列表尚未纳入 `backend/screenshot`；直接 sharp 声明及 Mac importer 尚未同步。
  - 最小执行：保留固定 sharp 0.35.5，补 Mac arm64／libvips 依赖闭包和正确 unpack 目录，不另换截图质量、尺寸或 UI。
  - 通过条件：从最终签名 `.app` 加载真实 arm64 模块，连续处理自有合成位图，覆盖取消、错误、超时和 Worker 实际退出；无活动 Worker 遗留，内存结束后收敛。只有目录存在、类型检查或开发态编码通过不计为包内通过。
  - 入口：`macos/scripts/package-app.mjs`；`shared/test/unit/screenshot-encoding.test.ts`、`screenshot.test.ts` 和 `shared/test/scripts/screenshot-performance.mjs` 的无参数合成路径。最终包编码检查需由 M4 的安全入口承载，不调用真实截图。

- [ ] **M3：签名材料保护、离线加密备份及同身份恢复（发行前）。**
  - 证据／风险：更新私钥已有 0600 检查，但既有父目录／文件的 owner、权限、类型和重定向边界仍需收紧；同一现用密钥丢失会使既有更新身份无法继续签发。
  - 最小执行：读取前验证 owner、目录 0700／文件 0600 及链接边界，覆盖开发签名钥匙串和口令文件的保管路径。补加密备份／恢复工具，只恢复与已有固定公钥匹配的身份，禁止覆盖已有私钥；口令不进入参数、环境变量、日志或 Git。真实备份由 owner 在本机交互终端选择离线介质执行，介质和口令分开保管。
  - 通过条件：仅用合成身份演练丢失、恢复后旧公钥验签、错口令、篡改、身份错配和禁止覆盖；异常不写入私钥，不改变公开身份。真实备份单独由 owner 确认，不读取或展示现用密钥内容。
  - 入口：`macos/scripts/update-signing.mjs`、`package-installer.mjs`、`development-signing.mjs`；补 Mac 定向合成签名工具回归。Windows 实现仅供设计参照，不直接复制 Windows ACL 或换掉 Mac 身份。

- [ ] **M9：MLX 协议期限及进程链退休（中优先级）。**
  - 证据／风险：`macos/native/qwen-mlx.rs` 已有 2 MiB 行上限，但同步写入、flush、读 ready／请求响应没有本地期限。上层已有超时，不能称为永远无法恢复；Python 异常退出是保护未知推理状态的行为。
  - 最小执行：按现有上层加载／请求预算约束整次交换；超时或协议损坏后停止并确认 Rust／Python 链退出，才能手动重开。保留序号、大小、取消和错误语义，不让异常后的同一 Python 会话盲目继续，不加入自动重启。
  - 通过条件：合成 Python 覆盖不 ready、不回复、写端阻塞、半行、超长／坏 JSON、错序号、异常退出和父进程消失；错误有界返回，实际子进程不遗留，迟到响应不污染后续任务。再用认证模型及固定公开音频验证正常 MLX 链路与手动重开。
  - 入口：`macos/native/qwen-mlx.rs`、`qwen-mlx.py`；扩展对应协议单测／合成子进程测试，再运行 `macos/test/scripts/qwen-native-smoke.mjs <自有临时已认证组件>`、`qwen-worker-smoke.mjs <自有临时已认证组件>`。不修改 121 秒上下文、分段或长段 CPU 算法。

- [ ] **新增：CoreAudioCapture.stop 必须确认 close（中优先级）。**
  - 证据／风险：`macos/electron/speech/capture.ts` 在 2.5 秒 force timer 中调用 SIGKILL 后直接 resolve，尚未确认 `close` 或 kill 成功，可能把未释放的采集助手报告为已退休。
  - 最小执行：以真实 `close` 作为管道及进程退休依据；保留正常尾包排空，强制结束／kill 失败／期限内未退出应明确失败。清理与后续启动门控不能仅因 timer 到期放行。
  - 通过条件：合成助手覆盖正常 EOF、exit 先于尾包、close 延迟、SIGTERM 无效、kill 返回 false／抛错和无 close；停止有界返回，未确认退出不能重开或假称可删除模型，迟到回调不污染新会话。原 20 轮成功停止仍保留。
  - 入口：扩展 `macos/test/scripts/audio-synthetic-smoke.mjs` 及对应纯协议单测；不用 `audio-native-smoke.mjs` 的物理采集路径替代。此项不改变 M8 的积压预算或手动恢复策略。

- [ ] **M12：慢网更新改为空闲期限（中优先级）。**
  - 证据／风险：Mac 驱动将恢复／完整校验／下载放在固定 30 分钟总期限内，全量 GET 失败后删除本次 partial；持续缓慢但有进度的连接也会从头重试。
  - 最小执行：分别约束连接／首包和无有效字节进展的空闲时间，允许持续下载超过原总期限；如仍设绝对上限，必须与认证包大小及支持的慢网边界匹配。保留取消、大小上限、长度／SHA-512／清单和 Sparkle 签名、journal 与有效完整缓存恢复。最小修复不要求 Range 或增量更新。
  - 通过条件：假时钟／合成慢流证明超过旧总期限仍可完成，真正停滞及时失败，截断拒绝；取消或退出释放 reader／文件，迟到任务不写回。底层 cancel Promise 不结束也不能阻塞已有错误结算和清理；不得放宽验签。
  - 入口：`macos/electron/updates/driver.ts`、`download.ts`；`macos/test/unit/update-driver.test.ts`、`updates.test.ts`；在隔离合成更新布局运行 `macos/test/scripts/update-cache-checks.mjs`、`updates-native-smoke.mjs`。

- [ ] **M13：受控回收成功更新 ZIP（中优先级）。**
  - 证据／风险：成功的 `updates/archives` ZIP 缺生命周期回收，cache 仅记录一条 completed，不能据此追认整目录历史文件归属。
  - 最小执行：只回收受信元数据证明归属／版本／大小／摘要、已被安装版本追上且没有活动消费者的普通旧包；必要时仅为未来成功项增加归属记录。保护较新的待装包、活动 partial／journal／feed／安装事务、未知／损坏／无认证记录文件、链接及恢复基线，不凭文件名或 mtime 扫删，不退回退出即删缓存。
  - 通过条件：合成目录覆盖安装后清理、有效新版离线恢复、占用／事务保护、失败保留、退出和取消无迟到删除；已下载新版仍可直接安装。历史未知项保持，不扫描真实缓存。
  - 入口：`macos/electron/updates/driver.ts` 及实际缓存模块；扩展上述 Mac 更新单测与隔离更新缓存脚本。

- [ ] **M14：合并更新的中间下载进度（较低优先级）。**
  - 证据／风险：Mac `download.ts` 每块网络数据触发完整状态和 IPC，缺少发布合并。
  - 最小执行：在 Mac 驱动边界按短周期或百分比粒度合并中间进度；若实现放共享入口，只保留单一实现并同步回归。首条、完成 100% 和阶段切换及时发布，错误／取消／dispose 清理待发任务，不减少真实写入或认证。
  - 通过条件：假时钟及千块流证明发布次数有界，终态立即可见，旧下载不会迟到覆盖新状态，无定时器遗留。
  - 入口：`macos/electron/updates/download.ts`、`driver.ts`；Mac 更新单测。此项只处理更新进度，不调整音频 `audio-progress` 或任何 UI。

## 必须先验证、再决定实现的事项

- [ ] **M6：拒权时的系统音频无声诊断。**
  - 当前证据：预检使用 `capture.start(false)`，刻意不读取样本；`samplesRead:0` 不能证明采到全零。API 启动成功也不能证明有声音，正常静音／路由问题同样可能为零。
  - 最小验证：在隔离账号与已有受控虚拟设备中比较授权＋静音、授权＋自有合成输出、拒权＋相同输出及重新授权后手动启动，仅内存统计帧数和幅度；不启动麦克风、不读取真实混音、不改宿主权限。缺条件保持未验证。
  - 决策／通过条件：只有获得可区分拒权的可靠证据后，才沿现有错误路径考虑最小诊断；不能连续零值就判拒权、自动停机或增加新提示 UI。若无法区分，记录该限制而不更改行为。
  - 入口：`macos/native/AudioCapture.mm`、`macos/electron/speech/access.ts`、`macos/test/unit/audio-access.test.ts`；另建受控虚拟音频验证，现有会采集麦克风的 `audio-native-main.cjs` 不直接执行。

- [ ] **M11：正式凭据 helper 的开发父身份及自身注入防护。**
  - 当前证据：`Credentials.mm` 允许同固定证书下 app／development 两个父标识；`build-credentials.mjs` 初次签名也走 `--options 0`。这扩大同证书开发宿主的调用面，不等于任意未签名父程序能直接取凭据。
  - 最小验证：自有签名副本、合成临时 Keychain 测试正式父／开发父／错证书／伪造父，以及 helper 自身 DYLD／runtime 边界；核对旧密文、固定二进制／CDHash、designated requirement 和 ACL 连续性。主程序 M1 通过不等于 helper 风险已关闭。
  - 决策／通过条件：找到同时收口正式调用面、保持既有可解密身份的最小方案才实施；不得改 hash 白名单蒙混过关、静默重建／重签固定 helper、删除真实条目或生成新存储密钥。若必须迁移真实 helper／ACL／身份，先形成兼容方案并取得明确授权。
  - 入口：`macos/test/scripts/credential-upgrade-smoke.mjs`、`development-signing-smoke.mjs` 及合成父进程夹具；先审入口只用临时 Keychain，前后用户 Keychain 列表一致，不访问真实登录项。

- [ ] **M15：多声道下混和多输出流。**
  - 当前证据：Mac 按所有声道求平均、tap 固定 `withStream:0`；16 声道只有一对同相立体声有音时，相比只下混该声道对会额外衰减约 18 dB。这是条件数学结论，尚未实测设备；Windows WASAPI 也有同类平均逻辑。
  - 最小验证：实际转换逻辑的合成 interleaved／noninterleaved buffer 覆盖 2／8／16 声道、不同声道对、全声道信号、静音及幅值边界；再用已有且明确授权的虚拟多声道／多流设备注入不同固定合成音，显式使用虚拟 UID，不改默认设备、不安装驱动或采样物理硬件。缺设备不以双声道通过代验。
  - 决策／通过条件：支持范围内复现后，按 stream／starting channel／首选声道或 layout 做正确映射；不能从零值猜活跃声道、统一乘声道数补增益或改成扩大采集范围的全局 mixdown。未复现或超出支持范围则保留限制，不新增专业设备 UI。
  - 入口：`macos/native/AudioCapture.mm`、对应纯转换测试及受控虚拟设备验证；Windows 包转换测试只能作参考，不能证明 Mac tap 覆盖。

- [ ] **M16：并入 M1 的外置 Python／MLX 资源完整性。**
  - 当前证据：构建已有逐文件摘要，最终 `.app` 签名有资源封印；普通 Python／脚本／wheel 不等于完全未签名。但源码未证明执行前会自动验证全部资源，不能仅依赖系统 App 管理保护。
  - 最小验证：只在自有最终签名副本中、不重新签名地篡改／替换／重定向 Python、`mlx-worker.py`、依赖和 ASAR，使用无敏感副作用的合成载荷观察实际拒绝位置。
  - 决策／通过条件：如果实际运行绕过资源检查，MLX 启动前补绑定固定身份的静态签名／资源验证，或把最终加载闭包清单放在完整性保护的 ASAR；旁边可一并改写的 `build.json` 不能自证。验证最终签名顺序和启动开销，不能每音频块整包哈希，也不能声称消除并发修改窗口。正常加载与篡改拒绝都验证后再勾选。
  - 入口：`macos/scripts/build-qwen.mjs`、`package-app.mjs`、`macos/native/qwen-mlx.rs`；扩展最终包静态资源及受控加载测试，与 M1 共用一次完整性验收。

## 共享修复已实施，Mac 逐项补本机验收

这些复选框是平台验收，不要求再改一份 Mac 业务实现。共享功能差异及界面逐项矩阵以 [共享交接](MACOS_1.2.0_HANDOFF.md) 为准。

- [ ] **M7／utility 管道与真实退出。** 先运行 `speech-host.test.ts`、`knowledge-host.test.ts`、`knowledge-coordinator.test.ts`，再用真实 Electron utility 和大量合成 stdout／stderr 验证不堵塞、不泄露日志。stop 后旧 IPC 最多再等 10 秒，kill 失败时旧调用要结算，而退休栅栏仍阻止新 fork／post／模型删除；只有真实 exit 才恢复。入口 `shared/test/scripts/knowledge-host-smoke.mjs`，语音高输出临时 utility 采用同一 owner 离线入口；MLX 另按 M9 补链路断开／父退出。不得调用物理采集来代验。
- [ ] **语音切换、尾包及手动恢复。** 运行共享 speech 相关单测，再串行运行 Mac `audio-synthetic-smoke.mjs`、`echo-cancellation-smoke.mjs` 和已审计的 `speech-switch-smoke.mjs`／Qwen Worker 入口；参数使用自有且摘要认证的组件夹具。覆盖切换取消、失败 Worker 退休、EPIPE、软静音、尾稿和真实 ACK，所有旧回调均退休；模型释放后才允许组件删除。保持原积压预算，错误后仅按现有手动操作恢复，不测试或增加自动重启。
- [ ] **知识库解析与取消。** 运行 `knowledge-core.test.ts`、`knowledge-parsing.test.ts`、`knowledge-process.test.ts`、`legacy-doc.test.ts`、`text-encoding.test.ts` 及真实 `knowledge-host-smoke.mjs`。最终 Mac utility 中用合成 PDF／DOCX／DOC／多编码文本验证索引、三种检索、替换、删除、取消、重开；大题库层级／父项关系保持、旧 revision／grounding 内存不累积，磁盘历史与恢复资料不追扫。
- [ ] **Copilot 关停及本应用退出边界。** 先运行 `copilot-runtime.test.ts`、`copilot.test.ts`、`cancellable.test.ts`，再使用断网、空凭据的隔离 Mac SDK 环境验证握手／控制会话不回复时有界退休，迟到成功或失败不复活旧实例、不清除新实例。本应用退出只清元数据并停自身会话，不删除 CLI 共享凭据；不重写官方登录体系或要求完整独立 vault。正式包 SDK 验收须先满足 M4，`copilot-runtime-smoke.mjs` 的既有参数和身份边界先检查后运行。
- [ ] **聊天预算、取消及远端错误脱敏。** 运行 `chat.test.ts`、`chat-responses.test.ts`、`bounded-json.test.ts`、`cancellable.test.ts` 等定向用例；通过隔离离线 provider 验证读取附件前的上下文预算、串行读取中途取消、模型目录／二次身份／知识库目录等待取消和迟到结果隔离。取消有界结束，超量实际响应被拒，JSON 错误不含远端片段；不恢复已撤销的旧请求或修改回答预算。
- [ ] **组件 Unix socket 租约及前驱回收重试。** 在 Mac 自有合成目录运行 `components.test.ts` 的租约、占用、取消和启动重试场景，再经安全入口验证 Unix socket 与真实消费者退出。只有后继完整认证成功且无活动消费者时回收声明过的前驱；忙／失败后下次启动重试，取消／退出不迟到删除。现用模型、恢复基线、未知／损坏／链接／旧 PID-only 暂存均保护，不能运行旧 `components-smoke.mjs` 直接启动正式包。
- [ ] **云同步、远程快照与失败清理。** 运行 `cloud-account.test.ts`、`cloud-sync.test.ts`、`cloud-sync-store.test.ts`、`remote-connection-service.test.ts`、`mobile-connection.test.ts` 等共享用例，再经自有 loopback 合成对端验证账号取消、chunk 慢流、快照处理回执和当前连接归属。按共享交接 S48 覆盖逐次 await／同帧不 await 的多类别偏好，核对内存与 IndexedDB、旧合并视图不覆盖选择，并保持原快照数量／容量及期限断言。错误发生后请求底层 cancel，但不等待永不结束的 cancel Promise；文件／暂存／租约仍清理，迟到任务不写回。配对不改为新 TLS 信任体系，不扫描真实账号或网络设备。
- [ ] **共享夹具与模型菜单归属。** 按 S46 在导入 main 前固定 appData／userData／sessionData 后移除 launcher 测试标志，实际断言资料隔离；按 S49 补齐合成 CPU 能力契约，真实 `hardware.require()` 与切换等待／错误断言保持。按 S50 在聊天／native dialog 内验证同一 popup 的模型列表与几何，失败按原 trigger ID／aria-controls 诊断，不扩大到任意全局菜单或放宽等待。Mac 资料迁移夹具另核对 W21 的父 env 被 launcher 补回问题，不能只删父变量便宣称实际迁移。前台／指针归属安全边界参考 W22，本机验证，不复制 Win32 探针或自动向其他窗口输入。
- [ ] **账号删除、导出和重复退出。** 运行 `account-erasure-writers.test.ts`、`quit-drain.test.ts`、`account-archive-process.test.ts`，再在普通开发 fixture 禁止正式凭据助手的前提下串行运行共享 `account-erasure-smoke.mjs`、`quit-drain-smoke.mjs` 及 Mac `account-archive-lifecycle-smoke.mjs`。图片／用量 writer 先封闭再 drain，真实擦除在已有写入结束后开始，重启不重建资料；普通 logout 可再次使用 writer。空队列、在途写入、取消和重复退出均自然结束，同一 drain 不被第二次 will-quit 绕过，失败不假称资料已擦除。按共享 S54 运行真实产品 main 的合成 SDK 延迟 stop／quit 重入场景：固定自有 appData／userData／sessionData 后关闭测试标志，两个 stop 均完成后才自然退出，不替换 app.quit／exit，不读取真实凭据；原 SDK 停止预算保持。最终签名包再经 M4 的 OS 隔离入口核对 browser 自然退出及本包 SDK／utility 子进程为零，exit code 0 本身不代表后台均已退出。

## 完整功能与最终 Mac 资产验收

- [ ] **开发态完整功能和 UI 逐条测试。** 在 `macos/` 先检查 `node ../shared/test/scripts/functional-suite.mjs --list` 与 `node test/scripts/ui-refinement-matrix.mjs --list` 的当前排程及安全边界，再按共享交接运行全部组、五档缩放、既定 20 轮面试和 600 秒认证公开音频长稳；不能以定向复测代替完整矩阵。1.2.0 已授权的共享控件／开场弹窗／快捷键状态需补 Mac 浅深主题、系统主题色、键盘／辅助功能及小屏测试，不额外改 UI。物理设备、屏幕采样和真实账号不纳入；需要的固定模型／音频只用认证缓存。
- [ ] **最终 `.app`／DMG／更新 ZIP 逐层验收。** M4／M1／M5 和签名身份门禁完成后，在 Mac 本机构建 1.2.0 临时正式资产，核对 arm64 依赖、完整性、签名、固定 helper、权限本地化、资源闭包及秘密不入包。SDK／知识库／语音／合成截图必须消费最终包真实代码和原生依赖；OS 隔离中的公开接口、合成持久化与历史升级分别记录覆盖。再验证 Sparkle 正常／坏签名／取消／缓存恢复／暂存安装／重启，不能访问线上账号或把归档覆盖当作 Sparkle 安装。入口：经 M4 迁移后的 `package-runtimes-smoke.mjs`、`package-smoke.mjs`、`package-upgrade-data.mjs`，以及 `native-build-smoke.mjs`、`dmg-smoke.mjs`、`updates-native-smoke.mjs`；各脚本参数先按当前源码确认。
- [ ] **清理与交接闭环。** 逐项核对结果只在终端／对话，不留报告、trace、截图或成绩在仓库。清理本轮自有临时产物，确认无活跃进程／未知路径再删；保留认证公共缓存和恢复基线。更新本清单及 `PROGRESS.md` 的完成项／实际缺口，不把未覆盖的权限、多流设备或历史升级标为通过。本文不是 Mac 发行、换证或访问真实凭据的授权。

## 已决定保持的边界

以下不列修复复选框：Qwen CPU 长段性能／重算／分段，M8 的原生与 Paraformer 积压预算、宁停不丢及手动恢复，音频进度频率，可信私人网络／热点边界，单会话命令保护上限，组件完整摘要与受保护历史／原件备份，本地资料加密策略、第三方网站图标服务、单份简历行为及原凭据 v10 兼容。M2 的 Developer ID／公证和 M3 的拆分或轮换现用更新密钥不属于本轮强制实现；不会自动购买、生成或替换身份。Mac 当前 `captureProtectionSupported:false` 继续如实表达，不承诺屏幕共享隐藏窗口。测试只核对这些既定行为未回归，不以新审阅重新立项。
