#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${OPENGROK_MCP_CONFIG_DIR:-${HOME}/.config/opengrok-mcp}"
CONNECTIONS_FILE="${CONFIG_DIR}/connections.json"
NETWORK_FILE="${CONFIG_DIR}/network.json"
COOKIE_JSON="${CONFIG_DIR}/cookies.json"
WRAPPER="${HOME}/.local/bin/opengrok-mcp-wrapper.sh"

for path in "$CONNECTIONS_FILE" "$NETWORK_FILE" "$COOKIE_JSON" "$WRAPPER"; do
  [[ -r "$path" ]] || { echo "Missing required file: $path" >&2; exit 1; }
done
command -v timeout >/dev/null 2>&1 || { echo "GNU timeout is required for this smoke test" >&2; exit 1; }

echo "== Static routing configuration =="
/usr/bin/python3 - "$CONNECTIONS_FILE" "$NETWORK_FILE" "$COOKIE_JSON" <<'PY'
import json, sys
connections_file, network_file, cookies_file = sys.argv[1:]
with open(connections_file, encoding="utf-8") as handle:
    connections = json.load(handle)["connections"]
with open(network_file, encoding="utf-8") as handle:
    network = json.load(handle)
with open(cookies_file, encoding="utf-8") as handle:
    state = json.load(handle)
cookies = state.get("cookies", state)
if len(connections) < 2:
    raise SystemExit("FAIL: at least two active connections required")
for name, connection in connections.items():
    cookie_env = connection.get("cookieEnv")
    if not cookie_env or not cookies.get(cookie_env):
        raise SystemExit(f"FAIL: cookie missing for {name} ({cookie_env})")
    proxy_env = connection.get("proxyEnv")
    if proxy_env and (proxy_env not in network or connection.get("direct")):
        raise SystemExit(f"FAIL: invalid proxy policy for {name}")
    policy = f"proxyEnv={proxy_env}" if proxy_env else ("direct=true" if connection.get("direct") else "default")
    print(f"PASS: {name}: {policy}, cookie present")
PY

ACTIVE_TEXT="$(/usr/bin/python3 - "$CONNECTIONS_FILE" <<'PY'
import json,sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print("\n".join(json.load(handle)["connections"]))
PY
)"
[[ -n "$ACTIVE_TEXT" ]] || { echo "FAIL: no active connections" >&2; exit 1; }
mapfile -t ACTIVE_NAMES <<< "$ACTIVE_TEXT"

echo
echo "== Live discovery with intentionally broken global proxy =="
log_file="$(mktemp "${TMPDIR:-/tmp}/opengrok-routing-smoke.XXXXXX")"
trap 'rm -f "$log_file"' EXIT
set +e
HTTP_PROXY="http://127.0.0.1:9" HTTPS_PROXY="http://127.0.0.1:9" \
  timeout 45 "$WRAPPER" </dev/null >/dev/null 2>"$log_file"
result=$?
set -e

if grep -q "Starting server" "$log_file"; then
  for name in "${ACTIVE_NAMES[@]}"; do
    if ! grep -Fq "${name}=" "$log_file"; then
      echo "FAIL: discovery missing for $name" >&2
      tail -30 "$log_file" >&2 || true
      exit 1
    fi
  done
  echo "PASS: ${#ACTIVE_NAMES[@]} active connections discovered in one routed MCP process"
  exit 0
fi

echo "FAIL: routed MCP did not finish project discovery (exit=$result)" >&2
tail -30 "$log_file" >&2 || true
exit 1
