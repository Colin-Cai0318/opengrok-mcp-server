#!/usr/bin/env bash
set -euo pipefail
CONFIG_DIR="${HOME}/.config/opengrok-mcp"
echo "== Helper =="
status_file="$(mktemp "${TMPDIR:-/tmp}/opengrok-helper-status.XXXXXX")"
trap 'rm -f "$status_file"' EXIT
if curl --noproxy '*' -fsS --max-time 1 http://127.0.0.1:8765/health >"$status_file" 2>/dev/null; then
  /usr/bin/python3 - "$status_file" <<'PY'
import json,sys
with open(sys.argv[1]) as f:d=json.load(f)
print('status: running')
print('updatedAt:',d.get('updatedAt'))
for k,v in d.get('cookies',{}).items(): print(f'{k}:', 'present' if v.get('present') else 'missing', v.get('sha256Prefix') or '')
PY
else
  echo "status: not running"
fi
echo
echo "== Runtime =="
BIN="${HOME}/.local/share/opengrok-mcp/runtime/node_modules/.bin/opengrok-mcp-server"
if [[ -x "$BIN" ]]; then "$BIN" --version 2>/dev/null || echo installed; else echo missing; fi
SOURCE="${HOME}/.local/share/opengrok-mcp/installed-source.txt"
if [[ -r "$SOURCE" ]]; then echo "source: $(cat "$SOURCE")"; fi
echo
echo "== Native routing =="
/usr/bin/python3 - "${CONFIG_DIR}/connections.json" 2>/dev/null <<'PY' || echo "connections.json: invalid or missing"
import json,sys
with open(sys.argv[1],encoding='utf-8') as f: connections=json.load(f).get('connections',{})
for name,conn in connections.items():
    if conn.get('direct') is True: policy='direct'
    elif conn.get('proxyEnv'): policy='proxyEnv='+str(conn['proxyEnv'])
    else: policy='inherited/default'
    print(f'{name}: {policy}')
PY
echo
echo "== Extension =="
echo "${HOME}/.local/share/opengrok-mcp/chrome-extension"
