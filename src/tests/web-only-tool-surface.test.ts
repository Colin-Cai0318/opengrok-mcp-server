import { afterEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Config } from "../server/config.js";
import {
  createServer,
  WEB_ONLY_STANDARD_TOOL_NAMES,
} from "../server/server.js";
import { MemoryBank } from "../server/memory-bank.js";

const CODE_MODE_TOOLS = [
  "opengrok_api",
  "opengrok_execute",
  "opengrok_memory_status",
  "opengrok_read_memory",
  "opengrok_update_memory",
] as const;

function makeConfig(codeMode: boolean): Config {
  return {
    OPENGROK_BASE_URL: "https://example.invalid/source/",
    OPENGROK_USERNAME: "",
    OPENGROK_PASSWORD: "",
    OPENGROK_PASSWORD_FILE: "",
    OPENGROK_PASSWORD_KEY: "",
    OPENGROK_VERIFY_SSL: true,
    OPENGROK_TIMEOUT: 30,
    OPENGROK_DEFAULT_MAX_RESULTS: 25,
    OPENGROK_CACHE_ENABLED: false,
    OPENGROK_CACHE_SEARCH_TTL: 300,
    OPENGROK_CACHE_FILE_TTL: 600,
    OPENGROK_CACHE_PROJECTS_TTL: 3600,
    OPENGROK_CACHE_MAX_SIZE: 500,
    OPENGROK_CACHE_MAX_BYTES: 52_428_800,
    OPENGROK_RATELIMIT_ENABLED: false,
    OPENGROK_RATELIMIT_RPM: 60,
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    OPENGROK_LOCAL_COMPILE_DB_PATHS: "",
    OPENGROK_DEFAULT_PROJECT: "demo",
    OPENGROK_CONTEXT_BUDGET: "minimal",
    OPENGROK_CODE_MODE: codeMode,
    OPENGROK_MEMORY_BANK_DIR: "",
    OPENGROK_RESPONSE_FORMAT_OVERRIDE: "",
    OPENGROK_ENABLE_SAMPLING: false,
    OPENGROK_ENABLE_ELICITATION: false,
  } as Config;
}

function makeClient() {
  return {
    search: vi.fn(),
    getFileContent: vi.fn(),
    browseDirectory: vi.fn(),
    listProjects: vi.fn().mockResolvedValue([]),
    getFileSymbols: vi.fn(),
    testConnection: vi.fn(),
    warmCache: vi.fn(),
    close: vi.fn(),
  };
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.allSettled(closers.splice(0).map((close) => close()));
});

async function listToolNames(codeMode: boolean): Promise<string[]> {
  const server = createServer(
    makeClient() as never,
    makeConfig(codeMode),
    codeMode ? new MemoryBank(path.join(os.tmpdir(), "opengrok-web-only-surface-test")) : undefined,
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "web-only-surface-test", version: "1.0.0" });
  await client.connect(clientTransport);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return (await client.listTools()).tools.map((tool) => tool.name).sort();
}

describe("web-only MCP tool surface", () => {
  it("exposes exactly the 12 supported standard-mode tools", async () => {
    expect(await listToolNames(false)).toEqual([...WEB_ONLY_STANDARD_TOOL_NAMES].sort());
  });

  it("exposes exactly the five Code Mode MCP tools", async () => {
    expect(await listToolNames(true)).toEqual([...CODE_MODE_TOOLS].sort());
  });
});
