# VoxCue 1.0.2

更新日期 / Updated: 2026-11-08。

状态：发行说明草案；构建、资产及各渠道发布状态待实际确认。本说明不表示已经发布。 / Status: draft release notes; builds, assets and channel availability remain subject to confirmation. This document does not announce a completed release.

## 简体中文

- 知识库导入仅保留可索引的 PDF、Word（DOC/DOCX）、TXT 和 Markdown，新增旧版 DOC 文字提取，停止导入 PowerPoint 和 Excel。PDF 仍需有可提取文字，不提供 OCR。
- TXT/Markdown 可识别更多常见编码，包括 UTF-16、GB18030/GBK、Big5 及可靠识别的 Windows-1252；编码有歧义时明确提示另存为 UTF-8。
- 导入前一次列出本批不支持的文件，改进忙碌保护、索引失败提示和错误关闭操作；切换知识库或重命名时，提示归属更准确。
- 加强异常 Word 文档的解析限制，并改进索引取消与重试，避免取消后后台任务叠加或迟到结果误显示成功。
- 改进多文件同步状态和运行中编辑的处理，避免旧快照误报已同步及切换账号后出现旧操作错误；同步菜单改为点击展开，操作布局和动画更稳定。
- 自动回答忽略整段纯语气词和简短确认，保留转写及手动发送；正常问题、有效追问和含实际内容的句子照常发送。
- 侧栏 AI 用量在后台刷新时保留上次结果，首次读取后减少反复出现的加载提示；读取失败仍正常显示错误。
- 新对话与历史聊天切换增加仅作用于中间内容的过渡；各聊天在本次窗口运行内记住阅读位置，原在底部时继续跟随新回复。
- 本地组件初次检查使用骨架占位，改进组件提示的居中和下载按钮首次出现时的宽度稳定性。

本版承接 1.0.0 的界面改进；1.0.1 仅为 Windows Microsoft Store 发布者显示名和版本元数据维护。Mac 本机接续、签名和发行须独立完成，详见 [Mac 1.0.2 接续清单](MACOS_1.0.2_HANDOFF.md)。

## English

- Knowledge imports now accept indexable PDF, Word (DOC/DOCX), TXT and Markdown files, with text extraction for legacy DOC files. PowerPoint and Excel imports are removed. PDFs still require extractable text; OCR is not included.
- TXT and Markdown support more common encodings, including UTF-16, GB18030/GBK, Big5 and reliably detected Windows-1252. Ambiguous encodings produce a clear request to save the file as UTF-8.
- Unsupported files are listed together before a batch is imported. Busy handling, indexing errors and dismissible notices are clearer, with better error ownership when switching or renaming knowledge bases.
- Word parsing applies stricter limits to malformed documents. Indexing cancellation and retries handle task cleanup more reliably, preventing cancelled work from accumulating or late results from appearing successful.
- Multi-file sync status and edits made during syncing are more reliable, preventing stale snapshots from reporting completion and old operation errors from appearing after an account switch. Sync menus now open on click, with steadier action layouts and transitions.
- Automatic answers skip messages consisting entirely of approved Chinese fillers or brief acknowledgements. Transcripts and manual sending remain available; questions, follow-ups and meaningful mixed content are sent normally.
- Sidebar AI usage keeps its previous result during background refreshes, reducing repeated loading notices after the first read. Failed reads still display an error.
- Switching between new and saved chats adds a transition within the conversation area. Each chat remembers its reading position for the current window session and continues following replies when it was already at the bottom.
- Local component checks use an initial skeleton view, with better-aligned component notices and steadier initial download-button sizing.

This release builds on the interface changes in 1.0.0. Version 1.0.1 covered only Windows Microsoft Store publisher display-name and version metadata maintenance. Mac validation, signing and release remain separate local steps; see the [Mac 1.0.2 handoff](MACOS_1.0.2_HANDOFF.md).
