# OpenGrok Multi-URL Routing 内网测试清单

测试包：`__DEPLOY_VERSION__`
源码提交：`__SOURCE_COMMIT__`

请在目标 Linux/Remote SSH 环境执行。反馈时只需要返回测试编号、PASS/FAIL 和脱敏后的错误；不要提供 Cookie、Helper Token、密码或完整认证 Header。

## A. 安装与升级

### A1 — 文件完整性

```bash
unzip -t opengrok-mcp-team-deploy-__DEPLOY_VERSION__.zip
cat opengrok-mcp-team-deploy-__DEPLOY_VERSION__/VERSION
cd opengrok-mcp-team-deploy-__DEPLOY_VERSION__
sha256sum -c SHA256SUMS
```

期望：zip 检查无错误，版本为 `__DEPLOY_VERSION__`。

- [ ] PASS
- [ ] FAIL：

### A2 — 一键安装

```bash
cd opengrok-mcp-team-deploy-__DEPLOY_VERSION__
./install.sh
```

期望：无需 sudo，安装结束无 error；显示 bundled Canary 安装源。

- [ ] PASS
- [ ] FAIL：

### A3 — 从 v1.0.1 升级

仅在原来安装过 v1.0.1 的机器检查：

- 配置变化时生成 `.bak.<时间戳>`。
- 已有 `helper.token` 和 Cookie 未丢失。
- HyperCode 配置中旧 V/W/X 三项被替换为一个 routed 项。
- 标准 VS Code 如仍显示旧三项，人工删除或禁用。

- [ ] PASS
- [ ] 不适用
- [ ] FAIL：

## B. Helper 与 Cookie

### B1 — 状态检查

```bash
./status.sh
```

期望：

- Helper `running`。
- `OPENGROK_COOKIE_V/W/X` 都是 `present`。
- Native routing 显示 V/W 为 `proxyEnv=OPENGROK_PROXY_VW`，X 为 `direct`。
- Runtime source 指向 bundled `opengrok-mcp-server-routing-canary.tgz`。

- [ ] PASS
- [ ] FAIL：

### B2 — Cookie 自动同步

1. Chrome 扩展点击“立即同步 Cookie”。
2. 再次运行 `./status.sh`。
3. 观察 `updatedAt` 更新，界面不显示 Cookie 内容。

- [ ] PASS
- [ ] FAIL：

### B3 — Cookie 刷新后重启 MCP

1. 在任一 OpenGrok 重新登录或刷新认证。
2. 等待扩展同步。
3. 在 VS Code 重启 `opengrok-android-routing`。
4. 对该服务器项目执行一次搜索。

期望：重启后搜索正常，无 401/403。

- [ ] PASS
- [ ] FAIL：

## C. Proxy/Direct 隔离

### C1 — 自动 Smoke Test（关键）

```bash
~/.local/bin/test-opengrok-routing.sh
```

该脚本会把 MCP 进程的全局 `HTTP_PROXY/HTTPS_PROXY` 故意设为 `http://127.0.0.1:9`。期望输出：

```text
PASS: opengrok-android-v: proxyEnv=OPENGROK_PROXY_VW, cookie present
PASS: opengrok-android-w: proxyEnv=OPENGROK_PROXY_VW, cookie present
PASS: opengrok-android-x: direct=true, cookie present
PASS: V/W/X project discovery completed in one routed MCP process
PASS: V/W proxy and X direct worked despite bad global HTTP(S)_PROXY
```

- [ ] PASS
- [ ] FAIL（请附脱敏输出）：

### C2 — 配置核对

```bash
/usr/bin/python3 -m json.tool ~/.config/opengrok-mcp/connections.json
/usr/bin/python3 -m json.tool ~/.config/opengrok-mcp/network.json
```

期望：V/W 引用同一 `OPENGROK_PROXY_VW`，X 只有 `direct: true`；同一连接不存在 `proxyEnv + direct` 冲突。

- [ ] PASS
- [ ] FAIL：

## D. 单 MCP 自动路由

### D1 — VS Code 注册

打开 `MCP: List Servers`。

期望：只启用一个 `opengrok-android-routing`，状态正常；旧 `opengrok-android-v/w/x` 未启用。

- [ ] PASS
- [ ] FAIL：

### D2 — 项目发现

通过 MCP 调用：

```text
opengrok_list_projects
```

从返回值中各记录一个确认属于 V/W/X 的精确项目名：

```text
V_PROJECT=
W_PROJECT=
X_PROJECT=
```

期望：三个服务器的项目都存在，没有 `project discovery failed` 或同名项目冲突。

- [ ] PASS
- [ ] FAIL：

### D3 — 三条单项目路由

分别调用三次：

```json
{
  "query": "main",
  "search_type": "full",
  "projects": ["<V_PROJECT 或 W_PROJECT 或 X_PROJECT>"],
  "max_results": 3
}
```

工具：`opengrok_search_code`。

期望：V、W、X 三次都成功，结果中的 `project` 与请求项目一致。若 `main` 无命中，可换 `init`、`config` 或已知关键字。

- [ ] V PASS
- [ ] W PASS
- [ ] X PASS
- [ ] FAIL：

### D4 — 文件类工具路由

从 D3 的每个服务器结果中取一个路径，分别读取文件或查询符号。

期望：三次都从正确项目返回内容，没有被发到其他 URL。

- [ ] V PASS
- [ ] W PASS
- [ ] X PASS
- [ ] FAIL：

## E. 跨服务器公平合并

### E1 — 准备共同命中关键词

分别对 `V_PROJECT` 和 `W_PROJECT` 单独搜索同一关键词，确保双方各自至少有 5 条结果。建议依次尝试：

```text
init
main
config
probe
```

记录最终关键词：

```text
QUERY=
V 单独命中条数=
W 单独命中条数=
```

- [ ] PASS
- [ ] FAIL：

### E2 — V/W 联合搜索（关键）

```json
{
  "query": "<QUERY>",
  "search_type": "full",
  "projects": ["<V_PROJECT>", "<W_PROJECT>"],
  "max_results": 10
}
```

期望：

- 返回不超过 10 条。
- V 与 W 都至少出现 1 条。
- 两边都充足时顺序应接近 `V1,W1,V2,W2...`，不能前 10 条全部来自 V。

记录：

```text
总返回条数=
V 返回条数=
W 返回条数=
项目顺序（只写项目名，不写代码内容）=
```

- [ ] PASS
- [ ] FAIL：

### E3 — 三服务器联合搜索

在确认 V/W/X 对同一关键词都有命中后，以三个项目执行 `max_results=9` 联合搜索。

期望：三个项目都至少出现 1 条；有充足结果时按三路轮询。

```text
总返回条数=
V 返回条数=
W 返回条数=
X 返回条数=
```

- [ ] PASS
- [ ] FAIL：

### E4 — 一个服务器结果较少

选择一个让 A 只有少量结果、B 有较多结果的关键词，执行 `max_results=8` 联合搜索。

期望：A 耗尽后，B 继续填充剩余配额，不会提前停止。

- [ ] PASS
- [ ] 暂无合适数据，不适用
- [ ] FAIL：

## F. 稳定性与安全

### F1 — 重启恢复

```bash
~/.local/bin/stop-opengrok-cookie-helper.sh
```

然后在 VS Code 重启 routed MCP。

期望：wrapper 自动拉起 Helper，MCP 恢复正常。

- [ ] PASS
- [ ] FAIL：

### F2 — 权限与敏感信息

```bash
stat -c '%a %n' ~/.config/opengrok-mcp ~/.config/opengrok-mcp/helper.token ~/.config/opengrok-mcp/cookies.json
find . -type f \( -name 'helper.token' -o -name 'cookies.json' -o -name 'opengrok.env' -o -name '*.cookie' \) -print
```

期望：配置目录为 700；Token/Cookie 文件为 600；`find` 不输出任何文件，说明解压包没有打入运行时凭据。

- [ ] PASS
- [ ] FAIL：

### F3 — 连续使用观察

正常使用至少 30 分钟，覆盖多次 V/W/X 查询和一次 Cookie 自动同步。

期望：无异常退出、无持续重启、无路由漂移。

- [ ] PASS
- [ ] FAIL：

## 反馈模板

```text
测试机器/环境：
Node 版本：
VS Code / HyperCode 版本：
安装方式：全新 / 从 v1.0.1 升级

A1: PASS/FAIL
A2: PASS/FAIL
A3: PASS/FAIL/NA
B1: PASS/FAIL
B2: PASS/FAIL
B3: PASS/FAIL
C1: PASS/FAIL
C2: PASS/FAIL
D1: PASS/FAIL
D2: PASS/FAIL
D3: V=?, W=?, X=?
D4: V=?, W=?, X=?
E1: PASS/FAIL
E2: PASS/FAIL（总=?, V=?, W=?）
E3: PASS/FAIL（总=?, V=?, W=?, X=?）
E4: PASS/FAIL/NA
F1: PASS/FAIL
F2: PASS/FAIL
F3: PASS/FAIL

脱敏错误与复现步骤：
```

说明：跨服务器 `start_index` 当前是 per-route，不是全局 merged pagination；本次 Canary 不验证全局分页语义。
