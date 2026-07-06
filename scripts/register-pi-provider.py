#!/usr/bin/env python3
"""register-pi-provider — own entwurfProvider.mcpServers.entwurf-bridge in a pi settings.json
(#46 Task 2). The provider analog of register-pi-package.py: user + project scope, same
predicate/idempotency, ONE shared SSOT. The owned keyset is the SINGLE key
`entwurfProvider.mcpServers.entwurf-bridge` (봉인계약 4); every sibling
(skillPlugins/appendSystemPrompt/showToolNotifications/other mcpServers) is preserved untouched.

The command written is ALWAYS the bare stable bin `entwurf-bridge` (dev AND installed — the repo
start.sh path lives only in the dev-bin symlink state, never in a settings file; #46 tripwire).

ownership classification of the EXISTING command (GPT caveat: an old managed repo path is NOT a
user value, so its inverse is key-removal, never a restore):
  absent          key not present                             → we create it
  managed-current command == entwurf-bridge                   → already ours (idempotent)
  managed-legacy  command is our old repo start.sh
                  (== <repo>/mcp/entwurf-bridge/start.sh, or endswith
                   /entwurf/mcp/entwurf-bridge/start.sh)       → normalize to the bare bin
  user-override   anything else                               → DO NOT overwrite, DO NOT own
                                                                (no state; doctor: unowned)

Scope asymmetry (봉인계약 4·6, REASONED — not the unfounded asymmetry dev-bin (B) rejected):
  user     ~/.pi/agent/settings.json — GLOBAL, durable,파급s to every cwd → install-state +
           honest inverse. absent/managed-* → remove OUR key on uninstall (a legacy repo path is
           NOT restored); user-override → no state taken, left untouched. A parent object emptied
           of our key is tidied; siblings kept.
  project  <repo>/.pi/settings.json — checkout-LOCAL, disposable, re-creatable, and `run.sh
           remove` already covers it → NO state. install normalizes the command; remove strips
           our-managed shapes (the bare bin AND the legacy repo path). project-scope state is a
           NAMED FOLLOW-UP (NEXT), deliberately out of this lane.

Subcommands:
  install <settings_path> <repo_dir> --scope <user|project> [--state <state_path>]
  remove  <settings_path> <repo_dir> --scope <user|project> [--state <state_path>]

Exit codes: 0 ok · 2 no-state · 3 refuse-symlink · 4 invalid-json · 5 usage.
"""

import json
import os
import sys

SERVER_KEY = "entwurf-bridge"
BARE_COMMAND = "entwurf-bridge"
STATE_SCHEMA_VERSION = 1

# Legacy-bundled MCP names prior installers wrote; the current cutover supersedes them. Pruned at
# install time (and project remove) ONLY when the command matches our bundled start.sh path, so a
# user-customized command is left alone. Mirrors run.sh's pre-Task-2 inline prune (no regression).
LEGACY_BUNDLED = {
    "session-bridge": "retracted in 0.4.14, issue #7",
    "pi-tools-bridge": "renamed to entwurf-bridge in 0.11 S2 cutover",
}


def _prune_legacy(servers: dict, repo_dir: str) -> None:
    for name, reason in LEGACY_BUNDLED.items():
        existing = servers.get(name)
        if not isinstance(existing, dict):
            continue
        cmd = existing.get("command")
        if not isinstance(cmd, str):
            continue
        if cmd == f"{repo_dir}/mcp/{name}/start.sh" or cmd.endswith(f"/entwurf/mcp/{name}/start.sh"):
            del servers[name]
            sys.stdout.write(f"pruned legacy entwurfProvider.mcpServers.{name} ({reason})\n")


def _die(code: int, msg: str) -> "None":
    sys.stderr.write(msg.rstrip("\n") + "\n")
    sys.exit(code)


def _atomic_write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def _load(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read()
    if raw.strip() == "":
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        _die(4, f"register-pi-provider: {path} is not valid JSON: {err}")
    if not isinstance(data, dict):
        _die(4, f"register-pi-provider: {path} top-level must be a JSON object")
    return data


def _dump(data: dict) -> str:
    return json.dumps(data, indent=2) + "\n"


def _now() -> str:
    import datetime

    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _classify(existing_cmd, repo_dir: str) -> str:
    if existing_cmd is None:
        return "absent"
    if existing_cmd == BARE_COMMAND:
        return "managed-current"
    if isinstance(existing_cmd, str) and (
        existing_cmd == f"{repo_dir}/mcp/{SERVER_KEY}/start.sh"
        or existing_cmd.endswith(f"/entwurf/mcp/{SERVER_KEY}/start.sh")
    ):
        return "managed-legacy"
    return "user-override"


def _provider_servers(data: dict, create: bool):
    """Return (provider, servers) dicts. When create, setdefault them; else may be None."""
    if create:
        provider = data.setdefault("entwurfProvider", {})
        if not isinstance(provider, dict):
            _die(4, "register-pi-provider: entwurfProvider is not an object")
        servers = provider.setdefault("mcpServers", {})
        if not isinstance(servers, dict):
            _die(4, "register-pi-provider: entwurfProvider.mcpServers is not an object")
        return provider, servers
    provider = data.get("entwurfProvider")
    if not isinstance(provider, dict):
        return None, None
    servers = provider.get("mcpServers")
    if not isinstance(servers, dict):
        return provider, None
    return provider, servers


def cmd_install(settings_path: str, repo_dir: str, scope: str, state_path: str) -> None:
    if os.path.islink(settings_path):
        target = os.readlink(settings_path)
        _die(3, f"register-pi-provider: refusing to adopt {settings_path} — it is a symlink to {target} "
                f"(someone else's SSOT). Manage it there, or replace it with a regular file, then retry.")

    data = _load(settings_path) if os.path.exists(settings_path) else {}
    provider, servers = _provider_servers(data, create=True)
    _prune_legacy(servers, repo_dir)   # independent of entwurf-bridge ownership
    existing = servers.get(SERVER_KEY)
    existing_cmd = existing.get("command") if isinstance(existing, dict) else existing
    ownership = _classify(existing_cmd, repo_dir)

    if ownership == "user-override":
        # DO NOT overwrite our key, DO NOT own it (no state). doctor reports it as unowned. Still
        # persist so any legacy prune above (and a materialized parent) is written.
        sys.stdout.write(
            f"install: preserved entwurfProvider.mcpServers.{SERVER_KEY} (user override, NOT owned: {existing_cmd!r})\n"
        )
        _atomic_write(settings_path, _dump(data))
        return

    # absent / managed-current / managed-legacy → normalize to the bare stable bin.
    newval = {"command": BARE_COMMAND}
    # preserve non-empty custom args if the operator set them; else default [].
    if isinstance(existing, dict) and existing.get("args") not in (None, []):
        newval["args"] = existing["args"]
    else:
        newval["args"] = []
    servers[SERVER_KEY] = newval
    _atomic_write(settings_path, _dump(data))
    sys.stdout.write(
        f"install: {ownership} → entwurfProvider.mcpServers.{SERVER_KEY} = {BARE_COMMAND} (bare stable bin)\n"
    )

    if scope == "user":
        if state_path:
            state = {
                "schemaVersion": STATE_SCHEMA_VERSION,
                "managedSettingsPath": os.path.abspath(settings_path),
                "scope": "user",
                "key": f"entwurfProvider.mcpServers.{SERVER_KEY}",
                "command": BARE_COMMAND,
                "ownership": ownership,       # absent | managed-current | managed-legacy
                "preimage": existing,          # raw prior value (audit only; NOT restored)
                "installedAt": _now(),
            }
            _atomic_write(state_path, _dump(state))
        # reload-timing honesty (봉인: no implicit reload assumption): a running pi does not
        # re-read settings mid-session — only new sessions pick this up.
        sys.stdout.write(
            "install: existing pi sessions unaffected until restart; new sessions pick up the change\n"
        )


def cmd_remove(settings_path: str, repo_dir: str, scope: str, state_path: str) -> None:
    if scope == "user":
        if not state_path or not os.path.exists(state_path):
            sys.stdout.write("remove: no install-state — nothing to undo (never owned, or already removed).\n")
            return
        state = _load(state_path)
        managed = state.get("managedSettingsPath")
        if not isinstance(managed, str):
            _die(4, f"register-pi-provider: install-state {state_path} has no managedSettingsPath")
        if os.path.islink(managed):
            _die(3, f"register-pi-provider: refusing to uninstall — {managed} became a symlink since install.")
        if os.path.exists(managed):
            data = _load(managed)
            provider, servers = _provider_servers(data, create=False)
            # honest inverse: absent/managed-* → remove OUR key (a legacy repo path is NOT
            # restored — it was our old managed value, not a user value).
            if isinstance(servers, dict):
                servers.pop(SERVER_KEY, None)
                if not servers:
                    provider.pop("mcpServers", None)
            if isinstance(provider, dict) and not provider:
                data.pop("entwurfProvider", None)
            _atomic_write(managed, _dump(data))
        os.remove(state_path)
        sys.stdout.write(f"remove: removed our {SERVER_KEY} key (ownership={state.get('ownership')}) from {managed}\n")
        return

    # project scope: no state — strip our-managed shapes (bare bin OR legacy repo path).
    if not os.path.exists(settings_path):
        sys.stdout.write(f"remove: nothing to do ({settings_path} missing)\n")
        return
    if os.path.islink(settings_path):
        _die(3, f"register-pi-provider: refusing to touch {settings_path} — it is a symlink.")
    data = _load(settings_path)
    provider, servers = _provider_servers(data, create=False)
    if not isinstance(servers, dict):
        sys.stdout.write("remove: no entwurfProvider.mcpServers — nothing to do.\n")
        return
    _prune_legacy(servers, repo_dir)
    existing = servers.get(SERVER_KEY)
    existing_cmd = existing.get("command") if isinstance(existing, dict) else existing
    ownership = _classify(existing_cmd, repo_dir)
    if ownership in ("managed-current", "managed-legacy"):
        del servers[SERVER_KEY]
        sys.stdout.write(f"remove: removed entwurfProvider.mcpServers.{SERVER_KEY} ({ownership})\n")
        if not servers:
            provider.pop("mcpServers", None)
        if isinstance(provider, dict) and not provider:
            data.pop("entwurfProvider", None)
    elif ownership == "user-override":
        sys.stdout.write(f"remove: preserved entwurfProvider.mcpServers.{SERVER_KEY} (user override: {existing_cmd!r})\n")
    else:  # absent
        sys.stdout.write(f"remove: entwurfProvider.mcpServers.{SERVER_KEY} already absent.\n")
    _atomic_write(settings_path, _dump(data))


def _parse(argv: list):
    # positional: settings_path repo_dir ; flags: --scope <s> [--state <p>]
    pos, scope, state_path = [], None, ""
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--scope":
            i += 1
            scope = argv[i] if i < len(argv) else None
        elif a == "--state":
            i += 1
            state_path = argv[i] if i < len(argv) else ""
        else:
            pos.append(a)
        i += 1
    return pos, scope, state_path


def main(argv: list) -> None:
    if len(argv) < 2:
        _die(5, "usage: register-pi-provider.py <install|remove> <settings_path> <repo_dir> --scope <user|project> [--state <path>]")
    sub = argv[1]
    pos, scope, state_path = _parse(argv[2:])
    if sub not in ("install", "remove"):
        _die(5, f"register-pi-provider.py: unknown subcommand {sub!r}")
    if len(pos) != 2:
        _die(5, f"usage: register-pi-provider.py {sub} <settings_path> <repo_dir> --scope <user|project> [--state <path>]")
    if scope not in ("user", "project"):
        _die(5, "register-pi-provider.py: --scope must be user or project")
    settings_path, repo_dir = pos[0], str(os.path.abspath(pos[1]))
    if scope == "user" and not state_path:
        _die(5, "register-pi-provider.py: --state is required for --scope user")
    if sub == "install":
        cmd_install(settings_path, repo_dir, scope, state_path)
    else:
        cmd_remove(settings_path, repo_dir, scope, state_path)


if __name__ == "__main__":
    main(sys.argv)
