# VoxCue 当前进度

更新日期：2026-11-13。长期规则见 AGENTS.md；测试结果仅在终端／对话中报告。

## 当前基线与范围

- 使用 main，当前源码已提交并正常推送至 NCFXZ/VoxCue；版本唯一来源 shared/package.json 为 1.2.2，根与 Mac 配置已同步。Windows 全树本轮只读，其清单待本机同步。
- Mac 源码／本地恢复基线为 macos-v1.2.1／64f61050a7f37848a153e6ed90ab6ddd009d3778，原 Mac 1.2.0／共享 Windows v1.2.0 基线保留，不移动产品标签。线上稳定资产以本轮匿名 API 核对为准，不能仅凭旧文档推定 v1.2.1 仍公开。Windows 会跳过不含完整本平台资产的 Mac-only 发行。
- 此前 Claude v6 接续审查与必要修复已收拢：以独立冻结 v8 补齐严格归属、目录移动兼容、后台无交互验证、清理门槛、队列与主动恢复；v1–v7 原件保留。当次未发布新安装包。
- 此前 Mac 源码、原生及最终签名包的隔离系统验证已收拢。后续发行须以冻结 v8 从当前源码重建资产，按交接条件复验；不能用旧格式钥匙串或内存 ACL 夹具代替系统弹窗验收。
- 本地 macos/release/1.2.2 仍是 v5 旧候选，不能作为当前验收或发行依据。宿主现用安装及真实登录资料未替换；此前自有虚拟机、候选、合成资料、截图和工具已按归属／占用检查清理，当次测试亮屏断言已释放。固定助手、签名材料、现用依赖和发行恢复基线保留。

## 当前开源与发行源迁移

- 用户授权将 NCFXZ/VoxCue 正式公开；原创软件最终采用 AGPL-3.0-only，允许合规商用，分发及修改版网络交互按条款提供对应源码。模型、运行时、商标与素材沿用原权利边界；LICENSE、THIRD_PARTY_NOTICES.md 与中英文 README 已补齐，npm private 标记仅用于防误发包。
- 关于页“GitHub 仓库”指向源码仓；共享自动更新、固定组件下载、Mac 更新标记和校验切换 NCFXZ/VoxCue Releases。保持公钥、签名、摘要、模型版本与缓存键，不重打包模型。Mac 包携带根许可证和第三方声明。
- 使用指南按当前语言选择中文 install/?lang=zh-CN 或英文 en/install/?lang=en；两条网站深链及显式语言覆盖均已核实，界面切换沿现有 store 订阅。
- 本轮核对 Git 历史及拟公开文件的凭据模式；只提交源码、文档和配置，不含 .tools、签名私钥、依赖、模型、真实资料或临时结果。此前已核验的 1.2.2 凭据和清理实现一并作为当前源码快照保留，不将旧 v5 候选冒充新包。
- 用户明确本次只上传模型，不上传历史安装包：models-v1.0.0 全部原始资产已复制，发行说明沿用原内容并把下载链接改到当前仓库，不添加原发行链接。误建的本轮 v1.2.0 镜像草稿及附件已撤回，未公开；旧仓及其原始发行不动。此前 Mac 1.2.1 本地／源码恢复基线保留。
- 当前状态：源码及模型发行已准备，仓库改公开触发 GitHub Confirm access，需要账户本人完成现有通行密钥／验证器／密码确认；不收集凭据，不绕过验证。确认后复核匿名可见性、许可证及全部资产摘要。类型／架构／工作区／单测／共享构建与两条隔离界面入口已执行，结果仅终端／对话。
- 兼容边界：已安装旧版仍读其内置旧仓地址，需后续正常版本升级或手动安装取得新源；旧仓保持过渡。Windows 全树只读，专属打包配置及本机验收见 W006。

## 当前仓库审计与重构

- 范围：审计全部源码、脚本、配置、依赖和文档，Windows 全树只读；保留此前未提交的凭据及业务改动。不得更改模型、DSP／检索数学逻辑、默认参数、线协议、资料格式或冻结助手。
- 审计已核对静态及动态入口、Worker／utilityProcess、平台装配、命令转发、打包消费者和历史保留边界。无法证明废弃的依赖、模型目录、历史共同锁、vendor、研究工件及恢复／发行资料均保留。
- P0 已执行：删除仅由旧测试调用的整包组件解包实现及专用散列包装；原安全断言转至现用流式入口并补元数据拒绝回归。删除未被调用的四个 RAG 旧辅助函数和组件接口重复字段。固定深色常量并入已有 interviewAppearance，删除空壳 appearance-control 模块。
- P1 已执行：远程连接协议／地址／限流校验原样移至独立 protocol.ts，service 保留原工具导出；附件预检复用公开契约限制；Mac 更新缓存和网络共用认证元数据规范化方法。新增相应边界和缓存往返回归；未改变当前算法或请求行为。
- 文档：架构和工作区布局改为当前职责与入口；中英文 README 增开发命令；组件及图标命令纠正过时说明，历史清理记录明确为历史。没有新增实现框架或依赖。
- 实施已收拢：复核各独立改动及动态消费者，执行全量类型／单测／架构／工作区检查、共享构建和附件／面试预览的隔离界面回归；输出仅终端／对话。Windows 源码、配置与全部原生源码对照任务起始指纹，当前冻结 v8 摘要保持；其余此前未提交代码未改写。本轮不生成发行包、不运行硬件采集、不重做此前系统钥匙串验收；Windows 本机验证仍待安排。
- 临时清理：本轮自有审计快照、临时差异和 GUI profile 已清理，未保存报告或截图。根 .DS_Store 在删除前占用复核中由 Spotlight mdworker_shared 持有，保留且不重试；没有代码／构建消费者也不能跳过占用门禁。
- P2 暂不实施：大型 main／同步／面试生命周期仍有实际消费者，不为缩行数重写；平台 AEC 存真实差异，不合并算法；adm-zip 仍有构建／夹具消费者，保留依赖声明。后续按具体功能及可证明的等价边界渐进拆分。

## 钥匙串实现

- 主进程凭据入口共用最多 32 项的串行队列，crypto／probe／validate／cleanup 均等待实际 close。授权失败／锁定／协议异常／超时停止本次启动请求；关闭助手返回的明确密文解码错误可单独恢复，允许用户主动重新登录。清理 partial／deferred 不锁存。不缓存密码或“已授权”成功标记，退出清理自有助手。
- 当前生产装配使用原证书及 com.voxcue.credentials.vault 标识的冻结 v8（macos/.tools/credential-helper-v8，源码 CredentialsVaultV8.mm）；v1–v7 源码和规范字节保留。正常构建只校验复制，缺失或错配须恢复，不重编、重签、轮换身份或回退 ad-hoc。
- 无自有条目 VoxCue Credential Storage／VoxCue Key v8 时，先查 v7、v6，再按 v1 既有三个别名顺序读取单一来源，在其钥匙串复制同一密钥并读回比较；不改写旧权限、不重加密资料。自有项普通 ACL／owner 必须仅当前助手，真实 partition 必须恰好为当前身份，旧格式仅当前助手签名要求；同名冲突失败关闭。
- 未接受迁移说明前，各次前台加解密均无交互 probe，ready 不缓存为已授权；仅 authorize 提示“始终允许”，“稍后”／locked／conflict 不自动解锁或重试。启动后的清理门槛使用本代 validate 专用无交互解密，只读已有自有项、不迁移／创建；复用本地完整结构检查，遥测绑定实际 installationId。通过后按引用删除 v7、v6 及三个既定旧名称（不比对旧密钥）；预期失败保留并报告，不追加密码框。
- 云账号坏资料不再自动删除，主动恢复前保留加密原文件；旧 ChatGPT 存储坏资料恢复写入同样保留加密副本。异常模块不会因其他账号重新登录被顺带重置，未恢复的资料继续阻止清理。相关共享恢复行为需 Windows 本机回归。
- 安全取舍：清理前旧程序仍可经未改动旧条目读取同一密钥；未比对旧别名若存不同密钥会被删除；清理后不承诺无缝降级到 1.2.1。系统 partition／Integrity 不改写，不收集 Mac 密码。原理、依据与边界见 [凭据说明](macos/docs/CREDENTIALS.md)，变更与 guest 验收清单见 [凭据交接](shared/docs/MACOS_1.2.2_CREDENTIAL_HANDOFF.md)。

## 已保留的其他实现

- Mac 账号与同源遥测使用系统网络端口，强制 omit cookies、no-store、no-referrer、redirect error，保留显式授权和取消；Windows 沿用原端口。隔离 guest 门禁要求 SIP、签名执行与 Gatekeeper 开启。
- 凭据失败／拒权／繁忙／无效响应补英文提示并保留重启动作。额度卡片移除“额度已用尽”提示，保留比例、进度与重置时间；可继续额外用量使用中性说明。
- 共享语音保留 VAD 接纳后的延迟建流、500ms 有界历史及恢复取消／真实退出围栏。仅 Mac 启用有界自动重启；Windows 未启用。Mac HAL 声道映射与初始化竞态等既有改动保留。
- 既有逐条变更见 [Windows 1.2.1 交接](shared/docs/WINDOWS_1.2.1_HANDOFF.md)；1.2.2 实现摘要见 [Mac 1.2.2](shared/docs/MACOS_1.2.2_RELEASE.md)。本轮未增加 Windows 1.2.2 交接文档。

## Windows 待本机安排

- W001：本机 sync:workspace，同步 1.2.2 并核对 Store 映射，保持 Mac 全树只读。
- W002：打包器补 cancellable.js 单文件 ASAR 展开，验证最终物理依赖闭包。
- W003：安全适配离线 full 的 named-pipe 缺席探测，保留外部网络和未拥有端点拒绝。
- W004：自动重启仍未启用，不单独打开开关冒充完成。其余共享／原生验证按既有交接及新的任务授权在 Windows 本机安排。

- W005：为 Windows speech devices() 子进程 JSON 结果补有界数组、字段类型与长度校验；当前类型断言不能保证共享消费者收到数组。保持现用设备协议，需 Windows 本机合成异常响应及原生枚举回归。

- W006：Windows 本机同步 license/版本清单、electron/updates.ts 的仓库门禁、package-portable.mjs 的更新标记、package-installer.mjs 的仓库校验、electron-builder.config.cjs 的发布仓与旧“源码私有”注释；打包携带根 LICENSE 和 THIRD_PARTY_NOTICES.md，并补本机更新／组件／指南与实际包回归。共享下载逻辑已换新源，Mac 不写 Windows。

## 验证入口

- 本轮重构：根目录 pnpm typecheck、check:architecture、check:workspace、test、build:shared；定向范围为 components、remote-connection、RAG、chat-request、interview appearance、update-driver。结果仅终端／对话，不保存报告。

- 钥匙串：credential-vault-smoke.mjs 覆盖当前单来源、v6／v7 迁移和 JS／原生队列；credential-vault-policy-smoke.mjs 覆盖内存真实 partition 及禁交互失败围栏。归档 v5／v4／v2 入口及 cloud-native-vault-smoke.mjs 保留。测试源码是回归消费者，测试临时资料结束清理。
- 正式包：package-guest-smoke.mjs；后续系统复验须重新准备独立 SIP／Gatekeeper 基线，不能用助手夹具或最终 ASAR 普通界面结果代替。
- 其他入口及平台边界见 [测试说明](shared/test/README.md)。发行及额外长稳按后续请求执行；GUI／原生串行、解锁门禁，结果不入仓库。
