# Mac 凭据与版本升级

应用版本沿用共享源；Mac 凭据只通过主进程装配的 `credentials.ts` 与固定原生助手交互。Windows 继续使用 Electron Safe Storage 默认适配器。

## 为什么仅固定证书还不够

旧版曾使用 ad-hoc 签名。固定证书和 designated requirement 并不自动修改历史钥匙串项的授权。另据 Apple Security 的 `ClientIdentification::partitionIdForProcess`，不能归入 Apple/Developer ID 等受信类别的签名使用代码 CDHash 作为 partition identity；相同自签名证书不是固定 partition 的证明。不能用签名规则相同的测试断言真实升级不会要求密码。

参考：[Apple Security 实现](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp)、[Electron 38.8.6 Safe Storage](https://github.com/electron/electron/blob/v38.8.6/shell/browser/api/electron_api_safe_storage.cc)、[Electron 账户名后缀](https://github.com/electron/electron/blob/v38.8.6/patches/chromium/feat_ensure_mas_builds_of_the_same_application_can_use_safestorage.patch)、[Chromium 140 加密格式](https://github.com/chromium/chromium/blob/140.0.7339.249/components/os_crypt/sync/os_crypt_mac.mm)。

## 固定助手与首次接续

1.2.1 使用 `build-hardened-credentials.mjs` 装配固定 v2 `VoxCue.Credentials`，规范字节及源码／证书／二进制摘要保存在受忽略的 `macos/.tools/credential-helper-v2`，不含凭据或加密密码。构建检查 owned、真实路径与普通单链接文件，读取不跟随链接，输出以同目录临时文件原子替换；整应用签名仅核对冻结字节及 Hardened Runtime，不重新签名该助手。版本号、应用 Info.plist 和资源封印不进入独立助手签名。旧 `Credentials.mm` 和 `credential-helper-v1` 保留为兼容／恢复基线；`build-credentials.mjs` 只返回旧规范副本，不覆盖现用 v2。

v2 先核对自身及父进程的固定证书与 Hardened Runtime，只允许正式 `com.voxcue.app` 父进程，拒绝开发身份、危险 entitlement 和非正式父。它只接受有大小上限的 stdin/stdout 加解密请求，不接受任意路径、钥匙串名、服务名或账户名；密钥不离开助手，不进入参数、环境、日志或临时文件。普通 UI 夹具使用合成凭据适配器，不能调用正式助手。原生迁移探针只在临时源码中严格替换一次预期父标识为随机测试身份，绑定本轮 helper 路径／CDHash 和 owned 临时钥匙串，不能转发任意程序。

v2 有界查询 `VoxCue Credential Storage`／`VoxCue Key` 及 `VoxCue Safe Storage`／`VoxCue Key`、旧 `VoxCue` 账户的全部匹配项，跨钥匙串先比较密码一致性，再收紧全部匹配项的 trusted-app ACL 与 partition 为固定 v2 身份，撤销旧 helper 访问；没有现用别名时以同一历史密码创建。只有首次写入且确无历史项才生成新密码，并立即使用收紧的授权。拒绝、锁定、匹配项不一致或解密时缺密码均失败，不生成替代密码，不重写 `credentials.bin`。

多个钥匙串项的授权修改不是原子事务：中途失败可能已有部分旧访问被撤销，操作会明确失败，不能放回宽授权；同一 v2 可重试完成。迁移完成后旧版本不保证可解密，回退应保留 v2 或由持有人明确恢复授权，不能删除钥匙串项或静默换密码。冻结 v2 源码／字节变化必须另做兼容身份迁移，不能修改摘要白名单后重新生成。

沿用 Electron macOS `v10` 格式：PBKDF2-HMAC-SHA1、1003 轮、原盐/IV 和 AES-128-CBC。此处保持旧格式以兼容现有登录密文，没有降低原保护。读写失败保留原登录文件；非机密设备标识在 Mac 不再为生成 UUID 额外触发 Safe Storage。

首次导入历史密码仍可能出现一次系统授权。用户拒绝时停止操作，不能声称静默迁移已成功。后续应用升级复用相同助手代码；若助手丢失/改动、编译身份变化或系统授权状态变化，必须单独处理，不承诺永不出现系统提示。保护已建立的助手规范副本；不可将其当作普通构建缓存清理。恢复到其他构建机器时应同时恢复固定签名材料和助手副本，否则需要重新验证身份接续。

## 定向验证入口

```sh
node macos/test/scripts/credential-upgrade-smoke.mjs
node macos/test/scripts/credential-hardening-smoke.mjs
```

脚本只创建系统临时根内的自有钥匙串和 nonce 测试父，禁用测试进程的用户交互，检查历史授权、全部别名／跨钥匙串迁移、旧密文、部分失败重试、危险签名／父身份／路径拒绝及冻结字节。真实 production canonical 的正式父探针仅发送固定无效请求，不执行凭据访问。不得用宿主真实登录钥匙串验证或自动响应系统密码弹窗。这些入口不打安装包，也不替换真实安装；最终归档需经 `package-guest-smoke.mjs` 的独立 OS 隔离入口验收，不能直接在宿主运行正式包测试。
