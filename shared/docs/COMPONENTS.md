# 本地组件下载与缓存

当前只保留 ChatGPT 登录；GitHub Copilot 登录、IPC、后台服务、运行时清单和 SDK 依赖已从 shared/macOS/Windows 移除，不再读取旧服务选择。旧凭据、历史及存储键内容保留；仅应用数据根目录按用户授权统一迁为 VoxCue。公开 copilot-runtime-v1.0.21 发行、六个附件和对应标签已按用户授权删除；模型和其他应用发行保留。

语音和 RAG 模型独立于应用版本维护。shared/electron/backend/components 使用源码固定的资源目录、ZIP 大小、SHA-256 和逐文件清单，下载源为公开 NCFXZ/VoxCue-releases 的 models-v1.0.0。Renderer 只请求状态、下载固定模型或取消，不提供 URL、路径、摘要、权限或命令。

模型缓存在 VoxCue 应用数据目录下的 component-cache。macOS 根为 ~/Library/Application Support/VoxCue，Windows 为 %APPDATA%/VoxCue；旧 ai-interview-copilot 根在 session 创建前整体原子重命名，成功后旧路径消失，资料、凭据、历史和模型缓存一同保留。两处有内容或旧进程占用时停止，不覆盖或合并。目录由模型 ID、资源版本和 ZIP 摘要确定，不含应用版本，因此升级后可复用。启动检查文件大小、摘要和执行权限，缺失、损坏、链接或额外内容不算就绪。

下载集中在“设置 → 本地组件”，主界面显示未就绪模型的合并提示；知识库、个人信息等位置只提供打开该设置分类的快捷入口。无需先下载模型即可登录 ChatGPT 和准备聊天。

缺失提示采用原有长条卡片和多行标题/说明。准备页提示放在聊天列内，与下方聊天/输入区域共享可用宽度；个人信息展开时仍显示，随聊天列一起收窄并在该列居中，不横跨个人信息面板。窄窗口也为个人信息面板预留宽度，避免覆盖提示和设置入口。知识库与个人信息中的模型提示沿用同样的长条样式。界面源码两平台共用，Mac 不写 Windows 专属目录。

设置内模型和应用更新下载时，原按钮先显示主题色圆环及旁边的百分比至少一秒，再允许悬停或键盘聚焦显示带平台关闭图标的红色“取消”；侧栏更新按钮仅显示圆环或红色取消图标，所有状态固定 32×32，不显示百分比与文字。首秒不响应取消点击，避免鼠标停在原按钮上立即遮住进度。进度与取消切换时按钮尺寸保持，设置操作状态导致的不同长度平滑过渡，不额外占用进度条或取消操作行。一个模型下载/校验时，其他尚未开始的模型按钮继续显示“下载”并暂时禁用，取消或完成后恢复。容量使用十进制 MB。校验阶段显示不定进度圆环与状态，系统减少动态效果时停止旋转和过渡。个人信息展开/收起时面板及聊天列同步调整宽度，模型提示继续在聊天列内居中；关闭面板不可键盘聚焦。界面、设置分类、字体和状态均在 shared 共用，平台图标保持各自实现，不新增蓝色焦点外圈。

下载有体积、摘要及超时限制；认证归档按精确文件列表解包，拒绝路径穿越、链接、重复/额外条目或内容不符，校验后原子发布。取消和失败清理暂存，保留其他已就绪模型；重试只下载缺失模型。遗留清理只处理带本工具标记且进程已退出的暂存，未知内容保留。

- RAG 未就绪：禁用创建知识库、个人信息的知识库选择；主进程阻止导入和搜索。已有知识库及选择保留。
- 语音未就绪：禁用面试和语音输入，主进程独立阻止启动。

## Mac 打包与检查

package-app.mjs 仅复制实际运行依赖，不再包含 GitHub SDK。模型及 onnxruntime-web 不进入包，保留 onnxruntime-node 和实际运行依赖，不手动修改 node_modules 的厂商文件。包内 voxcue-components.json 的 schemaVersion: 1 启用模型缓存；没有标记的完整旧包沿用原模型路径。开发入口在 shared/local-models 两套模型完整时使用该目录，任一套缺失则使用同一 component-cache 与设置下载流程，下载完成后重启仍复用缓存。Mac 0.2.2 已按此布局发布；旧安装包不重写。

手动查看首次下载时，先退出当前工作区应用；本机两套开发模型已按用户要求删除，重新打开 macos/VoxCue.app 后进入“设置 → 本地组件”下载。若以后需要再次清空下载状态，仅删除 VoxCue/component-cache 内对应模型的版本目录，不删除整个应用数据根；重启后重新检查。/Applications 内的 0.2.1 旧完整安装版不包含当前改动，0.2.2 安装版使用组件缓存。

macos/test/scripts/components-smoke.mjs 在系统临时目录构建独立应用，使用合成账户验证模型未下载时登录、设置快捷入口、真实下载、入口限制和断网重启。临时应用、数据库、profile、资源副本及截图结束清理，结果只显示终端。

该 Mac 专属脚本的 IPC 异步等待仍需在 Mac 本机改用 shared/test/scripts/wait-for-async.mjs；本轮 Windows 只读诊断，不改写或运行 macos/。共用脚本和 Windows 安装态回归已改用显式异步轮询，避免 Promise 真值让断言过早执行。

shared/test/scripts/components-ui-smoke.mjs 使用合成组件状态和独立临时账户检查单个模型状态、按钮宽度过渡、延迟悬停红色取消、宽/窄窗口个人信息动画、居中与焦点恢复，不下载模型或调用真实账户。

## Windows 打包与隔离验证

Windows 本机移除 Copilot 命令/可选依赖、平台运行时字段、专属回归及矩阵引用、打包复制项。共享废弃字段随最后一个消费者移除；sync:workspace 生成 0.2.2 配置，pnpm 更新本平台锁和安装结果、移除独占依赖及安装例外，不升级其他依赖。旧目录 ai-interview-copilot、历史存储键和 COPILOT_TEST_USER_DATA 隔离变量保留。

package-portable.mjs 不复制模型和已移除运行时，在 resources 写入 voxcue-components.json。显式包含组件解包所需 adm-zip；E5 使用 transformers 的 Node CPU 后端，发行副本排除 onnxruntime-web，保留 onnxruntime-node、onnxruntime-common、LanceDB/Arrow 和 Windows 原生库。只处理打包副本，不手工拆删 node_modules。WASAPI/VoxCue.Audio.exe、Worker/utilityProcess 的 ASAR 解包路径、Fluent 和 electron-updater 保持。编译/发行只包含 shared/windows，不混入 Mac 模块、SF Symbols 或 Sparkle。

pnpm test:portable:native 在系统临时根生成便携包，验证无模型时的 ChatGPT 登录/入口限制、真实首次下载、首秒进度、取消清理、损坏响应摘要拒绝及重试；替换应用位置后阻断模型请求，复用缓存运行真实 Paraformer Worker、Windows utilityProcess、E5/LanceDB 三模式检索和 PDF/DOCX。原生展示单项使用合成模型状态，不替代前述推理。

pnpm test:installer:isolated 在同一自有临时根追加 NSIS 构建，核对 latest.yml 的 SHA512、blockmap、NSIS 压缩数据及应用/组件标记/原生助手负载摘要，再执行安装态和原生窗口检查；不执行真实安装器或公开上传。临时应用、模型、profile、数据库、音频与安装包结束清理，结果仅到终端/对话。旧完整包兼容逻辑及真实缓存保持。Windows 0.2.2 已按后续当次授权发布，与 Mac 0.2.2 共用既有 v0.2.2 发行和当前 Latest；原 Mac 三项及 Windows 0.2.1 等全部旧资产保留。测试入口本身不发布，正式打包及分发边界见 UPDATES.md。
