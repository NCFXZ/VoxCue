# VoxCue 1.0.0 · Windows

发布状态：Windows 已在 GitHub 发布；Microsoft Store 提交 3 已上架。 / Status: Windows released on GitHub; Microsoft Store submission 3 is live.

## 简体中文

- **额度提示更整齐。** 侧栏额度提示与邮箱文字左对齐，头像与右侧整块文字垂直居中。
- **单周期显示更简洁。** 仅返回五小时或周额度时，始终一行显示“ChatGPT 剩余 N%”；低于 20% 时仅百分比标黄。同时有两个周期时，任一低于 20% 后仍同时显示两个周期，各自标黄低额度；20% 保持正常样式。
- **网页活动来源更清晰。** 读取网页和查找网页内容的活动记录使用带网站图标的域名胶囊，文字与图标随活动行字号适配；网站图标不可用时保留通用图标。
- **链接反馈更明确。** 可用超链接和来源胶囊显示手形光标，悬停与键盘聚焦时提供清晰的文字、背景或焦点轮廓反馈，兼顾浅深主题。
- **适配 Microsoft Store 更新。** 商店安装版由 Microsoft Store 更新，并在更新页明确说明；独立 Windows 安装版继续使用原有应用内更新渠道。商店任务栏使用适配不同尺寸及浅深主题的透明图标。

Windows 首次安装或手动升级使用 `VoxCue-Setup-1.0.0-x64.exe`；`.blockmap` 和 `latest.yml` 用于应用内更新。Mac 1.0.0 留待本机逐项验收和打包，当前 Mac 正式版保持 0.6.9。

## English

- **Better-aligned quota notices.** Sidebar usage notices align with the email text, and the avatar is vertically centered beside the complete text block.
- **Simpler single-period summaries.** When only a five-hour or weekly quota is returned, it stays on one line. Below 20%, only the percentage is highlighted. When both periods are available, either falling below 20% continues to show both periods with their individual low values highlighted. Exactly 20% retains the normal appearance.
- **Clearer sources in web activity.** Page-reading and page-search activity uses domain pills with site icons. Text and icons scale with the activity row, with a generic icon retained when a site icon is unavailable.
- **Clearer link feedback.** Available hyperlinks and source pills use a hand pointer, with visible text, background or focus-outline feedback on hover and keyboard focus in light and dark themes.
- **Microsoft Store update support.** Store installations receive updates through Microsoft Store, with a clear explanation on the updates page. Standalone Windows installations retain their existing in-app update channel. Store taskbar icons use transparent artwork for different sizes and light or dark themes.

For a first Windows installation or a manual upgrade, use `VoxCue-Setup-1.0.0-x64.exe`. The `.blockmap` and `latest.yml` files support in-app updates. Mac 1.0.0 requires separate local validation and packaging; the current Mac release remains 0.6.9.
