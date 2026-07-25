#!/usr/bin/env bash
# check-fresh-cut-gate.sh — the SOURCE cell of the generation-boundary proof.
# Answers one question: what happens when THIS cut lands on a host whose
# meta-record store the live schema cannot read?
#
# The contract under test (the fresh-cut policy, 4 frozen sentences):
#   1. the active store is v3-only, no cross-generation continuity;
#   2. any entry that fails CERTIFICATION → install/setup REFUSE before writing,
#      naming the explicit fresh-cut verb in both invocation forms;
#   3. fresh-cut REQUIRES quiescence (live OR unprovable both refuse) and archives
#      the whole generation through one preflighted plan, opening an empty one;
#   4. the archive is forensic only — no runtime reads it, no restore verb.
#
# A–D drive the activation path. E pins the doctor and the writers to ONE
# certification verdict on the three defects that PARSE (drift / duplicate /
# symlink), where a reader-only check is happy and the address space is broken.
# F proves quiescence is demonstrated rather than assumed. G proves a collision
# refusal moves nothing. H covers the surface a marker walk cannot see at all: a
# native-push (agy) citizen holds a record and NO marker, so its liveness is asked
# from the record through the adapter probe the dispatch itself uses. I holds the
# other half of the prescription: a store that cannot be READ is not a store with
# defects, and the refusal must not send the operator at a cut that cannot help.
#
# There is no frozen-fixture apparatus here: fresh-cut never rewrites a byte
# (the archive is a rename), so the only byte claim is `archived == seeded`,
# checked against hashes taken at seed time. Host states are seeded INLINE.
#
# Deterministic: no model, no network, no cost. It drives the REAL `run.sh
# install` / `run.sh setup` / `meta-bridge-fresh-cut`, which are mutating
# commands, so every root those write through is swapped to a sandbox by the
# exports below — HOME, both XDG roots, the pi agent dir, the store/mailbox
# seam and the control-socket dir.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

# Hard rule 10 — a dev-only gate has no business running from an installed
# package. REFUSE legibly, in the same words run_ts uses.
case "$REPO" in
  */node_modules/*)
    echo "entwurf: 'check-fresh-cut-gate' is a dev-clone-only surface — run it from a checkout." >&2
    exit 1
    ;;
esac

SANDBOX="$(mktemp -d -t entwurf-fresh-cut-gate.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT
export HOME="$SANDBOX/home"
export XDG_DATA_HOME="$SANDBOX/home/.local/share"
export XDG_STATE_HOME="$SANDBOX/home/.local/state"
export XDG_CACHE_HOME="$SANDBOX/home/.cache"
export PI_CODING_AGENT_DIR="$SANDBOX/home/.pi/agent"
export ENTWURF_META_SESSIONS_DIR="$SANDBOX/store"
export ENTWURF_META_MAILBOX_DIR="$SANDBOX/mailbox"
export ENTWURF_DIR="$SANDBOX/sockets"
# The gate drives installers only as far as their store gate. If that ordering
# regresses, never fall through to the operator's real Claude CLI: a PATH-local
# sentinel records the forbidden contact and exits.
export FRESH_CUT_GATE_CLAUDE_SENTINEL="$SANDBOX/claude-invoked.log"
mkdir -p "$SANDBOX/fakebin"
cat > "$SANDBOX/fakebin/claude" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "${FRESH_CUT_GATE_CLAUDE_SENTINEL:?}"
exit 97
SH
chmod +x "$SANDBOX/fakebin/claude"
export PATH="$SANDBOX/fakebin:$PATH"
PROJ="$SANDBOX/proj"
FRESH_CUT=("$REPO/scripts/meta-bridge-fresh-cut.ts")

PASSED=0
FAILED=0
ok()  { PASSED=$((PASSED + 1)); echo "  ✅ $1"; }
bad() { FAILED=$((FAILED + 1)); echo "  ❌ $1" >&2; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/       /' >&2; return 0; }

# ── inline host-state seeding ────────────────────────────────────────────────
seed_v3() {
  mkdir -p "$ENTWURF_META_SESSIONS_DIR"
  cat > "$ENTWURF_META_SESSIONS_DIR/20260401T000000-cccc03.meta.json" <<'JSON'
{
  "schemaVersion": 3,
  "gardenId": "20260401T000000-cccc03",
  "backend": "pi",
  "nativeSessionId": "native-cccc03",
  "cwd": "/tmp/proj",
  "model": null,
  "transcriptPath": null,
  "createdAt": "2026-04-01T00:00:00.000Z",
  "recordUpdatedAt": "2026-04-01T00:00:00.000Z"
}
JSON
}
seed_prevgen() {
  mkdir -p "$ENTWURF_META_SESSIONS_DIR"
  cat > "$ENTWURF_META_SESSIONS_DIR/20260305T000000-dddd05.meta.json" <<'JSON'
{
  "schemaVersion": 2,
  "gardenId": "20260305T000000-dddd05",
  "backend": "claude-code",
  "nativeSessionId": "prevgen-native-1",
  "cwd": "/tmp/prevgen",
  "model": null,
  "transcriptPath": null,
  "parentGardenId": "20260101T000000-aaaa01",
  "isEntwurf": true,
  "createdAt": "2026-03-05T00:00:00.000Z",
  "recordUpdatedAt": "2026-03-05T00:00:00.000Z"
}
JSON
}
seed_malformed() {
  mkdir -p "$ENTWURF_META_SESSIONS_DIR"
  printf '{ this is not json' > "$ENTWURF_META_SESSIONS_DIR/20260307T000000-ffff07.meta.json"
}
# The three defects that PARSE. Each one is legible v3 bytes, so a reader-only
# check waves them through — and each one breaks the store as an ADDRESS SPACE.
# They exist as their own host states because the writers used to ask a narrower
# question than the doctor: "is there a record for MY native id".
seed_drift() {
  mkdir -p "$ENTWURF_META_SESSIONS_DIR"
  # Valid V3 body parked under a name that is not its garden id: a garden-id
  # lookup can never reach it.
  cat > "$ENTWURF_META_SESSIONS_DIR/wrong-name.meta.json" <<'JSON'
{
  "schemaVersion": 3,
  "gardenId": "20260403T000000-eeee03",
  "backend": "pi",
  "nativeSessionId": "native-drift",
  "cwd": "/tmp/proj",
  "model": null,
  "transcriptPath": null,
  "createdAt": "2026-04-03T00:00:00.000Z",
  "recordUpdatedAt": "2026-04-03T00:00:00.000Z"
}
JSON
}
seed_dup() {
  mkdir -p "$ENTWURF_META_SESSIONS_DIR"
  # Two records claiming ONE native session: the store cannot say which garden id
  # owns it. Neither is the id of the session a writer is about to birth.
  for gid in 20260404T000000-aaaa04 20260404T000001-bbbb04; do
    cat > "$ENTWURF_META_SESSIONS_DIR/$gid.meta.json" <<JSON
{
  "schemaVersion": 3,
  "gardenId": "$gid",
  "backend": "pi",
  "nativeSessionId": "dup-native",
  "cwd": "/tmp/proj",
  "model": null,
  "transcriptPath": null,
  "createdAt": "2026-04-04T00:00:00.000Z",
  "recordUpdatedAt": "2026-04-04T00:00:00.000Z"
}
JSON
  done
}
seed_symlink() {
  mkdir -p "$ENTWURF_META_SESSIONS_DIR" "$SANDBOX/outside"
  cat > "$SANDBOX/outside/real.json" <<'JSON'
{
  "schemaVersion": 3,
  "gardenId": "20260405T000000-ffff05",
  "backend": "pi",
  "nativeSessionId": "native-symlinked",
  "cwd": "/tmp/proj",
  "model": null,
  "transcriptPath": null,
  "createdAt": "2026-04-05T00:00:00.000Z",
  "recordUpdatedAt": "2026-04-05T00:00:00.000Z"
}
JSON
  # The bytes are impeccable; the store just does not own where they live.
  ln -s "$SANDBOX/outside/real.json" "$ENTWURF_META_SESSIONS_DIR/20260405T000000-ffff05.meta.json"
}

# One sandbox, reset between cases. The exported roots never change, only their
# contents. $1 = one or more seed states (comma-separated) or "absent"/"empty".
reset_world() {
  rm -rf "$SANDBOX/home" "$SANDBOX/proj" "$SANDBOX/store" "$SANDBOX/mailbox" "$SANDBOX/sockets" "$SANDBOX/outside"
  rm -rf "$SANDBOX"/store.* "$SANDBOX"/mailbox.*
  mkdir -p "$HOME" "$PROJ" "$PI_CODING_AGENT_DIR"
  case "$1" in
    absent) ;;
    empty) mkdir -p "$ENTWURF_META_SESSIONS_DIR" ;;
    *)
      local IFS=','
      for s in $1; do "seed_$s"; done
      ;;
  esac
}

# Everything a write could land in — used as a before/after fence. A
# REGULAR-FILE path+sha256 manifest: read a green as "no persistent regular file
# appeared, vanished or changed", never as "untouched".
host_bytes() { (cd "$SANDBOX" && find home proj store mailbox sockets -type f -print0 2>/dev/null | sort -z | xargs -0r sha256sum) 2>/dev/null || true; }
store_bytes() { (find "$ENTWURF_META_SESSIONS_DIR" -type f -print0 2>/dev/null | sort -z | xargs -0r sha256sum) 2>/dev/null || true; }

# ── A. the host-state matrix against `run.sh install` ────────────────────────
echo "[check-fresh-cut-gate] A. host-state matrix — run.sh install"
for state in absent empty v3 prevgen malformed prevgen,malformed drift dup symlink; do
  case "$state" in
    absent|empty|v3) expect=pass ;;
    *) expect=refuse ;;
  esac
  reset_world "$state"
  before="$(host_bytes)"
  store_before="$(store_bytes)"
  set +e
  out="$("$REPO/run.sh" install "$PROJ" 2>&1)"; rc=$?
  set -e

  if [ "$expect" = pass ]; then
    if [ "$rc" = 0 ]; then ok "A/$state install PASSES (exit 0)"; else bad "A/$state install should have passed" "$out"; continue; fi
    # A successful install is SUPPOSED to write settings/state — what must stay
    # untouched is the STORE: install activates, it never cuts.
    if [ "$store_before" = "$(store_bytes)" ]; then
      ok "A/$state a passing install leaves the store byte-untouched"
    else
      bad "A/$state install mutated the store it was gated on"
    fi
  else
    if [ "$rc" != 0 ]; then ok "A/$state install REFUSES (exit $rc)"; else bad "A/$state install should have refused but exited 0" "$out"; continue; fi
    if [ "$before" = "$(host_bytes)" ]; then
      ok "A/$state refusal left every persistent regular file unchanged"
    else
      bad "A/$state refusal mutated the host before refusing" "$(diff <(printf '%s\n' "$before") <(printf '%s\n' "$(host_bytes)") || true)"
    fi
    case "$out" in
      *"refused BEFORE any write"*) ok "A/$state refusal says it refused before writing" ;;
      *) bad "A/$state refusal did not name its own ordering guarantee" "$out" ;;
    esac
    # ONE prescription, both invocation forms — previous-generation and
    # malformed records collapse to the same fix (no migration language).
    case "$out" in
      *"./run.sh meta-bridge-fresh-cut"*) ok "A/$state refusal names the dev-clone fresh-cut form" ;;
      *) bad "A/$state refusal never named the dev-clone fresh-cut form" "$out" ;;
    esac
    case "$out" in
      *"entwurf meta-bridge-fresh-cut"*) ok "A/$state refusal names the INSTALLED fresh-cut form (a packaged host cannot type ./run.sh)" ;;
      *) bad "A/$state refusal named only the dev-clone command form" "$out" ;;
    esac
    case "$out" in
      *migrate*|*Migrate*) bad "A/$state refusal still speaks migration — that vocabulary is retired" "$out" ;;
      *) ok "A/$state refusal carries no migration language" ;;
    esac
  fi
done

# ── B. the documented sequence, end to end: refuse → fresh-cut → retry ───────
echo "[check-fresh-cut-gate] B. refuse → fresh-cut → retry (the sequence the README prescribes)"
reset_world prevgen
mkdir -p "$ENTWURF_META_MAILBOX_DIR/20260305T000000-dddd05"
printf 'hello\n' > "$ENTWURF_META_MAILBOX_DIR/20260305T000000-dddd05/0001.msg"
seed_sha="$(sha256sum "$ENTWURF_META_SESSIONS_DIR/20260305T000000-dddd05.meta.json" | cut -d' ' -f1)"
mail_sha="$(sha256sum "$ENTWURF_META_MAILBOX_DIR/20260305T000000-dddd05/0001.msg" | cut -d' ' -f1)"

set +e
"$REPO/run.sh" install "$PROJ" >/dev/null 2>&1; rc1=$?
set -e
if [ "$rc1" != 0 ]; then ok "B1 previous-generation host refuses the install"; else bad "B1 previous-generation host did not refuse"; fi

set +e
cut_out="$(node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rc2=$?
set -e
if [ "$rc2" = 0 ]; then ok "B2 fresh-cut succeeds on that same host"; else bad "B2 fresh-cut failed" "$cut_out"; fi

store_archive="$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*' | head -1)"
mail_archive="$(find "$SANDBOX" -maxdepth 1 -type d -name 'mailbox.archive-*' | head -1)"
got_store="$(sha256sum "$store_archive/20260305T000000-dddd05.meta.json" 2>/dev/null | cut -d' ' -f1)" || true
got_mail="$(sha256sum "$mail_archive/20260305T000000-dddd05/0001.msg" 2>/dev/null | cut -d' ' -f1)" || true
if [ -n "$store_archive" ] && [ "$got_store" = "$seed_sha" ]; then
  ok "B3 the store archive holds the ORIGINAL record bytes"
else
  bad "B3 store archive missing or bytes drifted (want $seed_sha, got ${got_store:-none})"
fi
if [ -n "$mail_archive" ] && [ "$got_mail" = "$mail_sha" ]; then
  ok "B4 the mailbox archive holds the ORIGINAL message bytes"
else
  bad "B4 mailbox archive missing or bytes drifted (want $mail_sha, got ${got_mail:-none})"
fi
if [ -d "$ENTWURF_META_SESSIONS_DIR" ] && [ -z "$(find "$ENTWURF_META_SESSIONS_DIR" -name '*.meta.json' 2>/dev/null)" ]; then
  ok "B5 the fresh generation is open and EMPTY (no record carried across)"
else
  bad "B5 the live store is missing or still carries records"
fi
case "$cut_out" in
  *"no restore verb"*) ok "B6 fresh-cut says the archive is forensic only (no restore verb)" ;;
  *) bad "B6 fresh-cut never stated the no-restore contract" "$cut_out" ;;
esac

set +e
out3="$("$REPO/run.sh" install "$PROJ" 2>&1)"; rc3=$?
set -e
if [ "$rc3" = 0 ]; then ok "B7 the retry install PASSES on the cut host"; else bad "B7 retry install still failed" "$out3"; fi

# Idempotence: a second cut on the now-clean host just opens another generation.
set +e
cut_out="$(node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rc4=$?
set -e
if [ "$rc4" = 0 ] && printf '%s' "$cut_out" | grep -q "fresh generation open"; then
  ok "B8 fresh-cut on a clean host is a loud no-op (opens a generation, archives what exists)"
else
  bad "B8 fresh-cut on a clean host failed" "$cut_out"
fi

# ── C. the quiesce gate: a live surface refuses the cut ──────────────────────
echo "[check-fresh-cut-gate] C. quiesce gate"
reset_world prevgen
store_before="$(store_bytes)"
# A sender marker owned by THIS gate's live shell: fresh-cut must refuse it.
start_key="$(node --experimental-strip-types -e '
  import("'"$REPO"'/pi-extensions/lib/meta-session.ts").then((m) => process.stdout.write(m.processStartKey(Number(process.argv[1]))));
' "$$")"
if [ -z "$start_key" ]; then
  bad "C0 could not compute a start key for the gate's own pid — quiesce cells cannot run"
else
  # The REAL sender-marker layout: one backend subdir down (metaSenderMarkerPath).
  mkdir -p "$PI_CODING_AGENT_DIR/meta-senders/claude-code"
  cat > "$PI_CODING_AGENT_DIR/meta-senders/claude-code/$$.json" <<JSON
{
  "backend": "claude-code",
  "gardenId": "20260305T000000-dddd05",
  "nativeSessionId": "prevgen-native-1",
  "cwd": "/tmp/prevgen",
  "ownerPid": $$,
  "ownerStartKey": "$start_key",
  "updatedAt": "2026-03-05T00:00:00.000Z"
}
JSON
  set +e
  cut_out="$(node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rcq=$?
  set -e
  if [ "$rcq" != 0 ]; then ok "C1 fresh-cut REFUSES while a live-owner sender marker exists"; else bad "C1 fresh-cut ran over a live sender marker" "$cut_out"; fi
  case "$cut_out" in
    *Quiesce*|*quiesce*) ok "C2 the refusal prescribes quiescing" ;;
    *) bad "C2 the refusal never told the operator to quiesce" "$cut_out" ;;
  esac
  if [ "$store_before" = "$(store_bytes)" ] && [ -z "$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*')" ]; then
    ok "C3 the refused cut moved nothing"
  else
    bad "C3 the refused cut touched the store or left an archive"
  fi
  rm -f "$PI_CODING_AGENT_DIR/meta-senders/claude-code/$$.json"
fi

# A stale (dead) control socket must NOT block the cut — and gets cleared.
mkdir -p "$ENTWURF_DIR"
node -e '
  const net = require("node:net");
  const s = net.createServer().listen(process.argv[1], () => process.exit(0));
' "$ENTWURF_DIR/20260305T000000-dddd05.sock"
if [ -S "$ENTWURF_DIR/20260305T000000-dddd05.sock" ]; then
  set +e
  cut_out="$(node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rcs=$?
  set -e
  if [ "$rcs" = 0 ]; then ok "C4 a demonstrably dead socket does not block the cut"; else bad "C4 fresh-cut refused on a dead socket" "$cut_out"; fi
  if [ ! -e "$ENTWURF_DIR/20260305T000000-dddd05.sock" ]; then
    ok "C5 the dead socket was cleared with the generation (GC rule: dead only)"
  else
    bad "C5 the dead socket survived the cut"
  fi
else
  bad "C4 could not stage a dead socket file — socket cells cannot run"
fi

# ── D. every activation entrypoint sits behind the gate ──────────────────────
echo "[check-fresh-cut-gate] D. activation entrypoints"
reset_world prevgen
before="$(host_bytes)"
set +e
out="$("$REPO/run.sh" setup "$PROJ" 2>&1)"; rc=$?
set -e
if [ "$rc" != 0 ]; then ok "D1 setup REFUSES a previous-generation host"; else bad "D1 setup ran to completion on a previous-generation host" "$out"; fi
if [ "$before" = "$(host_bytes)" ]; then ok "D2 the refused setup left every persistent regular file unchanged"; else bad "D2 setup mutated the host before refusing"; fi
case "$out" in
  *"Progress: resolved"*|*"Lockfile is up to date"*) bad "D3 setup reached pnpm install before the gate" "$out" ;;
  *) ok "D3 setup refused ahead of dependency install, not after" ;;
esac

# Static order: the gate precedes the first writer in each entrypoint, and the
# preflight never runs the cut on the operator's behalf.
gate_ln=$(grep -n 'preflight_v3_store setup' "$REPO/run.sh" | head -1 | cut -d: -f1) || true
auth_ln=$(awk '/^setup_all\(\)/,/^}/{ if ($0 ~ /^  sync_auth$/) { print NR; exit } }' "$REPO/run.sh")
if [ -n "$gate_ln" ] && [ -n "$auth_ln" ] && [ "$gate_ln" -lt "$auth_ln" ]; then
  ok "D4 setup_all calls the gate before sync_auth (line $gate_ln < $auth_ln)"
else
  bad "D4 setup_all's gate is missing or sits after sync_auth (gate=$gate_ln sync_auth=$auth_ln)"
fi

ilp_gate=$(awk '/^install_local_package\(\)/,/^}/{ if ($0 ~ /preflight_v3_store install/) { print NR; exit } }' "$REPO/run.sh")
ilp_write=$(awk '/^install_local_package\(\)/,/^}/{ if ($0 ~ /register-pi-package.py|mkdir -p "\$project_dir/) { print NR; exit } }' "$REPO/run.sh")
if [ -n "$ilp_gate" ] && [ -n "$ilp_write" ] && [ "$ilp_gate" -lt "$ilp_write" ]; then
  ok "D5 install_local_package gates before its first write (line $ilp_gate < $ilp_write)"
else
  bad "D5 install_local_package's gate is missing or sits after its first write (gate=$ilp_gate write=$ilp_write)"
fi

mb_gate=$(grep -n 'DOCTOR_CMD\[@\]}"' "$REPO/scripts/meta-bridge-install.sh" | head -1 | cut -d: -f1) || true
mb_write=$(grep -n 'meta-bridge-state.py" prepare' "$REPO/scripts/meta-bridge-install.sh" | head -1 | cut -d: -f1) || true
if [ -n "$mb_gate" ] && [ -n "$mb_write" ] && [ "$mb_gate" -lt "$mb_write" ]; then
  ok "D6 meta-bridge-install.sh RUNS the store-doctor before its pre-install state snapshot (line $mb_gate < $mb_write)"
else
  bad "D6 meta-bridge-install.sh's doctor call is missing or sits after the state snapshot (doctor=$mb_gate prepare=$mb_write)"
fi

if grep -n 'preflight_v3_store()' -A 40 "$REPO/run.sh" | grep -qE 'run_ts scripts/meta-bridge-fresh-cut\.ts'; then
  bad "D7 the preflight invokes fresh-cut — an install must never cut a generation by itself"
else
  ok "D7 the preflight only ever asks the doctor (never runs the cut)"
fi

if [ -e "$FRESH_CUT_GATE_CLAUDE_SENTINEL" ]; then
  bad "D8 an offline gate drive crossed the store refusal and invoked Claude" "$(cat "$FRESH_CUT_GATE_CLAUDE_SENTINEL")"
else
  ok "D8 offline source cell made zero Claude invocations (PATH sentinel stayed untouched)"
fi

# ── E. ONE contract: the doctor and the writers certify the same store ───────
# A store certified by the install doctor but written to by the runtime under a
# looser rule is the real defect; these cells pin the two verdicts together on
# each defect that PARSES (drift / duplicate / symlink), where a reader-only
# check is happy and the address space is broken.
echo "[check-fresh-cut-gate] E. doctor ↔ writer symmetry (one active-store contract)"
doctor_run() { node --experimental-strip-types "$REPO/scripts/meta-bridge-store-doctor.ts" 2>&1; }
# The install path reaches the store through the DOCTOR, so a doctor-only cell
# proves only half of "one contract". This drives the other half for real: the pi
# birth seam, the exact function all four identity writers funnel through.
writer_probe() {
  node --experimental-strip-types -e '
    import(process.argv[1] + "/pi-extensions/lib/pi-citizen-birth.ts")
      .then((m) => {
        m.birthPiCitizen({
          nativeSessionId: "gate-writer-probe",
          cwd: "/tmp/proj",
          sessionsDir: process.env.ENTWURF_META_SESSIONS_DIR,
          controlSocketDir: process.env.ENTWURF_DIR,
        });
        process.exit(0);
      })
      .catch((err) => {
        process.stderr.write(`${(err && err.message) || err}\n`);
        process.exit(1);
      });
  ' "$REPO" 2>&1
}
for state in v3 drift dup symlink; do
  case "$state" in v3) want=0 ;; *) want=1 ;; esac
  reset_world "$state"
  store_before="$(store_bytes)"
  set +e
  dout="$(doctor_run)"; drc=$?
  wout="$(writer_probe)"; wrc=$?
  set -e
  if [ "$drc" = "$want" ] && [ "$wrc" = "$want" ]; then
    ok "E/$state the doctor and the WRITER reach the same verdict (both exit $want)"
  else
    bad "E/$state split verdict: doctor=$drc writer=$wrc (wanted $want) — two contracts for one store" "$dout
       --- writer ---
$wout"
  fi
  if [ "$want" = 1 ]; then
    if [ "$store_before" = "$(store_bytes)" ]; then
      ok "E/$state the refused writer left the store byte-untouched (refused BEFORE writing)"
    else
      bad "E/$state the writer mutated the store it was refused on"
    fi
    case "$wout" in
      *"meta-bridge-fresh-cut"*) ok "E/$state the writer's refusal names the fresh-cut verb" ;;
      *) bad "E/$state the writer refused without naming the prescription" "$wout" ;;
    esac
  fi
done
reset_world drift
set +e
dout="$(doctor_run)"
set -e
case "$dout" in
  *"meta-bridge-fresh-cut"*) ok "E5 the doctor's refusal names the one prescription (no per-defect branch)" ;;
  *) bad "E5 the doctor refused without naming fresh-cut" "$dout" ;;
esac

# ── F. quiescence must be PROVEN, not assumed ────────────────────────────────
# The cut is destructive, so every surface it clears must be demonstrably dead.
# A marker we cannot read is not evidence of a departed owner — it is the absence
# of evidence, and it used to be swept as "disposable residue".
echo "[check-fresh-cut-gate] F. quiesce needs proof (uncertain ⇒ REFUSE)"
expect_uncertain_refusal() {
  local label="$1" store_before out rc
  store_before="$(store_bytes)"
  set +e
  out="$(node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rc=$?
  set -e
  if [ "$rc" != 0 ]; then
    ok "$label: fresh-cut REFUSES"
  else
    bad "$label: fresh-cut cut a generation without proving quiescence" "$out"
  fi
  if [ "$store_before" = "$(store_bytes)" ] && [ -z "$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*')" ]; then
    ok "$label: the refused cut archived nothing"
  else
    bad "$label: the refused cut still moved the generation"
  fi
  LAST_CUT_OUT="$out"
}

reset_world prevgen
mkdir -p "$PI_CODING_AGENT_DIR/meta-senders/claude-code"
printf '{broken' > "$PI_CODING_AGENT_DIR/meta-senders/claude-code/999.json"
expect_uncertain_refusal "F1 malformed sender marker"
case "$LAST_CUT_OUT" in
  *UNCERTAIN*) ok "F1b the refusal reports it as UNCERTAIN, distinct from a proven-live surface" ;;
  *) bad "F1b the refusal never distinguished uncertainty from liveness" "$LAST_CUT_OUT" ;;
esac

reset_world prevgen
mkdir -p "$PI_CODING_AGENT_DIR/meta-senders/claude-code"
# Readable JSON, but no ownerStartKey: a bare pid cannot tell an owner from a
# reused pid, so it proves nothing either way.
printf '{ "ownerPid": 999 }' > "$PI_CODING_AGENT_DIR/meta-senders/claude-code/999.json"
expect_uncertain_refusal "F2 sender marker with no ownerStartKey"

reset_world prevgen
mkdir -p "$PI_CODING_AGENT_DIR/meta-receivers" "$SANDBOX/outside"
printf '{ "ownerPid": 1, "ownerStartKey": "linux:1" }' > "$SANDBOX/outside/marker.json"
ln -s "$SANDBOX/outside/marker.json" "$PI_CODING_AGENT_DIR/meta-receivers/20260305T000000-dddd05.json"
expect_uncertain_refusal "F3 symlinked receiver marker"

reset_world prevgen
mkdir -p "$PI_CODING_AGENT_DIR/meta-senders/claude-code"
# A crashed writer's half-marker (the real writer is tmp+rename): it may be the
# partial write of a LIVE owner.
printf '{ "ownerPid": 99' > "$PI_CODING_AGENT_DIR/meta-senders/claude-code/999.deadbeef.tmp"
expect_uncertain_refusal "F4 crashed writer's .tmp half-marker"

reset_world prevgen
mkdir -p "$PI_CODING_AGENT_DIR/meta-senders/claude-code/unexpected"
printf '{ "ownerPid": 1, "ownerStartKey": "linux:1" }' > "$PI_CODING_AGENT_DIR/meta-senders/claude-code/unexpected/deep.json"
expect_uncertain_refusal "F5 entry nested deeper than any marker layout"

# The one shape that IS proof: a marker naming a pid whose start-key no longer
# matches (process exited, or the pid was reused). Here the pid is alive and the
# key is deliberately wrong — the pid-reuse guard's exact case.
reset_world prevgen
mkdir -p "$PI_CODING_AGENT_DIR/meta-senders/claude-code"
# The stale key must be in the SAME coordinate system this host actually mints, or
# the mismatch would be incomparable (uncertain) instead of a death proof — the
# pure classifier owns the cross-scheme rows; this cell owns the same-scheme one.
case "$start_key" in
  linux:*) stale_key="linux:1" ;;
  ps:*)    stale_key="ps:Thu Jan  1 00:00:00 1970" ;;
  *)       stale_key="" ;;
esac
if [ -z "$stale_key" ]; then
  bad "F6 could not derive a same-scheme stale key from this host's own start key ('$start_key')"
else
stale_marker="$PI_CODING_AGENT_DIR/meta-senders/claude-code/$$.json"
cat > "$stale_marker" <<JSON
{
  "backend": "claude-code",
  "gardenId": "20260305T000000-dddd05",
  "ownerPid": $$,
  "ownerStartKey": "$stale_key",
  "updatedAt": "2026-03-05T00:00:00.000Z"
}
JSON
set +e
cut_out="$(node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rcf=$?
set -e
if [ "$rcf" = 0 ]; then
  ok "F6 a marker whose owner start-key no longer matches IS proof of death — the cut proceeds"
else
  bad "F6 the cut refused a provably stale marker (pid-reuse guard inverted)" "$cut_out"
fi
if [ ! -e "$stale_marker" ]; then
  ok "F7 the provably-dead marker was cleared with the generation"
else
  bad "F7 the dead marker survived the cut"
fi
fi

# A marker whose recorded key is NOT a key this repo mints (garbage / truncated /
# foreign writer) while its pid is very much alive: the value differs from the
# current key, and reading that difference as death would archive a live citizen.
reset_world prevgen
mkdir -p "$PI_CODING_AGENT_DIR/meta-senders/claude-code"
cat > "$PI_CODING_AGENT_DIR/meta-senders/claude-code/$$.json" <<JSON
{
  "backend": "claude-code",
  "gardenId": "20260305T000000-dddd05",
  "ownerPid": $$,
  "ownerStartKey": "garbage",
  "updatedAt": "2026-03-05T00:00:00.000Z"
}
JSON
expect_uncertain_refusal "F11 unrecognized start-key on a LIVE owner pid"

# The OTHER dead row, driven for real: a pid that no longer exists at all. Its
# start-key is unreadable (""), so the verdict rests on the pid probe — and only a
# definite "no such process" may answer. `bash -c 'echo $$'` prints the pid of a
# subshell that has already exited.
reset_world prevgen
mkdir -p "$PI_CODING_AGENT_DIR/meta-receivers"
gone_pid="$(bash -c 'echo $$')"
gone_marker="$PI_CODING_AGENT_DIR/meta-receivers/20260305T000000-dddd05.json"
cat > "$gone_marker" <<JSON
{
  "gardenId": "20260305T000000-dddd05",
  "ownerPid": $gone_pid,
  "ownerStartKey": "linux:1",
  "updatedAt": "2026-03-05T00:00:00.000Z"
}
JSON
set +e
cut_out="$(node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rcgone=$?
set -e
if [ "$rcgone" = 0 ] && [ ! -e "$gone_marker" ]; then
  ok "F8 a marker whose pid no longer exists is proven dead — cut proceeds and clears it"
else
  bad "F8 the cut refused (or kept) a marker whose owner pid is provably absent" "$cut_out"
fi

# THE RESIDUE ROW (#53 A, measured on a second Linux host 2026-07-25). A marker
# naming pid 1 is the one shape that is neither live, uncertain nor dead: init runs
# for the whole boot and its start-key does not change while it does, so
# classifyMarkerOwner answers `live` and THE ACTION THE REFUSAL PRESCRIBES cannot
# change that — the operator quiesces every session, as told, and the cut refuses
# again. Yet 0.12.8 refuses install on a pre-v3 store and names THIS cut as the only
# repair, so that host was stuck until the file was removed by hand. The pure
# classifier is right; the marker's claim is refuted by construction (no writer in
# this tree can mint one any more — see the isPlausibleOwnerPid cells in
# check-meta-receiver-marker / check-agy-sender-identity), so it is clearable
# residue. The recorded key must be THIS host's real key for pid 1, or the marker
# would classify `dead` on a key mismatch and the cell would pass while the bug
# lived.
init_key="$(node --experimental-strip-types -e '
  import("'"$REPO"'/pi-extensions/lib/meta-session.ts").then((m) => process.stdout.write(m.processStartKey(1)));
')"
if [ -z "$init_key" ]; then
  bad "F19 SETUP MISS: could not read this host's start key for pid 1 — the residue cells cannot run"
else
for surface in senders receivers; do
  reset_world prevgen
  case "$surface" in
    senders)
      mkdir -p "$PI_CODING_AGENT_DIR/meta-senders/claude-code"
      ghost="$PI_CODING_AGENT_DIR/meta-senders/claude-code/1.json"
      cat > "$ghost" <<JSON
{
  "backend": "claude-code",
  "gardenId": "20260305T000000-dddd05",
  "nativeSessionId": "prevgen-native-1",
  "cwd": "/tmp/prevgen",
  "ownerPid": 1,
  "ownerStartKey": "$init_key",
  "updatedAt": "2026-06-10T16:03:10.000Z"
}
JSON
      ;;
    receivers)
      mkdir -p "$PI_CODING_AGENT_DIR/meta-receivers"
      ghost="$PI_CODING_AGENT_DIR/meta-receivers/20260305T000000-dddd05.json"
      cat > "$ghost" <<JSON
{
  "gardenId": "20260305T000000-dddd05",
  "backend": "claude-code",
  "nativeSessionId": "prevgen-native-1",
  "ownerPid": 1,
  "ownerStartKey": "$init_key",
  "ownerKind": "claude-code-cli",
  "armProvenance": "session-start",
  "updatedAt": "2026-06-10T16:03:10.000Z"
}
JSON
      ;;
  esac
  set +e
  cut_out="$(node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rcr=$?
  set -e
  if [ "$rcr" = 0 ]; then
    ok "F19 an init-owned $surface marker does NOT block the cut (refuted, not live)"
  else
    bad "F19 an init-owned $surface marker still deadlocks the cut — the upgrade path is closed" "$cut_out"
  fi
  if [ ! -e "$ghost" ]; then
    ok "F20 the refuted $surface marker was cleared as residue"
  else
    bad "F20 the refuted $surface marker survived the cut"
  fi
  case "$cut_out" in
    *refuted:*) ok "F21 the cut reports it as REFUTED, distinct from a proven-dead owner ($surface)" ;;
    *) bad "F21 the cut disguised a proof of invalidity as a proof of death ($surface)" "$cut_out" ;;
  esac
done
# The complement, and the reason F19 is a repair rather than a gate bypass: a marker
# whose owner is genuinely live still refuses. C1 holds that for a real live pid; this
# row proves the residue rule did not widen into "any marker the cut dislikes".
if [ -z "$start_key" ]; then
  bad "F22 SETUP MISS: no start key for this gate's own pid — the live-complement cell cannot run"
else
  reset_world prevgen
  mkdir -p "$PI_CODING_AGENT_DIR/meta-senders/claude-code"
  cat > "$PI_CODING_AGENT_DIR/meta-senders/claude-code/$$.json" <<JSON
{
  "backend": "claude-code",
  "gardenId": "20260305T000000-dddd05",
  "ownerPid": $$,
  "ownerStartKey": "$start_key",
  "updatedAt": "2026-03-05T00:00:00.000Z"
}
JSON
  store_before="$(store_bytes)"
  set +e
  cut_out="$(node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rcl=$?
  set -e
  if [ "$rcl" != 0 ] && [ "$store_before" = "$(store_bytes)" ]; then
    ok "F22 a LIVE owner still blocks the cut (the residue rule did not widen)"
  else
    bad "F22 the residue rule widened into a live owner — a running citizen would lose its address" "$cut_out"
  fi
  case "$cut_out" in
    *"LIVE sender marker"*) ok "F22b the live owner is still reported LIVE, never refuted away" ;;
    *) bad "F22b a live owner stopped being reported as live" "$cut_out" ;;
  esac
fi
fi

# POST-CUT CLEANUP IS REPORTED, NOT LAUNDERED. The sweep runs AFTER the archive has
# moved, so a failure there must not throw away the story of what DID happen — and it
# must not be swallowed either, because this command's own output claims the residue
# was `cleared`. A bare `catch {}` around the unlink read EACCES/EROFS/an immutable
# attribute as "raced away" (cross-review 2026-07-25, on the very loop #53 A added).
# ENOENT alone is already-gone; everything else is named and turns the exit nonzero
# while the success lines stay.
if [ -z "$init_key" ]; then
  bad "F23 SETUP MISS: no start key for pid 1 — the cleanup-failure cell cannot seed its marker"
elif [ "$(id -u)" = 0 ]; then
  ok "F23 vacuous under uid 0: permission bits cannot make a directory unwritable for root, so the class this row drives cannot occur here"
else
  reset_world prevgen
  mkdir -p "$PI_CODING_AGENT_DIR/meta-senders/claude-code"
  stuck_dir="$PI_CODING_AGENT_DIR/meta-senders/claude-code"
  stuck="$stuck_dir/1.json"
  cat > "$stuck" <<JSON
{
  "backend": "claude-code",
  "gardenId": "20260305T000000-dddd05",
  "ownerPid": 1,
  "ownerStartKey": "$init_key",
  "updatedAt": "2026-06-10T16:03:10.000Z"
}
JSON
  # r-x: the walk can still readdir + lstat + read the marker, but the unlink needs
  # WRITE on the parent and fails EACCES. Restored right after, or the sandbox trap
  # (and reset_world) could not clean up.
  chmod a-w "$stuck_dir"
  set +e
  cut_out="$(node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rcc=$?
  set -e
  chmod u+w "$stuck_dir"
  if [ "$rcc" != 0 ]; then
    ok "F23 an unremovable marker makes the cut exit NONZERO (a partial sweep never reads as a clean one)"
  else
    bad "F23 the cut reported success while a file it claims to have cleared is still there" "$cut_out"
  fi
  case "$cut_out" in
    *"FAIL post-cut cleanup"*) ok "F23b the failure is NAMED as post-cut cleanup, with the file and the errno" ;;
    *) bad "F23b the unlink failure was laundered into 'raced away'" "$cut_out" ;;
  esac
  if [ -n "$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*')" ]; then
    ok "F23c the archive still happened and is still reported — this is NOT a half-cut"
  else
    bad "F23c a cleanup failure threw away the generation move" "$cut_out"
  fi
  case "$cut_out" in
    *"not a half-cut"*) ok "F23d the refusal tells the operator the store is safe and what to re-run" ;;
    *) bad "F23d the failure left the operator unable to tell a cleanup miss from a half-cut" "$cut_out" ;;
  esac
  rm -f "$stuck"
fi

# WIRING: the cut must ASK for the verdict, never compute it from a start-key. An
# inline `processStartKey(...) === recorded` is precisely how "" (UNKNOWN) was read
# as "dead" before this review — a fail-open path that must not come back.
if grep -q 'classifyMarkerOwner(' "$REPO/scripts/meta-bridge-fresh-cut.ts"; then
  ok "F9 the cut routes its owner verdict through classifyMarkerOwner"
else
  bad "F9 the cut no longer asks classifyMarkerOwner — a second dead-verdict rule has appeared"
fi
if inline_cmp=$(grep -nE 'processStartKey\([^)]*\)[[:space:]]*[=!]==' "$REPO/scripts/meta-bridge-fresh-cut.ts"); then
  bad "F10 the cut compares a start-key inline again (\"\" means UNKNOWN, so this reads unreadable as dead)" "$inline_cmp"
else
  ok "F10 the cut never compares a start-key inline (the fail-open path stays closed)"
fi

# DIRECTORY-level laundering (2026-07-25 second fresh-eyes round): `existsSync`
# answers false for a path it cannot even STAT — an EACCES-blocked ancestor, an
# ENOTDIR path — which read a whole quiesce surface as "absent" and cut straight
# through it. Absent is ENOENT alone, the same rule certifyActiveStoreDir already
# holds one level down. One case per surface input the cut consults: sockets
# (F12), the marker walk (F13), the native-push record walk (F14), and the
# archive plan's mailbox leg (F15) — the one surface with no quiesce row of its
# own, where planning past an unreadable path would rename the store and THEN
# die: a half-cut. The ancestor here is a regular FILE (ENOTDIR), section I's
# driver: deterministic and independent of permission bits root would ignore —
# it takes the same non-ENOENT branch EACCES does.
reset_world prevgen
printf 'not a dir\n' > "$SANDBOX/blocked"
store_before="$(store_bytes)"
set +e
out="$(ENTWURF_DIR="$SANDBOX/blocked/sockets" node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rc=$?
set -e
if [ "$rc" != 0 ]; then
  ok "F12 a socket dir behind an uninspectable ancestor REFUSES the cut"
else
  bad "F12 the cut read an uninspectable socket dir as an absent one and proceeded" "$out"
fi
case "$out" in
  *"UNCERTAIN control socket"*) ok "F12b the refusal names the socket surface as UNCERTAIN" ;;
  *) bad "F12b the refusal does not name the uninspectable socket surface" "$out" ;;
esac
if [ "$store_before" = "$(store_bytes)" ] && [ -z "$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*')" ]; then
  ok "F12c nothing was archived"
else
  bad "F12c the refused cut still moved the generation"
fi
rm -f "$SANDBOX/blocked"

reset_world prevgen
printf 'not a dir\n' > "$SANDBOX/blocked"
store_before="$(store_bytes)"
set +e
out="$(PI_CODING_AGENT_DIR="$SANDBOX/blocked/agent" node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rc=$?
set -e
if [ "$rc" != 0 ] && [ "$store_before" = "$(store_bytes)" ]; then
  ok "F13 marker dirs behind an uninspectable ancestor REFUSE the cut (nothing moved)"
else
  bad "F13 the cut read uninspectable marker dirs as absent ones" "$out"
fi
case "$out" in
  *"UNCERTAIN sender marker"*) ok "F13b the refusal names the marker surface as UNCERTAIN" ;;
  *) bad "F13b the refusal does not name the uninspectable marker surface" "$out" ;;
esac
rm -f "$SANDBOX/blocked"

reset_world absent
printf 'not a dir\n' > "$SANDBOX/blocked"
set +e
out="$(ENTWURF_META_SESSIONS_DIR="$SANDBOX/blocked/store" node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rc=$?
set -e
if [ "$rc" != 0 ] && [ -z "$(find "$SANDBOX" -maxdepth 1 -type d -name '*.archive-*')" ]; then
  ok "F14 a store behind an uninspectable ancestor REFUSES the cut"
else
  bad "F14 the cut read an uninspectable store as an absent one" "$out"
fi
case "$out" in
  *"UNCERTAIN native-push conversation"*) ok "F14b the refusal says why: its citizens cannot be probed" ;;
  *) bad "F14b the refusal does not name the uninspectable store surface" "$out" ;;
esac
rm -f "$SANDBOX/blocked"

reset_world prevgen
printf 'not a dir\n' > "$SANDBOX/blocked"
store_before="$(store_bytes)"
set +e
out="$(ENTWURF_META_MAILBOX_DIR="$SANDBOX/blocked/mailbox" node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rc=$?
set -e
if [ "$rc" != 0 ] && [ "$store_before" = "$(store_bytes)" ] && [ -z "$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*')" ]; then
  ok "F15 an uninspectable mailbox refuses at the PLAN, before the store rename — no half-cut"
else
  bad "F15 the cut planned past an unreadable mailbox (store renamed, then died: a half-cut)" "$out"
fi
case "$out" in
  *"refusing to plan a cut over a surface that cannot be read"*) ok "F15b the refusal names the plan-stage cause" ;;
  *) bad "F15b the refusal does not name the unreadable plan surface" "$out" ;;
esac
rm -f "$SANDBOX/blocked"

# The KIND half of the same contract: lstat SUCCESS is not "present" either. A
# surface name held by a SYMLINK is never walked or renamed — readdir would
# inspect the TARGET while rename would move the LINK, so the cut would
# quiesce-check one thing and archive another. One representative surface (the
# store, where the rename risk is real bytes).
reset_world absent
mkdir -p "$SANDBOX/realstore"
printf '{ leftover' > "$SANDBOX/realstore/20260305T000000-dddd05.meta.json"
ln -s "$SANDBOX/realstore" "$SANDBOX/linkstore"
set +e
out="$(ENTWURF_META_SESSIONS_DIR="$SANDBOX/linkstore" node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rc=$?
set -e
if [ "$rc" != 0 ] && [ -L "$SANDBOX/linkstore" ] && [ -f "$SANDBOX/realstore/20260305T000000-dddd05.meta.json" ]; then
  ok "F16 a SYMLINKED store surface refuses the cut (the link is never walked or renamed)"
else
  bad "F16 the cut walked (or renamed) a symlinked store surface" "$out"
fi
case "$out" in
  *SYMLINK*) ok "F16b the refusal names the symlink kind" ;;
  *) bad "F16b the refusal does not name the symlink" "$out" ;;
esac
rm -rf "$SANDBOX/realstore" "$SANDBOX/linkstore"

# The parent-writability half of the half-cut guard: store and mailbox may live
# under DIFFERENT parents (env overrides), and a readable-but-unwritable parent
# fails only at its own rename — after the store already moved. The plan
# preflights rename-ability per entry, before anything moves. Permission bits
# are a no-op for uid 0, so under root this class cannot occur and the row is
# vacuously green — said out loud rather than silently skipped.
if [ "$(id -u)" = 0 ]; then
  ok "F17 vacuous under uid 0: permission bits cannot make a parent non-writable for root, so the class this row drives cannot occur here"
else
  reset_world prevgen
  mkdir -p "$SANDBOX/roparent/mailbox"
  printf 'msg' > "$SANDBOX/roparent/mailbox/stale.msg"
  chmod 555 "$SANDBOX/roparent"
  store_before="$(store_bytes)"
  set +e
  out="$(ENTWURF_META_MAILBOX_DIR="$SANDBOX/roparent/mailbox" node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rc=$?
  set -e
  chmod 755 "$SANDBOX/roparent"
  if [ "$rc" != 0 ] && [ "$store_before" = "$(store_bytes)" ] && [ -z "$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*')" ]; then
    ok "F17 a non-writable archive parent refuses at the PLAN, before the store rename — no half-cut"
  else
    bad "F17 the cut planned past a non-writable parent (the store would move, then the mailbox rename dies)" "$out"
  fi
  case "$out" in
    *"is not writable"*) ok "F17b the refusal names the non-writable parent" ;;
    *) bad "F17b the refusal does not name the parent-writability cause" "$out" ;;
  esac
  rm -rf "$SANDBOX/roparent"
fi

# The same absent-is-ENOENT-alone rule one level further down: at the ENTRY.
# `readdir` needs only READ on a directory while `lstat` needs SEARCH — different
# bits — so a readable-but-unsearchable socket dir LISTS every socket and then
# fails EACCES on each one. Folding that into "raced away — nothing to cut"
# skipped the whole surface SILENTLY: C4 above proves this exact world cuts when
# the dir is searchable, so flipping one bit must not turn a listener into an
# absence. Permission bits are a no-op for uid 0, so this row declares itself
# vacuous under root rather than passing for the wrong reason.
if [ "$(id -u)" = 0 ]; then
  ok "F18 vacuous under uid 0: permission bits cannot make a directory unsearchable for root, so the class this row drives cannot occur here"
else
  reset_world prevgen
  mkdir -p "$ENTWURF_DIR"
  node -e '
    const net = require("node:net");
    const s = net.createServer().listen(process.argv[1], () => process.exit(0));
  ' "$ENTWURF_DIR/20260305T000000-dddd05.sock"
  if [ -S "$ENTWURF_DIR/20260305T000000-dddd05.sock" ]; then
    chmod 444 "$ENTWURF_DIR"
    store_before="$(store_bytes)"
    set +e
    out="$(node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rc=$?
    set -e
    chmod 755 "$ENTWURF_DIR"
    if [ "$rc" != 0 ] && [ "$store_before" = "$(store_bytes)" ] && [ -z "$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*')" ]; then
      ok "F18 a socket ENTRY that readdir lists but lstat cannot inspect REFUSES the cut (a listener may be live behind it)"
    else
      bad "F18 the cut skipped an uninspectable socket entry and archived the generation under it" "$out"
    fi
    case "$out" in
      *"UNCERTAIN control socket"*) ok "F18b the refusal names the socket surface as UNCERTAIN" ;;
      *) bad "F18b the refusal does not name the uninspectable socket entry" "$out" ;;
    esac
  else
    bad "F18 could not stage a socket file — the entry-level cell cannot run"
  fi
  rm -rf "$ENTWURF_DIR"
fi

# ── G. an archive collision is a NO-OP, never a half-cut ─────────────────────
echo "[check-fresh-cut-gate] G. archive-destination preflight"
reset_world prevgen
mkdir -p "$ENTWURF_META_MAILBOX_DIR/20260305T000000-dddd05"
printf 'hello\n' > "$ENTWURF_META_MAILBOX_DIR/20260305T000000-dddd05/0001.msg"
store_before="$(store_bytes)"
# Occupy the MAILBOX destination — the second move in the plan — for this second
# and the next two, so whichever stamp the cut computes, its first move looks free
# and its second collides. That ordering is the whole point: checking each
# destination just before its own rename archived the store, then refused.
for off in 0 1 2; do
  mkdir -p "$SANDBOX/mailbox.archive-$(date -d "+$off seconds" +%Y%m%dT%H%M%S)"
done
set +e
out="$(node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1)"; rcg=$?
set -e
if [ "$rcg" != 0 ]; then
  ok "G1 an occupied archive destination REFUSES the cut"
else
  bad "G1 the cut proceeded into an occupied destination" "$out"
fi
if [ -z "$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*')" ] && [ "$store_before" = "$(store_bytes)" ]; then
  ok "G2 the collision refusal moved NOTHING — the store never left its place (no half-cut generation)"
else
  bad "G2 half-cut generation: the store was archived before the mailbox collision was seen"
fi
case "$out" in
  *"Nothing was moved"*) ok "G3 the refusal states its own no-op guarantee" ;;
  *) bad "G3 the refusal never claimed the no-op" "$out" ;;
esac

# ── H. the MARKER-LESS live surface: native-push conversations ───────────────
# A socket+marker walk is not the whole world. `entwurf_register_native` proves an
# agy conversation is alive and then writes ONLY the record (register.ts 보정①: no
# receiver marker), and the v2 decider dispatches to it straight off that record
# (nativePushProbe(identity)) with no marker in the path. So marker ABSENCE is the
# normal state of a fully deliverable agy citizen — and a cut that reads quiescence
# from markers alone archived a live conversation's address (found by the 2026-07-25
# fresh-eyes review, GPT's cell ①).
#
# The three probe rows are driven for real through fakes, never asserted from prose:
# the adapter takes its host scan from `pgrep`/`ss` on PATH and its metadata call from
# $AGY_BIN, so a PATH-local fake pins each row deterministically — including DEAD,
# which must not depend on whether the operator running `pnpm check` happens to have
# agy open.
echo "[check-fresh-cut-gate] H. native-push conversations (the marker-less surface)"
mkdir -p "$SANDBOX/npfake"
cat > "$SANDBOX/npfake/ss" <<'SH'
#!/bin/sh
echo 'LISTEN 0 128 127.0.0.1:41234 0.0.0.0:* users:(("agy",pid=4242,fd=7))'
SH
cat > "$SANDBOX/npfake/agy-serves" <<'SH'
#!/bin/sh
echo '{"conversationMetadata":{"id":"agy-conv-live"}}'
SH
cat > "$SANDBOX/npfake/agy-serves-nothing" <<'SH'
#!/bin/sh
exit 1
SH
chmod +x "$SANDBOX/npfake"/*
np_host() { # $1 = live|absent|broken — what the fake `pgrep -x agy` reports
  case "$1" in
    live)   printf '#!/bin/sh\necho 4242\n' > "$SANDBOX/npfake/pgrep" ;;
    absent) printf '#!/bin/sh\nexit 1\n' > "$SANDBOX/npfake/pgrep" ;;
    # 127 = the runner's spawn-failure code (pgrep not on PATH). The scan did not run;
    # that is NOT pgrep's exit 1 ("no such process").
    broken) printf '#!/bin/sh\nexit 127\n' > "$SANDBOX/npfake/pgrep" ;;
  esac
  chmod +x "$SANDBOX/npfake/pgrep"
}
np_cut() { env PATH="$SANDBOX/npfake:$PATH" AGY_BIN="$SANDBOX/npfake/$1" node --experimental-strip-types "${FRESH_CUT[@]}" 2>&1; }
seed_agy() {
  mkdir -p "$ENTWURF_META_SESSIONS_DIR"
  # A live agy citizen as register_native leaves it: a v3 record and NO marker anywhere.
  cat > "$ENTWURF_META_SESSIONS_DIR/20260406T000000-aaaa06.meta.json" <<'JSON'
{
  "schemaVersion": 3,
  "gardenId": "20260406T000000-aaaa06",
  "backend": "antigravity",
  "nativeSessionId": "agy-conv-live",
  "cwd": "/tmp/proj",
  "model": null,
  "transcriptPath": null,
  "createdAt": "2026-04-06T00:00:00.000Z",
  "recordUpdatedAt": "2026-04-06T00:00:00.000Z"
}
JSON
}

# H1 — the conversation's host is gone: the ONE row that may cut. This is also the
# escape hatch that keeps the policy usable — quiescing agy (what the refusal asks
# for) is exactly what makes the cut legal, so no agy record can trap an operator.
reset_world empty; seed_agy
np_host absent
set +e
out="$(np_cut agy-serves)"; rc=$?
set -e
if [ "$rc" = 0 ] && [ -n "$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*')" ]; then
  ok "H1 an agy record whose host process is gone does NOT block the cut (dead is a probe answer, not an assumption)"
else
  bad "H1 the cut refused a provably hostless agy conversation — the quiesce escape hatch is closed" "$out"
fi

# H2 — the bug this section exists for: LIVE conversation, no marker, no socket.
reset_world empty; seed_agy
store_before="$(store_bytes)"
np_host live
set +e
out="$(np_cut agy-serves)"; rc=$?
set -e
if [ "$rc" != 0 ]; then
  ok "H2 a LIVE agy conversation with NO marker REFUSES the cut"
else
  bad "H2 the cut archived a live marker-less agy conversation's address" "$out"
fi
case "$out" in
  *LIVE*native-push*) ok "H2b the refusal names it as a LIVE native-push surface (not a generic marker line)" ;;
  *) bad "H2b the refusal never named the native-push surface" "$out" ;;
esac
if [ "$store_before" = "$(store_bytes)" ] && [ -z "$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*')" ]; then
  ok "H2c the refused cut moved nothing (the live citizen keeps its address)"
else
  bad "H2c the store moved despite a live native-push conversation"
fi

# H3 — host up, but nothing serves this conversation: absence of proof, not death.
reset_world empty; seed_agy
np_host live
set +e
out="$(np_cut agy-serves-nothing)"; rc=$?
set -e
if [ "$rc" != 0 ] && [ -z "$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*')" ]; then
  ok "H3 an agy conversation that probes INDETERMINATE refuses the cut (fail-closed, same rule as the socket)"
else
  bad "H3 an unprovable native-push conversation was treated as dead" "$out"
fi
case "$out" in
  *UNCERTAIN*) ok "H3b it is reported UNCERTAIN, distinct from a proven-live conversation" ;;
  *) bad "H3b the indeterminate probe was not reported as uncertainty" "$out" ;;
esac

# H4 — the ONE record this walk passes over, and the reason it may. A previous-
# generation agy record is unreadable by every live read path (readMetaIdentityByGardenId,
# resolveTarget, the sender-marker trust each throw), so nothing can dispatch to it: its
# bytes are unreachable address, not a live connection. Proven with the host reporting
# LIVE — if the walk ever probed what it cannot parse, this would refuse forever.
reset_world empty
mkdir -p "$ENTWURF_META_SESSIONS_DIR"
cat > "$ENTWURF_META_SESSIONS_DIR/20260407T000000-bbbb07.meta.json" <<'JSON'
{
  "schemaVersion": 2,
  "gardenId": "20260407T000000-bbbb07",
  "backend": "antigravity",
  "nativeSessionId": "agy-conv-live",
  "cwd": "/tmp/proj",
  "createdAt": "2026-04-07T00:00:00.000Z",
  "recordUpdatedAt": "2026-04-07T00:00:00.000Z"
}
JSON
np_host live
set +e
out="$(np_cut agy-serves)"; rc=$?
set -e
if [ "$rc" = 0 ]; then
  ok "H4 an UNREADABLE agy record does not block the cut (no read path can reach that citizen)"
else
  bad "H4 a record the live schema cannot read blocked the cut — a previous generation would be uncuttable" "$out"
fi

# H6 — a host scan that could not RUN must not read as a departed host. This is the
# second half of "dead is a proof": the adapter used to fold every nonzero pgrep exit
# into "no matching process", so a missing/broken pgrep would have handed the cut a
# `dead` verdict for a conversation nobody ever looked for.
reset_world empty; seed_agy
np_host broken
set +e
out="$(np_cut agy-serves)"; rc=$?
set -e
if [ "$rc" != 0 ] && [ -z "$(find "$SANDBOX" -maxdepth 1 -type d -name 'store.archive-*')" ]; then
  ok "H6 a FAILED host scan refuses the cut (a broken probe is not proof of death)"
else
  bad "H6 a failed host scan was read as a dead conversation and the cut proceeded" "$out"
fi
case "$out" in
  *UNCERTAIN*scan*) ok "H6b the refusal says the SCAN failed (not that the conversation is gone)" ;;
  *) bad "H6b the refusal did not name the failed scan" "$out" ;;
esac

# H5 — WIRING: the verdict must come from the adapter probe the DISPATCH uses. A cut
# that re-implemented liveness (or asked only about markers) is the regression.
if grep -q 'resolveNativePushAdapter(' "$REPO/scripts/meta-bridge-fresh-cut.ts" &&
   grep -q 'nativePushSupported(' "$REPO/scripts/meta-bridge-fresh-cut.ts"; then
  ok "H5 the cut asks the same native-push adapter probe the v2 decider dispatches on"
else
  bad "H5 the cut no longer routes native-push liveness through the adapter probe"
fi

# ── I. an unreadable store takes the OPPOSITE prescription ───────────────────
# The doctor now separates "certification defects" (exit 1 → fresh-cut) from "the store
# could not be read" (exit 3 → repair access/path). This section guards the thing that
# actually gets acted on: the LAST line of the refusal. Both callers used to end every
# refusal with "archive the generation with fresh-cut" regardless of cause, so an
# unreadable store sent the operator — or an agent following the final instruction — at a
# command guaranteed to fail on the same errno (2026-07-25 fresh-eyes review).
#
# ENOTDIR is the driver: a store PATH that is a regular file. Deterministic, and it takes
# the same errno branch EACCES does (only ENOENT means "absent"), so the cell does not
# depend on a permission bit that root would ignore.
echo "[check-fresh-cut-gate] I. an unreadable store is not an uncertified one"
reset_world absent
printf 'not a store\n' > "$ENTWURF_META_SESSIONS_DIR"
before="$(host_bytes)"
set +e
out="$("$REPO/run.sh" install "$PROJ" 2>&1)"; rc=$?
set -e
if [ "$rc" != 0 ]; then
  ok "I1 install REFUSES a store it cannot read"
else
  bad "I1 install proceeded on a store it could not read" "$out"
fi
case "$out" in
  *"could not be READ"*) ok "I2 the refusal names the ACCESS cause, not a defect count" ;;
  *) bad "I2 the refusal did not name the access failure" "$out" ;;
esac
# The test is whether the refusal NAMES THE VERB as the thing to run — not whether the
# words "fresh-cut" appear at all. Saying "a fresh-cut CANNOT fix it" is the correct
# warning; printing `meta-bridge-fresh-cut` as the next command is the bug.
case "$out" in
  *meta-bridge-fresh-cut*) bad "I3 the refusal still names the cut verb as the next command" "$out" ;;
  *) ok "I3 the refusal never names the cut verb as the fix (the one place that advice is wrong)" ;;
esac
case "$out" in
  *"ACCESS problem"*) ok "I4 it says which kind of problem this is, in the doctor's own words" ;;
  *) bad "I4 the refusal never distinguished access from generation" "$out" ;;
esac
if [ "$before" = "$(host_bytes)" ]; then
  ok "I5 the refusal left every persistent regular file unchanged"
else
  bad "I5 the access refusal mutated the host"
fi

# I6 — the OTHER caller, driven for real. The defect this section exists for was that
# BOTH install preflights ended every refusal with the cut verb, so pinning only
# `run.sh install` leaves half of it unguarded: D6 checks that the doctor runs before the
# state snapshot, not what the refusal finally advises. `meta-bridge-install.sh` takes no
# argv and its store gate sits ahead of both the Claude CLI gate and the state snapshot,
# so the sandbox can drive it directly.
reset_world absent
printf 'not a store\n' > "$ENTWURF_META_SESSIONS_DIR"
before="$(host_bytes)"
claude_lines() { if [ -f "$FRESH_CUT_GATE_CLAUDE_SENTINEL" ]; then wc -l < "$FRESH_CUT_GATE_CLAUDE_SENTINEL"; else echo 0; fi; }
claude_before="$(claude_lines)"
set +e
out="$(bash "$REPO/scripts/meta-bridge-install.sh" 2>&1)"; rc=$?
set -e
if [ "$rc" != 0 ]; then
  ok "I6 meta-bridge-install.sh REFUSES a store it cannot read"
else
  bad "I6 the packaged install path proceeded on a store it could not read" "$out"
fi
case "$out" in
  *"could not be READ"*) ok "I6b its refusal names the ACCESS cause too" ;;
  *) bad "I6b the second caller did not name the access failure" "$out" ;;
esac
case "$out" in
  *meta-bridge-fresh-cut*) bad "I6c the second caller still names the cut verb as the fix" "$out" ;;
  *) ok "I6c the second caller never names the cut verb either (both callers, one rule)" ;;
esac
if [ "$claude_before" = "$(claude_lines)" ]; then
  ok "I6d it refused ahead of any Claude contact (PATH sentinel untouched)"
else
  bad "I6d the refusal reached the Claude CLI before refusing"
fi
if [ "$before" = "$(host_bytes)" ]; then
  ok "I6e no user config was touched"
else
  bad "I6e the packaged install path mutated the host before refusing"
fi

# I7/I8 — a doctor CRASH is not a store verdict. The doctor's EXIT CONTRACT says
# only 1 is a defect list and only 3 is an access verdict; both callers used to
# fold every other nonzero (usage 2, node crash 9/134/139) into "certification
# defects" and prescribe the destructive cut from a crash over a store nobody
# examined. Driver: a PATH node shim that crashes ONLY the doctor invocation
# (exit 9 = node's own bad-option code) and execs the real node for everything
# else — deterministic, root-independent, and the seeded store is one the real
# doctor would CERTIFY, so the refusal provably comes from the crash.
REAL_NODE="$(command -v node)"
cat > "$SANDBOX/fakebin/node" <<SH
#!/bin/sh
case "\$*" in
  *meta-bridge-store-doctor*) echo "simulated doctor crash (gate I7/I8)" >&2; exit 9 ;;
esac
exec "$REAL_NODE" "\$@"
SH
chmod +x "$SANDBOX/fakebin/node"

reset_world v3
before="$(host_bytes)"
set +e
out="$("$REPO/run.sh" install "$PROJ" 2>&1)"; rc=$?
set -e
if [ "$rc" != 0 ]; then
  ok "I7 a doctor crash (unknown exit) refuses install"
else
  bad "I7 install proceeded although the doctor never delivered a verdict" "$out"
fi
case "$out" in
  *meta-bridge-fresh-cut*) bad "I7b a doctor crash still prescribed the cut verb" "$out" ;;
  *) ok "I7b no cut prescription from a crash (a crash is not a store verdict)" ;;
esac
case "$out" in
  *"store-doctor itself FAILED"*) ok "I7c the refusal names the doctor failure, with its exit code" ;;
  *) bad "I7c the refusal does not name the doctor failure" "$out" ;;
esac
if [ "$before" = "$(host_bytes)" ]; then
  ok "I7d nothing was written"
else
  bad "I7d the crash refusal mutated the host"
fi

reset_world v3
before="$(host_bytes)"
claude_before="$(claude_lines)"
set +e
out="$(bash "$REPO/scripts/meta-bridge-install.sh" 2>&1)"; rc=$?
set -e
if [ "$rc" != 0 ]; then
  ok "I8 meta-bridge-install.sh refuses on a doctor crash too"
else
  bad "I8 the packaged install path proceeded although the doctor never delivered a verdict" "$out"
fi
case "$out" in
  *meta-bridge-fresh-cut*) bad "I8b the second caller still prescribed the cut verb from a crash" "$out" ;;
  *) ok "I8b the second caller never prescribes the cut from a crash (both callers, one rule)" ;;
esac
case "$out" in
  *"store-doctor itself FAILED"*) ok "I8c its refusal names the doctor failure too" ;;
  *) bad "I8c the second caller does not name the doctor failure" "$out" ;;
esac
if [ "$claude_before" = "$(claude_lines)" ] && [ "$before" = "$(host_bytes)" ]; then
  ok "I8d it refused ahead of any Claude contact and touched no user config"
else
  bad "I8d the crash refusal reached the Claude CLI or mutated the host"
fi
rm -f "$SANDBOX/fakebin/node"

# I9 — guard the doctor entry the mode actually RUNS. An installed package ships
# `scripts/` (so the SOURCE .ts is present) while a broken prepack can leave the
# COMPILED twin missing; there `run_ts` returns its OWN 1, indistinguishable from
# the doctor's exit 1 "certification defects" — so the rc branch prescribed the
# destructive cut from an artifact failure. meta-bridge-install.sh was already
# immune because it guards the entry it runs; run.sh checked the .ts in both modes.
# Smallest fixture that reaches the branch: a node_modules-shaped tree carrying the
# source but no dist twin, with the gate function called directly (check-pack-install
# owns the full installed-package lane — this row must not grow into a second one).
fake_pkg="$SANDBOX/nm/node_modules/@junghanacs/entwurf"
mkdir -p "$fake_pkg/scripts"
cp "$REPO/run.sh" "$fake_pkg/run.sh"
cp "$REPO/scripts/meta-bridge-store-doctor.ts" "$fake_pkg/scripts/"
set +e
out="$(RUNSH="$fake_pkg/run.sh" bash -c 'set --; source "$RUNSH" >/dev/null; preflight_v3_store install' 2>&1)"; rc=$?
set -e
if [ "$rc" != 0 ]; then
  ok "I9 an installed tree missing the COMPILED doctor twin refuses the step"
else
  bad "I9 the step proceeded although the doctor entry it would run does not exist" "$out"
fi
case "$out" in
  *meta-bridge-fresh-cut*) bad "I9b an ARTIFACT failure still prescribed the cut verb (run_ts's own exit 1 read as a defect list)" "$out" ;;
  *) ok "I9b no cut prescription from a missing doctor artifact (both callers, one rule)" ;;
esac
case "$out" in
  *"ARTIFACT failure"*) ok "I9c the refusal names the artifact failure, not a store verdict" ;;
  *) bad "I9c the refusal does not name the artifact cause" "$out" ;;
esac
rm -rf "$SANDBOX/nm"

echo
echo "[check-fresh-cut-gate] passed=$PASSED failed=$FAILED"
[ "$FAILED" = 0 ] || exit 1
echo "[check-fresh-cut-gate] SOURCE cell green — an UNCERTIFIABLE generation refuses activation before writing and names fresh-cut in both invocation forms, while an INACCESSIBLE store refuses too and names access repair instead; the cut archives the generation behind a quiesce gate that also sees the marker-less native-push surface; and the retry lands."
