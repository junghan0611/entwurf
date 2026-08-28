#!/usr/bin/env python3
"""Stateful OMP-native MCP-config adapter; stdlib only (#87 step 5).

Owns ONE server key inside the omp-native user MCP file (``<agent dir>/mcp.json``).
The file wrapper is always ``mcpServers`` and the stdio entry follows omp's OWN writer
layer — ``{command, args?, env?}`` with ``type`` omitted (stdio is the default) —
measured at ``mcp/config-writer.ts:111-143`` + ``config/mcp-schema.json`` on v18.0.0.

THE SERVER KEY IS A PINNED LITERAL, AND THAT IS THE WHOLE MECHANISM. omp already
translates Claude Code's ``~/.claude.json`` as an IMPORT provider, so on a host that ever
used Claude Code there is already an ``entwurf-bridge`` server — carrying Claude Code's
external agent id. This writer does not remove it, hide it, or ask the operator to: it
shadows it, and same-key first-wins is how. Provider priorities are native=100 >
omp-plugins=90 > claude=80 (``capability/index.ts:84-91``), dedupe is first-wins on
``key: server => server.name`` (``:183``), and on a key hit ``equivalent()`` is NEVER
consulted (``:203-207``) — so an entry whose env deliberately differs still suppresses the
import completely. A DIFFERENT key would load BOTH: two bridge tool families, one of them
still introducing this session as Claude Code.

``disabledServers`` IS NOT THE HIDE-IMPORT TOOL. Suppression is by NAME
(``mcp/config.ts:123-127``) and a suppressed item still claims the dedupe key
(``capability/index.ts:191-196``), so denylisting ``entwurf-bridge`` kills the native entry
and the import together. This adapter never writes that key, and the doctor goes red when
somebody else has.
"""

import datetime
import json
import os
import sys
import tempfile

STATE_SCHEMA_VERSION = 1

# PINNED. The literal `mcpServers` map key the Claude import also uses — measured LIVE on
# oracle 2026-08-27 (`/mcp list` → "Claude Code (~/.claude.json): entwurf-bridge") and in
# source (`discovery/claude.ts:88-92` assigns the plain object key with no prefix). Changing
# this string does not rename our entry; it un-shadows the import.
SERVER_KEY = "entwurf-bridge"

# The provenance label this whole surface exists to fix: an omp session riding the import
# introduces itself to the bridge as Claude Code.
EXTERNAL_AGENT_ID = "external-mcp/omp"
ENV_KEY = "ENTWURF_BRIDGE_EXTERNAL_AGENT_ID"

SCHEMA_URL = "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json"


def die(code: int, message: str) -> "None":
    sys.stderr.write(message.rstrip("\n") + "\n")
    raise SystemExit(code)


def load_object(path: str, label: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read()
    except OSError as error:
        die(4, f"omp-mcp: cannot read {label} {path}: {error}")
    if not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        die(4, f"omp-mcp: {label} {path} is not valid JSON: {error}")
    if not isinstance(value, dict):
        die(4, f"omp-mcp: {label} {path} top-level must be a JSON object")
    return value


def atomic_write(path: str, value: dict) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=directory, prefix=".omp-mcp-", suffix=".json")
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


def our_entry(command: str, args: list) -> dict:
    # `type` is omitted on purpose: stdio is the default in omp's own schema, and the
    # vendor's writer omits it too. `env` carries the one fact that makes this entry worth
    # writing at all — the omp provenance label.
    return {"command": command, "args": args, "env": {ENV_KEY: EXTERNAL_AGENT_ID}}


def checked_state(state_path: str) -> dict:
    state = load_object(state_path, "install-state")
    required = (
        "managedConfigPath",
        "serverKey",
        "command",
        "args",
        "detectMode",
        "configExistedBefore",
        "preimage",
    )
    if state.get("schemaVersion") != STATE_SCHEMA_VERSION or any(key not in state for key in required):
        die(4, f"omp-mcp: install-state {state_path} has an unsupported shape")
    if state.get("serverKey") != SERVER_KEY:
        die(4, f"omp-mcp: install-state {state_path} serverKey is not {SERVER_KEY}")
    return state


def prior_state(state_path: str, config_path: str) -> dict | None:
    """The ownership state for THIS target, or a refusal.

    A state that names a DIFFERENT config is not "no state" (#87 D1). Treating it as
    absent captured a fresh preimage and overwrote the single state file, stranding the
    previous profile's managed entry with no inverse left to remove it. There is one
    state and one target: changing the target is uninstall-then-install, in that order.
    """
    if not os.path.exists(state_path):
        return None
    state = checked_state(state_path)
    if state["managedConfigPath"] != os.path.abspath(config_path):
        die(
            3,
            f"omp-mcp: install-state {state_path} already manages {state['managedConfigPath']}, "
            f"but this host now reads {os.path.abspath(config_path)}. One state owns one target: "
            "overwriting it would strand the first entry with no inverse. Run uninstall-omp-mcp with "
            "the ORIGINAL omp agent dir / profile selected, then install here.",
        )
    return state


def disabled_names(data: dict) -> list:
    value = data.get("disabledServers")
    return [name for name in value if isinstance(name, str)] if isinstance(value, list) else []


def install(config_path: str, command: str, args_json: str, state_path: str) -> None:
    if os.path.islink(config_path):
        die(3, f"omp-mcp: refusing to adopt {config_path} — symlink to {os.readlink(config_path)} (someone else's SSOT)")
    try:
        args = json.loads(args_json)
    except json.JSONDecodeError as error:
        die(5, f"omp-mcp: args must be a JSON array: {error}")
    if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
        die(5, "omp-mcp: args must be a JSON array of strings")

    existed = os.path.exists(config_path)
    data = load_object(config_path, "config") if existed else {"$schema": SCHEMA_URL}
    servers = data.get("mcpServers")
    if servers is None:
        servers = {}
        data["mcpServers"] = servers
    if not isinstance(servers, dict):
        die(4, f"omp-mcp: {config_path} mcpServers must be a JSON object")

    # A pre-existing denylist on OUR key would suppress the entry we are about to write —
    # and the import with it. Refuse rather than write a server nothing will ever load.
    if SERVER_KEY in disabled_names(data):
        die(
            3,
            f"omp-mcp: {config_path} lists {SERVER_KEY!r} in disabledServers. Suppression is by NAME "
            "(mcp/config.ts:123-127) and a suppressed item still claims the dedupe key "
            "(capability/index.ts:191-196), so this would kill BOTH the native entry and the Claude "
            "import. Remove that denylist entry first — it is never the way to hide an import.",
        )

    prior = prior_state(state_path, config_path)
    if prior is None:
        state = {
            "schemaVersion": STATE_SCHEMA_VERSION,
            "managedConfigPath": os.path.abspath(config_path),
            "serverKey": SERVER_KEY,
            "command": command,
            "args": args,
            "detectMode": "adopt-regular-file" if existed else "created-new",
            "configExistedBefore": existed,
            # THE PREIMAGE IS THE CURRENT VALUE ON DISK, even when it is byte-identical to
            # what we are about to write. Inventing a "there was nothing here before" case
            # for one backend is the special-casing the rail exists to prevent.
            "preimage": servers.get(SERVER_KEY),
            "installedAt": now(),
        }
    else:
        state = prior

    servers[SERVER_KEY] = our_entry(command, args)
    atomic_write(config_path, data)
    atomic_write(state_path, state)
    sys.stdout.write(f"{state['detectMode']} {os.path.abspath(config_path)}\n")


def uninstall(state_path: str) -> None:
    if not os.path.exists(state_path):
        die(2, f"omp-mcp: no install-state at {state_path} — nothing to undo")
    state = checked_state(state_path)
    config_path = state.get("managedConfigPath")
    if not isinstance(config_path, str) or not os.path.isabs(config_path):
        die(4, f"omp-mcp: install-state {state_path} has no absolute managedConfigPath")
    if os.path.islink(config_path):
        die(3, f"omp-mcp: refusing to uninstall — {config_path} became a symlink (someone else's SSOT)")

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
            # We created this file, and nothing but our own two keys is left in it. The
            # honest inverse of "created-new" is an absent file — a stub carrying only a
            # $schema line would be an artifact of ours surviving our own removal.
            only_ours = created and len(servers) == 0 and set(data.keys()) <= {"mcpServers", "$schema"}
            if only_ours:
                os.remove(config_path)
            else:
                atomic_write(config_path, data)

    os.remove(state_path)
    sys.stdout.write(f"uninstalled {config_path}\n")


def native_entry_state(servers: dict) -> str:
    """`absent` | `invalid` | `present` — STRUCTURAL validity of the entry under our key.

    Deliberately says nothing about ownership, about which command it names, or about
    provenance: those are other axes with other verdicts. This one answers only "would omp
    be able to load this at all", which is what makes an invalid entry red without an
    install-state (#87 B4).
    """
    if not isinstance(servers, dict) or SERVER_KEY not in servers:
        return "absent"
    server = servers.get(SERVER_KEY)
    if not isinstance(server, dict):
        return "invalid"
    if server.get("type") not in (None, "stdio"):
        return "invalid"
    command = server.get("command")
    if not isinstance(command, str) or not command:
        return "invalid"
    args = server.get("args", [])
    if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
        return "invalid"
    env = server.get("env", {})
    if not isinstance(env, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in env.items()):
        return "invalid"
    return "present"


def _doctor_invocation(config_path: str, command: str):
    if os.path.islink(config_path):
        return "symlink", None
    if not os.path.exists(config_path):
        return "file-absent", None
    try:
        data = load_object(config_path, "config")
    except SystemExit:
        return "invalid-json", None
    if SERVER_KEY in disabled_names(data):
        return "self-disabled", None
    servers = data.get("mcpServers") if isinstance(data.get("mcpServers"), dict) else {}
    # STRUCTURE first, through the one shared predicate — so "is this loadable at all" has
    # a single answer here and in doctor-shadow, and cannot drift into two.
    state = native_entry_state(servers)
    if state == "absent":
        return "not-ours", None
    if state == "invalid":
        return "invalid-entry", None
    server = servers[SERVER_KEY]
    found = server["command"]
    args = server.get("args", [])
    env = server.get("env", {})
    if found != command:
        return "not-ours", None
    # The provenance label is the reason this entry exists. An entry that boots but
    # introduces the session as some other harness is not our entry.
    if env.get(ENV_KEY) != EXTERNAL_AGENT_ID:
        return "foreign-provenance", None
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
        die(4, f"omp-mcp: cannot read configured invocation from {config_path}: {status}")
    sys.stdout.write(json.dumps(invocation, separators=(",", ":")) + "\n")


def doctor_shadow(config_path: str, *import_paths: str) -> None:
    """Is the EFFECTIVE `entwurf-bridge` this host's omp will load the native entry?

    This is a CONFIGURATION read, never a runtime receipt: it reports what omp's own
    precedence rules decide about the files on disk. The vendor's own `/mcp list` pane is
    the live oracle, and it is taken once as a LIVE receipt rather than re-derived here.

    Prints one line per fact, then a verdict line:
      native <present|invalid|absent>
      import <path> <key-present|key-absent|unreadable>
      disabled <yes|no>
      verdict <native-wins|native-invalid|import-wins|both-suppressed|no-entry>

    RUNTIME VALIDITY AND OWNERSHIP ARE SEPARATE AXES (Hard Rule 13, #87 B4). "The key is
    present" is not "the entry works": a null / non-object / malformed value under our key
    still claims the dedupe slot, so the import is suppressed AND nothing loads. Reporting
    that as `native-wins` turned a broken effective source into a PASS whenever no
    ownership state happened to exist. An invalid entry gets its own verdict, and it is red
    on the runtime axis whether or not entwurf owns anything here.
    """
    data = {}
    if os.path.exists(config_path) and not os.path.islink(config_path):
        try:
            data = load_object(config_path, "config")
        except SystemExit:
            data = {}
    servers = data.get("mcpServers") if isinstance(data.get("mcpServers"), dict) else {}
    native_state = native_entry_state(servers)
    sys.stdout.write(f"native {native_state}\n")

    import_hit = False
    for path in import_paths:
        expanded = os.path.expanduser(path)
        if not os.path.exists(expanded):
            continue
        try:
            imported = load_object(expanded, "imported config")
        except SystemExit:
            sys.stdout.write(f"import {expanded} unreadable\n")
            continue
        keys = imported.get("mcpServers")
        present = isinstance(keys, dict) and SERVER_KEY in keys
        import_hit = import_hit or present
        sys.stdout.write(f"import {expanded} {'key-present' if present else 'key-absent'}\n")

    disabled = SERVER_KEY in disabled_names(data)
    sys.stdout.write(f"disabled {'yes' if disabled else 'no'}\n")

    if disabled:
        verdict = "both-suppressed"
    elif native_state == "invalid":
        # It still claims the dedupe key, so the import is suppressed too — but nothing
        # loads. Never `native-wins`.
        verdict = "native-invalid"
    elif native_state == "present":
        verdict = "native-wins"
    elif import_hit:
        verdict = "import-wins"
    else:
        verdict = "no-entry"
    sys.stdout.write(f"verdict {verdict}\n")


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        die(5, "usage: omp-mcp-config.py <install|uninstall|doctor-static|doctor-invocation|doctor-shadow> ...")
    match argv[1]:
        case "install" if len(argv) == 6:
            install(argv[2], argv[3], argv[4], argv[5])
        case "uninstall" if len(argv) == 3:
            uninstall(argv[2])
        case "doctor-static" if len(argv) == 4:
            doctor_static(argv[2], argv[3])
        case "doctor-invocation" if len(argv) == 4:
            doctor_invocation(argv[2], argv[3])
        case "doctor-shadow" if len(argv) >= 3:
            doctor_shadow(argv[2], *argv[3:])
        case _:
            die(
                5,
                "usage: omp-mcp-config.py <install config command args-json state|uninstall state|"
                "doctor-static config command|doctor-invocation config command|doctor-shadow config [import...]>",
            )


if __name__ == "__main__":
    main(sys.argv)
