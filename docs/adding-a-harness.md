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
a session of that harness that owns a V3 meta-record and therefore a garden id.

---

## 0. Which lane — onboarding is two different jobs

Before anything else, decide which of the two you are doing. They share almost nothing.

|  | **Native citizen onboarding** | **ACP backend adapter** |
|---|---|---|
| The session | already running, opened by the operator | a child entwurf's pi adapter launches |
| Owns its auth/transcript | yes — entwurf never touches them | yes — inside an isolated overlay |
| What entwurf adds | a meta-record, a garden id, and whatever rails the vendor actually supports | a provider/model route and a turn loop |
| Where the contract lives | **this document**, steps 1–8 | [`acp-backend-rail.md`](./acp-backend-rail.md) |

- (a) Source: native lane → `pi-extensions/lib/meta-session.ts` + a per-backend hook unit
  under `pi/`. ACP lane → `pi-extensions/lib/acp/` and `pi-extensions/acp-provider.ts`.
- (b) Acceptance: the two lanes have separate gates and neither substitutes for the other.
- (c) Skip this choice and you build an ACP adapter for a harness the operator already has
  open (duplicating a session it owns), or a citizen lane for a process nobody launched.

**Opening a NEW sibling or reopening a dormant one is neither lane.** That is lifecycle,
it lands after onboarding, and it has its own contract in
[`mux-launch-rail.md`](./mux-launch-rail.md). Do not fold `entwurf_fresh_call` /
`entwurf_resume_call` support into an onboarding change.

---

## 1. Measure the vendor

Everything downstream is a bet on what the vendor actually does. Take these five
measurements first, from the vendor's own artifacts and processes.

1. **Hook vocabulary and firing time.** Which events exist, and *when* they fire.
2. **Launch form and envelope.** How a hook command is declared, and what arrives on stdin.
3. **Config writer.** Which file the vendor's own CLI writes, and in what shape.
4. **Statusline / receive surfaces.** What the vendor offers for display and for waking.
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

## 4. Statusline

Optional, and honest either way: if the harness has a status surface, the citizen shows its
own garden id there; if it does not, say `unsupported` and move on.

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
  a live probe — **no mailbox and no receiver marker at all.**
- (b) Acceptance is a live receipt on the real harness, never an inference.
- (c) The rules that keep this step honest:
  - **Never infer a receiver from a sender.** They are separate markers with separate
    meanings, and a receiver marker written where nothing can ring it claims a doorbell that
    does not exist.
  - **Do not invent a watcher, a delivery adapter, or a polling supervisor** for a harness
    whose bundle has no wake mechanism. `entwurf_v2` starts no process; a citizen that
    cannot be woken refuses honestly instead.
  - Name the boundary precisely rather than broadly. `[번들]` Copilot CLI 1.0.80 has no
    `FileChanged`, no `asyncRewake` and no `watchPaths`, so it has **no idle wake** — but it
    does have an `agentStop` hook, and "no idle wake" must not be written as "no hooks at
    all". `[미검증]` Whether a declarative Copilot unit is accepted for `agentStop` has not
    been measured on this branch; the vendor's JS never names the declarative hook set, so
    only a live turn can answer it.
  - Note where the notification actually goes. `[번들]` Copilot's `agentStop` output
    contract is `{decision?:"block", reason?:string}` and a blocked reason is enqueued as a
    **follow-up user message** — it reaches the model's context, not an operator panel. A
    notification design written as "the operator sees the letter" would be aimed at the
    wrong reader; combined with the hand from step 5, the model fetches its own mail.

---

## 8. Grade

Only after acceptance, and both places move together.

- (a) Source: the `DELIVERY.md` current matrix **and** `pi/entwurf-capabilities.json`
  (`wakeMode`, `deliveryLevel`).
- (b) Gate: `check-entwurf-capabilities` holds the registry against the backend constant.
- (c) A grade is a claim about evidence, so it moves when the evidence moves — not when the
  code lands. Two failure shapes to avoid: a registry that promises a `wakeMode` with no
  channel behind it, and a matrix row still describing a lane that has since been walked.
  `[미검증]` As of this branch, Copilot has walked steps 1–6 and has **not** walked 7 or 8;
  its current registry and matrix values are therefore behind the code and are being
  corrected in their own step, not here.

---

## The five documents this one points at

| Document | Owns | Reached from |
|---|---|---|
| [`acp-backend-rail.md`](./acp-backend-rail.md) | the ACP adapter lane end to end | step 0, the other side of the fork |
| [`fresh-cut-policy.md`](./fresh-cut-policy.md) | recovery when a record generation is genuinely unreadable | step 2 — and only after redeploy has been ruled out |
| [`external-mcp-host.md`](./external-mcp-host.md) | per-harness bridge registration, external vs garden-native semantics, the anonymous hatch, the PATH/env boundary | steps 5 and 6, as required detail |
| [`setup-clean-host.md`](./setup-clean-host.md) | operator reproduction of the whole install on a fresh host | after any step that adds an installer or doctor |
| [`mux-launch-rail.md`](./mux-launch-rail.md) | opening a fresh sibling and reopening a dormant one | after onboarding — a separate lifecycle, not part of it |

Verification protocol and evidence levels stay in [`../VERIFY.md`](../VERIFY.md); recorded
host evidence in [`../BASELINE.md`](../BASELINE.md); the invariants every step above must
respect in [`../AGENTS.md`](../AGENTS.md) — in particular Hard Rule 7, which remains the
authority on the meta-record store contract that step 2 touches.
