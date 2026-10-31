# Mac 0.6.5 → 0.6.6 更新与交接

本文逐条列出产品、平台端口、清理和测试入口的变化，以及Mac本机的实现与验收要求；不保存测试成绩、截图或运行报告。

## 基线、版本与执行边界

- 已发布Mac 0.6.5产品源码为`2607b5a837b1d8eaa97768f5514cd24ff91e4184`，来源见[0.6.5发行索引](MACOS_0.6.5_RELEASE.md)。本轮工作起点为`6657cd2fb59e6c0e16463050bbbc550808ca0c16`，其后的差异才是本次0.6.6范围；此前Mac 0.6.5的队列持久化和凭据隔离修复不重复算作新功能。
- 唯一版本源为`shared/package.json=0.6.6`。Windows只同步根和Windows清单；`macos/`没有由Windows代写。Mac拉取后运行`pnpm sync:workspace`，只同步根/Mac，核对Windows全树字节不变，不复制Windows锁文件。
- Windows 0.6.6已单独发布并设为Latest，正式三项及源码来源见[Windows发行索引](WINDOWS_0.6.6_RELEASE.md)。Mac客户端仍按完整平台资产选择既有0.6.5，Mac0.6.6须本机验收后另行发行。
- 运行时依赖、SDK、模型、RAG索引格式和用户数据兼容保持原样；构建工具仅作C052–C055的定向安全修复与无用依赖裁剪。不迁移真实资料，不轮换代码签名、凭据助手、host-id或Ed25519更新身份。
- 独立账号服务固定0.5.3 / `3bceb615dbba900f669322c301fc4b5b473dfb15`，只读引用；旧`shared/server`参考不修改、不提交。客户端源码上传不等同安装包发行或服务部署。
- Mac必须使用本机登录且解锁的控制台串行验证。只使用owner合成账户、临时资料和固定公开音频/模型；不访问真实账户/Keychain内容，不采样物理麦克风或系统音频，不改变系统辅助功能、锁屏或隐私设置。

## 产品变化逐项清单

每项独立核对；代码共享不代表Mac原生效果已经验收。`通过/修后通过/待验/不适用`及首次失败、修复和复测只输出终端/对话。

| ID | 0.6.6变化 | 实现位置与Mac核对要求 |
| --- | --- | --- |
| C001 | 版本从0.6.5更新为0.6.6。 | `shared/package.json`及本机同步清单；核对运行版本、包版本和未来更新元数据一致。 |
| C002 | 主设置中在字号旁恢复背景透明度。 | `InterviewDisplayControls.tsx`、`InterviewFontSettings.tsx`；两项并排，窄窗口无横向溢出。 |
| C003 | 面试内设置复用同一组显示控件。 | `InterviewSettingsPanel.tsx`的既有消费者；主设置与浮窗设置相互同步，不能出现两套状态。 |
| C004 | 透明度按0–100%的整数调节并显示百分比。 | 滑块`aria-valuetext`和`output`带`%`，字号保留`px`；键盘方向键和焦点反馈有效。 |
| C005 | 滑块左端为不透明图标、右端为透明图标。 | `display-opacity-icon`及`is-opaque`样式，图标仅装饰，不新增悬停提示。 |
| C006 | 复用原偏好键，恢复持久化与跨窗口同步。 | `interviewAppearance.ts`中的`voxcue-interview-background-transparency-v1`；非法、缺失或损坏值采用默认100，写入失败明确显示。 |
| C007 | 面板材质曲线最大参数由60改为70。 | `frostedProfileAt(70 * value / 100)`；不是将滑块上限改为70，也不是直接将CSS alpha设为0.7。 |
| C008 | 对话气泡曲线最大参数由30改为35。 | `frostedProfileAt(35 * value / 100)`；转写、问题、回答使用同一共享变量。 |
| C009 | 删除Windows固定面试透明度覆盖。 | `frostedProfiles.ts`仅保留现用Windows侧栏预设；Mac/Windows面试采用同一偏好和曲线。 |
| C010 | 顶部胶囊按最终要求与对话气泡共用透明度。 | `webMaterials.css`；展开、收起及预览胶囊均随设置变化。早先“顶部固定不变”的方案已被替代。 |
| C011 | 面板下方独立状态提示保留其原平台材质。 | `--interview-chrome-panel-*`；不把“此窗口未隐藏”等独立提示误改为新气泡样式。 |
| C012 | 设置预览可在实际图片和文字上观察材质。 | `InterviewPreview.tsx`；面试浮窗固定在上层，仅底层故事滚动。 |
| C013 | 首屏是完整湖景图片，之后是完整文字段落。 | `interview-landscape.jpg`、`preview-backdrop-paper`；图片离线加载，正文左右边距一致且内容完整。 |
| C014 | 背景连成“湖畔散步→林间书屋→灯下记录”的故事。 | 删除机械的“深色桌面/彩色桌面”分段表达，保留深色和彩色可观察背景。 |
| C015 | 深色段落采用左插画、右文字。 | `interview-story-path.jpg`、`preview-backdrop-night`；窄宽度依然清楚可读。 |
| C016 | 彩色段落采用左文字、右插画。 | `interview-story-notebook.jpg`、`preview-backdrop-color`；与前文叙事连续。 |
| C017 | 三张预览图片作为本地素材打包。 | `shared/src/assets/README.md`记录来源和生成提示；不依赖远程壁纸，不将用户截图作为产品素材。 |
| C018 | 预览出现后等待1秒再向下滚动一次。 | IntersectionObserver可见比例达到35%才计时；以800ms动画滚到半图片/半文字的位置。以本条为最终行为。 |
| C019 | 完全删除自动回滚阶段。 | 无0.5秒停顿、无返回距离、无第二次动画；到达半图半文后保持位置。 |
| C020 | 手动操作立即取消待执行提示。 | 滚轮、指针、触摸、键盘及非脚本滚动均取消定时器/帧；后续不能抢回用户位置。 |
| C021 | 动画只提示一次且尊重辅助功能。 | 离开视野、页面隐藏、卸载、减少动态效果时停止；登录页紧凑预览不执行滚动提示。 |
| C022 | 预览滚动条与记录页的细滑块一致。 | `webMaterials.css`复用6px轨道、2px可见滑块、透明轨道；键盘和鼠标滚动有效。 |
| C023 | 实际面试顶部区域恢复透明。 | 移除转写/回答标题背板与相应覆盖率测量，不能在滚动后重现实心顶部。 |
| C024 | 正文在标题下方逐渐淡出。 | `.floating-scroll`顶部36px渐隐，并同步首行padding/scroll-padding；底部原渐隐和输入区仍保留。 |
| C025 | 预览和实际输入区共用材质底层。 | 从`FloatingInterview.tsx`抽出`InterviewChromeBase.tsx`，两个实际消费者复用；登录紧凑预览不增加底层。 |
| C026 | 预览参与与真实面试相同的尺寸测量。 | `webMaterials.ts`测量预览标题、恢复提示和输入区；自动跟随最新内容仅用于真实面试，不能带动预览故事。 |
| C027 | 预览沿用实际气泡字号、字重、行距和字体。 | 比较12/14/18/24px及0/37/50/100%组合；透明度不仅核对CSS变量，还比较同背景上的实际像素。 |
| C028 | 深色预览的高对比度降级优先级修正。 | `:root.web-materials.dark`覆盖；减少透明度、高对比度、forced-colors保持可读且不依赖模糊。 |
| C029 | “问题反馈”始终与说明第一行对齐。 | `UpdatesPanel.tsx`、`updates-footer/updates-notes`；状态换行、错误、无状态说明、浅深色及窄窗逐项看基线。 |
| C030 | 聊天与面试思考状态改为柔和浅灰扫光。 | `styles.css`共用活动状态和摘要标题；渐变改为90°水平，去除斜向观感。 |
| C031 | 扫光仍为1秒扫过、2.5秒停顿。 | 不平铺、不改变文字宽度；连续看至少两轮，检查深色和减少动态/高对比度降级。 |
| C032 | 生成光标随当前正文字号缩放。 | `.typing-caret`高度`1em`、基线偏移`-0.125em`；聊天/面试和不同字号均不能出现短小光标。 |

## 截图路径逐项清单

| ID | 变化 | 实现与Mac要求 |
| --- | --- | --- |
| C033 | 截图采集与通用编码通过可选平台端口解耦。 | `DesktopPlatform.captureScreen(window, signal): Promise<NativeImage>`；main仅装配，Renderer及公开IPC不增加路径、句柄或命令参数。 |
| C034 | Windows新增独立单次取屏助手。 | `windows/electron/screenshot.ts`、`windows/native/Screenshot.cs`；根据自有HWND使用MonitorFromWindow/GetMonitorInfo确定物理屏幕，不依赖显示器数组顺序。Windows文件在Mac只读。 |
| C035 | Windows通过内存BGRA传帧。 | 8字节小端宽/高头，随后紧密排列BGRA；长边最多3840，主进程核对头、边长和精确字节数。无中间PNG、临时截图文件或持续采集。 |
| C036 | 原生助手有取消、超时和窗口生命周期边界。 | 十秒执行期限、输出大小上限、AbortSignal终止子进程、关闭后拒收；截屏失败明确报错，不静默改截其他屏幕。 |
| C037 | 完整原图和小预览复用同一NativeImage。 | `shared/electron/screenshot.ts`不再为240px预览重新解码PNG；原图PNG优先、超过8MiB转JPEG90、预览JPEG75，原有数量/发送/归档约束保持。 |
| C038 | Electron路径在AI面试建窗时仅提前枚举元数据。 | 零缩略图准备不取得或缓存桌面图片；Mac屏幕权限未授予时跳过；关闭/超时清理监听。Windows原生路径无需准备。 |
| C039 | Windows开发和打包入口包含新助手。 | `build-screenshot.mjs`、`package.platform.json`和`package-portable.mjs`；助手二进制为本机生成物，不提交Git，验包检查存在于`resources/native`。 |
| C040 | Mac原生快速取屏为明确接续项。 | 当前Mac继续使用Electron路径，不能把Windows耗时当作Mac成绩。Mac本机可实现同一可选端口，使用受支持的单帧系统API；保留既有权限与取消语义，独立于音频/凭据助手，复用共享编码，明确验证防捕获能力的系统边界。 |

## 清理、规则和测试代码逐项清单

| ID | 变化 | 接续要求 |
| --- | --- | --- |
| C041 | AGENTS新增公开测试缓存和弃用测试删除规则。 | 固定来源/摘要校验后可复用本平台缓存；账号、资料、报告和截图不能随缓存保留；被替代且无消费者的测试须删除。 |
| C042 | 模型默认缓存到本平台`.cache/test-components`。 | `model-fixtures.mjs`通过正式组件服务获取固定公开资产，校验后复制到本次owner临时根；运行夹具不能修改缓存。 |
| C043 | 固定公开WAV按revision和SHA256缓存。 | `.cache/test-public-audio`；命中后仍校验，再复制到临时根；临时下载文件原子落位并清理。损坏缓存明确失败。 |
| C044 | 显式指定的模型缓存继续只读。 | `VOXCUE_TEST_COMPONENT_CACHE`不调用下载/修复/删除；仍核对全部文件、大小、摘要和独立副本。 |
| C045 | 删除旧语音模型诊断脚本与命令。 | 删除`speech-model-check.mjs`及`test:speech:model`；它依赖退役的本地模型/参考语料路径。现用真实Worker/公开样本由audio-pipeline、speech-soak及原生矩阵覆盖，不宣称替代真人准确率。 |
| C046 | 删除三个被替代的Windows语音脚本。 | 删除`speech-device-check.mjs`、`speech-reliability.mjs`、`speech-restart-native.mjs`及命令；旧脚本采集硬件或写入工作区结果，故障/重启回归已在合成端口矩阵中维护。带显式硬件开关的有效speech-desktop入口保留，不能默认执行。 |
| C047 | 架构检查识别新JPEG资源。 | `check-architecture.mjs`将`.jpg`纳入真实资源边；不放宽Renderer、IPC、平台、Worker或业务隔离规则。 |
| C048 | 共享材质与字号测试覆盖恢复后的控件和实际像素。 | `frosted-appearance.test.ts`、interview-typography/chrome/retry/ux、web-materials及ui-material-refinement；弃用“透明度控件不存在/设值仍恒为100”的旧断言，核对双控件四端图标、0/50/100跨窗口同步，以及浮窗设置本身始终不透明。Windows presentation-native的严格数值断言同步70曲线，原容差保持。 |
| C049 | 更新思考状态与反馈对齐回归。 | chat-progress和updates脚本覆盖水平扫光、字号相关光标和第一行基线，保持既有取消/重试/更新状态语义。 |
| C050 | 截图增加原生端口与严格输出测试。 | 共享/Windows screenshot单测、interview-screenshot-store、界面截图脚本和`screenshot-performance.mjs`；合成桌面原生探针检查当前帧、取消和防捕获，不保存/外发像素。 |
| C051 | 删除被严格原生探针替代的截图分支。 | interview-screenshot不再支持直接采样普通桌面的`--native-capture`；统一使用全屏owner合成遮罩的screenshot-performance。移除无生产消费者的captureInterviewScreen薄导出，单测直接覆盖实际captureInterviewScreenshot入口；DesktopAPI/IPC保持。 |
| C052 | 定向修复两项构建工具安全通告。 | `shared/pnpm-workspace.yaml`将glob 13固定到14.0.2、minimatch固定到11.0.1；对应[遍历取消绕过](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)和[模式预处理放大](https://github.com/advisories/GHSA-g3hv-75wg-m249)。不使用忽略通告或放宽审计的方式处理。 |
| C053 | 构建链统一到项目已使用的现代ASAR/Universal版本。 | `@electron/asar@3→4.3.1`、`@electron/universal@2→3.0.6`，移除依赖旧版匹配器的分支；Packager20.3.0、Builder26.15.3及Node24保持。Mac必须本机核对打包、原有签名和原生组件；Windows不能代验Universal/Mac打包。 |
| C054 | 裁掉两个无使用入口的构建依赖链。 | 移除`app-builder-lib>electron-builder-squirrel-windows`（项目使用NSIS）和`ejs>jake`（仅EJS CLI任务入口）；EJS模板渲染、NSIS和实际平台打包保留，不恢复Squirrel安装器或CLI。 |
| C055 | 只在本机生成新的构建依赖锁。 | Windows更新`pnpm-lock.yaml`及生成策略；Mac锁保持只读，须先在Mac同步策略并受控生成其锁文件，再冻结安装。核对`pnpm why glob minimatch`和实际模块解析，不能把旧回调API消费者直接替成现代对象API；ASAR/Universal及CLI裁剪须一同审查。运行时SDK/模型及依赖完整性不漂移。 |
| C056 | 增加实际构建依赖的安全回归。 | `build-globs.test.ts`用有界Worker验证对抗路径和正常中文/花括号匹配，用自有临时目录核对glob取消后不继续遍历；不靠版本号断言代替行为检查，临时文件退出清理。 |
| C057 | Windows包内UI守卫等待已退出SDK的内核文件映射释放。 | `WindowProbe.cs`仅对共享/锁冲突最多等2秒，取得真实独占读锁后才启动UI；持续占用或其他错误仍拒绝。原生夹具同时验证持续占用拒绝、释放后可取得锁且锁仍阻止程序启动，不能以等待替代凭据隔离。Windows文件由Mac只读参考。 |
| C058 | Windows安装器GUI夹具每次读取/操作前检查控制台。 | installer-branding/installer-engine复用既有解锁桌面探针，锁定或状态未知立即拒绝；不改变系统锁屏或辅助功能设置，仅操作临时GUID与自有窗口。Mac不代写或代验。 |
| C059 | 修复Qwen切回Paraformer在2秒队列边界的误停。 | 共享`SpeechController`交接期只有在所有已接收音频包ACK后才恢复原2秒预算，不在刚降至2秒时被下一批双路音频误触发过载；交接总量仍受原30秒绝对上限保护。pendingAudio为空时归零累计时长，避免浮点残量。speech-progress覆盖切换时已在2秒/原本超过2秒、乱序ACK、后续音频和追平后的严格2秒限额；Mac需本机复测真实CPU/Metal六次切换及600秒长稳。 |

## Mac本机执行顺序

同步及pnpm转发命令在仓库根执行；下列`node ../shared/...`脚本命令先进入`macos/`。依赖仅在Mac平台目录安装，禁止在根或shared安装。

1. 检查`git status/diff`并保留本机与远端后续工作；正常拉取0.6.6源码，禁止reset/clean/强推。完整读取本页、AGENTS、PROGRESS及架构文档。
2. 先运行`pnpm sync:workspace`，核对仅生成根/Mac；在`macos/`执行`pnpm install --lockfile-only --ignore-scripts`，逐项审查仅C052–C055的构建依赖变化，再`pnpm install --frozen-lockfile --ignore-scripts`。不改运行时SDK/模型，不复制Windows锁；随后运行`pnpm check:workspace`、`pnpm check:architecture`、`pnpm typecheck`、`pnpm test`、`pnpm build`。Mac构建使用其既有本地签名与原生工具链。
3. 在解锁控制台串行运行`node ../shared/test/scripts/functional-suite.mjs`及Mac原生矩阵、五档缩放/浅深色/最小窗口、辅助功能和实际像素对齐。语音稳定性必须足600秒真实经过时间，输入为固定公开WAV和合成采集端口。
4. 对C001–C059逐条检查；重点检查1秒延时且无回滚、用户取消、预览/实窗材质与字号、输入区叠加、36px顶部渐隐、胶囊、百分比、反馈基线、思考扫光与光标，以及实际构建依赖安全回归与验包、真实模型切换。C057–C058为Windows专属夹具，Mac不代写或代验。
5. 若实现C040，再补本机授权/未授权、取消/窗口关闭、多屏与缩放、最新帧、防捕获、首张及连续截图性能；不以计时阈值放宽图像正确性，也不持续缓存桌面图片。
6. 使用owner临时包验证Mac本机签名、原凭据助手绑定、更新身份和原图导出。临时profile/数据库/包/截图退出清理；固定公开模型/音频缓存可保留。未来正式安装包发行按当次授权执行，既有0.6.5及历史资产不覆盖。

本轮Windows验证与GitHub源码交付状态以当次终端/对话和PROGRESS为准；Mac本机原生、真实账户、物理设备、真实权限撤销与新电脑能力均须分别验收。
