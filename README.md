<div align="center">

<img src="images/icon.png" width="120" alt="OpenGrok MCP Server logo">

# OpenGrok MCP Server

**MCP server bridging OpenGrok search engine with AI for instant context across massive codebases**

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/IcyHot09.opengrok-mcp-server?label=VS%20Code%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=IcyHot09.opengrok-mcp-server) [![Installs](https://img.shields.io/visual-studio-marketplace/i/IcyHot09.opengrok-mcp-server)](https://marketplace.visualstudio.com/items?itemName=IcyHot09.opengrok-mcp-server) [![npm](https://img.shields.io/npm/v/opengrok-mcp-server?logo=npm)](https://www.npmjs.com/package/opengrok-mcp-server) [![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-blue)](https://registry.modelcontextprotocol.io) [![CI](https://github.com/IcyHot09/opengrok-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/IcyHot09/opengrok-mcp-server/actions/workflows/ci.yml) [![GitHub Release](https://img.shields.io/github/v/release/IcyHot09/opengrok-mcp-server)](https://github.com/IcyHot09/opengrok-mcp-server/releases)

</div>

---

<details>
<summary>📚 Table of Contents</summary>

- [Overview](#overview)
- [Installation](#installation)
- [Multiple OpenGrok URLs](#multiple-opengrok-urls-automatic-project-routing)
- [Configuration Guide](#configuration-guide)
- [Prompting Examples](#prompting-examples)
- [Tool Reference](#tool-reference)
- [VS Code Integration](#vs-code-integration)
- [System Architecture](#system-architecture)
- [Building & Testing](#building--testing)
- [Troubleshooting & Support](#troubleshooting--support)
- [License Information](#license-information)

</details>

---

## Overview

> 💡 **Self-Contained Architecture:** The VS Code extension includes the MCP server pre-packaged. You don't need Python, external Node.js installations, or complex environment setups. Just install and go.

---

## Installation

### Option 1 — VS Code Extension (Recommended)

Install **OpenGrok MCP** from the VS Code Marketplace, or search "OpenGrok" in the Extensions panel.

The extension provides a visual configuration UI and manages the MCP server process automatically.

### Option 2 — npm / npx

**Global install:**
```bash
npm install -g @colin-cai0318/opengrok-mcp-server
opengrok-mcp setup      # interactive wizard: URL, credentials, MCP client registration
```

**Or run without installing:**
```bash
npx @colin-cai0318/opengrok-mcp-server setup
```

The wizard stores credentials securely in the OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret) with an encrypted file fallback for headless Linux.

## Multiple OpenGrok URLs (automatic project routing)

Run one MCP process for two or more OpenGrok servers. Before accepting an MCP connection, the
process queries every server's project catalog and builds an in-memory `project name → server`
routing table. Searches are grouped by project owner and sent in parallel; file content, directory,
symbol, dependency, and resource-link operations go only to the server that owns the exact project.

Multi-URL deployment uses the standalone stdio server. The extension settings UI and `setup`
wizard configure one URL; for multiple URLs, add the manual MCP server entry shown below.

### Deployment requirements

- Node.js 22 or newer is required when running the standalone npm/source build.
- The machine or container running the MCP process must be able to reach every configured URL.
- Project names must be globally unique across the configured servers. Duplicate names fail startup
  because routing them automatically would be ambiguous.
- Every server must return its project catalog during startup. Startup is all-or-nothing; an
  unreachable or unauthorized server is reported by connection name.
- Use an absolute path for the connections file in MCP client configuration. Relative paths are
  resolved from the MCP process working directory, which varies between clients.
- Put credentials in environment variables available to the MCP process, not in the JSON file,
  command arguments, or a repository.

### 1. Create the connections file

Create a private file such as `/opt/opengrok-mcp/connections.json` on Linux/macOS or
`C:\Users\<you>\.config\opengrok-mcp\connections.json` on Windows:

```json
{
  "connections": {
    "platform": {
      "url": "https://opengrok-platform.example/source/",
      "cookieEnv": "OPENGROK_PLATFORM_COOKIE",
      "proxyEnv": "OPENGROK_PLATFORM_PROXY",
      "defaultProject": "platform-main"
    },
    "firmware": {
      "url": "https://opengrok-firmware.example/source/",
      "username": "build-reader",
      "passwordEnv": "OPENGROK_FIRMWARE_PASSWORD",
      "verifySsl": true,
      "direct": true
    }
  }
}
```

Supported fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `url` | Yes | OpenGrok context root, for example `https://host/source/`. Use HTTPS whenever credentials are sent. |
| `cookieEnv` | No | Name of an environment variable containing the raw Cookie header value, for example `JSESSIONID=...; CASTGC=...`. Cookie authentication takes precedence over Basic authentication. |
| `username` | No | Basic-auth username. Use together with `passwordEnv`. |
| `passwordEnv` | No | Name of an environment variable containing the Basic-auth password. |
| `defaultProject` | No | Project used when a search omits `projects`. Configure this on at most one connection. |
| `verifySsl` | No | TLS certificate verification; defaults to `true`. Disable only for a trusted internal server with a self-signed certificate. |
| `proxyEnv` | No | Name of an environment variable containing the proxy URL. The proxy applies only to this connection. |
| `direct` | No | Set to `true` to ignore process-level `HTTP_PROXY`/`HTTPS_PROXY` for this connection. Cannot be combined with `proxyEnv`. |

Connections may use different authentication methods. Public servers can contain only `url`.
The names `platform` and `firmware` are diagnostic labels; routing uses the discovered OpenGrok
project names.

### 2. Provide credentials to the MCP process

For a shell session on Linux/macOS:

```bash
export OPENGROK_PLATFORM_COOKIE='JSESSIONID=...; CASTGC=...'
export OPENGROK_PLATFORM_PROXY='http://proxy.example:8080'
export OPENGROK_FIRMWARE_PASSWORD='...'
```

For PowerShell:

```powershell
$env:OPENGROK_PLATFORM_COOKIE = 'JSESSIONID=...; CASTGC=...'
$env:OPENGROK_PLATFORM_PROXY = 'http://proxy.example:8080'
$env:OPENGROK_FIRMWARE_PASSWORD = '...'
```

If the MCP client supports an environment file, keep it outside the repository with permissions
restricted to the current user:

```dotenv
OPENGROK_PLATFORM_COOKIE="JSESSIONID=...; CASTGC=..."
OPENGROK_PLATFORM_PROXY="http://proxy.example:8080"
OPENGROK_FIRMWARE_PASSWORD="..."
```

The environment variable names must exactly match `cookieEnv`, `passwordEnv`, and `proxyEnv`. The
server exits before making requests if a referenced variable is missing.

### 3. Start the routed server

After a release containing multi-URL routing is published:

```bash
npx -y @colin-cai0318/opengrok-mcp-server --connections-file /opt/opengrok-mcp/connections.json
```

To test a source checkout of this branch before publication:

```bash
npm ci
npm run package
node /absolute/path/to/opengrok-mcp-server/out/server/main.js \
  --connections-file /absolute/path/to/connections.json
```

For an MCP client, register exactly one stdio server. This VS Code example runs the checked-out
build and loads credentials from a private environment file:

```json
{
  "servers": {
    "opengrok-auto-router": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/opengrok-mcp-server/out/server/main.js",
        "--connections-file",
        "/absolute/path/to/connections.json"
      ],
      "envFile": "/absolute/path/to/opengrok.env"
    }
  }
}
```

On Windows, use forward slashes in JSON paths, for example
`C:/Users/me/.config/opengrok-mcp/connections.json`. When using Remote SSH, WSL, a Dev Container,
or another remote MCP host, Node.js, the built server, connections file, and credentials must all
exist in that remote environment.

### 4. Verify routing

1. Start the MCP server and check stderr for a line listing every connection name and URL.
2. Call `opengrok_list_projects` and confirm that projects from every server appear.
3. Call `opengrok_find_file` with one exact project from each server. Each result should retain the
   requested project name.
4. For a cross-server search, pass exact project names in `projects`; the router fans the request out
   and merges the results in deterministic round-robin order so every matching server is represented.

Do not omit `projects` unless one connection defines `defaultProject`. Unknown project names fail
with a preview of the discovered catalog instead of being sent to an arbitrary URL.

Cross-server pagination currently applies `start_index` independently to each server before merging;
it is not a global offset over the combined result stream. Single-server pagination is unchanged.

### Modes and troubleshooting

| Command | Behavior |
| --- | --- |
| `--connections-file FILE` | Automatic routing across every entry; requires at least two connections. |
| `--connections-file FILE --connection NAME` | Select one named entry and use legacy single-server mode. |
| `--url URL` | Connect directly to one server without a connections file. |

Direct options such as `--url`, `--username`, and `--cookie-env` cannot be combined with automatic
multi-server mode; put per-server settings in the connections file instead.

| Startup error | Resolution |
| --- | --- |
| `requires environment variable` | Define the variable named by `cookieEnv`, `passwordEnv`, or `proxyEnv` in the MCP process environment. |
| `cannot configure both proxyEnv and direct` | Choose a connection-specific proxy or forced direct mode for that entry, not both. |
| `project discovery failed` | Check the named URL, network route, TLS setting, and credentials. |
| `automatic routing ambiguous` | Two servers expose the same project name; rename/reindex one project or use separate single-server MCP processes. |
| `Default project ... was not discovered` | Correct or remove `defaultProject`; it must exactly match a discovered project name. |
| `Direct connection options cannot be combined` | Remove direct CLI options and move the values into the appropriate connection entry. |

See [MCP_CLIENTS.md](MCP_CLIENTS.md#automatic-multi-server-project-routing) for Claude, Codex,
Cursor, and other client snippets. Windows/VS Code users can also follow the detailed
[multi-connection guide](docs/VSCODE_NPX_MULTI_CONNECTIONS.md).

---

## Configuration Guide

1. **Provide Connection Details:**
   - After installation, the **Settings panel** will launch.
   - Input your OpenGrok endpoint, username, and password. Hit **Save Settings**. *(Credentials are locked in your native OS keychain).*
   - The plugin verifies the connection instantly. On your first run, VS Code will ask you to **Reload the Window** to register the MCP tools.
   - *(Need to change this later? Use the `OpenGrok: Manage Configuration` command or click the gear icon in the status bar).*

2. **Activate the MCP Source in Copilot:**
   - Launch the **GitHub Copilot Chat** window. Ensure you're using **Agent** mode.
   - Click the paperclip/tools icon (`🔧`) in the prompt box.
   - (If an **Update Tools** button appears, click it).
   - Locate **OpenGrok** in the list, check the box, and confirm.

> ⚠️ Note that VS Code manages tool authorizations **per workspace**. If you open a different repository, you may need to re-check the OpenGrok box in Copilot.

### CLI Commands (v7.0+)

| Command | Description |
| :------ | :---------- |
| `npx @colin-cai0318/opengrok-mcp-server setup` | Interactive wizard: configures your MCP client and stores credentials securely |
| `opengrok-mcp status` | Health check: validates connectivity and detects installed MCP clients. Reads config from `~/.claude.json`, `~/.copilot/mcp-config.json`, or Codex TOML when `OPENGROK_BASE_URL` is not in env |
| `opengrok-mcp --version` | Print version and exit |

`setup` supports **Claude Code CLI**, **GitHub Copilot CLI**, and **Codex CLI**. VS Code is configured automatically by the extension — no CLI step needed. Credentials are stored in the OS keychain with an AES-256-GCM encrypted file fallback for headless/CI environments.

### 🔌 Third-Party Client Support

While tailored for VS Code, the integrated server logic runs perfectly with other agents natively supporting the MCP protocol, including:

**Claude Desktop** | **Cursor IDE** | **Windsurf** | **Claude Code** | **Google Antigravity**

> **👉 Refer to [MCP_CLIENTS.md](MCP_CLIENTS.md)** for configuration snippets and advanced daemon setups.

---

## Prompting Examples

Talk to GitHub Copilot Chat naturally about your codebase:

```text
Find the implementation of the render_pipeline function within the graphics engine project.

Retrieve the contents of /src/utils/math.cpp from line 450 to 520.

What is the definition of TextureManager? Please show me the header file declaration too.

Look for all places in the code where ThreadPool is instantiated or referenced.
```

---

## Tool Reference

### Primary Operations

| Tool Name | Purpose |
| ---- | ----------- |
| `opengrok_search_code` | General Web search utility (full-text, defs, refs, path). Supports `file_type` filtering. |
| `opengrok_find_file` | Locate files by name or directory pattern. |
| `opengrok_get_file_content` | Read source code (requires `start_line` and `end_line` for large files). |
| `opengrok_browse_directory` | View folder structure and contained files. |
| `opengrok_list_projects` | See all indexed repositories/projects. |
| `opengrok_get_file_symbols` | Extract classes, functions, macros, and structs rapidly from a single file. |

### 🚀 Optimized Workflows (Compound Tools)

> 💡 These specialized tools merge multiple network requests into a single operation, reducing API chatter and cutting token usage by **up to 90%**.

| Compound Tool | Functionality Replaced | Efficiency Gain |
| ---- | ---------------- | ------------- |
| `opengrok_get_symbol_context` | 1) searches definition, 2) reads source, 3) fetches headers, 4) gets references | **~92% fewer tokens** |
| `opengrok_search_and_read` | 1) executes search, 2) immediately fetches surrounding code context | **~92% fewer tokens** |
| `opengrok_batch_search` | Combines 2-5 individual search queries; deduplicates `file:line` hits across queries | **~73% fewer tokens** |
| `opengrok_index_health` | Checks latency, backend connectivity, staleness score, and latency trend | Diagnostic utility |

*(Note: The search functions support language filtering. Pass `file_type` as `java`, `cxx`, `python`, `golang`, etc.)*

### 🔍 Investigation & Analysis Tools

| Tool | Purpose |
| ---- | ------- |
| `opengrok_dependency_map` | BFS traversal of `#include`/`import` chains up to configurable depth (1–3); directed graph with `uses`/`used_by` |

### 🧠 Memory Tools (Code Mode only, v5.4+)

| Tool | Purpose |
| ---- | ------- |
| `opengrok_memory_status` | Shows both memory files (status, bytes, 3-line preview) — helps LLM decide whether to read |
| `opengrok_read_memory` | Read `active-task.md` or `investigation-log.md` from the Living Document memory bank |
| `opengrok_update_memory` | Write or append to memory files; auto-timestamps `investigation-log.md` entries |

### 🧬 Code Mode (v5+) — For Large Multi-Language Codebases

Set `OPENGROK_CODE_MODE=true` to switch to a 5-tool interface optimised for multi-step investigations:

| Tool | Purpose |
| ---- | ------- |
| `opengrok_api` | Get the full API spec and project catalog on demand. Call it only when the project or method syntax is unknown. With `OPENGROK_ENABLE_ELICITATION=true`, it can also prompt for a working project. |
| `opengrok_execute` | Run JavaScript in a sandboxed QuickJS VM with access to all OpenGrok operations via `env.opengrok.*` |

All `env.opengrok.*` calls appear **synchronous** inside your code — the sandbox bridges async HTTP calls transparently using a SharedArrayBuffer + Atomics channel. Token savings of 80–95% are typical for complex investigations.

**v9.0+ sandbox methods for interactive prompts and AI assistance:**

| Method | Purpose |
| ------ | ------- |
| `env.opengrok.elicit(message, schema)` | Pause execution and ask the user to select from a list — e.g., pick the correct file from multiple matches. Returns `{ action, content }`. Requires `OPENGROK_ENABLE_ELICITATION=true`. |
| `env.opengrok.sample(prompt, opts?)` | Request an AI-generated string from the client's LLM — e.g., reformulate a zero-result query. Returns `string \| null` (null when client doesn't support sampling). Always null-guard the result. |

When `env.opengrok.search()` returns **zero results** and sampling is available, `_suggestions: string[]` is automatically injected into the result — check it before calling `sample()` explicitly.

```javascript
// Example opengrok_execute code
const refs = env.opengrok.search("handleCrash", { searchType: "refs", maxResults: 5 });
const first = refs.results[0];
const content = env.opengrok.getFileContent(first.project, first.path, {
  startLine: first.matches[0].lineNumber - 5,
  endLine: first.matches[0].lineNumber + 10,
});
return { callerFile: first.path, code: content.content };
```

The sandbox exposes a **Living Document Memory Bank** — two persistent markdown files that survive across turns:

| File | Size Limit | Purpose |
| ---- | ---------- | ------- |
| `active-task.md` | ≤ 4 KB | Current task state: `task:`, `last_symbol:`, `next_step:`, `open_questions:`, `status:` |
| `investigation-log.md` | ≤ 32 KB | Append-only log of findings, grouped by `## YYYY-MM-DD HH:MM:` headings |

Access via `env.opengrok.readMemory(filename)` / `env.opengrok.writeMemory(filename, content)` inside the sandbox, or via the `opengrok_read_memory` / `opengrok_update_memory` / `opengrok_memory_status` tools in classic mode. Delta encoding returns `[unchanged]` on repeated reads; richness-scored trimming keeps the most valuable log entries when space is tight.

<details>
<summary>⚙️ Automated Compilation Data (Optional)</summary>

| Tool Name | Capability |
| ---- | ----------- |
| `opengrok_get_compile_info` | Reads your local `compile_commands.json` to extract compiler flags, defines, and include directories for exact C/C++ accuracy. |

</details>

### Project Picker & Interactive Disambiguation (Elicitation)

When `OPENGROK_ENABLE_ELICITATION=true`, the server uses MCP Elicitation in two places:

1. **On-demand project selection** — `opengrok_api` (Code Mode) prompts the user to select a working project when invoked, if no `OPENGROK_DEFAULT_PROJECT` is configured and more than one project exists.
2. **Mid-execution** — Sandbox JS can call `env.opengrok.elicit(message, schema)` to ask the user to choose between multiple matching files, revisions, or projects at any point during execution.

Requires a client that supports MCP Elicitation:

- **Claude Code** v2.1.76+ ✓

Enable in the VS Code configuration panel, or set `OPENGROK_ENABLE_ELICITATION=true` in your MCP client environment config. The server degrades gracefully to `{ action: "cancel" }` on unsupported clients — no errors.

### LLM Sampling

The server delegates LLM calls back to the client via MCP Sampling — using the client's model subscription without needing separate API keys. Used in three places:

1. **Sandbox error explanation** — When `opengrok_execute` code fails, sampling generates a concise explanation and fix suggestion.
2. **Dependency graph summarization** — Large `opengrok_dependency_map` graphs (>10 nodes) are summarized via sampling in legacy mode.
3. **Zero-result query reformulation** (v9.0+, Code Mode) — When `env.opengrok.search()` returns 0 results, sampling auto-injects `_suggestions` into the result object. Sandbox JS can also call `env.opengrok.sample(prompt)` explicitly for any AI-generated text.

Supported clients:
- **VS Code Copilot** ✓
- **Claude Code** — support pending (tracked in [anthropics/claude-code#1785](https://github.com/anthropics/claude-code/issues/1785))

The server degrades gracefully when sampling is unavailable — `sample()` returns `null`, `_suggestions` is not injected.

---

## VS Code Integration

### Palette Commands

| Command Prompt | Action Performed |
| :------ | :---------- |
| `OpenGrok: Manage Configuration` | Launches the interactive settings GUI |
| `OpenGrok: Configure Credentials` | Fast CLI-style input for authentication |
| `OpenGrok: Test Connection` | Validates API access and token validity |
| `OpenGrok: Show Server Logs` | Exposes background process stdout/stderr |
| `OpenGrok: Check for Updates` | Polls GitHub for new releases |
| `OpenGrok: Status Menu` | Opens the context menu directly |

### Core Settings Profile

<details>
<summary>Expand for JSON Settings Reference</summary>

| Key | Format | Primary Usage |
| :--- | :--- | :---------- |
| `opengrok-mcp.baseUrl` | `string` | The URI of your OpenGrok deployment |
| `opengrok-mcp.username` | `string` | Authentication identity |
| `opengrok-mcp.verifySsl` | `boolean` | Disable when using corporate self-signed certs (default: false) |
| `opengrok-mcp.proxy` | `string` | Optional HTTP traffic router |

</details>

### Advanced Configuration (v7 — env vars)

For the standalone server (`npx @colin-cai0318/opengrok-mcp-server` or Claude Code), set these environment variables:

#### Core Settings

| Variable | Values | Description |
| :--- | :--- | :--- |
| `OPENGROK_BASE_URL` | URL | OpenGrok server base URL (required) |
| `OPENGROK_USERNAME` | string | Authentication username (optional — leave unset for anonymous access) |
| `OPENGROK_PASSWORD` | string | Authentication password (prefer OS keychain via `npx @colin-cai0318/opengrok-mcp-server setup`) |
| `OPENGROK_VERIFY_SSL` | `true` (default) / `false` | Disable TLS verification for self-signed certs |
| `OPENGROK_TIMEOUT` | integer (seconds, default: `30`) | HTTP request timeout |

#### Code Mode & Performance

| Variable | Values | Description |
| :--- | :--- | :--- |
| `OPENGROK_CODE_MODE` | `true` (default) / `false` | Switch to 5-tool Code Mode (opengrok_api + opengrok_execute + 3 memory tools) |
| `OPENGROK_CONTEXT_BUDGET` | `standard` (default) / `minimal` / `generous` | Response size tier: 8 KB / 4 KB / 16 KB |
| `OPENGROK_RESPONSE_FORMAT_OVERRIDE` | `tsv` / `toon` / `yaml` / `text` / `markdown` | Force a response format globally for all tools |
| `OPENGROK_DEFAULT_PROJECT` | string | Default project name to scope all searches |
| `OPENGROK_DEFAULT_MAX_RESULTS` | integer (default: `25`) | Default search result limit |
| `OPENGROK_LOCAL_COMPILE_DB_PATHS` | comma-separated paths | Paths to `compile_commands.json` for C/C++ compiler flag extraction |
| `OPENGROK_ENABLE_CACHE_HINTS` | `true` / `false` (default: `false`) | Enable `cache-control: immutable` hints for prompt caching infrastructure |

#### Memory Bank

| Variable | Values | Description |
| :--- | :--- | :--- |
| `OPENGROK_MEMORY_BANK_DIR` | path | Override directory for `active-task.md` + `investigation-log.md` files |
| `OPENGROK_ENABLE_OBSERVATION_MASKER` | `true` / `false` (default: `false`) | Prepend compact history summaries to `opengrok_execute` results after the full-text window fills. Only useful for clients that truncate context (not Claude Code or Cursor). |
| `OPENGROK_OBSERVATION_MASKER_TURNS` | integer (default: `10`) | Full-text window size: how many of the most-recent `opengrok_execute` results to keep in full before older ones are replaced with compact summaries. |

#### Rate Limiting

| Variable | Values | Description |
| :--- | :--- | :--- |
| `OPENGROK_RATELIMIT_ENABLED` | `true` (default) / `false` | Enable token-bucket rate limiting |
| `OPENGROK_RATELIMIT_RPM` | integer (default: `60`) | Global requests-per-minute limit |
| `OPENGROK_PER_TOOL_RATELIMIT` | `tool:rpm,tool:rpm` | Per-tool RPM overrides (e.g., `opengrok_execute:10,opengrok_batch_search:20`) |

#### Response Cache

| Variable | Values | Description |
| :--- | :--- | :--- |
| `OPENGROK_CACHE_ENABLED` | `true` (default) / `false` | Enable TTL response cache |
| `OPENGROK_CACHE_MAX_SIZE` | integer (default: `500`) | Max cache entries |
| `OPENGROK_CACHE_SEARCH_TTL` | seconds (default: `300`) | Search result cache TTL |
| `OPENGROK_CACHE_FILE_TTL` | seconds (default: `600`) | File content cache TTL |
| `OPENGROK_CACHE_PROJECTS_TTL` | seconds (default: `3600`) | Project list cache TTL |

#### Security & Audit

| Variable | Values | Description |
| :--- | :--- | :--- |
| `OPENGROK_AUDIT_LOG_FILE` | path | File path for structured audit log (CSV or JSON) |

#### MCP Protocol Features

| Variable | Values | Description |
| :--- | :--- | :--- |
| `OPENGROK_ENABLE_ELICITATION` | `true` / `false` (default: `false`) | Enable the on-demand project picker in `opengrok_api` (Code Mode) and `env.opengrok.elicit()` in sandbox. Requires a supporting MCP client. |
| `OPENGROK_ENABLE_FILES_API` | `true` / `false` (default: `false`) | Enable FileReferenceCache for `investigation-log.md` (SHA-256 content-addressed) |
| `OPENGROK_SAMPLING_MODEL` | string | Model preference for MCP Sampling (error explanation, graph summarization) |
| `OPENGROK_SAMPLING_MAX_TOKENS` | integer (default: `256`, max: `4096`) | Token budget for MCP Sampling responses |

#### HTTP Transport (v7.0+)

| Variable | Values | Description |
| :--- | :--- | :--- |
| `OPENGROK_HTTP_PORT` | integer | Expose Streamable HTTP transport on this port (in addition to stdio) |
| `OPENGROK_HTTP_MAX_SESSIONS` | integer (default: `100`) | Max concurrent HTTP sessions before new connections are rejected |
| `OPENGROK_HTTP_AUTH_TOKEN` | string | Static Bearer token for HTTP endpoint authentication |
| `OPENGROK_JWKS_URI` | URL | JWKS endpoint for JWT validation (OAuth 2.1 resource server mode) |
| `OPENGROK_RESOURCE_URI` | URL | This server's resource URI, advertised in RFC 9728 metadata |
| `OPENGROK_AUTH_SERVERS` | comma-separated URLs | Trusted authorization server URIs |
| `OPENGROK_SCOPE_MAP` | `scope:role,...` | Map JWT scopes to RBAC roles (e.g., `read:readonly,admin:admin`) |
| `OPENGROK_STRICT_OAUTH` | `true` / `false` | Reject requests without a valid JWT when `OPENGROK_JWKS_URI` is set |
| `OPENGROK_ALLOWED_ORIGINS` | comma-separated origins | CORS allowlist (replaces wildcard CORS) |
| `OPENGROK_RBAC_TOKENS` | `tok1:role,tok2:role` | Role-based access tokens: `admin` / `developer` / `readonly` |

#### Logging

| Variable | Values | Description |
| :--- | :--- | :--- |
| `OPENGROK_LOG_LEVEL` | `debug` / `info` (default) | Verbose structured logging to stderr |

VS Code users can set `opengrok-mcp.codeMode`, `opengrok-mcp.contextBudget`, `opengrok-mcp.memoryBankDir`, `opengrok-mcp.defaultProject`, `opengrok-mcp.responseFormatOverride`, `opengrok-mcp.compileDbPaths`, `opengrok-mcp.enableObservationMasker`, and `opengrok-mcp.observationMaskerTurns` in VS Code settings instead.

> **MCP SDK Note:** This version uses `@modelcontextprotocol/sdk` v1.29.0.
> MCP SDK v2 is in pre-alpha; we will migrate when stable (expected Q3-Q4 2026).
> v2 will enable enhanced completions for tool parameters and resource templates.

---

## HTTP Transport (v7.0+)

By default the server communicates over **stdio** (standard MCP). For team deployments, you can also expose a **Streamable HTTP endpoint**:

```bash
OPENGROK_HTTP_PORT=3666 npm run serve
# or add to your MCP client config:
# "OPENGROK_HTTP_PORT": "3666"
```

### Session Management

- Each HTTP client receives an isolated `McpServer` instance (per-session factory pattern)
- Sessions expire after 30 minutes of inactivity; `OPENGROK_HTTP_MAX_SESSIONS` caps concurrent sessions (default: 100)
- `GET /mcp/sessions` returns JSON with active session count and oldest session age

### Authentication

Configure one of the following:

| Method | Config |
| ------ | ------ |
| **Static Bearer token** | `OPENGROK_HTTP_AUTH_TOKEN=mysecret` |
| **OAuth 2.1 resource server** | `OPENGROK_JWKS_URI=https://idp.example.com/.well-known/jwks.json` + `OPENGROK_RESOURCE_URI=https://opengrok-mcp.example.com` |
| **RBAC with named roles** | `OPENGROK_RBAC_TOKENS='alice-token:admin,bot-token:readonly'` |

In resource server mode, this server validates JWTs issued by your own IdP — there is no built-in `/token` endpoint. RFC 9728 protected resource metadata is served at `/.well-known/oauth-protected-resource`.

### RBAC Roles

| Role | Permissions |
| ---- | ----------- |
| `admin` | Full access to all tools and configuration |
| `developer` | All search, read, memory, and code tools |
| `readonly` | Search and read tools only; no memory writes, no code execution |

> **Fail-safe**: unknown or missing tokens default to `readonly`, not `admin`.

---

## Security (v7.0+)

v7.0 includes a comprehensive security audit with the following hardening:

| Area | Protection |
| ---- | ---------- |
| **SSRF** | DNS rebinding detection + IPv6-mapped address blocking in `buildSafeUrl` |
| **Path traversal** | NFC normalization + bidirectional Unicode character blocking |
| **HTML injection** | `he.decode` on all parser text nodes before display |
| **Prompt injection** | `escapeMarkdownField` in all formatters |
| **Token comparison** | `crypto.timingSafeEqual` for all Bearer token comparisons |
| **CORS** | Allowlist via `OPENGROK_ALLOWED_ORIGINS` (no wildcard in production) |
| **Security headers** | `X-Content-Type-Options`, `X-Frame-Options`, CSP on HTTP responses |
| **Credential encryption** | AES-256-GCM (migrated from CBC; auto-upgrades existing files) |
| **Rate limiting** | Integer-based token bucket (eliminates float drift) |
| **ReDoS** | `minimatch` for glob patterns |
| **Audit logs** | Injection-escaped structured audit entries |

> **⚠️ v7.0.0 Breaking Changes**
> - `OPENGROK_HTTP_CLIENT_ID` and `OPENGROK_HTTP_CLIENT_SECRET` removed. Migrate to `OPENGROK_JWKS_URI` + `OPENGROK_RESOURCE_URI` for OAuth 2.1 (resource server model — bring your own IdP).
> - Memory bank `migrate()` removed — the legacy 6-file layout is no longer supported. The 2-file layout (`active-task.md` + `investigation-log.md`) has been the default since v5.4.
> - CORS is now allowlist-only when `OPENGROK_ALLOWED_ORIGINS` is set; unauthenticated wildcard CORS is disabled.

---

## System Architecture

<details>
<summary>Show topological diagram</summary>

```text
 [ AI Client ]                       [ Integration Layer ]                    [ Data Source ]
                              │                                 │
 +---------------+            │       +-------------------+     │      +----------------------+
 │ GitHub        │<──(stdio)──┼──────>│ OpenGrok MCP      │<────┼─────>│ OpenGrok REST API &  │
 │ Copilot Chat  │            │       │ Server (Node.js)  │HTTP │      │ Web Interface        │
 +---------------+            │       +-------------------+     │      +----------------------+
      │    ▲                           │          │
      │    │ (Configures & Hosts)      │    (Context Optimization)
      ▼    │                           │          │
 +---------------+                     │   o Context Fetch      │      +----------------------+
 │ VS Code       │                     │   o Multi-Search       │      │ Local File System    │
 │ Extension     │                     │   o Auto-Truncate      │<─────┤ (compile_commands) │
 +---------------+                     │                        │      +----------------------+
```

The underlying code is completely packaged in the marketplace extension via `esbuild`. The server uses standard VS Code Node APIs without external VM requirements.

</details>

---

## Building & Testing

```bash
# Initializing
npm install

# Code Quality & Tests
npm run lint           # Strict TypeScript & ESLint validation
npm test               # Execute the Vitest test suite (1113 tests)
npm run test:sandbox   # Sandbox integration tests (requires compile first)
npm run test:coverage  # Coverage report (≥89% threshold)

# Packaging
npm run compile   # Generate the esbuild artifact (includes sandbox-worker.js)
npm run vsix      # Create the downloadable extension file
```

We leverage GitHub Actions for automated CD. Tagging a commit (e.g., `v1.2.3`) automatically triggers the build matrix and attaches artifacts to a new [GitHub Release](https://github.com/IcyHot09/opengrok-mcp-server/releases).

For deep-dives into the architecture or PR guidelines, please read [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Troubleshooting & Support

**The MCP tools are missing in Copilot Chat**
* Click the paperclip (`🔧`) icon to "Update Tools"
* Run `Developer: Reload Window`

**"Connection failed" errors**
* Double-check your `OPENGROK_BASE_URL`
* Make sure you aren't blocked by corporate VPNs/proxies

**401 Unauthorized / Authentication failing**
* Run the `OpenGrok: Configure Credentials` command to save your username/password again

**Self-Signed SSL Certificates**
* Turn off strict validation by setting `opengrok-mcp.verifySsl` to `false`

**Slow queries or timeouts**
* Limit the scope using the `file_type` argument or targeting a specific project
* OpenGrok might be indexing; run `opengrok_index_health`

**Need verbose logs?**
* Set the environment variable `OPENGROK_LOG_LEVEL=debug` to get extensive stdout trace data

### OpenGrok Version Compatibility

| OpenGrok Engine | Status | known limitations |
| ---------------- | ------------- | ----- |
| **v1.13.x and above** | Native Support | None (Full REST API functionality) |
| **v1.7.0 — v1.12.x** | Legacy Mode | Uses HTML scraping for symbol lookups and blame |
| **Below v1.7.0** | Unsupported | Unpredictable behaviour |

---

## License Information

This system is distributed under the [PolyForm Noncommercial License 1.0.0](LICENSE).

* ✅ **Permitted:** Personal use, hobby projects, academic research, education
* ❌ **Prohibited:** Any commercial, business, enterprise, or paid utilization

**Commercial Licensing:**
To use this extension in an enterprise context (internal tooling, CI pipelines, business infrastructure), a commercial license is strictly required. 
Reach out to [rudroy09@gmail.com](mailto:rudroy09@gmail.com) for enterprise tier pricing.

Read [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md) for full terms.
