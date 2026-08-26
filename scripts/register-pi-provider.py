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

USER-SCOPE OWNER BINDING (#86 C2): the user install-state additionally records
`installerRoot` (the repo/package root that installed the key), so an old root's
inverse can no longer delete the CURRENT stable provider key. Schema stays
version 1 — installerRoot is an optional field; a state without it is LEGACY:
  - install, legacy state          → safe ADOPTION: proceed and rewrite the state
                                     with installerRoot = this root (named on stdout);
  - install, installerRoot ≠ root  → REFUSE (exit 6), zero settings write, unless
                                     the operator-explicit --takeover replaces it
                                     (old root reported);
  - remove, installerRoot == root  → today's honest inverse;
  - remove, installerRoot ≠ root, owner LIVE    → REFUSE (exit 6);
  - remove, installerRoot ≠ root, owner MISSING → REFUSE unless --orphan-cleanup,
    which only run.sh's aligned remove-user-scope path passes (package entry +
    package state + provider installerRoot all naming that same missing root);
  - remove, legacy state (no installerRoot) → REFUSE (fail-closed): an
    unattributed key accepts no inverse; a same-root install/setup ADOPTS the
    state first (named), then remove works.
  - takeover over a USER-OVERRIDE key → split verdict: the override is preserved
    and stays unowned, the stale ownership state is cleared, and the report says
    "package owner moved; provider override preserved" — never a false both-owned.
`--preflight` runs the SAME ownership decision READ-ONLY (identical exit codes,
zero writes) so run.sh can complete both the package and provider preflights
before either writer runs (atomic user-scope operations).

Subcommands:
  install <settings_path> <repo_dir> --scope <user|project> [--state <state_path>] [--takeover] [--preflight]
  remove  <settings_path> <repo_dir> --scope <user|project> [--state <state_path>] [--orphan-cleanup] [--preflight]

Exit codes: 0 ok · 2 no-state · 3 refuse-symlink · 4 invalid-json · 5 usage · 6 ownership-refusal.
"""

import json
import os
import sys

# Shared with register-pi-package.py: both writers touch the SAME settings file, so the
# "no write when nothing changes / keep the file's indent unit" rules live in one module
# instead of being remembered at each call site. Closing only the packages writer for
# #53 B left THIS one restyling the repo's own tracked, biome-governed settings on every
# `install` — semantically a no-op, byte-wise a RED `pnpm check`. sys.path[0] already
# holds this directory when the script is run by path (how run.sh and the gates invoke
# it); the explicit insert keeps the import true under any other invocation form.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pi_settings_io import detect_indent, dumps, unchanged  # noqa: E402

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


def _read(path: str) -> str:
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def _parse_settings(path: str, raw: str) -> dict:
    if raw.strip() == "":
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        _die(4, f"register-pi-provider: {path} is not valid JSON: {err}")
    if not isinstance(data, dict):
        _die(4, f"register-pi-provider: {path} top-level must be a JSON object")
    return data


def _load(path: str) -> dict:
    return _parse_settings(path, _read(path))


def _dump(data: dict) -> str:
    """For files THIS script owns end to end (the install-state record), where no
    formatter has a claim. A settings file goes through _persist instead."""
    return json.dumps(data, indent=2) + "\n"


def _persist(path: str, before: dict, after: dict, original_text: str) -> bool:
    """Write a SETTINGS file — but only if `after` actually differs from what was
    loaded, and then in the file's own indent unit. Returns True when it wrote.

    This is the whole of #53 B on this writer. `install` is documented as idempotent
    and a managed-current classification changes nothing, yet the old unconditional
    `_atomic_write` re-serialized the document every time: this repo's committed
    `.pi/settings.json` is tab-indented with compact arrays, came back at indent=2, and
    took `pnpm check` RED at its first step — reported as a formatting error, which is
    what sent the diagnosis away from "install wrote this" (#53 B, both rounds).
    """
    if unchanged(before, after):
        return False
    _atomic_write(path, dumps(after, detect_indent(original_text)))
    return True


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


def _load_state_file(state_path: str) -> dict | None:
    if not state_path or not os.path.exists(state_path):
        return None
    state = _load(state_path)
    return state


def cmd_install(settings_path: str, repo_dir: str, scope: str, state_path: str, takeover: bool = False,
                preflight: bool = False) -> None:
    if os.path.islink(settings_path):
        target = os.readlink(settings_path)
        _die(3, f"register-pi-provider: refusing to adopt {settings_path} — it is a symlink to {target} "
                f"(someone else's SSOT). Manage it there, or replace it with a regular file, then retry.")

    # Owner binding BEFORE any settings mutation (#86 C2): a user-scope state whose
    # installerRoot names another root refuses the whole install — zero settings
    # bytes — unless the operator-explicit takeover replaces it.
    prior_state = _load_state_file(state_path) if scope == "user" else None
    prior_root = prior_state.get("installerRoot") if isinstance(prior_state, dict) else None
    if scope == "user" and isinstance(prior_state, dict):
        # State↔target binding (#86 C2 final amendment): the state names WHICH
        # settings file it manages; an operation targeting a different file is an
        # ownership mismatch — fail closed before either writer runs.
        prior_managed = prior_state.get("managedSettingsPath")
        if not isinstance(prior_managed, str):
            _die(4, f"register-pi-provider: install-state {state_path} has no managedSettingsPath string")
        if os.path.abspath(prior_managed) != os.path.abspath(settings_path):
            _die(6, f"register-pi-provider: install-state {state_path} manages {prior_managed}, but this "
                    f"operation targets {settings_path} — ownership record and target disagree; zero settings bytes written.")
    if scope == "user" and isinstance(prior_root, str) and prior_root != repo_dir and not takeover:
        _die(6, f"register-pi-provider: the user-scope {SERVER_KEY} key is owned by another root: {prior_root}. "
                "Normal install never replaces another owner — zero settings bytes written. "
                "Use './run.sh takeover-user-scope' to move it explicitly.")

    raw = _read(settings_path)
    # Parsed TWICE on purpose: everything below mutates in place, so `before` has to be
    # an independent document or the comparison would be against itself.
    before = _parse_settings(settings_path, raw)
    data = _parse_settings(settings_path, raw)
    provider, servers = _provider_servers(data, create=True)
    _prune_legacy(servers, repo_dir)   # independent of entwurf-bridge ownership
    existing = servers.get(SERVER_KEY)
    existing_cmd = existing.get("command") if isinstance(existing, dict) else existing
    ownership = _classify(existing_cmd, repo_dir)

    if preflight:
        # Read-only half of the atomic user-scope operation: the ownership decision
        # above already refused a foreign installerRoot; everything past this point
        # would write, so report the classification and stop.
        sys.stdout.write(f"preflight: install ok (ownership={ownership}{', takeover' if takeover else ''})\n")
        return

    if ownership == "user-override":
        # DO NOT overwrite our key, DO NOT own it (no state). doctor reports it as unowned. Still
        # persist IF the legacy prune above (or a materialized parent) actually changed something.
        sys.stdout.write(
            f"install: preserved entwurfProvider.mcpServers.{SERVER_KEY} (user override, NOT owned: {existing_cmd!r})\n"
        )
        if scope == "user" and takeover and state_path and os.path.exists(state_path):
            # Split verdict (#86 C2): the package half moved, but the provider key is
            # the OPERATOR'S override — preserve it, and clear the stale ownership
            # state so no root claims a key nobody manages. Never a false "both owned".
            os.remove(state_path)
            sys.stdout.write(
                "takeover: provider override preserved, unowned — stale provider ownership state cleared "
                "(package owner moved; the provider key remains the operator's)\n"
            )
        if not _persist(settings_path, before, data, raw):
            sys.stdout.write(f"install: no change — {settings_path} left untouched (bytes and mtime stable)\n")
        return

    # absent / managed-current / managed-legacy → normalize to the bare stable bin.
    newval = {"command": BARE_COMMAND}
    # preserve non-empty custom args if the operator set them; else default [].
    if isinstance(existing, dict) and existing.get("args") not in (None, []):
        newval["args"] = existing["args"]
    else:
        newval["args"] = []
    servers[SERVER_KEY] = newval
    wrote = _persist(settings_path, before, data, raw)
    sys.stdout.write(
        f"install: {ownership} → entwurfProvider.mcpServers.{SERVER_KEY} = {BARE_COMMAND} (bare stable bin)\n"
    )
    # The desired value AND the legacy prune both already held: nothing to say to the
    # file. Reported so an operator (and the gate) can tell "already correct" from
    # "rewritten to the same thing" — only the first leaves a tracked file alone.
    if not wrote:
        sys.stdout.write(f"install: no change — {settings_path} left untouched (bytes and mtime stable)\n")

    if scope == "user":
        if state_path:
            if prior_state is not None and prior_root is None:
                # LEGACY v1 state (pre-#86 C2, no installerRoot): safe adoption — the
                # rewrite below binds it to this root, and the adoption is named.
                sys.stdout.write(
                    f"install: adopted legacy provider install-state (no installerRoot recorded) — now bound to {repo_dir}\n"
                )
            if takeover and isinstance(prior_root, str) and prior_root != repo_dir:
                sys.stdout.write(
                    f"takeover: user-scope {SERVER_KEY} provider ownership moved {prior_root} -> {repo_dir}\n"
                )
            state = {
                "schemaVersion": STATE_SCHEMA_VERSION,
                "managedSettingsPath": os.path.abspath(settings_path),
                "scope": "user",
                "key": f"entwurfProvider.mcpServers.{SERVER_KEY}",
                "command": BARE_COMMAND,
                "ownership": ownership,       # absent | managed-current | managed-legacy
                "installerRoot": repo_dir,     # #86 C2: the root whose inverse may remove this key
                "preimage": existing,          # raw prior value (audit only; NOT restored)
                "installedAt": _now(),
            }
            _atomic_write(state_path, _dump(state))
        # reload-timing honesty (봉인: no implicit reload assumption): a running pi does not
        # re-read settings mid-session — only new sessions pick this up.
        sys.stdout.write(
            "install: existing pi sessions unaffected until restart; new sessions pick up the change\n"
        )


def cmd_remove(settings_path: str, repo_dir: str, scope: str, state_path: str, orphan: bool = False,
               preflight: bool = False) -> None:
    if scope == "user":
        if not state_path or not os.path.exists(state_path):
            sys.stdout.write("remove: no install-state — nothing to undo (never owned, or already removed).\n")
            return
        state = _load(state_path)
        # Same-owner-only inverse (#86 C2): a state bound to another root must not
        # let that OTHER root's stale inverse delete the CURRENT stable key.
        installer_root = state.get("installerRoot")
        if isinstance(installer_root, str) and installer_root != repo_dir:
            if os.path.isdir(installer_root):
                _die(6, f"register-pi-provider: the user-scope {SERVER_KEY} key is owned by another LIVE root: "
                        f"{installer_root}. This root's inverse must not remove it — zero settings bytes written.")
            if not orphan:
                _die(6, f"register-pi-provider: the recorded owner root is MISSING: {installer_root}. "
                        "Refusing outside run.sh's aligned orphan path (remove-user-scope checks package entry, "
                        "package state and provider installerRoot together).")
            if not preflight:
                sys.stdout.write(
                    f"remove: orphan cleanup — proceeding for the MISSING owner {installer_root}\n"
                )
        elif installer_root is None:
            # LEGACY v1 state (no installerRoot): fail-closed (#86 C2 amendment). An
            # unattributed state must not let ANY root's inverse — least of all an old
            # checkout's — delete the current stable key. Adoption is install-only:
            # run install/setup from the owning root first, then remove.
            _die(6, f"register-pi-provider: install-state {state_path} is LEGACY (no installerRoot recorded) — "
                    "refusing to remove an unattributed key. Run './run.sh setup' or 'entwurf install' from the "
                    "owning root first (named adoption binds the state), then remove.")
        # PREFLIGHT COMPLETENESS (#86 C2 final amendment): everything the writer
        # would check is checked HERE, before any green — managedSettingsPath shape
        # and target equality, the symlink refusal, and settings/provider
        # parseability — so a run.sh caller that saw this preflight green cannot
        # have its provider writer break after the package writer already wrote.
        managed = state.get("managedSettingsPath")
        if not isinstance(managed, str):
            _die(4, f"register-pi-provider: install-state {state_path} has no managedSettingsPath")
        if os.path.abspath(managed) != os.path.abspath(settings_path):
            _die(6, f"register-pi-provider: install-state {state_path} manages {managed}, but this operation "
                    f"targets {settings_path} — ownership record and target disagree; zero settings bytes written.")
        if os.path.islink(managed):
            _die(3, f"register-pi-provider: refusing to uninstall — {managed} became a symlink since install.")
        raw = ""
        before = data = provider = servers = None
        if os.path.exists(managed):
            raw = _read(managed)
            before = _parse_settings(managed, raw)     # dies 4 on corrupt — preflight and writer alike
            data = _parse_settings(managed, raw)
            provider, servers = _provider_servers(data, create=False)
        if preflight:
            sys.stdout.write("preflight: remove ok (owner verified; managed target bound and parseable)\n")
            return
        if os.path.exists(managed):
            # honest inverse: absent/managed-* → remove OUR key (a legacy repo path is NOT
            # restored — it was our old managed value, not a user value).
            if isinstance(servers, dict):
                servers.pop(SERVER_KEY, None)
                if not servers:
                    provider.pop("mcpServers", None)
            if isinstance(provider, dict) and not provider:
                data.pop("entwurfProvider", None)
            # Same rule as install: an inverse that has nothing left to undo must not
            # restyle the file on its way out.
            _persist(managed, before, data, raw)
        os.remove(state_path)
        sys.stdout.write(f"remove: removed our {SERVER_KEY} key (ownership={state.get('ownership')}) from {managed}\n")
        return

    # project scope: no state — strip our-managed shapes (bare bin OR legacy repo path).
    if not os.path.exists(settings_path):
        sys.stdout.write(f"remove: nothing to do ({settings_path} missing)\n")
        return
    if os.path.islink(settings_path):
        _die(3, f"register-pi-provider: refusing to touch {settings_path} — it is a symlink.")
    raw = _read(settings_path)
    before = _parse_settings(settings_path, raw)
    data = _parse_settings(settings_path, raw)
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
    # `absent` + nothing pruned is the common case on a clean checkout, and it used to
    # rewrite the file anyway — a project `remove` restyled the tracked settings exactly
    # as install did.
    if not _persist(settings_path, before, data, raw):
        sys.stdout.write(f"remove: no change — {settings_path} left untouched (bytes and mtime stable)\n")


def _parse(argv: list):
    # positional: settings_path repo_dir ; flags: --scope <s> [--state <p>] [--takeover] [--orphan-cleanup] [--preflight]
    pos, scope, state_path = [], None, ""
    takeover, orphan, preflight = False, False, False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--scope":
            i += 1
            scope = argv[i] if i < len(argv) else None
        elif a == "--state":
            i += 1
            state_path = argv[i] if i < len(argv) else ""
        elif a == "--takeover":
            takeover = True
        elif a == "--orphan-cleanup":
            orphan = True
        elif a == "--preflight":
            preflight = True
        else:
            pos.append(a)
        i += 1
    return pos, scope, state_path, takeover, orphan, preflight


def main(argv: list) -> None:
    if len(argv) < 2:
        _die(5, "usage: register-pi-provider.py <install|remove> <settings_path> <repo_dir> --scope <user|project> [--state <path>]")
    sub = argv[1]
    pos, scope, state_path, takeover, orphan, preflight = _parse(argv[2:])
    if sub not in ("install", "remove"):
        _die(5, f"register-pi-provider.py: unknown subcommand {sub!r}")
    if len(pos) != 2:
        _die(5, f"usage: register-pi-provider.py {sub} <settings_path> <repo_dir> --scope <user|project> [--state <path>]")
    if scope not in ("user", "project"):
        _die(5, "register-pi-provider.py: --scope must be user or project")
    settings_path, repo_dir = pos[0], str(os.path.abspath(pos[1]))
    if scope == "user" and not state_path:
        _die(5, "register-pi-provider.py: --state is required for --scope user")
    if (takeover or orphan or preflight) and scope != "user":
        _die(5, "register-pi-provider.py: --takeover/--orphan-cleanup/--preflight require --scope user")
    if takeover and sub != "install":
        _die(5, "register-pi-provider.py: --takeover is an install action")
    if orphan and sub != "remove":
        _die(5, "register-pi-provider.py: --orphan-cleanup is a remove action")
    if sub == "install":
        cmd_install(settings_path, repo_dir, scope, state_path, takeover, preflight)
    else:
        cmd_remove(settings_path, repo_dir, scope, state_path, orphan, preflight)


if __name__ == "__main__":
    main(sys.argv)
