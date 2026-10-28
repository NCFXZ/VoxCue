# Windows 0.6.0 → 0.6.1 逐项交接

本交接对应客户端产品差异 `61507d0d937ad0b736d1ca7b04fa45b551a2c9e6..88875908574d445d43a40f3eeb63013dcb31fb4b`，共29个受控源码、测试、配置和文档文件。后续Mac发行与本交接属于独立交付，不新增产品逻辑。逐文件清单见[客户端源码交接](CLIENT_0.6.1_HANDOFF.md)，各功能背压边界见[后台背压](BACKPRESSURE.md)。

Mac已完成本机测试，但这不能替代Windows本机的原生、DPI、音频和安装器验收。本文的C001–C040和V001–V012均须由Windows Codex逐条核对；不能把“源码已存在”记作本机测试通过。可直接使用[Windows Codex提示词](WINDOWS_0.6.1_CODEX_PROMPT.md)。

## 接续基线和保护范围

- 在Windows上先检查 `git status`、当前分支与远端，保留未提交工作和远端提交，不重置或强推。Windows 0.6.0发行曾对应 `d35c06e`；本次比较基线已包含后续Mac 0.6.0修复 `61507d0`，不能把那些0.6.0改动误记成本次新增，也不能因本机较旧而撤回它们。
- 产品版本唯一源为 `shared/package.json`。本次Mac仅生成根及 `macos/package.json` 的0.6.1，`windows/package.json`故意保持0.6.0；Windows须运行同步脚本生成本平台配置。不要手改生成清单，也不要复制Mac锁或原生二进制。
- 服务端0.5.1独立仓库固定 `43b6a973849bdc3c204d8434a21857b943048758`，始终只读。`shared/server/`是被忽略的测试参考，不进入客户端Git或包；接口适配只修客户端。禁止生产写入、数据库/管理员/邮件/DNS/云权限/支付修改、部署或重启。
- 固定SDK 1.0.21、Codex 0.164.0、现有依赖/锁、模型、索引格式、RAG v7、代码签名/凭据/更新身份保持。Windows修改只涉及本平台必要适配及已有shared契约；`macos/`和Mac发行资产只读。
- GUI/原生测试串行，仅在当前用户已登录且解锁的Windows输入桌面执行。使用隔离合成账户、原件、图片、捕获及固定公开临时模型/音频，不读真实账户、凭据或资料，不采样物理音频。普通UI夹具禁止正式凭据助手；原生加密只用已有显式隔离夹具。锁屏、非交互会话或未知状态保留待验，不能放宽断言换通过。
- 测试模型、profile、数据库、截图及临时包由owner生命周期退出清理。结果仅终端/对话，不保存新的结果报告或截图到工作区，不提交包/模型/构建/测试产物/凭据。清理先查消费者、真实路径和占用，保护历史跳过目录、发行和恢复基线。

## 产品改动和逐条验收

表中“定向单测”指下文命令A；“知识库桌面”指命令B。需要观察队列时使用合成夹具的IPC调用记录或既有状态事件，不新增产品UI或把内部实现暴露给用户。

| ID | 0.6.0 → 0.6.1改动及文件 | Windows逐条操作和通过条件 |
| --- | --- | --- |
| C001 | `shared/package.json`唯一版本0.6.0→0.6.1；根和Mac生成版本同步，依赖/锁无变化。 | 本机同步后根、shared、Windows版本均为0.6.1；Mac文件无差异；依赖/锁和固定运行时不升级。 |
| C002 | `services/cloudData.ts`新增受检首块文件头归属读取；冷恢复以前缺少文件所属库。 | 清空合成原件及同步baseline，用云端交错顺序的两库恢复；文件归属准确，非法ID、错误key或个人简历归属不被当作知识库文件接受。 |
| C003 | `services/cloudSync.ts`提取清单/分块下载校验供预读和实际下载共用。 | 篡改首块、摘要、分块序号/长度、清单大小或条数；拒绝坏数据且保留本地原件，不提交索引或错误baseline；不能为成功跳过校验。 |
| C004 | 冷恢复预读的已校验首块缓存最多4 MiB，按远端版本匹配并在本轮结束释放。 | 多文件超过四个首块时缓存保持有界；缓存版本不符重新读取；停止/异常路径不继续持有本轮首块。 |
| C005 | 先发现归属，再按知识库组织完整恢复；以前冷恢复可能交错多个库。 | 云列表顺序为 `b-2,a-1,b-1,a-2`，完整文件的落盘顺序按库聚合；一个库处理后再进入下一库，文件在库内沿用已确定顺序。 |
| C006 | 父级状态聚合本地、远端、baseline子项，活动库纳入syncing。 | 恢复过程中父库保持“正在同步”，不因父项先落盘而显示未同步/已同步；最后文件完成后变已同步；错误、冲突、暂停优先级保持。 |
| C007 | 文件父级关系写入成功baseline，分组操作不再只依赖当前本地文件。 | 恢复后重启合成引擎，再暂停/恢复指定库；只影响本库及其子文件，另一库状态保持。 |
| C008 | 暂停尚未完成首次恢复的条目标记 `unrestored`；以前恢复时可能误判本地删除。 | 在第二块阻塞时暂停库、重启、再恢复；未完成文件继续下载，云端副本仍在，不能发送remove；已恢复文件不重复破坏。 |
| C009 | pull成功后重新加载本地来源，保存实际恢复后的父级信息。 | 同一轮恢复后的状态及后续同步读取到已落盘原件；没有重复上传自己刚恢复的内容或把它误当作缺失。 |
| C010 | `services/knowledge.ts`的事务保留默认本地编辑通知，云恢复两种写入显式关闭该通知。 | 云恢复base/file不发送用户编辑事件；用户正常导入、替换、删除仍发送通知并触发原有同步；事务/版本守卫继续拦截并发编辑。 |
| C011 | `applyCloudItem`只在受检原件成功提交后返回该文档，其他类别保持原契约。 | 强制写事务失败/取消/账号切换时不索引；成功索引的bytes能从已提交IndexedDB原件读到；profile、resume、record、image恢复照常。 |
| C012 | `stores/cloudSync.ts`在恢复文件成功后立即提交索引，不等待整库，也不等待索引结束才下载下一文件。 | 阻塞 `a-2` 第二块时 `a-1`已发出import；阻塞索引时后续下载仍完成；索引失败不回滚已下载原件或云同步成功状态。 |
| C013 | `stores/knowledgeIndex.ts`用单工作者执行索引；维持用户明确要求的单任务。 | 80文件及重复请求并发进入时，实际同时活动import最大值严格为1，80份原件无缺失；不引入并行解析/嵌入参数调整。 |
| C014 | 索引选取优先当前库已排队文件，再取下一个库；不会等待尚未收到的同库文件。 | 交错入队 `a1,b1,a2,b2,a3,b3`，预期 `a1,a2,a3,b1,b2,b3`；仅a1收到时立即执行。若当前库已无待办，可处理其他库，不能添加“等整库”屏障。 |
| C015 | 文档ID去重，未开始任务合并最新版本/force；同版本活动请求复用完成Promise。 | 同一文件连续重复请求只执行一次；待办替换后用最新内容，强制索引操作保持原用户语义，无重复队列膨胀。 |
| C016 | 队列只保存元数据，到执行时读取最新本地原件。 | 入队时不预读整批Blob字节；等候期间替换文件后执行最新bytes，不能索引旧闭包中的原件。 |
| C017 | 排队时已删除的文档跳过；活动导入期间替换可排一个后续版本任务。 | 第一份索引阻塞期间删除第二份、替换第三份；第二份不import，第三份用新bytes；活动同ID替换后恰有一次后续工作，始终单任务。 |
| C018 | 状态refresh合并为一份进行中的请求；返回状态时保留本地排队任务。 | 同时100次refresh只发生一次状态读取；刷新不能清掉本地queued/requestId，完成后requests正确回收。 |
| C019 | 状态事件与刷新响应增加版本/请求隔离，防止晚到快照或旧请求覆盖当前任务。 | 在status尚未返回时注入更新事件/新任务；界面不倒退到旧状态，旧requestId事件不覆盖替换任务。 |
| C020 | 主窗订阅索引；最后消费者断开时清队列、检查、冷却并取消活动IPC。 | 登录/退出、路由挂载/卸载及重复cleanup后无重复订阅；最后断开只取消实际活动request，未开始任务结束且不会继续import。 |
| C021 | 同一失败原件自动重试冷却60秒，最多保留256条尝试记录。 | 失败后反复开库/检查不形成重试风暴，其他文件继续；显式force及更新原件不被旧冷却永久阻止；时间边界用可控时钟验证。 |
| C022 | 执行前把任务revision更新为落盘原件的真实localRevision。 | 云恢复返回对象尚无localRevision，首次索引失败后立即开库检查仍只import一次；这专门覆盖过往“恢复后首次开库绕过冷却”的缺陷。 |
| C023 | `App.tsx`在已登录主窗且RAG模型就绪时检查全部原件。 | 有一份ready、一份停用、一份缺失索引时，启动仅补后两份；模型暂缺时不报错、不循环下载，模型就绪后再补；登录窗口不执行主窗检查。 |
| C024 | `stores/knowledge.ts`在打开库的文档列表提交后非阻塞检查该库。 | 开A库只补A库缺失/停用项，B库不被无故全量重建；列表展示不等待索引结束，正常导入/删除/预览保持。 |
| C025 | 恢复检查按库组织、同范围检查复用；全局检查期间到达的开库请求有后续窄范围补查。 | 同时启动检查与开库，重复调用合并；检查期间新增当前库原件不会被漏掉；ready/processing/queued项不重复提交。 |
| C026 | `App.tsx`连续cloud-applied知识库通知合并为一个活动列表刷新和必要后续重查。 | 批量落盘不触发无界并发load/open；最后列表完整，选中库正确，退出effect后不继续循环；profile/history原有刷新保持。 |
| C027 | `services/knowledgeIndex.ts`将默认UUID请求ID参数明确为string类型。 | 三套类型检查通过；自定义请求ID和原IPC契约不变，不因此改变请求身份或取消行为。 |
| C028 | `CloudStorageSummary.tsx`去掉分段和图例的原生title属性。 | 鼠标悬停容量条及三类图例不弹“知识库：…字节”等提示；MB、颜色、比例、尺寸和总量aria-label保持。 |
| C029 | `cloud-data.test.ts`及`cloud-storage-summary.test.tsx`补恢复返回值、编辑通知和无title回归。 | 运行命令A对应两文件，保留原损坏数据/计量/无障碍断言；不能通过删旧断言换绿。 |
| C030 | `cloud-sync.test.ts`补冷恢复整库顺序、活动父级状态、坏首块和暂停重启恢复。 | 对C002–C010执行定向单测；断言原件/云副本/基线/状态，而非只检查调用次数。 |
| C031 | 新增 `cloud-sync-store.test.ts`覆盖落盘→自动索引、下载不被索引阻塞、失败保数据及真实版本冷却。 | 两个成功/失败分支都跑，特别验证C012/C022；不访问生产账号。 |
| C032 | 新增 `knowledge-reconcile.test.ts`覆盖80文档背压、交错分组、即时索引、恢复检查、变更和断开。 | 完整运行各用例；记录最大活动import=1、无原件丢失、重复检查合并及退出取消。 |
| C033 | `knowledge-smoke.mjs`增加两库四文件、交错云列表、第二块屏障及开库/启动恢复的真实Renderer/IPC夹具。 | 命令B在Windows生产界面通过，预期import顺序 `a-1,a-2,b-2,b-1`，a1在a2下载完成前已索引；不是只运行Node模拟。 |
| C034 | `install-ui-account.mjs`新增精确自有窗口focus helper，仅Mac执行。`web-materials`和`chat-progress`使用它并先移开指针。 | Windows helper应直接返回；沿用Windows窗口/指针守卫，悬停断言照常通过。不能把Mac focus实现复制成Windows原生逻辑或改变产品焦点。 |
| C035 | `updates-sidebar-smoke.mjs`在原3秒采样上限内等待有限CSS过渡实际结束，忽略无限动画。 | 各DPI下仍检查端点opacity、颜色、整组交叉淡化和圆弧端帽；不改220ms产品动画，不放宽原断言或靠固定长sleep通过。 |
| C036 | `AGENTS.md`、`PROGRESS.md`和`README.md`记录0.6.1授权、最终队列语义、版本及平台边界。 | 核对与最终代码一致；保留0.6.0和更早历史，不能把历史测试数字当作Windows0.6.1实测。 |
| C037 | `shared/test/README.md`补新测试入口，`BACKPRESSURE.md`说明各模块既有保护及本次局部修改。 | 聊天、面试等没有新增全局调度器；对照下文V001–V012验证原保护，不擅改正常UI和功能限额。 |
| C038 | `WORKSPACE_CLEANUP.md`记录撤回的整库等待接口/重复状态已清理，保护现用模块和恢复基线。 | 静态/动态消费者检查无新闲置代码；不要为扩大清理量删兼容或有效测试。Mac的Finder元数据及其一次占用误删属于历史记录，Windows不重做。 |
| C039 | `CLIENT_0.6.1_HANDOFF.md`记录29文件白名单、命令和平台边界。 | 用 `git diff --name-status 61507d0..8887590`逐文件对上表与该清单；每个差异块有归属，不能混入服务端、锁升级、模型或产物。 |
| C040 | 用户随后授权Mac0.6.1三项正式发行并设Latest；Windows本轮没有0.6.1发行。 | 线上最新标签为v0.6.1且只有Mac DMG/ZIP/latest-mac.yml；Windows更新选择器须跳过该Mac专用发行，仍选择完整Windows0.6.0。不要把缺少Windows0.6.1包当作应删除/重发旧包的理由。 |

## 未改业务的完整回归

这些是已有保护，不能写成0.6.1新增功能。共享索引/云同步改动后仍需确认正常流程未受影响。

| ID | 模块与Windows通过条件 | 主要入口 |
| --- | --- | --- |
| V001 | 聊天发送、流式回复、停止/重试、联网搜索、技能提案保存；单活动请求和迟到结果隔离保持，保存/刷新/草稿正常。 | 完整功能套件中的chat-response、chat-progress、chat-lifecycle、conversations、profile相关组。 |
| V002 | 聊天附件、文件夹导入、知识库PDF/DOCX/TXT/MD预览和检索；原有数量/大小/深度上限、原件恢复与取消保持。 | knowledge、rag-core、rag-ui、knowledge-host及adversarial；真实临时E5/LanceDB。 |
| V003 | 面试手动/自动回答、问题聚合、停止/重试、结束确认、尾段保存及20轮场次切换；不跨场次串数据。 | interview-usage、interview-retry、interview-stability及Windows interview-workflow/context/access。 |
| V004 | 语音PCM上限、WASAPI/AEC、设备切换、降级/失败保护、关闭释放；合成音频至少600秒稳定性。 | audio-pipeline、speech-soak、Windows speech-adversarial、echo-cancellation、wasapi-packets、components-native等。物理采集需用户明确授权才做。 |
| V005 | 截图五张上限、忙碌保护、发送/归档/记录查看、缩放/平移/翻页、取消保存和按ID导出；无任意路径/越权写入。 | interview-screenshot、adversarial和Windows原生呈现/包验收。 |
| V006 | 记录保存/搜索/自动标题/手动标题/删除、关闭时保存确认；标题去重、队列上限、超时及晚到结果保护。 | history-branding、chat-lifecycle、interview-stability。 |
| V007 | 邮箱主账号、AI登录/续期、退出/切账号、额度与心跳；互斥、合并刷新、撤销/过期及迟到隔离保持。 | cloud-account、login、copilot-login/runtime、chatgpt-single-login/usage-runtime、login-entry和服务连接合成夹具。 |
| V008 | 本地组件/更新单下载、取消、校验、离线复用、未知原件保护，面试禁装/关闭保存/首秒取消保护。 | components-ui、updates、updates-sidebar、Windows components-native、updates-native。 |
| V009 | 安全与对抗：畸形云包/IPC/文件ID、超限、账号切换、取消、网络失败/Retry-After、过期凭据；原件与云副本不误删。 | 命令A、完整adversarial/cloud-protocol/cloud-quota、Windows原生隔离安全夹具；`pnpm audit`。 |
| V010 | 浅深色、100/125/150/175/200% DPI、窄宽窗口、减少动态/透明度及高对比；侧栏、聊天、面试、截图、更新按钮对齐且可操作。 | Windows DPI矩阵及本机目视。Chromium媒体仿真与实际系统设置分开记录，不能互相冒充。 |
| V011 | Windows原生窗口、快捷键、凭据、音频、组件、更新和薄包依赖；Fluent图标/Windows材质及现有身份保持。 | Windows专属回归矩阵，不能使用Mac的SF Symbols/Keychain/Sparkle结果代验。 |
| V012 | Windows0.6.1临时portable/NSIS静态及合成运行验包，安装器/清单/blockmap完整；不替换用户真实安装或公开发行。 | `test:portable:native`、`test:installer:isolated`；所有包位于owner临时目录并退出清理。 |

## Windows执行命令

先在仓库根目录保护现有工作并获取上述提交，再执行：

```powershell
node shared/scripts/sync-platform-manifests.mjs
pnpm --dir windows install --frozen-lockfile
pnpm typecheck
pnpm check:architecture
pnpm check:workspace
pnpm test
pnpm build
```

命令A：在 `windows/` 中执行六个定向单测文件，之后仍要保留上面的完整单测：

```powershell
pnpm exec vitest run --config ../shared/vitest.config.mjs ../shared/test/unit/cloud-data.test.ts ../shared/test/unit/cloud-sync.test.ts ../shared/test/unit/cloud-sync-store.test.ts ../shared/test/unit/cloud-storage-summary.test.tsx ../shared/test/unit/knowledge-index-store.test.ts ../shared/test/unit/knowledge-reconcile.test.ts
```

命令B及完整Windows回归，在仓库根目录串行执行：

```powershell
pnpm test:knowledge
pnpm test:windows:functional
pnpm test:windows:regression
pnpm test:ui:dpi
pnpm --dir windows audit --json
pnpm test:portable:native
pnpm test:installer:isolated
```

这些入口分别由共享完整功能、Windows原生组、五档DPI组及临时包夹具执行。DPI当前为14组×5档，不应拿Mac的10组×5档数字要求Windows减少覆盖；Windows专属回归当前15组。功能组数和单测数从实际输出读取，不能硬编码Mac成绩。首次构建可能需要既有固定公开组件；不得因缺环境改用真实用户缓存或采样硬件。不要在Windows执行Mac的Qwen/Sparkle/Keychain脚本，也不要在Mac代跑Windows GUI。

每项终端/对话记录 `ID | 通过/修后通过/待验/不适用 | Windows命令或实际步骤 | 断言/现象 | 首次失败与修复复测`。静态核对和自动/原生/目视结果分开；待验明确机器或授权缺项。不要仅写“全量通过”。若修复产品源码，按影响范围重跑单测、定向、本机完整矩阵及最终包；仅交接文字修订做文档核对，不能冒称又重跑产品矩阵。

## Mac交付与Windows发行边界

Mac0.6.1发行目标：[VoxCue-releases/v0.6.1](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.1)。三项为 `VoxCue-0.6.1-arm64.dmg`、`VoxCue-0.6.1-arm64.zip`、`latest-mac.yml`，用户明确要求本次标记Latest。Windows0.6.0及全部旧草稿、模型资产保持；Windows更新按平台完整资产选择，不能仅因Latest为Mac版而下载Mac包。

本交接只要求Windows本机逐条测试和必要客户端修复复测，不自行发布Windows0.6.1、修改Latest或替换真实安装。是否上传Windows包须以后续用户明确指令为准。客户端源码与详细内部交接只进入既有私有 `NCFXZ/VoxCue`；公开发行只含对应平台安装/更新文件和简短用户日志，不包含服务端、内部测试结果或凭据。
