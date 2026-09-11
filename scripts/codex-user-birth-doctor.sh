#!/usr/bin/env bash
# codex-user-birth-doctor — STATIC verdict on the user-layer birth unit's own bytes.
#
# It answers exactly two questions and refuses to imply a third:
#
#   RUNTIME     is there a node the launcher can exec, and a Codex CLI at all?
#   UNIT        are the declaration, launcher and closure present, ours by digest, and
#               owned/permissioned so that nobody else could have written them?
#
# WHAT THIS DOCTOR DOES NOT SAY. It does not report whether the operator has TRUSTED the
# declaration, because trust is the vendor's record in config.toml — a file this unit never
# reads or writes — and a green here therefore means "the bytes are ours and intact", never
# "a Codex thread will be born". Until the operator answers the vendor's one-time prompt, a
# perfectly green unit still runs zero hooks. Saying otherwise would sell a birth this axis
# cannot see: the honest observation lives in a real session (a minted record, a live thread
# title), not in a static file check.
set -euo pipefail

for arg in "$@"; do
  case "$arg" in
    *) printf '[codex-user-birth-doctor] unknown argument %s — this doctor takes no options.\n' "'$arg'" >&2; exit 1 ;;
  esac
done

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
HOOKS_FILE="$CODEX_HOME/hooks.json"
UNIT_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/codex-birth"
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

section "UNIT (the bytes this unit publishes, and whether they are still ours)"
if [ ! -e "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ]; then
  if [ -e "$HOOKS_FILE" ] || [ -e "$HELPER_DIR" ]; then
    bad "no ownership state at $STATE_FILE, yet $HOOKS_FILE or $HELPER_DIR exists — those bytes are not provably ours and the inverse will refuse them. Inspect them."
  else
    info "no ownership state and nothing installed — this host has no user-layer Codex birth unit. Install: ./run.sh install-codex-user-birth"
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
    if (s.schema !== "codex-user-birth-install-state/v1") out.push("BAD\tforeign state schema " + JSON.stringify(s.schema));
    if (s.status !== "installed") out.push("BAD\tthe state status is " + JSON.stringify(s.status) + ", so a previous install did not finish publishing. Repair: ./run.sh install-codex-user-birth");
    if (s.hooksFile !== process.argv[2]) out.push("BAD\tthe state is bound to " + s.hooksFile + ", not the fixed path " + process.argv[2]);
    if (s.helperDir !== process.argv[3]) out.push("BAD\tthe state is bound to helper dir " + s.helperDir + ", not the fixed path " + process.argv[3]);
    if (!hex(s.hooksSha256)) out.push("BAD\thooksSha256 is not a digest");
    else out.push("WANT\t" + s.hooksSha256 + "\t" + s.hooksFile + "\tthe declaration");
    if (!Array.isArray(s.helperFiles) || s.helperFiles.length === 0) out.push("BAD\thelperFiles is empty");
    else for (const f of s.helperFiles) {
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

section "TRUST (not an axis this doctor can see)"
info "the vendor records a user-layer hook's trust decision in config.toml's [hooks.state]; this"
info "unit never reads or writes that file, and this doctor makes NO claim about it. A green UNIT"
info "means the bytes are ours and intact — not that any hook has run. Confirm birth in a real"
info "session instead: a minted meta-record and a live thread title carrying its garden id."

if [ "$RED" -ne 0 ]; then
  printf '\n[codex-user-birth-doctor] %d RED — see above.\n' "$RED" >&2
  exit 1
fi
printf '\n[codex-user-birth-doctor] unit bytes and ownership are intact (trust remains unobserved, by design).\n'
