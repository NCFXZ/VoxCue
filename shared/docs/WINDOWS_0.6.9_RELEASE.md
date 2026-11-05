# Windows 0.6.9 发行 / Windows 0.6.9 release

更新日期 / Updated: 2026-11-05。

**当前状态：Windows 0.6.9 已公开发行，三项资产已上传并经匿名完整下载核对；GitHub Latest 端点指向本次发行。**

**Status: Windows 0.6.9 is publicly released. All three assets have been verified through complete anonymous downloads, and the GitHub Latest endpoint identifies this release.**

## 来源与发布记录 / Source and publication record

| 项目 / Item | 真实值 / Recorded value |
| --- | --- |
| 版本唯一来源 / Sole version source | `shared/package.json = 0.6.9` |
| 安装包源码输入 SHA / Installer source commit | `7e3cacba27ac7191ed0d5ccce6767ad57e8bdbde` |
| 源码推送状态 / Source push status | 已推送私有 `NCFXZ/VoxCue` 的 `main` / Pushed to private `NCFXZ/VoxCue`, branch `main` |
| 发行仓库 / Distribution repository | `NCFXZ/VoxCue-releases` |
| Tag | `v0.6.9` |
| GitHub release ID | `435539098` |
| 公开发行地址 / Published release URL | [v0.6.9](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.9) |
| 发布时间 / Published time | `2026-11-05T18:00:29Z` |
| 草稿及预发行状态 / Draft and prerelease status | `draft=false`，`prerelease=false` |
| Latest 状态 / Latest status | `/releases/latest` 返回 release ID `435539098`、tag `v0.6.9`、`draft=false`、`prerelease=false` / Confirmed by the Latest endpoint |
| 公开发行说明 / Public release notes | [简体中文 / English](RELEASE_0.6.9.md) |

本轮任务拉取基线为 `e98242a`。最终安装包使用源码提交 `7e3cacba27ac7191ed0d5ccce6767ad57e8bdbde`，该提交已推送私有源码仓库。后续仅补充发行事实的文档提交不改变安装包内容。

The task started from `e98242a`. The final installer was built from `7e3cacba27ac7191ed0d5ccce6767ad57e8bdbde`, which has been pushed to the private source repository. Later documentation-only commits do not change the installer contents.

## Windows 正式资产 / Windows release assets

下表三项 Windows x64 资产均为 GitHub `uploaded` 状态，记录的 digest 与本地文件 SHA256 一致。三项公开地址均经匿名 HTTP 200 完整下载，大小与 SHA256 均与本地一致；EXE 的 SHA512 也与清单一致，公开 `latest.yml` 内容与归档逐字节一致。正式三项已复制归档至 `windows/release/0.6.9`，复制后 SHA256 一致；旧版本保留。二进制作为发行资产，不进入源码 Git。

All three Windows x64 assets are uploaded. Complete anonymous HTTP 200 downloads match the recorded sizes and local SHA256 values. The EXE also matches the manifest SHA512, and the public `latest.yml` is byte-identical to the archive. Identical copies are archived in `windows/release/0.6.9`; older releases are preserved. Binaries are release assets, not source-repository commits.

| 文件 / File | GitHub asset ID | Bytes | SHA256 |
| --- | --- | ---: | --- |
| [VoxCue-Setup-0.6.9-x64.exe](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.9/VoxCue-Setup-0.6.9-x64.exe) | `714296871` | 407593984 | `48e4ab508c49d06ca3dbb003ff0489d8f952be0bbc39d1f5d5a2ada592a6fb0f` |
| [VoxCue-Setup-0.6.9-x64.exe.blockmap](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.9/VoxCue-Setup-0.6.9-x64.exe.blockmap) | `714296867` | 422263 | `037a8eafaceb72045fda6992c887bd7aeacf154831087183d0f4325f77ea5e27` |
| [latest.yml](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.9/latest.yml) | `714296868` | 349 | `5ca0b4fad77c9b6fa3ddb8f712da820c8a16bd3b89be22121b557464fba82a06` |

| 核对项 / Verification item | 真实值 / Recorded value |
| --- | --- |
| 清单 version、安装包文件名及内置版本 / Manifest version, installer name and embedded version | `0.6.9`；`VoxCue-Setup-0.6.9-x64.exe`；内置版本 `0.6.9` |
| 清单安装包 size 与 SHA512 / Installer size and SHA512 in manifest | `407593984`；`OsRmeKM+lLpWANDw96AyDmSfUrZAPhupdLGC/gZb9/mHJixmuLiseUM8bH7CcYkR451OTgtTP4+sdWCn3anbsA==` |
| EXE Authenticode 状态 / EXE Authenticode status | `NotSigned`；本轮未新增或轮换身份 / No new or rotated signing identity |
| 三项匿名下载及清单回读 / Anonymous downloads and manifest readback | 三项 HTTP 200 完整下载，bytes/SHA256一致；EXE SHA512匹配清单，latest.yml与归档逐字节一致 / All three complete downloads and manifest contents verified |
| 匿名分平台选版 / Anonymous platform selection | `fetchPlatformUpdate`：`windows-x64` 选择 `0.6.9`；`macos-arm64` 正确回退完整 `0.6.8` / Windows selects 0.6.9; Mac retains its complete 0.6.8 release |

EXE 用于安装或手动升级；blockmap 和 `latest.yml` 用于应用内更新。本次保留既有固定公开源、本平台完整稳定发行选择及摘要/签名策略，未新增或轮换身份。

Use the EXE for installation or manual upgrades. The blockmap and `latest.yml` support in-app updates. Existing platform selection and integrity/signing policies remain in effect, with no new or rotated identity.

## 0.6.8 → 0.6.9 范围 / Scope

| 范围 / Area | 本轮行为 / Changes |
| --- | --- |
| 共享形状与文字 / Shapes and text | 滚动条保持原宽并使用圆头胶囊；面试输入框与外框同心，气泡及设置/登录预览同步；正文使用文本光标和中性选中背景，控件保持其原有光标。 |
| 登录 / Sign-in | 聚焦输入框显示上浮阴影；灰色密码长度提示与红色字段错误放在对应输入框下；六格验证码保留输入、粘贴、自动前进和键盘操作，发送/倒计时重发按钮始终在六格右侧同排，窄窗只收缩数字格。 |
| 登录演示 / Sign-in preview | 按登录区域比例显示转写、思考及回答的单次自动演示；完成停在回答底部，不提供演示交互，支持离屏暂停与减少动态效果。 |
| 模型与思考档位 / Model and reasoning effort | 准备聊天、前置设置和活动面试使用组合入口；仅显示模型支持的显式档位，滑块拖动预览、结束后提交；活动面试保存时保留弹层和焦点，失败沿原反馈恢复。 |
| 菜单与弹窗 / Menus and dialogs | 统一连续圆角外框、6px 内距、胶囊高亮及圆头滚动条；菜单从触发边展开/收拢，文字不缩放；弹窗渐入/渐出，关闭立即释放交互与模态锁。标题、关闭按钮及首字段留白统一，设置保留分类布局及左侧关闭按钮。 |
| 页面与侧栏 / Pages and sidebar | 主页面、设置分类及记录详情使用方向明确的过渡；侧栏在有选中条的标签之间滑动，无条状态淡出/淡入，文字粗细与颜色平滑切换；展开宽度固定，收起功能保持。 |
| 准备聊天 / Preparation chat | 底部控件同高并收紧留白；页面级提示/错误放到输入框上方；用户消息不再重复模型/档位，长消息可折叠但复制仍取全文，双方消息增加本地日期/时间。 |
| 引用来源 / Sources | 域名引用使用紧凑胶囊及网站图标，图标失败有回退；普通链接及全文复制保持原内容，更多来源展开/收起具有过渡。 |
| 设置与同步 / Settings and sync | 活动/前置面试设置共用左标签右控件的对齐布局；语音状态紧邻分组标题；同步状态及警告与右侧操作按钮同排，条目冲突保留各自处理入口。 |
| 开始面试 / Interview startup | 权限预检等待时预留状态、按钮与设备摘要空间，减少布局跳动；重新检查清除上一轮音频测试状态；骨架扫光裁切在胶囊内。 |
| 技能与知识库 / Skills and knowledge | 技能勾选与半选笔画双向绘入/退回；向量阶段显示真实进度，后续写盘单独显示“正在写入索引…”，避免完成前回到零的错觉。 |
| Windows 更新 / Windows updates | 检查尝试与结果持久复用一小时，失败也不重复联网；完整高版本安装包重启后重新验证并恢复待安装，中断包按归属清理并暂停自动下载一小时，手动下载仍可用；退出等待清理，安装保留明确确认及本地保存握手。 |
| 验证期间的产品修复 / Product fixes during validation | 修复无效邮箱失焦时首次“跳过登录”“注册”“找回密码”或“返回登录”点击丢失；豁免仅限同panel内的跳过及form外导航，普通字段验证和验证码发送不变。修复截图缩略图光标被正文规则覆盖；同时修正分数缩放同心计算、菜单首末裁切及焦点释放、侧栏首次定位、记录删除离场和预检重查状态等本轮交互边界。 |

以上列产品行为与修复，不记录测试成绩。验证入口及适用边界见[测试说明](../test/README.md)；Windows 原生更新机制见[更新说明](UPDATES.md)，清理保护范围见[工作区清理约定](WORKSPACE_CLEANUP.md)。

This lists product behavior and fixes, not test results. Validation entry points and limits are documented separately. The public notes omit internal implementation details and undisclosed interactions.

The sign-in fix covers the first click on “Continue locally”, “Sign up”, “Forgot password” and “Back to sign in” after an invalid email. It is limited to navigation within the same account panel; ordinary field validation and verification-code sending remain unchanged.

## 双端同步与 Mac 接续 / Cross-platform follow-up

- 共享页面、业务、样式和交互均属于双端需求；本次发行索引仅记录 Windows x64，不能据此宣称 Mac 0.6.9 已发行或完成原生验证。
- Mac 逐项接续见 [M001 起的 0.6.8 → 0.6.9 交接清单](MACOS_0.6.9_HANDOFF.md)。其中 M099–M107、M111–M120 明确要求 Mac 原生适配器补齐检查缓存、完整包持久恢复、中断清理/冷却及本机签名/安装验证；共享契约已接通不能替代这些工作。
- 当前 Windows 工作区不修改 `macos/` 全树。Mac 必须在本机同步生成配置、实现原生缺口、验证全部共享改动并完成签名打包，再按当时授权发行本平台资产。
- RAG 算法、模型、阈值、检索策略与数据兼容保持既有基线；知识库变动限于进度呈现。现用依赖、模型、身份、用户数据及历史发行/恢复资产保留，官网和独立服务端不随本次桌面发行部署。

Shared UI and interaction changes apply to both platforms, but this index covers Windows only. Mac native update persistence, recovery and interruption handling still require implementation and validation on a Mac, as detailed in the numbered handoff. No Mac release or native acceptance is implied. Existing retrieval behavior, data compatibility, models, identities and recovery releases are preserved; website and server deployment are outside this desktop release.
