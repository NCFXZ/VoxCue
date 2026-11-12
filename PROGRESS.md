# VoxCue 当前进度

更新日期：2026-11-12。长期规则见 AGENTS.md；测试结果仅在终端／对话中报告。

## 基线与范围

- 在 main 接续，版本唯一来源 shared/package.json 为 1.2.1，根与 Mac 配置已同步。Windows 全树只读，生成配置留待本机同步。
- Mac 1.2.0 产品快照为 macos-v1.2.0（10ac04b），共享／Windows v1.2.0 为 0bc1cd4；保留原发行、标签、私钥及恢复基线。
- 本轮执行工作区清理、完整功能／安全／稳定性／对抗性／语言／视觉回归、问题修复与重测，然后发布 Mac 1.2.1。最后交付 Windows 逐条更新与验收文档。用户要求清理上轮保留环境，本轮不再保留测试 VM 或合成资料。

## 实现摘要

- 共享识别引擎仅在 VAD 接纳后建立新流，输入有界 500ms 历史和当前帧，避免未接纳短音串入下一句；保持既有模型、分句、尾包和积压参数。删除旧 idle 解码／silentReset 路径。
- 共享 controller 加入可取消的有界恢复和真实退出围栏；仅 Mac adapter 启用 1／2／4 秒、最多三次的自动重启。手动操作取消恢复；权限／设备／模型语义错误及启动失败明确停止。Windows adapter 保持未启用。
- 共享恢复提示补中英契约及窄窗覆盖；浮窗 header 高于恢复卡，使用实际交叠命中验证遮挡修复。测试焦点沿用既有平台适配器。
- Mac HAL 按首选声道定位实际输出流及局部声道对；监听建立后复核完整快照，配置变化停止。保持麦克风转换、包协议与预算。拒权全零帧与授权静音无法可靠区分，不加入零值推断。
- Mac 凭据改用冻结 v2 helper，保持原密码／v10 密文，校验正式父身份并收紧全部匹配项 ACL／partition。删除 builder 自动 bootstrap，缺失身份须恢复；复制拒绝重定向与多链接并原子发布。源码／规范字节不得重签覆盖，详见 macos/docs/CREDENTIALS.md。
- 打包临时根规范化真实路径；显式展开 speech controller 的 cancellable.js 依赖。Windows 打包配置须本机补齐同一物理依赖闭包。
- 离线完整入口改用 Vitest 公开 package.json 定位 CLI；仅例外放行自有精确监听端点及受限组件 IPC，外部网络仍拒绝。Windows named-pipe 缺席探测须本机安全适配。
- 截图专项复用真实 Worker，覆盖连续编码、故障／取消／真实超时、实际退休和内存收敛；短音负向隔离与非空正向 filler 过滤分开验证。
- 更新密钥备份增加只读 --verify；持有人已本机隐藏输入口令完成 OneDrive 加密副本认证，不读取／改写现用私钥，不将云副本称为物理离线介质。

上一环节保留的隔离环境及本轮临时合成资料／截图／旧候选已按归属与占用门禁清理；不再从旧缓存路径接续。公开认证模型／音频缓存、现用依赖、签名材料和发行基线保留。

## 待办

- 提交并推送 main，建立 Mac 产品标签并上传 1.2.1 安装资产、验证远端摘要和 latest 状态；最后编写 Windows 逐项接续文档。

## 验证入口

- 完整功能：shared/test/scripts/functional-suite.mjs --jobs=1；离线：interview-usage-offline.mjs --full；五档 UI：macos/test/scripts/ui-refinement-matrix.mjs。
- 音频：audio-conversion-smoke.mjs、audio-restart-smoke.mjs、qwen-regression.mjs、speech-preroll-smoke.mjs、interview-real-audio-smoke.mjs；设备／权限仅走 guest 的 audio-virtual-smoke.mjs。
- 凭据：credential-hardening-smoke.mjs、cloud-native-vault-smoke.mjs；密钥备份只用 update-key-backup.mjs --verify=/持有人指定路径。
- 最终包：macos/test/scripts/package-guest-smoke.mjs；owner 的 package-smoke.mjs --static-only 不启动产品，退出 2 表示动态覆盖待执行。
- 入口、隔离边界与历史实现见 shared/test/README.md、shared/docs/MACOS_1.2.0_RELEASE.md。GUI／原生串行、解锁门禁，结果不入仓库。
