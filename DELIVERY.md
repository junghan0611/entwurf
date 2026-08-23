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
| **Copilot CLI first-party extension** | raw transport probe; superseded by the managed unit | D7 path observed; D3 control receipt incomplete; D8 unproven | CLI-spawned extension over stdio JSON-RPC; `joinSession()` + documented `fs.watch` → `session.send({mode:"enqueue"})`. Idle wake, exact-marker reply, and completion passed on 2026-08-23 (CLI 1.0.80, L4, one Linux host). Two-process isolation was observed but its decisive B log was not preserved. Kept as the transport receipt the managed lane was built on; the shipped unit differs deliberately — it announces the inbox instead of injecting the body. |
| **Copilot CLI garden citizen** | branch candidate; send + receive accepted on one host | D6; D7 partial; D3 pending; D8 unproven | Birth, garden id, MCP hand and record-backed sender identity are accepted; the RECEIVER is an installed first-party extension that binds to the V3 record, writes a receiver marker owned by the WATCHER pid, and rings a doorbell the model drains with `entwurf_inbox_read`. `wakeMode` is `self-fetch`, so dispatch reaches the mailbox rail: armed → delivered, unarmed/stale → the honest `mailbox-undeliverable` refusal. **D6 is the managed LIVE acceptance of 2026-08-23** — garden `20260823T181316-d9f6ba`, native `20fe30c8-b2bc-4600-91a0-8a409131be51`, CLI 1.0.80: receive log `joined`→`armed`→`doorbell fresh=1`→`rang`, mailbox `lastEnqueuedAt 09:23:41.235Z` / `lastReadAt 09:23:56.480Z`, and a model reply on the same record/native/gid chain. D7 is PARTIAL: the reply and read receipt were observed, the completion taxonomy and long-haul operation were not, and the reply envelope reaches this table as an inherited fact rather than a re-read transcript. D3 (managed second-session isolation) is PENDING — it was observed once and its decisive log was lost to a scratch cleanup. Evidence level L4: one host, one round trip. Launch with `entwurf copilot`, which sets `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS` for that one invocation; `doctor-copilot-receive` reads the live CLI environments because a session launched without it is silently inert. |
| **Copilot CLI TUI+server** — *withdrawn lane, kept as evidence* | rejected | D7; D8 unproven | Older official-SDK probe over hidden `--ui-server`; idle enqueue worked, but loopback RPC authentication was not established. The bundled extension supersedes this candidate without reviving it. |
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

### Copilot CLI: one citizen, two rails, one pending receipt

The branch product owns the native citizen's birth, garden id, statusline, MCP hand,
outbound sender identity — and, since RAIL 5, the receiver. A real Copilot CLI 1.0.80
session minted a V3 record and sent under that record-backed garden id on 2026-08-21.
That proved who SENDS. Whether a reply LANDS is a different fact on a different process,
and the paragraphs below are the two halves of it: where the transport came from, and
what the managed lane had to add before it could be dispatched to.

The missing receive transport was found and measured on 2026-08-23. Copilot's platform
package bundles its first-party extension SDK and bootstrap. With
`COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS`, the CLI forks an installed extension and
speaks JSON-RPC over the child's stdio; `joinSession()` binds the foreground session, and
the vendor-documented `fs.watch` → `session.send({mode:"enqueue"})` pattern wakes it.
An idle, never-typed-into session received a unique marker and returned it, then emitted
`session.idle`. A second armed process was observed to remain untouched, but its decisive
B log was not preserved before scratch cleanup, so D3 isolation remains an admission
rerun rather than a durable acceptance. This is L4 direct-native evidence on one Linux
workstation. The travelling receipt and reproduction are in
[`scripts/raw-async-delivery/README.md`](./scripts/raw-async-delivery/README.md).

This extension rail has no network listener, so the rejected `--ui-server` loopback
transport's authentication blocker does not apply. The managed lane then took that
transport and gave it the obligations a product owes (#82 RAIL 5):

- **Artifact.** `run.sh install-copilot-receive` installs the receiver into the user
  extensions directory from an install-state file it owns, refuses a unit it did not
  put there, and removes only what that state names.
- **Identity.** The extension arms only when the CLI pid's sender marker, the V3 record
  and the SDK's `session.sessionId` all agree; a drifted id or a parent-pid carrier that
  disagrees with the real parent is a refusal, logged, never a best guess.
- **Liveness.** The marker's owner is the EXTENSION child — the process that actually
  holds the watch — so a crashed receiver stops being deliverable at the next start-key
  read, and the vendor's bootstrap already exits that child when the CLI goes.
- **Dispatch.** `wakeMode: self-fetch` puts Copilot on the existing mailbox rail. Armed
  and matching → enqueue + doorbell; anything else → `mailbox-undeliverable`.
- **The flag.** entwurf still does not own the operator's shell and writes nothing to it,
  but it owns ONE invocation: `entwurf copilot` execs the vendor CLI in the caller's own
  terminal with `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS` set for that process only,
  and refuses to launch at all unless the receiver unit it is promising is really
  installed. `doctor-copilot-receive` still reads the live CLI environments, because a
  session started any other way without the flag is silently inert. Plain `copilot` is
  untouched; running the managed form IS the consent to its profile (EXTENSIONS,
  `--model auto` when no model was given, `--yolo` when no explicit permission or surface
  policy flag was given).

The managed lane has now been accepted LIVE (2026-08-23, receipts in the matrix row
above), which is what moved receive from D0 to D6. What remains owed is still EVIDENCE,
not code: D3 isolation lost its decisive log to a scratch cleanup and is pending, and the
active-turn case, `/clear` re-arm and flag durability across vendor releases are
unmeasured. The hermetic gate drives the real installer and the real extension against a
stubbed SDK — it proves everything on entwurf's side of the fork and nothing about the
vendor turn on the other side of it, so a green gate is still not a wake.

The hidden `--ui-server` probe remains retired evidence, not a fallback. It found a real
idle-enqueue capability through an unauthenticated loopback door; the extension finds the
same class of capability through the CLI-owned stdio lifecycle. Absence of Claude's
`FileChanged` / `asyncRewake` / `watchPaths` therefore means only that Claude's hook
mechanism cannot be copied — it never proved Copilot had no vendor wake surface.

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
