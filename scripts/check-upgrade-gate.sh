#!/usr/bin/env bash
# check-upgrade-gate.sh — the SOURCE cell of the three-cell upgrade proof
# (#50 M1 / #51). Answers one question this repo could not answer before:
# what happens when THIS cut lands on a development host that already carries a
# pre-cut (v1/v2) meta-record store?
#
# The migration engine itself was already proven (check-meta-migrate-v3 drives
# the real CLI over synthetic stores). What was never proven is the ACTIVATION
# ORDER around it: that `run.sh install` / `setup` / `install-meta-bridge` refuse
# such a host BEFORE writing anything, that the refusal names the migrate verb,
# and that the documented migrate → retry sequence actually lands. A README
# paragraph describing that sequence is not evidence; this is.
#
# Every host state here is seeded from ../fixtures/meta-store — CHECKED-IN bytes
# with a frozen sha256 manifest, never a record this repo's serializer minted at
# test time. That distinction is the point: `backup bytes == original bytes` is a
# real assertion only when "original" is a constant the code under test cannot
# move. The same fixtures feed the installed-package cell (check-pack-install)
# and the container cell (check-install-container), so all three cells agree on
# what the host had.
#
# Deterministic: no model, no network, no cost. It drives the REAL `run.sh
# install` and `run.sh setup`, which are mutating commands, so every root those
# write through is swapped to a sandbox by the exports below — HOME, both XDG
# roots, the pi agent dir and the store/mailbox seam. That swap is deliberately
# a plain top-level `export` block and not a helper function: check-install-surface
# S5c reads these files statically, and a sandbox it cannot see is a sandbox the
# next edit can lose.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
FIX="$REPO/fixtures/meta-store"
SEED="$REPO/fixtures/seed-store.sh"

# Hard rule 10 — a dev-only gate has no business running from an installed
# package. The tarball ships `scripts/` whole but deliberately NOT `fixtures/`
# (they are host state, not package content), so from under node_modules this
# script would die on missing fixtures instead of saying what is actually wrong.
# REFUSE legibly, in the same words run_ts and check-install-container use.
case "$REPO" in
  */node_modules/*)
    echo "entwurf: 'check-upgrade-gate' is a dev-clone-only surface — the installed package ships no upgrade fixtures." >&2
    echo "         (the frozen host-state fixtures are deliberately excluded from the tarball; run this from a checkout.)" >&2
    exit 1
    ;;
esac

SANDBOX="$(mktemp -d -t entwurf-upgrade-gate.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT
export HOME="$SANDBOX/home"
export XDG_DATA_HOME="$SANDBOX/home/.local/share"
export XDG_STATE_HOME="$SANDBOX/home/.local/state"
export XDG_CACHE_HOME="$SANDBOX/home/.cache"
export PI_CODING_AGENT_DIR="$SANDBOX/home/.pi/agent"
export ENTWURF_META_SESSIONS_DIR="$SANDBOX/store"
export ENTWURF_META_MAILBOX_DIR="$SANDBOX/mailbox"
# C6~C8 drive the real meta-bridge installer only as far as its store gate. If
# that ordering regresses, never fall through to the operator's real Claude CLI:
# a PATH-local sentinel records the forbidden contact and exits. Keeping the
# rest of PATH preserves node/python3/sha256sum, so the fixture and installer
# behavior under test is unchanged.
export UPGRADE_GATE_CLAUDE_SENTINEL="$SANDBOX/claude-invoked.log"
mkdir -p "$SANDBOX/fakebin"
cat > "$SANDBOX/fakebin/claude" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "${UPGRADE_GATE_CLAUDE_SENTINEL:?}"
exit 97
SH
chmod +x "$SANDBOX/fakebin/claude"
export PATH="$SANDBOX/fakebin:$PATH"
PROJ="$SANDBOX/proj"
MIGRATE=("$REPO/scripts/meta-bridge-migrate-v3.ts")

PASSED=0
FAILED=0
ok()  { PASSED=$((PASSED + 1)); echo "  ✅ $1"; }
bad() { FAILED=$((FAILED + 1)); echo "  ❌ $1" >&2; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/       /' >&2; return 0; }

# ── the frozen fixture hashes, spelled HERE as well as in the manifest ────────
# Two independent spellings on purpose. The manifest travels with the fixtures
# and is what seed-store.sh enforces at copy time; these constants are what the
# GATE was written against. A fixture edit that updates only one side fails
# below, so re-baselining an upgrade proof cannot happen as a silent side effect
# of "regenerating the fixtures" — it takes an edit in two files and a reviewer
# who sees both.
FIXTURE_HOSTS_SHA=7b2e52336555437533c6b3fc46155bc4c93e09c97912ccc7ff7283f2029c5fbc
FIXTURE_V2_PLAIN_SHA=163f98856fd89d2ae44cec607a264bff77731bdcad2d76d54d89f1eab08dde39
FIXTURE_V2_PARENT_SHA=cb49944585d29e7bdf19c9fdae4734039713e6ac643c75d6dd37694bad547cca
FIXTURE_V2_ENTWURF_SHA=b8bd559b64268f169f75df62be8011cfb6fe4d6a223dda6fed2b85b51670d137
FIXTURE_MALFORMED_SHA=0d5dff9f42b3be8977ec1d2183790c5207f692e9af95c94e5358705418c92973
FIXTURE_V3_SHA=c843b9faa1559bdbb1382be8a5d71ed4a9a20c2bcdc3a8b71d18828c61c487e1

echo "[check-upgrade-gate] A. fixture integrity (frozen bytes, two spellings)"
manifest_now="$(cd "$FIX" && sha256sum hosts.json records/*.meta.json)"
if [ "$manifest_now" = "$(cat "$FIX/MANIFEST.sha256")" ]; then
  ok "A1 every fixture file hashes to its MANIFEST.sha256 entry"
else
  bad "A1 fixture bytes drifted from MANIFEST.sha256" "$(diff "$FIX/MANIFEST.sha256" <(printf '%s\n' "$manifest_now") || true)"
fi

gate_vs_manifest=0
while read -r want file; do
  case "$file" in
    *hosts.json)                   [ "$want" = "$FIXTURE_HOSTS_SHA" ]      || gate_vs_manifest=1 ;;
    *20260302T000000-bbbb02*) [ "$want" = "$FIXTURE_V2_PLAIN_SHA" ]   || gate_vs_manifest=1 ;;
    *20260305T000000-dddd05*) [ "$want" = "$FIXTURE_V2_PARENT_SHA" ]  || gate_vs_manifest=1 ;;
    *20260306T000000-eeee06*) [ "$want" = "$FIXTURE_V2_ENTWURF_SHA" ] || gate_vs_manifest=1 ;;
    *20260307T000000-ffff07*) [ "$want" = "$FIXTURE_MALFORMED_SHA" ]  || gate_vs_manifest=1 ;;
    *20260401T000000-cccc03*) [ "$want" = "$FIXTURE_V3_SHA" ]         || gate_vs_manifest=1 ;;
    *) gate_vs_manifest=1 ;;
  esac
done < "$FIX/MANIFEST.sha256"
if [ "$gate_vs_manifest" = 0 ]; then
  ok "A2 the gate's own hash constants agree with the manifest (no one-sided re-baseline)"
else
  bad "A2 gate hash constants disagree with MANIFEST.sha256 — a fixture was re-baselined on one side only"
fi

# The v3 fixture must be exactly what the CURRENT serializer would emit. Not to
# generate it — to detect the day the canonical form moves, which would make a
# frozen v3 fixture quietly non-canonical rather than obviously stale.
if node --experimental-strip-types -e '
  const fs = require("node:fs");
  import(process.argv[1]).then((m) => {
    const frozen = fs.readFileSync(process.argv[2], "utf8");
    process.exit(frozen === m.serializeMetaIdentity(m.parseMetaRecordV3(frozen)) ? 0 : 1);
  });
' "$REPO/pi-extensions/lib/meta-session.ts" "$FIX/records/20260401T000000-cccc03.meta.json" 2>/dev/null; then
  ok "A3 the frozen v3 fixture is byte-identical to today's canonical serialization"
else
  bad "A3 the frozen v3 fixture is no longer what serializeMetaIdentity emits — the canonical form moved; update the fixture + manifest + gate constants deliberately"
fi

# ── world helpers ────────────────────────────────────────────────────────────
# One sandbox, reset between cases. The exported roots never change (so the
# static sandbox check above stays legible), only their contents.
reset_world() {
  rm -rf "$SANDBOX/home" "$SANDBOX/proj" "$SANDBOX/store" "$SANDBOX/mailbox"
  rm -rf "$SANDBOX"/store.*
  mkdir -p "$HOME" "$PROJ" "$PI_CODING_AGENT_DIR" "$ENTWURF_META_MAILBOX_DIR"
  bash "$SEED" "$1" "$ENTWURF_META_SESSIONS_DIR" >/dev/null
}

# Everything a write could land in — used as a before/after fence. The STORE and
# MAILBOX are in here, not just home/proj: they are siblings of the sandbox home,
# and a fence that omits them would call a refusal clean while it corrupted the
# very store it refused over.
#
# SCOPE, precisely: a REGULAR-FILE path+sha256 manifest. No permissions, no
# ownership, no symlink targets, no empty directories. Read a green as "no
# persistent regular file appeared, vanished or changed", never as "untouched".
host_bytes() { (cd "$SANDBOX" && find home proj store mailbox -type f -print0 2>/dev/null | sort -z | xargs -0r sha256sum) 2>/dev/null || true; }
store_bytes() { (find "$ENTWURF_META_SESSIONS_DIR" -type f -print0 2>/dev/null | sort -z | xargs -0r sha256sum) 2>/dev/null || true; }
backup_dirs() { find "$SANDBOX" -maxdepth 1 -type d -name 'store.v3-migration-backup-*'; }

# ── B. the host-state matrix against `run.sh install` ────────────────────────
# `install` is the activation step: it registers entwurf in project AND user
# scope packages[], which is what makes the V3-only extensions load from any
# cwd. Eight host states an upgrading machine can actually be in.
echo "[check-upgrade-gate] B. host-state matrix — run.sh install"
for state in absent empty v3-only v2-only mixed v2-parentage malformed mixed-problem; do
  case "$state" in
    absent|empty|v3-only) expect=pass ;;
    *) expect=refuse ;;
  esac
  reset_world "$state"
  before="$(host_bytes)"
  store_before="$(store_bytes)"
  set +e
  out="$(HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" "$REPO/run.sh" install "$PROJ" 2>&1)"; rc=$?
  set -e

  if [ "$expect" = pass ]; then
    if [ "$rc" = 0 ]; then ok "B/$state install PASSES (exit 0)"; else bad "B/$state install should have passed" "$out"; continue; fi
    # A successful install is SUPPOSED to write settings/state — asserting an
    # untouched HOST here would be asserting the install did nothing. What must
    # stay untouched is the STORE: install activates, it never migrates.
    if [ "$store_before" = "$(store_bytes)" ]; then
      ok "B/$state a passing install leaves the store byte-untouched"
    else
      bad "B/$state install mutated the store it was gated on"
    fi
  else
    if [ "$rc" != 0 ]; then ok "B/$state install REFUSES (exit $rc)"; else bad "B/$state install should have refused but exited 0" "$out"; continue; fi
    if [ "$before" = "$(host_bytes)" ]; then
      ok "B/$state refusal left every persistent regular file unchanged (home/proj/store/mailbox path+sha256 manifest)"
    else
      bad "B/$state refusal mutated the host before refusing" "$(diff <(printf '%s\n' "$before") <(printf '%s\n' "$(host_bytes)") || true)"
    fi
    case "$out" in
      *"refused BEFORE any write"*) ok "B/$state refusal says it refused before writing" ;;
      *) bad "B/$state refusal did not name its own ordering guarantee" "$out" ;;
    esac
  fi
done

# ── C. the refusal has to be USEFUL, not merely loud ─────────────────────────
echo "[check-upgrade-gate] C. refusal legibility"
reset_world v2-only
set +e
out="$(HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" "$REPO/run.sh" install "$PROJ" 2>&1)"
set -e
case "$out" in
  *"meta-bridge-migrate-v3 migrate"*) ok "C1 a pre-cut refusal names the migrate verb" ;;
  *) bad "C1 pre-cut refusal never named the fix" "$out" ;;
esac
case "$out" in
  *"entwurf meta-bridge-migrate-v3 migrate"*) ok "C2 it names the INSTALLED invocation form too (a packaged host cannot type ./run.sh)" ;;
  *) bad "C2 pre-cut refusal named only the dev-clone command form" "$out" ;;
esac

reset_world malformed
set +e
out="$(HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" "$REPO/run.sh" install "$PROJ" 2>&1)"
set -e
case "$out" in
  *"not valid JSON"*) ok "C3 a malformed store keeps its own cause (not flattened into 'run migrate')" ;;
  *) bad "C3 malformed store lost its cause" "$out" ;;
esac
case "$out" in
  *"pre-cut v2 record"*) bad "C3b a malformed store was mis-reported as a pre-cut store" "$out" ;;
  *) ok "C3b a malformed store is not mis-sold as a migratable one" ;;
esac
# Preserving the cause is not enough if the wrapper still ends with "run migrate".
# A corrupt record is not a migration case, and handing an operator a command that
# cannot help is how a blackout gets longer. The prescription must be absent here.
case "$out" in
  *"Migrate the store"*|*"run the named migrate"*)
    bad "C3c the malformed refusal still prescribes migration — M1 does not fix unreadable bytes" "$out" ;;
  *) ok "C3c the malformed refusal prescribes no migration (the cause it reports is not one migrate can close)" ;;
esac
case "$out" in
  *"NOT a migration case"*) ok "C3d it says so in words, rather than leaving the operator to infer it from silence" ;;
  *) bad "C3d the malformed refusal never tells the operator this is not a migration case" "$out" ;;
esac

# The axes can coexist: migration is eventually needed for the v2 record, but it
# cannot START while the malformed record remains. The wrapper must order those
# actions rather than selecting one diagnosis merely because its substring came
# first. Drive both wrappers — run.sh and the separately shipped meta installer.
reset_world mixed-problem
set +e
out="$(HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" "$REPO/run.sh" install "$PROJ" 2>&1)"
set -e
case "$out" in
  *"Repair the reported problems FIRST"*"migration refuses to start"*) ok "C4 mixed-problem store orders repair before migration" ;;
  *) bad "C4 mixed-problem store gave the wrong action order" "$out" ;;
esac
case "$out" in
  *"Migrate the store with"*) bad "C5 mixed-problem store prescribed immediate migration even though migration must refuse" "$out" ;;
  *) ok "C5 mixed-problem store does not prescribe migration as the immediate next action" ;;
esac

set +e
mb_out="$(HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" XDG_STATE_HOME="$XDG_STATE_HOME" XDG_CACHE_HOME="$XDG_CACHE_HOME" PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" bash "$REPO/scripts/meta-bridge-install.sh" 2>&1)"
set -e
case "$mb_out" in
  *"Repair the reported problems FIRST"*"migration refuses to start"*) ok "C6 meta-bridge installer preserves the same mixed-problem action order before Claude contact" ;;
  *) bad "C6 meta-bridge installer drifted from run.sh's mixed-problem prescription" "$mb_out" ;;
esac

reset_world malformed
set +e
mb_out="$(HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" XDG_STATE_HOME="$XDG_STATE_HOME" XDG_CACHE_HOME="$XDG_CACHE_HOME" PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" bash "$REPO/scripts/meta-bridge-install.sh" 2>&1)"
set -e
case "$mb_out" in
  *"NOT a migration case"*) ok "C7 meta-bridge installer identifies a problem-only store as NOT a migration case" ;;
  *) bad "C7 meta-bridge installer did not preserve the problem-only diagnosis" "$mb_out" ;;
esac
case "$mb_out" in
  *"Migrate the store with"*|*"run the named migrate"*) bad "C8 meta-bridge installer prescribed migration for malformed-only bytes" "$mb_out" ;;
  *) ok "C8 meta-bridge installer gives malformed-only bytes no migration prescription" ;;
esac

# ── D. the documented upgrade sequence, end to end ───────────────────────────
# refuse → migrate → retry → PASS, on ONE host, with the backup checked against
# the frozen bytes rather than against whatever the migration just wrote.
echo "[check-upgrade-gate] D. refuse → migrate → retry (the sequence the README prescribes)"
reset_world v2-only
before="$(host_bytes)"
set +e
HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" "$REPO/run.sh" install "$PROJ" >/dev/null 2>&1; rc1=$?
set -e
if [ "$rc1" != 0 ]; then ok "D1 pre-cut host refuses the install"; else bad "D1 pre-cut host did not refuse"; fi
if [ "$before" = "$(host_bytes)" ]; then ok "D2 every persistent regular file remains unchanged"; else bad "D2 the refused install changed the persistent regular-file manifest"; fi

set +e
mig="$(node --experimental-strip-types "${MIGRATE[@]}" migrate 2>&1)"; rc2=$?
set -e
if [ "$rc2" = 0 ]; then ok "D3 migrate succeeds on that same host"; else bad "D3 migrate failed" "$mig"; fi

backup="$(backup_dirs | head -1)"
if [ -n "$backup" ]; then
  got="$(sha256sum "$backup/20260302T000000-bbbb02.meta.json" | cut -d' ' -f1)"
  if [ "$got" = "$FIXTURE_V2_PLAIN_SHA" ]; then
    ok "D4 the backup holds the ORIGINAL bytes (sha256 == the frozen fixture, not a re-serialization)"
  else
    bad "D4 backup bytes are not the original fixture bytes (want $FIXTURE_V2_PLAIN_SHA, got $got)"
  fi
else
  bad "D4 migrate took no backup"
fi

set +e
out3="$(HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" "$REPO/run.sh" install "$PROJ" 2>&1)"; rc3=$?
set -e
if [ "$rc3" = 0 ]; then ok "D5 the retry install PASSES on the migrated host"; else bad "D5 retry install still failed" "$out3"; fi

post="$(store_bytes)"
set +e
node --experimental-strip-types "${MIGRATE[@]}" verify >/dev/null 2>&1; rcv=$?
set -e
if [ "$rcv" = 0 ]; then ok "D6 the store still certifies V3-only after a successful install"; else bad "D6 install left the store uncertified"; fi
if [ "$post" = "$(store_bytes)" ]; then ok "D7 install wrote nothing INTO the store (it activates; it never migrates)"; else bad "D7 install mutated the store"; fi

# ── E. parentage stays the operator's decision ───────────────────────────────
echo "[check-upgrade-gate] E. parentage disposition through the install lane"
reset_world v2-parentage
store_before="$(store_bytes)"
set +e
HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" "$REPO/run.sh" install "$PROJ" >/dev/null 2>&1; rc=$?
set -e
if [ "$rc" != 0 ]; then ok "E1 a parentage-bearing host refuses the install"; else bad "E1 parentage-bearing host installed"; fi

set +e
plain="$(node --experimental-strip-types "${MIGRATE[@]}" migrate 2>&1)"; rcp=$?
set -e
if [ "$rcp" != 0 ]; then ok "E2 plain migrate REFUSES a parentage-bearing store"; else bad "E2 plain migrate discarded parentage" "$plain"; fi
if [ -z "$(backup_dirs)" ]; then ok "E3 the refused migrate took no backup (it never started)"; else bad "E3 refused migrate left a backup behind"; fi
if [ "$store_before" = "$(store_bytes)" ]; then ok "E4 the store is byte-untouched after the refused migrate"; else bad "E4 refused migrate mutated the store"; fi

set +e
dropped="$(node --experimental-strip-types "${MIGRATE[@]}" migrate --drop-parentage 2>&1)"; rcd=$?
set -e
if [ "$rcd" = 0 ]; then ok "E5 explicit --drop-parentage migrates"; else bad "E5 --drop-parentage failed" "$dropped"; fi

backup="$(backup_dirs | head -1)"
parent_sha="$(sha256sum "$backup/20260305T000000-dddd05.meta.json" 2>/dev/null | cut -d' ' -f1)"
entwurf_sha="$(sha256sum "$backup/20260306T000000-eeee06.meta.json" 2>/dev/null | cut -d' ' -f1)"
if [ "$parent_sha" = "$FIXTURE_V2_PARENT_SHA" ] && [ "$entwurf_sha" = "$FIXTURE_V2_ENTWURF_SHA" ]; then
  ok "E6 the discarded parentage survives in the backup as ORIGINAL bytes"
else
  bad "E6 backup does not hold the original parentage-bearing bytes"
fi

set +e
HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" "$REPO/run.sh" install "$PROJ" >/dev/null 2>&1; rci=$?
set -e
if [ "$rci" = 0 ]; then ok "E7 install PASSES once the operator has consciously dropped parentage"; else bad "E7 install still refuses after --drop-parentage"; fi

# ── F. no entrypoint can reach a write without the gate ──────────────────────
# The matrix above drives `install`. This is the other half: `setup` is checked
# live for the refusal (it exits before `pnpm install`, so this costs nothing)
# and statically for the ORDER, and every remaining entrypoint statically.
echo "[check-upgrade-gate] F. every activation entrypoint is behind the gate"
reset_world v2-only
before="$(host_bytes)"
set +e
out="$(HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" "$REPO/run.sh" setup "$PROJ" 2>&1)"; rc=$?
set -e
if [ "$rc" != 0 ]; then ok "F1 setup REFUSES a pre-cut host"; else bad "F1 setup ran to completion on a pre-cut host" "$out"; fi
if [ "$before" = "$(host_bytes)" ]; then ok "F2 the refused setup left every persistent regular file unchanged (it never reached sync_auth)"; else bad "F2 setup mutated the host before refusing"; fi
case "$out" in
  *"Progress: resolved"*|*"Lockfile is up to date"*) bad "F3 setup reached pnpm install before the gate" "$out" ;;
  *) ok "F3 setup refused ahead of dependency install, not after" ;;
esac

# Static order: in setup_all the gate must precede sync_auth (the first writer of
# ~/.pi/agent/auth.json); in install_local_package it must precede the settings
# writers. A future edit that moves a mutation above the gate fails here.
gate_ln=$(grep -n 'preflight_v3_store setup' "$REPO/run.sh" | head -1 | cut -d: -f1)
auth_ln=$(awk '/^setup_all\(\)/,/^}/{ if ($0 ~ /^  sync_auth$/) { print NR; exit } }' "$REPO/run.sh")
if [ -n "$gate_ln" ] && [ -n "$auth_ln" ] && [ "$gate_ln" -lt "$auth_ln" ]; then
  ok "F4 setup_all calls the gate before sync_auth (line $gate_ln < $auth_ln)"
else
  bad "F4 setup_all's gate is missing or sits after sync_auth (gate=$gate_ln sync_auth=$auth_ln)"
fi

ilp_gate=$(awk '/^install_local_package\(\)/,/^}/{ if ($0 ~ /preflight_v3_store install/) { print NR; exit } }' "$REPO/run.sh")
ilp_write=$(awk '/^install_local_package\(\)/,/^}/{ if ($0 ~ /register-pi-package.py|mkdir -p "\$project_dir/) { print NR; exit } }' "$REPO/run.sh")
if [ -n "$ilp_gate" ] && [ -n "$ilp_write" ] && [ "$ilp_gate" -lt "$ilp_write" ]; then
  ok "F5 install_local_package gates before its first write (line $ilp_gate < $ilp_write)"
else
  bad "F5 install_local_package's gate is missing or sits after its first write (gate=$ilp_gate write=$ilp_write)"
fi

# Anchor on the line that RUNS the check, not on the comment that introduces it —
# a comment can survive an edit that moved the code out from under it.
mb_gate=$(grep -n 'MIGRATE_CMD\[@\]}" verify' "$REPO/scripts/meta-bridge-install.sh" | head -1 | cut -d: -f1)
mb_write=$(grep -n 'meta-bridge-state.py" prepare' "$REPO/scripts/meta-bridge-install.sh" | head -1 | cut -d: -f1)
if [ -n "$mb_gate" ] && [ -n "$mb_write" ] && [ "$mb_gate" -lt "$mb_write" ]; then
  ok "F6 meta-bridge-install.sh RUNS verify before its pre-install state snapshot (line $mb_gate < $mb_write)"
else
  bad "F6 meta-bridge-install.sh's verify call is missing or sits after the state snapshot (verify=$mb_gate prepare=$mb_write)"
fi

# The gate must never migrate on the operator's behalf, and must never pass the
# parentage-discarding flag. Both are LOCKED PROTOCOL decisions, not defaults.
if grep -n 'preflight_v3_store()' -A 40 "$REPO/run.sh" | grep -qE 'migrate-v3\.ts (migrate|.*--drop-parentage)'; then
  bad "F7 the preflight invokes migrate — an install must never migrate a store by itself"
else
  ok "F7 the preflight only ever calls 'verify' (never migrate, never --drop-parentage)"
fi

if [ -e "$UPGRADE_GATE_CLAUDE_SENTINEL" ]; then
  bad "F8 an offline upgrade-gate drive crossed the store refusal and invoked Claude" "$(cat "$UPGRADE_GATE_CLAUDE_SENTINEL")"
else
  ok "F8 offline source cell made zero Claude invocations (PATH sentinel stayed untouched)"
fi

echo
echo "[check-upgrade-gate] passed=$PASSED failed=$FAILED"
[ "$FAILED" = 0 ] || exit 1
echo "[check-upgrade-gate] SOURCE cell green — the activation entrypoints refuse a pre-cut host before writing, name the fix, and the prescribed migrate → retry sequence lands."
