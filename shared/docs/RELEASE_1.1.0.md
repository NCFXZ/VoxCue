# VoxCue 1.1.0 · Windows

## 简体中文

- 新增局域网设备连接。另一台设备扫码后，在电脑上核对配对码并允许连接，即可通过浏览器查看实时转录与问答、输入问题、控制电脑麦克风和自动回答，无需安装设备端应用。
- 设备页面随 VoxCue 打包，由电脑提供；支持转录显隐、左右气泡、LaTeX 公式、发送与停止回答、断线重连。两端共享输入草稿，以电脑当前版本为准。
- 新增“仅转录”面试方式，只使用麦克风；可在面试中切换输入方式。麦克风和系统音频支持独立开关，保持当前回答和已连接的识别服务。
- 新增快捷键设置，可实时查看录入的组合键、修改或清空绑定、恢复默认；冲突或不可用时给出提示，单项冲突不再阻止开始面试。
- 改进语音静音断句、输入切换和迟到结果处理，保留既有自动回答的音频进度保护。
- 修复多显示器下截图可能选错屏幕的问题。
- 优化 Windows 面试面板的显示、设置、拖动与缩放，减少位置抽动；统一状态胶囊、输入控件、开场摘要和中英文排版，改善记录返回位置及组件下载的取消操作。

设备连接使用 HTTP/WS，仅在可信的私人局域网或热点下使用；传输不加密，不提供公网远程访问。

首次安装或手动升级 Windows，请运行 `VoxCue-Setup-1.1.0-x64.exe`。`.blockmap` 与 `latest.yml` 用于独立安装版的应用内更新，无需手动运行。商店安装版通过 Microsoft Store 更新。

本次提供 Windows x64 1.1.0；macOS 用户继续使用 [完整 1.0.2 发行版](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.0.2)。Mac 1.1.0 的原生适配、验证与打包由 Mac 本机接续。

## English

- Added LAN device connections. Scan the QR code, compare the pairing codes and approve the connection on your computer. The other device can then use its browser to view live transcripts and answers, type questions, and control the computer's microphone and automatic answers, without installing a companion app.
- The device page is bundled with VoxCue and served by your computer. It supports transcript visibility, conversation bubbles, LaTeX formulas, sending and stopping answers, and reconnection. Both devices share a draft, with the computer's current version taking precedence.
- Added a microphone-only transcription mode, with input modes changeable during an interview. Microphone and system audio have independent controls that preserve the current answer and recognition connection.
- Added editable shortcuts with live key previews, clear/reset controls, and conflict or availability errors. An unavailable shortcut no longer prevents an interview from starting.
- Improved silence segmentation, audio input switching and stale-result handling while retaining audio-progress safeguards for automatic answers.
- Fixed screenshots selecting the wrong monitor in mixed display layouts.
- Improved Windows interview panels, settings, dragging and resizing to reduce positional jumps. Refined status pills, input controls, interview summaries and Chinese/English layouts, with better history return positions and download cancellation.

Device connections use unencrypted HTTP/WS and are intended only for trusted private LANs or hotspots. Public remote access is not provided.

For a first Windows installation or a manual upgrade, run `VoxCue-Setup-1.1.0-x64.exe`. The `.blockmap` and `latest.yml` files support in-app updates for standalone installations and do not need to be run manually. Store installations update through Microsoft Store.

This release provides Windows x64 1.1.0. macOS users can continue using the [complete 1.0.2 release](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.0.2). Native adaptation, validation and packaging for Mac 1.1.0 will be completed on a Mac.
