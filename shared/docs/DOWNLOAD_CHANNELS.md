# 下载分流与 CNB 发行

客户端更新和本地组件共用 `shared/electron/backend/downloads.ts`。每次远程检查／实际组件下载前，使用匿名 HTTPS 查询网络出口的国家代码：`loc=CN` 选择 CNB，其余地区选择 GitHub。使用 Cloudflare 中国站的公开 trace，仅提取国家代码；不使用 `colo` 节点位置，不记录、持久化或向 Renderer 传递 IP。三秒内无法确定地区时沿用 GitHub，用户取消仍立即终止。组件已在本机就绪时不查询地区。

- GitHub：`https://github.com/NCFXZ/VoxCue/releases/download/<tag>/<filename>`。
- CNB：`https://cnb.cool/voxcue-release/voxcue-release/-/releases/download/<tag>/<filename>`。
- 大陆公开版本索引：`https://cnb.cool/voxcue-release/voxcue-release/-/git/raw/main/releases.json`。

CNB 文件直链和 raw 索引允许匿名读取，客户端不使用要求登录的 CNB 版本列表 API。索引只提供选版元数据，不能替换客户端内的固定仓库、平台文件名、摘要和签名校验。大陆的索引、清单、安装包及新旧 blockmap 全部选用 CNB；其他地区保留 GitHub API 的分页筛选。持久更新缓存保留所选源，旧缓存继续按 GitHub 处理，不迁移真实用户资料。

Windows 继续运行原有 NsisUpdater。缺少旧安装包、缺少新旧 blockmap、Range 请求失败或差分组装摘要不符时，由原生更新器改为下载全量安装包，完整包仍核验 SHA512 和固定 Ed25519 清单签名，安装前重新认证。商店版仍由 Microsoft Store 管理应用更新，组件同样按 IP 分流。Mac 使用签名的增量计划复用本地旧 ZIP，并从同一渠道按 Range 下载新版缺少的区间。增量失败时下载已签名的全量 ZIP。两种下载路径都向 Sparkle 交付同一原始 ZIP。[Mac 更新设计](../../macos/docs/UPDATES.md#网络增量与全量兜底)

## 发布顺序

正式客户端从 `1.3.3` 开始同步 GitHub、CNB；Windows 另提交 Microsoft Store。CNB 的测试 `1.3.2` 已撤下，不为验证差分而重建；正式 `1.3.3` 的安装包和 blockmap 是该渠道后续增量更新的首个基线，旧基线缺失时保留全量兜底。版本仍以 `shared/package.json` 为唯一来源。以下命令从当前平台目录执行；生成文件仅位于系统临时目录。准备工具不发布、不读取令牌、不生成安装包。

1. 完成本平台正式签名和验包，上传 GitHub 原始发行资产。Windows 保留 EXE、blockmap 和清单。Mac 保留 ZIP、DMG、签名清单和清单声明的增量计划。两个渠道沿用相同的文件名、原始字节和签名。
2. 在 CNB 创建相同 tag 的发行条目。运行 `node ../shared/scripts/prepare-cnb-mirror.mjs --tag=v1.3.3`，将输出的临时 `.cnb.yml` 上传到 CNB 仓库 main。追加单个平台时传 `--platform=macos-arm64` 或 `--platform=windows-x64`。该配置让 CNB 官方 Node 容器从 GitHub 复制公开资产，逐文件校验大小和 SHA256／SHA512，然后通过官方 attachments 插件上传到本仓库的对应发行。仅使用 CNB 自带的临时构建身份，不建立个人令牌或把凭据放入配置。
3. 本地组件有新增或改变时，同步运行 `node ../shared/scripts/prepare-cnb-mirror.mjs --components`。工具从现用组件目录读取 Windows／Mac 需要的归档和分卷、版本与固定摘要，去重后生成同样的临时复制配置。必须先创建对应组件 tag。当前组件统一位于 `models-v1.0.0`；以后目录跨多个 tag 时工具明确停止，应分别发布，不能把资产放错 tag。
4. 复制构建成功后移除临时 `.cnb.yml`，避免后续索引或说明提交重复搬运大文件。保留对应原始文件和模型许可证。
5. 运行 `node ../shared/scripts/prepare-cnb-index.mjs --tag=v1.3.3`。该工具核对两边的清单、镜像完整包的大小和 SHA512，以及两边的 Windows blockmap 或清单声明的 Mac 增量计划，生成合并后的 `releases.json`。旧平台条目继续保留。检查只读取资产。
6. 资产就绪后将生成的 `releases.json` 更新到 CNB main，匿名读回验证。Windows 依赖旧版 blockmap 和旧安装包缓存，Mac 依赖与增量计划匹配的旧 ZIP 缓存。基线缺失时客户端走全量下载。
7. Windows 提交 Microsoft Store。区分“已上传”“已提交认证”和“已正式上架”，不将待认证状态写成发布完成。Mac 不执行微软商店步骤。

公开索引的 `assets` 列出已验证的更新资产。Windows 一组包含 EXE、blockmap 和 `latest.yml`。Mac 一组包含原生 arm64 ZIP、`latest-mac.yml` 及清单声明的可选增量计划。客户端按数字版本选择最高的完整稳定发行。

```json
{
  "schemaVersion": 1,
  "releases": []
}
```

CNB main 仅保留 README、公开索引和必要发布配置；不复制 VoxCue 应用源码。仓库标签自动生成的 Source code 归档是 CNB 平台功能，其内容只来自该发行仓库。

## 验证入口

- `download-sources.test.ts`：CN／HK／MO／TW／海外、超时、取消、异常响应、固定地址边界。
- `update-releases.test.ts`、`update-cache.test.ts`、`windows-update-signature.test.ts`：未来版本、平台完整性、缓存源归属及签名认证。
- `components.test.ts`：CNB 组件下载保留归档／解包内容摘要与现有安全缓存行为。
- Windows `test/scripts/updates-differential-smoke.mjs`：生产分流和更新适配器、真实 NsisUpdater；海外增量与大陆增量／全量故障矩阵。用两份已签名发行目录作为只读输入，不安装。
- 同一专项可追加 `--mirror-base=https://cnb.cool/voxcue-release/voxcue-release/-/releases/download/` 验证实际匿名镜像传输；需对应的正式发行及新旧 blockmap，已删除的测试条目不能继续作为输入。
- Mac `test/scripts/updates-differential-smoke.mjs` 从两个发行源到本机回环服务验证增量请求、全量回退与取消。可传入实际旧、新 arm64 ZIP 核对传输字节和新版归档摘要。
