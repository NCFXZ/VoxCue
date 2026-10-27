# 服务端独立更新与客户端只读适配参考：截至0.5.1

日期：2026-10-27。**这是服务端现状说明，不是服务端修改/部署指令。**客户端0.5.11→0.6.0的变化和Mac逐条任务在[客户端交接](MACOS_0.6.0_HANDOFF.md)，不要把两个版本号混为一谈。

## 1. 仓库与证据边界

- 独立仓库：[NCFXZ/VoxCue-server](https://github.com/NCFXZ/VoxCue-server)，已在GitHub的版本为0.5.1。
- 固定只读提交：[43b6a973849bdc3c204d8434a21857b943048758](https://github.com/NCFXZ/VoxCue-server/tree/43b6a973849bdc3c204d8434a21857b943048758)。本轮逐一比较其115项受控文件与本地副本，内容一致，仅容许工作区CRLF/LF差异。
- 客户端主仓库0.5.11基线没有包含这套独立服务端。下列是其完整能力/沿革记录，不伪造“服务端0.5.11→0.6.0”差异，也不把用户另行完成的0.5.1改动算成本轮Windows开发。
- 本轮服务端源码、配置、锁、部署和生产数据库保持不变。原Windows路径序列化的123个非隐藏文件指纹为`c5faeb654d17a397e56f728783da947fef3ecf6e0152cba1d494a48327694651`；它包含本地生成资源且使用Windows路径，**不能直接拿这个值当Mac跨平台散列**。跨平台以本页115项Git blob索引及固定提交为准。
- 不将本地admin-dist、node_modules、.state、数据库、快照、验证码、激活原码、邮件/API凭据或私有.env复制到客户端仓库。GitHub服务端已是0.5.1，本轮不再推送重复服务端代码。
- Windows/Mac使用同一个`https://accounts.voxcue.com.cn`，没有Mac专用后端。生产运行在腾讯云首尔，验证码邮件用腾讯云SES；不需要重新接入阿里云。

## 2. 服务端功能逐项清单

下列“已有”指固定提交的源码能力，不等于本轮重新运行了服务端测试或完成所有外部云服务验收。Mac禁止改动这些实现，只验证客户端对正常/拒绝/迟到/断线响应的处理。

| ID | 服务端已有行为 | 对客户端/运维的含义 |
|---|---|---|
| S001 | 独立Node内置HTTP/SQLite/crypto后端，Node宿主>=24.19.0且<25。 | 桌面不是服务端；本地集成测试宿主需满足版本。Docker固定Node24.22.1，Mac不得改镜像。 |
| S002 | 邮箱验证码用于register/reset，按用途/邮箱/挑战绑定HMAC。 | 不能把登录、注册、重置挑战串用，客户端提交challengeId与6位code。 |
| S003 | 验证码5分钟、最多5次尝试，重发60秒。 | 倒计时与错误都由实际响应驱动，不自己放宽。 |
| S004 | 邮箱每小时5次、IP每10分钟20次、全服务24小时200次申请。 | 429/Retry-After必须尊重；不是邮件费用硬封顶。 |
| S005 | 注册/登录/重置、一次性刷新、退出、设备查询和撤销。 | 桌面0.6.0保留底层兼容契约但不展示设备管理UI。 |
| S006 | 密码带盐scrypt；新密码15–128个Unicode码点、NFC。 | 支持符号、中文、空格，不强制组合或周期改密；客户端不trim密码。 |
| S007 | 离线常见密码及账号/服务名拒绝表，附来源和许可证。 | 处理weak_password本地提示；不上传用户密码到外部泄露查询服务。 |
| S008 | 新哈希标记NFC，旧哈希按原字符串验证。 | 登录兼容旧短密码；不能把客户端新注册规则套给已有登录。 |
| S009 | 会话令牌只存SHA256摘要；访问15分钟、刷新绝对30天、最多8台设备。 | 客户端需安全存储和单次轮换，不能并发重复刷新或长期保存明文。 |
| S010 | 明确代理IP信任与覆盖X-Real-IP。 | 不允许客户端伪造代理头去放宽限流，Mac不改Nginx。 |
| S011 | 邮件outbox与验证码同事务入队，内容AES-GCM加密。 | 入队失败不能显示成功；实际邮件到达与进入收件箱是两个验收。 |
| S012 | 腾讯SES中国香港通道，TriggerType=1、HeaderFrom/From一致。 | 共用现有发信身份，不让桌面持有SES密钥；垃圾箱提示保留。 |
| S013 | 资料、面试记录、知识库保存为不透明包。 | 服务端不解析、执行或索引原件；Mac负责包格式校验与本地恢复。 |
| S014 | 静态备份按用户派生AES-256-GCM密钥，并绑定用户/对象。 | 是服务器静态加密，**不是端到端加密**；不能宣传服务端看不到密钥。 |
| S015 | 1MiB分块、整包SHA256、24小时上传会话、幂等requestId。 | 重启先查询已验证块，补传缺失块；完整版本不随上传会话到期。 |
| S016 | baseRevision比较提交、最多20个版本、当前头保护。 | 409不能自动覆盖；先保存新头再清旧版；下载校验整体摘要。 |
| S017 | 分页列表返回current/reserved/stored三套精确字节统计。 | 当前版本、上传预留、含旧版本占用不能混算；UI统一MB但保留精确字节。 |
| S018 | 三类合计100,000,000字节标准配额，包含版本/预留。 | 不是知识库单独100MB；永久时长不增加云空间。 |
| S019 | profile可超标准配额，但仍计入总用量。 | 100MB满额更新JD可成101MB；显示真实超额，不从容量条排除profile。 |
| S020 | history/knowledgebase提交后不能超总配额。 | 101→100MB后仍不能新增这两类，profile继续可更新。 |
| S021 | 全服务10GiB、单包64MiB、最多4096项，非profile最多4080项。 | profile豁免不是无上限；保留其服务容量/条目/上传槽防止被大库阻塞。 |
| S022 | 删除逻辑头、版本、未完成上传与有界密文GC。 | 云删除与本地删除不同；整库分组/暂停策略由客户端实现。 |
| S023 | 普通激活码兑换小时/分钟，另有永久不限时额度。 | 有限兑换后的秒数不过期；激活码自身可设截止/次数。 |
| S024 | 激活原码仅生成时显示，数据库保存HMAC，同账号兑换重试幂等。 | 不把原码写Git/日志；客户端只兑换，不嵌入管理员生成权限。 |
| S025 | 单账号单面试租约，最多60秒预扣，建议15秒心跳。 | 两端可登录，但不能同时开两场；面试进入后才计时。 |
| S026 | 以服务器实际经过时间结算，停止退未用预扣，序号幂等。 | 客户端显示需结合单调时钟；不能依赖墙钟或每秒轮询。 |
| S027 | 用尽不开始/续租，永久仍续连接租约、有限余额不扣。 | 到期停止客户端工作并保留记录；旧未接入客户端不能靠服务器远程关本地。 |
| S028 | 零余额连续满30天停止保留云备份，再有界物理清理。 | 本地原件不删；账号/兑换/计时流水保留；迟到兑换不复活已过期数据。 |
| S029 | 账号注销端点需密码及DELETE确认，未完成订单先处理。 | 服务端存在不代表0.6.0已有注销UI；Mac不能额外增加未要求的产品入口。 |
| S030 | 支付/订单/微信APIv3、幂等意图、查单、回调、退款已有实现。 | **FEATURE_PAYMENTS=0**；商品/订单/回调关闭返回404，不因客户端联调开启。 |
| S031 | HTTP/KDF/传输/邮件/支付/后台各有独立容量与时限。 | 客户端也必须保留背压，不能认为服务端限流就可无界发送。 |
| S032 | 认证取消不提前释放仍运行的密码计算许可。 | 取消竞争不能造成实际并发突破上限。 |
| S033 | JSON/请求头边界、socket流背压、批次GC及后台串行维护。 | 过大/错Content-Type/中断上传等应有明确失败，不接受部分内容为成功。 |
| S034 | SQLite业务schema v1/v2事务迁到v3。 | Mac无权运行迁移生产库或改schema适配客户端。 |
| S035 | Docker Compose及PowerShell/Linux一键部署、幂等私有配置。 | 新密钥与旧库不能混用；本交接不执行部署，也不覆盖既有密钥。 |
| S036 | 加密快照、COS受限策略/分块/清单校验、7天模板、恢复演练。 | 用户选先做代码，付费COS未开通、自动异地任务未启用；人工离机副本不等于自动灾备。 |
| S037 | 每分钟监控资源、队列、证书、错误、邮件及灾备状态；持久告警去抖和预算。 | 已获许可的通知邮箱不放进客户端；整机/网络失联不能靠本机主动通知。 |
| S038 | 内部指标由独立密钥保护，生产反代不公开。 | Mac桌面不接/internal/metrics、不下载运维密钥。 |
| S039 | 持续压测用固定loopback、合成数据，含过载、强杀重启和守恒。 | 不接受生产URL；本次Mac任务不重新跑服务端压测或改其阈值。 |
| S040 | 0.5新增/admin/网页和/admin/api/管理接口。 | 与/v1桌面API独立；Mac不复制后台到桌面设置。 |
| S041 | ADMIN_ORIGIN为空时后台关闭，Host/Origin/Sec-Fetch-Site精确检查。 | 不能放宽跨站或把后台cookie当桌面Bearer。 |
| S042 | 总览、用户/设备、激活码批量生成与兑换记录。 | 运营能力在后台；客户端仅显示自己的账号、时长和同步。 |
| S043 | 人工时长调整及流水、备份版本/上传、订单核对/关闭/退款。 | 不授予桌面人工加时/删除他人云数据/修改订单权限。 |
| S044 | 主机CPU/内存/磁盘/运行队列及只读灾备状态。 | 不授予Docker控制权；支付关闭时后台只读历史，网页不能启用支付。 |
| S045 | owner/operator/viewer三角色与管理员邀请、审计。 | 权限边界由后台执行；不将这些角色写入桌面普通用户权限。 |
| S046 | 用户停用结算当前计时、撤销会话，保留余额/资料。 | 客户端必须正确拒绝403/account_disabled及失效租约，不能当普通离线成功。 |
| S047 | 管理后台新增admin_meta=1及附加表，业务user_version仍3。 | 客户端不迁移这些表；缺后台表时普通账号兼容逻辑仍存在。 |
| S048 | 所有管理员密码+TOTP，一次性邀请24小时。 | 桌面仍用邮箱/密码主账号；不能把管理端二因素当作桌面注册验证码。 |
| S049 | 后台最长8小时会话、空闲30分钟、写操作10分钟内重新验证。 | HttpOnly/Secure/SameSite=Strict Cookie，写入Origin+CSRF，不由桌面放宽。 |
| S050 | 写操作原因/确认/requestId及同步业务审计同事务。 | 原始激活码/邀请令牌不进入审计或幂等存储，Mac不能索取真实原码验证。 |
| S051 | 0.5.1首次绑定只显示本地生成二维码。 | 无第三方二维码服务、无手动密钥或外部验证器链接；已有绑定/验证协议保持。 |
| S052 | 管理静态资源构建时Brotli/gzip、ETag，业务响应no-store和CSP。 | admin资源/前端依赖不进桌面包；不把后台静态缓存当API认证依据。 |
| S053 | admin-preview为显式合成预览，退出清理。 | 不进生产镜像，Mac客户端任务不用真实管理员登录。 |
| S054 | 原阿里云容器停用，生产不依赖其RAM发信身份。 | 旧RAM/备案/退款是账号所有者待办，不在Mac交接里自动删云资源。 |

## 3. 运行边界（来自固定0.5.1配置/README）

| 边界 | 默认值 | 客户端必须处理 |
|---|---|---|
| TCP/在途HTTP | 128/32 | 拒绝连接或503，不能无界重试。 |
| 请求头/JSON | 8KiB/8KiB | 413/解析错误；客户端自己的响应/IPC边界也保留。 |
| 分块传输 | 并行2、排队8、等候2秒，块1MiB | 磁盘/socket背压、上传冲突、503及取消。 |
| 密码计算 | 并行2、排队16、等候2秒 | 取消不等于计算许可立即释放。 |
| 邮件 | 队列128、投递并行1、8秒、最多4次 | 入队事务失败回滚，接受不等于收件箱送达。 |
| 支付外呼 | 并行2、排队8、等候2秒、外呼6秒 | 当前关闭；不得为测试购买/开启。 |
| 后台维护/限流记录 | 串行每轮最多32项，支付每轮1单；限流记录20000 | 不叠加定时器、不无限扩容。 |

## 4. 桌面需要适配的API

所有路径和字段以固定源码为准；现有README的创建示例没有完整列出history，客户端不能据旧示例删掉第三类。普通桌面身份是Bearer，不使用管理员Cookie。

| 方法/路径 | 关键字段或行为 | 0.6.0客户端对应 |
|---|---|---|
| GET /v1/capabilities | apiVersion=v1；backupFormat=opaque-bundle-v1；3 kinds；features与limits/billing | 只读兼容检查，新字段容忍；支付必须false。 |
| POST /v1/auth/codes | email,purpose | 云主账号注册/重置挑战。 |
| POST /v1/auth/register | email,password,challengeId,code,deviceLabel | 主账号创建，不是AI授权。 |
| POST /v1/auth/login | email,password,deviceLabel | Mac设备标签“VoxCue · Mac”。 |
| POST /v1/auth/reset-password | email,password,challengeId,code | 成功返回登录，清理表单。 |
| POST /v1/auth/refresh | refreshToken | 串行单次轮换、origin隔离、失效清理。 |
| POST /v1/auth/logout；GET /v1/account | 当前Bearer | 保存握手/退出以及启动状态校验。 |
| GET /v1/account/sessions；DELETE /v1/account/sessions/:id | 本人设备 | 底层兼容保留，产品设备UI已撤回。 |
| GET /v1/backups?cursor= | items,nextCursor,storage | current/reserved/stored三类及capacityBytes，精确字段验证。 |
| POST /v1/backups | id,kind,name | kind=profile/history/knowledgebase；name为受限业务key。 |
| POST /v1/backups/:id/uploads | requestId,bytes,sha256,baseRevision | 原子预留、幂等意图、1MiB分块。 |
| GET /v1/uploads/:id | 上传状态与已验证parts | 丢确认/重启补缺块。 |
| PUT /v1/uploads/:id/parts/:index | 二进制、X-Content-SHA256 | 单块等待完成再继续，不能把JSON序列化后的数组当原件。 |
| POST /v1/uploads/:id/complete | 空JSON | 整体SHA和revision校验，新头确认后再清旧版。 |
| DELETE /v1/uploads/:id | 取消未完成上传 | 取消同步释放预留，已完成副本保留。 |
| GET /v1/backups/:id/versions | 最多20项 | 保留可恢复头与兼容旧版本。 |
| GET /v1/backups/:id/versions/:version/manifest | 长度/摘要/parts | 归属、块数、大小、整体hash验证。 |
| GET .../parts/:index | 原始分块 | 逐块恢复；不使用不存在的HTTP Range协议。 |
| POST /v1/backups/:id/remove | revision | 桌面云删除使用带revision的安全端点；不能用无条件删除绕过冲突。 |
| DELETE /v1/backups/:id；DELETE .../versions/:version | 服务端兼容删除/旧版清理 | 当前头受保护，只有明确的客户端策略才调用。 |
| GET /v1/entitlements | permanent,remainingSeconds,zeroSince,cloudDeleteAfter,cloudPurgePending | permanent时remainingSeconds=null，不当错误或0。 |
| POST /v1/activation/redeem | code | 同用户重试幂等；桌面无生成管理员权限。 |
| POST /v1/usage/sessions | requestId | 开始面试；无余额402，重复开始幂等。 |
| POST /v1/usage/sessions/:id/heartbeat | sequence | ID/序号匹配、15秒串行、迟到不复活。 |
| POST /v1/usage/sessions/:id/stop | 空JSON | 停止结算退未用预扣，幂等。 |
| GET /v1/usage/sessions/:id；GET /v1/usage/history | 会话/流水查询 | 服务端存在不代表桌面已加独立历史额度页。 |
| POST /v1/account/delete | password,confirm=DELETE | 本轮未要求桌面注销UI，不扩展。 |
| /v1/payments/*、/v1/orders* | 开关关闭为404 | 不新增价格、商品、订单或支付客户端。 |
| /admin/*、/admin/api/*、/internal/metrics | 独立后台/内部指标 | 桌面不接、不携带管理员或运维密钥。 |

错误适配至少包括401失效、402余额不足、403停用/权限、404开关关闭、409revision/单租约冲突、410保留期限、413大小、429频率和503忙碌。只去掉Electron传输包装，不直接展示可能含内部细节的原始服务错误。未知错误安全拒绝；如需更准确停用提示，只在客户端增加受限代码映射，不能更改服务端。

## 5. Mac允许做和禁止做的事情

**允许**：读本页固定源码；在完全缺失时准备独立只读副本；客户端测试用临时SQLite、合成outbox和loopback端口启动现有API；适配HTTPS、主进程加密、类型化IPC、三类包、容量、租约与错误；修客户端和客户端测试；测试结束校验只读副本未变。

**禁止**：运行服务端安装/构建admin/迁移/部署/owner invite命令；更改.env、密钥、权限、管理员、支付开关、COS或DNS；连接生产账号做写入测试；改服务端以迎合Mac；上传验证码、TOTP URI、邀请URL、激活原码或个人资料；将服务端代码混入VoxCue客户端提交或安装包。

用户已完成的服务端测试不在这次Windows交接中重复认领。真实支付、付费COS往返、整机失联的外部监控、真实邮件收件箱信誉，以及阿里云遗留清理仍是独立事项，不阻塞客户端按现有协议适配，也不能擅自上线这些服务。

## 6. 服务端只读文件索引

下表由固定GitHub提交的完整115项受控树生成，路径与Git blob SHA用于精确核对。它不包含本地生成的admin-dist或私有状态，不要求Mac修改任何一项。

| 项 | 固定提交内路径 | Git blob SHA |
|---|---|---|
| R001 | [.dockerignore](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/.dockerignore) | `baeb21a3eed7f6bb4141b7e5347243cde3f180e5` |
| R002 | [.env.example](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/.env.example) | `c2ced79bcb640b781ed60eec6f400811b135d541` |
| R003 | [.gitattributes](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/.gitattributes) | `da52266723f77f38e05b7d574185cc03e7a31f34` |
| R004 | [.gitignore](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/.gitignore) | `0fb3c956bd92c8204423915b41d795b3c9c799f9` |
| R005 | [Deploy.ps1](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/Deploy.ps1) | `61176bc68f47b91db945d4d1933fbbf0365d17e2` |
| R006 | [Dockerfile](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/Dockerfile) | `9d633ccf9b305bda53816eabb6461a7e8fadd5d5` |
| R007 | [NEXT_STEPS.md](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/NEXT_STEPS.md) | `ae4fc81a7bb33bad4b25d6064a1ffa48733e119f` |
| R008 | [README.md](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/README.md) | `4b942f87031c10fe5d75e306b40aa2eecd2a71ca` |
| R009 | [admin/App.tsx](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/admin/App.tsx) | `83b8e55cc331b86708a8ed017a5e137c882ab49a` |
| R010 | [admin/OtpQr.tsx](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/admin/OtpQr.tsx) | `976ca08f6a448f6842a3858c6961169259806f5f` |
| R011 | [admin/api.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/admin/api.ts) | `9cda78a4f2973bd672c4bc6ccc8ff5ddd796011d` |
| R012 | [admin/index.html](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/admin/index.html) | `b3260dd5c61c044203b1dfc3578e8da9bdcbe249` |
| R013 | [admin/logo.png](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/admin/logo.png) | `cacd0f4cd7f53c2346070dc48cbef97b76745af7` |
| R014 | [admin/otp-qr.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/admin/otp-qr.ts) | `44fa48b5b512252ad1455d3f54047275e2746e22` |
| R015 | [admin/package.json](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/admin/package.json) | `861f7382f184ad0fe22da1ff670f515fa781eb0b` |
| R016 | [admin/pages.tsx](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/admin/pages.tsx) | `fcd308e838bb32c3890044780148f681c228fccd` |
| R017 | [admin/pnpm-lock.yaml](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/admin/pnpm-lock.yaml) | `91e10b3035fcf5db5c6142c62c8ab0f090aca531` |
| R018 | [admin/styles.css](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/admin/styles.css) | `d2d199d23a685eced04b1eb640c21e4b249cca81` |
| R019 | [admin/tsconfig.json](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/admin/tsconfig.json) | `67650d4bd16f30cadc4055aa8e326f878b126208` |
| R020 | [admin/ui.tsx](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/admin/ui.tsx) | `fdef4b098f0548af8b5fa52ca58a8815fcb3ff1d` |
| R021 | [compose.yaml](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/compose.yaml) | `768c4c4720fc383fe2ee6ab5da26572c0dc39b1a` |
| R022 | [deploy.sh](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy.sh) | `0b1efba11ad4bb1b6d4153c3b6d882b855a427f2` |
| R023 | [deploy/accounts.nginx.conf](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/accounts.nginx.conf) | `87baec8c982b3d880dfc44b8d9f6f345686aadcf` |
| R024 | [deploy/disaster-job.sh](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/disaster-job.sh) | `eb6652a9e46f36ff53c9c54cc57ded53e0686d61` |
| R025 | [deploy/disaster-recover.sh](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/disaster-recover.sh) | `37ae7cb8c96eea6f1ddb8c355d9b0b6857f137f2` |
| R026 | [deploy/install-ops.sh](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/install-ops.sh) | `de5b5955d06102e4b3370a5d88228f9d67770619` |
| R027 | [deploy/tencent-alert.txt](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/tencent-alert.txt) | `b815ba4442c6950c0a66216e8a9ad404ec17019a` |
| R028 | [deploy/tencent-cos-backup-policy.json](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/tencent-cos-backup-policy.json) | `a450a1448fe3d6b1c8b541d1cbe398948d27633f` |
| R029 | [deploy/tencent-cos-lifecycle.xml](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/tencent-cos-lifecycle.xml) | `456cef411d1dab8c9f52d281fa250a516026028c` |
| R030 | [deploy/tencent-otp.txt](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/tencent-otp.txt) | `066be70dadb0dcbb3ffc034e579883b58f7e7a20` |
| R031 | [deploy/tencent-ses-send-policy.json](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/tencent-ses-send-policy.json) | `efe9f9f2e20b29994261d688902f84d2c7c82a6c` |
| R032 | [deploy/voxcue-backup.service](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/voxcue-backup.service) | `06c234a93d7248a5f5acbe71ab0a859c021dd2b6` |
| R033 | [deploy/voxcue-backup.timer](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/voxcue-backup.timer) | `9e4c98d5d5e92a6438a093dc968b41603dfdc5bd` |
| R034 | [deploy/voxcue-monitor.service](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/voxcue-monitor.service) | `10286261599263790a0be8313d9db56377b1884d` |
| R035 | [deploy/voxcue-monitor.timer](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/voxcue-monitor.timer) | `c3037149df32a5676fb68f3884405b147c7b3694` |
| R036 | [deploy/voxcue-restore-drill.service](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/voxcue-restore-drill.service) | `6374f9e786786c96ea20aebf68977a919874ee97` |
| R037 | [deploy/voxcue-restore-drill.timer](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/deploy/voxcue-restore-drill.timer) | `5825884d72b0e67bf3635526a7d4889328d46247` |
| R038 | [package.json](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/package.json) | `bcc7995c18851268d6c70009222eb6ef86ac5480` |
| R039 | [pnpm-lock.yaml](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/pnpm-lock.yaml) | `f80cdad4b4426e77796d0988d5fda878e3b54044` |
| R040 | [scripts/admin-owner.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/scripts/admin-owner.mjs) | `fa211bdd223ba9154045501b0d2d8d4f43ea2f2f` |
| R041 | [scripts/admin.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/scripts/admin.mjs) | `fc1b13f8b7c9e347d4b6675fae02163c4ddb59c4` |
| R042 | [scripts/backup.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/scripts/backup.mjs) | `9bf784dcf241ab1ce566a7d8cd1029128bf9eb71` |
| R043 | [scripts/build-admin.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/scripts/build-admin.mjs) | `78a0d50b8f576786b147af11348ded82ff8cb4a4` |
| R044 | [scripts/deploy.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/scripts/deploy.mjs) | `34cba876c07348fdbb64483146fd49026c2b7f5c` |
| R045 | [scripts/disaster.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/scripts/disaster.mjs) | `92ac92ab4a90c05e27a76ad8a6d9c49c35ae6880` |
| R046 | [scripts/monitor.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/scripts/monitor.mjs) | `7e9de62526deec7c11734facf428c4ba31d1dfa9` |
| R047 | [scripts/ops-common.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/scripts/ops-common.mjs) | `5f3abe9f5ac78169d239c614e46590719a7195ea` |
| R048 | [scripts/ops.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/scripts/ops.mjs) | `b6d45d45a22901bca6a5edb731bf7846f85a3ddc` |
| R049 | [scripts/snapshot.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/scripts/snapshot.mjs) | `baf51b27b66c888dc2830cc409e608e17b09b8f9` |
| R050 | [scripts/typecheck-admin.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/scripts/typecheck-admin.mjs) | `f7f14ea38101ad7104f29fe9528d482c87f2fa6a` |
| R051 | [scripts/typecheck.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/scripts/typecheck.mjs) | `500961254e17e9f69be982d5bec63e24e8f03394` |
| R052 | [src/account-access.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/account-access.ts) | `b647b0bded33e5f64f911a1a0da2738338d37e7c` |
| R053 | [src/admin-assets.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/admin-assets.ts) | `c5f771cae5a2a75c4e147e19630d53fcf2e69808` |
| R054 | [src/admin-auth.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/admin-auth.ts) | `6d65030002bd89165c7d4fa689c763e7b5dbbda2` |
| R055 | [src/admin-operations.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/admin-operations.ts) | `1e8f118857f6d70b29b8a0ace2f17c0de119089f` |
| R056 | [src/admin-queries.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/admin-queries.ts) | `29b18566224882f26d24cf7f586d312e0ef58ea3` |
| R057 | [src/admin-routes.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/admin-routes.ts) | `da717356b18aa8b4ba816a77b37230199fab30c4` |
| R058 | [src/admin-schema.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/admin-schema.ts) | `431dc70ff06fcff53bcc525fa68d056702165a80` |
| R059 | [src/admin.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/admin.ts) | `f8d41029430fb0d17b72fca426934465c80d2688` |
| R060 | [src/auth.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/auth.ts) | `12a915a9960d75b226d53073bc2987e1d525e5da` |
| R061 | [src/backups.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/backups.ts) | `db6a36429c4a373d7d0f679983b50c3fbc0d3fa2` |
| R062 | [src/blobs.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/blobs.ts) | `16d7379118db10b3e34237dcfde63018184def48` |
| R063 | [src/config.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/config.ts) | `ddb57062b63c79b7ac02a8476d1b4e664c295efb` |
| R064 | [src/cos.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/cos.ts) | `8187e3569db034b64a8a726a6759caa864894af4` |
| R065 | [src/crypto.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/crypto.ts) | `05645fa2b33b9e85faf5879f011cde61d2202837` |
| R066 | [src/entitlements.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/entitlements.ts) | `3f42005c696d29f6cdf3c7976b311850f77937ef` |
| R067 | [src/errors.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/errors.ts) | `e03e8648a6530aa555f66fc9e0c680a6dfbb624b` |
| R068 | [src/http.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/http.ts) | `b80ea75b4efade1d5deb5c56f9c7df6c1396b696` |
| R069 | [src/mail-common.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/mail-common.ts) | `72b7b4aaf1416564a597d03033e3c4907a29d990` |
| R070 | [src/mail.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/mail.ts) | `19114c0bb4bbc2d6731702395aeb450761d8b498` |
| R071 | [src/main.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/main.ts) | `d08d405d3464d5ef6b4a4e899b668f674e10b978` |
| R072 | [src/monitor.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/monitor.ts) | `164b48e8b6ebf7ee68b47dd6d02df5548d70cd90` |
| R073 | [src/outbox.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/outbox.ts) | `9d8914cc7b3affe037738cef98781b98eab1cd45` |
| R074 | [src/password-data/LICENSE](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/password-data/LICENSE) | `fbd3be5da1b5c7363ab6d581e4cc6a22a8893683` |
| R075 | [src/password-data/SOURCE.md](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/password-data/SOURCE.md) | `53cda3f89b4828bb1be29298c97ac3aaa815a31d` |
| R076 | [src/password-data/common-passwords.txt](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/password-data/common-passwords.txt) | `a93ea7f91f095b38728795ecd6ec731e59b8c112` |
| R077 | [src/passwords.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/passwords.ts) | `71243892d0e8c6705553d4541c86729a517448bd` |
| R078 | [src/payment-gateway.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/payment-gateway.ts) | `f1b98be7b02807d49d7460543087a97fc9b6e030` |
| R079 | [src/payments.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/payments.ts) | `11cb338a5351d42606952d7fa55df8f7d54b4979` |
| R080 | [src/pressure.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/pressure.ts) | `127d0e4ad231b4872c35744094fb893b44da0a8c` |
| R081 | [src/routes.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/routes.ts) | `3efccbf8ae55f3d71ef21ae02eca813ba29442f5` |
| R082 | [src/schema.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/schema.ts) | `a7248989bdee4b4c715fced384ccef0dd44b5c15` |
| R083 | [src/server-health.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/server-health.ts) | `f32aa43b5cdaf2bd1f849ca1d90f149e5cbe597b` |
| R084 | [src/services.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/services.ts) | `91ce70256e3401bb56cb3141b284f53713e9a938` |
| R085 | [src/store.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/store.ts) | `23fb48547bbecaad85fb93093b3e914aad12e899` |
| R086 | [src/telemetry.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/telemetry.ts) | `b1cf525d70f1cc15e93123e55c20e47cce03da22` |
| R087 | [src/tencent-mail.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/tencent-mail.ts) | `e753bec54d6e8cc8a1025ee123a482fc7a727020` |
| R088 | [src/usage.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/usage.ts) | `cae5ae0b4d2daf4cf8b8b388e4a1675888fe6ac2` |
| R089 | [src/validation.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/validation.ts) | `90c75040208622c54353f93683a213ed56110525` |
| R090 | [src/wechat.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/src/wechat.ts) | `33c5c0fef86f06a53304dc8168bebfd936bcca33` |
| R091 | [test/accounts.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/accounts.test.ts) | `e6275bec59e10b6755c6ae578100b9a67f959483` |
| R092 | [test/admin-fixture.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/admin-fixture.ts) | `abbc8ffe52cf72c4cfb8f8d486a3cba4e542572f` |
| R093 | [test/admin-pressure.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/admin-pressure.test.ts) | `59b9a913a2233a89c4b711a280eb35360be0fb78` |
| R094 | [test/admin-preview.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/admin-preview.mjs) | `aee6bf48562705f7db41a0000c7ab5d1485aad8c` |
| R095 | [test/admin-qr-smoke.mjs](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/admin-qr-smoke.mjs) | `9c3de1b4102f6ef656ce5a7db8a0ae1fbd4b9023` |
| R096 | [test/admin.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/admin.test.ts) | `933c9027f3d91fb1db5e8006d62736c107855177` |
| R097 | [test/adversarial.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/adversarial.test.ts) | `b16e4b098f2707c609605bdc73b0494ccaa78ff4` |
| R098 | [test/backups.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/backups.test.ts) | `976a7ca94da3f96bb8e2523db18637c2539367ae` |
| R099 | [test/cloud-fixture.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/cloud-fixture.ts) | `eaffbb0bd1cef85475856a76fedb6e0b9c5a0200` |
| R100 | [test/cloud-http.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/cloud-http.test.ts) | `2d8161e4576e986b4be1dbe3b6bb633a25725568` |
| R101 | [test/cos-pressure.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/cos-pressure.ts) | `bc71954b60d972609583c27fbff3e7aa7c415f87` |
| R102 | [test/cos.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/cos.test.ts) | `d2b2c41490409fd0009636c74f1eb474cbd6cad9` |
| R103 | [test/monitor.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/monitor.test.ts) | `6eba59b2355092e98121206adcc290e2a921ab09` |
| R104 | [test/operations.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/operations.test.ts) | `b09cc7c997dddc1877eeeb5d295316a2871c7e7a` |
| R105 | [test/ops.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/ops.test.ts) | `d699ff119ba7fbc57520001bdc076d3f060232c5` |
| R106 | [test/password-policy.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/password-policy.test.ts) | `d4afb796372a5706bc5b03b1a85b397d43d03344` |
| R107 | [test/payments.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/payments.test.ts) | `1bd998a659bde4f6748e9aa0fad4092b3d18749c` |
| R108 | [test/pressure.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/pressure.test.ts) | `0ef1d25ba31c2ad24acc78d130e0a20e2c8821ef` |
| R109 | [test/recovery.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/recovery.test.ts) | `63ca24d4b240f5bc5eaf82f5b38bb3c6dcd34a27` |
| R110 | [test/soak.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/soak.ts) | `afdd6867bda9852f800ca5da66f41e50b4cb2345` |
| R111 | [test/sync.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/sync.test.ts) | `210f6973be2f424fddf9764a1844c64bfbd13e79` |
| R112 | [test/tencent-mail.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/tencent-mail.test.ts) | `8e31a8d33758d3805ea82de62fca8b62de6bfbed` |
| R113 | [test/usage.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/usage.test.ts) | `462aca26cf641c05f866646ae2ef6c54a0863f79` |
| R114 | [test/wechat.test.ts](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/test/wechat.test.ts) | `b7151aeacb8fbfcbce8acd813728bfed9c90bca7` |
| R115 | [tsconfig.json](https://github.com/NCFXZ/VoxCue-server/blob/43b6a973849bdc3c204d8434a21857b943048758/tsconfig.json) | `e9ee33758572c9d8e3a3bdd7fb56bb1e43fa11b0` |
