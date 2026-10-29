# 客户端0.6.3逐文件审计范围

比较基线：`8eb42a79fe804531f010749ff46635bf320f5308`。目标为0.6.3产品实现及交接；源码快照见[Mac发行记录](MACOS_0.6.3_RELEASE.md)，业务清单见[Windows C001–C082](WINDOWS_0.6.3_HANDOFF.md)。本表记录文件职责与审查关注点，不保存执行成绩。

合计75个客户端源码/测试/配置/文档路径。A为新增，M为相对基线修改。Windows专属、服务端、依赖锁及身份未纳入修改；打包/模型/依赖/临时测试产物不入Git。

| 文件ID | 状态 | 路径 | 更新与审查关注 |
|---|---|---|---|
| F001 | M | `AGENTS.md` | C002–C004：长期规则精简、三条编码原则、进度维护与清理。 |
| F002 | M | `PROGRESS.md` | C004/C076：当前范围、实现摘要、平台/服务端待办、发行授权与验证入口。 |
| F003 | M | `README.md` | C016–C046/C072/C076/C077：本地账户、独立导出、统计边界与交接索引。 |
| F004 | M | `macos/package.json` | C001：Mac本机0.6.3配置，依赖/锁不变。 |
| F005 | M | `macos/src/icons.tsx` | C032：导出图标原生SF映射。 |
| F006 | M | `macos/src/symbols.json` | C032/C080：导出square.and.arrow.up及面试缩放向外箭头arrow.down.left.and.arrow.up.right符号生成输入。 |
| F007 | M | `macos/test/scripts/components-smoke.mjs` | C077：真实组件专项的缺失提示名称与共用展示表一致，原推理/哈希/删除断言保持。 |
| F008 | M | `macos/test/scripts/interview-layout-smoke.mjs` | C040/C077：开场AI服务及语音显示名称断言，实际原生bounds/五档/中心容差保持。 |
| F009 | M | `macos/test/scripts/package-smoke.mjs` | C070/C075/C082：正式包合成夹具启动前禁用真实账号origin，注入合成账号后刷新Renderer，统计不外发，模型/更新独立传输保持。 |
| F010 | M | `package.json` | C001：从shared生成的本机根版本配置。 |
| F011 | M | `shared/docs/ARCHITECTURE.md` | C017–C072：本地账户、导出和主进程统计职责/边界。 |
| F012 | A | `shared/docs/CLIENT_0.6.3_FILE_AUDIT.md` | C076：本逐文件范围和更新映射，自身不作为产品运行输入。 |
| F013 | A | `shared/docs/CLIENT_TELEMETRY.md` | C047–C072：事件v1、26项口径、身份、队列/回执、保留及服务端未适配边界。 |
| F014 | A | `shared/docs/MACOS_0.6.3_RELEASE.md` | C076：产品源码快照、发行三项来源/资产/摘要与Latest/旧资产保护索引，不保存测试成绩。 |
| F015 | A | `shared/docs/SERVER_FOR_CLIENT_0.6.3_HANDOFF.md` | S001–S036/M001–M026：服务端未来实现清单，明确本轮后端未修改/未部署。 |
| F016 | A | `shared/docs/WINDOWS_0.6.3_CODEX_PROMPT.md` | C076：Windows客户端逐条验收及独立服务端实现/隔离测试提示词，不授权生产。 |
| F017 | A | `shared/docs/WINDOWS_0.6.3_HANDOFF.md` | C001–C082完整客户端交接、Windows实际验证与保护范围。 |
| F018 | M | `shared/docs/WORKSPACE_CLEANUP.md` | C005/C077：确认无消费者的样式删除及重复展示表合并，保护范围。 |
| F019 | M | `shared/electron/backend/accountArchive.ts` | C031/C034：导出提示改名，原分块/取消/压缩与目标提交语义保持。 |
| F020 | M | `shared/electron/backend/accountErasure.ts` | C071：注销清理新增统计队列，纯安装标识和固定身份保持。 |
| F021 | A | `shared/electron/backend/localMode.ts` | C017：主进程布尔偏好加载、原子保存及并发互斥。 |
| F022 | A | `shared/electron/backend/telemetry/queue.ts` | C062–C069：有界/限龄事件队列、原子合并写入、健康counter和跨进程退避。 |
| F023 | A | `shared/electron/backend/telemetry/service.ts` | C049–C071：事件发生时身份、单调面试时钟/检查点、AI计时与匿名幂等补传。 |
| F024 | M | `shared/electron/contracts/cloudAccount.ts` | C019：桌面本地偏好可选字段，不授予云认证。 |
| F025 | M | `shared/electron/contracts/components.ts` | C077：纯共用组件展示名称/说明，内部ID不变。 |
| F026 | M | `shared/electron/contracts/desktop.ts` | C018/C048：local-mode和telemetry公开API/通道类型唯一来源。 |
| F027 | M | `shared/electron/contracts/speechSettings.ts` | C077：选择项引用组件名称，CPU性能说明单一来源。 |
| F028 | A | `shared/electron/contracts/telemetry.ts` | C047：固定字段/类别/数值的公开事件与IPC校验，不容纳正文。 |
| F029 | M | `shared/electron/ipc/chat.ts` | C053/C061：合法用户聊天操作、首段文本和成功/失败/取消计时。 |
| F030 | M | `shared/electron/ipc/interview.ts` | C061：面试回答同一用户请求的统计生命周期，重试不放大。 |
| F031 | A | `shared/electron/ipc/telemetry.ts` | C048：固定信号、额外参数、窗口及main frame限制。 |
| F032 | M | `shared/electron/main.ts` | C017–C028/C034/C048–C071：本地入口、归档/退出保护，统计与账号/语音/窗口/休眠装配；无后端改动。 |
| F033 | M | `shared/electron/preload.ts` | C018/C048：沙箱类型化local-mode/telemetry桥，不导入运行时项目模块。 |
| F034 | M | `shared/package.json` | C001：版本唯一源0.6.3，依赖清单不升级。 |
| F035 | M | `shared/src/App.tsx` | C021/C029/C030/C050/C053：本地主界面、云同步隔离、独立导出和可用/实际导航信号。 |
| F036 | M | `shared/src/assets/README.md` | C043：GitHub官方图标出处与许可。 |
| F037 | A | `shared/src/assets/github.svg` | C043：官方Octicons本地资源，无远程加载。 |
| F038 | M | `shared/src/components/AIServicePanel.tsx` | C022：AI服务与VoxCue账号/本地模式说明。 |
| F039 | M | `shared/src/components/AccountDeletionPanel.tsx` | C030/C037：拆出导出，移除用户指定说明，密码/勾选/忙碌和注销保护保持。 |
| F040 | A | `shared/src/components/AccountExportPanel.tsx` | C030–C036：独立导出入口、成功/错误反馈及静默取消。 |
| F041 | M | `shared/src/components/CloudAccountPanel.tsx` | C016/C024–C027：跳过登录、精简本地账户行、复用最初登录窗口。 |
| F042 | M | `shared/src/components/ComponentsNotice.tsx` | C077：性能及缺失提示引用组件展示名和同源CPU说明。 |
| F043 | M | `shared/src/components/ComponentsPanel.tsx` | C077：移除重复展示映射，复用公共名称/说明。 |
| F044 | M | `shared/src/components/HistoryPage.tsx` | C053：真实查看记录操作信号。 |
| F045 | M | `shared/src/components/KnowledgePage.tsx` | C014：文档行使用FileText替代聊天气泡。 |
| F046 | M | `shared/src/components/PreparationPage.tsx` | C006–C013/C040：拖入卡片/标签，开场AI服务文案及动画参数同步。 |
| F047 | M | `shared/src/components/SettingsDialog.tsx` | C030/C038/C039：导出位置、容量换行/字号与相关设置样式接口。 |
| F048 | M | `shared/src/components/Sidebar.tsx` | C006/C024/C040：本地账户菜单、AI服务状态、侧栏动作隐藏延迟。 |
| F049 | M | `shared/src/components/SpeechModelSettings.tsx` | C077：友好语音选择项和CPU性能说明/可用设备建议，不改实际推理。 |
| F050 | M | `shared/src/components/SyncBadge.tsx` | C029：本地模式不显示云同步状态。 |
| F051 | M | `shared/src/components/UpdatesPanel.tsx` | C042–C046：GitHub反馈链接/错误状态及仅隐藏开发版说明。 |
| F052 | M | `shared/src/components/icons.tsx` | C032：共用Fluent导出图标接口。 |
| F053 | M | `shared/src/services/accountExport.ts` | C031/C034–C036/C053：独立导出、本地无云请求、完整性检查和成功导出活动。 |
| F054 | M | `shared/src/services/accountUsageSummary.ts` | C040：AI服务不可用通用文案。 |
| F055 | A | `shared/src/services/telemetry.ts` | C048/C053：Renderer固定信号包装，失败不阻塞产品。 |
| F056 | M | `shared/src/stores/cloudAccount.ts` | C018/C027：本地偏好操作的状态/异步管理。 |
| F057 | M | `shared/src/stores/interview.ts` | C057/C059：人工与自动提交区分、结束保存结果上报。 |
| F058 | M | `shared/src/stores/knowledge.ts` | C053：成功导入文件活动信号。 |
| F059 | M | `shared/src/stores/preparation.ts` | C053：附件导入和个人信息保存活动信号。 |
| F060 | M | `shared/src/styles.css` | C005–C015/C016/C030/C038/C039/C044：清理旧账号样式、共用曲线/拖入卡片/跳过按钮/容量及反馈排版。 |
| F061 | M | `shared/test/README.md` | C073/C076：本地账户/导出/统计入口及测试隔离说明。 |
| F062 | M | `shared/test/scripts/account-erasure-smoke.mjs` | C074/C081：独立导出/删除顺序及文案、原ZIP/删除回归；共边坐标按1/64像素比较并保留原始诊断。 |
| F063 | M | `shared/test/scripts/components-ui-smoke.mjs` | C077：组件友好选择项、同源CPU性能说明；下载/切换/禁用/几何断言保持。 |
| F064 | M | `shared/test/scripts/free-service-smoke.mjs` | C039–C041/C074：额度标题及AI服务各状态，真实合成面试开始/结束。 |
| F065 | M | `shared/test/scripts/functional-suite.mjs` | C073：增加local-mode/telemetry组，其余完整矩阵保持。 |
| F066 | M | `shared/test/scripts/interview-ux-smoke.mjs` | C077：语音切换菜单显示名称更新，既有交互/回退断言保持。 |
| F067 | A | `shared/test/scripts/local-mode-smoke.mjs` | C016–C038：本地/登录/重启、独立AI/导出、云权限和设置布局专项。 |
| F068 | A | `shared/test/scripts/telemetry-smoke.mjs` | C047–C071：真实IPC/本地到登录、合成面试、隐私、重启和旧服务端退避专项。 |
| F069 | M | `shared/test/unit/account-archive.test.ts` | C071：注销清理队列且保留纯安装ID。 |
| F070 | M | `shared/test/unit/account-usage-summary.test.ts` | C040：AI服务名称断言同步。 |
| F071 | M | `shared/test/unit/components-notice.test.tsx` | C077：旧后台标签仍显示统一友好名称，CPU/缺失分支断言。 |
| F072 | M | `shared/test/unit/desktop-contract.types.ts` | C018/C048：公开local-mode/telemetry类型及拒绝任意内容。 |
| F073 | M | `shared/test/unit/desktop-ipc.test.ts` | C018/C048：新通道allowlist、窗口/frame/字段权限。 |
| F074 | A | `shared/test/unit/local-mode.test.ts` | C017：持久化/损坏/写失败与竞争。 |
| F075 | A | `shared/test/unit/telemetry.test.ts` | C049–C071：身份、时钟/有效场次/崩溃、隐私、队列/回执/退避/注销迟到写与时区边界。 |

根/Mac package.json由shared版本源生成；Windows配置漂移在本机交接中明确待同步。MACOS_0.6.3_RELEASE只存发行来源/资产元数据，不把日志、测试报告、模型或截图提交。AGENTS/PROGRESS历史授权已精简，完整旧字节仍可从Git获取，不把删除条款解释为新生产授权。
