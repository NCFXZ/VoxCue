# 本地组件下载与缓存

Paraformer、Qwen 和 RAG 组件通过同一个 ComponentService 下载、认证、缓存和删除。Qwen 的原始 BF16 ASR、Q8_0 Aligner 与平台运行时组合以 catalog.ts、qwen-catalog.ts、qwen-int8-catalog.ts 和 qwen-windows-runtime-catalog.ts 为准；Mac 运行时随应用签名，Windows 运行时属于独立认证归档。模型和推理策略不随应用清理而改变。详细平台边界见 [Mac 接入](QWEN_MACOS.md) 和 [Windows 接入](QWEN_WINDOWS_HANDOFF.md)。

ChatGPT 与 Copilot 使用共享清单固定的 @openai/codex 0.164.0、@github/copilot-sdk 1.0.21 及本平台原生包，随应用打包，不走模型下载。各自登录、聊天和额度复用现有端口；不读取用户其他 Codex 登录，也不依赖旧 copilot-runtime 公开发行。

语音和 RAG 模型独立于应用版本维护。shared/electron/backend/components 使用源码固定的发行标签、ZIP 大小、SHA-256 和逐文件清单，资源位于 NCFXZ/VoxCue 的 Releases。换仓只复制原始归档，不修改版本、摘要、逐文件清单或模型许可证；旧 VoxCue-releases 保留供已安装旧版使用。Renderer 只请求状态、下载/删除固定模型或取消下载，不提供 URL、路径、摘要、权限或命令。

生产解包唯一入口为 unpackComponentFile：从文件流式认证 ZIP，校验中央/本地记录与精确文件列表，再写入私有暂存目录。Buffer/adm-zip 的旧解包实现已删除；adm-zip 依赖仍由 Windows 构建工具、打包检查及合成夹具消费，不盲目删除依赖或改写另一平台。

模型缓存在 VoxCue 应用数据目录下的 component-cache。macOS 根为 ~/Library/Application Support/VoxCue，Windows 为 %APPDATA%/VoxCue；旧 ai-interview-copilot 根在 session 创建前整体原子重命名，成功后旧路径消失，资料、凭据、历史和模型缓存一同保留。两处有内容或旧进程占用时停止，不覆盖或合并。目录由模型 ID、资源版本和 ZIP 摘要确定，不含应用版本，因此升级后可复用。启动检查文件大小、摘要和执行权限，缺失、损坏、链接或额外内容不算就绪。

下载集中在“设置 → 本地组件”。Paraformer/Qwen任意一个已就绪即可满足语音能力，主界面不因另一模型缺失显示语音未就绪；Qwen/CPU改为性能提示。知识库仍独立判断RAG就绪。删除当前语音模型后自动回退另一已安装模型的CPU安全档并保存，启动检查未完成时不误改，重新下载不抢回选择。语音输入/自检优先Paraformer，仅Qwen可用时由可信主进程选择Qwen/CPU。知识库、个人信息等位置保留打开对应组件设置的快捷入口。无需先下载模型即可登录 ChatGPT 和准备聊天。

受管模型在“已就绪”后提供删除图标，沿用原位短确认，删除后可重新下载。主进程只允许主窗口主 frame 按 speech/qwen/rag ID 删除固定版本缓存，使用中的面试、音频测试、资料处理或回答会拒绝删除，并发下载/删除同样拒绝。删除期间立即阻止新的模型操作；先退出空闲语音进程或卸载 RAG 模型，再核对目录、标记与完整清单，仅移除所选模型。未知内容和链接拒绝删除；知识库、索引、原件、凭据、历史及其他模型保留。完整旧包或完整开发模型不属于受管缓存，不提供此删除入口。界面与后台共用，Windows 的原生文件占用需在本机验证。

删除或替换损坏缓存前另核对所选模型目录顶层只含files与.voxcue-component.json；存在额外原件、目录或重定向时拒绝操作并保留。该限制不影响固定模型文件区内损坏权重的重新下载修复。

缺失提示采用原有长条卡片和多行标题/说明。准备页提示放在聊天列内，与下方聊天/输入区域共享可用宽度；个人信息展开时仍显示，随聊天列一起收窄并在该列居中，不横跨个人信息面板。窄窗口也为个人信息面板预留宽度，避免覆盖提示和设置入口。知识库与个人信息中的模型提示沿用同样的长条样式。界面源码两平台共用，Mac 不写 Windows 专属目录。

设置内模型和应用更新下载时，原按钮先显示主题色圆环及旁边的百分比至少一秒，再允许悬停或键盘聚焦显示带平台关闭图标的红色“取消”；侧栏更新按钮仅显示圆环或红色取消图标，所有状态固定 32×32，不显示百分比与文字。首秒不响应取消点击，避免鼠标停在原按钮上立即遮住进度。进度与取消切换时按钮尺寸保持，设置操作状态导致的不同长度平滑过渡，不额外占用进度条或取消操作行。一个模型下载/校验时，其他尚未开始的模型按钮继续显示“下载”并暂时禁用，取消或完成后恢复。容量使用十进制 MB。校验阶段显示不定进度圆环与状态，系统减少动态效果时停止旋转和过渡。个人信息展开/收起时面板及聊天列同步调整宽度，模型提示继续在聊天列内居中；关闭面板不可键盘聚焦。界面、设置分类、字体和状态均在 shared 共用，平台图标保持各自实现，不新增蓝色焦点外圈。

下载有体积、摘要及超时限制；认证归档按精确文件列表解包，拒绝路径穿越、链接、重复/额外条目或内容不符，校验后原子发布。取消和失败清理暂存，保留其他已就绪模型；重试只下载缺失模型。新暂存以随机本地 IPC 租约判断归属，旧 PID-only 和未知内容保留。已声明且有新归属标记的可信前驱，仅在后继完整认证、消费者退出后尽力回收；当次跳过可在下次服务启动重试，取消／退出阻止等待中的删除，不扫描或认领历史目录。完整保护边界见[安全与任务生命周期加固](SECURITY_HARDENING.md)。

- RAG 未就绪：禁用创建知识库、个人信息的知识库选择；主进程阻止导入和搜索。已有知识库及选择保留。
- 两种语音模型均未就绪：禁用面试和开场音源测试，主进程独立阻止启动。准备聊天不提供语音输入；任意一个已就绪时按已确认模型校验，CPU性能提示不作为缺组件错误。

## Mac 打包与检查

package-app.mjs 按固定依赖闭包复制 ChatGPT、Copilot SDK 及本平台运行时。模型及 onnxruntime-web 不进入包，保留 onnxruntime-node 和实际运行依赖，不手动修改 node_modules 的厂商文件。包内 voxcue-components.json 的 schemaVersion: 1 启用模型缓存；没有标记的完整旧包沿用原模型路径。开发入口在 shared/local-models 两套模型完整时使用该目录，任一套缺失则使用同一 component-cache 与设置下载流程，下载完成后重启仍复用缓存。Mac 0.2.2 已按此布局发布；旧安装包不重写。

手动验证首次下载使用自有合成 profile 和临时应用，不清理真实组件缓存或 userData。重新打开本机开发入口不会自动重建；应先按当前源码构建，再进入“设置 → 本地组件”。旧完整包兼容只适用于无组件标记的包。

macos/test/scripts/components-smoke.mjs 在系统临时目录构建独立应用，使用合成账户验证模型未下载时登录、设置快捷入口、真实下载、入口限制和断网重启。临时应用、数据库、profile、资源副本及截图结束清理，结果只显示终端。

Mac组件安装态脚本的IPC异步等待使用shared/test/scripts/wait-for-async.mjs，与共用脚本沿用显式异步轮询，逐次等待真实状态结果，避免Promise真值让断言过早执行。Windows安装态同样沿用其本机入口，Mac不改写Windows文件。

shared/test/scripts/components-ui-smoke.mjs 使用合成组件状态和独立临时账户检查单个模型状态、按钮宽度过渡、延迟悬停红色取消、标题间距、删除短确认与取消、宽/窄窗口个人信息动画、居中与焦点恢复，不下载或删除真实模型，不调用真实账户。--preview-components 仅在终端输出内存预览；实际缓存删除与资料保护使用系统临时目录中的微型固定模型单测。

## Windows 打包与隔离验证

Windows 0.3.0 在本机 sync:workspace 同步共享版本，保留现有锁与固定依赖。隔离安装态 packaged-smoke 纳入 component-removal-check：真实 ASR Worker/语音 utilityProcess、ONNX/RAG 加载后检查使用中拒绝、删除互斥、进程退出与模型卸载后的文件删除，未知顶层原件/目录保护、重新下载及知识库/索引保留。仅采集端口使用合成实现，不采样物理设备；测试与模型只在系统临时目录，结果仅终端/内存。

删除前的句柄核验在消费者真实退出/卸载后立即执行：临时 Win32 探针对固定清单的每个文件及包标记使用无共享的只读句柄打开，任何占用直接失败，再继续实际缓存删除。探针关闭自身句柄，不修改模型内容，不重试或等待文件占用自行消失。

历史 0.2.2 曾移除旧 Copilot 组件；当前官方 SDK 已恢复并随平台运行时打包，不能依据该历史清理记录删除现用 SDK。旧目录 ai-interview-copilot、历史存储键和 COPILOT_TEST_USER_DATA 隔离变量继续保留。

package-portable.mjs 不复制模型和已移除运行时，在 resources 写入 voxcue-components.json。打包清单仍包含有构建/夹具消费者的 adm-zip，生产组件采用流式解包；E5 使用 transformers 的 Node CPU 后端，发行副本排除 onnxruntime-web，保留 onnxruntime-node、onnxruntime-common、LanceDB/Arrow 和 Windows 原生库。只处理打包副本，不手工拆删 node_modules。WASAPI/VoxCue.Audio.exe、Worker/utilityProcess 的 ASAR 解包路径、Fluent 和 electron-updater 保持。编译/发行只包含 shared/windows，不混入 Mac 模块、SF Symbols 或 Sparkle。

当前 Windows 验证入口需在 Windows 本机执行，Mac 只读核对源码：

- node test/scripts/components-native-smoke.mjs：在合成 profile 和隔离包中验证真实下载、取消、损坏响应、缓存复用及删除，不采样物理设备。入口及隔离前提见 [测试说明](../test/README.md)。
- pnpm test:installer:artifact：检查已有安装包的 latest.yml、SHA512、blockmap 及负载，不构建或执行安装器，也不代替安装态界面验证。
- pnpm test:package：构建当前 Store payload 并运行 Windows Sandbox 校验。不是旧 NSIS 便携包检查的别名。
- pnpm test:installer:upgrade：使用独立惰性安装夹具检查升级流程，不代表当前正式业务负载通过验收。

历史 test:portable:native 与 test:installer:isolated 已不是当前命令，不继续作为运行入口。正式打包、签名及发行另按当次授权和 [更新说明](UPDATES.md) 执行；测试不公开上传或替换用户现用安装。临时包、profile、数据库、音频及截图结束清理，结果只到终端/对话。
