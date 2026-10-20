# Mac Qwen 流式识别

Mac 0.5.2沿用Windows相同Qwen3-ASR 0.6B原始BF16权重，ASR可选Metal或CPU；ForcedAligner默认使用Q8_0磁盘权重和原Rust CPU计算。Paraformer继续固定CPU。这是用户在0.5.1交接基础上追加的原生接入，Windows交接中“Mac尚未接入”的描述属于此前状态。Windows本轮逐项接续见[0.5.2核对清单](WINDOWS_0.5.2_HANDOFF.md)。

## 流式和平台边界

Windows CUDA/CPU和Mac CPU的Rust ASR实现位于`shared/native/qwen-speech/`，VAD、异步对齐和端点协议共用。Mac MLX的Rust进程适配与流状态在`macos/native/qwen-mlx.rs`，Python实现及依赖锁也在`macos/native/`；共享引擎只保留macOS条件编译下的接口转发，Windows不解析或编译该适配器。Mac构建摘要同时覆盖适配器和Python实现，修改任一文件都使旧缓存失效。

Mac Metal由签名原生程序`metal-check`确认，不加载权重、不实例化采集或申请权限。Metal ASR使用MLX和500ms流式块，CPU保留Rust和1000ms块；这是推理积累间隔，不是每帧延迟保证。两种ASR后端读取相同原始BF16权重。MLX复用已完成且不会被后续音频改变的编码器窗口及其解码器KV前缀，活动窗口仍重算；mel归一化/窗口改变时由固定上游实现失效缓存，裁剪时销毁全部旧状态。原版CPU对齐在独立任务及低优先级专用线程池执行，线程数为可信性能核心数的一半、限制1–3；ASR CPU原池上限6，探测失败用4，Renderer不能指定。初次Metal加载失败明确停止，面试中候选加载失败保留原识别器，均不静默切CPU；CUDA只在Windows使用，不映射成Metal。状态显示ASR设备和“对齐 CPU”。选择语音模型不改变回答模型/effort，当前回答仍持有原快照。

面试中的语音模型、Metal/CPU切换共用后台加载与停顿交接。捕获/AEC连续，旧识别器继续转写；候选独立Worker准备完成后，等两路旧VAD空闲，用最多300ms内存PCM补齐边界，再交接唯一出稿权。加载上限180秒，安全停顿等待上限120秒，超时或失败保留旧配置；不会强行截断发言。切换期间两套权重短暂重叠，需额外内存，加载会竞争计算资源；不承诺识别延迟完全不变。暂停/结束/断流撤销候选，旧识别器退休后退出Worker/原生进程。问题、草稿、1800ms静音截止点保持，切换播放设备/麦克风仍走原有重连。初次启动与麦克风自检保持原流程。

复用共享捕获、完整系统混音AEC参考、重采样、Worker、内存PCM16管道和Rust协议。麦克风与系统音频保持独立VAD/流状态；四个句末边界、第一句连续两次相同及原版对齐安全条件同时满足才固定第一句。取相邻词间安全中点，重新分配保留音频，销毁旧流/编码器/token缓存后恢复余下流。失败继续等候，不按字符比例裁剪；120秒保护为limit，不触发自动回答。两模型均800ms静音收尾，自动回答从最后一次系统语音结束起按音频时间轴累计1800ms，800ms计入其中；终稿后的固定1000ms计时器已删除。silenceStartMs由VAD端点音频位置减固定800ms尾静音得到，不使用终稿到达时间；存在VAD帧粒度。Worker只确认已处理帧，控制器audio-progress同时携带每路积压标记。系统silence终稿就绪、静音累计达标且后续系统音频已检查才提交；晚终稿不再额外等候，采集停顿不能靠墙钟触发。重新开口撤销旧截止点，麦克风不重置系统问题，忙时排队、去重和结束保护保持；sentence/limit/stop/pause/discontinuity不触发。

原版对齐器的x86 SIMD入口补充了ARM NEON等价内核，八路FMA及归约顺序、卷积布局、分块注意力和softmax保持。Q8_0仅改变磁盘权重表示，加载时逐张量还原为原引擎计算精度，分词、时间戳修正与安全裁剪算法保持；运行内存不按磁盘压缩比例下降。仍支持原始BF16用于对照。Candle保持0.9.2，既有锁定版本不升级。

对齐队列只有一个在途任务，每个音源最多保留一份待处理快照；两路轮换，失败不阻塞ASR。结果只有在会话代次、窗口起点、快照范围、首句及前两句内容仍相符时才应用。裁剪当前实时音频，保留对齐期间收到的音频及新的尾稿；暂停/收尾/重置后旧结果失效。对齐完成不会额外等待或改变1800ms自动回答规则。

MLX裁剪后仅将已校验实时窗口中的保留尾稿重新分词，用同一语言标记和末五token的UTF-8安全回退重建文本前缀，避免重新逐token生成整段尾稿。旧token ID、编码器输出及KV张量全部释放，新窗口按新音频位置重新预填；跨VAD新段仍保留原两次冷启动，不把前段文字带入新语音。开发基准可加`--cold-crop`对照完全冷启动，`--long-speech --realtime-seconds=70`复用同一合成PCM同时覆盖双路对齐、实时音频保留和完整文本WER；结果不落盘。

## 组件与构建

后台切换同时最多准备两套识别器；旧实例实际退出前拒绝第三份加载。候选交接预热超过1秒即撤销，避免卡住原识别队列；这是故障上限，不是固定等待，不追加自动回答的1800ms截止时间。暂停时若取消与交接通知交错，排空后退休Worker，下次恢复按最后确认配置重新加载，避免实际模型与选择不一致。

Mac可选Qwen组件版本为1.0.1，共用`qwen-catalog.ts`中的原始ASR归档，配合`qwen-int8-catalog.ts`中的新Q8_0 Aligner归档；两份及逐文件摘要全部认证后原子启用，缓存身份独立。Windows继续原1.0.0 BF16/Runtime组合，避免向旧EXE提供不支持的GGUF；共享Rust源码已有加载支持，其本机重建验收后再接续。原BF16公开资产保留，不覆盖旧资源。

Q8_0固定来源为`cstr/qwen3-forced-aligner-0.6b-GGUF@1ec5110602ccab18c878ddebedab0891e290a95c`，文件SHA256为`539df5dd0fe1721e378ac13bfac9a26b1260dafb62d892c518c1f21244762636`；原始GGUF字节不变，配置/分词文件沿用原版。新资源为`models-v1.0.0/VoxCue-Qwen-Aligner-Q8_0-1.0.0.zip`，含Apache-2.0许可证和来源说明。共享加载器只接受对应GGUF v3的F32/F16/Q8_0及完整708张量，校验名称、形状、范围、重复与重叠，拒绝混放GGUF/safetensors。发布工具为`shared/scripts/package-qwen-aligner.py`，只创建独立资源及清单，不覆盖旧资产。

Mac运行时随应用原生资源提供，开发路径为`macos/native/bin/qwen/`，应用路径为`Contents/Resources/native/qwen/`。打包仅复制该平台构建，固定本地证书签名所有Mach-O，保留第三方许可证及来源。无需用户安装Python、Rust或CUDA。运行时无模型、账户或音频数据。

Metal子进程使用固定CPython3.12.14、MLX0.30.6及`mlx-qwen3-asr`提交`41878a11cf338c59e13edc84bf4cb35f4b0f3ff6`，完整轮子/来源摘要在`macos/native/qwen-mlx.lock.json`。开发装配直接验证并展开固定资产，不使用全局pip。子进程使用隔离模式、禁写字节缓存、清空继承环境且禁用网络连接；只接受Rust的内存PCM协议，不负责VAD、对齐或自动回答。父进程关闭管道时立即退出，正常释放时父进程kill/wait；两路共用模型且各有独立流状态。开发运行时包含这套私有依赖，因此比原纯Rust运行时更大。

`pnpm build:qwen`先校验源码/固定身份摘要、全部输出摘要及签名；当前有效构建可直接复用。缺失或过期时需开发者显式提供`VOXCUE_CARGO`、`VOXCUE_CMAKE`、`VOXCUE_SPEECH_CPP`及开发用`VOXCUE_PYTHON`（3.12+）。speech.cpp固定`a72f1bbedd50e293d5b3f4c2bf0fb44ec003227d`，ggml固定`a655cf6910770404213bc338e622cd82b08ca277`；Silero与Windows运行时逐字节同摘要。仅系统临时目录编译，固定CMake/Rust部署目标为macOS 14.2，校验每个Mach-O不提高应用最低系统版本，清理临时动态库搜索路径后签名部署。macOS27构建只为编译时过程宏保留调试信息，避免链接器的LINKEDIT对齐问题，不改变最终推理优化。当前本机验证不代替较旧macOS实机验收。受管文件原地写入以保留身份；File Provider保留的编号旧副本不被加载或装入应用，临时应用严格按已认证文件清单复制。现有构建命令不生成正式DMG或更新ZIP。

## 隔离验证入口

从`macos/`执行类型/noUnused、workspace、architecture、完整单测与构建。共享functional-suite须显式选择33组，避免默认dmg。组件UI专项同时覆盖Metal/CPU、未安装禁用、硬件失效、警告和dialog边界；浮窗测试检查真实置顶并主动触发同步重入。

- `node test/scripts/qwen-native-smoke.mjs <系统临时目录中已认证的Qwen组件>`：原BF16 ASR、Q8_0或BF16对齐器、合成TTS、Metal/CPU、四句裁音频、静音、双路隔离、EOF真实退出。
- `python test/scripts/qwen-aligner-compare.py <自有临时比较目录>`：同一Rust进程实现、同一固定FLEURS中英文各20条，交替比较BF16/Q8_0加载与延迟、逐词起止时间点和真实安全裁剪；另加两种语速合成TTS。原生`--example aligner-bench`只经stdin/stdout返回结果。数值只到终端/对话；该比较是相对原版的一致性，不是人工时间戳金标验收。
- `VOXCUE_PYTHON=<开发Python3.12+绝对路径> node test/scripts/qwen-comparison-workspace.mjs --prepare`：保有隔离的原始模型及固定Rust/MLX工具，打印fixture路径；同一终端输入`quit`释放。用其venv执行`qwen-comparison-corpus.py <fixture>`准备固定FLEURS中英文各20条输入，再执行`qwen-compare.py <fixture> --backend=rust|mlx|native`；native为接入后的生产协议，另加`--realtime-seconds=30`按20ms节奏输入双路公开音频。两引擎均BF16、500ms、相同Silero与800ms/解码预算；预热后输出延迟分位数、积压、英文WER和中文CER。归一化大小写、Unicode和标点，数字写法差异仍计错；仅小型公开朗读样本，不能外推面试噪声准确率。参数`--asr=rust --chunk-ms=500`仅供可信开发基准，不开放Renderer选项。结果不写文件。
- `node test/scripts/qwen-worker-smoke.mjs <系统临时目录中已认证的Qwen组件>`：生产utilityProcess/controller/Worker/AEC与44.1kHz重采样的合成捕获链路及真实退出。
- `node test/scripts/speech-switch-smoke.mjs --download`：固定公开模型下载/生产摘要认证，生产双路合成捕获/AEC/识别Worker的Paraformer→Qwen与Metal/CPU双向切换、候选失败保留及加载期间取消；全部模型和资料仅自有系统临时目录、退出清理。
- `node test/scripts/qwen-removal-smoke.mjs <已认证临时模型状态JSON>`：要求系统临时目录和存活所有者标记，检查原生进程/模型文件释放后由生产ComponentService移除Qwen，保留无关合成资料。状态JSON包含`testRoot`、其下`root: models目录`和`component: qwenModels路径`。
- `node test/scripts/audio-synthetic-smoke.mjs`：Mac采集适配器和合成子进程的分片、非有限样本拒绝、尾包排空及20轮退出，不打开物理设备。
- `node test/scripts/echo-cancellation-smoke.mjs --runtime-bundle`：真实Worker/AEC WASM与ASAR依赖布局，无物理采集。

原`audio-native-smoke.mjs`会采集真实设备，本轮不执行。所有验证仅使用自有临时目录、合成账户/资料/音频，退出清理，结果仅终端/对话。短期验证不代表真人外放质量或长期耐久验收。
