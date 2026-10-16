# Windows 功能回归报告

## 0.2.0：2026-10-16 本轮验证

对象为版本 0.2.0 的 main 工作树、重新构建的 Windows x64 应用和实际 NSIS installer-stage。基础检查通过：138 模块架构零越层/运行时环、Renderer/Electron/公开契约类型检查、46 文件 336 项单测、完整 Windows 构建；生产依赖审计 0 告警。42 组完整回归最终通过，范围如下。用户最新明确要求不做 10 分钟语音测试，已停止且不计入本轮验收；取消记录为 speech-soak-cancelled.json，不重新启动。发布状态以 PROGRESS 最新节为准。

| 范围 | 本轮验证 |
| --- | --- |
| 29 组桌面功能 | 登录/服务选择、输入/附件、Markdown/代码复制、会话保存/取消/未读、公开进度、设置/主题/字号/删除、资料提案、浮窗、权限/档位/上下文/自动回答、记录/导出、原件/RAG、更新及对抗场景 |
| 本轮面试展示与截图 | 7:10 面板宽度、固定各自宽高比和字号、放大显示更多文字、工具栏固定、隐藏转写/重载/收起保持尺寸、左右真实 Windows 鼠标拖动/镜像图标、提示不挤压面板、紧凑用时与分割线、开场三行对应排版；附题目截图、只发截图保留草稿、失败/取消/重试/模型能力和 IPC 校验 |
| 8 组原生功能 | 真正 Worker/utilityProcess/WASAPI 无采样预检、本地 E5/LanceDB 三模式/PDF/DOCX/重启、模型完整性、采集/Worker 故障释放与恢复、隔离 NSIS 0.1.0→0.2.0 安装升级保留数据、真正 NsisUpdater 损坏包拒绝及 600,421,158 字节当前包完整 SHA512 |
| 5 组实际安装包功能 | ASAR/原生组件/Paraformer/离线 RAG，官方 Copilot 运行时，更新保存握手与草稿/附件恢复，聊天公开进度，对抗场景 |

首次桌面测试有两处失败，日志完整保留。chat-response 仍等待已经移除的旧“正在等待服务响应”文案；改为检查现行真实阶段，并新增旧文案不存在的断言后完整重跑通过。缩放原生鼠标采样首次不足，未改实现或门槛，独立原样复测两次通过：每侧手势有 14–15 次原生尺寸更新，工具栏位置固定，拖动端点误差小于 3 DIP；放大后同字号实际可见字符从 302 增至 333。原失败不被成功日志覆盖，也不被宣称为永久消除所有系统负载影响。

证据目录为 test/results/release-v0.2.0：architecture/typecheck/unit/build.log、desktop-suites.json、test-chat-response-verified.log、test-interview-layout-recheck.log、test-interview-layout-verified.log、native-suites.json、packaged-suites.json、dependency-audit.json 和 artifact-audit.json。安装包版本/清单/大小/SHA512/可解码 blockmap 一致，ASAR 根目录仅生产运行资源，固定公开更新源正确；原 0.1.1 安装包哈希不变。

全部账户、AI 和权限事件使用隔离合成夹具；真实账户在线服务、真人语音质量按此前用户选择稍后验证，Mac 真机/原生音频/签名/安装未验收。测试不读取真实用户资料或凭据，不重启退役 benchmark。以下是历史 0.1.2 及此前验证记录。

## 历史完整回归

验证日期：2026-10-16（Asia/Shanghai）。对象为当前 main 工作树和重新构建的 Windows x64 应用，不是公开 v0.1.1 安装包。结果：43 个测试文件、315 项单测通过；36 组桌面/原生/便携包功能回归最终通过。真实账户服务、真人语音质量和 macOS 真机不在本次自动验收结论内。

后续同日发布：用户授权后已将同一功能版本提升为v0.1.2，补充六组实际打包/原生专项并公开发布三项Windows资产，服务端摘要/大小和清单下载核对通过；见PROGRESS最新发行记录及test/results/release-v0.1.2。本报告下方保留完整回归当时的构建与清理记录。

## 本轮修复

- 更新按钮引用了没有定义的 `.spin`。增加仅用于更新的旋转样式，检查、下载和准备更新共用；保持禁用按钮、状态文字和现有更新流程。新增实际 Electron 回归检查计算样式及跨帧旋转，覆盖浅/深主题、下载、检查结束移除图标，并遵循已有系统“减少动态效果”设置。修复前测试明确失败，最终通过。
- 修正目录整理遗漏的三个测试入口：资料和界面回归使用 Playwright 自动定位 Electron；隔离安装升级使用已安装 Electron 模块解析真实目录，去除错误的 `node_modules/shared/electron/dist`。
- 修正两个过时测试：知识库搜索控件按已存在的统一 14px 规则校验；字体检查的合成记录补齐现行转录 `time/source/startMs/endMs`，回答使用 `createdAt`。没有修改生产数据校验、减少断言或放宽超时。

生产改动仅限 UpdatesPanel 和其动画样式；六份测试脚本更新。与上一轮清理基线逐项核对，242 份源码/测试文件中 234 份原字节未变，8 份变化均在上述范围，没有缺失或额外变化。证据：[source-verification.json](../test/results/functional-20261015-697d9556/source-verification.json)。

## 基础检查

| 检查 | 结果 |
| --- | --- |
| `pnpm check:architecture` | 136 模块，0 越层、0 运行时环 |
| `pnpm typecheck` | Renderer、Electron、公开契约三组通过 |
| `pnpm test --maxWorkers=2` | 43 文件、315 项通过，原断言和时限保持 |
| `pnpm build` | Windows 原生助手及共享 Electron/Renderer 构建通过 |
| `git diff --check` | 通过 |

默认并发的首次 `pnpm test` 有两项 PDF/DOCX 解析超过原 5 秒时限；单独原样复测以及限制为两个 Worker 的完整复测均通过。首次沙箱构建无法读取配置的父目录，正常宿主权限构建通过。所有首次失败日志保留，不用重复成功结果覆盖。Vite 仍有既有大于 500kB 的 chunk 提示，本轮没有修改打包门槛。

## 桌面功能：27 组通过

以下命令均加 `pnpm` 前缀，使用隔离 userData。真实 main/preload/IPC/React/本机存储运行；账户、AI、授权结果、设备事件按脚本使用合成实现，不代表服务端账户验收。

| 功能 | 回归入口 |
| --- | --- |
| 启动、登录/退出、服务身份 | `test:electron`、`test:login`、`test:login:entry`、`test:copilot`、`test:provider:ui` |
| 输入、附件、Markdown、公开进度、会话持久化/取消/未读 | `test:composer`、`test:conversations`、`test:chat-response`、`test:chat:progress`、`test:conversations:status`、`test:chat:lifecycle` |
| 设置、主题、尺寸、布局、删除确认 | `test:settings`、`test:ui:alignment`、`test:ui:ux`、`test:ui:typography`、`test:delete:ui` |
| 个人资料、提案确认、保存失败恢复 | `test:profile:ui` |
| 浮窗、模型档位、上下文、开始/结束/权限 | `test:floating`、`test:interview:effort`、`test:interview:context`、`test:interview:workflow`、`test:interview:access` |
| 记录、定位、导出、标题 | `test:history` |
| 原件管理、真实本地知识检索 UI | `test:knowledge`、`test:rag:ui` |
| 更新动画、重试、下载、面试阻止安装、保存失败阻止重启、草稿/附件恢复 | `test:updates` |
| 异常、取消、持久化故障等对抗场景 | `test:adversarial` |

字体/布局检查覆盖 66 个浅深色、窄窗口、菜单/弹窗及浮窗状态，Renderer 错误为 0。初次知识库字体和非法测试记录失败保留在原日志，修正测试后的独立日志带 `-verified` 后缀。清单：[首次桌面结果](../test/results/functional-20261015-697d9556/desktop-suites.json)、[修正测试与原生结果](../test/results/functional-20261015-697d9556/native-and-repaired-suites.json)。

## 原生及打包功能：9 组通过

| 入口 | 实际验证 |
| --- | --- |
| `test:platform:native`、`test:interview:access:native` | 真正 Worker/utilityProcess/WASAPI 助手加载、两个设备枚举、权限和无采样预检；失效设备明确拒绝 |
| `test:rag:core` | 真正 E5/LanceDB/utilityProcess，关键词/向量/混合、PDF/DOCX、完整 QA/追问、重启和删除；仅合成文档 |
| `test:updates:native` | 真正 NsisUpdater，损坏包拒绝、600,425,395 字节既有安装包完整 SHA512；合成发行接口验证分平台选择和忽略 Mac-only Latest；没有安装正式应用 |
| `test:installer:upgrade` | 独立名称/应用 ID 的合成 NSIS 应用 0.1.0→0.2.0 实际安装升级，localStorage、IndexedDB 原件字节及设置文件保留，最后卸载测试应用 |
| `test:speech:reliability`、`test:speech:restart` | 真正 ASR Worker/系统回环，损坏模型及 Worker/采集进程崩溃释放、三轮暂停恢复及受控不连续事件；麦克风关闭，仅保存计数 |
| `test:speech:soak` | 600 秒双通道合成 PCM 按实时速率送入真正 ASR/VAD；累计处理 1,200,000ms 音频、177 终稿/1,548 临时事件、最大队列 800ms、错误 0，Worker 退出 |
| `packaged-smoke.mjs --test-package=…` | 当前隔离便携 ASAR、实际共享 Worker/Windows utilityProcess/助手/模型、受控音频解码及间隙重置、离线 RAG 三模式/PDF/DOCX/重启/删除；包内依赖门槛通过 |

原生证据：[更新](../test/results/updates-native-lR72ZR/report.json)、[安装升级](../test/results/nsis-upgrade-ZsqYJX/report.json)、[系统音频](../test/results/speech-restart-PaPHE0/result.json)、[10 分钟合成音频](../test/results/functional-20261015-697d9556/speech-soak-results.json)、[便携包](../test/results/portable-current-VNSxgj/report.json)。

## 保留范围及后续人工验证

- 用户选择真人语音稍后再测。因此未运行会采集真实麦克风的 `test:speech:devices`、`test:speech:desktop/package`；麦克风只做权限/设备初始化前预检。合成音频、系统回环和进程测试不能证明真人中英混说的准确率、延迟或数小时面试稳定性。
- 未用真实 ChatGPT/Copilot 账户完成浏览器授权和在线回答；现有自动测试仅证明相应合成协议/生命周期链路。没有读取真实用户凭据、资料、聊天或面试记录。
- 未运行退役 benchmark、语音质量/模型方案比较，未下载/切换模型；未进行 Mac 真机启动、原生采集、签名或安装验收。Mac 仅现有 Apple Silicon 策略/更新单测覆盖。
- 根构建已更新，最终 Renderer 为 `index-CQppk-fA.css` / `index-BpbaWPlB.js`。公开 v0.1.1 安装包保持原样，不包含本次动画修复；没有提交、推送或发布。
- 验收后移除五项可再生成副本：当前便携目录、NSIS 测试 stage/artifacts、两个更新 pending 下载缓存，共 9,031 文件、3,337,255,901 字节。便携报告所指测试包已经移除，不是可用交付物；报告/截图/日志/隔离资料/恢复基线保留。清单和逐项结果在本轮审计目录的 `cleanup-plan.json`、`cleanup-result.json`。

全部命令日志、测试前态及本轮清单：[test/results/functional-20261015-697d9556](../test/results/functional-20261015-697d9556)。
