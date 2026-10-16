# GitHub Copilot

登录页选择“使用 GitHub Copilot 继续”，在系统浏览器完成 GitHub 授权后返回 VoxCue。无需用户创建 OAuth App、提供 Client ID/Secret 或复制令牌。保留 ChatGPT 登录；切换服务先退出当前账户，再选择另一个服务，普通聊天和附件保留，旧回复仍显示生成时的服务身份。

接入固定 `@github/copilot-sdk` / Windows x64 runtime 包 1.0.21（runtime 1.0.97，protocol 3）。官方 SDK 的账户控制 RPC 仍标记 experimental，升级必须重新验证登录、取消、注销与模型/工具目录。Windows 原生运行时随安装包分发，不要求用户安装开发工具。打包时 runtime.exe 必须位于 ASAR unpacked 物理路径。

凭据仅由官方 runtime 在系统加密存储中管理。VoxCue 的 auth-data/copilot-session.json 仅保存账户名称/ID，service.json 仅保存所选服务。拒绝 needs-plaintext-consent，不借用 PAT、gh 或其他应用登录，不记录原始 SDK 错误。注销只操作该 VoxCue runtime；系统删除不能确认时给出提示，可在 GitHub 撤销授权。原 ChatGPT 加密文件、用户目录、原件和数据库格式保持。

2026-10-15 修复：SDK 1.0.21 的 `mode: 'empty'` 会强制设置 `COPILOT_DISABLE_KEYTAR=1`，因此浏览器授权完成后只能返回 `needs-plaintext-consent`；该提示此前被错误归因为 Windows 加密不可用。单人桌面客户端现使用 `copilot-cli` 模式保留系统凭据库，所有控制/回答 session 显式关闭原 empty 模式下的可选能力：遥测、记忆、嵌入检索、配置/指令/技能/插件发现、文件钩子、host git、定时任务、实验和跨会话存储；MCP OAuth 与嵌入缓存仅内存。工具白名单、权限拒绝、独立工作目录和环境清理继续生效。真正的加密失败仍拒绝明文保存；正常退出后通过根目录 Start-VoxCue.cmd 启动新构建，再在浏览器重新授权即可，无需清理凭据或用户数据。旧安装/便携产物需重新构建后才包含此修复，本轮没有打包。

模型名称、供应商及可用思考档位来自实际账户目录，不以模型名称猜测。搜索只在实际工具目录包含 web_search 时允许，缺少时明确要求关闭搜索；工具是否提供取决于账户/运行时。资料结构化提案和真实来源校验保持，用户确认前不保存。SDK 的 extended thinking 不作为公开摘要转发，因此 Copilot 可能只显示实际状态和工具活动。没有额外翻译请求或摘要语言要求。

本机用量只累计该账户在 VoxCue 实际收到的 input/output token，不代表 Copilot 配额或费用。附件通过 SDK 内存输入发送；不同模型的文档/图片兼容性仍需真实账户验证。会话关闭时清理自有 session，禁用 runtime 的文件/命令、配置发现、远程 session 及持久 session store；保留 VoxCue 自己的本机聊天持久化。

验证入口：`pnpm test:copilot`，安装包 staging 使用 `node test/shared/scripts/copilot-smoke.mjs --installer-stage`。两者使用独立 test-results userData：检查真实官方子进程启动环境未禁用系统凭据库、真实 SDK 发出的 session 请求仍显式隔离，再验证未授权账户控制、PKCE URL 生成和取消；随后合成 RPC 验证加密失败保持未登录并可重试、正常 IPC/preload/React、结构化流、实际提供商展示、私有推理隔离、折叠进度及退出切换保留聊天。单测覆盖明文拒绝、迟到取消、目录/档位、来源、使用量、静默超时和原始错误隔离。未使用真实账户授权或推理，不据此宣称真实令牌已成功写入、订阅、搜索和所有模型附件已验收。

官方资料：[SDK 认证](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate)、[CLI 浏览器登录与凭据存储](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli)、[官方 SDK](https://github.com/github/copilot-sdk)。
