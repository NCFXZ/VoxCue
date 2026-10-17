# main 主线、平台边界与仓库清理

> 2026-10-17 测试保留规则已更新：全部既有测试产物按用户授权清理；下文旧 test/results/test-results 路径仅为历史运行记录，不作为当前可用交付物。当前验证见根 PROGRESS.md。

日期：2026-10-15（Asia/Shanghai）。本次仅做跨平台准备和安全清理，保持 Windows 产品行为；不实现完整 Mac 版本，不提交、推送、打包、签名或发布。

后续用户已明确Mac只支持Apple Silicon（原生arm64），不开展Intel/Universal适配。分平台更新逻辑已另行完成，最新规则和验证见[UPDATES.md](UPDATES.md)及PROGRESS最新节；下文保留本次架构整理的历史记录。

后续目录整理已完成：生产代码归shared/windows/macos，测试归test，旧test-results整体迁为test/results。下文为当时的目录和验证记录，当前路径映射见[WORKSPACE_LAYOUT.md](WORKSPACE_LAYOUT.md)；恢复快照仍完整保留。

## Git 状态与开发入口

| 引用 | 本轮处理后提交 | 处理 |
| --- | --- | --- |
| 本地 main | 4247ef0 | 从当前最新 Windows 工作分支创建并切换 |
| codex/speech-recognition | 4247ef0 | 保留原引用 |
| Windows / Mac | 04448bb | 相同提交，保留历史参考 |
| origin/Windows / origin/Mac | 04448bb（本地跟踪值） | 实时网络核对失败，没有fetch/推送 |
| origin/HEAD | origin/Windows（本地跟踪值） | 未修改远端默认分支 |

Windows/Mac本地无分歧，当前Windows工作分支是其后继一提交。GitHub只读连接器出现传输错误，git ls-remote也无法连接github.com:443；远端最新SHA和默认分支未能实时确认，不能把本地跟踪值当作实时远端结果。其他原分支均保留。开始前有191项已修改/删除/未跟踪条目，未reset/clean/stash或覆盖；本地main承接原工作树。**最新完整功能仍为未提交工作，main的提交引用本身尚不包含全部功能。** 本轮没有提交授权，不把建立main当作已提交完整快照。

后续从main开展共同开发；需要临时分支时使用`codex/…`并从main创建，合入main前运行相关回归。Windows/Mac不作为长期业务分支，不依靠两份业务代码、cherry-pick或手动同步。远端主线迁移及当前未提交工作的提交/推送需要后续授权。

## 结构和耦合变化

没有移动既有模块、原生资源或模型。新增以下实际使用模块：

| 文件 | 责任 |
| --- | --- |
| electron/platform/types.ts | 主进程内部平台策略类型，不进入DesktopAPI |
| electron/platform/windows.ts | Acrylic、ICO、应用ID、退出策略、保护支持标志、固定隐私入口、现有原生资源位置 |
| electron/platform/macos.ts | PNG、关闭全部窗口后驻留、钥匙串错误标签；明确缺少Windows原生能力 |
| electron/platform/index.ts | 集中选择平台并解析开发/打包资源，纯函数可在Windows测试Mac策略 |
| electron/window.ts | 三类窗口共用尺寸/选项、preload/沙箱、导航限制、开发/生产hash入口 |

`main.ts`继续负责服务装配、受控IPC和窗口业务生命周期；关闭保存、OAuth切窗、重载取消、置顶/保护、收起/缩放和释放逻辑没有转移到平台策略。后台通过main接收路径和错误标签，不能反向依赖平台模块或窗口实现。共享React、Zustand、AIChatService、资料/原件/聊天/历史、IPC及类型契约各保留一份。

WASAPI采集仍位于原speech后端，Windows NSIS适配仍位于updates/driver；它们有实际系统限制，未创建空的Mac替代实现。未适配音频在SpeechHost启动utilityProcess之前明确报错。safeStorage继续使用原Electron跨平台API，文件名、版本和加密方式不变；Copilot继续官方SDK/系统凭据库，平台错误标签由main注入，没有改变登录协议。

`build:shared`提取既有TypeScript和Vite编译命令；完整`build`先构建WASAPI再调用共享构建，原Windows检查链不变。Mac未来可以使用共享编译入口，但这不证明原生依赖已安装、应用可启动或音频可用。现有安装/便携脚本和配置仍仅Windows x64，本轮没有新增Mac打包配置。

架构门槛增加平台策略/共享窗口不依赖业务，backend/application不直接导入桌面策略或窗口。原Renderer、公开contracts、沙箱preload和推理/Provider限制全部保留。

## 清理证据及保留项

审查覆盖src、electron、scripts、tests、docs、public、native和根配置；核对静态/动态导入、按路径启动的进程、脚本命令、文档引用、实际依赖和编译输出。清理不遍历或删除忽略的用户/模型/实验派生数据，不重新评估；原生回归仅正常加载现有模型并使用合成资料。

| 清理/整理 | 证据及理由 |
| --- | --- |
| 删除knowledge/types.ts的MODEL_ID导出 | 全部源码/脚本/测试标识引用只有定义；运行时按本地路径加载模型，下载仍使用rag-model.json，实际模型版本常量仍保留 |
| 替换main中的三份窗口安全/导航/加载配置 | 共用window.ts；审计逐项比较重构前后全部Windows构造选项，三类均一致，避免未来单窗配置漂移 |
| 替换主进程内散落的平台判断/资源拼接 | 交由纯平台策略解析；应用关闭策略、图标、隐私入口和Windows原生路径集中，业务只接收参数 |
| 修复login smoke过期图标定位 | 重构前原构建因.chatgpt-icon不存在失败；按明确的ChatGPT按钮作用域定位service-brand-icon，原图片加载断言保留 |
| 新增vitest.config.ts明确测试根 | 只收集src与tests两处现有源码测试（src/**/*.test、tests/**/*.test）；原41个测试文件全部保留，避免扫描历史快照/生成探针 |
| 将sherpa-onnx-win-x64改为平台可选依赖 | 包声明仅win32/x64，普通依赖会阻止Mac安装；固定1.13.8不变，Windows打包脚本原本就显式要求它，缺失仍失败，锁文件同步分类 |
| 补充.gitignore | 忽略macOS .DS_Store/._*与崩溃转储*.dmp；原依赖、产物、模型、测试输出和凭据规则保留 |

本轮**没有删除整个源码文件或依赖**，也没有升级依赖树/Electron。pnpm-lock.yaml仅把sherpa Windows包移至optional及修改对应snapshot标志，全部packages版本/完整性数据原样。按原供应链策略同步及冻结锁验证通过（821条）；离线缓存缺元数据的尝试记录保留，正常联网补元数据后验证，没有关闭策略、执行安装脚本或重装node_modules。直接依赖都有源码/构建/测试/隐式类型或原生运行时用途，例如sherpa-onnx-win-x64由原生加载器及打包需要，Copilot Windows包提供实际exe，不能按没有静态import误删。开发和后台noUnused检查通过，源码引用图没有孤立业务模块。

七个无入边文件为src/main.tsx、src/env.d.ts、electron/main.ts、preload.ts、speech/process.ts、speech/worker.ts及knowledge/process.ts，分别由HTML/类型/启动入口/utilityProcess/Worker按路径使用，全部保留。全部脚本均有命令、其他脚本或文档引用。唯一同字节文件对为public/voxcue.png与src/assets/voxcue.png，是update-app-icons.cjs生成并分别供原生窗口与Vite使用的必需副本；Logo原件也保留。检查编译期预期输出后，dist-electron没有确认过期的孤立文件，因此没有删除生成目录。

保留现有release/installer产物、模型/依赖/缓存、benchmark README及忽略的private/结果/派生索引、历史文档、恢复基线和所有原用户工作。本轮没有批量清空test-results；新前态快照改用.snapshot后缀以避免被当作测试。现有安装包不包含本次架构整理，日常开发启动使用根目录构建；不把旧安装包称为本轮新产物。

## 兼容性与验证

重构前：129模块零越层/环、三组typecheck、41文件279项单测和Windows build通过；综合Electron与浮窗基线通过。沙箱初测11项因loopback EACCES/原子写EPERM失败，正常宿主权限原样全部通过。旧login smoke定位失败的基线日志保留。

本轮源码快照逐字节比较确认：76个Renderer文件、preload及全部公开契约未变；全部既有文件仍存在，没有覆盖/删除无关工作。三类Windows窗口所有构造参数与原实现一致。Renderer构建仍为原有index-CueVCwUP.js及index-DpWJ-56p.css。没有产品功能、UI、IPC协议、用户目录或数据格式变化，也没有自动迁移/清理数据。

最终验证：134模块零越层/运行时环、三组typecheck、两组noUnused、完整Windows build及42文件295单测通过。14组既有Electron命令全部通过：test:electron、test:floating、test:composer、test:conversations、test:chat-response、test:login、test:copilot、test:chat:lifecycle、test:settings、test:knowledge、test:history、test:interview:access、test:interview:context、test:updates。

新增`test:platform:native`真实加载Paraformer Worker，使用新平台路径经SpeechHost→utilityProcess→WASAPI助手返回设备列表，状态idle、未启动采样；限定Windows x64。`test:rag:core`在Electron真实E5/LanceDB/解析进程内验证三模式、PDF/DOCX/完整QA、Local/Function模拟Provider、重启/删除。本机HTTP/SSE、账户、资料和UI音频事件使用合成测试；本轮没有真实账户推理、真人语音精度、Mac真机或新安装包验证，不能据此声称这些已验收。日志及结果见PROGRESS本轮首节与test-results/cross-platform-20261015。

已知非阻断提示：Vite现有大chunk提醒、LanceDB现有输出列弃用警告保留，没有调高限制隐藏。单测并发桌面回归时PDF冷启动一度超过原5秒阈值；等待桌面结束后独立完整重跑约1059ms通过，两份日志保留，没有删除断言或放宽超时。

审计入口：repository-audit.json（引用/依赖/重复文件/窗口参数/未变文件）、lock-comparison.json、desktop-results.json、unreferenced-exports.json、stale-build-files.json、tracked-before.patch、before/*.snapshot及各组日志，均在忽略目录test-results/cross-platform-20261015。

## Mac后续待办

- 真机验证共享构建与Electron启动、钥匙串授权/拒绝/续期、系统浏览器OAuth、主/登录/浮窗切换和退出/activate行为。
- 在保持现有视觉/交互的约束下确定macOS材质、标题栏/控制、拖动/缩放、多屏/DPI、置顶与截图保护的实际能力；不能把Electron API存在当作捕获保护保证。
- 明确系统音频/麦克风权限和本机采集方案，本轮没有实现Mac采集或添加音频能力；WASAPI与固定Windows隐私入口不得复用。
- 仅为Apple Silicon arm64核验Copilot运行时、sherpa/ONNX、LanceDB及解析依赖的安装、utilityProcess/Worker、离线模型加载和资源位置；之后另行授权Mac构建分发及签名。
- 当前关于页等Windows描述及共有自定义标题栏保持原产品行为；Mac正式接入时再按真机能力处理，不能将本轮静态检查写成Mac支持完成。

本轮没有发现需要强制合并、数据迁移或用途不明文件删除才能继续的事项；历史分支/实验派生数据的后续删除不在本轮清理范围。
