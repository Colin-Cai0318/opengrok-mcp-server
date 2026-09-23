This directory is copied to ~/.config/opengrok-mcp by install.sh.

Generated locally during installation/runtime (never shipped with secrets):
  helper.token
  opengrok.env
  cookies.json
  cookies/*.cookie
  helper-status.json
  vscode-mcp.generated.json

Static team configuration:
  connections.json
  connections.catalog.json
  network.json

connections.json contains enabled servers and is consumed by the routed MCP.
connections.catalog.json contains available servers. Use
~/.local/bin/manage-opengrok-connections.py to add or remove optional servers.
network.json supplies the non-secret proxy URL.
