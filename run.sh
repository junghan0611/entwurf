#!/usr/bin/env bash
#
# Model id convention (see AGENTS.md Hard Rule #1):
#   - User-facing examples use the qualified form `entwurf/<backend-model>`
#     (e.g. `entwurf/claude-sonnet-4-6`); the prefix routes to this provider
#     so `--provider` is redundant and is dropped in docs.
#   - Smoke helpers that feed `ensureBridgeSession({modelId})` directly (cancel,
#     model-switch) pass BARE backend ids (`claude-sonnet-4-6`, `gpt-5.4`)
#     because the bridge library contract is bare. Smoke helpers that invoke pi
#     via the CLI still pin `--provider entwurf` and can accept either
#     bare or qualified model, but we keep bare here to match the bridge-level
#     dispatch tables.
#
set -euo pipefail

REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR_DEFAULT=$(pwd)
TARGET_PROJECT_DIR=${2:-$PROJECT_DIR_DEFAULT}
# npm publish identity. Scoped 2026-05-18 — bare `entwurf` was not on npm
# and we adopted the same `@junghanacs` scope as the OpenClaw plugin sibling
# (`@junghanacs/openclaw-entwurf`) for source-of-origin parity. This
# variable documents intent; check-pack-install hardcodes the tarball name
# and install path against the same scope for traceability.
PACKAGE_NAME="@junghanacs/entwurf"
# Runtime provider id — DO NOT change. Embedded in model strings
# (`entwurf/claude-sonnet-4-6`), settings keys (`entwurfProvider`),
# log prefixes (`[entwurf:bootstrap]`), and the `--provider entwurf`
# CLI surface. Renaming this would break every consumer transcript and every
# saved session anchor.
PROVIDER_ID="entwurf"

usage() {
  cat <<'EOF'
Usage:
  ./run.sh setup [project-dir]        # pnpm install + sync auth + install + v2 install smoke (entwurf-bridge only; LIVE substrate = release-gate)
  ./run.sh release-gate [project-dir] [--allow-skip-gemini]  # SINGLE release gate: full static (pnpm check) + the v2-native live gates (v2 matrix/spawn-resume-live, check-bridge, retargeted smoke-session-id-name, RGG) + the ACP plugin acceptance floor (10 LIVE smokes: socket-citizen/raw-turn/overlay/provider/session-reuse/carrier-augment/rgg/mcp/skill/bundled-mcp). TWO-TIER summary: MUST (release-blocking, owns the exit code — "green" applies here) + BEHAVIOR (advisory, non-blocking: RGG positives model-in-loop turn). LIVE-gated MUST steps HONEST-SKIP when LIVE!=1 (a CUT needs LIVE=1, SKIP=0). v1 verbs (xt-tool-surface, session-messaging, sentinel) are gone (v2 core); --allow-skip-gemini accepted-but-ignored (back-compat). final cut authorization is GLG's.
  ./run.sh xt-tool-surface             # [LEGACY — broken on v2-only, dropped from release floor, v2 rewrite pending] ACP backend exclude-tools policy: -xt <builtin> fail-fast per backend
  ./run.sh check-bridge               # entwurf-bridge direct MCP smoke + protocol/negative-path test.sh (live substrate = v2 live smokes)
  ./run.sh check-entwurf-bridge-boot # deterministic gate (5d-5-pre, G1a/G1b, IN pnpm check): boot start.sh under strip-types + assert v2 fence graph loads + entwurf_v2 registered/schema; tools/list only, no auth/side-effect
  ./run.sh sentinel [args...]         # [LEGACY — broken on v2-only, dropped from release floor, v2 rewrite pending] ACP multi-backend 6-cell tool-selection matrix
  ./run.sh session-messaging [args...] # [LEGACY — broken on the v2 core (v1 entwurf_send tool gone), not on the release floor, v2 rewrite pending] 4-case session-messaging smoke
  ./run.sh check-model-lock           # deterministic unit test for pi-extensions/model-lock.ts (4-quadrant + edge cases, no API)
  ./run.sh check-shell-quote          # POSIX-safety gate for shellQuote (remote SSH arg quoting in entwurf paths) — source parity + behavior matrix, no SSH
  ./run.sh check-entwurf-session-identity # deterministic gate for locked garden session identity & name grammar (sessionId/buildSessionName/parse/collision), no API
  ./run.sh check-meta-session          # deterministic gate (#30 step 2): meta-record mint/serialize/parse + scanByNativeId body-authority + idempotent decideUpsert, no API
  ./run.sh check-meta-record-v2        # deterministic golden gate (0.11 Stage 0 step 3A): synthetic v1 fixture → normalizeMetaIdentity v2 identity golden + dual-read version fences, no API
  ./run.sh check-mailbox-receipt-state # deterministic gate (0.11 Stage 0 step 3B): mailbox receipt state schema + store (stamp→persist→read-back) in a temp mailbox, strict keyset, no API
  ./run.sh check-entwurf-capabilities  # deterministic gate (0.11 Stage 0 step 3C): backend capability registry (pi/entwurf-capabilities.json) — coverage==META_BACKENDS_V2 + agrees with live META_BACKEND_DESCRIPTORS + strict keyset, no API
  ./run.sh check-meta-dual-read        # deterministic gate (0.11 Stage 0 step 3D-1): v2 write shape (serializeMetaIdentity) + dual-read dispatcher (parseMetaRecordAny/parseMetaIdentity) + write→read round-trip, pure, no API
  ./run.sh check-meta-mailbox-state-write # deterministic gate (0.11 Stage 0 step 3D-4 commit2): post-cut receipt is state-only — meta-record file byte-identical across enqueue/read, state carries lastEnqueuedAt/lastReadAt (field isolation), empty inbox no-op on record+state, drift surfaces; no API
  ./run.sh check-meta-receiver-marker # deterministic gate (SE-2 slice 2b): meta-receiver presence marker — write/read round-trip garden-id keyed + atomic 0600, dead-owner start-key guard reads null, armProvenance limited to arm-capable events (UserPromptSubmit can't mint presence), reader doesn't gate on record existence
  ./run.sh check-meta-migration        # deterministic gate (0.11 Stage 0 step 3D-4 commit2): v1→v2 delivery-receipt migration (per-field state-wins, 3 timestamps, no-op when nothing to fill) + crash-order inside upsert (migrate before v2 rewrite; drift throws with record still v1), no API
  ./run.sh check-meta-dual-consumers   # deterministic gate (0.11 Stage 0 step 3D-4): delivery-agnostic dual-read seam — readMetaIdentityByGardenId + scanIdentityByNativeId read v1 AND v2, cross-schema duplicate = ambiguity throw (G1); v1-only raw readers remain for v1-fixture gates, no API
  ./run.sh check-meta-capability-source # deterministic gate (0.11 Stage 0 step 3D-3): capability-source cut-over — mint/parse read wakeMode/deliveryLevel from the registry (metaCapabilityFor, registry-driven via injection), not META_BACKEND_DESCRIPTORS; behaviour-preserving (registry ≡ const), slot stays (3D-4), no API
  ./run.sh check-socket-probe          # deterministic gate (0.11 Stage 0, F3): three-valued control-socket liveness (alive|dead|indeterminate) — GC reclaims dead only, indeterminate survives; pure classify + 2-socket integration, no API
  ./run.sh check-project-trust-handler # deterministic gate (0.11 Stage 0, Trust 2층): project_trust handler — decideProjectTrust matrix (escape=inherited-false+interactive+trust-here→{yes,remember:true}; non-interactive→undecided; never undefined) + adapter single-writer, fake prompt, no UI
  ./run.sh check-entwurf-v2-contract   # deterministic gate (0.11 Stage 0 step 4-pre, 동결결정 10 + Fable R1-R5): FROZEN entwurf_v2 contract — R1 backend liveness domain (pi only; claude/codex/agy=unsupported, not folded), 6-cell intent×liveness table (single verdict, 2 allow/4 reject), N1 indeterminate-no-spawn, Q2 owned-live-no-autosend, R3 table↔receipt round-trip, R5 taxonomy, schema↔types drift; pure, no API
  ./run.sh check-entwurf-v2-lock       # deterministic gate (0.11 Stage 0 step 5a, 버킷 B F2): per-gid dispatch LOCK primitive — openSync wx atomic acquire, second-acquire=target-locked conflict (holder JSON for human cleanup), nonce-owned release (successor survives late release), stale reclaim same-host+ESRCH-only (EPERM/remote/alive/unknown fail-closed), empty/corrupt=conflict not auto-deleted, F2-P1 malformed gid throws; real temp dir, deps injected
  ./run.sh check-entwurf-v2-decider    # deterministic gate (0.11 Stage 0 step 5b): PURE dispatch decider decideDispatch — frozen 7-step order over injected fakes, lock acquire+release tracked so reject⇒no-plan-no-lock proven; pre-probe rejects observedLiveness=null, send/resume execute keep lock + mailbox no-lock (？7), resume plan no mode/provider/model, invalid gid throws (F2-P1); pure, no IO
  ./run.sh check-entwurf-v2-matrix     # deterministic gate (0.11 Stage 0 step 5d-5 a): REACHABILITY + LOCK SSOT table — drives REAL decideDispatch over fakes, fixes every (target kind → transport → lock class) cell as one table (control-socket/meta-mailbox/spawn-bg + bad-target/conflict/locked/undeliverable/owned-live/dormant/indeterminate rejects), coverage pass fails on a dropped cell; thin coverage not a decider re-impl; pure, no IO
  ./run.sh check-entwurf-v2-release    # deterministic gate (0.11 Stage 0 step 5c-1): PURE release-policy reducer (decideReleasePolicy + reduceRelease) — Fable-3 release-after-observation as a state machine; spawn-started is NOT a release event, release on first socket-alive ∨ child-exited (any code) or failed start, socket↔exit race idempotent (single release), lock-nullness invariant enforced; pure, no IO
  ./run.sh check-entwurf-v2-send       # deterministic gate (0.11 Stage 0 step 5c-2a): control-socket SEND hand (executeControlSocketSend) wiring transport IO onto the 5c-1 reducer — ack→sent, in-band reject→rejected (no fallback), dead→same-lock one-shot re-resolve (control retry / mailbox enqueue), indeterminate→failed+rethrow with NO fallback (no double-delivery); release exactly once, releaseLock throw never masks the send error; IO-via-dep
  ./run.sh check-entwurf-v2-send-fallback # deterministic gate (0.11 Stage 0 step 5c-2b): same-lock re-resolve RESOLVER (resolveDeadControlSendFallback) — fire-and-forget re-resolve: alive→control retry, dead→reject (NEVER spawn-bg), indeterminate→reject, unsupported+deliverable→mailbox plan, undeliverable/bad-target/conflict→reject; resolver never releases, mis-wire fails loud, inspect/probe throws propagate; no IO (fakes)
  ./run.sh check-entwurf-v2-runner     # deterministic gate (0.11 Stage 0 step 5d-1): execute-router (executeDispatch) routing an already-decided DispatchDecision to its 5c transport hand → one outcome-rich EntwurfV2RunResult. reject→rejected (no hand) / control/spawn/mailbox→matching hand with decision.lock verbatim / spawn lock-retained rides executed (fail-closed) / N3 rejectReason carried / N1 SendDeliveredReleaseFailedError→execution-failed{finalizedOutcome,releaseFailed,retrySafe:false}; fake hands, no IO
  ./run.sh check-entwurf-v2-mailbox    # deterministic gate (0.11 Stage 0 step 5c-4, LAST 5c transport slice): ENQUEUE-ONLY meta-mailbox SEND body (executeMetaMailboxSend) + production sendViaMailbox adapter — sender→formatMetaMailboxBody with plan.wantsReply threaded (divergence from legacy hard false), sender absent→raw plan.message, enqueue opts EXACTLY {gardenId,body,sessionsDir,mailboxDir}, enqueue throw PROPAGATES (no success:false fold — mailbox has no in-band refuse); adapter NEVER touches lock (release is the hand's job); source guard: no release/routing seam
  ./run.sh check-entwurf-v2-spawn      # deterministic gate (0.11 Stage 0 step 5c-3a): spawn-bg RESUME watcher hand (executeSpawnBgResume) wiring spawn + socket-observe IO onto the 5c-1 reducer — Fable-3: TIMEOUT IS NOT A RELEASE (bare observeTimeout→killChild, release 0; bounded killGrace then real socket-alive ∨ child-exited releases ×1); spawnChild throw→spawn-start-failed; no observation obtainable (grace elapses / post-spawn watch dep throws)→lock-retained fail-closed (released:false, evidence surfaced), NO direct-release hatch; IO-via-dep, controlled promises
  ./run.sh check-entwurf-resume-args   # deterministic gate (0.11 Stage 0 step 5c-3b): resume-argv SSOT (buildResumePiArgs) shared by the legacy async worker and the v2 spawn-bg resident citizen — A1: legacy=--no-extensions + no --entwurf-control (one-shot pi -p exits), v2-control=--entwurf-control + no --no-extensions (keep-alive is the goal, resumed session stays addressable); BOTH keep --mode json -p + prompt-as-turn (-p NOT dropped in v2); explicitExtensionArgs preserved once (#29); v2 includes plan.launchArgs (--approve); null provider→no --provider; no cross-contamination
  ./run.sh check-entwurf-v2-spawn-production # deterministic gate (0.11 Stage 0 step 5c-3c): production SpawnBgResumeDeps factory (makeProductionSpawnBgResumeDeps) wiring the 5c-3a watcher's 6 IO seams — no real pi/socket/timer (that=opt-in smoke-entwurf-v2-spawn-live, OUT of pnpm check). socketWatchVerdict: address-conflict→forged (reject, never wait)/alive→alive/dead·indeterminate→wait; spawnChild builds v2-control argv (--entwurf-control, no --no-extensions, -p+prompt, --approve, cwd authority); awaitSocketAlive connectable→resolve / symlink→reject without connect / dead→wait→alive / abort-clears; awaitChildExit code + listener cleanup; awaitTimeout schedule + abort-clear; killChild=SIGTERM; proc-less child fails loud
  ./run.sh smoke-entwurf-v2-spawn-live # LIVE phase gate (0.11 Stage 0 step 5c-3c, D5) — OUT of pnpm check, needs LIVE=1. Exercises the production SpawnBgResumeDeps against REAL OS objects: S1 real unix socket → awaitSocketAlive resolves (real lstat+probe), symlink→forged, absent→abort settles; S2 real child → spawn-event resolve + SIGTERM kill + exit-code capture; S3 watcher integration → real timeout→kill→child-exited→release ×1. Does NOT spawn a real pi resume (that=5d matrix). Run before 5d: LIVE=1 ./run.sh smoke-entwurf-v2-spawn-live
  ./run.sh smoke-entwurf-v2-spawn-resume-live # 0.11.0 (A) ACCEPTANCE gate — OUT of pnpm check, needs LIVE=1. The FULL spawn-bg resident lifecycle: mint backend=pi identity → seed a REAL dormant pi session (one-shot into ~/.pi/agent/sessions) → runEntwurfV2(owned-outcome) routes dormant→spawn-bg resume → a REAL detached pi --entwurf-control child stands its socket up, resumes, DOES a model turn. Asserts executed/spawn-bg/socket-alive/released + lock released ×1 + no lock file + pid alive + socket connectable + resume USER & assistant OK nonces in the session JSONL. Model-in-loop IN. The gate v1 deprecation (0.12) is predicated on. Model: PI_SHELL_ACP_LIVE_TARGET=<provider>/<model> (default openai-codex/gpt-5.4). LIVE=1 ./run.sh smoke-entwurf-v2-spawn-resume-live
  ./run.sh smoke-entwurf-v2-matrix-live # LIVE sentinel (0.11 Stage 0 step 5d-5, D4-b) — OUT of pnpm check, needs LIVE=1. Drives REAL production runEntwurfV2 deps over REAL OS objects, 4 cells: C1 control-socket (real pi --entwurf-control resident → RPC send → lock acquire→release ×1), C1b socket-only (record-less live pi → control-socket sent / owned→bad-target, A1 narrow), C2 meta-mailbox deliverable (armed self-fetch citizen → real .msg enqueue, lock-free), C3 meta-mailbox guard (no armed receiver → reject, no garbage). Model-in-loop OUT (transport/lock/enqueue gate, GPT Q2); negative/timeout stay deterministic. Model: PI_SHELL_ACP_LIVE_TARGET=<provider>/<model> (default openai-codex/gpt-5.4). LIVE=1 ./run.sh smoke-entwurf-v2-matrix-live
  ./run.sh check-entwurf-facts         # deterministic gate (0.11 Stage 0 step 4, fact-provider slice 1+2): PURE PeerFact core + resolveFactList union — R1 out-of-domain→unsupported, R3b pi 4-value, facts-only keyset; union: PeerFact+SocketOnlyFact by gardenId, dormant→dead, F3 indeterminate preserved, non-pi+socket fail-loud; pure, no IO
  ./run.sh check-socket-discovery      # deterministic gate (0.11 Stage 0 step 4, fact-provider slice 3): SOCKET-axis scanSocketProbes — probes (dir sockets) ∪ (in-domain citizen canonical paths) 3-valued; dormant citizen no-file → dead (resumable, not unprobed), stall → indeterminate (F3), dir hygiene/dedup/missing-dir + e2e → resolveFactList; readdir/probe injected, no IO
  ./run.sh check-meta-listing          # deterministic gate (0.11 Stage 0 step 4, fact-provider slice 4a): META-STORE axis listAllMetaIdentities — explicit-partial: parse failure / body-filename drift → explicit {filename,message} error (verbatim, no synthetic fields), valid records still listed (corrupt doesn't blind); mode strict throws / collect partial; entries/readRecord injected, no IO
  ./run.sh check-entwurf-fact-provider # deterministic gate (0.11 Stage 0 step 4, fact-provider slice 4b): ASSEMBLY listEntwurfFacts — listAllMetaIdentities→scanSocketProbes→pre-quarantine non-pi/socket conflicts→resolveFactList(clean)→{facts,diagnostics}; C-원칙: expected corruption (parse/collision)→diagnostics (listing survives), impossible invariant (dup/unprobed)→throw; collision quarantines BOTH PeerFact+socket; deps injected, no IO
  ./run.sh check-entwurf-peers-surface # deterministic gate (0.11 Stage 0 step 4, fact-provider slice 4c): MCP entwurf_peers RENDER renderEntwurfPeers — legacy `sessions` = projection of facts (alive only, no 2nd scan), socketPath via controlSocketPath (SSOT), count=projection length, three distinct arrays, NO verb-routing key (JSON deep scan) NOR word (text), diagnostics both surfaces, empty→(none), unsupported shown, enrich→(not enriched); WIRING guard: bridge calls provider+render, getLiveSessions gone; facts fabricated, no IO
  ./run.sh check-entwurf-self-address # deterministic gate (SE-1/SE-2 slice 1): self-addressability honesty predicate computeSelfAddressability — pi replyable ⟺ live socket; meta ⟺ recordBacked ∧ ownerAlive ∧ watchArmed (regression-proof record-present rows); SOURCE GUARD buildStrictPiSenderEnvelope drops hardcoded replyable:true + existsSync-probes socket, entwurf_self renders alive vs expected. meta watchArmed wired in slice 2 (same release block)
  ./run.sh check-entwurf-deliverability # deterministic gate (SE-1/SE-2 slice 2c): conversational-mailbox deliverability predicate — computeMetaReceiverActive (recordBacked ∧ ownerAlive ∧ watchArmed) + mailboxConversationalDeliverable (self-fetch AND active); direct-inject pi refused (SE-1), self-fetch dead/unarmed refused (SE-2); self-address shares the same atom
  ./run.sh check-entwurf-mailbox-guard # deterministic gate (SE-1/SE-2 slice 2d): guarded mailbox enqueue — PURE 0-call (undeliverable target leaves injected enqueue uncalled) + TMPDIR snapshot (refused send leaves mailbox byte-identical, accepted writes one .msg) + fact gathering from record/capability/receiver-marker
  ./run.sh check-package-source-routing # deterministic gate (#29): package-source -> install-root mapping + fail-fast routing (local/git/npm/missing/project/no-source × local+remote, self-root, resume), no backend
  ./run.sh smoke-session-id-name      # live 3-turn substrate smoke (Phase 3a): Pi 0.78 --session-id/--name through the bridge — header id/cwd, session_info name, append-not-recreate, spawn-only name, wrong-cwd footgun evidence
  ./run.sh new-session-id             # print one fresh garden-native session id for operator launchers (--session-id)
  ./run.sh smoke-resident-garden-guard # live resident --entwurf-control garden guard (negative 0-token; SMOKE_RGG_POSITIVE=1 for positive)
  ./run.sh smoke-meta-async-drift     # 1.0.0 meta-bridge step 1: drift sentinel — version pins + Claude binary undocumented-behavior markers (LIVE=1 adds plugin watch-arm probe)
  ./run.sh smoke-meta-honesty         # 1.0.0 meta-bridge: honesty regression gate (#30 blockers) — doorbell counts ALL msgs honestly + hook logs failures as ERROR (best-effort, no scream). Offline/deterministic (deps: bash+node+python3)
  ./run.sh smoke-meta-install-state   # 1.0.0 meta-bridge Phase 2: stateful install/uninstall + store-doctor regression gate. Offline/deterministic (deps: bash+node+python3)
  ./run.sh smoke-meta-prune           # 1.0.0 meta-bridge Phase 4: listing-only store janitor regression gate — classify keep/orphan/stale/ambiguous, delete nothing. Offline/deterministic (deps: bash+node)
  ./run.sh smoke-meta-keyset-guard    # 0.10.0 meta-bridge: keyset-owner guard regression — check-keyset-overlap + managed-keys SSOT (disjoint passes, collisions fail). Offline/hermetic (deps: bash+python3)
  ./run.sh smoke-meta-sender-identity # 0.10.0 meta-bridge: native SENDER identity E2E — parent-pid sender marker promotes anonymous MCP send to replyable meta-session (garden-id), REQUIRE_META_SENDER refuses anonymous. Offline/hermetic (deps: bash+node+python3)
  ./run.sh smoke-claude-native-resume-live # LIVE-only: Claude Code native fresh→--resume continuity + meta-record uniqueness; proves meta-bridge records identity without touching the backend resume path

  ./run.sh install-meta-bridge        # 1.0.0 meta-bridge Phase 2: stateful GLOBAL install (plugin + USER MCP + settings keyset, honest uninstall state)
  ./run.sh uninstall-meta-bridge      # 1.0.0 meta-bridge Phase 2: stateful GLOBAL uninstall (restore only keys/items captured in install-state)
  ./run.sh doctor-meta-bridge         # 1.0.0 meta-bridge Phase 2: fail-loud doctor — toolchain + state + plugin/MCP + store scan + hook errors + SessionStart evidence + writer-version parity (source↔assembled↔installed: FAIL on a stale deployed meta-record writer)
  ./run.sh meta-bridge-prune          # 1.0.0 meta-bridge Phase 4: LISTING-ONLY store hygiene — classify orphan/stale/ambiguous/keep, print manual rm commands, delete NOTHING ([dir] [--ttl-days N])
  ./run.sh meta-bridge-managed-keys   # 0.10.0 meta-bridge: print the SSOT of settings keys entwurf OWNS (consumers read this to stay disjoint — keyset-owner invariant)
  ./run.sh check-keyset-overlap <fragment.json...>  # 0.10.0 meta-bridge: PREVENTIVE keyset guard — fail if a consumer fragment collides with any pi-owned key (cross-repo; not in pnpm check)
  ./run.sh check-dep-versions         # local deterministic check that version pins (package.json/run.sh/README.md + pi devDeps/peer pins) agree
  ./run.sh check-pack                 # publish gate (dry-run): npm pack --dry-run + tarball invariants (runtime-critical present, dev residue absent)
  ./run.sh check-pack-install         # heavy publish gate (prepublishOnly): actual npm pack + tar -tf + fresh-temp install smoke with 0.79.x peers
  ./run.sh sync-auth                  # copy ~/.pi/agent/auth.json anthropic OAuth credentials to entwurf alias
  ./run.sh install [project-dir]      # install this local package into project .pi/settings.json
  ./run.sh setup:links [--force]      # repair ~/.pi/agent/entwurf-targets.json link (use --force to replace a stale operator file or wrong symlink; a .bak is taken)
  ./run.sh remove [project-dir]       # remove entwurf entries from project .pi/settings.json

Notes:
  - project-dir defaults to current directory
  - Claude Code login should already exist (e.g. ~/.claude.json)
  - setup's runtime verification is the v2 install smoke (entwurf-bridge); the v2 dispatch substrate is proven live by release-gate
  - API key is optional; this bridge is intended to work with Claude Code auth
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing command: $1" >&2
    exit 1
  }
}

log()  { echo "  $*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠ $*"; }
fail() { echo "  ❌ $*"; }
section() { echo ""; echo "=== $* ==="; }

normalize_project_dir() {
  python3 - "$1" <<'PY'
import os, sys
print(os.path.abspath(os.path.expanduser(sys.argv[1])))
PY
}

sync_auth() {
  local auth_path="$HOME/.pi/agent/auth.json"
  python3 - "$auth_path" "$PROVIDER_ID" <<'PY'
import json, os, sys
from pathlib import Path

auth_path = Path(sys.argv[1]).expanduser()
provider_id = sys.argv[2]
auth_path.parent.mkdir(parents=True, exist_ok=True)

if auth_path.exists():
    data = json.loads(auth_path.read_text())
    if not isinstance(data, dict):
        raise SystemExit("auth.json is not an object")
else:
    data = {}

anthropic = data.get("anthropic")
if not isinstance(anthropic, dict):
    print("sync-auth: skipped (no anthropic OAuth credentials in ~/.pi/agent/auth.json)")
    raise SystemExit(0)

before = json.dumps(data.get(provider_id), sort_keys=True)
after = json.dumps(anthropic, sort_keys=True)
if before == after:
    print(f"sync-auth: already synced ({provider_id})")
    raise SystemExit(0)

data[provider_id] = anthropic
backup = auth_path.with_suffix(auth_path.suffix + ".bak")
if auth_path.exists():
    backup.write_text(auth_path.read_text())
auth_path.write_text(json.dumps(data, indent=2) + "\n")
print(f"sync-auth: wrote {provider_id} alias to {auth_path}")
if backup.exists():
    print(f"sync-auth: backup -> {backup}")
PY
}

install_local_package() {
  local project_dir
  project_dir=$(normalize_project_dir "$1")
  mkdir -p "$project_dir/.pi"
  python3 - "$project_dir/.pi/settings.json" "$REPO_DIR" <<'PY'
import json, sys
from pathlib import Path

settings_path = Path(sys.argv[1])
repo_dir = str(Path(sys.argv[2]).resolve())
settings_path.parent.mkdir(parents=True, exist_ok=True)
if settings_path.exists():
    data = json.loads(settings_path.read_text())
    if not isinstance(data, dict):
        raise SystemExit("settings.json is not an object")
else:
    data = {}

# --- packages[] registration --------------------------------------------------
packages = data.get("packages")
if not isinstance(packages, list):
    packages = []

filtered = []
for item in packages:
    source = item.get("source") if isinstance(item, dict) else item
    if isinstance(source, str) and ("entwurf" in source) and source != repo_dir:
        continue
    filtered.append(item)

if repo_dir not in filtered:
    filtered.append(repo_dir)

data["packages"] = filtered

# --- entwurfProvider.mcpServers bundled entries ---------------------------
# Ship the two in-repo MCP adapters pre-wired so `pi install` produces a
# working setup without the consumer hand-editing settings.json. User-authored
# overrides (different command/args) are preserved untouched.
provider = data.setdefault("entwurfProvider", {})
if not isinstance(provider, dict):
    raise SystemExit("entwurfProvider is not an object")
servers = provider.setdefault("mcpServers", {})
if not isinstance(servers, dict):
    raise SystemExit("entwurfProvider.mcpServers is not an object")

BUNDLED = ("entwurf-bridge",)
# 0.4.14: session-bridge MCP was retracted (issue #7 — unified entwurf surface).
# Install path now only wires entwurf-bridge. Existing operator settings that
# carry the old bundled session-bridge entry are pruned below during install;
# `./run.sh remove` also keeps session-bridge in its cleanup tuple so legacy
# entries are removed on uninstall too.
for name in BUNDLED:
    desired_cmd = f"{repo_dir}/mcp/{name}/start.sh"
    desired = {"command": desired_cmd, "args": []}
    existing = servers.get(name)
    if existing is None:
        servers[name] = desired
        print(f"install: added entwurfProvider.mcpServers.{name}")
    elif isinstance(existing, dict) and existing.get("command") == desired_cmd:
        # Already managed by us at the current repo path. Add the default args
        # field when missing, but never overwrite user-customized args.
        if "args" not in existing:
            existing["args"] = []
            print(f"install: normalized entwurfProvider.mcpServers.{name}.args -> []")
        elif existing.get("args") != []:
            print(f"install: preserved entwurfProvider.mcpServers.{name}.args (custom args)")
    else:
        cmd_repr = existing.get("command") if isinstance(existing, dict) else existing
        print(f"install: preserved entwurfProvider.mcpServers.{name} (user override: {cmd_repr})")

# Legacy-bundled MCP names that prior versions of this installer wrote and that
# the current cutover supersedes. One-shot install-time prune (NOT a runtime
# alias): only remove entries whose command matches the bundled start.sh path,
# so user-customized commands are left alone.
#   - session-bridge: retracted in 0.4.14 (issue #7, unified entwurf surface).
#   - pi-tools-bridge: renamed to entwurf-bridge in 0.11 S2 cutover.
LEGACY_BUNDLED = {
    "session-bridge": "retracted in 0.4.14, issue #7",
    "pi-tools-bridge": "renamed to entwurf-bridge in 0.11 S2 cutover",
}
for name, reason in LEGACY_BUNDLED.items():
    existing = servers.get(name)
    if not isinstance(existing, dict):
        continue
    cmd = existing.get("command")
    if not isinstance(cmd, str):
        continue
    if cmd == f"{repo_dir}/mcp/{name}/start.sh" or cmd.endswith(f"/entwurf/mcp/{name}/start.sh"):
        del servers[name]
        print(f"install: pruned legacy entwurfProvider.mcpServers.{name} ({reason})")

settings_path.write_text(json.dumps(data, indent=2) + "\n")
print(f"install: updated {settings_path}")
print(f"install: package source -> {repo_dir}")
PY
  ensure_agent_dir_symlinks
}

# Ensure agent-level resources that entwurf code reads from
# ~/.pi/agent/ are wired up at install time. Currently:
#   - entwurf-targets.json — pi-extensions/lib/entwurf-core.ts reads
#     ~/.pi/agent/entwurf-targets.json. The package ships the canonical
#     version at $REPO_DIR/pi/entwurf-targets.json. Without this symlink
#     any entwurf tool call throws EntwurfRegistryError (lazy load — no
#     surface during plain `pi --model ...` runs but blocks delegation
#     immediately when the operator first calls entwurf).
#
# Fail-fast policy (added v0.5.0): drift between canonical and the
# operator's link/file is treated as a bug to fix, not noise to preserve.
# The v0.4.x oracle install regression came from a stale operator-copied
# entwurf-targets.json that previous installs silently kept "as operator
# file"; the only signal was a sentinel failure several minutes later.
#
# Two explicit exits are honored:
#   1. `./run.sh setup:links --force` — back up + overwrite with canonical
#   2. `PI_ENTWURF_TARGETS_PATH=/path/to/custom.json` — tells entwurf-core
#      to read elsewhere, freeing this slot from any policy obligation
#
# Idempotent for the happy path. Lazy registry load means a corrected
# file/symlink is picked up on the next entwurf call without restarting
# pi or the MCP bridge process.
ensure_agent_dir_symlinks() {
  local agent_dir="$HOME/.pi/agent"
  mkdir -p "$agent_dir"

  local target="$REPO_DIR/pi/entwurf-targets.json"
  local link="$agent_dir/entwurf-targets.json"
  local force="${1:-}"

  if [ ! -f "$target" ]; then
    fail "canonical registry missing at $target — repo install is broken"
    exit 1
  fi

  if [ -L "$link" ]; then
    local current
    current=$(readlink "$link")
    if [ "$current" = "$target" ]; then
      return 0  # already correct, silent
    fi
    if [ "$force" = "--force" ]; then
      rm -f "$link"
      ln -s "$target" "$link"
      echo "install: relinked $link -> $target (was -> $current)"
      return 0
    fi
    fail "stale entwurf-targets symlink at $link"
    echo "       points to: $current" >&2
    echo "       expected:  $target" >&2
    echo "       Fix with one of:" >&2
    echo "         ./run.sh setup:links --force      # relink to canonical" >&2
    echo "         export PI_ENTWURF_TARGETS_PATH=$current  # honor your override explicitly" >&2
    exit 1
  fi

  if [ -e "$link" ]; then
    if cmp -s "$link" "$target"; then
      return 0  # operator copy is byte-identical to canonical, silent
    fi
    if [ "$force" = "--force" ]; then
      local backup="${link}.bak.$(date +%Y%m%d-%H%M%S)"
      mv "$link" "$backup"
      ln -s "$target" "$link"
      echo "install: replaced stale $link with symlink -> $target (backup: $backup)"
      return 0
    fi
    fail "stale entwurf-targets file at $link (drifts from canonical)"
    echo "       canonical: $target" >&2
    echo "       diff (link vs canonical):" >&2
    diff -u "$link" "$target" | sed 's/^/         /' >&2 || true
    echo "       Fix with one of:" >&2
    echo "         ./run.sh setup:links --force      # back up + replace with symlink to canonical" >&2
    echo "         export PI_ENTWURF_TARGETS_PATH=$link  # honor your file as an explicit override" >&2
    exit 1
  fi

  ln -s "$target" "$link"
  echo "install: linked $link -> $target"
}

remove_local_package() {
  local project_dir
  project_dir=$(normalize_project_dir "$1")
  python3 - "$project_dir/.pi/settings.json" "$REPO_DIR" <<'PY'
import json, sys
from pathlib import Path

settings_path = Path(sys.argv[1])
repo_dir = str(Path(sys.argv[2]).resolve())
if not settings_path.exists():
    print(f"remove: nothing to do ({settings_path} missing)")
    raise SystemExit(0)

data = json.loads(settings_path.read_text())
if not isinstance(data, dict):
    raise SystemExit("settings.json is not an object")

# --- packages[] cleanup -------------------------------------------------------
packages = data.get("packages")
pkg_removed = 0
if isinstance(packages, list):
    filtered = []
    for item in packages:
        source = item.get("source") if isinstance(item, dict) else item
        if isinstance(source, str) and ("entwurf" in source):
            pkg_removed += 1
            continue
        filtered.append(item)
    data["packages"] = filtered

# --- entwurfProvider.mcpServers cleanup ------------------------------------
# Only remove entries that look like they came from ./run.sh install: either
# the command matches the current $REPO_DIR anchor exactly, or it ends with
# the bundled "/entwurf/mcp/<name>/start.sh" pattern (covers a rebuilt
# checkout under a different directory). Anything else is treated as a user
# override and left in place.
BUNDLED = ("entwurf-bridge", "session-bridge", "pi-tools-bridge")
provider = data.get("entwurfProvider")
mcp_removed = 0
if isinstance(provider, dict):
    servers = provider.get("mcpServers")
    if isinstance(servers, dict):
        for name in BUNDLED:
            existing = servers.get(name)
            if not isinstance(existing, dict):
                continue
            cmd = existing.get("command")
            if not isinstance(cmd, str):
                continue
            exact = cmd == f"{repo_dir}/mcp/{name}/start.sh"
            pattern = cmd.endswith(f"/entwurf/mcp/{name}/start.sh")
            if exact or pattern:
                del servers[name]
                mcp_removed += 1
                print(f"remove: removed entwurfProvider.mcpServers.{name}")
            else:
                print(f"remove: preserved entwurfProvider.mcpServers.{name} (user override: {cmd})")
        if not servers:
            provider.pop("mcpServers", None)
    if not provider:
        data.pop("entwurfProvider", None)

settings_path.write_text(json.dumps(data, indent=2) + "\n")
print(f"remove: removed {pkg_removed} packages[] entries, {mcp_removed} mcpServers entries from {settings_path}")
PY
}

check_model_lock() {
  # Deterministic policy unit test for pi-extensions/model-lock.ts.
  # No pi process, no network, no API cost. Mocks ExtensionAPI/Context and
  # drives the model_select handler through every quadrant + edge case
  # (see scripts/check-model-lock.ts header for the full matrix).
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-model-lock.ts)
}

check_shell_quote() {
  # POSIX-safety gate for the shellQuote helper used in remote SSH command
  # builders (entwurf.ts + entwurf-core.ts). Verifies source-string parity
  # across the two duplication sites AND behavioral correctness on the
  # payload classes that caused the 2026-05-18 remote entwurf incident
  # (backtick / $(...) / $VAR / korean tokens). No process spawn, no SSH.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-shell-quote.ts)
}

check_entwurf_session_identity() {
  # Deterministic gate for the locked garden session identity & name grammar
  # (NEXT.md "Locked — session identity & name grammar"): sessionId validator,
  # buildSessionName/parseSessionName round-trip incl. `.`-bearing registry
  # models, titleSlug canonicalization, registry exact-tuple membership, name=
  # info-only invariants, and header-scan collision pre-check. Isolates registry
  # + sessions base to a temp dir. No backend, no API, no spawn.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-session-identity.ts)
}

check_meta_session() {
  # Deterministic gate for the 1.0.0 meta-bridge record authority (#30 step 2):
  # mint/serialize/parse round-trip + crash-on-malformed, scanByNativeId lookup
  # authority BY RECORD BODY (not filename, proven with a decoy filename in a
  # real temp dir), idempotent existence-keyed decideUpsert + identity-drift
  # refusal, and the pre-drilled read-receipt mutators. Pure functions; no
  # backend, no hook, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-meta-session.ts)
}

check_meta_record_v2() {
  # Deterministic golden gate for 0.11 Stage 0 step 3A: the v1→v2 identity
  # normalize seam. A synthetic, sanitized v1 fixture normalizes to a
  # hand-written v2 identity literal (golden), plus dual-read version fences
  # and v2 field-contract crashes. Reader/normalizer only — no v2 writer yet.
  # Kept separate from check-meta-session so 3D's v1-gate rewrites leave this
  # back-compat golden untouched. Pure functions; no backend, no hook, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-meta-record-v2.ts)
}

check_mailbox_receipt_state() {
  # Deterministic gate for 0.11 Stage 0 step 3B: the mailbox receipt state
  # schema + store — the new home for the read-receipt before v2 drops
  # record.delivery (NEXT.md 고정순서 4). Pure schema round-trip + strict
  # keyset, then the fs store (stamp → persist → read-back) in a temp mailbox
  # dir. Schema/store only — no live enqueue/read dual-write (that is 3D). No
  # backend, no hook, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-mailbox-receipt-state.ts)
}

check_entwurf_capabilities() {
  # Deterministic gate for 0.11 Stage 0 step 3C: the backend capability source
  # (pi/entwurf-capabilities.json) — the new home for wakeMode/deliveryLevel/
  # nativeIdLabel before v2 drops them from the record (frozen decision 1).
  # Asserts coverage == META_BACKENDS_V2 (pi included), agreement with the live
  # META_BACKEND_DESCRIPTORS for the three existing backends (drift guard), and
  # strict keyset/coverage/field crashes. Parser/gate only — no live routing,
  # no record/descriptor consumer change (that is 3D). No backend, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-capabilities.ts)
}

check_meta_dual_read() {
  # Deterministic gate for 0.11 Stage 0 step 3D-1: the v2 write shape
  # (serializeMetaIdentity) + the dual-read dispatcher (parseMetaRecordAny /
  # parseMetaIdentity). Canonical serialize + round-trip + version dispatch +
  # unknown-version crash. Pure functions only — no fs upsert wiring, no
  # readMetaInbox/enqueueMetaMessage change, no record.delivery removal (3D-2/3/4).
  # No backend, no hook, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-meta-dual-read.ts)
}

check_meta_mailbox_state_write() {
  # Deterministic gate for 0.11 Stage 0 step 3D-4 commit2 (the cut). Renamed from
  # check-meta-mailbox-dualwrite: after the cut the receipt is no longer dual-written
  # (record.delivery is gone from the v2 record) — it lives SOLELY in the mailbox
  # state store. Asserts the meta-record FILE is byte-identical before/after enqueue
  # AND read (enqueue/read no longer touch the record — invariant ⑤), the state
  # carries lastEnqueuedAt/lastReadAt with field isolation, lastDeliveredAt is never
  # invented, an empty inbox is a no-op on BOTH record and state (⑥), and a state
  # drift surfaces fail-loud. v2 citizen seeded via upsertMetaSession. No API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-meta-mailbox-state-write.ts)
}

check_meta_receiver_marker() {
  # Deterministic gate for the meta-receiver presence marker (SE-2 slice 2b). The
  # active-receiver signal a self-fetch backend (Claude Code) needs: a meta-record
  # proves a session once existed; this marker proves a live watch owner is still
  # there to be woken, so a terminated session's lingering record does not read as a
  # ghost active receiver (mailbox garbage). Asserts: write→read round-trip keyed by
  # GARDEN id, atomic 0600; dead-owner/pid-reuse start-key guard reads null (distinct
  # from "no marker"); armProvenance constrained to the arm-capable events so
  # UserPromptSubmit cannot mint presence; reader does NOT gate on record existence
  # (recordBacked is the deliverability predicate's fact). Real tmpdir, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-meta-receiver-marker.ts)
}

check_meta_migration() {
  # Deterministic gate for 0.11 Stage 0 step 3D-4 commit2: the v1→v2 delivery-receipt
  # migration (migrateV1DeliveryReceipts) + its crash-order inside upsert. Per-field
  # STATE WINS, 3 timestamps only; v1-all-null / state-already-wins are no-ops (no
  # state.json). Crash-order: a v1 record's receipts migrate to state BEFORE the v2
  # rewrite (proven via upsert attach), and a drift'd state makes migrate throw with
  # the record STILL v1 (recoverable: next attach re-migrates). Temp dir, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-meta-migration.ts)
}

check_meta_dual_consumers() {
  # Deterministic gate for 0.11 Stage 0 step 3D-4: the delivery-agnostic dual-read
  # seam. readMetaIdentityByGardenId + scanIdentityByNativeId read v1 AND v2 records and
  # return normalized identity, so the live consumers (enqueue/read, MCP marker, prune,
  # store-doctor, the v2 upsert's existence scan) survive the v2 cut. Proves cross-schema
  # match + THE G1 invariant (a nativeSessionId duplicated across a v1 AND v2 file is
  # authority ambiguity → throw, so the v2 upsert never duplicate-mints) + v1 normalize +
  # body/filename drift fail-fast. The v1-only raw readers remain for v1-fixture gates.
  # Temp dir, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-meta-dual-consumers.ts)
}

check_meta_capability_source() {
  # Deterministic gate for 0.11 Stage 0 step 3D-3: the capability-source cut-over.
  # mint/parse now read backend honesty metadata (wakeMode/deliveryLevel) from the
  # capability registry (3C) via metaCapabilityFor, NOT META_BACKEND_DESCRIPTORS.
  # Proves the seam is registry-DRIVEN (a doctored registry injection is followed),
  # mint sources delivery metadata through it, the parse drift guard is now
  # registry-sourced, and the cut-over preserves behaviour (registry ≡ const for the
  # 3 backends). The record.delivery.wakeMode SLOT stays (removal is 3D-4); only the
  # SOURCE moves. check-entwurf-capabilities still owns the registry ≡ const drift
  # guard. Pure — no fs writes, no backend, no hook, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-meta-capability-source.ts)
}

check_socket_probe() {
  # Deterministic gate for 0.11 Stage 0 (F3 fix): three-valued control-socket
  # liveness. classifyConnectError is a pure boundary (ECONNREFUSED/ENOENT →
  # dead; timeout/EACCES/unknown → indeterminate). GC reclaims dead only;
  # indeterminate (a load-stalled live socket) survives the sweep — the F3
  # invariant. Listing lists alive only. Pure classify + GC/listing policy +
  # a two-socket integration (live listener → alive survives; nonexistent →
  # dead GC-eligible). No wire timeout fixture, no backend, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-socket-probe.ts)
}

check_project_trust_handler() {
  # Deterministic gate for 0.11 Stage 0 (Trust 2층 active-prompt escape): the
  # project_trust handler. Pure decideProjectTrust over real preflight outcomes —
  # approve/trusted-no-arg→{yes,remember:false}; direct distrust→{no}; inherited
  # distrust + interactive + "trust-here"→{yes,remember:true} (THE escape, beats
  # the ancestor false); non-interactive (pi -p / rpc)→{undecided}, never prompts;
  # never undefined. Plus the thin adapter: fake ctx.ui.select, single-writer
  # (handler never calls store.set — pi persists on remember:true), F5a evidence
  # in the prompt title. No real UI, no backend, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-project-trust-handler.ts)
}

check_entwurf_v2_contract() {
  # Deterministic gate for 0.11 Stage 0 step 4-pre: the FROZEN entwurf_v2
  # contract (동결결정 10 + 버킷 B F1/F4/F6 + Fable R1-R5). The intent×liveness
  # decision table is a constant; the "table cell ↔ dispatch receipt" round-trip
  # is asserted exhaustively — THE executable proof F6 demands ("산문 금지").
  # R1 backend liveness domain (pi only; claude-code/codex/antigravity =
  # unsupported, never folded into dead/indeterminate). 6-cell table, single
  # verdict per cell (Q2), 2 allow / 4 reject. N1 indeterminate never spawns;
  # Q2 owned-outcome+live never auto-sends. R5 taxonomy covers table reasons +
  # pre-claims bad-target/untrusted-fail-fast/target-locked (bucket B F2). Plus
  # a schema↔types drift guard on the TypeBox input/receipt. Pure, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-contract.ts)
}

check_entwurf_v2_lock() {
  # Deterministic gate for 0.11 Stage 0 step 5a (버킷 B F2): the per-gid dispatch
  # LOCK primitive — the only guard against a double-spawn of the same dormant
  # target (pi self-guards CREATE but not RESUME, 검증원장 F2). acquire =
  # openSync(lockPath,"wx") atomic; a second acquire without release =
  # target-locked conflict carrying the holder JSON (F2-P2 human cleanup). release
  # = unlink ONLY when the on-disk nonce is still ours (a successor's re-acquire
  # survives a late release). Stale reclaim ONLY for same host + ESRCH; EPERM
  # (other user's live pid) / different host / alive pid / unknown error all
  # fail-closed to conflict. Empty/corrupt lockfile = conflict, never
  # auto-deleted. F2-P1: a malformed gid throws before any path is built. Real
  # temp dir (wx atomicity under test); clock/nonce/pid/host/kill injected.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-lock.ts)
}

check_entwurf_v2_decider() {
  # Deterministic gate for 0.11 Stage 0 step 5b: the PURE dispatch decider
  # decideDispatch. Drives the frozen 7-step order over INJECTED fakes (target
  # lookup / lock / socket inspect+probe / preflight / capability), tracking lock
  # acquire+release so "reject ⇒ no plan AND no lock retained" is PROVEN. Covers:
  # bad-target/target-locked/target-address-conflict carry observedLiveness=null
  # (pre-probe), every other reject + untrusted-fail-fast carry a measured value;
  # control-socket send + spawn-bg resume execute KEEP the lock, meta-mailbox send
  # takes NO lock (？7); resume plan has no mode/wantsReply/provider/model but has
  # expectedSocketPath/observeTimeoutMs/releaseWhen; an invalid gid throws before
  # any lookup (F2-P1). Pure, no IO, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-decider.ts)
}

check_entwurf_v2_matrix() {
  # Deterministic gate for 0.11 Stage 0 step 5d-5 (a): the REACHABILITY + LOCK SSOT
  # TABLE. Drives the REAL decideDispatch over minimal injected fakes and fixes, as
  # one readable table, every (target kind → transport → lock class) cell the 5d-5
  # claim covers: bad-target/address-conflict/target-locked rejects, unsupported
  # meta-mailbox (deliverable) vs mailbox-undeliverable (inactive) vs owned reject,
  # in-domain control-socket (live) / spawn-bg (dormant owned) / released rejects
  # (owned-live, ff-dormant, indeterminate, under-lock conflict). A coverage pass
  # FAILS if any transport / lock class / pre-probe reject is missing — a dropped
  # decider cell cannot pass silently. Thin coverage, NOT a decider re-impl; surface
  # parity stays in check-entwurf-v2-surface. Pure, no IO, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-matrix.ts)
}

check_entwurf_v2_release() {
  # Deterministic gate for 0.11 Stage 0 step 5c-1: the PURE release-policy reducer
  # (decideReleasePolicy + reduceRelease) for the 5c transport hand. Proves the
  # Fable-3 "release-after-observation" timing as a pure state machine BEFORE any
  # spawn/send IO: meta-mailbox=never release (no lock), control-socket=release once
  # on send-final, spawn-bg=spawn-started is NOT a release event (load-bearing) →
  # release on the FIRST observed transition (socket-alive ∨ child-exited any code)
  # or a failed start; socket↔exit race idempotent (single release either order);
  # decideReleasePolicy enforces the lock-nullness invariant (？7). Pure, no IO.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-release.ts)
}

check_entwurf_v2_send() {
  # Deterministic gate for 0.11 Stage 0 step 5c-2a: the control-socket SEND hand
  # (executeControlSocketSend) that WIRES real transport IO onto the 5c-1 release
  # reducer. Proves the send->outcome->release ordering over injected fakes (no socket):
  # ack->sent / in-band reject->rejected (no fallback) / dead->same-lock one-shot
  # re-resolve (control retry or mailbox enqueue)->fallback-sent|rejected|failed /
  # indeterminate->failed+rethrow with deadFallback+mailbox NEVER called (no
  # double-delivery on an alive-but-stalled socket). Release fires exactly once per
  # send-final; a releaseLock throw never masks the send failure (5b). IO-via-dep.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-send.ts)
}

check_entwurf_v2_send_fallback() {
  # Deterministic gate for 0.11 Stage 0 step 5c-2b: the same-lock re-resolve RESOLVER
  # (resolveDeadControlSendFallback) the 5c-2a hand calls on a dead connect. Proves the
  # fire-and-forget re-resolve routing over injected fakes (no filesystem): alive->
  # control-socket retry (inspected socketPath) / dead(absent)->reject (dormant-fire-
  # forget-unsupported, NEVER spawn-bg) / indeterminate->reject / unsupported+deliverable
  # ->meta-mailbox plan (mini-table, no inspect/probe) / unsupported+undeliverable->reject
  # / bad-target + address-conflict->reject pre-probe. Mis-wire (plan/lock gid) fails loud
  # before IO; inspect/probe throws PROPAGATE (the hand owns failed+release); the resolver
  # has NO release seam; every execute plan keeps the held gid and is never spawn-bg.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-send-fallback.ts)
}

check_entwurf_v2_mailbox() {
  # Deterministic gate for 0.11 Stage 0 step 5c-4 (the LAST 5c transport slice): the
  # ENQUEUE-ONLY meta-mailbox SEND body (executeMetaMailboxSend) + its production
  # sendViaMailbox adapter (makeProductionSendViaMailbox). Proves the wiring over an
  # injected fake enqueue (no filesystem): sender present -> formatMetaMailboxBody with
  # plan.wantsReply threaded (yes/no in body, the deliberate divergence from legacy's
  # hard-coded false) / sender absent -> raw plan.message / enqueue opts EXACTLY
  # {gardenId: plan.targetGardenId, body, sessionsDir, mailboxDir} (no re-derivation) /
  # enqueue throw PROPAGATES (never folded into success:false — a mailbox has no in-band
  # refuse) / success -> {success:true}. Production adapter resolves {success:true},
  # consults senderProvider once, and NEVER touches the lock (a poison LockClaim whose
  # every access throws still resolves). Source guard: the lib code has NO release seam
  # and NO routing seam (no releaseLock / inspect / probe / resolve) — a lock leak or
  # re-route is structurally impossible.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-mailbox.ts)
}

check_entwurf_v2_runner() {
  # Deterministic gate for 0.11 Stage 0 step 5d-1: the execute-router (executeDispatch) that
  # routes an already-decided DispatchDecision to its 5c transport hand and maps the outcome
  # to one outcome-rich EntwurfV2RunResult. Proves over injected fake hands (no socket/spawn/
  # timer): reject -> rejected (receipt+diagnostic carried, NO hand called) / control-socket ->
  # sendControl(plan, lock) / spawn-bg -> resumeSpawnBg (socket-alive AND lock-retained both
  # ride `executed`, fail-closed is not a failure) / meta-mailbox -> sendMailbox(plan, NULL
  # lock, ？7). Carry-overs: N3 control `rejected` carries rejectReason verbatim; N1
  # SendDeliveredReleaseFailedError -> execution-failed{finalizedOutcome, releaseFailed,
  # retrySafe:false}; a plain hand throw -> execution-failed{retrySafe:false} with no
  # finalizedOutcome. Exactly one hand runs per execute.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-runner.ts)
}

check_entwurf_v2_surface() {
  # Deterministic gate for 0.11 Stage 0 step 5d-3a: the ctx-free surface adapter
  # (entwurf-v2-surface.ts) + the entwurf-control.ts wiring contract. Proves the pure parts:
  # toDispatchInput (wants_reply→wantsReply, absent mode/wants_reply undefined) / renderEntwurfV2Result
  # per result kind ({text,isError} surfacing reject diagnostic, control N3 rejectReason, spawn
  # lock-retained, N1 delivered-but-dirty) / surface ctx-free source guard / entwurf-control
  # registers entwurf_v2 + reaches the fence via a NON-LITERAL dynamic import (no static fence
  # import → TS5097 stays closed) + decorates sender origin:pi-session/replyable:true.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-surface.ts)
}

check_entwurf_bridge_boot() {
  # Deterministic gate for 0.11 step 5d-5-pre (G1a/G1b): boots the entwurf-bridge MCP server
  # as it ships (start.sh → node --experimental-strip-types, no build) and asserts what the
  # source-shape gate check-entwurf-v2-surface cannot — that the whole v2 fence graph LOADS at
  # boot under strip-types (G1a: a parseable tools/list proves it) and that entwurf_v2 is
  # registered on the runtime surface with its schema (G1b). tools/list only → no tools/call,
  # no lock/fs side effect, no auth → safe in pnpm check. Broad protocol/negative suite stays
  # in check-bridge/test.sh (D1=A안).
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-bridge-boot.ts)
}

check_entwurf_v2_production() {
  # Deterministic gate for 0.11 Stage 0 step 5d-2b: makeProductionEntwurfV2Deps — the ctx-free
  # PRODUCTION assembly of runEntwurfV2's deps. Proves the wiring over fake leaf-IO spies (no
  # real socket/lock/spawn/meta-record): decide wraps decideDispatch and acquires under the
  # wired lockDir / control sendOverSocket builds the RpcSendCommand + maps + releases under
  # lockDir / QB3 the spawn watcher releases via the SHARED lockDir release (not the spawn
  # factory default) / the mailbox hand enqueues onto the wired dirs / a dead control send
  # re-resolves to the SAME sendViaMailbox instance on the SAME dirs (Q3+Q5 no drift).
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-production.ts)
}

check_entwurf_control_rpc() {
  # Gate for 0.11 Stage 0 step 5d-2 (RPC-helper extraction micro-slice): the --entwurf-control
  # socket protocol (wire types + the newline-JSON client sendRpcCommand) moved to the ctx-free
  # SSOT lib/entwurf-control-rpc.ts behaviour-preservingly. Proves: lib is ctx-free (no
  # ExtensionContext/ExtensionAPI/@earendil-works/pi-ai) / entwurf-control.ts imports
  # sendRpcCommand from the lib and no longer defines its own / real short unix-socket round-trip
  # (write command -> matched {type:response,command,success:true} -> resolve) / close-before-
  # response rejects 'connection closed before response'. net.Server only, no model/pi process.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-control-rpc.ts)
}

check_entwurf_v2_spawn() {
  # Deterministic gate for 0.11 Stage 0 step 5c-3a: the spawn-bg RESUME watcher hand
  # (executeSpawnBgResume) wiring spawn + socket-observe IO onto the 5c-1 reducer. Proves
  # Fable-3 over injected deferred promises (no real child/socket/timer): TIMEOUT IS NOT A
  # RELEASE — a bare observeTimeout escalates to killChild (release 0), then a BOUNDED
  # killGrace waits for a real socket-alive / child-exited to release. socket-alive ∨
  # child-exited(any code incl. null) -> release exactly once; the loser settling later is a
  # no-op. spawnChild throw -> spawn-start-failed (release, nothing to watch). No observation
  # obtainable (grace elapses, or a post-spawn watch dep throws and the exit can't be
  # observed) -> lock-retained fail-closed (released:false, pid/socket/lockPath surfaced) —
  # there is NO direct-release hatch; deps.releaseLock is reached ONLY via reduceRelease.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-spawn.ts)
}

check_entwurf_resume_args() {
  # Deterministic gate for 0.11 Stage 0 step 5c-3b: the resume-argv SSOT
  # (buildResumePiArgs) that the legacy async worker AND the v2 spawn-bg resident citizen
  # share so their launch shapes never drift. Pins the load-bearing A1 difference: legacy =
  # `--no-extensions` + NO `--entwurf-control` (one-shot `pi -p` can exit); v2-control =
  # `--entwurf-control` + NO `--no-extensions` (the keep-alive legacy avoided is the goal —
  # resumed session stands its socket up and stays addressable). BOTH keep `--mode json -p`
  # and the prompt-as-turn positional (`-p` NOT dropped in v2); explicitExtensionArgs
  # preserved exactly once (provider-resolution footgun #29); v2 includes plan.launchArgs
  # (--approve) before the prompt; null provider emits no --provider; no cross-contamination.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-resume-args.ts)
}

check_entwurf_v2_spawn_production() {
  # Deterministic gate for 0.11 Stage 0 step 5c-3c: the production SpawnBgResumeDeps factory
  # (makeProductionSpawnBgResumeDeps) wiring the 5c-3a watcher's six IO seams onto the real
  # world — proven WITHOUT a real pi spawn/socket/timer (that is the opt-in
  # smoke-entwurf-v2-spawn-live, kept OUT of pnpm check). socketWatchVerdict (R2 policy):
  # address-conflict→forged (reject, never wait), alive→alive, dead/indeterminate→wait.
  # spawnChild builds the v2-control argv (--entwurf-control, no --no-extensions, -p+prompt,
  # --approve, ext/provider/model, header cwd). awaitSocketAlive: connectable resolves, forged
  # (symlink) rejects without connecting, dead→wait→alive, abort clears the sleep. awaitChildExit
  # resolves the code + removes the listener on abort. awaitTimeout schedules + abort-clears.
  # killChild=SIGTERM; releaseLock delegates; a proc-less child fails loud (mis-wire).
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-v2-spawn-production.ts)
}


smoke_entwurf_v2_spawn_live() {
  # LIVE phase gate for 0.11 Stage 0 step 5c-3c (D5) — kept OUT of `pnpm check`. Exercises the
  # production SpawnBgResumeDeps against REAL OS objects (a real unix socket, real child
  # processes, real timers, real abort teardown) to catch what the deterministic gate's fakes
  # cannot: actual spawn/exit/error event semantics, real lstat+connect liveness, and the
  # 5c-3a watcher's timeout→kill→child-exited→release integration on a live process. It does
  # NOT spawn a real `pi --entwurf-control` resume (that is the 5d surface matrix). Run once
  # before 5d and record the result:  LIVE=1 ./run.sh smoke-entwurf-v2-spawn-live
  if [ "${LIVE:-}" != "1" ]; then
    echo "[smoke-entwurf-v2-spawn-live] skipped — set LIVE=1 to run (spawns real children + opens a real unix socket)."
    return 0
  fi
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-entwurf-v2-spawn-live.ts)
}

smoke_acp_socket_citizen_live() {
  # S1 acceptance smoke (ACP plugin on v2) — OUT of pnpm check, needs LIVE=1.
  # Spawns a REAL `pi --entwurf-control` resident on an ACP model
  # (entwurf/claude-opus-4-8) and proves it is a first-class socket-citizen:
  # the control socket stands up, get_info answers with the ACP model (model-lock
  # did NOT revert — QM1), idle/cwd are reported, and the fail-loud streamSimple
  # stub never fires (turn-free launch — QM2). No prompt is sent: S1 proves
  # citizenship, never a backend turn (that is S2). Honest skip when LIVE!=1.
  # Model override: PI_SHELL_ACP_S1_MODEL (default claude-opus-4-8).
  #   LIVE=1 ./run.sh smoke-acp-socket-citizen-live
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-acp-socket-citizen-live.ts)
}

smoke_acp_raw_turn_live() {
  # S2a-2 acceptance smoke (ACP plugin on v2) — OUT of pnpm check, needs LIVE=1.
  # Drives ONE real ACP turn through the pinned Claude adapter: spawns
  # claude-agent-acp from its resolved package bin, speaks ACP over stdio NDJSON
  # (ndJsonStream + ClientSideConnection), runs initialize -> newSession ->
  # (sonnet) setSessionModel -> prompt("say OK"), and asserts a live "OK" reply
  # plus captured raw NDJSON bytes. NO provider/overlay/streamSimple/_meta — the
  # raw backend pipe only. Launch source must be the package bin (PATH fallback
  # fails acceptance unless PI_SHELL_ACP_RAW_TURN_ALLOW_PATH_FALLBACK=1, debug).
  # Model override: PI_SHELL_ACP_RAW_TURN_MODEL (default claude-sonnet-4-6).
  #   LIVE=1 ./run.sh smoke-acp-raw-turn-live
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-acp-raw-turn-live.ts)
}

smoke_acp_overlay_live() {
  # S2b acceptance smoke (ACP plugin on v2) — OUT of pnpm check, needs LIVE=1.
  # One layer above the S2a raw turn: materializes the Claude config overlay
  # (realDir = operator ~/.claude for live creds; overlay settings.json is ours,
  # hooks:{}), spawns claude-agent-acp with CLAUDE_CONFIG_DIR=<overlay> (verified
  # in the child's /proc/<pid>/environ), opens a session with a tool-narrowed
  # _meta.claudeCode.options (tools + disallowedTools) and NO _meta.systemPrompt
  # (billing carrier stays absent), then drives one live "OK" turn. NO
  # provider/streamSimple (backend-stub stays fail-loud — that is S2c); no
  # event-mapping/session-reuse/engraving (S2d). Does NOT diff the live
  # meta-store for mailbox absence (flaky — concurrent sessions); the honest
  # claim is overlay-supplies-hooks:{}. Launch must be the package bin (PATH
  # fallback fails acceptance unless PI_SHELL_ACP_OVERLAY_ALLOW_PATH_FALLBACK=1).
  # Model override: PI_SHELL_ACP_OVERLAY_MODEL (default claude-sonnet-4-6).
  #   LIVE=1 ./run.sh smoke-acp-overlay-live
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-acp-overlay-live.ts)
}

smoke_acp_memory_containment_live() {
  # Gate D — ACP Claude memory containment, end-to-end. OUT of pnpm check, LIVE=1.
  # THE regression guard that was missing: drives the SHIPPED config (overlay +
  # PRESENT engraving carrier = the v1 preset-replacement lever) with a turn that
  # EXPLICITLY asks the model to persist a nonce to its memory, then asserts NO
  # file appears under <overlay>/projects/**/memory/**. Permission is GRANTED (not
  # cancelled) and writeTextFile delegation is PERFORMED, so the only thing that
  # can stop a memory write is the lever — not us. Fails loud if engraving.md is
  # empty (carrier OFF = no containment). Launch must be the package bin (PATH
  # fallback fails acceptance unless PI_SHELL_ACP_MEMORY_ALLOW_PATH_FALLBACK=1).
  # Model override: PI_SHELL_ACP_MEMORY_MODEL (default claude-sonnet-4-6).
  #   LIVE=1 ./run.sh smoke-acp-memory-containment-live
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-acp-memory-containment-live.ts)
}

smoke_acp_provider_live() {
  # S2c acceptance smoke (ACP plugin on v2) — OUT of pnpm check, needs LIVE=1.
  # Drives the REAL pi PROVIDER path end to end: a real `pi` loads this
  # checkout's extension (--no-extensions -e REPO_ROOT), selects
  # entwurf/<model>, and pi's runner calls our streamSimple (backend.ts),
  # which spawns claude-agent-acp under the overlay, runs one turn, and maps the
  # result back through the S2c event mapper. Asserts a unique nonce in the
  # assistant reply (live model proof) + the removed S0 stub error never appears
  # (provider path actually opened) + pi exits 0. Tool-free prompt; the
  # event-mapper gate owns the tool→notice contract.
  # Model override: PI_SHELL_ACP_PROVIDER_MODEL (default claude-sonnet-4-6).
  #   LIVE=1 ./run.sh smoke-acp-provider-live
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-acp-provider-live.ts)
}

smoke_acp_session_reuse_live() {
  # S2d-1b-2b acceptance smoke (in-memory session reuse) — OUT of pnpm check,
  # needs LIVE=1. Forces process-scoped (pushes --entwurf-control into argv) and
  # drives TWO real ACP turns over ONE reused claude-agent-acp child via the real
  # streamShellAcp: turn 1 introduces a codeword (full transcript), turn 2 sends
  # ONLY the latest user delta and must recall the codeword — proving the child
  # was reused and the live ACP session kept turn-1 history (a respawn-per-turn
  # backend would forget it). The one-shot exit0 half is owned by
  # smoke-acp-provider-live.
  # Model override: PI_SHELL_ACP_PROVIDER_MODEL (default claude-sonnet-4-6).
  #   LIVE=1 ./run.sh smoke-acp-session-reuse-live
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-acp-session-reuse-live.ts)
}

smoke_acp_carrier_augment_live() {
  # S2e-1 acceptance smoke (billing carrier + first-user augment) — OUT of pnpm
  # check, needs LIVE=1. Writes a unique secret into the scratch cwd's AGENTS.md
  # (never the prompt) and drives one real provider turn: the reply must carry the
  # secret (the augment rode the wire to the model) and the EMPTY default carrier
  # must bill clean (exit 0, no HTTP-400 canary — 핀1 live). Optional tiny carrier
  # check via SMOKE_ACP_CARRIER_PRESENT=1 (non-blocking).
  # Model override: PI_SHELL_ACP_PROVIDER_MODEL (default claude-sonnet-4-6).
  #   LIVE=1 ./run.sh smoke-acp-carrier-augment-live
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-acp-carrier-augment-live.ts)
}

smoke_acp_mcp_live() {
  # S2g LIVE 1 — operator MCP passthrough acceptance. OUT of pnpm check, needs
  # LIVE=1. Registers a TINY isolated probe MCP server (scripts/fixtures/
  # probe-mcp-server.ts, one tool probe_nonce) in a scratch .pi/settings.json and
  # drives one real provider turn: the model must CALL the tool and echo the nonce
  # that lives only inside the MCP server env. Proves the operator's
  # entwurfProvider.mcpServers reaches the live ACP session (the GLG-baseline
  # fix). Isolated probe (not entwurf-bridge) so a failure does not blur into
  # identity/env wiring. Model override: PI_SHELL_ACP_PROVIDER_MODEL.
  #   LIVE=1 ./run.sh smoke-acp-mcp-live
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-acp-mcp-live.ts)
}

smoke_acp_skill_live() {
  # S2g LIVE 2 — operator skillPlugins passthrough acceptance. OUT of pnpm check,
  # needs LIVE=1. Builds a temp skill plugin (.claude-plugin/plugin.json +
  # skills/<name>/SKILL.md carrying a unique nonce instruction), points
  # entwurfProvider.skillPlugins at it, and drives one real provider turn: the
  # model must surface/use the skill and echo the nonce. Proves skillPlugins +
  # the Skill/Skill(*) auto-add reach the live session (the other half of the GLG
  # baseline). Model override: PI_SHELL_ACP_PROVIDER_MODEL.
  #   LIVE=1 ./run.sh smoke-acp-skill-live
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-acp-skill-live.ts)
}

smoke_acp_bundled_mcp_live() {
  # S2g LIVE 3 (axis 3) — the BUNDLED entwurf-bridge reaches the live ACP session
  # via the 0.11.0 resident/RPC circuit. OUT of pnpm check, needs LIVE=1. Launches a
  # real `pi --entwurf-control --mode rpc` resident on an ACP model and drives ONE
  # model turn over the stdin RPC asking it to call mcp__entwurf-bridge__entwurf_self;
  # captures the identity envelope (the resident's own fresh gid — never told to the
  # model, only in the bridge env — + agentId + socketState alive) and agent_end
  # DIRECTLY from the stdout RPC event stream (gnew-rpc-drive shape). Complements
  # smoke-acp-mcp-live (tiny isolated probe): this proves the REAL bundled bridge with
  # envelope injection. NOT `pi -p` one-shot (that bundled-MCP teardown hang is
  # diagnostic backlog, not the 0.11.0 release circuit). Model override:
  # PI_SHELL_ACP_PROVIDER_MODEL.
  #   LIVE=1 ./run.sh smoke-acp-bundled-mcp-live
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-acp-bundled-mcp-live.ts)
}

smoke_acp_rgg_live() {
  # S2e-2 — ACP-provider resident garden guard (RGG). Thin wrapper (GPT c32a6c8):
  # runs the SHARED resident-garden-guard runner against the entwurf provider
  # target with the DETERMINISTIC half only (SMOKE_RGG_POSITIVE=0). What this lane
  # treats as release-blocking is that garden-native resident discipline (uuid
  # refuse / new·clone cancel / legacy-resume pre-cancel / gnew clean birth) holds
  # under the ACP provider too — the guard logic is provider-agnostic. The positive
  # GNEW T3 (model autonomously calling entwurf_self) is N/A here BY ACP BOUNDARY:
  # the ACP child is spawned with mcpServers:[] so it has no entwurf_self call
  # surface (plugin stays lightweight, no ambient MCP — S2b/S2d boundary). To
  # observe that boundary directly, run the shared runner with SMOKE_RGG_POSITIVE=1
  # and PI_SHELL_ACP_LIVE_TARGET set (T3 will report N/A, not a real failure).
  # Target override: PI_SHELL_ACP_RGG_TARGET (default entwurf/claude-sonnet-4-6).
  #   ./run.sh smoke-acp-rgg-live
  local target="${PI_SHELL_ACP_RGG_TARGET:-entwurf/claude-sonnet-4-6}"
  (cd "$REPO_DIR" && PI_SHELL_ACP_LIVE_TARGET="$target" SMOKE_RGG_POSITIVE=0 bash scripts/smoke-resident-garden-guard.sh)
}

smoke_entwurf_v2_matrix_live() {
  # LIVE sentinel for 0.11 Stage 0 step 5d-5 (D4-b) — kept OUT of `pnpm check`. The deterministic
  # sibling (check-entwurf-v2-matrix) fixes every (target kind → transport → lock) cell over fakes
  # with ZERO IO; this drives the REAL production runEntwurfV2 deps against REAL OS objects on the
  # substrate happy path across 3 cells: C1 control-socket (a real `pi --entwurf-control` resident
  # → control-socket RPC send → lock acquire→release ×1), C2 meta-mailbox deliverable (armed
  # self-fetch citizen → real .msg enqueue, lock-free), C3 meta-mailbox guard (no armed receiver →
  # reject, no garbage). Model-in-loop is OUT (GPT Q2): "does the sender model call entwurf_send"
  # is a separate behavior test — this is a transport/lock/enqueue gate. Negative/timeout/contention
  # stay deterministic. Honest skip when LIVE!=1 so the release-gate is runnable unattended.
  # Model: PI_SHELL_ACP_LIVE_TARGET=<provider>/<model> (default openai-codex/gpt-5.4).
  #   LIVE=1 ./run.sh smoke-entwurf-v2-matrix-live
  if [ "${LIVE:-}" != "1" ]; then
    echo "[smoke-entwurf-v2-matrix-live] skipped — set LIVE=1 to run (spawns a real pi --entwurf-control + opens a real socket)."
    return 0
  fi
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-entwurf-v2-matrix-live.ts)
}

smoke_entwurf_v2_spawn_resume_live() {
  # The 0.11.0 (A) acceptance gate — kept OUT of `pnpm check`. Unlike matrix-live (a
  # transport/lock sentinel, model-in-loop OUT) and spawn-live (OS-substrate watcher, no real
  # pi), this drives the FULL production loop: mint a backend=pi meta identity → seed a REAL
  # dormant pi session (one-shot `pi --mode json -p --no-extensions` into the REAL
  # ~/.pi/agent/sessions) → runEntwurfV2(intent=owned-outcome) routes the dormant in-domain pi
  # citizen to spawn-bg resume → a REAL detached `pi --entwurf-control` child stands its socket
  # up, resumes, and DOES a model turn. Asserts: executed/spawn-bg/socket-alive/released, lock
  # released exactly once + no lock file, resident pid alive + socket connectable, and the
  # resume USER + assistant OK nonces appended to the session JSONL (real work, not just
  # "process up"). This is the evidence v1 deprecation (0.12) is predicated on. Model-in-loop is
  # IN. Honest skip when LIVE!=1 (skip = CI safety, NOT an acceptance PASS).
  # Model: PI_SHELL_ACP_LIVE_TARGET=<provider>/<model> (default openai-codex/gpt-5.4);
  #        PI_SHELL_ACP_SPAWN_RESUME_ASSISTANT_TIMEOUT_MS (default 180000).
  #   LIVE=1 ./run.sh smoke-entwurf-v2-spawn-resume-live
  if [ "${LIVE:-}" != "1" ]; then
    echo "[smoke-entwurf-v2-spawn-resume-live] skipped — set LIVE=1 to run (spawns a real pi resume child + opens a real socket)."
    return 0
  fi
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-entwurf-v2-spawn-resume-live.ts)
}

check_entwurf_facts() {
  # Deterministic gate for 0.11 Stage 0 step 4 (fact-provider slice 1): the PURE
  # fact core. Locks the PeerFact shape + R1/R3b liveness invariant before any IO
  # wiring (gate-first). R1: out-of-domain backend (claude-code/codex/antigravity)
  # → unsupported for EVERY socket input (never coerced to the socket value or
  # dead). R3b: in-domain pi → alive/dead/indeterminate, null → indeterminate
  # (no proof ≠ dead). facts-only keyset: identity facts + liveness, NO
  # verb-routing (resumable/sendable/transport/dispatch/action) and NO
  # transcriptPath (동결결정 10). Pure, no IO, no API.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-facts.ts)
}

check_socket_discovery() {
  # Deterministic gate for 0.11 Stage 0 step 4 (fact-provider slice 3): the
  # SOCKET-axis wiring scanSocketProbes. Probes the union of (dir sockets) ∪
  # (every in-domain pi citizen's canonical path) so a dormant citizen with no
  # socket file reads dead (ENOENT) → resumable, never an unprobed gap (slice 2
  # throws on that). Three-valued throughout — a stalled socket stays
  # indeterminate (F3), never folded to dead by an alive-only listing. Dir
  # hygiene (non-.sock / malformed names ignored), dedup, missing-dir, sort, and
  # an end-to-end scanSocketProbes→resolveFactList. readdir/probe injected, no IO.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-socket-discovery.ts)
}

check_meta_listing() {
  # Deterministic gate for 0.11 Stage 0 step 4 (fact-provider slice 4a): the
  # meta-store axis listAllMetaIdentities. Explicit-partial: a parse failure or
  # body/filename drift does NOT blind the listing (valid records still surface)
  # and does NOT throw (0.10 "corrupt blocks registration forever" lesson) — it
  # becomes an explicit error carrying ONLY {filename, message}, verbatim (a
  # salvaged gid string as a fact = synthetic backdoor). mode strict throws on
  # any error, collect returns partial. entries/readRecord injected, no IO.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-meta-listing.ts)
}

check_entwurf_fact_provider() {
  # Deterministic gate for 0.11 Stage 0 step 4 (fact-provider slice 4b): the
  # ASSEMBLY layer listEntwurfFacts. listAllMetaIdentities → scanSocketProbes →
  # pre-quarantine non-pi/socket conflicts → resolveFactList(clean) →
  # {facts, diagnostics}. Throw-vs-diagnostics policy (GPT힣 C-원칙): expected
  # corruption (parse failure / gardenId↔socket collision) → diagnostics, listing
  # survives; impossible wiring invariant (resolveFactList duplicate/unprobed) →
  # throw, never swallowed. A collision quarantines BOTH the PeerFact and the
  # socket (gid is the universal address). meta + socket deps injected, no IO.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-fact-provider.ts)
}

check_entwurf_peers_surface() {
  # Deterministic gate for 0.11 Stage 0 step 4 (fact-provider slice 4c): the MCP
  # entwurf_peers RENDER/PAYLOAD layer renderEntwurfPeers. Legacy `sessions` is a
  # PROJECTION of facts (alive pi citizens + alive socket-only), NOT a second scan
  # (a re-run getLiveSessions would bypass the provider quarantine); socketPath via
  # controlSocketPath (SSOT, no correlation-authority drift); count = projection
  # length not peers.length; three distinct arrays (peers/socketOnly/diagnostics);
  # NO verb-routing field in JSON (deep key scan) NOR word in text (title leak);
  # diagnostics in both surfaces; empty → "(none)"; unsupported shown; enrich null
  # → "(not enriched)". WIRING guard: bridge calls listEntwurfFacts+renderEntwurfPeers,
  # getLiveSessions gone. Facts fabricated, no IO (only static source read).
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-peers-surface.ts)
}


check_entwurf_self_address() {
  # Deterministic gate for the self-addressability honesty predicate (SE-1/SE-2
  # slice 1). Guards the bug where the MCP bridge / pi-native claim replyable:true
  # from env presence alone: a socketless pi session, or a meta citizen whose owner
  # exited / whose idle-watch was never armed, all advertised replyable while
  # delivery silently failed (SE-1). Asserts: PURE truth table (pi replyable ⟺
  # socketAlive; meta ⟺ recordBacked ∧ ownerAlive ∧ watchArmed; external never),
  # incl. the two regression-proof rows (record-present + owner-dead / watch-unarmed)
  # that stay meaningful after slice 3 mints records; SOURCE GUARD that
  # buildStrictPiSenderEnvelope drops the hardcoded `replyable: true` and existsSync-
  # probes the socket, and entwurf_self renders alive vs expected (no path lie).
  # Slice boundary: meta watchArmed is wired from the slice-2 presence marker; do NOT
  # claim slice 1 green standalone (1+2 close in the same release block).
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-self-address.ts)
}

check_entwurf_deliverability() {
  # Deterministic gate for the conversational-mailbox deliverability predicate
  # (SE-1/SE-2 slice 2c). The predicate the enqueue sites must consult (slice 2d)
  # before writing a .msg. Asserts: computeMetaReceiverActive (active iff recordBacked
  # AND ownerAlive AND watchArmed, fail-closed, per-cause reasons); mailboxConversational-
  # Deliverable (deliverable iff wakeMode self-fetch AND active) — KEY rows: direct-inject
  # (pi) refused even when active (SE-1, no mailbox drain), self-fetch + dead-owner/unarmed
  # refused (SE-2, would rot); WIRING that the self-addressability predicate shares the
  # SAME active-receiver atom (one source of truth). Pure, no IO.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-deliverability.ts)
}

check_entwurf_mailbox_guard() {
  # Deterministic gate for the guarded mailbox enqueue (SE-1/SE-2 slice 2d) — the IO
  # orchestration conversational-reply sites use instead of enqueueMetaMessage directly.
  # Asserts (GPT Q5, both axes): PURE 0-call — an undeliverable target (dead receiver /
  # direct-inject pi / absent record) leaves the injected enqueue UNCALLED, a deliverable
  # one calls it exactly once; TMPDIR SNAPSHOT with the real enqueueMetaMessage — a refused
  # send leaves the mailbox tree byte-identical (file list + content hash, not just mtime),
  # an accepted send writes exactly one .msg; plus fact gathering from record/capability/marker.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-entwurf-mailbox-guard.ts)
}



check_package_source_routing() {
  # Deterministic gate for #29 (package-installed Entwurf ACP routing). Pins
  # resolveExplicitExtensionSpec()'s package-source -> install-root mapping and
  # the fail-fast routing contract through the two public routing surfaces
  # (getRegistryRouting spawn path, getEntwurfExplicitExtensions resume path).
  # Covers the install matrix: local path / git user / npm user (+version) /
  # install-missing / project-scope-unseen / no-source, across local + remote,
  # plus self-root fallback and the resume unresolvedAcpIntent signal. Isolated
  # via a temp PI_CODING_AGENT_DIR — the real ~/.pi/agent is never touched. No
  # backend, no spawn, no API cost.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-package-source-routing.ts)
}


smoke_session_id_name() {
  # LIVE 3-turn substrate smoke (Phase 3a) for Pi 0.78 --session-id/--name,
  # exercised through the bridge but NOT through the Entwurf tool surface, so it
  # lands independently of the taskId->sessionId migration. Spawns real cheap
  # sonnet turns (auth + tokens) and asserts: header id/cwd, session_info name as
  # info layer, append-not-recreate, spawn-only name, and the wrong-cwd footgun
  # as documented evidence. Isolated via a temp PI_CODING_AGENT_DIR.
  section "smoke: --session-id / --name substrate (direct pi, no Entwurf API)"
  if ! command -v pi >/dev/null 2>&1; then
    fail "[smoke-session-id-name] pi binary not on PATH — cannot run live substrate proof"
    return 1
  fi
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/smoke-session-id-name.ts) || {
    fail "[smoke-session-id-name] live substrate smoke failed"
    return 1
  }
  ok "[smoke-session-id-name] --session-id/--name substrate proven (append + spawn-only name + wrong-cwd footgun)"
  return 0
}



check_dep_versions() {
  # Catches version-pin drift across package.json, run.sh, and README.md.
  # Concretely the kind of skew that produced commit 21de0f9's "0.11.1
  # leftover" review comment: package.json bumped to 0.12.0 while README
  # and run.sh's setup gate still claimed 0.11.1. Static check, no
  # subprocess — fast enough to run inside `pnpm check` and pre-commit.
  (cd "$REPO_DIR" && node --input-type=module <<'EOF'
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const geminiBundled = pkg.dependencies['@google/gemini-cli'] ?? pkg.optionalDependencies?.['@google/gemini-cli'];
assert.equal(geminiBundled, undefined, 'package.json must not bundle @google/gemini-cli — gemini is an external PATH runtime');

// `^` + `m` flag anchors to the start-of-line shell assignment so we don't
// accidentally pick up the regex literal inside this very check function's
// heredoc (which is indented, so won't match `^...`).
const runSh = readFileSync('run.sh', 'utf8');

// pi peer/dev alignment (#26 / 0.8.0 dep-alignment gate). The three
// @earendil-works/pi-* devDeps must pin one identical version, and that
// version must match the check-pack-install peer-install pins below
// (`pnpm add @earendil-works/pi-ai@X ...`). Without this, a pi bump could
// drift package.json devDeps away from the fresh-temp install smoke and
// the "dependency alignment gate" would not actually verify pi.
const piAi = pkg.devDependencies?.['@earendil-works/pi-ai'];
const piCoding = pkg.devDependencies?.['@earendil-works/pi-coding-agent'];
const piTui = pkg.devDependencies?.['@earendil-works/pi-tui'];
assert.ok(piAi, 'package.json devDependencies must pin @earendil-works/pi-ai');
assert.equal(piCoding, piAi,
  `@earendil-works/pi-coding-agent (${piCoding}) must match @earendil-works/pi-ai (${piAi})`);
assert.equal(piTui, piAi,
  `@earendil-works/pi-tui (${piTui}) must match @earendil-works/pi-ai (${piAi})`);

// check-pack-install peer-install pins (quoted `@earendil-works/pi-*@<ver>`
// args; the `\d`-anchored version avoids matching this regex literal itself).
const peerAi = runSh.match(/"@earendil-works\/pi-ai@(\d[\d.]*)"/)?.[1];
const peerCoding = runSh.match(/"@earendil-works\/pi-coding-agent@(\d[\d.]*)"/)?.[1];
const peerTui = runSh.match(/"@earendil-works\/pi-tui@(\d[\d.]*)"/)?.[1];
assert.equal(peerAi, piAi,
  `run.sh check-pack-install pi-ai peer pin (${peerAi}) must match package.json devDep (${piAi})`);
assert.equal(peerCoding, piAi,
  `run.sh check-pack-install pi-coding-agent peer pin (${peerCoding}) must match (${piAi})`);
assert.equal(peerTui, piAi,
  `run.sh check-pack-install pi-tui peer pin (${peerTui}) must match (${piAi})`);

// peerDependencies must be a CLOSED range (0.11 Stage 0, drift-proofing): the
// floor tracks the devDep pin so a consumer can't install against a pi lacking
// the 0.79 public trust exports the bridge imports, AND an upper bound at the
// next minor stops a fresh install from silently pulling a future pi (0.80+)
// whose internal export surface has drifted from the one we typecheck against.
// pi moves its public surface every minor (the 0.79.x export churn), so an open
// `>=` floor is exactly how the next installer re-acquires the drift. Expected
// shape: `>=<devDep> <0.<minor+1>` (e.g. `>=0.79.8 <0.80`).
const [piMaj, piMin] = piAi.split('.').map(Number);
assert.equal(piMaj, 0,
  `pi pin major must stay 0 for the next-minor ceiling rule (got ${piAi}); revisit check-dep-versions when pi reaches 1.x`);
const expectedPeer = `>=${piAi} <0.${piMin + 1}`;
const peerDepAi = pkg.peerDependencies?.['@earendil-works/pi-ai'];
const peerDepCoding = pkg.peerDependencies?.['@earendil-works/pi-coding-agent'];
const peerDepTui = pkg.peerDependencies?.['@earendil-works/pi-tui'];
assert.equal(peerDepAi, expectedPeer,
  `package.json peerDependencies @earendil-works/pi-ai (${peerDepAi}) must be "${expectedPeer}" (devDep floor + next-minor ceiling)`);
assert.equal(peerDepCoding, expectedPeer,
  `package.json peerDependencies @earendil-works/pi-coding-agent (${peerDepCoding}) must be "${expectedPeer}"`);
assert.equal(peerDepTui, expectedPeer,
  `package.json peerDependencies @earendil-works/pi-tui (${peerDepTui}) must be "${expectedPeer}"`);

console.log('[check-dep-versions] 11 assertions ok');
EOF
  )
}

check_pi_import_surface() {
  # 0.11 Stage 0 (동결결정 9): the bridge may reference @earendil-works/pi-*
  # ONLY by the package root. ANY subpath (`/dist`, `/core`, `/src`, `/foo`, …)
  # reaches pi's private surface and silently breaks on pi internal reshuffles.
  # The check is intentionally SPECIFIER-shaped, not import-keyword-shaped: it
  # matches a quoted/backtick module specifier `@earendil-works/pi-*/…`, so one
  # pattern catches static `from`, dynamic `import()`, `require()`,
  # `export … from`, side-effect `import "…"`, and whitespace variants alike.
  # Root import `@earendil-works/pi-coding-agent` (no trailing slash) is allowed.
  # Scans EVERY tracked .ts/.js/.mjs/.cjs source (git ls-files), not a hardcoded
  # file list — a new root file (acp-bridge.ts, event-mapper.ts, engraving.ts,
  # pi-context-augment.ts, protocol.js, …) can never silently escape the gate.
  local hits
  hits=$(cd "$REPO_DIR" && git ls-files '*.ts' '*.js' '*.mjs' '*.cjs' \
    | grep -vE '^(node_modules|dist)/' \
    | xargs -r grep -HnE "[\"'\`]@earendil-works/pi-(ai|coding-agent|tui)/" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "[check-pi-import-surface] FAIL: pi private subpath reference(s) — import @earendil-works/pi-* by the package ROOT only:"
    echo "$hits"
    exit 1
  fi
  ok "[check-pi-import-surface] pi references are root-only (no private subpath; all tracked ts/js scanned)"
}

check_pi_runtime_version() {
  # 0.11 Stage 0 (동결결정 9, runtime half): tsc catches a missing 0.79 export
  # at dev time, but an installed environment can still resolve an older pi at
  # runtime where the named trust exports do not exist. Verify VERSION >= floor
  # via a DYNAMIC import of the package root only — never statically import a
  # 0.79-only symbol here, or this guard would crash before it can fail loud.
  (cd "$REPO_DIR" && node --input-type=module <<'EOF'
const FLOOR = '0.79.8';
const cmp = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
};
let VERSION;
try {
  ({ VERSION } = await import('@earendil-works/pi-coding-agent'));
} catch (e) {
  console.error(`[check-pi-runtime-version] FAIL: cannot import @earendil-works/pi-coding-agent root — ${e?.message ?? e}`);
  process.exit(1);
}
if (typeof VERSION !== 'string') {
  console.error('[check-pi-runtime-version] FAIL: pi root export VERSION is not a string');
  process.exit(1);
}
if (cmp(VERSION, FLOOR) < 0) {
  console.error(`[check-pi-runtime-version] FAIL: pi VERSION ${VERSION} < ${FLOOR} — the bridge is built and tested against the 0.79.8 public/runtime surface (trust exports hasTrustRequiringProjectResources + ProjectTrustStore nearest-ancestor get, provider registration surface, compaction semantics) that older pi lacks or behaves differently on. Bump @earendil-works/pi-*.`);
  process.exit(1);
}
console.log(`[check-pi-runtime-version] ok — pi VERSION ${VERSION} >= ${FLOOR}`);
EOF
  )
}

check_pi_preflight() {
  # 0.11 Stage 0 (2): the controlled-launch trust decision. Proves frozen
  # decision 8 precedence (saved false > saved true > prefix > no-inputs >
  # fail-fast) and decision 7's separator-boundary prefix against pi's own
  # ProjectTrustStore in a temp agentDir. Deterministic, no network/backend.
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-pi-preflight.ts)
}



check_auth_boundary() {
  # Auth-boundary guard (re-introduced for the ACP plugin on v2, retargeted off
  # the deleted 0.11.0 index.ts/acp-bridge.ts onto the new provider entry). This
  # is the code-level pair of AGENTS §Operating boundaries (trust invariants):
  # entwurf is a no-auth ACP plugin at the pi provider layer — it does NOT
  # provide, resell, or bypass any backend credentials.
  #
  # pi.registerProvider requires an apiKey when defining custom models, but the
  # plugin consumes none: backend auth belongs to the operator's own Claude CLI
  # child process. The registration MUST therefore use the lowercase+hyphen
  # no-auth sentinel, NOT a bare ALL-CAPS legacy-ENV reference (e.g.
  # "ANTHROPIC_API_KEY") which trips pi's legacy-env deprecation AND falsely
  # presents the plugin as API-key dependent.
  #
  # Scope: the new provider entry + its lib/acp/* modules. The regex matches only
  # an `apiKey:` field assigned a quoted ALL-CAPS env name, so explanatory
  # comments and the no-auth sentinel identifier pass.
  section "auth boundary (ACP plugin no-auth sentinel)"
  (cd "$REPO_DIR" && node --input-type=module <<'EOF'
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
const files = ['pi-extensions/acp-provider.ts'];
for (const f of readdirSync('pi-extensions/lib/acp')) {
  if (f.endsWith('.ts')) files.push(`pi-extensions/lib/acp/${f}`);
}
const offenders = [];
let sentinelSeen = false;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const re = /apiKey:\s*"([A-Z][A-Z0-9_]*)"/g;
  let m;
  while ((m = re.exec(src)) !== null) offenders.push(`${f}: apiKey: "${m[1]}"`);
  if (src.includes('entwurf-no-auth')) sentinelSeen = true;
}
assert.equal(offenders.length, 0,
  `ACP provider apiKey must be a no-auth sentinel, not a legacy-ENV reference. Offenders:\n  ${offenders.join('\n  ')}`);
assert.ok(sentinelSeen,
  'no-auth sentinel literal "entwurf-no-auth" not found in the ACP provider surface — auth boundary unverified');
console.log(`[check-auth-boundary] ok — no legacy-ENV apiKey literal across ${files.length} ACP provider file(s); no-auth sentinel present`);
EOF
  )
}

check_acp_provider_surface() {
  # Deterministic gate for the S0 ACP provider loader/fence slice. Loads the REAL
  # provider lib modules and asserts the registration surface: one surface name,
  # curated Claude anchor present with full ProviderModelConfig rows, no-auth
  # sentinel shape, and a FAIL-LOUD streamSimple (calling it throws — no native
  # fallback, no empty-but-successful stream). Pure, no pi runtime, no API.
  section "ACP provider surface (S0 loader/fence)"
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-acp-provider-surface.ts)
}

check_acp_sdk_surface() {
  # Deterministic gate for the S2a ACP SDK dependency surface. Pins the three
  # ACP runtime deps to the 0.11.0 oracle versions (@agentclientprotocol/sdk
  # 0.22.1 + claude-agent-acp 0.39.0 + @anthropic-ai/sdk 0.100.1), locks the
  # peer-resolution that keeps claude-agent-sdk satisfiable (0.100.1, not the
  # stale 0.91.1), asserts the wire SDK still value-exports the symbols the raw
  # turn needs (silent-rename gate), and forbids any source-level anthropic SDK
  # import / API-client use (the anthropic dep is a peer-pin ONLY).
  section "ACP SDK surface (S2a dep pin + peer-resolution + no-client-use)"
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-acp-sdk-surface.ts)
}

check_acp_overlay() {
  # Deterministic gate for the S2b Claude config overlay materializer. Drives
  # ensureClaudeConfigOverlay against injected temp realDir/overlayDir (no
  # operator ~/.claude touched) and asserts: settings.json hooks:{} +
  # defaultMode default + autoMemory off; whitelisted entries symlinked;
  # projects/sessions overlay-private real dirs (NOT symlinks); operator
  # personal config (CLAUDE.md/settings.local.json/plugins/agents) never leaks;
  # stale symlinks cleaned; binary-owned files preserved; CLAUDE_CONFIG_DIR
  # launch-env planted; idempotent. Pure, no live model.
  section "ACP overlay (S2b claude-config-overlay)"
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-acp-overlay.ts)
}

check_acp_tool_surface() {
  # Deterministic gate for the S2b Claude tool surface + exclude-tools
  # truthfulness preflight. Matrix over assertExcludeToolsHonored (claude
  # narrows via tools / native always-exposes / extension-tool exclusion is
  # honest) + buildClaudeSessionMeta shape lock (tools/allow/disallowed/
  # extraArgs/plugins) + the S2b billing-carrier guard (no _meta.systemPrompt
  # unless a caller supplies one). Pure preflight — NOT a backend wire read.
  section "ACP tool surface (S2b exclude-tools preflight + session meta)"
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-acp-tool-surface.ts)
}

check_acp_event_mapper() {
  # Deterministic gate for the S2c ACP→pi event mapper + context conversion.
  # Feeds synthetic ACP session_notification updates through the mapper and
  # asserts the pi AssistantMessageEvent sequence, including the hard boundary:
  # tool_call / tool_call_update render as TEXT NOTICES, never structured
  # toolcall_* (the ACP child already executed the tool). Also locks the
  # context→ACP-prompt transcript passthrough (excludes systemPrompt/thinking,
  # single text block). Pure, no live backend.
  section "ACP event mapper (S2c notification→stream + context)"
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-acp-event-mapper.ts)
}

check_acp_prompt_builder() {
  # Deterministic gate for the S2d bootstrapPath-scoped ACP prompt builder (핀4).
  # Proves prompt SCOPE follows bootstrapPath: new=full transcript (history
  # carrier), reuse/resume/load=latest user delta (first user after last
  # assistant, SessionStart hook skipped, image marker kept, prior history
  # excluded so a reuse session is not re-injected its own history). Pure, no
  # session store yet — locks the builder before S2d wires the reuse paths.
  section "ACP prompt builder (S2d bootstrapPath prompt scope)"
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-acp-prompt-builder.ts)
}

check_acp_config() {
  # Deterministic gate for the S2g operator provider-config loader. Locks:
  # global+project merge (project overrides defined keys only; mcpServers merge
  # per-name with project win), defaults (strict-mcp-config on, [] sources,
  # baseline tools), fail-loud on invalid mcpServers/skillPlugins/
  # appendSystemPrompt:true/strictMcpConfig:false, nonempty skillPlugins auto-add
  # Skill+Skill(*), deterministic sorted mcp hash sensitive to command/env/url/
  # headers, and envelope enrich (PI_SESSION_ID/PI_AGENT_ID into entwurf-bridge
  # only, stale filtered, post-hash). Pure + temp-dir settings I/O, no child/spawn.
  section "ACP provider config (S2g operator mcpServers/skillPlugins/tools passthrough)"
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-acp-config.ts)
}

check_acp_session_store() {
  # Deterministic gate for the S2d-1b-1 session store / signature / bootstrap
  # decision. Locks: model-lock fail-loud throw in the pure decision, prefix-
  # compat (only a prefix history reuses; edited/compaction → new), carrier
  # drift → signature change → incompatible, and bootstrapPath ⟂ lifecyclePolicy
  # (turn-scoped/-p one-shot is ALWAYS new — no in-memory reuse, no persisted
  # resume/load in the first cut). Pure + temp-dir record I/O, no child/spawn.
  section "ACP session store (S2d-1b-1 signature/compat/bootstrap decision)"
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-acp-session-store.ts)
}

check_acp_backend_preflight() {
  # Deterministic gate for the S2c runtime tool-surface preflight. Calls
  # streamShellAcp with a context whose declared tools exclude a built-in the
  # Claude child still exposes (read) and asserts the turn fails fast into the
  # returned stream as an error event BEFORE any spawn — proving
  # assertExcludeToolsHonored is wired into the live provider path, not just the
  # pure gate. No backend launched (preflight throws first). Pure.
  section "ACP backend preflight (S2c runtime exclude-tools wiring)"
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-acp-backend-preflight.ts)
}

check_acp_session_reuse() {
  # Deterministic gate for S2d-1b-2b in-memory session reuse (backend.ts). Injects
  # a fake spawn/connection seam and CAPTURES each turn's prompt payload to prove
  # reuse is DELTA-ONLY: turn 2 carries the new nonce, never the turn-1 history,
  # with no second spawn/newSession. Also proves the mutable activePromptHandler
  # routes each turn's notices to its own stream, a persisted record is NOT
  # resumed in 1b-2b, a concurrent prompt fails loud (busy), the reused child is
  # never torn down between turns, and source-locks buildAcpPrompt wiring +
  # single-site applyAcpSessionUpdate via the router. No real child launched.
  section "ACP session reuse (S2d-1b-2b delta-only capture + mutable routing)"
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-acp-session-reuse.ts)
}

check_acp_carrier_augment() {
  # Deterministic gate for S2d-1c billing carrier (engraving) + first-user augment.
  # Separate axis from the reuse gate (GPT c32a6c8): locks that the carrier is
  # SHORT/empty-by-default/pure and folds into bridgeConfigSignature (so a carrier
  # change invalidates reuse but a stable carrier never rebuilds), and that the
  # rich augment rides the `new` prompt on the WIRE only — never the pi Context,
  # so it never enters contextMessageSignatures — with entwurf cwd/AGENTS.md
  # de-dup. Pure + temp-dir fs, no spawn.
  section "ACP carrier + augment (S2d-1c engraving + first-user augment)"
  (cd "$REPO_DIR" && node --experimental-strip-types scripts/check-acp-carrier-augment.ts)
}

check_pack() {
  # Dry-run tarball invariant gate for the public npm surface.
  #
  # Runs `npm pack --dry-run --json`, then asserts:
  #   - runtime-critical files and the public verification/docs
  #     surface (run.sh, scripts/, curated docs/assets/*.gif,
  #     demo/) are present;
  #   - private/dev residue is absent (session dumps, debug logs,
  #     dev configs, workspace metadata, the OpenClaw plugin
  #     monorepo sibling that ships as its own npm package).
  #
  # Scope: this is the first of four checks in #13's publish gate.
  # The remaining three — actual `npm pack`, `tar -tf`, and local
  # install smoke from the packed tarball — are covered by
  # check_pack_install() below (commit 9e2a2ca, Phase 2.3 closeout).
  # Intent + policy live in NEXT.md Phase 2.3.
  section "pack invariants (dry-run)"

  local json
  json=$(cd "$REPO_DIR" && npm pack --dry-run --json 2>/dev/null) || {
    fail "[check-pack] npm pack --dry-run failed"
    return 1
  }

  local file_list
  file_list=$(node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    if (!Array.isArray(data) || data.length !== 1) {
      console.error("[check-pack] expected single tarball entry, got " +
        (Array.isArray(data) ? data.length : "non-array"));
      process.exit(2);
    }
    for (const f of data[0].files) console.log(f.path);
  ' <<<"$json") || {
    fail "[check-pack] failed to parse npm pack output"
    return 1
  }

  # .sh mode regression gate. The repo tracks 100755 in git, but if a
  # contributor's umask or a stray `git update-index --chmod=-x` drops
  # the bit the tarball will ship 0644 — and pi install hands the
  # tarball straight to `npm install`, so the bit needs to survive the
  # whole publish pipeline. Catch it here at dry-run time.
  local sh_mode_violations
  sh_mode_violations=$(node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const bad = data[0].files
      .filter(f => f.path.endsWith(".sh"))
      .filter(f => (f.mode & 0o111) === 0);
    for (const f of bad) console.log(f.path + " mode=0" + (f.mode || 0).toString(8));
  ' <<<"$json") || {
    fail "[check-pack] failed to inspect tarball modes"
    return 1
  }
  if [ -n "$sh_mode_violations" ]; then
    fail "[check-pack] .sh files missing executable bit in tarball:"
    echo "$sh_mode_violations" | sed 's/^/    /' >&2
    return 1
  fi

  local required=(
    "package.json" "README.md" "LICENSE" "CHANGELOG.md"
    "protocol.js" "run.sh"
    "pi-extensions/acp-provider.ts"
    "pi-extensions/lib/acp/models.ts" "pi-extensions/lib/acp/backend.ts"
    "pi-extensions/lib/acp/overlay.ts" "pi-extensions/lib/acp/tool-surface.ts"
    "pi-extensions/lib/acp/event-mapper.ts" "pi-extensions/lib/acp/context.ts"
    "pi-extensions/entwurf-control.ts"
    "pi-extensions/model-lock.ts" "pi-extensions/lib/entwurf-core.ts"
    "mcp/entwurf-bridge/src/index.ts"
    "scripts/postinstall-chmod.cjs"
    "pi/entwurf-capabilities.json"
  )

  # Patterns that must NOT appear in the tarball. Anchored where the
  # match should be exact (e.g. ^bench\.sh$); loose where the residue
  # may appear under any path (e.g. \.log$).
  local forbidden_patterns=(
    'pi-session-.*\.html$'
    '\.log$'
    '\.cast$'
    '^bench\.sh$'
    '^biome\.json$'
    '^tsconfig\.json$'
    '^pnpm-(lock\.yaml|workspace\.yaml)$'
    '^NEXT\.md$'
    '^plugins/'
    '^node_modules/'
    '\.tmp-verify/'
    '\.agent-(reports|shell)/'
  )

  local pass=1 f pat hit

  for f in "${required[@]}"; do
    if ! grep -qxF "$f" <<<"$file_list"; then
      fail "[check-pack] MISSING required: $f"
      pass=0
    fi
  done

  for pat in "${forbidden_patterns[@]}"; do
    hit=$(grep -E "$pat" <<<"$file_list" || true)
    if [ -n "$hit" ]; then
      fail "[check-pack] FORBIDDEN matches pattern $pat:"
      echo "$hit" | sed 's/^/    /' >&2
      pass=0
    fi
  done

  local total
  total=$(printf '%s\n' "$file_list" | wc -l | tr -d ' ')
  echo "[check-pack] $total files in tarball"

  if [ "$pass" = "1" ]; then
    ok "[check-pack] invariants pass"
    return 0
  fi
  fail "[check-pack] invariants violated"
  return 1
}

check_pack_install() {
  # Heavy publish gate. Runs the remaining three checks in #13's
  # publish checklist that check_pack (dry-run only) does not cover:
  #
  #   2. actual `npm pack` — produces the real tarball
  #   3. `tar -tf` — cross-checks contents against dry-run invariants
  #   4. fresh-temp project local install smoke — pnpm add the tarball
  #      with required peers, then import('@junghanacs/entwurf/package.json')
  #      to confirm the installed shape resolves end-to-end.
  #
  # Excluded from the default `pnpm check` because the install smoke
  # spends 5-15s on dependency resolution. Wired into prepublishOnly
  # so `npm publish` cannot succeed if the actual install path is
  # broken even when dry-run invariants look fine.
  #
  # Force --dry-run=false because `npm publish --dry-run` exports
  # npm_config_dry_run=true into lifecycle scripts. Without the explicit
  # override, this nested actual-pack smoke prints the tarball name but
  # does not write the .tgz file, causing prepublishOnly to fail before
  # a real publish can be exercised.
  section "publish install smoke (actual pack + tar + fresh install)"

  local version tgz_name tgz_path
  version=$(node -p "require('${REPO_DIR}/package.json').version")
  # Scoped npm packages produce a tarball named "<scope>-<name>-<version>.tgz"
  # where the `@` is stripped and `/` becomes `-`. For `@junghanacs/entwurf`
  # that lands as `junghanacs-entwurf-<version>.tgz`. Hardcoded against
  # the scope above so a name change cannot silently slide past this gate.
  tgz_name="junghanacs-entwurf-${version}.tgz"
  tgz_path="${REPO_DIR}/${tgz_name}"
  rm -f "$tgz_path"

  echo "[check-pack-install] npm pack -> ${tgz_name}"
  (cd "$REPO_DIR" && npm pack --dry-run=false 2>&1 | tail -1) || {
    fail "[check-pack-install] npm pack failed"
    return 1
  }

  if [ ! -f "$tgz_path" ]; then
    fail "[check-pack-install] tarball not produced: $tgz_path"
    return 1
  fi

  # tar -tf invariants — cross-check against dry-run shape. Same
  # required/forbidden axes as check_pack; if they disagree, the
  # dry-run resolver and the actual tarball diverged (npm bug or
  # files allowlist drift) and publish must not proceed.
  local tar_files pass=1 f pat
  tar_files=$(tar -tf "$tgz_path" | sed 's|^package/||' | grep -v '/$' || true)

  # Required tarball contents. The old 0.11.0 ACP root files (index.ts,
  # acp-bridge.ts, event-mapper.ts, engraving.ts, pi-context-augment.ts,
  # pi-extensions/entwurf.ts) were removed on v2-only and are GONE — keeping them
  # here made this heavy gate silently RED (publish-blocking) while `pnpm check`
  # (which runs only check-pack, not check-pack-install) stayed green. The ACP
  # plugin re-enters on v2 as the provider entry + lib/acp/* modules below.
  local tar_required=(
    "package.json" "README.md" "LICENSE" "CHANGELOG.md"
    "protocol.js" "run.sh"
    "pi-extensions/acp-provider.ts"
    "pi-extensions/lib/acp/models.ts" "pi-extensions/lib/acp/backend.ts"
    "pi-extensions/lib/acp/overlay.ts" "pi-extensions/lib/acp/tool-surface.ts"
    "pi-extensions/lib/acp/event-mapper.ts" "pi-extensions/lib/acp/context.ts"
    "pi-extensions/entwurf-control.ts"
    "pi-extensions/model-lock.ts" "pi-extensions/lib/entwurf-core.ts"
    "mcp/entwurf-bridge/src/index.ts"
    "scripts/postinstall-chmod.cjs"
    "pi/entwurf-capabilities.json"
  )
  for f in "${tar_required[@]}"; do
    if ! grep -qxF "$f" <<<"$tar_files"; then
      fail "[check-pack-install] tar missing required: $f"
      pass=0
    fi
  done

  local tar_forbidden=(
    'pi-session-.*\.html$' '\.log$' '\.cast$'
    '^bench\.sh$' '^biome\.json$' '^tsconfig\.json$'
    '^pnpm-(lock\.yaml|workspace\.yaml)$' '^NEXT\.md$'
    '^plugins/' '^node_modules/'
    '\.tmp-verify/' '\.agent-(reports|shell)/'
  )
  for pat in "${tar_forbidden[@]}"; do
    local hit
    hit=$(grep -E "$pat" <<<"$tar_files" || true)
    if [ -n "$hit" ]; then
      fail "[check-pack-install] tar contains forbidden pattern $pat:"
      echo "$hit" | sed 's/^/    /' >&2
      pass=0
    fi
  done

  if [ "$pass" != "1" ]; then
    rm -f "$tgz_path"
    fail "[check-pack-install] tar -tf invariants violated"
    return 1
  fi
  echo "[check-pack-install] tar -tf invariants pass ($(printf '%s\n' "$tar_files" | wc -l | tr -d ' ') files)"

  # Fresh-temp install smoke. Uses pnpm because that is what this
  # repo packages with; --ignore-workspace stops it from re-attaching
  # to our pnpm-workspace.yaml; --ignore-scripts blocks the husky
  # prepare hook (and any future install scripts) from running inside
  # the consumer project. Peer deps are pinned to the 0.79.x release
  # baseline so the smoke matches the same shape an external pi user
  # would have after `pi install`.
  local tmp
  tmp=$(mktemp -d -t entwurf-install-smoke.XXXXXX)
  trap 'rm -rf "$tmp" "$tgz_path"' RETURN

  printf '%s\n' '{ "name": "entwurf-install-smoke", "version": "0.0.0", "private": true }' > "$tmp/package.json"

  echo "[check-pack-install] pnpm add into $tmp (with 0.79.x peers + typebox)"
  local install_log
  install_log=$(cd "$tmp" && pnpm add \
    "$tgz_path" \
    "@earendil-works/pi-ai@0.79.8" \
    "@earendil-works/pi-coding-agent@0.79.8" \
    "@earendil-works/pi-tui@0.79.8" \
    "typebox@latest" \
    --ignore-workspace --ignore-scripts 2>&1) || {
    fail "[check-pack-install] pnpm add failed:"
    echo "$install_log" | tail -10 | sed 's/^/    /' >&2
    return 1
  }

  # Resolve the installed package.json and confirm pi.extensions
  # arrived intact. If pi.extensions is empty or missing, the
  # consumer pi runtime would fail to register any extension.
  local probe
  probe=$(cd "$tmp" && node --input-type=module -e "
    const m = await import('@junghanacs/entwurf/package.json', { with: { type: 'json' } });
    const pkg = m.default;
    const exts = Array.isArray(pkg.pi?.extensions) ? pkg.pi.extensions.length : 0;
    if (exts === 0) { console.error('pi.extensions missing or empty'); process.exit(1); }
    console.log(pkg.version + ' (' + exts + ' extensions)');
  " 2>&1) || {
    fail "[check-pack-install] installed package probe failed:"
    echo "$probe" | sed 's/^/    /' >&2
    return 1
  }
  echo "[check-pack-install] installed: $probe"

  # Pi package loader smoke — actual `pi` reads the manifest and
  # registers the provider. rc=0 + the curated model list in the
  # output means pi accepted the package as a real extension, not
  # just a well-shaped npm tarball. `--list-models` does not spawn
  # the Claude/Codex/Gemini backends, so this stays credential-free
  # and safe to run in CI. Output goes to stderr; capture both
  # streams with 2>&1.
  if ! command -v pi >/dev/null 2>&1; then
    fail "[check-pack-install] pi binary not on PATH — cannot run loader smoke"
    return 1
  fi

  local loader_out
  loader_out=$(cd "$tmp" && pi -e "$tmp/node_modules/@junghanacs/entwurf" --list-models entwurf 2>&1) || {
    fail "[check-pack-install] pi loader smoke failed (exit non-zero):"
    echo "$loader_out" | tail -10 | sed 's/^/    /' >&2
    return 1
  }
  if ! grep -q "entwurf" <<<"$loader_out"; then
    fail "[check-pack-install] pi loader output missing entwurf model surface:"
    echo "$loader_out" | tail -10 | sed 's/^/    /' >&2
    return 1
  fi
  # Verify the full curated Claude surface is visible: the Sonnet row AND the
  # opus anchor (CURATED_ANCHOR_MODEL_ID in lib/acp/models.ts — the model whose
  # absence is a hard registry regression). Checking only one would let half the
  # surface drop silently.
  for anchor in "claude-sonnet-4-6" "claude-opus-4-8"; do
    if ! grep -q "$anchor" <<<"$loader_out"; then
      fail "[check-pack-install] pi loader output missing curated Claude model $anchor:"
      echo "$loader_out" | tail -10 | sed 's/^/    /' >&2
      return 1
    fi
  done
  echo "[check-pack-install] pi loader smoke pass (entwurf registered, claude-sonnet-4-6 + claude-opus-4-8 anchor)"

  ok "[check-pack-install] publish install smoke pass"
  return 0
}


# --- v2 install/runtime verification gates ---
#
# These validators complement the local deterministic check_* gates by exercising
# the runtime surfaces an installed v2 package depends on. On v2-only, setup must
# NOT run the legacy ACP/v1 Axis 1 interview gates (session-messaging/sentinel):
# those call removed surfaces and survive only as fail-loud reference subcommands
# until rewritten onto entwurf_v2. The release-gate owns the heavier live v2
# substrate proof (matrix-live + spawn-resume-live).

validate_entwurf_bridge() {
  local bridge_dir="$REPO_DIR/mcp/entwurf-bridge"
  local raw

  if [ ! -x "$bridge_dir/start.sh" ]; then
    fail "entwurf-bridge: launcher missing at $bridge_dir/start.sh"
    return 1
  fi

  log "entwurf-bridge: direct MCP smoke (strip-types launcher, no build step)"

  if ! raw=$(cd "$bridge_dir" && node --input-type=module <<'JS'
import { spawn } from 'node:child_process';

const child = spawn('./start.sh');
let stdout = '';
let stderr = '';
let done = false;

function finishOk(trimmed) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  if (stderr.trim()) console.error(stderr.trim());
  const msg = JSON.parse(trimmed);
  const tools = msg?.result?.tools;
  if (!Array.isArray(tools)) {
    console.error('tools/list response missing result.tools');
    process.exit(1);
  }
  const names = tools.map((t) => t?.name).sort();
  const expected = ['entwurf_peers', 'entwurf_self', 'entwurf_inbox_read', 'entwurf_v2'];
  for (const name of expected) {
    if (!names.includes(name)) {
      console.error(`missing MCP tool: ${name}`);
      process.exit(1);
    }
  }
  console.log(names.join(','));
  child.kill('SIGTERM');
  process.exit(0);
}

child.stdout.on('data', (d) => {
  stdout += d.toString();
  const trimmed = stdout.trim();
  if (trimmed) finishOk(trimmed);
});
child.stderr.on('data', (d) => { stderr += d.toString(); });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');

const timer = setTimeout(() => {
  child.kill('SIGKILL');
  console.error('entwurf-bridge direct smoke timeout');
  process.exit(1);
}, 3000);

child.on('error', (err) => {
  if (done) return;
  clearTimeout(timer);
  console.error(String(err));
  process.exit(1);
});

child.on('close', () => {
  if (done) return;
  clearTimeout(timer);
  const trimmed = stdout.trim();
  if (!trimmed) {
    if (stderr.trim()) console.error(stderr.trim());
    console.error('empty tools/list response');
    process.exit(1);
  }
  finishOk(trimmed);
});
JS
  ); then
    fail "entwurf-bridge: direct MCP smoke failed"
    return 1
  fi
  ok "entwurf-bridge direct MCP smoke ($raw)"

  if ! (cd "$bridge_dir" && ./test.sh >/dev/null); then
    fail "entwurf-bridge: protocol/negative-path tests failed"
    return 1
  fi
  ok "entwurf-bridge test.sh"

  # check-bridge deliberately stops at the objective MCP boundary. Live v2
  # substrate/orchestration is covered by the v2 live smokes, whose assertions
  # parse operational artifacts instead of asking a model to self-report which
  # tool schema it sees. This split keeps check-bridge credential-free and avoids
  # model self-recognition variance blocking setup.
}

check_bridge() {
  section "entwurf-bridge (direct MCP protocol)"
  validate_entwurf_bridge
}


sentinel_run() {
  local sentinel="$REPO_DIR/scripts/sentinel-runner.sh"
  if [ ! -x "$sentinel" ]; then
    fail "sentinel: $sentinel not found or not executable"
    return 1
  fi
  "$sentinel" "$@"
}

session_messaging_run() {
  local smoke="$REPO_DIR/scripts/session-messaging-smoke.sh"
  if [ ! -x "$smoke" ]; then
    fail "session-messaging: $smoke not found or not executable"
    return 1
  fi
  "$smoke" "$@"
}


# setup_all — full entwurf v2 install.
#
# Installs the v2 dispatch substrate + MCP entwurf-bridge into a target project
# and verifies the installed bridge boundary. ACP/v1 backend interview gates are
# deliberately not part of setup on v2-only; the heavier live v2 substrate proof
# is release-gate's job.
#
# An external harness that consumes entwurf (e.g. agent-config as a
# pi package + skills set) may still have its own install/setup for its
# own concerns; those are outside the scope of this script.
setup_all() {
  local project_dir
  project_dir=$(normalize_project_dir "$1")

  require_cmd pnpm
  require_cmd python3
  require_cmd pi
  require_cmd node

  # MCP bridge launchers run via `node --experimental-strip-types` (stable in
  # Node 23.6, experimental from 22.6). Anything older lacks the flag, and an
  # ACP session would hit a cryptic "unknown argument" rather than a clear
  # setup-time error. Fail early with an actionable message. package.json
  # engines.node mirrors this floor.
  if ! node -e 'const [M,m]=process.versions.node.split(".").map(Number); process.exit((M>22||(M===22&&m>=6))?0:1)'; then
    echo "[setup] entwurf requires Node >= 22.6.0 (got $(node -v))" >&2
    echo "[setup] MCP bridge launchers depend on --experimental-strip-types." >&2
    exit 1
  fi

  echo "[setup] repo:    $REPO_DIR"
  echo "[setup] project: $project_dir"
  echo "[setup] scope:   entwurf v2 orchestration install (pi-native; ACP backends dropped)"
  echo "[setup] verification: v2 install smoke (entwurf-bridge; LIVE substrate = release-gate)"

  (cd "$REPO_DIR" && pnpm install --frozen-lockfile)
  sync_auth
  install_local_package "$project_dir"

  # Deterministic preflight lives in `pnpm check`; live substrate acceptance lives
  # in `LIVE=1 ./run.sh release-gate <scratch>`. Setup is the install path, so it
  # verifies the installed MCP bridge boundary only and does NOT run the legacy
  # ACP/v1 session-messaging/sentinel gates.
  section "v2 install smoke: entwurf-bridge (direct MCP protocol)"
  validate_entwurf_bridge

  echo ""
  echo "DONE: entwurf setup + v2 install smoke green. Run release-gate for live substrate acceptance."
}

# ---------------------------------------------------------------------------
# xt-tool-surface — ACP backend exclude-tools policy gate (NEXT Step 1e).
#
# pi 0.77 --exclude-tools/-xt removes a tool from pi's active set + "Available
# tools:" system prompt, but the ACP backend CLI keeps its own tool surface that
# entwurf does NOT gate per-tool (Claude gets providerSettings.tools;
# Codex/Gemini expose native shell+file tools regardless). The 0.8.0 policy is
# truthfulness-first FAIL-FAST: excluding a backend-backed built-in
# (read/bash/edit/write) is rejected up front (index.ts assertExcludeToolsHonored)
# rather than silently letting the backend keep the tool (declared != actual).
#
# This gate asserts, per backend, that `pi --provider entwurf -xt <builtin>`
# is rejected before backend launch with the policy error and runs NO tool — and
# (positive control) that excluding an EXTENSION tool (entwurf) is NOT rejected,
# because extension tools are pi-side and never reach the backend.
# ---------------------------------------------------------------------------
xt_tool_surface_single() {
  local backend=$1 model=$2 excluded=$3
  local out
  out=$(timeout 120 pi --mode json -p -e "$REPO_DIR" \
    --provider entwurf --model "$model" -xt "$excluded" \
    "say hi" 2>&1) || true
  if ! echo "$out" | grep -q "cannot honor --exclude-tools ($excluded) on the $backend backend"; then
    fail "xt-tool-surface[$backend]: expected fail-fast on -xt $excluded, got none"
    echo "$out" | tail -5
    return 1
  fi
  # Fail-fast fires before backend launch, so no tool may have executed.
  if echo "$out" | grep -q '"type":"tool_execution_start"'; then
    fail "xt-tool-surface[$backend]: policy error present BUT a tool still executed — not fail-fast"
    return 1
  fi
  ok "xt-tool-surface[$backend]: -xt $excluded rejected up front (declared==actual upheld)"
  return 0
}

xt_tool_surface_extension_honored() {
  # Positive control: excluding an EXTENSION tool is honored (pi-side), so the
  # policy guard must NOT trip — the backend launches normally.
  local backend=$1 model=$2
  local out
  out=$(timeout 120 pi --mode json -p -e "$REPO_DIR" \
    --provider entwurf --model "$model" -xt entwurf \
    "reply with the single word ok" 2>&1) || true
  if echo "$out" | grep -q "cannot honor --exclude-tools"; then
    fail "xt-tool-surface[$backend]: -xt entwurf wrongly tripped the guard (extension tools must be exempt)"
    echo "$out" | tail -5
    return 1
  fi
  ok "xt-tool-surface[$backend]: -xt entwurf honored (extension exclusion not blocked)"
  return 0
}

xt_tool_surface() {
  local failc=0
  section "xt-tool-surface: claude backend (-xt bash)"
  xt_tool_surface_single claude claude-sonnet-4-6 bash || failc=$((failc + 1))
  # Claude-only floor (0.11.0): the codex and gemini -xt rows are dropped.
  section "xt-tool-surface: extension-tool exemption (positive control)"
  xt_tool_surface_extension_honored claude claude-sonnet-4-6 || failc=$((failc + 1))
  if [ "$failc" -gt 0 ]; then
    fail "xt-tool-surface: $failc check(s) failed"
    return 1
  fi
  ok "xt-tool-surface: claude fails fast on built-in -xt; extension exclusion honored"
  return 0
}

# release-gate — the single command that, when GREEN, is sufficient to cut
# release cuts. Runs the full static floor (`pnpm check`) followed by the
# v2-native live gates, then emits one PASS/FAIL/SKIP summary. Everything is
# invoked through run.sh subcommands — never a script in scripts/ directly.
#
# Design invariants (NEXT Step 1e + GPT-5.5 reviews):
#   - v2-native live floor: the MUST tier is the v2 dispatch substrate
#     (smoke-entwurf-v2-matrix-live + smoke-entwurf-v2-spawn-resume-live, opt-in
#     LIVE), the MCP bridge (check-bridge), and the garden-native substrate/guard
#     (smoke-session-id-name on a pi-native target via PI_SHELL_ACP_LIVE_TARGET,
#     and smoke-resident-garden-guard).
#   - ACP plugin acceptance floor (S0~S2g): the 10 ACP LIVE smokes
#     (socket-citizen/raw-turn/overlay/provider/session-reuse/carrier-augment/rgg
#     + S2g mcp/skill config passthrough + S2g axis-3 bundled-mcp resident/RPC)
#     are MUST, not BEHAVIOR — they prove programmatic transport/provider/backend
#     invariants of the ACP plugin on the v2 core, so a failure is a release
#     defect, not an advisory model-in-loop signal. Each is LIVE-gated honest-SKIP.
#   - v1 entwurf verbs are gone (v2 core): the old xt-tool-surface / session-messaging
#     / sentinel floor gates do not exist on this tree. --allow-skip-gemini is
#     accepted-but-ignored (back-compat).
#   - Final release authorization is GLG's, not this script's: a green
#     run is necessary, and the operator closes the decision.
release_gate() {
  local -a positional=()
  local a
  for a in "$@"; do
    case "$a" in
      --allow-skip-gemini) ;;  # accepted-but-ignored: gemini removed from the claude-only floor (back-compat for existing scripts)
      *) positional+=("$a") ;;
    esac
  done
  local project_dir
  project_dir=$(normalize_project_dir "${positional[0]:-$PROJECT_DIR_DEFAULT}")

  # Absolute path to this script — survives the `cd "$project_dir"` below. The
  # live gates derive their pi session dir from $PWD (tmux `-c "$PWD"`,
  # PROJECT_DIR_DEFAULT, and the bare `pi -p` invocations that don't `cd`
  # themselves). Some gates (e.g. check-bridge and the garden guard) take no
  # project arg, so if release-gate runs from the repo their sessions could land
  # in the repo's own session dir — polluting the very
  # tree we ship and breaking the "scratch full gate" evidence claim. Running
  # EVERY live gate with PWD=project_dir makes a single
  # `./run.sh release-gate <scratch>` invocation route all sessions to scratch
  # regardless of the operator's cwd. `-e "$REPO_DIR/..."` (extension load) and
  # every other path the gates touch are absolute, so the cd is safe.
  #
  # The two garden-native identity gates (smoke-session-id-name,
  # smoke-resident-garden-guard) also take no project arg but are exempt from
  # the repo-pollution concern by construction: the substrate smoke runs every
  # pi turn under its own os.tmpdir() agent dir + cwds (mkdtemp, cleaned up),
  # and the guard is wired here as the NEGATIVE path only — a 0-token fail-fast
  # that writes no session file at all.
  #
  # smoke-acp-bundled-mcp-live is a DELIBERATE exception to the PWD=project_dir
  # routing: it runs its resident with cwd=os.tmpdir() and relies on the
  # operator's INSTALLED bundled bridge (global ~/.pi/agent/settings.json
  # entwurfProvider.mcpServers.entwurf-bridge) — that IS the operator circuit
  # this axis restores, not a scratch-isolated probe (that is smoke-acp-mcp-live's
  # job). It writes only a tmpdir-cwd session (no repo pollution) and fails loud if
  # the operator has not wired the bundled bridge.
  local self="$REPO_DIR/run.sh"
  gate() { ( cd "$project_dir" && "$@" ); }

  local pass=0 failc=0 skip=0
  local -a results=()

  run_step() {
    local name="$1"; shift
    section "release-gate step: $name"
    if "$@"; then
      ok "$name: PASS"
      results+=("PASS  $name"); pass=$((pass + 1))
    else
      fail "$name: FAIL"
      results+=("FAIL  $name"); failc=$((failc + 1))
    fi
  }

  # LIVE-gated MUST step: a release-blocking gate that needs a real backend turn
  # (auth/model/credit). When LIVE!=1 it is an HONEST SKIP — counted as SKIP, NOT
  # PASS — so an unattended `./run.sh release-gate` stays runnable without faking
  # coverage. A release CUT therefore requires `LIVE=1 ./run.sh release-gate
  # <scratch>` to land MUST PASS with SKIP=0; a green run that still shows SKIP is
  # CI safety, never live acceptance. (Same rule the v2 substrate sentinels below
  # spell out inline; this helper applies it to the ACP plugin acceptance floor.)
  run_live_step() {
    local name="$1"; shift
    section "release-gate step: $name"
    if [ "${LIVE:-}" = "1" ]; then
      if "$@"; then
        ok "$name: PASS"
        results+=("PASS  $name"); pass=$((pass + 1))
      else
        fail "$name: FAIL"
        results+=("FAIL  $name"); failc=$((failc + 1))
      fi
    else
      warn "$name: LIVE!=1 — skipped (opt-in: needs auth/model — NOT a live acceptance run)"
      results+=("SKIP  $name (LIVE!=1)"); skip=$((skip + 1))
    fi
  }

  # BEHAVIOR lane (0.11.0, GLG+GPT+Opus): a SEPARATE advisory counter for
  # model-in-loop gates that probe whether the *model* autonomously selects the
  # MCP entwurf surface (vs. bypassing via Bash/Terminal/pi-CLI). These gates are
  # flaky by the model's nature (Claude Sonnet's MCP-vs-Bash choice is
  # non-deterministic on 0.79.4), so a single flake must NOT block the cut. They
  # are NEVER folded into `failc`/`pass` — exit authority below is `failc` only.
  # Honesty rails: (1) "non-blocking" is NOT "pass" — a BEHAVIOR-FAIL is surfaced
  # loudly in the summary with its artifact path, never buried; (2) S7 (Bash
  # bypass, sentinel-runner.sh) stays a hard FAIL *inside* this lane — a bypass is
  # never relabelled a pass; (3) the entwurf_v2 surface itself is proven by the
  # deterministic/programmatic must-pass gates above (check-entwurf-v2-*,
  # check-bridge) — this lane is autonomous-tool-selection *behavior*, not
  # *function*. Residual bypass → 0.11.x usability lane.
  local behavior_pass=0 behavior_failc=0
  local -a behavior_results=()

  run_behavior_step() {
    local name="$1"; shift
    section "release-gate BEHAVIOR step (advisory, non-blocking): $name"
    if "$@"; then
      ok "$name: BEHAVIOR-PASS"
      behavior_results+=("BEHAVIOR-PASS  $name"); behavior_pass=$((behavior_pass + 1))
    else
      warn "$name: BEHAVIOR-FAIL (advisory — model-in-loop signal; S7=Bash-bypass stays hard-fail here; NOT a cut blocker)"
      behavior_results+=("BEHAVIOR-FAIL  $name"); behavior_failc=$((behavior_failc + 1))
    fi
  }

  # 1. Static floor (deterministic; includes the two folded gates).
  section "release-gate step: static (pnpm check)"
  if (cd "$REPO_DIR" && pnpm check); then
    ok "static (pnpm check): PASS"
    results+=("PASS  static (pnpm check)"); pass=$((pass + 1))
  else
    fail "static (pnpm check): FAIL"
    results+=("FAIL  static (pnpm check)"); failc=$((failc + 1))
  fi

  # 2. (gemini-availability step removed — claude-only floor; gemini CLI is
  #    deprecated, so the gate no longer asserts a three-backend claim.)

  # 3. Live per-invariant gates (each is a run.sh subcommand). Every one runs
  #    with PWD=project_dir (via gate()) so cwd-derived pi session dirs land in
  #    the scratch project, never the repo — see the note above.
  #
  #    Foundational garden-native identity gates run first (0.9.0, #28): the
  #    substrate proof (Pi --session-id/--name through the bridge) and the
  #    resident --entwurf-control guard (non-garden id → 0-token fail-fast,
  #    PLUS the positive path: a garden id resident actually boots, gets a
  #    control-tagged name, and is never entwurf-resumable). If the identity
  #    foundation is broken, every Entwurf live gate below is meaningless, so
  #    fail fast here. Negative path is 0-token; positive path is ~1 cheap turn;
  #    the substrate smoke is a few cheap turns.
  run_step "smoke-session-id-name (3a substrate)" gate bash "$self" smoke-session-id-name
  # RGG split (0.11.0): the deterministic half (negative/id-safety + /gnew
  # zero-token live path) is release-blocking and stays here as a must-pass with
  # SMOKE_RGG_POSITIVE=0. The model-in-loop half (post-/gnew backend entwurf_self
  # identity turn [T3] + positive garden --session-id model turn) is gated behind
  # SMOKE_RGG_POSITIVE=1 and runs in the BEHAVIOR lane below — advisory, because
  # it depends on the backend child autonomously calling entwurf_self.
  run_step "smoke-resident-garden-guard (3c guard: negative/id-safety + /gnew 0-token, deterministic)" gate env SMOKE_RGG_POSITIVE=0 bash "$self" smoke-resident-garden-guard
  run_step "check-bridge"                   gate bash "$self" check-bridge
  # D4-c: the v2 dispatch substrate sentinel (5d-5). A SINGLE run (NOT backend-looped — it proves
  # production runEntwurfV2 deps + real pi control-socket RPC + real mailbox enqueue + v2 lock, not
  # per-backend model behavior). Placed right after check-bridge: the MCP/protocol substrate must be
  # green first so a matrix-live failure reads as "v2 transport/lock/enqueue", not bridge basics.
  # Opt-in LIVE: it spawns a real `pi --entwurf-control` (needs auth/model), so LIVE!=1 is an HONEST
  # SKIP (not a PASS) — an unattended release-gate stays runnable without faking coverage. Independent
  # of --allow-skip-gemini (now a no-op back-compat flag on the claude-only floor; this gates substrate auth).
  section "release-gate step: smoke-entwurf-v2-matrix-live"
  if [ "${LIVE:-}" = "1" ]; then
    if gate env LIVE=1 bash "$self" smoke-entwurf-v2-matrix-live; then
      ok "smoke-entwurf-v2-matrix-live: PASS"
      results+=("PASS  smoke-entwurf-v2-matrix-live"); pass=$((pass + 1))
    else
      fail "smoke-entwurf-v2-matrix-live: FAIL"
      results+=("FAIL  smoke-entwurf-v2-matrix-live"); failc=$((failc + 1))
    fi
  else
    warn "smoke-entwurf-v2-matrix-live: LIVE!=1 — skipped (v2 substrate sentinel, opt-in: needs auth/model)"
    results+=("SKIP  smoke-entwurf-v2-matrix-live (LIVE!=1)"); skip=$((skip + 1))
  fi
  # 0.11.0 (A) acceptance: the FULL spawn-bg resident lifecycle — a real `pi` resume child stands
  # its control socket up, does a model turn, lock released ×1. Placed right after matrix-live (the
  # transport sentinel): a spawn-resume failure then reads as "resume/resident lifecycle", not
  # transport basics. Same opt-in LIVE rule — LIVE!=1 is an HONEST SKIP (model-in-loop, needs
  # auth/model). NOTE: a 0.11.0 tag REQUIRES `LIVE=1 ./run.sh release-gate` (or this step direct)
  # to PASS — the SKIP is CI safety, never acceptance.
  section "release-gate step: smoke-entwurf-v2-spawn-resume-live"
  if [ "${LIVE:-}" = "1" ]; then
    if gate env LIVE=1 bash "$self" smoke-entwurf-v2-spawn-resume-live; then
      ok "smoke-entwurf-v2-spawn-resume-live: PASS"
      results+=("PASS  smoke-entwurf-v2-spawn-resume-live"); pass=$((pass + 1))
    else
      fail "smoke-entwurf-v2-spawn-resume-live: FAIL"
      results+=("FAIL  smoke-entwurf-v2-spawn-resume-live"); failc=$((failc + 1))
    fi
  else
    warn "smoke-entwurf-v2-spawn-resume-live: LIVE!=1 — skipped (0.11.0 A acceptance, opt-in: needs auth/model)"
    results+=("SKIP  smoke-entwurf-v2-spawn-resume-live (LIVE!=1)"); skip=$((skip + 1))
  fi

  # 3b. ACP plugin acceptance floor (S0~S2f live). These prove the ACP plugin's
  #     programmatic transport/provider/backend invariants on the v2 core — NOT
  #     model-in-loop autonomous tool-selection — so they belong in the MUST tier,
  #     not BEHAVIOR. Their deterministic counterparts (check-acp-*, check-auth-
  #     boundary, check-acp-overlay/tool-surface/event-mapper/prompt-builder/
  #     session-store/session-reuse/carrier-augment) already run inside `pnpm
  #     check` above; these are the LIVE acceptance halves. Ordered from the
  #     cheapest, most foundational invariant outward: turn-free citizenship →
  #     pinned ACP pipe/auth → overlay/tool meta → real pi provider path (+
  #     progress visibility / L3 marker) → process-scoped reuse + semantic recall
  #     → first-user augment delivery + empty-carrier billing-clean (핀1) →
  #     ACP-target garden guard (deterministic half). Opt-in LIVE: LIVE!=1 is an
  #     HONEST SKIP via run_live_step (see its note) — a CUT needs LIVE=1, SKIP=0.
  run_live_step "smoke-acp-socket-citizen-live (S1: turn-free socket citizenship)"        gate env LIVE=1 bash "$self" smoke-acp-socket-citizen-live
  run_live_step "smoke-acp-raw-turn-live (S2a: pinned ACP pipe + local auth)"             gate env LIVE=1 bash "$self" smoke-acp-raw-turn-live
  run_live_step "smoke-acp-overlay-live (S2b: config overlay + hooks:{} + tool meta)"     gate env LIVE=1 bash "$self" smoke-acp-overlay-live
  run_live_step "smoke-acp-provider-live (S2c/S2f: real pi provider path + progress/L3)"  gate env LIVE=1 bash "$self" smoke-acp-provider-live
  run_live_step "smoke-acp-session-reuse-live (S2d: process-scoped reuse + recall)"       gate env LIVE=1 bash "$self" smoke-acp-session-reuse-live
  run_live_step "smoke-acp-carrier-augment-live (S2e-1: augment delivery + 핀1 billing)"  gate env LIVE=1 bash "$self" smoke-acp-carrier-augment-live
  run_live_step "smoke-acp-memory-containment-live (Gate D: no overlay memory leak)"      gate env LIVE=1 bash "$self" smoke-acp-memory-containment-live
  run_live_step "smoke-acp-rgg-live (S2e-2: ACP-target garden guard, deterministic half)" gate env LIVE=1 bash "$self" smoke-acp-rgg-live
  run_live_step "smoke-acp-mcp-live (S2g: operator mcpServers reach the live ACP session)"  gate env LIVE=1 bash "$self" smoke-acp-mcp-live
  run_live_step "smoke-acp-skill-live (S2g: operator skillPlugins reach the live ACP session)" gate env LIVE=1 bash "$self" smoke-acp-skill-live
  run_live_step "smoke-acp-bundled-mcp-live (S2g axis 3: bundled entwurf-bridge via 0.11.0 resident/RPC circuit)" gate env LIVE=1 bash "$self" smoke-acp-bundled-mcp-live

  # 4. BEHAVIOR lane (advisory, non-blocking). Model-in-loop gates that probe
  #     whether the model AUTONOMOUSLY drives the MCP entwurf surface. These never
  #     touch `failc`; the cut is decided by the MUST tier above.
  #
  #     Only genuinely flaky model-in-loop signals live here. Programmatic ACP
  #     plugin invariants are MUST (section 3b above), not BEHAVIOR — a failed
  #     transport/provider/backend smoke is a release defect, not advisory. The old
  #     v1 floor gates (session-messaging / xt-tool-surface / sentinel) do not exist
  #     on the v2 core — the v1 entwurf verbs they exercised are gone.
  # SMOKE_RGG_POSITIVE=1 re-runs the FULL guard with its positives enabled (not a
  # positive-only mode) — the deterministic paths run again here too, but only the
  # two model-in-loop turns (post-/gnew entwurf_self identity [T3] + positive
  # garden model turn) are the reason this run is advisory; the deterministic half
  # is already release-blocking via the POSITIVE=0 must-pass step above.
  run_behavior_step "smoke-resident-garden-guard (positives enabled: post-/gnew entwurf_self identity turn [T3] + positive garden model turn)" gate env SMOKE_RGG_POSITIVE=1 bash "$self" smoke-resident-garden-guard

  # 5. Summary — two tiers. MUST is release-blocking and owns the exit code; the
  #    word "green" is reserved for the MUST tier. BEHAVIOR is advisory and is
  #    surfaced (with per-step artifact paths above) but never blocks the cut.
  section "release-gate summary"
  echo "  MUST (release-blocking):"
  printf '    %s\n' "${results[@]}"
  echo "    MUST: PASS=$pass  FAIL=$failc  SKIP=$skip"
  echo ""
  echo "  BEHAVIOR (advisory, non-blocking — model-in-loop autonomous MCP tool-selection):"
  if [ "${#behavior_results[@]}" -gt 0 ]; then
    printf '    %s\n' "${behavior_results[@]}"
  fi
  echo "    BEHAVIOR: PASS=$behavior_pass  FAIL=$behavior_failc"
  echo "  (per-step artifact paths are printed in each step's output above)"
  if [ "$behavior_failc" -gt 0 ]; then
    echo ""
    warn "BEHAVIOR FAIL present ($behavior_failc) — advisory model-in-loop signal (e.g. S7 Bash-bypass / entwurf_self not autonomously called). Tracked, NOT a cut blocker; see the 0.11.x usability lane."
  fi
  # Exit authority = MUST `failc` ONLY. A BEHAVIOR fail never blocks the cut.
  if [ "$failc" -gt 0 ]; then
    echo ""
    fail "release-gate MUST NOT green — $failc release-blocking step(s) failed. Current release is NOT releasable."
    echo "  A green MUST gate is necessary but not sufficient; GLG closes the call."
    return 1
  fi
  if [ "$behavior_failc" -gt 0 ]; then
    ok "release-gate MUST PASS (all release-blocking steps green); BEHAVIOR FAIL present (advisory). Necessary condition met — GLG authorizes the cut."
  else
    ok "release-gate MUST PASS + BEHAVIOR PASS — all green. Necessary condition met — GLG authorizes the cut."
  fi
  return 0
}

cmd=${1:-}
case "$cmd" in
  setup)
    setup_all "$TARGET_PROJECT_DIR"
    ;;
  release-gate)
    shift || true
    release_gate "$@"
    ;;
  xt-tool-surface)
    warn "xt-tool-surface is LEGACY (ACP backend exclude-tools policy) — broken on v2-only (assumes the removed entwurf provider). Dropped from the release floor; kept for reference, v2 rewrite pending."
    xt_tool_surface
    ;;
  check-bridge)
    check_bridge
    ;;
  sentinel)
    warn "sentinel is LEGACY (ACP multi-backend tool-selection matrix) — broken on v2-only. Dropped from the release floor; kept for reference, v2 rewrite onto the entwurf_v2 surface pending."
    shift || true
    sentinel_run "$@"
    ;;
  session-messaging)
    warn "session-messaging is LEGACY — broken on the v2 core (calls the gone v1 entwurf_send tool). Not on the release floor; kept for reference, v2 rewrite onto entwurf_v2 pending."
    shift || true
    session_messaging_run "$@"
    ;;
  check-model-lock)
    check_model_lock
    ;;
  check-shell-quote)
    check_shell_quote
    ;;
  check-entwurf-session-identity)
    check_entwurf_session_identity
    ;;
  check-meta-session)
    check_meta_session
    ;;
  check-meta-record-v2)
    check_meta_record_v2
    ;;
  check-mailbox-receipt-state)
    check_mailbox_receipt_state
    ;;
  check-entwurf-capabilities)
    check_entwurf_capabilities
    ;;
  check-meta-dual-read)
    check_meta_dual_read
    ;;
  check-meta-mailbox-state-write)
    check_meta_mailbox_state_write
    ;;
  check-meta-receiver-marker)
    check_meta_receiver_marker
    ;;
  check-meta-migration)
    check_meta_migration
    ;;
  check-meta-dual-consumers)
    check_meta_dual_consumers
    ;;
  check-meta-capability-source)
    check_meta_capability_source
    ;;
  check-socket-probe)
    check_socket_probe
    ;;
  check-project-trust-handler)
    check_project_trust_handler
    ;;
  check-entwurf-v2-contract)
    check_entwurf_v2_contract
    ;;
  check-entwurf-v2-lock)
    check_entwurf_v2_lock
    ;;
  check-entwurf-v2-decider)
    check_entwurf_v2_decider
    ;;
  check-entwurf-v2-matrix)
    check_entwurf_v2_matrix
    ;;
  check-entwurf-v2-release)
    check_entwurf_v2_release
    ;;
  check-entwurf-v2-send)
    check_entwurf_v2_send
    ;;
  check-entwurf-v2-send-fallback)
    check_entwurf_v2_send_fallback
    ;;
  check-entwurf-v2-mailbox)
    check_entwurf_v2_mailbox
    ;;
  check-entwurf-v2-runner)
    check_entwurf_v2_runner
    ;;
  check-entwurf-control-rpc)
    check_entwurf_control_rpc
    ;;
  check-entwurf-v2-production)
    check_entwurf_v2_production
    ;;
  check-entwurf-v2-surface)
    check_entwurf_v2_surface
    ;;
  check-entwurf-bridge-boot)
    check_entwurf_bridge_boot
    ;;
  check-entwurf-v2-spawn)
    check_entwurf_v2_spawn
    ;;
  check-entwurf-resume-args)
    check_entwurf_resume_args
    ;;
  check-entwurf-v2-spawn-production)
    check_entwurf_v2_spawn_production
    ;;
  smoke-entwurf-v2-spawn-live)
    smoke_entwurf_v2_spawn_live
    ;;
  smoke-entwurf-v2-spawn-resume-live)
    smoke_entwurf_v2_spawn_resume_live
    ;;
  smoke-entwurf-v2-matrix-live)
    smoke_entwurf_v2_matrix_live
    ;;
  smoke-acp-raw-turn-live)
    smoke_acp_raw_turn_live
    ;;
  smoke-acp-overlay-live)
    smoke_acp_overlay_live
    ;;
  smoke-acp-memory-containment-live)
    smoke_acp_memory_containment_live
    ;;
  smoke-acp-provider-live)
    smoke_acp_provider_live
    ;;
  smoke-acp-session-reuse-live)
    smoke_acp_session_reuse_live
    ;;
  smoke-acp-mcp-live)
    smoke_acp_mcp_live
    ;;
  smoke-acp-skill-live)
    smoke_acp_skill_live
    ;;
  smoke-acp-bundled-mcp-live)
    smoke_acp_bundled_mcp_live
    ;;
  smoke-acp-carrier-augment-live)
    smoke_acp_carrier_augment_live
    ;;
  smoke-acp-rgg-live)
    smoke_acp_rgg_live
    ;;
  smoke-acp-socket-citizen-live)
    smoke_acp_socket_citizen_live
    ;;
  check-entwurf-facts)
    check_entwurf_facts
    ;;
  check-socket-discovery)
    check_socket_discovery
    ;;
  check-meta-listing)
    check_meta_listing
    ;;
  check-entwurf-fact-provider)
    check_entwurf_fact_provider
    ;;
  check-entwurf-peers-surface)
    check_entwurf_peers_surface
    ;;
  check-entwurf-self-address)
    check_entwurf_self_address
    ;;
  check-entwurf-deliverability)
    check_entwurf_deliverability
    ;;
  check-entwurf-mailbox-guard)
    check_entwurf_mailbox_guard
    ;;
  new-session-id)
    # Garden launcher helper: print one fresh garden sessionId (SSOT:
    # generateSessionId). Used by the operator alias to make every
    # --entwurf-control session a garden citizen. Stdout = the id only.
    (cd "$REPO_DIR" && node --experimental-strip-types scripts/new-session-id.ts)
    ;;
  smoke-resident-garden-guard)
    # LIVE negative (0 tokens) + opt-in positive gate for the resident
    # --entwurf-control garden-native enforcement. NEGATIVE: raw uuid session
    # must blow up before any turn. POSITIVE (SMOKE_RGG_POSITIVE=1): garden id
    # passes + control-tagged name.
    (cd "$REPO_DIR" && bash scripts/smoke-resident-garden-guard.sh)
    ;;
  smoke-meta-async-drift)
    # 1.0.0 meta-bridge step 1 (#30): drift sentinel + capability gate. DEFAULT is
    # deterministic/offline — version pins (Claude/codex/agy) + Claude-binary
    # undocumented-behavior marker cross-validation; SCREAMS on drift. LIVE=1 adds
    # the plugin SessionStart watch-arm probe (spawns one metered claude -p).
    (cd "$REPO_DIR" && bash scripts/smoke-meta-async-drift.sh)
    ;;
  smoke-meta-honesty)
    # 1.0.0 meta-bridge HONESTY regression gate (#30 bbot release blockers): the
    # doorbell must count EVERY queued message honestly (blocker #1), and the
    # runtime hook must log a silent registration miss as ` ERROR ` for the doctor
    # to catch while staying best-effort (blocker #2). Offline + deterministic (no
    # claude binary; deps bash+node+python3), so unlike the drift sentinel it is
    # CI/pnpm-check safe.
    (cd "$REPO_DIR" && bash scripts/smoke-meta-honesty.sh)
    ;;
  smoke-meta-prune)
    # 1.0.0 meta-bridge Phase 4 regression gate: synthetic store covering every
    # class (keep/orphan/stale/duplicate/corrupt/drift) proves meta-bridge-prune
    # classifies correctly, exits 0, and deletes NOTHING (listing-only invariant).
    # Offline/deterministic (deps: bash+node).
    (cd "$REPO_DIR" && bash scripts/smoke-meta-prune.sh)
    ;;
  smoke-meta-sender-identity)
    # 0.10.0 meta-bridge blocker: deterministic E2E for native SENDER identity.
    # A SessionStart-written sender marker (parent-pid keyed; PI_META_SENDER_MARKER
    # overrides for the test) promotes an anonymous user-scope MCP send into a
    # REPLYABLE meta-session addressed by garden-id, and REQUIRE_META_SENDER refuses
    # anonymous sends. A↔B round-trip + reject, zero Claude turns. Offline/hermetic
    # (deps: bash+node+python3).
    (cd "$REPO_DIR" && bash scripts/smoke-meta-sender-identity.sh)
    ;;
  smoke-meta-mailbox)
    # 0.10.0 meta-bridge defense C: deterministic E2E for the mailbox messaging
    # axis. entwurf_send fallback (empty PI_ENTWURF_DIR forces no-socket) → meta
    # mailbox enqueue → entwurf_inbox_read drain + lastReadAt receipt, for both a
    # replyable and an external sender, with ZERO Claude turns. Offline/hermetic
    # (deps: bash+node+python3).
    (cd "$REPO_DIR" && bash scripts/smoke-meta-mailbox.sh)
    ;;
  smoke-meta-keyset-guard)
    # 0.10.0 meta-bridge regression gate: the PREVENTIVE keyset guard
    # (check-keyset-overlap) + managed-keys SSOT. Synthetic fragments prove a
    # disjoint consumer passes and exact/array/parent-child collisions fail loud.
    # Offline/hermetic (deps: bash+python3).
    (cd "$REPO_DIR" && bash scripts/smoke-meta-keyset-guard.sh)
    ;;
  smoke-meta-install-state)
    # 1.0.0 meta-bridge Phase 2 regression gate: state file captures pre-install
    # values, install/uninstall touches only the managed keyset, uninstall refuses
    # to guess without state, and the doctor store scan fails on corrupt/
    # duplicate/drift records. Offline + deterministic (deps bash+node+python3).
    (cd "$REPO_DIR" && bash scripts/smoke-meta-install-state.sh)
    ;;
  smoke-claude-native-resume-live)
    # LIVE-only Detour A probe: two real Claude Code native turns (fresh +
    # --resume) in a scratch cwd. Verifies native resume works while the
    # meta-bridge only records backend=claude-code/nativeSessionId/transcriptPath
    # once. Not in pnpm check; does not use the ACP provider.
    (cd "$REPO_DIR" && bash scripts/smoke-claude-native-resume-live.sh)
    ;;
  install-meta-bridge)
    # 1.0.0 meta-bridge step 5: operator-grade GLOBAL install of the garden-native
    # receive plugin. Assembles a self-contained, node-path-baked copy under
    # pi/meta-bridge/.assembled and runs marketplace add + install --scope user, so
    # every native Claude Code session auto-loads it (no manual --plugin-dir).
    # Idempotent; Linux/macOS only (Windows fail-fast).
    (cd "$REPO_DIR" && bash scripts/meta-bridge-install.sh "$@")
    ;;
  uninstall-meta-bridge)
    # 1.0.0 meta-bridge Phase 2: honest inverse of install-meta-bridge. Uses the
    # install-state file to restore original scalar/map values and remove only the
    # permission-array entries entwurf added; without state it refuses to guess.
    (cd "$REPO_DIR" && bash scripts/meta-bridge-uninstall.sh "$@")
    ;;
  doctor-meta-bridge)
    # 1.0.0 meta-bridge Phase 2: the FAIL-LOUD surface. Proves toolchain (incl.
    # python3), stateful managed config, baked node path (NixOS store-churn guard),
    # global plugin install, USER MCP reach, meta-record store integrity, hook log
    # no-ERROR, and actual SessionStart creation evidence. A plugin present with
    # zero claude-code meta-records is a SILENT MISS -> non-zero exit.
    (cd "$REPO_DIR" && bash scripts/meta-bridge-doctor.sh "$@")
    ;;
  meta-bridge-prune)
    # 1.0.0 meta-bridge Phase 4: LISTING-ONLY janitor for the meta-session store.
    # doctor reds on corrupt/duplicate/drift but intentionally does NOT fail on
    # transcript-gone records, so a green store can silently bloat with abandoned
    # records. This surface CLASSIFIES (orphan/stale/ambiguous/keep) and prints
    # the exact manual rm commands. It deletes NOTHING — no --apply in 1.0.0;
    # ambiguous (corrupt/duplicate/drift) stays manual-only (operator picks the
    # surviving authority). Default store = defaultMetaSessionsDir(); pass [dir]
    # + [--ttl-days N] to override.
    shift || true
    (cd "$REPO_DIR" && node --experimental-strip-types scripts/meta-bridge-prune.ts "$@")
    ;;
  meta-bridge-managed-keys)
    # 0.10.0 meta-bridge: emit the SSOT of settings.json/~/.claude.json keys that
    # entwurf's install OWNS. Consumers (agent-config fragment, future
    # harnesses) read this to set only their OWN keys — the keyset-owner invariant.
    (cd "$REPO_DIR" && python3 scripts/meta-bridge-state.py managed-keys)
    ;;
  check-keyset-overlap)
    # 0.10.0 meta-bridge: PREVENTIVE half of the keyset guard. Fails loud if a
    # consumer fragment sets a key entwurf owns (exact or ancestor/descendant).
    # Cross-repo + non-hermetic (fragment path is an arg) → NOT in pnpm check;
    # its own logic is regression-tested hermetically by smoke-meta-keyset-guard.
    shift || true
    (cd "$REPO_DIR" && python3 scripts/check-keyset-overlap.py "$@")
    ;;
  check-package-source-routing)
    check_package_source_routing
    ;;
  smoke-session-id-name)
    smoke_session_id_name
    ;;
  check-dep-versions)
    check_dep_versions
    ;;
  check-pi-import-surface)
    check_pi_import_surface
    ;;
  check-pi-runtime-version)
    check_pi_runtime_version
    ;;
  check-pi-preflight)
    check_pi_preflight
    ;;
  check-auth-boundary)
    check_auth_boundary
    ;;
  check-acp-provider-surface)
    check_acp_provider_surface
    ;;
  check-acp-sdk-surface)
    check_acp_sdk_surface
    ;;
  check-acp-overlay)
    check_acp_overlay
    ;;
  check-acp-tool-surface)
    check_acp_tool_surface
    ;;
  check-acp-event-mapper)
    check_acp_event_mapper
    ;;
  check-acp-prompt-builder)
    check_acp_prompt_builder
    ;;
  check-acp-config)
    check_acp_config
    ;;
  check-acp-session-store)
    check_acp_session_store
    ;;
  check-acp-backend-preflight)
    check_acp_backend_preflight
    ;;
  check-acp-session-reuse)
    check_acp_session_reuse
    ;;
  check-acp-carrier-augment)
    check_acp_carrier_augment
    ;;
  check-pack)
    check_pack
    ;;
  check-pack-install)
    check_pack_install
    ;;
  sync-auth)
    sync_auth
    ;;
  install)
    install_local_package "$TARGET_PROJECT_DIR"
    ;;
  setup:links)
    # Repair / refresh ~/.pi/agent/entwurf-targets.json without re-running
    # the full setup flow. Pass --force to overwrite a stale operator file
    # or a wrong symlink (a backup is taken for regular files).
    ensure_agent_dir_symlinks "${2:-}"
    ;;
  remove)
    remove_local_package "$TARGET_PROJECT_DIR"
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
