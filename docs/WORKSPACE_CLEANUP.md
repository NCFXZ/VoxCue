# 工作区清理结果

日期：2026-10-13（Asia/Shanghai）。用户授权撤除旧知识库内容索引方案并清理废弃代码/文件；本轮没有实现替代方案。

## 删除与简化

- 移除旧检索后台、解析/Embedding/重排/NLI/语义证据实验，以及 Hybrid、Lite+ 应用路径、流式证据协议和公开契约。
- 移除主进程装配、preload/IPC、Renderer 服务、自动同步/轮询、状态/取消/重试/问答校正、参考来源 UI、模式菜单及单场知识库选择。聊天和面试直接调用现有 AIChatService。
- 删除对应下载、评测、冻结、原生/桌面测试脚本与夹具；封存题目直接删除，未读取、解密或评测。旧方案和专项报告从文档中撤除，AGENTS/README/ARCHITECTURE/HANDOFF/PROGRESS 整理为当前状态。
- 删除独立运行依赖 @huggingface/tokenizers、mammoth、onnxruntime-node、pdfjs-dist、sqlite-vec，更新锁文件。其余根依赖的锁定版本与清理前一致；安装日志显示移除 125 个依赖包，未运行依赖安装脚本。
- 删除仓库内 e5/minilm/nli/reranker 模型目录，保留 local-models/speech。旧便携输出和编译输出清除后重新生成，避免已删除源码的 JS 残留。
- 引用图确认旧 InterviewPage 和 historyExamples 无入口/消费者后删除；删除无消费者的麦克风适配函数、2 个图标导出、37 条废弃 CSS 规则及旧改名/图标生成/置顶/账户诊断脚本。当前图标生成脚本保留。
- 清除 631 个旧生成工件入口（日志、截图、隔离测试目录和旧源码快照等），保留本轮验证、源码恢复基线及现有公开语音夹具/本机 Electron 打包缓存。此前失败的结论在 PROGRESS 中保留，不将撤除功能计为质量修复。

清理前源码/文档/脚本清单中有 86 个文件已删除；该数字不包含独立删除的专项测试/夹具、模型与生成工件。具体初始删除清单、修改文件和旧工件清单在忽略的 test-results/workspace-cleanup-baseline 与 cleanup-removed-artifacts.json。

## 数据与行为兼容

知识库保留创建/重命名/删除、导入/拖放、同名替换、文档删除和 TXT/Markdown 有界预览。PDF/Office 原字节继续保存，界面明确仅支持文本预览。导入不解析、不加载模型、不触发后台同步；准备聊天/面试不读取知识库原件或自动附带简历。

没有读取、删除或迁移真实 userData、IndexedDB、凭据、简历、个人信息、记录或旧派生数据库。IndexedDB 名称 copilot-local-documents、版本 1、bases/documents stores 和按 baseId 读取原件的浏览器索引保持兼容。旧记录的未知附加字段原样保留，新增回归验证标题修改不改写旧回答。原音频不保存/上传、OAuth 与窗口保护范围不变。

新的请求契约不再接受旧功能字段；主进程保留窗口/输入校验、模型/effort 开场锁定和请求取消。运行中的旧应用窗口应正常退出后使用 Start-VoxCue.cmd 启动新构建。

## 验证

| 检查              | 结果                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 架构              | 88 文件，零越层依赖、零运行时循环，频道覆盖通过                                                                                                                                                                |
| TypeScript / 构建 | typecheck、build 通过；既有 Vite 大 chunk 提示保留                                                                                                                                                             |
| 单元测试          | 25 文件、150 项通过                                                                                                                                                                                            |
| 原件管理桌面检查  | 导入、同名替换、文本预览、PDF 原字节、重载、改名、删除确认及旧 IPC 撤除通过                                                                                                                                    |
| 保留功能桌面回归  | settings、interview:workflow、interview:access、interview:effort、history、composer、conversations:status、ui:alignment、electron、floating、login、chat-response、conversations、login:entry 共 14 组脚本通过 |
| 本地语音文件推理  | 19 个现有合成/公开音频案例通过；sherpa 1.13.8 / ORT 1.28.2，无录音/下载                                                                                                                                        |
| 新便携包          | 打包及启动通过；真实语音 Worker 加载模型、utilityProcess 返回 idle、助手路径通过；包内仅 speech 模型，无旧后台目录/IPC                                                                                         |

修改前沙箱基线为 42 文件/622 项：615 通过、7 失败，包含本机 HTTP 与临时文件 rename 的访问限制。本轮在正常本机权限、隔离目录下完成最终测试；对应功能撤除后删除其专用测试，不通过修改断言或降低门槛保留假通过。

便携检查首次因新测试执行上下文没有全局 require 而失败；仅修正脚本的 createRequire，未修改产品来绕过检查，复测通过。上述测试未使用真实账户、真实用户资料或真人采集，不能替代真人准确率、物理热插拔/权限撤销、新电脑/全部 DPI、真实摘要与标题质量验收。

结果日志：test-results/cleanup-{architecture,typecheck,test,build,knowledge,speech-model,package,package-test}.log，以及 cleanup-smoke-*.log。新的便携检查报告在 test-results/portable-current-390CO3/report.json。

当前分支 codex/speech-recognition，全部工作未提交/推送。等待用户新方案，保留现有语音、账户、聊天和记录功能。
