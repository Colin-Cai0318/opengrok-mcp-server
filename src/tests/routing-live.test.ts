import { describe, expect, it, vi } from "vitest";
import { OpenGrokClient } from "../server/client.js";
import { loadConfig } from "../server/config.js";
import { OpenGrokRoutingClient } from "../server/routing-client.js";

const liveDescribe = process.env["OPENGROK_LIVE_ROUTING_TEST"] === "1"
  ? describe
  : describe.skip;

liveDescribe("live multi-server routing", () => {
  it("discovers both public catalogs and routes searches to their owners", async () => {
    const libreOffice = new OpenGrokClient(loadConfig({
      OPENGROK_BASE_URL: "https://opengrok.libreoffice.org/",
      OPENGROK_CACHE_ENABLED: "false",
      OPENGROK_RATELIMIT_ENABLED: "false",
    }));
    const couchbase = new OpenGrokClient(loadConfig({
      OPENGROK_BASE_URL: "https://src.couchbase.org/source/",
      OPENGROK_CACHE_ENABLED: "false",
      OPENGROK_RATELIMIT_ENABLED: "false",
    }));
    const libreSearch = vi.spyOn(libreOffice, "search");
    const couchbaseSearch = vi.spyOn(couchbase, "search");
    try {
      const router = await OpenGrokRoutingClient.connect([
        { name: "libreoffice", client: libreOffice },
        { name: "couchbase", client: couchbase },
      ]);

      const projects = await router.listProjects();
      expect(projects.some((project) => project.name === "core")).toBe(true);
      expect(projects.some((project) => project.name === "7.6.0")).toBe(true);

      const libreResult = await router.search("README", "path", ["core"], 3);
      expect(libreSearch).toHaveBeenCalledWith("README", "path", ["core"], 3, 0, undefined);
      expect(couchbaseSearch).not.toHaveBeenCalled();
      expect(libreResult.results.length).toBeGreaterThan(0);
      expect(libreResult.results.every((result) => result.project === "core")).toBe(true);

      libreSearch.mockClear();
      const couchbaseResult = await router.search("README", "path", ["7.6.0"], 3);
      expect(couchbaseSearch).toHaveBeenCalledWith("README", "path", ["7.6.0"], 3, 0, undefined);
      expect(libreSearch).not.toHaveBeenCalled();
      expect(couchbaseResult.results.length).toBeGreaterThan(0);
      expect(couchbaseResult.results.every((result) => result.project === "7.6.0")).toBe(true);
    } finally {
      await Promise.allSettled([libreOffice.close(), couchbase.close()]);
    }
  }, 60_000);
});
