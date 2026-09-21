#!/usr/bin/env bash
set -euo pipefail
URLS=(
  '__OPENGROK_V_URL__'
  '__OPENGROK_W_URL__'
  '__OPENGROK_X_URL__'
)
if command -v google-chrome >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  google-chrome --new-tab "${URLS[@]}" >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  for url in "${URLS[@]}"; do xdg-open "$url" >/dev/null 2>&1 || true; done
else
  printf '%s\n' "${URLS[@]}"
fi
