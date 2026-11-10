# VoxCue 1.1.1 · macOS

## 简体中文

- Mac 同步局域网设备连接：扫码、核对配对码并在电脑允许后，可用另一台设备的浏览器查看实时转录与问答、共享问题草稿、控制麦克风与自动回答。支持断线恢复，设备端无需安装应用。
- 新增“仅转录”面试方式及独立的麦克风／系统音频开关，保留现有回答与识别连接；改进静音断句、输入切换和迟到结果处理。
- 快捷键设置支持实时预览、清空、恢复默认和冲突提示。Mac 使用原生符号，默认组合为 ⌃⇧，支持包含 ⌘ 的自定义组合，修复 Command 录入丢失和菜单抢键。整窗隐藏时仍可使用面试快捷键与截图。
- 快捷键帮助按当前状态显示可执行动作，设置文案统一为“显示或隐藏窗口”“展开或收起面板”。浮窗保持在面试窗口前，中文与英文分别按最长动作文案预留紧凑宽度，切换状态时宽度稳定；设备连接／断开时平滑展开／收起远程快捷键。
- 修复转写面板显隐时整窗闪烁，以及结束面试时帮助窗向已销毁页面发送通知的问题。
- 删除确认与资料选择采用统一勾选动画、彩色勾和半透明外圈，危险确认使用红色；删除图标移到标题前。账户额度按五小时、每周排列。
- 同步中英文界面、开场摘要、状态胶囊和记录阅读位置等改进；修复多显示器截图选屏，并补齐安装包内的设备页面和服务依赖。

设备连接使用未加密的 HTTP/WS，仅适用于可信的私人局域网或热点，不提供公网远程访问。

首次安装或手动升级，请打开 `VoxCue-1.1.1-arm64.dmg` 并将 VoxCue 拖入“应用程序”。适用于 Apple Silicon 和 macOS 14.2 及以上。`VoxCue-1.1.1-arm64.zip` 与 `latest-mac.yml` 用于签名校验的应用内更新，无需手动运行。沿用既有本地签名身份，未使用 Apple Developer ID 或公证。

本次为 Mac 发行。Windows 用户继续使用 [Windows 1.1.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.1.0)；该版本的安装包和更新资产保持。

## English

- Added LAN device connections on Mac. Scan the QR code, compare pairing codes and approve the connection on your computer. Another device can then use its browser to view live transcripts and Q&A, share question drafts, and control the microphone and automatic answers. Reconnection is supported, with no companion app required.
- Added Transcription only mode and independent microphone/system audio controls that retain the current answer and recognition connection. Improved silence segmentation, input switching and stale-result handling.
- Shortcut settings include live previews, clear/reset controls and conflict feedback. Mac uses native symbols, defaults to ⌃⇧ and supports custom combinations containing ⌘. Fixed missing Command input and menus intercepting shortcut recording. Interview shortcuts and screenshots also work while the window is fully hidden.
- Shortcut help shows the action available in the current state. The compact help stays above the interview window, reserves the longest action label separately for each language and keeps its width stable when state changes. Device shortcuts expand and collapse smoothly as a device connects or disconnects.
- Fixed interview-window flicker when toggling transcripts and an error caused by shortcut help notifying a destroyed page when ending an interview.
- Unified account-deletion and profile-selection checkbox animations with colored marks and translucent outlines; destructive confirmation uses red, with its icon before the title. Five-hour quotas appear before weekly quotas.
- Refined Chinese/English layouts, interview summaries, status pills and saved reading positions. Fixed monitor selection for screenshots and included the complete device page and service dependencies in the Mac package.

Device connections use unencrypted HTTP/WS and are intended only for trusted private LANs or hotspots. Public remote access is not provided.

For a first installation or a manual upgrade, open `VoxCue-1.1.1-arm64.dmg` and drag VoxCue to Applications. Requires Apple Silicon and macOS 14.2 or later. `VoxCue-1.1.1-arm64.zip` and `latest-mac.yml` support signature-verified in-app updates and do not need to be run manually. The existing local signing identity is retained; this is not an Apple Developer ID or notarized build.

This is a Mac release. Windows users can continue using [Windows 1.1.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.1.0), whose installer and update assets are retained.
