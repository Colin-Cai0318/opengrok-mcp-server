#!/usr/bin/env python3
"""Rootless localhost helper for OpenGrok Chrome-cookie synchronization."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import tempfile
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict

HOST = os.environ.get("OPENGROK_COOKIE_HELPER_HOST", "127.0.0.1")
PORT = int(os.environ.get("OPENGROK_COOKIE_HELPER_PORT", "8765"))
CONFIG_DIR = Path(os.environ.get("OPENGROK_MCP_CONFIG_DIR", str(Path.home() / ".config" / "opengrok-mcp"))).expanduser()
ENV_FILE = CONFIG_DIR / "opengrok.env"
COOKIE_JSON_FILE = CONFIG_DIR / "cookies.json"
COOKIE_DIR = CONFIG_DIR / "cookies"
TOKEN_FILE = CONFIG_DIR / "helper.token"
STATUS_FILE = CONFIG_DIR / "helper-status.json"

ALLOWED_COOKIE_KEYS = {
    "OPENGROK_COOKIE_V": "opengrok-android-v.cookie",
    "OPENGROK_COOKIE_W": "opengrok-android-w.cookie",
    "OPENGROK_COOKIE_X": "opengrok-android-x.cookie",
}
_state_lock = threading.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write(path: Path, text: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent), text=True)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
        os.chmod(path, mode)
    finally:
        if os.path.exists(tmp_name):
            try:
                os.unlink(tmp_name)
            except OSError:
                pass


def _ensure_token() -> str:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(CONFIG_DIR, 0o700)
    if TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
        if token:
            return token
    token = secrets.token_urlsafe(48)
    _atomic_write(TOKEN_FILE, token + "\n", 0o600)
    return token


TOKEN = _ensure_token()


def _read_cookie_json() -> Dict[str, str]:
    if not COOKIE_JSON_FILE.exists():
        return {}
    try:
        raw = json.loads(COOKIE_JSON_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    cookies = raw.get("cookies", raw) if isinstance(raw, dict) else {}
    if not isinstance(cookies, dict):
        return {}
    return {k: v for k, v in cookies.items() if k in ALLOWED_COOKIE_KEYS and isinstance(v, str) and v}


def _render_env(cookies: Dict[str, str]) -> str:
    return "".join(f"{key}={cookies[key]}\n" for key in ALLOWED_COOKIE_KEYS if cookies.get(key))


def _write_status(cookies: Dict[str, str], changed: bool) -> None:
    status = {
        "service": "opengrok-cookie-helper",
        "updatedAt": _utc_now(),
        "changed": changed,
        "cookies": {
            key: {
                "present": bool(cookies.get(key)),
                "sha256Prefix": hashlib.sha256(cookies[key].encode()).hexdigest()[:12] if cookies.get(key) else None,
            }
            for key in ALLOWED_COOKIE_KEYS
        },
    }
    _atomic_write(STATUS_FILE, json.dumps(status, indent=2) + "\n", 0o600)


def update_cookies(incoming: Dict[str, str]) -> bool:
    with _state_lock:
        existing = _read_cookie_json()
        merged = dict(existing)
        for key, value in incoming.items():
            if key not in ALLOWED_COOKIE_KEYS:
                raise ValueError(f"unsupported cookie key: {key}")
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"cookie {key} is empty")
            if any(ch in value for ch in ("\r", "\n", "\x00")):
                raise ValueError(f"cookie {key} contains forbidden control characters")
            if len(value) > 65536:
                raise ValueError(f"cookie {key} is too large")
            merged[key] = value.strip()

        changed = json.dumps(existing, sort_keys=True) != json.dumps(merged, sort_keys=True)
        payload = {"updatedAt": _utc_now(), "cookies": merged}
        _atomic_write(COOKIE_JSON_FILE, json.dumps(payload, indent=2, ensure_ascii=False) + "\n", 0o600)
        _atomic_write(ENV_FILE, _render_env(merged), 0o600)

        COOKIE_DIR.mkdir(parents=True, exist_ok=True)
        os.chmod(COOKIE_DIR, 0o700)
        for key, filename in ALLOWED_COOKIE_KEYS.items():
            if merged.get(key):
                _atomic_write(COOKIE_DIR / filename, merged[key] + "\n", 0o600)
        _write_status(merged, changed)
        return changed


def _read_status() -> dict:
    if STATUS_FILE.exists():
        try:
            status = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
            if isinstance(status, dict):
                return status
        except (OSError, json.JSONDecodeError):
            pass
    cookies = _read_cookie_json()
    return {
        "service": "opengrok-cookie-helper",
        "updatedAt": None,
        "changed": False,
        "cookies": {key: {"present": bool(cookies.get(key))} for key in ALLOWED_COOKIE_KEYS},
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "OpenGrokCookieHelper/2.0"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[cookie-helper] {self.client_address[0]} {fmt % args}", flush=True)

    def _cors(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin.startswith("chrome-extension://"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-OpenGrok-Sync-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, status: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/health":
            status = _read_status()
            status["ok"] = True
            self._json(200, status)
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/update":
            self._json(404, {"ok": False, "error": "not found"})
            return
        supplied = self.headers.get("X-OpenGrok-Sync-Token", "")
        if not supplied or not hmac.compare_digest(supplied, TOKEN):
            self._json(403, {"ok": False, "error": "invalid token"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 256 * 1024:
                raise ValueError("invalid content length")
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            cookies = data.get("cookies")
            if not isinstance(cookies, dict) or not cookies:
                raise ValueError("cookies must be a non-empty object")
            cleaned = {k: v for k, v in cookies.items() if k in ALLOWED_COOKIE_KEYS and isinstance(v, str) and v.strip()}
            if not cleaned:
                raise ValueError("no supported non-empty cookies in request")
            changed = update_cookies(cleaned)
            self._json(200, {"ok": True, "changed": changed, "updatedKeys": sorted(cleaned)})
        except Exception as exc:
            self._json(400, {"ok": False, "error": str(exc)})


def main() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(CONFIG_DIR, 0o700)
    print(f"OpenGrok Cookie Helper listening on http://{HOST}:{PORT}", flush=True)
    print(f"Config directory: {CONFIG_DIR}", flush=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
