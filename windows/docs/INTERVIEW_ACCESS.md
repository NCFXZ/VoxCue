# 面试权限预检与正式界面清理

> 2026-10-17 测试保留规则已更新：全部既有测试产物按用户授权清理；下文旧 test/results/test-results 路径仅为历史运行记录，不作为当前可用交付物。当前验证见根 PROGRESS.md。

## 行为与实现

开始面试打开确认弹窗后，先检查本场配置中的音频来源。检查中及任何失败状态下“确认开始”禁用，展示具体原因、重新检查入口；麦克风权限被拒绝时可主动打开 Windows 麦克风隐私设置。该按钮只打开固定的系统设置 URI，不代替用户改变权限。确认开始时主进程再次独立检查，直接调用打开面试 IPC 也不能绕过。

| 使用项                   | 检查                                                                                              | 未通过行为                               |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 麦克风已启用             | Windows `getMediaAccessStatus('microphone')` 必须为 granted；所选/默认设备存在；WASAPI 初始化可用 | 阻止开始，不静默禁用或切换设备           |
| 麦克风明确禁用           | 不查询麦克风权限、不初始化麦克风                                                                  | 继续检查系统音频                         |
| 系统音频                 | 所选/默认播放设备存在，WASAPI 回环流可初始化                                                      | 阻止开始，提示设备、访问拒绝或初始化失败 |
| 状态未知、读取失败、超时 | 不能确认可用                                                                                      | 阻止开始，允许重新检查                   |

Windows 没有与 macOS 屏幕权限相同的系统音频授权判断。本项目使用真实 WASAPI 回环初始化检查，不把 Windows 总是 granted 的 screen 状态当作系统音频可用证据。参考 [Electron systemPreferences](https://www.electronjs.org/docs/latest/api/system-preferences) 和 [Microsoft WASAPI loopback](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)。只检查本功能需要的音频，不申请摄像头或额外屏幕权限。

新增 `electron/backend/speech/access.ts` 策略与有限 IPC；类型在 contracts 中共享，preload 仍无运行时本地 require。原生助手新增 `check`，复用当前采集格式与初始化路径，在 `Start` 和任何音频缓冲读取之前返回并释放 COM 对象。每次助手有五秒超时/输出上限，检查不启动转写、不保存/上传音频、不加载 ASR 模型。

正式登录页删除“体验 Mock 界面”以及模拟说明。设置、回答风格、输入工具、侧栏、开始确认、浮窗与记录页删除 Mock 文案和测试选项，启动时模型目录为空，等待账户真实目录。旧 Mock 面试记录从界面过滤；真实记录中的旧 Mock 回答也隐藏且不计入数量。原始记录仍保留在存储中，没有批量删除或迁移真实用户资料。

## 验证与范围

- build/typecheck/architecture 通过，113 文件，零越层和运行环；现有 Vite 大 chunk 提示仍存在。
- 相关十文件 80 单测通过，新增权限策略 11 项：允许/拒绝/受限/未知、禁用、设备失效、无默认设备、WASAPI 拒绝与失败、平台/枚举失败、输入校验。preload 新增两个方法纳入完整白名单与编译期检查。
- `test:interview:access` 七组桌面检查通过：检查期间禁止开始、权限拒绝阻止 UI/直接 IPC、确认时权限改变仍阻止、缺设备不降级、禁用麦克风可开始、页面无 Mock、旧记录隐藏但存储保留。最新截图与结果 `test-results/interview-access-1791874582322/`。
- `test:login:entry` 三组通过：登录页面没有测试入口；无测试环境变量时演示 IPC 被拒绝且仍为未登录，未创建主窗口。使用隔离目录拦截与空认证端口，没有读取真实凭据。
- `test:interview:access:native` 本机真实 Windows 检查通过：权限为 granted，默认系统/麦克风均可初始化并释放；仅系统检查通过，指定不存在的设备被拒绝。结果 `test-results/interview-access-native-1791873845644/result.json`。无音频采样。
- workflow 十四组、floating、composer、login 与 ui:alignment 十组通过；其他最终相关回归及目录以 PROGRESS.md 最新条目为准。

失败过程已修复：preload 白名单测试最初未列出新增方法；无界面 Electron 诊断最初错误地设置 ELECTRON_RUN_AS_NODE 和直接使用 require；旧 UI 测试直接进入内部状态时抢在登录窗口 ready-to-show 前创建主窗口；旧记录断言仍要求展示 Mock。均属于测试适配，权限拒绝策略没有放宽。另一次 effort 测试与构建写入并行，已改为构建完成后串行运行。

没有实际关闭用户 Windows 麦克风开关；拒绝、设备热变化由可注入的合成端口验证。未进行真实账户推理、真人准确率、全部设备或新安装包验收。全部既有工作保留，未提交/推送。
