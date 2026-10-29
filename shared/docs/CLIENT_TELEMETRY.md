# 客户端使用统计协议 v1（0.6.3）

Windows/Mac共用`backend/telemetry`。已发布Mac 0.6.3的客户端上报规则固定，本次不修改客户端上报实现、契约或对接规则；非对接展示和Windows夹具按当前授权最小修复。独立VoxCue-server已按本协议完成统计接收、聚合及管理页源码适配，仅进行隔离本机验证，尚未部署生产。以下26项口径保持；不能据源码实现声称生产后台已能展示。正式安装版启用；开发运行及普通合成GUI夹具不采集、不发请求。

## 身份、时间和隐私

- 主进程创建随机`installationId`并保存在`telemetry-installation.json`，不使用硬件指纹、邮箱、固定host-id或AI身份。`firstSeenAt`是该统计标识首次创建时间，不是可证明的下载安装时间；升级旧用户也可能首次被统计到。
- 每次进程有独立`runId`，首次可用登录/主界面产生一次`app_ready`。刷新、重新登录、Mac关窗再打开不重复算进程启动。
- 事件在发生时绑定`accountMode=signed_out/local/account`；只有主进程读到VoxCue账号时才附`userId`。切换模式不改写排队事件的身份。AI服务登录不等于VoxCue账号登录。
- 整体使用数按安装ID去重，账户视图按用户ID去重；本地模式只能按安装ID。同一安装当天使用过两种模式，分项可能重叠，整体取并集，不能直接相加。重装/清空统计标识会形成新安装；同一账号多台电脑在账户视图去重，整体安装视图保留多台。
- `occurredAt`、`firstSeenAt`和`startedAt`均为UTC Unix毫秒。后台统一按其配置的统计时区归档，离线补传按发生时间补记，不能按接收时间算成今日活动。日/周/月活分别按日、最近7日/30日的实际操作去重。
- 只收固定类别、随机ID、版本/平台、时间和数字计数；禁止正文、转写文字、音频、截图、原件、名称/路径、邮箱、错误原文、凭据、模型提示词和设备型号。Renderer不能指定身份、时间、URL或任意属性。
- 注销账号先停止统计写入/请求，随个人资料删除`telemetry-queue.json`；只保留不含账户关联的安装标识。服务端后续必须明确统计留存/删除政策，不把客户端声明的用户ID当作认证或权限凭证。

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

## 存储和传输

- 队列文件`telemetry-queue.json`为原子替换、0600权限，串行合并写入；最多2000个事件、保留30天。满时先丢最早的feature/progress，优先保留账户/开始/终态；过期/容量丢弃数以health.droppedEvents报告。仅一个网络请求在途，产品操作不等待网络。
- 独立匿名`POST {现有账号服务origin}/v1/telemetry/events`，不使用账号/AI令牌、Cookie或云同步队列；只接受现有origin校验规则，不增加Renderer可改地址。HTTPS固定路径、不跟随重定向、8秒超时、回执最多16KiB，每批最多50条，发送前先落盘。
- 请求体：`{schemaVersion:1, installationId, runId, sentAt, events, health:{counterId,attempts,failures,pendingEvents,oldestPendingAt,droppedEvents}}`。events的正式类型/严格字段白名单见`contracts/telemetry.ts`；每条都有独立随机id。
- 回执必须为`{schemaVersion:1,acceptedIds:[本批已持久提交的事件ID...]}`。服务端须按事件id幂等，重复提交也回原ID。客户端仅删除本批明确确认的ID；有事件批次的空回执、未知/重复ID、普通HTTP200但无有效回执均保留待传。成功排空后下一周期补一次`events:[]`健康快照，此时允许`acceptedIds:[]`，让后台得知队列已清空，不形成持续空心跳。身份信息是客户端声明，未来服务端须校验、限流，并以注册库为注册人数权威来源。
- 正常每30秒最多一批；网络/无效回执按连续失败指数退避到1小时，成功后重置；404/405/501视为旧服务端不支持，24小时后再探测。nextAttemptAt跨进程保存，不因重启密集重试；尊重有界Retry-After。
- health是累计尝试/失败计数及发送前队列快照，counterId跨重启保持、清空队列存储后更换，服务端按counterId处理差值。health需连同批次在事务中持久化，未来后台还需标明迟到数据和采样新鲜度。长期离线、到期/容量淘汰及清空应用数据可能造成缺口，不能承诺统计完整。

## 验证入口

`telemetry.test.ts`覆盖身份保持、事件时点身份、有效面试、时钟/暂停/休眠、崩溃恢复、先落盘后上传、部分回执、旧服务端退避、无效/超量回执、离线、队列边界与隐私字段白名单。`desktop-ipc.test.ts`覆盖窗口/frame及字段限制；GUI专项使用独立合成传输与合成音频，不连接真实服务器或读取真实账号。
