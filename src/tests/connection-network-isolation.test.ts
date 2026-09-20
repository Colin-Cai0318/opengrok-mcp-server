import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Agent, ProxyAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseServerArguments } from "../server/cli/connection.js";
import { OpenGrokClient } from "../server/client.js";
import { loadConfig } from "../server/config.js";

const BAD_PROXY = "http://127.0.0.1:9";
const GOOD_PROXY = "http://10.108.157.36:80";

function writeConnections(connections: Record<string, Record<string, unknown>>): {
  directory: string;
  file: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "opengrok-network-routes-"));
  const file = join(directory, "connections.json");
  writeFileSync(file, JSON.stringify({ connections }));
  return { directory, file };
}

function dispatcherOf(client: OpenGrokClient): unknown {
  return (client as unknown as { agent?: unknown }).agent;
}

describe("multi-connection network isolation", () => {
  const originalHttpProxy = process.env.HTTP_PROXY;
  const originalHttpsProxy = process.env.HTTPS_PROXY;

  beforeEach(() => {
    process.env.HTTP_PROXY = BAD_PROXY;
    process.env.HTTPS_PROXY = BAD_PROXY;
  });

  afterEach(() => {
    if (originalHttpProxy === undefined) delete process.env.HTTP_PROXY;
    else process.env.HTTP_PROXY = originalHttpProxy;
    if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = originalHttpsProxy;
  });

  it("overrides a bad global proxy per connection and forces direct routes to stay direct", () => {
    const { directory, file } = writeConnections({
      v: { url: "https://v.example.com/", proxyEnv: "PROXY_VW" },
      w: { url: "https://w.example.com/", proxyEnv: "PROXY_VW" },
      x: { url: "https://x.example.com/", direct: true },
    });
    try {
      const parsed = parseServerArguments(["--connections-file", file], { PROXY_VW: GOOD_PROXY });
      const configs = Object.fromEntries(
        (parsed.connections ?? []).map((connection) => [connection.name, loadConfig(connection.overrides)])
      );

      expect(configs.v.HTTP_PROXY).toBe(GOOD_PROXY);
      expect(configs.v.HTTPS_PROXY).toBe(GOOD_PROXY);
      expect(configs.w.HTTP_PROXY).toBe(GOOD_PROXY);
      expect(configs.w.HTTPS_PROXY).toBe(GOOD_PROXY);
      expect(configs.x.HTTP_PROXY).toBe("");
      expect(configs.x.HTTPS_PROXY).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("constructs ProxyAgent only for proxy routes and Agent for direct routes", async () => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    const { directory, file } = writeConnections({
      v: { url: "https://v.example.com/", proxyEnv: "PROXY_VW" },
      x: { url: "https://x.example.com/", direct: true },
    });
    const clients: OpenGrokClient[] = [];
    try {
      const parsed = parseServerArguments(["--connections-file", file], { PROXY_VW: GOOD_PROXY });
      const byName = Object.fromEntries((parsed.connections ?? []).map((connection) => {
        const client = new OpenGrokClient(loadConfig(connection.overrides));
        clients.push(client);
        return [connection.name, client];
      }));

      expect(dispatcherOf(byName.v)).toBeInstanceOf(ProxyAgent);
      expect(dispatcherOf(byName.x)).toBeInstanceOf(Agent);
      expect(dispatcherOf(byName.x)).not.toBeInstanceOf(ProxyAgent);
    } finally {
      await Promise.allSettled(clients.map((client) => client.close()));
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails fast when proxyEnv is missing", () => {
    const { directory, file } = writeConnections({
      v: { url: "https://v.example.com/", proxyEnv: "NOT_EXIST" },
      x: { url: "https://x.example.com/", direct: true },
    });
    try {
      expect(() => parseServerArguments(["--connections-file", file], {}))
        .toThrow('Connection "v" requires environment variable "NOT_EXIST"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects proxyEnv together with direct", () => {
    const { directory, file } = writeConnections({
      v: { url: "https://v.example.com/", proxyEnv: "PROXY_VW", direct: true },
      x: { url: "https://x.example.com/", direct: true },
    });
    try {
      expect(() => parseServerArguments(["--connections-file", file], { PROXY_VW: GOOD_PROXY }))
        .toThrow('Connection "v" cannot configure both proxyEnv and direct');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves connection-level network policy in legacy single-connection mode", () => {
    const { directory, file } = writeConnections({
      v: { url: "https://v.example.com/", proxyEnv: "PROXY_VW" },
      x: { url: "https://x.example.com/", direct: true },
    });
    try {
      const environment = { PROXY_VW: GOOD_PROXY };
      const proxied = loadConfig(
        parseServerArguments(["--connections-file", file, "--connection", "v"], environment).overrides
      );
      const direct = loadConfig(
        parseServerArguments(["--connections-file", file, "--connection", "x"], environment).overrides
      );

      expect(proxied.HTTP_PROXY).toBe(GOOD_PROXY);
      expect(proxied.HTTPS_PROXY).toBe(GOOD_PROXY);
      expect(direct.HTTP_PROXY).toBe("");
      expect(direct.HTTPS_PROXY).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
