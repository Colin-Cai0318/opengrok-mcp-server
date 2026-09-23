#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${OPENGROK_MCP_CONFIG_DIR:-${HOME}/.config/opengrok-mcp}"
CONNECTIONS_FILE="${CONFIG_DIR}/connections.json"
NETWORK_FILE="${CONFIG_DIR}/network.json"
COOKIE_JSON="${CONFIG_DIR}/cookies.json"
RUNTIME_DIR="${OPENGROK_MCP_RUNTIME_DIR:-${HOME}/.local/share/opengrok-mcp/runtime}"
MCP_BIN="${RUNTIME_DIR}/node_modules/.bin/opengrok-mcp-server"
START_HELPER="${HOME}/.local/bin/start-opengrok-cookie-helper.sh"

# The cookie helper is always local and must not inherit a corporate proxy.
export NO_PROXY="127.0.0.1,localhost,::1${NO_PROXY:+,${NO_PROXY}}"
export no_proxy="127.0.0.1,localhost,::1${no_proxy:+,${no_proxy}}"

"$START_HELPER" >/dev/null
[[ -r "$CONNECTIONS_FILE" ]] || { echo "Missing $CONNECTIONS_FILE" >&2; exit 1; }
if [[ ! -r "$COOKIE_JSON" ]]; then
  echo "Cookie state not found yet; attempting project discovery on each enabled server." >&2
fi
[[ -x "$MCP_BIN" ]] || {
  echo "OpenGrok MCP runtime missing. Run ~/.local/bin/update-opengrok-mcp.sh" >&2
  exit 1
}

# Resolve every cookieEnv and proxyEnv before starting the single routed MCP.
# Existing process environment values take precedence over network.json, which
# makes temporary Canary overrides possible without editing the installed file.
resolved_data="$(/usr/bin/python3 - "$CONNECTIONS_FILE" "$COOKIE_JSON" "$NETWORK_FILE" <<'PY'
import json
import os
import sys

connections_file, cookies_file, network_file = sys.argv[1:]
with open(connections_file, encoding="utf-8") as handle:
    document = json.load(handle)
connections = document.get("connections", {})
if not isinstance(connections, dict) or len(connections) < 2:
    raise SystemExit("connections.json must define at least two connections")

try:
    with open(cookies_file, encoding="utf-8") as handle:
        state = json.load(handle)
except FileNotFoundError:
    state = {}
cookies = state.get("cookies", state)
if not isinstance(cookies, dict):
    raise SystemExit("cookies.json does not contain a cookies object")

try:
    with open(network_file, encoding="utf-8") as handle:
        network = json.load(handle)
except FileNotFoundError:
    network = {}
if not isinstance(network, dict):
    raise SystemExit("network.json must contain an object")

resolved = {}
for name, connection in connections.items():
    if not isinstance(connection, dict):
        raise SystemExit(f"connection {name} must be an object")
    cookie_env = connection.get("cookieEnv")
    if not isinstance(cookie_env, str) or not cookie_env:
        raise SystemExit(f"connection {name} has no cookieEnv")
    cookie = cookies.get(cookie_env)
    if not isinstance(cookie, str) or not cookie:
        print(f"cookie not available for {name} ({cookie_env}); this connection may be unavailable", file=sys.stderr)
        cookie = ""
    resolved[cookie_env] = cookie

    proxy_env = connection.get("proxyEnv")
    if proxy_env is not None:
        if not isinstance(proxy_env, str) or not proxy_env:
            raise SystemExit(f"connection {name} has an invalid proxyEnv")
        proxy = os.environ.get(proxy_env) or network.get(proxy_env)
        if not isinstance(proxy, str) or not proxy:
            raise SystemExit(f"proxy not available for {name} ({proxy_env})")
        resolved[proxy_env] = proxy

for key, value in resolved.items():
    if "\n" in value or "\r" in value or "\t" in value:
        raise SystemExit(f"environment value for {key} contains an unsupported control character")
    sys.stdout.write(key + "\t" + value + "\n")
PY
)"
while IFS=$'\t' read -r key value; do
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "Invalid environment variable name: $key" >&2; exit 1; }
  export "$key=$value"
done <<< "$resolved_data"
unset key value resolved_data

# Do not alter inherited HTTP(S)_PROXY here. Native connection-level routing
# overrides V/W with proxyEnv and masks it for X with direct=true.
exec "$MCP_BIN" --connections-file "$CONNECTIONS_FILE" "$@"
