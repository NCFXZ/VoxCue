# VoxCue RAG 验证报告

更新：2026-10-14。本轮五阶段实现与本地验证已完成。真实账户工具资格、检索语义准确率、真实 AI 最终回答质量与首字延迟仍未完成有效评估。模拟 Provider、来源定位代理指标均不计作真人质量验收。

2026-10-14清理补记：下述一次性实验脚本与旧独立工程已经退役，已有数据/结果原地保留；历史命令和路径仅作证据记录，不是当前执行入口。正式功能回归脚本继续保留，未重新进行模型/精度实验。

## 阶段与证据

| 阶段            | 本轮结果                                                                                             | 仍未证明                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1. 知识核心     | 真实 E5/LanceDB、三模式、完整 QA、版本提交、取消、重启/更新/删除通过                                 | 跨进程并发写同目录                                         |
| 2. 文档与 UI    | PDF/MD/TXT/DOCX、跨页 QA、代码/段落、原件备份、状态/取消/重试/强制重建、检索 UI 通过                 | 扫描 OCR、任意复杂文档排版                                 |
| 3. Local RAG    | 既有 AIChatService 前的检索/全文/预算/去重/不可信数据规则与模拟 Provider 链路通过                    | 真实模型事实正确性与抗注入效果                             |
| 4. Function RAG | namespace、流式参数、call_id、多轮回填、预算、取消、401/能力拒绝与模拟 HTTP/SSE 通过；两模式共用索引 | 当前真实账户/模型是否接受和正确使用工具                    |
| 5. 系统验收     | 31 文件 182 单测；类型/架构/构建；真实 Electron/asar 与本地性能、A/B/C 代理对照通过                  | 有效语义精度、无答案/错误项目率、真实 AI 质量/TTFT、新电脑 |

环境：Windows 11 Pro x64，AMD Ryzen 9 8945HS，约 32 GB RAM；开发 Node 24.19.0；Electron 38.8.6 / Node 22.22.0；LanceDB 0.40.0，Transformers.js 4.3.1，固定 E5 q8 CPU/384 维，4 个 intra-op 线程。

## A/B/C 候选策略

A 为原 benchmark 的原始完整 Q&A/检索文本。B 为完整问题 + TF-IDF 关键词 + 开头摘录摘要（纯本地抽取，未使用 LLM）；完整内容仍保留。C 为正式候选 qa-linked-v2：完整条目与带父级 ID 的辅助片段、自然段/代码保护与追问关联。

沿用同一 38 份已有 benchmark 派生语料、200 个已知唯一原问题与 200 个口语填充变体；读取旧语料和旧索引，新候选只写忽略的独立目录。原来 80 个待人工核验问题及标注文件未更改，也未作为有效真值。没有用最终语义评估集反复调参。

下表是“按提取过程已知的原文位置找回来源”，其他同样相关的条目没有标签。它不是语义 Hit/Recall/MRR，更不是最终回答准确率。C 同时改变 FTS 表示和结果分组，不能把差异只归因于向量切分。

| 策略 | 问题变体 | 来源 @1 | 来源 @3 | 来源 @5 | 来源 MRR@10 |
| ---- | -------- | ------: | ------: | ------: | ----------: |
| A    | 原问题   |   91.5% |   99.0% |   99.5% |      0.9527 |
| B    | 原问题   |   95.0% |   99.5% |  100.0% |      0.9721 |
| C    | 原问题   |   94.0% |   99.0% |  100.0% |      0.9672 |
| A    | 口语变体 |   91.5% |   99.5% |   99.5% |      0.9549 |
| B    | 口语变体 |   94.5% |  100.0% |  100.0% |      0.9692 |
| C    | 口语变体 |   95.5% |  100.0% |  100.0% |      0.9767 |

原策略有 290 条输入超过 512 tokens；B 最大 433 tokens，C 的 7,522 个辅助检索单元全部 ≤512。C 恢复了旧基线全部 3,726 个主 Q&A 的分类/位置，并额外保留追问关系；完整长答案与尾部回取有合成断言。B 比 C 的原问题来源 @1 高 1 个百分点，C 的口语变体更高，没有足够真值证明哪种语义准确率最好。当前保留 C 作为覆盖完整长答案的候选默认，B 留在研究脚本，不建立第二套产品知识库。

语义 Hit@1、Recall@3/5、MRR@10、nDCG@5、错误项目率、无答案误命中/拒答与真人答案质量：**未完成有效评估**。原待审核证据仍在 benchmarks/rag-engines/datasets/private/2026-10-13T09-30-18-829Z/REVIEW.md（本机忽略目录，勿提交）。合成无答案、故障与提示注入测试只证明边界/规则/取消逻辑，不证明模型绝不会幻觉。

## 正式 Electron 性能

独立 userData，真实 utilityProcess、E5 与 LanceDB；38 文档、7,522 单元；每种模式 60 次热查询，Top-K 5 / 超取 20，生产路径没有查询向量缓存。计时为 performance.now；P99 采用最近秩，小样本时等于 Max。进程冷，OS 文件缓存未清；同机开发活动可能影响结果。以下为第二轮，第一轮 Hybrid P95 14.15 ms、Local 预处理 P95 16.65 ms，说明它们不是所有机器必须达到的门槛。

| 项目（ms）       |  Mean |   P50 |   P95 |   P99 |   Max |
| ---------------- | ----: | ----: | ----: | ----: | ----: |
| 关键词完整查询   |  4.40 |  4.02 |  5.40 | 18.51 | 18.51 |
| 向量完整查询     | 12.38 | 12.32 | 13.33 | 13.48 | 13.48 |
| Hybrid 完整查询  | 12.60 | 12.60 | 13.70 | 14.59 | 14.59 |
| Local RAG 预处理 | 14.28 | 13.95 | 16.02 | 17.27 | 17.27 |

Local 预处理包括检索、完整内容回取、去重和上下文构建，结束于模拟 Provider 入口，**不含真实 GPT、网络或 ASR**。60 次共省略 1 个候选；上下文 P50 6,239 字节、最大 33,263 字节，预算 48 KB 是保守字节预算，不是精确模型 token 计数。

新 utility 启动/核心打开 660.94 ms，首次 Hybrid 查询 744.94 ms，合计 1405.88 ms。分项独立 utility：模块加载 514.56 ms、E5 初始化 656.06 ms、核心打开（含完整 revision）83.21 ms；另一个仅 Lance 句柄打开 2.05 ms。这些有缓存/边界差异，不应直接相加。

分项测量使用 30 个问题；纯 DB 为正式 shortlist 字段/Top-20，排除 Embedding、分组与 IPC；全文获取排除 IPC。索引/更新/删除为 20 个合成单 Q&A 文档的操作，不能当作全量库重建性能。

| 分项（ms）               |  Mean |   P50 |    P95 |    P99 |    Max |
| ------------------------ | ----: | ----: | -----: | -----: | -----: |
| Query Embedding          |  3.47 |  3.36 |   4.42 |   4.56 |   4.56 |
| 纯 DB Hybrid             |  8.07 |  8.00 |   8.83 |   8.84 |   8.84 |
| 完整条目获取             |  0.28 |  0.18 |   0.72 |   0.92 |   0.92 |
| 合成文档索引             | 44.85 | 42.44 |  48.27 |  68.58 |  68.58 |
| 合成文档更新             | 49.73 | 46.78 |  65.90 |  67.18 |  67.18 |
| 合成文档删除             | 41.14 | 32.92 |  68.17 |  69.14 |  69.14 |
| 两页合成 PDF 热解析      |  2.00 |  1.44 |   4.50 |   4.50 |   4.50 |
| 合成 DOCX 解析（含首次） | 23.29 |  1.28 | 222.47 | 222.47 | 222.47 |

两页 PDF 首次解析 226.47 ms。C 全量重建 180.41 秒，B 向量+索引 83.63 秒：都从已提取的 benchmark 文字开始，不包含原始 PDF 提取；C 还包括分片验证、逐文档提交和历史快照，两者构建方式不同。原 benchmark 完整 Hybrid P95 14.66 ms 只作参考；C 数据规模、父级去重、版本持久化及 IPC 边界已变化。

## 内存与存储成本

分别在新 utility 中加载同一 E5，然后执行同 60 个 Hybrid 问题，读取单次 RSS 样本；不是严格峰值/多轮内存统计。A/B 返回原始 Top-10，C 超取 20 后组织 Top-5 父条目并缓存完整 revision。

| 策略 | 模型加载后 RSS MiB | 查询后 RSS MiB | 观测增量 MiB | 索引目录 MiB |
| ---- | -----------------: | -------------: | -----------: | -----------: |
| A    |             393.51 |         518.73 |       125.22 |        11.66 |
| B    |             396.36 |         523.75 |       127.39 |        11.66 |
| C    |             398.79 |         538.69 |       139.89 |        57.25 |

C 的 57.25 MiB 包含约 46.14 MiB Lance 历史版本/FTS 和 10.71 MiB 完整内容 revision；A/B 单批索引为约 11.66 MiB，不能把不同保留历史策略伪装成相同存储口径。另一轮正式 Host 测量知识 utility 观测工作集约 551 MiB，未含完整 Renderer/ASR。没有通过删除备份、vacuum 或换大模型伪造更好结果。

## 功能、UI 与便携包

- 完整回归 31 文件、182 项通过；103 个源码模块的架构检查零越层/循环；TypeScript 和构建通过。构建仍有既有 Vite 大 chunk 提示，未放宽断言或门槛。
- 真实 E5/LanceDB/PDF/DOCX 三模式与 Local/Function 的本地链路，通过模拟 Provider/HTTP 测试；参数分片、多轮、未知工具、无结果/故障/超时、401/能力拒绝、取消与最终流式均有对应测试。
- 原件备份、索引停用后失败/重启、自然段代码块、跨页 QA、主窗口主 frame、订阅与迟到结果通过。一次 UI 异步快照竞态已修复：候选按自身 baseId 展示，状态列表读取期间变化则重新读取；新增一致性回归。
- 知识库 UI 最终通过：test-results/rag-ui-oRELWQ；原件管理：knowledge-files-eVvLGg；设置主题/持久化/响应式通过；面试工作流 12 项通过（interview-workflow-1791905590714，合成账户/设备，不是真人 ASR 质量）。
- asar 最终通过：test-results/portable-current-eZHoKv/report.json。真实语音 Worker/utility、WASAPI helper 存在、离线 E5/LanceDB、PDF/DOCX、三检索模式、完整 QA、重启与删除通过；登录正常，旧后端未恢复。
- 打包漏带 apache-arrow 运行时 peer 的问题已定位并修复：生产闭包包含 peer，按实际 hoisted 层级保留不同 ONNX 版本，知识进程/原生依赖解包。便携包约 1,724.69 MiB（含语音与 RAG 模型、原生依赖），asar 中没有旧 retrieval 后端。权重、包、测试资料与截图均 Git 忽略，未提交/推送/发布。

## 重现命令与原始结果

基础：pnpm check:architecture、pnpm typecheck、pnpm test、pnpm build。模型显式安装：pnpm download:rag；正式应用不需要 Python。

功能：pnpm test:rag:core、pnpm test:rag:ui、pnpm test:knowledge、pnpm test:settings、pnpm test:interview:workflow；便携：pnpm package:portable、pnpm test:package。

本机保留语料的研究命令：pnpm test:rag:strategy、pnpm test:rag:compact、pnpm test:rag:performance、pnpm test:rag:components；node scripts/rag-strategy-costs.mjs。它们依赖忽略的既有 benchmark 资料和生成索引，新 checkout 没有这些私有数据时不能宣称已运行。

本次原始结果（全部在忽略目录）：

- A/C：test-results/rag-strategy-2c3Y2K/result.json / raw.json
- B：test-results/rag-compact-3F3DHG/result.json / raw.json
- 正式 Host：test-results/rag-runtime-YchVZl/result.json
- 分项：test-results/rag-components-PpSVCv/result.json
- 成本：test-results/rag-costs-QF8sNp/result.json

## 尚未完成的评估与限制

真实账户授权/模型工具资格、无 RAG vs Local vs Function 的真实回答质量、服务端首字/完成时间和真实 Token 成本，均未验收；没有把固定模拟回答计作正确答案。现有 OAuth/刷新实现及回归保留，没有复制凭据、切换商业 API 或增加正式 Mock 入口。官方协议参考：[OAuth 预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[Function calling](https://developers.openai.com/api/docs/guides/function-calling)。

缺少人工语义标签，故不能量化所有相关答案、错误项目与无答案误命中。复杂 PDF 表格/公式/阅读顺序、扫描 OCR 和任意 Q&A 排版未完全支持；旧 Office 仅原件。大批量索引串行共享资源，查询/状态可能排队；超时明确失败，可取消/重试。多 VoxCue 进程并发写同目录、一键备份恢复、干净新电脑与全部 DPI/物理设备仍未完整验收。新电脑网络冷安装未验；本机离线锁文件安装及公共缓存复用已验证。

当前默认建议：LanceDB + Hybrid + Local RAG，先获得可控的本地证据；Function 是同核心的已实现选项，当前账户是否真实可用仍需正常授权会话验通。
