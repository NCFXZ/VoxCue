# VoxCue 0.6.3 Mac发行索引

状态：完整客户端、本机UI/原生及最终包验收进行中，尚未创建或公开v0.6.3。此文只记录发行来源和资产元数据，不保存测试成绩或执行报告；完成上传后以实际资产ID、大小和摘要更新。

客户端基线：`8eb42a79fe804531f010749ff46635bf320f5308`（0.6.2）。本版产品源码快照待最终审计提交后填写；既有私有仓库`NCFXZ/VoxCue/main`，正常推送，不强推。

目标公开发行：`NCFXZ/VoxCue-releases/v0.6.3`，仅Mac arm64 DMG、固定签名ZIP和latest-mac.yml。开始核对Latest为v0.6.2，保持不变；历史发行、Windows及模型资产保持，不替换真实安装。正式三项放macos/release/0.6.3，不进入源码Git。

服务端：本轮代码/测试/配置/依赖/数据库/部署均未修改，固定参考0.5.2/`472541cc80c77439f02c45d0bf0aed913b036134`仅用于客户端合成隔离联调；本机旧shared/server参考保留。

完整更新：[Windows客户端C001–C082](WINDOWS_0.6.3_HANDOFF.md)、[逐文件审计](CLIENT_0.6.3_FILE_AUDIT.md)、[服务端S001–S036/M001–M026待适配](SERVER_FOR_CLIENT_0.6.3_HANDOFF.md)、[Windows Codex提示词](WINDOWS_0.6.3_CODEX_PROMPT.md)、[统计协议](CLIENT_TELEMETRY.md)。Mac原生/包成绩不代替Windows本机验收；Windows更新配置、专属文案断言、DPI/原生/NSIS仍须接续。
