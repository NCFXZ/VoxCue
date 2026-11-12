# VoxCue 1.2.0 macOS 接续交接

本文逐项记录 Windows 工作区中 `1.1.1 → 1.2.0` 的改动及 Mac 应执行的回归，不是 Mac 验收记录。长期约束见 [AGENTS.md](../../AGENTS.md)，当前授权与工作状态见 [PROGRESS.md](../../PROGRESS.md)，详细安全设计与 M1–M16 来源分析见 [SECURITY_HARDENING.md](SECURITY_HARDENING.md)。接续时先核对这三份文件和最新 Git diff，保留后续工作。

Mac 专属实现、先验证事项和可逐项勾选的通过条件统一见 [MACOS_1.2.0_TODO.md](MACOS_1.2.0_TODO.md)。该清单另含本轮只读复核发现的 `CoreAudioCapture.stop()` 强制结束后必须确认实际 `close` 的生命周期待办；不能把发送 SIGKILL 当作已完成退休。

## 基线、版本和交付边界

- 输入基线：`main` 的 `3160b6868c540ec7cc6d20cdca11bc10b19bdd0c`，应用版本 1.1.1；目标版本唯一来源为 `shared/package.json` 的 1.2.0。Windows Store 映射目标为 2.2.0.0，不把 Windows APPX 版本直接套入 Mac 的打包字段。
- `shared/` 下列实现已在源码完成，默认同时属于两端；**本文所有 Mac 原生、签名、最终包与真机行为均待 Mac 本机验证**。Windows 执行结果不能替代 Mac 结果。`macos/` 在本轮 Windows 工作中保持全树只读，依赖 importer、锁、unpack、fuses 和签名等 Mac 配置尚需本机接续。
- 不新增产品测试标志，不重新开放正式包 inspector，不让正式包读取测试环境变量。正式包测试须先完成 M4 的启动隔离收尾，之后再实施 M1。不要先运行旧 `test:package`、`package-smoke --static-only` 或其聚合入口。
- 保护原始资料、真实 userData／凭据／Keychain、现用模型与依赖、固定签名身份、1.1.1 正式资产和恢复基线。没有自动历史资料迁移、备份库整库删除、未知组件清扫、更新密钥轮换或依赖／模型升级授权。
- GUI／原生回归只在当前 owner 已登录并解锁的控制台串行运行；只用自有临时合成资料、合成图片和固定来源／摘要的公开模型音频，不采样硬件或宿主屏幕，不读取真实账号或钥匙串。成绩仅终端／对话，必要临时 profile／图片／数据库归属明确并在结束时清理。
- Windows 冻结代码基线以私有仓库 `v1.2.0` 为准；实际源码提交号、公开安装资产及 Store 状态统一见 [Windows 发行索引](WINDOWS_1.2.0_RELEASE.md)。本文没有 Mac 发行完成声明，Mac 的提交／签名发行须依据接续时的当前授权。

## 共享代码已实现：逐项接续与 Mac 回归

以下 S 编号用于后续补充，不因章节调整重新编号。每项“回归”均指 Mac 待执行事项；不要复制共享实现到 `macos/`。

### 运行时、聊天与网络

**S01｜正式包环境策略。** `shared/electron/runtimePolicy.ts` 统一解析运行环境，`main.ts` 的窗口地址、userData、账号服务与遥测来源均经过该策略。打包应用忽略 `VITE_DEV_SERVER_URL`、`COPILOT_TEST_USER_DATA`、`VOXCUE_ACCOUNT_API` 等开发／测试覆盖，开发页面也只接受 loopback。回归应证明正式包拒绝这些覆盖，且在 OS 隔离环境内使用 guest 的正常产品路径；不能通过设置这些变量隔离真实用户资料。

**S02｜Chromium 权限与 CSP。** 新建 session 和默认 session 都设置受控权限处理，只允许本应用主 frame 的剪贴板写入，网页音频／截图权限不走默认放行。正式 CSP 的 `connect-src` 为 `'self'`，补 `object-src`／`base-uri`；开发服务器的额外连接仅由 Vite serve 阶段注入。回归登录／主窗口／面试窗口、外链和复制，并确认 Mac 原生权限流程仍走平台适配器。

**S03｜公开边界与契约同步。** 聊天预算、云同步取消和远程协议变动保持在 `shared/electron/contracts`，IPC 继续核对主窗口、main frame、请求归属与运行时参数。preload 不增加任意路径、Node、命令或通用 IPC 能力。Mac 做架构／类型检查及公开 preload 调用回归，不能用直接调用后台函数替代最终 renderer 边界覆盖。

**S04｜流式聊天发送合并。** `backend/chat/events.ts` 在普通聊天和面试 IPC 发送边界复用：首段立即发送，中间增量约 40ms 合并，终止／错误前冲刷；取消、切换和销毁时丢弃旧任务待发增量。回归短答、长答、重试、取消、窗口关闭与晚到事件，确认终稿和首段反馈保持，旧答案不串入新任务。

**S05｜读取附件前检查完整上下文预算。** Renderer `src/services/chat.ts` 复用契约中既有文本、turn、文件数与字节上限，先检查全部元数据，再串行读取附件，并在读取前后检查取消。合法上下文不被另做历史裁剪；超限不分配全部附件 Buffer、不发送 IPC。回归 100 turns／200000 字符、20 文件、单文件 20MiB、合计 32MiB 的边界及合法顺序；这些是原预算的前置执行，不是扩容或数据格式变化。

**S06｜模型／连接前置阶段可取消。** 新纯工具 `backend/cancellable.ts` 在知识库意图判断、ChatGPT 和 Copilot 路径复用等待取消逻辑。已经取消的请求在模型查询前停止，查询模型或连接握手期间取消及时结束调用者等待，迟到值不能继续构造输入、发 provider 事件或开始网络流；底层原生实例仍由自己的退休生命周期负责。回归预先 abort、模型 Promise 不返回、握手不返回、晚到成功／失败，确认没有旧任务复活或未处理 rejection。

**S07｜模型目录响应有界与 JSON 错误脱敏。** ChatGPT 模型目录按实际响应字节限制为 4MiB，复用 `boundedJson`；模型目录和 SSE JSON 格式错误返回固定本地错误，不把远端片段拼进公开异常。回归无 Content-Length／虚假长度／分块超限／坏 JSON／有效 SSE，确认上限不是只看响应头，错误不泄漏响应正文。

**S08｜失败清理不等待失效的远端取消 Promise。** 有界 JSON、云传输、遥测、组件与更新元数据失败时仍发起 reader／body 取消并消费其错误，但不等待可能永不结束的取消 Promise。reader 锁、本地文件关闭、暂存目录／租约清理和既有失败退避保留。回归 `cancel()` 永不 resolve／reject、读失败／超限及后续重试，不能以减少清理来制造“及时返回”。

**S09｜更新安装接口等待异步错误。** `UpdateDriver.quitAndInstall` 可返回 Promise，`UpdateService` 等待实际适配器结果再处理失败。Mac Sparkle 驱动应继续满足此接口，回归安装前认证失败、异步安装拒绝、取消和正确状态恢复，避免把尚未完成的异步请求误当安装成功。

### 云同步、资料及退出

**S10｜云同步状态计算与发布。** `src/services/cloudSync.ts` 按单遍父子索引汇总状态，把约 16ms 的合并放在引擎，不再每次 `mark()` 都扫描全表并立刻发布。错误／冲突／取消／完成及时发布，`request()`／`idle()` 返回前冲刷，停止后没有迟到通知；原逐条持久化语义不变。回归大集合、父子依赖状态、暂停／删除／冲突和停止，不能据此宣称整轮全部工作已是线性复杂度。

**S11｜云分块慢网期限与请求归属。** 1MiB 分块上传／读取使用 120 秒期限，元数据请求保持较短期限；取消绑定 userId／syncId，旧任务不能取消新同步。回归持续慢速传输、无响应、读取失败、账号切换和旧取消到达，确认文件句柄及活动传输记录释放。此项不是 Mac 更新 ZIP 下载的 M12，两个路径须分别验收。

**S12｜同步中的本地退出始终可用。** 云账号 logout 先取消并等待活动传输，取消即使在本地账号已清空后仍可按原归属完成；main 对合法取消不再被面试／本地模式门禁拦住。回归传输期间退出、重复退出、取消后重新登录／同步，确认不会因“账号操作正在进行”锁住本地退出。

**S13｜原子写失败只清理本次临时文件。** auth、Copilot 身份元数据及服务选择存储复用现有 `atomicFile`，rename 等写入失败清理自己的 `.tmp`。回归已有文件保持、rename 失败和并发写入；凭据仍只经平台系统加密，没有明文回退，也不清理未知历史临时文件。

**S14｜资料导出有限期限和取消。** `backend/accountArchive.ts` 的压缩子进程增加五分钟期限和受控取消，等待真实 close 后清理自己的临时输出。回归取消、超时、子进程错误、关闭应用与成功导出。Windows 仍用 PowerShell；Mac 验证自身归档适配路径，不为无受限企业环境需求重写 ZIP 实现。

**S15｜删除账号前关闭并排空 writer。** 图片和用量存储提供 closed／dispose drain；main 销毁窗口后、删除文件前等待原串行写入队列，迟到新写入拒绝，避免删除后重建资料。普通 logout 不关闭仍需复用的存储；删除失败沿原 committed marker 处理。仅以临时合成账号验证写入延迟、删除／重启后不重建、重复删除及失败，不访问真实资料。

**S16｜普通与重复退出共享退休屏障。** `window.ts` 的持久 `guardQuitDrain` 等待 archive、图片和用量自有队列，重复退出不能绕过；遥测关闭有独立 closing 状态。`will-quit` 结束后经 `setImmediate` 再次 `app.quit()`，避免同一原生事件内重试被忽略。回归空 drain 自然退出、延迟写入、重复退出、遥测未完成和窗口自然关闭；Mac 必须观察真实 Electron 事件顺序，而不只验证 mock App。

### 知识库

**S17｜排队检索不消耗执行期限。** `knowledge/host.ts`／`process.ts` 的检索期限从子进程确认开始执行后计时，30 秒检索排在索引后不会直接杀掉正在索引的整个进程。排队取消释放输入引用并等待退休确认；进程完全不确认开始时仍有故障 watchdog。回归长索引前排队、执行超时、取消、重复请求和旧任务确认，不把排队期限改成无限无监控等待。

**S18｜知识库 utility 停止栅栏。** 停止时旧请求最多再等待 10 秒结算，实际子进程退出前继续保留 retirement fence，拒绝替代进程／新任务和模型删除；关闭 RPC 失败也退休。回归不响应 shutdown、晚到 start／结果／退出、重复 stop 及重新开始，确认超时只结束调用者等待，不假装旧进程已经退出。

**S19｜只回收失效内存 revision。** `knowledge/service.ts` 在提交成功后释放已替换／删除的内存 revision 和过期 grounding；失败提交不提前丢弃仍有效数据。磁盘历史和恢复资料不动。回归反复替换、删除、commit 失败、查询与重开，确认没有内存旧引用无限保留，也没有破坏恢复基线。

**S20｜大题库分段与层级查找。** `knowledge/chunks.ts` 用单调游标／按行索引和父项 Map 替代重复全表查找，移除大量参数展开；保留分段、题目父子层级、QA root 与稳定 ID。回归深／宽标题、连续题目、长行和大文档的结果，不以易波动耗时阈值替代语义断言。

**S21｜同批同名文件先整体拒绝。** `src/services/knowledge.ts` 在任何原件写入或索引停用之前拒绝一批中的重复文件名，避免来自不同文件夹的同名文件悄然覆盖。原有跨批同名替换仍有效。回归大小写／原样文件名语义、空文件／超限优先校验、同批冲突无副作用及下一批合法导入。

**S22｜停止未来备份积累，保持单份简历语义。** 替换与云恢复不再额外复制旧原件进 `voxcue-original-backups`；原件事务失败仍保留旧原件，显式删文档／知识库时清对应历史备份。简历入口每次只接收一份并替换原简历；删除简历库的现有单份语义保留，不恢复多简历产品逻辑。没有启动时删除整个历史备份库，也不扫描或迁移真实旧资料。回归本地／云替换、失败事务、显式删除与重开。

### Copilot 与语音进程

**S23｜Copilot 本地退出不执行共享凭据全局注销。** VoxCue 只清自己的身份元数据并退休自己的 SDK 会话／进程，保留身份核对、generation 和并发语义。Windows 合成隔离探针揭示 SDK 与独立 CLI 共用系统凭据槽，不能把现实现称作独立 vault；CLI 自己退出仍可能要求 VoxCue 重连。Mac 必须在 OS 隔离的合成 Keychain／账号上验证，不访问真实登录，也不重写官方 SDK 登录模式或保存 token。

**S24｜Copilot SDK 有限关停和迟到结果隔离。** runtime 保留实际启动中的 client，正常关停最多等五秒，再调用固定官方 SDK 的 `forceStop`；并发 stop 复用工作，停止中不重开。generation 和 Promise 归属阻止旧启动／控制会话的成功或失败影响新实例。回归 SDK 握手卡住、控制会话不返回、晚到成功／失败、stop 后重新连接，确认自身进程退休且不调用全局 logout。

**S25｜错误语音 Worker 停止不再等待无回复 flush。** controller 在错误路径先停止采集，再退休失败 Worker，不再等 Paraformer／Qwen 的正常尾段期限；正常停止仍保留终稿顺序和既有积压保护。回归模型初始化／推理出错后停止、立即重新开始、正常 flush 和重复 stop，确认不能用提前释放模型规避真正退休。

**S26｜语音 utility 输出排空及退休栅栏。** `speech/host.ts` 立即排空 stdout／stderr，不因日志管道写满阻塞语音进程。旧 RPC 在停止后有限结算，但 utility 真实退出前仍阻止替代进程、向旧进程发任务及组件卸载；语义与 S18 一致。Mac 用合成 utility／MLX 管道验证日志洪水、无响应 stop、RPC 关闭失败及实际退出，不采样硬件。

**S27｜分行前的字节上限和 EPIPE。** 新 `BoundedLineDecoder` 在拼接完整行前限制字节，Qwen stdout 和 Windows WASAPI stderr 使用它；Qwen 与 WASAPI stdin 的独立 `error` 被消费并触发退休，避免 EPIPE 成为未处理异常。Mac 回归共享 Qwen reader 的超长／半行／UTF-8 边界及关闭竞态；MLX Rust↔Python 的阻塞交换仍由 M9 单独处理。

**S28｜Qwen CPU 指令安全与原生协议。** 共享 Rust 入口／对齐器 CPU 后端检查 AVX2 和 FMA，相关切片长度从仅 debug assertion 改成实际 assertion，坏 JSON 明确回复 error，`alignment_device` 取值受控。Windows 还用随应用 helper 保护旧下载 runtime；完整公开 CPU／CUDA runtime 尚未由本轮源码重新认证替换。Mac 按自己实际 CPU／MLX 构建消费情况验证源码和协议，不误用 Windows helper，不把 CPU 长段性能重新列为修复。

### 组件与手机连接

**S29｜新暂存使用随机本地 IPC 租约。** `components/lease.ts` 与 service 用随机本地端点判断新暂存操作是否活跃，避免 PID 复用误判；Windows 命名管道与 Unix socket 各走平台行为。Mac 回归 socket 创建／关闭、存活与废弃、并发安装、取消、路径长度及异常退出。旧 PID-only 暂存和归属不明目录不追扫，也不按 mtime／墙钟猜测可以删除。

**S30｜认证前驱回收与启动重试。** 新安装写归属标记；在后继完整认证、编译期可信 predecessor 匹配且本应用消费者真实退出后，才尽力回收可删前驱；首次失败下次服务启动重试，普通 status 复用已有检查。取消／dispose 阻止等待中的删除。现用、恢复基线、无新标记、未知／损坏／重解析／占用目录保持，当前 Qwen 旧基线有 preserve 标记。Mac 验证已加载文件、Unix 删除语义和取消竞态；后续组件发行须维护可信前驱清单，不能靠本地可修改 manifest 自证可删。

**S31｜手机快照按接收处理完成背压。** 协议 v2 为 paired／snapshot 加 sequence 和随机 deliveryId 的当前 WebSocket 确认，同一连接最多一份未确认快照，只保留最新待发状态。waiting 时不制作完整快照；认证后补最新状态，确认超时走现有断开／恢复路径。旧手机页面必须重新打开。回归慢解析／不确认／错 socket／错序号／旧 deliveryId／重连，确认内存和发送队列有界，没有恢复成固定 80ms 无界全快照发送。

**S32｜远程认证与来源限流。** 未认证连接不能抢占已配对手机；请求／连接限制改按来源 IP 统计，保留令牌与公开命令校验。回归未配对洪水与已认证用户、不同来源、错误 token、连接切换及断开清理。仍只承诺可信私人局域网／热点，未加入 TLS 或不可信局域网安全配对。

**S33｜手机草稿、回执、会话去重生命周期。** 同会话已确认草稿不被重连旧快照覆盖，取得新快照后恢复命令回执，新会话／epoch 的低版本可被正常采用；命令去重缓存按会话回收。单会话 1024 条上限与副作用防重执行语义保留，不直接 LRU 淘汰旧命令。受控时钟回拨、bridge 重载及重新配对未复现此前 epoch 冻结，比较逻辑保持；Mac／手机回归不改系统时钟。

### 截图与已验收界面

**S34｜截图编码移入私有 Worker。** main 只从平台 capture 取 bitmap，编码／缩放及预览由 `backend/screenshot` Worker 处理，直接声明固定 `sharp@0.35.5`，保留 PNG／超限 JPEG 与原质量／大小策略。像素／尺寸有上限，取消终止 Worker。Mac 必须先处理 M5 的依赖和 unpack，再在最终签名包里用合成 bitmap 验证连续编码、取消、错误和内存；V8 resourceLimits 不等于 libvips 原生内存上限。

**S35｜截图槽等真实退休后释放。** 取消或清理截图时，不提前把 IPC capture slot 标为空，由实际 capture／Worker finally 释放，窗口销毁或旧结果晚到均不交付新预览。回归重复请求、取消后立刻请求、Worker 退出、窗口关闭，防止多个编码任务绕过原单任务预算；普通 UI 测试不采样宿主屏幕。

**S36｜长用户消息折叠控件。** `UserMessage.tsx`／`chatMessages.css` 的“显示更多／收起”移到消息内左侧，带 chevron，左右内边距 12px；默认透明，悬浮／键盘焦点显示胶囊反馈；折叠时控件上方单独显示 `...`。Mac 回归展开收起、短消息无控件、复制全文、键盘及浅深主题，不继续更改已验收位置、文字或设计。

**S37｜“现场面试”显示名称。** `InterviewInputModeControl`、设备提示及对应中英文将“仅转录”改为“现场面试”／`In-person interview`；内部值仍为 `transcription`，持久化、来源限制及业务语义不变。回归旧设置读取、只麦克风模式、远程模式及两种语言，不做配置迁移或修改采集策略。

**S38｜连续字体／透明度滑块。** 显示设置滑轨使用主题色，两端真正半圆，浅色胶囊滑钮最终为 28×22px；轨道 8px、两侧相应对齐，保留原点击区、键盘和值反馈。只作用于连续显示滑块，模型思考档位滑条保持。Mac 回归系统主题色、浅深主题、端点／中间值、缩放、小屏、焦点、减弱动画和强制对比模式，不重新扩大滑钮或修改厚度。

**S39｜桌面设置开关。** 云同步、自动下载等共用桌面 switch 最终为 48×22px、白色钮 28×18px，启用背景为主题色，保留 focus／disabled／键盘与辅助功能降级。Mac 回归开关两态和实际持久化，不把模型档位或手机独立控件套入这个样式。

**S40｜开始面试前检查界面。** 弹窗首选高度 860px，最大仍为可用视口减 48px，小屏允许内部滚动；未连接前增加 X，连接时为 check。远程连接下增加快捷键行，复用真实 `shortcuts check` 与已有 store，稳定态只有“快捷键可用／部分快捷键不可用”及对应英文；骨架加载，状态不阻止开始面试。Mac 回归绑定缺失／冲突／capture／服务错误、重新检查和小屏底部操作可达，不能硬编码可用或注册新快捷键作为测试副作用。

**S41｜知识库提示和有界翻译兜底。** 提示改为“同名文件将替换旧文件”，英文同步，不增加恢复或清理入口。占位符翻译 fallback 不再使用宽泛回溯正则，采用 16KiB 上限的单向匹配。回归中英模板／占位符、全角冒号、长输入及现有 UI，不把服务端／用户任意内容交给文案翻译器。

**S42｜确认无用声明清理。** 本轮仅移除 `styles.css` 中同 selector／scope／value 后续已覆盖的九条早期重复声明：`.ui-button` 字号、`.field-label` 字重、`.composer-tools .button-icon` 四个尺寸、`.floating-composer textarea` 字号、关闭 record panel 的 margin-right、关闭 personal panel 的 transition-delay。未删展示组件，没有更改计算样式、几何或文字；动态 resize／sync／storage／mobile 类及 Mac 图标动画消费者保留。Mac 做相关布局回归，不把静态零引用当作后续删除的充分依据。

### 验证入口和说明

**S43｜owner Electron 启动守卫。** `shared/test/scripts/electron-launch-policy.mjs`／`test-workspace.mjs` 只允许已知开发宿主与归属明确的临时入口／资料，或经过严格认证的 inert 安装夹具；拒绝直接运行 owner 正式产品包。普通离线 UI 夹具在导入应用前设临时 profile 和网络边界，禁正式凭据助手。Mac 的原始 spawn 探针不一定受该守卫保护，须按 M4 盘点所有入口。

**S44｜失败必须反映在测试退出码。** 账号删除等实际 main 合成回归的 teardown 失败会使测试失败，不仅凭中间功能断言提前宣称通过；增加真实 quit drain、utility／Worker、取消和 SDK 迟到结果等定向用例。Mac 复用可适用的单测和纯合成脚本，原生／正式包路径按本机适配，不恢复退役脚本或放宽失败断言。

**S45｜隐私与边界说明。** 中英文 README 明确凭据经系统加密，面试／转写／截图／个人资料仍可能明文位于 userData；网页来源图标仍经第三方 `a.favicon.im` 请求引用域名。此次未加入应用层全量加密、图标替代、恢复 UI 或静默历史备份清扫，Mac 文案与实际行为保持一致。

**S46｜登录入口夹具与 owner 隔离协调。** 本轮回归发现 owner launcher 会补回 `COPILOT_TEST_USER_DATA`，与 `login-entry-smoke.mjs` 原本检验“未启用 demo／auth fixture”的目的冲突。夹具现先把 `appData`、`userData`、`sessionData` 固定到自己的临时资料路径，再在导入产品 main 前删除该环境标志；新增真实 Electron 路径与标志状态断言，既验证正常登录入口，也不触及真实资料。finally 清理保留首个功能错误，只有无先前错误时才把 teardown 错误作为首错；不放宽关闭期限、不把超时视为通过。该脚本是共享入口，Mac 补本机登录／预览／退出回归，并保留普通 UI 禁用正式凭据助手的边界。

**S47｜既有界面回归同步已授权控件规范。** 本轮完整矩阵发现 `interview-typography-smoke.mjs` 仍断言旧 6px 轨道，`interview-ux-smoke.mjs` 的前检查列表仍只有旧四行。现分别精确更新为 8px 轨道和“麦克风→系统音频→屏幕截图→远程连接→快捷键”五行顺序；加载／完成均核对，完成态快捷键文案限既定两态，开始弹窗高度按 `min(860px, 100dvh−48px)` 验证，使用 `visualViewport.height` 的 CSS 视口浮点值，避免分数 DPI 下整数 `innerHeight` 的取整误差，不放宽几何容差。通用 `continuous-corners.mjs` 对已授权的非正圆胶囊补精确选择器：开关白滑钮、连续显示滑轨及其填充；这些仍须通过圆角半径与正向 round 曲线检查，不忽略任意 span 或所有胶囊。原骨架、逐帧几何、调色、缩放、排版与交互断言保留；没有改产品 CSS 或尺寸。Mac 使用同一脚本补本机定向回归，不能把旧期望失败当作许可扩大控件／取消新行。

**S48｜同步偏好不被传输状态合并延迟覆盖。** 云同步处于 busy 时，原两层 16ms 合并可能让连续配置仍从旧 store 偏好构造下一份完整设置，导致只保留最后开启的类别。引擎现在于偏好变化时立即发布，store 同样立即采用控制面变化并清掉旧待发视图；普通 marks／传输中间状态继续按帧合并。合成回归同时覆盖逐次 await 和同一事件循环不 await 的三个分类配置，核对内存／IndexedDB 偏好、16ms 后无旧视图写回及任务结束后仍保留全部选择。Mac 复用共享实现，在独立合成账号快速开启个人信息、面试记录、知识库，验证三项均保持开启，四个既有合成快照及各类别容量实际到达；保留 `cloud-account-smoke.mjs` 的原超时／数量断言，不靠增大等待或只等待最后一项绕过产品错误。

**S49｜合成硬件夹具补 Qwen CPU 能力契约。** `install-ui-account.mjs` 的既有 speech fixture 只返回 CUDA／Metal 标志，遗漏新增 `qwenCpu`，会在真正的 `hardware.require()` 中提前拒绝 Qwen 切换，未进入脚本的加载／等待／失败注入。夹具现明确提供合成 AVX2／FMA 能力，并覆盖 CPU 路径的独立探针；生产能力检查、加载文案、切换状态和原超时／断言均保留，不把实际硬件条件带进离线 UI 测试。Mac 沿用该共享 fixture，补 `interview-ux-smoke.mjs` 的加载、等待停顿、切换设备、失败保留原配置及手动恢复定向回归；真实指令／驱动检查仍由平台原生回归覆盖。

**S50｜模型菜单失败诊断绑定原控件归属。** 共享 `openModelMenu` 在打开 popup 前记录原 trigger ID，兼容 Radix modal 期间原按钮从可见 accessibility tree 隐藏；只读诊断按该 ID 的 `aria-controls` 比较原／当前 popup，输出 role、label、面板、可见性、菜单项数及公开接口返回的模型数量。原菜单 locator、等待期限与返回 popup 容器语义均保持，所有旧几何／列表消费者继续使用同一容器。仅在失败时输出受控诊断，保留首个断言错误；未据此认定 Portal、产品切换或坐标存在缺陷。Mac 复用该共享 helper，在聊天与 native dialog 内分别验证菜单归属和既有断言。

**S51｜导航反转测试在同一 renderer 帧的中段触发。** `ui-alignment-smoke.mjs` 原先在观察到中途位置后返回 Node，再执行第二次 Playwright click，可能跨过 240ms 动画窗口。现由已有知识库按钮 locator 传入实际按钮，在 renderer RAF 中确认实际进度严格处于中段 `(0.3, 0.7)` 后同步 `button.click()`，返回进度并再次断言同一区间；保留原 20 秒预算和第一次 Playwright click。[CSS 反转规范](https://www.w3.org/TR/css-transitions-1/#reversing)按过渡进度缩短反向时长，因此测试排除近端点触发，以便后续真实 RAF 观察中途位置；不把近端点已结束推定为实测产品缺陷。原无跳跃、两端距离、目标访问、终点、几何与 opacity 断言及位置阈值全部保持，失败邻近帧诊断保留，不插帧、不改变产品动画／CSS或延长时长。此项测试意图为 CSS 中途反转，原生鼠标另行覆盖；Mac 复用共享脚本补分数缩放回归。

**S52｜AI 服务分类数量断言等待实际挂载。** `local-mode-smoke.mjs` 和 `cloud-account-smoke.mjs` 点击 AI 服务分类后，先等待同一设置对话框中既有的“AI 服务”标题出现，再执行原“连接按钮恰为两个”的数量断言。分类通过 `startViewTransition` 在旧视图快照完成后才提交，click 返回不等于新分类已挂载；直接 `count()` 不会重试，可能读取旧账号面板。仅补该就绪条件，不加 sleep、不调整超时、不改变数量断言或产品 UI，临时重复读取诊断已移除。Mac 使用相同共享脚本补本地账户、合成云账号及常用／分数缩放回归，仍须验证两个独立 AI 服务连接入口。

**S53｜下载取消按钮过渡采样真实帧。** `cloud-account-smoke.mjs` 保留一次真实 hover，在同一取消文字子元素的 renderer RAF 中原子采集严格位于 `(0, 1)` 的 opacity 与 CSS duration，替代固定 100ms 后读取；20 秒内未观察到中间帧则报出最后 opacity／duration 和父按钮 hover 状态。原中间透明度及 `0.22s` 断言保持，随后只等待该子元素实际 CSS transition finished，再断言 opacity 为 1 并允许预览，替代固定 180ms；不等待无关加载图标的无限动画。没有补造帧、重复 hover、改变 style／产品 CSS／过渡时间或扩大原预算，既有其他阶段的 1100ms 等待不动。Mac 使用相同共享脚本补常用／分数缩放与减弱动画回归，确认真实中间状态和最终取消文字均可见。

**S54｜产品退出等待 SDK 停止与 writer 同一屏障。** `main.ts` 将 Codex／Copilot runtime 的 `stop()` Promise 纳入已有 `guardQuitDrain`，与导出、图片和用量 writer 一起结算后才允许主进程退出；重复退出复用同一 drain。移除 `before-quit` 中两次不等待的 stop，避免重复调用在旧子进程引用已清空时提前返回，也让 SDK 原有限正常停止／强制退休逻辑有机会完成；不扩大原停止预算、不改登录或共享凭据语义。`quit-drain-smoke.mjs` 保留两个独立 helper 场景，另通过中央 owner／离线入口加载真实产品 main，在自有 appData／userData／sessionData 内关闭测试标志、令两个合成 SDK stop 延迟并重入真实 quit，断言主进程自然退出前两者均已完成；不 patch app.quit／exit、不启动真实 SDK 或读取凭据。Mac 补同一真实 main 回归及实际 close／before-quit／will-quit 顺序；最终签名包须经 M4 的隔离入口确认 browser 自然退出后本包 SDK／utility 子进程均为零，不能仅凭 exit code 0 推定已无遗留。

## Windows 专属已实现：Mac 仅参考

这些 W 项不能直接移植 Windows 适配器／二进制到 Mac；需要对应 Mac 工作时见下一节。

**W01｜五项 Electron fuses。** `windows/scripts/package-portable.mjs` 在最终签名／封装前关闭 RunAsNode、NODE_OPTIONS 和 Node inspector，启用 ASAR 完整性与 OnlyLoadAppFromAsar；安全包脚本读取实际 PE fuse 位及 ASAR header 资源摘要。Mac 等价工作为 M1，验证 Mach-O／Info.plist，不能只检查构建脚本写过配置。

**W02｜独立 Ed25519 更新清单认证。** Windows 更新适配器与 `windowsManifest.ts` 校验 `voxcueSignature`；签名编码绑定用途 `voxcue-windows-update-v1`、Windows x64、版本、文件名、大小、SHA-512 和最低系统版本。网络、缓存、恢复和安装前均认证，无签名或未认证旧缓存不回退；缓存 namespace 隔离。保留 electron-updater 的 NSIS 下载／摘要／安装生命周期；Store 不走这条链。Mac 已有 Sparkle 与清单机制，不能套 Windows 资产选择／签名域。

**W03｜更新公钥进入 ASAR。** 唯一公开来源 `windows/update-public-key.json` 在 ASAR 创建前放入 `dist-electron/windows/electron/voxcue-update.json`，运行时只信任 ASAR 内配置。Mac 按自己的固定身份、资源封印和 Sparkle 配置校验，不复制此 Windows 公钥作为 Mac 更新身份。

**W04｜同一身份的离线加密备份／恢复工具。** `update-signing.mjs` 检查 owner／ACL；显式备份使用隐藏交互长口令、scrypt 和 AES-256-GCM，目标在工作区外且禁止覆盖；恢复仅接受匹配已有固定公钥的身份，已有私钥不覆盖、不自动 init／轮换。真实私钥备份须 owner 在本机交互终端选择独立离线介质，合成演练不等于已保管正式备份。Mac M3 参照安全目标实现自己的文件所有权与权限检查。

**W05｜发布者身份边界。** Ed25519 保护已获得可信公钥的更新链，不提供 Authenticode 发布者身份，也不能回溯保护旧 1.1.1 获得首个可信公钥的升级；SmartScreen 警告不能据此承诺消失。首次迁移须提供独立核验路径。没有追加 Windows 证书体系，Mac Developer ID／公证也不能推定已完成。

**W06｜固定 app-local VC++ CRT。** 固定 Microsoft 官方 VSIX／内嵌归档／CAB 与每个 DLL 的 SHA-256，静态提取 VC++ CRT 14.44.35211，部署到实际 LanceDB／ONNX 绑定旁并随包保留许可证。不运行系统 redist／MSI、不改 PATH 或全局 DLL 搜索、不升级 SDK。Mac 只核对自己的 arm64／dylib 闭包，不复制这些 DLL。

**W07｜旧 Qwen runtime 的应用侧 CPU preflight。** 独立基线 `VoxCue.Cpu.exe` 在启动已认证下载 runtime 前检查 AVX2／FMA；固定公开 Rust 工具链下载脚本只用于构建／验证。完整 CPU／CUDA runtime 的安全源码重建仍受原 SDK／构建依赖限制，本轮不替换已发布组件。Mac 关注 S28 及其 MLX 实际路径，不能声称 Windows helper 已保护 Mac。

**W08｜WASAPI 管道与异常输出。** capture stdin 消费 EPIPE，stderr 用 16384 字节有界行解码，超长行明确失败并退休，避免 exit 再次覆盖已报错误。正常停止等 close 以保留最后 stdout 音频包。Mac 原生采集不直接使用这个适配器；应验证自己的相同生命周期边界，保留原背压和手动恢复。

**W09｜设备枚举读取到管道关闭。** 本轮回归发现 `exit` 可早于 stdout 尾数据，现使用 `close` 结算 inventory，设置 UTF-8 增量解码并排空 stderr；失败标记阻止晚到数据重新解析，超限／error 清 timer 并退休。5 秒和 100000 字符界限保留。Mac 枚举实现未被修改，本机若有同类子进程收集逻辑，核对 close／UTF-8／有界输出／一次结算；不要仅按 Windows 源码推定 Mac 有缺陷。

**W10｜安装目标双层检查。** C# 选择界面和 NSIS 引擎各自拒绝盘符根、非空／重解析目录、不完整注册、跨目录假升级及不支持的 all-users 安装。合法既有同路径升级保留，目录状态在实际动作前复核；独立合成 GUID 安装入口不改真实注册。Mac DMG 拖拽／Sparkle 安装语义不同，无直接 NSIS 移植任务。

**W11｜完全缺失安装目录的同路径修复。** 已知完整注册且原目录完全不存在时，允许默认原路径修复，只在真正安装前清理对应孤儿卸载元数据；部分缺失、未知非空、权限异常和重解析仍拒绝。Builder 对特殊未引用 `/D=同一缺失路径` 的提前建空目录边界继续保守拒绝，不为无企业部署需求增加兼容分支。

**W12｜退役失效 owner 正式包测试。** 删除 `packaged-smoke.mjs`、`package-upgrade-data.mjs`、`portable-native-smoke.mjs`、`installer-ui-smoke.mjs`、`package-runtimes-check.mjs` 及无效命令／参数；有用静态检查进入 security-package，原生包闭包进入 guest。Mac 的同名／聚合脚本仍须 M4 本机清理，不能假定 Windows 删除已覆盖它们。

**W13｜最终生产 APPX 的 OS 隔离验包。** `test:package` 统一构建系统临时目录的实际生产 APPX，再用 Windows Sandbox 的独立 SID、空 vault、禁网、无宿主 profile 映射验收。真实 renderer 仅通过 CDP／公开 preload 验证合成资料／原件／语言／主题／快捷键重载，不启动 owner 产品 main，不修改产品 ASAR／fuses；仅在 guest 给 APPX 副本签临时测试证书，宿主原始资产摘要保持。Mac 采用合适的本机 OS 隔离环境，临时 profile 单独不能替代它；Mac 的正式包 CDP 启动链与测试迁移另按 M1／M4 收口，不机械沿用此 Windows 入口。

**W14｜最终包 SDK／原生闭包。** guest 内同版本开发 Electron 在 APPX 身份上下文只加载最终 ASAR 的 Copilot／Codex、Paraformer／utility、KnowledgeHost 文档解析与检索、移动资源；固定公共模型／音频复用认证缓存。只消费最终包自己附带的 CRT，不额外给测试宿主补库／PATH；结果以 nonce 绑定的白名单阶段回传，随 guest 销毁。Mac 验证自己的 SDK／N-API／arm64／MLX／Worker 闭包及签名加载，不复制 Windows guest 机制。

**W15｜“当前格式持久化”与“旧二进制升级”分开。** 最终包合成资料重载不等于真实 1.1.1 历史二进制逐版本升级。历史升级需在 OS 隔离副本内先运行受保护旧资产，写合成资料再换新包，旧包原件不改；NSIS 保存语义另由合成安装引擎验证。Mac 同样分别声明覆盖范围，不把 reload smoke 改名为 upgrade 后宣称完成。

**W16｜瘦音频 ASAR 夹具补齐真实依赖闭包。** `windows/test/scripts/echo-cancellation-smoke.mjs --runtime-bundle` 的显式复制列表补入 `contracts/components.js`：生产 `speechSettings.js` 运行时读取组件显示标签，缺失会使音频 Worker 在加载时退出。递归核对本夹具所有编译后相对 require，只缺此纯契约模块；原音频 Worker／识别器／AEC、sherpa 原生绑定、WASM 和 unpack 规则保持，不复制 UI／知识库框架，也不放宽音频与尾包断言。此为 Windows 专属测试夹具修复，不是正式包缺库或 Mac 新功能；Mac 仅在自身合成／ASAR 夹具中按实际依赖核对闭包，不直接复制 Windows 二进制或该脚本。

**W17｜退役 AEC 的失效正式包启动参数。** 同一脚本的旧 `--packaged` 会构建生产 `VoxCue.exe` 后，仍依赖 `ELECTRON_RUN_AS_NODE=1` 在 owner 上直接执行测试入口；RunAsNode fuse 已关闭时，这可能改为进入真实产品 main。该参数、构建／启动分支与失去消费者的模型准备 import 已删除，参数检查在任何子进程启动前明确拒绝。普通开发布局与 `--runtime-bundle` 的原音频、重采样、尾包及实际模型附加断言保留；最终包闭包沿用现有 security-package／Store guest，不新建产品测试入口。当前 README 同步收口；Mac 按 M4 审核自己的原始正式包 spawn 消费者，不把此 Windows 退役当作 Mac 已隔离。

**W18｜收口桌面语音的旧生产包参数。** `windows/test/scripts/speech-desktop-smoke.mjs` 的 `--packaged` 已由 owner 守卫拒绝且没有活跃聚合消费者，现删除死的 `release-smoke/VoxCue.exe` 条件启动、资料命名及报告字段；该参数在任何启动前明确拒绝。普通开发宿主、显式 `--hardware-audio` 门禁及原业务断言保留，生产包仍走 Store Sandbox，不恢复 owner 包内注入。`security-package-smoke.mjs` 输出明确称为 owner launch refusal，实际检查是在中央守卫处拒绝启动，不能表述为运行生产 main 验证了注入。Mac 按 M4 区分共享参数中的开发 launcher 消费者与正式包入口，不机械删除仍有效的本机开发路径。

**W19｜原生设备检查复用 owner 边界。** `windows/test/scripts/interview-access-native.mjs` 保留原设备状态断言，但不再直接调用 Playwright `_electron` 或在工作区写测试结果。它只接受单个 `--hardware-audio`，默认／未知参数在设备和子进程动作前拒绝；启用后复用中央开发宿主、临时 profile／sessionData、解锁检查和退出清理，结果仅终端。普通测试授权不等于物理探测，本轮不运行其硬件分支。Mac M4 也需检查直接导入 `_electron` 而绕过中央启动守卫的消费者，不能以路径位于临时目录替代 owner／权限／硬件边界。

**W20｜最终 NSIS 安装与真实旧包资料升级入口。** 复用 `store-sandbox-smoke.mjs --nsis-current`／`--nsis-upgrade` 的独立禁网 guest、只读输入、nonce／SID 与归属清理；当前包沿既有 Ed25519／SHA512 认证，旧 1.1.1 只读归档按发行索引固定 SHA256，原件前后复核。真实旧 renderer 写合成原件／个人资料／JD／记录和设置后须自然退出，再由当前原包沿注册路径升级；当前 renderer 的 verify 阶段不覆写种子，且另做自然退出后重启。失败／超时不强杀后视为成功，不给旧包补 DLL 或替换负载，不增加产品测试入口。APPX 的 Store 更新禁用和原生包身份检查保持独立；此项入口须本机实际执行后才可宣称通过。Mac M4 对最终 `.app` 的同版本重载与受保护旧二进制升级也须明确区分，使用本机真正隔离环境，不照搬 NSIS 或恢复 owner 正式包注入。

**W21｜资料迁移夹具关闭 launcher 的测试目录覆盖。** `windows/test/scripts/user-data-smoke.mjs` 原只在父 env 删除 `COPILOT_TEST_USER_DATA`，中央 launcher 又补回该标志，使产品跳过真实 `migrateUserData` 并打开空 profile。现在 owned next fixture 先固定临时 appData／bootstrap userData／sessionData，再在导入产品 main 前删除覆盖；两次启动均明确断言标志关闭和实际迁移目标路径。原草稿、回答、附件／知识库 Blob、主题、加密凭据原字节、host-id、模型／索引哨兵、旧目录消失及重复启动断言和期限保持，不改产品迁移。Mac 同名脚本有同类父 env／launcher 组合，需在本机做相同边界核对，保持现有合成加密／禁止正式凭据助手保护；不能仅把父环境删标志当作已测试真实迁移。

**W22｜原生命中与保存对话框的归属诊断。** `login-actions-native-smoke.mjs` 保留完整 WindowProbe hit 结果，在失败时记录自有目标 CSS box／DIP→physical 投影、Renderer DPR／浮点视口、Electron bounds／contentBounds、Win32 geometry、前台 PID／进程名及当前阶段。`WindowProbe.cs` 另在保存框激活失败时记录 target／foreground 的 HWND、PID、class、GA_ROOT／GA_ROOTOWNER 句柄及对应 PID。仅增加元数据诊断，不读取窗口标题、正文或凭据；坐标算法、前台／输入归属守卫、保存框激活／关闭期限及输入逻辑保持。没有把归属异常推定为产品缺陷，也没有为通过回归放宽命中或重试被拒绝的输入。Mac 仅参考这种安全诊断边界，在本机验证自己的前台、指针／保存框归属与坐标投影，不直接移植 Win32 探针。

## macOS 专属事项：M1–M16 原编号

以下与 [安全加固交接](SECURITY_HARDENING.md#macos-专属事项) 一致，新增事实在此交接串联共享影响，不重复立项。优先级先 M4，随后 M1／M5，再按功能处理更新、MLX 和凭据边界；需真机复现的保持“先验证”。

| 编号 | 当前处理决定 | Mac 本机工作与验收边界 |
| --- | --- | --- |
| M1 | 建议实施；尚未在 Mac 改动／验证 | 最终签名前配置五项 fuses，核对最终 Mach-O、`ElectronAsarIntegrity` 与实际 ASAR header；主程序及相应辅助进程启用 Hardened Runtime，按每个加载职责最小化 entitlements。Node inspector fuse 不关闭 renderer CDP；还须审计正式 `.app`／launcher 启动链，阻止该版本实际支持的 CDP port／pipe 开关，并在自有隔离副本／合成 Keychain 中验证首启／重启不能借合法主 frame 调用受控能力或借用 TCC／Keychain，此项未在 Mac 复现。JIT／库验证例外须与固定自签身份、Sparkle、N-API、MLX 实测，不能全局开启 DYLD／unsigned-memory／disable-library-validation，也不能关 Chromium sandbox。固定 Credentials helper 不纳入通用重签循环；与 M11／M16 一起验证外来代码、ASAR 和资源篡改拒绝。 |
| M2 | 不列为本轮强制修复 | 购买 Developer ID／公证是另一个发行身份方案，不能自动购买／换证／迁移身份。保持现有 Gatekeeper 与未公证限制的真实说明；若以后另获授权再处理身份、首次下载核验和凭据连续性。 |
| M3 | 建议完善密钥保护与恢复，不拆分／轮换 | 读取 update seed／Keychain 密码材料前校验 owner、0700 父目录、0600 普通文件及 UID／重解析边界；实现离线加密备份、固定公钥同身份恢复和合成负例。真实备份由 owner 本机交互完成。Sparkle ZIP 与用途隔离清单共用现有密钥不等于独立两根信任，本轮不为“双层签名”拆 key；备份解决丢失，不解决构建机失守。 |
| M4 | 必须先收尾，再启用 M1 | `package-smoke.mjs` 在共享 Playwright 守卫之前仍原始 spawn `ELECTRON_RUN_AS_NODE=1` 探针，`--static-only` 和 `package-temporary-smoke` 也会经过。RunAsNode 关闭后可能进入产品 bootstrap。先盘点 raw spawn／exec／Playwright 与聚合消费者，真正零启动的静态检查独立出来，退役失效入口，必要正式包原生覆盖迁到不共享宿主 userData／login Keychain 的 OS 隔离环境；不加产品测试标志、不恢复 inspector、不以临时 profile／临时 Keychain 文件单独冒充隔离。最终包测试须随 M1 的 CDP 启动链收口迁移并保留公开接口／原生闭包覆盖；生产包仍接受 CDP 连接时不能宣称风险已关闭，隔离 guest 仅避免接触宿主资料。 |
| M5 | 必须适配共享截图实现 | Mac 本机同步 `sharp@0.35.5` 的直接依赖、Mac importer／锁、arm64／libvips 闭包；unpack 包含 `backend/screenshot`，匹配共享 host 的 `app.asar.unpacked` 路径。对最终签名 `.app` 的实际 Worker 连续合成编码、取消、加载失败和内存做回归，不截图宿主、不把 V8 heap limit 当原生内存限制。 |
| M6 | 先验证，不直接增加静音警报 | `capture.start(false)` 预检本来不读取样本，`samplesRead=0` 不是拒权证据。只在自有隔离虚拟设备／固定合成音条件下对比授权静音、授权 tone、拒权 tone、重新授权后手动开始，记录内存计数／幅值，不改系统默认／权限、不采样真实混音。严格数字零不能单独辨别拒权；没有可用隔离条件则保持未验证，不新增 UI／自动停止。 |
| M7 | 共享 S26 已实现；补 Mac 回归 | 验证 utility stdout／stderr 排空、MLX 相关管道、洪水日志与停止退休，不再另写一份 Mac host。不能用 Windows 合成退出行为代验 Mac 原生进程。 |
| M8 | 保留既定设计 | 32 槽／约 1.5 秒原生采集缓冲、Paraformer 2 秒预算、宁停不丢、错误后暂停并手动重新开始保持；回归错误提示、实际资源释放和手动恢复，不加自动重启或扩大缓冲。设备变化停止也按此边界处理。 |
| M9 | 建议修复协议失联；排除 CPU 长段性能 | 给 Rust↔Python 的握手／写入／flush／读取建立本地交换期限，与 Node 上层期限协调；保持已有 2MiB 行界限。失败要杀掉并等待 Rust／Python 链真实退出，再允许手动开始。合成覆盖无 ready、无回复、半行、超限、坏 JSON、错序号、写阻塞、父进程退出。Python 推理错误后退出属于未知状态 fail-stop，不盲目继续／自动重启；121 秒上下文及整段重算不改。 |
| M10 | 保留旧密文兼容 | 不迁移 v10 AES 兼容格式、派生参数或真实 Keychain 条目；依靠 M1／M11 缩小执行／解密信任边界。若另行规划凭据格式升级，须先有明确兼容与恢复方案。 |
| M11 | 先验证固定 helper 的真实信任边界 | helper 信任同一固定证书的 app／development 标识，不等于信任任意 unsigned 父进程；开发宿主权限范围和 helper 初始 `--options 0`／DYLD 风险都要查。保护 sourceHash／binaryHash／精确 CDHash 及现有 Keychain ACL 连续性；只用合成 Keychain 验证旧密文。不能为通过检查静默重建／重签 helper、改 hash、删除真实条目或生成新存储 key；若需迁移，先另定兼容方案。 |
| M12 | 建议修复更新慢网期限 | 把整包固定 30 分钟改为连接／首字节与“长时间无数据”的空闲期限，让持续前进的慢下载可超过 30 分钟。保留大小／摘要／签名、取消、journal 和离线缓存复用。Range 续传不是本轮前提；以后若做须另验实体身份、Content-Range、200 回退与完整重验，不顺带引入增量协议。 |
| M13 | 建议修复成功旧更新包回收 | 对确认本应用归属／认证的 archive，在已安装版本追上且不被 selected／feed／journal／下载／安装事务引用时回收；保留新版本离线包、活跃 partial、未知／重解析文件和恢复基线。不按文件名／mtime 扫删现有未记账历史文件；必要时为未来下载新增归属描述符，失败清理可下次重试。 |
| M14 | 建议合并更新下载中间进度 | 按时间或百分比合并中间 download-progress，首段／100%／终态及时，取消／dispose 清 pending，旧任务不迟到覆盖新状态。优先在 Mac driver 边界处理；若公共机制有实际两端消费者则保持单一实现并补两端测试。此项不重开语音 `audio-progress` 的保留决定。 |
| M15 | 先验证多声道／多流 | 所有声道平均在 16 声道仅一对有效时条件上额外衰减约 18dB；`withStream:0` 不代表所有输出流，尚非真机复现。先以合成 interleaved／noninterleaved 2／8／16 声道与幅值边界验证实际转换，再用明确授权虚拟多流设备注入固定音、显式选 UID；不改默认设备／采样硬件。确认支持范围内复现后按 stream／starting channel／layout 有界映射，不按零值猜活跃声道、无条件放大或扩大采集范围，不加专业声卡 UI。 |
| M16 | 并入 M1；先验证最终资源封印 | Python／脚本／wheel 在 Resources 不等于未签名覆盖；构建已有哈希且最终 `.app` 资源有签名封印。用自有已签副本不重签地篡改／替换／重定向无敏感合成载荷，确认实际启动时 OS／fuses／签名在哪拒绝；不能依赖 App 管理猜测。若 MLX 路径可绕过，启动前加绑定固定身份的静态代码／资源封印验证或受保护 ASAR 内最终文件清单，不能信任资源旁可同改的 `build.json`。覆盖实际加载闭包、最终签名顺序和启动开销，不逐音频块整包哈希；静态校验仍有并发修改窗口，不声称消除同用户全部篡改。 |

### Mac 还需特别串联的共享边界

1. S18／S26：utility 超时结束等待不等于进程已退出；验证 Mac 进程与 Unix 文件占用语义后才放行模型删除／重新开始。
2. S23／S24：Mac SDK vault、global logout 与 forceStop 行为只在合成隔离环境验证；Windows 共享凭据结论不能当作 Mac 已验证，但本地退出策略保持单一实现。
3. S29／S30：Unix socket 租约与前驱 GC 重试要覆盖本机端点清理／路径／活动消费者；旧 PID-only／无标记／恢复目录继续保护。
4. S15／S16／S54：Mac 的实际 close／before-quit／will-quit 与 SDK 退出顺序必须原生回归，尤其空 drain、真实 main 的 SDK 延迟停止／重复退出、最终包无残留子进程及删除后重启不重建文件。
5. S34／S35：最终签名包内 sharp／libvips／Worker 加载是新增打包前置项，纯 Node 单测和 Windows native 验包都不能代验。
6. Mac 仍为 `captureProtectionSupported:false`，不能承诺面试窗口在屏幕共享中隐藏；不移植 Windows 防捕获或增加 UI。

## 明确保留：不因本轮 Mac 交接重新立项

- Qwen CPU 长段性能、上下文重算与分段算法按用户决定保持；只保留指令安全／协议期限／进程退休修复。
- Paraformer 2 秒预算、高频语音进度事件、原生“宁停不丢”和手动重新开始保持；没有实测瓶颈依据不引入时序／自动恢复改造。
- 组件完整哈希保留；启动窗口不以降低完整性换速度。已保护的历史组件／恢复基线／历史清单仍有消费者，不清扫；旧 PID-only 暂存不追扫。
- 历史原件备份不启动时整库删除，未来不再新增、显式删除清对应条目；单份简历覆盖／删除语义保持。
- 局域网 HTTP／WS 仍限可信私人网络／热点；同会话 1024 条命令去重上限保持，不 LRU 重执行副作用命令；未复现的 epoch 冻结不凭推测修改。
- 本地资料不新增应用层全量加密，凭据系统加密与隐私说明保持；第三方网站图标服务不改。无受限企业环境需求，不重写 Windows PowerShell ZIP 或追加特殊安装参数兼容。
- 不为完全隔离 CLI 重写 Copilot 凭据命名空间；不新增 Authenticode／Developer ID 身份或拆分／轮换现有更新 key。固定 Mac helper 和 Keychain 兼容不能静默迁移。
- 不将本次静态审阅扩称全部 vendor／图标美术工具／所有硬件已验证；未覆盖的 Mac 原生行为保持未验证，不把无证据问题直接变更成产品逻辑。

## 建议执行顺序与入口

### P01｜先盘点，再同步本平台配置

在 Mac 开始先读 `AGENTS.md`、`PROGRESS.md`、本文及安全加固交接，检查 `git status`／diff 和当前版本，保留现有改动。`windows/` 全树只读；只在 Mac 安装依赖／同步 Mac importer 和锁，不在根或 shared 安装 node_modules，不升级固定依赖或模型。先实现 M4 安全入口收尾，再推进 M1／M5；不要因为旧测试需要而重新打开生产 inspector／RunAsNode。

### P02｜静态、单元和构建

在对应平台配置已同步后，于 `macos/` 使用现有命令：

```sh
pnpm typecheck
pnpm check:architecture
node ../shared/scripts/check-platform-layout.mjs
pnpm test
pnpm build:shared
```

重点定向用例按源码实际列表选择：runtime-policy／electron-launch-policy、chat／chat-responses／chat-events／cancellable、云账号／同步及 store、knowledge-core／host／process／renderer services、speech-failures／host／line-buffer／Qwen、components、Copilot runtime、account-erasure-writers／quit-drain、mobile connection／LAN／remote UI、截图、ui-language、input-mode／settings／shortcut 等。Windows-only helper／签名／安装器用例不移植为 Mac 假通过。构建前先完成 M5，否则 sharp importer 和 unpack 缺口会造成真实失败。

### P03｜无硬件的真实 Electron 生命周期

先审阅入口，再在解锁控制台串行运行可适用合成脚本：

```sh
node ../shared/test/scripts/quit-drain-smoke.mjs
node ../shared/test/scripts/knowledge-host-smoke.mjs
node ../shared/test/scripts/screenshot-performance.mjs
node ../shared/test/scripts/functional-suite.mjs --list
node test/scripts/ui-refinement-matrix.mjs --list
```

截图 performance 使用合成 bitmap，不加硬件／宿主截图参数。完整功能套件先 `--list` 明确选择与授权再运行，不能与其他 GUI／原生任务并行。Mac 现有 `test:audio:native`、screen permission、window native、MLX 等入口涉及平台行为，逐个确认是否采样硬件／改权限，默认不能直接放入普通回归。

登录入口定向回归还需覆盖 S46 的共享 `login-entry-smoke.mjs`：确认导入 main 前已固定三个隔离路径、运行时实际路径正确且测试环境标志为空，再验证正常登录／预览和严格退出。不要只在 launcher 外层删除变量后假定它不会被补回，也不要删除路径隔离来验证无 fixture 状态。

### P04｜合成账号删除与关闭

`account-erasure-smoke.mjs --synthetic-dialog` 只使用 owner 自有临时账号／资料及固定服务端测试引用；当前契约引用为服务端 0.5.3 `3bceb615dbba900f669322c301fc4b5b473dfb15`，由 `VOXCUE_TEST_SERVER_ROOT` 指向经过核对的只读测试副本。不得为测试改现用服务端、连正式账号服务、使用真实 Keychain 或绕过普通 UI 的凭据助手禁令；无匹配测试引用先处理夹具兼容再跑，不把环境连接失败当产品失败。

### P05｜最终包／签名与 OS 隔离

完成 M4 后，把静态安全检查与必要运行验收分开：最终 `.app`／DMG／ZIP 的 fuses、ASAR 摘要、Hardened Runtime、entitlements、固定签名／helper 身份、平台依赖、unpacked Worker、Sparkle 与更新签名都核对实际产物。运行验证须采用不共享宿主 userData／login Keychain 的 OS 隔离环境、合成资料和禁真实网络边界，使用正常产品 UI／公开接口与明确的隔离原生夹具。原依赖 renderer CDP 的入口须随 M1 的启动链收口迁移，不为测试保留生产 CDP 参数；OS 隔离不等于已封闭该执行入口。不得修改最终 ASAR、重开 inspector 或编入测试标志来获得可测试性。

### P06｜历史升级和离线／慢网更新

保护 1.1.1 原始发行资产，在隔离副本内用合成资料验证旧二进制到新包升级、快捷键／主题／语言／原件保留，单独记录真实覆盖的旧版本；不能用当前页面重载代替。M12–M14 用自有本地 feed／固定合成归档覆盖慢速持续进度、空闲超时、取消、重启 journal、离线复用、安装失败、旧包回收与进度合并；保持完整签名和摘要校验，不使用真实私钥做普通回归。

### P07｜先验证事项与原生恢复

M6／M15 只用已有且明确授权的隔离虚拟设备与固定合成音；无条件则保留待验证，不采样麦克风或真实系统混音。M11／M16 只用自有签名测试副本和合成 Keychain／载荷，保护固定 helper、签名材料及真实 ACL；发现身份／兼容迁移需求先提出具体方案，不自动重签或换 key。M9 以失联／坏协议子进程验证本地期限和真实退休，Qwen CPU 算法不改。

### P08｜界面、清理和交付记录

对 S36–S42 做中英／浅深／系统主题色、键盘／减弱动画／强制对比、常用缩放和小屏回归，保持当前已验收布局与尺寸。确认无用文件须再核对动态、平台、构建及测试消费者才删除；活跃／未知临时目录不清理。结果仅终端／对话，归属明确的临时输出结束清理，公开固定模型缓存可复用且不提交。更新 `PROGRESS.md` 的接续摘要和待办，不把分数／截图／trace／报告写入仓库；Mac 发行仅按当轮明确授权。

## 可交给 Mac Codex 的接续提示词

```text
请接续 VoxCue 1.2.0 的 macOS 适配与回归。先读取 AGENTS.md、PROGRESS.md、
shared/docs/MACOS_1.2.0_HANDOFF.md、shared/docs/MACOS_1.2.0_TODO.md、
shared/docs/SECURITY_HARDENING.md，检查
status/diff 并保留后续修改；输入基线是 1.1.1 main
3160b6868c540ec7cc6d20cdca11bc10b19bdd0c，版本唯一来源 shared/package.json。
Windows 全树只读，依赖只在 Mac 安装／同步，不升级依赖或模型，不轮换签名身份。

按交接 S01–S54 逐项检查共享改动的 Mac 影响，不重复实现共享逻辑；W01–W22
仅作为 Windows 参考。先修 M4 正式包测试原始启动入口，再做 M1 fuses／Hardened
Runtime 和 M5 sharp／Worker unpack；继续处理 M3、M9、M12–M14，M6／M11／M15／
M16 先在允许的合成隔离环境验证再选择最小修复。既有 Unix socket 租约／前驱回收
重试、Copilot vault、真实 utility 退休及退出 drain 均补本机回归。不要启动仍未适配的
旧 package-smoke 或 --static-only，也不要恢复生产 inspector／RunAsNode、增加产品测试标志。

保持已验收 UI、滑块／开关尺寸、现场面试名称、单份简历语义、第三方网站图标、
Qwen CPU 长段算法、实时积压预算和手动恢复；不清扫真实历史备份／组件恢复目录。
保护真实账号、Keychain、固定 helper/CDHash/ACL、签名私钥及旧发行资产，不访问
或迁移真实资料；仅 owner 解锁控制台串行 GUI／原生，合成资料／图片和固定摘要公开
模型音频，不采样硬件／宿主屏幕，不改系统权限／默认设备。

按风险做架构／类型／单测／构建、定向界面、原生与最终签名包 OS 隔离回归，修复后
重测；当前格式重载与旧二进制升级分开说明，Windows 结果不能代验 Mac。测试结果只在
终端／对话，临时产物归属明确并结束清理，更新 PROGRESS 的摘要／待办。提交、推送和
Mac 发布只按本轮明确授权执行；若当前未授权，完成修改及验证后保留工作区，不自行发行。
```

## 发行与接续记录

- Windows 1.2.0 冻结基线：私有仓库 `v1.2.0`；实际提交号及 GitHub／Store 2.2.0.0 状态见 [Windows 发行索引](WINDOWS_1.2.0_RELEASE.md)。
- Mac 本机接续提交、已实施 M 项与仍待验证项：待 Mac 执行者更新；本文没有 Mac 完成声明。
- 详细测试成绩和临时产物不保存在本文或仓库。
