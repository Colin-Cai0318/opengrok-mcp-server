#!/usr/bin/env python3
"""Enable or disable installed OpenGrok connections from the local catalog."""
import json
import os
import sys
import tempfile
from pathlib import Path


config_dir = Path(os.environ.get("OPENGROK_MCP_CONFIG_DIR", str(Path.home() / ".config/opengrok-mcp")))
active_file = config_dir / "connections.json"
catalog_file = config_dir / "connections.catalog.json"


def read_connections(path):
    with path.open(encoding="utf-8") as handle:
        connections = json.load(handle).get("connections")
    if not isinstance(connections, dict):
        raise ValueError(f"{path} must contain a connections object")
    return connections


def select(pattern, catalog):
    if pattern == "all":
        return [name for name in catalog if not name.startswith("lx-")]
    if pattern in catalog:
        return [pattern]
    matching = [name for name in catalog if name.startswith(pattern + "-")]
    if not matching:
        raise ValueError(f"Unknown connection or location: {pattern}")
    return matching


def atomic_write(path, content):
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=config_dir, text=True)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def main():
    if len(sys.argv) not in (2, 3) or sys.argv[1] not in ("list", "add", "remove"):
        raise ValueError("Usage: manage-opengrok-connections.py list | add <name|location|all> | remove <name|location|all>")
    action = sys.argv[1]
    if (action == "list") != (len(sys.argv) == 2):
        raise ValueError("list takes no target; add and remove require a target")
    catalog = read_connections(catalog_file)
    active = read_connections(active_file)
    if action == "list":
        for name in catalog:
            print(f"{'enabled ' if name in active else 'available'}  {name}")
        return
    names = select(sys.argv[2], catalog)
    if action == "add":
        for name in names:
            active[name] = catalog[name]
    else:
        if any(name.startswith("lx-") for name in names):
            raise ValueError("LX connections are the default set and cannot be removed")
        for name in names:
            active.pop(name, None)
    if len(active) < 2:
        raise ValueError("At least two connections must remain enabled")
    retained = None
    if action == "remove":
        cookie_file = config_dir / "cookies.json"
        if cookie_file.exists():
            state = json.loads(cookie_file.read_text(encoding="utf-8"))
            if not isinstance(state, dict):
                raise ValueError("cookies.json must contain an object")
            cookies = state.get("cookies", state)
            if not isinstance(cookies, dict):
                raise ValueError("cookies.json must contain a cookies object")
            allowed = {connection.get("cookieEnv") for connection in active.values()}
            retained = {key: value for key, value in cookies.items() if key in allowed}
    atomic_write(active_file, json.dumps({"connections": active}, ensure_ascii=False, indent=2) + "\n")
    if action == "remove":
        if retained is not None:
            atomic_write(cookie_file, json.dumps({"updatedAt": state.get("updatedAt"), "cookies": retained}, ensure_ascii=False, indent=2) + "\n")
            atomic_write(config_dir / "opengrok.env", "".join(f"{key}={value}\n" for key, value in retained.items()))
        for name in names:
            cookie_env = catalog[name].get("cookieEnv", "")
            if cookie_env and cookie_env not in {connection.get("cookieEnv") for connection in active.values()}:
                (config_dir / "cookies" / (cookie_env.lower().replace("_", "-") + ".cookie")).unlink(missing_ok=True)
    print(f"{action}: {', '.join(names)}")
    print("Open the Chrome extension to grant site access and sync cookies, then restart the MCP server.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Connection update failed: {error}", file=sys.stderr)
        sys.exit(1)
