# Raw measurement — what Claude Code's SessionStart actually says on a session switch (#101)

**Status: DESIGN ONLY. Nothing here has been run.** Every cell below costs real Claude
Code invocations on a real host, so the run is GLG's decision, not this lane's. The #101
repair deliberately does **not** depend on any of it: the retirement rule reads the sender
marker on disk, never the vendor's `source` field, so it holds on hosts and versions this
lab has never seen. What the lab would add is the *envelope order* — the thing the #101
diagnosis had to inherit from vendor documentation because nothing on this host recorded
it.

## What is already measured, and where

Not everything here is unknown. Two receipts exist and should not be re-bought:

- **A switch fires two SessionStarts in one pid, four seconds apart, the second under the
  id the operator picked.** Measured on oracle, `~/.pi/agent/meta-bridge-hook.log`
  2026-09-04 09:31:35 → 09:31:39 (pid 143742: create `…-ac7a1a` native `79e05f96…`, then
  attach `…-e09b66` native `f654eed7…`). Both armed a receiver marker; the first
  transcript was never written.
- **The `source` field exists in the SessionStart envelope** (`startup | resume | clear |
  compact`) — vendor documentation, *inherited*, not measured here. As of the #101 repair
  the hook LOGS it on every line it writes, so the next real session switch on any
  installed host produces this receipt as a side effect of ordinary use. **Read the hook
  log before running any cell below** — several cells may already be answered for free.

## The cells, and what each one is for

Each cell is: open a Claude Code session the named way, then read
`<pi-agent-dir>/meta-bridge-hook.log` for the lines this session produced. The log is the
instrument; nothing else needs writing.

| cell | how to reach it | what to record | why it matters |
|---|---|---|---|
| S1 | `claude` in a fresh cwd, no resume | one SessionStart, its `source`, native id, pid | the baseline: does a plain open really carry `startup`? |
| S2 | `claude` → pick a conversation in the TUI resume picker | BOTH SessionStarts in order: `source`, native id, whether the pids match | the #101 shape. Confirms the placeholder's `source` and whether the second is `resume` |
| S3 | `claude --resume <id>` (argv, no picker) | how many SessionStarts, with which `source` | tells us whether the picker is what mints the placeholder, or the process start is |
| S4 | `/resume` inside a running session | same | in-process switch with no new pid — the marker retirement's other entrance |
| S5 | `/clear` inside a running session | same | expected same shape as S2 with `source=clear`; if it differs, the retirement rule sees it anyway (disk), but the log would say so |
| S6 | let a long session auto-compact | whether a SessionStart fires at all, and with which `source` | `compact` is the one value nothing in entwurf has ever seen; if it re-fires SessionStart, it re-arms a marker for the SAME garden (harmless by the same-garden rule — this cell is what proves that claim rather than assuming it) |

## What a finding would change

- If some cell shows a switch that leaves the sender marker pointing at the OLD garden
  (i.e. the hook writes the receiver marker for the new garden before the sender marker
  moves), the retirement would be reading a stale pointer — the repair's one real
  assumption, and this is the measurement that could refute it.
- If `compact` re-fires SessionStart under a NEW native id in the same pid, the compacted
  session is a garden switch by this repair's definition and the old garden is retired
  correctly — but the operator would see a garden id change across a compaction, which is
  a product question, not a bug in the rule.
- If a cell shows THREE SessionStarts, the "previous garden" is whatever the sender marker
  last named, which is still correct — but the hermetic gate's two-drive fixture would owe
  a third drive.

None of these would move the reader-side join (`check-meta-hook-session-switch` cell B),
which is measured hermetically and does not care why the switch happened.

## Cost and boundary

Six sessions on one host, each a few seconds of model time, plus the reading. No cell
sends a message, spends a sibling turn, or writes to another citizen's garden. The lab
writes nothing but this README and whatever transcript the operator chooses to paste in;
receipts pasted here must carry the decisive log lines verbatim, because a host-local path
does not travel to the next sibling.
