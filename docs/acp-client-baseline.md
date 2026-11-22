# ACP client baseline

The aim is not the whole ACP specification. It is the core a Pi session uses with a vendor ACP agent (initialize, new,
prompt, cancel, reuse, resume, load, close, the record), each row backed by a check that can fail. This table is that
list: #171 closes inside it, and no follow-up ACP issue is opened (GLG, 2026-11-21). The adapter contract stays in
[acp-backend-rail.md](./acp-backend-rail.md). Evidence, `file:line` and the receipts are in the full document, which
is host-local; its decisive lines are pasted into #171 at close. The continuity rules are decisions 15–18.

## Steps

0. Done: measured the vendors into receipts R1–R12.
1. Done: this table and its oracle.
2. Done: the record store repair (L15) and the version guard decision (V5).
3. Done: the reuse delta that no longer drops user messages (L5).
4. Done: initialize facts and the version guard (L1, V5), and this split of the document.
5. Done: the L16 base, record v2 and the marker. Its stop and drop rules are replaced by decision 17.
6. Done: the continuity design (decisions 15–18); this table follows it.
7. Done: the re-measurement command and the pins (Claude 0.109.0, agy 1.5.13, SDK 2.8.0); LIVE measured U9, U12, U14, U15.
8. Done: L8 with the continuity rules, under the version guard: L7, L11, L14, P1, Z3, V1, V2, V3, Z6; L9 and Z4 declined;
9. Close: a last live pass (a real Pi resident; an unknown outcome and its reopen), the full gates, the receipts into #171. U4 and U16: #156.

## How to read the table

Status is one of: `implemented` (shipped and covered; the QK column names the test), `not-wired` (decided, code to
come), `declined` (a recorded choice), `deferred` (waiting for a decision), `unmeasured` (nobody has observed it), `measured` (U rows: observed).
A scope rule: protocol features that add a harness mode, such as plan mode or todo updates, are declined on
purpose; not supporting them is the Pi style (GLG, 2026-11-21).

## Lifecycle

What a Pi session does with a vendor ACP child, in the order it happens.

| Row | Name                              | Status      | Note                                                                                                       | QK |
|-----|-----------------------------------|-------------|------------------------------------------------------------------------------------------------------------|---|
| L1  | initialize, keep agent facts      | implemented | Each child's version and capabilities are read once at start.                                              | [QK:ACP-L1-FACTS-READ] |
| L2  | authenticate                      | declined    | Vendor login is the vendor's job; Entwurf never handles credentials.                                       | — |
| L3  | session/new                       | implemented | A first turn opens one new vendor session; new happens only at birth or by human choice (17).              | [QK:ACP-ORACLE-L3-NEW] |
| L4  | session/prompt and updates        | implemented | A prompt streams back as text, thinking and tool events, then a named stop reason.                         | [QK:ACP-ORACLE-L4-PROMPT] |
| L5  | in-process reuse                  | implemented | Later turns reuse the session; delta after the last assistant, per vendor in step 8 (U13, U14, U15, U16). | [QK:ACP-ORACLE-L5-REUSE] |
| L6  | session/cancel                    | implemented | Abort sends a cancel: an answered one keeps the session; after the grace period the child is ended.        | [QK:ACP-ORACLE-L6-CANCEL] |
| L7  | session/close                     | implemented | An idle session that is left gets close first where the agent offers it; its answer decides nothing.       | [QK:ACP-CLOSE-BEFORE-DISPOSE] |
| L8  | session/resume                    | implemented | A Pi that left or restarted resumes the same id with the delta; else a named stop, never new (17).         | [QK:ACP-ATTACH-SAME-ID-DELTA] |
| L9  | session/load                      | declined    | Load is never sent: no measured agent lacks resume (U7), and one without it stops by name (GLG 2026-11-22). | — |
| L10 | session/list                      | declined    | Pi owns the session list, so list is not used (U1).                                                        | — |
| L11 | model and effort after attach     | implemented | After resume the vendor answers defaults; model and effort are set again (U2).                             | [QK:ACP-ATTACH-SETS-MODEL-AGAIN] |
| L12 | request_permission                | implemented | Every permission request is approved; narrowing that is later work.                                        | [QK:ACP-ORACLE-L12-PERMISSION] |
| L13 | child death and teardown          | implemented | Teardown closes the connection, then ends the child's whole process group.                                 | [QK:ACP-ORACLE-L13-TEARDOWN] [QK:ACP-ORACLE-L13-PROCESS-GROUP] |
| L14 | compaction across attach          | implemented | Pi compaction keeps the vendor session: the next input goes to the same id (16-1). Load is not used (U3).  | [QK:ACP-COMPACT-KEEPS-SESSION] |
| L15 | session record store              | implemented | The record is v2; an old v1 record stops the turn and is kept (GLG 2026-11-22). Read never deletes.        | [QK:ACP-ORACLE-L15-INVALID] [QK:ACP-ORACLE-L15-UNREADABLE] [QK:ACP-ORACLE-L15-ATOMIC] [QK:ACP-ORACLE-L15-AGENT-DIR] [QK:ACP-ORACLE-L15-DEGRADED-NEW] [QK:ACP-ORACLE-L15-DEGRADED-REUSE] |
| L16 | record currency (pendingDispatch) | implemented | Marker and v2 record landed. No record is dropped (17); one that cannot be resumed stops its turn (U12).    | [QK:ACP-STORED-SESSION-NO-SECOND-NEW] |
| L17 | birth record before session/new   | implemented | A reservation is written before session/new and the record the moment it answers (17).                     | [QK:ACP-BIRTH-RECORD-BEFORE-SETUP] |
| L18 | block separator in a prompt       | implemented | agy joins text blocks with no separator, so its prompt carries one between them.                           | [QK:ACP-L18-AGY-WIRE-SEPARATED] |

## Pi exits

Where Pi itself reopens or renews a session.

| Row | Name                      | Status    | Note                                                                                                                    | QK |
|-----|---------------------------|-----------|-------------------------------------------------------------------------------------------------------------------------|---|
| P1  | entwurf_resume_call       | implemented | A reopened Pi session resumes its recorded id (L8), never new (LIVE: pi-smoke); the launcher itself is not run.         | [QK:ACP-ATTACH-REOPENED-PI] |
| P2  | /renew on an ACP row      | deferred  | /renew is a new chapter by intent: a new Pi session and a new vendor session (16-2); its live check (U4): #156.         | — |
| P3  | ACP only under entwurf pi | implemented | A tui or rpc ACP turn without --entwurf-control stops and names entwurf pi; explicit pi -p stays one-shot (18).         | [QK:ACP-D18-UNHOSTED-STOPS] |

## Found in Zed

Read from Zed's client (zed at ad1058d78d); each row asks whether Pi needs it.

| Row | Name                           | Status    | Note                                                                                           | QK |
|-----|--------------------------------|-----------|------------------------------------------------------------------------------------------------|---|
| Z1  | declared client capabilities   | declined  | Only compaction is declared; fs, terminal and plan modes are Pi's or not Pi style (U5).        | — |
| Z2  | protocol version               | declined  | Stay on protocol v1 (U10).                                                                     | — |
| Z3  | agent exit as a typed error    | implemented | A child dying during resume is a named stop; the record is kept.                               | [QK:ACP-ATTACH-AGENT-DIES] |
| Z4  | load response boundary         | declined  | Load is never sent (L9), so there is no load response to bound.                                | — |
| Z5  | close an abandoned session/new | declined  | Close changes nothing on either vendor, so it is skipped.                                      | — |
| Z6  | one holder inside Entwurf      | implemented | A holder lease per vendor session: a second Pi stops while it stands; released on the agent's proven end. | [QK:ACP-ATTACH-HOLDER-STOPS] |
| Z7  | recovery by load               | declined  | Pi resume is the recovery path, so Entwurf does not reattach by load.                          | — |
| Z8  | optional verbs                 | declined  | Delete, title, retry and the rest have no Pi surface.                                          | — |
| Z9  | subagent sessions              | declined  | Entwurf announces no subagents, so none are loaded.                                            | — |

## Vendor deviations

Measured on claude-agent-acp and agy; the client must absorb them.

| Row | Name                                   | Status      | Note                                                                                                                 | QK |
|-----|----------------------------------------|-------------|----------------------------------------------------------------------------------------------------------------------|---|
| V1  | agy load of an unknown id succeeds     | implemented | Load is never sent: a failed resume stops and is never followed by load (U6, U7).                                    | [QK:ACP-ATTACH-REFUSAL-KEEPS-RECORD] |
| V2  | attach answers vendor defaults         | implemented | Both vendors forget model and effort on attach; they are set again (L11).                                            | [QK:ACP-ATTACH-SETS-EFFORT-AGAIN] |
| V3  | no vendor refuses a second holder      | implemented | Two Pi processes could hold one id; Entwurf's own guard is the holder lease (Z6, U9).                                | [QK:ACP-LEASE-ONE-HOLDER] |
| V4  | agy keeps every session/new            | declined    | Vendor storage is not ours to clean; Entwurf does not delete it (U8).                                                | — |
| V5  | version guard                          | implemented | Attach opens only on the measured version; an unmeasured one stops with a reason, never new (16-5).                  | [QK:ACP-V5-ATTACH-UNMEASURED] |
| V6  | Pi retries a failed turn on error text | implemented | A turn of unknown outcome ends with a fixed text Pi does not retry on; the next human turn decides (15, G5).         | [QK:ACP-UNKNOWN-FIXED-TEXT] |

## Unmeasured

Not observed yet. Each row names its parent and says whether it blocks the close.

| Row | Name                                               | Status     | Note                                                                                    | QK |
|-----|----------------------------------------------------|------------|-----------------------------------------------------------------------------------------|---|
| U1  | agy list for a prompted session                    | unmeasured | Parent L10. Is a prompted agy session listed? stays: L10 is declined.                   | — |
| U2  | effect of the re-applied effort                    | unmeasured | Parent L11. Does the effort set again change behaviour? stays: not a correctness issue. | — |
| U3  | agy compaction                                     | unmeasured | Parent L14. Does agy compact across attach? stays: no trigger exists.                   | — |
| U4  | /renew transition on an ACP row                    | unmeasured | Parent P2. Does /renew work as it stands? stays: deferred to #156 (GLG 2026-11-22).     | — |
| U5  | an agent calling fs read                           | unmeasured | Parent Z1. Does any agent call fs read? stays: the capability is not offered.           | — |
| U6  | a V1 discriminator as a detector                   | unmeasured | Parent V1. Can a phantom load be detected? stays: resume-first closes V1.               | — |
| U7  | an agent with load but no resume                   | unmeasured | Parent V1. Do load-only agents exist? stays: no such vendor.                            | — |
| U8  | resume of the agy orphan                           | unmeasured | Parent V4. Does an orphan session resume? stays: V4 is declined.                        | — |
| U9  | two holders both prompting                         | measured   | Parent V3. Both holders answered (Claude, agy); no vendor guard, so Z6 is needed.       | — |
| U10 | a v2-shaped initialize                             | unmeasured | Parent Z2. How does a v2-shaped initialize fare? stays: Z2 is declined.                 | — |
| U12 | vendor state after a cut prompt                    | measured   | Parent L16. A cut turn stays in the vendor session and resumes on both; re-send: 16-9.  | — |
| U13 | record-relative delta and the max_tokens duplicate | measured   | Parent L5. Superseded: the turn after a length-cut answer stops (changed); no re-send.  | — |
| U14 | vendor compacts on a multi-block /compact          | measured   | Parent L5. A multi-block prompt does not compact; /compact must be alone.               | — |
| U15 | /compact on a new turn                             | measured   | Parent L5. /compact on a fresh session compacts nothing on both.                        | — |
| U16 | usage on a real length stop                        | unmeasured | Parent L5. Usage on a real length stop? stays: deferred to #156 (GLG 2026-11-22).       | — |

## Decisions (GLG, 2026-11-20 to 2026-11-22)

1. (Replaced by 15–17 for resume.) Failure contract: a rejected resume is an error stop, not new; a prompt that fails after an attach succeeded is a named stop, with no retry.
2. `session/close` is sent on dispose when the agent offers it.
3. A record write failure shows a notice and the turn goes on; a failed marker write is an error before the send (17).
4. Permission: approve-all stays the baseline; narrowing it is later work.
5. Declined: authenticate, protocol v2, client fs write and terminal, the optional verbs; `session/list` for now.
6. Version guard: attach that leans on measurement needs the reported version to equal the measured one (V5).
7. Reuse delta: send every user message after the last assistant that is not error or aborted (16-9); `/compact` is read from the first block.
8. (Replaced by 17.) pendingDispatch: write a marker before each prompt and clear it at seal; a standing marker stops once, drops the record, then new. Every named stop does the same. With no marker, a user followed by an assistant after the record's prefix means new; else the users are sent in order.
9. (Replaced by 17: a failed marker write, an unreadable record or a failed drop is an error stop before any send.)
10. Claude gets the same version guard, because the command override is checked only against the floor.
11. Z5 and V4 are declined (measured in R10).
12. Re-measurement came before L8 and L9: one command compares fresh runs with R1–R10; only a changed line needs a person.
13. P2's live check (U4) is deferred to #156 (GLG 2026-11-22); Z7 is declined, since Pi resume is the recovery path.
14. This page is the short table; the full document with evidence lives in `.agent-reports/`, and its receipts go to #171 at close.
15. Continuity: alive, keep the session; disconnected, resume the same id; outcome unknown, keep the record and stop only that turn. New is for birth or a human choice. (G5: a turn of unknown outcome ends with a fixed text, and the next human turn re-sends the input.)
16. Compaction keeps the vendor session; /renew is a new chapter; a model change stays inside the session or is refused; an unmeasured version or an ambiguous resume error is never absence; an explicit `pi -p` stays one-shot; config drift resumes the same id; a failed turn's input is re-sent, except a range Claude already got (a re-send repeats the work); agy re-sends (a lost message is worse than a duplicate).
17. No internal new: every other path to `session/new` is an error stop that keeps the record and names the cause; G2 and decisions 8 and 9 are replaced by this. A v1 record is not resumed: it stops its turn and is kept (GLG 2026-11-22, L15).
18. ACP runs only under `entwurf pi`; the summary helper is allowed.

## Receipts

Receipts R1–R10 were measured on 2026-11-20, once each, and re-measured on 2026-11-21 with `scripts/raw-acp-session-measure/run.sh all`, once each, on claude-agent-acp 0.109.0 (`claude-sonnet-5-5`, effort `low`) and agy 1.5.13 (`gemini-3.8-flash`, `thought_level low`): no key differed from the stored values, and on Claude R10's S-kill rows were inconclusive (the kill landed after `session/new` answered). The versions here change only with a re-measurement through `scripts/raw-acp-session-measure/`.

R11 and R12 (2026-11-21) are offline checks, not vendor runs. The full receipts live in the full document and are pasted into #171 at close.
