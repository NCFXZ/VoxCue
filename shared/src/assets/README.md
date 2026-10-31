# 界面素材

`interview-story-path.jpg`与`interview-story-notebook.jpg`：2026-10-31使用内置imagegen生成，1024×1536，JPEG质量85；分别用于深色书屋段落的左侧插画与彩色手帐段落的右侧插画，随应用离线打包。生成提示词：

> Create one full-bleed portrait editorial illustration, aspect ratio 2:3, no text. A quiet path beside an alpine lake in the late afternoon, pine trees opening toward a small warm wooden bookshop cabin, a single traveler seen from behind walking along the path with a small notebook. The lake and pale distant mountains subtly connect this scene with a tranquil mountain-lake photograph. Warm hand-painted gouache on softly textured paper, clean elegant shapes, rich deep pine green, warm ochre sunlight, cream highlights, muted blue water. Atmospheric but detailed enough to see leaves, wooden planks and a small window glowing in the cabin. Composition fills the whole image; no border, no lettering, no logo, no captions, no UI. Intended as a vertical illustration on the left half of a story section behind translucent desktop panels.

> Create one full-bleed portrait editorial illustration, aspect ratio 2:3, no text. A quiet wooden cabin reading corner at blue hour beside an alpine lake: an open blank sketchbook with a small loose landscape sketch, a ceramic tea cup and a softly glowing amber desk lamp on a wooden desk, a broad window overlooking dark pine trees, calm blue water, distant pale mountains and the first stars. No visible person. Warm hand-painted gouache on softly textured paper, clean elegant shapes, rich deep pine green, warm ochre lamplight, cream highlights, muted blue water and deep blue evening. Atmospheric and coherent as the next chapter of a traveler finding a lakeside cabin after an afternoon walk. Composition fills the whole image; no border, no lettering, no logos, no captions, no UI. Intended as a vertical illustration on the right half of a story section behind translucent desktop panels.

`interview-landscape.jpg`：2026-10-31使用内置imagegen生成的山林湖泊背景，1536×1024，JPEG质量85；随应用离线打包，仅用于设置中的透明度预览。生成提示词：

> Generate a photorealistic natural landscape photograph used as a local desktop wallpaper underneath a translucent interview preview in a desktop app. A wide alpine lake with clear teal water, dark green conifer forests along both shores, sunlit pale granite mountains, soft blue sky with a few natural clouds, realistic daylight and fine natural textures. Balanced tonal variety from bright sky to dark forest and water reflections, so transparency can be evaluated across both light and dark areas. Full bleed edge to edge landscape composition, 3:2 aspect ratio. No words, letters, logos, UI, borders, people, buildings or watermarks. This is only the scenic background asset, do not draw an application window.

`copilot.svg`：恢复自本项目历史，使用 GitHub 官方 Primer Octicons 的 [copilot-24](https://github.com/primer/octicons/blob/main/icons/copilot-24.svg)，遵循其 [MIT 许可](https://github.com/primer/octicons/blob/main/LICENSE)，用于 Copilot 登录与回复来源标识。

`chatgpt.svg`：来自 https://openai.com/brand/ 官方页面提供的 OpenAI 结形标识，用于 ChatGPT 登录按钮及 ChatGPT 回复的服务标识。图形路径保持原样，以黑白形式展示。OpenAI 与 ChatGPT 标识归 OpenAI 所有；品牌使用说明见 https://openai.com/brand/ 。

`public/voxcue-source.png` 为用户提供的 VoxCue Logo 原文件，保持图形与颜色。`voxcue.png`（512px）及多尺寸 `voxcue.ico` 由 `shared/scripts/update-app-icons.cjs` 转换生成，用于应用、网页标签与 Windows 窗口。

本应用自身的名称与图标保持独立，不表示 OpenAI 或 GitHub 的官方应用或背书。

更新图标：`pnpm exec electron shared/scripts/update-app-icons.cjs <原图绝对路径>`，保留原图并生成 16/24/32/48/64/128/256 像素 ICO。ChatGPT 的服务图标保持独立。

`shared/src/assets/voxcue.png` 与 public 的 512px PNG 字节相同，由同一脚本生成。AppLogo 通过 Vite 导入此资源，构建文件名带内容指纹；所有界面保留图片自身的透明圆角，不再用 CSS 强制裁成圆形或补白色背景。

2026-10-19：用户最后提供的新PNG替换Logo源，原字节保留于`shared/public/voxcue-source.png`（SHA256 `00dad880a587b123f225be5978eac719591025d128f30bdb9b39b460000da0ef`）。界面、Windows ICO与Mac PNG/ICNS均从此源派生；本轮用户明确允许在Mac同步Windows ICO。主侧栏Logo为24px，其他使用处维持各自尺寸。Mac使用`pnpm build:icons`，仅缩放并保留新原图的圆角和透明通道及平台外留白；不再叠加前一版自绘圆角或白色底板。

`github.svg`：GitHub官方Primer Octicons的[mark-github-16](https://github.com/primer/octicons/blob/main/icons/mark-github-16.svg)，遵循其[MIT许可](https://github.com/primer/octicons/blob/main/LICENSE)。用于关于页链接至项目公开问题反馈页面，保留原图形，浅深色以黑白展示。
