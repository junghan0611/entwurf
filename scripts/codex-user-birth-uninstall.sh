#!/usr/bin/env bash
# codex-user-birth-uninstall — the inverse of codex-user-birth-install.sh.
#
# The ownership state is the ONLY input. Every removal is licensed per-byte by a digest it
# recorded, so this inverse can say three different things about every path it published and
# never guesses at a fourth:
#
#   * already absent        -> done, not drift.
#   * bytes match the state -> removed.
#   * bytes DRIFTED         -> refuse THAT path, name it, leave it, exit non-zero. Somebody
#                              edited it, and deleting an edit nobody can read back is worse
#                              than leaving a file behind.
#
# It never reads or writes config.toml, so the vendor's `[hooks.state]` trust record survives
# this inverse untouched. Removing the declaration does not un-trust it; re-publishing the
# SAME declaration later reuses the operator's original approval, because the trust identity
# is the declaration, not the file's history.
set -euo pipefail

die() { printf '[codex-user-birth-uninstall] %s\n' "$1" >&2; exit 1; }
note() { printf '[codex-user-birth-uninstall] %s\n' "$1"; }

for arg in "$@"; do
  case "$arg" in
    *) die "unknown argument '$arg' — this inverse takes no options; the ownership state is its only input." ;;
  esac
done

[ "$(uname -s)" = "Linux" ] || die "Linux only, like the installer."
[ "$(id -u)" != "0" ] || die "refusing to run as root: this unit owns USER paths and root would remove them under the wrong authority."

UNIT_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/codex-birth"
STATE_FILE="$UNIT_ROOT/install-state.json"
ME="$(id -u)"

command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required (removal is licensed per-byte by digest) and is not on PATH."
NODE_BIN="$(command -v node)" || die "node is not on PATH — it parses the ownership state."
sha_of() { sha256sum -- "$1" | cut -d' ' -f1; }

[ -e "$STATE_FILE" ] || [ -L "$STATE_FILE" ] || die "no ownership state at $STATE_FILE, so nothing on this host is provably ours.
This inverse removes only what that state vouches for. If you believe a declaration is left
over, inspect it and remove it deliberately."
[ -L "$STATE_FILE" ] && die "$STATE_FILE is a symlink — refusing to take removal authority from a link. Nothing removed."
[ -f "$STATE_FILE" ] || die "$STATE_FILE is not a regular file. Nothing removed."
STATE_ST="$(stat -c '%a %u' -- "$STATE_FILE")"
STATE_MODE="$(printf '%s' "$STATE_ST" | cut -d' ' -f1)"
STATE_UID="$(printf '%s' "$STATE_ST" | cut -d' ' -f2)"
[ "$STATE_UID" = "$ME" ] || die "$STATE_FILE is owned by uid $STATE_UID, not you ($ME) — it authorizes removals, so a foreign owner means someone else chose what this deletes. Nothing removed."
[ $((8#$STATE_MODE & 0022)) -eq 0 ] || die "$STATE_FILE is group/world-writable (mode $STATE_MODE), so it cannot authorize deleting anything. Nothing removed."

PLAN="$("$NODE_BIN" -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const hex = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
  if (s.schema !== "codex-user-birth-install-state/v1") throw new Error("foreign state schema " + JSON.stringify(s.schema));
  if (s.status !== "installed" && s.status !== "publishing") throw new Error("unknown status " + JSON.stringify(s.status));
  if (typeof s.hooksFile !== "string" || !s.hooksFile.startsWith("/")) throw new Error("hooksFile is not an absolute path");
  if (typeof s.helperDir !== "string" || !s.helperDir.startsWith("/")) throw new Error("helperDir is not an absolute path");
  if (!hex(s.hooksSha256)) throw new Error("hooksSha256 is not a sha256 hex digest");
  if (!Array.isArray(s.helperFiles) || s.helperFiles.length === 0) throw new Error("helperFiles is empty");
  const lines = [["STATUS", s.status, s.unitVersion ?? ""].join("\t"), ["HOOKS", s.hooksSha256, s.hooksFile].join("\t")];
  const seen = new Set();
  for (const f of s.helperFiles) {
    if (typeof f?.path !== "string" || f.path.length === 0 || f.path.startsWith("/") || f.path.split("/").includes("..")) {
      throw new Error("unsafe helper path " + JSON.stringify(f?.path));
    }
    if (!hex(f.sha256)) throw new Error("bad helper digest for " + f.path);
    if (seen.has(f.path)) throw new Error("duplicate helper path " + f.path);
    seen.add(f.path);
    lines.push(["HELPER", f.sha256, path.join(s.helperDir, f.path)].join("\t"));
  }
  lines.push(["HELPERDIR", "-", s.helperDir].join("\t"));
  process.stdout.write(lines.join("\n") + "\n");
' "$STATE_FILE" 2>&1)" || die "the ownership state is malformed, so what to remove is UNKNOWN: $PLAN
Inspect it and remove the unit deliberately. Nothing removed."

DRIFTED=0
REMOVE_ONE() { # $1 = recorded digest, $2 = absolute path, $3 = label
  local want="$1" target="$2" label="$3" live
  if [ -L "$target" ]; then
    printf '[codex-user-birth-uninstall] DRIFT: %s is a SYMLINK now (%s) — refusing to remove through a link.\n' "$label" "$target" >&2
    DRIFTED=$((DRIFTED + 1)); return
  fi
  if [ ! -e "$target" ]; then
    note "already absent: $target"; return
  fi
  if [ ! -f "$target" ]; then
    printf '[codex-user-birth-uninstall] DRIFT: %s is no longer a regular file (%s) — leaving it.\n' "$label" "$target" >&2
    DRIFTED=$((DRIFTED + 1)); return
  fi
  live="$(sha_of "$target")"
  if [ "$live" != "$want" ]; then
    printf '[codex-user-birth-uninstall] DRIFT: %s was edited after install (%s: live %s, recorded %s) — LEFT IN PLACE.\n' "$label" "$target" "$live" "$want" >&2
    DRIFTED=$((DRIFTED + 1)); return
  fi
  rm -f -- "$target"
  note "removed $target"
}

HELPER_DIR=""
while IFS="$(printf '\t')" read -r kind digest target; do
  case "$kind" in
    STATUS) note "state: status=$digest unitVersion=$target" ;;
    HOOKS) REMOVE_ONE "$digest" "$target" "the declaration" ;;
    HELPER) REMOVE_ONE "$digest" "$target" "helper member" ;;
    HELPERDIR) HELPER_DIR="$target" ;;
  esac
done <<EOF
$PLAN
EOF

# Directories are removed only when EMPTY: a leftover file in there is either drift we just
# refused or something else's, and rmdir failing is the honest answer to both.
if [ -n "$HELPER_DIR" ] && [ -d "$HELPER_DIR" ] && [ ! -L "$HELPER_DIR" ]; then
  rmdir -- "$HELPER_DIR/lib/native-push" 2>/dev/null || true
  rmdir -- "$HELPER_DIR/lib" 2>/dev/null || true
  if rmdir -- "$HELPER_DIR" 2>/dev/null; then note "removed $HELPER_DIR"; else note "kept $HELPER_DIR (not empty)"; fi
fi

if [ "$DRIFTED" -ne 0 ]; then
  die "$DRIFTED path(s) DRIFTED and were left in place; the ownership state is KEPT so a later run can still license them. Nothing else to do automatically."
fi

rm -f -- "$STATE_FILE"
note "removed $STATE_FILE"
rmdir -- "$UNIT_ROOT" 2>/dev/null || true
note "uninstalled (user layer). config.toml was neither read nor written, so the vendor's own hook-trust record is untouched."
