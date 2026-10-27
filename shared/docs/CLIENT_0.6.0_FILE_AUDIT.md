# VoxCue 0.6.0：客户端完整文件与差异块审计

日期：2026-10-27。配套[140项客户端行为与Mac验收](MACOS_0.6.0_HANDOFF.md)、[独立服务端只读说明](SERVER_0.5.1_REFERENCE.md)、[Mac Codex提示词](MACOS_0.6.0_CODEX_PROMPT.md)。此表逐文件覆盖本轮提交白名单；它是源代码定位清单，行为与验收标准以C001–C140为准，不能把自动提取的代码片段当作已通过测试。

**固定快照**：本表155项文件、blob及763个改动块对应已上传的客户端代码提交`d35c06ed2c668b2ae2a956b47cb64880baa689a1`。用户随后新增的Windows发行授权、旧版隐藏和发行文档维护单列于[发行记录](WINDOWS_0.6.0_RELEASE.md)，不追改这份代码交接快照的文件blob或测试结论。

## 基线和用法

- 主审计基线是已保留的Mac0.5.11提交 `2af9c78c3e05b3daf303130c3e6dace61ab5734f`；Windows原0.5.11基线 `0c86881c732e87f80bade27e055da950b672914b` 到该提交的远端补丁另列B表，不遗漏这段整合。
- F表列每个文件的最终用途、平台边界、Git规范化内容blob及全部零上下文diff块。旧/新范围格式为“起始行,行数”；0行表示纯插入/删除，不是缺失。每块显示新增/删除行数和开头代码定位，完整内容以Git比较为准。
- 全新文件作为完整新增块，另列全部顶层声明、class成员和固定名称测试的位置；无需从巨大main/CSS中猜模块边界。Markdown全新文件列其所有标题。
- Git blob按仓库clean过滤器计算，允许平台CRLF/LF工作区差异；不是构建/安装包SHA。审计文档自身不写自引用hash，避免循环；不把真实凭据、数据或构建产物加入清单。
- Mac逐项读取全部F表，Windows专属仅核对边界并写“不适用/只读”；shared和Mac适用项实际修复/复测。服务端115项只读树在另一文档，绝不混入本表。

```sh
git diff --stat 2af9c78c3e05b3daf303130c3e6dace61ab5734f d35c06ed2c668b2ae2a956b47cb64880baa689a1
git diff --unified=0 2af9c78c3e05b3daf303130c3e6dace61ab5734f d35c06ed2c668b2ae2a956b47cb64880baa689a1 -- shared/electron/main.ts
# 替换为F表中的任一文件；不要修改服务端来消除差异。
```

## F表：本轮完整白名单

共 **155** 项，包含本审计文档自身。

### F001 · `.gitignore`

**M · 交接/边界/说明**　[打开文件](../../.gitignore)

忽略独立只读shared/server副本，阻止服务端混入客户端源码。

规范化Git blob：`0164674897f4ea6e4155118884aa181575410648`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -33,0 +34,3 @@ shared/test/fixtures/speech-audio/` | −0 / +3 | 新：`# Independent NCFXZ/VoxCue-server checkout used read-only by client integration tests. /shared/server/` |

### F002 · `AGENTS.md`

**M · 交接/边界/说明**　[打开文件](../../AGENTS.md)

记录本次源码上传授权、服务端只读、Mac逐项及全量验收边界；保留历史指令。

规范化Git blob：`534386e88508fb290068f131993bc00f08d50ed7`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -2,0 +3,9 @@` | −0 / +9 | 新：`## 2026-10-27 客户端 0.6.0 源码上传与 Mac 完整交接（最新用户授权） - 用户要求将本次审计后的代码上传既有私有 ˋNCFXZ/VoxCueˋ，详细记录客户端 ˋ0.5.11 → 0.6.0ˋ 每项更新，客户端与服务端分开写，并提供 Mac Codex 逐条接续提示词。本项允许逐文件白名单源码、测试、配置及文档提交推送 ˋmainˋ，不允许公开发行、修改` |

### F003 · `PROGRESS.md`

**M · 交接/边界/说明**　[打开文件](../../PROGRESS.md)

按时间记录0.6功能、云服务迁移、修复、测试证据、清理与Mac接续，区分合并前后。

规范化Git blob：`df8c38c3f0f5b8a3eb7adaf1164303afa6ed3087`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1,100 @@` | −0 / +100 | 新：`## 2026-10-27 0.6.0 源码上传与分仓完整交接 用户新增授权：将审计后的源码、测试、配置和交接推送既有私有 ˋNCFXZ/VoxCue/mainˋ。客户端更新详见 [C001–C140](shared/docs/MACOS_0.6.0_HANDOFF.md)，完整文件及每个差异块见[文件审计](shared/docs/CLIENT_0.6.0_FILE_AUDI` |

### F004 · `README.md`

**M · 交接/边界/说明**　[打开文件](../../README.md)

更新邮箱主账号、云同步、100MB总量、计时保存、当前版本和四份交接入口。

规范化Git blob：`0169bebbe9f5a7ddb7558477855cc69e89c3643a`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -3 +3,7 @@` | −1 / +7 | 旧：`当前共享版本源为 **0.5.11**。Mac 与 Windows 共用 React 界面、布局和业务；Mac 使用 SF Symbols 图标及系统侧栏毛玻璃，其他内部材质统一为聊天输入框的网页模糊。Mac 支持 Apple Silicon/macOS 14.2 及以上，不再包含 Liquid Glass 或 AppKit 内容控件。当前实现见[共用桌面界面](shared/`<br>新：`桌面主账号使用邮箱注册、登录和重置密码，ChatGPT 与 GitHub Copilot 在“设置 → AI 服务”中独立连接。个人信息、面试记录和知识库分别控制云同步，支持逐项暂停、恢复及只删除云端副本。三类数据合计标准配额100 MB；个人资料可超额同步，超出部分仍计入用量。面试时长通过兑换码增加，额度耗尽先保存本场记录再退出，支付保持关闭。 客户端默认连接 https:/` |
| H002 | `@@ -9 +15 @@ Mac 与 Windows **0.5.11** 已发布并设为 **Latest**：[Mac arm64 安装包]` | −1 / +1 | 旧：`当前源码支持 ChatGPT 和 GitHub Copilot 登录。ChatGPT 聊天与额度复用一次官方托管登录；Copilot 使用固定官方 SDK/平台运行时 1.0.21，通过系统浏览器授权。凭据由现有系统保护接口保存；Local RAG 固定为 local-v7-current-source-first，模型、索引和依赖保持。[本地模型](shared/docs/C`<br>新：`ChatGPT 聊天与额度复用一次官方托管登录；Copilot 使用固定官方 SDK/平台运行时 1.0.21，通过系统浏览器授权。凭据由现有系统保护接口保存；Local RAG 固定为 local-v7-current-source-first，模型与索引保持。客户端依赖安全版本见 shared/package.json。[本地模型](shared/docs/COMPONEN` |
| H003 | `@@ -101,0 +108 @@ Windows 清单 1–10 已接入当前共享界面及本机展示适配器，下` | −0 / +1 | 新：`- 主账号独立于AI服务授权，个人信息、面试记录和知识库可分别开启同步。按知识库和面试记录分组备份，个人信息优先；删除云端副本及取消备份优先于后台上传，保留本地数据并持续暂停该项，点击“自动同步”才恢复。取消保留已完成云端副本并释放未完成上传预留。三类合计标准容量100 MB，个人资料可超额且仍计入用量；知识库和面试记录不得使总用量超过配额。支付保持关闭。` |

### F005 · `macos/src/icons.tsx`

**M · Mac图标资源：本机生成/验收**　[打开文件](../../macos/src/icons.tsx)

新增云同步状态SF Symbols映射和共享Loader标记，保留远端Mac放射线亮度动画。

规范化Git blob：`f419ecdc424205c50718d648819c61c03647958a`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -12 +12 @@ const masks = import.meta.glob('../public/sf-symbols/*.png', {` | −1 / +1 | 旧：`function icon(name: keyof typeof symbols) {`<br>新：`function icon(name: keyof typeof symbols, loading = false) {` |
| H002 | `@@ -20,0 +21 @@ function icon(name: keyof typeof symbols) {` | −0 / +1 | 新：`className={loading ? 'ui-loader' : undefined}` |
| H003 | `@@ -70 +71 @@ export const PanelRight = icon('PanelRight');` | −1 / +1 | 旧：`export const Loader = icon('Loader');`<br>新：`export const Loader = icon('Loader', true);` |
| H004 | `@@ -77,0 +79,5 @@ export const Database = icon('Database');` | −0 / +5 | 新：`export const Cloud = icon('Cloud'); export const CloudDone = icon('CloudDone');` |

### F006 · `macos/src/symbols.json`

**M · Mac图标资源：本机生成/验收**　[打开文件](../../macos/src/symbols.json)

增加cloud/cloud-check/cloud-sync/cloud-off/cloud-warning的构建时SF Symbols资源。

规范化Git blob：`ffa615368019f5d39a42371e10090869f7145c5f`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -17,0 +18,5 @@` | −0 / +5 | 新：`"Cloud": "icloud", "CloudDone": "checkmark.icloud",` |

### F007 · `package.json`

**M · 共用客户端：Mac同步验证**　[打开文件](../../package.json)

从shared版本源生成的根0.6.0命令入口。

规范化Git blob：`5446f7e5456b7d842b6d22073cb4951feb61c914`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -3 +3 @@` | −1 / +1 | 旧：`"version": "0.5.11",`<br>新：`"version": "0.6.0",` |

### F008 · `shared/docs/ARCHITECTURE.md`

**M · 交接/边界/说明**　[打开文件](ARCHITECTURE.md)

维护ARCHITECTURE.md：本轮架构/边界/更新/清理/工作区或分仓交接说明，按下列全部段落核对。

规范化Git blob：`5415c299fcc43e524895da7e69da8a71fbdc875b`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -2,0 +3,12 @@` | −0 / +12 | 新：`## 邮箱账号服务 客户端本轮兼容服务端0.5.1，服务端实现、配置与部署保持只读。实际HTTP链路在临时数据库和合成账号上验收；线上连接检查不修改真实账号或资料。主账号与AI授权的产品入口分离，通用桌面测试通过独立测试端口驱动，不在正式包恢复旧AI登录入口。` |

### F009 · `shared/docs/CLIENT_0.6.0_FILE_AUDIT.md`

**A · 交接/边界/说明**　[打开文件](CLIENT_0.6.0_FILE_AUDIT.md)

维护CLIENT_0.6.0_FILE_AUDIT.md：本轮架构/边界/更新/清理/工作区或分仓交接说明，按下列全部段落核对。

自索引文档；完整新增，无自引用blob。此项通过文件路径集合一致性核对。

### F010 · `shared/docs/MACOS_0.6.0_CODEX_PROMPT.md`

**A · 交接/边界/说明**　[打开文件](MACOS_0.6.0_CODEX_PROMPT.md)

维护MACOS_0.6.0_CODEX_PROMPT.md：本轮架构/边界/更新/清理/工作区或分仓交接说明，按下列全部段落核对。

规范化Git blob：`ed2f138ac200228d3b2d3ec769e8de8a535b3fe9`。

完整新增块：`@@ -0,0 +1,94 @@`，新增94行。

- L1：交给 Mac Codex 的完整提示词：VoxCue 0.6.0
- L17：最高优先级边界：绝对不要修改服务端
- L25：第一阶段：建立实际本机基线
- L33：第二阶段：同步Mac构建与安全补丁
- L41：第三阶段：先逐条测试C001–C140，再修客户端
- L60：第四阶段：客户端全量、对抗、安全与UI视觉对齐
- L65：以下在macos/，先满足本机依赖、原生宿主和只读服务端副本
- L86：第五阶段：最终Mac包、清理、交付

### F011 · `shared/docs/MACOS_0.6.0_HANDOFF.md`

**A · 交接/边界/说明**　[打开文件](MACOS_0.6.0_HANDOFF.md)

维护MACOS_0.6.0_HANDOFF.md：本轮架构/边界/更新/清理/工作区或分仓交接说明，按下列全部段落核对。

规范化Git blob：`615b43b5b37caa2047417a200735b4379cc1e8b7`。

完整新增块：`@@ -0,0 +1,263 @@`，新增263行。

- L1：VoxCue 0.5.11 → 0.6.0：客户端完整更新与 Mac 接续
- L5：1. 版本、仓库和禁止改动的范围
- L17：2. 阅读与验收方法
- L23：3. 主账号与 AI 授权分离
- L55：4. 登录与设置布局
- L72：5. 同步数据模型、配额与背压
- L110：6. 同步标志、删除、取消和恢复
- L133：7. 激活兑换、面试时长和到期保存
- L164：8. 共用UI细节、动画与快捷键
- L185：9. 安全升级、测试迁移与发布边界
- L210：10. Windows证据与合并后的边界
- L218：11. Mac执行顺序与命令
- L235：12. 额外对抗与视觉矩阵
- L241：13. 过程决定与最终实现对照（避免恢复已撤回方案）

### F012 · `shared/docs/SERVER_0.5.1_REFERENCE.md`

**A · 交接/边界/说明**　[打开文件](SERVER_0.5.1_REFERENCE.md)

维护SERVER_0.5.1_REFERENCE.md：本轮架构/边界/更新/清理/工作区或分仓交接说明，按下列全部段落核对。

规范化Git blob：`c6513fd705eff25e0a8b1f496929d2e499eac7bf`。

完整新增块：`@@ -0,0 +1,253 @@`，新增253行。

- L1：服务端独立更新与客户端只读适配参考：截至0.5.1
- L5：1. 仓库与证据边界
- L14：2. 服务端功能逐项清单
- L75：3. 运行边界（来自固定0.5.1配置/README）
- L87：4. 桌面需要适配的API
- L125：5. Mac允许做和禁止做的事情
- L133：6. 服务端只读文件索引

### F013 · `shared/docs/UPDATES.md`

**M · 交接/边界/说明**　[打开文件](UPDATES.md)

维护UPDATES.md：本轮架构/边界/更新/清理/工作区或分仓交接说明，按下列全部段落核对。

规范化Git blob：`8dce55750ad507af853cd2652fbe98e306be3946`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -97 +97 @@ Mac DMG可供首次手动安装，但自动更新必须有arm64 ZIP；Mac清单` | −1 / +1 | 旧：`- ˋpnpm test:installer:upgradeˋ：独立应用 ID、无快捷方式的合成 NSIS 应用，安装到 test/results，在两个版本间验证 localStorage、IndexedDB 原件字节及设置文件保留，随后只卸载该测试安装；不访问真实 VoxCue 用户资料。`<br>新：`- ˋpnpm test:installer:upgradeˋ：独立应用 ID、无快捷方式的合成 NSIS 应用，在有所有权标记的系统临时目录中验证两个版本间的 localStorage、IndexedDB 原件字节及设置文件保留，随后只卸载该测试安装并清理临时内容；不访问真实 VoxCue 用户资料，结果仅输出终端。` |

### F014 · `shared/docs/WORKSPACE_CLEANUP.md`

**M · 交接/边界/说明**　[打开文件](WORKSPACE_CLEANUP.md)

维护WORKSPACE_CLEANUP.md：本轮架构/边界/更新/清理/工作区或分仓交接说明，按下列全部段落核对。

规范化Git blob：`e9cdd48bf8f73654a2d32e351114a6b8542b36fb`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1,10 @@` | −0 / +10 | 新：`## 2026-10-27：客户端 0.6.0 整理 本轮服务端 shared/server 全树只读。核对静态导入、动态平台/Worker/preload、构建打包与测试消费者，移除旧登录说明的四个无用 CSS 选择器及 PreparationPage 的闲置 CSSProperties 导入；当前业务、兼容读取和有效评估夹具保留。测试入口适配新的主账号和 AI 设置，未恢复` |

### F015 · `shared/docs/WORKSPACE_LAYOUT.md`

**M · 交接/边界/说明**　[打开文件](WORKSPACE_LAYOUT.md)

维护WORKSPACE_LAYOUT.md：本轮架构/边界/更新/清理/工作区或分仓交接说明，按下列全部段落核对。

规范化Git blob：`b70fb7f498c8c9f7dae553f74274db05d4a41097`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -2,0 +3,2 @@` | −0 / +2 | 新：`新增 shared/server：独立账号服务、Docker 配置、部署/备份脚本和合成后端测试，与桌面发布依赖隔离；运行状态在私有 .state 或容器数据卷，禁止进入源码。桌面共享账号契约、客户端和界面仍在 shared/electron、shared/src；详见 [账号服务](../server/README.md)。` |

### F016 · `shared/electron/backend/cloud/client.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../electron/backend/cloud/client.ts)

HTTPS客户端、受限响应、认证挑战/登录/刷新/会话、串行请求、错误映射及取消。

规范化Git blob：`59edd85c1b1b07074318e48c4f897f53d138d70d`。

完整新增块：`@@ -0,0 +1,462 @@`，新增462行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 16 | type | `CloudCredentials` |
| 24 | type | `CloudVault` |
| 29 | class | `CloudFailure` |
| 38 | 变量/函数 | `Failure` |
| 39 | 变量/函数 | `messages` |
| 56 | 变量/函数 | `record` |
| 61 | 变量/函数 | `uuid` |
| 63 | 变量/函数 | `text` |
| 65 | function | `user` |
| 76 | function | `credentials` |
| 97 | function | `cloudOrigin` |
| 116 | class | `CloudAccountClient` |
| 117 | 成员 | `current` |
| 118 | 成员 | `initialized` |
| 119 | 成员 | `verified` |
| 120 | 成员 | `busy` |
| 121 | 成员 | `waiting` |
| 122 | 成员 | `acquireApi` |
| 139 | 成员 | `release` |
| 154 | 成员 | `state` |
| 161 | 成员 | `snapshot` |
| 164 | 成员 | `isCurrentSession` |
| 167 | 成员 | `load` |
| 181 | 成员 | `request` |
| 222 | 成员 | `save` |
| 233 | 成员 | `clear` |
| 238 | 成员 | `access` |
| 254 | 成员 | `authorized` |
| 264 | 成员 | `api` |
| 326 | 成员 | `call` |

### F017 · `shared/electron/backend/cloud/lease.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../electron/backend/cloud/lease.ts)

主进程面试租约、单调时钟、心跳、迟到隔离、永久额度和到期/关闭释放。

规范化Git blob：`d825dfc9cf31a1537d255759c6eed820a9f29d32`。

完整新增块：`@@ -0,0 +1,220 @@`，新增220行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 10 | function | `readEntitlements` |
| 32 | class | `InterviewLease` |
| 33 | 成员 | `current` |
| 39 | 成员 | `last` |
| 40 | 成员 | `timer` |
| 41 | 成员 | `heartbeat` |
| 42 | 成员 | `busy` |
| 43 | 成员 | `nextBeat` |
| 44 | 成员 | `attempt` |
| 51 | 成员 | `call` |
| 77 | 成员 | `read` |
| 116 | 成员 | `snapshot` |
| 132 | 成员 | `publish` |
| 136 | 成员 | `active` |
| 139 | 成员 | `assertActive` |
| 142 | 成员 | `start` |
| 163 | 成员 | `tick` |
| 208 | 成员 | `stop` |

### F018 · `shared/electron/backend/cloud/sync.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../electron/backend/cloud/sync.ts)

有界单worker同步、profile优先、整库顺序、分块校验、取消/删除优先、持久暂停、容量与恢复。

规范化Git blob：`ae3af2acc2c44546a10b10b74bfb570fbcf8ea7b`。

完整新增块：`@@ -0,0 +1,110 @@`，新增110行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 9 | class | `CloudSyncClient` |
| 10 | 成员 | `busy` |
| 15 | 成员 | `call` |

### F019 · `shared/electron/backend/cloud/vault.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../electron/backend/cloud/vault.ts)

通过既有系统加密持久化主账号凭据，原子写入、身份核验及有界读取，无明文回退。

规范化Git blob：`e5eadb83d36d53fb2ed49181c13b67d786f87365`。

完整新增块：`@@ -0,0 +1,49 @@`，新增49行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 8 | function | `createCloudVault` |

### F020 · `shared/electron/contracts/cloudAccount.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../electron/contracts/cloudAccount.ts)

主账号请求/快照、邮箱与Unicode密码校验及安全错误类型。

规范化Git blob：`8ec4a24f9349022ef52af99e3dae3a64219f242b`。

完整新增块：`@@ -0,0 +1,71 @@`，新增71行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 1 | 变量/函数 | `CLOUD_PASSWORD_MIN` |
| 2 | 变量/函数 | `CLOUD_PASSWORD_MAX` |
| 4 | function | `normalizeCloudPassword` |
| 15 | function | `validCloudEmail` |
| 34 | type | `CloudUser` |
| 39 | type | `CloudAccountState` |
| 44 | type | `CloudSession` |
| 51 | type | `CloudAccountCall` |
| 63 | type | `CloudAccountResult` |

### F021 · `shared/electron/contracts/cloudSync.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../electron/contracts/cloudSync.ts)

三类同步数据、条目/状态/用量/分块协议、100MB合计与profile豁免计量。

规范化Git blob：`6abda6193512e4b24690c24c733d65ab0d4c2686`。

完整新增块：`@@ -0,0 +1,127 @@`，新增127行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 2 | type | `SyncKind` |
| 3 | 变量/函数 | `syncKinds` |
| 4 | 变量/函数 | `CLOUD_CHUNK_BYTES` |
| 5 | 变量/函数 | `KNOWLEDGE_MAX_BYTES` |
| 6 | type | `CloudResource` |
| 16 | type | `CloudStorage` |
| 23 | type | `CloudResourceList` |
| 28 | type | `CloudManifest` |
| 41 | type | `SyncOperation` |
| 60 | type | `CloudSyncCall` |
| 61 | type | `CloudSyncResult` |
| 65 | function | `validCloudSyncCall` |

### F022 · `shared/electron/contracts/cloudUsage.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../electron/contracts/cloudUsage.ts)

有限/永久额度、租约、开始/心跳/停止和运行状态校验。

规范化Git blob：`45fa930f4d73b3a8aa63706deb249a9c26803699`。

完整新增块：`@@ -0,0 +1,26 @@`，新增26行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 1 | type | `CloudEntitlements` |
| 8 | function | `isLowInterviewCredit` |
| 13 | type | `InterviewUsageState` |
| 19 | function | `hasInterviewUsageNotice` |
| 24 | type | `CloudUsageCall` |
| 25 | type | `CloudUsageResult` |

### F023 · `shared/electron/contracts/desktop.ts`

**M · 共用客户端：Mac同步验证**　[打开文件](../electron/contracts/desktop.ts)

增加三类类型化桌面云端口，避免渲染层直接持有凭据或任意HTTP接口。

规范化Git blob：`9e433b2785a37c29cd23fdbe2ea95ba34f85479e`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -8,0 +9,3 @@ import type { AccountUsage } from './accountUsage';` | −0 / +3 | 新：`import type { CloudAccountCall, CloudAccountResult } from './cloudAccount'; import type { CloudSyncCall, CloudSyncResult } from './cloudSync';` |
| H002 | `@@ -33,0 +37 @@ export interface InterviewWindowState {` | −0 / +1 | 新：`usage?: InterviewUsageState \| null;` |
| H003 | `@@ -37,0 +42,5 @@ export interface DesktopAPI {` | −0 / +5 | 新：`cloudAccount(call: CloudAccountCall): Promise<CloudAccountResult>; cloudSync(call: CloudSyncCall): Promise<CloudSyncResult>;` |
| H004 | `@@ -113,0 +123,3 @@ export interface DesktopInvokeMap {` | −0 / +3 | 新：`'cloud:account': Invocation<DesktopAPI['cloudAccount']>; 'cloud:sync': Invocation<DesktopAPI['cloudSync']>;` |
| H005 | `@@ -163,0 +176,2 @@ export interface DesktopEventMap {` | −0 / +2 | 新：`'cloud:usage-expired': [message: string]; 'interview:usage': [state: InterviewUsageState];` |

### F024 · `shared/electron/contracts/interviewLayout.ts`

**M · 共用客户端：Mac同步验证**　[打开文件](../electron/contracts/interviewLayout.ts)

额度提示出现/消失时的64px收起浮窗空间及既有窗口几何。

规范化Git blob：`9d6472b1aff506e5713a0b22d97418d51e73fd6d`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -12,0 +13 @@ export const interviewLayout = {` | −0 / +1 | 新：`collapsedNoticeHeight: 64,` |
| H002 | `@@ -24 +25,6 @@ export function interviewPanelScale(width: number, transcriptVisible = true) {` | −1 / +6 | 旧：`export function interviewCanvas(transcriptVisible = true, collapsed = false, scale = 1) {`<br>新：`export function interviewCanvas( transcriptVisible = true,` |
| H003 | `@@ -26 +32,6 @@ export function interviewCanvas(transcriptVisible = true, collapsed = false, sca` | −1 / +6 | 旧：`? { width: interviewLayout.collapsedWidth, height: interviewLayout.collapsedHeight }`<br>新：`? { width: interviewLayout.collapsedWidth,` |
| H004 | `@@ -47,0 +59 @@ export function fitInterviewBounds(` | −0 / +1 | 新：`usageNotice = false,` |
| H005 | `@@ -62 +74,5 @@ export function fitInterviewBounds(` | −1 / +5 | 旧：`area.y + area.height - (collapsed ? interviewLayout.collapsedHeight : fixed.height),`<br>新：`area.y + area.height -` |
| H006 | `@@ -76 +92 @@ export function fitInterviewBounds(` | −1 / +1 | 旧：`const canvas = interviewCanvas(transcriptVisible, collapsed, scale);`<br>新：`const canvas = interviewCanvas(transcriptVisible, collapsed, scale, usageNotice);` |

### F025 · `shared/electron/main.ts`

**M · 共用客户端：Mac同步验证**　[打开文件](../electron/main.ts)

接入主账号/云同步/额度服务、合法IPC来源及主进程面试准入/到期保存生命周期。

规范化Git blob：`d9a6dff8c703b7e7eedb72429571d0d3468e12de`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -28,0 +29,5 @@ import { createAuthStorage } from './backend/auth/storage';` | −0 / +5 | 新：`import { CloudAccountClient, cloudOrigin } from './backend/cloud/client'; import { createCloudVault } from './backend/cloud/vault';` |
| H002 | `@@ -97,0 +103,3 @@ let demoSession = false;` | −0 / +3 | 新：`let accountLease: InterviewLease \| undefined; let quotaEndMessage: string \| null = null;` |
| H003 | `@@ -172 +180 @@ function interviewActive() {` | −1 / +1 | 旧：`async function prepareUpdateInstall() {`<br>新：`async function prepareUpdateInstall(accountLogout = false) {` |
| H004 | `@@ -181,2 +189,2 @@ async function prepareUpdateInstall() {` | −2 / +2 | 旧：`title: '重启并更新 VoxCue', message: '重启并安装更新？',`<br>新：`title: accountLogout ? '退出 VoxCue 账号' : '重启并更新 VoxCue', message: accountLogout ? '退出主账号？未保存的编辑会丢失。' : '重启并安装更新？',` |
| H005 | `@@ -185 +193 @@ async function prepareUpdateInstall() {` | −1 / +1 | 旧：`buttons: ['取消', '重启并更新'],`<br>新：`buttons: ['取消', accountLogout ? '退出账号' : '重启并更新'],` |
| H006 | `@@ -251,0 +260 @@ function sizeInterview(scale: number, anchor?: Electron.Rectangle) {` | −0 / +1 | 新：`interviewUsageNotice,` |
| H007 | `@@ -379,0 +389 @@ function openInterview() {` | −0 / +1 | 新：`void accountLease?.stop();` |
| H008 | `@@ -605,0 +616,102 @@ app.whenReady().then(() => {` | −0 / +102 | 新：`const credentialEncryption = desktopPlatform.credentialEncryptionFile ? require(` |
| H009 | `@@ -608,14 +720 @@ app.whenReady().then(() => {` | −14 / +1 | 旧：`storage: createAuthStorage( desktopPlatform.credentialEncryptionLabel,`<br>新：`storage: createAuthStorage(desktopPlatform.credentialEncryptionLabel, credentialEncryption),` |
| H010 | `@@ -742,0 +842,8 @@ app.whenReady().then(() => {` | −0 / +8 | 新：`if (mainWindow && !mainCloseApproved) { await selection.write(service);` |
| H011 | `@@ -777 +884,6 @@ app.whenReady().then(() => {` | −1 / +6 | 旧：`handleDesktop('auth:sign-in', async (event, ...args) => {`<br>新：`const requireAIWindow = (event: Electron.IpcMainInvokeEvent) => { if (event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame) {` |
| H012 | `@@ -778,0 +891,5 @@ app.whenReady().then(() => {` | −0 / +5 | 新：`if (app.isPackaged \|\| !process.env.COPILOT_TEST_USER_DATA) throw Error('请在设置中连接 AI 服务。');` |
| H013 | `@@ -783 +900 @@ app.whenReady().then(() => {` | −1 / +1 | 旧：`requireLogin(event);`<br>新：`requireAIWindow(event);` |
| H014 | `@@ -788 +905 @@ app.whenReady().then(() => {` | −1 / +1 | 旧：`requireLogin(event);`<br>新：`requireAIWindow(event);` |
| H015 | `@@ -807,0 +925 @@ app.whenReady().then(() => {` | −0 / +1 | 新：`if (interviewActive()) throw Error('请先结束面试再断开 AI 服务。');` |
| H016 | `@@ -829,2 +946,0 @@ app.whenReady().then(() => {` | −2 / +0 | 旧：`mainCloseApproved = true; createLoginWindow();` |
| H017 | `@@ -893 +1009,4 @@ app.whenReady().then(() => {` | −1 / +4 | 旧：`requireInterview,`<br>新：`requireInterview(event) { requireInterview(event);` |
| H018 | `@@ -1049,0 +1169 @@ app.whenReady().then(() => {` | −0 / +1 | 新：`if (call.op === 'start' && !demoSession) accountLease!.assertActive();` |
| H019 | `@@ -1064,0 +1185 @@ app.whenReady().then(() => {` | −0 / +1 | 新：`if (!demoSession) accountLease!.assertActive();` |
| H020 | `@@ -1134 +1255,9 @@ app.whenReady().then(() => {` | −1 / +9 | 旧：`openInterview();`<br>新：`try { quotaEndMessage = null;` |
| H021 | `@@ -1148,0 +1278 @@ app.whenReady().then(() => {` | −0 / +1 | 新：`usage: accountLease?.snapshot(),` |
| H022 | `@@ -1291,0 +1422,4 @@ app.whenReady().then(() => {` | −0 / +4 | 新：`if (quotaEndMessage && mainWindow && !mainWindow.isDestroyed()) { sendDesktop(mainWindow.webContents, 'cloud:usage-expired', quotaEndMessage);` |
| H023 | `@@ -1320 +1454,9 @@ app.whenReady().then(() => {` | −1 / +9 | 旧：`.then(() => activeAuth().session())`<br>新：`.then(async () => { const result = await cloudAccount.call({ action: 'status' });` |
| H024 | `@@ -1330 +1472,4 @@ app.whenReady().then(() => {` | −1 / +4 | 旧：`.then(() => activeAuth().session())`<br>新：`.then(async () => { const result = await cloudAccount.call({ action: 'status' });` |

### F026 · `shared/electron/preload.ts`

**M · 共用客户端：Mac同步验证**　[打开文件](../electron/preload.ts)

仅桥接类型化cloudAccount/cloudSync/cloudUsage端口和事件。

规范化Git blob：`957d1fc4f7f0dc933d22f24e0a98addb8c4b945a`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -50,0 +51,5 @@ const desktop: DesktopAPI = {` | −0 / +5 | 新：`cloudAccount: (call) => invoke('cloud:account', call), cloudSync: (call) => invoke('cloud:sync', call),` |

### F027 · `shared/electron/window.ts`

**M · 共用客户端：Mac同步验证**　[打开文件](../electron/window.ts)

调整登录窗口空间，保持无滚动条和平台窗口控制避让。

规范化Git blob：`c463d3063b09c9786e1ccd87de0584ff1b1968af`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -9,2 +9,2 @@ const roleOptions: Record<WindowRole, BrowserWindowConstructorOptions> = {` | −2 / +2 | 旧：`width: 960, height: 580,`<br>新：`width: 1000, height: 660,` |
| H002 | `@@ -12 +12 @@ const roleOptions: Record<WindowRole, BrowserWindowConstructorOptions> = {` | −1 / +1 | 旧：`minHeight: 520,`<br>新：`minHeight: 580,` |

### F028 · `shared/package.json`

**M · 共用客户端：Mac同步验证**　[打开文件](../package.json)

0.6.0及Electron44.10.0/Vitest4.1.12声明，保留固定模型/SDK/Codex；平台生成依赖。

规范化Git blob：`d8a33b7cdb1b84c11820e815ac2e5ff28ce0857d`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -4 +4 @@` | −1 / +1 | 旧：`"version": "0.5.11",`<br>新：`"version": "0.6.0",` |
| H002 | `@@ -80 +80 @@` | −1 / +1 | 旧：`"electron": "^38.0.0",`<br>新：`"electron": "44.10.0",` |
| H003 | `@@ -87 +87 @@` | −1 / +1 | 旧：`"vitest": "^3.2.0"`<br>新：`"vitest": "4.1.12"` |

### F029 · `shared/pnpm-workspace.yaml`

**M · 共用客户端：Mac同步验证**　[打开文件](../pnpm-workspace.yaml)

固定安全overrides、release-age精确例外和既有脚本构建允许项。

规范化Git blob：`d73e6c42854873555140acea22e831ca9f6ba886`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -5,0 +6,3 @@ verifyDepsBeforeRun: false` | −0 / +3 | 新：`# Official stable release verified against electron/electron; includes #52633. minimumReleaseAgeExclude:` |
| H002 | `@@ -8,0 +12,5 @@ overrides:` | −0 / +5 | 新：`# GHSA-mrhx-c7xc-m3w5: reject oversized collections before walking elements. '@github/copilot-sdk>zod': '4.6.6'` |

### F030 · `shared/src/App.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/App.tsx)

主账号启动路由、独立AI授权、退出保存、云生命周期及到期结束反馈。

规范化Git blob：`3a0783b7e8c5bddc84b0b389769c8acf66951ffc`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -8,0 +9,3 @@ import { usePreparation } from './stores/preparation';` | −0 / +3 | 新：`import { useCloudSync } from './stores/cloudSync'; import { useKnowledge } from './stores/knowledge';` |
| H002 | `@@ -15 +18,3 @@ import { useHistory } from './stores/history';` | −1 / +3 | 旧：`import { providerInfo } from './services/providers';`<br>新：`import { useCloudUsage } from './stores/cloudUsage'; import { Button } from './components/ui/button';` |
| H003 | `@@ -30 +35 @@ export function App() {` | −1 / +1 | 旧：`const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('general');`<br>新：`const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('account');` |
| H004 | `@@ -37,0 +43,9 @@ export function App() {` | −0 / +9 | 新：`const [interviewNotice, setInterviewNotice] = useState<string \| null>(null); useEffect(() => {` |
| H005 | `@@ -38,0 +53,35 @@ export function App() {` | −0 / +35 | 新：`const account = useCloudAccount(); const signedIn = !!account.state.user \|\| auth.session?.mode === 'demo';` |
| H006 | `@@ -53 +102 @@ export function App() {` | −1 / +1 | 旧：`if (isLoginWindow \|\| !auth.session) return;`<br>新：`if (isLoginWindow \|\| !signedIn) return;` |
| H007 | `@@ -81 +130 @@ export function App() {` | −1 / +1 | 旧：`!!auth.session &&`<br>新：`!!signedIn &&` |
| H008 | `@@ -97,0 +147 @@ export function App() {` | −0 / +1 | 新：`void useCloudAccount.getState().load();` |
| H009 | `@@ -100,3 +150,5 @@ export function App() {` | −3 / +5 | 旧：`if (!isLoginWindow && auth.session) void useChatConnection.getState().load(auth.session.mode !== 'demo');`<br>新：`if (!isLoginWindow && signedIn) void useChatConnection` |
| H010 | `@@ -131 +183 @@ export function App() {` | −1 / +1 | 旧：`className={ˋapp-shell ${isLoginWindow ? 'login-shell' : ''} ${window.desktop?.platform === 'macos' ? 'native-window-controls' : 'custom-window-controls'}ˋ}`<br>新：`className={ˋapp-shell ${showLogin ? 'login-shell' : ''} ${window.desktop?.platform === 'macos' ? 'native-window-controls' : 'custom-window-controls'}ˋ}` |
| H011 | `@@ -134 +186 @@ export function App() {` | −1 / +1 | 旧：`{auth.loading ? (`<br>新：`{!account.loaded ? (` |
| H012 | `@@ -136 +188 @@ export function App() {` | −1 / +1 | 旧：`) : isLoginWindow \|\| !auth.session ? (`<br>新：`) : isLoginWindow \|\| !signedIn ? (` |
| H013 | `@@ -141,6 +193,2 @@ export function App() {` | −6 / +2 | 旧：`userName={auth.session.user.name} accountLabel={`<br>新：`userName={account.state.user?.email.split('@')[0] \|\| '本地用户'} accountLabel={account.state.user?.email \|\| '隔离测试'}` |
| H014 | `@@ -156 +204 @@ export function App() {` | −1 / +1 | 旧：`setSettingsCategory('general');`<br>新：`setSettingsCategory('account');` |
| H015 | `@@ -162,3 +210,8 @@ export function App() {` | −3 / +8 | 旧：`if (await auth.signOut()) { setSettings(false);`<br>新：`try { const result = await useCloudAccount.getState().call({ action: 'logout' });` |
| H016 | `@@ -183,2 +236,15 @@ export function App() {` | −2 / +15 | 旧：`{!isLoginWindow && <TitleBar />} {(appearanceError \|\| (auth.session && (auth.error \|\| sessionStateError))) && (`<br>新：`{!showLogin && <TitleBar />} {!showLogin && interviewNotice && (` |
| H017 | `@@ -186 +252 @@ export function App() {` | −1 / +1 | 旧：`{appearanceError \|\| auth.error \|\| sessionStateError}`<br>新：`{appearanceError \|\| sessionStateError \|\| auth.error}` |
| H018 | `@@ -189 +255 @@ export function App() {` | −1 / +1 | 旧：`{settings && (`<br>新：`{settings && signedIn && (` |

### F031 · `shared/src/components/AIServicePanel.tsx`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/components/AIServicePanel.tsx)

独立ChatGPT/Copilot连接、取消/断开及官方额度区，统一状态和错误。

规范化Git blob：`f34539237c88fda62167cb8009edcff6731e763e`。

完整新增块：`@@ -0,0 +1,71 @@`，新增71行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 9 | function | `AIServicePanel` |

### F032 · `shared/src/components/CloudAccountPanel.tsx`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/components/CloudAccountPanel.tsx)

主邮箱/已登录/退出，删除重复标题及设备UI，承载面试额度。

规范化Git blob：`165183f017a02916d16412a71cc53fb6e001e828`。

完整新增块：`@@ -0,0 +1,346 @@`，新增346行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 13 | type | `Mode` |
| 14 | function | `CloudAccountPanel` |

### F033 · `shared/src/components/CloudStorageSummary.tsx`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/components/CloudStorageSummary.tsx)

三类容量比例条、MB图例、可用/已用、超额展示与非粗体数字。

规范化Git blob：`699d90fa6d83ff729b5633121714f1b78b065475`。

完整新增块：`@@ -0,0 +1,55 @@`，新增55行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 2 | 变量/函数 | `kinds` |
| 7 | 变量/函数 | `bytes` |
| 8 | function | `CloudStorageSummary` |

### F034 · `shared/src/components/CloudUsagePanel.tsx`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/components/CloudUsagePanel.tsx)

小时分钟额度、永久状态、零额云保留日期、刷新及激活码兑换。

规范化Git blob：`cc92d3d79f36c8e27bd6f9f161db4d436c2b41e4`。

完整新增块：`@@ -0,0 +1,66 @@`，新增66行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 6 | function | `CloudUsagePanel` |

### F035 · `shared/src/components/DownloadButton.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/DownloadButton.tsx)

组件下载/取消复用侧栏220ms宽度、交叉淡化/位移与圆弧，保留Mac Loader。

规范化Git blob：`c2761585d6e70d038518959a8c21cd615801239c`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -1 +1 @@` | −1 / +1 | 旧：`import { useEffect, useState } from 'react';`<br>新：`import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';` |
| H002 | `@@ -22,0 +23,18 @@ export function DownloadButton({` | −0 / +18 | 新：`const idle = useRef<HTMLSpanElement>(null), cancel = useRef<HTMLSpanElement>(null);` |
| H003 | `@@ -37,0 +56,8 @@ export function DownloadButton({` | −0 / +8 | 新：`style={ !iconOnly` |
| H004 | `@@ -45 +71 @@ export function DownloadButton({` | −1 / +1 | 旧：`<span className="download-button-progress">`<br>新：`<span ref={idle} className="download-button-progress">` |
| H005 | `@@ -78 +104 @@ export function DownloadButton({` | −1 / +1 | 旧：`<span className="download-button-cancel" aria-hidden="true">`<br>新：`<span ref={cancel} className="download-button-cancel" aria-hidden="true">` |

### F036 · `shared/src/components/FloatingInterview.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/FloatingInterview.tsx)

额度实时提示、5分钟/秒边界、到期关闭保存及平台截图快捷键。

规范化Git blob：`373f73aecaa82af3e8324840131a2d1f8fd3a069`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -33,0 +34,5 @@ import { InterviewAudioRecovery } from './InterviewAudioRecovery';` | −0 / +5 | 新：`import { InterviewUsageNotice } from './InterviewUsageNotice'; import {` |
| H002 | `@@ -70 +75 @@ export function FloatingInterview() {` | −1 / +1 | 旧：`!event.ctrlKey \|\|`<br>新：`(macScreenshotShortcut ? !event.ctrlKey \|\| event.altKey : !event.altKey \|\| event.ctrlKey) \|\|` |
| H003 | `@@ -72 +76,0 @@ export function FloatingInterview() {` | −1 / +0 | 旧：`event.altKey \|\|` |
| H004 | `@@ -84 +88 @@ export function FloatingInterview() {` | −1 / +1 | 旧：`}, [collapsed]);`<br>新：`}, [collapsed, macScreenshotShortcut]);` |
| H005 | `@@ -86,0 +91,2 @@ export function FloatingInterview() {` | −0 / +2 | 新：`const [usage, setUsage] = useState<InterviewUsageState \| null>(); const quotaEnding = useRef(false);` |
| H006 | `@@ -252,0 +259,24 @@ export function FloatingInterview() {` | −0 / +24 | 新：`let active = true, ready = false,` |
| H007 | `@@ -255,0 +286 @@ export function FloatingInterview() {` | −0 / +1 | 新：`if (!active) return;` |
| H008 | `@@ -258,0 +290 @@ export function FloatingInterview() {` | −0 / +1 | 新：`setUsage(value.usage);` |
| H009 | `@@ -259,0 +292,3 @@ export function FloatingInterview() {` | −0 / +3 | 新：`ready = true; if (pendingExpiry \|\| value.usage?.state === 'expired')` |
| H010 | `@@ -275 +310 @@ export function FloatingInterview() {` | −1 / +1 | 旧：`if (current.sessionId) {`<br>新：`if (current.sessionId && current.status !== 'ended') {` |
| H011 | `@@ -278 +313 @@ export function FloatingInterview() {` | −1 / +1 | 旧：`if (current.mode === 'local' && current.status !== 'ended') current.archive('interrupted');`<br>新：`if (current.mode === 'local') current.archive('interrupted');` |
| H012 | `@@ -284,0 +320 @@ export function FloatingInterview() {` | −0 / +1 | 新：`active = false;` |
| H013 | `@@ -288,0 +325,2 @@ export function FloatingInterview() {` | −0 / +2 | 新：`unsubscribeQuota?.(); unsubscribeUsage?.();` |
| H014 | `@@ -306 +344,3 @@ export function FloatingInterview() {` | −1 / +3 | 旧：`await state.end();`<br>新：`await state.end( quotaEnding.current ? { preserveEmpty: true, generateTitle: false } : undefined,` |
| H015 | `@@ -751 +791 @@ export function FloatingInterview() {` | −1 / +1 | 旧：`aria-keyshortcuts="Control+s"`<br>新：`aria-keyshortcuts={macScreenshotShortcut ? 'Control+s' : 'Alt+s'}` |
| H016 | `@@ -776 +816 @@ export function FloatingInterview() {` | −1 / +1 | 旧：`{macScreenshotShortcut ? '⌃S' : 'Ctrl+S'}`<br>新：`{macScreenshotShortcut ? '⌃S' : 'Alt+S'}` |
| H017 | `@@ -829 +869 @@ export function FloatingInterview() {` | −1 / +1 | 旧：`{!collapsed && (`<br>新：`{(!collapsed \|\| hasInterviewUsageNotice(usage)) && (` |
| H018 | `@@ -831 +871,2 @@ export function FloatingInterview() {` | −1 / +2 | 旧：`{!protectedWindow && (`<br>新：`<InterviewUsageNotice usage={usage} saved={state.status === 'ended'} /> {!collapsed && !protectedWindow && (` |

### F037 · `shared/src/components/HistoryDetail.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/HistoryDetail.tsx)

记录标题使用已有圆形尺寸的编辑/云状态操作及对齐。

规范化Git blob：`b69fcf21f30cd4c83c00a297fcc0b07cebe20c17`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -10,0 +11 @@ import { useHistory } from '../stores/history';` | −0 / +1 | 新：`import { SyncBadge } from './SyncBadge';` |
| H002 | `@@ -221,0 +223 @@ export function HistoryDetail({ record, onBack }: { record: InterviewRecord; onB` | −0 / +1 | 新：`<SyncBadge itemKey={'record:' + record.id} label={record.title} />` |

### F038 · `shared/src/components/HistoryPage.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/HistoryPage.tsx)

列表标题旁云标记、统一操作、回答侧栏开合与顶栏/滚动条几何。

规范化Git blob：`5877dc613766bb9b8ffa3287d3cc73766a1d0684`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { SyncBadge } from './SyncBadge';` |
| H002 | `@@ -108,21 +109,15 @@ export function HistoryPage() {` | −21 / +15 | 旧：`<button key={record.id}`<br>新：`<div className="history-row-wrap" key={record.id}> <div className="history-row">` |
| H003 | `@@ -130,8 +125,19 @@ export function HistoryPage() {` | −8 / +19 | 旧：`</h2> <p>`<br>新：`</div> <span className="timeline-dot" />` |
| H004 | `@@ -139,2 +145 @@ export function HistoryPage() {` | −2 / +1 | 旧：`<ChevronDown size={15} /> </button>`<br>新：`</div>` |

### F039 · `shared/src/components/InterviewUsageNotice.tsx`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/components/InterviewUsageNotice.tsx)

剩余5分钟警告、少于1分钟秒数、归零/保存失败等状态和可访问通知。

规范化Git blob：`dab4f40b363c5972cee29cd89b0f7ddbae570a38`。

完整新增块：`@@ -0,0 +1,38 @@`，新增38行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 7 | function | `InterviewUsageNotice` |

### F040 · `shared/src/components/KnowledgePage.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/KnowledgePage.tsx)

库/文件云标记、云删除、文件右侧操作和顶端固定毛玻璃标题。

规范化Git blob：`5dfb0064adeec25004a095ea2e1886d532e57387`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { SyncBadge } from './SyncBadge';` |
| H002 | `@@ -94,17 +95,19 @@ export function KnowledgePage({ onComponentSettings }: { onComponentSettings?():` | −17 / +19 | 旧：`<button key={item.id}`<br>新：`<div className="knowledge-card-wrap" key={item.id}> <button` |
| H003 | `@@ -119,0 +123,2 @@ export function KnowledgePage({ onComponentSettings }: { onComponentSettings?():` | −0 / +2 | 新：`fixedHeader overlayHeader` |
| H004 | `@@ -127,14 +132,16 @@ export function KnowledgePage({ onComponentSettings }: { onComponentSettings?():` | −14 / +16 | 旧：`<Button disabled={state.busy}`<br>新：`<> <Button` |
| H005 | `@@ -143,0 +151 @@ export function KnowledgePage({ onComponentSettings }: { onComponentSettings?():` | −0 / +1 | 新：`<SyncBadge itemKey={'base:' + base.id} label={base.name} />` |
| H006 | `@@ -239,0 +248 @@ export function KnowledgePage({ onComponentSettings }: { onComponentSettings?():` | −0 / +1 | 新：`<SyncBadge itemKey={'file:' + doc.id} label={doc.name} />` |

### F041 · `shared/src/components/LoginPage.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/LoginPage.tsx)

邮箱登录/注册/找回、15–128密码占位、验证码/垃圾邮件提示、固定报错和无滚动布局。

规范化Git blob：`be11d623769e1399ff43cd89861979e1874740aa`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -1 +0,0 @@` | −1 / +0 | 旧：`import { X } from './icons';` |
| H002 | `@@ -3,4 +1,0 @@ import { InterviewPreview } from './InterviewPreview';` | −4 / +0 | 旧：`import { Button } from './ui/button'; import { useAuth } from '../stores/auth';` |
| H003 | `@@ -7,0 +3,2 @@ import { AppLogo } from './AppLogo';` | −0 / +2 | 新：`import { CloudAccountPanel } from './CloudAccountPanel'; import { useState } from 'react';` |
| H004 | `@@ -9 +6 @@ export function LoginPage() {` | −1 / +1 | 旧：`const auth = useAuth();`<br>新：`const [mode, setMode] = useState<'login' \| 'register' \| 'reset'>('login');` |
| H005 | `@@ -14,7 +11,3 @@ export function LoginPage() {` | −7 / +3 | 旧：`<div className="login-copy"> <div className="login-brand">`<br>新：`<div className="login-brand"> <AppLogo size={28} />` |
| H006 | `@@ -22,39 +15,7 @@ export function LoginPage() {` | −39 / +7 | 旧：`<div className="login-actions"> {(`<br>新：`<div className="login-auth-content"> <div className="login-copy">` |
| H007 | `@@ -63,2 +24 @@ export function LoginPage() {` | −2 / +1 | 旧：`<p>登录后即可准备聊天与面试回答，语音在本机转写。</p> <small>凭据由本机系统加密保护，密码仅在所选服务的官方页面输入。</small>`<br>新：`<small>登录凭据由本机系统加密保护。</small>` |

### F042 · `shared/src/components/PersonalInfoPanel.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/PersonalInfoPanel.tsx)

个人信息云标志与圆形尺寸，固定内容宽度、标题/滚动条避让。

规范化Git blob：`cda23cc30175f23418b7edd6ae0609a2ca081d42`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { SyncBadge } from './SyncBadge';` |
| H002 | `@@ -242 +243,4 @@ export function PersonalInfoPanel({` | −1 / +4 | 旧：`<h2>个人信息</h2>`<br>新：`<h2 className="sync-title"> 个人信息` |

### F043 · `shared/src/components/PreparationPage.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/PreparationPage.tsx)

开始面试摘要增加余额，少于15分钟红色，错误去包装、资料提示居中。

规范化Git blob：`314de9b4c3dd54736445f298067bd02011b8a68d`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -2 +2 @@ import { useTextareaSize } from './useTextareaSize';` | −1 / +1 | 旧：`import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';`<br>新：`import { useEffect, useLayoutEffect, useRef, useState } from 'react';` |
| H002 | `@@ -3,0 +4 @@ import { componentReady, useComponentReady } from '../stores/components';` | −0 / +1 | 新：`import { userError } from '../services/errors';` |
| H003 | `@@ -50,0 +52,2 @@ import { useModelProvider } from './useModelProvider';` | −0 / +2 | 新：`import { useCloudUsage } from '../stores/cloudUsage'; import { isLowInterviewCredit } from '../../electron/contracts/cloudUsage';` |
| H004 | `@@ -78,0 +82 @@ export function PreparationPage({` | −0 / +1 | 新：`const quota = useCloudUsage();` |
| H005 | `@@ -157,0 +162,13 @@ export function PreparationPage({` | −0 / +13 | 新：`useLayoutEffect(() => { const layout = layoutRef.current;` |
| H006 | `@@ -249,0 +267 @@ export function PreparationPage({` | −0 / +1 | 新：`void useCloudUsage.getState().run({ action: 'status' });` |
| H007 | `@@ -408,3 +426 @@ export function PreparationPage({` | −3 / +1 | 旧：`setInterviewError( error instanceof Error ? error.message : '面试窗口打开失败，请重试。',`<br>新：`setInterviewError(userError(error, '面试窗口打开失败，请重试。'));` |
| H008 | `@@ -433,0 +450,12 @@ export function PreparationPage({` | −0 / +12 | 新：`<div className="interview-start-quota"> <dt>剩余面试时长</dt>` |
| H009 | `@@ -575,3 +602,0 @@ export function PreparationPage({` | −3 / +0 | 旧：`style={ { '--personal-panel-width': ˋmin(${panelWidth}px, calc(100% - 260px))ˋ } as CSSProperties` |

### F044 · `shared/src/components/SettingsDialog.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/SettingsDialog.tsx)

默认账号，按账号/云/AI/组件/面试/个性化/关于更新排序，固定标题避让轨道。

规范化Git blob：`61b10acdfcaf7fffe5bc77c97accc6ac779555ab`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -1,0 +2,4 @@ import { useState } from 'react';` | −0 / +4 | 新：`import { CloudAccountPanel } from './CloudAccountPanel'; import { SyncSettingsPanel } from './SyncSettingsPanel';` |
| H002 | `@@ -7 +11,2 @@ import {` | −1 / +2 | 旧：`Database,`<br>新：`Cloud, Sparkles,` |
| H003 | `@@ -15 +19,0 @@ import {` | −1 / +0 | 旧：`Update,` |
| H004 | `@@ -20 +23,0 @@ import { Button } from './ui/button';` | −1 / +0 | 旧：`import { UsagePanel } from './UsagePanel';` |
| H005 | `@@ -23 +25,0 @@ import { ComponentsPanel } from './ComponentsPanel';` | −1 / +0 | 旧：`import { providerInfo } from '../services/providers';` |
| H006 | `@@ -28 +29,0 @@ import { useChatConnection } from '../stores/chatConnection';` | −1 / +0 | 旧：`import { useAuth } from '../stores/auth';` |
| H007 | `@@ -33 +33,0 @@ export type Theme = 'light' \| 'dark' \| 'system';` | −1 / +0 | 旧：`const platformLabels = { macos: 'macOS', windows: 'Windows', unknown: '未知平台' };` |
| H008 | `@@ -35 +35,3 @@ const categories = [` | −1 / +3 | 旧：`{ id: 'general', label: '个性化', Icon: Appearance },`<br>新：`{ id: 'account', label: 'VoxCue 账号', Icon: Person }, { id: 'sync', label: '云同步', Icon: Cloud },` |
| H009 | `@@ -37 +38,0 @@ const categories = [` | −1 / +0 | 旧：`{ id: 'account', label: '账户与用量', Icon: Person },` |
| H010 | `@@ -39,2 +40,2 @@ const categories = [` | −2 / +2 | 旧：`{ id: 'updates', label: '更新', Icon: Update }, { id: 'about', label: '关于', Icon: CircleHelp },`<br>新：`{ id: 'general', label: '个性化', Icon: Appearance }, { id: 'about', label: '关于与更新', Icon: CircleHelp },` |
| H011 | `@@ -42 +43 @@ const categories = [` | −1 / +1 | 旧：`export type SettingsCategory = (typeof categories)[number]['id'];`<br>新：`export type SettingsCategory = (typeof categories)[number]['id'] \| 'updates';` |
| H012 | `@@ -53 +54 @@ export function SettingsDialog({` | −1 / +1 | 旧：`initialCategory = 'general',`<br>新：`initialCategory = 'account',` |
| H013 | `@@ -60 +61,3 @@ export function SettingsDialog({` | −1 / +3 | 旧：`const [category, setCategory] = useState<SettingsCategory>(initialCategory);`<br>新：`const [category, setCategory] = useState<Exclude<SettingsCategory, 'updates'>>( initialCategory === 'updates' ? 'about' : initialCategory,` |
| H014 | `@@ -62 +64,0 @@ export function SettingsDialog({` | −1 / +0 | 旧：`const session = useAuth((state) => state.session);` |
| H015 | `@@ -65 +66,0 @@ export function SettingsDialog({` | −1 / +0 | 旧：`const accountProvider = providerInfo(session?.mode);` |
| H016 | `@@ -106 +106,0 @@ export function SettingsDialog({` | −1 / +0 | 旧：`{category === 'updates' && <UpdatesPanel />}` |
| H017 | `@@ -157,14 +157,2 @@ export function SettingsDialog({` | −14 / +2 | 旧：`<div className="settings-entry settings-account"> <div>`<br>新：`<CloudAccountPanel showTitle={false} /> <CloudUsagePanel />` |
| H018 | `@@ -172,0 +161,2 @@ export function SettingsDialog({` | −0 / +2 | 新：`{category === 'ai' && <AIServicePanel />} {category === 'sync' && <SyncSettingsPanel />}` |
| H019 | `@@ -196,13 +186,3 @@ export function SettingsDialog({` | −13 / +3 | 旧：`<div className="settings-entry"> <strong>平台</strong>`<br>新：`<section className="settings-about-updates" aria-label="软件更新"> <UpdatesPanel showVersion={false} />` |

### F045 · `shared/src/components/Sidebar.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/Sidebar.tsx)

邮箱+剩余额度、小于15分钟红色；最窄尺寸完整显示、开合不挤压内容。

规范化Git blob：`18f20252594b947b6d62e7a480fba76734409c75`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -2 +2,4 @@ import * as DropdownMenu from './ui/dropdown-menu';` | −1 / +4 | 旧：`import { useState } from 'react';`<br>新：`import { useEffect, useState } from 'react'; import { useCloudUsage } from '../stores/cloudUsage';` |
| H002 | `@@ -46,0 +50,23 @@ export function Sidebar({` | −0 / +23 | 新：`const quota = useCloudUsage(); const userId = useCloudAccount((s) => s.state.user?.id);` |
| H003 | `@@ -171,2 +197,6 @@ export function Sidebar({` | −2 / +6 | 旧：`<strong>{userName}</strong> <small>{accountLabel}</small>`<br>新：`<strong title={accountLabel}>{accountLabel}</strong> <small` |

### F046 · `shared/src/components/SyncBadge.tsx`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/components/SyncBadge.tsx)

云状态浮层、正在同步只取消、暂停后自动同步、云删除确认及可点击层级。

规范化Git blob：`5e6c2a7a7684b6bb48f3c0091fcbe1f444c579b5`。

完整新增块：`@@ -0,0 +1,232 @@`，新增232行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 9 | 变量/函数 | `labels` |
| 19 | function | `SyncBadge` |

### F047 · `shared/src/components/SyncSettingsPanel.tsx`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/components/SyncSettingsPanel.tsx)

默认关闭的三类开关、实时容量、分开的立即同步和刷新容量、精简说明。

规范化Git blob：`6e19960c19cfb06ab6ec072b2baebc0df2737582`。

完整新增块：`@@ -0,0 +1,76 @@`，新增76行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 7 | function | `SyncSettingsPanel` |

### F048 · `shared/src/components/UpdatesPanel.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/UpdatesPanel.tsx)

与关于合并，删除平台/本地存储/重复版本行，保留更新入口。

规范化Git blob：`a608fffa715ba0b05ba8686878e2e286efd4077e`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -7 +7 @@ import { ActionTransition } from './ActionTransition';` | −1 / +1 | 旧：`export function UpdatesPanel() {`<br>新：`export function UpdatesPanel({ showVersion = true }: { showVersion?: boolean } = {}) {` |
| H002 | `@@ -35,4 +35,6 @@ export function UpdatesPanel() {` | −4 / +6 | 旧：`<div className="settings-entry"> <strong>当前版本</strong>`<br>新：`{showVersion && ( <div className="settings-entry">` |

### F049 · `shared/src/components/icons.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/icons.tsx)

Fluent云状态图标及Windows Loader统一旋转，保留Mac映射接口。

规范化Git blob：`616baf43e65467a200d1b6883e97a72b93bcf711`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -56,0 +57,5 @@ import {` | −0 / +5 | 新：`Cloud24Regular, CloudCheckmark24Regular,` |
| H002 | `@@ -64,0 +70 @@ function icon(` | −0 / +1 | 新：`className?: string;` |
| H003 | `@@ -65,0 +72 @@ function icon(` | −0 / +1 | 新：`loading = false,` |
| H004 | `@@ -70,0 +78 @@ function icon(` | −0 / +1 | 新：`className={loading ? 'ui-loader' : undefined}` |
| H005 | `@@ -85 +93 @@ export const PanelRight = icon(PanelRightExpandRegular);` | −1 / +1 | 旧：`export const Loader = icon(SpinnerIos20Regular);`<br>新：`export const Loader = icon(SpinnerIos20Regular, true);` |
| H006 | `@@ -92,0 +101,5 @@ export const Database = icon(Database24Regular);` | −0 / +5 | 新：`export const Cloud = icon(Cloud24Regular); export const CloudDone = icon(CloudCheckmark24Regular);` |

### F050 · `shared/src/components/ui/confirm-delete-button.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/ui/confirm-delete-button.tsx)

删除点击可用性、同步竞争和已有二次确认/取消保护。

规范化Git blob：`36ae1b3683248e05d7606459bfc46832b2303466`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -157 +157,3 @@ export function ConfirmDeleteButton(props: Props) {` | −1 / +3 | 旧：`return <ConfirmActionButton {...props} iconOnly action="删除" icon={Trash} />;`<br>新：`return ( <ConfirmActionButton {...props} iconOnly={props.iconOnly ?? true} action="删除" icon={Trash} />` |

### F051 · `shared/src/components/ui/modal.tsx`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/components/ui/modal.tsx)

固定标题与滚动轨道可共享的布局参数，保留透明面试弹层。

规范化Git blob：`83aaef6c2eabc3068e9f0c0bb737e44ed9754a7b`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -65,0 +66,4 @@ export function Modal({` | −0 / +4 | 新：`dialog.style.setProperty( '--dialog-scrollbar-width',` |

### F052 · `shared/src/platform/webMaterials.css`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/platform/webMaterials.css)

统一固定标题材质及滚动轨道留位，撤销冲突的高优先级旧规则。

规范化Git blob：`777e8c12ecb4baabe39f6a380f018c1e52b3f10c`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -18,0 +19,11 @@` | −0 / +11 | 新：`/* Both management lists scroll behind their fixed toolbar. Keep its material out of the scrollbar gutter and start the thumb below the measured header. */` |
| H002 | `@@ -24 +35 @@` | −1 / +1 | 旧：`.record-transcript-scroll::-webkit-scrollbar-track:vertical {`<br>新：`.record-transcript-scroll::-webkit-scrollbar-track {` |
| H003 | `@@ -235,0 +247 @@` | −0 / +1 | 新：`max-width: calc(100% - var(--panel-scrollbar-width, 0px));` |
| H004 | `@@ -253,0 +266,38 @@` | −0 / +38 | 新：`.web-materials .settings-content-heading::before { content: '';` |
| H005 | `@@ -353 +403 @@` | −1 / +1 | 旧：`.web-materials .floating-panels .floating-scroll::-webkit-scrollbar-track:vertical {`<br>新：`.web-materials .floating-panels .floating-scroll::-webkit-scrollbar-track {` |

### F053 · `shared/src/platform/webMaterials.ts`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/platform/webMaterials.ts)

按实际滚动宿主和标题测量覆盖高度/轨道，不让模糊遮住滚动条。

规范化Git blob：`22aa8782f19d7787a10bb8c910413b8e4b168245`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -23,0 +24,23 @@ export function installWebMaterials() {` | −0 / +23 | 新：`if ( workspace instanceof HTMLElement &&` |
| H002 | `@@ -25 +48 @@ export function installWebMaterials() {` | −1 / +1 | 旧：`'.personal-panel, .record-answer-panel',`<br>新：`'.personal-panel, .record-answer-panel, .settings-content',` |
| H003 | `@@ -29 +52 @@ export function installWebMaterials() {` | −1 / +1 | 旧：`':scope > .personal-panel-scroll, :scope > .record-answer-scroll',`<br>新：`':scope > .personal-panel-scroll, :scope > .record-answer-scroll, :scope > .settings-content-body',` |
| H004 | `@@ -36,0 +60,5 @@ export function installWebMaterials() {` | −0 / +5 | 新：`setProperty( panel,` |

### F054 · `shared/src/services/cloudData.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/services/cloudData.ts)

本地三类数据打包、UTF8字节计量、图片/文件安全条目、导入恢复及包验证。

规范化Git blob：`27e36b4770f6dc05043ebff0a33e19e8e5dd29d7`。

完整新增块：`@@ -0,0 +1,252 @@`，新增252行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 14 | type | `LocalSyncItem` |
| 22 | class | `CloudDataConflict` |
| 23 | 变量/函数 | `id` |
| 27 | 变量/函数 | `finite` |
| 29 | 变量/函数 | `profileKey` |
| 30 | 变量/函数 | `emptyProfile` |
| 31 | type | `Header` |
| 32 | function | `packCloudItem` |
| 41 | function | `unpackCloudItem` |
| 54 | function | `digestCloudBlob` |
| 59 | function | `jsonItem` |
| 63 | function | `localCloudItems` |
| 120 | function | `fileItem` |
| 133 | function | `applyCloudItem` |

### F055 · `shared/src/services/cloudLifecycle.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/services/cloudLifecycle.ts)

账号/本地变化/主窗与面试结束间同步生命周期，清理订阅和迟到任务。

规范化Git blob：`4a2e6e51ce3e95e39335204d2c79618211e1773b`。

完整新增块：`@@ -0,0 +1,10 @@`，新增10行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 1 | 变量/函数 | `shutdown` |
| 2 | function | `registerCloudShutdown` |
| 8 | function | `stopCloudWork` |

### F056 · `shared/src/services/cloudSync.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/services/cloudSync.ts)

渲染层有界同步计划、profile优先、知识库分组及客户端端口消费。

规范化Git blob：`97d4dfabc5bb5b61c7ca693ff391f6ee791dc842`。

完整新增块：`@@ -0,0 +1,884 @@`，新增884行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 15 | type | `SyncStatus` |
| 17 | type | `SyncMark` |
| 22 | type | `SyncBaseline` |
| 29 | type | `SyncPreferences` |
| 33 | type | `PendingUpload` |
| 40 | type | `SyncSaved` |
| 45 | type | `SyncView` |
| 52 | 变量/函数 | `defaultSyncPreferences` |
| 56 | 变量/函数 | `keyValid` |
| 58 | 变量/函数 | `shaValid` |
| 59 | 变量/函数 | `uuidValid` |
| 61 | 变量/函数 | `number` |
| 63 | class | `SyncFailure` |
| 72 | class | `SyncYield` |
| 74 | function | `readSyncSaved` |
| 117 | function | `decideSync` |
| 132 | class | `CloudSyncEngine` |
| 133 | 成员 | `saved` |
| 134 | 成员 | `marks` |
| 135 | 成员 | `remote` |
| 136 | 成员 | `sources` |
| 137 | 成员 | `storage` |
| 138 | 成员 | `stopped` |
| 139 | 成员 | `running` |
| 140 | 成员 | `controlPending` |
| 141 | 成员 | `controlActive` |
| 142 | 成员 | `deleting` |
| 143 | 成员 | `pausing` |
| 144 | 成员 | `storageDirty` |
| 145 | 成员 | `storageReadAfter` |
| 146 | 成员 | `pending` |
| 147 | 成员 | `failed` |
| 148 | 成员 | `error` |
| 149 | 成员 | `blockedUntil` |
| 150 | 成员 | `dataEpoch` |
| 171 | 成员 | `guard` |
| 175 | 成员 | `emit` |
| 234 | 成员 | `mark` |
| 238 | 成员 | `persist` |
| 243 | 成员 | `configure` |
| 253 | 成员 | `stop` |
| 257 | 成员 | `idle` |
| 260 | 成员 | `dirty` |
| 267 | 成员 | `request` |
| 294 | 成员 | `call` |
| 315 | 成员 | `refresh` |
| 359 | 成员 | `refreshUsage` |
| 377 | 成员 | `loadSources` |
| 386 | 成员 | `cycle` |
| 407 | 成员 | `orderedKeys` |
| 439 | 成员 | `groupKeys` |
| 454 | 成员 | `keyKind` |
| 461 | 成员 | `profileFirst` |
| 470 | 成员 | `id` |
| 480 | 成员 | `one` |
| 751 | 成员 | `exclusive` |
| 773 | 成员 | `resolve` |
| 782 | 成员 | `refreshStorage` |
| 788 | 成员 | `suspendGroup` |
| 855 | 成员 | `removeCloud` |
| 858 | 成员 | `pause` |
| 861 | 成员 | `resume` |

### F057 · `shared/src/services/errors.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/services/errors.ts)

移除已知Electron transport包装、保留实际业务错误及安全fallback。

规范化Git blob：`ba113cf1a0352b4d69d17b76b7bc6472c491eeaf`。

完整新增块：`@@ -0,0 +1,11 @@`，新增11行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 2 | function | `userError` |

### F058 · `shared/src/services/history.ts`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/services/history.ts)

记录保存/编辑/删除通知同步，无需将云逻辑写入本地存储实现。

规范化Git blob：`1036d648a77db2f64b4ff228091eca05fa1cb7e8`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -1,0 +2 @@ import type { Answer, Transcript } from './contracts';` | −0 / +1 | 新：`import { localChanged } from './localChanges';` |
| H002 | `@@ -149,3 +150,12 @@ export const localHistory: HistoryService = {` | −3 / +12 | 旧：`save: (record) => createHistoryService(localStorage).save(record), remove: (id) => createHistoryService(localStorage).remove(id),`<br>新：`save: (record) => { createHistoryService(localStorage).save(record);` |

### F059 · `shared/src/services/knowledge.ts`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/services/knowledge.ts)

库/文件变化事件、安全导出恢复、全库删除子项与已有本地资料保留。

规范化Git blob：`d206d670c530f97e03ef682f116ec6cca2bf154f`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -1,0 +2 @@ import { deactivateOriginal } from './knowledgeIndex';` | −0 / +1 | 新：`import { localChanged } from './localChanges';` |
| H002 | `@@ -40,0 +42 @@ async function transaction<T>(` | −0 / +1 | 新：`if (mode === 'readwrite') localChanged('knowledgebase');` |
| H003 | `@@ -71 +73,5 @@ export const localKnowledge: KnowledgeManagementService = {` | −1 / +5 | 旧：`tx.objectStore('bases').put({ ...base, name: base.name.trim() });`<br>新：`tx.objectStore('bases').put({ ...base,` |
| H004 | `@@ -124,0 +131 @@ export const localKnowledge: KnowledgeManagementService = {` | −0 / +1 | 新：`localRevision: crypto.randomUUID(),` |
| H005 | `@@ -145,0 +153,80 @@ export const localKnowledge: KnowledgeManagementService = {` | −0 / +80 | 新：`/** Originals only. Local parser/vector/model caches are never part of cloud sync. */ export async function syncKnowledgeSnapshot() {` |

### F060 · `shared/src/services/knowledgeTypes.ts`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/services/knowledgeTypes.ts)

同步所需的库/文件元数据类型，不增加第二套数据库。

规范化Git blob：`1ba906ade340dd36d9fe9eb5115b4e33e730ee6d`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -5,0 +6 @@ export interface KnowledgeBase {` | −0 / +1 | 新：`localRevision?: string;` |
| H002 | `@@ -14,0 +16 @@ export interface LocalDocument {` | −0 / +1 | 新：`localRevision?: string;` |

### F061 · `shared/src/services/localChanges.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/services/localChanges.ts)

解耦本地数据变化发布/订阅和revision提示，避免存储模块直接依赖云UI。

规范化Git blob：`f8c141259a37c45b0aa64a85787ef61249f618ac`。

完整新增块：`@@ -0,0 +1,9 @@`，新增9行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 2 | function | `localChanged` |

### F062 · `shared/src/stores/chatConnection.ts`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/stores/chatConnection.ts)

AI错误由设置负责展示，移除窗口底部重复提示。

规范化Git blob：`a24d30be37cd0deb27f436cfa0511f934bb8b1d3`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -14 +14 @@ interface State {` | −1 / +1 | 旧：`load(live: boolean, force?: boolean): Promise<void>;`<br>新：`load(live: boolean, force?: boolean, demo?: boolean): Promise<void>;` |
| H002 | `@@ -27 +27 @@ export const useChatConnection = create<State>((set, get) => ({` | −1 / +1 | 旧：`async load(live, force = false) {`<br>新：`async load(live, force = false, demo = false) {` |
| H003 | `@@ -34 +34 @@ export const useChatConnection = create<State>((set, get) => ({` | −1 / +1 | 旧：`models: [...chatModels],`<br>新：`models: demo ? [...chatModels] : [],` |

### F063 · `shared/src/stores/cloudAccount.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/stores/cloudAccount.ts)

主账号状态、challenge/登录/退出/恢复动作与并发/迟到保护。

规范化Git blob：`075b75b981dd6b5e53db8157960a4501ef254559`。

完整新增块：`@@ -0,0 +1,43 @@`，新增43行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 9 | type | `AccountStore` |
| 16 | 变量/函数 | `loading` |
| 17 | 变量/函数 | `useCloudAccount` |

### F064 · `shared/src/stores/cloudSync.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/stores/cloudSync.ts)

同步快照、三开关、逐项暂停/恢复/云删除及实时用量状态。

规范化Git blob：`e035811d140260f9435305b6d404531b29a70c3a`。

完整新增块：`@@ -0,0 +1,200 @@`，新增200行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 14 | type | `SyncStore` |
| 26 | function | `syncDatabase` |
| 48 | 变量/函数 | `engine` |
| 49 | 变量/函数 | `generation` |
| 50 | 变量/函数 | `activeUserId` |
| 51 | 变量/函数 | `useCloudSync` |

### F065 · `shared/src/stores/cloudUsage.ts`

**A · 共用客户端：Mac同步验证**　[打开文件](../src/stores/cloudUsage.ts)

额度读取/兑换/租约快照和剩余时间派生，防止迟到请求覆盖。

规范化Git blob：`e9aee5fe14d9e6517763074bc08fa558030ea8f9`。

完整新增块：`@@ -0,0 +1,44 @@`，新增44行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 5 | type | `UsageState` |
| 13 | 变量/函数 | `generation` |
| 14 | 变量/函数 | `useCloudUsage` |

### F066 · `shared/src/stores/interview.ts`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/stores/interview.ts)

开始和结束租约、在途结束合并、尾段转写冲刷、空记录保存、写盘失败保留可重试。

规范化Git blob：`767487314f4780e214230e490c23e39e83a6d305`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -59 +59 @@ interface InterviewState {` | −1 / +1 | 旧：`archive(status: 'ended' \| 'interrupted'): void;`<br>新：`archive(status: 'ended' \| 'interrupted', preserveEmpty?: boolean): void;` |
| H002 | `@@ -62 +62 @@ interface InterviewState {` | −1 / +1 | 旧：`end(): Promise<void>;`<br>新：`end(options?: { preserveEmpty?: boolean; generateTitle?: boolean }): Promise<void>;` |
| H003 | `@@ -71,0 +72,7 @@ let finishingSession: string \| null = null;` | −0 / +7 | 新：`let endingOperation: \| {` |
| H004 | `@@ -318 +325 @@ export const useInterview = create<InterviewState>((set, get) => ({` | −1 / +1 | 旧：`archive(status) {`<br>新：`archive(status, preserveEmpty = false) {` |
| H005 | `@@ -323 +330 @@ export const useInterview = create<InterviewState>((set, get) => ({` | −1 / +1 | 旧：`(!state.transcripts.length && !state.answers.length)`<br>新：`(!preserveEmpty && !state.transcripts.length && !state.answers.length)` |
| H006 | `@@ -622,3 +629 @@ export const useInterview = create<InterviewState>((set, get) => ({` | −3 / +1 | 旧：`async end() { get().clearScreenshots();`<br>新：`end(options) {` |
| H007 | `@@ -626,22 +631,4 @@ export const useInterview = create<InterviewState>((set, get) => ({` | −22 / +4 | 旧：`stop(); get().stopAnswer();`<br>新：`if (endingOperation?.sessionId === sessionId) { if (options?.preserveEmpty) endingOperation.options.preserveEmpty = true;` |
| H008 | `@@ -649,10 +636,42 @@ export const useInterview = create<InterviewState>((set, get) => ({` | −10 / +42 | 旧：`set({ status: 'ended', generating: false, endedAt: get().endedAt ?? Date.now() }); get().archive('ended');`<br>新：`const policy = { ...options }; const promise = (async () => {` |

### F067 · `shared/src/stores/preparation.ts`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/stores/preparation.ts)

资料更改向解耦变化端口发出通知，优先同步更新。

规范化Git blob：`cb8b8d864c1325685cd78c191da7a8700ca0eb4c`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -1,0 +2 @@ import { create } from 'zustand';` | −0 / +1 | 新：`import { localChanged } from '../services/localChanges';` |
| H002 | `@@ -363,0 +365 @@ export const usePreparation = create<PreparationState>((set, get) => ({` | −0 / +1 | 新：`localChanged('profile');` |

### F068 · `shared/src/styles.css`

**M · 共用客户端：Mac同步验证**　[打开文件](../src/styles.css)

全部登录、设置、云浮层/容量、低额提示、圆形按钮、固定标题/滚动条、窄侧栏和动画样式。

规范化Git blob：`6dfb434db595391b5ce65a99e32a9d4a7aa8bb0b`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -1,0 +2,79 @@` | −0 / +79 | 新：`.cloud-account-panel { display: grid;` |
| H002 | `@@ -218 +297,2 @@ p {` | −1 / +2 | 旧：`width: 230px;`<br>新：`--sidebar-expanded-width: 230px; width: var(--sidebar-expanded-width);` |
| H003 | `@@ -224,0 +305,6 @@ p {` | −0 / +6 | 新：`overflow: clip; }` |
| H004 | `@@ -970 +1056 @@ p {` | −1 / +1 | 旧：`width: 200px;`<br>新：`--sidebar-expanded-width: 200px;` |
| H005 | `@@ -1242 +1328 @@ p {` | −1 / +1 | 旧：`inset: 0 0 auto;`<br>新：`inset: 0 var(--dialog-scrollbar-width, 0px) auto 0;` |
| H006 | `@@ -2311 +2397 @@ p {` | −1 / +1 | 旧：`overflow: auto;`<br>新：`overflow: hidden;` |
| H007 | `@@ -2341,31 +2426,0 @@ p {` | −31 / +0 | 旧：`.login-copy p { color: var(--muted);` |
| H008 | `@@ -2375,5 +2429,0 @@ p {` | −5 / +0 | 旧：`.login-actions .service-brand-icon { width: 22px;` |
| H009 | `@@ -2383,7 +2432,0 @@ p {` | −7 / +0 | 旧：`.login-status { font-size: var(--type-body);` |
| H010 | `@@ -2394,6 +2436,0 @@ p {` | −6 / +0 | 旧：`.login-footer p { font-size: var(--type-secondary);` |
| H011 | `@@ -2462,0 +2500,16 @@ p {` | −0 / +16 | 新：`.interview-end-notice { position: fixed;` |
| H012 | `@@ -3136,0 +3190,3 @@ p {` | −0 / +3 | 新：`position: relative; display: flex;` |
| H013 | `@@ -3138,2 +3194,3 @@ p {` | −2 / +3 | 旧：`overflow-y: auto; padding: 24px;`<br>新：`min-height: 0; overflow: hidden;` |
| H014 | `@@ -3143,2 +3200,16 @@ p {` | −2 / +16 | 旧：`padding-bottom: 18px; border-bottom: 1px solid var(--border);`<br>新：`position: relative; flex-shrink: 0;` |
| H015 | `@@ -3698,3 +3768,0 @@ p {` | −3 / +0 | 旧：`.interview-start-summary > .interview-start-knowledge { grid-column: 1 / -1;` |
| H016 | `@@ -3715,0 +3784,4 @@ p {` | −0 / +4 | 新：`.interview-start-summary .interview-quota-low, .user-info .interview-quota-low {` |
| H017 | `@@ -4086,0 +4159,8 @@ details[open] > summary > .disclosure-chevron {` | −0 / +8 | 新：`.floating-usage-notice { display: flex;` |
| H018 | `@@ -4899,0 +4980,8 @@ details[open] > summary > .disclosure-chevron {` | −0 / +8 | 新：`.personal-panel > :is(header, .personal-panel-scroll, .personal-save-bar) { width: calc(var(--personal-panel-width, 380px) - 2px);` |
| H019 | `@@ -5540,0 +5629,2 @@ details[open] > summary > .disclosure-chevron {` | −0 / +2 | 新：`width: fit-content; max-width: min(100%, 620px);` |
| H020 | `@@ -5543,2 +5633,2 @@ details[open] > summary > .disclosure-chevron {` | −2 / +2 | 旧：`padding: 12px; margin: 12px 0;`<br>新：`padding: 8px 12px; margin: 10px auto;` |
| H021 | `@@ -5546,0 +5637 @@ details[open] > summary > .disclosure-chevron {` | −0 / +1 | 新：`line-height: 1.5;` |
| H022 | `@@ -5553 +5644 @@ details[open] > summary > .disclosure-chevron {` | −1 / +1 | 旧：`margin-top: 10px;`<br>新：`margin-top: 8px;` |
| H023 | `@@ -5628,2 +5718,0 @@ h4,` | −2 / +0 | 旧：`.login-copy > p, .login-footer p,` |
| H024 | `@@ -6054,0 +6144,51 @@ small {` | −0 / +51 | 新：`.download-button:not(.is-icon-only) { width: var(--download-idle-width, 96px);` |
| H025 | `@@ -6849,0 +6990,467 @@ svg[data-ui-icon] {` | −0 / +467 | 新：`/* Cloud controls reuse the existing neutral, rounded desktop controls. */ .ai-service-label,` |

### F069 · `shared/test/README.md`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/README.md)

记录云功能专项、服务端只读夹具、Windows完整矩阵及Mac接续入口。

规范化Git blob：`83070b4ec16274d208c6c9b544f5fc7baf8e9820`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -1 +1,11 @@` | −1 / +11 | 旧：`# 当前测试入口（2026-10-25）`<br>新：`# 当前测试入口（2026-10-27） 客户端完整矩阵在本平台目录执行 ˋnode ../shared/test/scripts/functional-suite.mjsˋ，包含49组：邮箱主账号、独立ChatGPT/Copilot授权、聊天/资料/知识库/RAG/记录/更新/组件、功能与对抗、服务端0.5.1连接、云同步及配额到期保存、浅深色与窄窗口、20轮面试及10分钟双` |
| H002 | `@@ -7 +17 @@ Mac 0.5.11 的 Loader 保留 AppKit 生成的 SF Symbols 形状，使用逐段` | −1 / +1 | 旧：`Windows ˋtest:ui:dpiˋ 当前逐档执行14组，包含新增 ˋinterview-chromeˋ 和 ˋinterview-motionˋ；100/125/150/175/200% 共70组，仍沿用同一隔离模型生命周期并串行。共享45组功能矩阵的外层 watchdog 调整为四小时，子项原有超时保持，避免十分钟耐久段挤占整组预算。分数DPI下工具栏边距按一物理像素`<br>新：`Windows ˋtest:ui:dpiˋ 当前逐档执行14组，包含新增 ˋinterview-chromeˋ 和 ˋinterview-motionˋ；100/125/150/175/200% 共70组，仍沿用同一隔离模型生命周期并串行。共享49组功能矩阵的外层 watchdog 调整为四小时，子项原有超时保持，避免十分钟耐久段挤占整组预算。分数DPI下工具栏边距按一物理像素` |

### F070 · `shared/test/fixtures/install-primary-account.cjs`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/fixtures/install-primary-account.cjs)

隔离合成主账号夹具，验证userData所有权且无正式凭据/测试后门。

规范化Git blob：`8f615e891b53b926116fcfe68c39021e27122d89`。

完整新增块：`@@ -0,0 +1,79 @@`，新增79行。

### F071 · `shared/test/scripts/adversarial-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/adversarial-smoke.mjs)

共用 adversarial-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`9b0bdc85abe5d953391f4854f6cbdc87c2c31527`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -46,4 +47 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |

### F072 · `shared/test/scripts/assert-download-button.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/assert-download-button.mjs)

共用 assert-download-button.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`fbb5a5e063b6dea1ae2d3f792ab501bd2e25dd57`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -67 +67 @@ export async function assertInitialDownloadProgress(button, start) {` | −1 / +1 | 旧：`if (hoverLabel) {`<br>新：`{` |
| H002 | `@@ -82 +82,10 @@ export async function assertInitialDownloadProgress(button, start) {` | −1 / +10 | 旧：`else assert.equal(finalBounds.width, initialBounds.width);`<br>新：`else { const cancelWidth = await button.evaluate((element) =>` |
| H003 | `@@ -162 +171,9 @@ export async function assertDownloadButton(page, button, { iconOnly = false, hov` | −1 / +9 | 旧：`else assert.equal(after.width, before.width);`<br>新：`else if (!iconOnly) { const cancelWidth = await button.evaluate((element) =>` |

### F073 · `shared/test/scripts/chat-lifecycle-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/chat-lifecycle-smoke.mjs)

共用 chat-lifecycle-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`8ad6a0f86903c8f682e8786a2d5f91bee512e6c0`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -71,4 +72 @@ async function launch() {` | −4 / +1 | 旧：`[page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`page = await connectUiAccount(app, login);` |
| H003 | `@@ -233,0 +232,4 @@ try {` | −0 / +4 | 新：`globalThis.restoreLogoutSend = () => { contents.send = send;` |
| H004 | `@@ -244,17 +246,8 @@ try {` | −17 / +8 | 旧：`const [login] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const loginOpened = app.waitForEvent('window'); await page.getByRole('button', { name: '退出登录', exact: true }).click();` |
| H005 | `@@ -262 +255,6 @@ try {` | −1 / +6 | 旧：`page = await nextMain;`<br>新：`assert.equal(page.isClosed(), false, 'Outgoing data stays available until save finishes'); assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);` |
| H006 | `@@ -265 +263 @@ try {` | −1 / +1 | 旧：`'explicit deletion survives restart; fast reauthentication waits for outgoing save, supports cancellation and preserves remaining chat',`<br>新：`'explicit deletion survives restart; primary logout waits for outgoing save before reopening the account gate, then preserves remaining chat',` |
| H007 | `@@ -270,0 +269 @@ try {` | −0 / +1 | 新：`console.error(error);` |
| H008 | `@@ -278 +277,4 @@ try {` | −1 / +4 | 旧：`if (app) await closeUiApp(app);`<br>新：`if (app) { await app.evaluate(() => globalThis.restoreLogoutSend?.()).catch(() => {});` |

### F074 · `shared/test/scripts/chat-progress-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/chat-progress-smoke.mjs)

共用 chat-progress-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`895451a3dca859d1bdec4e6745d79a278243eae1`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -270,4 +271 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |

### F075 · `shared/test/scripts/chat-response-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/chat-response-smoke.mjs)

共用 chat-response-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`bbac1f5cbf5f6804fac86d74478d2e583e976706`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { enterDemoUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -24 +25 @@ try {` | −1 / +1 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H003 | `@@ -26,4 +27 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const [page] = await Promise.all([app.waitForEvent('window'), enterDemoUiAccount(app, login)]);` |
| H004 | `@@ -197 +195,5 @@ try {` | −1 / +5 | 旧：`await page.getByRole('button', { name: '账户与用量', exact: true }).click();`<br>新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H005 | `@@ -241,0 +244,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H006 | `@@ -244 +250 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: '账户与用量', exact: true }).click();`<br>新：`await page.getByRole('button', { name: 'AI 服务', exact: true }).click();` |

### F076 · `shared/test/scripts/chatgpt-single-login-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/chatgpt-single-login-smoke.mjs)

共用 chatgpt-single-login-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`1026b9b6ff7e49688987bbb80229c123a70fc5b0`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -56 +57 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click();`<br>新：`await connectUiAccount(app, page);` |
| H003 | `@@ -71,0 +73,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H004 | `@@ -73 +78 @@ try {` | −1 / +1 | 旧：`await settings.getByRole('button', { name: '账户与用量', exact: true }).click();`<br>新：`await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();` |
| H005 | `@@ -102 +106,0 @@ try {` | −1 / +0 | 旧：`const loginOpened = app.waitForEvent('window');` |
| H006 | `@@ -103,0 +108,3 @@ try {` | −0 / +3 | 新：`assert.equal(await page.getByRole('button', { name: '用户菜单', exact: true }).isVisible(), true); const loginOpened = app.waitForEvent('window');` |
| H007 | `@@ -105 +112 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |

### F077 · `shared/test/scripts/cloud-account-smoke.mjs`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/cloud-account-smoke.mjs)

合成API/客户端端到端及登录、额度、滚动条专项分派。

规范化Git blob：`69dad00715b1ee02c9b96b4e4e02e924f1fa51a7`。

完整新增块：`@@ -0,0 +1,1070 @@`，新增1070行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 18 | 变量/函数 | `directory` |
| 19 | 变量/函数 | `loginCheck` |
| 21 | 变量/函数 | `quotaCheck` |
| 22 | 变量/函数 | `scrollbarCheck` |
| 23 | 变量/函数 | `quotaEpoch` |
| 24 | 变量/函数 | `quotaOffset` |
| 27 | 变量/函数 | `config` |
| 34 | 变量/函数 | `store` |
| 35 | 变量/函数 | `auth` |
| 36 | 变量/函数 | `messages` |
| 37 | 变量/函数 | `outbox` |
| 43 | 变量/函数 | `services` |
| 45 | 变量/函数 | `api` |
| 49 | 变量/函数 | `port` |
| 50 | 变量/函数 | `profile` |
| 51 | 变量/函数 | `fixture` |
| 107 | 变量/函数 | `env` |
| 115 | 变量/函数 | `app` |

### F078 · `shared/test/scripts/components-ui-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/components-ui-smoke.mjs)

共用 components-ui-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`55a3841b40a52a56f994536ecc76452204407c7c`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -66 +67,7 @@ const assertAnimated = (widths, label) => {` | −1 / +7 | 旧：`assert.ok(Math.abs(start - end) > 10, ˋ${label}: width must changeˋ);`<br>新：`if (Math.abs(start - end) <= 1) { assert.ok(` |
| H003 | `@@ -68 +75,3 @@ const assertAnimated = (widths, label) => {` | −1 / +3 | 旧：`widths.some((width) => width > Math.min(start, end) + 2 && width < Math.max(start, end) - 2),`<br>新：`widths.some( (width) => width > Math.min(start, end) + 0.1 && width < Math.max(start, end) - 0.1,` |
| H004 | `@@ -75 +84 @@ try {` | −1 / +1 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H005 | `@@ -77,4 +86 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H006 | `@@ -166,0 +173,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H007 | `@@ -397,0 +408,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H008 | `@@ -560,0 +575,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H009 | `@@ -638,0 +657,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H010 | `@@ -680,0 +703,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H011 | `@@ -718,0 +745,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H012 | `@@ -735,0 +766,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |

### F079 · `shared/test/scripts/composer-resize-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/composer-resize-smoke.mjs)

共用 composer-resize-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`dc054e0a34782c70cf65f872e84933faa121daba`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -17,5 +18,2 @@ try {` | −5 / +2 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor(); const [page] = await Promise.all([`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor(); const page = await connectUiAccount(app, login);` |

### F080 · `shared/test/scripts/composer-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/composer-smoke.mjs)

共用 composer-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`299058536d37a4efcb6e6e6bf7d2c58d4d8d542e`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { enterDemoUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -16 +17 @@ try {` | −1 / +1 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H003 | `@@ -18,4 +19 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const [page] = await Promise.all([app.waitForEvent('window'), enterDemoUiAccount(app, login)]);` |
| H004 | `@@ -116,0 +115,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |

### F081 · `shared/test/scripts/continuous-corners.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/continuous-corners.mjs)

round/squircle序列化转换为数学等价superellipse参数，像素与精度不断言降级。

规范化Git blob：`f1ee401de517092d727243956d58a06fa704b5e7`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -2,0 +3,9 @@ import assert from 'node:assert/strict';` | −0 / +9 | 新：`// Chromium may serialize these equivalent CSS curves as keywords or functions. export function cornerShapeNames(value) {` |

### F082 · `shared/test/scripts/conversations-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/conversations-smoke.mjs)

共用 conversations-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`62bcaf3c8bc8b2a03f1a5f306ce85d8e588feb8e`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { enterDemoUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -18 +19 @@ try {` | −1 / +1 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H003 | `@@ -20,4 +21 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const [page] = await Promise.all([app.waitForEvent('window'), enterDemoUiAccount(app, login)]);` |

### F083 · `shared/test/scripts/copilot-login-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/copilot-login-smoke.mjs)

共用 copilot-login-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`ec39e52a69ee2791ad4bd1458a7dd584722196c2`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { enterPrimaryUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -59,3 +60,12 @@ try {` | −3 / +12 | 旧：`let page = await app.firstWindow(); const copilot = page.getByRole('button', { name: '使用 GitHub Copilot 继续', exact: true });`<br>新：`let page = await enterPrimaryUiAccount(app, await app.firstWindow()); await page.getByRole('button', { name: '用户菜单', exact: true }).click();` |
| H003 | `@@ -63 +73 @@ try {` | −1 / +1 | 旧：`assert.equal(await page.locator('.service-login').count(), 2);`<br>新：`assert.equal(await page.locator('.ai-service-row').count(), 2);` |
| H004 | `@@ -67 +77 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: '取消登录', exact: true }).click();`<br>新：`await page.getByRole('button', { name: '取消授权', exact: true }).click();` |
| H005 | `@@ -73,2 +83 @@ try {` | −2 / +1 | 旧：`await page.waitForFunction(() => document.querySelector('.login-actions button')?.disabled); const mainOpened = app.waitForEvent('window');`<br>新：`await page.getByRole('button', { name: '取消授权', exact: true }).waitFor();` |
| H006 | `@@ -83 +92,7 @@ try {` | −1 / +7 | 旧：`const main = await mainOpened;`<br>新：`await page .locator('.ai-service-row')` |
| H007 | `@@ -99 +114 @@ try {` | −1 / +1 | 旧：`await settings.getByRole('button', { name: '账户与用量', exact: true }).click();`<br>新：`await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();` |
| H008 | `@@ -303 +317,0 @@ try {` | −1 / +0 | 旧：`const loginOpened = app.waitForEvent('window');` |
| H009 | `@@ -305,2 +319 @@ try {` | −2 / +1 | 旧：`page = await loginOpened; await page.getByRole('button', { name: '使用 GitHub Copilot 继续', exact: true }).waitFor();`<br>新：`assert.equal(await page.getByRole('button', { name: '用户菜单', exact: true }).isVisible(), true);` |
| H010 | `@@ -310,3 +323,2 @@ try {` | −3 / +2 | 旧：`const chatGPTOpened = app.waitForEvent('window'); await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click();`<br>新：`await page.evaluate(() => window.desktop.signInWithChatGPT()); await page.reload();` |
| H011 | `@@ -319,0 +332,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H012 | `@@ -321 +337 @@ try {` | −1 / +1 | 旧：`await chatGPTSettings.getByRole('button', { name: '账户与用量', exact: true }).click();`<br>新：`await chatGPTSettings.getByRole('button', { name: 'AI 服务', exact: true }).click();` |

### F084 · `shared/test/scripts/delete-controls-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/delete-controls-smoke.mjs)

共用 delete-controls-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`ed729857124bd7ba5084423d41f4fbd24f037e2e`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -130,4 +131 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H003 | `@@ -476 +474,4 @@ try {` | −1 / +4 | 旧：`await page.locator('.history-row').filter({ hasText: '合成面试记录' }).click();`<br>新：`await page .locator('.history-row')` |

### F085 · `shared/test/scripts/electron-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/electron-smoke.mjs)

共用 electron-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`43eec1e1063575287f801465b7efedfb6ee0d488`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { enterDemoUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -28 +29 @@ try {` | −1 / +1 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H003 | `@@ -30,4 +31 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const [page] = await Promise.all([app.waitForEvent('window'), enterDemoUiAccount(app, login)]);` |
| H004 | `@@ -50,0 +49,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H005 | `@@ -99 +101 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: '个人信息' }).click();`<br>新：`await page.getByRole('button', { name: '个人信息', exact: true }).click();` |
| H006 | `@@ -139 +141,5 @@ try {` | −1 / +5 | 旧：`await page.locator('.history-row').first().click();`<br>新：`await page .locator('.history-row')` |
| H007 | `@@ -194 +200 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: '个人信息' }).click();`<br>新：`await page.getByRole('button', { name: '个人信息', exact: true }).click();` |
| H008 | `@@ -196 +202 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: 'React 面试资料', exact: false }).click();`<br>新：`await page.locator('.knowledge-card').filter({ hasText: 'React 面试资料' }).click();` |
| H009 | `@@ -217 +223 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: 'React 面试资料', exact: false }).click();`<br>新：`await page.locator('.knowledge-card').filter({ hasText: 'React 面试资料' }).click();` |
| H010 | `@@ -242 +248,5 @@ try {` | −1 / +5 | 旧：`await page.locator('.history-row').filter({ hasText: '测试记录' }).click();`<br>新：`await page .locator('.history-row')` |
| H011 | `@@ -255 +265 @@ try {` | −1 / +1 | 旧：`await returnedLogin.getByRole('heading', { name: '欢迎使用 VoxCue' }).waitFor();`<br>新：`await returnedLogin.getByRole('heading', { name: '登录 VoxCue' }).waitFor();` |

### F086 · `shared/test/scripts/floating-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/floating-smoke.mjs)

共用 floating-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`2e41e70ea8db09e0fd63866e7bb20b515e355e9d`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -45,4 +46 @@ try {` | −4 / +1 | 旧：`const [main] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const main = await connectUiAccount(app, login);` |

### F087 · `shared/test/scripts/functional-suite.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/functional-suite.mjs)

增加四个云专项，保持交互桌面、鼠标、串行和超时保护。

规范化Git blob：`982c8c66f5b0207e0fe3a7b9226ff57c6c7daeef`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -50,0 +51,4 @@ const shared = [` | −0 / +4 | 新：`'cloud-account', 'cloud-quota',` |
| H002 | `@@ -123 +127,6 @@ try {` | −1 / +6 | 旧：`: [path.join(directory, name + '-smoke.mjs')],`<br>新：`: name === 'cloud-quota' \|\| name === 'management-scrollbars' ? [` |

### F088 · `shared/test/scripts/history-branding-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/history-branding-smoke.mjs)

共用 history-branding-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`5387296ec69a7de070a7f9066f83d94365d2f708`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -44 +45 @@ try {` | −1 / +1 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H003 | `@@ -49,2 +50,2 @@ try {` | −2 / +2 | 旧：`const { ChatGPTAuthService } = require( app.getAppPath() + '/dist-electron/shared/electron/backend/auth/service.js',`<br>新：`const { CloudAccountClient } = require( app.getAppPath() + '/dist-electron/shared/electron/backend/cloud/client.js',` |
| H004 | `@@ -52 +53 @@ try {` | −1 / +1 | 旧：`const session = ChatGPTAuthService.prototype.session;`<br>新：`const call = CloudAccountClient.prototype.call;` |
| H005 | `@@ -54 +55 @@ try {` | −1 / +1 | 旧：`ChatGPTAuthService.prototype.session = async function () {`<br>新：`CloudAccountClient.prototype.call = async function (input) {` |
| H006 | `@@ -59 +60 @@ try {` | −1 / +1 | 旧：`return session.call(this);`<br>新：`return call.call(this, input);` |
| H007 | `@@ -85 +86 @@ try {` | −1 / +1 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H008 | `@@ -89,4 +90 @@ try {` | −4 / +1 | 旧：`const [main] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const main = await connectUiAccount(app, login);` |
| H009 | `@@ -151 +149,4 @@ try {` | −1 / +4 | 旧：`await main.locator('.history-row').click();`<br>新：`await main .locator('.history-row')` |
| H010 | `@@ -321 +322,4 @@ try {` | −1 / +4 | 旧：`await main.locator('.history-row').filter({ hasText: '机器人控制与工业自动化岗位面试' }).click();`<br>新：`await main .locator('.history-row')` |
| H011 | `@@ -347 +351,4 @@ try {` | −1 / +4 | 旧：`await main.locator('.history-row').filter({ hasText: '待生成标题' }).click();`<br>新：`await main .locator('.history-row')` |

### F089 · `shared/test/scripts/install-ui-account.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/install-ui-account.mjs)

所有GUI测试共用的合成主账号/AI端口，主账号恢复、忙碌/退出与身份生命周期。

规范化Git blob：`011631f07834ffd6eaa48301580774f887229b6e`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -1,0 +2 @@ import path from 'node:path';` | −0 / +1 | 新：`import { fileURLToPath } from 'node:url';` |
| H002 | `@@ -3,2 +4,5 @@ import { testRoot } from './test-workspace.mjs';` | −2 / +5 | 旧：`// Called only by Playwright in an isolated test process. No real OAuth/AI/audio. export async function closeUiApp(app) {`<br>新：`export async function enterDemoUiAccount(app, login) { await app.evaluate(() => globalThis.primaryAccountFixture.login());` |
| H003 | `@@ -6,25 +10,7 @@ export async function closeUiApp(app) {` | −25 / +7 | 旧：`({ app, dialog }, owner) => { const path = process.getBuiltinModule('path');`<br>新：`({ app }, fixture) => { if (!globalThis.primaryAccountFixture) {` |
| H004 | `@@ -32 +18 @@ export async function closeUiApp(app) {` | −1 / +1 | 旧：`{ root: testRoot, pid: process.pid },`<br>新：`fileURLToPath(new URL('../fixtures/install-primary-account.cjs', import.meta.url)),` |
| H005 | `@@ -33,0 +20,69 @@ export async function closeUiApp(app) {` | −0 / +69 | 新：`const opened = app.waitForEvent('window'); await login.getByLabel('邮箱', { exact: true }).fill('synthetic@example.test');` |

### F090 · `shared/test/scripts/interview-chrome-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/interview-chrome-smoke.mjs)

共用 interview-chrome-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`2e0e85005530e0277a5e9dddb6b4dca851cf6903`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -57 +58 @@ try {` | −1 / +1 | 旧：`await click(login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }));`<br>新：`await connectUiAccount(app, login);` |

### F091 · `shared/test/scripts/interview-motion-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/interview-motion-smoke.mjs)

共用 interview-motion-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`4d719f2b666a020b32e2f9840817e65438480012`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -61 +62 @@ try {` | −1 / +1 | 旧：`await click(login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }));`<br>新：`await connectUiAccount(app, login);` |

### F092 · `shared/test/scripts/interview-quota-checks.mjs`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/interview-quota-checks.mjs)

面试准入/实时余额/归零保存/5分钟和秒数/UI与Mac⌃S、Windows Alt+S真实键分支。

规范化Git blob：`9bbd0750cdb15cd864ee57065ec12ee2242aa742`。

完整新增块：`@@ -0,0 +1,192 @@`，新增192行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 6 | function | `checkInterviewQuota` |

### F093 · `shared/test/scripts/interview-retry-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/interview-retry-smoke.mjs)

共用 interview-retry-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`27596e2b1b9fb6ca8864fec5e0342bd26e3bb543`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -100,4 +101 @@ try {` | −4 / +1 | 旧：`const [main] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const main = await connectUiAccount(app, login);` |

### F094 · `shared/test/scripts/interview-screenshot-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/interview-screenshot-smoke.mjs)

共用 interview-screenshot-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`79a99f81f716fa0c7b8ef9866730fb5cb0373848`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -8 +9 @@ import { installUiAccount, closeUiApp } from './install-ui-account.mjs';` | −1 / +1 | 旧：`import { verifyContinuousCorners } from './continuous-corners.mjs';`<br>新：`import { verifyContinuousCorners, cornerShapeNames } from './continuous-corners.mjs';` |
| H003 | `@@ -82,4 +83 @@ try {` | −4 / +1 | 旧：`const [main] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const main = await connectUiAccount(app, login);` |
| H004 | `@@ -224,2 +222,3 @@ try {` | −2 / +3 | 旧：`assert.equal(await camera.locator('kbd').innerText(), macShortcut ? '⌃S' : 'Ctrl+S'); assert.equal(await camera.getAttribute('aria-keyshortcuts'), 'Control+s');`<br>新：`const shortcut = macShortcut ? 'Control+s' : 'Alt+s'; assert.equal(await camera.locator('kbd').innerText(), macShortcut ? '⌃S' : 'Alt+S');` |
| H005 | `@@ -281 +280 @@ try {` | −1 / +1 | 旧：`assert.equal(shape.corner, 'round');`<br>新：`assert.equal(cornerShapeNames(shape.corner), 'round');` |
| H006 | `@@ -290 +289 @@ try {` | −1 / +1 | 旧：`await floating.evaluate(() => {`<br>新：`await floating.evaluate((macShortcut) => {` |
| H007 | `@@ -293 +292 @@ try {` | −1 / +1 | 旧：`{ altKey: true },`<br>新：`macShortcut ? { altKey: true } : { ctrlKey: true },` |
| H008 | `@@ -301 +300,2 @@ try {` | −1 / +2 | 旧：`ctrlKey: true,`<br>新：`ctrlKey: macShortcut, altKey: !macShortcut,` |
| H009 | `@@ -309 +309 @@ try {` | −1 / +1 | 旧：`});`<br>新：`}, macShortcut);` |
| H010 | `@@ -315 +315 @@ try {` | −1 / +1 | 旧：`await main.keyboard.press('Control+s');`<br>新：`await main.keyboard.press(shortcut);` |
| H011 | `@@ -323 +323 @@ try {` | −1 / +1 | 旧：`await floating.keyboard.press('Control+s');`<br>新：`await floating.keyboard.press(shortcut);` |
| H012 | `@@ -337 +337,3 @@ try {` | −1 / +3 | 旧：`await input.press('Control+s');`<br>新：`await input.press(macShortcut ? 'Alt+s' : 'Control+s'); assert.equal(await captured(), 0, 'The other platform shortcut must not capture');` |
| H013 | `@@ -351,7 +353,9 @@ try {` | −7 / +9 | 旧：`await camera.evaluate((button) => ({ width: Math.round(button.getBoundingClientRect().width),`<br>新：`cornerShapeNames( await camera.evaluate((button) => ({` |
| H014 | `@@ -367 +371 @@ try {` | −1 / +1 | 旧：`await input.press('Control+s');`<br>新：`await input.press(shortcut);` |
| H015 | `@@ -402 +406 @@ try {` | −1 / +1 | 旧：`await input.press('Control+s');`<br>新：`await input.press(shortcut);` |
| H016 | `@@ -446 +450 @@ try {` | −1 / +1 | 旧：`await liveViewer.press('Control+s');`<br>新：`await liveViewer.press(shortcut);` |
| H017 | `@@ -671 +675,5 @@ try {` | −1 / +5 | 旧：`await main.locator('.history-row').first().click();`<br>新：`await main .locator('.history-row')` |

### F095 · `shared/test/scripts/interview-stability-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/interview-stability-smoke.mjs)

共用 interview-stability-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`760f83c430c707f14473cceef13d81f35c20aa9a`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -48,4 +49 @@ try {` | −4 / +1 | 旧：`const [main] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const main = await connectUiAccount(app, login);` |
| H003 | `@@ -55,0 +54,4 @@ try {` | −0 / +4 | 新：`await main .getByRole('navigation', { name: '设置分类' })` |

### F096 · `shared/test/scripts/interview-typography-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/interview-typography-smoke.mjs)

共用 interview-typography-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`2eda548b4eaecffca03f6995a95678fae08520c1`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -95,4 +96 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H003 | `@@ -103,0 +102,4 @@ try {` | −0 / +4 | 新：`await target .getByRole('navigation', { name: '设置分类' })` |
| H004 | `@@ -354,4 +356 @@ try {` | −4 / +1 | 旧：`const [restarted] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const restarted = await connectUiAccount(app, restartedLogin);` |

### F097 · `shared/test/scripts/interview-usage-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/interview-usage-smoke.mjs)

共用 interview-usage-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`3055d29457270424974ce03a0b64908c2a9025f0`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -89,4 +90 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |

### F098 · `shared/test/scripts/interview-ux-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/interview-ux-smoke.mjs)

共用 interview-ux-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`d86d6c3f8e11e2164e79b9033e3e3f0cf9d38a01`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -36,0 +38,5 @@ async function capture(page, name) {` | −0 / +5 | 新：`// Media emulation acknowledges before Chromium necessarily paints the new // palette. Flush its style/frame update before waiting for finite transitions.` |
| H003 | `@@ -294,4 +300 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H004 | `@@ -353,0 +357,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |

### F099 · `shared/test/scripts/knowledge-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/knowledge-smoke.mjs)

共用 knowledge-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`bc06aace940c33658e4ca160aaaee10996f4fae9`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -31,5 +32,2 @@ try {` | −5 / +2 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor(); const [page] = await Promise.all([`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor(); const page = await connectUiAccount(app, login);` |
| H003 | `@@ -82 +80 @@ try {` | −1 / +1 | 旧：`assert.equal(await note().locator('.document-actions button').count(), 1);`<br>新：`assert.equal(await note().locator('.document-actions button').count(), 2);` |
| H004 | `@@ -91 +89 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: /保留的知识库/ }).click();`<br>新：`await page.locator('.knowledge-card').filter({ hasText: '保留的知识库' }).click();` |

### F100 · `shared/test/scripts/login-entry-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/login-entry-smoke.mjs)

共用 login-entry-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`9ad008e260f88fabbcd3204bf8f4a5cd27afd16e`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -32 +32 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |

### F101 · `shared/test/scripts/login-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/login-smoke.mjs)

共用 login-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`2d5e152aee33e6547eacd126084f96ac9c22a5cd`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1,2 @@` | −0 / +2 | 新：`import { enterPrimaryUiAccount, installUiAccount } from './install-ui-account.mjs'; import { enterDemoUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -69 +71 @@ try {` | −1 / +1 | 旧：`await page.getByRole('heading', { name: '欢迎使用 VoxCue', exact: true }).waitFor();`<br>新：`await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H003 | `@@ -78 +80 @@ try {` | −1 / +1 | 旧：`await assertWindowSize([960, 580]);`<br>新：`await assertWindowSize([1000, 660]);` |
| H004 | `@@ -80,7 +82 @@ try {` | −7 / +1 | 旧：`assert.equal( await page`<br>新：`assert.equal(await page.locator('.login-brand').innerText(), 'VoxCue');` |
| H005 | `@@ -90 +86 @@ try {` | −1 / +1 | 旧：`.locator('.login-shell')`<br>新：`.locator('.login-card')` |
| H006 | `@@ -96,0 +93,5 @@ try {` | −0 / +5 | 新：`page = await enterPrimaryUiAccount(app, page); await page.getByRole('button', { name: '用户菜单', exact: true }).click();` |
| H007 | `@@ -105,2 +106,2 @@ try {` | −2 / +2 | 旧：`await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(); await page.getByRole('button', { name: '取消登录', exact: true }).waitFor();`<br>新：`await ai.getByRole('button', { name: '连接', exact: true }).click(); await page.getByRole('button', { name: '取消授权', exact: true }).waitFor();` |
| H008 | `@@ -119,2 +120,2 @@ try {` | −2 / +2 | 旧：`await page.getByRole('button', { name: '取消登录', exact: true }).click(); await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await page.getByRole('button', { name: '取消授权', exact: true }).click(); await ai.getByRole('button', { name: '连接', exact: true }).waitFor();` |
| H009 | `@@ -125 +126 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click();`<br>新：`await ai.getByRole('button', { name: '连接', exact: true }).click();` |
| H010 | `@@ -181,5 +182,4 @@ try {` | −5 / +4 | 旧：`const oldLogin = page; [page] = await Promise.all([`<br>新：`await page.getByRole('button', { name: '关闭设置', exact: true }).click(); await installUiAccount(app);` |
| H011 | `@@ -199 +199 @@ try {` | −1 / +1 | 旧：`await page.getByRole('menuitemradio', { name: /GPT · 推理/ }).click();`<br>新：`await page.getByRole('menuitemradio', { name: /Test Model/ }).click();` |
| H012 | `@@ -202 +202 @@ try {` | −1 / +1 | 旧：`await page.getByRole('menuitemradio', { name: /GPT · 推理/ }).getAttribute('aria-checked'),`<br>新：`await page.getByRole('menuitemradio', { name: /Test Model/ }).getAttribute('aria-checked'),` |
| H013 | `@@ -207,0 +208,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H014 | `@@ -224 +228 @@ try {` | −1 / +1 | 旧：`await page.getByRole('heading', { name: '欢迎使用 VoxCue', exact: true }).waitFor();`<br>新：`await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H015 | `@@ -226 +230 @@ try {` | −1 / +1 | 旧：`await assertWindowSize([960, 580]);`<br>新：`await assertWindowSize([1000, 660]);` |
| H016 | `@@ -230 +234,4 @@ try {` | −1 / +4 | 旧：`assert.equal(await page.evaluate(() => window.desktop.authSession()), null);`<br>新：`assert.equal( (await page.evaluate(() => window.desktop.cloudAccount({ action: 'status' }))).state.user,` |

### F102 · `shared/test/scripts/management-scrollbar-checks.mjs`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/management-scrollbar-checks.mjs)

面试记录/知识库/设置/个人资料标题及轨道首尾、开合与窄窗几何。

规范化Git blob：`b79478ef522639148263869abf429a4a4eef0ce9`。

完整新增块：`@@ -0,0 +1,306 @@`，新增306行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 5 | function | `checkManagementScrollbars` |

### F103 · `shared/test/scripts/offline-electron-entry.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/offline-electron-entry.mjs)

离线合成主账号入口与只读文件夹保护，避免触碰默认Electron数据。

规范化Git blob：`7b6584e8af562fda0280ebd72b681fdc999585fd`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -102,0 +103,11 @@ export async function offlineElectronEntry(` | −0 / +11 | 新：`...(!loopbackPort ? [` |

### F104 · `shared/test/scripts/profile-selection-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/profile-selection-smoke.mjs)

共用 profile-selection-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`07927676cafb6e87e5731374c4b517dac781209e`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1,2 @@` | −0 / +2 | 新：`import { connectUiAccount } from './install-ui-account.mjs'; import { cornerShapeNames } from './continuous-corners.mjs';` |
| H002 | `@@ -155,4 +157 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H003 | `@@ -233 +232 @@ try {` | −1 / +1 | 旧：`assert.deepEqual(contours, {`<br>新：`assert.deepEqual(cornerShapeNames(contours), {` |
| H004 | `@@ -235 +234 @@ try {` | −1 / +1 | 旧：`shape: 'squircle', // Chromium's canonical spelling of superellipse(2).`<br>新：`shape: 'squircle',` |

### F105 · `shared/test/scripts/profile-ui-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/profile-ui-smoke.mjs)

共用 profile-ui-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`8091f85408330f2b2618322accd3747822b7279e`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -219,4 +220 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |

### F106 · `shared/test/scripts/provider-ui-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/provider-ui-smoke.mjs)

共用 provider-ui-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`663d01189bc1413accee57e92edacb4a76185e83`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -48,4 +49 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H003 | `@@ -60,0 +59,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H004 | `@@ -161 +163 @@ try {` | −1 / +1 | 旧：`await category('关于').click();`<br>新：`await category('关于与更新').click();` |
| H005 | `@@ -205 +207,5 @@ try {` | −1 / +5 | 旧：`await page.locator('.history-row').first().click();`<br>新：`await page .locator('.history-row')` |

### F107 · `shared/test/scripts/rag-ui-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/rag-ui-smoke.mjs)

共用 rag-ui-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`f3495bffba6e4c2f34784c2b5782d0ef148507fd`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { enterDemoUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -16,5 +17,2 @@ try {` | −5 / +2 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor(); const [page] = await Promise.all([`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor(); const [page] = await Promise.all([app.waitForEvent('window'), enterDemoUiAccount(app, login)]);` |
| H003 | `@@ -103 +101 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: /RAG 本地集成/ }).click();`<br>新：`await page.locator('.knowledge-card').filter({ hasText: 'RAG 本地集成' }).click();` |
| H004 | `@@ -114,0 +113,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |

### F108 · `shared/test/scripts/server-connection-smoke.mjs`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/server-connection-smoke.mjs)

只读0.5.1本地合成API全链路、线上HTTPS只读声明/失效令牌清理，不写生产资料。

规范化Git blob：`fc10e869918d4f42c46e7b240b2da9f4a9de92c7`。

完整新增块：`@@ -0,0 +1,70 @@`，新增70行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 7 | 变量/函数 | `{ CloudAccountClient, cloudOrigin }` |
| 10 | 变量/函数 | `origin` |
| 14 | 变量/函数 | `get` |
| 21 | 变量/函数 | `capabilities` |
| 34 | 变量/函数 | `cleared` |
| 35 | 变量/函数 | `client` |
| 64 | 变量/函数 | `status` |

### F109 · `shared/test/scripts/settings-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/settings-smoke.mjs)

共用 settings-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`85bc04a9dd2652b52d993c245a8bc45b5c0cb5c6`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount, installUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -14,0 +16 @@ try {` | −0 / +1 | 新：`await installUiAccount(app);` |
| H003 | `@@ -16 +18 @@ try {` | −1 / +1 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H004 | `@@ -18,4 +20 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H005 | `@@ -27,0 +27,11 @@ try {` | −0 / +11 | 新：`assert.equal( await page` |
| H006 | `@@ -61,2 +71,2 @@ try {` | −2 / +2 | 旧：`assert.equal(await category('个性化').getAttribute('aria-current'), 'page'); assert.equal(await settings.getByRole('navigation').getByRole('button').count(), 6);`<br>新：`await category('个性化').click(); assert.equal(await settings.getByRole('navigation').getByRole('button').count(), 7);` |
| H007 | `@@ -110 +120 @@ try {` | −1 / +1 | 旧：`await category('账户与用量').click();`<br>新：`await category('AI 服务').click();` |
| H008 | `@@ -114 +124 @@ try {` | −1 / +1 | 旧：`await category('关于').click();`<br>新：`await category('关于与更新').click();` |

### F110 · `shared/test/scripts/test-workspace.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/test-workspace.mjs)

自有profile/目录与进程树清理、失败时有界结束，不杀其他应用。

规范化Git blob：`7e24d3fdbfd0078226c03ab9fbdffbfcfdafeaa1`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -4 +4 @@ import os from 'node:os';` | −1 / +1 | 旧：`import { spawn } from 'node:child_process';`<br>新：`import { spawn, execFileSync } from 'node:child_process';` |
| H002 | `@@ -55,0 +56,18 @@ export function trackTestProcess(child) {` | −0 / +18 | 新：`if (process.platform === 'win32') { const kill = child.kill.bind(child);` |

### F111 · `shared/test/scripts/typography-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/typography-smoke.mjs)

共用 typography-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`6d4c80e4805205dfabc52c12afbdfd7bce19d992`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -224,0 +226,7 @@ const inspect = async (page, name) => {` | −0 / +7 | 新：`designedSize: e.matches('.login-auth-content h1') ? 26` |
| H003 | `@@ -228 +236 @@ const inspect = async (page, name) => {` | −1 / +1 | 旧：`'.profile-edit-dialog textarea.profile-editor-input,.chat-copy,.markdown-code-block > header .ui-button',`<br>新：`'.login-form-links .ui-button,.profile-edit-dialog textarea.profile-editor-input,.chat-copy,.markdown-code-block > header .ui-button',` |
| H004 | `@@ -242 +250,3 @@ const inspect = async (page, name) => {` | −1 / +3 | 旧：`![12, 14, 15, 18].includes(row.size) && !(row.expectedControlSize === 11 && row.size === 11),`<br>新：`row.size !== row.designedSize && ![12, 14, 15, 18].includes(row.size) &&` |
| H005 | `@@ -279 +289 @@ try {` | −1 / +1 | 旧：`await login.getByRole('heading', { name: '欢迎使用 VoxCue', exact: true }).waitFor();`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H006 | `@@ -283,4 +293 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H007 | `@@ -392,0 +400,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H008 | `@@ -395 +406,9 @@ try {` | −1 / +9 | 旧：`for (const category of ['个性化', '本地组件', '账户与用量', '面试设置', '更新', '关于']) {`<br>新：`for (const category of [ 'VoxCue 账号',` |
| H009 | `@@ -405 +424 @@ try {` | −1 / +1 | 旧：`if (category === '账户与用量') {`<br>新：`if (category === 'AI 服务') {` |
| H010 | `@@ -421 +440,5 @@ try {` | −1 / +5 | 旧：`await page.locator('.history-row').first().click();`<br>新：`await page .locator('.history-row')` |
| H011 | `@@ -490 +513,5 @@ try {` | −1 / +5 | 旧：`await page.locator('.history-row').first().click();`<br>新：`await page .locator('.history-row')` |
| H012 | `@@ -500 +527,13 @@ try {` | −1 / +13 | 旧：`for (const category of ['个性化', '本地组件', '账户与用量', '面试设置', '更新', '关于']) {`<br>新：`await page .getByRole('navigation', { name: '设置分类' })` |

### F112 · `shared/test/scripts/ui-alignment-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/ui-alignment-smoke.mjs)

共用 ui-alignment-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`9dae6645f9fdaf9a9e73a5f00b4743fc0cedfbaf`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -37,4 +38 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H003 | `@@ -230,0 +229,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H004 | `@@ -280,0 +283,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |

### F113 · `shared/test/scripts/ui-material-refinement-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/ui-material-refinement-smoke.mjs)

共用 ui-material-refinement-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`09cb4b0aed036b644bafe83a427714bc638ead1f`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1,2 @@` | −0 / +2 | 新：`import { connectUiAccount } from './install-ui-account.mjs'; import { cornerShapeNames } from './continuous-corners.mjs';` |
| H002 | `@@ -133,4 +135 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H003 | `@@ -163,0 +163,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H004 | `@@ -240 +243,4 @@ try {` | −1 / +4 | 旧：`await page.locator('.history-row').click();`<br>新：`await page .locator('.history-row')` |
| H005 | `@@ -337 +343 @@ try {` | −1 / +1 | 旧：`assert.equal(endStyle.corner, 'round');`<br>新：`assert.equal(cornerShapeNames(endStyle.corner), 'round');` |

### F114 · `shared/test/scripts/ui-refinement-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/ui-refinement-smoke.mjs)

共用 ui-refinement-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`49930c56a60fe7e1196bfd46f7439d9842550744`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -100,4 +101 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H003 | `@@ -319 +317 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: '个人信息' }).click();`<br>新：`await page.getByRole('button', { name: '个人信息', exact: true }).click();` |
| H004 | `@@ -341 +339 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: '个人信息' }).click();`<br>新：`await page.getByRole('button', { name: '个人信息', exact: true }).click();` |

### F115 · `shared/test/scripts/ui-ux-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/ui-ux-smoke.mjs)

共用 ui-ux-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`3c4f2507aba6be864bb7917b98b5dc79b0242d75`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -132,4 +133 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H003 | `@@ -151,0 +150,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H004 | `@@ -447 +449,4 @@ try {` | −1 / +4 | 旧：`await page.locator('.history-row').filter({ hasText: '项目面试' }).click();`<br>新：`await page .locator('.history-row')` |
| H005 | `@@ -509 +514 @@ try {` | −1 / +1 | 旧：`['删除文档 notes.md'],`<br>新：`['notes.md：未同步', '删除文档 notes.md'],` |
| H006 | `@@ -524,0 +530,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H007 | `@@ -636,0 +646,5 @@ try {` | −0 / +5 | 新：`await app.evaluate(({ dialog }) => { dialog.showMessageBox = async (_win, options) => ({` |
| H008 | `@@ -641 +655 @@ try {` | −1 / +1 | 旧：`await returnedLogin.getByRole('heading', { name: '欢迎使用 VoxCue', exact: true }).waitFor();`<br>新：`await returnedLogin.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |

### F116 · `shared/test/scripts/updates-sidebar-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/updates-sidebar-smoke.mjs)

共用 updates-sidebar-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`8a99405b989de382a4b711a4a2e050a50b527eae`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -62 +62,0 @@ const launch = async () => {` | −1 / +0 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();` |
| H003 | `@@ -64,4 +64 @@ const launch = async () => {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H004 | `@@ -81,0 +79,4 @@ const openUpdates = async (page) => {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H005 | `@@ -85 +86 @@ const openUpdates = async (page) => {` | −1 / +1 | 旧：`.getByRole('button', { name: '更新', exact: true })`<br>新：`.getByRole('button', { name: '关于与更新', exact: true })` |

### F117 · `shared/test/scripts/updates-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/updates-smoke.mjs)

共用 updates-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`d05e55e4a633e21469207f928af2cd0ea199d640`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from './install-ui-account.mjs';` |
| H002 | `@@ -69,6 +70,7 @@ const launch = async () => {` | −6 / +7 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor(); assert.equal(`<br>新：`if (login.url().endsWith('#login')) assert.equal(` |
| H003 | `@@ -76,7 +78,4 @@ const launch = async () => {` | −7 / +4 | 旧：`), true,`<br>新：`true, );` |
| H004 | `@@ -91,0 +91,4 @@ const openUpdates = async (page) => {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H005 | `@@ -95 +98 @@ const openUpdates = async (page) => {` | −1 / +1 | 旧：`.getByRole('button', { name: '更新', exact: true })`<br>新：`.getByRole('button', { name: '关于与更新', exact: true })` |
| H006 | `@@ -232 +235 @@ try {` | −1 / +1 | 旧：`mode: 'mock',`<br>新：`mode: 'local',` |
| H007 | `@@ -234,2 +237,2 @@ try {` | −2 / +2 | 旧：`aiEnabled: false, modelId: '',`<br>新：`aiEnabled: true, modelId: 'test-model',` |
| H008 | `@@ -340,4 +343 @@ try {` | −4 / +1 | 旧：`[page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`page = await connectUiAccount(app, login);` |

### F118 · `shared/test/scripts/web-materials-smoke.mjs`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/scripts/web-materials-smoke.mjs)

共用 web-materials-smoke.mjs：迁移邮箱主账号及独立AI、适配新UI选择器和模拟行为；保留原业务断言，具体每块列下。

规范化Git blob：`72e265f83befb917afa286b4f88cf8c51bd85b55`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1,2 @@` | −0 / +2 | 新：`import { connectUiAccount } from './install-ui-account.mjs'; import { cornerShapeNames } from './continuous-corners.mjs';` |
| H002 | `@@ -47 +49 @@ try {` | −1 / +1 | 旧：`const signIn = login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true });`<br>新：`const signIn = login.getByRole('button', { name: '登录', exact: true });` |
| H003 | `@@ -55,7 +57 @@ try {` | −7 / +1 | 旧：`await login.waitForFunction( (dark) =>`<br>新：`assert.notEqual(` |
| H004 | `@@ -63 +59 @@ try {` | −1 / +1 | 旧：`dark ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)',`<br>新：`'rgba(0, 0, 0, 0)',` |
| H005 | `@@ -77,2 +73,2 @@ try {` | −2 / +2 | 旧：`assert.ok(backdrop.background.includes(dark ? 'rgb(52, 75, 96)' : 'rgb(191, 202, 215)')); assert.equal(backdrop.glow, dark ? '0.48' : '1');`<br>新：`assert.ok(backdrop.background.includes(dark ? 'rgb(37, 46, 62)' : 'rgb(230, 236, 244)')); assert.equal(backdrop.glow, '0.25');` |
| H006 | `@@ -95,5 +91,30 @@ try {` | −5 / +30 | 旧：`await (await app.browserWindow(login)).evaluate((win) => win.setSize(860, 520)); // Native window bounds round to physical pixels at fractional Windows DPI.`<br>新：`const minimumContent = await ( await app.browserWindow(login)` |
| H007 | `@@ -118,4 +139 @@ try {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H008 | `@@ -150 +168 @@ try {` | −1 / +1 | 旧：`assert.deepEqual(shape, { radius: '999px', curve: 'round', height: 36 });`<br>新：`assert.deepEqual(cornerShapeNames(shape), { radius: '999px', curve: 'round', height: 36 });` |
| H009 | `@@ -326,0 +345,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H010 | `@@ -439 +461,5 @@ try {` | −1 / +5 | 旧：`await page.locator('.history-row').first().click();`<br>新：`await page .locator('.history-row')` |

### F119 · `shared/test/unit/account-usage-store.test.ts`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/account-usage-store.test.ts)

单测 account-usage-store.test.ts：主账号/云契约及既有业务兼容，Vitest4状态隔离；新增断言和调整位置全部列下。

规范化Git blob：`c00639ef5e5ef4db50774f3756d7a056a7a670f7`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -7,0 +8,6 @@ afterEach(async () => {` | −0 / +6 | 新：`it('主账号登录但未连接AI时不提供预设模拟模型，显式测试演示才可用', async () => { await useChatConnection.getState().load(false);` |

### F120 · `shared/test/unit/automatic-question.test.ts`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/automatic-question.test.ts)

单测 automatic-question.test.ts：主账号/云契约及既有业务兼容，Vitest4状态隔离；新增断言和调整位置全部列下。

规范化Git blob：`6e2c4e98d091d96affa862c2dcf2c946c5fdb41f`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -82,0 +83 @@ let ask: ReturnType<typeof vi.spyOn>;` | −0 / +1 | 新：`const realAsk = useInterview.getState().ask;` |
| H002 | `@@ -111,0 +113,2 @@ afterEach(() => {` | −0 / +2 | 新：`// Zustand copies actions into new state objects; restore the current copy too. useInterview.setState({ ask: realAsk });` |

### F121 · `shared/test/unit/cloud-account.test.ts`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/cloud-account.test.ts)

单测 cloud-account.test.ts：主账号/云契约及既有业务兼容，Vitest4状态隔离；新增断言和调整位置全部列下。

规范化Git blob：`a919071b52770f16f3af2e17d72225b1b1f0212f`。

完整新增块：`@@ -0,0 +1,253 @@`，新增253行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 8 | 变量/函数 | `origin` |
| 9 | 变量/函数 | `result` |
| 21 | function | `vault` |
| 36 | 变量/函数 | `json` |
| 38 | describe | `independent cloud account client` |
| 39 | it | `serializes background API readers with a bounded two-slot queue` |
| 67 | it | `enforces 15–128 Unicode password characters before registration/reset requests` |
| 103 | it | `rejects malformed emails in main even when a renderer bypasses the disabled button` |
| 129 | it | `requires HTTPS, explicit local development, and a bare origin` |
| 141 | it | `keeps tokens in main-process vault and scopes them to the service origin` |
| 172 | it | `does not grow a call queue and never retries a refresh mutation automatically` |
| 199 | it | `clears a corrupt vault on local logout without leaking raw exceptions` |
| 219 | it | `rejects oversized responses and sanitizes server error messages` |

### F122 · `shared/test/unit/cloud-data.test.ts`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/cloud-data.test.ts)

单测 cloud-data.test.ts：主账号/云契约及既有业务兼容，Vitest4状态隔离；新增断言和调整位置全部列下。

规范化Git blob：`84ae0c8b9a5debeac5ba3979e2b0859ad0ebd150`。

完整新增块：`@@ -0,0 +1,82 @@`，新增82行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 15 | 变量/函数 | `profileKey` |
| 16 | describe | `cloud data restoration boundary` |
| 28 | it | `a late profile download cannot overwrite a newer JD or commit after logout` |
| 47 | it | `a file replacement races safely with restoration and local-only revision fields never enter the cloud package` |
| 62 | it | `malicious file names, oversized declared metadata and wrong-category payloads cannot be restored` |

### F123 · `shared/test/unit/cloud-lease.test.ts`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/cloud-lease.test.ts)

单测 cloud-lease.test.ts：主账号/云契约及既有业务兼容，Vitest4状态隔离；新增断言和调整位置全部列下。

规范化Git blob：`1f31399433ca8934bcae00132b30fe7e376c3d73`。

完整新增块：`@@ -0,0 +1,298 @@`，新增298行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 5 | describe | `interview time lease` |
| 6 | it | `uses a monotonic deadline, rejects expired usage and does not extend an offline lease` |
| 47 | it | `a late heartbeat cannot revive a stopped session or create concurrent renewals` |
| 85 | it | `insufficient credit cannot start an interview and permanent grants retain null duration` |
| 109 | it | `a delayed heartbeat cannot revive an elapsed lease even before the next timer callback` |
| 144 | it | `counts down the full balance, independent of the short renewable lease or wall clock` |
| 181 | it | `emits exhaustion once and retains the expired snapshot for a late-loading renderer` |
| 213 | it | `does not mistake a failed connection for an exhausted balance, or grant offline time` |
| 245 | it | `permanent credit has no finite countdown but still requires a live lease` |

### F124 · `shared/test/unit/cloud-sync.test.ts`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/cloud-sync.test.ts)

单测 cloud-sync.test.ts：主账号/云契约及既有业务兼容，Vitest4状态隔离；新增断言和调整位置全部列下。

规范化Git blob：`df7ef657b0e600d0e2f8c22e7dafc53c8546ec82`。

完整新增块：`@@ -0,0 +1,646 @@`，新增646行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 23 | 变量/函数 | `userId` |
| 35 | function | `fixture` |
| 24 | it | `refreshing capacity only reads cloud metadata, without starting an upload or restore` |
| 267 | describe | `cloud sync consistency and backpressure` |
| 268 | it | `resumes after restart without retransmitting server-verified chunks whose acknowledgement was lost` |
| 289 | it | `uses three-way comparison and preserves remote deletion until explicit resume` |
| 299 | it | `preempts a multi-chunk knowledge upload when a JD changes` |
| 320 | it | `deleting only a cloud copy preserves local data and suppresses subsequent auto-upload` |
| 335 | it | `cloud deletion preempts the next chunk and keeps a single bounded priority slot` |
| 370 | it | `library deletion includes its files, suppresses new children after restart and manual sync restores automation` |
| 392 | it | `capacity updates during a multi-chunk upload and metadata reads remain throttled` |
| 415 | it | `backs up one whole library before starting the next regardless of file insertion order` |
| 467 | it | `cancelling a library aborts its partial upload and pauses the remaining and newly added files` |
| 504 | it | `changing both sides creates a conflict and never overwrites either implicitly` |
| 521 | it | `corrupted download never replaces local data` |
| 537 | it | `honors server retry-after globally instead of hammering every queued item` |
| 550 | it | `shared server quota rejects an upload before sending chunks while profile work still runs first` |
| 569 | it | `one worker coalesces many requests and stops late work on logout` |
| 598 | describe | `untrusted cloud inputs` |
| 599 | it | `bounds binary IPC, validates handles and rejects traversal` |
| 635 | it | `checks package version, declared header size and item identity without decompression` |

### F125 · `shared/test/unit/cloud-usage-store.test.ts`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/cloud-usage-store.test.ts)

单测 cloud-usage-store.test.ts：主账号/云契约及既有业务兼容，Vitest4状态隔离；新增断言和调整位置全部列下。

规范化Git blob：`0d25e75711c91ffb1e3740eba71c8ba7f2a43ecd`。

完整新增块：`@@ -0,0 +1,79 @@`，新增79行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 6 | 变量/函数 | `first` |
| 7 | 变量/函数 | `value` |
| 21 | function | `bind` |
| 14 | it | `marks only finite balances strictly below fifteen minutes as low` |
| 36 | it | `coalesces concurrent quota readers and discards a late result from the previous account` |
| 55 | it | `shares redeemed credit with the sidebar and retains the last good value after a failed refresh` |
| 70 | it | `removes only Electron transport wrappers from actionable interview errors` |

### F126 · `shared/test/unit/dependency-bounds.test.ts`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/dependency-bounds.test.ts)

Zod array/set/map超大输入遍历前拒绝的安全边界测试。

规范化Git blob：`4decf4229fc50527ecacdb95dccc43904aaeff05`。

完整新增块：`@@ -0,0 +1,31 @@`，新增31行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 7 | 变量/函数 | `sdk` |
| 8 | 变量/函数 | `{ z }` |
| 9 | describe | `SDK validation resource bounds` |

### F127 · `shared/test/unit/desktop-ipc.test.ts`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/desktop-ipc.test.ts)

单测 desktop-ipc.test.ts：主账号/云契约及既有业务兼容，Vitest4状态隔离；新增断言和调整位置全部列下。

规范化Git blob：`9a5f5c40d13d5748c35ae054c4a83e900a8e5f91`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -782,0 +783,7 @@ describe('受控 preload 契约', () => {` | −0 / +7 | 新：`['cloudAccount', 'cloud:account', [{ action: 'status' }]], [` |
| H002 | `@@ -827,0 +835,2 @@ describe('受控 preload 契约', () => {` | −0 / +2 | 新：`'onCloudUsageExpired', 'onInterviewUsage',` |

### F128 · `shared/test/unit/interview-end.test.ts`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/interview-end.test.ts)

到期/关闭/重复结束、空记录/尾段/保存失败和lease释放回归。

规范化Git blob：`19005b0784f17ae5fae92c3e711c1b7d5a1933e7`。

完整新增块：`@@ -0,0 +1,134 @@`，新增134行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 12 | function | `fixture` |
| 54 | it | `serializes end requests, flushes the final tail and archives before completion` |
| 88 | it | `keeps an empty expired interview and saves the same session only once` |
| 95 | it | `retains transcripts and answers on storage failure, then retries without duplicating the record` |

### F129 · `shared/test/unit/interview-layout.test.ts`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/interview-layout.test.ts)

单测 interview-layout.test.ts：主账号/云契约及既有业务兼容，Vitest4状态隔离；新增断言和调整位置全部列下。

规范化Git blob：`66928fdd22ef082a30cf3dae58716e50fdb9613a`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -10,0 +11,9 @@ const original = { x: -1500, y: 60, ...interviewCanvas() };` | −0 / +9 | 新：`it('reserves a bottom notice below the collapsed toolbar without moving its top or center', () => { const folded = fitInterviewBounds(original, area, 1, true, true);` |

### F130 · `shared/test/unit/interview-usage-notice.test.ts`

**A · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/interview-usage-notice.test.ts)

5分钟、59秒、0、永久、过期/保存失败提示边界。

规范化Git blob：`191526d1860e1a7024964ada81e4ac7ffc587d52`。

完整新增块：`@@ -0,0 +1,32 @@`，新增32行。

| 行 | 类型 | 全部声明/测试入口 |
|---|---|---|
| 6 | 变量/函数 | `view` |
| 13 | it | `warns at five minutes, switches to seconds below one minute, and never displays negative time` |
| 23 | it | `does not show a finite time warning for permanent credit` |

### F131 · `shared/test/unit/platform.test.ts`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/platform.test.ts)

单测 platform.test.ts：主账号/云契约及既有业务兼容，Vitest4状态隔离；新增断言和调整位置全部列下。

规范化Git blob：`b893ef6c865159f4d1bb4eefee21dc0311fc0a65`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -86,2 +86,2 @@ describe('桌面平台边界', () => {` | −2 / +2 | 旧：`width: 960, height: 580,`<br>新：`width: 1000, height: 660,` |
| H002 | `@@ -89 +89 @@ describe('桌面平台边界', () => {` | −1 / +1 | 旧：`minHeight: 520,`<br>新：`minHeight: 580,` |
| H003 | `@@ -128,3 +128,3 @@ describe('桌面平台边界', () => {` | −3 / +3 | 旧：`width: 960, height: 580,`<br>新：`width: 1000, height: 660,` |

### F132 · `shared/test/unit/speech-store.test.ts`

**M · 共用测试：Mac必须本机执行适用项**　[打开文件](../test/unit/speech-store.test.ts)

单测 speech-store.test.ts：主账号/云契约及既有业务兼容，Vitest4状态隔离；新增断言和调整位置全部列下。

规范化Git blob：`d8dffc8fe65ca3145e5657b680c14b438733b973`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -6,0 +7 @@ let emit: (e: SpeechEvent) => void;` | −0 / +1 | 新：`const realAsk = useInterview.getState().ask;` |
| H002 | `@@ -46,0 +48,2 @@ afterEach(() => {` | −0 / +2 | 新：`vi.restoreAllMocks(); useInterview.setState({ ask: realAsk });` |

### F133 · `windows/package.json`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/package.json)

0.6.0及Electron44.10.0/Vitest4.1.12声明，保留固定模型/SDK/Codex；平台生成依赖。

规范化Git blob：`9d61453ae8094ef8d73acd7646927f2b22beb4c6`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -4 +4 @@` | −1 / +1 | 旧：`"version": "0.5.11",`<br>新：`"version": "0.6.0",` |
| H002 | `@@ -109 +109 @@` | −1 / +1 | 旧：`"electron": "^38.0.0",`<br>新：`"electron": "44.10.0",` |
| H003 | `@@ -116,2 +116,2 @@` | −2 / +2 | 旧：`"vitest": "^3.2.0", "@electron/packager": "19.0.1",`<br>新：`"vitest": "4.1.12", "@electron/packager": "20.3.0",` |

### F134 · `windows/package.platform.json`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/package.platform.json)

Windows专属Packager安全版本20.3.0。

规范化Git blob：`4b60978fe7f6f403f5289decf64891e9acf7cace`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -36 +36 @@` | −1 / +1 | 旧：`"@electron/packager": "19.0.1",`<br>新：`"@electron/packager": "20.3.0",` |

### F135 · `windows/pnpm-lock.yaml`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/pnpm-lock.yaml)

固定本平台解析图及安全传递依赖，移除旧易受影响的打包依赖链。

规范化Git blob：`6d7b25c3906eb94478fe0e9fb5ff7aaaa330e9ac`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -7,0 +8,3 @@ overrides:` | −0 / +3 | 新：`'@github/copilot-sdk>zod': 4.6.6 undici@6: 6.29.1` |
| H002 | `@@ -84,2 +87,2 @@ importers:` | −2 / +2 | 旧：`specifier: 19.0.1 version: 19.0.1(supports-color@7.2.0)`<br>新：`specifier: 20.3.0 version: 20.3.0(supports-color@7.2.0)` |
| H003 | `@@ -102,2 +105,2 @@ importers:` | −2 / +2 | 旧：`specifier: ^38.0.0 version: 38.8.6(supports-color@7.2.0)`<br>新：`specifier: 44.10.0 version: 44.10.0(supports-color@7.2.0)` |
| H004 | `@@ -126,2 +129,2 @@ importers:` | −2 / +2 | 旧：`specifier: ^3.2.0 version: 3.2.7(@types/debug@4.1.13)(@types/node@24.19.2)(jiti@2.7.0)(lightningcss@1.32.0)(supports-color@7.2.0)`<br>新：`specifier: 4.1.12 version: 4.1.12(@opentelemetry/api@1.9.1)(@types/node@24.19.2)(vite@6.4.4(@types/node@24.19.2)(jiti@2.7.0)(lightningcss@1.32.0))` |
| H005 | `@@ -227,0 +231,4 @@ packages:` | −0 / +4 | 新：`'@electron-internal/extract-zip@1.0.6': resolution: {integrity: sha512-/aQLgFDdCSnwChfUwqekSmE1q2dCTzhUy5saIHBb5vyYn5LzWaKPaIz1wM0lDMCZYBoIG4svJNvAJb6vkI8BuA==}` |
| H006 | `@@ -242,4 +248,0 @@ packages:` | −4 / +0 | 旧：`'@electron/get@2.0.3': resolution: {integrity: sha512-Qkzpg2s9GnVV2I2BjRksUi43U5e6+zaQMcjoJy0C+C5oxaKl+fmckGDQFtRpZpZV0NQekuZZ+tGz7EA9TVnQtQ==}` |
| H007 | `@@ -250,2 +253,2 @@ packages:` | −2 / +2 | 旧：`'@electron/get@4.0.3': resolution: {integrity: sha512-HgUXcnXF37bz26gvhx47f6g0hfI3tccxbTjG+SyKXaaSE3QapDzUF3bpxfgu+x5D+jtarNrpLCWlYARfZzirAQ==}`<br>新：`'@electron/get@5.1.0': resolution: {integrity: sha512-3kSBtG8ObcTVfXanm5vVJ6UnBLEVmVsRk1M+vGqCuMBV+XLCbJYuWQful+yIy0GQDsSlK0kHEriEHn7SPk4EnA==}` |
| H008 | `@@ -272,2 +275,2 @@ packages:` | −2 / +2 | 旧：`'@electron/packager@19.0.1': resolution: {integrity: sha512-Jx7QE6zMDiK2bkqOGwyLxpzh7mn8Dcrf+LS5zpjq1tSK2S5LetNaSx1FvxalxubMHLDPb9S5DHvfB9+d3Ono3Q==}`<br>新：`'@electron/packager@20.3.0': resolution: {integrity: sha512-3MvgJgy6YJ5ti0oGGBKrWKdYwpTaoRrhranMDgHSQ6i5t56yZV9IRDyoXTuqBp97LiKqnZeAMe2wTcF/9+fP5g==}` |
| H009 | `@@ -736,3 +738,0 @@ packages:` | −3 / +0 | 旧：`'@keyv/serialize@1.1.1': resolution: {integrity: sha512-dXn3FZhPv0US+7dtJsIi2R+c7qWYiReoEh5zUntWCf4oSpMNib8FDhSoed6m3QyZdx5hK7iLFkYk3rNxwt8vTA==}` |
| H010 | `@@ -1473,3 +1472,0 @@ packages:` | −3 / +0 | 旧：`'@sec-ant/readable-stream@0.4.1': resolution: {integrity: sha512-831qok9r2t8AlxLko40y2ebgSDhenenCatLVeW/uBtnHPyhHOvG0C7TvfgecV+wHzIm5KUICgzmVpWS+IMEAeg==}` |
| H011 | `@@ -1480,3 +1477,2 @@ packages:` | −3 / +2 | 旧：`'@sindresorhus/is@7.2.0': resolution: {integrity: sha512-P1Cz1dWaFfR4IR+U13mqqiGsLFf1KbayybWwdd2vfctdV6hDpUkgCY0nKOLLTMSoRd/jJNjtbqzf13K8DCCXQw==}`<br>新：`'@standard-schema/spec@1.1.0': resolution: {integrity: sha512-l2aFy5jALhniG5HgqrD6jXLi/rUWrKvqN/qJx6yoJsgKhblVd+iqqU4RCXavm/jPityDo5TCvKMnpjKnOriy0w==}` |
| H012 | `@@ -1642,3 +1637,0 @@ packages:` | −3 / +0 | 旧：`'@types/node@22.20.5': resolution: {integrity: sha512-U2+DNr+wSjpsTS/wZGYHq7GcwfuSmKiKvoPvK22zwTlRhU91yOniN4qRR5KhIjvif7ysw/dz/hKmfDH0Ris4aA==}` |
| H013 | `@@ -1665,3 +1657,0 @@ packages:` | −3 / +0 | 旧：`'@types/yauzl@2.10.3': resolution: {integrity: sha512-oJoftv0LSuaDZE3Le4DbKX+KS9G36NzOeSap90UIK0yMA/NhKJhqlSGtNDORNRaIbQfzjXDrQa0ytJ6mNRGz/Q==}` |
| H014 | `@@ -1677,2 +1667,2 @@ packages:` | −2 / +2 | 旧：`'@vitest/expect@3.2.7': resolution: {integrity: sha512-E8eBXaKibuvH2pSZErOjdVb5vF4PbKYcrnluBTYxEk1l/VhhwZg1kZQsdtjq+CsF5CFydf2Rdkz7jDHKSisi3w==}`<br>新：`'@vitest/expect@4.1.12': resolution: {integrity: sha512-vFlTt+YEu9WBpNjdGayNmlMVzrWPi1+sv853/7t2FU7hpO5gAFBKHzQmkCq5Xjpr+evegF2994LQT3hF3mRlqQ==}` |
| H015 | `@@ -1680,2 +1670,2 @@ packages:` | −2 / +2 | 旧：`'@vitest/mocker@3.2.7': resolution: {integrity: sha512-Trr0hYO9CM3Wj6ksWHRhK9IZpIY6wTMO5u/MqXurMxT57sWBaOPEtP3Oq60ihZuh5JsiagKfz95OcxdEP6dBrA==}`<br>新：`'@vitest/mocker@4.1.12': resolution: {integrity: sha512-fKShNpKZzupWZuY0z7egydvL0sqW4INEZBEExMBMAa6izlENEVHwoXgdaTCaBZ5fwlr4xf2o1wXC83n9RpO+NA==}` |
| H016 | `@@ -1684 +1674 @@ packages:` | −1 / +1 | 旧：`vite: ^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0-0`<br>新：`vite: ^6.0.0 \|\| ^7.0.0 \|\| ^8.0.0` |
| H017 | `@@ -1691,2 +1681,2 @@ packages:` | −2 / +2 | 旧：`'@vitest/pretty-format@3.2.7': resolution: {integrity: sha512-KUHlwqVu0sRlhCdyPdQ/wBoTfRahjUky1MubOmYw9fWfIZy1gNoHpuaaQBPAaMaVYdQYHJLurzj8ECCj5OwTqA==}`<br>新：`'@vitest/pretty-format@4.1.12': resolution: {integrity: sha512-XW9O8+Mxx4VpCtkYdMJLZQQwsVryP9wk7cPKDxtXFfwSak6yRh5+2fep/Y0XF/ElBvJHq8bcYdi6aeuai0opZA==}` |
| H018 | `@@ -1694,2 +1684,2 @@ packages:` | −2 / +2 | 旧：`'@vitest/runner@3.2.7': resolution: {integrity: sha512-sB9y4ovltoQP+WaUPwmSxO9WIg9Ig694Di5PalVPsYHklAdE027mehpWF2SQSVq+k6sFgaivbTjTJwZLSHbedA==}`<br>新：`'@vitest/runner@4.1.12': resolution: {integrity: sha512-NKlVKCr5QnCe8jijdMnmkpHHU+WTqiLFR6G0pHji9uRjXK9xJl1k1nTw6F3pOOj2PDcsDt2GKQMI7wIsaT491w==}` |
| H019 | `@@ -1697,2 +1687,2 @@ packages:` | −2 / +2 | 旧：`'@vitest/snapshot@3.2.7': resolution: {integrity: sha512-7C+MwShwtBSI5Buwoyg3s/iY1eHL9PKAf+O1wVh/TdnjXUtkoL/9YQtre90i4MtNXM6edP1wJ2zOBpfCyhIS7g==}`<br>新：`'@vitest/snapshot@4.1.12': resolution: {integrity: sha512-ko1y1Qgb/slzQ9mr+b89Cuqud8WG1TKtsPD8r7ZUBdvVOGt85Af2HwCqHujrhwJq95hs/9RM7fcAPg57o1vlzw==}` |
| H020 | `@@ -1700,2 +1690,2 @@ packages:` | −2 / +2 | 旧：`'@vitest/spy@3.2.7': resolution: {integrity: sha512-Q2eQGI6d2L/hBtZ0qNuKcAGid68XK6cv1xsoaIma6PaJhHPoqcEJhYpXZ/5myCMqkNgtP6UKuBhbc0nHKnrkuQ==}`<br>新：`'@vitest/spy@4.1.12': resolution: {integrity: sha512-RGq9x4JNGNTZHEJxvN0oSiJjeSCExm0n2gZKKJZHY9cX5AVA6M7VJILBT3ZJ/tJ/0J9uWT7fETV9/btoi//vSg==}` |
| H021 | `@@ -1703,2 +1693,2 @@ packages:` | −2 / +2 | 旧：`'@vitest/utils@3.2.7': resolution: {integrity: sha512-x6BDOd7dyo3PFLY3I9/HJ25X/6OurhGXk2/B9gOZNPF7XDVjeBK4k01lQE5uvDpbuheErh91qYuE1E2OEjK3Rw==}`<br>新：`'@vitest/utils@4.1.12': resolution: {integrity: sha512-Q3awXrwOfEV+qc3WmO5ONyE0yO7Q1gQ9/oyHxGLZ/pl7N3NO/ZztqQwKLuwMkV+CA1JYSIeO3gkHnRDIo4AVaA==}` |
| H022 | `@@ -1785,4 +1774,0 @@ packages:` | −4 / +0 | 旧：`author-regex@1.0.0: resolution: {integrity: sha512-KbWgR8wOYRAPekEmMXrYYdc7BRyhn2Ftk7KWfMUnQ43hFdojWEFRxhhRUm3/OFEdPa1r0KAvTTg9YQK57xTe0g==}` |
| H023 | `@@ -1832,3 +1817,0 @@ packages:` | −3 / +0 | 旧：`buffer-crc32@0.2.13: resolution: {integrity: sha512-VO9Ht/+p3SN7SKWqcrgEzjGbRSJYTx+Q1pTQC0wrWqHx0vpJraQ6GtHx8tvcg1rlK1byhU5gccxgOgj7B0TDkQ==}` |
| H024 | `@@ -1846,4 +1828,0 @@ packages:` | −4 / +0 | 旧：`byte-counter@0.1.0: resolution: {integrity: sha512-jheRLVMeUKrDBjVw2O5+k4EvR4t9wtxHL+bo/LxfkxsVeuGMy3a5SEGgXdAFA4FSzTrU8rQXQIrsZ3oBq5a0pQ==}` |
| H025 | `@@ -1854,4 +1832,0 @@ packages:` | −4 / +0 | 旧：`cac@6.7.14: resolution: {integrity: sha512-b6Ilus+c3RrdDk+JhLKUAQfzzgLEPy6wcXqS7f/xe1EETvsDP6GORG7SFuOs6cID5YkqchW/LXZbX5bc8j7ZcQ==}` |
| H026 | `@@ -1862,8 +1836,0 @@ packages:` | −8 / +0 | 旧：`cacheable-lookup@7.0.0: resolution: {integrity: sha512-+qJyx4xiKra8mZrcwhjMRMUhD5NR1R8esPkzIYxX96JiecFoxAXFuz/GpR3+ev4PE1WamHip78wV0vcmPQtp8w==}` |
| H027 | `@@ -1884,2 +1851,2 @@ packages:` | −2 / +2 | 旧：`chai@5.3.3: resolution: {integrity: sha512-4zNhdJD/iOjSH0A05ea+Ke6MU5mmpQcbQsSOkgdaUMJ9zTlDTD/GYlwohmIE2u0gaxHYiVHEn1Fw9mZ/ktJWgw==}`<br>新：`chai@6.3.0: resolution: {integrity: sha512-XWAtwJ6OHO+tj0EKCs0Y2UamnyOxseZWltU4x2U2wh8g4AigdjwvtUjvLP2tqkA/avxHEtzxNaqGq/YGNwckKg==}` |
| H028 | `@@ -1908,4 +1874,0 @@ packages:` | −4 / +0 | 旧：`check-error@2.1.3: resolution: {integrity: sha512-PAJdDJusoxnwm1VwW07VWwUN1sl7smmC3OKggvndJFadxxDRyFJBX/ggnu/KE4kQAB7a3Dp8f/YXC1FlUprWmA==}` |
| H029 | `@@ -1994,8 +1956,0 @@ packages:` | −8 / +0 | 旧：`debug@2.6.9: resolution: {integrity: sha512-bC7ElrdJaJnPbAP+1EotYvqZsb3ecl5wi6Bfi6BJTUcNowp6cvspg0jXznRTKDjm/E7AdgFBVeAPVMNcKGsHMA==}` |
| H030 | `@@ -2014,4 +1968,0 @@ packages:` | −4 / +0 | 旧：`decompress-response@10.0.0: resolution: {integrity: sha512-oj7KWToJuuxlPr7VV0vabvxEIiqNMo+q0NueIiL3XhtwC6FVOX7Hr1c0C4eD0bmf7Zr+S/dSf2xvkH3Ad6sU3Q==}` |
| H031 | `@@ -2022,4 +1972,0 @@ packages:` | −4 / +0 | 旧：`deep-eql@5.0.2: resolution: {integrity: sha512-h5k/5U50IJJFpzfL6nO9jaaumfjO/f2NjK/oYB2Djzm4p9L+3T9qWpZqZ2hAbLPuuYq9wrU08WQyBTL5GbPk5Q==}` |
| H032 | `@@ -2112,3 +2059,3 @@ packages:` | −3 / +3 | 旧：`electron@38.8.6: resolution: {integrity: sha512-lyBhcVi9QYAZL6FO6r5twAWAjWnYomo3iVDvrb5SJZlq928BGemHOKG0tPIq41NOLaCu9f3XdEEjMkjQPjprRg==}`<br>新：`electron@44.10.0: resolution: {integrity: sha512-ss4pCfrQKV4TWkuVYtWB4HmeysPZgB96cSYNKYZv1UVCRP4vQMGNW5oopFbvx6Bbfce1XtP5pm5RDuKehp0svQ==}` |
| H033 | `@@ -2138,3 +2084,0 @@ packages:` | −3 / +0 | 旧：`error-ex@1.3.4: resolution: {integrity: sha512-sqQamAnR14VgCr1A618A3sGrygcpK+HEbenA/HiEAkkUwcZIIB/tgWqHFxWgOyDh4nB4JCRimh79dR5Ywc9MDQ==}` |
| H034 | `@@ -2149,2 +2093,2 @@ packages:` | −2 / +2 | 旧：`es-module-lexer@1.7.0: resolution: {integrity: sha512-jEQoCwk8hyb2AZziIOLhDqpm5+2ww5uIE6lkO/6jcOCusfk6LhMHpXXfBLXTZ7Ydyt0j4VoUQv6uGNYbdW+kBA==}`<br>新：`es-module-lexer@2.3.2: resolution: {integrity: sha512-poHGpORABojJJucnV9KbOavETW8lBVnphkW77ER5/BQ5Fz7oXSoCNek7IH3vR5nRjdsEz926ibFYX8KtLQmdyw==}` |
| H035 | `@@ -2196,5 +2139,0 @@ packages:` | −5 / +0 | 旧：`extract-zip@2.0.1: resolution: {integrity: sha512-GDhU9ntwuKyGXdZBUgTIe+vXnWj0fppUEtMDL0+idd5Sta8TGpHssn/eusA9mrPr9qNDym6SxAYZjNvCn/9RBg==}` |
| H036 | `@@ -2208,5 +2147,2 @@ packages:` | −5 / +2 | 旧：`fast-uri@3.1.8: resolution: {integrity: sha512-GZMtZUTNRpOVIECoXwLNZS5xUGE+mVNbTB8h/7Rwh2TFWcBQiPzTgyZi05BF9UMZKkLJv8XBRJTlU7zg8+ZfMg==}`<br>新：`fast-uri@3.1.9: resolution: {integrity: sha512-hS/0Wt3Ya043oKXs0sIxrMpKQITXhMLIrVAKKXi4gozGC9v7YRWVnXIZzjNPTO02M9BdxLCWqK1yRXgNziVyJQ==}` |
| H037 | `@@ -2238,4 +2173,0 @@ packages:` | −4 / +0 | 旧：`find-up@2.1.0: resolution: {integrity: sha512-NWzkk0jSJtTt08+FBFMvXoeZnOJD+jTtsRmBYbAIzJdX6l7dLgR7CTubCM5/eDdPUBvLCeVasP1brfVR/9/EZQ==}` |
| H038 | `@@ -2252,4 +2183,0 @@ packages:` | −4 / +0 | 旧：`form-data-encoder@4.1.0: resolution: {integrity: sha512-G6NsmEW15s0Uw9XnCg+33H3ViYRyiM0hMrMhhqQOR8NFc5GhYrI+6I3u7OTw7b91J2g8rtvMBZJDbcGb2YUniw==}` |
| H039 | `@@ -2315,4 +2242,0 @@ packages:` | −4 / +0 | 旧：`get-package-info@1.0.0: resolution: {integrity: sha512-SCbprXGAPdIhKAXiG+Mk6yeoFH61JlYunqdFQFHDtLjJlDjFf6x07dsS8acO+xWt52jpdVo49AlVDnUVK1sDNw==}` |
| H040 | `@@ -2327,4 +2250,0 @@ packages:` | −4 / +0 | 旧：`get-stream@9.0.1: resolution: {integrity: sha512-kVCxPF3vQM/N0B1PmoqVUqgHP+EeVjmZSQn+1oCRPxd2P21P2F19lIgbR3HBosbB1PUhOAoctJnfEn2GbN2eZA==}` |
| H041 | `@@ -2359,4 +2278,0 @@ packages:` | −4 / +0 | 旧：`got@14.6.6: resolution: {integrity: sha512-QLV1qeYSo5l13mQzWgP/y0LbMr5Plr5fJilgAIwgnwseproEbtNym8xpLsDzeZ6MWXgNE6kdWGBjdh3zT/Qerg==}` |
| H042 | `@@ -2394,3 +2309,0 @@ packages:` | −3 / +0 | 旧：`hosted-git-info@2.8.9: resolution: {integrity: sha512-mxIDAb9Lsm6DoOJ7xH+5+X4y1LU/4Hi50L9C5sIswK3JzULS4bwk1FvjdBgvYR4bzT4tuUQiC15FE2f5HbLvYw==}` |
| H043 | `@@ -2415,4 +2327,0 @@ packages:` | −4 / +0 | 旧：`http2-wrapper@2.2.1: resolution: {integrity: sha512-V5nVw1PAOgfI3Lmeaj2Exmeg7fenjhRUgz1lPSezy1CuhPYbgQtbQj4jZfEAEMlaL+vupsvhjqCyjzob0yxsmQ==}` |
| H044 | `@@ -2442,7 +2350,0 @@ packages:` | −7 / +0 | 旧：`is-arrayish@0.2.1: resolution: {integrity: sha512-zz06S8t0ozoDXMG+ube26zeCTNXcKIPJZJi8hBrF4idCLms4CG9QtK7qBl1boi5ODzFpjswb5JPmHCbMpjaYzg==}` |
| H045 | `@@ -2463,4 +2364,0 @@ packages:` | −4 / +0 | 旧：`is-stream@4.0.1: resolution: {integrity: sha512-Dnz92NInDqYckGEUJv689RbRiTSEHCQ7wOVeALbkOz999YpqT46yMRIGtSNl2iCL1waAZSx40+h59NV/EwzV/A==}` |
| H046 | `@@ -2504,3 +2401,0 @@ packages:` | −3 / +0 | 旧：`js-tokens@9.0.1: resolution: {integrity: sha512-mxa9E9ITFOt0ban3j6L5MpjwegGz6lBQmM1IJkWeBZGcMxto50+eWdjC/52xDbS2vy0k7vIMK0Fe2wfL9OQSpQ==}` |
| H047 | `@@ -2550,3 +2444,0 @@ packages:` | −3 / +0 | 旧：`keyv@5.6.0: resolution: {integrity: sha512-CYDD3SOtsHtyXeEORYRx2qBtpDJFjRTGXUtmNEMGyzYOKj1TE3tycdlho7kA1Ufx9OYWZzg52QFBGALTirzDSw==}` |
| H048 | `@@ -2636,8 +2527,0 @@ packages:` | −8 / +0 | 旧：`load-json-file@2.0.0: resolution: {integrity: sha512-3p6ZOGNbiX4CdvEd1VcE6yi78UrGNpjHO33noGwHCnT/o2fyllJDepsm8+mFFv/DvtwFHht5HIHSyOy5a+ChVQ==}` |
| H049 | `@@ -2650,4 +2533,0 @@ packages:` | −4 / +0 | 旧：`lodash.get@4.4.2: resolution: {integrity: sha512-z+Uw/vLuy6gQe8cfaFWD7p0wVv8fJl3mbzXh33RS+0oW2wvUqiRXiQ69gLWSLpgB5/6sU+r6BlQR0MBILadqTQ==}` |
| H050 | `@@ -2670,3 +2549,0 @@ packages:` | −3 / +0 | 旧：`loupe@3.2.1: resolution: {integrity: sha512-CdzqowRJCeLU72bHvWqwRBBlLcMEtIvGrlvef74kMnV2AolS9Y8xUv1I0U/MNAWMhBlKIoyuEgoJ0t/bbwHbLQ==}` |
| H051 | `@@ -2677,4 +2553,0 @@ packages:` | −4 / +0 | 旧：`lowercase-keys@3.0.0: resolution: {integrity: sha512-ozCC6gdQ+glXOQsveKD0YsDy8DSQFjDTz4zyzEHNV5+JP5D62LmfDZ6o1cycFx9ouG940M5dE8C8CTewdj2YWQ==}` |
| H052 | `@@ -2868,4 +2740,0 @@ packages:` | −4 / +0 | 旧：`mimic-response@4.0.0: resolution: {integrity: sha512-e5ISH9xMYU0DzrT+jl8q2ze9D6eWBto+I8CNpe+VI+K2J/F/k3PdkdTdz4wvGVH4NTpo+NRYTVIuMQEMMcsLqg==}` |
| H053 | `@@ -2902,3 +2770,0 @@ packages:` | −3 / +0 | 旧：`ms@2.0.0: resolution: {integrity: sha512-Tpp60P6IUJDTuOq/5Z8cdskzJujfwqfOTkrwIwj7IRISpnkJnT6SyJ4PCPnGMoFjC9ddhal5KVIYtAt97ix05A==}` |
| H054 | `@@ -2937,3 +2802,0 @@ packages:` | −3 / +0 | 旧：`normalize-package-data@2.5.0: resolution: {integrity: sha512-/5CMN3T0R4XTj4DcGaexo+roZSdSFW/0AOOTROrjxzCG1wrWXEsGbRKevjlIL+ZDE4sZlJr5ED4YW0yqmkK+eA==}` |
| H055 | `@@ -2944,4 +2806,0 @@ packages:` | −4 / +0 | 旧：`normalize-url@8.1.1: resolution: {integrity: sha512-JYc0DPlpGWB40kH5g07gGTrYuMqV653k3uBKY6uITPWds3M0ov3GaWGp9lbE3Bzngx8+XkfzgvASb9vk9JDFXQ==}` |
| H056 | `@@ -2951,0 +2811,4 @@ packages:` | −0 / +4 | 新：`obug@2.2.1: resolution: {integrity: sha512-XrsrhT5sybtKI6wakr2SPOlGZWWYbUXZ7a0jT8/QOeAPau+1X/bSegNe5YR75oJmEZQbKningirmGOEJCIk61Q==}` |
| H057 | `@@ -2975,8 +2837,0 @@ packages:` | −8 / +0 | 旧：`p-cancelable@4.0.1: resolution: {integrity: sha512-wBowNApzd45EIKdO1LaU+LrMBwAcjfPaYtVzV3lmfM3gf8Z4CHZsiIqlM8TZZ8okYvh5A1cP6gTfCRQtwUpaUg==}` |
| H058 | `@@ -2987,8 +2841,0 @@ packages:` | −8 / +0 | 旧：`p-locate@2.0.0: resolution: {integrity: sha512-nQja7m7gSKuewoVRen45CtVfODR3crN3goVQ0DDZ9N3yHxgpkuBhZqsaiotSQRrADUrne346peY7kT3TSACykg==}` |
| H059 | `@@ -2998,4 +2844,0 @@ packages:` | −4 / +0 | 旧：`parse-author@2.0.0: resolution: {integrity: sha512-yx5DfvkN8JsHL2xk2Os9oTia467qnvRgey4ahSm2X8epehBLx/gWLcy5KI+Y36ful5DzGbCS6RazqZGgy1gHNw==}` |
| H060 | `@@ -3005,8 +2847,0 @@ packages:` | −8 / +0 | 旧：`parse-json@2.2.0: resolution: {integrity: sha512-QR/GGaKCkhwk1ePQNYDRKYZ3mwU9ypsKhB0XyFnLQdomyEqk3e8wpW3V5Jp88zbxK4n5ST1nqo+g9juTpownhQ==}` |
| H061 | `@@ -3021,3 +2855,0 @@ packages:` | −3 / +0 | 旧：`path-parse@1.0.7: resolution: {integrity: sha512-LDJzPVEEEPR+y48z93A0Ed0yXb8pAByGWo/k5YYdYgpY2/2EsOsksJrq7lOHxryrVOn1ejG6oAp8ahvOIQD8sw==}` |
| H062 | `@@ -3028,4 +2859,0 @@ packages:` | −4 / +0 | 旧：`path-type@2.0.0: resolution: {integrity: sha512-dUnb5dXUf+kzhC/W/F4e5/SkluXIFf5VUHolW1Eg1irn1hGWjPGdsRcvYJ1nD6lhk8Ir7VM0bHJKsYTx8Jx9OQ==}` |
| H063 | `@@ -3035,4 +2862,0 @@ packages:` | −4 / +0 | 旧：`pathval@2.0.1: resolution: {integrity: sha512-//nshmD55c46FuFw26xV/xFAaB5HF9Xdap7HJBBnrKdAd6/GxDBaNA1870O79+9ueg61cZLSVc+OaFlfmObYVQ==}` |
| H064 | `@@ -3056,3 +2879,0 @@ packages:` | −3 / +0 | 旧：`pend@1.2.0: resolution: {integrity: sha512-F3asv42UuXchdzt+xXqfW1OGlVBe+mxa2mqI0pg5yAHZPvFmY3Y6drSf/GQ1A86WgWEN9Kzh/WrgKa6iGcHXLg==}` |
| H065 | `@@ -3066,4 +2886,0 @@ packages:` | −4 / +0 | 旧：`pify@2.3.0: resolution: {integrity: sha512-udgsAY+fTnvv7kI7aaxbqwWNb0AHiB0qBO89PZKPkoTmGOgdbrHDKD+0B2X4uTfJ/FT1R09r9gTsjUjNJotuog==}` |
| H066 | `@@ -3201,8 +3017,0 @@ packages:` | −8 / +0 | 旧：`read-pkg-up@2.0.0: resolution: {integrity: sha512-1orxQfbWGUiTn9XsPlChs6rLie/AV9jwZTGmu2NZw/CUDJQchXJFYE0Fq5j7+n558T1JhDWLdhyd1Zj+wLY//w==}` |
| H067 | `@@ -3246,5 +3054,0 @@ packages:` | −5 / +0 | 旧：`resolve@1.22.13: resolution: {integrity: sha512-Dj/cW9zBV2aRj6XzCxuGIs3ESZKv02jixne3q6jFZYZ3/Tg09gHHviSMDL4kObh9pqSahdRHEnDoaP2gn8YLhA==}` |
| H068 | `@@ -3254,4 +3057,0 @@ packages:` | −4 / +0 | 旧：`responselike@4.0.2: resolution: {integrity: sha512-cGk8IbWEAnaCpdAt1BHzJ3Ahz5ewDJa0KseTsE3qIRMJ3C698W8psM7byCeWVpd/Ha7FUYzuRVzXoKoM6nRUbA==}` |
| H069 | `@@ -3398,12 +3197,0 @@ packages:` | −12 / +0 | 旧：`spdx-correct@3.2.0: resolution: {integrity: sha512-kN9dJbvnySHULIluDHy32WHRUu3Og7B9sbY7tsFLctQkIqnMh3hErYgdMjTYuqmcXX+lK5T1lnUt3G7zNswmZA==}` |
| H070 | `@@ -3420,2 +3208,2 @@ packages:` | −2 / +2 | 旧：`std-env@3.10.0: resolution: {integrity: sha512-5GS12FdOZNliM5mAOxFRg7Ir0pWz8MdpYm6AY6VPkGpbA7ZzmbzNcBJQ0GPvvyWgcY7QAhCgf9Uy89I03faLkg==}`<br>新：`std-env@4.3.0: resolution: {integrity: sha512-OtU/EgQ1kIm5KwqQpBC6ZEMXrZRui11w8zgfTWp8cdO9B8OaPsbA8bTHO2P+HNo1VlUTGMVBwPhydu6poeXiag==}` |
| H071 | `@@ -3437,7 +3224,0 @@ packages:` | −7 / +0 | 旧：`strip-bom@3.0.0: resolution: {integrity: sha512-vavAMRXOgBVNF6nyEEmL3DBK19iRpDcoIwW+swQ+CbGiu7lju6t+JklA1MHweoWtadgt4ISVUsXLyDq34ddcwA==}` |
| H072 | `@@ -3461,4 +3241,0 @@ packages:` | −4 / +0 | 旧：`supports-preserve-symlinks-flag@1.0.0: resolution: {integrity: sha512-ot0WnXS9fgdkgIcePe6RHNk1WA8+muPa6cSjeR3V8K27q9BB1rTE3R1p7Hv0z1ZyAc8s6Vvv8DIyWf681MAt0w==}` |
| H073 | `@@ -3499,2 +3276,3 @@ packages:` | −2 / +3 | 旧：`tinyexec@0.3.2: resolution: {integrity: sha512-KQQR9yN7R5+OSwaK0XQoj22pwHoTlgYqmUscPYoknOoWCWfj/5/ABTMRi69FrKU5ffPVh5QcFikpWJI/P1ocHA==}`<br>新：`tinyexec@1.3.1: resolution: {integrity: sha512-GCvB3aoys96IuDFBMcTB46JOR6mdMtAToqwiW8JlWhsoh1mhHi/xn9ss/Dg7N555GiJyEt2qzoG/NHCwM6h1EA==}` |
| H074 | `@@ -3506,10 +3284,2 @@ packages:` | −10 / +2 | 旧：`tinypool@1.1.1: resolution: {integrity: sha512-Zba82s87IFq9A9XmjiX5uZA/ARWDrB03OHlq+Vw1fSdt0I+4/Kutwy8BP4Y/y/aORMo61FQ0vIb5j44vSo5Pkg==}`<br>新：`tinyrainbow@3.2.0: resolution: {integrity: sha512-LgO3D9yZJjApUiuUfl9iFAwrtaX4+lok3wJIqttGoKCHlWUqHqbQpnxCf82L8FjgKsh4iGo78hqJwgL8F6To2A==}` |
| H075 | `@@ -3545,4 +3314,0 @@ packages:` | −4 / +0 | 旧：`type-fest@4.41.0: resolution: {integrity: sha512-TeTSQ6H5YHvpqVwBRcnLDCBnDOHWYu7IvGbHT6N8AOymcr9PJGjc1GTtiWZTYg0NCgYwvnYWEkVChQAr9bjfwA==}` |
| H076 | `@@ -3571,2 +3337,2 @@ packages:` | −2 / +2 | 旧：`undici@6.29.0: resolution: {integrity: sha512-R+RODBqp6i2pPflGdq+xIOUkl+RNfGgHwoinecKu/JCuf2uO06cOKoDbI2P7Dn6KcswdKwrczbU6IYJ6K8X+wg==}`<br>新：`undici@6.29.1: resolution: {integrity: sha512-EvRlUt/QqAEvXdQeRMYUfwOQsfzpDztykrG2owGEE/rBOBoYv9uF39ZzsNDh4lTFHhTr2XOZjKkYgueD12ZmGA==}` |
| H077 | `@@ -3574,0 +3341,4 @@ packages:` | −0 / +4 | 新：`undici@7.30.1: resolution: {integrity: sha512-03KrMbjIFDWQR5RNPrSw3bd1r12JpyFQl9/yxjUbJtqkjmllqC5lFjZh6ujeuJCKr8EOQvRW872Oy/az+nLYxg==}` |
| H078 | `@@ -3636,3 +3405,0 @@ packages:` | −3 / +0 | 旧：`validate-npm-package-license@3.0.4: resolution: {integrity: sha512-DpKm2Ui/xN7/HQKCtpZxoRWBhZ9Z0kqtygG8XCgNQ8ZlDnxuQmWhj566j8fN4Cu3/JmbhsDo7fcAJq4s9h27Ew==}` |
| H079 | `@@ -3645,5 +3411,0 @@ packages:` | −5 / +0 | 旧：`vite-node@3.2.4: resolution: {integrity: sha512-EbKSKh+bh1E1IFxeO0pg1n4dvoOTt0UDiXMd/qn++r98+jPO1xtJilvXldeuQ8giIB5IkpjCgMleHMNEsGH6pg==}` |
| H080 | `@@ -3690,3 +3452,3 @@ packages:` | −3 / +3 | 旧：`vitest@3.2.7: resolution: {integrity: sha512-KrxIJ62Fd89gfysR4WotlgZABiz2dqFPgqGzX7s+CwsqLFomRH7777ZcrOD6+WVAh7khPQP41A+BKbpcJFrdEg==}`<br>新：`vitest@4.1.12: resolution: {integrity: sha512-5eWdz2yb3ajxWF3C8C4TjkXl7FGm3n2E/VlazALrQHzK7nYMSGFnCZto0bbPNl77AwkOZVLk0YnBAejUu0NiWA==}` |
| H081 | `@@ -3696,4 +3458,8 @@ packages:` | −4 / +8 | 旧：`'@types/debug': ^4.1.12 '@types/node': ^18.0.0 \|\| ^20.0.0 \|\| >=22.0.0`<br>新：`'@opentelemetry/api': ^1.9.0 '@types/node': ^20.0.0 \|\| ^22.0.0 \|\| >=24.0.0` |
| H082 | `@@ -3701,0 +3468 @@ packages:` | −0 / +1 | 新：`vite: ^6.0.0 \|\| ^7.0.0 \|\| ^8.0.0` |
| H083 | `@@ -3705 +3472 @@ packages:` | −1 / +1 | 旧：`'@types/debug':`<br>新：`'@opentelemetry/api':` |
| H084 | `@@ -3709 +3476,9 @@ packages:` | −1 / +9 | 旧：`'@vitest/browser':`<br>新：`'@vitest/browser-playwright': optional: true` |
| H085 | `@@ -3790,3 +3564,0 @@ packages:` | −3 / +0 | 旧：`yauzl@2.10.0: resolution: {integrity: sha512-p4a9I6X6nu6IhoGmBqAcbJy1mlC4j27vEPZX9F4L4/vZT3Lyq1VkFHw/V/PUcB9Buo+DG3iHkT0x3Qya58zc3g==}` |
| H086 | `@@ -3797,2 +3569,2 @@ packages:` | −2 / +2 | 旧：`zod@4.3.6: resolution: {integrity: sha512-rftlrkhHZOcjDwkGlnUtZZkvaPHCsDATp4pGpuOOMDaTdDDXF91wuVDJoWoPsKX/3YPQ5fHuF3STjcYyKr+Qhg==}`<br>新：`zod@4.6.6: resolution: {integrity: sha512-4UmzQUF5fxvfcYHlbjBmejU+w+hbDnWFx4aS8kBx7nPBHcO2SqPbpAG8snbdg+Xse4pRefR98hgjFgIMCI/UhA==}` |
| H087 | `@@ -3936,0 +3709,2 @@ snapshots:` | −0 / +2 | 新：`'@electron-internal/extract-zip@1.0.6': {}` |
| H088 | `@@ -3954,14 +3727,0 @@ snapshots:` | −14 / +0 | 旧：`'@electron/get@2.0.3(supports-color@7.2.0)': dependencies:` |
| H089 | `@@ -3982 +3742 @@ snapshots:` | −1 / +1 | 旧：`'@electron/get@4.0.3(supports-color@7.2.0)':`<br>新：`'@electron/get@5.1.0(supports-color@7.2.0)':` |
| H090 | `@@ -3986 +3745,0 @@ snapshots:` | −1 / +0 | 旧：`got: 14.6.6` |
| H091 | `@@ -3992 +3751 @@ snapshots:` | −1 / +1 | 旧：`global-agent: 3.0.0`<br>新：`undici: 7.30.1` |
| H092 | `@@ -4031 +3790 @@ snapshots:` | −1 / +1 | 旧：`'@electron/packager@19.0.1(supports-color@7.2.0)':`<br>新：`'@electron/packager@20.3.0(supports-color@7.2.0)':` |
| H093 | `@@ -4032,0 +3792 @@ snapshots:` | −0 / +1 | 新：`'@electron-internal/extract-zip': 1.0.6` |
| H094 | `@@ -4034 +3794 @@ snapshots:` | −1 / +1 | 旧：`'@electron/get': 4.0.3(supports-color@7.2.0)`<br>新：`'@electron/get': 5.1.0(supports-color@7.2.0)` |
| H095 | `@@ -4041 +3800,0 @@ snapshots:` | −1 / +0 | 旧：`extract-zip: 2.0.1(supports-color@7.2.0)` |
| H096 | `@@ -4044 +3802,0 @@ snapshots:` | −1 / +0 | 旧：`get-package-info: 1.0.0(supports-color@7.2.0)` |
| H097 | `@@ -4047 +3804,0 @@ snapshots:` | −1 / +0 | 旧：`parse-author: 2.0.0` |
| H098 | `@@ -4050 +3806,0 @@ snapshots:` | −1 / +0 | 旧：`resolve: 1.22.13` |
| H099 | `@@ -4244 +4000 @@ snapshots:` | −1 / +1 | 旧：`zod: 4.3.6`<br>新：`zod: 4.6.6` |
| H100 | `@@ -4417,2 +4172,0 @@ snapshots:` | −2 / +0 | 旧：`'@keyv/serialize@1.1.1': {}` |
| H101 | `@@ -4961,2 +4714,0 @@ snapshots:` | −2 / +0 | 旧：`'@sec-ant/readable-stream@0.4.1': {}` |
| H102 | `@@ -4965 +4717 @@ snapshots:` | −1 / +1 | 旧：`'@sindresorhus/is@7.2.0': {}`<br>新：`'@standard-schema/spec@1.1.0': {}` |
| H103 | `@@ -5116,4 +4867,0 @@ snapshots:` | −4 / +0 | 旧：`'@types/node@22.20.5': dependencies:` |
| H104 | `@@ -5140,5 +4887,0 @@ snapshots:` | −5 / +0 | 旧：`'@types/yauzl@2.10.3': dependencies:` |
| H105 | `@@ -5159 +4902 @@ snapshots:` | −1 / +1 | 旧：`'@vitest/expect@3.2.7':`<br>新：`'@vitest/expect@4.1.12':` |
| H106 | `@@ -5160,0 +4904 @@ snapshots:` | −0 / +1 | 新：`'@standard-schema/spec': 1.1.0` |
| H107 | `@@ -5162,4 +4906,4 @@ snapshots:` | −4 / +4 | 旧：`'@vitest/spy': 3.2.7 '@vitest/utils': 3.2.7`<br>新：`'@vitest/spy': 4.1.12 '@vitest/utils': 4.1.12` |
| H108 | `@@ -5167 +4911 @@ snapshots:` | −1 / +1 | 旧：`'@vitest/mocker@3.2.7(vite@6.4.4(@types/node@24.19.2)(jiti@2.7.0)(lightningcss@1.32.0))':`<br>新：`'@vitest/mocker@4.1.12(vite@6.4.4(@types/node@24.19.2)(jiti@2.7.0)(lightningcss@1.32.0))':` |
| H109 | `@@ -5169 +4913 @@ snapshots:` | −1 / +1 | 旧：`'@vitest/spy': 3.2.7`<br>新：`'@vitest/spy': 4.1.12` |
| H110 | `@@ -5175 +4919 @@ snapshots:` | −1 / +1 | 旧：`'@vitest/pretty-format@3.2.7':`<br>新：`'@vitest/pretty-format@4.1.12':` |
| H111 | `@@ -5177 +4921 @@ snapshots:` | −1 / +1 | 旧：`tinyrainbow: 2.0.0`<br>新：`tinyrainbow: 3.2.0` |
| H112 | `@@ -5179 +4923 @@ snapshots:` | −1 / +1 | 旧：`'@vitest/runner@3.2.7':`<br>新：`'@vitest/runner@4.1.12':` |
| H113 | `@@ -5181 +4925 @@ snapshots:` | −1 / +1 | 旧：`'@vitest/utils': 3.2.7`<br>新：`'@vitest/utils': 4.1.12` |
| H114 | `@@ -5183 +4926,0 @@ snapshots:` | −1 / +0 | 旧：`strip-literal: 3.1.0` |
| H115 | `@@ -5185 +4928 @@ snapshots:` | −1 / +1 | 旧：`'@vitest/snapshot@3.2.7':`<br>新：`'@vitest/snapshot@4.1.12':` |
| H116 | `@@ -5187 +4930,2 @@ snapshots:` | −1 / +2 | 旧：`'@vitest/pretty-format': 3.2.7`<br>新：`'@vitest/pretty-format': 4.1.12 '@vitest/utils': 4.1.12` |
| H117 | `@@ -5191,3 +4935 @@ snapshots:` | −3 / +1 | 旧：`'@vitest/spy@3.2.7': dependencies:`<br>新：`'@vitest/spy@4.1.12': {}` |
| H118 | `@@ -5195 +4937 @@ snapshots:` | −1 / +1 | 旧：`'@vitest/utils@3.2.7':`<br>新：`'@vitest/utils@4.1.12':` |
| H119 | `@@ -5197,3 +4939,3 @@ snapshots:` | −3 / +3 | 旧：`'@vitest/pretty-format': 3.2.7 loupe: 3.2.1`<br>新：`'@vitest/pretty-format': 4.1.12 convert-source-map: 2.0.0` |
| H120 | `@@ -5214 +4956 @@ snapshots:` | −1 / +1 | 旧：`fast-uri: 3.1.8`<br>新：`fast-uri: 3.1.9` |
| H121 | `@@ -5310,2 +5051,0 @@ snapshots:` | −2 / +0 | 旧：`author-regex@1.0.0: {}` |
| H122 | `@@ -5350,2 +5089,0 @@ snapshots:` | −2 / +0 | 旧：`buffer-crc32@0.2.13: {}` |
| H123 | `@@ -5380,2 +5117,0 @@ snapshots:` | −2 / +0 | 旧：`byte-counter@0.1.0: {}` |
| H124 | `@@ -5384,2 +5119,0 @@ snapshots:` | −2 / +0 | 旧：`cac@6.7.14: {}` |
| H125 | `@@ -5388,12 +5121,0 @@ snapshots:` | −12 / +0 | 旧：`cacheable-lookup@7.0.0: {} cacheable-request@13.0.19:` |
| H126 | `@@ -5419,7 +5141 @@ snapshots:` | −7 / +1 | 旧：`chai@5.3.3: dependencies:`<br>新：`chai@6.3.0: {}` |
| H127 | `@@ -5444,2 +5159,0 @@ snapshots:` | −2 / +0 | 旧：`check-error@2.1.3: {}` |
| H128 | `@@ -5519,6 +5232,0 @@ snapshots:` | −6 / +0 | 旧：`debug@2.6.9(supports-color@7.2.0): dependencies:` |
| H129 | `@@ -5535,4 +5242,0 @@ snapshots:` | −4 / +0 | 旧：`decompress-response@10.0.0: dependencies:` |
| H130 | `@@ -5543,2 +5246,0 @@ snapshots:` | −2 / +0 | 旧：`deep-eql@5.0.2: {}` |
| H131 | `@@ -5681 +5383 @@ snapshots:` | −1 / +1 | 旧：`electron@38.8.6(supports-color@7.2.0):`<br>新：`electron@44.10.0(supports-color@7.2.0):` |
| H132 | `@@ -5683,3 +5385,3 @@ snapshots:` | −3 / +3 | 旧：`'@electron/get': 2.0.3(supports-color@7.2.0) '@types/node': 22.20.5`<br>新：`'@electron-internal/extract-zip': 1.0.6 '@electron/get': 5.1.0(supports-color@7.2.0)` |
| H133 | `@@ -5706,4 +5407,0 @@ snapshots:` | −4 / +0 | 旧：`error-ex@1.3.4: dependencies:` |
| H134 | `@@ -5714 +5412 @@ snapshots:` | −1 / +1 | 旧：`es-module-lexer@1.7.0: {}`<br>新：`es-module-lexer@2.3.2: {}` |
| H135 | `@@ -5777,10 +5474,0 @@ snapshots:` | −10 / +0 | 旧：`extract-zip@2.0.1(supports-color@7.2.0): dependencies:` |
| H136 | `@@ -5791,5 +5479 @@ snapshots:` | −5 / +1 | 旧：`fast-uri@3.1.8: {} fd-slicer@1.1.0:`<br>新：`fast-uri@3.1.9: {}` |
| H137 | `@@ -5815,4 +5498,0 @@ snapshots:` | −4 / +0 | 旧：`find-up@2.1.0: dependencies:` |
| H138 | `@@ -5829,2 +5508,0 @@ snapshots:` | −2 / +0 | 旧：`form-data-encoder@4.1.0: {}` |
| H139 | `@@ -5909,9 +5586,0 @@ snapshots:` | −9 / +0 | 旧：`get-package-info@1.0.0(supports-color@7.2.0): dependencies:` |
| H140 | `@@ -5927,5 +5595,0 @@ snapshots:` | −5 / +0 | 旧：`get-stream@9.0.1: dependencies:` |
| H141 | `@@ -5985,15 +5648,0 @@ snapshots:` | −15 / +0 | 旧：`got@14.6.6: dependencies:` |
| H142 | `@@ -6044,2 +5692,0 @@ snapshots:` | −2 / +0 | 旧：`hosted-git-info@2.8.9: {}` |
| H143 | `@@ -6066,5 +5712,0 @@ snapshots:` | −5 / +0 | 旧：`http2-wrapper@2.2.1: dependencies:` |
| H144 | `@@ -6096,6 +5737,0 @@ snapshots:` | −6 / +0 | 旧：`is-arrayish@0.2.1: {} is-core-module@2.17.0:` |
| H145 | `@@ -6110,2 +5745,0 @@ snapshots:` | −2 / +0 | 旧：`is-stream@4.0.1: {}` |
| H146 | `@@ -6136,2 +5769,0 @@ snapshots:` | −2 / +0 | 旧：`js-tokens@9.0.1: {}` |
| H147 | `@@ -6178,4 +5809,0 @@ snapshots:` | −4 / +0 | 旧：`keyv@5.6.0: dependencies:` |
| H148 | `@@ -6258,12 +5885,0 @@ snapshots:` | −12 / +0 | 旧：`load-json-file@2.0.0: dependencies:` |
| H149 | `@@ -6274,2 +5889,0 @@ snapshots:` | −2 / +0 | 旧：`lodash.get@4.4.2: {}` |
| H150 | `@@ -6290,2 +5903,0 @@ snapshots:` | −2 / +0 | 旧：`loupe@3.2.1: {}` |
| H151 | `@@ -6294,2 +5905,0 @@ snapshots:` | −2 / +0 | 旧：`lowercase-keys@3.0.0: {}` |
| H152 | `@@ -6697,2 +6306,0 @@ snapshots:` | −2 / +0 | 旧：`mimic-response@4.0.0: {}` |
| H153 | `@@ -6727,2 +6334,0 @@ snapshots:` | −2 / +0 | 旧：`ms@2.0.0: {}` |
| H154 | `@@ -6751 +6357 @@ snapshots:` | −1 / +1 | 旧：`undici: 6.29.0`<br>新：`undici: 6.29.1` |
| H155 | `@@ -6762,7 +6367,0 @@ snapshots:` | −7 / +0 | 旧：`normalize-package-data@2.5.0: dependencies:` |
| H156 | `@@ -6771,2 +6369,0 @@ snapshots:` | −2 / +0 | 旧：`normalize-url@8.1.1: {}` |
| H157 | `@@ -6774,0 +6372,2 @@ snapshots:` | −0 / +2 | 新：`obug@2.2.1: {}` |
| H158 | `@@ -6802,6 +6400,0 @@ snapshots:` | −6 / +0 | 旧：`p-cancelable@4.0.1: {} p-limit@1.3.0:` |
| H159 | `@@ -6812,6 +6404,0 @@ snapshots:` | −6 / +0 | 旧：`p-locate@2.0.0: dependencies:` |
| H160 | `@@ -6820,4 +6406,0 @@ snapshots:` | −4 / +0 | 旧：`parse-author@2.0.0: dependencies:` |
| H161 | `@@ -6834,6 +6416,0 @@ snapshots:` | −6 / +0 | 旧：`parse-json@2.2.0: dependencies:` |
| H162 | `@@ -6844,2 +6420,0 @@ snapshots:` | −2 / +0 | 旧：`path-parse@1.0.7: {}` |
| H163 | `@@ -6851,4 +6425,0 @@ snapshots:` | −4 / +0 | 旧：`path-type@2.0.0: dependencies:` |
| H164 | `@@ -6857,2 +6427,0 @@ snapshots:` | −2 / +0 | 旧：`pathval@2.0.1: {}` |
| H165 | `@@ -6872,2 +6440,0 @@ snapshots:` | −2 / +0 | 旧：`pend@1.2.0: {}` |
| H166 | `@@ -6878,2 +6444,0 @@ snapshots:` | −2 / +0 | 旧：`pify@2.3.0: {}` |
| H167 | `@@ -7027,11 +6591,0 @@ snapshots:` | −11 / +0 | 旧：`read-pkg-up@2.0.0: dependencies:` |
| H168 | `@@ -7098,7 +6651,0 @@ snapshots:` | −7 / +0 | 旧：`resolve@1.22.13: dependencies:` |
| H169 | `@@ -7109,4 +6655,0 @@ snapshots:` | −4 / +0 | 旧：`responselike@4.0.2: dependencies:` |
| H170 | `@@ -7282,14 +6824,0 @@ snapshots:` | −14 / +0 | 旧：`spdx-correct@3.2.0: dependencies:` |
| H171 | `@@ -7303 +6832 @@ snapshots:` | −1 / +1 | 旧：`std-env@3.10.0: {}`<br>新：`std-env@4.3.0: {}` |
| H172 | `@@ -7324,6 +6852,0 @@ snapshots:` | −6 / +0 | 旧：`strip-bom@3.0.0: {} strip-literal@3.1.0:` |
| H173 | `@@ -7350,2 +6872,0 @@ snapshots:` | −2 / +0 | 旧：`supports-preserve-symlinks-flag@1.0.0: {}` |
| H174 | `@@ -7389 +6910 @@ snapshots:` | −1 / +1 | 旧：`tinyexec@0.3.2: {}`<br>新：`tinyexec@1.3.1: {}` |
| H175 | `@@ -7396,5 +6917 @@ snapshots:` | −5 / +1 | 旧：`tinypool@1.1.1: {} tinyrainbow@2.0.0: {}`<br>新：`tinyrainbow@3.2.0: {}` |
| H176 | `@@ -7423,2 +6939,0 @@ snapshots:` | −2 / +0 | 旧：`type-fest@4.41.0: {}` |
| H177 | `@@ -7437 +6952,4 @@ snapshots:` | −1 / +4 | 旧：`undici@6.29.0: {}`<br>新：`undici@6.29.1: {} undici@7.30.1:` |
| H178 | `@@ -7509,5 +7026,0 @@ snapshots:` | −5 / +0 | 旧：`validate-npm-package-license@3.0.4: dependencies:` |
| H179 | `@@ -7524,21 +7036,0 @@ snapshots:` | −21 / +0 | 旧：`vite-node@3.2.4(@types/node@24.19.2)(jiti@2.7.0)(lightningcss@1.32.0)(supports-color@7.2.0): dependencies:` |
| H180 | `@@ -7559 +7051 @@ snapshots:` | −1 / +1 | 旧：`vitest@3.2.7(@types/debug@4.1.13)(@types/node@24.19.2)(jiti@2.7.0)(lightningcss@1.32.0)(supports-color@7.2.0):`<br>新：`vitest@4.1.12(@opentelemetry/api@1.9.1)(@types/node@24.19.2)(vite@6.4.4(@types/node@24.19.2)(jiti@2.7.0)(lightningcss@1.32.0)):` |
| H181 | `@@ -7561,10 +7053,8 @@ snapshots:` | −10 / +8 | 旧：`'@types/chai': 5.2.3 '@vitest/expect': 3.2.7`<br>新：`'@vitest/expect': 4.1.12 '@vitest/mocker': 4.1.12(vite@6.4.4(@types/node@24.19.2)(jiti@2.7.0)(lightningcss@1.32.0))` |
| H182 | `@@ -7572,0 +7063 @@ snapshots:` | −0 / +1 | 新：`obug: 2.2.1` |
| H183 | `@@ -7575 +7066 @@ snapshots:` | −1 / +1 | 旧：`std-env: 3.10.0`<br>新：`std-env: 4.3.0` |
| H184 | `@@ -7577 +7068 @@ snapshots:` | −1 / +1 | 旧：`tinyexec: 0.3.2`<br>新：`tinyexec: 1.3.1` |
| H185 | `@@ -7579,2 +7070 @@ snapshots:` | −2 / +1 | 旧：`tinypool: 1.1.1 tinyrainbow: 2.0.0`<br>新：`tinyrainbow: 3.2.0` |
| H186 | `@@ -7582 +7071,0 @@ snapshots:` | −1 / +0 | 旧：`vite-node: 3.2.4(@types/node@24.19.2)(jiti@2.7.0)(lightningcss@1.32.0)(supports-color@7.2.0)` |
| H187 | `@@ -7585 +7074 @@ snapshots:` | −1 / +1 | 旧：`'@types/debug': 4.1.13`<br>新：`'@opentelemetry/api': 1.9.1` |
| H188 | `@@ -7588,3 +7076,0 @@ snapshots:` | −3 / +0 | 旧：`- jiti - less` |
| H189 | `@@ -7592,8 +7077,0 @@ snapshots:` | −8 / +0 | 旧：`- sass - sass-embedded` |
| H190 | `@@ -7664,5 +7141,0 @@ snapshots:` | −5 / +0 | 旧：`yauzl@2.10.0: dependencies:` |
| H191 | `@@ -7671 +7144 @@ snapshots:` | −1 / +1 | 旧：`zod@4.3.6: {}`<br>新：`zod@4.6.6: {}` |

### F136 · `windows/pnpm-workspace.yaml`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/pnpm-workspace.yaml)

固定安全overrides、release-age精确例外和既有脚本构建允许项。

规范化Git blob：`eb86879a2db14c3e80b7cf990feeac5aec6d367e`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -5,0 +6,3 @@ verifyDepsBeforeRun: false` | −0 / +3 | 新：`# Official stable release verified against electron/electron; includes #52633. minimumReleaseAgeExclude:` |
| H002 | `@@ -8,0 +12,5 @@ overrides:` | −0 / +5 | 新：`# GHSA-mrhx-c7xc-m3w5: reject oversized collections before walking elements. '@github/copilot-sdk>zod': '4.6.6'` |

### F137 · `windows/scripts/package-portable.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/scripts/package-portable.mjs)

打包读取实际安装Electron版本，避免旧硬编码ABI/下载版本。

规范化Git blob：`aa5b67b21a502f591424e7e9faa6101be087f960`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -64 +64 @@ const paths = await packager({` | −1 / +1 | 旧：`electronVersion: '38.8.6',`<br>新：`electronVersion: require('electron/package.json').version,` |

### F138 · `windows/test/fixtures/WindowProbe.cs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/fixtures/WindowProbe.cs)

Windows物理像素鼠标坐标和非零移动事件，保留真实目标窗口命中保护。

规范化Git blob：`042cd9b17c2fcdccdad787d5a7f77257670f86c2`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -14,0 +15 @@ class WindowProbe {` | −0 / +1 | 新：`[DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);` |
| H002 | `@@ -20 +20,0 @@ class WindowProbe {` | −1 / +0 | 旧：`[DllImport("user32.dll")] static extern int GetSystemMetrics(int index);` |
| H003 | `@@ -47,0 +48 @@ class WindowProbe {` | −0 / +1 | 新：`SetThreadDpiAwarenessContext(new IntPtr(-4));` |
| H004 | `@@ -60 +61,13 @@ class WindowProbe {` | −1 / +13 | 旧：`if(args[0]=="move") {int x=int.Parse(args[1]),y=int.Parse(args[2]);mouse_event(0xC001,(uint)((x-GetSystemMetrics(76)+0.5)*65536/GetSystemMetrics(78)),(uint)((y-GetSystemMetrics(77)+0.5)*6553`<br>新：`if(args[0]=="move") { // Callers already supply physical screen pixels. Normalizing them again` |

### F139 · `windows/test/scripts/component-removal-check.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/component-removal-check.mjs)

Windows本机 component-removal-check.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`55823c4adbd6d99d5bc9ef9ca93ad05f7441f8f1`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';` |
| H002 | `@@ -23,4 +24 @@ export async function checkComponentRemoval(application, page, restoreCached) {` | −4 / +1 | 旧：`[page] = await Promise.all([ application.waitForEvent('window'),`<br>新：`page = await connectUiAccount(application, page);` |

### F140 · `windows/test/scripts/components-check.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/components-check.mjs)

Windows本机 components-check.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`6a237cf8d3aa1736942b2019ccf8626a08309707`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';` |
| H002 | `@@ -14,7 +15,4 @@ export async function checkComponents(application) {` | −7 / +4 | 旧：`await page.getByRole('heading', { name: '欢迎使用 VoxCue' }).waitFor(); const loginButton = page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true });`<br>新：`await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor(); assert.equal(await page.getByLabel('邮箱', { exact: true }).count(), 1);` |
| H003 | `@@ -22,2 +20,2 @@ export async function checkComponents(application) {` | −2 / +2 | 旧：`await page.getByRole('button', { name: '使用 GitHub Copilot 继续', exact: true }).count(), 1,`<br>新：`await page.getByRole('button', { name: /使用 ChatGPT\|使用 GitHub Copilot/ }).count(), 0,` |
| H004 | `@@ -96,4 +94 @@ export async function checkComponents(application) {` | −4 / +1 | 旧：`const [main] = await Promise.all([ application.waitForEvent('window'),`<br>新：`const main = await connectUiAccount(application, page);` |
| H005 | `@@ -173 +168 @@ export async function checkComponents(application) {` | −1 / +1 | 旧：`const personal = page.getByRole('complementary', { name: '个人信息' });`<br>新：`const personal = page.getByRole('complementary', { name: '个人信息', exact: true });` |

### F141 · `windows/test/scripts/components-native-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/components-native-smoke.mjs)

Windows本机 components-native-smoke.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`b7e04820da9f1737f54e9d7de23751025eeca534`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -86 +86,7 @@ try {` | −1 / +7 | 旧：`await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await login.waitForLoadState('domcontentloaded'); await login` |

### F142 · `windows/test/scripts/history-scrollbar-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/history-scrollbar-smoke.mjs)

Windows本机 history-scrollbar-smoke.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`7dd6aa3ccbbbadbf91f025c0156ada92a0a7de30`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';` |
| H002 | `@@ -30,4 +31 @@ for (const scale of scales) {` | −4 / +1 | 旧：`const [page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const page = await connectUiAccount(app, login);` |
| H003 | `@@ -66 +64,4 @@ for (const scale of scales) {` | −1 / +4 | 旧：`await page.locator('.history-row').click();`<br>新：`await page .locator('.history-row')` |

### F143 · `windows/test/scripts/installer-engine-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/installer-engine-smoke.mjs)

独立GUID安装引擎验收及原地等待卸载，保留数据/重定向保护。

规范化Git blob：`d6d02f14f67acf0ac86c45e275734ded50ab47fc`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -15,0 +16 @@ import path from 'node:path';` | −0 / +1 | 新：`import { createRequire } from 'node:module';` |
| H002 | `@@ -319 +320 @@ try {` | −1 / +1 | 旧：`electronVersion: '38.8.6',`<br>新：`electronVersion: createRequire(import.meta.url)('electron/package.json').version,` |

### F144 · `windows/test/scripts/installer-upgrade-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/installer-upgrade-smoke.mjs)

自建隔离安装UI、两分钟上限/进程树、原地卸载，验证localStorage/IndexedDB原件。

规范化Git blob：`bb3cb4f133c48c4fc39e5dbbff68b8e65ba4e12b`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -3 +3 @@ import electronExecutable from 'electron';` | −1 / +1 | 旧：`import { _electron as electron } from 'playwright';`<br>新：`import { createRequire } from 'node:module';` |
| H002 | `@@ -5,10 +5,5 @@ import {` | −10 / +5 | 旧：`mkdir, mkdtemp,`<br>新：`electron, testRoot,` |
| H003 | `@@ -17,0 +13 @@ import config from '../../../windows/electron-builder.config.cjs';` | −0 / +1 | 新：`import { prepareInstallerUi } from '../../scripts/build-installer-ui.mjs';` |
| H004 | `@@ -19,2 +15,2 @@ import config from '../../../windows/electron-builder.config.cjs';` | −2 / +2 | 旧：`await mkdir('test/results', { recursive: true }); const directory = await mkdtemp(path.resolve('test/results/nsis-upgrade-'));`<br>新：`const directory = path.join(testRoot, 'nsis-upgrade'); await mkdir(directory);` |
| H005 | `@@ -43,0 +40,9 @@ await rename(path.join(stage, 'electron.exe'), path.join(stage, name + '.exe'));` | −0 / +9 | 新：`const artwork = await prepareInstallerUi(path.join(directory, 'installer-ui')); const include = path.join(directory, 'isolated-installer.nsh');` |
| H006 | `@@ -49 +54 @@ const testConfig = {` | −1 / +1 | 旧：`electronVersion: '38.8.6',`<br>新：`electronVersion: createRequire(import.meta.url)('electron/package.json').version,` |
| H007 | `@@ -59,0 +65 @@ const testConfig = {` | −0 / +1 | 新：`include,` |
| H008 | `@@ -69,5 +75,10 @@ const run = (executable, args) =>` | −5 / +10 | 旧：`const child = spawn(executable, args, { env, windowsHide: true, stdio: 'ignore' }); child.once('error', reject);`<br>新：`const child = spawnTestProcess(executable, args, { env, windowsHide: true, stdio: 'ignore' }); const timer = setTimeout(() => child.kill(), 120000);` |
| H009 | `@@ -157,15 +168,10 @@ try {` | −15 / +10 | 旧：`await writeFile( path.join(directory, 'report.json'),`<br>新：`console.log( JSON.stringify({` |
| H010 | `@@ -173 +178,0 @@ try {` | −1 / +0 | 旧：`console.log(JSON.stringify({ passed: true, directory }));` |
| H011 | `@@ -182 +187,3 @@ try {` | −1 / +3 | 旧：`if (uninstaller) await run(path.join(target, uninstaller), ['/S']);`<br>新：`// Run in place so NSIS does not fork a temporary uninstaller and return // before its files are released; the owned test root removes the stub.` |

### F145 · `windows/test/scripts/interview-access-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/interview-access-smoke.mjs)

Windows本机 interview-access-smoke.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`5c9f8fadef32fd90636037bc101f4a5dd5733301`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -147,0 +148,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H002 | `@@ -207 +211,13 @@ try {` | −1 / +13 | 旧：`for (const name of ['个性化', '账户与用量', '面试设置', '关于']) {`<br>新：`await page .getByRole('navigation', { name: '设置分类' })` |

### F146 · `windows/test/scripts/interview-context-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/interview-context-smoke.mjs)

Windows本机 interview-context-smoke.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`4d306fe0a78c0d3c20aee6724180579586e7cfbd`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -272 +272,3 @@ try {` | −1 / +3 | 旧：`.locator('[title]:not(.choice-trigger > span):not(.speech-select > span), [data-focus-tip]')`<br>新：`.locator( '[title]:not(.choice-trigger > span):not(.speech-select > span):not(.user-info > strong), [data-focus-tip]',` |
| H002 | `@@ -277 +279,3 @@ try {` | −1 / +3 | 旧：`.locator('.choice-trigger > span[title], .speech-select > span[title]')`<br>新：`.locator( '.choice-trigger > span[title], .speech-select > span[title], .user-info > strong[title]',` |

### F147 · `windows/test/scripts/interview-effort-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/interview-effort-smoke.mjs)

Windows本机 interview-effort-smoke.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`e0069972a00bec8ddf34f0ef71641fd1aeab36fd`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -54,0 +55,4 @@ try {` | −0 / +4 | 新：`await main .getByRole('navigation', { name: '设置分类' })` |

### F148 · `windows/test/scripts/interview-layout-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/interview-layout-smoke.mjs)

Windows本机 interview-layout-smoke.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`6b503a97eb60e346c55833aa9593fa8278bc72c9`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';` |
| H002 | `@@ -166,4 +167 @@ try {` | −4 / +1 | 旧：`const [main] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const main = await connectUiAccount(app, login);` |
| H003 | `@@ -237,0 +236 @@ try {` | −0 / +1 | 新：`'剩余面试时长',` |
| H004 | `@@ -246,7 +245,7 @@ try {` | −7 / +7 | 旧：`assert.ok(rows[0].width > rows[1].width * 2); assert.equal(rows[1].y, rows[2].y);`<br>新：`for (let i = 0; i < rows.length; i += 2) { assert.equal(rows[i].y, rows[i + 1].y);` |
| H005 | `@@ -255 +254 @@ try {` | −1 / +1 | 旧：`'start dialog: full-width knowledge, paired audio, actual speech/device and answer model/effort rows',`<br>新：`'start dialog: paired knowledge/quota, audio, actual speech/device and answer model/effort rows',` |

### F149 · `windows/test/scripts/interview-workflow-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/interview-workflow-smoke.mjs)

Windows本机 interview-workflow-smoke.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`3b90df5e9e27596f1a89b98af825be753a65338e`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -167,0 +168,4 @@ try {` | −0 / +4 | 新：`await main .getByRole('navigation', { name: '设置分类' })` |
| H002 | `@@ -234,0 +239,4 @@ try {` | −0 / +4 | 新：`await main .getByRole('navigation', { name: '设置分类' })` |
| H003 | `@@ -265,0 +274,4 @@ try {` | −0 / +4 | 新：`await main .getByRole('navigation', { name: '设置分类' })` |
| H004 | `@@ -428 +440 @@ try {` | −1 / +1 | 旧：`.getBounds(),`<br>新：`.getContentBounds(),` |
| H005 | `@@ -546 +558 @@ try {` | −1 / +1 | 旧：`.getBounds(),`<br>新：`.getContentBounds(),` |
| H006 | `@@ -549,2 +561,4 @@ try {` | −2 / +4 | 旧：`assert.ok(Math.abs(resized.x + resized.width / 2 - original.center) <= 1); assert.ok(Math.abs(resized.y - original.bounds.y) <= 1);`<br>新：`const resizedToolbar = await toolbarPosition(); const anchorDiagnostic = JSON.stringify({ original, resized, resizedToolbar });` |

### F150 · `windows/test/scripts/packaged-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/packaged-smoke.mjs)

Windows本机 packaged-smoke.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`b3ef42bd7fafcc0c43ac2aec43a34eea36127924`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -74 +74,3 @@ assert.ok(` | −1 / +3 | 旧：`!entries.some((file) => /^(?:test\|scripts\|src\|electron\|local-models\|\.git\|\.tools)\//.test(file)),`<br>新：`!entries.some((file) => /^(?:test\|scripts\|src\|electron\|server\|local-models\|\.git\|\.tools)\//.test(file),` |
| H002 | `@@ -92,0 +95 @@ for (const [name, version] of [` | −0 / +1 | 新：`['zod', '4.6.6'],` |
| H003 | `@@ -162,0 +166,5 @@ try {` | −0 / +5 | 新：`assert.equal( await app.evaluate(() => process.versions.electron),` |
| H004 | `@@ -165,0 +174,4 @@ try {` | −0 / +4 | 新：`await page .getByRole('navigation', { name: '设置分类' })` |
| H005 | `@@ -167,2 +179,5 @@ try {` | −2 / +5 | 旧：`await settings.getByRole('button', { name: '面试设置', exact: true }).click(); await settings.locator('.provider-avatar img').evaluate(async (image) => image.decode());`<br>新：`await settings.getByRole('button', { name: 'AI 服务', exact: true }).click(); assert.equal(await settings.locator('.ai-service-label img').count(), 2);` |

### F151 · `windows/test/scripts/platform-native-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/platform-native-smoke.mjs)

Windows本机 platform-native-smoke.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`1d284e3221168d24786da363a5f08519046d10a0`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -17 +17 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |

### F152 · `windows/test/scripts/presentation-native-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/presentation-native-smoke.mjs)

Windows本机 presentation-native-smoke.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`7a7b81661408f1506933a7ffafd9fea0354d02b4`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';` |
| H002 | `@@ -62 +63 @@ try {` | −1 / +1 | 旧：`await login.getByRole('heading', { name: '欢迎使用 VoxCue', exact: true }).waitFor();`<br>新：`await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H003 | `@@ -120,2 +121,2 @@ try {` | −2 / +2 | 旧：`? login.getByRole('heading', { name: '欢迎使用 VoxCue', exact: true }) : login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true });`<br>新：`? login.getByRole('heading', { name: '登录 VoxCue', exact: true }) : login.getByRole('button', { name: '登录', exact: true });` |
| H004 | `@@ -174,4 +175 @@ try {` | −4 / +1 | 旧：`const [main] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const main = await connectUiAccount(app, login);` |

### F153 · `windows/test/scripts/speech-desktop-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/speech-desktop-smoke.mjs)

Windows本机 speech-desktop-smoke.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`e9bca66378394a98de6bab98e873f849313b9151`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';` |
| H002 | `@@ -35,4 +36 @@ try {` | −4 / +1 | 旧：`const [main] = await Promise.all([ app.waitForEvent('window'),`<br>新：`const main = await connectUiAccount(app, login);` |

### F154 · `windows/test/scripts/user-data-smoke.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/user-data-smoke.mjs)

Windows本机 user-data-smoke.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`60679acb8e8ce15be486e0c1c0e3b6eb08e5d86f`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -0,0 +1 @@` | −0 / +1 | 新：`import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';` |
| H002 | `@@ -175 +176 @@ try {` | −1 / +1 | 旧：`await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();`<br>新：`await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();` |
| H003 | `@@ -182,4 +183 @@ try {` | −4 / +1 | 旧：`[page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`page = await connectUiAccount(app, page);` |
| H004 | `@@ -253,4 +251 @@ try {` | −4 / +1 | 旧：`[page] = await Promise.all([ app.waitForEvent('window'),`<br>新：`page = await connectUiAccount(app, page);` |

### F155 · `windows/test/scripts/windows-suite.mjs`

**M · Windows专属：Mac只读参考**　[打开文件](../../windows/test/scripts/windows-suite.mjs)

Windows本机 windows-suite.mjs：迁移主账号隔离入口、平台原生/打包/生命周期验收；Mac只读，不以其结果代验。

规范化Git blob：`967591e6b527faad42f3066bf1d7b639802c8ea9`。

| 块 | 旧/新行范围及所在符号 | 删除/新增 | 代码定位（开头两条非空行，长行截至190字） |
|---|---|---|---|
| H001 | `@@ -142 +142 @@ try {` | −1 / +1 | 旧：`// The shared runner bounds each of its 45 suites, including a 10-minute soak.`<br>新：`// The shared runner bounds each of its 49 suites, including a 10-minute soak.` |

## B表：整合并保留的远端 Mac 0.5.11 补丁

这段补丁已在Mac基线中，不能回退；它不是本轮在Windows重新完成的Mac0.6.0验证。Windows开发者从自己的0.5.11比较时应同时看到它。完整历史证据见[Mac0.5.11验收](MACOS_0.5.11_VERIFICATION.md)。

### B001 · `AGENTS.md`

保留远端Mac0.5.11加载/续期修复或对应历史授权、进度与验收说明。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -2,0 +3,8 @@` | −0 / +8 |

### B002 · `PROGRESS.md`

保留远端Mac0.5.11加载/续期修复或对应历史授权、进度与验收说明。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -0,0 +1,10 @@` | −0 / +10 |
| H002 | `@@ -221,0 +232 @@ DMG为631,072,216字节，SHA256 d13a4dad4e9de9409dbe090a18980f9d7bb02d3c38bfcf6` | −0 / +1 |

### B003 · `README.md`

保留远端Mac0.5.11加载/续期修复或对应历史授权、进度与验收说明。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -7 +7 @@ Windows侧栏、面试背景和文字气泡三项透明度按最新要求沿用0` | −1 / +1 |

### B004 · `macos/package.json`

保留远端Mac0.5.11加载/续期修复或对应历史授权、进度与验收说明。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -4 +4 @@` | −1 / +1 |

### B005 · `macos/src/icons.tsx`

保留Mac放射线SF Symbols资源及12段亮度扫动，不让共享旋转重复作用。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -40 +40,17 @@ function icon(name: keyof typeof symbols) {` | −1 / +17 |

### B006 · `macos/test/scripts/chatgpt-renewal-smoke.mjs`

保留Mac0.5.11 loading实际帧、原生/打包/续期、停滞代理及自有loopback测试保护；本轮Mac需重跑适用项。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -0,0 +1,9 @@` | −0 / +9 |

### B007 · `macos/test/scripts/codex-renewal-fixture.mjs`

保留Mac0.5.11 loading实际帧、原生/打包/续期、停滞代理及自有loopback测试保护；本轮Mac需重跑适用项。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -0,0 +1,231 @@` | −0 / +231 |

### B008 · `macos/test/scripts/package-runtimes-smoke.mjs`

保留Mac0.5.11 loading实际帧、原生/打包/续期、停滞代理及自有loopback测试保护；本轮Mac需重跑适用项。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -50,0 +51,2 @@ app.whenReady().then(async()=>{` | −0 / +2 |

### B009 · `macos/test/scripts/ui-refinement-matrix.mjs`

保留Mac0.5.11 loading实际帧、原生/打包/续期、停滞代理及自有loopback测试保护；本轮Mac需重跑适用项。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -17 +17,8 @@ for (const scale of scales) {` | −1 / +8 |

### B010 · `shared/docs/MACOS_0.5.11_HANDOFF.md`

保留远端Mac0.5.11加载/续期修复或对应历史授权、进度与验收说明。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -4,0 +5,2 @@` | −0 / +2 |
| H002 | `@@ -27 +29 @@ Windows 未访问真实 ChatGPT/Copilot 账户、凭据或资料进行联调，` | −1 / +1 |
| H003 | `@@ -31,14 +33,14 @@ Windows 未访问真实 ChatGPT/Copilot 账户、凭据或资料进行联调，` | −14 / +14 |
| H004 | `@@ -56 +58 @@ Windows 未访问真实 ChatGPT/Copilot 账户、凭据或资料进行联调，` | −1 / +1 |

### B011 · `shared/docs/MACOS_0.5.11_VERIFICATION.md`

保留远端Mac0.5.11加载/续期修复或对应历史授权、进度与验收说明。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -0,0 +1,120 @@` | −0 / +120 |

### B012 · `shared/docs/WORKSPACE_CLEANUP.md`

保留远端Mac0.5.11加载/续期修复或对应历史授权、进度与验收说明。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -0,0 +1,8 @@` | −0 / +8 |

### B013 · `shared/src/components/DownloadButton.tsx`

保留远端Mac0.5.11加载/续期修复或对应历史授权、进度与验收说明。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -3 +3 @@ import { Button } from './ui/button';` | −1 / +1 |
| H002 | `@@ -55,12 +55,16 @@ export function DownloadButton({` | −12 / +16 |

### B014 · `shared/src/styles.css`

保留远端Mac0.5.11加载/续期修复或对应历史授权、进度与验收说明。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -6078,0 +6079,16 @@ small {` | −0 / +16 |
| H002 | `@@ -6081 +6097,2 @@ small {` | −1 / +2 |

### B015 · `shared/test/README.md`

保留Mac0.5.11 loading实际帧、原生/打包/续期、停滞代理及自有loopback测试保护；本轮Mac需重跑适用项。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -3 +3,3 @@` | −1 / +3 |

### B016 · `shared/test/scripts/assert-loading-icon.mjs`

保留Mac0.5.11 loading实际帧、原生/打包/续期、停滞代理及自有loopback测试保护；本轮Mac需重跑适用项。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -0,0 +1,45 @@` | −0 / +45 |

### B017 · `shared/test/scripts/chatgpt-usage-runtime-smoke.mjs`

保留Mac0.5.11 loading实际帧、原生/打包/续期、停滞代理及自有loopback测试保护；本轮Mac需重跑适用项。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -33,0 +34,4 @@ const runtime = new CodexUsageRuntime(path.join(testRoot, 'usage'), (binary, arg` | −0 / +4 |
| H002 | `@@ -39 +43,6 @@ const runtime = new CodexUsageRuntime(path.join(testRoot, 'usage'), (binary, arg` | −1 / +6 |
| H003 | `@@ -90 +99 @@ try {` | −1 / +1 |

### B018 · `shared/test/scripts/components-ui-smoke.mjs`

保留Mac0.5.11 loading实际帧、原生/打包/续期、停滞代理及自有loopback测试保护；本轮Mac需重跑适用项。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -8,0 +9 @@ import { captureRequested } from './capture-requested.mjs';` | −0 / +1 |
| H002 | `@@ -294,0 +296,16 @@ try {` | −0 / +16 |

### B019 · `shared/test/scripts/functional-suite.mjs`

保留Mac0.5.11 loading实际帧、原生/打包/续期、停滞代理及自有loopback测试保护；本轮Mac需重跑适用项。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -55,0 +56 @@ const mac = [` | −0 / +1 |

### B020 · `shared/test/scripts/updates-sidebar-smoke.mjs`

保留Mac0.5.11 loading实际帧、原生/打包/续期、停滞代理及自有loopback测试保护；本轮Mac需重跑适用项。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -7,0 +8 @@ import { assertInitialDownloadProgress, assertDownloadButton } from './assert-do` | −0 / +1 |
| H002 | `@@ -33,0 +35 @@ driver.quitAndInstall=()=>{` | −0 / +1 |
| H003 | `@@ -35,0 +38,2 @@ driver.quitAndInstall=()=>{` | −0 / +2 |
| H004 | `@@ -396,0 +401,3 @@ try {` | −0 / +3 |
| H005 | `@@ -397,0 +405,11 @@ try {` | −0 / +11 |

### B021 · `shared/test/scripts/updates-smoke.mjs`

保留Mac0.5.11 loading实际帧、原生/打包/续期、停滞代理及自有loopback测试保护；本轮Mac需重跑适用项。

| 块 | 完整差异范围 | 删除/新增 |
|---|---|---|
| H001 | `@@ -8,0 +9 @@ import { assertDownloadButton, assertInitialDownloadProgress } from './assert-do` | −0 / +1 |
| H002 | `@@ -106,0 +108,4 @@ const assertLoadingMotion = async (page, button) => {` | −0 / +4 |

## 覆盖与上传核对

- F表155项：新增39、修改/删除116；除本自索引项外共763个完整新增或差异块。B表21项另列历史整合。
- 发布前对比实际Git差异路径集合和全部hunk数量；任何未列出或被误加入的文件均应停止提交并先审计。
- 服务端只读树、既有模型/索引、node_modules、缓存、安装器/归档、测试截图/报告、临时数据库、真实资料、凭据、密钥和本地恢复副本均不在上传白名单。
- Windows清理353文件/714748808逻辑字节的临时/缓存内容不属于Git受控源码删除，不能据此要求Mac删同名目录；具体边界见主交接C136–C138。
- 客户端代码快照已推送并核对为d35c06ed2c668b2ae2a956b47cb64880baa689a1；其后的发行文档不改变该已验证代码快照。
