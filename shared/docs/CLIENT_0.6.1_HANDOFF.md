# 客户端0.6.1源码交接

本轮基于私有 `NCFXZ/VoxCue/main` 的 `61507d0`，保留既有0.6.0实现。用户授权清理、完整功能/背压/安全/对抗/UI视觉验收及修复复测后推送0.6.1源码；本次不发布安装包，不改变公开0.6.0发行、Latest、模型资产或真实安装。

以上为8887590源码推送阶段的授权记录。用户随后另行授权Mac0.6.1三项正式发行并标记Latest，以及Windows详细交接；当前范围见[Windows逐项交接](WINDOWS_0.6.1_HANDOFF.md)及[Codex提示词](WINDOWS_0.6.1_CODEX_PROMPT.md)。此后交付只增加文档和发行，不改下面对应的产品实现或29文件比较范围。

知识库云恢复先发现并校验文件归属，再按知识库串行下载。父级状态包含云端待恢复文件，下载时保持“正在同步”；云端恢复写入与用户本地编辑区分。原件保存成功后立即提交本地索引，不等待同库其他文件下载。多个库已有文件排队时，优先处理完当前库已收到的文件后进入下一库；单任务执行，不做并行索引。

模型就绪后的主窗口启动检查全部原件，打开知识库再检查该库；只补齐缺失或停用索引。索引队列按文档去重，只保留任务元数据，执行前读取最新原件并记录实际本地版本，跳过已删除项并使用替换后的内容。索引状态读取、重复检查及连续同步后的列表刷新合并；同一失败原件有一分钟自动重试冷却，云恢复得到的无本地版本对象也使用落盘后的实际版本进行冷却比较。取消未完成首次下载后恢复，会继续下载，不把未恢复原件误判为本地删除。

云容量条与图例的原生 `title` 悬停提示移除，MB文字、颜色、尺寸及无障碍总量标签保持。其他聊天、面试、语音、截图、记录、认证、组件与更新已有的背压保护保留，见[后台背压](BACKPRESSURE.md)。

## 逐文件源码白名单与用途

| 路径 | 用途 |
| --- | --- |
| `AGENTS.md` | 记录本次0.6.1源码推送授权、即时逐文件/逐库索引及平台边界。 |
| `PROGRESS.md` | 记录最终代码行为与验收入口，不保存执行结果。 |
| `README.md` | 工作区0.6.1、自动补索引说明；公开发行仍明确为0.6.0。 |
| `shared/package.json` | 唯一版本源更新为0.6.1，固定依赖不变。 |
| `package.json` | 根平台命令转发的生成版本。 |
| `macos/package.json` | 本机生成的0.6.1配置，依赖/锁不升级。 |
| `shared/src/App.tsx` | 主窗口订阅索引、模型就绪后检查及同步通知合并。 |
| `shared/src/components/CloudStorageSummary.tsx` | 移除分段与图例的浏览器原生悬停提示。 |
| `shared/src/services/cloudData.ts` | 有界文件头归属校验，成功落盘后返回受检原件供索引。 |
| `shared/src/services/cloudSync.ts` | 首次恢复按库排列、父级状态聚合、校验过的首块缓存、父级关系持久保存及暂停后继续下载。 |
| `shared/src/services/knowledge.ts` | 云恢复事务不发送用户编辑通知，保留原事务与本地版本保护。 |
| `shared/src/services/knowledgeIndex.ts` | 显式声明请求ID字符串类型，沿用原知识库IPC。 |
| `shared/src/stores/cloudSync.ts` | 成功恢复原件后立即提交索引；账号与停止守卫保持。 |
| `shared/src/stores/knowledge.ts` | 打开知识库后检查该库索引，不阻塞文档列表展示。 |
| `shared/src/stores/knowledgeIndex.ts` | 单任务、按库优先的文档去重队列，原件复读、恢复检查、状态合并、冷却和生命周期取消。 |
| `shared/test/scripts/install-ui-account.mjs` | 为Mac悬停验证提供精确自有窗口焦点前置条件。 |
| `shared/test/scripts/web-materials-smoke.mjs` | 在正确窗口与新鼠标移动后核对原中性高亮断言。 |
| `shared/test/scripts/chat-progress-smoke.mjs` | 精确窗口焦点与鼠标悬停，保留箭头和输入框断言。 |
| `shared/test/scripts/updates-sidebar-smoke.mjs` | 采样结束等待实际有限过渡完成，保留端点、交叉淡化及圆角断言。 |
| `shared/test/scripts/knowledge-smoke.mjs` | 两库四文件交错云端顺序、单文件即索引、按库下载/索引、开库与启动补索引的真实Renderer/IPC合成夹具。 |
| `shared/test/unit/cloud-data.test.ts` | 原件返回、无伪本地编辑事件及已有恢复安全边界。 |
| `shared/test/unit/cloud-storage-summary.test.tsx` | 容量比例与无障碍文字保持且无原生title提示。 |
| `shared/test/unit/cloud-sync.test.ts` | 首次多库恢复顺序、同步状态、损坏首块、取消/重启/恢复及云副本保护。 |
| `shared/test/unit/cloud-sync-store.test.ts` | 原件先落盘、逐份触发索引、单任务与索引失败时保留下载。 |
| `shared/test/unit/knowledge-reconcile.test.ts` | 批量重复请求、交错多库分组、即时索引、恢复检查、删除/替换及退出取消。 |
| `shared/test/README.md` | 0.6.1背压、恢复与视觉夹具的入口说明，不保存执行结果。 |
| `shared/docs/BACKPRESSURE.md` | 各功能既有保护与本次最小改动的边界。 |
| `shared/docs/WORKSPACE_CLEANUP.md` | 仅清理路径、数量、占用失误说明及保护范围。 |
| `shared/docs/CLIENT_0.6.1_HANDOFF.md` | 本交接与白名单。 |

## Windows接续与验收入口

Mac只生成根与 `macos/package.json`，`windows/package.json`仍为上一版本；Windows本机获取源码后运行 `node shared/scripts/sync-platform-manifests.mjs`，生成本平台0.6.1配置，再执行类型、架构、单测、构建、功能和DPI矩阵。共享依赖未变化，不复制Mac锁文件或原生构建。Mac共用逻辑和视觉检查不能代替Windows本机验收。

单测入口为 `pnpm test`，重点为上表的云同步、原件及索引检查用例。完整Mac入口为 `node ../shared/test/scripts/functional-suite.mjs`，缩放入口为 `node test/scripts/ui-refinement-matrix.mjs`，辅助功能与自有窗口预览为 `node test/scripts/cloud-accessibility-smoke.mjs --preview`，可选Qwen原生/Worker/切换/释放为 `node test/scripts/qwen-regression.mjs`。最终包检查仅用 `node test/scripts/package-temporary-smoke.mjs` 在owner临时目录生成并退出清理，不输出正式发行。

服务端0.5.1固定提交 `43b6a973849bdc3c204d8434a21857b943048758`、Windows专属、固定SDK/Codex、模型/索引/RAG v7、macOS14.2/arm64及代码/凭据/更新身份保持。全部测试使用隔离合成资料/账号/图片与固定公开临时音频/模型，GUI/原生串行，锁屏或未知会话停止；执行结果仅终端/对话，不把报告、截图、包、模型、凭据或清理审计加入源码提交。
