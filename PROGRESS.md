# VoxCue 当前进度

更新日期：2026-11-10。长期规则见 AGENTS.md；测试结果仅在终端／对话中报告。

## 当前基线与范围

- Mac 1.1.1 已发布为 [Latest](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.1.1)。完整 DMG／ZIP／latest-mac.yml、本地归档、输入与公开摘要见 shared/docs/MACOS_1.1.1_RELEASE.md；中英文说明见 RELEASE_1.1.1.md。
- Mac 生产输入 e0a2a874bffbc37d5af57554074ade6fb7a8f446 已推送私有源码 main，固定标签 v1.1.1 指向该输入。后续发行索引／Windows 交接文档不改变 Mac 包；已有 v1.1.0 和 v1.1.1 标签不得移动。
- Windows 正式仍为 1.1.0，源码标签基线 6b81effabce08df1a3b5836848f2eebddeec9d09，包内产品输入 d9b231a289780f0bc0d8e0b59e38d6a5e4c3c0bc。共享版本唯一来源已为 1.1.1，根／Mac 已同步，windows/package.json 的 1.1.0 漂移留 Windows 本机处理，Mac 未写 windows/。
- 用户追加要求逐条编写 Windows 1.1.0→1.1.1 更新／测试交接，并明确确认由其在 Windows 端按文档接续。入口为 shared/docs/WINDOWS_1.1.1_HANDOFF.md，共 W001–W032；本轮没有 Windows 原生验收结论。

## 已实现摘要

- Mac 默认仍为 ⌃⇧，设置／实时预览／帮助／截图使用原生符号并支持自定义 Command；修复菜单抢键与 Command 字母事件缺失。Windows 保留 Ctrl+Shift 字符和合法组合规则。
- Mac 转写显隐使用局部双面板画布；帮助按当前语言最长动作预留宽度、显示当前可执行动作，远程两行随连接动画展开／收起。主进程最小只读状态与 rendererRevision 保持同步，退出先检查 owner、webContents 和关闭意图。
- 账号删除与资料选择共用勾选动画、危险色／主题色及半透明边界，包含减少动态／透明和高对比降级；删除图标前置。账户卡片、骨架与摘要复用五小时优先的非变异排序。
- Mac 固定补齐 ws@8.22.2、qrcode-generator@2.0.4、@types/ws@8.18.2；既有依赖／SDK／模型保持。最终收集显式包含 ws 和移动资源闭包。闲置图标、撤掉的试验原生绑定及重复样式已按消费者清理。
- Mac 已按当前入口完成导出优先专项、共享与本机回归、五档界面及最终包／旧资料兼容／发布后匿名更新的执行。具体结果只在终端／对话；侧栏形变夹具保留悬停、焦点和几何诊断，不放宽断言。

## 接续待办

- Windows 按交接文档同步本机版本与生成配置，保持 macos/ 全树只读；不升级现有依赖或模型。
- Windows 五档调度补入 interview-shortcuts、history-scroll、account-usage-overview、updates，保留原有全部组。实际 1.1.0 资料升级另验，不能把合成 NSIS／惰性应用夹具称为正式旧 profile 兼容。
- Windows 本机执行类型／契约、架构、完整单测、共享／原生／五档、安全／对抗、长稳及最终负载；发布或 Store 提交按 Windows 当前任务授权，不继承本轮 Mac 发布动作。
- 本轮 Mac 自有临时视觉资料、固定服务端参考及指针已核对真实路径、归属和占用后清理；测试期自有亮屏断言已释放。正式资产与认证公共缓存保留。

## 保护与边界

- Mac 1.1.1 的全局 Latest 不改变本平台完整稳定资产选择：Windows 继续选择完整 1.1.0。Windows 1.1.0、Mac 1.0.2／1.0.0 及全部旧正式／恢复资产保留。
- 逐项 Mac 来源见 shared/docs/MACOS_1.1.0_HANDOFF.md；Windows 1.1.0 发行与 Store 上次观察见 WINDOWS_1.1.0_RELEASE.md，本轮不操作门户、官网、域名或服务端。
- 原件、真实资料／凭据、固定本地签名和 Ed25519 身份、现用依赖及认证公共模型／音频缓存、历史明确跳过目录均保护。联调使用临时只读 0.5.3／3bceb615dbba900f669322c301fc4b5b473dfb15，不修改现有服务端。
- 仅合成资料、文件 TTS 和认证公共音频；短语气词空输出或误识别不算过滤证据。真实账户、物理音频／屏幕、手机键盘／安全区和真实私人网络权限未覆盖时必须说明。
- 设备连接使用 HTTP＋WS，仅限可信私人局域网／热点，审批认证后才算连接，不重放离线命令。
