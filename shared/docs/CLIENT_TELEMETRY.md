# 客户端使用统计协议 v2（适配服务端 0.5.3）

当前工作区已适配独立服务端0.5.3的schema 2协议；客户端版本唯一来源为shared/package.json=0.6.5，Windows0.6.5已[公开发行](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.5)。已发布Mac0.6.3安装包仍是旧v1实现，不因源码变更自动获得适配；历史实现与交接查Git。本轮禁止修改服务端。

Windows/Mac共用backend/telemetry、契约、主进程装配和界面。安全存储复用既有平台加密适配器；Windows使用Electron safeStorage，Mac使用既有凭据助手，不改助手/host-id/签名身份；共用源码变更需分别在两平台本机验证。正式安装版启用；开发运行与普通GUI夹具停用，显式统计夹具仅使用自有loopback或离线合成传输。

权威契约：[服务端统计接口](https://github.com/NCFXZ/VoxCue-server/blob/main/CLIENT_TELEMETRY.md)、[全部服务端接口](https://github.com/NCFXZ/VoxCue-server/blob/main/API.md)。账户/同步沿用现有v1业务API；统计仅用v2，不回退旧上报协议。

## 身份、时间和隐私

- 主进程创建随机`installationId`并保存在`telemetry-installation.json`，不使用硬件指纹、邮箱、固定host-id或AI身份。`firstSeenAt`是该统计标识首次创建时间，不是可证明的下载安装时间；升级旧用户也可能首次被统计到。
- 每次进程有独立`runId`，首次可用登录/主界面产生一次`app_ready`。刷新、重新登录、Mac关窗再打开不重复算进程启动。
- 事件在发生时固化accountMode及身份归属。只有VoxCue账号会话可向POST /v2/telemetry/identity领取绑定installationId的凭据；请求仅带installationId，accessToken仅用于主进程领取。account事件在发送时附identityProof，任何模式均不发送userId；local/signed_out不附凭据。AI服务授权不等于VoxCue账号登录。
- 整体使用数按安装ID去重，账户视图按用户ID去重；本地模式只能按安装ID。同一安装当天使用过两种模式，分项可能重叠，整体取并集，不能直接相加。重装/清空统计标识会形成新安装；同一账号多台电脑在账户视图去重，整体安装视图保留多台。
- `occurredAt`、`firstSeenAt`和`startedAt`均为UTC Unix毫秒。后台统一按其配置的统计时区归档，离线补传按发生时间补记，不能按接收时间算成今日活动。日/周/月活分别按日、最近7日/30日的实际操作去重。
- 只收固定类别、随机ID、版本/平台、时间和数字计数；禁止正文、转写文字、音频、截图、原件、名称/路径、邮箱、错误原文、账号/AI访问令牌、模型提示词和设备型号。Renderer不能指定身份、时间、URL或任意属性。
- 注销账号先停止统计写入/请求，随个人资料删除`telemetry-queue.json`；同时删除cloud-account目录中的加密归属凭据；保留不含账户关联的安装标识和全安装健康sequence，避免计数器重建后序号回退。服务端留存/注销规则见其权威文档；归属凭据只用于统计，不授予账号/同步权限。

## 26项聚合口径

版本、平台、账户模式、登录方式、新老用户、失败环节均是分组维度，不另算指标。新老使用者按`firstSeenAt`，新老注册账号按`userCreatedAt`，不能混用。

| 编号 | 指标 | 来源/计算 |
|---|---|---|
| 1 | 累计注册人数 | 服务端注册成功记录，排除本地账户；客户端注册事件只提供安装关联，不重复累加 |
| 2 | 启动安装数 | `app_ready`按安装去重 |
| 3 | 启动次数 | `app_ready`按runId去重 |
| 4 | 登录账户数 | `account_entry`的login/register/restore按用户去重；成功手动登录与成功恢复作为维度 |
| 5 | 日活 | 当日`feature`发生实际操作的安装/账户去重；仅启动/登录不算活跃 |
| 6 | 周活 | 最近7日实际操作去重 |
| 7 | 月活 | 最近30日实际操作去重，放趋势详情 |
| 8 | 功能使用率 | 操作过该feature的活跃安装/账户数÷同期间活跃总数 |
| 9 | 今日面试使用数 | 当日`interview_started`按安装/账户去重 |
| 10 | 成功开始场次 | `interview_started`按interviewId去重，不计点击/确认框/预检失败 |
| 11 | 有效面试使用数 | 有effective快照的interviewId所对应安装/账户去重 |
| 12 | 有效场次 | effective=true的interviewId去重，异常结束前达标仍保留 |
| 13 | 面试总时长 | 每场最新sequence的activeMs求和，绝不能把累计进度快照相加 |
| 14 | 时长分布 | 每场最新activeMs分布，可筛选有效场次 |
| 15 | 完成率 | 正常结束且保存成功场次÷已终结的成功启动场次；正在进行的场次不进分母 |
| 16 | 失败率 | 最终failed/interrupted尝试÷已有终态的尝试，含启动失败；恢复成功的临时错误不计最终失败 |
| 17 | 新增使用安装数 | 按firstSeenAt的新安装ID去重，表示首次被统计到 |
| 18 | 首次有效面试转化率 | 同批新增安装中7日内出现有效面试的比例，未满7日标记为未成熟样本 |
| 19 | 次日留存 | 首次被统计到后次日有实际操作的安装比例 |
| 20 | 7日留存 | 首次被统计到后第7日有实际操作的安装比例 |
| 21 | 本地转注册率 | 首次进入local后7日内register成功的安装÷同批首次local安装；登录已有账号不算 |
| 22 | AI回答成功率 | success÷(success+failure)，cancelled单列；chat/interview可筛选，后台标题生成不计用户提问 |
| 23 | 回答等待时间 | 成功请求的firstAnswerMs分布，展示P50/P95；重试属于同一用户请求，不放大请求数 |
| 24 | 上报失败率 | health同一counterId的failures增量÷attempts增量，不把各批累计值相加 |
| 25 | 待补传事件数 | 每个安装最新health.pendingEvents快照 |
| 26 | 最早待补传等待时长 | 最新health快照发送时间减oldestPendingAt；空队列为0，不随后台当前时间永久增长 |

## 面试与操作采集

- `interview_attempt`在实际请求启动时产生；首次语音管线running才产生`interview_started`。暂停/恢复不新增场次。首次启动失败后重新尝试产生新ID；已开始场次的可恢复音频错误仅暂停累计时长。
- activeMs使用主进程单调时钟，仅running时累计，扣除暂停及系统suspend到resume；正常静默/思考保留。30秒进度检查点及状态切换保存累计值。
- effective为activeMs≥120000，且transcriptCount≥3、manualQuestionCount≥1、answerCount≥1任一成立。转写只数非空、非discontinuity的唯一final段；不存/传段ID或文字。人工提交与自动提问分开，重试旧答案不增加人工提问数。
- 正常结束由Renderer报告归档结果，再由受控确认关闭产生终态；保存失败保留窗口供重试。窗口异常退出或下次启动发现未结束检查点，记interrupted；未进入running则记failed。崩溃恢复只使用最后检查点，未保存的最后约30秒无法恢复，不把关机时间补进来。
- `feature`取固定枚举：chat_send/file_import/profile_edit/history_view/knowledge_view/interview/history_export/data_export。同一身份同类30秒内合并，但跨UTC分钟不合并，以保留后台统计时区午夜前后的操作；用于使用率与活跃存在性，不代表精确点击次数。同步恢复、自动加载、启动、登录不计feature。
- `ai_request`每次用户请求一条终态，含success/failure/cancelled、总耗时、首次非空可见回答耗时。面试请求附interviewId。收到成功结果才增加answerCount；AI未连接或未实际发起请求不产生成功事件。正常应用退出先将未完成请求记cancelled，再关闭统计写入，迟到成功不能改写。强制进程终止无法保证未保存请求的终态，进程故障由面试检查点独立反映。

## 存储、归属和传输

- 沿用telemetry-installation.json中的随机installationId和firstSeenAt。新增全安装正整数sequence，发批前递增并持久化；queue重建和个人资料清理不重置它。单实例锁防止两个主进程覆盖同一profile；序号或尝试计数溢出时关闭统计，不重建身份。
- telemetry-queue.json只存固定事件、随机ID、数字及不透明identityRef，不含userId、JWT或登录令牌。cloud-account/telemetry.bin用既有系统加密保存绑定origin/installationId的归属凭据，最多128条、密文最多256KiB。未获安全保存不能入队account引用；本地/未登录事件独立工作，无明文回退。旧事件、面试检查点和未结束AI请求所需凭据保留至终结/过期，退出登录不改旧事件归属。
- 先匿名GET /v2/telemetry/capabilities校验schema、身份方案、回执与资源上限，再使用固定v2路径。领取归属凭据仅用当前且未过期的VoxCue accessToken；统计失败不刷新或清除云账号会话。主进程校验JWT格式/用途、服务端返回时间及账户/安装绑定，HMAC验签由服务端执行，客户端不持有签名密钥。
- account事件使用覆盖occurredAt且仍处投递窗口的当时凭据；离线缺少有效覆盖或安全存储不可用时，明确计入droppedEvents及安全诊断identity_unverifiable，不伪装成匿名，不套用另一个账户或未来登录凭据。旧v1本地/未登录事件通过严格新校验后可保持原ID迁移；没有历史凭据的旧account事件计为legacy_unverifiable丢弃。
- 队列最多2000条/30天，优先淘汰feature/progress，保留终态；原子文件写入先fsync再rename，非Windows另同步父目录。损坏/超大队列和无效安装标识使统计关闭，保留原文件，不影响进入应用。丢弃计数、healthPending和退避跨重启保存。
- 匿名POST /v2/telemetry/events信封：{schemaVersion:2,installationId,runId,sentAt,events,health:{counterId,sequence,attempts,failures,pendingEvents,oldestPendingAt,droppedEvents}}。发送前事件队列、凭据及安装sequence均先落盘。单批≤50条/128KiB，只一个上传在途，录入待处理最多2000项；不发送Authorization/Cookie，不使用云同步队列。固定HTTPS origin、禁止重定向、8秒超时、响应≤16KiB；隔离测试只允许自有loopback。
- 回执{schemaVersion:2,acceptedIds,rejected:[{index,id?,code}],healthAccepted:true}必须完整验证本批索引/ID、唯一性、互斥性和永久拒绝代码后才出队。成功项删除；永久拒绝项删除并计droppedEvents；未提及项保留。空/部分回执、全拒绝批和空健康批有各自合法语义；非法/截断/矛盾回执不删除。成功排空后再发一次空健康快照，不产生持续空心跳。
- 正常每30秒一批；网络/无效回执按指数退避、20%抖动，基础上限1小时；429/503遵守Retry-After（秒数或HTTP日期，最多24小时）。400/413/415/422及不支持协议按24小时退避，保留安全状态，无v1回退或密集重试。归属领取单请求在途并有超时/冷却，所有统计失败不改登录状态。
- health.sequence全安装单调递增，counterId内attempts/failures为绝对计数，failures不超过attempts；健康快照不制造活跃或安装。时钟超出JavaScript日期范围、数组/对象冒充类别、字段注入和矛盾effective/startedAt语义在本地严格拒绝；服务端仍独立验证。长期离线、缺失有效凭据、到期/容量淘汰及清空应用数据会造成不可恢复缺口。
- 关闭时先终结未完成AI请求和面试、停止新记录、取消网络，再等待已开始的磁盘写入并保存；迟到网络完成不得重建已清除的队列或凭据。

## 验证入口与边界

- 本平台pnpm exec vitest run --config ../shared/vitest.config.mjs ../shared/test/unit/telemetry.test.ts ../shared/test/unit/desktop-ipc.test.ts ../shared/test/unit/cloud-account.test.ts ../shared/test/unit/cloud-vault.test.ts。
- node ../shared/test/scripts/telemetry-smoke.mjs：独占临时profile、真实主进程/IPC及平台加密存储；网络和账号数据为显式合成夹具，不代表线上联调。
- VOXCUE_TEST_SERVER_ROOT指向只读独立0.5.3仓库后，node ../shared/test/scripts/telemetry-v2-http-smoke.mjs：启动owner临时数据库/loopback，真实登录、领取凭据、双账户/本地模式、退出、部分回执、重复投递、空健康及管理查询；不改服务端源码、不访问生产。
- GUI串行并要求当前用户已解锁；Mac安全存储及原生生命周期必须在Mac本机验证，不能用Windows结果代验。完整矩阵、长稳与发行按PROGRESS中的当前用户授权执行。
