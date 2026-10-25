# Windows 0.5.11 验收与发行

日期：2026-10-25（Europe/London）。用户授权清理、完整测试、UI 视觉对齐、问题修复复测、上传 0.5.11 源码与 Windows 修复包并设 Latest，同时交给 Mac 审查。

比较基线：`4f5e84189b4f3adc6dbc0ea0decb6ce4d1809872`，分支 `main`。开始时已有本轮 ChatGPT 修复、对应单元/native smoke 和 PROGRESS 四项修改，全部保留。Mac 专属只读，167 个受保护的 Mac/依赖锁/固定原生与模型清单文件已有哈希基线。

## 实现与清理

- shared 版本升到 0.5.11，仅生成 root/Windows 配置；Mac 六份生成配置漂移留给其本机核对。
- ChatGPT 有效会话使用官方按需续期，不再每次强制远端刷新。额度请求省去未使用的 reset-credit 明细。详细根因、对照数据、Mac 待验项见 [Mac 交接](MACOS_0.5.11_HANDOFF.md)。
- Renderer/backend 的 noUnusedLocals/noUnusedParameters 均通过；已核对静态导入、平台动态装配及 Worker/preload/打包入口，未确认额外可删除业务源码。
- 精确路径、祖先/后代无重定向、无运行中该路径可执行文件及四个文件独占访问检查后，删除旧 windows/.cache/installer-ui：4 个可重建生成文件，181443 逻辑字节。当前源码、构建、依赖/锁、固定模型/运行时、正式历史发行、恢复基线及历史跳过目录均保留。新打包暂存会在验包/发行完成后再审计清理。

## 本轮检查结果

| 检查 | 当前结果与证据 |
| --- | --- |
| 类型 | Renderer/backend/contracts 通过。 |
| 架构 | 226 文件，0 边界违规，0 运行时环。 |
| 工作区 | root/Windows 生成配置同步，布局零违规；Mac 六份生成配置只读漂移报告。暂存树清理前后文件计数分别核对，不把生成文件数当作源码规模。 |
| 未使用声明 | Renderer/backend 两组通过，无需为清理制造源码删除。 |
| 构建 | Windows audio helper 原固定基线复用；shared+Windows Electron 和 660 Renderer 模块通过，保留既有 bundle 大小提示。 |
| 单元 | 87 文件，893 通过、2 既有平台条件跳过、0 失败。 |
| 完整功能/稳定性 | 45/45 一次完整通过，20 轮面试全部通过；600 秒固定公开双通道音频 finals=208、interim=1451、maxQueueMs=608、errors=[]，实际 600318ms。 |
| Windows 原生 | 15/15 通过：platform-native、interview-access/effort/layout/workflow/context、updates-native、user-data、speech-adversarial、AEC、WASAPI packets、electron-output、components-native、presentation-native、RAG；总用时约 120688ms。 |
| 五档 DPI | 100/125/150/175/200% × 14 组，70/70 通过，约 1117443ms。这是 Electron 受控缩放和真实 Windows 布局/窗口检查，不代表五块物理显示器。 |
| 截图真实命中 | 通过：浅深色下保存/关闭中心及四边、36px 点击区/17px 图标、HTCLIENT/no-drag、保存悬停排除；实际自有 Windows 系统保存对话框导出/取消及原图字节一致。 |
| 视觉目视复核 | 五档各 70 个界面状态、16 个 OAuth 回调变体均通过；350 张临时截图中逐档查看 20 张代表图，涵盖浅深色、正常/窄窗、登录、资料、设置、记录/知识库与面试展开/收起/结束确认，未发现新 UI 问题。窄窗回答栏沿用既有覆盖式布局。 |
| 正式包 | Windows 0.5.11 的 NSIS/SHA512/blockmap/载荷与 stage 一致；包内固定 Copilot stdio/ping、真实 ASAR Codex 停滞代理 153ms、Paraformer/VAD/Worker/AEC、E5/LanceDB/PDF/DOCX、组件卸载/删除/重下载、原生窗口及崩溃恢复通过。中/英/繁体安装/卸载 UI 六种组合、完成/取消/静默/键盘/前端崩溃/引擎失败通过；独立 GUID 的生产 NSIS 模板安装、交互/静默升级、卸载、默认保留数据及拒绝重定向通过。未替换真实安装。 |
| 公开发行 | v0.5.11 release ID 423566131 已发布并设 Latest，仅三项 Windows 资产。匿名完整下载三项 SHA256/SHA512、服务端摘要及清单均一致；最终 ASAR 的真实更新客户端选中并下载 386987324 字节安装器，SHA512 通过，未安装。Windows 选 0.5.11，Mac 仍选现有完整 0.5.9；其 0.5.11 包待本机审查。公开更新日志按用户要求仅两条可感知改进。 |
| Git 源码范围 | 仅本文末列出的 14 份生产/测试/版本配置/文档，同步目的地为既有私有 NCFXZ/VoxCue main；最终提交号与远端一致性由 Git 及对话回传，不将包、模型、缓存、截图或凭据纳入。 |

## 正式资产

| 文件 | GitHub asset ID | 字节数 | SHA256 |
| --- | --- | --- | --- |
| VoxCue-Setup-0.5.11-x64.exe | 675725086 | 386987324 | 516520c92cef7dac88a6c3c4920c6ffdbf77c453723523b8aa421ba0d6e4e1b7 |
| VoxCue-Setup-0.5.11-x64.exe.blockmap | 675725936 | 400926 | eee0e34699cdf727c6648f97530347a8da5db61c82cab7ec50e9b14b744bdc25 |
| latest.yml | 675725946 | 352 | 9a30f01592810092508e632621e2a8d8d5a48ffbe2c876700e89817c758c15f3 |

安装器 SHA512：`9vhQKG9IA0QVmcratlZujMZYsGp3xrAoMt00304h2ghn0NfFJXKDOLSyWcx4H7PZUHCpKgFAM11EKVIL0mJ7qA==`。0.5.10 与 0.5.11 的 Windows Authenticode 均为 NotSigned，未改变签名身份。正式三项保留 windows/release/0.5.11；重复暂存、350 张临时截图和辅助文件已清理，全部 167 个受保护文件哈希不变。其他现有 17 条发行的说明及资产 ID/大小/摘要保持。

## 结论边界

真实账户、真实资料、物理音频采样、系统 IME 候选窗、物理触控板、多显示器、新机器真实安装及可选 Qwen 完整 CPU/CUDA 推理未自动代验；相关组件/路由/保护仍参与既有单元与 UI 检查，不能称为完整 Qwen 真机推理通过。冻结的公开 RAG 题只评估，不按分数调生产参数；RAG 注入证据正确不等于真人最终答案准确率。Mac 本机 UI/原生/凭据/包签名待其接续，不由 Windows 结果代替。

此前认证定向阶段直接运行 interview-effort 因缺隔离模型而未完成；本轮由固定公开模型生命周期注入组件后，原脚本和断言通过，没有放宽开场组件保护或测试门槛。

0.5.10 保持非公开，不重建原发行。发布前管理员 API 复核发现原 release ID 423408483 已返回 404，列表也不再包含该草稿；本轮未执行旧发行删除。0.5.11 只上传核对后的 Windows EXE、blockmap、latest.yml 至既有公开 NCFXZ/VoxCue-releases；源码只推送核对后的清单到既有私有 NCFXZ/VoxCue main，不上传任何包、模型、原始测试产物或凭据。最终提交号和线上资产摘要以 Git/发布后核对为准，不为回填自身提交号再改源码。

## 本轮可复核入口

在 `windows/` 执行；桌面应解锁，GUI/原生串行。套件自行准备并校验公开临时模型，不借用真实账户或模型库。重复打包前保留需要的历史正式资产，不运行真实安装器。

```powershell
pnpm typecheck
pnpm check:architecture
pnpm check:workspace
node node_modules/typescript/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters
node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit --noUnusedLocals --noUnusedParameters
pnpm build
pnpm test
node test/scripts/windows-suite.mjs
node test/scripts/windows-suite.mjs --windows
node test/scripts/windows-suite.mjs --dpi
node ../shared/test/scripts/interview-screenshot-smoke.mjs --native-hits
node ../shared/test/scripts/chatgpt-usage-runtime-smoke.mjs
node scripts/package-installer.mjs
node test/scripts/installer-artifact-smoke.mjs
node test/scripts/portable-native-smoke.mjs --installer-stage
node test/scripts/installer-branding-smoke.mjs
node test/scripts/installer-engine-smoke.mjs
```

本轮额外的五档截图来自 `typography-smoke.mjs --screenshots=<本轮临时绝对目录>`，沿用同一隔离模型生命周期及 `VOXCUE_TEST_SCALE_FACTOR`。最后清理这些临时截图；不能链接已删除的图或将缩放后的图片本身当作 DPI 原生验证。

## 本次源码清单

```text
PROGRESS.md
README.md
package.json
shared/docs/WORKSPACE_CLEANUP.md
shared/docs/MACOS_0.5.11_CODEX_PROMPT.md
shared/docs/MACOS_0.5.11_HANDOFF.md
shared/docs/WINDOWS_0.5.11_VERIFICATION.md
shared/electron/backend/chat/codexUsage.ts
shared/package.json
shared/test/README.md
shared/test/scripts/chatgpt-usage-runtime-smoke.mjs
shared/test/unit/codex-usage-runtime.test.ts
windows/package.json
windows/test/scripts/package-runtimes-check.mjs
```
