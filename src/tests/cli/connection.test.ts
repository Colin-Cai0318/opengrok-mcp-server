import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseServerArguments } from "../../server/cli/connection.js";

describe("server connection arguments", () => {
  it("uses direct URL arguments without changing process.env", () => {
    const parsed = parseServerArguments([
      "--url", "https://one.example/source/",
      "--username", "alice",
      "--default-project", "kernel",
      "--no-verify-ssl",
    ]);
    expect(parsed).toEqual({
      help: false,
      overrides: {
        OPENGROK_BASE_URL: "https://one.example/source/",
        OPENGROK_USERNAME: "alice",
        OPENGROK_DEFAULT_PROJECT: "kernel",
        OPENGROK_VERIFY_SSL: "false",
      },
    });
  });

  it("loads one named connection and resolves its cookie from the environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "opengrok-connections-"));
    const file = join(dir, "connections.json");
    writeFileSync(file, JSON.stringify({ connections: {
      platform: { url: "https://platform.example/source/", cookieEnv: "PLATFORM_COOKIE", defaultProject: "p1" },
      firmware: { url: "https://firmware.example/source/" },
    } }));
    try {
      expect(parseServerArguments(["--connections-file", file, "--connection", "platform"], { PLATFORM_COOKIE: "cas=value" }))
        .toEqual({ help: false, overrides: {
          OPENGROK_BASE_URL: "https://platform.example/source/",
          OPENGROK_COOKIE: "cas=value",
          OPENGROK_DEFAULT_PROJECT: "p1",
        } });
      expect(parseServerArguments(["--connections-file", file, "--connection", "platform", "--url", "https://override.example/source/"], { PLATFORM_COOKIE: "cas=value" })
        .overrides.OPENGROK_BASE_URL).toBe("https://override.example/source/");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects incomplete named-connection arguments and missing cookies", () => {
    expect(() => parseServerArguments(["--connection", "platform"])).toThrow("must be used together");
    expect(() => parseServerArguments(["--cookie-env", "MISSING"], {})).toThrow("MISSING");
  });
});
