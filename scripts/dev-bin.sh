#!/usr/bin/env bash
# dev-bin — expose entwurf's STABLE bins on PATH for a DEV checkout (막힘 ②). A CONSUMER (npm
# install) gets these bins on PATH from package.json "bin" bin-linking; a DEV checkout does NOT,
# because pnpm does not self-link a package's own bins. `./run.sh setup` is the dev install
# command, so setup owns this exposure via MANAGED symlinks
#   <BIN_DIR>/<name>  ->  <target in this checkout>
# each recorded in its OWN checkout-OUTSIDE install-state (<name>.install-state.json) for an
# honest inverse.
#
# Managed bins (all are BARE names — no repo/checkout path is EVER written into a harness
# config; this only makes each package command RESOLVE in a dev checkout):
#   entwurf                 -> run.sh                          (operator command / managed Copilot runtime)
#   entwurf-bridge          -> mcp/entwurf-bridge/start.sh    (agy mcp_config command)
#   entwurf-agy-statusline  -> scripts/agy-statusline.sh      (agy settings.statusLine command)
#   entwurf-agy-imprint     -> scripts/agy-imprint.sh         (agy PreInvocation birth hook)
#   entwurf-copilot-statusline -> scripts/copilot-statusline.sh (copilot settings.statusLine command)
#
# Ownership discipline (mirrors the agy adopt/refuse rule, 봉인 7), applied PER BIN:
#   - create/refresh ONLY a link that is OURS — absent, or a symlink into our target, or the
#     exact link our state recorded (target may have moved checkouts).
#   - a FOREIGN target (regular file / dir / symlink pointing elsewhere) is REFUSED, never
#     clobbered (someone else's SSOT).
#
# Legacy migration (pre-multi-bin, honest): a single `install-state.json` meant entwurf-bridge.
# On expose it is ADOPTED as `entwurf-bridge.install-state.json` ONLY when its content is
# entwurf-bridge's (linkPath basename == entwurf-bridge); corrupt/foreign → refuse+report (never
# guess). New name appears first (atomic rename), old name is gone after. A re-appearing legacy
# name on a later expose is re-reported (drift visibility).
#
#   expose [name]   create/refresh managed link(s) (idempotent; REFUSE foreign → exit 3).
#                   no name = all managed bins, each attempted INDEPENDENTLY (#86 C1): one
#                   foreign refusal no longer aborts the loop, the trailing summary reports
#                   attempted/ok/refused truthfully, and any refusal still exits 3.
#   remove [name]   honest inverse from state (remove only OUR link; REFUSE if it became foreign).
#                   no name = all managed bins.
#   verify <name>   require OUR symlink → target and that exact link as the PATH winner.
#   exclusive       require that NO other root answers to any package.json bin name — not only
#                   the PATH winner. A winner check alone let a later PATH entry (an old global
#                   shim) stay selectable by a shell with another PATH order, e.g. non-interactive
#                   SSH. Read-only: every entry of this PATH plus the global bin dir that `pnpm bin
#                   -g` / `npm prefix -g` report. Same resolved target = the same install (allowed);
#                   anything else is another root, never guessed as ours. exit 0 none / 5 another
#                   root (named, with a conditional removal hint — nothing is removed) / 6 the
#                   package manifest or a package manager could not be inspected (fail-closed).
#
# Overridable for the isolated smoke:
#   ENTWURF_DEV_BIN_DIR           link location (default: ~/.local/bin — where agy itself lives)
#   ENTWURF_OPERATOR_TARGET       entwurf target (default: $REPO/run.sh)
#   ENTWURF_BRIDGE_TARGET         entwurf-bridge target (default: $REPO/mcp/entwurf-bridge/start.sh)
#   ENTWURF_AGY_STATUSLINE_TARGET entwurf-agy-statusline target (default: $REPO/scripts/agy-statusline.sh)
#   ENTWURF_AGY_IMPRINT_TARGET    entwurf-agy-imprint target (default: $REPO/scripts/agy-imprint.sh)
#   ENTWURF_COPILOT_STATUSLINE_TARGET entwurf-copilot-statusline target (default: $REPO/scripts/copilot-statusline.sh)
#   ENTWURF_DEV_BIN_PM_TIMEOUT    seconds one package-manager query may take (default 10)
#   XDG_DATA_HOME                 state root (states under $XDG_DATA_HOME/entwurf/dev-bin/)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/.." && pwd)"

BIN_DIR="${ENTWURF_DEV_BIN_DIR:-$HOME/.local/bin}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/dev-bin"
LEGACY_STATE="$STATE_DIR/install-state.json"   # pre-multi-bin single state == entwurf-bridge

MANAGED_BINS="entwurf entwurf-bridge entwurf-agy-statusline entwurf-agy-imprint entwurf-copilot-statusline"

log()  { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

bin_target() {  # $1 = name → prints target path (env-overridable for smoke)
  case "$1" in
    entwurf)                echo "${ENTWURF_OPERATOR_TARGET:-$REPO_DIR/run.sh}" ;;
    entwurf-bridge)         echo "${ENTWURF_BRIDGE_TARGET:-$REPO_DIR/mcp/entwurf-bridge/start.sh}" ;;
    entwurf-agy-statusline) echo "${ENTWURF_AGY_STATUSLINE_TARGET:-$REPO_DIR/scripts/agy-statusline.sh}" ;;
    entwurf-agy-imprint)    echo "${ENTWURF_AGY_IMPRINT_TARGET:-$REPO_DIR/scripts/agy-imprint.sh}" ;;
    entwurf-copilot-statusline) echo "${ENTWURF_COPILOT_STATUSLINE_TARGET:-$REPO_DIR/scripts/copilot-statusline.sh}" ;;
    *) return 1 ;;
  esac
}
# Every name bin_target answers for. Kept apart from MANAGED_BINS (what expose links): whether a
# name is exposed must not change the target exclusive expects for it.
TARGET_BINS="entwurf entwurf-bridge entwurf-agy-statusline entwurf-agy-imprint entwurf-copilot-statusline"
state_file_for() { echo "$STATE_DIR/$1.install-state.json"; }

state_link() {  # $1 = state file → recorded linkPath, or empty
  [ -f "$1" ] || { echo ""; return 0; }
  python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("linkPath",""))
except Exception: print("")' "$1" 2>/dev/null || echo ""
}
state_target() {  # $1 = state file → recorded target, or empty
  [ -f "$1" ] || { echo ""; return 0; }
  python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("target",""))
except Exception: print("")' "$1" 2>/dev/null || echo ""
}

# Is $link ours to manage? ours = truly absent OR a symlink into our target OR the exact link our
# state recorded AND still pointing where we recorded it (moved-checkout relink stays ours; a
# foreign symlink SWAPPED IN at our recorded path is refused — GPT R). $1=link $2=target $3=state.
link_is_ours() {
  local link="$1" target="$2" sf="$3"
  if [ ! -e "$link" ] && [ ! -L "$link" ]; then return 0; fi   # truly absent (not even dangling)
  if [ -L "$link" ]; then
    local cur; cur="$(readlink "$link")"
    [ "$cur" = "$target" ] && return 0
    [ "$(state_link "$sf")" = "$link" ] && [ "$cur" = "$(state_target "$sf")" ] && return 0
    return 1                                                    # foreign symlink
  fi
  return 1                                                      # regular file / dir → foreign
}

path_has_bindir() { case ":$PATH:" in *":$BIN_DIR:"*) return 0 ;; *) return 1 ;; esac; }

write_state() {  # $1=state_file $2=link $3=target $4=detect
  mkdir -p "$STATE_DIR"
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import json, os, sys, tempfile, time
state, link, target, detect = sys.argv[1:5]
doc = {"schemaVersion": 1, "linkPath": link, "target": target, "detectMode": detect,
       "stampedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
d = os.path.dirname(state)
fd, tmp = tempfile.mkstemp(dir=d, prefix=".install-state.", suffix=".json")
with os.fdopen(fd, "w") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
os.replace(tmp, state)   # atomic
PY
}

# Adopt a pre-multi-bin single install-state.json as entwurf-bridge's, content-checked.
migrate_legacy() {
  [ -f "$LEGACY_STATE" ] || return 0
  local new; new="$(state_file_for entwurf-bridge)"
  [ "$LEGACY_STATE" = "$new" ] && return 0   # defensive (names differ by construction)
  local verdict
  verdict="$(python3 - "$LEGACY_STATE" <<'PY'
import json, os, sys
try:
    d = json.load(open(sys.argv[1]))
    print("yes" if os.path.basename(d.get("linkPath", "")) == "entwurf-bridge" else "no")
except Exception:
    print("corrupt")
PY
)"
  case "$verdict" in
    yes) : ;;
    no)  fail "dev-bin legacy migration REFUSE: $LEGACY_STATE is not an entwurf-bridge state (linkPath basename != entwurf-bridge). Resolve by hand — refusing to guess." ;;
    *)   fail "dev-bin legacy migration REFUSE: $LEGACY_STATE is corrupt/unreadable. Resolve by hand." ;;
  esac
  if [ -f "$new" ]; then
    warn "[dev-bin] legacy $LEGACY_STATE re-appeared alongside $new — dropping legacy (already migrated; investigate if recurring)."
    rm -f "$LEGACY_STATE"
  else
    mv "$LEGACY_STATE" "$new"   # atomic rename: new name is present, old is gone
    log "[dev-bin] migrated legacy dev-bin state → $(basename "$new")"
  fi
}

expose_one() {  # $1 = name; a foreign link RETURNS 3 (no exit) so the no-arg
                # composition can attempt every unit independently (#86 C1) —
                # a broken checkout (missing/unknown target) still fails loud.
  local name="$1" target link sf detect
  target="$(bin_target "$name")" || fail "unknown managed bin: $name"
  link="$BIN_DIR/$name"; sf="$(state_file_for "$name")"
  log "[dev-bin expose] $name"
  log "  link:   $link"
  log "  target: $target"
  [ -x "$target" ] || fail "target is not an executable file: $target (is this a dev checkout?)"
  if ! link_is_ours "$link" "$target" "$sf"; then
    warn "[dev-bin] REFUSE ($name): $link exists and is NOT ours (a foreign file/symlink — e.g. a real npm consumer bin). Not clobbering someone else's SSOT."
    return 3
  fi
  detect="created-new"; [ -L "$link" ] && detect="refresh-ours"
  mkdir -p "$BIN_DIR"
  ln -sfn "$target" "$link"
  write_state "$sf" "$link" "$target" "$detect"
  log "  ok: $name → this checkout ($detect)"
  if ! path_has_bindir; then
    warn "[dev-bin] WARN: $BIN_DIR is not on PATH — the bare name '$name' will NOT resolve yet. Add it to PATH (we do not touch your profile). doctor stays FAIL until then."
  fi
}

verify_one() {  # $1 = name
  local name="$1" target link resolved
  target="$(bin_target "$name")" || fail "unknown managed bin: $name"
  link="$BIN_DIR/$name"
  resolved="$(command -v "$name" 2>/dev/null || true)"
  if [ ! -L "$link" ] || [ "$(readlink "$link" 2>/dev/null || true)" != "$target" ] || [ "$resolved" != "$link" ]; then
    warn "[dev-bin] FAIL ($name): source command is not the PATH winner owned by this checkout."
    warn "  expected: $link -> $target"
    warn "  resolved: ${resolved:-<none>}"
    warn "  fix: remove a foreign/shadowing bin or put $BIN_DIR on PATH, then re-run setup."
    return 1
  fi
  log "[dev-bin verify] $name → $target (PATH winner: $link)"
}

do_exclusive() {
  # Our target per package.json bin name: a managed name through bin_target (smoke-overridable),
  # every other name at its package.json path in this checkout. The manifest is read INSIDE the
  # verdict step: a read that fails outside it would reach the verdict as zero names and pass.
  local -a pairs=()
  local b
  for b in $TARGET_BINS; do pairs+=("$b=$(bin_target "$b")"); done
  python3 - "${ENTWURF_DEV_BIN_PM_TIMEOUT:-10}" "$REPO_DIR" "${pairs[@]}" <<'PY'
import json, os, shutil, signal, subprocess, sys

timeout = float(sys.argv[1])
manifest = os.path.join(sys.argv[2], "package.json")
try:
    with open(manifest) as f:
        bins = json.load(f)["bin"]
    if not (isinstance(bins, dict) and "entwurf" in bins
            and all(isinstance(k, str) and k and isinstance(v, str) and v for k, v in bins.items())):
        raise ValueError('"bin" is not a non-empty object of name -> path strings naming entwurf')
except (OSError, ValueError, KeyError, TypeError) as e:
    print(f"[dev-bin] FAIL: could not inspect the package manifest {manifest} — {type(e).__name__}: {e}."
          " Not read as 'no other root'.", file=sys.stderr)
    print("  nothing was removed, no profile edited, no session stopped.", file=sys.stderr)
    sys.exit(6)  # an unreadable manifest is never "0 names, no other root"
managed = dict(pair.split("=", 1) for pair in sys.argv[3:])
ours = {name: os.path.realpath(managed.get(name, os.path.join(sys.argv[2], rel)))
        for name, rel in bins.items()}

dirs = {}      # realpath(dir) -> (dir as seen, [where it was seen])
def add(d, where):
    key = os.path.realpath(d)
    dirs.setdefault(key, (d, []))[1].append(where)

for d in os.environ.get("PATH", "").split(":"):
    add(d or os.getcwd(), "PATH")   # an empty POSIX PATH entry means the cwd

def query(argv):
    exe = shutil.which(argv[0])
    if exe is None:
        return "skip", f"{argv[0]} not on PATH — its global bin dir was not checked"
    try:
        p = subprocess.Popen([exe] + argv[1:], cwd="/", stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    except OSError as e:
        return "error", f"`{' '.join(argv)}` could not start: {e}"
    try:
        out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        p.communicate()
        return "error", f"`{' '.join(argv)}` did not answer within {timeout:g}s"
    if p.returncode != 0:
        tail = err.decode(errors="replace").strip().splitlines()[-1:] or [""]
        return "error", f"`{' '.join(argv)}` exited {p.returncode}: {tail[0]}"
    lines = out.decode(errors="replace").strip().splitlines()
    if len(lines) != 1 or not os.path.isabs(lines[0]):
        return "error", f"`{' '.join(argv)}` printed {len(lines)} line(s), not one absolute path"
    return "ok", lines[0]

checked, skipped, errors = ["PATH"], [], []
for argv, label, to_bin in ((["pnpm", "bin", "-g"], "pnpm global bin", lambda s: s),
                            (["npm", "prefix", "-g"], "npm global bin", lambda s: os.path.join(s, "bin"))):
    state, value = query(argv)
    if state == "ok":
        add(to_bin(value), label)
        checked.append(f"{label} {to_bin(value)}")
    elif state == "skip":
        skipped.append(value)
    else:
        errors.append(value)

others = []
for _key, (d, where) in dirs.items():
    for name, target in ours.items():
        path = os.path.join(d, name)
        if os.path.lexists(path) and os.path.realpath(path) != target:
            others.append((path, os.path.realpath(path), where))

for path, resolved, where in others:
    print(f"[dev-bin] FAIL: another entwurf root is still selectable: {path} -> {resolved}", file=sys.stderr)
    print(f"  seen via: {', '.join(where)}", file=sys.stderr)
    hints = [h for w, h in (("pnpm global bin", "pnpm remove -g @junghanacs/entwurf"),
                            ("npm global bin", "npm uninstall -g @junghanacs/entwurf")) if w in where]
    for h in hints:
        print(f"  if a global @junghanacs/entwurf installed it: {h}", file=sys.stderr)
    print("  " + ("otherwise " if hints else "") + "remove it through whoever owns it.", file=sys.stderr)
for e in errors:
    print(f"[dev-bin] FAIL: could not inspect a package manager — {e}. Not read as 'no other root'.", file=sys.stderr)
if others or errors:
    print(f"  this checkout: {ours.get('entwurf', '?')}", file=sys.stderr)
    print("  nothing was removed, no profile edited, no session stopped. Then re-run: ./run.sh setup <project>", file=sys.stderr)
    sys.exit(5 if others else 6)
print(f"[dev-bin exclusive] no other root under the {len(ours)} package bin names in: {'; '.join(checked)}")
for s in skipped:
    print(f"  not checked: {s}")
print("  covers only these directories — another shell's PATH or another package manager is not covered.")
PY
}

remove_one() {  # $1 = name
  local name="$1" target link sf recorded
  target="$(bin_target "$name")" || fail "unknown managed bin: $name"
  link="$BIN_DIR/$name"; sf="$(state_file_for "$name")"
  log "[dev-bin remove] $name"
  recorded="$(state_link "$sf")"
  if [ -z "$recorded" ]; then log "  note: no state for $name — nothing to undo (idempotent)."; return 0; fi
  if [ -L "$recorded" ]; then
    if [ "$(readlink "$recorded")" = "$target" ]; then
      rm -f "$recorded"; log "  removed managed link: $recorded"
    else
      fail "refused: $recorded is now a symlink to something else (foreign) — not removing it."
    fi
  elif [ -e "$recorded" ]; then
    fail "refused: $recorded is no longer our symlink (became a regular file/dir) — not removing it."
  else
    log "  note: managed link already gone: $recorded"
  fi
  rm -f "$sf"
  rmdir "$STATE_DIR" 2>/dev/null || true
}

do_expose() {  # $1 = optional bin name
  migrate_legacy
  if [ -n "${1:-}" ]; then expose_one "$1"; return $?; fi
  # No-arg = the setup composition. Attempt EVERY unit independently (#86 C1):
  # the old loop stopped at the first foreign refusal while the caller's warning
  # claimed only that one bin was left as-is — units after it were never
  # attempted. Now each refusal is recorded, later units still run, and the
  # summary line reports attempted/ok/refused so no caller can claim less than
  # what happened. Any refusal keeps the loop's exit 3 contract.
  local attempted=0 exposed=0 refused="" rc b
  for b in $MANAGED_BINS; do
    attempted=$((attempted + 1))
    rc=0; expose_one "$b" || rc=$?
    if [ "$rc" -eq 0 ]; then exposed=$((exposed + 1)); else refused="$refused $b"; fi
  done
  if [ -n "$refused" ]; then
    warn "[dev-bin expose] summary: attempted=$attempted ok=$exposed refused=$((attempted - exposed)):$refused (every unit was attempted independently)"
    return 3
  fi
  log "[dev-bin expose] summary: attempted=$attempted ok=$exposed refused=0"
}
do_remove() {  # $1 = optional bin name
  if [ -n "${1:-}" ]; then remove_one "$1"; else for b in $MANAGED_BINS; do remove_one "$b"; done; fi
}

case "${1:-}" in
  expose) shift; do_expose "${1:-}" ;;
  remove) shift; do_remove "${1:-}" ;;
  verify) shift; [ -n "${1:-}" ] || fail "verify requires one managed bin name"; verify_one "$1" ;;
  exclusive) do_exclusive ;;
  *) echo "usage: dev-bin.sh <expose|remove> [bin-name] | verify <bin-name> | exclusive" >&2; exit 2 ;;
esac
