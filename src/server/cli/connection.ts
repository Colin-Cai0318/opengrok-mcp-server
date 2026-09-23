import { readFileSync } from "fs";
import { resolve } from "path";

export interface NamedConnection {
  url: string;
  username?: string;
  cookieEnv?: string;
  passwordEnv?: string;
  defaultProject?: string;
  verifySsl?: boolean;
  proxyEnv?: string;
  direct?: boolean;
}

interface ConnectionsDocument {
  connections: Record<string, NamedConnection>;
}

export interface ServerArguments {
  overrides: Record<string, string>;
  connections?: ResolvedConnection[];
  help: boolean;
}

export interface ResolvedConnection {
  name: string;
  overrides: Record<string, string>;
}

const HELP = `OpenGrok MCP Server\n\n` +
  `Usage:\n` +
  `  opengrok-mcp-server --url <OpenGrok URL> [--cookie-env <ENV_NAME>]\n` +
  `  opengrok-mcp-server --connections-file <file.json>\n` +
  `  opengrok-mcp-server --connections-file <file.json> --connection <name>\n\n` +
  `Options:\n` +
  `  --url <url>                 Override OPENGROK_BASE_URL for this MCP process\n` +
  `  --username <username>       Override OPENGROK_USERNAME for this MCP process\n` +
  `  --cookie-env <environment>  Read Cookie/CAS credentials from this environment variable\n` +
  `  --default-project <project> Override OPENGROK_DEFAULT_PROJECT\n` +
  `  --no-verify-ssl             Disable TLS verification for this MCP process\n` +
  `  --connections-file <file>   Route projects across all named connections in this JSON file\n` +
  `  --connection <name>         Select only one connection (legacy single-server mode)\n`;

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function readConnections(filePath: string, environment: NodeJS.ProcessEnv): ResolvedConnection[] {
  let document: ConnectionsDocument;
  try {
    document = JSON.parse(readFileSync(resolve(filePath), "utf8")) as ConnectionsDocument;
  } catch (err) {
    throw new Error(`Cannot read OpenGrok connections file "${filePath}": ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!document?.connections || typeof document.connections !== "object" || Array.isArray(document.connections)) {
    throw new Error(`OpenGrok connections file "${filePath}" must contain a "connections" object`);
  }

  const entries = Object.entries(document.connections);
  if (entries.length === 0) {
    throw new Error(`OpenGrok connections file "${filePath}" does not define any connections`);
  }

  return entries.map(([name, connection]) => {
    if (!name.trim()) throw new Error(`Connection names in "${filePath}" must not be empty`);
    if (!connection || typeof connection !== "object") {
      throw new Error(`Connection "${name}" in "${filePath}" must be an object`);
    }
    if (typeof connection.url !== "string" || !connection.url.trim()) {
      throw new Error(`Connection "${name}" must define a non-empty "url"`);
    }
    try {
      const parsed = new URL(connection.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
    } catch {
      throw new Error(`Connection "${name}" must define an absolute HTTP(S) "url"`);
    }

    const overrides: Record<string, string> = { OPENGROK_BASE_URL: connection.url };
    if (connection.username) overrides.OPENGROK_USERNAME = connection.username;
    if (connection.defaultProject) overrides.OPENGROK_DEFAULT_PROJECT = connection.defaultProject;
    if (typeof connection.verifySsl === "boolean") {
      overrides.OPENGROK_VERIFY_SSL = String(connection.verifySsl);
    }
    if (connection.cookieEnv) {
      const cookie = environment[connection.cookieEnv];
      // An unavailable login must not prevent healthy routes from starting.
      // Explicitly mask a process-wide Cookie so credentials never leak across
      // named servers when this connection's own Cookie is absent.
      overrides.OPENGROK_COOKIE = cookie || "";
    }
    if (connection.passwordEnv) {
      const password = environment[connection.passwordEnv];
      if (!password) throw new Error(`Connection "${name}" requires environment variable "${connection.passwordEnv}"`);
      overrides.OPENGROK_PASSWORD = password;
    }
    if (connection.proxyEnv !== undefined &&
        (typeof connection.proxyEnv !== "string" || !connection.proxyEnv.trim())) {
      throw new Error(`Connection "${name}" must define proxyEnv as a non-empty environment variable name`);
    }
    if (connection.direct !== undefined && typeof connection.direct !== "boolean") {
      throw new Error(`Connection "${name}" must define direct as a boolean`);
    }
    if (connection.proxyEnv && connection.direct) {
      throw new Error(`Connection "${name}" cannot configure both proxyEnv and direct`);
    }
    if (connection.proxyEnv) {
      const proxy = environment[connection.proxyEnv];
      if (!proxy) throw new Error(`Connection "${name}" requires environment variable "${connection.proxyEnv}"`);
      // OpenGrokClient consumes the uppercase HTTP(S) proxy settings. Set both
      // per connection so the URL scheme cannot fall back to a global proxy.
      overrides.HTTP_PROXY = proxy;
      overrides.HTTPS_PROXY = proxy;
    } else if (connection.direct) {
      // Empty overrides intentionally mask process-level proxy variables when
      // loadConfig merges process.env with this connection's configuration.
      overrides.HTTP_PROXY = "";
      overrides.HTTPS_PROXY = "";
    }
    return { name, overrides };
  });
}

/** Parse server-only arguments without emitting to stdout (stdio remains MCP-only). */
export function parseServerArguments(args: string[], environment: NodeJS.ProcessEnv = process.env): ServerArguments {
  const direct: Record<string, string> = {};
  let connectionsFile: string | undefined;
  let connectionName: string | undefined;
  let help = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--url":
        direct.OPENGROK_BASE_URL = requireValue(args, index++, arg);
        break;
      case "--username":
        direct.OPENGROK_USERNAME = requireValue(args, index++, arg);
        break;
      case "--cookie-env": {
        const envName = requireValue(args, index++, arg);
        const cookie = environment[envName];
        if (!cookie) throw new Error(`${arg} requires environment variable "${envName}"`);
        direct.OPENGROK_COOKIE = cookie;
        break;
      }
      case "--default-project":
        direct.OPENGROK_DEFAULT_PROJECT = requireValue(args, index++, arg);
        break;
      case "--no-verify-ssl":
        direct.OPENGROK_VERIFY_SSL = "false";
        break;
      case "--connections-file":
        connectionsFile = requireValue(args, index++, arg);
        break;
      case "--connection":
        connectionName = requireValue(args, index++, arg);
        break;
      default:
        throw new Error(`Unknown server option "${arg}". Use --help to list supported options.`);
    }
  }

  if (help) return { overrides: {}, help: true };
  if (connectionName && !connectionsFile) {
    throw new Error("--connection requires --connections-file");
  }
  if (!connectionsFile) return { overrides: direct, help: false };

  const connections = readConnections(connectionsFile, environment);
  if (connectionName) {
    const selected = connections.find((connection) => connection.name === connectionName);
    if (!selected) throw new Error(`Connection "${connectionName}" was not found in "${connectionsFile}"`);
    return { overrides: { ...selected.overrides, ...direct }, help: false };
  }
  if (Object.keys(direct).length > 0) {
    throw new Error(
      "Direct connection options cannot be combined with multi-server --connections-file mode; " +
      "put per-server URL and credentials in the connections file"
    );
  }
  return { overrides: {}, connections, help: false };
}

export function serverHelp(): string {
  return HELP;
}
