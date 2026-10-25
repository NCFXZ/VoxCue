# Mac 开发与发行：原生音频、窗口与启动入口

## 2026-10-25 当前共用界面

Mac 已撤除原生展示适配，直接使用与 Windows 相同的 shared按钮、Radix下拉菜单、毛玻璃及页面布局；Mac图标按最新要求使用SF Symbols；不再存在原生控件/材质几何投影、macOS26启动门槛。新构建最低为 Apple Silicon/macOS 14.2，系统音频、权限、凭据、Dock/窗口生命周期与更新保留。详见 [共用桌面界面](../../shared/docs/PLATFORM_UI.md)。以下历史原生展示描述均已被此项替代，不能继续作为当前实现或测试入口。


当前源码版本0.5.10，最低系统14.2，固定Qwen/CPython、Electron及凭据助手保持既有身份和运行时版本。此前发布的macOS 26+安装包与签名清单不会因源码修改而改变。内部控件及材质参数由shared提供；Mac主窗口恢复适配Liquid Glass前的Electron sidebar vibrancy/followWindow，网页底板透明以透出系统毛玻璃。聊天与面试均按旧滑块100%设置，面试大背景保留完整曲线60%的透视底色，内部玻璃最终统一聊天输入框网页材质。系统音频和权限仍由Mac专属助手提供。

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

Mac build包括Core Audio助手、屏幕权限绑定、固定Qwen运行时、共用Electron/Renderer及VoxCue.app。build:shared先生成SF Symbols资源，再编译共用Electron/Renderer；不生成平台内容控件、Liquid Glass或局部系统背景绑定。除主窗侧边栏保留sidebar vibrancy外，内部玻璃使用shared聊天输入框的网页材质；Windows无局部原生模糊接续任务。最低14.2保持。需要已安装的Command Line Tools，不需要完整Xcode或虚拟声卡。Node/pnpm依赖、工具缓存、开发宿主及构建留在macos，shared/local-models保存唯一可移植权重。

## 界面图标

Mac通过构建时生成的SF Symbols资源接入共用图标接口，Windows使用Fluent；不恢复平台页面或AppKit内容控件。品牌Logo和应用ICNS保持。

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

应用名、bundle ID、userData 路径、登录密文和现有 `VoxCue Safe Storage` 项保持，不重置登录。仅固定应用证书不能证明历史钥匙串项授权和自签名代码的 partition identity 会跨版本保持。0.5.5 改由独立固定签名的 `VoxCue.Credentials` 执行加解密，原字节随应用复用；首次从旧项读取同一密码后创建助手自有保护项，不删除或修改旧项/ACL，不改变原 v10 密文格式。首次迁移仍可能需要系统授权，拒绝时保留原资料；不自动输入密码或点击授权，不承诺系统永不提示。机制及固定副本保护见 [Mac 凭据说明](CREDENTIALS.md)。

Mac目录运行`node test/scripts/development-signing-smoke.mjs`检查开发/正式两组不同构建的稳定身份、嵌套助手和开发权限声明保留、替代签名拒绝；追加`--packaged`会在系统临时目录构建实际正式应用并核对证书和密钥排除，不生成DMG/更新ZIP或发布。临时文件退出清理，输出仅终端，不访问现有登录资料。

## macOS 窗口

清单 1–10 的页面、设置和通用交互已按用户确认共用；置顶、穿透和图标隐藏保持自动，不新增开关。Mac 的 Dock/应用原生主题/原生穿透调用在 macos/electron/presentation.ts，通过共享 NativePresentation 类型端口连接 main；主进程仍负责面试生命周期、授权和恢复竞态。纯布尔展示能力经可信窗口参数传给沙箱 preload，Renderer 只按就绪状态启用效果。Windows 文件只读，未接入能力显示待适配，实际效果与验收留待 Windows 本机。

开发宿主的 CFBundleIconFile 指向包内 voxcue.icns，与现有 Mac 应用图标同源；宿主缓存纳入 ICNS 内容摘要。结束面试恢复 Dock 时，在显示前后重设 VoxCue 图标，避免回退到 Electron 默认图标。宿主通过暂存生成、保留旧运行副本后切换，不原地改写正在运行的宿主。

Mac 图标使用本平台 IconBuilder 从共享高分辨率原图生成：1024px 画布内素材832px、四边各96px透明留白，配套全尺寸ICNS。Dock与启动器共用macos/public衍生图。2026-10-19用户最终提供新的PNG，当前仅缩放并保留其轮廓和透明通道，不再叠加前一版自绘连续圆角或白色底板；共用原件原字节保留，两平台图标由同一源派生。原生检查入口为`node test/scripts/app-icon-smoke.mjs`，以临时透明合成图检查不增加底板/裁切、各尺寸与ICNS结构，退出清理。正常退出再双击VoxCue.app使用新的本地开发图标，无需重启Dock或清理系统缓存。

主窗口和登录窗口使用macOS原生红绿灯、隐藏标题栏与系统圆角；共享页面为红绿灯避让，不绘制Windows式窗口按钮。内部按钮、下拉菜单、输入框和材质与Windows共用。macOS系统菜单栏保留应用/文件/编辑/窗口角色，以支持系统快捷键。Dock继续使用VoxCue应用图标；面试浮窗的双面板布局与结束确认交互保持。

进入面试、浮窗准备显示时自动隐藏本应用 Dock 运行图标及主窗口，结束面试后恢复；不修改系统 Dock 偏好或手动固定的启动项。浮窗使用 floating 层级，在所有桌面和全屏应用上可见，失焦不抢键盘焦点，显示/恢复或置顶意外关闭时重新应用。重复启动优先聚焦当前面试浮窗；正常退出应用时不重新显示 Dock 图标。生命周期在当前完整矩阵中通过隔离合成窗口验证。

浮窗透明画布默认鼠标穿透，只有工具栏、双面板、缩放热区和提示卡保留鼠标交互；面板间隙、外圈和空提示区可操作后方应用。Electron setIgnoreMouseEvents 配合 forward 鼠标移动恢复可见区域命中，拖动期间不切换；失焦不重复设置置顶或抢焦点。该控制只由当前浮窗主 frame 发送单个布尔值，不开放任意原生窗口控制；Windows使用其平台适配器。需要正常结束面试、退出并重开以加载 main/preload/Renderer 更新，验收使用隔离合成窗口。

关闭主窗口先保存，随后驻留 Dock；激活 Dock 根据当前账户恢复主窗口或登录窗口。取消退出不会让后续关闭误退出；Cmd+Q 会在保存完成后真正结束。已有 userData、凭据、聊天和个人资料路径/存储键保持。Renderer只接收不可变系统能力，不访问Node或process.platform。

## 共用窗口布局与外观

内部应用控件、菜单和材质以[共用桌面界面](../../shared/docs/PLATFORM_UI.md)为准。当前产品只有一套shared Renderer，不存在AppKit控件/玻璃或旧Mac回退。侧栏、聊天、个人信息、知识库、记录、面试和所有弹窗均使用共用布局。原生系统窗口生命周期继续由Electron适配，快捷键、Dock恢复、音频权限、凭据和更新保持。

## 验证与边界

当前验证入口见[测试说明](../../shared/test/README.md)。使用隔离合成账户、资料和公开固定音频/模型测试完整功能、对抗输入、20轮面试与10分钟双路转写；不读取真实账户或采样硬件。测试输出仅终端/临时目录，退出清理。macOS 14.2编译和包声明仍需旧系统实机复验，Windows DPI/系统集成由Windows本机执行。

在macos目录执行：

```sh
corepack pnpm typecheck
corepack pnpm check:architecture
corepack pnpm check:workspace
corepack pnpm build
corepack pnpm test
node ../shared/test/scripts/functional-suite.mjs
node test/scripts/ui-refinement-matrix.mjs
```

默认完整矩阵使用临时签名薄包核对新构建；不会改写历史发行资产或替换真实安装；0.5.10发行须另外验证最终安装包。旧系统不能通过只改包声明获得保证，仍须检查所有固定运行时的部署目标并在对应系统验证。
