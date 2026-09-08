# NEXT — feat/95-codex-lane

## Step 1 is CLOSED. Step 2 starts when GLG opens it — nothing is decided here.

`docs/adding-a-harness.md` step 1 (six measurements + §3.5 + the tool dialect + the join) is
walked and written down in `scripts/raw-codex-measure/`. **Steps 3–10 are untouched: nothing
installed, no hook, no record, no marker, no doctor.** Step 2 turned out to be **already spent
and wrong** — `codex` is in `META_BACKENDS`/`META_CITIZEN_BACKENDS` and graded `D6
direct-inject` in `pi/entwurf-capabilities.json` with no channel behind it. Not corrected here
(step 8 work).

**Audit state.** terra audited the source layer against `87ac7ad` (**20/20 CONFIRMED, 0
corrected**) and the first three follow-ups against `e2711ae` (**Blocker 0**; two
documentation defects, both fixed in this commit). **S1b-D has no second reader.**

## The eight, plus the four

| # | conclusion | evidence |
|---|---|---|
| M1 hook vocabulary / firing | 12 events; `SessionStart` fires on the **first turn**, ~47s after window open | `[source]`+`[host]` |
| M2 declaration / envelope | TOML `[hooks]` or `hooks.json`; command string, no argv form; stdin carries `session_id` + absolute `transcript_path` | `[source]`+`[host]` |
| M3 config writer | `codex mcp add` → `$CODEX_HOME/config.toml`, table-preserving, one shared file | `[host]` |
| M4 statusline / receive | closed enum, no `statusLine.command`; only wake is app-server `turn/start` | `[source]` |
| M5 topology | join holds; the host process differs by launch mode | `[host]` |
| M6 env vocabulary | zero collision with entwurf names; hooks inherit the launching env | `[source]`+`[host]` |
| M7 tool dialect | `mcp__entwurf_bridge__entwurf_v2` (a 4th spelling); permission surface spells it `entwurf-bridge.entwurf_peers` (a 3rd) | `[source]`+`[host]` |
| M8 §3.5 scope | subagents raise `SubagentStart`; one `SessionStart` per visible host | `[source]`+`[host]` |
| M-B raw probe | `turn/start` idle wake green at 0.153.4, unchanged scripts | `[host]` |
| S1b-A hook trust | managed `/etc/codex` hook runs with **no prompt**, in both modes; `--dangerously-bypass-hook-trust` also works but **kills auto-attach** | `[host]` |
| S1b-B clause 4 | `thread/name/set` + `[tui] status_line` holds a garden id, **wins in both orderings** | `[host]`+`[source]` |
| S1b-C the join | two citizens on one app-server share **one `ppid`** → parent-pid marker cannot separate them | `[host]` |
| S1b-D the key | **it rides every `tools/call`**: `_meta.threadId` + `x-codex-turn-metadata.{session_id,thread_id,turn_id}`, and that id **equals the hook's `session_id`** | `[host]`+`[source]` |

## What step 2/3 inherits

1. **Birth event: `SessionStart`**, first turn, nothing to guess. §3.5 is free.
2. **Receive rail: native-push**, app-server `turn/start`. No `watchPaths` analogue exists.
3. **Identity key: the thread id.** `record.nativeSessionId = threadId` needs no mapping layer —
   hook, app-server and tool-call `_meta` all name the same string. **A parent-pid sender marker
   is the wrong shape here** (S1b-C); consuming `_meta` is new bridge code and is **step 6**.
4. **Two ownership costs, not capability limits.** Non-interactive birth needs a **root-level
   `/etc/codex/` step** (`setup` cannot write it, Hard Rule 17), and `[tui] status_line` needs a
   writer that owns exactly that key (`scripts/omp-config-xdev.py` shape).
5. **Observation, not measured (terra, 2026-09-08):** whether `/new`, resume or fork returns
   `thread_name` to `None`, and therefore whether a birth payload must **re-arm** the visible id.
   OMP paid this exact cell as its `/new` unarm — see `adding-a-harness.md` §7 and `DELIVERY.md`
   §OMP before re-deriving it.

## Not decided, not claimed

No admission, no support claim, no grade change. `codex` remains the declared pre-#82 legacy
exception. The pi GPT-provider path and the ACP-backend prohibition are unchanged.
