#!/usr/bin/env python3
"""codex-terminal-title-config — stateful `[tui].terminal_title` adapter; stdlib only.

One reversible atom in `$CODEX_HOME/config.toml`: ensure the TUI's closed-enum
TERMINAL TITLE list INCLUDES `thread-id`. That item renders the raw thread UUID
(`tui/src/bottom_pane/title_setup.rs:79-80` at rust-v0.153.4) into the OSC 0/2
title, which the multiplexer gives back as `#{pane_title}` — the ONE value a
`_meta.threadId` can be matched against to find the pane a Codex caller is
sitting in (#95 lane B). This is a PLACEMENT input only: the title is
operator-writable and forgeable, so identity and delivery keep the record +
`_meta` join (AGENTS.md Hard Rule 16).

Sibling of `codex-statusline-config.py` and deliberately its twin in shape: the
atom owns exactly the `thread-id` MEMBERSHIP, never the list. Operator items,
their order and their bytes survive untouched (a text insert right before the
closing bracket, not a re-serialization), and the inverse removes exactly the
snippet that was added.

TWO DIFFERENCES FROM THE STATUS-LINE ATOM, both measured, neither cosmetic:

  1. The seed list is `["activity", "project-name", "thread-id"]`, not the bare
     item. `activity` must lead because the herdr Codex detector keys on the
     spinner tokens and the `[ ! ] Action Required` prefix
     (herdr `src/detect/manifests/codex.toml`); seeding a title without it
     would silently retire that detection on this host.
  2. The item is APPENDED at the END of an existing operator list, where the
     status-line atom prepends. Same reason: a prepend would put `thread-id`
     ahead of `activity` on a host that already configured one.

Refuses, with the offending name in the message: a symlinked config (someone
else's SSOT), malformed TOML, a foreign install-state, a state retargeted at
another config path, and an explicit contrary operator value by name — a
`terminal_title` that is not an array of items is the operator's decision, not
drift to overwrite.

The doctor judges EFFECTIVE thread-id from the config alone, independent of the
state receipt (the operator may set it themselves — that is green, not drift).
Its subject is the REQUIRED caller-seat axis, so a present item is the only
green and every other effective token is red; the state never rescues one, it
only annotates ownership and adds `drift` when our receipt binds the file whose
item is gone.
"""

from __future__ import annotations

import json
import os
import sys
sys.dont_write_bytecode = True

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from codex_toml_io import (  # noqa: E402
    append_block,
    array_append_point,
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
ATOM = "codex-terminal-title"
TUI_PATH = ("tui",)
TITLE_KEY = "terminal_title"
REQUIRED_ITEM = "thread-id"
# The seeded list when the operator has no `terminal_title` at all. `activity`
# leads for the herdr detector (see the module docstring); `project-name` is
# what makes a seated title readable to a human at a glance.
SEED_ITEMS = ("activity", "project-name", REQUIRED_ITEM)
STATE_REQUIRED = (
    "managedConfigPath",
    "atom",
    "detectMode",
    "configExistedBefore",
    "tuiTableExisted",
    "terminalTitleExisted",
    "terminalTitlePreimage",
    "postimageSpan",
    "snippet",
    "installedAt",
)

# detectMode → what the inverse takes back:
#   created-new     the whole file (we made it; only if nothing else remains)
#   appended-table  the [tui] block we appended (only if it is still only ours)
#   inserted-key    the `terminal_title = [...]` key lines we inserted
#   merged-item     the exact `, "thread-id"` snippet appended to the list
#
# There is deliberately NO `already-present` mode on disk. An operator who wrote
# `thread-id` themselves is UNOWNED, and recording a receipt over their bytes
# would claim an edit we never made — the doctor would then answer `owned`, and
# `drift` (its "repair in place" red) would point at an item that was never
# ours. It also carried a real inverse bug: with such a receipt parked, a later
# reinstall after the operator removed the item DOES splice ours in while the
# stale receipt still says `already-present`, so the inverse reports "nothing to
# take back" and leaves our bytes in their file for good. Writing nothing at all
# is what makes that second install a normal `merged-item` with an honest
# inverse. `[측정 2026-09-16]` the same shape is still live in the
# `codex-statusline` sibling; widening this repair to it is a separate decision.


def load_state(state_path: str) -> dict | None:
    raw = read_text(state_path, "install-state")
    if raw is None:
        return None
    if not raw.strip():
        die(4, f"codex-terminal-title: install-state {state_path} is empty — refusing to guess")
    try:
        state = json.loads(raw)
    except ValueError as error:
        die(4, f"codex-terminal-title: install-state {state_path} is not valid JSON: {error}")
    if not isinstance(state, dict):
        die(4, f"codex-terminal-title: install-state {state_path} top-level must be a JSON object")
    return state


def checked_state(state_path: str) -> dict:
    state = load_state(state_path)
    if state is None:
        die(2, f"codex-terminal-title: no install-state at {state_path} — nothing to undo")
    if state.get("schemaVersion") != STATE_SCHEMA_VERSION:
        die(4, f"codex-terminal-title: install-state {state_path} is not schemaVersion {STATE_SCHEMA_VERSION} — refusing")
    atom = state.get("atom")
    if atom != ATOM:
        die(4, f"codex-terminal-title: install-state {state_path} belongs to atom {atom!r}, not {ATOM!r} — refusing to touch it")
    if any(key not in state for key in STATE_REQUIRED):
        die(4, f"codex-terminal-title: install-state {state_path} has an unsupported shape — refusing")
    path = state.get("managedConfigPath")
    if not isinstance(path, str) or not os.path.isabs(path):
        die(4, f"codex-terminal-title: install-state {state_path} has no absolute managedConfigPath")
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
            f"codex-terminal-title: install-state {state_path} is bound to {state.get('managedConfigPath')}, "
            f"not {os.path.abspath(config_path)} — refusing to retarget an install onto another config",
        )
    return checked_state(state_path)


def classify(parsed: dict) -> tuple[str, object]:
    """`(tui-shape, terminal_title-value)`; tui-shape is `table`, `refuse:<name>`,
    or `not-line-shaped` only in combination with the span search."""
    tui = deep_get(parsed, TUI_PATH)
    if tui is None:
        return "absent", None
    if not isinstance(tui, dict):
        return "refuse:tui", tui
    value = tui.get(TITLE_KEY)
    if value is None:
        return "no-key", None
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        return "refuse:terminal_title", value
    return "has-key", value


def _append_item(span: str, config_path: str) -> tuple[str, str]:
    """`(merged_span, snippet)` — the span with our item appended at the END of
    the operator's list, and the exact bytes that were added.

    The position and the separator both come from `array_append_point`, not
    from `rfind("]")`: a trailing comment, a `]` inside a string item, and the
    multi-line style whose last item already carries a comma each send a naive
    append to the wrong bytes (the last one emits `,,`). A span whose array
    that helper cannot locate is a SHAPE this writer does not own — a named
    refusal, not an internal error. The caller still re-parses the result and
    compares it to the operator's items plus ours, so the position has an
    independent oracle either way.
    """
    point = array_append_point(span, span.index("=") + 1)
    if point is None:
        die(
            4,
            f"codex-terminal-title: `tui.{TITLE_KEY}` in {config_path} is a `key = value` line whose array this "
            "writer cannot locate (unterminated, or closed past a comment) — it owns only line-shaped array "
            "values and refuses to guess where the list ends",
        )
    at, tail = point
    # `comma` keeps the operator's trailing-comma style by writing one of our
    # own; the inverse removes this exact string, so the two stay symmetric.
    snippet = {
        "empty": f'"{REQUIRED_ITEM}"',
        "item": f', "{REQUIRED_ITEM}"',
        "comma": f' "{REQUIRED_ITEM}",',
    }[tail]
    return span[:at] + snippet + span[at:], snippet


def install(config_path: str, state_path: str) -> None:
    if os.path.islink(config_path):
        die(3, f"codex-terminal-title: refusing to adopt {config_path} — symlink to {os.readlink(config_path)} (someone else's SSOT)")
    if os.path.exists(config_path) and not os.path.isfile(config_path):
        die(4, f"codex-terminal-title: refusing: {config_path} exists and is not a regular file")

    text = read_text(config_path, "config")
    parsed = parse_toml(text if text is not None else "", f"config {config_path}") if text is not None else {}
    shape, value = classify(parsed)
    if shape.startswith("refuse:"):
        name = shape.split(":", 1)[1]
        die(
            3,
            f"codex-terminal-title: refusing: {'.'.join(TUI_PATH)}{'.' + TITLE_KEY if name == TITLE_KEY else ''} in {config_path} "
            f"is explicitly a {type(value).__name__}, not {'an array of terminal-title items' if name == TITLE_KEY else 'a table'}. "
            "That is the operator's decision, not drift — entwurf will not overwrite it by name.",
        )

    lines = (text if text is not None else "").split("\n")
    infos = scan_lines(lines)
    tui_family = find_table_family(lines, infos, TUI_PATH)
    key_span = find_direct_key(lines, infos, tui_family[0], tui_family[1], TITLE_KEY) if tui_family is not None else None
    if shape in ("has-key", "no-key") and tui_family is None:
        die(
            4,
            f"codex-terminal-title: [tui] in {config_path} exists but not as a literal table block "
            "(inline/dotted form) — this writer owns only line-shaped tables and refuses to touch it",
        )
    if shape == "has-key" and key_span is None:
        die(
            4,
            f"codex-terminal-title: `tui.{TITLE_KEY}` in {config_path} exists but not as a literal `key = value` line "
            "(dotted/inline form) — this writer owns only line-shaped keys and refuses to touch it",
        )

    canonical_line = f"{TITLE_KEY} = {render_string_array(SEED_ITEMS)}"
    # Read BEFORE the shape branch: whether a receipt already binds this file is what tells an
    # operator-authored item apart from one of ours, and they get different answers below.
    prior = prior_state(state_path, config_path)

    if shape == "has-key":
        if REQUIRED_ITEM in value:
            if prior is None:
                # The operator wrote it. Nothing is written ANYWHERE — not the config, not a
                # receipt — so the doctor reads this host as `unowned`, which is what it is.
                sys.stdout.write(f"already-present {os.path.abspath(config_path)}\n")
                return
            # Ours, already installed. The strongest idempotence is to leave both files exactly
            # as they are, carrying the ORIGINAL receipt rather than re-deriving one.
            mode = prior["detectMode"]
            new_lines = lines
            preimage = prior["terminalTitlePreimage"]
            postimage_span = prior["postimageSpan"]
            snippet = prior["snippet"]
        else:
            mode = "merged-item"
            preimage = span_text(lines, key_span[0], key_span[1] + 1)
            new_span, snippet = _append_item(preimage, config_path)
            # The scanner's own receipt: the merged span must parse to exactly
            # the old list with our item APPENDED, or we refuse to splice it.
            merged_value = span_value(new_span, "merged terminal_title").get(TITLE_KEY)
            if merged_value != list(value) + [REQUIRED_ITEM]:
                die(7, "codex-terminal-title: internal refusal: merged terminal_title span does not re-parse to old items + thread-id")
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
        die(7, f"codex-terminal-title: internal: unhandled shape {shape!r}")

    if prior is None:
        state = {
            "schemaVersion": STATE_SCHEMA_VERSION,
            "managedConfigPath": os.path.abspath(config_path),
            "atom": ATOM,
            "detectMode": mode,
            "configExistedBefore": text is not None,
            "tuiTableExisted": shape in ("has-key", "no-key"),
            "terminalTitleExisted": shape == "has-key",
            # The FIRST preimage, captured once; a reinstall never re-captures.
            "terminalTitlePreimage": preimage,
            "postimageSpan": postimage_span,
            "snippet": snippet,
            "installedAt": now(),
        }
    else:
        state = prior

    candidate = render_file(new_lines)
    _, after = assert_blast_radius(text, candidate, TUI_PATH + (TITLE_KEY,), f"config {config_path}")
    effective = deep_get(after, TUI_PATH + (TITLE_KEY,))
    if shape == "has-key":
        expected = list(value) if REQUIRED_ITEM in value else list(value) + [REQUIRED_ITEM]
    else:
        expected = list(SEED_ITEMS)
    if effective != expected:
        die(7, "codex-terminal-title: internal refusal: candidate terminal_title is not the operator's items plus thread-id")

    # The receipt is durable BEFORE the operator's config is ever touched: it
    # already carries the exact preimage/snippet of the bytes about to be
    # replaced (or a prior receipt's, on a re-run). A crash or write failure
    # between here and the config write below leaves the operator's config
    # untouched and the receipt correct — a retry resumes from it instead of
    # mistaking our own canonical postimage for a fresh operator preimage.
    atomic_write_state(state_path, state)
    if candidate != (text if text is not None else ""):
        atomic_write(config_path, candidate, prefix=".codex-tt-")
    sys.stdout.write(f"{mode} {os.path.abspath(config_path)}\n")


def _current_key_span(config_path: str, text: str):
    """Locate the CURRENT terminal_title key span (fresh bytes, never cached)
    and its parsed value; `not-line-shaped` is refused here too."""
    parsed = parse_toml(text, f"config {config_path}")
    shape, value = classify(parsed)
    if shape.startswith("refuse:"):
        die(4, f"codex-terminal-title: {config_path} now carries an explicit contrary value under `tui`/`{TITLE_KEY}` — refusing to guess; fix it yourself")
    lines = text.split("\n")
    infos = scan_lines(lines)
    tui_family = find_table_family(lines, infos, TUI_PATH)
    key_span = find_direct_key(lines, infos, tui_family[0], tui_family[1], TITLE_KEY) if tui_family is not None else None
    return parsed, shape, value, lines, infos, tui_family, key_span


def uninstall(state_path: str) -> None:
    state = checked_state(state_path)
    config_path = state["managedConfigPath"]
    mode = state["detectMode"]
    if os.path.islink(config_path):
        die(3, f"codex-terminal-title: refusing to uninstall — {config_path} became a symlink (someone else's SSOT)")

    text = read_text(config_path, "config")
    if text is None:
        os.remove(state_path)
        sys.stdout.write(f"uninstalled {config_path} (config already absent)\n")
        return
    parsed, shape, value, lines, infos, tui_family, key_span = _current_key_span(config_path, text)

    if key_span is None:
        if shape == "has-key" and REQUIRED_ITEM in value:
            # `tui`/`terminal_title` is gone by NAME but the path still holds
            # thread-id — reshaped into inline/dotted TOML. This writer cannot
            # span-edit that shape; treating it as absent would silently drop
            # the receipt over an item we never actually took back. Refuse and
            # keep the receipt so the operator can repair it.
            die(
                3,
                f"codex-terminal-title: refusing to uninstall — `tui.{TITLE_KEY}` in {config_path} exists but not "
                "as a literal `key = value` line (dotted/inline form) — this writer owns only line-shaped keys "
                "and refuses to guess; the receipt is retained",
            )
        # else: thread-id is genuinely absent — our membership was taken back
        # by hand, or vanished along with the key/table itself.
        os.remove(state_path)
        sys.stdout.write(f"uninstalled {config_path} (terminal_title already absent)\n")
        return

    current_span = span_text(lines, key_span[0], key_span[1] + 1)
    current_value = value if shape == "has-key" else None

    if mode == "merged-item":
        if current_span != state["postimageSpan"]:
            if isinstance(current_value, list) and REQUIRED_ITEM not in current_value:
                os.remove(state_path)  # operator removed our item themselves
                sys.stdout.write(f"uninstalled {config_path} (thread-id already removed)\n")
                return
            die(
                6,
                f"codex-terminal-title: refusing: `tui.{TITLE_KEY}` in {config_path} changed since install "
                "(operator edits present). Remove 'thread-id' yourself if you want it gone.",
            )
        snippet = state["snippet"]
        if not isinstance(snippet, str) or snippet not in current_span:
            die(7, "codex-terminal-title: internal refusal: recorded snippet is not in the recorded span")
        restored = current_span.replace(snippet, "", 1)
        restored_value = span_value(restored, "restored terminal_title").get(TITLE_KEY)
        preimage = state["terminalTitlePreimage"]
        preimage_value = span_value(preimage, "preimage terminal_title").get(TITLE_KEY) if preimage else None
        if restored_value != preimage_value:
            die(7, "codex-terminal-title: internal refusal: snippet removal does not reproduce the preimage value")
        candidate_lines = splice(lines, key_span[0], key_span[1] + 1, restored.split("\n"))
    elif mode in ("inserted-key", "appended-table", "created-new"):
        if current_span != state["postimageSpan"]:
            if isinstance(current_value, list) and REQUIRED_ITEM not in current_value:
                os.remove(state_path)
                sys.stdout.write(f"uninstalled {config_path} (thread-id already removed)\n")
                return
            die(
                6,
                f"codex-terminal-title: refusing: `tui.{TITLE_KEY}` in {config_path} changed since install "
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
        die(4, f"codex-terminal-title: install-state {state_path} has unknown detectMode {mode!r}")

    candidate = render_file(candidate_lines)
    assert_blast_radius(text, candidate, TUI_PATH + (TITLE_KEY,), f"config {config_path}")
    if state["detectMode"] == "created-new" and state["configExistedBefore"] is False and not [l for l in candidate_lines if l.strip()]:
        os.remove(config_path)
        os.remove(state_path)
        sys.stdout.write(f"uninstalled {config_path} (file removed)\n")
        return
    atomic_write(config_path, candidate, prefix=".codex-tt-")
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
        return "terminal-title-absent"
    if shape.startswith("refuse:"):
        return "malformed-value"
    return "thread-id-present" if REQUIRED_ITEM in value else "thread-id-absent"


def doctor_static(config_path: str, state_path: str) -> None:
    """One line, two axes: `<effective> <ownership>[ drift]`. The effective
    token is computed without ever reading the receipt; ownership annotates and
    never rescues. GREEN (exit 0) is exactly `thread-id-present`, owned or
    unowned — an unowned file that already carries the item is green, and every
    other effective token is RED because this doctor's subject is the REQUIRED
    caller-seat axis, not our bookkeeping. Ownership still distinguishes the two
    reds an operator repairs differently: `drift` means our receipt binds this
    file and our item is gone (repair in place), while a bare
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
    if effective != "thread-id-present":
        sys.stdout.write(f"{effective} {ownership}{' drift' if owned else ''}\n")
        raise SystemExit(1)
    sys.stdout.write(f"{effective} {ownership}\n")


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        die(5, "usage: codex-terminal-title-config.py <install config state|uninstall state|doctor-static config state>")
    verb = argv[1]
    if verb == "install" and len(argv) == 4:
        install(argv[2], argv[3])
    elif verb == "uninstall" and len(argv) == 3:
        uninstall(argv[2])
    elif verb == "doctor-static" and len(argv) == 4:
        doctor_static(argv[2], argv[3])
    else:
        die(5, "usage: codex-terminal-title-config.py <install config state|uninstall state|doctor-static config state>")


if __name__ == "__main__":
    main(sys.argv)
