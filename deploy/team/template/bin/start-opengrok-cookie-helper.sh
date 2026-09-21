#!/usr/bin/env bash
set -euo pipefail
HELPER="${HOME}/.local/bin/opengrok_cookie_helper.py"
RUNDIR="${HOME}/.local/run"
LOGDIR="${HOME}/.local/state/opengrok-mcp"
PIDFILE="${RUNDIR}/opengrok-cookie-helper.pid"
LOGFILE="${LOGDIR}/cookie-helper.log"
HOST="${OPENGROK_COOKIE_HELPER_HOST:-127.0.0.1}"
PORT="${OPENGROK_COOKIE_HELPER_PORT:-8765}"
mkdir -p "$RUNDIR" "$LOGDIR"
chmod 700 "$RUNDIR" "$LOGDIR" 2>/dev/null || true

# Health checks must never inherit the corporate HTTP(S) proxy. Python urllib
# normally honors HTTP_PROXY/HTTPS_PROXY, which can make a healthy localhost
# helper appear down inside VS Code/Remote extension hosts.
health_ok() {
  /usr/bin/python3 - "$HOST" "$PORT" <<'PY' >/dev/null 2>&1
import json, sys, urllib.request
host, port = sys.argv[1], sys.argv[2]
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(f"http://{host}:{port}/health", timeout=0.75) as r:
        data = json.load(r)
    raise SystemExit(0 if data.get("service") == "opengrok-cookie-helper" and data.get("ok") else 1)
except Exception:
    raise SystemExit(1)
PY
}

is_our_helper_pid() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  local cmdline
  cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
  [[ "$cmdline" == *"opengrok_cookie_helper.py"* ]]
}

stop_our_helper_pid() {
  local pid="$1"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -9 "$pid" 2>/dev/null || true
}

if health_ok; then
  echo "OpenGrok cookie helper already running on ${HOST}:${PORT}"
  exit 0
fi

# Upgrade/recovery path: an older helper may still be alive but not expose
# /health. If the pidfile points to our helper, restart it automatically.
if [[ -f "$PIDFILE" ]]; then
  old_pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if is_our_helper_pid "$old_pid"; then
    echo "Existing OpenGrok cookie helper pid=${old_pid} failed health check; restarting it." >&2
    stop_our_helper_pid "$old_pid"
  fi
  rm -f "$PIDFILE"
fi

# A manually-started legacy helper without our pidfile is not killed automatically.
# If it owns the port, the diagnostic below will report the conflict rather than
# risking termination of an unrelated process.

# Never kill an unrelated service that owns the configured port.
if ! health_ok; then
  port_line="$(ss -lntp 2>/dev/null | grep -E "${HOST//./\\.}:${PORT}[[:space:]]" | head -n 1 || true)"
  if [[ -n "$port_line" ]]; then
    echo "Port ${HOST}:${PORT} is already in use by another process:" >&2
    echo "$port_line" >&2
    exit 1
  fi
fi

[[ -x "$HELPER" ]] || { echo "Helper not installed: $HELPER" >&2; exit 1; }
nohup setsid /usr/bin/python3 -u "$HELPER" >>"$LOGFILE" 2>&1 </dev/null &
pid=$!
echo "$pid" > "$PIDFILE"
chmod 600 "$PIDFILE" 2>/dev/null || true
for _ in $(seq 1 40); do
  if health_ok; then
    echo "OpenGrok cookie helper started, pid=${pid}, http://${HOST}:${PORT}"
    exit 0
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.1
done
rm -f "$PIDFILE"
echo "OpenGrok cookie helper failed to start." >&2
tail -50 "$LOGFILE" >&2 || true
exit 1
