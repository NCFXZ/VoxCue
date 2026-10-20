# Mac 凭据与版本升级

应用版本沿用共享源；Mac 凭据只通过主进程装配的 `credentials.ts` 与固定原生助手交互。Windows 继续使用 Electron Safe Storage 默认适配器。

## 为什么仅固定证书还不够

旧版曾使用 ad-hoc 签名。固定证书和 designated requirement 并不自动修改历史钥匙串项的授权。另据 Apple Security 的 `ClientIdentification::partitionIdForProcess`，不能归入 Apple/Developer ID 等受信类别的签名使用代码 CDHash 作为 partition identity；相同自签名证书不是固定 partition 的证明。不能用签名规则相同的测试断言真实升级不会要求密码。

参考：[Apple Security 实现](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp)、[Electron 38.8.6 Safe Storage](https://github.com/electron/electron/blob/v38.8.6/shell/browser/api/electron_api_safe_storage.cc)、[Electron 账户名后缀](https://github.com/electron/electron/blob/v38.8.6/patches/chromium/feat_ensure_mas_builds_of_the_same_application_can_use_safestorage.patch)、[Chromium 140 加密格式](https://github.com/chromium/chromium/blob/140.0.7339.249/components/os_crypt/sync/os_crypt_mac.mm)。

## 固定助手与首次接续

`build-credentials.mjs` 使用现有固定签名身份创建独立 `VoxCue.Credentials`。规范副本及源码/证书/二进制摘要保存在受忽略的 `macos/.tools/credential-helper-v1`，不含任何凭据或加密密码。开发启动与正式装配复用其原字节；整应用签名仅验证该助手，不重新签名。版本号、应用 Info.plist 和资源封印不进入独立助手签名。

助手先校验父进程是由固定证书签名的 `com.voxcue.app` 或 `com.voxcue.development`，然后只接受有大小上限的 stdin/stdout 加解密请求。接口不接受任意路径、钥匙串名、服务名或账户名；密钥不离开助手，不进入参数、环境、日志或临时文件。测试用自定义钥匙串入口仅编译进独立测试探针。

第一次读取助手自有的 `VoxCue Credential Storage` / `VoxCue Key`。若不存在，按 Electron 既有命名查找 `VoxCue Safe Storage` 的 `VoxCue Key`，再兼容旧 `VoxCue` 账户。取得同一密码后创建助手自有项，不删除/修改原项及其 ACL，也不重写 `credentials.bin`。读取拒绝、钥匙串锁定或解密时找不到密码均直接报错，不生成替代密码。只有首次写入且确无历史项时才创建随机密码。

沿用 Electron macOS `v10` 格式：PBKDF2-HMAC-SHA1、1003 轮、原盐/IV 和 AES-128-CBC。此处保持旧格式以兼容现有登录密文，没有降低原保护。读写失败保留原登录文件；非机密设备标识在 Mac 不再为生成 UUID 额外触发 Safe Storage。

首次导入历史密码仍可能出现一次系统授权。用户拒绝时停止操作，不能声称静默迁移已成功。后续应用升级复用相同助手代码；若助手丢失/改动、编译身份变化或系统授权状态变化，必须单独处理，不承诺永不出现系统提示。保护已建立的助手规范副本；不可将其当作普通构建缓存清理。恢复到其他构建机器时应同时恢复固定签名材料和助手副本，否则需要重新验证身份接续。

## 定向验证入口

```sh
node macos/test/scripts/credential-upgrade-smoke.mjs
```

脚本只创建系统临时根内的自有钥匙串和签名应用，禁用测试进程的用户交互，检查历史 ad-hoc 授权边界、不同应用代码哈希与固定助手、旧密文兼容、非授权父进程拒绝及装配时助手字节保持。不得用真实登录钥匙串验证或自动响应系统密码弹窗。此入口不打安装包，也不替换真实安装；获准发行时另以 `package-smoke.mjs` 核对最终归档内助手的固定签名与原始字节。
