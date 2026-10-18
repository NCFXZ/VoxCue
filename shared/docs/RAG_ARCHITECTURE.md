# VoxCue LanceDB RAG 架构

五阶段本地实现已接通；真实账户生成/工具能力、人工语义准确率、无答案拒答率及真人回答质量仍未验收。回归入口与范围见 [测试说明](../test/README.md)，不保留历史测试报告。退役实验不恢复执行，既有私有输入与源码恢复基线保留。

## 已实现的核心与进程边界

`shared/electron/backend/knowledge/host.ts` 是主进程的轻量端口，按需启动独立 utilityProcess。`process.ts` 串行调度、取消和过滤终止后的事件；`service.ts` 负责 LanceDB 与完整内容关系；`embedding.ts` 只使用本地 E5 q8 CPU，384 维、query/passage 前缀、mean pooling、L2 归一化。渲染进程不加载数据库、模型或本地文件接口。

KnowledgeService 接口：initialize、indexDocument、updateDocument、invalidateDocument、removeDocument、listDocuments、search、getItem、close。KnowledgeHost 实现同一端口。索引、搜索串行共享模型和数据库；取消等待队列或正在推理的请求会停止后续写入和结果发布，ONNX 单次原生推理本身在完成后检查取消。关闭释放模型和进程。

## 存储与失败恢复

数据库目录由主进程装配，正式接入使用沿用 userData 下的新独立版本目录，绝不写入 asar，不读取或迁移撤除方案遗留索引。知识库原件继续保存在现有 IndexedDB。

LanceDB 行只保存 chunkId、itemId、rootItemId、documentId、baseId、有界检索 text 和 vector。完整提取文本与知识条目在不可变 revision JSON 中保存；辅助检索片段不重复存整段答案。catalog.json 记录 schemaVersion、固定模型 revision、LanceDB 表名/精确版本，以及文档元数据和 revision 引用。文档元数据含文件名、类型、标题、内容哈希、时间、原件引用、知识单元和片段数。

更新先解析/Embedding、写新内容 revision，再使用 LanceDB mergeInsert 原子替换该 documentId 的行并重建原生 ICU FTS。最后将新表版本与内容引用写入临时 catalog、同步文件、保留旧 catalog 的独立备份并 rename 提交。读者只打开已提交 catalog 指定的 LanceDB 版本。崩溃留下的未提交数据版本不会进入查询；下次写入从已提交快照 restore 后再更新。没有假设跨文件/数据库事务，没有自动 vacuum 或删除旧版本。

删除只影响目标 documentId 的当前索引及 catalog 条目；LanceDB 历史版本和 catalog 备份用于恢复，不自动清理。备份恢复必须先关闭应用、保留现目录，再恢复同目录中的匹配 catalog 备份；不能只复制单个数据库文件或随意修改版本号。未知 Schema/模型版本、内容文件缺失和数据库损坏明确失败，不静默清空或重建。

## Q&A 与检索表示

解析保留主问题、答案、子追问、parentId/followUpIds、章节、行号及可用页码。代码围栏中的 Markdown 标题不作为边界。完整答案存储一次；超过模型长度的检索表示拆成辅助单元，每片带问题与父级 ID，使用实际 tokenizer 检查 ≤512 tokens。查询恢复完整主 Q&A 及关联追问，按 rootItemId 和完全相同内容去重。此策略解决覆盖和对应关系，不代表已经证明相关性提高；第五阶段需与旧策略对照。

沿用 benchmark：原生 BM25/ICU（关闭 stemming/stopwords/ascii folding，开启 lowercase）、精确 cosine、默认 RRF hybrid。默认 Top-K=10，最大 20；不比较不同模式的原始分数。短名单超取后按父级合并。没有引入 reranker 或大型 RAG 框架。

## 原件兼容与应用入口

原件 IndexedDB `copilot-local-documents` v1/bases/documents 不变。同名替换及简历替换前，旧原件备份到独立 `voxcue-original-backups` v1/versions；备份失败拒绝覆盖。替换前持久停用旧索引，失败、取消或重启均不再把它当作新原件证据。删除先移除目标索引，再删除目标原件，失败明确报错。历史原件需手动索引；新导入自动处理，`indexVersion=qa-linked-v2` 与模型 revision 分别记录。

KnowledgeCoordinator 管理任务与 Local/Function 设置；主窗口主 frame 经 `knowledge:call` 操作白名单访问，`knowledge:event` 反馈 queued/parsing/embedding/indexing/ready/failed/cancelled。每次最多 24 个受控请求，同文档不能并行导入。设置在 knowledge-v1/settings.json 原子替换并备份。页面与设置共享单一事件订阅，重载能恢复任务和取消 ID。

PDF 使用 pdf-parse 官方 worker，在独立进程内补充 Electron 缺失的 DOM 几何类型，只接受字节、禁用 eval；Q&A 跨页保留 page/endPage，普通文字保留页码。DOCX 使用 mammoth 提取原始文字，不执行 HTML。Markdown/TXT 使用 UTF-8，标题/自然段/代码围栏保留，明确问题标记建立父子关系。扫描 PDF 需要 OCR；损坏/加密/不支持格式明确失败。DOC/PPT/XLS 等仅保留原件。

原件备份可从 Electron DevTools IndexedDB 导出恢复，目前没有一键恢复 UI。知识核心由单一 Host 串行写入，未实现多个 VoxCue 进程并发写同目录的协调锁；支持关闭重开与独立只读 Lance 句柄。

## Local RAG 与上下文

准备聊天和最终确认的面试问题经 RagChatService → Hybrid Top-K 5 → 完整条目回取 → ragContext → 既有 ChatGPTService；ASR 临时事件不新增触发。记录标题继续使用原始 Provider，不读取知识库。上下文仅加入当前请求，不写回原聊天历史。简历优先用于个人经历，其他结果保持检索排名。

48 KB UTF-8 是保守字节预算，不是 GPT 精确 token 计数。完整 Q&A 超限整条省略并计数，不把截断正文称为完整答案。词面重合或独立 cosine ≥0.70 是当前候选过滤规则，尚无人工语义真值校准。资料以不可信 JSON 传入，开发者规则禁止执行文档指令、混拼来源指标或推测缺失个人事实；通用知识可回答并区分。提示和输入边界不能保证模型永不幻觉或抵抗所有提示注入。

## Function Calling RAG

现有 ChatGPTService 增加原生 streamWithTools，不增加另一套 OAuth 或付费 API。`voxcue_knowledge` namespace 提供 search_knowledge_base(query, topK, mode) 与 get_knowledge_item(itemId)，后者仅能读取本次搜索返回的 ID。strict schema/additionalProperties=false 之外仍进行运行时 JSON、字段、类型、模式、长度与 ID 校验。

按 output_index 拼接 arguments delta，按 call_id 回填；store:false/stream:true 手动保留当前请求必要的 output、加密 reasoning 与 function_call_output。私有 reasoning 不进入 Renderer/日志，只有真实公开摘要可显示。最多 6 次执行、4 轮响应，末轮禁用工具；查找 15 秒、累计本地工具处理 30 秒、整次响应会话 180 秒。完整条目最多 32 KB，工具总证据 48 KB，超限明确错误，取消阻断续轮及迟到事件。用量合计实际收到的每轮服务端 token。

设置默认 Local，Function 模式持久保存。能力初始未知，请求拒绝时明确失败并提示手动切回 Local，不暗中换 API。协议依据：[OAuth 预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[Function calling](https://developers.openai.com/api/docs/guides/function-calling)。文档允许 namespace 工具，但账户与模型仍受限制；当前真实账户尚未验通。

## 模型与隐私

公开模型固定 revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`。`pnpm download:rag` 显示约 129 MiB 下载说明，仅请求公开模型 URL，校验五个文件 SHA256；正常推理关闭远程模型访问。开发模型在 local-models/rag，Git 忽略。首次缺失时明确提示安装，不暗中下载，不转 Mock。

Local RAG 与 Function Calling 共用同一个 KnowledgePort 和数据库，复用现有 AIChatService；仅必要证据进入用户已选择的 AI 请求，禁止上传整库。工具参数不接受 SQL、路径或命令。知识内容是不可信数据，不能提升为系统指令。

Windows 便携包在 resources/models/rag 下携带模型；asar 解包知识/语音进程和运行依赖，按实际 hoisted 层级复制，保留不同 ONNX 版本并过滤其他平台原生产物。数据库只写 userData。复杂 PDF 阅读顺序、表格、公式、任意 Q&A 排版及跨机部署仍有验证限制。
