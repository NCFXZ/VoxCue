# VoxCue 工作区目录

> 测试结果零保留（2026-10-17）：仅在终端/内存显示，不保存报告、日志、截图或隔离 profile。完整测试已获授权；会持久化结果的旧脚本须先改造。Mac 117 个旧占用目录及 Windows 349 个跳过目录不重试；当前 Windows 工作对 macos/ 只读。

更新：2026-10-17。按用户最新授权，开发入口保留根目录，其余内容按实际用途进入 Windows、Mac 或共享目录。

```text
VoxCue/
  AGENTS.md                  当前协作与目录规则
  PROGRESS.md                当前进度与验收边界
  README.md                  开发、产品与入口说明
  package.json               无依赖的本机平台命令转发
  pnpm-workspace.yaml        仅配置根命令，不自动在根目录安装依赖
  .gitignore / .prettierrc.json / .git/
  shared/
    src/                     唯一一份 React 展示、状态与受控服务
    electron/                共享主进程、IPC、业务、契约、原生展示类型端口、ASR Worker
    scripts/                 共享工具、路径解析、配置同步与根命令转发
    test/                    通用单测、Renderer 单测、回归与夹具
    public/                  PNG、Logo 原字节
    local-models/            Paraformer、Silero、E5 可移植权重
    docs/                    共享架构、产品和交接文档
    benchmarks/rag-engines/  退役实验的私有输入与可移植缓存，不执行实验
    package.json             共享依赖/命令声明模板，不在这里安装
    pnpm-lock.yaml           历史共同解析基准，只读保留；现用锁在各平台目录
    pnpm-workspace.yaml      两个平台安装策略的共同模板
    tsconfig*.json / vite.config.mjs / vitest.config.mjs / components.json
  windows/
    electron/                平台策略、WASAPI、原生展示与屏幕能力
    native/                  C# 源码与 bin/VoxCue.Audio.exe
    public/voxcue.ico         Windows 专属图标
    scripts/                 原生构建、便携与 NSIS 打包
    test/                    Windows 专属测试/固定夹具；旧结果只读暂留，不新增
    docs/                    Windows 安装与原生音频说明
    benchmarks/              退役实验的 Windows 实测结果与工件
    node_modules/ .pnpm-store/ dist/ dist-electron/ release/
    Start-VoxCue.cmd
    package.platform.json    仅 Windows 命令和依赖差异
    package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json vite.config.mjs
  macos/
    src/                     SF Symbols 映射与统一图标接口的 Mac 展示适配
    electron/                Apple Silicon 策略、原生展示与 Core Audio 适配
    native/                  音频/权限/启动器及图标生成源码，bin/ 为运行时组件
    scripts/                 Mac 构建、开发宿主和启动入口生成
    docs/                    Mac 原生音频、权限与窗口说明
    public/                  Mac PNG/ICNS 衍生图及 sf-symbols/ 界面透明遮罩（生成）
    VoxCue.app/              可双击本地启动入口（生成，不是分发安装包）
    test/                    Mac 原生单测/脚本；results/ 仅余被占用的旧目录
    recovery/                源码迁移原态、路径清单与清理审计
    node_modules/ .pnpm-store/ .tools/ .cache/ dist/ dist-electron/
    package.platform.json    Mac arm64 原生依赖与共享构建入口
    package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json vite.config.mjs
```

Mac native/scripts/test 已有实际实现，不添加空的未来模块；本机原生音频、窗口生命周期与双击入口的验证见根 PROGRESS 最新节。真实账户、外接设备/真人质量和正式签名分发仍需后续验收。

共用设置与能力定义位于 shared/src、shared/electron/contracts/presentation.ts，展示端口为 shared/electron/presentation.ts；具体实现分别在 windows/electron/presentation.ts 和 macos/electron/presentation.ts，按平台动态装配。Windows 屏幕能力在 windows/electron/screenPermission.ts。共享 UI 改动不允许当前平台写入另一平台目录。Windows 生成配置已在本机同步，旧异平台编译输出由本机受控构建替换；macos/ 保持只读。

## 开发命令

原生 Node.js 24 LTS、固定 pnpm 11.25.0。首次安装进入本机平台目录执行 `corepack pnpm install --frozen-lockfile`。Mac 可设置 `COREPACK_HOME="$PWD/.tools/corepack"`、`ELECTRON_CACHE="$PWD/.cache/electron"`，将工具和下载缓存也保留在本平台。不要在根目录或 shared 安装依赖，不共享两平台 node_modules，也不手工拆删厂商包内部文件。

安装后根目录 `corepack pnpm check:workspace`、`check:architecture`、`typecheck`、`test`、`build`、`dev`、`start` 自动转发到本机平台，也可以直接进入平台目录执行。Windows build 包括 WASAPI；Mac build 包括 Core Audio、共享编译和本地 VoxCue.app 入口。Windows 专属构建/打包/原生回归在 Mac 上明确报错。启动 Windows 既有构建使用 windows/Start-VoxCue.cmd，不自动编译。包版本、业务实现、IPC/OAuth 与用户存储不因目录调整改变。

`shared/package.json` 声明共同依赖和命令，平台 `package.platform.json` 声明少量差异。根 `corepack pnpm sync:workspace` 只生成根与本平台入口/配置，另一平台只读报告；`sync:workspace --check --all` 可只读检查两平台漂移。共同依赖修改更新共享和本平台锁，另一平台交由其本机同步，不自动升级依赖。Windows 旧配置已在其本机同步，旧异平台编译输出由受控构建替换；macos/ 保持只读。

## 编译、测试与资源

TypeScript 只编译 shared 与本平台源码到本平台 dist-electron，Mac 仅有 shared/macos，Windows 应仅有 shared/windows；preload 与 main 同目录。平台按可信策略动态装配，暂存编译核对后替换本平台生成目录，禁止写另一平台。Vite 从 shared/index.html、shared/src、shared/public 构建本平台 dist，依赖按本平台 package exports/browser 条件解析。源码测试的 CommonJS require 使用本平台 NODE_PATH，生产模块依照正常 Node 层级寻找本平台 node_modules。

单测只收集 shared 与当前平台的 `test/{unit,renderer}/**/*.test.{ts,tsx}`，不把另一平台的合成端口当作本机原生验收。测试结果仅显示于终端/内存；必要隔离工作目录仅建在操作系统临时目录，结束、失败或取消须清理。旧脚本中仍有持久化输出，须先改造后再获准运行；不再新增 test/results 内容，历史快照不参与收集。架构检查禁止生产导入任一平台的 test，也禁止平台专属实现互相依赖；共享 Renderer/业务边界继续保持。

开发模型完整时从 shared/local-models 读取，缺失时复用组件首次下载流程；共享 Logo 原件在 shared/public，Windows ICO/native helper 在 Windows 平台目录，Mac 原生 PNG/ICNS 衍生物在 macos/public。两平台当前打包仅复制品牌、运行依赖和各自原生助手，以 resources/voxcue-components.json 启用组件缓存，不内嵌模型；无标记的旧完整包保留 resources/models 兼容。Windows release/发行包保留，验证包仅在自有系统临时目录使用后删除，不安装或发布。

## 迁移与恢复

- 原根 node_modules、.pnpm-store、dist、dist-electron、native/bin、release、Start-VoxCue.cmd → windows 对应目录。
- 原 test/shared → shared/test；test/windows → windows/test；原 test/results → windows/test/results；随后按用户最新授权清除全部旧结果，测试源码保留。
- 原 docs → shared/docs；Windows 安装/音频/权限及实测验收报告 → windows/docs。
- 原 public PNG、local-models 权重 → shared；ICO → windows/public。
- 退役 benchmark 私有输入留在 shared/benchmarks；Windows artifacts/results 进入 windows/benchmarks。原件、标注和历史结果字节不修改，不重启实验。
- 当前用户补充的根规则为 AGENTS.md、PROGRESS.md、README.md 和薄命令/格式配置保留根目录。

精确迁移清单、源码原态、路径映射和清理记录在 macos/recovery/workspace-reorg-20261017。用户最后明确要求清除全部既有历史测试；旧报告正文保留历史事实，所引用旧 test/results/test-results 产物按清理记录视为不可用，不宣称仍有历史归档。从现在开始两平台测试结果均零保留，不因成功、失败或文档引用而例外；本次 Mac 删除 101 项旧产物，117 个被占用目录暂留，Windows 349 个此前跳过的目录不重试。固定夹具和下载缓存已分别迁至 shared/test/fixtures/speech-audio、windows/.cache/electron，源码恢复资料不混入测试历史。真实 userData、凭据、个人原件和聊天/面试记录未迁移。
