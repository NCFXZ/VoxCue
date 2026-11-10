# VoxCue 1.0.0 → 1.1.0：macOS 逐项更新与测试交接

更新日期：2026-11-10。本文件列出从正式 1.0.0 到最终 1.1.0 的净变化、测试步骤及预期，不保存测试成绩。Windows 发行输入与渠道状态见 `WINDOWS_1.1.0_RELEASE.md`；该文件将随最终发布补齐。Windows 上 `macos/` 全树保持只读，下列 Mac 动作均由 Mac 本机执行。

## 基线和使用方法

- Windows 1.0.0 的安装输入为 `a47f7435ef7c233eee9da87a18261162dfaee65f`；Mac 1.0.0 为 `f6e06e3f62395c0d6b78bafdfceabb347c91ac27`。1.1.0 开发基线为合并两端 1.0.2 的 `a8357b2c92374ef1383c2174538587bc43e01521`，保留其后的 Mac 原生维护。
- 下表 M068–M142 完整承接 1.0.0 之后引入的修改，沿用稳定编号；其中的“1.0.2”指引入版本，不是本次目标。M143 起为 1.1.0 新变化及最终要求，后项明确替代旧描述时以后项为准。此前 `RELEASE_1.1.0_BETA1.md` 仅是中间快照，旧快捷键、换行和冲突策略已被本表替代。
- 1.0.1 仅维护 Windows Store 发布者显示名及版本元数据，无独立新增的 Mac 产品行为。Mac 可直接从 1.0.0 验证升级到 1.1.0；已安装 1.0.2 时仍逐项回归继承行为。
- 旧 M104 的“麦克风不触发自动发送”限定于远程面试。新的仅转录模式以麦克风为问题来源；1800ms 音频截止、字面语气词过滤、手动发送、请求归属继续适用。
- 各项应在本机记录“待测／通过／失败／条件不足”，结果只在终端或对话报告。Windows 检查不构成 Mac 原生、签名、安装、权限、iPhone Safari 或真实账户／硬件验收。
- 只用 owner 合成资料和经固定来源／摘要认证的公开音频、模型；GUI、原生、推理串行且要求当前 UID 已登录并解锁。不读取真实凭据，不采样物理硬件，不改系统辅助功能、权限或签名身份。

## 继承的 1.0.0 → 1.0.2 变化（逐项保留）

下列 owning source 路径相对仓库根；Mac 专属已实现的内容仍须在本次最终包回归。旧包、原件、数据库／索引兼容和恢复基线保持，历史 OneDrive 占位目录不重试清理。

| ID | 变化及 owning source | Mac 操作与预期 |
| --- | --- | --- |
| M068 | `shared/package.json`；`shared/docs/RELEASE_1.0.1.md`；`windows/scripts/package-store.mjs`：1.0.1 仅把 Store PublisherDisplayName 从 `NCFX` 改为 `F. Zhu`，固定 Identity Name/Publisher 不变；共享版本为1.0.2。 | 本机直接同步最终共享 1.1.0 版本，不发布一个无额外 Mac 行为的中间包。不要把 Windows Store 的 `2.0.x.0` 身份映射、发布者或 AppUserModelID 移植到 Mac bundle/签名。 |
| M069 | `shared/package.json`、`shared/pnpm-workspace.yaml`：新增固定 `word-extractor@1.0.4`、`chardet@2.1.1`；旧依赖版本不借此升级。 | 在仓库根执行 `pnpm sync:workspace`，只生成根和 Mac 配置，再在 `macos/` 更新本机锁并安装。核对生成的 package/tsconfig/workspace 配置与新增依赖；不写 `windows/`，不在根或 shared 安装 node_modules。 |
| M070 | `shared/pnpm-workspace.yaml`、`shared/electron/backend/knowledge/legacyDocWorker.ts`：DOC 只用固定 OLE 内部入口，排除其未使用的 `saxes`/`yauzl`；DOCX 继续 Mammoth。 | 本机确认覆盖规则生效且所用内部 OLE 模块及其运行依赖完整。不删除 Mammoth 运行资源，不重新接入 word-extractor 的 OOXML 路径；依赖审计失败应在 owning source 定位，不能升级或放宽绕过。 |
| M071 | `windows/scripts/package-portable.mjs` 显式复制 `word-extractor`/`chardet`，此修改没有自动落入 Mac 打包器。`shared/electron/backend/knowledge/legacyDoc.ts` 通过相邻 `legacyDocWorker.js` 启动 Worker。`windows/test/scripts/packaged-smoke.mjs` 增加最终 ASAR 内真实 DOC、GB18030 TXT、UTF-16LE Markdown 的导入/精确文档检索/正文/重开持久化，保留原 PDF/DOCX/UTF-8 Markdown 验证。 | 检查本机打包器的实际依赖收集和编译输出，按必要最小修改纳入两依赖与 Worker。在本机包专项加入等价新样本，必须实际运行最终签名 ASAR/解包目录的 DOC Worker 和传统编码解析、检索及重开，不以依赖目录存在或开发环境通过代替。不能从 Windows 包复制原生依赖、EXE 夹具或整套 node_modules。 |
| M072 | `shared/electron/contracts/knowledge.ts`：`.pdf,.doc,.docx,.txt,.md` 是选择器与可索引扩展名的单一白名单，大小写不敏感。`services/knowledge.ts`、application、backend/parser 均使用该契约。 | 文件选择与拖放核对相同格式；再通过受控后台调用验证 PPT/PPTX/XLS/XLSX/ZIP/图片均拒绝。不得只改 accept 文案而保留另一条导入路径；不把重命名后的扩展名当作实际内容认证。 |
| M073 | `shared/src/services/knowledge.ts::validateFiles`：同批所有不支持文件按名称去重、保留选择顺序，合并为一条短提示；批次先限 20 个，每个展示文件名限制 240 字符。 | 混合支持项与多个不支持项，含重复名及超长名：预期完整列出本批不支持名称、顺序稳定且字符串有界。单文件仍用同一短模板；超过 20 个先给数量提示，避免无界名单。 |
| M074 | `services/knowledge.ts`、`stores/knowledge.ts`：整批格式/空文件/20 MiB 校验先于原件读取、备份、停用或索引。空选择静默返回。 | 用合成 Blob/File 证明拒绝批次不读取 arrayBuffer、不写支持项、不备份或覆盖旧原件、不提交索引。取消选择不出现错误。既有同名替换先备份、停用失败不覆盖的断言保留。 |
| M075 | `shared/src/stores/knowledgeIndex.ts`：既有不支持格式的原件在 index/reconcile 中跳过，不再自动生成格式失败任务。 | 升级前放入合成 PPT/XLS 原件，升级后仍可保留原件管理，打开库或全量 reconcile 不为其启动解析。禁止迁移、删除或批量改写真实旧资料；本轮不改变既有派生索引兼容。 |
| M076 | `services/knowledge.ts` 的 importing 互斥及 `stores/knowledge.ts` 的 busy：同一时间仅保存一批原件；`KnowledgePage.tsx` 禁用选择器并标记 aria-busy。 | 同时触发重复拖放/选择，预期只有一批保存，其他请求明确忙碌；成功、异常后均可再次导入。保留“先保存原件，再异步索引”的状态区分，不把本地保存完成当作可检索。 |
| M077 | `shared/electron/application/knowledge.ts`：后台最多保留 2 个导入请求，合计最多 40 MiB，单请求仍最多 20 MiB；超额在解析/排队前拒绝，finally 释放容量。 | 用延迟的合成 KnowledgePort 占满容量，验证第三项和超字节请求立即拒绝；完成、失败和取消后容量恢复。保留相同文档互斥、请求归属及面试期间拒绝启动索引的守卫；不把 Renderer 忙碌按钮当作后台背压。 |
| M078 | `shared/electron/backend/knowledge/parser.ts`、`legacyDocWorker.ts`：新增 Word 97–2003 OLE DOC 文字提取，保留正文、表格文字、正文文本框、脚注/尾注；不保留分页或原排版。 | 用独立合成 DOC 覆盖中英文、表格、0Table/1Table 与压缩/Unicode pieces，进入真实本机索引并按内容检索；验证 DOCX/HTML/RTF 改 `.doc` 后拒绝。既有 DOCX 用 Mammoth，不改解析责任。 |
| M079 | `legacyDocWorker.ts`：读取依赖前校验 CFB/FAT/miniFAT/DIFAT、分配链、流长度及 FIB/CLX/PCD/书签/页眉元数据；目录类型/指针/UTF-16名称长度及终止校验，迭代遍历拒绝循环、重复引用、空slot/越界，组合深度最多128。拒绝加密和不能可靠映射的压缩字符。 | 执行 `legacy-doc.test.ts` 中循环链、目录DAG/循环/深链/伪长名称、截断、伪装、加密、超大分配及异常字符合成用例，并验证正常嵌套storage；明确失败、原输入不变、后续正常解析仍可用。新增目录守卫防止依赖递归膨胀和字符串放大；不能为兼容坏文件跳过边界或静默插入 `undefined`/乱码。 |
| M080 | `shared/electron/backend/knowledge/legacyDoc.ts`：DOC 独立 Worker 限堆内存，15 秒超时终止，输入 20 MiB/输出 800 万字符限制；stdout/stderr 丢弃。 | Mac 本机验证 Worker 路径/退出可用、异常和超时后不挂住 utilityProcess、不泄漏文档到日志。原件仅以字节输入，不执行宏、不启动 Office、不读取任意路径/URL，也不落盘解析中间文件。 |
| M081 | `shared/electron/backend/knowledge/textEncoding.ts`：优先严格 UTF-8/ASCII/BOM，支持 UTF-16LE/BE BOM；无 BOM 仅在明显 ASCII/NUL 字节序特征时推断 UTF-16。 | 跑 `text-encoding.test.ts` 的两种字节序、BOM/无 BOM、中英文和 Markdown。纯中文短无 BOM UTF-16 不得被强猜；UTF-32 不能因前缀相同而误当 UTF-16。原始文件字节保持。 |
| M082 | 同上：严格 Unicode 失败后 chardet 最多探测前 64 KiB，仅接受高置信且与第二候选有足够差距的 GB18030/GBK、Big5 或 Windows-1252，再严格解码完整文件。 | 各编码正例进入实际索引/检索；歧义短文本明确提示“另存为 UTF-8”，不把 Windows-1252 当任意字节回退。样本后放损坏字节，必须整文件拒绝，不能仅验证探测窗口。 |
| M083 | 同上：拒绝 NUL、危险控制字符、空白、截断 Unicode、二进制伪装和超过 800 万字符输出。 | 保留公开合成字节边界单测，确认失败提示可翻译且不泄漏文件内容。新增编码支持不是放宽二进制校验；大文件拒绝前后的资源释放需本机验证。 |
| M084 | `shared/electron/backend/knowledge/parser.ts`：PDF 保持文字提取，不接 OCR；无文字提示为“PDF 未提取到文字。”，其他 PDF/DOC/DOCX 通用失败分别用短格式名提示。 | 合成可提取 PDF 成功并保留页码/引用；扫描式空文字 PDF 明确失败且不发 OCR/网络请求。加密/损坏 PDF 和 DOCX 失败原件仍在，不把空输出或页图当可索引文字；没有承诺所有 Word/PDF 都能解析。 |
| M085 | `service.ts`、`chunks.ts`、`types.ts`、IndexedDB 相关服务：索引版本、模型版本、RAG 分块/排序/阈值、数据库 Schema 与原件备份机制保持。 | 用本机旧版本合成库升级打开、新旧同名替换、原件导出和引用检索回归；不靠重建全部真实库掩盖兼容问题，不改模型/检索策略。文本提取不等于原排版预览。 |
| M086 | `shared/src/components/KnowledgePage.tsx`、`styles.css`：错误合入“大小 · 索引失败: 正文”同一状态行，换行与冒号后正文起点对齐；非失败任务不显示旧 error。 | 中英文、浅深主题、窄窗口、长文件名与多行错误核对悬挂对齐、字号和可读性；错误正文不再另起一条红色行。独立真实任务 phase 保持，不通过清错误隐藏失败。 |
| M087 | `shared/electron/contracts/uiMessages.ts`、knowledge application/backend/services：精简解析、存储、组件、超时和过长文本等提示并同步英文。 | 执行 ui-language 与 knowledge 错误分支；精简只影响显示，不吞掉错误分类或改成成功。路径/凭据泄漏过滤继续生效，未知错误仍用安全短提示；用户文件名和正文保留。 |
| M088 | `shared/src/stores/knowledge.ts`：导入/删除错误绑定 selectedId 与 documentRequest，关闭、切换、同库重开后清空；旧请求迟到不得回填新视图。 | A 库导入延迟失败→关闭/打开 B 或重开 A，预期旧提示不复活；删除 A 完成时不能关闭后来打开的 B。重复打开仅最后列表响应生效；这包括测试中发现的同 ID 重开归属问题。 |
| M089 | `KnowledgePage.tsx`、`stores/knowledge.ts`、`styles.css`：下一批错误替换上一批；详情顶部提示用卡片圆角和搜索清除样式 X，可手动关闭，与多行正文整块居中。 | 连续两批多文件错误不累积；点 X 后仅清提示，原件列表及文件任务失败状态保持。检查 aria-label、键盘激活与中英长文，关闭库再开不带旧提示。 |
| M090 | `stores/knowledge.ts`、`KnowledgePage.tsx`：创建/重命名单独用 editorError，打开、取消或保存重命名保留详情导入错误；列表读取失败不误报创建成功。 | 先制造详情导入错误，再打开/取消/保存/失败重命名，确认原提示保留且编辑器只显示编辑错误；创建后列表读取失败留在编辑器。重复创建/忙碌不能写两份，删除失败返回 false，不让确认按钮误判完成。 |
| M091 | `shared/src/stores/knowledgeIndex.ts`：dismissError 递增 errorVersion，refresh/reconcile 及排队扫描绑定错误代次，关闭/切换后旧失败不能重新出现。 | 延迟 status、全量扫描及等待全量后执行的分库扫描，关闭提示/切库后再释放失败，预期无旧错误；随后新请求失败仍正常显示。保留任务事件比迟到状态快照新的优先级。 |
| M092 | `KnowledgePage.tsx` 的 phase 标签、`services/knowledgeIndex.ts`、`uiMessages.ts`：任务与已持久化文档状态均走翻译；上传文案只列 PDF、Word、TXT、Markdown，限制说明末尾无句号。 | 实际英文界面检查 ready/failed/cancelled/disabled/unindexed 及上传区，无中文状态泄漏；选择器与文案和 M072 同源边界一致。保留保存中与索引中/完成的实际状态区别。 |
| M093 | `shared/src/components/SyncBadge.tsx`：从悬停展开改为点击切换；点外部、Escape 或 Tab 移出关闭，Escape 返回触发按钮。`shared/test/scripts/cloud-account-smoke.mjs` 修正旧hover开菜单预期：先明确悬停200ms仍关闭，再按aria-expanded为false时click打开，避免把已开菜单再次toggle关闭；产品代码不因此改变。 | 用合成各状态在知识库、文档和其他既有消费者复核并执行本机cloud-account回归：悬停不展开、再次点收起；菜单在dialog内走原portal，不能误触底层行/关闭详情。保留键盘/Escape回焦、云端删除/恢复/暂停、原数据/状态及宽度几何断言，不能只修触发动作后跳过后续检查；Windows运行不代替Mac验收。 |
| M094 | `SyncBadge.tsx`、`shared/src/components/ui/dropdown-motion.ts`：复用 dropdown 表面/圆角及纵向展开、退出动画，通用工具兼容自有 positioner。 | 中英浅深、近窗口顶/底/侧边、滚动/resize、快速开关和卸载时核对定位；退出副本不残留或挡点击，减少动态效果立即降级。其他 Radix 下拉菜单动画不能回归。 |
| M095 | 同上、`styles.css`：首次测量固定外框宽度，入场期间抑制内部删除确认按钮初始宽度过渡，内容变化时重新校准位置。 | 慢动作核对首次弹出不左右回跳、不先展一宽再缩窄；确认/取消时保留后续按钮反馈。不是关闭全部动画来掩盖测量问题；顶部/底部翻向仍贴合触发器。 |
| M096 | `SyncBadge.tsx`、`ui/confirm-delete-button.tsx`、`styles.css`：状态/说明左对齐，底部操作占满；两项各有足够半宽时等宽并排，否则各占一行；删除胶囊用普通/确认较宽下限固定宽度，重试/冲突操作补图标。 | 中英、长说明、窄窗口核对按钮完整、无裁切；确认/取消/忙碌不伸缩且保留原危险动作二次确认。其他消费者未 opt-in fixedWidth 时沿用原宽度行为。图标由现有 Mac 适配器提供，不自行重做状态图形。 |
| M097 | `shared/src/services/cloudSync.ts::emit`：分组优先显示 deleting/pausing/syncing，全部结束后汇总 conflict/error；库 metadata 先完成不等于子文件全部已同步。 | 合成多文件增量上传、冷恢复、部分失败并继续同步/删除，活动库始终有正确操作入口，结束后不能隐藏错误。核对过时/缺失文件 mark 不导致无工作却永久转圈，进度乱序不提前显示已同步。 |
| M098 | `cloudSync.ts::loadSources/one`：本地快照在 await list 前绑定 dataEpoch，单项入口和读取/摘要后复核 sourceEpoch；旧快照不能按新代次回写 synced 或推断删除。 | 按 `cloud-sync.test.ts` 的合成延迟 list/blob 情景，快照后编辑或重建文件；旧字节不得标已同步，旧缺席不得删除云端新内容。验证后续重跑确实上传新 hash，而非只隐藏错误图标。 |
| M099 | `cloudSync.ts::dirty`：运行中编辑设置 pending 合并重跑；error/conflict 在失败冷却中保留。 | 多库、多文件队列中插入编辑，预期重新读取当前快照且不丢新 key；未变库不永久停 unsynced。保留 retry-after、容量刷新节流和失败冷却，不因轮询/dirty 高频擦除错误或重试风暴。 |
| M100 | `cloudSync.ts` 的 exclusive/pending、suppressed 及既有 `stores/cloudSync.ts` 控制保持。 | 在上传/下载、编辑重跑期间取消、删除库，确认优先控制仍执行；暂停/删除云端后新加入子文件不被重跑自动重新上传，重启仍暂停。恢复须显式用户操作，保留本地内容与分类开关优先级。 |
| M101 | `shared/src/services/speech.ts::isAutomaticQuestionFiller`：仅对整段批准词组匹配，NFKC 后忽略空白/标点，允许重复组合。词表为 `嗯 呃 额 唔 啊 哦 噢 喔 诶 欸 哎 唉 好 好的 对 对的 是的 行 明白 了解`。 | 纯词及“嗯？/好的？”均不自动发送；“嗯好的/哦好的”可组合匹配。`那个/这个/就是/然后/怎么说呢`、`谢谢/谢谢您`不擅自扩大到名单；“然后呢/为什么呢/行吗/嗯，为什么”有正文，照常发送。不得做单字集合、长度或话题分类。 |
| M102 | `shared/src/stores/interview.ts::submitTranscript`：仅 automatic 路径过滤；自动读取 QuestionBuffer 的系统终稿，手动保留 edited/draft/interim 逻辑。 | 合成“旧 interim=嗯、迟到 final=有效问题、音频进度已过截止”场景，实际问题须发送一次，不能按旧草稿误拦。手动纯词发送一次，保留答案与 sourceTranscriptIds；截图及手动编辑现有路径不受影响。 |
| M103 | 同上：纯回应只取消本次 gate 截止并清 automaticQuestionReady，不 consume/clear 缓冲、不加 submittedInterim。 | 过滤后原始转写/草稿仍可见，手动可发；后续有效正文与原文正常合并。重复终稿、后续 progress、生成 finally、换模型 finally 不复活旧自动请求；Qwen continuationOf 的有效追问不被误杀。 |
| M104 | `AutomaticQuestionGate`、`QuestionBuffer`、`interview.ts`：既有 1800ms 静音、系统源、真实 ACK 积压守卫、忙时排队及取消继续生效；不恢复已撤销的两阶段用量优化。 | 执行 `automatic-question.test.ts`、`interview-usage-offline.test.ts` 与 `interview-usage-smoke.mjs`：纯词自动 provider 请求 0/手动 1，有效问题 1；回答中和模型切换中就绪的纯词仍 0。保留麦克风不触发、1800ms不足/积压不能靠墙钟放行、迟到有效追问一次提交断言。 |
| M105 | `shared/test/fixtures/interview-real-audio-process.cjs`；`windows/test/scripts/interview-real-audio-smoke.mjs`：测试 WAV 经 CaptureAdapter → 生产 Controller/Worker → renderer/store → 实际回答接口计数，未伪造 ASR 回调。 | Windows 主脚本目前有 Windows 平台断言、echoCancellation 路径和 Qwen EXE 配置，**不能原样在 Mac 执行**。在 Mac 专属测试入口装配本机预处理器/运行时与音频生成或固定公开 WAV，复用共享 Controller 协议；不加正式 Mock 入口，不把 direct Worker+人工 audio-progress 当全链路。 |
| M106 | 同一真实音频夹具：模型目录先按当前 catalog 全摘要认证，再独立复制到 owner 临时目录；start 只就绪，真实 running 且 model/device 匹配后才播放 PCM；固定采样时钟与有界队列背压。 | 本机各覆盖 Paraformer/Qwen，明确设备与本机能力，不直接复制 Windows cache/runtime。音频 16 kHz mono，尾部注入真实零 PCM 静音，等待真实 ACK 的 pending=false 和 processedThrough 通过原 silenceStartMs+1800；不以 stop/limit/sentence final、空转写或只等墙钟判通过。 |
| M107 | `windows/test/scripts/filler-audio-fixtures.mjs`：Windows OneCore SAPI 在 owner 临时目录生成非零 PCM16 WAV，含“好的。”、其他纯词、正常/混合/短追问；明确为 TTS 波形。 | 不在 Mac 移植 SAPI/PowerShell、修改系统策略或采样硬件。准备来源可核验的本机 TTS/公开音频，并先断言实际非空 system final/reason=silence 及实际文本属于批准词表，再判纯词 0 请求；词表外误识别、空白或缺少有效 final 必须报告未覆盖，不能记作过滤成功。 |
| M108 | `shared/src/stores/chatConnection.ts`、`Sidebar.tsx`：增加 usageLoaded；仅当前连接初读显示“正在读取 AI 服务用量…”，后台正常刷新保留上次快照与颜色，成功替换、失败正常报错。 | 用延迟合成 RPC 验证后台 RPC 已启动而侧栏仍显示旧百分比、无重复读取提示；设置页仍有其原 aria-busy/骨架。首次成功返回 null 或失败也结束初读；失败后的重试继续显示错误，不能伪造 0% 或永久加载。 |
| M109 | `chatConnection.ts`：generation/usageRevision 归属保护断开、切换、监听退出及迟到 load.finally；load 开始捕获 revision，过期链不再发起额外用量读取。 | deferred chatModels → watch start/stop → models resolve，退出后不能复活请求或回填 usageLoaded；新连接完成模型加载仍正常读取。并发 refresh 只读一次，焦点/定时刷新释放，旧账户结果不得写入新账户。 |
| M110 | `Sidebar.tsx`、既有 `accountUsageSummary.ts`/`AccountUsageSummary.tsx`/样式：后台保留结果不改变单周期一行、双周期任低于 20% 展两行、只有低百分比标黄等规则。Mac 1.0.0 已将 `.is-inline` 账号卡片纳入网格，避免英文边缘裁切。 | 延迟刷新期间与成功后分别检查单周期 0/19/20/71、双周期高低组合、中英浅深及最小窗口。合并必须保留已发行 `.is-inline` 网格，不退回旧flex；保持230px侧栏、字号、邮箱对齐、头像居中，20% 不黄、0%不当缺失。新预期不得回退成后台刷新隐藏旧值。 |
| M111 | `shared/src/components/ComponentsPanel.tsx`、`styles.css`：首次状态未知用两组/三行骨架占位，复用额度扫光；aria-busy 与 sr-only status 保留；读取错误结束占位并显示错误/重试。 | 本机延迟 components RPC，检查语音两行、RAG一行，中英浅深、减少动态效果和窄容器。真实状态替换后无残留占位，失败不永久扫光；不为骨架伪造组件状态或下载进度。 |
| M112 | `ComponentsNotice.tsx`、`styles.css`、`uiMessages.ts`：准备页提示沿聊天内容居中、最大 740px；缺失语音统一类别“语音识别”，副标题“{组件名}组件未下载，请在设置中下载或查看进度”。`windows/test/scripts/components-check.mjs` 修正旧轻量模型精确文案，改匹配“语音识别、知识库检索组件未下载，请在设置中下载或查看进度”，仅更新夹具预期。 | 分别缺 speech/qwen/rag、多组件及既有 CPU 警告，确认名称去重不误写轻量模型；准备页居中且长文可换行，其他窄消费者布局保持。Mac本机对应组件/启动回归须核对该通用准确文案及英文，不直接运行Windows专属入口；顶部提示变化不得遮住首条消息或影响composer固定位置。 |
| M113 | `shared/src/components/DownloadButton.tsx`：首次 layout 同步写实际 idle/cancel CSS 宽度，再让父 ActionTransition 测量；避免回退宽度与子级动画叠加回跳。 | 组件下载各语言/标签长度核对首次出现、进度、hover/cancel 的宽度连续；保留一秒取消保护、aria-disabled 及 iconOnly 行为。减少动态效果保持，不能删掉后续动画或加固定英文宽度掩盖问题。 |
| M114 | `shared/src/components/PreparationPage.tsx`：仅会话 ID 切换时，中间 `.chat-thread/.welcome` 使用共享 motion 参数淡入上移；顶部 toolbar/notice 和底部 composer 不参与。 | 新对话↔历史A↔历史B、欢迎页核对固定区几何不动；首次载入、流式 delta、重命名不重播。快速切换取消旧动画；减少动态效果在启动及运行中改变时均清除动画，不留透明或 transform。 |
| M115 | `shared/src/components/useFollowScroll.ts`、`PreparationPage.tsx`：chat opt-in 按有效会话 ID 在本窗口运行期保存 top/following/hasNew；新会话默认底部，旧底部仍跟随新回复。 | 长 A 中段→短 B（会 clamp）→长 A 精确恢复，再长 B/欢迎页往返；A 原在底部且后台增长，回来仍最新。点击“返回最新”后保持后续跟随。无存储 Schema 改动，不承诺关闭窗口/重启后的阅读位置。 |
| M116 | 同上：实时 scroll 快照，不在 identity cleanup 读已换内容 DOM；syncLayout 读 live refs，忽略零高隐藏写回；新节点或隐藏恢复才恢复阅读位置。 | preparation route 常驻 hidden 时切 knowledge/history 再回、隐藏期间切 ID、welcome ref 拆挂、notice和多行 composer 改高、侧栏/个人面板改变宽度均覆盖。快速 A–B–A 的迟到 scroll/ResizeObserver/rAF 不串 ID；不要拿 viewing（也受失焦/设置影响）当身份。 |
| M117 | `useFollowScroll.ts` 的 restoreNeeded：同 ID 可见且非跟随时，普通 delta/ResizeObserver 不再写旧缓存 top，保留滚轮/拖动刚发生但 scroll 事件未送达的位置。 | 有意保留 snapshot=1100、DOM 已为1250且延迟通知，再从实际合成 provider 送 delta，DOM不能回拉到1100；恢复正常 scroll 后切换再回来保存1250。该测试发现的竞态不能只靠静态设置内存或禁用流式更新绕过。 |
| M118 | `useFollowScroll.ts` 的 identities 剪枝与辅助 ref 释放；`FloatingInterview.tsx` 无 identity/未 opt-in。 | 删除访问过的聊天，立即剪除包含旧 messages/File 的 Map 条目；当前聊天删除到 welcome 时清 restored，null/零高时清 previousNode/restored。不得增加任意 LRU 丢掉有效聊天记忆；面试浮窗原滚动自动跟随语义不变，缓存不写磁盘。 |
| M119 | `shared/test/unit/{legacy-doc,text-encoding,knowledge-coordinator,knowledge-index-store,knowledge-reconcile,knowledge-parsing,cloud-sync,automatic-question,interview-usage-offline,account-usage-store,sidebar-usage,components-notice}.test.*` 及 renderer knowledge 单测覆盖本轮真实边界。 | 在本机实际执行完整类型/架构/单测，定向失败先按本文 owning source 修复。架构检查允许新增纯知识文件契约，但 Renderer 仍不得导入 backend/Node；保留取消、迟到、字节限额和去重断言，不跳过/放宽来凑通过。 |
| M120 | `shared/test/scripts/{knowledge,interview-usage,free-service,components-ui,typography}-smoke.mjs`、`rag-fixtures.cjs`：更新真实UI断言并生成合成DOC；`rag-reliability-smoke.mjs` 同步新的通用短错误。`cloud-account-smoke.mjs --preview` 修正滚动场景前提：600高窗口仅2份文档无溢出时标题遮罩透明是正确行为；在全部云端断言后的预览尾段，经真实UI追加6份owner合成TXT，等8行、原件加载及入场/布局稳定，确认真实overflow再滚动。 | Mac构建后按当前functional-suite --list执行完整原组，保留DOC/编码/错误归属、纯词0与手动1、用量保持、骨架/宽度等覆盖。定向预览须在本机重验真实溢出前提，再严格核对遮罩opacity、固定标题位置、滚动轨及clear原断言，不降低阈值、不改生产CSS来满足无溢出场景；临时视觉资料按owner结束清理，不以Windows预览代验Mac。 |
| M121 | `shared/test/scripts/check-architecture.mjs`、`shared/test/unit/architecture.test.ts`、`shared/docs/ARCHITECTURE.md`：新增契约纯函数与解析 Worker 边界，文档同步当前格式/编码、背压、同步快照及字面过滤。 | 核对本机生成配置包含新增源文件；执行架构/契约检查。旧“两阶段优化/2200ms/不分类”历史文字不能覆盖当前仅字面白名单和既有1800ms规则；不为测试增加正式入口或网络回退。 |
| M122 | 1.0.0 包后追加的 Store 隔离夹具修复，owning source 为 `windows/test/scripts/store-sandbox-smoke.mjs`、`store-artifact-smoke.mjs`，明细见旧表 M043–M061；1.0.1 继续沿用。 | Windows 专属，不运行/移植 Sandbox、WinPS、APPX/CDP身份注入或证书操作。旧表关于 UTF-8、完整诊断、真正运行时就绪、精确 owner 清理的原则仍用于 Mac 自身夹具；这些是测试修复，不能写成 Mac 产品行为或已验收状态。 |
| M123 | `macos` 本机签名、安装、原生音频/权限/更新 owning source 沿用 [旧清单](MACOS_1.0.0_HANDOFF.md)与 [Mac1.0.0基线](MACOS_1.0.0_RELEASE.md)。旧表M063/M065–M067的持续桌面守卫、原生测试唯一偏好域及真实lsof占用清理已纳入后续提交。 | 共享验证后补本轮本机原生、五档视觉、20轮面试与600秒音频长稳、固定签名和最终包验收；保留已发行/后续夹具修复，不能用旧Windows快照覆盖Mac树。未覆盖真实账户、硬件或原生隐藏恢复须明确说明，Windows0/1次请求或CPU运行不代验Mac。 |
| M124 | Windows GitHub 1.0.2已发布，最终源码/包输入、资产及各渠道状态由 [Windows发行索引](WINDOWS_1.0.2_RELEASE.md)及`PROGRESS.md`承接，公开产品说明见 [RELEASE_1.0.2](RELEASE_1.0.2.md)。 | 核对最终版本、commit、完整 Mac arm64 DMG/ZIP/签名清单及摘要，按匿名本平台完整稳定资产选择验证。Mac 1.1.0未完整发布前继续保留完整Mac 1.0.2资产；不因Windows新标签而选错平台，不把“打包/上传/提交认证”写成“已发布”。 |
| M125 | `shared/electron/backend/knowledge/host.ts`、`application/knowledge.ts`：取消只向utility发送cancel，不立即结算原请求；2份/40 MiB导入预算直到utility最终回应或确认进程exit才释放。取消后的迟到成功仍为cancelled，进度丢弃。 | 延迟实际后台解析，连续取消/快速再导入不能绕过请求数或字节背压；取消后不能显示ready或发布迟到成功。完成/失败/确认exit后才可重新占用预算，不能把发出cancel或UI结束当作真实资源已释放。 |
| M126 | `backend/knowledge/host.ts`：stop/timeout不把kill返回当退出；替代utility也等待旧exit。close整体20秒，unloadModel整体50秒（30秒卸载请求+20秒退出），等待旧退出再initialize为10秒期限；未确认exit明确unavailable并保留预算/阻止替代。`shared/test/scripts/knowledge-host-smoke.mjs` 相应改为验证迟到成功不能提前结算、等待真实exit才fork替代，不再期待超时后的旧进程继续回报取消。 | 用合成utility覆盖kill已返回但迟迟无exit、晚到exit及退出失败，确认不提前开第二进程、不误释放容量。运行真实utility边界回归，保留错误分类、取消时零provider与原15秒RAG期限；再本机验证正常退出/重建可用，超时明确失败而非无限挂起，不通过放宽deadline或假装exit解决。 |
| M127 | `backend/knowledge/{service,parser,legacyDoc}.ts`：AbortSignal经Service→parseDocument传DOC Worker；取消等待真实worker.terminate完成后结算。`process.ts` finally清input引用，Coordinator复核取消后的late success。 | 本机运行 `knowledge-host.test.ts`、`knowledge-coordinator.test.ts`、`legacy-doc.test.ts` 的延迟完成/取消/退出用例，再验证最终包DOC Worker取消与后续正常导入。PDF/DOCX仍等实际解析结束后释放预算，不宣称可即时中断；所有路径保留原件/已提交索引、取消语义及资源归属。 |
| M128 | `shared/test/scripts/conversations-smoke.mjs`：在原真实切换、取消删除、确认删除基础上，永久覆盖聊天中间动画与每ID阅读记忆，不改产品行为。 | 通过共享functional的`conversations`入口本机执行；保持合成provider与真实renderer/store，覆盖不同长短聊天位置、welcome拆挂、knowledge隐藏返回、后台流式增长/latest、固定header/composer、快速切换与减少动态效果。使用实际DOM滚动及真实hook，不直接改内部缓存或停止流式来绕过M117竞态，原删除确认断言继续保留。 |
| M129 | `shared/src/stores/cloudSync.ts`：perform/remove的catch捕获调用generation，断开或换账号后的旧操作失败不回填error；受控RPC也只允许当前generation的401派发`voxcue-cloud-expired`。 | 在实际合成engine上延迟pause/resume/remove等控制操作，A账号发起后断开或切B，再释放A失败/401，B不得出现旧错误或被旧事件触发过期刷新；B自己的新失败仍明确显示。执行`cloud-sync-store.test.ts`的延迟生命周期回归；不改云协议、账户资料或默认同步开关。 |
| M130 | 新增`shared/electron/backend/knowledge/docxArchive.ts`及`parser.ts`：DOCX以私有Buffer拷贝做实际ZIP预检，再将同一Buffer交原Mammoth流程二次解压。输入≤20 MiB、普通单卷stored/deflate ZIP、≤4096条目；单项实际展开≤32 MiB，全包实际累计≤64 MiB。拒绝加密/ZIP64/越界/头不一致；inflateRawSync按声明和剩余预算限制实际输出，并核对压缩消费长度、输出长度和CRC32。 | 本机执行`docx-archive.test.ts`、`knowledge-parsing.test.ts`及`legacy-doc.test.ts`；覆盖声明伪小的高压缩内容、累计/单项限额、空条目、CRC/头/长度损坏和正常DOCX。最终包验证helper随解析器完整编译；不升级依赖，不改Schema/索引版本，保留800万字符及“DOCX 解析失败。”边界。此项限制ZIP实际解压，不是整个XML解析器的总堆内存保证，也不宣称DOCX能实时中断；取消仍遵循M125–M127等待真实结束。 |
| M131 | `windows/test/scripts/installer-engine-smoke.mjs`：新增测试专用`--previous-version=1.0.0`核对1.0.0→当前；默认0.5.1→当前不变，只接受一个已知0.5.1/1.0.0参数。 | Windows专属，不运行/移植EXE、注册表或GUID夹具。Mac按本机最终包安装入口覆盖自身已发行1.0.0→1.1.0升级、原件/设置保留、取消及恢复；原Windows测试的独立GUID、inert EXE和owner临时安装/资料/注册项保护继续保持，参数不进入产品。 |
| M132 | `windows/test/fixtures/WindowProbe.cs`：只修改move分支及GetSystemMetrics声明。原相对32移动受系统加速可产生约65 DIP绕行，随后SetCursorPos也可能留下晚到转发；改为PMv2下按物理虚拟桌面像素中心映射的绝对SendInput，支持负origin、不合并及±1px anchor→target。仅修Windows测试夹具，产品代码不变。 | Windows专属，不复制C#或探针到Mac。Mac沿用固定宿主自己的原生输入、位置与命中校验；本机如发现旧合成移动问题，仅修对应夹具。保留owner解锁、1秒到达、90ms稳定及精确坐标要求，原native hit/hover/drag断言均须保留，不放宽容差或为夹具问题误改产品；本项仍需各自本机验证，不表示复测已完成。 |
| M133 | `shared/src/services/knowledge.ts`：不支持文件批次名单改用逗号加空格连接，不拆分或替换文件名字符；保留原先去重、顺序、截断及先整批校验逻辑。`shared/electron/contracts/uiMessages.ts` 的共享模板改为`Unsupported files: {0}`，知识库批次与composer单文件均适用，不引入service→UI/store依赖。 | 本机执行renderer `knowledge.test.ts`及`ui-language.test.ts`，再以英文选择多个不支持文件，确认应用连接符为逗号空格、原名中的中文顿号/逗号原样保留；composer单文件也使用自然模板。保留整批拒绝前不读字节/不备份/不写索引、20个及长名有界断言，不通过替换整条错误中的字符改写用户文件名。 |
| M134 | `shared/test/scripts/components-ui-smoke.mjs`：仅修模型设置几何夹具，测量前等待有限动画结束及两帧布局，再直接选择行内真实控件，不再使用可能命中菜单退出快照的`lastElementChild`。覆盖回答模型在线按钮、离线提示及两个语音选择按钮；产品代码不变。 | Mac本机执行`components-ui`及五档对应组，关闭CPU菜单后核对真实控件，不把正在退出的`aria-hidden`/`inert`快照当作表单控件。保留三行/分组、左边缘差值小于1 CSS px、同宽、标签不重叠及失败geometry诊断，不能放宽阈值或关闭动画代过；此项不表示Mac已验。 |
| M135 | `macos/scripts/package-app.mjs`、`macos/test/scripts/package-smoke.mjs`：显式收集 `word-extractor`、`chardet`，最终 ASAR 增加 DOC、GB18030 TXT、UTF-16LE Markdown 真实导入、精确文档检索、正文与重开持久化；先创建实际 DOC Worker 再取消并等待终止，随后正常导入。 | 使用本轮正式签名归档运行包专项，保留 PDF/DOCX/UTF-8、签名及运行时原断言；Worker 创建后取消不等同于已进入解析中，不以目录存在代替实际导入。 |
| M136 | `macos/test/scripts/{interview-real-audio-smoke,filler-audio-fixtures}.mjs`、共享 `interview-real-audio-process.cjs`：复用生产 Controller/Worker，测试夹具仅参数化本机预处理器路径。已安装 macOS 中文 voice 文件 TTS 生成非零 16 kHz PCM16 WAV，模型按 catalog 全摘要认证并复制到 owner 临时目录。 | 串行执行 Paraformer/CPU 与 Qwen/Metal，按需补 Qwen/CPU；默认“好的。”和正常问题，`--all`追加其他纯词、混合正文、短追问。必须非空 silence 终稿、真实 ACK 跨越 1800 ms、Renderer 收到实际事件后再判断自动 0/1 和手动 1；词表外识别如实报告，不改词表代过，不采样硬件。 |
| M137 | `shared/test/scripts/conversations-smoke.mjs`、`macos/test/scripts/ui-refinement-matrix.mjs` 与名单单测：五档纳入现有聊天回归，并补真实 DOM 从 snapshot 1100 移至 1250、延迟 scroll 通知期间由合成 provider 送实际 delta 的竞态。 | 不改内部 hook 缓存，不停止流式；delta 后保持 1250，恢复通知、切换回来仍为 1250。原删除、动画、welcome/hidden、后台增长和减少动态效果断言保持。 |
| M138 | `macos/test/scripts/package-upgrade-data.mjs` 由 `package-smoke.mjs --install-archive` 串行调用：真实已发行 1.0.0 临时副本以旧 UI 写合成资料、设置和原件，旧包建立实际索引；关闭且确认无占用后同路径展开最终新 ZIP，保持原 owner profile。 | 核对个人资料、主题/语言、原件字节/元数据、旧索引与实际 UI；此项为正式归档覆盖升级的数据兼容验收。原 Sparkle 认证/暂存/取消与独立原生 commit/relaunch 回归保持，不把归档覆盖称为真实自动更新提交。 |
| M139 | `macos/test/scripts/components-smoke.mjs`：安装态顶部组件提示的旧“轻量语音识别”断言改为 M112 已确认的完整“语音识别、知识库检索组件未下载，请在设置中下载或查看进度”，按精确全文匹配。 | 重跑原真实打包组件入口；模型设置行仍使用具体模型名称，后台缺失模型错误分类保持。不改产品文案，不扩大等待期限或放宽布局/下载断言。 |
| M140 | `macos/test/scripts/filler-audio-fixtures.mjs`：本机 voice 列表使用本地化全名时，短名只能唯一匹配已列出的完整名字；相同全名去重，歧义或缺失仍拒绝，允许名字中的全角括号。 | 只使用本机已安装 voice，不安装/下载或播放；不因短名与本地化名字不同而误拒。不改变 WAV、真实非空终稿及过滤断言，短音节无法识别仍明确报告未覆盖。 |
| M141 | `shared/test/scripts/updates-smoke.mjs`：鼠标长按失败时输出有界指针事件、焦点/可见性、实际几何与命中、更新状态及原生窗口状态，仅记录当前合成窗口，结束移除监听。 | 通过真实输入区分未命中、移出/失焦取消和状态变化；保留 4700 ms 零次、生产 5000 ms、原等待期限、恰好一次及释放不重复的断言。不以重试或伪造事件替代失败，不据无 DPI 分支推断根因。 |
| M142 | `macos/test/scripts/package-upgrade-data.mjs`、`package-smoke.mjs`：升级夹具先将全摘要认证的 RAG 缓存复制到旧版 profile 的真实 `component-cache`，使用完整 catalog 的目录映射，等旧版 UI 实际索引完成后再保存比较快照。 | 保留旧版创建知识库的真实组件门禁，不伪造 ready；保持同一 profile、原件、旧索引及完整比较。仅修升级验收前提，正式包源码输入与资产字节不因此改变。 |

## 1.1.0：局域网设备连接与同步

| ID | 变化及 owning source | Mac 操作与预期 |
| --- | --- | --- |
| M143 | `shared/package.json`、同步脚本：共享目标版本为 1.1.0，Windows Store 映射 2.1.0.0。 | 在根执行 `pnpm sync:workspace`，仅生成根／Mac 配置。Mac bundle 使用 1.1.0，不复制 APPX 版本、发布者或 Windows 配置。 |
| M144 | 新增固定 `qrcode-generator@2.0.4`、`ws@8.22.2` 及开发类型 `@types/ws@8.18.2`。 | 只在 `macos/` 更新本机锁并安装；既有依赖／模型保持。不得复制 Windows 锁文件或 node_modules。 |
| M145 | `shared/vite.config.mjs`、`shared/mobile.html`：桌面与设备页面多入口构建，生成 `.vite/manifest.json`。 | 本机 build 后核对两入口及依赖闭包存在；设备页面无需域名或另行部署。手机源码变化后需重建并重启应用。 |
| M146 | `macos/scripts/package-app.mjs` 当前为显式依赖收集，本轮 Windows 未修改它。共享 main 新增 `ws` 运行时依赖。 | **优先适配打包器**：纳入 ws 及其实际运行依赖，并验证 mobile.html、manifest、JS/CSS 的完整分发；复用 Windows 打包前／后校验思路，不照抄 EXE 或 Windows 脚本。最终 ASAR 启动及扫码必须实际运行。 |
| M147 | `backend/remoteConnection/service.ts`：HTTP + WS 仅服务私人 RFC1918 IPv4／热点，不加密，不引入公网服务器。 | 用可信私人网络验证两设备直连；不映射公网端口、不改 DNS。明确 HTTP/WS 的局域网边界，不宣称传输加密。 |
| M148 | 同上：默认关闭，启动后只监听一个私网接口，不绑定 0.0.0.0；多网卡优先物理 Wi-Fi／以太网。 | 无私网接口时应明确失败；VPN／虚拟接口不抢优先。Mac 本机核对局域网权限／防火墙提示与可达性，不自动修改系统安全设置。 |
| M149 | `RemoteConnection.tsx`：二维码、网址复制、120 秒到期与刷新。pair 凭证放 URL fragment，加载页面不消费。 | 相机预览、普通 GET 不配对；到期／刷新后的旧码拒绝，复制网址可正常打开，不把 token 放 query、日志或记录。 |
| M150 | 设备发起申请后显示六位码，电脑批准且 WS 认证才显示已连接；审批不显示旧 iPhone／iPad 名称。 | 两端码必须一致；拒绝、关闭、掉线、过期均不开放内容。允许／拒绝按钮包含图标，主窗与面试窗不重复弹审批。 |
| M151 | 一次只允许一个设备授权／活动控制连接。 | 第二设备不能静默替换已连设备；主动断开后才可重新配对。扫描二维码本身不等于已连接。 |
| M152 | `src/mobile/connection.ts`：恢复票据与未确认请求 ID 只放当前标签页 sessionStorage；正文不落盘。 | 检查存储仅含必要能力与元数据，无转录、问答、草稿、正式账号凭据；禁用存储时页面内仍可恢复，刷新可能需扫码。 |
| M153 | 服务端 Host、Origin、peer IPv4 校验，IPC 主 frame／窗口白名单。 | 实际私网 HTTP/WS 拒绝外部 Origin、伪 Host、未审批命令；帮助窗不能读取完整远程状态／内容，子 frame 不能管理或完成操作。 |
| M154 | `backend/remoteConnection/assets.ts`：只开放手机 manifest 依赖闭包。 | 拒绝桌面入口、package、manifest、路径穿越及目录外符号链接；缺失／损坏资源明确失败。不能使用通用静态目录服务器。 |
| M155 | 同上／service：严格同源 CSP，无 inline 或外部采集；消息、JSON、连接数、速率、快照、发送缓冲有界。 | 执行恶意帧、超长消息、慢客户端、未认证连接和资源访问回归；拒绝后正常连接仍可用，无命令或内存无限排队。 |
| M156 | `application/remoteConnection.ts`、`src/services/remoteInterview.ts`：单调完整快照，同一请求在途只保留最新内容。 | 流式问答、转录和控制状态同步；旧序号／旧场次不写回，断号用新完整快照替换，不拼接旧 token。 |
| M157 | 快照最多最近 200 条转录、40 条问答；目标 900KiB，硬上限 1MiB，正文截短有标记。 | 大量合成记录核对省略提示与完整电脑数据；不向设备发送知识库原文、图片、账号、路径或全历史库。功能关闭时不构造快照。 |
| M158 | 控制白名单：提问、版本化草稿、麦克风、自动回答、停止指定回答；设备不能开始面试。 | 各命令复用电脑受控流程；确认后显示真实状态。关闭自动回答不停止已有答案；迟到停止不能停止下一条答案。 |
| M159 | requestId 去重及内容指纹；业务结果最多登记1024，草稿结果有界。 | 同 ID 同内容只执行一次；异内容冲突；缓存满明确拒绝，不能淘汰后重执行旧业务。 |
| M160 | 回执不明只查询结果，未知也不自动更换 ID 重发。 | 丢 ACK、处理中、未知结果与恢复竞态下无重复问题、旧开关或旧正文重放；恢复后可核对最新快照再操作。 |
| M161 | 原授权意外断线保留120秒；按1/2/4/8/10秒退避，前台／网络恢复即时检查。 | 短断网自动认证和同步，无需再次审批；刷新可接管旧 WS，始终一个有效控制连接。授权到期后重新扫码。 |
| M162 | 电脑主动刷新二维码撤销旧恢复授权；主动断开和退出撤销授权。 | 已连时先二次确认；主动断开不报意外中断。返回登录／退出后旧票据不能访问内容。 |
| M163 | 场次／窗口导航与未确认业务绑定 epoch、取消和10秒结果期限。 | 结束、重开、重载后旧业务与旧快照无效；超时不伪称未执行。开始面试按钮确认将该场共享给已连设备，设备不能越权开场。 |
| M164 | 设备滚动消息仅发当前连接／场次，scrollId 单调；无离线队列。 | Ctrl+Shift+↑／↓滚动设备问答，暂停跟随；断开时无副作用，恢复不补放旧滚动。 |

## 1.1.0：设备竖屏页面与电脑界面

| ID | 变化及 owning source | Mac 操作与预期 |
| --- | --- | --- |
| M165 | `src/mobile/App.tsx`：顶栏、可折叠转录、问答、底部输入的竖屏布局。 | 在320／390／768 CSS px、中英浅深与大字号检查无横向页面溢出；按钮触控区至少44px。另用 iPhone／Android 真机验证浏览器栏与安全区。 |
| M166 | 转录预览最近数条，可展开／隐藏，来源使用左右气泡。 | 隐藏仅影响本设备显示，不改电脑面板、采集或ASR；展开后时间／省略／临时转录状态正确。 |
| M167 | 问答使用问题与答案气泡、流式内容及完成／停止／失败状态。 | 长答案、表格、代码块、链接、失败后重试和多轮追问可阅读；源文本不因界面语言改变。 |
| M168 | 复用公式规范化与 remark-math／rehype-katex，移动页输出 MathML。 | 实际页面验证行内、独立公式、矩阵；没有 katex-error／CSP 拒绝。恶意 HTML、javascript 链接和远程图片不执行／加载，复杂公式另验 Safari。 |
| M169 | 底部输入沿用电脑结构：上方文本、左下自动回答胶囊，右下麦克风与发送／停止圆形。 | 各按钮位于输入框内部下排，等高，麦克风与发送为圆形；发送中／切换中保持待确认和禁用反馈。 |
| M170 | 草稿共享且一切以电脑为准，删除原独立草稿与两端选择弹窗。 | 设备正常编辑经CAS写电脑；电脑较新版本、新场次与重连快照直接采纳。普通同草稿版本快照不吞掉节流中的键入。 |
| M171 | 输入法组字、6000字上限、节流在途与版本归属。 | 两端组字时不相互强写；电脑组字拒绝设备改写。超长电脑候选明确截短，不把预览当完整问题发送。 |
| M172 | 发送先完成草稿同步，版本及文本一致才接受；只清对应版本。 | 发送后立刻继续编辑，旧ACK不得清掉新稿；忙碌／停止／旧候选均无重复发送。独立显式API仍不可绕过场次守卫。 |
| M173 | 断线输入只读，已读内容可阅读；重连不重放离线草稿。 | 网络断开时所有控制禁用；恢复后以电脑当前内容为准，不询问选哪端。 |
| M174 | 问答／转录各自阅读位置，底部跟随、上翻保持并提示回到最新。 | 触摸阅读和设备滚动时不被新 token 拉走；回到最新恢复跟随；切换转录显隐仍保留主要问答阅读。 |
| M175 | 更多为三点、关闭为X，设置按钮／下拉为胶囊，语言／主题／字号／转录偏好独立。 | 中英浅深、大字号、键盘操作、关闭回焦及二次断开均可用；设备偏好不改变电脑偏好，正文不存localStorage。 |
| M176 | `useMobileViewport`：依据VisualViewport高度和offsetTop固定页面，取消聚焦反复scrollIntoView。 | 真机键盘打开、候选栏、换行、浏览器栏收放、旋转和收键后，输入紧贴可视底部，无大块空白／反复上跳；桌面模拟不能代验。 |
| M177 | `RemoteConnectionSettings`：屏幕捕获与模型设置之间的左右行。 | 主副标题沿屏幕捕获间距，按钮与整块文字垂直居中；文案为“另一台设备查看实时转录和问答，并控制麦克风与自动回答。”，正常宽度单行。 |
| M178 | 配对教程使用标题冒号与项目符号，统一称设备。 | 三条为“让另一台设备与此电脑连接同一Wi-Fi。”“扫描二维码，或在浏览器中打开连接网址。”“核对两端显示的配对码，再在电脑上允许连接。”；无旧热点句。访问故障提示单行。 |
| M179 | 开始面试的屏幕截图下只读显示已连接／未连接。 | 无连接按钮，不与音频检测骨架混淆；未连设备不阻止面试。设备审批中不能误显已连接。 |
| M180 | 转写标题右侧设备胶囊和语音模型／麦克风／系统音频统一。 | 连接时显示设备✓，四项宽时一行、窄时2+2，不出现3+1，整体与转写标题垂直居中；中英不同宽度复核。 |
| M181 | 面试中设备中断复用音频中断的面板内恢复卡片，转录隐藏时移到回答区。 | 与音频中断同层级、间距、操作样式；重新连接／设置可用，恢复后卡片消失。非面试页不弹中断提醒，主动断开不报错。 |

## 1.1.0：快捷键、窗口与音频

| ID | 变化及 owning source | Mac 操作与预期 |
| --- | --- | --- |
| M182 | `contracts/shortcuts.ts`：默认统一 Ctrl+Shift：H整窗、P面板、T转写、M麦克风、A系统音频、Enter发送、↑↓设备滚动、S截图。 | 替代beta旧Ctrl/Alt默认，不保留双套映射。Mac核对显示与原生映射；所有项均按本场全局注册，整窗隐藏时也可用；H恢复整窗，其余动作保持隐藏。 |
| M183 | 新“快捷键”设置分类位于“通用”下面。 | 点击修改、Backspace／Delete清空、Esc取消；末尾右下仅保留带图标恢复默认，无旧检查按钮或顶部说明。 |
| M184 | 组合规则：Ctrl／Shift／Alt至少一个加主键，允许Shift+字母。 | 单修饰键／裸功能键／仅Meta组合拒绝，合法组合可保存；Mac不要擅自改成必须Command，明确检验本平台转换与Option/Alt行为。 |
| M185 | 录入实时显示当前按住组合，keyup立即移除松开的键。 | 测试先松修饰键、先松主键、按住键追加修饰、系统消耗keydown仅keyup到达和IME，预览始终与实际持键一致。 |
| M186 | 无效／应用内重复／系统冲突时不保存、继续录入，恢复“请按快捷键…”。 | 每项仅一行新错误替换旧错误；提示明确缺少修饰键或“快捷键冲突或不可用”，原绑定保持，之后可直接输入新组合。 |
| M187 | 注册冲突按单键停用，不再导致无法进入面试。 | 用另一自有测试进程占用组合验证无法注册、可继续面试，其他按键工作；不猜测具体系统占用者。帮助冲突项只显示不可用。 |
| M188 | 录入期间临时释放本功能注册，取消／失焦／关闭／切分类恢复。 | 正常结束后无遗留占用；只释放本应用拥有项，不能 unregisterAll 影响其他应用；主窗和面试窗配置一致。 |
| M189 | 独立偏好版本2，旧默认迁移Ctrl+Shift，自定义与清空保留。 | 合成v1默认／自定义／清空及坏文件读取，核对最小兼容与明确错误；不迁移或删除真实资料。 |
| M190 | 新独立帮助窗默认打开，固定面试所在屏幕工作区左下，沿用转写材质。 | 开关／X／Escape可关，结束销毁；未连设备隐藏↑↓，连接状态通过窄布尔事件即时更新，不泄漏票据／正文。 |
| M191 | 全局发送直接读共享草稿，整窗隐藏也可发送，不显窗／抢焦点。 | 非空接受一次，忙碌／组字／结束冲刷不发送；空输入不回退旧转录，旧提交不清下一版草稿。用本机原生组合实际验证。 |
| M192 | 再次启动／activate发现已有隐藏后台面试，恢复已有窗口。 | 隐藏后再次启动程序，只恢复并聚焦当前场；转录／回答／草稿／面板状态保留，无新场／重载，主窗不先闪现。 |
| M193 | 共用显隐渐变160ms、双端renderer-ready修订门控。 | 快速隐藏／恢复衔接当前opacity；减少动态效果静态切换；旧页面就绪、初始化中关闭或失败不唤起新窗口，监听和帮助窗正确回收。 |
| M194 | Windows预留透明画布，面板开关／设置／缩放只改变可视布局。 | **Windows专属策略不直接照搬Mac**。Mac验证原native尺寸路径、顶部锚点、拖动／缩放命中、透明区域鼠标穿透及原生提示；必要修改留本机适配器。 |
| M195 | 收起时可打开完整面试设置，采用最小仅回答画布，关闭后恢复。 | 分别在转写开／关的收起状态打开设置，内容不被裁剪；关闭保留原展开尺寸和转写偏好，滑块拖动连续。 |
| M196 | 远程面试／仅转录方式控件共享于主设置、开场及场内。 | 胶囊按完整文案自适应、相同控件高度，窄时整组换行；英文不拥挤，切换内容高度动画可反向和取消。 |
| M197 | 仅转录只预检／采集麦克风；系统音频下拉禁用并单行省略原因。 | 不检查／请求系统音频权限；摘要移除系统行，不留下占位。标题颜色正常，禁用文本普通字号，不拆两行。 |
| M198 | 模式偏好独立，场内可切换并保留已有转写／问答。 | 切回远程恢复设备和麦克风启用偏好，先检查所需系统音频；切换重置旧问题来源与gate，旧场／旧方式结果不得自动发送。 |
| M199 | 麦克风与系统音频独立软门控，等待原生确认后更新。 | 切换不重建capture／model，不停止已有回答；互不误拦，旧排队／处理中／迟到结果按通道隔离。失败回滚，不误报整条音频中断。 |
| M200 | 仅转录麦克风是问题来源，但底层仍标真实microphone。 | 实际文本进入共享草稿／自动提问，不能误作用户已陈述的经历事实；手动编辑、忙时排队、去重、结束保护保持。 |
| M201 | 逻辑静音断句从800ms改1000ms，自动回答仍按已处理音频1800ms。 | 固定非零WAV+真实零PCM验证短停顿连句、终稿后不再另等1800ms；pending ACK未清不能仅靠墙钟放行。 |
| M202 | Qwen保留内部800ms边界，共享层续写短片段并按真实处理进度终稿。 | 本机CPU／Metal各验continuation、静音起点和processedThrough；不换模型、不伪造空final或人工progress来通过。 |
| M203 | 保留长发言／队列容量、切换互斥与取消归属。 | 暂停、重连、模型切换、结束／导航时打断输入操作，迟到确认不改当前场；正常重试和后续新发言可用。 |

## 1.1.0：界面整理、清理和验证维护

| ID | 变化及 owning source | Mac 操作与预期 |
| --- | --- | --- |
| M204 | 开场改统一标题—值摘要，设备主标题在前、角色在后，模型参数使用主题色。 | 中英、两模式、空／长知识库、用量、推理设备核对；无重复参数标签，设备状态顺序一致。 |
| M205 | 开场固定外框与底部说明／取消／确认，中间独立滚动；标题分割线统一。 | 初次／再次打开及异步预检不跳高，短内容不留无用底部空位，长内容不遮按钮，关闭内层Escape不连带关闭父层。 |
| M206 | 开场隐私说明缩短并按实际回答服务显示接收方。 | 非OpenAI合成提供商必须显示对应公司，不硬编码OpenAI；没有回答服务时不虚构发送方。 |
| M207 | 主设置系统音频／麦克风旁恢复面试官／面试者副标题；删模型分组冗余子标题及指定捕获限定句。 | 主副文字位置、字号、颜色中英一致；场内系统设备标题简化系统声音，保留真正权限说明。 |
| M208 | 面试设置下拉靠右，上限240px／窄窗60%，面试方式按文案自适应。 | 不让长设备／模型名重叠标签；单行省略，音频、模型和滑块列对齐，远程行另按整块主副标题居中。 |
| M209 | 面试输入下排按钮与顶部开关统一26px，截图快捷键宽度按当前组合计算。 | 实际预览／场内、中英和自定义长组合核对不裁字；圆形发送、截图计数变化、展开／收起动画和原禁用逻辑保持。 |
| M210 | 组件下载“取消”保护延迟0.5秒，仅该入口调整。 | 鼠标停留原按钮时不立刻误取消；到时后正常取消，其他下载入口沿用原默认延迟。 |
| M211 | 面试记录列表进入详情记住滚动位置，返回／删除恢复。 | 保留搜索；删除后自然限新底部，不跳顶部；仅本页运行态，不改数据库／全局滚动。 |
| M212 | 侧栏账户箭头垂直居中并按菜单状态平滑旋转；设置引导文字沿用反馈链接样式。 | 中英单／双行用量、浅深和减少动态效果核对；不增加悬停文字提示，不改邮箱／额度规则。 |
| M213 | 试作的面对面／声音录入／说话人识别与学习最终撤回，非正式1.0.2已有功能删除。 | 不恢复其UI、状态、契约、IPC、后端或模型；旧偏好不读取，不删除／迁移真实用户资料。 |
| M214 | 删除无消费者工具栏、旧音频复选框样式、SAPI旧生成器／清单及旧说话人缓存。 | Mac只清本机确认无消费者且非保护目录的同类残留，不能删当前公开WAV／ASR／RAG依赖或旧正式包；历史跳过目录不重试。 |
| M215 | 发行清理移除未使用ConfirmResetButton、Search／Eye图标和旧整场快捷键失败提示，移除固定截图宽度覆盖。 | 类型／构建确认无消费者；RemotePairingCode仍有内部调用，不误删。有真实消费者的Mock／temp接口保留，不按名称清理。 |
| M216 | 完整功能矩阵增加快捷键设置、设备徽标、帮助／隐藏发送、历史滚动、移动资源及实际移动页。 | 本机先 `--list` 核对调度，GUI／原生／推理串行；新GUI只用合成服务端口与本轮临时profile，无正式账户／硬件访问。 |
| M217 | 新 `mobile-ui-smoke.mjs` 加载生产构建页面和LAN服务，真实审批、MathML/CSP及控件闭环。 | 本机执行中英、320／390／768px、共享草稿、发送／停止、麦克风／自动回答、转录显隐和恢复／刷新；不能替代iPhone实际键盘。 |
| M218 | 测试修复：设置导航加入快捷键；预览与场内发送／截图期望改为需求的26px；隐私文本和设备角色顺序同步。 | 保留精确导航、图标、颜色、圆角、发送／禁用和接收方断言，不用弱匹配放过中文泄漏。 |
| M219 | 测试修复：开场远程状态无需音频骨架；普通设置列排除具有独立布局的模式／远程行。 | 远程行严格验证未连接且只读，原音频骨架与控件数量／同宽／标签对齐仍检查，新行由专用几何回归覆盖。 |
| M220 | 测试修复：新胶囊加入圆角语义；单行省略按同视觉行文本碎片判定，兼容ellipsis附加fragment。 | 仍验证nowrap、hidden、ellipsis、单行高度和所有corner形状，不将胶囊误当连续曲面，不降低遮罩／对齐阈值。 |
| M221 | 测试修复：隐藏截图旧macShortcut变量／旧Alt组合移除，检查当前Ctrl+Shift+S及修改键、repeat、组字、默认已处理事件。 | 当前绑定经全局注册触发截图；Renderer自行构造的键盘事件不能执行全局命令。忙碌／最多5张等业务限制保持，收起／隐藏仍可用；自定义绑定另按设置专项验证。 |
| M222 | 测试修复：Windows键盘缩放验证可视面板增大且预留原生画布保持；拖动探针在实际屏幕范围内停放游标。 | Mac仍检验本机原生窗口尺寸变化，不引入Windows画布假设。拖动坐标、视口不变、取消／失焦／重载后的旧操作拒绝断言保持。 |

## Mac 本机执行和交付顺序

1. 核对status/diff、最终1.1.0源码与上述两个1.0.0安装输入；保留现有Mac后续工作。同步根／Mac生成配置并只在macos安装依赖，先处理M146的实际包运行时。
2. 运行本机typecheck、architecture、workspace、完整单测、冻结依赖审计及build。按当前functional-suite和本机五档矩阵的--list执行全部，失败修复后重测相关组。
3. 客户端联调使用只读固定服务端0.5.3／`3bceb615dbba900f669322c301fc4b5b473dfb15`独立副本，通过VOXCUE_TEST_SERVER_ROOT传入，不回退现有服务端、不运行其后端套件或生产接口。
4. 串行验证20轮面试、显式600秒认证公开音频、Paraformer及Qwen实际Controller／Worker／ACK链；补Mac权限、原生窗口、隐藏恢复、快捷键占用／录入、AEC、签名与更新检查。
5. 五档100／125／150／175／200%中英浅深复核表内布局；在真实iPhone Safari／Android验证软键盘、安全区、触摸、前后台及断网恢复，条件不足逐项列明。
6. 最终准确1.1.0签名DMG／ZIP使用本机完整包检查，并以真实旧1.0.0合成profile验证资料、设置、原件与旧索引保持；不把归档覆盖称作完整自动更新提交。
7. Mac发布须按该次当前授权执行，固定签名／Sparkle身份不得生成或轮换；完整资产和清单通过匿名本平台选择／签名／摘要回读后才声明已发行。Windows新Latest不应让Mac选到不完整或错误平台资产。
8. 结束清理归属明确的系统临时profile／数据库／截图与测试副本；认证公共缓存和全部正式／恢复基线保留。结果在终端／对话报告，交接表保留行为、步骤、待办，不存成绩。

## 最新追加：完全隐藏状态的快捷键

| ID | 变化及 owning source | Mac 操作与预期 |
| --- | --- | --- |
| M223 | `interviewShortcuts.ts`、`contracts/desktop.ts`、`FloatingInterview.tsx`：截图纳入本场全局注册及现有受控事件，删除仅Renderer可见时监听的旧截图路径。 | 整窗和帮助均隐藏后，Ctrl+Shift+S将当前屏幕截图加入本场输入框，窗口保持隐藏、不抢焦点；显示／收起时同样有效。不重复执行本地keydown和全局回调；结束／异常后释放截图注册，系统冲突明确显示，不阻止面试。 |
| M224 | 面板／转写快捷键不再因整窗隐藏而忽略；`useInterviewPanelMotion`在隐藏文档跳过不可见动画。 | 隐藏状态P／T改变保存的面板状态，H恢复后正确呈现；不能等待后台暂停的动画而永久忙锁，也不能因切换布局唤起原生窗口。麦克风、系统音频、发送和设备滚动继续按本场及能力生效。 |
| M225 | 单测、原生注册GUI和截图专项增加九项注册／完整释放、S冲突、隐藏截图及隐藏P／T回归。 | 合成图像验证真实注册回调→Renderer→截图IPC→暂存预览的闭环，不采集宿主屏幕；另在Mac本机核对实际键盘事件、屏幕权限与多显示器目标，不能以Windows回调测试代替。 |

| M226 | 隐藏状态回归发现Chromium可能仍报告visible，后台动画停止推进。`InterviewWindowState.visible`由主进程提供，面板动画读取真实可见意图并设有有界取消保护。 | 隐藏后P／T立即更新；动画进行中按H隐藏后也不能永久忙锁。恢复显示后状态一致、原生窗口仍不因布局命令唤起，公开契约／桥接及本机单测同步检查。 |
| M227 | 测试修复：异步IPC条件统一使用实际await轮询；设置弹窗再次打开等待退出视觉结束，并确认新对话框确实打开；合成SpeechHost补完整输入状态ACK。 | 不能把Promise本身当成成功条件；不删除面板状态／关闭点击消耗／不重启音频断言。弹窗后方状态使用显式includeHidden查询，仅测试状态，不绕开真实控件交互。 |

| M228 | 窄窗口回归修复：场内设置最大宽高同时受原生视口和逻辑面板限制，底部偏移不为负。 | 440／620／960px及五档缩放、长内容滚动、显示器区域变小后关闭按钮仍在可见范围；不因逻辑画布大于实际视口而裁掉右侧或顶部控件。 |

| M229 | 设置切换状态几何回归不再查询已按要求删除的h4子标题，改为验证状态行在控件上方、左边缘对齐且无溢出。 | 正在加载／等待停顿两态仍验证status语义、位置及互锁；不为了兼容旧断言恢复冗余分组标题。 |

| M230 | Windows最终包检查增加固定ws版本、实际ASAR中的移动资源读取与LAN服务启动，逐项请求入口依赖且拒绝桌面HTML。 | Mac在最终签名包中执行等价检查；不能只验证开发dist或目录存在。加载页面仍是waiting，不绕过配对，不派发业务；本机测试结束释放监听。 |

| M231 | Windows截图修复：透明预留画布在FHD旁的4K屏上可能有更大的交集，旧MonitorFromWindow因此选错屏幕。原生助手改为按画布顶部中心的工具栏锚点选屏，仍仅接收自有窗口句柄。 | Mac不移植C#；复核本机捕获目标及隐藏状态。Windows专项覆盖不等大、负坐标、垂直排列、DPI、整数极值及无效尺寸，并对同一owner HWND验证显示／隐藏的真实窗口与选屏调用，不捕获宿主屏幕；两渠道须纳入重建后的助手。 |

| M232 | Windows原生界面夹具同步设备—角色标题顺序和精确隐私文案，七个普通控件列排除采用独立布局的模式／远程行。 | Mac若有同类旧断言，同步当前文案和真实控件结构；保留全部七行、列宽、对齐、溢出、权限与确认状态断言，新模式与远程行由专用回归验证。 |

| M233 | Windows原生工作流的尺寸观察改为可视shell／确认layout，同时独立验证原生视口一致、画布不变；拖动缩放仍验证控件变化与工具栏固定。隐私说明精确验证含接收方的完整段落。 | Mac继续验证本机真实窗口尺寸，不能套用Windows固定画布；保留原尺寸容差、锚点、真实IPC／命中和隐私接收方断言。 |

| M234 | 最终ASAR回归发现Windows显式运行时收集遗漏ws，已补入`package-portable.mjs`，两渠道重新生成。开发环境有依赖不代表安装包完整。 | 优先执行M146：Mac显式打包器也须纳入ws；必须在最终签名包启动实际服务、读取页面及依赖，开发构建或静态manifest不能代验。Windows公开依赖版本和既有依赖／模型均未升级。 |

| M235 | 最终安装包组件回归同步本地组件专属500ms取消保护；旧检查默认1000ms与当前产品不符，保持边界前／边界后、点击不可误取消等严格断言。 | Mac的同类包检查传入实际500ms；其他下载入口继续默认1000ms，不能更改产品延迟或放宽取消／摘要校验来绕过测试。 |

后续测试发现的修复继续从M236追加；不要覆盖或重排已有稳定编号。
