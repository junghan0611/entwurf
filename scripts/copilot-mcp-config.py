#!/usr/bin/env python3
"""Stateful Copilot MCP-config adapter; stdlib only.

Owns ONE server key (``entwurf-bridge``) inside ``~/.copilot/mcp-config.json``.
The file wrapper is always ``mcpServers``. The stdio entry follows Copilot CLI's
writer, not the API wire schema: ``{type:"local", command, args?}``.
Adopts regular files, refuses symlinks, records first-install preimages.
"""

import datetime
import json
import os
import sys
import tempfile

STATE_SCHEMA_VERSION = 1
SERVER_KEY = "entwurf-bridge"
ENTRY_TYPE = "local"


def die(code: int, message: str) -> "None":
    sys.stderr.write(message.rstrip("\n") + "\n")
    raise SystemExit(code)


def load_object(path: str, label: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read()
    except OSError as error:
        die(4, f"copilot-mcp: cannot read {label} {path}: {error}")
    if not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        die(4, f"copilot-mcp: {label} {path} is not valid JSON: {error}")
    if not isinstance(value, dict):
        die(4, f"copilot-mcp: {label} {path} top-level must be a JSON object")
    return value


def atomic_write(path: str, value: dict) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=directory, prefix=".copilot-mcp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def our_entry(command: str) -> dict:
    # CLI `copilot mcp add` writes type:"local" (not "stdio") plus command/args.
    # args is present and empty so the inverse has a stable shape; env/timeout/tools stay omitted.
    return {"type": ENTRY_TYPE, "command": command, "args": []}


def checked_state(state_path: str) -> dict:
    state = load_object(state_path, "install-state")
    required = (
        "managedConfigPath",
        "serverKey",
        "command",
        "detectMode",
        "configExistedBefore",
        "preimage",
    )
    if state.get("schemaVersion") != STATE_SCHEMA_VERSION or any(key not in state for key in required):
        die(4, f"copilot-mcp: install-state {state_path} has an unsupported shape")
    if state.get("serverKey") != SERVER_KEY:
        die(4, f"copilot-mcp: install-state {state_path} serverKey is not {SERVER_KEY}")
    return state


def prior_state(state_path: str, config_path: str) -> dict | None:
    if not os.path.exists(state_path):
        return None
    state = checked_state(state_path)
    return state if state["managedConfigPath"] == os.path.abspath(config_path) else None


def install(config_path: str, command: str, state_path: str) -> None:
    if os.path.islink(config_path):
        die(3, f"copilot-mcp: refusing to adopt {config_path} — symlink to {os.readlink(config_path)} (someone else's SSOT)")

    existed = os.path.exists(config_path)
    data = load_object(config_path, "config") if existed else {}
    servers = data.get("mcpServers")
    if servers is None:
        servers = {}
        data["mcpServers"] = servers
    if not isinstance(servers, dict):
        die(4, f"copilot-mcp: {config_path} mcpServers must be a JSON object")

    prior = prior_state(state_path, config_path)
    if prior is None:
        state = {
            "schemaVersion": STATE_SCHEMA_VERSION,
            "managedConfigPath": os.path.abspath(config_path),
            "serverKey": SERVER_KEY,
            "command": command,
            "detectMode": "adopt-regular-file" if existed else "created-new",
            "configExistedBefore": existed,
            "preimage": servers.get(SERVER_KEY),
            "installedAt": now(),
        }
    else:
        state = prior

    servers[SERVER_KEY] = our_entry(command)
    atomic_write(config_path, data)
    atomic_write(state_path, state)
    sys.stdout.write(f"{state['detectMode']} {os.path.abspath(config_path)}\n")


def uninstall(state_path: str) -> None:
    if not os.path.exists(state_path):
        die(2, f"copilot-mcp: no install-state at {state_path} — nothing to undo")
    state = checked_state(state_path)
    config_path = state.get("managedConfigPath")
    if not isinstance(config_path, str) or not os.path.isabs(config_path):
        die(4, f"copilot-mcp: install-state {state_path} has no absolute managedConfigPath")
    if os.path.islink(config_path):
        die(3, f"copilot-mcp: refusing to uninstall — {config_path} became a symlink (someone else's SSOT)")

    if os.path.exists(config_path):
        data = load_object(config_path, "config")
        servers = data.get("mcpServers")
        if isinstance(servers, dict):
            preimage = state.get("preimage")
            if preimage is None:
                servers.pop(SERVER_KEY, None)
            else:
                servers[SERVER_KEY] = preimage
            created = state.get("detectMode") == "created-new" and state.get("configExistedBefore") is False
            only_ours = created and len(servers) == 0 and set(data.keys()) == {"mcpServers"}
            if only_ours:
                os.remove(config_path)
            else:
                atomic_write(config_path, data)

    os.remove(state_path)
    sys.stdout.write(f"uninstalled {config_path}\n")


def _doctor_invocation(config_path: str, command: str):
    if os.path.islink(config_path):
        return "symlink", None
    if not os.path.exists(config_path):
        return "file-absent", None
    try:
        data = load_object(config_path, "config")
    except SystemExit:
        return "invalid-json", None
    servers = data.get("mcpServers")
    if not isinstance(servers, dict) or SERVER_KEY not in servers:
        return "not-ours", None
    server = servers.get(SERVER_KEY)
    if not isinstance(server, dict):
        return "invalid-entry", None
    found = server.get("command")
    args = server.get("args", [])
    env = server.get("env", {})
    if server.get("type") != ENTRY_TYPE:
        return "invalid-entry", None
    if not isinstance(found, str) or not found:
        return "invalid-entry", None
    if found != command:
        return "not-ours", None
    if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
        return "invalid-entry", None
    if not isinstance(env, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in env.items()):
        return "invalid-entry", None
    return "configured", {"command": found, "args": args, "env": env}


def doctor_static(config_path: str, command: str) -> None:
    status, invocation = _doctor_invocation(config_path, command)
    if status != "configured":
        sys.stdout.write(f"{status}\n")
        return
    sys.stdout.write(f"configured {invocation['command']}\n")


def doctor_invocation(config_path: str, command: str) -> None:
    status, invocation = _doctor_invocation(config_path, command)
    if status != "configured":
        die(4, f"copilot-mcp: cannot read configured invocation from {config_path}: {status}")
    sys.stdout.write(json.dumps(invocation, separators=(",", ":")) + "\n")


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        die(5, "usage: copilot-mcp-config.py <install|uninstall|doctor-static|doctor-invocation> ...")
    match argv[1]:
        case "install" if len(argv) == 5:
            install(argv[2], argv[3], argv[4])
        case "uninstall" if len(argv) == 3:
            uninstall(argv[2])
        case "doctor-static" if len(argv) == 4:
            doctor_static(argv[2], argv[3])
        case "doctor-invocation" if len(argv) == 4:
            doctor_invocation(argv[2], argv[3])
        case _:
            die(5, "usage: copilot-mcp-config.py <install config command state|uninstall state|doctor-static config command|doctor-invocation config command>")


if __name__ == "__main__":
    main(sys.argv)
