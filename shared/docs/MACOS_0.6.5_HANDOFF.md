# Mac 0.6.3 → 0.6.5 更新交接

本文记录变化、实现位置和可执行验收要求，不保存测试成绩。当前进度与发行链接以PROGRESS.md为准；旧文档中的一次性授权不延续。

## 比较基线与边界

- Mac基线为已发布0.6.3产品源码快照`c37fa181156617c58bc3eb4a509334057d4a38f3`，来源见[Mac 0.6.3发行索引](MACOS_0.6.3_RELEASE.md)。不要使用0.6.2的8eb42a7作为此次变化基线。
- 接续前Windows客户端HEAD为`11e5f089cba0fe2c3eda351c329ad4d03c266864`；后续0.6.5提交需核对真实远端，保留Mac本机及远端后续工作，禁止reset、clean、强推。
- 客户端版本唯一来源为`shared/package.json=0.6.5`。Mac本机运行同步脚本只生成根/Mac，Windows全树只读；Windows不会代写macos树或复制锁文件。
- 独立服务端固定0.5.3、`3bceb615dbba900f669322c301fc4b5b473dfb15`，统计schema 2；其源码、配置、依赖、数据库及生产运行均禁止修改。`shared/server`旧参考继续只读，不纳入客户端提交。
- 完整阅读独立服务端`API.md`、`CLIENT_TELEMETRY.md`、本仓库[客户端统计](CLIENT_TELEMETRY.md)及本页；不得仅依赖摘要。服务端0.5.3的账户/备份仍为v1，统计只支持v2。
- 已发布Mac0.6.3的v1统计不会自动适配；必须运行新构建。0.6.5共享修改不需要新增Mac专属实现，但Mac凭据助手、文件系统、原生窗口、图标、权限和安装/更新必须在Mac本机验收。
- 固定SDK1.0.21、Codex0.164.0、现用模型/索引/RAG v7与全部代码签名、凭据助手、host-id、Ed25519身份；不自动升级或轮换。依赖安全补丁的最终授权范围见PROGRESS.md。

## 逐条变化与验收

每行单独记录`ID | 通过/修后通过/待验/不适用 | 实际命令/步骤 | 断言 | 首次失败、最小修复与复测`。一条通过不能覆盖其他条目；没有对应环境则如实待验，不以标签、Mock或Windows成绩代验Mac原生、真实HTTP和DPI。

| ID   | 相对Mac0.6.3的变化                         | 实现入口及Mac逐项要求                                                                                                                                                           |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U001 | 目标版本更新为0.6.5。                      | shared/package.json；同步后运行版本、包版本与更新元数据必须一致。                                                                                                               |
| U002 | 根/本平台清单按共享源生成。                | shared/scripts/sync-platform-manifests.mjs；Mac仅生成根/Mac，确认Windows字节不变。                                                                                              |
| U003 | 组件缺失提示复用统一展示表。               | backend/components/service.ts；轻量语音识别、多语言语音识别、知识库检索，不回显内部模型ID。                                                                                     |
| U004 | 知识库未安装/加载失败统一称知识库检索。    | backend/knowledge/embedding.ts；错误保留原件，绝不转远程模型或假成功。                                                                                                          |
| U005 | 新建知识库缺少组件时使用统一名称。         | stores/knowledge.ts；禁用/准入条件不放宽。                                                                                                                                      |
| U006 | 选择知识库缺少组件时使用统一名称。         | stores/preparation.ts；状态及选择行为不变。                                                                                                                                     |
| U007 | 开始面试缺少已选知识库组件时使用统一名称。 | PreparationPage.tsx；原预检、权限和几何断言保持。                                                                                                                               |
| U008 | 修复中文标点后紧接正文时遗留的粗体标记。   | services/markdown.ts、MarkdownContent.tsx；例如`**已核实的 JD。**下面`显示粗体而不显示星号。                                                                                    |
| U009 | 修复结束标记前含尾部空格的中文标签。       | 同上；例如`**岗位名称： **产品测试工程师`只将标签加粗，列表/正文布局正确。                                                                                                      |
| U010 | Markdown修复限于解析后的普通文本。         | markdown.test.tsx；转义星号、行内/围栏代码、HTML与数学文本不重新解释；安全链接和代码复制保留。                                                                                  |
| U011 | 思考标题/状态扫光改为单张不平铺渐变。      | styles.css；连续观察至少两次完整循环，不在文字尾部隔次卡顿，不改变文本宽度。                                                                                                    |
| U012 | 每次完整扫光后固定停顿2.5秒。              | 1秒扫过、3.5秒完整周期；实际窗口检查连续位置与停顿，不只判断动画名称。                                                                                                          |
| U013 | 扫光保留减少动态效果降级。                 | prefers-reduced-motion下无扫光，文字仍可读；浅深色、正常/最小窗口验证。                                                                                                         |
| U014 | 云浮层不再由弹窗自动焦点展开。             | SyncBadge.tsx；新建知识库后鼠标停在外部，自动/程序focus均保持关闭。                                                                                                             |
| U015 | 云浮层明确激活与键盘操作保留。             | 同上；悬停、移出、Enter/Space、Escape、内部控件及焦点回到按钮逐项验证，不因关闭后focus重新展开。                                                                                |
| U016 | 上报前协商v2能力。                         | telemetry/protocol.ts、service.ts；GET /v2/telemetry/capabilities，核对schema、身份方案、回执和资源上限，不回退v1。                                                             |
| U017 | 增加账户归属凭据领取。                     | cloud/client.ts；POST /v2/telemetry/identity只传installationId，主进程使用当前VoxCue Bearer，不使用AI授权。                                                                     |
| U018 | 统计领取失败不破坏云账号会话。             | 同上；401/403/503和超时不清除/刷新正式登录、不授予同步权限；Renderer看不到令牌。                                                                                                |
| U019 | 主进程核对归属凭据绑定与时窗。             | telemetry/identity.ts；算法/用途/issuer/audience、账户/安装、issuedAt/eventUntil/deliverUntil严格对应，服务端执行HMAC验签。                                                     |
| U020 | 归属凭据复用既有系统加密适配器。           | cloud/vault.ts、main.ts；cloud-account/telemetry.bin最多128条/256KiB密文，Mac继续用原凭据助手，无明文回退。                                                                     |
| U021 | 普通统计队列只保存不透明引用。             | contracts/telemetry.ts、queue.ts；磁盘事件不含userId、JWT、accessToken、邮箱或正文。                                                                                            |
| U022 | HTTP事件只携带服务端归属凭据。             | TelemetryWireEvent；account附identityProof，任何模式不直接传userId/identityRef；local/signed_out无凭据且不造云用户。                                                            |
| U023 | 事件发生时固定身份，切换不重写。           | service.ts；本地→账户A→账户B→退出，旧事件仍用各自发生时凭据，同一安装ID保持。                                                                                                   |
| U024 | 保留尚需补传及未完成任务的归属凭据。       | identity.ts、service.ts；退出后旧事件、面试检查点、未完成AI请求仍能按原账户归属，ACK压缩不能提前移除。                                                                          |
| U025 | 离线无法验证的账户事件有明确策略。         | 缺少覆盖事件时点的已安全保存凭据则计droppedEvents/identity_unverifiable；不冒充local、不借未来/另一账号凭据。                                                                   |
| U026 | 旧v1匿名/本地队列受控迁移。                | queue.ts；通过新校验者保留原事件ID/时间/安装，不能制造新安装或活跃。                                                                                                            |
| U027 | 旧v1账户事件不补造归属。                   | 缺少历史凭据者明确计legacy_unverifiable丢弃；历史检查点也不得重绑定新账号。                                                                                                     |
| U028 | 全安装健康sequence持久递增。               | installation.json与queue；重启、队列/counter重建、个人资料清理后仍继续，不靠counterId判断新鲜度。                                                                               |
| U029 | 安装序号/尝试计数溢出关闭统计。            | 不归零、不重建安装ID，不生成无效服务端快照。                                                                                                                                    |
| U030 | 原子文件写入同步后发布。                   | backend/atomicFile.ts；写入→fsync→rename，Mac另同步父目录；队列和凭据共用，不增加替代加密实现。                                                                                 |
| U031 | 损坏/超大统计文件失败关闭。                | queue/service；保留原文件，不覆盖未知数据，不阻止进入应用。                                                                                                                     |
| U032 | 队列继续有2000条/30天边界。                | 优先淘汰feature/progress，终态优先；边界、过期及真实文件占用分别验证，不删除兼容/评估夹具。                                                                                     |
| U033 | 待处理与网络并发有界。                     | 待录入最多2000项、单上传、单批50项/128KiB、响应16KiB、8秒超时；过载不能无限排队。                                                                                               |
| U034 | 回执同时处理成功与永久拒绝。               | protocol.receiptIds；完整校验索引、ID、唯一性、互斥、永久代码后出队；永久拒绝增加丢弃数。                                                                                       |
| U035 | 未确认/部分/重复回执有独立语义。           | 未提及项保留；重复投递保持原ID；未知、冲突、超大、截断或畸形回执不清队列。                                                                                                      |
| U036 | 空健康批次与全拒绝批次合法。               | healthAccepted不等于全部事件成功；排空后再报告一次空队列，不产生持续空心跳。                                                                                                    |
| U037 | 失败退避持久化并有抖动。                   | 网络/429/503遵守Retry-After秒数或HTTP日期；有界指数退避与20%抖动，重启不密集重试。                                                                                              |
| U038 | 不支持/无效请求按24小时退避。              | 400/413/415/422及旧/未知协议保留安全诊断，无v1回退、换ID或绕过限流。                                                                                                            |
| U039 | 关闭等待已开始磁盘写入并取消网络。         | 退出/注销中迟到HTTP或凭据领取不得重建已清除文件；未完成AI记cancelled，迟到成功不改写。                                                                                          |
| U040 | AI统计保持成功/失败/取消及首答耗时语义。   | 新协议下重新验证单请求单终态、单调时钟、人工/自动提问区别，不因重试放大计数。                                                                                                   |
| U041 | 面试统计在新协议下保持原计时规则。         | running后才开始；扣除暂停/休眠；2分钟且内容/提问/答案达阈值才effective，sequence绝对快照不回退。                                                                                |
| U042 | 不可验证崩溃检查点只终结/清理一次。        | 旧身份和时间不变，不计停机时长；过期/无凭据检查点不能每次启动重复恢复。                                                                                                         |
| U043 | 发送中淘汰的事件不重复计丢弃。             | 队列已淘汰的ID收到永久拒绝后不再次累加droppedEvents。                                                                                                                           |
| U044 | C047枚举不再强制转换字符串。               | 数组、对象、null等不能冒充platform/accountMode/method/context/outcome/stage/type，合法值仍通过。                                                                                |
| U045 | C047限制日期及关联语义。                   | 非负安全整数且≤8640000000000000；拒绝firstSeenAt/startedAt矛盾、未开始却累计时间、错误effective、无开始completed。                                                              |
| U046 | Renderer/IPC权限边界不扩大。               | 固定signal、窗口/frame白名单；无任意时间、身份、URL、正文或凭据入口；隔离设置保持。                                                                                             |
| U047 | 集成测试固定只读0.5.3服务端。              | server-reference.mjs、telemetry-v2-http-smoke.mjs；真实临时HTTP验证注册/登录/备份与新统计，不修改服务端或生产。                                                                 |
| U048 | 普通GUI/正式包夹具启动前隔离统计。         | test-workspace/offline入口；正式凭据运行时须按现有排他保护，SDK真实握手另用自有文件存储。                                                                                       |
| U049 | 合成登录入口先准备端口再刷新表单。         | install-ui-account.mjs及install-primary-account.cjs；只清自有标记，不访问真实账号。                                                                                             |
| U050 | 重试取消夹具使用受控时钟。                 | interview-retry-smoke.mjs；保留原请求次数、等待/活动取消、迟到结果和原生断言，不能缩短长稳。                                                                                    |
| U051 | RAG及历史界面夹具按实际入口调整。          | rag-core/history-branding/local-mode等；原件、现用模型及RAG v7保持，合成端口不算完整推理成绩。                                                                                  |
| U052 | Windows专属几何/缺失提示夹具更新。         | Windows 1/64 CSS精度、稳定DPI投影和Fluent向外箭头；Mac不复制Fluent，沿用已修正SF向外映射及左右镜像并本机复核。                                                                  |
| U053 | 清理只删已证实的生成中间缓存。             | Windows installer-ui四文件由打包脚本重建，归档后删除重复安装暂存；业务模块的无静态入边项实为动态/Worker/preload入口，保留。Mac本机清理重新审计，不照删Windows路径。             |
| U054 | Mac独有原生和发行仍需本机验收。            | 原凭据助手、POSIX同步、辅助功能降级、窗口/SF图标、代码签名、DMG/ZIP/更新摘要及退出重启；Windows通过不算Mac通过。                                                                |
| U055 | Windows测试探针加强真实锁屏拒绝。          | WindowProbe.cs；校验WTS活动/解锁、当前控制台及LockApp/LogonUI前台；未知失败关闭，输入/截图前再次检查。仅Default桌面或可读光标不能算解锁。Mac使用本机严格锁屏检查，不复制Win32。 |
| U056 | Vite定向安全补丁6.4.4→6.4.5。              | 用户已明确批准；共享清单锁定6.4.5，Windows锁只改变Vite与其peer引用。Mac本机仅同步该补丁并核对其他依赖版本不变；SDK/模型/身份不变。                                              |
| U057 | 不同可见文本宽度的扫光均固定1秒。          | shimmer-smoke.mjs通过真实IPC进度更新覆盖短/中/长中文、英文、中英混排和真实省略截断；浅深色及正常/最小窗口逐帧检查，所有宽度1秒、暂停2.5秒；纳入完整矩阵和五档DPI。              |
| U058 | 超长推理标题不再撑开活动列表。             | styles.css对列表使用minmax(0,1fr)；长标题保留省略号、可见边界与1秒扫光，正常/最小窗口均不得横向溢出。                                                                           |

## 完整验证顺序

1. 读全AGENTS.md、PROGRESS.md、本页、CLIENT_TELEMETRY.md和固定服务端全部API/统计文档；核对HEAD、远端、未提交工作与Mac0.6.3产品基线。将下面逐文件差异与U001–U058逐项对照。
2. 先审计静态/动态/Worker/preload/打包/测试入口、真实路径和占用，删除确认无消费者的项目；保护现用模型、依赖、发行、恢复基线及历史跳过目录。
3. 同步本平台配置，workspace/架构/严格类型/noUnused、全部单测、依赖审计与共享/原生构建。
4. 设置VOXCUE_TEST_SERVER_ROOT为固定独立0.5.3只读仓库，运行shared functional-suite全矩阵；包含20轮面试和足600秒真实ASR。固定公开临时模型/音频，普通UI启动前隔离统计。
5. Mac原生矩阵及浅深色/正常最小窗口/显示缩放/键盘/减少动态效果逐项验证；U011/U012需真实循环，U014/U015需实际指针和焦点生命周期。
6. 新统计先单测、再真实临时HTTP、再真实Mac主进程/加密存储；本地与两账户、退出、重启、长离线、崩溃、部分/重复/全拒绝回执、空健康、容量/日期/时区/序号边界和背压全部覆盖。M001–M026逐项核对客户端事件来源，不能将安装等同自然人、客户端注册声明等同服务端事务注册。
7. 发现客户端问题最小修复，先定向再最终受影响/完整矩阵复测；服务端问题只记录契约证据和影响，禁止修改服务端。不得放宽几何、禁用、切换、原生或长稳断言。
8. 结果只终端/对话；owner系统临时资料退出/失败/取消清理。不要在工作区生成测试报告、截图、trace、coverage或成绩。

Mac打包/提交/发行须以该环境用户当前明确授权为准；本交接不代替发布授权，不替换真实安装，不轮换签名或更新身份。Windows0.6.5（实际发行状态见PROGRESS）与现有Mac0.6.3按平台完整资产选择，既有历史/模型资产保护。

## 逐文件审计入口

以真实0.6.5源码提交对基线执行`git diff --name-status c37fa181156617c58bc3eb4a509334057d4a38f3 <0.6.5提交>`，再逐文件读diff；新增文件也必须审计。协议实现涉及contracts/telemetry.ts、backend/telemetry四模块、cloud/client与vault、atomicFile、boundedJson及main装配；界面涉及MarkdownContent、markdown服务、SyncBadge及styles。下面清单包含相对Mac基线的已提交后续变化及当前新增文件；发行提交前再次核对。每个文件均须读真实diff。

<!-- file-audit:start -->

| 文件项 | 路径                                                    | 范围                     | 变化与核对重点                                                             |
| ------ | ------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| F001   | `PROGRESS.md`                                           | 文档                     | 当前0.6.5范围、实现、待办、发行边界；不保存测试成绩。                      |
| F002   | `README.md`                                             | 文档                     | 当前0.6.5功能/统计隐私与Mac交接链接，历史发行说明。                        |
| F003   | `package.json`                                          | 共享实现/配置            | 共享版本源生成的根任务清单。                                               |
| F004   | `shared/docs/CLIENT_TELEMETRY.md`                       | 文档                     | 文档：客户端使用统计协议 v2（适配服务端 0.5.3）；当前/历史范围明确分开。   |
| F005   | `shared/docs/MACOS_0.6.3_RELEASE.md`                    | 文档                     | 文档：VoxCue 0.6.3 Mac发行索引；当前/历史范围明确分开。                    |
| F006   | `shared/docs/MACOS_0.6.5_CODEX_PROMPT.md`               | 文档                     | 文档：Mac Codex 接续提示词：0.6.3 → 0.6.5；当前/历史范围明确分开。         |
| F007   | `shared/docs/MACOS_0.6.5_HANDOFF.md`                    | 文档                     | 文档：Mac 0.6.3 → 0.6.5 更新交接；当前/历史范围明确分开。                  |
| F008   | `shared/docs/SERVER_FOR_CLIENT_0.6.3_HANDOFF.md`        | 文档                     | 文档：为客户端0.6.3适配服务端：逐项更新与实现交接；当前/历史范围明确分开。 |
| F009   | `shared/docs/WINDOWS_0.6.3_HANDOFF.md`                  | 文档                     | 文档：VoxCue 0.6.2 → 0.6.3：Windows客户端逐项交接；当前/历史范围明确分开。 |
| F010   | `shared/docs/WORKSPACE_CLEANUP.md`                      | 文档                     | 文档：2026-10-30 客户端0.6.5清理边界；当前/历史范围明确分开。              |
| F011   | `shared/electron/backend/atomicFile.ts`                 | 共享实现/配置            | 写入同步、原子替换和非Windows父目录同步；队列/凭据共用。                   |
| F012   | `shared/electron/backend/boundedJson.ts`                | 共享实现/配置            | 有界流式JSON响应读取，超大/截断失败。                                      |
| F013   | `shared/electron/backend/cloud/client.ts`               | 共享实现/配置            | 主进程领取归属凭据，统计失败不修改云会话。                                 |
| F014   | `shared/electron/backend/cloud/vault.ts`                | 共享实现/配置            | 复用现有系统加密及原子文件；保留原账户存储格式。                           |
| F015   | `shared/electron/backend/components/service.ts`         | 共享实现/配置            | 缺失组件错误复用componentPresentation。                                    |
| F016   | `shared/electron/backend/knowledge/embedding.ts`        | 共享实现/配置            | 知识库检索未安装/加载失败统一文案，原件保留。                              |
| F017   | `shared/electron/backend/telemetry/identity.ts`         | 共享实现/配置            | 安装/账户/时窗绑定凭据、加密持久引用及有界生命周期。                       |
| F018   | `shared/electron/backend/telemetry/protocol.ts`         | 共享实现/配置            | v2能力协商、逐项终态回执与Retry-After解析。                                |
| F019   | `shared/electron/backend/telemetry/queue.ts`            | 共享实现/配置            | schema 2队列、受控旧记录处理、健康序号/丢弃/退避。                         |
| F020   | `shared/electron/backend/telemetry/service.ts`          | 共享实现/配置            | 新协议装配、事件时身份、先落盘、单批上传、检查点/退出。                    |
| F021   | `shared/electron/contracts/telemetry.ts`                | 共享实现/配置            | 磁盘/HTTP类型分离及C047严格类型、日期、快照语义。                          |
| F022   | `shared/electron/main.ts`                               | 共享实现/配置            | 原加密平台端口与账号归属提供器装配，真实登录后刷新凭据。                   |
| F023   | `shared/package.json`                                   | 共享实现/配置            | 版本唯一来源更新0.6.5；其他依赖按明确安全授权处理。                        |
| F024   | `shared/src/components/MarkdownContent.tsx`             | 共享实现/配置            | 接入受控中文粗体修复，原安全渲染/复制保持。                                |
| F025   | `shared/src/components/PreparationPage.tsx`             | 共享实现/配置            | 面试预检知识库检索缺失提示统一名称。                                       |
| F026   | `shared/src/components/SyncBadge.tsx`                   | 共享实现/配置            | 取消focus自动展开及陈旧skipFocus分支，保留明确激活与关闭。                 |
| F027   | `shared/src/services/markdown.ts`                       | 共享实现/配置            | 只处理解析后的中文粗体遗留文本，保留转义/代码。                            |
| F028   | `shared/src/stores/knowledge.ts`                        | 共享实现/配置            | 创建知识库的组件缺失名称统一。                                             |
| F029   | `shared/src/stores/preparation.ts`                      | 共享实现/配置            | 选择知识库的组件缺失名称统一。                                             |
| F030   | `shared/src/styles.css`                                 | 共享实现/配置            | 单张扫光1秒加2.5秒暂停、长标题不撑开列表，保留降级。                       |
| F031   | `shared/test/README.md`                                 | 共享验证                 | 当前测试入口、新协议只读0.5.3联调和隔离边界。                              |
| F032   | `shared/test/fixtures/install-primary-account.cjs`      | 共享验证                 | 合成账号自有标记增加显式logout供重新登录夹具复用。                         |
| F033   | `shared/test/scripts/chat-progress-smoke.mjs`           | 共享验证                 | 实际窗口观察两个扫光循环、位置/宽度及2.5秒暂停。                           |
| F034   | `shared/test/scripts/chat-response-smoke.mjs`           | 共享验证                 | 真实Renderer验证中文标点/尾空格粗体及原代码复制。                          |
| F035   | `shared/test/scripts/client-update-ui-smoke.mjs`        | 共享验证                 | 侧栏/个人资料动画、拖入卡片、反馈链接与辅助功能专项。                      |
| F036   | `shared/test/scripts/functional-suite.mjs`              | 共享验证                 | 完整矩阵纳入新v2真实HTTP和不同文本宽度扫光，保留20轮/600秒时长。           |
| F037   | `shared/test/scripts/history-branding-smoke.mjs`        | 共享验证                 | 按1/64 CSS布局精度核对定位共边并输出实际失败几何。                         |
| F038   | `shared/test/scripts/install-ui-account.mjs`            | 共享验证                 | 先准备自有合成登录端口，再刷新表单并等待真正可用。                         |
| F039   | `shared/test/scripts/interview-retry-smoke.mjs`         | 共享验证                 | 受控重试时钟验证取消/迟到，保留请求次数和生命周期断言。                    |
| F040   | `shared/test/scripts/knowledge-smoke.mjs`               | 共享验证                 | 新建后自动/程序focus不展开，悬停/键盘/退出仍有效。                         |
| F041   | `shared/test/scripts/local-mode-smoke.mjs`              | 共享验证                 | 等待实际输入可用、容量长文本换行/共边及可选截图。                          |
| F042   | `shared/test/scripts/rag-core-smoke.mjs`                | 共享验证                 | 缺组件错误按统一知识库检索文案断言，真实索引不放宽。                       |
| F043   | `shared/test/scripts/server-connection-smoke.mjs`       | 共享验证                 | 默认自有临时0.5.3 HTTP，移除生产/旧服务端分支。                            |
| F044   | `shared/test/scripts/server-reference.mjs`              | 共享验证                 | 固定只读独立0.5.3/3bceb61，旧shared/server保持。                           |
| F045   | `shared/test/scripts/telemetry-smoke.mjs`               | 共享验证                 | 真实主进程/IPC、临时平台加密存储和合成v2退避。                             |
| F046   | `shared/test/scripts/telemetry-v2-http-smoke.mjs`       | 共享验证                 | 只读0.5.3真实临时HTTP、双账户/本地/退出及回执补传。                        |
| F047   | `shared/test/scripts/test-workspace.mjs`                | 共享验证                 | 普通夹具启动前隔离统计、Windows解锁检查及正式包凭据进程排他保护。          |
| F048   | `shared/test/unit/cloud-account.test.ts`                | 共享验证                 | 统计401/403/503不破坏云会话且无令牌外泄。                                  |
| F049   | `shared/test/unit/markdown.test.tsx`                    | 共享验证                 | 中文粗体与转义/代码/数学文本回归。                                         |
| F050   | `shared/test/unit/telemetry.test.ts`                    | 共享验证                 | v2归属、序号、回执、迁移、背压、C047及生命周期单测。                       |
| F051   | `windows/package.json`                                  | Windows专属，Mac只读参考 | 只生成Windows版本清单，Mac本机另同步。                                     |
| F052   | `windows/test/fixtures/WindowProbe.cs`                  | Windows专属，Mac只读参考 | 自有窗口/文件占用/DPI原生探针及WTS/LockApp严格锁屏拒绝。                   |
| F053   | `windows/test/scripts/component-removal-check.mjs`      | Windows专属，Mac只读参考 | 组件移除错误提示更新为统一展示名称。                                       |
| F054   | `windows/test/scripts/components-check.mjs`             | Windows专属，Mac只读参考 | 统一缺失提示，保留禁用/切换/原生断言。                                     |
| F055   | `windows/test/scripts/interview-layout-smoke.mjs`       | Windows专属，Mac只读参考 | AI服务/轻量语音显示值、原生缩放角真实动画捕获，几何断言保持。              |
| F056   | `windows/test/scripts/login-actions-native-smoke.mjs`   | Windows专属，Mac只读参考 | 实际窗口和DPI投影稳定后再进行原生命中。                                    |
| F057   | `windows/test/scripts/packaged-smoke.mjs`               | Windows专属，Mac只读参考 | 正式包固定运行时/模型与隔离端口检查，日志读取当前版本。                    |
| F058   | `windows/test/scripts/presentation-native-smoke.mjs`    | Windows专属，Mac只读参考 | 等待真实窗口/原生几何稳定，不放宽断言。                                    |
| F059   | `windows/test/scripts/telemetry-queue-native-smoke.mjs` | Windows专属，Mac只读参考 | 真实排他文件占用、并发原子写与schema 2固定类别。                           |
| F060   | `windows/test/scripts/window-probe.mjs`                 | Windows专属，Mac只读参考 | 原生稳定目标与排他句柄释放的受控探针调用。                                 |
| F061   | `windows/test/scripts/windows-suite.mjs`                | Windows专属，Mac只读参考 | Windows原生与五档DPI纳入0.6.3/0.6.5功能专项。                              |
| F062   | `shared/test/scripts/shimmer-smoke.mjs`                 | 共享验证                 | 实际IPC和CSS逐帧覆盖不同长度、原生最小尺寸、浅深色与减少动态效果；均1秒。  |
| F063   | `windows/pnpm-lock.yaml`                                | Windows专属，Mac只读参考 | 唯一授权的Vite6.4.5补丁与peer引用，其余锁定包版本保持；Mac锁本机同步。     |

<!-- file-audit:end -->
