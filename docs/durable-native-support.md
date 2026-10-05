# Durable native support — direction and restart handoff

## Decision

GLG's 2026-10-05 direction: support durable as a separate native-harness contact, as with OMP. **No upstream PR or upstream acceptance dependency.** First land the operator on global Pi 1.0.2 and restart the relevant sessions; then open a fresh branch with a fresh implementation Opus and advisory Fable. The existing research Opus supplies evidence, not implementation continuity; the dismissed worktree Opus stays dismissed.

GLG subsequently reported coordinator resume and requested a fresh implementation Opus and advisory Fable on a branch, targeting **0.31.0**. Branch: `feat/durable-native-support`; its `NEXT--feat_durable-native-support.md` owns the lane.

GLG's subsequent execution grant (2026-10-05): defer #114 to ROADMAP, close it as not planned while preserving its branch/code/receipts, and proceed with #129 implementation. Model turns needed for verification are permitted. The first routed checkpoint is bounded L-identity with private development provisioning and focused proofs; later native-model/receive/admission work is checkpoint-routed.

The initial direction did not grant commit/push or release authority. A subsequent 2026-10-05 request authorizes a local checkpoint commit before further work, not push, admission or release. The existing commit verification boundary still applies; credentials, unrelated sessions and issue limits remain unchanged.

## Current checkpoint — 2026-10-05

L-identity a2, native scripted send success/invalid/reject/R1 unsafe recovery and the first idle receive cell are accepted in the development lane (**S + H, V0**). Receive evidence is one actual root doorbell admission, native inbox-read and archive/read-receipt correlation, not busy/nonroot/backlog/crash or exactly-once certification.

The 22-path candidate has now been applied to `feat/durable-native-support` at base `011f705`; the rebuilt 77-file bridge tree matches private closure `36d4d20c`. The same coordinator garden/native session resumed visibly, and an existing Pi↔Claude challenge/reply plus Fable readiness closed the generation-transition checkpoint. Saved focused floor: 25 steps green; coordinator independently checked source bytes, registry, full dist/backup trees, identity scalars and current ownership. This is **not native durable admission**. That integration performed no stage/commit/push. The subsequent documentation checkpoint includes direction and handoff only; product changes remain uncommitted and push remains unapproved.

Current evidence: `~/tmp/entwurf-pi102-durable/new-lane/{opus-l-receive-first-cell-checkpoint,feature-integration-static-checkpoint,coordinator-feature-integration-static-accepted}.md` and their immutable receipts. The branch NEXT names the current documentation checkpoint and the bounded L-visible driver amendment. Candidate-only identity projection has pure/stub composition evidence, not actual TUI rendering. Earlier starting-point paragraphs below describe the initial contact, not the current proof frontier.

Admission parity still reports `Unaccounted: pi-durable`. Visible persistent identity, step 9 fresh, clause 7/cross-harness LIVE, installed/package and exact release gates remain open. The installed Claude hook and other potentially stale store readers must be addressed before an operator-store durable birth. OpenClaw's periodic container was named a nonparticipant **for the transition window** by GLG, as reported by Opus. The earlier “no feature mount” premise is retired: independent kernel mountinfo shows the ancestor repos/gh RW-mounted at both container paths, plus agent-store and Claude RW mounts. Direct proc-root file/inode inspection was permission-denied, not proof of absence. Past argv/child/fd/marker snapshots are not timeless isolation; container hook/MCP reader coverage remains unknown. See `new-lane/openclaw-mount-erratum.md`53b3ccd4; original incorrect receipts are preserved.

## Ownership

**Treat `pi-durable` as a separate native harness, not an enhancement to ordinary Pi.** Its shared upstream source does not merge their runtime, storage, authentication or admission contracts.

### Keep the contact smaller than the harness

- Use the same finite admission path as another native harness: identity, native visible identity, send/receive and visible fresh launch. Apply the existing admission contract; do not invent a new framework around it.
- Keep native runtime, controllers, model selection, permissions, storage and recovery native-owned. A missing public seam permits only a narrow pinned contact, not reconstruction of those systems.
- Do not turn unmeasured busy/crash/backlog cases into a new queue, recovery manager or supervisor. Preserve the boundary and measure the next required user action.
- Private test drivers are disposable evidence scaffolding, not another product or installation surface. Reuse existing proof capabilities before adding machinery; if verification grows beyond the contact, stop and narrow it.
- A checkpoint commit records a branch state. It does not admit a partial harness, authorize operator-store birth or lower fresh/package/LIVE release gates.

- Native durable continues to own runtime, TUI, models/auth, storage, transcript, prompt and recovery.
- Entwurf owns citizen attachment, garden addressing, rail/liveness facts and delivery receipts.
- Our maintained contact is a pinned upstream source overlay plus a thin native bootstrap/adapter. Do not copy the native registry/controller assembly into a second harness.
- Experimental runtime provisioning and Entwurf adapter provisioning are distinct. Entwurf does not become a harness installer.
- One operator-visible host is the citizen. Internal conversations, subagents and codemode do not automatically mint records.

## Source-grounded starting point

Source revision: `cd32f7725fdbddbaecdff5b1e68491563394e0ca`, preserved at `~/tmp/entwurf-pi102-durable/pi-src/`.

- `packages/coding-agent/src/experimental/durable/runtime.ts:177` exposes the selected session's `{id,directory,cwd}`. This is a native join-key candidate; reopen stability and admission scope still require their own proof.
- `runtime.ts:133-134` holds the installed registry inside `openDurable`. Tool-extension injection is the first missing contact in this API.
- `runtime.ts:229-252` converts queued controller errors to UI notices and submits to the currently viewed conversation. It is not an honest root-admission receipt.

Minimal overlay proposal: an additive extension-install option and a root-directed input capability. Root input must not change the operator's selected conversation, must propagate failure, and should preserve the native submission/requestId semantics and native ID type. Harness internals need not be exposed wholesale.

Ordering matters: `runtime.ts:332` calls `harness.resume()` before returning the app. Extensions must be installed before recovery, but this alone does not prove sender readiness: bootstrap birth/marker setup after return may race recovered tools. A sender-ready gate or a pre-resume contact is a design/proof question, not an established third patch or a reason to copy the harness.

Packaging is still a separate problem: the experimental app is source-only, not supplied by the ordinary published Pi CLI. Upgrading global Pi does **not** install or certify durable support.

## Evidence and open boundaries

Existing B-M1 library receipts demonstrate same-conversation requestId dedup after reopen, survival of already-admitted inbox input, and no automatic replay of an interrupted unsafe tool. They do not demonstrate vendor-model behavior, sender exactly-once or this native adapter.

The implemented receive contact selects announce-only self-fetch: a fresh mailbox signal admits an untrusted notice to the native root, then the model calls unsafe `entwurf_inbox_read`. Direct body admission is deferred, not another current rail. Startup re-announces only fresh `.msg` files, not delivered backlog; the first idle success does not close the pre-admission or pre-result-commit crash gaps.

`readMetaInbox` in `pi-extensions/lib/meta-session.ts:2616-2664` reads the body, archives `.read`, stamps **mailbox state.json**, then returns. It does not mutate the identity record or prove durable tool-result commit. Crash survival between archive and durable commit is unmeasured. Inbox read is a mutation, not a replay-safe read-only tool. Do not infer end-to-end durable survival from archive dedup alone.

The supported private `models.json` openai-completions loopback has now exercised the actual native app/GenerationTask/ToolTask path. This is scripted S plus native H, never actual vendor V. Earlier library/faux receipts remain library evidence; no vendor turn may be substituted silently.

## Active implementation lane

The ordinary Pi upgrade/isolated startup, GLG-reported coordinator resume, fresh Opus/Fable formation and source-only rev2/independent advice are complete. #114's deferred direction is preserved in ROADMAP and its old branch; #129 now occupies that implementation slot. No native durable execution is inferred from these earlier receipts.

Initial leaf (now completed): backend `pi-durable`, one extension-injection overlay, thin bootstrap and tools-only self/peers adapter with unsafe replay. Provision a private development fixture pinned to cd32f77, leaving the research source read-only. Build the branch bridge in private output, not the shared operator runtime. Verify record/native-session/marker binding, independent direct-child PPID, actual registered-tool execute and same-directory reopen. Direct evidence is **adapter-direct, harness-bypassed**, not native ToolTask/schema/model/recovery proof.

The first input0 cell is not a blanket model-turn prohibition. Supported-config loopback actual-app evidence and named vendor LIVE remain distinct; no silent substitution, credential mediation, OpenRouter test spending or extra runtime patch for faux injection. All checkpoints route through the coordinator for bounded independent review.

The completion ladder remains L-identity → L-send → L-receive → L-admission → 0.31.0. Partial source support is a branch state, never shipment: persistent native-owned identity, step9 fresh, clause7/cross-harness two-way LIVE and fresh parity must close without a third admission state or reduced gate.

Private HOME/XDG/agent/meta-store/socket roots only; never mint an unsupported backend into the operator store. Runtime supply remains operator-owned and separate from Entwurf adapter supply. `NEXT--feat_durable-native-support.md` names the current move; first-execution scope is in `~/tmp/entwurf-pi102-durable/new-lane/implementation-grant.md`.

Read issue #129's live thread and `~/tmp/entwurf-pi102-durable/opus-report.md` for inherited research. Older codemode P1/P2 product proposals are withdrawn, not future implementation promises.
