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

  permission-install <settings_path> <state_path>
      The OTHER half of "agy can call our bridge": registering the server (above) makes the tool
      reachable, but agy's permission engine defaults every `mcp` action to Ask, so every single
      entwurf_v2 call stops for a y/n. This adds our allow rule to agy's settings.json.

      Ownership is ELEMENT-level, not subtree: we own exactly the string
      `mcp(entwurf-bridge/entwurf_v2)` inside `permissions.allow`. The operator's own rules
      (command(*), their ask/deny lists, everything else) are ours to preserve, never to manage —
      granting ourselves broad permissions would be a trust decision that is not the installer's
      to make. Same discipline as the single mcpServers key above. Idempotent; refuses a symlink.

  permission-uninstall <state_path>
      Honest inverse: remove OUR rule only if WE added it (an operator who already had the rule
      keeps it), then drop the `allow`/`permissions` containers only if we created them and they
      are now empty. Removes the settings file only if we created it and nothing else remains.

  permission-doctor <settings_path>
      One token line: `absent` / `invalid-json` / `not-configured` / `configured` /
      `shadowed-by-<list> <rule>`. The shadow check exists because agy evaluates
      Deny > Ask > Allow: an operator rule like `mcp(*)` in their ask list SILENTLY defeats our
      allow, and agy starts prompting again with our install still green. That would be a
      debugging hole ("why is it asking me every time?"), so the doctor names it instead.

Exit codes: 0 ok · 2 no-state · 3 refuse-symlink · 4 invalid-json · 5 usage.
"""

import json
import os
import sys

SERVER_KEY = "entwurf-bridge"
STATE_SCHEMA_VERSION = 1

# The ONE permission rule we own. Scoped to a single tool on our own server — not mcp(*), not the
# server-wide mcp(entwurf-bridge): an installer grants itself the narrowest rule that makes the
# thing it installed work, and nothing more. INSTALL still writes only this.
ALLOW_RULE = f"mcp({SERVER_KEY}/entwurf_v2)"
# Rules that MATCH our tool: the exact grant, the server-wide rule, and the action wildcard.
# Membership here is a statement about agy's matcher, not about which list the rule sits in — the
# same three rules cover entwurf_v2 wherever they appear. From a higher-precedence list they
# override our allow (shadowing); from `allow` itself they already grant it (covering).
#
# The doctor used to read them ONE WAY ONLY — shadowing — and demanded a literal ALLOW_RULE string
# in `allow`. So a host whose operator had granted a broad `mcp(*)` (their trust decision, not
# ours) was reported as "NOT granted, agy prompts on EVERY entwurf_v2 call": a false red about a
# surface that in fact works. Reading the same coverage in both directions is the fix; treating
# mcp(*) as matching in deny/ask but not in allow was never defensible.
MATCHING_RULES = (ALLOW_RULE, f"mcp({SERVER_KEY})", "mcp(*)")
SHADOWING_RULES = MATCHING_RULES  # same set, higher-precedence lists
# Deny > Ask > Allow (agy permissions engine).
SHADOWING_LISTS = ("deny", "ask")


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


def _prior_state(state_path: str, managed_key: str, managed_path: str) -> dict:
    """The state of OUR FIRST install of this exact target, if we are re-installing over it.

    An installer is re-run routinely (every package upgrade). Re-capturing the preimage on each run
    would capture OUR OWN previous write as "what was there before" — and then uninstall faithfully
    restores us, leaving the very entry it was supposed to take away. Provenance must be recorded
    once, at the first install, and carried forward unchanged: preimage, and whether the file
    existed before us, are facts about a moment that has already passed.
    """
    if not os.path.exists(state_path):
        return {}
    try:
        prior = _load_config(state_path)
    except SystemExit:
        raise
    if prior.get(managed_key) != os.path.abspath(managed_path):
        return {}  # re-targeted somewhere else — this is a fresh install for that path
    return prior


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

    # Capture the preimage of OUR key (None = the key was absent) for the honest inverse — but ONLY
    # on the first install of this target. On a re-install the key on disk is our own previous
    # write; capturing it would make uninstall "restore" us and leave the entry behind.
    prior = _prior_state(state_path, "managedConfigPath", config_path)
    if prior:
        preimage = prior.get("preimage", None)
        detect_mode = prior.get("detectMode", detect_mode)
        config_existed = prior.get("configExistedBefore", config_existed)
    else:
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


def cmd_permission_install(settings_path: str, state_path: str) -> None:
    if os.path.islink(settings_path):
        target = os.readlink(settings_path)
        _die(3, f"agy-bridge: refusing to adopt {settings_path} — it is a symlink to {target} (someone else's SSOT). "
                f"Manage it there, or replace it with a regular file, then retry.")

    settings_existed = os.path.exists(settings_path)
    data = _load_config(settings_path) if settings_existed else {}
    detect_mode = "adopt-regular-file" if settings_existed else "created-new"

    perms = data.get("permissions")
    permissions_existed = isinstance(perms, dict)
    if perms is None:
        perms = {}
        data["permissions"] = perms
    if not isinstance(perms, dict):
        _die(4, f"agy-bridge: {settings_path} permissions must be a JSON object")

    allow = perms.get("allow")
    allow_existed = isinstance(allow, list)
    if allow is None:
        allow = []
        perms["allow"] = allow
    if not isinstance(allow, list):
        _die(4, f"agy-bridge: {settings_path} permissions.allow must be a JSON array")

    # Idempotent, and the provenance that makes the inverse honest: if the operator ALREADY had this
    # rule, we did not add it, so uninstall must not take it away. On a RE-install the rule on disk
    # is our own previous write — reading it as "pre-existing" would hand the operator credit for
    # our entry and strand it forever. So provenance is taken from the first install and carried.
    on_disk = ALLOW_RULE in allow  # what the file says NOW (may be our own earlier write)
    rule_existed = on_disk
    prior = _prior_state(state_path, "managedSettingsPath", settings_path)
    if prior:
        rule_existed = prior.get("ruleExistedBefore", rule_existed)
        detect_mode = prior.get("detectMode", detect_mode)
        settings_existed = prior.get("settingsExistedBefore", settings_existed)
        permissions_existed = prior.get("permissionsExistedBefore", permissions_existed)
        allow_existed = prior.get("allowExistedBefore", allow_existed)
    if ALLOW_RULE not in allow:
        allow.append(ALLOW_RULE)

    _atomic_write(settings_path, _dump(data))

    state = {
        "schemaVersion": STATE_SCHEMA_VERSION,
        "managedSettingsPath": os.path.abspath(settings_path),
        "rule": ALLOW_RULE,
        "detectMode": detect_mode,
        "settingsExistedBefore": settings_existed,
        "permissionsExistedBefore": permissions_existed,
        "allowExistedBefore": allow_existed,
        "ruleExistedBefore": rule_existed,  # true = the operator's rule, not ours to remove
        "installedAt": _now(),
    }
    _atomic_write(state_path, _dump(state))
    sys.stdout.write(f"{'already-present' if on_disk else 'added'} {ALLOW_RULE}\n")


def cmd_permission_uninstall(state_path: str) -> None:
    if not os.path.exists(state_path):
        _die(2, f"agy-bridge: no permission install-state at {state_path} — nothing to uninstall.")
    state = _load_config(state_path)
    settings_path = state.get("managedSettingsPath")
    if not isinstance(settings_path, str):
        _die(4, f"agy-bridge: permission install-state {state_path} has no managedSettingsPath")

    if os.path.islink(settings_path):
        _die(3, f"agy-bridge: refusing to uninstall — {settings_path} became a symlink since install "
                f"(someone else's SSOT now). Resolve by hand.")

    if os.path.exists(settings_path):
        data = _load_config(settings_path)
        perms = data.get("permissions")
        if isinstance(perms, dict):
            allow = perms.get("allow")
            # The operator already had the rule before us → it is theirs; leave it.
            if isinstance(allow, list) and not state.get("ruleExistedBefore", False):
                perms["allow"] = [r for r in allow if r != ALLOW_RULE]
                # Drop only the containers WE created, and only while they are empty. An operator
                # who has since added their own rules keeps their structure untouched.
                if not state.get("allowExistedBefore", False) and perms["allow"] == []:
                    perms.pop("allow", None)
                if not state.get("permissionsExistedBefore", False) and perms == {}:
                    data.pop("permissions", None)
        created_new = state.get("detectMode") == "created-new" and state.get("settingsExistedBefore") is False
        if created_new and data == {}:
            os.remove(settings_path)
        else:
            _atomic_write(settings_path, _dump(data))

    os.remove(state_path)
    sys.stdout.write(f"uninstalled {ALLOW_RULE} from {settings_path}\n")


def cmd_permission_doctor(settings_path: str) -> None:
    real = os.path.realpath(settings_path)
    if not os.path.exists(real):
        sys.stdout.write("absent\n")
        return
    try:
        with open(real, "r", encoding="utf-8") as fh:
            data = json.loads(fh.read() or "{}")
    except (json.JSONDecodeError, OSError):
        sys.stdout.write("invalid-json\n")
        return
    perms = data.get("permissions") if isinstance(data, dict) else None
    perms = perms if isinstance(perms, dict) else {}

    # Precedence FIRST (Deny > Ask > Allow): a matching rule in a higher list means agy prompts (or
    # blocks) no matter what our allow says. Reporting `configured` there would be a green light on
    # a surface that is actually still stopping every call.
    for list_name in SHADOWING_LISTS:
        rules = perms.get(list_name)
        if not isinstance(rules, list):
            continue
        for rule in rules:
            if rule in SHADOWING_RULES:
                sys.stdout.write(f"shadowed-by-{list_name} {rule}\n")
                return

    allow = perms.get("allow")
    if isinstance(allow, list):
        if ALLOW_RULE in allow:
            sys.stdout.write("configured\n")
            return
        # No rule of ours, but a BROADER operator rule in the same list already matches our tool.
        # agy will not prompt; the call works. Say so — and say whose rule is carrying it, because
        # the day the operator narrows that wildcard, our unowned grant disappears with it.
        for rule in MATCHING_RULES:
            if rule != ALLOW_RULE and rule in allow:
                sys.stdout.write(f"covered-by-allow {rule}\n")
                return
    sys.stdout.write("not-configured\n")


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
    elif sub == "permission-install":
        if len(argv) != 4:
            _die(5, "usage: agy-bridge-config.py permission-install <settings_path> <state_path>")
        cmd_permission_install(argv[2], argv[3])
    elif sub == "permission-uninstall":
        if len(argv) != 3:
            _die(5, "usage: agy-bridge-config.py permission-uninstall <state_path>")
        cmd_permission_uninstall(argv[2])
    elif sub == "permission-doctor":
        if len(argv) != 3:
            _die(5, "usage: agy-bridge-config.py permission-doctor <settings_path>")
        cmd_permission_doctor(argv[2])
    else:
        _die(5, f"agy-bridge-config.py: unknown subcommand {sub!r}")


if __name__ == "__main__":
    main(sys.argv)
