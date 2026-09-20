import { describe, expect, it, vi } from "vitest";
import type { OpenGrokClientLike } from "../server/client.js";
import type { Project, SearchResults } from "../server/models.js";
import { OpenGrokRoutingClient } from "../server/routing-client.js";

function searchResult(project: string, query = "needle"): SearchResults {
  return {
    query,
    searchType: "full",
    totalCount: 1,
    timeMs: 5,
    results: [{
      project,
      path: `/${project}.ts`,
      matches: [{ lineNumber: 1, lineContent: query }],
    }],
    startIndex: 0,
    endIndex: 0,
  };
}

function mockClient(url: string, projects: Project[]): OpenGrokClientLike {
  return {
    search: vi.fn(async (query: string, _type, routedProjects?: string[]) =>
      searchResult(routedProjects?.[0] ?? projects[0]?.name ?? "unknown", query)),
    getFileContent: vi.fn(async (project: string, path: string) => ({
      project, path, content: `${url}:${project}:${path}`, lineCount: 1, sizeBytes: 1,
    })),
    getFileSymbols: vi.fn(async (project: string, path: string) => ({ project, path, symbols: [] })),
    browseDirectory: vi.fn(async () => []),
    listProjects: vi.fn(async () => projects),
    testConnection: vi.fn(async () => true),
    warmCache: vi.fn(),
    getBaseUrl: vi.fn(() => url),
    close: vi.fn(async () => undefined),
  };
}

describe("OpenGrokRoutingClient", () => {
  it("discovers every server and routes project-scoped operations", async () => {
    const first = mockClient("https://one.example/source/", [{ name: "alpha" }]);
    const second = mockClient("https://two.example/source/", [{ name: "beta" }]);
    const router = await OpenGrokRoutingClient.connect([
      { name: "one", client: first },
      { name: "two", client: second },
    ]);

    expect(first.listProjects).toHaveBeenCalledOnce();
    expect(second.listProjects).toHaveBeenCalledOnce();
    expect((await router.listProjects()).map((project) => project.name)).toEqual(["alpha", "beta"]);

    await router.search("needle", "full", ["beta"], 7, 3, "typescript");
    expect(second.search).toHaveBeenCalledWith("needle", "full", ["beta"], 7, 3, "typescript");
    expect(first.search).not.toHaveBeenCalled();

    await router.getFileContent("alpha", "/src/a.ts", 2, 4);
    expect(first.getFileContent).toHaveBeenCalledWith("alpha", "/src/a.ts", 2, 4);
    expect(router.getBaseUrl("beta")).toBe("https://two.example/source/");
  });

  it("fans a multi-project search out by owner and merges results", async () => {
    const first = mockClient("https://one.example/source/", [{ name: "alpha" }]);
    const second = mockClient("https://two.example/source/", [{ name: "beta" }]);
    const router = await OpenGrokRoutingClient.connect([
      { name: "one", client: first },
      { name: "two", client: second },
    ]);

    const result = await router.search("needle", "refs", ["alpha", "beta"], 10);
    expect(first.search).toHaveBeenCalledWith("needle", "refs", ["alpha"], 10, 0, undefined);
    expect(second.search).toHaveBeenCalledWith("needle", "refs", ["beta"], 10, 0, undefined);
    expect(result.totalCount).toBe(2);
    expect(result.results.map((item) => item.project)).toEqual(["alpha", "beta"]);
  });

  it("uses the configured default project when search omits projects", async () => {
    const first = mockClient("https://one.example/source/", [{ name: "alpha" }]);
    const second = mockClient("https://two.example/source/", [{ name: "beta" }]);
    const router = await OpenGrokRoutingClient.connect([
      { name: "one", client: first },
      { name: "two", client: second },
    ], "beta");

    await router.search("needle");
    expect(second.search).toHaveBeenCalledWith("needle", "full", ["beta"], 10, 0, undefined);
  });

  it("rejects unknown and duplicate projects instead of guessing a route", async () => {
    const first = mockClient("https://one.example/source/", [{ name: "shared" }]);
    const second = mockClient("https://two.example/source/", [{ name: "beta" }]);
    const router = await OpenGrokRoutingClient.connect([
      { name: "one", client: first },
      { name: "two", client: second },
    ]);
    await expect(router.search("needle", "full", ["missing"])).rejects.toThrow("was not discovered");

    const duplicateOne = mockClient("https://one.example/", [{ name: "shared" }]);
    const duplicateTwo = mockClient("https://two.example/", [{ name: "shared" }]);
    await expect(OpenGrokRoutingClient.connect([
      { name: "one", client: duplicateOne },
      { name: "two", client: duplicateTwo },
    ])).rejects.toThrow("automatic routing ambiguous");
    expect(duplicateOne.close).toHaveBeenCalledOnce();
    expect(duplicateTwo.close).toHaveBeenCalledOnce();
  });

  it("fails startup if any server cannot provide its project catalog", async () => {
    const good = mockClient("https://one.example/source/", [{ name: "alpha" }]);
    const bad = mockClient("https://two.example/source/", []);
    vi.mocked(bad.listProjects).mockRejectedValue(new Error("HTTP 503"));

    await expect(OpenGrokRoutingClient.connect([
      { name: "one", client: good },
      { name: "two", client: bad },
    ])).rejects.toThrow("two: HTTP 503");
    expect(good.close).toHaveBeenCalledOnce();
    expect(bad.close).toHaveBeenCalledOnce();
  });
});
