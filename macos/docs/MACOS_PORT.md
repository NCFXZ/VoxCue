# Mac 开发与发行：原生音频、窗口与启动入口

0.5.8当前仅支持Apple Silicon arm64、macOS 26+，只使用Liquid Glass和SF Symbols。当前边界见[共用布局与平台控件](../../shared/docs/PLATFORM_UI.md)。Mac renderer通过有界端口接入AppKit，页面及业务仍只有shared一份；Windows使用的网页材质和控件保持。旧Mac回退、旧Liquid Glass布尔偏好及预览入口已删除；没有有效原生绑定时拒绝启动。启动器、正式应用包及新生成更新清单最低系统均为26.0。固定Qwen/CPython、Electron及凭据助手保持原有基线和身份，不为提高应用最低系统而替换这些固定运行时。

0.5.8最新弹窗规则覆盖下文旧光晕描述：主设置/知识库使用原生40%黑色覆盖，包含实际前景投影，轮廓内留出共享对话框；面试设置不压暗、不虚化、无光晕，只使用有界`modal-exclusion`几何裁切返回按钮并保留模态。记录详情顶部复用Regular及共享headerCoverage，标题几何可为空，不复制正文标题。面试和预览固定深色，主窗口主题独立。

Mac只保留`VoxCue.app`开发启动器。原生更新失败时仍清理视图层级和临时透明标记，避免丢失输入或暴露陈旧背板；这些故障清理不构成旧系统兼容入口。Windows共用的网页材质、无障碍语义和共享功能测试继续保留，Mac生产bundle不导入webMaterials。

原生模块构建先在本平台临时 staging 完整编译/签名，再原子替换 `.node`，不原地覆盖正在运行进程映射的二进制。原生导出数量及几何读取数量按数组长度计算，避免控件删减时漏读高度或越界导出；本机原生 ABI 与36px工具栏/标题对齐由实际窗口检查。

以下2026-10-18起的版本、旧最低系统、ad-hoc签名及兼容描述为历史记录，不覆盖顶部macOS 26+和固定签名的当前准则；既有发行资产不自动重建。当前安装及更新入口见[Mac安装与免费自动更新](UPDATES.md)。

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

Mac 界面操作图标使用 [Apple SF Symbols](https://developer.apple.com/sf-symbols/)，映射与 React 适配在 macos/src。通过公开 AppKit NSImage systemSymbolName 从本机系统生成 regular/medium 透明遮罩，192px 资源只用于此 Mac 应用，位于 macos/public/sf-symbols；不复制字体或要求安装 SF Symbols 工具。可运行 corepack pnpm build:symbols 单独生成，Mac Vite 构建/开发/测试也会检查资源；缓存带系统版本指纹，缺失符号直接报错。保存、搜索、文档和预览沿用同一接口，Windows 对应 Fluent 图标。没有新 npm 或全局依赖。

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

应用名、bundle ID、userData 路径、登录密文和现有 `VoxCue Safe Storage` 项保持，不重置登录。仅固定应用证书不能证明历史钥匙串项授权和自签名代码的 partition identity 会跨版本保持。0.5.5 改由独立固定签名的 `VoxCue.Credentials` 执行加解密，原字节随应用复用；首次从旧项读取同一密码后创建助手自有保护项，不删除或修改旧项/ACL，不改变原 v10 密文格式。首次迁移仍可能需要系统授权，拒绝时保留原资料；不自动输入密码或点击授权，不承诺系统永不提示。机制及固定副本保护见 [Mac 凭据说明](CREDENTIALS.md)。

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

2026-10-17 用户取消全部 Liquid Glass 适配，已恢复实施前源码：保留 Electron 标准 sidebar vibrancy、既有网页组件、原生红绿灯与 SF Symbols。材质/原生按钮覆盖层、相关 IPC、样式及专用测试代码已移除。此次回滚不运行测试。

2026-10-22 本地 Mac 外观适配：材质、原生控件与承载实现均在 `macos/`；页面布局和业务逻辑继续共用 `shared/`。侧栏采用 `NSGlassEffectView Regular`，无着色、内部直角，实际 Electron 前景位于 `contentView`。启用时保存并清除窗口不透明底色，关闭/重载/失败时恢复；Liquid Glass设置开关按最新要求移除，保留旧系统和辅助功能回退；其他表面的旧透明度参数不改写。

2026-10-22追加（用户最新要求覆盖本节此前尺寸/开关说明）：

- 2026-10-23用户反馈聊天输入区变成浏览器裸控件、浅色主窗口中的面试预览发白。投影直接复制主窗口已加载CSSOM规则，避免构建清理旧哈希样式文件后再次加载失败；读取失败保留主文档表单。预览自身绑定深色材质变量及底景，原生背板透明标记优先于共享回退填充；原生更新失败清除透明标记和页面裁切。只定向验证本次显示与输入/预览相关改动，既有隔离及不发行限制保持。

- 用户继续纠正：普通单图标按钮除36px几何外，还须与侧栏开关共用Glass圆形、Regular控件档及无着色，避免不同原生bezel造成视觉大小不一；知识库重命名默认只显示铅笔，悬停/键盘聚焦才出现原生圆形。移除透明度后剩余字体大小整组水平居中。
- 用户最新要求面试启动后仅深色，实际窗口与设置预览同步；AI回答与个人信息图标左置，取消原生焦点外框及展开常驻按下高亮，卡片内分割线提高对比。跟随系统改用明暗半圆SF Symbol，主题与主题色同步；普通单图标按钮统一36px，聊天记录紧凑按钮和面试窗口保持原尺寸。

- 用户追加按钮与卡片调整：普通单图标按钮与侧栏开关统一36×36px，删除/重置两态同为36px，知识库关闭同步36px；侧栏聊天记录紧凑删除及面试浮窗/预览保持原尺寸；创建/重命名取消、保存固定104px。确认内容按固有宽度测量，原生同步不再改变布局，原生图标/标题仅内容变化时重建，几何更新合帧并丢弃过期请求。悬停同步系统控件高亮，返回最新保留原生Regular并加前景提亮；开始面试和浮窗设置复用内容区原生控件及菜单。
- 用户明确移除Mac Liquid Glass设置开关和不起作用的面试背景透明度滑杆，字体行重新排版；Windows既有设置保留。设置预览使用实际Clear/Regular和原生按钮，绘制独立合成底景，并在预览区域遮挡底层页面文字，不复制桌面或真实资料。
- AI回答和个人信息改为留有外边距的圆角卡片，顶部按钮切换，去掉卡片内重复关闭。AI回答和个人信息的图标均在文字左侧；记录返回仅玻璃圆形箭头。淡入淡出仅限左上标题与返回，正文和其他操作不淡出。记录重命名默认仅图标，悬停/键盘聚焦才显示圆形背景。顶部Regular始终覆盖完整主内容区，不随个人信息卡片缩窄；聊天滚动条变细、低对比透明轨道。
- 知识库文档行仅保留二次确认删除，移除准备、重新准备、取消准备和预览入口，自动索引与删除清理逻辑保持。资料提案的展开/收起、查看、保存所选统一胶囊。


侧栏折叠、个人信息和开始面试使用无着色原生 over-glass 按钮，分别为圆形与胶囊；仅开始面试文字/图标使用主题色。原生层按主窗口真实焦点和共享主题调整外观，菜单或设置打开时保留这些按钮的原生样式。

顶部与输入框直接使用相同的 AppKit `NSGlassEffectView Regular` 材质；共享消息边界进入顶部时渐显，无内容覆盖时背景透明。虚化由 AppKit 渲染，不宣称已实现 `NSScrollEdgeEffectStyle`。输入框采用 Regular，无着色，保留原 40px 连续轮廓。其实际网页前景由独立原生合成表面放进玻璃 `contentView`，React portal 仍属于同一共享状态树。输入前景持续跟随共享锚点的几何位置，随个人信息栏、侧栏动画与窗口尺寸同步，避免只监听尺寸而漏掉位置变化造成裁切。返回最新消息按钮使用同一 Regular 材质，前景仍复用共享箭头/加载三点，悬停不清除原生背景；macOS 27+ 通过公开 `effectIsInteractive` 启用系统玻璃交互提亮，26 保留 Regular 背景。聊天背景原生不透明底层阻止顶部/输入框采样桌面；聊天滚动铺满底部，渐隐移至整列底端，保留末尾阅读空间及暂停阅读行为。

账户和其他下拉菜单直接使用 NSMenu 的系统材质、布局与键盘跟踪。AppKit 没有公开的菜单 Regular/Clear 选择参数；不添加网页色罩或模拟玻璃。原项目的前置 SF Symbols 继续显示，macOS 27+ 显式设置 preferredImageVisibility=visible，避免系统默认隐藏已有图标；选中勾选仍由系统菜单承担。菜单按实际点击区域和原生菜单固有尺寸贴边定位。设置仍使用共享 dialog；原生覆盖层按共享对话框边界做路径差集避让，不能用异或产生轮廓外的矩形残影，避免输入框盖住设置。用户最新允许压暗或虚化，现选择一次统一压暗背景，保留后方 Glass 外观，关闭设置后恢复；不再添加整窗 sheet 虚化材质。

知识库与面试记录顶部沿用同一原生 Regular 覆盖层，按共享内容边界渐显；知识库创建为36px圆形 + over-glass，与侧栏开关同尺寸。记录状态标记和知识库说明/检索区移除，重命名紧邻标题。折叠侧栏收窄为84px，开关随共享锚点移动。面试记录搜索横跨主内容区，以原生 NSSearchField 的自然单行高度居中放入 Regular；查询仍由共享 React 状态筛选，仅保留搜索框内清除入口。普通 content area 按钮与弹出触发框应用于聊天页/面试页之外的操作区域，包括个人信息栏和设置，按钮按实际承载表面选择：普通操作使用AppKit NSButton/NSPopUpButton Push；位于玻璃卡片内时实际进入玻璃contentView，由AppKit提供over-glass上下文，不透明内容区沿用标准content外观，单图标保持36px；下拉使用NSPopUpButton，保留原图标；聊天耗时及面试操作等按钮沿用原样；聊天复制按钮已按最新要求接入NSButton，保持圆弧胶囊与原尺寸，复制/已复制两态默认bordered=NO，悬停或键盘聚焦才显示原生背景，原剪贴板业务保持。编辑、重命名和删除默认仅圆形图标，删除首次点击展开确认胶囊，二次才执行；原 Esc/失焦/超时取消保持。原生控件同步 details 的折叠状态及匿名内容裁切，避免隐藏的编辑/删除和选择框露出。按用户最新单独指定，面试记录详情顶部返回、导出、AI回答面板、删除及知识库顶部 + 使用无着色AppKit Glass亮面；删除展开后继续为同高紧凑玻璃胶囊。普通按钮的原生绘制层不接收点击，保留共享元素的真实指针、键盘、表单和文件选择流程；搜索文本通过有界展示端口同步，不新增业务状态来源。

面试浮窗及其预览保持原尺寸；常规单图标操作保持36×36px；删除/重置两态均为36px、知识库关闭同步36px，聊天记录中的紧凑删除继续32px，默认即使用危险红色；原生 SF Symbol 同步显式颜色，网页确认内容作光学居中微调。原生胶囊按钮启用 imageHugsTitle，将图标和标题作为一组居中；共享按钮统一控件行高，面试浮窗及预览保持原尺寸。聊天技能更新提示和三个建议入口按单独要求改为胶囊，输入框仍保留原40px连续轮廓。准备页原生标题按自然文字高度居中，与顶部按钮共用横向中心线；零尺寸隐藏锚点不创建前景投影，恢复聊天路由后重试；窗口缩放使在途几何过期时保留已安装的原生输入层，并以新布局重试，避免销毁正在编辑的前景。更新设置中的“自动下载更新”改为原生 NSSwitch，NSSwitch直接接收原生鼠标追踪，通过有界的appearance:content-toggle事件同步共享元素；键盘、保存和更新业务仍由原共享设置处理，此开关不依赖侧栏 Liquid Glass 偏好开启。

面试浮窗单独适配原生 Liquid Glass：工具栏、转写和回答面板使用 Clear、无着色；转写气泡、问题/回答、异常提示与输入框使用和主聊天输入框相同的 Regular。按共享 DOM 的真实几何及滚动裁切放置 AppKit 背板，网页仅在原生启用后清除旧色罩/模糊，原文字、选择、输入和业务状态保持在同一 Chromium 前景。顶部折叠/品牌、设置、截图保护、结束、拖动及面板顶部操作使用 NSButton Glass 背板，保留来源图标与品牌内容、32px 原尺寸和既有事件；不改主聊天输入框轮廓。展示端口仅限面试主 frame，材质类型、数量、几何及裁切有界；旧系统、关闭偏好与辅助功能回退旧外观，收起/切换/卸载清理原生背板。Clear 背板使用局部 DarkAqua 与协调浅色文字/状态前景，避免浅色主题在暗背景上出现暗字；面试窗口及其设置、预览固定深色，Regular 阅读面、输入和 over-glass 按钮使用局部 DarkAqua，不随主窗口的浅色/跟随系统设置切换。

共享层仅增加有界几何、颜色、透明度和固定动作的主窗口及面试主 frame 展示端口和固定资源装配；材质不共享。仅运行本轮展示端口、偏好、平台边界和隔离 GUI 的定向检查，不恢复全量矩阵。仅使用合成账户/资料、受控背景与自有窗口，不访问真实账户/凭据或采样硬件，临时内容退出清理、结果只在终端/内存。不改 Windows 专属、依赖/锁、版本、发行或真实安装，不提交推送。

## 验证与边界

当前基础检查、341 项单测、Mac 原生构建、实际系统音频/麦克风 PCM、双音源 utilityProcess/ASR Worker、停止冲刷、原生背压拒绝、窗口/Dock/退出、双击入口与重复启动均按根 PROGRESS.md 最新记录验收。历史音频测试只记录过包计数、采样率、幅度和状态，不保存采集 PCM 或转录正文。从 2026-10-17 用户最新指令起，这些结果同样不再保存；测试仍暂停，旧持久化脚本须改造后才能运行。必要合成提示音与隔离 profile 仅在操作系统临时目录使用，结束/失败/取消须清理。测试界面为隔离合成账户，截图是 Renderer 内容，系统红绿灯另通过实际 BrowserWindow 原生位置 API 核对。

Windows WASAPI 原生源码、采集/权限/进程实现不改，共用控制器抽出后继续由原 Windows 适配器装配。Mac 上的共享/Windows 单测与编译不能替代 Windows 硬件/NSIS 执行。蓝牙/外接设备、真实物理热插拔、长时间稳定性、真人识别质量、真实账户和正式 Mac 分发尚未验收；不运行此前已取消的十分钟语音。


2026-10-23 原生控件复核：普通按钮使用标准Push，包含个人信息编辑/删除、知识库对话框操作、本地组件删除/确认；实际卡片的contentView承载负责over-glass上下文，不能用独立Glass bezel替代。原生绘制层仍由共享DOM承担动作，无新增业务状态来源。明确指定亮面的管理页顶部和主窗口独立玻璃按钮使用Glass。聊天复制的背景显隐使用公开NSButton.bordered；小尺寸复制保持12px系统字体、13px SF Symbol、28px高度。确认开始的文字和符号以主题accent着色。删除/重置确认按共享固有图文宽度加24px测量，保持原高度与二次确认规则。

面试Clear可读性采用独立NSView黑色背板（alpha .78），原生路径与共享连续轮廓一致，仅Clear顶部/面板启用；Regular气泡/异常/输入框仍使用原材质。公开tintColor可以使用黑色，但只给玻璃着色，不代表在玻璃后添加黑底。隔离白色文字底景比较了黑色tint与独立背板，最终保留Clear无着色。参考Apple [AppKit新设计](https://developer.apple.com/videos/play/wwdc2025/310/) 和 [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)。

本次审查也确认尚有共享绘制的控件：主聊天输入区的附件/模型/思考触发和发送/停止，面试输入区的自动回答/截图/发送，以及面试回答行的复制；下拉菜单本身已经使用NSMenu。这些入口的原生绘制适配器目前未接入投影文档/复合状态，不能将其宣称为原生NSButton；没有宣称AppKit不能实现。侧栏与设置的导航、历史/知识库数据行属于共享复合导航内容。聊天耗时/进度披露仍按此前明确约定保留共享样式。


2026-10-23 后续覆盖：设置不再整窗压暗；原生NSShadow仅围绕共享对话框连续轮廓绘制光晕（浅色黑、深色白），模态阻止背景操作仍保留。主窗口沿用原生对话框展示锚点作遮挡排序，浮窗通过有界dialog-halo展示同一效果。仅“此窗口未隐藏”使用regular-dark展示和NSGlassEffectView.tintColor黑色.55，其他Regular不变。浮窗重试使用标准Push NSButton置入实际Regular/Clear contentView，原描边按钮改为胶囊；顶部胶囊两侧留白18px。

字号控制使用NSSlider content-area，12–24且步进1、continuous=YES，默认/按下/禁用外观由AppKit绘制。原生鼠标通过有界content-range事件更新当前HTML range，沿用React保存和键盘；主设置与面试设置共用。主设置预览沿用真实面试的78%黑色背板、Clear/Regular及顶部留白。开始弹窗重新检查/确认开始使用ResizeObserver同步顶部开始按钮实际宽度。记录原生搜索位于ScrollChrome下，滚入顶部时由Regular虚化。普通dialog的content-area判断优先于DOM外层玻璃卡片，避免控件落入背后的玻璃contentView。

返回最新按钮在聊天和面试内均使用Regular，悬停/键盘聚焦由实际contentView内的标准Push按钮提供反馈；macOS 27+保留effectIsInteractive。面试胶囊承载中的返回按钮清除旧8px margin，与聊天输入框保持10px间距。设置预览和面试设置的滚动增量在同一Renderer帧应用并立即读取几何；原生控件保存窗口坐标，在材质更新移动父玻璃后重新换算局部坐标，防止父子同时移动造成错位。网页滚动仍属于共享布局，并未替换成NSScrollView。

2026-10-23 再次覆盖返回按钮：移除Push高亮背板，默认仅保留与输入框相同的Regular/tintColor=nil；悬停/聚焦将同一玻璃的公开tintColor设为12%中性色（深色白、浅色黑），退出恢复nil，27+保留interactive。面试的返回按钮不能只放在Chromium下方：现在复用主聊天的实际玻璃contentView前景承载，玻璃位于正文之上。纯展示投影标记inert/aria-hidden并不参与原生命中，唯一可访问/可点击按钮保留在共享父文档，避免把NSWindow命中上下文交给另一窗口的Electron事件视图；输入框既有可交互投影不变。面试按钮常驻并切换visible，生成中三点、暂停阅读箭头、回到底部隐藏沿用共享逻辑。品牌胶囊左右内边距14px，实际窗口与预览共用Mac样式。

复制控件改为固定bezeled布局并使用公开[showsBorderOnlyWhileMouseInside](https://developer.apple.com/documentation/appkit/nsbutton/showsborderonlywhilemouseinside)，共享悬停/焦点由公开NSButtonCell.mouseEntered/mouseExited转交AppKit，默认不绘制边框；避免bordered开关改变系统内容内边距。图文左置并补偿12px系统内边距，28px高度与实际剪贴板流程不变；复制跟随搜索的滚动层级放在ScrollChrome下方，避免滚进工具栏后仍锐利盖住标题。

返回按钮的原生cornerRadius进一步与输入框一致设为0，由圆形轮廓mask保留36px形状；不增加输入框没有的原生圆形透镜边缘。输入框原40px连续轮廓不变。复制胶囊网页水平内边距8→10px，满足系统“已复制”固有宽度并保留两态左缘一致。

ScrollChrome命中先检查玻璃bounds和实际mask；输入框前景虽使用全视口坐标，其事件范围只属于输入框轮廓，不能抢走框外复制/返回按钮的点击。返回前景投影不命中，事件继续到父文档的原始按钮；隔离入口使用NSApp自身窗口的合成AppKit鼠标事件验证实际命中，保留既有键盘路径。
