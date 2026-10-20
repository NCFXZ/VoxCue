# Windows 0.5.1 → 当前 0.5.3：完整修改说明与逐项接续清单

日期：2026-10-20。面向 Windows Codex。对照源码、同步已有实现、补齐 Windows 原生适配并逐项确认；本文件不代表 Windows 已完成验收。

## 1. 比较基线和接续顺序

| 项目 | 准确范围 |
| --- | --- |
| Windows 0.5.1 源码基线 | `79e35d365fe89a35150f02e9db4c5c5411f52d52`，提交标题 `Add Qwen streaming speech and refine Windows 0.5.1`；该提交的 `windows/package.json` 为 0.5.1 |
| 已同步的中间版本 | `29016654da3096b93db8d351266d041b574c192b`，共享/Mac 0.5.2，包含语音计时、后台切换、异步对齐和 Q8_0 支持 |
| 本次源码交付 | 包含本文件的提交及其父提交，额外包含 0.5.3 图标、圆角、菜单、输入区和记录动画等最终实现；不能只同步到 `2901665` |
| 当前配置 | `shared/package.json`、根和 Mac 配置为 0.5.3；Mac 本次没有改写 `windows/`，Windows 生成配置仍为 0.5.1 |
| 当前公开应用 | [Mac v0.5.3](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.5.3)、[Windows v0.5.1](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.5.1)；源码同步不会自动更新 Windows 安装包或 Qwen Runtime |

本报告累计覆盖 **0.5.1 → 0.5.2 → 0.5.3**，不能只核对最后一个提交。旧 [0.5.2 清单](WINDOWS_0.5.2_HANDOFF.md) 可补充查阅，冲突时以本文件及当前源码为准。最初的 [Windows Qwen 交接](QWEN_WINDOWS_HANDOFF.md) 中“终稿后等 1000ms”“Mac 尚未接入”等属于历史状态。

下文为便于查找缩写路径：`contracts/`、`application/`、`backend/`、`ipc/` 均位于 `shared/electron/`，`src/` 位于 `shared/`，单写组件名位于 `shared/src/components/`；未标平台的 `.test.ts(x)` 和 `*-smoke.mjs` 分别在 `shared/test/unit/`、`shared/test/scripts/`，Renderer 测试另标路径。附录给出全部完整路径。

执行顺序：保护 Windows 本机工作并同步源码 → 更新本平台生成配置 → 离线单测/静态检查 → 重建 Windows CPU/CUDA Qwen 程序 → 原生协议、切换、对齐和组件兼容 → 共享功能与视觉/DPI → 长时合成稳定性。资源或硬件不足的项目明确标记待办，不能用 Mac 结果代替。

- [ ] **A01 安全同步。** 先检查 status/diff、分支、远端及进程；保护本机未提交内容后安全快进，不 reset/clean、整文件回退或覆盖本地工作。取到包含本文件的新 main，确认基线是其祖先。
- [ ] **A02 平台归属。** 页面、store、业务、IPC、Rust 通用逻辑只在 shared 保留一份；Windows 允许必要本平台适配。Mac 文件仅经 Git 同步，随后 `macos/` 严格只读。
- [ ] **A03 版本和依赖。** 在 Windows 运行现有同步入口生成本平台 0.5.3 配置；禁止 `--all` 改写 Mac。依赖安装使用冻结锁，不升级已有版本，不复制 Mac 锁、node_modules、运行时或签名材料。本轮 pnpm 平台锁未改；Rust 锁含 Mac 新增依赖，Windows 仍须按现有 Cargo.lock 构建。
- [ ] **A04 授权边界。** 用户本次要求源码上传和 Windows 接续报告；Windows 按清单本地修改或确认。后续提交/推送、模型 Runtime 上传、打包发行、真实安装替换及修改旧资产仍需当次授权。不要改写公开 0.5.1、Mac 0.5.3、模型旧包或既有 Latest。
- [ ] **A05 数据和测试。** 仅隔离合成账户/资料/响应/采集端口及固定公开模型/音频，不读真实凭据、简历、聊天或记录，不调用真实账户推理，不采集物理音频/屏幕。GUI/原生串行，临时内容在自有系统临时根退出清理，结果到终端/对话，不恢复历史十分钟物理语音或重试此前跳过目录。

建议同步后在仓库根核对：

```powershell
git status --short
git log -3 --oneline
git merge-base --is-ancestor 79e35d365fe89a35150f02e9db4c5c5411f52d52 HEAD
git log -1 --format=%H -- shared/docs/WINDOWS_0.5.3_HANDOFF.md
git diff --stat 79e35d365fe89a35150f02e9db4c5c5411f52d52 HEAD
```

## 2. 自动回答：改为按音频时钟累计 1800ms

0.5.1 的 `automaticAnswerDelay()` 返回 1000，Renderer 收到系统 `silence` 终稿后启用计时器。当前删除了这层固定等待，引入端点与已处理音频进度；800ms 分段保持。

| 编号 | 当前实现及 Windows 要核对的行为 | 操作和通过标准 |
| --- | --- | --- |
| B01 | Paraformer/Qwen 共用 800ms VAD 分段、1800ms 自动回答静音目标 | 对两模型回放相同音频：最后一帧系统语音为 T，约 T+800ms 收尾，已处理系统音频达到 T+1800ms 才满足时间条件；800ms 包含在 1800ms 内 |
| B02 | 以 `silenceStartMs`、`processedThroughMs` 和每路 `pending` 判断，不能从终稿接收时刻起算 | 延迟终稿到达 T+1800ms 之后且进度/积压已满足时直接进入提交流程，不再加 1000ms；不能产生 800+1800ms 或 1800+1000ms |
| B03 | 终稿就绪、已处理静音达标、后续系统包已检查，三项同时满足 | 让后续系统包积压且包含重新开口：旧终稿不得越过未检查包自动发送；pending 为 false 本身也不能代替可信进度 |
| B04 | 仅系统 `silence` 终稿触发 | `sentence/limit/stop/pause/discontinuity`、临时稿和麦克风终稿均不触发；有 VAD 帧粒度与推理耗时，1800ms 不是墙钟 SLA |
| B05 | 系统重新开口撤销旧截止点 | 覆盖 speech-start、临时稿、连续两个问题、重新说话后再次静音；只发送当前完整问题一次 |
| B06 | 麦克风不重置系统问题的静音截止点 | 系统停止后麦克风继续说话，系统已确认的问题仍按其音频轴处理；麦克风本身不触发自动回答 |
| B07 | 保留草稿、手动消费去重、忙时排队、自动回答开关及结束保护 | 回答中到新问题，完成后按原队列继续；手动已发的问题不再自动重发；暂停/结束/重连/断流/旧会话事件不发送旧问题 |
| B08 | **Windows 仍有回环兼容补静音路径；Mac 已停用定时补零** | 用合成 WASAPI 分别模拟真实静音、缺包、采集卡住、无效 QPC。缺包不能按墙钟伪造成可信处理进度而触发回答；不能直接删掉 Windows 必需兼容路径来照搬 Mac |

源码：`contracts/speechSettings.ts`、`contracts/speech.ts`、`backend/speech/{controller,engine,qwen,worker}.ts`、`src/stores/interview.ts`、`src/services/speech.ts`。入口：`automatic-question.test.ts`、`speech-endpoint.test.ts`、`speech-progress.test.ts`、`speech-store.test.ts`、`interview-usage-offline.test.ts`、`interview-usage-smoke.mjs`。

## 3. 语音模型和推理设备：后台加载，停顿后交接

0.5.1 的语音重连先停止原控制器再按新配置启动。当前只在音源/设备发生变化时保留重连；同一捕获配置下的识别模型/推理设备变化走独立候选识别器。

| 编号 | 当前实现及 Windows 要做什么 | 操作和通过标准 |
| --- | --- | --- |
| C01 | 旧识别器在候选加载期间继续处理原捕获/AEC 输出 | 连续输入时切 Paraformer→Qwen、Qwen→Paraformer、Qwen CPU→CUDA、CUDA→CPU；加载期间转写继续，捕获和 AEC 不重启 |
| C02 | 候选独立 Worker 加载，准备后等待两路旧 VAD 空闲 | 一路持续发言时不强截、不提前交接；两路停顿后只交接一次出稿权；显示“正在加载，原配置继续转写…”及“已就绪，等待语音停顿后切换…” |
| C03 | 最多 300ms 的处理后 PCM 在内存补齐边界 | 检查边界没有遗漏或重复终稿；不是保存到磁盘，也不让新旧识别器同时发布同一段 |
| C04 | 加载上限 180 秒，等待停顿上限 120 秒，交接预热上限 1 秒 | 合成超时/候选启动失败/预热超时后保留旧配置、旧转写和采集；这些是取消上限，不是附加到 1800ms 的固定等待 |
| C05 | 成功后才确认新设置，失败恢复最后成功配置 | 切换成功、失败、用户再次操作、重开设置和恢复采集后，显示与实际进程模型/设备一致；不能只更新下拉框 |
| C06 | 暂停/结束/断流/音频重连可取消加载，不排在长加载之后 | 候选和退休 Worker/EXE 真实退出；迟到 ready/终稿/完成通知不改变旧会话；旧实例释放前拒绝第三套加载 |
| C07 | 处理“交接通知在途时暂停”的竞态 | 暂停排空后退休识别器，恢复时按最后确认配置重载；close 失败也先等候选/退休实例释放再报错，不以清 UI 代替真实卸载 |
| C08 | 改播放设备/麦克风仍走重连，系统音源必留 | 改音源按原入口停/启并保留当前面试内容；无效设备不悄悄换默认。不要把所有设置变化都强行走后台交接 |
| C09 | **回答模型和思考强度保持原逻辑** | 回答中可改，但当前回答继续使用开始时快照；下一题/之后排队题使用新配置。知识库/资料仍按本场锁定，问题、草稿、截图、去重和排队不回退 |

源码：`application/speech.ts`、`backend/speech/{recognition,recognizer,recognizer-worker,controller,host,worker}.ts`、`src/stores/interview.ts`、`SpeechModelSettings.tsx`。入口：`speech-switch.test.ts`、`speech-host.test.ts`、`speech-session.test.ts`、`speech-failures.test.ts`。Mac `speech-switch-smoke.mjs` 仅供流程参考，Windows 须补实际 Worker/EXE、WASAPI/AEC 和独占句柄验证。

## 4. Qwen：共享 Rust、异步对齐与实际音频裁剪

Windows 0.5.1 已使用 Rust，**不是本轮才从别的语言迁移到 Rust**。当前继续复用 `shared/native/qwen-speech/`，重构引擎并将原来会阻塞 ASR 的对齐拆到独立有界任务。Mac MLX 留在 `macos/`。

| 编号 | 当前修改 | Windows 操作和通过标准 |
| --- | --- | --- |
| D01 | ASR 后端抽到 `engine.rs`，对齐调度新增 `alignment.rs` | CPU/CUDA 均从当前 shared 源码重建；不能继续用旧 EXE 验证新协议，不能把 `pnpm build` 当作已重建 Qwen |
| D02 | 一份在途对齐、每音源最多一份待处理快照、两路公平轮换 | 对齐很慢时 ASR 临时稿仍继续；检查任务数有界、两路都能获调度，不无限堆积或只处理一路 |
| D03 | 结果匹配会话代次、窗口起点、快照范围、首句与前两句 | 重置/暂停/收尾、识别修订及窗口已变化时，过期结果只丢弃；失败不固定错误文本、不停止临时稿 |
| D04 | 四个句末边界、首句两次稳定及安全对齐条件均满足才固定首句 | 用实际长音频要求出现 sentence/committed，并核对切点在相邻词间安全中点；不能仅检查文字变短 |
| D05 | 从**当前实时窗口**裁剪，保留对齐期间新增音频与最新尾稿 | 裁剪前后完整文本无丢失/重复，保留尾部 PCM；销毁旧流/token/编码器缓存，不把旧音频继续传入下一窗 |
| D06 | 无安全对齐时延后；连续发言无固定 30 秒分段，120 秒保护仍为 limit | 故意制造对齐失败和超长语音，确认不按字符比例猜切点，limit 不触发自动回答 |
| D07 | Windows 原块长规则保持：CUDA 总显存≥4GiB 用 500ms，其余 CUDA/CPU 用 1000ms | 读取原生 ready 的实际设备/块长，对齐器 CUDA 失败时明确标“对齐 CPU”；ASR 不静默回退。500ms 块长不等于每次出字≤500ms，选择正确性和稳定性最好的方案 |
| D08 | EOF 监视提前到模型加载之前，加载或推理中断管应退出 | 在加载中/运行中关闭拥有者，检查 Qwen EXE、Worker 及模型映射真实释放；CPU 程序仍不导入 NVIDIA DLL |
| D09 | ARM NEON 等价对齐内核及 Mac 线程池分支 | Windows 保留原 x86 SIMD/线程策略；确认条件编译不引入 Mac API、CPython、MLX 或 Metal 到 Windows，既有 Candle 0.9.2 等依赖不升级 |
| D10 | Windows CUDA 硬件要求保持 0 号设备计算能力≥8.0、驱动 API≥12.9、初始化成功 | 无驱动/旧显卡只隐藏 CUDA，Qwen CPU 仍可选可下载；探测不加载权重或启动采集。仅真正选择 CUDA 启动/重连时校验，不映射为 Metal |

源码和构建参数见 [共用 Rust 说明](../native/qwen-speech/README.md)。共享协议还增加端点、音频进度、后台交接状态及可信运行时路径；Renderer 不得指定可执行程序、下载地址、模型绝对路径、线程数或块长。

## 5. Q8_0 对齐模型：必须先解决 Windows Runtime 兼容

量化的是 ForcedAligner，ASR 仍为同一份原始 BF16 Qwen3-ASR 0.6B。Q8_0 减少下载/磁盘体积；加载后按原引擎计算精度构建张量，不能把磁盘减半宣传为运行内存减半，也不能声称对齐改用 Metal。

| 资源 | 固定信息 |
| --- | --- |
| 已追加的独立资源 | [`models-v1.0.0/VoxCue-Qwen-Aligner-Q8_0-1.0.0.zip`](https://github.com/NCFXZ/VoxCue-releases/releases/download/models-v1.0.0/VoxCue-Qwen-Aligner-Q8_0-1.0.0.zip) |
| ZIP | 946,306,488 字节；SHA256 `cd71311aa16e2aa69f495a5e9011f73fa96d42772caab527e211a4723cad217d` |
| `model.gguf` | 985,594,624 字节；SHA256 `539df5dd0fe1721e378ac13bfac9a26b1260dafb62d892c518c1f21244762636` |
| 固定来源 | `cstr/qwen3-forced-aligner-0.6b-GGUF@1ec5110602ccab18c878ddebedab0891e290a95c`；配置/分词文件沿用原版，包内保留来源及许可证 |
| 当前平台隔离 | Mac Qwen 组件 1.0.1 使用原 ASR+Q8_0，运行时随应用签名；Windows 仍为原 1.0.0 的 BF16+CPU/CUDA Runtime 组合 |

- [ ] **E01 新格式加载。** 新 Windows CPU/CUDA 程序都能加载 GGUF v3 的 F32/F16/Q8_0，校验完整 708 张量、名称/形状/范围/重复/重叠及量化比例；截断、损坏、错误类型明确失败，拒绝 GGUF/safetensors 混放。
- [ ] **E02 同条件比较。** 在自有临时组件内，以同一 ASR、同一固定中英文音频交替比较原 BF16/Q8_0：加载、延迟、完整转写、逐词起止时间、安全裁剪、双路连续输入及内存。近似一致后再决定 Windows 量化迁移；Mac 比较不代替 Windows CPU/CUDA 测试。
- [ ] **E03 资源接续。** 先通过新的 CPU/CUDA Runtime 和新 Worker/协议，再准备新 Windows Runtime 归档、逐文件固定摘要及独立组件版本。原子启用整组件，取消/失败不留下半组件；生产目录不能引用尚未发布的本地 EXE。
- [ ] **E04 保留兼容。** 不直接让旧公开 Windows Runtime 使用 Q8_0，不盲目把 Mac 的 1.0.1 目录套到 Windows。若本机验证完成但资源上传未获授权，应报告“本地完成、生产接续待资源发布”，不能写成端到端已完成。
- [ ] **E05 固定信任。** `qwen-int8-catalog.ts` 固定包与逐文件摘要，`package-qwen-aligner.py` 仅生成独立资源。保留旧 BF16 和旧 Runtime，不覆盖旧资产、不改成远程可变清单。

## 6. 模型可用性、删除回退和性能提示

| 编号 | 0.5.1 后修正 | Windows 操作和通过标准 |
| --- | --- | --- |
| F01 | 任意一个语音模型 ready 即满足语音能力 | 仅 Paraformer、仅 Qwen、都有、都无四组合；仅 Qwen 时删除 Paraformer 不应提示“本地语音模型尚未就绪”。RAG 缺失仍独立提示，不能误认为任意语音模型可以替代 RAG |
| F02 | 删除当前选中模型后切到另一已安装模型并持久化 | 当前 Qwen 被删→Paraformer/CPU；当前 Paraformer 被删且 Qwen ready→Qwen/CPU。重开设置、刷新、重启保持；重新下载旧模型不自动抢回选择 |
| F03 | checking/downloading/verifying/removing、全局错误、删除失败和无替代项时不乱改设置 | 延迟旧 revision 不覆盖新状态；设备/音源、回答模型和思考强度不跟着语音回退而改变 |
| F04 | Qwen+CPU 单独显示性能提示 | 标题必须为 **“语音识别模块性能受限”**，正文为“当前使用 CPU 运行 Qwen，转写更新可能稍有延迟。可在设置中调整推理设备。”；入口直达推理设备。需 Qwen 已安装且无其他必需组件缺项；Paraformer/CPU、Qwen/CUDA 不误报 |
| F05 | 未下载禁用、硬件不可用回到 CPU、模型切换状态及时显示 | 鼠标/键盘/迟到事件都不能选择已禁用项目；组件状态订阅清理正确；浮窗仅订阅状态，不获得下载/删除权限 |
| F06 | 开场自检优先 Paraformer，仅 Qwen 时可信主进程回退到 Qwen/CPU | 不要求补装 Paraformer；自检只回传电平/状态，不写转录或调用回答模型。准备聊天已删除的语音输入入口不恢复 |
| F07 | 删除前等待捕获、Worker、原生 EXE 和 ONNX 释放 | 用 Windows 真实独占句柄验证正在使用的实际文件可释放；先确认文件存在，不能检查不存在的旧 BF16 路径获得假阴性。未知原文件/其他合成资料继续保护 |

源码：`contracts/components.ts`、`backend/components/{catalog,service}.ts`、`ipc/components.ts`、`main.ts`、`src/stores/{components,interviewSettings}.ts`、`ComponentsNotice.tsx`、`SpeechModelSettings.tsx`、`application/speech.ts`。入口：`components-notice.test.tsx`、`components.test.ts`、`renderer/stores/components.test.ts`、`interview-settings.test.ts`、`components-ui-smoke.mjs`。

## 7. 全部界面修改：Windows 复用 shared，再做原生视觉确认

下表“悬浮阴影”区分两种：控件悬停使用 `--hover` 背景；弹层/抬升表面使用共用 box-shadow。选中菜单项不额外加 box-shadow，危险操作只保留其危险色。

| 编号 | 最终行为 | Windows 逐项检查 |
| --- | --- | --- |
| G01 | 全部公共图标按组件指定 `--icon-size` 显示，删除 `max(size,1.2em)` 的额外放大 | 主界面、菜单、浮窗、12/18/24 号面试字体均核对；不额外全局 scale，不缩小点击区域。Windows 保留 Fluent，Mac 保留 SF Symbols |
| G02 | 下拉统一单个向下箭头 | 主题、主题色和普通选择框均不得出现上下双箭头。Windows shared 的 `ChevronsUpDown` 已映射 ChevronDown；Mac 新映射只读参考 |
| G03 | 记录 AI 回答侧栏开合动画 | 240ms 位移、180ms 透明度；快速反复开合不抖动。关闭后 `inert`、`aria-hidden` 及延迟 visibility 排除隐藏交互；窄屏覆盖层不挤出主页面 |
| G04 | 回答定位只滚动回答栏 | 从转录点击回答、重复点击同一回答、面板正在展开时，定位正确，页面祖先不横向移动；收起焦点回到入口 |
| G05 | 主题/主题色触发框缩短为 200 CSS px，菜单跟随触发宽度 | 两个下拉菜单各自与下拉框同宽，受视口可用宽度约束；长文字截断、图标/勾选对齐，不能恢复旧 156px 菜单最小宽度 |
| G06 | 普通表面统一连续角，半径按控件大小适配，整体圆角增大 | 当前使用 CSS `corner-shape: superellipse(2)`，目标连续曲率，Chromium 实际绘制为近似；检查边框、背景、overflow、阴影、伪元素和 Portal。不要宣称改写系统原生窗口边框或数学精确曲线 |
| G07 | Switch 为完整圆弧胶囊，滑块为圆形 | 浅深色、开关两态、禁用、键盘操作和 reduced-motion 下均无方端、缺角或滑块裁切 |
| G08 | 弹出菜单与触发父控件的圆角/曲线一致 | 账户卡片/账户菜单共用 20px；普通选择及主题菜单共用 14px；聊天附件/模型/思考菜单与触发控件共用 16px 圆弧。菜单项目本身按行样式，不把整菜单改成长胶囊 |
| G09 | 聊天模型和思考强度的 hover/open 背景为胶囊 | 32px 高、16px 圆弧；附件图标为圆形，同组入口的弹层阴影一致；禁用项不高亮 |
| G10 | 浮窗顶部整体为胶囊、纯图标控件 hover 为同款圆形 | 设置/保护/结束/拖动柄统一 32×32；结束确认展开后为胶囊，危险色保留。不能只改结束而漏掉拖动柄或预览 |
| G11 | 指定状态/操作改为胶囊 | 语音模型/麦克风/系统音频就绪标签、转写切换、自动回答、截图计数展开、个人信息五项完成状态、记录/权限/预览状态；纯截图静止为圆形，展开数量为胶囊 |
| G12 | 菜单选中只保留尾部勾，不保留选中底色 | 主题、强调色、回答模型、思考强度、语音模型、推理设备、设备、知识库等逐项覆盖；移走指针后 checked 项透明，hover/键盘当前项才高亮，勾在尾部且禁用保持 |
| G13 | 同一 Renderer 窗口同时仅一个下拉菜单 | 主题→主题色、模型→思考、账户→其他菜单连续打开；前一个关闭、不抢新菜单焦点。覆盖受控/非受控根、默认展开、卸载、Esc 正常恢复焦点、两个独立窗口互不关闭 |
| G14 | 大圆角输入区和整列渐隐，阴影贴着输入框 | 渐隐覆盖聊天列两侧，底边贴输入框顶边，不留空档或左侧文字；打开/拖动个人信息栏、窄屏、长内容、浅深主题均核对。遮罩不吃点击，不挡输入区菜单 |
| G15 | 返回最新按钮为 36×36 圆形向下箭头 | 聊天和面试复用 `FollowLatestButton`，不显示长文字；点击定位最新，保持原阅读暂停/跟随行为，不挤占正文高度 |
| G16 | 思考/输出时返回按钮改为三个跳动圆点 | 三点依次上下，周期 1050ms、间隔 140ms；仍可点击定位，完成后按阅读位置显示箭头或隐藏；reduced-motion 三点静止，不能把 busy 指示误接成停止回答 |
| G17 | 普通控件默认箭头，编辑区文本光标，个人信息分隔栏左右调整光标 | 不变手形；可编辑/只读可复制输入及 contenteditable 为 text；8px 分隔柄为 col-resize。原拖动、取消、键盘和缩放行为保留，不将本来可拖动功能禁用 |
| G18 | 开始面试摘要增加语音模型、推理设备 | 从本次待启动配置快照经 speechSelection 规范化：Paraformer/CPU，Qwen/CPU 或 CUDA；与真正启动选项一致。与音源、回答模型/思考强度同样两列，知识库独占行；不新增采集或推理 |
| G19 | 浮窗设置字段标签置于完整宽度选择框上方 | 音频/模型/显示分组，宽度不足单列；不出现“回答模型”“思考强度”逐字竖排。主设置/浮窗即时应用与状态订阅一致 |
| G20 | 同类表面与异常提示统一 | 紧凑删除按钮沿用普通控制半径，删除错误浮层与设备 tooltip 同用控制半径/抬升阴影；主输入、面试输入、工具栏、回答气泡、返回按钮共用抬升阴影，菜单共用 popup 阴影 |
| G21 | 授权返回页同步更大连续角和默认箭头 | received/invalid/used/not-found、浅深色、980/360 宽度；卡片 40px、窄屏 36px，下一步区域 28px，成功圆标保持圆形。PKCE/state/一次消费、CSP/no-store、本地嵌入资源不变 |
| G22 | 原显示/状态行为保持 | 字号 12–24、独立面试透明度 0–100、60/30 表面曲线、不透明设置及外部首击只关闭、自动设备刷新、紧凑电平与来源故障分类；不恢复完成/应用/手动刷新按钮或增加采样 |

### 视觉参数参考

| 同类组件 | 当前规范 |
| --- | --- |
| 普通按钮、输入、普通选择触发/菜单 | `--radius-control: 14px`、连续角 |
| 卡片、账户触发/菜单 | `--radius-card: 20px`、连续角 |
| 对话框 | `--radius-dialog: 32px`、连续角 |
| 聊天附件/模型/思考工具及菜单 | `--radius-composer-tool: 16px`、圆弧；32px 图标区为圆形 |
| 主聊天输入框 | 40px 连续角；面试输入框使用其现有尺寸适配半径，不强行套 40px |
| 圆形和指定胶囊 | 明确 `corner-shape: round`；圆形 50%，胶囊半径不小于高度一半 |
| 抬升/弹层/对话框阴影 | 分别复用 `--shadow-raised` / `--shadow-popup` / `--shadow-dialog`，浅深色独立 token；不是所有层级强制同一阴影 |

源码：`styles.css`、`ChatTools.tsx`、`HistoryDetail.tsx`、`PreparationPage.tsx`、`FloatingInterview.tsx`、`SettingsDialog.tsx`、`Sidebar.tsx`、`SpeechControls.tsx`、新增 `FollowLatestButton.tsx`、`ui/{choice-menu,dropdown-menu}.tsx`、`backend/auth/callbackPage.ts`。所有现用 Radix dropdown 根/内容经共用封装协调；不要在其他组件重新直接 import 原始 Root 绕过互斥。

入口：`settings-smoke.mjs`（选中/hover、菜单互斥、等宽）、`history-branding-smoke.mjs`（动画/定位）、`ui-ux-smoke.mjs`（渐隐/三点/圆形）、`ui-alignment-smoke.mjs`、`ui-refinement-smoke.mjs`、`typography-smoke.mjs`、`interview-typography-smoke.mjs`、`interview-ux-smoke.mjs`。新增 `continuous-corners.mjs` 对实际 computed style、Portal、光标、同类阴影和裁切像素进行复核；不能只读 CSS 字符串。

## 8. Mac 专属实现：只读确认平台边界

以下内容已经属于 Mac 实现，不要求 Windows 复制同名代码或取得相同延迟。

- [ ] **H01 Metal/MLX。** `macos/native/qwen-mlx.{rs,py}` 及锁、装配脚本保留 Mac 下；shared 仅条件编译接口。原始 BF16 ASR 对照后采用 MLX 500ms，CPU 为 Rust 1000ms；对齐 CPU。Windows 不引入 MLX、Python、Metal。
- [ ] **H02 缓存和调度。** MLX 复用稳定编码窗口/KV 前缀，活动窗口重新计算，窗口/mel 归一化变化使缓存失效；实际裁剪释放旧张量并用经过验证的保留尾稿重建文本前缀。Mac 低优先级有界对齐线程池不套入 Windows。
- [ ] **H03 私有运行时。** 固定 CPython 3.12.14、MLX 0.30.6 和 `mlx-qwen3-asr@41878a11cf338c59e13edc84bf4cb35f4b0f3ff6` 随 Mac 签名应用提供；禁网络、隔离环境、禁写字节缓存、拥有者断管退出。普通用户不需开发工具；Windows 继续现有本地 EXE/DLL 方案。
- [ ] **H04 平台装配/探测。** Mac 通过可信平台资源路径加载运行时，metal-check 不加载模型/音频；Core Audio 停止尾段、非有限样本拒绝、完整混音 AEC 保留。Windows 保持 WASAPI/QPC 语义并自行验收，不能拷贝 Mac 捕获实现。
- [ ] **H05 图形。** SF Symbols 保留原生透明留白，取消裁墨迹后再放大；小/大字号图形保持尺寸差异。Windows 用 Fluent + 共享正常尺寸规则，不需要生成 SF 资源或复制 Mac PNG。
- [ ] **H06 签名/打包。** Mac 固定本地证书、Sparkle/Ed25519、私有运行时最小系统 14.2、DMG/ZIP 装配及包验证仅 Mac；Windows 继续现有安装/更新方式，不复制 Mac 私钥、证书、更新配置或包资产。当前 Latest 仍为 v0.3.1，两平台按完整资产独立选版，Mac 0.5.3 不应让 Windows 选择 Mac ZIP。

更多细节：[Mac Qwen](QWEN_MACOS.md)、[Mac 更新](../../macos/docs/UPDATES.md)。

## 9. 清理、验证入口和既有功能保护

- [ ] **I01 确认清理范围。** 已删除无消费者旧回答面板 CSS（answer-panel/answer-scroll/answer-item/answer-question/transcript-scroll 及对应媒体/选择规则）、失效登录按钮覆盖和空规则。Finder 元数据/闲置 Mac 开发副本属于本机清理，不是要求在 Windows 按相同名字删除目录。保护动态 Worker、平台入口、现用固定夹具、锁/依赖、模型、当前构建、签名和发行/恢复基线。
- [ ] **I02 保持构建保护。** Electron 输出继续在临时目录编译/校验/备份，原地更新受管文件，保留目录身份、并发锁、未知文件保护和失败回滚；不能整树移动或清空现有输出目录。
- [ ] **I03 测试夹具同步。** 新端点/进度/交接/组件能力单测与合成 IPC 夹具已同步。视觉断言改为检查组件规定图标大小、连续角/圆形/胶囊、无选中底色和真实菜单互斥；错误/下载按钮仍有完整断言。不得删除失败断言、放宽句柄保护或改生产逻辑来凑通过。
- [ ] **I04 当前句柄检查修正。** Mac 切换专项改查实际 `aligner/model.gguf`，先 access 全部文件，再断言 lsof 无占用且无诊断。Windows 不运行 lsof，须用实际 Windows 模型格式及 EXE/DLL/ONNX 独占句柄完成同等证明。
- [ ] **I05 既有功能全量确认。** 登录/取消/回调、聊天 SSE 与重试/停止、历史保存恢复和损坏保护、个人信息与技能提案、PDF/DOCX/知识库搜索与 RAG 降级、面试记录关联和导出/删除、用量账本及重置全部保留。提示词、回答模型快照及主要聊天后端不是 0.5.3 新重写模块。
- [ ] **I06 截图和生命周期。** 五张暂存上限、失败/停止原图重试、自动回答不消费截图、关闭/结束释放、面试锁定资料、重载取消、旧事件保护继续覆盖；不实际截取用户屏幕。
- [ ] **I07 AEC 和异常。** 所选输出端点完整混音参考、48kHz/10ms、有限参考等待、缺失参考/单音源旁路、重采样和暂停/结束排空保持。NaN/Infinity/坏帧、过量积压、子进程失败显式处理，不改系统音量或默认设备。

## 10. Windows 执行入口

先查看入口参数与隔离方式；所有 GUI/原生顺序执行。若旧 Windows 入口需要真实账户、硬件采集或真实安装替换，先改成隔离合成方式，或明确标记未执行及原因，不直接运行。

```powershell
# 在 Windows 仓库根，仅同步当前平台生成配置
node shared/scripts/sync-platform-manifests.mjs
cd windows
# 依赖已齐无需重复安装；确需安装时使用冻结锁
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm check:architecture
corepack pnpm check:workspace
corepack pnpm build:shared
node ../shared/test/scripts/interview-usage-offline.mjs --full
corepack pnpm build
corepack pnpm test:windows:functional
corepack pnpm test:windows:regression
corepack pnpm test:ui:dpi
```

完整共享矩阵入口 `shared/test/scripts/functional-suite.mjs` 在 Windows 只选共享项；已有 Windows suite 可复用其隔离模型环境。单独补查时确保相同隔离模型变量和合成宿主，例如下列视觉/交互重点：

```powershell
node ../shared/test/scripts/functional-suite.mjs settings history-branding provider-ui ui-alignment ui-refinement ui-ux typography interview-typography interview-ux components-ui adversarial
```

Qwen 重建使用 `windows/scripts/build-qwen.ps1`，传入真实便携工具链、自有系统临时 BuildRoot、CPU-only VAD import library，分别执行默认 CUDA 与 `-Cpu`。该脚本固定 `--locked --offline`；若缺固定依赖缓存，准备对应锁版本，不升级依赖或移除锁保护。不要假设应用 build 已替换公开 Runtime。

在新 Runtime 的隔离组件上，核对参数后执行：

```powershell
# $component、$fixedWave、$fixedLongWave 是已认证的自有临时模型和固定音频
python test/scripts/qwen-native-smoke.py $component --device cpu --wave $fixedWave
python test/scripts/qwen-native-smoke.py $component --device cuda --wave $fixedLongWave --require-crop
node test/scripts/qwen-worker-smoke.mjs $component $fixedLongWave
```

还须追加 Windows 的实际新 Worker/EXE 双向后台切换、加载失败/取消、两路重叠、WASAPI 合成 QPC/补静音、CPU/CUDA GGUF 比较和真实独占句柄。无兼容 NVIDIA 硬件的项目写“未执行：无兼容设备”，不能将跳过当通过。

视觉矩阵至少覆盖浅/深色、100/125/150/175/200% DPI、默认/最小主窗、浮窗设置 960/620/440 CSS px、长模型/设备名、两窗同时存在、键盘和 reduced-motion；检查实际像素、边界、裁切、焦点与原生鼠标命中，而非只看字符串相等。

稳定性使用固定公开或合成音频，覆盖长发言实际裁剪、双路、反复暂停/重连/模型设备切换、关闭加载、有限队列和终稿不遗漏。采集队列峰值、原生推理耗时、文本更新间隔分别统计，不将队列低于 500ms 等同每次更新≤500ms。

## 11. 完成条件与给用户的逐项回报

本机 Mac 已有共享/原生及实际发行包验证入口；这不能证明 Windows 的 WASAPI、CUDA、DPI、独占句柄或新 Windows Runtime 已通过。真实账户服务、真人噪声/外放质量、真实安装升级和较旧操作系统实机不在合成验收的已证明范围。

Windows 完成后按 A01–I07 的实际编号逐项回报：

| 编号 | 状态 | 本机改动或确认依据 | 命令/操作与预期行为 | 未完成原因/下一步 |
| --- | --- | --- | --- | --- |
| 示例 B01 | 通过 / 已修复后通过 / 未执行 / 待资源发布或授权 | 对应文件/行或实际行为 | 确切命令、模型/设备与条件 | 不留模糊“应该没问题” |

若某项已由 shared 自动同步，只需确认当前 Windows 行为并报告证据，不重复造一套实现。发现偏差直接本地修复并复测；无法完整验证的项保持未完成状态。不要将源码版本 0.5.3、Mac 发行或旧 Windows 0.5.1 测试结果当作本次 Windows 0.5.3 完成标记。

## 附录：相对 Windows 0.5.1 的文件清单

下列为基线 `79e35d3` 到本文件所在交付快照的受管源码、测试与文档变化，包含 0.5.2 中间提交和 0.5.3 新文件；不包含依赖、模型、构建、发行和测试产物。`M` 为修改，`A` 为新增。Windows 专属源码在本次 Mac 比较范围内没有改写；其后本机接续变更另行核对。

累计 137 个文件（Windows 专属 0 个）。以下清单由实际 Git 差异与明确新增源码生成。

### 根配置与协作记录（4）

```text
M AGENTS.md
M package.json
M PROGRESS.md
M README.md
```

### 共享说明、配置与脚本（9）

```text
M shared/docs/ARCHITECTURE.md
M shared/docs/COMPONENTS.md
A shared/docs/QWEN_MACOS.md
M shared/docs/QWEN_WINDOWS_HANDOFF.md
A shared/docs/WINDOWS_0.5.2_HANDOFF.md
A shared/docs/WINDOWS_0.5.3_HANDOFF.md
M shared/package.json
M shared/scripts/check-platform-layout.mjs
A shared/scripts/package-qwen-aligner.py
```

### 共享 Electron / 合同 / IPC（22）

```text
M shared/electron/application/speech.ts
M shared/electron/backend/auth/callbackPage.ts
M shared/electron/backend/components/catalog.ts
A shared/electron/backend/components/qwen-int8-catalog.ts
M shared/electron/backend/components/service.ts
M shared/electron/backend/speech/controller.ts
M shared/electron/backend/speech/engine.ts
M shared/electron/backend/speech/hardware.ts
M shared/electron/backend/speech/host.ts
M shared/electron/backend/speech/qwen.ts
A shared/electron/backend/speech/recognition.ts
A shared/electron/backend/speech/recognizer-worker.ts
A shared/electron/backend/speech/recognizer.ts
M shared/electron/backend/speech/validation.ts
M shared/electron/backend/speech/worker.ts
M shared/electron/contracts/components.ts
M shared/electron/contracts/speech.ts
M shared/electron/contracts/speechSettings.ts
M shared/electron/ipc/components.ts
M shared/electron/main.ts
M shared/electron/platform/index.ts
M shared/electron/platform/types.ts
```

### 共享 Rust 推理与对齐（14）

```text
M shared/native/qwen-speech/Cargo.lock
M shared/native/qwen-speech/Cargo.toml
A shared/native/qwen-speech/examples/aligner-bench.rs
M shared/native/qwen-speech/README.md
A shared/native/qwen-speech/src/alignment.rs
A shared/native/qwen-speech/src/engine.rs
M shared/native/qwen-speech/src/main.rs
M shared/native/qwen-speech/src/sentence.rs
M shared/native/qwen-speech/src/vad.rs
M shared/native/qwen-speech/vendor/qwen-aligner/src/cpu_engine.rs
A shared/native/qwen-speech/vendor/qwen-aligner/src/gguf.rs
M shared/native/qwen-speech/vendor/qwen-aligner/src/lib.rs
M shared/native/qwen-speech/vendor/qwen-aligner/src/raw_tensor.rs
M shared/native/qwen-speech/vendor/qwen-aligner/src/weights.rs
```

### 共享 Renderer 与界面（19）

```text
M shared/src/App.tsx
M shared/src/components/ChatTools.tsx
M shared/src/components/ComponentsNotice.tsx
M shared/src/components/FloatingInterview.tsx
A shared/src/components/FollowLatestButton.tsx
M shared/src/components/HistoryDetail.tsx
M shared/src/components/InterviewSettingsPanel.tsx
M shared/src/components/PreparationPage.tsx
M shared/src/components/SettingsDialog.tsx
M shared/src/components/Sidebar.tsx
M shared/src/components/SpeechControls.tsx
M shared/src/components/SpeechModelSettings.tsx
M shared/src/components/ui/choice-menu.tsx
A shared/src/components/ui/dropdown-menu.tsx
M shared/src/services/speech.ts
M shared/src/stores/components.ts
M shared/src/stores/interview.ts
M shared/src/stores/interviewSettings.ts
M shared/src/styles.css
```

### 共享测试源码（38）

```text
M shared/test/README.md
A shared/test/renderer/stores/components.test.ts
M shared/test/scripts/adversarial-smoke.mjs
M shared/test/scripts/assert-download-button.mjs
M shared/test/scripts/chat-response-smoke.mjs
M shared/test/scripts/components-ui-smoke.mjs
A shared/test/scripts/continuous-corners.mjs
M shared/test/scripts/delete-controls-smoke.mjs
M shared/test/scripts/floating-smoke.mjs
M shared/test/scripts/history-branding-smoke.mjs
M shared/test/scripts/install-ui-account.mjs
M shared/test/scripts/interview-typography-smoke.mjs
M shared/test/scripts/interview-usage-smoke.mjs
M shared/test/scripts/interview-ux-smoke.mjs
M shared/test/scripts/settings-smoke.mjs
M shared/test/scripts/speech-soak.mjs
M shared/test/scripts/test-workspace.mjs
M shared/test/scripts/typography-smoke.mjs
M shared/test/scripts/ui-alignment-smoke.mjs
M shared/test/scripts/ui-refinement-smoke.mjs
M shared/test/scripts/ui-ux-smoke.mjs
A shared/test/unit/automatic-question.test.ts
A shared/test/unit/components-notice.test.tsx
M shared/test/unit/components.test.ts
M shared/test/unit/desktop-ipc.test.ts
M shared/test/unit/interview-screenshot-store.test.ts
M shared/test/unit/interview-settings.test.ts
M shared/test/unit/interview-usage-offline.test.ts
M shared/test/unit/speech-drain.test.ts
A shared/test/unit/speech-endpoint.test.ts
M shared/test/unit/speech-failures.test.ts
M shared/test/unit/speech-hardware.test.ts
A shared/test/unit/speech-host.test.ts
A shared/test/unit/speech-progress.test.ts
M shared/test/unit/speech-session.test.ts
M shared/test/unit/speech-store.test.ts
A shared/test/unit/speech-switch.test.ts
M shared/test/unit/speech.test.ts
```

### Mac 专属实现、配置与验证（31）

```text
M macos/docs/UPDATES.md
M macos/electron/platform.ts
M macos/electron/speech/controller.ts
M macos/electron/speech/process.ts
A macos/native/qwen-mlx.lock.json
A macos/native/qwen-mlx.py
A macos/native/qwen-mlx.rs
M macos/native/SymbolBuilder.mm
M macos/package.json
M macos/package.platform.json
A macos/scripts/assemble-qwen-mlx.py
M macos/scripts/build-launcher.mjs
A macos/scripts/build-qwen.mjs
M macos/scripts/development-signing.mjs
M macos/scripts/package-app.mjs
M macos/src/symbols.json
A macos/test/scripts/audio-synthetic-smoke.mjs
M macos/test/scripts/components-smoke.mjs
M macos/test/scripts/echo-cancellation-smoke.mjs
M macos/test/scripts/icons-smoke.mjs
M macos/test/scripts/native-build-smoke.mjs
A macos/test/scripts/qwen-aligner-compare.py
A macos/test/scripts/qwen-compare.py
A macos/test/scripts/qwen-comparison-corpus.py
A macos/test/scripts/qwen-comparison-workspace.mjs
A macos/test/scripts/qwen-native-smoke.mjs
A macos/test/scripts/qwen-prepare-comparison.py
A macos/test/scripts/qwen-removal-smoke.mjs
A macos/test/scripts/qwen-worker-smoke.mjs
A macos/test/scripts/speech-switch-smoke.mjs
M macos/test/unit/echo-worker.test.ts
```
