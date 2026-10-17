# VoxCue 测试入口

更新：2026-10-17。用户已重新授权完整功能、面试稳定性和对抗性测试及故障修复。Liquid Glass 及其专项仍已撤回，不恢复原 test:all、test:materials、test:readability 等入口。

## 结果零保留

测试结果仅在终端或内存中显示；成功和失败均不保存报告、日志、截图、录屏、trace、coverage、数据库或隔离 userData/profile，不再按“每类最近 5 次”保留。必要工作文件仅使用操作系统临时目录，结束、失败、取消和可捕获的退出信号均须清理；异常中断残留在下次运行前清除。不得复制到工作区、recovery 或归档目录。

共用和 Mac 回归入口已使用 test-workspace.mjs：每次运行创建操作系统临时目录，登记自有进程/子进程，正常结束、异常退出和可捕获的取消信号清理；下次启动只清理有自有标记且所有登记进程均已退出的遗留目录，不跟随根路径链接。截图只返回内存 Buffer，报告/日志只写终端；数据库、输入文档、配置和测试程序等必要工作文件只存在于临时目录。保留 test/results 子路径名以兼容既有隔离断言，它实际位于随机临时根内。单测临时库由 afterEach/退出清理，Vitest 结果缓存禁用。Windows 专属旧脚本仍有持久化行为，Mac 不改写或运行这些脚本，需在 Windows 本机先改造。不要改用真实 userData、删除失败断言或省略隔离。

## 当前入口

从本机平台目录执行；依赖、构建与公开样本需已准备：

```sh
node ../shared/test/scripts/check-architecture.mjs
./node_modules/.bin/vitest run --config ../shared/vitest.config.mjs
node ../shared/test/scripts/functional-suite.mjs
node ../shared/test/scripts/run-electron-node.mjs ../shared/test/scripts/speech-model-check.mjs
node ../shared/test/scripts/run-electron-node.mjs ../shared/test/scripts/speech-soak.mjs --seconds=300
```

functional-suite 顺序覆盖共用界面与本机原生窗口/权限/图标/启动器；interview-stability 为重复面试、重载、Dock/置顶与透明度联动；audio-pipeline 使用合成采集端口驱动真实 utilityProcess、控制器、ASR Worker，并验证进程强制退出后的恢复。Mac native-build 只在临时目录编译/签名验证原生音频、权限绑定和启动器，不覆盖现用组件。

上述默认功能矩阵不启动物理麦克风采样；audio-native 是独立硬件入口，涉及真实设备，须先确认当次采样范围且环境中没有真人音频，不作为合成音频矩阵的一部分自动执行。

截图发送、取消、失败、重试和内存隔离默认使用合成图像。真实屏幕捕获是独立严格入口 `node ../shared/test/scripts/interview-screenshot-smoke.mjs --native-capture`，需要本机权限实际生效，失败不降级为成功或自动绕过系统控制；仅返回图像尺寸等元数据，桌面像素不保存或发给 Provider。合成账户/HTTP/SSE、合成设备和公开样本均不证明真实订阅、真人语音质量或另一平台硬件已验收。本轮执行结果只在终端/对话中报告，不写报告文件、验收数表或截图。

本次删除 Mac 101 项旧测试产物、4,420 文件；117 个旧目录仍被 fileproviderd 占用，暂留待释放后处理。Windows 349 个云占位目录按用户先前要求不重试，本机对 Windows 保持只读。旧报告链接仅为历史记录，不作为现存交付物。测试源码、固定输入夹具、现用模型/依赖/构建、真实原件及源码恢复基线保留。

## 源码与边界

共享单测在 shared/test/unit，Renderer 单测在 shared/test/renderer，共享回归和固定夹具在 shared/test/scripts、fixtures。Windows WASAPI/NSIS 等专属测试在 windows/test；Mac 权限、原生音频、窗口、启动器和 SF Symbols 测试在 macos/test。固定公共音频输入在 shared/test/fixtures/speech-audio，不作为生成结果删除。

单测仅收集 {shared,windows,macos}/test/{unit,renderer}/**/*.test.{ts,tsx}，不扫描历史快照或生成探针。依赖仅安装在当前平台，源码测试的 CommonJS require 使用当前平台 NODE_PATH。根命令由平台转发，另一平台目录只读；不在那里安装依赖、生成配置或运行产物。

保留的 Mac 专项源码包括 audio-native-smoke.mjs、window-native-smoke.mjs、launcher-smoke.mjs、screen-permission-smoke.mjs、icons-smoke.mjs。SF Symbols 现有 46 个映射；原生资源检查和合成 UI 不能替代真实账户、硬件或原生视觉验收。屏幕权限检查不自动申请新授权或修改 TCC。

所有后续获准测试使用合成账户/文档/设备或显式公共样本，不读取真实凭据、真人音频和用户资料。不得自动重启已取消的十分钟语音或退役 benchmark。在线漏洞审计需要单独明确元数据外发授权，历史一次授权不自动延续。
