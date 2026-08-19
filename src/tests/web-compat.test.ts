import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenGrokClient } from "../server/client.js";
import { loadConfig } from "../server/config.js";

function client(overrides: Record<string, string> = {}): OpenGrokClient {
  return new OpenGrokClient(loadConfig({
    OPENGROK_BASE_URL: "https://example.internal/opengrok/",
    OPENGROK_CACHE_ENABLED: "false",
    OPENGROK_RATELIMIT_ENABLED: "false",
    ...overrides,
  }));
}

describe("company Web UI compatibility", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  afterEach(() => fetchSpy.mockReset());

  it("prefers Cookie/CAS authentication over basic authorization", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ resultCount: 0, results: {} }), { status: 200 }));
    await client({ OPENGROK_USERNAME: "alice", OPENGROK_PASSWORD: "secret", OPENGROK_COOKIE: "CASTGC=cookie" }).search("needle", "full", ["P1"]);
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Cookie).toBe("CASTGC=cookie");
    expect(headers.Authorization).toBeUndefined();
  });

  it("rewrites only a same-host HTTP redirect back to the configured HTTPS endpoint", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "http://example.internal/opengrok/search?full=x&project=P1" } }))
      .mockResolvedValueOnce(new Response("<html></html>", { status: 200 }));
    await client().search("x", "full", ["P1"]);
    expect(fetchSpy.mock.calls[1][0]).toMatch(/^https:\/\/example\.internal\//);
  });

  it("converts a unique defs redirect into one structured search result", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "/opengrok/xref/P1/src/foo.c#123" } }))
      .mockResolvedValueOnce(new Response("<html></html>", { status: 200 }));
    const result = await client().search("Foo", "defs", ["P1"]);
    expect(result).toMatchObject({ totalCount: 1, results: [{ project: "P1", path: "/src/foo.c", matches: [{ lineNumber: 123 }] }] });
  });

  it("uses repeated singular project parameters for Web UI searches", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("<html></html>", { status: 200 }));
    await client().search("Foo", "defs", ["P1", "P2"]);
    const webUrl = String(fetchSpy.mock.calls[0][0]);
    expect(webUrl).toContain("project=P1");
    expect(webUrl).toContain("project=P2");
    expect(webUrl).not.toContain("project=P1%2CP2");
    expect(webUrl).toContain("/search?");
    expect(webUrl).not.toContain("/api/");
  });

  it("reads file symbols from the xref HTML page without a REST request", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(`
      <a class="l" name="10"></a>
      <a class="xf intelliWindow-symbol" data-definition-place="def">main</a>
    `, { status: 200 }));
    const result = await client().getFileSymbols("P1", "src/main.c");
    expect(result.symbols).toMatchObject([{ symbol: "main", type: "function", line: 10 }]);
    const requestUrl = String(fetchSpy.mock.calls[0][0]);
    expect(requestUrl).toContain("/xref/P1/src/main.c");
    expect(requestUrl).not.toContain("/api/");
  });
});
