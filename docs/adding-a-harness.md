# Adding a harness to the garden

The order a new harness is actually walked in, and what each step owes before the next
one may start. This is the **first entry point** for "we want harness X in the garden";
every other document here owns one slice of it and is linked from the step that needs it.

This is a route, not a promise. Every step below was walked for at least one shipped
backend, and the steps a given backend has NOT walked are named as such — an unwalked
step is a boundary, never a gap to paper over. Nothing here grants a capability: the
gates and doctors named in each step are the truth, and prose that disagrees with them
is the thing to repair.

**Vocabulary.** *Harness* = the vendor product (Claude Code, Antigravity, Copilot CLI,
Codex, pi). *Backend* = the identifier that harness carries inside entwurf. *Citizen* =
a session of that harness that owns a V3 meta-record and therefore a garden id. *Managed*
describes entwurf ownership of a concrete invocation/install/config surface; it is not an
admission grade. *Supported* means the end-to-end native-harness contract in this document has
been accepted.

---

## 0. Which lane — onboarding is two different jobs

Before anything else, decide which of the two you are doing. They share almost nothing.

|  | **Native citizen onboarding** | **ACP backend adapter** |
|---|---|---|
| The session | already running, opened by the operator | a child entwurf's pi adapter launches |
| Owns its auth/transcript | yes — entwurf never touches them | yes — inside an isolated overlay |
| What entwurf adds | a meta-record, a garden id, and whatever rails the vendor actually supports | a provider/model route and a turn loop |
| Where the contract lives | **this document**, steps 1–9 | [`acp-backend-rail.md`](./acp-backend-rail.md) |

- (a) Source: native lane → `pi-extensions/lib/meta-session.ts` + a per-backend hook unit
  under `pi/`. ACP lane → `pi-extensions/lib/acp/` and `pi-extensions/acp-provider.ts`.
- (b) Acceptance: the two lanes have separate gates and neither substitutes for the other.
- (c) Skip this choice and you build an ACP adapter for a harness the operator already has
  open (duplicating a session it owns), or a citizen lane for a process nobody launched.

**Opening a NEW sibling or reopening a dormant one is neither implementation lane.** That is
lifecycle and it has its own contract in [`mux-launch-rail.md`](./mux-launch-rail.md); do not put
tmux placement or launch code inside a birth/receive adapter. But separation is not deferral:
a native harness is not DONE until step 9 proves the required visible lifecycle parity. If the
vendor cannot support the required top-level birth, identity, receive and visible-fresh contract
without invented authority, do not admit it and leave a permanently partial harness behind.
Same-id resume remains capability-specific because it requires record-authoritative transcript
reopening; visible fresh is the required common creation surface.

---

## 1. Measure the vendor

Everything downstream is a bet on what the vendor actually does. Take these five
measurements first, from the vendor's own artifacts and processes.

1. **Hook vocabulary and firing time.** Which events exist, and *when* they fire.
2. **Launch form and envelope.** How a hook command is declared, and what arrives on stdin.
3. **Config writer.** Which file the vendor's own CLI writes, and in what shape.
4. **Statusline / receive surfaces.** What the vendor offers for display and for waking,
   including bundled SDKs, extension APIs, and the feature gates that make them load.
5. **Parent process topology.** Whether the hook process and the MCP child share one
   ancestor — the join key step 6 depends on.

- (a) Source: the vendor's shipped bundle, its `--help`, its own CLI writer, and a live
  process tree. Not our assembler, and not a schema file that turns out to describe a
  different layer.
- (b) Acceptance: each measurement is written down with the artifact path or the receipt it
  came from, so a later reader can reopen it instead of re-deriving it.
- (c) Skip it and you encode a guess. Two shapes account for most of them:
  - **A vendor ships several layers that describe the same thing differently** — the file its
    own CLI writes, the wire schema its API validates, the types its SDK exports. They
    disagree on key names and required fields. Follow the layer you are actually writing to;
    the other two produce a config the vendor silently ignores.
  - **A lifecycle event's NAME does not tell you when it fires.** Measure the firing, not the
    documentation, or a design assuming birth-at-open renders a citizen that does not exist.
  - **One familiar doorbell's absence does not prove the harness cannot wake.** Search the
    vendor's bundled SDK, extension bootstrap, and examples before declaring D4 impossible.
    `[측정]` Copilot CLI 1.0.80 has none of Claude's `FileChanged` / `asyncRewake` /
    `watchPaths`, yet its bundled first-party extension SDK documents `fs.watch` followed by
    `session.send()`. With `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS`, that route woke an
    idle native session and returned an exact marker on 2026-08-23. The decisive receipt and
    reproduction live in `scripts/raw-async-delivery/README.md`.

**The oracle is the vendor artifact or the vendor process — never our own assembler.**
A gate that drives our installer proves our installer; only the vendor proves the vendor.

---

## 2. Register the backend

The backend id must exist before any record carrying it can be written or read.

- (a) Source, all in one change:
  - `META_BACKENDS` (`pi-extensions/lib/meta-session.ts:84`) — backends that mint records
    through a native bridge.
  - `META_CITIZEN_BACKENDS` (`pi-extensions/lib/meta-session.ts:237`) — every backend a
    record may name, `pi` included.
  - `META_BACKEND_DESCRIPTORS` (`pi-extensions/lib/meta-session.ts:113`).
  - the capability registry `pi/entwurf-capabilities.json`, whose keys must be exactly
    `META_CITIZEN_BACKENDS`.
- (b) Gates: `check-meta-session`, `check-entwurf-capabilities`. The capability gate derives
  its drift scope from the constant, not from a literal list — a hand-typed scope is how a
  new backend's descriptor once shipped without ever being compared.
- (c) **Skip the deployment half and you stop a sibling rail from writing.** A new backend id
  changes what every *deployed* reader must accept, and identity writers certify the **whole
  active store** before writing — so a sibling still carrying the old list cannot authenticate
  the new backend's records, and therefore refuses to write **its own**. The order is not
  optional:

  > source + gates → build → **redeploy every shared-reader sibling, then run its doctor** →
  > only then let the new backend mint its first record.

  **An unknown-backend refusal is a stale deployed reader — redeploy it.** It is *not* a
  rotten generation, and the fresh-cut verb is the wrong tool there: it would archive healthy
  records. Only a genuinely unreadable generation goes to
  [`fresh-cut-policy.md`](./fresh-cut-policy.md). `doctor-meta-bridge` names the difference;
  run it after any `META_BACKENDS` change.

---

## 3. Birth

A trusted lifecycle event of the harness turns a session into a record.

- (a) Source: a per-backend hook unit under `pi/` (manifest + launcher) plus its payload
  under `pi-extensions/`. The payload's whole job is `upsertMetaSession` — idempotent, so
  whichever wired event fires first mints and the rest attach. The launcher `exec`s the
  payload, so the payload keeps the launcher's pid and its parent is the harness itself.
  Reference pair: `pi/meta-bridge-copilot/entwurf-meta-receive-copilot/` +
  `pi-extensions/meta-bridge-hook-copilot.ts`.
- (b) Two acceptances that must stay separate:
  - **mechanism** — a hermetic gate fires the shipped launcher with a synthetic envelope and
    asserts a record (`check-copilot-birth-hook`; no vendor binary, no model turn);
  - **real native admission** — an actual session of the harness mints a record. Only the
    second proves the vendor fires our unit at all.
- (c) Skip the split and a green gate reads as a live harness. Two things belong in the
  payload, not in prose:
  - **Refuse a degraded envelope; never guess a field.** A record minted from a guessed id
    is a citizen no live session can be joined back to.
  - **Say when birth happens.** `[측정]` A Copilot citizen is born when it is first spoken
    to, not when its window opens.

---

## 3.5 Citizen scope — one visible host, not every session it creates

A harness process may create several internal sessions or agents. That does not make each one a
garden citizen. Before writing the birth hook, identify a **vendor-authoritative top-level
predicate** and allowlist only the operator-visible host. Every other mode must refuse and log;
absence or ambiguity is an admission blocker, not a reason to infer from cwd, process age, or the
latest session id.

- (a) Source: the vendor's actual lifecycle context plus its parent/internal-agent creation path.
  Read both. An event named `session_start` proves nothing about scope.
- (b) Acceptance: a real top-level session births exactly one record while one real internal agent
  births no record, sender marker, or receiver marker. Internal agents may borrow the host's tools
  and act under the host garden id; they must never acquire a second garden address.
- (c) Worked warning: OMP v18.0.0 creates subagents in-process, but each subagent rebinds inherited
  extension paths to its own session API and emits its own `session_start`. “Same OS pid” therefore
  does **not** prevent record minting. Its measured candidate discriminator is extension
  `mode === "tui"` for the visible host versus default `"print"` + `hasUI:false` for task agents;
  that runtime distinction still needs a LIVE receipt and must be remeasured at vendor upgrades.
  If it flips, stop and reassess rather than growing a pile of heuristic predicates.

---

## 4. Statusline / visible identity

For native-harness support declarations made under this contract, a dedicated statusline adapter
is optional; **visible identity is not**. If the harness has a status/footer surface, the citizen
shows its own garden id there. If it does not, prove an equivalent persistent operator-visible
identity surface owned by that runtime. If neither exists, do not declare that harness supported —
an address visible only by scraping records is not lifecycle parity. Historical/probe registry rows
that predate this rule are preserved evidence coordinates, not proof that those backends already
satisfy this support contract.

- (a) Source: a renderer plus a config writer that owns exactly its own keys. Reference:
  `scripts/copilot-statusline.sh`, `scripts/copilot-statusline-config.py`,
  `scripts/copilot-statusline-bridge.sh`.
- (b) Acceptance: install / uninstall / doctor and a state smoke
  (`smoke-copilot-statusline-state`). Four properties carry it — the id renders, a
  **preimage** of the pre-install value is captured once, uninstall is an honest **inverse**,
  and a **symlinked config is refused** rather than written through.
- (c) Two rules the inverse depends on:
  - **A status contract is usually tiny and unforgiving**, and a renderer that exits nonzero
    can blank the slot with no error anywhere. Make the renderer fail quiet, and never let
    the doctor claim a render receipt it cannot actually see.
  - **The preimage is the current value on disk**, even when that value is byte-identical to
    what we would write. Every rail does it this way; inventing a "there was nothing here
    before" case for one backend is the special-casing this document exists to prevent.

---

## 5. The MCP hand — the citizen can call out

Registration puts `entwurf_*` in the harness's hands. That is *all* it does.

- (a) Source: a config writer for the vendor's own MCP file, following the **file writer**
  layer measured in step 1. Reference: `scripts/copilot-mcp-config.py` +
  `scripts/copilot-mcp-bridge.sh`; the precedent it was ported from is
  `scripts/agy-bridge-config.py` + `scripts/agy-bridge.sh`.
- (b) Acceptance: `install|uninstall|doctor-copilot-mcp` plus `smoke-copilot-mcp-state`, and
  a real chain — the bridge command answers (`run.sh probe-bridge-command entwurf-bridge`),
  the vendor's own `mcp get` reports the server enabled, and the harness log shows the
  client initialize.
- (c) **Read [`external-mcp-host.md`](./external-mcp-host.md) before designing this step.**
  It owns the distinction this step is constantly mistaken for:

  > a *plain external MCP host* has no meta-record and no sender marker. It can call the
  > read surfaces (`entwurf_peers`, `entwurf_inbox_read`), but `entwurf_v2` **sends are
  > refused by default**. A *garden-native native session* is one whose trusted lifecycle
  > hook minted a garden id **and a sender marker**.

  A newly-registered harness lands in the first row even when step 3 already gave it a
  record: **registration is tools, not identity.** Sending is step 6. `[측정]` A Copilot
  session with the hand installed called `entwurf_peers` and read the roster, while
  `entwurf_v2` refused — designed behavior, not a defect.
  - **Imported config is borrowed, not owned.** If a harness already translates another tool's
    MCP config, do not create a second writer merely to copy it. But discovery is not readiness:
    prove the effective source, precedence/shadowing, live connection, expected tools and the
    harness's actual public tool-name dialect. A best-effort importer that silently skips a bad
    server is useful interoperability, not an entwurf doctor.
  - **Callback tool names are harness dialect.** Derive and measure the name the harness exposes;
    never copy a sibling's spelling. OMP v18.0.0, for example, lowercases and replaces every
    `[^a-z_]+` run with `_`, collapses underscore runs, then trims edge underscores; source
    inspection therefore computes terminal `entwurf_v2` as `mcp__entwurf_bridge_entwurf_v`
    rather than Claude Code's `mcp__entwurf-bridge__entwurf_v2`. Digits in the middle become an
    underscore rather than simply disappearing. The live OMP tool list remains the acceptance
    oracle.

  That document also holds the anonymous hatch and the PATH/env boundary. Bookmark it; a
  lane that could not find it burned three sessions re-deriving what it already said.

---

## 6. Sender identity — "who sent this?"

The bridge is a child process. It must be able to name the citizen that owns it.

- (a) Source: `pi-extensions/lib/meta-sender-identity.ts` (`META_SENDER_BACKENDS` and the
  resolver) plus a `writeMetaSenderMarker` call in the backend's birth payload. The join is:
  **the hook writes a marker keyed by ITS parent pid; the MCP child looks a marker up under
  its own parent.** The shared ancestor is the join key — not cwd, not a wire field.
- (b) Order, and it is not negotiable:
  1. **Measure the join first.** Confirm `hook.ppid == mcp.ppid == the harness host pid`,
     with the same start-key, on this vendor. If that is false, a marker will be written
     where nothing looks for it and the whole step is dead code.
  2. Then write the marker, behind the same three guards every other writer uses — a
     plausible owner pid, a pid+start-key liveness key, and the backing meta-record as the
     authority.
  3. Then open the reader by adding the backend to `META_SENDER_BACKENDS`. **Both halves are
     required**: a marker nobody reads and a reader with no marker fail identically.
  - Gate: extend the backend's own birth gate rather than minting a second one. It runs the
    real launcher as a child, so the marker's `ownerPid` is the gate's own pid — the same
    parent-pid join production performs, with an oracle independent of the writer.
    Precedent: `scripts/check-agy-sender-identity.ts`.
  - Fail closed, and keep the two failures apart in the log. *Refused* (no launch
    provenance, or an implausible parent) is the designed answer, not a fault — an already
    open session that predates the install reaches the payload through an unstamped path
    and correctly claims no owner; restarting it arms who-sent. *Failed* (the write itself
    broke) is a real fault. Both leave a citizen that still exists and can still be
    addressed by others; only its own outbound sends fall back to the default refusal.
  - Then teach the backend's doctor the difference. `[측정]` Adding a marker write to a
    birth payload puts an ERROR *after* the successful mint line, and a doctor whose
    recovery rule is "an error with no successful mint after it" will read that as a birth
    failure and print a sentence that is false. Judge mint errors and marker errors on
    separate axes.
  - **Sanitize inherited identity carriers in every new or amended native managed launch.** The
    MCP bridge reads a complete `PI_SESSION_ID` + `PI_AGENT_ID` pair before it tries a native
    sender marker. A non-pi harness started from a pi citizen's bash can therefore inherit and
    impersonate the parent pi garden id unless its launcher removes both variables before exec.
    This is a shared external-host boundary, not an OMP-specific patch: #82's remaining Copilot
    fresh work and every later native admission must clear foreign identity carriers, then let
    that harness's own trusted birth marker establish identity. Existing launchers have not yet
    been certified against this newly recovered failure mode.
- (c) Two confusions this step exists to prevent:
  - **who-sent ≠ replyable.** They are different facts on different rails. A sender marker
    proves identity; whether a reply can *land* is answered by the receive rail of step 7 —
    a receiver marker for a self-fetch backend, an adapter probe for a native-push one. A
    backend can legitimately be `identity: garden-id` and `replyable: false` at the same
    time, and forcing the second to `true` is a lie the receiver acts on.
  - **The anonymous hatch is not a substitute for this step.**
    `ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER=1` opens sending at the price of identity: the
    message lands as `external-mcp`, non-replyable, and the receiver never learns who wrote
    it. It is a documented operator escape for a host with no citizen lifecycle — not a
    cheaper version of step 6.

---

## 7. Receive / notification

Only what the vendor actually ships. This is the step where imagination is most expensive.

- (a) Source: whatever real surface the measurement in step 1 found. For Claude Code that is
  a per-session mailbox armed by a receiver marker, with `FileChanged` as the doorbell and
  `asyncRewake` for the idle wake. For Antigravity it is native-push through the adapter and
  a live probe — **no mailbox and no receiver marker at all.** For Copilot CLI 1.0.80 it is
  the bundled first-party extension SDK: the CLI forks the extension, speaks JSON-RPC over
  the child's stdio, `joinSession()` binds the foreground native session, and the documented
  `fs.watch` → `session.send({mode:"enqueue"})` pattern supplies the idle wake. This is not
  the rejected hidden `--ui-server` loopback route.
  - **Who holds the watch decides who owns the marker.** Claude's CLI arms its own watch, so
    the marker names the CLI pid. Copilot's watch lives in a forked child, so the marker
    names the EXTENSION pid and carries `ownerKind: "copilot-extension"` with
    `armProvenance: "extension-join"`. Get this backwards and a crashed receiver stays
    "armed" for as long as the host process lives — the citizen reads deliverable with
    nothing watching its mailbox. Ask: which process would stop existing if the doorbell
    stopped working? That one owns the marker.
  - **A second process means a second install surface.** Copilot's receiver is not part of
    the birth plugin: `run.sh install-copilot-receive` owns its own artifact, install-state,
    doctor and inverse. Four Copilot surfaces (birth, statusline, MCP, receive), four
    installers, four failure modes.
- (b) Acceptance is a live receipt on the real harness, never an inference. `[측정]` On
  2026-08-23 an extension-armed idle Copilot session woke with zero typing, received a unique
  marker, replied with that marker in the same native session, and returned to `session.idle`.
  Evidence is L4 on one Linux workstation. A second armed process was observed to remain
  untouched, but its decisive log was not preserved before scratch cleanup; D3 isolation
  therefore remains a rerun. The travelling receipt is in
  `scripts/raw-async-delivery/README.md`.
  - A hermetic gate is the OTHER half, and it is not a substitute. `check-copilot-receive-arm`
    forks the shipped `extension.mjs` with the SDK specifier resolved by a loader hook — the
    vendor's own mechanism — so everything on entwurf's side of the fork (which id it binds,
    which pid owns the marker, what the doorbell says, when it refuses) is proved without a
    model turn. What it cannot prove is that a real turn starts on the other side. Keep the
    two receipts separate, and never let the green one stand in for the missing one.
- (c) The rules that keep this step honest:
  - **Never infer a receiver from a sender.** They are separate markers with separate
    meanings. Copilot outbound identity was accepted before its receive transport was found;
    neither fact grants the other.
  - **Use a vendor-owned wake mechanism; do not invent an external watcher, delivery adapter,
    or polling supervisor.** A watcher *inside* the vendor's documented extension lifecycle
    is different from an entwurf sidecar pretending to own that lifecycle. `entwurf_v2`
    still starts no process.
  - **Transport proof is not product admission.** The Copilot extension receipt removed the
    transport objection; admission was the separate work of owning installation and the
    feature flag, joining the armed receiver to the V3 record, refusing stale/crashed/drifted
    receivers, and routing dispatch. That landed in RAIL 5 — and the raw probe's `ready.json`
    did NOT: a file the receiver writes about itself is discovery evidence, so the product
    replaced it with a record-bound marker whose owner pid is verifiable. When a probe's
    convenience artifact survives into the product, that is the smell to look for.
  - **Keep experimental availability visible — and check it where it is decided.** Copilot
    scans extensions only when `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS` is present;
    without it the scan is silently skipped. No installer can set that flag — it belongs to
    the launch, not to anything on disk — so ownership here splits in two. **A launch you own
    can set it:** `entwurf copilot` execs the vendor CLI with the flag for that one
    invocation and refuses if the receiver it is promising is not installed. **Every other
    launch you can only DETECT:** `doctor-copilot-receive` identifies the live CLI processes
    from their argv — the vendor entry they were exec'd with, never their command name, which
    the shim's own `exec` makes unusable — reads `/proc/<pid>/environ`, and goes red when the
    receiver is installed and a running session could never arm. Take both halves: a managed
    launch is not a substitute for the doctor, because operators start sessions their own way,
    and a vendor silence you cannot remove is a doctor's job rather than a reason to promise
    the capability anyway. The flag's durability across
    releases stays an open risk, not a reason to erase the demonstrated transport.
  - Note where notification actually goes. `[번들]` Copilot's separate `agentStop` output
    contract is `{decision?:"block", reason?:string}` and a blocked reason becomes a follow-up
    user message. That turn-boundary hook is not the idle-wake transport above and must not be
    used as its substitute.

---

## 8. Grade

Only after acceptance, and both places move together.

- (a) Source: the `DELIVERY.md` current matrix **and** `pi/entwurf-capabilities.json`
  (`wakeMode`, `deliveryLevel`).
- (b) Gate: `check-entwurf-capabilities` holds the registry against the backend constant.
- (c) A grade is a claim about evidence, so it moves when the evidence moves — not when the
  code lands. Two failure shapes to avoid: a registry that promises a `wakeMode` with no
  channel behind it, and a matrix row still describing a lane that has since been walked.
  `[측정]` Copilot is the worked example of that rule running in BOTH directions. It walked
  all of steps 1–7 as a branch product — receiver installed, record-bound, liveness-guarded,
  on the mailbox rail, hermetic gate green — and its registry grade stayed `D0` through all
  of it, because no green gate is a wake. The grade moved only when the evidence did: on
  2026-08-23 a managed LIVE acceptance ran on garden `20260823T181316-d9f6ba` (CLI 1.0.80)
  and left a joined→armed→doorbell→rang receive log, a mailbox stamped
  `lastEnqueuedAt 09:23:41.235Z` / `lastReadAt 09:23:56.480Z`, and a model reply on the same
  record/native/gid chain. That — not the landing of the code — is what made it `D6`.
  The same discipline caps it: D7 stays PARTIAL (reply and read receipt observed; completion
  taxonomy and long-haul operation not), D3 is PENDING because its decisive log was lost to a
  scratch cleanup before anyone copied it out, and D8 is unproven. Grade the product, not the
  prototype, and keep the raw probe's own D-levels recorded separately in `DELIVERY.md`
  rather than hiding either fact. If you take one habit from this row, take the boring one:
  **move the receipt out of scratch before you close the terminal.**

---

## 9. Visible lifecycle parity — onboarding is not finished at birth

The adapter work above and the lifecycle implementation remain separate modules, but product
admission joins their evidence. Starting with native-harness admissions made under this #82
contract, a backend may be declared **supported** only when it can be opened as one visible fresh
sibling through `entwurf_fresh_call` with the same operator contract as every other supported fresh
backend. This rule does not delete historical records or retroactively reinterpret preserved
registry grades: a pre-contract backend that has not walked this step remains legacy/probe evidence
and must not be described as supported until it is re-evaluated here.

1. one fixed managed runtime path — never an arbitrary command or raw tmux workaround;
2. an explicit model and an explicit permission policy in the vendor's measured argv dialect;
3. a pre-mutation, fail-closed preflight for the birth, MCP hand and receive capability the fresh
   prompt needs;
4. a garden id shown on the harness's own persistent visible identity surface;
5. callback as the first action, using that harness's measured tool name;
6. exact nonce correlation from the callback sender envelope, with launch and callback receipts
   kept separate;
7. one real visible LIVE receipt through callback and addressed receive.

If one of these cannot be implemented from vendor-owned surfaces, the outcome is **do not admit
that harness**, not “citizen but you cannot open/call it.” Same-id resume is a separate optional
capability: add it only when a record can authoritatively recover the vendor's transcript/model/cwd
without guessing. Internal subagents stay inside the top-level citizen throughout lifecycle work;
do not connect a vendor's internal hub/team protocol to entwurf merely to expose its private hops.

---

## The five documents this one points at

| Document | Owns | Reached from |
|---|---|---|
| [`acp-backend-rail.md`](./acp-backend-rail.md) | the ACP adapter lane end to end | step 0, the other side of the fork |
| [`fresh-cut-policy.md`](./fresh-cut-policy.md) | recovery when a record generation is genuinely unreadable | step 2 — and only after redeploy has been ruled out |
| [`external-mcp-host.md`](./external-mcp-host.md) | per-harness bridge registration, external vs garden-native semantics, the anonymous hatch, the PATH/env boundary | steps 5 and 6, as required detail |
| [`setup-clean-host.md`](./setup-clean-host.md) | operator reproduction of the whole install on a fresh host | after any step that adds an installer or doctor |
| [`mux-launch-rail.md`](./mux-launch-rail.md) | opening a fresh sibling and reopening a dormant one | step 9 — separate implementation, required admission evidence |

Verification protocol and evidence levels stay in [`../VERIFY.md`](../VERIFY.md); recorded
host evidence in [`../BASELINE.md`](../BASELINE.md); the invariants every step above must
respect in [`../AGENTS.md`](../AGENTS.md) — in particular Hard Rule 7, which remains the
authority on the meta-record store contract that step 2 touches.
