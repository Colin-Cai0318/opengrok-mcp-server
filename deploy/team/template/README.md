# OpenGrok MCP Team Deploy — Routing Canary

面向无 root Linux 开发机的一键部署包。此版本用于验证一个 MCP 进程自动发现并路由 Android V/W/X 项目。

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

完整人工验证步骤和结果回填表见 `INTRANET_TEST_CHECKLIST.md`，部署细节见 `OPENGROK_MCP_TEAM_DEPLOYMENT.md`。

## 本 Canary 的关键变化

- 三个独立 MCP 实例合并为一个 `opengrok-android-routing` 实例。
- V/W 通过连接级 `proxyEnv=OPENGROK_PROXY_VW` 使用代理。
- X/A17 通过连接级 `direct=true` 强制直连，不受进程全局代理污染。
- 跨服务器搜索结果按确定性 round-robin 合并。
- 内置并固定到源码提交 `__SOURCE_COMMIT__`，不会因 npm `latest` 变化而漂移。
- 升级 HyperCode 配置时自动移除本包旧版 V/W/X 三个条目；标准 VS Code 若仍显示旧条目，需要手动禁用或删除。

不要在反馈或日志中粘贴 Cookie、Helper Token 或完整认证 Header。

说明：命令行 `--version` 显示 npm 包版本 `__NPM_PACKAGE_VERSION__`；实际构建来源以 `SOURCE_COMMIT` 和 `PACKAGE_MANIFEST.json` 为准。
