# Windows 1.2.3 更新后的 macOS 接续

本轮对应 Windows 1.2.3，商店包身份为 2.2.3.0；共享版本源 `shared/package.json` 为 1.2.3。已发行 Mac 仍为 1.2.2（`v1.2.2`），原资产与标签保留。Windows 工作期间 `macos/` 全树未修改，本文不是 Mac 原生、签名或安装验收记录。

接续先读 [AGENTS.md](../../AGENTS.md)、[PROGRESS.md](../../PROGRESS.md) 并核对当前 diff。下列共享修复直接随源码进入 Mac，不要复制成第二套平台实现。

## Windows 对齐已有 Mac 功能

| 本轮 Windows 改动 | Mac 1.2.2 已有实现 | Mac 处理 |
| --- | --- | --- |
| 面试音频中断后有界自动重连，沿用共享恢复状态、取消及退休生命周期 | `macos/electron/speech/controller.ts` 已启用 `automaticRestart` | 沿用现有 CoreAudio 适配器，不移植 WASAPI 或 HRESULT 分类 |
| 云账号、云同步与同源遥测采用系统代理和系统证书信任 | `macos/electron/accountNetwork.ts` 已使用 Electron `net.fetch`，在 `platform.ts` 注入现有端口 | 保持已有无 cookies、无缓存/来源、拒绝重定向策略，不需要再添加该功能 |

启动恢复上次 AI 服务连接、额度一致显示及生成期间查看网页来源沿用已有 1.2.2 基线，不列为本轮 Mac 新增功能。Windows 的采集尾段检查、设备 HRESULT、NSIS/APPX 及签名清单修复留在 Windows 适配层。

## 实际共享 Bug 修复

### 云端下载时保留知识库阅读位置

每次云端知识库或文件落盘都会通知当前页面刷新。原先即使仍查看同一个库，`open(selectedId)` 也先清空全部文档，滚动高度缩短后位置被夹回顶部；下载另一库同样会触发。

现在同库后台刷新保留当前文档行和操作错误，读取完成后再替换列表。读取请求版本与选择版本分开管理，后台刷新不再使当前库导入、删除或重命名失去归属；换库和关闭仍清理并隔离迟到结果。实现见 [knowledge store](../src/stores/knowledge.ts)，异步归属用例见 [store 回归](../test/renderer/stores/knowledge.test.ts)。

### 云端下载与后台扫描合并同一文档的索引请求

下载完成后的直接索引与打开库的修复扫描原先可能相遇：扫描在读取原件前保存旧索引快照，直接索引期间已完成，旧快照仍误报缺失。云恢复返回的对象还遗漏实际落盘的 `localRevision`，不能稳定合并同修订的在途任务。

恢复现在返回已提交原件的实际修订；扫描在读取 IndexedDB 或等待前一组后核对有效后端状态，提交确认会使此前开始的状态读取过期。由此避免重复搬运字节和重复提交 IPC。后端原有摘要快路仍在，不把此问题描述为必然重复向量推理；丢失或失效的索引仍能修复。

实现见 [云恢复](../src/services/cloudData.ts)、[原件事务](../src/services/knowledge.ts)、[索引协调](../src/stores/knowledgeIndex.ts)。回归见 [cloud-data](../test/unit/cloud-data.test.ts) 和 [knowledge-reconcile](../test/unit/knowledge-reconcile.test.ts)，包括共享旧在途状态响应的时序。

### 完整英文音频恢复与就绪原因

两路音频间断、输入/输出设备缺失使用完整句子翻译；暂停一路的“等待恢复”模板与内层原因分别翻译，避免恢复提示中英混排。用户自定义设备名保留原文。实现见 [uiMessages](../electron/contracts/uiMessages.ts)、[interviewReadiness](../src/services/interviewReadiness.ts) 和 [InterviewReadiness](../src/components/InterviewReadiness.tsx)。Windows 专属权限/HRESULT 文案不构成 Mac 新能力。

### 保留阻止恢复的停止失败状态

[共享 SpeechController](../electron/backend/speech/controller.ts) 的 `NativeCapture.stop(intent?: 'recover')` 和 `terminalError?: Error` 都为可选扩展。现有 Mac `stop()` 兼容，不要求增加 Windows 异常类型。自动恢复被旧采集停止失败阻断时，Mac 未提供已归属原生诊断就保留通用 `service` 停止失败；外层不再将其覆写为首次中断原因。

## Mac 本机接续验收

在 Mac 同步当前平台配置并使用原固定依赖、模型和签名身份，Windows 全树保持只读。执行类型、架构和相关单测后，按 [客户端测试说明](../test/README.md) 准备自有临时合成资料及固定公开资源，再串行执行：

```sh
cd macos
pnpm typecheck
pnpm check:architecture
pnpm build:shared
node ../shared/test/scripts/knowledge-smoke.mjs
node ../shared/test/scripts/language-smoke.mjs
```

- 知识库：在长列表中间阅读，分别完成当前库和另一库的分块下载，核对同一可视行、相对位置、DOM 行身份及最终内容；密集小文件每个只按预期顺序提交一次索引，缺失/失效索引仍能恢复。
- 归属与操作：刷新期间导入、删除和重命名仍正确完成；换库或关闭后迟到读写不覆盖新页面；读取失败保留原内容与对应错误。
- 英文与缩放：覆盖常用及分数缩放、窄窗、两路音频就绪状态和内嵌恢复原因，保留设备原名；复用知识库回归的严格位置与索引断言。
- 原生生命周期：在自有受控夹具中验证断连恢复、手动停止/取消、旧进程未退的停止失败与错误保留；既有系统网络端口补绑定健全性核验即可。

本轮没有 Mac 本机通过或新 Mac 安装包声明。完成本机验收后再依据当轮授权签名和发行，保留既有 Mac 与 Windows 正式资产及恢复原件。
