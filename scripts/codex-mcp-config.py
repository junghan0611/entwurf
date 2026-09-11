#!/usr/bin/env python3
"""codex-mcp-config — stateful `[mcp_servers.entwurf-bridge]` adapter; stdlib only.

One reversible atom in `$CODEX_HOME/config.toml`: the entwurf-bridge MCP server
entry in the MEASURED stdio shape (`command` written by `codex mcp add`, M3 in
scripts/raw-codex-measure/README.md), the vendor-supported `env_vars` allowlist
that forwards the operator-owned app-server context without storing its values,
plus the one literal provenance env value
`ENTWURF_BRIDGE_NATIVE_HOST = "codex"` — a local ownership/drift atom, never
cryptographic authentication. `codex mcp add` is never called because it has
no exact inverse; this writer owns exactly the table-family lines it touches
(codex_toml_io), captures the operator's first preimage once, and restores it
byte-exact.

Refuses, with the offending name in the message: a symlinked config (someone
else's SSOT), malformed TOML, a foreign/no-state collision it cannot attribute,
a state retargeted at another config path, and explicit contrary operator
values by name — an `url` entry (the vendor's streamable_http transport) or an
`enabled = false` entry are the operator's decisions, not drift to overwrite.

Doctor separates the two axes the run.sh wiring composes later: the FIRST
token is effective runtime validity judged from the config alone, the SECOND
is ownership judged from the install state; `doctor-invocation` prints the
exact stdio invocation so the wiring can boot-prove the configured command is
the stable entwurf-bridge bin.
"""

from __future__ import annotations

import json
import os
import sys
sys.dont_write_bytecode = True

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from codex_toml_io import (  # noqa: E402
    append_block,
    assert_blast_radius,
    atomic_write,
    atomic_write_state,
    deep_get,
    die,
    find_table_family,
    now,
    parse_toml,
    read_text,
    render_file,
    scan_lines,
    span_text,
    splice,
    toml_string,
)

STATE_SCHEMA_VERSION = 1
ATOM = "codex-mcp"
SERVER_KEY = "entwurf-bridge"
SERVER_PATH = ("mcp_servers", SERVER_KEY)
PROVENANCE_ENV = "ENTWURF_BRIDGE_NATIVE_HOST"
PROVENANCE_VALUE = "codex"
CONTEXT_ENV_VARS = (
    "CODEX_HOME",
    "ENTWURF_DIR",
    "PI_CODING_AGENT_DIR",
    "ENTWURF_META_SESSIONS_DIR",
    "ENTWURF_META_MAILBOX_DIR",
    "ENTWURF_META_SENDERS_DIR",
    "ENTWURF_META_RECEIVERS_DIR",
    "TMUX",
    "TMUX_PANE",
)
STATE_REQUIRED = (
    "managedConfigPath",
    "atom",
    "serverKey",
    "command",
    "detectMode",
    "configExistedBefore",
    "entryExistedBefore",
    "preimage",
    "installedAt",
)


def canonical_block(command: str) -> list[str]:
    forwarded = ", ".join(toml_string(name) for name in CONTEXT_ENV_VARS)
    return [
        f"[mcp_servers.{SERVER_KEY}]",
        f"command = {toml_string(command)}",
        f"env_vars = [{forwarded}]",
        f"[mcp_servers.{SERVER_KEY}.env]",
        f"{PROVENANCE_ENV} = {toml_string(PROVENANCE_VALUE)}",
    ]


def canonical_semantics(command: str) -> dict:
    return {
        "command": command,
        "env_vars": list(CONTEXT_ENV_VARS),
        "env": {PROVENANCE_ENV: PROVENANCE_VALUE},
    }

def load_state(state_path: str) -> dict | None:
    raw = read_text(state_path, "install-state")
    if raw is None:
        return None
    if not raw.strip():
        die(4, f"codex-mcp: install-state {state_path} is empty — refusing to guess")
    try:
        state = json.loads(raw)
    except ValueError as error:
        die(4, f"codex-mcp: install-state {state_path} is not valid JSON: {error}")
    if not isinstance(state, dict):
        die(4, f"codex-mcp: install-state {state_path} top-level must be a JSON object")
    return state


def checked_state(state_path: str) -> dict:
    state = load_state(state_path)
    if state is None:
        die(2, f"codex-mcp: no install-state at {state_path} — nothing to undo")
    if state.get("schemaVersion") != STATE_SCHEMA_VERSION:
        die(4, f"codex-mcp: install-state {state_path} is not schemaVersion {STATE_SCHEMA_VERSION} — refusing")
    atom = state.get("atom")
    if atom != ATOM:
        # A foreign state: another atom's receipt sitting on our path. Never
        # silently overwritten, never adopted — attribution first.
        die(4, f"codex-mcp: install-state {state_path} belongs to atom {atom!r}, not {ATOM!r} — refusing to touch it")
    if state.get("serverKey") != SERVER_KEY:
        die(4, f"codex-mcp: install-state {state_path} serverKey is not {SERVER_KEY} — refusing")
    if any(key not in state for key in STATE_REQUIRED):
        die(4, f"codex-mcp: install-state {state_path} has an unsupported shape — refusing")
    path = state.get("managedConfigPath")
    if not isinstance(path, str) or not os.path.isabs(path):
        die(4, f"codex-mcp: install-state {state_path} has no absolute managedConfigPath")
    return state


def prior_state(state_path: str, config_path: str) -> dict | None:
    state = load_state(state_path)
    if state is None:
        return None
    if state.get("schemaVersion") != STATE_SCHEMA_VERSION or state.get("atom") != ATOM:
        # Route through checked_state for the honest, named refusal.
        checked_state(state_path)
    if state.get("managedConfigPath") != os.path.abspath(config_path):
        die(
            3,
            f"codex-mcp: install-state {state_path} is bound to {state.get('managedConfigPath')}, "
            f"not {os.path.abspath(config_path)} — refusing to retarget an install onto another config",
        )
    checked = checked_state(state_path)
    return checked


def classify_entry(parsed: dict) -> tuple[str, dict | None]:
    """The entry's effective verdict and its parsed value (None when absent).
    `refuse:<name>` verdicts are the explicit contrary operator values."""
    entry = deep_get(parsed, SERVER_PATH)
    if entry is None:
        return "absent", None
    if not isinstance(entry, dict):
        return "refuse:not-a-table", entry
    if "url" in entry and "command" not in entry:
        return "refuse:url", entry
    if entry.get("enabled") is False:
        return "refuse:enabled", entry
    if "command" not in entry:
        return "refuse:no-command", entry
    return "stdio", entry


def install(config_path: str, command: str, state_path: str) -> None:
    if os.path.islink(config_path):
        die(3, f"codex-mcp: refusing to adopt {config_path} — symlink to {os.readlink(config_path)} (someone else's SSOT)")
    if os.path.exists(config_path) and not os.path.isfile(config_path):
        die(4, f"codex-mcp: refusing: {config_path} exists and is not a regular file")

    text = read_text(config_path, "config")
    parsed = parse_toml(text if text is not None else "", f"config {config_path}") if text is not None else {}
    verdict, entry = classify_entry(parsed)
    if verdict.startswith("refuse:"):
        name = verdict.split(":", 1)[1]
        die(
            3,
            f"codex-mcp: refusing: [mcp_servers.{SERVER_KEY}] in {config_path} explicitly sets "
            f"`{name}` ({'streamable_http transport, not stdio' if name == 'url' else 'the server is explicitly disabled' if name == 'enabled' else 'no stdio command'}). "
            "That is the operator's decision, not drift — entwurf will not overwrite it by name.",
        )

    lines = (text if text is not None else "").split("\n")
    infos = scan_lines(lines)
    family = find_table_family(lines, infos, SERVER_PATH)
    if entry is not None and family is None:
        die(
            4,
            f"codex-mcp: [mcp_servers.{SERVER_KEY}] in {config_path} exists but not as a literal table block "
            "(inline/dotted form) — this writer owns only line-shaped tables and refuses to touch it",
        )

    prior = prior_state(state_path, config_path)
    if prior is None:
        state = {
            "schemaVersion": STATE_SCHEMA_VERSION,
            "managedConfigPath": os.path.abspath(config_path),
            "atom": ATOM,
            "serverKey": SERVER_KEY,
            "command": command,
            "detectMode": "adopt-regular-file" if text is not None else "created-new",
            "configExistedBefore": text is not None,
            "entryExistedBefore": family is not None,
            # The FIRST preimage, captured once: the exact bytes of the table
            # family we superseded (or null when we appended to empty space).
            "preimage": span_text(lines, family[0], family[1]) if family is not None else None,
            "installedAt": now(),
        }
    else:
        state = prior
        state["command"] = command  # our recorded intent follows a re-run; preimages never do

    block = canonical_block(command)
    if family is not None:
        candidate_lines = splice(lines, family[0], family[1], block)
    else:
        candidate_lines = append_block(lines, block) if text is not None else list(block)
    candidate = render_file(candidate_lines)

    _, after = assert_blast_radius(text, candidate, SERVER_PATH, f"config {config_path}")
    if deep_get(after, SERVER_PATH) != canonical_semantics(command):
        die(7, f"codex-mcp: internal refusal: candidate entry is not the canonical stdio shape")

    # The receipt is durable BEFORE the operator's config is ever touched: it
    # already carries the exact preimage of the bytes about to be replaced
    # (or a prior receipt's preimage, on a re-run). A crash or write failure
    # between here and the config write below leaves the operator's config
    # untouched and the receipt correct — a retry resumes from it instead of
    # mistaking our own canonical block for a fresh operator preimage.
    atomic_write_state(state_path, state)
    # Strongest idempotence is an untouched file: same bytes, same mtime.
    if candidate != (text if text is not None else ""):
        atomic_write(config_path, candidate, prefix=".codex-mcp-")
    sys.stdout.write(f"{state['detectMode']} {os.path.abspath(config_path)}\n")


def uninstall(state_path: str) -> None:
    state = checked_state(state_path)
    config_path = state["managedConfigPath"]
    if os.path.islink(config_path):
        die(3, f"codex-mcp: refusing to uninstall — {config_path} became a symlink (someone else's SSOT)")

    text = read_text(config_path, "config")
    if text is None:
        os.remove(state_path)  # the config is already gone; the receipt outlived its target
        sys.stdout.write(f"uninstalled {config_path} (config already absent)\n")
        return
    parsed = parse_toml(text, f"config {config_path}")
    entry = deep_get(parsed, SERVER_PATH)
    lines = text.split("\n")
    infos = scan_lines(lines)
    family = find_table_family(lines, infos, SERVER_PATH)

    if family is not None:
        expected = canonical_semantics(state["command"])
        if entry != expected:
            die(
                3,
                f"codex-mcp: refusing to uninstall — [{'.'.join(SERVER_PATH)}] drifted from the "
                "exact post-install table. Removing it would delete operator edits; repair or remove "
                "those edits deliberately, then re-run the inverse",
            )
        preimage = state.get("preimage")
        if preimage is None:
            candidate_lines = splice(lines, family[0], family[1], [])
        else:
            candidate_lines = splice(lines, family[0], family[1], preimage.split("\n"))
        candidate = render_file(candidate_lines)
        _, after = assert_blast_radius(text, candidate, SERVER_PATH, f"config {config_path}")
        if preimage is not None:
            # Restoring must reproduce the superseded entry exactly (it is a
            # byte splice; this guards the scanner, not the operator).
            preimage_doc = parse_toml(preimage, "preimage block")
            if deep_get(preimage_doc, SERVER_PATH) != deep_get(after, SERVER_PATH):
                die(7, "codex-mcp: internal refusal: preimage splice changed the entry's meaning")
        if state.get("detectMode") == "created-new" and not [l for l in candidate_lines if l.strip()]:
            # We created this file; the inverse removes it.
            os.remove(config_path)
            os.remove(state_path)
            sys.stdout.write(f"uninstalled {config_path} (file removed)\n")
            return
        atomic_write(config_path, candidate, prefix=".codex-mcp-")
    elif entry is not None:
        # The table is gone by NAME but the path is still populated — the
        # operator (or the vendor) reshaped it into inline/dotted TOML. This
        # writer cannot span-edit that shape; treating it as absent would
        # silently drop the receipt over an entry we never actually took
        # back. Refuse and keep the receipt so the operator can repair it.
        die(
            3,
            f"codex-mcp: refusing to uninstall — [{'.'.join(SERVER_PATH)}] in {config_path} exists but not as a "
            "literal table block (inline/dotted form) — this writer owns only line-shaped tables and refuses to "
            "guess; the receipt is retained",
        )
    # else: the entry is genuinely gone — never resurrect a removed table.

    os.remove(state_path)  # the receipt is deleted LAST, after the config is honest
    sys.stdout.write(f"uninstalled {config_path}\n")

def _ownership(state_path: str, config_path: str) -> tuple[str, dict | None]:
    """(ownership token, state) — `unowned` when no readable receipt of OUR
    atom binds THIS config path. A foreign or retargeted receipt is not an
    ownership claim, so the doctor reports unowned and install refuses
    separately (checked_state names the collision)."""
    state = load_state(state_path)
    if state is None:
        return "unowned", None
    if (
        state.get("schemaVersion") != STATE_SCHEMA_VERSION
        or state.get("atom") != ATOM
        or state.get("managedConfigPath") != os.path.abspath(config_path)
    ):
        return "unowned", None
    return "owned", state

def _effective_entry(config_path: str) -> tuple[str, dict | None]:
    """The EFFECTIVE axis, judged from the config alone — never the state."""
    if os.path.islink(config_path):
        return "symlink", None
    text = read_text(config_path, "config")
    if text is None or not text.strip():
        return "file-absent", None
    try:
        parsed = parse_toml(text, f"config {config_path}")
    except SystemExit:
        return "invalid-toml", None
    verdict, entry = classify_entry(parsed)
    if verdict == "absent":
        return "not-configured", None
    if verdict == "refuse:url":
        return "http-transport", entry
    if verdict == "refuse:enabled":
        return "disabled", entry
    if verdict.startswith("refuse:"):
        return "malformed-entry", None
    return f"configured {entry.get('command')}", entry


def doctor_static(config_path: str, expected_command: str, state_path: str) -> None:
    """Two separated tokens on one line: `<effective> <ownership> [drift reason]`.
    The first token never reads the install state; the second never changes the
    first. RED (exit 1) only while a receipt binds here and the entry is not
    what we installed — an unowned-but-working entry is an honest note, not a
    failure (this host's operator ships exactly that shape)."""
    ownership, state = _ownership(state_path, config_path)
    effective, entry = _effective_entry(config_path)
    drift = None
    if ownership == "owned":
        if entry is None:
            drift = "entry-gone"
        elif effective == "http-transport":
            drift = "transport-replaced (url)"
        elif effective == "disabled":
            drift = "disabled (enabled = false)"
        else:
            reason = drift_reason(entry, expected_command)
            if reason is not None:
                drift = reason
    if drift is not None:
        sys.stdout.write(f"{effective} drift {drift}\n")
        raise SystemExit(1)
    sys.stdout.write(f"{effective} {ownership}\n")


def doctor_invocation(config_path: str) -> None:
    """The exact stdio invocation the vendor would spawn, as one JSON line —
    the input the run.sh wiring feeds `probe-bridge-command` to boot-prove the
    configured command is the stable entwurf-bridge bin."""
    effective, entry = _effective_entry(config_path)
    if not effective.startswith("configured "):
        sys.stdout.write(f"{effective}\n")
        raise SystemExit(1)
    args = entry.get("args", [])
    env = entry.get("env", {})
    if not isinstance(args, list) or not all(isinstance(item, str) for item in args):
        sys.stdout.write("malformed-entry (args is not an array of strings)\n")
        raise SystemExit(1)
    if not isinstance(env, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in env.items()):
        sys.stdout.write("malformed-entry (env is not a table of strings)\n")
        raise SystemExit(1)
    sys.stdout.write(json.dumps({"command": entry["command"], "args": args, "env": env}, separators=(",", ":")) + "\n")

def drift_reason(entry: dict, expected_command: str) -> str | None:
    if entry.get("command") != expected_command:
        return f"command-mismatch (configured {entry.get('command')!r}, installed {expected_command!r})"
    env = entry.get("env")
    if not isinstance(env, dict) or PROVENANCE_ENV not in env:
        return f"env-label-missing ({PROVENANCE_ENV})"
    if env.get(PROVENANCE_ENV) != PROVENANCE_VALUE:
        return f"env-label-foreign ({PROVENANCE_ENV}={env.get(PROVENANCE_ENV)!r})"
    env_vars = entry.get("env_vars")
    if not isinstance(env_vars, list) or not all(isinstance(name, str) for name in env_vars):
        return "context-env-vars-missing-or-malformed"
    missing = [name for name in CONTEXT_ENV_VARS if name not in env_vars]
    if missing:
        return f"context-env-vars-missing ({', '.join(missing)})"
    foreign = [name for name in env_vars if name not in CONTEXT_ENV_VARS]
    if foreign:
        return f"context-env-vars-foreign ({', '.join(foreign)})"
    if env_vars != list(CONTEXT_ENV_VARS):
        return "context-env-vars-reordered-or-duplicated"
    foreign_keys = sorted(set(entry) - {"command", "env_vars", "env"})
    if foreign_keys:
        return f"foreign-keys ({', '.join(foreign_keys)})"
    extra_env = sorted(set(env) - {PROVENANCE_ENV})
    if extra_env:
        return f"foreign-env-keys ({', '.join(extra_env)})"
    return None


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        die(5, "usage: codex-mcp-config.py <install config command state|uninstall state|doctor-static config command state|doctor-invocation config>")
    verb = argv[1]
    if verb == "install" and len(argv) == 5:
        install(argv[2], argv[3], argv[4])
    elif verb == "uninstall" and len(argv) == 3:
        uninstall(argv[2])
    elif verb == "doctor-static" and len(argv) == 5:
        doctor_static(argv[2], argv[3], argv[4])
    elif verb == "doctor-invocation" and len(argv) == 3:
        doctor_invocation(argv[2])
    else:
        die(5, "usage: codex-mcp-config.py <install config command state|uninstall state|doctor-static config command state|doctor-invocation config>")


if __name__ == "__main__":
    main(sys.argv)
