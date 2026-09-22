#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
CONFIG_DIR="${HOME}/.config/opengrok-mcp"
SHARE_DIR="${HOME}/.local/share/opengrok-mcp"
EXT_DIR="${SHARE_DIR}/chrome-extension"
STATE_DIR="${HOME}/.local/state/opengrok-mcp"
RUN_DIR="${HOME}/.local/run"
PACKAGE_ARCHIVE="opengrok-mcp-server-__NPM_PACKAGE_VERSION__.tgz"
BUNDLED_PACKAGE="${SHARE_DIR}/packages/${PACKAGE_ARCHIVE}"
PACKAGE_SHA256="__PACKAGE_SHA256__"
PACKAGE="${OPENGROK_MCP_PACKAGE:-$BUNDLED_PACKAGE}"

say(){ printf '\n==> %s\n' "$*"; }
backup_and_copy(){
  local src="$1" dst="$2"
  if [[ -f "$dst" ]] && ! cmp -s "$src" "$dst"; then
    local ts; ts="$(date +%Y%m%d-%H%M%S)"
    cp -p "$dst" "${dst}.bak.${ts}"
    echo "Backed up existing $(basename "$dst") -> ${dst}.bak.${ts}"
  fi
  install -m 600 "$src" "$dst"
}

say "Preflight"
[[ -x /usr/bin/python3 ]] || { echo "/usr/bin/python3 not found" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js not found. Install Node.js 22+ first." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm not found." >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum not found." >&2; exit 1; }
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$node_major" -ge 22 ]] || { echo "Node.js 22+ required, current $(node -v)" >&2; exit 1; }
echo "Node: $(node -v)"
echo "npm: $(npm -v)"
echo "Home: $HOME"

say "Install rootless files"
mkdir -p "$BIN_DIR" "$CONFIG_DIR" "$SHARE_DIR" "$SHARE_DIR/packages" "$STATE_DIR" "$RUN_DIR" "$CONFIG_DIR/cookies"
chmod 700 "$CONFIG_DIR" "$STATE_DIR" "$RUN_DIR" "$CONFIG_DIR/cookies" 2>/dev/null || true
for f in opengrok_cookie_helper.py start-opengrok-cookie-helper.sh stop-opengrok-cookie-helper.sh update-opengrok-mcp.sh opengrok-mcp-wrapper.sh opengrok-cookie-status.sh open-opengrok-login-pages.sh install-vscode-mcp.sh test-opengrok-routing.sh; do
  install -m 700 "$ROOT/bin/$f" "$BIN_DIR/$f"
done
backup_and_copy "$ROOT/.config/opengrok-mcp/connections.json" "$CONFIG_DIR/connections.json"
backup_and_copy "$ROOT/.config/opengrok-mcp/network.json" "$CONFIG_DIR/network.json"
install -m 600 "$ROOT/.config/opengrok-mcp/README.txt" "$CONFIG_DIR/README.txt"
install -m 600 "$ROOT/vscode/mcp-servers.json" "$CONFIG_DIR/vscode-mcp.generated.json"
[[ -r "$ROOT/vendor/$PACKAGE_ARCHIVE" ]] || { echo "Bundled MCP package missing: $ROOT/vendor/$PACKAGE_ARCHIVE" >&2; exit 1; }
printf '%s  %s\n' "$PACKAGE_SHA256" "$ROOT/vendor/$PACKAGE_ARCHIVE" | sha256sum -c -
install -m 600 "$ROOT/vendor/$PACKAGE_ARCHIVE" "$BUNDLED_PACKAGE"

say "Install OpenGrok MCP npm runtime"
if [[ "${OPENGROK_SKIP_NPM_INSTALL:-0}" == "1" ]]; then
  echo "Skipped npm install (OPENGROK_SKIP_NPM_INSTALL=1)"
else
  OPENGROK_MCP_PACKAGE="$PACKAGE" "$BIN_DIR/update-opengrok-mcp.sh"
fi

say "Start cookie helper and create per-machine token"
"$BIN_DIR/start-opengrok-cookie-helper.sh"
TOKEN_FILE="$CONFIG_DIR/helper.token"
[[ -s "$TOKEN_FILE" ]] || { echo "helper token missing: $TOKEN_FILE" >&2; exit 1; }
chmod 600 "$TOKEN_FILE"

say "Build machine-bound Chrome extension"
rm -rf "$EXT_DIR"
mkdir -p "$EXT_DIR"
cp -a "$ROOT/chrome-extension/." "$EXT_DIR/"
token="$(cat "$TOKEN_FILE")"
/usr/bin/python3 - "$EXT_DIR/generated-config.js.template" "$EXT_DIR/generated-config.js" "$token" <<'PYEXT'
from pathlib import Path
import json,sys
template,out,token=sys.argv[1:]
text=Path(template).read_text(encoding='utf-8')
text=text.replace('"__HELPER_TOKEN__"', json.dumps(token))
Path(out).write_text(text, encoding='utf-8')
PYEXT
chmod -R go-rwx "$EXT_DIR" 2>/dev/null || true
/usr/bin/python3 - "$EXT_DIR" "$SHARE_DIR/opengrok-cookie-sync-extension.zip" <<'PYZIP'
from pathlib import Path
import sys,zipfile
root=Path(sys.argv[1]); out=Path(sys.argv[2])
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    for p in root.rglob('*'):
        if p.is_file(): z.write(p,p.relative_to(root))
PYZIP

say "Register VS Code MCP servers"
if [[ "${OPENGROK_SKIP_VSCODE:-0}" == "1" ]]; then
  echo "Skipped VS Code registration (OPENGROK_SKIP_VSCODE=1)"
else
  "$BIN_DIR/install-vscode-mcp.sh" || true
fi

say "Installation complete"
cat <<DONE
Installed package:
  ${PACKAGE}

Config:
  ${CONFIG_DIR}/connections.json
  ${CONFIG_DIR}/network.json

Chrome extension (Load unpacked this directory once):
  ${EXT_DIR}

VS Code fallback MCP config:
  ${CONFIG_DIR}/vscode-mcp.generated.json

Next manual steps (first install only):
  1. Chrome -> chrome://extensions -> Developer mode -> Load unpacked -> ${EXT_DIR}
  2. In the extension, click "打开三个 OpenGrok 登录页" and complete login.
     Cookie changes are then synced automatically (onChanged + every 5 minutes).
  3. If VS Code was already open, run "MCP: List Servers" and restart opengrok-android-routing once.
     Disable/remove the legacy opengrok-android-v/w/x entries if they still exist.

Status command:
  ${BIN_DIR}/opengrok-cookie-status.sh

Routing smoke test:
  ${BIN_DIR}/test-opengrok-routing.sh

Important: the MCP server reads Cookie when its process starts.
If Chrome refreshes Cookie while an MCP process is already running, restart that MCP once to consume the new Cookie.
DONE
