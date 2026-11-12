# macOS 1.2.0 实现与验收入口

当前范围和待办以根 `PROGRESS.md` 为准；原始逐项要求见 `MACOS_1.2.0_TODO.md`。本文说明实现和复现入口，不保存测试成绩或运行产物。Windows 专属文件及既有 1.1.1／v1.2.0 冻结资产保持。

## 正式运行时

`package-app.mjs` 在最终签名前调用 `prepareProductionRuntime`：关闭 RunAsNode、NodeOptions、NodeCliInspect，启用 EmbeddedAsarIntegrity 与 OnlyLoadAppFromAsar；保留其余 fuse 状态。固定 Electron 版本的 V1 wire 必须唯一、完整且支持所需位，否则构建失败。Packager 生成的 `ElectronAsarIntegrity` 与实际 ASAR header 对照。

正式 `Contents/MacOS/VoxCue` 使用 `ProductionMain.mm`。它在进入 Electron Framework 前拒绝 remote-debugging port／pipe、Node inspector、DevTools 自动开启及直接伪装子进程的参数，清除会向 SDK／旧 helper 传播的 Node／DYLD／LD 注入环境，按固定证书和主标识验证整个应用的代码与资源封印，再调用原版 `ElectronMain`。此入口不含 profile、Mock、测试脚本或调试开关。

正式代码启用 Hardened Runtime。Browser、Renderer 和 Node utility／Copilot V8 宿主保留 JIT；GPU、Python、Qwen 等不默认获得 JIT。固定本地自签证书没有 Team ID，系统库验证不能将同证书随包库视为同 Team，因此仅 Electron 宿主、Python 和 Qwen 这些实际加载随包库的进程使用 library-validation 例外。不开启 DYLD 环境、unsigned executable memory 或 get-task-allow 例外。Sparkle 工具及普通绑定不继承这些宿主权限。

`RuntimeIntegrity.h` 供正式入口和独立 `VoxCue.Integrity` 共用。Mac Rust MLX 适配器在每次创建 Python 会话前调用固定位置的 verifier，验证全部签名资源后才执行私有 Python；不信任旁边可改写的 build.json，不逐音频块重复校验。该检查仍有校验与使用间的并发修改窗口。

截图的 host／Worker 与 sharp、arm64 sharp binding／libvips 随最终 ASAR 的 unpacked 闭包分发。Mac 直接声明既有 `onnxruntime-common@1.30.0`，满足 Transformers CJS 的实际根引用；固定包、SDK、模型版本不升级。

## 生命周期与更新

CoreAudio 以实际 `close` 作为退休证据。正常 EOF 排空尾包；强制停止明确失败；发送信号、kill 返回 true／false 或异常均不能证明释放。未确认退出时 Mac adapter 的退休栅栏阻止替代采集，真实迟到 close 后才可手动重开。

Rust／Python 管道使用非阻塞读写和整次交换期限：ready 180 秒，命令写入与回复合用 120 秒。无回复、半行、超长、错误 JSON／序号等错误使会话退休并 kill／wait，不在同一失效会话自动重试。既有音频、上下文、端点、CPU 算法和手动恢复策略保持。

更新使用连接／首字节 30 秒、有效写入进展后 120 秒空闲期限，持续有进展的下载不受旧 30 分钟总期限截断。取消不等待失效 reader.cancel Promise；中间进度按整数百分比合并。`archive-ownership-v1.json` 仅记录本实现完成并认证的下载；只回收已被安装版本追上、没有活动消费者、归属／大小／摘要／签名均有效的普通文件。未知历史包、较新的离线更新、链接、损坏项及活动事务保持。

签名材料在读取前检查 owner、0700／0600、普通节点、单链接和真实路径。`update-key-backup.mjs` 提供独立口令 scrypt＋AES-GCM 离线备份和同公钥恢复，默认拒绝覆盖／身份不符，不在参数、环境或输出中传递口令。真实备份由持有人在仓库外的私有离线目录交互执行，例如：

```sh
cd macos
node scripts/update-key-backup.mjs --backup=/absolute/private/offline/update-key.json
```

备份不轮换更新身份，也不代表已替持有人保存了真实私钥。

## 测试入口与隔离

Owner 普通开发测试只允许固定签名开发宿主和自有入口／profile。`test-workspace` 的中断先给嵌套测试清理自身子进程的机会；发送 kill 后未确认退出时保留临时归属记录，不删除活跃 profile。已退役 `package-temporary-smoke.mjs` 与 AEC 的旧 `--packaged` 产品 RunAsNode 分支。

静态验包使用 `node test/scripts/package-smoke.mjs --static-only`，只读取 ZIP、DMG、代码签名、fuses、ASAR 和原生元数据，不执行产品；退出 2 明确表示动态覆盖尚未执行。旧 `--online` 产品调试探针已退役，匿名发行回读使用无产品启动的下载／清单验证。

`pnpm test:package` 路由到 `package-guest-smoke.mjs`。它要求显式的临时 Tart 工具／home、可丢弃 VM、候选发行、认证组件和合成服务端输入。VM 来源固定到 OCI 摘要；只共享白名单公开代码／依赖／模型／发行的只读临时目录，拒绝宿主 home、Keychain、私有签名材料、剪贴板、音频和 USB。网络 FD 的对端丢弃所有帧，不路由网络；guest agent 通过 vsock 运行命令。入口校验 hypervisor、不同宿主 UUID、UID、nonce 与自有私有上下文，失败时零产品启动。结束或失败先停止 VM，确认停止后销毁整个可丢弃 VM。

最终正式可执行文件按正常入口冷启动、检查无调试监听、原生 Quit 并核对本包 SDK／utility 后台为零；篡改副本不重新签名。另一个固定签名开发宿主只在 guest 中加载原封不动的最终 ASAR，消费真实 preload／renderer、SDK、N-API、KnowledgeHost、截图／语音 Worker 与原生依赖。该开发宿主的低版本 Info 与公开 Sparkle key 仅供真实归档 staging／cancel；不修改正式包来恢复 inspector。

历史数据验收使用受保护的实际 1.1.1 二进制生成合成资料，再替换到新归档，核对原件、设置和可检索索引；随后让未修改的新正式可执行文件从 guest 普通 OS profile 路径启动并自然退出，再验证资料。独立合成 Sparkle 入口负责坏签名、取消、commit／relaunch 与缓存恢复，不能将归档替换称为 Sparkle 安装。

开发态完整功能由 `functional-suite.mjs` 排程，五档缩放由 `ui-refinement-matrix.mjs` 排程；包括真实 utility 高输出／退休、SDK 迟到结果、退出 drain、既定面试轮次与固定公开音频长稳。`qwen-regression.mjs` 使用认证临时模型串行运行原生、Worker、切换、父 EOF 和释放／删除；最终 ASAR 组件覆盖由 guest 单独承担。

## 保留边界

- 没有受控虚拟音频设备时，M6 拒权／静音和 M15 多流／多声道设备验收继续待验证，不使用物理采集替代，不凭零值修改音量或路由。
- 固定 `VoxCue.Credentials` 精确字节、CDHash 和已有 ACL 保持。正式入口清理继承环境，凭据 adapter 仅向 helper 提供固定系统 PATH；这能收紧当前产品的调用入口，不能证明旧 helper 自身已具备 runtime 防护或不再信任历史开发父身份。
- 若 M11 的隔离载荷证明旧 helper 自身可注入，后续方案必须包含新 helper 的 runtime／父签名约束、合成 Keychain 中保留原密码与 v10 密文的 ACL／partition 迁移、撤销旧 CDHash 访问及明确回滚边界。仅新增一个加固 helper、只改父程序或保留旧 CDHash 的访问都不能关闭旧二进制路径。真实 ACL／helper 身份迁移需要独立明确授权；本轮不静默改 Keychain 或 hash 白名单。
- 不购买／切换 Developer ID 或公证身份；`captureProtectionSupported:false`、现有算法、外观和数据兼容边界保持。
