# VoxCue 当前进度

更新日期：2026-11-12。长期规则见 AGENTS.md；测试结果仅在终端／对话中报告。

## 当前基线与授权范围

- 已并入远端文档收尾提交 `80c55abaf368bfdc0d0aa117099c07e28012706c`，不改变冻结代码标签。Windows GitHub 1.2.0 已发布，Store 2.2.0.0 提交状态见 shared/docs/WINDOWS_1.2.0_RELEASE.md；本轮只处理 Mac，不操作 Store。
- 当前直接在 main 接续，输入为 `0bc1cd4261c56598a6341adfb11aca99913e9cf9`（固定源码标签 v1.2.0）；目标版本唯一来源 shared/package.json 为 1.2.0。旧版本标签及正式／恢复资产不得移动或覆盖。
- 用户本轮要求读取桌面 MACOS_1.2.0_CODEX_PROMPT／HANDOFF／TODO，先测资料导出和本次更新，再清理确认无用文件／代码，完成安全、稳定性、对抗、英文翻译、视觉对齐及本机回归；问题修复后重测。验收后已授权提交／推送私有源码 main、向公开 GitHub 发布 Mac 1.2.0 安装及更新资产并设 Latest，无需再次确认。不操作 Microsoft Store、官网或现有服务端。
- 用户追加允许跳过无法执行的界面导出，随后要求立即测试；已按本轮交互完成原生 NSSavePanel 取消／保存／替换路径，用户现在休息，后续自行验证修复，不再依赖人工动作。导出只使用临时合成资料，结束清理。
- 测试期间使用本轮 PID 绑定的 caffeinate 保持亮屏，GUI／原生／推理串行且每组检查当前 UID 已登录解锁；锁定或未知立即停止，结束释放本轮断言。
- 用户确认没有现成隔离环境；本轮已在系统临时根准备固定摘要 Tart／公开 macOS VM。M4 正式动态入口已改为可丢弃 guest，仍需最终候选资产动态验收，不能以开发态替代。

## 接续文档与实施摘要

- 共享差异与回归逐项见 shared/docs/MACOS_1.2.0_HANDOFF.md（S01–S54），Mac 专属实施与通过条件见 MACOS_1.2.0_TODO.md（M1–M16 及 CoreAudio close），来源见 SECURITY_HARDENING.md。Windows 发行来源见 WINDOWS_1.2.0_RELEASE.md；历史细节查 Git。
- 本机配置已同步到 1.2.0，Mac importer 补既有 sharp@0.35.5，并为 Transformers CJS 的实际根引用声明既有 onnxruntime-common@1.30.0；锁只增加这两个同版 importer 项。其他依赖／SDK／模型保持，windows/ 全树只读，根与 shared 不安装依赖。
- 开发宿主启动检查改为复用 Mac 既有固定身份校验，沿用 prepareRuntime 对现有 File Provider 工作区宿主的 FinderInfo 处理边界；继续验证代码资源与固定证书，不改变正式包签名要求。

- 本轮系统临时根 `/private/tmp/voxcue-macos-120-wkpqjzbe` 有 `.owner.json` 标识；内含固定只读服务端 0.5.3 引用 `3bceb615dbba900f669322c301fc4b5b473dfb15`，仅供合成客户端回归，结束核对占用并清理。

- M12／M14 已将 Mac 更新改为连接／首字节和有效字节进展的空闲期限，中间进度按百分比粒度合并；取消不等待失效 reader.cancel Promise。M13 新增仅记录本实现完成下载的认证归属索引，安装版本追上后有条件回收，不扫描历史目录；活动消费者／取消／硬链接等归属门禁有对应合成入口。
- CoreAudio stop 以实际 close 为退休依据，强制停止明确报错；失败保留旧采集栅栏，晚到 close 才允许重新创建。已补合成用例、中英错误文案及构建后原生合成回归入口。
- M3 已补读取前 owner／0700／0600／链接检查及仅同一公钥的离线加密备份恢复工具；只演练合成身份，不执行真实私钥备份。M9 新增非阻塞读写／本地交换期限、错误后整链退休和父消失检查，原生构建及定向入口已接续，仍需消费最终包验证。
- M4 已移除 static-only 前的 RunAsNode 产品探针、不可达的正式包 chmod 分支、旧 package-temporary 聚合和 AEC packaged 路径。pnpm test:package 路由到 guest runner；正式浏览器走正常 native window／Quit，另以 guest 内固定开发宿主加载未改的最终 ASAR 覆盖实际 SDK／preload／Worker。guest 只挂白名单公开输入，断路由网络／音频／USB／剪贴板，退出确认停止后销毁整个 VM；不修改最终包开启 inspector。
- M1／M16 已接入签名前 fuse 收口、HR 分进程权限和进入 Electron 前的原生参数／继承环境过滤；正式入口与预 MLX verifier 共用固定身份的整包封印校验。固定自签身份无 Team ID，库验证例外限于实际加载随包库的宿主；旧 Credentials 二进制不重签，adapter 仅提供固定系统 PATH。M5 补截图 Worker／sharp arm64 闭包。实现与当前命令见 shared/docs/MACOS_1.2.0_RELEASE.md，仍待最终包实际验收。
- Mac 夹具激活仅在 app inactive 时对已核对 PID／路径／临时 profile 的宿主使用 Launch Services；原焦点期限／断言保留。知识库等待 Escape 的 inert 快照移除，composer 比较 SF Symbol 名称和实际资源而不比较会重建的 SVG mask ID。资料迁移夹具在入口内固定三个路径后再删除被 launcher 补回的测试标志。中断清理先让嵌套测试释放子进程，未确认 close 时保留归属目录。
- 摘要固定的一次性 macOS guest 已下载到上述临时根 vm-home；Tart 2.41.1 来源与镜像摘要保存在该根公开输入元数据。试运行关闭路由网络、宿主目录／剪贴板／音频／USB共享，结束停止并清理。Rust 1.90.0 仅按官方摘要暂存在同根用于本机构建，不安装全局工具。

## 待办

- 本地 main 已有 `a986e5a`／`23f3c1c`，尚未推送；本次续改为 Copilot loader 补实际动态加载 `runtime.node` 所需的库验证例外。旧临时候选 `/private/tmp/voxcue-macos-120-wkpqjzbe/candidate-1` 来自 `23f3c1c`，不得发布；下一候选使用本次新快照生成到 `candidate-2`，不覆盖原正式 release 目录。五档矩阵及临时画面复核已执行，画面已清理。

- 开发态完整功能／原生排程、Qwen 实际模型回归、面试轮次、公开音频长稳和五档界面矩阵已执行。M9 已补实际 Python worker 的父消失／EOF 入口。后续若改变签名或生产资源，重新构建独立候选并重新验包。
- 对现有候选完成 M4／M1／M5／M16 的 OS guest 最终包门禁，包含实际 SDK、KnowledgeHost、截图／语音 Worker、Sparkle staging／cancel、正常新产品启动和真实 1.1.1 合成 profile 升级。静态入口不启动产品，不能据此称正式动态验收完成。
- Guest 门禁新增 SIP／签名执行前提。固定摘要公开 CI base 默认关闭 SIP，本轮仅在自有 VM 恢复环境恢复；临时 Packer 1.16.2／Tart 插件 1.21.0 存上述系统临时根，不改宿主设置。已准备停止的 `voxcue120-sip-base`，`vm-image-source.json.preparedVM` 指向它；运行实例始终断网、不共享宿主目录／剪贴板／音频／USB，失败只销毁实例并从该临时基线重试，全部结束后再清理基线。
- M11 固定旧 helper 保留自身非 runtime／开发父接受面，当前入口环境约束不能关闭其直接启动路径；兼容迁移方案见 Mac 发行实现文档。真实 ACL／CDHash 迁移不在本轮固定身份保护边界内，不绕过该约束。M3 工具只演练合成身份，不执行真实私钥备份。
- 最终矩阵及 guest 发现问题后修复重测，完成后再收拢逐项清单；不放宽既有断言。
- M6／M15 缺受控虚拟音频设备时保留未验证，不采样物理设备或真实混音；Mac captureProtectionSupported:false 保持如实表达。
- 清理须先核对真实路径、owner、静态／动态／平台／构建／测试消费者及占用。自有临时产物放系统临时目录，结束清理；固定认证公共模型／音频缓存和历史明确跳过目录保护。
- 最终完成 .app／DMG／ZIP／latest-mac.yml 的实际资源、签名、摘要与逐项验收后，按当前授权推送／发布并匿名回读，保持跨平台完整稳定资产选择。OS 隔离或签名门禁未满足时明确列出缺口，不以开发态结果代替正式包结果。

## 保护边界

- 不读取真实账号、Keychain 条目或密钥材料；普通 GUI 夹具禁止正式凭据助手，仅临时合成账号／资料／图片及固定来源／摘要公共模型音频。不采样硬件或宿主屏幕，不改系统权限、默认设备或锁屏策略。
- 固定签名／Ed25519 身份、Credentials helper／CDHash／ACL、原件、真实资料、现用依赖／模型、旧发行与恢复基线保护，不自动生成、轮换、重签 helper 或迁移真实数据。
- 保留已验收 UI、28×22px 连续滑钮／48×22px 开关、Qwen CPU 长段算法、积压预算与手动恢复、第三方网站图标、单份简历及旧凭据 v10 兼容；共享逻辑只保留单一实现。
