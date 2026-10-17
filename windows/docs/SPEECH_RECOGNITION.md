# VoxCue 本地实时语音实施与验收

> 2026-10-17 测试保留规则已更新：全部既有测试产物按用户授权清理；下文旧 test/results/test-results 路径仅为历史运行记录，不作为当前可用交付物。当前验证见根 PROGRESS.md。

## 最新交互更新（2026-10-13 10:30）

按用户截图反馈，配置已移至开始面试确认弹窗，确认后不可改并自动开始，无需再点击开始采集。浮窗的配置面板和底部三个采集元素已移除；结束面试等待尾段、释放设备。重载先保存中断记录、释放旧进程，再按本场锁定配置自动开始。系统音频固定面试官、左侧气泡；麦克风固定面试者、右侧气泡，不再存在问题来源选择，麦克风文字不会提交给 AI。

弹窗现按模式/设备/回答分组对齐，模型下补“思考强度”，支持时默认低、能力未知使用自动，主进程校验支持档位并锁定本场配置，实际回答请求传入 effort；自动省略字段。准备聊天语音输入不再显示额外正常状态说明，加载/停止用旋转图标、识别中用停止图标。最新 133 单测、type/build/architecture 和隔离 `test:interview:effort` 验证通过；测试 UI/IPC 的参数传递，未调用生产 AI 或采集真实音频。

准备聊天的麦克风按钮使用真实本地 ASR/VAD，点击开始、再次点击停止，仅回填现有草稿、不发送。临时结果替换、终稿去重和停止尾段均处理；输入中禁止手动修改/发送以免覆盖，停止后可编辑。SpeechCoordinator 串行维护语音输入和面试的归属，开始面试会先结束语音输入；主窗口不能抢占面试或以该接口抓取系统音频。加载期间取消会终止待启动服务，避免用户停止后晚到开始录音。

本次 22 文件130单测、typecheck/architecture/build、真实 Electron floating/electron/composer/speech:desktop 通过。桌面测试实测 WASAPI 麦克风启停与系统回环生成音频→真实模型→UI；草稿文字回填、终稿重复/迟到处理和右侧麦克风气泡用受控识别事件验证，不是现场真人麦克风准确率评测。原有模型/VAD、质量、许可、耐久与便携证据保留；下文初次实施的119项和文件归属属于先前快照，不能据此覆盖本次变更。

## 授权、基线与恢复

不修改真实用户数据库、OAuth、凭据存储或窗口保护。音频不持久化、不远程发送；转写正文不进入后台日志。面试记录沿用本机原存储键，新增来源与实际回答服务身份，旧Mock记录可读。正常结束等待尾段后保存；强制重载/关闭先同步保存已收到的文字为 interrupted，再释放设备，尚未到达 Renderer 的尾段不能保证在强制退出时保存。

## 固定依赖、模型和许可

| 项目                 | 实际选择                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Electron / 内嵌 Node | 38.8.6 / 22.22.0，Windows x64                                                                                         |
| sherpa 官方 N-API    | sherpa-onnx-node / sherpa-onnx-win-x64 **1.13.8**，Apache-2.0，锁文件固定                                             |
| ASR                  | streaming-paraformer-bilingual-zh-en INT8，官方维护者 revision `8e40c43232a1c5c66c82111efc5820d3accca11b`，Apache-2.0 |
| Encoder              | 165462184 bytes，SHA256 `81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a`                            |
| Decoder              | 71664561 bytes，SHA256 `f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f`                             |
| Silero VAD           | 官方 sherpa 发布资产 **271935959 / 2025-07-11**，silero_vad.onnx，643854 bytes，MIT                                   |
| VAD checksum         | `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6`                                                    |

没有将发布资产日期冒充 Silero 语义版本号。模型文件合计约227 MiB，公共源及逐文件校验保存在 `local-models/speech/manifest.json`；启动时重新校验。Encoder/Decoder 的 hash 对照固定 HF LFS OID，VAD 对照官方 GitHub digest；tokens/README 记录本次 hash。下载和模型加载失败可见，不自动联网取备用模型。权重、DLL、生成音频和测试profile均在Git忽略目录，许可副本随模型保留。

官方依据：[Node 示例](https://github.com/k2-fsa/sherpa-onnx/tree/master/nodejs-addon-examples)、[Paraformer 模型](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-paraformer/paraformer-models.html)、[固定模型仓库](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/tree/8e40c43232a1c5c66c82111efc5820d3accca11b)、[Silero MIT](https://github.com/snakers4/silero-vad/blob/master/LICENSE)、[WASAPI loopback](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)、[Microsoft SDK 接口](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/mmdeviceapi.h)。

## 数据流与文件职责

- `native/WasapiCapture.cs`：.NET Framework x64 COM/PInvoke，直接 `IAudioClient` shared-mode；microphone使用eCapture，system使用eRender + AUDCLNT_STREAMFLAGS_LOOPBACK。每路独立进程、设备、混音格式、QPC和退出监视；不依赖虚拟声卡、不按应用进程抓音频。读取默认/指定设备，1秒检查断连或默认设备变化，出错停止并要求重新选择/启动，不擅自修改系统默认设备。
- `capture.ts / buffer.ts`：限长二进制协议、半包/粘包、float样本、速率/时间戳/flags、异常和stdin EOF释放。原生侧下混单声道并转换PCM16/24/32或float32；拒绝未知格式。Node侧不阻塞原生采集等待推理。
- `controller.ts / host.ts / process.ts`：独立utilityProcess，串行启停、模型复用、Worker与原生进程清理、两秒队列上限。超限或WASAPI不连续显式停止，不静默丢样；记录拒绝样本数和不连续次数。首包初始化标记不代表已丢失先前音频。真实采集QPC锚定墙钟，后续段时间按样本累积；不是模型词级时间戳。播放空闲时补定时零样本，供VAD收尾。
- `engine.ts`：官方流式重采样到16k mono float32，512点帧；一个共享只读Paraformer识别器、两条独立stream与Silero实例；ASR2线程、VAD1线程。VAD阈值0.5，最短语音250ms，最短静音700ms，最长语音20s。ASR接收全部音频，保留起始前音频及尾部；不靠VAD硬切掉前250ms。终稿追加400ms模型尾部padding，刷新stream，20s强制分段。10s静音定期重建stream限制特征状态；VAD队列及时清空。
- `speech.ts` contracts / preload：面试采集允许devices/status/start/pause/stop及公开事件，开始时校验本场锁定的来源和设备；主窗口仅能枚举设备，不能调用面试采集。新增dictation接口只允许主窗口主frame、固定默认麦克风，不允许文件路径、任意IPC或凭据；登录窗口不能启动语音。
- `interview.ts` / `SpeechControls.tsx` / `FloatingInterview.tsx`：开始确认弹窗选择本地/Mock、设备、回答方式与自动提交；进入后锁定且自动转写，面试官/面试者左右显示，可复制终稿整理，结束仍二次确认。开启ChatGPT回答会说明发送问题文字，账户模型来自既有目录，参考默认关闭；失败不回退Mock。每条回答保存实际provider。`dictation.ts` store / VoiceInputButton 管理准备聊天语音输入的启停和草稿回填。
- history兼容：mock字段扩大为boolean，保留原键；记录页监听其他窗口的storage/focus，避免异步尾段保存后列表漏刷新。

## 自动化证据

原始报告/日志全部位于 `test-results/speech-*`，不是仅看命令退出码。

| 范围         | 本机结果及限制                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单元与类型   | 20文件119项；环形缓存、协议、白名单、interim替换/终稿冻结、双源聚合/长文本限制、短停顿/暂停取消、AI旧请求/事件取消、旧新记录兼容；typecheck/build/architecture通过               |
| 模型与Silero | 7条先写参考后生成的中英文SAPI音频、4条官方诊断、8种派生条件，共19例；真实模型输出，无模型Mock；官方4条无独立gold，不计准确率                                                     |
| 采样/环境    | 44.1k、48k经真实sherpa重采样；低音量0.03倍、固定噪声、250ms/1200ms插入停顿；纯静音和纯噪声本轮均无终稿；不能代表所有噪声                                                         |
| 真实设备     | Realtek麦克风阵列和扬声器；每路约2s/98k样本，48k PCM；实际loopback低幅值合成WAV→真实识别终稿，双路来源独立、暂停/恢复/停止通过。麦克风收到了真实音频，不将环境人声作为gold或保存 |
| 原生UI       | 源码构建与便携exe均通过：未授权主窗口拒绝、真实loopback→UI、默认不自动回答、手动提交、明确Mock回答、重载释放/同步中断快照、正常结束；浅色截图检查后修复透明控制栏可读性          |
| 故障         | 在隔离目录损坏模型拒绝加载；推理Worker退出/采集进程退出均释放设备并显示错误；无Mock备用路径                                                                                      |

中途失败已处理：COM设备集合IID修正；PowerShell5.1 UTF8/旧System.Speech枚举改为ASCII脚本读取UTF8 fixture+只读已安装SAPI tokens；Electron readWave外部缓冲改官方false复制接口；WMP未播放改为低幅值SoundPlayer；首包标记/Unicode设备名；asar内原生助手路径与Worker解包；强制重载记录同步保存与主窗口记录storage刷新。普通沙箱临时rename/本机HTTP测试限制在授权本机隔离环境复验，没有改OAuth/用量逻辑或放宽渲染器沙箱。

## 准确率与术语

本机小合成集，标点/大小写按脚本规范化；CER按字符、英文WER按空格词、混合MER按汉字和英文/数字token。技术符号和数字还需人工复核，不能把格式规范化当识别正确。

| 固定case     | 结果                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| 中文项目句   | CER 0%                                                                        |
| 普通英文句   | WER 11.11%：and→in                                                            |
| Why this job | WER 0%                                                                        |
| 技术英文     | WER45%：ROS two→our os too、C→sea、字母分组变化；PID/STM32需人工重整          |
| 数字句       | WER12.5%：hertz→hurts；48k/250的数词本轮保留                                  |
| 中英混合     | MER24%，CER14.29%：ROS2→ios二、C++→c加加、STM32→stm三二                       |
| 63秒长句     | WER19.53%，5个终稿；强制分段附近及重复长句存在漏字/错字                       |
| 派生条件     | 44.1k/48k/低音量WER11.11%；固定噪声、短/长停顿WER22.22%；短停顿1段、长停顿2段 |

需要本人朗读不同语速/口音及技术词、复核C++、ROS2、STM32、PID、Transformer、数字与单位。尚未比较替代模型/hotwords，也没有给术语强制纠错，以免把真实型号或事实改错。质量尚不足以承诺无人审核自动回答，保留默认手动与终稿整理。

## 实测性能与并发

Ryzen9 8945HS / 16逻辑CPU / 31.29GiB Windows，CPU推理。

- 19例模型批次冷加载约1.19秒，进程批次结束RSS约410.5MiB；此前批次1.15–1.36秒。只是语音加载，不是整应用冷启动。
- 受控实际loopback：播放请求到第一条interim **1062ms**；到终稿5832ms；扣除4.53s音频文件时长后 **1302ms**。包括播放器启动、设备、队列和本地识别，单次测量；不是稳定p95，也不是人工标注的最后发音时刻。
- 本轮受控loopback终稿尾词有截短（testing→te），此前一次完整识别该词；链路测试只验证真实输出/来源/生命周期，不证明文字完全正确。原始输出保留，需本人用不同输出设备/音量复核尾词及设备音频处理影响。
- 十分钟paced双路真实ASR+VAD：墙钟600218ms、双源音频合计1200000ms、推理121109ms（RTF≈0.101）；177终稿、1548interim；最大队列256ms、0错误/0丢样；RSS346.47–359.28MiB，末358.88MiB；CPU62.81%单逻辑核等价，约全16线程3.93%；Worker关闭后threadId=-1。使用生成PCM，**不是十分钟真人硬件对话**，不证明长期无泄漏。

## 启动、复验、未完成事项

```powershell
Set-Location 'C:\Users\fengk\OneDrive\Study\UoM\PhD\GitRepo\VoxCue'
pnpm install --frozen-lockfile
pnpm download:speech
pnpm build
# Windows双击 Start-VoxCue.cmd；在开始面试弹窗选择设置并确认，浮窗自动转写
# 开发测试音频用 PowerShell 7 执行；只读已安装中文/英文语音，不改注册表
./scripts/create-speech-fixtures.ps1
pnpm test:speech:model
pnpm test:speech:devices
pnpm test:speech:desktop
pnpm test:speech:reliability
pnpm test:speech:soak
pnpm test:speech:package
pnpm test
pnpm typecheck
pnpm check:architecture
```

设备测试会短暂采集并低幅值播放合成语句，不保存环境音频/转写；运行前确保参与者同意。依赖锁文件固定Windows官方包，Mac未实现。build使用Windows自带.NET Framework64 csc，无需全局Visual Studio安装；缺失时明确报错，需另做新机依赖验收。

下一天优先：先备份现有资料，再由本人确认隐私许可、选真实设备、分别/同时朗读中英技术问题；检查短停顿、长句边界、最终文字与单位；整理面试官终稿后提交。主动登录ChatGPT后测试真实回答/取消/本机用量，参考默认关闭，若开启须核对来源。物理拔插、默认设备切换、拒绝麦克风权限、蓝牙/耳机、回声、会议软件播放源、新电脑/安装器、十分钟真人多轮还未实测；当前采用显式停止/重新选择设备，不做自动热切换。强制退出期间未抵达UI的尾部、20s边界准确率、动态格式变化、稀有PCM格式及更长耐久仍是限制。不能将这些项目标记通过。
