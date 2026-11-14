# Mac 凭据与版本升级

应用版本唯一来源为 `shared/package.json`。当前 Mac 凭据由主进程平台端口与冻结 v11 原生助手处理；Renderer 不取得密钥、系统密码或维护命令。接续见 [1.2.2 凭据交接](../../shared/docs/MACOS_1.2.2_CREDENTIAL_HANDOFF.md)。

## 升级时会发生什么

从旧正式 v1 升级时，首次只读取一个历史来源，把同一把密钥复制到 v11 条目，将旧项清理推迟到本地资料校验通过之后。读取密钥可能触发系统授权；串行队列避免多个应用请求同时弹窗。

| 用户遇到的情况 | 预期行为 |
| --- | --- |
| 首次安装，没有历史条目 | 第一次需要保存登录资料时创建密钥，通常无需输入钥匙串密码。 |
| 升级时，历史钥匙串已解锁且需要授权 | VoxCue 先说明迁移。用户继续后，在 macOS 系统框选择“始终允许”，正常目标是一次密码输入；选择普通“允许”可能还需再输入一次。 |
| 迁移后的正常使用与普通升级 | 后续使用现用条目。助手字节和权限有效时，刷新、重启或应用版本变化本身不会要求重新迁移。 |
| 清理时某个旧项需要授权 | 保留该项并在内部诊断列出固定名称，登录可以继续。 |
| 钥匙串锁定、出现同名冲突，或用户拒绝授权 | 当次启动停止相关请求。按原有错误提示手动解锁或核对条目，再重新启动。 |
| 保存的密文损坏，或降级期间产生了另一把密钥 | 停止清理。用户主动恢复对应账号时，先保存原密文副本；其他尚未恢复的资料继续阻止清理。 |

系统密码只输入在 macOS 自己的授权框中。VoxCue 的登录表单用于 VoxCue 账号。系统框中的申请者名称是 `VoxCue`；新条目按创建时的应用语言显示“VoxCue 登录信息”或“VoxCue Sign-in Information”。历史条目首次被读取时，系统可以显示它原有的名称。

## 冻结身份与恢复基线

用户发行与恢复基线仅包含旧正式 v1 和现用 v11：Mac 1.1.1 使用 v1，已发布的 Mac 1.2.2 及当前版本使用 v11。保留两者的规范字节和恢复说明，不覆盖、重签或当作普通缓存清理；未发布候选不进入构建、测试或恢复排程，开发历史查 Git。

v11 源码为 `macos/native/CredentialsVaultV11.mm`，复用未改写的 `Credentials.mm` v10 算法与 `CredentialsHardened.mm` 身份工具。归档算法只取得已验证的内存密钥，不能自行查询或创建其他别名。长期标识 `com.voxcue.credentials.vault`，沿用既有证书、Hardened Runtime、无 entitlement、正式父 `com.voxcue.app` 校验。

规范材料为受忽略的 `macos/.tools/credential-helper-v11/VoxCue.Credentials` 与 `build.json`，绑定 version 11、证书、三份源码摘要和二进制摘要。签名公开信息见 `macos/local-signing-public.json`，私钥不作为验证输入。`build-vault-credentials.mjs` 只认证复制为 `native/bin/VoxCue`，整包签名不重签助手；缺失或错配须恢复精确材料，不能重编、改摘要白名单、轮换证书或回退 ad-hoc。

本代条目固定为 `VoxCue Credential Storage / VoxCue Key v11`。仅助手规范字节修订时才增加存储代际，普通应用升级复用同一助手和条目。生产申请者文件名“VoxCue”；新项按创建时应用语言设置 label、owner 和普通 ACL 描述，中文“VoxCue 登录信息”，英文“VoxCue Sign-in Information”。已有项切换语言不重命名、不改权或重新授权；历史来源首次授权仍可能显示原名称。验证只接受上述两个固定名称，且 label 与规则描述一致。

Mac 首次启动先创建原登录窗口但保持不可见，复用既有受控语言握手取得 Renderer 的持久偏好；首次账号恢复与登录 Renderer 的 status 共用同一 Promise，避免并发忙状态被当作未登录。所有原生凭据操作等待语言初始化，10 秒超时或初始化失败时本次启动拒绝凭据请求，迟到握手不恢复失败队列，不以系统语言代替已保存偏好。账号恢复后仅显示原主窗口或登录窗口；不新增可见页面、公开 IPC、偏好文件，也不直接读取 LevelDB 或凭据。

固定证书和 designated requirement 不自动改写历史授权。Apple 为不能归入受信签名类别的程序使用 CDHash 作为 partition 身份，同一自签名证书不是固定 partition 的证明。[Apple 身份生成实现](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp)

## 单一来源复制与严格归属

v11 报告确认保留的固定别名 ID 与数量；枚举未完成以 null 表示未知，不报告虚假的零项。迁移和清理仅接纳 1.1.1 使用的三个名称，其他名称不查询、不读取、不删除，也不计入清理结果。

本代项存在时只读取通过校验的本代项。不存在时按下表选第一个存在的来源；同名来源多份时沿用系统搜索列表首项，查询有界：

| 顺序 | service | account |
| --- | --- | --- |
| 1 | VoxCue Credential Storage | VoxCue Key |
| 2 | VoxCue Safe Storage | VoxCue Key |
| 3 | VoxCue Safe Storage | VoxCue |

只读取一个来源，在其所在钥匙串用同一密钥创建本代项，重新查询、核对来源与新项所在的钥匙串、校验归属并逐字节读回比较。复制不删旧项、不调用改权接口整改旧项、不改原密文；正常授权对来源 ACL／partition 的接纳由 macOS 处理。并发创建的胜者同样须校验，不覆盖同名项。完全没有来源时，仅正常加密可新装建密钥；解密缺密钥不生成替代。

本代项先校验类别、精确名称、owner 和普通应用规则；应用规则比较原始代码签名 requirement 与当前 designated requirement 的规范数据，不能以旧路径或描述字符串代替签名身份，安装路径变化不改变该身份：仅当前助手，描述、prompt、delegate 符合本代策略。真实 partition 存在时必须唯一且只含本代 CDHash，不能由普通 ANY-or-PROMPT 记录冒充；Integrity 独立保留。无 partition 的旧格式分支仍须严格应用身份。同名多份、外来信任、混合或不可解析结构均失败关闭，不读、不覆盖、不自动修权。首次复制可比较本次已读取的来源；后续启动不强制重读旧来源。

系统 partition／Integrity 不伪造、不改写。临时旧格式钥匙串不能证明现代分区行为。沿用旧 v10：PBKDF2-HMAC-SHA1、1003 轮、原盐／IV、AES-128-CBC。旧格式无认证标签，crypto 往返一致不是资料正确性的充分证明。

## 原生协议与队列

stdin 最多 1 MiB；每种操作均必须携带 language，且仅接受 zh-CN／en，操作与字段数严格白名单，不接受任意路径、钥匙串、service、account、代号或删除范围。密钥不离开原生进程，不进入参数、环境、日志或临时文件。

| operation | language 之外的输入 | 回复及边界 |
| --- | --- | --- |
| encrypt／decrypt | data，base64 | `{"data":"<base64>"}`；正常请求可单源迁移，decrypt 先校验 v10 密文格式 |
| probe | 无其他字段 | state：ready／authorize／locked／conflict；禁 UI，不创建、改权或删除 |
| validate | data，base64 | 成功 `{"data":"<base64>"}`；预期失败 `{"validation":"unavailable"}` 或 `{"validation":"invalid"}` |
| cleanup | 无其他字段 | cleanup：complete／partial／deferred；有界 removed／retained；固定 retainedItems，枚举不完整时 retained 为 null；reason：none／current／authorization／failed |

validate 禁 UI，只解密已有本代项，不迁移、不创建、不读前代或旧别名。禁交互设置失败须在访问前退出。

所有操作共用最多 32 项的串行队列，等待 close 后才启动下一助手；保留 120 秒期限、有界停止和退出释放。未确认退出不启动替代。尚未接受说明时，前台请求先 probe，仅 authorize 显示原生说明并等待“继续”；ready 不缓存为授权成功标记。locked／conflict 直接报错并停止本次请求，不自动解锁。“稍后”、实际拒权、权限／协议失败或超时仍锁存，重启后再查。

原生不可重试失败和“稍后”通过固定本地 UNAVAILABLE 分类返回重启说明；120 秒请求超时使用独立 TIMEOUT 分类，提示原系统框仍显示时先选“拒绝”。云账号仅在可信本地存储边界识别这些固定码，阻止将授权失败误作坏资料恢复而继续联网、备份或替换；远端／传输伪码不能冒充。错误沿用现有反馈位置，不增加界面布局。

仅确认助手 close 且严格为解密 errSecDecode (-26275) 的数据错误允许单请求失败后显式重新登录。validate 的正常不可用／坏数据暂缓维护；cleanup 部分完成／暂缓不锁存正常加解密。签名、协议和生命周期异常不降为可忽略维护结果。

## 超时与系统框边界

120 秒是应用侧凭据请求期限，不保证已经显示的 macOS SecurityAgent 授权框会随助手退出自动关闭。超时后停止本次启动的后续请求；如果系统密码框仍显示，用户须在原框选择“拒绝”，再重新启动 VoxCue。手动拒绝是结束遗留授权框的操作，不能算作应用自动撤框。

`SecKeychainSetUserInteractionAllowed(false)` 控制后续钥匙串调用是否可显示界面，不是取消已有系统框的接口；见 [Apple 交互控制说明](https://developer.apple.com/documentation/security/seckeychainsetuserinteractionallowed(_:))。Apple 源码中的 [SecurityAgent 内部 disconnect](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/securityd/src/agentquery.cpp#L294-L310) 不属于应用可用的公开取消接口。当前实现不调用私有取消入口，不锁定整个登录钥匙串、不终止系统进程，也不改写冻结助手来伪装自动关闭。

## 无弹窗清理与本地校验

主进程启动后的有限维护机会先无交互 probe，再注入专用 validate 解密端口。不能用先前 probe 为 ready 推断普通 decrypt 不会授权。

- ChatGPT 旧记录校验版本、字段类型及可选 token／scope。
- 云会话复用 origin、用户、session、token 与时间结构校验。
- 遥测证明复用 schema、实际 installationId、origin、ticket 及内部绑定校验。
- 只检查实际存在的本地资料；加密 null 不得冒充缺文件。不联网，不要求令牌未过期或账号在线有效。
- 任一只读解密／结构失败或账号清除进行中就不清理。零资料也须已有合法可读的本代项，不能以清理为由主动授权或建密钥。

通过门槛后，cleanup 禁交互，先及每次删除前检查本代项，再枚举上表三种名称的属性并按具体引用删除。不读旧项密钥、不比较副本、不通配删除，包含用户已选择删除的未经比对旧别名。

需要授权、状态变化、枚举或删除失败时保留，报告部分完成／暂缓，不追加密码框，不让成功登录失败，不在每次加解密时重试。只有三个既定旧名称的所有匹配项全部清除才可报告旧名称入口收回。主进程仅在内部诊断记录确认保留的数量、固定名称与原因，未完成枚举明确为未知；不输出原始异常、路径或密钥，不增加设置卡片、窗口或清理入口。真正无本地资料且本代项尚未建立时，不误报旧项未清理。禁交互限定自有维护进程，不是系统弹窗总开关。[Apple 交互控制说明](https://developer.apple.com/documentation/security/seckeychainsetuserinteractionallowed(_:))

## 安全取舍与恢复

不收集或缓存 Mac 登录密码、钥匙串密码，不保存“已授权”标记，不改写系统句式、按钮和密码框。清理前旧程序仍可能经旧项取得同一密钥；部分保留不能宣称全部入口收回。删除旧项也不撤销过去已被取走的密钥。

未经比对的旧项若含不同密钥，删除会使相关历史备份或未纳入校验资料失去恢复路径；仅保留密文不能代替保留解密密钥。

云会话解密／结构失败不再自动 clear；用户主动登录、注册、取码或重置时，先保留加密原文件再允许对应记录替换，保留失败阻止覆盖。旧 ChatGPT 存储在坏资料后的新写入前也保留原密文。副本为应用资料目录内唯一名 .recovery 文件，不含明文或解密密钥。

降级再登录可能产生不同密钥。新版不得仅凭本代名称存在就覆盖候选；校验失败停止清理并保留现场。云账号重新登录不顺带重置旧 ChatGPT／遥测资料，不承诺一次重新登录即可恢复全部资料并清完旧项。正常身份、路径和钥匙串状态下刷新／冷启动应无重复授权，外部锁定、撤权或损坏仍须明确处理。

## 验证与交付边界

定向入口为 `credential-vault-smoke.mjs`、`credential-vault-policy-smoke.mjs`、`cloud-native-vault-smoke.mjs` 与 `package-guest-smoke.mjs`，均位于 `macos/test/scripts`。先用 Mac 本地依赖构建共享代码；类型、架构和相关单测按风险执行。当前原生入口消费 v11，覆盖双语创建、切换语言不改项、三个正式历史来源及其他名称隔离；credentials.test.ts 覆盖队列、异步语言等待／失败围栏、预检、暂停、数据错误恢复、validate 和维护分类；共享单测覆盖本地校验和加密恢复副本。正式包准备及清理门禁见 [隔离 guest](TEST_GUEST.md)。

夹具仅用系统临时目录内 owned 合成资料、nonce 父与严格白名单源码替换；正式 canonical 父边界探针仅发固定无效输入，不访问宿主凭据。旧格式临时钥匙串不能代替最终未改写签名包的现代分区／真实授权验证。

最终包复验条件：独立 SIP、签名执行和 Gatekeeper guest 内的新装、已解锁历史“始终允许”一次、普通“允许”、现代 partition 归属、现代清理、刷新／两次冷启动及中断冲突。GUI／原生只在已登录、解锁控制台串行执行，锁定／未知状态停止，不改系统权限绕过门禁。结果只在终端／对话；profile、数据库、截图、工具仅系统临时目录，结束按归属／占用清理。

一次目标依据是“始终允许”同时接纳 ACL 与 partition；普通“允许”可能触发独立分区提示。必须最终包实测，不能从合成夹具无 UI 推导已验证一次。[Apple 授权实现](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/acl_keychain.cpp)

Windows 不使用 Mac 原生协议、说明或清理；共享校验、坏资料保留及恢复行为仍须 Windows 本机回归。Mac 不修改 Windows 全树，不以 Mac 结果代验。
