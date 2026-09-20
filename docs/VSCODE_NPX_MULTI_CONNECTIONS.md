# VS Code：通过 npm/npx 启动自动路由的 OpenGrok MCP 连接

本配置只启动一个 stdio MCP 进程。进程启动时会并行读取三个 OpenGrok URL 的项目列表，建立“项目名 → 连接”路由；搜索、读取文件、目录浏览与符号查询会自动发往项目所属 URL。每个 URL 仍使用独立客户端、Cookie、缓存和限流器。

| MCP 名称 | Android 版本 | 连接名 |
| --- | --- | --- |
| `opengrok-android-v` | Android 15 | `opengrok-android-v` |
| `opengrok-android-w` | Android 16 | `opengrok-android-w` |
| `opengrok-android-x` | Android 17 | `opengrok-android-x` |

项目名在所有服务器间必须唯一；重复时进程会拒绝启动，避免误路由。项目不明确时应先调用项目列表工具。

## 1. 先确认 npm 包是否已发布

发布后的推荐命令是：

```powershell
npx -y @colin-cai0318/opengrok-mcp-server --help
```

可用下面的命令确认 registry 中的版本：

```powershell
npm view @colin-cai0318/opengrok-mcp-server version --registry=https://registry.npmjs.org
```

若该命令返回 404，说明包尚未发布。此时将下文 `args` 中的包名替换为
`github:Colin-Cai0318/opengrok-mcp-server#main`，例如：

```json
["-y", "github:Colin-Cai0318/opengrok-mcp-server#main", "--connections-file", "..."]
```

GitHub 方式适合发布前验证；正式部署应使用已发布、固定版本的 npm 包，例如 `@colin-cai0318/opengrok-mcp-server@9.3.0`。

## 2. 在用户私有目录保存连接元数据

新建 `C:\Users\<用户名>\.config\opengrok-mcp\connections.json`。URL 可以保存，Cookie 不要保存到此文件。

```json
{
  "connections": {
    "opengrok-android-v": {
      "url": "https://opengrok.example.internal/android-v/",
      "cookieEnv": "OPENGROK_COOKIE_ANDROID_V",
      "proxyEnv": "OPENGROK_PROXY_ANDROID_VW"
    },
    "opengrok-android-w": {
      "url": "https://opengrok.example.internal/android-w/",
      "cookieEnv": "OPENGROK_COOKIE_ANDROID_W",
      "proxyEnv": "OPENGROK_PROXY_ANDROID_VW"
    },
    "opengrok-android-x": {
      "url": "https://opengrok.example.internal/android-x/",
      "cookieEnv": "OPENGROK_COOKIE_ANDROID_X",
      "direct": true
    }
  }
}
```

`defaultProject` 是可选项，但整个文件最多只能配置一个。通常建议不配置，让模型使用启动时发现的精确项目名。

## 3. 单独保存 Cookie 和 Proxy

新建同目录文件 `C:\Users\<用户名>\.config\opengrok-mcp\cookies.env`：

```dotenv
OPENGROK_COOKIE_ANDROID_V=Cookie_Android_15_Only
OPENGROK_COOKIE_ANDROID_W=Cookie_Android_16_Only
OPENGROK_COOKIE_ANDROID_X=Cookie_Android_17_Only
OPENGROK_PROXY_ANDROID_VW=http://10.108.157.36:80
```

注意：

- 不要把真实 Cookie 写入 `.vscode/mcp.json`、`connections.json`、代码仓库或命令行参数。
- `proxyEnv` 只影响引用它的连接；`direct: true` 会显式屏蔽进程继承的 `HTTP_PROXY` 和 `HTTPS_PROXY`。同一个连接不能同时配置两者。
- 将 `cookies.env` 保留在用户目录，不加入 Git；Windows 上仅授予当前用户读取权限。
- Cookie 过期后只需更新 `cookies.env`，然后在 VS Code 中重启该 MCP server。

## 4. 配置 VS Code

在 VS Code 执行 `MCP: Open User Configuration`，将以下内容加入用户 `mcp.json`。用户配置适合个人内网 Cookie；不要把它提交到项目仓库。

```json
{
  "servers": {
    "opengrok-auto-router": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@colin-cai0318/opengrok-mcp-server@9.3.0",
        "--connections-file",
        "C:/Users/<用户名>/.config/opengrok-mcp/connections.json"
      ],
      "envFile": "C:/Users/<用户名>/.config/opengrok-mcp/cookies.env"
    }
  }
}
```

将 `<用户名>` 和三个 URL 改为实际值。将包版本固定为已验证版本，升级前先在测试环境验证。

如果使用 Remote SSH、Dev Container 或 WSL，MCP 进程运行在远端环境；`connections.json`、`cookies.env`、Node.js 和 `npx` 都必须位于该远端环境中。可通过 `MCP: Open Remote User Configuration` 编辑远端配置。

## 5. 启动和排错

1. 保存 `mcp.json`，执行 `MCP: List Servers`。
2. 启动 `opengrok-auto-router`，确认它为 Running；启动日志应列出三个 URL，项目目录会出现在初始化提示中。
3. 若工具列表仍是旧缓存，执行 `MCP: Reset Cached Tools` 后重启 server。
4. 打开 Chat 的 Agent 模式；查询时提供精确项目名，路由器会自动选择 URL。

常见错误：

| 现象 | 处理 |
| --- | --- |
| `npx` 404 | 先运行第 1 节的 `npm view`；未发布时使用 GitHub 临时包，或等待/执行 npm 发布。 |
| `requires environment variable` | 检查 `cookieEnv` 名称与 `cookies.env` 的变量名完全一致，并重启 server。 |
| `cannot configure both proxyEnv and direct` | 同一个连接只保留 `proxyEnv` 或 `direct: true` 其中之一。 |
| 401/403 | 对应 Android 连接的 Cookie 已过期或没有该 URL 的权限。 |
| 找不到项目 | 删除错误的 `defaultProject`，调用项目列表工具后使用精确项目名。 |
| 项目名冲突 | 两个服务器暴露了同名项目；调整索引项目名，确保全局唯一后重启。 |
| 任一服务器发现失败 | 启动会失败并指出连接名；检查该 URL、TLS 和对应 Cookie。 |

VS Code 的 `mcp.json` 支持 `env` 和 `envFile`，并建议不要在配置中硬编码敏感值；相关配置位置和管理命令以 VS Code 官方文档为准：[MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)、[Add and manage MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers)。
