# OpenGrok MCP Team Deploy

面向无 root Linux 开发机的一键部署包。一个 MCP 进程会自动发现并路由多个 OpenGrok 服务器上的项目。

## 安装

```bash
unzip opengork-mcp-v__DEPLOY_VERSION__.zip
cd opengork-mcp-v__DEPLOY_VERSION__
./install.sh
```

首次安装后，在 Chrome `chrome://extensions/` 中选择“加载已解压的扩展程序”：

```text
~/.local/share/opengrok-mcp/chrome-extension
```

默认只启用名称以 `lx-` 开头的服务器。打开扩展，点击“打开所有已启用的 OpenGrok 登录页”，允许对应站点访问并完成登录，再点击“立即同步 Cookie”。重启 VS Code 中的 `opengrok-android-routing`。

## 扩展或移除服务器

安装包附带完整连接目录，当前启用项保存在 `~/.config/opengrok-mcp/connections.json`。以下命令可选择单个服务器、机房前缀或全部可选服务器：

```bash
~/.local/bin/manage-opengrok-connections.py list
~/.local/bin/manage-opengrok-connections.py add hq
~/.local/bin/manage-opengrok-connections.py add lq
~/.local/bin/manage-opengrok-connections.py add xm-opengrok-android-x
~/.local/bin/manage-opengrok-connections.py add all
~/.local/bin/manage-opengrok-connections.py remove hq
```

变更后重新打开扩展，打开登录页并同步 Cookie，然后重启 MCP。`remove` 不会移除 LX 默认连接，并清理被移除服务器在本机同步的 Cookie；重新运行安装脚本会保留当前启用列表。扩展每次从 Helper 读取当前连接，不需要重新打包。升级旧版扩展后，在 `chrome://extensions/` 点击一次“重新加载”。

连接目录沿用既有命名：`lq-` 代表 LC 站点，`add lq` 会同时启用 LC-W 和 LC-A17；其中 LC-A17 与 LX-A17 一样使用 `direct=true` 和 SSL 校验，但使用独立的 Cookie。

## 验证

```bash
./status.sh
~/.local/bin/test-opengrok-routing.sh
```

通过标准：所有当前启用服务器均显示 `PASS`，并且项目路由测试能在对应服务器返回结果。失败时先执行 `./status.sh`；不要在反馈或日志中粘贴 Cookie、Helper Token、密码或完整认证 Header。

## 配置说明

- 所有启用服务器由一个 `opengrok-android-routing` MCP 实例统一路由。
- 默认启用精简 Code Mode，仅加载 5 个工具；项目目录和完整 API 仅在需要时查询，避免启动即占满对话上下文。
- V/W 通过连接级 `proxyEnv=OPENGROK_PROXY_VW` 使用代理。
- X/A17 通过连接级 `direct=true` 强制直连，不受进程全局代理污染。
- 跨服务器搜索结果按确定性 round-robin 合并。
- 同名项目只保留首个已启用连接的路由；LX 默认位于前面。后加服务器上的同名项目不重复显示，也不重复搜索；启动日志会列出冲突摘要。
- 项目超过 50 个时，不要从目录预览猜测项目名；在 Code Mode 调用 `opengrok_api` 并传 `projectFilter` 查完整目录。请求的精确名称不存在时，先和用户确认，不自动换成相似项目。
- 某台服务器启动时不可达，其他服务器仍可用；首次对话应明确告知不可用连接名。修复该服务器后重启 MCP，让它重新发现项目。
- 内置并固定到源码提交 `__SOURCE_COMMIT__`，不会因 npm `latest` 变化而漂移。
- 升级 HyperCode 配置时自动移除本包旧版 V/W/X 三个条目；标准 VS Code 若仍显示旧条目，需要手动禁用或删除。

如确需传统的独立工具界面，可将 VS Code MCP 配置中的 `OPENGROK_CODE_MODE` 改为 `false` 后重启 MCP；团队部署建议保持 `true`。

说明：命令行 `--version` 显示 npm 包版本 `__NPM_PACKAGE_VERSION__`；实际构建来源以 `SOURCE_COMMIT` 和 `PACKAGE_MANIFEST.json` 为准。
