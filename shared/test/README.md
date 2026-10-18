# VoxCue 测试入口

更新：2026-10-17。用户已重新授权完整功能、面试稳定性和对抗性测试及故障修复。Liquid Glass 及其专项仍已撤回，不恢复原 test:all、test:materials、test:readability 等入口。

## 结果零保留

测试结果仅在终端或内存中显示；成功和失败均不保存报告、日志、截图、录屏、trace、coverage、数据库或隔离 userData/profile，不再按“每类最近 5 次”保留。必要工作文件仅使用操作系统临时目录，结束、失败、取消和可捕获的退出信号均须清理；异常中断残留在下次运行前清除。不得复制到工作区、recovery 或归档目录。

共用和 Mac 回归入口已使用 test-workspace.mjs：每次运行创建操作系统临时目录，登记自有进程/子进程，正常结束、异常退出和可捕获的取消信号清理；下次启动只清理有自有标记且所有登记进程均已退出的遗留目录，不跟随根路径链接。截图只返回内存 Buffer，报告/日志只写终端；数据库、输入文档、配置和测试程序等必要工作文件只存在于临时目录。保留 test/results 子路径名以兼容既有隔离断言，它实际位于随机临时根内。单测临时库由 afterEach/退出清理，Vitest 结果缓存禁用。Windows 专属旧脚本仍有持久化行为，Mac 不改写或运行这些脚本，需在 Windows 本机先改造。不要改用真实 userData、删除失败断言或省略隔离。

## 当前入口

2026-10-18 本轮在 Mac 合并远端已有 Windows 修复，只运行共用及 Mac 回归；Windows 专属文件保持远端原样，以下 Windows 命令仍由其本机执行。屏幕权限回归同时用合成 not-required 状态检查共享界面，无真实 Windows 授权或硬件验收含义。

Windows 从 windows/ 运行下列已改造入口（先准备本机构建）：

```powershell
pnpm test:windows:functional
pnpm test:windows:regression
pnpm test:presentation:native
pnpm test:speech:adversarial
pnpm test:portable:native
pnpm test:installer:artifact
```

`test:portable:native -- --installer-stage` 可验证已生成的安装包暂存目录，不重复打包；临时 WAV、profile 和原生探针仍在系统临时根清理。`test:installer:artifact` 校验 NSIS 压缩数据、更新清单 SHA512、blockmap 及暂存目录与实际安装负载的文件摘要，不执行安装。生产打包使用 windows/.cache/electron-builder 保存工具依赖，不写全局构建缓存。

functional 使用共享矩阵；regression 顺序运行平台、面试权限/思考/布局/工作流/上下文、Copilot 与更新传输回归。presentation 使用真实 HWND、任务栏 UIAutomation 和鼠标检查 Acrylic、ICO、窗口按钮、置顶及留白穿透，只向自有测试窗口发送点击，并恢复鼠标位置。所有桌面/鼠标测试必须串行，不能与另一个 GUI 测试同时运行；窗口遮挡时拒绝向其他应用发送输入。speech:adversarial 使用合成 WASAPI 端口驱动真实 Windows 控制器/Worker，验证失败与重启，不采样硬件。portable 仅在有自有进程标记的系统临时根生成便携包，运行实际 Worker/RAG 并清理，不覆盖 release、不安装或发布。

Windows 上述驱动将固定公开 WAV 临时下载为输入，不声明真人语音质量；临时包、profile、文档和探针同样由 test-workspace 管理。已改造的单项入口包含 platform-native、interview-access/effort/layout/workflow/context、copilot、updates-native、packaged；其他旧物理音频、原生权限/安装升级脚本仍需核对并改造持久化和真实环境副作用，不能直接运行。单测仅收集 shared 和当前平台的 unit/renderer。下文原 Windows“全程只读/全部旧脚本未改造”是 Mac 工作期间的历史说明，当前 macos/ 只读。

从本机平台目录执行；依赖、构建与公开样本需已准备：

```sh
node ../shared/test/scripts/check-architecture.mjs
./node_modules/.bin/vitest run --config ../shared/vitest.config.mjs
node ../shared/test/scripts/functional-suite.mjs
node ../shared/test/scripts/updates-sidebar-smoke.mjs
node ../shared/test/scripts/components-ui-smoke.mjs
node ../shared/test/scripts/ui-alignment-smoke.mjs
node ../shared/test/scripts/typography-smoke.mjs
node ../shared/test/scripts/run-electron-node.mjs ../shared/test/scripts/speech-model-check.mjs
node ../shared/test/scripts/run-electron-node.mjs ../shared/test/scripts/speech-soak.mjs --seconds=300
```

functional-suite 顺序覆盖共用界面与本机原生窗口/权限/图标/启动器、用户数据迁移、更新和模型缓存；运行前使用正式固定资源目录/摘要在本次临时根准备模型，并下载固定 revision/摘要的官方公开音频。开发态测试通过独立宿主注入临时模型路径，安装态回归仍使用真实组件缓存；不补回工作区或真实 userData 的模型。interview-stability 为重复面试、重载、Dock/置顶与透明度联动；audio-pipeline 使用合成采集端口驱动真实 utilityProcess、控制器、ASR Worker，并验证进程强制退出后的恢复。Mac native-build 只在临时目录编译/签名验证原生音频、权限绑定和启动器，不覆盖现用组件。

updates-sidebar 使用合成更新器及独立临时账户，覆盖侧栏状态对齐、各状态固定 32×32、仅圆环进度/取消图标、设置内完整百分比、自动下载开关保存、关闭设置后的后台进度和明确点击安装。updates-smoke 的手动下载/面试阻止/保存恢复回归使用独立模型可用状态夹具，不下载模型或更新包，不调用真实安装器；这些回归不代替原生安装或 Windows 本机验收。截图只在内存，结束清理全部临时资料。

components-ui 使用持续更新的合成组件状态，检查进度事件不会重启按钮宽度过渡、单个模型下载时另一个按钮的真实状态、红色图标取消及首秒进度、宽/窄窗口的个人信息和聊天列动画、提示居中、焦点恢复与减少动态效果。不下载真实模型；必要资料仅在系统临时目录，结束清理。安装态 components 回归下载真实资源，仅放慢首个 RAG 响应的实际字节以稳定检查悬停和浅深主题；请求、响应内容、大小/摘要校验、离线推理和升级复用保持真实。

ui-alignment 与 typography 使用独立合成账户/模型/语音状态，检查登录、准备聊天、个人信息与编辑、全部设置分类、知识库、记录、菜单和面试浮窗；覆盖浅深色、长名称、错误提示与主窗口最小尺寸。几何断言须等待有限动画完成，检查输入工具换行后的发送/语音按钮、常规控件高度、图标中心、弹窗操作和横向溢出。typography 可用 `--preview=personal-dark,knowledge-documents-narrow-dark` 只在终端以内存 JPEG 展示指定状态；不写图片或报告，不代替真实账户/硬件或 Windows 本机验收。

上述默认功能矩阵不启动物理麦克风采样；audio-native 是独立硬件入口，涉及真实设备，须先确认当次采样范围且环境中没有真人音频，不作为合成音频矩阵的一部分自动执行。

截图发送、取消、失败、重试和内存隔离默认使用合成图像。真实屏幕捕获是独立严格入口 `node ../shared/test/scripts/interview-screenshot-smoke.mjs --native-capture`，需要本机权限实际生效，失败不降级为成功或自动绕过系统控制；仅返回图像尺寸等元数据，桌面像素不保存或发给 Provider。合成账户/HTTP/SSE、合成设备和公开样本均不证明真实订阅、真人语音质量或另一平台硬件已验收。本轮执行结果只在终端/对话中报告，不写报告文件、验收数表或截图。

本次删除 Mac 101 项旧测试产物、4,420 文件；117 个旧目录仍被 fileproviderd 占用，暂留待释放后处理。Windows 349 个云占位目录按用户先前要求不重试，本机对 Windows 保持只读。旧报告链接仅为历史记录，不作为现存交付物。测试源码、固定输入夹具、现用模型/依赖/构建、真实原件及源码恢复基线保留。

## 源码与边界

共享单测在 shared/test/unit，Renderer 单测在 shared/test/renderer，共享回归和固定夹具在 shared/test/scripts、fixtures。Windows WASAPI/NSIS 等专属测试在 windows/test；Mac 权限、原生音频、窗口、启动器和 SF Symbols 测试在 macos/test。固定公共音频输入在 shared/test/fixtures/speech-audio，不作为生成结果删除。

单测仅收集 {shared,windows,macos}/test/{unit,renderer}/**/*.test.{ts,tsx}，不扫描历史快照或生成探针。依赖仅安装在当前平台，源码测试的 CommonJS require 使用当前平台 NODE_PATH。根命令由平台转发，另一平台目录只读；不在那里安装依赖、生成配置或运行产物。

保留的 Mac 专项源码包括 audio-native-smoke.mjs、window-native-smoke.mjs、launcher-smoke.mjs、screen-permission-smoke.mjs、icons-smoke.mjs。SF Symbols 现有 52 个映射，重置/刷新/更新分别为 Reset/Refresh/Update；icons-smoke 核对用量按钮和更新入口的实际符号，`--preview` 仅在内存展示对应界面。原生资源检查和合成 UI 不能替代真实账户、硬件或原生视觉验收。屏幕权限检查不自动申请新授权或修改 TCC。图标和删除控件回归通过 installUiAccount 的 components: true 显式注入合成模型可用状态，不下载模型；组件下载/缓存回归默认不启用该夹具，仍验证真实组件服务。

所有后续获准测试使用合成账户/文档/设备或显式公共样本，不读取真实凭据、真人音频和用户资料。不得自动重启已取消的十分钟语音或退役 benchmark。在线漏洞审计需要单独明确元数据外发授权，历史一次授权不自动延续。
