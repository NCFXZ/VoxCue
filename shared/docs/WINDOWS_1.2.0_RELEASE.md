# VoxCue 1.2.0 Windows 发行索引

本索引随 1.2.0 源码冻结交付；公开 GitHub 安装资产和 Microsoft Store 提交状态在实际操作后补充。测试成绩只在终端／对话中报告。

## 版本与来源

- 输入为 main `3160b6868c540ec7cc6d20cdca11bc10b19bdd0c`，应用 1.1.1。目标版本唯一来源为 `shared/package.json` 的 1.2.0，Windows Store 身份版本为 2.2.0.0。
- 源码仅上传私有 [NCFXZ/VoxCue](https://github.com/NCFXZ/VoxCue) 的 main，冻结代码基线以 `v1.2.0` 为准；推送后补充提交号。安装资产仅上传公开 [NCFXZ/VoxCue-releases](https://github.com/NCFXZ/VoxCue-releases)，不改历史标签或恢复基线。
- 逐条修改、测试发现修复和 Mac 回归点见 [1.2.0 交接](MACOS_1.2.0_HANDOFF.md)，Mac 专属事项见 [独立清单](MACOS_1.2.0_TODO.md)，另有[接续提示词](MACOS_1.2.0_CODEX_PROMPT.md)和[中英发行说明](RELEASE_1.2.0.md)。
- `macos/` 全树未修改；共享变化需要 Mac 本机同步配置、补适配及逐项测试。本版不声称已生成或验证 Mac 1.2.0 包。

## 本轮测试发现的修复与清理

- Windows 设备枚举等待输出管道实际 close，连续解码 UTF-8 并排空诊断，避免 exit 后尾部和分块中文设备名丢失；输出超限后停止累积。
- ChatGPT 目录／二次身份及知识库意图目录等待加入及时取消围栏，复用唯一可取消 Promise 工具，旧结果不能继续发起任务或迟到写回。
- 登录入口夹具先固定自有 userData、sessionData、appData，再在加载 main 前关闭测试标志；新增实际隔离断言，退出失败不再遮盖首个断言失败，不放宽原退出期限。
- 瘦音频 ASAR 夹具补入唯一缺失的 components 契约依赖，保留实际 AEC／模型／尾包断言；退役失效的 AEC／桌面语音正式包启动参数，避免依赖已关闭的 RunAsNode fuse。
- 物理音频权限专项改走中央 owner 启动守卫和自有临时目录，只允许显式单个 `--hardware-audio`，删除结果落盘；普通回归不启用硬件采样。包安全检查明确标注 owner 启动拒绝，不冒称实际启动过生产注入测试。
- 云同步偏好变化立即发布并清除旧待发视图，避免快速开启多类别时后一次操作覆盖前两项设置；保留传输进度的合并。新增连续及同一事件循环配置、持久化与迟到状态回滚回归，原 GUI 快照数量和等待期限保持。
- 产品退出把 Codex／Copilot stop Promise 纳入已有 writer drain，重复退出不能提前放行；移除 before-quit 中重复且不等待的 stop，保留原 SDK 停止预算。新增真实 main 的合成 SDK 延迟停止／quit 重入回归，最终包须另验主进程自然退出后无本包子进程。
- 导航反转测试在同一 renderer 帧检查实际中途进度并同步触发原按钮，避免 Node 往返错过动画窗口；保留原进度区间、期限及全部无跳跃／终点／几何断言，产品 240ms 动画不改。
- 本地账户与云账号回归在点击 AI 服务分类后等待既有分类标题实际挂载，再核对原“两个连接按钮”断言，避免读取 View Transition 的旧面板；不加固定等待、不改超时或产品 UI。
- 下载取消按钮回归以真实 RAF 捕获中间 opacity／CSS duration，并等待该子元素 CSS 过渡完成后核对最终 opacity，替代固定 100／180ms 采样；保留原中间状态与 0.22s 断言，不改产品 UI 或动画。
- 删除九条被后方同值规则覆盖的样式声明；核对组件、具名导出、动态类和 Mac 消费者后保留仍有入口的实现。只清理已确认无活跃消费者的旧生成便携暂存，不清历史正式包、模型或未知资料。

## 最终发行资产

以下为 SDK 退出屏障修复后重建、完成最终隔离验收的 NSIS／APPX 字节。后续产品代码或产物变化须重新构建、核对摘要并完成相应验收；修复前候选不得发布。NSIS 安装和更新资产已归档到 `windows/release/1.2.0/`，APPX 位于 `windows/release/store/`，不覆盖 1.1.1 归档。

| 资产 | 字节 | SHA256 |
| --- | ---: | --- |
| VoxCue-Setup-1.2.0-x64.exe | 408832984 | a83d1399fb2dae98cc4dfcf98924c6e571d6c17a461ca92a8292556bbcc610ae |
| VoxCue-Setup-1.2.0-x64.exe.blockmap | 423533 | 09d5276a83919630a096aa7453e0e470e40044893eefce6d3423ee784955aae2 |
| latest.yml | 482 | 675dcc980824f04fd4c7aa4d185495fc7b94af9709fa0847a784e658c3227130 |
| VoxCue-Store-1.2.0-x64.appx | 601687634 | 90b029858f16632cafbfec06ca5a0c8865d71d83e392579e7c9b5d06f95e61f2 |

Windows 清单使用既有独立 Ed25519 身份，不生成或轮换密钥；公钥位于 ASAR。EXE 未使用 Authenticode 发布者签名，SmartScreen 限制保持；首次旧客户端升级仍依赖其原信任链。现用身份加密备份最初按 owner 选择交互保存桌面，随后由 owner 将 `windows-update-key.encrypted.json` 移到其指定的工作区外个人备份目录，口令由 owner 亲自输入并确认；助手仅核对文件元数据，未读取口令、密钥或备份内容。当前个人备份目录不视为离线保管，建议 owner 另存独立离线副本，不增加当前发布门禁；普通回归仍仅使用合成身份。

## 渠道状态与保护

- GitHub v1.2.0：待创建并上传，匿名完整回读资产及核对生产选择器后记录 URL、资产 ID 与摘要。
- 原 v1.1.1 发行 ID `440499445` 保持；其中 Mac `latest-mac.yml`、DMG、ZIP 资产 ID 分别为 `731817285`、`731807543`、`731811058`，原字节／摘要不变。Windows-only 新版不能使 Mac 误选无 Mac 资产的发行。
- Microsoft Store：产品 ID `9PBBVWZXMBPW`，Identity `NCFX.VoxCue`，Publisher `CN=CC9C4962-FFC8-44D9-A2C0-B446CBFD375A`，PFN `NCFX.VoxCue_1syhqk59eh0f0` 保持；最终 APPX 2.2.0.0 待上传提交。认证受理、认证通过、开始发布与实际上架须分别记录，不能互相替代。
- 正式包只在独立 OS 身份／可丢弃环境运行；不能在 owner 宿主用测试环境变量、产品 inspector 或改包字节冒充隔离。宿主不安装临时证书，不访问真实资料／凭据，不采样硬件或宿主屏幕。
