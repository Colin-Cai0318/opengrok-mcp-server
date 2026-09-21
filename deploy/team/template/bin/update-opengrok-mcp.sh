#!/usr/bin/env bash
set -euo pipefail

SHARE_DIR="${HOME}/.local/share/opengrok-mcp"
BUNDLED_PACKAGE="${SHARE_DIR}/packages/opengrok-mcp-server-routing-canary.tgz"
RUNTIME_DIR="${OPENGROK_MCP_RUNTIME_DIR:-${SHARE_DIR}/runtime}"

if [[ "${1:-}" == "--latest" ]]; then
  PACKAGE="@colin-cai0318/opengrok-mcp-server@latest"
elif [[ $# -gt 0 ]]; then
  echo "Usage: $(basename "$0") [--latest]" >&2
  exit 2
else
  PACKAGE="${OPENGROK_MCP_PACKAGE:-$BUNDLED_PACKAGE}"
fi

command -v node >/dev/null 2>&1 || { echo "node not found" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm not found" >&2; exit 1; }
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$node_major" -lt 22 ]]; then
  echo "Node.js 22+ is required. Current: $(node -v)" >&2
  exit 1
fi
if [[ "$PACKAGE" == "$BUNDLED_PACKAGE" && ! -r "$BUNDLED_PACKAGE" ]]; then
  echo "Bundled Canary package is missing: $BUNDLED_PACKAGE" >&2
  echo "Re-run install.sh from the deployment archive, or set OPENGROK_MCP_PACKAGE explicitly." >&2
  exit 1
fi

mkdir -p "$RUNTIME_DIR"
echo "Installing ${PACKAGE} into ${RUNTIME_DIR} ..."
npm install --prefix "$RUNTIME_DIR" --omit=dev --no-audit --no-fund "$PACKAGE"
bin="${RUNTIME_DIR}/node_modules/.bin/opengrok-mcp-server"
[[ -x "$bin" ]] || { echo "Expected MCP binary not found: $bin" >&2; exit 1; }
printf '%s\n' "$PACKAGE" > "${SHARE_DIR}/installed-source.txt"
chmod 600 "${SHARE_DIR}/installed-source.txt" 2>/dev/null || true
echo "OpenGrok MCP installed: $($bin --version 2>/dev/null || echo OK)"

if [[ "${1:-}" == "--latest" ]]; then
  echo "WARNING: --latest switches away from the reviewed routing Canary build."
fi
