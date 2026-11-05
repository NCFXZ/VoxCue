# VoxCue 0.6.9 · Windows

发布状态：待发行 / Status: pending release。

## 简体中文

本次更新面向 Windows x64，改进登录、面试准备、模型选择和界面操作体验。macOS 0.6.9 将另行提供。

- **界面更统一。** 滚动条采用圆头胶囊并保持原宽；面试输入框、气泡和预览的圆角协调一致。菜单的圆角、内距和选中高亮统一，弹窗标题、关闭按钮和内容间距更整齐。
- **登录反馈更清楚。** 输入框聚焦时呈现轻微浮起效果；密码长度提示使用灰色，邮箱、密码和验证码错误使用红色，并紧跟对应输入框。邮箱验证码改为六个数字格，支持自动前进、粘贴与键盘操作；发送及重发按钮始终位于六格右侧，窄窗口也保持同一行。
- **登录演示自动播放。** 右侧演示依次展示转写、思考和回答，无需操作；播放一遍后停留在最终回答，比例适配登录界面。
- **模型与思考强度合为一个入口。** 准备聊天和面试设置可在同一弹层选择模型及其支持的思考档位。滑块拖动更连贯，松开后确认档位；活动面试保存设置时保持面板与焦点，减少操作中断。
- **过渡更自然。** 页面、设置分类、面试记录、菜单和弹窗的切换更平滑；侧栏选中条跟随所选标签，进入无选中条的状态时淡出。技能选择中的勾和半选横线也有清晰的选中、取消动画。启用系统“减少动态效果”时使用静态切换。
- **聊天内容更易阅读。** 底部按钮尺寸与留白统一，页面提示和错误移到输入框上方。用户消息移除重复的模型信息，长消息可展开或收起，复制始终保留全文；消息旁显示时间或日期。正文选择使用文本光标和中性灰色高亮。
- **引用来源更紧凑。** 域名引用与来源列表使用带网站图标的胶囊，更多来源展开和收起更平滑；普通链接和复制的原文保持。
- **设置与状态信息更整齐。** 面试设置采用对齐的标签和控件列，同步状态、提示及按钮位置更紧凑。开始面试的权限检查在等待时保留布局空间，重新检查不再残留上一次音频测试的错误。
- **知识库进度更准确。** 向量处理显示实际进度，随后明确提示“正在写入索引…”，避免接近完成时看起来又回到零。
- **Windows 更新更连贯。** 启动和普通检查在一小时内复用上次检查结果，检查失败也不会反复联网。已下载完整的更新包在重启后重新验证并保留待安装状态，无需重复下载；退出中断下载后清理未完成内容，并暂停自动下载一小时，期间仍可手动下载。安装仍需明确确认。
- **修复操作细节。** 修复邮箱格式未正确时首次点击“跳过登录”“注册”“找回密码”或“返回登录”可能无响应；字段间的正常校验保持。修复截图缩略图光标显示不正确，以及菜单边缘裁切、快速切换焦点、侧栏首次选中定位和删除面试记录时的页面闪动等问题。

## English

This update is for Windows x64 and improves sign-in, interview preparation, model selection and everyday navigation. macOS 0.6.9 will be available separately.

- **More consistent visuals.** Scrollbars have rounded capsule ends while retaining their width. Interview inputs, message bubbles and previews use coordinated corners. Menus share consistent corners, spacing and selection highlights, while dialog headings, close buttons and content are better aligned.
- **Clearer sign-in feedback.** Focused inputs have a subtle raised appearance. Password-length guidance appears in gray, while email, password and verification-code errors appear in red directly below the relevant field. Email codes use six digit boxes with automatic advance, paste and keyboard support. The send and resend button stays to their right on the same row, even in narrow windows.
- **An automatic sign-in demo.** The preview shows transcription, thinking and an answer without interaction. It plays once, holds the final answer and fits the sign-in layout.
- **One control for model and reasoning effort.** Preparation chat and interview settings let you choose a model and its supported reasoning levels in the same panel. Dragging is continuous, with the level confirmed on release. Saving during an interview keeps the panel and focus in place.
- **Smoother transitions.** Pages, settings categories, interview records, menus and dialogs transition more smoothly. The sidebar selection marker moves between selected items and fades out when no marker applies. Skill checkmarks and mixed-selection marks animate when selected or cleared. The system's reduced-motion preference switches these effects to static updates.
- **Easier-to-read chat.** Composer buttons and spacing are aligned, with page notices and errors above the input. User messages no longer repeat model details. Long messages can be expanded or collapsed, while copying always includes the full text. Messages show a time or date, and selectable text uses a text cursor with neutral gray highlighting.
- **More compact sources.** Domain citations and source lists use capsules with website icons. Additional sources expand and collapse smoothly, while ordinary links and copied text retain their content.
- **Better-aligned settings and status information.** Interview labels and controls share consistent columns, and sync messages sit neatly beside their actions. Interview permission checks reserve space while loading, and rechecking clears errors from the previous audio test.
- **Clearer knowledge-base progress.** Embedding shows its actual progress, followed by a distinct “Writing index…” stage, avoiding the appearance of progress restarting near completion.
- **A more reliable Windows update flow.** Startup and ordinary checks reuse the previous result for one hour, including failed checks, to avoid repeated network requests. Fully downloaded updates are verified again and remain ready to install after restarting, without another download. Exiting during a download clears unfinished content and pauses automatic downloading for one hour; manual downloading remains available. Installation still requires confirmation.
- **Interaction fixes.** Fixed an unresponsive first click on “Continue locally”, “Sign up”, “Forgot password” or “Back to sign in” after an invalid email, while preserving normal field validation. Also fixed incorrect screenshot-thumbnail cursors, clipped menu edges, focus issues during rapid switching, initial sidebar marker placement and a page flash when deleting an interview record.
