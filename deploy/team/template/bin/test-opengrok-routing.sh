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
import json
import sys

connections_file, network_file, cookies_file = sys.argv[1:]
with open(connections_file, encoding="utf-8") as handle:
    connections = json.load(handle).get("connections", {})
with open(network_file, encoding="utf-8") as handle:
    network = json.load(handle)
with open(cookies_file, encoding="utf-8") as handle:
    state = json.load(handle)
cookies = state.get("cookies", state)

expected = {
    "opengrok-android-v": ("OPENGROK_PROXY_VW", False),
    "opengrok-android-w": ("OPENGROK_PROXY_VW", False),
    "opengrok-android-x": (None, True),
}
for name, (proxy_env, direct) in expected.items():
    connection = connections.get(name)
    if not isinstance(connection, dict):
        raise SystemExit(f"FAIL: missing connection {name}")
    if connection.get("proxyEnv") != proxy_env or bool(connection.get("direct", False)) != direct:
        raise SystemExit(f"FAIL: unexpected network policy for {name}")
    cookie_env = connection.get("cookieEnv")
    if not isinstance(cookies, dict) or not cookies.get(cookie_env):
        raise SystemExit(f"FAIL: cookie missing for {name} ({cookie_env})")
    policy = f"proxyEnv={proxy_env}" if proxy_env else "direct=true"
    print(f"PASS: {name}: {policy}, cookie present")

proxy = network.get("OPENGROK_PROXY_VW")
if not isinstance(proxy, str) or not proxy:
    raise SystemExit("FAIL: OPENGROK_PROXY_VW missing from network.json")
print("PASS: V/W proxy configured")
PY

echo
echo "== Live discovery with intentionally broken global proxy =="
log_file="$(mktemp "${TMPDIR:-/tmp}/opengrok-routing-smoke.XXXXXX")"
trap 'rm -f "$log_file"' EXIT
set +e
HTTP_PROXY="http://127.0.0.1:9" \
HTTPS_PROXY="http://127.0.0.1:9" \
timeout 45 "$WRAPPER" </dev/null >/dev/null 2>"$log_file"
result=$?
set -e

if grep -q "Starting server" "$log_file" && \
   grep -q "opengrok-android-v=" "$log_file" && \
   grep -q "opengrok-android-w=" "$log_file" && \
   grep -q "opengrok-android-x=" "$log_file"; then
  echo "PASS: V/W/X project discovery completed in one routed MCP process"
  echo "PASS: V/W proxy and X direct worked despite bad global HTTP(S)_PROXY"
  exit 0
fi

echo "FAIL: routed MCP did not finish project discovery (exit=$result)" >&2
tail -30 "$log_file" >&2 || true
exit 1
