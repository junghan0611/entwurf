# Durable native support — direction and boundary

## Decision and working surface

Support `pi-durable` as a separate native-harness contact, not an enhancement to ordinary Pi. There is no upstream PR or upstream acceptance dependency. **Released 0.31.0** retains Pi1.0.2/source `cd32f7725fdbddbaecdff5b1e68491563394e0ca`. **#130 /0.32.0 targets Pi1.0.4 and simpler installation**: the supply contract below is implemented on the #130 branch (P1; review, qualification and release floors pending), and the explicit native-module contract (P2) is approved direction, not yet implemented.

Development takes place **on a branch in this repository checkout**. No worktrees or tmp development clones. Isolated test fixtures and preserved receipts are evidence, not another implementation authority. `AGENTS.md` owns the working rules; `NEXT.md` owns the current release state and next move. #129 closed at reviewed main `535c2e1` after first native admission; #130 owns runtime-supply, later Pi versions, ACP and UI follow-ups.

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

Supply (P1) implemented on the branch, pending review/qualification/release floors; explicit modules (P2) pending:

- **One installation unit, Pi1.0.4:** supply the omitted upstream durable app/TUI alongside one declared, coherent published SDK version set. The operator does not clone, patch, compile or copy provider model data. Reuse native app/TUI files; native harness semantics stay upstream-owned.
- **Maintainer supply:** pinned upstream commit/tag, declared contact overlay, deterministic emit/import relocation, MIT license, manifest and rebuild equality. A narrow installed-dist resolver connects the omitted app to published libraries. This does not endorse a new harness, sidecar, bundler or updater.
- **Installed verifier:** physical member and member-of-member resolution from the carrier's location must match the declared library set. `npm ls`'s logical tree and directory placement alone are not proof; same-version sharing need not refuse. Carrier drift and incoherent edges refuse by name, with an installation hint. The actual PATH Pi host-version check is separate from this native set check.
- **Measured design input, not1.0.4 acceptance:** intentionally mismatched native1.0.2/host1.0.4 project-local fixtures retained host Pi value/TUI identity. Full exact dependencies still let a unique-name library hoist to a shared root and bind wrong-version libraries. Entwurf-only and isolated npm-global fixtures were coherent. Neither observation certifies an emitted1.0.4 carrier, every package manager, or native admission. Source receipts are recorded in the #130 thread and branch handoff.
- **Explicit native modules:** the bootstrap admits only operator-named modules, with a small startup/native-extension boundary. No directory scan, ambient discovery, automatic retrieval, classic `ExtensionAPI` shim or plugin manager. Determine initialization order against1.0.4 before freezing the ingress format: environment preparation must precede runtime/provider creation; native registry installation is a different phase.
- **Mock proof in this release:** a completely synthetic external module, fake HOME/cwd/env, observed initialization order, native registration/contact coexistence, child-process inheritance and named refusal for invalid modules. No real dotenv, secret values, operator settings or credential access. The mock is a development fixture, not an automatically installed personal extension.
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

- `NEXT.md` — current release state and next move; the implementation branch handoff was retired at main landing.
- `AGENTS.md`, `VERIFY.md`, `DELIVERY.md`, `docs/adding-a-harness.md`, `docs/mux-launch-rail.md` and `.claude/skills/entwurf-release/SKILL.md` — owning contracts.
- #129 — closed implementation/first-admission record; #130 — runtime-supply, subsequent Pi version, ACP-Claude and UI decisions.

The prior narrative and temporary grant references are preserved only in ignored `.agent-reports/original-closure-20261006/`. They are not a second working surface or authority.
