# Mac 正式包隔离验收

当前入口为 `macos/test/scripts/package-guest-smoke.mjs`（在 `macos/` 执行 `pnpm test:package`）。它消费最终签名包，不修改产品字节、fuses、签名或启动参数来恢复测试能力。版本与发行范围见 [PROGRESS.md](../../PROGRESS.md)，凭据规则见 [CREDENTIALS.md](CREDENTIALS.md)。本文只保存准备方法和门禁，不保存测试成绩或运行产物。

## 固定公开输入

工具仅从官方来源下载，先核对摘要，再解包到本轮自有系统临时根；不全局安装，不升级固定版本。公开镜像固定为：

```text
ghcr.io/cirruslabs/macos-tahoe-base@sha256:65c3133a633fda8753cf1f71f2d55727792d534a2125b0032466563dcc8e58fd
```

| 工具 | 固定版本与归档 | SHA-256 |
| --- | --- | --- |
| Tart | 2.41.1 归档 | `e680a734febccfce7d4e910c1f7f13fc3b00f19a181c945e2d746de3214c32c2` |
| Packer | 1.16.2 arm64 ZIP | `3d7e4df8e7e8c21bdf495c4f63ad9189e22540dc8126dee6db791aa8519e8b3a` |
| Tart Packer 插件 | 1.21.0 arm64 ZIP | `4a34ca87b5403629da5ca4938e94eea5bf32805faf034a211835625b637d4e76` |

guest 还需在 `/opt/homebrew/bin/node` 准备与当前测试环境一致的 Node 24.22.1，以及当前入口实际使用的 Apple 编译工具。依赖按 `macos/pnpm-lock.yaml` 冻结安装，仅公开代码和依赖进入来宾输入。

## 准备独立基线

公开 CI 镜像不能直接当作安全基线：Cirrus base 构建关闭 SIP。只在没有宿主共享、产品、测试账号或资料的自有准备 VM 中，通过正常恢复环境启用 SIP，并启用 Gatekeeper。若 Apple 完整启动安全个性化需要联网，仅在该准备阶段完成；之后断网、正常重启并实际核验。不得修改宿主 SIP、辅助功能、锁屏或隐私设置，也不通过 Metal shim 或虚假硬件能力绕过门禁。

准备完成的基线必须停止，运行实例另行克隆。runner 不接管已有活跃用户 VM。当前协议要求：

- `VOXCUE_TEST_TART_HOME` 的父目录为自有、真实且无重定向的临时根，其中 `.owner.json` 的 `kind` 为 `voxcue-macos-120`，`uid` 为当前 UID；该值是 runner 的既有归属协议，不是应用版本。
- 同目录的 `vm-image-source.json` 保存上述固定 `reference` 和 `preparedVM`。准备实例名符合 `voxcue[\w-]+-base`，运行实例名符合 `voxcue[\w-]+`，两者不同且初始均停止。
- 实际 guest 必须是 hypervisor 来宾，机器 UUID 与宿主不同；自有上下文的 UID、nonce、根路径和 guest UUID 一致，目录 `0700`、上下文普通单链接文件 `0600`。
- `csrutil status` 必须为 `System Integrity Protection status: enabled.`，`spctl --status` 必须为 `assessments enabled`，启动参数不得含 AMFI／签名执行绕过项。命令执行结束不能代替重启后的状态核验。

## 输入与执行

从当前仓库和当前平台构建准备输入，再明确设置以下绝对路径：

| 输入 | 含义 |
| --- | --- |
| `VOXCUE_TEST_TART` | 已认证的临时 Tart 可执行文件 |
| `VOXCUE_TEST_TART_HOME` | 上述自有 Tart home |
| `VOXCUE_TEST_VM` | 本轮可丢弃运行实例名 |
| `VOXCUE_TEST_RELEASE_DIR` | 当前最终 DMG、ZIP、`latest-mac.yml` 所在目录 |
| `VOXCUE_TEST_COMPONENT_CACHE` | 已认证的固定公开组件缓存，仅只读复制，不映射用户组件目录 |

在 `macos/` 执行：

```sh
node test/scripts/package-guest-smoke.mjs
```

完整入口先认证 `package-upgrade-baselines.mjs` 中的正式 1.1.1、1.2.2 arm64 ZIP，再复制到规范 `macos/release/<版本>/` 输入位置。它们分别代表旧 v1 和现用 v11 的应用基线。未发布中间应用和凭据候选不进入当前升级排程。

runner 仅分享白名单公开代码、依赖、模型和发行资产的只读临时输入；宿主 home、真实 Keychain、私有签名材料、账号、剪贴板、音频和 USB 均不共享。源依赖的编号副本只有在规范同名项存在时才跳过；代码通过普通归档在 guest 本地恢复，避免 virtiofs framework 链接问题。

guest 外部以太帧由断开的网络 FD 对端全部丢弃，不提供路由；控制命令通过 vsock。runner 核对 `en0` MAC 与 Tart 配置一致后，临时指定 `192.168.248.2` 供同 guest 合成配对自连接；开发夹具只允许此地址和 `127.0.0.1`。不扫描真实设备，也不连接真实服务。

GUI／原生／推理串行执行，并持续核对当前 UID 已登录且解锁的控制台；锁定或未知状态停止。scoped `caffeinate` 只保持唤醒，不解锁或更改锁屏策略。

## 各入口证明的内容

未修改的正式可执行文件通过正常入口冷启动，检查调试启动边界、原生窗口、正常 Quit 和包内 SDK／utility 进程退出；篡改副本不重新签名。另一个固定签名开发宿主只在 guest 内加载未改写的最终 ASAR，检查实际 preload／renderer、SDK、N-API、KnowledgeHost、截图／语音 Worker 与资源闭包。开发宿主不代表产品重新开放了 inspector。

升级资料由对应旧版本 ASAR 创建，替换到当前归档后核对原件、设置、偏好和可检索索引。未修改的新旧正式产品仅证明在正常 guest OS profile 路径启动与退出；资料保留由随后独立开发宿主内的 ASAR 检查确认，不能声称已登录正式账号或读取了正式产品的资料页面。

1.1.1 的归档认证／准备／取消使用未修改的真实旧宿主和最终 native updater，其 NSBundle 身份与版本来自旧包；不以 JS 版本覆盖或重签旧包替代。独立合成 Sparkle 入口负责坏签名、取消、commit／relaunch 和缓存恢复，数据归档覆盖不能称为 Sparkle 安装。最终系统凭据授权另按 [v11 复验条件](../../shared/docs/MACOS_1.2.2_CREDENTIAL_HANDOFF.md#最终签名包与-guest-复验条件)执行。

`--screenshot-only` 是最终 ASAR 合成截图专项：连续编码、错误、取消、期限、Worker 退休和内存收敛；故障注入仅作用于测试宿主，产品不变。音频设备专项只可在独立 guest 使用固定虚拟设备及自有 aggregate，不采样宿主或物理硬件。参数成功或全零 PCM 不能证明音频权限已授权；AudioOnly 和 Screen＋Audio 状态通过正常 guest 系统 UI 建立，不改 TCC 数据库。

owner 只可运行 `package-smoke.mjs --static-only` 的零产品启动检查，读取 ZIP／DMG、签名、fuses、ASAR 和原生元数据；退出 2 表示动态覆盖未执行。产品 `--online`、AEC `--packaged` 和 `package-temporary-smoke.mjs` 已退役。发布后的匿名资产／清单回读不启动产品。

## 结束与异常清理

默认不传 `--retain-vm`。每个消费者退出后，runner 先停止运行 VM，证明其停止后才删除可丢弃实例；最后消费者完成时再清理自建准备基线、快照、工具、专用缓存和只读输入。仅处理归属、真实路径及占用已核验的本轮内容，不删除活跃或归属未知目录。

同步原生调用返回前，JS 信号处理可能延迟；`SIGKILL` 无法执行 JS 清理。异常结束不能算作已收尾，须先确认本轮全部进程退出，再清理合成 Keychain、profile、数据库、截图和工具。未确认退休时保留自有归属记录供后续精确处理，不以发送 kill 作为退出证明。

私钥、更新身份、已发布 v1／v11 规范材料与正式发行恢复原件继续保护。结果仅终端／对话，不将测试成绩、日志、截图、trace 或运行产物保存在工作区。完整开发功能与五档排程仍由 [测试说明](../../shared/test/README.md)中的现行入口负责。
