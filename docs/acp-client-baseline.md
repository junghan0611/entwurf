# ACP client baseline

The aim is not the whole ACP specification. It is the core a Pi session uses with a vendor ACP agent (initialize, new,
prompt, cancel, reuse, resume, load, close, the record), each row backed by a check that can fail. This table is that
list: #171 closes inside it, and no follow-up ACP issue is opened (GLG, 2026-11-21). The adapter contract stays in
[acp-backend-rail.md](./acp-backend-rail.md). Evidence, `file:line` and the receipts are in the full document, which
is host-local; its decisive lines are pasted into #171. The continuity rules are decisions 15–18.

## Steps

0. Done: measured the vendors into receipts R1–R12.
1. Done: this table and its oracle.
2. Done: the record store repair (L15) and the version guard decision (V5).
3. Done: the reuse delta that no longer drops user messages (L5).
4. Done: initialize facts and the version guard (L1, V5), and this split of the document.
5. Done: the L16 base, record v2 and the marker. Its stop and drop rules are replaced by decision 17.
6. Done: the continuity design (decisions 15–18); this table follows it.
7. Done: the re-measurement command and the pins (Claude 0.109.0, agy 1.5.13, SDK 2.8.0); LIVE measured U9, U12, U14, U15.
8. Done: L8 and the continuity rules under the version guard (L7, L11, L14, P1, Z3, V1, V2, V3, Z6); L9 and Z4 declined.
9. Done: #171 landed on main (0d8c22d9). Left for #156: U4, U16.

## How to read the table

Status is one of: `implemented` (shipped and covered; the QK column names the test), `not-wired` (decided, code to
come), `declined` (a recorded choice), `deferred` (waiting for a decision), `unmeasured` (nobody has observed it).
Only a U row can be `measured` (observed once).
A scope rule: protocol features that add a harness mode, such as plan mode or todo updates, are declined on
purpose; not supporting them is the Pi style (GLG, 2026-11-21).

## Lifecycle

What a Pi session does with a vendor ACP child, in the order it happens.

| Row | Name                            | Status      | Note                                                                                           | QK |
|-----|---------------------------------|-------------|------------------------------------------------------------------------------------------------|---|
| L1  | initialize, keep agent facts    | implemented | Each child's version and capabilities are read once at start.                                  | [QK:ACP-L1-FACTS-READ] |
| L2  | authenticate                    | declined    | Vendor login is the vendor's job; Entwurf never handles credentials.                           | — |
| L3  | session/new                     | implemented | A first turn opens one new vendor session; new happens only at birth or by human choice (17).  | [QK:ACP-ORACLE-L3-NEW] |
| L4  | session/prompt and updates      | implemented | A prompt streams back as text, thinking and tool events, then a named stop reason.             | [QK:ACP-ORACLE-L4-PROMPT] |
| L5  | in-process reuse                | implemented | Later turns reuse the session; the delta follows the last sealed answer (U13, U14, U15, U16).  | [QK:ACP-ORACLE-L5-REUSE] |
| L6  | session/cancel                  | implemented | Abort sends a cancel: an answered one keeps the session; after the grace the child is ended.   | [QK:ACP-ORACLE-L6-CANCEL] |
| L7  | session/close                   | implemented | An idle session that is left gets close first where offered; the answer decides nothing.       | [QK:ACP-CLOSE-BEFORE-DISPOSE] |
| L8  | session/resume                  | implemented | A restarted Pi resumes the same id with the delta; else a named stop, never new (17).          | [QK:ACP-ATTACH-SAME-ID-DELTA] |
| L9  | session/load                    | declined    | Load is never sent: no measured agent lacks resume (U7); one without it stops by name.         | — |
| L10 | session/list                    | declined    | Pi owns the session list, so list is not used (U1).                                            | — |
| L11 | model and effort after attach   | implemented | After resume the vendor answers defaults; model and effort are set again (U2).                 | [QK:ACP-ATTACH-SETS-MODEL-AGAIN] |
| L12 | request_permission              | implemented | A permission request gets its first allow option, else its first; none offered is cancelled.   | [QK:ACP-ORACLE-L12-PERMISSION] |
| L13 | child death and teardown        | implemented | Teardown closes the connection, then ends the child's whole process group.                     | [QK:ACP-ORACLE-L13-TEARDOWN] [QK:ACP-ORACLE-L13-PROCESS-GROUP] |
| L14 | compaction across attach        | implemented | Pi compaction keeps the vendor session; the next input goes to the same id (16-1, U3).         | [QK:ACP-COMPACT-KEEPS-SESSION] |
| L15 | session record store            | implemented | The record is v2; a v1 record stops the turn and is kept (GLG 2026-11-22). Read never deletes. | [QK:ACP-ORACLE-L15-INVALID] [QK:ACP-ORACLE-L15-UNREADABLE] [QK:ACP-ORACLE-L15-ATOMIC] [QK:ACP-ORACLE-L15-AGENT-DIR] [QK:ACP-ORACLE-L15-DEGRADED-NEW] [QK:ACP-ORACLE-L15-DEGRADED-REUSE] |
| L16 | record currency                 | implemented | The record is v2 with a marker for a turn that may have run; no record is dropped (17, U12).   | [QK:ACP-STORED-SESSION-NO-SECOND-NEW] |
| L17 | reservation before session/new  | implemented | A birth reservation is written before session/new; the record, when it answers (17).           | [QK:ACP-BIRTH-RECORD-BEFORE-SETUP] |
| L18 | block separator in a prompt     | implemented | agy joins text blocks with no separator, so its prompt carries one between them.               | [QK:ACP-L18-AGY-WIRE-SEPARATED] |

## Pi exits

Where Pi itself reopens or renews a session.

| Row | Name                      | Status      | Note                                                                                                            | QK |
|-----|---------------------------|-------------|-----------------------------------------------------------------------------------------------------------------|---|
| P1  | entwurf_resume_call       | implemented | A reopened Pi session resumes its recorded id (L8), never new (LIVE: pi-smoke); the launcher itself is not run. | [QK:ACP-ATTACH-REOPENED-PI] |
| P2  | /renew on an ACP row      | deferred    | /renew is a new chapter by intent: a new Pi session and a new vendor session (16-2). Live check (U4): #156.     | — |
| P3  | ACP only under entwurf pi | implemented | A tui or rpc ACP turn without --entwurf-control stops and names entwurf pi; explicit pi -p stays one-shot (18). | [QK:ACP-D18-UNHOSTED-STOPS] |

## Found in Zed

Read from Zed's client (zed at ad1058d78d); each row asks whether Pi needs it.

| Row | Name                                     | Status      | Note                                                                                     | QK |
|-----|------------------------------------------|-------------|------------------------------------------------------------------------------------------|---|
| Z1  | declared client capabilities             | declined    | Only compaction is declared; fs, terminal and plan modes are Pi's or not Pi style (U5).  | — |
| Z2  | protocol version                         | declined    | Stay on protocol v1 (U10).                                                               | — |
| Z3  | agent exit as a typed error              | implemented | A child dying during resume is a named stop; the record is kept.                         | [QK:ACP-ATTACH-AGENT-DIES] |
| Z4  | load response boundary                   | declined    | Load is never sent (L9), so there is no load response to bound.                          | — |
| Z5  | close an abandoned session/new           | declined    | Close changes nothing on either vendor, so it is skipped.                                | — |
| Z6  | one holder inside Entwurf (holder lease) | implemented | A second Pi stops while a holder lease stands; it is released on the agent's proven end, and taken over on proof that both are gone (19). | [QK:ACP-ATTACH-HOLDER-STOPS], [QK:ACP-LEASE-GONE-TAKEOVER], [QK:ACP-LEASE-PID-NAMESPACE], [QK:ACP-LEASE-LIVE-ORPHAN-STOPS] |
| Z7  | recovery by load                         | declined    | Pi resume is the recovery path, so Entwurf does not reattach by load.                    | — |
| Z8  | optional verbs                           | declined    | Delete, title, retry and the rest have no Pi surface.                                    | — |
| Z9  | subagent sessions                        | declined    | Entwurf announces no subagents, so none are loaded.                                      | — |

## Vendor deviations

Measured on claude-agent-acp and agy; the client must absorb them.

| Row | Name                                   | Status      | Note                                                                                                | QK |
|-----|----------------------------------------|-------------|-----------------------------------------------------------------------------------------------------|---|
| V1  | agy load of an unknown id succeeds     | implemented | Load is never sent: a failed resume stops and is never followed by load (U6, U7).                   | [QK:ACP-ATTACH-REFUSAL-KEEPS-RECORD] |
| V2  | attach answers vendor defaults         | implemented | Both vendors forget model and effort on attach; they are set again (L11).                           | [QK:ACP-ATTACH-SETS-EFFORT-AGAIN] |
| V3  | no vendor refuses a second holder      | implemented | Two Pi processes could hold one id; Entwurf's own guard is the holder lease (Z6, U9).               | [QK:ACP-LEASE-ONE-HOLDER] |
| V4  | agy keeps every session/new            | declined    | Vendor storage is not ours to clean; Entwurf does not delete it (U8).                               | — |
| V5  | version guard                          | implemented | Attach opens only inside the pinned range; outside it stops with a reason, never new (16-5).        | [QK:ACP-V5-ATTACH-OUT-OF-RANGE] |
| V6  | Pi retries a failed turn on error text | implemented | A turn of unknown outcome ends with a fixed text Pi does not retry on; the next turn follows 16-9.  | [QK:ACP-UNKNOWN-FIXED-TEXT] |

## Probes

Observed once, or not yet. Each row names its parent; an unmeasured row says why it stays open.

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
| U13 | record-relative delta and the max_tokens duplicate | measured   | Parent L5. Moot: the turn after a length-cut answer stops, so no delta is re-sent.      | — |
| U14 | vendor compacts on a multi-block /compact          | measured   | Parent L5. A multi-block prompt does not compact; /compact must be alone.               | — |
| U15 | /compact on a new turn                             | measured   | Parent L5. /compact on a fresh session compacts nothing on both.                        | — |
| U16 | usage on a real length stop                        | unmeasured | Parent L5. Usage on a real length stop? stays: deferred to #156 (GLG 2026-11-22).       | — |

## Decisions (GLG, 2026-11-20 to 2026-11-22)

1. (Replaced by 15–17.)
2. `session/close` is sent when an idle retained session is released and the agent offers it; its answer decides nothing.
3. A birth id or a dispatch marker that cannot be saved stops the turn before the send (17); a failed save after an answer keeps the turn and owes the seal; live reuse retries it first.
4. Permission: the first allow option, else the first option, else cancel; narrowing it is later work.
5. Declined: authenticate, protocol v2, client fs write and terminal, the optional verbs; `session/list` for now.
6. Version guard: writer and reader in the pin's range, Claude 0.112.0, agy 1.5.9 to <1.6.0 (V5).
7. Reuse delta: send the inputs after the last sealed answer, matched by turn id (a cancel or refusal the vendor answered counts), custom messages included; `/compact` is read from the first block.
8. (Replaced by 17.)
9. (Replaced by 17.)
10. Claude gets the same version guard, because the command override is checked only against the floor.
11. Z5 and V4 are declined (measured in R10).
12. Re-measurement came before L8 and L9: one command compares fresh runs with R1–R10; only a changed line needs a person.
13. Z7 is declined, since Pi resume is the recovery path.
14. This page is the short table; the full document with evidence lives in `.agent-reports/`, and its receipts are in #171.
15. Continuity: alive, keep the session; disconnected, resume the same id; unknown outcome, keep the record and stop that turn; the next goes on where eligible (16-9). New is for birth or a human choice. G5 (re-send every failed input) is superseded by 16-9.
16. Continuity sub-decisions:
    1. Compaction keeps the vendor session.
    2. /renew is a new chapter.
    3. A model change stays inside the session or is refused.
    4. A context that diverged is a named stop.
    5. An out-of-range version never drops a session.
    6. An ambiguous resume error is not absence.
    7. An explicit `pi -p` stays one-shot.
    8. Config drift: a changed MCP set resumes the same id; changed setup text keeps a live session and stops a stored one.
    9. A failed turn's input is re-sent, except a range Claude already got (a re-send repeats the work); agy re-sends (a lost message is worse than a duplicate).
17. No internal new: every other path to `session/new` is a named stop that keeps the record and names the cause. A v1 record is not resumed: it stops its turn and is kept (GLG 2026-11-22, L15).
18. ACP runs only in a resident Pi (`entwurf pi`; the parsed control flag is read first). An explicit `pi -p` or json run is a one-shot; any other tui or rpc turn stops and names `entwurf pi`. Pi's own summary request is a separate stateless exception.
19. A holder lease left by a Pi that died is taken over on the same machine and boot and in the same PID namespace, once its holder and its published agent are each dead by pid and start and the agent's process group is empty (GLG 2026-11-22; it replaces "a dead holder on the same boot stops", which cost the session until a reboot). An agent that still runs stops as a holder, named by its pid; a group not proven empty stops and says to send again later; anything else unproven, a lease written before the namespace was recorded included, stops and names `/new`.

## Receipts

Receipts R1–R10 were measured on 2026-11-20, once each, and re-measured with `scripts/raw-acp-session-measure/run.sh all`, once each, on claude-agent-acp 0.112.0 (`claude-sonnet-5-5`, effort `low`; 2026-11-26, #176) and agy 1.5.13 (`gemini-3.8-flash`, `thought_level low`; 2026-11-21): no stored value differed, Claude's R10 S-kill rows were inconclusive (the kill landed after `session/new` answered; a standalone z5 then matched 13 of 13), and `continuity` exited 4 because its U26 inputs were not given. The versions here change only with a re-measurement through `scripts/raw-acp-session-measure/`.

R11 and R12 (2026-11-21) are offline checks, not vendor runs. The full receipts live in the full document and are pasted into #171 at close.
