# 共用布局与平台控件（0.5.8）

两平台共用页面布局、业务和交互语义，允许使用不同控件、图标和材质。不得把 Mac 页面复制为第二套 React 页面，也不得要求 Windows 模拟 AppKit。

| 位置                                 | 放什么                                                                                  | 不放什么                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| `shared/src/components/`             | 页面结构、间距、表单内容、按钮行为、状态展示、无障碍语义                                | AppKit 调用、Mac 玻璃、平台原生视图生命周期 |
| `shared/src/platform/controls.ts`    | 控件与表面插槽的纯 TypeScript 展示契约                                                  | 任何平台实现或运行时平台探测                |
| `shared/src/components/ui/`          | 共用控件行为及网页回退组件；Windows 当前使用该实现                                      | Liquid Glass 仿制或 Mac 原生几何同步        |
| `shared/src/platform/webMaterials.*` | Windows / 旧 macOS 的胶囊、圆形及页面内毛玻璃回退；共享几何驱动顶部渐显                 | AppKit 材质或原生交互仿制                   |
| `shared/src/styles.css`              | 共用布局、尺寸、圆角语义、网页回退、按窗口能力预留的布局空间                            | Mac 原生材质、高亮、投影透明标记            |
| `shared/src/stores/`、`services/`    | 数据、请求、持久化、取消和状态生命周期                                                  | 原生控件或平台页面副本                      |
| `shared/electron/contracts/`         | 有界显示端口、IPC 参数与事件的唯一公开契约                                              | Objective-C、原生资源路径、任意命令         |
| `shared/electron/`                   | 业务、IPC 校验、窗口和服务装配                                                          | 直接调用 AppKit 或静态导入两平台实现        |
| `shared/vite.config.mjs`             | 公共构建及只加载当前平台的扩展入口                                                      | Mac 控件替换清单、SF Symbols 构建细节       |
| `macos/renderer.config.mjs`          | Mac renderer 入口、三个控件/图标替换端口、打包边界检查                                  | 页面布局和业务分支                          |
| `macos/src/`                         | 原生控件展示适配、材质/投影几何、Mac 样式、焦点与滚动同步                               | 聊天/设置/记录页面、业务状态副本            |
| `macos/native/`                      | AppKit 公开 API：NSGlassEffectView、NSButton、NSSwitch、NSSlider、NSMenu、NSSearchField | 共享业务逻辑或手绘系统控件                  |
| `macos/electron/`                    | Mac 原生承载与资源、音频、权限、凭据、更新适配                                          | 跨平台页面布局                              |
| `windows/`                           | Windows 平台适配、原生工具、依赖/输出；Mac 本机保持只读                                 | Mac 材质/组件                               |

## 现行端口

`MaterialButton` 的 sidebar/profile/start 三个固定动作保留共享按钮内容和行为，Mac 提供原生按钮；`MaterialSurface` 的 composer/follow 只承载既有 React 子树，Mac 管理原生材质与投影，网页回退直接渲染子内容。纯 props 位于 `shared/src/platform/controls.ts`，平台实现不依赖回退组件类型。

0.5.8本轮最终规格移除全部主/面试透明度设置行，`frostedAppearance`与`interviewAppearance`固定原60%曲线且不读写旧透明度偏好；`appearance-control`只保留共用的面试深色策略，实际面试及两个只读预览固定深色，主窗口主题仍独立。Mac以公开系统可用性检查宣告Liquid Glass能力；旧系统不启动原生材质观察器或独立输入投影。Mac已有Liquid Glass布尔偏好读取与辅助功能回退继续由Mac专属适配管理，不能把已删除滑杆恢复成另一套设置。更新自动下载的原生NSSwitch属于现用content-controls端口。

网页按钮和复合控件继续提供操作/键盘/无障碍语义。Mac content-controls 在对应插槽显示原生控件，按实际承载区分 content area 与 over-glass；独立指定的顶部 Glass 按钮维持原生 Glass bezel。复制、耗时、导航行及输入区复合动作按已确认交互保留，不把复合布局整体替换为单个系统按钮。

构建只加载本平台 `renderer.config.mjs`（不存在时使用共享网页回退）。Mac 构建拒绝 Fluent 图标、被替换的按钮/表面回退端口和 Windows 实现进入 bundle；能力策略与毛玻璃样式保留 shared 唯一实现。架构检查拒绝 shared 静态依赖平台、两平台相互依赖、平台控件依赖回退端口、Renderer 调用原生基础设施及生产依赖测试。

## 非 Liquid Glass 回退

普通按钮及下拉触发框为胶囊，单图标为圆形；展开的结束确认使用104×32px胶囊，不保留圆形图标类型。下拉面板及顶部/输入区等表面使用页面内毛玻璃。主输入框保留40px连续轮廓、780px最大宽度和悬浮位置，返回按钮共用输入材质并提供悬停反馈；聊天及记录详情没有内容滚入顶部时背景透明，内容滚入后只在工具栏范围虚化。主设置/知识库弹窗40%黑色压暗且无光晕；面试浮窗设置保持透明背景遮罩、无压暗/虚化/光晕，仍有模态阻止背景操作。透明度固定60%，减少透明度、高对比及强制颜色仍回退不透明。

共同样式与行为均在 shared；Windows 专属系统承载不复制 Mac AppKit。旧 macOS 可用同一 Mac 构建在缺少原生能力时渲染这份回退，不依赖另建页面。能力模拟可检查布局和回退分支，不能代替旧 macOS / Windows 真机原生验收。

## 维护与本机验证

在当前平台执行 `pnpm sync:workspace`、`pnpm check:workspace`、`pnpm check:architecture`、`pnpm typecheck`、`pnpm build` 和 `pnpm test`。配置同步、格式化和构建只写本平台。Mac 的原生/材质/菜单/投影验证在 `macos/test/`，共有业务和布局检查在 `shared/test/`；Windows 的原生行为及 DPI 仍须在 Windows 本机执行。

版本唯一源为`shared/package.json`，本轮保持0.5.8；各平台在本机执行`pnpm sync:workspace`更新自己的生成配置，另一平台目录只读，依赖与锁不变。源码同步不包含安装包发布或真实安装替换。逐条最新要求及Mac本机待办见[MACOS_0.5.8_HANDOFF.md](MACOS_0.5.8_HANDOFF.md)，Windows实际检查不能替代Liquid Glass或旧macOS真机验收。
