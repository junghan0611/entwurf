"""pi_settings_io — the shared serializer for the pi settings.json files this repo WRITES.

Both Python writers touch the SAME file (`<repo>/.pi/settings.json` at project scope,
`~/.pi/agent/settings.json` at user scope):

  - register-pi-package.py   → packages[]
  - register-pi-provider.py  → entwurfProvider.mcpServers.entwurf-bridge

A settings file can be tracked and owned by a formatter (this repo's own is: tab
indented, biome-governed, pinned byte-for-byte by check-install-surface S7b–S7d), so a
writer that re-serializes it in its own house style turns `install` into a source edit.
#53 B closed that for the packages writer and left the provider writer open — the same
file, the same defect, one function call away. The rules therefore live HERE rather than
in either script, because a rule that has to be remembered at each call site is exactly
what shipped the bug twice:

  1. NO WRITE WHEN NOTHING CHANGES. The strongest idempotence is an untouched file —
     same bytes, same mtime. Compare the mutated document to the one that was loaded and
     skip the write when they are equal; only the caller knows what "changed" means, so
     each one asks `unchanged` and decides.
  2. A GENUINE REWRITE KEEPS THE FILE'S OWN INDENT UNIT. Narrower than it sounds: this
     preserves the indent UNIT, not a formatter's line-collapsing decisions, so a rewrite
     is NOT guaranteed to come back formatter-clean. Byte identity comes from rule 1.

Ships inside `scripts/` (package.json `files` carries the directory whole, with
`__pycache__`/`*.pyc` excluded), and both importers add their own directory to sys.path
so the import holds however they are invoked.
"""

from __future__ import annotations

import json
import re

# The first indented line's leading whitespace is the file's unit. `\S` so a blank or
# whitespace-only line never answers for the document.
_INDENT = re.compile(r"\n([ \t]+)\S")


def detect_indent(text: str | None) -> str | int:
    """The file's own indent unit — a tab, or N spaces. Defaults to 2 for a new/one-line
    file, which is what both writers produced before they knew to ask."""
    if not text:
        return 2
    m = _INDENT.search(text)
    if not m:
        return 2
    unit = m.group(1)
    return "\t" if unit[0] == "\t" else len(unit)


def dumps(data: dict, indent: str | int) -> str:
    """Serialize with the given unit and exactly one trailing newline."""
    return json.dumps(data, indent=indent) + "\n"


def unchanged(before: dict, after: dict) -> bool:
    """Would writing `after` change what the file MEANS?

    Value equality, not byte equality, and deliberately so: dict `==` ignores key ORDER,
    so a document whose keys merely moved is reported unchanged and the operator's own
    ordering survives. The caller must pass a `before` taken BEFORE any mutation — both
    writers mutate in place, so they parse the raw text twice rather than aliasing it.
    """
    return before == after
