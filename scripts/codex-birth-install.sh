#!/usr/bin/env bash
# codex-birth-install.sh — the ROOT installer for the Codex native-session BIRTH unit (#95).
#
# WHY THIS ONE IS A ROOT STEP AND THE OTHER THREE BIRTH INSTALLERS ARE NOT
#
# Codex refuses to run an untrusted hook without an interactive "Hooks need review"
# screen, and the two ways around that are not equivalent:
#
#   `--dangerously-bypass-hook-trust`  `[host]` runs a USER-level hook with no prompt —
#       and it is a LOADER OVERRIDE, so auto-attach never happens. Measured 2026-09-08:
#       an app-server listened on the default control socket for the whole run and
#       `thread/loaded/list` stayed `[]` before AND after the turn. The flag and the
#       delivery rail are mutually exclusive, so this path buys a citizen nobody can
#       address. Refused as a design, not merely unused.
#   the MANAGED System layer         `[host]` a hook declared in `/etc/codex/` is
#       `is_managed: true`, runs with NO trust prompt at all, and auto-attach + a raw
#       `turn/start` wake still work (measured A1/A3, same day, same host). That is the
#       only shape where birth and delivery both survive.
#
# `/etc/codex/` is root-owned. So this is a root-level operator step, comparable in kind
# to installing a system service — NOT something `entwurf setup` can do, and `setup`
# must never call it. This script therefore requires euid 0 and NEVER sudos itself: a
# script that escalates is a script that decided for the operator.
#
# WHAT IT OWNS, EXACTLY
#   /etc/codex/hooks.json              ONE complete file, ours or absent — never a merge
#   /etc/codex/entwurf-birth/          the launcher + a self-contained TS payload closure
#   /var/lib/entwurf/codex-birth/      root-owned ownership state (the inverse's authority)
#
# WHAT IT NEVER TOUCHES
#   /etc/codex/config.toml   — `[host]` measured table-preserving, and it is the ONE file
#       where the operator's own hooks, MCP servers, trust state and project trust all
#       live. Owning keys inside it would mean editing a file an operator hand-edits, so
#       this unit takes the other accepted discovery source instead: `[source]`
#       `<config folder>/hooks.json` (`hooks/src/engine/discovery.rs:339-343`), merged
#       per config layer with that layer's own `hooks` TOML key (`:146-166`) and bound to
#       the SAME trust identity (`:767`). One whole file we own beats N keys we share.
#   ~/.codex/                — the user layer is not managed, so a hook there needs the
#       trust prompt or the flag that kills delivery. Not our business either way.
#
# WHY hooks.json AND NOT config.toml, restated as a bet with a named residual: the
# managed-layer NO-PROMPT behaviour was measured through `/etc/codex/config.toml`'s
# `[hooks]` table. `[source]` both sources are merged per LAYER and share one trust
# identity, so a System-layer `hooks.json` inherits `is_managed: true` from the same
# layer. That inheritance is source-derived, not host-measured — the honest bound. The
# doctor's config axis reports what is installed; only a real Codex turn can retire it,
# which is why "zero records" is NOT-YET and never PASS.
#
# Platform: Linux only. `/etc/codex` is the Linux System-layer coordinate
# (`config/src/loader/mod.rs:66`); the managed dir on other platforms is a different
# key (`windows_managed_dir`) and Darwin was never measured. Refusing beats guessing.
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
HERE="$(cd -P -- "$(dirname -- "$SOURCE")" && pwd)"
REPO="$(cd -P -- "$HERE/.." && pwd)"

# The FIXED coordinates. There is no `--prefix`, no `--etc`, no env override and no
# other free-form target seam, on purpose: a production installer that can be pointed
# anywhere is an installer whose refusals can be side-stepped, and the one caller that
# needs different paths (the gate) gets them from a mount namespace instead — it runs
# the REAL script against the REAL `/etc/codex` inside an overlay, so nothing here is
# test-shaped and nothing here is bypassable.
CODEX_ETC="/etc/codex"
HOOKS_FILE="$CODEX_ETC/hooks.json"
HELPER_DIR="$CODEX_ETC/entwurf-birth"
LAUNCHER_NAME="codex-birth-launch.sh"
LAUNCHER="$HELPER_DIR/$LAUNCHER_NAME"
PAYLOAD_NAME="meta-bridge-hook-codex.ts"
STATE_DIR="/var/lib/entwurf/codex-birth"
STATE_ROOT="/var/lib/entwurf"
STATE_FILE="$STATE_DIR/install-state.json"

die() { echo "[codex-birth-install] $*" >&2; exit 1; }
note() { echo "[codex-birth-install] $*"; }

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      sed -n '2,60p' "$SOURCE" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown argument '$arg' — this installer takes no options (its target paths are fixed)." ;;
  esac
done

# ── 0. platform + privilege, before anything is read ─────────────────────────
case "$(uname -s)" in
  Linux) ;;
  *) die "Linux only: /etc/codex is the Linux System-layer config folder, and the managed directory on this platform ($(uname -s)) is a different, unmeasured key." ;;
esac
if [ "$(id -u)" -ne 0 ]; then
  die "requires root (effective uid 0) — it owns /etc/codex/hooks.json and /var/lib/entwurf.
This script will NOT escalate for you. Run it deliberately:
    sudo $SOURCE
Nothing has been read or written."
fi

# ── 1. preflight, all of it before the first write ───────────────────────────
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required (every owned byte is recorded by digest) and is not on PATH."
NODE_BIN="$(command -v node)" || die "node is not on PATH — the hook payload runs under it."
NODE_BIN="$(cd -P -- "$(dirname -- "$NODE_BIN")" && pwd)/$(basename -- "$NODE_BIN")"
[ -x "$NODE_BIN" ] || die "resolved node is not executable: $NODE_BIN"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
# The payload is raw `.ts` run through strip-types, so an under-floor node does not fail
# at install — it fails inside Codex on the operator's first turn, where nothing surfaces
# it (the hook's own failure policy is silence + a log line). Refuse here instead.
[ "$NODE_MAJOR" -ge 24 ] 2>/dev/null || die "node >= 24 is required (package engines; the payload is stripped, not compiled); resolved $NODE_BIN reports major '$NODE_MAJOR'."
# A root-owned launcher that execs a node inside a mutable user-writable tree would be a
# privilege hand-off. The hook runs as the OPERATOR (Codex's own uid), not as root, so
# this is not a root-exec surface — but the path is still baked as an absolute, resolved,
# non-relative value so a PATH change cannot silently repoint it.
case "$NODE_BIN" in
  /*) ;;
  *) die "resolved node path is not absolute: $NODE_BIN" ;;
esac

# The payload closure. `pi-extensions/` ships whole in the npm tarball, so ONE source
# shape serves both a dev clone and an installed package — and because the closure is
# copied to /etc/codex (never under node_modules), strip-types is never refused for it.
PAYLOAD_SRC="$REPO/pi-extensions/$PAYLOAD_NAME"
LIB_SRC="$REPO/pi-extensions/lib/meta-session.ts"
CODEX_CLIENT_SRC="$REPO/pi-extensions/lib/native-push/codex-ws-client.ts"
SESSION_ID_SRC="$REPO/pi-extensions/lib/session-id.js"
REGISTRY_SRC="$REPO/pi/entwurf-capabilities.json"
for f in "$PAYLOAD_SRC" "$LIB_SRC" "$CODEX_CLIENT_SRC" "$SESSION_ID_SRC" "$REGISTRY_SRC"; do
  [ -f "$f" ] || die "closure member missing: $f (reinstall the package, or check out the repo completely)."
done

UNIT_VERSION="$("$NODE_BIN" -p 'require("'"$REPO"'/package.json").version' 2>/dev/null || true)"
case "$UNIT_VERSION" in
  ""|*[![:graph:]]*) die "could not read a single printable version token from $REPO/package.json (got '${UNIT_VERSION:-<empty>}') — it travels into the ownership state." ;;
esac

sha_of() { sha256sum -- "$1" | cut -d' ' -f1; }

# ── 2. ownership preflight: READ-ONLY, and it refuses with ZERO writes ───────
# Every destructive step below is licensed HERE. The rule is the same one the other
# entwurf installers use, tightened because this file is in /etc: we own an artifact
# only if our OWN state vouches for its exact bytes. A foreign artifact, a hand-edited
# one, and one with no state behind it are three different refusals and none of them is
# "overwrite and hope".
ETC_DIR_CREATED=false
HOOKS_PREIMAGE="absent"

if [ -L "$CODEX_ETC" ]; then
  die "$CODEX_ETC is a SYMLINK. Publishing through it would write wherever it points, outside the directory this unit is allowed to own. Refusing; nothing written."
fi
if [ -e "$CODEX_ETC" ] && [ ! -d "$CODEX_ETC" ]; then
  die "$CODEX_ETC exists and is not a directory. Refusing; nothing written."
fi
if [ -d "$CODEX_ETC" ]; then
  ETC_OWNER="$(stat -c '%u' -- "$CODEX_ETC")"
  ETC_MODE="$(stat -c '%a' -- "$CODEX_ETC")"
  case "$ETC_MODE" in *[!0-7]*) die "$CODEX_ETC has an unreadable mode '$ETC_MODE'. Refusing; nothing written." ;; esac
  ETC_MODE_NUM=$((8#$ETC_MODE))
  [ "$ETC_OWNER" = "0" ] || die "$CODEX_ETC is owned by uid $ETC_OWNER, not root. A managed System layer that a non-root user can rewrite is not a managed layer. Refusing; nothing written."
  [ $((ETC_MODE_NUM & 0022)) -eq 0 ] || die "$CODEX_ETC is group/world-writable (mode $ETC_MODE). A managed System layer must not be replaceable by another user. Refusing; nothing written."
  [ $((ETC_MODE_NUM & 0001)) -ne 0 ] || die "$CODEX_ETC is not traversable by the Codex user (mode $ETC_MODE). The System-layer hook would be unreadable. Refusing; nothing written."
else
  ETC_DIR_CREATED=true
fi
for state_parent in "$STATE_ROOT" "$STATE_DIR"; do
  if [ -L "$state_parent" ]; then
    die "$state_parent is a symlink — ownership state may not be published through a link. Refusing; nothing written."
  fi
  if [ -e "$state_parent" ]; then
    [ -d "$state_parent" ] || die "$state_parent exists and is not a directory. Refusing; nothing written."
    STATE_PARENT_OWNER="$(stat -c '%u' -- "$state_parent")"
    STATE_PARENT_MODE="$(stat -c '%a' -- "$state_parent")"
    case "$STATE_PARENT_MODE" in *[!0-7]*) die "$state_parent has an unreadable mode '$STATE_PARENT_MODE'. Refusing; nothing written." ;; esac
    STATE_PARENT_MODE_NUM=$((8#$STATE_PARENT_MODE))
    [ "$STATE_PARENT_OWNER" = "0" ] || die "$state_parent is owned by uid $STATE_PARENT_OWNER, not root. Refusing; nothing written."
    [ $((STATE_PARENT_MODE_NUM & 0022)) -eq 0 ] || die "$state_parent is group/world-writable (mode $STATE_PARENT_MODE). Refusing; nothing written."
    [ $((STATE_PARENT_MODE_NUM & 0001)) -ne 0 ] || die "$state_parent is not world-traversable (mode $STATE_PARENT_MODE), so ordinary setup cannot read the ownership receipt. Refusing; nothing written."
  fi
done

# Is there a state file, and does it certify EVERY live byte that a reinstall would
# replace? An unreadable/malformed state is UNKNOWN ownership, never absent ownership.
STATE_PRESENT=false
STATE_HOOKS_SHA=""
STATE_PREV_HOOKS_SHA=""
STATE_STATUS=""
LIVE_HELPERS_JSON="[]"
if [ -e "$STATE_FILE" ]; then
  [ -L "$STATE_FILE" ] && die "$STATE_FILE is a symlink — the ownership state must be a root-owned regular file. Refusing; nothing written."
  [ -f "$STATE_FILE" ] || die "$STATE_FILE exists and is not a regular file. Refusing; nothing written."
  STATE_OWNER="$(stat -c '%u' -- "$STATE_FILE")"
  STATE_MODE="$(stat -c '%a' -- "$STATE_FILE")"
  case "$STATE_MODE" in *[!0-7]*) die "$STATE_FILE has an unreadable mode '$STATE_MODE'. Refusing; nothing written." ;; esac
  STATE_MODE_NUM=$((8#$STATE_MODE))
  [ "$STATE_OWNER" = "0" ] || die "$STATE_FILE is owned by uid $STATE_OWNER, not root — it is the removal authority for files in /etc and may not be writable by anyone else. Refusing; nothing written."
  [ $((STATE_MODE_NUM & 0022)) -eq 0 ] || die "$STATE_FILE is group/world-writable (mode $STATE_MODE), so it cannot authorize replacement of /etc bytes. Refusing; nothing written."
  [ $((STATE_MODE_NUM & 0004)) -ne 0 ] || die "$STATE_FILE is not world-readable (mode $STATE_MODE), so ordinary setup cannot verify ownership. Refusing; nothing written."
  STATE_OWNCHECK_OUT="$(HELPER_DIR="$HELPER_DIR" HOOKS_FILE="$HOOKS_FILE" "$NODE_BIN" -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const stateFile = process.argv[1];
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (s.schema !== "codex-birth-install-state/v1") throw new Error("unknown schema " + JSON.stringify(s.schema));
    if (s.status !== "installed" && s.status !== "publishing") throw new Error("unknown status " + JSON.stringify(s.status));
    if (s.hooksFile !== process.env.HOOKS_FILE) throw new Error("hooksFile is not the fixed managed path");
    if (s.helperDir !== process.env.HELPER_DIR) throw new Error("helperDir is not the fixed managed path");
    const parseGen = (g, label, previous) => {
      const hooksSha = g?.hooksSha256;
      const hooksOk = typeof hooksSha === "string" && (/^[0-9a-f]{64}$/.test(hooksSha) || (previous && hooksSha === "absent"));
      if (!hooksOk) throw new Error(label + ".hooksSha256 is not a sha256 hex digest" + (previous ? " (nor the literal \"absent\")" : ""));
      // Only the incoming generation must be a complete closure. The PREVIOUS generation
      // may legitimately be empty: it is a snapshot of whatever was live when this run
      // started, and a half-removed host has nothing there to name.
      if (!Array.isArray(g?.helperFiles) || (g.helperFiles.length === 0 && !previous)) throw new Error(label + ".helperFiles is empty");
      const expected = new Map();
      for (const f of g.helperFiles) {
        if (typeof f?.path !== "string" || f.path.length === 0 || f.path.startsWith("/") || f.path.split("/").includes("..")) throw new Error(label + " unsafe helper path " + JSON.stringify(f?.path));
        if (typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error(label + " bad helper digest for " + f.path);
        if (typeof f.mode !== "string" || !/^[0-7]{4}$/.test(f.mode)) throw new Error(label + " bad helper mode for " + f.path);
        if (expected.has(f.path)) throw new Error(label + " duplicate helper path " + f.path);
        expected.set(f.path, f);
      }
      return expected;
    };
    // "next" is the top-level record: the generation this run would adopt/replace. It
    // exists whether status is "installed" or "publishing". "previous" exists ONLY
    // mid-"publishing": a snapshot of the generation this run is replacing, taken BEFORE
    // any byte moved, so a crash before or during the swap still names a live, verifiable
    // authority instead of orphaning the record that was there before this run started.
    const nextFiles = parseGen(s, "state", false);
    let prevFiles = null;
    let prevHooksSha = "";
    if (s.previous !== null && s.previous !== undefined) {
      // A FINISHED install carrying a previous generation is a state that outlived its own
      // publish. Accepting it would let a stale second authority license bytes nobody is
      // replacing, so it is malformed here, not tolerated.
      if (s.status !== "publishing") throw new Error("a finished install still records state.previous — the publish that owned it never cleared it");
      prevFiles = parseGen(s.previous, "state.previous", true);
      prevHooksSha = s.previous.hooksSha256 === "absent" ? "" : s.previous.hooksSha256;
    }
    const root = process.env.HELPER_DIR;
    // The LIVE closure inventory travels back to the shell, which turns it into the
    // `previous` snapshot of the state this run is about to write. It is built from the
    // bytes on disk — not from recorded digests — so the snapshot certifies exactly what
    // a crash could leave behind, and only AFTER the ownership check below proves those
    // live bytes are ours.
    const emit = (live) =>
      process.stdout.write(
        [
          ["STATUS", s.status].join("\t"),
          ["HOOKSSHA", s.hooksSha256].join("\t"),
          ["PREVHOOKSSHA", prevHooksSha].join("\t"),
          // Whether THIS UNIT ever created /etc/codex is ownership HISTORY, not an observation
          // of the current run. A reinstall — the repair the doctor tells operators to run —
          // finds the directory already there, so a state that only recorded "did I create it
          // just now" answered false forever after, and the inverse then refused to reclaim a
          // directory this unit really did make.
          ["ETCCREATED", s.etcDirCreated === true ? "true" : "false"].join("\t"),
          ["LIVEHELPERS", JSON.stringify(live)].join("\t"),
        ].join("\n"),
      );
    if (!fs.existsSync(root)) {
      // Mid-publish the closure directory is legitimately absent for the width of one
      // rename. An INSTALLED state naming a missing directory is drift, and stays a refusal.
      if (s.status === "installed") throw new Error("installed state names a missing helper directory");
      emit([]);
      process.exit(0);
    }
    const actual = [];
    const walk = (dir, rel) => {
      const ds = fs.lstatSync(dir);
      if (!ds.isDirectory() || ds.isSymbolicLink() || ds.uid !== 0 || (ds.mode & 0o022) !== 0 || (ds.mode & 0o001) === 0) throw new Error("unsafe helper directory " + (rel || "."));
      for (const name of fs.readdirSync(dir).sort()) {
        const childRel = rel ? rel + "/" + name : name;
        const child = path.join(dir, name);
        const st = fs.lstatSync(child);
        if (st.isSymbolicLink()) throw new Error("helper member is a symlink: " + childRel);
        if (st.isDirectory()) walk(child, childRel);
        else if (st.isFile()) actual.push({ path: childRel, sha256: crypto.createHash("sha256").update(fs.readFileSync(child)).digest("hex"), mode: (st.mode & 0o7777).toString(8).padStart(4, "0") });
        else throw new Error("helper member is not regular: " + childRel);
      }
    };
    walk(root, "");
    actual.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const actualSorted = actual.map((f) => f.path);
    const matchesFull = (expected) => {
      const wanted = [...expected.keys()].sort();
      if (JSON.stringify(actualSorted) !== JSON.stringify(wanted)) return false;
      return actual.every((f) => {
        const want = expected.get(f.path);
        return want !== undefined && want.mode === f.mode && want.sha256 === f.sha256;
      });
    };
    const matchesNext = matchesFull(nextFiles);
    const matchesPrev = prevFiles !== null && matchesFull(prevFiles);
    // An EMPTY directory certifies nothing and hides nothing: there is no live byte to
    // license, so the republish below simply fills it.
    if (actual.length > 0 && !matchesNext && !matchesPrev) {
      const nextWanted = [...nextFiles.keys()].sort();
      throw new Error("helper inventory drifted: live=" + actualSorted.join(",") + " recorded=" + nextWanted.join(",") + (prevFiles ? " previous=" + [...prevFiles.keys()].sort().join(",") : ""));
    }
    emit(actual);
  ' "$STATE_FILE" 2>&1)" || die "the ownership state or installed closure is unreadable, malformed, or DRIFTED, so replacement authority is UNKNOWN: $STATE_OWNCHECK_OUT
Inspect $STATE_FILE and $HELPER_DIR by hand. Refusing; nothing written."
  STATE_HOOKS_SHA=""
  STATE_PREV_HOOKS_SHA=""
  STATE_STATUS=""
  LIVE_HELPERS_JSON="[]"
  while IFS=$'\t' read -r ock_kind ock_val; do
    case "$ock_kind" in
      STATUS) STATE_STATUS="$ock_val" ;;
      HOOKSSHA) STATE_HOOKS_SHA="$ock_val" ;;
      PREVHOOKSSHA) STATE_PREV_HOOKS_SHA="$ock_val" ;;
      ETCCREATED) [ "$ock_val" = "true" ] && ETC_DIR_CREATED=true ;;
      LIVEHELPERS) LIVE_HELPERS_JSON="$ock_val" ;;
    esac
  done <<< "$STATE_OWNCHECK_OUT"
  STATE_PRESENT=true
fi

LIVE_HOOKS_SHA=""
if [ -L "$HOOKS_FILE" ]; then
  die "$HOOKS_FILE is a SYMLINK. This unit owns that path as a regular file and never publishes through a link (the target could be any file on the host). Refusing; nothing written."
fi
if [ -e "$HOOKS_FILE" ]; then
  [ -f "$HOOKS_FILE" ] || die "$HOOKS_FILE exists and is not a regular file. Refusing; nothing written."
  LIVE_HOOKS_SHA="$(sha_of "$HOOKS_FILE")"
  if [ "$STATE_PRESENT" = false ]; then
    die "$HOOKS_FILE already exists and this host has NO entwurf ownership state ($STATE_FILE).
That file is somebody else's — an operator's own managed hooks, or another tool's. This
unit owns hooks.json as ONE COMPLETE FILE, so adopting it would silently delete hook
declarations it did not write. Refusing; nothing written.
If it IS a leftover of this unit, move it aside deliberately and re-run."
  fi
  # TWO digests can be ours, and only mid-publish. `status: "publishing"` means an earlier
  # run was interrupted somewhere between the two renames of step 6, so the live file is
  # either the generation that run was installing or the one it was replacing — and the
  # closure half may legitimately be the OTHER one of that pair. Refusing a mixture would
  # brick the host in exactly the window the `previous` snapshot exists to survive.
  if [ "$LIVE_HOOKS_SHA" = "$STATE_HOOKS_SHA" ]; then
    note "adopting the hooks.json this unit published (sha256 $LIVE_HOOKS_SHA) — it will be republished."
  elif [ "$STATE_STATUS" = "publishing" ] && [ -n "$STATE_PREV_HOOKS_SHA" ] && [ "$LIVE_HOOKS_SHA" = "$STATE_PREV_HOOKS_SHA" ]; then
    note "adopting the hooks.json of the generation an INTERRUPTED publish was replacing (sha256 $LIVE_HOOKS_SHA) — it will be republished."
  else
    die "$HOOKS_FILE has DRIFTED from the bytes this unit published (live $LIVE_HOOKS_SHA, recorded $STATE_HOOKS_SHA${STATE_PREV_HOOKS_SHA:+, previous generation $STATE_PREV_HOOKS_SHA}).
Somebody edited it. Overwriting would destroy that edit and re-publishing would claim
bytes we cannot prove are ours. Refusing; nothing written.
Inspect it, then either restore the recorded bytes or remove the file deliberately."
  fi
  HOOKS_PREIMAGE="ours:$LIVE_HOOKS_SHA"
elif [ "$STATE_PRESENT" = true ]; then
  note "ownership state exists but $HOOKS_FILE is gone (removed by hand?) — this run republishes it; the state is rewritten."
fi

if [ -L "$HELPER_DIR" ]; then
  die "$HELPER_DIR is a SYMLINK — the payload closure must be a real root-owned directory. Refusing; nothing written."
fi
if [ -e "$HELPER_DIR" ]; then
  [ -d "$HELPER_DIR" ] || die "$HELPER_DIR exists and is not a directory. Refusing; nothing written."
  if [ "$STATE_PRESENT" = false ]; then
    die "$HELPER_DIR already exists and this host has NO entwurf ownership state ($STATE_FILE) — its contents are not ours to replace. Refusing; nothing written.
Move it aside deliberately and re-run."
  fi
fi

# READ-ONLY, informational, and deliberately NOT a refusal: the operator's own managed
# hooks live in config.toml and BOTH sources are merged, so a SessionStart declared
# there fires beside ours. That is the operator's choice and this unit does not arbitrate
# it — but a doubled birth event is worth naming once, at install time.
if [ -f "$CODEX_ETC/config.toml" ] && grep -q '^\[\[\?hooks' "$CODEX_ETC/config.toml" 2>/dev/null; then
  note "NOTE: $CODEX_ETC/config.toml declares its own [hooks] table. Both discovery sources are merged per layer, so your hooks fire beside this unit's. Nothing in config.toml is read, written or removed by this installer or its inverse."
fi

# The `previous` generation of the state this run is about to write: the bytes that are
# LIVE right now, proven ours by the ownership check above. Building it from live bytes
# rather than from recorded digests is the whole point — whatever a crash leaves on disk
# is then certified by one of the two generations the state names, so the NEXT run always
# has removal/replacement authority instead of finding orphaned root-owned files in /etc.
# A clean host has no live bytes and therefore no previous generation: `null`, not a
# fabricated empty one.
PREV_GENERATION="null"
if [ "$STATE_PRESENT" = true ]; then
  PREV_GENERATION="{ \"hooksSha256\": \"${LIVE_HOOKS_SHA:-absent}\", \"helperFiles\": $LIVE_HELPERS_JSON }"
fi

# ── 3. stage the closure beside its final home (same fs ⇒ atomic rename) ─────
# /etc/codex must exist before staging (the staging dir lives INSIDE it, so the rename
# in step 6 is atomic). If this run created it, the failure trap removes it again — a
# refused or crashed install leaves no directory it did not find.
if [ "$ETC_DIR_CREATED" = true ]; then
  mkdir -p -- "$CODEX_ETC"
  chmod 0755 -- "$CODEX_ETC"
fi
STAGE="$HELPER_DIR.staging.$$"
HOOKS_TMP="$CODEX_ETC/.hooks.json.entwurf.$$"
STATE_TMP="$STATE_FILE.$$"
# Set before the trap, because the trap reads it: step 6 moves the outgoing closure here
# for the width of one rename, and that is the ONE window in which the helper directory
# does not exist at its own path.
PREV=""
cleanup() {
  # Restore first, delete second. If we died between the two renames of step 6, the only
  # copy of the outgoing closure is at $PREV and the real path is empty — putting it back
  # is what keeps `/etc` self-consistent for the next run and for any session firing the
  # launcher right now.
  if [ -n "${PREV:-}" ] && [ -d "$PREV" ]; then
    if [ ! -e "$HELPER_DIR" ]; then
      mv -- "$PREV" "$HELPER_DIR" 2>/dev/null || echo "[codex-birth-install] the outgoing closure could not be restored; it is at $PREV" >&2
    else
      rm -rf -- "$PREV"
    fi
  fi
  rm -rf -- "$STAGE" "$HOOKS_TMP" "$STATE_TMP"
  if [ "$ETC_DIR_CREATED" = true ]; then rmdir -- "$CODEX_ETC" 2>/dev/null || true; fi
}
trap cleanup EXIT
# A killed install is the same problem as a failed one, and bash does not run the EXIT
# trap for an untrapped signal.
trap 'cleanup; exit 1' INT TERM HUP
rm -rf -- "$STAGE"
mkdir -p -- "$STAGE/lib/native-push"

install -m 0444 -- "$PAYLOAD_SRC" "$STAGE/$PAYLOAD_NAME"
install -m 0444 -- "$LIB_SRC" "$STAGE/lib/meta-session.ts"
install -m 0444 -- "$CODEX_CLIENT_SRC" "$STAGE/lib/native-push/codex-ws-client.ts"
install -m 0444 -- "$SESSION_ID_SRC" "$STAGE/lib/session-id.js"
# The capability registry must travel at the closure ROOT: metaCapabilitiesFilePath()
# resolves it as `../entwurf-capabilities.json` from lib/ once the repo layout is absent.
# Without it every mint throws and the session becomes a citizen of nothing.
install -m 0444 -- "$REGISTRY_SRC" "$STAGE/entwurf-capabilities.json"

# The launcher is GENERATED, not copied-and-baked: there is no operator-facing skeleton
# to keep in sync and no placeholder that could survive un-substituted into /etc. The
# generated bytes are recorded by digest instead, so the doctor detects a hand edit and
# the inverse refuses to delete one.
#
# Why the indirection exists at all, given codex's `command` is already a shell string:
# `[source]` that string is run through a CONFIGURED shell (`shell.program` + args) and
# only falls back to `$SHELL -lc` when no program is configured — so the interpreter of
# that one line is the turn's business, not ours. A single quoted absolute path is the
# only form that means the same thing under every one of them. Everything else (node
# flags, the payload path, the two liveness checks) lives here, in a file we own.
cat > "$STAGE/$LAUNCHER_NAME" <<LAUNCHER
#!/usr/bin/env bash
# GENERATED by codex-birth-install.sh (entwurf $UNIT_VERSION) — DO NOT EDIT.
# Its exact bytes are recorded in $STATE_FILE; an edit makes the doctor red and makes
# the inverse refuse to remove this file.
#
# exec, not call: the payload keeps THIS pid. Nothing about identity depends on that
# here (the codex join key is the threadId on stdin, and \`[host]\` the parent pid is
# SHARED by every hook and MCP child of every window on this host — see the payload
# header), but a wrapper process left in the chain would be one more thing to explain
# on every future measurement.
set -uo pipefail

NODE_BIN="$NODE_BIN"
PAYLOAD="$HELPER_DIR/$PAYLOAD_NAME"

if [ ! -x "\$NODE_BIN" ]; then
  echo "entwurf codex-birth: the recorded node is missing or not executable: \$NODE_BIN" >&2
  echo "entwurf codex-birth: re-run 'sudo ./run.sh install-codex-birth' after a node change." >&2
  exit 1
fi
if [ ! -f "\$PAYLOAD" ]; then
  echo "entwurf codex-birth: hook payload missing: \$PAYLOAD (half-removed install?)" >&2
  exit 1
fi

# --experimental-strip-types + the warning suppression: the payload is raw TypeScript on
# purpose (one closure, no build step in /etc), and an ExperimentalWarning on stderr
# would land in the operator's Codex hook output for every session.
exec "\$NODE_BIN" --experimental-strip-types --disable-warning=ExperimentalWarning "\$PAYLOAD"
LAUNCHER
chmod 0555 -- "$STAGE/$LAUNCHER_NAME"
chmod 0555 -- "$STAGE/lib/native-push" "$STAGE/lib"
chmod 0555 -- "$STAGE"

# ── 4. the hooks.json bytes, in the vendor's exact JSON grammar ──────────────
# `[source]` `HooksFile { description?, hooks: HookEventsToml }` (`config/src/hook_config.rs:12-17`)
# is the hooks.json shape; the events map is keyed by the PascalCase event name
# (`:36-61`), each value a list of `MatcherGroup { matcher?, hooks: [...] }` (`:153-159`),
# each handler a `#[serde(tag="type")]` variant — `command { command, commandWindows?,
# timeout?, async, statusMessage?, additionalContextLimit? }` (`:161-200`).
#
# THREE deliberate omissions:
#   `matcher`   omitted, so this fires for all four SessionStart sources
#               (startup|resume|clear|compact). An EMPTY string is not the same thing and
#               is not written.
#   `async`     omitted: serde-defaulted (the measured TOML declaration carried only
#               type/command/timeout and loaded), and birth must be SYNCHRONOUS — the
#               record has to exist before the turn proceeds, because the MCP child of
#               that same turn resolves its own identity from the record store.
#   `state`     not a hooks.json key at all (`[hooks.state]` belongs to the in-config
#               shape, `HooksToml`), and `[source]` `hook_trusted_hash` reads state ONLY
#               when `!is_managed` — a managed hook needs no trust hash by construction.
#
# The command is ONE single-quoted absolute path: a shell string with no argv variant
# anywhere in codex's enum, so quoting is the only protection there is, and there is
# nothing else on the line to quote.
cat > "$HOOKS_TMP" <<HOOKSJSON
{
  "description": "entwurf codex-birth $UNIT_VERSION — mints one garden meta-record per top-level Codex thread on its first turn. Managed by scripts/codex-birth-install.sh; inverse: scripts/codex-birth-uninstall.sh. Do not edit: the exact bytes are recorded in $STATE_FILE.",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "'$LAUNCHER'",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
HOOKSJSON
chmod 0444 -- "$HOOKS_TMP"
# Prove the bytes are the grammar we think they are BEFORE they reach /etc: a broken
# hooks.json in a managed layer is a hook nobody declared and nobody can see failing.
"$NODE_BIN" -e '
  const fs = require("node:fs");
  const f = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const groups = f.hooks?.SessionStart;
  if (Object.keys(f).sort().join(",") !== "description,hooks") throw new Error("hooks.json top level must be exactly description+hooks");
  if (!Array.isArray(groups) || groups.length !== 1) throw new Error("hooks.SessionStart must be a single matcher group");
  if ("matcher" in groups[0]) throw new Error("the matcher group must carry no matcher key");
  if (Object.keys(groups[0]).join(",") !== "hooks") throw new Error("the matcher group must carry no key other than hooks");
  const hs = groups[0].hooks;
  if (!Array.isArray(hs) || hs.length !== 1) throw new Error("the matcher group must hold exactly one handler");
  // EXACT key set, not merely the three values: `async: true` would let the turn proceed
  // before the record exists, and the fresh-call preflight refuses any extra key on this
  // handler — so bytes this installer publishes must be bytes that preflight accepts.
  if (Object.keys(hs[0]).sort().join(",") !== "command,timeout,type") throw new Error("the handler must carry exactly type+command+timeout, got " + Object.keys(hs[0]).sort().join(","));
  if (hs[0].type !== "command") throw new Error("the handler must be a command handler");
  if (hs[0].command !== "'"'"'" + process.argv[2] + "'"'"'") throw new Error("the command is not the quoted launcher path");
  if (hs[0].timeout !== 30) throw new Error("the handler must carry timeout 30");
  if (Object.keys(f.hooks).length !== 1) throw new Error("hooks.json declares an event other than SessionStart");
' "$HOOKS_TMP" "$LAUNCHER" || die "the generated hooks.json failed its own grammar check — nothing was published."

HOOKS_SHA="$(sha_of "$HOOKS_TMP")"
LAUNCHER_SHA="$(sha_of "$STAGE/$LAUNCHER_NAME")"
PAYLOAD_SHA="$(sha_of "$STAGE/$PAYLOAD_NAME")"
LIB_SHA="$(sha_of "$STAGE/lib/meta-session.ts")"
CODEX_CLIENT_SHA="$(sha_of "$STAGE/lib/native-push/codex-ws-client.ts")"
SESSION_ID_SHA="$(sha_of "$STAGE/lib/session-id.js")"
REGISTRY_SHA="$(sha_of "$STAGE/entwurf-capabilities.json")"

# ── 5. state BEFORE publish, so no /etc byte is ever unowned ─────────────────
# The Copilot installer writes its state before the first vendor mutation for the same
# reason, and here the stakes are higher: a crash between publishing /etc and writing
# the state would leave root-owned files with NO removal authority behind them. So the
# state lands first with `status: "publishing"`, carrying the digests of the staged bytes
# (a rename preserves them), and is rewritten to `"installed"` after the swap. The
# inverse honours both statuses and treats an already-absent file as done, not as drift.
write_state() { # $1 = status, $2 = the `previous` generation JSON (`null` when there is none)
  if [ ! -d "$STATE_ROOT" ]; then install -d -m 0755 -- "$STATE_ROOT"; fi
  if [ ! -d "$STATE_DIR" ]; then install -d -m 0755 -- "$STATE_DIR"; fi
  cat > "$STATE_TMP" <<STATE
{
  "schema": "codex-birth-install-state/v1",
  "status": "$1",
  "unitVersion": "$UNIT_VERSION",
  "writtenAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "nodeBin": "$NODE_BIN",
  "etcDirCreated": $ETC_DIR_CREATED,
  "hooksFile": "$HOOKS_FILE",
  "hooksSha256": "$HOOKS_SHA",
  "hooksPreimage": "$HOOKS_PREIMAGE",
  "previous": $2,
  "helperDir": "$HELPER_DIR",
  "helperFiles": [
    { "path": "$LAUNCHER_NAME", "sha256": "$LAUNCHER_SHA", "mode": "0555" },
    { "path": "$PAYLOAD_NAME", "sha256": "$PAYLOAD_SHA", "mode": "0444" },
    { "path": "lib/meta-session.ts", "sha256": "$LIB_SHA", "mode": "0444" },
    { "path": "lib/native-push/codex-ws-client.ts", "sha256": "$CODEX_CLIENT_SHA", "mode": "0444" },
    { "path": "lib/session-id.js", "sha256": "$SESSION_ID_SHA", "mode": "0444" },
    { "path": "entwurf-capabilities.json", "sha256": "$REGISTRY_SHA", "mode": "0444" }
  ]
}
STATE
  chmod 0444 -- "$STATE_TMP"
  mv -f -- "$STATE_TMP" "$STATE_FILE"
}
write_state publishing "$PREV_GENERATION"

# ── 6. publish, closure first ────────────────────────────────────────────────
# ORDER IS LOAD-BEARING: hooks.json names the launcher, so the launcher must exist before
# any session can read the declaration. The reverse order leaves a window in which every
# new Codex session runs a hook command that is not there.
mkdir -p -- "$CODEX_ETC"
if [ -d "$HELPER_DIR" ]; then
  PREV="$HELPER_DIR.prev.$$"
  # The old closure is moved aside rather than deleted, so a failed rename below can be
  # undone instead of leaving no closure at all.
  # Moving a state-certified directory needs write permission only on its parent.
  mv -- "$HELPER_DIR" "$PREV" || die "could not move the previous closure aside ($HELPER_DIR -> $PREV); nothing was published."
fi
if ! mv -- "$STAGE" "$HELPER_DIR"; then
  # The trap restores $PREV on the way out; doing it here too would race with it.
  die "could not publish the closure to $HELPER_DIR — the previous one is restored on exit."
fi
if [ -n "$PREV" ]; then
  rm -rf -- "$PREV"
  PREV=""
fi
mv -f -- "$HOOKS_TMP" "$HOOKS_FILE" || die "the closure is published but $HOOKS_FILE could not be written. The state is retained: re-run to repair, or run the inverse.
Both generations are still named in $STATE_FILE, so the live hooks.json keeps its removal authority."
# The publish is complete, so the outgoing generation stops being an authority: a state
# that kept naming it would license replacing bytes nobody is replacing.
write_state installed null
trap - EXIT INT TERM HUP

# ── 7. evidence ──────────────────────────────────────────────────────────────
note "published $HOOKS_FILE (sha256 $HOOKS_SHA)"
note "published $HELPER_DIR/ (launcher $LAUNCHER_SHA, payload $PAYLOAD_SHA)"
note "ownership state: $STATE_FILE (root-owned, world-readable, immutable to non-root users)"
echo "--- $HOOKS_FILE ---"
cat -- "$HOOKS_FILE"
echo
note "DONE. A Codex thread becomes a citizen on its FIRST TURN, not when the window opens"
note "(measured: a TUI idled ~47s with the hook log empty, then SessionStart fired 1.6s after the first prompt)."
note "Already-open sessions loaded the old declaration; restart them."
note "Verify with: ./run.sh doctor-codex-birth · inverse: sudo ./run.sh uninstall-codex-birth"
