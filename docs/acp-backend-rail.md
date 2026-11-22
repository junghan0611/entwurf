# ACP backend adapter rail

The ACP plugin is one provider with backend adapters behind a common turn loop.
It is not a second harness and does not create another citizen or socket layer. The
host pi session already owns the record-backed citizen identity; each backend owns
its own process, auth, transcript, and native tool surface.

Claude is the reference adapter. Antigravity's own ACP server (`agy acp`) is a second adapter
behind three `agy-` rows (§Antigravity, #167), with the limits stated there. Cortex Code ACP is disabled: its retired model ids
are not registered and a direct selection refuses before launch, without a Claude fallback.
Existing Cortex settings, credentials and native citizen records are not removed.
Dated Cortex observations below are historical, not a current support claim.
Implementation history and audit chronology live in CHANGELOG, issues, and git.
What a complete ACP client must decide, and the state of each row in Entwurf, is the table in [acp-client-baseline.md](./acp-client-baseline.md) (#171).

## Boundary

| Layer | Owns |
|---|---|
| entwurf core | identity, facts, dispatch, rail choice, delivery evidence |
| ACP common loop | spawn, initialize, new session, model enforcement, prompt, event mapping, teardown |
| backend adapter | model routing, launch, overlay, carrier, backend settings, model enforcement details |
| backend runtime | credentials, subscription, transcript, native tools, native configuration semantics |

The common sequence is invariant:

```text
resolve adapter once
→ load backend settings and carrier
→ materialize backend overlay
→ spawn → initialize → newSession → enforceModel
→ prompt → event map → retain-or-teardown
```

No layer reconstructs a backend transcript, proxies credentials, scans ambient MCP
configuration, or grants tools through prose. Explicit `entwurfProvider.mcpServers`
and the callable schema are the tool truth.

## Adapter contract

Source of truth: `pi-extensions/lib/acp/backend-adapter.ts`.

| Method | Responsibility |
|---|---|
| `routeModel` | Claim a curated id and return the backend-native id. Zero or multiple owners fail loud. |
| `curatedModels` | Contribute rows to the single `entwurf` provider. Non-Claude backends use a reserved prefix. |
| `resolveAdapterSettings` | Parse only this backend's settings into an opaque value. |
| `resolveLaunch` | Return command/argv; honor only the backend's explicit override. |
| `launchEnvDefaults` | Supply static launch environment defaults. |
| `ensureOverlay` | Materialize session isolation and return spawn environment overrides. |
| `loadCarrier` | Return a short operator carrier or `null` when the backend has no carrier. |
| `buildSessionMeta` | Build optional `newSession._meta` from the already-loaded carrier. |
| `enforceModel` | Make the requested native model authoritative before the prompt. |
| `resolveThinking?` / `enforceThinking?` | Both or neither (#142): map pi's thinking level to the backend value or refuse by name before any spawn, then set it on the live session and read it back. Absent means the level is not carried. |
| `configSignatureFields` | Return a stable primitive map whose changes invalidate reuse. |
| `sealsTurnAccounting?` | Declare measured `usage_update` cost semantics so the common loop seals occupancy, per-turn cost and the turn aggregate (#93). Absent means nothing is sealed. |
| `summaryTurnMode?` | Declare how Pi's summary request runs (`"toolless"` — no tool surface in fact; `"execution-denied"` — tool schemas remain visible, isolated per-turn `v1:deny-all` hook blocks execution). Only modes in `ALLOWED_SUMMARY_TURN_MODES` are dispatched; absent or unknown refuses (`acp-summary-turn-unsupported`). |
| `readPromptRejection?` | Name a backend-owned typed prompt rejection and its fixed app-policy verdict; absent means the existing verbatim-first failure path. |
| `admitAgent?` | Admit the server that answered `initialize`, before any session (#168): its `agentInfo` must name the adapter's vendor at or above the adapter's floor; anything else — an absent `agentInfo` included — is a named refusal. Absent admits every server. |

`backend.ts` resolves the adapter once at turn entry. Common config never branches on
backend-specific keys; `adapterSettings` remains opaque until handed back to its owner.
A connection, model, carrier, MCP declaration, or overlay-relevant setting change must
change the reuse signature rather than mutate a live incompatible session.

**ACP rows run under a resident pi.** Reuse — the live ACP session kept across turns, each
later turn sending only the new user message — exists only in a pi process whose control
extension reports `--entwurf-control` as set (`entwurf pi` adds it). A pi whose reported run
mode is `print` or `json` (`pi -p`, `--mode json`, or redirected stdio) is a one-shot and
turn-scoped: its turn opens a new ACP session, sends the pi transcript rendered as one text
prompt, and tears the child down when the turn ends. Any other pi process — a plain
interactive `pi`, or RPC, without the flag — is unhosted: a conversation turn on an ACP row
stops with a fixed text that names `entwurf pi`, and no child is started (#171 decision 18;
before it, such a process opened a new vendor session on every turn). The one exception is
Pi's own stateless summary request (compaction and `/tree` summaries), which is classified
before this check and still runs on its isolated child. The split is `resolveLifecyclePolicy`
(`pi-extensions/lib/acp/session-store.ts`) over two reported facts
(`pi-extensions/lib/acp-host-facts.ts`): the control extension's parsed flag first, Pi's run
mode second. It never scans argv, so `pi -- --entwurf-control` (a prompt) is not a resident.
Nothing in a pi profile or AGENTS file changes it.

**What a rebuilt prompt carries (`context.ts`).** The rebuild is a TEXT rendering of pi's own
transcript, not a replay: user text, assistant text and tool results become `User:` /
`Assistant:` / `Tool result (…)` / `Tool error (…)` lines; assistant thinking, structured tool calls, the system
prompt and lifecycle notices are left out; an image becomes the marker `[image omitted: <mime>]`
on both the rebuild and the reuse delta. Because no path carries image bytes to the backend, every
curated Claude ACP row declares `input: ["text"]` (`ACP_ROW_INPUT` in `models.ts`,
`[QK:ACP-ROWS-TEXT-ONLY-INPUT]`), although pi's catalog lists the Anthropic models as
`["text", "image"]`: that is the model behind the API, not this transport. What pi does with an
attachment offered to a text-only row is pi's behaviour and is unmeasured here. Real image
passthrough is a separate decision ([#161](https://github.com/junghan0611/entwurf/issues/161)); a
row gains `image` only together with that path and its proof. A backend's own file tools (Claude's
Read on an image file) are a different surface and are not affected.

A streaming message begins with `stopReason: "pending"`. ACP's terminal set is mapped
explicitly: `end_turn → stop`, `max_tokens → length`, `cancelled → aborted`; refusal,
exhausted turn budget, unknown, and absent reasons end as errors. The original ACP
reason is preserved in `rawStopReason`. Returning to a default-success branch is a
contract violation.

### Prompt lifecycle — who may end a turn

Bootstrap (`initialize`, `newSession`, set-model) carries 30s wall-clock bounds: those
steps make no model progress, so a stuck one is a dead session. **The prompt carries
none.** A turn ends only on a lifecycle event:

| Ending | Behavior |
|---|---|
| the agent answers | mapped through the terminal set above |
| the operator aborts | ACP `session/cancel` first — the agent closes its own turn (`cancelled → aborted`); process-group teardown only after a bounded grace, so an abort always returns |
| the child dies / stdio ends | the turn fails naming the exit status and the session-scoped stderr tail — or an honest bounded absence when transport EOF wins the race — on both the new and the reuse path |

**What an abort leaves (#142).** After the turn has settled, the operator is told one of two
things: `[acp: stopped — changes already made stay; next message continues this session]` when
the agent closed the turn on `session/cancel`, a first turn included (#171 step 8), so the live
ACP session stays and the next message is a delta; or `[acp: stopped — changes already made stay;
the ACP process was closed]` after an escalation teardown or an abort before a first prompt was
sent. A resident's record stays either way, and no second session is opened for the conversation.
A one-shot rebuilds from the pi transcript, and that rebuild states the cut to the new session: an
assistant turn pi recorded as `aborted` is followed by one harness line, `[turn status: aborted —
actions this turn had started may already have taken effect; cancellation is
not rollback]`, and claims nothing about what ran (`context.ts` `ABORTED_TURN_STATUS`; a reused
session gets the user delta only). Neither notice rolls anything back, and neither speaks
for the private Claude transcript behind the live session. An abort while a reuse turn waits
for a changed effort's answer settles on the abort, not on the answer or the 30s bound; no
prompt is sent and the session is kept (#171 step 8). Gates:
`check-acp-set-model-readback` (`backend.thinking.test.ts`, QKs `ACP-THINKING-REUSE-ABORT`,
`ACP-CANCEL-NOTICE-REUSE-KEPT`, `ACP-CANCEL-NOTICE-NEW-KEPT`, `ACP-THINKING-REUSE-ABORT-LATE`;
`context.test.ts`, QKs `ACP-REBUILD-ABORTED-STATUS`, `ACP-REBUILD-ABORTED-EMPTY`).

Elapsed time is not evidence of failure, and a silent turn is not a failed turn: tool
use, reasoning, and provider queueing all legitimately outrun any number we could pick.
Suspected stalls are handled by exposing progress, never by a killing timer.

A prompt-phase failure message is also part of the contract. pi classifies a failed
assistant message by matching its text against `RETRYABLE_PROVIDER_ERROR_PATTERN`
(`@earendil-works/pi-ai` `utils/retry`), and a "transient" verdict makes it replay the
WHOLE prompt from a cold session up to `retry.maxRetries` times. Our own prompt-phase
text must never read as transient — that pairing (absolute cutoff × blind retry) is what
turned one long turn into four in 0.13.0. Gates: `check-acp-prompt-lifecycle` (behavior,
with pi's own classifier as the oracle), `check-probe-ordering` (no production prompt
cutoff in source).

### Upstream 0.106.0 cancel and effort contracts → this rail (#142)

Upstream tests read at immutable `v0.106.0` = `51f514d7` (source read, not executed here; its CI
runs `vitest run` without the two opt-in env flags below, so a file's presence is not a run).
**Scope** is the reach of the upstream contract: `common` when it is ACP turn/cancel behaviour any backend's adapter must settle, `Claude` when it rests on a Claude adapter field, env or config; a Claude n=1 or
a fixture is never inherited by another backend. **Status**: covered (a QK kills on it), open (our
touchpoint is reachable and unmeasured), not exposed (our surface cannot reach it — not a backlog,
and not proof the vendor can do nothing).

| Upstream contract | Scope | Our touchpoint and proof | Status |
|---|---|---|---|
| A running tool's interrupted result is delivered before `cancelled`, verbatim, `_meta.claudeCode.nonExecutionKind:"user-rejected"` ([incomplete-tools:764](https://github.com/agentclientprotocol/claude-agent-acp/blob/51f514d73c8bfd786979c84adb7a8517dbc22695/src/tests/v1/incomplete-tools.test.ts#L764-L780)) | Claude | rendered as `[tool:failed] …` text; a rebuild adds the `aborted` status line (`ACP-REBUILD-ABORTED-STATUS`/`-EMPTY`). Real n=1: the rejection was delivered while `start` was already on disk — the kind is not evidence of no effect | covered (fake) + n=1 |
| Results that arrive after the cancelled turn ended are dropped ([incomplete-tools:921](https://github.com/agentclientprotocol/claude-agent-acp/blob/51f514d73c8bfd786979c84adb7a8517dbc22695/src/tests/v1/incomplete-tools.test.ts#L921-L972)) | common | measured on a scripted partner (#142 private probe, n=1 per cell) with an update of the cancelled turn A on a KEPT session: (P1) before the next turn B starts there is no handler, so it is dropped; (P3) while B sets effort, before B's prompt is sent, a reuse turn now opens its stream only when its own prompt goes out, so the update is neither shown nor sealed as B's (`[QK:ACP-REUSE-LATE-UPDATE-PRE-PROMPT]`); (P2) once B's prompt is out, `session/update` carries no turn id, so routing cannot tell A's update from B's and relies on the adapter not speaking for a turn it already answered (this upstream contract; the real Claude producer is unmeasured here) — a local counter cannot restore an attribution the wire does not carry | P1 measured (private probe n=1, no QK) · P3 pre-prompt window measured → fixed · P2 upstream dependence, open |
| A tool that finished as the cancel landed is reported completed ([incomplete-tools:940](https://github.com/agentclientprotocol/claude-agent-acp/blob/51f514d73c8bfd786979c84adb7a8517dbc22695/src/tests/v1/incomplete-tools.test.ts#L940-L947)) | common | rendered `[tool:done]`; the turn still seals `aborted` | open — not measured cancel-specific |
| A background subagent keeps running past a foreground cancel ([incomplete-tools:822](https://github.com/agentclientprotocol/claude-agent-acp/blob/51f514d73c8bfd786979c84adb7a8517dbc22695/src/tests/v1/incomplete-tools.test.ts#L822-L833), [:974](https://github.com/agentclientprotocol/claude-agent-acp/blob/51f514d73c8bfd786979c84adb7a8517dbc22695/src/tests/v1/incomplete-tools.test.ts#L974)) | Claude | background tasks are off at launch (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, foreground-only lane) | not exposed |
| A queued prompt cancelled before insertion is removed from Claude Code's queue and never runs ([turn-events:312](https://github.com/agentclientprotocol/claude-agent-acp/blob/51f514d73c8bfd786979c84adb7a8517dbc22695/src/tests/v1/turn-events.test.ts#L312-L418)) | common | one prompt per session at a time (`inFlightKeys`); queueing is pi's (`PI-QUEUE-ABORT-DROPS-QUEUED`) | not exposed |
| A force-cancel while an update is being sent still ends the turn ([turn-events:419](https://github.com/agentclientprotocol/claude-agent-acp/blob/51f514d73c8bfd786979c84adb7a8517dbc22695/src/tests/v1/turn-events.test.ts#L419-L450)) | common | our own bound: `session/cancel` first, teardown after the grace (`ABORT-SENDS-PROTOCOL-CANCEL`, `ABORT-ESCALATION-BOUNDED`); a reuse turn the agent closes keeps its session (`ACP-REUSE-COOPERATIVE-CANCEL`, `ACP-CANCEL-NOTICE-REUSE-KEPT`) | covered for our own bound (fake), not upstream's internal force-cancel; n=1 settle 25–65 ms |
| Effort applies through flag settings, the answer carries `currentValue`, a rejected selection keeps the old state, `default` is `null`, no update notification ([session-config-options:552](https://github.com/agentclientprotocol/claude-agent-acp/blob/51f514d73c8bfd786979c84adb7a8517dbc22695/src/tests/v1/session-config-options.test.ts#L552-L655)) | Claude | set + read back, refusal fails before the prompt and drops a reused session (`ACP-CLAUDE-EFFORT-READBACK`); an abort while the answer is pending settles at once (`ACP-THINKING-REUSE-ABORT`, `-LATE` — beyond upstream). We never send `default`: no level refuses | covered (fake) + readback n=1 |
| A real Bash turn cancelled mid-sleep settles every announced tool call ([live-capability-session-audit:367](https://github.com/agentclientprotocol/claude-agent-acp/blob/51f514d73c8bfd786979c84adb7a8517dbc22695/src/tests/v1/live-capability-session-audit.test.ts#L367); opt-in `RUN_LIVE_CAPABILITY_AUDIT`) | Claude | our private ESC runs (reuse and first turn) also observe the file effect, the next input and the session kept/closed | open (LIVE n=1 each, #142; no fake QK) |
| Session load/resume lifecycle ([session-load:21](https://github.com/agentclientprotocol/claude-agent-acp/blob/51f514d73c8bfd786979c84adb7a8517dbc22695/src/tests/v1/session-load.test.ts#L21); opt-in `RUN_INTEGRATION_TESTS`) | common | persisted resume/load is off — bootstrap decides only `new`/`reuse` | not exposed (canonical resume after restart is separate design) |

### Typed Claude prompt rejection — no automatic whole-prompt replay (#127)

Claude ACP 0.85.1 can reject a prompt with the wire SDK's `RequestError`, code `-32603`,
`data.errorKind === "incomplete_tool_call"`, after marking unfinished foreground tools
failed. Some tools may already have run. This is an RPC failure, not a successful
`stopReason`, and a failed tool notification alone is not a turn settlement. The code
is JSON-RPC's internal error; the kind is Claude's extension vocabulary, not a standard
retry permission. AIR session-failure metadata remains capability-gated off: since #163 S8
entwurf declares only `clientCapabilities: { session: { compaction: {} } }`, and no AIR capability.

The Claude adapter reads one typed kind; the agy adapter (#167) reads every prompt-phase
failure (§Antigravity, Known limits). The common loop passes the once-resolved adapter at
the two turn catches only once the prompt is on the wire (`phase === "prompt"`), never for a
bootstrap failure, and skips this reader when the operator's abort wins. A recognized rejection seals once as
`error/error`, drops the new or reused session under the existing policy, and sets a
fixed semantic `errorMessage` which pi's real retry **and** overflow classifiers must
reject. No global retry disable, substring sanitizer, or new failure ledger is added.

The first raw failure remains in pi's existing `AssistantMessage.diagnostics`: original
name/message/stack/code, serialized data, and applicable stderr tail, lifecycle, launch
signal and overflow hint. None is remixed into the semantic verdict. Actual wire data
is parsed JSON; a hand-built non-wire value that cannot serialize gets an explicit
unserializable marker rather than escaping before the stream seal. Assistant content,
context replay and reuse signatures remain unchanged; persisted message JSON gains
these diagnostics. Cortex, other error kinds/codes, preprompt failures and aborts keep
the existing path. No warm reuse after this failure is newly claimed.

`check-acp-vendor-rejection` owns the source-adjacent adapter/pipeline assertions and
four defect mutants. Its real classifier oracles, raw positive controls, failed-tool
ordering, exact-once seal/drop, raw evidence and separate cooperative-cancel cells do
not certify a real vendor runtime. Target closure installation, focused receipts,
qualification, full floor and LIVE compatibility remain separate in the
[#127 thread](https://github.com/junghan0611/entwurf/issues/127).

## Support contract (#81)

What "supported" means here, per declaration class. The classes are kept apart on purpose: one
undifferentiated "supported" column is what let a Claude PASS read as if it also certified Cortex.
The rows are THIS checkout's declarations, not a shipped release: what a published version carried
is that version's CHANGELOG entry, and a candidate's own evidence is its issue thread, LIVE receipts
and exact-SHA CI. The pi row shipped in 0.30.0 (#125). The ACP wire SDK, Claude adapter and transitive Claude
Agent SDK rows are `0.109.0` / `2.8.0` / `0.3.328`, unreleased on this branch; the adapter was measured on
2026-11-21 in #171 step 7. The published 0.60.0 ships the #168 set `0.107.3` / `2.7.0` / `0.3.325`, and
0.55.0 and 0.55.1 ship `0.107.0` / `2.6.0` / `0.3.323` (`[측정 2026-11-21]` `git show <tag>:package.json`
and its lockfile). The published 0.53.1 ships `0.107.0` / `2.6.0` / `0.3.323` (`[측정 2026-11-14]` `git
show v0.53.1:package.json` and its lockfile): #142 landed `0.106.0` / `2.6.0` / `0.3.322` and #163 moved the adapter to `0.107.0`
and the transitive SDK to `0.3.323` (wire SDK unchanged). 0.53.0 carried the #142 set but was tagged
and never published to npm. Before that, 0.36.1–0.52.0 shipped `claude-agent-acp 0.90.0` /
`@agentclientprotocol/sdk 1.8.0` with the transitive `0.3.296` (CHANGELOG 0.36.1, #128; 0.38.0, #145,
changed only the pi SDK set); 0.31.0–0.36.0 shipped `0.85.1` / `1.6.0` and 0.30.0 shipped `0.79.0` /
`1.4.0` (`[측정 2026-10-16]` `git show <tag>:package.json`). The transitive row has no direct manifest
entry; its bumps are recorded in the ROADMAP Dep bump ledger.

| Surface | Declaration | Class | What a green actually says |
|---|---|---|---|
| Entwurf package | `package.json` `version` | checkout declaration, not a release receipt | names the package label these rows sit beside; whether that label shipped, and with which rows, is CHANGELOG's record |
| pi runtime | SDK exact `1.5.2`, host `>=1.5.2 <1.6` | **exact** oracle + **closed range** | the SDK set the published 0.52.0 and 0.53.1 ship (#158) and its derived host range (0.51.0 shipped SDK 1.5.0, #155), not an operating-host acceptance; an ordinary Pi host inside the range is accepted by the source's version predicate, and the ceiling moves only on measurement. The published 0.36.0 through 0.37.1 shipped the 1.2.0 set (#141); 0.38.0 (#145) is the first to carry 1.3.0. Historical: the published 0.33.0 through 0.35.1 ship SDK exact 1.1.0, 0.32.0 ships SDK exact 1.0.4 with the next-minor ceiling (ROADMAP's 2026-10-07 bump entry), and 0.31.0 declared the earlier peer floor 1.0.2 |
| ACP wire SDK | `@agentclientprotocol/sdk 2.8.0` | **exact** | the Claude wire oracle (protocol v1; the experimental `Usage` type comes from the `./unstable` entry); the adapter pins the same version, so both sides share one wire SDK |
| Claude ACP adapter | `@agentclientprotocol/claude-agent-acp 0.109.0` | **exact**, bundled | #171 bump over 0.107.3 (#168, published in 0.60.0; 0.107.0 shipped 0.53.1–0.55.1, #163; 0.90.0 shipped 0.36.1–0.52.0); a missing package fails at launch resolution, with no PATH fallback; the server that answers `initialize` is admitted only at or above this pin (`acp-claude-version-unsupported`, §Backend parity); declaration is not compatibility evidence |
| Claude Agent SDK | `0.3.328` (transitive) | **exact** oracle | the runtime risk surface behind the adapter |
| Anthropic SDK | `0.100.1` | **exact**, peer-resolution only | satisfies the Agent SDK peer floor (0.93.0+); never an API client here (gate L4) |
| Claude Code runtime | `>=2.1.306` (`entwurf.claudeCodeFloor`) | **floor** | below it, hook args are silently dropped; entwurf enforces this itself |
| Node | `>=24` (`engines.node`) | **floor** | single axis, derived everywhere else |
| Cortex Code | operator-installed CLI | **disabled** | No supported Cortex ACP model or turn; old host receipts remain historical. |

Historical host observation: **`Cortex Code v1.1.52` on `oracle` (2026-08-19)**.
It is not a current installation, support or LIVE certification claim.

Reading rules that do not bend:

- **Claude PASS never certifies Cortex, and an old Cortex SKIP never becomes a PASS.**
  Cortex ACP is now disabled; historical receipts remain bound to their own subjects.
- **Exact** means one measured build. **Range** means a closed accepted interval. **Floor** means a
  minimum entwurf enforces itself. **On-demand** means the operator supplies the runtime and the
  evidence names its version — presence of an adapter certifies no external release.
- A declared pin is not evidence. Package/deterministic gates bind the declarations
  (`check-dep-versions`, `check-acp-sdk-surface`, the pack/install consumer gates); LIVE gates carry
  the runtime claim.

### Minimum core value

One provider identity, `entwurf`, with model-id routing to backend adapters. The host pi session is
already the record-backed socket citizen; the ACP plugin mints no second citizen, socket, or peer
layer. Backend differences stay behind `adapterSettings` and adapter methods, and the turn sequence
stays backend-invariant.

Supported: one real model turn; curated routing with authoritative model enforcement; a narrow
callable tool surface; explicit MCP wiring including the entwurf bridge; session reuse with
delta-only user history; operator cancellation with bounded cleanup; honest terminal/error mapping.

Not supported, by design: workflow ownership, planner state, a memory DB, transcript hydration,
credential proxying, or a second harness inside pi.

### Capability posture

`clientCapabilities: { session: { compaction: {} } }` (since #163 S8; `{}` before it) is the support posture, not an
oversight: the one declared capability is the compaction contract (§11-8-a). Optional upstream features do not
become reachable merely because an adapter ships them — but they stay out of reach for **two
different reasons, and collapsing them would hide a real risk**:

- **Capability-gated.** AIR typed session failures, the 0.69.0 AIR file-change report, terminal
  output widgets and nested subagent transcripts each test a client capability entwurf does not
  send, so the adapter itself keeps the legacy path.
- **Advertised but never called.** Some surfaces carry no capability prerequisite at all — the
  `providers/list` / `providers/set` / `providers/disable` trio added in 0.70.0 is advertised
  unconditionally, and 0.71.0–0.73.0 add native subagents, async tasks, message-specific session
  forks, AI-generated session titles and permission-mode kinds on the same footing. 0.74.0–0.75.1
  extend the same list: the `authStatus` extension (0.75.0, #1080), Markdown-rendered usage
  statistics (0.75.0, #1085) and restored session forks (0.75.1, #1089). The `--hide-claude-auth`
  subscription refusal (0.74.0, #1079) is unreachable for a second reason — `[측정 2026-09-06]`
  entwurf passes that flag nowhere (repo grep, 0 hits). They are
  unreachable only because the common loop never invokes them (nor `logout`). Nothing upstream
  enforces that; it is our own call-site discipline, and it stops holding the moment we use one.
- **Advertised but never called — 0.76.0 adds exactly one.** Upstream #1111 puts a
  `recommendedValue` on AIR config options, and it is **opt-in**: the adapter turns it on only
  when `initialize`'s `clientCapabilities._meta.jetbrains.air.capabilities` names
  `recommendedValue`. entwurf declares no AIR capability (only `session.compaction`, since
  #163 S8), so `useRecommendedValue` is false on every branch. The label normalization, the `default` row and
  the effort selector that ride it are unreachable for a second, independent reason as well:
  `[측정 2026-09-10]` `git grep -c configOptions pi-extensions/lib/acp/` is **0**, and entwurf
  has never set `EFFORT_CONFIG_ID`, which is the other gate on the SDK-side `applyFlagSettings`.
  That second reason no longer holds from #142: entwurf now sets the `effort` config option on every
  Claude session (§Claude effort). `recommendedValue` itself stays unreachable through the empty
  `clientCapabilities`.
  The rest of 0.76.0 is one refactor: `resolveModelPreference` moved into a new
  `dist/session-model.*` (diff is comments and formatting), `dist/session-effort.*` is new, and
  `setSessionConfigOption` — our only model-forcing wire call — is byte-identical across
  `v0.75.1..v0.76.0`.
- **One 0.76.0 change has a reachable SHAPE and is still inert for us.** When
  `configuredSettings` is a STRING PATH, its `readFile` + `JSON.parse` moved out of
  `resolvedProvider` and up onto the unconditional `session/new` path. entwurf passes `settings`
  as an OBJECT (`tool-surface.ts:153`), so the branch is never taken. That makes "entwurf never
  hands `settings` as a path" a contract rather than an accident; it is stated at that call site.
- **Advertised but never called — 0.106.0 adds `session/options`** (#1592) and setup-request
  `configOptions`. entwurf calls neither; effort goes through `session/set_config_option` and its
  readback, because upstream skips a refused setup entry silently.
- **0.77.0's BREAKING change does not reach us, twice over.** `claudeCode.options.agent` is no
  longer forwarded — the adapter now shallow-copies the options object and `delete`s `agent` on
  the unconditional `session/new` path (`[측정 2026-09-18, 0.79.0 dist/acp-agent.js:5934-5941 직독]`).
  entwurf's `buildClaudeSessionMeta` never sets that key (`tool-surface.ts:145-199` 직독: the
  literal carries `model`/`tools`/`settingSources`/`settings` plus optional `plugins`/
  `disallowedTools`/`extraArgs`, and nothing else), and the removed agent-picker exports
  (`DEFAULT_AGENT_ID`, `AGENT_CONFIG_ID`, `BUILTIN_AGENT_NAMES`, `discoverCustomAgents`) are
  imported nowhere: `[측정 2026-09-18]` `git grep -c` over `pi-extensions/`, `test/`, `scripts/`,
  `mcp/` is **0**. We never imported the adapter as a library at all — we spawn its binary.
- **0.77.0's `allowDangerouslySkipPermissions` opt-out is a new lever we deliberately do not
  pull, and at 0.79.0 our effective permission mode was unchanged.** 0.76.0 sent
  `allowDangerouslySkipPermissions: ALLOW_BYPASS` unconditionally and computed
  `initialPermissionMode = creationOpts.permissionMode ?? resolvePermissionMode(settings…)`.
  0.79.0 computes `allowBypass = ALLOW_BYPASS && sessionMeta?.claudeCode?.options?.allowDangerouslySkipPermissions !== false`
  and routes the whole thing through `resolvePermissionMode(…, logger, allowBypass)`
  (`[측정 2026-09-18, 0.79.0 dist/acp-agent.js:5932-5933 직독]`). entwurf sets that option
  nowhere, so `undefined !== false` holds and `allowBypass === ALLOW_BYPASS`;
  `ALLOW_BYPASS = !IS_ROOT || !!process.env.IS_SANDBOX` is **byte-identical** between the two
  versions (`dist/permissions/modes.js` 직독). Our overlay pins
  `permissions.defaultMode: "bypassPermissions"` (`overlay.ts:124`), which resolves the same
  under both. The lever now EXISTS for a host that wants a non-bypass sibling; declaring it is a
  separate axis, not a one-line flip, and nothing in this bump takes it. That is the 0.79.0
  measurement; at 0.85.1 project or managed settings can drop bypass (the 0.79.0 → 0.85.1 entry
  below).
- **0.77.0's system-reminder strip never touches our first-user-message augment.**
  `INJECTED_CONTEXT_MARKERS = ["system-reminder"]` joins the local-command markers in
  `stripMarkerTags`, and `stripLocalCommandMetadata` has exactly two call sites
  (`[측정 2026-09-18, 0.79.0 dist/acp-agent.js grep -n]`): `:4129`, gated on the message content
  containing `<local-command-stdout>`, and `:5061`, in the `session/load` transcript replay. Both
  run agent→client on text coming BACK from the transcript; our augment rides client→agent on the
  first `session/prompt` and is never re-emitted, because entwurf calls `session/load` nowhere
  (`[측정 2026-09-18]` `git grep loadSession` in `pi-extensions/lib/acp/` hits only the
  `session-store.ts` capability TYPE, never a wire call). The augment also emits no
  `<system-reminder>` tag of its own (`augment.ts` 직독), so no prose of ours is strippable.
- **0.78.0's compaction update is a NEW `sessionUpdate` kind and is inert for us, twice over.**
  `compaction_update` and `compaction_summary_chunk` are new in `dist/context-compaction.js`
  (`[측정 2026-09-18]` `sessionUpdate: "…"` literal sweep across both dists: 0.76.0 has 15 distinct kinds,
  0.79.0 has 17, and the two new ones are exactly these). Gate one: the lifecycle's
  `presentation` is `clientSupportsCompactionUpdates(this.clientCapabilities) ? "compaction_update"
  : "tool_call"` (`dist/acp-agent.js:1875-1879`), and that predicate reads
  `capabilities?.session?.compaction` — entwurf sent `clientCapabilities: {}` then, so it kept
  the 0.75.0 `tool_call` presentation §11-8 measured. Since #163 S8 it declares
  `session.compaction` and takes `compaction_update` instead (§11-8-a). The replay path
  (`:5082`) is guarded by the same predicate at `:4915`. Gate two, independent: our mapper's
  update switch has a `default: break` — "unknown update kinds are ignored (forward-compatible)"
  (`event-mapper.ts:311-313`, `:377-378`). The "map every terminal reason, unknown is an error" rule
  is about ACP **stopReason**, a different axis; `stopReason` literals are unchanged across the
  two dists (`[측정 2026-09-18]` sweep: `"cancelled"` only, both versions). No code needed.
- **0.78.0's checkpoint file-change report and AIR diff counts are both behind the AIR gate.**
  `supportsAgentFileChangeReport` is `clientSupportsAirCapability(capabilities, "agentFileChangeReport")`
  (`dist/file-change-audit.js:27-29` 직독), and `air-extension.js`'s only delta is one added
  constant `AIR_DIFF_STATS_KEY` (full-file `diff`, one line). Same no-AIR-capability
  argument as the 0.76.0 `recommendedValue` entry — re-measured, not inherited.
- **0.79.0's shell-command permission prompts reach our permission handler's INPUT and change no
  decision.** The change reorders options: when the CLI hints `defaultToNo` (new in 0.79.0 —
  `[측정 2026-09-18]` `grep -rn defaultToNo` over the 0.76.0 dist is **0 hits**), the option array
  now sorts reject-first (`dist/permissions/options.js:5-10`). entwurf's approve-all policy
  selects `options.find((o) => o.kind === "allow_once" || o.kind === "allow_always")` and only
  falls back to `options[0]` when that find fails (`backend.ts:824-831`) — a find by KIND, so
  order cannot flip it. The fallback is unreachable besides: every builder in
  `dist/permissions/options/` routes through `withOptionalUpdate`/`withGeneratedUpdate`, both of
  which lead with `allowOnce()`, and the hand-rolled `tools.js` sets each carry an `allow_once` or
  `allow_always` (직독 of `shared.js` + `tools.js`). The title change (Bash/PowerShell titles now
  bypass `humanText` compaction) lands on a field we never read.
- **0.77.0–0.79.0's remaining fixes are unreachable under our capability posture.** The
  AskUserQuestion multi-select/custom-text fixes (#1031, #1131) require form elicitation:
  the adapter computes `disallowedTools = elicitationSupport.form ? [] : ["AskUserQuestion"]`
  from `clientCapabilities.elicitation.form`, which entwurf does not declare, so AskUserQuestion is
  disabled on every session we open. The TaskList regex fix (#1006) is internal parsing. #1128's
  tool names land on `presentation.toolCall._meta.claudeCode` on the permission-request path
  (`dist/acp-agent.js:5317-5325`), which our handler ignores; our `titleForTool` already read
  `_meta.claudeCode.toolName` as a fallback behind `update.title`, so it is additive at worst.
- **Our model-forcing and accounting wire calls are byte-identical across 0.76.0 → 0.79.0.**
  `[측정 2026-09-18, brace-matched extraction from both dists, md5]`: `setSessionConfigOption`
  (4,858 B, identical), `sessionUsage` (373 B, identical), `turnQuotaMeta` and `quotaTokenCount`
  (identical md5), and `resolveModelPreference` lives in `dist/session-model.js`, whose whole file
  is byte-identical (`md5 cfd031d0…` both versions). The `settings`-as-STRING-PATH branch our
  call-site contract names is still on the unconditional `session/new` path
  (`dist/acp-agent.js:6010-6012`).
- **0.79.0 → 0.85.1 (#127) is a source classification, not a runtime certification.**
  `[측정 2026-10-03, tag v0.85.1 = 686c0c99, src and dist read directly; nothing executed]`.
  Coordinates and evidence classes are in the ROADMAP Dep bump entry for 2026-10-03. The typed
  rejection above is the only failure-policy change Entwurf wrote for this bump. The reachable
  upstream changes below are classified, not new Entwurf contracts:
  - **Permission mode is conditional (#1165, reachable on a host/project basis).** The adapter
    builds its own `SettingsManager(params.cwd, …)` over `claudeConfigDir/settings.json`, the
    cwd's `.claude/settings.json` and `settings.local.json`, and the managed path, then calls
    `resolveSettings({ cwd })` without a `settingSources` argument. That call flow is separate
    from our SDK query's `settingSources: []` (`tool-surface.ts:152`). When those settings carry
    `disableBypassPermissionsMode: "disable"`, `allowBypass` drops, more permission requests reach
    our approve-all-by-kind handler, and `[permission:approved]` notices appear. The SDK's
    default `resolveSettings` source set is UNREAD, and no gate covers this case.
  - **Reachable, classified from source only.**
    - `createSession` starts a background `getContextUsage()` refresh (call at tag `85:8317`), and
      does so again after a model change. Upstream comments (`85:8301`, `85:8350-8352`) describe
      SDK control requests as serialized. The SDK internals are UNREAD, so whether our bounded
      set-model and early-abort grace queue behind it is a lead, and its timing is UNRUN.
    - A turn made only of `<synthetic>` frames emits no `usage_update` (#1132), and our
      keep-prior occupancy seals the prior value.
    - `tool_call_update` omits unchanged fields for every client (#1153). No producer was found
      that sends a pre-terminal `rawOutput.isError`, so a tool failure still arrives as
      `status: "failed"`.
    - #1216's `teardownSession` stops awaiting the interrupt reply. It is reached only
      indirectly, through dispose on stdin EOF or a signal: we never send `session/close`, and
      our `session/cancel` still awaits.
    - A sign-out during an unsettled turn fails it with `RequestError.authRequired()` and no
      extra message (#1179, tag `85:4420`). The stock text is the SDK default
      `Authentication required` (sdk 1.6.0 `jsonrpc.js:1032-1033`), and that message ALONE is not
      transient to pi's real classifier. The sealed legacy `errorMessage` also carries the
      stderr tail, lifecycle and hint (`backend.ts:1463-1490`), and a tail can still match the
      retry pattern. `[측정 2026-10-04, coordinator classifier probe]`: `"Authentication required"`
      → `retryable: false`; the same text plus `\n--- backend stderr (tail) ---\n500` →
      `retryable: true`. #127 does not sanitize this path and certifies no auth runtime.
    - The nine other vendor `internalError` sites keep the same legacy path. Their
      `Internal error:` prefix can match the classifier, and that pre-existing policy is
      unchanged here. This is a source and classifier reading, not a frequency claim and not a
      complete-callee identity claim.
  - **Capability-gated:** `notice`, the one new `sessionUpdate` literal (17 → 18 kinds).
  - **Ambient only:** `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2=1` selects a v1/v2 router. Entwurf
    neither sets nor scrubs it, and the router's v1 path for a v1 client is UNRUN.
  - **Entry identity is not settlement identity.** `newSession`, `prompt`,
    `setSessionConfigOption`, `requestPermission`, `closeSession`, `sessionUsage`,
    `turnQuotaMeta` and `quotaTokenCount` are byte-identical as extracted entry bodies. Turn
    settlement moved inside the changed `runConsumer`.

- **0.85.1 → 0.90.0 (#128) is a compatibility bump; Entwurf writes no new contract for it.**
  `[측정 2026-10-14; upstream compare 72 commits / 185 files read through the GitHub API; nothing
  executed but the readback below]`. The closure and evidence classes are in the ROADMAP Dep bump
  entry for 2026-10-14.
  - **Set-model readback re-measured, not inherited.** One no-prompt run against the installed
    0.90.0 through the production launch and overlay seam. On the wire: `initialize` ×1,
    `session/new` ×4, `session/set_config_option` ×3, no `session/prompt`, and no message,
    thought, tool, plan or usage update. Production `enforceModel` accepted all three curated
    ids with the 0.85.1 answers, so `CLAUDE_SET_MODEL_ALIAS_ROWS` is unchanged. The offered list
    grew from 12 to 13 rows: Fable 5.1 is now offered as the alias `fable` (the set answer still
    names its own `claude-fable-5-1` row), `haiku` is named `Haiku 5.5`, and
    `claude-haiku-4-5-20251001` is new. Offered rows are not Entwurf support: only the three
    curated ids (`model-ids.js`) were set and read back, and no other row is measured or
    admitted. The vendor's auth-status notifications and context probes are not model turns,
    and nothing here proves zero API calls; the billing rail is unmeasured.
  - **Evidence limits, stated before anything builds on this entry.** The readback followed the
    production launch and overlay seam only. Its session meta carried the model alone and
    omitted the production `settingSources: []` (`tool-surface.ts:152`), so it is not a full
    production-shape measurement. The focused green of `check-acp-{stop-reason,usage-accounting,
    prompt-lifecycle,stream-hooks,session-reuse}` at that point proved fake semantics only, not
    Rule 12 isolation: their `ensureOverlay` stub sat on deps, which backend never reads, so the
    real adapter refreshed the operator overlay. The earlier "no gate touches the operator
    overlay" claim is retired.
  - **Both limits repaired afterwards (2026-10-14).** The five gates now sandbox HOME, XDG and the
    pi agent dir before importing the compiled backend, assert that the overlay constant resolves
    inside that sandbox (`scripts/lib/acp-gate-home.ts`, paired mutant
    `ACP-GATE-HOME-SANDBOXED`), and no longer carry the dead stubs. A second single no-prompt run
    then built every session through the production path — `resolveProviderConfig` over explicit
    empty operator input, `loadCarrier`, `buildSessionMeta`, `enrichMcpServersWithEnvelope` — so
    each `session/new` carried `settingSources: []`, the default tools, the inline settings and
    the shipped carrier. On the wire: `initialize` ×1, `session/new` ×3, `session/set_config_option`
    ×3, seven responses, no `session/prompt` and no turn update. The three curated ids answered
    exactly as before. These are the shipped defaults; an operator's own settings were not
    measured.
  - **Two operating observations from that run, both with the cause unmeasured.** The overlay
    `projects/` held 524 entries after `ensureOverlay` and before the spawn, and 469 after the
    child group was reaped; the run itself deletes nothing there and left no entry for its
    scratch cwd. Which process removed the 55 entries, and whether they were transcripts, is not
    measured, and it is not claimed for earlier driver versions. Separately, the inbound wire tap
    saw one stream error event in a phase that was not recorded, while every request was
    answered and no line failed to parse. In the production-meta run the overlay `projects/`
    count stayed 469 → 469, which is consistent with the vendor skipping its retention sweep when
    `settingSources` is empty but does not establish that cause, and the one inbound-tap stream
    error fell in its teardown phase; that does not date the first run's.
  - **Permission options are unchanged.** The nine option builders under `permissions/` are
    byte-identical between the tags. `presentation.ts` adds titles only for v2 clients, and
    `exit-plan.ts` publishes the approved plan only behind the `plan` client capability; we
    advertise neither.
  - **Cancel and turn settlement are fixed upstream and compatible here.** The stop-reason set is
    unchanged; only `cancelled` gains emission sites (5 → 7), across #1228, #1229, #1242 and
    #1243 (0.86) and #1221, #1309, #1313 and #1327 (0.90). The typed `incomplete_tool_call`
    rejection keeps its kind and text. Our abort is still `session/cancel` → grace → teardown;
    the runtime effect of these fixes is UNRUN.
  - **Ambient only:** 0.90 merges model settings as `{...CLAUDE_MODEL_CONFIG, ...provided}`, so
    an ambient `CLAUDE_MODEL_CONFIG` can now shape the model rows. Entwurf neither sets nor
    scrubs it (the spawn env spreads `process.env`), the same posture as
    `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2`.
  - **Behind capabilities we do not advertise:** v2 router fixes, RFD subagents, the AIR session
    index and background terminals. Observation: a prompt that is exactly `/mcp` is answered by
    the agent (#1218); a new session's first prompt carries our augment ahead of the user text,
    a reuse turn does not.

- **0.90.0 → 0.106.0 (#142) moves the wire SDK a major and changes what reaches us as follows.**
  `[측정 2026-11-13, oracle aarch64, private candidate install, no session/prompt]` receipts are
  host-local under `.tmp-verify/acp106-readback-20261113/` (stage1 no-auth; stage2–4 authenticated
  through the production `ensureClaudeConfigOverlay(realDir, overlayDir)` whitelist into a sandbox
  overlay; account email redacted).
  - **Wire and launch.** The adapter depends on `@agentclientprotocol/sdk` 2.6.0 (major since 0.94);
    the client moves with it so the L2c shared-wire contract holds. Protocol stays v1: `initialize`
    answered `protocolVersion: 1`, `loadSession: true` and session capabilities `additionalDirectories,
    close, delete, fork, list, options, resume, status, systemPrompt, title`, plus
    `_meta.steering.supported`. 0.103.0 narrowed `exports` to `.` and `./package.json`; the production
    launcher anchors on `package.json` and imports the bin by file URL, so it booted 0.106.0 unchanged.
    Two LIVE probe scripts that deep-imported `dist/` were repointed the same way.
  - **Production `_meta` passes 0.100's request validation.** Three `session/new` calls carrying
    `model/tools/settingSources/settings/disallowedTools/extraArgs` and the shipped carrier succeeded.
  - **Initial config options** (0.106 #1592) arrive on `session/new`: `mode` = `bypassPermissions`
    (the overlay `defaultMode` still beats 0.101's built-in Auto default), `model`, `effort`
    (category `thought_level`, values `default, low, medium, high, xhigh, max`), `fast`, `ultracode`,
    and on a later session `agent`. `session/options` and setup-request `configOptions` are
    advertised but never called here; a refused setup entry is skipped silently upstream, so effort is
    set by `session/set_config_option` and read back instead.
  - **Model rows (authenticated).** `claude-opus-5-5` → `opus`/"Opus 5.5", `claude-sonnet-5-5` →
    `sonnet`/"Sonnet 5.5", `claude-fable-5-1` → its own row "Fable 5.1", `claude-fable-5-2` → its own
    row "Fable 5.2" (the alias `fable` also names Fable 5.2). Unauthenticated, setting a non-alias id
    fails `-32603` "Could not resolve authentication method", which is an auth fact, not support.
    The offered list is not stable inside one adapter process: 5 rows on the first sessions, 14 on a
    later one, and a later session listed `claude-fable-5-1[1m]` beside `claude-fable-5-2`. Only the
    set-model answers above are measured support; an offered row is not.
  - **Effort on a live session.** On one session `high → low → max` each read back exactly with the
    model unchanged; `minimal` was refused `-32602 Invalid params` and the session stayed usable.
    Readback is the adapter's acceptance, not evidence of applied reasoning depth.
  - **Idle compaction** (0.101 #1522) can send the adapter's own `/compact` prompt on an idle session
    (1h cache TTL, ≥100k–200k context, ~54 min idle). 0.106 #1555 makes the inline `settings`
    `idleCompaction` key win when no managed tier sets it. Our retained-session callbacks drop
    notifications that arrive with no active turn, so such a turn would be invisible to pi. Our
    inline `idleCompaction: false` is held only as a `_meta` shape (`ACP-CLAUDE-NO-IDLE-COMPACTION`);
    its runtime effect on an idle session is unmeasured, and a managed tier would win over it.
  - **Inert for us:** #1430 replays pre-compaction history on `session/load` (a client-view replay,
    not a prompt re-dispatch; we never call `session/load`); #1589 concerns the bun single-file
    release executable, not the npm dist we import; auth-status/account description changes are
    notifications we ignore. `bypassPermissions` also shadows `canUseTool`
    (`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` on stderr), so the permission callback is not a gate for
    ordinary tool calls; the declared `tools`/`disallowedTools` surface is.

- **0.107.0 → 0.107.3 (#168) moves the wire SDK a minor and changes one model-selection path.**
  `[측정 2026-11-17, laptop, isolated lab installs outside the checkout, raw JSON-RPC; receipts are
  host-local under ~/.local/share/entwurf-lab/168/claude-baseline/]`
  - **Wire.** `@agentclientprotocol/sdk` 2.6.0 → 2.7.0: `PROTOCOL_VERSION` 1, the exports map, the
    value exports, `./unstable` value exports and the method tables are unchanged; `Usage`,
    `UsageUpdate` and `PromptResponse` types are byte-identical. Transitive Claude Agent SDK
    0.3.323 → 0.3.325 (Claude Code 2.1.323 → 2.1.325).
  - **Unlisted model ids (#1630).** A set-model id that matches no offered row, exactly or fuzzily,
    now goes to Claude Code. An id it refuses is still `-32602`, with its reason appended
    (`… claude-opus-9-9. Model 'claude-opus-9-9' not found`); an id it accepts becomes the current
    value under its own id (`claude-fable-5-1` and `claude-opus-4-6` on a 5-row picker, refused at
    0.107.0), so our readback accepts it. Our router admits curated ids only, so this path is not
    reached by an Entwurf turn; the readback now certifies Claude Code's acceptance, not picker listing.
  - **Unchanged on the wire (both versions, same procedure):** opus/sonnet alias readback, effort
    `high`/`low` readback and `minimal` `-32602`, `_meta.steering.supported`, a mid-turn steer
    `injected` and an idle steer `promptRequired`, the `usage_update` / `PromptResponse.usage` /
    `_meta.quota` shapes and the `compaction_update` sequence. `v1/steering.js`,
    `context-compaction.js`, `idle-compaction.js` and `result-end.js` are byte-identical, and the
    `incomplete_tool_call` rejection block is unchanged. #1618 and #1632 are v2-only; a protocol-1
    client gets the v1 agent.
  - **Which Fable 5.2 row is offered depends on the session's own model.** A session created with
    `_meta.claudeCode.options.model = claude-fable-5-2` offers `claude-fable-5-2` and reads it back as
    its own row; a session created on another model offers the alias `fable` instead, and a set-model
    to `claude-fable-5-2` there is answered `fable` and refused. Production always creates the session
    on the requested id (`buildSessionMeta` sends it as `model`, and `nativeModelId` is in the reuse
    signature, `backend.ts:1917-1921`), so it takes the first path. `[측정 2026-11-17 laptop, 0.107.0
    and 0.107.3, no prompt, n=1 per cell, a fresh overlay per cell]`

- **The one 0.73.0 → 0.75.1 change that DOES reach us:** context compaction is now surfaced as a
  synthetic ACP tool lifecycle (0.75.0, #991) — a `tool_call` with `kind: "think"`, title
  `Compact conversation`, and `_meta.contextCompaction` schema v1 — where it used to arrive as
  assistant text. Our mapper routes every `tool_call`/`tool_call_update` through
  `renderToolUpdate` (`event-mapper.ts`), so this is not a type break; what changes is what an
  operator SEES in a compacting turn. See §11-8 for the measurement.

Adopting either class requires a separate observed need plus a complete rendering/lifecycle/evidence
contract. An optional upstream feature is not a core-value gap.

### Bump / defer rubric

`claude-agent-acp latest` is not a work queue. Certify when at least one holds:

- a turn/session/error path reachable under the default capability posture changes;
- the Claude Agent SDK, ACP SDK, peer resolution, pi floor, or backend process contract moves;
- a security, compatibility, or observed runtime defect requires the release;
- accumulated inactive minors are best folded into the next meaningful certification.

Otherwise record and defer. Every certification separates declared pins, deterministic/package
evidence and Claude LIVE aggregate evidence. Cortex ACP is disabled; its old LIVE observations
remain historical. Per-bump measurements live in the ROADMAP **Dep bump(별도 트랙)** ledger.

### Configured Claude ACP permissions

Source configuration, not a retirement LIVE receipt: `pi-extensions/lib/acp/overlay.ts` sets `permissions.defaultMode: "bypassPermissions"`, and `config.ts` includes `mcp__*` in the default `permissionAllow`. The configured Claude ACP child therefore does not supply a per-call permission prompt; these settings do not widen the explicit callable tool surface. `enrichMcpServersWithEnvelope` in `config.ts` injects the host Pi session's `PI_SESSION_ID` and the ACP agent label into the explicit entwurf-bridge stdio entry. If that bridge exposes `entwurf_retire_call`, a promptless call attributed to the host Pi citizen is consequently possible by source inference — ACP retirement through this path is unmeasured, not part of the ordinary Native Pi/Claude Code n=1 round trips. Neither those settings, annotations nor caller attribution is an operator grant: an explicit human request for that target/action and agent operating policy are still required. This describes existing configuration, not a new ACP retirement ban or permission mechanism.

### Bridge reachability is part of the contract

Explicit entwurf-bridge connectivity inside an ACP turn is core value, so it is measured rather than
assumed. `command -v` succeeding is not evidence: a launcher can resolve and still fail to exec (a
relocated package-manager shim deriving its target from `$0` exits 127), which leaves a turn with no
`mcp__entwurf-bridge__*` tool at all while every ownership check reads green. Both doctors therefore boot the exact configured stdio invocation — `command`, `args`, and
`env` — and require the full bridge verb set back over one shared leaf
(`./run.sh probe-bridge-command <cmd>` runs a simple command standalone; the agy doctor passes
its JSON invocation). The probe waits for a valid MCP `initialize` response before it sends
`notifications/initialized` and `tools/list`; a tools response alone is not boot evidence.

- **agy** probes every configured candidate invocation.
- **pi** probes every effective stdio invocation, including a legacy managed path or unowned
  override. Runtime truth says whether the command pi will launch works; ownership separately says
  whether entwurf may repair or normalize it.

entwurf never repairs a launcher it does not own — a foreign one is reported fail-loud with the
operator's repair named.

## Backend parity — what each adapter provides (#168)

Claude is the reference column (GLG, 2026-11-17). A new backend enters by filling one column. Each
cell is one of four answers, with its evidence: **provided**, **refused by name** (the refusal token),
**recorded limit** (the backend lacks the surface, or a measured cost stands), **unmeasured**. A
`[QK:…]` is a deterministic assertion and certifies the contract, not a vendor runtime; LIVE and wire
observations carry their date and count. agy wire facts are agy 1.5.9, `[측정 2026-11-16]`, from the
#167 measurement comments, unless a cell says otherwise. The initial comparison's source coordinates were read on
`168-acp-parity` at `7fa3f17d`; seats and coordinates added later in #168 refer to their named commits
or the current source, and earlier line numbers may have moved. "Common" means the behaviour is the common loop's, so the deterministic
proof is shared and only the wire facts differ per backend.

**Adapter seats.**

| Seat | Claude (reference) | agy |
|---|---|---|
| `routeModel` / `curatedModels` | **provided** — three unprefixed ids, anchor row first (`[QK:ACP-ROWS-ANCHOR-FIRST]`); the registered set `[QK:ACP-PROVIDER-CLAUDE-ONLY]` | **provided** — three `agy-` rows, prefix stripped, nothing else routes (`[QK:ACP-AGY-ROUTE-EXACT]`, `[QK:ACP-AGY-ROWS]`); cost 0 and window 1,048,576 from `usage_update.size` (`models.ts:190`, `:221`) |
| `resolveLaunch` | **provided** — bundled `claude-agent-acp` exact `0.109.0`; a missing package fails at launch resolution, with no PATH fallback; `CLAUDE_AGENT_ACP_COMMAND` override (`backend-adapter.ts:462-471`) | **provided** — `agy` from PATH (`agyAdapter.resolveLaunch`, `backend-adapter.ts:898-902`); the version is admitted at `initialize`, not at launch (`admitAgent`, floor `1.5.9`); `AGY_ACP_COMMAND` override owns the whole line (`[QK:ACP-AGY-LAUNCH-ARGV]`). **recorded limit**: PATH-resolved, no pinned path |
| `launchEnvDefaults` | **provided** — `CLAUDE_CONFIG_DIR` plus foreground-only work (`[QK:ACP-CLAUDE-FOREGROUND-ONLY]`) | **provided** — none; the overlay rides argv (`backend-adapter.ts:904-908`) |
| `resolveAdapterSettings` | **provided** — no own settings; `tools`, `disallowedTools`, `permissionAllow`, `settingSources` are common config (`backend-adapter.ts:597-602`) | **refused by name** for the three narrowing keys (`acp-agy-narrowing-unsupported`, `[QK:ACP-AGY-NARROWING-REFUSED]`); only the GLOBAL `skillPlugins` is read (`[QK:ACP-AGY-SKILLS-GLOBAL-ONLY]`) |
| `ensureOverlay` | **provided** — constant `CLAUDE_CONFIG_DIR` whitelist (`overlay.ts:146`); **recorded limit**: an overlay path that is itself a symlink is not refused (§Antigravity, Known limits) | **provided** — `--gemini-dir` state root with one linked token file (`[QK:ACP-AGY-OVERLAY-ONE-LINK]`, `-RELINK`, `-SWEEP`, `-REAL-DIRECTORY`); **recorded limit**: one overlay for every agy child, and a rule file a child writes there is loaded by later children |
| `loadCarrier` / `buildSessionMeta` | **provided** — engraving replaces the preset in `_meta.systemPrompt` (`[QK:CARRIER-META-SENDS-CARRIER-VERBATIM]`); tools, plugins, inline settings and the strict MCP config ride `_meta.claudeCode.options` (`tool-surface.ts:165-225`; the server list rides wire `mcpServers`) | **provided** — engraving APPENDED in `_meta.antigravity.systemPrompt.append` (`[QK:ACP-AGY-CARRIER-APPEND]`; an appended rule shaped the reply, n=1); nothing else rides `_meta` |
| `enforceModel` | **provided** — set-model answer read back against measured alias rows (`[QK:ACP-CLAUDE-SET-MODEL-READBACK]`, `[QK:ACP-CLAUDE-SET-MODEL-ALIAS-EXACT]`; authenticated no-prompt readback 0.106.0, 2026-11-13). Fable 5.2 reads back as its own row only on a session created with that model, which is the session production creates (0.107.0 and 0.107.3, 2026-11-17) | **provided** — answer read back, no alias rows (`[QK:ACP-AGY-SET-MODEL-READBACK]`); unoffered id `-32602 Unknown model ID` |
| `resolveThinking` / `enforceThinking` | **provided** — pi level → `effort`, set and read back (`[QK:ACP-CLAUDE-EFFORT-READBACK]`, `[QK:ACP-THINKING-NEW-SET]`, `-REUSE-SET`); no level refuses `acp-thinking-level-unsupported` (`[QK:ACP-CLAUDE-THINKING-REFUSE-UNMAPPED]`) | **provided** — pi level → `thought_level`, set after the model and read back, the vendor's silent clamp caught (`[QK:ACP-AGY-THOUGHT-RESOLVE]`, `-READBACK`, `-CLAMP`); the LIVE turn loop (n=1) showed the lifecycle and readback notices. pi's own clamp lands `off`/`minimal` on `low` and an unoffered `xhigh`/`max` on the row's highest level (`[QK:ACP-AGY-THINKING-MENU]`); only a level that bypasses that clamp refuses `acp-agy-thinking-level-unsupported` |
| `configSignatureFields` | **provided** — `{}` (`backend-adapter.ts:673-678`) | **provided** — `{ agyHookPolicy }`, the hook policy, so a resident child is not reused across a policy change (`agyAdapter.configSignatureFields`, `backend-adapter.ts:964-966`, `[QK:ACP-AGY-POLICY-SIGNATURE]`) |
| `sealsTurnAccounting` | **provided** (`backend-adapter.ts:686`) — see the accounting rows below | **recorded limit** — not declared (`[QK:ACP-AGY-NO-SEAL]`): `usage_update` carries no cost |
| `summaryTurnMode` | **provided** (`"toolless"`) — the summary child gets `tools: []`, no MCP, no plugin (`[QK:ACP-SUMMARY-TURN-TOOLLESS]`) | **provided** (`"execution-denied"`) — agy takes no tool list, so tool schemas stay visible; each summary turn runs in an isolated `0700` root (`~/.pi/agent/agy-summary/<turn>/{gemini,cwd}`) with `v1:deny-all` PreToolUse hook verified by byte readback before spawn, empty MCP/skills, and a neutral cwd whose resolved path must lie outside every git work tree for repository hooks to stay out (not checked, symlinks included) (`[QK:ACP-AGY-SUMMARY-EXECUTION-DENIED]`, `[QK:ACP-AGY-SUMMARY-ISOLATED-DIR]`, `[QK:ACP-AGY-HOOK-DENY-ALL]`). `AGY_ACP_COMMAND` override refuses summary turns by name (`acp-agy-summary-override-unsupported`, `[QK:ACP-AGY-SUMMARY-OVERRIDE-REFUSED]`). After confirmed child exit, only the isolated token symlink is unlinked; success removes `<turn>/`, failure preserves logs, unconfirmed exit touches nothing (`[QK:ACP-AGY-SUMMARY-CLEANUP-S3]`). Guarantee difference vs `"toolless"`: measured `Additional focus` temptation cost ~3× (31,045 vs ~10,300 tokens, n=1); summary text lives in Pi's compaction entry, so agy's turn copy is not Rule 8 memory |
| `readPromptRejection` | **provided** for one kind — `-32603` `incomplete_tool_call` seals a fixed verdict (`[QK:ACP-INCOMPLETE-TOOL-NO-REPLAY-NEW]`, `-REUSE`, `[QK:ACP-INCOMPLETE-TOOL-RAW-EVIDENCE]`); every other failure of a resident's prompt seals the fixed `unknown` stop with the raw failure in an `entwurf_acp_prompt_unknown` diagnostic (`[QK:ACP-UNKNOWN-FIXED-TEXT]`, #171 step 8); **recorded limit**: a one-shot keeps the verbatim path, whose text or stderr tail can read as transient to pi (§Support contract, 0.79.0 → 0.85.1) | **provided** as one verdict for every failure after the prompt is sent (`[QK:ACP-AGY-PROMPT-FAILURE-NO-REPLAY]`); bootstrap keeps the verbatim path (`[QK:ACP-AGY-BOOTSTRAP-FAILURE-VERBATIM]`). **recorded limit**: overflow, quota and login are not told apart — the raw failure and any overflow hint ride only `diagnostics` (`backend.ts:1754-1767`), so pi neither retries nor compacts. An empty, garbage or fake-expired token file fails at `session/new` with `-32000 Authentication required`, before any prompt — a bootstrap failure (#168, agy 1.5.9, 2026-11-17, n=1 each). **unmeasured**: agy's `session/prompt` wording for an exhausted quota, a login that expires mid-session, or an overflow |
| `admitAgent` | **provided** — `initialize.agentInfo` must name `@agentclientprotocol/claude-agent-acp` at or above the bundled pin `0.109.0`, an override launch included; otherwise `acp-claude-version-unsupported` (`[QK:ACP-CLAUDE-ADMIT-FLOOR]`, `[QK:ACP-CLAUDE-ADMIT-NAME]`; the floor equals the `package.json` pin, `[QK:ACP-CLAUDE-FLOOR-MATCHES-PIN]`) | **provided** — `initialize.agentInfo` must name `Antigravity ACP Server` at or above `1.5.9`, an `AGY_ACP_COMMAND` launch included; otherwise `acp-agy-version-unsupported` (`[QK:ACP-AGY-ADMIT-FLOOR]`, `[QK:ACP-AGY-ADMIT-NAME]`). LIVE n=1, 2026-11-17: the live 0.107.3 and 1.5.9 answers admitted, the live 0.107.3 answer with its version set to 0.107.2 refused (BASELINE). Both: refused after `initialize` and before `session/new` — no session, no set, no prompt, the child not kept — with text pi reads as neither transient nor overflow (`[QK:ACP-AGENT-ADMIT-BEFORE-SESSION]`, `[QK:ACP-AGENT-ADMIT-NOT-TRANSIENT]`) |

Admission is a floor. Attaching a stored session (`session/resume` or `session/load`) is a stricter, separate judgement: `attachAllowed` admits only the exact `measured` version of each pin, so a newer admitted server, an operator override included, stops the turn of a stored session by name until it is re-measured (V5 in [acp-client-baseline.md](./acp-client-baseline.md), #171). A resident resumes its recorded session under the same id with `session/resume` (`resumeAllowed`: the measured reader, and a writer version that reader was measured on), under a holder lease that a second Pi stops on (`holder-lease.ts`), and sends it only the inputs the Pi session's branch shows after the session's last answer (`branch-gate.ts`). An input of a prompt whose outcome is unknown is not sent to Claude twice and is sent to agy again, each as measured; `session/new` happens only as a birth (`[QK:ACP-ATTACH-SAME-ID-DELTA]`, `[QK:ACP-ATTACH-REFUSAL-KEEPS-RECORD]`, `[QK:ACP-ATTACH-HOLDER-STOPS]`, `[QK:ACP-DELTA-UNKNOWN-BY-ENTRY-ID]`).

In the thinking row: `medium` is offered on every Claude and agy row (`claudeAcpThinkingLevelMap` and
`agyThinkingLevelMap` in `models.ts`; `[QK:ACP-CLAUDE-THINKING-MENU]`, `[QK:ACP-AGY-THINKING-MENU]`), and agy's own
`thought_level` default is `medium` (#167). It is the cross-backend default (GLG, 2026-11-17) and the
level LIVE runs and measurements use.

**Common loop.**

| Function | Claude (reference) | agy |
|---|---|---|
| Session reuse (delta-only turns in a resident pi) | **provided** — common (`check-acp-session-reuse`) | **provided** — LIVE n=1 through the real turn loop (emitted build, sandbox HOME): turn 2 took `[acp: reusing live session]` and recalled turn 1 |
| Stop-reason mapping | **provided** — common (`[QK:STOP-ABSENT-NOT-SUCCESS]`, `[QK:STOP-REFUSAL-NOT-SUCCESS]`, `[QK:STOP-TURNBUDGET-NOT-SUCCESS]`, `[QK:STOP-UNKNOWN-NOT-SUCCESS]`, `[QK:STOP-RAW-PRESERVED]`) | **provided** — common; `end_turn` and `cancelled` observed on the wire, other reasons unmeasured |
| Abort, child death | **provided** — common (`[QK:ABORT-SENDS-PROTOCOL-CANCEL]`, `[QK:ABORT-ESCALATION-BOUNDED]`, `[QK:CHILD-EXIT-DIAGNOSED]`); ESC LIVE n=1 each (#142) | **provided** — common; raw driver n=1: `session/cancel` during a command answered `cancelled` in 6 ms, the tool settled `failed`. An abort through the turn loop is **unmeasured** |
| Tool narrowing (`tools`, `disallowedTools`, `permissionAllow`) | **provided** — `tools` and `disallowedTools` in the session meta are the gate; `bypassPermissions` shadows the permission callback (§Support contract, 0.90.0 → 0.106.0) | **refused by name** — `acp-agy-narrowing-unsupported` (`[QK:ACP-AGY-NARROWING-REFUSED]`). A vendor seat exists — a `PreToolUse` hook matcher selects by agy's exact tool name (`invoke_subagent\|schedule` fired for those two tools only; #168, agy 1.5.9, 2026-11-17, n=1) — but a child with a shell rewrote its own seat and reopened a denied tool (#168 C2b, n=1), so a narrowing built on it could be undone by the child. The refusal stays, and narrowing is not implemented until agy offers a tool restriction the child cannot rewrite (SOL, 2026-11-17) |
| Permission posture | **provided** — overlay `bypassPermissions` (`overlay.ts:124`) over the declared surface; a request that still arrives is approved by kind (`backend.ts:1052`); project or managed settings can drop bypass (§Support contract, 0.79.0 → 0.85.1) | **recorded limit** — `--dangerously-skip-permissions` (`agyLaunchArgs`): no `session/request_permission` is sent, and every native tool runs unasked, sub-agent, workflow and web-search tools included (GLG deferred reducing it, 2026-11-16). Without the flag agy asks `allow_once` / `reject_once`, and that does not bound the surface: a write under the system temp dir and `search_web` ran unasked, `invoke_subagent` and `schedule` started unasked, and settings `permissions.deny` had no effect in three seats (agy logged `Unknown field "permissions"`) (#168, agy 1.5.9, 2026-11-17, n=1 per tool). A `PreToolUse` hook answering `deny` stopped all seven probed tools, with or without the flag. A hook denied when it was missing, exited non-zero, printed non-JSON or timed out (on `run_command`; missing, non-zero and timeout also on `invoke_subagent` and `schedule`, with no hidden model call); one that exits 0 with nothing on stdout **allows**, and a broken or empty `hooks.json` loads no hook (n=1 each). A best-effort default, not a guarantee: the overlay's PreToolUse hook denies the three tools measured to start model turns with no ACP frame — `invoke_subagent`, `schedule`, `run_workflow` — and allows the rest (`v1:hidden-turns`, `[QK:ACP-AGY-HOOK-DECISION]`; §Antigravity, Known limits) |
| Hooks | **provided** — configured-empty `hooks` in the overlay settings (`overlay.ts:121`), and project hooks excluded (`settingSources: []`, `config.ts:510`) | **provided** — one overlay PreToolUse hook (`<overlay>/config/hooks.json`, `[QK:ACP-AGY-HOOKS-SEAT-WRITTEN]`); **recorded limit** — agy loads `<cwd>/.agents/hooks.json` regardless (#168 O3), and no measured surface stops it (#168 W: `--include-default-customizations=false`, `--sandbox`, `trustedWorkspaces`, the repository only in `additionalDirectories`) |
| Exclude-tools preflight | **provided** — common; the configured `tools` decide which built-ins the child still has (`tool-surface.ts:100-118`, `[QK:ACP-PREFLIGHT-REPLAYS-TRANSCRIPT-TOOLS]`) | **provided** — common; agy is assumed to expose the full native set, so excluding a pi built-in refuses |
| Explicit MCP wiring | **provided** — wire `mcpServers` | **provided** — wire `mcpServers`, tools spelled `mcp_<server>_<tool>`; fresh-call LIVE n=1 called `…_entwurf_callback` and `…_entwurf_v2` |
| Skills | **provided** — `skillPlugins` (global and project) become `plugins` (`tool-surface.ts:207-209`) | **provided** for the global list (`[QK:ACP-AGY-SKILLS-PROJECTED]`, `-RETRACTED`, `-COLLISION`); **recorded limit**: a project-only list reaches no agy child, with no notice |
| Rule files and `settingSources` | **provided** — `settingSources: []`, so no CLAUDE.md is read; the first-user augment carries cwd `AGENTS.md` and `~/AGENTS.md` | **recorded limit** — `settingSources` is a Claude-only seat and is ignored; agy loads cwd and repository-root `AGENTS.md`/`GEMINI.md` itself, so the augment drops the cwd copy (`[QK:ACP-AGY-AUGMENT-CWD-AGENTS-DROPPED]`); with the cwd at home `~/AGENTS.md` arrives twice |
| Tool start/done lines | **provided** — common `renderToolUpdate` | **provided** — one `tool_call` and one terminal `tool_call_update` per call; LIVE pane n=1 showed both lines |
| Running tool: title line and elapsed beat (#162, #163 M1) | **provided** — title-only update (`[QK:ACP-TOOL-TITLE-SHOWN]`) and `_meta.claudeCode.toolResponse.elapsedTimeSeconds` beats (`event-mapper.test.ts:93`, measured 0.106.0) | **recorded limit** — no mid-flight frame: a 10 s command sent two frames, start and end, and nothing in between, so there is no frame to show. A 70 s command sent `tool_call in_progress` and nothing more for that tool: at the `WaitMsBeforeAsync` cap (10000 ms) it moved to a background task and the turn ended `end_turn` with the tool still `in_progress` (#168, agy 1.5.9, 2026-11-17, n=1); the beat reader is also `_meta.claudeCode`-only (`event-mapper.ts:299-303`), which changes nothing while agy sends no mid-flight frame |
| Finished-tool output preview (#163 M2) | **provided** — `[QK:ACP-TOOL-OUTPUT-PREVIEW]`, `-FAILURE-TAIL`, `-BOUNDED` | **unmeasured** end to end. The wire shape is measured (#168, agy 1.5.9, 2026-11-17, n=1): a completed `run_command` `tool_call_update` carries `rawOutput: {output, exit_code}` and `content: [{type: "content", content: {type: "text", text}}]` with the same text, and no `_meta`; a hook-denied call carries `rawOutput: {output: ""}` and empty text. By reading, the preview takes no text from that `rawOutput` and falls back to `content` (`event-mapper.ts:368`, the `type: "content"` branch of `firstTextItem`), so its first line is agy's `Created At:` header rather than the command's output — not run through the mapper. A hook's deny `reason` is not in the frame; it reaches the model, whose next reply quoted `tool call denied by pre-tool hook: <reason>` (n=1) |
| Thinking stream | **provided** — `agent_thought_chunk` → a thinking block (`event-mapper.ts:557-566`) | **unmeasured** — the common mapper would render it (`event-mapper.ts:557-566`); no #167 receipt shows agy sending `agent_thought_chunk` at any level (measurements ran at `low`) |
| Context occupancy (`usage.totalTokens` ← `usage_update.used`) | **provided** — sealed (`[QK:ACP-CONTEXT-OCCUPANCY-PRESERVED]`) | **provided** — the common mapper writes `used` (`event-mapper.ts:583-585`); `used` is occupancy (8887 → 8993 in a one-tool turn whose `PromptResponse.usage.totalTokens` was 17880) |
| Occupancy carried across a turn with no `used` | **provided** — `[QK:ACP-CONTEXT-OCCUPANCY-CARRIED]` (`backend.ts:1538-1542`) | **recorded limit** — not carried: the seal returns first (`backend.ts:1466`), so such a turn seals `totalTokens` 0. Pi 1.5.2 skips a zero-usage message and estimates from the last valid usage plus the trailing messages (`compaction.js:72-83`, `:110-135`; `agent-session.js:2577-2595`); measured with that function, a turn after `used` 8993 reads 8993 plus Pi's estimate of the trailing messages (9044 in one probe), where a carry would read 8993. agy sends `used` on every model round trip; `used: 0` arrives only after `session/new` (and a model or thinking change), not at the start of a reuse turn. A `session/cancel` 150 ms into a reuse prompt answered `cancelled` 3 ms later with no `usage_update` (#168, agy 1.5.9, 2026-11-17, n=1) — a turn with no `used`, observed: it seals `totalTokens` 0 on this row, and Pi's estimate above skips that zero-usage message, so the cancelled turn does not reset Pi's occupancy reading. A turn left with only a turn-start `used: 0` seals 0 on Claude too (`backend.ts:1538-1539`), so that case is not agy's |
| Turn aggregate on `usage.acp` | **provided** — `[QK:ACP-TURN-ACCOUNTING-ATTACHED]`, wide rows preferred (`[QK:ACP-ACCOUNTING-PREFERS-WIDEST]`) | **recorded limit** — not relayed (`backend.ts:1466` precedes `:1484-1488`), although `PromptResponse.usage` arrives and was a round-trip sum (n=1). No reader in this repository consumes `usage.acp` |
| Per-turn cost | **provided** — adjacent diff of the session estimate (`[QK:ACP-TURN-COST-SUM-MATCHES-SDK]`, `[QK:ACP-COST-BASELINE-HELD-WHEN-MISSING]`) | **recorded limit** — the wire carries no cost; the row price is 0 |
| Cache-miss notice | **provided** — `[QK:ACP-CACHE-REBILL-REPORTED]`; the bound rests on a recurrence observed for Claude Code alone | **recorded limit** — no cost and no measured recurrence |
| Remote steer inside a turn (#163 S7) | **provided** — `_session/steering` behind `_meta.steering.supported` (`[QK:ACP-STEER-CAPABILITY-GATED]`; adapter direct n=24) | **recorded limit** — initialize advertises no steering and `_session/steering` is `-32601`, so a steer waits in Pi's queue. A second `session/prompt` during a running tool turn is not a steer: it preempts. The first prompt resolved `end_turn` 10 ms after the second arrived, with no text; its running `run_command` never settled and its effect never happened within the observed window; the second began at the tool's `WaitMsBeforeAsync` boundary and answered normally (#168, agy 1.5.9, 2026-11-17, n=1). That `end_turn` cannot be told apart from a completed turn, so nothing uses it. This reverses the #167 reading (2026-11-16) that agy answers a second prompt inside the turn: that observation saw two `end_turn`s, the first of them a dropped turn |
| Child compaction records (#163 S8) | **provided** — `compaction_update` behind the declared `session.compaction` (`[QK:ACP-COMPACT-CAPABILITY-DECLARED]`, `-DEPOSIT-ONCE`, `-SCOPE`) | **recorded limit** — no compaction capability advertised. `/compact` (advertised as a command) after three short turns sent no text and no compaction frame, only one `usage_update` and `end_turn`; that `used` (10,289) equals the compaction call's `totalTokens`, and the next turn read `used` 9,380 against 9,081 before it and recalled the first turn's facts (#168, agy 1.5.9, 2026-11-17, n=1; a system prompt of about 8.9k dominates a short session, so the reduction itself is not measured). agy's automatic compaction near a full window is **unmeasured** (not driven: quota) |
| Child closed after a Pi compaction | **provided** — `[QK:ACP-COMPACT-CLOSES-CHILD]`, `[QK:ACP-COMPACT-SPARES-TURN-IN-FLIGHT]` | **provided** (`[측정, LIVE n=1, 2026-11-17, flash/medium, sandbox HOME]`): `closeRetainedAcpSession` closed the retained agy child (`true`) and the next turn opened a new agy child that recalled the compacted token |
| Adapter-initiated idle compaction | **provided** as a `_meta` shape (`idleCompaction: false`, `[QK:ACP-CLAUDE-NO-IDLE-COMPACTION]`); its runtime effect is **unmeasured** | **unmeasured** — whether agy compacts or prompts on an idle session |
| Background work | **provided** — `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` (`[QK:ACP-CLAUDE-FOREGROUND-ONLY]`); a command that detaches itself is outside it | **recorded limit** — `run_command` hands a command to a background task that outlives agy; accepted by GLG 2026-11-16 (Known limits). Reproduced on x86_64: a 70 s loop backgrounded at the 10000 ms cap stood at ppid 1 after agy exited (#168, agy 1.5.9, 2026-11-17, n=1) |
| Other `session/update` kinds | **recorded limit** — ignored by the common `default:` (`event-mapper.ts:613-614`) | **recorded limit** — ignored by the common `default:` (`event-mapper.ts:613-614`); `/compact` is advertised among agy's available commands. Observed kinds: `user_message_chunk`, `agent_message_chunk`, `tool_call`, `tool_call_update`, `usage_update`, `session_info_update`, `available_commands_update`, `config_option_update` (#168, agy 1.5.9, 2026-11-17, every lab run); any other kind is **unmeasured** |
| Image input | **recorded limit** — text only (`[QK:ACP-ROWS-TEXT-ONLY-INPUT]`, #161) | **recorded limit** — text only (`models.ts:220`), though agy advertises `promptCapabilities.image: true` |
| Fresh call / resume | **provided** — exact curated admission; anything else `acp-model-not-curated` | **provided** for fresh call (LIVE n=1, 2026-11-16; `[QK:FRESHCOMP-ACP-AGY-TOOL-DIALECT]`); resume admission is deterministic only (`[QK:RESUME-ID-ACP-AGY-ADMITTED]`), a LIVE resume is **unmeasured** |
| Version pin, doctor, LIVE gate | **provided** — exact adapter and wire SDK pins (`package.json:105-106`), the same pin enforced at `initialize` (`admitAgent`), `check-acp-sdk-surface`, `check-dep-versions`, the `release-gate` Claude axis | **provided** — floor `1.5.9` at `initialize` (`admitAgent`, `acp-agy-version-unsupported`); **recorded limit** — no ACP doctor, no LIVE gate; the `doctor-agy-*` gates cover the paused native-push install, not `agy acp` |

## Shipped adapters

Claude and Antigravity (`agy acp`) are registered; Antigravity's seams and limits are in
§Antigravity below rather than in this table. The former Cortex column is a historical comparison,
not an executable route; Cortex model admission and direct adapter use now refuse.

| Seam | Claude | Former Cortex Code (historical) |
|---|---|---|
| Model ids | unprefixed `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-2` | `cortex-auto`, `cortex-claude-opus-5`, `cortex-claude-sonnet-5`, `cortex-openai-gpt-5.4`; prefix stripped before set-model |
| Launch | bundled `claude-agent-acp`; `CLAUDE_AGENT_ACP_COMMAND` override | `cortex acp serve`; optional connection; `CORTEX_ACP_COMMAND` override; never a launch-time `-m` |
| Model authority | per-turn ACP set-model, its answer read back before the prompt | per-turn ACP set-model; an unavailable curated id fails before prompt; the answer is not read back |
| Thinking level | pi's level → `effort`, set and read back before the prompt (§Claude effort) | not declared: no `thinkingLevelMap`, `reasoning` is not carried |
| Carrier | engraving in `_meta.systemPrompt` | no system-prompt carrier; engraving rides the first-user augment |
| Overlay | `CLAUDE_CONFIG_DIR` whitelist, configured-empty hooks, native memory hidden | session-scoped isolated HOME + `SNOWFLAKE_HOME`, private `cortex/mcp.json`, measured-minimum auth passthrough |
| MCP | explicit wire `mcpServers` | explicit declarations projected to private `mcp.json` because Cortex ignores the wire field |
| Background work | the launch env sets Claude Code's `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`: the vendor's Bash/Agent `run_in_background` option and its timeout / turn-abort auto-backgrounding are off. A process a command detaches on its own (`&`, `setsid`, a daemon) is outside this switch | not declared |
| Backend setting | none | `cortexConnection`; env override wins and participates in the signature |

### Claude

The unprefixed Claude curation uses exact Opus/Sonnet 5.5 ids; the ACP adapter does
not route the retired exact ids `claude-opus-5` or `claude-sonnet-5`, alias them to
a newer model, or rewrite existing session records. Pi owns fuzzy CLI model selection
before the adapter: an older seven-row fixture matched old bare 5 patterns to Cortex
rows (measured with the pure upstream resolver, not a vendor turn). Cortex rows are
now disabled. The launches Entwurf builds admit only an EXACT curated id
(`pi-extensions/lib/acp/model-ids.js`): `entwurf_fresh_call` with backend `pi` and an
`entwurf/<id>` model, and `entwurf_resume_call` of a session whose emitted provider is
`entwurf`, refuse anything else as `acp-model-not-curated` before a pane opens. A human
typing `pi --model …` keeps the upstream fuzzy behaviour, so use the full 5.5 ids there.

The adapter reads its set-model answer back before the prompt. The driver resolves the
requested id onto one of the rows it offers and answers with that row's `value` as the
model option's `currentValue` (0.85.1 `dist/acp-agent.js:5459-5499`). Measured on
2026-10-12 against 0.85.1, and again unchanged on 2026-10-14 against 0.90.0 (the second
time also with the production session meta), and on 2026-11-13 against 0.106.0 authenticated
(#142), with no prompt sent: `claude-fable-5-1` and `claude-fable-5-2` each answer their own row (2026-11-17: only on a session created with that model),
while `claude-sonnet-5-5` and `claude-opus-5-5` answer the alias rows `sonnet` and
`opus`, named `Sonnet 5.5` and `Opus 5.5`. The id an alias row resolves to is not on the
ACP wire, so `CLAUDE_SET_MODEL_ALIAS_ROWS` (`backend-adapter.ts`) declares, for each
alias-answered id, the one measured row it is accepted as, value and name together. A
missing model option, another row, or any other value/name pair refuses the turn before
the prompt, with text pi does not classify as transient. A curated id added later needs
its own measured answer before it ships. `check-acp-set-model-readback` holds the
contract offline; it does not certify the installed driver's runtime, and no 5.5 prompt
turn is claimed by this measurement.

#### Claude effort (#142)

Pi's thinking level is carried as the adapter's `effort` session config option. Each curated
Claude row registers a `thinkingLevelMap` (`claudeAcpThinkingLevelMap`, `models.ts`): `low`,
`medium`, `high`, `xhigh` and `max` map to the effort value of the same name, `off` and `minimal`
are `null`. So pi's own selector offers only `low..max`, and pi's normal clamp moves a saved `off`
or `minimal` to `low` before any turn. The registry still decides which levels a model has: a
level it marks `null` stays unsupported, and `xhigh`/`max` appear only where it maps them. The
effort value `default` is the vendor's own choice; no pi level maps to it.

At turn entry the adapter resolves the level before any process or session is touched. A turn
that arrives with no level, an unsupported level, or a map value outside the effort set refuses as
`acp-thinking-level-unsupported`, with nothing spawned. "No level" covers two cases pi does not
distinguish on the wire: the agent sends no `reasoning` for `off`, and none when no level is set.
Pi's own turn and compaction paths always carry a level for these rows after the clamp; the
refusal is for callers outside that path, and it says so rather than run at a depth nobody chose.

A new session sets effort right after set-model; a reused session sets it again only when the
level changed since the value it last read back. The level is not part of the reuse signature, so
changing it keeps the live conversation. The answer must read the value back as the `effort`
option's `currentValue`; a refused set (`-32602` for an unoffered value), a missing option or
another value fails the turn before the prompt, and a reused session is dropped, so the next turn
opens a new session and resends the transcript. The text we author reads as neither transient nor
overflow to pi; the sealed message still appends the session's stderr tail like any other
pre-prompt failure, and a bootstrap timeout keeps its `timed out` wording, so either can classify as
transient. A replay of that turn re-dispatches no prompt that ran. Each accepted set shows the operator a lifecycle notice `[acp: effort <value> read back]` (a new
session always, a reused one only when the value changed; a refused set shows none). Like the other
lifecycle notices it is excluded from the transcript a later turn sends and from the reuse signature.
Readback is the adapter's acceptance of the value, not evidence of the
reasoning depth applied or of turn speed. `check-acp-set-model-readback` holds the contract
offline (`backend.thinking.test.ts`, five effort mutants).

The bundled adapter is the only launch without the operator override: a missing package fails at launch resolution, with no PATH fallback (`backend-adapter.ts:462-471`, `claude-acp-launch.js:88-94`). Its overlay retains only the
auth/runtime state required by the Claude Agent SDK and hides operator memory, hooks,
agents, history, and local settings. Rich project/operator context rides the first-user
augment; the system carrier stays short to avoid changing billing semantics.

The carrier owns its own leading boundary. A string `_meta.systemPrompt` replaces the
`claude_code` preset, but the SDK still prefixes a fixed identity sentence and joins the
two with nothing, so the loader opens every rendered carrier with one blank line. The
template cannot supply it — the render is trimmed so operator whitespace never drifts the
reuse signature. That same rendered string is what `bridgeConfigSignature` folds and what
`buildSessionMeta` sends; normalizing it at either hop desynchronizes the wire from the
signature.

`clientCapabilities` declares only `session.compaction` (#163 S8, §11-8-a). Terminal-output
widgets and nested subagent transcripts are therefore not requested. Enabling either is a separate
rendering contract, not a capability bit flip.

### Antigravity (`agy acp`, #167)

This is the ACP-backend lane only ([adding-a-harness §0](./adding-a-harness.md)): a host pi citizen
drives `agy acp` as a child. It registers no citizen, adds no meta-store backend, and does not lift
the native-push pause (#152). Wire facts below are `[측정 2026-11-16]` against agy 1.5.9 on a
Google AI Pro login, read off raw JSON-RPC frames; each is one observation unless a count is given,
and the receipts are in the measurement comments on #167.

| Seam | Antigravity |
|---|---|
| Model ids | `agy-gemini-4-hydrogen`, `agy-gemini-4-argon`, `agy-gemini-3.8-flash`; the `agy-` prefix is stripped before set-model. The prefix is `agy-` rather than the `agy/` the issue body used as an example: `cortex-` is this rail's one precedent, and a second slash inside `provider/id` is a parsing surface nothing needs. agy offers four more models; they are not rows (two carry no `thought_level` option, two are Claude models the Claude rail drives) |
| Launch | `agy acp --stdio --gemini-dir <overlay> --include-default-customizations=false --dangerously-skip-permissions` from `PATH`. `AGY_ACP_COMMAND` is the operator's explicit override and owns its whole command line: none of those arguments is appended, so the overlay and the permission stance are then the operator's |
| Model authority | per-turn `session/set_config_option` `model`; the answer carries the full option list and is read back; an id agy does not offer is `-32602 Unknown model ID` before any prompt |
| Thinking level | pi's level → `thought_level` (`low/medium/high`, plus `xhigh` on Hydrogen), set AFTER the model and read back. agy clamps silently when the model changes under a level it does not offer (Hydrogen `xhigh` → Flash answered `high`), so only the readback says what the session holds. `off`/no level refuses, as on Claude. The lifecycle notice still reads `effort … read back` |
| Carrier | engraving in `_meta.antigravity.systemPrompt.append` (advertised at initialize; an appended rule shaped the reply). It is APPENDED to agy's own system prompt, where Claude's replaces a preset; the first-user augment tells an agy child so. In the LIVE sibling on the operator HOME the model reported an `# Engraving Here` slot at the end of its system prompt (self-report, weak). agy loads the session cwd's `AGENTS.md` itself, so the augment omits its cwd `AGENTS.md` section for an agy child and keeps the `~/AGENTS.md` one |
| Overlay | `--gemini-dir` moves the whole state root, so the overlay is a state root of its own with ONE file of the operator's agy state linked in — `antigravity-cli/antigravity-oauth-token` — plus the skill links the operator's global `skillPlugins` names (Skills row). An empty root answered `-32000 Authentication required`; with that one link `session/new` succeeded, also under a HOME holding nothing else. The link is re-established every bootstrap, a regular file found in its place is replaced, any other symlink directly under the overlay is removed, and an overlay path that is itself a symlink or not a directory refuses before anything is touched. One overlay is shared by every agy child of this operator |
| MCP | explicit wire `mcpServers`; tools appear as `mcp_<server>_<tool>` (`mcp_entwurf-bridge_…`, hyphen kept) |
| Permissions | the launch flag: no `session/request_permission` is sent. Without it agy asks with `allow_once` / `reject_once` for `run_command`, a `write_file` inside the workspace and `run_workflow`; it does not ask for a write under the system temp dir, for `search_web`, or before starting `invoke_subagent` or `schedule`. Mode was `default`, both initial and read back (#168, agy 1.5.9, 2026-11-17, n=1 per tool) |
| Tool hook (#168 ①) | `<overlay>/config/hooks.json` names one PreToolUse hook on every tool: `'<node>' '<package>/pi-extensions/lib/acp/agy-acp-hook.mjs' 'v1:hidden-turns'`, single-quoted because agy runs it through `sh -c`, and this process's own Node, as `resolveClaudeLaunch` runs `claude-acp-launch.js`, rather than a bare name the child's PATH would resolve. The policy is the hook's argument, not child env: the overlay is shared by every pi on the host, a pi that predates the seat sets no env for its children, and they re-read the seat on every call — so a policy in env would deny them every tool (`[QK:ACP-AGY-HOOK-MIXED-READER]`). The argument carries the one ordinary default only; per-child policy differences are not to be carried in the shared seat's command. The policy is also in the reuse signature. `v1:hidden-turns` denies `invoke_subagent`, `schedule` and `run_workflow` with a reason and allows every other tool; an unset or unknown policy and unreadable input deny, and the hook never exits 0 without a line, because agy reads an empty exit 0 as allow (`[QK:ACP-AGY-HOOK-FAILS-CLOSED]`). Measured (#168, agy 1.5.9, n=1 per cell): a hook deny stops a tool with or without the permission flag; under the deny no sub-agent or scheduled model call was made; a sub-agent's own tool calls pass through the same hook; the hook's reason reaches the model but not the ACP frame. The seat is rewritten every bootstrap — a foreign file replaced, a link removed (its target untouched), a directory refused `acp-agy-hooks-seat-not-a-file` — through a per-writer temp renamed over it. The adapter's own `ensureOverlay` call is proven against a sandbox HOME with the module graph re-imported (`[QK:ACP-AGY-HOOK-WIRED]`); the hook's path is proven beside the adapter (`[QK:ACP-AGY-HOOK-PATH-RESOLVES]`); the packed install carries it beside the adapter and runs it from the installed tree (`check-pack-install`: `v1:hidden-turns` denies `invoke_subagent` and allows `run_command`, a seat naming no policy denies) |
| Session reuse | consecutive prompts on one session keep context. LIVE n=1 through the real turn loop (emitted build, sandbox HOME): turn 2 took `[acp: reusing live session]` and recalled turn 1 |
| Cancel | n=1: `session/cancel` during a running command answered `stopReason: cancelled` 6 ms later, the tool settled `failed`, and the command was gone |
| Backend setting | none. An operator `tools`, `disallowedTools` or `permissionAllow` setting REFUSES an agy turn (`acp-agy-narrowing-unsupported`): agy has no seat for them, and ignoring a narrowing on a child whose prompts are bypassed would hand back what the operator took away (a hook seat exists, but a child can rewrite it — §Backend parity, Tool narrowing) |
| Skills | the operator's GLOBAL `entwurfProvider.skillPlugins`: each `<plugin>/skills/<name>` holding a `SKILL.md` is linked at `<overlay>/config/skills/<name>`, the seat agy discovers global skills in (measured n=1: a directory and a symlink there were both listed, under these launch flags; operator-HOME LIVE n=1, 2026-11-16: a fresh agy sibling listed 51 skills — the 46 projected links plus 5 built-in, self-report — and all 46 seat entries were symlinks). A link the setting no longer names is removed at the next bootstrap; a real directory in the seat is never removed; one skill name from two plugins refuses (`acp-agy-skill-name-collision`). Nothing is scanned: the operator's own `~/.gemini` skills are not followed |
| Fresh call / resume | `entwurf_fresh_call` and `entwurf_resume_call` admit the three ids; the first-turn framing names the bridge tools in agy's spelling (`mcp_entwurf-bridge_entwurf_callback` / `_entwurf_v2` / `_entwurf_peers`), with no tool-load hint. Fresh call: LIVE n=1 (2026-11-16) — a Claude Code caller opened `entwurf/agy-gemini-3.8-flash`, the sibling called back about 10 s later with the matching nonce and sent one `entwurf_v2`, its pane showing both tool calls under the first two names; a reverse `entwurf_v2` was acknowledged `control-socket → queued-follow-up` and answered correctly. `_entwurf_peers` was called by a second LIVE sibling (n=1, sibling's report). Resume: deterministic only |

What stays out of the child is a structural claim, not an observed one: the state root is separate
and one file is linked. The only direct observation is weak — asked to list what it had, the model
named no MCP server and five built-in skills.

What the common loop does on agy, seat by seat, is the agy column of §Backend parity above.

**Known limits.**

- **The floor is the only measured version, not a proven lower bound.** `agy acp` is admitted at
  `1.5.9` or newer because 1.5.9 is the one version measured (#167); no older version was shown to
  fail, and none newer was shown to work. The floor parse is strict X.Y.Z; any other shape
  (a pre-release, build metadata, a malformed version) refuses, as does an absent `agentInfo`, since
  nothing measured stands behind it (`[QK:ACP-AGENT-ADMIT-STRICT-VERSION]`). A refusal names the
  operator override that launched the server — the variable, never its value
  (`[QK:ACP-AGENT-ADMIT-OVERRIDE-NAMED]`).
- **Background commands outlive the child.** agy's `run_command` hands a command to a background
  task after a model-chosen wait (`WaitMsBeforeAsync`, 500–10000 ms observed). Such a command is a
  direct child of `agy` in its own session and process group; when `agy` exits it is re-parented to
  init and keeps running. No vendor switch closes it — `session/close`, cancel, stdin EOF and
  `--process-per-session` all left the orphan alive — and group teardown does not reach it. GLG
  accepted this as a known limit on 2026-11-16; it is the same family as #125. A measured candidate,
  NOT adopted: at teardown, stop agy's group, collect its descendants from `/proc`, kill each
  descendant's group, then agy's. It closed the three orphan shapes measured, in 20–34 ms.
- **A prompt-phase failure is never replayed by pi.** The error agy answers `session/prompt` with on
  an exhausted quota or an expired login is not measured, and a synthetic sweep showed a plain
  `Internal error`, a `429`, a wrapped `UNAUTHENTICATED` and a `rate limit` text all read as
  transient to pi after a tool had completed — a replay would run that tool again with
  permissions bypassed. So every agy failure after the prompt is sent seals the fixed
  `AGY_PROMPT_FAILURE_VERDICT` and keeps the raw failure as a diagnostic
  (`[QK:ACP-AGY-PROMPT-FAILURE-NO-REPLAY]`); a bootstrap failure keeps the verbatim path
  (`[QK:ACP-AGY-BOOTSTRAP-FAILURE-VERBATIM]`). The cost: a transient failure a replay would have
  cured is reported instead, and so is a real overflow pi would have compacted and replayed. The
  operator inspects the preserved failure and any effects already completed before deciding how to
  continue; the whole prompt is not to be re-sent blindly.
- **A level a row does not offer is clamped by pi, not carried.** pi clamps every level it sets —
  at session creation, on a model switch, on a level change and on a branch's recorded level
  (pi-coding-agent 1.5.2 `sdk.js` `clampThinkingLevel`, `agent-session.js` `_clampThinkingLevel`) —
  so on Argon or Flash `off`/`minimal` run at `low` and `xhigh`/`max` at `high`, and on Hydrogen
  `max` runs at `xhigh` (`[QK:ACP-AGY-THINKING-MENU]`, pi's own clamp as the oracle). The turn then
  runs at a level the operator did not type, as on a Claude row. Only a caller that bypasses pi's
  clamp reaches the refusal `acp-agy-thinking-level-unsupported`.
- **agy reads more rule files than a Claude child is given.** Marker files, n=4 cwd shapes: agy
  loaded `<cwd>/AGENTS.md` every time, the repository root's `AGENTS.md` and `GEMINI.md` when the
  cwd was inside a repository, and `<overlay>/config/AGENTS.md`/`GEMINI.md` as global rules; it did
  not load an `AGENTS.md` above the repository root, `~/AGENTS.md` (unless the cwd was home) or
  anything under the real `~/.gemini`. The augment drops only the one file both would carry. With
  the cwd at home, `~/AGENTS.md` arrives twice.
- **The native tool surface is wide and cannot be narrowed.** The LIVE sibling listed sub-agent,
  schedule, workflow and web-search tools beside file and shell tools (self-report); with
  permissions bypassed none of them asks, and a narrowing setting refuses rather than applies.
  GLG deferred reducing it (2026-11-16). Without the flag, `reject_once` and settings deny rules do
  not bound it either (Permission posture); a `PreToolUse` hook does stop a tool, but the child can
  rewrite it, so it is used only for the hidden-turn default (Tool hook).
- **Sub-agents, scheduled prompts and workflows run hidden turns.** `invoke_subagent` and `schedule`
  complete or stay `in_progress` at once; the sub-agent's work, and the turn a fired `schedule` timer
  starts, call the model and run tools with no ACP frame and no `session/request_permission` — agy's
  log showed `streamGenerateContent` 20 s after a 20 s timer while the client received nothing, and
  under the permission flag those turns executed commands. `run_workflow`'s `agent()` makes a model
  call with no frame inside the calling turn (4 model calls against 3 for a one-tool turn). A
  sub-agent's own tool calls pass through the same `PreToolUse` hook, and under a deny they were
  denied with no marker written. Pi cannot see these turns, and they spend quota (#168, agy 1.5.9,
  2026-11-17, n=1 per cell). The hidden-turn default (Tool hook) denies all three tools; with it, no
  hidden model call was seen in a 35–40 s window, other tools unaffected (n=1; LIVE on production code,
  lab sandbox HOME, 2026-11-17; BASELINE).
- **The shared overlay persists what a child writes.** `<overlay>/config/AGENTS.md` and
  `GEMINI.md` are agy's global-rule seat and regular files are not swept: one an agy child wrote
  there is loaded by every later agy child.
- **Only the global skill list reaches an agy child.** Every agy child shares one overlay, so the
  projection reads `skillPlugins` from the global settings file alone; a `skillPlugins` written
  only in a project's `.pi/settings.json` reaches a Claude child there and no agy child, with no
  notice. The skills were written for Claude sessions; whether their instructions fit agy's tools
  is not measured, and every linked skill's name and description is listed in agy's own prompt.
- **The hidden-turn hook is a best-effort execution default, not a security or isolation
  guarantee** (#168 ①). agy re-reads `config/hooks.json` on every tool call (measured n=1: a seat
  written mid-session applied to that session's next call, and removing it reopened tools for the
  next session), and the seat is a file every agy child can reach. A child with a shell rewrote its own seat to `{}` and its next `invoke_subagent` ran
  (#168 C2b, n=1; that one path, through a shell — other write or execution tools were not tried);
  asked to overwrite the seat directly, the model made no call (n=1), which is not a
  barrier. A child that rewrites the shared seat disables ① for every sibling on that overlay until
  the next child bootstrap rewrites the seat (composed from the re-read and the self-rewrite above,
  not measured as one cell). With
  a lab driver rewriting the shared seat while a second agy process ran, the first child's next call
  in the same session followed the new bytes (#168 P, n=1). A broken or empty `hooks.json` loads no
  hook and every tool runs (#168 B1); nothing beyond the bootstrap repairs it.
- **The seat names the writing pi's Node and hook by absolute path.** If either disappears (a
  garbage-collected or upgraded node store path, a moved checkout), every agy tool is denied until the
  next bootstrap rewrites the seat. A pi started before this change does not remove the seat, so its
  agy children also receive the default.
- **A repository's own hooks run in an agy child.** agy loads `<cwd>/.agents/hooks.json` with
  default customizations off, merges it with the overlay's hook, and a deny from either wins (#168
  O3, n=1 per combination); a repository named only in `additionalDirectories` is loaded too, and
  `--sandbox` and the `trustedWorkspaces` setting did not stop it (#168 W, n=1 each; W0 n=3). That
  hook's command runs with the child's environment. A workspace hook that answers `force_ask`
  reaches this client as `session/request_permission`, which entwurf approves by kind
  (`resolvePermissionResponse`, `backend.ts:1047-1054`, picks `allow_once`/`allow_always`); `ask`
  is approved by agy itself under the permission flag (n=1). Whether entwurf should warn about or
  refuse a cwd holding `.agents/hooks.json` is GLG's decision.
  `[측정, 2026-11-17, flash/medium, n=1 each]` agy walks up from `cwd` to the enclosing git root and
  loads every `.agents/hooks.json` it encounters along that chain; it does NOT walk above the git
  root or walk parents/HOME when `cwd` is outside a git repository (Step 0, 0b-1, 0b-2).
  The summary root (`~/.pi/agent/agy-summary/<turn>/`) keeps repository workspace hooks out of
  summary turns only while its resolved path lies outside every git work tree. Nothing checks that,
  and symlinks are not checked either: if `~`, `~/.pi`, `~/.pi/agent` or `agy-summary` resolves into
  a work tree, every `.agents/hooks.json` on the walk-up to that root may load and run, and their
  ownership and trust are not established.
- **Summary turns run in `"execution-denied"` mode, not `"toolless"` (#168).** Tool schemas remain
  visible to the model (`~3×` token cost observed when tempted by `Additional focus`: 31,045 vs
  ~10,300 tokens, n=1); `v1:deny-all` blocks execution before any tool runs. `AGY_ACP_COMMAND`
  overrides refuse summary turns by name (`acp-agy-summary-override-unsupported`) because an
  override owns the command line and bypasses `--gemini-dir` isolation. Summary results are saved
  in Pi's compaction entry, so agy's per-turn copy is not Rule 8 memory; cleanup unlinks only the
  summary root's token symlink after confirmed child exit and deletes the root on success
  (`[측정, LIVE n=1, 2026-11-17, flash/medium]`: root and token symlink removed in `1,119 ms` after
  `generateSummary` returned, 0 lingering PIDs, 0 warnings; an immediate host-process exit before
  `waitForChildExit` settles can leave an uncleaned root).
  Overflow-recovery compaction remains blocked on agy because `readAgyPromptRejection` seals all
  prompt-phase errors as non-replayable (overflow error wording unmeasured).
- **`--sandbox` and mode `auto` are not usable on the measured host.** With either, every
  `run_command` failed (`connecting to sandbox server: … connection reset by peer`, n=1, cause not
  identified). The adapter sets neither and keeps mode `default`; only an `AGY_ACP_COMMAND`
  override could reach them.
- **A token refresh writes through the credential link.** A lab agy on a linked token refreshed it
  (`token refreshed`, agy log, 2026-11-17, n=1); the operator's token file was written and every
  linked lab path was still a link afterwards. Whether the token rotated, and what several linked
  children refreshing at once do, is not measured.
- **Not measured:** agy's `session/prompt` wording for an exhausted quota, a login that expires
  mid-session, or an overflow (not induced); agy's own automatic compaction near a full
  window; `agent_thought_chunk` above `low`; which skill agy lists when
  a projected skill carries a built-in skill's name.
- The row's `maxTokens` is an entwurf-declared number pi requires; nothing sends it to agy.
- The Claude overlay has the same exposure the agy overlay now refuses — a `CLAUDE_CONFIG_DIR`
  overlay path that is itself a symlink — and it is not changed here.

Gates: `agy-adapter.test.ts` (routing, rows, launch admission, launch argv, carrier, set-model and
thought-level readback, the clamp, operator narrowing, the overlay link, sweep and real-directory
rules, the skill projection, retraction, collision and global-only rules, the rows through pi's
own clamp, `[QK:ACP-AGY-THINKING-MENU]`, and the tool hook: the seat `[QK:ACP-AGY-HOOKS-SEAT-WRITTEN]`,
`-REPLACES-FOREIGN`, `-DIR-REFUSED`, `-UNIQUE-TEMP`; the real hook spawned through `sh -c`
`[QK:ACP-AGY-HOOK-PATH-RESOLVES]`, `-COMMAND-QUOTED`, `-DECISION`, `-NO-POLICY-DENIES`,
`-BAD-INPUT-DENIES`, `-FAILS-CLOSED`; `[QK:ACP-AGY-POLICY-SIGNATURE]`; the adapter's `ensureOverlay`
under a sandbox HOME `[QK:ACP-AGY-HOOK-WIRED]`, and the seat read by a pre-seat pi's child and a newer
one's `[QK:ACP-AGY-HOOK-MIXED-READER]`), `augment.test.ts` (what
an agy child is told, and the cwd `AGENTS.md` it is not handed twice), `backend.summary-turn.test.ts`
(`[QK:ACP-AGY-SUMMARY-EXECUTION-DENIED]`, `[QK:ACP-SUMMARY-MODE-EXPLICIT]`, `[QK:ACP-AGY-SUMMARY-CLEANUP-S3]`, and an untagged agy turn through the real driver), `agy-adapter.test.ts` (`[QK:ACP-AGY-HOOK-DENY-ALL]`, `[QK:ACP-AGY-SUMMARY-OVERRIDE-REFUSED]`, `[QK:ACP-AGY-SUMMARY-ISOLATED-DIR]`),
`test/fresh-call-composition.contract.test.ts` (`[QK:FRESHCOMP-ACP-AGY-TOOL-DIALECT]`),
`check-resume-launch-identity` (`[QK:RESUME-ID-ACP-AGY-ADMITTED]`), `check-acp-provider-surface`
(the exact registered set).

### Cortex Code audit (D1–D10)

**Historical:** this audit describes the former Cortex ACP adapter, not a supported
route. The current product refuses Cortex selection before launch.

The original audit labels remain useful coordinates for source comments and gates:

| Audit | Landed contract |
|---|---|
| D1–D2 | Isolated HOME hides operator-global Claude/Cortex skills and settings; install-directory plugins remain a host fact. |
| D3 | Refuse `CORTEX_HOME` whenever present, including empty. |
| D4 | Author `autoUpdate: false`; launch only `cortex acp serve`. |
| D5–D6 | Pass through measured-minimum local auth; entwurf never runs or supplies authentication. |
| D7 | Four curated rows; enforce the stripped native id before prompt. |
| D8 | Credential boundary is AGENTS Hard Rule 9 and the ACP Plugin Boundary. |
| D9 | Project explicit MCP declarations into private `cortex/mcp.json`; wire `mcpServers` is ignored upstream. |
| D10 | Restore real operator HOME only for `entwurf-bridge`, so the isolated child still sees the garden store. |

Cortex containment was measured against the live CLI rather than copied from Claude:

- **Dual HOME:** the child receives an isolated `HOME` and `SNOWFLAKE_HOME`. Global
  `~/.claude`/`~/.cortex` skills, hooks, settings, and operator `cortex/mcp.json` are
  outside the session; explicit cwd project scope remains visible.
- **`CORTEX_HOME` presence refusal:** Cortex gives it precedence over
  `SNOWFLAKE_HOME`; even an empty ambient value can make ownership ambiguous.
- **Auth passthrough:** only `connections.toml`, optional `config.toml`, and
  `cortex/cache/credential_cache` are symlinked through. This narrows reachable paths;
  it is not a read-only mount and entwurf never supplies the credential.
- **Launch integrity:** the overlay authors `autoUpdate: false`, preventing a CLI
  replacement in the middle of a turn. The launch is exactly `cortex acp serve` plus
  an optional connection; protocol initialization fails loud if a TUI was started.
- **MCP projection:** Cortex's ACP server ignores wire `mcpServers`, so the adapter
  exact-writes an overlay-private `cortex/mcp.json`. Non-stdio declarations fail before
  spawn. Only the `entwurf-bridge` entry receives the real operator HOME required to
  see the garden store.
- **`realHome` absoluteness:** the D10 guard judges the captured `realHome` in BOTH
  path flavors (POSIX and win32), so the refusal rule states the contract rather than
  the host it happens to run on. This claims no native-Windows support — native
  Windows is UNSUPPORTED. The certified ACP axis remains Linux
  desktop/workstation; macOS ACP turns are NOT CERTIFIED — pending physical
  host. The flavor-explicit form only stops a POSIX host from reading a
  drive/UNC path as relative, which is what made the defect unkillable on
  Linux (PR #77).
- **Carrier:** Cortex has no `_meta.systemPrompt` contract. The engraving is placed at
  the head of the first-user augment; claiming a system-prompt engraving is false.

Cortex's bundled install-directory plugins are outside any HOME overlay and remain a
host fact. Also unclaimed: project-hook behavior on every host, the semantics of its
caller-session `_meta`, and cross-machine certification.

## 11-7. Readiness boundary

A backend can return `newSession` before its declared MCP server is callable. This was
observed intermittently on the Claude rail and directly on Cortex's private `mcp.json`
path. Entwurf's common loop calls `mcpServerStatus()` nowhere; it does not add a
client-side readiness fence over a session's declared MCP servers. The historical
0.76.0 → 0.79.0 source measurement below is dated evidence, not a current-version
runtime claim. For the 0.85.1 candidate, #127 re-measured the MCP-authentication
window as byte-identical and ran the MCP/self/send LIVE samples; neither source
identity nor green samples establish the cause of the intermittent readiness gap
or close #72. Changed SDK internals and session initialization remain separate
risk surfaces.
(Historical measurement at the 0.76.0 → 0.79.0 bump, not inherited — the previous bump's argument is
not reused, the way the 0.75.1 → 0.76.0 entry did not reuse 0.73.0 → 0.75.1's.
`mcpServerStatus` call sites in `src/acp-agent.ts` are **2 at v0.76.0 and 2 at v0.79.0**
`[측정 2026-09-18, upstream v0.79.0/src/acp-agent.ts read directly, grep -n]`; they first
appeared in 0.71.0 via `0cbbaf3` (MCP OAuth, LLM-25012), so the ADAPTER calls it where it
once did not. Both were re-read at `v0.79.0 src/acp-agent.ts:1773` and `:1866`
(v0.76.0: `:1762` / `:1855`; v0.75.1: `:1736` / `:1829`; v0.73.0: `:1618` / `:1711`): the
first sits inside `authenticateMcpServers` behind `supportsMcpOAuth(query)` and skips every
status that is not `needs-auth`; the second polls a SINGLE named server to `connected` under
an OAuth deadline. Neither waits on every declared server before `newSession` returns. That
is an auth handshake, not a readiness fence, so the boundary below is unchanged. The
surrounding 200-line window is byte-identical (`diff v0.76.0:1662-1862 v0.79.0:1673-1873`,
empty) and the region moved +11 while the file shrank 10,405 → 10,329 lines. The 0.77.0
agent-picker removal, the 0.78.0 compaction/checkpoint/AIR work and the 0.79.0 permission
presentation touch no part of this path, so the other reachable-surface findings stand as
re-measured in the capability-posture section above.
That historical source measurement closes no part of #72; it is not a claim that
all effective readiness behavior stayed unchanged in the 0.85.1 runtime.)

### 11-7-a/b. Instrument and first measurement

The ordering probe is an **instrument**, not a fix. It separates:

1. client request/response ordering;
2. backend MCP receive/reply markers;
3. the first prompt/tool decision;
4. probe admissibility (the test itself did not create the race).

Its first paired measurement was inconclusive. Do not convert that into “no race” or
“the adapter fixed it.” A green intermittent run measures one sample; a red run proves
the symptom remains.

### 11-7-c. CLI snapshot producer

The B-name-snapshot producer is admissible only when the run pins the real target
executable and digest, refuses ambient overrides, preserves argv/stdin/stdout/stderr and
exit/signal behavior, bounds NDJSON framing, scrubs only the exact probe env allowlist,
and timestamps snapshot/prompt hand-offs inside the downstream write callback. One
post-wire init snapshot may support the controlled-absence row; malformed, duplicate,
pre-wire, unarmed, or target-mismatched snapshots invalidate the run rather than proving
absence. `check-probe-cli-shim` is the detailed producer oracle: its 20 direct
`[CHECK:*]` assertions remain, while their verification-infra replants were deliberately
removed by #70. `probe-ordering.json` retains only the product-subject no-production-prompt-cutoff
replant consumed by `check-probe-ordering`.

Current probe contract and gates:

- `check-probe-ordering` — interval/envelope and marker ordering;
- `check-probe-cli-shim` — CLI shim admissibility and environment boundary;
- `smoke-acp-ordering-probe-live` — opt-in paired observation.

Until a causal fix lands, release gates continue to exercise real MCP availability and
fail when the callable surface is absent. Do not add sleeps or infer readiness from
`newSession` latency.

## Verification

Deterministic floor:

```bash
pnpm run check:full
./run.sh check-acp-provider-surface
./run.sh check-acp-sdk-surface
./run.sh check-acp-session-reuse
./run.sh check-acp-stop-reason
./run.sh check-acp-cortex
```

The whole `check-gate-qualification` body is not part of this floor: it is a scheduled drift
diagnostic only (weekly CI or a manual `qualify=true` dispatch, never a release axis, #144). A
change to a gate, mutant or matrix runs its affected exact-argv groups as PARTIAL receipts
(VERIFY.md).

Live axes:

```bash
LIVE=1 ./run.sh release-gate /path/to/scratch --cut
```

Cortex ACP is disabled; its former direct LIVE smoke refuses without probing a vendor.
This does not waive the aggregate's Claude, Codex or native-citizen axes. Per-cut
counts, digests, versions, and host observations belong in BASELINE/CHANGELOG.

## 11-8. Compaction is a tool lifecycle (0.75.0 onward)

The one change in the `0.73.0 → 0.75.1` bump that REACHES the common loop. Upstream #991
(`f74a517`) replaced compaction's assistant text with a synthetic ACP tool call: `kind:
"think"`, title `Compact conversation`, `_meta.contextCompaction` schema v1.

`[측정 2026-09-06, oracle, adapter 0.75.1, claude-sonnet-5]` one live `/compact` turn emitted
exactly two notifications (`tool_call` in-progress → `tool_call_update`), and those verbatim
objects replayed through the production `applyAcpSessionUpdate` produced a
`[tool:start] Compact conversation` / `[tool:…] Compact conversation` notice pair. No new
mapper branch is needed — `renderToolUpdate` routes every tool call regardless of `kind` —
and `_meta.contextCompaction` is dropped by the mapper, so no accounting path sees it.

What changed is therefore what an OPERATOR sees in a compacting turn, not what entwurf
computes. The post-compaction occupancy refresh is NOT new: `v0.73.0 src/acp-agent.ts:3460`
already emitted a `usage_update` at `compact_boundary` and 0.75.1 still does
(`dist/acp-agent.js:2740-2752`, now reading `compact_metadata.post_tokens` instead of a
`getContextUsage` control request), so the shrinking-`used_end` case that
`backend.ts:1286-1288` names as #96's weak floor gains no new trigger here.

Receipt, limits and the `completed`-branch gap: `scripts/raw-acp-compaction-measure/README.md`.

### 11-8-a. The child's own compaction, recorded in the host session (#163 S8)

**Since S8 the tool-call presentation above is no longer the production path.** `initialize` now
declares `clientCapabilities.session.compaction`, so claude-agent-acp 0.107.0 reports a compaction
as `compaction_update {compactionId, status}` with the summary on the terminal update (or as
`compaction_summary_chunk`s), and the occupancy around it as `usage_update.used` (measured: probe
cell C2). The capability goes to every adapter's `initialize`; only the claude adapter is
live-measured with it. The mapper's tool-call handling and its `[QK:ACP-COMPACTION-LINE/ONCE/FAILED]` stay as a
defensive contract for an adapter that ignores the capability; they write no record. Retiring
them is out of S8's scope.

**Two compactors, and why Pi cannot be the owner.** Pi compacts only at a turn boundary, when the
occupancy it reads (`usage.totalTokens` = the child's `used`, `[QK:ACP-CONTEXT-OCCUPANCY-PRESERVED]`)
exceeds `contextWindow − reserveTokens` (983,616 on the 1M window). The child compacts inside a
prompt (observed once at 969k, mid-prompt, 2026-11-15). Inside one long ACP prompt the child
compacts first whatever Pi's setting is, and a Pi compaction does not shrink the live child's
context: since #171 the next turn resumes the same vendor session (`[QK:ACP-COMPACT-CLOSES-CHILD]`,
`[QK:ACP-COMPACT-KEEPS-SESSION]`), whose context the vendor's own compaction governs. The
adapter's own idle compaction is off (`idleCompaction: false`, `[QK:ACP-CLAUDE-NO-IDLE-COMPACTION]`).

**What is recorded.** For each compaction of a prompt, one plain custom entry
`entwurf-acp-compaction` is written at that prompt's `message_end`, just before the assistant
message — by Pi's order of extension `message_end` then persist, read in the SDK
(`agent-session.js:810-826`), not run (`lib/acp/compaction-record.ts`, `compaction-writer.ts`).
`status`, `summary` and `error` are what the backend reported; the token counts and times are
what Entwurf observed:

- `status` is the adapter's own terminal status; `unterminated` means only that no terminal was
  observed (the adapter closes an open compaction as `cancelled` at a turn boundary, so this is
  rare: a dead child, or a terminal that arrived after the prompt window closed).
- `promptWasCompactCommand` is the observed fact that the prompt was `/compact` — not a cause. The
  adapter gives a non-AIR client no cause, and a `/compact` prompt can also hold an automatic
  compaction.
- `tokensBefore` / `tokensAfter` carry their source and observation time; a value not observed is
  null. `tokensAfter` is the adapter's report right after the compaction (a 0 there, the adapter's
  fallback, is null). It is not the next turn's occupancy or budget: in two probe runs the next
  prompt reported about 15k more; the cause was not measured.
- `observedIntervalMs` is the receipt interval, not a backend duration; null when the start was
  not seen.
- `summary` is the adapter's text as received, with `summarySource` `terminal` or `chunks` (the
  streamed raw API text) and `summaryChars`.

Only a compaction inside the prompt window is recorded: a `session/load` replay re-emits past
summaries under other ids and is not. Pi's own summary turn and a turn with no Pi session id
record nothing: their compactions are held only for that turn's display line and never deposited
for a `message_end` (the summary text passes through that turn's memory; it is not kept after it).
The display line (`[acp: compaction completed 969k→19k, 1m4s observed]`) carries facts only and waits for the `after`, the next compaction or the window close.

**Information, not context (AGENTS Rule 9).** The record is outside Pi's model-context projection,
and Entwurf never reads it into a prompt, a rebuild or a backend session
(`[QK:ACP-COMPACT-SUMMARY-NOT-IN-CHILD]`, `-NOT-IN-PI-CONTEXT`, `-NOT-IN-TEXT`). That proof covers
Entwurf's code; whether tools outside Entwurf that read session files read custom entries was
not examined. Pi emits `entry_appended` for it, so an RPC/JSON consumer sees it by design.

**The two memories still differ on a rebuild (stated boundary).** The live child remembers its
own summary and what followed; a child built anew from the host transcript remembers the host
transcript, which never held the child's internal tool results. The record shows where the live
child's memory became a summary, but a rebuild does not receive it. Unchanged and approved: a Pi
compaction closes the child and the next turn resumes the same vendor session with the inputs after its last answer (#171, `[QK:ACP-COMPACT-KEEPS-SESSION]`).
What is refused is injecting the recorded compaction facts or summary into a live child, or
using a recorded summary as rebuild input. Since Pi's threshold reads the child's occupancy, the host transcript a rebuild would
send is not measured by anything; a very long session's rebuild can exceed the window and then
fails with the overflow diagnostic.

**A lost record is visible, within limits.** Writing never fails the turn. A record that cannot be
written, or one the backend had to drop because no `message_end` took it, is reported once as a
UI warning when there is a UI and once on stderr by the writer, never with the summary. A drop has
a stderr line of its own as well, from the backend at the moment it drops — two stages, one line
each; the UI hears of a drop only through a later take of the same session. Headless, stderr is the only trace (accepted boundary, GLG 2026-11-15). There is no
viewer for the stored summary yet: it is kept like Pi's own compaction summary, but not shown like
one.

## 11-9. A busy ACP receiver takes a remote steer inside its turn (#163 S7; was #120 P5)

**Adopted (#163 S7; receipt names final at R2).** A control-socket `send` with `mode:"steer"` to a
BUSY receiver whose running turn is an ACP prompt is put into that backend turn through the
adapter's private `_session/steering` request, instead of waiting in Pi's steering queue for the
whole prompt to end. The decision lives in one place, `pi-extensions/lib/control-steer.ts`
`deliverControlSend`; `entwurf-control.ts` only calls it. Everything else keeps the old path:
`follow_up`, an idle receiver, a native Pi receiver (no seam registered), and the fallbacks below.

### What was measured, and why the old path is late

`[측정 2026-09-22, pi-agent-core 0.87.0; 재측정 2026-09-23, 0.87.1 — 좌표 동일]` `dist/agent-loop.js:141` awaits `streamAssistantResponse`
once per turn, and the steering drain is `:186`, after the `turn_end` emit at `:185`. For this rail
that one await is `backend.ts` `awaitAcpPromptTurn` —
`await Promise.race([session.connection.prompt(promptArgs), lifecycle])` — so it spans the entire
`session/prompt` round trip. The child's own tool calls are invisible to pi, so pi cannot reach
`:186` until the child turn ends. `[QK:PI-QUEUE-NO-MIDFLIGHT-MERGE]` (`test/pi-queue.oracle.test.ts`)
proves that mechanism on the installed vendor. `[측정 n=1, 2026-11-15, STEER-PROBE-21b4c2]` an ACP
receiver held both a steer and a follow_up across six tool boundaries and took each as its own turn
after the prompt ended; a native Pi receiver took the steer at its first tool boundary (#163
issuecomment-6887743866, 6887813050). That asymmetry is what S7 closes.

`[측정 n=1, adapter driven directly, claude-agent-acp 0.107.0]` (1eed2c, `issue163-adapter-probe.md`):
between tools → `injected`, the model sees it before its next tool; during a foreground
`sleep 30` → `injected`, the tool runs to its end and the model sees the steer after it (no stop);
idle → `promptRequired`, nothing started.

`[측정 n=24, adapter driven directly, claude-agent-acp 0.107.0, 2026-11-15]` (1eed2c,
`issue163-adapter-probe-2.md`): the steer ANSWER took 1.2 / 2.2 / 4.3 ms (min / median / max) and
did not move with the situation — idle, between tools, during a foreground tool, during text
generation, with a permission request pending, with a 12k body, during a tool-output flood.
- **During text generation** (2 runs): the steer cut the generation mid-line, and the same prompt
  went on as a steered cycle, rewriting the cut line from its start; there was ONE
  `session/prompt` answer, `end_turn`. The client saw one continuous `agent_message_chunk`
  stream — no cycle-boundary update was observed (n=2). Replayed through this rail's event mapper: one
  text block, one terminal, no false error. The Pi assistant text therefore keeps BOTH the cut
  fragment and the rewritten line (e.g. `12. 12는 1년의 달 수SEEN-…\n\n12. 12는 1년의 달 수입니다.`).
- **Burst during a tool** (3 back to back, 5 in one turn): all `injected`, answered in send order;
  the model saw all five, in send order, at the next boundary after the tool.
- **Pending permission (n=1):** `injected`; the permission card was not cancelled and the tool ran.
- **Unmeasured:** a steer during thinking, during tool-call generation, a burst during generation,
  a saturated host, and bodies far beyond 12k.

### The path (the five contracts the earlier text named, now owned)

1. **Capability.** The `initialize` answer's top-level `_meta.steering.supported === true`
   (`backend.ts` `readSteeringSupported`) is the only yes; anything else is `steering-unsupported`
   and the steer takes the Pi queue.
2. **Request and answer.** `acp-client.ts` `requestAcpSteer` sends one request, ALWAYS with
   `_meta.steering.idleBehavior:"promptRequired"` so an idle backend never starts a detached turn,
   bounded by `ACP_STEER_ANSWER_TIMEOUT_MS` (1 s — some 230× the slowest measured answer, and held
   below the sender's control RPC timeout `CONTROL_RPC_DEFAULT_TIMEOUT_MS`, 5 s, with a 2 s margin,
   `[QK:ACP-STEER-BOUND-BELOW-SENDER]`: were it not, the sender would give up first, read a plain
   send failure and could resend a steer that was injected). It reads `{outcome:"injected"}` and
   `{outcome:"promptRequired"}`; any other shape (`startedNewTurn` included) is `unrecognized`, a
   value, not a throw. A late answer or late rejection after the bound is ignored.
3. **Seam.** `acp-provider.ts` registers one frozen `ACP_STEER_SEAM` under
   `Symbol.for("entwurf.acp.steer.v1")` (`lib/acp-steer-seam.ts`). A different seam replaces the
   old one only while the old one reports no open window (`hasOpenWindow()`, a reload); over a
   prompt in flight or a broken old value it is refused by name (`acp-steer-seam-duplicate`). A
   replaced instance's later prompt is not reachable, so its steer takes the Pi queue — no false
   success, no double delivery. The real Pi `/reload` path is not measured. A wrong-shaped seam
   makes the send fail as `acp-steer-seam-invalid` with nothing queued. A steer window exists only while a prompt is in
   flight: `awaitAcpPromptTurn` opens it before the race and its owner closes it in `finally`.
4. **Exactly one path.** At most one adapter attempt, never a retry, and never both the injection
   and the Pi queue. Only "nothing reached the turn" (`not-sent`: no busy window, steering
   unsupported, no steer method; or `promptRequired`) falls back to the queue — and only if, after
   the await, the binding, context, native session id and closing state are what they were and
   the compaction guard still passes. Otherwise the send fails `target-stale` or with the guard's
   own reason. The fallback re-reads idle, so a turn that ended during the await gets a direct
   trigger answered `sent`.
5. **Receipt.** `steer-in-turn` (the backend's running turn accepted it — the model has NOT
   necessarily read it yet) and `steer-unknown` (a request left and its acceptance is unknown:
   `timeout`; `connection-closed` only when the ACP connection really is closed;
   `request-rejected` when the request failed on an open connection — a JSON-RPC error answer
   carries its code; `seam-threw` when the seam itself threw; `answer-unrecognized`. It may have
   been injected — the adapter can throw after its push — so it is never re-queued and must not be
   resent blindly). The sender carries what the receiver said beside these to the caller's line,
   normalized at the wire seam (closed reason tokens, a single-line detail of at most 120
   characters plus an ellipsis — 121 UTF-16 units), still as a success: the unknown reason and detail, and for `steer-in-turn` a record
   that failed or was skipped (`[QK:SEND-STEER-DIAGNOSTIC-REACHES-SURFACE]`). That diagnostic rides the
   clean finalized-send path only: a send whose lock release then fails (`lock-dirty`) keeps its
   boundary and its do-not-retry verdict but not the diagnostic. Both names are
   final; DELIVERY.md carries the rows.

### What this does and does not mean

- **No cancel or stop.** Neither mode asks the receiver to cancel its turn or a running tool; a
  tool in progress runs to its end. Stop is a separate verb and out of scope (#163, decision of 2026-11-14).
- **Backend generation preemption happens.** `[측정 n=2, adapter direct, probe 2]` a steer during
  text generation cuts it mid-line and the SAME prompt continues as a steered cycle, rewriting the
  cut line; one prompt still settles once (`end_turn`). That is not a receiver cancel, but it is a
  difference from native Pi, whose steer never cuts a generation, and the Pi assistant text keeps
  the cut fragment beside the rewritten line (no cycle-boundary update was observed, n=2, so
  this rail does not mark one). A steer during thinking and a burst during generation
  are unmeasured.
- **Volatile, like the queue.** An injected steer is cancelled with its turn on Esc/cancel —
  the same grade as `queued-steer`'s "an abort clears the queue".
- **Record outside the context; rebuild loss.** An injected steer is recorded once as a plain
  custom entry `entwurf-steer-in-turn` (`appendEntry`), only on the binding it was sent for. It is
  in the session JSONL, but not in the LLM projection, the next turn's delta or the reuse
  signatures (`[QK:ACP-STEER-DELTA-INTACT]`, through Pi's real `buildSessionContext`). The cost
  accepted for stage 1: a NEW child rebuilt from the transcript does not receive the steer's text;
  the assistant output that followed it remains, the instruction itself is not restored. A record
  failure is a receipt diagnostic (`record: "failed:<msg>"`), never a failed send. No entry
  renderer is registered yet; the entry shows with Pi's default.
- **Local TUI steer is unchanged.** A steer typed into the receiver's own TUI still takes Pi's
  queue boundary (after the ACP prompt). Only the control-socket path uses the seam.
- **Fallback boundary.** Whatever falls back is exactly the old `queued-steer` (or `sent`) and keeps
  the old timing: it can still wait for the whole ACP prompt.

## 11-10. Pi's own summary is a one-shot, tool-less turn (#163)

Pi summarizes for `/compact`, the compaction threshold, overflow recovery and `/tree` branch
summaries through one call, `completeSummarization` (pi-coding-agent 1.5.2
`dist/core/compaction/compaction.js:477-489`). That request declares no tools and carries
`cacheRetention: "none"`; an ordinary agent-loop turn carries no `cacheRetention`. Until #163 the
tool-surface preflight read the empty surface as "read/bash/edit/write excluded" and refused every
summary on a Claude ACP model.

- **Admission.** `isPiSummaryRequest` (`tool-surface.ts`) needs BOTH an empty replayed tool
  surface and `cacheRetention === "none"`. An ordinary turn with every tool excluded keeps the
  refusal. Pi's prompt text and session id are not read; Pi fills the id with a fresh `uuidv7()`.
- **The turn.** A new child under the turn-scoped policy, closed after its one prompt whatever the
  process policy says. `tools`, `mcpServers`, skill plugins, the permission allow list and
  `settingSources` are all empty. For Claude, `settingSources: []` excludes operator and project
  settings, CLAUDE.md, hooks and plugins. agy reads its private `v1:deny-all` hook (below), and
  repository hooks remain possible under the cwd caveat in the agy Known limits. The operator's engraving carrier stays, rendered with an empty MCP list. No first-message
  augment. Pi's summarization instructions arrive as a system message, which the transcript
  flattening drops, so their text (`getCurrentSystemPrompt`) is sent as the first prompt block.
  No notice of any kind: the summary Pi stores is exactly the model's text, and the session file
  is the embedding source. Pi keeps an `aborted` summary (it refuses only `error` and `length`,
  pi-coding-agent 1.5.2 `compaction.js:454-462`), so a `cancelled` stop that Pi did not abort is
  sealed as a non-transient error instead.
- **`agy` (`"execution-denied"`, #168).** Because `agy` takes no `tools` list on `session/new`,
  tool schemas stay visible to the model (measured `Additional focus` temptation cost ~3×:
  31,045 vs ~10,300 tokens, n=1). Instead of Claude's `tools: []` and `settingSources: []`, each
  summary turn gets a per-turn `0700` root (`~/.pi/agent/agy-summary/<turn>/{gemini,cwd}`),
  a neutral empty `cwd` (which avoids repo `.agents/hooks.json` walk-up only while its resolved path
  lies outside every git work tree; not checked, symlinks included), empty MCP/skills, and a
  `v1:deny-all` `PreToolUse` hook (`hooks.json` byte readback check in source). `AGY_ACP_COMMAND`
  overrides refuse summary turns by name (`acp-agy-summary-override-unsupported`). Cleanup unlinks
  only the isolated root's passthrough symlinks after confirmed child exit, removing `<turn>/` on
  `stop` and preserving it on `length`/error/unconfirmed exit.
- **After compaction.** `acp-provider.ts` subscribes to `session_compact` and closes that Pi
  session's retained child at once (GLG 2026-11-14), unless a turn is in flight. A session is busy
  only inside its key's in-flight claim, so the in-flight check covers both. The next turn resumes
  the same vendor session and sends it the inputs after its last answer (#171).

Proof: `pi-extensions/lib/acp/backend.summary-turn.test.ts` drives Pi's own `generateSummary` and
`generateBranchSummary` through `streamAcpTurn`, so the request shape is Pi's, not a fixture's. A Pi
upgrade that stops marking summaries with `cacheRetention: "none"` turns it red. Not covered here:
the adapter's own compaction inside a prompt we sent (§11-8), and the threshold value.

## 11-11. What a running turn shows (#162, #163)

The mapper's tool lines come in two kinds, and the kind is a contract with two readers outside
this file.

| Line | Signed | Replayed into a new session | Reuse signature |
|---|---|---|---|
| `[tool:start\|done\|failed\|cancelled] <title>[ — <summary>]`, `[permission:<d>] <title>` | no | yes | yes |
| `[tool:running] <title>[ — <elapsed>]`, `[tool:output] <title>` + preview, `[acp: …]` | yes | no | no |

- `[tool:running] <title>` without elapsed time names a call once its title is known: a Bash call
  opens as "Terminal" and its command arrives as a title-only update. A beat in the same update
  already names the title, so it prints alone.
- `[tool:output]` shows at most 5 lines and 400 UTF-8 bytes of a finished call's output: the head
  on success, the tail on failure. A line keeps its indentation (tabs expand to three spaces), so a
  stack trace or a diff reads as in Pi. When the whole output fits on the one-line summary, it is
  not shown.
- Every line, one-line or preview, is cleaned the way Pi cleans tool output before showing it
  (pi-coding-agent 1.5.2 `getTextOutput`: `stripAnsi`, then `sanitizeBinaryOutput`, then CR
  dropped), with DEL and C1 also removed. Pi's own range would leave an 8-bit OSC (`0x9D` … `0x9C`)
  intact. Pi does not export these helpers from its root, so the mapper carries the same
  expression, and a test compares it with Pi's installed functions. pi-tui's public
  `stripTerminalSequences` is not a substitute: it ends a CSI only on `m/G/K/H/J` and scans ahead
  for one, so on tool output it deletes text (`"\x1b[2A keep this text then Hm"` → `"m"`, measured
  2026-11-14 at pi-tui 1.5.2). No strip-ansi or ansi-regex package is in the dependency tree.
- `[acp: compaction <trigger>[ failed] <pre>[→<post>][ in <duration>]]` reports the backend's own
  compaction from the `rawOutput` facts of its `compact` tool call, once per compaction.

The second reader is andenken's `control-v1` selection (andenken `session-selection.ts`, read at
`e5165ecc`, 2026-11-14). It drops every signed lifecycle block whatever its text, and drops an
unsigned block only when it is exactly one sanitized `[tool:start|done|failed|cancelled]` or
`[permission:*]` line. An unsigned line with a new label, or a changed unsigned grammar, is
embedded. So a new tool line is signed, and changing the unsigned grammar goes to GLG first;
andenken is not changed from here.

## Open work

- causal MCP-readiness diagnosis and, only with proof, a backend-invariant fence;
- persisted ACP resume/load, which is not implemented by today's in-memory reuse.
