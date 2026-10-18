# Mac 安装与免费自动更新

面向 Apple Silicon arm64、macOS 14.2+。首次下载 `VoxCue-<版本>-arm64.dmg`，将 VoxCue 拖入 Applications 后打开。已发布 v0.2.1 仍为包含语音/RAG/Copilot 的完整包。当前源码后续构建通过[独立组件](../../shared/docs/COMPONENTS.md)首次下载并复用资源缓存，包内排除模型和 ONNX Web，GitHub SDK 已移除；用户仍无需 Node、Python 或开发工具。安装版首次进入主窗口后检查并下载更新，在“设置 → 更新”点击“重启并更新”。面试期间禁止安装，重启前等待本地聊天保存成功；普通退出不启动更新安装。

采用 [Sparkle](https://sparkle-project.org/documentation/) 2.10.0 的免费 Ed25519 更新签名。应用使用 ad-hoc 代码签名，未购买 Developer ID，也未经过 Apple 公证。首次打开时 macOS 可能阻止运行，需用户在“系统设置 → 隐私与安全性”明确允许该应用；更新不会替用户关闭系统安全检查或移除隔离属性。

当前源码共用“设置 → 更新 → 自动下载更新”，默认开启并本机保存；关闭后仅检查和提醒。有更新时，ChatGPT 可用状态行右侧显示下载图标、主题色圆环或重启安装图标，取消仅显示红色关闭图标，全部状态保持 32×32 图标操作范围。侧栏不显示百分比或取消文字，设置内保留完整文字与百分比，点击使用现有更新流程。关闭设置后进度继续刷新，关闭自动下载不取消已开始的下载；只有明确点击安装且保存成功、无面试时才进入 Sparkle。原生签名与安装边界不变，已发布安装包不自动重写。

## 本地发行

所有依赖、工具、缓存均在 `macos/`，禁止全局安装。先在当前平台按仓库入口同步配置和安装依赖，模型放 `shared/local-models`。执行：

```sh
# 在 macos/ 内，使用本工作区的 corepack/pnpm 环境
corepack pnpm check:architecture
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm build:updater
corepack pnpm test:updates:native
corepack pnpm test:updates
corepack pnpm package:installer
corepack pnpm test:package --install-archive
```

首次打包创建 `macos/.tools/update-signing/ed25519.key`（0600）与公开 `macos/update-public-key.json`。**保管并自行备份该私钥；后续每次更新必须使用同一私钥。** 私钥不提交 Git、不上传 GitHub、不进入应用。已有公钥而缺失/错配私钥时打包失败，禁止自动轮换。公钥需随源码保留，安装包 Info.plist 与运行配置均固定该公钥。

发行仅包含 `macos/release/<版本>/` 内三项：

- `VoxCue-<版本>-arm64.dmg`：首次安装。
- `VoxCue-<版本>-arm64.zip`：完整应用更新包。
- `latest-mac.yml`：版本、文件名/大小、SHA512、归档 Ed25519 签名与清单签名。

向公开 NCFXZ/VoxCue-releases 新建正式 Release，三项上传完成后发布。保留旧 Windows 发行及其 Latest 过渡指针。两个平台按对应完整资产的最高正式数字版本选版，不依赖统一 Latest；失败明确报错。发布需要每次用户授权，不自动推送私有源码。打包脚本拒绝覆盖现有发行目录。

## 信任与隔离

共享 Provider 只访问固定公开仓库、无令牌。Mac 清单签名认证 `voxcue-macos-update-v1`、版本、文件名、大小、SHA512、归档签名和最低系统版本的 JSON 数组；下载流有大小和时间限制，安装前重新核对文件。只有显式安装才创建短期随机 token 的 127.0.0.1 feed；Sparkle 再验归档签名并负责替换、重启，失败保留原应用。HTTPS/TLS 和 Gatekeeper 不做全局变更。

`test:updates:native` 使用独立临时密钥和旧/新应用，包含签名拒绝、取消与真实替换/重启；Foundation 缓存通过本进程 CFFIXED_USER_HOME 隔离到临时目录，不改用户 HOME。测试只到终端，成功/失败/取消均清理，不使用真实资料或发行私钥。共享 `test:updates` 覆盖界面、IPC、面试限制与保存握手；其外部更新器是夹具，不能单独作为原生安装证明。

`test:package` 从最终 ZIP 解压实际应用，使用临时 profile 验证登录、原生绑定、ASR Worker/utilityProcess、PDF/DOCX 与离线 RAG。`--install-archive` 仅将临时副本的宿主版本降为 0.2.0，让 Sparkle 认证并准备生产 ZIP，再在提交替换前取消；发行文件不变。发布后 `--online` 用实际安装版适配器认证 GitHub 发行与清单，并下载完整 ZIP 核对 SHA512；只在该临时测试进程把版本读取模拟为旧版，不安装或发布测试版本。两种模式均不修改真实安装或用户资料。
