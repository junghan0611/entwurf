"""codex_toml_io — shared TOML reader/writer for the two Codex config atoms.

`$CODEX_HOME/config.toml` is a SINGLE shared surface: the operator hand-edits
it AND the vendor writes it back at runtime (answering the hook-trust prompt
appends `[hooks.state."..."]` to the very same file — measured in
scripts/raw-codex-measure/README.md M1). The Copilot atoms could own a whole
JSON document; a Codex atom cannot. This module is therefore the
`scripts/omp-config-xdev.py` shape — a line editor that owns exactly the lines
it touches — hardened with three layers that file never needed:

  1. tomllib (stdlib, vendor-grade) is the parse-or-refuse oracle: a file that
     does not parse is refused before any edit, and every CANDIDATE text is
     re-parsed before it may reach the disk. A line edit that would break the
     document can therefore never ship.
  2. Every write proves its own blast radius: with the one path the caller
     owns removed from both sides, the parsed before/after documents must
     compare equal (modulo empty tables, which carry no content) or the write
     is refused as an internal error. The ownership policy is a check, not a
     promise.
  3. `atomic_write` is a single fail-closed primitive (mkdir, write-to-temp,
     rename) that both atoms call for BOTH files they own. Each atom writes
     its install-state receipt — which already carries the first preimage —
     BEFORE it ever touches the operator's config, so a crash or an I/O
     failure at any of the three points leaves the operator's bytes exactly
     as they were and a receipt that is either absent or already correct; a
     retry resumes from it instead of re-deriving a preimage from
     already-mutated bytes. `ENTWURF_TEST_CODEX_TOML_FAULT` injects a
     deterministic failure at each of the three points for exactly this
     property (see `_inject_test_fault`).

There is deliberately NO whole-file postimage hash here: the vendor writes
this file between our install and our uninstall, so byte-pinning would refuse
honest uninstalls. Spans are located FRESH from the current bytes at uninstall
time; the atoms record the span texts they produced and the preimages they
superseded.

Importers prepend their own directory to sys.path so the import holds however
they are invoked (same pattern as pi_settings_io).
"""

from __future__ import annotations

import datetime
import json
import os
import re
import sys
import tempfile
import tomllib

_BARE_KEY = re.compile(r"[A-Za-z0-9_-]+")


def die(code: int, message: str) -> None:
    sys.stderr.write(message.rstrip("\n") + "\n")
    raise SystemExit(code)


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_text(path: str, label: str) -> str | None:
    """The file's bytes, or None when absent. Anything else is refused."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read()
    except FileNotFoundError:
        return None
    except OSError as error:
        die(4, f"codex-toml: cannot read {label} {path}: {error}")
    except UnicodeDecodeError as error:
        die(4, f"codex-toml: {label} {path} is not valid UTF-8: {error}")


def parse_toml(text: str, label: str) -> dict:
    try:
        value = tomllib.loads(text)
    except tomllib.TOMLDecodeError as error:
        die(4, f"codex-toml: {label} is not valid TOML: {error}")
    return value


_TEST_FAULT_ENV = "ENTWURF_TEST_CODEX_TOML_FAULT"


def _inject_test_fault(stage: str, prefix: str) -> None:
    """Deterministic failure injection for the smoke suite only. Set
    `ENTWURF_TEST_CODEX_TOML_FAULT` to `<stage>` or `<stage>:<prefix>`, where
    `stage` is one of `mkdir` / `write` / `replace` — the three points
    `atomic_write` can fail at, in order — to raise there before a single
    byte of the target path changes. `prefix` narrows the fault to one
    writer's temp-file prefix (`.codex-state-` for a receipt,
    `.codex-mcp-`/`.codex-sl-` for a config); omitted, it matches every
    writer. Never read outside a test that sets the variable.
    """
    spec = os.environ.get(_TEST_FAULT_ENV)
    if not spec:
        return
    want_stage, _, want_prefix = spec.partition(":")
    if want_stage != stage or (want_prefix and want_prefix != prefix):
        return
    raise OSError(f"codex-toml: injected {stage} fault ({prefix})")


def atomic_write(path: str, text: str, prefix: str = ".codex-toml-") -> None:
    directory = os.path.dirname(os.path.abspath(path))
    _inject_test_fault("mkdir", prefix)
    os.makedirs(directory, exist_ok=True)
    _inject_test_fault("write", prefix)
    fd, temporary = tempfile.mkstemp(dir=directory, prefix=prefix, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        _inject_test_fault("replace", prefix)
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def atomic_write_state(path: str, state: dict) -> None:
    atomic_write(path, json.dumps(state, indent=2) + "\n", prefix=".codex-state-")


# --------------------------------------------------------------------------
# Char-level scanning: which lines are headers, where a value ends.
#
# The scanner only has to be RIGHT about the files tomllib already accepted;
# every span it reports is re-parsed in isolation and compared against the
# whole-document value (`span_value` below). A mis-track fails closed there,
# never silently.
# --------------------------------------------------------------------------


class _ScanState:
    """Bracket/string context carried across lines."""

    __slots__ = ("depth", "basic_ml", "literal_ml")

    def __init__(self) -> None:
        self.depth = 0  # net open [ or { outside strings (multi-line arrays)
        self.basic_ml = False  # inside a """ multi-line basic string
        self.literal_ml = False  # inside a ''' multi-line literal string

    def busy(self) -> bool:
        return self.depth > 0 or self.basic_ml or self.literal_ml


def _scan_text(text: str, state: _ScanState, start: int = 0) -> int:
    """Advance over `text` from `start`, mutating `state`; return the resume
    index (len(text) when the construct is still open). Newlines are ordinary
    characters to the caller's context: inside multi-line strings and arrays
    they are content; elsewhere the caller checks `state.busy()` at EOL.
    Comments (# outside any string) end the rest of the text.
    """
    i = start
    n = len(text)
    in_basic = False  # inside a single-line basic string
    in_literal = False  # inside a single-line literal string
    escaped = False
    while i < n:
        ch = text[i]
        if state.basic_ml:
            if ch == '"':
                run = 1
                while i + run < n and text[i + run] == '"':
                    run += 1
                if run >= 3:
                    # first three close the string; up to two extra quotes are
                    # content per the TOML spec and cannot open anything.
                    state.basic_ml = False
                    i += 3
                    continue
                i += run  # 1-2 quotes: content
                continue
            i += 1
            continue
        if state.literal_ml:
            if ch == "'":
                run = 1
                while i + run < n and text[i + run] == "'":
                    run += 1
                if run >= 3:
                    state.literal_ml = False
                    i += 3
                    continue
                i += run
                continue
            i += 1
            continue
        if in_basic:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_basic = False
            i += 1
            continue
        if in_literal:
            if ch == "'":
                in_literal = False
            i += 1
            continue
        # outside every string
        if ch == '"':
            run = 1
            while i + run < n and text[i + run] == '"':
                run += 1
            if run >= 3:
                state.basic_ml = True
                i += 3
            elif run == 2:
                i += 2  # empty string
            else:
                in_basic = True
                i += 1
            continue
        if ch == "'":
            run = 1
            while i + run < n and text[i + run] == "'":
                run += 1
            if run >= 3:
                state.literal_ml = True
                i += 3
            elif run == 2:
                i += 2  # empty string
            else:
                in_literal = True
                i += 1
            continue
        if ch == "#":
            return n  # comment: rest of the text is inert
        if ch in "[{":
            state.depth += 1
        elif ch in "]}":
            if state.depth > 0:
                state.depth -= 1
        i += 1
    return i


def _unquote(segment: str) -> str | None:
    """One dotted-path segment back to its key string, or None if malformed."""
    if len(segment) >= 2 and segment[0] == '"' and segment[-1] == '"':
        try:
            return json.loads(segment)
        except ValueError:
            return None
    if len(segment) >= 2 and segment[0] == "'" and segment[-1] == "'":
        return segment[1:-1]
    if _BARE_KEY.fullmatch(segment):
        return segment
    return None


def _parse_header(stripped: str) -> tuple[tuple[str, ...], bool] | None:
    """The dotted path of a `[table]` / `[[array]]` header line, or None when
    the line is not a parseable header (tomllib is the backstop oracle)."""
    is_array = stripped.startswith("[[")
    opener, closer = ("[[", "]]") if is_array else ("[", "]")
    if not stripped.startswith(opener):
        return None
    end = stripped.find(closer)
    if end < 0:
        return None
    body = stripped[len(opener):end]
    parts: list[str] = []
    current = []
    in_basic = in_literal = escaped = False
    for ch in body:
        if in_basic:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_basic = False
            current.append(ch)
            continue
        if in_literal:
            if ch == "'":
                in_literal = False
            current.append(ch)
            continue
        if ch == '"':
            in_basic = True
            current.append(ch)
        elif ch == "'":
            in_literal = True
            current.append(ch)
        elif ch == ".":
            parts.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    parts.append("".join(current).strip())
    if any(not part for part in parts):
        return None
    keys = tuple(_unquote(part) for part in parts)
    if any(key is None for key in keys):
        return None
    return keys, is_array  # type: ignore[return-value]


class LineInfo:
    __slots__ = ("header", "is_array")

    def __init__(self, header: tuple[str, ...] | None, is_array: bool) -> None:
        self.header = header
        self.is_array = is_array


def scan_lines(lines: list[str]) -> list[LineInfo]:
    """Classify every line: its table path when it is a header line at value
    depth zero, else None. Multi-line strings and arrays suppress headers."""
    infos: list[LineInfo] = []
    state = _ScanState()
    for line in lines:
        header: tuple[str, ...] | None = None
        is_array = False
        if not state.busy():
            stripped = line.lstrip()
            if stripped.startswith("["):
                parsed = _parse_header(stripped)
                if parsed is not None:
                    header, is_array = parsed
        infos.append(LineInfo(header, is_array))
        _scan_text(line, state)
    return infos


def find_table_family(lines: list[str], infos: list[LineInfo], path: tuple[str, ...]) -> tuple[int, int] | None:
    """(start, end_exclusive) of the `[path]` header line and every sub-table
    under it, up to the next header that is not a descendant, or EOF."""
    start = None
    for idx, info in enumerate(infos):
        if info.header == path and not info.is_array:
            start = idx
            break
    if start is None:
        return None
    end = len(lines)
    for idx in range(start + 1, len(lines)):
        info = infos[idx]
        if info.header is None:
            continue
        other = info.header
        if len(other) > len(path) and other[: len(path)] == path:
            continue  # a descendant sub-table stays in the family
        end = idx
        break
    return start, end


def _parse_key_prefix(line: str) -> tuple[str, int] | None:
    """(key, index_of_equals) when `line` begins a `key = value` entry, else
    None. Handles bare and quoted keys; dotted keys are returned verbatim so
    callers can refuse them explicitly."""
    stripped = line.lstrip()
    if not stripped:
        return None
    if stripped[0] in "\"'":
        quote = stripped[0]
        close = stripped.find(quote, 1)
        if close < 0:
            return None
        key = _unquote(stripped[: close + 1])
        if key is None:
            return None
        rest = stripped[close + 1 :]
    else:
        match = _BARE_KEY.match(stripped)
        if not match:
            return None
        key = match.group(0)
        rest = stripped[match.end():]
        if rest.startswith("."):
            return key + "." + "…dotted", -1  # caller refuses; never a plain key
    rest = rest.lstrip()
    if not rest.startswith("="):
        return None
    return key, line.index("=", line.index(stripped))


def find_direct_key(lines: list[str], infos: list[LineInfo], family_start: int, family_end: int, key: str) -> tuple[int, int] | None:
    """(key_line, value_end_inclusive) of the direct `key = value` entry of
    the table whose header is family_start, or None. The value span covers
    multi-line arrays/strings."""
    for idx in range(family_start + 1, family_end):
        if infos[idx].header is not None:
            break  # direct members end at the first sub-table header
        parsed = _parse_key_prefix(lines[idx])
        if parsed is None:
            continue
        found_key, eq = parsed
        if found_key != key:
            continue
        value_end = _value_end(lines, idx, eq + 1)
        return idx, value_end
    return None


def _value_end(lines: list[str], key_line: int, start_pos: int) -> int:
    """The last line index of the value that starts at start_pos on
    lines[key_line]. Single-line values return key_line."""
    state = _ScanState()
    line = lines[key_line]
    resume = _scan_text(line, state, start_pos)
    if not state.busy():
        return key_line
    idx = key_line
    while state.busy() and idx + 1 < len(lines):
        idx += 1
        _scan_text(lines[idx], state)
    return idx


def span_text(lines: list[str], start: int, end_exclusive: int) -> str:
    return "\n".join(lines[start:end_exclusive])


def splice(lines: list[str], start: int, end_exclusive: int, replacement: list[str]) -> list[str]:
    return lines[:start] + list(replacement) + lines[end_exclusive:]


def append_block(lines: list[str], block_lines: list[str]) -> list[str]:
    """Append a table block at EOF, terminating an unterminated last line."""
    body = list(lines)
    if body and body[-1] == "":
        body = body[:-1]
    return body + list(block_lines)


def render_file(lines: list[str]) -> str:
    """Text for the whole file: exactly one trailing newline, never two — a
    split tail element of "" already IS the terminator."""
    if lines and lines[-1] == "":
        return "\n".join(lines)
    return "\n".join(lines) + "\n"


def span_value(span: str, label: str):
    """Re-parse an isolated value/key span and return what TOML says it is —
    the self-check that keeps the line scanner honest. A family table span
    parses to {"mcp_servers": {"entwurf-bridge": {...}}}; pass the inner path
    to dig out the compared value."""
    try:
        return tomllib.loads(span)
    except tomllib.TOMLDecodeError as error:
        die(7, f"codex-toml: internal scanner drift: {label} span does not re-parse: {error}")


def deep_get(data, path: tuple[str, ...]):
    current = data
    for part in path:
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _drop_empty(value):
    if isinstance(value, dict):
        kept = {k: _drop_empty(v) for k, v in value.items()}
        return {k: v for k, v in kept.items() if v != {}}
    return value


def without_path(data: dict, path: tuple[str, ...]) -> dict:
    """A comparable copy of `data` with `path` removed; empty tables left by
    the removal (or empty anywhere — they carry no content) are dropped so an
    appended parent table never reads as collateral damage."""
    if not path:
        return _drop_empty(data)

    def strip(value, remaining):
        if not isinstance(value, dict):
            return value
        out = {}
        head, rest = remaining[0], remaining[1:]
        for key, child in value.items():
            if key == head:
                if not rest:
                    continue
                stripped = strip(child, rest)
                if stripped != {}:
                    out[key] = stripped
                continue
            out[key] = child
        return out

    return _drop_empty(strip(data, path))


def assert_blast_radius(original_text: str | None, candidate_text: str, owned_path: tuple[str, ...], label: str) -> tuple[dict, dict]:
    """The write's own proof: candidate parses, and with `owned_path` removed
    both documents compare equal. Returns (parsed_before, parsed_after)."""
    before = parse_toml(original_text if original_text is not None else "", label)
    after = parse_toml(candidate_text, f"candidate {label}")
    if without_path(before, owned_path) != without_path(after, owned_path):
        die(7, f"codex-toml: internal refusal: editing {label} would change TOML outside {'.'.join(owned_path)}")
    return before, after


def toml_string(value: str) -> str:
    # JSON double-quoted strings are valid TOML basic strings for every value
    # json can emit (\", \\, \n, \uXXXX — all legal TOML escapes).
    return json.dumps(value, ensure_ascii=True)


def render_string_array(items) -> str:
    return "[" + ", ".join(toml_string(item) for item in items) + "]"
