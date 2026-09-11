#!/usr/bin/env bash
# codex-birth-uninstall.sh — the EXACT inverse of codex-birth-install.sh (#95).
#
# WHAT "EXACT" MEANS HERE, AND WHY IT IS STRICTER THAN THE OTHER INVERSES
#
# This is the only entwurf inverse that removes files from `/etc`. So the ownership
# state is not merely the removal PLAN, it is the removal AUTHORITY, and the authority
# is per-byte:
#
#   * no state            -> refuse. Nothing on this host is provably ours, and a
#                            guessed `rm` in /etc is not a repair.
#   * state, file matches  -> remove. Those are the bytes this unit published.
#   * state, file DRIFTED  -> refuse THAT FILE, name it, exit non-zero. Somebody edited
#                            it; deleting an operator's edit because it lives at a path
#                            we once owned is exactly the thing Hard Rule 8 forbids.
#   * state, file absent   -> already done. Report and continue; an absent file is not
#                            drift and must not block the rest of the inverse.
#
# It also removes nothing it did not create:
#   * `/etc/codex/` is rmdir'd ONLY if the state says this unit created it AND it is
#     empty. An operator's own config.toml in there means the directory stays.
#   * `/etc/codex/config.toml` is never read, written, moved or removed. Not once, on
#     any path. The install never touched it either.
#   * `~/.codex/` is not this unit's territory in any direction.
#   * meta-records are NEVER removed. A citizen's identity outlives the hook that minted
#     it; the fresh-cut command is the only thing allowed to touch the store.
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P -- "$(dirname -- "$SOURCE")" && pwd)"
  TARGET="$(readlink "$SOURCE")"
  case "$TARGET" in
    /*) SOURCE="$TARGET" ;;
    *) SOURCE="$DIR/$TARGET" ;;
  esac
done

CODEX_ETC="/etc/codex"
STATE_DIR="/var/lib/entwurf/codex-birth"
STATE_FILE="$STATE_DIR/install-state.json"

die() { echo "[codex-birth-uninstall] $*" >&2; exit 1; }
note() { echo "[codex-birth-uninstall] $*"; }

for arg in "$@"; do
  case "$arg" in
    -h|--help) sed -n '2,30p' "$SOURCE" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$arg' — this inverse takes no options; the ownership state is its only input." ;;
  esac
done

case "$(uname -s)" in
  Linux) ;;
  *) die "Linux only, like the installer: /etc/codex is the Linux System-layer config folder." ;;
esac
if [ "$(id -u)" -ne 0 ]; then
  die "requires root (effective uid 0) — it removes files under /etc/codex and /var/lib/entwurf.
This script will NOT escalate for you:
    sudo $SOURCE
Nothing has been read or written."
fi

command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required (removal is licensed per-byte by digest) and is not on PATH."
NODE_BIN="$(command -v node)" || die "node is not on PATH — it parses the ownership state."

if [ ! -e "$STATE_FILE" ]; then
  die "no ownership state at $STATE_FILE, so nothing on this host is provably ours.
This inverse removes only what that state vouches for, by digest. If you believe a
half-install is present, inspect these paths by hand — they are the complete surface:
    $CODEX_ETC/hooks.json
    $CODEX_ETC/entwurf-birth/
Nothing written."
fi
[ -L "$STATE_FILE" ] && die "$STATE_FILE is a symlink — refusing to take removal authority from a link. Nothing written."
[ -f "$STATE_FILE" ] || die "$STATE_FILE is not a regular file. Nothing written."
# The SAME integrity the installer and the doctor demand of this file. It is the removal
# authority for paths in /etc, so a copy another user can rewrite is a copy another user can
# point at any file on this host — and this was the one of the three surfaces that read it
# without looking. Refusing here is not redundancy; it is the missing half of the line.
STATE_OWNER="$(stat -c '%u' -- "$STATE_FILE" 2>/dev/null || echo '?')"
STATE_MODE="$(stat -c '%a' -- "$STATE_FILE" 2>/dev/null || echo '?')"
case "$STATE_MODE" in *[!0-7]*) die "$STATE_FILE has an unreadable mode '$STATE_MODE'. Nothing written." ;; esac
[ "$STATE_OWNER" = "0" ] || die "$STATE_FILE is owned by uid $STATE_OWNER, not root — it authorizes removal of files in /etc, so a non-root owner means anyone could have chosen what this deletes. Refusing; nothing written.
Inspect it by hand, then either restore root ownership or remove the paths deliberately."
[ $((8#$STATE_MODE & 0022)) -eq 0 ] || die "$STATE_FILE is group/world-writable (mode $STATE_MODE), so it cannot authorize deleting anything under /etc. Refusing; nothing written.
The installer and the doctor refuse this same state; repair it there rather than deleting on its word."

# One parse, one flat text plan: `<sha256> <abs path> <label>` per owned file, then the
# scalar facts. Parsing in node keeps the state a real JSON document instead of a
# grep-shaped format, and keeps this script free of a second JSON dialect.
PLAN="$(INVERSE_HOOKS_FILE="$CODEX_ETC/hooks.json" INVERSE_HELPER_DIR="$CODEX_ETC/entwurf-birth" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (s.schema !== "codex-birth-install-state/v1") throw new Error("unknown state schema " + JSON.stringify(s.schema));
  if (s.status !== "installed" && s.status !== "publishing") throw new Error("unknown state status " + JSON.stringify(s.status));
  const hex = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
  // THE BINDING, same as the installer and the doctor. Absolute is not enough: this unit owns
  // two FIXED paths, so a state naming anything else is authority for somewhere else — and an
  // inverse that followed it would delete files at a path it was never allowed to own. The
  // doctor tells operators "the inverse refuses it too"; this is the line that makes that true.
  if (s.hooksFile !== process.env.INVERSE_HOOKS_FILE) throw new Error("hooksFile is " + JSON.stringify(s.hooksFile) + ", not the fixed path this unit owns (" + process.env.INVERSE_HOOKS_FILE + ")");
  if (s.helperDir !== process.env.INVERSE_HELPER_DIR) throw new Error("helperDir is " + JSON.stringify(s.helperDir) + ", not the fixed path this unit owns (" + process.env.INVERSE_HELPER_DIR + ")");
  if (!hex(s.hooksSha256)) throw new Error("hooksSha256 is not a sha256 hex digest");
  if (!Array.isArray(s.helperFiles) || s.helperFiles.length === 0) throw new Error("helperFiles is empty");
  // TWO generations can be ours, and only mid-publish. An install interrupted between its
  // two renames leaves live bytes belonging to the generation it was REPLACING, and those
  // bytes are exactly as owned as the incoming ones. A plan that named only the incoming
  // generation would report them as DRIFT and leave root-owned files in /etc that nothing
  // is ever allowed to remove — the failure this inverse exists to prevent.
  let previous = null;
  if (s.previous !== null && s.previous !== undefined) {
    if (s.status !== "publishing") throw new Error("a finished install still records state.previous — the publish that owned it never cleared it");
    previous = s.previous;
    if (!(hex(previous.hooksSha256) || previous.hooksSha256 === "absent")) throw new Error("state.previous.hooksSha256 is neither a digest nor \"absent\"");
    if (!Array.isArray(previous.helperFiles)) throw new Error("state.previous.helperFiles is not a list");
  }
  const lines = [];
  // path -> the set of digests any owned generation recorded for it.
  const owned = new Map();
  const collect = (files, label) => {
    for (const f of files) {
      if (typeof f?.path !== "string" || f.path.length === 0) throw new Error("a " + label + " entry has no path");
      if (f.path.startsWith("/") || f.path.split("/").includes("..")) throw new Error(label + " path escapes helperDir: " + f.path);
      if (!hex(f.sha256)) throw new Error(label + " sha256 is not a digest for " + f.path);
      const digests = owned.get(f.path) ?? new Set();
      digests.add(f.sha256);
      owned.set(f.path, digests);
    }
  };
  collect(s.helperFiles, "helperFiles");
  if (previous !== null) collect(previous.helperFiles, "state.previous.helperFiles");
  for (const [rel, digests] of [...owned.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    lines.push(["HELPER", [...digests].join(","), path.join(s.helperDir, rel)].join("\t"));
  }
  // Nested closure directories (today: `lib/`) are part of what was installed, so the
  // inverse has to reclaim them too — deepest first, and still only by `rmdir`, so a
  // file we do not own keeps its directory alive.
  const dirs = new Set();
  for (const rel of owned.keys()) {
    let d = path.dirname(rel);
    while (d && d !== "." && d !== "/") {
      dirs.add(d);
      d = path.dirname(d);
    }
  }
  for (const d of [...dirs].sort((a, b) => b.split("/").length - a.split("/").length)) {
    lines.push(["HELPERDIR", "-", path.join(s.helperDir, d)].join("\t"));
  }
  const hooksDigests = new Set([s.hooksSha256]);
  if (previous !== null && hex(previous.hooksSha256)) hooksDigests.add(previous.hooksSha256);
  lines.push(["HOOKS", [...hooksDigests].join(","), s.hooksFile].join("\t"));
  lines.push(["META", s.status, s.unitVersion ?? "?", s.etcDirCreated === true ? "etc-created" : "etc-preexisting", s.helperDir].join("\t"));
  process.stdout.write(lines.join("\n"));
' "$STATE_FILE" 2>&1)" || die "the ownership state is malformed, so what to remove is UNKNOWN: $PLAN
Inspect $STATE_FILE by hand. Nothing written."

HELPER_DIR=""
ETC_CREATED=false
STATUS=""
UNIT_VERSION=""
# One pass over the plan for the scalar facts. No awk: the field split is already done
# by `read`, and a second text tool would be a second dialect to keep honest.
while IFS=$'\t' read -r kind f2 f3 f4 f5; do
  if [ "$kind" = "META" ]; then
    STATUS="$f2"
    UNIT_VERSION="$f3"
    if [ "$f4" = "etc-created" ]; then ETC_CREATED=true; fi
    HELPER_DIR="$f5"
  fi
done <<< "$PLAN"

note "state: status=$STATUS unitVersion=$UNIT_VERSION helperDir=$HELPER_DIR etcDirCreated=$ETC_CREATED"

DRIFTED=0
REMOVED=0
ABSENT=0

remove_owned() { # $1 = comma-separated accepted sha256 set, $2 = absolute path, $3 = label
  local want="$1" target="$2" label="$3" live matched candidate
  if [ -L "$target" ]; then
    echo "[codex-birth-uninstall] DRIFT: $label is a SYMLINK now ($target) — refusing to remove through a link." >&2
    DRIFTED=$((DRIFTED + 1))
    return
  fi
  if [ ! -e "$target" ]; then
    note "already absent: $target"
    ABSENT=$((ABSENT + 1))
    return
  fi
  if [ ! -f "$target" ]; then
    echo "[codex-birth-uninstall] DRIFT: $label is no longer a regular file ($target) — leaving it." >&2
    DRIFTED=$((DRIFTED + 1))
    return
  fi
  live="$(sha256sum -- "$target" | cut -d' ' -f1)"
  matched=0
  # Two accepted digests at most, and only mid-publish: the generation being installed and
  # the one it was replacing. Anything else is an operator edit and stays.
  while IFS= read -r candidate; do
    [ "$live" = "$candidate" ] && matched=1
  done <<< "$(echo "$want" | tr ',' '\n')"
  if [ "$matched" -ne 1 ]; then
    echo "[codex-birth-uninstall] DRIFT: $label was edited after install ($target: live $live, recorded $want) — LEFT IN PLACE." >&2
    DRIFTED=$((DRIFTED + 1))
    return
  fi
  rm -f -- "$target"
  note "removed $target"
  REMOVED=$((REMOVED + 1))
}

# hooks.json FIRST: while it exists, every new session runs the launcher, so removing the
# closure first would leave a window of sessions firing a hook whose payload is gone.
# That window is harmless (the launcher refuses loudly) but it is avoidable, and the
# install publishes in exactly the opposite order for the same reason.
while IFS=$'\t' read -r kind sha target; do
  [ "$kind" = "HOOKS" ] || continue
  remove_owned "$sha" "$target" "hooks.json"
done <<< "$PLAN"

while IFS=$'\t' read -r kind sha target; do
  [ "$kind" = "HELPER" ] || continue
  remove_owned "$sha" "$target" "closure member $(basename -- "$target")"
done <<< "$PLAN"

# Nested closure directories, deepest first (the plan is already ordered that way).
while IFS=$'\t' read -r kind _sha target; do
  [ "$kind" = "HELPERDIR" ] || continue
  if [ -d "$target" ] && [ ! -L "$target" ]; then
    if rmdir -- "$target" 2>/dev/null; then
      note "removed $target/"
    else
      echo "[codex-birth-uninstall] $target/ is not empty — leaving it (contents this unit does not own, or drifted members above)." >&2
      DRIFTED=$((DRIFTED + 1))
    fi
  fi
done <<< "$PLAN"

# Directories: only if EMPTY, and only ones this unit made. `rmdir` (never `rm -r`) is
# the whole guarantee — a leftover file we do not own keeps its directory alive.
if [ -d "$HELPER_DIR" ] && [ ! -L "$HELPER_DIR" ]; then
  # The closure dir is published 0555; rmdir needs write on the PARENT, not on it, but a
  # drifted leftover inside it must still be visible in the message below.
  if rmdir -- "$HELPER_DIR" 2>/dev/null; then
    note "removed $HELPER_DIR/"
  else
    echo "[codex-birth-uninstall] $HELPER_DIR/ is not empty — leaving it (contents this unit does not own, or drifted members above)." >&2
    DRIFTED=$((DRIFTED + 1))
  fi
fi

if [ "$ETC_CREATED" = true ] && [ -d "$CODEX_ETC" ] && [ ! -L "$CODEX_ETC" ]; then
  if rmdir -- "$CODEX_ETC" 2>/dev/null; then
    note "removed $CODEX_ETC/ (this unit created it and nothing else is left in it)"
  else
    note "kept $CODEX_ETC/ — it is not empty (your config.toml and anything else stay untouched)"
  fi
fi

if [ "$DRIFTED" -gt 0 ]; then
  # The state is the authority for the files that are STILL THERE, so it is kept: a
  # deleted state would leave drifted /etc files with no recorded provenance at all, and
  # the installer would then refuse them as foreign forever.
  die "$REMOVED removed, $ABSENT already absent, $DRIFTED DRIFTED and left in place (named above).
The ownership state is RETAINED as the provenance of what remains: $STATE_FILE
Resolve each drifted path by hand, then re-run this inverse."
fi

# State LAST: while it exists, a partial failure above still has a removal authority.
rm -f -- "$STATE_FILE"
note "removed $STATE_FILE"
rmdir -- "$STATE_DIR" 2>/dev/null && note "removed $STATE_DIR/" || true
rmdir -- "$(dirname -- "$STATE_DIR")" 2>/dev/null && note "removed $(dirname -- "$STATE_DIR")/" || true

note "DONE. $REMOVED file(s) removed, $ABSENT already absent."
note "Codex meta-records were NOT touched — an existing citizen keeps its identity; only new threads stop being born."
note "Already-open sessions still hold the old declaration in memory; they stop firing when they end."
