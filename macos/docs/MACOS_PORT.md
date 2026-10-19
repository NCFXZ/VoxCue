# Mac 开发与发行：原生音频、窗口与启动入口

更新：2026-10-18。目标为 Apple Silicon arm64、macOS 14.2+；独立 Mac 安装版已发布 [v0.3.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.3.0) 并设为Latest，包含美化 DMG 与签名更新 ZIP/清单，使用独立模型缓存。Windows仍使用既有0.2.2，旧发行及资产保留。应用为 ad-hoc 签名，未经过 Apple 公证；下文 macos/VoxCue.app 仍是依赖工作区的开发启动入口，发行说明见 [Mac 安装与免费自动更新](UPDATES.md)。

用户已恢复完整功能、面试稳定性与对抗性测试授权，下文此前暂停状态为历史。共用/Mac 回归入口遵守临时目录与结果零保留，执行输出只在终端/对话；Windows 仍只读。Mac Dock 连续面试的隐藏期限同时考虑最近 hide/show，show 完成后刷新期限；原生组件被现用应用占用时使用临时目录编译验证，不覆盖已加载组件。入口与合成/真实权限边界见 shared/test/README.md，不保存本轮报告或验收数表。

## 双击启动

在 macos 文件夹中双击 VoxCue.app。它使用项目图标，直接打开已有本地构建，不弹终端、不自动编译或下载。重复打开会恢复并聚焦已有窗口。请保留此 app 在 macos 目录内；可将它拖到 Dock 固定引用，不要把它当作独立安装包移到其他目录。

初次准备依赖先进入 macos，将包管理器和 Electron 下载缓存也留在本目录：

```sh
cd macos
export COREPACK_HOME="$PWD/.tools/corepack"
export ELECTRON_CACHE="$PWD/.cache/electron"
corepack pnpm install --frozen-lockfile
cd ..
```

之后在仓库根执行：

```sh
corepack pnpm build
corepack pnpm start
# 仅重建启动入口
corepack pnpm build:launcher
# 实际设备与窗口验证（会请求系统音频/麦克风权限）
corepack pnpm test:audio:native
corepack pnpm test:window:native
corepack pnpm test:launcher
```

Mac build 包括 Core Audio 助手、屏幕权限绑定、SF Symbols 资源、Electron/Renderer 及 VoxCue.app。build:shared 不构建运行时原生助手；其 Mac Vite 入口会准备界面符号资源。需要已安装的 Command Line Tools；不需要 Homebrew、完整 Xcode 或虚拟声卡。Node/pnpm 依赖、工具缓存、开发宿主和构建都留在 macos；shared/local-models 保存唯一可移植权重。

## 界面图标

Dock/访达应用图标沿用白底 Logo 和透明边距的 PNG/ICNS。运行时明确使用非模板彩图，在本应用或系统主题变化时重设同一图片，面试结束恢复 Dock 前后也使用该图片；不改变应用的浅色/深色/跟随系统设置。macOS 额外的图标着色或透明风格由系统管理，本应用不修改全局外观或 Dock 偏好，也不承诺禁止所有系统渲染处理。

Mac 的全部 50 个界面操作图标使用 [Apple SF Symbols](https://developer.apple.com/sf-symbols/)，映射与 React 适配在 macos/src。通过公开 AppKit NSImage systemSymbolName 从本机系统生成 regular/medium 透明遮罩，192px 资源只用于此 Mac 应用，位于 macos/public/sf-symbols；不复制字体或要求安装 SF Symbols 工具。可运行 corepack pnpm build:symbols 单独生成，Mac Vite 构建/开发/测试也会检查资源；缓存带系统版本指纹，缺失符号直接报错。保存、搜索、文档和预览沿用同一接口，Windows 对应 Fluent 图标。没有新 npm 或全局依赖。

构建时替换统一图标入口，Mac Renderer 不包含 Fluent UI 图标模块；Windows 原实现保持。尺寸、颜色继承、旋转、浮窗右侧缩放镜像与无障碍行为保持，品牌 Logo 独立。专项 corepack pnpm test:icons 使用隔离账户和合成音频覆盖登录、主界面、设置和浮窗，附完整浅深主题符号预览。Mac 图标单测在 Windows 跳过，不要求其生成或安装 Apple 资源。

## 原生音频

屏幕捕获权限独立于音频检查：开场只读显示屏幕权限，未获授权仍可开始纯语音面试；截图发送前仍实时检查。设置 → 面试设置 → 允许捕获屏幕可点击申请、打开系统设置或重新检查，返回焦点自动刷新。状态来自系统而非本地保存的开关；未生效时正常退出再打开，不能自动改 TCC 或替用户开启权限。

macos/native/ScreenPermission.mm 为 Node-API 8 绑定，在 Electron 自身身份下使用 [CGPreflightScreenCaptureAccess](https://developer.apple.com/documentation/coregraphics/cgpreflightscreencaptureaccess%28%29) 查询、[CGRequestScreenCaptureAccess](https://developer.apple.com/documentation/coregraphics/cgrequestscreencaptureaccess%28%29) 申请，不读取图像或录屏。申请仅由用户点击触发，异步执行；已拒绝/未生效时可打开固定隐私页面。Mac build 包含 build:permissions，头文件复用本机 Node.pkg 并缓存在 macos/.cache/node-api-headers；绑定在 native/bin，SDK/厂商依赖不修改。开发宿主/启动器带 NSScreenCaptureUsageDescription，更新宿主时保留旧副本供仍运行的应用，不强行退出用户窗口。

权限专项为 corepack pnpm test:screen-permission：真实原生查询与已授权幂等请求，加隔离合成 UI 授权/拒绝/撤销；不会自动点击真实 OS 新授权或保存真实屏幕像素。新授权弹窗由用户正常使用验证。

平台边界：Mac 只能读取 windows；同步、构建、格式化与图标工具不写另一平台。Electron 编译只生成 shared/macos，拒绝 Windows 输出，启动回归检查实际加载模块。Windows 旧配置及旧 dist-electron/macos 保留，交由 Windows 本机同步/重建；厂商跨平台资料与受保护恢复档案保留。

macos/native/AudioCapture.mm 使用 Core Audio。系统音频是绑定所选输出设备的私有 process tap；麦克风使用所选输入设备的 HAL IOProc。仅聚合 tap，不把双向物理设备的麦克风混入系统音源；不改变默认设备、采样率、硬件音量或播放静音状态。两个音源各自输出已有 Float32 PCM 包协议，经 utilityProcess 送入唯一共用 Paraformer/Silero Worker，没有新增推理后端。

同时采集系统与麦克风时，Mac在该Worker的ASR之前自动启用软件消回声：@ennuicastr/webrtcaec3.js固定0.3.0，JS/WASM和许可证在本机随包加载。参考是所选输出设备全部应用的混音，系统转写保留原流；麦克风重采样到48kHz并以10ms帧处理。使用两路原生共同单调时钟，参考最多等待80ms；参考缺失时旁路保留麦克风，单音源听写不处理。停止/暂停排空滤波延迟与最后短帧，间断重置两路边界；准备或处理失败显式停止，不靠播放静音、改音量或文字去重掩盖问题。合成测试不等于真实房间、外放音量及双方同时说话的质量验收。

采集只在明确语音/面试操作后开始；不录制视频、不保存或上传采集音频。设备 UID 持久选择失效时明确失败，不改默认；设备、默认路由或采样率变化、非法格式和积压均停止并报错。当前支持 HAL 的小端 Float32/Float64 与有符号 Int16/Int32 紧密 PCM，按通道转单声道。无锁单生产者/单消费者原生队列同时受 32 包和 1.5 秒限制；原有 ASR 两秒队列门槛保持。Mac 停止时先停止 IOProc、排空已收到尾包，再退休回调并冲刷 ASR；Windows 原有退休时机保持。

Apple 没有公开的系统音频授权状态查询。按照[官方 Core Audio taps 文档](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)，首次从 tap 聚合设备启动时系统才询问授权。Mac 检查因此短暂启动零采样 IOProc 后立即释放，用于请求授权和验证原生初始化结果；它不读取缓冲、不返回音频、不加载 ASR，不拿 screen 或 microphone 的状态替代系统音源。真正的音源可用性还依赖后续采集帧和运行错误。禁用麦克风时不请求其权限。

macos/.tools/electron-dev 是带 VoxCue 名称和明确用途说明的本地 Electron 宿主副本；厂商 node_modules 不修改。开发宿主、启动器与后续正式应用共用固定本地自签名证书，不等同 Developer ID 分发签名或公证。正常系统权限由用户决定，应用不修改 TCC 数据库或自动开启权限。

## 固定本地签名与登录保留

2026-10-19起，源码的开发和正式打包入口复用同一证书；已发布的旧安装包仍保留原ad-hoc签名。公开指纹在`macos/local-signing-public.json`，身份与口令仅保存在被Git忽略的`macos/.tools/development-signing/`专用钥匙串目录，目录0700、文件0600，私钥不可导出。构建只解锁此专用钥匙串，按证书指纹与原bundle ID签名并核对资源，不修改登录钥匙串的现有项或ACL，也不将自签名证书加入系统信任。Sparkle既有Ed25519密钥及公钥不变。

首次准备身份的显式入口是仓库根的`node macos/scripts/setup-development-signing.mjs`。本机身份已建立，后续构建无需重新创建；该入口重复运行也只复用原身份。**请保管并自行安全备份整个私密目录，禁止在清理缓存时删除，不上传或打包。** 新机器或目录丢失时需恢复原身份；有公开指纹后setup拒绝生成替代证书，构建缺失/错配也不会回退ad-hoc。

应用名、bundle ID、userData路径、登录密文和现有`VoxCue Safe Storage`项保持，不重置登录。首次从旧签名切换时macOS仍可能要求一次授权；确认是本机VoxCue后，由用户在系统窗口选择“始终允许”可保存本次信任。固定身份减少后续重建的重复授权，不能保证系统永不提示；不自动输入密码或点击系统授权。

Mac目录运行`node test/scripts/development-signing-smoke.mjs`检查开发/正式两组不同构建的稳定身份、嵌套助手和开发权限声明保留、替代签名拒绝；追加`--packaged`会在系统临时目录构建实际正式应用并核对证书和密钥排除，不生成DMG/更新ZIP或发布。临时文件退出清理，输出仅终端，不访问现有登录资料。

## macOS 窗口

清单 1–10 的页面、设置和通用交互已按用户确认共用；置顶、穿透和图标隐藏保持自动，不新增开关。Mac 的 Dock/应用原生主题/原生穿透调用在 macos/electron/presentation.ts，通过共享 NativePresentation 类型端口连接 main；主进程仍负责面试生命周期、授权和恢复竞态。纯布尔展示能力经可信窗口参数传给沙箱 preload，Renderer 只按就绪状态启用效果。Windows 文件只读，未接入能力显示待适配，实际效果与验收留待 Windows 本机。

开发宿主的 CFBundleIconFile 指向包内 voxcue.icns，与现有 Mac 应用图标同源；宿主缓存纳入 ICNS 内容摘要。结束面试恢复 Dock 时，在显示前后重设 VoxCue 图标，避免回退到 Electron 默认图标。宿主通过暂存生成、保留旧运行副本后切换，不原地改写正在运行的宿主。

Mac 图标使用本平台 IconBuilder 从共享高分辨率原图生成：1024px 画布内素材832px、四边各96px透明留白，配套全尺寸ICNS。Dock与启动器共用macos/public衍生图。2026-10-19用户最终提供新的PNG，当前仅缩放并保留其轮廓和透明通道，不再叠加前一版自绘连续圆角或白色底板；共用原件原字节保留，两平台图标由同一源派生。原生检查入口为`node test/scripts/app-icon-smoke.mjs`，以临时透明合成图检查不增加底板/裁切、各尺寸与ICNS结构，退出清理。正常退出再双击VoxCue.app使用新的本地开发图标，无需重启Dock或清理系统缓存。

主窗口、登录窗口使用 Electron hidden 标题样式保留原生左上角红绿灯，内容铺满顶边，仅侧栏品牌区避让控件；Mac 使用系统字体，不显示 Windows 自绘右侧按钮。菜单采用 macOS 应用/文件/编辑/窗口角色，Dock 使用 VoxCue 图标。登录窗口保持固定用途，绿色缩放不可用。面试浮窗继续保留已确认的透明工具面板与结束确认交互，不额外占用其双面板布局。

进入面试、浮窗准备显示时自动隐藏本应用 Dock 运行图标及主窗口，结束面试后恢复；不修改系统 Dock 偏好或手动固定的启动项。浮窗使用 floating 层级，在所有桌面和全屏应用上可见，失焦不抢键盘焦点，显示/恢复或置顶意外关闭时重新应用。重复启动优先聚焦当前面试浮窗；正常退出应用时不重新显示 Dock 图标。当前这项生命周期调整仅完成编译，用户暂停的窗口测试尚未恢复。

浮窗透明画布默认鼠标穿透，只有工具栏、双面板、缩放热区和提示卡保留鼠标交互；面板间隙、外圈和空提示区可操作后方应用。Electron setIgnoreMouseEvents 配合 forward 鼠标移动恢复可见区域命中，拖动期间不切换；失焦不重复设置置顶或抢焦点。该控制只由当前浮窗主 frame 发送单个布尔值，不开放任意原生窗口控制；Windows 不使用。需要正常结束面试、退出并重开以加载 main/preload/Renderer 更新，运行验收仍暂停。

关闭主窗口先保存，随后驻留 Dock；激活 Dock 根据当前账户恢复主窗口或登录窗口。取消退出不会让后续关闭误退出；Cmd+Q 会在保存完成后真正结束。已有 userData、凭据、聊天和个人资料路径/存储键保持。原生控件由主进程配置，Renderer 只接收不可变展示能力，不访问 Node 或 process.platform。

## 紧凑窗口布局

Mac 主窗口与登录窗口不渲染网页标题栏，内容从窗口顶边铺满；保留原生红绿灯（16, 18）。主窗口品牌区从顶部 44px 开始，标题与副标题紧凑排布，折叠侧栏宽 92px 以容纳原生按钮。顶部空区、品牌和页面标题可拖动，交互按钮明确排除拖动。登录恢复 960×580，不额外增加标题栏高度；内容卡片无顶部外边距。此调整不恢复 Liquid Glass，未运行测试。

## 外观范围

共用设置 → 常规提供 0–100 连续透明度滑杆，0 关闭、默认 50；Mac 即时调整现有标准 vibrancy 侧栏的网页遮罩与模糊，不更换原生材质。浮窗背景按 60×滑杆比例、输入与转写/问题/回答气泡按 30×比例取值，旧四档只读映射到数值。系统降低透明度/增强对比度时回退不透明背景，不增加文字光晕/描边。Windows 可看到和保存同一参数，实际效果待适配。该功能不使用 Liquid Glass。

2026-10-17 用户取消全部 Liquid Glass 适配，已恢复实施前源码：保留 Electron 标准 sidebar vibrancy、既有网页组件、原生红绿灯与 SF Symbols。材质/原生按钮覆盖层、相关 IPC、样式及专用测试代码已移除；不自动恢复该方向。此次回滚不运行测试。

## 验证与边界

当前基础检查、341 项单测、Mac 原生构建、实际系统音频/麦克风 PCM、双音源 utilityProcess/ASR Worker、停止冲刷、原生背压拒绝、窗口/Dock/退出、双击入口与重复启动均按根 PROGRESS.md 最新记录验收。历史音频测试只记录过包计数、采样率、幅度和状态，不保存采集 PCM 或转录正文。从 2026-10-17 用户最新指令起，这些结果同样不再保存；测试仍暂停，旧持久化脚本须改造后才能运行。必要合成提示音与隔离 profile 仅在操作系统临时目录使用，结束/失败/取消须清理。测试界面为隔离合成账户，截图是 Renderer 内容，系统红绿灯另通过实际 BrowserWindow 原生位置 API 核对。

Windows WASAPI 原生源码、采集/权限/进程实现不改，共用控制器抽出后继续由原 Windows 适配器装配。Mac 上的共享/Windows 单测与编译不能替代 Windows 硬件/NSIS 执行。蓝牙/外接设备、真实物理热插拔、长时间稳定性、真人识别质量、真实账户和正式 Mac 分发尚未验收；不运行此前已取消的十分钟语音。
