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
| `queued` | A receiver queue accepted the message; the backend may not have seen it. Durability is a property of the RAIL, not of this word — see the acceptance table below. |
| `triggered` | A supported event/API accepted the signal. |
| `woke` | An idle interactive session began a turn without user typing. |
| `injected` | The message reached model-visible context. |
| `processed` | A supported event says the turn completed. |
| `replied` | A result returned through an explicit garden-side path. |

Avoid bare `delivered`; name the observed boundary.

### Control-socket acceptance boundaries (#120)

A control-socket send answers with ONE of these, and the sender renders that word rather than the
internal route it took. They are not four spellings of success: they differ on every axis an
operator has to reason about.

| Boundary | Order | Durability | Visibility | Rejection |
|---|---|---|---|---|
| `sent` | n/a — the receiver was idle and the turn was TRIGGERED directly | none needed; the turn started | the turn is running, but the model has NOT necessarily read the text yet, and nothing here says the turn completed | an in-band refusal is `rejected`, never this |
| `queued-steer` | drained after each turn; overtakes every `queued-follow-up` already waiting | **none** — volatile receiver process memory | nothing shows it: it is not in the TUI's pending-message count | an abort clears the queue and the message is gone, silently |
| `queued-follow-up` | drained only when the receiver's inner loop ends; a steer arriving later still goes first | **none** — volatile receiver process memory | same: invisible in the receiver's own queue display | same: an abort drops it |
| `accepted-unknown-boundary` | unknown | unknown | unknown | the receiver ACCEPTED; this names our inability to classify its answer (version skew), and it must never be retried or rendered as `sent` |

`[측정 2026-09-22, pi-agent-core 0.87.0]` `dist/agent.js:60-71,96-97,137-138`
(two independent `one-at-a-time` queues, no FIFO between them)
and `dist/agent-loop.js:85,186,191-197`
(steering drained every turn, follow-ups only once the inner loop ends).

The **meta-mailbox** rail is the contrast, not a fifth boundary: it writes a durable `*.msg` before
ringing any doorbell, its filenames are ISO stamps so a drain is a global FIFO, an undrained inbox
is an honest `mailbox-undeliverable` refusal, and its receipt is that FILE. A mailbox enqueue is a
durable file receipt; a control-socket queue is process memory.

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

**Vocabulary.** *Owned* in this file names entwurf ownership of a concrete invocation,
installer, or config writer. Historical receipts may say *managed* for that same ownership
axis; neither word is an admission grade or a synonym of *supported*. A pre-contract probe
can be owned without being supported; a supported harness still has to walk
[`docs/adding-a-harness.md`](./docs/adding-a-harness.md) step 9.

Every row in this table is Linux evidence. macOS rails are NOT CERTIFIED — pending
physical host. Do not read a D-level cell as a Darwin receipt.

| Harness / surface | Product status | Capability | Transport and boundary |
|---|---|---|---|
| **pi native Entwurf** | shipped | D7; D8 partial | Record-addressed Unix control socket. A record-less socket is diagnostic only and never dispatched. |
| **Claude Code interactive `>=2.1.217`** | shipped; Linux certified | D6; D7/D8 partial | Per-session mailbox + exec-form `FileChanged`/`asyncRewake`. B2 proved idle wake and same-session continuity on one NixOS host. |
| **Antigravity / agy** | shipped | D6; D7 partial | Record-backed native-push through LS gRPC `agentapi send-message`; no mailbox or receiver marker. Admitted before the #82 step 9 contract and not re-evaluated under it, so it is legacy citizen evidence, not a step-9 supported harness: `entwurf_fresh_call` cannot open an agy sibling, and nothing here should be read as claiming visible lifecycle parity. |
| **Codex CLI app-server citizen** | supported in 0.21.0; caller-seat topology ACCEPTED on Linux at 0.153.4, 2026-09-16 (56 assertions, exit 0), and the caller-DIRECTORY axis ACCEPTED the same day on the same host (#95 lane C, 65 assertions, exit 0; the 2026-09-12 explicit-home acceptance is history — #95 D1 retired that room) | D6 accepted; D7 partial; D8 unproven | Vendor-trusted user-scope `SessionStart` birth plus strict per-request metadata join; no shared-pid sender marker. `thread/loaded/list` probes the operator-owned app-server UDS and one-shot `codex queue` delivers with no retry. The operator owns the app-server and seats it wherever they like; Entwurf creates, moves and supervises none of it. Since #95 lane B a Codex CALLER with no explicit placement opens its sibling beside its OWN pane, located by the `thread-id` its `[tui].terminal_title` writes into the pane title; 0 or 2+ matching panes refuse with no fallback, and the title is a placement input only — never an address, liveness or delivery fact. #95 D1 (2026-09-16) retired the fixed `codex` home that omitted-placement Codex TARGETS used to select, so an omitted seat is the caller's own session for every backend. Exact 0.153.4 source still bounds placing a sibling beside a TUI whose thread nobody named as unsupported; the anchor resolves only the pane showing the caller's own thread. |
| **Codex embedded TUI** | deferred | D0 partial | At the 2026-09-08 Codex 0.153.4 measurement, standalone mode had no `watchPaths`/`FileChanged`/`asyncRewake` analogue or supported idle receive route. This is dated vendor evidence, not a claim that the current candidate lacks records or fresh. |
| **Copilot CLI first-party extension** | raw transport probe; superseded by the owned product unit | D7 path observed; D3 control receipt incomplete; D8 unproven | CLI-spawned extension over stdio JSON-RPC; `joinSession()` + documented `fs.watch` → `session.send({mode:"enqueue"})`. Idle wake, exact-marker reply, and completion passed on 2026-08-23 (CLI 1.0.80, L4, one Linux host). Two-process isolation was observed but its decisive B log was not preserved. Kept as the transport receipt the owned receive unit was built on; the shipped unit differs deliberately — it announces the inbox instead of injecting the body. |
| **Copilot CLI garden citizen** | shipped in 0.15.0; send + receive + visible fresh accepted on one host | D6; D7 partial; D3 pending; D8 unproven | Birth, garden id, MCP hand and record-backed sender identity are accepted; the RECEIVER is an installed first-party extension that binds to the V3 record, writes a receiver marker owned by the WATCHER pid, and rings a doorbell the model drains with `entwurf_inbox_read`. `wakeMode` is `self-fetch`, so dispatch reaches the mailbox rail: armed → delivered, unarmed/stale → the honest `mailbox-undeliverable` refusal. **D6 is the owned-invocation LIVE acceptance of 2026-08-23** — garden `20260823T181316-d9f6ba`, native `20fe30c8-b2bc-4600-91a0-8a409131be51`, CLI 1.0.80: receive log `joined`→`armed`→`doorbell fresh=1`→`rang`, mailbox `lastEnqueuedAt 09:23:41.235Z` / `lastReadAt 09:23:56.480Z`, and a model reply on the same record/native/gid chain. **Visible fresh (step 9 clause 7) is a separate LIVE, 2026-08-25** — launch window `@89`/`%89` nonce `mux-fresh-call-690529ae99f99faa2252aefb`; exact-callback garden `20260825T085721-f68be0`; one `entwurf_v2` → `meta-mailbox → enqueued`; same garden `lastReadAt 2026-08-24T23:57:47.784Z` plus same-gid reply; GLG saw footer garden id and a healthy multi-turn window. Those rows stay unmerged. D7 is PARTIAL: reply and read receipt were observed, the completion taxonomy and long-haul operation were not. D3 (second-session isolation of an owned invocation) is PENDING — observed once, decisive log lost to scratch cleanup. Evidence level L4: one host. Launch through the owned invocation `entwurf copilot`, which sets `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS` for that one process; `doctor-copilot-receive` reads live CLI environments because a session launched without it is silently inert. Visible fresh is operator-metered and is not a release-gate MUST. |
| **OMP (`omp`) garden citizen** | shipped in 0.16.0; send + receive + visible fresh accepted on one host | D6; D3 proven; D7 partial; D8 partial | Two in-process extensions in the operator's own TUI: birth mints the `mode === "tui"` host (subagents mint nothing) and names it as sender; the RECEIVER unit joins that citizen in the SAME process, holds an `fs.watch` on its mailbox signal, and rings an announce-only doorbell through the vendor's `pi.sendUserMessage` — measured to be on the FACTORY object, not the event ctx, and measured to start a turn on an idle host with zero typing (`agent_start` +31ms). `wakeMode` is `self-fetch`: the model drains with `entwurf_inbox_read` and THAT read is the receipt. **D6 is the LIVE acceptance of 2026-08-30** (oracle, omp 18.0.0) — garden `20260830T140819-116f6a`, `lastEnqueuedAt 05:08:20.555Z` / `lastReadAt 05:08:23.958Z`, and the citizen's own transcript carrying `mcp__entwurf_bridge_entwurf_inbox_read` for its own garden id. **D3 is PROVEN, not pending**: with two live omp citizens armed, one addressed enqueue rang exactly one doorbell and the sibling persisted no transcript and kept an empty mailbox. D7 is PARTIAL (`lastReadAt` needs no scraping; the reply does). D8 is PARTIAL — dedupe and every stale-handling path are implemented and hermetically pinned, ordering/loop-guard/crash-recovery are not. The `/new` unarm is the rail-specific one: the watch lives in the operator's TUI, so pid + start-key cannot see a citizen change underneath a living process, and without an explicit unarm the previous garden id would keep reading deliverable. Requires `tools: xdev: false` in `~/.omp/agent/config.yml` — the vendor default hides MCP tool schemas from the prompt, so the doorbell would name a tool the model cannot call. The decisive receipt lines — the ordering probe, the D6 chain, the D3 isolation and the `/new` unarm — are pasted into `scripts/raw-omp-measure/README.md` §M7 rather than left in a host-local `/tmp` path. Evidence level L4: one Linux host, ARM. **Visible fresh (step 9) is ACCEPTED — the clause 7 LIVE went green on 2026-08-30:** `entwurf_fresh_call` opens omp on all three public surfaces through the bare `omp` runtime with an explicit `--approval-mode yolo` width and the `mcp__entwurf_bridge_entwurf_v` callback name, behind a five-axis pre-mutation preflight whose fifth axis is omp-specific (`tools.xdev !== true`, without which the model cannot call the callback tool at all). **The first turn is a TWO-STAGE BOOTSTRAP rather than a positional prompt, and that is a measured correction, not a preference.** `[LIVE 2026-08-30]` the positional-prompt candidate opened its window and minted its citizen (garden `20260830T181342-452167`, native `01a051f2-3107-7147-8806-fa2a6f527610`), delivered the byte-identical framing as a user message at `09:13:42.413Z`, and the model answered the literal text `ACK` at `09:13:47.105Z` with ZERO tool calls; the caller timed out at 240s. `[source]` the interactive UI defers MCP discovery (`sdk.ts:1847-1855`, `:1881-1905`) while the positional `initialMessage` prompts straight after `mode.init()` (`main.ts:540-565`), and `[측정]` an observer on the same runtime saw `turn_start` at +654ms with the entwurf tools absent and the callback tool present only at +1484ms. So the launcher now carries `{v,target,nonce,task}` on the fixed registered flag `--entwurf-bootstrap`, and the in-process birth extension polls `getAllTools`(`source:"mcp"`) AND `getActiveTools` for the exact callback name, sends a callback-ONLY prompt, arms the task only on a `tool_result` whose stored `toolCallId`, tool name, target, nonce and `isError === false` all match, and DELIVERS it at the next `turn_end` of that same session. `[LIVE 2026-08-30]` that last boundary is itself a measured correction: a first attempt sent the task from inside the `tool_result` handler with an explicit `deliverAs: "followUp"`, the hook log showed the full chain (`bootstrap-armed` → `bootstrap-ready` +440ms → `bootstrap-callback-observed` → `bootstrap-released`), and the task still never appeared in the session — `[source]` an explicit `deliverAs` queues without starting a turn in either state, while the omitted form starts one when idle (`agent-session.ts:6511-6513`), which the same transcript confirmed three seconds later when the Bundle B doorbell's omitted-option send landed and started a turn. `[측정 2026-08-30]` the callback-only half is what was proven to work: model `openai-codex/gpt-5.6-sol`, tool live at +1105ms, prompt injected at +1107ms, and the sibling calling `mcp__entwurf_bridge_entwurf_v` with the exact nonce (`omp-cb-btkvva4r87` → `20260830T184054-1aa1f2`, `meta-mailbox → enqueued`). **The clause 7 acceptance, `smoke-omp-fresh-live` (release-gate MUST), 2026-08-30, 21 assertions, omp 18.0.0 / `openai-codex/gpt-5.6-sol`:** launch through `tools/call entwurf_fresh_call` with nonce `mux-fresh-call-34faea228f3c3638684b40ff`; sibling garden `20260830T192913-df52b9` taken from the CALLBACK's sender envelope and never from the launch receipt; exactly one new citizen (§3.5); addressed `entwurf_v2` → `meta-mailbox → enqueued`; `lastEnqueuedAt 10:29:19.179Z` / `lastReadAt 10:29:24.673Z`; the drain visible in that session's own transcript for its own garden id. **Both bootstrap stages are in that transcript in order** — the callback-only prompt at offset 970, the caller's task at 4732, no four-backend positional framing anywhere, and an assistant message after the task proving it started a turn rather than sitting in a queue. The unit's own log carries the state machine: `bootstrap-armed 10:29:13.399Z` → `bootstrap-ready 10:29:13.819Z` (+420ms) → `bootstrap-callback-observed 10:29:18.663Z` (`toolCallId=call_KZJtkxfzy1IEE4ejKutCPWcm|fc_0858…`) → `bootstrap-released 10:29:18.731Z` → `bootstrap-task-sent 10:29:18.759Z`. Evidence level L4: one Linux host, ARM, one run. `check-harness-admission-parity` keeps the deterministic half of the admission from being a matter of memory. What this does NOT establish: multi-host, multi-model, or repeated fresh calls in one process. **Cross-harness leg, 2026-08-31 (first bidirectional live-turn roundtrip on the committed bytes + operator redeploy):** a claude-code citizen (`20260831T090152-f998ac`) opened a fresh omp sibling through the public surface (nonce `mux-fresh-call-807cb693b1913ce98ffdbfd1`, callback sender garden `20260831T124226-eac41a`), dispatched an addressed `entwurf_v2` → `meta-mailbox → enqueued`, and the omp citizen's own live turn drained and replied into the claude mailbox — its self-report (doorbell → `entwurf_inbox_read`; callback-only first user message, task second) agrees with every receipt on the chain. |
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

The owned bridge, statusline, and hook installers own separate configuration atoms.
Same-pid concurrent model invocation by multiple conversations is not claimed because
the pid/start-key sender marker would be last-writer-wins. Current operator checks are
in [BASELINE.md](./BASELINE.md); deterministic ownership and sender gates run in
`pnpm run check:full`.

### Codex: one app-server-backed native-push shape

Codex support is deliberately narrower than “drive Codex” and ships that way in
**0.21.0**. Its purpose is to keep the operator's real Codex session —
native tools, delegation, auth, transcript, and work context — addressable through
the app-server-backed shape measured at Codex CLI **0.153.4**. It is not ACP and does
not duplicate GPT access:

```text
operator starts app-server in existing exact tmux session `codex`
  → its configured MCP env_vars forward that home coordinate and explicit roots
  → visible codex TUI attaches with --remote unix://<default socket>
    → first turn runs the vendor-trusted user-scope SessionStart birth
      → V3 record(nativeSessionId = threadId)
      → thread/name/set(gardenId)
    → MCP tools/call carries strict request metadata
      → entwurf_self / entwurf_v2 resolve that exact record
```

The standalone embedded TUI remains outside this rail: the 2026-09-08 measurement
found no idle receive route equivalent to the app-server. `turn/steer` is active-turn
steering, not idle wake. Entwurf does not start, stop, supervise, or health-loop the
app-server. The operator starts it in a tmux session **of their own choosing**:

```bash
# Run from a pane in the operator-owned tmux session that will hold the app-server.
# For the LIVE acceptance that session must NOT be the one the Pi/Codex pair runs in.
entwurf codex-app-server
```

That verb owns the SPELLING of one vendor command and nothing else — it `exec`s
`codex app-server --listen "unix://$CODEX_HOME/app-server-control/app-server-control.sock"`
in the terminal it was typed in, after creating the control directory that address lives in.
It resolves the socket through the same leaf every other Codex surface reads, so the address a
consumer gets cannot drift from the one delivery looks for. There is no supervisor, no restart,
no daemon and no pid file: Ctrl-C is the operator's. A live socket, an unidentifiable one, or a
second `--listen` are named refusals; a dead socket file is reported and launched over. Passing
the raw vendor command by hand remains equivalent and is not deprecated.

#95 D1 (GLG, 2026-09-16) retired the requirement that this session be named `codex`, and with it the
rule that an omitted-placement Codex TARGET selected it. The operator still owns the app-server and
still chooses its room; Entwurf neither creates nor supervises it, and a missing app-server rejects.

Since #95 lane B the outbound direction no longer rides the app-server's inherited
`TMUX`/`TMUX_PANE`: a Codex CALLER with no explicit placement opens its sibling beside its own
pane, found by matching the caller's `_meta.threadId` against the `thread-id` the TUI writes
into that pane's title. Zero matching panes (`codex-caller-seat-unresolved`), two or more
(`codex-caller-seat-ambiguous`) and a caller whose `[tui].terminal_title` lacks `thread-id`
(`codex-caller-title-missing`) are all named refusals with no fallback seat. An attached TUI
still does not lend its pane to the server, and N arbitrary clients whose threads nobody named
still have no adjacency claim: the anchor resolves only the pane displaying the thread the
caller itself put on the request.

The seat order, for all five backends, and it follows the CALLER rather than what is being
opened: explicit `placement` wins; then a Codex CALLER's own pane (`codex-title-anchor`, no
session name on the receipt because a session was observed rather than requested); then the
caller's own session.

The DIRECTORY follows the caller the same way (#95 lane C, 2026-09-16): requested `cwd` wins;
then a Codex CALLER's own RECORD cwd, because this bridge is the app-server's MCP child and its
process directory is the app-server's rather than that caller's; then the launching process's
own, which is what tmux gives a window opened with no `-c`. Codex alone also carries that one
value into its argv as `-C <dir>`, and omitting it is a wrong answer rather than a neutral one:
an explicit `--remote` target takes its new thread's cwd from that override ALONE
(`codex-rs/tui/src/app_server_session.rs:2022-2033` at rust-v0.153.4), so without it the THREAD
opens in the app-server's repo while its pane sits elsewhere — measured on 2026-09-16 as three
citizens of one chain recording a directory none of them was in. The receipt names which rule
chose the directory (`requested` / the Codex caller's own record directory) and invents nothing
for the inherited case.

Four ownership atoms remain separate:

1. `entwurf install-codex-birth` owns **one `SessionStart` declaration inside**
   `$CODEX_HOME/hooks.json` — not the file — plus its launcher and import closure under
   `$XDG_DATA_HOME/entwurf/codex-birth`. The vendor keys trust per
   `<path>:<event>:<group>:<handler>`, so a neighbouring integration (Herdr's official Codex
   integration appends its own group) coexists: entwurf certifies the NORMALIZED digest and
   shape of its own group, requires it exactly once, reads the vendor receipt at the index that
   group was measured at, and reports every other group as present-but-foreign — certified by
   nothing, rewritten never. Install appends and uninstall splices by text, so a neighbour's
   bytes survive both unchanged. The ownership receipt is `codex-birth-install-state/v2`; a v1
   receipt (whole-file digest) is refused by name and superseded forward by one reinstall.
   No root: every path belongs to the operator. The vendor gates a user-layer declaration on
   ONE interactive "Trust all", which entwurf never answers, pre-seeds or computes; the
   receipt is read as its own doctor axis, and until it exists setup is honestly non-green.
2. `entwurf install-codex-mcp` owns `[mcp_servers.entwurf-bridge]` in
   `$CODEX_HOME/config.toml`, including exact `env_vars` forwarding for `CODEX_HOME`,
   Entwurf garden/control roots, and `TMUX`/`TMUX_PANE`. This explicit name boundary
   keeps custom roots and the app-server seat intact without storing their values.
3. `entwurf install-codex-statusline` owns only `thread-title` within
   `tui.status_line`. Birth calls `thread/name/set`, so the visible title is the garden id.
4. `entwurf install-codex-terminal-title` owns only `thread-id` within `tui.terminal_title`
   — a different key and a different axis from atom 3: `status_line` is what a human reads
   inside the TUI, `terminal_title` is what the multiplexer reports back as `#{pane_title}`
   and is the only value a caller seat can be matched against. The seeded list is
   `["activity", "project-name", "thread-id"]` (`activity` leads because the herdr Codex
   detector keys on the spinner/action-required prefix) and an existing operator list is
   appended to, never reordered. A tmux server with `allow-set-title off` replaces every pane
   title with the hostname, so the seat refuses there even with the atom installed — that is
   a repair condition the refusal names, not an inference this rail makes.

All four have state-backed doctors and inverses. Symlinked or foreign config is a
named refusal, not an adoption. Entwurf never installs Codex or its credentials.

Sender identity is request-scoped. The bridge requires the complete Codex metadata
tuple — `_meta.threadId`, `_meta.x-codex-turn-metadata.session_id`, and
`_meta.x-codex-turn-metadata.thread_id` — to agree, then joins that native id through
the addressable V3 record reader. Missing or conflicting fields refuse; there is no
parent-pid fallback. A complete pi env claim or other native claim must also agree.
This is load-bearing because every attached TUI shares the app-server ancestry.

The native-push adapter probes `thread/loaded/list`. A missing socket, malformed
handshake, protocol failure, or absent loaded target is `native-push-probe-indeterminate`
or dead as defined by the probe result; no mailbox fallback exists. Delivery uses the
measured one-shot `codex queue` command. Unlike Antigravity, Codex delivery has **zero
retry**: losing stdout after vendor acceptance must not replay the user's message.

Direct injection carries the **mailbox-serialized trusted sender envelope**, not the raw
message. This rail has neither the control socket's RPC framing nor a mailbox file, so the
envelope rides in the body through the same `formatMetaMailboxBody` SSOT the mailbox rail
uses — one rail for both native-push backends, no per-backend branch. It is rendered once,
before delivery, so Antigravity's one permitted re-probe retry replays byte-identical
content. A caller with no authoritative sender still injects the raw message; an envelope is
never fabricated. #95 measured the cost of the old raw behaviour: a fresh sibling's
nonce-only callback landed in a Codex thread as bare text, so the Codex citizen could not
name its caller and the callback was uncorrelatable.

Visible fresh runs:

```text
operator-owned tmux session A (any name — the operator seats it)
  operator-owned app-server + supported Codex TUIs
  codex --remote unix://<default socket> -C <launch directory> --model <explicit model>
        --dangerously-bypass-approvals-and-sandbox <callback-first prompt>
```

With `placement` omitted the seat follows the CALLER: a Codex citizen's own TUI pane, resolved from
the `thread-id` in that pane's title to a native `$id` before mutation, with 0 or 2+ matches refused
and no fallback; every other caller keeps caller-session default placement. An explicit seat remains
an expert override. The preflight must certify the state-backed birth closure digests, vendor trust
receipt, exact MCP/env boundary, `thread-title`, `terminal_title`, app-server socket, and a narrow LOCAL
read of the LAUNCH DIRECTORY's folder consent before tmux mutation — a guard on the cases the user
config decides, not a certification of the vendor's verdict. That last axis is the vendor's, not ours:
`[source rust-v0.153.4]` a `--remote` startup always runs `check_directory_trust` on the `-C` value
(`tui/src/lib.rs:1699-1725`) and nothing on that path reads the approval or sandbox policy
(`tui/src/onboarding/directory_trust.rs:33-130`), so
`--dangerously-bypass-approvals-and-sandbox` does not cover it — approvals and folder consent are
two different gates. A DIRECT decision is keyed to the exact directory: for `ProjectTrustHost::Remote` that lookup is
`vec![cwd_key]` alone (`tui/src/config_update.rs:290-296`), with no project-root marker, git root or
parent inheritance. An UNDECIDED directory renders a consent screen, and a TUI waiting on one has started no turn —
no rollout, no birth, no callback. Entwurf NOTES that as `codex-launch-cwd-undecided` and opens the
window anyway: the screen is self-repairing for the human this rail exists to put a window in front
of, and one answer teaches the vendor that directory for good. The unattended case is answered
where it belongs — `smoke-codex-fresh-live` asserts the same leaf up front, so a gate with nobody
at the keyboard reads a named precondition instead of a callback timeout. A directory the operator deliberately answered `untrusted`
is NOT refused: on a remote target the vendor skips that screen
(`onboarding/directory_trust.rs:94-96`; `uses_remote_workspace()` is `matches!(self, Self::Remote
{ .. })` at `tui/src/lib.rs:307-309`), so the turn starts and refusing it would be entwurf
inventing a policy the vendor does not have. A cwd INSIDE an explicitly `untrusted` project is a
third answer with its own reason, `codex-launch-cwd-untrusted-ancestor`: there the vendor returns
`pass the repository root explicitly with --cd` (`config_update.rs:357-371`) rather than a screen,
so answering a prompt at the child would only reproduce that error.

**The preflight leaf is narrower than the vendor's decision and does not claim otherwise.** It
reads one TOML file while the vendor reads a layered config through its app-server, where an
enabled project layer can consent with no entry at all (`config_update.rs:346-354`). Every case the
leaf cannot see resolves to "proceed", so it may fail to catch a hang but never refuses a launch
the vendor would have run. The callback spelling is `mcp__entwurf_bridge__entwurf_v2`; the new garden id
comes only from its sender envelope. There is no Codex resume, watcher, session/app-server creator,
or lifecycle supervisor.

The 2026-09-11 Linux run used Codex 0.153.4 and the default app-server: the production
probe found loaded thread `01a08bff-4efa-7071-9cac-b6d29da5f126`; native-push and a
public MCP `entwurf_v2` call woke its visible TUI; a real authenticated request returned
`agentId=meta-session/codex`, `replyable=true`; and a source birth hook minted garden
`20260911T005221-fc7c47` in an isolated store. Those receipts are preserved as
**pre-amendment focused delivery/identity evidence**, not qualification of the current
candidate.

The amended same-session acceptance (**A**) passed on local candidate `6e28c9e` at Codex
0.153.4. Receipt `.probe-artifacts/a95-live-20260911T162152-6e28c9e.log` (SHA-256
`e159f8fd1cf23cb1abd7782dc9e24cf9604add6b61ae24b7fd5260f16dfc2795`) records 50
assertions and exit 0: real initial Pi `20260911T162155-0db222` opened and addressed Codex
`20260911T162210-a974fe` / thread `01a08f58-588b-7620-a67c-cc0f6c62a79e`; Codex then
opened outbound Pi `20260911T162238-7dcdaa` and correlated its exact callback nonce and
sender garden id. The operator app-server, initial Pi, Codex, and outbound Pi all resolved to
tmux session `$158`. Cleanup removed only smoke windows `@355`, `@356`, and `@357`,
preserved all three records/transcripts, and left operator app-server PID `155166` and
`$158/@351/%351` alive.

That receipt established the mechanism of the now-selected deployment, but its initial Pi also sat
in the app-server session and predates the fixed-home default. The stronger explicit-home acceptance
passed on 2026-09-12, under the `codex` home topology #95 D1 later retired. Receipt
`.probe-artifacts/20260912T140745-codex-home-live-green.log`
(SHA-256 `09e79bd1b62962f8a11d647ee456a71b11965b6792c7972d97ac4992119c91d7`)
records 57 assertions and exit 0. The operator app-server stayed at `$158/@390/%390`; real initial Pi
`20260912T140748-355654` opened outside the home at `$150/@397`, omitted-placement Codex
`20260912T140800-8bc8d9` / thread `01a09403-e232-76b0-af9a-5cbaed8d94a9` opened at `$158/@398`,
and Codex opened outbound Pi `20260912T140829-a08178` at `$158/@399`. The callbacks preserved exact
nonces `mux-fresh-call-5d28f8e5bc2acf275ded30ec` and
`mux-fresh-call-7a5fb4960dbb172843eb14fe`; initial Pi → Codex reported
`entwurf_v2 native-push → delivered`, Codex read back its live garden-id title through `thread/read`,
and every smoke-owned window was removed while the operator app-server remained alive.

Two red attempts tightened the acceptance rather than weakening it. The first reached correct home
placement but Codex interpreted “wait” as `wait_agent(timeout_ms=3600000)`, leaving its first turn
active; the prompt now requires ending the turn and forbids every wait tool. The second proved that a
model may reformat a receipt while copying it. That accepted run still travelled coordinate reports
between citizens and checked them against Pi/Codex source results. A later prepare run exposed the
remaining flaw by truncating a report token: the amended gate removes intermediate model reports,
joins exact Pi toolCall/toolResult rows and structured Codex `thread/read` MCP items directly, and
reads garden ids only from raw callback events. Failure cleanup recovers the exact Codex thread from
its nonce callback, interrupts only its still-running smoke-owned turn, and closes only windows named
by joined source fresh-call results.

The amendment's own standalone acceptance then passed on 2026-09-12 (Codex 0.153.4): **48 assertions,
exit 0**, final source audit `initial-pi=3/3 completed exact` and `codex=3/3 completed exact`. Fixture
`20260912T232054-14c8e8` at `$150/@430`; initial Pi `20260912T232056-c0be9e` at `$150/@431`;
operator-owned app-server `1693273` at `$158/@390/%390`; omitted-placement Codex `20260912T232110-1cd889`
(thread `01a095fe-4f1a-7d93-8c5a-ed7539cf8930`) at `$158/@432`; Codex-opened Pi `20260912T232133-4ac684`
at `$158/@433`; final token `CODEX-PI-FINAL-6QWDSELJ` carried `PI_CALLBACK_FROM=20260912T232133-4ac684`,
`PI_SESSION_ID=$158`, `PI_WINDOW_ID=@433` into the fixture mailbox, which read it. Cleanup reclaimed
`@433`, `@432`, `@431` — every one named by a joined source fresh-call result, with no tmux inventory scan
and no mailbox prose promoted to authority. Artifact `.probe-artifacts/codex-fresh-live-fZccoK/`
(`run-manifest.json` sha256 `05f20f00…`). The 57-assertion first-admission receipt above is preserved as
its own pre-amendment axis; the two counts are different contracts, not a regression.

That run also closed a defect the amendment had introduced. A source path read once at callback
correlation froze out a record that gained `transcriptPath` 34s later, so the observer saw nothing while
the chain actually completed — the preceding red run's Codex thread holds a completed final `entwurf_v2`
result naming `PI_WINDOW_ID=@426`, and its two orphan windows were reclaimed only after their own joined
source receipts named them (`@425` backend codex from the initial Pi, `@426` backend pi from the Codex
thread; cleanup log preserved at `.probe-artifacts/codex-fresh-live-FblYLs/source-authorized-cleanup.log`,
sha256 `07fe18fc…`, alongside `run-manifest.json` sha256 `62a538fd…`). The path is now re-read while the
cache is empty. Note honestly what the green run does and does not prove: its manifest carries neither
`initialPiTranscriptResolvedLate` nor `sourcePathUnresolved`, so the late-write timing did not recur and
the repair is proven by its deterministic claim, not by this LIVE.

**Repeat acceptance inside the aggregate release gate (2026-09-13).** The same acceptance ran again as
the `smoke-codex-fresh-live` MUST step of `release-gate --cut` and passed at 48 assertions: fixture
`20260913T065136-59d143` at `$187/@442`, initial Pi `20260913T065138-ad5f57` at `$187/@447`,
omitted-placement Codex `20260913T065151-4b6078` (thread `01a0979a-edc4-7570-a29b-50f7e48cf298`) at
`$158/@448`, Codex-opened Pi `20260913T065213-0811e6` at `$158/@449`, against the same operator-owned
app-server at `$158/@390/%390`. Artifact `.probe-artifacts/codex-fresh-live-2oId4C/` (`run-manifest.json`
sha256 `2cff6f08…`). Note the fixture seat differs from the standalone run: the aggregate builds its own
tmux session (`$187`), while the Codex legs resolved to the exact `codex` home that was the contract
at the time. That gate reported
MUST PASS=24 FAIL=0 SKIP=0 and `cut: OK`. Keep the three Codex acceptances apart — 57-assertion
pre-amendment first admission, 48-assertion standalone amended (`fZccoK`), and this 48-assertion
aggregate repeat (`2oId4C`).

An earlier attempt at the identical source fingerprint failed two model-in-loop MUST steps and is kept
as an observation rather than a defect: a callback nonce arrived one character short and an addressed
instruction carried the wrong payload. Joined source receipts showed target, rail, and delivery were all
correct, so both oracles refused for the right reason and nothing in the product was changed.

**Caller-seat acceptance (#95 lane B), 2026-09-16, Codex 0.153.4 — 56 assertions, exit 0.** This is the
receipt for the topology that replaced the fixed home: `ENTWURF_CODEX_FRESH_MODEL=gpt-5.6-sol`,
`ENTWURF_CODEX_FRESH_PI_MODEL=openai-codex/gpt-5.6-luna`, final source audit `codex=3/3 completed exact`.
On one tmux server (`36728`) the operator-owned app-server `737636` stayed in ITS OWN session
A = `$30`/`@41`/`%45`, while all three smoke citizens opened in S = `$2`: initial Pi
`20260916T144205-e876ff` at `@46`, omitted-placement Codex `20260916T144230-d050d7` at `@47`, and the
Codex-opened outbound Pi at `@48`. **A ≠ S is what makes the run decisive rather than merely green:**
the app-server's inherited `TMUX` names A, so the pre-#95 environment fallback would have put that
outbound Pi there. It landed in S, and its receipt names the rule that chose the seat —
`seat: $2 (the Codex caller's own pane, found by its thread-id terminal title — an OBSERVED session,
not a requested name)`, recorded as `seat-source=codex-title-anchor`. Artifact
`.probe-artifacts/codex-fresh-live-nYcGC1/`, stdout preserved at `run-stdout.log`
(SHA-256 `ed60c2bdb46c13c51bf1d2dcf147b88c3c9f368a86a2bf17e972d3ecfde5fde9`). Cleanup reclaimed exactly
`@46`, `@47`, `@48` with no CLEANUP FAILURE, preserved every born record and transcript, and left the
app-server and `$30` untouched.

**Caller-directory acceptance (#95 lane C), 2026-09-16, Codex 0.153.4 — 65 assertions, exit 0.** Same
host, same models, same four-coordinate topology (app-server `737636` in A = `$30`/`@41`/`%45`; initial
Pi `20260916T154902-556eb5` at `$2`/`@58`, omitted-placement Codex `20260916T155037-10ddaa` at `$2`/`@59`,
Codex-opened outbound Pi `20260916T155102-9add8a` at `$2`/`@61` with `seat-source=codex-title-anchor`),
final source audit `initial-pi=3/3` and `codex=3/3 completed exact`. **65 and 56 are different
contracts, not a regression:** lane C added the cwd axis (seven assertions) and the pane-directory
reader it needs, on top of everything lane B already asserted.

The two decisive receipts, both measured against the app-server's own live directory
`/home/junghan/repos/gh/entwurf` (read from `/proc/737636/cwd`):

- **hop 1, cwd REQUESTED** (`8b-codex-thread-cwd`): the fresh Codex's pane `#{pane_current_path}`, the
  vendor's own rollout `session_meta.cwd`, its Entwurf record and the requested scratch are ONE
  directory — `/tmp/entwurf-codex-fresh-live-db65N2` — and it is not the app-server's. Four authorities
  that cannot borrow from each other; before `-C` the rollout carried the app-server's path while the
  pane sat in the scratch.
- **hop 2, cwd NOT REQUESTED** (`13b-outbound-pi-cwd`): the leg named neither placement nor cwd, and the
  outbound Pi still opened in `/tmp/entwurf-codex-fresh-live-db65N2` — its pane, its own birth-written
  record, and the Codex caller's record all agree. Its launch receipt names the rule rather than
  borrowing the other one's noun: `cwd: /tmp/entwurf-codex-fresh-live-db65N2 (the Codex caller's own
  record directory, used because no cwd was requested — not an observation)`, while both requested legs
  still read `requested start directory`.

Artifact `.probe-artifacts/codex-fresh-live-w4yJBw/` (run manifest, mailbox observations/selections and
a 13-file pre-cleanup snapshot including all three records, both Pi transcripts and the Codex rollout);
stdout preserved at `.probe-artifacts/lane-c-live-20260916T154900.log`
(SHA-256 `712050e7a8cf03ece98e7f34029ae98a92e9b2a7fd96aff87d0c1e6ba2ee9af2`). Cleanup reclaimed exactly
`@58`, `@59`, `@61` with no CLEANUP FAILURE, removed its own scratch and fixture record, preserved every
born citizen record and transcript, and left the app-server and `$30` untouched.

Two earlier attempts that day are kept as their own receipts, because each stopped at a different
truth. The FIRST stopped at 26 assertions, before any window opened: `codex-birth-unit-missing`, because
`~/.codex/hooks.json` carried a second `SessionStart` entry added after install, so the declaration no
longer matched its recorded digest. The unit was not broken — entwurf's own atom and all six helper
digests were intact — but this rail owns that file whole, and the preflight refused rather than run
against bytes it could not vouch for. The SECOND stopped at 43 assertions with hop 1 already green, and
its log is kept as the D1 measurement: `.probe-artifacts/codex-fresh-live-4aFCDD/run-stdout.log`
(SHA-256 `8392a603dcfe7e89549942d55e515f97724398fb261bd8873d25806f71086afe`) carries
`omitted placement opened fresh Codex in the caller's own session S, away from the app-server's A` —
the retirement of the fixed home, observed on a real host. It then failed on the gate's own defect
rather than the product's: the source-call oracle compared arguments with `isDeepStrictEqual`, so a
model that omitted the optional `wants_reply` instead of passing it explicitly read as drift. That
oracle now normalizes exactly that key to its schema default and nothing else.

Unrestricted attached-TUI parity (**B**) is explicitly outside this support claim. The exact vendor
checkout `rust-v0.153.4` at `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a` found no public
request→attached-TUI-seat carrier: process-local `ConnectionId` does not cross into thread/core/MCP/hook
state, and the TUI-local dynamic task MCP is a closed vendor namespace. That source result now bounds
the topology instead of blocking the explicit home. Manual pane/process guessing and hidden manager
behaviour remain invalid; explicit `placement.tmuxSession` is an operator-named expert override, not
an inferred seat. The gate strips ambient `PI_SESSION_ID`/`PI_AGENT_ID`; a fixture may preserve receipts
but cannot substitute for the initial visible record-backed Pi turn.

Run the clause-7 invocation from a tmux session OTHER than the app-server's own; the explicit app-server PID must belong to the operator-owned app-server, and that session's NAME is not a requirement — #95 D1 retired the fixed `codex` home on 2026-09-16, so A ≠ S is the precondition and no particular name is. Both models are explicit, and the launch directory must already be answered in this Codex (`VERIFY.md` owns the derivation and the one-time `Trust`):

```bash
LIVE=1 \
ENTWURF_CODEX_APP_SERVER_PID=<existing-app-server-pid> \
ENTWURF_CODEX_FRESH_MODEL=<codex-model> \
ENTWURF_CODEX_FRESH_PI_MODEL=<pi-model> \
./run.sh smoke-codex-fresh-live
```

This is the intended gate entrypoint, not acceptance by command name. The accepted receipt above
has a fixture only collecting evidence: a real visible record-backed Pi opens Codex from outside the
home, and the later exact callback and bidirectional delivery receipts close the topology claim.

### Copilot CLI: one citizen, two rails, one pending receipt

The shipped product owns the native citizen's birth, garden id, statusline, MCP hand,
outbound sender identity — and, since RAIL 5, the receiver. A real Copilot CLI 1.0.80
session minted a V3 record and sent under that record-backed garden id on 2026-08-21.
That proved who SENDS. Whether a reply LANDS is a different fact on a different process,
and the paragraphs below are the two halves of it: where the transport came from, and
what the owned product unit had to add before it could be dispatched to.

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
transport's authentication blocker does not apply. The owned product unit then took that
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
  untouched; running the owned invocation IS the consent to its profile (EXTENSIONS,
  `--model auto` when no model was given, `--yolo` when no explicit permission or surface
  policy flag was given).

The owned receive invocation has now been accepted LIVE (2026-08-23, receipts in the matrix row
above), which is what moved receive from D0 to D6. Visible fresh is a later, separate LIVE
(2026-08-25, same row) and does not reopen D3 or D8. What remains owed is still EVIDENCE,
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
