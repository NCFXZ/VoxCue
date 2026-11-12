# VoxCue 当前进度

更新日期：2026-11-12。长期规则见 AGENTS.md；测试结果仅在终端／对话中报告。

## 当前基线

- 使用 main。版本唯一来源 shared/package.json 为 1.2.1，根与 Mac 配置已同步；Windows 全树在本轮只读，生成清单待其本机同步。
- Mac 1.2.1 产品快照为 macos-v1.2.1／64f61050a7f37848a153e6ed90ab6ddd009d3778；[稳定发行](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.1)已上传 DMG、ZIP 与签名更新清单并设为 latest，仅含 Mac arm64 资产。后续交接文档提交不移动产品标签。
- 原 Mac 1.2.0 标签 macos-v1.2.0／10ac04b、共享／Windows v1.2.0／0bc1cd4 及原发行保留。Windows 更新会跳过不含完整本平台资产的 Mac-only 发行。

## 实现与接续

- 共享引擎仅在 VAD 接纳后建立新识别流，使用 500ms 有界历史，修复未接纳短音串句；共享恢复生命周期保留取消归属、真实退出围栏和不完整音频保护。仅 Mac adapter 启用有界自动重启，Windows 仍未启用。
- 修复恢复卡遮挡既有设备状态提示，补中英恢复交互；完整离线入口使用公开 Vitest CLI 定位并严格限制网络／IPC 例外。截图专项消费真实 Worker，保留取消、超时、退休与内存边界。
- Mac 修复 HAL 首选声道／输出流映射与初始化快照竞态；凭据使用冻结 v2，保持原密码／v10 兼容，收紧父身份及 ACL／partition。builder 缺身份即失败，不重编／重签冻结助手。更新密钥备份只读校验及权限／回滚边界见对应文档。
- 本轮清理、完整回归、问题修复、最终包隔离验收和资料导出原生 Save／Replace 工作已收拢。上一环节完整 VM／工具环境及本轮临时合成资料、截图、旧候选和上传工具已按归属／占用门禁清理，亮屏断言已释放。现用依赖、认证公开模型／音频、签名材料、原发行和恢复基线保留。
- 详细逐条变更及 Windows 验收要求见 [Windows 1.2.1 交接](shared/docs/WINDOWS_1.2.1_HANDOFF.md)；Mac 原理和边界见 [发行实现](shared/docs/MACOS_1.2.0_RELEASE.md)、[凭据说明](macos/docs/CREDENTIALS.md)。

## Windows 待办

- W001：本机 sync:workspace，同步 1.2.1 并核对 Store 映射，保持 Mac 全树只读。
- W002：Windows 打包器补 cancellable.js 单文件 ASAR 展开，验证最终物理依赖闭包。
- W003：安全适配离线 full 的 named-pipe 缺席探测，保留外部网络和未拥有端点拒绝。
- 按交接的 S／B 项及本机完整排程逐条验证共享改动、原生依赖、旧包资料、安装与更新，再按当轮授权交付 Windows 资产。W004 明确自动重启仍未启用，不单独打开开关冒充完成。

## 验证入口

- shared/test/scripts/functional-suite.mjs --jobs=1；interview-usage-offline.mjs --full；macos/test/scripts/ui-refinement-matrix.mjs。
- 原生专项：audio-conversion-smoke.mjs、audio-restart-smoke.mjs、qwen-regression.mjs、speech-preroll-smoke.mjs、interview-real-audio-smoke.mjs、credential-hardening-smoke.mjs、cloud-native-vault-smoke.mjs；设备／权限仅在隔离 guest 使用 audio-virtual-smoke.mjs。
- 最终 Mac 包使用 package-guest-smoke.mjs，需重新准备受控 SIP 基线；旧测试缓存路径已删除。owner 的 package-smoke.mjs --static-only 不启动产品，退出 2 表示未执行动态覆盖。
- 入口与平台边界见 shared/test/README.md；GUI／原生串行、解锁门禁，结果不入仓库。
