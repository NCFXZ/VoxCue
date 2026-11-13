# VoxCue 架构

本文描述当前桌面源码的职责边界。版本、实现进度及待办见 [PROGRESS.md](../../PROGRESS.md)，目录和开发命令见 [工作区布局](WORKSPACE_LAYOUT.md)。历史方案和一次性授权查 Git 或对应版本交接，不作为当前实现入口。

## 分层与装配

```text
React components → stores / services → DesktopAPI
                                          ↓
                            sandbox preload → IPC
                                               ↓
                                          application
                                               ↓
                                      backend / 平台接口
                                               ↓
                                    Worker / 系统适配器
```

- shared/src/components 负责展示；stores 管理状态、异步生命周期和迟到结果；services 调用受控桌面接口。Renderer 不访问 Node、Electron、凭据、数据库或模型实现。
- shared/electron/contracts 是公开类型和 DesktopAPI 的唯一来源，只依赖纯类型/工具。preload 保持沙箱 CommonJS，运行时只导入 electron，其余为类型引用。
- main.ts 装配端口、窗口、账户与生命周期；ipc 校验窗口/frame、操作白名单、参数与请求归属；application 协调语音、检索、生成、截图和本场上下文。
- backend 实现独立服务，通过契约和注入端口交互，不反向依赖 application、IPC 或 React。耗时解析、模型推理与采集在 Worker、utilityProcess 或原生子进程完成。
- platform 定义接口和可信平台选择；macos/electron 与 windows/electron 实现对应系统能力。系统差异不扩散成两套页面或业务流程。

窗口保持 contextIsolation、sandbox 开启，nodeIntegration 关闭。取消、切换、退出和重载必须释放资源并拒绝旧任务写回；失败明确返回，真实服务不转 Mock。架构检查覆盖两平台依赖图、生产/测试隔离及 Renderer 边界。

## 界面与本地状态

两平台编译同一 shared/src 界面、主题、材质、无障碍语义和交互；Mac 使用 SF Symbols，Windows 使用 Fluent 图标。系统窗口、权限、音频、凭据和更新由适配器处理。面试实窗及预览共用 interviewAppearance 的固定深色及透明度参数；减少动态效果、减少透明度沿用统一降级。详见 [共用桌面界面](PLATFORM_UI.md)。

准备聊天、面试、历史、知识库、账号和同步各有 store；持久化经现有服务与受控 IPC。附件数量和单文件体积取 contracts/chat 的统一限制，Renderer 预检与主进程独立校验并存。现有存储键、文件格式、IndexedDB 原件和用户数据迁移规则保持兼容。

面试由主进程拥有生命周期、截图引用、可信转写及上下文；Renderer 不能伪造系统音频或麦克风上下文。生成只消费当前问题、已确认配置和有界资料，成功且未取消的结果才进入上下文。停止、结束、重载和账号切换阻止旧事件复活。

## AI、账号与凭据

ChatGPT 与 GitHub Copilot 使用各自受控 Provider/官方运行时端口，和 VoxCue 主账号分离。流式事件、附件、额度、取消及请求身份经既有契约传递。准备聊天按明确意图检索资料；面试采用有界重试和同题证据复用，不重建截图或混合多次尝试的正文。

backend/cloud 管理主账号、额度和资料同步，令牌按服务 origin 隔离并由主进程系统加密。同步处理本地版本、分类开关、单项暂停、取消和显式冲突选择；跨账号迟到结果不得回写。账号服务位于独立 VoxCue-server 仓库，桌面测试只读取校验后的固定服务端基线，不部署或修改服务端。

Mac 系统网络适配仅承接规定的账号和同源遥测请求；其他网络能力按既有端口处理。telemetry 独立管理随机安装身份和有界原子队列，失败不进入账号/同步错误链；正文、原始文件、音频、截图和令牌不进入统计。详见 [统计协议](CLIENT_TELEMETRY.md)。

Mac 凭据使用固定证书和标识的冻结 v8 助手；旧 v1–v7 源码及规范字节保留。正常构建只校验复制，禁止重编、重签或隐式更换身份。主进程用有界串行队列管理 crypto/probe/validate/cleanup，拒绝、锁定、协议异常或超时停止本次启动的授权请求；预期清理延期不阻止正常登录。

迁移只读取一个来源，在同一钥匙串复制并读回验证；旧条目清理必须通过当前代无交互解密和本地结构检查。没有业务资料也使用既定验证门槛，不借网络令牌是否有效判断。日常加解密不扫描旧名称；清理只枚举属性并按引用删除。全程不收集或缓存 Mac 登录密码，不改写系统 partition/Integrity。坏资料保留，主动重新登录时先备份原加密文件。准确门槛、冲突和降级边界以 [Mac 凭据说明](../../macos/docs/CREDENTIALS.md) 和 [1.2.2 交接](MACOS_1.2.2_CREDENTIAL_HANDOFF.md) 为准。

## 检索与文档

application/rag、ragContext、ragSelection 协调生成意图、可信追问和请求作用域证据；ragQuery 只保存现用的查询规范化、检索重点与未解析指代判断。知识库管理和生成检索通过 KnowledgeHost 进入隔离进程，数据库与模型不进入 Renderer。

固定 E5、分块、向量归一化、候选门槛、来源判断、证据预算和索引格式以 [RAG 架构](RAG_ARCHITECTURE.md) 为准。无关资料返回空证据，不以其他项目补齐；不把文档内容提升为系统指令。只有明确可用性故障允许受控回退，身份、参数、完整性和取消错误保持失败。

原件导入、解析和索引有大小、任务预算及取消围栏。PDF、DOC/DOCX、Markdown、TXT 使用现有解析器；不执行宏或上传整库。提交使用不可变 revision 与原子 catalog，失败保留原件与恢复资料，不自动重建、vacuum 或迁移索引。详细保护见 [安全与生命周期](SECURITY_HARDENING.md)。

## 语音与组件

平台采集适配器提供系统音频/麦克风，公共协调层控制来源、设备、静音、权限、停启和尾段归属。共享 Worker 承接预处理、VAD、AEC 和识别；RecognitionRouter 管理 Paraformer/Qwen 识别器切换，保留现有模型、设备策略和有界预热。原生及 DSP 数学逻辑不由界面或配置同步改写。

采集、识别、模型加载各有代次和实际退出围栏。结束阶段尾段只归档，不自动触发新回答；原始音频不保存或上传。模型、断流、权限和设备错误明确上报；平台恢复策略在对应适配器内，不用另一平台单测代表本机原生表现。

backend/components/catalog 固定组件来源、体积、ZIP 和逐文件摘要；ComponentService 使用唯一生产入口 unpackComponentFile 流式校验解包。拒绝路径越界、链接、加密、重复/额外条目和内容不符，完整认证后才原子发布。取消清理自有暂存，删除前等待消费者退出且核对受管目录，不触碰未知内容或研究资产。adm-zip 仍有构建/夹具消费者，当前依赖声明保留，不作为生产解包入口。详见 [本地组件](COMPONENTS.md)。

## 局域网连接

backend/remoteConnection/service 管理 HTTP/WebSocket、配对审批、连接和资源释放；protocol 管理共用地址、命令、秘密比较及限流校验。service 显式保留原有工具导出，线协议、阈值和错误行为保持一致。

网络层只依赖契约和注入端口；application/IPC 校验窗口、内容投影和会话归属。设备页面独立构建，只开放其 manifest 依赖闭包，不暴露 DesktopAPI。草稿采用主机持有的版本和 CAS，断线恢复使用有界快照，不重放过期控制。配对和本地网段限制见 [局域网接口](REMOTE_CONNECTION.md)。

## 更新、构建与验证

共享更新层提供状态、缓存与可信资产选择；Mac 驱动把网络和缓存元数据通过同一认证规范化方法处理，保留选中 release、签名和下载字段。检查、下载、安装均维持原有平台/版本、签名、摘要、路径及归属校验。Windows 更新仍由其适配器执行。完整分发边界见 [更新说明](UPDATES.md)。

共享版本模板和平台差异生成根与本机配置；根不安装依赖。编译与打包只包含 shared 和本平台运行闭包，冻结助手、Worker 和 ASAR 物理路径按既有规则检查。共同锁历史基准、平台锁、签名私钥、固定助手和发行恢复资产不得按“搜索不到引用”删除。

验证按变更执行类型、架构、相关单测、共享构建及定向界面回归；计算逻辑使用固定合成夹具对比。GUI/原生仅在当前 UID 已登录且解锁的桌面串行执行，使用明确启用的隔离入口并禁止普通 UI 夹具调用正式凭据助手。临时 profile/数据库/截图清理，测试结果只在终端和对话显示。命令和具体入口见 [测试说明](../test/README.md)。
