# Windows 0.5.7 交接（累计补充至0.5.8）：共用布局、胶囊控件与毛玻璃

日期：2026-10-23。交接对象：Windows 本机接续人员或编码代理。

本轮Windows最终代码全量回归、修复及向Mac的逐条接续清单，见[MACOS_0.5.8_HANDOFF.md](MACOS_0.5.8_HANDOFF.md)。用户最新已授权核对后将本轮源码推送至既有私有仓库main，版本保持0.5.8；覆盖本页下文此前仅定向、不提交的限制，不延伸为安装包发行。

**Windows 的页面结构、尺寸、间距和交互以 Mac 最终界面为基准；按钮、下拉触发框使用同款胶囊或圆形，Liquid Glass 材质使用 Windows 毛玻璃替代。** 布局和可以共用的业务继续维护在 `shared/`；回退 Mac 与 Windows 共用一套设计元素。Mac 的 AppKit 控件、Liquid Glass 绑定和承载层留在 `macos/`，Windows 不移植这套原生实现。

本文整理最终实现，覆盖历史交接中与之冲突的椭圆标记、普通矩形按钮、整窗压暗、输入框宽度和重复关闭入口等过程方案。附录包含此次 0.5.6→0.5.7 的全部 125 个变更文件。

## 最新界面修订：固定透明度、悬停控件与弹窗遮罩

用户在 Windows 接续后明确要求三端同步以下调整。本节优先于下文关于透明度滑杆、白色面试、透明弹窗遮罩及边缘光晕的历史描述。

1. 聊天输入区的附件、模型和思考强度，以及提案的展开/收起/查看按钮，默认无底板和阴影，仅悬停或键盘聚焦显示中性底板；布局、菜单、阅读和保存行为保持。
2. 主窗口设置、知识库创建及知识库文档弹窗使用窗口内40%黑色遮罩，保留模态阻止背景操作和焦点恢复，取消弹窗边缘光晕与阴影，不叠加全窗虚化。面试浮窗设置按用户后续要求保留透明背景遮罩，不压暗。
3. 记录搜索保持44px胶囊，左右内边距改为20px，保留系统清除和原筛选。
4. 删除主设置毛玻璃透明度控件；共用材质固定采用原曲线60%的效果，不把60%直接当作表面alpha。
5. 删除主设置及浮窗设置的面试背景透明度控件，固定原面试曲线60%的效果；只留12–24字号控件并水平居中。
6. 实际面试、设置预览及登录只读预览统一深色；主窗口主题仍独立，面试首帧即使用深色。
7. 面试设置取消边缘泛白，不压暗、不虚化后方窗口，模态阻止背景操作和焦点恢复保持；结束确认保持原32px高度、危险色和二次确认，展开时移除圆形图标按钮类型，使用999px圆角的104px宽胶囊且无额外阴影，避免50%圆角被横向拉成椭圆。
8. 记录详情顶部接入聊天同款共用毛玻璃；转写滚入后显示，滚回顶端清空，覆盖完整内容宽度。工具栏自身定位，毛玻璃伪元素只覆盖工具栏实际高度；共享ResizeObserver同步高度，转写滚动视口延伸至其后，标题初始留白和AI回答卡片位置保持。中间正文容器允许转写进入顶部区域，窗口边界仍由workspace裁切；错误提示存在时保留原有正文布局。回归须比较工具栏下方正文的实际像素，并确认顶部确实虚化后方转写，不能只断言backdrop-filter字符串。

共用实现和 Windows/回退路径由本机修改。`macos/`保持只读，Mac 本机仍需处理并实际验收：`sidebarGlass.css`对主设置/知识库的透明遮罩覆盖、`ScrollChrome.mm`/面试原生层的NSShadow光晕、记录详情在`scrollChrome.ts`中的承载入口，以及原生按钮的悬停/确认背板和胶囊轮廓。面试设置本身继续透明遮罩，不能随主设置一起压暗。不要从 Windows 仿制或改写 AppKit 材质；共享的显示标记、字号布局、固定材质参数、确认按钮类型和深色策略已经同步，不能据此宣称这些原生项完成。原生搜索继续使用完整NSSearchField的系统内边距。

旧透明度偏好不再读取或写入，保留原始存储；业务资料、账户、语音与回答流程不变。共用定向入口为`ui-material-refinement`、`web-materials`、`interview-typography`、`interview-ux`、`profile-selection`、`ui-alignment`及`interview-stability`，后者保留20轮开关与4次重载；Windows另运行`presentation-native`检查实际窗口。结果仅在终端/对话报告，不保存新截图，不提交或发行。

## 0. 0.5.8 新增交接（优先于下文历史规格）

本轮以 `f11215f852e7c01655ec2d78f02d716b7504a62e` 为父基线，源码版本为 **0.5.8**。改动未包含在已发布0.5.7安装包中；本次只同步源码，不创建0.5.8安装包或公开发行。文件名按用户要求继续沿用本交接文档。下文0.5.6→0.5.7历史及125项清单保留，冲突处以本节为准。

### 0.1 最终行为与平台差异

| 项目         | 三端共用的最终行为                                                                                                                     | Liquid Glass Mac                                                                                  | Windows / 回退Mac                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 侧栏更新     | 默认36×36圆形；侧栏展开时悬停或键盘聚焦展开图标+文字胶囊，分别为“下载更新”“取消下载”“重启以更新”；移开收回，收起侧栏始终只显示圆形图标 | 侧栏实际玻璃contentView内的标准AppKit Push over-glass，中性柔和底板；不使用亮面Glass bezel        | 直接继承shared中性圆形/胶囊、相同展开及减少动态效果规则  |
| 下载保护     | 进度圆环、首秒不可取消保护、取消红色前景、下载完成状态、面试禁装、安装前保存确认和自动下载偏好保持                                     | 原生层按共享宽度逐帧更新圆形/胶囊，实际点击及取消仍由共享元素处理                                 | 同一共享状态/流程，不复制一套更新逻辑                    |
| 记录搜索     | 44px高胶囊，横跨内容区；筛选、输入、清除及滚动遮挡保持                                                                                 | 完整NSSearchField、ExtraLarge档，由AppKit统一管理图标/占位文字/光标，去掉无边框字段和自建玻璃组合 | shared搜索控件；验证文字、图标及光标无重叠，不移植AppKit |
| 登录按钮     | 原ChatGPT品牌图标与“使用 ChatGPT 继续”整体居中；浅色纯黑、深色纯白；删除按钮下授权说明，认证流程保持                                   | 实际AppKit Glass亮面胶囊；原SVG在构建时嵌入固定原生资源，不开放任意图片路径                       | 保留shared中性材质及同一黑白文字/布局                    |
| 面试预览     | 登录与设置共用只读`InterviewPreview`，呈现当前顶部工具栏、转写/回答双面板、气泡和输入区；不使用旧登录骨架                              | 原生Clear工具栏/面板与Regular阅读/输入表面；面试内容保持深色                                      | 共用毛玻璃及原主题跟随，不复制页面                       |
| 登录右栏背景 | 官网首屏蓝灰/暖橙背景与柔光，浅色提亮、深色降亮（柔光48%）；铺满整栏                                                                   | 独立CoreAnimation背景位于真实原生材质下方                                                         | 相同配色与柔光由shared CSS绘制，无需在线获取官网资源     |
| 边缘与说明   | 两栏交界直角、直线分界，**无交界过渡渐变**；右侧随系统窗口裁切，无白边及预览上下边线；删除“从准备到表达，保持从容。”                   | 整栏原生承载，避免重复裁切形成白边；失败或辅助功能回退恢复shared表面                              | 直接继承shared，不能恢复旧预览、圆角交界或说明文字       |

背景自身的官网配色渐变保留；取消的是两栏交界处的额外淡入过渡。设置预览沿用既有合成底景，不替换为登录背景。Mac登录展示端口仅允许固定品牌按钮、只读over-glass背景，以及最多16项、有且仅有一个专用底景的Clear/Regular材质；这些Mac端口、裁切和绑定不移植到Windows。

### 0.2 实现与检查入口

- 共用实现：`Sidebar.tsx`、`SidebarUpdate.tsx`、`DownloadButton.tsx`负责更新状态与展开；`LoginPage.tsx`、新增`InterviewPreview.tsx`及`InterviewFontSettings.tsx`负责唯一预览布局；`styles.css`与`webMaterials.css`负责回退外观。
- Mac专属：`ContentControls.mm`及`contentControls.ts`负责实际控件；`InterviewMaterials.mm`、`panelGlass.ts`和`sidebarGlass.css`负责登录原生背板与几何；`build-sidebar-glass.mjs`在临时构建目录嵌入既有品牌SVG，不新增依赖或提交生成头文件。
- 展示契约：`shared/electron/contracts/desktop.ts`新增有界`preview-login-scene`；`shared/electron/main.ts`仅对登录窗口开放上述固定展示集合，不扩展业务权限。
- 定向入口：Mac `sidebar-glass-smoke.mjs --login-only`、`--updates-only`及`--content-only`；共用`web-materials`与`updates-sidebar`。完整矩阵新增登录/侧栏更新原生专项，支持Liquid Glass时共55组、旧Mac共50组；新增入口不表示本轮重新执行完整矩阵。
- 包级脚本补充从最终包验证实际原生绑定、三个顶部控件、40px连续输入框、合成聊天及共用选中胶囊；这是此前0.5.7发行验证的延续，本轮未生成或测试0.5.8安装包。

### 0.3 Windows 接续与通过标准

1. 拉取包含本次0.5.8源码的main，在Windows运行 `pnpm sync:workspace`，确认生成的 `windows/package.json` 为0.5.8；不要复制Mac生成配置、依赖锁、原生模块或安装包。
2. 分别检查浅/深色、展开/收起侧栏、鼠标/键盘、禁用及减少动态效果。更新三种操作保持36px高，展开后图标与文字居中；收起侧栏不能展开文字；取消首秒不可执行，完成后显示“重启以更新”。
3. 空搜索框聚焦、输入中文、清除、滚动及缩放：胶囊44px高，图标/文字/光标不重叠，筛选结果正确。
4. 登录浅/深色与860×520最小窗口：黑白文字、图文居中，预览双面板完整、毛玻璃可读；无授权说明、底部标语、上下边线、白边和两栏交界淡入。右栏官网配色背景仍保留并随主题变亮/变暗。
5. 设置字号预览检查12–24字号、滚动及保存，确认共用预览抽取没有影响原设置行为；其底景维持原样。
6. 更新取消/下载完成演示使用合成驱动；若展示“重启以更新”，停在该状态供用户查看，不点击真实安装。真实Windows更新与DPI验收沿用第9节隔离规范。

Mac本轮已完成相关原生/共用回退定向验证，并交付取消交界渐变后的实际Liquid Glass浅深色截图。0.5.8最终生产构建、三组类型、架构/工作区及代码格式检查通过，4份相关单测共52项通过；最终构建的 `login-controls`、`web-materials`、`updates-sidebar` 串行3/3通过。本轮未重跑完整矩阵，详细记录见根目录 `PROGRESS.md`。Windows真机、旧macOS真机及0.5.8正式安装包尚未验收，不能由Mac上的能力模拟替代。

## 1. 基线与接续范围

| 项目                    | 基准                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| 源码仓库                | 私有 `NCFXZ/VoxCue`，`main`                                                                              |
| Mac 0.5.6 比较基线      | `50a0be05058a214bea73828d3884545ba7a6e475`                                                               |
| 0.5.7 实现提交          | `f11215f852e7c01655ec2d78f02d716b7504a62e`                                                               |
| 较早 Windows 0.5.6 提交 | `41a46ec3b740b5052af5dfb37b1b0de26b6f4766`；从此接续须同时保留中间的 Mac 0.5.6 提交                      |
| 版本现状                | `shared/package.json`、根调度器和 Mac 配置为 0.5.8；Windows 生成配置仍为 0.5.6，由 Windows 本机同步0.5.8 |
| 本轮平台文件            | 0.5.7及0.5.8均未改动 `windows/`，也未改动两平台依赖锁                                                    |
| 现行架构说明            | [PLATFORM_UI.md](PLATFORM_UI.md)；协作与范围规则见 [AGENTS.md](../../AGENTS.md)                          |
| 旧版功能背景            | [0.5.6 交接](MACOS_0.5.6_HANDOFF.md)中的重试、截图、字号与模型隔离继续适用；控件外观以本文为准           |

完整变化可按以下范围复核；不要把 Mac 文件逐个覆盖到 Windows 目录。

```sh
git diff --name-status 50a0be05058a214bea73828d3884545ba7a6e475..f11215f852e7c01655ec2d78f02d716b7504a62e
git diff 41a46ec3b740b5052af5dfb37b1b0de26b6f4766..f11215f852e7c01655ec2d78f02d716b7504a62e -- shared
```

若 Windows 仍停留在 `41a46ec`，中间 `50a0be0` 的共享补充也要继承：面试面板标题不收缩、不拆成两行；重试专项补齐等待/活动阶段取消、关闭与销毁，截图和字号专项补齐错误归属及固定字号检查。中间提交的 Mac 打包、签名和模型复用测试只作为 Mac 参考，不复制到 Windows。

## 2. 已共用的内容与 Windows 本机工作

| 项目         | 0.5.7 当前代码                                                        | Windows 接续动作                                                |
| ------------ | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| 页面和布局   | 聊天、设置、面试、个人信息、记录、知识库均在 shared                   | 使用同一实现，逐页核对，不再建 Windows 页面副本                 |
| 控件轮廓     | shared 毛玻璃样式已覆盖胶囊按钮/下拉触发框、圆形图标按钮              | 在真实 Windows 构建核对所有触发入口、菜单门户及禁用状态         |
| 材质         | `webMaterials.ts/css` 提供网页毛玻璃；Windows 主窗口已有 Acrylic 配置 | 区分整窗系统背板与页面内部虚化，完成第4节的覆盖/可读性验收      |
| 原生能力     | preload 把缺失的 `liquidGlass` 严格归一为 false                       | Windows 保持 false，不伪造 true，不启动 Mac 投影或原生观察器    |
| 版本与构建   | 共享版本源已更新，Windows 目录未写入                                  | 在 Windows 执行 `pnpm sync:workspace`，核对本平台生成配置和构建 |
| 下载逻辑     | 单项校验优化已位于共享 ComponentService                               | 检查 Windows Runtime/Qwen 下载、校验、取消和删除释放            |
| 历史与知识库 | UI 精简、卡片布局、标题动作及删除确认已共享                           | 检查真实字体、DPI、输入/搜索、索引和持久化                      |
| Mac 专属修复 | 原生几何、CSSOM 投影、AppKit 鼠标追踪、原子绑定替换等                 | 理解行为目标；Windows 保留原有系统实现及共享 DOM 事件           |
| 测试         | 共享业务/回退与 Mac 实际 Liquid Glass 专项已分开                      | Mac 上的能力模拟不算 Windows 真机验收，须执行第9节              |

## 3. 控件与布局的统一规格

### 3.1 轮廓、尺寸与状态

| 元素                          | Windows 目标，与 Mac 对齐                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| 普通文字/图文按钮、下拉触发框 | 圆弧胶囊，`border-radius: 999px; corner-shape: round`；图标在文字左边，整组视觉居中        |
| 普通单图标按钮                | 36×36px 圆形，与侧栏开关统一；不因图标不同而改变背景直径                                   |
| 面试浮窗及字号预览内图标操作  | 保留当地 32px 控件档，不全局放大到36px；返回最新按钮单独保持36px                           |
| 侧栏聊天记录紧凑删除          | 默认32×32px圆形；展开确认保持32px高                                                        |
| 删除/重置                     | 默认红色图标圆形；第一次点击展开胶囊，第二次才执行；普通两态均36px高                       |
| 确认删除宽度                  | 图标和文字的固有宽度加24px，能够装下内容即可；不恢复常驻128px最小宽                        |
| 创建/重命名编辑窗的取消、保存 | 两个按钮均104px宽                                                                          |
| 开始面试相关三按钮            | 顶部“开始面试”、弹窗“重新检查”和“确认开始”等宽，以顶部实际测量值为准；不要各写一个固定宽度 |
| 返回最新                      | 36px圆形，位于输入框上方，底缘到输入框顶缘10px；材质与所在输入框一致                       |
| 复制/已复制                   | 28px高胶囊命中区，默认不显示背景；悬停/键盘聚焦才显示；保持原字号和行为                    |
| 技能提示、建议、资料提案动作  | 展开/收起、查看、保存所选等均为胶囊；多行内容不挤压图标                                    |
| 侧栏选中标记                  | 导航与聊天记录共用3×18px竖向胶囊，中段等宽、两端半圆，主题色；不能用`50%`做成椭圆          |

胶囊化针对操作控件。侧栏导航行、知识库卡片、历史时间线行等复合点击区域仍保持共享布局。下拉菜单的**触发框和菜单条目**使用胶囊；菜单面板保留20px连续圆角，不把整张菜单拉成长胶囊。主聊天输入框保留40px连续圆角，卡片、气泡和设置窗口也保留各自轮廓。

默认、悬停、键盘聚焦、展开、按下、禁用、窗口失焦分别检查：可操作按钮悬停应提亮；移开恢复；禁用不提亮。展开状态使用对应的悬停反馈，不能留着一次点击后的常驻按下高亮。危险动作保留红色，开始/确认开始保留主题色，发送按钮为主题色底与浅色箭头。

### 3.2 正文与悬浮布局

- 聊天正文最大宽740px；输入框最大宽780px，略宽于正文，底部悬浮，距聊天列底部17px。窄窗继续使用共享宽度计算，不以780px固定撑出窗口。
- 聊天滚动区域延伸到顶部工具栏后方和窗口底部；末尾保留与输入框真实高度联动的留白，最后一行可读。原输入框顶部渐隐移至整个聊天列底部。
- 顶部工具栏共享高度52px；聊天初始正文从72px及实际提示条占位之后开始；管理页内容从76px处避让。不要按截图再添加另一组 Windows 魔法偏移。
- 个人信息卡片上沿避让工具栏，留有外边距；展开/收起、拖动分隔栏、窄窗和缩放时，输入框必须跟随聊天列，不能裁切、跳到错误高度或重复创建表单。
- 个人信息与记录 AI 回答面板为独立的24px圆角卡片，保持边距、分隔线对比和原滚动/调整宽度行为；宽度变化不能使顶栏材质跟着缩窄。
- Mac 红绿灯和 Windows 窗口按钮的系统保留区按各自平台处理；共享正文、工具栏和卡片的相对布局一致，不复制 Mac 红绿灯坐标。

## 4. Liquid Glass → Windows 毛玻璃对应

### 4.1 材质映射

| Mac 最终表面                      | Windows 替代与验收目标                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| 侧栏原生 Regular                  | 保留 Windows 系统 Acrylic/既有毛玻璃承载；共用侧栏内容和胶囊标记，保证正文对比度            |
| 聊天/管理页顶部 Regular           | 页面内毛玻璃覆盖层；没有正文在后方时透明，正文滚入后按覆盖程度渐显并真正虚化                |
| 聊天底部 Regular 输入区           | `webMaterials.css` 的页面内毛玻璃；原40px连续轮廓、780px最大宽、悬浮位置保持                |
| 返回最新 Regular                  | 同一输入区毛玻璃材质、圆形轮廓和阴影；悬停提亮，不变透明，不另造高亮玻璃透镜                |
| 账户/附件/模型/思考强度等 NSMenu  | 共享下拉菜单与页面内毛玻璃；保留全部前置图标、末尾勾选、键盘操作、互斥和贴边定位            |
| 顶部独立 over-glass/Glass 按钮    | 相同圆形/胶囊几何与清楚的悬停、失焦反馈；以 Windows 毛玻璃/控件高光表达，不仿制 AppKit 折射 |
| 普通 content-area 按钮/选择器     | 共享中性胶囊/圆形控件；不把每个内容区按钮都做成亮面玻璃                                     |
| 个人信息等玻璃卡片上的动作        | 同一共用控件语义，按背后表面保证可读性；删除展开后保持原承载层级                            |
| 面试工具栏、转写/回答面板的 Clear | Windows 面试毛玻璃面板；保留同一布局、圆角与阅读区层级，并对明亮底景检查可读性              |
| 面试气泡、输入、异常卡的 Regular  | 共享阅读层毛玻璃，阅读层较外层更清楚；输入与返回按钮一致；截图警告跟随对应回答              |
| “此窗口未隐藏”加深表面            | 单独加深该提示的毛玻璃底色，黄色文字清晰；不能因此压暗整个面试窗口                          |
| 设置窗口四周光晕                  | 浅色界面淡黑、深色界面淡白的边缘阴影；保持模态阻止背景操作，取消整窗压暗/虚化               |
| 字号 NSSlider、更新 NSSwitch      | Windows/回退共用滑杆和开关，保持字号范围、保存、键盘和启用/禁用语义；不接入 Mac API         |

现有共享回退起点：`--web-material-filter: blur(24px) saturate(125%)`；主表面填充由主题和毛玻璃透明度推导，普通控件使用7%中性底色、13%悬停底色。它们是待 Windows 实机核对的当前值，不是要求所有底景使用同一固定透明度。

**页面内部的虚化必须采样窗口内被覆盖的内容。** Windows 主窗口已有 `backgroundMaterial: 'acrylic'`，它不能自动替代聊天顶部/底部的局部虚化。不能只降低网页背景或正文的不透明度来假装毛玻璃，也不能为了实现页内效果另外采集桌面。具体系统背板可遵循 Windows 能力，布局和页面内阅读表面继续共用。

### 4.2 菜单和辅助功能

- 所有下拉保留前置图标，不仅附件和刷新模型；Windows 继续现有 Fluent 图标，Mac 使用 SF Symbols。不同平台图形不必逐像素相同，大小和图文对齐一致。
- 同一窗口一次只开一个菜单。菜单紧贴触发区域，保留可用空间翻转/避让；选中只在末尾打勾，不叠加常驻选中底色。当前键盘项和悬停项可高亮。
- 主界面或面试透明度设为0时，在各自作用范围关闭毛玻璃，使用可读的不透明表面，保持两个设置独立。减少透明度、高对比和强制颜色须同时覆盖主聊天及面试局部变量，避免局部毛玻璃反向恢复。
- Windows 保留主界面“毛玻璃透明度”和独立“面试背景透明度”，保留浅/深/跟随系统。Mac Liquid Glass 才隐藏无效透明度设置并让面试固定深色；不要把这项能力差异强行套到 Windows。

## 5. 逐页变化与 Windows 验收

| 编号              | 0.5.7 最终变化                                                        | Windows 操作及通过标准                                                                |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| U01 侧栏          | 折叠开关圆形；内容区左上角与侧栏交界为直角；选中标记胶囊              | 展开/折叠、导航、切聊天、窄窗；标记3×18不变椭圆，图标和系统保留区不冲突               |
| U02 顶部          | 准备页个人信息/开始为胶囊，开始图文主题色                             | 默认/悬停/禁用/失焦，浅深色均清楚；打开菜单不退回旧轮廓                               |
| U03 顶部覆盖      | 准备、记录、知识库顶栏统一覆盖滚动内容                                | 滚入后局部虚化，退回顶端清空；搜索、复制或正文不能锐利穿透标题                        |
| U04 输入区        | 底部悬浮、40px连续角、780px最大宽，正文740px                          | 输入多行、附件、模型菜单、切聊天、展开个人信息、缩放与重载；无裸控件或文件输入外露    |
| U05 跟随按钮      | 聊天/面试同款圆形和输入材质；距离10px                                 | 上翻暂停跟随，生成三点、结束箭头、回到底部隐藏；点击只定位，不发新请求；悬停提亮      |
| U06 复制          | 复制/已复制无常驻底色，图标左缘与回答正文左缘对齐                     | 两态、悬停、滚入顶部、切聊天；不能残留按钮在标题旁或页面原点                          |
| U07 提示          | 组件缺失/性能提示固定悬浮、有四周阴影、动作胶囊                       | 提示不随聊天滚动；初始消息按实际高度避让，窄窗不盖住输入和正文                        |
| U08 个人信息      | 外边距圆角卡片，顶栏按钮切换，图标位于文字左侧；移除卡片内重复关闭    | 折叠字段/技能后，隐藏操作不可点；展开/收起不挤歪输入区；分割线可辨                    |
| U09 个人信息编辑  | 编辑改为单图标，删除两次确认；模态编辑结束恢复焦点                    | Tab/Enter/Esc、保存/取消、失败重试、流式禁用；模态挡住背景但不破坏恢复焦点            |
| U10 技能/提案     | 技能更新提示、建议、展开/查看/保存所选胶囊                            | 保留原勾选、保存、错误与流式行为，不改变提示词或资料含义                              |
| U11 开场确认      | 重新检查/确认开始与顶部开始等宽；确认图文主题色                       | 普通/长标题/权限未就绪/音频测试中，按钮不溢出且禁用准确                               |
| U12 设置          | 取消全背景压暗；只留窗口边缘光晕；主题与主题色“跟随系统”图形统一      | 面试设置与主设置均在前景；背景不可操作，关闭恢复焦点；Windows 不丢透明度项            |
| U13 字号          | Mac 用 content-area NSSlider；shared 保持12–24、步进1和字号布局       | Windows 滑杆、键盘、保存与跨窗口同步，预览/实际一致；固定UI字号不跟着放大             |
| U14 面试预览      | 使用实际面试的类与结构，增加完整顶部图标和背景层次                    | 对照实际浮窗，主题、字号、输入、气泡、收起状态和留白一致；不透出设置后面的正文        |
| U15 面试顶栏      | 品牌胶囊两侧留白，操作图标在悬停/焦点/操作中显背板                    | 胶囊不贴内容两边；默认图标清楚；结束确认保留胶囊、同高和危险色                        |
| U16 面试可读性    | Mac 外层 Clear 后另加黑底，阅读层 Regular；提示单独加深               | Windows 使用自己的毛玻璃参数，以亮/暗合成底景验证正文、黄色提示和输入清楚，不全窗发白 |
| U17 面试返回/重试 | 返回按钮常驻挂载按状态显隐，修复三点/箭头丢失；重试胶囊               | 长回答、暂停跟随、失败重试、生成中取消、转写开关、缩放；状态和命中准确                |
| U18 面试标题      | “转写”不拆行；设置标题齿轮/开场播放图标无底框                         | 窄窗标题单行，音频状态可自行换行；与 Mac 标题图标承载对齐                             |
| U19 记录列表      | 移除右上数量/本地标签；搜索横跨内容区，保留结果数；无独立清除筛选按钮 | 搜索/清除/空结果/滚动；标题、搜索框和内容互不覆盖；Windows 保留搜索框内清除能力       |
| U20 记录详情      | 返回仅圆箭头；导出、AI回答、删除为顶部玻璃动作；图标左置              | Windows 以对应毛玻璃控件表达，删除展开也同款胶囊；TXT导出、计数及删除行为不变         |
| U21 记录侧卡      | AI回答卡片留外边距，由顶部切换，去掉卡片内重复关闭                    | 窄窗及拖动分隔线；只有左上标题/返回淡入淡出，正文和其余按钮不淡出                     |
| U22 重命名        | 记录/知识库标题旁仅铅笔，悬停/焦点显圆形背景                          | 标题与图标不跳动；编辑窗取消/保存104px，错误和焦点处理正常                            |
| U23 知识库顶部    | 移除说明和搜索区；创建为顶部36px圆形+                                 | 与记录/聊天同类顶部虚化；空库、缺组件、创建与重命名均正确                             |
| U24 文档行        | 只保留二次确认删除，撤掉准备/重新准备/取消准备/预览入口               | 上传后自动索引；进度/失败状态准确；删除同时清理索引，后台检索继续有效                 |
| U25 本地组件      | 去掉所有“已就绪”动作字样；检查/下载时仍保留每行原下载/删除图标        | 冲突操作禁用，其他行不能一并变成校验动画；完成/失败后状态正确                         |
| U26 下载进度      | 16px环形进度和百分比；悬停切红色取消图标、中性底                      | 不露出隐藏X、不把X绘成百分比；保留首秒保护、失败和取消恢复                            |
| U27 单项下载      | 只校验目标组件，启动全局扫描已进行时等其结束；下载中status不重扫      | 对每种语音/RAG组件分别下载；旁边缓存不被扫描，目标摘要校验和原子启用不省略            |
| U28 更新开关      | Mac 改用真实NSSwitch；更新保存逻辑共用                                | Windows 开关按现有毛玻璃控件体系绘制，鼠标/空格、保存、禁用和重启持久化正常           |
| U29 普通操作      | 36px图标、胶囊固有宽度、删除两态等高                                  | 全部设置/账户/知识库/记录/资料入口逐个扫查；危险色、提示、键盘焦点、取消语义一致      |
| U30 滚动与动效    | 聊天滚动条6px低对比透明轨道，记录标题过渡，减少动态回退               | 100–200%DPI无裁切和横向滚动；减少动态时保留可用状态，不能使箭头/焦点消失              |

## 6. shared、Windows 与 Mac 的实现边界

### 6.1 shared 的唯一实现

- `shared/src/components/`：页面、布局、表单、操作语义、状态、滚动和可访问性。非 Liquid Glass 元素（例如选中标记）修改后同时覆盖 Liquid Glass Mac、回退 Mac 和 Windows。
- `shared/src/platform/controls.ts`：按钮和表面端口的纯 props；`ui/material-button.tsx` 返回共享 Button，`ui/material-surface.tsx` 直接返回已有子树，不创建 Windows 原生投影。
- `shared/src/platform/webMaterials.ts/css`：共同回退材质、控件轮廓、悬停、菜单、顶部、输入区、设置光晕和辅助功能回退。`chromeGeometry.ts` 共用背后内容覆盖计算，避免每平台另写一套滚动条件。
- `shared/src/components/ui/appearance-control.tsx`：读取能力决定设置项，不按“Mac/Windows”复制设置页面；保留非 Liquid Glass 的透明度和主题跟随。
- `shared/electron/`：账户/聊天、持久化、RAG/知识库、组件管理、语音协调、取消与通用生命周期，以及经过校验的展示 IPC 契约。
- `shared/vite.config.mjs`：可选加载当前平台 `renderer.config.mjs`，不再保存 Mac 图标和控件替换清单。Windows 没有扩展时直接用 shared；不得为了材质复制页面。

### 6.2 Windows 本机需重点补查的差异

当前 shared 已包含主体实现，但“已存在回退”不等于所有细节已与 Mac 一致。以下规则在 Mac 样式或原生控件里还具有额外处理，接续时须实测后补到共用回退，不能仅把 `.macos-ui` 改名成 Windows：

| 待核对点         | 源码线索与处理原则                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文字按钮宽度     | Mac 内容区文字按钮有20px横向内边距；shared 普通按钮基础为12px。按 Mac 的最终视觉留白对齐共用回退，同时保留确认删除“固有内容+24px”及104px编辑窗的特例 |
| 搜索外观         | Mac `NSSearchField` 为胶囊、36px档；Windows 当前保留 `input[type=search]`，核对其胶囊、清除按钮、图标和宽度，不接入 Mac 搜索投影                     |
| 面试顶栏两端     | Mac 外层工具栏横向18px，品牌内部14px；shared 回退已有品牌14px。外层留白若仍不一致，将适合共用的布局补到 shared，避免阴影紧贴图标                     |
| 面试标题图标     | Mac 有去底框的标题图标处理；Windows 对照24px无背景/无边框/无阴影承载，不盲目复用系统bezel补偿                                                        |
| 顶部亮面例外     | Mac 明确指定的准备页顶栏、知识库+、记录详情操作应在 Windows 有相应层次；普通内容按钮保持中性，不整体做亮面                                           |
| 面试可读性和警示 | Mac 的78%黑底及提示黑色tint属于原生实现；Windows 检查自己毛玻璃的层级和对比，局部加强，不照抄原生背板API                                             |
| 复制对齐         | Mac 用系统内容内边距补偿，shared回退为`margin-left:-9px`。按 Windows 实际图标与正文左缘测量，不能复制Mac的-12px补偿                                  |
| 失焦/启用状态    | Mac 交给原生控件和窗口外观；Windows 需验证自己的焦点/禁用反馈，不套用Mac常量或取消Windows可访问焦点                                                  |

普通布局或回退样式的补齐应进入 shared，使旧 Mac 和 Windows 同时得到改动。确实依赖 Windows 系统的窗口背板、标题栏、采集、权限、凭据、更新执行、原生拖动/缩放仍位于 `windows/`；本机接续时 `macos/` 只读。

### 6.3 Mac 专属实现供行为参考

Mac 新增 `renderer.config.mjs`、AppKit绑定及`macos/src/`适配器：真实Electron前景进入`NSGlassEffectView.contentView`，Regular/Clear、NSButton、NSSwitch、NSSlider、NSSearchField、NSMenu负责原生绘制。Windows只继承语义和布局目标。

此次还修复了原生几何参数漏读高度导致的顶栏错位、父玻璃移动时控件重复位移、复制越过顶栏、返回按钮/输入投影命中竞争、构建后旧哈希CSS加载失败导致裸表单、浅色主窗口下预览发白。原生绑定改为完整编译/签名后原子替换，投影复用已加载CSSOM，失败恢复共享表面。这些属于 Mac 生命周期；Windows 不应新增相同投影来“保持一致”，应直接验收共享 DOM 在上述场景下稳定。

## 7. 业务、协议与清理改动

### 7.1 单个组件下载

`ComponentService.check(id?)` 可以限定目标组件。单项下载等待正在执行的启动检查，然后只重新认证所选缓存；下载进行中`status()`直接返回已有状态。其他组件的就绪信息保持，下载后完整归档/逐文件摘要、原子启用、取消和暂存清理继续执行。未指定单项的全局检查仍保留完整逻辑。

UI去掉就绪标签，保留检查前各行下载/删除形态和冲突禁用。Windows需连同Qwen Runtime、CPU/CUDA切换、释放后删除及离线复用验证，不能用“不扫描其他组件”为由削减目标包完整性校验。

### 7.2 展示契约与安全边界

`contracts/desktop.ts`、`contracts/presentation.ts`、`preload.ts`、`presentation.ts`和`main.ts`新增有界原生展示能力：侧栏/固定动作按钮、滚动顶部与前景表面、菜单、内容按钮/搜索/开关/滑杆、面试材质及受控事件。主进程检查窗口、主frame、固定动作、数量、坐标和类型。Windows缺少对应实现时保持共享控件可用，不假定这些可选端口成功，也不放宽IPC检查。

`liquidGlass`是能力元数据，不是授权。Windows的`liquidGlass`保持false；不设置`.sidebar-liquid-glass`、`.native-scroll-chrome`、`.macos-interview-glass`等表示原生安装成功的标记，不因这些共享契约存在就隐藏网页控件。

### 7.3 已清理内容

- 已移除的Mac Liquid Glass设置开关、专用写入/订阅/IPC及原生configureSwitch分支；保留旧偏好只读兼容、辅助功能回退和现用自动下载更新开关。
- 不再单独维护Mac AppearanceControl副本，能力策略和非原生设置共用。
- 知识库页面撤掉手动准备/重建/取消准备/预览及旧搜索展示状态、方法和死样式；自动索引、后台检索、索引删除及服务端取消能力保留。检索模式仍可在既有设置中使用。
- 移除个人信息不用的onClose属性、卡片内重复关闭、旧状态/按钮覆盖和无消费者样式；保留动态入口、Worker、utilityProcess、preload和测试助手。
- 本轮未升级依赖、改动锁或模型权重，未重写提示词、语音采集算法、RAG检索算法及旧记录格式；核心业务沿用0.5.6。

清理不等于删除现用运行时/构建。Windows接续清理先核对静态/动态消费者、真实路径、占用和未提交工作；保护模型、固定运行时、依赖/锁、发行和恢复基线，不重试历史跳过目录。

## 8. Windows 执行顺序

1. 阅读当前`AGENTS.md`、本文、`PLATFORM_UI.md`和测试说明；核对分支、未提交修改及源码是否包含`f11215f`。安全拉齐主线，保护本机改动。
2. 在Windows仓库根运行`pnpm sync:workspace`。由共享源生成本平台0.5.8配置，核对变更清单；依赖按Windows冻结锁安装，不升级版本或把Mac锁复制过来。
3. 先构建当前shared回退，逐项执行第3–5节。已经共用的改动先验收，缺口再修复；第6.2节特别核对，不从旧版Windows截图重新设计。
4. 共用布局/控件问题修在shared；系统背板、标题栏及Windows原生问题修在windows。Mac专属只读，不为了Windows复制AppKit或整页源码。
5. 完成静态、单测、共享功能、Windows原生、五档DPI及模型隔离回归。GUI/原生鼠标操作串行，失败直接修复后复测相关范围。
6. 交付Windows实际变更、逐项验收范围与剩余限制。提交、安装包发行、标签/Latest或真实安装替换继续按当次明确授权执行；本文不触发这些外部操作。

以后新提出的界面/布局需求，按AGENTS先确认要覆盖Liquid Glass Mac、回退Mac、Windows中的哪些路径并提出建议。本文已经明确“共用布局与普通元素同步、Windows用毛玻璃”，落实本文时不必重复询问这一范围。

## 9. Windows 本机验收入口

以下命令供Windows本机执行。本次Mac的实际Liquid Glass检查和共用回退能力模拟，只提供行为参考；Windows的系统材质、标题栏、字体、DPI、输入和原生运行时仍待Windows验收。

仓库根基础检查：

```powershell
pnpm sync:workspace
pnpm check:workspace
pnpm check:architecture
pnpm typecheck
pnpm build
pnpm test
```

Windows共享、原生与DPI矩阵：

```powershell
pnpm test:windows:functional
pnpm test:windows:regression
pnpm test:ui:dpi
```

`functional-suite.mjs`当前Windows共享范围36组，含新增`web-materials`；Windows专属入口保留15组，DPI默认100/125/150/175/200%各9组。执行时以当前脚本清单为准，不把Mac三组Liquid Glass专项算作Windows通过项。

针对本轮界面的集中复核，在`windows/`中运行：

```powershell
node ../shared/test/scripts/functional-suite.mjs web-materials composer chat-response chat-progress profile-ui profile-selection history-branding provider-ui knowledge rag-ui delete-controls ui-alignment ui-refinement ui-ux typography interview-ux interview-typography interview-retry interview-screenshot updates updates-sidebar components-ui
```

`--dpi`现有白名单尚不包含`web-materials`，因此除默认45项外，需在五档缩放逐项检查新增顶部/输入毛玻璃、菜单、复制对齐、圆形图标和胶囊展开；需要自动化时在Windows本机补充测试清单，保留既有断言。桌面未解锁时报告环境条件，不跳过真实指针或DPI检查。

视觉验收至少覆盖：浅/深/跟随系统、普通/最小窗、个人信息/AI回答卡片展开收起、长中文和长模型名、菜单上下翻转、滚动顶部遮挡、输入多行、字体12/14/18/24、生成/暂停/重试/取消、禁用/焦点/失焦，以及第5节U01–U30。

业务回归保持0.5.6的四次总尝试和0.5/1/2秒等待、原请求快照、截图原图复用、停止/退出取消与迟到保护；检查真实E5/LanceDB检索、语音模型切换/释放/删除、WASAPI合成设备时钟及Windows更新生命周期。实际模型使用固定公开资源下载至隔离临时目录，或经明确授权的缓存只读认证后复制；不能自动发现正式缓存或直接对正式目录调用status/download/remove。

全部测试使用合成账户、资料、捕获端口和固定公开音频，不读取真实凭据/简历/知识库或采样硬件。GUI串行，临时模型/profile/截图/缓存退出清理，结果只在终端/对话；测试源码与固定输入可纳入Git，模型、构建、安装包及测试产物不入Git。详细入口见[测试说明](../test/README.md)。

## 10. 完整变更文件清单

下表由`50a0be0..f11215f`的`git diff --name-status`逐项整理，共125个文件（82项修改、43项新增）。A为新增，M为修改。Windows接续不需要改动每个文件；“Mac专属”表示拉齐源码后只读参考。

### 10.1 根入口与共享文档

| 状态 | 文件                                                     | 改动说明                                                    |
| ---- | -------------------------------------------------------- | ----------------------------------------------------------- |
| M    | [AGENTS.md](../../AGENTS.md)                             | 平台分类、共用元素同步与后续界面范围确认规则；0.5.7协作边界 |
| M    | [PROGRESS.md](../../PROGRESS.md)                         | 实现演进、布局/材质与清理说明；最终规则以本交接为准         |
| M    | [README.md](../../README.md)                             | 0.5.7源码状态、原生/回退分类及入口                          |
| M    | [package.json](../../package.json)                       | 根调度版本0.5.7及原生材质构建命令                           |
| M    | [shared/docs/ARCHITECTURE.md](ARCHITECTURE.md)           | 共享布局/端口与平台材质的架构界限                           |
| M    | [shared/docs/HANDOFF.md](HANDOFF.md)                     | 0.5.7接续入口和现行布局/材质规则                            |
| A    | [shared/docs/PLATFORM_UI.md](PLATFORM_UI.md)             | 三条展示路径的目录分类、能力与回退说明                      |
| M    | [shared/docs/WORKSPACE_CLEANUP.md](WORKSPACE_CLEANUP.md) | 删除弃用UI/IPC/样式及保护动态入口的说明                     |

### 10.2 共享生产实现

| 状态 | 文件                                                                                                 | 改动说明                                             |
| ---- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| M    | [shared/electron/backend/components/service.ts](../electron/backend/components/service.ts)           | 单项下载仅认证目标；下载中status不触发全局扫描       |
| M    | [shared/electron/contracts/desktop.ts](../electron/contracts/desktop.ts)                             | 原生按钮/菜单/滚动/内容控件/面试表面有界契约         |
| M    | [shared/electron/contracts/presentation.ts](../electron/contracts/presentation.ts)                   | 可选liquidGlass能力，pending默认false                |
| M    | [shared/electron/main.ts](../electron/main.ts)                                                       | 展示IPC窗口/frame/参数校验及主进程装配               |
| M    | [shared/electron/platform/index.ts](../electron/platform/index.ts)                                   | 只为当前平台解析原生展示绑定资源                     |
| M    | [shared/electron/platform/types.ts](../electron/platform/types.ts)                                   | 平台绑定文件的可选声明                               |
| M    | [shared/electron/preload.ts](../electron/preload.ts)                                                 | 只读能力归一化及受控展示调用/订阅                    |
| M    | [shared/electron/presentation.ts](../electron/presentation.ts)                                       | 原生展示适配接口，业务和平台执行解耦                 |
| M    | [shared/package.json](../package.json)                                                               | 唯一共享版本源0.5.7；依赖不变                        |
| M    | [shared/scripts/format.mjs](../scripts/format.mjs)                                                   | 仅当前平台renderer源码/扩展配置进入格式化范围        |
| M    | [shared/src/components/ComponentsPanel.tsx](../src/components/ComponentsPanel.tsx)                   | 去掉已就绪标签，检查时保留行图标与状态               |
| M    | [shared/src/components/FloatingInterview.tsx](../src/components/FloatingInterview.tsx)               | 原生能力主题策略、重试类、返回按钮常驻显隐           |
| M    | [shared/src/components/FollowLatestButton.tsx](../src/components/FollowLatestButton.tsx)             | 共用表面端口、三点/箭头、可见状态与唯一点击行为      |
| M    | [shared/src/components/HistoryDetail.tsx](../src/components/HistoryDetail.tsx)                       | 顶部图标动作、标题重命名与留边AI卡片                 |
| M    | [shared/src/components/HistoryPage.tsx](../src/components/HistoryPage.tsx)                           | 精简顶栏、全宽搜索、移除独立清除及局部标题过渡       |
| M    | [shared/src/components/InterviewAnswerStatus.tsx](../src/components/InterviewAnswerStatus.tsx)       | 重试按钮展示标记，与面试原生/回退样式对齐            |
| M    | [shared/src/components/InterviewDisplayControls.tsx](../src/components/InterviewDisplayControls.tsx) | 按能力保留透明度；单字号布局和共用滑杆               |
| M    | [shared/src/components/InterviewFontSettings.tsx](../src/components/InterviewFontSettings.tsx)       | 真实结构预览、完整顶栏图标和能力主题策略             |
| M    | [shared/src/components/InterviewSettingsPanel.tsx](../src/components/InterviewSettingsPanel.tsx)     | 标题图标结构与共用模态对齐                           |
| M    | [shared/src/components/KnowledgePage.tsx](../src/components/KnowledgePage.tsx)                       | 顶部+、标题旁重命名、文档仅删除及旧操作清理          |
| M    | [shared/src/components/PersonalInfoPanel.tsx](../src/components/PersonalInfoPanel.tsx)               | 卡片顶部切换、单图标编辑及模态返回焦点               |
| M    | [shared/src/components/PreparationPage.tsx](../src/components/PreparationPage.tsx)                   | 顶部端口、浮动输入、提示避让、开场等宽按钮和滚动布局 |
| M    | [shared/src/components/SettingsDialog.tsx](../src/components/SettingsDialog.tsx)                     | 共用外观能力控件、跟随系统图标及旧内联滑杆清理       |
| M    | [shared/src/components/Sidebar.tsx](../src/components/Sidebar.tsx)                                   | 侧栏开关使用共用MaterialButton端口                   |
| M    | [shared/src/components/UpdatesPanel.tsx](../src/components/UpdatesPanel.tsx)                         | 更新开关受控原生展示标记，业务仍共用                 |
| M    | [shared/src/components/icons.tsx](../src/components/icons.tsx)                                       | Windows/回退跟随系统图标导出                         |
| A    | [shared/src/components/ui/appearance-control.tsx](../src/components/ui/appearance-control.tsx)       | 唯一外观设置与Liquid Glass能力策略                   |
| M    | [shared/src/components/ui/confirm-delete-button.tsx](../src/components/ui/confirm-delete-button.tsx) | 确认固有宽度、36/32px两态、危险色及取消语义          |
| A    | [shared/src/components/ui/material-button.tsx](../src/components/ui/material-button.tsx)             | 共享Button回退适配                                   |
| A    | [shared/src/components/ui/material-surface.tsx](../src/components/ui/material-surface.tsx)           | 原子树直通的共享表面回退                             |
| M    | [shared/src/components/ui/modal.tsx](../src/components/ui/modal.tsx)                                 | 标题旁动作插槽，保留模态和焦点语义                   |
| M    | [shared/src/components/useFollowScroll.ts](../src/components/useFollowScroll.ts)                     | 布局变化时仅在跟随状态同步末尾                       |
| M    | [shared/src/main.tsx](../src/main.tsx)                                                               | 入口安装共用webMaterials及作用域                     |
| A    | [shared/src/platform/chromeGeometry.ts](../src/platform/chromeGeometry.ts)                           | 按所有覆盖内容共用计算顶部材质显隐                   |
| A    | [shared/src/platform/controls.ts](../src/platform/controls.ts)                                       | 按钮/表面props的纯展示契约                           |
| A    | [shared/src/platform/webMaterials.css](../src/platform/webMaterials.css)                             | 旧Mac/Windows胶囊/圆形、毛玻璃和辅助功能样式         |
| A    | [shared/src/platform/webMaterials.ts](../src/platform/webMaterials.ts)                               | 回退启停、内容/滚动/缩放观察及清理                   |
| M    | [shared/src/stores/knowledgeIndex.ts](../src/stores/knowledgeIndex.ts)                               | 清理废弃手动索引/搜索展示状态，保留任务订阅          |
| M    | [shared/src/styles.css](../src/styles.css)                                                           | 共用尺寸、悬浮布局、卡片、胶囊标记和旧样式清理       |
| M    | [shared/vite.config.mjs](../vite.config.mjs)                                                         | 公共构建仅加载当前平台renderer扩展                   |

### 10.3 共享测试源码与说明

| 状态 | 文件                                                                                         | 改动说明                                         |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| M    | [shared/test/README.md](../test/README.md)                                                   | 区分共享回退、实际Mac Glass和各平台原生入口      |
| M    | [shared/test/scripts/assert-download-button.mjs](../test/scripts/assert-download-button.mjs) | 按图标、圆环/百分比、取消和禁用检查下载控件      |
| M    | [shared/test/scripts/chat-progress-smoke.mjs](../test/scripts/chat-progress-smoke.mjs)       | 进度/资料提案适配当前布局，保留流式行为断言      |
| M    | [shared/test/scripts/chat-response-smoke.mjs](../test/scripts/chat-response-smoke.mjs)       | 聊天输入/正文/复制及当前结构定位                 |
| M    | [shared/test/scripts/check-architecture.mjs](../test/scripts/check-architecture.mjs)         | 平台替换端口与共享依赖边界检查                   |
| M    | [shared/test/scripts/components-ui-smoke.mjs](../test/scripts/components-ui-smoke.mjs)       | 组件独立状态、行图标和新版下载控件               |
| M    | [shared/test/scripts/continuous-corners.mjs](../test/scripts/continuous-corners.mjs)         | 区分胶囊/圆形和连续卡片，保留实际裁切检查        |
| M    | [shared/test/scripts/delete-controls-smoke.mjs](../test/scripts/delete-controls-smoke.mjs)   | 固有宽度、两态等高、紧凑/普通尺寸和删除保护      |
| M    | [shared/test/scripts/electron-smoke.mjs](../test/scripts/electron-smoke.mjs)                 | 当前知识库/侧栏界面及应用流程定位                |
| M    | [shared/test/scripts/functional-suite.mjs](../test/scripts/functional-suite.mjs)             | 实际Mac Glass优先、共享回退独立编译和能力分流    |
| M    | [shared/test/scripts/interview-ux-smoke.mjs](../test/scripts/interview-ux-smoke.mjs)         | 同类面试控件尺寸/样式与实际结构适配              |
| M    | [shared/test/scripts/knowledge-smoke.mjs](../test/scripts/knowledge-smoke.mjs)               | 自动索引、精简动作和文档删除流程                 |
| M    | [shared/test/scripts/profile-ui-smoke.mjs](../test/scripts/profile-ui-smoke.mjs)             | 资料编辑/删除/提案与当前卡片结构适配             |
| M    | [shared/test/scripts/provider-ui-smoke.mjs](../test/scripts/provider-ui-smoke.mjs)           | Provider菜单、能力和当前控件结构适配             |
| M    | [shared/test/scripts/rag-core-smoke.mjs](../test/scripts/rag-core-smoke.mjs)                 | 本机原生测试进程使用平台合适的测试宿主           |
| M    | [shared/test/scripts/rag-ui-smoke.mjs](../test/scripts/rag-ui-smoke.mjs)                     | 实际自动索引、hybrid/keyword/vector检索和QA流程  |
| M    | [shared/test/scripts/test-workspace.mjs](../test/scripts/test-workspace.mjs)                 | 隔离临时renderer、原生能力测试边界与固定签名宿主 |
| M    | [shared/test/scripts/typography-smoke.mjs](../test/scripts/typography-smoke.mjs)             | 正文/辅助字号、按钮对比、当前搜索及模态命中检查  |
| M    | [shared/test/scripts/ui-alignment-smoke.mjs](../test/scripts/ui-alignment-smoke.mjs)         | 悬浮输入、卡片、标题及同类控件尺寸检查           |
| M    | [shared/test/scripts/ui-refinement-smoke.mjs](../test/scripts/ui-refinement-smoke.mjs)       | 卡片显隐、焦点恢复和交互约束                     |
| M    | [shared/test/scripts/ui-ux-smoke.mjs](../test/scripts/ui-ux-smoke.mjs)                       | 胶囊标记、菜单、控件和当前布局断言               |
| M    | [shared/test/scripts/updates-sidebar-smoke.mjs](../test/scripts/updates-sidebar-smoke.mjs)   | 侧栏更新圆形/进度/禁用与布局检查                 |
| A    | [shared/test/scripts/web-materials-smoke.mjs](../test/scripts/web-materials-smoke.mjs)       | 非原生胶囊/圆形、毛玻璃、复制对齐、悬停与窄窗    |
| M    | [shared/test/unit/architecture.test.ts](../test/unit/architecture.test.ts)                   | 验证Mac适配端口不得反依赖网页回退组件            |
| M    | [shared/test/unit/components.test.ts](../test/unit/components.test.ts)                       | 单项认证、旁项不扫描、并发status及目标损坏恢复   |
| M    | [shared/test/unit/desktop-ipc.test.ts](../test/unit/desktop-ipc.test.ts)                     | 受控展示IPC及能力类型/参数检查                   |
| M    | [shared/test/unit/knowledge-index-store.test.ts](../test/unit/knowledge-index-store.test.ts) | 移除废弃UI搜索状态用例，保留索引生命周期检查     |

### 10.4 Mac专属生产实现及说明（Windows只读）

| 状态 | 文件                                                                                 | 改动说明                                              |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| M    | [macos/docs/MACOS_PORT.md](../../macos/docs/MACOS_PORT.md)                           | Mac专属实现、公开API与原生验收边界                    |
| M    | [macos/electron/platform.ts](../../macos/electron/platform.ts)                       | 选择Mac原生展示绑定资源                               |
| M    | [macos/electron/presentation.ts](../../macos/electron/presentation.ts)               | 原生能力、窗口/材质承载、控件事件与生命周期           |
| A    | [macos/native/ContentControls.h](../../macos/native/ContentControls.h)               | 内容区原生控件接口                                    |
| A    | [macos/native/ContentControls.mm](../../macos/native/ContentControls.mm)             | NSButton/NSPopUpButton、搜索、更新开关及字号滑杆      |
| A    | [macos/native/InterviewMaterials.h](../../macos/native/InterviewMaterials.h)         | 面试材质接口                                          |
| A    | [macos/native/InterviewMaterials.mm](../../macos/native/InterviewMaterials.mm)       | 面试Clear/Regular、黑底、裁切和局部外观               |
| A    | [macos/native/LiquidGlassControls.h](../../macos/native/LiquidGlassControls.h)       | 固定顶部动作与原生菜单声明                            |
| A    | [macos/native/LiquidGlassControls.mm](../../macos/native/LiquidGlassControls.mm)     | 侧栏/个人信息/开始原生圆形和胶囊按钮                  |
| A    | [macos/native/NativeMenu.mm](../../macos/native/NativeMenu.mm)                       | NSMenu前置图标、勾选、禁用和定位                      |
| A    | [macos/native/ScrollChrome.h](../../macos/native/ScrollChrome.h)                     | 顶部/输入/返回表面接口                                |
| A    | [macos/native/ScrollChrome.mm](../../macos/native/ScrollChrome.mm)                   | Regular表面、前景承载、裁切、命中与模态光晕           |
| A    | [macos/native/SidebarGlass.mm](../../macos/native/SidebarGlass.mm)                   | Liquid Glass绑定、contentView、窗口背景还原及参数读取 |
| M    | [macos/package.json](../../macos/package.json)                                       | 本平台生成版本0.5.7和原生材质构建步骤                 |
| M    | [macos/package.platform.json](../../macos/package.platform.json)                     | Mac构建脚本源增加sidebar-glass                        |
| A    | [macos/renderer.config.mjs](../../macos/renderer.config.mjs)                         | Mac入口、SF Symbols和三个展示适配端口；打包边界       |
| A    | [macos/scripts/build-sidebar-glass.mjs](../../macos/scripts/build-sidebar-glass.mjs) | Node-API绑定编译/签名后原子替换，保护运行中旧映射     |
| M    | [macos/scripts/package-app.mjs](../../macos/scripts/package-app.mjs)                 | 原生材质资源纳入Mac临时/正式打包装配                  |
| A    | [macos/src/MaterialButton.tsx](../../macos/src/MaterialButton.tsx)                   | 固定动作原生按钮及能力不可用时共享回退                |
| A    | [macos/src/MaterialSurface.tsx](../../macos/src/MaterialSurface.tsx)                 | 输入/返回原生前景投影、CSSOM样式与失败恢复            |
| A    | [macos/src/contentControls.ts](../../macos/src/contentControls.ts)                   | 内容控件识别、表面类型、几何/裁切与受控值同步         |
| M    | [macos/src/icons.tsx](../../macos/src/icons.tsx)                                     | 跟随系统主题图标的Mac导出                             |
| A    | [macos/src/interviewGlass.ts](../../macos/src/interviewGlass.ts)                     | 面试/预览材质几何、按钮与深色原生层                   |
| A    | [macos/src/liquidGlassPreference.ts](../../macos/src/liquidGlassPreference.ts)       | 旧Liquid Glass/透明度偏好只读兼容及订阅               |
| A    | [macos/src/materialGeometry.ts](../../macos/src/materialGeometry.ts)                 | Mac展示几何与裁切计算                                 |
| A    | [macos/src/menuGlass.ts](../../macos/src/menuGlass.ts)                               | 共享菜单内容转换到原生NSMenu                          |
| A    | [macos/src/panelGlass.ts](../../macos/src/panelGlass.ts)                             | 面试设置预览的原生材质、合成底景与裁切                |
| A    | [macos/src/presentationDocuments.ts](../../macos/src/presentationDocuments.ts)       | 主文档/前景投影文档协调                               |
| A    | [macos/src/scrollChrome.ts](../../macos/src/scrollChrome.ts)                         | 聊天/管理页顶部覆盖与原生滚动几何发布                 |
| A    | [macos/src/settingsScroll.ts](../../macos/src/settingsScroll.ts)                     | 设置滚动几何合帧发布，避免控件与文字错位              |
| A    | [macos/src/sidebarGlass.css](../../macos/src/sidebarGlass.css)                       | Mac原生透明占位、控件补偿及材质专属样式               |
| A    | [macos/src/sidebarGlass.ts](../../macos/src/sidebarGlass.ts)                         | Mac原生材质安装/卸载与能力回退入口                    |
| M    | [macos/src/symbols.json](../../macos/src/symbols.json)                               | 新增跟随系统SF Symbol映射                             |
| A    | [macos/src/useGlassControl.ts](../../macos/src/useGlassControl.ts)                   | 固定原生按钮的状态、指针和几何同步                    |
| A    | [macos/src/windowFocus.ts](../../macos/src/windowFocus.ts)                           | Mac主窗口焦点外观同步                                 |

### 10.5 Mac专属测试（不能作为Windows验收）

| 状态 | 文件                                                                                                     | 改动说明                                              |
| ---- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| A    | [macos/test/fixtures/SidebarGlassProbe.mm](../../macos/test/fixtures/SidebarGlassProbe.mm)               | 自有合成窗口的原生视图、鼠标/菜单与材质探针           |
| A    | [macos/test/scripts/component-controls-check.mjs](../../macos/test/scripts/component-controls-check.mjs) | 组件进度、提示条、取消与下载按钮原生界面检查          |
| M    | [macos/test/scripts/components-smoke.mjs](../../macos/test/scripts/components-smoke.mjs)                 | 临时签名应用的组件、ASR/RAG与原生资源检查             |
| A    | [macos/test/scripts/content-controls-check.mjs](../../macos/test/scripts/content-controls-check.mjs)     | 原生内容按钮/菜单、搜索/开关/滑杆、设置与管理页检查   |
| M    | [macos/test/scripts/icons-smoke.mjs](../../macos/test/scripts/icons-smoke.mjs)                           | 投影输入区、原生菜单、透明度能力与图标检查适配        |
| A    | [macos/test/scripts/interview-glass-smoke.mjs](../../macos/test/scripts/interview-glass-smoke.mjs)       | 真实面试Liquid Glass、可读性、返回/重试与窗口生命周期 |
| M    | [macos/test/scripts/native-build-smoke.mjs](../../macos/test/scripts/native-build-smoke.mjs)             | 绑定导出、旧系统最低版本/弱链接和既有原生ABI检查      |
| A    | [macos/test/scripts/native-ui.mjs](../../macos/test/scripts/native-ui.mjs)                               | 投影输入页和原生菜单的共用测试助手                    |
| M    | [macos/test/scripts/screen-permission-smoke.mjs](../../macos/test/scripts/screen-permission-smoke.mjs)   | 权限测试的隔离账户/凭据边界适配                       |
| A    | [macos/test/scripts/sidebar-glass-smoke.mjs](../../macos/test/scripts/sidebar-glass-smoke.mjs)           | 实际主窗口Glass、胶囊标记、输入/菜单/缩放/重载检查    |
| M    | [macos/test/scripts/user-data-smoke.mjs](../../macos/test/scripts/user-data-smoke.mjs)                   | 迁移测试兼容投影输入和原生附件菜单                    |
| M    | [macos/test/scripts/window-native-smoke.mjs](../../macos/test/scripts/window-native-smoke.mjs)           | 原生窗口几何、投影草稿与侧栏位置检查                  |
| M    | [macos/test/unit/icons.test.tsx](../../macos/test/unit/icons.test.tsx)                                   | Mac图标映射与实际资源约束                             |
| A    | [macos/test/unit/liquid-glass-preference.test.ts](../../macos/test/unit/liquid-glass-preference.test.ts) | 旧偏好读取、非法值和透明度兼容                        |
| M    | [macos/test/unit/presentation.test.ts](../../macos/test/unit/presentation.test.ts)                       | 有界展示资源、能力与生命周期                          |

## 11. 可交给 Windows 接续任务的说明

> 请在Windows本机以本文件为0.5.6→0.5.8累计交接规格，先核对源码包含f11215f及本轮0.5.8补充，再同步本平台生成配置到0.5.8。页面布局、尺寸、间距和交互以Mac最终界面及shared唯一实现为准；普通按钮和下拉触发框胶囊、单图标圆形，保留本文的36/32/28px与40px输入框特例。聊天顶部、底部、菜单和面试等原生Liquid Glass表面，在Windows使用可读的毛玻璃替代。优先验收已共用的改动，重点补查第6.2节仍受Mac样式/原生控件影响的间距、搜索和状态反馈，不复制Mac页面或AppKit绑定。共用布局/控件修在shared、Windows系统适配修在windows，macos只读。按第9节完成Windows真机共享/原生/DPI与隔离模型回归，发现问题修复后复测，说明实际完成范围和剩余限制。保护依赖锁、固定运行时、模型、真实资料及恢复基线；后续源码提交或发行按当次授权执行。
