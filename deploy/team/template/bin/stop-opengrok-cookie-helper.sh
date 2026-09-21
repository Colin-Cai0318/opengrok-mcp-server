#!/usr/bin/env bash
set -euo pipefail
PIDFILE="${HOME}/.local/run/opengrok-cookie-helper.pid"
if [[ ! -f "$PIDFILE" ]]; then echo "No helper pidfile found."; exit 0; fi
pid="$(cat "$PIDFILE" 2>/dev/null || true)"
if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then rm -f "$PIDFILE"; echo "Helper is not running."; exit 0; fi
cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
[[ "$cmdline" == *"opengrok_cookie_helper.py"* ]] || { echo "Refusing to kill unrelated pid ${pid}." >&2; exit 1; }
kill "$pid"
for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
rm -f "$PIDFILE"
echo "OpenGrok cookie helper stopped."
