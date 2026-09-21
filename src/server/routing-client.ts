import { minimatch } from "minimatch";
import type { OpenGrokClientLike } from "./client.js";
import type {
  DirectoryEntry,
  FileContent,
  FileSymbols,
  Project,
  SearchResults,
  SearchTypeValue,
} from "./models.js";

export interface OpenGrokRouteConnection {
  name: string;
  client: OpenGrokClientLike;
}

interface DiscoveredRoute extends OpenGrokRouteConnection {
  projects: Project[];
}

const MAX_FILTER_LENGTH = 100;

function mergeResultsRoundRobin(
  groups: SearchResults[],
  maxResults: number
): SearchResults["results"] {
  const merged: SearchResults["results"] = [];
  let resultIndex = 0;

  while (merged.length < maxResults) {
    let added = false;
    for (const group of groups) {
      const result = group.results[resultIndex];
      if (result) {
        merged.push(result);
        added = true;
        if (merged.length >= maxResults) break;
      }
    }
    if (!added) break;
    resultIndex += 1;
  }

  return merged;
}

/**
 * One logical OpenGrok client backed by multiple independently authenticated
 * servers. Project ownership is discovered before the MCP transport connects,
 * so every project-scoped operation can be sent directly to its owning server.
 */
export class OpenGrokRoutingClient implements OpenGrokClientLike {
  private readonly projectRoutes = new Map<string, DiscoveredRoute>();
  private readonly projects: Project[];

  private constructor(
    private readonly routes: DiscoveredRoute[],
    private readonly defaultProject?: string
  ) {
    const duplicateOwners = new Map<string, string[]>();
    const projectsByName = new Map<string, Project>();

    for (const route of routes) {
      for (const project of route.projects) {
        const existing = this.projectRoutes.get(project.name);
        if (existing) {
          duplicateOwners.set(
            project.name,
            [existing.name, ...(duplicateOwners.get(project.name)?.slice(1) ?? []), route.name]
          );
          continue;
        }
        this.projectRoutes.set(project.name, route);
        projectsByName.set(project.name, project);
      }
    }

    if (duplicateOwners.size > 0) {
      const details = [...duplicateOwners.entries()]
        .map(([project, owners]) => `${JSON.stringify(project)} on ${[...new Set(owners)].join(", ")}`)
        .join("; ");
      throw new Error(
        `Duplicate OpenGrok project names make automatic routing ambiguous: ${details}. ` +
        "Each configured server must expose unique project names."
      );
    }

    if (defaultProject && !this.projectRoutes.has(defaultProject)) {
      throw new Error(
        `Default project ${JSON.stringify(defaultProject)} was not discovered on any configured OpenGrok server.`
      );
    }

    this.projects = [...projectsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  static async connect(
    connections: OpenGrokRouteConnection[],
    defaultProject?: string
  ): Promise<OpenGrokRoutingClient> {
    if (connections.length < 2) {
      throw new Error("Multi-server routing requires at least two OpenGrok connections");
    }

    const discovered = await Promise.allSettled(
      connections.map(async (connection): Promise<DiscoveredRoute> => ({
        ...connection,
        projects: await connection.client.listProjects(),
      }))
    );

    const failures = discovered.flatMap((result, index) =>
      result.status === "rejected"
        ? [`${connections[index].name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
        : []
    );
    if (failures.length > 0) {
      await Promise.allSettled(connections.map(({ client }) => client.close()));
      throw new Error(`OpenGrok project discovery failed for ${failures.join("; ")}`);
    }

    try {
      return new OpenGrokRoutingClient(
        discovered.map((result) => (result as PromiseFulfilledResult<DiscoveredRoute>).value),
        defaultProject?.trim() || undefined
      );
    } catch (error) {
      // Discovery has already created live HTTP clients. Constructor-level
      // validation failures (duplicates/default mismatch) must release them as
      // eagerly as network discovery failures do.
      await Promise.allSettled(connections.map(({ client }) => client.close()));
      throw error;
    }
  }

  private routeForProject(project: string): DiscoveredRoute {
    const route = this.projectRoutes.get(project);
    if (!route) {
      const known = this.projects.map((item) => item.name);
      const preview = known.slice(0, 20).map((name) => JSON.stringify(name)).join(", ");
      const suffix = known.length > 20 ? `, ... (${known.length} total)` : "";
      throw new Error(
        `Project ${JSON.stringify(project)} was not discovered on any configured OpenGrok server. ` +
        `Known projects: ${preview || "none"}${suffix}`
      );
    }
    return route;
  }

  async search(
    query: string,
    searchType: SearchTypeValue = "full",
    projects?: string[],
    maxResults: number = 10,
    start: number = 0,
    fileType?: string
  ): Promise<SearchResults> {
    const effectiveProjects = projects?.length
      ? projects
      : this.defaultProject
        ? [this.defaultProject]
        : [];
    if (effectiveProjects.length === 0) {
      throw new Error(
        "Search requires at least one project so the request can be routed to the correct OpenGrok server."
      );
    }

    const groups = new Map<DiscoveredRoute, string[]>();
    for (const project of [...new Set(effectiveProjects)]) {
      const route = this.routeForProject(project);
      groups.set(route, [...(groups.get(route) ?? []), project]);
    }

    if (groups.size === 1) {
      const [[route, routedProjects]] = groups;
      return route.client.search(query, searchType, routedProjects, maxResults, start, fileType);
    }

    const results = await Promise.all(
      [...groups.entries()].map(([route, routedProjects]) =>
        route.client.search(query, searchType, routedProjects, maxResults, start, fileType)
      )
    );
    const mergedResults = mergeResultsRoundRobin(results, maxResults);
    return {
      query,
      searchType,
      totalCount: results.reduce((sum, result) => sum + result.totalCount, 0),
      timeMs: Math.max(...results.map((result) => result.timeMs), 0),
      results: mergedResults,
      startIndex: start,
      endIndex: mergedResults.length > 0 ? start + mergedResults.length - 1 : start,
    };
  }

  getFileContent(project: string, path: string, startLine?: number, endLine?: number): Promise<FileContent> {
    return this.routeForProject(project).client.getFileContent(project, path, startLine, endLine);
  }

  getFileSymbols(project: string, path: string): Promise<FileSymbols> {
    return this.routeForProject(project).client.getFileSymbols(project, path);
  }

  browseDirectory(project: string, path: string = ""): Promise<DirectoryEntry[]> {
    return this.routeForProject(project).client.browseDirectory(project, path);
  }

  listProjects(filterPattern?: string): Promise<Project[]> {
    if (!filterPattern) return Promise.resolve([...this.projects]);
    if (filterPattern.length > MAX_FILTER_LENGTH) {
      throw new Error(`Filter pattern too long (max ${MAX_FILTER_LENGTH} characters)`);
    }
    const glob = /[*?]/.test(filterPattern) ? filterPattern : `*${filterPattern}*`;
    return Promise.resolve(
      this.projects.filter((project) => minimatch(project.name, glob, { nocase: true }))
    );
  }

  async testConnection(): Promise<boolean> {
    const results = await Promise.all(this.routes.map(({ client }) => client.testConnection()));
    return results.every(Boolean);
  }

  warmCache(): void {
    for (const route of this.routes) route.client.warmCache();
  }

  getBaseUrl(project?: string): string {
    if (project) return this.routeForProject(project).client.getBaseUrl(project);
    return this.routes.map(({ name, client }) => `${name}=${client.getBaseUrl()}`).join(", ");
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.routes.map(({ client }) => client.close()));
  }
}
