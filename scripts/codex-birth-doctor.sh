#!/usr/bin/env bash
# codex-birth-doctor.sh — the fail-loud surface for the Codex BIRTH unit (#95).
#
# FOUR AXES, REPORTED SEPARATELY, BECAUSE THEY FAIL FOR FOUR DIFFERENT REASONS AND
# EACH HAS A DIFFERENT REPAIR:
#
#   RUNTIME    is there a codex CLI and a node this unit can run under?
#   CONFIG     is the managed declaration + its closure actually in /etc, in the exact
#              grammar the vendor parses?
#   OWNERSHIP  do those bytes still match what the installer recorded — i.e. is the
#              inverse still able to remove them? (root-owned state is readable, never writable)
#   BIRTH      has a real Codex thread ever become a citizen on this host?
#
# THE BIRTH AXIS IS NEVER A PASS PROOF, AND ZERO RECORDS IS NOT RED EITHER.
# `[host]` A Codex thread fires SessionStart on its FIRST TURN, not when the window
# opens (measured: ~47s of an idle open TUI with an empty hook log, then the event 1.6s
# after the first prompt). So a correctly installed unit on a host whose operator has
# not spoken to Codex yet has zero records — that is NOT-YET, a real and expected
# state. The converse is the part people get wrong: green CONFIG + green OWNERSHIP is
# not evidence that the hook FIRES. Only a record is, and only a real turn makes one.
# This doctor therefore never prints PASS for a birth it has not seen.
#
# WHY THE STATE IS READABLE. It is removal authority but contains no secret: root ownership and
# non-writable mode protect it, while world-readability lets ordinary `entwurf setup` verify the
# prerequisite without sudo. The meta-record store still belongs to the operator, not root.
#   ./run.sh doctor-codex-birth          verifies runtime, config, ownership, and the operator's
#                                        own birth evidence without privilege.
#   sudo ./run.sh doctor-codex-birth     is useful only for root-side repair; birth remains
#                                        UNKNOWN because root's record store is not the operator's.
#
# EXIT CODES:  0 = every evaluated axis green  ·  1 = at least one RED
#              2 = no RED, but an axis is UNKNOWN (run the other invocation)
set -uo pipefail

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

CODEX_ETC="/etc/codex"
HOOKS_FILE="$CODEX_ETC/hooks.json"
HELPER_DIR="$CODEX_ETC/entwurf-birth"
LAUNCHER="$HELPER_DIR/codex-birth-launch.sh"
PAYLOAD="$HELPER_DIR/meta-bridge-hook-codex.ts"
STATE_FILE="/var/lib/entwurf/codex-birth/install-state.json"

RED=0
UNKNOWN=0
ok()      { echo "  ok       $*"; }
bad()     { echo "  RED      $*" >&2; RED=$((RED + 1)); }
unknown() { echo "  UNKNOWN  $*" >&2; UNKNOWN=$((UNKNOWN + 1)); }
info()    { echo "  ·        $*"; }
axis()    { echo; echo "── $* ─────────────────────────────────────────"; }

# The directory predicates the INSTALLER refuses on (`codex-birth-install.sh` §2). A managed
# System layer another user can rewrite is not managed, and a state root another user can
# rewrite is not removal authority — so a doctor that compared only DIGESTS would report green
# on a host the installer itself would refuse to publish to, which is the ownership truth and
# runtime truth disagreeing in the one place an operator looks.
# Returns 0 when the directory is safe, 1 (having already named the defect) when it is not.
safe_root_dir() { # $1 = path, $2 = the role it plays, $3 = repair line
  local dir="$1" role="$2" repair="$3" owner mode num
  if [ -L "$dir" ]; then
    bad "$dir is a SYMLINK — $role may not be reached through a link. $repair"
    return 1
  fi
  if [ ! -d "$dir" ]; then
    bad "$dir is missing or not a directory, but $role lives there. $repair"
    return 1
  fi
  owner="$(stat -c '%u' -- "$dir" 2>/dev/null || echo '?')"
  mode="$(stat -c '%a' -- "$dir" 2>/dev/null || echo '?')"
  case "$mode" in *[!0-7]*) bad "$dir has an unreadable mode '$mode' ($role). $repair"; return 1 ;; esac
  num=$((8#$mode))
  if [ "$owner" != "0" ]; then
    bad "$dir is owned by uid $owner, not root ($role) — anyone who can write it can replace what is inside. $repair"
    return 1
  fi
  if [ $((num & 0022)) -ne 0 ]; then
    bad "$dir is group/world-writable (mode $mode, $role) — the installer refuses to publish into it. $repair"
    return 1
  fi
  if [ $((num & 0001)) -eq 0 ]; then
    bad "$dir is not traversable (mode $mode, $role), so what is inside cannot be read by the process that needs it. $repair"
    return 1
  fi
  ok "$dir is root-owned, non-writable and traversable ($role)"
  return 0
}

case "$(uname -s)" in
  Linux) ;;
  *) echo "[codex-birth-doctor] Linux only: /etc/codex is the Linux System-layer config folder (this host is $(uname -s))." >&2; exit 1 ;;
esac

# ── RUNTIME ──────────────────────────────────────────────────────────────────
axis "RUNTIME"
NODE_BIN="$(command -v node || true)"
if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then
  NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$NODE_MAJOR" -ge 24 ] 2>/dev/null; then
    ok "node $("$NODE_BIN" -p 'process.versions.node') at $NODE_BIN (>= 24, so strip-types runs the payload)"
  else
    bad "node at $NODE_BIN reports major '$NODE_MAJOR'; the payload is raw TypeScript and needs >= 24. Repair: install node 24+, then sudo ./run.sh install-codex-birth (the launcher records an absolute node path)."
  fi
else
  bad "no node on PATH — the hook payload cannot run. Repair: install node 24+, then sudo ./run.sh install-codex-birth."
fi
if command -v codex >/dev/null 2>&1; then
  info "codex CLI: $(command -v codex) $(codex --version 2>/dev/null | head -n1)"
  info "measured coordinate for this unit was codex 0.153.4; a version gap is not by itself red."
else
  info "no codex CLI on PATH. The managed declaration is still valid — /etc/codex is read by whatever codex this host later gets — but nothing can fire until one is installed."
fi

# ── CONFIG ───────────────────────────────────────────────────────────────────
axis "CONFIG (the managed System-layer declaration and its closure)"
CONFIG_GREEN=1
safe_root_dir "$CODEX_ETC" "the managed System-layer config folder" "Repair: fix its ownership/mode, then sudo ./run.sh install-codex-birth." || CONFIG_GREEN=0
for closure_dir in "$HELPER_DIR" "$HELPER_DIR/lib" "$HELPER_DIR/lib/native-push"; do
  [ -e "$closure_dir" ] || continue
  safe_root_dir "$closure_dir" "a published closure directory" "Repair: sudo ./run.sh install-codex-birth." || CONFIG_GREEN=0
done
if [ -L "$HOOKS_FILE" ]; then
  bad "$HOOKS_FILE is a SYMLINK — this unit only ever publishes a regular file, so something else made it. Repair: inspect it, remove it deliberately, then sudo ./run.sh install-codex-birth."
  CONFIG_GREEN=0
elif [ ! -f "$HOOKS_FILE" ]; then
  bad "$HOOKS_FILE is missing — no Codex thread can be born on this host. Repair: sudo ./run.sh install-codex-birth."
  CONFIG_GREEN=0
else
  if [ -n "$NODE_BIN" ] && GRAMMAR_ERR="$("$NODE_BIN" -e '
      const fs = require("node:fs");
      const f = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const groups = f.hooks?.SessionStart;
      if (Object.keys(f.hooks ?? {}).length !== 1) throw new Error("hooks declares an event other than SessionStart: " + Object.keys(f.hooks ?? {}).join(","));
      if (!Array.isArray(groups) || groups.length !== 1) throw new Error("hooks.SessionStart is not a single matcher group");
      if ("matcher" in groups[0]) throw new Error("the matcher group carries a matcher key (this unit writes none, so it fires for all four sources)");
      const hs = groups[0].hooks;
      if (!Array.isArray(hs) || hs.length !== 1) throw new Error("the matcher group does not hold exactly one handler");
      if (hs[0].type !== "command") throw new Error("the handler type is " + JSON.stringify(hs[0].type) + ", not \"command\"");
      if (hs[0].command !== "'"'"'" + process.argv[2] + "'"'"'") throw new Error("the command is " + JSON.stringify(hs[0].command) + ", not the single-quoted launcher path");
      if (hs[0].timeout !== 30) throw new Error("the handler timeout is " + JSON.stringify(hs[0].timeout) + ", not 30");
    ' "$HOOKS_FILE" "$LAUNCHER" 2>&1)"; then
    ok "hooks.json declares exactly one SessionStart command handler pointing at the quoted launcher, timeout 30"
  elif [ -z "$NODE_BIN" ]; then
    unknown "cannot check the hooks.json grammar without node"
    CONFIG_GREEN=0
  else
    bad "hooks.json is not the grammar this unit publishes: $GRAMMAR_ERR"
    bad "Repair: inspect $HOOKS_FILE; if the edit was yours, keep it and stop using this unit — otherwise sudo ./run.sh uninstall-codex-birth && sudo ./run.sh install-codex-birth."
    CONFIG_GREEN=0
  fi
fi
if [ -x "$LAUNCHER" ] && [ ! -L "$LAUNCHER" ]; then
  ok "launcher present and executable: $LAUNCHER"
  BAKED_NODE="$(sed -n 's/^NODE_BIN="\(.*\)"$/\1/p' "$LAUNCHER" | head -n1)"
  if [ -n "$BAKED_NODE" ] && [ -x "$BAKED_NODE" ]; then
    ok "the launcher's recorded node is an existing executable: $BAKED_NODE"
  else
    bad "the launcher's recorded node is missing or not executable ('${BAKED_NODE:-<unparsed>}') — every session's hook exits 1 before the payload starts. Repair: sudo ./run.sh install-codex-birth."
    CONFIG_GREEN=0
  fi
else
  bad "launcher missing, not executable, or a symlink: $LAUNCHER. Repair: sudo ./run.sh install-codex-birth."
  CONFIG_GREEN=0
fi
for member in "$PAYLOAD" "$HELPER_DIR/lib/meta-session.ts" "$HELPER_DIR/lib/native-push/codex-ws-client.ts" "$HELPER_DIR/lib/session-id.js" "$HELPER_DIR/entwurf-capabilities.json"; do
  if [ -f "$member" ]; then
    ok "closure member present: ${member#"$HELPER_DIR"/}"
  else
    bad "closure member MISSING: $member — the payload would throw at import (or at its first mint, for the capability registry). Repair: sudo ./run.sh install-codex-birth."
    CONFIG_GREEN=0
  fi
done
if [ -f "$CODEX_ETC/config.toml" ]; then
  if grep -q '^\[\[\?hooks' "$CODEX_ETC/config.toml" 2>/dev/null; then
    info "$CODEX_ETC/config.toml declares its own [hooks] table. Both discovery sources merge per layer, so those hooks fire BESIDE this unit's. Not a defect and not ours: this unit never reads or writes config.toml."
  else
    info "$CODEX_ETC/config.toml exists (untouched by this unit)."
  fi
fi

# ── OWNERSHIP ────────────────────────────────────────────────────────────────
axis "OWNERSHIP (can the inverse still remove exactly what was installed?)"
if [ -L "$STATE_FILE" ]; then
  bad "$STATE_FILE is a SYMLINK — removal authority may not come through a link, and the installer refuses one. Repair: inspect it, remove it deliberately, then sudo ./run.sh install-codex-birth."
elif [ ! -f "$STATE_FILE" ]; then
  if [ "$CONFIG_GREEN" -eq 1 ]; then
    bad "the declaration is installed but there is NO ownership state at $STATE_FILE — nothing can prove those /etc bytes are ours, so the inverse will refuse them. Repair: sudo ./run.sh install-codex-birth (it republishes and rewrites the state), which refuses if the live hooks.json is foreign."
  else
    info "no ownership state at $STATE_FILE and nothing installed — this host has no Codex birth unit. Install: sudo ./run.sh install-codex-birth"
  fi
elif [ -z "$NODE_BIN" ]; then
  unknown "cannot parse the ownership state without node"
else
  # The state IS the removal authority, so its own bytes have to be as protected as the
  # /etc bytes it licenses: a state file another user can rewrite is a state file another
  # user can point at any path in /etc. The installer refuses those shapes; a doctor that
  # called them green would be the only surface saying so.
  STATE_UID="$(stat -c '%u' -- "$STATE_FILE" 2>/dev/null || echo "?")"
  STATE_MODE="$(stat -c '%a' -- "$STATE_FILE" 2>/dev/null || echo "?")"
  if [ "$STATE_UID" != "0" ]; then
    bad "$STATE_FILE is owned by uid $STATE_UID, not root — anyone who can rewrite it can license removal of any /etc path. Repair: sudo ./run.sh uninstall-codex-birth (or remove it deliberately), then sudo ./run.sh install-codex-birth."
  elif [ $(( 8#${STATE_MODE:-777} & 0022 )) -ne 0 ] 2>/dev/null; then
    bad "$STATE_FILE is group/world-writable (mode $STATE_MODE) — the same authority problem as non-root ownership. Repair: sudo ./run.sh install-codex-birth (it republishes the state 0444)."
  else
    ok "the ownership state is root-owned and non-writable (uid 0, mode $STATE_MODE)"
  fi
  if [ $(( 8#${STATE_MODE:-777} & 0004 )) -eq 0 ] 2>/dev/null; then
    bad "$STATE_FILE is not world-readable (mode $STATE_MODE), so an ordinary 'entwurf setup' cannot verify the prerequisite without sudo. Repair: sudo ./run.sh install-codex-birth."
  fi
  safe_root_dir "$(dirname -- "$STATE_FILE")" "the ownership-state directory" "Repair: sudo ./run.sh install-codex-birth (it publishes these 0755 root-owned)." || true
  safe_root_dir "$(dirname -- "$(dirname -- "$STATE_FILE")")" "the entwurf state root" "Repair: sudo ./run.sh install-codex-birth." || true
  OWN_OUT="$(DOCTOR_HOOKS_FILE="$HOOKS_FILE" DOCTOR_HELPER_DIR="$HELPER_DIR" "$NODE_BIN" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const crypto = require("node:crypto");
    const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (s.schema !== "codex-birth-install-state/v1") throw new Error("unknown state schema " + JSON.stringify(s.schema));
    const out = [];
    // THE BINDING. This unit owns two FIXED paths and nothing else; the installer refuses a
    // state that names anything different. A doctor that read the paths OUT of the state would
    // happily certify a copy of the closure somewhere else and report green while the real
    // /etc/codex bytes had no authority behind them at all.
    if (s.hooksFile !== process.env.DOCTOR_HOOKS_FILE) out.push("BAD\tthe ownership state names hooksFile " + JSON.stringify(s.hooksFile) + ", not the fixed path this unit owns (" + process.env.DOCTOR_HOOKS_FILE + ") — that state is authority for somewhere else, so the installed bytes have none. Repair: inspect the state by hand; the inverse refuses it too.");
    if (s.helperDir !== process.env.DOCTOR_HELPER_DIR) out.push("BAD\tthe ownership state names helperDir " + JSON.stringify(s.helperDir) + ", not the fixed path this unit owns (" + process.env.DOCTOR_HELPER_DIR + ") — same defect, one path over.");
    if (s.status !== "installed" && s.status !== "publishing") out.push("BAD\tthe ownership state carries an unknown status " + JSON.stringify(s.status) + "; the installer and the inverse both refuse it.");
    out.push("INFO\tstate: status=" + s.status + " unitVersion=" + s.unitVersion + " writtenAt=" + s.writtenAt + " hooksPreimage=" + s.hooksPreimage + " etcDirCreated=" + s.etcDirCreated);
    if (s.status !== "installed") out.push("BAD\tthe state status is " + JSON.stringify(s.status) + ", so a previous install did not finish publishing. Repair: sudo ./run.sh install-codex-birth");
    // Mid-publish a SECOND generation is legitimately owned — the one an interrupted run was
    // replacing. On a finished install it is a stale authority the publish never cleared, and
    // the installer treats it as malformed, so this axis may not call it green either.
    let previous = null;
    if (s.previous !== null && s.previous !== undefined) {
      if (s.status !== "publishing") out.push("BAD\tthe state is `installed` but still records state.previous — a finished publish must clear the generation it replaced. The installer refuses this state. Repair: sudo ./run.sh install-codex-birth");
      else {
        previous = s.previous;
        out.push("INFO\tan interrupted publish is recorded: bytes of EITHER generation are owned until the next install finishes");
      }
    }
    // path -> accepted {digest, mode} pairs, unioned across the owned generations.
    const owned = new Map();
    const collect = (files) => {
      for (const f of files ?? []) {
        const list = owned.get(f.path) ?? [];
        list.push(f);
        owned.set(f.path, list);
      }
    };
    collect(s.helperFiles);
    if (previous !== null) collect(previous.helperFiles);
    const hooksDigests = [s.hooksSha256];
    if (previous !== null && previous.hooksSha256 !== "absent") hooksDigests.push(previous.hooksSha256);
    // A digest alone is not ownership. A payload the operator (or anyone else) can rewrite is
    // a root-managed layer in name only, and the fresh-call preflight already refuses exactly
    // these shapes — a doctor that reported green on them would be the surface disagreeing
    // with the product.
    const unsafe = (label, file, st) => {
      if (st.isSymbolicLink()) return label + " is a SYMLINK now: " + file;
      if (!st.isFile()) return label + " is not a regular file: " + file;
      if (st.uid !== 0) return label + " is owned by uid " + st.uid + ", not root: " + file;
      if ((st.mode & 0o022) !== 0) return label + " is group/world-writable (mode " + (st.mode & 0o7777).toString(8).padStart(4, "0") + "): " + file;
      return null;
    };
    const check = (label, file, wantDigests, wantModes) => {
      let st;
      try {
        st = fs.lstatSync(file);
      } catch {
        return out.push("BAD\t" + label + " is recorded as owned but is MISSING: " + file);
      }
      const bad = unsafe(label, file, st);
      if (bad !== null) return out.push("BAD\t" + bad + " — the managed layer is only as protected as its weakest byte. Repair: sudo ./run.sh install-codex-birth");
      let live;
      try {
        live = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      } catch (e) {
        return out.push("BAD\t" + label + " could not be read: " + (e && e.message ? e.message : String(e)));
      }
      if (!wantDigests.includes(live)) return out.push("BAD\t" + label + " DRIFTED from the recorded bytes (" + file + "): live " + live.slice(0, 12) + "…, recorded " + wantDigests.map((d) => d.slice(0, 12) + "…").join(" or ") + ". The inverse will refuse to remove it.");
      const liveMode = (st.mode & 0o7777).toString(8).padStart(4, "0");
      if (wantModes !== null && !wantModes.includes(liveMode)) return out.push("BAD\t" + label + " has mode " + liveMode + ", not the recorded " + wantModes.join(" or ") + " (" + file + ")");
      out.push("OK\t" + label + " matches its recorded digest");
    };
    check("hooks.json", s.hooksFile, hooksDigests, null);
    for (const [rel, entries] of owned) {
      check("closure " + rel, path.join(s.helperDir, rel), entries.map((f) => f.sha256), entries.map((f) => f.mode));
    }
    // INVENTORY. Every digest above can match while the directory holds a file no generation
    // records — the inverse then refuses to rmdir it and the unit can never be removed, which
    // is the same dead end as a missing state. The installer refuses to republish over it, so
    // this is the axis that has to name it.
    const walk = (dir, rel) => {
      let st;
      try {
        st = fs.lstatSync(dir);
      } catch {
        return out.push("BAD\tthe closure directory is recorded as owned but is MISSING: " + dir);
      }
      if (st.isSymbolicLink() || !st.isDirectory()) return out.push("BAD\tthe closure path is not a real directory: " + dir);
      if (st.uid !== 0 || (st.mode & 0o022) !== 0 || (st.mode & 0o001) === 0) return out.push("BAD\tthe closure directory " + (rel || ".") + " is not root-owned/non-writable/traversable (uid " + st.uid + ", mode " + (st.mode & 0o7777).toString(8).padStart(4, "0") + "): " + dir);
      for (const name of fs.readdirSync(dir).sort()) {
        const childRel = rel ? rel + "/" + name : name;
        const child = path.join(dir, name);
        const cst = fs.lstatSync(child);
        if (cst.isDirectory() && !cst.isSymbolicLink()) walk(child, childRel);
        else if (!owned.has(childRel)) out.push("BAD\tthe closure holds a file no generation records: " + child + " — the inverse will refuse to reclaim the directory. Repair: inspect it, move it out deliberately, then sudo ./run.sh install-codex-birth");
      }
    };
    walk(s.helperDir, "");
    // The OK line may only speak for what was actually verified, and only when NOTHING above
    // it disagreed: a member reported group/world-writable is not "root-owned throughout", and
    // printing both lines makes the operator pick which one to believe.
    if (out.filter((l) => l.startsWith("BAD\t")).length === 0)
      out.push("OK\tthe closure holds exactly the recorded members, and every member and directory under it is root-owned and non-writable");
    process.stdout.write(out.join("\n"));
  ' "$STATE_FILE" 2>&1)" || { bad "the ownership state is unreadable or malformed, so ownership is UNKNOWN: $OWN_OUT"; OWN_OUT=""; }
  while IFS=$'\t' read -r kind message; do
    [ -n "${kind:-}" ] || continue
    case "$kind" in
      OK) ok "$message" ;;
      BAD) bad "$message" ;;
      *) info "$message" ;;
    esac
  done <<< "$OWN_OUT"
fi

# ── BIRTH ────────────────────────────────────────────────────────────────────
axis "BIRTH (has a real Codex thread ever become a citizen here?)"
if [ -n "${SUDO_USER:-}" ]; then
  unknown "running under sudo: the meta-record store belongs to $SUDO_USER, not to root, and reading root's store would report somebody else's emptiness. Run: ./run.sh doctor-codex-birth (no sudo)"
elif [ -z "$NODE_BIN" ]; then
  unknown "cannot read the record store without node"
else
  case "$REPO" in
    */node_modules/@junghanacs/entwurf)
      META_LIB="$REPO/mcp/entwurf-bridge/dist/pi-extensions/lib/meta-session.js"
      NODE_FLAGS=() ;;
    *)
      META_LIB="$REPO/pi-extensions/lib/meta-session.ts"
      NODE_FLAGS=(--experimental-strip-types --disable-warning=ExperimentalWarning) ;;
  esac
  if [ ! -f "$META_LIB" ]; then
    unknown "the record reader is missing ($META_LIB) — run 'pnpm run build-bridge' in a dev clone, or reinstall the package"
  else
    # `${arr[@]+...}` because bash 3.2 (macOS) errors on an empty array under `set -u`,
    # and this doctor is read by the same eyes as the portable ones.
    BIRTH_OUT="$(META_LIB="$META_LIB" "$NODE_BIN" ${NODE_FLAGS[@]+"${NODE_FLAGS[@]}"} --input-type=module <<'JS' 2>&1
import * as path from "node:path";
import { pathToFileURL } from "node:url";
const m = await import(pathToFileURL(process.env.META_LIB).href);
const dir = m.defaultMetaSessionsDir();
let identities = [];
let err = "";
try {
  identities = m.listAllMetaIdentitiesDir(dir).identities;
} catch (e) {
  err = e instanceof Error ? e.message : String(e);
}
const codex = identities.filter((i) => i.backend === "codex");
const lines = [];
lines.push(`INFO\trecord store: ${dir}`);
// The hook log lives beside the store, exactly where the payload's logLine() puts it.
// Emitted from here so the shell never has to re-derive a path the library owns.
lines.push(`LOG\t${path.join(path.dirname(dir), "meta-bridge-hook.log")}`);
if (err) lines.push(`UNKNOWN\tthe record store could not be read: ${err}`);
lines.push(`COUNT\t${codex.length}\t${identities.length}`);
for (const c of codex.sort((a, b) => a.recordUpdatedAt.localeCompare(b.recordUpdatedAt)).slice(-3)) {
  lines.push(`INFO\t${c.gardenId}  thread=${c.nativeSessionId}  model=${c.model ?? "null"}  updated=${c.recordUpdatedAt}`);
}
process.stdout.write(lines.join("\n"));
JS
)"
    CODEX_RECORDS=""
    HOOK_LOG=""
    while IFS=$'\t' read -r kind a b; do
      case "${kind:-}" in
        COUNT) CODEX_RECORDS="$a"; TOTAL_RECORDS="$b" ;;
        LOG) HOOK_LOG="$a" ;;
        UNKNOWN) unknown "$a" ;;
        INFO) info "$a" ;;
      esac
    done <<< "$BIRTH_OUT"
    if [ -z "$CODEX_RECORDS" ]; then
      unknown "the record axis produced no count: $BIRTH_OUT"
    elif [ "$CODEX_RECORDS" -eq 0 ]; then
      # NOT-YET, deliberately neither ok nor bad: it is the correct state of a freshly
      # installed host, and it is also NOT evidence that the hook works.
      echo "  NOT-YET  0 codex citizens (of ${TOTAL_RECORDS:-?} records). Expected on a host whose"
      echo "           operator has not spoken to Codex since the install: birth fires on the FIRST"
      echo "           TURN, not at window open. This is not a pass and not a failure — open a Codex"
      echo "           session, send one prompt, and re-run this doctor."
    else
      ok "$CODEX_RECORDS codex citizen(s) exist — the hook has fired for real on this host (newest listed above)"
    fi
    # The log is the OTHER half of this axis, and it is the half that CAN be red: a hook
    # that ran and refused is a fact about this unit, unlike an operator who has not
    # opened Codex yet.
    if [ -z "$HOOK_LOG" ]; then
      unknown "the record reader did not report a hook-log path"
    elif [ -f "$HOOK_LOG" ]; then
      CODEX_ERRORS="$(grep -c 'ERROR \[codex\]' "$HOOK_LOG" 2>/dev/null || true)"
      if [ "${CODEX_ERRORS:-0}" -gt 0 ] 2>/dev/null; then
        bad "$CODEX_ERRORS [codex] ERROR line(s) in $HOOK_LOG — a hook ran and refused or failed. Newest:"
        grep 'ERROR \[codex\]' "$HOOK_LOG" | tail -n3 | sed 's/^/           /' >&2
      else
        info "no [codex] ERROR lines in $HOOK_LOG"
      fi
    else
      info "no hook log yet at $HOOK_LOG (nothing has fired)"
    fi
  fi
fi

echo
if [ "$RED" -gt 0 ]; then
  echo "[codex-birth-doctor] $RED RED — see above." >&2
  exit 1
fi
if [ "$UNKNOWN" -gt 0 ]; then
  echo "[codex-birth-doctor] no RED, $UNKNOWN UNKNOWN axis/axes — run the other invocation named above to close them."
  exit 2
fi
echo "[codex-birth-doctor] every evaluated axis is green."
