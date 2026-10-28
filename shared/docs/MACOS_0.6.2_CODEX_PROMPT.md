# 给 Mac Codex 的完整提示词：VoxCue 0.6.1 → 0.6.2

以下内容可整段复制到Mac本机Codex。

---

请在Mac本机接续VoxCue客户端0.6.2，按最小修改、模块解耦、保持正常功能与既定UI的原则逐项检查、修复并复测。**当前只接续客户端。不要动服务端代码。服务端0.5.2已经交付并部署，固定472541cc80c77439f02c45d0bf0aed913b036134，只读；独立仓库和shared/server/参考都不能改。禁止修改服务端源码、测试、配置、依赖、锁、数据库、部署、管理员、邮件/DNS/云权限/支付和身份；禁止迁移、部署、重启或写生产，也不要在Mac重新执行后端全量、后台构建或1800秒长稳。历史授权与历史部署记录不等于当前授权。接口不兼容只修客户端，后端问题保留证据待新授权。**

先全文阅读：

1. `AGENTS.md`当前约定，最上方Mac交接/服务端只读范围优先。
2. `shared/docs/MACOS_0.6.2_HANDOFF.md`全部C001–C050及完整78路径清单，不跳项。
3. `shared/docs/SERVER_0.5.2_HANDOFF.md`全部S001–S024和57路径历史清单；只理解变化与接口，不能转成服务端修改/测试任务。
4. `shared/docs/BACKPRESSURE.md`，以及0.6.1历史交接/白名单。旧文档的同名C/V编号须注明版本，不混用。

比较与现状：

- 客户端0.6.1产品基线`88875908574d445d43a40f3eeb63013dcb31fb4b`，当前产品/维护清单终点`41179a9879dc767f61de5b3fad326b409a492d3c`。`f05c8ea3ecc4e7836a92b9a2f0973ebae188f271`仅追加0.6.1文档/发行交接，不能算新产品逻辑；0.6.2实现为6e6ed50，清理/夹具/最终组件文案为59c3f02，41179a9及后续本提示词提交只改文档。
- 从8887590完整比较78路径；仅从f05c8ea比较是75路径，另3份为历史0.6.1交接文档。检查当前分支、远端、未提交工作，保留后续远端提交和本机工作，不reset、不强推。早于0.6.1时先保留后续Mac0.6.0修复，不能撤回或当0.6.2新增。
- 客户端0.6.2，独立服务端0.5.2；后端0.5.1历史基线`43b6a973849bdc3c204d8434a21857b943048758`到只读472541c的差异只是已完成功能说明，不能回退后端。
- Windows0.6.2三项已公开，17个现存旧draft已恢复，原109资产及16个模型资产不变；Latest仍Mac0.6.1。Windows实际选到0.6.2，Mac仍选到其完整0.6.1。现有腾讯云服务已0.5.2/schema5。本轮不再次恢复草稿/部署/改Latest，也不自动上传Mac0.6.2包或替换真实安装。

逐条保持以下变化与边界：

1. 登录顶部72 CSS px拖动条与找回密码/验证码原生点击修复属于0.6.2，**只在Windows.custom-window-controls启用**。Mac条带隐藏，保留原生红绿灯、原拖动和setBounds路径；不要复制Windows C#探针或分数DPI预补偿。Mac实际验登录/注册/找回/发码/冷却与原窗口拖动。
2. 0.6.1云恢复/索引是既有功能：先校验归属、逐库下载，父库下载中显示正在同步；完整原件一落盘即排索引且不阻塞下载。始终单索引任务，优先当前库已收到待办，无待办可转其他库，不等尚未收到文件。启动/RAG就绪检查全部，开库仅当前库，补缺失/停用，正常索引不重建。去重、刷新/扫描合并、执行时读新bytes、删除跳过、落盘revision冷却、暂停首次恢复/重启不删云全部保持。
3. 普通密码NFC后8–128码点，两处提示准确“不少于8个字符”；minlength8，原始maxlength1024，128 emoji不能被截断。旧短密码登录、弱密码/验证码/限流/冷却保护保持；管理员仍15–128。
4. 软件免费：支付、订单、退款、兑换码、赠时、永久时长、面试计费会话/租约及零时长30天删云已从客户端和服务端移除，包括关闭开关和未来收费代码。不要恢复任何付费UI/实现，不删除免费业务仍需要的认证/备份/限频/容量保护。
5. 保留外部AI官方用量，头像及面试开场知识库旁用同源摘要；优先明确标记5小时窗口，没有才按官方顺序回退，0%中性，不伪造剩余量、不把它作面试许可。ChatGPT/Copilot、未知/未连接/无限额均准确处理。
6. 设置六类：VoxCue账号、AI服务、本地组件、面试设置、个性化、关于与更新。云备份整块并入账号下方，保留容量条/图例MB、三个同步开关、无原生title与无障碍；立即同步/刷新容量靠右。服务端已有每用户备份空间设置，客户端读取真实容量，不能写死100 MB。
7. 删除账号区在云备份最下方，与上方操作用独立分割线隔开。精简确认弹窗，底部按钮靠右，关闭/保存/取消/删除都有平台图标，勾选与文字居中对齐；当前密码+勾选缺一不可，忙碌/Esc/焦点和面试中拒绝保护保持。
8. 可选导出标题“保存资料”，说明“保存个人信息、面试记录和知识库。”。用系统另存为让用户选ZIP路径，取消/失败不删账号。三个根目录：个人信息一份TXT；每场面试TXT含转录/提问/AI回答，有图场次另一个截图ZIP；每个知识库一个目录放原件，空库及有文件的简历库也保留。聊天会被删除，但不在用户指定的三个导出类别内；不导出凭据/令牌/索引。
9. 云项未完整恢复、归属/版本/摘要不符时不能成功导出不完整资料。单IPC块至多1 MiB、原件至多20 MiB，顺序落盘；Main绑定用户/WebContents、生成安全内部路径，不开放任意路径/字节写入。仅完整ZIP提交系统已确认的目标，取消/失败保护旧文件；实际解包校验中文名/重名/原字节和目录结构。
10. 注销只接受新能力account-erasure-v1；POST /v1/account/delete发送当前密码及confirm:'DELETE'。错误密码保留登录，真正过期令牌按原认证流程。后端已清账号/FK信息、密码/会话/挑战/邮件、云元信息并排物理密文GC；只保留邮箱/ID/注册与注销时间，后台显示已注销。同邮箱新注册不能继承旧资料。
11. 客户端持久标记并清本机个人资料/聊天/记录截图/原件/账号及AI缓存，先停同步/索引/聊天/授权消费者再清理；服务器成功后中断须重启续清，路径/占用失败不能假报完成。公用模型、host-id和更新身份保留。外部AI账户、用户另存资料、其他设备已下载副本和离线灾备不属即时删除范围。
12. 本地组件页名称和说明必须同时按最终表：轻量语音识别—“支持中文和英文，资源占用较低。”；多语言语音识别—“支持多种语言和标点，适合配置较高的电脑。”；知识库检索—“从导入的资料中查找与问题相关的内容。”。分组“语音识别组件”“知识库检索组件”。仅显示文案，模型ID/资源/设置中具体型号保持。最后这次纯文案用户明确不用重复全量；Windows只核对文字并重建最终包，不能声称又跑全量。Mac原有未完成的本机0.6.2验收仍需完成。

版本唯一源shared/package.json已0.6.2；Windows维护没有改macos/package.json，仍0.6.1是预期。仓库根执行：

```sh
git status --short
git branch --show-current
git remote -v
git log --oneline --decorate -8
node shared/scripts/sync-platform-manifests.mjs
pnpm --dir macos install --frozen-lockfile
pnpm --dir macos typecheck
pnpm --dir macos check:architecture
pnpm --dir macos check:workspace
pnpm --dir macos test
pnpm --dir macos build
```

只生成根/Mac配置；Windows全树只读，不复制Windows锁或原生产物，不在根安装依赖。固定SDK/runtime1.0.21、Codex0.164.0、依赖/锁、模型、索引/RAG v7、macOS14.2/arm64、SF Symbols、原生红绿灯、代码/凭据助手/Ed25519身份保持；缺身份或环境如实待验，不创建新身份、不更新依赖换通过。

随后在macos/先做交接第6节两组定向单测，再串行执行：

```sh
node ../shared/test/scripts/password-policy-smoke.mjs
node ../shared/test/scripts/free-service-smoke.mjs
node ../shared/test/scripts/account-erasure-smoke.mjs
node ../shared/test/scripts/knowledge-smoke.mjs
node ../shared/test/scripts/cloud-account-smoke.mjs --scrollbars
node ../shared/test/scripts/functional-suite.mjs
node test/scripts/ui-refinement-matrix.mjs
node test/scripts/cloud-form-lifecycle-smoke.mjs
node test/scripts/cloud-native-vault-smoke.mjs
node test/scripts/cloud-accessibility-smoke.mjs --preview
pnpm audit --json
node test/scripts/package-temporary-smoke.mjs
```

注意两个已知接续点，先最小修客户端测试再运行受影响矩阵：

- macos/test/scripts/ui-refinement-matrix.mjs仍有旧cloud-quota/--interview-quota入口，应在Mac最小替换为免费服务/注销有效覆盖，保留原其他场景、五档、断言/时限。interview-usage仍用于AI/输入行为，不能误删。默认功能52shared+15Mac=67只是选择组数，按实际输出统计。
- account-erasure-smoke在非Windows会模拟showSaveDialog；通过不等于Mac原生另存为通过。必须补客户端原生NSSavePanel的取消/选择/中文名/已有目标确认和系统ditto最终ZIP验证；不复制Windows探针。普通UI用mock Keychain，真实系统凭据仅显式临时Keychain，不能混记。

部分客户端专项硬编码引用shared/server/src，不支持VOXCUE_TEST_SERVER_ROOT替换。只读核对本机参考为472541c；缺失时从独立固定提交准备原样受控参考，不覆盖不明已有工作，不复制.env/.state/真实数据库/私钥/node_modules/构建或Windows锁/二进制。参考不入客户端Git/包；依赖缺项如实处理，不能改后端清单/锁。客户端夹具仅在owner临时目录起合成DB、内存邮件及自有loopback，不触碰现有后端数据库或生产；绝不可修改参考后端来让客户端通过。

知识库实际两库四文件夹具必须断言交错云列表b-2,a-1,b-1,a-2；a2第二块屏障时a1已索引；最终a-1,a-2,b-2,b-1，下载与索引互不阻塞、始终单任务。不能以源码存在/调用过函数代替行为证据。覆盖全部客户端功能、安全/对抗/背压、20轮面试、600秒合成音频、浅深/五档100/125/150/175/200%视觉与临时App/DMG/签名ZIP/manifest；实际窗口/原生/图标/权限、最终解包SDK/Codex路径、架构/最低系统与固定签名需Mac验证。产品源码修复后受影响定向、本机完整客户端回归及最终临时包重测；不扩大容差、不禁用失败用例、不缩时长/限额、不全局长sleep、不改产品UI换通过。

GUI/原生仅当前用户已登录解锁控制台串行，锁屏/外部输入/未知会话停止。只用owner合成账号/资料/图片/捕获及固定公开临时模型/音频，不读真实账户/凭据/资料、不物理采样。普通UI禁正式凭据助手。系统保存也限合成owner路径，临时包不替换真实安装；真实AI OAuth、物理设备/热插拔、OS辅助功能/多屏和真实安装迁移缺条件准确待验。

每条C001–C050输出ID、通过/修后通过/待验/不适用、实际Mac命令或步骤、主要行为断言、首次失败、修复/复测；S001–S024只读理解并映射客户端联调，不写成后端重测通过。静态、共用逻辑、Mac原生、UI目视和人工边界分开，Windows/Linux成绩不能算Mac通过。结果仅终端/对话，不新增工作区测试报告；模型/profile/数据库/ZIP/截图/临时包退出清理，清理先验证消费者、真实路径/占用，保留历史跳过目录、发行和恢复基线。

完成后列版本、固定比较基线、逐项完成/待验ID、实际客户端测试、修复文件、Mac生成配置/锁是否变化和人工事项。上传限已审计客户端源码/测试/配置/交接到既有私有main，保留远端且不强推，包/模型/产物/凭据不进源码。Mac安装包公开上传/Latest/其他发行操作需新授权。

**最后再次确认：服务端0.5.2已完成，固定472541c始终只读。本次不要改服务端代码，不推服务端，不迁移、不部署、不重启、不写生产。**
