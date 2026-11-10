# VoxCue 当前进度

更新日期：2026-11-10。长期规则见 AGENTS.md；测试结果仅在终端／对话中报告。

## 当前基线与范围

- 本轮用户授权 Windows 1.1.1 更新回归、清理、完整安全／稳定／对抗／英文／视觉及安装负载检查，修复复验后推送私有源码并发布公开安装包，保持 v1.1.1 Latest。本轮不操作 Store、官网、域名或现有服务端。
- 接续输入为 `5f67815ab8b6eb657b189848f732377805f60a43`；Windows 包内产品输入为 `aa1b9dfdde712749413dff376729344bc3af14d5`，后续验证维护和发行元数据不改变包内产品代码。版本唯一来源 shared/package.json、根及 Windows 配置均为 1.1.1。
- 用户要求只保留 main：本地 main 跟踪 origin/main，已核对提交包含关系并移除额外本地／远端发行分支，后续直接在 main 开发和发行。既有 v1.1.0 与 v1.1.1 标签保持，v1.1.1 继续指向 Mac 输入 `e0a2a874bffbc37d5af57554074ade6fb7a8f446`。
- 三项 Windows 资产已按摘要归档至 windows/release/1.1.1/，来源和摘要见 shared/docs/WINDOWS_1.1.1_RELEASE.md。尚未推送本轮 main 或上传 Windows 资产；shared/docs/RELEASE_1.1.1.md 的 Windows 内容仍为待发布草稿。
- [公开 v1.1.1](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.1.1) 当前仍含原三项 Mac 正式资产并标记 Latest；Windows 更新继续选择完整 1.1.0。Mac 来源见 shared/docs/MACOS_1.1.1_RELEASE.md，Windows 旧基线见 WINDOWS_1.1.0_RELEASE.md。

## 本轮实现与验证维护

- 共享帮助随已确认的窗口／面板／音频状态显示当前动作，按语言预留紧凑宽度，批准连接后展开远程行；共用勾选动画、危险色和辅助功能降级，额度采用五小时优先的非变异排序。
- Windows 帮助定位复用既有原生 DPI 校正适配器，保持 360 DIP；默认 Ctrl+Shift、合法自定义组合和既有 Windows 布局策略保持。Mac 全树只读，其配置漂移只报告，不在 Windows 修正。
- 五档调度补入 interview-shortcuts、history-scroll、account-usage-overview、updates；原生登录按 DPI 子任务调度，保留原组、时限和全部断言。帮助 --native-hit 只向自有底层客户区及关闭按钮发送真实输入。
- 保存对话框探针增加自有窗口前台确认、失败关闭及命中诊断；矩阵使用进程作用域亮屏请求，仍遇锁屏／未知桌面立即停止。SDK 和语音离线夹具在加载正式模块前设置自有 userData/sessionData。
- 最终 ASAR、真实 SDK 子进程、LAN／移动资源闭包、私有路径拒绝、原生展示及最终包 UI 均按现行入口执行。package-upgrade-data 对真实 1.1.0 EXE 固定摘要和同路径合成 profile 验证资料兼容，与 NSIS 合成升级及独立 GUID 安装引擎分别执行。
- 更新专项、完整共享／原生／五档、稳定／安全／对抗、英文及临时视觉状态已执行；验证入口与边界见 shared/test/README.md、WINDOWS_1.1.1_RELEASE.md 和 WINDOWS_1.1.1_HANDOFF.md。固定模型对极短语气词不保证逐字识别，空输出或误识别不视为过滤通过，不为本次发行更换模型。
- 已核对生产、构建及测试消费者，未确认可独立删除的业务模块或弃用测试。初次安装界面缓存已清理并由打包重建；本轮最终暂存、重复安装输出、可重建缓存及临时视觉资料正在按归属／真实路径／占用收尾清理。

## 接续待办

- 提交并推送本轮验证维护和发行索引至私有 main；将 Windows 三项资产加入既有公开 v1.1.1，保留原 Mac 资产及 Latest，更新中英正文。
- 完整匿名回读 Windows 资产并核对本地摘要，复验两平台生产更新选择器和元数据；更新发行索引及本页的实际渠道状态，再提交／推送元数据。
- 完成本轮生成暂存和 owner 系统临时资料清理，释放所有自有进程请求。正式归档、旧恢复基线、原件、凭据、签名身份、现用依赖、认证公共缓存及历史明确跳过目录保持。

## 保护边界

- GUI、原生及推理只在 owner 登录解锁的控制台串行执行。仅合成账户／资料／图片、文件 TTS 和固定公共音频，不访问真实账户或凭据，不采样物理音频或宿主屏幕；Windows 结果不代替 Mac、真人语音或手机硬件验收。
- 联调只使用 owner 系统临时目录中的固定 0.5.3／`3bceb615dbba900f669322c301fc4b5b473dfb15` 参考，现有服务端保持原样。设备连接使用 HTTP＋WS，仅适用于电脑审批认证的可信私人局域网／热点。
