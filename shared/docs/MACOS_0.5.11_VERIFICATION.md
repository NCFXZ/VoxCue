# Mac 0.5.11 审查与发行验收

日期：2026-10-25（Europe/London）。比较基线：`4f5e84189b4f3adc6dbc0ea0decb6ce4d1809872`；接续起点：`0c86881c732e87f80bade27e055da950b672914b`，main，起始工作树干净。运行设备为 arm64/macOS 27.0.1；14.2 为实际构建与固定运行时的部署下限，不代表在14.2实机运行过。Windows 专属只读，原 Windows 证据见 [Windows 验收](WINDOWS_0.5.11_VERIFICATION.md)。

本轮授权的自动验收、正式包与公开发行核对已完成；真实账户、物理硬件和旧macOS实机范围仍由用户人工复核。源码最终提交及远端一致性以Git和对话回传为准。

## M01–M12

以下命令除注明外在 `macos/` 执行。所有账户、凭据、资料、图片、捕获和响应均为隔离合成夹具；模型/音频为校验后的固定公开临时资源。GUI/原生串行，不访问真实 VoxCue 账户/keychain 资料或采样物理音频。

| 项目及状态     | 命令或步骤                                                                                                                                | 证据                                                                                                                                                                                                         | 修复文件                                                                                                                           | 复测                                                                                                                    | 未覆盖边界                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| M01 通过       | `git status --short`；`git diff 4f5e841..HEAD`；保护哈希                                                                                  | 起始14项差异与交接一致；100项 Windows/依赖锁/公开签名身份哈希保持                                                                                                                                            | 无生产认证追加修改                                                                                                                 | 最终提交前再核对明确文件清单                                                                                            | 不将 Windows 本机结果当作 Mac 通过                                       |
| M02 通过       | 根目录 `node shared/scripts/sync-platform-manifests.mjs`；`pnpm check:workspace`                                                          | shared/root/Mac 均0.5.11；只有 Mac package.json 版本漂移需生成；布局零违规                                                                                                                                   | `macos/package.json`                                                                                                               | 同步检查通过，Windows 文件不变                                                                                          | 不生成 Windows 配置                                                      |
| M03 通过       | 读取固定包清单与实际文件；`file`；功能矩阵 native-build                                                                                   | Codex 0.164.0-darwin-arm64；实际 Mach-O arm64；Electron/Copilot/Codex/LanceDB/Sherpa/ONNX 的最低系统元数据不超过14.2                                                                                         | 无运行时/依赖变更                                                                                                                  | 开发与最终 ASAR 的原生握手、续期矩阵通过                                                                                | 未在旧 macOS 实机运行                                                    |
| M04 通过       | 对照下列固定官方源码及 `codexUsage.ts`                                                                                                    | true 强制续期；false 调用官方按需认证；5分钟临近过期窗口仍有效；只排除 reset-credit 明细                                                                                                                     | `shared/electron/backend/chat/codexUsage.ts`（沿用已提交修复）                                                                     | 原生成功/失败续期对照通过                                                                                               | 不推断两系统真实网络或凭据差异                                           |
| M05 通过       | `pnpm typecheck`；`pnpm check:architecture`；Renderer/backend tsc noUnusedLocals/noUnusedParameters；`pnpm test --reporter=dot`           | 三组类型通过；226文件、零架构违规/运行时环；89文件900项单元通过                                                                                                                                              | 无额外生产认证修改                                                                                                                 | 最终加载实现后900项完整复测通过                                                                                         | 合成服务/网络，不代表真实 LLM 质量                                       |
| M06 修复后通过 | `node ../shared/test/scripts/chatgpt-usage-runtime-smoke.mjs`；`node test/scripts/chatgpt-renewal-smoke.mjs`                              | 共用smoke26ms；开发按需冷启动57ms、三次读取无续期；旧模式5504ms仍等待；最终ASAR按需53ms、严格断网51ms，旧模式5510ms仍等待；外网/其他端口拒绝                                                                 | `shared/test/scripts/chatgpt-usage-runtime-smoke.mjs`；`macos/test/scripts/chatgpt-renewal-smoke.mjs`、`codex-renewal-fixture.mjs` | 最终 native matrix 全部通过                                                                                             | 计时含进程启动，只是认证阶段；旧模式由测试截止停止，不是实际15秒完成时间 |
| M07 通过       | 同一原生矩阵；managed-auth、codex-usage-runtime、chatgpt-quota 单元                                                                       | 临近过期/过期通过官方本机合成端点续期；有效新令牌重复读取不再续期；两种过期状态的 invalid_grant 均拒绝；远端撤销失败后本地退出清空；切换工作区正确；stop拒绝在途结果；上层代次/迟到额度保护通过              | 无生产认证变更                                                                                                                     | 原生及完整单元复测通过                                                                                                  | 非真实 OAuth 授权/服务器失效；未穷举所有远端错误                         |
| M08 通过       | 功能矩阵 single-login、login-entry、chat-response、chat-lifecycle、interview-retry、interview-stability 等                                | 一次登录、模型目录、额度刷新不重开浏览器；重启恢复、聊天/面试发送/停止/重试及20轮面试通过                                                                                                                    | 无业务流程变更                                                                                                                     | 45组共用功能全部通过                                                                                                    | 官方进程协议与合成业务分层验证，未发送真实 LLM 请求                      |
| M09 通过       | chatgpt-quota/account-usage-ui 单元；single-login/settings UI                                                                             | 5小时/每周/多桶、套餐、百分比、官方重置日期/倒计时、未知值和同邮箱不同工作区/迟到身份检查保持                                                                                                                | 无额度解析或显示变更                                                                                                               | 完整单元和实际 Mac 设置检查通过                                                                                         | 不按套餐推算服务端未提供的信息                                           |
| M10 修复后通过 | `node ../shared/test/scripts/functional-suite.mjs`；`node test/scripts/ui-refinement-matrix.mjs`；`node test/scripts/qwen-regression.mjs` | 首轮59/59（45共用+14 Mac）通过；20轮面试；600秒公开音频 finals=208、interim=1442、maxQueueMs=448、errors=[]；五档100/125/150/175/200%×6组全部30/30；Qwen五项专项通过；88张临时截图中查看18张代表图，结束清理 | `macos/src/icons.tsx`；`shared/src/components/DownloadButton.tsx`；`shared/src/styles.css`；相关测试见清单                         | 最终30组DPI、5项Qwen专项及18张代表图目视复核通过；两处加载像素和减少动态效果通过                                        | 物理音频/触控板/IME/多显示器和旧 macOS 人工验收仍待用户                  |
| M11 通过       | 完整打包、package-smoke、package-runtimes-smoke                                                                                           | 0.5.11、arm64、14.2部署下限、固定代码/凭据助手、公钥、Ed25519/SHA512、薄包与实际应用全部通过；最终ASAR按需53ms/严格断网51ms，旧强制模式5510ms仍等待                                                          | `macos/test/scripts/package-runtimes-smoke.mjs`                                                                                    | package-smoke --install-archive 与 package-runtimes-smoke 全部通过；真实Sparkle认证并暂存正式归档后取消，临时旧应用保持 | 不替换真实安装，不轮换代码/凭据助手/Ed25519身份                          |
| M12 通过       | 本账本、Git审计、发行/API/匿名下载核对                                                                                                    | 0.5.10原ID/六个旧下载均404；0.5.11为Latest且Mac/Windows共六项；原三项Windows及其他旧/模型资产保持；Mac三项匿名完整下载摘要一致                                                                               | 本账本、交接/测试/清理文档和AGENTS                                                                                                 | 最终签名安装版客户端实际选中0.5.11、认证清单、完整下载ZIP并验证SHA512；源码明确清单已审计                               | 真实账户、真人回答质量和实际安装由用户复核                               |

## 官方语义与实验边界

固定版本 [account_processor.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/request_processors/account_processor.rs) 的 `get_auth_status_response` 先执行显式刷新请求；true 随后读取缓存，false 经 `auth().await` 执行官方按需逻辑。额度请求仍读取实际用量，只跳过独立 reset-credit 明细。固定 [manager.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/login/src/auth/manager.rs) 对临近5分钟的令牌进行主动续期；临时失败可返回原令牌，但 VoxCue 的 managedAccess 仍拒绝已过期值，永久失败不会导出令牌。[workspace_routing.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/request_processors/account_processor/workspace_routing.rs) 继续以账户所有者和代次隔离路由。

Mac 对照实验只在自有子进程把官方存储改为临时合成 file fixture，生产始终是 keyring，没有明文回退。sandbox 禁止外网，仅允许 `localhost:<本次端口>`；独立探针确认外网与另一端口立即拒绝，并禁止读取真实钥匙串目录及访问 securityd。代理从不转发，官方无关后台发现连接保持停滞，计数只统计续期端点；不能把“无续期请求”表述为官方进程完全没有后台网络尝试。

强制续期负对照仅在测试启动器中将发往同一官方二进制的 getAuthStatus 参数改回基线的 true；按需组直接执行当前生产 Runtime 的 false 路径。二进制、合成有效期、代理和其余参数一致，不修改生产源码或增加令牌缓存。若正式 ASAR 仍强制刷新，按需组的五秒截止会失败。

首次运行的两处测试问题均已修复：Mac sandbox 地址过滤只接受 localhost/*，原127.0.0.1写法导致配置被拒绝；之后“所有代理连接必须为0”的断言把官方无关后台发现误计为续期，现按实际续期目的地/本机合成端点区分，并保留所有非测试路由停滞。没有放开外网或调整生产权限。首次完整单元在受限执行沙箱下因 loopback listen EPERM 等环境原因失败7项；在允许自有合成监听的环境原断言900项通过，未放宽测试门槛。

## 加载动画与清理

Mac Loader 继续使用 AppKit 生成的 `progress.indicator` 遮罩，增加逐段亮度变化，避免仅靠对称静态图旋转表达进度；停用外围重复旋转。本地组件不确定进度/校验改用同一个 Mac Loader，正常百分比环和 Windows 原不确定圆环保持。首秒取消、禁用、更新保存确认及减少动态效果继续执行。侧栏测试将合成安装准备态暂停，直接比较浅深色的连续图标像素；组件校验也检查实际像素和无障碍状态。

清理仅移除经消费者/精确路径/无重定向/lsof无占用核对的十张旧 `macos/.cache/launcher.iconset` 中间PNG，共479209逻辑字节；正式ICNS/PNG、源码、依赖、固定运行时/模型、历史发行及恢复资料保留。详见 [清理说明](WORKSPACE_CLEANUP.md)。

## 待人工项目

- 真实 ChatGPT/Copilot 账户：由用户自行授权并复试启动恢复、模型目录、聊天/面试与额度刷新。分别观察认证完成、首字和完整回答，勿把本次认证毫秒数作为 LLM 速度承诺；若比较系统差异，应另控制同账户、网络和时段，不读取/导出令牌。
- macOS 14.2 实机：检查启动、权限、原生窗口、凭据接续、模型推理及更新。当前27.0.1设备的14.2部署元数据/ABI/签名检查不能代替旧系统实机。
- 物理设备：真人麦克风/系统混音与同时说话、外接/蓝牙切换、物理触控板和IME候选窗、多显示器和真实显示缩放；自动检查仅覆盖合成输入和Electron受控缩放。
- 真实安装/更新：由用户决定是否安装。自动流程只在自有临时应用验证签名、加载和更新归档，不替换 `/Applications/VoxCue.app`，不自动回答任何真实权限或钥匙串弹窗。

## 正式资产与公开状态

既有 [v0.5.11](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.5.11) 的 release ID 保持423566131，Latest API 返回同一ID。只追加以下三项，未将既有Windows发行改成草稿。匿名完整下载三项的字节数、SHA256及SHA512均与本地正式产物一致。

| Mac 文件                | Asset ID  | 字节数    | SHA256                                                           |
| ----------------------- | --------- | --------- | ---------------------------------------------------------------- |
| VoxCue-0.5.11-arm64.dmg | 675870885 | 631063171 | 3506cc0a5725b382ce7df5c10090972f5f36dd57d3e642aedf05e160511e6ee3 |
| VoxCue-0.5.11-arm64.zip | 675872837 | 586516989 | bd5689f3b6543219c42cc7b10ef924a04bb5df1feb3708b4a9b70b794212cd57 |
| latest-mac.yml          | 675873885 | 492       | 532b88d4961b39250e2d82aead9f07df9aaef8d8b4d2f12e18138c488b2f47fa |

ZIP SHA512：`6WSpFPBWcVkTl3gFUvCrIi+8YIOXUAkJotb35NjLbKiYw77sdZ61i+jAwcKrVwN3i0Z/m4UhlTRfodAJ+b58gg==`。归档Ed25519和清单签名通过既有公钥认证；固定代码证书及凭据助手原字节/身份保持。

Windows三项仍为675725086（EXE）、675725936（blockmap）、675725946（latest.yml），其大小/SHA256与 [Windows验收](WINDOWS_0.5.11_VERIFICATION.md) 完全一致。上传前后以认证API核对所有其他旧/模型发行的说明与资产ID/大小/摘要保持；0.5.10原release ID 423408483返回404，六个原匿名下载地址均404，列表没有该发行。没有重建、恢复或重新公开0.5.10；标签页200不属于发行资产可读证据。

公开更新日志保留原两条ChatGPT启动/恢复与等待改进，仅追加一句Mac加载动画修复，没有实现、测试数字、摘要或交接过程。正式三项留在 `macos/release/0.5.11`，不进入源码提交。

## 可复核入口

在仓库根执行同步，其余进入 `macos/`。环境需允许自有临时loopback监听；GUI/原生串行，勿启动旧物理音频采样入口。所有下载均为固定公开临时模型，不借用真实用户模型库。

```sh
node shared/scripts/sync-platform-manifests.mjs
cd macos
pnpm typecheck
pnpm check:architecture
pnpm check:workspace
node node_modules/typescript/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters
node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit --noUnusedLocals --noUnusedParameters
pnpm test --reporter=dot
pnpm build
node ../shared/test/scripts/functional-suite.mjs
node ../shared/test/scripts/chatgpt-usage-runtime-smoke.mjs
node test/scripts/chatgpt-renewal-smoke.mjs
node test/scripts/ui-refinement-matrix.mjs
node test/scripts/qwen-regression.mjs
pnpm package:installer
node test/scripts/package-runtimes-smoke.mjs
node test/scripts/package-smoke.mjs --install-archive
node test/scripts/package-smoke.mjs --online
```

正式输出目录已存在时打包命令会拒绝覆盖；复核现有正式包直接运行对应验包命令，不删除历史发行来重打。`--install-archive` 只修改临时解压的旧版本副本，真实Sparkle暂存后取消，未提交安装。

`package-smoke --online` 已由最终签名安装版进程选中0.5.11，认证公开清单、下载完整更新ZIP并通过SHA512；没有调用安装。所有临时模型、应用副本、profile、数据库、截图及下载缓存随运行退出清理，正式三项及此前历史发行保留。

## 本次源码清单

接续起点之后只提交以下21项；固定依赖/锁、Windows专属及公开签名身份文件保持。安装包、模型、依赖/构建/测试产物、临时上传工具和凭据不入Git。原0.5.11共用认证修复已在接续起点提交中，本次不重复改写它。

```text
AGENTS.md
PROGRESS.md
README.md
macos/package.json
macos/src/icons.tsx
macos/test/scripts/chatgpt-renewal-smoke.mjs
macos/test/scripts/codex-renewal-fixture.mjs
macos/test/scripts/package-runtimes-smoke.mjs
macos/test/scripts/ui-refinement-matrix.mjs
shared/docs/MACOS_0.5.11_HANDOFF.md
shared/docs/MACOS_0.5.11_VERIFICATION.md
shared/docs/WORKSPACE_CLEANUP.md
shared/src/components/DownloadButton.tsx
shared/src/styles.css
shared/test/README.md
shared/test/scripts/assert-loading-icon.mjs
shared/test/scripts/chatgpt-usage-runtime-smoke.mjs
shared/test/scripts/components-ui-smoke.mjs
shared/test/scripts/functional-suite.mjs
shared/test/scripts/updates-sidebar-smoke.mjs
shared/test/scripts/updates-smoke.mjs
```
