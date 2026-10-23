# 共用布局与平台控件（0.5.8）

两平台共用页面布局、业务和交互语义，允许使用不同控件、图标和材质。不得把 Mac 页面复制为第二套 React 页面，也不得要求 Windows 模拟 AppKit。

| 位置                                 | 放什么                                                                                  | 不放什么                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| `shared/src/components/`             | 页面结构、间距、表单内容、按钮行为、状态展示、无障碍语义                                | AppKit 调用、Mac 玻璃、平台原生视图生命周期 |
| `shared/src/platform/controls.ts`    | 控件与表面插槽的纯 TypeScript 展示契约                                                  | 任何平台实现或运行时平台探测                |
| `shared/src/components/ui/`          | 共用控件行为及网页回退组件；Windows 当前使用该实现                                      | Liquid Glass 仿制或 Mac 原生几何同步        |
| `shared/src/platform/materials.ts`   | 材质初始化端口，默认接入Windows网页材质                                               | 原生调用或平台探测                          |
| `shared/src/platform/webMaterials.*` | Windows的胶囊、圆形及页面内毛玻璃；共享几何驱动顶部渐显                               | AppKit 材质或原生交互仿制                   |
| `shared/src/styles.css`              | 共用布局、尺寸、圆角语义、网页回退、按窗口能力预留的布局空间                            | Mac 原生材质、高亮、投影透明标记            |
| `shared/src/stores/`、`services/`    | 数据、请求、持久化、取消和状态生命周期                                                  | 原生控件或平台页面副本                      |
| `shared/electron/contracts/`         | 有界显示端口、IPC 参数与事件的唯一公开契约                                              | Objective-C、原生资源路径、任意命令         |
| `shared/electron/`                   | 业务、IPC 校验、窗口和服务装配                                                          | 直接调用 AppKit 或静态导入两平台实现        |
| `shared/vite.config.mjs`             | 公共构建及只加载当前平台的扩展入口                                                      | Mac 控件替换清单、SF Symbols 构建细节       |
| `macos/renderer.config.mjs`          | Mac控件、图标、材质初始化替换端口及打包边界检查                                        | 页面布局和业务分支                          |
| `macos/src/`                         | 原生控件展示适配、材质/投影几何、Mac 样式、焦点与滚动同步                               | 聊天/设置/记录页面、业务状态副本            |
| `macos/native/`                      | AppKit 公开 API：NSGlassEffectView、NSButton、NSSwitch、NSSlider、NSMenu、NSSearchField | 共享业务逻辑或手绘系统控件                  |
| `macos/electron/`                    | Mac 原生承载与资源、音频、权限、凭据、更新适配                                          | 跨平台页面布局                              |
| `windows/`                           | Windows 平台适配、原生工具、依赖/输出；Mac 本机保持只读                                 | Mac 材质/组件                               |

## 现行端口

`MaterialButton` 的 sidebar/profile/start 三个固定动作保留共享按钮内容和行为，Mac提供原生按钮；`MaterialSurface` 的composer/follow只承载既有React子树，Mac管理原生材质与投影，Windows直接渲染子内容。纯props位于`shared/src/platform/controls.ts`。`platform/materials`初始化端口由Mac替换为`NativeMaterials`，Windows默认调用原有webMaterials；Mac不打包网页材质模块及其CSS。

0.5.8移除全部主/面试透明度设置行，`frostedAppearance`与`interviewAppearance`固定原60%曲线且不读写旧透明度偏好；实际面试及两个只读预览固定深色，主窗口主题仍独立。Mac最新仅支持macOS 26+，必须有有效Liquid Glass绑定；旧系统、旧开关偏好及转入网页材质的分支已删除。无障碍外观由AppKit及仍在shared中的通用语义/样式处理，不另建旧Mac界面。更新自动下载的原生NSSwitch保留。

网页按钮和复合控件继续提供操作/键盘/无障碍语义。Mac content-controls 在对应插槽显示原生控件，按实际承载区分 content area 与 over-glass；独立指定的顶部 Glass 按钮维持原生 Glass bezel。复制、耗时、导航行及输入区复合动作按已确认交互保留，不把复合布局整体替换为单个系统按钮。

Mac原生展示层承担主设置/知识库40%黑色压暗并覆盖独立前景投影，不绘制旧光晕；网页backdrop仅在原生承载实际启用时透明，Windows保留原shared遮罩。面试设置的`modal-exclusion`只传递模态轮廓用于材质裁切，不创建展示表面。记录详情使用同一ScrollChrome及共享headerCoverage，允许空标题几何；材质范围由共享实际工具栏高度限定。

构建只加载本平台`renderer.config.mjs`。Mac构建拒绝Fluent图标、Windows实现、被替换的共享展示端口和webMaterials模块/CSS进入bundle。架构检查拒绝shared静态依赖平台、平台之间互相依赖、Renderer调用原生基础设施及生产依赖测试。SF Symbols、AppKit和Liquid Glass仅在macos；页面及业务仍只有shared一份。

## Windows网页材质

普通按钮及下拉触发框为胶囊，单图标为圆形；展开的结束确认使用104×32px胶囊，不保留圆形图标类型。下拉面板及顶部/输入区等表面使用页面内毛玻璃。主输入框保留40px连续轮廓、780px最大宽度和悬浮位置，返回按钮共用输入材质并提供悬停反馈；聊天及记录详情没有内容滚入顶部时背景透明，内容滚入后只在工具栏范围虚化。主设置/知识库弹窗40%黑色压暗且无光晕；面试浮窗设置保持透明背景遮罩、无压暗/虚化/光晕，仍有模态阻止背景操作。透明度固定60%，减少透明度、高对比及强制颜色仍回退不透明。

共同样式与行为均在shared；Windows专属系统承载不复制Mac AppKit。Windows使用的这些文件、控件及无障碍样式必须保留；删除的是Mac旧系统入口和专属兼容分支。Mac回退预览及其构建脚本、输出已删除。通用shared测试宿主可使用网页材质核对Windows共用业务，不能作为Mac产品外观验收。

## 维护与本机验证

在当前平台执行 `pnpm sync:workspace`、`pnpm check:workspace`、`pnpm check:architecture`、`pnpm typecheck`、`pnpm build` 和 `pnpm test`。配置同步、格式化和构建只写本平台。Mac 的原生/材质/菜单/投影验证在 `macos/test/`，共有业务和布局检查在 `shared/test/`；Windows 的原生行为及 DPI 仍须在 Windows 本机执行。

版本唯一源为`shared/package.json`，本轮保持0.5.8；各平台本机同步配置，另一平台目录只读，依赖与锁不变。Mac最低系统声明为26.0，固定运行时/凭据助手保留原有字节和构建基线，历史清单签名兼容不属于旧系统界面回退。本轮不发布安装包或替换真实安装，既有发行资产保持。Windows本机验收不能替代Mac原生验收。
