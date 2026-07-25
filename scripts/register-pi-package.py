#!/usr/bin/env python3
"""Register (or --remove) entwurf in a pi settings.json packages[].

One MATCHING predicate (is_entwurf_source) + one idempotency / fail-loud SSOT,
shared by BOTH scopes and by remove, so "which entries are ours" cannot drift
between install and uninstall:
  - project  <repo>/.pi/settings.json     (run.sh install_local_package / remove_local_package)
  - user     ~/.pi/agent/settings.json    (run.sh register_user_scope_citizen)

Register is idempotent: absent → append REPO_DIR; already the sole canonical
entry → no-op (file not rewritten, mtime stable); any other entwurf entry (object
form, stale path, duplicate) collapses into one canonical string form.

Matching is shared; the ACTION on a match is not, and the asymmetry is deliberate.
Remove drops every MANAGED shape the matcher recognizes — the resolved repo dir, an
`…/node_modules/@junghanacs/entwurf` install path, an `npm:@junghanacs/entwurf[@ver]`
spec, a stale local path whose last segment is `entwurf` — including shapes register
itself never literally wrote, because those are how an operator's earlier install or
a moved clone left this package registered. It preserves exactly ONE class: a
settings-RELATIVE entry that resolves to repo_dir (see below). A look-alike repo
(entwurf-notes, openclaw-entwurf) is neither wrongly registered-over nor wrongly
removed. Every non-entwurf package and every other settings key is preserved.

CANONICAL IS NOT ONLY THE ABSOLUTE PATH. A packages[] entry is resolved by pi
against the SETTINGS FILE'S OWN DIRECTORY, so this repo's committed
`.pi/settings.json` names itself portably as `".."` — the exact form
check-install-surface S7c pins. Comparing entries against the resolved absolute
path ALONE did not recognize that as entwurf, so `setup` appended the absolute
path beside it and rewrote the tracked, biome-governed file in a foreign style:
a dev clone went RED at `pnpm check` step 1, diagnosed as a "formatting" error
(#53 B). Two rules follow, and they are the same rule read forwards and backwards:
  - register: an entry that RESOLVES to repo_dir is already canonical → no-op, and
    when a rewrite is genuinely needed a settings-relative self-reference is kept
    as the survivor, so the portable form is never silently absolutized;
  - remove: register only ever WRITES the absolute form, so a settings-relative
    self-reference cannot be install's own output — it was authored by the repo
    (this one commits `".."`) or by the operator. Uninstall is install's inverse,
    not a settings editor: it leaves that ONE class in place and SAYS SO on stdout,
    rather than deleting source bytes install never wrote. The cost is stated
    rather than hidden: on a settings file whose only entwurf entry is relative,
    `--remove` is a no-op and the package stays registered until a human edits it.
    would_remove() asks the same split, so `--dry-run` can never disagree with what
    `--remove` does.
A rewrite also preserves the file's existing indentation instead of forcing 2
spaces. That is narrower than it sounds — it keeps the indent UNIT, not a
formatter's line-collapsing decisions — so the byte-identity guarantee this repo's
own settings depend on comes from the no-op path, never from the writer's style.

This wiring (user scope) dropped when `pi install` was removed from setup
(2026-07-03: `--entwurf-control` unknown in a foreign cwd). Extracting it here
lets run.sh (both scopes + remove) and smoke-user-scope-citizen share ONE
implementation — mirrors the meta-bridge-state.py split.

Usage: register-pi-package.py <settings.json> <repo_dir> [--remove]
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

# The serializer rules are SHARED with register-pi-provider.py — both write the same
# settings file, and a copied indent-detector is how the second writer stayed open after
# the first one was closed (#53 B). sys.path[0] already holds this directory when the
# script is run by path, which is how run.sh and every gate invoke it; the explicit
# insert keeps the import true under any other invocation form.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pi_settings_io import detect_indent, dumps  # noqa: E402

# A leading `<scheme>:` means the string is a package SPEC (npm:, git:, https:),
# never a filesystem path — so it is never resolved against the settings dir.
_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


def source_of(item: object) -> object:
    """The package spec of a packages[] entry — string form or {"source": …}."""
    return item.get("source") if isinstance(item, dict) else item


def is_settings_relative_self(source: str, settings_dir: str, repo_dir: str) -> bool:
    """True iff this entry is a SETTINGS-RELATIVE path naming repo_dir itself.

    This is the repo's own committed portable form (`".."` in
    <repo>/.pi/settings.json) — functionally identical to the absolute entry,
    because pi resolves a relative package source against the settings file's own
    directory. It is also the one shape register never writes, which is what lets
    remove treat it as source rather than as install state.

    Anything carrying a scheme (npm:/git:/https:) is a spec, not a path; anything
    absolute (`/`, `~`) is not settings-relative. Everything else is resolved and
    compared — a relative entry only matches when it genuinely names this repo, so
    `../../repos/gh/andenken` stays untouched.
    """
    p = source.rstrip("/")
    if not p or _SCHEME.match(p) or p.startswith(("/", "~")):
        return False
    try:
        return str((Path(settings_dir) / p).resolve()) == repo_dir
    except OSError:
        return False


def is_entwurf_source(source: str, repo_dir: str, settings_dir: str | None = None) -> bool:
    """True iff this package entry points at THIS entwurf — the only entries
    register/remove may touch. Strict on purpose: user-scope settings are GLOBAL,
    so a substring "entwurf" match would wrongly eat unrelated repos like
    entwurf-notes, openclaw-entwurf, or somebody else's git repo named entwurf.

    Managed shapes:
      - the exact resolved repo dir;
      - an npm install path ending in node_modules/@junghanacs/entwurf;
      - an explicit npm package source for @junghanacs/entwurf;
      - a settings-relative path that RESOLVES to the repo dir (the committed
        portable `".."`), when the caller supplies settings_dir;
      - a local filesystem path whose final directory is literally "entwurf"
        (dev clone / stale move). Remote URL/git-like strings are NOT treated as
        local paths merely because their last segment is "entwurf".
    """
    p = source.rstrip("/")
    if p == repo_dir or p.endswith("/node_modules/@junghanacs/entwurf"):
        return True
    if p == "npm:@junghanacs/entwurf" or p.startswith("npm:@junghanacs/entwurf@"):
        return True
    if settings_dir is not None and is_settings_relative_self(p, settings_dir, repo_dir):
        return True
    local_like = p.startswith(("/", "./", "../", "~"))
    return local_like and Path(p).name == "entwurf"




def _load(settings_path: Path) -> dict:
    if settings_path.exists():
        data = json.loads(settings_path.read_text())
        if not isinstance(data, dict):
            raise SystemExit(f"{settings_path} is not a JSON object")
        return data
    return {}


def _packages(settings_path: Path, data: dict) -> list:
    packages = data.get("packages")
    if packages is None:
        return []
    if not isinstance(packages, list):
        # A settings file with a corrupt packages shape must NOT be silently
        # coerced to [] — that would drop the operator's real packages.
        raise SystemExit(f"{settings_path}: packages is not a JSON array")
    return packages


def _settings_dir(settings_path: Path) -> str:
    """The directory a relative packages[] entry is resolved against — the settings
    file's own parent, the way pi reads it. Never the process cwd: run.sh and the
    gates invoke this from anywhere."""
    return str(settings_path.parent.resolve()) if settings_path.parent.exists() else str(settings_path.parent)


def _is_relative_self_item(item: object, settings_dir: str, repo_dir: str) -> bool:
    """is_settings_relative_self, asked of a packages[] ENTRY of either shape."""
    src = source_of(item)
    return isinstance(src, str) and is_settings_relative_self(src, settings_dir, repo_dir)


def _entwurf_matches(packages: list, repo_dir: str, settings_dir: str) -> list:
    return [
        item for item in packages
        if isinstance(source_of(item), str) and is_entwurf_source(source_of(item), repo_dir, settings_dir)  # type: ignore[arg-type]
    ]


def _write(settings_path: Path, data: dict, original_text: str | None) -> None:
    """Serialize with the file's own indentation (pi_settings_io.detect_indent)."""
    settings_path.write_text(dumps(data, detect_indent(original_text)))


def _read_text(settings_path: Path) -> str | None:
    return settings_path.read_text() if settings_path.exists() else None


def register(settings_path: Path, repo_dir_arg: str) -> str:
    """"noop" if entwurf is already the sole canonical entry (file untouched),
    else "registered" (rewritten with a single canonical entry)."""
    repo_dir = str(Path(repo_dir_arg).resolve())
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    original_text = _read_text(settings_path)
    data = _load(settings_path)
    packages = _packages(settings_path, data)
    settings_dir = _settings_dir(settings_path)

    entwurf_entries = _entwurf_matches(packages, repo_dir, settings_dir)
    # Already correct iff exactly ONE entwurf entry and it NAMES repo_dir — either as
    # the canonical absolute string or as a settings-relative path resolving there.
    # Both are the same registration to pi, so both are a no-op: order-insensitive, no
    # rewrite, mtime stable. Recognizing only the absolute form is what made `setup`
    # duplicate this repo's own committed `".."` and restyle the tracked file (#53 B).
    # Both arms require the STRING form, so an object-form entry still collapses to a
    # canonical string exactly as before.
    if len(entwurf_entries) == 1 and isinstance(entwurf_entries[0], str) and (
        entwurf_entries[0] == repo_dir
        or is_settings_relative_self(entwurf_entries[0], settings_dir, repo_dir)
    ):
        return "noop"

    # A rewrite keeps the PORTABLE form when the file already had one: absolutizing a
    # committed `".."` would repair the duplicate and dirty the tracked bytes in the
    # same breath. Otherwise the canonical absolute path is what install writes.
    survivor = next(
        (
            source_of(e) for e in entwurf_entries
            if _is_relative_self_item(e, settings_dir, repo_dir)
        ),
        repo_dir,
    )
    filtered = [item for item in packages if item not in entwurf_entries]
    data["packages"] = filtered + [survivor]
    _write(settings_path, data, original_text)
    return "registered"


def _removable(packages: list, repo_dir: str, settings_dir: str) -> tuple[list, list]:
    """Split entwurf entries into (removable, preserved).

    REMOVABLE = every managed shape the matcher recognizes, including ones register
    never literally wrote (an npm spec, a node_modules path, a stale clone path) —
    those are how a previous install or a moved checkout left this package
    registered, and the inverse has to reach them.

    PRESERVED = settings-relative self-references, the one shape register CANNOT
    have produced (it always writes the resolved absolute path). Such an entry is
    the repo's committed portable registration or the operator's own hand edit.
    Deleting it would make uninstall a source editor, which is the defect #53 B is
    about, pointed the other way. main() prints what was kept so the incompleteness
    is loud rather than silent.
    """
    matches = _entwurf_matches(packages, repo_dir, settings_dir)
    preserved = [item for item in matches if _is_relative_self_item(item, settings_dir, repo_dir)]
    removable = [item for item in matches if item not in preserved]
    return removable, preserved


def remove(settings_path: Path, repo_dir_arg: str) -> tuple[int, int]:
    """Drop every MANAGED entwurf entry (any shape/path), preserving settings-relative
    self-references. Returns (removed, preserved)."""
    repo_dir = str(Path(repo_dir_arg).resolve())
    if not settings_path.exists():
        return 0, 0
    original_text = _read_text(settings_path)
    data = _load(settings_path)
    packages = _packages(settings_path, data)
    settings_dir = _settings_dir(settings_path)

    removable, preserved = _removable(packages, repo_dir, settings_dir)
    if not removable:
        return 0, len(preserved)
    data["packages"] = [item for item in packages if item not in removable]
    _write(settings_path, data, original_text)
    return len(removable), len(preserved)


def would_remove(settings_path: Path, repo_dir_arg: str) -> tuple[int, int]:
    """Count what a --remove WOULD drop and what it would preserve, writing NOTHING.

    Read-only companion to remove() for --dry-run — lets a caller (e.g. run.sh's
    project `remove` pointer note) decide whether the global user-scope inverse is
    worth suggesting without mutating the operator's settings. It asks the SAME
    predicate remove asks, so a dry-run can never over- or under-report it.
    """
    repo_dir = str(Path(repo_dir_arg).resolve())
    if not settings_path.exists():
        return 0, 0
    data = _load(settings_path)
    packages = _packages(settings_path, data)
    removable, preserved = _removable(packages, repo_dir, _settings_dir(settings_path))
    return len(removable), len(preserved)


def main(argv: list[str]) -> int:
    flags = {a for a in argv[1:] if a.startswith("--")}
    args = [a for a in argv[1:] if not a.startswith("--")]
    do_remove = "--remove" in flags
    dry_run = "--dry-run" in flags
    known = {"--remove", "--dry-run"}
    unknown = flags - known
    if unknown:
        raise SystemExit(f"unknown flag(s): {', '.join(sorted(unknown))}")
    # --dry-run is a REMOVE-only preview. Without --remove it would otherwise fall
    # through to the register path and WRITE — a flag literally named "dry-run"
    # mutating settings is an install-hygiene footgun, so reject it loud instead of
    # silently registering.
    if dry_run and not do_remove:
        raise SystemExit("--dry-run is only supported with --remove")
    if len(args) != 2:
        raise SystemExit("usage: register-pi-package.py <settings.json> <repo_dir> [--remove] [--dry-run]")
    settings_path = Path(args[0])
    repo_dir_arg = args[1]
    resolved = str(Path(repo_dir_arg).resolve())

    if do_remove:
        n, kept = (would_remove if dry_run else remove)(settings_path, repo_dir_arg)
        verb = "would remove" if dry_run else "removed"
        if n:
            print(f"remove: {verb} {n} entwurf packages[] entr{'y' if n == 1 else 'ies'} from {settings_path}")
        else:
            print(f"remove: no entwurf packages[] entry to remove ({settings_path})")
        # Never silent: an inverse that deliberately leaves something behind has to
        # say what and why, or the operator reads "removed" as "fully unregistered".
        if kept:
            print(
                f"remove: kept {kept} settings-relative entwurf entr{'y' if kept == 1 else 'ies'} "
                f"({settings_path}) — install never writes that form, so it is committed/operator "
                "source, not install state; edit the file by hand to drop it"
            )
        return 0

    result = register(settings_path, repo_dir_arg)
    if result == "noop":
        print(f"install: entwurf package already registered (no-op) -> {resolved}")
    else:
        print(f"install: registered entwurf package -> {settings_path}")
        print(f"install: package source -> {resolved}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
