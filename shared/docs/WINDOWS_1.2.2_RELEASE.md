# VoxCue 1.2.2 Windows

本版从 Windows 1.2.0 升级。桌面应用版本为 1.2.2，Microsoft Store 包版本为 2.2.2.0。原有 `v1.2.2` 标签对应 Mac 源码 `ffc31e5`。Windows 资产使用本次 Windows 源码构建。

## Windows 更新

- 启动时恢复上一次成功连接的 ChatGPT 或 GitHub Copilot。主动断开后停止自动验证，再次连接成功后恢复。设置、侧栏和面试摘要统一显示整数剩余额度。
- 回答生成时即可打开已出现的来源。稍后到达的来源注释会更新链接名称。刷新页面时立即恢复本地个人资料，聊天数据库加载期间也能保留用户编辑。
- Windows 会在使用音频设备清单前校验其结构。手动重连等待旧 WASAPI 子进程实际关闭。语音输入短暂中断后，可在界面上重新连接。
- 主动登录可备份已确认损坏的旧密文。系统加密或文件读取失败时保留资料并报告错误。
- 客户端从公开的 [VoxCue 仓库](https://github.com/NCFXZ/VoxCue) 获取受信任的组件和 Windows 更新。两仓发布相同的安装器、blockmap 及带 Ed25519 签名的更新清单，供仍使用旧仓的客户端升级。安装目录附带 `LICENSE` 和 `THIRD_PARTY_NOTICES.md`。

## 资产

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| VoxCue-Setup-1.2.2-x64.exe | 408859187 | `8d4bce6ce60b17cecbb570814a8408263b30e8517dfec9a169d62c438362964d` |
| VoxCue-Setup-1.2.2-x64.exe.blockmap | 423569 | `024ce7f43cc2ab83d8740b315ce026d25819834f5626dbb81c264dc1f2d9ecb4` |
| latest.yml | 482 | `c35432352f4900b4ddc95e947b849287d5513fd927537dd2ef4c74775c876af7` |
| VoxCue-Store-1.2.2-x64.appx | 601716208 | `b97c3b05c5550824c952d1a77aff02e5b110082e0b24e324c3e371926221a2e8` |

独立安装器的更新清单沿用原有签名公钥。EXE 未使用 Authenticode 发布者签名。Store 包沿用 `NCFX.VoxCue` 身份与产品 ID `9PBBVWZXMBPW`。

## 已知识别限制

使用现有 Paraformer 和 Windows 合成语音时，孤立或连续的“嗯／啊／呃”可能产生空终稿或被识别为其他字，“然后呢”可能丢失末字。这会影响极短输入的过滤与自动回答。面试中可核对识别文本，手动提交问题。实际用户语音及真实订阅账号授权不在合成验收范围内。

Windows 验证入口及逐项范围见[交接文档](WINDOWS_1.2.2_HANDOFF.md)和[测试说明](../test/README.md)。
