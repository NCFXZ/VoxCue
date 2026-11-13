# Mac 1.2.2 凭据助手 v8 交接

本文只保存当前实现、恢复边界、接续入口和验收条件，不保存测试成绩、日志、截图或运行产物。先读根 AGENTS.md、PROGRESS.md 并检查 status／diff；原理见 [Mac 凭据说明](../../macos/docs/CREDENTIALS.md)，版本汇总见 [Mac 1.2.2](MACOS_1.2.2_RELEASE.md)。

## 基线与规范材料

使用 main，基线 b316cd4fec2498e938c14bd26da2c5d80e6da330 上本轮改动未提交／推送／发布；版本唯一来源仍为 shared/package.json 的 1.2.2。已发行 Mac 基线 macos-v1.2.1／64f61050a7f37848a153e6ed90ab6ddd009d3778 使用冻结 v2。v1–v7 源码和规范副本保留，不覆盖、不重签、不清理。

当前装配为 v8。此前 v5／v6／v7 候选不能用于当前验收或发行；最终包须重新生成并核对规范字节。不替换宿主安装，不用真实登录钥匙串或账号验证；仅用 owned 合成资料及符合系统保护门禁的 guest。

| 项目 | 当前实现 |
| --- | --- |
| 源码 | macos/native/CredentialsVaultV8.mm，复用未改写的 Credentials.mm／CredentialsHardened.mm |
| 身份 | com.voxcue.credentials.vault；既有证书、Hardened Runtime、无 entitlement、正式父 com.voxcue.app |
| 规范材料 | macos/.tools/credential-helper-v8/VoxCue.Credentials 与 build.json，version 8 |
| 二进制 SHA-256 | dd8c53296ea2e1f49d92a40eef2a8bd2d488b450ac72f6567ea764cbd2802218 |
| 生产输出 | macos/native/bin/VoxCue；包内 Contents/Resources/native/VoxCue |
| 本代条目 | VoxCue Credential Storage / VoxCue Key v8，显示“VoxCue 登录信息” |

完整摘要以规范 build.json 和签名公开记录为准，不读私钥。build-vault-credentials.mjs 只认证复制；缺失／错配须恢复精确材料，不能重编后改白名单、轮换证书或回退 ad-hoc。

## v8 修订与来源

v6 已采用单源复制和后续清理，v7 补充严格 owner／ACL／partition 与非交互 validate。v8 使用路径无关的严格代码签名 requirement 校验，安装位置变化不应造成同一冻结助手的本代项冲突；保留 v7 原件，不改其源码或规范字节。当前本代 owner、普通 ACL 和真实 partition 仍收紧，不能只因列表包含当前 CDHash 就接受额外信任；新增纯非交互 validate，防止 probe 后再用普通 decrypt 作为清理门槛而弹窗。主进程补齐本地结构校验和显式恢复，不以 JSON 对象或 crypto 往返成功代替资料可用性。

本代不存在时按下表只读一个来源，在同一钥匙串以相同密钥创建本代项，重新查询后核对归属并读回比较。复制不调用改权接口整改旧项、不删旧项、不改原密文；正常授权对来源 ACL／partition 的接纳由 macOS 处理。完全无来源时仅正常加密可新装建密钥；缺密钥解密不生成替代。

| 顺序 | service | account |
| --- | --- | --- |
| 1 | VoxCue Credential Storage | VoxCue Key v7 |
| 2 | VoxCue Credential Storage | VoxCue Key v6 |
| 3 | VoxCue Credential Storage | VoxCue Key |
| 4 | VoxCue Safe Storage | VoxCue Key |
| 5 | VoxCue Safe Storage | VoxCue |

本代校验 owner、普通应用规则、描述、prompt、delegate；真实 partition 存在时须唯一且只含本代 CDHash，伪造／混合结构拒绝，系统 Integrity 独立保留；无 partition 的旧格式仍须严格应用身份。本代重名、外来或不可解析项失败关闭。首次复制竞态可用本次来源密钥比对，之后启动只验证本代，不强制重读旧来源。

## 协议和队列

stdin 最多 1 MiB；固定操作和字段数，不接受路径、钥匙串、service、account、任意代号或清理范围。

| operation | 字段 | 回复及边界 |
| --- | --- | --- |
| encrypt／decrypt | data，base64 | `{"data":"<base64>"}`；正常请求可单源迁移，decrypt 先校验 v10 |
| probe | 无 | state：ready／authorize／locked／conflict；禁 UI，不创建、改权或删除 |
| validate | data，base64 | 成功 `{"data":"<base64>"}`；预期失败 `{"validation":"unavailable"}` 或 `{"validation":"invalid"}` |
| cleanup | 无 | cleanup：complete／partial／deferred；有界 removed／retained；reason：none／current／authorization／failed |

validate 禁 UI，仅解密已有本代项，不迁移、不创建、不读前代或历史别名；关闭交互失败须在访问前退出。回复严格校验，签名／协议异常不能作为正常维护结果。

macos/electron/credentials.ts 同一最多 32 项队列串行所有操作，等 close 才启动下一助手；保留 120 秒期限、有界停止和退出释放，未确认退出不启动替代。

- 尚未接受说明时前台请求先 probe；仅 authorize 显示原生说明并等“继续”，ready 不缓存为授权成功标记。
- locked／conflict 直接报错停止，不自动解锁；“稍后”、实际拒权、权限／协议失败或超时仍锁存，重启后再查。
- 仅确认 close 且严格为解密 errSecDecode (-26275) 的数据错误允许单请求失败后显式重登录。
- maintain(readable) 先 probe，再注入专用 validate 端口；正常不可用／坏数据暂缓，部分清理不锁存正常加解密。签名、协议和生命周期异常仍失败关闭。
- 维护只供主进程内部，Renderer 无探测、删除或密钥访问入口。

## 本地门槛、清理和恢复

主进程有限维护机会复用三个存储的正常读取与本地校验，使用非交互 validate：ChatGPT 旧记录的版本、字段和可选 token／scope；云会话的 origin、用户、session、token 与时间；遥测的 schema、实际 installationId、origin、ticket 与内部绑定。

不联网，不要求令牌未过期或账号在线有效。加密 null 不得视为文件不存在；任一失败或账号清除进行中都不清理。零资料也须已有合法可读本代项，不能以清理为由主动授权或建密钥。

cleanup 禁 UI，仅枚举上表五种名称的属性，先及每次删除前检查本代项，再按具体引用删除。用户已选择删除未经密钥比对的旧项，因此不读旧项密钥、不比较副本、不通配其他名称。需授权、状态变化、枚举或删除失败时保留并报告 partial／deferred，不追加密码框、不破坏成功登录、不在每次加解密重试。

只有五种名单全部清除才可报告旧名称入口收回；部分保留不能宣称完全撤权。未比对项若含不同密钥，相关历史备份或未纳入校验资料会失去恢复路径。

云会话坏结构／解密失败不再自动 clear；用户主动登录、注册、取码、重置时，先保留原加密文件再替换对应记录，保留失败阻止覆盖。旧 ChatGPT 存储在坏资料后的新写入前也保留密文。副本为应用资料目录内唯一名 .recovery 文件，不含明文或解密密钥。

不承诺无缝降级或往返升级。旧版可能产生不同密钥，回到新版停止清理并保留现场，不因本代名称存在就覆盖候选。当前主要 ChatGPT 登录使用 managed 路径，旧 auth-data/credentials.bin 仍参与保守门槛；云账号重新登录不顺带重置旧 ChatGPT／遥测资料，不能承诺重新登录一个账号就恢复全部资料并清完旧项。

## 验证入口

先用 Mac 本地依赖执行相关类型、架构、单测和共享构建。定向入口位于 macos/test/scripts：

- credential-vault-smoke.mjs：v8 单源复制、v7／v6 来源、validate、严格归属、固定清理与部分失败。
- cloud-native-vault-smoke.mjs：真实 JS 端口与 owned 合成钥匙串。
- credential-hardening-smoke.mjs --cleanup --fixed-v5：归档兼容边界。
- package-guest-smoke.mjs：最终包隔离入口。

credentials.test.ts 覆盖 JS 队列、预检、暂停、数据恢复和维护分类；共享存储／账号／遥测单测覆盖本地结构、绑定与恢复副本。归档夹具不能代替 v8 验收。

夹具仅用系统临时目录 owned 合成资料；正式 canonical 父边界探针只发固定无效输入，不读宿主凭据。临时钥匙串无现代 partition 层。GUI／原生仅在已登录、解锁控制台串行执行，锁定／未知状态停止，不改系统权限绕过门禁。

## 最终签名包与 guest 复验条件

后续正式包按下列条件复验，不保存执行成绩。使用独立 SIP、签名执行与 Gatekeeper 基线、合成资料和最终未改写签名包，不用此前包或临时源码替换代替。

| 编号 | 条件 |
| --- | --- |
| M001 | 重新打包；包内 native/VoxCue 与 v8 规范字节一致，标识 vault、Hardened Runtime、无 entitlement |
| M002 | 真正新装无迁移授权；VoxCue Key v8 的现代 partition 唯一且仅本代，刷新和两次冷启动无重复授权 |
| M003 | v2 式历史与 v6／v7 接续分别升级，已解锁且选“始终允许”时仅一次密码，原登录资料可用 |
| M004 | 对应真实授权与 partition 事件，确认只读一个来源，validate／现代清理不追加提示；临时日志不入仓库 |
| M005 | 普通“允许”记录真实提示行为，不算一次通过；新项建成后冷启动不依赖旧项再次授权 |
| M006 | “稍后”不打开系统框；拒绝／超时停止本次重试并保留资料，重启后再查 |
| M007 | 锁定时直接报错停止，不自动解锁或显示迁移说明；解锁后的新启动重新探测 |
| M008 | 额外 partition、外来应用／owner、伪造分区或重复项失败关闭、不删旧项；旧助手不能无交互读本代项 |
| M009 | 现代清理成功或 partial／deferred 都不追加密码，新项／无关项保留，部分失败不破坏正常登录 |
| M010 | 坏 JSON／字段／加密 null／缺项／过期但结构有效资料分别检查，维护不走交互迁移或网络认证 |
| M011 | 分叉／中断保留密文和候选，显式恢复保存原加密文件，不跨模块重置，不承诺一次异常恢复全清 |
| M012 | 同一最终应用在合法安装位置间移动后，既有本代项继续可读；归属比较使用严格 requirement，不因原路径变化失败或放宽身份 |

结果只在终端／对话。profile、数据库、截图、工具只放系统临时目录，结束／失败／取消按归属与占用清理；依赖、模型、签名、冻结助手和发行恢复基线保留。

## 后续修订及 Windows

若最终 guest 暴露冻结 v8 缺陷，另建下一修订并保留 v8，不能原地改源码、摘要后重签。新代仅接纳显式前代名称，固定优先级、有界枚举；普通应用升级不制造代际。

Windows 不移植 Mac 原生协议、说明或清理；共享校验、坏资料保留和显式恢复仍需 Windows 本机回归。Mac 不改 Windows 全树，不以本机结果代验。提交、推送、发行和部署按新的明确授权安排。
