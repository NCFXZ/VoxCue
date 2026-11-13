# Mac 1.2.2 实现与验收边界

版本唯一来源为 `shared/package.json`。根与 Mac 清单同步到 1.2.2，Windows 清单在其本机同步；Windows 专属目录在 Mac 保持只读。1.2.0→1.2.1 的共享与原生实现见既有发行和 Windows 交接文档，本篇补充 1.2.2。

## 凭据授权与兼容清理

- 云账号、遥测证明和 ChatGPT 共用 Mac 凭据队列，最多 32 项，当前助手实际关闭后才执行下一项。拒绝、锁定、异常和超时终止本次启动中的自动重试；重启后重新执行正常校验。失败不保存密码、授权成功标记或替代密钥，保留原凭据文件。
- 生产助手为固定 v8（`com.voxcue.credentials.vault`，沿用既有证书），复用冻结 v1 的 v10 加解密与 v2 代码身份检查；v1–v7 源码和规范字节保留，构建只认证复制冻结字节。
- 首次升级优先读取 v7、v6，再按 v1 顺序选择一个旧来源，在来源钥匙串以同一密钥创建 `VoxCue Credential Storage / VoxCue Key v8` 并读回比较。显示名称保持“VoxCue 登录信息”与“VoxCue”。复制不删除、不调用改权接口整改旧项，正常授权接纳仍由系统处理；本代 owner 和普通 ACL 使用路径无关的严格签名 requirement 校验，并核对唯一当前真实 partition，同名冲突失败关闭。应用在合法安装位置间移动不应因旧路径记录造成归属冲突。
- 未接受迁移说明前，各次前台加解密均无交互探测；ready 不缓存为授权成功，仅 authorize 提示“始终允许”。“稍后”、锁定或冲突直接停止自动重试，不自动弹解锁框。
- 后台清理门槛使用专用无交互 validate，只读取既有 v8 项，不迁移或创建。现存资料必须通过原有本地解密与完整字段校验，遥测绑定实际 installationId，不依赖网络或令牌是否过期。通过后无交互按引用删除 v7、v6 及三个既定旧名称，不读取旧密钥；预期部分失败保留并单独报告，不锁存凭据队列。
- 明确的密文解码错误不再阻止用户主动重新登录；坏资料不自动删除，替换前保留加密原文件。异常旧 ChatGPT 或遥测资料不会被云账号恢复顺带重置，仍可能阻止清理。相关共享恢复行为需 Windows 本机验证。
- 目标是正常历史升级（已解锁并选“始终允许”）一次输入，同一冻结身份及正常系统状态下后续不重复授权。普通“允许”可能两次；未比对旧项若含不同密钥会随清理删除；不承诺无缝降级。见 [凭据说明](../../macos/docs/CREDENTIALS.md)与 [v8 交接](MACOS_1.2.2_CREDENTIAL_HANDOFF.md)。最终包的一次授权、路径移动、现代 partition 与系统清理按交接条件复验，不能由旧格式夹具代替系统交互。
- 额度卡片移除中英“额度已用尽”提示，保留剩余比例、进度与重置时间；可继续额外用量使用中性说明，不改变额度计算或服务错误。

## Mac 账号网络

Mac adapter 为云账号和同源遥测提供实际 Electron 系统网络端口，遵循 macOS 已明确批准的证书信任与代理策略。此前账号使用 Node 的独立 CA 集合，可能拒绝已被系统信任的服务证书；其他桌面下载通道已使用系统网络。

该端口强制 `credentials: omit`、`cache: no-store`、`redirect: error`、`referrerPolicy: no-referrer`，保留调用方显式授权、请求体和取消信号。系统默认 Cookie 及响应 Cookie 不参与账号授权；未知 CA、主机名不符和重定向仍须拒绝。正式账号地址、TLS 校验、签名与完整性保护不增加例外或测试开关。

共用装配只消费可选平台端口，backend 仍通过原接口协调；Windows 未提供此端口，沿用其现有传输。Windows 不复制 Mac 实现，其系统网络与证书策略应在本机独立验收。

新增凭据失败／拒权／繁忙／无效响应的英文提示与当前中文文案对应；清除已无调用方的旧提示映射。错误翻译保留重启操作，不修改用户或模型原文。

## 正式包隔离验收

`package-guest-smoke.mjs` 从已停止的独立基线克隆。`guest-isolation.mjs` 同时要求 SIP 开启、没有 AMFI／签名执行绕过参数，以及 Gatekeeper `assessments enabled`。公开 CI 镜像的 SIP 和 Gatekeeper 必须在没有产品／测试账号资料的准备阶段恢复，并在正常系统重启后核验；不把恢复命令执行完成当作已生效。

仅共享白名单公开代码、依赖、模型和发行资产的只读临时输入；宿主 home、真实 Keychain、音频、USB 与剪贴板不共享。测试 guest 的外部以太帧全部丢弃，通过 vsock 控制。GUI／原生测试在当前解锁控制台串行执行。

新装／历史升级弹窗验收须使用最终未改写的签名应用、合成账号及正常系统授权界面。合成 HTTPS 仅在可丢弃 guest 内通过正常系统信任设置建立，正式包保留固定地址与完整 TLS 校验；测试证书、服务和资料不进入产品或仓库。助手夹具、开发宿主或最终 ASAR 的普通界面成绩不能替代该验收。

测试结果仅终端／对话；必要的 profile、数据库、截图和工具放在系统临时目录，测试结束按归属、路径和占用门禁清理，保留现用模型、固定助手及发行恢复基线。

## 验证入口

- `shared/test/scripts/interview-usage-offline.mjs --full`
- `shared/test/scripts/functional-suite.mjs --jobs=1`
- `macos/test/scripts/ui-refinement-matrix.mjs`
- `macos/test/scripts/credential-vault-smoke.mjs`、`credential-vault-policy-smoke.mjs`、归档 v5／v2 入口及 `cloud-native-vault-smoke.mjs`
- `macos/test/scripts/audio-conversion-smoke.mjs`、`audio-restart-smoke.mjs`、`qwen-regression.mjs`、`speech-preroll-smoke.mjs` 与 `interview-real-audio-smoke.mjs --all`
- `macos/test/scripts/package-guest-smoke.mjs`，以及最终应用的正常界面新装／升级授权验收

完整执行入口、固定服务端参照和平台边界见 [测试说明](../test/README.md)。发行后另附 1.2.0→1.2.2 Windows 逐条实现与验收交接。
