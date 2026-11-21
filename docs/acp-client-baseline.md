# ACP client baseline

The aim is not the whole ACP specification. It is the core a Pi session uses with a vendor ACP agent (initialize, new,
prompt, cancel, reuse, resume, load, close, the record), each row backed by a check that can fail. This table is that
list: #171 closes inside it, and no follow-up ACP issue is opened (GLG, 2026-11-21). The adapter contract stays in
[acp-backend-rail.md](./acp-backend-rail.md). Evidence, `file:line` and the receipts are in the full document, which
is host-local; its decisive lines are pasted into #171 at close.

## Steps

0. Done: measured the vendors into receipts R1–R12.
1. Done: this table and its oracle.
2. Done: the record store repair (L15) and the version guard decision (V5).
3. Done: the reuse delta that no longer drops user messages (L5).
4. Done: initialize facts and the version guard (L1, V5), and this split of the document.
5. Done: L16, the pendingDispatch marker. A store that cannot be written now refuses the turn.
6. Now: a re-measurement command that compares fresh runs with R1–R10; agy 1.5.13 and Claude 0.109.x move with it.
7. L7, L8, L9, L11, L14, P1, Z3, Z4, V1, V2, V3, Z6 under the version guard, reviewed by GLG; `decideBootstrap` moves after initialize.
8. Close: a last live pass (U12 to U16, P2 with U4), the full gates, the receipts into #171.

## How to read the table

Status is one of: `implemented` (shipped and covered; the QK column names the test), `not-wired` (decided, code to
come), `declined` (a recorded choice), `deferred` (waiting for a decision), `unmeasured` (nobody has observed it).
A scope rule: protocol features that add a harness mode, such as plan mode or todo updates, are declined on
purpose; not supporting them is the Pi style (GLG, 2026-11-21).

## Lifecycle

What a Pi session does with a vendor ACP child, in the order it happens.

| Row | Name                              | Status      | Note                                                                                                                 | QK |
|-----|-----------------------------------|-------------|----------------------------------------------------------------------------------------------------------------------|---|
| L1  | initialize, keep agent facts      | implemented | Each child's version and capabilities are read once at start.                                                        | [QK:ACP-L1-FACTS-READ] |
| L2  | authenticate                      | declined    | Vendor login is the vendor's job; Entwurf never handles credentials.                                                 | — |
| L3  | session/new                       | implemented | A first turn opens one new vendor session.                                                                           | [QK:ACP-ORACLE-L3-NEW] |
| L4  | session/prompt and updates        | implemented | A prompt streams back as text, thinking and tool events, then a named stop reason.                                   | [QK:ACP-ORACLE-L4-PROMPT] |
| L5  | in-process reuse                  | implemented | Later turns in one live Pi reuse the session and send every new user message (U13, U14, U15, U16).                   | [QK:ACP-ORACLE-L5-REUSE] |
| L6  | session/cancel                    | implemented | Abort sends a cancel, waits a grace period, then ends the child.                                                     | [QK:ACP-ORACLE-L6-CANCEL] |
| L7  | session/close                     | not-wired   | Dispose still kills the child; it will send close first when the agent offers it.                                    | — |
| L8  | session/resume                    | not-wired   | A restarted Pi cannot resume the vendor session yet; its first turn is new.                                          | — |
| L9  | session/load                      | not-wired   | Load is the fallback when resume is absent; its replay must never be recorded.                                       | — |
| L10 | session/list                      | declined    | Pi owns the session list, so list is not used (U1).                                                                  | — |
| L11 | model and effort after attach     | not-wired   | After resume or load the vendor answers defaults; both must be set again (U2).                                       | — |
| L12 | request_permission                | implemented | Every permission request is approved; narrowing that is later work.                                                  | [QK:ACP-ORACLE-L12-PERMISSION] |
| L13 | child death and teardown          | implemented | Teardown closes the connection, then ends the child's whole process group.                                           | [QK:ACP-ORACLE-L13-TEARDOWN] [QK:ACP-ORACLE-L13-PROCESS-GROUP] |
| L14 | compaction across attach          | not-wired   | A load replay must not be recorded as a new compaction (U3).                                                         | — |
| L15 | session record store              | implemented | The record is v2 with an outdated state; it is read without deleting, written atomically, shown if it fails.         | [QK:ACP-ORACLE-L15-INVALID] [QK:ACP-ORACLE-L15-UNREADABLE] [QK:ACP-ORACLE-L15-ATOMIC] [QK:ACP-ORACLE-L15-AGENT-DIR] [QK:ACP-ORACLE-L15-DEGRADED-NEW] [QK:ACP-ORACLE-L15-DEGRADED-REUSE] |
| L16 | record currency (pendingDispatch) | implemented | A marker before each prompt makes a restart stop once, then new; resume ordering is judged now, wired with L8 (U12). | [QK:ACP-L16-STANDING-ZERO-SENDS] |

## Pi exits

Where Pi itself reopens or renews a session.

| Row | Name                 | Status    | Note                                                                                      | QK |
|-----|----------------------|-----------|-------------------------------------------------------------------------------------------|---|
| P1  | entwurf_resume_call  | not-wired | Reopening a Pi session keeps its record key, but its first ACP turn is still new.         | — |
| P2  | /renew on an ACP row | deferred  | /renew starts a new Pi session and a new ACP session; the final live run decides it (U4). | — |

## Found in Zed

Read from Zed's client (zed at ad1058d78d); each row asks whether Pi needs it.

| Row | Name                           | Status    | Note                                                                                    | QK |
|-----|--------------------------------|-----------|-----------------------------------------------------------------------------------------|---|
| Z1  | declared client capabilities   | declined  | Only compaction is declared; fs, terminal and plan modes are Pi's or not Pi style (U5). | — |
| Z2  | protocol version               | declined  | Stay on protocol v1 (U10).                                                              | — |
| Z3  | agent exit as a typed error    | not-wired | A child dying during resume or load is a named stop with its stderr tail.               | — |
| Z4  | load response boundary         | not-wired | Updates before the load response are replayed history, not new output.                  | — |
| Z5  | close an abandoned session/new | declined  | Close changes nothing on either vendor, so it is skipped.                               | — |
| Z6  | one holder inside Entwurf      | not-wired | Only one Pi process is guarded today; a second Pi could take the same id (V3).          | — |
| Z7  | recovery by load               | declined  | Pi resume is the recovery path, so Entwurf does not reattach by load.                   | — |
| Z8  | optional verbs                 | declined  | Delete, title, retry and the rest have no Pi surface.                                   | — |
| Z9  | subagent sessions              | declined  | Entwurf announces no subagents, so none are loaded.                                     | — |

## Vendor deviations

Measured on claude-agent-acp and agy; the client must absorb them.

| Row | Name                                   | Status      | Note                                                                                                    | QK |
|-----|----------------------------------------|-------------|---------------------------------------------------------------------------------------------------------|---|
| V1  | agy load of an unknown id succeeds     | not-wired   | Never load after a failed resume; resume first closes this (U6, U7).                                    | — |
| V2  | attach answers vendor defaults         | not-wired   | Both vendors forget model and effort on attach; set them again (L11).                                   | — |
| V3  | no vendor refuses a second holder      | not-wired   | Two Pi processes can hold one id; Entwurf needs its own guard (Z6, U9).                                 | — |
| V4  | agy keeps every session/new            | declined    | Vendor storage is not ours to clean; Entwurf does not delete it (U8).                                   | — |
| V5  | version guard                          | implemented | Attach opens only when the agent reports exactly the measured version.                                  | [QK:ACP-V5-ATTACH-UNMEASURED] |
| V6  | Pi retries a failed turn on error text | deferred    | Pi retries a vendor error text it matches, as a new session after the drop (R12); decided as G5 (NEXT). | — |

## Unmeasured

Not observed yet. Each row names its parent and says whether it blocks the close.

| Row | Name                                               | Status     | Note                                                                                       | QK |
|-----|----------------------------------------------------|------------|--------------------------------------------------------------------------------------------|---|
| U1  | agy list for a prompted session                    | unmeasured | Parent L10. Is a prompted agy session listed? stays: L10 is declined.                      | — |
| U2  | effect of the re-applied effort                    | unmeasured | Parent L11. Does the effort set again change behaviour? stays: behaviour, not correctness. | — |
| U3  | agy compaction                                     | unmeasured | Parent L14. Does agy compact across attach? stays: no trigger exists.                      | — |
| U4  | /renew transition on an ACP row                    | unmeasured | Parent P2. Does /renew work as it stands? blocks close: step 8.                            | — |
| U5  | an agent calling fs read                           | unmeasured | Parent Z1. Does any agent call fs read? stays: the capability is not offered.              | — |
| U6  | a V1 discriminator as a detector                   | unmeasured | Parent V1. Can a phantom load be detected? stays: resume-first closes V1.                  | — |
| U7  | an agent with load but no resume                   | unmeasured | Parent V1. Do load-only agents exist? stays: no such vendor.                               | — |
| U8  | resume of the agy orphan                           | unmeasured | Parent V4. Does an orphan session resume? stays: V4 is declined.                           | — |
| U9  | two holders both prompting                         | unmeasured | Parent V3. What happens when both holders prompt (with Z6)? blocks close: step 7.          | — |
| U10 | a v2-shaped initialize                             | unmeasured | Parent Z2. How does a v2-shaped initialize fare? stays: Z2 is declined.                    | — |
| U12 | vendor state after a cut prompt                    | unmeasured | Parent L16. What did the vendor run when a prompt was cut? blocks close: step 8.           | — |
| U13 | record-relative delta and the max_tokens duplicate | unmeasured | Parent L5. Does a record-relative delta remove the duplicate? blocks close: step 8.        | — |
| U14 | vendor compacts on a multi-block /compact          | unmeasured | Parent L5. Does the vendor compact on a multi-block prompt? blocks close: step 8.          | — |
| U15 | /compact on a new turn                             | unmeasured | Parent L5. Does /compact on a new turn compact anything? blocks close: step 8.             | — |
| U16 | usage on a real length stop                        | unmeasured | Parent L5. What usage does a real length stop report? blocks close: step 8.                | — |

## Decisions (GLG, 2026-11-20 and 2026-11-21)

1. Failure contract: a rejected resume shows its reason and starts new; a prompt that fails after an attach succeeded is a named stop, with no retry.
2. `session/close` is sent on dispose when the agent offers it.
3. A record write failure shows a notice and the turn goes on; a failed clear leaves the marker, so the next reconnect stops once, then new.
4. Permission: approve-all stays the baseline; narrowing it is later work.
5. Declined: authenticate, protocol v2, client fs write and terminal, the optional verbs; `session/list` for now.
6. Version guard: attach that leans on measurement needs the reported version to equal the measured one (V5).
7. Reuse delta: send every user message after the last assistant; `/compact` is read from the first block.
8. pendingDispatch: write a marker before each prompt and clear it at seal; a standing marker stops once, drops the record, then new. Every named stop does the same. With no marker, a user followed by an assistant after the record's prefix means new; else the users are sent in order.
9. If the marker cannot be written, the record cannot be read, or a stop's drop fails, nothing is sent and the turn is refused with its reason.
10. Claude gets the same version guard, because the command override is checked only against the floor.
11. Z5 and V4 are declined (measured in R10).
12. Re-measurement comes before L8 and L9: one command compares fresh runs with R1–R10, and only a changed line needs a person.
13. P2 is closed by the final live run (U4); Z7 is declined, since Pi resume is the recovery path.
14. This page is the short table; the full document with evidence lives in `.agent-reports/`, and its receipts go to #171 at close.

## Receipts

Receipts R1–R10 were measured on 2026-11-20, once each, on claude-agent-acp 0.107.3 (`claude-sonnet-5-5`, effort `low`) and agy 1.5.12 (`gemini-3.8-flash`, `thought_level low`). The versions here change only with a re-measurement through `scripts/raw-acp-session-measure/`.

R11 and R12 (2026-11-21) are offline checks, not vendor runs. The full receipts live in the full document and are pasted into #171 at close.
