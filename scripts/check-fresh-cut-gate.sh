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
# refusal moves nothing.
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

echo
echo "[check-fresh-cut-gate] passed=$PASSED failed=$FAILED"
[ "$FAILED" = 0 ] || exit 1
echo "[check-fresh-cut-gate] SOURCE cell green — activation refuses an unreadable store before writing, names fresh-cut in both forms, the cut archives the generation behind a quiesce gate, and the retry lands."
