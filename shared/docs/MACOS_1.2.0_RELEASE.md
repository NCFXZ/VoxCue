# macOS 1.2.0 基线与 1.2.1 实现

当前范围和待办以根 `PROGRESS.md` 为准；原始逐项要求见 `MACOS_1.2.0_TODO.md`。本文说明实现和复现入口，不保存测试成绩或运行产物。Windows 专属文件及既有 1.1.1／v1.2.0 冻结资产保持。

1.2.0 基线资产位于[既有 1.2.0 稳定发行](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.0)，本地只保留 macos/release/1.2.0 的 DMG／ZIP／latest-mac.yml，不进入 Git。产品源码标签为 `macos-v1.2.0`（`10ac04b`）；共享／Windows 的原 `v1.2.0` 标签保持在 `0bc1cd4`，后续夹具和文档提交不改变发行字节。

1.2.0 原发行保留；凭据加固、自动重启、短音隔离、路由与界面修复已作为 [Mac 1.2.1 稳定发行](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.1)交付，产品快照为 macos-v1.2.1／64f6105。当前任务包含完整回归及最终包隔离验收，范围与发行状态以 PROGRESS.md 为准。Windows 专属适配另由其本机接续。

## 正式运行时

`package-app.mjs` 在最终签名前调用 `prepareProductionRuntime`：关闭 RunAsNode、NodeOptions、NodeCliInspect，启用 EmbeddedAsarIntegrity 与 OnlyLoadAppFromAsar；保留其余 fuse 状态。固定 Electron 版本的 V1 wire 必须唯一、完整且支持所需位，否则构建失败。Packager 生成的 `ElectronAsarIntegrity` 与实际 ASAR header 对照。

正式 `Contents/MacOS/VoxCue` 使用 `ProductionMain.mm`。它在进入 Electron Framework 前拒绝 remote-debugging port／pipe、Node inspector、DevTools 自动开启、直接伪装子进程及关闭 sandbox／Web 安全／证书验证的参数，清除会向 SDK／旧 helper 传播的 Node／DYLD／LD 注入环境，按固定证书和主标识验证整个应用的代码与资源封印，再调用原版 `ElectronMain`。此入口不含 profile、Mock、测试脚本或调试开关。

正式代码启用 Hardened Runtime。Browser、Renderer 和 Node utility／Copilot V8 宿主保留 JIT；GPU、Python、Qwen 等不默认获得 JIT。固定本地自签证书没有 Team ID，系统库验证不能将同证书随包库视为同 Team，因此仅 Electron 宿主、Copilot loader、Python 和 Qwen 这些实际加载随包库的进程使用 library-validation 例外。Copilot loader 动态加载随包 `runtime.node`，只看 `otool` 链接表不足以判断其权限。不开启 DYLD 环境、unsigned executable memory 或 get-task-allow 例外。Sparkle 工具及普通绑定不继承这些宿主权限。

`RuntimeIntegrity.h` 供正式入口和独立 `VoxCue.Integrity` 共用。Mac Rust MLX 适配器在每次创建 Python 会话前调用固定位置的 verifier，验证全部签名资源后才执行私有 Python；不信任旁边可改写的 build.json，不逐音频块重复校验。该检查仍有校验与使用间的并发修改窗口。

截图的 host／Worker 与 sharp、arm64 sharp binding／libvips 随最终 ASAR 的 unpacked 闭包分发。Mac 直接声明既有 `onnxruntime-common@1.30.0`，满足 Transformers CJS 的实际根引用；固定包、SDK、模型版本不升级。

凭据构建使用独立冻结的 v2 helper。`CredentialsHardened.mm` 复用未修改的 v1 密码／v10 实现，只接受固定证书的正式父进程，并核对双方 runtime 和危险 entitlements。构建记录覆盖两份源码、证书和精确二进制；首次写入拒绝覆盖，后续构建和整包签名只验证、复制同一字节，不重签 helper。v1 源码及规范二进制保留为恢复／兼容基线，不再写入生产 native/bin。

新 helper 精准查找三个既有服务／账号的全部匹配条目，核对原密码一致后，将 trusted-app ACL 与 partition 收紧到新 CDHash；新建条目一开始也采用相同访问限制。旧密码与 v10 密文保持，不删除 Keychain 项。首次操作可能需要持有人通过标准系统界面授权；助手不接收或代输系统口令。跨多个条目的写入不是原子事务：中途失败不返回密文、不生成替代密码、不恢复旧访问，下次同一 helper 可继续迁移。撤权后的旧 helper／旧版应用不能作为自动回滚路径。

## 生命周期与更新

CoreAudio 以实际 `close` 作为退休证据。正常 EOF 排空尾包；强制停止明确失败；发送信号、kill 返回 true／false 或异常均不能证明释放。未确认退出时 Mac adapter 的退休栅栏阻止替代采集，真实迟到 close 后才可手动重开。

系统音频按 HAL 首选立体声声道定位原始输出流索引，再转换为流内声道对，只平均选中的声道。`AudioRoute.h` 与 `AudioSamples.h` 由实际采集和原生专项共用；不根据零值猜活跃通道，不统一放大或混入其他输出流。单流 mono／stereo 缺少首选元数据时兼容，未知多声道、跨流／重叠／越界和实际 tap 格式不匹配明确拒绝；错误文案中英同步。映射所依赖的现存 HAL 属性发生变化时停止，等待手动重新开始。麦克风原转换、PCM 包协议和积压预算保持。

Rust／Python 管道使用非阻塞读写和整次交换期限：ready 180 秒，命令写入与回复合用 120 秒。无回复、半行、超长、错误 JSON／序号等错误使会话退休并 kill／wait，不在同一失效会话自动重试。既有音频、上下文、端点及 CPU 算法保持。

1.2.1 新增 M8：仅 Mac adapter 启用共享 controller 的有界自动重启。已运行会话发生明确可恢复的进程故障时，先停止采集并确认 Worker 实际退休，再按 1／2／4 秒退避，最多连续三次；稳定运行且有近期实际处理 ACK 才恢复预算。手动停止、暂停、切换或关闭取消恢复归属和初始化等待。权限／设备错误、歧义管道错误、模型语义错误及启动失败明确停止；原积压预算保持，恢复过程有既有状态和间断通知。原生 exit 未 close 时保留有界 watchdog 和退休栅栏。

更新使用连接／首字节 30 秒、有效写入进展后 120 秒空闲期限，持续有进展的下载不受旧 30 分钟总期限截断。取消不等待失效 reader.cancel Promise；中间进度按整数百分比合并。`archive-ownership-v1.json` 仅记录本实现完成并认证的下载；只回收已被安装版本追上、没有活动消费者、归属／大小／摘要／签名均有效的普通文件。未知历史包、较新的离线更新、链接、损坏项及活动事务保持。

签名材料在读取前检查 owner、0700／0600、普通节点、单链接和真实路径。`update-key-backup.mjs` 提供独立口令 scrypt＋AES-GCM 离线备份和同公钥恢复，默认拒绝覆盖／身份不符，不在参数、环境或输出中传递口令。真实备份由持有人在仓库外的私有离线目录交互执行，例如：

```sh
cd macos
node scripts/update-key-backup.mjs --backup=/absolute/private/offline/update-key.json
```

备份不轮换更新身份，也不代表已替持有人保存了真实私钥。

持有人可用同一工具的 `--verify=/绝对备份路径` 在本机隐藏输入口令，认证备份并核对派生公钥；该操作不读取现用私钥、不创建或覆盖恢复密钥。当前持有人指定的是 OneDrive 加密副本：结构／权限检查及本机隐藏口令认证、派生公钥核对均已完成；不称为物理离线介质。

## 测试入口与隔离

Owner 普通开发测试只允许固定签名开发宿主和自有入口／profile。`test-workspace` 的中断先给嵌套测试清理自身子进程的机会；发送 kill 后未确认退出时保留临时归属记录，不删除活跃 profile。已退役 `package-temporary-smoke.mjs` 与 AEC 的旧 `--packaged` 产品 RunAsNode 分支。

静态验包使用 `node test/scripts/package-smoke.mjs --static-only`，只读取 ZIP、DMG、代码签名、fuses、ASAR 和原生元数据，不执行产品；退出 2 明确表示动态覆盖尚未执行。旧 `--online` 产品调试探针已退役，匿名发行回读使用无产品启动的下载／清单验证。

`pnpm test:package` 路由到 `package-guest-smoke.mjs`。它要求显式的临时 Tart 工具／home、可丢弃 VM、候选发行和认证组件。只共享白名单公开代码／依赖／模型／发行的只读临时目录，拒绝宿主 home、Keychain、私有签名材料、剪贴板、音频和 USB。源依赖中的编号副本仅在规范同名项已存在时跳过，不改原目录；代码通过归档在 guest 本地恢复，避免 virtiofs framework 链接问题。网络 FD 的对端丢弃所有帧，不路由网络；guest agent 通过 vsock 运行命令。入口校验 hypervisor、不同宿主 UUID、UID、nonce 与自有私有上下文，并要求 SIP 开启、没有 AMFI／签名执行关闭参数，失败时零产品启动。结束或失败先停止 VM，确认停止后销毁整个可丢弃 VM。

公开 CI 镜像不能直接当作安全基线：Cirrus 的 base 构建流程关闭 SIP。VM 必须从固定 OCI 摘要准备，并仅在自有恢复环境恢复 SIP；如 Apple 完整启动安全个性化需要联网，只在没有宿主共享、没有产品／测试资料的准备阶段完成，之后断网重启，实际门禁仍重新核对系统状态。不改宿主 SIP、隐私或辅助功能设置，不通过 DYLD Metal shim 或虚假硬件能力来通过正式包验收。

`vm-image-source.json.preparedVM` 指向同一自有 Tart home 中、停止且开启 SIP 的临时基线，运行实例与基线必须不同。guest 先验证身份、SIP 和控制台，再核对 `en0` MAC 与 Tart 配置一致，临时指定 `192.168.248.2` 供同 guest 的私有网络配对自连接；不扫描真实设备。开发宿主的 HTTP 夹具只允许该地址与 `127.0.0.1`，所有外部以太帧仍由断开的 FD 对端丢弃。普通 UI 夹具显式固定中文语言端口，真实旧应用仅设置合成用户的语言偏好，不更改旧包字节。

本轮公开隔离输入固定为 `ghcr.io/cirruslabs/macos-tahoe-base@sha256:65c3133a633fda8753cf1f71f2d55727792d534a2125b0032466563dcc8e58fd`。工具按官方来源与摘要校验后仅解包到系统临时目录：Tart 2.41.1 归档 SHA-256 `e680a734febccfce7d4e910c1f7f13fc3b00f19a181c945e2d746de3214c32c2`；Packer 1.16.2 arm64 ZIP `3d7e4df8e7e8c21bdf495c4f63ad9189e22540dc8126dee6db791aa8519e8b3a`；Tart Packer 插件 1.21.0 arm64 ZIP `4a34ca87b5403629da5ca4938e94eea5bf32805faf034a211835625b637d4e76`。临时基线与缓存结束清理，不能将 CI 工具的宽松系统设置当作正式安全结论。

最终正式可执行文件按正常入口冷启动、检查无调试监听、原生 Quit 并核对本包 SDK／utility 后台为零；篡改副本不重新签名。另一个固定签名开发宿主只在 guest 中加载原封不动的最终 ASAR，消费真实 preload／renderer、SDK、N-API、KnowledgeHost、截图／语音 Worker 与原生依赖。真实归档 staging／cancel 使用未修改的实际 1.1.1 host 和最终 native updater，其 NSBundle 身份／版本是真实旧包；不靠 JS 版本覆盖、重签旧包或修改最终包恢复 inspector。

历史数据验收使用受保护的实际 1.1.1 二进制生成合成资料，再替换到新归档，核对原件、设置和可检索索引；随后让未修改的新正式可执行文件从 guest 普通 OS profile 路径启动并自然退出，再验证资料。独立合成 Sparkle 入口负责坏签名、取消、commit／relaunch 与缓存恢复，不能将归档替换称为 Sparkle 安装。

开发态完整功能由 `functional-suite.mjs` 排程，五档缩放由 `ui-refinement-matrix.mjs` 排程；包括真实 utility 高输出／退休、SDK 迟到结果、退出 drain、既定面试轮次与固定公开音频长稳。`qwen-regression.mjs` 使用认证临时模型串行运行原生、Worker、切换、父 EOF 和释放／删除；最终 ASAR 组件覆盖由 guest 单独承担。

本轮专项入口：`package-guest-smoke.mjs --screenshot-only` 只对真实签名包执行连续合成编码、错误／取消／实际期限、Worker 退休与 RSS 收敛；故障注入仅作用于测试宿主中的截图 Worker 构造器，最终 ASAR 不变。`audio-restart-smoke.mjs` 使用真实 Worker 与合成采集子进程；`credential-hardening-smoke.mjs` 仅使用显式临时 Keychain 集合，不修改宿主搜索列表；`audio-conversion-smoke.mjs` 由生产共用 PCM 转换实现承载。设备和权限对照另外走 guest-only `audio-virtual-smoke.mjs`，不能将纯转换／预检结果等同设备通过。

凭据迁移与危险权限夹具使用随机 nonce 父身份，临时源码仅严格替换预期测试父标识，生产冻结源码／字节保持。临时父进程绑定本轮 helper 路径和精确 CDHash，助手与 manager 也独立限制 owned Keychain；不保留可转发任意程序的正式身份 launcher。真实 production canonical 的正式父探针只发送固定无效请求，不进行凭据访问。临时进程、合成 Keychain 与签名父探针结束即清理；本轮按持有人要求连同上一环节 OS 基线及工具环境一并清理。经认证的公开模型／音频遵循平台缓存规则。

音频设备专项的生产 helper 测量走 guest `tart-guest-agent` 责任链，正常系统 UI 分别建立拒权、授权及重新只允许音频的状态；参数和全零样本不作为权限证据。同进程私有 aggregate 的 source-integration 夹具另需该 guest 责任链的 Screen＋Audio 授权，不能将它的权限条件称为正式应用要求。仅使用固定虚拟设备与 nonce-owned aggregate，不采样宿主或物理设备。


隔离工具和 VM 由带 owner 标记的自有根管理，本轮结束清理，不将旧缓存路径作为长期复用入口。最终包必须从停止且开启 SIP 的干净基线克隆，音频就绪实例不能称为干净系统；源、发行和模型输入每次重新认证。guest 的 AudioOnly 与 Screen＋Audio 状态通过正常系统 UI 建立和核对，不修改 TCC 数据库；私有 aggregate 夹具的权限条件不能转述为正式应用要求。

## 保留边界

- M6 已在 SIP guest 的固定虚拟输出及正常权限 UI 完成对照：拒权仍可启动并持续交付全零 PCM，与授权静音不可区分；只重新允许音频录制后手动启动可恢复固定合成音。不据零值增加拒权警报或自动停止；预检仍不读取样本。覆盖责任链为 tart-guest-agent→实际音频 helper，不代表正式应用父链或所有硬件。M15 已按真实 HAL 首选声道修复稀释／选流，并对签名新 helper 完成受控单设备、多流、运行中变更及权限重测；这些设备专项不扩称所有硬件；完整包验收由独立入口承担。
- v2 helper 的实现与合成迁移验证不等于本机真实 Keychain 已迁移，也不等于原发行包已更新。旧 helper 基线的非 runtime 属性没有被重签掩盖；新版本实际完成 ACL／partition 迁移后才撤销其对旧条目的访问。
- 不购买／切换 Developer ID 或公证身份；`captureProtectionSupported:false`、现有算法、外观和数据兼容边界保持。
