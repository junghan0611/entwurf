# Durable native support — direction and boundary

## Decision and working surface

Support `pi-durable` as a separate native-harness contact, not an enhancement to ordinary Pi. There is no upstream PR or upstream acceptance dependency. The target is **0.31.0**, retaining Pi1.0.2/source `cd32f7725fdbddbaecdff5b1e68491563394e0ca`; later Pi version acceptance belongs to #130.

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
2. **Native runtime:** the optional experimental app is source-only upstream; installing/upgrading the ordinary Pi CLI does not supply it. The durable library is separately npm-consumable. The operator supplies the pinned source runtime and overlay at the existing fixed XDG runtime location; Entwurf detects and verifies it, never downloads/repairs a runtime or supplies credentials.

[README](../README.md), [setup](setup-clean-host.md#2b-optional-native-durable-pi-durable) and the release notes must describe that distinction and agree with the accepted installation evidence before shipment.

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
