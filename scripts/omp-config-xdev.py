#!/usr/bin/env python3
"""Write the ONE operator setting omp's tool hand requires: ``tools.xdev: false``.

stdlib only. This is the WRITER half of the runtime cell ``omp-tool-surface.py``
already reads and ``doctor-omp-mcp`` already judges. Until it existed the setting
was documentation — `docs/setup-clean-host.md` §4b told the operator to hand-edit
`config.yml`, and a host that skipped it looked green everywhere except the one
place it mattered: the doorbell announced ``mcp__entwurf_bridge_entwurf_v`` while
the vendor had wrapped every MCP tool behind ``xd://`` and the model could not
call it (measured, omp 18.0.0).

Ownership, in the same shape as every other entwurf writer:

* The config file is the VENDOR's. We add exactly one key and we record exactly
  what we added, so the inverse can take back our bytes and nothing else.
* ``xdev: true`` written EXPLICITLY by the operator is a decision, not drift. We
  refuse it by name instead of overwriting — setup reports a FAIL the operator
  resolves, which is the honest branch when two authorities disagree.
* A config we cannot parse is refused, never rewritten. A writer that edits a
  file it cannot read is how a config gets corrupted.

Exit codes: 0 ok · 2 nothing to do (uninstall, no state) · 3 refused (symlink) ·
4 unreadable/invalid · 5 refused (operator's explicit xdev: true) · 6 refused
(the file changed under us since install).
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time

STATE_SCHEMA = 1
TRUE_WORDS = {"true", "yes", "on", "y"}
FALSE_WORDS = {"false", "no", "off", "n"}


def die(code: int, message: str) -> None:
    sys.stderr.write(message.rstrip("\n") + "\n")
    raise SystemExit(code)


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def strip_comment(raw: str) -> str:
    """Drop a trailing `#` comment outside quotes — the reader's rule, kept in sync."""
    in_single = in_double = escaped = False
    for index, char in enumerate(raw):
        if escaped:
            escaped = False
            continue
        if char == "\\" and in_double:
            escaped = True
            continue
        if char == "'" and not in_double:
            in_single = not in_single
            continue
        if char == '"' and not in_single:
            in_double = not in_double
            continue
        if char == "#" and not in_single and not in_double:
            return raw[:index].rstrip()
    return raw.rstrip()


def indent_of(line: str) -> int:
    body = strip_comment(line)
    return len(body) - len(body.lstrip(" "))


def split_key(line: str) -> str | None:
    """The key of a `key: value` line, or None when the line is not a mapping entry."""
    body = strip_comment(line).strip()
    if not body or body.startswith("- ") or body.startswith("#"):
        return None
    in_single = in_double = False
    for index, char in enumerate(body):
        if char == "'" and not in_double:
            in_single = not in_single
            continue
        if char == '"' and not in_single:
            in_double = not in_double
            continue
        if char == ":" and not in_single and not in_double:
            key = body[:index].strip()
            if (len(key) >= 2) and (key[0] == key[-1] == '"' or key[0] == key[-1] == "'"):
                key = key[1:-1]
            return key or None
    return None


def value_of(line: str) -> str:
    body = strip_comment(line).strip()
    _, _, rest = body.partition(":")
    return rest.strip()


def scalar_bool(raw: str) -> bool | None:
    text = raw.strip()
    if (len(text) >= 2) and (text[0] == text[-1] == '"' or text[0] == text[-1] == "'"):
        text = text[1:-1]
    folded = text.casefold()
    if folded in TRUE_WORDS:
        return True
    if folded in FALSE_WORDS:
        return False
    return None


def find_tools_block(lines: list[str]) -> tuple[int, int, int] | None:
    """(header index, first child index, child indent) for the TOP-LEVEL `tools:` key."""
    for index, line in enumerate(lines):
        if not strip_comment(line).strip():
            continue
        if indent_of(line) != 0:
            continue
        if split_key(line) != "tools":
            continue
        end = index + 1
        child_indent = -1
        while end < len(lines):
            if not strip_comment(lines[end]).strip():
                end += 1
                continue
            if indent_of(lines[end]) == 0:
                break
            if child_indent < 0:
                child_indent = indent_of(lines[end])
            end += 1
        return index, end, (child_indent if child_indent > 0 else 2)
    return None


def read_config(path: str) -> list[str]:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read().splitlines()


def write_config(path: str, lines: list[str]) -> str:
    text = "\n".join(lines) + "\n"
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)
    tmp = f"{path}.entwurf-tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.replace(tmp, path)
    return text


def write_state(state_file: str, payload: dict[str, object]) -> None:
    os.makedirs(os.path.dirname(state_file) or ".", exist_ok=True)
    tmp = f"{state_file}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(tmp, state_file)


def do_install(config_path: str, state_file: str) -> None:
    if os.path.islink(config_path):
        die(3, f"refusing: {config_path} is a symlink — entwurf never writes through a link")
    existed = os.path.exists(config_path)
    if existed and not os.path.isfile(config_path):
        die(4, f"refusing: {config_path} exists and is not a regular file")

    lines = read_config(config_path) if existed else []
    block = find_tools_block(lines)
    inserted: list[str] = []
    action: str

    if block is None:
        # No `tools:` at all — append the whole two-line section. The vendor's own
        # writer emits `key: ` with a trailing space, so the file stays uniform.
        if lines and strip_comment(lines[-1]).strip() == "":
            lines = lines[:-1]
        inserted = ["tools: ", "  xdev: false"]
        lines.extend(inserted)
        action = "created-file" if not existed else "appended-tools-block"
    else:
        header, end, child_indent = block
        existing = None
        for index in range(header + 1, end):
            if indent_of(lines[index]) == child_indent and split_key(lines[index]) == "xdev":
                existing = index
                break
        if existing is not None:
            current = scalar_bool(value_of(lines[existing]))
            if current is False:
                write_state(
                    state_file,
                    {
                        "schemaVersion": STATE_SCHEMA,
                        "configPath": os.path.abspath(config_path),
                        "fileExistedBefore": True,
                        "action": "already-false",
                        "insertedLines": [],
                        "postimageSha256": sha256("\n".join(lines) + "\n"),
                        "installedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                    },
                )
                print(f"already-set {config_path} (tools.xdev is false — nothing written)")
                return
            if current is True:
                die(
                    5,
                    f"refusing: {config_path} sets tools.xdev: true EXPLICITLY (line {existing + 1}). "
                    "That is the operator's decision, not drift, so entwurf will not overwrite it. "
                    "Entwurf's MCP tools are unreachable from omp while xdev is on and no "
                    "xdevInlineDevices glob covers them — set it to false yourself, or accept that "
                    "the omp citizen cannot call entwurf tools.",
                )
            die(4, f"refusing: {config_path} line {existing + 1} sets tools.xdev to a value this reader cannot classify")
        inserted = [" " * child_indent + "xdev: false"]
        lines[end:end] = inserted
        action = "inserted-xdev-key"

    text = write_config(config_path, lines)
    write_state(
        state_file,
        {
            "schemaVersion": STATE_SCHEMA,
            "configPath": os.path.abspath(config_path),
            "fileExistedBefore": existed,
            "action": action,
            "insertedLines": inserted,
            "postimageSha256": sha256(text),
            "installedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        },
    )
    print(f"{action} {config_path} (tools.xdev: false)")


def do_uninstall(state_file: str) -> None:
    if not os.path.exists(state_file):
        die(2, f"no install-state at {state_file} — entwurf never wrote this setting on this host")
    try:
        with open(state_file, "r", encoding="utf-8") as handle:
            state = json.load(handle)
    except (OSError, ValueError):
        die(4, f"install-state at {state_file} is unreadable — refusing to guess what to take back")
    if not isinstance(state, dict) or state.get("schemaVersion") != STATE_SCHEMA:
        die(4, f"install-state at {state_file} is not schemaVersion {STATE_SCHEMA} — refusing")

    config_path = state.get("configPath")
    action = state.get("action")
    inserted = state.get("insertedLines")
    if not isinstance(config_path, str) or not isinstance(inserted, list):
        die(4, f"install-state at {state_file} is malformed — refusing")

    if action == "already-false":
        os.remove(state_file)
        print(f"nothing to take back ({config_path} already had tools.xdev: false); state cleared")
        return

    if os.path.islink(config_path):
        die(3, f"refusing: {config_path} is now a symlink — entwurf never writes through a link")
    if not os.path.exists(config_path):
        os.remove(state_file)
        print(f"{config_path} is already gone; state cleared")
        return

    with open(config_path, "r", encoding="utf-8") as handle:
        current = handle.read()
    if sha256(current) != state.get("postimageSha256"):
        die(
            6,
            f"refusing: {config_path} changed since entwurf wrote it. Remove the tools.xdev line "
            "yourself if you want it gone — a blind edit here would take back somebody else's bytes.",
        )

    if action == "created-file":
        os.remove(config_path)
        os.remove(state_file)
        print(f"removed {config_path} (entwurf created it); state cleared")
        return

    lines = current.splitlines()
    for line in reversed(inserted):
        if line in lines:
            lines.remove(line)
        else:
            die(6, f"refusing: the line {line!r} entwurf added is no longer in {config_path}")
    write_config(config_path, lines)
    os.remove(state_file)
    print(f"took back {len(inserted)} line(s) from {config_path}; state cleared")


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        die(5, "usage: omp-config-xdev.py install <config-path> <state-file> | uninstall <state-file>")
    verb = argv[1]
    if verb == "install":
        if len(argv) != 4:
            die(5, "usage: omp-config-xdev.py install <config-path> <state-file>")
        do_install(argv[2], argv[3])
        return
    if verb == "uninstall":
        if len(argv) != 3:
            die(5, "usage: omp-config-xdev.py uninstall <state-file>")
        do_uninstall(argv[2])
        return
    die(5, f"unknown verb {verb!r} — install | uninstall")


if __name__ == "__main__":
    main(sys.argv)
