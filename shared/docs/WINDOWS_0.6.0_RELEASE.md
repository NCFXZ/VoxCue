# Windows 0.6.0 发行与旧安装包隐藏

日期：2026-10-27，Europe/London。用户在源码上传后新增授权：将0.6.0打包上传现有发行仓库，并隐藏此前全部版本安装包。本项覆盖源码交接时“不发行”的限制；本机只构建Windows x64，Mac0.6.0仍待Mac本机适配与验收。

## 代码与发布范围

- 客户端代码快照：`NCFXZ/VoxCue`的`d35c06ed2c668b2ae2a956b47cb64880baa689a1`。完整变化见[140项客户端交接](MACOS_0.6.0_HANDOFF.md)和[固定快照文件审计](CLIENT_0.6.0_FILE_AUDIT.md)。本次没有改生产代码或依赖；随后仅维护发行授权、README、进度和本记录。
- 公开发行：[VoxCue 0.6.0](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.0)，release ID `426003941`，稳定正式版、Latest。
- 先创建非公开草稿，上传齐三项并逐项检查服务器大小/摘要，最终包验收通过后公开；匿名完整下载成功后，才隐藏旧版。
- 本次仅Windows x64，实际Electron44.10.0，固定Copilot SDK/运行时1.0.21、Codex0.164.0、RAG v7及原模型保持。Windows延续既有未配置Authenticode的发行方式，本次实际签名状态为NotSigned，没有创建/轮换签名身份。
- 服务端0.5.1源码、配置及生产部署保持只读，支付继续关闭。115项Git受控文件及原Windows123文件指纹`c5faeb654d17a397e56f728783da947fef3ecf6e0152cba1d494a48327694651`复核一致。
- 不执行真实安装/更新，不更改仓库可见性、真实用户资料或系统设置；安装测试及缓存均为自有临时目录。

## 正式发行文件

本地正式三项位于`windows/release/0.6.0`。不上传builder-debug、stage、源码、服务端副本、模型、凭据、数据库或测试产物。

| 文件 | Asset ID | 字节数 | SHA256 |
|---|---|---|---|
| VoxCue-Setup-0.6.0-x64.exe | 682923750 | 405175747 | bf336fb1e368e22992fefc8c627c137f79e503cff63ec46acbcd06250f506abb |
| VoxCue-Setup-0.6.0-x64.exe.blockmap | 682924932 | 419971 | e5f9ff234a1e047fe073e08988c2ee64b1b0532f724674a82780c45d8b30ae97 |
| latest.yml | 682924972 | 349 | 32f5f6a2c61ec35029bd4b731880e75decb6766e48ed69b6fe4781bcffacffa2 |

清单version为0.6.0、文件名及大小一致；EXE的SHA512为`6deIoWg2QVMg9nUtFrU+fHRUqLwAdFaNuvrl2w5keckVpqva+n25IJLK+hSMikJuSfMoLm2LkpsEVIDu0tOkHg==`。

## 本次实际验证

| 检查 | 结果及边界 |
|---|---|
| 重新构建 | `pnpm package:installer`通过，678个Renderer模块，shared/windows主进程编译；Packager实际44.10.0。首次受限网络解析GitHub失败，正常获准网络下重新成功，不回退运行时。 |
| 合并后定向GUI | updates、updates-sidebar、components-ui、chatgpt-usage-runtime、cloud-account、cloud-quota、ui-material-refinement全部7/7通过，补齐上一轮被锁屏阻止的定向检查。 |
| 安装器完整性 | `installer-artifact-smoke.mjs`通过：PE/NSIS、7z载荷、SHA512、blockmap，VoxCue.exe/ASAR/更新配置/组件清单/音频助手的载荷与stage字节一致。 |
| 最终ASAR运行时 | Copilot真实stdio握手/ping，Codex使用自造有效令牌、外网停滞代理149ms返回；未读取真实账号或凭据。 |
| 最终包功能 | `portable-native-smoke.mjs --installer-stage`通过：实际版本/44.10.0、Paraformer/VAD/Worker/AEC、知识库关键字/向量/混合检索、PDF/DOCX、离线/重启/删除、Qwen组件声明与受控原生文件。 |
| 组件生命周期 | ONNX卸载、语音进程退出、忙碌保护、原件保留、删除/重下载及索引保留通过；不将Qwen组件声明检查冒充本次重新执行Qwen全量推理。 |
| 实际Windows窗口 | 最小化/最大化/恢复/关闭、Win32输入、Renderer崩溃恢复、任务栏、Acrylic、图标、置顶、选择保护及高对比回退通过；未采样用户物理音频。 |
| 匿名下载 | EXE、blockmap、latest.yml均无GitHub凭据完整下载，大小/SHA256与正式文件及GitHub摘要逐项一致；Latest指向0.6.0。 |
| 真实生产更新端口 | 从最终ASAR加载`configurePlatformUpdates`，使用stock NsisUpdater匿名选版/下载405175747字节、SHA512和SHA256通过；测试使用隔离缓存，autoInstallOnAppQuit=false，未安装。 |
| 隐藏后平台选择 | 实际生产选版器Windows选0.6.0；Mac无完整公开包，明确返回“No complete stable release for this platform”，没有把Windows包作为Mac更新。 |
| 服务端/源码边界 | 155项原代码快照审计、763块、67个脚本语法和服务端123文件指纹再次通过；本次没有修改服务端或云权限。 |

原0.6.0完整950项单测/49组功能/15组Windows原生/70项DPI/20轮面试/600秒ASR/Qwen CPU-CUDA等仍见[主交接第10节](MACOS_0.6.0_HANDOFF.md)。这次发行进行了上述必要补测和实际新包验证，不声称所有历史矩阵又重跑一遍。Mac本机、真实账户和物理采集设备仍需对应环境验证。

## 已隐藏的旧版

以下17个应用发行全部转为`draft=true`，共84个资产。每个发行的正文及资产ID、名称、大小、digest和上传状态都与操作前相同；未删除文件或标签。匿名发行API及每版代表性EXE/DMG稳定安装链接均返回404。公开发行列表只剩`v0.6.0`和`models-v1.0.0`。

| 原tag | Release ID | 保留资产数 |
|---|---|---|
| v0.5.11 | 423566131 | 6 |
| v0.5.9 | 422859810 | 6 |
| v0.5.8 | 422183261 | 6 |
| v0.5.7 | 421842072 | 3 |
| v0.5.6 | 419344707 | 6 |
| v0.5.5 | 418906537 | 6 |
| v0.5.3 | 418598932 | 6 |
| v0.5.2 | 418413071 | 3 |
| v0.5.1 | 418105024 | 3 |
| v0.5.0 | 417520317 | 6 |
| v0.3.1 | 416695936 | 6 |
| v0.3.0 | 416476640 | 6 |
| v0.2.2 | 416311895 | 6 |
| v0.2.1 | 416018970 | 6 |
| v0.2.0 | 415051603 | 3 |
| v0.1.2 | 414050623 | 3 |
| v0.1.1 | 413330486 | 3 |

0.5.10此前已撤回且不在初始发行列表，未重建。`models-v1.0.0`（release ID416242475）的16个模型/清单/说明资产保持公开，ID/字节/digest均不变，组件下载继续可用。

隐藏包含旧Mac发行；Mac0.6.0未在Windows上构建或发布，目前没有公开Mac安装包。不能为恢复Mac更新而擅自重新公开旧版。

## 保存与恢复边界

- 正式三个文件在版本目录保留；核对精确绝对目标、祖先/后代无重定向、无运行中stage进程及逐文件独占只读访问后，清理本轮生成stage/重复安装器输出：8064个文件、2018058075逻辑字节。删除后正式三项SHA256再次一致；既有正式发行、模型、签名材料、恢复基线及历史跳过目录不动。逻辑字节不是磁盘可用空间增量。
- 隐藏前后纯元数据与本地校验脚本保留于被忽略的`windows/recovery/release-0.6.0-20261027`，无GitHub令牌、真实用户资料或完整测试产物。GitHub凭据只从既有凭据管理器读取到进程内存，未写文件或进入发行包。
- 如用户以后明确要求恢复某版，使用上表原Release ID核对全部资产后再公开原草稿；不要重新上传、换ID或无指令恢复全部旧版。没有删除公开旧tag的源码归档；公开仓库的源码归档仅属于发行仓库自身。
- 原代码审计固定指向d35c06e；此次仅维护AGENTS/README/PROGRESS、固定审计快照定位和本发行记录。Mac继续按原140项客户端接续，服务端始终只读。
