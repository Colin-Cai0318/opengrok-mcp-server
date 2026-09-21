#!/usr/bin/env bash
set -euo pipefail

WRAPPER="${HOME}/.local/bin/opengrok-mcp-wrapper.sh"
CONFIG_DIR="${HOME}/.config/opengrok-mcp"
GENERATED="${CONFIG_DIR}/vscode-mcp.generated.json"
HYPERCODE_USER_DIR="${HOME}/.hypercode-server/data/User"
HYPERCODE_MCP="${HYPERCODE_USER_DIR}/mcp.json"
ROUTED_NAME="opengrok-android-routing"

merge_mcp_json() {
  local target="$1"
  mkdir -p "$(dirname "$target")"
  if [[ -f "$target" ]]; then
    local ts; ts="$(date +%Y%m%d-%H%M%S)"
    cp -p "$target" "${target}.bak.${ts}"
    echo "Backed up MCP config: ${target}.bak.${ts}"
  fi
  /usr/bin/python3 - "$target" "$WRAPPER" "$ROUTED_NAME" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
wrapper = sys.argv[2]
routed_name = sys.argv[3]
try:
    document = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if not isinstance(document, dict):
        document = {}
except Exception:
    document = {}

servers = document.setdefault("servers", {})
if not isinstance(servers, dict):
    servers = {}
    document["servers"] = servers
for legacy in ("opengrok-android-v", "opengrok-android-w", "opengrok-android-x"):
    servers.pop(legacy, None)
servers[routed_name] = {
    "type": "stdio",
    "command": wrapper,
    "args": [],
    "env": {"OPENGROK_CODE_MODE": "false"},
}
document.setdefault("inputs", [])
path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
  chmod 600 "$target" 2>/dev/null || true
}

# HyperCode Remote uses its own user MCP file. Update it directly while
# preserving unrelated servers and removing this package's three legacy entries.
if [[ -d "$HYPERCODE_USER_DIR" || -f "$HYPERCODE_MCP" ]]; then
  merge_mcp_json "$HYPERCODE_MCP"
  echo "Registered routed HyperCode MCP server in: $HYPERCODE_MCP"
  exit 0
fi

find_code() {
  if command -v code >/dev/null 2>&1; then command -v code; return 0; fi
  local candidate
  candidate="$(find "${HOME}/.vscode-server/bin" -path '*/bin/remote-cli/code' -type f 2>/dev/null | sort | tail -n1 || true)"
  [[ -n "$candidate" ]] && { echo "$candidate"; return 0; }
  candidate="$(find "${HOME}/.vscode-server-insiders/bin" -path '*/bin/remote-cli/code' -type f 2>/dev/null | sort | tail -n1 || true)"
  [[ -n "$candidate" ]] && { echo "$candidate"; return 0; }
  return 1
}

CODE_BIN="$(find_code || true)"
if [[ -z "$CODE_BIN" ]]; then
  echo "VS Code CLI not found; skipped automatic MCP registration."
  echo "Generated config: $GENERATED"
  exit 0
fi

spec="$(/usr/bin/python3 - "$ROUTED_NAME" "$WRAPPER" <<'PY'
import json
import sys
name, wrapper = sys.argv[1:]
print(json.dumps({
    "name": name,
    "type": "stdio",
    "command": wrapper,
    "args": [],
    "env": {"OPENGROK_CODE_MODE": "false"},
}, separators=(",", ":")))
PY
)"

echo "Using VS Code CLI: $CODE_BIN"
if "$CODE_BIN" --add-mcp "$spec" >/dev/null 2>&1; then
  echo "Registered VS Code MCP: $ROUTED_NAME"
else
  echo "WARN: could not auto-register $ROUTED_NAME; use $GENERATED manually." >&2
fi
echo "If the old V/W/X MCP entries are still shown, remove or disable those three entries; only $ROUTED_NAME should remain enabled."
