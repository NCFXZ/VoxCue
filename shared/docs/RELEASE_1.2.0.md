# VoxCue 1.2.0

## 中文

- 加固 Windows 更新认证：独立 Ed25519 签名覆盖版本与安装资产，下载、缓存恢复和安装前重新验证；收紧正式包运行环境、权限与内容安全策略。
- 提升语音、知识库、聊天和 Copilot 的稳定性：完善任务取消、错误后的停止、子进程输出边界及退出清理，避免旧任务迟到写回。
- 降低云同步和手机连接的重复处理开销；手机快照按处理回执发送，慢网同步和注销取消更可靠。旧手机页面请重新打开。
- 截图编码移入独立 Worker；补齐 Windows 原生依赖，完善安装位置检查、缺失安装目录修复和受控组件回收。
- 长消息支持左侧“显示更多／收起”和省略号；“仅转录”更名为“现场面试”，功能保持。调整显示滑块与开关比例，开始面试前显示远程连接和快捷键状态。
- 完善中英文文案和回归测试，清理重复样式及失效的测试入口。

本次为 Windows 发行。macOS 仍需按专属交接完成本机适配和测试；Mac 用户可继续使用[完整的 1.1.1 发行](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.1.1)，原资产保持。Windows 安装包仍未使用 Authenticode 发布者签名，系统可能继续显示 SmartScreen 提示；更新认证使用独立 Ed25519 身份。旧版本首次升级仍依赖旧版本原有的信任机制。

## English

- Hardened Windows update authentication with an independent Ed25519 signature covering the version and installer assets, verified during download, cache recovery and installation. Tightened packaged runtime settings, permissions and content security policy.
- Improved speech, knowledge search, chat and Copilot lifecycle handling, including cancellation, stopping after errors, bounded process output and shutdown cleanup. Late tasks cannot restore cancelled work.
- Reduced repeated work in cloud sync and phone connections. Phone snapshots wait for processing acknowledgements, and slow-network transfers and sign-out cancellation are more reliable. Reopen older phone pages.
- Moved screenshot encoding into a dedicated Worker, bundled required Windows native libraries, and improved installation path checks, missing-directory repair and controlled component cleanup.
- Added left-aligned long-message expansion controls and an ellipsis; renamed the interview mode to “In-person interview” without changing its behavior. Refined display sliders and switches, and added remote-connection and shortcut status to the start dialog.
- Improved Chinese and English wording and regression coverage, and removed duplicate styles and obsolete test entry points.

This is a Windows release. macOS adaptation and on-device validation remain in its separate handoff; Mac users can continue using the [complete 1.1.1 release](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.1.1), whose assets are preserved. The Windows installer does not have an Authenticode publisher signature, so SmartScreen prompts may remain. Updates use an independent Ed25519 identity. The first upgrade from an older client still follows that client's existing trust mechanism.

## Windows x64 SHA-256

`VoxCue-Setup-1.2.0-x64.exe`

```text
a83d1399fb2dae98cc4dfcf98924c6e571d6c17a461ca92a8292556bbcc610ae
```
