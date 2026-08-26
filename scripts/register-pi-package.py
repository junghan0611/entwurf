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

USER-SCOPE OWNERSHIP (#86 C2). `--scope user --state <path>` puts the GLOBAL
packages[] entry under a recorded owner (`packageRoot` in
$XDG_DATA_HOME/entwurf/pi-package/install-state.json) and retires the silent
last-writer-wins normalization for that scope:
  - fresh (no state, no entwurf entry)     → register + write owner state;
  - same root (state.packageRoot == root)  → today's idempotent normalize/no-op;
  - legacy no-state, sole entry EXACTLY this root (absolute or settings-relative)
                                            → ADOPTION: state written, settings
                                              bytes/mtime untouched;
  - legacy no-state, any other/ambiguous entwurf shape → REFUSE (exit 6), zero write;
  - state owned by ANOTHER root, live OR missing → normal install REFUSE (exit 6),
    zero write, naming `takeover-user-scope`; a missing owner additionally shows as
    the doctor verdict `missing-owner`;
  - the ONLY writer that replaces another owner is the operator-explicit
    `--takeover` (run.sh takeover-user-scope): old→new replace, both roots reported.
Remove under user scope is same-owner-only: a live foreign owner refuses; a MISSING
owner is removable only through run.sh's aligned orphan path (`--orphan-cleanup`,
passed after package entry + package state + provider installerRoot all agree on
that same missing root). No --force flag exists. `--doctor` reports
unregistered / owned / legacy-no-state / mismatch / foreign-owner(live) /
missing-owner without writing. PROJECT scope keeps the state-less behavior above.

`--preflight` (user scope) runs the SAME ownership decision READ-ONLY: identical
exit codes, zero writes — run.sh completes both the package and provider
preflights before either writer runs, so a refusal on one side leaves the other
side byte-identical (atomic user-scope operations). `--doctor` additionally takes
`--provider-state <path>` to report a packageRoot↔installerRoot coupling mismatch
as FAIL (ownership coupling only; provider runtime stays with doctor-pi-provider).

Usage: register-pi-package.py <settings.json> <repo_dir> [--remove] [--dry-run]
         [--scope user|project] [--state <path>] [--takeover] [--orphan-cleanup]
         [--doctor] [--preflight] [--provider-state <path>]
Exit codes: 0 ok · 3 refuse-symlink · 4 corrupt-state/settings · 6 ownership-refusal.
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


# ── user-scope ownership (#86 C2) ────────────────────────────────────────────
STATE_SCHEMA_VERSION = 1


def _refuse(code: int, msg: str) -> None:
    sys.stderr.write(msg.rstrip("\n") + "\n")
    raise SystemExit(code)


def _refuse_symlink(settings_path: Path) -> None:
    # The package writer must never follow a foreign symlink into someone else's
    # SSOT — same rule (and exit code) as register-pi-provider, checked BEFORE
    # any provider step can refuse for its own reasons.
    if settings_path.is_symlink():
        _refuse(3, f"register-pi-package: refusing to write through {settings_path} — it is a symlink "
                   "(someone else's SSOT). Manage it there, or replace it with a regular file, then retry.")


def _load_state(state_path: Path) -> dict | None:
    if not state_path.exists():
        return None
    try:
        data = json.loads(state_path.read_text())
    except json.JSONDecodeError as err:
        _refuse(4, f"register-pi-package: install-state {state_path} is not valid JSON: {err}")
    if not isinstance(data, dict) or not isinstance(data.get("packageRoot"), str):
        _refuse(4, f"register-pi-package: install-state {state_path} has no packageRoot")
    return data


def _write_state(state_path: Path, repo_dir: str, settings_path: Path) -> None:
    import datetime

    state_path.parent.mkdir(parents=True, exist_ok=True)
    state = {
        "schemaVersion": STATE_SCHEMA_VERSION,
        "packageRoot": repo_dir,
        "managedSettingsPath": str(settings_path.resolve()),
        "installedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    tmp = state_path.with_name(state_path.name + f".tmp-{os.getpid()}")
    tmp.write_text(json.dumps(state, indent=2) + "\n")
    os.replace(tmp, state_path)


def _sole_exact_self_entry(settings_path: Path, repo_dir: str) -> bool:
    """True iff the settings carry exactly ONE entwurf entry and it names THIS root
    exactly (canonical absolute or settings-relative self) — the only legacy
    no-state shape adoption may claim without asking the operator."""
    data = _load(settings_path) if settings_path.exists() else {}
    packages = _packages(settings_path, data)
    settings_dir = _settings_dir(settings_path)
    matches = _entwurf_matches(packages, repo_dir, settings_dir)
    return (
        len(matches) == 1
        and isinstance(matches[0], str)
        and (matches[0] == repo_dir or is_settings_relative_self(matches[0], settings_dir, repo_dir))
    )


def _has_entwurf_entries(settings_path: Path, repo_dir: str) -> bool:
    data = _load(settings_path) if settings_path.exists() else {}
    packages = _packages(settings_path, data)
    return bool(_entwurf_matches(packages, repo_dir, _settings_dir(settings_path)))


def _check_settings_binding(state: dict, settings_path: Path, state_path: Path) -> None:
    """The ownership state names WHICH settings file it manages. Any user-scope
    operation targeting a DIFFERENT file is an ownership mismatch — fail closed
    BEFORE either writer runs (this state is #86 C2 new; no legacy exemption)."""
    managed = state.get("managedSettingsPath")
    if not isinstance(managed, str):
        _refuse(4, f"register-pi-package: install-state {state_path} has no managedSettingsPath string")
    if os.path.abspath(managed) != os.path.abspath(str(settings_path)):
        _refuse(6, f"register-pi-package: install-state {state_path} manages {managed}, but this operation "
                   f"targets {settings_path} — ownership record and target disagree; zero settings bytes written. "
                   "Inspect with './run.sh doctor-pi-package'.")


def _remove_exact_owner_entry(settings_path: Path, owner: str) -> int:
    """Remove the recorded owner's EXACT packages[] entry — never through the broad
    entwurf-shape matcher (an npm spec or another `.../entwurf` path must survive).
    Exactly ONE exact entry is required; 0 or 2+ is an ownership/settings mismatch
    and refuses with zero writes. Returns how many OTHER entwurf-shaped entries
    were left in place (reported by the caller)."""
    exact = _exact_root_entries(settings_path, owner)
    if len(exact) != 1:
        _refuse(6, f"register-pi-package: the recorded owner {owner} has {len(exact)} exact packages[] "
                   "entries (expected exactly one) — the ownership record and the settings disagree; "
                   "zero settings bytes written. Inspect with './run.sh doctor-pi-package'.")
    original_text = _read_text(settings_path)
    data = _load(settings_path)
    packages = _packages(settings_path, data)
    removed = False
    kept_pkgs = []
    for item in packages:
        if not removed and item == exact[0]:
            removed = True
            continue
        kept_pkgs.append(item)
    data["packages"] = kept_pkgs
    _write(settings_path, data, original_text)
    others = _entwurf_matches(kept_pkgs, owner, _settings_dir(settings_path))
    return len(others)


def _exact_root_entries(settings_path: Path, root: str) -> list:
    """packages[] STRING entries that name `root` EXACTLY — the resolved absolute
    path, or a settings-relative path resolving exactly there. Deliberately
    narrower than is_entwurf_source: takeover removal must never reach an npm
    spec or an unrelated `.../entwurf` path merely because the matcher would."""
    data = _load(settings_path) if settings_path.exists() else {}
    packages = _packages(settings_path, data)
    settings_dir = _settings_dir(settings_path)
    return [
        p for p in packages
        if isinstance(p, str) and (p.rstrip("/") == root or is_settings_relative_self(p, settings_dir, root))
    ]


def register_user(settings_path: Path, repo_dir_arg: str, state_path: Path, takeover: bool,
                  preflight: bool = False) -> int:
    repo_dir = str(Path(repo_dir_arg).resolve())
    _refuse_symlink(settings_path)
    state = _load_state(state_path)
    if state is not None:
        _check_settings_binding(state, settings_path, state_path)

    if takeover:
        # Operator-explicit takeover: the ONE writer allowed to move the single
        # shared user-scope entry from another owner onto this root. Old and new
        # are both reported; normal install/setup never reaches this path.
        old_root = state.get("packageRoot") if state else None
        if old_root and old_root != repo_dir:
            # The old owner's entry is dropped by its RECORDED root and only as an
            # EXACT entry (absolute, or settings-relative resolving exactly there)
            # — never through the broad entwurf-shape matcher, which could reach an
            # npm spec or another `.../entwurf` path that is not the recorded owner.
            exact = _exact_root_entries(settings_path, old_root)
            if len(exact) != 1:
                _refuse(6, "register-pi-package: takeover refused — the recorded owner "
                           f"{old_root} has {len(exact)} exact packages[] entr{'y' if len(exact) == 1 else 'ies'} "
                           "(expected exactly one). The settings no longer match the ownership record; "
                           "inspect with './run.sh doctor-pi-package' — zero settings bytes written.")
            if preflight:
                print(f"preflight: takeover would move {old_root} -> {repo_dir}")
                return 0
            original_text = _read_text(settings_path)
            data = _load(settings_path)
            data["packages"] = [p for p in _packages(settings_path, data) if p != exact[0]]
            _write(settings_path, data, original_text)
        elif preflight:
            print(f"preflight: takeover would claim {repo_dir} (no other recorded owner)")
            return 0
        result = register(settings_path, repo_dir_arg)
        _write_state(state_path, repo_dir, settings_path)
        if old_root and old_root != repo_dir:
            print(f"takeover: user-scope entwurf registration moved {old_root} -> {repo_dir} ({result})")
        else:
            print(f"takeover: user-scope entwurf registration now {repo_dir} ({result}; no other owner was recorded)")
        return 0

    if state is not None:
        owner = state["packageRoot"]
        if owner == repo_dir:
            if preflight:
                print("preflight: install ok (this root owns the registration)")
                return 0
            result = register(settings_path, repo_dir_arg)
            if result == "noop":
                print(f"install: entwurf package already registered (no-op) -> {repo_dir}")
            else:
                print(f"install: registered entwurf package -> {settings_path} (owner: this root)")
            return 0
        if os.path.isdir(owner):
            _refuse(6, "register-pi-package: the user-scope entwurf registration is owned by another LIVE root: "
                       f"{owner}. Normal install/setup never replaces another owner — zero settings bytes written. "
                       f"Run './run.sh takeover-user-scope' from {repo_dir} to explicitly move the shared entry.")
        _refuse(6, "register-pi-package: the user-scope entwurf registration is owned by a MISSING root: "
                   f"{owner} (doctor verdict: missing-owner). Normal install/setup still refuses — zero settings "
                   "bytes written. Use './run.sh takeover-user-scope' to claim it explicitly, or "
                   "'./run.sh remove-user-scope' for the aligned orphan cleanup.")

    # no state
    if not _has_entwurf_entries(settings_path, repo_dir):
        if preflight:
            print("preflight: install ok (fresh registration)")
            return 0
        result = register(settings_path, repo_dir_arg)
        _write_state(state_path, repo_dir, settings_path)
        print(f"install: registered entwurf package -> {settings_path}")
        print(f"install: package source -> {repo_dir} (owner state written)")
        return 0
    if _sole_exact_self_entry(settings_path, repo_dir):
        # Legacy no-state entry that EXACTLY names this root: adopt by writing the
        # owner state only — the settings bytes and mtime stay untouched.
        if preflight:
            print("preflight: install ok (legacy same-root adoption)")
            return 0
        _write_state(state_path, repo_dir, settings_path)
        print(f"install: adopted legacy user-scope registration for {repo_dir} (owner state written; settings untouched)")
        return 0
    _refuse(6, "register-pi-package: legacy user-scope entwurf entr(y/ies) exist with NO recorded owner and do not "
               f"exactly name this root ({repo_dir}). Refusing to normalize them silently — zero settings bytes "
               "written. Use './run.sh takeover-user-scope' to claim the registration explicitly.")
    return 1  # unreachable


def remove_user(settings_path: Path, repo_dir_arg: str, state_path: Path, orphan: bool,
                preflight: bool = False) -> int:
    repo_dir = str(Path(repo_dir_arg).resolve())
    if settings_path.exists():
        _refuse_symlink(settings_path)
    state = _load_state(state_path)
    if state is not None:
        _check_settings_binding(state, settings_path, state_path)

    if state is not None:
        owner = state["packageRoot"]
        if owner == repo_dir:
            # Exact-entry inverse (#86 C2 final amendment): the owned removal drops
            # ONLY the recorded owner's exact entry — 0 or 2+ exact entries is an
            # ownership mismatch, checked identically by preflight and writer.
            exact = _exact_root_entries(settings_path, owner)
            if len(exact) != 1:
                _refuse(6, f"register-pi-package: the recorded owner {owner} has {len(exact)} exact packages[] "
                           "entries (expected exactly one) — the ownership record and the settings disagree; "
                           "zero settings bytes written. Inspect with './run.sh doctor-pi-package'.")
            if preflight:
                print("preflight: remove ok (this root owns the registration; exact entry present)")
                return 0
            others = _remove_exact_owner_entry(settings_path, owner)
            state_path.unlink()
            print(f"remove: removed the owner's exact packages[] entry from {settings_path} (owner state cleared)")
            if others:
                print(f"remove: kept {others} other entwurf-shaped entr{'y' if others == 1 else 'ies'} "
                      "(npm spec / other path — not this owner's exact entry)")
            return 0
        if os.path.isdir(owner):
            _refuse(6, "register-pi-package: the user-scope registration is owned by another LIVE root: "
                       f"{owner}. This root's inverse must not remove someone else's registration — zero settings "
                       "bytes written. Run remove from that root, or take the entry over first.")
        if orphan:
            # run.sh's aligned orphan path: entry + package state + provider
            # installerRoot all named this same MISSING root before the flag was
            # passed. Exact-entry only, same rule as the owned inverse.
            exact = _exact_root_entries(settings_path, owner)
            if len(exact) != 1:
                _refuse(6, f"register-pi-package: orphan cleanup refused — the MISSING owner {owner} has "
                           f"{len(exact)} exact packages[] entries (expected exactly one); zero settings bytes written.")
            if preflight:
                print(f"preflight: orphan cleanup would remove the MISSING owner {owner} (exact entry present)")
                return 0
            others = _remove_exact_owner_entry(settings_path, owner)
            state_path.unlink()
            print(f"remove: orphan cleanup — removed the exact entry for the MISSING owner {owner} (state cleared)")
            if others:
                print(f"remove: kept {others} other entwurf-shaped entr{'y' if others == 1 else 'ies'} untouched")
            return 0
        _refuse(6, "register-pi-package: the recorded owner root is MISSING: "
                   f"{owner}. Refusing to remove without the aligned orphan path — run './run.sh remove-user-scope' "
                   "so package entry, package state and provider installerRoot are checked together.")

    # no state: same-owner-only under user scope — remove ONLY entries that exactly
    # name this root; any other managed-looking shape is preserved and reported.
    if not settings_path.exists():
        print(f"remove: nothing to do ({settings_path} missing)")
        return 0
    if preflight:
        print("preflight: remove ok (no owner state; self-exact entries only)")
        return 0
    original_text = _read_text(settings_path)
    data = _load(settings_path)
    packages = _packages(settings_path, data)
    settings_dir = _settings_dir(settings_path)
    matches = _entwurf_matches(packages, repo_dir, settings_dir)
    self_removable = [
        m for m in matches
        if isinstance(m, str) and m == repo_dir
    ]
    preserved_rel = [m for m in matches if _is_relative_self_item(m, settings_dir, repo_dir)]
    foreign_like = [m for m in matches if m not in self_removable and m not in preserved_rel]
    if self_removable:
        data["packages"] = [item for item in packages if item not in self_removable]
        _write(settings_path, data, original_text)
        print(f"remove: removed {len(self_removable)} entwurf packages[] entr{'y' if len(self_removable) == 1 else 'ies'} naming this root")
    else:
        print(f"remove: no entwurf packages[] entry naming this root ({settings_path})")
    if preserved_rel:
        print(f"remove: kept {len(preserved_rel)} settings-relative entwurf entr{'y' if len(preserved_rel) == 1 else 'ies'} — committed/operator source, not install state")
    if foreign_like:
        print(f"remove: kept {len(foreign_like)} entwurf-shaped entr{'y' if len(foreign_like) == 1 else 'ies'} with no recorded owner "
              "(not provably this root's) — use './run.sh doctor-pi-package' / takeover-user-scope to resolve ownership")
    return 0


def doctor_user(settings_path: Path, repo_dir_arg: str, state_path: Path,
                provider_state_path: Path | None = None) -> int:
    """Package-side ownership verdict plus the package↔provider OWNERSHIP coupling
    (installerRoot vs packageRoot). Provider RUNTIME verdicts stay with
    doctor-pi-provider — this doctor never probes the bridge."""
    repo_dir = str(Path(repo_dir_arg).resolve())
    state = _load_state(state_path)
    coupling_fail = False
    if state is not None:
        managed = state.get("managedSettingsPath")
        if not isinstance(managed, str) or os.path.abspath(managed) != os.path.abspath(str(settings_path)):
            print(f"doctor-pi-package: FAIL managedSettingsPath mismatch — the package state manages "
                  f"{managed!r} but this host's target is {settings_path}")
            coupling_fail = True
    if provider_state_path is not None and provider_state_path.exists() and state is not None:
        try:
            pp = json.loads(provider_state_path.read_text())
        except json.JSONDecodeError:
            pp = None
        installer_root = pp.get("installerRoot") if isinstance(pp, dict) else None
        if isinstance(installer_root, str) and installer_root != state["packageRoot"]:
            print(f"doctor-pi-package: FAIL coupling mismatch — provider installerRoot {installer_root} "
                  f"!= packageRoot {state['packageRoot']} (the two halves of the user-scope ownership disagree)")
            coupling_fail = True
        elif installer_root is None and pp is not None:
            print("doctor-pi-package: note — provider install-state is LEGACY (no installerRoot); "
                  "a same-root install/setup adopts it")
        pp_managed = pp.get("managedSettingsPath") if isinstance(pp, dict) else None
        if isinstance(pp_managed, str) and os.path.abspath(pp_managed) != os.path.abspath(str(settings_path)):
            print(f"doctor-pi-package: FAIL provider managedSettingsPath mismatch — the provider state manages "
                  f"{pp_managed!r} but this host's target is {settings_path}")
            coupling_fail = True
    data = _load(settings_path) if settings_path.exists() else {}
    packages = _packages(settings_path, data)
    settings_dir = _settings_dir(settings_path)
    matches = _entwurf_matches(packages, repo_dir, settings_dir)

    if state is None:
        if not matches:
            print("doctor-pi-package: unregistered — no owner state, no entwurf packages[] entry")
            return 0
        print(f"doctor-pi-package: legacy-no-state — {len(matches)} entwurf entr{'y' if len(matches) == 1 else 'ies'} with no recorded owner; "
              "repair: './run.sh setup' from the owning root (exact-self adopts) or './run.sh takeover-user-scope'")
        return 1
    owner = state["packageRoot"]
    owner_live = os.path.isdir(owner)
    owner_matches = _entwurf_matches(packages, owner, settings_dir)
    if not owner_matches:
        print(f"doctor-pi-package: mismatch — owner state records {owner} but no packages[] entry names it")
        return 1
    if not owner_live:
        print(f"doctor-pi-package: missing-owner — recorded owner root {owner} does not exist; "
              "repair: './run.sh takeover-user-scope' from a live root, or './run.sh remove-user-scope' (aligned orphan cleanup)")
        return 1
    if owner == repo_dir:
        print(f"doctor-pi-package: owned — this root ({repo_dir}) owns the user-scope registration")
        return 1 if coupling_fail else 0
    print(f"doctor-pi-package: owned-by-other (live) — {owner} owns the user-scope registration; this root does not")
    return 1 if coupling_fail else 0


def main(argv: list[str]) -> int:
    flag_names = {"--remove", "--dry-run", "--takeover", "--orphan-cleanup", "--doctor", "--preflight"}
    args: list[str] = []
    flags: set[str] = set()
    scope = "project"
    state_arg = ""
    provider_state_arg = ""
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "--scope":
            i += 1
            scope = argv[i] if i < len(argv) else ""
        elif a == "--state":
            i += 1
            state_arg = argv[i] if i < len(argv) else ""
        elif a == "--provider-state":
            i += 1
            provider_state_arg = argv[i] if i < len(argv) else ""
        elif a.startswith("--"):
            flags.add(a)
        else:
            args.append(a)
        i += 1
    do_remove = "--remove" in flags
    dry_run = "--dry-run" in flags
    unknown = flags - flag_names
    if unknown:
        raise SystemExit(f"unknown flag(s): {', '.join(sorted(unknown))}")
    if scope not in ("user", "project"):
        raise SystemExit("register-pi-package.py: --scope must be user or project")
    if scope == "user" and not state_arg:
        raise SystemExit("register-pi-package.py: --state is required with --scope user")
    for f in ("--takeover", "--orphan-cleanup", "--doctor", "--preflight"):
        if f in flags and (scope != "user" or not state_arg):
            raise SystemExit(f"register-pi-package.py: {f} requires --scope user --state <path>")
    if "--orphan-cleanup" in flags and not do_remove:
        raise SystemExit("register-pi-package.py: --orphan-cleanup is only supported with --remove")
    if "--takeover" in flags and (do_remove or "--doctor" in flags):
        raise SystemExit("register-pi-package.py: --takeover is an install action")
    # --dry-run is a REMOVE-only preview. Without --remove it would otherwise fall
    # through to the register path and WRITE — a flag literally named "dry-run"
    # mutating settings is an install-hygiene footgun, so reject it loud instead of
    # silently registering.
    if dry_run and not do_remove:
        raise SystemExit("--dry-run is only supported with --remove")
    if len(args) != 2:
        raise SystemExit("usage: register-pi-package.py <settings.json> <repo_dir> [--remove] [--dry-run] "
                         "[--scope user|project] [--state <path>] [--takeover] [--orphan-cleanup] [--doctor]")
    settings_path = Path(args[0])
    repo_dir_arg = args[1]
    resolved = str(Path(repo_dir_arg).resolve())

    if scope == "user":
        state_path = Path(state_arg)
        preflight = "--preflight" in flags
        if "--doctor" in flags:
            return doctor_user(settings_path, repo_dir_arg, state_path,
                               Path(provider_state_arg) if provider_state_arg else None)
        if do_remove:
            if dry_run:
                raise SystemExit("register-pi-package.py: --dry-run is not supported with --scope user")
            return remove_user(settings_path, repo_dir_arg, state_path, "--orphan-cleanup" in flags, preflight)
        return register_user(settings_path, repo_dir_arg, state_path, "--takeover" in flags, preflight)

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
