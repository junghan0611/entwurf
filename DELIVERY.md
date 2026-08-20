# Async delivery capability levels

`DELIVERY.md` answers one cross-harness question:

> Can an already-running native agent session receive an asynchronous message
> without pretending that pi owns the backend transcript?

It is a diagnostic coordinate system, not a product promise or benchmark. Record
the highest demonstrated capability instead of collapsing results into “works” or
“doesn't work.” Evidence quality is tracked separately in [VERIFY.md](./VERIFY.md);
operator observations live in [BASELINE.md](./BASELINE.md).

## Scope

Qualifying delivery targets an already-running, backend-owned native session through
an official surface. It does **not** include:

- tmux/pty keystroke injection or transcript scraping;
- direct writes into backend transcripts or state databases;
- a fresh prompt/process/thread presented as continuation;
- transcript hydration or a second tool-result ledger inside entwurf.

A transport may be a socket, filesystem watch, mailbox, lifecycle hook, or native
API. The levels compare capabilities, not implementation shapes.

## State vocabulary

| State | Meaning |
|---|---|
| `queued` | A message is durable; the backend may not have seen it. |
| `triggered` | A supported event/API accepted the signal. |
| `woke` | An idle interactive session began a turn without user typing. |
| `injected` | The message reached model-visible context. |
| `processed` | A supported event says the turn completed. |
| `replied` | A result returned through an explicit garden-side path. |

Avoid bare `delivered`; name the observed boundary.

## Levels (D0–D8)

These are independent of VERIFY's `L0–L5` evidence levels and BASELINE's question
layers.

| Level | Capability | PASS criterion |
|---|---|---|
| **D0** | Live identity | Native id, cwd/project, backend, and enough liveness data identify one target. |
| **D1** | Native continuation | The existing native/subscription session receives the message; no fresh worker/thread substitutes for it. |
| **D2** | Receiver armed | The session exposes a supported watch, hook, socket, subscription, or API route. |
| **D3** | Addressed enqueue | One target is selected; siblings are not broadcast-woken. |
| **D4** | Idle wake | An idle session wakes without user typing or pty injection. |
| **D5** | Context injection | A unique message reaches model-visible context through the supported route. |
| **D6** | Continuity | The same native session/conversation and model path responds. |
| **D7** | Completion/reply observation | Completion or reply is observable without transcript scraping. |
| **D8** | Operational robustness | Dedupe, ordering, stale handling, loop guards, and crash recovery are implemented and tested. |

Mark partial or conditional cells explicitly. Capability and evidence are different:
a D7 claim from one direct-native run may still have only L4 evidence on one host.

### Probe output

Raw probes under [`scripts/raw-async-delivery/`](./scripts/raw-async-delivery/)
should print one comparable block:

```text
DELIVERY_LEVELS:
harness=<name>
transport=<official surface>
D0 live_identity: pass
D1 native_continuation: pass
...
D7 completion_reply: partial reason="..."
D8 robustness: partial reason="..."
```

## Current matrix

| Harness / surface | Product status | Capability | Transport and boundary |
|---|---|---|---|
| **pi native Entwurf** | shipped | D7; D8 partial | Record-addressed Unix control socket. A record-less socket is diagnostic only and never dispatched. |
| **Claude Code interactive `>=2.1.217`** | shipped; Linux certified | D6; D7/D8 partial | Per-session mailbox + exec-form `FileChanged`/`asyncRewake`. B2 proved idle wake and same-session continuity on one NixOS host. |
| **Antigravity / agy** | shipped | D6; D7 partial | Record-backed native-push through LS gRPC `agentapi send-message`; no mailbox or receiver marker. |
| **Codex app-server-backed TUI** | verified probe | D7; D8 unproven | WebSocket-over-UDS `turn/start` into a live `threadId`; status events expose completion. No managed citizen lane yet. |
| **Codex embedded TUI** | deferred | D0 partial | No supported receive socket/hook on the measured standalone shape. |
| **Copilot CLI TUI+server** — *withdrawn lane, kept as evidence* | rejected | D7; D8 unproven | **Old chronological-slice run; the named-turn probe in the tree is unrun.** Official SDK over hidden `--ui-server`: foreground native id + metadata, two-session addressed idle enqueue, same-session auto-model reply, completion events read back through the official session event-history API. Loopback RPC authentication is not established; no managed citizen lane. Evidence is L4 direct-native on ONE Linux workstation, host-local stdout, not archived. |
| **Copilot CLI plugin/hooks** | shipped (birth only) | D0 | Garden BIRTH, no delivery. The `.claude-plugin` hook fires under Copilot and the envelope arrives on stdin; only argv is dropped, because Copilot's schema has no `args` (its exec form is one `exec` string). A dedicated no-argv unit mints a `backend: "copilot"` record on the FIRST PROMPT — `sessionStart` is deferred to it, so opening the TUI fires nothing. No doorbell exists in the bundle (`FileChanged`, `asyncRewake`, `watchPaths` all absent), so there is no receiver to arm and D2 cannot pass: a dispatch to this citizen refuses as `mailbox-undeliverable`. Measured 2026-08-20 on CLI 1.0.80; gate `check-copilot-birth-hook`. |
| **ACP Claude / Cortex** | shipped runtime, outside this matrix | — | ACP sessions are children launched by entwurf's pi adapter, not already-running native sessions to wake. |

“Verified probe” means the transport worked in a reproducible raw probe but entwurf
does not yet own lifecycle, installation, doctors, or release acceptance for it.
Re-audit backend versions before turning probe evidence into a shipped adapter.

## Rail notes

### Claude Code: durable body, edge-triggered wake

Claude's hook contract is exec-only at `>=2.1.217`. `SessionStart` arms a per-session
watch path; the sender writes durable `*.msg` bodies before poking the signal;
`FileChanged` emits a doorbell and `asyncRewake` wakes the idle session. The receiver
then calls `entwurf_inbox_read`, which drains all unread bodies and archives them as
`*.read`.

The signal is edge-triggered and may coalesce, but the message body is level-triggered:
one successful wake drains the backlog. D8 remains partial until active-turn arrival,
coalescing bounds, re-arm gaps, and crash/re-poke behavior are measured. A synthetic
container doctor proves package/oracle shape, not a real Claude wake; a claimed host
needs the installed strict doctor against a new native session.

### Antigravity: native push

`PreInvocation` births or reattaches a citizen by native `conversationId` and writes a
record-backed sender marker. `entwurf_v2` probes the live conversation and injects
directly through the native adapter, with one bounded re-probe retry. Replyability is
`record-backed identity ∧ probe-alive`; mailbox state does not exist on this rail, and no
rail has resume authority since the visible-first cut.

The managed bridge, statusline, and hook installers own separate configuration atoms.
Same-pid concurrent model invocation by multiple conversations is not claimed because
the pid/start-key sender marker would be last-writer-wins. Current operator checks are
in [BASELINE.md](./BASELINE.md); deterministic ownership and sender gates run in
`pnpm run check:full`.

### Codex: launch mode is part of the capability

Do not describe “Codex” as one delivery shape. The measured app-server-backed TUI can
accept `turn/start` for a live thread and report completion; the standalone embedded
TUI exposed no equivalent receive route. This remains archived method evidence, not a
shipping commitment: GLG closed the managed native Codex lane on 2026-08-01 because pi
already supplies the official GPT provider path. Entwurf will not duplicate it as a
native citizen or ACP backend. `turn/steer` is active-turn steering, not idle wake.

### Copilot CLI: the plugin hook is the citizen rail; TUI+server was rejected

**The positive lane is the plugin hook, not the loopback server.** #82 measured on
2026-08-20 that Copilot loads and executes the `.claude-plugin` hook and translates the
Claude envelope onto stdin, which is enough to mint a garden id — and that its bundle
carries no doorbell, so birth and delivery are separate admissions. The `--ui-server`
material below is retained as the record of a REJECTED lane and its refusal grounds; it
is not a candidate.

**Two things are recorded here and they are not the same thing: what was MEASURED on
2026-08-19, and what the probe now CONTRACTS to measure.** The measurement below was
taken with the earlier chronological-slice probe, which scored the events following the
marker's position in the history. The current probe scores a named turn instead (next
subsection). No result below has been re-taken under that contract, and none of it is
retroactively a demonstration of it.

**Measured 2026-08-19 (old chronological-slice probe).** A plain Copilot TUI and shell
command hooks do not establish the measured route. CLI 1.0.80 launched with hidden
`--ui-server --port <port>` and joined by first-party `@github/copilot-sdk` 1.0.11 did:
protocol-v3 ping, foreground session id plus cwd/git metadata, exact session resume, idle
`enqueue`, same-session model-`auto` reply, and `assistant.message`/`turn_end`/`session.idle`
completion. A second run created a no-turn control session B, targeted A, and proved B
received no user/turn/assistant event, closing D3 on one Linux workstation.

The two-session shape also exposed a D8 gap: A visibly replied and persisted
`assistant.message` + `turn_end`, but the joining SDK client did not receive ephemeral
`session.idle`, so SDK `sendAndWait()` timed out. Bounded reads of the official session
event-history API (`session.getEvents()` / `getMessages()`) then observed the completed
target turn. Claim that at its real size: it is the SDK's own full event history, not a
narrower or more privileged view, and equally not TUI, file, or database transcript
scraping — the probe never reads Copilot's own storage. It is probe evidence, not a
product polling/retry design.

**Evidence level for everything above: L4 direct-native, ONE Linux workstation, one run.**
The receipt is host-local probe stdout; it was not archived as a durable artifact, so this
row is reproducible-by-instruction, not citable to a stored file.

**Current probe contract (not yet run LIVE).** Attribution is now a named chain rather
than a position in the history: the probe's unique marker body must match exactly one
`user.message`; that event's `interactionId` must open exactly one `assistant.turn_start`;
that turn_start must expose a `turnId`; and only `assistant.message` / `assistant.turn_end`
carrying that `turnId` are scored. Every link is required, and absent-or-ambiguous fails
the probe closed — there is no positional fallback and no "the turn after ours" rule.
Note what is deliberately NOT the key: `session.send()` resolves to the SDK's own
submission handle, a string that appears on no server event and is a different axis from
`user.message.id`/`interactionId`, so joining on it cannot hold. It is logged as a
diagnostic only. The next LIVE turn is what would demonstrate this contract; until then
it is a design, not evidence.

The probe also stays out of the operator's lifecycle, stated precisely: it never deletes
target session A and issues no `A.disconnect()` of its own. `client.stop()` does tear down
every tracked session — A included — as a wire `session.destroy`; because A's foreground
ownership is re-confirmed immediately before teardown, the TUI keeps A as its foreground
session, so the net effect on A is detach-equivalent, not removal.

This is not yet admissible as a native-push adapter. The flag is hidden from CLI help,
and the loopback JSON-RPC server did not enforce the SDK connection token in the
measured launch: an unauthenticated client connected, while a token-bearing client was
rejected as `AUTHENTICATION_NOT_CONFIGURED`. The TCP port is only a runtime endpoint,
never identity authority.

**This fence is half withdrawn (#82, 2026-08-20).** ~~Do not add a record backend~~ — a
record backend is the deliverable: it is what mints a garden id, and it arrived through
the plugin hook rather than through this loopback path. **Do not add a dispatch route**
still holds, and now for a measured reason rather than caution: the bundle has no
doorbell, so there is nothing to wake. Permission ownership, stale/crash handling and a
supported fail-closed local boundary remain undemonstrated for `--ui-server`, which is
why that path stays rejected.

## Recording a new claim

For every matrix change, record:

1. backend version and launch mode;
2. native session identifier and liveness join;
3. exact official transport;
4. highest D-level plus every partial boundary;
5. evidence level and artifact/log location;
6. what remains outside entwurf ownership.

Keep transcript ownership native, lookup authority in the meta-record, and transport
asymmetry explicit. Historical probes and per-version chronology belong in CHANGELOG,
issues, and git history rather than this standing capability contract.
