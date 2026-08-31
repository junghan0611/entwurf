#!/usr/bin/env python3
"""Read omp's resolved agent-dir config.yml for the MCP tool-surface.

stdlib only. This is a RUNTIME read of ``tools.xdev`` / ``tools.xdevInlineDevices``
(Hard Rule 13 — never an ownership claim). Absent file or absent key means the
vendor default applies: ``tools.xdev: true`` and an empty inline allowlist
(oh-my-pi ``settings-schema.ts`` ``tools.xdev`` default true,
``tools.xdevInlineDevices`` default ``[]``, measured omp 18.0.0).

The doctor, not this leaf, decides RED vs note. This leaf reports the effective
state and whether any inline glob covers our dialect send-tool name.
"""

from __future__ import annotations

import fnmatch
import os
import sys

# Vendor load order: config.yml then config.yaml (utils/src/dirs.ts MAIN_CONFIG_FILENAMES).
MAIN_CONFIG_FILENAMES = ("config.yml", "config.yaml")

# omp mints mcp__<server>_<tool> after lowercasing and replacing [^a-z_]+ with _.
# The send tool `entwurf_v2` therefore surfaces as mcp__entwurf_bridge_entwurf_v.
# A glob "covers our server key" when it matches that dialect name.
COVER_NAME = "mcp__entwurf_bridge_entwurf_v"

TRUE_WORDS = {"true", "yes", "on", "y"}
FALSE_WORDS = {"false", "no", "off", "n"}


def die(code: int, message: str) -> None:
    sys.stderr.write(message.rstrip("\n") + "\n")
    raise SystemExit(code)


def strip_comment(raw: str) -> str:
    in_single = False
    in_double = False
    escaped = False
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


def split_flow_items(inner: str) -> list[str] | None:
    """Split a flow collection's body on its TOP-LEVEL commas (quote/nest aware)."""
    items: list[str] = []
    buf: list[str] = []
    in_single = False
    in_double = False
    depth = 0
    for char in inner:
        if char == "'" and not in_double:
            in_single = not in_single
            buf.append(char)
            continue
        if char == '"' and not in_single:
            in_double = not in_double
            buf.append(char)
            continue
        if not in_single and not in_double:
            if char in "[{":
                depth += 1
            elif char in "]}":
                depth -= 1
            elif char == "," and depth == 0:
                items.append("".join(buf).strip())
                buf = []
                continue
        buf.append(char)
    if in_single or in_double or depth != 0:
        return None
    items.append("".join(buf).strip())
    return items


def parse_flow_seq(text: str) -> list[object] | None:
    body = text.strip()
    if not (body.startswith("[") and body.endswith("]")):
        return None
    inner = body[1:-1].strip()
    if inner == "":
        return []
    parts = split_flow_items(inner)
    if parts is None:
        return None
    return [parse_scalar(part) for part in parts]


def parse_flow_map(text: str) -> dict[str, object] | None:
    """The flow-mapping form the VENDOR itself writes.

    omp's own settings writer emits `modelRoles:` followed by an indented `{}`
    (measured on omp 18.0.0, an untouched operator config). The block-only reader
    read that line as a malformed mapping and returned None for the WHOLE file, so
    a perfectly ordinary vendor config classified as `unreadable` and the MCP
    doctor went RED for a reason that had nothing to do with tools.xdev.
    """
    body = text.strip()
    if not (body.startswith("{") and body.endswith("}")):
        return None
    inner = body[1:-1].strip()
    if inner == "":
        return {}
    parts = split_flow_items(inner)
    if parts is None:
        return None
    mapping: dict[str, object] = {}
    for part in parts:
        if part == "":
            return None
        pair = split_key_value(part)
        if pair is None:
            return None
        key, raw = pair
        mapping[key] = parse_scalar(raw)
    return mapping


def parse_scalar(raw: str) -> object:
    text = raw.strip()
    if text == "" or text in ("~", "null", "Null", "NULL"):
        return None
    if (len(text) >= 2) and ((text[0] == text[-1] == '"') or (text[0] == text[-1] == "'")):
        return text[1:-1]
    if text.startswith("[") and text.endswith("]"):
        parsed = parse_flow_seq(text)
        return parsed if parsed is not None else text
    if text.startswith("{") and text.endswith("}"):
        parsed_map = parse_flow_map(text)
        return parsed_map if parsed_map is not None else text
    folded = text.casefold()
    if folded in TRUE_WORDS:
        return True
    if folded in FALSE_WORDS:
        return False
    return text


def split_key_value(stripped: str) -> tuple[str, str] | None:
    in_single = False
    in_double = False
    for index, char in enumerate(stripped):
        if char == "'" and not in_double:
            in_single = not in_single
            continue
        if char == '"' and not in_single:
            in_double = not in_double
            continue
        if char == ":" and not in_single and not in_double:
            key = stripped[:index].strip()
            if not key:
                return None
            if (len(key) >= 2) and ((key[0] == key[-1] == '"') or (key[0] == key[-1] == "'")):
                key = key[1:-1]
            return key, stripped[index + 1 :].strip()
    return None


def parse_block(lines: list[tuple[int, str]], start: int, indent: int) -> tuple[object, int]:
    """Parse a mapping or list whose items are indented strictly deeper than ``indent``."""
    if start >= len(lines):
        return {}, start
    first_indent, first_text = lines[start]
    if first_indent <= indent:
        return {}, start
    if first_text.startswith("{") or first_text.startswith("["):
        # `key:` on one line, a flow collection indented under it on the next — the
        # shape the vendor's own writer produces for an empty map (`modelRoles:\n  {}`).
        flow = parse_flow_map(first_text) if first_text.startswith("{") else parse_flow_seq(first_text)
        if flow is None:
            return None, start
        index = start + 1
        if index < len(lines) and lines[index][0] >= first_indent:
            return None, start  # a flow collection is the WHOLE block or nothing
        return flow, index
    if first_text.startswith("- "):
        items: list[object] = []
        index = start
        while index < len(lines):
            item_indent, item_text = lines[index]
            if item_indent < first_indent:
                break
            if item_indent > first_indent:
                return None, start
            if not item_text.startswith("- "):
                return None, start
            rest = item_text[2:].strip()
            index += 1
            if rest == "" or split_key_value(rest) is not None:
                nested, index = parse_block(lines, index, item_indent)
                if nested is None:
                    return None, start
                if rest == "":
                    items.append(nested)
                else:
                    pair = split_key_value(rest)
                    if pair is None:
                        return None, start
                    key, raw = pair
                    node: dict[str, object] = dict(nested) if isinstance(nested, dict) else {}
                    if raw == "":
                        child, index = parse_block(lines, index, item_indent)
                        if child is None:
                            return None, start
                        node[key] = child
                    else:
                        node[key] = parse_scalar(raw)
                    items.append(node)
            else:
                items.append(parse_scalar(rest))
        return items, index

    mapping: dict[str, object] = {}
    index = start
    while index < len(lines):
        item_indent, item_text = lines[index]
        if item_indent < first_indent:
            break
        if item_indent > first_indent:
            return None, start
        pair = split_key_value(item_text)
        if pair is None:
            return None, start
        key, raw = pair
        index += 1
        if raw == "":
            child, index = parse_block(lines, index, item_indent)
            if child is None:
                return None, start
            mapping[key] = child
        else:
            mapping[key] = parse_scalar(raw)
    return mapping, index


def load_top_mapping(text: str) -> dict[str, object] | None:
    lines: list[tuple[int, str]] = []
    for raw in text.splitlines():
        if "\t" in raw.split("#", 1)[0]:
            return None
        stripped_nl = raw.rstrip("\n")
        if stripped_nl.strip() == "":
            continue
        body = strip_comment(stripped_nl)
        if body.strip() == "":
            continue
        if body.strip() in ("---", "...") or body.strip().startswith("%"):
            continue
        indent = len(body) - len(body.lstrip(" "))
        lines.append((indent, body.lstrip(" ")))
    if not lines:
        return {}
    mapping, index = parse_block(lines, 0, -1)
    if mapping is None or index != len(lines) or not isinstance(mapping, dict):
        return None
    return mapping


def covers(globs: list[str]) -> bool:
    for pattern in globs:
        if not pattern:
            continue
        if fnmatch.fnmatchcase(COVER_NAME, pattern):
            return True
    return False


def emit(fields: list[tuple[str, str]]) -> None:
    for key, value in fields:
        sys.stdout.write(f"{key} {value}\n")


def report_unreadable(path: str) -> None:
    emit([("file", path), ("verdict", "unreadable")])


def classify(agent_dir: str) -> None:
    chosen = None
    for name in MAIN_CONFIG_FILENAMES:
        candidate = os.path.join(agent_dir, name)
        if os.path.lexists(candidate):
            chosen = candidate
            break
    if chosen is None:
        emit(
            [
                ("file", "absent"),
                ("xdev-key", "absent"),
                ("xdev", "default-true"),
                ("inline-key", "absent"),
                ("covers", "no"),
                ("verdict", "xdev-on-uncovered"),
            ]
        )
        return

    path = os.path.abspath(chosen)
    if os.path.isdir(path):
        report_unreadable(path)
        return
    try:
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read()
    except OSError:
        report_unreadable(path)
        return

    mapping = load_top_mapping(text)
    if mapping is None:
        report_unreadable(path)
        return

    tools = mapping.get("tools", None)
    if tools is None:
        emit(
            [
                ("file", path),
                ("xdev-key", "absent"),
                ("xdev", "default-true"),
                ("inline-key", "absent"),
                ("covers", "no"),
                ("verdict", "xdev-on-uncovered"),
            ]
        )
        return
    if not isinstance(tools, dict):
        report_unreadable(path)
        return

    xdev_present = "xdev" in tools
    xdev_value = tools.get("xdev") if xdev_present else None
    inline_present = "xdevInlineDevices" in tools
    inline_value = tools.get("xdevInlineDevices") if inline_present else None

    globs: list[str] = []
    if inline_present:
        # Vendor compileInlineGlobs drops a non-array (a scalar is an empty allowlist).
        if isinstance(inline_value, list):
            globs = [item for item in inline_value if isinstance(item, str)]
        elif inline_value is None:
            globs = []
        else:
            globs = []

    covered = covers(globs)

    if not xdev_present or xdev_value is None:
        verdict = "xdev-on-uncovered"
        xdev_field = "default-true"
        xdev_key = "absent"
    elif xdev_value is False:
        verdict = "xdev-off"
        xdev_field = "false"
        xdev_key = "present"
    elif xdev_value is True:
        xdev_field = "true"
        xdev_key = "present"
        verdict = "xdev-on-covered" if covered else "xdev-on-uncovered"
    else:
        report_unreadable(path)
        return

    emit(
        [
            ("file", path),
            ("xdev-key", xdev_key),
            ("xdev", xdev_field),
            ("inline-key", "present" if inline_present else "absent"),
            ("covers", "yes" if covered else "no"),
            ("verdict", verdict),
        ]
    )


def main(argv: list[str]) -> None:
    if len(argv) != 2:
        die(5, "usage: omp-tool-surface.py <absolute-agent-dir>")
    agent_dir = argv[1]
    if not os.path.isabs(agent_dir):
        die(5, "omp-tool-surface: agent dir must be absolute")
    classify(agent_dir)


if __name__ == "__main__":
    main(sys.argv)
