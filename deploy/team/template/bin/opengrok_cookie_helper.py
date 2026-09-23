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
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict
from urllib.parse import urlparse

HOST = os.environ.get("OPENGROK_COOKIE_HELPER_HOST", "127.0.0.1")
PORT = int(os.environ.get("OPENGROK_COOKIE_HELPER_PORT", "8765"))
CONFIG_DIR = Path(os.environ.get("OPENGROK_MCP_CONFIG_DIR", str(Path.home() / ".config" / "opengrok-mcp"))).expanduser()
ENV_FILE = CONFIG_DIR / "opengrok.env"
COOKIE_JSON_FILE = CONFIG_DIR / "cookies.json"
COOKIE_DIR = CONFIG_DIR / "cookies"
TOKEN_FILE = CONFIG_DIR / "helper.token"
STATUS_FILE = CONFIG_DIR / "helper-status.json"
CONNECTIONS_FILE = CONFIG_DIR / "connections.json"

_state_lock = threading.Lock()


def _targets() -> list[dict]:
    with CONNECTIONS_FILE.open(encoding="utf-8") as handle:
        connections = json.load(handle).get("connections")
    if not isinstance(connections, dict) or not connections:
        raise ValueError("connections.json has no active connections")
    targets = []
    for name, connection in connections.items():
        if not isinstance(connection, dict):
            raise ValueError(f"invalid connection: {name}")
        url = connection.get("url")
        cookie_env = connection.get("cookieEnv")
        parsed = urlparse(url) if isinstance(url, str) else None
        if (not parsed or parsed.scheme not in ("http", "https") or not parsed.hostname
                or parsed.username or parsed.password or parsed.fragment):
            raise ValueError(f"invalid URL for {name}")
        if not isinstance(cookie_env, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]*", cookie_env):
            raise ValueError(f"invalid cookieEnv for {name}")
        targets.append({"name": name, "url": url, "cookieEnv": cookie_env})
    return targets


def _allowed_cookie_keys() -> dict[str, str]:
    return {target["cookieEnv"]: target["cookieEnv"].lower().replace("_", "-") + ".cookie"
            for target in _targets()}


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
    allowed = _allowed_cookie_keys()
    return {k: v for k, v in cookies.items() if k in allowed and isinstance(v, str) and v}


def _render_env(cookies: Dict[str, str]) -> str:
    return "".join(f"{key}={cookies[key]}\n" for key in _allowed_cookie_keys() if cookies.get(key))


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
            for key in _allowed_cookie_keys()
        },
    }
    _atomic_write(STATUS_FILE, json.dumps(status, indent=2) + "\n", 0o600)


def update_cookies(incoming: Dict[str, str]) -> bool:
    with _state_lock:
        allowed = _allowed_cookie_keys()
        existing = _read_cookie_json()
        merged = dict(existing)
        for key, value in incoming.items():
            if key not in allowed:
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
        for key, filename in allowed.items():
            if merged.get(key):
                _atomic_write(COOKIE_DIR / filename, merged[key] + "\n", 0o600)
        _write_status(merged, changed)
        return changed


def _read_status() -> dict:
    status = {}
    if STATUS_FILE.exists():
        try:
            stored = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
            if isinstance(stored, dict):
                status = stored
        except (OSError, json.JSONDecodeError):
            pass
    cookies = _read_cookie_json()
    return {
        "service": "opengrok-cookie-helper",
        "updatedAt": status.get("updatedAt"),
        "changed": status.get("changed", False),
        "cookies": {
            key: {
                "present": bool(cookies.get(key)),
                "sha256Prefix": hashlib.sha256(cookies[key].encode()).hexdigest()[:12] if cookies.get(key) else None,
            }
            for key in _allowed_cookie_keys()
        },
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
        if self.path == "/targets":
            supplied = self.headers.get("X-OpenGrok-Sync-Token", "")
            if not supplied or not hmac.compare_digest(supplied, TOKEN):
                self._json(403, {"ok": False, "error": "invalid token"})
                return
            try:
                self._json(200, {"ok": True, "targets": _targets()})
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                self._json(400, {"ok": False, "error": str(exc)})
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
            allowed = _allowed_cookie_keys()
            if any(k not in allowed for k in cookies):
                raise ValueError("request contains an unsupported cookie key")
            cleaned = {k: v for k, v in cookies.items() if isinstance(v, str) and v.strip()}
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
