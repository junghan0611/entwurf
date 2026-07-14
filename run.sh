#!/usr/bin/env bash
#
# Model id convention (see AGENTS.md Hard Rule #1):
#   - User-facing examples use the qualified form `entwurf/<backend-model>`
#     (e.g. `entwurf/claude-sonnet-5`); the prefix routes to this provider
#     so `--provider` is redundant and is dropped in docs.
#   - Smoke helpers that feed `ensureBridgeSession({modelId})` directly (cancel,
#     model-switch) pass BARE backend ids (`claude-sonnet-5`, `gpt-5.4`)
#     because the bridge library contract is bare. Smoke helpers that invoke pi
#     via the CLI still pin `--provider entwurf` and can accept either
#     bare or qualified model, but we keep bare here to match the bridge-level
#     dispatch tables.
#
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
REPO_DIR=$(cd -P -- "$(dirname -- "$SOURCE")" && pwd)
PROJECT_DIR_DEFAULT=$(pwd)
TARGET_PROJECT_DIR=${2:-$PROJECT_DIR_DEFAULT}
# npm publish identity. Scoped 2026-05-18 — bare `entwurf` was not on npm
# and we adopted the same `@junghanacs` scope as the OpenClaw plugin sibling
# (`@junghanacs/openclaw-entwurf`) for source-of-origin parity. This
# variable documents intent; check-pack-install hardcodes the tarball name
# and install path against the same scope for traceability.
PACKAGE_NAME="@junghanacs/entwurf"
# Runtime provider id — DO NOT change. Embedded in model strings
# (`entwurf/claude-sonnet-5`), settings keys (`entwurfProvider`),
# log prefixes (`[entwurf:bootstrap]`), and the `--provider entwurf`
# CLI surface. Renaming this would break every consumer transcript and every
# saved session anchor.
PROVIDER_ID="entwurf"

# THE strip-types fence, in one place. Node REFUSES `--experimental-strip-types`
# for any .ts below node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so
# an installed package MUST run the prepack-emitted JS twin — the same boundary
# start.sh (0.12.1), the store-doctor (0.12.4), the plugin hook (0.12.5), and the
# agy imprint (0.12.7) each cross. Every .ts entrypoint routes through here so a
# NEW one cannot silently reintroduce the class: it was hand-written per surface
# before, and three operator commands (doctor-pi-provider / new-session-id /
# meta-bridge-prune) shipped dead under node_modules because of exactly that.
#
# A dev-only gate has no emitted twin by design (check-*/smoke-* are not shipped
# surfaces). Under an installed package it REFUSES rather than falling back to raw
# .ts — a fallback would just re-raise the fence error with a worse message.
# check-install-surface pins both halves statically.
run_ts() {
  local rel="$1"; shift
  case "$REPO_DIR" in
    */node_modules/*)
      local dist="$REPO_DIR/mcp/entwurf-bridge/dist/${rel%.ts}.js"
      if [ ! -f "$dist" ]; then
        echo "entwurf: '$rel' is a dev-clone-only surface — the installed package ships no compiled twin." >&2
        echo "         (Node cannot strip types below node_modules; run this from a checkout.)" >&2
        return 1
      fi
      (cd "$REPO_DIR" && node "$dist" "$@")
      ;;
    *)
      (cd "$REPO_DIR" && node --experimental-strip-types "$rel" "$@")
      ;;
  esac
}

usage() {
  cat <<'EOF'
Usage:
  ./run.sh setup [project-dir]        # ONE confident install: pnpm install + install + meta-bridge (if native harness) + v2 install smoke (LIVE substrate = release-gate)
  ./run.sh release-gate [project-dir] [--allow-skip-gemini]  # SINGLE release gate: full static (pnpm check) + the v2-native live gates (v2 matrix/spawn-resume-live, check-bridge, retargeted smoke-session-id-name, RGG) + the ACP plugin acceptance floor (11 LIVE smokes: socket-citizen/raw-turn/overlay/provider/session-reuse/carrier-augment/memory-containment/rgg/mcp/skill/bundled-mcp). TWO-TIER summary: MUST (release-blocking, owns the exit code — "green" applies here) + BEHAVIOR (advisory, non-blocking: RGG positives model-in-loop turn). LIVE-gated MUST steps HONEST-SKIP when LIVE!=1 (a CUT needs LIVE=1, SKIP=0). --allow-skip-gemini accepted-but-ignored (back-compat). final cut authorization is GLG's.
  ./run.sh check-bridge               # entwurf-bridge direct MCP smoke + protocol/negative-path test.sh (live substrate = v2 live smokes)
  ./run.sh check-entwurf-bridge-boot # deterministic gate (5d-5-pre, G1a/G1b, IN pnpm check): boot start.sh under strip-types + assert v2 fence graph loads + entwurf_v2 registered/schema; tools/list only, no auth/side-effect
  ./run.sh check-entwurf-bridge-pi-free # deterministic gate (0.12.1 A, IN pnpm check): static — bridge index eager value-import closure must carry no @earendil-works/pi-* (type-only + dynamic import excluded); proves the meta-bridge boots pi-free
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
  ./run.sh smoke-entwurf-v2-spawn-resume-live # 0.11.0 (A) ACCEPTANCE gate — OUT of pnpm check, needs LIVE=1. The FULL spawn-bg resident lifecycle: mint backend=pi identity → seed a REAL dormant pi session (one-shot into ~/.pi/agent/sessions) → runEntwurfV2(owned-outcome) routes dormant→spawn-bg resume → a REAL detached pi --entwurf-control child stands its socket up, resumes, DOES a model turn. Asserts executed/spawn-bg/socket-alive/released + lock released ×1 + no lock file + pid alive + socket connectable + resume USER & assistant OK nonces in the session JSONL. Model-in-loop IN. The gate v1 deprecation (0.12) is predicated on. Model: ENTWURF_LIVE_TARGET=<provider>/<model> (default openai-codex/gpt-5.4). LIVE=1 ./run.sh smoke-entwurf-v2-spawn-resume-live
  ./run.sh smoke-entwurf-v2-matrix-live # LIVE sentinel (0.11 Stage 0 step 5d-5, D4-b) — OUT of pnpm check, needs LIVE=1. Drives REAL production runEntwurfV2 deps over REAL OS objects, 4 cells: C1 control-socket (real pi --entwurf-control resident → RPC send → lock acquire→release ×1), C1b socket-only (record-less live pi → control-socket sent / owned→bad-target, A1 narrow), C2 meta-mailbox deliverable (armed self-fetch citizen → real .msg enqueue, lock-free), C3 meta-mailbox guard (no armed receiver → reject, no garbage). Model-in-loop OUT (transport/lock/enqueue gate, GPT Q2); negative/timeout stay deterministic. Model: ENTWURF_LIVE_TARGET=<provider>/<model> (default openai-codex/gpt-5.4). LIVE=1 ./run.sh smoke-entwurf-v2-matrix-live
  ./run.sh smoke-agy-native-push-live  # 봉인 8 LIVE acceptance for the native-push (agy) rail — OUT of pnpm check, needs LIVE=1 + AGY_CONVERSATION_ID (a live agy conversation). Drives the REAL antigravity adapter + register core + runEntwurfV2 (production deps): doctor-static preflight (dangling→FAIL, the ③ gate), probe route, register create/attach idempotency, fire→native-push delivered, post-send re-probe (D7 partial), owned-outcome→native-push-no-resume-authority, bogus-conv→native-push-probe-indeterminate. Meta-store isolated to a temp dir (only the agy round-trip is real; no real-store residue). LIVE=1 AGY_CONVERSATION_ID=<convId> ./run.sh smoke-agy-native-push-live
  ./run.sh check-entwurf-facts         # deterministic gate (0.11 Stage 0 step 4, fact-provider slice 1+2): PURE PeerFact core + resolveFactList union — R1 out-of-domain→unsupported, R3b pi 4-value, facts-only keyset; union: PeerFact+SocketOnlyFact by gardenId, dormant→dead, F3 indeterminate preserved, non-pi+socket fail-loud; pure, no IO
  ./run.sh check-socket-discovery      # deterministic gate (0.11 Stage 0 step 4, fact-provider slice 3): SOCKET-axis scanSocketProbes — probes (dir sockets) ∪ (in-domain citizen canonical paths) 3-valued; dormant citizen no-file → dead (resumable, not unprobed), stall → indeterminate (F3), dir hygiene/dedup/missing-dir + e2e → resolveFactList; readdir/probe injected, no IO
  ./run.sh check-meta-listing          # deterministic gate (0.11 Stage 0 step 4, fact-provider slice 4a): META-STORE axis listAllMetaIdentities — explicit-partial: parse failure / body-filename drift → explicit {filename,message} error (verbatim, no synthetic fields), valid records still listed (corrupt doesn't blind); mode strict throws / collect partial; entries/readRecord injected, no IO
  ./run.sh check-entwurf-fact-provider # deterministic gate (0.11 Stage 0 step 4, fact-provider slice 4b): ASSEMBLY listEntwurfFacts — listAllMetaIdentities→scanSocketProbes→pre-quarantine non-pi/socket conflicts→resolveFactList(clean)→{facts,diagnostics}; C-원칙: expected corruption (parse/collision)→diagnostics (listing survives), impossible invariant (dup/unprobed)→throw; collision quarantines BOTH PeerFact+socket; deps injected, no IO
  ./run.sh check-entwurf-peers-surface # deterministic gate (0.11 Stage 0 step 4, fact-provider slice 4c): MCP entwurf_peers RENDER renderEntwurfPeers — legacy `sessions` = projection of facts (alive only, no 2nd scan), socketPath via controlSocketPath (SSOT), count=projection length, three distinct arrays, NO verb-routing key (JSON deep scan) NOR word (text), diagnostics both surfaces, empty→(none), unsupported shown, enrich→(not enriched); WIRING guard: bridge calls provider+render, getLiveSessions gone; facts fabricated, no IO
  ./run.sh check-entwurf-self-address # deterministic gate (SE-1/SE-2 slice 1): self-addressability honesty predicate computeSelfAddressability — pi replyable ⟺ live socket; meta ⟺ recordBacked ∧ ownerAlive ∧ watchArmed (regression-proof record-present rows); SOURCE GUARD buildStrictPiSenderEnvelope drops hardcoded replyable:true + existsSync-probes socket, entwurf_self renders alive vs expected. meta watchArmed wired in slice 2 (same release block)
  ./run.sh check-entwurf-deliverability # deterministic gate (SE-1/SE-2 slice 2c): conversational-mailbox deliverability predicate — computeMetaReceiverActive (recordBacked ∧ ownerAlive ∧ watchArmed) + mailboxConversationalDeliverable (self-fetch AND active); direct-inject pi refused (SE-1), self-fetch dead/unarmed refused (SE-2); self-address shares the same atom
  ./run.sh check-entwurf-mailbox-guard # deterministic gate (SE-1/SE-2 slice 2d): guarded mailbox enqueue — PURE 0-call (undeliverable target leaves injected enqueue uncalled) + TMPDIR snapshot (refused send leaves mailbox byte-identical, accepted writes one .msg) + fact gathering from record/capability/receiver-marker
  ./run.sh check-native-push-adapter # deterministic gate (봉인 3/8): native-push adapter leaf (antigravity) via a FAKE runner — FULL pid scan (not head -1), dead vs indeterminate, VOLATILE route re-discovery (no cache), send argv+ANTIGRAVITY_LS_ADDRESS env, non-zero exit throws, NO adapter-level retry (executor-owned), resolveNativePushAdapter fail-fast
  ./run.sh check-native-push-register # deterministic gate (봉인 5): registerNativeConversation (entwurf_register_native core) via fake adapter + isolated mkdtemp store — live probe→CREATE, re-register→ATTACH (same gid, cwd refreshed, no dup), not-live probe→REFUSE (throws, no record), receiver-marker abstinence (보정① source guard)
  ./run.sh check-agy-sender-identity # deterministic gate (#46 sender lane): WHO is calling the bridge — real agy hook as a child process writes an antigravity sender marker keyed by its PARENT pid (never on upsert failure), and resolveTrustedMetaSenderIdentity over isolated stores yields 0→null / 1→identity on EITHER backend / two distinct live identities on one owner pid→THROW (never guess, never downgrade to anonymous). This is what turns an agy send from external-mcp/unknown-host into a replyable garden citizen
  ./run.sh check-package-source-routing # deterministic gate (#29): package-source -> install-root mapping + fail-fast routing (local/git/npm/missing/project/no-source × local+remote, self-root, resume), no backend
  ./run.sh smoke-session-id-name      # live 3-turn substrate smoke (Phase 3a): Pi 0.78 --session-id/--name through the bridge — header id/cwd, session_info name, append-not-recreate, spawn-only name, wrong-cwd footgun evidence
  ./run.sh new-session-id             # print one fresh garden-native session id for operator launchers (--session-id)
  ./run.sh smoke-resident-garden-guard # live resident --entwurf-control garden guard (negative 0-token; SMOKE_RGG_POSITIVE=1 for positive)
  ./run.sh smoke-meta-async-drift     # 1.0.0 meta-bridge step 1: drift sentinel — version pins + Claude binary undocumented-behavior markers (LIVE=1 adds plugin watch-arm probe)
  ./run.sh smoke-meta-honesty         # 1.0.0 meta-bridge: honesty regression gate (#30 blockers) — doorbell counts ALL msgs honestly + hook logs failures as ERROR (best-effort, no scream). Offline/deterministic (deps: bash+node+python3)
  ./run.sh smoke-meta-install-state   # 1.0.0 meta-bridge Phase 2: stateful install/uninstall + store-doctor regression gate. Offline/deterministic (deps: bash+node+python3)
  ./run.sh smoke-agy-install-state    # agy MCP + exact permission ownership regression (120): isolated HOME+XDG, adopt/state/inverse, symlink refuse, setup degrade. Offline/deterministic
  ./run.sh smoke-agy-statusline-state # agy ambient garden-id statusLine install/doctor/inverse regression (62). Offline/deterministic
  ./run.sh smoke-agy-hooks-state      # agy PreInvocation birth/sender hook install/doctor/inverse + direct stdin→meta-record regression (37). Offline/deterministic
  ./run.sh smoke-user-scope-citizen   # 0.12.6 install-boundary: pi packages[] registration SSOT (register-pi-package.py) — idempotent + preserves unrelated + normalizes stale + remove symmetry + fails loud. Offline/hermetic (deps: bash+python3)
  ./run.sh smoke-meta-prune           # 1.0.0 meta-bridge Phase 4: listing-only store janitor regression gate — classify keep/orphan/stale/ambiguous, delete nothing. Offline/deterministic (deps: bash+node)
  ./run.sh smoke-meta-keyset-guard    # 0.10.0 meta-bridge: keyset-owner guard regression — check-keyset-overlap + managed-keys SSOT (disjoint passes, collisions fail). Offline/hermetic (deps: bash+python3)
  ./run.sh check-meta-manifest-schema # 0.12.2 meta-bridge: CLI-version-INDEPENDENT static guard — plugin manifests pinned to the minimal keyset that validates on the lowest supported Claude (closed-schema regression that broke 0.12.1 install on floor) + desired_mcp installed-vs-clone dual-mode. Offline (deps: python3)
  ./run.sh smoke-claude-native-resume-live # LIVE-only: Claude Code native fresh→--resume continuity + meta-record uniqueness; proves meta-bridge records identity without touching the backend resume path

  ./run.sh install-meta-bridge        # INTERNAL part of `setup` (native-harness plugin) + doctor recovery path — prefer `setup`; stateful GLOBAL install (plugin + USER MCP + settings keyset, honest uninstall state)
  ./run.sh uninstall-meta-bridge      # 1.0.0 meta-bridge Phase 2: stateful GLOBAL uninstall (restore only keys/items captured in install-state)
  ./run.sh doctor-meta-bridge         # 1.0.0 meta-bridge Phase 2: fail-loud doctor — toolchain + state + plugin/MCP + store scan + hook errors + SessionStart evidence + writer-version parity (source↔assembled↔installed: FAIL on a stale deployed meta-record writer)
  ./run.sh install-agy-bridge         # 봉인 7: agy MCP install adapter — register ONE entwurf-bridge server in the agy mcp_config (adopt file / create / REFUSE symlink), stable bin command, install-state under $XDG_DATA_HOME/entwurf/agy-bridge/
  ./run.sh uninstall-agy-bridge       # 봉인 7: honest inverse of install-agy-bridge from install-state (restore preimage / remove key; refuse if config became a symlink)
  ./run.sh doctor-agy-bridge          # fail-loud doctor: MCP config + exact permission rule + state + live probe label
  ./run.sh install-agy-statusline     # own the agy statusLine subtree with bare entwurf-agy-statusline; preserve unrelated settings
  ./run.sh uninstall-agy-statusline   # honest inverse from statusline install-state
  ./run.sh doctor-agy-statusline      # fail-loud statusLine config/bin/state doctor + honest live SKIP
  ./run.sh install-agy-hooks          # #46 agy birth imprint hook — named PreInvocation hook running bare entwurf-agy-imprint, preserving other hooks
  ./run.sh uninstall-agy-hooks        # honest inverse of install-agy-hooks from install-state
  ./run.sh doctor-agy-hooks           # fail-loud doctor for agy hooks.json imprint wiring
  ./run.sh meta-bridge-prune          # 1.0.0 meta-bridge Phase 4: LISTING-ONLY store hygiene — classify orphan/stale/ambiguous/keep, print manual rm commands, delete NOTHING ([dir] [--ttl-days N])
  ./run.sh meta-bridge-managed-keys   # 0.10.0 meta-bridge: print the SSOT of settings keys entwurf OWNS (consumers read this to stay disjoint — keyset-owner invariant)
  ./run.sh check-keyset-overlap <fragment.json...>  # 0.10.0 meta-bridge: PREVENTIVE keyset guard — fail if a consumer fragment collides with any pi-owned key (cross-repo; not in pnpm check)
  ./run.sh check-dep-versions         # local deterministic check that the pi pin agrees across package.json (devDeps + peer range), run.sh (peer-install pins), and the baseline docs (AGENTS/README/ROADMAP/setup-clean-host/demo)
  ./run.sh check-pack                 # publish gate (dry-run): npm pack --dry-run + tarball invariants (runtime-critical present, dev residue absent)
  ./run.sh check-pack-install         # heavy publish gate (prepublishOnly): actual npm pack + tar -tf + fresh-temp install smoke with 0.80.x peers
  ./run.sh sync-auth                  # copy ~/.pi/agent/auth.json anthropic OAuth credentials to entwurf alias
  ./run.sh install [project-dir]      # INTERNAL part of `setup` (project .pi/settings.json wiring) + npm-consumer entry — prefer `setup`, don't call directly for dev
  ./run.sh setup:links [--force]      # repair ~/.pi/agent/entwurf-targets.json link (use --force to replace a stale operator file or wrong symlink; a .bak is taken)
  ./run.sh remove [project-dir]       # remove entwurf entries from project .pi/settings.json (project scope only; global user-scope citizen left intact)
  ./run.sh remove-user-scope          # explicit GLOBAL inverse of install's user-scope citizen: drop entwurf from ~/.pi/agent/settings.json packages[] (affects ALL cwds — shared entry, not per-project)

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

# Repo dependency integrity is a HARD requirement for install — NOT gated on
# backend (Claude/ACP) auth. A cloned-but-not-installed or a moved/renamed repo
# has missing or path-stale node_modules; `install` would otherwise happily wire
# settings.json and the failure only surfaces minutes later as a dead MCP bridge
# / pi-extension resolve error (the 2026-06-23 relocation failure: entwurf-bridge
# ✘ Failed to connect + check-entwurf-v2-surface ERR_MODULE_NOT_FOUND). Catch it
# HERE, before any settings file is written (no silent-red), with a package
# manifest access that follows the pnpm symlink to each dep — NOT a real module
# import (per-package "exports" maps forbid that uniformly) and NOT a bare
# `test -d node_modules`, which a dir-move breaks at the symlink-store level
# while the top-level dir still looks present.
preflight_dep_integrity() {
  command -v node >/dev/null 2>&1 || { fail "node not on PATH — cannot verify repo dependency integrity"; exit 1; }
  # Each wired pi-extension / MCP bridge / ACP backend root-imports its bundled
  # runtime deps at load/spawn time. Assert they actually resolve from the
  # package's location BEFORE writing settings, so a broken install fails loud
  # here instead of surfacing later as a dead MCP bridge (entwurf-bridge ✘) or an
  # ERR_MODULE_NOT_FOUND at runtime.
  #
  # Resolution must follow Node's OWN algorithm, because the package lives in two
  # layouts: a pnpm clone (deps in $REPO_DIR/node_modules) OR a pi-managed
  # `pi install npm:@junghanacs/entwurf` (deps HOISTED to an ancestor node_modules,
  # e.g. ~/.pi/agent/npm/node_modules, with NO package-local node_modules). A
  # cwd-relative `node_modules/<dep>` probe only sees the clone layout and wrongly
  # rejects every pi-managed npm install. So walk Node's real module-resolution
  # paths (Module._nodeModulePaths) and accessSync each candidate package.json:
  # exports-immune (no bare-root / ./package.json import) and hoist-aware, while
  # still catching a pnpm dir-move that left the symlink store dangling
  # (accessSync follows the link).
  #
  # Probe set = the BUNDLED runtime `dependencies` only. The `@earendil-works/pi-*`
  # peer trio is intentionally EXCLUDED: pi-managed installs omit peers
  # (--legacy-peer-deps) and the pi loader provides that runtime itself, so the
  # trio is legitimately absent from node_modules on the npm path. pi runtime
  # presence/version is covered by check-pi-runtime-version / check-pi-import-surface.
  local probe=(
    "@modelcontextprotocol/sdk" "@agentclientprotocol/sdk" "@agentclientprotocol/claude-agent-acp"
    "@anthropic-ai/sdk" "zod"
  )
  local missing=() dep
  for dep in "${probe[@]}"; do
    if ! (cd "$REPO_DIR" && node -e '
      const M = require("module"), fs = require("fs"), path = require("path");
      const dep = process.argv[1];
      for (const nm of M._nodeModulePaths(process.cwd())) {
        try { fs.accessSync(path.join(nm, dep, "package.json")); process.exit(0); } catch {}
      }
      process.exit(1);
    ' "$dep") >/dev/null 2>&1; then
      missing+=("$dep")
    fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    fail "repo dependency integrity check failed — cannot resolve: ${missing[*]}"
    echo "       node_modules is missing or path-stale (common right after a clone," >&2
    echo "       or a repo move/rename — pnpm's symlink store points at the old path)." >&2
    echo "       Fix: (cd \"$REPO_DIR\" && pnpm install)" >&2
    echo "       Then re-run ./run.sh install . — settings.json was NOT written." >&2
    exit 1
  fi
}

preflight_pi_settings_shapes() {
  local project_settings="$1"
  local user_settings="$2"
  python3 - "$project_settings" "$user_settings" <<'PY'
import json, sys
from pathlib import Path

project = Path(sys.argv[1])
user = Path(sys.argv[2])

def load_object(path: Path, label: str):
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise SystemExit(f"{label} settings is not a JSON object: {path}")
    return data

def check_packages(data, path: Path, label: str):
    if data is None:
        return
    packages = data.get("packages")
    if packages is not None and not isinstance(packages, list):
        raise SystemExit(f"{label} settings packages is not a JSON array: {path}")

def check_project_provider(data, path: Path):
    if data is None:
        return
    provider = data.get("entwurfProvider")
    if provider is None:
        return
    if not isinstance(provider, dict):
        raise SystemExit(f"project settings entwurfProvider is not an object: {path}")
    servers = provider.get("mcpServers")
    if servers is not None and not isinstance(servers, dict):
        raise SystemExit(f"project settings entwurfProvider.mcpServers is not an object: {path}")

project_data = load_object(project, "project")
user_data = load_object(user, "user")
check_packages(project_data, project, "project")
check_packages(user_data, user, "user")
check_project_provider(project_data, project)
PY
}

install_local_package() {
  local project_dir agent_dir
  project_dir=$(normalize_project_dir "$1")
  agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  preflight_dep_integrity
  # Fail BEFORE any settings write if either target config already has a corrupt
  # shape. The packages[] SSOT and provider writer run in two separate steps, so
  # without this preflight a bad entwurfProvider could leave a half-installed
  # packages[] entry behind (2026-07-03 install-boundary hardening).
  preflight_pi_settings_shapes "$project_dir/.pi/settings.json" "$agent_dir/settings.json"
  mkdir -p "$project_dir/.pi"
  # packages[] registration via the shared SSOT — same is_entwurf_source
  # predicate + idempotency as user-scope and remove (not a substring match).
  python3 "$REPO_DIR/scripts/register-pi-package.py" "$project_dir/.pi/settings.json" "$REPO_DIR"
  # entwurfProvider.mcpServers.entwurf-bridge (project scope — checkout-local, NO state; #46
  # Task 2) via the shared register-pi-provider SSOT: normalize the command to the bare stable
  # bin `entwurf-bridge` (ownership-classified: absent/managed-current/managed-legacy adopt, a
  # true user-override is left untouched) + prune legacy bundles. project remove is the inverse.
  python3 "$REPO_DIR/scripts/register-pi-provider.py" install "$project_dir/.pi/settings.json" "$REPO_DIR" --scope project
  ensure_agent_dir_symlinks
  register_user_scope_citizen
}

# Register entwurf as a pi USER-SCOPE citizen so its extensions
# (entwurf-control.ts → --entwurf-control / --emacs-agent-socket) load from ANY
# cwd, not only inside the entwurf checkout. project-scope `.pi/settings.json`
# only applies when pi runs inside the repo; the `pit`/`pia`/`pihome` global
# launchers and the npm consumer's "installs → just works" both need the entry
# in ~/.pi/agent/settings.json's packages[]. This is the wiring that dropped when
# `pi install` was removed from setup (2026-07-03: `--entwurf-control` unknown in
# a foreign cwd). Idempotent: absent → append, present → no-op; a stale entwurf
# entry at a different path is normalized to REPO_DIR. Every other package and key
# in the operator's user settings is preserved untouched.
register_user_scope_citizen() {
  local agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  # Shared idempotent implementation (also driven by smoke-user-scope-citizen).
  python3 "$REPO_DIR/scripts/register-pi-package.py" "$agent_dir/settings.json" "$REPO_DIR"
  # #46 Task 2: own entwurfProvider.mcpServers.entwurf-bridge as the bare stable bin at USER scope
  # (GLOBAL/durable →파급s to every cwd), so its inverse needs an install-state honest inverse
  # under $XDG_DATA_HOME/entwurf/pi-provider/ (Task 0/1 discipline). project scope is checkout-
  # local and covered by `run.sh remove` (no state) — deliberate, reasoned asymmetry.
  local pp_state="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/pi-provider/install-state.json"
  python3 "$REPO_DIR/scripts/register-pi-provider.py" install "$agent_dir/settings.json" "$REPO_DIR" --scope user --state "$pp_state"
}

# The honest inverse of register_user_scope_citizen: drop entwurf from the GLOBAL
# ~/.pi/agent/settings.json packages[]. Deliberately NOT folded into `run.sh remove`
# (project scope): the user-scope citizen is a single GLOBAL entry keyed on this
# checkout and SHARED by every project + every foreign cwd, so tearing it down as a
# side effect of one project's remove would break `--entwurf-control` everywhere else
# (the exact "install → just works from any cwd" invariant register_user_scope_citizen
# exists to hold). Same explicit-global-lifecycle shape as install/uninstall-meta-bridge.
# Uses the same is_entwurf_source SSOT + --remove, so it never over-deletes a look-alike
# (entwurf-notes, openclaw-entwurf) and preserves every other package/key. Idempotent:
# no entwurf entry → no-op.
remove_user_scope_citizen() {
  local agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  python3 "$REPO_DIR/scripts/register-pi-package.py" "$agent_dir/settings.json" "$REPO_DIR" --remove
  # #46 Task 2: honest inverse of the user-scope entwurfProvider ownership — the install-state
  # drives it (absent/managed-* → remove OUR key; a user-override we never owned is untouched).
  local pp_state="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/pi-provider/install-state.json"
  python3 "$REPO_DIR/scripts/register-pi-provider.py" remove "$agent_dir/settings.json" "$REPO_DIR" --scope user --state "$pp_state"
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
#   2. `ENTWURF_TARGETS_PATH=/path/to/custom.json` — tells entwurf-core
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
    echo "         export ENTWURF_TARGETS_PATH=$current  # honor your override explicitly" >&2
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
    echo "         export ENTWURF_TARGETS_PATH=$link  # honor your file as an explicit override" >&2
    exit 1
  fi

  ln -s "$target" "$link"
  echo "install: linked $link -> $target"
}

remove_local_package() {
  local project_dir
  project_dir=$(normalize_project_dir "$1")
  # Same fail-before-write rule as install: remove has two writers too
  # (packages[] SSOT, then entwurfProvider cleanup), so a malformed provider must
  # not leave a half-removed packages[] entry behind.
  preflight_pi_settings_shapes "$project_dir/.pi/settings.json" "$(mktemp -u)"
  # packages[] cleanup via the shared SSOT — same is_entwurf_source predicate as
  # install, so remove never over-deletes a look-alike repo (entwurf-notes, …)
  # that install would never have registered.
  python3 "$REPO_DIR/scripts/register-pi-package.py" "$project_dir/.pi/settings.json" "$REPO_DIR" --remove
  # entwurfProvider.mcpServers.entwurf-bridge cleanup (project scope) via the shared SSOT: strip
  # our-managed shapes (the bare stable bin AND the legacy repo start.sh path — a true user
  # override is left in place) + prune legacy bundles. Mirrors install's ownership predicate so it
  # never over-deletes a look-alike, and now also catches the bare bin the Task-2 install writes.
  python3 "$REPO_DIR/scripts/register-pi-provider.py" remove "$project_dir/.pi/settings.json" "$REPO_DIR" --scope project
  # `remove` is project-scope only. The GLOBAL user-scope citizen in
  # ~/.pi/agent/settings.json (written by install's register_user_scope_citizen)
  # is shared across every project + foreign cwd, so it is left intact here to
  # avoid breaking `--entwurf-control` elsewhere. Point the operator at the
  # explicit global inverse so the install↔remove asymmetry is never silent.
  local agent_settings="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/settings.json"
  if python3 "$REPO_DIR/scripts/register-pi-package.py" "$agent_settings" "$REPO_DIR" --remove --dry-run 2>/dev/null | grep -q 'would remove'; then
    log "note: global user-scope citizen still registered in $agent_settings"
    log "      run './run.sh remove-user-scope' to remove it (affects ALL cwds)"
  fi
}

check_model_lock() {
  # Deterministic policy unit test for pi-extensions/model-lock.ts.
  # No pi process, no network, no API cost. Mocks ExtensionAPI/Context and
  # drives the model_select handler through every quadrant + edge case
  # (see scripts/check-model-lock.ts header for the full matrix).
  run_ts scripts/check-model-lock.ts
}

check_shell_quote() {
  # POSIX-safety gate for the shellQuote helper used in remote SSH command
  # builders (entwurf.ts + entwurf-core.ts). Verifies source-string parity
  # across the two duplication sites AND behavioral correctness on the
  # payload classes that caused the 2026-05-18 remote entwurf incident
  # (backtick / $(...) / $VAR / korean tokens). No process spawn, no SSH.
  run_ts scripts/check-shell-quote.ts
}

check_entwurf_session_identity() {
  # Deterministic gate for the locked garden session identity & name grammar
  # (NEXT.md "Locked — session identity & name grammar"): sessionId validator,
  # buildSessionName/parseSessionName round-trip incl. `.`-bearing registry
  # models, titleSlug canonicalization, registry exact-tuple membership, name=
  # info-only invariants, and header-scan collision pre-check. Isolates registry
  # + sessions base to a temp dir. No backend, no API, no spawn.
  run_ts scripts/check-entwurf-session-identity.ts
}

check_meta_session() {
  # Deterministic gate for the 1.0.0 meta-bridge record authority (#30 step 2):
  # mint/serialize/parse round-trip + crash-on-malformed, scanByNativeId lookup
  # authority BY RECORD BODY (not filename, proven with a decoy filename in a
  # real temp dir), idempotent existence-keyed decideUpsert + identity-drift
  # refusal, and the pre-drilled read-receipt mutators. Pure functions; no
  # backend, no hook, no API.
  run_ts scripts/check-meta-session.ts
}

check_meta_record_v2() {
  # Deterministic golden gate for 0.11 Stage 0 step 3A: the v1→v2 identity
  # normalize seam. A synthetic, sanitized v1 fixture normalizes to a
  # hand-written v2 identity literal (golden), plus dual-read version fences
  # and v2 field-contract crashes. Reader/normalizer only — no v2 writer yet.
  # Kept separate from check-meta-session so 3D's v1-gate rewrites leave this
  # back-compat golden untouched. Pure functions; no backend, no hook, no API.
  run_ts scripts/check-meta-record-v2.ts
}

check_mailbox_receipt_state() {
  # Deterministic gate for 0.11 Stage 0 step 3B: the mailbox receipt state
  # schema + store — the new home for the read-receipt before v2 drops
  # record.delivery (NEXT.md 고정순서 4). Pure schema round-trip + strict
  # keyset, then the fs store (stamp → persist → read-back) in a temp mailbox
  # dir. Schema/store only — no live enqueue/read dual-write (that is 3D). No
  # backend, no hook, no API.
  run_ts scripts/check-mailbox-receipt-state.ts
}

check_entwurf_capabilities() {
  # Deterministic gate for 0.11 Stage 0 step 3C: the backend capability source
  # (pi/entwurf-capabilities.json) — the new home for wakeMode/deliveryLevel/
  # nativeIdLabel before v2 drops them from the record (frozen decision 1).
  # Asserts coverage == META_BACKENDS_V2 (pi included), agreement with the live
  # META_BACKEND_DESCRIPTORS for the three existing backends (drift guard), and
  # strict keyset/coverage/field crashes. Parser/gate only — no live routing,
  # no record/descriptor consumer change (that is 3D). No backend, no API.
  run_ts scripts/check-entwurf-capabilities.ts
}

check_meta_dual_read() {
  # Deterministic gate for 0.11 Stage 0 step 3D-1: the v2 write shape
  # (serializeMetaIdentity) + the dual-read dispatcher (parseMetaRecordAny /
  # parseMetaIdentity). Canonical serialize + round-trip + version dispatch +
  # unknown-version crash. Pure functions only — no fs upsert wiring, no
  # readMetaInbox/enqueueMetaMessage change, no record.delivery removal (3D-2/3/4).
  # No backend, no hook, no API.
  run_ts scripts/check-meta-dual-read.ts
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
  run_ts scripts/check-meta-mailbox-state-write.ts
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
  run_ts scripts/check-meta-receiver-marker.ts
}

check_meta_migration() {
  # Deterministic gate for 0.11 Stage 0 step 3D-4 commit2: the v1→v2 delivery-receipt
  # migration (migrateV1DeliveryReceipts) + its crash-order inside upsert. Per-field
  # STATE WINS, 3 timestamps only; v1-all-null / state-already-wins are no-ops (no
  # state.json). Crash-order: a v1 record's receipts migrate to state BEFORE the v2
  # rewrite (proven via upsert attach), and a drift'd state makes migrate throw with
  # the record STILL v1 (recoverable: next attach re-migrates). Temp dir, no API.
  run_ts scripts/check-meta-migration.ts
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
  run_ts scripts/check-meta-dual-consumers.ts
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
  run_ts scripts/check-meta-capability-source.ts
}

check_socket_probe() {
  # Deterministic gate for 0.11 Stage 0 (F3 fix): three-valued control-socket
  # liveness. classifyConnectError is a pure boundary (ECONNREFUSED/ENOENT →
  # dead; timeout/EACCES/unknown → indeterminate). GC reclaims dead only;
  # indeterminate (a load-stalled live socket) survives the sweep — the F3
  # invariant. Listing lists alive only. Pure classify + GC/listing policy +
  # a two-socket integration (live listener → alive survives; nonexistent →
  # dead GC-eligible). No wire timeout fixture, no backend, no API.
  run_ts scripts/check-socket-probe.ts
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
  run_ts scripts/check-project-trust-handler.ts
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
  run_ts scripts/check-entwurf-v2-contract.ts
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
  run_ts scripts/check-entwurf-v2-lock.ts
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
  run_ts scripts/check-entwurf-v2-decider.ts
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
  run_ts scripts/check-entwurf-v2-matrix.ts
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
  run_ts scripts/check-entwurf-v2-release.ts
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
  run_ts scripts/check-entwurf-v2-send.ts
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
  run_ts scripts/check-entwurf-v2-send-fallback.ts
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
  run_ts scripts/check-entwurf-v2-mailbox.ts
}

check_entwurf_v2_native_push() {
  # Deterministic gate for 봉인 3/4: the native-push SEND hand (deliverViaNativePush +
  # makeNativePushSend), the executor half of the native-push rail — where the 1-shot retry
  # lives (moved out of the adapter leaf). Proves over a fake adapter (no agy/socket): success
  # first try -> {retried:false}, ONE send over the planted route, ZERO re-probe; fail ->
  # re-probe alive -> re-send success -> {retried:true}, TWO sends, the 2nd over the RE-
  # DISCOVERED route; re-send FAIL -> throws (no 3rd attempt); re-probe dead/indeterminate ->
  # throws (not retried), NO second send. makeNativePushSend resolves the adapter from
  # plan.backend and IGNORES the lock (lock-free rail).
  run_ts scripts/check-entwurf-v2-native-push.ts
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
  run_ts scripts/check-entwurf-v2-runner.ts
}

check_entwurf_v2_surface() {
  # Deterministic gate for 0.11 Stage 0 step 5d-3a: the ctx-free surface adapter
  # (entwurf-v2-surface.ts) + the entwurf-control.ts wiring contract. Proves the pure parts:
  # toDispatchInput (wants_reply→wantsReply, absent mode/wants_reply undefined) / renderEntwurfV2Result
  # per result kind ({text,isError} surfacing reject diagnostic, control N3 rejectReason, spawn
  # lock-retained, N1 delivered-but-dirty) / surface ctx-free source guard / entwurf-control
  # registers entwurf_v2 + reaches the fence via a NON-LITERAL dynamic import (no static fence
  # import → TS5097 stays closed) + decorates sender origin:pi-session/replyable:true.
  run_ts scripts/check-entwurf-v2-surface.ts
}

check_entwurf_bridge_boot() {
  # Deterministic gate for 0.11 step 5d-5-pre (G1a/G1b): boots the entwurf-bridge MCP server
  # as it ships (start.sh → node --experimental-strip-types, no build) and asserts what the
  # source-shape gate check-entwurf-v2-surface cannot — that the whole v2 fence graph LOADS at
  # boot under strip-types (G1a: a parseable tools/list proves it) and that entwurf_v2 is
  # registered on the runtime surface with its schema (G1b). tools/list only → no tools/call,
  # no lock/fs side effect, no auth → safe in pnpm check. Broad protocol/negative suite stays
  # in check-bridge/test.sh (D1=A안).
  run_ts scripts/check-entwurf-bridge-boot.ts
}

check_entwurf_bridge_pi_free() {
  # 0.12.1 A-gate (static half): the entwurf-bridge MCP server must boot WITHOUT any
  # pi package. entwurf is a harness-neutral npm package; pi is one optional adapter
  # lane, not a boot dependency. Walks the EAGER static value-import closure of
  # mcp/entwurf-bridge/src/index.ts and fails if any reachable module statically
  # value-imports @earendil-works/pi-*. Type-only imports and dynamic `await import()`
  # (the intended lazy preflight boundary) are excluded — the runtime boot smoke is the
  # final authority that peers/self/list/mailbox-deliver come up pi-free.
  run_ts scripts/check-entwurf-bridge-pi-free.ts
}

check_entwurf_v2_production() {
  # Deterministic gate for 0.11 Stage 0 step 5d-2b: makeProductionEntwurfV2Deps — the ctx-free
  # PRODUCTION assembly of runEntwurfV2's deps. Proves the wiring over fake leaf-IO spies (no
  # real socket/lock/spawn/meta-record): decide wraps decideDispatch and acquires under the
  # wired lockDir / control sendOverSocket builds the RpcSendCommand + maps + releases under
  # lockDir / QB3 the spawn watcher releases via the SHARED lockDir release (not the spawn
  # factory default) / the mailbox hand enqueues onto the wired dirs / a dead control send
  # re-resolves to the SAME sendViaMailbox instance on the SAME dirs (Q3+Q5 no drift).
  run_ts scripts/check-entwurf-v2-production.ts
}

check_entwurf_control_rpc() {
  # Gate for 0.11 Stage 0 step 5d-2 (RPC-helper extraction micro-slice): the --entwurf-control
  # socket protocol (wire types + the newline-JSON client sendRpcCommand) moved to the ctx-free
  # SSOT lib/entwurf-control-rpc.ts behaviour-preservingly. Proves: lib is ctx-free (no
  # ExtensionContext/ExtensionAPI/@earendil-works/pi-ai) / entwurf-control.ts imports
  # sendRpcCommand from the lib and no longer defines its own / real short unix-socket round-trip
  # (write command -> matched {type:response,command,success:true} -> resolve) / close-before-
  # response rejects 'connection closed before response'. net.Server only, no model/pi process.
  run_ts scripts/check-entwurf-control-rpc.ts
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
  run_ts scripts/check-entwurf-v2-spawn.ts
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
  run_ts scripts/check-entwurf-resume-args.ts
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
  run_ts scripts/check-entwurf-v2-spawn-production.ts
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
  run_ts scripts/smoke-entwurf-v2-spawn-live.ts
}

smoke_acp_socket_citizen_live() {
  # S1 acceptance smoke (ACP plugin on v2) — OUT of pnpm check, needs LIVE=1.
  # Spawns a REAL `pi --entwurf-control` resident on an ACP model
  # (entwurf/claude-opus-4-8) and proves it is a first-class socket-citizen:
  # the control socket stands up, get_info answers with the ACP model (model-lock
  # did NOT revert — QM1), idle/cwd are reported, and the fail-loud streamSimple
  # stub never fires (turn-free launch — QM2). No prompt is sent: S1 proves
  # citizenship, never a backend turn (that is S2). Honest skip when LIVE!=1.
  # Model override: ENTWURF_S1_MODEL (default claude-opus-4-8).
  #   LIVE=1 ./run.sh smoke-acp-socket-citizen-live
  run_ts scripts/smoke-acp-socket-citizen-live.ts
}

smoke_acp_raw_turn_live() {
  # S2a-2 acceptance smoke (ACP plugin on v2) — OUT of pnpm check, needs LIVE=1.
  # Drives ONE real ACP turn through the pinned Claude adapter: spawns
  # claude-agent-acp from its resolved package bin, speaks ACP over stdio NDJSON
  # (ndJsonStream + the connectAcpClient adapter), runs initialize -> newSession ->
  # (sonnet) setSessionConfigOption(model) -> prompt("say OK"), and asserts a live "OK" reply
  # plus captured raw NDJSON bytes. NO provider/overlay/streamSimple/_meta — the
  # raw backend pipe only. Launch source must be the package bin (PATH fallback
  # fails acceptance unless ENTWURF_ACP_RAW_TURN_ALLOW_PATH_FALLBACK=1, debug).
  # Model override: ENTWURF_ACP_RAW_TURN_MODEL (default claude-sonnet-5).
  #   LIVE=1 ./run.sh smoke-acp-raw-turn-live
  run_ts scripts/smoke-acp-raw-turn-live.ts
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
  # fallback fails acceptance unless ENTWURF_ACP_OVERLAY_ALLOW_PATH_FALLBACK=1).
  # Model override: ENTWURF_ACP_OVERLAY_MODEL (default claude-sonnet-5).
  #   LIVE=1 ./run.sh smoke-acp-overlay-live
  run_ts scripts/smoke-acp-overlay-live.ts
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
  # fallback fails acceptance unless ENTWURF_ACP_MEMORY_ALLOW_PATH_FALLBACK=1).
  # Model override: ENTWURF_ACP_MEMORY_MODEL (default claude-sonnet-5).
  #   LIVE=1 ./run.sh smoke-acp-memory-containment-live
  run_ts scripts/smoke-acp-memory-containment-live.ts
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
  # Model override: ENTWURF_ACP_PROVIDER_MODEL (default claude-sonnet-5).
  #   LIVE=1 ./run.sh smoke-acp-provider-live
  run_ts scripts/smoke-acp-provider-live.ts
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
  # Model override: ENTWURF_ACP_PROVIDER_MODEL (default claude-sonnet-5).
  #   LIVE=1 ./run.sh smoke-acp-session-reuse-live
  run_ts scripts/smoke-acp-session-reuse-live.ts
}

smoke_acp_carrier_augment_live() {
  # S2e-1 acceptance smoke (billing carrier + first-user augment) — OUT of pnpm
  # check, needs LIVE=1. Writes a unique secret into the scratch cwd's AGENTS.md
  # (never the prompt) and drives one real provider turn: the reply must carry the
  # secret (the augment rode the wire to the model) and the EMPTY default carrier
  # must bill clean (exit 0, no HTTP-400 canary — 핀1 live). Optional tiny carrier
  # check via SMOKE_ACP_CARRIER_PRESENT=1 (non-blocking).
  # Model override: ENTWURF_ACP_PROVIDER_MODEL (default claude-sonnet-5).
  #   LIVE=1 ./run.sh smoke-acp-carrier-augment-live
  run_ts scripts/smoke-acp-carrier-augment-live.ts
}

smoke_acp_mcp_live() {
  # S2g LIVE 1 — operator MCP passthrough acceptance. OUT of pnpm check, needs
  # LIVE=1. Registers a TINY isolated probe MCP server (scripts/fixtures/
  # probe-mcp-server.ts, one tool probe_nonce) in a scratch .pi/settings.json and
  # drives one real provider turn: the model must CALL the tool and echo the nonce
  # that lives only inside the MCP server env. Proves the operator's
  # entwurfProvider.mcpServers reaches the live ACP session (the GLG-baseline
  # fix). Isolated probe (not entwurf-bridge) so a failure does not blur into
  # identity/env wiring. Model override: ENTWURF_ACP_PROVIDER_MODEL.
  #   LIVE=1 ./run.sh smoke-acp-mcp-live
  run_ts scripts/smoke-acp-mcp-live.ts
}

smoke_acp_skill_live() {
  # S2g LIVE 2 — operator skillPlugins passthrough acceptance. OUT of pnpm check,
  # needs LIVE=1. Builds a temp skill plugin (.claude-plugin/plugin.json +
  # skills/<name>/SKILL.md carrying a unique nonce instruction), points
  # entwurfProvider.skillPlugins at it, and drives one real provider turn: the
  # model must surface/use the skill and echo the nonce. Proves skillPlugins +
  # the Skill/Skill(*) auto-add reach the live session (the other half of the GLG
  # baseline). Model override: ENTWURF_ACP_PROVIDER_MODEL.
  #   LIVE=1 ./run.sh smoke-acp-skill-live
  run_ts scripts/smoke-acp-skill-live.ts
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
  # ENTWURF_ACP_PROVIDER_MODEL.
  #   LIVE=1 ./run.sh smoke-acp-bundled-mcp-live
  run_ts scripts/smoke-acp-bundled-mcp-live.ts
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
  # and ENTWURF_LIVE_TARGET set (T3 will report N/A, not a real failure).
  # Target override: ENTWURF_RGG_TARGET (default entwurf/claude-sonnet-5).
  #   ./run.sh smoke-acp-rgg-live
  local target="${ENTWURF_RGG_TARGET:-entwurf/claude-sonnet-5}"
  (cd "$REPO_DIR" && ENTWURF_LIVE_TARGET="$target" SMOKE_RGG_POSITIVE=0 bash scripts/smoke-resident-garden-guard.sh)
}

smoke_entwurf_v2_matrix_live() {
  # LIVE sentinel for 0.11 Stage 0 step 5d-5 (D4-b) — kept OUT of `pnpm check`. The deterministic
  # sibling (check-entwurf-v2-matrix) fixes every (target kind → transport → lock) cell over fakes
  # with ZERO IO; this drives the REAL production runEntwurfV2 deps against REAL OS objects on the
  # substrate happy path across 3 cells: C1 control-socket (a real `pi --entwurf-control` resident
  # → control-socket RPC send → lock acquire→release ×1), C2 meta-mailbox deliverable (armed
  # self-fetch citizen → real .msg enqueue, lock-free), C3 meta-mailbox guard (no armed receiver →
  # reject, no garbage). Model-in-loop is OUT (GPT Q2): "does the sender model call entwurf_v2"
  # is a separate behavior test — this is a transport/lock/enqueue gate. Negative/timeout/contention
  # stay deterministic. Honest skip when LIVE!=1 so the release-gate is runnable unattended.
  # Model: ENTWURF_LIVE_TARGET=<provider>/<model> (default openai-codex/gpt-5.4).
  #   LIVE=1 ./run.sh smoke-entwurf-v2-matrix-live
  if [ "${LIVE:-}" != "1" ]; then
    echo "[smoke-entwurf-v2-matrix-live] skipped — set LIVE=1 to run (spawns a real pi --entwurf-control + opens a real socket)."
    return 0
  fi
  run_ts scripts/smoke-entwurf-v2-matrix-live.ts
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
  # Model: ENTWURF_LIVE_TARGET=<provider>/<model> (default openai-codex/gpt-5.4);
  #        ENTWURF_SPAWN_RESUME_ASSISTANT_TIMEOUT_MS (default 180000).
  #   LIVE=1 ./run.sh smoke-entwurf-v2-spawn-resume-live
  if [ "${LIVE:-}" != "1" ]; then
    echo "[smoke-entwurf-v2-spawn-resume-live] skipped — set LIVE=1 to run (spawns a real pi resume child + opens a real socket)."
    return 0
  fi
  run_ts scripts/smoke-entwurf-v2-spawn-resume-live.ts
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
  run_ts scripts/check-entwurf-facts.ts
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
  run_ts scripts/check-socket-discovery.ts
}

check_meta_listing() {
  # Deterministic gate for 0.11 Stage 0 step 4 (fact-provider slice 4a): the
  # meta-store axis listAllMetaIdentities. Explicit-partial: a parse failure or
  # body/filename drift does NOT blind the listing (valid records still surface)
  # and does NOT throw (0.10 "corrupt blocks registration forever" lesson) — it
  # becomes an explicit error carrying ONLY {filename, message}, verbatim (a
  # salvaged gid string as a fact = synthetic backdoor). mode strict throws on
  # any error, collect returns partial. entries/readRecord injected, no IO.
  run_ts scripts/check-meta-listing.ts
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
  run_ts scripts/check-entwurf-fact-provider.ts
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
  run_ts scripts/check-entwurf-peers-surface.ts
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
  run_ts scripts/check-entwurf-self-address.ts
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
  run_ts scripts/check-entwurf-deliverability.ts
}

check_entwurf_mailbox_guard() {
  # Deterministic gate for the guarded mailbox enqueue (SE-1/SE-2 slice 2d) — the IO
  # orchestration conversational-reply sites use instead of enqueueMetaMessage directly.
  # Asserts (GPT Q5, both axes): PURE 0-call — an undeliverable target (dead receiver /
  # direct-inject pi / absent record) leaves the injected enqueue UNCALLED, a deliverable
  # one calls it exactly once; TMPDIR SNAPSHOT with the real enqueueMetaMessage — a refused
  # send leaves the mailbox tree byte-identical (file list + content hash, not just mtime),
  # an accepted send writes exactly one .msg; plus fact gathering from record/capability/marker.
  run_ts scripts/check-entwurf-mailbox-guard.ts
}

check_native_push_adapter() {
  # Deterministic gate for the native-push adapter LEAF (봉인 3/8). Drives
  # createAntigravityAdapter with a FAKE runner (no real agy/ss/pgrep). Asserts: FULL pid
  # scan (only the 2nd host pid serves the conv → probe still finds the route; raw-agy-send
  # head -1 corrected); dead (no host) vs indeterminate (host alive, no LS port served the
  # conv, never coerced to dead); VOLATILE route / no cache (a repeated probe re-discovers a
  # CHANGED route); send argv === [binary,agentapi,send-message,conv,body] with
  # ANTIGRAVITY_LS_ADDRESS env, non-zero exit THROWS; NO retry in the adapter (single send,
  # no re-probe — retry is the executor hand's job, step ⑥); resolveNativePushAdapter fail-fast.
  run_ts scripts/check-native-push-adapter.ts
}

check_native_push_register() {
  # Deterministic gate for 봉인 5: registerNativeConversation (the core of the
  # entwurf_register_native MCP tool). Drives it with a FAKE adapter + an ISOLATED mkdtemp
  # store (never the real ~/.pi). Asserts: live probe -> CREATE (record carries backend/
  # nativeSessionId/caller-cwd); re-register -> ATTACH (SAME garden id, cwd refreshed, ONE
  # record, no duplicate mint); dead/indeterminate probe -> REFUSE (throws, NO record written);
  # RECEIVER-MARKER ABSTINENCE (보정①) — the register source references no receiver-marker
  # writer (writeMetaReceiverMarker / armProvenance / META_RECEIVER_ARM_PROVENANCES).
  run_ts scripts/check-native-push-register.ts
}

check_agy_sender_identity() {
  # Deterministic gate for the #46 sender-identity lane — WHO is calling the bridge.
  # A birthed agy conversation could already CALL entwurf_v2 for real, yet its message
  # landed as external-mcp/unknown-host (non-replyable): the hook wrote only the
  # meta-record, and the bridge's resolver looked markers up under `claude-code` alone.
  # Behavioral, not source-regex: the real hook runs as a child process (so the marker's
  # ownerPid is the gate's own pid — the same parent-pid join production performs), and
  # the resolver runs against isolated marker/record stores.
  # Rows: hook writes an antigravity marker keyed by its PARENT pid; an upsert failure
  # writes NO marker (record authority first); resolver 0→null, 1→identity on EITHER
  # backend, no-record/drifted marker→null, two distinct live identities on one owner pid
  # →THROW (never guess, never downgrade to anonymous), two markers naming the SAME
  # identity→not a conflict; antigravity is native-push so its replyable comes from the
  # adapter probe, never from a mailbox watch it can never arm (보정①).
  run_ts scripts/check-agy-sender-identity.ts
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
  run_ts scripts/check-package-source-routing.ts
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
  run_ts scripts/smoke-session-id-name.ts || {
    fail "[smoke-session-id-name] live substrate smoke failed"
    return 1
  }
  ok "[smoke-session-id-name] --session-id/--name substrate proven (append + spawn-only name + wrong-cwd footgun)"
  return 0
}



check_dep_versions() {
  # Catches pi version-pin drift across package.json, run.sh, and the baseline
  # docs. Concretely the kind of skew that produced commit 21de0f9's "0.11.1
  # leftover" review comment: package.json bumped to 0.12.0 while README
  # and run.sh's setup gate still claimed 0.11.1. Static check, no
  # subprocess — fast enough to run inside `pnpm check` and pre-commit.
  # The doc half of that promise was prose only until 0.12.8 — see the
  # BASELINE DOCS block below, which finally makes this comment true.
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
// the 0.80 public trust exports the bridge imports, AND an upper bound at the
// next minor stops a fresh install from silently pulling a future pi (0.81+)
// whose internal export surface has drifted from the one we typecheck against.
// pi moves its public surface every minor (the 0.79→0.80 getModels→provider-
// factory churn is exactly this), so an open `>=` floor is exactly how the next
// installer re-acquires the drift. Expected
// shape: `>=<devDep> <0.<minor+1>` (e.g. `>=0.80.6 <0.81`).
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

// BASELINE DOCS (0.12.8). This gate was BORN reading a doc: 362becd added it
// after the 21de0f9 drift and asserted README.md's codex-acp install pin against
// package.json. bf4a533 then dropped the openclaw/ACP lane and took that
// assertion out with it — but left the coverage CLAIM standing in the usage line
// and the comment above. So the doc half of the promise has been prose ever
// since, and pi's baseline docs were never bound here at all. The 0.80.3→0.80.6
// bump touched FIVE such files, and a hand-grep — not a gate — is what kept
// demo/README.md from being left behind. A declaration no gate reads is exactly
// what this repair cut exists to delete, so the docs are back IN the gate.
// Scope is deliberately narrow: only sentences that DECLARE the pi pin. History
// (CHANGELOG/NEXT) keeps its old versions, and a pi mention without a version
// (an uninstall line, a type import) is not a declaration.
const BASELINE_DOCS = ['AGENTS.md', 'README.md', 'ROADMAP.md', 'docs/setup-clean-host.md', 'demo/README.md'];
let rangeDecls = 0, exactDecls = 0;
for (const file of BASELINE_DOCS) {
  const text = readFileSync(file, 'utf8');
  // Closed-range declarations: `>=<floor> <0.<ceiling>` (spaces optional).
  for (const [decl, floor, ceilMinor] of text.matchAll(/>=\s?(\d+\.\d+\.\d+)\s?<\s?0\.(\d+)/g)) {
    rangeDecls++;
    assert.equal(floor, piAi,
      `${file}: declared pi floor in "${decl}" is ${floor}, but the devDep pin is ${piAi} — a baseline doc may not advertise a version no gate drives`);
    assert.equal(Number(ceilMinor), piMin + 1,
      `${file}: declared pi ceiling in "${decl}" must be the next minor (0.${piMin + 1})`);
  }
  // Exact install pins: `@earendil-works/pi-<pkg>@<version>`.
  for (const [decl, ver] of text.matchAll(/@earendil-works\/pi-(?:ai|coding-agent|tui)@(\d+\.\d+\.\d+)/g)) {
    exactDecls++;
    assert.equal(ver, piAi, `${file}: install example "${decl}" pins ${ver}, but the devDep pin is ${piAi}`);
  }
}
// Prose declarations carry the pin in sentences the two patterns above cannot
// see. Each MUST still be found: a reworded baseline sentence has to fail loud
// here, never pass by matching nothing.
const PROSE_DECLS = [
  ['demo/README.md', /current floor (\d+\.\d+\.\d+)/, 'current floor <version>'],
  ['ROADMAP.md', /\bpi (\d+\.\d+\.\d+) fence\b/, 'pi <version> fence'],
  ['ROADMAP.md', /floor = \*\*(\d+\.\d+\.\d+)\*\*/, 'floor = **<version>**'],
  ['AGENTS.md', /devDep exact `(\d+\.\d+\.\d+)`/, 'devDep exact `<version>`'],
];
for (const [file, re, shape] of PROSE_DECLS) {
  const m = readFileSync(file, 'utf8').match(re);
  assert.ok(m, `${file}: the baseline sentence "${shape}" is gone — restore it or update check-dep-versions; a doc reword must not silently drop the pin from the gate`);
  assert.equal(m[1], piAi, `${file}: "${shape}" declares ${m[1]}, but the devDep pin is ${piAi}`);
}
// Guard the guard: if the patterns ever stop matching, the loops above pass
// vacuously and the docs fall back OUT of the gate without a word.
assert.ok(rangeDecls >= 5, `expected at least 5 pi range declarations across the baseline docs, found ${rangeDecls} — the doc scan matched (almost) nothing and would pass vacuously`);
assert.ok(exactDecls >= 1, `expected at least 1 exact pi install pin in the baseline docs, found ${exactDecls}`);

console.log(`[check-dep-versions] ok — pi ${piAi} is coherent across package.json (devDeps + peer range), run.sh (peer-install pins), and ${BASELINE_DOCS.length} baseline docs (${rangeDecls} range + ${exactDecls} exact + ${PROSE_DECLS.length} prose declarations)`);
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
  #
  # pi 0.80 EXCEPTION — exactly ONE allowlisted subpath:
  #   @earendil-works/pi-ai/compat
  # 0.80 moved the standalone root `getModels()` to the deprecated `/compat`
  # entrypoint. This repo's pi-extensions/** are loaded by pi's EXTENSION loader
  # (pi-coding-agent `core/extensions/loader.ts`), whose jiti alias map resolves
  # ONLY three pi-ai specifiers for extensions — the bare root, `/compat`, and
  # `/oauth` — all to `ai/dist/compat.js`. A `providers/*` subpath is NOT in that
  # map: jiti prefix-matches the bare `@earendil-works/pi-ai` alias and appends
  # the remainder, producing the unresolvable `…/dist/compat.js/providers/
  # anthropic` (verified live: extension load crash — invisible to static
  # typecheck, which resolves against node_modules `exports`). So `/compat` is the
  # sanctioned extension entrypoint for the old global model-catalog API
  # (lib/acp/models.ts: `getModels`), and the ONLY allowlisted exception. The
  # allow-pattern is closing-quote-anchored (`@earendil-works/pi-ai/compat["'\`]`)
  # so it permits ONLY that exact specifier: `/compat-foo`, `/oauth`, every
  # `/providers/*`, and any deeper path stay FORBIDDEN (we use only `/compat`).
  # Do NOT widen this to a `providers/*` subpath — it typechecks but CANNOT
  # resolve under the extension loader.
  local hits
  hits=$(cd "$REPO_DIR" && git ls-files '*.ts' '*.js' '*.mjs' '*.cjs' \
    | grep -vE '^(node_modules|dist)/' \
    | xargs -r grep -HnE "[\"'\`]@earendil-works/pi-(ai|coding-agent|tui)/" 2>/dev/null \
    | grep -vE "[\"'\`]@earendil-works/pi-ai/compat[\"'\`]" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "[check-pi-import-surface] FAIL: pi private subpath reference(s) — import @earendil-works/pi-* by the package ROOT only:"
    echo "$hits"
    exit 1
  fi
  ok "[check-pi-import-surface] pi references are root-only (no private subpath; all tracked ts/js scanned)"
}

check_env_namespace() {
  # 0.11 S3 cutover lock: after the env-namespace rename, NO tracked source may
  # carry the old pi-centric env/const prefixes (PI_SHELL_ACP*, PI_META*,
  # PI_TOOLS_BRIDGE*, PI_ENTWURF*). This deterministic guard keeps the cutover
  # from silently regressing — a single old prefix slipping back in fails loud.
  # KEEP pi-adapter env (PI_SESSION_ID, PI_AGENT_ID, PI_CODING_AGENT_DIR,
  # PI_SETTINGS_PATH, PI_EMACS_AGENT_SOCKET) is NOT in the forbidden set, so it
  # passes untouched. The forbidden pattern uses a [_] char-class for the
  # trailing underscore so THIS gate's own definition never self-matches; for
  # the same reason every prose mention above uses a `*`, not a trailing `_`.
  # Docs/CHANGELOG/NEXT keep historical mentions and are excluded.
  local hits
  hits=$(cd "$REPO_DIR" && git ls-files \
    | grep -vE '\.(md|org)$|(^|/)NEXT|(^|/)CHANGELOG|^docs/' \
    | xargs -r grep -HnE 'PI_SHELL_ACP[_]|PI_META[_]|PI_TOOLS_BRIDGE[_]|PI_ENTWURF[_]' 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "[check-env-namespace] FAIL: old pi env/const prefix survived the S3 cutover — rename to ENTWURF_*/ENTWURF_ACP_*/ENTWURF_META_*/ENTWURF_BRIDGE_*:"
    echo "$hits"
    exit 1
  fi
  ok "[check-env-namespace] env namespace is entwurf-only (no old pi env/const prefix in tracked source)"
}

check_pi_runtime_version() {
  # 0.11 Stage 0 (동결결정 9, runtime half): tsc catches a missing 0.80 export
  # at dev time, but an installed environment can still resolve a pi OUTSIDE the
  # supported range at runtime — older, where the named trust exports / 0.80
  # provider-factory surface do not exist; or newer, where they have moved again.
  # Verify VERSION against the DECLARED CLOSED RANGE (both ends, see below) via a
  # DYNAMIC import of the package root only — never statically import a
  # range-only symbol here, or this guard would crash before it can fail loud.
  #
  # The floor is DERIVED from the package.json devDep pin, never a second literal.
  # A hand-kept `const FLOOR = '<version>'` is a declaration no gate enforces:
  # check-dep-versions binds the devDeps, the peer range, and the check-pack-install
  # peer pins to one another, but it never saw this constant — so a pi bump that
  # forgot it would leave the runtime gate still blessing the OLD floor, silently.
  # That is the same "declared runtime ≠ verified runtime" split the 0.12.8
  # check-pack-install fix closed; there must be exactly ONE pin to move.
  (cd "$REPO_DIR" && node --input-type=module <<'EOF'
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const FLOOR = pkg.devDependencies?.['@earendil-works/pi-coding-agent'];
if (typeof FLOOR !== 'string' || !/^\d+\.\d+\.\d+$/.test(FLOOR)) {
  console.error(`[check-pi-runtime-version] FAIL: package.json devDependencies['@earendil-works/pi-coding-agent'] must be an EXACT x.y.z pin to serve as the runtime floor (got ${FLOOR ?? 'nothing'})`);
  process.exit(1);
}
// The declared contract is a CLOSED range (`>=<devDep> <0.<minor+1>`, enforced on
// package.json by check-dep-versions), so the runtime check must be closed too.
// A floor-only comparison would bless a resolved pi ABOVE the ceiling — and an
// out-of-range pi is exactly the drift this cut exists to stop: 0.80.6 landed on
// the dev box while the repo still declared 0.80.3, and every gate stayed green.
// Verifying only half of a declared range is the same lie in the other direction.
const CEILING = `0.${Number(FLOOR.split('.')[1]) + 1}.0`;
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
  console.error(`[check-pi-runtime-version] FAIL: pi VERSION ${VERSION} < ${FLOOR} — the bridge is built and tested against the ${FLOOR} public/runtime surface (trust exports hasTrustRequiringProjectResources + ProjectTrustStore nearest-ancestor get, the 0.80 model-catalog API getModels reached via the deprecated /compat entrypoint — 0.80 moved the standalone root getModels there, and the extension loader resolves only /compat, NOT the providers/* factory subpath — provider registration surface, compaction semantics) that older pi lacks or behaves differently on. Bump @earendil-works/pi-*.`);
  process.exit(1);
}
if (cmp(VERSION, CEILING) >= 0) {
  console.error(`[check-pi-runtime-version] FAIL: pi VERSION ${VERSION} >= ${CEILING} — OUTSIDE the declared range (>=${FLOOR} <${CEILING.slice(0, -2)}). pi moves its public surface every minor (the 0.79→0.80 getModels→/compat churn), so a next-minor runtime is unverified by definition: no gate here has driven it. Either pin the repo to that pi (devDeps + peer range + baseline docs move together) or install the declared one.`);
  process.exit(1);
}
console.log(`[check-pi-runtime-version] ok — pi VERSION ${VERSION} within the declared range (>=${FLOOR} <${CEILING.slice(0, -2)})`);
EOF
  )
}

check_install_preflight() {
  # 0.12 relocation guard (2026-06-23): `install` MUST fail loud on a repo whose
  # node_modules is missing (fresh clone, no pnpm install) or path-stale (a dir
  # move/rename broke the pnpm symlink store) — and it must fail BEFORE writing
  # settings.json, so the breakage is not a silent-red that only surfaces minutes
  # later as a dead MCP bridge (entwurf-bridge ✘ Failed to connect) + a
  # check-entwurf-v2-surface ERR_MODULE_NOT_FOUND. The preflight follows each
  # dep's symlink to its real package.json (immune to per-package "exports" maps
  # that forbid a bare-root or ./package.json import), which a bare
  # `test -d node_modules` cannot do for a dir-move. REPO_DIR is the dir holding
  # run.sh (line 16), so the negative cases copy run.sh into a temp dir to point
  # REPO_DIR at a deliberately-broken tree.
  local rc out proj fake dep

  # positive — the live repo passes the REAL preflight. Calling it directly keeps
  # preflight_dep_integrity the single source of truth for the probe set (no
  # second hardcoded list to drift). Subshell so its exit-on-fail can't kill us.
  if ! ( preflight_dep_integrity ) >/dev/null 2>&1; then
    fail "[check-install-preflight] live repo fails preflight_dep_integrity — run 'pnpm install' (gate cannot validate against a broken repo)"
    exit 1
  fi
  ok "[check-install-preflight] live repo passes preflight (all runtime hard deps resolve)"

  # negative 1 — missing node_modules (fresh clone)
  fake=$(mktemp -d); proj=$(mktemp -d)
  cp "$REPO_DIR/run.sh" "$fake/run.sh"
  rc=0; out=$("$fake/run.sh" install "$proj" 2>&1) || rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "[check-install-preflight] missing node_modules did NOT fail install"; rm -rf "$fake" "$proj"; exit 1
  fi
  if [ -f "$proj/.pi/settings.json" ]; then
    fail "[check-install-preflight] install wrote settings.json with missing deps (SILENT-RED)"; echo "$out"; rm -rf "$fake" "$proj"; exit 1
  fi
  if ! printf '%s' "$out" | grep -q "repo dependency integrity check failed"; then
    fail "[check-install-preflight] missing node_modules failed for the WRONG reason:"; echo "$out"; rm -rf "$fake" "$proj"; exit 1
  fi
  rm -rf "$fake" "$proj"
  ok "[check-install-preflight] missing node_modules → fails before writing settings"

  # negative 2 — representative dangling symlink (dir move): node_modules/ EXISTS
  # (a bare `test -d` would pass) with the other runtime deps symlinked live, but a
  # representative dep (@anthropic-ai/sdk) dangles. Asserts the dir-move blind spot
  # is closed AND that the failure names the broken dep. Uses a BUNDLED runtime dep
  # because the @earendil-works/pi-* peer trio is loader-provided and no longer part
  # of the install preflight probe set.
  fake=$(mktemp -d); proj=$(mktemp -d)
  cp "$REPO_DIR/run.sh" "$fake/run.sh"
  mkdir -p "$fake/node_modules/@modelcontextprotocol" "$fake/node_modules/@agentclientprotocol" "$fake/node_modules/@anthropic-ai"
  ln -s "$REPO_DIR/node_modules/@modelcontextprotocol/sdk" "$fake/node_modules/@modelcontextprotocol/sdk"
  ln -s "$REPO_DIR/node_modules/@agentclientprotocol/sdk" "$fake/node_modules/@agentclientprotocol/sdk"
  ln -s "$REPO_DIR/node_modules/@agentclientprotocol/claude-agent-acp" "$fake/node_modules/@agentclientprotocol/claude-agent-acp"
  ln -s "$REPO_DIR/node_modules/zod" "$fake/node_modules/zod"
  ln -s /nonexistent/pnpm-store/anthropic-sdk "$fake/node_modules/@anthropic-ai/sdk"
  rc=0; out=$("$fake/run.sh" install "$proj" 2>&1) || rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "[check-install-preflight] dangling dep symlink did NOT fail install (test -d blind spot)"; rm -rf "$fake" "$proj"; exit 1
  fi
  if [ -f "$proj/.pi/settings.json" ]; then
    fail "[check-install-preflight] install wrote settings.json with a dangling dep (SILENT-RED)"; echo "$out"; rm -rf "$fake" "$proj"; exit 1
  fi
  if ! printf '%s' "$out" | grep -q "repo dependency integrity check failed"; then
    fail "[check-install-preflight] dangling symlink failed for the WRONG reason:"; echo "$out"; rm -rf "$fake" "$proj"; exit 1
  fi
  if ! printf '%s' "$out" | grep -q "@anthropic-ai/sdk"; then
    fail "[check-install-preflight] dangling case did not name the broken dep (@anthropic-ai/sdk):"; echo "$out"; rm -rf "$fake" "$proj"; exit 1
  fi
  rm -rf "$fake" "$proj"
  ok "[check-install-preflight] representative dangling symlink (test -d blind spot) → fails before writing settings, names the dep"

  # negative 3 — corrupt project provider shape. install_local_package now has a
  # two-step writer (packages[] SSOT, then entwurfProvider.mcpServers), so a
  # malformed provider MUST fail before the packages[] step writes anything.
  fake=$(mktemp -d); proj=$(mktemp -d)
  mkdir -p "$proj/.pi" "$fake/home"
  printf '{"entwurfProvider": []}\n' > "$proj/.pi/settings.json"
  local before after
  before=$(sha256sum "$proj/.pi/settings.json" | cut -d' ' -f1)
  rc=0; out=$(HOME="$fake/home" PI_CODING_AGENT_DIR="$fake/home/.pi/agent" "$REPO_DIR/run.sh" install "$proj" 2>&1) || rc=$?
  after=$(sha256sum "$proj/.pi/settings.json" | cut -d' ' -f1)
  if [ "$rc" -eq 0 ]; then
    fail "[check-install-preflight] corrupt entwurfProvider did NOT fail install"; echo "$out"; rm -rf "$fake" "$proj"; exit 1
  fi
  if [ "$before" != "$after" ]; then
    fail "[check-install-preflight] corrupt entwurfProvider was partially rewritten (packages[] leak)"; echo "$out"; cat "$proj/.pi/settings.json"; rm -rf "$fake" "$proj"; exit 1
  fi
  if ! printf '%s' "$out" | grep -q "entwurfProvider is not an object"; then
    fail "[check-install-preflight] corrupt entwurfProvider failed for the WRONG reason:"; echo "$out"; rm -rf "$fake" "$proj"; exit 1
  fi
  if [ -f "$fake/home/.pi/agent/settings.json" ]; then
    fail "[check-install-preflight] corrupt project provider still wrote user-scope settings"; cat "$fake/home/.pi/agent/settings.json"; rm -rf "$fake" "$proj"; exit 1
  fi
  rm -rf "$fake" "$proj"
  ok "[check-install-preflight] corrupt project entwurfProvider → fails before any project/user settings write"

  # negative 4 — corrupt project mcpServers shape, same no-partial-write contract.
  fake=$(mktemp -d); proj=$(mktemp -d)
  mkdir -p "$proj/.pi" "$fake/home"
  printf '{"entwurfProvider": {"mcpServers": []}}\n' > "$proj/.pi/settings.json"
  before=$(sha256sum "$proj/.pi/settings.json" | cut -d' ' -f1)
  rc=0; out=$(HOME="$fake/home" PI_CODING_AGENT_DIR="$fake/home/.pi/agent" "$REPO_DIR/run.sh" install "$proj" 2>&1) || rc=$?
  after=$(sha256sum "$proj/.pi/settings.json" | cut -d' ' -f1)
  if [ "$rc" -eq 0 ]; then
    fail "[check-install-preflight] corrupt entwurfProvider.mcpServers did NOT fail install"; echo "$out"; rm -rf "$fake" "$proj"; exit 1
  fi
  if [ "$before" != "$after" ]; then
    fail "[check-install-preflight] corrupt mcpServers was partially rewritten (packages[] leak)"; echo "$out"; cat "$proj/.pi/settings.json"; rm -rf "$fake" "$proj"; exit 1
  fi
  if ! printf '%s' "$out" | grep -q "entwurfProvider.mcpServers is not an object"; then
    fail "[check-install-preflight] corrupt mcpServers failed for the WRONG reason:"; echo "$out"; rm -rf "$fake" "$proj"; exit 1
  fi
  rm -rf "$fake" "$proj"
  ok "[check-install-preflight] corrupt project entwurfProvider.mcpServers → fails before any project settings write"

  # negative 5 — corrupt user-scope packages shape. Since install writes project
  # settings before user registration, this preflight must catch the user file up
  # front so a bad ~/.pi/agent/settings.json cannot leave the project half-wired.
  fake=$(mktemp -d); proj=$(mktemp -d)
  mkdir -p "$fake/home/.pi/agent"
  printf '{"packages": {"broken": true}}\n' > "$fake/home/.pi/agent/settings.json"
  rc=0; out=$(HOME="$fake/home" PI_CODING_AGENT_DIR="$fake/home/.pi/agent" "$REPO_DIR/run.sh" install "$proj" 2>&1) || rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "[check-install-preflight] corrupt user packages did NOT fail install"; echo "$out"; rm -rf "$fake" "$proj"; exit 1
  fi
  if [ -f "$proj/.pi/settings.json" ]; then
    fail "[check-install-preflight] corrupt user packages still wrote project settings (partial install)"; echo "$out"; cat "$proj/.pi/settings.json"; rm -rf "$fake" "$proj"; exit 1
  fi
  if ! printf '%s' "$out" | grep -q "user settings packages is not a JSON array"; then
    fail "[check-install-preflight] corrupt user packages failed for the WRONG reason:"; echo "$out"; rm -rf "$fake" "$proj"; exit 1
  fi
  rm -rf "$fake" "$proj"
  ok "[check-install-preflight] corrupt user-scope packages → fails before project settings write"

  # negative 6 — remove has the same two-step write risk (packages[] remove,
  # then provider cleanup). A corrupt provider must fail before packages[] is
  # altered, otherwise uninstall becomes a partial destructive write.
  proj=$(mktemp -d)
  mkdir -p "$proj/.pi"
  printf '{"entwurfProvider": [], "packages": ["%s"]}\n' "$REPO_DIR" > "$proj/.pi/settings.json"
  before=$(sha256sum "$proj/.pi/settings.json" | cut -d' ' -f1)
  rc=0; out=$("$REPO_DIR/run.sh" remove "$proj" 2>&1) || rc=$?
  after=$(sha256sum "$proj/.pi/settings.json" | cut -d' ' -f1)
  if [ "$rc" -eq 0 ]; then
    fail "[check-install-preflight] corrupt provider did NOT fail remove"; echo "$out"; rm -rf "$proj"; exit 1
  fi
  if [ "$before" != "$after" ]; then
    fail "[check-install-preflight] corrupt provider remove partially rewrote packages[]"; echo "$out"; cat "$proj/.pi/settings.json"; rm -rf "$proj"; exit 1
  fi
  rm -rf "$proj"
  ok "[check-install-preflight] remove with corrupt provider → fails before packages[] removal"
}

check_pi_preflight() {
  # 0.11 Stage 0 (2): the controlled-launch trust decision. Proves frozen
  # decision 8 precedence (saved false > saved true > prefix > no-inputs >
  # fail-fast) and decision 7's separator-boundary prefix against pi's own
  # ProjectTrustStore in a temp agentDir. Deterministic, no network/backend.
  run_ts scripts/check-pi-preflight.ts
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
  run_ts scripts/check-acp-provider-surface.ts
}

check_acp_sdk_surface() {
  # Deterministic gate for the S2a ACP SDK dependency surface. Pins the three
  # ACP runtime deps to the current oracle versions (@agentclientprotocol/sdk
  # 1.1.0 + claude-agent-acp 0.54.1 + @anthropic-ai/sdk 0.100.1), locks the
  # peer-resolution that keeps claude-agent-sdk satisfiable (0.100.1, not the
  # stale 0.91.1), asserts the wire SDK still value-exports the symbols the raw
  # turn needs (silent-rename gate), and forbids any source-level anthropic SDK
  # import / API-client use (the anthropic dep is a peer-pin ONLY).
  section "ACP SDK surface (S2a dep pin + peer-resolution + no-client-use)"
  run_ts scripts/check-acp-sdk-surface.ts
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
  run_ts scripts/check-acp-overlay.ts
}

check_acp_tool_surface() {
  # Deterministic gate for the S2b Claude tool surface + exclude-tools
  # truthfulness preflight. Matrix over assertExcludeToolsHonored (claude
  # narrows via tools / native always-exposes / extension-tool exclusion is
  # honest) + buildClaudeSessionMeta shape lock (tools/allow/disallowed/
  # extraArgs/plugins) + the S2b billing-carrier guard (no _meta.systemPrompt
  # unless a caller supplies one). Pure preflight — NOT a backend wire read.
  section "ACP tool surface (S2b exclude-tools preflight + session meta)"
  run_ts scripts/check-acp-tool-surface.ts
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
  run_ts scripts/check-acp-event-mapper.ts
}

check_acp_prompt_builder() {
  # Deterministic gate for the S2d bootstrapPath-scoped ACP prompt builder (핀4).
  # Proves prompt SCOPE follows bootstrapPath: new=full transcript (history
  # carrier), reuse/resume/load=latest user delta (first user after last
  # assistant, SessionStart hook skipped, image marker kept, prior history
  # excluded so a reuse session is not re-injected its own history). Pure, no
  # session store yet — locks the builder before S2d wires the reuse paths.
  section "ACP prompt builder (S2d bootstrapPath prompt scope)"
  run_ts scripts/check-acp-prompt-builder.ts
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
  run_ts scripts/check-acp-config.ts
}

check_acp_session_store() {
  # Deterministic gate for the S2d-1b-1 session store / signature / bootstrap
  # decision. Locks: model-lock fail-loud throw in the pure decision, prefix-
  # compat (only a prefix history reuses; edited/compaction → new), carrier
  # drift → signature change → incompatible, and bootstrapPath ⟂ lifecyclePolicy
  # (turn-scoped/-p one-shot is ALWAYS new — no in-memory reuse, no persisted
  # resume/load in the first cut). Pure + temp-dir record I/O, no child/spawn.
  section "ACP session store (S2d-1b-1 signature/compat/bootstrap decision)"
  run_ts scripts/check-acp-session-store.ts
}

check_acp_backend_preflight() {
  # Deterministic gate for the S2c runtime tool-surface preflight. Calls
  # streamShellAcp with a context whose declared tools exclude a built-in the
  # Claude child still exposes (read) and asserts the turn fails fast into the
  # returned stream as an error event BEFORE any spawn — proving
  # assertExcludeToolsHonored is wired into the live provider path, not just the
  # pure gate. No backend launched (preflight throws first). Pure.
  section "ACP backend preflight (S2c runtime exclude-tools wiring)"
  run_ts scripts/check-acp-backend-preflight.ts
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
  run_ts scripts/check-acp-session-reuse.ts
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
  run_ts scripts/check-acp-carrier-augment.ts
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
  # --silent so the `prepack` build (pnpm --silent run build-bridge → tsc) and
  # npm's own lifecycle banner stay off stdout; otherwise they pollute the --json
  # payload this parses. prepack runs on dry-run too, which is how dist lands in
  # this gate's file list.
  # with-dist-lock wraps the WHOLE pack (prepack build-bridge emit + npm's
  # post-build dist read) so a concurrent pack/build can't `rm -rf dist` mid-read
  # (the 2026-07-03 phantom "dist missing" race). The nested prepack build-bridge
  # is reentrant via ENTWURF_BUILD_LOCK_HELD.
  json=$(cd "$REPO_DIR" && bash scripts/with-dist-lock.sh npm pack --dry-run --json --silent 2>/dev/null) || {
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
    # 0.12.1 C — the prepack-built node_modules-safe boot artifact. start.sh runs
    # this dist JS when present (the .ts source can't strip-types under
    # node_modules). prepack runs on `npm pack --dry-run`, so it is in this gate.
    "mcp/entwurf-bridge/dist/mcp/entwurf-bridge/src/index.js"
    # 0.12.4 — the doctor's node_modules-safe store-scan artifact. meta-bridge-
    # doctor.sh runs this prebuilt JS when installed under node_modules (strip-types
    # refuses the .ts there), same boundary start.sh crosses. build-bridge emits it.
    "mcp/entwurf-bridge/dist/scripts/meta-bridge-store-doctor.js"
    # 0.12.7 — node_modules-safe agy PreInvocation hook. The stable npm bin
    # dispatches here because Node refuses raw .ts below node_modules.
    "mcp/entwurf-bridge/dist/scripts/agy-imprint.js"
    # 0.12.7 — the three OPERATOR commands run.sh dispatches. Installed, REPO_DIR is
    # under node_modules, so run_ts must find a compiled twin or the command is dead.
    "mcp/entwurf-bridge/dist/scripts/doctor-pi-provider.js"
    "mcp/entwurf-bridge/dist/scripts/new-session-id.js"
    "mcp/entwurf-bridge/dist/scripts/meta-bridge-prune.js"
    # 0.12.5 — the node_modules-safe plugin hook + its lib. install-meta-bridge copies
    # these compiled JS into the assembled plugin when installed (raw .ts can't
    # strip-types under node_modules). meta-session.js is shared with the store-doctor
    # above; listed here too so the hook axis fails loud if the emit graph drops it.
    "mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-hook.js"
    "mcp/entwurf-bridge/dist/pi-extensions/lib/meta-session.js"
    "scripts/postinstall-chmod.cjs"
    "pi/entwurf-capabilities.json"
    "pi/entwurf-targets.json"
    "pi/meta-bridge/.claude-plugin/marketplace.json"
    "pi/meta-bridge/entwurf-meta-receive/.claude-plugin/plugin.json"
    "pi/meta-bridge/entwurf-meta-receive/hooks/hooks.json"
    "pi/meta-bridge/entwurf-meta-receive/scripts/doorbell.sh"
    "pi-extensions/meta-bridge-hook.ts"
    "pi-extensions/lib/meta-session.ts"
    "pi-extensions/lib/session-id.js"
    "scripts/meta-bridge-install.sh"
    "scripts/meta-bridge-state.py"
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
    'pi/meta-bridge/\.assembled/'
    # Python bytecode residue — `scripts/` ships whole via the files allowlist,
    # which BYPASSES .gitignore/.npmignore for its contents, so a `pnpm check`
    # run's generated scripts/__pycache__/*.pyc rode into the 0.12.6 tarball. The
    # files-array `!**/__pycache__` / `!**/*.pyc` negations exclude it; this is the
    # tripwire that fails loud if that negation is ever dropped (결합 규칙).
    '__pycache__'
    '\.pyc$'
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

_check_pack_install_impl() {
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
  # Pack into a UNIQUE per-run dir, never the repo root. Writing/removing a fixed
  # ${REPO_DIR}/<tgz> pollutes the working tree (a crash leaves a stray tarball) AND
  # lets two concurrent packs corrupt/delete each other's artifact ("tarball data
  # seems corrupted" / ENOENT; a half-installed package then fails the later
  # install-meta-bridge check downstream). A per-run pack dir makes the tarball
  # instance-private end-to-end — every consumer below + the trap follow $pack_tmp.
  local pack_tmp
  pack_tmp=$(mktemp -d -t entwurf-pack.XXXXXX)
  tgz_path="${pack_tmp}/${tgz_name}"

  # 0.12.1 C — stale-dist guard. `tsc` emit does NOT prune orphaned files from
  # outDir, and `files: ["mcp/"]` would carry any leftover dist file into the
  # tarball. build-bridge therefore `rm -rf`s dist before emit. Prove it: plant a
  # sentinel in dist, then assert the pack's prepack (build-bridge) wiped it so it
  # never reaches the tarball. Without the clean step this sentinel ships.
  local stale_probe="${REPO_DIR}/mcp/entwurf-bridge/dist/__stale_probe__.js"
  mkdir -p "$(dirname "$stale_probe")"
  printf 'module.exports = "stale";\n' > "$stale_probe"

  echo "[check-pack-install] npm pack -> ${tgz_name}"
  # with-dist-lock: same whole-pack serialization as check-pack — this heavy gate
  # and a background check-pack (via `pnpm check`) both pack, and unserialized they
  # race the shared dist dir. The stale-dist sentinel planted just above still
  # proves build-bridge's own `rm -rf dist` clean step under the lock.
  (cd "$REPO_DIR" && bash scripts/with-dist-lock.sh npm pack --dry-run=false --pack-destination "$pack_tmp" 2>&1 | tail -1) || {
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

  # 0.12.1 C — the planted stale sentinel must NOT have survived into the tarball.
  # If it did, build-bridge's `rm -rf dist` clean step regressed and stale/orphan
  # emit can ship. (See the plant just before npm pack above.)
  if grep -qxF "mcp/entwurf-bridge/dist/__stale_probe__.js" <<<"$tar_files"; then
    rm -rf "$pack_tmp"
    fail "[check-pack-install] stale dist file shipped — build-bridge did not clean dist before emit (orphan-emit publish risk)"
    return 1
  fi

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
    # 0.12.1 C — prepack-built node_modules-safe boot artifact (see check-pack).
    "mcp/entwurf-bridge/dist/mcp/entwurf-bridge/src/index.js"
    # 0.12.4 — prebuilt node_modules-safe store-scan artifact for the doctor
    # (see check-pack). The installed-scan smoke below runs exactly this file.
    "mcp/entwurf-bridge/dist/scripts/meta-bridge-store-doctor.js"
    # 0.12.7 — node_modules-safe agy PreInvocation hook. The installed bin smoke
    # below executes this exact compiled leaf from under node_modules.
    "mcp/entwurf-bridge/dist/scripts/agy-imprint.js"
    # 0.12.7 — the three operator commands (see check-pack). The installed-command
    # regression below drives each one through the real `entwurf` bin.
    "mcp/entwurf-bridge/dist/scripts/doctor-pi-provider.js"
    "mcp/entwurf-bridge/dist/scripts/new-session-id.js"
    "mcp/entwurf-bridge/dist/scripts/meta-bridge-prune.js"
    # 0.12.5 — node_modules-safe plugin hook + lib (see check-pack). The installed
    # hook regression below runs exactly this compiled JS from under node_modules.
    "mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-hook.js"
    "mcp/entwurf-bridge/dist/pi-extensions/lib/meta-session.js"
    "scripts/postinstall-chmod.cjs"
    "pi/entwurf-capabilities.json"
    "pi/entwurf-targets.json"
    "pi/meta-bridge/.claude-plugin/marketplace.json"
    "pi/meta-bridge/entwurf-meta-receive/.claude-plugin/plugin.json"
    "pi/meta-bridge/entwurf-meta-receive/hooks/hooks.json"
    "pi/meta-bridge/entwurf-meta-receive/scripts/doorbell.sh"
    "pi-extensions/meta-bridge-hook.ts"
    "pi-extensions/lib/meta-session.ts"
    "pi-extensions/lib/session-id.js"
    "scripts/meta-bridge-install.sh"
    "scripts/meta-bridge-state.py"
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
    'pi/meta-bridge/\.assembled/'
    # Python bytecode residue (see check-pack forbidden note): scripts/ ships
    # whole, so generated pyc bypasses ignore files — this cross-checks the actual
    # tarball, not just the dry-run resolver.
    '__pycache__' '\.pyc$'
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
    rm -rf "$pack_tmp"
    fail "[check-pack-install] tar -tf invariants violated"
    return 1
  fi
  echo "[check-pack-install] tar -tf invariants pass ($(printf '%s\n' "$tar_files" | wc -l | tr -d ' ') files)"

  # Fresh-temp install smoke. Uses pnpm because that is what this
  # repo packages with; --ignore-workspace stops it from re-attaching
  # to our pnpm-workspace.yaml; --ignore-scripts blocks the husky
  # prepare hook (and any future install scripts) from running inside
  # the consumer project. Peer deps are pinned to the 0.80.x release
  # baseline so the smoke matches the same shape an external pi user
  # would have after `pi install`.
  local tmp npm_tmp
  tmp=$(mktemp -d -t entwurf-install-smoke.XXXXXX)
  # Separate tree for the npm-managed regression below: npm install must NOT be
  # nested under $tmp, whose pnpm-add node_modules/package.json would make npm
  # climb the parent and choke ("Cannot read properties of null").
  npm_tmp=$(mktemp -d -t entwurf-npm-managed.XXXXXX)
  trap 'rm -rf "$tmp" "$npm_tmp" "$pack_tmp"' RETURN

  printf '%s\n' '{ "name": "entwurf-install-smoke", "version": "0.0.0", "private": true }' > "$tmp/package.json"

  echo "[check-pack-install] pnpm add into $tmp (with 0.80.x peers + typebox)"
  local install_log
  install_log=$(cd "$tmp" && pnpm add \
    "$tgz_path" \
    "@earendil-works/pi-ai@0.80.6" \
    "@earendil-works/pi-coding-agent@0.80.6" \
    "@earendil-works/pi-tui@0.80.6" \
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
  #
  # The pi that loads the tarball is the PINNED peer this smoke just installed next to
  # it ($tmp/node_modules/.bin/pi = the floor of the supported peer range), NEVER
  # whatever `pi` the host happens to have on PATH. A gate may not READ the operator's
  # global install any more than it may WRITE it: PATH resolution made this gate green
  # on a dev box carrying a newer global pi and RED in CI, which carries no global pi
  # at all — and in neither case was it driving the runtime the repo actually pins.
  #
  # EVERY pi invocation below — including `--version` — runs under the throwaway
  # HOME/XDG/agent-dir defined here once. pi reads settings BEFORE it prints its
  # version (bootstrapSettingsManager precedes the --version branch in pi's main),
  # so an unsandboxed probe would open the operator's real ~/.pi/agent/settings.json:
  # the same read coupling this fix exists to remove. One env array, no second
  # spelling to drift out of step.
  local loader_home="$tmp/loader-home"
  mkdir -p "$loader_home/.pi/agent"
  local -a pi_env=(
    HOME="$loader_home"
    XDG_DATA_HOME="$loader_home/.local/share"
    XDG_STATE_HOME="$loader_home/.local/state"
    XDG_CACHE_HOME="$loader_home/.cache"
    PI_CODING_AGENT_DIR="$loader_home/.pi/agent"
  )

  # Assert the version: a gate that cannot name which pi it proved has proved nothing.
  # package.json devDeps is the pin SSOT (check-dep-versions keeps the peer-install
  # literals above in step with it).
  local pi_bin="$tmp/node_modules/.bin/pi" pi_pin pi_ver
  if [ ! -x "$pi_bin" ]; then
    fail "[check-pack-install] pinned pi missing from the install-smoke tree ($pi_bin) — cannot run loader smoke"
    return 1
  fi
  pi_pin=$(cd "$REPO_DIR" && node -p "require('./package.json').devDependencies['@earendil-works/pi-coding-agent']")
  pi_ver=$(cd "$tmp" && env "${pi_env[@]}" "$pi_bin" --version 2>&1 | head -1 | tr -d '[:space:]')
  if [ "$pi_ver" != "$pi_pin" ]; then
    fail "[check-pack-install] install-smoke pi is '$pi_ver', expected the pinned '$pi_pin' — the loader smoke would prove the wrong runtime"
    return 1
  fi
  echo "[check-pack-install] loader runtime: pinned pi $pi_ver (not the host's global pi)"

  # The loader smoke must depend ONLY on the -e package path, never on the operator's
  # real ~/.pi/agent/settings.json — otherwise a live-config change could silently
  # pass/fail the gate (the exact "check must not depend on live wiring" impurity
  # this whole lane is about).
  local loader_out
  loader_out=$(cd "$tmp" && env "${pi_env[@]}" "$pi_bin" -e "$tmp/node_modules/@junghanacs/entwurf" --list-models entwurf 2>&1) || {
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
  for anchor in "claude-sonnet-5" "claude-opus-4-8"; do
    if ! grep -q "$anchor" <<<"$loader_out"; then
      fail "[check-pack-install] pi loader output missing curated Claude model $anchor:"
      echo "$loader_out" | tail -10 | sed 's/^/    /' >&2
      return 1
    fi
  done
  echo "[check-pack-install] pi loader smoke pass (entwurf registered, claude-sonnet-5 + claude-opus-4-8 anchor)"

  # npm-managed neutral install regression — the README's PRIMARY install path is
  # now `npm install @junghanacs/entwurf` (NOT `pi install npm:...`). This layout
  # lands the package under node_modules, hoists runtime deps to the sibling
  # node_modules, has no package-local node_modules, and the pi peer trio must be
  # absent because pi is an optional adapter lane. The old cwd-relative
  # preflight_dep_integrity rejected every hoisted-dep npm install; 0.12.0 then
  # additionally died because start.sh tried strip-types under node_modules.
  # Prove `entwurf`/`entwurf-bridge` bins exist, `run.sh install` writes settings
  # from the hoisted layout, and the installed bridge boots from dist. HOME is
  # redirected to a throwaway dir so ensure_agent_dir_symlinks operates on a temp
  # ~/.pi/agent and never touches the operator's real targets link.
  if ! command -v npm >/dev/null 2>&1; then
    fail "[check-pack-install] npm not on PATH — cannot run npm-managed install regression"
    return 1
  fi
  local npmroot="$npm_tmp/npmroot" npmhome="$npm_tmp/npmhome" npmproj="$npm_tmp/npmproj" npm_log npm_pkg wire_log
  mkdir -p "$npmroot" "$npmhome" "$npmproj"
  npm_log=$(cd "$npmroot" && npm install "$tgz_path" --no-audit --no-fund 2>&1) || {
    fail "[check-pack-install] npm-managed neutral install failed:"
    echo "$npm_log" | tail -10 | sed 's/^/    /' >&2
    return 1
  }
  npm_pkg="$npmroot/node_modules/@junghanacs/entwurf"
  if [ ! -x "$npm_pkg/run.sh" ]; then
    fail "[check-pack-install] npm-managed layout missing executable run.sh (postinstall-chmod did not run?) at $npm_pkg"
    return 1
  fi
  if [ ! -x "$npmroot/node_modules/.bin/entwurf" ] || [ ! -x "$npmroot/node_modules/.bin/entwurf-bridge" ] || [ ! -x "$npmroot/node_modules/.bin/entwurf-statusline" ] || [ ! -x "$npmroot/node_modules/.bin/entwurf-agy-statusline" ] || [ ! -x "$npmroot/node_modules/.bin/entwurf-agy-imprint" ]; then
    fail "[check-pack-install] npm-managed neutral install missing package bins (entwurf / entwurf-bridge / entwurf-statusline / entwurf-agy-statusline / entwurf-agy-imprint)"
    ls -l "$npmroot/node_modules/.bin" 2>/dev/null | sed 's/^/    /' >&2 || true
    return 1
  fi
  wire_log=$(HOME="$npmhome" XDG_DATA_HOME="$npmhome/.local/share" XDG_STATE_HOME="$npmhome/.local/state" XDG_CACHE_HOME="$npmhome/.cache" "$npm_pkg/run.sh" install "$npmproj" 2>&1) || {
    fail "[check-pack-install] npm-managed run.sh install failed (preflight rejected hoisted deps?):"
    echo "$wire_log" | tail -15 | sed 's/^/    /' >&2
    return 1
  }
  if [ ! -f "$npmproj/.pi/settings.json" ]; then
    fail "[check-pack-install] npm-managed run.sh install did not write settings.json:"
    echo "$wire_log" | tail -15 | sed 's/^/    /' >&2
    return 1
  fi
  if ! grep -q "node_modules/@junghanacs/entwurf" <<<"$wire_log"; then
    fail "[check-pack-install] npm-managed install did not report the npm package source:"
    echo "$wire_log" | tail -15 | sed 's/^/    /' >&2
    return 1
  fi
  echo "[check-pack-install] npm-managed install regression pass (hoisted-dep run.sh install wrote settings)"

  # THE 2026-07-03 regression gate: removing `pi install` from setup dropped
  # user-scope citizen registration, so `--entwurf-control` was Unknown in a
  # foreign cwd. Prove the npm consumer path closes it end-to-end: run.sh install
  # (run above under HOME="$npmhome") must have registered the package in the USER
  # settings, and pi must then load the entwurf extension + its flags from a cwd
  # OUTSIDE the project. Fully isolated in the temp HOME — never touches ~/.pi.
  local npm_user_settings="$npmhome/.pi/agent/settings.json"
  if [ ! -f "$npm_user_settings" ]; then
    fail "[check-pack-install] npm-managed install did not register a user-scope citizen at $npm_user_settings"
    return 1
  fi
  if ! python3 -c "
import json,sys
p=json.load(open('$npm_user_settings')).get('packages',[])
srcs=[(x if isinstance(x,str) else x.get('source')) for x in p]
sys.exit(0 if any(isinstance(s,str) and s.endswith('/node_modules/@junghanacs/entwurf') for s in srcs) else 1)
"; then
    fail "[check-pack-install] user-scope settings.json lacks the npm entwurf package in packages[]:"
    sed 's/^/    /' "$npm_user_settings" >&2
    return 1
  fi
  # Foreign cwd ($tmp — NOT the project, no project .pi): --entwurf-control must be
  # a KNOWN flag and the entwurf provider must load, sourced only from user scope.
  # Before the fix this printed "Unknown options: --entwurf-control".
  local foreign_out
  foreign_out=$(cd "$tmp" && HOME="$npmhome" XDG_DATA_HOME="$npmhome/.local/share" XDG_STATE_HOME="$npmhome/.local/state" XDG_CACHE_HOME="$npmhome/.cache" PI_CODING_AGENT_DIR="$npmhome/.pi/agent" "$pi_bin" --entwurf-control --list-models entwurf 2>&1) || {
    fail "[check-pack-install] foreign-cwd --entwurf-control smoke failed (user-scope citizen not loading?):"
    echo "$foreign_out" | tail -10 | sed 's/^/    /' >&2
    return 1
  }
  if grep -qi "Unknown option" <<<"$foreign_out" || ! grep -q "claude-opus-4-8" <<<"$foreign_out"; then
    fail "[check-pack-install] foreign-cwd --entwurf-control did not load the entwurf extension from user scope:"
    echo "$foreign_out" | tail -10 | sed 's/^/    /' >&2
    return 1
  fi
  echo "[check-pack-install] user-scope citizen regression pass (npm consumer: --entwurf-control loads from a foreign cwd)"

  # Installed meta-bridge ownership regression (0.12.5): package upgrades must not
  # bake versioned pnpm-store paths into Claude settings. MCP already uses the
  # stable `entwurf-bridge` bin; statusLine must now use `entwurf-statusline`, and
  # the plugin marketplace source must be the version-stable operator data dir
  # rather than <node_modules>/pi/meta-bridge/.assembled. Use a fake claude CLI so
  # this stays deterministic/offline while running the REAL installed
  # install-meta-bridge path and meta-bridge-state apply.
  local fake_claude_dir="$npm_tmp/fake-claude-bin" fake_claude_log="$npm_tmp/fake-claude.log"
  mkdir -p "$fake_claude_dir"
  cat > "$fake_claude_dir/claude" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_CLAUDE_LOG:?}"
case "$1${2:+ $2}" in
  "--version") echo "2.1.197 (Claude Code)" ;;
  "plugin validate") : ;;
  "plugin uninstall") : ;;
  "plugin marketplace") : ;;
  "plugin install") : ;;
  "plugin list") printf '%s\n' "entwurf-meta-receive@meta-bridge-local" "  Status: enabled" ;;
  "mcp remove") : ;;
  "mcp add") : ;;
  "mcp get") printf '%s\n' "Scope: User config" "Status: ✔ Connected" ;;
  *) : ;;
esac
exit 0
SH
  chmod +x "$fake_claude_dir/claude"
  local mb_home="$npm_tmp/meta-home" mb_cfg="$npm_tmp/meta-claude" mb_log
  mkdir -p "$mb_home" "$mb_cfg"
  mb_log=$(HOME="$mb_home" XDG_DATA_HOME="$mb_home/.local/share" XDG_STATE_HOME="$mb_home/.local/state" XDG_CACHE_HOME="$mb_home/.cache" CLAUDE_CONFIG_DIR="$mb_cfg" FAKE_CLAUDE_LOG="$fake_claude_log" PATH="$fake_claude_dir:$npmroot/node_modules/.bin:$PATH" "$npm_pkg/run.sh" install-meta-bridge 2>&1) || {
    fail "[check-pack-install] installed install-meta-bridge failed under fake claude:"
    echo "$mb_log" | tail -20 | sed 's/^/    /' >&2
    return 1
  }
  local stable_asm="$mb_home/.local/share/entwurf/meta-bridge/.assembled"
  local installed_hook="$stable_asm/entwurf-meta-receive/meta-bridge-hook.js"
  if [ ! -f "$installed_hook" ]; then
    fail "[check-pack-install] installed meta-bridge did not assemble the compiled hook JS into the stable operator data dir: $installed_hook"
    return 1
  fi
  if [ -f "$stable_asm/entwurf-meta-receive/meta-bridge-hook.ts" ]; then
    fail "[check-pack-install] installed meta-bridge shipped a raw .ts hook — installed packages must run compiled JS (strip-types is refused under node_modules)"
    return 1
  fi
  # The artifact existing is not enough (review BLOCKER 1): Claude runs the hooks.json
  # COMMAND, so assert the baked command actually targets the compiled .js with both
  # placeholders resolved. A bake that mis-targeted .ts (or left a placeholder) would
  # still pass the direct-JS smoke below, then fail live.
  local installed_hooks_json="$stable_asm/entwurf-meta-receive/hooks/hooks.json"
  if ! grep -q 'meta-bridge-hook\.js' "$installed_hooks_json"; then
    fail "[check-pack-install] installed hooks.json does not point at the compiled meta-bridge-hook.js: $installed_hooks_json"
    return 1
  fi
  if grep -qE 'meta-bridge-hook\.ts|__HOOK_ENTRY__|__NODE_BIN__' "$installed_hooks_json"; then
    fail "[check-pack-install] installed hooks.json references a raw .ts entry or an unbaked placeholder (__HOOK_ENTRY__/__NODE_BIN__): $installed_hooks_json"
    return 1
  fi
  if [ -e "$npm_pkg/pi/meta-bridge/.assembled/entwurf-meta-receive" ]; then
    fail "[check-pack-install] installed meta-bridge still assembled inside the versioned package store: $npm_pkg/pi/meta-bridge/.assembled"
    return 1
  fi
  # 0.12.5 strip-types-fence regression (GPT safety pin). The compiled hook must run
  # FROM UNDER node_modules with plain node — the exact fence that broke oracle's
  # 0.12.4 raw-.ts hook (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). L2 relocates
  # the runtime marketplace source to XDG, but this hardens the ARTIFACT itself so
  # it is safe even if a future cache/marketplace path lands under node_modules.
  local nm_probe="$npmroot/node_modules/@junghanacs/entwurf/pi/meta-bridge/.assembled-packprobe/entwurf-meta-receive"
  mkdir -p "$nm_probe/lib"
  cp "$installed_hook" "$nm_probe/meta-bridge-hook.js"
  cp "$stable_asm/entwurf-meta-receive/lib/meta-session.js" "$nm_probe/lib/meta-session.js"
  cp "$stable_asm/entwurf-meta-receive/lib/session-id.js" "$nm_probe/lib/session-id.js"
  cp "$stable_asm/entwurf-meta-receive/entwurf-capabilities.json" "$nm_probe/entwurf-capabilities.json"
  local probe_env='{"session_id":"pack-probe","transcript_path":"/tmp/x.jsonl","cwd":"/tmp","hook_event_name":"SessionStart","model":{"id":"probe"}}'
  local probe_out
  if probe_out="$(printf '%s' "$probe_env" | env PI_CODING_AGENT_DIR="$(mktemp -d)" CLAUDE_PLUGIN_ROOT="$nm_probe" node "$nm_probe/meta-bridge-hook.js" 2>&1)" && printf '%s' "$probe_out" | grep -q hookSpecificOutput; then
    : # compiled hook crosses the node_modules strip-types fence safely
  else
    fail "[check-pack-install] compiled hook failed to run under node_modules with plain node: $(printf '%s' "$probe_out" | tr '\n' ' ' | cut -c1-200)"
    rm -rf "$nm_probe"; return 1
  fi
  # FAIL-reproduction (review BLOCKER 2): a raw .ts at the SAME node_modules location
  # must be refused SPECIFICALLY by the strip-types fence — not by some unrelated
  # failure. A missing lib would also exit nonzero and hollow out the proof, so
  # capture stderr and require the exact ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.
  cp "$npm_pkg/pi-extensions/meta-bridge-hook.ts" "$nm_probe/meta-bridge-hook.ts"
  local ts_out ts_rc
  ts_out="$(printf '%s' "$probe_env" | env PI_CODING_AGENT_DIR="$(mktemp -d)" CLAUDE_PLUGIN_ROOT="$nm_probe" node "$nm_probe/meta-bridge-hook.ts" 2>&1)" && ts_rc=0 || ts_rc=$?
  if [ "${ts_rc:-0}" -eq 0 ]; then
    fail "[check-pack-install] raw .ts hook UNEXPECTEDLY ran under node_modules — strip-types fence moved; the compiled-hook rationale must be revisited"
    rm -rf "$nm_probe"; return 1
  fi
  if ! printf '%s' "$ts_out" | grep -q 'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING'; then
    fail "[check-pack-install] raw .ts hook failed under node_modules but NOT via the strip-types fence (expected ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING); got: $(printf '%s' "$ts_out" | tr '\n' ' ' | cut -c1-200) — the regression no longer proves the compiled-hook rationale"
    rm -rf "$nm_probe"; return 1
  fi
  rm -rf "$nm_probe"
  echo "[check-pack-install] installed hook is node_modules-safe compiled JS (hooks.json points at .js; runs under node_modules with plain node; raw .ts refused there by the strip-types fence)"
  python3 - "$mb_cfg/settings.json" "$mb_home/.claude.json" "$stable_asm" <<'PY'
import json, sys
settings = json.load(open(sys.argv[1]))
root = json.load(open(sys.argv[2]))
stable_asm = sys.argv[3]
market = settings.get("extraKnownMarketplaces", {}).get("meta-bridge-local", {})
assert market == {"source": {"source": "directory", "path": stable_asm}}, market
assert settings.get("statusLine") == {"type": "command", "command": "entwurf-statusline"}, settings.get("statusLine")
mcp = root.get("mcpServers", {}).get("entwurf-bridge", {})
assert mcp.get("command") == "entwurf-bridge" and mcp.get("args") == [], mcp
PY
  if ! grep -q "$stable_asm" "$fake_claude_log"; then
    fail "[check-pack-install] fake claude did not receive the stable marketplace path during install-meta-bridge"
    sed 's/^/    /' "$fake_claude_log" >&2 || true
    return 1
  fi
  echo "[check-pack-install] installed meta-bridge ownership pass (stable statusline bin + stable marketplace dir + stable MCP bin)"

  # 0.12.1 C — installed bridge BOOT regression. This is the test whose absence
  # let the 0.12.0 install bug ship: the README's bridge launcher was
  # `node --experimental-strip-types src/index.ts`, which Node REFUSES under
  # node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Every gate above
  # wired settings or probed shape but never BOOTED the bridge from its installed
  # node_modules home, so the dead-on-arrival MCP server passed publish. Here we
  # boot the installed start.sh and assert it answers MCP tools/list with the v2
  # surface. Two proofs in one: (1) the prepack dist JS boots under node_modules
  # with plain node — a strip-types fallback would crash with the exact error
  # above, so a parseable tools/list IS proof the dist path was taken; (2) the
  # boot is pi-free — the @earendil-works peer trio is optional and must NOT be
  # installed by the neutral npm path, so the eager closure stands up with pi absent.
  local installed_start="$npmroot/node_modules/.bin/entwurf-bridge"
  local installed_dist="$npm_pkg/mcp/entwurf-bridge/dist/mcp/entwurf-bridge/src/index.js"
  if [ ! -f "$installed_dist" ]; then
    fail "[check-pack-install] installed bridge missing prebuilt dist (prepack did not emit into the tarball?): $installed_dist"
    return 1
  fi
  if [ -d "$npmroot/node_modules/@earendil-works" ]; then
    fail "[check-pack-install] @earendil-works present in npm-managed node_modules — pi-free boot proof is void (neutral npm install should not install optional pi peers)"
    return 1
  fi
  local boot_out
  if ! boot_out=$(START_SH="$installed_start" node --input-type=module <<'JS'
import { spawn } from 'node:child_process';
const start = process.env.START_SH;
// Sanitize the child env so the pi-free proof cannot be masked by a leaked
// module-resolution path: if NODE_PATH (or a stray pi env) pointed at a tree
// holding @earendil-works, a statically pi-importing eager graph could resolve
// and boot anyway, turning this gate falsely green. Strip it so "boots with
// @earendil absent" stays an honest adversarial proof.
const env = { ...process.env };
delete env.NODE_PATH;
const child = spawn(start, { stdio: ['pipe', 'pipe', 'pipe'], env });
let stdout = '', stderr = '', done = false;
const timer = setTimeout(() => {
  child.kill('SIGKILL');
  console.error('installed bridge boot timeout');
  if (stderr.trim()) console.error(stderr.trim());
  process.exit(1);
}, 5000);
function finish(trimmed) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  let msg;
  try { msg = JSON.parse(trimmed); }
  catch { console.error('unparseable tools/list:', trimmed.slice(0, 300)); if (stderr.trim()) console.error(stderr.trim()); process.exit(1); }
  const names = (msg?.result?.tools ?? []).map((t) => t?.name).sort();
  for (const need of ['entwurf_v2', 'entwurf_peers', 'entwurf_self', 'entwurf_inbox_read', 'entwurf_register_native']) {
    if (!names.includes(need)) { console.error('missing MCP tool from installed boot:', need, '— got', names.join(',')); process.exit(1); }
  }
  console.log(names.join(','));
  child.kill('SIGTERM');
  process.exit(0);
}
child.stdout.on('data', (d) => { stdout += d.toString(); const t = stdout.trim(); if (t) finish(t); });
child.stderr.on('data', (d) => { stderr += d.toString(); });
child.on('error', (e) => { clearTimeout(timer); console.error('installed bridge spawn error:', String(e)); process.exit(1); });
child.on('close', () => { if (done) return; clearTimeout(timer); if (stderr.trim()) console.error(stderr.trim()); console.error('installed bridge closed with empty tools/list'); process.exit(1); });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
JS
  ); then
    fail "[check-pack-install] installed bridge boot FAILED — the npm-installed MCP server does not answer tools/list (the 0.12.0 strip-types-under-node_modules regression):"
    echo "$boot_out" | tail -15 | sed 's/^/    /' >&2
    return 1
  fi
  echo "[check-pack-install] installed bridge boot pass (dist boots under node_modules, pi-free: $boot_out)"

  # 0.12.7 — installed AGY IMPRINT regression. The npm bin resolves through a
  # node_modules symlink; raw scripts/agy-imprint.ts is therefore forbidden by
  # Node's strip-types fence. Execute the real installed bin with an isolated
  # agent dir and prove the neutral hook response + one record write. This is the
  # exact package bug that a dev-only hook smoke cannot see.
  local installed_agy_imprint="$npmroot/node_modules/.bin/entwurf-agy-imprint"
  local agy_imprint_agent="$npm_tmp/agy-imprint-agent" agy_imprint_out agy_record_count
  mkdir -p "$agy_imprint_agent"
  if ! agy_imprint_out=$(printf '%s\n' '{"conversationId":"pack-install-agy-conversation","workspacePaths":["/tmp/entwurf-pack-install"],"modelName":"probe-model"}' | HOME="$npmhome" XDG_DATA_HOME="$npmhome/.local/share" XDG_STATE_HOME="$npmhome/.local/state" XDG_CACHE_HOME="$npmhome/.cache" PI_CODING_AGENT_DIR="$agy_imprint_agent" "$installed_agy_imprint" 2>&1); then
    fail "[check-pack-install] installed entwurf-agy-imprint FAILED under node_modules (raw-.ts strip-types regression or emitted hook missing):"
    echo "$agy_imprint_out" | tail -15 | sed 's/^/    /' >&2
    return 1
  fi
  if [ "$agy_imprint_out" != '{"injectSteps":[]}' ]; then
    fail "[check-pack-install] installed entwurf-agy-imprint returned a non-neutral hook response: $agy_imprint_out"
    return 1
  fi
  agy_record_count=$(find "$agy_imprint_agent/meta-sessions" -maxdepth 1 -name '*.meta.json' -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$agy_record_count" != "1" ]; then
    fail "[check-pack-install] installed entwurf-agy-imprint did not write exactly one isolated meta-record (got $agy_record_count)"
    return 1
  fi
  echo "[check-pack-install] installed agy imprint pass (compiled JS runs under node_modules; neutral response + record write)"

  # 0.12.7 — installed OPERATOR COMMAND regression. `entwurf <cmd>` dispatches through
  # run.sh, whose REPO_DIR is under node_modules once installed, so a raw-.ts entrypoint
  # dies on the strip-types fence. These three are operator surfaces, not dev gates:
  # doctor-pi-provider is the pi-ownership verdict, new-session-id is the alias that mints
  # a garden citizen (docs/setup-clean-host.md tells operators to run the installed bin),
  # and meta-bridge-prune is the store maintenance verb. All three shipped DEAD through
  # 0.12.6 because the only installed smokes drove bins, never subcommands.
  #
  # Assert MEANING, not just the absence of the fence string: a command that regressed to
  # a stub or an empty exit would still "not crash". So: the id must be well-formed, the
  # doctor must reach its own verdict body, and prune must actually walk a 0-record store.
  local installed_entwurf="$npmroot/node_modules/.bin/entwurf"
  local op_agent="$npm_tmp/op-agent" op_out
  mkdir -p "$op_agent/meta-sessions"

  # Same sandbox root set on every operator-command drive: doctor-pi-provider READS install-state
  # below XDG_DATA_HOME, so an inherited real root would make this gate's verdict depend on the
  # operator's host instead of the sandbox (non-hermetic even when nothing is written).
  local op_xdg_data="$npmhome/.local/share" op_xdg_state="$npmhome/.local/state" op_xdg_cache="$npmhome/.cache"
  if ! op_out=$(HOME="$npmhome" XDG_DATA_HOME="$op_xdg_data" XDG_STATE_HOME="$op_xdg_state" XDG_CACHE_HOME="$op_xdg_cache" PI_CODING_AGENT_DIR="$op_agent" "$installed_entwurf" new-session-id 2>&1); then
    fail "[check-pack-install] installed 'entwurf new-session-id' FAILED under node_modules (strip-types fence or missing compiled twin):"
    echo "$op_out" | tail -8 | sed 's/^/    /' >&2
    return 1
  fi
  # Same shape as SESSION_ID_RE (the garden id SSOT): <denote-stamp>-<6 hex>. A stub or a
  # truncated id would still "not crash", so the gate reads the id, not just the exit code.
  if ! printf '%s' "$op_out" | grep -qE '^[0-9]{8}T[0-9]{6}-[0-9a-f]{6}$'; then
    fail "[check-pack-install] installed 'entwurf new-session-id' did not print a well-formed garden session id: $op_out"
    return 1
  fi

  if ! op_out=$(HOME="$npmhome" XDG_DATA_HOME="$op_xdg_data" XDG_STATE_HOME="$op_xdg_state" XDG_CACHE_HOME="$op_xdg_cache" PI_CODING_AGENT_DIR="$op_agent" "$installed_entwurf" doctor-pi-provider 2>&1); then
    # A doctor may exit non-zero on an unadopted host — that is a VERDICT, not a crash.
    # The fence, by contrast, kills it before any verdict body is printed.
    if printf '%s' "$op_out" | grep -q ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING; then
      fail "[check-pack-install] installed 'entwurf doctor-pi-provider' hit the node_modules strip-types fence:"
      echo "$op_out" | tail -8 | sed 's/^/    /' >&2
      return 1
    fi
  fi
  if ! printf '%s' "$op_out" | grep -q '\[pi-provider doctor\]' || ! printf '%s' "$op_out" | grep -q 'EFFECTIVE'; then
    fail "[check-pack-install] installed 'entwurf doctor-pi-provider' never reached its verdict body (no scopes/EFFECTIVE report):"
    echo "$op_out" | tail -8 | sed 's/^/    /' >&2
    return 1
  fi

  if ! op_out=$(HOME="$npmhome" XDG_DATA_HOME="$op_xdg_data" XDG_STATE_HOME="$op_xdg_state" XDG_CACHE_HOME="$op_xdg_cache" PI_CODING_AGENT_DIR="$op_agent" "$installed_entwurf" meta-bridge-prune "$op_agent/meta-sessions" 2>&1); then
    fail "[check-pack-install] installed 'entwurf meta-bridge-prune' FAILED on a 0-record store:"
    echo "$op_out" | tail -8 | sed 's/^/    /' >&2
    return 1
  fi
  if ! printf '%s' "$op_out" | grep -q 'prune candidates' || ! printf '%s' "$op_out" | grep -q "store: $op_agent/meta-sessions"; then
    fail "[check-pack-install] installed 'entwurf meta-bridge-prune' did not scan the store it was given:"
    echo "$op_out" | tail -8 | sed 's/^/    /' >&2
    return 1
  fi
  echo "[check-pack-install] installed operator commands pass (new-session-id id-shaped, doctor-pi-provider reaches its verdict, meta-bridge-prune walks a 0-record store)"

  # A dev-only gate has NO compiled twin by design. Under an installed package run_ts must
  # REFUSE it with a legible message — never fall back to raw .ts (that just re-raises the
  # fence error) and never exit 0 (a silent no-op would let CI "pass" a gate it never ran).
  local devgate_out devgate_rc=0
  devgate_out=$(HOME="$npmhome" XDG_DATA_HOME="$op_xdg_data" XDG_STATE_HOME="$op_xdg_state" XDG_CACHE_HOME="$op_xdg_cache" PI_CODING_AGENT_DIR="$op_agent" "$installed_entwurf" check-meta-session 2>&1) || devgate_rc=$?
  if [ "$devgate_rc" -eq 0 ]; then
    fail "[check-pack-install] a dev-only gate (check-meta-session) exited 0 from an installed package — it cannot have run; run_ts must refuse it"
    return 1
  fi
  if printf '%s' "$devgate_out" | grep -q ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING; then
    fail "[check-pack-install] a dev-only gate leaked the raw strip-types fence error instead of run_ts's refusal:"
    echo "$devgate_out" | tail -6 | sed 's/^/    /' >&2
    return 1
  fi
  if ! printf '%s' "$devgate_out" | grep -q 'dev-clone-only surface'; then
    fail "[check-pack-install] a dev-only gate under an installed package did not produce run_ts's refusal message:"
    echo "$devgate_out" | tail -6 | sed 's/^/    /' >&2
    return 1
  fi
  echo "[check-pack-install] dev-only gate refusal pass (installed package refuses check-* legibly, no raw-.ts fallback, no silent exit 0)"

  # 0.12.4 — installed STORE-DOCTOR regression. meta-bridge-doctor.sh's full store
  # scan runs the prebuilt dist JS when it lives under node_modules (strip-types
  # refuses the .ts there — the same class as the bridge boot above). Before the dist
  # split the doctor ran the raw .ts and reported a FALSE "corrupt records" FAIL on
  # EVERY installed host. Prove the shipped dist JS scans a fixture store with PLAIN
  # node (a strip-types fallback would crash with the exact
  # ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) AND that its rewritten import of the
  # emitted meta-session.js resolves — a real record exercises parseMetaIdentity.
  local installed_store_doctor="$npm_pkg/mcp/entwurf-bridge/dist/scripts/meta-bridge-store-doctor.js"
  if [ ! -f "$installed_store_doctor" ]; then
    fail "[check-pack-install] installed store-doctor missing prebuilt dist (prepack did not emit it into the tarball?): $installed_store_doctor"
    return 1
  fi
  local sd_fixture="$npm_tmp/store-fixture"
  mkdir -p "$sd_fixture"
  # One valid v2 record: filename == "${gardenId}.meta.json" (no drift), unique
  # nativeSessionId (no dupe). gardenId must match YYYYMMDDTHHMMSS-[0-9a-f]{6}.
  printf '%s\n' '{"schemaVersion":2,"gardenId":"20990101T000000-abcdef","backend":"claude-code","nativeSessionId":"native-store-doctor-fixture","cwd":"/tmp/entwurf-fixture","model":null,"transcriptPath":null,"parentGardenId":null,"isEntwurf":false,"createdAt":"2099-01-01T00:00:00.000Z","recordUpdatedAt":"2099-01-01T00:00:00.000Z"}' \
    > "$sd_fixture/20990101T000000-abcdef.meta.json"
  local sd_out
  if ! sd_out=$(node "$installed_store_doctor" "$sd_fixture" 2>&1); then
    fail "[check-pack-install] installed store-doctor FAILED to scan under node_modules (strip-types-under-node_modules regression, or the emitted meta-session import broke):"
    echo "$sd_out" | tail -15 | sed 's/^/    /' >&2
    return 1
  fi
  if ! grep -q "1 record(s) scanned" <<<"$sd_out"; then
    fail "[check-pack-install] installed store-doctor scanned but did not report the fixture record (parseMetaIdentity path not exercised?): $sd_out"
    return 1
  fi
  echo "[check-pack-install] installed store-doctor scan pass (dist JS scans under node_modules with plain node: $sd_out)"

  # 0.12.4 — installed DOCTOR DISPATCH lock. The artifact above proves the store-scan
  # target runs under node_modules; this proves the doctor SCRIPT actually routes to
  # it (store scan → dist JS) and defers the strip-types-only source-shape gate
  # (v2-surface) when installed, instead of running raw .ts and false-failing.
  local installed_doctor="$npm_pkg/scripts/meta-bridge-doctor.sh"
  if ! grep -q 'dist/scripts/meta-bridge-store-doctor.js' "$installed_doctor"; then
    fail "[check-pack-install] installed doctor does not dispatch the store scan to the dist JS under node_modules: $installed_doctor"
    return 1
  fi
  if ! grep -q 'shipped surface source present' "$installed_doctor"; then
    fail "[check-pack-install] installed doctor does not defer the v2-surface source-shape gate on installed hosts: $installed_doctor"
    return 1
  fi
  echo "[check-pack-install] installed doctor dispatch lock pass (store-scan → dist JS, v2-surface deferred)"

  ok "[check-pack-install] publish install smoke pass"
  return 0
}

check_pack_install() {
  # SELF-FENCE wrapper (rule 11). Keep this OUTSIDE the implementation so every exit path —
  # including an early failure before the implementation's cleanup trap is installed — returns
  # through the comparison. The DATA tree is byte-fenced. STATE cannot be byte-fenced because a
  # live native session may append legitimate lines concurrently, so fence the gate's unique fake
  # conversation marker instead; any increase proves that agy-imprint escaped its sandbox.
  trap - RETURN
  local real_data_root="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf"
  local real_imprint_log="${XDG_STATE_HOME:-$HOME/.local/state}/entwurf/agy-imprint.log"
  local data_before data_after fake_before fake_after rc=0
  data_before="$( (find "$real_data_root" -type f -print0 2>/dev/null | sort -z | xargs -0r sha256sum) 2>/dev/null || true)"
  fake_before="$(grep -Fc 'conversationId=pack-install-agy-conversation' "$real_imprint_log" 2>/dev/null || true)"

  _check_pack_install_impl "$@" || rc=$?
  # _check_pack_install_impl installs a RETURN cleanup trap after allocating its temp roots.
  # It has fired now; clear it before this wrapper returns so it cannot leak into its caller.
  trap - RETURN

  data_after="$( (find "$real_data_root" -type f -print0 2>/dev/null | sort -z | xargs -0r sha256sum) 2>/dev/null || true)"
  fake_after="$(grep -Fc 'conversationId=pack-install-agy-conversation' "$real_imprint_log" 2>/dev/null || true)"
  if [ "$data_before" != "$data_after" ]; then
    fail "[check-pack-install] SELF-FENCE: this gate changed the operator's REAL install-state tree ($real_data_root) — a sandbox drive is leaking through an inherited XDG root:"
    diff <(printf '%s\n' "$data_before") <(printf '%s\n' "$data_after") | sed 's/^/    /' >&2 || true
    rc=1
  fi
  if [ "$fake_before" != "$fake_after" ]; then
    fail "[check-pack-install] SELF-FENCE: this gate appended its fake agy birth marker to the operator's REAL state log ($real_imprint_log): before=$fake_before after=$fake_after"
    rc=1
  fi
  if [ "$rc" -eq 0 ]; then
    echo "[check-pack-install] self-fence pass (real DATA tree byte-identical; fake STATE marker count unchanged)"
  fi
  return "$rc"
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
  const expected = ['entwurf_peers', 'entwurf_self', 'entwurf_inbox_read', 'entwurf_register_native', 'entwurf_v2'];
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
  echo "[setup] scope:   entwurf v2 package + detected native-harness bridges + pi adapter"
  echo "[setup] verification: v2 install smoke (entwurf-bridge; LIVE substrate = release-gate)"

  (cd "$REPO_DIR" && pnpm install --frozen-lockfile)
  sync_auth
  install_local_package "$project_dir"

  # Single confident install command (GLG 2026-06-23): setup ALSO wires the
  # native-harness meta-bridge, so a relocate/clone needs ONE command — not the
  # install + install-meta-bridge two-pronged split that froze the Claude
  # statusLine on the old path (the 2026-06-23 relocation gap). Detection-gated:
  # a pi-only host with no native harness skips it cleanly (§10 "있으면 설정,
  # 없으면 담아준다"); meta-bridge-install.sh is itself idempotent.
  if command -v claude >/dev/null 2>&1; then
    section "meta-bridge install (native harness detected: Claude Code)"
    (cd "$REPO_DIR" && bash scripts/meta-bridge-install.sh)
  else
    echo "[setup] no native harness (claude) on PATH — skipping meta-bridge wiring (pi-only host)"
  fi

  # Expose entwurf's STABLE bins on PATH for this DEV checkout (막힘 ②) BEFORE wiring agy: the
  # agy mcp_config, settings.statusLine, and hooks.json record the bare names `entwurf-bridge` /
  # `entwurf-agy-statusline` / `entwurf-agy-imprint`, so they must resolve for the agy doctors
  # to pass. NON-FATAL — a foreign bin already on PATH is left as-is.
  expose_dev_bin

  # Fold agy (Antigravity) MCP bridge wiring into setup (막힘 ①, GLG 2026-07-04: install
  # ownership moves to entwurf). Same detection-gated, idempotent, NON-FATAL posture as the
  # meta-bridge block above — agy is an OPTIONAL harness, so a refused/corrupt agy config warns
  # but never bricks a pi/Claude setup. The hard gate stays doctor-agy-bridge.
  wire_agy_bridge

  # Fold agy statusLine wiring into setup (#46 Task 1: own the ambient status area so it shows
  # driver + garden id, the claude meta-bridge symmetry). Same detection-gated NON-FATAL posture
  # — an explicit install-agy-statusline is fail-loud, but the setup wrapper WARNs + continues.
  wire_agy_statusline

  # Fold agy PreInvocation birth imprint wiring into setup (#46 close criterion: manual register 0).
  # The hook runs the thin `entwurf-agy-imprint` bin and returns {"injectSteps":[]} so agy's loop
  # survives while the meta-record is created/attached by conversationId.
  wire_agy_hooks

  # Deterministic preflight lives in `pnpm check`; live substrate acceptance lives
  # in `LIVE=1 ./run.sh release-gate <scratch>`. Setup is the install path, so it
  # verifies the installed MCP bridge boundary only and does NOT run the legacy
  # ACP/v1 session-messaging/sentinel gates.
  section "v2 install smoke: entwurf-bridge (direct MCP protocol)"
  validate_entwurf_bridge

  echo ""
  echo "DONE: entwurf setup (pi adapter + detected native bridges + v2 install smoke) green."
  if command -v claude >/dev/null 2>&1; then
    echo "Verify Claude wiring with: ./run.sh doctor-meta-bridge"
  fi
  if command -v agy >/dev/null 2>&1; then
    echo "Verify agy wiring with:    ./run.sh doctor-agy-bridge"
    echo "                           ./run.sh doctor-agy-statusline"
    echo "                           ./run.sh doctor-agy-hooks"
  fi
  echo "Run 'LIVE=1 ./run.sh release-gate <scratch>' for live substrate acceptance."
}

# wire_agy_bridge — detection-gated, NON-FATAL agy (Antigravity) MCP bridge wiring, folded into
# setup so a relocate/clone needs ONE idempotent command (막힘 ①). Mirrors the meta-bridge
# block: agy on PATH → idempotent install-agy-bridge; no agy → honest skip, NO state ("있으면
# 설정, 없으면 담아준다"). NON-FATAL by contract: agy is an OPTIONAL harness, so a refused/corrupt
# agy config must NOT brick a pi/Claude setup — the hard gate is doctor-agy-bridge (issue #45:
# the '?' surfaces in doctor, not by killing setup). WARNs are reason-specific so a transitional
# symlink (someone else's SSOT) and a corrupt config (invalid JSON) are never conflated.
wire_agy_bridge() {
  # Detection = the agy binary on PATH. AGY_BIN pins the target (default `agy`) so the
  # hermetic smoke can point at a fake agy or a definitely-absent path without depending on
  # whatever agy the CI/dev host happens to have — production leaves it unset (= `command -v
  # agy`, no regression). Same override spirit as agy-bridge.sh's AGY_MCP_CONFIG/AGY_BRIDGE_COMMAND.
  if ! command -v "${AGY_BIN:-agy}" >/dev/null 2>&1; then
    echo "[setup] no agy on PATH — skipping agy bridge wiring (no state; pi/Claude-only host)"
    return 0
  fi
  section "agy bridge install (native harness detected: Antigravity)"
  local out rc
  set +e
  out="$(bash "$REPO_DIR/scripts/agy-bridge.sh" install 2>&1)"
  rc=$?
  set -e
  printf '%s\n' "$out"
  if [ "$rc" -eq 0 ]; then
    echo "[setup] agy bridge wired (idempotent). Verify with: ./run.sh doctor-agy-bridge"
    return 0
  fi
  # NON-FATAL: keep setup alive, surface the reason honestly (never a silent pass).
  # ORDER MATTERS: the permission failures carry the same words as the mcp_config ones ("refused
  # (symlink)", "invalid JSON") and MUST be matched first — otherwise a settings.json problem gets
  # reported as an mcp_config problem and sends the operator to repair the wrong file.
  case "$out" in
    *"permission refused (symlink)"*|*"permission invalid JSON"*|*"permission could not be granted"*)
      # The MCP server IS registered — only the allow rule failed. agy defaults every mcp action to
      # Ask, so the bridge works but stops for a y/n on EVERY entwurf_v2 call. Half-wired, and said
      # so: the explicit installer fails loud on this; setup only degrades it, never hides it.
      echo "[setup] WARN: agy settings.json could not take our permission rule — bridge REGISTERED but NOT GRANTED." >&2
      echo "[setup]       agy will prompt on every entwurf_v2 call until 'mcp(entwurf-bridge/entwurf_v2)'" >&2
      echo "[setup]       is in its permissions.allow (see the line above for why). setup continues." >&2
      ;;
    *"refused (symlink)"*)
      echo "[setup] WARN: agy mcp_config is a symlink — someone else's SSOT (transitional)." >&2
      echo "[setup]       Bridge NOT wired; expected until install ownership moves to entwurf." >&2
      echo "[setup]       Re-run setup once the symlink is dropped. setup continues." >&2
      ;;
    *"invalid JSON"*)
      echo "[setup] WARN: your agy mcp_config is CORRUPT (invalid JSON) — bridge NOT wired." >&2
      echo "[setup]       doctor-agy-bridge will KEEP FAILING until you repair that file." >&2
      echo "[setup]       (Not a silent skip — fix the config, then re-run setup.) setup continues." >&2
      ;;
    *)
      echo "[setup] WARN: agy bridge install did not complete (rc=$rc; see the line above)." >&2
      echo "[setup]       Bridge NOT wired; verify with ./run.sh doctor-agy-bridge. setup continues." >&2
      ;;
  esac
  return 0
}

# wire_agy_statusline — detection-gated, NON-FATAL agy statusLine wiring, folded into setup (#46
# Task 1). Mirrors wire_agy_bridge: agy on PATH → idempotent install-agy-statusline; no agy →
# honest skip, NO state. NON-FATAL by contract (agy is OPTIONAL — a refused/corrupt settings must
# not brick a pi/Claude setup); the hard gate is doctor-agy-statusline. The renderer is the
# stable bin entwurf-agy-statusline, exposed by expose_dev_bin above.
wire_agy_statusline() {
  if ! command -v "${AGY_BIN:-agy}" >/dev/null 2>&1; then
    echo "[setup] no agy on PATH — skipping agy statusLine wiring (no state; pi/Claude-only host)"
    return 0
  fi
  section "agy statusLine install (native harness detected: Antigravity)"
  local out rc
  set +e
  out="$(bash "$REPO_DIR/scripts/agy-statusline-bridge.sh" install 2>&1)"
  rc=$?
  set -e
  printf '%s\n' "$out"
  if [ "$rc" -eq 0 ]; then
    echo "[setup] agy statusLine wired (idempotent). Verify with: ./run.sh doctor-agy-statusline"
    return 0
  fi
  case "$out" in
    *"refused (symlink)"*)
      echo "[setup] WARN: agy settings.json is a symlink — someone else's SSOT (transitional)." >&2
      echo "[setup]       statusLine NOT wired; expected until install ownership moves to entwurf." >&2
      echo "[setup]       Re-run setup once the symlink is dropped. setup continues." >&2
      ;;
    *"invalid JSON"*)
      echo "[setup] WARN: your agy settings.json is CORRUPT (invalid JSON) — statusLine NOT wired." >&2
      echo "[setup]       doctor-agy-statusline will KEEP FAILING until you repair that file." >&2
      echo "[setup]       (Not a silent skip — fix the config, then re-run setup.) setup continues." >&2
      ;;
    *)
      echo "[setup] WARN: agy statusLine install did not complete (rc=$rc; see the line above)." >&2
      echo "[setup]       statusLine NOT wired; verify with ./run.sh doctor-agy-statusline. setup continues." >&2
      ;;
  esac
  return 0
}

# wire_agy_hooks — detection-gated, NON-FATAL agy PreInvocation imprint wiring. Same setup posture
# as the MCP/statusLine adapters, but this one is the birth writer that turns statusLine '?' into a
# garden id after the first invocation.
wire_agy_hooks() {
  if ! command -v "${AGY_BIN:-agy}" >/dev/null 2>&1; then
    echo "[setup] no agy on PATH — skipping agy hooks wiring (no state; pi/Claude-only host)"
    return 0
  fi
  section "agy hooks install (native harness detected: Antigravity)"
  local out rc
  set +e
  out="$(bash "$REPO_DIR/scripts/agy-hooks-bridge.sh" install 2>&1)"
  rc=$?
  set -e
  printf '%s\n' "$out"
  if [ "$rc" -eq 0 ]; then
    echo "[setup] agy hooks wired (idempotent). Verify with: ./run.sh doctor-agy-hooks"
    return 0
  fi
  case "$out" in
    *"refused (symlink)"*)
      echo "[setup] WARN: agy hooks.json is a symlink — someone else's SSOT (transitional)." >&2
      echo "[setup]       birth imprint NOT wired; re-run setup once the symlink is dropped. setup continues." >&2
      ;;
    *"invalid JSON"*)
      echo "[setup] WARN: your agy hooks.json is CORRUPT (invalid JSON) — birth imprint NOT wired." >&2
      echo "[setup]       doctor-agy-hooks will KEEP FAILING until you repair that file. setup continues." >&2
      ;;
    *)
      echo "[setup] WARN: agy hooks install did not complete (rc=$rc; see the line above)." >&2
      echo "[setup]       Birth imprint NOT wired; verify with ./run.sh doctor-agy-hooks. setup continues." >&2
      ;;
  esac
  return 0
}

# expose_dev_bin — make the `entwurf-bridge` STABLE bin resolve for a DEV checkout (막힘 ②).
# setup IS the dev install command (consumers get the bin from npm bin-linking), so setup owns a
# managed ~/.local/bin/entwurf-bridge symlink into this checkout via scripts/dev-bin.sh, recorded
# for an honest inverse (remove-dev-bin). NON-FATAL like wire_agy_bridge: a foreign bin already on
# PATH (a real npm install) is REFUSED not clobbered, and a BIN_DIR off PATH only WARNs — neither
# bricks setup. The hard gate stays doctor-agy-bridge (a missing/dangling bin FAILs there).
expose_dev_bin() {
  section "dev bin: expose entwurf-bridge on PATH (dev checkout)"
  local rc
  set +e
  bash "$REPO_DIR/scripts/dev-bin.sh" expose
  rc=$?
  set -e
  [ "$rc" -eq 0 ] && return 0
  if [ "$rc" -eq 3 ]; then
    echo "[setup] WARN: entwurf-bridge is already on PATH as someone else's bin (not ours) — left as-is." >&2
    echo "[setup]       If that is a stale/foreign bin, remove it and re-run setup. setup continues." >&2
  else
    echo "[setup] WARN: dev bin exposure did not complete (rc=$rc; see above). setup continues." >&2
  fi
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
#     (smoke-session-id-name on a pi-native target via ENTWURF_LIVE_TARGET,
#     and smoke-resident-garden-guard).
#   - ACP plugin acceptance floor (S0~S2g): the 11 ACP LIVE smokes
#     (socket-citizen/raw-turn/overlay/provider/session-reuse/carrier-augment/
#     memory-containment/rgg + S2g mcp/skill config passthrough + S2g axis-3 bundled-mcp resident/RPC)
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
  # loudly in the summary with its artifact path, never buried; (2) a Bash-bypass
  # of the entwurf surface stays a hard FAIL *inside* this lane — a bypass is
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
  check-bridge)
    check_bridge
    ;;
  check-model-lock)
    check_model_lock
    ;;
  check-shell-quote)
    check_shell_quote
    ;;
  check-install-surface)
    # 0.12.7 — structural half of the node_modules strip-types fence: run_ts is the only
    # crossing, every operator subcommand has a compiled twin, bin wrappers branch, dev
    # gates stay out of the tarball, and offline smokes never touch the real $HOME.
    # check-pack-install owns the dynamic half (it drives the installed commands).
    run_ts scripts/check-install-surface.ts
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
  check-entwurf-v2-native-push)
    check_entwurf_v2_native_push
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
  check-entwurf-bridge-pi-free)
    check_entwurf_bridge_pi_free
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
  check-native-push-adapter)
    check_native_push_adapter
    ;;
  check-native-push-register)
    check_native_push_register
    ;;
  check-agy-sender-identity)
    check_agy_sender_identity
    ;;
  new-session-id)
    # Garden launcher helper: print one fresh garden sessionId (SSOT:
    # generateSessionId). Used by the operator alias to make every
    # --entwurf-control session a garden citizen. Stdout = the id only.
    run_ts scripts/new-session-id.ts
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
  smoke-meta-keyset-guard)
    # 0.10.0 meta-bridge regression gate: the PREVENTIVE keyset guard
    # (check-keyset-overlap) + managed-keys SSOT. Synthetic fragments prove a
    # disjoint consumer passes and exact/array/parent-child collisions fail loud.
    # Offline/hermetic (deps: bash+python3).
    (cd "$REPO_DIR" && bash scripts/smoke-meta-keyset-guard.sh)
    ;;
  check-meta-manifest-schema)
    # 0.12.2 meta-bridge: deterministic, CLI-version-INDEPENDENT guard. `claude plugin
    # validate` is a CLOSED schema whose allowed keyset differs by version, so a
    # decorative key (0.12.1's root `description`) passed on the dev box but broke
    # install on the floor Claude. This pins the committed manifests to the minimal
    # validated keyset and asserts desired_mcp()'s installed-vs-clone dual-mode.
    # Offline/hermetic (deps: python3).
    (cd "$REPO_DIR" && python3 scripts/check-meta-manifest-schema.py)
    ;;
  smoke-meta-install-state)
    # 1.0.0 meta-bridge Phase 2 regression gate: state file captures pre-install
    # values, install/uninstall touches only the managed keyset, uninstall refuses
    # to guess without state, and the doctor store scan fails on corrupt/
    # duplicate/drift records. Offline + deterministic (deps bash+node+python3).
    (cd "$REPO_DIR" && bash scripts/smoke-meta-install-state.sh)
    ;;
  smoke-agy-install-state)
    # 봉인 8 regression gate for the agy MCP install adapter: install→doctor→uninstall in an
    # ISOLATED HOME+XDG with a fake stable bin + fake pgrep/ss — adopt (preserve unrelated) +
    # state, doctor static-clean/live-SKIP (+live-PASS with a fake agy), honest-inverse
    # uninstall, symlink refuse, dangling FAIL, create-new inverse, and ⓪ checkout impurity 0.
    # Offline + deterministic (deps: bash+python3).
    (cd "$REPO_DIR" && bash scripts/smoke-agy-install-state.sh)
    ;;
  smoke-agy-statusline-state)
    # #46 Task 1 regression gate for the agy statusLine install adapter: install→doctor→uninstall
    # in an ISOLATED HOME+XDG with a fake stable bin (entwurf-agy-statusline) + fake pgrep —
    # own the statusLine subtree WHOLE (preserve unrelated keys) + state (stable command, prior
    # subtree as preimage), doctor static-clean/live-SKIP (+live-consistent with a fake agy) /
    # drift-FAIL / dangling-command-FAIL / not-ours note, honest-inverse uninstall, symlink +
    # dangling-symlink refuse, create-new inverse, the NON-FATAL wire wrapper, and checkout
    # impurity 0. Offline + deterministic (deps: bash+python3).
    (cd "$REPO_DIR" && bash scripts/smoke-agy-statusline-state.sh)
    ;;
  smoke-agy-hooks-state)
    # #46 birth imprint regression gate: hooks.json named hook ownership + direct
    # PreInvocation stdin → upsertMetaSession antigravity record, isolated HOME/XDG/PI agent.
    (cd "$REPO_DIR" && bash scripts/smoke-agy-hooks-state.sh)
    ;;
  smoke-pi-provider-state)
    # #46 Task 2 regression gate for the pi provider install adapter: register-pi-provider.py
    # (ownership-classified install/remove, user+project scopes) + read-only doctor-pi-provider.ts
    # (effective shadow view). ISOLATED HOME+XDG + fake stable bin — user ownership matrix
    # (absent/managed-legacy/managed-current/user-override), state honest-inverse (legacy NOT
    # restored), sibling + legacy prune, project no-state strip, doctor effective/drift/dangling/
    # malformed/project-stale/'?', symlink refuse, and checkout impurity 0. Offline (bash+python3+node).
    (cd "$REPO_DIR" && bash scripts/smoke-pi-provider-state.sh)
    ;;
  smoke-agy-native-push-live)
    # 봉인 8 LIVE acceptance gate for the native-push (agy) delivery rail. Drives the REAL
    # antigravity adapter + register core + runEntwurfV2 (production deps) against a live agy
    # conversation (AGY_CONVERSATION_ID): probe route, register create/attach idempotency,
    # fire→native-push delivered, owned-outcome reject, bogus-conv probe-indeterminate reject.
    # Meta-store is isolated to a temp dir (only the agy round-trip is real); honest SKIP when
    # LIVE!=1. doctor-static preflight FAILs before the agy bridge is wired (③).
    run_ts scripts/smoke-agy-native-push-live.ts
    ;;
  smoke-user-scope-citizen)
    # 0.12.6 install-boundary gate: register-pi-package.py is the shared
    # packages[] SSOT for project/user install and remove; user scope makes
    # --entwurf-control load from any cwd. Idempotent, preserves unrelated
    # packages/keys, normalizes stale entries, remove is symmetric, and corrupt
    # settings fail loud. The tripwire the 2026-07-03 `pi install` removal lacked.
    (cd "$REPO_DIR" && bash scripts/smoke-user-scope-citizen.sh)
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
    # receive plugin. Assembles a self-contained, node-path-baked copy under the
    # XDG data dir ($XDG_DATA_HOME/entwurf/meta-bridge/.assembled — dev clone and
    # installed package alike, never the checkout) and runs marketplace add +
    # install --scope user, so every native Claude Code session auto-loads it.
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
  install-agy-bridge)
    # 봉인 7: the agy (Antigravity) MCP install ADAPTER (SEPARATE from the Claude
    # marketplace install — only runner/reporting is shared). Registers ONE entwurf-bridge
    # server entry in the agy mcp_config: adopt a regular file / create a new one / REFUSE a
    # symlink (someone else's SSOT). Records an install-state under $XDG_DATA_HOME/entwurf/
    # agy-bridge/ for an honest inverse. The command written is a STABLE bin (entwurf-bridge),
    # never a repo/git-hash path (the oracle dangling lesson).
    (cd "$REPO_DIR" && bash scripts/agy-bridge.sh install "$@")
    ;;
  uninstall-agy-bridge)
    # 봉인 7: honest inverse of install-agy-bridge from the install-state (restore the
    # captured preimage / remove our key; remove the file if we created it empty). Refuses if
    # the managed config became a symlink since install; no state → nothing to undo.
    (cd "$REPO_DIR" && bash scripts/agy-bridge.sh uninstall "$@")
    ;;
  doctor-agy-bridge)
    # 봉인 7: 2-tier fail-loud doctor. STATIC proves both candidate configs (global
    # ~/.gemini/config/mcp_config.json — the file live agy actually reads — + legacy
    # ~/.gemini/antigravity-cli which install now cleans) resolve, parse, and carry a
    # RESOLVABLE command (a dangling command FAILS). LIVE proves runtime-effectiveness only
    # when an agy process exists; with no agy it is an honest SKIP (never a PASS in disguise).
    (cd "$REPO_DIR" && bash scripts/agy-bridge.sh doctor "$@")
    ;;
  wire-agy-bridge)
    # 막힘 ①: the detection-gated, NON-FATAL setup wrapper around install-agy-bridge (agy on
    # PATH → idempotent install; no agy → honest skip, no state). HIDDEN/internal — setup calls
    # this; it is exposed as a subcommand only so smoke-agy-install-state can drive it
    # deterministically. The hard gate stays doctor-agy-bridge (issue #45: the '?' is a doctor
    # signal, not a setup-killer).
    wire_agy_bridge
    ;;
  install-agy-statusline)
    # #46 Task 1: own the WHOLE statusLine subtree of agy settings.json → the stable-bin renderer
    # entwurf-agy-statusline (driver + garden id), the claude meta-bridge statusLine symmetry.
    # Adopt a regular file / create / REFUSE a symlink. install-state under $XDG_DATA_HOME/
    # entwurf/agy-statusline/ for an honest inverse. The command is a BARE stable bin — dev AND
    # installed (the checkout path lives only in the dev-bin symlink state, never in settings).
    (cd "$REPO_DIR" && bash scripts/agy-statusline-bridge.sh install "$@")
    ;;
  uninstall-agy-statusline)
    # #46 Task 1: honest inverse of install-agy-statusline — restore the captured statusLine
    # subtree preimage (remove the key if absent, else set it back; remove the file if we created
    # it empty). Refuses if settings.json became a symlink since install; no state → nothing.
    (cd "$REPO_DIR" && bash scripts/agy-statusline-bridge.sh uninstall "$@")
    ;;
  doctor-agy-statusline)
    # #46 Task 1: fail-loud doctor. STATIC proves the SINGLE settings root agy reads statusLine
    # from (~/.gemini/antigravity-cli/settings.json — Task-1 capture, not the 2-candidate mcp
    # root) parses and carries OUR RESOLVABLE command (dangling FAILs, state drift FAILs). LIVE
    # proves runtime-effectiveness only with an agy process; else an honest SKIP.
    (cd "$REPO_DIR" && bash scripts/agy-statusline-bridge.sh doctor "$@")
    ;;
  install-agy-hooks)
    # #46 birth writer: install the Antigravity PreInvocation named hook that runs
    # entwurf-agy-imprint and returns {"injectSteps":[]}.
    (cd "$REPO_DIR" && bash scripts/agy-hooks-bridge.sh install "$@")
    ;;
  uninstall-agy-hooks)
    # Honest inverse of install-agy-hooks: restore/remove only our named hook.
    (cd "$REPO_DIR" && bash scripts/agy-hooks-bridge.sh uninstall "$@")
    ;;
  doctor-agy-hooks)
    # Fail-loud doctor for agy hooks.json imprint wiring.
    (cd "$REPO_DIR" && bash scripts/agy-hooks-bridge.sh doctor "$@")
    ;;
  doctor-pi-provider)
    # #46 Task 2: read-only fail-loud doctor for the pi provider ownership (entwurfProvider.
    # mcpServers.entwurf-bridge). Uses config.ts readProviderSettingsFile SSOT for the EFFECTIVE
    # (project-shadows-user) command — never a re-implemented merge. Reports user/project/effective,
    # gates on stable-bin resolvability, and distinguishes state-owned drift (FAIL) from an
    # unowned user override (honest note). No agy/pi process needed — pure settings inspection.
    run_ts scripts/doctor-pi-provider.ts "$@"
    ;;
  wire-agy-statusline)
    # #46 Task 1: the detection-gated, NON-FATAL setup wrapper around install-agy-statusline.
    # HIDDEN/internal — setup calls this; exposed so smoke-agy-statusline-state can drive it
    # deterministically. The hard gate stays doctor-agy-statusline.
    wire_agy_statusline
    ;;
  wire-agy-hooks)
    # #46 birth writer setup wrapper around install-agy-hooks.
    wire_agy_hooks
    ;;
  expose-dev-bin)
    # 막힘 ②: expose the entwurf-bridge STABLE bin on PATH for a DEV checkout (a managed symlink
    # into this checkout, recorded for an honest inverse). HIDDEN/internal — setup calls the
    # NON-FATAL expose_dev_bin wrapper; exposed here so smoke-agy-install-state can drive the
    # foreign-refuse WARN path. The exposure logic lives in scripts/dev-bin.sh.
    expose_dev_bin
    ;;
  remove-dev-bin)
    # 막힘 ②: honest inverse of expose-dev-bin — remove ONLY our managed link + state (REFUSE if
    # it became foreign). The raw script (no wrapper) so an operator sees a loud failure.
    (cd "$REPO_DIR" && bash scripts/dev-bin.sh remove "$@")
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
    run_ts scripts/meta-bridge-prune.ts "$@"
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
  check-install-preflight)
    check_install_preflight
    ;;
  check-pi-import-surface)
    check_pi_import_surface
    ;;
  check-env-namespace)
    check_env_namespace
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
  remove-user-scope)
    remove_user_scope_citizen
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
