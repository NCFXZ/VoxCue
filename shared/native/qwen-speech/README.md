# VoxCue Qwen 原生识别进程

Windows 首次接入。应用沿用原有 WASAPI 双音源和本地 AEC，经过 Node Worker 的流式重采样后，通过内存管道发送 16kHz PCM16。模型文件和原生程序仅由固定摘要的受管组件提供，Renderer 无权指定路径、命令或下载地址。

每路独立维护 Silero VAD、音频窗口、token/编码器状态，共享只读模型权重。出现四个句末边界，且首句连续两次识别一致后，用原版 ForcedAligner 对齐首句；安全边界校验成功才固定首句。切点是首句最后词结束和下一句首词开始的中点。重新分配保留音频并销毁旧流状态，后续推理不再携带已固定音频或旧 token 缓存。对齐失败继续等待，不按字符长度估算音频位置。

VAD 静音 800ms 收尾剩余三句和尾部草稿。句末标点提交不触发自动回答；静音终稿后再检测 1000ms。连续说话没有固定 30 秒分段；120 秒未成功收尾/裁剪的保护上限仍会输出 limit，limit 不触发自动回答。

CUDA 按驱动报告的总显存选择音频块：至少 4GiB 为 500ms，其余 1000ms。CPU 为 1000ms。这是触发间隔，不是出字延迟保证。CUDA 版使用 SM80 PTX，要求 Ampere 或更新的 NVIDIA GPU 与支持 CUDA 12.9 的驱动。对齐器 CUDA 加载失败会沿用 demo 的 CPU 对齐回退，状态模型名称明确标出“对齐 CPU”；ASR 不静默回退。

两个 Windows 可执行文件来自同一源码：默认 CUDA 特性构建 voxcue-qwen.exe；--no-default-features 构建 voxcue-qwen-cpu.exe。CPU 程序不导入 NVIDIA DLL，适用于无 NVIDIA 驱动的设备；通用 CPU 路径需要 AVX2。运行时包含 CPU-only speech.cpp DLL、Silero 权重、CUDA 可分发 DLL 和许可证，用户无需安装 Rust、Python、WSL、Vulkan 或 CUDA Toolkit。

构建：windows/scripts/build-qwen.ps1 接收便携工具链目录、系统临时 BuildRoot 和 CPU-only VAD import library 目录；加 -Cpu 构建 CPU 程序。Cargo.lock 固定依赖，构建不升级既有应用依赖。speech.cpp 固定 v0.8.10/a72f1bbedd50e293d5b3f4c2bf0fb44ec003227d，ggml 固定 a655cf6910770404213bc338e622cd82b08ca277；CMake 关闭 Vulkan/CUDA/OpenMP/native，使用静态 MSVC CRT，仅构建 speech 目标。

上游来源：

- qwen3-asr-rs: https://github.com/alan890104/qwen3-asr-rs @ c5ef09646af6278d2ba8b8ceaf543ffb32d1a5dc，MIT。仅增加 resume_streaming_audio，允许在裁掉音频后创建新的流状态。
- qwen-aligner-rs: https://github.com/eclipse005/qwen-aligner-rs @ bb8c73ba670d65b3f5fddc5f5b8791bc07d4392a，README 声明 MIT。仅统一 cudarc 的 CUDA 12.9 特性，保留原版模型与对齐算法。
- nagisa-rs: cd7726e78ede8451c72cc0fabfd55d2c4ed62442，经 Cargo.lock 固定。
- Qwen ASR: 5eb144179a02acc5e5ba31e748d22b0cf3e303b0；ForcedAligner: c7cbfc2048c462b0d63a45797104fc9db3ad62b7，原始 BF16 权重，Apache-2.0。

发布工具 windows/scripts/package-qwen.py 从干净临时 staging 生成 ASR、Aligner、Windows Runtime 三个 ZIP、逐文件清单及 SHA256SUMS。三个资源全部认证后才原子启用一个 Qwen 组件；任何失败/取消均不留下可用的半组件。大文件逐块下载、解压与哈希，不装入单个 Node Buffer。
