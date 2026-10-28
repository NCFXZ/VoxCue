# VoxCue 0.6.1 → 0.6.2：客户端完整变化与 Mac 交接

> **本次 Mac 接续只修改和验证客户端。服务端0.5.2已交付并部署，固定提交472541cc80c77439f02c45d0bf0aed913b036134，必须只读。不要修改服务端代码、测试、配置、依赖、锁、数据库、部署、管理员或身份；不要迁移、部署、重启或写生产。发现接口不兼容只修客户端。** 下文服务端变化和已执行操作是历史事实，不是新的服务端授权。

日期：2026-10-28。配套[可直接粘贴的Mac Codex提示词](MACOS_0.6.2_CODEX_PROMPT.md)与[服务端0.5.2固定只读变化](SERVER_0.5.2_HANDOFF.md)。请全文阅读，逐项记录C001–C050；服务端S001–S024逐项阅读、对应客户端接口，不把它们变成后端开发或重测任务。

## 1. 基线、交付状态与保护范围

| 对象 | 比较与当前交付 |
| --- | --- |
| 客户端0.6.1产品基线 | `88875908574d445d43a40f3eeb63013dcb31fb4b` |
| 0.6.1后续纯文档/发行交接 | `f05c8ea3ecc4e7836a92b9a2f0973ebae188f271`；不是新的产品逻辑 |
| 0.6.2产品及维护 | `6e6ed50bfbcade510b0a6bc54c9263159d01ac35`；`59c3f0260c1414c6ef25f11c5924c54ce8a8c1b5` |
| 本交接文件清单的固定客户端终点 | `41179a9879dc767f61de5b3fad326b409a492d3c`；后续本文补充提交只改文档，获取时保留后续远端提交 |
| 服务端历史基线 → 固定只读终点 | 0.5.1 `43b6a973849bdc3c204d8434a21857b943048758` → 0.5.2 `472541cc80c77439f02c45d0bf0aed913b036134` |
| 已完成的Windows交付 | Windows x64 0.6.2安装器、blockmap、latest.yml已公开；现存17个旧draft恢复，未重建不存在的0.5.10 |
| 当前Mac状态 | macos/package.json仍0.6.1是Windows只读规则的预期结果；Mac需本机生成0.6.2、验收和临时验包，未发行Mac0.6.2 |
| 更新选择与生产历史状态 | Latest仍为Mac0.6.1；Windows实际选到完整0.6.2，Mac仍选到完整0.6.1。服务端0.5.2/schema v5已上线，本轮Mac不重复任何部署或发行操作 |

**版本分开：客户端0.6.2，服务端0.5.2。** 顶部拖动区和登录点击修复属于0.6.2；逐库冷恢复、原件落盘立即索引、单任务按库优先、启动/开库补缺失索引与容量条无title是0.6.1已有行为，本次补边界测试，不能写成0.6.2新增。保留[Windows0.6.1 C001–C040/V001–V012](WINDOWS_0.6.1_HANDOFF.md)及[0.6.1白名单](CLIENT_0.6.1_HANDOFF.md)作为历史依据；本页同名ID属于0.6.2，记录时注明版本。

- 先检查分支、远端、未提交工作，保留全部既有改动和后续远端提交，不reset、不强推。若Mac仍停在更早0.6.0，先保留后续Mac修复；不要把旧修复撤回或算成0.6.2新增。
- 唯一版本源`shared/package.json`已0.6.2；Mac仅用同步脚本生成根/Mac配置，不手改生成文件。Windows全树只读，不复制其锁、二进制或C#探针。
- 固定Copilot SDK/runtime1.0.21、Codex0.164.0、依赖/锁、模型、索引格式、RAG v7、macOS14.2/arm64、原生红绿灯、SF Symbols、签名、凭据助手、Ed25519更新身份保持。
- 独立`NCFXZ/VoxCue-server`及客户端忽略的`shared/server/`均只读；参考不是客户端Git/安装包内容。禁止通过修改后端参考或后端测试使客户端通过。后端问题记录，不自行修后端、推后端或重跑后端全量/1800秒长稳。
- GUI/原生只在当前用户已登录、解锁控制台串行。仅owner临时目录内合成账号/资料/图片/捕获与固定公开临时模型/音频，不读真实账户/凭据/资料，不采样物理音频。普通UI禁正式凭据助手；原生凭据仅显式临时Keychain。
- 测试结果只终端/对话；不向工作区保存新报告、截图、模型、profile、数据库或包。退出清理先核对消费者、真实路径和占用，保护发行、恢复基线和历史跳过目录。
- 本交接不新增Mac公开发行授权；可进行客户端本机临时验包，不能上传Mac包、改Latest、再次恢复草稿、替换真实安装或更改历史/模型资产。源码提交限逐文件审计后的客户端范围。

## 2. 登录拖动区修复及平台边界

Windows 旧登录页把整个 `.login-page` 登记为拖动区。找回密码及验证码按钮在 DOM 中虽然启用且 computed app-region 为 no-drag，实际原生命中仍可为 HTCAPTION，鼠标点击没有进入按钮；仅用 Playwright 的 Renderer 点击不能排除此问题。

0.6.2 在 `LoginPage.tsx` 增加一个无障碍隐藏、无焦点的 `.login-drag-region`。在 Windows 的 `.custom-window-controls.login-shell` 范围内，清除整页拖动登记，只有顶部全宽 **72 CSS px** 条带参与拖动；标题、表单和右侧预览的旧拖动区显式退出。条带绝对定位，不增加布局高度，不调整颜色、尺寸、表单顺序、验证码限额或业务处理。

整页使用 `-webkit-app-region: initial`，不要替换成整页 `no-drag`：整页显式排除矩形也会扣除顶部条带。回归必须同时验证条带可真实拖动、条带下方不拖动及按钮能通过原生鼠标触发。

**本次没有改变 Mac 拖动规则。** 新条带默认 `display: none`，只有上述 Windows 展示范围启用；Mac 仍走 `.native-window-controls`，原生红绿灯与原拖动行为保留。Mac 应检查隐藏元素不改变几何、焦点或无障碍树，并实际验证原有按钮和窗口拖动。如果 Mac 用户另行要求相同的顶部条带，再在 Mac 本机适配；不能直接启用 Windows 类名或覆盖原生红绿灯。

Windows 面试窗口在分数 DPI 下，`setBounds` 的物理像素包围取整可能把请求宽度增加2 DIP，导致缩放时工具栏中心漂移。0.6.2 在 `NativePresentation` 增加可选的 `resizeInterview` 系统端口：Windows 在改变窗口前以 Electron 的 DIP/物理矩形转换预测取整，并一次性补偿请求；共用层仍保留原逻辑边界和实际读回边界，避免折叠/转写切换累计误差。Mac 未实现该可选端口，继续调用原 `setBounds`，不要复制 Windows 补偿。界面尺寸公式、比例、控制位置和原生断言上限保持。

## 3. 逐项检查

每项在终端/对话记录 `ID | 通过/修后通过/待验/不适用 | Mac 实际命令或步骤 | 断言/现象 | 首次失败、修复与复测`。Windows 结果不能记作 Mac 通过，静态检查和本机原生/目视分开。

| ID   | 本次变化或边界                                 | Mac 接续要求                                                                                                                                                            |
| ---- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C001 | 唯一版本源 0.6.2，依赖不升级。                 | 从仓库根运行同步脚本，根/shared/Mac 均为 0.6.2；Windows 全树无本机差异，锁与固定运行时保持。                                                                            |
| C002 | LoginPage 新增隐藏拖动条带。                   | Mac 条带 computed display 为 none，尺寸为零，不参与 Tab/无障碍导航，原布局保持。                                                                                        |
| C003 | Windows 顶部全宽 72px 区域可拖动。             | Mac 静态核对 Windows 类名范围；本机不启用该规则，保留原生控制区。Windows 命中数值及 C# 探针不适用 Mac。                                                                 |
| C004 | Windows 标题/表单/预览退出拖动区。             | 实际测试 Mac 的登录、注册、找回密码、获取验证码、返回登录与密码输入；不能仅以 computed CSS 判断能点击。                                                                 |
| C005 | 不改账号请求、校验、冷却和挑战用途。           | 无效邮箱不能发码；reset/register 用途区分；新挑战重发最多60秒，忙碌时互斥。只用合成邮件端口和临时账号。                                                                 |
| C006 | 无可见布局、配色、控件尺寸调整。               | 浅深色、正常/最小窗口逐项目视，核对标题/输入/按钮/页脚对齐、反馈不覆盖返回链接和页脚；原生红绿灯可用。                                                                  |
| C007 | Windows 新原生登录专项。                       | `windows/test/scripts/login-actions-native-smoke.mjs` 只读理解：五档DPI、浅深色、两种尺寸，断言原生命中、拖动、按钮、验证码用途与冷却。Mac 不执行或复制其 C# 实现。     |
| C008 | Windows 既有呈现测试改用顶部条带作为拖动目标。 | Windows 专属，不在 Mac 修改；Mac 自己使用既有原生窗口夹具验证其原行为。                                                                                                 |
| C009 | Windows 完整原生矩阵新增登录专项。             | Windows 原生组数由15变16；不要拿它替代或削减 Mac 原生矩阵。                                                                                                             |
| C010 | test-workspace 单测隔离其强杀回收对象。        | 测试子进程 TEMP/TMP/TMPDIR 位于活跃 owner 根内，防其他并发套件先回收。实际跑3个异常/取消/强杀恢复用例，保留所有断言，检查退出无残留。                                   |
| C011 | cloud-data 补文件归属与取消恢复测试。          | 合法父库接受；错误 key/身份、非法父库、personal-resume 归属拒绝。取消后保留真实原件/revision，无成功 applied 事件。                                                     |
| C012 | cloud-sync 补损坏清单/分块边界。               | 清单大小/摘要、块数/序号/实际长度/摘要分别拒绝；无错误落盘/baseline，无误删云副本。                                                                                     |
| C013 | cloud-sync 补首块缓存资源界限。                | 六文件首块缓存最多4 MiB；完成、停止、异常后释放；版本变化重新读取，最终 bytes/revision 对应新版。                                                                       |
| C014 | cloud-sync 补成功恢复后的重启分组操作。        | 重启后暂停A只影响A及其子项，B保持同步；没有重复恢复。                                                                                                                   |
| C015 | knowledge-reconcile 补队列懒读与冷却边界。     | 首项阻塞时不预读后续Blob；59,999/60,000ms边界、force、新revision、最多256条失败记录及其他文件继续执行。                                                                 |
| C016 | knowledge-reconcile 补刷新和迟到事件保护。     | refresh保留queued/current requestId，旧任务事件不能覆盖替换任务；活动替换仍只追加一次，最大活动import=1。                                                               |
| C017 | knowledge-reconcile 补全局/开库交叠检查。      | 全局扫描中新增原件后，重复窄范围检查复用并补齐该原件；ready原件不重建。                                                                                                 |
| C018 | 清理仅涉及已核对生成内容。                     | 参见清理文档；Windows缓存删除不在Mac重做，保护现用模块、原件、发行和恢复基线，不为清理数量删兼容代码或断言。                                                            |
| C019 | 0.6.1云恢复/单任务索引保留。 | Windows已实际运行两库四文件桌面夹具；Mac仍须本机复验交错列表 b-2,a-1,b-1,a-2、a2第二块屏障时a1即时索引、最终 a-1,a-2,b-2,b-1、父库正在同步、暂停重启恢复不删云。索引不阻塞下载，始终单任务。 |
| C020 | Windows 面试缩放预补偿及可选系统端口。         | 静态核对共用层可选端口和 Windows 实现；Mac 继续原 setBounds 分支。实际测试两角缩放、固定工具栏中心/顶部、转写隐藏/恢复和折叠，不能扩大原容差。                          |
| C021 | 材质比较固定动画相位及原生像素采样。 | interview-ux仅两张比较截图禁用动画；分数DPI同一8×120 CSS矩形以scale:device采样，避免CSS重采样产生伪差异，保留零差异断言。产品动画、布局、采样区域、时长和容差均未放宽；Mac先核对其实际像素比。 |
| C022 | 完整复验与最后纯文案调整分开记账。 | Windows和隔离Linux历史成绩见第7节；最后组件名称及说明仅文字核对、重建及验包，没有再跑全量。Mac已有未完成的0.6.2本机验收仍需执行；本次Mac任务不启动服务端测试矩阵或长稳。 |
| C023 | 普通账号密码校验Mac/Windows同步8–128。 | 注册及重置8–14与128成功；7/129拒绝，Unicode/NFC计数正确；旧短密码登录兼容，常见密码/原始1024限额不变。管理员仍15–128。 |
| C024 | 注册密码/重置新密码提示均为“不少于8个字符”。 | 浅深色、五档缩放、正常/最小窗口实际目视文字完整、对齐；HTML minlength8，maxlength1024保留，不能截断128个emoji。 |
| C025 | cloud-account单测及表单夹具更新边界。 | 新8–14/128接受、7/129拒绝及既有异常/取消/忙碌全部保持；原生按钮仍能点击，验证码限制不改。 |
| C026 | password-policy实际隔离API与生产界面专项。 | 注册8、重置8/14/128及错误长度不消耗挑战，校验真实哈希；动态容量250→1→默认100 MB在UI与IPC一致且无title。使用固定0.5.2只读源码参考启动owner临时服务，不编辑服务端或连生产写入。 |
| C027 | 服务端0.5.2已交付，当前接续只读。 | 全文阅读独立参考S001–S024；固定472541cc80c77439f02c45d0bf0aed913b036134，现有生产已升级0.5.2/v5。Mac不改服务端代码、测试、配置、依赖、数据库、部署或身份；不重跑后端矩阵，不迁移、不部署、不重启。接口兼容仅修客户端。 |


| ID | 后续新增/撤除 | Mac实际定向断言 |
| --- | --- | --- |
| C028 | 免费软件，删除全部支付/订单/退款/兑换/时长租约IPC与运行代码。 | 搜索运行源码无关闭/未来支付实现；Mac本机清除macos/test/scripts/ui-refinement-matrix.mjs旧cloud-quota/--interview-quota专用入口，Windows不编辑该只读文件；真实开始/结束面试不请求旧接口，不自动按时长退出。 |
| C029 | 头像使用已绑定AI工具的官方余量。 | 优先明确标注的5小时窗口，其次返回的首个可用窗口；没有5小时才按官方返回顺序回退（如周额度）。0%中性，未连接/无数据/无限量如实显示；ChatGPT/Copilot均用同一摘要函数，不虚构5小时数值。 |
| C030 | 面试开场知识库旁显示同源AI剩余用量。 | 开场读取现有官方用量缓存/刷新，不形成面试许可门槛。 |
| C031 | 云备份并入账号页，删除独立云同步导航。 | 容量条、三开关和两操作完整存在；同步/容量按钮靠右，原MB、title移除和无障碍保持。 |
| C032 | AccountDeletionPanel独立模块，入口在云备份下方。 | 登录表单不承载注销副作用；备份操作结束后以独立分割线隔开删除区；无已登录账号不显示。 |
| C033 | 简洁确认弹窗、右下操作、所有按钮图标。 | 保存/取消/删除及关闭均有平台图标；复选框和文字水平中心对齐；密码+勾选缺一不可，键盘/Esc和忙碌保护保持。 |
| C034 | 可选保存资料。 | 标题“保存资料”，说明“保存个人信息、面试记录和知识库。”；调用系统原生另存为选择ZIP路径，取消/失败不删除。 |
| C035 | 导出三个根文件夹及全部所需原件。 | 个人信息一份TXT含资料和技能来源；每场TXT含转录、问题和AI回答，有图场次另存截图ZIP；每库独立目录放原件，空库及有资料的简历库保留，同名安全去重，原字节一致。聊天会被删除，但不属于用户指定的三个导出类别。 |
| C036 | 云端完整性、导出背压及失败保护。 | 归属不符、云端新版本未恢复或摘要不符时阻止不完整导出；单次IPC最多1 MiB、原件最多20 MiB，由Main生成内部路径。仅完整ZIP成功后提交用户选择的目标；取消/失败保留旧目标，成功覆盖仅限系统弹窗已确认的目标。 |
| C037 | 注销能力握手与二次验证。 | accountDeletion必须为account-erasure-v1；POST /v1/account/delete发送当前密码及confirm:DELETE。旧0.5.1语义拒绝；密码错误保留会话，真正令牌过期仍清除。仅主窗口授权Main frame操作，面试进行中拒绝。 |
| C038 | 云端清除并保留最少注销记录。 | 账号/FK资料、密码/会话/验证码/云原件清理；后台仍有邮箱/ID/时间“已注销”，新同邮箱不继承。物理密文沿原有有界GC清理，离线灾备周期和其他设备边界如实告知。 |
| C039 | 本机清理、持久中断标记和重启重试。 | 调API前写未提交标记，服务端确认后标记已提交；先停聊天/标题/索引/同步/AI授权写入与窗口，再清浏览器存储及个人目录。符号链接/真实路径不符拒绝，失败关闭并待重启重试；保留公开模型、host-id和更新身份。 |
| C040 | 服务端付费及零时长清理已移除（只读契约）。 | 固定参考内已认证合成旧路由返回404，未认证保护可先返回401；旧零时长字段不再触发删除。容量、全局资源上限和管理员安全保护保持。Mac仅测试客户端兼容，不改后端。 |
| C041 | v5最少注销记录与快照已完成（历史事实）。 | 已交付服务端顺序迁移及快照支持见S012/S013。Mac本轮不再迁移生产或合成后端数据库、不修改快照脚本，只核对客户端与既有v5契约。 |
| C042 | 两仓源码、Windows包与服务端部署已分别完成。 | 历史成绩、当前源提交、发行和生产状态分开记录；Mac验本机窗口/权限/凭据/原生另存为/ditto/视觉与临时包。不得重复服务端工作或Windows发行恢复，不把Windows成绩记为Mac通过。 |
| C043 | 本地组件页显示名称及说明调整。 | 三项为“轻量语音识别”“多语言语音识别”“知识库检索”；配套说明分别为“支持中文和英文，资源占用较低。”“支持多种语言和标点，适合配置较高的电脑。”“从导入的资料中查找与问题相关的内容。”。分组为“语音识别组件”“知识库检索组件”，无障碍及删除目标同源。仅显示文案，模型ID、资源、设置中的模型选择及业务保持；用户明确无需为此次改名重跑全量。 |

| ID | 补充变化与接续边界 | Mac实际要求 |
| --- | --- | --- |
| C044 | 资料归档取消与退出生命周期。 | 只有archive.hasWork时退出等待dispose；普通退出/更新不额外阻塞。退出账号、删除及窗口关闭取消当前归档，重复完成/迟到分块不能复活任务或写入已注销资料。 |
| C045 | 当前导航与夹具同步免费界面。 | 设置严格六类：VoxCue账号、AI服务、本地组件、面试设置、个性化、关于与更新；删除旧云同步导航与付费IPC入口，保持正常同步调用和忙碌断言。interview-usage仍是AI/输入行为测试，不可误删。 |
| C046 | 几何与显示夹具保持原断言。 | 开场卡片原两列、8项、顺序和原生窗口尺寸检查只替换时长标签为AI余量；登录、面试缩放与材料像素修复的首次失败/重测见第7节，Mac用自己的原生路径验收。 |
| C047 | 完整0.6.1之后文件审计。 | 第4节覆盖8887590→41179a9全部78路径；f05c8ea之后子集75项，另3项为0.6.1历史交接文档。App未用Button/X导入已删，移除功能无消费者才删，不删除仍服务免费功能的代码。 |
| C048 | 已完成发行、草稿恢复及文案重建。 | Windows0.6.2三项公开，17个既有draft已恢复，历史109资产和16模型资产不变；Latest仍Mac0.6.1，按平台选版Windows0.6.2/Mac0.6.1。本轮Mac不重复恢复/上传/改Latest。 |
| C049 | Mac当前只做客户端接续，服务端固定只读。 | S001–S024是理解接口的历史清单，不能作为后端待办。只允许使用未改动的固定参考服务于客户端隔离联调；后端问题记录并等额外授权，不能修改参考副本来换客户端通过。 |
| C050 | Mac原生保存与系统ZIP不能由模拟端口代验。 | 当前account-erasure-smoke在非Windows会替换showSaveDialog；它的通过只代表界面/导出/联调。Mac须在客户端补原生NSSavePanel取消、选址、中文名、已有目标确认，以及系统ditto实包断言，数据仍限owner临时目录。 |

## 4. 完整客户端文件差异：78项

固定范围`8887590..41179a9`共78条，状态M=修改、A=新增、D=删除。此前75项只覆盖`f05c8ea..41179a9`；补入的CLIENT_0.6.1_HANDOFF、WINDOWS_0.6.1_HANDOFF、WINDOWS_0.6.1_CODEX_PROMPT三项仅为历史文档。后续本次交接修订不增加产品源码差异。清单包含Windows专属变化供理解，**不授权Mac修改这些文件**；macos/及依赖锁在该Windows产品范围无变更。

| 路径 | 状态 | 具体变化与对应项目 |
| --- | --- | --- |
| `AGENTS.md` | M | C049：最新Mac接续边界；服务端固定只读，历史部署授权不延续。 |
| `PROGRESS.md` | M | C022/C048：区分历史改动、最后纯文案、已发行与本机待验。 |
| `README.md` | M | C048：当前免费能力、0.6.2 Windows下载及Mac0.6.1 Latest说明。 |
| `package.json` | M | C001：根分发清单生成版本0.6.2，不在Mac手改。 |
| `shared/docs/CLIENT_0.6.1_HANDOFF.md` | M | C047：0.6.1后续交接/发行补记，无新产品逻辑。 |
| `shared/docs/MACOS_0.6.2_CODEX_PROMPT.md` | A | C049：可直接交给Mac Codex的逐项提示词及只读服务端禁令。 |
| `shared/docs/MACOS_0.6.2_HANDOFF.md` | A | 本交接：全部变更、平台边界、文件清单和Mac验收步骤。 |
| `shared/docs/SERVER_0.5.1_REFERENCE.md` | M | S001–S024：保留0.5.1历史参考，指向已交付0.5.2只读事实。 |
| `shared/docs/SERVER_0.5.2_HANDOFF.md` | A | S001–S024：服务端逐条变化与57文件历史差异；不授权服务端工作。 |
| `shared/docs/WINDOWS_0.6.1_CODEX_PROMPT.md` | A | C047：f05c8ea新增的Windows0.6.1逐项提示词，Mac仅参考。 |
| `shared/docs/WINDOWS_0.6.1_HANDOFF.md` | A | C047：f05c8ea新增C001–C040/V001–V012历史交接，勿混淆本页ID。 |
| `shared/docs/WORKSPACE_CLEANUP.md` | M | C018：删除候选须核对消费者/真实路径/占用，保护历史恢复基线。 |
| `shared/electron/backend/accountArchive.ts` | A | C035/C036/C044/C050：Main生成安全目录、分块接收、截图归档、系统ZIP与原子提交。 |
| `shared/electron/backend/accountErasure.ts` | A | C039：白名单个人目录清理及重定向拒绝，保留模型与固定身份。 |
| `shared/electron/backend/cloud/client.ts` | M | C023/C037：8–128校验、account-erasure-v1握手；错误密码不误退出。 |
| `shared/electron/backend/cloud/lease.ts` | D | C028：删除面试计时租约、心跳、到期及付费许可实现。 |
| `shared/electron/contracts/accountData.ts` | A | C036：新增begin/base/file/chunk/end/finish/cancel有界导出契约。 |
| `shared/electron/contracts/cloudAccount.ts` | M | C023/C037：普通密码常量与删除账号请求契约。 |
| `shared/electron/contracts/cloudUsage.ts` | D | C028：删除平台面试时长/付费额度契约。 |
| `shared/electron/contracts/desktop.ts` | M | C028/C036：移除cloudUsage和到期事件，增加accountData端口。 |
| `shared/electron/contracts/interviewLayout.ts` | M | C028：删除计时提示层对窗口尺寸的参数影响，正常尺寸公式保留。 |
| `shared/electron/main.ts` | M | C020/C028/C037/C039/C044：可选缩放端口、移除租约、导出IPC、注销生命周期及退出保护。 |
| `shared/electron/preload.ts` | M | C028/C036：删除计时/到期暴露，只增加受限accountData桥接。 |
| `shared/electron/presentation.ts` | M | C020：NativePresentation增加可选resizeInterview，Mac保留原分支。 |
| `shared/package.json` | M | C001：唯一版本源0.6.2；依赖、SDK及Codex版本不变。 |
| `shared/src/App.tsx` | M | C028/C018：删除旧面试到期弹层/状态及两个无用导入。 |
| `shared/src/components/AccountDeletionPanel.tsx` | A | C032–C034：独立注销确认、可选保存资料、密码/勾选及忙碌保护。 |
| `shared/src/components/CloudAccountPanel.tsx` | M | C023/C024：注册/重置普通密码提示和输入边界同步8–128。 |
| `shared/src/components/CloudUsagePanel.tsx` | D | C028：删除面试额度/兑换入口及专属界面。 |
| `shared/src/components/ComponentsPanel.tsx` | M | C043：三名称、三说明、两分组及无障碍/删除目标同源改名。 |
| `shared/src/components/FloatingInterview.tsx` | M | C028：删除剩余时长、临期提示及过期结束监听。 |
| `shared/src/components/InterviewUsageNotice.tsx` | D | C028：删除计时提醒组件。 |
| `shared/src/components/LoginPage.tsx` | M | C002–C006：增加默认隐藏的Windows顶部拖动条，不改变Mac拖动规则。 |
| `shared/src/components/PreparationPage.tsx` | M | C028/C030：开场摘要改用官方AI剩余用量，删除时长准入门槛。 |
| `shared/src/components/SettingsDialog.tsx` | M | C031/C032：六类导航；账号页内整合云备份和下方注销入口。 |
| `shared/src/components/Sidebar.tsx` | M | C029：头像下显示当前已绑定AI工具官方余量，0%中性。 |
| `shared/src/services/accountExport.ts` | A | C034–C036：核对归属/云完整性，生成三类资料并逐MiB发送。 |
| `shared/src/services/accountUsageSummary.ts` | A | C029/C030：明确5小时优先、周额度回退及无数据/不限量文案。 |
| `shared/src/stores/cloudAccount.ts` | M | C037：加入delete操作和退出/重入状态处理。 |
| `shared/src/stores/cloudSync.ts` | M | C036/C039：导出及注销时停止同步消费者，提供保存的同步状态读取。 |
| `shared/src/stores/cloudUsage.ts` | D | C028：删除平台面试计时/兑换状态仓库。 |
| `shared/src/styles.css` | M | C003/C028/C031–C033：Windows拖动范围、移除计时样式、右侧按钮/分割线/勾选对齐。 |
| `shared/test/README.md` | M | C022/C045：当前专项与完整矩阵、免费/注销边界及人工缺项。 |
| `shared/test/fixtures/install-primary-account.cjs` | M | C028：合成主账号夹具移除收费/时长能力，保留认证边界。 |
| `shared/test/scripts/account-erasure-smoke.mjs` | A | C034–C039/C050：合成API+产品UI、取消/保存/删除/重启；Mac系统弹窗仍需原生补验。 |
| `shared/test/scripts/cloud-account-smoke.mjs` | M | C023/C028/C045：新密码边界、六类导航、实际剩余IPC守卫及旧端口缺席断言。 |
| `shared/test/scripts/cloud-protocol-smoke.mjs` | M | C028：移除已删除计时接口的调用，协议/鉴权/畸形包保护保持。 |
| `shared/test/scripts/components-ui-smoke.mjs` | M | C043：仅同步组件页名称定位；设置里的具体模型名称断言保留。 |
| `shared/test/scripts/free-service-smoke.mjs` | A | C028–C030：无付费调用、5小时/0%/周回退、无计费的面试开始结束。 |
| `shared/test/scripts/functional-suite.mjs` | M | C022：增加密码/注销/免费专项，删除interview-quota专用项。 |
| `shared/test/scripts/interview-quota-checks.mjs` | D | C028：删除已撤除的面试计费专用夹具。 |
| `shared/test/scripts/interview-ux-smoke.mjs` | M | C021/C028：移除计时提示参数；材质比较禁动画并读原生像素，保留零差断言。 |
| `shared/test/scripts/management-scrollbar-checks.mjs` | M | C031：去除独立云分类/付费内容的测量，保留当前账号备份和滚动边界。 |
| `shared/test/scripts/password-policy-smoke.mjs` | A | C026：本地固定服务端参考+真实客户端UI验证密码和容量，不连接真实账号。 |
| `shared/test/scripts/server-connection-smoke.mjs` | M | C049：读取固定线上能力，支持已上线free 0.5.2契约和合成无效会话处理。 |
| `shared/test/scripts/settings-smoke.mjs` | M | C045：精确六分类，并在账号区域断言云备份/同步/刷新/注销与几何。 |
| `shared/test/scripts/typography-smoke.mjs` | M | C045：浅深/窄窗读取当前六分类，云备份在账号页。 |
| `shared/test/unit/account-archive.test.ts` | A | C035/C036/C044：归档结构、分块/路径/取消/失败原子性及清理。 |
| `shared/test/unit/account-usage-summary.test.ts` | A | C029/C030：5小时优先、0%有效、未知/不限量和服务名称。 |
| `shared/test/unit/cloud-account.test.ts` | M | C023/C037：8–128密码、删除能力及invalid_credentials/令牌过期区分。 |
| `shared/test/unit/cloud-data.test.ts` | M | C011：错误归属、非法父级、取消及真实revision保持。 |
| `shared/test/unit/cloud-lease.test.ts` | D | C028：删除已撤除租约的专用单测。 |
| `shared/test/unit/cloud-sync.test.ts` | M | C012–C014：坏清单/分块、首块缓存、恢复重启和父库状态。 |
| `shared/test/unit/cloud-usage-store.test.ts` | D | C028：删除已撤除面试时长仓库的专用单测。 |
| `shared/test/unit/desktop-ipc.test.ts` | M | C028/C036：新导出端口与已删计时端口/事件契约。 |
| `shared/test/unit/interview-layout.test.ts` | M | C020/C028：移除计时提示尺寸分支，保留窗口几何覆盖。 |
| `shared/test/unit/interview-usage-notice.test.ts` | D | C028：删除已撤除计时提醒组件的专用单测。 |
| `shared/test/unit/knowledge-reconcile.test.ts` | M | C015–C017：懒读、冷却、替换/迟到事件、刷新/扫描合并和单任务。 |
| `shared/test/unit/test-workspace.test.ts` | M | C010：异常/取消/强杀回收在活跃owner子树隔离。 |
| `windows/electron/presentation.ts` | M | C020：Windows DIP/物理像素取整预补偿；Mac禁止复制此算法。 |
| `windows/package.json` | M | C001：Windows生成版本0.6.2，Mac只读。 |
| `windows/test/fixtures/WindowProbe.cs` | M | C007：Windows原生命中/真实拖动与系统保存弹窗的隔离探针。 |
| `windows/test/scripts/components-check.mjs` | M | C043：Windows组件分组和删除目标名称定位；模型错误边界保留。 |
| `windows/test/scripts/interview-access-smoke.mjs` | M | C045：六类导航，既有权限/内容行为覆盖保持。 |
| `windows/test/scripts/interview-layout-smoke.mjs` | M | C030/C046：摘要配对AI余量，八行/两列/缩放断言保持。 |
| `windows/test/scripts/login-actions-native-smoke.mjs` | A | C007：五DPI×浅深×正常/最小窗口，真实按钮和拖动行为。 |
| `windows/test/scripts/presentation-native-smoke.mjs` | M | C008：拖动命中使用新顶部条带，其余原生行为保持。 |
| `windows/test/scripts/windows-suite.mjs` | M | C009：Windows原生矩阵纳入登录专项；Mac不执行。 |

## 5. 需要保持的产品、接口和资料结构

本地组件页的最终文案如下，名称与说明都要同步；只改变展示及其测试定位，不改变真实组件、下载资源、模型ID、设置下拉框具体型号或删除目标。

| 分组 | 名称 | 说明 |
| --- | --- | --- |
| 语音识别组件 | 轻量语音识别 | 支持中文和英文，资源占用较低。 |
| 语音识别组件 | 多语言语音识别 | 支持多种语言和标点，适合配置较高的电脑。 |
| 知识库检索组件 | 知识库检索 | 从导入的资料中查找与问题相关的内容。 |

普通注册/重置密码按NFC后Unicode码点计8–128；两处placeholder准确为“不少于8个字符”，HTML minlength=8且原始maxlength=1024，允许128个emoji。旧短密码登录、弱密码检查、验证码用途、限流和重发保护保持；管理员15–128。备份容量默认100 MB（十进制1 MB=1,000,000字节，仍受全局上限），客户端读取服务端返回值，不能固定写100 MB；管理员已可按用户调整，Mac只消费接口。

头像和开场卡片复用`accountUsageSummary`，优先明确的“5小时额度”窗口，没有则按官方返回顺序选择首个可用窗口；没有数值不推算，0%不标红。免费使用不等于外部AI工具无限额，官方用量、认证与真实失败反馈继续保留。

账号页内部顺序为已登录账号 → 云备份容量及三开关 → 右侧“立即同步/刷新容量” → **独立分割线** → 删除账号。删除弹窗：精简后果、可选“保存资料”/“保存个人信息、面试记录和知识库。”、当前密码、勾选确认、右下取消/删除。关闭、保存、取消、删除均有平台图标；复选框与文字垂直居中。Esc、焦点、忙碌互斥和无障碍保持。

保存调用Main的系统另存为（默认“VoxCue资料.zip”），Renderer不提供任意路径；取消和失败都不触发删除。ZIP最少具有以下三根目录，中文名、空目录及原始字节实际解包验证：

```text
个人信息/
  个人信息.txt                 # 全部个人资料及技能来源
面试记录/
  每场独立名称.txt             # 时间、转录、提问、AI回答
  有截图的每场独立名称.zip      # 本场截图原件，按归档ID读取
知识库/
  每个知识库独立文件夹/
    该库储存的原始文件
```

个人简历资料库有文件时也导出，不漏空知识库。聊天清理但不在用户指定三种导出类别内；凭据、令牌、缓存、索引不导出。重名和非法路径由Main安全命名，禁止穿越、软链接或Renderer任意文件读写。云端有未恢复项或新版原件/哈希不完整时先提示恢复，不能导出成功却悄悄漏资料。分页每页最多50，重复cursor有界；文件最大20 MiB，IPC单块最大1 MiB，顺序写入，有界内存；任务绑定WebContents与当前用户，退出/注销取消并清临时文件。仅完整ZIP完成后提交用户选择的路径，保留取消/失败前的旧目标。

注销前能力握手`accountDeletion: account-erasure-v1`，`POST /v1/account/delete`提交当前密码与`confirm: 'DELETE'`。错误密码不登出；登录令牌确实过期才清会话。成功响应`{deleted:true, cloudCleanup:'queued'}`表示账号/FK数据和云元信息已删除、物理密文进入有界GC，不能等同所有离线副本即时擦除。后台仅留ID、邮箱、注册/注销时间并显示“已注销”；再次注册同邮箱创建新ID、不能继承旧数据。

客户端先落盘中断标记，再请求服务端；成功后停写/关消费者，清当前账号资料、聊天、记录/截图、知识库原件、浏览器存储和本机账号/AI会话。白名单个人目录包括cloud-account、knowledge-v1、interview-images-v1、chat-usage、chatgpt-usage、copilot-runtime及账号凭据文件；公用模型、host-id和更新身份保留。已提交标记重启先续清理再开放旧资料；占用/真实路径不符不能伪称删除完成。用户另存文件、其他设备已下载副本、外部AI账号与离线灾备不属本机即时清除，弹窗应准确说明。

## 6. Mac执行顺序与实际命令

先读AGENTS、本文、服务端固定只读参考、`shared/docs/BACKPRESSURE.md`；检查当前分支/远端/未提交工作并保留。以下Git命令只读；同步远端时正常fetch/合并并解决已知改动，不强制回退。

```sh
git status --short
git branch --show-current
git remote -v
git log --oneline --decorate -8
git diff --name-status 88875908574d445d43a40f3eeb63013dcb31fb4b 41179a9879dc767f61de5b3fad326b409a492d3c
node shared/scripts/sync-platform-manifests.mjs
pnpm --dir macos install --frozen-lockfile
pnpm --dir macos typecheck
pnpm --dir macos check:architecture
pnpm --dir macos check:workspace
pnpm --dir macos test
pnpm --dir macos build
```

不要在根执行依赖安装；根是命令分发器。锁漂移、缺签名身份或缺固定原生组件须查明并准确待验，不能更新依赖或创建替代签名身份来通过。三套类型由typecheck串行执行；生成Mac配置后核对Windows全树及锁无变化。

在`macos/`中先做定向（下面两条单测分别覆盖0.6.1兼容和0.6.2新增），发现客户端问题最小修复后重跑受影响项：

```sh
pnpm exec vitest run --config ../shared/vitest.config.mjs ../shared/test/unit/cloud-data.test.ts ../shared/test/unit/cloud-sync.test.ts ../shared/test/unit/cloud-sync-store.test.ts ../shared/test/unit/cloud-storage-summary.test.tsx ../shared/test/unit/knowledge-index-store.test.ts ../shared/test/unit/knowledge-reconcile.test.ts
pnpm exec vitest run --config ../shared/vitest.config.mjs ../shared/test/unit/account-archive.test.ts ../shared/test/unit/account-usage-summary.test.ts ../shared/test/unit/cloud-account.test.ts ../shared/test/unit/desktop-ipc.test.ts ../shared/test/unit/interview-layout.test.ts ../shared/test/unit/test-workspace.test.ts
node ../shared/test/scripts/password-policy-smoke.mjs
node ../shared/test/scripts/free-service-smoke.mjs
node ../shared/test/scripts/account-erasure-smoke.mjs
node ../shared/test/scripts/knowledge-smoke.mjs
node ../shared/test/scripts/cloud-account-smoke.mjs --scrollbars
```

**参考服务端准备：** 上述部分客户端专项直接从`shared/server/src/`导入固定后端（没有可用的VOXCUE_TEST_SERVER_ROOT替代变量）。先只读检查本机参考与472541c一致；若缺失，使用独立仓库固定提交的受控源码建立忽略参考，不覆盖不明已有内容，不复制.env、.state、数据库、私钥、node_modules、构建或Windows锁/二进制。参考源码保持原样，依赖解析不通过修改后端清单解决；缺环境准确记录。夹具自行在owner临时目录创建合成数据库/配置参数、内存邮件和自有loopback，这是客户端隔离联调；不是授权修改/迁移既有服务端库、运行服务端套件或操作生产。没有固定参考时先完成不依赖它的检查，不伪造联调通过。

**已知Mac测试接续点：** 当前`macos/test/scripts/ui-refinement-matrix.mjs`仍有cloud-quota/--interview-quota旧条目，Mac本机先最小替换为免费服务及账号注销等有效专项，保留其他场景、五档、断言和时限；不能因旧付费场景不存在而直接删掉整组UI覆盖。`interview-usage`是保留的AI/输入用量专项，不要误删。当前`account-erasure-smoke.mjs`非Windows分支模拟了showSaveDialog；继续补客户端Mac原生NSSavePanel和ditto专项，不能把该脚本通过记为原生保存已通过。

随后在`macos/`串行完成本机客户端验收：

```sh
node ../shared/test/scripts/functional-suite.mjs
node test/scripts/ui-refinement-matrix.mjs
node test/scripts/cloud-form-lifecycle-smoke.mjs
node test/scripts/cloud-native-vault-smoke.mjs
node test/scripts/cloud-accessibility-smoke.mjs --preview
pnpm audit --json
node test/scripts/package-temporary-smoke.mjs
```

默认功能选择当前为52个shared+15个Mac组，共67组，package另验；数字是入口选择，不能预填通过。核对实际输出，覆盖聊天/技能资料、知识库/RAG、面试/截图记录、合成账号/AI授权、组件、更新、安全/对抗、20轮场次和600秒合成语音。五档为100/125/150/175/200%，浅深色、正常/最小窗口、滚动/焦点/按钮/图标/文字逐项目视。窗口缩放/折叠/工具栏位置沿Mac原路径，原生红绿灯和SF Symbols实际呈现。Keychain原生专项只用显式临时Keychain；mock UI结果和真实系统凭据结果分开。

临时包入口把App/DMG/固定签名ZIP/manifest放owner临时根，验最终ASAR、实际解包SDK/Codex、架构/最低系统、固定代码/更新签名、摘要及更新下载后取消；不替换Applications真实安装，不公开上传。锁屏返回pending不能算通过。若客户端产品源码修复，相关定向后重新执行本机完整客户端回归与最终临时包；只有本次交接文字或最后组件文案修改时不为此再重复全量。**禁止追加服务端完整测试、1800秒长稳、后台构建、迁移、部署或重启。**

## 7. 已完成成绩、首次失败与Mac待验

以下是Windows维护时已经完成的历史结果，最后纯文案另列；不是本次写文档重新运行，更不是Mac成绩。

| 对象 | 已完成验证与限制 |
| --- | --- |
| Windows客户端基础 | frozen安装、三套类型、架构/工作区检查无违规、完整单测98文件1003通过及2项Windows平台跳过；构建677模块。实际数量对应当时输出，不作为Mac硬编码门槛。 |
| 云/索引兼容 | 命令A六文件56项，生产界面两库四文件/a2屏障/a1即时索引/规定顺序；取消恢复、归属、缓存、冷却、并发与单任务背压。 |
| Windows完整矩阵 | shared功能52、Windows原生16、DPI14×5=70组；20轮场次，600秒合成音频final208/interim1451、最大队列608 ms、errors为空；依赖审计无漏洞。 |
| 视觉与新增专项 | 353张基础截图及100张新增功能截图；密码/免费化/注销五档15组、真实Windows保存弹窗；仅owner合成资料。 |
| 原生与临时包 | portable/native、隔离NSIS及最终ASAR；三语言安装/卸载UI检查；固定公开Qwen1.0.1 CPU/CUDA Worker、六次切换/释放/删除。Mac和物理采样不在这些成绩内。 |
| 独立后端历史成绩 | 18文件101用例：Windows95通过/6个Linux专属待对应平台，隔离Linux101通过；两套类型、后台构建和QR；128 MiB压力、1800秒/16actor长稳、后台角色及视觉。详见S001–S024只读参考，不在Mac重跑。 |
| 发布与上线 | 两源码仓已正常推送；服务端0.5.2/v5已在既有部署就绪；Windows0.6.2三项匿名完整下载及实际NsisUpdater下载/SHA512验证。17旧草稿恢复，原资产和模型保持，Latest未改。 |
| 最后组件纯文案 | 59c3f02包含最终名称、说明及定位；按用户要求没有再次全量，只核对八项准确文字、重建、最终ASAR/安装器完整性及线上下载。41179a9仅更新文档链接。 |

| 首次失败/边界 | 修复与实际复测方式 |
| --- | --- |
| 登录找回/发码DOM可点但原生拖动命中吞点击 | 顶部72px独立Windows拖动条，五档×浅深×两尺寸原生点击、命中和拖动复测；Mac规则未改。 |
| 分数DPI面试窗口请求宽度被物理取整增加、中心漂移 | Windows可选resizeInterview端口预补偿；原严格窗口几何、折叠/转写和DPI回归，未扩大容差。 |
| 不透明弹层截图受动画相位及CSS像素重采样影响 | 固定两张采样动画相位，原区域改原生像素采样；诊断6000通道差异归零，原零差异断言及产品动画保持。 |
| test-workspace强杀对象被另一测试owner提前回收 | 子进程TEMP/TMP/TMPDIR绑定活跃owner，原异常/取消/强杀恢复断言复测。 |
| 旧设置七导航/付费时长定位与免费界面不符 | 更新到六导航和同源AI用量，保留正常行为、几何、限额断言；最后组件纯文案定位不声称又运行。 |
| Windows桌面被锁/屏保/外部鼠标输入 | 保护正确停止、没有放宽断言；用户恢复桌面后按原设置串行重跑对应组。 |
| Mac原生保存、ditto、窗口、SF Symbols、凭据与视觉 | Windows没有代验；按C050和第6节在Mac本机补验，现阶段均不得预记通过。 |

物理音频/热插拔、真实主账号及AI OAuth、操作系统辅助功能/多屏、真实安装迁移/真实凭据继续是人工或额外授权边界（Windows历史V004/V007/V010/V011），不能用合成或Chromium模拟覆盖替代。

## 8. 接续输出与停止边界

每条C001–C050记录：ID、通过/修后通过/待验/不适用、Mac实际命令或步骤、主要行为断言、首次失败、修复和复测。Windows专属项写静态理解/本机不适用；S001–S024写只读理解及关联客户端联调状态，不能写成重新通过了服务端测试。区分静态、共用逻辑、Mac原生、UI目视和人工边界，不以源码存在或函数被调用代替行为断言。

结束说明版本、两端固定比较范围、完成/待验ID、客户端实际测试/首次失败、修复文件、Mac生成配置/锁是否变化、只读后端未改、清理保留物与人工事项。提交推送仅审计客户端源码/测试/配置/文档，保留远端，不强推；模型、包、日志、数据库、截图和凭据不入Git。服务端0.5.2始终只读；Mac公开包上传、Latest或其他生产/发行动作须新的明确授权。
