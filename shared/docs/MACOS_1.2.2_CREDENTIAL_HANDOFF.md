# Mac 1.2.2 凭据助手 v11 交接

本文只保存当前实现、恢复边界、接续入口和验收条件，不向仓库保存测试成绩、日志、截图或运行产物。先读根 AGENTS.md、PROGRESS.md 并检查 status／diff；原理见 [Mac 凭据说明](../../macos/docs/CREDENTIALS.md)，版本汇总见 [Mac 1.2.2](MACOS_1.2.2_RELEASE.md)。

## 基线与规范材料

版本来自 `shared/package.json`。1.2.2 的正式升级基线为 v1.1.1／e0a2a874bffbc37d5af57554074ade6fb7a8f446，使用冻结 v1。v1–v10 源码和规范副本作为恢复原件保留。

当前装配为 v11。此前候选不能用于当前验收或发行；最终包须重新生成并核对规范字节。不替换宿主安装，不用真实登录钥匙串或账号验证；仅用 owned 合成资料及符合系统保护门禁的 guest。

| 项目 | 当前实现 |
| --- | --- |
| 源码 | macos/native/CredentialsVaultV11.mm，复用未改写的 Credentials.mm／CredentialsHardened.mm |
| 身份 | com.voxcue.credentials.vault；既有证书、Hardened Runtime、无 entitlement、正式父 com.voxcue.app |
| 规范材料 | macos/.tools/credential-helper-v11/VoxCue.Credentials 与 build.json，version 11 |
| 二进制 SHA-256 | e9aa737bd20b7a5545ee07c2c384ae45d7fa97b31ba7e38ba2a1ae925704db68 |
| 生产输出 | macos/native/bin/VoxCue；包内 Contents/Resources/native/VoxCue |
| 本代条目 | VoxCue Credential Storage / VoxCue Key v11；创建时中文为“VoxCue 登录信息”，英文为“VoxCue Sign-in Information” |

完整摘要以规范 build.json 和签名公开记录为准，不读私钥。build-vault-credentials.mjs 只认证复制；缺失／错配须恢复精确材料，不能重编后改白名单、轮换证书或回退 ad-hoc。

## v11 修订与来源

v6 已采用单源复制和后续清理，v7 补充严格 owner／ACL／partition 与非交互 validate。v8 使用路径无关的严格代码签名 requirement 校验，安装位置变化不应造成同一冻结助手的本代项冲突；保留 v7 原件，不改其源码或规范字节。当前本代 owner、普通 ACL 和真实 partition 仍收紧，不能只因列表包含当前 CDHash 就接受额外信任；新增纯非交互 validate，防止 probe 后再用普通 decrypt 作为清理门槛而弹窗。主进程补齐本地结构校验和显式恢复，不以 JSON 对象或 crypto 往返成功代替资料可用性。

v9 保留 v8 原件及其身份校验、算法和队列边界，新增固定前代 v8 来源；清理回复包含确认保留的固定别名 ID 与数量，完整枚举前失败则数量为 null，不能显示为零。主进程仅通过内部诊断报告固定名称、数量与原因；用户已明确不修改界面，不增加设置卡片、弹窗或清理入口。必要故障通过既有错误反馈返回固定说明。

v10 保留 v9 规范材料，新增固定前代 v9 来源与严格 language 枚举。仅创建本代项时按应用语言同时设置 label、owner 和普通 ACL 描述；验证仅接纳上述两个固定名称，且 label 与各规则描述一致。名称随创建时语言固定，之后切换界面语言不重命名、不改权、不重授权；历史来源的首次系统授权仍可能显示原名称。

Mac 首次启动先创建原登录窗口但保持不可见，复用既有受控语言握手取得 Renderer 的持久偏好；首次账号恢复与登录 Renderer 的 status 共用同一 Promise，避免并发忙状态被当作未登录。所有原生凭据操作等待语言初始化，10 秒超时或初始化失败时本次启动拒绝凭据请求，迟到握手不恢复失败队列，不以系统语言代替已保存偏好。账号恢复后仅显示原主窗口或登录窗口；不新增可见页面、公开 IPC、偏好文件，也不直接读取 LevelDB 或凭据。

v11 的迁移和清理共用下表，从 1.1.1 的三个正式名称中选源。开发期 v6–v10 不在表内，不查询、不读取、不删除。

本代不存在时按下表只读一个来源，在同一钥匙串以相同密钥创建本代项，重新查询后核对所属钥匙串与访问权限并读回比较。复制不调用改权接口整改旧项、不删旧项、不改原密文；正常授权对来源 ACL／partition 的接纳由 macOS 处理。完全无来源时仅正常加密可新装建密钥；缺密钥解密不生成替代。

| 顺序 | service | account |
| --- | --- | --- |
| 1 | VoxCue Credential Storage | VoxCue Key |
| 2 | VoxCue Safe Storage | VoxCue Key |
| 3 | VoxCue Safe Storage | VoxCue |

本代校验 owner、普通应用规则、描述、prompt、delegate；真实 partition 存在时须唯一且只含本代 CDHash，伪造／混合结构拒绝，系统 Integrity 独立保留；无 partition 的旧格式仍须严格应用身份。本代重名、外来或不可解析项失败关闭。首次复制竞态可用本次来源密钥比对，之后启动只验证本代，不强制重读旧来源。

## 协议和队列

stdin 最多 1 MiB；每种操作均必须携带 language，且仅接受 zh-CN／en；固定操作和字段数，不接受路径、钥匙串、service、account、任意代号或清理范围。

| operation | language 之外的字段 | 回复及边界 |
| --- | --- | --- |
| encrypt／decrypt | data，base64 | `{"data":"<base64>"}`；正常请求可单源迁移，decrypt 先校验 v10 密文格式 |
| probe | 无 | state：ready／authorize／locked／conflict；禁 UI，不创建、改权或删除 |
| validate | data，base64 | 成功 `{"data":"<base64>"}`；预期失败 `{"validation":"unavailable"}` 或 `{"validation":"invalid"}` |
| cleanup | 无 | cleanup：complete／partial／deferred；有界 removed／retained；retainedItems 为固定旧别名 ID，枚举不完整时 retained 为 null；reason：none／current／authorization／failed |

validate 禁 UI，仅解密已有本代项，不迁移、不创建、不读前代或历史别名；关闭交互失败须在访问前退出。回复严格校验，签名／协议异常不能作为正常维护结果。

macos/electron/credentials.ts 同一最多 32 项队列串行所有操作，等 close 才启动下一助手；保留 120 秒期限、有界停止和退出释放，未确认退出不启动替代。

- 尚未接受说明时前台请求先 probe；仅 authorize 显示原生说明并等“继续”，ready 不缓存为授权成功标记。
- locked／conflict 直接报错停止，不自动解锁；“稍后”、实际拒权、权限／协议失败或超时仍锁存，重启后再查。
- 仅确认 close 且严格为解密 errSecDecode (-26275) 的数据错误允许单请求失败后显式重登录。
- maintain(readable) 先 probe，再注入专用 validate 端口；正常不可用／坏数据暂缓，部分清理不锁存正常加解密。签名、协议和生命周期异常仍失败关闭。
- 原生不可重试失败和“稍后”返回固定本地 UNAVAILABLE，120 秒超时返回独立 TIMEOUT；可信本地存储边界识别固定码，阻止误入联网、密文备份或替换，远端／传输伪码不接纳。错误仍使用既有位置。
- 维护只供主进程内部，Renderer 无探测、删除或密钥访问入口。

120 秒是应用侧凭据请求期限，不保证已经显示的 macOS SecurityAgent 授权框会随助手退出自动关闭。超时后停止本次启动的后续请求；如果系统密码框仍显示，用户须在原框选择“拒绝”，再重新启动 VoxCue。手动拒绝是结束遗留授权框的操作，不能算作应用自动撤框。

`SecKeychainSetUserInteractionAllowed(false)` 控制后续钥匙串调用是否可显示界面，不是取消已有系统框的接口；见 [Apple 交互控制说明](https://developer.apple.com/documentation/security/seckeychainsetuserinteractionallowed(_:))。Apple 源码中的 [SecurityAgent 内部 disconnect](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/securityd/src/agentquery.cpp#L294-L310) 不属于应用可用的公开取消接口。当前实现不调用私有取消入口，不锁定整个登录钥匙串、不终止系统进程，也不改写冻结助手来伪装自动关闭。

## 本地门槛、清理和恢复

主进程有限维护机会复用三个存储的正常读取与本地校验，使用非交互 validate：ChatGPT 旧记录的版本、字段和可选 token／scope；云会话的 origin、用户、session、token 与时间；遥测的 schema、实际 installationId、origin、ticket 与内部绑定。

不联网，不要求令牌未过期或账号在线有效。加密 null 不得视为文件不存在；任一失败或账号清除进行中都不清理。零资料也须已有合法可读本代项，不能以清理为由主动授权或建密钥。

cleanup 禁 UI，仅枚举上表三种名称的属性，先及每次删除前检查本代项，再按具体引用删除。用户已选择删除未经密钥比对的旧项，因此不读旧项密钥、不比较副本、不通配其他名称。需授权、状态变化、枚举或删除失败时保留并报告 partial／deferred，不追加密码框、不破坏成功登录、不在每次加解密重试。

只有三个既定旧名称的所有匹配项全部清除才可报告旧名称入口收回；部分保留不能宣称完全撤权。未比对项若含不同密钥，相关历史备份或未纳入校验资料会失去恢复路径。

云会话坏结构／解密失败不再自动 clear；用户主动登录、注册、取码、重置时，先保留原加密文件再替换对应记录，保留失败阻止覆盖。旧 ChatGPT 存储在坏资料后的新写入前也保留密文。副本为应用资料目录内唯一名 .recovery 文件，不含明文或解密密钥。

不承诺无缝降级或往返升级。旧版可能产生不同密钥，回到新版停止清理并保留现场，不因本代名称存在就覆盖候选。当前主要 ChatGPT 登录使用 managed 路径，旧 auth-data/credentials.bin 仍参与保守门槛；云账号重新登录不顺带重置旧 ChatGPT／遥测资料，不能承诺重新登录一个账号就恢复全部资料并清完旧项。

## 验证入口

先用 Mac 本地依赖执行相关类型、架构、单测和共享构建。定向入口位于 macos/test/scripts：

- credential-vault-smoke.mjs：v11 双语创建、切换语言不改项、三个历史名称单来源复制及候选条目隔离、validate、严格归属、固定清理与部分失败。
- cloud-native-vault-smoke.mjs：真实 JS 端口与 owned 合成钥匙串。
- credential-hardening-smoke.mjs --cleanup --fixed-v5：归档兼容边界。
- package-guest-smoke.mjs：最终包隔离入口。

共享 `language-smoke.mjs --bootstrap-only` 定向检查持久语言交叉、隐藏原登录窗口、首次 status 共用、语言超时／Renderer 故障与迟到握手；真实 main／JS 队列连接固定内存原生协议，不访问钥匙串，不能代替最终包授权验收。

credentials.test.ts 覆盖 JS 队列、预检、暂停、异步语言等待／失败围栏、数据恢复和维护分类；共享存储／账号／遥测单测覆盖本地结构、绑定与恢复副本。归档夹具不能代替 v11 验收。

夹具仅用系统临时目录 owned 合成资料；正式 canonical 父边界探针只发固定无效输入，不读宿主凭据。临时钥匙串无现代 partition 层。GUI／原生仅在已登录、解锁控制台串行执行，锁定／未知状态停止，不改系统权限绕过门禁。

## 当前接续环境

使用正式 `macos/release/1.1.1/VoxCue-1.1.1-arm64.zip` 建立历史升级基线。重新准备公开固定 macOS 镜像，在已解锁的隔离 guest 内启用 SIP、Gatekeeper 及签名执行，仅写入合成账号。1.1.1 的 Node 网络可通过进程级 `NODE_EXTRA_CA_CERTS` 信任测试服务的公开根，新版使用 guest 系统信任。两端均验证 HTTPS 证书与域名。

最后一个消费者退出后，清理本轮所有测试 VM、快照、输入、专用缓存及运行产物。下次验收使用保存的测试源码和正式发行包重新建环境。

## 最终签名包与 guest 复验条件

后续正式包按下列条件复验，不保存执行成绩。使用独立 SIP、签名执行与 Gatekeeper 基线、合成资料和最终未改写签名包，不用此前包或临时源码替换代替。

| 编号 | 条件 |
| --- | --- |
| M001 | 重新打包；包内 native/VoxCue 与 v11 规范字节一致，标识 vault、Hardened Runtime、无 entitlement |
| M002 | 真正新装无迁移授权；VoxCue Key v11 的现代 partition 唯一且仅本代，刷新和两次冷启动无重复授权 |
| M003 | 用正式 1.1.1 创建合成历史资料再升级，已解锁且选“始终允许”时仅一次密码，原登录资料可用；与开发候选并存时仍按 1.1.1 顺序选源 |
| M004 | 对应真实授权与 partition 事件，确认只读一个来源，validate／现代清理不追加提示；临时日志不入仓库 |
| M005 | 普通“允许”记录真实提示行为，不算一次通过；新项建成后冷启动不依赖旧项再次授权 |
| M006 | “稍后”不打开系统框；拒绝／超时停止本次重试并保留资料，重启后再查 |
| M007 | 锁定时直接报错停止，不自动解锁或显示迁移说明；解锁后的新启动重新探测 |
| M008 | 额外 partition、外来应用／owner、伪造分区或重复项失败关闭、不删旧项；显示固定冲突处理说明，不将其伪装为网络错误或自动覆盖；旧助手不能无交互读本代项 |
| M009 | 现代清理成功或 partial／deferred 都不追加密码，现用项、v6–v10 和其他无关项保留，部分失败不破坏正常登录，内部诊断报告实际保留数及固定名称；枚举失败明确未知，不能报零 |
| M010 | 坏 JSON／字段／加密 null／缺项／过期但结构有效资料分别检查，维护不走交互迁移或网络认证 |
| M011 | 真实归档 1.1.1 降级后重新登录再升级，分叉／中断保留密文和候选，显式恢复保存原加密文件，不跨模块重置，不承诺一次异常恢复全清 |
| M012 | 同一最终应用在合法安装位置间移动后，既有本代项继续可读；归属比较使用严格 requirement，不因原路径变化失败或放宽身份 |
| M013 | 使用不同应用版本的正规签名测试包正常替换升级，包内助手摘要相同；本代项与原资料保持，不重新迁移或授权 |
| M014 | 真实系统授权框保持不输入，等待生产 120 秒期限与助手退出；本次运行再次操作不得启动替代助手或新授权框，错误保留 TIMEOUT 固定说明；原系统框仍在时由用户选择“拒绝”后重启，手动收尾不得记为自动撤框 |
| M015 | 系统与应用持久语言相反时，新项按应用语言创建；切换语言不改已有项；隐藏登录不提前显示，首次 status 并发不丢自动恢复，语言初始化失败不启动助手 |

结果只在终端／对话。profile、数据库、截图和工具只放系统临时目录；默认在结束／失败／取消时按归属与占用清理，本轮清除全部测试环境及产物，包括正常停机的虚拟机与快照。依赖、模型、签名、冻结助手和发行恢复基线保留。

## 后续修订及 Windows

若最终 guest 暴露冻结 v11 缺陷，另建下一修订并保留 v1–v11，不能原地改源码、摘要后重签。迁移与清理只接纳本次授权的三个正式名称，固定优先级、有界枚举；普通应用升级不制造代际。

Windows 不移植 Mac 原生协议、说明或清理；共享校验、坏资料保留和显式恢复仍需 Windows 本机回归。Mac 不改 Windows 全树，不以本机结果代验。提交、推送、发行和部署按新的明确授权安排。
