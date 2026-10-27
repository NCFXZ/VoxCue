# 交给 Mac Codex 的完整提示词：VoxCue 0.6.0

以下正文可整体复制到Mac端Codex；请从客户端仓库本交接所在提交接续。

---

你现在负责VoxCue **Mac客户端0.6.0** 的逐项核对、服务端协议适配、问题修复和最终验收。请直接完成工作，不要只给方案；遇到问题先在客户端解决并复测，确实缺权限/硬件/身份时继续独立工作，把阻塞列清。保留本机已有修改及远端他人提交，不使用强制覆盖。

先完整读取：

1. `AGENTS.md`。
2. `shared/docs/MACOS_0.6.0_HANDOFF.md`：**C001–C140全部逐条验证**。
3. `shared/docs/CLIENT_0.6.0_FILE_AUDIT.md`：全部文件和diff hunk逐条核对，不能遗漏测试、依赖、图标或清理。
4. `shared/docs/SERVER_0.5.1_REFERENCE.md`：服务端仅供只读理解。
5. `shared/docs/MACOS_0.5.11_VERIFICATION.md`及相关0.5.11交接：保留Mac已经完成的加载动画和官方按需续期修复。

### 最高优先级边界：绝对不要修改服务端

**服务端已是0.5.1且已完成其测试，本任务禁止修改任何服务端代码。**服务端独立仓库是`NCFXZ/VoxCue-server`，只读固定提交`43b6a973849bdc3c204d8434a21857b943048758`。禁止更改它的源码、测试、README、配置、package/lock、Docker、Nginx、systemd、数据库结构或实际数据；禁止部署、重启生产服务、调整邮件/DNS/云权限、创建管理员、修改支付开关或购买COS。不要把服务器代码上传到VoxCue客户端仓库或打进App。

Windows/Mac共用现有`https://accounts.voxcue.com.cn`。客户端版本0.6.0与服务端0.5.1是独立版本号。接口不匹配时，**只允许修改客户端的shared契约、主进程传输/凭据/状态、Mac必要承载及客户端测试**；不能改服务端使测试变绿，不能删断言、放宽配额/认证/计时保护或伪造成功。

客户端基线：Windows0.5.11为`0c86881c732e87f80bade27e055da950b672914b`，Mac最新0.5.11为`2af9c78c3e05b3daf303130c3e6dace61ab5734f`。本轮已保留并合并后者。请以Mac基线比较当前提交，不能恢复旧Mac loading实现或丢掉新续期/loopback沙箱测试。版本唯一源为`shared/package.json`，目标保持0.6.0。

### 第一阶段：建立实际本机基线

- 记录当前客户端Git提交、工作区改动、Node/pnpm/架构/macOS、已有开发签名宿主/凭据助手身份及依赖锁。不读取真实Keychain内容或用户资料。
- shared/server不存在时才准备独立只读副本；存在则先核对固定提交及干净状态，绝不覆盖已有内容。它已在客户端.gitignore排除。记录服务端前后Git状态/文件blob，结束时必须完全一致。
- 本地客户端集成测试可以直接加载这份只读server/src，用新的临时SQLite、内存邮件/outbox和自有loopback端口；这是允许的合成测试，不是服务端开发。不得在服务器目录安装依赖、构建admin、运行迁移/部署/owner invite或生产压测。
- Node宿主满足`>=24.19.0 <25`，pnpm固定11.25.0。shared/和仓库根不装node_modules；只能在本机macos/更新其必要依赖。
- Windows目录、Windows生成清单/锁、Win32探针及NSIS只读。布局、按钮、业务和协议仍唯一实现于shared；Mac保留原生红绿灯、音频/权限/凭据/窗口生命周期/快捷键/更新等必要系统集成。

### 第二阶段：同步Mac构建与安全补丁

- shared已固定Electron44.10.0、Vitest4.1.12及Zod/Undici/fast-uri补丁；Mac的`package.platform.json`仍有Packager19.0.1，改为20.3.0。
- `macos/scripts/package-app.mjs`仍硬编码Electron38.8.6，改为读取实际安装版本，避免代码升级而最终包仍带旧Electron。保留原签名、entitlements、薄包、运行时解包和SDK拷贝边界。
- 在仓库根运行`node shared/scripts/sync-platform-manifests.mjs`，只生成本平台与根入口；按已确认精确版本更新Mac锁/依赖，再用frozen-lockfile验证。不要复制Windows锁，不回退安全版本，不扩大成任意依赖升级。
- 重建现有签名开发宿主、凭据助手/原生绑定、SF Symbols，实际验证Electron44.10.0、arm64、macOS14.2基线。缺原签名身份就列阻塞，不轮换身份、不ad-hoc替代。
- 固定Copilot SDK/平台运行时1.0.21、Codex0.164.0、模型/索引/RAG v7、代码/凭据助手证书和Sparkle Ed25519身份全部保留。

### 第三阶段：先逐条测试C001–C140，再修客户端

为每个C编号回填：`通过/修复后通过/阻塞待验/不适用 | 实际命令或操作 | 实测证据 | 修复文件 | 定向复测 | 未覆盖边界`。不得合并成一个“全部通过”，不得只看截图或只跑构建。

重点必须包括：

- 主账号邮箱注册/登录/重置、15–128个Unicode码点/NFC/空格中文符号、旧密码登录兼容、验证码挑战/频控及垃圾邮件提示、三表单顶部排版且无滚动条、错误固定区、凭据说明固定左下。
- 主账号与ChatGPT/Copilot独立授权/退出、无AI不假造模型；系统加密云会话、原子写入、origin隔离、401清理、切账号迟到丢弃、主frame/窗口IPC保护、正式包无demo入口。
- 三类同步默认关闭和独立开关、所有者绑定、原件/截图恢复、VCS1包和分块/整体SHA校验、断线/丢确认续传、revision冲突、云删除保本地、整库及新子文件暂停、取消只留已完成副本，点击“自动同步”才恢复。
- **总量100MB**且profile仍计量但可突破：满额更新JD至101MB可成功；删除大库回到100MB后，history/knowledgebase不能新增，profile仍可。不得排除profile、不改服务端配额。
- 一个worker/一块在途/一次合并重跑、个人信息分块间优先、知识库按整库顺序、750ms去抖/60秒轮询、删除有界优先槽、取消后重启不自动上传、Retry-After和请求/响应边界。
- 云图标、同尺寸圆形按钮、文件右侧同步位置、记录标题标志、可点击的紧凑浮层；同步中只有带图标的“取消同步”；设置默认账号及既定顺序；顶部MB容量实时限频更新、两个独立操作按钮。
- 激活码兑换有限/永久时长、永久null余额、刷新/跨账号结果；15分钟红色阈值、确认页知识库旁时长、5分钟提示和60/59/1秒、单调时钟/15秒心跳/迟到拒绝、到期IPC阻止、尾段和空记录保存、写盘失败保留重试、保存后退出及主窗结果。
- 0.5.1后台新增账号停用403/account_disabled路径与现有/v1兼容；当前泛化错误若不够准确，只补客户端受限代码映射和状态处理。管理后台TOTP、管理员Cookie、运维及订单不是桌面新增功能，支付一直关闭。
- SF Symbols云状态与既有12段loading、Windows旋转和Mac扫亮分离、真实像素变化/减少动态效果；Mac截图Control+S（⌃S）、Alt+S不误触发、IME/额外修饰/重复/弹层/数量上限保护。
- 主侧栏/个人信息开合文字稳定、最小窗不裁切；记录/知识库/个人信息/回答栏/设置/面试设置全部固定标题、网页模糊与滚动条轨道互相避让，首尾内容可读；资料提示卡原字号与居中。

用户最后撤回了登录右侧预览重排，**不要重新设计InterviewPreview**，只保持既有edge-to-edge背景及已确认布局。不恢复被删除的介绍文案、登录设备UI、可编辑上传上限、支付说明或旧重复版本行。

### 第四阶段：客户端全量、对抗、安全与UI视觉对齐

逐条修复并定向复测后，再运行完整矩阵：

```sh
# 以下在macos/，先满足本机依赖、原生宿主和只读服务端副本
pnpm typecheck
pnpm test
pnpm check:architecture
pnpm check:workspace
pnpm audit
pnpm build
node ../shared/test/scripts/cloud-account-smoke.mjs --login-check
node ../shared/test/scripts/cloud-account-smoke.mjs
node ../shared/test/scripts/cloud-account-smoke.mjs --interview-quota
node ../shared/test/scripts/cloud-account-smoke.mjs --scrollbars
node ../shared/test/scripts/functional-suite.mjs
node test/scripts/ui-refinement-matrix.mjs
```

同步检查前后端noUnusedLocals、架构依赖和构建/包内容。默认functional-suite当前是49个shared组+15个Mac组=64组，另有package单独验收；清单变化重新统计。现有Mac UI矩阵仅5档×6组=30项，必须补新主账号/云同步/额度/浮层/固定标题/最小窗等场景，不能用30项代表全部新增UI。所有GUI与原生串行，不一边下载/推理一边跑另一个窗口的定时像素检查。

做有意义的对抗与稳定性测试：坏/超大输入、跨账号/跨origin/迟到、刷新竞争、网络超时/断线/429/503、损坏包/路径遍历/错误ID、双端冲突、取消/删除/写入竞争、配额和保留边界、单租约/墙钟回拨/迟到心跳/余额用尽、磁盘失败、重复结束、快速开合、键盘焦点/IME/滚动首尾。至少20轮面试及10分钟真实固定公开音频ASR，观察队列/内存/进程释放；Mac Qwen/Metal与Windows CUDA分开报告，不变更RAG模型或调公开题求满分。

实际浅深色、最小/常规/宽窗、100/125/150/175/200%应用缩放、高字号、减少动态/透明度及高对比下目视核对。Mac物理Retina/多屏结果与应用模拟缩放区分，不能外推。不要降低像素、圆角、位置或权限断言，不能跳过真实窗口/凭据/更新验证来换全绿。

### 第五阶段：最终Mac包、清理、交付

- 验临时Mac App/DMG/签名ZIP/更新清单，核对0.6.0、实际Electron44.10.0、arm64/macOS14.2、签名/entitlements、固定SDK/Codex真实解包路径、Ed25519/SHA512与更新选版、用户原件保留及退出恢复。检查包内没有服务端、admin、测试、模型原件、数据库、报告或凭据。
- 只清理确认无消费者且精确路径/无重定向/无占用的本轮临时内容，保护模型/索引、所有正式发行、恢复基线及历史跳过目录。不要照搬Windows353文件清理列表到Mac。
- 结束前核对服务端固定提交/文件及Git状态与开始完全一致。支付保持关闭，生产服务不动，0.5.11/历史发行和Latest不动，不替换用户真实安装。
- 交付140条逐项记录、全部改动文件/hunk检查、失败根因/客户端修复及复测、完整测试/对抗/安全/UI/验包数字、真实账号/权限/硬件/签名等未覆盖清单。Windows之前的950项/49组/15原生/70DPI不是Mac验收；合并远端后WindowsGUI因锁屏未补跑，也不能写成已通过。
- 将审计后的**客户端**修复和Mac验收文档同步既有私有`NCFXZ/VoxCue`，先保留远端新增提交，不强推。只允许逐项白名单源码/测试/配置/文档，排除shared/server、模型、包、构建/测试产物和任何真实资料/凭据。**不得提交或推送VoxCue-server。**本提示不授权公开发行安装包或操作生产服务。

最终答复清楚说明完成项、实际测试证据、必要的客户端修复、源码提交及仍需人工处理的事项，不把缺环境的步骤写成已完成。
