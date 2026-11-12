# VoxCue 当前进度

更新日期：2026-11-12。长期规则见 AGENTS.md；测试结果仅在终端／对话中报告。

## 当前基线与范围

- 直接在 main 接续。共享／Windows 冻结源码标签 v1.2.0 指向 `0bc1cd4261c56598a6341adfb11aca99913e9cf9`，远端文档收尾 `80c55ab` 已并入；Windows GitHub 1.2.0／Store 状态见 shared/docs/WINDOWS_1.2.0_RELEASE.md。本轮 windows/ 全树只读，不操作 Store、官网或现有服务端。
- 版本唯一来源 shared/package.json 为 1.2.0。Mac 产品快照为 `10ac04b`（前序 `a986e5a`／`23f3c1c`）；本次后续修改只涉及验收夹具与文档。已将验收候选的相同字节复制到 macos/release/1.2.0 并上传公开 GitHub 1.2.0 Release，保持 Latest；独立 Mac 源码标签为 macos-v1.2.0，不移动原 v1.2.0。
- 用户本轮要求先测试资料导出和更新，清理确认无用文件／代码，执行安全、稳定性、对抗、英文与视觉、本机及最终包回归，问题修复后重测；已授权提交／推送私有源码 main、向既有公开 GitHub 1.2.0 Release 添加 Mac 安装和更新资产并设 Latest，无需再次询问。用户现在休息，后续自行完成，不依赖人工操作。
- 原生 NSSavePanel 导出取消／保存／替换、开发态完整排程及最终 SIP guest 排程已执行；合成资料、运行实例和临时画面已清理。测试期间由本轮 PID 绑定的 caffeinate 保持亮屏，结束已释放，不修改锁屏或隐私设置。

## 实施与接续入口

- 共享差异见 shared/docs/MACOS_1.2.0_HANDOFF.md（S01–S54）；Mac 实现、隔离与已知边界见 MACOS_1.2.0_RELEASE.md，逐项任务见 MACOS_1.2.0_TODO.md，安全来源见 SECURITY_HARDENING.md；历史细节查 Git。
- Mac 同步 1.2.0，importer 补既有 sharp@0.35.5 与 Transformers CJS 实际根引用所需的 onnxruntime-common@1.30.0；不升级其他依赖／SDK／模型，根与 shared 不安装依赖。
- Mac 更新采用首字节／有效进展空闲期限与百分比合并；认证归属索引只回收已被安装版本追上且无活动消费者的未来下载，不扫描历史。CoreAudio stop 以实际 close 退休，未确认退出保持栅栏；Rust／Python 交换有界、错误整链退休且不自动重开。
- 正式 fuses／Hardened Runtime 分进程收口，原生入口在进入 Electron 前过滤危险参数与继承环境，正式入口和预 MLX verifier 共用固定身份整包封印校验。自签无 Team ID，库验证例外仅给实际加载随包库的 Electron、Copilot loader、Python／Qwen；截图 Worker、sharp arm64 与 libvips 闭包随包。固定 Credentials helper 精确字节／CDHash 保持，adapter 仅向它提供固定系统 PATH。
- static-only 不启动产品，退出 2 表示只有静态检查。pnpm test:package 走可丢弃 guest：固定 OCI 来源、SIP／签名执行／UID／UUID／控制台门禁，代码归档恢复，仅共享公开只读输入。专用虚拟 NIC 的受控自连接地址支持私有配对测试，外部以太帧全部丢弃；无宿主 home、Keychain、剪贴板、音频或 USB 共享。实际产品正常启动／Quit；最终 ASAR 使用 guest 内固定开发宿主覆盖 SDK／preload／Worker，历史升级使用真实未修改 1.1.1，不重开正式 inspector。
- 已退役旧 package-temporary 聚合、AEC packaged 路径与失效正式包探针；夹具保留焦点／归属和原断言，显式语言偏好，取消先让嵌套进程释放资源，真实退出前不删活动目录。
- 本轮公开测试工具、Rust／CMake、Tart／Packer、临时 VM／SIP 基线、旧候选、下载回读副本及截图均已按 owner／实际退出／无占用核对清理；固定公共模型／音频缓存、现用依赖／密钥和历史发行／恢复资产保留。合成服务端参考为 0.5.3 `3bceb615dbba900f669322c301fc4b5b473dfb15`，只用于隔离客户端验证，不操作线上服务。

## 交付与后续范围

- 私有 GitHub main 已推送；本地与远端仅保留 main 分支，旧标签与历史提交保留。Mac 1.2.0 产品源码固定在 macos-v1.2.0（`10ac04b`），后续夹具／文档提交不改变正式资产字节。
- 公开发行：https://github.com/NCFXZ/VoxCue-releases/releases/tag/v1.2.0 。包含 Mac DMG／ZIP／latest-mac.yml，保留原 Windows 与 1.1.1 资产，Latest 指向 1.2.0。匿名实际文件、签名和生产两平台选择器回读已完成，安装包只保留在 macos/release/1.2.0，不进入 Git。
- 用户最新要求先完成当前版本上传，再讨论剩余三项；本轮发行授权已执行，不代表未来版本、设备驱动或凭据身份迁移的持续授权。
- M6／M15 缺受控虚拟音频设备，拒权／静音与多流／多声道设备项保持未验证，不采样物理设备或真实混音。
- M11 固定旧 helper 自身仍为非 runtime，保留开发父接受面；入口收紧不能关闭其直接启动路径。兼容迁移方案见 Mac 发行实现文档，真实 ACL／CDHash 迁移需要独立明确授权，本轮不绕过固定身份保护。M3 只演练合成身份，不执行真实私钥备份。

## 保护边界

- 不读取真实账号、Keychain 条目或密钥材料；普通 GUI 夹具禁止正式凭据助手，仅 owner 合成资料与固定来源／摘要公开模型音频，不采样宿主屏幕或硬件，不改系统权限、默认设备或锁屏策略。
- 固定签名／Ed25519 身份、Credentials helper／ACL、原件、真实资料、现用依赖／模型、旧发行与恢复基线保持，不自动生成、轮换、重签 helper 或迁移真实数据。
- 保留既定共享 UI、28×22px 连续滑钮／48×22px 开关、Qwen CPU 长段算法、积压预算与手动恢复、第三方图标、单份简历及 v10 兼容；Mac captureProtectionSupported:false 如实表达。
