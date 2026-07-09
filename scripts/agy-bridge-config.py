#!/usr/bin/env python3
"""agy-bridge-config — the JSON state operations for the agy (Antigravity) MCP install
adapter (봉인 7). SEPARATE from the Claude marketplace install (no generalization); only
the reporting/runner is shared, in agy-bridge.sh. stdlib only.

Subcommands (argv[1]):
  install   <config_path> <command> <state_path>
      Adopt an agy mcp_config.json and register ONE server entry (serverKey
      "entwurf-bridge") pointing at <command> (a STABLE bin — never a repo/git hash path).
      REFUSES a symlink target (exit 3 — it is someone else's SSOT, e.g. an agent-config
      link; clobbering it would write into that repo). A regular file is adopted (the prior
      value of the key is captured as the preimage for an honest inverse); an absent file is
      created. Invalid JSON fails loud (exit 4). Writes install-state atomically to
      <state_path> (checkout-outside XDG path — the caller resolves it).

  uninstall <state_path>
      Honest inverse from install-state: restore the captured preimage (remove the key if it
      was absent, else set it back). If WE created the whole file and it now carries nothing
      else, remove the file. REFUSES if the managed config became a symlink since install
      (exit 3). No state → nothing to do (exit 2).

  clean-legacy <config_path>
      One-way MIGRATION cleanup: remove OUR server key from a LEGACY (wrong-root) config that
      live agy does NOT read as the global MCP config (the doc-correct global is
      ~/.gemini/config/mcp_config.json; the antigravity-cli copy was a mis-wiring). Idempotent.
      Preserves unrelated servers. Removes the file only if it becomes an empty mcpServers-only
      object. REFUSES to touch a symlink (someone else's SSOT) — reports skip, never clobbers.
      This is NOT tracked for an honest inverse: the legacy entry was wrong and stays gone.

  doctor-static <config_path>
      Print one line describing the candidate for the shell doctor: `absent` / `symlink ->
      <target>` prefix / `invalid-json` / `not-configured` / `command <cmd>`. Never mutates.

Exit codes: 0 ok · 2 no-state · 3 refuse-symlink · 4 invalid-json · 5 usage.
"""

import json
import os
import sys

SERVER_KEY = "entwurf-bridge"
STATE_SCHEMA_VERSION = 1


def _die(code: int, msg: str) -> "None":
    sys.stderr.write(msg.rstrip("\n") + "\n")
    sys.exit(code)


def _atomic_write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def _load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read()
    if raw.strip() == "":
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        _die(4, f"agy-bridge: {path} is not valid JSON: {err}")
    if not isinstance(data, dict):
        _die(4, f"agy-bridge: {path} top-level must be a JSON object")
    return data


def _dump(data: dict) -> str:
    return json.dumps(data, indent=2) + "\n"


def cmd_install(config_path: str, command: str, state_path: str) -> None:
    # REFUSE a symlink — it is someone else's SSOT (an agent-config link). Never clobber.
    if os.path.islink(config_path):
        target = os.readlink(config_path)
        _die(3, f"agy-bridge: refusing to adopt {config_path} — it is a symlink to {target} (someone else's SSOT). "
                f"Manage it there, or replace it with a regular file, then retry.")

    config_existed = os.path.exists(config_path)
    if config_existed:
        data = _load_config(config_path)
        detect_mode = "adopt-regular-file"
    else:
        data = {}
        detect_mode = "created-new"

    servers = data.get("mcpServers")
    if servers is None:
        servers = {}
        data["mcpServers"] = servers
    if not isinstance(servers, dict):
        _die(4, f"agy-bridge: {config_path} mcpServers must be a JSON object")

    # Capture the preimage of OUR key (None = the key was absent) for the honest inverse.
    preimage = servers.get(SERVER_KEY, None)
    servers[SERVER_KEY] = {"command": command, "args": []}

    _atomic_write(config_path, _dump(data))

    state = {
        "schemaVersion": STATE_SCHEMA_VERSION,
        "managedConfigPath": os.path.abspath(config_path),
        "serverKey": SERVER_KEY,
        "command": command,
        "detectMode": detect_mode,
        "configExistedBefore": config_existed,
        "preimage": preimage,  # null = key was absent before install
        "installedAt": _now(),
    }
    _atomic_write(state_path, _dump(state))
    sys.stdout.write(f"{detect_mode} {os.path.abspath(config_path)}\n")


def cmd_uninstall(state_path: str) -> None:
    if not os.path.exists(state_path):
        _die(2, f"agy-bridge: no install-state at {state_path} — nothing to uninstall "
                f"(never installed, or already uninstalled).")
    state = _load_config(state_path)
    config_path = state.get("managedConfigPath")
    if not isinstance(config_path, str):
        _die(4, f"agy-bridge: install-state {state_path} has no managedConfigPath")

    if os.path.islink(config_path):
        _die(3, f"agy-bridge: refusing to uninstall — {config_path} became a symlink since install "
                f"(someone else's SSOT now). Resolve by hand.")

    if os.path.exists(config_path):
        data = _load_config(config_path)
        servers = data.get("mcpServers")
        if isinstance(servers, dict):
            preimage = state.get("preimage", None)
            if preimage is None:
                servers.pop(SERVER_KEY, None)
            else:
                servers[SERVER_KEY] = preimage
            # If WE created the whole file and nothing else remains, remove it (honest inverse).
            created_new = state.get("detectMode") == "created-new" and state.get("configExistedBefore") is False
            only_our_empty = created_new and len(servers) == 0 and set(data.keys()) == {"mcpServers"}
            if only_our_empty:
                os.remove(config_path)
            else:
                _atomic_write(config_path, _dump(data))

    os.remove(state_path)
    sys.stdout.write(f"uninstalled {config_path}\n")


def cmd_clean_legacy(config_path: str) -> None:
    # Symlink = someone else's SSOT (e.g. an agent-config link). Never clobber; report + skip.
    if os.path.islink(config_path):
        sys.stdout.write(f"skip-symlink {config_path}\n")
        return
    if not os.path.exists(config_path):
        sys.stdout.write(f"absent {config_path}\n")
        return
    data = _load_config(config_path)
    servers = data.get("mcpServers")
    if not isinstance(servers, dict) or SERVER_KEY not in servers:
        sys.stdout.write(f"not-present {config_path}\n")
        return
    servers.pop(SERVER_KEY, None)
    # Remove the file only if nothing else remains and it was a pure mcpServers object (ours to
    # tidy). Otherwise rewrite it, preserving unrelated servers / top-level keys.
    if len(servers) == 0 and set(data.keys()) == {"mcpServers"}:
        os.remove(config_path)
        sys.stdout.write(f"cleaned-removed {config_path}\n")
    else:
        _atomic_write(config_path, _dump(data))
        sys.stdout.write(f"cleaned-kept {config_path}\n")


def cmd_doctor_static(config_path: str) -> None:
    # Report the RESOLVED path's config status in one shell-parseable token line. Symlink
    # detection/reporting is the shell's job (realpath here just follows any link).
    real = os.path.realpath(config_path)
    if not os.path.exists(real):
        sys.stdout.write("absent\n")
        return
    try:
        with open(real, "r", encoding="utf-8") as fh:
            data = json.loads(fh.read() or "{}")
    except (json.JSONDecodeError, OSError):
        sys.stdout.write("invalid-json\n")
        return
    server = (data.get("mcpServers") or {}).get(SERVER_KEY) if isinstance(data, dict) else None
    if not isinstance(server, dict) or not server.get("command"):
        sys.stdout.write("not-configured\n")
        return
    # "configured <command>" — command is the trailing token(s); shell takes field 2..N.
    sys.stdout.write(f"configured {server['command']}\n")


def _now() -> str:
    import datetime

    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main(argv: list) -> None:
    if len(argv) < 2:
        _die(5, "usage: agy-bridge-config.py <install|uninstall|doctor-static> ...")
    sub = argv[1]
    if sub == "install":
        if len(argv) != 5:
            _die(5, "usage: agy-bridge-config.py install <config_path> <command> <state_path>")
        cmd_install(argv[2], argv[3], argv[4])
    elif sub == "uninstall":
        if len(argv) != 3:
            _die(5, "usage: agy-bridge-config.py uninstall <state_path>")
        cmd_uninstall(argv[2])
    elif sub == "clean-legacy":
        if len(argv) != 3:
            _die(5, "usage: agy-bridge-config.py clean-legacy <config_path>")
        cmd_clean_legacy(argv[2])
    elif sub == "doctor-static":
        if len(argv) != 3:
            _die(5, "usage: agy-bridge-config.py doctor-static <config_path>")
        cmd_doctor_static(argv[2])
    else:
        _die(5, f"agy-bridge-config.py: unknown subcommand {sub!r}")


if __name__ == "__main__":
    main(sys.argv)
