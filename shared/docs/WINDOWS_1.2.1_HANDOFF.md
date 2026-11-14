# Windows 1.2.0 → 1.2.1 更新与逐项验收交接

日期：2026-11-12。本文保留当时交给 Windows 的共享变更清单；未发布 Mac 开发快照不是当前升级、恢复或测试基线。下列表格属于历史接续条件，当前范围见根 PROGRESS.md 与 [Windows 1.2.3](WINDOWS_1.2.3_RELEASE.md)，Mac 验证不能代验 Windows。

## 基线与交付

- Windows 1.2.0 源码基线：`v1.2.0`／`0bc1cd4261c56598a6341adfb11aca99913e9cf9`。
- 历史 Mac 开发快照为 [`10ac04be`](https://github.com/NCFXZ/VoxCue/tree/10ac04be0c9edffc37854a2849acb6c79df21c64) 与 [`64f61050`](https://github.com/NCFXZ/VoxCue/tree/64f61050a7f37848a153e6ed90ab6ddd009d3778)，仅用于核对源码差异，不列为正式发行或恢复入口。
- 原 [Windows 1.2.0 发行](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.0)及其标签、资产保留。发布状态以 PROGRESS.md 为准，本文不主张发布或恢复 Mac 中间版本。
- [Mac 历史快照差异](https://github.com/NCFXZ/VoxCue/compare/10ac04be0c9edffc37854a2849acb6c79df21c64...64f61050a7f37848a153e6ed90ab6ddd009d3778)和[相对 Windows 1.2.0 的历史差异](https://github.com/NCFXZ/VoxCue/compare/0bc1cd4261c56598a6341adfb11aca99913e9cf9...64f61050a7f37848a153e6ed90ab6ddd009d3778)保留当时共享修改的可追溯性。

接续先读根 `AGENTS.md`、`PROGRESS.md` 并检查 status／diff。直接使用 main，保留后续工作；Windows 上 `macos/` 全树只读。版本唯一来源是 `shared/package.json`，不手改两平台版本、升级依赖／模型、轮换身份或迁移真实资料。

## Windows 开始前必须处理

| 编号 | 状态 | 操作与通过条件 |
| --- | --- | --- |
| W001 | [ ] | **同步本机版本。** 共享版本已为 1.2.1，Mac 没有改 `windows/package.json`。在 Windows 执行根 `pnpm sync:workspace`，核对根／Windows 清单和冻结依赖；现有 Store 公式应映射为 `2.2.1.0`，必须本机核对，不能视为已构建／已提交 Store。根和 shared 不安装 node_modules。 |
| W002 | [ ] | **补语音 utility 的 ASAR 单文件展开。** `windows/scripts/package-portable.mjs` 当前仍只有 `unpackDir`。核对本机 ASAR API 后增加 `unpack: '**/dist-electron/shared/electron/backend/cancellable.js'`；不能把单文件写进 unpackDir 后只看文件名存在。用最终包验证该条目标记 unpacked、物理文件存在，且 `speech/process → Windows controller → shared controller → ../cancellable` 在物理 unpacked 树中可解析和运行。自动重启关闭也会加载这个依赖。 |
| W003 | [ ] | **安全适配离线 named-pipe 缺席探测。** `shared/test/scripts/interview-usage-offline.mjs` 当前 Windows 分支仅允许本进程注册的精确组件 pipe。deadLease／关闭后缺席探测还需 Windows 本机适配；保留不可用端点的真实失败语义及他进程／未拥有端点拒绝。不能恢复仅凭 `voxcue-component-` 前缀放行，也不能通过禁用网络守卫使 full 入口通过。 |
| W004 | [ ] | **保持 Windows 自动恢复能力的真实状态。** Windows adapter 当前没有启用 `automaticRestart`，Wasapi failure 回调仍只有单参数；本次共享修改不等于 Windows 已自动重连。保留现有手动恢复并验证失败提示。若另行决定启用，先补错误分类、stderr 排空、真实 close 及未退出禁止替换的适配，再按 S004–S007 验证，不能只加开关。 |

## 共享行为及本轮测试发现的修复

| 编号 | 状态 | 更新／修复与 Windows 逐条验收 |
| --- | --- | --- |
| S001 | [ ] | **超出预卷范围的未接纳短音不残留词状态。** 旧 Paraformer 将所有静音／短音持续送入识别流，即使 VAD 没接纳也可能残留词状态。`shared/electron/backend/speech/engine.ts` 改为 idle 只保存有界历史，VAD 接纳时建立新流，送入 500ms／8000 个 16kHz 样本历史及当前帧。Windows 先选取实际未被本机 VAD 接纳的固定合成负例；若 SAPI 短音被接纳，不能强判无 VAD。确认负例无 VAD／segment，间隔至少 3.2 秒静音后播放固定问题，下一句须与 fresh 引擎原文一致。最近 500ms 历史及当前帧仍会送入新流，本项不保证预卷范围内的未接纳声音永不成为前文。 |
| S002 | [ ] | **保留首音节和尾稿。** 初版 250ms 历史在实际晚确认场景裁掉“请”，本轮据此改为 500ms。测试“请介绍……”开头、自然静音终稿、暂停／停止尾包、双来源隔离及实际处理 ACK；不降低 VAD 门槛、不缩短既有 1s 逻辑静音分句与 1800ms 自动回答边界，不扩大积压预算。 |
| S003 | [ ] | **清理旧识别状态。** 移除 idle 持续 decode／10 秒 silentReset 分支；终稿释放流并清空历史，inactive 的 flush 不创建或解码识别流。验证静音、软静音、gap、取消、模型切换和长时间空闲无重复／幻觉终稿；新增 `speech-engine-preroll.test.ts`，端点夹具删除废弃字段。 |
| S004 | [ ] | **共享恢复生命周期。** `shared/electron/backend/speech/controller.ts` 增加可取消恢复归属和启动等待；仅启用该能力的 adapter 生效。验证旧任务迟到、初始化取消、模型切换、重复停止／关闭，不得覆盖新会话状态或产生重复 final。 |
| S005 | [ ] | **真实退出围栏。** 旧采集实际 close 与 Worker 实际 exit 都确认后才允许替换；发出 kill、kill 返回值、exit 但未 close 均不足以证明采集释放。验证迟到 close、信号失败、未退休 watchdog 和资源占用；未确认释放时不能重开第二采集。Windows 先验证原手动恢复路径满足本机语义。 |
| S006 | [ ] | **自动恢复规则仅供能力启用后验收。** Mac adapter 使用 1／2／4 秒退避、最多连续三次；稳定运行 30 秒且有近期真实 ACK 才补预算。启动失败、权限／设备／模型语义错误和单独歧义 EPIPE 不重试。Windows 当前应仍显示明确失败；将来启用须逐项覆盖分类和预算，不能把“始终重试”当作自动恢复。 |
| S007 | [ ] | **手动操作和不完整音频。** 暂停、停止、关闭、切换在退避或加载期间取消恢复；间断／不完整片段不自动回答。验证快速耗尽后 footer、恢复卡和手动重连按钮归属一致，旧错误和 ACK 不回写；共享单测包含 controller→store 的真实事件联动。 |
| S008 | [ ] | **英文恢复文案。** `shared/electron/contracts/uiMessages.ts` 增加重连、取消、失败／耗尽、音频间断和不支持布局等译文；`language-smoke.mjs` 增加英文窄窗场景。测试英文／中文、浅深主题、窄浮窗、按钮可访问名称、占位参数及换行；有译文不代表 Windows 原生支持该功能。 |
| S009 | [ ] | **修复恢复卡遮挡设备状态提示。** 人工视觉发现真实重叠；共享 `webMaterials.css` 的浮窗 header 层级统一高于 recovery。测试五档缩放、两主题、恢复卡显示／淡出、键盘和鼠标：既有设备状态提示文字完整且覆盖恢复卡，不遮挡正常按钮交互，不新增悬停提示。 |
| S010 | [ ] | **层级回归使用实际命中。** `interview-ux-smoke.mjs` 现在先真实 hover，再检查提示与恢复卡有实际交叠，并以 elementFromPoint 验证交叠区命中提示。临时 pointer-events 在 finally 恢复；旧样式能触发断言。Windows 须核对原生命中／穿透，不能只比较 z-index 数值。 |
| S011 | [ ] | **UI 夹具焦点修复。** Mac 的 showInactive 浮窗未成为 keyWindow，导致单次 hover 无反馈；夹具复用既有 `focusUiWindow`，保留原等待和断言，失败时给有界指针诊断。Windows helper 为 no-op，本机验证自己的前台窗口和原生命中，不复制 AppKit 或添加循环移动绕过断言。 |
| S012 | [ ] | **截图专项增强，产品截图路径保持。** 新 `screenshot-worker-checks.cjs` 复用实际生产 Worker，覆盖连续编码、非法输入、取消、加载失败、真实期限、实际退出和内存收敛；`screenshot-encoding.test.ts` 补线程结束边界。在 Windows 最终 ASAR 中复用检查，核对 sharp／本机 binding／libvips 的物理闭包；只用合成图片。 |
| S013 | [ ] | **Worker 故障隔离。** 截图故障注入只影响被测截图构造器，结束恢复；无关 Worker 仍可运行。验证失败后可重试、取消不写回、线程关闭及实际超时，不保留 screenshot／trace／coverage 到工作区。不能为通过而放开产品测试入口。 |
| S014 | [ ] | **修复离线完整入口定位 Vitest。** 原私有导出 `vitest/vitest.mjs` 不可解析；现从公开 `vitest/package.json` 所在目录定位 CLI。Windows 用冻结依赖运行 full，不能改包 exports 或升级 Vitest 掩盖问题。 |
| S015 | [ ] | **离线守卫精确放行。** full 只例外允许 loopback、本进程实际监听的精确 self-IPv4＋端口、受控组件 IPC；外部 DNS／HTTP／HTTPS／TLS、重定向、其他端口及未拥有端点继续拒绝。Unix 缺席探测只适用于规范系统临时根的真实 ENOENT；Windows 按 W003 适配，不照搬 Unix 文件判断。 |
| S016 | [ ] | **真实 filler 输入校准。** Mac 将固定短音负例与可被固定模型接纳的正例分为两个表，复用同一私有生成器；修正 TTS 语速／重复发音造成的空 VAD。Windows 制备本机固定、无真人的合成输入：正例必须有非空自然静音终稿，再检查 filler 不自动回答、手动提交仍保留；问题句正常自动回答。不能把空 ASR 算过滤成功、扩大词表或强制 stop 代替自然收尾。 |
| S017 | [ ] | **真实模型边界。** Mac 原短 um／ah 继续用于 S001 负向隔离，Windows 负例须经本机 VAD 确认且旧音已退出 500ms 预卷范围；新 `speech-preroll-smoke.mjs`／`speech-preroll.cjs` 为 Mac 文件回放入口。Windows 编写或复用本机文件 PCM 适配，保留 fresh 原文、首音节、真实 ACK 和尾部断言。固定模型仍可能将“经历”识为“经理”，本次未宣称修复逐字准确率。 |
| S018 | [ ] | **固定服务端与截图路径门禁。** 客户端集成使用显式 `VOXCUE_TEST_SERVER_ROOT` 指向干净 0.5.3／`3bceb615dbba900f669322c301fc4b5b473dfb15` 参考，不能修改既有服务端或加载真实配置。必要截图只使用本机 os.tmpdir() 下 owned 目录；本轮因错误 /private/tmp 别名参数触发门禁时，修正运行参数而未放宽守卫。 |

## Mac 专属行为

Mac 的当前安全、音频与更新实现见 [共享安全设计](SECURITY_HARDENING.md#macos-当前边界)，凭据只保留已发行 v1／v11 的有效恢复说明，见 [Mac 凭据说明](../../macos/docs/CREDENTIALS.md)。未发布中间助手的迁移与构建表格已退役，原始说明可查[固定 Git 历史](https://github.com/NCFXZ/VoxCue/blob/bc53d15431d0984b7d79c59c77e279e1500f03a5/shared/docs/WINDOWS_1.2.1_HANDOFF.md#mac-专属变更理解影响不移植实现)。Windows 不移植 CoreAudio、Keychain 或 Mac 签名实现。

## Windows 基线额外差异

这些在 Mac 1.2.0 快照中已经存在，Windows 从 `0bc1cd4` 接续仍需核对；不要误写为本轮新产品功能。

| 编号 | 状态 | 核对事项 |
| --- | --- | --- |
| B001 | [ ] | composer 使用图标语义比较，弹出层退出等待保留原行为断言；本机验证浅深主题、可访问名称和动画，不能以路径字符串或固定 sleep 替代原结果。 |
| B002 | [ ] | `shared/test/unit/speech-qwen-output.test.ts` 向 QwenEngine.load 显式传入 `synthetic/runtime/voxcue-qwen` 路径，不依赖真实 runtime；保留碎片输出、CPU 能力、对齐元数据、invalid-command 和 EPIPE 断言。 |
| B003 | [ ] | 完整排程增加 quit-drain／utility-retirement；真实高输出、取消、父退出、后台 drain 和迟到回调必须清理。Windows 本机核对 SIGTERM／进程树退出差异，不将发送终止信号算退出成功。 |
| B004 | [ ] | `test-workspace.mjs` 收口临时进程归属、嵌套清理机会和占用保护；未知／活跃 profile 不删除。Mac focus／console 守卫保持平台分支，Windows 使用自己的解锁门禁和 owned HWND。 |

## Windows 专项与完整回归顺序

下面是接续顺序，结果仅终端／对话；不要把本表改成成绩报告。

1. 完成 W001–W004 的处理或明确能力状态，再运行类型、架构、workspace 和相关 speech／screenshot／offline 单测。按当前 `windows/package.json` 脚本执行，不改 Mac 生成文件。
2. 在 `windows/` 查看 `node ../shared/test/scripts/functional-suite.mjs --list --jobs=1`，按当前排程串行运行全部组；`node ../shared/test/scripts/interview-usage-offline.mjs --full` 必须在 W003 安全适配后运行。
3. 先定向复测 S001–S018，再运行 Windows 既有五档 DPI、浅深主题、英文窄窗、键盘／减弱动画／高对比及原生窗口命中矩阵；保留 20 轮面试和 600 秒固定公开音频长稳入口，不用 Mac 结果替代。
4. 用本机真实 WASAPI／Worker 和已认证公开模型测试 CPU／适用 GPU、连续采集、切换失败保旧、暂停／停止尾稿、原生错误及资源释放；不采样物理麦克风／真实系统混音。若需要额外真实硬件覆盖，必须另按当前项目边界安排。
5. 在合成账户验证资料导出取消、保存和同名替换，校验 ZIP 精确内容；错误密码不删除，确认删除后本地／合成云端及重启状态正确，公开模型保留。原生 Save／Replace 在 owned Windows 对话框操作，不访问真实账号。
6. 仅在前置通过后制作 Windows portable／installer／Store 资产；核对最终 ASAR 的 W002、真实 SDK／语音／知识库／截图 Worker 及本机绑定。正式包继续在独立禁网 Sandbox 运行，不重新开放产品调试或添加测试环境覆盖。
7. 保护原 1.2.0 二进制，在隔离 guest 先用旧包写合成资料，再实际升级到新包，验证原件字节／元数据、个人资料、JD、记录、主题、语言、快捷键和可检索索引；另运行既有 1.1.1 历史升级入口。当前格式 reload、归档替换、NSIS 安装与 Store 更新必须分别说明，不混称。
8. 验证匿名分页发行查询、完整 Windows 资产选择、签名／摘要、下载进度、取消、安装／重启及旧缓存归属。历史中的仅 Mac 资产候选应被跳过；分页／网络／签名错误仍明确失败，不静默回退。
9. 测试结束核对 owned 进程、VM、挂载和文件占用后清理环境；保留认证公开缓存和恢复基线。按 Windows 当轮授权交付其资产，不能把历史开发快照称为 Windows 已发布。

## 更新选择与已知边界

Windows 既有更新代码未改：`shared/electron/backend/updates/provider.ts` 匿名分页查询 `/repos/NCFXZ/VoxCue-releases/releases`，不查询 `/releases/latest`。`releases.ts` 要求同一稳定版本的 `latest.yml`、`VoxCue-Setup-<版本>-x64.exe` 及对应 `.exe.blockmap` 均完整上传，再按 Windows 版本数字选择最高项。仅含 Mac 资产的候选被跳过；原 Windows 正式资产与签名不因此改写。不是所有错误都回退旧版。

本次没有升级模型／依赖、修改数据格式、提高原生／Paraformer 积压预算、购买签名身份或增加全量加密。Windows 自动重启仍未启用；Mac 权限／HAL／Metal／Keychain／SIP 及 DMG 的结论不代表 Windows 对应实现已验收。原始安全与安装边界继续参照 [共享安全设计](SECURITY_HARDENING.md)、[Windows 1.2.0 发行索引](WINDOWS_1.2.0_RELEASE.md)及 [测试入口](../test/README.md)。
