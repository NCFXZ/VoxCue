# VoxCue Qwen 原生识别进程

源码归属：`shared/native/qwen-speech/`保存Windows CUDA/CPU与Mac CPU共用的Rust ASR，以及两平台共用的VAD、异步对齐、实际音频裁剪和端点协议。Mac专用MLX流状态/进程通信在`macos/native/qwen-mlx.rs`，Python实现及依赖锁同在`macos/native/`，装配/签名在`macos/scripts/`；共享`engine.rs`只在macOS条件编译下接入该适配器，Windows不解析或编译MLX模块，也不装配Python/MLX。

ForcedAligner支持原始BF16 safetensors和固定Q8_0 GGUF。Q8_0来源`cstr/qwen3-forced-aligner-0.6b-GGUF@1ec5110602ccab18c878ddebedab0891e290a95c`，SHA256 `539df5dd0fe1721e378ac13bfac9a26b1260dafb62d892c518c1f21244762636`。加载器mmap量化块，按原始名字/行布局映射708张量，在构建原CPU/CUDA张量时一次还原计算精度；减少下载/磁盘体积，计算算法及常驻权重精度保持。两平台组件1.0.1默认Q8_0；Windows使用已发布的独立Runtime 1.0.1，1.0.0 BF16及旧Runtime资源保留。`model.gguf`与safetensors不可混放，格式错误明确失败。共享`examples/aligner-bench.rs`复用生产对齐与安全裁剪，结果仅stdout。

Windows 首次接入。应用沿用原有 WASAPI 双音源和本地 AEC，经过 Node Worker 的流式重采样后，通过内存管道发送 16kHz PCM16。模型文件和原生程序仅由固定摘要的受管组件提供，Renderer 无权指定路径、命令或下载地址。

每路独立维护 Silero VAD、音频窗口、token/编码器状态，共享只读模型权重。出现四个句末边界，且首句连续两次识别一致后，用原版 ForcedAligner 对齐首句；安全边界校验成功才固定首句。切点是首句最后词结束和下一句首词开始的中点。重新分配保留音频并销毁旧流状态，后续推理不再携带已固定音频或旧 token 缓存。对齐失败继续等待，不按字符长度估算音频位置。

提问音源连续静音 500 ms 后收尾。再持续静音 500 ms、终稿就绪且该音源没有积压时，面试可自动发送问题。重新开口会取消旧截止点。新原生进程在 ready 消息中报告 500 ms 的 VAD 阈值。原生阈值为 700 ms、800 ms 或省略阈值的旧组件，由识别 Worker 用经摘要校验的 Silero VAD 在达到 500 ms 静音的首个完整音频帧收尾。若旧组件先报告原生停顿，Worker 按该组件实际阈值计算静音起点。句末标点与 120 秒保护上限仍分别输出 sentence、limit，只有 silence 能启动自动发送。

CUDA 按驱动报告的总显存选择音频块：至少 4GiB 为 500ms，其余 1000ms。CPU 为 1000ms。这是触发间隔，不是出字延迟保证。CUDA 版使用 SM80 PTX，要求 Ampere 或更新的 NVIDIA GPU 与支持 CUDA 12.9 的驱动。对齐器 CUDA 加载失败会沿用 demo 的 CPU 对齐回退，状态模型名称明确标出“对齐 CPU”；ASR 不静默回退。

两个 Windows 可执行文件来自同一源码：默认 CUDA 特性构建 voxcue-qwen.exe；--no-default-features 构建 voxcue-qwen-cpu.exe。CPU 程序不导入 NVIDIA DLL，适用于无 NVIDIA 驱动的设备；通用 CPU 路径需要 AVX2 和 FMA。运行时包含 CPU-only speech.cpp DLL、Silero 权重、CUDA 可分发 DLL 和许可证，用户无需安装 Rust、Python、WSL、Vulkan 或 CUDA Toolkit。

Windows 应用另带 `VoxCue.Cpu.exe`，在 Qwen CPU/CUDA 启动前检查同一 AVX2/FMA 条件；CUDA 对齐可能回退 CPU，因此同样检查。该 helper 使用 baseline x86-64 和静态 CRT 编译，不依赖下载组件，旧组件也受应用端预检保护。检测失败明确拒绝，不转入其他模型；Paraformer 不要求这些指令。共享 native 源码也在 Windows 模型加载前及 CPU backend 入口检查，未重新构建/认证发布的既有 Runtime 资产不包含新增源码保护。

从 `windows/` 执行 `node scripts/restore-rust-toolchain.mjs` 恢复固定 Rust 1.90.0 GNU 公共构建工具，再执行 `node scripts/build-audio.mjs`。恢复脚本只下载 `static.rust-lang.org` 的 rustc、rust-std、rust-mingw 和 cargo，逐件固定官方 SHA-256；工具与认证归档仅放 `windows/.tools/rust-1.90.0-gnu`，不全局安装。此版本满足 vendor 声明的 MSRV 1.75 及当前 Cargo v4 锁格式；它用于独立 helper/纯协议单元，不替代下述完整 CUDA/MSVC 构建链，也不改变应用依赖或模型。`build-audio.mjs` 将源码、共享 CPU 条件和自身构建参数纳入重建判断；打包入口将 helper 与 Audio/Screenshot 一同复制到本平台原生资源。

现有公开认证缓存的长段测量入口为 `windows/` 下 `node test/scripts/qwen-latency-smoke.mjs --seconds=60 --device=cpu`，可选 120 秒及 CUDA；只接受本平台 `.cache/test-components` 和固定公开音频缓存，缺失即失败，不下载模型。测量逐文件验摘要并复制到独立系统临时目录，每十秒向终端输出 ACK/partial 耗时、RTF、最大窗口和裁剪次数，锁屏立即停止，结束清理副本。公开语料触发裁剪/静音时只能证明其实际窗口的表现，不能据此声称覆盖 120 秒无标点且未裁剪的最坏情形。

构建：windows/scripts/build-qwen.ps1 接收便携工具链目录、系统临时 BuildRoot 和 CPU-only VAD import library 目录；加 -Cpu 构建 CPU 程序。Cargo.lock 固定依赖，构建不升级既有应用依赖。speech.cpp 固定 v0.8.10/a72f1bbedd50e293d5b3f4c2bf0fb44ec003227d，ggml 固定 a655cf6910770404213bc338e622cd82b08ca277；CMake 关闭 Vulkan/CUDA/OpenMP/native，使用静态 MSVC CRT，仅构建 speech 目标。

Windows 发行构建使用 [build-qwen.ps1](../../../windows/scripts/build-qwen.ps1)、x64 MSVC、Windows SDK 和 CUDA 12.9 的 `nvcc`。Candle 0.11.1 在 x86 使用安全的 `__cpuid_count` 签名，需要 Rust 1.94 或更新版本；CPU 验证工具链为 Rust 1.100。用新锁执行 `cargo fetch --locked` 准备工具链缓存，再以脚本的 `-Cpu` 和默认 CUDA 两种配置构建、回放公开音频。正式客户端仍按已发布的 Runtime 1.0.1 摘要下载。新构建须作为单独的 Runtime 版本打包、验证并发布后才能交付给已有用户。[Rust 1.94 的函数签名](https://doc.rust-lang.org/1.94.0/core/arch/x86_64/fn.__cpuid_count.html)

上游来源：

- qwen3-asr-rs: https://github.com/alan890104/qwen3-asr-rs @ c5ef09646af6278d2ba8b8ceaf543ffb32d1a5dc，MIT。增加 resume_streaming_audio，允许在裁掉音频后创建新的流状态。ASR 和宿主共同固定 Candle core/nn 0.11.1，Cargo.lock 将 Candle 的 ZIP 读取依赖锁在 9.8.1。构建沿用 `cargo build --locked`，可用 `cargo tree --locked -i zip` 复核版本和唯一引入路径。[上游依赖](https://docs.rs/crate/candle-core/0.11.1) · [解压权限修复](https://rustsec.org/advisories/RUSTSEC-2026-0367.html) · [加密条目校验修复](https://rustsec.org/advisories/RUSTSEC-2026-0545.html)
- qwen-aligner-rs: https://github.com/eclipse005/qwen-aligner-rs @ bb8c73ba670d65b3f5fddc5f5b8791bc07d4392a，README 声明 MIT。仅统一 cudarc 的 CUDA 12.9 特性，保留原版模型与对齐算法。
- nagisa-rs: cd7726e78ede8451c72cc0fabfd55d2c4ed62442，经 Cargo.lock 固定。
- Qwen ASR: 5eb144179a02acc5e5ba31e748d22b0cf3e303b0；ForcedAligner: c7cbfc2048c462b0d63a45797104fc9db3ad62b7，原始 BF16 权重，Apache-2.0。

发布工具 windows/scripts/package-qwen.py 从干净临时 staging 生成 ASR、Aligner、Windows Runtime 三个 ZIP、逐文件清单及 SHA256SUMS。三个资源全部认证后才原子启用一个 Qwen 组件；任何失败/取消均不留下可用的半组件。大文件逐块下载、解压与哈希，不装入单个 Node Buffer。

后续Windows Runtime由`windows/scripts/package-qwen-runtime.py`独立生成新版本ZIP和固定逐文件清单。当前Windows组件1.0.1复用原ASR归档和已有Q8_0归档，再引用Runtime 1.0.1；ASR权重保持原始BF16。`qwen-windows-runtime-catalog.ts`仅保存已发布Runtime的固定摘要，历史`qwen-catalog.ts`的1.0.0记录保持。


Mac接入使用同一源码的`--no-default-features --features metal`，原始BF16 ASR选择Metal/CPU，原版ForcedAligner为CPU。Metal ASR使用固定MLX、500ms块及随应用的隔离CPython；CPU保留Rust、1000ms块。MLX/Rust的ASR读取相同原始BF16；Mac对齐器默认Q8_0，加载后沿用原计算精度。对齐器补齐ARM NEON dot/axpy/卷积及原分块注意力的架构分支，保持模型、布局、FMA归约顺序与对齐算法。Mac构建和平台装配见../../docs/QWEN_MACOS.md；运行时随应用原生资源固定签名，复用原ASR归档及独立Q8_0 Aligner归档，不下载Windows运行时。静音阈值和四句裁剪规则由共享原生源码提供。EOF监视在线程中先于模型加载建立，父进程断管立即退出；MLX子进程同样监视拥有者管道并由Rust等待真实退出。

原版对齐在独立线程执行，一份在途任务加每音源一份待处理快照，双路公平轮换。结果必须匹配当前代次、窗口与前两句才固定首句；从实时音频裁剪并重建流状态，不丢弃对齐期间的新音频。失败/过期只丢弃结果，收尾/重置使旧结果失效。Mac专用CPU池降低优先级并限制线程，ASR不等待对齐。Windows专属运行时需其本机重新构建验证。
