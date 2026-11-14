# VoxCue 工作区目录

根目录提供命令入口；共享代码只维护一份，系统集成、依赖和构建产物归各平台。当前范围见根目录 [PROGRESS.md](../../PROGRESS.md)，长期规则见 [AGENTS.md](../../AGENTS.md)。历史迁移记录见 [WORKSPACE_CLEANUP.md](WORKSPACE_CLEANUP.md)，其中一次性授权不代表当前授权。

```text
VoxCue/
  AGENTS.md / PROGRESS.md / README.md / README.en.md
  package.json                 无依赖的本机平台命令转发
  pnpm-workspace.yaml          根命令配置，不在根安装依赖
  shared/
    src/                       React 展示、状态、受控服务与界面资源
    src/mobile/ / mobile.html  独立的局域网设备页面和入口
    electron/
      contracts/               DesktopAPI、IPC 和纯类型/校验工具
      ipc/                     调用者、操作和参数校验
      application/             业务协调与生命周期
      backend/                 账号、云同步、组件、检索、语音等实现
      platform/                平台接口与可信装配
      main.ts / preload.ts     桌面装配与沙箱桥接
    native/                    共用原生推理源码及固定第三方源码
    scripts/                   路径、配置同步、编译和工具
    test/                      共用单测、Renderer 测试、合成夹具与回归入口
    public/ / local-models/     品牌原件与开发模型（缺失时使用组件下载）
    docs/                      当前架构、功能说明及历史交接
    package.json               共同版本、依赖和命令模板
    pnpm-lock.yaml             历史共同解析基准；现用锁在平台目录
    pnpm-workspace.yaml / tsconfig*.json / vite.config.mjs / vitest.config.mjs
  macos/
    src/                       Mac 图标适配
    electron/                  Core Audio、权限、窗口、凭据、网络和更新适配
    native/                    本机助手源码；保留现用及旧正式恢复所需代码
    scripts/ / test/ / docs/    Mac 构建、回归及原生说明
    public/                    PNG/ICNS 衍生物及 SF Symbols
    VoxCue.app/                本地开发启动入口（生成）
    .tools/                    受保护签名材料、已发行 v1/v11 规范助手和开发工具
    recovery/ / release/       恢复与发行基线，不能当作临时文件
    node_modules/ / .pnpm-store/ / .cache/ / dist/ / dist-electron/
    package.platform.json      Mac 命令及依赖差异
    package.json / pnpm-lock.yaml / pnpm-workspace.yaml / tsconfig*.json / vite.config.mjs
  windows/
    electron/ / native/         Windows 适配与 WASAPI 等原生实现
    scripts/ / test/ / docs/    Windows 构建、回归及原生说明
    public/voxcue.ico           Windows 图标
    Start-VoxCue.cmd            既有构建启动入口
    node_modules/ / .pnpm-store/ / dist/ / dist-electron/
    package.platform.json      Windows 命令及依赖差异
    package.json / pnpm-lock.yaml / pnpm-workspace.yaml / tsconfig*.json / vite.config.mjs
```

账号服务由独立的 VoxCue-server 仓库维护。桌面库内的旧 shared/server 不是当前开发或部署入口，不作为桌面清理对象；合成服务测试通过 [server-reference.mjs](../test/scripts/server-reference.mjs) 校验外部固定版本，不自动修改或部署服务端。

## 安装与命令

使用项目固定的 pnpm 11.25.0 和现有 Node.js 24 工具链。在本机平台目录安装依赖：

```sh
cd macos # Windows 本机使用 windows
corepack pnpm install --frozen-lockfile
```

不在根或 shared 安装依赖，不共享两平台 node_modules。平台工具与下载缓存也保留在本平台，不手动拆删厂商包内部文件。

安装后可在根目录运行以下命令，它们会转发到本机平台：

```sh
corepack pnpm check:workspace
corepack pnpm check:architecture
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build:shared
```

build:shared 构建 Renderer 和当前平台 Electron 代码；Mac 同时生成 SF Symbols。build 追加本机原生构建，Mac 还生成开发启动入口；dev 开发运行，start 使用已有构建。原生、打包及 GUI 测试的范围和门禁见 [测试说明](../test/README.md)，不能用共享单测代替本机验收。

shared/package.json 是版本和共同配置的唯一来源；package.platform.json 声明差异。根 sync:workspace 只生成根与当前平台配置，另一平台只读报告。sync:workspace --check --all 只读检查全部漂移。共享依赖变更只更新当前平台安装和锁，另一平台交由其本机同步。Mac 上 Windows 全树只读，Windows 上 Mac 全树只读。

## 编译、资源与清理边界

TypeScript 只编译 shared 和当前平台到本平台 dist-electron；preload 与 main 同目录。编译先进入自有系统临时目录，验证输出边界后替换本平台生成目录。Vite 从共享入口构建本平台 dist；设备页面具有独立入口和允许的依赖闭包。测试只收集 shared 与当前平台测试。

正式包使用受控运行依赖、本平台助手和组件标记；模型默认经固定目录、摘要和逐文件清单认证后进入用户组件缓存。无组件标记的旧完整包保留模型路径兼容。共享品牌原件、用户原件、模型权重、研究资产、签名材料及发行恢复基线不因清理而删除。

测试结果仅终端/内存；必要 profile、数据库、截图只放自有系统临时目录并在结束、失败或取消后清理。保留有效测试源码、固定合成夹具和经摘要认证的可复用公开缓存。历史明确跳过的 Mac 117 个目录及 Windows 349 个目录不重试，不遍历未知归属目录寻求清理数量。

旧目录迁移、备份和已删除结果的历史引用只用于解释历史，不表示产物仍可用；准确恢复资料位于受保护的 macos/recovery。真实 userData、凭据及用户面试/聊天内容不纳入仓库重构。
