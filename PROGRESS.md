# VoxCue 当前进度

更新日期：2026-10-30。本文仅记录接续范围与待办，不保存测试成绩；长期规则见AGENTS.md。

## 当前任务与范围

- 本轮Windows0.6.5交付已结束：产品源码、正式安装/更新三项及Mac0.6.3→0.6.5逐项交接已上传。变化与逐文件入口见MACOS_0.6.5_HANDOFF.md；本轮一次性授权不延续至后续Mac发行或服务端部署。
- 共用源码覆盖Windows/Mac；本机macos全树和shared/server只读，禁止修改独立VoxCue-server源码。开始时客户端HEAD为11e5f089cba0fe2c3eda351c329ad4d03c266864；0.6.5产品源码为71948317e625c3e464413c7ff424de800c75853a，已正常推送私有main。历史Windows比较基线8eb42a79fe804531f010749ff46635bf320f5308；Mac0.6.3比较使用c37fa181，保留全部后续工作。
- 版本唯一来源shared/package.json更新为0.6.5；仅按用户明确授权定向更新Vite6.4.5，其余依赖/锁定版本、SDK1.0.21、Codex0.164.0、现用模型/索引/RAG v7、签名、凭据助手、host-id和Ed25519身份保持。本轮授权完整客户端测试、打包与正常提交/推送/发行；禁止服务端代码变更与部署，macos全树只读。
- 本轮执行workspace/架构/严格类型与noUnused、全部单测、依赖审计/构建、shared全功能矩阵（20轮面试、600秒真实ASR）、独立0.5.3只读真实HTTP、Windows原生/五档DPI/视觉/辅助功能及正式NSIS/更新/摘要验收。只用owner临时合成资料和自有loopback，普通夹具启动前关闭生产统计传输；锁屏立即停止。结果只终端/对话。

## 当前实现

- Windows0.6.5安装/更新三项已归档于windows/release/0.6.5，并公开于[发行页](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.5)。产品源码已正常推送私有main；安装器Authenticode沿用既有NotSigned状态，Latest保留v0.6.3。运行结果只在终端/对话记录，不写工作区成绩。

- Markdown展示层修复CommonMark未识别的中文标点/尾部空格粗体；代码、转义文本和原始消息保持。扫光使用单张不重复渐变，所有文本宽度1秒扫过、2.5秒停顿；长标题使用受限网格列并正确省略，减少动态效果沿用。云浮层只由悬停或明确激活展开，弹窗自动/程序焦点不展开。
- 统计统一v2能力协商、归属凭据和逐项终态回执，无v1回退；本地模式匿名，账户模式在事件发生时固定归属。主进程经现有VoxCue会话领取凭据，系统加密保存于cloud-account/telemetry.bin，普通队列仅不透明引用；失败不改变登录会话。Windows/Mac复用原加密适配器，无需修改Mac专属文件。
- 沿用安装ID，持久化全安装健康sequence；原子文件先同步再替换。队列2000条/30天、单上传、128KiB批次、超时/指数退避/抖动/Retry-After均有界。成功/永久拒绝/未确认分开处理；缺失历史凭据的旧账户事件明确丢弃计数，不补认当前账户。损坏队列保留并关闭统计。
- C047移除枚举字符串强制转换，限制JavaScript日期范围，并校验firstSeenAt/startedAt与effective等语义。公开Renderer信号和IPC权限维持固定白名单，无新增凭据通道。
- 详细协议和专项命令见[客户端统计](shared/docs/CLIENT_TELEMETRY.md)、[测试入口](shared/test/README.md)。

## 接续待办与边界

- Windows发布流程已结束；本轮临时捕获、重复暂存和匿名下载副本清理，正式归档与当前验证基线保留。后续接续以Mac本机验收为主，不能使用Windows结果代验；不改变锁屏或系统权限。

- 用户明确批准仅Vite6.4.4→6.4.5安全补丁（GHSA-8g5g-mxqh-grgj）。共享版本源定向锁定6.4.5，只更新Windows清单/锁和安装；核对其他实际依赖版本不变。Mac锁只读，交由Mac本机同步该补丁。其他依赖/SDK/模型/身份保持。
- Mac逐项交接与提示词见MACOS_0.6.5_HANDOFF.md、MACOS_0.6.5_CODEX_PROMPT.md；按Mac0.6.3产品快照c37fa181逐文件比较并逐条验收。
- 公开0.6.5仅新增Windows exe、blockmap、latest.yml；Latest继续为v0.6.3，既有Mac/历史/模型资产保留。Mac另行本机验收，打包/提交/发行按该环境用户当前授权执行。

- Mac本机执行共享界面、平台加密存储及退出/重启专项；本机无法代验Mac原生行为。当前没有Mac专属源码待修改。
- 产品源码与交接已上传：[源码7194831](https://github.com/NCFXZ/VoxCue/commit/71948317e625c3e464413c7ff424de800c75853a)。已发布Mac0.6.3仍是旧v1安装包，不因源码适配自动更新。独立服务端0.5.3既有部署保持，服务端HEAD为3bceb615dbba900f669322c301fc4b5b473dfb15；详细接口/运维见独立仓库API.md、CLIENT_TELEMETRY.md、OPERATIONS.md。
- 本轮只用合成账号与公开固定音频；真实AI订阅、真实休眠/物理音源和全量模型推理仍是独立待验边界，合成验证不替代这些路径。本轮完整客户端矩阵和发行按当前授权执行，服务端保持只读。

## 固定基线

- Windows x64、macOS14.2+/Apple Silicon；本地账户不造云用户，AI授权独立；Renderer隔离、同步/注销/导出权限不放宽。更新维持匿名下载及完整资产/签名/摘要校验。
- 历史Windows0.6.3三项已补入既有公开发行页，保留Mac/旧/模型资产及Latest v0.6.3；Windows既有NotSigned状态不在本轮轮换。发行产物、依赖、模型、真实资料、恢复基线与历史跳过目录保护。
- 服务端历史基线0.5.2/472541c；0.5.3统一新统计协议，旧客户端不再作为兼容目标。当前只读联调使用owner临时数据库，不操作生产。

## 历史索引

- 0.6.3：[Windows客户端C001–C082](shared/docs/WINDOWS_0.6.3_HANDOFF.md)、[服务端S/M要求](shared/docs/SERVER_FOR_CLIENT_0.6.3_HANDOFF.md)、[Windows提示词](shared/docs/WINDOWS_0.6.3_CODEX_PROMPT.md)、[逐文件审计](shared/docs/CLIENT_0.6.3_FILE_AUDIT.md)、[Mac发行索引](shared/docs/MACOS_0.6.3_RELEASE.md)。
- 0.6.2：[Mac交接C001–C050及文件差异](shared/docs/MACOS_0.6.2_HANDOFF.md)、[接续提示词](shared/docs/MACOS_0.6.2_CODEX_PROMPT.md)、[服务端0.5.2历史变化](shared/docs/SERVER_0.5.2_HANDOFF.md)。
- 0.6.1：[客户端交接](shared/docs/CLIENT_0.6.1_HANDOFF.md)、[Windows交接](shared/docs/WINDOWS_0.6.1_HANDOFF.md)。
- 0.6.0：[Mac交接](shared/docs/MACOS_0.6.0_HANDOFF.md)、[逐文件审计](shared/docs/CLIENT_0.6.0_FILE_AUDIT.md)、[Mac发行](shared/docs/MACOS_0.6.0_RELEASE.md)、[Windows发行](shared/docs/WINDOWS_0.6.0_RELEASE.md)。
- 设计与目录：[架构](shared/docs/ARCHITECTURE.md)、[RAG](shared/docs/RAG_ARCHITECTURE.md)、[工作区布局](shared/docs/WORKSPACE_LAYOUT.md)、[清理边界](shared/docs/WORKSPACE_CLEANUP.md)。更早版本按`shared/docs/`与Git历史查阅。
