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

**Vocabulary.** *Owned* in this file names entwurf ownership of a concrete invocation,
installer, or config writer. Historical receipts may say *managed* for that same ownership
axis; neither word is an admission grade or a synonym of *supported*. A pre-contract probe
can be owned without being supported; a supported harness still has to walk
[`docs/adding-a-harness.md`](./docs/adding-a-harness.md) step 9.

| Harness / surface | Product status | Capability | Transport and boundary |
|---|---|---|---|
| **pi native Entwurf** | shipped | D7; D8 partial | Record-addressed Unix control socket. A record-less socket is diagnostic only and never dispatched. |
| **Claude Code interactive `>=2.1.217`** | shipped; Linux certified | D6; D7/D8 partial | Per-session mailbox + exec-form `FileChanged`/`asyncRewake`. B2 proved idle wake and same-session continuity on one NixOS host. |
| **Antigravity / agy** | shipped | D6; D7 partial | Record-backed native-push through LS gRPC `agentapi send-message`; no mailbox or receiver marker. Admitted before the #82 step 9 contract and not re-evaluated under it, so it is legacy citizen evidence, not a step-9 supported harness: `entwurf_fresh_call` cannot open an agy sibling, and nothing here should be read as claiming visible lifecycle parity. |
| **Codex app-server-backed TUI** | verified probe | D7; D8 unproven | WebSocket-over-UDS `turn/start` into a live `threadId`; status events expose completion. No owned native-citizen install/invocation lane. |
| **Codex embedded TUI** | deferred | D0 partial | No supported receive socket/hook on the measured standalone shape. |
| **Copilot CLI first-party extension** | raw transport probe; superseded by the owned product unit | D7 path observed; D3 control receipt incomplete; D8 unproven | CLI-spawned extension over stdio JSON-RPC; `joinSession()` + documented `fs.watch` → `session.send({mode:"enqueue"})`. Idle wake, exact-marker reply, and completion passed on 2026-08-23 (CLI 1.0.80, L4, one Linux host). Two-process isolation was observed but its decisive B log was not preserved. Kept as the transport receipt the owned receive unit was built on; the shipped unit differs deliberately — it announces the inbox instead of injecting the body. |
| **Copilot CLI garden citizen** | shipped in 0.15.0; send + receive + visible fresh accepted on one host | D6; D7 partial; D3 pending; D8 unproven | Birth, garden id, MCP hand and record-backed sender identity are accepted; the RECEIVER is an installed first-party extension that binds to the V3 record, writes a receiver marker owned by the WATCHER pid, and rings a doorbell the model drains with `entwurf_inbox_read`. `wakeMode` is `self-fetch`, so dispatch reaches the mailbox rail: armed → delivered, unarmed/stale → the honest `mailbox-undeliverable` refusal. **D6 is the owned-invocation LIVE acceptance of 2026-08-23** — garden `20260823T181316-d9f6ba`, native `20fe30c8-b2bc-4600-91a0-8a409131be51`, CLI 1.0.80: receive log `joined`→`armed`→`doorbell fresh=1`→`rang`, mailbox `lastEnqueuedAt 09:23:41.235Z` / `lastReadAt 09:23:56.480Z`, and a model reply on the same record/native/gid chain. **Visible fresh (step 9 clause 7) is a separate LIVE, 2026-08-25** — launch window `@89`/`%89` nonce `mux-fresh-call-690529ae99f99faa2252aefb`; exact-callback garden `20260825T085721-f68be0`; one `entwurf_v2` → `meta-mailbox → enqueued`; same garden `lastReadAt 2026-08-24T23:57:47.784Z` plus same-gid reply; GLG saw footer garden id and a healthy multi-turn window. Those rows stay unmerged. D7 is PARTIAL: reply and read receipt were observed, the completion taxonomy and long-haul operation were not. D3 (second-session isolation of an owned invocation) is PENDING — observed once, decisive log lost to scratch cleanup. Evidence level L4: one host. Launch through the owned invocation `entwurf copilot`, which sets `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS` for that one process; `doctor-copilot-receive` reads live CLI environments because a session launched without it is silently inert. Visible fresh is operator-metered and is not a release-gate MUST. |
| **OMP (`omp`) garden citizen** | on the #87 branch at `7828bbc` (pushed; not landed on main); send + receive + visible fresh accepted on one host | D6; D3 proven; D7 partial; D8 partial | Two in-process extensions in the operator's own TUI: birth mints the `mode === "tui"` host (subagents mint nothing) and names it as sender; the RECEIVER unit joins that citizen in the SAME process, holds an `fs.watch` on its mailbox signal, and rings an announce-only doorbell through the vendor's `pi.sendUserMessage` — measured to be on the FACTORY object, not the event ctx, and measured to start a turn on an idle host with zero typing (`agent_start` +31ms). `wakeMode` is `self-fetch`: the model drains with `entwurf_inbox_read` and THAT read is the receipt. **D6 is the LIVE acceptance of 2026-08-30** (oracle, omp 18.0.0) — garden `20260830T140819-116f6a`, `lastEnqueuedAt 05:08:20.555Z` / `lastReadAt 05:08:23.958Z`, and the citizen's own transcript carrying `mcp__entwurf_bridge_entwurf_inbox_read` for its own garden id. **D3 is PROVEN, not pending**: with two live omp citizens armed, one addressed enqueue rang exactly one doorbell and the sibling persisted no transcript and kept an empty mailbox. D7 is PARTIAL (`lastReadAt` needs no scraping; the reply does). D8 is PARTIAL — dedupe and every stale-handling path are implemented and hermetically pinned, ordering/loop-guard/crash-recovery are not. The `/new` unarm is the rail-specific one: the watch lives in the operator's TUI, so pid + start-key cannot see a citizen change underneath a living process, and without an explicit unarm the previous garden id would keep reading deliverable. Requires `tools: xdev: false` in `~/.omp/agent/config.yml` — the vendor default hides MCP tool schemas from the prompt, so the doorbell would name a tool the model cannot call. The decisive receipt lines — the ordering probe, the D6 chain, the D3 isolation and the `/new` unarm — are pasted into `scripts/raw-omp-measure/README.md` §M7 rather than left in a host-local `/tmp` path. Evidence level L4: one Linux host, ARM. **Visible fresh (step 9) is ACCEPTED — the clause 7 LIVE went green on 2026-08-30:** `entwurf_fresh_call` opens omp on all three public surfaces through the bare `omp` runtime with an explicit `--approval-mode yolo` width and the `mcp__entwurf_bridge_entwurf_v` callback name, behind a five-axis pre-mutation preflight whose fifth axis is omp-specific (`tools.xdev !== true`, without which the model cannot call the callback tool at all). **The first turn is a TWO-STAGE BOOTSTRAP rather than a positional prompt, and that is a measured correction, not a preference.** `[LIVE 2026-08-30]` the positional-prompt candidate opened its window and minted its citizen (garden `20260830T181342-452167`, native `01a051f2-3107-7147-8806-fa2a6f527610`), delivered the byte-identical framing as a user message at `09:13:42.413Z`, and the model answered the literal text `ACK` at `09:13:47.105Z` with ZERO tool calls; the caller timed out at 240s. `[source]` the interactive UI defers MCP discovery (`sdk.ts:1847-1855`, `:1881-1905`) while the positional `initialMessage` prompts straight after `mode.init()` (`main.ts:540-565`), and `[측정]` an observer on the same runtime saw `turn_start` at +654ms with the entwurf tools absent and the callback tool present only at +1484ms. So the launcher now carries `{v,target,nonce,task}` on the fixed registered flag `--entwurf-bootstrap`, and the in-process birth extension polls `getAllTools`(`source:"mcp"`) AND `getActiveTools` for the exact callback name, sends a callback-ONLY prompt, arms the task only on a `tool_result` whose stored `toolCallId`, tool name, target, nonce and `isError === false` all match, and DELIVERS it at the next `turn_end` of that same session. `[LIVE 2026-08-30]` that last boundary is itself a measured correction: a first attempt sent the task from inside the `tool_result` handler with an explicit `deliverAs: "followUp"`, the hook log showed the full chain (`bootstrap-armed` → `bootstrap-ready` +440ms → `bootstrap-callback-observed` → `bootstrap-released`), and the task still never appeared in the session — `[source]` an explicit `deliverAs` queues without starting a turn in either state, while the omitted form starts one when idle (`agent-session.ts:6511-6513`), which the same transcript confirmed three seconds later when the Bundle B doorbell's omitted-option send landed and started a turn. `[측정 2026-08-30]` the callback-only half is what was proven to work: model `openai-codex/gpt-5.6-sol`, tool live at +1105ms, prompt injected at +1107ms, and the sibling calling `mcp__entwurf_bridge_entwurf_v` with the exact nonce (`omp-cb-btkvva4r87` → `20260830T184054-1aa1f2`, `meta-mailbox → enqueued`). **The clause 7 acceptance, `smoke-omp-fresh-live` (release-gate MUST), 2026-08-30, 21 assertions, omp 18.0.0 / `openai-codex/gpt-5.6-sol`:** launch through `tools/call entwurf_fresh_call` with nonce `mux-fresh-call-34faea228f3c3638684b40ff`; sibling garden `20260830T192913-df52b9` taken from the CALLBACK's sender envelope and never from the launch receipt; exactly one new citizen (§3.5); addressed `entwurf_v2` → `meta-mailbox → enqueued`; `lastEnqueuedAt 10:29:19.179Z` / `lastReadAt 10:29:24.673Z`; the drain visible in that session's own transcript for its own garden id. **Both bootstrap stages are in that transcript in order** — the callback-only prompt at offset 970, the caller's task at 4732, no four-backend positional framing anywhere, and an assistant message after the task proving it started a turn rather than sitting in a queue. The unit's own log carries the state machine: `bootstrap-armed 10:29:13.399Z` → `bootstrap-ready 10:29:13.819Z` (+420ms) → `bootstrap-callback-observed 10:29:18.663Z` (`toolCallId=call_KZJtkxfzy1IEE4ejKutCPWcm|fc_0858…`) → `bootstrap-released 10:29:18.731Z` → `bootstrap-task-sent 10:29:18.759Z`. Evidence level L4: one Linux host, ARM, one run. `check-harness-admission-parity` keeps the deterministic half of the admission from being a matter of memory. What this does NOT establish: multi-host, multi-model, or repeated fresh calls in one process. **Cross-harness leg, 2026-08-31 (first bidirectional live-turn roundtrip on the committed bytes + operator redeploy):** a claude-code citizen (`20260831T090152-f998ac`) opened a fresh omp sibling through the public surface (nonce `mux-fresh-call-807cb693b1913ce98ffdbfd1`, callback sender garden `20260831T124226-eac41a`), dispatched an addressed `entwurf_v2` → `meta-mailbox → enqueued`, and the omp citizen's own live turn drained and replied into the claude mailbox — its self-report (doorbell → `entwurf_inbox_read`; callback-only first user message, task second) agrees with every receipt on the chain. |
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

### Codex: launch mode is part of the capability

Do not describe “Codex” as one delivery shape. The measured app-server-backed TUI can
accept `turn/start` for a live thread and report completion; the standalone embedded
TUI exposed no equivalent receive route. This remains archived method evidence, not a
shipping commitment: GLG declined to own a native Codex invocation/install lane on 2026-08-01 because pi
already supplies the official GPT provider path. Entwurf will not duplicate it as a
native citizen or ACP backend. `turn/steer` is active-turn steering, not idle wake.

### Copilot CLI: one citizen, two rails, one pending receipt

The branch product owns the native citizen's birth, garden id, statusline, MCP hand,
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
