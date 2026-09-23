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
    expect(() => parseServerArguments(["--connection", "platform"])).toThrow("requires --connections-file");
    expect(() => parseServerArguments(["--cookie-env", "MISSING"], {})).toThrow("MISSING");
  });

  it("keeps a named route without its Cookie and masks a global Cookie", () => {
    const dir = mkdtempSync(join(tmpdir(), "opengrok-routes-"));
    const file = join(dir, "connections.json");
    writeFileSync(file, JSON.stringify({ connections: {
      one: { url: "https://one.example/source/", cookieEnv: "ONE_COOKIE" },
      two: { url: "https://two.example/source/", cookieEnv: "TWO_COOKIE" },
    } }));
    try {
      const parsed = parseServerArguments(["--connections-file", file], { ONE_COOKIE: "sid=one" });
      expect(parsed.connections?.[0].overrides.OPENGROK_COOKIE).toBe("sid=one");
      expect(parsed.connections?.[1].overrides.OPENGROK_COOKIE).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads every named connection when no single connection is selected", () => {
    const dir = mkdtempSync(join(tmpdir(), "opengrok-routes-"));
    const file = join(dir, "connections.json");
    writeFileSync(file, JSON.stringify({ connections: {
      platform: {
        url: "https://platform.example/source/",
        cookieEnv: "PLATFORM_COOKIE",
        verifySsl: false,
      },
      firmware: {
        url: "https://firmware.example/source/",
        username: "builder",
        passwordEnv: "FIRMWARE_PASSWORD",
        defaultProject: "fw-main",
      },
    } }));
    try {
      const parsed = parseServerArguments(["--connections-file", file], {
        PLATFORM_COOKIE: "cas=value",
        FIRMWARE_PASSWORD: "secret",
      });
      expect(parsed.overrides).toEqual({});
      expect(parsed.connections).toEqual([
        { name: "platform", overrides: {
          OPENGROK_BASE_URL: "https://platform.example/source/",
          OPENGROK_COOKIE: "cas=value",
          OPENGROK_VERIFY_SSL: "false",
        } },
        { name: "firmware", overrides: {
          OPENGROK_BASE_URL: "https://firmware.example/source/",
          OPENGROK_USERNAME: "builder",
          OPENGROK_PASSWORD: "secret",
          OPENGROK_DEFAULT_PROJECT: "fw-main",
        } },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous direct overrides in multi-server mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "opengrok-routes-"));
    const file = join(dir, "connections.json");
    writeFileSync(file, JSON.stringify({ connections: {
      one: { url: "https://one.example/source/" },
      two: { url: "https://two.example/source/" },
    } }));
    try {
      expect(() => parseServerArguments([
        "--connections-file", file,
        "--url", "https://override.example/source/",
      ])).toThrow("cannot be combined with multi-server");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
