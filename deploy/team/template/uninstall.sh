#!/usr/bin/env bash
set -euo pipefail
"${HOME}/.local/bin/stop-opengrok-cookie-helper.sh" 2>/dev/null || true
for f in opengrok_cookie_helper.py manage-opengrok-connections.py start-opengrok-cookie-helper.sh stop-opengrok-cookie-helper.sh update-opengrok-mcp.sh opengrok-mcp-wrapper.sh opengrok-cookie-status.sh open-opengrok-login-pages.sh install-vscode-mcp.sh test-opengrok-routing.sh; do
  rm -f "${HOME}/.local/bin/$f"
done
rm -rf "${HOME}/.local/share/opengrok-mcp" "${HOME}/.local/state/opengrok-mcp"
rm -f "${HOME}/.local/run/opengrok-cookie-helper.pid"
if [[ "${1:-}" == "--purge-config" ]]; then
  rm -rf "${HOME}/.config/opengrok-mcp"
  echo "Removed config and cookies."
else
  echo "Kept ~/.config/opengrok-mcp. Use --purge-config to remove it."
fi
echo "VS Code MCP registrations are not automatically removed."
