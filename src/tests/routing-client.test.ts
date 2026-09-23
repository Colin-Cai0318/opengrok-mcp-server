import { describe, expect, it, vi } from "vitest";
import type { OpenGrokClientLike } from "../server/client.js";
import type { Project, SearchResults } from "../server/models.js";
import { OpenGrokRoutingClient } from "../server/routing-client.js";

function searchResults(
  project: string,
  count: number = 1,
  query: string = "needle",
  totalCount: number = count
): SearchResults {
  return {
    query,
    searchType: "full",
    totalCount,
    timeMs: 5,
    results: Array.from({ length: count }, (_, index) => ({
      project,
      path: `/${project}-${index + 1}.ts`,
      matches: [{ lineNumber: index + 1, lineContent: query }],
    })),
    startIndex: 0,
    endIndex: count > 0 ? count - 1 : 0,
  };
}

function mockClient(
  url: string,
  projects: Project[],
  resultCount: number = 1,
  totalCount: number = resultCount
): OpenGrokClientLike {
  return {
    search: vi.fn(async (query: string, _type, routedProjects?: string[]) =>
      searchResults(routedProjects?.[0] ?? projects[0]?.name ?? "unknown", resultCount, query, totalCount)),
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

  it("round-robins full result sets without starving a later route", async () => {
    const first = mockClient("https://one.example/", [{ name: "alpha" }], 10);
    const second = mockClient("https://two.example/", [{ name: "beta" }], 10);
    const router = await OpenGrokRoutingClient.connect([
      { name: "one", client: first },
      { name: "two", client: second },
    ]);

    const result = await router.search("needle", "full", ["alpha", "beta"], 10);
    expect(result.results.map((item) => item.path)).toEqual([
      "/alpha-1.ts", "/beta-1.ts",
      "/alpha-2.ts", "/beta-2.ts",
      "/alpha-3.ts", "/beta-3.ts",
      "/alpha-4.ts", "/beta-4.ts",
      "/alpha-5.ts", "/beta-5.ts",
    ]);
  });

  it("uses remaining quota after one route is exhausted", async () => {
    const first = mockClient("https://one.example/", [{ name: "alpha" }], 2);
    const second = mockClient("https://two.example/", [{ name: "beta" }], 10);
    const router = await OpenGrokRoutingClient.connect([
      { name: "one", client: first },
      { name: "two", client: second },
    ]);

    const result = await router.search("needle", "full", ["alpha", "beta"], 8);
    expect(result.results.map((item) => item.path)).toEqual([
      "/alpha-1.ts", "/beta-1.ts", "/alpha-2.ts", "/beta-2.ts",
      "/beta-3.ts", "/beta-4.ts", "/beta-5.ts", "/beta-6.ts",
    ]);
  });

  it("round-robins deterministically across three routes", async () => {
    const clients = [
      mockClient("https://one.example/", [{ name: "alpha" }], 5),
      mockClient("https://two.example/", [{ name: "beta" }], 5),
      mockClient("https://three.example/", [{ name: "gamma" }], 5),
    ];
    const router = await OpenGrokRoutingClient.connect([
      { name: "one", client: clients[0] },
      { name: "two", client: clients[1] },
      { name: "three", client: clients[2] },
    ]);

    const result = await router.search("needle", "full", ["alpha", "beta", "gamma"], 9);
    expect(result.results.map((item) => item.path)).toEqual([
      "/alpha-1.ts", "/beta-1.ts", "/gamma-1.ts",
      "/alpha-2.ts", "/beta-2.ts", "/gamma-2.ts",
      "/alpha-3.ts", "/beta-3.ts", "/gamma-3.ts",
    ]);
  });

  it("lets non-empty routes fill the result limit", async () => {
    const empty = mockClient("https://one.example/", [{ name: "alpha" }], 0);
    const populated = mockClient("https://two.example/", [{ name: "beta" }], 10);
    const router = await OpenGrokRoutingClient.connect([
      { name: "one", client: empty },
      { name: "two", client: populated },
    ]);

    const result = await router.search("needle", "full", ["alpha", "beta"], 5);
    expect(result.results).toHaveLength(5);
    expect(result.results.every((item) => item.project === "beta")).toBe(true);
  });

  it("keeps every available result and sums route totalCount metadata", async () => {
    const first = mockClient("https://one.example/", [{ name: "alpha" }], 2, 100);
    const second = mockClient("https://two.example/", [{ name: "beta" }], 3, 200);
    const router = await OpenGrokRoutingClient.connect([
      { name: "one", client: first },
      { name: "two", client: second },
    ]);

    const result = await router.search("needle", "full", ["alpha", "beta"], 10);
    expect(result.results).toHaveLength(5);
    expect(result.results.map((item) => item.path)).toEqual([
      "/alpha-1.ts", "/beta-1.ts", "/alpha-2.ts", "/beta-2.ts", "/beta-3.ts",
    ]);
    expect(result.totalCount).toBe(300);
    expect(result.endIndex).toBe(4);
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

  it("rejects unknown projects and keeps the first route for duplicate names", async () => {
    const first = mockClient("https://one.example/source/", [{ name: "shared" }]);
    const second = mockClient("https://two.example/source/", [{ name: "beta" }]);
    const router = await OpenGrokRoutingClient.connect([
      { name: "one", client: first },
      { name: "two", client: second },
    ]);
    await expect(router.search("needle", "full", ["missing"])).rejects.toThrow("was not discovered");

    const duplicateOne = mockClient("https://one.example/", [{ name: "shared" }]);
    const duplicateTwo = mockClient("https://two.example/", [{ name: "shared" }]);
    const duplicateRouter = await OpenGrokRoutingClient.connect([
      { name: "one", client: duplicateOne },
      { name: "two", client: duplicateTwo },
    ]);
    expect((await duplicateRouter.listProjects()).map((project) => project.name)).toEqual(["shared"]);
    await duplicateRouter.search("needle", "full", ["shared"]);
    expect(duplicateOne.search).toHaveBeenCalledOnce();
    expect(duplicateTwo.search).not.toHaveBeenCalled();
    expect(duplicateRouter.getBaseUrl("shared")).toBe("https://one.example/");
    await duplicateRouter.close();
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
