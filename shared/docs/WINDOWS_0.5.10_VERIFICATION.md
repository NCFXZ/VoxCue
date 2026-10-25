# Windows 0.5.10 本机逐项验收

启动日期：2026-10-25（Europe/London）。用户已授权执行 WINDOWS_0.5.10_CODEX_PROMPT.md。

后续授权与当前发行状态：用户在自动验收后明确要求清理工作空间并上传源码/Windows安装包，将0.5.10设为Latest，覆盖此前本轮不发布/不推送限制。正式Windows三项已补入且匿名下载认证通过；原Mac资产保持。源码同步与清理详见末节，首次验收阶段记录保留供追溯。

初始状态：main，HEAD fa6dfc4f3f173aaf139b5913e6f10696727ec8f2；工作树干净。比较基线：48c44aad80563dcb274a24e66b8c8a0245fa1661。

Windows 26H2，10.0.26300.9711 / x64（注册表ProductName为Windows 10 Pro）；PowerShell 7.6.5；Node v24.19.0。Electron 38.8.6；pnpm 11.25.0（已有运行时提供的 pnpm.cmd）；已安装锁与冻结锁字节一致。PATH 中无 corepack；CIM 操作系统查询受限，已用系统 API 取得版本。

当前结论：60项中40项通过、17项修复后通过、1项Mac专属不适用、2项阻塞待人工（E08/H06）。自动验证已完成；真实账户、物理音频、系统IME候选窗、触控板和多显示器不计作通过。外观仅Windows三参数按0.5.9曲线设60，Mac透明度及其他新增毛玻璃保持。另修复实测发现的分数DPI窗口累计位置漂移。

全部项目已从首次待验登记逐项更新；当前结论见下表。GUI/原生串行；仅合成账户/资料/图片和固定公开临时模型/音频。macos/ 只读；不提交推送、不发行、不操作真实安装或凭据。

| ID | 状态 | 本机命令或人工步骤 | 实际证据/尺寸/中间帧 | 修复文件 | 复测结果 | 未覆盖边界 |
| --- | --- | --- | --- | --- | --- | --- |
| A01 | 通过 | node shared/scripts/sync-platform-manifests.mjs；pnpm check:workspace | 唯一生成 diff：windows/package.json 的 0.5.9→0.5.10；根内容一致；macos 无 diff | windows/package.json | exit 0 | Mac 的只读漂移只报告，未写入 |
| A02 | 通过 | pnpm build；check:architecture；共用功能+platform-native+presentation-native | Windows仅编译shared+windows；660个Renderer模块；Fluent图标、登录/主窗/设置/面试/记录路由通过 | — | 相关命令exit 0 | macOS内容绑定未移植 |
| A03 | 通过 | 退役符号生产检索；类型/架构；完整构建 | 147 条差异与交接清单完全一致，42 个删除；生产代码无退役端口消费者 | — | 类型/架构/构建 exit 0 | 窗口实际交互由其他条目登记 |
| A04 | 通过 | pnpm typecheck；pnpm test（desktop-ipc / desktop-contract.types） | 精确 preload API/旧接口拒绝断言通过；226 模块架构零违规/零环 | — | exit 0 | 真实账户不参与 |
| A05 | 通过 | presentation-native、interview-workflow、electron、chat-lifecycle | 真实Windows最小化/最大化/还原、关闭确认及面试结束释放；未走Mac窗口分支 | — | 原生/共用复测通过 | 只操作隔离自有窗口 |
| A06 | 通过 | platform-native、presentation-native、settings | Windows图标/nativeTheme/系统强调色与自定义窗口控件保留；无Mac退役二进制输出 | — | 原生相关项通过 | Mac SF Symbols/Dock/Spaces为不适用；目录只读 |
| A07 | 不适用 | 只读审查 Mac 专属构建差异；git diff --name-only -- macos | Mac 最低版本/ABI不在 Windows 执行；本轮 macos 目录无改动 | — | Windows 目标架构及打包配置未改 | 旧 macOS 实机未验 |
| A08 | 通过 | 核对147文件清单/42删除及本轮工作树 | 未删除历史目录、发行、模型、恢复基线；临时内容由 test-workspace 管理 | — | 静态核对通过 | 历史349个跳过目录未重试 |
| B01 | 通过 | web-materials；interview-chrome 五档DPI；窗口截图检查 | 棋盘图像经标题/返回最新/输入框后的边缘对比低于未模糊区的65%；24px/125%保留 | — | 五档均exit 0；已目视核对合成截图 | 只覆盖同窗内容模糊，未承诺桌面跨窗模糊 |
| B02 | 修复后通过 | frosted-appearance单测；五档web-materials/interview-chrome | 最新用户例外：仅Windows侧栏/背景/文字气泡60；通用预设100、其他内部玻璃原值；旧偏好字节未改 | frostedProfiles.ts；frostedAppearance.ts；interviewAppearance.ts；styles.css；webMaterials.css | 893单测通过；五档通过 | 60是旧应用参数映射，不是Windows系统模糊强度 |
| B03 | 通过 | interview-chrome；presentation-native；窗口截图 | 两大背景alpha非1、backdrop-filter:none；只在标题/输入框/返回最新局部blur24；无全窗Acrylic | — | 五档检查通过；已核对透视及正文覆盖 | 未读取或截取真实桌面资料 |
| B04 | 修复后通过 | interview-chrome；interview-ux；浅深色展开/收起截图 | 保留工具栏/提示原通用fill+panel双层公式；文字气泡独立60是用户最新例外，不再要求二者填充相等 | interview-chrome-smoke.mjs；interview-ux-smoke.mjs | 五档通过；100/125%原旧断言复测exit 0 | 只允许最新三参数差异，未改其他层/滤镜/轮廓 |
| B05 | 通过 | interview-chrome/ux；浅深色截图 | 未隐藏提示复用工具栏双层、无可见描边；显示/关闭及自动消失原流程保留 | — | 五档通过 | 合成窗口和提示状态 |
| B06 | 修复后通过 | interview-chrome；frosted-appearance；主题切换和辅助功能模拟 | 当前surface色相不变；仅文字底色alpha .8992/.928；Windows→Mac重应用清除Windows变量 | 同B02；frosted-appearance.test.ts | 五档浅深色与893单测通过 | Mac按类型/纯逻辑验证未改值，未在Windows仿制Mac UI |
| B07 | 修复后通过 | web-materials五档；登录/设置预览与面试截图 | 预览和实际面试共用同一三参数和双层公式；设置预览只读；浅深色/960与1280布局无溢出 | 同B02 | 五档exit 0；20格主窗截图及面试截图已目视检查 | 没有启动真实采集 |
| B08 | 通过 | interview-chrome 五档受控媒体模拟 | reduce-transparency/contrast-more/forced-colors/0透明度下材质实心、filter:none；退出恢复；新增气泡同样遵守 | webMaterials.css（仅三参数的辅助功能兜底） | 五档均exit 0并检查合成截图 | 媒体模拟，未改用户系统偏好 |
| B09 | 修复后通过 | ui-material-refinement五档；web-materials；provider-ui | 真实Renderer鼠标:hover及键盘:focus-visible、透明常态、背景显现且几何不变；菜单勾选/禁用/键盘断言通过 | ui-material-refinement-smoke.mjs | 最后五档独立复测exit 0 | 未使用强制伪类或合成DOM hover；原生鼠标专项另见E06 |
| B10 | 通过 | ui-alignment/typography五档；web-materials窄窗 | 收起导航/头像44×44正方形及居中断言通过；100–200%真实布局，未通过缩图替代 | — | 五档通过；1280/960浅深色20格截图已核对 | DPI是Electron受控scale factor，非五块物理显示器 |
| C01 | 修复后通过 | web-materials；interview-chrome五档 | 标题初始/部分/完整覆盖opacity连续，filter24px；125%零覆盖几何差0.0000076294px | web-materials-smoke.mjs（仅1/64 CSS像素对应覆盖量精度） | 五档exit 0 | 未改生产标题覆盖算法 |
| C02 | 通过 | web-materials；history-branding；profile-ui五档 | 个人信息展开、记录答案标题、长内容测高及定位/末行可达断言通过；960/1280无首行遮盖 | — | 相关功能和五档通过 | 仅合成标题/记录 |
| C03 | 通过 | interview-chrome五档 | scroll区域与panel底部差≤1px；首行避让、滚入标题后局部blur及覆盖渐显通过 | — | 五档exit 0；已核对面试截图 | 未采样用户正文 |
| C04 | 通过 | web-materials；interview-chrome；interview-ux | 底部36px渐出mask及滚动区域延伸到composer后；长文本/代码/合成图与最后一行可达通过 | — | 相关检查及五档通过 | 合成内容 |
| C05 | 通过 | interview-chrome/screenshot/ux五档；floating | 输入高度/截图附件/音频恢复条和字体/尺寸更新后仍可达底部；阅读历史不强制跳底 | — | 五档及功能矩阵通过 | 恢复条由故障夹具触发，非物理设备故障 |
| C06 | 通过 | interview-chrome/ux五档 | 各自返回最新、跟随输入高度、隐藏不可聚焦和不挡发送断言；blur一致且无box-shadow光晕 | — | 五档exit 0 | 合成滚动/未读状态 |
| C07 | 修复后通过 | composer-resize；interview-chrome 五档 | 聊天逐行2–11，面试逐行1–6；增删/清空/超限滚动；composition Enter保留中文草稿 | composer-resize-smoke.mjs；interview-chrome-smoke.mjs | 额外五档聊天/面试均exit 0 | 系统IME候选窗与真实中文输入法仍待人工 |
| C08 | 通过 | composer；composer-resize；interview-chrome/screenshot五档 | 36px发送/停止、图标居中及禁用/快捷提交；无旧原生投影重复控件 | — | 功能及五档通过 | 组合输入为受控事件 |
| C09 | 通过 | floating；interview-ux；audio-pipeline；原生speech-adversarial | 旧正在收听文字/占位不存在；音频顶部状态、自动回答、恢复条、生成/停止流程保留 | — | 功能/原生检查通过 | 未采样物理麦克风/系统声音 |
| C10 | 修复后通过 | interview-motion 五档 | 隐藏后新转写保留；原140px阅读位置精确保持；原底部跟随在隐藏期间持续更新 | interview-motion-smoke.mjs（新增覆盖/等待开场合成事件） | 五档exit 0 | 未改生产转写持久化 |
| D01 | 修复后通过 | interview-motion五档；interview-workflow原生 | 退出中原生bounds不缩；扩展原生先到位再进入；原bounds恢复严格相等；修复y157→156的累计取整漂移 | shared/electron/main.ts；interview-workflow-smoke.mjs | 五档和原生复测通过 | 只读macos；共享锚点修复Mac实机未验 |
| D02 | 修复后通过 | interview-motion五档；interview-layout/workflow | 转写隐藏/显示中间opacity和连续位移，回答居中误差≤1px；草稿/截图/DOM保留 | main.ts；interview-layout/workflow-smoke.mjs（适配保留DOM语义） | 五档及原生复测通过 | 未强制viewport干扰生产窗口尺寸 |
| D03 | 通过 | interview-motion；interview-workflow；interview-stability | 快速重入/开合、拖动与尺寸调整、busy锁及最终窗口态断言；两轮各20次面试启闭通过 | — | 相关矩阵通过 | 受控输入，无多显示器物理拖拽 |
| D04 | 通过 | interview-motion 五档（拒绝、延迟后拒绝、重试） | 生产IPC返回前保持busy锁；失败重查interviewState；重试恢复原生画布；草稿和140px阅读位置精确保留 | shared/test/scripts/interview-motion-smoke.mjs | 五档exit 0；原始严格窗口恢复断言未放宽 | 合成主进程故障，非真实系统IPC故障统计 |
| D05 | 通过 | interview-motion五档；continuous-corners几何断言 | 退出/进入的clip:none、连续轮廓不变；中间/终帧无圆形clip替换 | — | 五档exit 0 | 像素与几何在自有窗口核对 |
| D06 | 通过 | interview-motion五档 | 动画前/中切reduce-motion，motionPlayers最终0；动画中关闭窗口无残留锁或未处理错误 | interview-motion-smoke.mjs（新增拒绝/关闭覆盖） | 五档exit 0 | 模拟系统媒体偏好 |
| E01 | 通过 | interview-screenshot五档；native-hits | Fluent图标、截图+Ctrl+S/数量互斥；0/1/5/移除/清空及胶囊宽度/上限保护通过 | — | 五档和全链路exit 0 | 没有真实捕获 |
| E02 | 修复后通过 | interview-screenshot；Ctrl+S保护扩展 | 修改键/repeat/组合输入/defaultPrevented/dialog/主窗/收起/五图上限不重复或穿透；disabled状态保留 | interview-screenshot-smoke.mjs | 五档与native-hits exit 0 | capture仅合成图，不采样桌面 |
| E03 | 通过 | interview-screenshot五档；截图样式检查 | 浅/深合成图删除按钮保留深灰圆板/白×/阴影及浅细边，生成中禁用；未修改此控件CSS | — | 五档exit 0 | 细边保留用户明确例外 |
| E04 | 通过 | interview-screenshot；ui-material-refinement；dialog检查 | 面试viewer backdrop透明无blur；记录保留区分前后层的遮罩；关闭/Esc无残留 | — | 五档/全链路exit 0 | 仅合成截图 |
| E05 | 通过 | interview-screenshot五档；image-viewport单测 | 首/末页禁用只淡化箭头；左右键/点击分页/悬浮页码、焦点可见，无描边且不占额外高度 | — | 五档exit 0 | 真实触控板见E08 |
| E06 | 通过 | node ../shared/test/scripts/interview-screenshot-smoke.mjs --native-hits | 20次Win32中心/四边命中覆盖保存与关闭、浅深色；36px区域/17px稳定图标；HTCLIENT=1；系统保存/取消原字节一致 | windows/test/scripts/image-save-hit-check.mjs | exit 0；7张归档原图均属临时合成profile，已清理 | Win32注入事件；未执行真实屏幕捕获 |
| E07 | 通过 | interview-screenshot --native-hits；interview-images/history-images/screenshot-store/desktop-ipc单测 | 发送/失败/停止/重试复用原图、记录仅ID、原图读取/保存取消/删除/缺损与迟到保护通过；5次合成请求、9次合成捕获 | shared/test/scripts/interview-screenshot-smoke.mjs | 新Windows透明度构建下exit0 | 真实账户图片服务未请求；不把合成归档称真人资料 |
| E08 | 阻塞待验 | interview-screenshot --native-hits；image-viewport单测 | 左右键/Esc、指针中心缩放、像素滑动/惯性平移、拖拽/双击复位及焦点恢复自动断言通过 | — | 模拟事件部分exit0 | 真实触控板与多显示器未人工验，待用户本机手工确认 |
| F01 | 修复后通过 | delete-controls；updates-sidebar；interview-chrome五档 | 220ms/ease、整组交叉淡化及3px位移；中间帧确有0<opacity<1；圆/胶囊/不同宽胶囊路径通过 | updates-sidebar-smoke.mjs（动作返回后采样） | 五档/关联复测通过 | 未修改生产动画 |
| F02 | 修复后通过 | continuous-corners；delete-controls/updates-sidebar/interview-chrome | 逐帧按实际宽高及四角CSS归一化半径判断，固定999px端帽；拒绝宽扁50%椭圆 | continuous-corners.mjs；delete-controls-smoke.mjs | 五档及功能检查通过 | 1/64 CSS布局精度用于尺寸，未取消中间帧检查 |
| F03 | 通过 | delete-controls；profile-selection；knowledge；conversations；history | 简历/JD/技能/聊天/知识库/面试记录现有删除或重置；确认/3秒/Esc/失焦/revision/忙碌/失败重试通过 | — | 相关功能及单测通过 | 仅合成记录，不删除用户资料 |
| F04 | 修复后通过 | updates-sidebar五档；updates/updates-native | 下载/取消/重启双向交叉淡化；首秒取消/面试禁装/重启保存确认保持；200%补测2次通过 | updates-sidebar-smoke.mjs；assert-download-button.mjs | 五档及原生更新检查通过 | 合成更新驱动，未真正安装 |
| F05 | 通过 | interview-chrome；floating；interview-workflow五档/原生 | 结束确认超时收回逐帧999px端帽，真正二次确认结束及系统关闭释放；业务不依赖动画延迟 | continuous-corners.mjs（加强端帽验证） | 五档/原生通过 | 未结束用户正在使用的面试 |
| F06 | 通过 | delete-controls；interview-chrome；ui-material-refinement五档 | 动画按钮border透明、focus outline保留；快速反向及reduce-motion；E03缩略图细边未动 | — | 相关检查通过 | forced-colors由受控媒体模拟，未更改系统主题 |
| G01 | 通过 | web-materials；ui-material-refinement五档；history-branding | 搜索44px、左内距20px；清除区28px/14px图标、仅一个×，清除后焦点回输入；筛选/键盘通过 | — | 五档exit 0 | 合成记录 |
| G02 | 修复后通过 | profile-ui五档，1280/960各完整/缺摘要两路径 | 操作行居中最大偏差0.0000267px；左补充/更新、右取消；Tab次序与视觉一致，无overflow | profile-ui-smoke.mjs（新增布局与Tab覆盖） | 五档exit 0；截图已目视核对并清理 | 合成Provider，不请求真实联网技能生成 |
| G03 | 修复后通过 | windows-suite --dpi加入interview-chrome/interview-motion | 14组×5档=70；棋盘像素、正文覆盖、端帽、草稿/阅读位置/减少动态的有效断言均实际执行 | windows-suite.mjs；interview-chrome/motion-smoke.mjs | 最终70组全部有本机通过记录，见首轮/复测分项 | 非单次全套70组exit 0；未移植Mac探针 |
| G04 | 修复后通过 | 原失败项及相关组逐项复测 | 产品取整漂移、旧DOM/参数断言、布局精度、合成事件及hover时序分开定位；原隐私/签名/确认断言保留 | 本报告修复清单中的生产/夹具文件 | 功能45/45、原生15/15、DPI70/70合并覆盖 | 首次失败及测试适配理由均保留；不声称首轮全绿 |
| G05 | 通过 | typecheck；check:architecture；check:workspace；build；test；Prettier | 3组类型；226模块0违规0环；599文件0违规；87文件893通过/2条件跳过；格式按现有CRLF检出核对 | — | 全部exit 0（默认LF格式失败已单列解释） | 两项链接用例按既有平台条件跳过，未删除 |
| G06 | 通过 | README/PLATFORM_UI/PROGRESS/test README及本账本 | 最新三参数用户指令优先；60项均有实际结论，保留首次失败、复测与未覆盖范围 | README.md；PROGRESS.md；shared/docs/PLATFORM_UI.md；shared/test/README.md；本账本 | 文档与当前源码核对 | 历史Mac发行状态只作交接事实，未在线复验 |
| H01 | 通过 | 只读核对已安装 package.json 及锁 SHA256 | SDK1.0.21/Codex0.164.0/sherpa1.13.8（含 win32-x64 包）；安装锁和仓库锁 SHA256 均 6fc120c4d6a2ee12975732ca723c563ab09bf7144a80f14fe897bc400ca8dd05 | — | 未安装/升级；锁无 diff | 真实账户/推理未验 |
| H02 | 通过 | rag-core（共用及Windows原生）、rag-ui；893项全量单测中的RAG组 | 真实固定E5/LanceDB；keyword/vector/hybrid、当前来源/项目隔离/追问/未知项目、取消/revision预算机制通过；RAG生产文件未改 | — | exit 0 | 未再调参或冒充最终LLM答案质量；冻结公开集仍有既知质量边界 |
| H03 | 通过 | 共用45组中的登录/单次托管会话/双额度/聊天/资料/存储/关闭流程；user-data原生 | 合成账户及官方运行时无凭据握手；取消/重试/附件/保存确认/隔离持久化通过 | — | 相关项exit 0 | 未读取真实凭据、登录真实服务或请求真人推理 |
| H04 | 通过 | speech-adversarial/AEC/WASAPI/electron-output原生；audio-pipeline/speech-soak；pnpm test:installer:isolated | 实际Worker/utilityProcess及固定Paraformer/E5；600秒零错误；NSIS/ASAR/替换路径、Worker解码/gap复位、RAG三模式、卸载重载和原生窗口/崩溃恢复通过 | windows/test/scripts/components-check.mjs等既有夹具适配 | 源码15/15合并覆盖；最终隔离包命令exit 0，installed=false/published=false | 未采样真实设备；可选Qwen仅核对后端/目录/固定哈希，未重做CPU/CUDA长性能评估 |
| H05 | 通过 | 后续用户发布授权；正式包验收；GitHub API/匿名完整下载/生产更新选择器 | v0.5.10六项完整并设Latest；新增Windows三项，原Mac三项ID/大小/摘要保持；线上文件与本地一致，生产选择器选0.5.10 | README/PROGRESS/交接状态说明 | 正式包与公开下载exit 0；未运行真实安装器 | 旧版本/模型/标签/仓库设置保持；Mac未重打包 |
| H06 | 阻塞待验 | 自动本机矩阵及临时目录/进程清理；人工边界登记 | Windows自动UI/DPI/原生覆盖已独立执行；合成截图已核对后清理；真实账户/设备/手势未动 | — | 其余无依赖检查已完成，见逐项结果 | 需人工：真实账户登录/服务推理、物理音频、系统IME候选、触控板、多显示器 |

## 命令及首次失败记录（阶段历史，最终结论见表及末节）

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| pnpm typecheck | 0 | Renderer/backend/contracts 三组类型通过 |
| pnpm check:architecture | 0 | 226 文件，0边界违规，0运行时循环 |
| pnpm check:workspace | 0 | 599 文件，0布局违规；Mac只读漂移报告 |
| pnpm build | 0 | WASAPI helper复用；shared+windows Electron编译；Vite660模块；仅bundle体积提示 |
| pnpm test | 0 | 87文件；893通过、2跳过、0失败（895总项） |
| Prettier --check（默认LF） | 1 | 331文件因git autocrlf=true检出为CRLF；未批量改写源码 |
| 同范围Prettier --check --end-of-line auto | 0 | 全部匹配文件格式通过 |
| Windows desktop probe | 0 | interactive=true，inputDesktop=Default，cursorReadable=true |
| pnpm test:windows:functional（sandbox） | 1 | 临时speech组件下载0%即失败，尚未运行GUI子项 |
| pnpm test:windows:functional（本机权限，首次完整矩阵） | 1 | 41/45通过；4处失败均保留，见下；20轮面试及600秒语音通过 |

## DPI、主题和窗口宽度矩阵

100/125/150/175/200% × 浅/深色 × 正常/窄宽度：实际Renderer检查通过。五档各执行web-materials、interview-chrome、profile-ui、composer-resize、ui-material-refinement；采集的20格主窗及代表性面试/技能提示/棋盘图已目视检查，退出后已清理，不链接已删除图片。减少动态/透明、高对比度、forced-colors及键盘/Renderer鼠标检查通过；Win32保存/关闭命中另见E06。

真实账户、物理音频采样、真实触控板和多显示器：未执行，需人工验收。

## 首次完整矩阵的定位与修复

| 子项 | 实际失败 | 分类和处理 | 复测 |
| --- | --- | --- | --- |
| ui-material-refinement | 展开技能清单当前中心命中按钮，但 :hover 停在 response-progress | 等回复完成/滚动布局稳定后，以按钮当前中心发送真实 Renderer 指针事件；悬停/焦点/几何断言保留 | 已通过 |
| interview-chrome | 175%桌面实测上下8.0000px、左右7.5714px，原断言要求四边误差<0.1 | 保留7px padding及上下/左右对称检查，仅容许至多1物理像素原生量化 | 已通过 |
| interview-motion | 收起展开原bounds y=157，实际y=156 | 产品修复：HWND未外移时保留逻辑请求锚点；不放宽原始窗口恢复断言 | 已通过 |
| updates-sidebar | 44px实际读数44.000002861，严格浮点相等失败 | 按Chromium 1/64布局像素核对44px，未更改控件尺寸 | 已通过 |

600秒固定公开双通道音频：finals=208，interim=1451，maxQueueMs=640，errors=[]；600334ms完成，未采样物理硬件。

已按变更范围重新构建并重跑全量单测：87文件，893通过/2平台条件跳过/0失败。跳过项为Windows的文件符号链接图片用例与Unix SingletonLock链接用例；未删除或修改跳过条件。

关联复测命令：`pnpm test:windows:functional interview-motion interview-chrome ui-material-refinement updates-sidebar composer-resize profile-ui interview-screenshot delete-controls floating interview-ux interview-stability`。该轮10/11通过；原始窗口恢复严格断言已通过，新加迟到IPC夹具等待竞争失败。补齐等待夹具实际pending条件后，`node ../shared/test/scripts/interview-motion-smoke.mjs` 本机权限复测exit 0，涵盖拒绝/迟到协调、忙碌锁、重试及关闭。

完整功能矩阵最终按首次45组和失败/受影响11组复测合并为45/45通过，非声称单次全套exit 0。首轮及关联轮各执行20次面试启闭；第二轮20次亦通过。

独立 Electron 脚本在sandbox内曾报 Process failed to launch，未到断言；同源码/断言使用本机权限后通过。属于环境限制，未放宽测试。

## Windows 原生矩阵首次执行与适配

`pnpm test:windows:regression` 首轮exit 1：11/15通过；platform-native、access、effort、context、updates-native、user-data、speech-adversarial、AEC、WASAPI packets、electron-output、RAG通过。未采样真实音频。

| 首轮失败 | 事实及处理 | 复测 |
| --- | --- | --- |
| interview-layout | 旧断言要求隐藏转写时删除DOM；改为检查可见面板和保留的隐藏DOM，等待开合完成 | 已通过 |
| interview-workflow | 同上；旧size夹具还会在动画结束前强制setSize及viewport，干扰真实窗口锚点；改为观察生产resize，核对原生内容大小与Renderer一致 | 已通过（真实窗口、未强制viewport/setSize） |
| presentation-native | 旧60预设及reading参数断言；现核对100、panelLight=.632、panelDark=.692、内部blur24/大区域无blur、旧reading不存在 | 已通过 |
| components-native | 下载按钮取消态hover未命中；同共享矩阵停放OS指针，滚动后使用当前按钮中心，保留真实下载/校验/删除/独占句柄断言 | 已通过 |

原生后续命令：4项复测2/4通过（layout/components），移除遗漏的reading历史断言并改为观察原生resize后，`pnpm test:windows:regression interview-workflow presentation-native` exit 0，两项均通过；原生矩阵合并最终15/15，非首次整组全绿。Windows完整DPI 70组现开始执行。

## DPI 首次结果中的夹具问题（阶段历史）

- 100% motion：开场端口在50ms后发送的合成转写与Playwright select-all/insert-text竞争，使实际草稿含开场文字。改为先关闭自动提交并等待该合成开场事件，再建立人工草稿；不改生产草稿逻辑。125%/150%新夹具通过；100%待定向复测。
- 125% web-materials：记录回答标题复位opacity精确等于0的等待超时；已增加有界几何诊断，待复测取证，不默认通过。
- 150% chrome/motion及辅助功能模拟通过；其余档位继续串行执行。

## 用户追加：仅Windows三项透明度参数（覆盖B02/B04/B06/B07中的对应参数）

用户要求参考0.5.9，只改Windows侧栏、面试大背景、文字气泡三项透明度；Mac及其他新增毛玻璃效果不变。已对照48c44aa原曲线：侧栏60档→浅/深alpha .4/.512；面试背景60×.6=36档→.8496/.8872；文字气泡30×.6=18档→.8992/.928。仅背景alpha取旧映射，现有色相、24px/125%模糊、双层材质、阴影、圆角、固定标题和全部交互动画均保留。

三项通过Windows专用变量接入，通用100档和其他控件fill仍保持原值；Mac无Windows变量、背景仍.632/.692，单测校验Windows→Mac重应用不遗留。Mac目录仍只读。文字气泡独立透明度后，不再要求工具栏通用填充与气泡填充数值相等；原工具栏/提示双层公式不改。

此前DPI完整一轮为67/70，通过/失败均是追加参数前的基线（100%motion、125%web-materials、150%updates-sidebar失败）；前后两个夹具时序已修，125%标题待几何取证。新参数构建后将重跑受影响检查及五档DPI，未完成前不将旧参数通过记作新参数通过。

追加参数后的定向检查已通过：175% interview-chrome（含其他玻璃定义与辅助功能保护）、125% web-materials、100% interview-motion、150% updates-sidebar，全为exit 0。

125%标题已取证：scrollTop=0，标题bottom=171.00000762939453，首行top=171，几何差仅0.0000076294px，实际opacity=3.17891e-7。仅将测试零值判定限定到1/64 CSS布局像素对应的24px覆盖量，保留首行避让/完整覆盖/底部可达断言；未修改标题覆盖算法或毛玻璃。150%按钮中间帧采样现以真实hover动作返回后再计450ms，仍检查原220ms动画及中间帧/最终态。

新参数类型检查、226文件架构、599文件workspace、完整构建和87文件/893通过/2跳过单测均通过，依赖锁/Mac目录无diff。

阶段历史补记（已由最后五档Renderer方案复测替代）：100/125% interview-ux仍使用旧的“工具栏填充等于文字气泡”断言，现按用户独立三参数改为核对工具栏自身通用填充及原双层公式，未改生产效果；两档待复测。125%ui-material悬停出现focused=true、当前命中子节点但:hover为空，现Win32复核精确自有HWND后移动实际指针到其当前中心，退出恢复指针，保留悬停/焦点/几何断言；150%新夹具通过，125%待复测。

## 最终悬停和视觉复测

最后的五档 ui-material-refinement 独立命令 exit 0：100/125/150/175/200% 全部通过。撤回尝试过的Win32 client-rect/顶置/指针方案（WindowProbe.cs回到无diff）；使用自有Renderer的真实鼠标输入，在滚动及回复完成后重新定位两个相邻内部点，等待实际 :hover，再核对底板、焦点及几何。未使用强制伪类，也未改生产CSS。

最终参数完整DPI首轮65/70，原失败为100/125% interview-ux旧双层填充断言、125/175%悬停夹具和200%更新中间帧采样；UX两项各复测通过，200%更新两次通过，悬停最后五档全通过，合并覆盖70/70。额外视觉25组首轮23/25（150/175%旧悬停方案失败），其余20组全部通过；最后五档新悬停通过后，25组均有通过记录。两套记录均不声称单次整组全绿。

合成视觉目录 voxcue-test-run-3akOWe 已退出清理（Test-Path=False）；未保留原始截图、模型、数据库或profile。

## 最终隔离包验收与清理

pnpm test:installer:isolated 最终exit 0，installed=false、published=false。NSIS仅在自有临时目录生成，从未运行安装器；版本0.5.10，安装包SHA256为03a0c96e7ed4282787a018d60349874f323d66e133b084dd603b160262f35122。latest.yml的SHA512、blockmap、NSIS内嵌PE/ASAR/组件清单/音频helper逐字节与便携stage一致。该哈希仅标识本次已清理的临时包，不是正式发行资产。

ASAR排除Mac/其他平台二进制、模型权重、开发测试源码、已知凭据/密钥文件；固定Win x64 Codex0.164.0、Copilot1.0.21及原生依赖存在。官方运行时握手只用空账户/伪造测试令牌及隔离存储，不读取真实凭据或真实OAuth。

实际打包进程验证Paraformer解码、ASR Worker/AEC准备与gap复位、utilityProcess、E5/LanceDB keyword/vector/hybrid、PDF/DOCX、整QA/重启/删除及替换应用位置后复用自有缓存；删除组件前释放ONNX/语音进程、独占与保护原件/知识库规则均通过。包内真实Win32最小化/最大化/还原/关闭、拖动排除、topmost/选择锁、任务栏/图标、forced-colors、Renderer崩溃恢复通过。可选Qwen未执行本轮完整CPU/CUDA推理。

最后类型检查exit 0；架构226模块0违规0循环，workspace599文件0违规；Prettier按检出换行auto检查exit 0，git diff --check exit 0。冻结锁与安装锁SHA256仍同为6fc120c4d6a2ee12975732ca723c563ab09bf7144a80f14fe897bc400ca8dd05；macos/、shared/native、Windows原生资产和锁无diff。根package.json的LF/CRLF差异不改变Git内容对象；最初曾恢复CRLF以消除状态噪声，最终配置复核见后续发行节。暂存区为空、HEAD仍fa6dfc4f3f173aaf139b5913e6f10696727ec8f2；没有提交、推送、发行/标签、Latest或真实安装操作。

## 最终命令结果汇总

| 命令/检查 | 最终结果 | 说明 |
| --- | --- | --- |
| typecheck / check:architecture / check:workspace / build | exit 0 | Windows本机；Mac只读漂移仅报告 |
| pnpm test | exit 0 | 87文件，893通过、2平台条件跳过，0失败 |
| test:windows:functional | 45/45合并覆盖 | 首轮41/45，失败及受影响11组复跑；600秒音频零错误、两轮各20次面试 |
| test:windows:regression | 15/15合并覆盖 | 首轮11/15，四项旧夹具适配后各复测；最终包再次原生验收 |
| test:ui:dpi | 70/70合并覆盖 | 最终参数完整首轮65/70；五项失败及关联项复测，最后hover五档单独exit 0 |
| 额外视觉/逐行输入/技能提示 | 25/25合并覆盖 | 首轮23/25；旧hover方案两项失败，最后五档新方案均通过；20格主窗与代表性截图已目视检查 |
| interview-screenshot --native-hits | exit 0 | 20次真实Win32保存/关闭中心及四边，原字节保存/取消，全部合成图片 |
| test:installer:isolated | exit 0 | 临时portable+NSIS、清单/载荷、包内功能与Win32；未安装/未发布 |
| Prettier --check --end-of-line auto / git diff --check | exit 0 | 默认LF的首次331文件CRLF差异单独保留说明 |

## 用户后续授权的正式发行与源码同步

用户明确要求清理、上传代码及Windows安装包并将0.5.10设Latest。原先“未提交/不发布/Latest保持0.5.9”仅描述前一验收阶段，不再是本次发布限制。本次未扩大到真实安装、凭据/签名身份、旧资产或未来自动发布。

正式入口pnpm package:installer exit 0；随后node test/scripts/installer-artifact-smoke.mjs及node test/scripts/portable-native-smoke.mjs --installer-stage均exit 0，验证的是实际上传同一构建，而非仅前次临时包。语音Worker/AEC、Paraformer解码、RAG三模式/PDF/DOCX/重启/删除、组件释放/重载及真实Win32窗口/崩溃恢复均通过；NotSigned符合既有Windows未配置Authenticode的发行方式，没有创建或轮换身份。

正式文件保留windows/release/0.5.10，不进入源码：

| 文件 | 字节 | SHA256 |
| --- | --- | --- |
| VoxCue-Setup-0.5.10-x64.exe | 386984416 | a4139babb71c68d95b88aec2fe6f64c7c91a3234c2e0e906099ca2d46533cc6d |
| VoxCue-Setup-0.5.10-x64.exe.blockmap | 400824 | fb1f17f151dfd50f7707a62a66dcc3141ae196843234ef3a4ff0b3307b787cc4 |
| latest.yml | 352 | a05cb54d863e52fcaf17525fba6a9243500a05a1d1a4a5aa45bd059433a07892 |

既有公开发行https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.5.10已补齐三项并设Latest，发布后匿名完整下载三项的大小/SHA256均匹配；生产latestPlatformRelease选择Windows0.5.10，manifestFile实际认证线上大小/SHA512，latest/download/latest.yml同样返回0.5.10。Mac资产ID675071867/675067300/675069119及大小/SHA256全部与发布前一致；未覆盖旧资产、重打Mac包、改动其他标签或仓库设置。

清理前后端未使用声明检查exit 0。清理仅限本次installer和installer-stage：先校验版本三件与源摘要一致，确认解析绝对路径/无重定向/无进程和逐文件独占后删除7723个文件、1952251585逻辑字节；现用构建、依赖、正式三项、旧发行/模型及恢复目录保留。GUI合成profile/数据库/模型退出清理；临时发行工具和元数据亦清理，不保存凭据。

最终check:workspace曾因根package.json恢复CRLF而报Out of date（生成器要求LF逐字节一致）；在根重新运行sync-platform-manifests后exit 0，602文件0违规（比前阶段多出三项正式发行文件）。已证明根文件Git内容对象与HEAD完全一致，仅在暂存时刷新其索引状态，不产生根文件内容变更；不改Mac生成配置或生成器逻辑。

源码仅按下列明确清单提交至既有私有NCFXZ/VoxCue的main；实际提交号和远端一致性由Git及对话回传，不将包/模型/缓存/原始测试结果或密钥加入Git，也不为回填自身提交号再产生源码改动。

## 本轮完整可审阅文件清单

生产修改为五个Windows三参数材质接入文件及shared/electron/main.ts的逻辑锚点修复；windows/package.json为版本生成结果，其余为测试适配/覆盖与文档。共33个有内容差异或新增的文件：

- `PROGRESS.md`
- `README.md`
- `shared/docs/PLATFORM_UI.md`
- `shared/docs/WINDOWS_0.5.10_CODEX_PROMPT.md`
- `shared/docs/WINDOWS_0.5.10_HANDOFF.md`
- `shared/docs/WINDOWS_0.5.10_VERIFICATION.md`
- `shared/docs/WORKSPACE_CLEANUP.md`
- `shared/electron/main.ts`
- `shared/src/frostedAppearance.ts`
- `shared/src/frostedProfiles.ts`
- `shared/src/interviewAppearance.ts`
- `shared/src/platform/webMaterials.css`
- `shared/src/styles.css`
- `shared/test/README.md`
- `shared/test/scripts/assert-download-button.mjs`
- `shared/test/scripts/composer-resize-smoke.mjs`
- `shared/test/scripts/continuous-corners.mjs`
- `shared/test/scripts/delete-controls-smoke.mjs`
- `shared/test/scripts/interview-chrome-smoke.mjs`
- `shared/test/scripts/interview-motion-smoke.mjs`
- `shared/test/scripts/interview-screenshot-smoke.mjs`
- `shared/test/scripts/interview-ux-smoke.mjs`
- `shared/test/scripts/profile-ui-smoke.mjs`
- `shared/test/scripts/ui-material-refinement-smoke.mjs`
- `shared/test/scripts/updates-sidebar-smoke.mjs`
- `shared/test/scripts/web-materials-smoke.mjs`
- `shared/test/unit/frosted-appearance.test.ts`
- `windows/package.json`
- `windows/test/scripts/image-save-hit-check.mjs`
- `windows/test/scripts/interview-layout-smoke.mjs`
- `windows/test/scripts/interview-workflow-smoke.mjs`
- `windows/test/scripts/presentation-native-smoke.mjs`
- `windows/test/scripts/windows-suite.mjs`
