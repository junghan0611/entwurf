# DELIVERY.md — Async delivery capability levels

`DELIVERY.md` is the cross-harness yardstick for one question:

> Can an already-running native agent session receive an async message, without
> pretending that pi owns the backend transcript?

It is **not** a product promise and not a benchmark. It is a diagnostic coordinate
system. When Claude Code, Antigravity, Codex, pi-native Entwurf, or a future
harness behaves differently, record the exact delivery level it reaches instead
of collapsing the result into "works" / "doesn't work".

Companion surfaces:

- [VERIFY.md](./VERIFY.md) — agent-driven bridge verification and evidence quality (`L0–L5`).
- [BASELINE.md](./BASELINE.md) — operator-driven identity / overlay baseline interviews.
- [`scripts/raw-async-delivery/`](./scripts/raw-async-delivery/) — reproducible raw delivery probes.

## Scope and non-goals

This document is about **native live-session delivery** for the 1.0.0
meta-bridge direction: a garden meta-session points at a backend-owned native
session, and async messages reach that session through the backend's own
supported surfaces.

Non-goals:

- no tmux / pty `send-keys` as evidence for native delivery;
- no backend transcript hydration into pi JSONL;
- no direct writes into backend transcript databases / JSONL / protobuf files;
- no new prompt spawn (`claude -p`, fresh Codex thread, etc.) masquerading as
  delivery into an already-running subscription/native session;
- no fake pi session or tool-result ledger for an external backend.

A backend may use a socket, filesystem watch, JSON-RPC app server, lifecycle
hook, or another official surface. The transport differs; the levels below keep
the judgement comparable.

## State vocabulary

Use these words precisely in scripts and docs:

| State | Meaning |
|---|---|
| `queued` | Message is durably written to a mailbox / sender queue. The backend has not necessarily seen it. |
| `triggered` | A backend-supported event fired: socket RPC accepted, hook fired, file watch event observed, etc. |
| `woke` | An idle interactive session started a new turn without user typing / pty injection. |
| `injected` | The message or a doorbell pointing at it reached model-visible context through an official channel. |
| `processed` | The turn ended or the backend acknowledged completion through a supported hook/event. |
| `replied` | A result returned to the garden/pi side through an explicit reply path (MCP send, outbox, API result). |

Avoid bare `delivered` unless you define it. Preferred decomposition:
`queued → triggered → woke → injected → processed → replied`.

## Delivery levels (D0–D8)

These are a separate namespace from VERIFY.md evidence levels (`L0–L5`) and
BASELINE.md overlay layers (`Q-L1` etc.). Mark the highest level reached and any
partial levels.

| Level | Name | PASS criterion | Typical failure / partial |
|---|---|---|---|
| **D0** | Live session identity | Can identify the target live session: native id, cwd/project, backend, and enough liveness metadata to address it. | Only transcript files exist; no live-session join key. |
| **D1** | Native/free continuation | Delivery targets an already-running native/subscription session; no fresh prompt spawn or metered worker is created for the message. | Uses `claude -p`, a fresh Codex thread, or a new pi child instead of the live session. |
| **D2** | Receiver armed | The receiving session registers an official receive surface: hook/watch path/socket/app-server subscription. | A mailbox exists but no live session is watching or reachable. |
| **D3** | Addressed enqueue | Sender can queue a message for exactly one target session id; siblings are not broadcast-woken. | Shared signal wakes every session; no per-session address. |
| **D4** | Idle active wake | An idle interactive session wakes from an external signal with no user typing and no pty/tmux injection. | Piggyback only: message waits until the next human/user turn. |
| **D5** | Context injection | A unique token / message body reaches model-visible context via an official hook/API path; the model can acknowledge it. | Hook logs show activity, but the model never sees the message. |
| **D6** | Same session/model continuity | The response comes from the same native session/conversation and same model/subscription path. | A new conversation/process handles the message; model changed silently. |
| **D7** | Completion / reply observation | Completion or reply can be observed without transcript scraping: Stop/SessionEnd/PostInvocation, outbox, MCP reply, API result, etc. | Wake and context work, but the garden side cannot know when the turn finished except by watching the UI. |
| **D8** | Operational robustness | Duplicate suppression, delivery markers, loop guards, level-triggered body drain, ordering policy, stale-session handling, and crash recovery are implemented/tested. | Demo works once but can loop, duplicate, reorder, leave unread backlogs, or lose messages. |

### Script result contract

Raw probes should print a summary block that a human or later parser can compare
across harnesses:

```text
DELIVERY_LEVELS:
harness=claude-code
transport=filechanged-watchpaths-asyncrewake
D0 live_session: pass
D1 native_free_continuation: pass
D2 receiver_armed: pass
D3 addressed_enqueue: pass
D4 idle_active_wake: pass
D5 context_injection: pass token=AGY-PARITY-3399
D6 continuity: pass session_id=<native-id> model=claude-opus-4-8
D7 completion_reply: partial reason="no garden outbox yet"
D8 robustness: partial reason="loop guard present; crash recovery not tested"
```

When a level is **not applicable** or **conditional**, say so explicitly. For
example, Codex app-server delivery is conditional on a loaded thread and control
socket; direct Codex TUI is a different surface.

## Current capability matrix (2026-06-05)

This matrix is a snapshot of what the raw probes have established. It should be
updated when a backend version changes the delivery surface.

| Harness / surface | Highest current level | Transport | Notes |
|---|---:|---|---|
| **pi native Entwurf** | D7+ | Unix control socket + pi followUp/custom messages | Replyable pi session. This is the resident baseline, not an external meta-session. |
| **Claude Code interactive 2.1.163** | D6, D7 partial, D8 partial | Plugin/global `SessionStart` arms `watchPaths`; external write triggers `FileChanged`; `asyncRewake` wakes idle session | Active idle wake proven without pty. `Stop` alone is piggyback-only. `asyncRewake` is a doorbell; body is self-fetched from mailbox. D8 partial: duplicate/read idempotence, honest unread counts, and level-triggered body drain are gated; empirical wake-edge bounds and unread-heartbeat backstop remain open (#34). |
| **Antigravity / agy** | D6+ | Native LS gRPC `agentapi send-message` | Active push into live conversation. Same judgement levels; transport differs from Claude. |
| **Codex embedded TUI 0.136.0** | D0 partial | Native state DB / rollout transcript only | Standalone Embedded TUI binds no socket; no `FileChanged`/`asyncRewake` in Codex hooks; not retrofittable. Identify-only via state DB / rollout. |
| **Codex app-server-backed TUI 0.136.0** | D6, D7 (status) | WebSocket-over-UDS `turn/start` into the live `threadId` | **Demonstrated, no managed standalone, no cloud.** `codex app-server --listen unix://<owned 0700 dir>` + plain `codex` auto-attach (or `--remote unix://`). Full message injection (agy-like, not a doorbell); `thread/status/changed` gives completion observation. D8 robustness (dedupe / crash recovery / ordering policy) is not tested. `turn/steer` is active-turn steering, not idle wake. |
| **Codex managed-daemon / remote-control 0.136.0** | D4–D6 conditional | `app-server proxy` newline JSON-RPC over the daemon control socket | Needs the managed standalone install; `remote-control` also enables the **cloud** bridge. Use the bare `--listen` path above for a purely-local setup. |

## Backend notes

### Claude Code — filesystem event wake, not socket push

A missing local listening socket does **not** imply idle wake is impossible.
Claude Code interactive can be woken by a supported filesystem-event path:

1. a plugin or settings hook runs at `SessionStart`;
2. it emits `watchPaths` for a per-session signal file;
3. an external sender writes a per-session message and pokes that signal;
4. `FileChanged` fires while the session is idle;
5. the hook exits with `asyncRewake` and writes the doorbell to **stderr**;
6. the same session/model wakes and self-fetches the message body.

#### D8 partial — signal/body separation is level-triggered

Claude's `FileChanged` signal is an edge: rapid signal writes may coalesce, and a
true missed edge can leave an idle session with unread mail until another wake or
backstop occurs. The body is not carried in that edge. Bodies are durable mailbox
files (`*.msg` before the doorbell, `*.msg.delivered` after the doorbell), and
`entwurf_inbox_read` drains the whole unread set in one read and archives them as
`*.read`. Therefore a coalesced doorbell does not drop message bodies: once the
receiver self-fetches, it consumes all queued bodies, not "one event = one body".

Deterministic gates: `check-meta-session` asserts mixed fresh/delivered bodies are
drained together and re-read is empty; `smoke-meta-honesty` asserts the doorbell's
unread count matches what the inbox reader will drain. Remaining D8 work is still
honest/open in #34: empirical FileChanged coalescing bounds, active-turn arrival,
watchPath edge cases, compact-window re-arm gaps, and a heartbeat/re-poke backstop
for live sessions with unread mail.

Important gotchas live in [`scripts/raw-async-delivery/README.md`](./scripts/raw-async-delivery/README.md):
`Stop` hooks do not wake idle sessions, bare skills cannot arm startup watches,
plugins can, and imperatives in injected text can be flagged as prompt injection.

### Antigravity / agy — native push

Antigravity reaches the same delivery levels through a different transport:
`agy agentapi send-message` over the native LS gRPC surface. This is not a reason
to make the garden layer backend-specific; it is exactly why the adapter contract
must describe capability (`D0–D8`) separately from transport.

### Codex — split by launch mode, not by "Codex"

Do not describe "Codex" as one delivery shape. The split is the TUI's launch mode:

- **standalone Embedded TUI**: binds no socket, no `FileChanged`/`asyncRewake` in
  Codex hooks, decision fixed at `run_main` → not addressable, not retrofittable;
- **app-server-backed TUI**: idle-wake **works**. Run a bare
  `codex app-server --listen unix://$HOME/.codex/app-server-control/app-server-control.sock`
  (no managed standalone, no cloud — only the official daemon path needs the
  managed install). Plain `codex` (no `-c`) auto-attaches to that default socket;
  an external WebSocket-over-UDS client sends `turn/start` to the live `threadId`.
  Measured: idle thread woke with zero typing, body injected, model replied,
  completion observed via `thread/status/changed`.

Sender: `raw-codex-ws-turn-start.py` → bare `--listen` socket (WebSocket, no managed
standalone, no cloud). A second surface exists but is out of scope here — the managed
**daemon** control socket (via `codex app-server proxy`) needs the managed standalone
install, and `remote-control` enables the cloud bridge; we ship only the bare-local
path. Per-folder `config.toml` `[projects."<path>"]` trust gates project-hook loading,
not addressability.

A Codex adapter must declare which launch mode + which socket it targets.

## How to use this in 1.0.0 design

For meta-sessions, peer records should expose capability rather than hiding
backend differences:

```ts
type WakeMode = "socket" | "file-watch" | "native-push" | "app-server" | "piggyback" | "none";

type DeliveryPeer = {
  sessionId: string;              // garden id
  kind: "pi-session" | "meta-session";
  backend: "pi" | "claude-code" | "agy" | "codex" | string;
  replyable: boolean;
  wakeMode: WakeMode;
  deliveryLevel: "D0" | "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8";
};
```

MVP rule of thumb:

- expose what is proven;
- mark partial/conditional honestly;
- keep transcript ownership native;
- treat liveness as best-effort hint (`last_seen` + native presence), not as a
  single authoritative socket/WAL/file check;
- keep lookup authority in the meta-record scan, not a derived index.
