# VoxCue 1.1.1 Windows 发行索引

更新日期：2026-11-10。本文记录产品来源、发行资产与渠道状态，不保存测试成绩。本轮用户授权清理、完整回归、修复、私有源码及公开安装包发布；不包含 Microsoft Store 更新。

## 版本与来源

- 版本唯一来源 shared/package.json 为 1.1.1；根和 Windows 生成配置同步，Mac 全树保持只读。
- 接续输入为 `5f67815ab8b6eb657b189848f732377805f60a43`；Windows 包内产品输入为 `aa1b9dfdde712749413dff376729344bc3af14d5`。后续验证维护与发行元数据提交不改变该包内产品代码。
- 私有源码位于 [NCFXZ/VoxCue](https://github.com/NCFXZ/VoxCue)，开发及发行直接使用 main；核对提交包含关系后移除额外发行分支。公开二进制仓库为 NCFXZ/VoxCue-releases，不上传私有源码到二进制仓库。
- 已有 v1.1.0 与 v1.1.1 源码标签保持；v1.1.1 继续指向 Mac 产品输入 `e0a2a874bffbc37d5af57554074ade6fb7a8f446`，Windows 输入由本索引的提交明确标识。
- 净变化与逐项步骤见 [Windows 更新交接](WINDOWS_1.1.1_HANDOFF.md)，中英公开文案见 [发行说明](RELEASE_1.1.1.md)，原 Mac 资产来源见 [Mac 发行索引](MACOS_1.1.1_RELEASE.md)。

## Windows 变化

- 快捷键帮助随已确认的窗口、面板及音频状态显示当前动作；按语言保留最长动作宽度，设备远程行随批准连接展开或收起。
- Windows 帮助定位复用既有原生 DPI 校正适配器，保持 360 DIP 画布；Ctrl+Shift 字符、自定义组合规则和既有 Windows 布局策略保持。
- 删除确认与资料选择共用勾选动画、键盘反馈及辅助功能降级，危险确认使用红色；删除图标位于标题前。额度按五小时、每周非变异排序。
- 完善帮助只读状态、rendererRevision 和退出窗口生命周期。局域网配对、仅转录和自定义快捷键已在 Windows 1.1.0 中提供，不重复计为本版新增。

## GitHub 资产

Windows 三项资产已在本地 `windows/release/1.1.1/` 按原字节归档，准备加入既有 [v1.1.1](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.1.1)，保留其 Latest 状态及三项 Mac 资产。尚未上传 Windows 资产。

| 资产 | 字节 | SHA256 |
| --- | --- | --- |
| `VoxCue-Setup-1.1.1-x64.exe` | 407759738 | `cb84c1f7b22f5e613a1401dc38e201817d78dac0b214721b8fbb7d6f09998bfd` |
| `VoxCue-Setup-1.1.1-x64.exe.blockmap` | 422288 | `cbc6dd9d3312ef8d856f51aebe1e20dbfc43c1d15f6e6735e6aee660880bc534` |
| `latest.yml` | 349 | `446168c8df6cad4fd24758b4c29d480985c7df6aed3715d4750f934819d3c19c` |

更新元数据中 EXE 的 SHA512 为 `lM40DxqWQHO9MQBWFKc8m4z1ZZnKyhStvNjHBQyo3HgtHDwZGfYDPqDsf3Su2DrHRavF7u0F61Jf0JDOAeBH/w==`。Windows 1.1.0、其他历史正式和恢复资产保持。

## 验证入口与边界

- 类型／公开契约、架构／工作区、未使用声明、单测、共享构建与依赖审计沿用现有入口，不升级依赖或模型。
- windows-suite 的共享、原生及五档 DPI 调度保留严格断言与原时限；原生登录按 DPI 子任务调度。interview-shortcuts --native-hit 只向自有底层窗口与帮助关闭按钮发送真实 Win32 输入。
- portable-native-smoke --installer-stage 检查最终 ASAR、实际 SDK 子进程、LAN 服务／移动资源闭包和私有路径拒绝；package-upgrade-data 另校验真实 1.1.0 EXE 固定摘要，以同一临时安装路径／profile 核对原件、元数据、资料、设置、记录、截图和旧索引及重复启动。
- installer-upgrade 的合成应用与 installer-engine 的独立 GUID 分别覆盖 NSIS 升级及安装引擎，不将其等同于真实旧资料兼容；installer-ui-smoke 另检查最终包中的资料选择、聊天进度、安全对抗和更新界面。
- GUI、原生及推理仅在 owner 登录解锁的控制台串行执行；锁定或未知状态停止。自有进程亮屏请求结束后释放，不改变系统锁屏或辅助功能设置。
- 仅合成账户／资料／图片、文件 TTS 和固定来源／摘要的公共模型与音频，不访问真实账户或凭据，不采样物理音频或宿主屏幕。固定模型对极短语气词不保证逐字识别，空输出或误识别不视为过滤通过；Windows 结果不代替 Mac、真人语音或手机硬件验收。
- 固定 0.5.3 服务端参考 `3bceb615dbba900f669322c301fc4b5b473dfb15` 仅在 owner 系统临时目录使用，现有服务端保持原样。设备连接使用 HTTP＋WS，仅适用于可信私人局域网／热点及电脑审批认证。
- 临时 profile、数据库、图像和安装副本在最后消费者结束后按真实路径、归属与占用清理；正式归档、原件、凭据、现用依赖、认证公共缓存和历史明确跳过目录保留。
