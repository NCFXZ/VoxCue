# Mac 安装与免费自动更新

当前源码面向 Apple Silicon arm64、macOS 14.2及以上，使用共用网页控件、SF Symbols和原生侧栏材质，不再要求Liquid Glass。固定Codex0.164.0、Copilot SDK/平台运行时1.0.21；模型与ONNX Web不内嵌，最终用户无需另装Node/Python。首次下载DMG后将VoxCue拖入Applications。应用按本平台最高完整正式资产选择更新，不依赖统一Latest；面试期间禁止安装，重启前等待保存成功，普通退出不触发安装。当前 Mac 正式源码为 [macos-v1.2.3](https://github.com/NCFXZ/VoxCue/tree/macos-v1.2.3)，已发行 1.1.1／1.2.2 用于升级兼容；未发布 Mac 中间版本不作为恢复或测试入口。当前线上发行与任务范围见[进度](../../PROGRESS.md)，最终包门禁见 [guest 准备](TEST_GUEST.md)。

采用 [Sparkle](https://sparkle-project.org/documentation/) 2.10.0 的免费 Ed25519 更新签名。已发布至0.3.1的应用使用ad-hoc代码签名；2026-10-19起的源码打包流程改为复用固定本地自签名证书；0.5.5 再增加独立固定签名凭据助手，保留其代码哈希，修复仅固定应用证书仍反复要求钥匙串授权的问题。首次导入历史密码仍可能需要一次系统授权，详见[凭据与版本升级](CREDENTIALS.md)。未购买Developer ID，也未经过Apple公证。首次打开时macOS仍可能阻止运行，需用户在“系统设置 → 隐私与安全性”明确允许该应用；更新不会替用户关闭系统安全检查或移除隔离属性。现有发行资产没有自动重建。

更新选项位于“设置 → 关于与更新”，自动下载默认开启并保存在本机；关闭后仅检查和提醒。侧栏使用共用36px圆形操作，展开时悬停/键盘聚焦以中性胶囊显示下载、取消或重启，收起侧栏保持图标。首秒取消保护、主题色进度环、保存确认和面试禁装保持；Mac加载使用SF Symbols静态遮罩与12段扫亮。关闭设置不停止进度刷新，关闭自动下载不取消已开始的下载；只有明确安装且保存成功后才进入Sparkle。

## 持久检查与完整包恢复

0.6.9 的 Mac 适配器复用共享 `UpdateCache`，在 main 受控的 `userData/updates/release-cache.json` 保存检查尝试、成功时刻、下载 journal、冷却及完整包元数据。启动和普通检查共用一小时窗口，失败尝试与时间回拨也保留限频；发网络请求前原子记录尝试，缓存损坏或读写失败明确报错。按钮长按五秒强查绕过 TTL 并清除自动下载冷却，失焦、隐藏、提前松开或移出仍取消计时。

Mac 元数据保留 `edSignature` 与 `voxcueSignature`，每次缓存读取重新执行本平台选择及现有公钥认证，绑定版本、文件名、大小、SHA512、归档签名和最低系统版本。完整 ZIP 位于固定的 `userData/updates/archives`，普通退出保留；更高版本完整包优先离线恢复，自动下载关闭或检查缓存过期也无需重复联网。恢复重新核对路径、普通文件、大小与流式 SHA512，错误不会静默显示已下载。相同或更旧的包不阻止到期检查新版本。

下载先记录所属发行，再写独占 `.partial` 文件、校验并原子发布。失败先等待传输结束再清理所属普通半成品；退出、取消/超时等中断另持久记录一小时自动下载冷却，普通 HTTP/摘要失败明确报错。手动下载仍可用，偏好值不变。崩溃 journal 中的完整可信归档保留，未知路径或符号链接拒绝清理并保留 journal。重复退出等待同一个异步屏障，已提交安装不取消、不删除 Sparkle 占用的完整归档。

恢复不启动安装。只有显式安装且通过原有面试限制和保存握手后，才重验归档、创建随机 token 的本地 feed，继续 `begin → ready → commit → quit`；Sparkle 的归档验签保持。验证入口为 Mac `update-driver.test.ts`、共享 `update-cache.test.ts`、`updates-smoke.mjs` 与本机 `updates-native-smoke.mjs`，后者包含真实 Electron 传输的 owner loopback 缓存矩阵及原生安装流程。

## 网络增量与全量兜底

从 1.3.3 起，Mac 下载器可复用 `userData/updates/archives` 中与运行版本对应的完整 ZIP。它先核对旧包的大小和 SHA512，再从所选发行源匿名获取 `VoxCue-<版本>-arm64.zip.delta.json`。清单的独立 Ed25519 签名将增量计划绑定至旧版版本、旧包摘要和目标 ZIP。完整 ZIP 的 v1 签名格式继续兼容旧客户端。

增量计划列出可从旧 ZIP 复制的相同字节区间，其余区间由同源 HTTP Range 请求取得。下载器校验每次响应的 206 状态、`Content-Range` 和长度。拼出的 ZIP 必须与目标的签名清单长度和 SHA512 完全一致，才进入原有缓存与 Sparkle 安装流程。旧包缺失或不匹配、计划未提供或认证失败、Range 失败及组装错误会改走已认证的全量下载。用户取消时停止传输并清理半成品。

当前运行版本的已验证 ZIP 保留作下一次更新的基线。由 DMG 首装且没有旧 ZIP 时，先用全量下载建立基线。已发布的 1.3.2 客户端仍用原有全量更新流程，增量能力随新版客户端生效。

在 `macos/` 执行 `pnpm package:installer --delta-from=/绝对路径/旧版发行目录` 生成增量计划。该目录包含旧版原始 ZIP 和 `latest-mac.yml`，打包器使用已有固定公钥认证旧包。`node test/scripts/updates-differential-smoke.mjs` 验证真实 Electron 回环传输、两渠道选择、全量回退和取消。用 `--base=/绝对路径/旧版.zip --target=/绝对路径/新版.zip` 可核对实际归档的传输量和组装摘要。

## 历史发行

0.5.9、0.5.10和0.5.11的当时验包与发行证据分别保存在对应交接/验证记录中，不作为当前下载或系统要求。2026-10-27 Windows任务已将旧应用发行转为可恢复草稿，模型资源保持公开；不得为恢复Mac下载而自行公开旧版。当前版本沿用原代码签名、凭据助手与Ed25519身份。

### 0.5.9历史验包（当时macOS26.0）

以下为2026-10-24的当时记录；其中公开下载、Latest与AppKit表述只按历史理解，不是当前状态。

正式三项保留在 `macos/release/0.5.9`，使用既有固定签名与Ed25519。最终ZIP的ASAR运行时新增实测：`node test/scripts/package-runtimes-smoke.mjs`以无登录Copilot ping、断网Codex空账户RPC确认两个固定进程均可启动；曾复现并修复Copilot SDK对虚拟ASAR路径chmod失败，现通过官方stdio连接指定真实unpacked路径。没有修改供应商SDK、版本、模型或账户边界。

`package-smoke.mjs --install-archive`已通过最终归档/元数据签名、SHA512、固定凭据助手、arm64/macOS26.0、DMG同一签名应用/Retina布局、实际AppKit/40px输入、临时薄包下载与离线E5/ASR，并在临时旧版副本让Sparkle校验生产ZIP后取消。2026-10-24 16:58 UTC正式发布v0.5.9，之后`--online`通过：实际安装版适配器选中公开0.5.9、认证清单、下载完整586,515,108字节ZIP并校验SHA512；未替换真实安装。GitHub资产大小/SHA256与本地一致，原16个发行及其资产、Latest v0.5.8保持。Windows逐项待办与任务见[0.5.9交接](../../shared/docs/WINDOWS_0.5.9_HANDOFF.md)及[Codex prompt](../../shared/docs/WINDOWS_0.5.9_CODEX_PROMPT.md)。

最终三项：DMG 631,051,074字节（SHA256 `e771b873e7e6437378f5f91dbd2495562174aa84fa8b70f831ba7375904d6713`）；ZIP 586,515,108字节（`9f1207b9458d88ef715e195b5cea9df1090a952c9ad4614e69efd72d1607c397`）；清单490字节（`dadc15153a5ce5a7703b0d6a315763aa15bf9761404ae7ec51eda33595fa5984`）。这些是正式发行资产元数据，不是测试报告/真实资料。

## DMG 窗口与本地预览

0.2.2 起的 DMG 使用 600×400 浅色品牌背景、左右排列的 VoxCue/Applications 图标、主题色箭头及简短安装说明，背景含普通和 Retina 两种分辨率。布局写入镜像内 `.DS_Store`，不修改用户 Finder 全局偏好；图标仍是真实可拖拽文件和 Applications 链接。

`scripts/dmg-layout.json` 是背景和图标坐标的唯一配置，`native/DmgArtwork.mm` 用 AppKit 离屏绘图。构建端使用 Command Line Tools 的 Python 3（3.7+）及两份固定 SHA-256 的 MIT 纯 Python wheel（[ds_store](https://github.com/dmgbuild/ds_store)、[mac_alias](https://github.com/dmgbuild/mac_alias)）；仅缓存在 `macos/.cache/dmg-tools` 并直接 zip 导入，不用 pip、不全局安装、不进入应用，最终用户无需开发工具。

在 macos/ 执行 `node test/scripts/dmg-smoke.mjs`，仅用自有系统临时目录核对压缩镜像内布局、拖拽目标和签名副本，结束卸载并清理。加 `--preview` 时通过内存输出共用素材与坐标的内容预览；它不是 Finder 截图，系统标题栏、选中态等仍由 Finder 渲染。该入口不读取发行私钥，不生成正式 release，也不上传。

## 本地发行

代码签名必须复用`macos/.tools/development-signing/`内的固定私密身份，并匹配`macos/local-signing-public.json`公开指纹；该目录不进入Git、安装包或上传。请自行安全备份，缺失时恢复，禁止重新生成证书代替旧身份。开发和正式构建共用证书，各自bundle ID、应用名、登录密文与Safe Storage项保持；仅保护已发行 `credential-helper-v1` 的旧正式恢复副本与现用 `credential-helper-v11` 规范副本，不保留候选构建／测试入口。生产只认证复制 v11，缺失或错配不得重建、重签或轮换；首次迁移旧授权可能需要一次系统确认。凭据规范见 [CREDENTIALS.md](CREDENTIALS.md)。

所有依赖、工具、缓存均在 `macos/`，禁止全局安装。先在当前平台按仓库入口同步配置和安装依赖；安装包不嵌入模型，独立模型资源保持原发行。执行：

```sh
# 在 macos/ 内，使用本工作区的 corepack/pnpm 环境
corepack pnpm check:architecture
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm build:updater
corepack pnpm test:updates
corepack pnpm package:installer
corepack pnpm test:package
```

发行打包必须已有 `macos/.tools/update-signing/ed25519.key`（0600）与公开 `macos/update-public-key.json`，不在打包时创建密钥。**保管并自行备份该私钥；每次更新必须使用同一私钥。** 私钥不提交 Git、不上传 GitHub、不进入应用。缺失/错配私钥时打包失败，禁止自动轮换。公钥需随源码保留，安装包 Info.plist 与运行配置均固定该公钥。

签名材料检查 owner、0700／0600、普通节点、单链接与真实路径。持有人可用 `node scripts/update-key-backup.mjs --backup=/绝对私有离线路径` 创建 scrypt＋AES-GCM 加密更新身份备份，或以 `--verify=/绝对备份路径` 交互认证同一公钥；口令只在本机隐藏输入，不进入参数、环境或输出。工具拒绝覆盖与身份不符，备份不轮换密钥，验证不读取现用私钥。

`macos/release/<版本>/` 包含以下发行资产。

- `VoxCue-<版本>-arm64.dmg`：首次安装。
- `VoxCue-<版本>-arm64.zip`：完整应用更新包。
- `VoxCue-<版本>-arm64.zip.delta.json` 在指定已验证旧包时生成，供新版下载器复用旧 ZIP。
- `latest-mac.yml` 包含版本、文件名、大小、SHA512、归档签名及可选的增量签名。

当前更新与组件下载仓库为公开 NCFXZ/VoxCue。按用户当次授权向指定正式 Release 追加本平台资产，保留已发布的 Windows 和旧版本资产。先上传 DMG、ZIP 和已有的增量计划，再上传 `latest-mac.yml`。按[下载渠道](../../shared/docs/DOWNLOAD_CHANNELS.md)同步 CNB。两个平台按各自完整资产的最高正式数字版本选版。发行与源码推送按当前用户授权执行。打包脚本拒绝覆盖现有发行目录。

## 信任与隔离

共享 Provider 只访问固定公开 NCFXZ/VoxCue 仓库、无令牌。打包的 voxcue-update.json 与运行时校验共用 releaseRepository，保持来源一致；模型和已有签名发行可按原字节复制到新仓，清单签名不绑定仓库地址。已安装旧包仍使用其原更新地址，旧仓保持，后续升级过渡按发行范围执行。Mac 清单签名认证 `voxcue-macos-update-v1`、版本、文件名、大小、SHA512、归档签名和最低系统版本的 JSON 数组；下载流有大小和时间限制，安装前重新核对文件。只有显式安装才创建短期随机 token 的 127.0.0.1 feed；Sparkle 再验归档签名并负责替换、重启，失败保留原应用。HTTPS/TLS 和 Gatekeeper 不做全局变更。

共享 `test:updates` 覆盖界面、IPC、面试限制与保存握手，其外部更新器是夹具，不能单独作为原生安装证明。独立合成原生更新专项使用临时密钥和旧／新测试应用，不使用真实资料或发行私钥；`CFFIXED_USER_HOME` 不能保证 Sparkle／Launch Services／cfprefsd 的全部偏好都写入临时目录，严格隔离任务应放在可丢弃 guest 内执行。

`test:package` 统一通过 [guest runner](TEST_GUEST.md) 验证最终 ZIP 的固定公钥、Ed25519、签名元数据和 SHA512，以及 DMG 内同一签名应用、布局、资源和凭据助手原字节。认证的公开组件只读复制到来宾临时 profile，再断网复用。实际正式产品正常启动／退出、独立开发宿主内的最终 ASAR 检查、1.1.1／1.2.2 资料覆盖升级与 Sparkle 认证各有不同证明范围，按该入口执行，不能改写旧包或最终产品开启调试。`--online` 产品探针已退役；发布后使用无产品启动的匿名资产与清单回读。
