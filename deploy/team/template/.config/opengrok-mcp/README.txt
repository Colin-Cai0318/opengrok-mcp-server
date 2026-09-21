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
  network.json

connections.json is consumed by one routed MCP process. V/W use proxyEnv and
X uses direct=true. network.json supplies the non-secret V/W proxy URL.
