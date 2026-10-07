# Durable native support — direction and boundary

## Decision and working surface

Support `pi-durable` as a separate native-harness contact, not an enhancement to ordinary Pi. There is no upstream PR or upstream acceptance dependency. **Released 0.31.0** retains Pi1.0.2/source `cd32f7725fdbddbaecdff5b1e68491563394e0ca`. **#130 /0.32.0 targets Pi1.0.4 and simpler installation**: the supply contract (P1) and the explicit native-module contract (P2) below are both implemented on the #130 branch; review, qualification, vendor LIVE and release floors are pending, and the package stays 0.31.0 until a separately authorized release prepare.

Development takes place **on a branch in this repository checkout**. No worktrees or tmp development clones. Isolated test fixtures and preserved receipts are evidence, not another implementation authority. `AGENTS.md` owns the working rules. On the #130 branch the current handoff is `NEXT--feat_130-install-surface.md`; `NEXT.md` takes over the release state and next move when the branch lands (main's `NEXT.md` still describes #130 as discussion and is not this branch's compass). #129 closed at reviewed main `535c2e1` after first native admission; #130 owns runtime-supply, later Pi versions, ACP and UI follow-ups.

Expired per-leaf grants and handoffs are not current instructions. They do not prohibit ordinary source edits or builds, or impose a whole-team shutdown/zero-downtime migration as a commit condition. Commits and releases still require the existing verification and authorization boundaries. Push and npm publication require GLG's separate explicit request.

## Ownership

- Native durable owns runtime, TUI, controllers, models/auth, queues, storage, transcript, prompt, recovery and internal task/subagent relationships.
- Entwurf owns citizen attachment, garden addressing, rail/liveness facts and delivery receipts. One operator-visible host is one citizen; internal conversations/subagents/codemode do not mint additional records.
- The maintained contact is a pinned upstream overlay plus a narrow bootstrap/adapter. Do not copy the registry/controller assembly into another harness.
- Coordination is a sibling's temporary role, not a higher citizen class or supervisory permission. Do not add queues, automatic retry/restart, backlog managers, credential proxies or recovery apparatus.
- A branch checkpoint commit is not harness admission or release acceptance. Preserve existing focused, package, qualification, frozen FULL, native/LIVE and exact-SHA release requirements; do not invent new proof machinery around the contact.

## Contact and installation

The source adapter defines six tools: `entwurf_self`, `entwurf_peers`, `entwurf_v2`, `entwurf_inbox_read`, `entwurf_callback` and `entwurf_fresh_call`. It exposes no native resume verb. Callable schema and actual tool registration, not this prose, establish support.

The upstream overlay installs extensions before native recovery, provides the required sender-readiness boundary, and exposes root-directed input through the native submission API. Root admission must not change the operator's selected conversation and must propagate native refusal. Runtime internals remain native-owned.

The receive contact is announce-only self-fetch: a fresh mailbox signal submits an untrusted notice to the native root, then the model calls unsafe `entwurf_inbox_read`. The native runtime owns the queue and turn boundary. This is not direct body injection or a new Entwurf queue.

Installation has two independent subjects:

1. **Entwurf package:** the existing npm/source installation surface, compiled adapter, setup and package-consumer checks. The canonical bootstrap/overlay live under `pi/pi-durable/`; a checkout compatibility wrapper is not a second installation API.
2. **Native app/TUI and SDK set:** upstream does not publish the experimental app (installing or upgrading the ordinary Pi CLI does not supply it; `pi-durable` on npm is the library). Since #130 the Entwurf package itself carries the pinned app as a carrier (`pi/pi-durable/carrier/`) and declares the 1.0.4 SDK set as exact production dependencies; Entwurf verifies both where it is installed and never downloads, repairs or supplies credentials. The released 0.31.0 source-runtime route (an operator checkout at a fixed XDG location) is retired, with no fallback.

[README](../README.md), [setup](setup-clean-host.md#2b-optional-native-durable-pi-durable) and the release notes must describe that distinction and agree with the accepted installation evidence before shipment.

## 0.32 supply and explicit native-module contract (#130)

Supply (P1) and the explicit module ingress (P2) are implemented on the branch, pending review/qualification/release floors:

- **One installation unit, Pi1.0.4:** supply the omitted upstream durable app/TUI alongside one declared, coherent published SDK version set. The operator does not clone, patch, compile or copy provider model data. Reuse native app/TUI files; native harness semantics stay upstream-owned.
- **Maintainer supply:** pinned upstream commit/tag, declared contact overlay, deterministic emit/import relocation, MIT license, manifest and rebuild equality. A narrow installed-dist resolver connects the omitted app to published libraries. This does not endorse a new harness, sidecar, bundler or updater.
- **Installed verifier:** physical member and member-of-member resolution from the carrier's location must match the declared library set. `npm ls`'s logical tree and directory placement alone are not proof; same-version sharing need not refuse. Carrier drift and incoherent edges refuse by name, with an installation hint. The actual PATH Pi host-version check is separate from this native set check.
- **Measured design input, not1.0.4 acceptance:** intentionally mismatched native1.0.2/host1.0.4 project-local fixtures retained host Pi value/TUI identity. Full exact dependencies still let a unique-name library hoist to a shared root and bind wrong-version libraries. Entwurf-only and isolated npm-global fixtures were coherent. Neither observation certifies an emitted1.0.4 carrier, every package manager, or native admission. Source receipts are recorded in the #130 thread and branch handoff.
- **Explicit native module (P2):** `entwurf pi-durable … --native-module <absolute file>` names ONE operator module, for a new or a `--continue`d session. It is an ordinary ES module: its own top-level evaluation (top-level await included) is its initialization, and it completes before the TUI or the runtime is imported — the 1.0.4 runtime creates its provider runtime before it installs any extension (`carrier/runtime.js:140-146`), so environment preparation cannot ride an extension object. Its default export is a native durable `Extension`, installed after the contact, by reference. The ingress checks only a default object with a name, no extension name the app installs itself (`entwurf`, `coding-tools`, `pi-prompt`, `subagent` — a same-name install replaces), and no contact tool name; every other field is the native registry's. The identity carriers (`PI_SESSION_ID`, `PI_CODING_AGENT_DIR`, `HOME`, every `ENTWURF_*`) and the process directory are compared across initialization and a change is refused by name; the caller's directory is fixed before the module runs and handed to the app. The module is trusted operator code: these are mistake guards, not a sandbox, and nothing is rolled back. No directory scan, setting, environment variable, persistent profile, automatic retrieval, classic `ExtensionAPI` shim or plugin manager names a module, and `entwurf_fresh_call`'s inputs are unchanged — a fresh sibling gets no module.
- **Mock proof in this release:** the synthetic fixtures `test/fixtures/pi-durable-native-module/` (node:* only; never shipped). The beside lane drives the packaged `main` for order, refusals, the identity and directory guards, the extension order and the bridge spawn *spec*; `check-pi-durable-send`'s `native-module` cell runs the whole `main` on the real carrier with scripted S plus native H — initialization before the first SDK resolution, the module's tool, the native `bash` child seeing the module's value, and the contact answering beside it; `check-pack-install` loads it from an installed package. No real dotenv, secret values, operator settings or credential access.
- **Known host warning (accepted for 0.32):** ordinary Pi warns that host-provided extension packages belong in `peerDependencies`. The exact SDK set is a production dependency on purpose — those installed copies serve the separate native process — and Pi's check reads the manifest's `dependencies`, not module identity. This states a known manifest constraint; it does not certify that every path is harmless. An actual observed problem goes upstream with its evidence.
- **Downstream after release:** agent-config creates and owns the real durable-specific env-loader using the released ingress. Do not put its dotenv policy in Entwurf or modify agent-config in this implementation lane. Existing search/knowledge capability already rides skills/CLI; no andenken port is needed. Native ACP/provider-switch work is deferred.
- **Acceptance:** source-invisible installed runtime/TUI load, affected contact gates and native/LIVE admission on the chosen1.0.4 installation surface remain separate proofs. Existing qualification, frozen FULL and release floors are unchanged.

## Evidence boundaries

Historical source/lab receipts are preserved, not execution dependencies. Accepted initial identity, scripted send success/invalid/reject/R1 and idle receive cells exercised **scripted S + actual native H**, not vendor V or blanket crash/queue certification. Current acceptance must be tied to the actual candidate and the owning verification contracts, not old manifests or a retired coordinator's environment.

- Library reopen/requestId/inbox evidence does not prove end-to-end sender exactly-once or this adapter's complete recovery behavior.
- An interrupted unsafe tool may have partially run. Do not blindly replay it; admission is not completion.
- `readMetaInbox` archives the message and updates mailbox read state before returning. Those side effects do not prove the native tool-result commit; the intervening crash window is not generally certified.
- Startup notices concern fresh `.msg` files, not a promise to drain/replay delivered backlog. Idle receive evidence is not busy/nonroot/backlog/receive-crash acceptance.
- A loopback model driver can exercise native GenerationTask/ToolTask/schema behavior, but cannot replace approved vendor LIVE. Footer/model labels and null record model fields are not billing or actual-model proof.
- Older reader observations certify only the measured subject/time. In particular, an inaccessible proc-root file or a past container snapshot is not proof that an ancestor RW mount is absent or that future readers are supported.

The existing admission path remains identity → native visible identity → send/receive → visible fresh/callback → installed/package and native caller/target/cross-harness LIVE. Apply its declared clauses and matrices; no partial-support state or reduced release floor.

## Read next

- `NEXT--feat_130-install-surface.md` — the #130 branch's current handoff; `NEXT.md` resumes that role at landing. (The handoff "retired at main landing" was #129's branch, not #130's.)
- `AGENTS.md`, `VERIFY.md`, `DELIVERY.md`, `docs/adding-a-harness.md`, `docs/mux-launch-rail.md` and `.claude/skills/entwurf-release/SKILL.md` — owning contracts.
- #129 — closed implementation/first-admission record; #130 — runtime-supply, subsequent Pi version, ACP-Claude and UI decisions.

The prior narrative and temporary grant references are preserved only in ignored `.agent-reports/original-closure-20261006/`. They are not a second working surface or authority.
