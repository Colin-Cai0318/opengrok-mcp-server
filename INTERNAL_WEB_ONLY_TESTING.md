# 内网 Web-only 工具面与回归测试

## 当前工具面

标准模式（`OPENGROK_CODE_MODE=false`）仅暴露 12 个工具：

- `opengrok_index_health`
- `opengrok_list_projects`
- `opengrok_search_code`
- `opengrok_find_file`
- `opengrok_get_file_content`
- `opengrok_get_file_symbols`
- `opengrok_browse_directory`
- `opengrok_get_symbol_context`
- `opengrok_search_and_read`
- `opengrok_batch_search`
- `opengrok_dependency_map`
- `opengrok_get_compile_info`（本地可选，需要 `compile_commands.json`）

Code Mode（`OPENGROK_CODE_MODE=true`）仅暴露 5 个 MCP 工具：

- `opengrok_api`
- `opengrok_execute`
- `opengrok_memory_status`
- `opengrok_read_memory`
- `opengrok_update_memory`

`opengrok_execute` 内的 `env.opengrok` 白名单也只保留 Web/local 能力，不允许绕过标准工具面调用已删除能力。

## 已删除的内网不兼容工具

以下工具依赖当前内网 OpenGrok 未提供的 REST、suggester 或 SCM/annotate 能力，不再注册：

- `opengrok_search_pattern`
- `opengrok_search_suggest`
- `opengrok_get_file_history`
- `opengrok_get_file_diff`
- `opengrok_get_file_annotate`
- `opengrok_blame`
- `opengrok_what_changed`
- `opengrok_call_graph`

## 全量回归脚本

先构建：

```bash
npm ci
npm run compile
```

Cookie 认证示例（Cookie 不会写入终端输出或 JSON 报告）：

```bash
export OPENGROK_COOKIE='your-cookie'
npm run test:internal -- \
  --base-url 'https://opengrok.example.com/opengrok/' \
  --projects 'project-a,project-b' \
  --query 'known text' \
  --symbol 'KnownSymbol'
```

PowerShell：

```powershell
$env:OPENGROK_COOKIE = 'your-cookie'
npm run test:internal -- `
  --base-url 'https://opengrok.example.com/opengrok/' `
  --projects 'project-a,project-b' `
  --query 'known text' `
  --symbol 'KnownSymbol'
```

脚本会启动两个独立的 stdio MCP 进程：

1. 标准模式：严格断言工具列表等于 12 个，并逐一调用全部工具；`opengrok_search_code` 额外覆盖 full、defs、refs 和多项目参数。
2. Code Mode：严格断言工具列表等于 5 个，逐一调用全部工具，并检查 API 文档中没有已删除的方法。
3. 自动创建临时 memory bank，验证读、写、状态工具后清理。
4. 输出时间戳 JSON 报告；任一失败时进程退出码为 1。

若查询结果无法自动推导出一个已索引文件，请传入：

```bash
--known-project project-a --known-file path/to/known/source.c
```

本地编译信息是可选能力。没有 `compile_commands.json` 时，只要求工具返回明确的不可用说明；可用 `--compile-info-path` 指定本地源文件路径。

完整参数：

```bash
npm run test:internal -- --help
```
