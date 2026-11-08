# VoxCue 1.0.0 → 1.0.2：macOS 逐项接续与验收清单

更新日期：2026-11-08。本文保存1.0.2行为、Mac本机操作、预期及待办；后续修复追加稳定编号，不保存测试成绩或运行产物。

## 基线与边界

- 1.0.0 的实际 Windows 包源码输入为 `a47f7435ef7c233eee9da87a18261162dfaee65f`，Mac 包输入为 `f6e06e3f62395c0d6b78bafdfceabb347c91ac27`。本表对照两平台准确输入、随后提交至 `d131fa5` 的发行/夹具维护及1.0.2最终源码差异，不能只以单个提交的差异代替完整发行范围。
- Windows 1.0.2 已在 [GitHub v1.0.2](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.0.2) 发布。Microsoft Store第5次提交已受理、通过后自动发布，最后观察为预处理/认证中，尚未确认1.0.2上架。准确源码/包输入、资产及渠道状态见 [Windows 1.0.2发行索引](WINDOWS_1.0.2_RELEASE.md)。
- 1.0.1 是 Windows Store 发布者显示名及版本元数据维护，包输入为 `20ada2f0d3ec6ea3909ae8a05c64642c21ad6416`，没有独立新增的 Mac 产品行为。记录见 [Windows 1.0.1](WINDOWS_1.0.1_RELEASE.md)。1.0.0 与 1.0.1 的历史状态保留，不在此推断本轮商店认证或可获取状态。
- Mac 1.0.0 已公开完整 DMG/ZIP/清单，准确资产与原签名/摘要认证记录见 [Mac 1.0.0 发行索引](MACOS_1.0.0_RELEASE.md)。[0.6.9 → 1.0.0 清单 M001–M067](MACOS_1.0.0_HANDOFF.md)是已发行基线的行为及回归参考，不再标为未完成升级。本文件从 **M068** 接续，所有新增项目仍需 Mac 本机验证；旧表 M011 的后台刷新期间隐藏旧值要求由本文 M108–M110 的新需求替代，其余未被明确替代的基线保持。
- 原交接 **M068–M134共67项**构成本轮 Mac 接续范围，本机补充从 M135 续列，当前工作状态见 `PROGRESS.md`。Windows源码、单测、GUI或真实模型运行不能代替Mac原生、签名、安装或界面验证；Mac当前完整公开版仍为1.0.0，1.0.2本机接续与发行尚待完成。`shared/package.json`是唯一版本源；Windows上`macos/`全树只读，Mac上`windows/`全树只读。
- 仅使用 owner 临时合成账户/资料和固定来源、摘要认证的公开模型/音频；不访问真实账户或 Keychain 材料，不采样物理硬件。GUI、原生与推理仅在当前 UID 已登录且解锁的控制台串行执行；锁定或未知即停止。
- 依赖仅在 `macos/` 安装。不得借同步升级既有依赖/模型、改变数据库或索引兼容、恢复旧两阶段用量优化、轮换签名身份。固定私钥、现用模型/依赖、原件、正式资产与恢复基线受保护。
- profile、数据库、音频及必要暂存仅用归属明确的系统临时目录，结束清理；可复用公开缓存允许保留，但不提交缓存、依赖、凭据、用户资料、截图、报告、trace 或 coverage。结果只在终端/对话说明。独立官网和服务端不属于本交接的修改范围。

下表给出仓库相对 owning source。共享文件由两端复用，Mac 操作是同步后在本机验证；Windows 专属项目只说明边界，不要求复制实现。

## 版本、依赖与打包接续

| ID | owning file 与行为 | Mac 动作与验收预期 |
| --- | --- | --- |
| M068 | `shared/package.json`；`shared/docs/RELEASE_1.0.1.md`；`windows/scripts/package-store.mjs`：1.0.1 仅把 Store PublisherDisplayName 从 `NCFX` 改为 `F. Zhu`，固定 Identity Name/Publisher 不变；共享版本为1.0.2。 | 本机直接同步最终共享 1.0.2 版本，不发布一个无额外 Mac 行为的中间包。不要把 Windows Store 的 `2.0.x.0` 身份映射、发布者或 AppUserModelID 移植到 Mac bundle/签名。 |
| M069 | `shared/package.json`、`shared/pnpm-workspace.yaml`：新增固定 `word-extractor@1.0.4`、`chardet@2.1.1`；旧依赖版本不借此升级。 | 在仓库根执行 `pnpm sync:workspace`，只生成根和 Mac 配置，再在 `macos/` 更新本机锁并安装。核对生成的 package/tsconfig/workspace 配置与新增依赖；不写 `windows/`，不在根或 shared 安装 node_modules。 |
| M070 | `shared/pnpm-workspace.yaml`、`shared/electron/backend/knowledge/legacyDocWorker.ts`：DOC 只用固定 OLE 内部入口，排除其未使用的 `saxes`/`yauzl`；DOCX 继续 Mammoth。 | 本机确认覆盖规则生效且所用内部 OLE 模块及其运行依赖完整。不删除 Mammoth 运行资源，不重新接入 word-extractor 的 OOXML 路径；依赖审计失败应在 owning source 定位，不能升级或放宽绕过。 |
| M071 | `windows/scripts/package-portable.mjs` 显式复制 `word-extractor`/`chardet`，此修改没有自动落入 Mac 打包器。`shared/electron/backend/knowledge/legacyDoc.ts` 通过相邻 `legacyDocWorker.js` 启动 Worker。`windows/test/scripts/packaged-smoke.mjs` 增加最终 ASAR 内真实 DOC、GB18030 TXT、UTF-16LE Markdown 的导入/精确文档检索/正文/重开持久化，保留原 PDF/DOCX/UTF-8 Markdown 验证。 | 检查本机打包器的实际依赖收集和编译输出，按必要最小修改纳入两依赖与 Worker。在本机包专项加入等价新样本，必须实际运行最终签名 ASAR/解包目录的 DOC Worker 和传统编码解析、检索及重开，不以依赖目录存在或开发环境通过代替。不能从 Windows 包复制原生依赖、EXE 夹具或整套 node_modules。 |

## 可索引格式、解析边界与背压

| ID | owning file 与行为 | Mac 动作与验收预期 |
| --- | --- | --- |
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

## 知识库提示、归属与测试发现的异步修复

| ID | owning file 与行为 | Mac 动作与验收预期 |
| --- | --- | --- |
| M086 | `shared/src/components/KnowledgePage.tsx`、`styles.css`：错误合入“大小 · 索引失败: 正文”同一状态行，换行与冒号后正文起点对齐；非失败任务不显示旧 error。 | 中英文、浅深主题、窄窗口、长文件名与多行错误核对悬挂对齐、字号和可读性；错误正文不再另起一条红色行。独立真实任务 phase 保持，不通过清错误隐藏失败。 |
| M087 | `shared/electron/contracts/uiMessages.ts`、knowledge application/backend/services：精简解析、存储、组件、超时和过长文本等提示并同步英文。 | 执行 ui-language 与 knowledge 错误分支；精简只影响显示，不吞掉错误分类或改成成功。路径/凭据泄漏过滤继续生效，未知错误仍用安全短提示；用户文件名和正文保留。 |
| M088 | `shared/src/stores/knowledge.ts`：导入/删除错误绑定 selectedId 与 documentRequest，关闭、切换、同库重开后清空；旧请求迟到不得回填新视图。 | A 库导入延迟失败→关闭/打开 B 或重开 A，预期旧提示不复活；删除 A 完成时不能关闭后来打开的 B。重复打开仅最后列表响应生效；这包括测试中发现的同 ID 重开归属问题。 |
| M089 | `KnowledgePage.tsx`、`stores/knowledge.ts`、`styles.css`：下一批错误替换上一批；详情顶部提示用卡片圆角和搜索清除样式 X，可手动关闭，与多行正文整块居中。 | 连续两批多文件错误不累积；点 X 后仅清提示，原件列表及文件任务失败状态保持。检查 aria-label、键盘激活与中英长文，关闭库再开不带旧提示。 |
| M090 | `stores/knowledge.ts`、`KnowledgePage.tsx`：创建/重命名单独用 editorError，打开、取消或保存重命名保留详情导入错误；列表读取失败不误报创建成功。 | 先制造详情导入错误，再打开/取消/保存/失败重命名，确认原提示保留且编辑器只显示编辑错误；创建后列表读取失败留在编辑器。重复创建/忙碌不能写两份，删除失败返回 false，不让确认按钮误判完成。 |
| M091 | `shared/src/stores/knowledgeIndex.ts`：dismissError 递增 errorVersion，refresh/reconcile 及排队扫描绑定错误代次，关闭/切换后旧失败不能重新出现。 | 延迟 status、全量扫描及等待全量后执行的分库扫描，关闭提示/切库后再释放失败，预期无旧错误；随后新请求失败仍正常显示。保留任务事件比迟到状态快照新的优先级。 |
| M092 | `KnowledgePage.tsx` 的 phase 标签、`services/knowledgeIndex.ts`、`uiMessages.ts`：任务与已持久化文档状态均走翻译；上传文案只列 PDF、Word、TXT、Markdown，限制说明末尾无句号。 | 实际英文界面检查 ready/failed/cancelled/disabled/unindexed 及上传区，无中文状态泄漏；选择器与文案和 M072 同源边界一致。保留保存中与索引中/完成的实际状态区别。 |

## 同步状态与菜单

| ID | owning file 与行为 | Mac 动作与验收预期 |
| --- | --- | --- |
| M093 | `shared/src/components/SyncBadge.tsx`：从悬停展开改为点击切换；点外部、Escape 或 Tab 移出关闭，Escape 返回触发按钮。`shared/test/scripts/cloud-account-smoke.mjs` 修正旧hover开菜单预期：先明确悬停200ms仍关闭，再按aria-expanded为false时click打开，避免把已开菜单再次toggle关闭；产品代码不因此改变。 | 用合成各状态在知识库、文档和其他既有消费者复核并执行本机cloud-account回归：悬停不展开、再次点收起；菜单在dialog内走原portal，不能误触底层行/关闭详情。保留键盘/Escape回焦、云端删除/恢复/暂停、原数据/状态及宽度几何断言，不能只修触发动作后跳过后续检查；Windows运行不代替Mac验收。 |
| M094 | `SyncBadge.tsx`、`shared/src/components/ui/dropdown-motion.ts`：复用 dropdown 表面/圆角及纵向展开、退出动画，通用工具兼容自有 positioner。 | 中英浅深、近窗口顶/底/侧边、滚动/resize、快速开关和卸载时核对定位；退出副本不残留或挡点击，减少动态效果立即降级。其他 Radix 下拉菜单动画不能回归。 |
| M095 | 同上、`styles.css`：首次测量固定外框宽度，入场期间抑制内部删除确认按钮初始宽度过渡，内容变化时重新校准位置。 | 慢动作核对首次弹出不左右回跳、不先展一宽再缩窄；确认/取消时保留后续按钮反馈。不是关闭全部动画来掩盖测量问题；顶部/底部翻向仍贴合触发器。 |
| M096 | `SyncBadge.tsx`、`ui/confirm-delete-button.tsx`、`styles.css`：状态/说明左对齐，底部操作占满；两项各有足够半宽时等宽并排，否则各占一行；删除胶囊用普通/确认较宽下限固定宽度，重试/冲突操作补图标。 | 中英、长说明、窄窗口核对按钮完整、无裁切；确认/取消/忙碌不伸缩且保留原危险动作二次确认。其他消费者未 opt-in fixedWidth 时沿用原宽度行为。图标由现有 Mac 适配器提供，不自行重做状态图形。 |
| M097 | `shared/src/services/cloudSync.ts::emit`：分组优先显示 deleting/pausing/syncing，全部结束后汇总 conflict/error；库 metadata 先完成不等于子文件全部已同步。 | 合成多文件增量上传、冷恢复、部分失败并继续同步/删除，活动库始终有正确操作入口，结束后不能隐藏错误。核对过时/缺失文件 mark 不导致无工作却永久转圈，进度乱序不提前显示已同步。 |
| M098 | `cloudSync.ts::loadSources/one`：本地快照在 await list 前绑定 dataEpoch，单项入口和读取/摘要后复核 sourceEpoch；旧快照不能按新代次回写 synced 或推断删除。 | 按 `cloud-sync.test.ts` 的合成延迟 list/blob 情景，快照后编辑或重建文件；旧字节不得标已同步，旧缺席不得删除云端新内容。验证后续重跑确实上传新 hash，而非只隐藏错误图标。 |
| M099 | `cloudSync.ts::dirty`：运行中编辑设置 pending 合并重跑；error/conflict 在失败冷却中保留。 | 多库、多文件队列中插入编辑，预期重新读取当前快照且不丢新 key；未变库不永久停 unsynced。保留 retry-after、容量刷新节流和失败冷却，不因轮询/dirty 高频擦除错误或重试风暴。 |
| M100 | `cloudSync.ts` 的 exclusive/pending、suppressed 及既有 `stores/cloudSync.ts` 控制保持。 | 在上传/下载、编辑重跑期间取消、删除库，确认优先控制仍执行；暂停/删除云端后新加入子文件不被重跑自动重新上传，重启仍暂停。恢复须显式用户操作，保留本地内容与分类开关优先级。 |

## 自动发送语气词过滤与真实音频接续

| ID | owning file 与行为 | Mac 动作与验收预期 |
| --- | --- | --- |
| M101 | `shared/src/services/speech.ts::isAutomaticQuestionFiller`：仅对整段批准词组匹配，NFKC 后忽略空白/标点，允许重复组合。词表为 `嗯 呃 额 唔 啊 哦 噢 喔 诶 欸 哎 唉 好 好的 对 对的 是的 行 明白 了解`。 | 纯词及“嗯？/好的？”均不自动发送；“嗯好的/哦好的”可组合匹配。`那个/这个/就是/然后/怎么说呢`、`谢谢/谢谢您`不擅自扩大到名单；“然后呢/为什么呢/行吗/嗯，为什么”有正文，照常发送。不得做单字集合、长度或话题分类。 |
| M102 | `shared/src/stores/interview.ts::submitTranscript`：仅 automatic 路径过滤；自动读取 QuestionBuffer 的系统终稿，手动保留 edited/draft/interim 逻辑。 | 合成“旧 interim=嗯、迟到 final=有效问题、音频进度已过截止”场景，实际问题须发送一次，不能按旧草稿误拦。手动纯词发送一次，保留答案与 sourceTranscriptIds；截图及手动编辑现有路径不受影响。 |
| M103 | 同上：纯回应只取消本次 gate 截止并清 automaticQuestionReady，不 consume/clear 缓冲、不加 submittedInterim。 | 过滤后原始转写/草稿仍可见，手动可发；后续有效正文与原文正常合并。重复终稿、后续 progress、生成 finally、换模型 finally 不复活旧自动请求；Qwen continuationOf 的有效追问不被误杀。 |
| M104 | `AutomaticQuestionGate`、`QuestionBuffer`、`interview.ts`：既有 1800ms 静音、系统源、真实 ACK 积压守卫、忙时排队及取消继续生效；不恢复已撤销的两阶段用量优化。 | 执行 `automatic-question.test.ts`、`interview-usage-offline.test.ts` 与 `interview-usage-smoke.mjs`：纯词自动 provider 请求 0/手动 1，有效问题 1；回答中和模型切换中就绪的纯词仍 0。保留麦克风不触发、1800ms不足/积压不能靠墙钟放行、迟到有效追问一次提交断言。 |
| M105 | `shared/test/fixtures/interview-real-audio-process.cjs`；`windows/test/scripts/interview-real-audio-smoke.mjs`：测试 WAV 经 CaptureAdapter → 生产 Controller/Worker → renderer/store → 实际回答接口计数，未伪造 ASR 回调。 | Windows 主脚本目前有 Windows 平台断言、echoCancellation 路径和 Qwen EXE 配置，**不能原样在 Mac 执行**。在 Mac 专属测试入口装配本机预处理器/运行时与音频生成或固定公开 WAV，复用共享 Controller 协议；不加正式 Mock 入口，不把 direct Worker+人工 audio-progress 当全链路。 |
| M106 | 同一真实音频夹具：模型目录先按当前 catalog 全摘要认证，再独立复制到 owner 临时目录；start 只就绪，真实 running 且 model/device 匹配后才播放 PCM；固定采样时钟与有界队列背压。 | 本机各覆盖 Paraformer/Qwen，明确设备与本机能力，不直接复制 Windows cache/runtime。音频 16 kHz mono，尾部注入真实零 PCM 静音，等待真实 ACK 的 pending=false 和 processedThrough 通过原 silenceStartMs+1800；不以 stop/limit/sentence final、空转写或只等墙钟判通过。 |
| M107 | `windows/test/scripts/filler-audio-fixtures.mjs`：Windows OneCore SAPI 在 owner 临时目录生成非零 PCM16 WAV，含“好的。”、其他纯词、正常/混合/短追问；明确为 TTS 波形。 | 不在 Mac 移植 SAPI/PowerShell、修改系统策略或采样硬件。准备来源可核验的本机 TTS/公开音频，并先断言实际非空 system final/reason=silence 及实际文本属于批准词表，再判纯词 0 请求；词表外误识别、空白或缺少有效 final 必须报告未覆盖，不能记作过滤成功。 |

## 用量、组件和下载控件

| ID | owning file 与行为 | Mac 动作与验收预期 |
| --- | --- | --- |
| M108 | `shared/src/stores/chatConnection.ts`、`Sidebar.tsx`：增加 usageLoaded；仅当前连接初读显示“正在读取 AI 服务用量…”，后台正常刷新保留上次快照与颜色，成功替换、失败正常报错。 | 用延迟合成 RPC 验证后台 RPC 已启动而侧栏仍显示旧百分比、无重复读取提示；设置页仍有其原 aria-busy/骨架。首次成功返回 null 或失败也结束初读；失败后的重试继续显示错误，不能伪造 0% 或永久加载。 |
| M109 | `chatConnection.ts`：generation/usageRevision 归属保护断开、切换、监听退出及迟到 load.finally；load 开始捕获 revision，过期链不再发起额外用量读取。 | deferred chatModels → watch start/stop → models resolve，退出后不能复活请求或回填 usageLoaded；新连接完成模型加载仍正常读取。并发 refresh 只读一次，焦点/定时刷新释放，旧账户结果不得写入新账户。 |
| M110 | `Sidebar.tsx`、既有 `accountUsageSummary.ts`/`AccountUsageSummary.tsx`/样式：后台保留结果不改变单周期一行、双周期任低于 20% 展两行、只有低百分比标黄等规则。Mac 1.0.0 已将 `.is-inline` 账号卡片纳入网格，避免英文边缘裁切。 | 延迟刷新期间与成功后分别检查单周期 0/19/20/71、双周期高低组合、中英浅深及最小窗口。合并必须保留已发行 `.is-inline` 网格，不退回旧flex；保持230px侧栏、字号、邮箱对齐、头像居中，20% 不黄、0%不当缺失。新预期不得回退成后台刷新隐藏旧值。 |
| M111 | `shared/src/components/ComponentsPanel.tsx`、`styles.css`：首次状态未知用两组/三行骨架占位，复用额度扫光；aria-busy 与 sr-only status 保留；读取错误结束占位并显示错误/重试。 | 本机延迟 components RPC，检查语音两行、RAG一行，中英浅深、减少动态效果和窄容器。真实状态替换后无残留占位，失败不永久扫光；不为骨架伪造组件状态或下载进度。 |
| M112 | `ComponentsNotice.tsx`、`styles.css`、`uiMessages.ts`：准备页提示沿聊天内容居中、最大 740px；缺失语音统一类别“语音识别”，副标题“{组件名}组件未下载，请在设置中下载或查看进度”。`windows/test/scripts/components-check.mjs` 修正旧轻量模型精确文案，改匹配“语音识别、知识库检索组件未下载，请在设置中下载或查看进度”，仅更新夹具预期。 | 分别缺 speech/qwen/rag、多组件及既有 CPU 警告，确认名称去重不误写轻量模型；准备页居中且长文可换行，其他窄消费者布局保持。Mac本机对应组件/启动回归须核对该通用准确文案及英文，不直接运行Windows专属入口；顶部提示变化不得遮住首条消息或影响composer固定位置。 |
| M113 | `shared/src/components/DownloadButton.tsx`：首次 layout 同步写实际 idle/cancel CSS 宽度，再让父 ActionTransition 测量；避免回退宽度与子级动画叠加回跳。 | 组件下载各语言/标签长度核对首次出现、进度、hover/cancel 的宽度连续；保留一秒取消保护、aria-disabled 及 iconOnly 行为。减少动态效果保持，不能删掉后续动画或加固定英文宽度掩盖问题。 |

## 聊天切换与滚动记忆

| ID | owning file 与行为 | Mac 动作与验收预期 |
| --- | --- | --- |
| M114 | `shared/src/components/PreparationPage.tsx`：仅会话 ID 切换时，中间 `.chat-thread/.welcome` 使用共享 motion 参数淡入上移；顶部 toolbar/notice 和底部 composer 不参与。 | 新对话↔历史A↔历史B、欢迎页核对固定区几何不动；首次载入、流式 delta、重命名不重播。快速切换取消旧动画；减少动态效果在启动及运行中改变时均清除动画，不留透明或 transform。 |
| M115 | `shared/src/components/useFollowScroll.ts`、`PreparationPage.tsx`：chat opt-in 按有效会话 ID 在本窗口运行期保存 top/following/hasNew；新会话默认底部，旧底部仍跟随新回复。 | 长 A 中段→短 B（会 clamp）→长 A 精确恢复，再长 B/欢迎页往返；A 原在底部且后台增长，回来仍最新。点击“返回最新”后保持后续跟随。无存储 Schema 改动，不承诺关闭窗口/重启后的阅读位置。 |
| M116 | 同上：实时 scroll 快照，不在 identity cleanup 读已换内容 DOM；syncLayout 读 live refs，忽略零高隐藏写回；新节点或隐藏恢复才恢复阅读位置。 | preparation route 常驻 hidden 时切 knowledge/history 再回、隐藏期间切 ID、welcome ref 拆挂、notice和多行 composer 改高、侧栏/个人面板改变宽度均覆盖。快速 A–B–A 的迟到 scroll/ResizeObserver/rAF 不串 ID；不要拿 viewing（也受失焦/设置影响）当身份。 |
| M117 | `useFollowScroll.ts` 的 restoreNeeded：同 ID 可见且非跟随时，普通 delta/ResizeObserver 不再写旧缓存 top，保留滚轮/拖动刚发生但 scroll 事件未送达的位置。 | 有意保留 snapshot=1100、DOM 已为1250且延迟通知，再从实际合成 provider 送 delta，DOM不能回拉到1100；恢复正常 scroll 后切换再回来保存1250。该测试发现的竞态不能只靠静态设置内存或禁用流式更新绕过。 |
| M118 | `useFollowScroll.ts` 的 identities 剪枝与辅助 ref 释放；`FloatingInterview.tsx` 无 identity/未 opt-in。 | 删除访问过的聊天，立即剪除包含旧 messages/File 的 Map 条目；当前聊天删除到 welcome 时清 restored，null/零高时清 previousNode/restored。不得增加任意 LRU 丢掉有效聊天记忆；面试浮窗原滚动自动跟随语义不变，缓存不写磁盘。 |

## 验证入口、发行与未完成项

| ID | owning file 与行为 | Mac 动作与验收预期 |
| --- | --- | --- |
| M119 | `shared/test/unit/{legacy-doc,text-encoding,knowledge-coordinator,knowledge-index-store,knowledge-reconcile,knowledge-parsing,cloud-sync,automatic-question,interview-usage-offline,account-usage-store,sidebar-usage,components-notice}.test.*` 及 renderer knowledge 单测覆盖本轮真实边界。 | 在本机实际执行完整类型/架构/单测，定向失败先按本文 owning source 修复。架构检查允许新增纯知识文件契约，但 Renderer 仍不得导入 backend/Node；保留取消、迟到、字节限额和去重断言，不跳过/放宽来凑通过。 |
| M120 | `shared/test/scripts/{knowledge,interview-usage,free-service,components-ui,typography}-smoke.mjs`、`rag-fixtures.cjs`：更新真实UI断言并生成合成DOC；`rag-reliability-smoke.mjs` 同步新的通用短错误。`cloud-account-smoke.mjs --preview` 修正滚动场景前提：600高窗口仅2份文档无溢出时标题遮罩透明是正确行为；在全部云端断言后的预览尾段，经真实UI追加6份owner合成TXT，等8行、原件加载及入场/布局稳定，确认真实overflow再滚动。 | Mac构建后按当前functional-suite --list执行完整原组，保留DOC/编码/错误归属、纯词0与手动1、用量保持、骨架/宽度等覆盖。定向预览须在本机重验真实溢出前提，再严格核对遮罩opacity、固定标题位置、滚动轨及clear原断言，不降低阈值、不改生产CSS来满足无溢出场景；临时视觉资料按owner结束清理，不以Windows预览代验Mac。 |
| M121 | `shared/test/scripts/check-architecture.mjs`、`shared/test/unit/architecture.test.ts`、`shared/docs/ARCHITECTURE.md`：新增契约纯函数与解析 Worker 边界，文档同步当前格式/编码、背压、同步快照及字面过滤。 | 核对本机生成配置包含新增源文件；执行架构/契约检查。旧“两阶段优化/2200ms/不分类”历史文字不能覆盖当前仅字面白名单和既有1800ms规则；不为测试增加正式入口或网络回退。 |
| M122 | 1.0.0 包后追加的 Store 隔离夹具修复，owning source 为 `windows/test/scripts/store-sandbox-smoke.mjs`、`store-artifact-smoke.mjs`，明细见旧表 M043–M061；1.0.1 继续沿用。 | Windows 专属，不运行/移植 Sandbox、WinPS、APPX/CDP身份注入或证书操作。旧表关于 UTF-8、完整诊断、真正运行时就绪、精确 owner 清理的原则仍用于 Mac 自身夹具；这些是测试修复，不能写成 Mac 产品行为或已验收状态。 |
| M123 | `macos` 本机签名、安装、原生音频/权限/更新 owning source 沿用 [旧清单](MACOS_1.0.0_HANDOFF.md)与 [Mac1.0.0基线](MACOS_1.0.0_RELEASE.md)。旧表M063/M065–M067的持续桌面守卫、原生测试唯一偏好域及真实lsof占用清理已纳入后续提交。 | 共享验证后补本轮本机原生、五档视觉、20轮面试与600秒音频长稳、固定签名和最终包验收；保留已发行/后续夹具修复，不能用旧Windows快照覆盖Mac树。未覆盖真实账户、硬件或原生隐藏恢复须明确说明，Windows0/1次请求或CPU运行不代验Mac。 |
| M124 | Windows GitHub 1.0.2已发布，最终源码/包输入、资产及各渠道状态由 [Windows发行索引](WINDOWS_1.0.2_RELEASE.md)及`PROGRESS.md`承接，公开产品说明见 [RELEASE_1.0.2](RELEASE_1.0.2.md)。 | 核对最终版本、commit、完整 Mac arm64 DMG/ZIP/签名清单及摘要，按匿名本平台完整稳定资产选择验证。Mac 1.0.2未完整发布前继续保留完整旧Mac资产；不因Windows新标签而选错平台，不把“打包/上传/提交认证”写成“已发布”。 |

## 发行检查追加：资源限制与异步归属

以下为测试审查发现并修复的生命周期问题，追加编号，不改写上述稳定编号。

| ID | owning file 与行为 | Mac 动作与验收预期 |
| --- | --- | --- |
| M125 | `shared/electron/backend/knowledge/host.ts`、`application/knowledge.ts`：取消只向utility发送cancel，不立即结算原请求；2份/40 MiB导入预算直到utility最终回应或确认进程exit才释放。取消后的迟到成功仍为cancelled，进度丢弃。 | 延迟实际后台解析，连续取消/快速再导入不能绕过请求数或字节背压；取消后不能显示ready或发布迟到成功。完成/失败/确认exit后才可重新占用预算，不能把发出cancel或UI结束当作真实资源已释放。 |
| M126 | `backend/knowledge/host.ts`：stop/timeout不把kill返回当退出；替代utility也等待旧exit。close整体20秒，unloadModel整体50秒（30秒卸载请求+20秒退出），等待旧退出再initialize为10秒期限；未确认exit明确unavailable并保留预算/阻止替代。`shared/test/scripts/knowledge-host-smoke.mjs` 相应改为验证迟到成功不能提前结算、等待真实exit才fork替代，不再期待超时后的旧进程继续回报取消。 | 用合成utility覆盖kill已返回但迟迟无exit、晚到exit及退出失败，确认不提前开第二进程、不误释放容量。运行真实utility边界回归，保留错误分类、取消时零provider与原15秒RAG期限；再本机验证正常退出/重建可用，超时明确失败而非无限挂起，不通过放宽deadline或假装exit解决。 |
| M127 | `backend/knowledge/{service,parser,legacyDoc}.ts`：AbortSignal经Service→parseDocument传DOC Worker；取消等待真实worker.terminate完成后结算。`process.ts` finally清input引用，Coordinator复核取消后的late success。 | 本机运行 `knowledge-host.test.ts`、`knowledge-coordinator.test.ts`、`legacy-doc.test.ts` 的延迟完成/取消/退出用例，再验证最终包DOC Worker取消与后续正常导入。PDF/DOCX仍等实际解析结束后释放预算，不宣称可即时中断；所有路径保留原件/已提交索引、取消语义及资源归属。 |
| M128 | `shared/test/scripts/conversations-smoke.mjs`：在原真实切换、取消删除、确认删除基础上，永久覆盖聊天中间动画与每ID阅读记忆，不改产品行为。 | 通过共享functional的`conversations`入口本机执行；保持合成provider与真实renderer/store，覆盖不同长短聊天位置、welcome拆挂、knowledge隐藏返回、后台流式增长/latest、固定header/composer、快速切换与减少动态效果。使用实际DOM滚动及真实hook，不直接改内部缓存或停止流式来绕过M117竞态，原删除确认断言继续保留。 |
| M129 | `shared/src/stores/cloudSync.ts`：perform/remove的catch捕获调用generation，断开或换账号后的旧操作失败不回填error；受控RPC也只允许当前generation的401派发`voxcue-cloud-expired`。 | 在实际合成engine上延迟pause/resume/remove等控制操作，A账号发起后断开或切B，再释放A失败/401，B不得出现旧错误或被旧事件触发过期刷新；B自己的新失败仍明确显示。执行`cloud-sync-store.test.ts`的延迟生命周期回归；不改云协议、账户资料或默认同步开关。 |
| M130 | 新增`shared/electron/backend/knowledge/docxArchive.ts`及`parser.ts`：DOCX以私有Buffer拷贝做实际ZIP预检，再将同一Buffer交原Mammoth流程二次解压。输入≤20 MiB、普通单卷stored/deflate ZIP、≤4096条目；单项实际展开≤32 MiB，全包实际累计≤64 MiB。拒绝加密/ZIP64/越界/头不一致；inflateRawSync按声明和剩余预算限制实际输出，并核对压缩消费长度、输出长度和CRC32。 | 本机执行`docx-archive.test.ts`、`knowledge-parsing.test.ts`及`legacy-doc.test.ts`；覆盖声明伪小的高压缩内容、累计/单项限额、空条目、CRC/头/长度损坏和正常DOCX。最终包验证helper随解析器完整编译；不升级依赖，不改Schema/索引版本，保留800万字符及“DOCX 解析失败。”边界。此项限制ZIP实际解压，不是整个XML解析器的总堆内存保证，也不宣称DOCX能实时中断；取消仍遵循M125–M127等待真实结束。 |
| M131 | `windows/test/scripts/installer-engine-smoke.mjs`：新增测试专用`--previous-version=1.0.0`核对1.0.0→当前；默认0.5.1→当前不变，只接受一个已知0.5.1/1.0.0参数。 | Windows专属，不运行/移植EXE、注册表或GUID夹具。Mac按本机最终包安装入口覆盖自身已发行1.0.0→1.0.2升级、原件/设置保留、取消及恢复；原Windows测试的独立GUID、inert EXE和owner临时安装/资料/注册项保护继续保持，参数不进入产品。 |
| M132 | `windows/test/fixtures/WindowProbe.cs`：只修改move分支及GetSystemMetrics声明。原相对32移动受系统加速可产生约65 DIP绕行，随后SetCursorPos也可能留下晚到转发；改为PMv2下按物理虚拟桌面像素中心映射的绝对SendInput，支持负origin、不合并及±1px anchor→target。仅修Windows测试夹具，产品代码不变。 | Windows专属，不复制C#或探针到Mac。Mac沿用固定宿主自己的原生输入、位置与命中校验；本机如发现旧合成移动问题，仅修对应夹具。保留owner解锁、1秒到达、90ms稳定及精确坐标要求，原native hit/hover/drag断言均须保留，不放宽容差或为夹具问题误改产品；本项仍需各自本机验证，不表示复测已完成。 |
| M133 | `shared/src/services/knowledge.ts`：不支持文件批次名单改用逗号加空格连接，不拆分或替换文件名字符；保留原先去重、顺序、截断及先整批校验逻辑。`shared/electron/contracts/uiMessages.ts` 的共享模板改为`Unsupported files: {0}`，知识库批次与composer单文件均适用，不引入service→UI/store依赖。 | 本机执行renderer `knowledge.test.ts`及`ui-language.test.ts`，再以英文选择多个不支持文件，确认应用连接符为逗号空格、原名中的中文顿号/逗号原样保留；composer单文件也使用自然模板。保留整批拒绝前不读字节/不备份/不写索引、20个及长名有界断言，不通过替换整条错误中的字符改写用户文件名。 |
| M134 | `shared/test/scripts/components-ui-smoke.mjs`：仅修模型设置几何夹具，测量前等待有限动画结束及两帧布局，再直接选择行内真实控件，不再使用可能命中菜单退出快照的`lastElementChild`。覆盖回答模型在线按钮、离线提示及两个语音选择按钮；产品代码不变。 | Mac本机执行`components-ui`及五档对应组，关闭CPU菜单后核对真实控件，不把正在退出的`aria-hidden`/`inert`快照当作表单控件。保留三行/分组、左边缘差值小于1 CSS px、同宽、标签不重叠及失败geometry诊断，不能放宽阈值或关闭动画代过；此项不表示Mac已验。 |

## Mac 本机接续补充

| ID | owning file 与行为 | Mac 动作与验收预期 |
| --- | --- | --- |
| M135 | `macos/scripts/package-app.mjs`、`macos/test/scripts/package-smoke.mjs`：显式收集 `word-extractor`、`chardet`，最终 ASAR 增加 DOC、GB18030 TXT、UTF-16LE Markdown 真实导入、精确文档检索、正文与重开持久化；先创建实际 DOC Worker 再取消并等待终止，随后正常导入。 | 使用本轮正式签名归档运行包专项，保留 PDF/DOCX/UTF-8、签名及运行时原断言；Worker 创建后取消不等同于已进入解析中，不以目录存在代替实际导入。 |
| M136 | `macos/test/scripts/{interview-real-audio-smoke,filler-audio-fixtures}.mjs`、共享 `interview-real-audio-process.cjs`：复用生产 Controller/Worker，测试夹具仅参数化本机预处理器路径。已安装 macOS 中文 voice 文件 TTS 生成非零 16 kHz PCM16 WAV，模型按 catalog 全摘要认证并复制到 owner 临时目录。 | 串行执行 Paraformer/CPU 与 Qwen/Metal，按需补 Qwen/CPU；默认“好的。”和正常问题，`--all`追加其他纯词、混合正文、短追问。必须非空 silence 终稿、真实 ACK 跨越 1800 ms、Renderer 收到实际事件后再判断自动 0/1 和手动 1；词表外识别如实报告，不改词表代过，不采样硬件。 |
| M137 | `shared/test/scripts/conversations-smoke.mjs`、`macos/test/scripts/ui-refinement-matrix.mjs` 与名单单测：五档纳入现有聊天回归，并补真实 DOM 从 snapshot 1100 移至 1250、延迟 scroll 通知期间由合成 provider 送实际 delta 的竞态。 | 不改内部 hook 缓存，不停止流式；delta 后保持 1250，恢复通知、切换回来仍为 1250。原删除、动画、welcome/hidden、后台增长和减少动态效果断言保持。 |
| M138 | `macos/test/scripts/package-upgrade-data.mjs` 由 `package-smoke.mjs --install-archive` 串行调用：真实已发行 1.0.0 临时副本以旧 UI 写合成资料、设置和原件，旧包建立实际索引；关闭且确认无占用后同路径展开最终新 ZIP，保持原 owner profile。 | 核对个人资料、主题/语言、原件字节/元数据、旧索引与实际 UI；此项为正式归档覆盖升级的数据兼容验收。原 Sparkle 认证/暂存/取消与独立原生 commit/relaunch 回归保持，不把归档覆盖称为真实自动更新提交。 |
| M139 | `macos/test/scripts/components-smoke.mjs`：安装态顶部组件提示的旧“轻量语音识别”断言改为 M112 已确认的完整“语音识别、知识库检索组件未下载，请在设置中下载或查看进度”，按精确全文匹配。 | 重跑原真实打包组件入口；模型设置行仍使用具体模型名称，后台缺失模型错误分类保持。不改产品文案，不扩大等待期限或放宽布局/下载断言。 |
| M140 | `macos/test/scripts/filler-audio-fixtures.mjs`：本机 voice 列表使用本地化全名时，短名只能唯一匹配已列出的完整名字；相同全名去重，歧义或缺失仍拒绝，允许名字中的全角括号。 | 只使用本机已安装 voice，不安装/下载或播放；不因短名与本地化名字不同而误拒。不改变 WAV、真实非空终稿及过滤断言，短音节无法识别仍明确报告未覆盖。 |
| M141 | `shared/test/scripts/updates-smoke.mjs`：鼠标长按失败时输出有界指针事件、焦点/可见性、实际几何与命中、更新状态及原生窗口状态，仅记录当前合成窗口，结束移除监听。 | 通过真实输入区分未命中、移出/失焦取消和状态变化；保留 4700 ms 零次、生产 5000 ms、原等待期限、恰好一次及释放不重复的断言。不以重试或伪造事件替代失败，不据无 DPI 分支推断根因。 |

## Mac 本机执行顺序

以下均为待执行操作，不是已运行记录。除仓库根同步外，工作目录为 `macos/`；不通过修改系统辅助功能、锁屏权限或签名身份取得测试条件。

1. 读取 AGENTS/PROGRESS、检查 status/diff 和最终源码 SHA；以已公开 Mac1.0.0 的 M001–M067 为保持基线，再按 M068–M134 核对本轮新增范围。只在本机同步生成配置/锁及必要打包依赖，不写 Windows 树；保留其后原生夹具维护。
2. 在本机执行 `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:workspace`、`pnpm test`、`pnpm audit`、`pnpm build`；优先定位本表列出的纯单测与 Renderer 单测。保留当前所有必需检查，不把 Windows 条件跳过作为完成。
3. 按本机 desktop-session 守卫确认控制台，再串行运行当前 `functional-suite.mjs --list` 列出的完整功能入口。固定服务端参考仍按 `server-reference.mjs` 的 owning source 校验，只用临时合成客户端联调，不改服务端。
4. 增补并运行 Mac 专属真实 WAV→ASR→gate→renderer/store→provider 用例，满足 M105–M107 的非空终稿、实际音频ACK及请求计数前置条件；Windows主脚本不可直接执行。对不可稳定识别的短音节如实列明未覆盖，不放宽词表或用空文本代过。
5. 使用本机五档矩阵（100/125/150/175/200%）核对中英浅深、最小窗口、知识库行错误/同步菜单、组件骨架/下载宽度、用量保持以及聊天动画/位置；特别执行 M117 的延迟scroll通知竞态及原阅读/跟随矩阵。
6. 保留20轮面试、显式600秒固定公开音频、Mac原生窗口/权限/AEC/模型切换/更新/签名检查。临时资料、模型副本按owner清理，公开认证缓存保留；不保存测试报告或截图到工作区。
7. 按本机原入口构建准确1.0.2正式包，运行 `package-runtimes-smoke.mjs`、`package-smoke.mjs --install-archive` 及固定签名检查；对最终包重新验证DOC Worker/编码依赖，不用临时测试包代替正式资产。
8. 在当前用户授权允许发布后才上传Mac完整资产，并用相同准确版本目录执行 `--online` 匿名完整回读及签名/摘要验证；更新发行索引和PROGRESS真实状态。交接文档不记录分数、临时路径或假定完成状态。

后续新增修复从 **M142** 追加。Windows已公开版本、准确源码/包输入及Microsoft Store实际状态以 [Windows 1.0.2发行索引](WINDOWS_1.0.2_RELEASE.md)为准；本轮Mac接续、签名与发行须在Mac本机完成后据实更新。
