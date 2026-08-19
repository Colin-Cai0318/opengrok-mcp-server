import { readFileSync } from "fs";
import { resolve } from "path";

export interface NamedConnection {
  url: string;
  username?: string;
  cookieEnv?: string;
  defaultProject?: string;
  verifySsl?: boolean;
}

interface ConnectionsDocument {
  connections: Record<string, NamedConnection>;
}

export interface ServerArguments {
  overrides: Record<string, string>;
  help: boolean;
}

const HELP = `OpenGrok MCP Server\n\n` +
  `Usage:\n` +
  `  opengrok-mcp-server --url <OpenGrok URL> [--cookie-env <ENV_NAME>]\n` +
  `  opengrok-mcp-server --connections-file <file.json> --connection <name>\n\n` +
  `Options:\n` +
  `  --url <url>                 Override OPENGROK_BASE_URL for this MCP process\n` +
  `  --username <username>       Override OPENGROK_USERNAME for this MCP process\n` +
  `  --cookie-env <environment>  Read Cookie/CAS credentials from this environment variable\n` +
  `  --default-project <project> Override OPENGROK_DEFAULT_PROJECT\n` +
  `  --no-verify-ssl             Disable TLS verification for this MCP process\n` +
  `  --connections-file <file>   JSON file containing named, reusable connections\n` +
  `  --connection <name>         Select one connection from --connections-file\n`;

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function readNamedConnection(filePath: string, name: string, environment: NodeJS.ProcessEnv): Record<string, string> {
  let document: ConnectionsDocument;
  try {
    document = JSON.parse(readFileSync(resolve(filePath), "utf8")) as ConnectionsDocument;
  } catch (err) {
    throw new Error(`Cannot read OpenGrok connections file "${filePath}": ${err instanceof Error ? err.message : String(err)}`);
  }

  const connection = document?.connections?.[name];
  if (!connection || typeof connection !== "object") {
    throw new Error(`Connection "${name}" was not found in "${filePath}"`);
  }
  if (typeof connection.url !== "string" || !connection.url.trim()) {
    throw new Error(`Connection "${name}" must define a non-empty "url"`);
  }

  const overrides: Record<string, string> = { OPENGROK_BASE_URL: connection.url };
  if (connection.username) overrides.OPENGROK_USERNAME = connection.username;
  if (connection.defaultProject) overrides.OPENGROK_DEFAULT_PROJECT = connection.defaultProject;
  if (connection.verifySsl === false) overrides.OPENGROK_VERIFY_SSL = "false";
  if (connection.cookieEnv) {
    const cookie = environment[connection.cookieEnv];
    if (!cookie) throw new Error(`Connection "${name}" requires environment variable "${connection.cookieEnv}"`);
    overrides.OPENGROK_COOKIE = cookie;
  }
  return overrides;
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
  if (Boolean(connectionsFile) !== Boolean(connectionName)) {
    throw new Error("--connections-file and --connection must be used together");
  }
  const fromNamedConnection = connectionsFile && connectionName
    ? readNamedConnection(connectionsFile, connectionName, environment)
    : {};
  return { overrides: { ...fromNamedConnection, ...direct }, help: false };
}

export function serverHelp(): string {
  return HELP;
}
