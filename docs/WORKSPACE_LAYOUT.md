# 工作区目录与清理边界

更新：2026-10-16。当前整理与验证面向0.2.0；用户已授权通过完整测试后提交并推送私有源码，同时发布公开Windows安装包。既有历史分支与远端默认分支保留。

| 目录                                    | 内容                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| shared/src                              | 两平台共用React界面、Zustand状态、本机存储与受控服务                               |
| shared/electron                         | 主进程装配、窗口安全、业务协调、IPC、公开契约、账户/聊天/资料/更新、共享ASR Worker |
| shared/scripts                          | 开发启动、模型下载清单/脚本、图标转换                                              |
| windows/electron                        | Windows平台策略及WASAPI采集、权限预检、控制器、utilityProcess入口                  |
| windows/native                          | WasapiCapture.cs原生助手源码                                                       |
| windows/scripts                         | Windows助手编译、便携/安装包构建                                                   |
| windows/electron-builder.config.cjs     | 既有Windows x64 NSIS配置                                                           |
| macos/electron                          | 现有Apple Silicon平台策略；尚无Mac原生采集/完整移植/签名分发                       |
| test/shared/unit                        | 通用业务、契约、架构单测及编译期契约检查                                           |
| test/shared/renderer                    | 从共用Renderer源码旁迁出的单测                                                     |
| test/shared/scripts                     | 共用桌面smoke、架构检查、测试进程启动器                                            |
| test/shared/fixtures                    | 合成测试数据                                                                       |
| test/windows/unit、test/windows/scripts、test/windows/fixtures | Windows权限、WASAPI面试流程、原生鼠标、Copilot运行时、NSIS/便携/更新测试与平台夹具 |
| test/results                            | Git忽略的测试结果、截图、隔离userData、验证产物与恢复快照                          |
| benchmarks/rag-engines                  | 已退役的历史实验资料；无执行脚本或应用依赖，原件/私有样本/标注与派生数据原地保留   |

没有Mac真机测试时不创建空test/macos，也不添加未来音频实现。测试入口仅匹配test/{shared,windows,macos}/**/*.test.{ts,tsx}，不会执行test/results里的旧探针或快照。生产源码不得导入测试实现，两个平台专属实现不得互相依赖；仅main与平台选择入口装配平台代码，业务接收接口/参数。

0.2.0将依赖WASAPI预检、Windows官方Copilot运行时或.NET鼠标助手的6组回归及权限夹具移到test/windows。共用账号测试助手仅协调平台端口，Windows模拟语音实现在test/windows/fixtures。通用聊天进度、对抗与更新回归接收测试可执行文件参数；Windows安装目录与.exe命名只由test/windows/scripts/installer-ui-smoke.mjs选择。benchmarks整体Git忽略，历史私有原件保留，不进入源码提交。

## 根目录保留项

package.json、锁文件、TypeScript/Vite/Vitest配置、index.html、AGENTS/README/PROGRESS和Start-VoxCue.cmd仍是统一入口。public保存Logo原件及现有公共图标资源；node_modules、.pnpm-store、local-models、dist、dist-electron、native/bin与release维持既有用途和运行路径，不因整理源码而迁移真实数据、DLL、模型、凭据或已交付产物。

Windows助手仍输出native/bin/VoxCue.Audio.exe，安装后仍为resources/native/VoxCue.Audio.exe。只移动其C#源码。TypeScript产物在dist-electron中镜像shared/windows/macos，启动入口为dist-electron/shared/electron/main.js；preload紧邻main，页面从应用根dist/index.html加载。共享SpeechHost由main注入windows/electron/speech/process.js入口，专属控制器启动共享Worker，保持原取消/释放行为。

## 路径映射与恢复

- 原src/ → shared/src/；原electron/ → shared/electron/，其中平台策略和四个WASAPI模块分别归windows/electron与macos/electron。
- 原native/WasapiCapture.cs → windows/native/WasapiCapture.cs。
- 原scripts/按用途归shared/scripts、windows/scripts或test下对应平台scripts。
- 原tests/ → test/shared/unit，Windows权限检查归test/windows/unit；原Renderer旁的*.test迁入test/shared/renderer。
- 原test-results/ → test/results/，整个目录完整改名；内部历史报告和快照仍记录产生时路径。查看历史文档时，将旧前缀替换为新前缀；不改写历史数据文件或恢复快照。

完整逐文件映射、前态源码快照、迁移补丁、清理清单与回归日志在test/results/platform-folders-20261015。恢复只能按指定文件/逻辑块使用快照，不能整库reset/clean或覆盖无关工作。旧安装产物不包含本轮整理；开发使用当前根构建。

## test与benchmark

test验证功能正确性、错误/取消路径、架构和回归；benchmark用于比较耗时、吞吐、内存或效果，通常需要明确的数据集、环境和指标。当前benchmarks/rag-engines只是退役实验的数据留存，不能直接执行，也不能将旧代理指标当作当前语义准确率。日常验证只使用test/入口，不恢复旧实验。

本轮删除71个已被新路径产物替代的旧JS编译文件和10个生成空目录，移除旧源码空目录；242个原源码/配置/测试文件均有最终去向，没有删除功能模块或测试断言。引用图、额外noUnused和依赖核对未发现其他可安全删除的生产模块/依赖；依赖版本、锁文件、二进制素材和C#原字节保留。

隔离便携验证可使用windows/scripts/package-portable.mjs的--test-output=test/results/platform-layout-<标识>，输出限定在test/results，不覆盖现有release目录。test/windows/scripts/packaged-smoke.mjs的--test-package参数只接受该限定测试目录，用真实Worker/utilityProcess与合成资料验证，不安装或发布。

## 生成文件保留策略

test/results保留文档引用报告/必要截图、各组最近结果、失败诊断日志和迁移/恢复快照。过期无引用的合成测试目录、重复下载缓存和验收后便携测试副本可按清单清理，不因Git忽略或体积较大就删除原件/模型/依赖。

2026-10-15整理后的platform-layout-20261015便携副本已在验收后清理，验收报告与截图仍在test/results/portable-current-kD1Dco，源码迁移快照和日志仍在test/results/platform-folders-20261015。历史进度中该便携路径描述的是验证时状态，不是当前可用交付物；需要再次验证时从当前源码重新生成限定测试目录。正式release、根构建和真实数据保留。最近清理清单见test/results/workspace-tidy-20261015。
