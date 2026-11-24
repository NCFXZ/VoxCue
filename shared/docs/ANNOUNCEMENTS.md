# 官网公告配置

客户端固定匿名读取 `https://voxcue.com.cn/app/announcements.json`。同目录的 `announcements.json` 是待上传的官网配置。

只有已集成本功能的客户端才能接收公告。此前发布且不含公告读取功能的客户端需要先升级一次。所有共享逻辑适用于 Windows 和 macOS，原生验证分别在对应平台执行。

## 填写与上传

1. 编辑同目录的 `announcements.json`，在 `announcements` 数组内加入公告。
2. 将文件发布到官网的 `app/announcements.json` 路径，响应须为 HTTP 200、`Content-Type: application/json`。更新完整站点部署时保留当前线上其他文件。
3. 客户端启动后读取；运行期间在窗口回到前台或每 10 分钟重新检查，成功响应缓存 10 分钟。撤回公告时从数组移除，或上传空数组。

该路径建议使用不超过 10 分钟的站点缓存，修改后确认公开 URL 返回最新 JSON；需要时刷新该路径的 CDN 缓存。

配置格式如下。示例只用于填写参考，不随应用作为离线公告显示：

```json
{
  "schemaVersion": 1,
  "announcements": [
    {
      "id": "ai-service-guide-20261123",
      "title": { "zh-CN": "配置 AI 服务", "en": "Set up an AI service" },
      "subtitle": {
        "zh-CN": "前往设置，登录 AI 账号或填写 API 密钥。",
        "en": "Open settings to sign in to an AI account or enter an API key."
      },
      "expiresAt": "2026-12-31T23:59:59+08:00",
      "audience": "signed-out",
      "versionFilter": { "type": "lt", "version": "1.3.3" },
      "button": {
        "label": { "zh-CN": "前往设置", "en": "Open settings" },
        "icon": "settings",
        "action": { "type": "navigate", "target": "ai" }
      }
    }
  ]
}
```

| 字段 | 填写方式 |
| --- | --- |
| `id` | 必填、唯一。1–80 个英文字母、数字、点、下划线或短横线，首位为字母或数字。同一公告修改文案时保留 ID；新公告换新 ID。 |
| `title` | 必填，最多 120 字符。可填普通字符串，或包含 `zh-CN` 和 `en` 的双语对象。 |
| `subtitle` | 必填，最多 600 字符，可为空字符串；双语写法同上。 |
| `expiresAt` | 必填，包含时区的 ISO 时间。示例中的 `+08:00` 为中国标准时间。到达这个时刻即停止显示。 |
| `audience` | 可省略，默认 `all`。`all` 全部用户；`signed-in` 已登录 VoxCue 主账户；`signed-out` 跳过登录的本地账户。AI 服务账号登录状态不参与判断。 |
| `versionFilter` | 可省略，默认全部版本；具体选项见下表。 |
| `button` | 可省略。填写后显示一个操作按钮，包含 `label` 和 `action`，以及可选的 `icon`。`label` 最多 40 字符，支持双语。 |

普通字符串会在两种界面语言下显示相同内容；需要不同语言时同时填写中英文。

## 版本筛选

| 选择 | `versionFilter` | 示例结果 |
| --- | --- | --- |
| 全部版本 | `{ "type": "all" }` | 所有已支持公告的客户端 |
| 低于某个版本 | `{ "type": "lt", "version": "1.3.3" }` | 1.3.2 可以收到，1.3.3 不可以 |
| 高于某个版本 | `{ "type": "gt", "version": "1.3.3" }` | 1.3.4 可以收到，1.3.3 不可以 |
| 指定版本 | `{ "type": "eq", "version": "1.3.3" }` | 只有 1.3.3 可以收到 |

按三段数字比较，1.10.0 高于 1.3.3；构建后缀 `+build.2` 不改变版本筛选结果。不接受测试版后缀。版本、登录状态和过期时间须同时满足。

## 可选按钮

`icon` 可选：`external-link` 外链／跳转（默认）、`settings` 设置、`document` 文档、`list` 列表、`download` 下载、`none` 不显示图标。跳转图标在文字右侧，其他图标在文字左侧。“不再显示”为独立胶囊按钮。

打开网页：

```json
{
  "label": { "zh-CN": "查看教程", "en": "Read guide" },
  "action": {
    "type": "url",
    "url": { "zh-CN": "https://voxcue.com.cn/", "en": "https://voxcue.com.cn/en/" }
  }
}
```

网址支持普通字符串或双语对象，须为不含账号密码的 HTTPS 地址。通过现有桌面链接接口打开系统浏览器。

进入客户端：`{ "type": "navigate", "target": "ai" }`。

| `target` | 进入的位置 |
| --- | --- |
| `account` | VoxCue 账号设置 |
| `ai` | AI 服务设置 |
| `components` | 本地组件设置 |
| `interview` | 面试设置 |
| `general` | 通用设置 |
| `shortcuts` | 快捷键设置 |
| `speech-model` | 面试设置中的语音模型，定位并高亮 |
| `audio-devices` | 面试设置中的音频设备，定位并高亮 |
| `personal-info` | 准备页个人信息面板 |
| `about` | 关于与更新 |

这里只打开页面和定位，不自动修改设置，不包含多步骤教学。配置不支持脚本或任意客户端命令。

## 显示与关闭

- 仅在准备页顶部显示，一次一条，按配置数组顺序展示；更新完成提示显示期间先保留公告队列。
- X 关闭当前公告，本次启动不再显示；点击次数随当前账户的本机资料保存，重启继续累计。同一 ID 达到 3 次后不再显示。
- “不再显示”立即将当前 ID 记为不再显示，效果等同累计 3 次 X。不同 ID 的计数互不影响，不跨设备同步。
- 过期时间到达时，即使窗口一直打开也会自动隐藏；下次成功读取到删除后的配置时撤下对应公告。
- 拉取失败、配置无效或请求超时返回明确失败状态，不使用示例内容，不阻塞聊天和面试。配置最多 20 条、响应最多 64 KiB，请求超时 8 秒。

## 验证入口

`announcements.test.ts`、`announcement-store.test.ts`、`desktop-ipc.test.ts`、`ui-language.test.ts` 和隔离的 `announcement-ui-smoke.mjs`。
