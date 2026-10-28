# VoxCue 0.6.1 → 0.6.2：客户端更新与 Mac 接续

本交接描述客户端0.6.2，并分开列出独立服务端0.5.2的接续边界。0.6.1 产品基线为 `88875908574d445d43a40f3eeb63013dcb31fb4b`；私有仓库后续交接基线为 `f05c8ea3ecc4e7836a92b9a2f0973ebae188f271`，其中只增加文档和 Mac 发行说明。获取包含本文的后续提交即可获得本次 0.6.2 源码，不能回退后续远端提交或已有本机工作。

顶部拖动区域与登录按钮修复属于 **0.6.2**。云端逐库恢复、落盘即索引、单任务按库优先、启动/开库补索引及容量条无 title 属于 **0.6.1 既有行为**；本次只为其中一些边界补充测试，不把它们重新列为 0.6.2 新功能。旧交接保留在 [Windows 0.6.1 逐项交接](WINDOWS_0.6.1_HANDOFF.md)及[客户端 0.6.1 白名单](CLIENT_0.6.1_HANDOFF.md)。

用户后续授权免费化和账号注销/可选资料导出，Mac/Windows同步；最新明确只做受影响定向测试，不做全量。下文C001–C027保留原细分归属，涉及执行完整矩阵的旧文字以本段覆盖。服务端允许源码0.5.2修改及推送，仍不允许生产操作。注销保留用户最新允许的最少邮箱/ID/时间记录。

## 1. 授权和保护范围

- 唯一版本源为 `shared/package.json`，本次更新为 `0.6.2`。Windows 只生成根与 `windows/` 配置；`macos/package.json` 留在 0.6.1 是平台只读规则的预期结果，Mac 须自己同步生成配置。
- 本次只推送逐文件核对的源码、测试、配置和交接到既有私有 `NCFXZ/VoxCue/main`。不发布 Windows/Mac 0.6.2，不修改 Latest、旧发行、旧草稿、模型资产或用户真实安装。上传安装包需要新的明确授权。
- Mac 上 `windows/` 全树只读，包括锁、原生产物、配置、测试和缓存。不要复制 Windows 锁或二进制，不从 Mac 运行 Windows C# 鼠标探针。
- 固定 SDK/平台运行时 1.0.21、Codex 0.164.0、依赖/锁、模型、索引格式和 RAG v7 保持；Mac 原生红绿灯、SF Symbols、macOS 14.2/arm64，以及代码签名、凭据助手和 Ed25519 更新身份保持。
- 用户另行授权独立服务端0.5.2的普通密码8–128、每用户备份空间设置、隔离定向测试及源码上传；其基线仍为43b6a973849bdc3c204d8434a21857b943048758，详见[独立接续](SERVER_0.5.2_HANDOFF.md)。不部署、不重启、不写生产、不操作真实管理员/邮件/DNS/云权限/支付；依赖与锁保持。`shared/server/`仅是忽略测试参考，不进入客户端Git或安装包。Mac先获取已交付的服务端0.5.2源码，不自行部署。
- GUI/原生串行，须当前用户已登录且解锁的控制台。仅 owner 临时目录内的合成账号/资料/图片/捕获和固定公开临时模型/音频，不读真实凭据/原件、不采样物理音频；普通 UI 夹具禁止正式凭据助手。缺机器、真实账号、硬件或授权的项明确待验。
- 结果仅终端/对话，不把测试报告、截图、日志、模型、profile、数据库、安装包或凭据保存进工作区。临时资源退出清理；清理先核对消费者、精确真实路径和占用，保护发行、恢复基线及历史跳过目录。

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
| C019 | 0.6.1云恢复/单任务索引保留。                   | 原逐库下载、a2屏障及索引顺序是0.6.1兼容边界；本轮只跑受影响共用定向，完整桌面夹具延期并如实待验。                                                         |
| C020 | Windows 面试缩放预补偿及可选系统端口。         | 静态核对共用层可选端口和 Windows 实现；Mac 继续原 setBounds 分支。实际测试两角缩放、固定工具栏中心/顶部、转写隐藏/恢复和折叠，不能扩大原容差。                          |
| C021 | 不透明设置弹层比较固定动画相位。               | `interview-ux-smoke.mjs`只在两张材质比较截图使用animations disabled，避免调色板恢复后的标题边线过渡混入比较；采样位置和零差异断言保持，实际产品动画及其他动画断言不改。 |
| C022 | 原完整矩阵/临时包要求本轮延期。 | 用户最新取消全量，仅执行受影响定向、类型/架构及构建；完整矩阵、600秒音频、1800秒服务端长稳和临时包需新授权后再做，不拿旧成绩替代。 |
| C023 | 普通账号密码校验Mac/Windows同步8–128。 | 注册及重置8–14与128成功；7/129拒绝，Unicode/NFC计数正确；旧短密码登录兼容，常见密码/原始1024限额不变。管理员仍15–128。 |
| C024 | 注册密码/重置新密码提示均为“不少于8个字符”。 | 浅深色、五档缩放、正常/最小窗口实际目视文字完整、对齐；HTML minlength8，maxlength1024保留，不能截断128个emoji。 |
| C025 | cloud-account单测及表单夹具更新边界。 | 新8–14/128接受、7/129拒绝及既有异常/取消/忙碌全部保持；原生按钮仍能点击，验证码限制不改。 |
| C026 | password-policy真实隔离API与产品界面专项。 | 注册8、重置8/14/128及错误长度不消耗挑战，哈希真实校验；动态容量250→1→默认100 MB在UI与IPC一致，无title回归。该项纳入共享专项；本轮不运行默认全量。 |
| C027 | 独立服务端0.5.2接续及生产边界。 | 阅读S001–S014；从独立仓库获取源码，在忽略参考内隔离测试。普通密码实际8–14上线依赖另行部署；客户端/服务端版本分开，不把Windows或本地成绩当作Mac/生产通过。 |


| ID | 后续新增/撤除 | Mac实际定向断言 |
| --- | --- | --- |
| C028 | 免费软件，删除全部支付/订单/退款/兑换/时长租约IPC与运行代码。 | 搜索运行源码无关闭/未来支付实现；Mac本机清除macos/test/scripts/ui-refinement-matrix.mjs旧cloud-quota/--interview-quota专用入口，Windows不编辑该只读文件；真实开始/结束面试不请求旧接口，不自动按时长退出。 |
| C029 | 头像使用当前AI官方余量。 | 明确5小时优先，0%保留中性颜色；无5小时才回退周窗口，无数据/未连接如实显示；ChatGPT/Copilot都适配。 |
| C030 | 面试开场知识库旁显示同源AI剩余用量。 | 开场读取现有官方用量缓存/刷新，不形成面试许可门槛。 |
| C031 | 云备份并入账号页，删除独立云同步导航。 | 容量条、三开关和两操作完整存在；同步/容量按钮靠右，原MB、title移除和无障碍保持。 |
| C032 | AccountDeletionPanel独立模块，入口在备份最下方。 | 登录表单不承载注销副作用，备份操作后才出现删除入口；无真实账号时不显示。 |
| C033 | 简洁确认弹窗、右下操作、所有按钮图标。 | 保存/取消/删除及关闭均有平台图标；复选框和文字水平中心对齐；密码+勾选缺一不可，键盘/Esc和忙碌保护保持。 |
| C034 | 可选保存资料。 | 标题“保存资料”，说明“保存个人信息、面试记录和知识库。”；调用系统原生另存为选择ZIP路径，取消/失败不删除。 |
| C035 | 导出三个根文件夹。 | 个人信息TXT；每场转录TXT和有图场次的独立截图ZIP；每库独立目录含原件，空库目录保留，同名安全去重，原字节一致。 |
| C036 | 云端完整性和分块背压。 | 归属不符或未恢复云项阻止不完整导出；每次IPC至多1MiB、文件至多原有20MiB，顺序落盘，路径由Main生成；失败不覆盖已有ZIP。 |
| C037 | 注销服务能力握手及二次验证。 | 旧0.5.1不支持明确新语义时拒绝；密码错误保留主账号登录，真令牌过期仍清除；仅授权Main frame操作。 |
| C038 | 云端清除并保留最少注销记录。 | 账号/FK资料、密码/会话/验证码/云原件清理；后台仍有邮箱/ID/时间“已注销”，新同邮箱不继承。物理密文沿原有有界GC清理，离线灾备周期和其他设备边界如实告知。 |
| C039 | 本机清理及中断重试。 | 先停聊天/标题/索引/同步写入和AI授权消费者，再清浏览器存储及已知个人目录；保留公开模型、host-id/更新身份；确认后的中断重启继续清理。 |
| C040 | 服务端全部付费与零时长清理移除。 | 旧路由404、旧数据库零时长字段不再触发删除；容量及全局资源限制、管理员安全保护继续有效。 |
| C041 | v5最少注销记录及快照。 | 从v1–v4顺序迁移，新增closed_accounts；快照恢复含容量和注销记录，未来v6拒绝；只合成库，不迁移生产。 |
| C042 | 定向测试、清理及源码分开交付。 | 仅本次受影响检查；Mac真实窗口/凭据/另存为/视觉独立补验，不把Windows成绩外推。不发行，不改Latest；测试产物不入Git。 |

## 4. 本次客户端文件白名单

以下仅源码、测试、配置与交接。产品比较从8887590（0.6.1实现）开始，交付增量从f05c8ea开始；0.6.1云恢复/索引本身不得记作新增。macos/和全部依赖锁无Windows改动；shared/server/为忽略参考，不入此清单。

本次白名单共68项（含明确删除）。

| 路径 | 状态/用途 |
| --- | --- |
| `AGENTS.md` | 授权/更新/接续文档 |
| `PROGRESS.md` | 授权/更新/接续文档 |
| `README.md` | 授权/更新/接续文档 |
| `package.json` | 当前产品源码或生成版本配置 |
| `shared/docs/MACOS_0.6.2_CODEX_PROMPT.md` | 授权/更新/接续文档 |
| `shared/docs/MACOS_0.6.2_HANDOFF.md` | 授权/更新/接续文档 |
| `shared/docs/SERVER_0.5.1_REFERENCE.md` | 授权/更新/接续文档 |
| `shared/docs/SERVER_0.5.2_HANDOFF.md` | 授权/更新/接续文档 |
| `shared/docs/WORKSPACE_CLEANUP.md` | 授权/更新/接续文档 |
| `shared/electron/backend/accountArchive.ts` | 当前产品源码或生成版本配置 |
| `shared/electron/backend/accountErasure.ts` | 当前产品源码或生成版本配置 |
| `shared/electron/backend/cloud/client.ts` | 当前产品源码或生成版本配置 |
| `shared/electron/backend/cloud/lease.ts` | 删除：已移除功能的专用实现或测试 |
| `shared/electron/contracts/accountData.ts` | 当前产品源码或生成版本配置 |
| `shared/electron/contracts/cloudAccount.ts` | 当前产品源码或生成版本配置 |
| `shared/electron/contracts/cloudUsage.ts` | 删除：已移除功能的专用实现或测试 |
| `shared/electron/contracts/desktop.ts` | 当前产品源码或生成版本配置 |
| `shared/electron/contracts/interviewLayout.ts` | 当前产品源码或生成版本配置 |
| `shared/electron/main.ts` | 当前产品源码或生成版本配置 |
| `shared/electron/preload.ts` | 当前产品源码或生成版本配置 |
| `shared/electron/presentation.ts` | 当前产品源码或生成版本配置 |
| `shared/package.json` | 当前产品源码或生成版本配置 |
| `shared/src/App.tsx` | 当前产品源码或生成版本配置 |
| `shared/src/components/AccountDeletionPanel.tsx` | 当前产品源码或生成版本配置 |
| `shared/src/components/CloudAccountPanel.tsx` | 当前产品源码或生成版本配置 |
| `shared/src/components/CloudUsagePanel.tsx` | 删除：已移除功能的专用实现或测试 |
| `shared/src/components/FloatingInterview.tsx` | 当前产品源码或生成版本配置 |
| `shared/src/components/InterviewUsageNotice.tsx` | 删除：已移除功能的专用实现或测试 |
| `shared/src/components/LoginPage.tsx` | 当前产品源码或生成版本配置 |
| `shared/src/components/PreparationPage.tsx` | 当前产品源码或生成版本配置 |
| `shared/src/components/SettingsDialog.tsx` | 当前产品源码或生成版本配置 |
| `shared/src/components/Sidebar.tsx` | 当前产品源码或生成版本配置 |
| `shared/src/services/accountExport.ts` | 当前产品源码或生成版本配置 |
| `shared/src/services/accountUsageSummary.ts` | 当前产品源码或生成版本配置 |
| `shared/src/stores/cloudAccount.ts` | 当前产品源码或生成版本配置 |
| `shared/src/stores/cloudSync.ts` | 当前产品源码或生成版本配置 |
| `shared/src/stores/cloudUsage.ts` | 删除：已移除功能的专用实现或测试 |
| `shared/src/styles.css` | 当前产品源码或生成版本配置 |
| `shared/test/README.md` | 受影响行为/边界夹具 |
| `shared/test/fixtures/install-primary-account.cjs` | 受影响行为/边界夹具 |
| `shared/test/scripts/account-erasure-smoke.mjs` | 受影响行为/边界夹具 |
| `shared/test/scripts/cloud-account-smoke.mjs` | 受影响行为/边界夹具 |
| `shared/test/scripts/cloud-protocol-smoke.mjs` | 受影响行为/边界夹具 |
| `shared/test/scripts/free-service-smoke.mjs` | 受影响行为/边界夹具 |
| `shared/test/scripts/functional-suite.mjs` | 受影响行为/边界夹具 |
| `shared/test/scripts/interview-quota-checks.mjs` | 删除：已移除功能的专用实现或测试 |
| `shared/test/scripts/interview-ux-smoke.mjs` | 受影响行为/边界夹具 |
| `shared/test/scripts/management-scrollbar-checks.mjs` | 受影响行为/边界夹具 |
| `shared/test/scripts/server-connection-smoke.mjs` | 只读核对线上旧0.5.1或隔离免费0.5.2的准确接口契约，保留严格认证及无写入边界。 |
| `shared/test/scripts/password-policy-smoke.mjs` | 受影响行为/边界夹具 |
| `shared/test/unit/account-archive.test.ts` | 受影响行为/边界夹具 |
| `shared/test/unit/account-usage-summary.test.ts` | 受影响行为/边界夹具 |
| `shared/test/unit/cloud-account.test.ts` | 受影响行为/边界夹具 |
| `shared/test/unit/cloud-data.test.ts` | 受影响行为/边界夹具 |
| `shared/test/unit/cloud-lease.test.ts` | 删除：已移除功能的专用实现或测试 |
| `shared/test/unit/cloud-sync.test.ts` | 受影响行为/边界夹具 |
| `shared/test/unit/cloud-usage-store.test.ts` | 删除：已移除功能的专用实现或测试 |
| `shared/test/unit/desktop-ipc.test.ts` | 受影响行为/边界夹具 |
| `shared/test/unit/interview-layout.test.ts` | 受影响行为/边界夹具 |
| `shared/test/unit/interview-usage-notice.test.ts` | 删除：已移除功能的专用实现或测试 |
| `shared/test/unit/knowledge-reconcile.test.ts` | 受影响行为/边界夹具 |
| `shared/test/unit/test-workspace.test.ts` | 受影响行为/边界夹具 |
| `windows/electron/presentation.ts` | 当前产品源码或生成版本配置 |
| `windows/package.json` | 当前产品源码或生成版本配置 |
| `windows/test/fixtures/WindowProbe.cs` | 受影响行为/边界夹具 |
| `windows/test/scripts/login-actions-native-smoke.mjs` | 受影响行为/边界夹具 |
| `windows/test/scripts/presentation-native-smoke.mjs` | 受影响行为/边界夹具 |
| `windows/test/scripts/windows-suite.mjs` | 受影响行为/边界夹具 |

## 5. Mac接续命令与边界

先保留远端与未提交工作，阅读AGENTS、本文全部C001–C042及BACKPRESSURE。从仓库根运行node shared/scripts/sync-platform-manifests.mjs，只生成根/Mac，Windows只读。使用原锁frozen安装，运行pnpm run typecheck、pnpm run check:architecture、pnpm run build:shared及本文有关的单测/专项。系统ZIP用Mac自带ditto，须实际核对三目录及中文文件名；不得复制Windows压缩/原生UI探针。

服务端需从独立私有仓库获取0.5.2，再同步受控测试参考，不复制依赖、锁、产物或真实配置。线上0.5.1仍未部署新规则；真实注销、管理员容量与8–14密码上线属于另行授权边界。

本轮不执行默认全量、600秒/1800秒长稳或临时包。真实AI账号、系统授权撤销、物理音频和Mac本机视觉/原生无法由Windows代验。逐项在终端/对话记录ID、状态、实际步骤、断言、首次失败、修复复测。结果不写工作区报告；临时ZIP/模型/截图/profile退出清理。源码上传不授权发行、Latest、生产或真实安装操作。

独立服务端已交付源码提交：`859eee114e9dcf7b20ac45cc476cff89e203fdb4`（0.5.2）；只接续源码，不执行生产部署。
