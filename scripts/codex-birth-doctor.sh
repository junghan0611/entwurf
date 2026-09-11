#!/usr/bin/env bash
# codex-birth-doctor — the Codex birth unit verdict: our bytes, and the vendor receipt.
#
# Three axes, reported independently, because they fail for different reasons and an
# operator repairs them with different hands:
#
#   RUNTIME     is there a node the launcher can exec, and a Codex CLI at all?
#   UNIT        are the declaration, launcher and closure present, ours by digest, and
#               owned/permissioned so that nobody else could have written them?
#   TRUST       has the VENDOR recorded the operator's one-time decision for this exact
#               declaration identity?
#
# WHAT THE TRUST AXIS IS, EXACTLY. It reads `$CODEX_HOME/config.toml` and looks for the
# vendor's own receipt at the fixed key `<hooks.json>:session_start:0:0`, whose value must
# be a `trusted_hash` of the shape `sha256:<64 hex>`. That is ALL it claims: a vendor trust
# receipt is present for the declaration identity this unit publishes. It does NOT compute
# what that hash should be, does not compare it to anything of ours, and therefore never
# says the approval is cryptographically valid — the vendor hashes a normalized identity of
# its own (`[source]` hooks/src/engine/discovery.rs:775-792) and recomputing it here would
# be entwurf asserting authority over somebody else's security decision.
#
# WHAT THIS DOCTOR NEVER DOES. It does not write, pre-seed or repair `[hooks.state]`, and it
# never launches Codex. A missing receipt is not something to fix from here: the operator
# opens a visible Codex, answers the vendor's prompt once, and comes back.
#
# Trust missing makes the WHOLE doctor red, on purpose. A unit whose bytes are perfect but
# whose hook the vendor will not run is a citizen nobody will ever be born as — reporting
# that as green is the exact false success this file exists to refuse. `--unit-only` exists
# for the sandbox gate, which has no vendor and no operator; it can never make setup or the
# fresh preflight green, because neither passes that flag.
set -euo pipefail

UNIT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    # For the hermetic gate only: there is no vendor and no operator inside a sandbox, so the
    # TRUST axis has nothing to read. It is REPORTED as skipped, never as green, and setup and
    # the fresh preflight both call this doctor without the flag.
    --unit-only) UNIT_ONLY=1 ;;
    *) printf '[codex-birth-doctor] unknown argument %s — this doctor takes only --unit-only.\n' "'$arg'" >&2; exit 1 ;;
  esac
done

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
HOOKS_FILE="$CODEX_HOME/hooks.json"
PACKAGE_STATE_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf"
UNIT_ROOT="$PACKAGE_STATE_ROOT/codex-birth"
HELPER_DIR="$UNIT_ROOT/helper"
LAUNCHER_NAME="codex-birth-launch.sh"
LAUNCHER="$HELPER_DIR/$LAUNCHER_NAME"
STATE_FILE="$UNIT_ROOT/install-state.json"
ME="$(id -u)"

RED=0
section() { printf '\n── %s %s\n' "$1" "─────────────────────────────────────────"; }
bad() { printf '  RED      %s\n' "$1"; RED=$((RED + 1)); }
ok() { printf '  ok       %s\n' "$1"; }
info() { printf '  ·        %s\n' "$1"; }

sha_of() { sha256sum -- "$1" | cut -d' ' -f1; }

section "PATHS"
# The declaration records an ABSOLUTE launcher path and the vendor keys its trust receipt to
# it, so a relative CODEX_HOME or XDG_DATA_HOME would make this doctor judge a different unit
# depending on the caller's cwd.
case "$CODEX_HOME" in
  /*) ok "CODEX_HOME resolves absolute ($CODEX_HOME)" ;;
  *) bad "CODEX_HOME resolves to a relative path ('$CODEX_HOME') — every verdict below would depend on the caller's cwd." ;;
esac
case "$UNIT_ROOT" in
  /*) ok "the unit root resolves absolute ($UNIT_ROOT)" ;;
  *) bad "the unit root resolves to a relative path ('$UNIT_ROOT') — set an absolute XDG_DATA_HOME or HOME." ;;
esac

section "RUNTIME"
if NODE_BIN="$(command -v node 2>/dev/null)"; then
  NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$NODE_MAJOR" -ge 24 ] 2>/dev/null; then
    ok "node $("$NODE_BIN" -p 'process.versions.node') at $NODE_BIN (>= 24, so strip-types runs the payload)"
  else
    bad "node at $NODE_BIN reports major '$NODE_MAJOR'; the payload is raw TypeScript and needs >= 24."
  fi
else
  bad "no node on PATH — the hook payload cannot run."
  NODE_BIN=""
fi
if CODEX_BIN="$(command -v "${CODEX_BIN:-codex}" 2>/dev/null)"; then
  info "codex CLI: $CODEX_BIN $("$CODEX_BIN" --version 2>/dev/null | head -1)"
else
  info "no codex CLI on PATH — the unit's bytes are still judged below; the harness is the operator's."
fi

# The directory holding the receipt carries the receipt's authority: anyone who can write it
# can replace what licenses every removal. Judged before the state is read, and never repaired.
judge_parent() { # $1 = dir, $2 = label
  [ -e "$1" ] || return 0
  if [ -L "$1" ]; then bad "$2 ($1) is a SYMLINK — ownership authority may not come through a link."; return 0; fi
  [ -d "$1" ] || { bad "$2 ($1) is not a directory."; return 0; }
  local st mode uid
  st="$(stat -c '%a %u' -- "$1")"; mode="$(printf '%s' "$st" | cut -d' ' -f1)"; uid="$(printf '%s' "$st" | cut -d' ' -f2)"
  [ "$uid" = "$ME" ] || { bad "$2 ($1) is owned by uid $uid, not you ($ME) — it holds the receipt that licenses removals."; return 0; }
  [ $((8#$mode & 0022)) -eq 0 ] || bad "$2 ($1) is group/world-writable (mode $mode), so the ownership state inside it is not provably ours."
}

section "UNIT (the bytes this unit publishes, and whether they are still ours)"
judge_parent "$PACKAGE_STATE_ROOT" "the package state root"
judge_parent "$UNIT_ROOT" "the unit root"
if [ ! -e "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ]; then
  if [ -e "$HOOKS_FILE" ] || [ -e "$HELPER_DIR" ]; then
    bad "no ownership state at $STATE_FILE, yet $HOOKS_FILE or $HELPER_DIR exists — those bytes are not provably ours and the inverse will refuse them. Inspect them."
  else
    # NOT an informational note. "Nothing is installed" is the most complete way for this
    # unit to be broken: no declaration, no closure, no record will ever be minted — and a
    # host that has trusted an OLDER declaration still carries a vendor receipt, so the TRUST
    # axis alone can read green over an empty unit. Measured exactly that way before this was
    # red. An absent unit is a red unit, in both modes.
    bad "no Codex birth unit is installed here (no ownership state at $STATE_FILE, no declaration, no closure), so no Codex thread on this host can become a citizen.
           Install: ./run.sh install-codex-birth"
  fi
elif [ -L "$STATE_FILE" ]; then
  bad "$STATE_FILE is a SYMLINK — removal authority may not come through a link."
elif [ ! -f "$STATE_FILE" ]; then
  bad "$STATE_FILE is not a regular file."
elif [ -z "$NODE_BIN" ]; then
  bad "the ownership state cannot be parsed without node."
else
  STATE_ST="$(stat -c '%a %u' -- "$STATE_FILE")"
  STATE_MODE="$(printf '%s' "$STATE_ST" | cut -d' ' -f1)"
  STATE_UID="$(printf '%s' "$STATE_ST" | cut -d' ' -f2)"
  [ "$STATE_UID" = "$ME" ] || bad "$STATE_FILE is owned by uid $STATE_UID, not you ($ME) — anyone who can rewrite it can license removal of the paths it names."
  [ $((8#$STATE_MODE & 0022)) -eq 0 ] || bad "$STATE_FILE is group/world-writable (mode $STATE_MODE) — the same authority problem."

  INVENTORY="$("$NODE_BIN" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const out = [];
    const hex = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
    if (s.schema !== "codex-birth-install-state/v1") out.push("BAD\tforeign state schema " + JSON.stringify(s.schema));
    if (s.status !== "installed") out.push("BAD\tthe state status is " + JSON.stringify(s.status) + ", so a previous install did not finish publishing. Repair: ./run.sh install-codex-birth");
    if (s.hooksFile !== process.argv[2]) out.push("BAD\tthe state is bound to " + s.hooksFile + ", not the fixed path " + process.argv[2]);
    if (s.helperDir !== process.argv[3]) out.push("BAD\tthe state is bound to helper dir " + s.helperDir + ", not the fixed path " + process.argv[3]);
    if (!hex(s.hooksSha256)) out.push("BAD\thooksSha256 is not a digest");
    else out.push("WANT\t" + s.hooksSha256 + "\t" + s.hooksFile + "\tthe declaration");
    const expected = [
      "codex-birth-launch.sh",
      "meta-bridge-hook-codex.ts",
      "lib/meta-session.ts",
      "lib/native-push/codex-ws-client.ts",
      "lib/session-id.js",
      "entwurf-capabilities.json",
    ];
    if (!Array.isArray(s.helperFiles) || s.helperFiles.length === 0) out.push("BAD\thelperFiles is empty");
    else {
      // Exactly the closure this unit publishes. A short inventory hides a file the inverse
      // can never reclaim; a long one licenses deleting something we never wrote.
      const named = s.helperFiles.map((f) => (f == null ? "" : f.path));
      const missing = expected.filter((name) => !named.includes(name));
      const extra = named.filter((name) => !expected.includes(name));
      const duplicate = named.filter((name, i) => named.indexOf(name) !== i);
      if (missing.length) out.push("BAD\tthe recorded closure inventory is missing " + missing.join(", ") + " — the doctor cannot judge bytes no state names");
      if (extra.length) out.push("BAD\tthe recorded closure inventory names files this unit never publishes: " + extra.join(", "));
      if (duplicate.length) out.push("BAD\tthe recorded closure inventory repeats " + duplicate.join(", "));
    }
    if (Array.isArray(s.helperFiles)) for (const f of s.helperFiles) {
      if (typeof f?.path !== "string" || f.path.startsWith("/") || f.path.split("/").includes("..")) { out.push("BAD\tunsafe helper path " + JSON.stringify(f?.path)); continue; }
      if (!hex(f.sha256)) { out.push("BAD\tbad helper digest for " + f.path); continue; }
      out.push(["WANT", f.sha256, path.join(s.helperDir, f.path), "helper member " + f.path, f.mode ?? ""].join("\t"));
    }
    out.push("INFO\tunitVersion=" + (s.unitVersion ?? "?") + " nodeBin=" + (s.nodeBin ?? "?"));
    process.stdout.write(out.join("\n") + "\n");
  ' "$STATE_FILE" "$HOOKS_FILE" "$HELPER_DIR" 2>&1)" || { bad "the ownership state is unreadable or malformed: $INVENTORY"; INVENTORY=""; }

  while IFS="$(printf '\t')" read -r kind a b c d; do
    case "$kind" in
      BAD) bad "$a" ;;
      INFO) info "$a" ;;
      WANT)
        if [ -L "$b" ]; then bad "$c is a SYMLINK ($b) — this unit publishes no links."
        elif [ ! -e "$b" ]; then bad "$c is MISSING: $b"
        elif [ ! -f "$b" ]; then bad "$c is not a regular file: $b"
        else
          live="$(sha_of "$b")"
          st="$(stat -c '%a %u' -- "$b")"
          mode="$(printf '%s' "$st" | cut -d' ' -f1)"; uid="$(printf '%s' "$st" | cut -d' ' -f2)"
          if [ "$live" != "$a" ]; then bad "$c was EDITED after install ($b: live $live, recorded $a) — the inverse will refuse to remove it."
          elif [ "$uid" != "$ME" ]; then bad "$c is owned by uid $uid, not you ($ME): $b"
          elif [ $((8#$mode & 0022)) -ne 0 ]; then bad "$c is group/world-writable (mode $mode): $b"
          else ok "$c matches the state ($b)"
          fi
          [ -n "$d" ] && [ "$mode" != "${d#0}" ] && [ "0$mode" != "$d" ] && info "$c mode is $mode, state recorded $d"
        fi
        ;;
    esac
  done <<EOF
$INVENTORY
EOF
fi

TRUST_REPAIR="Repair: open a visible plain Codex (no flags), answer the vendor's prompt with
           'Trust all and continue', send one first turn, then re-run this doctor."

section "TRUST (the vendor's receipt for this exact declaration)"
if [ "$UNIT_ONLY" = "1" ]; then
  info "--unit-only: the vendor receipt was NOT read. This is a skipped axis, not a green one."
elif [ ! -e "$CODEX_HOME/config.toml" ]; then
  bad "$CODEX_HOME/config.toml does not exist, so the vendor has recorded no trust decision for $HOOKS_FILE.
           $TRUST_REPAIR"
elif ! command -v python3 >/dev/null 2>&1; then
  bad "python3 is required to read the vendor config (the same reader the MCP/status-line atoms use) and is not on PATH."
else
  # The key the vendor writes is `<declaration path>:<event>:<group>:<handler>` — measured on
  # this host after one 'Trust all'. We look for exactly ours: a receipt for a DIFFERENT
  # declaration is not this unit's approval, however valid it is for whoever owns it.
  TRUST_KEY="$HOOKS_FILE:session_start:0:0"
  # python3 + tomllib, the same reader the two config atoms already use — node has no TOML
  # parser and inventing one here would be a second opinion about the vendor's own file.
  TRUST_OUT="$(python3 -c '
import sys, tomllib
cfg_path, key = sys.argv[1], sys.argv[2]
try:
    cfg = tomllib.load(open(cfg_path, "rb"))
except Exception as err:  # noqa: BLE001 - the message is the verdict
    sys.stdout.write("ERROR\t" + str(err)); raise SystemExit(0)
state = cfg.get("hooks", {}).get("state")
if not isinstance(state, dict):
    sys.stdout.write("ABSENT\tno [hooks.state] table"); raise SystemExit(0)
if key not in state:
    others = sorted(state.keys())
    sys.stdout.write("WRONGKEY\t" + (", ".join(others) if others else "(none)")); raise SystemExit(0)
entry = state[key]
digest = entry.get("trusted_hash") if isinstance(entry, dict) else None
if not isinstance(digest, str):
    sys.stdout.write("MALFORMED\tthe receipt carries no trusted_hash string"); raise SystemExit(0)
import re
if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
    sys.stdout.write("MALFORMED\ttrusted_hash is not sha256:<64 hex>: " + repr(digest)); raise SystemExit(0)
sys.stdout.write("PRESENT\t" + digest)
' "$CODEX_HOME/config.toml" "$TRUST_KEY" 2>&1)" || TRUST_OUT="ERROR	$TRUST_OUT"
  TRUST_KIND="$(printf '%s' "$TRUST_OUT" | cut -f1)"
  TRUST_DETAIL="$(printf '%s' "$TRUST_OUT" | cut -f2-)"
  case "$TRUST_KIND" in
    PRESENT)
      ok "a vendor trust receipt is present for $TRUST_KEY ($TRUST_DETAIL)"
      info "this reports that the vendor RECORDED a decision for this declaration identity — it is"
      info "not a cryptographic validation, and this doctor never computes what that hash should be."
      ;;
    ABSENT)
      bad "no vendor trust receipt for this declaration — $TRUST_DETAIL. Until the operator answers the
           vendor's prompt once, this hook is declared and never runs.
           $TRUST_REPAIR"
      ;;
    WRONGKEY)
      bad "the vendor has trust receipts, but NONE at this unit's key $TRUST_KEY (present: $TRUST_DETAIL).
           A receipt for another declaration is somebody else's approval, not this one's.
           $TRUST_REPAIR"
      ;;
    MALFORMED)
      bad "the vendor trust receipt at $TRUST_KEY is unreadable: $TRUST_DETAIL.
           $TRUST_REPAIR"
      ;;
    *)
      bad "the vendor config at $CODEX_HOME/config.toml could not be read: $TRUST_DETAIL"
      ;;
  esac
fi

if [ "$RED" -ne 0 ]; then
  printf '\n[codex-birth-doctor] %d RED — see above.\n' "$RED" >&2
  exit 1
fi
if [ "$UNIT_ONLY" = "1" ]; then
  printf '\n[codex-birth-doctor] unit bytes and ownership are intact; the TRUST axis was skipped (--unit-only).\n'
else
  printf '\n[codex-birth-doctor] unit bytes are ours and the vendor trust receipt is present for this declaration.\n'
fi
