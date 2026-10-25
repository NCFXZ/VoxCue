# Windows 0.5.9 → 0.5.10 完整交接与逐项验收

2026-10-25 Windows已按下列60项完成本机检查和修复后复测，生成配置已同步0.5.10。用户随后明确授权源码与Windows安装包上传，并将v0.5.10设为Latest；Windows三项已补入，Mac原三项保持。最新Windows专属三项透明度、结果/修复清单、正式包与线上认证及人工边界见[本机验收账本](WINDOWS_0.5.10_VERIFICATION.md)。下文保留Mac交出时的基线和逐项验收要求；其中Windows待执行/未发行/保留Latest的阶段描述已由本说明取代，不授权未来自动发布。

## 交接基线与使用方法

- 源码仓库：私有 `NCFXZ/VoxCue`，分支 `main`。比较基线是 `48c44aad80563dcb274a24e66b8c8a0245fa1661`（`Complete Windows 0.5.9 packaging and record scrolling`）；本报告随本次 0.5.10 源码提交交付。用 `git diff 48c44aa..HEAD` 核对整个版本差异，不只看最后一次文档编辑。
- 版本唯一源为 `shared/package.json`，当前为 `0.5.10`；根和 Mac 生成配置已同步。**Windows 专属目录本轮在 Mac 上未修改、未运行**，所以提交中的 `windows/package.json` 仍为 `0.5.9`，须在 Windows 本机运行配置同步，而不是手工维护第二个版本源。
- 下列 **A01–H06 共 60 项**是最终实现及保留边界。每个 ID 均须在 Windows 回传报告中登记结果、证据和复测；Mac 专属项目登记“不适用，并已核对隔离”，不得省略。旧 [0.5.9 交接](WINDOWS_0.5.9_HANDOFF.md) 中的账户、存储、RAG、截图归档等历史行为继续回归；其中 AppKit/Liquid Glass 内容展示、局部系统模糊和中途动画试验，以本报告为准。
- 本轮用户明确授权将核对后的源码提交推送私有 `main`。Mac 0.5.10 安装包已经另行发布；本提示词不自动授权 Windows 发行、更新真实安装、修改 Latest、仓库设置或签名身份。

## A. 版本、架构与退役代码（8 项）

| ID | 最终变化与源码位置 | Windows 本机动作与通过条件 |
| --- | --- | --- |
| A01 | `shared/package.json` 从 0.5.9 升为 0.5.10；`shared/scripts/sync-platform-manifests.mjs` 仍只写当前平台及根配置。Mac tsconfig 只额外包含 `src/icons.tsx`。 | 在仓库根执行 `corepack pnpm sync:workspace`，再检查 `windows/package.json`、根入口及本机 tsconfig；版本均来自 shared，Mac 文件不得被改写。`check:workspace` 通过。 |
| A02 | Mac/Windows 直接使用同一套 React 页面、控件和内部材质；`shared/vite.config.mjs` 不再加载平台 renderer 配置，只对 Mac 图标模块做有界替换。`shared/src/platform/materials.ts` 直接安装共用材质。 | Windows 构建必须仍解析 shared 页面和 Fluent 图标，不导入 `macos/src` 或 Mac 二进制；构建、架构检查及登录/主窗/设置/面试路由通过。 |
| A03 | 删除 Mac 内容原生投影、Liquid Glass、原生菜单、scroll-chrome、独立 composer/follow 前景窗口，以及 shared 的 `MaterialButton`、`MaterialSurface`、controls 包装。详见末尾删除清单。 | 不恢复同功能的 Windows 页面副本或 Mac 适配层；检查无残余静态/动态消费者、悬空 import 或已删除构建入口。Windows 现有系统窗口、音频及更新适配继续使用。 |
| A04 | `desktop.ts` / preload / main 同步删除 `setSidebarGlass`、`setGlassButton`、`setScrollChrome`、`setContentControls`、`setInterviewMaterials`、`windowFocused`、`popUpNativeMenu` 及对应 appearance IPC/事件、几何类型。删除 `liquidGlass` 能力与 `nativeWindowControls` 布尔标记。 | 类型契约和 preload 精确公开键集合通过；旧原生展示调用不得出现在业务代码。不得为兼容测试重加宽泛原生 UI 端口；保留主题、系统强调色、屏幕权限等有效能力。 |
| A05 | 原来借 `nativeWindowControls` 判断的平台行为，改为明确 `platform === 'macos'` / `id === 'darwin'`；涉及红绿灯、退出/激活、音频权限设置及标题栏。 | Windows 保留自定义最小化/最大化/关闭、系统权限入口、关闭保存确认和会话清理；不能因移除标记而误走 Mac 分支。主窗、登录窗及面试结束均实际点击验收。 |
| A06 | Mac 保留 SF Symbols、原生红绿灯、Dock/Spaces、鼠标穿透及 Electron 系统侧栏 `vibrancy: sidebar / followWindow`；原生内容控件已取消。 | Mac 专属无需移植；核对 Windows Fluent 图标、原系统侧栏/窗口背景及 nativeTheme 适配保持，不能把“只保留系统侧栏”误解为删除音频/凭据/更新原生能力。 |
| A07 | Mac 启动器、Core Audio/权限绑定、应用和更新清单最低系统从 26.0 改为 14.2；开发/共享构建先生成 SF Symbols，包内不再要求 SidebarGlass.node。 | 记为 Mac 专属；Windows 不改最低系统、目标架构或打包链。旧 v0.5.9 Mac 公开包仍是旧最低系统，本次没有覆盖。14.2 编译/ABI通过不代表在旧系统实机验收。 |
| A08 | 已核对删除 42 个受跟踪的退役文件，保留现有依赖/锁、模型/索引、运行时、签名及恢复基线；清理退出后的本轮临时资料，未重试历史占用/跳过目录。 | 清理前查静态/动态消费者、精确真实路径和占用；保护 Windows 历史 349 个跳过目录及正在使用内容。仅删除已确认无用的自身临时输出，不能用全盘 clean/reset 处理交接。 |

## B. 共用材质、普通控件与侧栏（10 项）

主要入口：`shared/src/platform/webMaterials.css`、`webMaterials.ts`、`frostedProfiles.ts`、`frostedAppearance.ts`、`interviewAppearance.ts`、`styles.css`。

| ID | 最终变化 | Windows 本机动作与通过条件 |
| --- | --- | --- |
| B01 | 侧栏之外统一聊天输入框材质：`--web-material-fill` 与 `backdrop-filter: blur(24px) saturate(125%)`，覆盖标题、菜单、气泡、输入框、返回最新、提示及图片查看控件。 | 用自建文字、图片和棋盘背景实际核对；同时检查滤镜和像素边缘衰减，不能只比较 CSS 字符串。此滤镜只模糊同窗口内容，不承诺模糊窗口外桌面。 |
| B02 | 透明度共用预设从旧固定 60 改为 100；内部材质仍通过 `.6 + curve × .4` 求底色。面试大背景使用 `frostedProfileAt(60 × amount)`，取消旧 chrome/reading/panelBlur 多套参数。 | 不新增“系统模糊百分比”或恢复旧偏好读取/改写；核对大背景与内部底色分别生效。100 是应用预设档位，不是操作系统模糊强度参数。 |
| B03 | 转写/回答两块大区域继续透明透视，移除大面板整块 backdrop blur；只在固定标题、输入框及返回最新下面补局部底色，防止清晰正文重影。 | 桌面资料从两块大区域仍可看见；固定控件下方滚入的同窗字/图被模糊且无清晰叠影。不得以整窗 Acrylic 或大面积实心板“修复”。 |
| B04 | 顶部独立品牌胶囊使用“气泡填充 + 面板 tint”两层底色，匹配面试气泡叠在主背景后的实际透明度；展开与收起一致。 | 浅深色、自建浅/深背景、展开/收起逐一对照；检查两层计算值与合成画面，不能只把单层 alpha 设成相同数值。 |
| B05 | 面试底部提示复用 B04 双层底色并去掉可见描边。 | “此窗口未隐藏”等提示有足够底色和文字对比，无细边框；不影响警告内容、关闭和自动消失时机。 |
| B06 | 仅深色面试标题/输入框的基底混入 10% 白色，局部防重影层同步变浅；大背景不受影响。 | 深色不再过黑，浅色不被额外提亮；开关主题及透明度辅助功能后没有旧色残留。 |
| B07 | 登录/设置只读面试预览在自身主题作用域重新求材质；修复主窗浅色、预览深色时与真实面试的标题/输入框不一致。 | 主窗浅深色各验登录和设置预览，与真实面试比较 fill、image 双层及标题颜色；预览仍只读，不启动采集。 |
| B08 | 减少透明度、高对比度、forced-colors、透明度为 0 时使用实心保护和无滤镜；预览也覆盖。 | 分别触发系统偏好/受控媒体模拟并截图；正文、图标、焦点与选中态可读，退出偏好后恢复。不要把辅助功能实心板当作视觉缺陷。 |
| B09 | 普通按钮、选择器和菜单行使用圆弧胶囊；菜单外框 20px 连续圆角。菜单高亮改为中性灰 20% 与正常前景，进度条仍跟系统强调色。悬停属性改名为 `data-reveal-on-hover`。 | 下拉菜单的勾选、禁用、键盘方向/Esc、鼠标与屏幕边界不变；聊天附件/模型/思考强度、查看技能等仍仅悬停/聚焦显底板。不要恢复旧原生投影属性。 |
| B10 | 收起侧栏的导航底板与账户卡片统一居中 44×44 圆角正方形，展开布局及选中强调标记保留；删除 Mac 专用字体覆盖，使用同一共享字体栈并由各平台正常回退。 | 浅深色、五档 DPI、窄窗实测宽高及居中；账户头像不拉伸，导航命中与选中标记正常，展开文字无挤压。字体不能用截图等比缩放替代真实布局测试。 |

## C. 固定标题、滚动与输入区（10 项）

入口：`webMaterials.ts/.css`、`FloatingInterview.tsx`、`HistoryDetail.tsx`、`useTextareaSize.ts`、`useFollowScroll.ts`。

| ID | 最终变化 | Windows 本机动作与通过条件 |
| --- | --- | --- |
| C01 | 个人信息、面试记录 AI 回答顶部与聊天顶栏一致，正文在固定标题后滚动，材质只随覆盖渐显。 | 初始透明、滚入渐显、离开恢复，不出现一直实心或突然一刀切；标题文字、按钮仍清晰可点击。 |
| C02 | ResizeObserver 动态测量标题及面板，首屏留白、scroll-padding 和记录答案定位考虑标题底边；移除的节点解除观察。 | 长标题/换行、面板开合、窗口缩放后首行不藏在标题下面；点击记录关联答案能定位到可读区，末行仍可达，反复进入页面无观察器残留。 |
| C03 | 面试转写/回答顶部同样按滚入覆盖渐显 24px 材质；撤回旧顶部白色遮罩、18px 正文裁切。 | 刚进入时正文自然衔接，滚动后文字/图片能进入标题后方并模糊，不能留白条、硬切线或遮掉第一行。 |
| C04 | 面试 scroller 填满整块面板，正文延伸到悬浮输入框后，只在窗口最底部最后 36px 渐出。 | 文本可滚到底；有内容在输入框后方自然淡出，不能提前在输入框上缘截断。长回答、代码块、末尾图片都验。 |
| C05 | 测量标题、音频恢复条和输入框高度，动态 padding/scroll-padding 保护首尾；原先贴底时高度变化后继续贴底。 | 输入变高、添加/移除截图、出现/关闭音频恢复条、修改字体及窗口尺寸后末行可完全滚到输入框上方；正在读历史内容时不强行跳到底。 |
| C06 | 返回最新按钮从输入框内部移到同级独立层，使用聊天同款 36px 圆形、材质和阴影；无圆形正文挖空及光晕。 | 转写与回答各自返回最新，回答按钮跟随输入框高度；隐藏时不可聚焦/误点，显示时不挡发送或正文，未读标记和点击跟随保持。 |
| C07 | 面试输入框默认一行，最多增高六行后内部滚动；内边距 10px 16px 8px、textarea 无重复 padding。聊天仍默认两行、最多十一行。 | 空框、自动折行、Enter/Shift+Enter、中文组合、粘贴/连续删除和清空均即时测量，无先卡住再跳高；达到上限仍可编辑末行。 |
| C08 | 输入框保持 40px 连续轮廓、发送/停止 36px 圆形；工具栏统一 7px 外留白、品牌和其他小控件 32px。 | 五档 DPI 下图标居中、边缘一致，无原生和网页重复控件；发送/停止生成的实际行为、禁用及快捷提交保护不变。 |
| C09 | 删除输入区自动回答旁的“正在收听/回答/暂停”等状态组件与专用样式。 | 不留占位空白；自动回答开关、顶部语音/麦克风/系统音频状态、失败/恢复提示、生成进度和真正的采集流程仍正常。 |
| C10 | 隐藏的滚动节点高度为 0 时不再写 scrollTop；保留 DOM 后重新显示调用 syncLayout。 | 隐藏期间新转写不丢，返回显示后读历史的位置保持；原来跟随底部的继续跟随，不因零尺寸隐藏误判或跳回顶部。 |

## D. 面试面板运动（6 项）

新入口 `shared/src/components/useInterviewPanelMotion.ts`；与按钮形变 F 项是两套用途不同的动画。

| ID | 最终变化 | Windows 本机动作与通过条件 |
| --- | --- | --- |
| D01 | 整组收起 220ms 上移 14px 淡出，完成后才调用既有窗口收起；展开先扩大窗口，再 280ms 进入；提示条配合淡出/进入。 | 逐帧观察无遮挡跳帧/先裁半块/旧影，终帧窗口边界和位置仍由已有受限窗口命令决定。 |
| D02 | 单独隐藏转写左移 18px，回答 240ms 居中；显示时先扩窗、转写和回答再进入。 | 转写隐藏 200ms、显示 240ms 及回答让位过程连续，回答最终居中；面试内容、输入草稿与截图不重建丢失。 |
| D03 | 动画期间 busy 拒绝重复切换、拖动和尺寸调整；结束后恢复。 | 快速交替点击收起/转写、同时拖拽/键盘调尺寸不得造成大小和可见态失配，操作锁不永久残留。 |
| D04 | IPC 失败或迟到时重新查询 interviewState，协调已确认的窗口状态并显示错误。 | 注入拒绝/迟到结果，窗口不留不可见大画布；允许重试，关闭/卸载时不再写状态。不要重写窗口业务到 Renderer。 |
| D05 | Web Animations 只处理透明度/位移，移除圆角 clip-path；箭头旋转与开合方向一致。 | 比较中间/终帧连续圆角、边界及阴影，无普通椭圆裁切突然替换连续轮廓。 |
| D06 | 减少动态效果直接切换；运行中切换偏好会取消动画，卸载取消播放器并解除监听。 | 系统偏好开启前/动画中开启均无滞留动画、卡死或未处理 Promise；关闭窗口后不再回调。 |

## E. 截图胶囊、缩略图与查看器（8 项）

主要改动在 `FloatingInterview.tsx` 和共用样式；`InterviewImages`、归档存储和图片 IPC 沿用 0.5.9。

| ID | 最终变化或必须保留的边界 | Windows 本机动作与通过条件 |
| --- | --- | --- |
| E01 | 截图按钮常态为 32px 胶囊，固定图标 +“截图”+ 快捷键；Mac 显示 `⌃S`，Windows 显示 `Ctrl+S`。有待发图或捕获中显示数量并隐藏快捷键，清空恢复。 | Windows 不显示 Mac 符号；0→1→5→移除/清空完整检查，文字不挤按钮。该按钮始终是胶囊，原 180ms 宽度变化保持，不是圆形/胶囊切换试验。 |
| E02 | 面试窗内 Ctrl+S 复用截图按钮 `.click()`；不注册全局键。忽略已处理事件、组合输入、额外修饰键、长按重复、面板收起及打开的 dialog。 | 鼠标和键盘都遵守未启用 AI、捕获中、生成中、五图上限等 disabled 保护；主窗/其他应用不截屏，Ctrl+Shift+S/Alt/Meta 不触发。只用合成捕获，不采样真实桌面。 |
| E03 | 待发送缩略图右上删除为内缩 4px 的 20px 深灰圆板、白色 ×、浅细边与阴影，悬停/聚焦提亮。 | 浅白图/深图都可辨，点击只删该待发图，生成中禁用保持。**这是用户单独要求保留细边的例外**，不能因 F 项无描边而删掉该可读性底板。 |
| E04 | 面试截图查看器与面试设置的透明 backdrop 明确优先于通用遮罩；普通记录查看器保留暗色遮罩。全局 dialog/destructive backdrop 不再附加旧 4/8px 模糊。 | 面试查看截图不压暗/虚化后方，关闭后无残留遮罩；记录查看仍可区分前后层。对比 computed backdrop 与真实截图，不能只验证属性存在。 |
| E05 | 查看器左右箭头和页码胶囊使用统一材质、无可见描边；禁用仅令箭头 SVG 透明度为 .42，不淡化整个玻璃底板。 | 首/末页禁用清晰，悬停及键盘焦点可见，左右键/鼠标翻页正常，叠在图片上不挤占额外显示高度。 |
| E06 | 查看器原保存/关闭规格继续同为 36px 圆区、17px 图标，标题“截图”、no-drag 和关闭默认焦点保持。 | 本机真实鼠标检查中心/四边命中及 HWND HTCLIENT；面试中无保存入口且 IPC 拒绝保存，记录中保存/取消对话框正常。不同图形的视觉面积不等于点击区尺寸不同。 |
| E07 | 原归档边界不变：只归档用户已发送原图/缩略图，记录存有界 ID；未发送只内存，失败/停止仍保留该次问题与原图，重试复用原图。 | 发送→失败/停止→重试→记录查看→导出→删除全链路复验；不重新捕获、不附加后续问题、不进入 RAG；按 ID 读/删，不增加任意路径/字节写接口。 |
| E08 | 原手势保持：两指像素滑动/惯性平移，捏合或 Ctrl+滚轮缩放，行/页滚轮缩放，放大拖动、双击复位、方向键/Esc/空白关闭。 | 模拟事件与真实触控板结果分开记录；图片边界/指针中心/关闭后焦点恢复均验。真实触控板或多显示器没测就明确待验，不能用 Mac 结果代替。 |

## F. 所有现有圆形/胶囊按钮统一动画（6 项）

入口 `styles.css`、`webMaterials.css`、`SidebarUpdate.tsx`、`DownloadButton.tsx`、`FloatingInterview.tsx`；`ConfirmActionButton` 原业务实现保留。

| ID | 最终变化 | Windows 本机动作与通过条件 |
| --- | --- | --- |
| F01 | 共用 `--button-morph-duration: 220ms`、`--button-morph-easing: ease`、`--button-morph-shift: 3px`，宽度伸缩与整组图标文字交叉淡化/位移。 | 圆→胶囊、胶囊→圆、胶囊→不同宽度胶囊都逐帧检查；整句作为一组，不因宽度逐字露出/消失，不缩放字体。最终采用用户恢复的旧交叉淡化，不是已撤回的无淡化试验。 |
| F02 | `.confirm-delete`、`.floating-end`、`.sidebar-update`、`.download-button` 全程固定 999px 圆弧端帽，避免宽度未收完时切成 50% 椭圆。 | 收起第一帧到终帧均保持半圆端部。按实际宽高/有效 clamped radius 判断，不因 `50%` 与 `999px` 字符串不同误报，也不能因终帧圆形就跳过中间帧。 |
| F03 | 全部删除/重置确认沿用相同动画；简历摘要单独试用 hook/标记/状态层已删除，不存在第二套实现。 | 简历、职位、技能、聊天记录、知识库、面试记录等实际存在的删除/重置逐项抽验；二次确认、3 秒取消、Esc、失焦、revision、忙碌、失败重试与不重复删除保持。 |
| F04 | 侧栏下载/取消/重启从 display 切文字改为两层完整内容；仍默认 36px，展开侧栏时 hover/键盘 focus 才展开，收起侧栏不展开文字；进度环保留。 | 三个更新状态双向检查，下载首秒不能取消、之后可取消重试，面试期间不能安装，重启保存确认仍生效；本次只用隔离模拟更新驱动，不真的安装。其他静态下载按钮不增加 hover 行为。 |
| F05 | 面试结束按钮补齐单图标/完整确认内容双层过渡，仍 32px 起始圆；原第二次点击结束及 3 秒取消逻辑不变。 | 超时收回也无椭圆；二次点击、系统关闭确认、失败和关闭释放均保持，不用动画延迟实际业务。 |
| F06 | 上述动画按钮所有常态/确认/悬停/聚焦均无可见 border；保留键盘 focus outline。减少动态效果不做过渡。 | 浅深色及强制颜色核对边框与焦点可达性；快速中断再展开无空白或逐字裁切。静态圆/胶囊不新增切换行为，不扩大到 E03 缩略图可读性细边。 |

## G. 其他界面与测试适配（6 项）

| ID | 最终变化 | Windows 本机动作与通过条件 |
| --- | --- | --- |
| G01 | 面试记录搜索改为轻量 28px 清除按钮、14px ×；隐藏 Chromium 原搜索取消控件，清除后返回输入焦点。 | 输入/清除/再次输入、结果数、排序筛选、窄宽度和键盘操作通过；平时无重底板，悬停/聚焦可见，无双 ×。 |
| G02 | 技能更新提示的动作整体居中，补充摘要/联网更新技能在左，“暂不更新”在右，直接调整 DOM 顺序。 | 缺摘要和资料齐全两种路径都验；Tab 顺序与视觉一致，窄窗换行居中；流式 busy 禁用及补充/更新原流程保持。 |
| G03 | 新增 `interview-chrome-smoke.mjs`、`interview-motion-smoke.mjs` 并加入共用功能矩阵；旧 Mac 专属原生内容 UI 测试退役，Mac 增加实际窗口材质探针。 | 在 Windows 跑新增两项，不跳过成“Mac 专属”；棋盘像素衰减、正文覆盖、逐帧端帽、草稿/阅读位置及减少动态效果断言必须有效。Mac `.mm` 探针不移植。 |
| G04 | 既有测试随实际产品更新：搜索命中使用按钮当前中心；等待开合/hover 过渡；发送按钮 36px；工具栏比 fill+image 双层；圆角按有效几何；包内 form 精确作用域。 | 任何失败先区分产品回归/过期断言/环境缺夹具；修正断言须说明依据，不能放宽业务、隐私、签名保护以获得绿灯。新增失败修复后重测原项与关联项。 |
| G05 | 架构、契约、平台与 frosted 单测删除退役接口假设，验证共享材质/固定预设/精确 API；格式入口不再扫描已退役 Mac UI 目录。 | Windows 本机类型/契约、架构/循环依赖、workspace、格式和单测全跑；Windows 专属测试若依赖旧 Mac 标记，仅按本机平台职责适配，不复活死端口。 |
| G06 | README、PLATFORM_UI、ARCHITECTURE、MACOS_PORT、WORKSPACE_CLEANUP、测试入口及旧交接顶部说明同步；本报告末尾给出完整文件清单。 | 核对当前说明优先，历史日记只用于追溯；回传时报告逐项结果、修复文件、实际命令和剩余限制，禁止只写“全部通过”。 |

## H. 保持不变、发行状态和结论边界（6 项）

| ID | 保持项 | Windows 本机验收或处置 |
| --- | --- | --- |
| H01 | 本版未升级依赖/锁、官方 Codex/Copilot 或语音运行时、模型/索引，也未重做账户/OAuth/额度协议。 | 保留固定版本（包含 Copilot SDK 1.0.21、Codex 0.164.0、sherpa 1.13.8 及既有锁）；用既有 Windows 本机依赖和 frozen lock 安装方式，不凭 Mac optional 包推断 Windows 完整。 |
| H02 | 已接受的 RAG v7、qa-linked-v2、项目/来源隔离、取消/身份/revision、15 秒/48KB/512 token 等边界保持。 | 回归 keyword/vector/hybrid、项目切换、追问、未知项目和无关资料；公开题仍仅评估，不能为满分调生产参数。合成 Provider 证据检查不代表真人面试最终回答质量。 |
| H03 | 账户隔离、加密凭据、聊天流式/取消/重试/附件/资料提案、额度、会话关闭保存及本地资料保持。 | 用合成账户逐条回归旧 0.5.9 行为；不读取真实账户凭据、不请求真实推理。没有真人账户联调就明确其未覆盖。 |
| H04 | 原音频生命周期、组件校验/下载取消/模型切换及删除释放保护保持；Mac GUI 与共用测试通过不能认证 WASAPI/Windows 进程链。 | 本机跑 Windows 原生回归、固定公开音频/模型、AEC/重启/设备故障模拟及打包路径检查；不采样真实麦克风/系统声音，不操作用户当前控制的窗口。 |
| H05 | Mac v0.5.10 已发布三项资产，Latest 保持 v0.5.9；现有 Windows 0.5.9 资产未动，未生成 Windows 0.5.10 包。 | 本任务只接续源码/隔离测试；Windows 如需验包可用临时构建及既有隔离入口，不替换真实安装、不上传资产、不改标签/Latest。之后发行需用户另行授权。 |
| H06 | Mac 全量结果见下节；Windows UI、DPI、原生、物理触控板、多显示器和真实账户结果必须本机独立登记。 | 无法执行的条目标为“阻塞/待人工”并说明缺少什么，不能记通过或假称 60 项全绿；无依赖的其他项继续完成。退出清理自建 profile/模型/应用副本。 |

## Windows 建议执行顺序与现成入口

先保留已有本机工作、记录提交和 diff，按 A01 同步生成配置；不要直接覆盖有改动的工作树。依赖已安装且锁一致时不重复安装。以下命令在 `windows/` 执行，GUI/原生串行，桌面须解锁且无人控制测试窗口：

```powershell
corepack pnpm typecheck
corepack pnpm check:architecture
corepack pnpm check:workspace
corepack pnpm build
corepack pnpm test
corepack pnpm test:windows:functional
corepack pnpm test:windows:regression
corepack pnpm test:ui:dpi
node ../shared/test/scripts/interview-screenshot-smoke.mjs --native-hits
```

- `test:windows:functional` 转入共用 `functional-suite.mjs`，本版共用列表为 45 组，包含新增 chrome/motion、20 轮面试和 10 分钟 speech-soak；准备固定公开、校验过的临时模型/音频，由既有 `model-fixtures.mjs` 管理，不借真实模型库/资料。
- Windows 原生列表沿用 `windows/test/scripts/windows-suite.mjs --windows`，覆盖 platform/access/effort/layout/workflow/context、updates/user-data、speech-adversarial/AEC/WASAPI/electron-output/components/presentation/RAG 等。需适配时只在 Windows 本机修改，不从 Mac 复制原生实现。
- 现有 DPI runner 覆盖 1、1.25、1.5、1.75、2；当前白名单尚不含新增 `interview-chrome`、`interview-motion`。**不要向白名单直接传未知名字**；Windows 应在本机扩充 runner，或通过既有 `VOXCUE_TEST_SCALE_FACTOR` 接口串行跑这两项并保留同一模型夹具生命周期。原默认 DPI 套件仍完整执行。
- Windows 外层 suite 当前总超时为 900 秒，而共用矩阵包含 600 秒耐久段；本机需核对总耗时预算。若整组被外层超时终止，明确记为未完成，并在 Windows 适配合理总超时后重跑，不能把子项先前输出当作全套通过。
- 定向复测可执行 `node ../shared/test/scripts/functional-suite.mjs web-materials ui-material-refinement interview-chrome interview-motion interview-screenshot interview-retry delete-controls updates-sidebar`，它会准备隔离模型并串行。不能用定向结果替代全套矩阵。
- Windows 打包/原生保存相关入口与安全约定见 `shared/test/README.md` 和旧 0.5.9 交接。`test:portable:native` / `test:installer:isolated` 只在自身临时根验负载，不运行生产安装器。真实系统保存对话框只操作精确 PID/HWND、自建路径，核对保存/取消及原字节一致。

每个 ID 的回传至少包含：`状态（通过/修复后通过/不适用/阻塞待验） | 测试命令/步骤 | 可核对证据 | 修复文件 | 复测结果 | 未覆盖边界`。DPI/主题组合另列矩阵，保留第一次失败原因；“测试脚本退出 0”与“人工视觉已看过”分别记录。

## Mac 已完成验证及不能外推的结论

下表是本轮实际执行记录，不是 Windows 的通过记录。原始临时日志/截图已经按约定清理，保留摘要，不虚构可下载的原始证据。

| 检查 | 本轮 Mac 结果 |
| --- | --- |
| 静态与构建 | Renderer/backend/contracts 类型通过；架构 226 文件、0 违规/运行时环；布局、格式、diff 检查及前后端 noUnusedLocals/noUnusedParameters 通过。 |
| 单元 | 最终 89 文件、900/900 项通过。 |
| 功能 | 59/59 组最终通过（首轮 51/59，修复后分别复跑失败及关联项，再合并最终结果；不是声称一次无失败）。包含账户/聊天/个人信息/知识库/RAG/面试/截图/更新/原生与组件。 |
| UI | 100/125/150/175/200% 五档 × alignment/refinement/screenshot 共 15 项通过，另实际核对浅深色/窄窗截图；修复预览/真实面试局部材质差异。 |
| 稳定性/语音 | 20 轮面试通过；固定公开双通道音频 10 分钟零错误、最大队列 448ms；Qwen 五组涵盖 Metal/CPU、Worker/AEC/重采样、切换、签名薄包推理及进程/句柄释放后删除。 |
| 最终包 | arm64、0.5.10、最低 14.2、固定代码/凭据助手身份、ZIP/清单 Ed25519 与 SHA512、DMG 布局及应用一致性、薄包依赖/敏感内容排除通过；真实隔离应用聊天/PDF/DOCX/Paraformer/AEC/E5-LanceDB 通过，Sparkle 认证暂存/取消通过，无真实安装。 |
| 发布后 | 匿名清单和完整 DMG 下载与本地/服务端摘要一致；实际生产更新客户端选择、认证并下载公开 ZIP，SHA512 通过。临时模型/profile/图片/测试应用退出清理。 |

本版没有把合成服务输出称为真实账号推理通过，没有把检索命中评估称为最终回答准确率，没有认证真人语音、真实用户资料、旧 macOS 实机或 Windows 系统集成。Mac 代码使用现有固定本地签名身份，不能写成 Apple 公证完成。

## 已发布 Mac 资产（只供核对，不上传源码）

正式发行：[NCFXZ/VoxCue-releases v0.5.10](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.5.10)。仅三项 Mac 资产，`Latest` 仍为 v0.5.9。以下文件保留在被忽略的 `macos/release/0.5.10/`，不进入私有源码提交。

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| VoxCue-0.5.10-arm64.dmg | 631072216 | `d13a4dad4e9de9409dbe090a18980f9d7bb02d3c38bfcf6e70da719b2cea46f9` |
| VoxCue-0.5.10-arm64.zip | 586515891 | `d8da23e96d6c14f141ae3786e7b180e02c925c1d8fa71ab491c4a4469e72973c` |
| latest-mac.yml | 492 | `c46879764f429abf04c8e4742588e4ca66571bff8bf1a1dee4436d8080aac78b` |

## 文件级差异清单

以下按 `48c44aa` 到本次提交的实际路径列出，包含共用生产代码、测试适配、Mac 退役文件和说明文档；`M` 修改、`A` 新增、`D` 删除。没有 Windows 专属文件、依赖锁、模型、发行包或私钥。路径均相对仓库根；审查时对照 A–H 项，不把 0.5.9 已有 RAG/归档能力重新记为本版新增。

### 根目录

```text
M  AGENTS.md
M  PROGRESS.md
M  README.md
M  package.json
```

### macos/docs

```text
M  macos/docs/MACOS_PORT.md
```

### macos/electron

```text
M  macos/electron/platform.ts
M  macos/electron/presentation.ts
```

### macos/native

```text
D  macos/native/ContentControls.h
D  macos/native/ContentControls.mm
D  macos/native/InterviewMaterials.h
D  macos/native/InterviewMaterials.mm
M  macos/native/Launcher.mm
D  macos/native/LiquidGlassControls.h
D  macos/native/LiquidGlassControls.mm
D  macos/native/NativeMenu.mm
D  macos/native/ScrollChrome.h
D  macos/native/ScrollChrome.mm
D  macos/native/SidebarGlass.mm
```

### macos/package.json

```text
M  macos/package.json
```

### macos/package.platform.json

```text
M  macos/package.platform.json
```

### macos/renderer.config.mjs

```text
D  macos/renderer.config.mjs
```

### macos/scripts

```text
M  macos/scripts/build-audio.mjs
M  macos/scripts/build-launcher.mjs
M  macos/scripts/build-permissions.mjs
D  macos/scripts/build-sidebar-glass.mjs
M  macos/scripts/launch.mjs
M  macos/scripts/package-app.mjs
M  macos/scripts/package-installer.mjs
```

### macos/src

```text
D  macos/src/MaterialButton.tsx
D  macos/src/MaterialSurface.tsx
D  macos/src/NativeMaterials.tsx
D  macos/src/contentControls.ts
D  macos/src/interviewGlass.ts
D  macos/src/materialGeometry.ts
D  macos/src/menuGlass.ts
D  macos/src/panelGlass.ts
D  macos/src/presentationDocuments.ts
D  macos/src/scrollChrome.ts
D  macos/src/settingsScroll.ts
D  macos/src/sidebarGlass.css
D  macos/src/sidebarGlass.ts
D  macos/src/useGlassControl.ts
D  macos/src/windowFocus.ts
```

### macos/test

```text
D  macos/test/fixtures/SidebarGlassProbe.mm
A  macos/test/fixtures/window-material-probe.mm
D  macos/test/scripts/component-controls-check.mjs
M  macos/test/scripts/components-smoke.mjs
D  macos/test/scripts/content-controls-check.mjs
D  macos/test/scripts/handoff-content-check.mjs
M  macos/test/scripts/icons-smoke.mjs
D  macos/test/scripts/image-save-hit-check.mjs
D  macos/test/scripts/interview-glass-smoke.mjs
M  macos/test/scripts/launcher-smoke.mjs
D  macos/test/scripts/login-controls-check.mjs
M  macos/test/scripts/native-build-smoke.mjs
D  macos/test/scripts/native-ui.mjs
M  macos/test/scripts/package-smoke.mjs
D  macos/test/scripts/progress-controls-check.mjs
M  macos/test/scripts/screen-permission-smoke.mjs
D  macos/test/scripts/sidebar-glass-smoke.mjs
D  macos/test/scripts/sidebar-updates-check.mjs
M  macos/test/scripts/ui-refinement-matrix.mjs
M  macos/test/scripts/user-data-smoke.mjs
M  macos/test/scripts/window-native-smoke.mjs
M  macos/test/unit/icons.test.tsx
M  macos/test/unit/presentation.test.ts
```

### macos/tsconfig.json

```text
M  macos/tsconfig.json
```

### shared/docs

```text
M  shared/docs/ARCHITECTURE.md
M  shared/docs/PLATFORM_UI.md
A  shared/docs/WINDOWS_0.5.10_CODEX_PROMPT.md
A  shared/docs/WINDOWS_0.5.10_HANDOFF.md
M  shared/docs/WINDOWS_0.5.9_CODEX_PROMPT.md
M  shared/docs/WINDOWS_0.5.9_HANDOFF.md
M  shared/docs/WORKSPACE_CLEANUP.md
```

### shared/electron

```text
M  shared/electron/contracts/desktop.ts
M  shared/electron/contracts/presentation.ts
M  shared/electron/main.ts
M  shared/electron/platform/index.ts
M  shared/electron/platform/types.ts
M  shared/electron/preload.ts
M  shared/electron/presentation.ts
M  shared/electron/window.ts
```

### shared/package.json

```text
M  shared/package.json
```

### shared/scripts

```text
M  shared/scripts/format.mjs
M  shared/scripts/sync-platform-manifests.mjs
```

### shared/src

```text
M  shared/src/App.tsx
M  shared/src/components/ChatTools.tsx
M  shared/src/components/DownloadButton.tsx
M  shared/src/components/FloatingInterview.tsx
M  shared/src/components/FollowLatestButton.tsx
M  shared/src/components/HistoryDetail.tsx
M  shared/src/components/HistoryPage.tsx
D  shared/src/components/InterviewSubmissionStatus.tsx
M  shared/src/components/KnowledgePage.tsx
M  shared/src/components/LoginPage.tsx
M  shared/src/components/PreparationPage.tsx
M  shared/src/components/ProfileProposal.tsx
M  shared/src/components/Sidebar.tsx
M  shared/src/components/SidebarUpdate.tsx
M  shared/src/components/TitleBar.tsx
M  shared/src/components/UpdatesPanel.tsx
D  shared/src/components/ui/material-button.tsx
D  shared/src/components/ui/material-surface.tsx
M  shared/src/components/ui/modal.tsx
M  shared/src/components/useFollowScroll.ts
A  shared/src/components/useInterviewPanelMotion.ts
M  shared/src/components/useTextareaSize.ts
M  shared/src/frostedAppearance.ts
M  shared/src/frostedProfiles.ts
M  shared/src/interviewAppearance.ts
M  shared/src/main.tsx
D  shared/src/platform/controls.ts
M  shared/src/platform/materials.ts
M  shared/src/platform/webMaterials.css
M  shared/src/platform/webMaterials.ts
M  shared/src/styles.css
```

### shared/test

```text
M  shared/test/README.md
M  shared/test/scripts/assert-download-button.mjs
M  shared/test/scripts/capture-requested.mjs
M  shared/test/scripts/chatgpt-single-login-smoke.mjs
M  shared/test/scripts/check-architecture.mjs
M  shared/test/scripts/composer-resize-smoke.mjs
M  shared/test/scripts/continuous-corners.mjs
M  shared/test/scripts/copilot-login-smoke.mjs
M  shared/test/scripts/delete-controls-smoke.mjs
M  shared/test/scripts/floating-smoke.mjs
M  shared/test/scripts/functional-suite.mjs
M  shared/test/scripts/history-branding-smoke.mjs
A  shared/test/scripts/interview-chrome-smoke.mjs
A  shared/test/scripts/interview-motion-smoke.mjs
M  shared/test/scripts/interview-retry-smoke.mjs
M  shared/test/scripts/interview-screenshot-smoke.mjs
M  shared/test/scripts/interview-stability-smoke.mjs
M  shared/test/scripts/interview-typography-smoke.mjs
M  shared/test/scripts/interview-ux-smoke.mjs
M  shared/test/scripts/provider-ui-smoke.mjs
M  shared/test/scripts/test-workspace.mjs
M  shared/test/scripts/ui-material-refinement-smoke.mjs
M  shared/test/scripts/ui-ux-smoke.mjs
M  shared/test/scripts/updates-sidebar-smoke.mjs
M  shared/test/scripts/web-materials-smoke.mjs
M  shared/test/unit/architecture.test.ts
M  shared/test/unit/desktop-contract.types.ts
M  shared/test/unit/desktop-ipc.test.ts
M  shared/test/unit/frosted-appearance.test.ts
M  shared/test/unit/platform.test.ts
```

### shared/vite.config.mjs

```text
M  shared/vite.config.mjs
```

完整接续提示词见 [WINDOWS_0.5.10_CODEX_PROMPT.md](WINDOWS_0.5.10_CODEX_PROMPT.md)。
