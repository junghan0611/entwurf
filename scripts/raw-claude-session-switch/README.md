# Raw measurement — what Claude Code's SessionStart actually says on a session switch (#101)

**Status: RUN on oracle, 2026-09-04, Claude Code 2.1.260, `--model haiku`.** GLG approved the
LIVE cells (S1–S5 first, S6 added after). Six cells, one host, one vendor version — that is the
whole claim. Everything below is verbatim from `~/.pi/agent/meta-bridge-hook.log`, produced by
the repaired hook, which now logs the envelope's `source` on every line it writes.

The #101 repair does **not** depend on any of it: the retirement rule reads the sender marker on
disk and branches on no vendor field. What this lab adds is the envelope order the diagnosis had
to inherit from vendor documentation — and it **refuted one inherited sentence** (see S2/S3).

## What the lab changed in the story

The diagnosis said the two SessionStarts come from the TUI resume picker firing once for a
placeholder id and again for the picked id. **Measured, that is not what happens.**
`claude --resume`, with or without the picker, fires exactly ONE SessionStart carrying the real
id (S2, S3). The two-SessionStart shape comes from a bare `claude` — which mints a real, empty
new session — followed by an in-session `/resume` or `/clear` (S4, S5). The field case fits: `ps`
showed pid 143742 started bare `claude` at 09:31:32, and the second SessionStart landed 4s later.

The consequence for the repair is nil (either way one pid stops serving one garden and starts
serving another, and the sender marker is what says so), but the prose was wrong and is now
corrected in `meta-bridge-hook.ts`, `entwurf-deliverability.ts`, `meta-session.ts` and
`check-meta-hook-session-switch.ts`.

## The three falsification conditions, judged

The pre-run README named three findings that would have changed the repair. All three are
answered:

1. **"A switch leaves the sender marker pointing at the OLD garden when the receiver marker has
   already moved"** — the repair's one real assumption. **Not observed.** In S4 and S5 the
   retirement line is written BEFORE the sender marker is rewritten, and both precede the new
   garden's arm (log order below, same millisecond). The hook reads the pre-switch value it needs.
2. **"Compaction re-fires SessionStart under a NEW native id, so a compacted session is a garden
   switch"** — **refuted.** Compaction (manual S6a and automatic S6b) re-fires SessionStart for
   the SAME native id, attaches the SAME garden, and retires nothing. The same-garden rule covers
   it; nothing had to change.
3. **"Three SessionStarts in one process"** — **not observed** in any cell. Every switch was
   exactly one additional SessionStart, and the two-drive gate fixture stays adequate.

## The cells

| cell | how it was reached | SessionStarts | `source` | native id | retirement |
|---|---|---|---|---|---|
| S1 | bare `claude` | 1 | `startup` | new | — (nothing prior) |
| S2 | `claude --resume` → picker → Enter | **1** | `resume` | the picked one | — (no prior garden in this pid) |
| S3 | `claude --resume <id>` (argv) | **1** | `resume` | the given one | — |
| S4 | bare `claude`, then in-session `/resume` | **2** | `startup` → `resume` | new → picked | **yes** — the startup garden retired |
| S5 | in-session `/clear` | 1 more | `clear` | new | **yes** — the previous garden retired |
| S6a | in-session `/compact` | 1 more | `compact` | **same** | no (same garden) |
| S6b | automatic compaction at ~98% context | 1 more | `compact` | **same** | no (same garden) |

`UserPromptSubmit` carries **no** `source` at all (`source=(unset)`) — worth knowing, since it is
the event that rewrites the sender marker on every keystroke and must retire nothing.

## Verbatim receipts

**S1 — bare `claude`.** One SessionStart, a fresh garden, `source=startup`. Then one turn, whose
`UserPromptSubmit` carries no source and retires nothing (same garden):

```
2026-09-04T04:10:22.678Z INFO create record 20260904T131022-ac38b6.meta.json (event=SessionStart, source=startup, native=bbba9cbe-f11c-4b67-a0bd-991c3f678238)
2026-09-04T04:10:22.681Z INFO sender marker 564537 -> 20260904T131022-ac38b6 (event=SessionStart, source=startup)
2026-09-04T04:10:22.681Z INFO armed watch /home/junghan/.pi/agent/meta-mailbox/20260904T131022-ac38b6/inbox.signal
2026-09-04T04:10:22.682Z INFO receiver marker 20260904T131022-ac38b6 owner=564537 arm=SessionStart source=startup
2026-09-04T04:11:00.196Z INFO attach record 20260904T131022-ac38b6.meta.json (event=UserPromptSubmit, source=(unset), native=bbba9cbe-f11c-4b67-a0bd-991c3f678238)
2026-09-04T04:11:00.198Z INFO sender marker 564537 -> 20260904T131022-ac38b6 (event=UserPromptSubmit, source=(unset))
```

**S2 — `claude --resume`, picker, Enter.** Nothing at all is logged while the picker is open; the
single SessionStart lands on selection, already carrying the real native id. **No placeholder.**

```
2026-09-04T04:12:24.853Z INFO attach record 20260904T131022-ac38b6.meta.json (event=SessionStart, source=resume, native=bbba9cbe-f11c-4b67-a0bd-991c3f678238)
2026-09-04T04:12:24.855Z INFO sender marker 565726 -> 20260904T131022-ac38b6 (event=SessionStart, source=resume)
2026-09-04T04:12:24.855Z INFO armed watch /home/junghan/.pi/agent/meta-mailbox/20260904T131022-ac38b6/inbox.signal
2026-09-04T04:12:24.855Z INFO receiver marker 20260904T131022-ac38b6 owner=565726 arm=SessionStart source=resume
```

**S3 — `claude --resume <id>` (argv).** Same shape as S2:

```
2026-09-04T04:14:53.710Z INFO attach record 20260904T131022-ac38b6.meta.json (event=SessionStart, source=resume, native=bbba9cbe-f11c-4b67-a0bd-991c3f678238)
2026-09-04T04:14:53.711Z INFO sender marker 568726 -> 20260904T131022-ac38b6 (event=SessionStart, source=resume)
2026-09-04T04:14:53.711Z INFO armed watch /home/junghan/.pi/agent/meta-mailbox/20260904T131022-ac38b6/inbox.signal
2026-09-04T04:14:53.712Z INFO receiver marker 20260904T131022-ac38b6 owner=568726 arm=SessionStart source=resume
```

**S4 — THE cell: bare `claude`, then `/resume`.** This is #101 reproduced deliberately, and the
repair firing on it. One pid (566479), two gardens, 33 seconds apart:

```
2026-09-04T04:13:04.371Z INFO create record 20260904T131304-f85f0e.meta.json (event=SessionStart, source=startup, native=aa49d155-8416-41a5-9d59-52d747b428d7)
2026-09-04T04:13:04.372Z INFO sender marker 566479 -> 20260904T131304-f85f0e (event=SessionStart, source=startup)
2026-09-04T04:13:04.373Z INFO armed watch /home/junghan/.pi/agent/meta-mailbox/20260904T131304-f85f0e/inbox.signal
2026-09-04T04:13:04.373Z INFO receiver marker 20260904T131304-f85f0e owner=566479 arm=SessionStart source=startup
2026-09-04T04:13:37.966Z INFO attach record 20260904T131022-ac38b6.meta.json (event=SessionStart, source=resume, native=bbba9cbe-f11c-4b67-a0bd-991c3f678238)
2026-09-04T04:13:37.967Z INFO retired receiver marker 20260904T131304-f85f0e — owner pid 566479 switched to 20260904T131022-ac38b6 (event=SessionStart, source=resume)
2026-09-04T04:13:37.968Z INFO sender marker 566479 -> 20260904T131022-ac38b6 (event=SessionStart, source=resume)
2026-09-04T04:13:37.969Z INFO armed watch /home/junghan/.pi/agent/meta-mailbox/20260904T131022-ac38b6/inbox.signal
2026-09-04T04:13:37.970Z INFO receiver marker 20260904T131022-ac38b6 owner=566479 arm=SessionStart source=resume
```

State immediately after, read from the real store (read-only):

```
- 20260904T131022-ac38b6  backend=claude-code  liveness=unsupported  receiver=active  transcript=exists  cwd=…/scratchpad/lab
- 20260904T131304-f85f0e  backend=claude-code  liveness=unsupported  receiver=none    transcript=absent  cwd=…/scratchpad/lab
```

Both records survive. `meta-receivers/` holds only `20260904T131022-ac38b6.json`, and
`meta-senders/claude-code/566479.json` names `20260904T131022-ac38b6`. Before the repair the
abandoned garden would have read `receiver=active` and accepted mail — that is the #101 defect,
and this is the same shape as the field case (`ac7a1a`, still on this host as evidence).

**S5 — `/clear`.** Same switch shape, `source=clear`, and the retirement fires again:

```
2026-09-04T04:14:18.703Z INFO create record 20260904T131418-31129e.meta.json (event=SessionStart, source=clear, native=eac3c9ae-2873-454b-90ca-11b7ee24b508)
2026-09-04T04:14:18.705Z INFO retired receiver marker 20260904T131022-ac38b6 — owner pid 566479 switched to 20260904T131418-31129e (event=SessionStart, source=clear)
2026-09-04T04:14:18.706Z INFO sender marker 566479 -> 20260904T131418-31129e (event=SessionStart, source=clear)
2026-09-04T04:14:18.706Z INFO armed watch /home/junghan/.pi/agent/meta-mailbox/20260904T131418-31129e/inbox.signal
2026-09-04T04:14:18.706Z INFO receiver marker 20260904T131418-31129e owner=566479 arm=SessionStart source=clear
```

**S6a — manual `/compact`.** SAME native id, SAME garden, no retirement:

```
2026-09-04T04:15:29.240Z INFO attach record 20260904T131022-ac38b6.meta.json (event=SessionStart, source=compact, native=bbba9cbe-f11c-4b67-a0bd-991c3f678238)
2026-09-04T04:15:29.242Z INFO sender marker 568726 -> 20260904T131022-ac38b6 (event=SessionStart, source=compact)
2026-09-04T04:15:29.242Z INFO armed watch /home/junghan/.pi/agent/meta-mailbox/20260904T131022-ac38b6/inbox.signal
2026-09-04T04:15:29.243Z INFO receiver marker 20260904T131022-ac38b6 owner=568726 arm=SessionStart source=compact
```

**S6b — automatic compaction.** Reached by having the session read large repo files until the
context filled: 60% → 80% → 91% → 98% (196.5K/200K of a 200K window), then one more large read
tipped it. Byte-identical shape to S6a; context fell to 72.1K afterwards:

```
2026-09-04T04:29:06.583Z INFO attach record 20260904T131022-ac38b6.meta.json (event=SessionStart, source=compact, native=bbba9cbe-f11c-4b67-a0bd-991c3f678238)
2026-09-04T04:29:06.585Z INFO sender marker 568726 -> 20260904T131022-ac38b6 (event=SessionStart, source=compact)
2026-09-04T04:29:06.586Z INFO armed watch /home/junghan/.pi/agent/meta-mailbox/20260904T131022-ac38b6/inbox.signal
2026-09-04T04:29:06.587Z INFO receiver marker 20260904T131022-ac38b6 owner=568726 arm=SessionStart source=compact
```

Manual and automatic compaction are the same event to this hook. Note it needs ~98% of the window
before it fires, and that a session under a smaller model or a shorter window will reach it sooner
— the threshold is the vendor's, not ours.

## How to re-run

`tmux new-session -d -s lab -c <scratch> 'claude --model haiku'`, drive it with `send-keys` (send
the text and the `Enter` as SEPARATE calls — a combined one leaves the prompt typed but
unsubmitted), and read the delta of `~/.pi/agent/meta-bridge-hook.log` between cells. Nothing else
is needed: the hook log is the instrument. A cell costs a few seconds of a cheap model, except
S6b, which costs one full context window.

## Boundary

One host (oracle), one vendor version (2.1.260), one model (Haiku 4.5), one operator's config.
The cells say what this Claude does here; they do not certify another host, an older Claude, or
a different terminal. The repair does not rest on them — it rests on the sender marker — which is
why a refutation here (S2/S3) corrected the prose and left the code alone.
