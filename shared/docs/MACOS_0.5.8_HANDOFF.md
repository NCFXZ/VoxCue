# Windows → Mac 0.5.8 本轮源码交接

**2026-10-23最新Mac范围：仅支持macOS 26+ Liquid Glass。用户已取消下文历史清单中的旧Mac回退验收；Windows及其shared网页实现保持。Mac旧开关偏好、回退预览及专属构建/测试已删除，缺少有效原生展示绑定时拒绝启动；启动器、应用包和新更新清单最低26.0。版本仍为0.5.8，本轮仅同步私有源码，不发布或改写现有安装包。**

用户随后明确授权将本轮已核对的源码、测试及文档提交推送至既有私有`NCFXZ/VoxCue`的`main`，覆盖下文针对本轮的不提交限制，仅限本次源码同步。Windows回传及当前验证范围见[WINDOWS_0.5.7_HANDOFF.md](WINDOWS_0.5.7_HANDOFF.md)顶部；版本保持0.5.8，不发布安装包，不改写既有发行、Latest或真实安装。

日期：2026-10-23。版本保持 **0.5.8**。本轮父基线为 `9aa94749ec18a93c51139d2de3c3f54695f5ed85`（此前0.5.8侧栏、搜索、登录同步）。本文只列该基线之后的 Windows 接续、界面修订、反馈修复和回归入口；更早累计说明保留在 [WINDOWS_0.5.7_HANDOFF.md](WINDOWS_0.5.7_HANDOFF.md)。冲突处以本文及用户最后追加的“结束确认/截图展开胶囊、面试设置不压暗”为准。

用户已授权本轮对最终代码执行 Windows 全量回归及 UI 检查，发现问题直接修复复测，核对后将源码提交推送至既有私有 `NCFXZ/VoxCue` 的 `main`。随后追加授权生成 Windows 0.5.8 安装包，上传既有公开 `NCFXZ/VoxCue-releases` 并设为Latest；向已经存在的Mac `v0.5.8` 追加Windows EXE、blockmap、latest.yml，保留原Mac和其他版本资产、标签及真实安装。此项覆盖本轮此前仅定向、不提交和不发行的限制；源码提交仍排除发行文件。

Windows正式三项已追加到[现有v0.5.8发行](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.5.8)，该发行已设为Latest；原Mac三项保持。本地正式文件保留于`windows/release/0.5.8`，不包含于源码提交。Mac发布包仍是此前Mac本机产物，本轮新增共享改动及下列原生待办需在Mac接续，不能据同名版本判断已全部包含。

## 接续边界

- 页面结构、间距、尺寸、状态和可以共用的业务继续只有 `shared/` 一份实现；回退 Mac 与 Windows 共用网页控件及毛玻璃。
- Liquid Glass、AppKit、原生材质及承载只在 `macos/`，本轮 Windows 未改写该目录。下列共用源码已经同步，不等于 Mac 原生效果已经验收。
- 依赖和锁、模型及固定运行时、凭据助手、代码签名身份和更新密钥保持。Mac 本机只同步生成自己的配置，不从 Windows 拷贝依赖、构建或原生模块。
- 测试仅使用隔离合成账户/资料/捕获端口、自有窗口及固定公开模型/音频的临时副本，不读取真实账户、资料或正式模型缓存，不采样硬件。GUI/原生串行，测试资料退出清理；本轮不交付新截图。
- 本文是逐条行为与验收清单，不是 Mac 测试报告。Windows 本轮实际结果在交付消息中汇报；Mac、真实账户、物理音频和真实安装不能由 Windows 合成检查替代。

## 一、逐条界面修订

| 编号 | 最终行为及共用实现                                                                                                                                                                                                                                                                                        | Mac 接续和验收要求                                                                                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U01  | 图1：聊天附件、模型、思考强度默认无背景、边框及阴影；悬停/键盘聚焦才显示中性底板。`ChatTools.tsx`加入既有`data-native-reveal-on-hover`契约；`styles.css`和`webMaterials.css`实现回退。                                                                                                                    | 实际 Liquid Glass 输入区内的三个控件也必须遵守显示标记，分别验证默认、悬停、Tab聚焦、菜单打开、禁用与关闭后的状态；点击/菜单/发送逻辑保持。不要仅验回退。                                                                               |
| U02  | 图6：资料提案的展开/收起、字段查看、技能查看使用相同悬停显示契约；保留胶囊轮廓、文字、勾选及“保存所选”。入口`ProfileProposal.tsx`。                                                                                                                                                                       | 检查未保存和已保存提案的全部查看入口；悬停不改变位置/大小，移开恢复，键盘仍可发现并操作。不要扩大到修改提案保存规则。                                                                                                                   |
| U03  | 图2：主窗口设置使用40%黑色背景遮罩，去掉弹窗边缘阴影/泛白，不叠加整窗虚化。                                                                                                                                                                                                                               | `macos/src/sidebarGlass.css`现有透明backdrop覆盖需要本机调整；`macos/native/ScrollChrome.mm`的原生NSShadow不能继续叠光晕。实际原生前景/输入投影也需一起压暗，不能只覆盖网页背景。关闭恢复亮度，焦点恢复、Esc和模态阻止背景操作保持。    |
| U04  | 图3：记录搜索保持44px胶囊，网页左右内边距20px，文字不贴边，保留搜索和系统清除。入口`styles.css`。                                                                                                                                                                                                         | 回退直接继承。Liquid Glass继续完整`NSSearchField`及系统ExtraLarge尺寸，由AppKit统一管理图标/占位文字/编辑器间距；不要机械给原生控件再叠网页20px。检查中文输入、光标、清除和滚动遮挡。                                                   |
| U05  | 图4/5：知识库创建/重命名及文档详情沿用40%黑色遮罩、无边缘阴影和光晕。背景不能操作。共用`webMaterials.css`。                                                                                                                                                                                               | 同U03处理原生覆盖及阴影；分别验创建、取消、保存、重命名、详情文档滚动、关闭和焦点恢复。自动索引与二次确认删除保持。                                                                                                                     |
| U06  | 图7：移除主设置“毛玻璃透明度”行和错误/提示分支；`readFrostedTransparency()`固定60，不再读写旧偏好。`SettingsDialog.tsx`、`frostedAppearance.ts`及已无消费者的旧滑杆专属样式一并清理。                                                                                                                     | 三条路径均不再显示该行。旧值0/100/off/损坏值与存储不可用都不能改变固定效果；旧存储不删除、不重写。Mac旧偏好消费者已按最新26+范围删除；读取导出仍由Windows共用实现使用，不删除。                                                                |
| U07  | 图8/9：主设置与浮窗设置移除“面试背景透明度”；`interviewAppearance.ts`固定原60%曲线。只保留字号，整组水平居中，宽度不超过420px，12–24、步进1和保存行为保持。                                                                                                                                               | 两个设置入口都验默认/最小/最大字号、鼠标、键盘、滚动、保存失败、重载、跨窗口和重启。原生字号仍由现用`NSSlider`端口承载，不能删除字号功能。                                                                                              |
| U08  | “60%”是原换算曲线的参数，不是直接把表面alpha设成0.6。主毛玻璃浅/深alpha分别0.4/0.512、blur28.8px；面试外层浅/深0.8496/0.8872、阅读层0.8992/0.928、panel blur19.52px。                                                                                                                                     | 回退与Windows使用同一曲线。Liquid Glass本身继续公开Clear/Regular API和本机原生承载；不要把网页alpha数值硬套到AppKit或额外叠造玻璃。原生参考效果仍需Mac本机核对，Windows未证明其视觉等同。                                               |
| U09  | 面试启动后只保留黑色：`appearance-control.tsx`只保留共用`interviewAlwaysDark=true`，实际浮窗及设置/登录只读预览统一深色；`main.tsx`在`#interview`首帧加入dark，避免闪白。主窗口仍可切主题。                                                                                                               | 以主窗口浅/深/跟随系统、系统明暗变化和重载实际驱动，检查浮窗及两个预览始终深色；不要在测试里强行移除dark来制造产品已不支持的白色面试。                                                                                                  |
| U10  | 图9：面试设置去掉边缘泛白/阴影；用户后续图二最新要求 **背景不压暗，也不额外虚化**。`interview-settings-dialog::backdrop`单独透明，主设置/知识库继续压暗。                                                                                                                                                 | `macos/src/interviewGlass.ts`及`macos/native/InterviewMaterials.mm`仍有`dialog-halo`路径，需本机移除对应光晕并验证。背景透明不代表可点击/穿透：模态打开必须暂停鼠标穿透，关闭恢复既有规则。空白角落与后方窗体亮度在开关设置前后应一致。 |
| U11  | 图10及后续图一：结束确认104×32px，主题危险色、中性底板、无额外阴影；展开时`FloatingInterview.tsx`切到默认按钮类型，去掉圆形`button-icon`。`styles.css`使用999px圆角及round，形成两端半圆、中段等宽的胶囊，避免50%圆角拉成椭圆。                                                                           | 验闲置图标、首次展开、二次结束、取消/禁用、悬停/键盘和减少动态效果；两态同高，文字不裁切、不溢出。原生背板须实际呈胶囊，不得用整块椭圆。原采集停止、请求取消、保存和关闭流程保持。                                                      |
| U12  | 图11：记录详情顶部接入聊天同款共用毛玻璃及`headerCoverage`；覆盖完整内容宽度，转写滚入后渐显/虚化，回到顶端透明。入口`webMaterials.ts/.css`和`chromeGeometry.ts`。                                                                                                                                        | `macos/src/scrollChrome.ts`现有workspace查询未包括详情，而且要求标题strong；应在Mac本机通过有界展示契约接入无重复标题的详情工具栏，不能复制页面。原生顶部只覆盖实际工具栏区域。                                                         |
| U13  | 用户反馈的正文空白：原先工具栏未定位，毛玻璃伪元素相对整个workspace铺满。`HistoryDetail.tsx`以ResizeObserver发布实际工具栏高度，工具栏自身定位；正文滚动视口延伸到顶部后方，材质只覆盖工具栏，原标题留白和回答卡片位置保持。中间容器允许转写绘入顶部，workspace仍裁切窗口边缘；错误提示存在时保持原布局。 | 在实际原生/回退两条路径验证：初始标题/日期/转写可读、滚动后正文清晰、只有顶部虚化、回顶清空、缩放/窄窗/侧栏折叠、AI回答展开与反向定位、长记录、错误提示和重命名。必须检查真实渲染；DOM中有文字、滤镜字符串正确都不能单独算通过。        |
| U14  | 用户在全量回归期间追加：面试输入区“截取图像”在捕获中或已有1–5张待发图时展开为76×32px胶囊；空状态仍32px圆形。`FloatingInterview.tsx`用同一`screenshotExpanded`驱动类型和data-expanded，展开移除button-icon并用999px圆角及round。                                                                           | 实际原生/回退分别检查捕获中、1/5、5/5、取消/移除到0及发送归零，数量/最多5张/禁用/发送/重试保持；只捕获合成或自有窗口。`interview-screenshot`检查两态类型、32px高度及无溢出，并纳入五档DPI。                                             |

## 二、Windows 接续时一并修正的共用项

| 编号 | 修改及文件                                                                                                                                                                                                                                                 | Mac 接续要求                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| W01  | `shared/electron/window.ts`新增`whenWindowReady`；`main.ts`的登录/主窗口/面试共用它。Windows在ready-to-show或did-finish-load先到时只显示一次，关闭移除监听，重载不再重复show，解决透明/Acrylic隐藏窗口首帧不触发时不可见。`platform.test.ts`覆盖生命周期。 | Mac保持仅ready-to-show的原生首帧时机，不增加Windows加载兜底，不改变原生prepareInterview、Dock或窗口层级策略；本机验登录→主窗→面试→返回。 |
| W02  | `webMaterials.css`将普通内容区文字按钮横向留白设20px，排除单图标、确认删除、下载动作动画、菜单触发框及switch；既有36px图标和确认内容宽度保持。                                                                                                             | 回退继承该规则，Liquid Glass继续系统控件内边距；分别验创建/取消/保存/导出和内容区操作，不给原生按钮重复叠20px。                          |
| W03  | `styles.css`面试顶部左右内边距10→18px，品牌既有14px内边距保持；网页顶部图标默认透明，悬停/聚焦/操作中反馈保持。                                                                                                                                            | 共享布局同步；原生按钮/玻璃仍留在Mac，不能以增加普通背板改变现有连续轮廓或顶部胶囊。实际与预览都要检查。                                 |
| W04  | 回退开场及面试设置标题图标使用24×24无背景/边框/阴影承载，播放/齿轮不套按钮底框。                                                                                                                                                                           | 普通共用布局同步；标题图标不是可交互设置导航，不能扩大原生控件接管范围。                                                                 |
| W05  | 收起侧栏时`.local-note`横向外边距归零，让更新36px圆形完整落在状态行内，保留下载/取消/重启文字展开及首秒取消保护。                                                                                                                                          | 三端检查展开与收起、三种更新阶段、鼠标与键盘、进度环、面试禁装及保存确认；用合成更新驱动，不执行真实安装。                               |
| W06  | 登录只读预览去掉重复内层圆角裁切；官网配色右栏、整体窗口裁切及既有布局保持。                                                                                                                                                                               | 本轮不重新设计登录；检查浅/深、860×520最小窗口、直线分界、预览上下及右边没有白边，原生背景端口限制保持。                                 |
| W07  | `FollowLatestButton.tsx`、`KnowledgePage.tsx`及`PersonalInfoPanel.tsx`删除遗留浏览器title提示，保留aria-label、图标及可见模态标题。                                                                                                                        | 实际原生与回退都不能弹浏览器旧文字提示；键盘/读屏名称、返回最新的箭头/生成三点、知识库创建/重命名和资料编辑仍可操作。                    |

## 三、测试源码与夹具变更

| 编号 | 变更                                                                                                                                                                 | 保留的实际断言                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01  | 新增`ui-material-refinement-smoke.mjs`，共享默认37组；最新材质及截图展开专项加入Windows五档DPI白名单，每档12组、共60组。                                             | 实际鼠标悬停、默认透明、模态遮罩、系统搜索清除、固定60%、居中字号、深色、结束/截图展开胶囊、记录材质高度、顶部后方真实渲染和下方正文像素不受覆盖；没有通过删除失败断言缩减范围。 |
| T02  | `functional-suite.mjs`及DPI驱动在每个子项开始前停放真实指针，finally恢复，避免原生WM_MOUSEMOVE覆盖CDP悬停；原生/GUI仍串行。                                          | 桌面必须解锁，hover仍要求真实命中和背景变化；不得将鼠标干扰当作产品通过，也不应删除悬停检查。                                                                                    |
| T03  | `interview-typography`、`interview-ux`、`interview-stability`、Windows`presentation-native`按已移除滑杆和深色固定材质更新旧规格。                                    | 字号范围/键盘/保存失败/重载/跨窗口、模态设备与回答流程、20轮开关/4次重载、任务栏/置顶/原生命中继续验证。透明面试设置还检查空白角落alpha及开关前后像素一致、打开时停止穿透。      |
| T04  | `interview-retry`等待首条固定合成转写完成再替换输入，避免50ms夹具首段覆盖用户问题；补充提交题名和请求次数断言。                                                      | 原三段等待、活动请求、重试次数、停止/结束/系统关闭/销毁、迟到输出和保存结果均保留。                                                                                              |
| T05  | `web-materials`按原生取整容许最小窗口1px差异，44px高度读取到百分之一；清除点击位置随实际右内边距计算。`typography`与`continuous-corners`识别44px搜索和既有只读预览。 | 实际输入/筛选/清除、轮廓、宽度、图文对齐和字号仍需通过；不能用放大公差掩盖溢出。                                                                                                 |
| T06  | `offline-electron-entry.mjs`仅在离线测试宿主从当前平台package读取app版本，避免误显示Electron版本。                                                                   | 产品和打包入口不使用该覆盖；自有更新驱动仍可显式模拟版本，版本保持0.5.8。                                                                                                        |
| T07  | 新增`capture-requested.mjs`，相关组件、删除、提案、字号、UX、更新、材质入口支持显式`--screenshots=<绝对目录>`。                                                      | 无参数不保存图片；要求绝对目录且文件名不能越界。仅用户另行要求截图时使用，本轮普通回归仍零保留。                                                                                 |
| T08  | `frosted-appearance.test.ts`替换可调偏好的旧规格，`platform.test.ts`新增Windows首帧/关闭与Mac时机的单测。                                                            | 旧偏好各值不读取/改写、存储失败也固定原60%曲线；保留原窗口平台能力与导航隔离断言。                                                                                               |
| T09  | `windows/test/scripts/components-check.mjs`将打包登录品牌图标定位限定到唯一“使用 ChatGPT 继续”按钮，兼容登录预览新增同款提供商图标。                                 | 分别断言按钮/按钮内品牌图标唯一并等待解码，保留登录及公开组件下载校验；不取首个匹配掩盖冲突。Mac同类夹具沿用语义定位。                                                           |

常驻深色预览可以位于浅色主窗口内，轮廓检查现在按实际最近主题作用域比较标准阴影token；保留表面阴影一致性断言，不再把浅色主窗的阴影误当深色预览基准。稳定性夹具等待合成回答生成完毕、截图按钮实际可用后再检查空状态，避免把生成中应有的禁用判为失败；原20轮/4重载和可用性断言保留。

打包组件夹具同时对齐此前已变更的共用界面：失败后从实际“下载”按钮重试，后端校验错误/缓存清空/请求次数断言保持；就绪后检查删除操作出现且无“已就绪”标签；通过顶部“个人信息”按钮收起卡片并断言隐藏，不再定位已删除的卡片内关闭按钮。Mac接续时按同一交互验证，不能恢复旧标签或重复关闭入口来迁就旧测试。

## 四、Mac 本机按顺序执行

1. 获取本轮源码提交，确认父基线及当前分支；先检查本地未提交工作，保留Mac专属变更，不覆盖真实资料或凭据。`shared/package.json`、根和本平台生成版本均须为0.5.8。
2. 在Mac执行`pnpm sync:workspace`，由唯一共享版本源生成本平台package/tsconfig/vite/workspace等配置；Windows同步配置不复制到Mac。依赖与锁不升级、不换签名/更新身份。
3. 逐条处理U03/U05的原生压暗与阴影、U10的透明面试设置且无光晕、U11/U14的结束与截图胶囊原生背板、U12的详情顶部原生承载；检查U01/U02悬停标记的实际AppKit路径。材质实现只改Mac目录，共用布局仍用本文shared实现。
4. 执行`pnpm check:workspace`、`pnpm check:architecture`、`pnpm typecheck`、`pnpm build`与`pnpm test`。原生绑定只在Mac本机构建；不得用Windows输出替代。
5. 在`macos/`运行`node test/scripts/sidebar-glass-smoke.mjs --content-only`，覆盖实际内容控件/菜单、字号、模态遮挡、预览和记录；再运行该脚本的登录/更新专项和`node test/scripts/interview-glass-smoke.mjs`，按U01–U14、W01–W07逐条核对实际窗口。
6. 运行共享`functional-suite.mjs`。在Mac它使用临时编译的真实网页回退renderer验共用业务；实际Liquid Glass专项单独执行。能力模拟和回退通过不能算旧系统真机或Liquid Glass通过。
7. 重点复查U13：滚动长记录后比较工具栏材质与下方正文像素，开关AI回答、定位问题、收起侧栏、最小窗口、主题和DPI/缩放，防止再出现“工具栏正常、正文空白”。分别检查有无错误提示的布局。
8. 本机结果逐条标注“通过/失败/未验证”，明确原生和回退范围；发现问题在正确层修复复测。未经另行授权不发布安装包、不替换真实安装、不修改公开发行。

## 五、Windows 本轮回归入口与边界

| 入口                                                              | 范围                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                       | 当前平台全部共享/Windows单测；POSIX SingletonLock符号链接项在Windows按既有条件跳过，不能记为通过。                  |
| `pnpm build`                                                      | Windows音频helper及当前Electron/renderer生产构建。                                                                  |
| `pnpm test:windows:functional`                                    | 全部37组共享功能/布局，包含最新界面与记录真实像素检查。                                                             |
| `pnpm test:windows:regression`                                    | 15组Windows原生/业务矩阵，含WASAPI包、AEC、Worker、更新、模型与窗口展示。                                           |
| `pnpm test:ui:dpi`                                                | 100/125/150/175/200%各12组，共60组；最新材质检查不再只覆盖少数缩放。                                                |
| `windows/test/scripts/qwen-component-smoke.mjs`                   | 固定公开Qwen组件下载/取消/原子认证/离线复用、CPU/CUDA、生产Worker、切换、文件释放与删除；测试资源必须在自有临时根。 |
| `windows/test/scripts/portable-native-smoke.mjs --with-installer` | 临时包布局、安装器资产与真实打包应用窗口验证；不安装、不发布，产物退出清理。                                        |

实际运行结果仅在本次交付消息/终端报告。本文列命令和验收目标，不把未执行项标作通过。真实账户授权/远程模型、物理设备/外放回声、真实安装替换及Mac原生效果均有独立边界。

## 六、变更文件清单

以下清单覆盖本轮源码、测试与文档；模型、安装包、依赖、构建、截图、测试结果和密钥不入Git。

| 文件                                                                                                                                                                           | 职责                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `windows/package.json`                                                                                                                                                         | 本机生成版本0.5.6→0.5.8，不改依赖或锁。                          |
| `shared/electron/window.ts`、`shared/electron/main.ts`                                                                                                                         | Windows首次显示兜底及三个窗口接入，Mac首帧保持。                 |
| `shared/src/components/ChatTools.tsx`、`ProfileProposal.tsx`                                                                                                                   | 输入与提案控件悬停显示标记。                                     |
| `shared/src/components/FloatingInterview.tsx`                                                                                                                                  | 结束确认与截图数量展开采用普通胶囊按钮类型，两态同高。           |
| `shared/src/components/HistoryDetail.tsx`                                                                                                                                      | 工具栏高度同步，修复正文遮挡并保留布局。                         |
| `shared/src/components/InterviewDisplayControls.tsx`、`SettingsDialog.tsx`                                                                                                     | 移除透明度行，只留居中字号。                                     |
| `shared/src/components/ui/appearance-control.tsx`、`shared/src/main.tsx`                                                                                                       | 实际面试与预览固定深色及首帧策略。                               |
| `shared/src/frostedAppearance.ts`、`interviewAppearance.ts`                                                                                                                    | 固定原60%材质参数，旧偏好保持不读写。                            |
| `shared/src/components/FollowLatestButton.tsx`、`KnowledgePage.tsx`、`PersonalInfoPanel.tsx`                                                                                   | 去除遗留浏览器title提示，保留无障碍名称。                        |
| `shared/src/platform/chromeGeometry.ts`、`webMaterials.ts`、`webMaterials.css`                                                                                                 | 记录覆盖几何、统一回退材质/按钮、主弹窗压暗和面试设置透明。      |
| `shared/src/styles.css`                                                                                                                                                        | 共用间距/搜索/字号/确认胶囊/记录布局，清理无消费者的透明度样式。 |
| `shared/test/scripts/capture-requested.mjs`、`ui-material-refinement-smoke.mjs`                                                                                                | 显式截图助手及新界面/真实像素回归。                              |
| `shared/test/scripts/components-ui-smoke.mjs`、`delete-controls-smoke.mjs`、`profile-selection-smoke.mjs`、`ui-ux-smoke.mjs`、`updates-sidebar-smoke.mjs`                      | 既有入口接入显式截图交付；默认零保留。                           |
| `shared/test/scripts/continuous-corners.mjs`、`typography-smoke.mjs`、`web-materials-smoke.mjs`                                                                                | 回退轮廓、字号、44px搜索、清除及分数DPI验证。                    |
| `shared/test/scripts/interview-retry-smoke.mjs`、`interview-screenshot-smoke.mjs`、`interview-typography-smoke.mjs`、`interview-ux-smoke.mjs`、`interview-stability-smoke.mjs` | 夹具时序和新外观规格，保留业务/取消/保存/稳定性检查。            |
| `shared/test/scripts/functional-suite.mjs`、`offline-electron-entry.mjs`                                                                                                       | 新矩阵项、真实指针恢复、离线宿主版本。                           |
| `shared/test/unit/frosted-appearance.test.ts`、`platform.test.ts`                                                                                                              | 固定曲线/旧偏好及窗口生命周期单测。                              |
| `windows/test/scripts/presentation-native-smoke.mjs`、`windows-suite.mjs`                                                                                                      | 固定材质下原生窗口验证与五档DPI矩阵。                            |
| `windows/test/scripts/components-check.mjs`                                                                                                                                    | 打包登录品牌图标限定到唯一登录按钮，兼容只读预览图标。           |
| `shared/docs/MACOS_0.5.8_HANDOFF.md`、`WINDOWS_0.5.7_HANDOFF.md`、`PLATFORM_UI.md`、`shared/test/README.md`、`PROGRESS.md`                                                     | 本轮逐条交接、最新规格、测试入口及源码同步范围。                 |

根`package.json`仅为生成配置的换行同步；版本语义原已是0.5.8。Mac专属目录、两平台锁、共享原生资源、固定运行时与公开发行资产均不在本次源码提交范围。

## 七、Mac 接续实现入口（不保存测试报告）

本机接续基线为`95a9bce2b5e623ace3c5aa44ca89dd20f96d16b8`，版本保持0.5.8。当前授权仅同步、修复和验证，不延伸本文开头的Windows提交/发行授权；不提交推送、不发布或改写现有安装包、Latest及真实安装。

- U03/U05：`macos/native/ScrollChrome.mm`在共享模态轮廓之外绘制40%黑色覆盖，包含原生输入/返回前景投影和控件，不再绘制NSShadow。原生ScrollChrome启用时让网页backdrop透明，Windows保留shared遮罩。
- U10：删除原`dialog-halo`展示和绘制，改为有界`modal-exclusion`几何，用于返回材质的模态裁切；该条不创建可见原生表面。共享透明模态、穿透暂停和关闭恢复逻辑保持。
- U14：截图按钮进入既有AppKit over-glass背板端口，空态32px圆形、展开76×32px胶囊，5/5使用系统禁用外观；布局/数量/捕获/发送仍由shared驱动。原生专项直接核对对应NSButton的位置、宽高、borderShape和禁用状态。
- U12/U13：Mac顶部查询包含共享`.history-detail`，`ScrollChromeState.title`允许null并在主进程校验，原生隐藏重复标题；实际高度、覆盖与正文仍由shared唯一布局及headerCoverage提供。
- 原生补充入口：`sidebar-glass-smoke.mjs --content-only`含`handoff-content-check.mjs`，`--handoff-only`可单独检查输入/提案悬停、键盘、模态原生前景压暗/恢复、明暗窄窗长记录及正文/顶部像素。面试专项追加设置开关前后四个空白角落像素一致性。输出仅终端/对话，不把该入口说明当作已通过记录。
- 原生交互夹具只向本进程自有NSWindow投递鼠标事件；菜单先确认原生焦点，再等待该次NSMenu跟踪代数更新并结束，避免读取前一次菜单或隐藏投影宿主的状态。悬停、菜单图标及正文像素断言保持。
- Mac最低系统26.0，保留SF Symbols和AppKit。`platform/materials`仅为共享初始化端口：Mac替换为NativeMaterials，Windows默认调用webMaterials；Mac构建拒绝网页材质模块及CSS。旧Mac兼容和预览文件已删除，通用shared测试宿主不属于Mac产品回退机制。固定模型/运行时、凭据助手及历史更新清单签名认证保持。
