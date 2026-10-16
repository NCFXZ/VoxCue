# 测试入口

所有测试源码、脚本和合成夹具位于本目录。shared包含通用业务/Renderer单测、Electron回归和共享夹具，windows包含Windows权限、原生鼠标、Copilot运行时、WASAPI/安装更新回归及平台夹具；Mac尚无真机测试时不创建空目录。共用UI回归接收可执行文件路径，由windows/scripts/installer-ui-smoke.mjs选择实际安装目录。生成结果、截图、隔离userData和恢复快照统一写入Git忽略的results/。

results保留必要报告/截图、最近结果、失败日志和恢复快照；验收后的便携副本、重复下载缓存和过期无引用合成目录可清理。原件、凭据、benchmark历史私有资料、正式发行与现用模型/依赖不作为测试垃圾删除，具体遵循根AGENTS.md。

从仓库根目录执行pnpm check:architecture、pnpm typecheck、pnpm test与pnpm build。需要窗口/IPC时运行相应pnpm test:*，保持独立userData；pnpm test:platform:native只加载真实Worker并枚举设备，不开始采样。测试使用合成账户/HTTP/SSE/资料，不能据此声称真实账户或语音质量验收。

完整功能回归的覆盖范围、命令和保留证据见[功能测试报告](../docs/FUNCTIONAL_TEST_REPORT.md)。资源争用导致文档解析超时时可用pnpm test --maxWorkers=2控制并发，保留原断言/时限和首次失败日志；不要通过放宽门槛或删除断言得到通过。

0.2.0本轮按用户最新要求不做10分钟语音测试，已停止且不计入42组功能验收。不要据历史测试报告或保留的可选命令推断本轮完成了长时语音验收。

构建、打包、模型下载和图标生成是生产工具，仍位于shared/scripts或windows/scripts。benchmarks/rag-engines是退役实验的历史资料，不属于现用测试套件，不运行或删除其私有原件。目录与旧路径映射见[工作区说明](../docs/WORKSPACE_LAYOUT.md)。
