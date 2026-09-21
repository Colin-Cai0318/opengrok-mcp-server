# OpenGrok MCP Team Deploy

面向无 root Linux 开发机的一键部署包。一个 MCP 进程会自动发现并路由多个 OpenGrok 服务器上的项目。

## 安装

```bash
unzip opengrok-mcp-team-deploy-__DEPLOY_VERSION__.zip
cd opengrok-mcp-team-deploy-__DEPLOY_VERSION__
./install.sh
```

首次安装后，在 Chrome `chrome://extensions/` 中选择“加载已解压的扩展程序”：

```text
~/.local/share/opengrok-mcp/chrome-extension
```

然后打开并登录三个 OpenGrok，点击扩展中的“立即同步 Cookie”，重启 VS Code 中的 `opengrok-android-routing`。

## 验证

```bash
./status.sh
~/.local/bin/test-opengrok-routing.sh
```

通过标准：三个服务器均显示 `PASS`，并且项目路由测试能在对应服务器返回结果。失败时先执行 `./status.sh`；不要在反馈或日志中粘贴 Cookie、Helper Token、密码或完整认证 Header。

## 配置说明

- 三个独立 MCP 实例合并为一个 `opengrok-android-routing` 实例。
- 默认启用精简 Code Mode，仅加载 5 个工具；项目目录和完整 API 仅在需要时查询，避免启动即占满对话上下文。
- V/W 通过连接级 `proxyEnv=OPENGROK_PROXY_VW` 使用代理。
- X/A17 通过连接级 `direct=true` 强制直连，不受进程全局代理污染。
- 跨服务器搜索结果按确定性 round-robin 合并。
- 内置并固定到源码提交 `__SOURCE_COMMIT__`，不会因 npm `latest` 变化而漂移。
- 升级 HyperCode 配置时自动移除本包旧版 V/W/X 三个条目；标准 VS Code 若仍显示旧条目，需要手动禁用或删除。

如确需传统的独立工具界面，可将 VS Code MCP 配置中的 `OPENGROK_CODE_MODE` 改为 `false` 后重启 MCP；团队部署建议保持 `true`。

说明：命令行 `--version` 显示 npm 包版本 `__NPM_PACKAGE_VERSION__`；实际构建来源以 `SOURCE_COMMIT` 和 `PACKAGE_MANIFEST.json` 为准。
