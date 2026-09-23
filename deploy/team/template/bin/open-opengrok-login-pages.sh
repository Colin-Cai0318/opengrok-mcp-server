#!/usr/bin/env bash
set -euo pipefail
CONFIG_DIR="${OPENGROK_MCP_CONFIG_DIR:-${HOME}/.config/opengrok-mcp}"
URL_TEXT="$(/usr/bin/python3 - "$CONFIG_DIR/connections.json" <<'PY'
import json,sys
from urllib.parse import urlparse
with open(sys.argv[1], encoding="utf-8") as handle:
    connections = json.load(handle)["connections"]
urls = list(dict.fromkeys(connection["url"] for connection in connections.values()))
for url in urls:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise SystemExit("Invalid OpenGrok URL")
    print(url)
PY
)"
[[ -n "$URL_TEXT" ]] || { echo "No active OpenGrok URLs" >&2; exit 1; }
mapfile -t URLS <<< "$URL_TEXT"
if command -v google-chrome >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  google-chrome --new-tab "${URLS[@]}" >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  for url in "${URLS[@]}"; do xdg-open "$url" >/dev/null 2>&1 || true; done
else
  printf '%s\n' "${URLS[@]}"
fi
