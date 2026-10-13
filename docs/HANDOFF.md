# VoxCue 当前交接

更新：2026-10-13。当前任务是用户授权的工作区清理，旧知识库内容索引方案与实现已撤除，等待用户提供新方案；不要自行恢复旧实现或开展模型/精度实验。

实际目录 C:\Users\fengk\OneDrive\Study\UoM\PhD\GitRepo\VoxCue，分支 codex/speech-recognition。用户已明确授权上传清理后的当前完整版本至 GitHub 的同名分支；提交与同步状态以 git status/log 和远端为准，Windows/Mac 分支保留。先核对 git status、PROGRESS.md 最新条目和 docs/ARCHITECTURE.md。禁止 reset/clean、整库恢复、覆盖新工作或未经后续授权推送。

保留知识库/简历原件、IndexedDB 名称版本与 stores、账户凭据、个人信息、面试记录和本机语音模型。旧用户目录中的派生数据未做清理或迁移；本轮删除仅针对仓库内旧代码、方案、专用模型/依赖及废弃测试工件。历史附加字段继续保留，不自动改写记录。

聊天和面试直接调用现有 AIChatService；不读取知识库，不提供旧参考/模式入口。正式界面仅 ChatGPT 授权，Mock 只供显式隔离测试。OAuth、原音频不保存上传、麦克风/系统角色、开场设备/模型/effort 锁定、运行时自动回答、现有截图保护范围不变。

基础检查：pnpm check:architecture、pnpm typecheck、pnpm test、pnpm build。桌面检查：pnpm test:knowledge、test:settings、test:interview:workflow、test:interview:access、test:interview:effort、test:history、test:composer、test:conversations:status、test:ui:alignment、test:electron、test:floating、test:login。全部使用隔离目录和合成服务；不批量调用真实账户或采集真人音频。

Start-VoxCue.cmd 使用已构建输出，不自动编译；便携构建入口为 pnpm package:portable。当前验证结果见 PROGRESS.md 和 docs/WORKSPACE_CLEANUP.md。

本轮修改前源码快照在忽略目录 test-results/workspace-cleanup-baseline/sources.json，只用于按文件/逻辑块恢复，不能覆盖后续工作；没有保存真实用户资料或读取封存题目。历史准确率失败不因撤除功能变为通过。真人语音准确率、物理设备/跨机/全部 DPI 和真实账户摘要/标题质量仍未完整验收。
