# VoxCue Mac 0.5.2：修改说明与 Windows 逐项核对清单

> 当前 Windows 接续以 [0.5.1 → 0.5.3 完整修改与核对报告](WINDOWS_0.5.3_HANDOFF.md) 为准，累计包含本文件及之后的界面修改。下文保留0.5.2历史说明；版本配置、源码最低提交和后续授权边界使用新报告，不将Windows配置重新降到0.5.2。

日期：2026-10-20。Mac 发行目标为 Apple Silicon arm64、macOS 14.2+；Windows 接续基线为 Windows 0.5.1。本文件描述本轮最终实现及 Windows 应验证的行为，不是 Windows 验收报告。

本文覆盖旧交接中冲突的规则：**保留 800ms 识别分段；自动回答从最后一次系统语音结束累计 1800ms，800ms 已包含在内；取消终稿后额外 1000ms；语音模型和推理设备在后台准备并于安全停顿交接；回答模型仍按原快照逻辑。** 不恢复旧计时器、旧设置排版或中断采集来加载模型的方案。

## 1. 接续前先确认源码和边界

- [ ] **确认拿到了本轮源码。** 用户已在应用发行后另行授权将本轮共享/Mac源码、测试和本文同步至私有 `NCFXZ/VoxCue` 的 `main`。以包含本文的本次源码提交或更新main为最低基线；原 Git 基线 `79e35d3` 尚不含本轮修改，仅拉取旧提交不等于取得 0.5.2。至少应存在 `shared/electron/backend/speech/recognition.ts`、`recognizer-worker.ts`、`shared/native/qwen-speech/src/alignment.rs`、`engine.rs` 和 `shared/electron/backend/components/qwen-int8-catalog.ts`，并包含本文列出的最新共享行为。源码未同步时先报告缺项，不把发行 ZIP 当源码，也不声称完成对齐。
- [ ] 先检查 Windows 的 status/diff、分支、远端、运行进程，保护已有工作后安全同步本次main；不得 reset/clean、整文件回退或覆盖本地修改。仅通过Git拉齐已有Mac文件，随后macos/严格只读；核对实际提交及文件，不能把旧本地分支当作已同步。
- [ ] Windows 只修改 `windows/`、必要 `shared/` 和根入口；`macos/` 严格只读。页面、store、业务与 IPC 保持 shared 唯一实现，不复制一套 Windows 页面。
- [ ] 共享版本源、根与 Mac 配置为 0.5.2；Windows 生成配置留在 0.5.1，须在 Windows 本机运行 `node shared/scripts/sync-platform-manifests.mjs` 同步本平台。不要用 `--all` 写另一平台，不升级既有依赖或照搬 Mac 锁文件、node_modules、签名材料。
- [ ] 本文供本机适配、构建、逐项测试与修复使用，不自动授权 Windows 提交/推送、资源上传、打包/发行或替换真实安装。保留全部旧版本、Windows 既有资产与仓库设置。
- [ ] 验证只用隔离合成账户、资料、响应、采集端口和固定公开模型/音频；不读取真实凭据、简历、聊天或记录，不调用真实账户推理，不采集物理音频/屏幕。GUI/原生检查串行；临时文件只放自有系统临时目录，退出清理，结果仅终端/对话。历史跳过目录不重试。

## 2. 本轮文件与平台归属

| 范围              | 主要入口                                                                                                                          | Windows 应做什么                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 自动回答音频时钟  | `shared/src/stores/interview.ts`、`shared/electron/backend/speech/{controller,engine,qwen}.ts`、`contracts/speech.ts`             | 核对端点时间、已处理进度、积压和所有取消条件                      |
| 后台模型/设备交接 | `shared/electron/backend/speech/{recognition,recognizer,recognizer-worker,worker,host}.ts`、`application/speech.ts`               | 用实际 Windows Worker、WASAPI/AEC 和新运行时验收                  |
| Rust 共用识别     | `shared/native/qwen-speech/src/{main,engine,alignment,sentence,vad}.rs`                                                           | 重新构建 CPU/CUDA 两个 Windows 程序，不能只测旧公开 EXE           |
| GGUF 对齐器       | `shared/native/qwen-speech/vendor/qwen-aligner/src/gguf.rs`、`qwen-int8-catalog.ts`                                               | 先验证新 CPU/CUDA 运行时能加载并正确裁剪，再接续 Windows 组件资源 |
| 模型就绪及回退    | `contracts/components.ts`、`backend/components/service.ts`、`shared/src/stores/{components,interviewSettings}.ts`                 | 覆盖两种语音模型的全部安装/删除组合与持久化                       |
| 设置与提示界面    | `InterviewSettingsPanel.tsx`、`SpeechModelSettings.tsx`、`ComponentsNotice.tsx`、`PreparationPage.tsx`、`styles.css`              | 核对主设置/浮窗、浅深主题、长标签与五档 DPI                       |
| Mac 专属          | `macos/native/qwen-mlx.{rs,py}`、`qwen-mlx.lock.json`、`scripts/{build-qwen,assemble-qwen-mlx,development-signing,package-app}.*` | 只读参考；不引入 Windows 构建或安装包                             |

Windows CUDA/CPU 和 Mac CPU 共用 Rust ASR、VAD、异步对齐、裁剪及协议。MLX、私有 CPython、Metal、Core Audio、SF Symbols、固定 Mac 签名与 Sparkle 属于 Mac；Windows 继续使用 CUDA/CPU、WASAPI、Fluent 和既有 Windows 更新方式。CUDA 不映射为 Metal，Windows 不编译或装配 MLX。

## 3. 自动回答：800ms 与 1800ms 必须按同一音频时间轴核对

- [ ] Paraformer、Qwen 都保留 800ms VAD 静音分段。假设最后一帧系统语音结束于 T，约 T+800ms 生成 silence 尾稿；最早在已处理系统音频达到 T+1800ms 时自动回答，**不是 T+800+1800，也不是收到终稿再等 1000ms**。存在 VAD 帧粒度和实际推理耗时，1800ms 不是墙钟保证。
- [ ] 只有系统音频的 `silence` 终稿可触发。`sentence`、`limit`、`stop`、`pause`、`discontinuity` 以及麦克风终稿都不触发。
- [ ] Worker 回传已实际处理的帧位置，控制器带上每路待确认音频/积压。终稿就绪、静音达标且后续系统包已检查三项同时满足才提交；不能只看当前队列长度或 Renderer 的 Date.now。
- [ ] 延迟终稿若在 T+1800ms 后才到，且进度/积压条件已满足，应直接进入原提交流程，不再额外计时。新系统语音、临时稿、恢复开口必须撤销旧截止点。
- [ ] 麦克风活动不触发、也不重置系统问题的静音截止点；新题、手动草稿、自动回答关闭/重开、回答忙时排队、终稿去重和手动已消费文本保护保持。
- [ ] 暂停、停止、断流、音频设备重连、结束/关闭、旧会话迟到事件均不能让旧问题自动发送。未确认的新系统包不能被旧终稿越过。
- [ ] **Windows 专项：** Mac 已禁用定时补零，Core Audio 缺包不能按墙钟冒充静音。Windows 仍保留原回环兼容补静音路径，不能直接照搬 Mac 的删除；须用合成 WASAPI/采集故障分别验证“合法静音”和“采集停顿”。若缺包被当成已处理静音推进到 1800ms，须在 Windows 修复可信进度来源并保留必要回环兼容，不能把当前 Mac 单测当作 Windows 已通过。

参考：`automatic-question.test.ts`、`speech-endpoint.test.ts`、`speech-progress.test.ts`、`speech-store.test.ts`、`interview-usage-offline.test.ts`、`interview-usage-smoke.mjs`。

## 4. 语音模型与推理设备：后台准备、安全交接

- [ ] 连续采集中切换 Paraformer→Qwen、Qwen→Paraformer、Qwen CPU→CUDA、CUDA→CPU。原捕获和 AEC 不重启，旧识别器在候选加载期间继续处理和出稿。
- [ ] 候选在独立 Worker 加载，只有两路旧 VAD 都空闲才交接。使用最多 300ms 处理后 PCM 在内存补齐边界，一次移交出稿权；不能让旧、新识别器同时重复发布同一段终稿。
- [ ] 加载最多 180 秒，候选准备完等待安全停顿最多 120 秒；预热超过 1 秒撤销。超时/失败保留旧模型、设备和转写，不强截长发言，不把候选失败误标为整个采集失败。
- [ ] 加载中结束、暂停、断流、重连或撤销时，候选 Worker/EXE 必须真实退出；迟到 ready、终稿和切换完成不能改变已结束会话。
- [ ] 旧识别器实际释放前拒绝第三套加载。即使当前识别器 close 失败，也先等待正在加载和退休的实例释放再报告错误；不能仅清 UI 就声称 ONNX/EXE 已退出。
- [ ] 成功后更新本场确认配置及设置，失败恢复最后成功选择。问题、手动草稿、既有转写/回答、截图、1800ms 截止点、去重和排队保持。
- [ ] 改播放设备/麦克风仍走原有音频重连；仅改语音模型/推理设备走新交接。系统音源必留，失效设备不悄悄换默认。
- [ ] **回答模型/思考强度保持原逻辑：** 回答中仍可改，当前回答继续原配置快照和输出，下一题/后续排队题使用新配置；资料及知识库保持本场锁定。

参考：`speech-switch.test.ts`、`speech-host.test.ts`、`speech-session.test.ts`、`speech-failures.test.ts`；Mac 的 `speech-switch-smoke.mjs` 是流程参考，Windows 需自己的真实 Worker/EXE、WASAPI/AEC 与句柄验收。

## 5. Qwen 流式、异步对齐及实际裁剪

- [ ] 原版 ForcedAligner 改为独立有界任务：一份在途任务，每音源最多一份待处理快照，两路公平轮换。对齐耗时不阻塞 ASR 临时稿，不无限堆积。
- [ ] 四个句末边界、首句连续两次稳定和安全对齐条件都满足后才固定首句。结果必须匹配当前会话代次、音频窗口及前两句；过期/失败结果只丢弃，不能固定错误文字。
- [ ] 从当前实时音频裁剪，保留对齐期间新增音频和最新尾稿。切点仍为相邻词间安全中点；销毁旧流/token/编码器缓存，不能只截文本而保留整段音频。
- [ ] 无法安全对齐则延后，不按字符比例猜切点；连续发言无固定 30 秒分段。120 秒保护输出 `limit`，不触发回答。暂停、收尾、重置使旧对齐结果失效。
- [ ] Mac Metal 使用原始 BF16 0.6B ASR+MLX 的 500ms 流式块，Mac CPU 使用 Rust 1000ms。Windows 保持 CUDA 总显存≥4GiB 为 500ms、较小 CUDA/CPU 为 1000ms。块长是触发间隔，**不承诺每次出字≤500ms**；以实际最优稳定方案为准，不为追数字破坏正确性。
- [ ] Windows 第零号 CUDA 设备继续要求计算能力≥8.0、驱动 API≥12.9 并初始化成功。不兼容时仍可下载/选 Qwen CPU，隐藏 CUDA；不加载模型或采集设备来做硬件探测。CPU 程序不能依赖 NVIDIA DLL。
- [ ] 新 Rust 源码必须分别在 Windows CPU 和 CUDA 上重建并运行，再验证 shared 的新 Worker/协议。旧 `models-v1.0.0` Windows Runtime 不会因源码移动或 Mac 发布自动更新。

参考：`shared/native/qwen-speech/README.md`、`src/alignment.rs`、`src/engine.rs`、`windows/scripts/build-qwen.ps1`、`windows/test/scripts/qwen-native-smoke.py`、`qwen-worker-smoke.mjs`。

## 6. Q8_0 对齐器：不要把新 GGUF 直接交给旧 Windows EXE

- [ ] ASR 仍为相同原始 BF16 权重。更换的是 ForcedAligner 的磁盘权重表示；GGUF 加载时按原引擎计算精度构建张量，分词、时间戳修正和裁剪算法保持，不能宣传运行内存减半。
- [ ] 新资源已独立追加至现有模型库：`models-v1.0.0/VoxCue-Qwen-Aligner-Q8_0-1.0.0.zip`，946,306,488 字节，ZIP SHA256 `cd71311aa16e2aa69f495a5e9011f73fa96d42772caab527e211a4723cad217d`。原 BF16 资源保留。
- [ ] GGUF 原文件为 985,594,624 字节，SHA256 `539df5dd0fe1721e378ac13bfac9a26b1260dafb62d892c518c1f21244762636`；固定来源 `cstr/qwen3-forced-aligner-0.6b-GGUF@1ec5110602ccab18c878ddebedab0891e290a95c`。配置及分词文件沿用原版，来源/许可证随独立包保留。
- [ ] 解析器只接受预期 GGUF v3 的 F32/F16/Q8_0 和完整 708 张量，校验名称、形状、范围、重叠/重复及量化比例；截断/错误文件明确失败，不能混放 GGUF/safetensors 后随机选择。
- [ ] **当前 Mac 组件为 1.0.1，使用原 ASR+Q8_0；当前 Windows 仍为原 1.0.0 的 BF16+Runtime 组合。** 保留这一兼容隔离，直到 Windows 新 CPU/CUDA 程序、GGUF 加载和实际裁剪通过。
- [ ] Windows 在自有临时组件中用相同固定中英文音频比较 BF16/Q8_0：加载、延迟、完整文本、逐词时间点、安全裁剪、连续双路与内存。相对 BF16 接近后，再准备新的 Windows 运行时归档、固定逐文件摘要和组件版本；不要覆盖旧资产或将未发布的本地 EXE 路径写入生产目录。
- [ ] 资源正式上传与 Windows 发行另按用户授权处理。仅复用 Mac 目录中的清单或修改远程可变下载地址不能算接续完成。

## 7. 模型就绪、删除回退与性能提示

- [ ] 分别测试仅 Paraformer、仅 Qwen、两者都有、两者都无。**任意一个语音模型就绪即满足语音能力**，不能因 Paraformer 被删而提示缺语音模型；知识库模型缺失仍独立提示。
- [ ] 删除当前选中 Qwen，Paraformer 已就绪时立即切为 Paraformer/CPU并保存；删除当前 Paraformer、仅 Qwen 就绪时切为 Qwen/CPU并保存。重开设置、刷新页面和重启均保持，不显示已删除的旧选择。
- [ ] checking、downloading、verifying、removing、全局错误、删除失败或没有替代模型时不误改选择；旧 revision 不覆盖新状态。重新下载原模型不自动抢回选择；音源/设备、回答模型与思考强度保持。
- [ ] 仅在选用已安装 Qwen+CPU 且不存在其他必需组件缺项时显示性能提示，标题必须为 **「语音识别模块性能受限」**，正文为「当前使用 CPU 运行 Qwen，转写更新可能稍有延迟。可在设置中调整推理设备。」；前往设置直达面试设置/推理设备。Paraformer/CPU、Qwen/CUDA 不误报；Mac 对应 Qwen/Metal 不误报。
- [ ] 未安装选项标注未下载并禁用；安装/删除状态及时更新，禁用菜单关闭且鼠标、键盘、迟到事件都不能选中。
- [ ] 开场音源自检优先 Paraformer；只有 Qwen 已就绪时由可信主进程使用 Qwen/CPU，不要求用户补装 Paraformer。Renderer 不能用自检参数指定模型路径或程序。若旧平台仍有其他 dictation 调用，保留同一可信回退；准备聊天语音输入入口不恢复。
- [ ] 实际删除前等待捕获、Worker、原生 EXE 和 ONNX 释放，Windows 用独占句柄证明可释放/删除；保留未知原文件与其他合成资料。不能检查不存在的旧 BF16 路径后声称当前 GGUF 无占用。

参考：`renderer/stores/components.test.ts`、`components-notice.test.tsx`、`components.test.ts`、`speech-session.test.ts`、`components-ui-smoke.mjs`。Mac 删除专项仅供生命周期检查参考。

## 8. 界面与行为的逐项视觉核对

- [ ] 面试浮窗设置按音频、模型、显示纵向分区；成对字段的标签放在完整宽度控件上方，禁止出现「回答模型」「思考强度」逐字竖排。窄屏单列，长设备名不挤压其他字段。
- [ ] 主设置和浮窗的回答生成/语音识别分组一致；语音模型状态实时订阅，浮窗只读组件状态，不能下载、取消或删除模型。检查状态订阅卸载、旧事件和主 frame 授权。
- [ ] 面板浅/深色均不透明、无 backdrop filter，保留阴影及清晰外围；外部第一次点击只关闭并消费，不误触结束/工具栏或其他应用。dialog 打开时原生穿透始终关闭，关闭后恢复透明留白策略。
- [ ] 960/620/440 CSS 像素宽度、100/125/150/175/200% DPI、浅深主题、长模型/设备名、键盘焦点和减少动画均无溢出、遮挡或错误菜单定位。窗口和控件保持既有点击面积。
- [ ] 字号12–24、独立面试透明度0–100、60/30表面曲线、真实预览、即时保存、自动设备刷新及紧凑三状态保持；不恢复已删除的完成/应用/手动刷新按钮。
- [ ] 自动回答旁状态、相邻转写时间、来源故障分类与电平衰减保持；语音模型无“有输入”电平。不因布局调整增加音频采样或模型调用。

参考：`interview-ux-smoke.mjs`、`components-ui-smoke.mjs`、`ui-alignment-smoke.mjs`、`typography-smoke.mjs`、`interview-typography-smoke.mjs`。Mac 测试的合成鼠标注入不能替代 Windows 原生鼠标/DPI 验收。

## 9. 保护既有功能与异常场景

- [ ] 回答模型/effort快照、知识库/资料锁定、手动草稿、问题排队/去重、结束保护、截图最多5张与失败原图重试、记录及用量统计不回退。
- [ ] 重载取消旧 native 请求，已提交的局部回答可恢复，新请求立即可用；忽略取消的迟到结果不能追加旧文字。损坏历史保留原始数据并给出错误，损坏持久字段不能覆盖 store 动作。
- [ ] NaN/Infinity/异常帧、采集失败、过量积压、子进程退出、模型加载失败及结束竞态显式处理，不伪造成功。Mac/Windows错误提示使用通用“切换推理设备”，不在 Mac 强推 CUDA。
- [ ] AEC继续以所选播放设备完整系统混音为参考，双路共同可信时钟、48kHz/10ms、有限参考等待、单路旁路及暂停/结束尾段保护保持；不改用户音量、默认设备或真实资料。
- [ ] Electron 输出继续在临时目录编译/校验/备份，再原地更新受管文件；目录身份、并发锁、过期文件清理和失败回滚保持，不整树移动重建。
- [ ] 本轮只清理了确认失效、无消费者且无占用的旧 Mac 开发宿主副本及 Finder 缓存。不要把 Mac 路径/数字清单用于 Windows 删除；不删现用测试、固定夹具、动态入口、锁/依赖、模型、当前构建、固定签名和恢复/发行基线。

## 10. Windows 执行入口与完成条件

先在 Windows 仓库根核对源码，再执行当前平台入口；依赖已完整时无需重复安装，确需安装只用冻结锁。

```powershell
node shared/scripts/sync-platform-manifests.mjs
cd windows
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
node ../shared/test/scripts/interview-ux-smoke.mjs
node ../shared/test/scripts/components-ui-smoke.mjs
node ../shared/test/scripts/adversarial-smoke.mjs
```

原生 Qwen 使用既有 `windows/scripts/build-qwen.ps1`，需要本机已认证工具链、临时 BuildRoot 和 VAD library；参数 `-ToolchainRoot`、`-BuildRoot`、`-VadLibrary` 均指向实际路径，分别构建默认 CUDA 与 `-Cpu`。不得假设 `pnpm build` 自动替换公开 Qwen Runtime。

在新运行时的隔离组件上分别执行以下入口（变量为自有系统临时目录中的真实路径）：

```powershell
python test/scripts/qwen-native-smoke.py $component --device cpu --wave $fixedWave
python test/scripts/qwen-native-smoke.py $component --device cuda --wave $fixedLongWave --require-crop
node test/scripts/qwen-worker-smoke.mjs $component $fixedLongWave
```

检查 CPU/CUDA 参数前先核对该 Windows 入口当前所需参数和本机能力；不支持 CUDA 的机器不能将跳过写成通过。追加实际 WASAPI/AEC双音源的后台切换、失败/取消、子进程退出及独占句柄检查。稳定性回放采用固定公开或合成音频，至少覆盖长语音、双路、重复开关/切换、有限队列与无遗漏终稿；不得恢复历史取消的十分钟物理语音测试。

逐项向用户报告“通过 / 已修复后通过 / 未执行及原因 / 待同步或待授权”，列出确切命令和平台限制。测试失败先定位是生产问题还是隔离夹具不完整，不能放宽保护、删除断言或更改生产行为来凑通过。Mac 已有回归不替代 Windows 原生、真实账户服务、真人外放质量或真实安装替换验收。

## 11. Mac 0.5.2 发行范围

Mac使用现有固定本地证书和原Ed25519更新密钥；仅向既有公开 `NCFXZ/VoxCue-releases` 的新 `v0.5.2` 追加 `VoxCue-0.5.2-arm64.dmg`、`VoxCue-0.5.2-arm64.zip`、`latest-mac.yml`。保留旧发行、Windows 0.5.1/更早资产、模型资产及既有Latest。两平台按各自完整资产的最高正式版本选版，不依赖统一Latest。

Mac运行时包含签名的MLX/私有CPython和Rust组件，安装包不含模型。用户无需安装Python、Rust或开发工具；Mac自签名身份及既有更新信任根保持，不代表Apple Developer ID或公证。Windows不复制Mac私钥、公钥配置或打包链路。

正式下载页：[Mac v0.5.2](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.5.2)。更多实现细节见[Mac Qwen](QWEN_MACOS.md)、[共用原生实现](../native/qwen-speech/README.md)、[组件](COMPONENTS.md)及[测试入口](../test/README.md)。
