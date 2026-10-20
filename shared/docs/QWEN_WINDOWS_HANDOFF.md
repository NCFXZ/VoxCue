# Qwen Windows 接入与 Mac 接续

> 当前接续请使用 [Windows 0.5.1 → 当前0.5.3完整修改与逐项核对报告](WINDOWS_0.5.3_HANDOFF.md)。该文档累计覆盖后台模型/设备交接、800ms/1800ms音频时钟、模型删除回退、Q8_0兼容及之后的全部界面调整；下文保留Windows 0.5.1首次接入历史说明，冲突时以新报告为准。

2026-10-20共享规则更新：Paraformer/Qwen保留800ms分段，自动回答按最后一次系统语音结束后的已处理音频累计1800ms；取消终稿后额外1000ms，只有终稿就绪且后续系统音频无积压才提交。重新开口、去重、排队及结束保护保持。下述旧等待规则及Mac接续限制为Windows交接时的历史状态，当前Mac接入见[QWEN_MACOS.md](QWEN_MACOS.md)；Windows仍需本机回归。

Windows 生产链路复用 shared 页面/业务、WASAPI、AEC、设备选择、会话锁定和恢复入口。可选 Paraformer/Qwen3-ASR 0.6B；Paraformer 固定 CPU，Qwen 可选 CPU/CUDA，兼容设备默认 CUDA，CPU 有性能警告。不满足 CUDA 兼容条件时仍可下载和选择 Qwen，只隐藏 CUDA 并改用 CPU，不强制更换语音模型，也不显示额外的不兼容提示。“常规”显示名改为“个性化”。准备聊天不再提供语音输入；开场音源自检仍走原 Paraformer，面试语音模型不改变回答模型及当前回答快照。

模型设置按“回答生成”（回答模型、思考强度）在上、“语音识别”（语音模型、推理设备）在下分组，主设置与浮窗复用。组件页按“本地语音模型”（Paraformer、Qwen）及“知识库模型”（multilingual-e5-small）分组，模型名称使用常规字重并提供简短用途说明。

未安装的语音模型在下拉选项标注“未下载”并禁用，安装完成后随组件状态即时恢复；不显示额外的下载提示或 CUDA 兼容成功提示。推理设备只有 CPU 可用时禁用展开。共用下拉菜单将禁用状态同步到菜单触发器及选项，进入禁用状态关闭已打开菜单，鼠标/键盘和迟到事件均不能选择禁用项。

CUDA 选项只在原生助手 `cuda-check` 确认当前 Rust 运行时使用的第零号 CUDA 设备计算能力至少 8.0、驱动 API 至少 12.9 且驱动初始化成功后展示。检测直接读取系统 NVIDIA 驱动，不创建音频对象、不加载模型或要求用户安装 CUDA Toolkit。旧显卡、驱动缺失/过旧与检测失败均隐藏 CUDA；Qwen CPU 原生程序不依赖 NVIDIA DLL，下载和 CPU 启动不检查 CUDA。打开面试及重连仅在实际选择 Qwen CUDA 时重新校验，防止旧配置绕过。修复驱动后重新打开设置刷新检测。

原生进程来源、构建及裁剪规则见 shared/native/qwen-speech/README.md。四个句末边界、首句两次稳定和对齐安全校验全部满足时，固定首句并删除对应音频/旧缓存，保留后三句。不能安全对齐时延后，不猜测切点。Paraformer 与 Qwen 均在静音 800ms 后完成尾段，收到终稿后再等 1000ms。仅系统音频的 silence 终稿触发自动回答；sentence/limit/stop/pause/discontinuity 不触发。恢复说话取消待提交检测，去重、忙时排队、结束和迟到保护保持。

CUDA 总显存至少 4GiB 为 500ms 音频块；不足 4GiB 及 CPU 为 1000ms。实际设备/间隔由原生程序报告，Renderer 无权指定硬件、块长、程序路径或下载地址。CUDA 使用 SM80 PTX，要求 Ampere 或更新架构与支持 CUDA 12.9 的驱动；ASR CUDA 不可用时明确失败。对齐器 CUDA 加载失败时保留 demo 原有 CPU 回退，并在模型状态标明。

组件页显示一个 Windows Qwen 组件，依次下载 ASR、Aligner、Windows Runtime 三个资源，所有摘要通过才原子启用。运行时包含 CPU/CUDA 两个原生程序；CPU 程序不导入 NVIDIA DLL。固定下载源为 NCFXZ/VoxCue-releases/models-v1.0.0，文件摘要由 qwen-catalog.ts 固定。公开清单不作为远程可变信任根。旧 Paraformer/RAG 包和缓存兼容。

验证入口：

- 从 windows/ 执行现有 typecheck、build:shared、test。
- windows/scripts/build-qwen.ps1 固定 Cargo.lock 构建；-Cpu 生成独立 CPU 程序。构建产物只放系统临时目录。
- windows/scripts/package-qwen.py 从干净 staging 生成资源、清单和摘要；--reuse-models 只复用摘要匹配的模型 ZIP。
- windows/test/scripts/qwen-native-smoke.py 回放固定官方短 WAV 或 --wave 指定的固定合成 WAV，--require-crop 校验实际裁剪。CPU 模式检查加载、块长、静音和退出。
- windows/test/scripts/qwen-worker-smoke.mjs 通过正式 Electron Worker/AEC/重采样回放合成 WAV，检查流式文本、sentence、silence 和关闭，不输入真实用户音频。

macos/ 专属文件保持只读。共享版本源及 Windows 配置已更新为 0.5.1，Mac 本机接续时先运行现有 sync-platform-manifests.mjs 同步其生成配置，继续使用冻结依赖。Mac 继续使用 Paraformer，菜单不展示尚未适配的 Qwen，共用的 800ms 静音收尾和终稿后 1000ms 提交延迟生效。后续 Mac 本机接续：

1. 先确认设备命名与默认策略。Mac 不支持 CUDA，不将 CUDA 静默映射为 Metal。
2. 增加 Mac 原生构建、受管运行时与可信平台注入，分别评估 ASR Metal 和原版对齐器 CPU。当前对齐实现只有 CUDA/CPU，不能宣称已有 Metal 对齐。
3. 创建独立 macos-arm64 运行时资源和摘要，复用两套原版模型。在 Mac 本机验证签名、后台进程、AEC、组件卸载。
4. 保持 shared 单一页面/业务，不升级既有依赖、不覆盖真实资料。Windows 验证不代表 Mac 验收；本轮不授权 Mac 原生修改、应用发行或未来自动提交推送。
