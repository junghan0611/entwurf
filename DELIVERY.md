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
