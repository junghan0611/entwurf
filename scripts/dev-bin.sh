#!/usr/bin/env bash
# dev-bin — expose the `entwurf-bridge` STABLE bin on PATH for a DEV checkout (막힘 ②). A
# CONSUMER (npm install) gets `entwurf-bridge` on PATH from package.json "bin" bin-linking; a
# DEV checkout does NOT, because pnpm does not self-link a package's own bins. `./run.sh setup`
# is the dev install command, so setup owns this exposure: a MANAGED symlink
#   <BIN_DIR>/entwurf-bridge  ->  $REPO/mcp/entwurf-bridge/start.sh
# recorded in a checkout-OUTSIDE install-state for an honest inverse.
#
# Ownership discipline (mirrors the agy adopt/refuse rule, 봉인 7):
#   - We create/refresh ONLY a link that is OURS — absent, or a symlink already pointing at our
#     target, or the exact link recorded in our state (target may have moved checkouts).
#   - A FOREIGN target (a regular file, a directory, or a symlink pointing elsewhere — e.g. a
#     real npm consumer bin) is REFUSED, never clobbered (someone else's SSOT).
#
# Invariants held (페블 B-1..B-4):
#   - The agy mcp_config still records the BARE name `entwurf-bridge`; this only makes that name
#     RESOLVE in a dev checkout. No repo/git/store path is ever written into any config.
#   - If BIN_DIR is not on PATH we WARN + guide only — never mutate a shell profile.
#   - doctor-agy-bridge stays the hard gate: a missing bin still FAILs there (not weakened here).
#
#   expose   create/refresh the managed link (idempotent; REFUSE a foreign target → exit 3)
#   remove   honest inverse from state (remove only OUR link; REFUSE if it became foreign)
#
# Overridable for the isolated smoke:
#   ENTWURF_DEV_BIN_DIR    link location  (default: ~/.local/bin — where agy itself lives)
#   ENTWURF_BRIDGE_TARGET  link target    (default: $REPO/mcp/entwurf-bridge/start.sh)
#   XDG_DATA_HOME          state root      (state at $XDG_DATA_HOME/entwurf/dev-bin/install-state.json)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/.." && pwd)"

BIN_DIR="${ENTWURF_DEV_BIN_DIR:-$HOME/.local/bin}"
LINK="$BIN_DIR/entwurf-bridge"
TARGET="${ENTWURF_BRIDGE_TARGET:-$REPO_DIR/mcp/entwurf-bridge/start.sh}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/dev-bin"
STATE_FILE="$STATE_DIR/install-state.json"

log()  { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

state_link() { # the linkPath we recorded, or empty
  [ -f "$STATE_FILE" ] || { echo ""; return 0; }
  python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("linkPath",""))
except Exception: print("")' "$STATE_FILE" 2>/dev/null || echo ""
}

state_target() { # the target we recorded for the link, or empty
  [ -f "$STATE_FILE" ] || { echo ""; return 0; }
  python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("target",""))
except Exception: print("")' "$STATE_FILE" 2>/dev/null || echo ""
}

# Is $LINK ours to manage? ours = truly absent OR a symlink into our target OR the exact link
# our state recorded AND still pointing where we recorded it. Anything else (regular file / dir /
# a foreign symlink — including one SWAPPED IN at our recorded path) = foreign.
link_is_ours() {
  if [ ! -e "$LINK" ] && [ ! -L "$LINK" ]; then return 0; fi   # truly absent (not even a dangling link)
  if [ -L "$LINK" ]; then
    local cur; cur="$(readlink "$LINK")"
    [ "$cur" = "$TARGET" ] && return 0
    # A link WE recorded — ours ONLY if it STILL points where we last recorded it (state.target).
    # linkPath-match alone is not enough: a foreign symlink swapped in at our path would be
    # clobbered (GPT R). The state.target check keeps a moved-checkout relink safe (cur ==
    # old recorded target) while refusing a foreign swap (cur == someone else's target).
    [ "$(state_link)" = "$LINK" ] && [ "$cur" = "$(state_target)" ] && return 0
    return 1                                                    # foreign symlink
  fi
  return 1                                                      # regular file / dir → foreign
}

path_has_bindir() {
  case ":$PATH:" in *":$BIN_DIR:"*) return 0 ;; *) return 1 ;; esac
}

write_state() {
  local detect="$1"
  mkdir -p "$STATE_DIR"
  python3 - "$STATE_FILE" "$LINK" "$TARGET" "$detect" <<'PY'
import json, os, sys, tempfile, time
state, link, target, detect = sys.argv[1:5]
doc = {
    "schemaVersion": 1,
    "linkPath": link,
    "target": target,
    "detectMode": detect,
    "stampedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
}
d = os.path.dirname(state)
fd, tmp = tempfile.mkstemp(dir=d, prefix=".install-state.", suffix=".json")
with os.fdopen(fd, "w") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
os.replace(tmp, state)   # atomic
PY
}

do_expose() {
  log "[dev-bin expose]"
  log "  link:   $LINK"
  log "  target: $TARGET"
  log "  state:  $STATE_FILE"
  [ -x "$TARGET" ] || fail "target is not an executable file: $TARGET (is this a dev checkout with mcp/entwurf-bridge/start.sh?)"
  if ! link_is_ours; then
    warn "[dev-bin] REFUSE: $LINK exists and is NOT ours (a foreign file/symlink — e.g. a real npm consumer bin)."
    warn "[dev-bin]        Not clobbering someone else's SSOT. Remove it yourself if you want the dev checkout to own it."
    exit 3
  fi
  local detect="created-new"
  [ -L "$LINK" ] && detect="refresh-ours"
  mkdir -p "$BIN_DIR"
  ln -sfn "$TARGET" "$LINK"
  write_state "$detect"
  log "  ok: entwurf-bridge → this checkout ($detect)"
  if ! path_has_bindir; then
    warn "[dev-bin] WARN: $BIN_DIR is not on PATH — the bare name 'entwurf-bridge' will NOT resolve yet."
    warn "[dev-bin]       Add it to PATH in your shell profile (we do not touch it). doctor-agy-bridge stays FAIL until then."
  fi
}

do_remove() {
  log "[dev-bin remove]"
  log "  state: $STATE_FILE"
  local recorded
  recorded="$(state_link)"
  if [ -z "$recorded" ]; then
    log "  note: no dev-bin state — nothing to undo (idempotent)."
    return 0
  fi
  if [ -L "$recorded" ]; then
    if [ "$(readlink "$recorded")" = "$TARGET" ]; then
      rm -f "$recorded"
      log "  removed managed link: $recorded"
    else
      fail "refused: $recorded is now a symlink to something else (foreign) — not removing it."
    fi
  elif [ -e "$recorded" ]; then
    fail "refused: $recorded is no longer our symlink (became a regular file/dir) — not removing it."
  else
    log "  note: managed link already gone: $recorded"
  fi
  rm -f "$STATE_FILE"
  rmdir "$STATE_DIR" 2>/dev/null || true
}

case "${1:-}" in
  expose) do_expose ;;
  remove) do_remove ;;
  *) echo "usage: dev-bin.sh <expose|remove>" >&2; exit 2 ;;
esac
