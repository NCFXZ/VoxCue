# Mac 安装与免费自动更新

当前源码面向 Apple Silicon arm64、macOS 14.2及以上，使用共用网页控件、SF Symbols和原生侧栏材质，不再要求Liquid Glass。固定Codex0.164.0、Copilot SDK/平台运行时1.0.21；模型与ONNX Web不内嵌，最终用户无需另装Node/Python。首次下载DMG后将VoxCue拖入Applications。应用按本平台最高完整正式资产选择更新，不依赖统一Latest；面试期间禁止安装，重启前等待保存成功，普通退出不触发安装。0.6.0本轮Mac验收及资产状态见[Mac验证记录](../../shared/docs/MACOS_0.6.0_VERIFICATION.md)。

采用 [Sparkle](https://sparkle-project.org/documentation/) 2.10.0 的免费 Ed25519 更新签名。已发布至0.3.1的应用使用ad-hoc代码签名；2026-10-19起的源码打包流程改为复用固定本地自签名证书；0.5.5 再增加独立固定签名凭据助手，保留其代码哈希，修复仅固定应用证书仍反复要求钥匙串授权的问题。首次导入历史密码仍可能需要一次系统授权，详见[凭据与版本升级](CREDENTIALS.md)。未购买Developer ID，也未经过Apple公证。首次打开时macOS仍可能阻止运行，需用户在“系统设置 → 隐私与安全性”明确允许该应用；更新不会替用户关闭系统安全检查或移除隔离属性。现有发行资产没有自动重建。

更新选项位于“设置 → 关于与更新”，自动下载默认开启并保存在本机；关闭后仅检查和提醒。侧栏使用共用36px圆形操作，展开时悬停/键盘聚焦以中性胶囊显示下载、取消或重启，收起侧栏保持图标。首秒取消保护、主题色进度环、保存确认和面试禁装保持；Mac加载使用SF Symbols静态遮罩与12段扫亮。关闭设置不停止进度刷新，关闭自动下载不取消已开始的下载；只有明确安装且保存成功后才进入Sparkle。

## 历史发行

0.5.9、0.5.10和0.5.11的当时验包与发行证据分别保存在对应交接/验证记录中，不作为当前下载或系统要求。2026-10-27 Windows任务已将旧应用发行转为可恢复草稿，模型资源保持公开；不得为恢复Mac下载而自行公开旧版。当前0.6.0沿用原代码签名、凭据助手与Ed25519身份。

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

代码签名必须复用`macos/.tools/development-signing/`内的固定私密身份，并匹配`macos/local-signing-public.json`公开指纹；该目录不进入Git、安装包或上传。请自行安全备份，缺失时恢复，禁止重新生成证书代替旧身份。开发和正式构建共用证书，各自bundle ID、应用名、登录密文与Safe Storage项保持；固定凭据助手的规范副本 `macos/.tools/credential-helper-v1` 同样必须保留，不能当作普通缓存删除；首次迁移旧授权可能需要一次系统确认。保管与隔离回归入口见[固定本地签名与登录保留](MACOS_PORT.md#固定本地签名与登录保留)。

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

发行仅包含 `macos/release/<版本>/` 内三项：

- `VoxCue-<版本>-arm64.dmg`：首次安装。
- `VoxCue-<版本>-arm64.zip`：完整应用更新包。
- `latest-mac.yml`：版本、文件名/大小、SHA512、归档 Ed25519 签名与清单签名。

按用户当次授权向公开 NCFXZ/VoxCue-releases 的指定正式 Release 追加本平台三项；只有明确需要时新建发行，已有 Windows 和旧版本资产不覆盖。先上传 DMG、ZIP，最后上传 latest-mac.yml，核对齐全后发布。本轮用户已授权补齐既有v0.6.2的Mac三项及推送审计后的客户端源码，沿用操作前核对的Latest状态。两个平台按对应完整资产的最高正式数字版本选版，不依赖统一 Latest；失败明确报错。发布需要每次用户授权，不自动推送私有源码。打包脚本拒绝覆盖现有发行目录。

## 信任与隔离

共享 Provider 只访问固定公开仓库、无令牌。Mac 清单签名认证 `voxcue-macos-update-v1`、版本、文件名、大小、SHA512、归档签名和最低系统版本的 JSON 数组；下载流有大小和时间限制，安装前重新核对文件。只有显式安装才创建短期随机 token 的 127.0.0.1 feed；Sparkle 再验归档签名并负责替换、重启，失败保留原应用。HTTPS/TLS 和 Gatekeeper 不做全局变更。

`test:updates:native` 使用独立临时密钥和旧/新应用，包含签名拒绝、取消与真实替换/重启，不使用真实资料或发行私钥。但 CFFIXED_USER_HOME 不能保证 Sparkle/Launch Services/cfprefsd 的全部偏好写入都留在临时目录；入口会清理专用测试域，严格“必要文件仅系统临时目录”的任务仍须排除它。共享 `test:updates` 覆盖界面、IPC、面试限制与保存握手；其外部更新器是夹具，不能单独作为原生安装证明。

`test:package` 使用现有固定公钥直接验证最终 ZIP 的 Ed25519 签名、签名元数据与 SHA512，核对应用内公钥、版本及凭据助手的固定签名和原始字节。从最终 ZIP 解压实际应用，核对最终 DMG 的相同签名副本、安装布局和 Retina 背景，确认不嵌入模型或 ONNX Web，并包含固定 Copilot/Codex 及其本平台可执行文件。明确设置 `VOXCUE_TEST_COMPONENT_CACHE` 时只读校验正式模型后复制到临时profile，再断网复用，验证登录、原生绑定、ASR Worker/utilityProcess、PDF/DOCX与离线RAG；结束删除副本并复核源模型。未设置时保留原固定公开下载分支，正式目录不得直接作为隔离Electron的组件根。最终包另启动合成主账号窗口，核对原生红绿灯、系统侧栏、共用控件、40px输入框、合成发送与胶囊标记；不恢复Liquid Glass/AppKit内容控件，Windows本机另验。`--install-archive` 将临时副本的宿主版本降为 0.2.0，让 Sparkle 准备生产 ZIP 后取消，不替换真实安装；仍可能涉及临时目录外的原生偏好，严格限定全部原生写入仅临时目录的任务须排除该选项。发布后 `--online` 用实际安装版适配器认证 GitHub 发行与清单，并下载完整 ZIP 核对 SHA512；只在该临时测试进程把版本读取模拟为旧版，不触发原生安装或发布测试版本。
