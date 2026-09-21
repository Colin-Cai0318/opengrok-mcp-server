# OpenGrok MCP 团队一键部署指南

> 部署包：`__DEPLOY_VERSION__`
> MCP 源码提交：`__SOURCE_COMMIT__`
> 目标环境：无 root 权限的 Linux 开发机，VS Code/Remote SSH/HyperCode + Google Chrome。

## 1. 架构

此 Canary 使用一个 MCP 进程完成三个 OpenGrok 的项目发现和自动路由：

```text
VS Code / HyperCode
        │
        ▼
opengrok-android-routing（单进程）
        │
        ├─ Android V ─ proxyEnv ─┐
        ├─ Android W ─ proxyEnv ─┤ __OPENGROK_PROXY_VW__
        └─ Android X ─ direct ───┘ 不经过上述代理
```

启动时会查询三个服务器的项目列表。后续工具调用根据精确项目名自动选择对应 URL；跨服务器搜索并行执行并按 round-robin 合并结果。

Cookie 链路保持不变：Chrome 扩展读取当前登录态，通过仅监听 `127.0.0.1:8765` 且带随机 Token 的 Helper 写入用户目录。压缩包不包含 Cookie、密码或 Helper Token。

## 2. 前置条件

```bash
node -v
npm -v
/usr/bin/python3 --version
```

要求：

- Linux，Node.js 22+，npm 可用，`/usr/bin/python3` 可用。
- Google Chrome 已安装。
- 能访问 GitHub/npm 依赖源；MCP 主程序本身已固定打包在压缩包内。
- 能从目标机器访问公司 OpenGrok 网络。
- 无需 sudo、root、systemd 或 D-Bus。

## 3. 安装或从 v1.0.1 升级

```bash
unzip opengrok-mcp-team-deploy-__DEPLOY_VERSION__.zip
cd opengrok-mcp-team-deploy-__DEPLOY_VERSION__
./install.sh
```

安装脚本会：

1. 检查 Node/npm/Python。
2. 把脚本安装到 `~/.local/bin/`。
3. 把连接配置安装到 `~/.config/opengrok-mcp/`。
4. 备份发生变化的旧配置，备份名带时间戳。
5. 把固定提交构建出的 npm tarball 安装到 `~/.local/share/opengrok-mcp/runtime/`。
6. 启动 Cookie Helper，并沿用已有的本机 Token。
7. 生成绑定本机 Token 的 Chrome 扩展副本。
8. 注册一个 `opengrok-android-routing` MCP。

HyperCode 的用户 MCP JSON 会自动删除本包旧版的 `opengrok-android-v/w/x` 三项，并保留其他无关 MCP。标准 VS Code CLI 没有在此脚本中假设删除接口；如果 UI 仍列出旧三项，请手动禁用或删除，只保留 `opengrok-android-routing`。

## 4. 首次人工操作

在 Chrome 打开 `chrome://extensions/`，启用开发者模式，选择“加载已解压的扩展程序”，目录为：

```text
~/.local/share/opengrok-mcp/chrome-extension
```

点击扩展图标：

1. “检查 Helper”。
2. “打开三个 OpenGrok 登录页”。
3. 分别完成 V/W/X 登录。
4. “立即同步 Cookie”。

扩展会在 Cookie 变化时同步，并每 5 分钟兜底同步。MCP 进程在启动时读取 Cookie；Cookie 更新后需重启 `opengrok-android-routing`。

## 5. 原生连接级网络配置

`~/.config/opengrok-mcp/connections.json` 中：

```json
{
  "connections": {
    "opengrok-android-v": {
      "url": "__OPENGROK_V_URL__",
      "cookieEnv": "OPENGROK_COOKIE_V",
      "proxyEnv": "OPENGROK_PROXY_VW",
      "verifySsl": true
    },
    "opengrok-android-w": {
      "url": "__OPENGROK_W_URL__",
      "cookieEnv": "OPENGROK_COOKIE_W",
      "proxyEnv": "OPENGROK_PROXY_VW",
      "verifySsl": true
    },
    "opengrok-android-x": {
      "url": "__OPENGROK_X_URL__",
      "cookieEnv": "OPENGROK_COOKIE_X",
      "direct": true,
      "verifySsl": true
    }
  }
}
```

`~/.config/opengrok-mcp/network.json` 提供非敏感代理地址：

```json
{
  "OPENGROK_PROXY_VW": "__OPENGROK_PROXY_VW__"
}
```

Wrapper 只负责把 Cookie 与 `OPENGROK_PROXY_VW` 注入一个 MCP 进程。真正的 Proxy/Direct 选择由 MCP 内部按 connection 执行：

- `proxyEnv` 只覆盖当前连接的 `HTTP_PROXY/HTTPS_PROXY`。
- `direct: true` 把当前连接的 `HTTP_PROXY/HTTPS_PROXY` 显式置空。
- `proxyEnv` 与 `direct` 不能同时配置。
- 即使 VS Code 进程继承了错误的全局代理，V/W 仍使用指定代理，X 仍强制直连。

## 6. 状态与自动 Smoke Test

查看安装状态：

```bash
./status.sh
```

执行真实项目发现 Smoke Test：

```bash
~/.local/bin/test-opengrok-routing.sh
```

测试脚本会故意设置：

```text
HTTP_PROXY=http://127.0.0.1:9
HTTPS_PROXY=http://127.0.0.1:9
```

随后启动单个路由 MCP。只有 V/W/X 都完成项目发现才会 PASS，因此可以同时验证 V/W 使用连接代理以及 X 屏蔽错误全局代理。

## 7. VS Code 中的功能验证

打开 `MCP: List Servers`，确认只启用：

```text
opengrok-android-routing
```

然后依次：

1. 列出项目，确认能看到来自 V/W/X 的项目。
2. 分别选一个 V、W、X 项目查询文件。
3. 使用一个 V 项目和一个 W 项目执行 `max_results=10` 的联合搜索。
4. 确认联合结果同时包含两个项目，且顺序交替或接近轮询。

跨服务器 `start_index` 当前是分别下发给每个服务器，不是合并结果的全局偏移。本 Canary 不把这一限制作为失败项。

## 8. 更新策略

普通更新会重新安装压缩包内固定的 Canary：

```bash
./update.sh
```

二进制执行 `--version` 时显示 npm 包版本 `__NPM_PACKAGE_VERSION__`。请使用 `SOURCE_COMMIT`、`PACKAGE_MANIFEST.json` 和 `installed-source.txt` 判断精确构建来源。

只有确认 npm 已发布包含多 URL 路由的正式版本后，才使用：

```bash
./update.sh --latest
```

也可以显式指定测试源：

```bash
OPENGROK_MCP_PACKAGE='@colin-cai0318/opengrok-mcp-server@9.3.2-routing.1' ./update.sh
```

## 9. 回滚与卸载

安装时生成的配置备份位于原文件旁，例如：

```text
~/.config/opengrok-mcp/connections.json.bak.20260921-120000
```

卸载程序和运行时但保留 Cookie/config：

```bash
./uninstall.sh
```

同时删除 Cookie/config：

```bash
./uninstall.sh --purge-config
```

卸载不会自动删除 VS Code MCP 注册项，需要在 VS Code 中手动删除。

## 10. 故障排查

| 现象 | 处理 |
| --- | --- |
| Helper 不正常 | 运行 `~/.local/bin/start-opengrok-cookie-helper.sh`，再执行 `./status.sh`。 |
| Cookie missing | 登录对应 OpenGrok，扩展点击“立即同步 Cookie”，然后重启 MCP。 |
| `requires environment variable OPENGROK_PROXY_VW` | 检查 `~/.config/opengrok-mcp/network.json`。 |
| V/W discovery failed | 检查 `__OPENGROK_PROXY_VW__` 是否可达、Cookie 是否有效。 |
| X discovery failed / `Proxy CONNECT aborted` | 确认 X 条目仍是 `direct: true`，并运行 Smoke Test。 |
| duplicate project names | 不同服务器暴露了同名项目；自动路由无法消歧，需调整索引项目名。 |
| VS Code 出现四个 OpenGrok MCP | 禁用或删除旧 V/W/X 三项，只保留 routed 项。 |
| MCP 启动后 Cookie 更新仍 401 | 重启 `opengrok-android-routing` 以重新读取 Cookie。 |

测试结果请按 `INTRANET_TEST_CHECKLIST.md` 回填；不要粘贴 Cookie、Token、密码或完整认证 Header。
