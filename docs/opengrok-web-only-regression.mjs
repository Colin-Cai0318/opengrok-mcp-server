#!/usr/bin/env node

/**
 * End-to-end stdio regression for the internal Web-only OpenGrok MCP build.
 *
 * It starts the built server twice and invokes every exposed MCP tool:
 *   - standard mode: 12 Web/local tools
 *   - Code Mode: 5 MCP tools
 *
 * Authentication values are inherited from the environment and are never
 * printed or written to the JSON report.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const STANDARD_TOOLS = [
  "opengrok_search_code",
  "opengrok_find_file",
  "opengrok_get_file_content",
  "opengrok_browse_directory",
  "opengrok_list_projects",
  "opengrok_batch_search",
  "opengrok_search_and_read",
  "opengrok_get_symbol_context",
  "opengrok_index_health",
  "opengrok_get_compile_info",
  "opengrok_get_file_symbols",
  "opengrok_dependency_map",
].sort();

const CODE_MODE_TOOLS = [
  "opengrok_api",
  "opengrok_execute",
  "opengrok_memory_status",
  "opengrok_read_memory",
  "opengrok_update_memory",
].sort();

function usage() {
  console.log(`Usage:
  node docs/opengrok-web-only-regression.mjs --base-url URL --projects P1[,P2] [options]

Required:
  --base-url URL          OpenGrok context root, e.g. https://host/opengrok/
  --projects P1,P2        Exact indexed project names

Search fixtures:
  --query TEXT            Full-text query (default: main)
  --symbol NAME           Definition/reference symbol (default: main)
  --known-project NAME    Project containing --known-file (defaults to first project)
  --known-file PATH       Known indexed source file; otherwise derived from search
  --known-directory PATH  Directory to browse; otherwise derived from the file
  --compile-info-path P   Local path for compile-info (defaults to known file)
  --max-results N         Search limit, 1..25 (default: 5)

Runtime/report:
  --repo PATH             Repository root (default: parent of this script)
  --report PATH           JSON report path (default: timestamped file in cwd)
  -h, --help              Show help

Authentication environment (values are never logged):
  OPENGROK_COOKIE, or OPENGROK_USERNAME + OPENGROK_PASSWORD

Other inherited environment:
  OPENGROK_VERIFY_SSL, OPENGROK_TIMEOUT, HTTPS_PROXY, HTTP_PROXY

Prerequisite:
  npm ci && npm run compile
`);
}

function parseArgs(argv) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const cfg = {
    repo: path.resolve(scriptDir, ".."),
    baseUrl: process.env.OPENGROK_BASE_URL || "",
    projects: (process.env.OPENGROK_PROJECTS || "").split(",").map((v) => v.trim()).filter(Boolean),
    query: "main",
    symbol: "main",
    knownProject: "",
    knownFile: "",
    knownDirectory: "",
    compileInfoPath: "",
    maxResults: 5,
    report: "",
  };
  const value = (flag, index) => {
    if (index + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
    return argv[index + 1];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--repo") cfg.repo = path.resolve(value(arg, i++));
    else if (arg === "--base-url") cfg.baseUrl = value(arg, i++);
    else if (arg === "--projects") cfg.projects = value(arg, i++).split(",").map((v) => v.trim()).filter(Boolean);
    else if (arg === "--query") cfg.query = value(arg, i++);
    else if (arg === "--symbol") cfg.symbol = value(arg, i++);
    else if (arg === "--known-project") cfg.knownProject = value(arg, i++);
    else if (arg === "--known-file") cfg.knownFile = value(arg, i++).replace(/^[/\\]+/, "");
    else if (arg === "--known-directory") cfg.knownDirectory = value(arg, i++).replace(/^[/\\]+/, "");
    else if (arg === "--compile-info-path") cfg.compileInfoPath = value(arg, i++);
    else if (arg === "--max-results") cfg.maxResults = Number(value(arg, i++));
    else if (arg === "--report") cfg.report = path.resolve(value(arg, i++));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!cfg.baseUrl) throw new Error("--base-url or OPENGROK_BASE_URL is required");
  if (!cfg.projects.length) throw new Error("--projects or OPENGROK_PROJECTS is required");
  if (!Number.isInteger(cfg.maxResults) || cfg.maxResults < 1 || cfg.maxResults > 25) {
    throw new Error("--max-results must be an integer in 1..25");
  }
  cfg.baseUrl = cfg.baseUrl.replace(/\/+$/, "") + "/";
  cfg.knownProject ||= cfg.projects[0];
  cfg.report ||= path.resolve(`opengrok-web-only-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  return cfg;
}

function cleanEnv(extra) {
  const env = {};
  for (const [key, value] of Object.entries({ ...process.env, ...extra })) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function resultText(result) {
  return (result?.content || [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function payload(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = resultText(result).trim();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

function firstHit(result) {
  const data = payload(result);
  for (const hit of data?.results || []) {
    const file = hit?.path || hit?.file;
    if (hit?.project && file) {
      return { project: hit.project, path: String(file).replace(/^[/\\]+/, "") };
    }
  }
  return null;
}

function safeDetail(value, limit = 240) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, limit);
}

const cfg = parseArgs(process.argv.slice(2));
if (cfg.help) {
  usage();
  process.exit(0);
}

const serverEntry = path.join(cfg.repo, "out", "server", "main.js");
const sdkRoot = path.join(cfg.repo, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
const sdkClientEntry = path.join(sdkRoot, "client", "index.js");
const sdkStdioEntry = path.join(sdkRoot, "client", "stdio.js");
for (const required of [serverEntry, sdkClientEntry, sdkStdioEntry]) {
  if (!fs.existsSync(required)) throw new Error(`Required file missing: ${required}. Run npm ci && npm run compile first.`);
}

const [{ Client }, { StdioClientTransport }] = await Promise.all([
  import(pathToFileURL(sdkClientEntry).href),
  import(pathToFileURL(sdkStdioEntry).href),
]);

const report = {
  startedAt: new Date().toISOString(),
  config: {
    repo: cfg.repo,
    baseUrl: cfg.baseUrl,
    projects: cfg.projects,
    query: cfg.query,
    symbol: cfg.symbol,
    knownProject: cfg.knownProject,
    knownFile: cfg.knownFile || null,
    auth: process.env.OPENGROK_COOKIE ? "cookie" : process.env.OPENGROK_USERNAME ? "basic" : "none",
  },
  tests: [],
  summary: {},
};

function record(name, status, detail = "") {
  report.tests.push({ name, status, detail: safeDetail(detail) });
  const icon = status === "PASS" ? "PASS" : status === "WARN" ? "WARN" : "FAIL";
  console.log(`[${icon}] ${name}${detail ? `: ${safeDetail(detail)}` : ""}`);
}

async function checkedCall(client, name, args = {}, options = {}) {
  try {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(resultText(result) || "MCP tool returned isError=true");
    const body = payload(result);
    if (options.requireJson && !body) throw new Error("response is not parseable JSON/structured content");
    if (options.contract && !options.contract(body)) throw new Error("response JSON does not satisfy the expected contract");
    record(name, "PASS", options.detail?.(result) || "invoked successfully");
    return result;
  } catch (error) {
    record(name, "FAIL", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function startClient(codeMode, memoryDir) {
  const client = new Client({ name: "opengrok-web-only-regression", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: cfg.repo,
    env: cleanEnv({
      OPENGROK_BASE_URL: cfg.baseUrl,
      OPENGROK_DEFAULT_PROJECT: cfg.projects[0],
      OPENGROK_CODE_MODE: codeMode ? "true" : "false",
      OPENGROK_MEMORY_BANK_DIR: memoryDir,
      OPENGROK_ENABLE_SAMPLING: "false",
      OPENGROK_ENABLE_ELICITATION: "false",
      OPENGROK_RESPONSE_FORMAT_OVERRIDE: "",
    }),
    stderr: "inherit",
    maxBufferSize: 32 * 1024 * 1024,
  });
  await client.connect(transport);
  return client;
}

function assertExactSurface(actual, expected, label) {
  const names = actual.map((tool) => tool.name).sort();
  const missing = expected.filter((name) => !names.includes(name));
  const extra = names.filter((name) => !expected.includes(name));
  if (missing.length || extra.length) {
    record(`${label} tools/list`, "FAIL", `missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`);
  } else {
    record(`${label} tools/list`, "PASS", `${names.length} tools: ${names.join(", ")}`);
  }
}

const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "opengrok-mcp-regression-"));
let standardClient;
let codeClient;
try {
  console.log("\n=== Standard mode: 12 Web/local tools ===");
  standardClient = await startClient(false, memoryDir);
  assertExactSurface((await standardClient.listTools()).tools, STANDARD_TOOLS, "standard");

  await checkedCall(standardClient, "opengrok_index_health", { response_format: "json" }, { requireJson: true });
  await checkedCall(standardClient, "opengrok_list_projects", { response_format: "json" }, { requireJson: true });

  const defs = await checkedCall(standardClient, "opengrok_search_code", {
    query: cfg.symbol,
    search_type: "defs",
    projects: cfg.projects,
    max_results: cfg.maxResults,
    response_format: "json",
  }, { requireJson: true, contract: (body) => typeof body?.query === "string" && body.searchType === "defs" && Number.isInteger(body.totalCount) && Array.isArray(body.results) && Number.isInteger(body.startIndex) && Number.isInteger(body.endIndex) && typeof body.hasMore === "boolean", detail: (result) => `defs total=${payload(result)?.totalCount ?? "unknown"}` });

  const full = await checkedCall(standardClient, "opengrok_search_code", {
    query: cfg.query,
    search_type: "full",
    projects: cfg.projects,
    max_results: cfg.maxResults,
    response_format: "json",
  }, { requireJson: true, detail: (result) => `full total=${payload(result)?.totalCount ?? "unknown"}` });

  await checkedCall(standardClient, "opengrok_search_code", {
    query: cfg.symbol,
    search_type: "refs",
    projects: cfg.projects,
    max_results: cfg.maxResults,
    response_format: "json",
  }, { requireJson: true, detail: () => "refs variant" });

  let fixture = cfg.knownFile ? { project: cfg.knownProject, path: cfg.knownFile } : firstHit(defs) || firstHit(full);
  if (!fixture) {
    record("derive indexed file fixture", "FAIL", "No search hit. Supply --known-project and --known-file.");
    fixture = { project: cfg.knownProject, path: cfg.knownFile || "__missing_fixture__" };
  } else {
    record("derive indexed file fixture", "PASS", `${fixture.project}:${fixture.path}`);
  }
  const basename = path.posix.basename(fixture.path.replace(/\\/g, "/"));
  const directory = cfg.knownDirectory || path.posix.dirname(fixture.path.replace(/\\/g, "/")).replace(/^\.$/, "");

  await checkedCall(standardClient, "opengrok_find_file", {
    path_pattern: basename,
    projects: cfg.projects,
    max_results: cfg.maxResults,
    response_format: "json",
  }, { requireJson: true });
  await checkedCall(standardClient, "opengrok_get_file_content", {
    project: fixture.project,
    path: fixture.path,
    start_line: 1,
    end_line: 20,
    response_format: "json",
  }, { requireJson: true });
  await checkedCall(standardClient, "opengrok_browse_directory", {
    project: fixture.project,
    path: directory,
    response_format: "json",
  }, { requireJson: true });
  await checkedCall(standardClient, "opengrok_get_file_symbols", {
    project: fixture.project,
    path: fixture.path,
    response_format: "json",
  }, { requireJson: true });
  await checkedCall(standardClient, "opengrok_batch_search", {
    queries: [
      { query: cfg.query, search_type: "full", max_results: 2 },
      { query: cfg.symbol, search_type: "defs", max_results: 2 },
      { query: cfg.symbol, search_type: "refs", max_results: 2 },
    ],
    projects: cfg.projects,
    response_format: "json",
  }, { requireJson: true });
  await checkedCall(standardClient, "opengrok_search_and_read", {
    query: cfg.symbol,
    search_type: "defs",
    projects: cfg.projects,
    context_lines: 5,
    max_results: 2,
    response_format: "json",
  }, { requireJson: true });
  await checkedCall(standardClient, "opengrok_get_symbol_context", {
    symbol: cfg.symbol,
    projects: cfg.projects,
    context_lines: 10,
    max_refs: 3,
    include_header: true,
    response_format: "json",
  }, { requireJson: true });
  await checkedCall(standardClient, "opengrok_dependency_map", {
    project: fixture.project,
    path: fixture.path,
    depth: 1,
    direction: "both",
    response_format: "json",
  }, { requireJson: true });
  await checkedCall(standardClient, "opengrok_get_compile_info", {
    path: cfg.compileInfoPath || fixture.path,
    response_format: "json",
  }, { detail: () => "invoked (local compile DB is optional)" });

  console.log("\n=== Code Mode: 5 MCP tools ===");
  codeClient = await startClient(true, memoryDir);
  assertExactSurface((await codeClient.listTools()).tools, CODE_MODE_TOOLS, "code mode");
  const apiResult = await checkedCall(codeClient, "opengrok_api");
  if (apiResult) {
    const apiText = resultText(apiResult);
    const forbidden = ["getFileHistory", "getFileAnnotate", "getFileDiff", "searchSuggest", "traceCallChain", "getFileOverview"]
      .filter((method) => apiText.includes(method));
    record("Code Mode API allowlist", forbidden.length ? "FAIL" : "PASS", forbidden.length ? `forbidden methods: ${forbidden.join(", ")}` : "unsupported methods absent");
  }
  await checkedCall(codeClient, "opengrok_memory_status");
  await checkedCall(codeClient, "opengrok_update_memory", {
    filename: "active-task.md",
    content: "web-only regression marker",
    mode: "overwrite",
  });
  await checkedCall(codeClient, "opengrok_read_memory", { filename: "active-task.md" });
  await checkedCall(codeClient, "opengrok_execute", {
    code: `const health = await env.opengrok.indexHealth(); const search = await env.opengrok.search(${JSON.stringify(cfg.query)}, { projects: ${JSON.stringify(cfg.projects)}, maxResults: 1 }); return { connected: health.connected, totalCount: search.totalCount };`,
  }, { detail: () => "sandbox called indexHealth() and search()" });
} finally {
  await Promise.allSettled([standardClient?.close(), codeClient?.close()].filter(Boolean));
  fs.rmSync(memoryDir, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  report.summary = {
    pass: report.tests.filter((test) => test.status === "PASS").length,
    warn: report.tests.filter((test) => test.status === "WARN").length,
    fail: report.tests.filter((test) => test.status === "FAIL").length,
  };
  fs.writeFileSync(cfg.report, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`\nReport: ${cfg.report}`);
  console.log(`Summary: ${report.summary.pass} PASS, ${report.summary.warn} WARN, ${report.summary.fail} FAIL`);
}

process.exitCode = report.summary.fail ? 1 : 0;
