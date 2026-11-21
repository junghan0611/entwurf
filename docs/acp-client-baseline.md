# ACP client baseline

This page fixes what a complete ACP client must decide, row by row, and the state of each row in Entwurf
today. It is the single table behind #171: an ACP issue is opened for a symptom the table already names only
by naming its row, and a row is closed when its cell says how.

The adapter and turn-loop contract stays in [acp-backend-rail.md](./acp-backend-rail.md). This page owns the
row list, the cell states, the decisions and the failure contract. Entwurf speaks ACP protocol v1. `session/load`,
`session/resume`, `session/close` and the record store are rows here, not shipped behaviour, unless a cell says
`implemented`.

## Scope

The table covers only the core capabilities a Pi row uses. Protocol features that add a harness mode, such as plan
mode or todo and plan updates, are not core, so they are declined on purpose: not supporting them is the Pi style
(GLG, 2026-11-21, in the coordinating session; recorded on #171 with this checkpoint). Rows that name such a feature cite this principle as their reason (Z1).

## How to read the table

One row per line; columns `Row | Name | Status | Evidence | QK`. Status is one of:

- `implemented` — shipped and covered; the QK column names a test title that exists today.
- `not-wired` — the decision is made and the code is the work to come; Evidence is the measured vendor behaviour it
  must follow and the `file:line` that has to change.
- `declined` — a decision with its reason. "Not supported" is a recorded choice, never an absence.
- `deferred` — decided to wait; the condition for resuming is stated.
- `unmeasured` — nobody has observed it; Evidence says what would measure it.

Every row other than `implemented` carries `—` in the QK column and its reason in Evidence. Line numbers are for the
tree this page landed with (branch `acp-session-load-171`, from `ddd78246`). Paths without a directory are under
`pi-extensions/lib/acp/`. Receipts `R1`–`R11` are below the table. A row whose remainder nobody has observed splits that remainder into its own `U` row with Status `unmeasured`; an unmeasured remainder never shares a cell; it gets a U row. A row may be partly implemented and partly not-wired when its cell says which part is which (L11, L14).

## The table

| Row | Name | Status | Evidence | QK |
|---|---|---|---|---|
| L1 | initialize, record agent capabilities | not-wired | `initialize` is called (`backend.ts:2233-2243`) but only the steering flag (`:2246`) and vendor admission (`:2250`) are read; `loadSession`, `sessionCapabilities.*` and auth methods are not stored, and `decideBootstrap` gets no `capabilities` (`session-store.ts:288`, `backend.ts:1994`). The client declares only `session.compaction` (`backend.ts:2238`). Fakes answer `agentCapabilities: {}` (`scripts/check-acp-session-reuse.ts:171`). Receipt R1. | — |
| L2 | authenticate | declined | Vendor login is the vendor CLI's own; Entwurf never mediates credentials (AGENTS.md, ACP Boundary). No `authenticate` call in `AcpConnectionLike` (`acp-client.ts`). Unauthenticated Claude fails by itself: `-32603 "Could not resolve authentication method"` when a model is set (`docs/acp-backend-rail.md`, "an auth fact, not support"). | — |
| L3 | session/new | implemented | `backend.ts:2265-2271`; throws when the answer has no `sessionId`. The first turn gets the fresh id in `scripts/check-acp-session-reuse.ts`; also covered by [QK:ACP-OVERLAY-SESSIONKEY-WIRED]. | [QK:ACP-ORACLE-L3-NEW] |
| L4 | session/prompt and update mapping | implemented | `awaitAcpPromptTurn` (`backend.ts:986`); the terminal reasons are a closed set (`backend.ts:1072-1090`); mapping in `event-mapper.ts`; checks `scripts/check-acp-event-mapper.ts`, `check-acp-stop-reason.ts`, `check-acp-stream-hooks.ts`, `check-acp-usage-accounting.ts`; also covered by [QK:ACP-INCOMPLETE-TOOL-RAW-EVIDENCE] and [QK:ACP-TURN-ACCOUNTING-ATTACHED]. | [QK:ACP-ORACLE-L4-PROMPT] |
| L5 | in-process reuse | implemented | Process-scoped only (`--entwurf-control`): reuse branch `session-store.ts:301-303`, `runReuseTurn` `backend.ts:2014`, retention `backend.ts:2351-2370`. A turn-scoped pi is always `new` (`session-store.ts:295-298`); also covered by [QK:ACP-REUSE-LATE-UPDATE-PRE-PROMPT]. The reuse delta carries every nonempty user-role block after the last assistant, in order (batched steer/follow-up and bash output included); Pi custom messages such as session-info lose their type at projection, so their text rides along (GLG 2026-11-21: noise over loss; kind filtering deferred). After a vendor `max_tokens`, Pi 1.5.2 omits the cut answer with a `context_edit` (zero usage makes every length stop recoverable, pi-ai `overflow.js:177-178`; `agent-session.js:2533`, `:2564`), so the cut prompt is sent again with the next one: a duplicate, no longer a loss. `/compact` is attributed from the first block only, where claude-agent-acp 0.107.3 reads a command (`prompt-to-claude.js:36-39`, `v1/acp-agent.js:1146-1147`); whether the vendor compacts on a multi-block prompt that starts with `/compact` is unmeasured. Wire checks: [QK:ACP-DELTA-STEER-ALL] [QK:ACP-DELTA-FOLLOWUP-ALL] [QK:ACP-DELTA-BASH-NEXT] [QK:ACP-DELTA-MAX-TOKENS] [QK:ACP-COMPACT-FIRST-USER-BLOCK]. | [QK:ACP-ORACLE-L5-REUSE] |
| L6 | session/cancel | implemented | A notification; the agent ends the pending prompt `cancelled`; after a 5 s grace Entwurf escalates to SIGTERM and a connection close (`backend.ts:132`, `:999-1043`); also covered by [QK:ACP-CANCEL-NOTICE-REUSE-KEPT], [QK:ACP-CANCEL-NOTICE-NEW-CLOSED] and [QK:ACP-REUSE-COOPERATIVE-CANCEL]. | [QK:ACP-ORACLE-L6-CANCEL] |
| L7 | session/close on dispose | not-wired | Decision 2: send it when the agent advertises it. Today the child is killed and no protocol close is sent (`teardownChild` `backend.ts:1150`, `abandonRetainedSession` `:598`). Measured safe on both vendors, resume still works afterwards (R3). Zed sends close and treats `-32002` on close as success. | — |
| L8 | session/resume | not-wired | Decision 1 and the order note below. No wire call exists; the decision branch is unreachable (`session-store.ts:313-315`, `backend.ts:1994`; a turn-scoped pi short-circuits at `session-store.ts:295`; no resume branch at `backend.ts:2014-2018`). Measured on both vendors: zero replay, recall intact; unknown id: Claude `-32002`, agy generic `-32603` (R2). `scripts/check-acp-session-reuse.ts:320-351` pins "record not used" and must be reversed with the code. On agy it is used only under the V5 version guard. | — |
| L9 | session/load when resume is absent | not-wired | The same unreachable branch (`session-store.ts:316-318`). Rule to implement: updates received before the load response are replayed history and are not recorded; on a failed load the pending updates are dropped. Measured replays: Claude 3,058 ms, agy 4,644 ms (R4). Order against resume is the decided divergence in the notes below. On agy it is used only under the V5 version guard. | — |
| L10 | session/list | declined | Decision 5, for now: Pi owns the session list. No call exists. Both vendors advertise `list`; agy `session/list` does not report a session that was never prompted, even one that exists and resumes (R10), so using `list` as the V1 discriminator first needs a measurement of its behaviour for a prompted session (U1). | — |
| L11 | model and effort set and readback, including after resume or load | not-wired | New and reuse are implemented (`backend.ts:2279-2300`, `backend-adapter.ts:659`; [QK:ACP-THINKING-NEW-SET], [QK:ACP-THINKING-REUSE-SET], [QK:ACP-AGY-SET-MODEL-READBACK], mutant `scripts/mutants/acp-set-model-readback.json`). After resume or load nothing re-applies them and both vendors answer the vendor default (V2, R5). Rule to implement: re-enforce both with readback. The behavioural effect of the re-applied effort is split out as U2. | — |
| L12 | session/request_permission | implemented | Decision 4: approve-all is the baseline. `resolvePermissionResponse` (`backend.ts:1051-1058`): `allow_once` or `allow_always` wins, else the first option, an empty list is `cancelled`; one handler for every backend (`backend.ts:2190`). Unit-tested by [QK:ACP-ORACLE-L12-PERMISSION]; agy's hook policy is also covered by [QK:ACP-AGY-HOOK-DECISION]. Narrowing the policy is separate work. | [QK:ACP-ORACLE-L12-PERMISSION] |
| L13 | child death, teardown, no orphans | implemented | `onChildGone` (`backend.ts:642`), exit hook SIGKILLing retained groups (`:628`), group SIGTERM then SIGKILL after 2 s (`:1150`), transport diagnosis (`:895`). Measured: 26 children exited 0, grandchildren clear within 3 s, a 500 ms check sees a survivor about half the time (R6). QK ACP-ORACLE-L13-TEARDOWN pins order and delay, and ACP-ORACLE-L13-PROCESS-GROUP pins the negative-pid process-group SIGTERM/SIGKILL branch. No regression test pins the grandchild behaviour; also covered by [QK:ACP-SHUTDOWN-RELOAD-QUIT-KEEP-CHILD] and [QK:ACP-REPLACED-SESSION-CLOSES-CHILD]. | [QK:ACP-ORACLE-L13-TEARDOWN] [QK:ACP-ORACLE-L13-PROCESS-GROUP] |
| L14 | compaction, including across resume or load | not-wired | Claude across load: the rule that a load replay is never recorded is not implemented. The agy half is U3. In-session compaction is implemented (collector `backend.ts:1399`, `session_compact` closes the retained child `acp-provider.ts:80`, the `ACP-COMPACT-*` family in `backend.compaction.test.ts`, `compaction-roundtrip.test.ts`). Across load: a Claude replay carries the pre-compaction history plus a re-emitted `compaction_update` under a new id, so a load replay is never recorded; resume replays nothing (R4). agy: no compacted session could be built (R4, U3). | — |
| L15 | session record store: read, persist, path | implemented | Read classifies found, missing, invalid or unreadable and never deletes the file (`readSessionRecord`, `session-store.ts:403-418`). Write goes to a same-directory temporary file the writer owns (`openSync` with `wx`) and is renamed over the target (`writeSessionRecord`, `session-store.ts:421-436`). The path follows Pi's `getAgentDir()` (`session-store.ts:151`). A persist failure is checked just before the seal and shown as a visible `pushAcpLifecycleNotice` (`ACP_RECORD_DEGRADED_NOTICE`, `backend.ts:960`); the turn then seals normally (decision 3; `persistRecord` `backend.ts:1246`, new turn `:2392`, reuse turn `:2527`). Visibility is atomic only: no fsync, no writer serialization, and a crash between open and rename leaves an ignored `*.tmp`. Production still does not read the record (L8), so the user-visible behaviour is unchanged except that notice. Also covered by `scripts/check-acp-session-store.ts` (parse, path and decision tests). | [QK:ACP-ORACLE-L15-INVALID] [QK:ACP-ORACLE-L15-UNREADABLE] [QK:ACP-ORACLE-L15-ATOMIC] [QK:ACP-ORACLE-L15-AGENT-DIR] [QK:ACP-ORACLE-L15-DEGRADED-NEW] [QK:ACP-ORACLE-L15-DEGRADED-REUSE] |
| L16 | record currency — the record is behind the transcript | not-wired | Implemented together with L8. `buildAcpPrompt` sends one message on resume or load, the first user message after the last assistant message (`context.ts:169-185`, `:204-207`), and leaves its safety to the caller's prefix gate. `hasPrefix` (`session-store.ts:246-252`) proves the record has not diverged, not that it is current. Measured by B (2026-11-21, `e330d472`, `decideBootstrap` and `buildAcpPrompt` imported unchanged, receipt R11): a record of 1 turn against a transcript of 4 turns with `resume: true` gives path resume (`persisted_compatible_resume`) and a prompt that is one line, the turn-4 question; turns 2 and 3 are lost and nothing is shown (the outcome `context.ts:209-211` names as dangerous). Three doors lead to a stale record (read from the code, none run end to end, B): a record persist failure (decision 3: the previous record stays on disk), a turn that did not seal (what the transcript holds then is U12), and turn-scoped turns on the same Pi session id (`session-store.ts:295-298`, `backend.ts:2351`). Rule to implement: resume only when the tail after the record prefix holds exactly one user turn; otherwise a visible `new` with its own reason, never `persisted_compatible_*`. The rule needs exactly one user turn after the record's prefix; a tail with no user turn (record equal to or ahead of the transcript, e.g. persisted before a seal that then threw, and Pi retried the same message) also goes to `new`, otherwise the vendor would be sent a turn it already ran (read from the L15 persist-before-seal order in `backend.ts`, not run). Oracle to add: zero prompts sent to the old session id. How the rule judges several user messages inside one turn (steering) is U11. | — |
| P1 | entwurf_resume_call to resume or load | not-wired | Pi reopens with `--entwurf-control --session <file>` (`pi-extensions/lib/entwurf-v2-visible-resume.test.ts:639`), so it is process-scoped and keeps the same Pi session id, hence the same `pi:<id>` record key. Nothing reads the record, so the first ACP turn is a `new` that replays the transcript (`backend.ts:1994`). | — |
| P2 | /renew on an ACP row | deferred | GLG, 2026-11-20: not now; it resumes when the ACP basics are complete and mature. Today `/renew` rides Pi `newSession`, `session_shutdown` closes the retained child (`acp-provider.ts:42`, `:94-97`), and the new chapter is a new Pi session id and a `new` ACP session with the outline as first message. No ACP-specific code blocks it; the transition on an ACP row has no observation (U4; `docs/renew-memory-outline.md`). Whether it sends `session/close` follows L7. | — |
| Z1 | declared client capabilities | declined | Entwurf declares `session.compaction` only (`backend.ts:2238`). fs write and terminal: declined, `writeTextFile` throws (`backend.ts:2197-2199`), Pi owns tools. fs read: a handler exists (`backend.ts:2196`) but the capability is not advertised, so no agent should call it; whether any does is U5. Notices, elicitation, subagents, config options: no Pi surface. Plan mode and todo or plan updates add a harness mode and are declined by the scope principle (GLG, 2026-11-21, in the coordinating session; recorded on #171 with this checkpoint). Enforcement: a vendor may send plan updates even though Entwurf does not advertise them, and `event-mapper.ts:613-614` (the `default` case) drops them. Zed declares all of these (`crates/agent_servers/src/acp/v1.rs:500-532`). | — |
| Z2 | protocol version negotiation | declined | Decision 5: stay on v1. Zed tries v2 behind a beta flag and falls back on `-32022`. Measured (R7): Claude rejects a v1-shaped v2 `initialize` with `-32602`; agy downgrades to v1. A properly v2-shaped request was not sent (U10). | — |
| Z3 | agent exit as a typed load error with stderr tail | not-wired | Matches the failure contract (child death during resume or load is a named stop with the tail). Entwurf already keeps a stderr tail and diagnoses a closed transport for prompt turns (`backend.ts:895`); applying it to a resume or load request is the work. Zed drains pipes for at most 250 ms after exit. | — |
| Z4 | ordering boundary at the load response | not-wired | Same rule as L9. Zed registers the thread before sending load and treats the response as the boundary, draining on failure (`crates/agent_servers/src/acp/v1.rs:193-226`, `:1011-1026`, `:1050-1054`). | — |
| Z5 | close a session/new whose caller left | declined | Measured (R10): sending `close` to an abandoned `session/new` changes neither vendor's state, so there is nothing to gain. Claude leaves no file or list entry; of the two aborts after the response (kill without `close`, `close` first) resume answered `-32002`, and for the kill before the response no id was received, so no resume was tried and no new state file appeared; agy creates a conversation database at `session/new` and keeps it whether or not `close` is sent. Zed closes it when close is advertised (`crates/agent_servers/src/acp/v1.rs:1360-1395`). Entwurf kills a booting child on abort (`backend.ts:2166-2176`). See V4. Declined on measurement (R10); GLG confirmation pending. | — |
| Z6 | concurrent open of one id inside Entwurf | not-wired | Only one Pi process is guarded: a busy or in-flight key fails loud (`backend.ts:1974-1977`). Two Pi processes resuming the same record are not covered, and V3 shows the vendor will not refuse the second. Needs an Entwurf one-holder rule; the same guard closes V3 and Z6 together in one change. | — |
| Z7 | connection-loss recovery by load | deferred | Pi resume is the recovery path (P1). Zed keeps the draft and reattaches by load (`crates/agent_ui/src/conversation_view.rs:1166-1173`). Resumes when L8 and L9 are wired and a lost-connection case is observed. | — |
| Z8 | optional verbs: delete, set_title, truncate, retry, cancel_tool_call, cancel_terminal, logout | declined | Decision 5. Capability-gated in Zed (`crates/acp_thread/src/connection.rs:206-330`); Entwurf has no surface that needs them. | — |
| Z9 | subagent sessions are never loaded or resumed | declined | Entwurf advertises no subagent capability, so none is announced (Zed: `crates/acp_thread/src/connection.rs:136-142`). | — |
| V1 | agy session/load of an unknown id answers success | not-wired | Decision 1 closes it by rule (never load after a failed resume; code is the work). The deviation is measured (R8): success with zero replay and no session file; the failure appears only on the first prompt. The discriminator that would let core name it (no replay for a record that had turns, record and cwd match, first usage, or `session/list`) is a proposal, not measured as a detector (U6). Resume-first closes V1 only for an agent that advertises resume; an agent advertising load alone leaves the path open (U7). The handling of V1 on agy depends on the V5 version guard. | — |
| V2 | load and resume answer the vendor default configuration | not-wired | Both vendors, measured (R5). Core must re-enforce model and effort after resume or load (L11). | — |
| V3 | vendors do not refuse a second live holder of one id | not-wired | Measured on both (R9; both holders prompting is U9). Entwurf's own guard is in-process only (Z6); one one-holder guard across Pi processes closes V3 and Z6 together, in the same change. | — |
| V4 | agy persists every session/new as a resumable empty conversation, invisible to session/list; a kill during session/new leaves an orphan the client never received an id for | declined | Measured (R10): the conversation database was stored in 3 of 3 aborts, and a new child resumed it in the 2 of 2 that had received the id; whether the orphan from the kill before the response resumes is U8. Vendor storage hygiene, not an Entwurf session: Entwurf neither mediates nor cleans vendor storage (AGENTS.md Hard Rule 9). agy advertises no `delete`. Declined on measurement (R10); GLG confirmation pending. | — |
| V5 | agy version is opaque and self-updating | not-wired | agy changes version by running or by `agy update`, and the operator may not know the current one (GLG, 2026-11-21). Decision 6: a three-layer guard. (1) Start is refused below the floor, existing (`AGY_ACP_AGENT.floor`, `backend-adapter.ts:351`). (2) A measured-version constant `AGY_ACP_AGENT.measured` goes in code and must equal the agy version in the Receipts header, enforced by a gate. (3) Behaviour that leans on measurement (agy's L8 and L9 resume and load, the V1 handling, load-replay suppression) is used only when the version `initialize` reports equals `measured`; otherwise the reason is shown and the path is `new`. Default behaviour (new, prompt, cancel) rests on the floor alone. The only way to lift the guard is a re-measurement through `scripts/raw-acp-session-measure/`, updating the constant and the receipts together. Implemented together with L1 (it needs the initialize answer). Claude stays as is: the package pin equals the receipt; a bump to 0.109 comes with a re-measurement (GLG). | — |
| U1 | agy `session/list` for a prompted session | unmeasured | Would measure whether a prompted agy session appears in `session/list` (L10, V1). R10 observed only a never-prompted session, which is absent. | — |
| U2 | behavioural effect of the re-applied effort | unmeasured | R5 read the values back but its question was too easy to produce thinking in any condition. Would measure: a question that thinks at the default effort, asked after resume at the default and at the re-applied level (L11). | — |
| U3 | agy compaction | unmeasured | No trigger produced a compacted agy session: `/compact` ended `end_turn` with no notification and no drop in `used` (R4). Would measure: any trigger that makes agy emit a compaction fact, then load and resume across it (L14). | — |
| U4 | `/renew` transition on an ACP row | unmeasured | P2 is deferred, so no ACP-row transition has been run. Would measure: `/renew confirm` on an ACP row, then the new chapter's first ACP turn and the close of the old child (P2). | — |
| U5 | an agent calling fs read | unmeasured | The handler exists (`backend.ts:2196`) but the capability is not advertised. Would measure: any agent that sends `readTextFile` to this client (Z1). | — |
| U6 | a V1 discriminator as a detector | unmeasured | The candidates are no replay for a record that had turns, record and cwd match, first usage, or `session/list`. None was run as a detector against a phantom load (V1, U1). Would measure: run each candidate discriminator against a phantom load and a real load. | — |
| U7 | an agent advertising load without resume | unmeasured | No such vendor is known. Would measure: any such agent, to see whether resume-first leaves V1 open there (V1). | — |
| U8 | resume of the agy orphan from a kill before the `session/new` response | unmeasured | The orphan database exists but the client never received its id, so no resume was tried (R10, V4). Would measure: resume the id named by the orphan's database filename. | — |
| U9 | two holders both prompting one id | unmeasured | R9 had zero prompts. Would measure: two children resuming one id and both sending a prompt; what the transcript or database holds afterwards (V3, Z6). | — |
| U10 | a properly v2-shaped `initialize` | unmeasured | R7 sent `protocolVersion: 2` with v1-shaped params only (Z2). Would measure: `initialize` with v2-shaped params. | — |
| U11 | L16 rule with several user messages in one turn (steering) | unmeasured | The rule counts user turns in the tail after the record prefix; how steering messages inside one turn change that count was not run (L16). Would measure: `decideBootstrap` on a transcript whose tail has a steering message. | — |
| U12 | a failed turn's transcript shape decides whether the L16 rule covers the did-not-seal door | unmeasured | Nobody has recorded what Pi's transcript holds after a failed turn (child death after the tool phase, timeout, abort), so it is not known whether the L16 tail judgement catches that door (L16). Would measure: produce each failure, record the transcript tail, then run the L16 tail judgement on it. | — |

## Decisions (GLG, 2026-11-20)

1. **Failure contract.** A `session/resume` rejected with a JSON-RPC error (nothing has been prompted yet) shows
   the reason and takes `session/new`, which is today's behaviour, so nothing regresses; Pi owns the transcript,
   unlike Zed. A failed resume never falls back to `session/load` on the same record, which closes V1 where the
   agent advertises resume. If resume or load answered success and the first prompt then fails, or the request
   times out, or the child dies during it, the result is a named stop: no automatic new session and no retry.
2. **`session/close`** is sent on dispose when the agent advertises it. Measured safe on both vendors; resume
   still works afterwards (L7, R3).
3. **Record persist failure.** The turn continues with a visible degraded notice; only the next resume falls back
   to `new` (L15).
4. **`session/request_permission`.** Today's approve-all policy is the baseline row; narrowing it is separate, later
   work (L12).
5. **Declined rows**, each with its reason: L2 `authenticate` (vendor login; Entwurf never mediates credentials),
   Z2 protocol v2 (stay on v1), client fs write and terminal (Pi owns tools), and the optional verbs (delete,
   title, truncate, retry, logout). L10 `session/list` is declined for now with one note: it is the only protocol
   way to ask whether a session exists, so it may serve as a V1 discriminator later; agy's list omits never-prompted
   sessions (R10) and its behaviour for a prompted session is U1.
6. **agy version guard (V5).** agy's version is opaque and self-updating, so measurement-dependent behaviour is gated on the reported version equalling the measured one, and only a re-measurement lifts the guard (GLG, 2026-11-21).

Note (not a GLG decision): the L16 rule will drop the next resume to `new` after a persist failure, because the surviving record is behind the transcript.

`/renew` on an ACP row (P2) is deferred by GLG until the ACP basics are complete and mature.

## Failure contract

The same rule applies to every vendor; only the evidence differs.

- `session/resume` answered a JSON-RPC error, before any prompt: show the reason and take `session/new` with Pi's
  transcript. Nothing ran on the backend, and Pi, not the backend, holds the history.
- The reason shown preserves the JSON-RPC code and message. `-32002` means the session does not exist. agy's resume
  answers a generic `-32603` ("Failed to read session ...; retry, or load it with session/load"), which is not
  evidence of absence, and its advice to load must not be followed after a failed resume. Core keys on "JSON-RPC
  error before any prompt", not on a specific code.
- `session/load` answered a JSON-RPC error (resume absent): the same, visible reason then `session/new`.
- The same record is never offered to `session/load` after a failed resume (V1).
- Resume or load answered success and the first prompt fails: named stop, no new session, no retry. The state is
  unknown and a retry could run a turn twice.
- The request timed out, or the child died during it: named stop, with the stderr tail (Z3).
- The record cannot be read, is stale (L15), or is behind the transcript (L16): `session/new`, visible, with its own reason. The record is a hint, not an authority.

Zed stops on any load or resume error and never opens a new session. Entwurf differs on the first and third
points only, and only because Pi owns the transcript: a new session loses no history and Entwurf does not
reconstruct a prompt to replace it (AGENTS.md Hard Rule 9).

## Notes on divergence from Zed

Zed (`zed-industries/zed` at `ad1058d78d`, 2026-11-20, `agent-client-protocol =5.4.0`) was read, not run. Its
protocol-v1 client is `crates/agent_servers/src/acp/v1.rs`; every Zed path below is under that tree at `ad1058d78d`.

- **Resume before load.** `decideBootstrap` prefers resume, then load (`session-store.ts:313-318`). Zed prefers load
  because it holds no transcript and shows the replay as its history. Pi owns the transcript here, so a replay is
  redundant and resume-first follows from who owns it, not from the protocol. This is a decided divergence.
- **Re-enforcing model and effort.** Zed does not re-apply defaults after load or resume (only `new_session` does,
  `crates/agent_servers/src/acp/v1.rs:1465`). Entwurf re-enforces both after resume or load because the vendor answers its defaults (V2).
- **Teardown.** Zed kills the process group with SIGKILL and no grace (`crates/util/src/process.rs:31-53`); Entwurf sends
  SIGTERM, then SIGKILL after 2 s (`backend.ts:1150`).
- **No session record in Zed.** Its thread store keeps id, title and work dirs; vendor history comes from load or
  list. Entwurf's record (L15) exists only to find the vendor session id again.

## Receipts

R1–R10 are all dated 2026-11-20, n=1 per cell, repository `ddd78246`, claude-agent-acp 0.107.3 (`claude-sonnet-5-5`, effort
`low`) and agy 1.5.12 (`gemini-3.8-flash`, `thought_level low`), in an isolated HOME / XDG /
`PI_CODING_AGENT_DIR` under `env -i` with a scratch cwd outside the repository. `initialize` used the production
`clientCapabilities` `{ session: { compaction: {} } }` except where R1 notes otherwise. Vendor credentials were
reached through the production overlay symlink, never read or copied, and their modification times were unchanged
across the runs. Model and effort were set through the production `enforceModel` and `enforceThinking`, with every
answer captured as readback. The raw artifacts are host-local; the decisive lines are below. The versions here change only with a re-measurement through `scripts/raw-acp-session-measure/`. The live probes are in `scripts/raw-acp-session-measure/` (`LIVE=1 run.sh <scenario> <out-dir>`, README maps scenarios to R1–R10).

- **R1 initialize.** Both agents answered `loadSession: true`; agy `sessionCapabilities` were `resume, close, load,
  list, additionalDirectories`; Claude 0.107.3 advertised `additionalDirectories, close, delete, fork, list, options,
  resume, status, systemPrompt, title` (measured). An earlier probe of the load replay sent `clientCapabilities:
  {}` instead of the production value; its replay is therefore for a client without the compaction capability and
  is not used here (R4 was repeated with the production value).
- **R2 resume.** Claude, new child: zero replay updates, recall of an earlier fact correct. agy: answered in
  2,126 ms, zero updates in the request window, `available_commands_update` and `session_info_update` after it,
  recall correct, `used` continuous (9,833). Unknown id, zero prompts: Claude `-32002 "Resource not found"` with
  `data.sessionId`, 4,292 ms, no update; agy `-32603 "Failed to read session <id>; retry, or load it with
  session/load"`, no `data`, 1,707 ms, no update, no file created. agy fails loud on resume and silent on load
  (R8).
- **R2b production capabilities.** Repeated with the production `clientCapabilities`: Claude `session/resume` replayed zero updates and recalled the earlier fact (`QUARTZ-88`) after a compacted session, and zero replay also held for the resumes in the L11 and L7 runs.
- **R3 close.** Both vendors advertise `close`. After a resume in the same child, `session/close` answers `{}` with
  no update. The vendor session files remain. In the same child afterwards `session/resume` and `session/load` both
  succeed (load replays 4 user and 4 agent chunks), and a new child resumes too. Close releases the live session;
  it does not end resumability.
- **R4 load replay and compaction.** Claude: build was a fact, a `echo TOOLPROBE-171` tool call, a filler turn and
  `/compact` (3 `compaction_update`: in_progress, then completed with the `summary`, then completed; `usage_update` 875). `session/load`, 3,058 ms,
  inside the request window: `user, agent, user, tool_call, tool_call_update, agent, user, agent,
  compaction_update`; the tool call appears once pending and once completed; the compaction appears once, completed
  with the summary, under a new id (`bb742ad0-…`, live was `e5bd5943-…`); the `/compact` prompt is not replayed;
  no `usage_update`. `session/resume`: zero updates, recall correct. agy: `/compact` produced `end_turn`, no
  compaction notification, no tool lifecycle, `used` 9,432 to 10,693 with no drop, so no compacted agy session
  could be built. agy `session/load`, 4,644 ms: `user, agent, user, tool_call (completed), agent, user, agent,
  user(/compact), usage_update(10,693)` (a trailing `usage_update` is not stable: a load after `close` in the same child had none, so a scenario must not require one). agy `resume`: zero updates, recall correct. Compaction on agy by another
  trigger was not found.
- **R5 model and effort after resume or load.** Session set to model and effort low, then three new children on it,
  each asked the same arithmetic question. Claude resume and load answered `model sonnet, effort default`; agy
  both answered `gemini-4-neon, thought_level high`. Re-enforcing both read back the session's values (Claude effort
  `low`, agy model `gemini-3.8-flash` and thought level `low`); re-enforcing the model alone left effort at `default`
  (Claude) and `high` (agy). All answers were correct (391). The question produced no thinking in any condition,
  so the behavioural effect of the re-applied effort is not discriminated; weak signal: agy recall turns at
  default `high` reported `thoughtTokens` 82 and 38, turns at `low` reported 0.
- **R6 teardown.** 12 Claude children, all exited 0 on group SIGTERM; at +0.5 s 6 of 12 groups still held a vendor
  process (1 alive, 5 defunct), at +3 s and +10 s 0; no descendant left its group. 14 agy children, 0 left at
  +0.5 s and +3 s. A final sweep found 0 processes under the run directory.
- **R7 protocol v2.** `initialize` with `protocolVersion: 2` and v1-shaped params, zero prompts: Claude answered
  `-32602 "Invalid params"` (it parsed the v2 schema and found no `info` field; no downgrade and no `-32022`); agy
  answered `protocolVersion: 1` and `loadSession: true`.
- **R8 agy phantom load.** `session/load` of a random uuid, and of a real id from another overlay, both answered
  success `{ sessionId, models, modes, configOptions, _meta }` with zero replay and no session file (the uuid load took 6,389 ms; the other load's time was not recorded);
  agy's own log said `LoadTrajectory … not found in any store`, which never reaches the wire. The production
  `enforceModel` and `enforceThinking` were both accepted on the phantom. The first prompt then failed with
  JSON-RPC `-32603 "Failed to send user message: not_found: trajectory not found: <uuid>"`, no stop reason, no tool
  or text update. A following `session/resume` of that id in a new child answered `-32603`. Entwurf's agy
  prompt-failure verdict `AGY_PROMPT_FAILURE_VERDICT` ("replay unsafe") would fire on that prompt.
- **R9 second holder.** Two children resuming one id with zero prompts: Claude both succeeded (3,109 and 3,129 ms),
  same session id, zero replay, and the transcript grew from 50,384 to 52,066 bytes with no prompt; agy both
  succeeded (4,550 and 4,319 ms), the conversation database kept its size and a `-shm`/`-wal` pair appeared during
  the run. Neither vendor refuses a second live holder. What happens when both prompt was not tested.

- **R10 abandoned `session/new`.** 2026-11-20 22:52–22:55 KST, n=1, zero prompts, production `clientCapabilities`, claude-agent-acp 0.107.3 and agy 1.5.12. Three aborts of `session/new`: kill after the response without `close`, `close` after the response, and SIGTERM before the response. Claude: after every one, no session file and no `session/list` entry; `session/resume` answered `-32002` for the two aborts after the response, and was not tried for the kill before the response, which never received an id (no new state file appeared). agy: `session/new` writes `conversations/<id>.db` at once; it stays whether or not `close` was sent, and a new child resumes it successfully with zero updates; after the kill before the response agy answered `-32603 "Failed to start Antigravity conversation"` and an orphan database remained for an id the client never received. `session/list` returned `[]` for an existing, resumable, never-prompted agy session. agy does not advertise `delete`.

- **R11 record behind the transcript.** Dated 2026-11-21, B's measurement of the production functions only, not a vendor live run. B, `e330d472`, `decideBootstrap` and `buildAcpPrompt` imported unchanged, capabilities `resume: true`: a record with 1 signature against a transcript with 7 (turn 4) gave `{"path":"resume","acpSessionId":"S-OLD","reason":"persisted_compatible_resume"}` and the prompt `[{"type":"text","text":"turn 4: what is the codeword?"}]`. It exercises the two functions only; production does not read the record yet. Source: B's review comment on #171, comment 7046273922.

Everything not yet observed is a `U` row above with Status `unmeasured`.

## The oracle

The table is the baseline; the oracle is what makes a cell true. One scenario list runs against three agents.

1. A fake ACP agent that implements the whole protocol, deterministic, in the ordinary gate. It extends the existing
   fake-backend harness of `pi-extensions/lib/acp/backend.*.test.ts` instead of adding another.
2. Claude ACP, live.
3. agy, live.

Each scenario states the wire observations that decide it: order, counts, session ids, which updates arrived before
or after a response, and the prompt count (zero on every failure path that must not prompt). Live runs are repeated
when a vendor version changes; drift then shows as a changed cell. Until the fake scenarios exist the receipts above
are evidence, not the baseline. A cell that moves from `not-wired` to `implemented` names the test or QK that now
certifies it, in the same change as the code.

Order from here: the whole table is accepted as the baseline, the oracle gate lands before any resume code, then
resume, load, close and the record-store repairs are split by row. No new ACP issue is opened until this page has
no blank cell.
