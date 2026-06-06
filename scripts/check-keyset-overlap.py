#!/usr/bin/env python3
"""check-keyset-overlap — guard the keyset-owner invariant across consumers.

pi-shell-acp's meta-bridge install OWNS a fixed set of `~/.claude/settings.json`
(+ `~/.claude.json`) keys (the SSOT is `meta-bridge-state.py managed-keys`).
agent-config (and any future consumer) merges its OWN fragment into the same
file. The invariant: each side sets only its own keys and never the other's —
otherwise a later `agent-config` merge (jq `.[0] * .[1]`, which REPLACES arrays
and overwrites scalars) silently clobbers pi-owned policy, or vice-versa.

This is the PREVENTIVE half of the guard (doctor's `state.py check` is the
after-the-fact survival half). It reads pi's owned key paths and one or more
consumer fragment JSON files, and fails loud if any consumer key collides with a
pi-owned key — exact match OR ancestor/descendant (a fragment that sets
`statusLine.command` collides with pi's whole-`statusLine` ownership).

Cross-repo and not hermetic (the fragment path is an argument), so it lives
OUTSIDE `pnpm check` / release-gate — it is for agent-config CI and manual
cross-checks. The synthetic-fixture regression of this script's own logic lives
in `smoke-meta-keyset-guard.sh`, which IS in `pnpm check`.

usage: check-keyset-overlap.py <consumer-fragment.json> [more.json ...]
exit 0 = disjoint (invariant holds); exit 1 = overlap (invariant violated);
exit 2 = usage / unreadable input.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = HERE / "meta-bridge-state.py"


def die(msg: str, code: int = 2) -> "None":
    print(f"check-keyset-overlap: {msg}", file=sys.stderr)
    raise SystemExit(code)


def pi_owned_paths() -> list[str]:
    """Flat dotted key paths pi-shell-acp owns, from the state-manager SSOT."""
    try:
        out = subprocess.run(
            [sys.executable, str(STATE), "managed-keys"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    except subprocess.CalledProcessError as exc:  # pragma: no cover - defensive
        die(f"could not read pi managed-keys SSOT: {exc.stderr.strip() or exc}")
    data = json.loads(out)
    paths: list[str] = []
    for scope in ("settings", "claudeRoot"):
        for _kind, keys in data.get(scope, {}).items():
            paths.extend(keys)
    return paths


def flatten(obj: object, prefix: str = "") -> list[str]:
    """Leaf dotted paths of a JSON object. Arrays/scalars are leaves."""
    if isinstance(obj, dict) and obj:
        out: list[str] = []
        for key, value in obj.items():
            path = f"{prefix}.{key}" if prefix else key
            out.extend(flatten(value, path))
        return out
    return [prefix] if prefix else []


def collides(pi_path: str, frag_path: str) -> bool:
    """True if the two key paths refer to the same key or a nested ancestor."""
    return (
        pi_path == frag_path
        or frag_path.startswith(pi_path + ".")
        or pi_path.startswith(frag_path + ".")
    )


def main() -> int:
    if len(sys.argv) < 2:
        die("usage: check-keyset-overlap.py <consumer-fragment.json> [more.json ...]")

    pi_paths = pi_owned_paths()
    overlaps: list[str] = []
    for raw in sys.argv[1:]:
        path = Path(raw)
        if not path.exists():
            die(f"fragment not found: {path}")
        try:
            fragment = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            die(f"unreadable fragment {path}: {exc}")
        if not isinstance(fragment, dict):
            die(f"fragment {path} root must be a JSON object")
        frag_paths = flatten(fragment)
        for frag in frag_paths:
            for pi in pi_paths:
                if collides(pi, frag):
                    overlaps.append(f"{path.name}: consumer key '{frag}' collides with pi-owned '{pi}'")

    if overlaps:
        print("KEYSET OVERLAP — keyset-owner invariant violated:", file=sys.stderr)
        for line in overlaps:
            print(f"  FAIL: {line}", file=sys.stderr)
        print(
            "  Fix: remove the colliding key(s) from the consumer fragment; "
            "pi-shell-acp owns them (see ./run.sh meta-bridge-managed-keys).",
            file=sys.stderr,
        )
        return 1

    print(f"keyset disjoint ok: {len(sys.argv) - 1} fragment(s) vs {len(pi_paths)} pi-owned key(s), no overlap")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
