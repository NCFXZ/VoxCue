# VoxCue 当前进度

更新日期：2026-10-30。本文仅记录接续范围与待办，不保存测试成绩；长期规则见AGENTS.md。

## 当前任务与范围（Mac接续）

- 本轮Mac客户端0.6.5已交付：产品源码为2607b5a837b1d8eaa97768f5514cd24ff91e4184，Mac三项补充至既有v0.6.5并设Latest；来源、资产ID/摘要见[Mac发行索引](shared/docs/MACOS_0.6.5_RELEASE.md)。正常推送main，真实安装未替换，Windows/历史/模型资产保持；结果仅输出终端/对话。
- 本机与远端main起点均为126bb199f8d482789bda0e9b49e304676772031e，包含产品71948317及后续交付文档；Mac比较基线只用已发布0.6.3快照c37fa181。开始工作区干净，保留后续远端与用户工作，禁止reset/clean/强推。
- 本机只写客户端shared/、根生成配置与macos/，windows/全树、旧shared/server及独立服务端只读。固定独立0.5.3/3bceb615参考位于owner系统临时目录，通过VOXCUE_TEST_SERVER_ROOT指定；只创建临时合成数据库/loopback，不改服务端源码、测试、配置、依赖、数据库、部署或生产。
- 版本唯一来源shared/package.json=0.6.5；Mac只同步Vite6.4.4→6.4.5并核对其余锁定版本保持。SDK1.0.21、Codex0.164.0、模型/hash/推理、索引/RAG v7、代码签名、凭据助手、host-id与Ed25519身份保持。
- 验证顺序为基础检查及全部单测→隔离真实HTTP→真实Mac主进程/加密/原生→完整functional-suite（20轮面试、足600秒真实ASR）及显示缩放/辅助功能/视觉对齐→最终包。GUI只在当前UID已登录解锁控制台串行执行；仅owner临时合成资料/公开固定模型音频，普通夹具启动前隔离统计和正式凭据助手；结果仅终端/对话，临时资源退出清理。

## 接续待办

- Windows既有0.6.5资产保留。本轮两处共享队列修复及夹具变更仍需Windows本机回归，不以Mac成绩替代，也不从Mac生成Windows配置或安装包。
- 真实AI账号质量、真人识别准确率、物理热插拔、实际权限撤销、外接显示器及新电脑仍需另行本机条件；本轮不使用真实账号/资料、不采样设备、不修改系统权限，不能据合成端口宣称这些范围完成。

## 当前实现与交付来源

- 0.6.5共享实现包括统计v2能力/归属凭据/逐项回执/持久序号、中文Markdown粗体、单张1秒扫光/2.5秒停顿及新建知识库焦点保护；详细变化见[Mac逐项交接](shared/docs/MACOS_0.6.5_HANDOFF.md)和[统计协议](shared/docs/CLIENT_TELEMETRY.md)。
- Mac生成清单同步0.6.5，锁仅定向同步Vite6.4.5及其peer引用。普通Mac GUI入口导入main前使用mock Keychain并拒绝正式凭据助手；正式包只对owner临时私有副本移除凭据/AI可执行权限，关闭后恢复，不改签名字节或Chromium沙箱。锁屏守卫覆盖Playwright窗口与完整矩阵；真实HTTP夹具按当前平台标记。
- 队列读取严格拒绝损坏/溢出的持久计数，保留原文件并关闭统计，避免跳过无效值后从0重新发送。补充凭据绑定/容量、8秒超时、回执边界、背压、序号、丢弃去重及迟到身份生命周期用例。
- 旧账户崩溃检查点缺少历史凭据时显式计入legacy_unverifiable并清理，不补造事件或归属；后续重启保留丢弃总数，不重复处理该检查点。
- Mac原生加密专项使用同源临时Keychain助手核对新的telemetry.bin与普通队列引用；五档缩放矩阵加入0.6.5扫光、焦点与共享交互专项，并统一准备固定公开临时模型。
- 扫光探针对真实截断标题连续观察两轮及每轮完整停顿；语音切换专项使用固定公开音频和既有模型/hash，保留Chromium沙箱并增加锁屏守卫，采集端口仍为显式临时合成输入，不采样设备。
- 原生保存面板断言对齐“导出资料”，当前用户仅在本次合成临时ZIP上执行保存/替换；普通窗口与原生Keychain夹具均有锁屏守卫，Keychain取消先删除原生容器再清理目录，原生画廊支持完整临时截图。
- 开发启动器经既有离线入口安装合成端口；Electron就绪前仅设置owner profile与mock Keychain，就绪后先安装网络/凭据保护，再导入生产main。不使用与Chromium冲突的外层sandbox-exec；单实例/路径/焦点断言保持。
- [v0.6.5发行页](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.5)现含Mac与Windows各三项，Latest为v0.6.5；Mac正式三项位于macos/release/0.6.5且不入Git。既有Windows文件未覆盖，历史Mac0.6.3仍为旧v1包，不作为新统计兼容目标。
- 源码静态入边、动态平台、Worker/preload及打包入口共同审计；无静态入边不等于无消费者，不为删除数量移除业务、兼容读取或有效夹具。

## 固定基线

- Windows x64、macOS14.2+/Apple Silicon；本地账户不造云用户，AI授权独立；Renderer隔离、同步/注销/导出权限不放宽。更新维持匿名下载及完整资产/签名/摘要校验。
- 历史Windows0.6.3三项已补入既有公开发行页，当时保留Latest v0.6.3；当前Latest见0.6.5索引。Windows既有NotSigned状态不在本轮轮换。发行产物、依赖、模型、真实资料、恢复基线与历史跳过目录保护。
- 服务端历史基线0.5.2/472541c；0.5.3统一新统计协议，旧客户端不再作为兼容目标。当前只读联调使用owner临时数据库，不操作生产。

## 历史索引

- 0.6.3：[Windows客户端C001–C082](shared/docs/WINDOWS_0.6.3_HANDOFF.md)、[服务端S/M要求](shared/docs/SERVER_FOR_CLIENT_0.6.3_HANDOFF.md)、[Windows提示词](shared/docs/WINDOWS_0.6.3_CODEX_PROMPT.md)、[逐文件审计](shared/docs/CLIENT_0.6.3_FILE_AUDIT.md)、[Mac发行索引](shared/docs/MACOS_0.6.3_RELEASE.md)。
- 0.6.2：[Mac交接C001–C050及文件差异](shared/docs/MACOS_0.6.2_HANDOFF.md)、[接续提示词](shared/docs/MACOS_0.6.2_CODEX_PROMPT.md)、[服务端0.5.2历史变化](shared/docs/SERVER_0.5.2_HANDOFF.md)。
- 0.6.1：[客户端交接](shared/docs/CLIENT_0.6.1_HANDOFF.md)、[Windows交接](shared/docs/WINDOWS_0.6.1_HANDOFF.md)。
- 0.6.0：[Mac交接](shared/docs/MACOS_0.6.0_HANDOFF.md)、[逐文件审计](shared/docs/CLIENT_0.6.0_FILE_AUDIT.md)、[Mac发行](shared/docs/MACOS_0.6.0_RELEASE.md)、[Windows发行](shared/docs/WINDOWS_0.6.0_RELEASE.md)。
- 设计与目录：[架构](shared/docs/ARCHITECTURE.md)、[RAG](shared/docs/RAG_ARCHITECTURE.md)、[工作区布局](shared/docs/WORKSPACE_LAYOUT.md)、[清理边界](shared/docs/WORKSPACE_CLEANUP.md)。更早版本按`shared/docs/`与Git历史查阅。
