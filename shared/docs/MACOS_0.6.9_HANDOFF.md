# VoxCue 0.6.8 → 0.6.9：macOS 逐项接续与验收清单

更新日期：2026-11-05。本文是需求、代码位置和待执行步骤清单，不是测试报告。编号稳定；后续验证中发现的修复追加新编号，不重排已有编号。

Mac 本机接续的实现和夹具修正在 M155 起；前文“Mac 待实现”保留原交接起点，当前任务状态见 [PROGRESS.md](../../PROGRESS.md)。

## 基线、状态与执行边界

- 本轮桌面任务开始先拉取至 `e98242a`；本文按该工作基线与当前实际差异、最终用户要求整理。`e98242a` 不等同于声明某个 0.6.8 安装包的构建输入。0.6.8 的正式恢复来源分别见 [Mac 发行索引](MACOS_0.6.8_RELEASE.md) 与 [Windows 发行索引](WINDOWS_0.6.8_RELEASE.md)。
- 本轮目标为 **0.6.9 的全部需求双端同步**。共享界面和更新协调已在 `shared/` 实现；Windows 原生缓存适配已存在；**Mac 原生更新缓存、完整包恢复及中断冷却仍待 Mac 本机实现**。共享控件出现不代表 Mac 原生行为完成，Windows 结果不能代替 Mac 结果。
- 本文列本轮增量；[0.6.8逐项清单](MACOS_0.6.8_HANDOFF.md)中的用量预警、生命周期、原生窗口与安全语义继续作为回归基线，不能因本轮改UI而撤回。
- 版本唯一来源 `shared/package.json` 已调整为0.6.9，根与Windows生成配置已按本平台同步；Mac生成配置仍由Mac本机同步。最终源码 SHA、提交与发行资产以本轮最终发行索引为准，不能从目标版本推断已发行；不得手改另一平台生成配置以制造一致。
- 表中“共享/本机复核”表示代码已存在，Mac 必须拉取后在本机验证；“Mac 待实现”表示有明确原生缺口；“边界”表示本轮必须保持的约束。
- Windows 工作区对 `macos/` 全树只读。本文件未修改 Mac 源码、配置、依赖、签名、模型或数据。Mac 接续时反向保持 `windows/` 全树只读。
- 独立官网和独立服务端不随桌面改动部署。登录演示只复用官网既有动画节奏与呈现方式；不把官网工作副本、部署和 DNS 改动混入桌面发行。
- 文件简称约定：未另给目录的组件/CSS位于 `shared/src/components/`，`ui/` 位于该组件目录；`styles.css` 位于 `shared/src/`，`platform/`、`services/`、`stores/`同属 `shared/src/`。未另给平台目录的 `*-smoke.mjs` 与测试helper位于 `shared/test/scripts/`，`*.test.ts/tsx`位于 `shared/test/unit/`（显式renderer路径除外）。因此表内简称也能唯一回到真实文件。

| ID | 状态及最终要求 | Mac 接续动作、预期与入口 |
| --- | --- | --- |
| M001 | 边界：所有本轮 UI、交互、错误、动画和更新需求同时适用于 Windows/macOS。 | 逐条核对本清单；不能把原生更新标作 Windows 专属，不能仅同步截图或 CSS 后结束。 |
| M002 | 边界：保留用户和远端后续工作；先核对 status/diff。 | 在 Mac 拉取最终源码前检查本机改动，禁止整库 reset/clean、强推或真实数据迁移；冲突按 owning module 合并。 |
| M003 | 边界：版本、依赖和平台配置职责保持。 | 仅在 `macos/` 安装现有锁定依赖；从版本唯一来源运行既有 workspace 同步入口，根和当前平台生成物按规则处理，不在根或 shared 安装 node_modules；不升级依赖或模型。 |
| M004 | 边界：RAG 不进行算法、召回、阈值或模型优化。 | 本轮知识库改动仅是进度文案 formatter；保留 0.6.8 所承接的 0.6.7 RAG 实现、模型、索引兼容和检索策略。按后文 RAG 核对步骤确认，不以新检索实现替代原行为。 |
| M005 | 边界：凭据、固定签名和正式恢复基线保护。 | 不读取真实 Keychain/账号资料，不修改固定身份；保留现用依赖/模型、0.6.8 及历史正式资产、固定凭据助手和签名目录。清理前核对真实路径、消费者与占用。 |
| M006 | 边界：GUI/原生/模型/长稳串行，当前 UID 已登录且解锁。 | 通过 `macos/test/scripts/desktop-session-smoke.mjs` 等既有会话守卫后执行；锁定或未知立即停止，不修改系统辅助功能/锁屏权限。合成资料与必要产物只放 owner 系统临时目录并清理；结果仅终端/对话。 |

## 滚动条、文字、共享形状与面试输入区

| ID | 状态及最终行为 | 文件与 Mac 逐项复核 |
| --- | --- | --- |
| M007 | 共享/本机复核：所有现有滚动条滑块两端为正圆、整体胶囊，宽度不改变。 | `shared/src/styles.css`、`shared/src/platform/webMaterials.css`。检查资料、聊天、知识库、记录、设置、弹窗、模型长列表及 textarea；现有网页滚动条宽/高仍为 6px，不用加宽或隐藏规避端帽。入口：`cloud-account-smoke.mjs --scrollbars`、`management-scrollbar-checks.mjs`。 |
| M008 | 共享/本机复核：圆形/胶囊控件显式保持 `corner-shape: round`，连续圆角组件保留 `superellipse(2)`。 | 同上及 `continuous-corners.mjs`。核对按钮、滚动条、来源胶囊不被全局连续角二次改形；圆形发送按钮不变成方圆角。 |
| M009 | 共享/本机复核：面试输入框与外框同心，按真实边框宽度计算。 | `styles.css`、`webMaterials.ts`。外框半径 34px、输入内缩 8px，输入半径为外框半径减内缩及实测边框；chrome-base 与真实输入相同。分数缩放不能硬减 1px；检查左/右/下圆心。入口：`interview-chrome-smoke.mjs`、`web-materials-smoke.mjs`。 |
| M010 | 共享/本机复核：设置预览、登录紧凑预览同步同心规则。 | `InterviewPreview.tsx`、`login-preview.css`、`webMaterials.ts`。登录预览外框半径 24px，沿同一公式减 8px 与真实边框；不能保留独立旧输入半径。浅深、窄窗和 Retina/分数缩放均核对。 |
| M011 | 共享/本机复核：面试转写、问题、回答及错误气泡复用该输入框半径。 | `styles.css` 的 floating-panel 局部 `--radius-interview-answer`。检查转写左右双方、提问和回答；设置/登录预览跟随，不把准备聊天的 40px 与浮窗按 34px 外框计算的局部半径混为一个硬编码值。 |
| M012 | 共享/本机复核：面试自动回答、截图、发送三个控件同高 32px，上下对齐，左右与底部内距均 8px。 | `FloatingInterview.tsx`、`InterviewPreview.tsx`、`styles.css`。发送 ArrowUp 使用 18px；三控件顶/底同线，左右边缘到输入内框与底距相同。入口：`interview-chrome-smoke.mjs`、`web-materials-smoke.mjs`。 |
| M013 | 共享/本机复核：面试底部按钮/快捷键文字为 12px，输入为 14px。 | `styles.css`、`typography-smoke.mjs`。设置预览同步；登录紧凑预览按钮 26px、控件文字 10px、输入 11px，按比例适配，不把全局字号缩小。 |
| M014 | 共享/本机复核：可选择正文及嵌套文本显示 I-beam。 | `styles.css`。覆盖 markdown、用户气泡、回答、转写、记录正文与问题中的 span/strong 等；按钮、链接及其子元素继续普通控件光标，缩放分隔条保留原光标。入口：`continuous-corners.mjs`、`typography-smoke.mjs`。 |
| M015 | 共享/本机复核：全 UI 选择背景为中性半透明灰 `rgb(128 128 128 / 28%)`，文字保留原色，无额外文字阴影。 | `styles.css` 的 `::selection`。浅深主题分别选聊天、气泡和真实输入；强制对比模式使用系统 Highlight/HighlightText。不能把强调色混入普通选择背景。 |

## 登录、字段反馈与六格验证码

| ID | 状态及最终行为 | 文件与 Mac 逐项复核 |
| --- | --- | --- |
| M016 | 共享/本机复核：登录输入聚焦通过阴影产生上浮，`translateY(-2px)`，180ms 过渡。 | `cloudAccountPanel.css`。邮箱、密码及验证码分别鼠标/键盘聚焦；阴影不改变布局和字段宽度，减少动态效果取消过渡，既有可访问性名称保持。入口：`cloud-account-smoke.mjs --login-check`。 |
| M017 | 共享/本机复核：提示/错误紧跟对应输入框底部，起点与输入文字对齐。 | `CloudAccountPanel.tsx`、`cloudAccountPanel.css`。登录字段反馈横向缩进 14px，不能恢复表单底部总错误区；邮箱、密码、验证码各有对应 aria-describedby/aria-invalid，错误 role=alert，实际状态保留 role=status。 |
| M018 | 共享/本机复核：常规本地反馈只保留四类语义。 | 灰色密码不少于 8 个字符（注册/重置）；红色邮箱格式不正确、验证码不正确、密码不正确。短密码沿灰色提示，不新增多余“请先获取”“请输入六位”等产品提示。服务端必要故障、限流/重试及配置错误仍须明确显示，不能吞错或假装成功。 |
| M019 | 共享/本机复核：错误归属及焦点保持准确。 | `CloudAccountPanel.tsx`。无效邮箱失焦/提交归邮箱；凭据错误归密码；无效/过期验证码归验证码。修改邮箱清旧 challenge 和相应反馈；失败不越过提交锁，保留原密码规范化、长度上限与限流。入口：`password-policy-smoke.mjs`、`cloud-account-smoke.mjs --login-check`。 |
| M020 | 共享/本机复核：邮箱验证码使用六个独立数字格。 | `VerificationCodeInput.tsx`、`cloudAccountPanel.css`。六等分网格，格间 7px；数字居中、18px、等宽数字；首格与“邮箱验证码”label关联，其余格有独立位次名称，反馈描述共同关联。 |
| M021 | 共享/本机复核：验证码输入、粘贴与键盘是同一受控值。 | 输入自动前进；六位粘贴可从任意格填全组，非数字过滤；部分粘贴、Backspace/Delete、左右方向键、Home/End、聚焦全选均核对。首格 one-time-code 自动填充，后续格 off；不能靠六个独立隐藏值提交。 |
| M022 | 共享/本机复核：验证码获取/倒计时重发按钮在全部宽度始终位于六格右侧同一行。 | 旧“900px以下按钮另起一行”的方案已撤回；空间不足缩窄前方六格，按钮保留自然宽度、不压缩、不换行，字段反馈仍在下方。最终CSS和定向断言见M148；原重发计时、busy/限流禁用和六格编辑语义保持。 |
| M023 | 共享/本机复核：登录演示不可交互、不可选中文字；空 placeholder 不可选，真实输入仍可编辑和选择。 | `LoginPage.tsx`、`InterviewPreview.tsx`、`login-preview.css`、`styles.css`。演示 inert、所有装饰文本普通光标；不能误伤登录字段的已输入值或设置中的可交互预览。 |
| M024 | 共享/本机复核：登录首图式演示为转写→思考→回答，只播放一次。 | `ui/useLoginPreviewPlayback.ts`、`InterviewPreview.tsx`。总时长 3500ms：ready <100ms、question <1000ms、thinking <1400ms、answering 至3500ms，之后 complete；切换注册/找回不重播，同一次登录打开结束后静止。 |
| M025 | 共享/本机复核：演示比例适合登录右区。 | `login-preview.css`。内容最大 480px，转写/回答列比 0.72/1.28，面板高 clamp(320px,57vh,390px)；长回答自动到底部，顶/底 18px 渐隐按滚动位置切换，不暴露手动滚动交互。 |
| M026 | 共享/本机复核：演示离屏/页面隐藏暂停，减少动态效果直接完成。 | `useLoginPreviewPlayback.ts`。IntersectionObserver、visibilitychange、媒体变化及卸载均释放 RAF/监听；光标停止/隐藏。入口：`login-entry-smoke.mjs`。真实 Mac 隐藏/恢复窗口必须本机操作验，自动化宿主不能触发的 document.hidden 事件不能标作已验。 |

## 模型与思考强度组合控件

| ID | 状态及最终行为 | 文件与 Mac 逐项复核 |
| --- | --- | --- |
| M027 | 共享/本机复核：准备聊天、前置设置、活动面试共用一个模型+档位入口。 | `ReasoningEffortControl.tsx`、`ChatTools.tsx`、`SpeechControls.tsx`、`InterviewSettingsPanel.tsx`。形如“模型名 档位⌄”，不再并列两个主按钮；设置保留“回答模型”左标签。 |
| M028 | 共享/本机复核：弹层内只有模型实际支持的显式档位，不显示默认/自动或重置/闪电图标。 | `services/chatOptions.ts`。按公开 reasoningEfforts 顺序过滤能力；有效旧显式值保留，auto/无效值优先 low，否则首个支持值；无能力模型内部兼容 auto，UI 无滑块，请求不携带不支持档位。不得升级/替换模型清单或过滤合法模型 ID。 |
| M029 | 共享/本机复核：模型加载、恢复、切换及提交共用解析规则。 | `stores/preparation.ts`、`services/speech.ts`、`SpeechControls.tsx`。旧保存值、模型列表晚到、选择新模型、重试/实际发送均核对，真实请求 options 快照仍保留；不能只修显示而让后台发送旧 auto。入口：`interview-settings.test.ts`、`renderer/stores/preparation.test.ts`。 |
| M030 | 共享/本机复核：设置组合入口灰底材质与其他下拉一致；聊天入口默认透明、悬浮反馈。 | `reasoningEffortControl.css`。模型与档位间 6px，箭头靠右，缺失模型显示不可用但保留真实选择；不伪选另一个服务模型。 |
| M031 | 共享/本机复核：思考弹层宽 240px，内部顶部按钮合并档位及模型，两行均 12px。 | `ReasoningEffortControl.tsx`、`reasoningEffortControl.css`。顶部按钮默认透明无阴影，悬浮有反馈；进入模型列表可键盘选模型，选后返回思考视图、弹层保持打开。 |
| M032 | 共享/本机复核：滑块连续预览，结束操作才提交最近档。 | 36px 输入命中高、28px 正圆滑块头；拖动中不发 update-model IPC，松手/键盘操作结束一次提交；pointercancel/Escape 不误交草稿。方向键、Home/End、Enter、Tab/Shift+Tab 和外点检查，Enter 提交不自动关层。 |
| M033 | 共享/本机复核：滑块点击/键盘平滑吸附，拖动实时跟手。 | `reasoningEffortControl.css`。共享 240ms 曲线；dragging 时轨道/滑块不附加延迟。最低档填充端帽透明，40ms 淡出尾段避免残色圈；滑块无硬描边、有柔和阴影。 |
| M034 | 共享/本机复核：深色滑块可辨识且不刺眼。 | 深色头使用 foreground 浅灰，已填充轨道 accent 55% 与 surface 混色；浅深最低/中间/最高都检查，不能用轮廓线掩盖最低档端帽。 |
| M035 | 共享/本机复核：模型列表与思考视图双向高度/平移动画。 | `ReasoningEffortControl.tsx`、`reasoningEffortControl.css`。共享时长/曲线，视图平移 ±8px；高度使用实际自然尺寸。CSS 压缩后时长可能是 `.24s`，WAAPI 必须按 s/ms 转换，不能 parseFloat 后当毫秒造成瞬移。 |
| M036 | 共享/本机复核：活动面试保存时保留同一弹层、滑块 DOM、位置及焦点。 | 独立 busy 不参与 open；保存中 trigger/模型选择禁用，范围以 aria-disabled 和事件守卫锁值，store 同步保护阻止重复乐观写回。成功继续操作，失败回滚并显示原错误；主动外点/Escape可关，保存完成不抢用户已移开的焦点。 |
| M037 | 共享/本机复核：单档/无能力/读取失败/长列表都可用。 | 单档 range禁用而模型入口可用，无能力不伪造档位；刷新仍有真实反馈，14px Refresh 图标；长列表内置滚动条，首末高亮完整。入口：`provider-ui-smoke.mjs`、`settings-smoke.mjs`。Windows `interview-effort-smoke.mjs` 仅作场景参考，Mac需在共享或本机入口覆盖其 IPC/忙碌/失败场景。 |

## 所有下拉菜单的形状、滚动和开合

| ID | 状态及最终行为 | 文件与 Mac 逐项复核 |
| --- | --- | --- |
| M038 | 共享/本机复核：最终菜单统一 6px 内距、外框共用输入 `--radius-composer`。 | `styles.css`、`webMaterials.css`。正常桌面 web-materials 为40px连续圆角；基础token回退28px。覆盖账号、模型、附件、设置、设备和ChoiceMenu，不恢复曾讨论的4/8px、首末行动态外框半径或椭圆方案。 |
| M039 | 共享/本机复核：所有菜单项高亮为真正圆头胶囊。 | `dropdown-item` round，外框 `superellipse(2)` 和 overflow hidden。检查最上/最下项、刷新项、滚动中选项；圆形独立按钮不被菜单规则改形。入口：`continuous-corners.mjs`、`web-materials-smoke.mjs`。 |
| M040 | 共享/本机复核：仅外框负责最终裁切，内部滚动视口无大圆角二次裁切。 | `ui/dropdown-menu.tsx` 的 `.dropdown-scroll` 与 `.reasoning-model-list`。内层矩形滚动视口，外层overflow hidden；滚动条6px，轨道上下6px，首末胶囊不被内层35px旧角吃掉。 |
| M041 | 共享/本机复核：菜单真实高度从触发边展开，反向收拢，文字不缩放。 | `ui/dropdown-motion.ts`。共享240ms与非线性曲线；顶部/底部Popper定位均核对，测量壳保持最终尺寸、正文固定自然几何，阴影不被外裁切；不能替换为单纯透明度或scale。 |
| M042 | 共享/本机复核：开头短fade、收拢末尾短fade，主体不透明。 | 入口opacity在0→60%进程达到1；出口至90%保持当前opacity，再收至0。检查快速关层从当前高度/透明度继续，而非先跳到终态；不能让整个收拢阶段长时间半透明。 |
| M043 | 共享/本机复核：关闭立即卸载真实Radix层，视觉快照完成出口。 | `dropdown-menu.tsx`、`dropdown-motion.ts`。快照留在原Portal/原生dialog父层，去id/role/name、inert、aria-hidden、pointer-events none；立即释放背景焦点/滚动/Escape锁，快照不再可点击/可访问。 |
| M044 | 共享/本机复核：同Renderer唯一菜单归属与快速替换。 | 开新菜单关闭旧实时菜单且不让旧菜单焦点恢复抢新焦点；重开、组件卸载、动画结束清快照。多个Renderer不互相争归属。入口：`settings-smoke.mjs`。 |
| M045 | 共享/本机复核：动画中结构改变、resize、可用高度晚到、reduced-motion中途切换安全。 | 首帧重新测量最终碰撞高度；切换模型视图取消入口固定尺寸，媒体降级/resize恢复自然布局并清监听。检查上/下边、长列表、窄窗及100/125/150/175/200%等效缩放，不放宽几何断言。 |

## 所有模态弹窗、标题栏和技能选择

| ID | 状态及最终行为 | 文件与 Mac 逐项复核 |
| --- | --- | --- |
| M046 | 共享/本机复核：共用Modal窗口仅opacity渐入，不scale/translate。 | `ui/modal.tsx`、`modal-motion.css`。240ms共享曲线；普通backdrop同步渐暗，声明transparent不增加遮罩或压暗动画。开窗初/中/末帧核对真实dialog与backdrop。 |
| M047 | 共享/本机复核：所有关闭来源都有退出视觉，业务和native模态锁立即结束。 | `ui/modal-motion.ts`。覆盖X、Escape、outside、footer、异步成功、父条件unmount；manual-popover普通div快照渐出，绝不能另开clone.showModal重新锁页面。普通遮罩渐亮，透明遮罩保持透明。 |
| M048 | 共享/本机复核：模态快照不抢焦点、不重复表单或角色。 | `ui/modal-motion.ts`。快照清id/role/name/autofocus，inert/aria-hidden/无指针；保留原滚动及中途动画当前外观。新Modal、结束、降级、失败均清；showPopover失败退为即时关闭。入口：`profile-selection-smoke.mjs`、`interview-ux-smoke.mjs`。 |
| M049 | 共享/本机复核：减少动态效果不运行Modal出入动画，播放中启用立即清退出快照。 | `ui/modal-motion.css`、`ui/modal-motion.ts`。普通backdrop选择器的reduced覆盖需匹配原特异性；关闭/取消清理和原native showModal/close语义保持。 |
| M050 | 共享/本机复核：一页弹窗无标题分隔线，textarea内部滚动不算页面级。 | `modal.tsx`、`styles.css` 按真实 `.dialog-scroll` overflow/scrollHeight 判断；短编辑、重命名、确认应无线，长reader仍按正文滚动显示覆盖标题材质/线。 |
| M051 | 共享/本机复核：共用右上X点击区36px，上/右距dialog内边框24px；标题左24px，与X垂直居中。 | `styles.css`及Modal。覆盖资料/技能reader（含已删除状态）、编辑、知识库、重命名、活动面试设置、账号确认、截图查看等；长标题单行省略，subtitle/状态顺排，不使用窄屏不同边距。入口：`typography-smoke.mjs`。 |
| M052 | 共享/本机复核：overlay header按实际滚动条槽宽补偿右内距。 | `modal.tsx`、`styles.css`。header右边界已避让gutter，padding-right再用max(0,24px−gutter)；标题到左边框与X到右边框仍对称24px。不要重复加gutter使X额外内缩。入口：`profile-selection-smoke.mjs`。 |
| M053 | 共享/本机复核：设置保留原分类布局和左侧栏X特例。 | `SettingsDialog.tsx`。不增加全局“设置”标题栏；X左/上24px、36px命中区，分类标题仍在内容栏。此项是最终修正，不能恢复中间版本的右上共用fixedHeader。 |
| M054 | 共享/本机复核：短普通弹窗header到首label总间距16px。 | `styles.css`。去重复header底部/scroll顶部/首field margin叠加；编辑简历摘要、重命名需实测。只收首字段，上/右24px和X36px不动，其他字段原20px间距及长reader标题避让保持。 |
| M055 | 共享/本机复核：技能选择勾选/取消和半选横线均在框内绘入/退回。 | `styles.css`。原生input16×16、radius6、键盘与indeterminate保持；clip-path+opacity240ms，取消底色延后80ms再160ms退色，按压原缩放保持；reduce直接。入口：`profile-selection-smoke.mjs` 双向中间帧，不能只验transition存在。 |

## 准备聊天、引用、消息折叠与时间

| ID | 状态及最终行为 | 文件与 Mac 逐项复核 |
| --- | --- | --- |
| M056 | 共享/本机复核：准备输入底排附件、组合模型、发送同为32px。 | `styles.css`、`ChatTools.tsx`。模型胶囊按实际字高上下6px、左右10px，底排到输入左右/底部8px；textarea起点保持。入口：`composer-smoke.mjs`、`ui-alignment-smoke.mjs`。 |
| M057 | 共享/本机复核：页面级提示/错误/连接重载/存储重试移到输入框上方统一区域。 | `PreparationPage.tsx`、`preparation-notices.css`。原文、颜色、role及条件保持，空区域不占位；消息错误仍在消息内，登录错误仍在字段下。入口：`provider-ui-smoke.mjs` 失败→重载真实UI路径。 |
| M058 | 共享/本机复核：用户气泡不再显示模型/档位提示。 | `PreparationPage.tsx`、`UserMessage.tsx`。只移显示，不删实际request.options/历史模型快照/附件；开始面试summary仍显示真实模型/档位，不能误删共用effortLabels import。 |
| M059 | 共享/本机复核：用户气泡去尾角，四角为40px连续角。 | `chatMessages.css`。复用准备输入 `--radius-composer`，不是浮窗局部同心半径；浅深长短消息、选中态和附件均核对。 |
| M060 | 共享/本机复核：超过20个视觉行默认折叠，恰20行不折叠。 | `UserMessage.tsx`、`chatMessages.css`。按lineHeight×20与实际scrollHeight判断，长行自动换行也计入；resize/字体加载后重算，p仍为user-bubble直接子元素以保留文本光标。 |
| M061 | 共享/本机复核：显示更多/收起支持高度动画及减少动态效果。 | 共享240ms曲线，展开显示全文，折叠回20lh；按钮28px、12px字，aria-expanded/controls正确。附件始终在折叠正文外可见，全文复制不取截断DOM。 |
| M062 | 共享/本机复核：用户和助手复用复制组件。 | `ChatMessageActions.tsx`。用户动作右对齐、时间左复制右；助手复制左时间右，助手复制悬浮轮廓与正文左缘对齐，无负margin。复制失败不显示已复制，不能改正文内容或渲染转换后的文本。 |
| M063 | 共享/本机复核：助手空正文阶段不显示时间或空footer。 | `ChatMessageActions.tsx`。思考/联网/查询/生成但content.trim为空均隐藏；首个非空流式正文到来后可显示；用户自己的发送时间不受影响，不改真实timestamp。入口：`chat-response-smoke.mjs`。 |
| M064 | 共享/本机复核：消息时间按本地日历和系统区域格式。 | `services/messageTime.ts`。当天24小时两位hh:mm，昨天/前天经t翻译，其他/未来日期按系统Intl日期；无效/缺失返回null，dateTime是真实ISO。跨DST、本地午夜与不同地区不能按固定24小时差误判。 |
| M065 | 共享/本机复核：新user写现有startedAt，重试保留原user时间。 | `stores/preparation.ts`。旧user仅取紧邻下一assistant.startedAt同轮回填显示；缺失不编造、不写盘、不改存储版本。入口：`message-time.test.ts`、`renderer/stores/preparation.test.ts`、`composer-smoke.mjs`。 |
| M066 | 共享/本机复核：正文已知来源域名链接变紧凑灰胶囊。 | `services/markdown.ts`、`MarkdownContent.tsx`、`SourceLink.tsx`。仅已知来源URL且域名式标签匹配才转换；只移紧邻包围该引用的中/英文括号。普通链接、未知URL、代码/公式/原文及全文复制不变。 |
| M067 | 共享/本机复核：正文、来源列表、更多来源共用SourceLink。 | `SourceLink.tsx`、`ChatSources.tsx`、`sourceLink.css`。12px文字、16px行高、最小高20px、1px/7px内距、4px图标间隔、最大min(220px,100%)；长host省略但可访问名称保留title+完整host。来源顺序保持，前三个直显，其余“更多来源(N)”。 |
| M068 | 共享/本机复核：来源展开/收起有真实高度、opacity及箭头动画。 | `sourceLink.css` 的details-content。共享240ms曲线，内容不硬限高，reduce直切；来源点击仍走受控openChatLink，失败保留原alert，不添加悬停提示。入口：`chat-response-smoke.mjs`。 |
| M069 | 共享/本机复核：favicon固定11×11，不影响标签和点击命中。 | `SourceLink.tsx`、`sourceLink.css`。默认Globe，img解码成功才切入；失败即回Globe；lazy、async decoding、no-referrer，普通/更多/正文同实现。当前provider响应不承诺CORS或无cookie，不加crossOrigin导致有效图片全部失败。 |
| M070 | 共享/本机复核：favicon只从固定 `https://a.favicon.im` 取规范DNS hostname。 | `services/sourceFavicon.ts`。只用host构造固定path+throw-error-on-404=true；不传来源页面path/query，拒绝URL/API endpoint、端口、IP、localhost/保留后缀/无效DNS；不新增Renderer网络IPC、Node或泛化fetch。 |
| M071 | 共享/本机复核：CSP只扩精确img-src origin。 | `shared/index.html`。仍是self/data及固定图标origin；不能改为全HTTPS、扩大connect-src、关闭CSP。失败内存冷却60秒、最多128个URL，避免流式重挂载重试风暴；网络可用性不作地域保证。 |
| M072 | 共享/本机复核：图标测试离线运输与生产权限分开。 | `source-favicon.test.tsx`、`chat-response-smoke.mjs`。专属合成session完全接管HTTPS，仅精确image URL返回SVG200/404/坏图片字节；其他仍拒绝，无外网fallback。Mac同样验证img成功/失败，不能临时关offline guard/CSP让测试通过。 |

## 页面、设置与侧栏转场

| ID | 状态及最终行为 | 文件与 Mac 逐项复核 |
| --- | --- | --- |
| M073 | 共享/本机复核：主页面、设置分类、记录列表/详情复用浏览器View Transition。 | `App.tsx`、`SettingsDialog.tsx`、`HistoryPage.tsx`、`ui/switchView.ts`、`page-motion.css`。只保留视觉快照，不挂旧React交互/异步副本；准备页继续挂载，输入、消息、附件不因导航丢失。 |
| M074 | 共享/本机复核：普通页面轻移8px并交叉淡化；记录前进/返回为反向32px水平过渡。 | `page-motion.css`。进入详情旧向左、新从右向左；返回旧向右、新从左向右。240ms共享曲线，reduce或API不可用直接更新，不能恢复旧150ms延迟/整页缩放。 |
| M075 | 共享/本机复核：快照限制在原内容边界，底色固定，侧栏静止。 | `switchView.ts`、`page-motion.css`。检查中间帧无侧栏竖条、背景穿透/闪边；设置贴边角继承真实radius/curve；窗口控制按钮独立静止层不被页面快照遮挡。 |
| M076 | 共享/本机复核：快速跨容器切换保留最新业务更新。 | `switchView.ts` 使用每容器revision与全局视觉过渡管理；取消旧视觉不丢另一容器的最新callback；开Modal取消页面视觉。入口：`history-branding-smoke.mjs`、`settings-smoke.mjs`。 |
| M077 | 共享/本机复核：删除记录详情只做一次反向返回，不先闪列表再抽动。 | `HistoryPage.tsx`、`HistoryDetail.tsx`。store删除与截图清理期间保留离场record，截图捕获后再切列表；失败留原详情，快速导航不把新选择拉回。原删除确认和真实存储语义不变。 |
| M078 | 共享/本机复核：侧栏仅一根3×18px正圆端帽竖条，主导航和聊天记录共用。 | `SidebarSelectionIndicator.tsx`、`sidebarSelectionIndicator.css`、`Sidebar.tsx`。有条项之间240ms非线性滑动，进入无条状态原位淡出，从无条到有条先定位再淡入；最终规则不是fade-only，也不是每行各造伪条。 |
| M079 | 共享/本机复核：侧栏marker初次挂载和滚动/布局变化正确。 | 父aside ref attach后在effect安装Observer并立即测量；选中行、scroller、导航/标题变化和scroll/resize更新，完全不可见则淡出且裁切在scroller；同目标布局变化直接跟随，卸载清RAF/Observer/监听，reduce立即到位。 |
| M080 | 共享/本机复核：展开侧栏固定230px，收起68px，不再1100px断点变200px。 | `styles.css`。跨断点、中英、长聊天标题和小窗口均检查；不挤占账号/用量卡真实文字。入口：`ui-alignment-smoke.mjs`、`typography-smoke.mjs`。 |
| M081 | 共享/本机复核：主导航和设置标签普通/粗体交叉淡化，文字颜色/背景同步。 | `SelectionLabel.tsx`、`styles.css`。保留一份真实文字，粗体视觉层aria-hidden，不重复可访问名称；初始、快速切换和reduce均核对。 |

## 活动面试设置、权限预检与扫光

| ID | 状态及最终行为 | 文件与 Mac 逐项复核 |
| --- | --- | --- |
| M082 | 共享/本机复核：活动/前置设置都是左标签、右控件，不再宽窗两列label在上。 | `InterviewSettingsPanel.tsx`、`SpeechControls.tsx`、`SpeechModelSettings.tsx`、`InterviewDisplayControls.tsx`、`styles.css`。七行：系统播放、麦克风、回答模型/档位、语音模型、推理设备、字号、透明度；控件同列同宽、标签/控件中心一致，不让回答模型占半行空白。 |
| M083 | 共享/本机复核：设置控件列默认240px，540px以下160px、行gap10px。 | 同上。宽窗gap16px；窄窗标签可自然换行，不竖排文字，七行/section始终纵向堆叠；960/620/440窗口及中英浅深核对，无水平溢出。入口：`ui-alignment-smoke.mjs`、`typography-smoke.mjs`、`interview-ux-smoke.mjs`。 |
| M084 | 共享/本机复核：语音加载/等停顿状态在“语音识别”分组标题旁。 | `SpeechModelSettings.tsx`。原文及role=status保留，flex自然换行、长英文不另造固定整行；CPU警告保留原alert。语音切换期间音频/ASR适当锁定，回答模型仍可调整，不重启采集或打断原回答。 |
| M085 | 共享/本机复核：预检真异步期间按实际来源预留结果行与截图行。 | `PreparationPage.tsx`。loading ul沿同一 `.interview-access-list/.interview-access-row`，role=status加载播报保留在sr-only；确认开始禁用，不显示伪“可用”或可操作测试按钮。未启用麦克风只显示已知“不使用麦克风”，不凭空加该权限行。 |
| M086 | 共享/本机复核：所有预检行高至少36px，加载/结果布局一致。 | `styles.css`。每行占好最终位置，dialog/list/row/footer不得由短跳长；截图行也同高。真实拒绝/错误需要详情时允许按内容扩展，不能裁掉错误来强行保持高度。入口：`interview-ux-smoke.mjs` 延迟真实checkInterviewAccess IPC合成边界。 |
| M087 | 共享/本机复核：权限状态、测试按钮骨架长度由真实控件测量，不是88/72px常量。 | `AccessSkeleton` 位于 `PreparationPage.tsx`。status-slot装隐藏真实Check14+状态字；test-slot装同一个AudioCheck.button(source,false)；外叠quota骨架。Windows not-required、Mac granted正常截图状态分别取平台文字宽度，不把Windows长状态硬套Mac。 |
| M088 | 共享/本机复核：设备摘要用当前已知名的自然宽度估算，不是180px固定骨架。 | device-slot隐藏测量audioName文字，真实未知名不能事前保证长度；不向用户显示未确认的默认/上次名，读到报告后显示真实名称。允许真实长名正常换行，不为稳定高度截断真实资料。 |
| M089 | 共享/本机复核：通用quota扫光固定裁切在底条胶囊内。 | `styles.css`。host `clip-path: inset(var(--skeleton-inset,.5em 0) round999px)`与底条相同；button/progress inset0，移动的::after不能扫出矩形亮角。浅深沿原余额颜色，1.8s ease-in-out无限sweep；reduce取消并隐藏扫光，不把整个骨架隐藏。 |
| M090 | 共享/本机复核：扫光验证必须有真实像素变化且圆角外无矩形泄漏。 | `interview-ux-smoke.mjs`：真实CSSAnimation0/35/65%三相位，以自然DPR的webContents.capturePage取局部像素，nativeImage只在内存解码；独立同坐标黑白正圆参考筛查参考覆盖，同时保留原半径加0.5 CSS安全距离，内部有亮度变化、左右外角不变，随后恢复动画，最终采样规则见M154。自由运行transform变化与浅深/reduce矩阵仍保留。伪元素动画枚举必须getAnimations({subtree:true})，不能因::after未枚举而放宽“真实扫光”断言。 |
| M091 | 共享/本机复核：同轮loading/ready复用真实AudioCheck，重新检查换新实例清旧错误。 | `PreparationPage.tsx` 中key=accessAttempt。音频测试error→停止idle→重新检查，加载和就绪都不能残留上轮error或电平状态；取消/旧异步结果不得写回新attempt。保留10秒双源测试、仅activity而非segment路由、开始面试前释放采集。 |

## 云同步布局与知识库进度

| ID | 状态及最终行为 | 文件与 Mac 逐项复核 |
| --- | --- | --- |
| M092 | 共享/本机复核：全局同步状态、备份提示/警告与两操作按钮同一行居中。 | `SyncSettingsPanel.tsx`、`styles.css`。grid左minmax(0,1fr)文字、右两个auto按钮，文字可折行，按钮固定靠右；原文本、颜色、status/alert角色保留，不把全局警告另放整行。入口：`cloud-account-smoke.mjs`。 |
| M093 | 共享/本机复核：条目冲突/失败仍是独立条目和独立处理入口。 | `SyncSettingsPanel.tsx`。条目标题/说明紧凑同行、与各自按钮中心一致；不能把条目错误合并成全局提示而丢冲突操作，不更改备份协议/云端数据。 |
| M094 | 共享/本机复核：知识库向量进度真实0–100%，不再全阶段强夹99。 | `services/knowledgeIndex.ts`、`KnowledgePage.tsx`。embedding N/N可显示100；indexing从0/N开始是新写盘阶段，显示“正在写入索引…”，不伪造逐行百分比；queued/parsing新任务真实0保留。 |
| M095 | 共享/本机复核：知识库完成/失败/取消及已有资料状态保持。 | formatter ready/failed/cancelled沿原文，写盘完成不回退0；未索引/停用状态不变。`knowledge-index-store.test.ts`覆盖终点阶段与新任务；无后台pipeline、索引数据、模型或RAG阈值修改。 |

## 更新共享契约与 Windows 参考行为

以下行为均为双端需求；Windows实现用于说明契约和预期，不能把NSIS代码移入Mac或据此宣称Mac已完成。

| ID | 状态及最终行为 | 位置、Mac实现/复核步骤 |
| --- | --- | --- |
| M096 | 共享/本机复核：`UpdateCall`仅check增加可选force:boolean。 | `contracts/updates.ts`、`ipc/updates.ts`。主窗口主frame白名单保持，其他字段/操作额外force/字符串/子frame/其他窗口均拒绝；preload仍受控invoke，Renderer无任意路径/网络权限。入口：`desktop-ipc.test.ts`。 |
| M097 | 共享/本机复核：检查按钮长按5秒强查，短按普通检查。 | `UpdatesPanel.tsx`。鼠标/触摸、Space/Enter；松开/移出/取消/blur/document.hidden卸载取消计时，键盘repeat不重复启动；强查释放后不再追加普通check。仅按钮为可检查语义时启用长按，下载/待安装时保持其原动作。UI不增加限频、倒计时或隐藏手势说明。 |
| M098 | 共享/本机复核：检查/下载/恢复/安装保持单任务生命周期。 | `backend/updates/service.ts`。check(force)透传，恢复完整包先于autoDownload判断；下载按钮等待正在恢复，不能并发下载同包；旧任务取消后不再发状态。API保持checkForUpdates(force?)、restoreDownloadedUpdate(signal?)、isAutomaticDownloadAllowed()、lastCheckedAt()及dispose():void或Promise。 |
| M099 | Mac待实现：跨进程一小时发行检查缓存。 | 参考 `shared/electron/backend/updates/cache.ts`、`shared/electron/backend/updates/provider.ts`、`shared/electron/backend/updates/driver.ts`。启动和普通check共用3600000ms窗口；新driver/service同结果且无额外GitHub API/manifest请求，lastCheckedAt使用成功时刻，不伪装每次cache命中都是新查。 |
| M100 | Mac待实现：失败尝试也持久限频，时间回拨不绕过。 | 发网络前原子记录attemptedAt和attemptSucceeded=false；成功验证后才写info/checkedAt/true。一小时内失败重放明确失败，旧成功info不能掩盖本次失败；now<attemptedAt仍沿屏障。缓存损坏/读写失败停止联网并报错，不能降为内存假成功。 |
| M101 | Mac待实现：强查绕过TTL并清自动下载冷却。 | force=true触发一次真实发行查找/清单获取，仍单飞、可取消、无认证；不因普通缓存命中丢失强查。缓存/签名失败仍不可绕过。 |
| M102 | Mac待实现：本地完整更高版本包优先恢复，超过一小时也不强制联网。 | 普通check先核对已完成缓存，版本必须高于当前；完整且可信则直接available→downloaded，无API/manifest/包请求，autoDownload=false也恢复。相同/更旧包不阻止到期查新；force明确跳过本地优先。 |
| M103 | Mac待实现：本地包恢复重做路径、大小、SHA512和既有签名验证。 | 不信任“曾下载”布尔值或文件存在；拒绝符号链接/越界/篡改/错误平台/版本/文件名。恢复期间禁止底层downloader意外网络fallback；恢复验证失败应明确报错/进入受控重新下载流程，不能静默标为downloaded。 |
| M104 | Mac待实现：完整包普通退出保留，下一次仍可手动安装。 | Windows参考仍由stock electron-updater持有pending包；Mac需用归属明确的持久目录替代仅tmp目录，不在dispose/check开始无条件clearDownload。保留数据不等于自动安装。 |
| M105 | Mac待实现：下载开始前持久记录所属发行journal，进程中断可恢复。 | cache参考schemaVersion1/target/attemptedAt/attemptSucceeded/checkedAt/notBefore/info/download；元数据≤256KiB、目标平台复验、原子文件写，时间为有效非负安全整数；Mac签名字段另见后文，不直接信任JSON。 |
| M106 | Mac待实现：退出中断下载先取消传输、等任务完成，再删除所属半成品。 | 不能删未知目录、活跃别任务或完整包。journal恢复时发现未完成包先清理、保守重记一小时冷却；清理/持久化失败保留journal供下次重试，不能假清理或后台悬空Promise。 |
| M107 | Mac待实现：中断后禁止自动下载一小时，手动下载仍可用。 | isAutomaticDownloadAllowed按notBefore及未清journal判断；autoDownload偏好保持原值，不把冷却写成关闭偏好。手动download绕过自动冷却但仍校验；force清冷却。下载中关闭autoDownload不取消已开始任务，取消仍走原入口。 |
| M108 | 共享/本机复核：正常退出等待更新清理，重复quit等待同一barrier。 | `main.ts`、`service.ts`。updatesClosing/Closed避免第二次quit穿透；dispose等待check/download/restore/adapter jobs，完成再继续telemetry及其余清理。安装流程保留明确安装选择、面试禁装和保存握手，不能普通退出偷偷装。 |
| M109 | 共享/本机复核：固定匿名公开源、本平台完整稳定发行选择不变。 | `shared/electron/backend/updates/releases.ts`、`shared/electron/backend/updates/provider.ts`。固定NCFXZ/VoxCue-releases，按平台资产完整性/版本选，不信统一Latest/标题；无认证，无预发行/降级。保留API/清单流量上限、取消/超时、摘要与命名校验。Mac不得因Windows更高版本误选EXE。 |
| M110 | Windows参考：真实NSIS恢复要重建stock待安装状态，不只是UI phase。 | `driver.ts`、`windows/test/scripts/updates-native-smoke.mjs`。参考native downloader被本地验证包命中、verifySignature额外调用、HTTP fallback被拒；合成包签名仅fixture逐实例显式覆写，不代表真实签名验收。Mac对应必须重建Sparkle可安装状态，不能照抄NSIS API。 |

## Mac 原生更新：必须完成的迁移及签名步骤

| ID | 状态及缺口 | Mac 本机具体实施与预期 |
| --- | --- | --- |
| M111 | Mac待实现：现有适配器仍是每次检查联网、check先clearDownload、下载mkdtemp、dispose异步清目录。 | owning文件 `macos/electron/updates/driver.ts`。首先逐一替换这些生命周期点，加入受控应用数据缓存目录、持久归档和等待式dispose；不要误将共享可选接口的类型兼容当功能完成。 |
| M112 | Mac待实现：入口装配传本机userData下固定归属目录。 | `shared/electron/main.ts` 的createMacUpdateDriver分支目前无cacheDirectory。Mac适配可在main侧传入或在native factory受控取目录；Renderer不得接收目录。缓存与archive目录须拒绝符号链接/越界，私有模式/原子写按原平台规则。 |
| M113 | Mac待实现：持久化可信Mac签名材料，不能照抄Windows裁剪后的info。 | 当前PlatformUpdateInfo/cache重建只保留url/size/SHA512/minOS，未保留Mac edSignature和voxcueSignature；Mac需保存可重新认证的原签名清单或最小平台签名envelope，并在加载时调用现行签名/平台选择验证。不得从cache.info直接构造“已签名”状态或丢签名后仅验hash。 |
| M114 | 边界/本机复核：沿用固定Ed25519公钥和两层清单/归档信任。 | `macos/electron/updates/manifest.ts` 的signedMacUpdate/publicUpdateKey/macUpdatePayload；latest-mac.yml必须平台匹配。重验voxcueSignature绑定的协议、版本、URL、size、SHA512、edSignature、minimumSystemVersion；单独改其中任何字段都拒绝，不接受Windows清单或错误公钥。 |
| M115 | Mac待实现：恢复前流式核对完整ZIP，安装前仍保留Sparkle归档验证。 | `macos/electron/updates/download.ts` 的verifyDownload拒绝非普通文件/符号链接/大小或SHA512错；保留2GiB上限及下载截断/超长拒绝。恢复重新认证签名清单后，不得跳过 `install-feed.ts` 提供edSignature及Sparkle对归档的既有验签；不能用“本地缓存可信”绕过任一层。 |
| M116 | Mac待实现：只在显式安装路径重建本地feed并交给原native updater。 | `install-feed.ts`、`macos/native/Updater.mm`。保留随机token、127.0.0.1临时feed、GET/Host限制和归档本机流；native.begin→ready→commit→quit顺序保持。恢复downloaded不得主动begin/commit安装，面试/未保存拒绝仍适用；dispose不得把已committed的安装误当中断下载取消或删除其仍占用归档。 |
| M117 | 边界/本机复核：固定代码签名、凭据助手和更新签名身份不能轮换。 | `macos/local-signing-public.json` 指纹为唯一对照，固定私钥位于 `.tools/development-signing`；凭据助手规范副本 `.tools/credential-helper-v1` 保留。更新私钥 `.tools/update-signing/ed25519.key` 与 `macos/update-public-key.json` 匹配，缺失/错配失败，不生成替代身份、不ad-hoc回退。不得读取私钥内容输出或提交。 |
| M118 | Mac待实现/本机验证：在真实Mac adapter隔离夹具覆盖完整缓存矩阵。 | 扩展 `macos/test/scripts/updates-native-smoke.mjs`：首次联网→一小时内新实例无API/manifest→失败重放→时钟回拨→force一次真查；完整包在autoDownload关闭及超过一小时重启恢复且无下载请求；同/旧版本不阻查新；坏size/SHA/清单签名/归档签名/公钥/平台/链接拒绝。不得用Windows真NSIS场景代验。 |
| M119 | Mac待实现/本机验证：真实慢loopback中断及退出barrier。 | 同本机native入口：流式写入半包后dispose/退出，等待完成，所属partial删除、完整包保留、journal/冷却正确；重启autoDownload=true仍不自动下，手动可下，force解除冷却；并发/重复quit和取消检查/恢复时无悬空资源或晚到写回。未知/非owner路径一律保留。 |
| M120 | 本机验证：正式包/旧版隔离副本验证签名及恢复升级路径。 | 先用公开指纹检查 `development-signing-smoke.mjs` 与固定凭据助手；构建后 `package-smoke.mjs --install-archive` /原生更新入口验证打包配置、公钥、归档摘要及Sparkle拒绝篡改。仅在owner临时旧版副本测试，不替换真实安装，不解锁/读取真实账号；线上校验另按当时公开完整Mac资产执行，不能把未上传包当线上可用。 |

## 定向测试入口及跨平台复核顺序

所有共享脚本在当前平台目录运行，例如 Mac 的 `node ../shared/test/scripts/<name>.mjs`。Windows 专属入口在Mac只读作场景/断言参考，所需能力应接入现有Mac入口；不能直接在Mac调用Windows可执行文件或生成Windows配置。

| ID | 类别 | Mac 必须执行/保留的覆盖（不是执行结果） |
| --- | --- | --- |
| M121 | 架构/类型/单测/共享构建 | 在macos目录按现有脚本运行check:architecture、typecheck、test及build:shared（包含symbols）；重点覆盖 `update-cache.test.ts`、`updates.test.ts`、`desktop-ipc.test.ts`、`interview-settings.test.ts`、`knowledge-index-store.test.ts`、`markdown.test.tsx`、`source-favicon.test.tsx`、`message-time.test.ts`、renderer preparation tests。新增Mac适配必须补本机native单测/场景。 |
| M122 | 登录与账号 | `login-smoke.mjs`、`password-policy-smoke.mjs`、`login-entry-smoke.mjs`、`cloud-account-smoke.mjs --login-check`、`--scrollbars`；保留本机cloud-form-lifecycle、cloud-accessibility、login-actions-native等既有入口，覆盖邮件/验证码/错误归属/取消/重挂载，不读取真实账号。需要独立服务端时，`VOXCUE_TEST_SERVER_ROOT`仅指向owner临时的0.5.3/`3bceb615dbba900f669322c301fc4b5b473dfb15`只读参考checkout；不修改/部署服务端或沿用真实账户目录。 |
| M123 | 通用形状/字号/布局/菜单/Modal | `web-materials-smoke.mjs`、`interview-chrome-smoke.mjs`、`settings-smoke.mjs`、`profile-selection-smoke.mjs`、`typography-smoke.mjs`、`ui-alignment-smoke.mjs`、`ui-material-refinement-smoke.mjs`、`ui-ux-smoke.mjs`。覆盖中英×浅深×宽窄/长标题、打开/关闭中间帧和reduce；几何用真实实测，不改容差掩盖Mac问题。 |
| M124 | 聊天/引用/模型/历史 | `composer-smoke.mjs`、`chat-response-smoke.mjs`、`provider-ui-smoke.mjs`、`history-branding-smoke.mjs`、既有conversations/chat-lifecycle/chat-progress。保留实际options、全文复制、20视觉行、旧数据兼容、受控链接/离线运输和快速导航。 |
| M125 | 面试生命周期与预检 | `interview-ux-smoke.mjs`、`interview-stability-smoke.mjs`及本机interview-layout、window-native、speech-switch入口。将Windows effort场景移植到本机能力边界：拖动一次提交、保存持层/焦点/失败回滚、ASR切换不中断原回答、七行同列、预检骨架/真实尺寸/扫光/错误重查。 |
| M126 | 更新与退出 | 共享 `updates-smoke.mjs` 复核5秒长按、键盘短按/长按、取消计时、保存与重复quit；本机 `updates-native-smoke.mjs` 必须按M118–M119补完整矩阵，并核对固定平台选择、自动下载偏好及安装握手，不只测UI phase。 |
| M127 | 既有全量/平台与五档矩阵 | 沿用 `shared/test/scripts/functional-suite.mjs --list` 和平台suite，不删除/跳过原29组及追加用量组合、缩短轮次或长稳时间来适配新UI。保留 `macos/test/scripts/ui-refinement-matrix.mjs`、native window/layout、20轮面试及600秒语音等既有完整入口；只有独立Node/loopback组按既有调度允许并行，GUI/原生/模型/性能独占。 |
| M128 | 真实环境条件项 | 自动化无法触发的真实窗口隐藏/恢复、屏幕共享隐藏、权限撤销/系统设置返回、物理音频设备/触控板、真实账户服务质量另列条件验证。合成事件/离线fixture不是物理硬件、Keychain迁移或真实服务验收。 |
| M129 | RAG一致性与知识调用边界 | 对照0.6.8承接的0.6.7源码及正式包内RAG模块/固定模型元数据：本轮没有改pipeline/分块/向量/排序/阈值。仅验证资料整理、技能生成、面试资料调用和错误/取消收尾；如果差异来自环境/fixture先报告，不借测试修复改变召回或索引格式。 |
| M130 | 清理与发行交付边界 | 执行前后核对owner临时目录/占用/消费者，仅删明确无用产物；保留正式基线、固定签名/凭据助手、现用依赖/模型与验证过的公共缓存。源码/Windows包按当前授权由发行任务处理；Mac构建、签名、资产与上传必须在Mac完成适配和本机验证后按当时授权执行，不用Windows包替代Mac资产。 |

## 实际差异文件索引与后续修复接续

本节用于避免合并/测试修复漏项，不把新增文件的未跟踪状态误解为可删除临时文件。

- 共享入口/状态：`shared/src/App.tsx`；`stores/preparation.ts`；`services/chatOptions.ts`、`speech.ts`、`knowledgeIndex.ts`、`markdown.ts`、`messageTime.ts`、`sourceFavicon.ts`。对应M027–M037、M057–M081、M094–M095。
- 登录/表单：`LoginPage.tsx`、`CloudAccountPanel.tsx`、`VerificationCodeInput.tsx`、`cloudAccountPanel.css`、`login-preview.css`、`InterviewPreview.tsx`、`ui/useLoginPreviewPlayback.ts`。对应M010、M016–M026。
- 聊天/引用：`PreparationPage.tsx`、`ChatTools.tsx`、`UserMessage.tsx`、`ChatMessageActions.tsx`、`chatMessages.css`、`ChatSources.tsx`、`SourceLink.tsx`、`sourceLink.css`、`MarkdownContent.tsx`、`preparation-notices.css`及 `shared/index.html`。对应M027–M037、M056–M072、M085–M091。
- 面试/设置：`FloatingInterview.tsx`、`InterviewSettingsPanel.tsx`、`SpeechControls.tsx`、`SpeechModelSettings.tsx`、`InterviewDisplayControls.tsx`、`SettingsDialog.tsx`、`SyncSettingsPanel.tsx`、`KnowledgePage.tsx`。对应M009–M013、M027–M037、M053、M082–M095。
- 公共交互/材质：`ReasoningEffortControl.tsx`、`reasoningEffortControl.css`、`SelectionLabel.tsx`、`Sidebar.tsx`、`SidebarSelectionIndicator.tsx`、`sidebarSelectionIndicator.css`、`HistoryPage.tsx`、`HistoryDetail.tsx`、`ui/dropdown-menu.tsx`、`ui/dropdown-motion.ts`、`ui/modal.tsx`、`ui/modal-motion.ts`、`ui/modal-motion.css`、`ui/switchView.ts`、`ui/page-motion.css`、`styles.css`、`platform/webMaterials.ts`、`platform/webMaterials.css`。对应M007–M015、M027–M055、M073–M091。
- 更新生产：`shared/electron/backend/updates/cache.ts`、`driver.ts`、`provider.ts`、`service.ts`、`contracts/updates.ts`、`ipc/updates.ts`、`main.ts`、`shared/src/components/UpdatesPanel.tsx`。对应M096–M120；`contracts/uiMessages.ts`同步新提示/日期/展开用语与英文，不能只搬中文UI。
- 测试适配保留：除M121–M127列出的新增断言，还包括 `install-ui-account.mjs` 的 openModelMenu/openReasoningControl统一入口，local-mode/free-service/rag-ui/interview-stability 的菜单归属适配、Windows workflow/effort场景和 `management-scrollbar-checks.mjs`。改变DOM后必须更新真实选择器/菜单保持打开的预期，不能删除后台options/安全/几何断言。
- 测试中已纳入的修复要点：模型视图高度时长s/ms转换；DPI实际border同心计算；菜单首末内层二次裁切；关闭快照即时解锁/旧菜单焦点；modal遮罩reduced选择器；短弹窗重复首字段间距；侧栏父ref安装时序；记录删除离场快照；预检每attempt重置AudioCheck及扫光伪元素枚举。对应M009、M035、M040–M055、M077–M079、M087–M091。

### 全量测试接续修复与清理

| ID | 修改及原因 | Mac复核步骤与影响范围 |
| --- | --- | --- |
| M131 | 测试夹具：`shared/test/scripts/ui-material-refinement-smoke.mjs` 的History搜索清空裸坐标点击原先可能落在尚未结束的screen快照上。该检查前等待 `data-view-direction` 退出及布局settle，再断言 `elementFromPoint` 在控件中心真实命中。 | 在Mac实际指针复测搜索→清空→焦点和44px/20px既有几何；仍保留原user-select、清空行为及容差，不靠取消页面动画或放宽断言通过。与M073–M076有关，不是修改产品文字选择逻辑。 |
| M132 | 测试夹具：`shared/test/scripts/account-erasure-smoke.mjs` 不能继续将 `.cloud-sync-actions` 当作flex-end；最终布局是左侧状态列加右侧两按钮的grid。 | 保留账号删除真实业务流程，改测两按钮同中心、间距8px、末按钮贴操作行右端且与设置switch共右缘、body左右内距24px。删除确认Modal的footer仍保留原flex-end断言，并验证两侧padding24px、按钮gap12px、末按钮右边距24px。Mac须实际指针复核，不把同步grid的测试适配误当产品footer规则变更；关联M051、M092–M093。 |
| M133 | 生产：`shared/src/components/CloudAccountPanel.tsx` 的邮箱onBlur在relatedTarget属于 `.login-skip-button` 时跳过该次邮箱校验。否则无效邮箱失焦会在pointerdown与mouseup之间插入错误行、移动跳过按钮，导致首次click丢失。 | Mac保留 `local-mode-smoke.mjs` 原无效邮箱+真实单次“跳过登录”点击+新主窗口结果流程，在宽/窄登录尺寸实际指针复核；不能改成有效邮箱、直接调用setLocalMode IPC或额外点击来掩盖问题。跳过仍不提交/校验表单，普通失焦/登录提交的邮箱错误仍准确，Tab进入跳过及真正本地模式/返回登录/重启持久化继续覆盖。关联M017–M019，不放宽主窗口/子frame授权。 |
| M134 | 测试夹具：`shared/test/scripts/language-smoke.mjs` 的分类审查等待目标heading、View Transition及有限动画稳定；设备检查从旧独立card改为当前横向row真实边界。 | Mac保留英文泄漏leaks、控件clipped全部断言及宽窄矩阵；按Chromium 1/64px布局单位核对行内子元素边界、左label/右control、垂直中心及dialog水平containment，失败输出具体rect。不用零浮点比较误报、不放宽成忽略真实溢出，也不取消产品转场；关联M073–M076、M082–M083。 |
| M135 | 生产：`shared/src/styles.css` 将正文内部交互控件的default光标例外扩为与文本光标规则一致的九类范围，修复面试/记录截图缩略图button及img误继承text光标。 | 九类为 `.markdown-content`、`.user-bubble > p`、`.answer-text`、`.transcript-item > p`、`.floating-question`、`.interview-answer-failure-reason`、`.record-transcript-text`、`.record-answer-question`、`.record-answer-content`。正文及普通嵌套文本仍为I-beam，内部button/a/role=button及全部后代恢复普通箭头。Mac保留 `continuous-corners.mjs` 已有精确检查，在 `interview-screenshot-smoke.mjs` 的真实浮窗与记录缩略图button/img上实际指针复核，不新增逐行镜像测试或取消正文文本光标；关联M014。 |
| M136 | 测试夹具：`shared/test/scripts/ui-ux-smoke.mjs` 从旧行内 `::before` 选中条改测实际唯一 `.sidebar-selection-indicator`，并等待View Transition及真实marker动画结束。 | Mac保留3×18px、相对行左3px、垂直居中、round/999px半径、无阴影、contained、aria-hidden与唯一节点全部断言；使用真实marker，不为了匹配旧伪元素恢复重复选中条或取消滑动。关联M078–M081。 |
| M137 | 测试夹具：`shared/test/scripts/free-service-smoke.mjs` 的最小窗口侧栏预期改为最终固定230px，并等待实际resize完成。 | Mac保留全部中英×浅深用量阈值/组合/边界场景，跨最小窗口复核文字完整、控件不溢出；旧200px断点已撤回，不能恢复产品窄侧栏或放宽额度断言。关联M080及0.6.8用量回归基线。 |
| M138 | 测试夹具：`shared/test/scripts/management-scrollbar-checks.mjs` 的真实wheel前等待目标可见、View Transition及有限动画稳定；960px导航内宽改为210px（230px侧栏减20px），替代旧180px。 | Mac实际wheel复核history/knowledge、记录转写与回答轨道，保留固定header、gutter、6px圆头、真实溢出、顶部/底部及wheel所有检查。只修交互时序和已撤回尺寸，不用脚本直接改scrollTop替代wheel，也不删除页面动画。关联M007、M073–M080。 |
| M139 | 测试夹具：`shared/test/scripts/components-ui-smoke.mjs` 按融合入口检查真实三行“回答模型、语音模型、推理设备”，回答生成组一行、语音识别组两行。 | Mac继续验证全部控件列对齐同宽、标签与控件不重叠、分组归属及原组件安装/切换流程；不能保留旧独立“思考强度”第四行预期或删掉设置几何。关联M027、M082–M084。 |
| M140 | 测试夹具：`shared/test/scripts/updates-sidebar-smoke.mjs` 的合成driver在signal abort时reject规范 `name=AbortError`，替代普通 `Error('cancelled')`。 | Mac复核真实native取消映射与共享服务一致：用户取消保持原取消/可重试状态，真正错误仍明确报错；不把取消当下载故障，也不能将所有错误都改成AbortError。保留原侧栏进度、取消及安装约束，与M098、M106–M108、M126对应；不改变生产取消语义。 |
| M141 | Windows专属测试夹具：`windows/test/scripts/login-actions-native-smoke.mjs` 将注册/重置密码placeholder预期改为“输入密码”，等待真实字段下方灰色“不少于8个字符”提示；minlength=8保持，空登录密码错误为“密码不正确”。 | Mac审查并同步本机对应 `macos/test/scripts/login-actions-native-smoke.mjs` 的过期预期，保留真实原生点击、密码长度规则与错误归属覆盖，不能删minlength/灰提示断言或恢复旧占位符提示。Windows未修改Mac树；关联M017–M022。 |
| M142 | Windows专属测试夹具：`windows/test/scripts/interview-effort-smoke.mjs` 的openSettings先等待真实“面试设置”heading，再做count=1及横向设置行几何。 | Mac在共享/本机effort对应场景采用真实挂载屏障，再保留组合入口数量、支持档位、保存锁/焦点及七行几何；不能用固定sleep或删count代替。Windows脚本仅作参考，Mac原生对应文件由Mac审查；关联M027–M037、M082。 |
| M143 | Windows专属测试夹具：`windows/test/scripts/interview-workflow-smoke.mjs` 在首次进入及设备缺失重访时，先等目标heading，再执行原count=0检查。 | Mac审查 `macos/test/scripts/interview-layout-smoke.mjs` 及共享面试workflow消费者的对应场景，保留不存在控件/错误设备语义、流程轮次和窗口尺寸约束；不在旧分类尚未切换时误把count=0当新页面结果。Windows未修改Mac树；关联M073–M076、M082–M084。 |
| M144 | 共享测试夹具：`shared/test/scripts/typography-smoke.mjs` 两套设置分类循环先等各自目标heading，inspect等待viewDirection退出；通用分类count=0也先等待“通用”heading。 | Mac保留全部分类、主题、字号、光标和边界断言，在真正目标页面上取值；不取消动画、不删除零数量检查，不把旧分类尚在快照中当作新DOM审查。关联M014–M015、M051–M054、M073–M076。 |
| M145 | 共享测试夹具：`shared/test/scripts/interview-typography-smoke.mjs` 的openSettings和重访均等待目标heading；About→面试设置必须确认About真实挂载，才能证明预览卸载后重新挂载。 | Mac保留预览重挂载、显示字号/透明度、前置与活动面试及重启场景；快速切换不能跳过中间分类而虚假覆盖生命周期，也不通过删除重访断言适配转场。关联M010–M013、M024–M026、M073–M076、M082。 |
| M146 | 共享测试夹具：`shared/test/scripts/ui-material-refinement-smoke.mjs` 的settle纳入viewDirection；详情scroll真实可见且View Transition结束后再滚动、取材质像素。 | Mac在详情opacity=1后，移除/恢复header材质及隐藏body的每个阶段分别等待真实有限动画稳定，再保留原body像素equals(true)、隐藏body时header像素different、blur24及等高等宽检查。不把快照中间帧差异当材质差异，不放宽像素结果或取消产品动画；补充M131，对应M073–M076。 |
| M147 | 共享测试夹具：`shared/test/scripts/components-ui-smoke.mjs` 的popup可见不等于已展开，visible可能仍处约1.14px高的初帧。 | Mac在可见后再过两次真实requestAnimationFrame，并等待有限subtree animations.finished后取最终popup几何；继续要求完整四边距viewport至少8px且height>40px，保持原边界断言、列表内容和控件流程，不用最小初帧假通过，也不修改生产弹层尺寸/动画。补充M139，对应M038–M045。 |
| M148 | 生产/本机复核：`shared/src/components/cloudAccountPanel.css` 删除≤900px强制单列和按钮28px分支，验证码发送、倒计时及重发按钮始终固定在六格OTP右侧同一行。 | row始终 `minmax(0, 1fr) max-content`，按钮右贴、nowrap、自然宽；前方六格 `repeat(6, minmax(0, 1fr))` 在窄窗收缩，反馈仍在字段下方。`shared/test/scripts/cloud-account-smoke.mjs --login-check` 通过真实注册发送/倒计时与重置发送，覆盖zh/en×浅深×1000×660及860×580，测六格同排同中心、按钮右贴、窄格收缩和反馈下方；resize按实际getContentSize/zoom屏障取值。Mac继续本机真实native五档DPI复核；TSX、键盘粘贴/导航与重发/提交保护未变。本条为M022的最终实现。 |
| M149 | Windows专属测试安全补强：`windows/test/scripts/login-actions-native-smoke.mjs` 在每次真实click前核对固定BrowserWindow ID/HWND与normal层级，聚焦到foreground后再用stableTarget重新测量。 | 命中同时检查WM_NCHITTEST与现有只读probe('hit')的WindowFromPoint归属，点击前再验foreground/no-topmost；C# click guard保持原样，拒绝不自动重试。Mac由本机审查对应 `macos/test/scripts/login-actions-native-smoke.mjs` 的窗口身份、前台归属、真实命中与坐标稳定保护，不照搬Win API、不修改系统辅助功能权限；不将守卫拒绝预先归因于某个外部窗口/授权事件。Windows未修改Mac树，关联M006、M141、M148。 |
| M150 | 共享测试夹具：`shared/test/scripts/continuous-corners.mjs` 的verifyMenuCapsulePixels采用独立固定round/999px参考；不把CSS近边采样点经floor映射后的native边缘像素与纯实心中心直接等值比较。分数DPI相位及输出取整可改变所采覆盖，必须保留真实映射诊断。 | 参考使用inert/aria-hidden/pointer-none的manual-popover，不复制actual clip/curve；在未高亮baseline采相同rect/clip/native输出点，真实hover后再核同rect四项≤1/64px，finally删参考。Mac保留首末×左右全部原点actual/reference差≤28、真实hover强对比及外侧未涂断言；参考每侧至少3个强对比点且外侧未涂，防空参考误过。校验bytes=w×h×4，记录mapping/inset/rect/祖先曲线/动画/DPR诊断；菜单finite/pinned-height完成再双RAF取值。此为像素比较方法修复，仍须检测真实outer clipping，不改产品圆角或放宽阈值；对应M038–M045。 |
| M151 | 共享测试夹具：`shared/test/scripts/interview-ux-smoke.mjs` 的skeleton像素helper等待全局View Transition/有限动画稳定，并在每帧校验相同1/64px rect及dialog opacity=1；增加DPR和最坏采样点BGRA诊断。 | Mac保留0/35/65%三时间相位、outside差≤2、左右两端均有外侧点以及两张差分帧inside真实变亮要求。自然native采样、跨边角落候选、原半径加0.5 CSS安全距离及独立参考筛查采用M154最终方案，不再沿用CDP clip.scale=3。位置/透明度未稳时先报具体几何，像素失败仍失败；不改生产mask、颜色、曲线或差分阈值。补充M090，仍须完整浅深及reduce矩阵。 |
| M152 | 真实清理：`shared/src/styles.css` 删除五个无消费者旧规则块：`.tool-menu-check`、两块 `.model-menu`、`.model-menu-label` 及其 `> span`。旧ChatTools唯一JSX生产者已由本轮组合控件替代，新popup使用固定 `.reasoning-effort-popup`；shared/Windows/Mac前端、动态class、测试与构建消费者审查未发现再注入，测试中的model-menu标签字符串只是capture名称。 | 保留仍消费的model-option/model-check/model-name、message-options附件、composer-menu附件、cloud-code-row/inputs及Mac `.native-window-controls .sidebar::before` 拖动带；不是删除功能、数据或兼容读取。边界见 [清理说明](WORKSPACE_CLEANUP.md)。Mac拉取后重新build再复核既有模型选择/档位、附件菜单与气泡、验证码及原生标题/侧栏拖动，并执行五档web-materials与相关定向入口；不能以旧编译CSS或删除Mac拖动伪元素代验。Windows未修改Mac本机树，关联M003、M005、M027–M045、M130。 |
| M153 | 生产：`shared/src/components/CloudAccountPanel.tsx` 将M133的skip失焦豁免扩到同一panel、form外的注册/找回密码/返回登录导航，避免无效邮箱反馈插入导致导航按钮在按下与松开之间移位、首次click丢失。 | 只有form存在、relatedTarget属于该form父panel，且为 `.login-skip-button` 或form外 `.login-form-links` 后代才豁免；普通字段间blur、提交及验证码发送逻辑不变。`shared/test/scripts/cloud-account-smoke.mjs --login-check` 保留invalid邮箱且无既有alert、预先测按钮中心、每路线一次page.mouse.click、等待目标heading的四路线（登录→注册/找回、注册/重置→返回登录），不用DOMclick/重试/有效邮箱绕过；另用真实Tab到密码确认邮箱错误仍出现。Mac在对应共享及原生登录入口复核；中英按钮为跳过登录/Continue locally、注册/Sign up、找回密码/Forgot password、返回登录/Back to sign in。关联M017–M019、M133、M141、M148–M149。 |
| M154 | 共享测试测量修复：`shared/test/scripts/interview-ux-smoke.mjs` 的assertSkeletonClip使用自然DPR的webContents.capturePage整数DIP clip，移除会改变emulation的CDP clip.scale=3；严格校验输出尺寸ceil(clip×DPR)、bytes=w×h×4及三帧同网格。 | 在同坐标/尺寸四项≤1/64px、脱离祖先clip的inert/aria-hidden/manual-popover上建立独立round/999px黑白参考。outside候选native pixel须与底条矩形有正面积交叠、整个pixel最近圆距离>r+0.5 CSS，且黑白参考该点四通道完全相同（独立参考该点无可见覆盖）；允许圆帽角pixel跨矩形边界以保留低DPR薄条样本，但原0.5 CSS安全距离不撤回。不能只凭不同绘制primitive的reference零覆盖断言实际clip的全部抗锯齿行为已排除。参考内部必须有真实黑白强对比maskInside>0防空参考，左右outside样本仍各>0，outsideDelta≤2及扫光两张差分帧inside真变化全部保留。finally移除参考并恢复原动画；Mac须完整五档、浅深及reduce复核，实际失败保留DPR/网格/rect/BGRA诊断，不以放宽delta或更改产品CSS处理。这是M090/M151的最终测试测量方案，不是产品圆角/扫光样式修改。 |

### Mac 本机接续

| ID | 修改及原因 | 本机复核步骤与影响范围 |
| --- | --- | --- |
| M155 | 生产：`macos/electron/updates/driver.ts` 接入共享 `UpdateCache` 的一小时检查、失败重放、时间回拨、强查与冷却，固定使用 main 所属 `userData/updates`。共享 `cache.ts` 增加可选认证 validator 与独立 completed 元数据，默认 Windows 行为保持。Mac 每次读取重新认证完整签名 envelope，不能从裸 hash 重建可信状态。 | 承接 M099–M105、M111–M114；`update-driver.test.ts`、`update-cache.test.ts` 及本机 `updates-native-smoke.mjs` 的 `update-cache-checks.mjs` 核对新实例缓存、强查、坏缓存/签名、公钥与平台，固定 owner loopback；Windows 默认缓存兼容由共享单测核对，本轮不写 Windows 树。 |
| M156 | 生产：Mac 完整归档持久保留在固定 archives 子目录，恢复先认证签名清单再流式核对大小/SHA512；显式安装继续交给 Sparkle 验归档 Ed25519 签名。下载以 journal、独占 partial、校验及原子 rename 发布，失败清所属普通半成品，退出/取消/超时中断另记冷却；未知路径/链接拒绝删除。dispose 等待任务，已 committed 安装不取消、不删完整包。 | 承接 M102–M108、M115–M120；本机缓存专项覆盖 offline/autoDownload=false 恢复、慢流取消/退出、journal 与冷却，既有 Sparkle 专项保留坏归档签名、取消和安装。`download.ts` 的哈希接受取消信号，创建文件失败取消响应流；`package-smoke.mjs` 等待异步 dispose。恢复阶段不宣称替代 Sparkle 安装验签。Windows 主动取消冷却边界留其本机审查，本轮不写另一平台。 |
| M157 | 生产：`ui/visual-snapshot.ts` 为菜单和弹窗退出快照共用身份清理。原先全删 id 会破坏 Mac SF Symbols 的 mask 引用，收起时图标露出实心矩形；现在仅把 SVG 资源 id 重映射成快照独立值并同步本地 url/href，HTML id/role/name/autofocus 仍移除。 | 影响 M043、M048；`dropdown-motion.ts`、`modal-motion.ts` 复用该 helper。`settings-smoke.mjs` 在浅深主题真实退出中间帧对比图标像素，核对 SVG 引用可解析、无重复 id；`profile-selection-smoke.mjs` 保留即时解锁、inert/aria-hidden 与快照清理，单独允许非交互 SVG 资源 id。五档复核不能用取消动画或保留原 id 绕过。 |
| M158 | Mac 测试适配：`login-actions-native-smoke.mjs` 更新密码旧预期，补 minlength/灰提示、六格同排几何和原窗口/前台/真实命中/稳定坐标守卫；`interview-layout-smoke.mjs` 与 `cloud-accessibility-smoke.mjs` 等真实目标 heading/转场；`cloud-form-lifecycle-smoke.mjs` 的逻辑夹具隔离新增 CSS。 | 承接 M141–M149；单次真实点击不重试，原 AppKit hit 与几何断言保持。生产 CSS 由真实界面矩阵覆盖，不把逻辑夹具的 CSS loader 当视觉验证。 |
| M159 | 共享测试平台适配：`history-branding-smoke.mjs` 在 Mac 捕获固定侧栏按钮的像素而非不存在的自绘 titlebar，原生交通灯继续由 window-native 验；`ui-alignment-smoke.mjs` 严格区分原生收起84px/自绘68px；`typography-smoke.mjs` 精确分类紧凑登录预览空态/思考正文11px。 | 补充 M080：展开仍固定230px，Mac 收起84px保留原生交通灯右侧内距，不恢复旧200px断点。页面边界与中间帧像素容差、其余全局字号均不放宽；五档/浅深/中英复核。 |
| M160 | 共享测试时序：`updates-smoke.mjs` 在真实关于与更新 heading、转场和有限动画完成后，确认窗口可见/聚焦，Mac AppKit 前台归属以及双 RAF 稳定命中，再执行真实长按。补 Space 长按/重复 keydown、释放不追加和实际 Tab 移焦取消。 | 承接 M097、M126；产品5000ms、提前4700ms零请求、触发恰一次强查和释放不追加检查全部保持；短 Enter 仍普通检查，移焦后等待足五秒无强查，不能用 fixture 绕过产品取消语义。 |
| M161 | 测试覆盖：Mac 五档矩阵追加 web-materials、ui-material-refinement、provider-ui、composer、profile-selection、login-entry，保留原30项；`interview-effort-smoke.mjs` 复用既有隔离平台端口移植活动保存专项并纳入 Mac 功能矩阵。 | 保留七行几何、支持档位、拖动释放一次 IPC、保存期间原 DOM/焦点、忙锁、失败回滚与取消；仅平台权限/设备端口合成，不采样硬件。矩阵按实际名称和五档完整执行，不减少原轮次、时长或已有场景。 |
| M162 | Mac 打包夹具：`components-smoke.mjs` 等 AI 服务真实 heading 和转场后再数两个品牌图标，验证图像解码及 ChatGPT/Copilot 的独立连接操作；知识库分支等创建按钮后再查禁用，避免空集合误过。 | 承接 M073–M076、M121、M127；仍使用临时签名应用、真实包内运行时/组件、合成账号与固定公开模型，不依靠旧界面立即挂载，也不放宽原图标数量和未安装功能限制。 |
| M163 | 五档指针夹具：`continuous-corners.mjs` 等独立参考层移除后完成画面提交，先确认中心命中，再实际移动鼠标并检查到采样帧仍为 hover/focus/highlight；`ui-material-refinement-smoke.mjs` 取得原生前台并复测滚动后的真实中心。 | 承接 M038–M045、M123、M150；保留圆头参考、首末两端、实际网格、像素阈值、键盘 focus-visible 与几何。失败输出真实指针事件、命中及焦点，不合成 CSS 高亮。 |
| M164 | `interview-chrome-smoke.mjs` 等透明弹窗入场自然到不透明再触发关闭并采样。原先可能在入场首帧就关闭，正确的退出起点已低于可见中间帧阈值。 | 承接 M046–M049；保留真实中间帧及透明遮罩阈值，并查 inert/aria-hidden、无指针、原生模态解锁与触发按钮焦点恢复。 |
| M165 | `cloud-account-smoke.mjs` 六格验证码按浏览器已解析的分数 grid track 边界逐格验证。外框和每个 fr 轨道可独立量化；按当前有效缩放把 CSS 坐标换算到 1/64 内部布局单位，检查末端余量仅来自轨道舍入。 | 承接 M148；保留所有格与按钮同排同中心、按钮自然宽且贴右、网格与按钮间距、反馈在下及窄窗收缩，不用视觉容差掩盖重叠或错行。 |
| M166 | `settings-smoke.mjs` 先采实际退出帧，再把打开时独立保存的 SVG 放入同一退出图标槽位作为参考；真实图标和参考共用同一原生像素网格，避免跨开合亚像素相位差影响形状判定。 | 补充 M157；图标尺寸、菜单锚点/时序、同 rect/clip/DPR、可见对比和逐通道差≤2 均保留。finally 恢复原快照；不使用产品重映射 helper 制作参考，不把布局测量当图标像素结果。 |

后续修复从 M167 起追加；最终发布输入与资产信息由发行索引承接，不在此保存测试分数、报告、截图、trace或缓存产物。
