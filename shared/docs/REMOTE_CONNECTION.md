# 私人局域网设备连接

## 当前范围

电脑端提供 HTTP + WebSocket 服务和配对界面，仅用于用户信任的私人局域网或热点。HTTP/WS 不加密传输；不增加公网服务、端口映射或账号登录。服务默认关闭，只绑定一个本机 RFC1918 IPv4 地址，不监听 `0.0.0.0`。多个地址优先物理 Wi-Fi／以太网，明显虚拟网卡或 VPN 排后；自动选择不能保证路由可达，多网卡手动选择属于后续工作。

手机操作页面随 VoxCue 一起打包，二维码指向本机 `/`，由电脑的同源 HTTP 服务提供 HTML、脚本和样式，不使用域名、CDN 或公网托管。页面加载不等于已连接：手机点击连接后申请配对，电脑批准且 WebSocket 认证成功，才显示已连接并开放内容和控制。

手机竖屏按连接顶栏、可预览／展开／隐藏的转录区、问答主区和底部输入排列。输入框沿用电脑的整体结构：文本在上，底部左侧自动回答胶囊，右侧麦克风与发送／停止圆形按钮；更多、关闭及设置控件统一圆形／胶囊。问答和转录使用左右气泡。问答复用纯公式规范化工具与现有 remark-math／rehype-katex，输出原生 MathML，保持严格 CSP，不执行原始 HTML 或加载远程图片。

输入框共享电脑持有的版本，设备新输入仍可通过 CAS 写回电脑；电脑新版本、场次变化和重连快照直接覆盖设备未确认编辑，不询问采用哪一端。断线时设备输入只读，重连后采用电脑当前内容，不重放旧草稿。发送只清理对应版本。流式内容在底部时跟随，上翻阅读保持位置并显示回到最新；触摸和受控远程滚动复用纯滚动工具。页面只持久保存语言、主题、字号和转录显示偏好，不保存正文或草稿。

电脑界面：主设置在屏幕捕获与模型设置之间提供远程连接行，面试中设置提供相同入口；主副标题间距复用屏幕捕获样式，右侧按钮与整组文字居中。连接文案统一称设备，教程只说明同一 Wi-Fi 和扫码／配对操作。二维码弹窗显示地址、到期时间、私人网络说明与教程。配对后入口变为需二次确认的断开连接。开始面试的设备状态列表只显示已连接／未连接；转录标题仅在连接时显示“设备 ✓”状态胶囊，与音频状态共用样式，空间不足换行。面试中意外断开复用音频中断卡片样式：转录可见时放在转录区顶部，否则在回答区顶部，提供重新连接和设置；非面试页面不弹出中断提醒，二维码与审批仍为弹窗。主动断开不提示中断。

## 分层与生命周期

- `backend/remoteConnection/service.ts`：监听、网络校验、短期授权、配对审批、心跳、有界快照推送与请求去重。通过注入端口执行命令，不依赖 Renderer、application 或 Electron。
- `application/remoteConnection.ts`：主进程待执行请求归属、超时与会话取消；校验 Renderer 的内容投影和结果。
- `ipc/remoteConnection.ts`：仅主窗／面试窗主 frame 可管理连接，只有面试窗主 frame 可发布内容和完成操作。
- `src/services/remoteInterview.ts`：投影电脑现有 interview store，复用提问、自动回答与原生麦克风确认；校验共享草稿版本及输入法组合状态，接受后写入同一电脑输入草稿。
- `src/mobile/connection.ts`：纯浏览器配对、认证、恢复、完整快照和请求结果查询；`src/mobile/App.tsx` 负责手机展示，不访问 DesktopAPI、账号或后台实现。
- `backend/remoteConnection/assets.ts`：按 Vite manifest 中手机入口的依赖闭包读取打包资源，拒绝桌面入口、manifest、路径穿越和目录外符号链接，产物缺失／损坏明确返回 503。
- `contracts/remoteConnection.ts`：DesktopAPI、网络消息与同步状态的类型来源。`src/stores/remoteConnection.ts` 管理电脑连接视图；主进程指定唯一弹窗展示窗口，避免主窗与面试窗重复审批。

退出应用、返回登录或主窗关闭撤销网络授权；面试窗口关闭／导航会清除远程内容和未确认请求，非首次加载会撤销手机授权，需重新配对。开始面试对话框显示已有手机连接，电脑点击“确认开始”即批准将本场共享给该手机；手机接口不能开始新面试。服务不保存账号凭据、配对凭证、恢复凭证或面试内容到磁盘，不记录这些材料。新会话使用新的 sessionId／sessionEpoch，旧场命令失效。

## 配对与恢复协议 v1

所有示例只包含合成占位值。`origin` 是电脑显示的实际 `http://<private-ip>:<port>`，WebSocket 地址为对应 `ws://<private-ip>:<port>/connect`。

1. 电脑的受控 `remoteConnection({op:'start'})` 启动监听，返回状态和 `pairing:{url,expiresAt}`。`pair` 刷新二维码，旧二维码随即失效；令牌放在 URL fragment `#pair=...`，不作为 HTTP 查询参数。
2. 手机页读取 fragment 后从地址栏移除，用户点击连接才以同源请求 `POST /pair`，`Content-Type: application/json`，body 为 `{token,name}`。name 最多 60 字符，禁止控制字符。二维码有效期为两分钟；POST 申请消费二维码凭证，普通 GET／扫码预览不消费。配对 POST 回执丢失时不能自动重复消费，明确要求刷新电脑二维码后重新扫码。
3. 成功响应包含 `{id,code,expiresAt,protocolVersion:1}`。手机打开 `/connect`，首条发送 `{type:'authenticate',pendingId:id,protocolVersion:1}`。服务发送 `{type:'pending',id,code}`，但在电脑批准前不提供任何面试内容。
4. 电脑收到 `state.pending:{id,name,code}`，用户核对六位码后批准或拒绝。批准要求当前待审批 WebSocket 仍在线。一次仅一个手机授权、一个有效控制连接；已连接时不能静默替换设备。
5. 批准成功发送 `{type:'paired',protocolVersion:1,token,sequence,snapshot}`。token 是本次服务的短期、可撤销局域网能力凭证，与正式账户凭据无关。手机将恢复／待审批能力及未确认请求的 ID 元数据保存于同 origin 的当前标签页 sessionStorage；不保存命令正文、账号、转录／问答或草稿，禁止写入 URL、日志或面试记录。浏览器禁止该存储时只在当前页面内存恢复，刷新可能需要重新扫码。
6. 意外掉线后，原授权保留两分钟。原手机可重新连接并发送 `{type:'resume',token,protocolVersion:1}`，无需重新审批；恢复成功重新收到 `paired` 和当前完整快照。正确恢复票据可接管尚未关闭的旧 WebSocket，以支持刷新／网络切换竞态，始终只保留一个有效控制连接。授权过期或电脑主动断开后必须重新扫码；待审批连接在其有效期内复用 pendingId 恢复，不重复 POST。
7. 电脑在恢复窗口内主动刷新二维码，会撤销旧恢复授权，再建立新的配对申请；已连接状态下必须先通过二次确认断开。重新配对后，手机不能重放上一授权的命令。

Host 必须匹配实际监听地址和端口；配对 POST 和 WebSocket Origin 必须同源，peer 地址必须为 RFC1918 IPv4。没有跨域 CORS 放行、外部网页代理、任意地址参数或任意 IPC 通道。该限制不代表网络自动可信：用户仍应只在私人网络／热点使用。

## 同步与控制

协议 v1 使用 **完整快照替换**，不使用逐 token 补丁。`{type:'snapshot',sequence,snapshot}` 的 sequence 单调递增；恢复始终发送最新快照。客户端发现序号缺失可以直接用更新快照替换，不拼接旧文本。

`snapshot:null` 表示当前没有可共享的面试窗口／会话，客户端停止控制；可保留已读的上一场内容作为只读视图。它与网络连接断开是不同状态。

快照包含：

- sessionId、sessionEpoch、revision、面试状态与输入方式；
- 最近转录的稳定 id、内容、来源、时间和 final；
- 已发送问题／答案的稳定 id、内容、生成状态及可展示错误；
- pendingQuestion 和 pendingQuestionRevision，表示当前待发送转录候选；
- inputDraft 的 text／revision／manual，表示电脑输入框当前文本、版本和手工编辑状态；未手动编辑时随新转录填入，编辑后保留该草稿。电脑转录超过 6000 字符时标记 truncated，手机提示明确编辑后再发送，不把截短预览当成完整问题消费；
- 麦克风实际静音／切换中状态、micRevision，自动回答状态和 autoAnswerRevision；
- 当前允许发送、切换麦克风、切换自动回答和停止回答的 capabilities。

最多投影最近 200 条转录、40 条问答，目标 JSON 不超过 900 KiB，主进程硬上限 1 MiB。`omitted` 标记省略条数，`textTruncated`／`contentTruncated` 标记截断；不把整个历史库、图片、知识库原文、账号或路径送到手机。功能关闭时不构造／发布快照；开启后在 80ms 窗口合并变化，单次发布在途时只保留最新引用，不堆积中间快照。

设备隐藏转录属于本地视图状态，不能改变电脑转录面板、采集或识别。两端字号、阅读位置独立；输入框草稿、发送后的问答及控制状态共享。设备键入合并发送草稿更新，一次只保留一个在途更新和最新编辑；同草稿版本的普通回答快照不会吞掉节流中的键入，电脑更高草稿版本则直接采纳。电脑组字时拒绝远程改写，设备组字时暂停同步，结束后优先采用期间收到的电脑版本。版本失败后只读同步并采用电脑内容，不弹冲突选择，不重放旧正文。草稿同步不占业务请求容量。

已认证连接发送 `{type:'command',command}`。command 的公共字段为 requestId（8–100 个字母、数字、`_` 或 `-`）、sessionId 和 sessionEpoch；动作如下：

| action            | 附加字段                                      | 行为                                                                                                   |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `set-microphone`  | `muted:boolean, expectedRevision:number`      | 对照 micRevision，明确设置静音目标，等待电脑原生确认；不做全系统静音，远程模式系统音频继续             |
| `set-auto-answer` | `enabled:boolean, expectedRevision:number`    | 对照 autoAnswerRevision，复用现有 setter；关闭不取消已生成中的答案                                     |
| `set-draft`       | `text:string, expectedRevision:number`        | 与 inputDraft.revision 比较后更新共享草稿，最多 6000 字符；过期或电脑组字时拒绝，设备同步采用电脑版本 |
| `ask`             | `text:string, inputDraftRevision:number`      | 手机正常发送路径，先完成草稿同步，再要求当前文本与版本一致；接受后只清除对应版本，不清除下一版编辑 |
| `ask`             | `text:string`                                 | 保留显式直接提问接口，不改写输入草稿；手机输入框正常发送使用上一行的版本化路径 |
| `ask`             | `text:string, pendingQuestionRevision:number` | 发送当前转录候选，要求候选版本和文本一致，复用 submitTranscript 的关联／消费规则；已变化或已消费则拒绝 |
| `stop-answer`     | `answerId:string`                             | 只停止指定的当前生成答案，迟到指令不能停止下一条答案                                                   |

结果为 `{type:'result',result:{requestId,ok,error?,answerId?,inputDraftRevision?}}`。提问成功立即确认已创建的 answerId，不等待完整答案生成；后续生成／失败通过快照同步。草稿写入／发送回传当前草稿版本，候选转录版本和草稿版本字段不能同时指定。切换状态以电脑确认后的快照为准，不能把按钮点击当成完成。

同一授权内先登记 requestId 再执行；相同 ID 和相同内容返回原结果，相同 ID 携带不同内容返回 `request-conflict`。业务最多登记 1024 个请求，达到上限拒绝新请求，不淘汰旧请求后允许重执行。草稿更新另有 64 条有界结果缓存；缓存淘汰后的旧草稿重放仍由版本比较拒绝，不能覆盖新编辑。

回执不明时，客户端先发送 `{type:'query-result',requestId}`：完成则返回原 result，处理中返回 `{type:'command-pending',requestId}`，未知返回失败 result（`request-unknown`）。查询绝不触发业务。未知请求不得自动改 ID 重发或重放旧开关；由用户核对快照后重新操作。

已认证的 `{type:'sync'}` 是只读同步：立即返回当前 sequence／snapshot，不递增序号、不派发业务和不登记命令。手机回到前台时用它确认连接与状态，相同 sequence 的合法响应也能完成这次同步；无回应则进入原恢复流程。

电脑全局 Ctrl+Shift+↑／↓ 调用受控 `service.scroll(direction)`，只对当前已认证且有活动面试的连接发送 `{type:'scroll',scrollId,sessionId,sessionEpoch,direction}`。scrollId 单调增长；设备仅处理同会话、更新编号的事件，并滚动问答区、暂停自动跟随。此消息不改面试内容、没有离线队列或回放缓存，未连接时按键无副作用。

手机主动发送 `{type:'disconnect'}` 时，服务回应 `{type:'disconnected'}` 并撤销该手机授权，保留局域网监听为 waiting；不修改麦克风、自动回答或已经发送的问答，也不在电脑端误报为意外掉线。手机清除自己的短期能力票据；再次连接需重新扫码。

## 断线和限制

连接使用 WebSocket ping/pong 检测失联。设备离线后电脑继续原业务；设备已读内容保持只读，禁用发送／控制，不排队离线指令。恢复按一、二、四、八秒退避，之后最多每十秒重试；网络恢复／回到前台触发即时检查。恢复后先认证、采用电脑当前快照、查询未确认业务结果，再开放操作；草稿恢复直接以电脑为准，旧回执不能改写新版本。

服务限制客户端消息 32 KiB、配对 JSON 2 KiB，限制连接数量与请求速率（每十秒共 60 条，其中草稿 40、业务 20），关闭压缩；慢客户端只发送最新快照，发送缓冲过大则关闭并要求恢复。电脑页面无响应的操作最多等待十秒，超时只表示结果未确认，不能推断操作一定没有执行。

主窗和面试窗共用连接状态。面试窗的远程弹窗与现有设置画布共用串行门控，确认可视尺寸后才显示；失败明确报错，不回退到不可见透明区域。

## 构建、验证与跨平台接续

共享 Vite 配置同时构建 `index.html`（桌面）和 `mobile.html`（手机），并生成 `.vite/manifest.json`。主进程只注入当前应用 `dist/` 根目录；本地服务只开放手机 manifest 依赖闭包的资源，不直接开放目录。键盘布局监听 VisualViewport 的 resize／scroll，合并一帧内更新高度与 offsetTop，并将手机页面固定在当前可视区域；不再反复 scrollIntoView，保留问答与转录各自的滚动容器。

手机页的 CSS／JS 全部同源外部加载，CSP 不允许 inline 脚本／样式、外部连接或采集手机音视频。

Windows 开发入口为 `cd windows; pnpm build:shared`，然后重启开发版 VoxCue 再生成二维码。手机页面使用打包产物而非桌面 Vite 热更新服务器；改手机源码后需重建并重启。Windows 打包脚本在打包前及复制后校验手机资源完整，仍由现有整份 dist 分发，不额外生成手机安装包。1.1.0 发行沿用这条资源校验路径；Mac 的显式运行依赖收集与最终包校验由其本机接续。

实际打包资源的本机 HTTP 检查：`node ../shared/test/scripts/mobile-bundle-smoke.mjs`。它加载真实 manifest／HTML／JS／CSS、检查安全响应头与私有文件拒绝，不启动 GUI、不写报告。`mobile-lan-integration` 则用真实私网 HTTP/WS 串通手机控制器、主进程协调和现有桌面 store，使用合成问答与原生回执端口，不读取真实账户或采样硬件。

iOS Safari／Android Chrome 的实际布局、软键盘、安全区、后台恢复及网络权限仍需真机复核；桌面控制台登录／解锁状态未知时，不启动 GUI 验证，不把协议或 SSR 测试当作真机结果。

通用代码保留在 shared。Windows 本机维护依赖和验证入口，macOS 全树保持只读；Mac 本机需同步生成配置与锁文件、安装同一固定新增依赖，并验证局域网权限／防火墙、原生麦克风和浮窗门控。不能以 Windows 结果代替 Mac 验证。

验证入口为 `mobile-connection`、`mobile-ui`、`follow-scroll-touch`、`mobile-lan-integration`、`remote-connection-service`（实际私网 HTTP/WS）、`remote-connection-ipc`、`remote-interview`、`remote-connection-store`、`remote-connection-ui`、原有 `desktop-ipc` 与相关面试设置／窗口检查。GUI 仅在当前用户已登录且确认解锁的控制台串行执行；不使用真实账户、资料或硬件采样，临时数据在系统临时目录，结果只输出终端／对话。
