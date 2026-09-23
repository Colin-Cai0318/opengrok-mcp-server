import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const manager = join(root, "deploy/team/template/bin/manage-opengrok-connections.py");
const helper = join(root, "deploy/team/template/bin/opengrok_cookie_helper.py");
const background = join(root, "deploy/team/template/chrome-extension/background.js");
const tempDirs: string[] = [];

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "opengrok-team-runtime-"));
  tempDirs.push(dir);
  const catalog = {
    connections: {
      "lx-one": { url: "https://lx-one.example/source/", cookieEnv: "LX_COOKIE_ONE", direct: true },
      "lx-two": { url: "https://lx-two.example/source/", cookieEnv: "LX_COOKIE_TWO", direct: true },
      "hq-one": { url: "https://hq-one.example/source/", cookieEnv: "HQ_COOKIE_ONE", direct: true },
      "lq-w": { url: "https://lq-w.example/source/", cookieEnv: "LQ_COOKIE_W", proxyEnv: "TEST_PROXY" },
      "lq-x": { url: "https://lq-x.example/source/", cookieEnv: "LQ_COOKIE_X", direct: true, verifySsl: true },
    },
  };
  writeFileSync(join(dir, "connections.catalog.json"), JSON.stringify(catalog));
  writeFileSync(join(dir, "connections.json"), JSON.stringify({ connections: {
    "lx-one": catalog.connections["lx-one"],
    "lx-two": catalog.connections["lx-two"],
  } }));
  return dir;
}

function python(args: string[], dir: string) {
  const result = spawnSync("python3", args, {
    encoding: "utf8",
    env: { ...process.env, OPENGROK_MCP_CONFIG_DIR: dir, PYTHONDONTWRITEBYTECODE: "1" },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("team deployment connection management", () => {
  it("adds optional sites, keeps LX first, and removes optional sites", () => {
    const dir = fixture();
    expect(python([manager, "list"], dir).stdout).toContain("available  hq-one");
    expect(python([manager, "add", "hq"], dir).status).toBe(0);
    const added = JSON.parse(readFileSync(join(dir, "connections.json"), "utf8"));
    expect(Object.keys(added.connections)).toEqual(["lx-one", "lx-two", "hq-one"]);
    expect(python([manager, "remove", "lx-one"], dir).status).toBe(1);
    expect(python([manager, "remove", "hq"], dir).status).toBe(0);
    const removed = JSON.parse(readFileSync(join(dir, "connections.json"), "utf8"));
    expect(Object.keys(removed.connections)).toEqual(["lx-one", "lx-two"]);
  });

  it("does not change active connections when Cookie state is invalid", () => {
    const dir = fixture();
    expect(python([manager, "add", "hq"], dir).status).toBe(0);
    const before = readFileSync(join(dir, "connections.json"), "utf8");
    writeFileSync(join(dir, "cookies.json"), "[]");
    const result = python([manager, "remove", "hq"], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cookies.json must contain an object");
    expect(readFileSync(join(dir, "connections.json"), "utf8")).toBe(before);
  });

  it("adds both LC variants together under the existing lq prefix", () => {
    const dir = fixture();
    expect(python([manager, "add", "lq"], dir).status).toBe(0);
    const active = JSON.parse(readFileSync(join(dir, "connections.json"), "utf8")).connections;
    expect(Object.keys(active)).toEqual(["lx-one", "lx-two", "lq-w", "lq-x"]);
    expect(active["lq-x"].direct).toBe(true);
    expect(active["lq-x"].verifySsl).toBe(true);
    expect(active["lq-x"].cookieEnv).not.toBe(active["lq-w"].cookieEnv);
  });

  it("reads active sites dynamically and rejects cookies for disabled sites", () => {
    const dir = fixture();
    const inspect = (code: string) => python(["-c", `import runpy,json; m=runpy.run_path(${JSON.stringify(helper)}); ${code}`], dir);
    const initial = inspect('print(json.dumps(m["_targets"]()))');
    expect(initial.status).toBe(0);
    expect(JSON.parse(initial.stdout)).toHaveLength(2);
    expect(python([manager, "add", "hq-one"], dir).status).toBe(0);
    expect(JSON.parse(inspect('print(json.dumps(m["_targets"]()))').stdout)).toHaveLength(3);
    expect(inspect('m["update_cookies"]({"HQ_COOKIE_ONE":"sid=one"});print("ok")').status).toBe(0);
    expect(python([manager, "remove", "hq-one"], dir).status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "cookies.json"), "utf8")).cookies).not.toHaveProperty("HQ_COOKIE_ONE");
    expect(JSON.parse(inspect('print(json.dumps(m["_targets"]()))').stdout)).toHaveLength(2);
    const rejected = inspect('m["update_cookies"]({"HQ_COOKIE_ONE":"sid=two"})');
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("unsupported cookie key");
  });
});

describe("Cookie Sync extension", () => {
  it("opens and syncs the current helper targets after connections change", async () => {
    let targets = [
      { name: "lx-one", url: "https://lx-one.example/source/", cookieEnv: "LX_COOKIE_ONE" },
      { name: "lx-two", url: "https://lx-two.example/source/", cookieEnv: "LX_COOKIE_TWO" },
    ];
    const opened: string[] = [];
    const updates: Array<Record<string, string>> = [];
    let onMessage: (message: { type: string }, sender: unknown, respond: (value: unknown) => void) => boolean = () => false;
    const context = {
      OPENGROK_SYNC_CONFIG: { helperUrl: "http://127.0.0.1:8765", helperToken: "test-token" },
      importScripts: () => undefined,
      URL,
      setTimeout,
      clearTimeout,
      fetch: async (url: string, init?: { body?: string }) => ({
        ok: true,
        status: 200,
        json: async () => {
          if (url.endsWith("/targets")) return { ok: true, targets };
          if (url.endsWith("/update")) {
            updates.push(JSON.parse(init?.body ?? "{}")?.cookies);
            return { ok: true, changed: true };
          }
          return { ok: true };
        },
      }),
      chrome: {
        alarms: { get: async () => ({ name: "opengrok-cookie-sync" }), create: () => undefined, onAlarm: { addListener: () => undefined } },
        cookies: {
          getAll: async ({ url }: { url: string }) => [{ name: "sid", value: new URL(url).hostname, path: "/" }],
          onChanged: { addListener: () => undefined },
        },
        runtime: {
          onInstalled: { addListener: () => undefined },
          onStartup: { addListener: () => undefined },
          onMessage: { addListener: (listener: typeof onMessage) => { onMessage = listener; } },
        },
        tabs: { create: async ({ url }: { url: string }) => { opened.push(url); } },
      },
    };
    runInNewContext(readFileSync(background, "utf8"), context);
    const send = (type: string) => new Promise<unknown>((resolveMessage) => {
      expect(onMessage({ type }, null, resolveMessage)).toBe(true);
    });
    expect(await send("openLogins")).toEqual({ ok: true, count: 2 });
    targets = [...targets, { name: "hq-one", url: "https://hq-one.example/source/", cookieEnv: "HQ_COOKIE_ONE" }];
    expect(await send("openLogins")).toEqual({ ok: true, count: 3 });
    expect(opened.at(-1)).toBe("https://hq-one.example/source/");
    const response = await send("syncNow") as { ok: boolean };
    expect(response.ok).toBe(true);
    expect(Object.keys(updates.at(-1) ?? {})).toEqual(["LX_COOKIE_ONE", "LX_COOKIE_TWO", "HQ_COOKIE_ONE"]);
  });
});
