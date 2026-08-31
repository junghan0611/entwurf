# Raw measurement — the ACP Claude child that leaves at exit 0 (#72)

Receipts for the 2026-09-01 diagnosis pass on
[#72](https://github.com/junghan0611/entwurf/issues/72). Everything below was read
off pi session transcripts and vendor `dist/` on the named hosts. Nothing here is
a repair. The **cause is closed** — see §"ANSWERED": the child is shot by
`acp-zombie-reaper.service`, a timer installed on oracle for a *different*
harness's bug. The four retired candidates below stay because they are what
cleared the ground for it.

Evidence grade is on every claim. `measured here` names the file the row came
from; `read at <path:line>` names source that was read, not run.

- `reaper-correlation.py` — lines the anomalous turns up against this host's
  reaper SIGTERM events. Zero events on a host without the unit; that null is
  itself the receipt for the split.
- `acp-turn-population.py` — run per host, `> acp-pop-<host>.json`. One row per
  ACP-backed assistant turn: outcome class, new-vs-reuse, tool-call count,
  totalTokens, child age, and whether the previous child had already died between
  turns. Re-runnable; the numbers below are its output.

## The signature, from logs rather than a screen

The #72 handoff carried the signature as quotes read off Termux screenshots. This
pass re-read it from the host's own transcript, which is the receipt a screenshot
is not.

Measured here — `oracle:~/.pi/agent/sessions/--home-junghan-nixos-config--/2026-08-31T09-50-53-520Z_01a0573a-9a50-78f2-bbb3-d833d5df50b8.jsonl`,
records **173 / 175 / 177**, field `message.errorMessage`. Byte-identical to the
screenshots plus one line they cut off (`(Use \`node --trace-warnings ...\`)`).

Child transcripts, measured here — `oracle:~/.pi/agent/claude-config-overlay/projects/-home-junghan-nixos-config/`
`a190b806-91a3-4d74-a760-668ae60d57f2.jsonl`, `c798f097-9b28-432d-af2c-e9f73ef023ce.jsonl`,
`b40bce08-3556-42fa-b358-76b09212632f.jsonl`. Lifetimes 1177s / 957s / 983s.

thinkpad holds **no** sample: all three sessionIds are absent from its
`~/.pi/agent/sessions` and overlay `projects` (measured here, 2026-09-01).

## Three readings the handoff carried that the sources do not support

1. **"All three samples are new children, not retained reuse."** Record 173 opens
   with `[acp: reusing live session]` — it is a reuse turn. The `resume=none` in
   the stderr tail is the *child's own spawn line*, and that buffer is
   session-scoped by design, so it outlives the turn and says nothing about it
   (read at `pi-extensions/lib/acp/backend.ts:207-212`, `:1206-1210`). The split
   is 1 reuse + 2 new.

2. **"`[tool:start] Terminal` is where it fails."** `Terminal` is the placeholder
   *title* the vendor gives a `Bash` tool call whose `input.command` has not
   finished streaming (read at
   `node_modules/@agentclientprotocol/claude-agent-acp/dist/tools.js:38`). Every
   Bash call opens that way, in successful turns too. The real shape is: the last
   `tool:start` has no matching `tool:done`.

3. **"`[Request interrupted by user for tool use]` in the child transcript."**
   It lands 0.2–0.4s *before* pi seals the turn — it is `dispose()`'s abort
   artifact, the same misattribution the 2026-08-20 issue comment already named,
   in its `for tool use` variant. Consequence, not cause.

## Four candidate causes, retired by counterexample

| candidate | retired by | receipt |
|---|---|---|
| the `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning | child `a190b806` printed it at spawn (`11:33:24Z`), then delivered a **successful** turn (record 171, `stopReason=stop`, `11:34:32Z`), then died on the next turn (record 173). The tail is the last 1000 chars of the session-scoped buffer and holds only the spawn lines, so nothing else was written across that success. | oracle session jsonl, records 171/173 + child transcript |
| the `bypassPermissions` config overlay | `~/.pi/agent/claude-config-overlay/settings.json` is **byte-identical** on thinkpad and oracle. thinkpad: 0 exit-0 deaths in 507 turns. The overlay is a constant across the split. | `cat` on each host, 2026-09-01 |
| context size | oracle **successes** reached `totalTokens` 416111 — above all three failures (382174 / 390831 / 404972). thinkpad successes reach 494431. | population output |
| tool-call volume in one turn | on oracle no success exceeded 39 tool starts while all four failures were 47/73/61/67 — but thinkpad succeeds at 138, 111, 89, 78. Real correlation inside oracle; refuted as a cause. | population output |

Elapsed time has no *constant* — lifetimes 1177s / 957s / 983s (+969.9s for the
2026-08-20 sample) share no value — but it is the axis after all: every one is
over the reaper's 900s floor (§"ANSWERED"). Read this row as "no constant", not
as "age is irrelevant". The 2026-07-30
`prompt timed out after 600000ms` turns are a **different, already-removed**
failure and the classifier keeps them in their own bucket so they cannot be
folded in.

## The population

| host | ACP turns | EXIT0 mid-turn | died between turns | max starts on a success | max totalTokens on a success | pi |
|---|---|---|---|---|---|---|
| oracle (aarch64, 4 cores) | 360 | **4** | **4** | 39 | 416111 | 0.84.3 |
| thinkpad (x86_64) | 507 | **0** | **0** | 138 | 494431 | 0.84.3 at collection; 0.84.4 since |

All four oracle EXIT0 turns are `claude-opus-5` (44 opus-5 turns on that host).
thinkpad ran 340 opus-5 turns with none. So the model is not the discriminator
either.

**What the split is bounded by, so it is not read as "the host is cursed":** same
pi (0.84.3 at collection), same node (v24.18.1), same
`@agentclientprotocol/claude-agent-acp` 0.70.0, same ACP SDK 1.3.0, byte-identical
overlay. Claude CLI differs by a patch (oracle 2.1.245 / thinkpad 2.1.241) and the
architecture differs (aarch64 / x86_64). Neither is the discriminator: it is the
`acp-zombie-reaper` timer that exists only on oracle (§"ANSWERED").

The thinkpad rows were collected under pi 0.84.3 and that host is now on 0.84.4,
so any further thinkpad rows belong in a separate bucket.

## Where the exit(0) comes from

Read at `node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js:81-95`:

```js
async function shutdown() { await agent.dispose().catch(...); process.exit(0); }
connection.closed.then(shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

Three paths, one exit code. `exit 0, no signal` is what all three produce, so the
exit fact `df7525f` preserved cannot by itself say which fired.

entwurf's side saw a close carrying **no reason** — a clean stdout EOF rather than
an errored stream (read at `pi-extensions/lib/acp/backend.ts:355-365`). So the
child went first; pi did not close it.

## ANSWERED (2026-09-01, oracle) — it is SIGTERM, from a timer on this host

The open question below is closed. It was not derivable from the artifacts the
previous pass had; it is derivable from one this pass added — **the host's own
systemd user journal**, which no reading had opened.

Measured here — `journalctl --user -b 0` on oracle, and `reaper-correlation.py`,
which re-derives the table below from `acp-pop-oracle.json` plus that journal:

| turn (UTC) | kind | nearest reap | delta |
|---|---|---|---|
| 2026-08-31T11:53:01.452Z | EXIT0 | 11:53:01Z pid=1107102 | **0.5s** |
| 2026-08-31T12:09:26.272Z | EXIT0 | 12:09:26Z pid=1147382 | **0.3s** |
| 2026-08-31T12:25:52.596Z | EXIT0 | 12:25:52Z pid=1162114 | **0.6s** |
| 2026-08-20T09:19:52.107Z | EXIT0 | 09:19:52Z pid=3872971 | **0.1s** |
| 2026-08-31T06:13:15.421Z | between | 06:00:52Z pid=382085 | 743.4s idle |
| 2026-08-31T06:35:07.230Z | between | 06:29:52Z pid=413476 | 315.2s idle |
| 2026-08-31T12:56:18.364Z | between | 12:43:52Z pid=1176076 | 746.4s idle |

**The pid closes it.** `(node:<pid>)` in the stderr tail is what node's
`emitWarning` stamps with the emitting process's OWN pid — so the #72 signature
carried the child's pid all along. Measured here, by `\(node:(\d+)\)` over the
same `message.errorMessage` fields, against the journal's reaping lines:

| record | node pid in the tail | pid the reaper SIGTERMed | reap (KST) |
|---|---|---|---|
| 173 | 1107102 | **1107102** | 20:53:01 |
| 175 | 1147382 | **1147382** | 21:09:26 |
| 177 | 1162114 | **1162114** | 21:25:52 |

Identical in all three. Timestamp agreement alone would leave coincidence and
reverse-causation open; pid identity does not. Note what this costs the earlier
readings: the warning line retired as a candidate cause was, the whole time,
naming the killer.

**All four EXIT0 turns land inside one second of a SIGTERM this host sent on
purpose.** The three surviving `between` rows are the first turn after a reap
that killed an idle child — the operator never sees those, pi just opens a new
one. That is **7 turns carrying 8 flags** (2026-08-20 is EXIT0 and `between` at
once), not eight turns — the table has seven rows and the prose must match it.

**Extended to 12/12 across two boots** (measured by fable, oracle, 2026-09-01,
independent re-extraction). boot -1's journal survives and covers 2026-07-02 to
08-16, so the samples that PREDATE this boot close too:

| sample | node pid in tail | reap | delta |
|---|---|---|---|
| 2026-07-30T11:04:23.555Z — **the sample that opened #72** | 3662184 | Jul 30 20:04:23 | 0.555s |
| 2026-08-16T10:16:51.415Z — the original field report | 501006 | Aug 16 19:16:51 | ~0s |
| 2026-08-07T08:23:23.559Z (CLOSED-other) | — | 17:23:23 | 0.559s |
| 2026-08-07T08:41:23.544Z (CLOSED-other) | — | 17:41:23 | 0.544s |

So every anomalous termination in the population — EXIT0 4 + between 4 +
CLOSED-other 4 — corresponds to a reap. **The founding sample and the last
sample have one cause.** The reaper script's mtime is 2026-04-18, earlier than
every sample.

**Evidence grade, stated honestly.** The rows with a pid in a transcript
(173/175/177, 07-30, 08-16) are pid+timestamp double-locked. The four
`between`/prior-child deaths (382085, 413476, 1176076, 3857303) rest on
**journal alone** — a between-turn death leaves no stderr tail to carry a pid.
Timestamp, lifetime and mechanism all agree, but that is a weaker grade and is
labelled as such rather than folded into the locked set.

The killer, read at `/home/junghan/openclaw/scripts/acp-zombie-reaper.sh`, driven
by `~/.config/systemd/user/acp-zombie-reaper.timer` (`OnUnitActiveSec=5min`,
`ACP_REAPER_AGE_SECS=900`):

```sh
mapfile -t stale_acp < <(ps -eo pid,etimes,user,args --no-headers |
  awk -v age="$AGE_SECS" '$2 > age && $0 ~ /claude-agent-acp/ ...')
...
kill_pid "$pid" TERM     # → process.on("SIGTERM", shutdown) → dispose() → exit(0)
```

So of the three exit-0 doors, it is **SIGTERM**. Every downstream fact follows:
exit 0 with no signal recorded (the handler catches it and leaves cleanly), the
reasonless stdout EOF, and the `[Request interrupted by user...]` line as
`dispose()`'s abort artifact.

**Why nothing in the previous pass could see it.** The reaper matches on the
process *name*, and entwurf's ACP child carries the same name as the one acpx
leaks. It is a workaround for a **different harness's** bug (openclaw acpx 0.5.3,
upstream PR #245) that fires on any `claude-agent-acp` older than 900s. Its own
comment states the assumption that fails here — *"Legitimate ACP turns complete
well under 60s"* — which is true of a turn and false of entwurf's **retained**
child, whose age is the age of the *session*. A session older than 15 minutes is
shot at, every 5 minutes, forever.

This also names the host discriminator the previous pass left open, and retires
the last of the elapsed-time reading: lifetimes 1177s / 957s / 983s / 969.9s have
no constant because the axis is not a constant but a **floor** — every one of
them is over 900. The script lives in `~/openclaw/scripts/`, installed on oracle
by hand; it is not in `nixos-config`, so thinkpad never had it. That is the whole
of the 4-vs-0 split. Not the architecture, not the Claude CLI patch level.

**What this does NOT say.** It is not an entwurf defect, and the fix is not in
this repo's runtime: a correctly working child was shot by an unrelated janitor.
What #72 may still owe is *diagnosis* — the turn's error text says the child
"ended (exit code 0)" and gives the operator nothing to distinguish a clean
external kill from a vendor fault. Any such change is still bounded by the
issue's repair fence (no timeout, no blind replay, no watcher/supervisor/retry).
Disposition is GLG's.

Repair candidates for the reaper itself, none of them taken here (it is another
project's file on GLG's operating host):

- narrow Phase 1 the way Phase 2 already is — it reaps orphan `claude` only when
  `PPID == 1`, while Phase 1 reaps *any* `claude-agent-acp` by age alone. A child
  with a live parent is somebody's working session.
- raise `ACP_REAPER_AGE_SECS` above a plausible session lifetime (a palliative,
  not a fix — it only moves the floor).
- retire the unit if acpx PR #245 has landed upstream.

## The open question, stated so it is measurable

> Which of the three exit-0 paths fires — `connection.closed`, `SIGTERM`, or
> `SIGINT`?

It is not derivable from the artifacts we have. It **is** separable from outside
by whether a signal was delivered. Any probe for that is a launch-seam change and
therefore GLG's decision, and it owes its own gate cell plus a mutant that dies
for the right reason before it is worth anything.

That question is answered above (SIGTERM). This section is kept as the record
of how it was stated before it was closed.

## The repair, measured on the host that produced the failure

The launcher (`pi-extensions/lib/acp/claude-acp-launch.js`) is a claim about two
things a unit gate cannot see: what `ps` shows, and what a real signal does.
Reproduced here on oracle, 2026-09-01 — run it again with the block below.

```sh
mkfifo /tmp/f
node pi-extensions/lib/acp/claude-acp-launch.js < /tmp/f 2> /tmp/live.err &
NPID=$!; exec 3> /tmp/f; sleep 2
tr '\0' ' ' < /proc/$NPID/cmdline; echo
# the janitor's own Phase 1 selector, with the age threshold forced to 0
ps -eo pid,etimes,user,args --no-headers -p $NPID |
  awk -v age=0 '$2 > age && $0 ~ /claude-agent-acp/ && $0 !~ /awk/ { print "MATCH " $1 }'
kill -TERM $NPID; wait $NPID; echo "exit code: $?"; cat /tmp/live.err
```

Output:

```
node pi-extensions/lib/acp/claude-acp-launch.js
                                   <- no MATCH line: the selector finds nothing
exit code: 0
ENTWURF_ACP_LAUNCH_SIGNAL=SIGTERM
```

Three facts, in the order they matter:

1. **`/proc/<pid>/cmdline` carries no vendor name.** The vendor runs, but as an
   `import` inside this process — so the string the janitor scans is ours.
2. **The janitor's own awk, with `age` forced to 0 so every process qualifies,
   selects nothing.** Not "would probably not match": its selector, run against
   the real `ps` row.
3. **A real SIGTERM still ends at exit 0** — the vendor's handler is intact and
   nothing was made signal-immune — **and the frame is on stderr.** That line is
   what the backend lifts into `launch observed SIGTERM before child exit`, which
   is the fact this whole investigation had to reconstruct from a journal.

Independently reproduced by a second session (fable, oracle, 2026-09-01), which
also confirmed the adjacent paths: stdin EOF alone exits 0 (the `connection.closed`
door, live), a SIGTERM arriving 0.15s into the import still terminates (the sink
guard stands down and the re-raised signal lands), and a launcher copied outside
the repo exits 1 rather than degrading.
