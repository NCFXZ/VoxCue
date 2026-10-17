# 面试记录详情、自动标题与品牌图标

> 2026-10-17 测试保留规则已更新：全部既有测试产物按用户授权清理；下文旧 test/results/test-results 路径仅为历史运行记录，不作为当前可用交付物。当前验证见根 PROGRESS.md。

本轮用户要求已实施，2026-10-13（Asia/Shanghai）。

## 界面与数据

- 面试记录列表进入独立详情视图，主体居中展示标题、起止时间、时长、转录数量和逐条转录。左侧时间为距开场的时长，角色为面试官/我；正文可选择复制。
- 顶部提供返回、导出 TXT、AI 回答数量/面板开关及保留二次确认的删除入口。右侧回答栏独立滚动，包含提问、时间、Markdown 正文和真实公开摘要（有才显示）；点击时间线的 AI 回答可打开对应内容，回答栏可定位原问题。空转录/空回答保留明确状态。
- 导出通过受限主窗口 IPC + 原生保存对话框，写出带 UTF-8 BOM 的 TXT，包含全部可见转录/问题/回答及已有公开摘要。取消不会写文件，失败可见。旧 Mock 记录与回答仍隐藏、原始存储保留。

## 自动标题

- 面试明确结束、原始记录保存成功后，向主进程排队提交标题请求；浮窗不等待 AI 完成即可关闭。主窗口常驻订阅在其他页面也保存结果，标题生成不占用/取消准备聊天的请求槽。
- 使用本场确认的账户模型，支持时使用 low；模型不可用不静默替换。任务只使用系统转录与已提交的问题，均匀采样至多 24 条、每条 600 字；不读取麦克风回答、个人资料、知识库或附件，不联网搜索。
- 原始记录先保存默认标题，随后 pending/ready/failed 更新；失败可在详情重试。查看旧记录会为有问题且尚未生成标题的记录排队。无问题时保留“面试记录”。标题请求/结果有长度和单行校验、每记录去重、队列上限与超时；退出登录/退出应用取消任务。
- 晚到归档不覆盖已生成标题；删除后迟到结果不会复活记录。重新打开 pending 详情可重试未完成的任务。

## Logo

用户提供的 Desktop/voxcue_logo.png 原字节复制到 public/voxcue-source.png；不修改原文件。Electron nativeImage 仅进行尺寸/格式转换：512 PNG 与 16/24/32/48/64/128/256 ICO。界面 AppLogo、静态首帧/React 启动等待、登录品牌、标题栏、侧栏、浮窗、favicon 与原生 Windows 窗口均使用新资源；便携包脚本指定新 ICO。ChatGPT 服务图标独立保留。

复现：

```powershell
pnpm exec electron scripts/update-app-icons.cjs C:\Users\fengk\Desktop\voxcue_logo.png
pnpm build
pnpm test:history
```

## 验证与边界

- 12 文件 91 项相关单测通过：标题队列/去重/未知模型/失败/取消/输入输出校验、持久化与迟到结果、关联/歧义/隐私取样/导出、IPC 权限与字段限制、原面试/语音/准备聊天状态。
- typecheck、build、architecture（119 文件、零越层/运行环）通过。Vite 保留已有大 chunk 提示。
- 新桌面检查十组通过，证据 test-results/history-branding-1791876764023/report.json；截图同目录 startup.png、login.png、timeline.png、answer-rail.png、detail-dark.png、detail-narrow.png。包括 120 条转录、居中布局、双向定位、Markdown/空回答、导出及取消、删除默认取消、浮窗关闭后在其他页面完成标题、失败重试、原件 SHA 与 PNG/ICO 尺寸。
- electron、floating、login 原有桌面回归通过。全部桌面验证使用独立目录及合成账户/AI/语音端口，经真实 preload/IPC，不读取真实用户数据、不采集真实音频。

全部工作未提交/推送，保留此前脏工作。Start-VoxCue.cmd 使用最新构建；已打开的应用需重启才加载。
