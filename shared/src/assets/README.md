# 登录按钮图标

`chatgpt.svg`：来自 https://openai.com/brand/ 官方页面提供的 OpenAI 结形标识，用于 ChatGPT 登录按钮及 ChatGPT 回复的服务标识。图形路径保持原样，以黑白形式展示。OpenAI 与 ChatGPT 标识归 OpenAI 所有；品牌使用说明见 https://openai.com/brand/ 。

`public/voxcue-source.png` 为用户提供的 VoxCue Logo 原文件，保持图形与颜色。`voxcue.png`（512px）及多尺寸 `voxcue.ico` 由 `shared/scripts/update-app-icons.cjs` 转换生成，用于应用、网页标签与 Windows 窗口。

`copilot.svg`：来自 GitHub 官方 Primer Octicons 的 [copilot-24](https://github.com/primer/octicons/blob/main/icons/copilot-24.svg)，按其 [MIT 许可](https://github.com/primer/octicons/blob/main/LICENSE)使用，用于 GitHub Copilot 登录及回复标识。

本应用自身的名称与图标保持独立，不表示 OpenAI 或 GitHub 的官方应用或背书。

更新图标：`pnpm exec electron shared/scripts/update-app-icons.cjs <原图绝对路径>`，保留原图并生成 16/24/32/48/64/128/256 像素 ICO。ChatGPT 的服务图标保持独立。

`shared/src/assets/voxcue.png` 与 public 的 512px PNG 字节相同，由同一脚本生成。AppLogo 通过 Vite 导入此资源，构建文件名带内容指纹；所有界面保留图片自身的透明圆角，不再用 CSS 强制裁成圆形或补白色背景。
