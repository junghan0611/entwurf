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
      The OTHER half of "agy can call our bridge": registering the server (above) makes the tools
      reachable, but agy's permission engine defaults every `mcp` action to Ask, so every single
      call stops for a y/n. This adds our allow rules to agy's settings.json.

      Ownership is ELEMENT-level, not subtree: we own exactly the strings
      `mcp(entwurf-bridge/<tool>)` for the tools the normal agy workflow calls, inside
      `permissions.allow`. Every tool the server exposes is visible to the model; these are the
      ones we auto-grant, which is a smaller set on purpose.
      The operator's own rules (command(*), their ask/deny lists, everything else) are ours to
      preserve, never to manage — granting ourselves broad permissions would be a trust decision
      that is not the installer's to make. Same discipline as the single mcpServers key above.
      Idempotent; refuses a symlink.

  permission-uninstall <state_path>
      Honest inverse: remove each of OUR rules only if WE added that one (an operator who already
      had a rule keeps it), then drop the `allow`/`permissions` containers only if we created them
      and they are now empty. Removes the settings file only if we created it and nothing remains.

  permission-doctor <settings_path>
      One token line: `absent` / `invalid-json` / `not-configured` / `configured` /
      `partially-configured <missing...>` / `covered-by-allow <rule>` /
      `shadowed-by-<list> <broad|exact> <rule>`. The shadow check exists because agy evaluates
      Deny > Ask > Allow: an operator rule like `mcp(*)` in their ask list SILENTLY defeats our
      allow, and agy starts prompting again with our install still green. That would be a
      debugging hole ("why is it asking me every time?"), so the doctor names it instead — with
      the SCOPE, because a broad rule takes every tool while an exact one takes only its own.

  permission-state-doctor <state_path>
      Is the OWNERSHIP RECORD itself readable? `absent` / `ok <n>` / `corrupt <why>`. Separate from
      permission-doctor, which reads the settings file: runtime can be perfect while the record that
      distinguishes our grants from the operator's is unreadable (hard rule 13, two axes). Uses the
      same strict parser as install/uninstall, so "readable" has one definition. Never mutates.

  permission-rules
      Print the allow rules we own, space-separated. The single source the shell and gates render
      from, so operator messages can never drift from what install actually writes.

Exit codes: 0 ok · 2 no-state · 3 refuse-symlink · 4 invalid-json · 5 usage.
"""

import json
import os
import sys

SERVER_KEY = "entwurf-bridge"
# TWO independent state files, TWO independent schemas. They are versioned apart because they
# change apart: widening the permission rule set says nothing about the MCP install-state's shape,
# and stamping a bump onto a file whose layout never moved makes the version a lie — the next reader
# to branch on it would be branching on noise.
STATE_SCHEMA_VERSION = 1  # MCP install-state (server key + preimage); shape unchanged
# 2: permission state records a rule SET (`rules` / `rulesExistedBefore`) instead of a single
# `rule` / `ruleExistedBefore`. Install migrates a v1 state in place; uninstall reads both shapes.
PERMISSION_STATE_SCHEMA_VERSION = 2

# The permission rules we own — one per tool the NORMAL agy workflow calls. (Every tool the server
# exposes is visible to the model; auto-granting is the smaller, deliberate set.) Each is
# scoped to a single tool on our own server: not mcp(*), not the server-wide mcp(entwurf-bridge).
# An installer grants itself the narrowest rules that make the thing it installed work, and nothing
# more; three narrow grants are still narrow, and none of them is a trust decision about anyone
# else's server.
#
# Granting ONLY entwurf_v2 was a shipped defect (measured 2026-07-27 on a live agy citizen): agy
# defaults every mcp action to Ask, so `entwurf_peers` and `entwurf_self` stopped for a y/n on
# EVERY call. The bridge was registered and two thirds of it was unusable — the same failure the
# doctor already names for entwurf_v2, just never checked for the other two.
#
# The four tools deliberately NOT here, because a grant we do not need is a grant we should not take:
#   entwurf_inbox_read   — native-push has no inbox to drain. An agy citizen has no meta-mailbox
#                          directory at all (measured), so granting it would pre-approve a rail this
#                          backend does not have.
#   entwurf_register_native — explicit/manual fallback, not the normal birth path (DELIVERY.md):
#                          agy births automatically from PreInvocation. Auto-approving a registration
#                          verb the normal path never calls is exactly the excess this list avoids.
#   entwurf_fresh_call / entwurf_resume_call — both launch into the CALLER's own tmux session and
#                          refuse without a pane anchor. An agy conversation is not a tmux client,
#                          so these are not on its normal path either; the count moved from two to
#                          four when 0.14 shipped the mux verbs, and the granted set did not.
ALLOW_RULES = tuple(f"mcp({SERVER_KEY}/{tool})" for tool in ("entwurf_v2", "entwurf_peers", "entwurf_self"))
# Rules that MATCH one of our tools: its exact grant, the server-wide rule, and the action wildcard.
# Membership here is a statement about agy's matcher, not about which list the rule sits in — the
# same rules cover our tools wherever they appear. From a higher-precedence list they override our
# allow (shadowing); from `allow` itself they already grant it (covering). SCOPE differs, though:
# the two broad rules cover every tool on the server, an exact rule only its own.
#
# The doctor used to read them ONE WAY ONLY — shadowing — and demanded a literal own-rule string
# in `allow`. So a host whose operator had granted a broad `mcp(*)` (their trust decision, not
# ours) was reported as "NOT granted, agy prompts on EVERY entwurf_v2 call": a false red about a
# surface that in fact works. Reading the same coverage in both directions is the fix; treating
# mcp(*) as matching in deny/ask but not in allow was never defensible.
BROAD_RULES = (f"mcp({SERVER_KEY})", "mcp(*)")  # cover EVERY tool on our server, not just one
MATCHING_RULES = ALLOW_RULES + BROAD_RULES
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


class _PermissionStateError(Exception):
    """A permission install-state we refuse to act on. Raised, not exited, so the doctor can REPORT
    corruption while install/uninstall REFUSE on it — one parser, three honest reactions."""


def _parse_permission_state(state: dict) -> tuple:
    """Validate a permission install-state; return (rules, {rule: was-it-already-theirs}).

    Two shapes, because install/uninstall/doctor can all meet a state file an older entwurf wrote:
    schemaVersion 2 carries `rules` + `rulesExistedBefore`; schemaVersion 1 carried a single `rule`
    + `ruleExistedBefore`. Either way the answer is the same question asked per rule, and a rule the
    operator already had is theirs in both.

    STRICT, because the failure mode deletes someone else's configuration. A missing or non-boolean
    provenance entry read as "not theirs" silently promotes the operator's own rule to ours and the
    inverse takes it away — `rulesExistedBefore: {}` alone would revoke every rule in the file. An
    unknown version, a wrong type, or an INCOMPLETE provenance map is an error, never a permissive
    default. Refusing is recoverable; deleting a grant we never owned is not.

    ONE parser for every caller. Install used to do its own shallow shape check (dict? values bool?)
    which an EMPTY map passed — `all()` of nothing is true — so a corrupt prior state was silently
    overwritten with freshly re-captured provenance, the exact re-capture the state file exists to
    prevent. A second, laxer copy of a strict rule is the same as not having the rule.
    """
    version = state.get("schemaVersion")
    if version == PERMISSION_STATE_SCHEMA_VERSION:
        rules = state.get("rules")
        existed = state.get("rulesExistedBefore")
        if not isinstance(rules, list) or not rules or not all(isinstance(r, str) for r in rules):
            raise _PermissionStateError(
                "`rules` must be a non-empty list of strings — refusing to guess which rules are ours")
        if not isinstance(existed, dict):
            raise _PermissionStateError(
                "`rulesExistedBefore` must be an object — refusing to act on unreadable provenance")
        missing = [r for r in rules if not isinstance(existed.get(r), bool)]
        if missing:
            raise _PermissionStateError(
                f"no boolean provenance for {' '.join(missing)} — refusing to treat a rule that may "
                "be the operator's as ours")
        return tuple(rules), {r: existed[r] for r in rules}
    if version == 1:
        legacy = state.get("rule")
        owned = state.get("ruleExistedBefore")
        if not isinstance(legacy, str) or not isinstance(owned, bool):
            raise _PermissionStateError(
                "schemaVersion 1 needs a string `rule` and a boolean `ruleExistedBefore`")
        return (legacy,), {legacy: owned}
    raise _PermissionStateError(
        f"unknown schemaVersion {version!r} — this entwurf does not know which rules that install "
        "owned and will not touch any")


def _owned_rules(state: dict) -> list:
    """The rules in this install-state that are OURS to remove — never the operator's."""
    try:
        rules, existed = _parse_permission_state(state)
    except _PermissionStateError as exc:
        _die(4, f"agy-bridge: permission install-state is unusable — {exc}. Check permissions.allow "
                "yourself, then delete the state file by hand if it is genuinely stale.")
    return [r for r in rules if not existed[r]]


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
    on_disk = {rule: rule in allow for rule in ALLOW_RULES}  # what the file says NOW
    # Provenance is PER RULE. A host can easily have granted one of these by hand (agy's own
    # "always allow" prompt persists exactly one rule at a time — that is how an operator ends up
    # owning entwurf_self while entwurf owns entwurf_v2), and a set-wide flag would either strand
    # their rule or take it away. Each rule carries its own answer to "was this yours before us?".
    rules_existed = dict(on_disk)
    prior = _prior_state(state_path, "managedSettingsPath", settings_path)
    if prior:
        detect_mode = prior.get("detectMode", detect_mode)
        settings_existed = prior.get("settingsExistedBefore", settings_existed)
        permissions_existed = prior.get("permissionsExistedBefore", permissions_existed)
        allow_existed = prior.get("allowExistedBefore", allow_existed)
        # Carry recorded provenance forward, branching on the VERSION rather than on which keys
        # happen to be present — a duck-typed read of a malformed state is how a wrong answer here
        # becomes a deleted operator rule at uninstall time. A rule the prior state never described
        # (a tool we only started granting now) keeps the preimage we just read from disk, which is
        # the first honest observation we have of it.
        # The SAME strict parser uninstall uses. A prior state we cannot read is a REFUSAL, not a
        # licence to re-capture: overwriting it would replace the operator's recorded answer with a
        # fresh reading of a file we ourselves wrote, which is precisely what this state file exists
        # to prevent. Only rules the prior state actually RECORDED are carried; a tool we started
        # granting later keeps the preimage read from disk, its first honest observation.
        try:
            _prior_rules, prior_existed = _parse_permission_state(prior)
        except _PermissionStateError as exc:
            _die(4, f"agy-bridge: prior permission install-state is unusable — {exc}. Refusing to "
                    "overwrite provenance this entwurf cannot read; inspect it by hand.")
        for rule in ALLOW_RULES:
            if rule in prior_existed:
                rules_existed[rule] = prior_existed[rule]
    for rule in ALLOW_RULES:
        if rule not in allow:
            allow.append(rule)

    _atomic_write(settings_path, _dump(data))

    state = {
        "schemaVersion": PERMISSION_STATE_SCHEMA_VERSION,
        "managedSettingsPath": os.path.abspath(settings_path),
        "rules": list(ALLOW_RULES),
        "detectMode": detect_mode,
        "settingsExistedBefore": settings_existed,
        "permissionsExistedBefore": permissions_existed,
        "allowExistedBefore": allow_existed,
        # true = the operator's rule, not ours to remove
        "rulesExistedBefore": {rule: rules_existed[rule] for rule in ALLOW_RULES},
        "installedAt": _now(),
    }
    _atomic_write(state_path, _dump(state))
    added = [rule for rule in ALLOW_RULES if not on_disk[rule]]
    present = [rule for rule in ALLOW_RULES if on_disk[rule]]
    if added:
        sys.stdout.write(f"added {' '.join(added)}\n" if not present else
                         f"added {' '.join(added)} (already-present {' '.join(present)})\n")
    else:
        sys.stdout.write(f"already-present {' '.join(ALLOW_RULES)}\n")


def cmd_permission_uninstall(state_path: str) -> None:
    if not os.path.exists(state_path):
        _die(2, f"agy-bridge: no permission install-state at {state_path} — nothing to uninstall.")
    state = _load_config(state_path)
    settings_path = state.get("managedSettingsPath")
    if not isinstance(settings_path, str):
        _die(4, f"agy-bridge: permission install-state {state_path} has no managedSettingsPath")

    # DECIDE BEFORE MUTATING. Per rule: the operator already had it before us → it is theirs; leave
    # it. Reads a v1 state (single `rule`) as well as v2, so an uninstall from an older install-state
    # still removes exactly what that install added and nothing else.
    #
    # This runs FIRST, ahead of every write and removal, because a refusal has to leave the world
    # untouched. It used to be computed inside the settings-exists branch and then, for a host whose
    # settings file was gone, first reached only in the closing message — AFTER `os.remove(state_path)`
    # had already run. A malformed state on such a host was "refused" with the state file deleted:
    # the one record of what we owed the operator, destroyed by the safety check itself.
    ours = _owned_rules(state)

    if os.path.islink(settings_path):
        _die(3, f"agy-bridge: refusing to uninstall — {settings_path} became a symlink since install "
                f"(someone else's SSOT now). Resolve by hand.")

    if os.path.exists(settings_path):
        data = _load_config(settings_path)
        perms = data.get("permissions")
        if isinstance(perms, dict):
            allow = perms.get("allow")
            if isinstance(allow, list) and ours:
                perms["allow"] = [r for r in allow if r not in ours]
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
    what = " ".join(ours) if ours else "(nothing — every rule was already the operator's)"
    sys.stdout.write(f"uninstalled {what} from {settings_path}\n")


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
    # SCOPE is part of the truth. `mcp(*)` and the server-wide `mcp(entwurf-bridge)` shadow every
    # tool we grant; an exact rule like `mcp(entwurf-bridge/entwurf_self)` shadows ONLY that one and
    # the other tools keep working. Both are red — but telling an operator that every entwurf call
    # is blocked when only `entwurf_self` is would send them hunting the wrong thing. Broad first,
    # so a host carrying both is described by the rule that actually covers the most.
    # TWO passes over ALL the shadowing lists, not one pass per list. Broad-most-covering is a
    # statement about the whole file: a deny of one exact tool alongside an ask of the server-wide
    # rule is a host where EVERYTHING is shadowed, and reporting the exact hit merely because `deny`
    # is scanned first would tell the operator "your other grants still work" while agy prompts on
    # all of them. Precedence still decides WHICH list to name once the scope is settled.
    for rule_set, scope in ((BROAD_RULES, "broad"), (ALLOW_RULES, "exact")):
        for list_name in SHADOWING_LISTS:
            rules = perms.get(list_name)
            if not isinstance(rules, list):
                continue
            for rule in rules:
                if rule in rule_set:
                    sys.stdout.write(f"shadowed-by-{list_name} {scope} {rule}\n")
                    return

    allow = perms.get("allow")
    if isinstance(allow, list):
        # EVERY tool we grant must be granted. A partial set is not a working surface: agy stops for
        # a y/n on whichever tool is missing, which is the same "registered and unusable" state the
        # doctor already refuses to call green — it was simply never checked past entwurf_v2.
        if all(rule in allow for rule in ALLOW_RULES):
            sys.stdout.write("configured\n")
            return
        # Not every rule of ours is here, but a BROADER operator rule in the same list already
        # matches our tools. agy will not prompt; the calls work. Say so — and say whose rule is
        # carrying it, because the day the operator narrows that wildcard, the unowned grant goes.
        for rule in MATCHING_RULES:
            if rule not in ALLOW_RULES and rule in allow:
                sys.stdout.write(f"covered-by-allow {rule}\n")
                return
        missing = [rule for rule in ALLOW_RULES if rule not in allow]
        if len(missing) != len(ALLOW_RULES):
            # Some of ours are present and some are not: name the gap rather than report a flat
            # "nothing granted", which would read as "install never ran" on a half-granted host.
            sys.stdout.write(f"partially-configured {' '.join(missing)}\n")
            return
    sys.stdout.write("not-configured\n")


def cmd_permission_state_doctor(state_path: str) -> None:
    """Is the ownership record itself readable? One token line: `absent` / `ok <n>` / `corrupt <why>`.

    Hard rule 13 — runtime truth and OWNERSHIP truth are separate axes. The settings file can carry
    all three exact rules (runtime perfectly fine, agy prompts on nothing) while the state that says
    WHICH of them are ours is unreadable. The permission doctor reads settings and would call that
    host `configured`; the independent state check read only `managedSettingsPath` and agreed. So a
    corrupt ownership record rounded up to a green overall verdict, and the operator would learn
    about it at uninstall time — the worst possible moment to discover we cannot tell their rules
    from ours. Same parser as install/uninstall, so there is exactly one definition of readable.
    """
    if not os.path.exists(state_path):
        sys.stdout.write("absent\n")
        return
    try:
        state = _load_config(state_path)
    except SystemExit:
        sys.stdout.write("corrupt not valid JSON\n")
        return
    try:
        rules, _existed = _parse_permission_state(state)
    except _PermissionStateError as exc:
        sys.stdout.write(f"corrupt {exc}\n")
        return
    sys.stdout.write(f"ok {len(rules)}\n")


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
    elif sub == "permission-state-doctor":
        if len(argv) != 3:
            _die(5, "usage: agy-bridge-config.py permission-state-doctor <state_path>")
        cmd_permission_state_doctor(argv[2])
    elif sub == "permission-rules":
        if len(argv) != 2:
            _die(5, "usage: agy-bridge-config.py permission-rules")
        # The shell renders these in operator messages. It reads them from HERE rather than
        # repeating the strings, so the rule set has exactly one source and a tool added to
        # ALLOW_RULES can never drift out of what the doctor tells the operator to fix.
        sys.stdout.write(" ".join(ALLOW_RULES) + "\n")
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
