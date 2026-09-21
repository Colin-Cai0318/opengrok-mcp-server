import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const template = join(root, "deploy", "team", "template");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

describe("team deployment template", () => {
  it("uses native per-connection proxy and direct policies", () => {
    const document = readJson(join(template, ".config", "opengrok-mcp", "connections.json"));
    const connections = document.connections as Record<string, Record<string, unknown>>;

    expect(connections["opengrok-android-v"].proxyEnv).toBe("OPENGROK_PROXY_VW");
    expect(connections["opengrok-android-w"].proxyEnv).toBe("OPENGROK_PROXY_VW");
    expect(connections["opengrok-android-x"].direct).toBe(true);
    expect(connections["opengrok-android-x"].proxyEnv).toBeUndefined();
    expect(existsSync(join(template, ".config", "opengrok-mcp", "routing.json"))).toBe(false);
  });

  it("registers one routed MCP instead of three legacy processes", () => {
    const document = readJson(join(template, "vscode", "mcp-servers.json"));
    const servers = document.servers as Record<string, { args: string[] }>;

    expect(Object.keys(servers)).toEqual(["opengrok-android-routing"]);
    expect(servers["opengrok-android-routing"].args).toEqual([]);

    const wrapper = readFileSync(join(template, "bin", "opengrok-mcp-wrapper.sh"), "utf8");
    expect(wrapper).toContain('exec "$MCP_BIN" --connections-file "$CONNECTIONS_FILE" "$@"');
    expect(wrapper).not.toContain('--connection "$connection"');
  });

  it("contains no generated runtime credentials", () => {
    const forbiddenNames = new Set(["helper.token", "cookies.json", "opengrok.env", "generated-config.js"]);
    const forbidden = filesUnder(template).filter((file) =>
      forbiddenNames.has(file.split("/").at(-1) ?? "") || file.endsWith(".cookie")
    );
    expect(forbidden).toEqual([]);
  });

  it("exposes the reproducible one-command packager", () => {
    const packageDocument = readJson(join(root, "package.json"));
    const scripts = packageDocument.scripts as Record<string, string>;
    expect(scripts["package:team-deploy"]).toBe("bash scripts/package-team-deploy.sh");
    expect(existsSync(join(root, "scripts", "package-team-deploy.sh"))).toBe(true);

    const installer = readFileSync(join(template, "install.sh"), "utf8");
    expect(installer).toContain('PACKAGE_SHA256="__PACKAGE_SHA256__"');
    expect(installer).toContain('PACKAGE_ARCHIVE="opengrok-mcp-server-routing-canary.tgz"');
  });
});
