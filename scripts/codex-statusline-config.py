#!/usr/bin/env python3
"""codex-statusline-config — stateful `[tui].status_line` adapter; stdlib only.

One reversible atom in `$CODEX_HOME/config.toml`: ensure the TUI's closed-enum
status line INCLUDES `thread-title` — the only carrier that can hold a visible
garden id (measured S1b-B in scripts/raw-codex-measure/README.md: an explicitly
set name survives auto-titling in both orderings). The atom owns exactly the
`thread-title` MEMBERSHIP, never the list: operator items, their order and
their bytes survive untouched (a text insert right after the opening bracket,
not a re-serialization), and the inverse removes exactly the snippet that was
added. `status_line` is snake_case in TOML — the vendor's own key on this host.

Refuses, with the offending name in the message: a symlinked config (someone
else's SSOT), malformed TOML, a foreign install-state, a state retargeted at
another config path, and an explicit contrary operator value by name — a
`status_line` that is not an array of items is the operator's decision, not
drift to overwrite.

The doctor judges EFFECTIVE thread-title from the config alone, independent of
the state receipt (the operator may set it themselves — that is green, not
drift). Its subject is that REQUIRED visible-identity axis, so a present item is
the only green and every other effective token is red; the state never rescues
one, it only annotates ownership and adds `drift` when our receipt binds the
file whose item is gone.
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
    find_direct_key,
    find_table_family,
    now,
    parse_toml,
    read_text,
    render_file,
    render_string_array,
    scan_lines,
    span_text,
    span_value,
    splice,
)

STATE_SCHEMA_VERSION = 1
ATOM = "codex-statusline"
TUI_PATH = ("tui",)
STATUSLINE_KEY = "status_line"
REQUIRED_ITEM = "thread-title"
STATE_REQUIRED = (
    "managedConfigPath",
    "atom",
    "detectMode",
    "configExistedBefore",
    "tuiTableExisted",
    "statusLineExisted",
    "statusLinePreimage",
    "postimageSpan",
    "snippet",
    "installedAt",
)

# detectMode → what the inverse takes back:
#   created-new     the whole file (we made it; only if nothing else remains)
#   appended-table  the [tui] block we appended (only if it is still only ours)
#   inserted-key    the `status_line = [...]` key lines we inserted
#   merged-item     the exact `"thread-title", ` snippet spliced after `[`
#   already-present nothing — the operator had it before we ever ran


def load_state(state_path: str) -> dict | None:
    raw = read_text(state_path, "install-state")
    if raw is None:
        return None
    if not raw.strip():
        die(4, f"codex-statusline: install-state {state_path} is empty — refusing to guess")
    try:
        state = json.loads(raw)
    except ValueError as error:
        die(4, f"codex-statusline: install-state {state_path} is not valid JSON: {error}")
    if not isinstance(state, dict):
        die(4, f"codex-statusline: install-state {state_path} top-level must be a JSON object")
    return state


def checked_state(state_path: str) -> dict:
    state = load_state(state_path)
    if state is None:
        die(2, f"codex-statusline: no install-state at {state_path} — nothing to undo")
    if state.get("schemaVersion") != STATE_SCHEMA_VERSION:
        die(4, f"codex-statusline: install-state {state_path} is not schemaVersion {STATE_SCHEMA_VERSION} — refusing")
    atom = state.get("atom")
    if atom != ATOM:
        die(4, f"codex-statusline: install-state {state_path} belongs to atom {atom!r}, not {ATOM!r} — refusing to touch it")
    if any(key not in state for key in STATE_REQUIRED):
        die(4, f"codex-statusline: install-state {state_path} has an unsupported shape — refusing")
    path = state.get("managedConfigPath")
    if not isinstance(path, str) or not os.path.isabs(path):
        die(4, f"codex-statusline: install-state {state_path} has no absolute managedConfigPath")
    return state


def prior_state(state_path: str, config_path: str) -> dict | None:
    state = load_state(state_path)
    if state is None:
        return None
    if state.get("schemaVersion") != STATE_SCHEMA_VERSION or state.get("atom") != ATOM:
        checked_state(state_path)  # the honest, named refusal
    if state.get("managedConfigPath") != os.path.abspath(config_path):
        die(
            3,
            f"codex-statusline: install-state {state_path} is bound to {state.get('managedConfigPath')}, "
            f"not {os.path.abspath(config_path)} — refusing to retarget an install onto another config",
        )
    return checked_state(state_path)


def classify(parsed: dict) -> tuple[str, object]:
    """`(tui-shape, status_line-value)`; tui-shape is `table`, `refuse:<name>`,
    or `not-line-shaped` only in combination with the span search."""
    tui = deep_get(parsed, TUI_PATH)
    if tui is None:
        return "absent", None
    if not isinstance(tui, dict):
        return "refuse:tui", tui
    value = tui.get(STATUSLINE_KEY)
    if value is None:
        return "no-key", None
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        return "refuse:status_line", value
    return "has-key", value


def install(config_path: str, state_path: str) -> None:
    if os.path.islink(config_path):
        die(3, f"codex-statusline: refusing to adopt {config_path} — symlink to {os.readlink(config_path)} (someone else's SSOT)")
    if os.path.exists(config_path) and not os.path.isfile(config_path):
        die(4, f"codex-statusline: refusing: {config_path} exists and is not a regular file")

    text = read_text(config_path, "config")
    parsed = parse_toml(text if text is not None else "", f"config {config_path}") if text is not None else {}
    shape, value = classify(parsed)
    if shape.startswith("refuse:"):
        name = shape.split(":", 1)[1]
        die(
            3,
            f"codex-statusline: refusing: {'.'.join(TUI_PATH)}{'.' + STATUSLINE_KEY if name == STATUSLINE_KEY else ''} in {config_path} "
            f"is explicitly a {type(value).__name__}, not {'an array of status-line items' if name == STATUSLINE_KEY else 'a table'}. "
            "That is the operator's decision, not drift — entwurf will not overwrite it by name.",
        )

    lines = (text if text is not None else "").split("\n")
    infos = scan_lines(lines)
    tui_family = find_table_family(lines, infos, TUI_PATH)
    key_span = find_direct_key(lines, infos, tui_family[0], tui_family[1], STATUSLINE_KEY) if tui_family is not None else None
    if shape in ("has-key", "no-key") and tui_family is None:
        die(
            4,
            f"codex-statusline: [tui] in {config_path} exists but not as a literal table block "
            "(inline/dotted form) — this writer owns only line-shaped tables and refuses to touch it",
        )
    if shape == "has-key" and key_span is None:
        die(
            4,
            f"codex-statusline: `tui.{STATUSLINE_KEY}` in {config_path} exists but not as a literal `key = value` line "
            "(dotted/inline form) — this writer owns only line-shaped keys and refuses to touch it",
        )

    canonical_line = f"{STATUSLINE_KEY} = {render_string_array([REQUIRED_ITEM])}"
    prior = prior_state(state_path, config_path)

    if shape == "has-key":
        if REQUIRED_ITEM in value:
            mode = "already-present"
            new_lines = lines  # untouched: the strongest idempotence is no write at all
            preimage = span_text(lines, key_span[0], key_span[1] + 1)
            postimage_span = preimage
            snippet = None
        else:
            mode = "merged-item"
            preimage = span_text(lines, key_span[0], key_span[1] + 1)
            snippet = f'"{REQUIRED_ITEM}", ' if value else f'"{REQUIRED_ITEM}"'
            old_span = preimage
            bracket = old_span.index("[", old_span.index("="))
            new_span = old_span[: bracket + 1] + snippet + old_span[bracket + 1:]
            # The scanner's own receipt: the merged span must parse to exactly
            # the old list with our item prepended, or we refuse to splice it.
            merged_value = span_value(new_span, "merged status_line").get(STATUSLINE_KEY)
            if merged_value != [REQUIRED_ITEM] + list(value):
                die(7, "codex-statusline: internal refusal: merged status_line span does not re-parse to old items + thread-title")
            postimage_span = new_span
            new_lines = splice(lines, key_span[0], key_span[1] + 1, new_span.split("\n"))
    elif shape == "no-key":
        mode = "inserted-key"
        preimage = None
        postimage_span = canonical_line
        snippet = None
        new_lines = lines[: tui_family[0] + 1] + [canonical_line] + lines[tui_family[0] + 1:]
    elif shape == "absent":
        block = [f"[{TUI_PATH[0]}]", canonical_line]
        if text is None:
            mode = "created-new"
            new_lines = list(block)
        else:
            mode = "appended-table"
            new_lines = append_block(lines, block)
        preimage = None
        postimage_span = canonical_line
        snippet = None
    else:  # pragma: no cover — classify() exhausted above
        die(7, f"codex-statusline: internal: unhandled shape {shape!r}")

    if prior is None:
        state = {
            "schemaVersion": STATE_SCHEMA_VERSION,
            "managedConfigPath": os.path.abspath(config_path),
            "atom": ATOM,
            "detectMode": mode,
            "configExistedBefore": text is not None,
            "tuiTableExisted": shape in ("has-key", "no-key"),
            "statusLineExisted": shape == "has-key",
            # The FIRST preimage, captured once; a reinstall never re-captures.
            "statusLinePreimage": preimage,
            "postimageSpan": postimage_span,
            "snippet": snippet,
            "installedAt": now(),
        }
    else:
        state = prior

    candidate = render_file(new_lines)
    _, after = assert_blast_radius(text, candidate, TUI_PATH + (STATUSLINE_KEY,), f"config {config_path}")
    effective = deep_get(after, TUI_PATH + (STATUSLINE_KEY,))
    if shape == "has-key":
        expected = list(value) if mode == "already-present" else [REQUIRED_ITEM] + list(value)
    else:
        expected = [REQUIRED_ITEM]
    if effective != expected:
        die(7, f"codex-statusline: internal refusal: candidate status_line is not the operator's items plus thread-title")

    # The receipt is durable BEFORE the operator's config is ever touched: it
    # already carries the exact preimage/snippet of the bytes about to be
    # replaced (or a prior receipt's, on a re-run). A crash or write failure
    # between here and the config write below leaves the operator's config
    # untouched and the receipt correct — a retry resumes from it instead of
    # mistaking our own canonical postimage for a fresh operator preimage.
    atomic_write_state(state_path, state)
    if candidate != (text if text is not None else ""):
        atomic_write(config_path, candidate, prefix=".codex-sl-")
    sys.stdout.write(f"{mode} {os.path.abspath(config_path)}\n")


def _current_key_span(config_path: str, text: str):
    """Locate the CURRENT status_line key span (fresh bytes, never cached) and
    its parsed value; `not-line-shaped` is refused here too."""
    parsed = parse_toml(text, f"config {config_path}")
    shape, value = classify(parsed)
    if shape.startswith("refuse:"):
        die(4, f"codex-statusline: {config_path} now carries an explicit contrary value under `tui`/`{STATUSLINE_KEY}` — refusing to guess; fix it yourself")
    lines = text.split("\n")
    infos = scan_lines(lines)
    tui_family = find_table_family(lines, infos, TUI_PATH)
    key_span = find_direct_key(lines, infos, tui_family[0], tui_family[1], STATUSLINE_KEY) if tui_family is not None else None
    return parsed, shape, value, lines, infos, tui_family, key_span


def uninstall(state_path: str) -> None:
    state = checked_state(state_path)
    config_path = state["managedConfigPath"]
    mode = state["detectMode"]
    if os.path.islink(config_path):
        die(3, f"codex-statusline: refusing to uninstall — {config_path} became a symlink (someone else's SSOT)")

    text = read_text(config_path, "config")
    if text is None:
        os.remove(state_path)
        sys.stdout.write(f"uninstalled {config_path} (config already absent)\n")
        return
    parsed, shape, value, lines, infos, tui_family, key_span = _current_key_span(config_path, text)

    if mode == "already-present":
        os.remove(state_path)  # nothing was taken; nothing is given back
        sys.stdout.write(f"uninstalled {config_path} (already present before install; nothing to take back)\n")
        return

    if key_span is None:
        if shape == "has-key" and REQUIRED_ITEM in value:
            # `tui`/`status_line` is gone by NAME but the path still holds
            # thread-title — reshaped into inline/dotted TOML. This writer
            # cannot span-edit that shape; treating it as absent would
            # silently drop the receipt over an item we never actually took
            # back. Refuse and keep the receipt so the operator can repair it.
            die(
                3,
                f"codex-statusline: refusing to uninstall — `tui.{STATUSLINE_KEY}` in {config_path} exists but not "
                "as a literal `key = value` line (dotted/inline form) — this writer owns only line-shaped keys "
                "and refuses to guess; the receipt is retained",
            )
        # else: thread-title is genuinely absent — our membership was taken
        # back by hand, or vanished along with the key/table itself.
        os.remove(state_path)
        sys.stdout.write(f"uninstalled {config_path} (status_line already absent)\n")
        return

    current_span = span_text(lines, key_span[0], key_span[1] + 1)
    current_value = value if shape == "has-key" else None

    if mode == "merged-item":
        if current_span != state["postimageSpan"]:
            if isinstance(current_value, list) and REQUIRED_ITEM not in current_value:
                os.remove(state_path)  # operator removed our item themselves
                sys.stdout.write(f"uninstalled {config_path} (thread-title already removed)\n")
                return
            die(
                6,
                f"codex-statusline: refusing: `tui.{STATUSLINE_KEY}` in {config_path} changed since install "
                "(operator edits present). Remove 'thread-title' yourself if you want it gone.",
            )
        snippet = state["snippet"]
        if not isinstance(snippet, str) or snippet not in current_span:
            die(7, "codex-statusline: internal refusal: recorded snippet is not in the recorded span")
        restored = current_span.replace(snippet, "", 1)
        restored_value = span_value(restored, "restored status_line").get(STATUSLINE_KEY)
        preimage = state["statusLinePreimage"]
        preimage_value = span_value(preimage, "preimage status_line").get(STATUSLINE_KEY) if preimage else None
        if restored_value != preimage_value:
            die(7, "codex-statusline: internal refusal: snippet removal does not reproduce the preimage value")
        candidate_lines = splice(lines, key_span[0], key_span[1] + 1, restored.split("\n"))
    elif mode in ("inserted-key", "appended-table", "created-new"):
        if current_span != state["postimageSpan"]:
            if isinstance(current_value, list) and REQUIRED_ITEM not in current_value:
                os.remove(state_path)
                sys.stdout.write(f"uninstalled {config_path} (thread-title already removed)\n")
                return
            die(
                6,
                f"codex-statusline: refusing: `tui.{STATUSLINE_KEY}` in {config_path} changed since install "
                "(operator edits present). Remove it yourself if you want it gone.",
            )
        candidate_lines = splice(lines, key_span[0], key_span[1] + 1, [])
        # A [tui] block that WE appended and that now holds nothing else goes
        # away whole; an operator's [tui] header always stays.
        if not state["tuiTableExisted"] and tui_family is not None:
            rescanned = scan_lines(candidate_lines)
            family = find_table_family(candidate_lines, rescanned, TUI_PATH)
            if family is not None:
                family_body = span_text(candidate_lines, family[0] + 1, family[1])
                if not [line for line in family_body.split("\n") if line.strip()]:
                    candidate_lines = splice(candidate_lines, family[0], family[1], [])
    else:
        die(4, f"codex-statusline: install-state {state_path} has unknown detectMode {mode!r}")

    candidate = render_file(candidate_lines)
    assert_blast_radius(text, candidate, TUI_PATH + (STATUSLINE_KEY,), f"config {config_path}")
    if state["detectMode"] == "created-new" and state["configExistedBefore"] is False and not [l for l in candidate_lines if l.strip()]:
        os.remove(config_path)
        os.remove(state_path)
        sys.stdout.write(f"uninstalled {config_path} (file removed)\n")
        return
    atomic_write(config_path, candidate, prefix=".codex-sl-")
    os.remove(state_path)  # the receipt is deleted LAST
    sys.stdout.write(f"uninstalled {config_path}\n")


def effective_token(config_path: str) -> str:
    """The EFFECTIVE verdict, judged from the config alone — never the state."""
    if os.path.islink(config_path):
        return "symlink"
    text = read_text(config_path, "config")
    if text is None or not text.strip():
        return "file-absent"
    try:
        parsed = parse_toml(text, f"config {config_path}")
    except SystemExit:
        return "invalid-toml"
    shape, value = classify(parsed)
    if shape in ("absent", "no-key"):
        return "status-line-absent"
    if shape.startswith("refuse:"):
        return "malformed-value"
    return "thread-title-present" if REQUIRED_ITEM in value else "thread-title-absent"


def doctor_static(config_path: str, state_path: str) -> None:
    """One line, two axes: `<effective> <ownership>[ drift]`. The effective
    token is computed without ever reading the receipt; ownership annotates and
    never rescues. GREEN (exit 0) is exactly `thread-title-present`, owned or
    unowned — an unowned file that already carries the item is green, and every
    other effective token is RED because this doctor's subject is the REQUIRED
    visible-identity axis, not our bookkeeping. Ownership still distinguishes
    the two reds an operator repairs differently: `drift` means our receipt
    binds this file and our item is gone (repair in place), while a bare
    `<effective> unowned` means the axis was never established here."""
    effective = effective_token(config_path)
    state = load_state(state_path)
    owned = (
        state is not None
        and state.get("schemaVersion") == STATE_SCHEMA_VERSION
        and state.get("atom") == ATOM
        and state.get("managedConfigPath") == os.path.abspath(config_path)
    )
    ownership = "owned" if owned else "unowned"
    if effective != "thread-title-present":
        sys.stdout.write(f"{effective} {ownership}{' drift' if owned else ''}\n")
        raise SystemExit(1)
    sys.stdout.write(f"{effective} {ownership}\n")


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        die(5, "usage: codex-statusline-config.py <install config state|uninstall state|doctor-static config state>")
    verb = argv[1]
    if verb == "install" and len(argv) == 4:
        install(argv[2], argv[3])
    elif verb == "uninstall" and len(argv) == 3:
        uninstall(argv[2])
    elif verb == "doctor-static" and len(argv) == 4:
        doctor_static(argv[2], argv[3])
    else:
        die(5, "usage: codex-statusline-config.py <install config state|uninstall state|doctor-static config state>")


if __name__ == "__main__":
    main(sys.argv)
