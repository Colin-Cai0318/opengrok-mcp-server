# VS Code：通过 npm/npx 启动三个独立 OpenGrok MCP 连接

本配置会启动三个独立的 stdio MCP 进程。每个进程只连接一个 OpenGrok URL、只读取自己的 Cookie，因此缓存、认证和默认项目不会互相串用。

| MCP 名称 | Android 版本 | 连接名 |
| --- | --- | --- |
| `opengrok-android-v` | Android 15 | `opengrok-android-v` |
| `opengrok-android-w` | Android 16 | `opengrok-android-w` |
| `opengrok-android-x` | Android 17 | `opengrok-android-x` |

服务器提示词也遵循此映射：版本不明确时会要求用户指定连接；项目名不明确时会要求提供精确、非空的 OpenGrok project。

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
["-y", "github:Colin-Cai0318/opengrok-mcp-server#main", "--connections-file", "...", "--connection", "opengrok-android-v"]
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
      "defaultProject": "android-v"
    },
    "opengrok-android-w": {
      "url": "https://opengrok.example.internal/android-w/",
      "cookieEnv": "OPENGROK_COOKIE_ANDROID_W",
      "defaultProject": "android-w"
    },
    "opengrok-android-x": {
      "url": "https://opengrok.example.internal/android-x/",
      "cookieEnv": "OPENGROK_COOKIE_ANDROID_X",
      "defaultProject": "android-x"
    }
  }
}
```

`defaultProject` 是可选项。若一个连接中有多个项目且不希望自动选择，请删除该字段；模型会先要求用户提供项目名或调用项目列表工具确认。

## 3. 单独保存三个 Cookie

新建同目录文件 `C:\Users\<用户名>\.config\opengrok-mcp\cookies.env`：

```dotenv
OPENGROK_COOKIE_ANDROID_V=Cookie_Android_15_Only
OPENGROK_COOKIE_ANDROID_W=Cookie_Android_16_Only
OPENGROK_COOKIE_ANDROID_X=Cookie_Android_17_Only
```

注意：

- 不要把真实 Cookie 写入 `.vscode/mcp.json`、`connections.json`、代码仓库或命令行参数。
- 将 `cookies.env` 保留在用户目录，不加入 Git；Windows 上仅授予当前用户读取权限。
- Cookie 过期后只需更新 `cookies.env`，然后在 VS Code 中重启对应 MCP server。

## 4. 配置 VS Code

在 VS Code 执行 `MCP: Open User Configuration`，将以下内容加入用户 `mcp.json`。用户配置适合个人内网 Cookie；不要把它提交到项目仓库。

```json
{
  "servers": {
    "opengrok-android-v": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@colin-cai0318/opengrok-mcp-server@9.3.0",
        "--connections-file",
        "C:/Users/<用户名>/.config/opengrok-mcp/connections.json",
        "--connection",
        "opengrok-android-v"
      ],
      "envFile": "C:/Users/<用户名>/.config/opengrok-mcp/cookies.env"
    },
    "opengrok-android-w": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@colin-cai0318/opengrok-mcp-server@9.3.0",
        "--connections-file",
        "C:/Users/<用户名>/.config/opengrok-mcp/connections.json",
        "--connection",
        "opengrok-android-w"
      ],
      "envFile": "C:/Users/<用户名>/.config/opengrok-mcp/cookies.env"
    },
    "opengrok-android-x": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@colin-cai0318/opengrok-mcp-server@9.3.0",
        "--connections-file",
        "C:/Users/<用户名>/.config/opengrok-mcp/connections.json",
        "--connection",
        "opengrok-android-x"
      ],
      "envFile": "C:/Users/<用户名>/.config/opengrok-mcp/cookies.env"
    }
  }
}
```

将 `<用户名>`、三个 URL 和项目名改为实际值。将包版本固定为已验证版本，升级时先在一个连接上验证，再同时升级三个条目。

如果使用 Remote SSH、Dev Container 或 WSL，MCP 进程运行在远端环境；`connections.json`、`cookies.env`、Node.js 和 `npx` 都必须位于该远端环境中。可通过 `MCP: Open Remote User Configuration` 编辑远端配置。

## 5. 启动和排错

1. 保存 `mcp.json`，执行 `MCP: List Servers`。
2. 分别启动三个 `opengrok-android-*` server，确认每一个都为 Running。
3. 若工具列表仍是旧缓存，执行 `MCP: Reset Cached Tools` 后重启对应 server。
4. 打开 Chat 的 Agent 模式；查询 Android 15/16/17 时选择对应 MCP server。版本或项目不明确时，先向用户追问，不要猜测。

常见错误：

| 现象 | 处理 |
| --- | --- |
| `npx` 404 | 先运行第 1 节的 `npm view`；未发布时使用 GitHub 临时包，或等待/执行 npm 发布。 |
| `requires environment variable` | 检查 `cookieEnv` 名称与 `cookies.env` 的变量名完全一致，并重启 server。 |
| 401/403 | 对应 Android 连接的 Cookie 已过期或没有该 URL 的权限。 |
| 找不到项目 | 删除错误的 `defaultProject`，调用项目列表工具后使用精确项目名。 |
| 三个连接串数据 | 确认三个 server 都各自传递了不同的 `--connection`，不要共用一个直接 `--url` 进程。 |

VS Code 的 `mcp.json` 支持 `env` 和 `envFile`，并建议不要在配置中硬编码敏感值；相关配置位置和管理命令以 VS Code 官方文档为准：[MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)、[Add and manage MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers)。
