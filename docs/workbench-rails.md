# Workbench rails — one sibling, any workbench

Status: direction for #178, first shipment target 0.70.0. This page is the canonical symmetry table. It states claims and the proof each one has today, not a release acceptance. Chronology and raw receipts belong to issue #178 and its lab notes. The mechanism of each rail is in [hc-launch-rail.md](./hc-launch-rail.md), [herdr-launch-rail.md](./herdr-launch-rail.md) and [mux-launch-rail.md](./mux-launch-rail.md).

## Why this page steers Entwurf

The tools are moving toward agent workbenches that carry a multiplexer inside them: Herdr Core with its App, and Rex. Each of them polishes its own mux rail and leaves the agents themselves (Pi, Claude Code and others) as they are. Entwurf does not follow any one of those rails. It keeps the one thing that is the same on all of them: a sibling is asked, called, declines or answers at one address, whichever workbench it sits on. With that held, tmux, Rex, Herdr and Herdr Core are no different from each other. Reading a rail's state, or reopening through a terminal protocol, are things Entwurf may take in or apply; they never replace the address.

The operator is moving off tmux toward multiplexer-aware workbenches, so this is a turning point. It is worth more for reach than adding a protocol such as ACP.

## The workbench can change; the citizen does not

A sibling's garden id is not a tmux pane, a Herdr Core terminal, a Herdr workspace, a restore command or an app's agent label. A named sibling stops through its own lifecycle and reopens on a supported workbench under the same record and the same native session. It keeps being asked and answering at the same address.

The steps below are separate facts, and no one of them proves another:
- the launch receipt
- the owner or adoption observation
- the place shown
- recall of the earlier conversation
- the actual delivery
- the reply

Nothing here moves a live process, invents an address, adds a second harness, or makes a status an authority. A failed or missing observation is not a location.

## Scope

- **Backends:** Pi, pi-durable and Claude Code, and no others. Other backends keep their existing contracts and verification; this page does not extend them.
- **Workbenches:**
  - tmux and Herdr Core (with its App) are the active transition;
  - the Herdr TUI rail is carried as an existing regression and comparison rail;
  - Rex and OSC 7577 (#177) are separate integration questions, not rails admitted by analogy.
- **OSC 7501** is a program status view. It is never a placement, identity, liveness or delivery input.
- **Symmetry rule:** what the operator and a sibling see must be the same for all three backends. A transport may differ; behavior that looks the same does not need the same implementation. An asymmetry is a gap to close, never a backend difference to document away.

## Proof levels

Every cell carries one of these:

| level | meaning |
|---|---|
| **M** | measured: the receipt is named, and its candidate, host, caller, target and n are in the evidence key below |
| **R** | read from source (`file:line`); not run |
| **R + gate** | read, and held by a deterministic test on built fixtures; not a live observation |
| **U** | unmeasured |
| **GAP** | a known gap, with its cause and the next evidence |
| **OUT** | deliberately out of scope, with the reason |

A cell is never promoted from an outline, a neighbouring cell, or an earlier candidate's receipt. Every M on this page was taken on an earlier candidate than the branch tip; none is a measurement of the 0.70.0 candidate.

## Evidence key

Lab receipts are host-local (`oracle`, under the #178 lab directory) and do not travel with the repository; each is cited by its name. Herdr Core was 0.1.20 in every `L` row. All rows are 2026-11-28, n=1 per target unless stated.

| key | receipt | candidate | caller or surface → target | what it holds |
|---|---|---|---|---|
| L1 | `live1/RECEIPT.md` | checkpoint 1 working tree | stand-in shell in a Herdr Core terminal, CLI → pi-durable `a05627` born in Herdr Core | adopted; code word recalled (ACK2, ACK3); v2 round trip |
| L3 | `live3/RECEIPT.md` | `f0f251b9` | fresh: one Claude Code citizen `b48126` in tmux, tool → Pi, Claude Code, pi-durable. Resume: a stand-in shell script in a Herdr Core terminal with `PATH` supplemented, `entwurf resume <id>` → each of the three, tmux-born and dormant | three launch receipts; socket answered / `receiver-armed` / `adopted`; three `ACK2` code-word replies to the tmux writer; GLG's App and Idle-list observations |
| L7 | `live7/RECEIPT.md` | checkpoint 4 working tree | tmux shell, CLI → Claude Code `5541ae` born in Herdr Core | reopened in tmux, `receiver-armed`; placement rows with and without the opt-in |
| L8 | `live8/RECEIPT.md` | `99f1f5c8` | (a) the picker typed in a Herdr Core terminal → Pi `ea3378`; (b) `entwurf_peers` in a Claude Code bridge started with the opt-in | (a) reopened, socket answered; (b) rows `hc oracle/t1g` and `tmux entwurf:9` |
| L9 | `live9/RECEIPT.md` | working tree on `99f1f5c8` | (A) CLI under the core's own `PATH` → Claude Code; (B) `peer-facts` from a tmux shell with the opt-in | (A) exit 4 `hc-runtime-unresolved`, then reopened with `PATH` supplemented; (B) pi-durable `tmux entwurf:9` then `hc oracle/t1w`, Claude Code `hc oracle/t1g` and `hc oracle/t1r` |
| L10 | `live10/RECEIPT.md` | dist built from `56ca6f28` | `entwurf_peers` in a compiled pi-durable bridge started with the opt-in | rows `hc oracle/t1g` and its own `tmux lab178:2` |
| L11 | `live11-pathB/RECEIPT.md` | caller bytes loaded 12:53, about `f0f251b9` (TypeScript source, not the shared dist) | Claude Code `d9ecc0` in a Herdr Core terminal, `entwurf_resume_call` on GLG's own request → pi-durable `a05627` | launch receipt and `adopted` from the tool's text; App visibility and recall are GLG's observations; the v2 round trip is relayed by `68bd94` |
| L12 | `live12/RECEIPT.md` | carrier at `c286382a`; Pi 1.6.1; Claude Code 2.1.332 | each program started in a private test core with no viewer attached, no model and no credential; ×2 runs each | the core's `status` events and the raw OSC 7501 bytes each program wrote and was sent |
| P1 | `peers-2045/rows.txt` | HEAD not recorded; the working tree held the checkpoint 11 candidate | `peer-facts` from a tmux shell, opt-in unset, 20:32 KST | four Claude Code rows `tmux entwurf:<window>` |
| #157 A-L1, G1a, B3, stage 4 | [baseline-receipts.md](./baseline-receipts.md) | earlier releases' candidates | named in each cell | Herdr TUI rows |

## Table 1 — reopening the same id

A cell is never read as "any caller → any target": the evidence key names both. Fresh birth and same-id reopening are separate rows.

| verb × workbench | Pi | Claude Code | pi-durable |
|---|---|---|---|
| fresh, tmux | M (L3; Claude Code caller only) | M (L3; same) | M (L3; same) |
| fresh, Herdr TUI | R (agent start; [herdr-launch-rail.md](./herdr-launch-rail.md)) | R (agent start) | R (`layout.apply`); M (#157 A-L1: native Pi caller) |
| fresh, Herdr Core | OUT: refused by name (`hc-fresh-unsupported`) unless deliberately admitted | OUT, same | OUT, same |
| resume into tmux | R | R; M (L7: operator CLI from a tmux shell, target born in Herdr Core) | R (#157 B3 did not measure tmux) |
| resume into Herdr TUI | M (#157 G1a: native Pi caller, pre-final) | M ×2 (#157 stage 4: synthetic callers, two earlier surfaces; the second with a blind recall) | M (#157 B3: synthetic caller, pre-final) |
| resume into Herdr Core, operator CLI | M (L3): same-id socket answered | M (L3): `receiver-armed` | M (L3): `adopted`; M (L1) |
| resume into Herdr Core, a human at the App keyboard | U | U | U |
| resume into Herdr Core, sibling tool caller | U | U | M (L11: Claude Code caller only). Launch and adoption are the tool's; visibility, recall and the round trip are three other sources |
| resume into Herdr Core under the core's own `PATH` | GAP: U for Pi, expected as Claude Code | GAP: refused `hc-runtime-unresolved`, exit 4 (L9, CLI) | GAP: U |

## Table 2 — where a sibling is

The question is where a sibling is, asked from each lister seat. CLI `peer-facts`, the MCP `entwurf_peers` view and the resume picker are separate surfaces.

**Lister rows: a property of the lister, the same across all three backends**
- **G1, the MCP view equals the CLI for the same rows:** GAP. A bridge that loaded before the placement readers existed shows every row unobserved. A bridge started after them, with the opt-in, showed places: M (L8: Claude Code bridge; L10: compiled pi-durable bridge). Neither was compared row for row with the CLI, so parity is U. A Pi bridge is U.
- **The MCP view's cap:** it shows up to 32 rows; unbookmarked test rooms and overflow are counts only. A row omitted by the cap is not a row with an unknown place. This is today's behavior, not a decision on "every sibling".

**Target rows**

| lister seat → target place | Pi | Claude Code | pi-durable |
|---|---|---|---|
| tmux lister, owner is the pane's direct process | GAP G3: no Pi owner pid source | M (P1, CLI) | M (L9 B, CLI) |
| tmux lister, owner started by hand behind a shell | GAP G3 | R + gate (`TMP-FG-*`); live U | R + gate (`TMP-FG-*`); live U |
| tmux lister, target in a Herdr Core terminal | GAP G3 (L8: a Pi in a core terminal read unobserved) | M with the opt-in set (L9 B, CLI; L8, MCP); deployment GAP G2 | M with the opt-in set (L9 B, CLI); deployment GAP G2 |
| lister inside Herdr Core, target in Herdr Core (the App's own seat) | GAP G3 | GAP G2: the opt-in is not in the core's program environment | GAP G2, same |
| lister inside Herdr Core, target in tmux | GAP G5 | GAP G5 | GAP G5 |
| target in Herdr TUI | R: conditional, through the official session-file join | R: conditional, exact session id | GAP: no native join (a layout launch makes no agent report) |

**Resume picker**
- It reads the CLI provider, not the MCP view (`pi-extensions/lib/resume-picker-production.ts:89`), so G1 does not apply; G2 to G5 do, through the environment of the shell that typed `entwurf resume`.
- Proof: R + gate (`RESUMEROWS-PLACEMENT-VIEW`, `RESUMEPICK-PLACEMENT-*`, `RESUMEPICK-SELECTED-*`); live U. No picker has been run with a placed row on screen.
- It draws nothing for an unobserved row and never prints that word (`pi-extensions/lib/resume-picker.ts:623`, `:787`). Every GAP cell above is therefore an empty place in the picker.
- The column appears only on a wide terminal, and only when a row in the directory scope shown has a real place (`:539`, `:585-586`).
- A dormant sibling is unobserved by structure. The picker shows a place only for a sibling that is open now; it does not say where a sibling to resume was, or will reopen.

## Table 3 — what the operator sees, and the conversation itself

| | Pi | Claude Code | pi-durable |
|---|---|---|---|
| program status reporter (OSC 7501) | R: Pi 1.6.1 `ProgramStatusReporter`, interactive mode only; reports `blocked` and the session name. M (L12): query, `idle`, `clear` on the wire | M (L12): it sends the support query and, on its first-run screen, no status. Logged in: U | R + gate (`PI-DURABLE-STATUS-*`); never `blocked`, never a session name. M (L12): the query is answered with no viewer attached; `idle` and `clear` on the wire |
| Core shows the status | M (L12): `idle` with `app=pi` at start, cleared on quit. `working`, `done`, `error`: U | M (L12), first-run screen only: no status value; one unexplained `reported: true, status: null` event, which is not proof that it reports. Logged in: U. Observed (L3): GLG's Idle list held it | M (L12): `idle` with `app=pi-durable` at start, cleared on quit. `working`, `done`, `error`: U. L3 is the control from before the reporter existed |
| App shows the sibling's terminal | M (L3: GLG's observation, "all three visible"; which terminal is not stated) | M (L3, same) | M (L3, same; L11: GLG, labeled `pd`) |
| screen and status agree on a run that ended with no answer | Observed (L12): a prompt refused for a missing API key left the status `idle`. Whether a run started is U, so this is not yet the row's case | U | Measured disagreement (L12, at `c286382a`): the screen said "No answer: model_error", the status stayed `idle`. Fixed after it, R + gate (`PI-DURABLE-STATUS-UNSEEN-FAILURE`; `PI-DURABLE-STATUS-RESTING-ONE-LIST`); live U until measured again; that the live sequence was the one the fix reads is from the source, not measured. A run started in the same commit as a failure and answered unseen is still told wrong |
| recall after reopening, Herdr Core | M (L3; not blind) | M (L3; not blind) | M (L1, L3; not blind); M (L11, human-read) |
| recall after reopening, Herdr TUI | U | M (#157 stage 4, blind) | U |
| delivery and reply after reopening, Herdr Core: the writer asks first | M (L3; `control-socket → sent`) | M (L3; mailbox) | M (L1, L3); M (L11, relayed) |
| delivery and reply after reopening: the reopened sibling asks first | U | U | U |

Open decision (symmetry): Pi reports `blocked` and its session name; pi-durable reports neither. GLG decides whether this is a gap or an accepted difference.

## Gaps and the next evidence

- **G1, stale loaded bridges.** Each process keeps the bytes it loaded at start. A Claude Code lister runs the TypeScript source; Pi and pi-durable listers run the compiled bridge and see a change only after `pnpm run build-bridge` and their own restart. A restart adds no environment variable.
  - Next: with one current lister on GLG's approval, compare MCP and CLI for the same rows, plus one stale negative.
  - No fleet restart first.
- **G2, Herdr Core lister opt-in.** The mechanism works when `ENTWURF_HC_PLACEMENT_SOCKET` is set (L8, L9, L10). Deployment is the gap: the variable exists only by an operator's choice, and a core does not hand it to the programs it starts.
  - (a) The operator's own shell profile closes the tmux-lister seat with no code change. It does not close the lister-inside-Core seat.
  - (b) Borrowing `HC_TERMINAL_SOCKET` would close that seat, but reverses a recorded decision and needs GLG's decision. (c) Passing the variable through at the core's launch is the other route.
  - Next: one explicit endpoint on one lister.
- **G3, Pi owner pid.**
  - Candidate: a placement-only, bounded `get_info` for a record-backed, non-renewing live Pi when a tmux or Herdr Core listing is usable. Both ids must match; any mismatch or timeout reads unobserved, with no retry.
  - Its cost, named: it brings back one RPC per live Pi socket per listing, the cost #50 C4 removed. It is narrower than that enrichment, not free of it.
  - `SO_PEERCRED` would name the peer process, not its native chapter, and the current probe has no accessor for it (inherited from the ASTRA review; not re-read here).
  - A hand-started Pi behind a shell needs the G4 join as well.
  - Needs GLG's decision. Compare on one fixture first.
- **G4, hand-started behind a shell.** The pane's process is the shell, so the owner pid never equals it. This covers `claude` typed in a bash pane, not only pi-durable. The tmux owner now looks once more on a pid miss (`pi-extensions/lib/owner-foreground.ts`); the mechanism is in [hc-launch-rail.md](./hc-launch-rail.md) §5.
  - The contract is the foreground JOB LEADER: the owner's pid is its process group and that group is the tty's foreground group, on the pane's own tty and in the pane's own session, with the process checked against the receiver marker's start key in two reads.
  - Its named weaker meaning: "this pane's foreground job is this citizen", not "this citizen draws the screen". A background or suspended citizen, and a member of the foreground group that does not lead it, read unobserved.
  - tmux only. A citizen started by hand in a Herdr Core terminal stays a GAP, and no tmux proof transfers to it.
  - Next: one live listing from a tmux shell with a hand-started pi-durable and a hand-started Claude Code, plus one citizen in the background behind another program.
- **G5, a Herdr Core lister seeing tmux.** A program in a core has no `TMUX`. Needed for the two-way listing.
  - Next: an explicit, operator-named tmux endpoint, symmetric to G2. No guessing.
- **Core `PATH`.** A program a core starts has the core's `PATH`. Entwurf adds no resolver or fallback; the mechanism and the measured refusal are in [hc-launch-rail.md](./hc-launch-rail.md) §6.
- **Claude Code program status.** No reporter is known. The App's Idle list held Claude Code (L3), so something reports; its source is not read.
- **Core status.** `idle` and `clear` are measured for Pi and pi-durable (L12). Next: the remaining `working`, `done` and `error` cells, which need a model or a stand-in provider, on a test core and never the operating one; and a logged-in Claude Code.
- **"Every sibling appears".** GLG has not decided whether this means a full repo-scoped MCP listing, or a correct place on every displayed open row. The lister-inside-Core seat is part of what it must answer. Neither changing the cap nor replacing the MCP surface with the CLI is authorized by this page.

## Ownership

- This page owns the direction and the claims.
- [README.md](../README.md) and [ROADMAP.md](../ROADMAP.md) link here.
- [hc-launch-rail.md](./hc-launch-rail.md) owns the Herdr Core mechanism.
- The branch NEXT holds only the active stage and the next executable gap.
- Issue #178 and the lab receipts hold chronology and raw measurements.
- 0.70.0 is the first shipment target. A 0.70.x patch is a further attempt, not an exemption from acceptance. An unfinished cell stays visible and conditional. The direction is not complete until every in-scope cell has its agreed proof. A release candidate is proposed only with its blockers, measured limits and permitted deferrals spoken plainly.
