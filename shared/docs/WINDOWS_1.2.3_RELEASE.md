# VoxCue 1.2.3 Windows

本版补齐 Windows 音频自动恢复与系统网络能力，并修复知识库云恢复及英文提示。发行文案按 Windows `1.2.0 → 1.2.3` 的累计变化编写。应用、“关于”、服务器上报、安装器和自动更新版本统一为 `1.2.3`，Microsoft Store 包身份版本为 `2.2.3.0`。macOS 保持既有 `1.2.2`，本轮不构建或修改 Mac 专属目录。

## 用户可见变化

- 面试语音输入中断后自动尝试重连，并显示恢复状态。
- 启动时恢复上次成功连接的 ChatGPT 或 GitHub Copilot，侧栏与设置页使用一致的剩余额度显示。
- 回答生成时即可查看网页来源。
- 云账号与云同步遵循系统代理和证书信任设置。
- 修复刷新时个人资料暂时空白，以及聊天恢复期间覆盖资料编辑的问题。
- 修复取消登录后的重连阻塞、音频恢复提示中英混排，以及不完整尾段被误报为正常结束的问题。
- 修复云端下载知识库时，正在查看的文档列表跳回顶部的问题。

其中登录恢复、网页来源和资料恢复来自 Windows 1.2.2 基线。原 Windows 1.2.2 GitHub 资产已经撤回，其正式安装器仍作为已安装用户的升级与恢复原件保留。

## 音频恢复边界

Windows 适配器启用共享 `SpeechController` 已有的自动重连流程。运行中发生可恢复故障时，先等待 WASAPI 采集进程实际关闭并排空管道，再退休识别 Worker；之后按 1、2、4 秒退避，最多自动尝试三次。停止、暂停、切换与退出会取消旧恢复任务；迟到事件不得启动第二条采集或写回新会话。不完整片段显示间断提示，不自动作为完整问题提交。

Windows 对以下设备 HRESULT 明确允许恢复：`AUDCLNT_E_DEVICE_INVALIDATED`、`AUDCLNT_E_SERVICE_NOT_RUNNING`、`AUDCLNT_E_RESOURCES_INVALIDATED` 和默认端点暂时消失的 `E_NOTFOUND`。本机助手对默认设备变化和断连提供明确的设备失效代码。识别 Worker 或正在运行的采集进程意外退出也可进入有界恢复。

双路同时失联时，只在内部可恢复故障的清理阶段接纳第二路迟到的白名单 HRESULT；两路真实关闭后才能继续恢复。此意图不进入公开 IPC，手动停止不放宽验证。晚到的权限、未知或损坏诊断仍阻止重连，并显示实际阻止恢复的设备原因；强制终止或未确认退出继续归为服务错误。

权限拒绝、未知错误码、损坏数据、非法控制回复、运行中意外收到 `stopped`，以及无法确认旧进程退出，均保留明确错误，不按设备失联自动重试。判断进程退出前会消费最后的 stderr，避免把权限错误误判为可恢复断连。正常停止时检测尚未收齐的 PCM 包，尾段不完整不能返回成功。

英文界面使用完整的设备与恢复提示译文，保留 HRESULT。用户自定义设备名称按原文显示。

## 系统网络

Windows 通过现有 `DesktopPlatform.accountFetch` 端口接入 [Electron 系统网络](https://www.electronjs.org/docs/latest/api/net)，云账号、云同步和同源遥测使用同一适配器。请求强制不附带浏览器 cookies、不使用缓存、不发送来源引用，并拒绝重定向；显式登录身份、请求体和取消信号继续由共享客户端管理。TLS 校验失败明确报错，不回退到绕过系统信任的请求路径。

独立网络专项使用空白 Electron profile、自有回环代理与 HTTP/TLS 服务。仅设置该临时 Electron 会话的代理，不修改系统代理或安装证书；不受信的临时自签证书必须被拒绝。该验证不能代称已在真实企业 PAC 或私有受信根环境验收。

## 知识库下载与阅读

云端知识库或文件每次落盘都会通知界面刷新。原实现重新打开当前库时先清空文档，滚动区域高度缩短，导致正在阅读的位置回到顶部；下载其他库也会触发该路径。同库后台刷新现在保留现有文档行和错误，读取完成后再更新列表。读取请求版本与选择版本分别管理，后台刷新不会使当前库的导入、删除和重命名失去归属，换库或关闭仍隔离迟到结果。

云恢复直接返回已提交原件的本地修订，下载索引与修复扫描据此合并同一文档。扫描在读取 IndexedDB 或等待前一组后重新核对后端索引；提交确认会使此前开始的状态读取过期，防止重复搬运原件字节和重复提交 IPC。既有后端摘要快路保留，不把该问题描述为必然重复向量推理，也不通过永久缓存成功状态阻止丢失或失效索引的修复。

回归沿用真实 renderer store、IndexedDB 和隔离云 IPC，以同库和另一库的分块下载完成触发刷新，核对原文档行、可视位置及最终索引。该修复位于共享源码，现有 Mac 1.2.2 安装包不会被本轮 Windows 发布改变；Mac 下次构建须本机复测。

## 版本与升级

既有 1.2.2 客户端只接受三段稳定版本；四段 `1.2.2.1` 不合法，`+build` 不参与版本高低比较。因此本版使用正常的 `1.2.3`，安装器文件名、更新清单、签名元数据和安装后的应用版本保持一致。

保留原 Ed25519 更新身份、NSIS 注册身份、`NCFX.VoxCue` Store 身份、发布者和产品 ID `9PBBVWZXMBPW`。独立安装器的自动更新继续匿名读取公开的 `NCFXZ/VoxCue`；兼容发行仓库为 `NCFXZ/VoxCue-releases`。不得重建或轮换签名身份，也不以修改旧包、跳过校验或使用令牌作为升级兼容办法。

## 本机验证入口

先运行工作区、架构、类型、完整单测和构建检查，再在已登录且解锁的当前 Windows 控制台串行执行：

- `node ../shared/test/scripts/functional-suite.mjs --jobs=1`：完整功能、英文与视觉、安全与对抗、20 轮面试和 600 秒固定公开音频长稳。
- `node test/scripts/windows-suite.mjs --windows`：Windows 原生与生命周期专项。
- `node test/scripts/windows-suite.mjs --dpi`：1、1.25、1.5、1.75、2 倍的界面回归。
- `node ../shared/test/scripts/interview-usage-offline.mjs --full`：限制外部网络的完整离线回归。

最终产物须通过便携包、NSIS、APPX、签名与摘要专项，以及独立 Windows Sandbox 验证。升级入口为：

- `node test/scripts/store-sandbox-smoke.mjs --nsis-current`：当前 NSIS 新装。
- `node test/scripts/store-sandbox-smoke.mjs --nsis-upgrade`：原版正式 1.2.2 到 1.2.3。
- `node test/scripts/store-sandbox-smoke.mjs --nsis-upgrade-1.2.0`：原版正式 1.2.0 到 1.2.3。
- `node test/scripts/store-sandbox-smoke.mjs --nsis-upgrade-1.1.1`：原版正式 1.1.1 到 1.2.3。
- `node test/scripts/store-sandbox-smoke.mjs`：当前 Store APPX 的独立来宾验收。
- `node test/scripts/store-sandbox-smoke.mjs --appx-upgrade`：同一来宾用户下，从 Store 2.2.2.0 原地升级到 2.2.3.0，保留真实包家族、LocalCache 与用户资料。

1.2.2 升级使用新建禁网来宾的正常签名元数据缓存，让原版客户端在实际界面报告可更新为 1.2.3，再正常退出并沿原注册路径升级。新客户端读取同份元数据应为空闲。更新发现与 NSIS 安装过程分别核验；安装前后比对合成资料、设置、历史记录、原件摘要和真实知识库索引。不得把开发态夹具代称为正式安装升级。

Store 原地升级对新旧正式 APPX 原件分别校验完整摘要，只在来宾内签署两份测试副本。旧版写入合成资料后自然退出，新版使用相同用户及包家族直接安装，不卸载或重置，再核对版本、真实进程身份、LocalCache、资料、记录和偏好。侧载验收不代替微软商店的正式签发及分发核验。

集成测试只读使用固定服务端参考 `0.5.3 / 3bceb615dbba900f669322c301fc4b5b473dfb15`，不修改服务端或运行其后台测试。模型和音频使用现有固定公开来源与摘要，资料仅为自有临时合成数据；测试结果不写入仓库。

## 发行范围与限制

正式原件保存在 `windows/release/1.2.3`，独立安装器沿用原有 Ed25519 更新签名身份；EXE 未增加 Authenticode 签名。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| VoxCue-Setup-1.2.3-x64.exe | 408860709 | `94482f145a44f2f2dbfc55cfe548c1675379f7a314a0326a551b9fd17b76be87` |
| VoxCue-Setup-1.2.3-x64.exe.blockmap | 423757 | `0285a53fb8b0c0ef051fa53f046a504b7464141a67f079e5deecc020ef7d5153` |
| latest.yml | 482 | `09e77850b65bd32bde4de8616a49dacf94f33fec744cef46073b78c83f017521` |
| VoxCue-Store-1.2.3-x64.appx | 601719599 | `6d6fc9ae57aff3db3d66e317eb4444ddedbf9ecccf5fa60d2be270bea28d8fe4` |

Windows `v1.2.3` 已发布并设为两个仓库的 Latest：[VoxCue](https://github.com/NCFXZ/VoxCue/releases/tag/v1.2.3) · [VoxCue-releases](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.3)。源码标签指向 `fae85ca665505b314fee784a0dddc091f337ffd5`。公开更新源已匿名回读完整安装器、blockmap、清单及签名，Mac 仍选择 1.2.2，原资产与标签保留。Microsoft Store 目标为 `2.2.3.0`，提交、认证与实际上线状态分别记录在 [当前进度](../../PROGRESS.md)，不以本地侧载代称微软正式分发。

固定 Paraformer 对极短的“嗯／啊／呃”和“然后呢”可能漏识别或误识别，沿用 [1.2.2 已知限制](WINDOWS_1.2.2_RELEASE.md#已知识别限制)。空识别不计作准确率或过滤成功。合成音频和管道生命周期验证不代表物理设备拔插、真实用户语音或真实订阅账号授权均已验证。

Mac 另有本平台的 ChatGPT 系统凭据预检。Windows 通过固定官方运行时的本机反馈处理明确拒绝、不可用和取消；运行时完全无响应时仍报告错误并允许之后重试，不声称系统授权窗口在两端完全一致。
