# raw-acp-session-measure — what the vendor ACP agents do with session/load, resume, close and new

The probes behind receipts R1–R10 of the ACP client baseline (#171), plus scripts that drive a real Pi
(`pi-smoke`, `pi-unknown`, `pi-upgrade` and others below; they launch Pi with this checkout, `pi-host.mjs`, and `pi-upgrade` births its session with an earlier package first). The short table is
[docs/acp-client-baseline.md](../../docs/acp-client-baseline.md); the full receipts are pasted into #171.
Not a gate; nothing here runs in any check tier. Each raw probe drives the real
`claude-agent-acp` and `agy` over raw JSON-RPC, imports the production overlay, adapter and enforce
functions from the compiled bridge dist, and writes one run directory of wire logs and a
`summary.json`. The code is kept as it produced the receipts; only host paths were replaced by the
launcher's environment (below).

```
LIVE=1 scripts/raw-acp-session-measure/run.sh <scenario> <out-dir> [claude|agy]
```

`<out-dir>` must already exist and lie outside this repository; each run creates
`<out-dir>/<scenario>-<UTC stamp>/`. The backend filter is accepted by `experiments`, `z5`, `continuity`, `pi-smoke`, `pi-upgrade`, `pi-unknown` and `all`.
`pi-smoke` and `pi-unknown` open a control socket under the run directory, so keep `<out-dir>` short (a unix socket path is limited to 107 bytes).
Without `LIVE=1` the launcher and every probe refuse with exit 2 before spawning anything.

## Scenarios and receipts

| Scenario | Measures | `session/prompt` sent in the receipt run | Receipts |
|---|---|---|---|
| `rail0` | `initialize` (both), Claude build → `session/load` and `session/resume` in new children, Claude load of an unknown id and of an id from another overlay, agy `initialize` only | 4 (Claude) | R1, R2 (Claude) |
| `agy` | agy build → `session/load` and `session/resume`, load from another overlay and of a random uuid | 4 (agy) | R2 (agy), R8 (loads) |
| `resume-unknown` | `session/resume` of a random uuid, both vendors | 0 | R2 (unknown id) |
| `experiments` | items `Z2`, `L11`, `Z6`, `L7`, `L14`, `V1` on both vendors with the production `clientCapabilities`, plus a process scan after every child | 19 (Claude 9, agy 10) | R2b, R3, R4, R5, R6, R7, R8 (phantom prompt), R9 |
| `z5` | abandoned `session/new`: kill after the answer, `close` after the answer, SIGTERM before the answer; each checked from a new child by `session/list`, `session/resume` and the vendor's files | 0 | R10 |
| `continuity` | step-7 U rows: the shared chain U21 → U23 → U25 → U24 on one session, then U12, U17 (cases a–c, and d: a confirmed cancel of X followed by a different Y, sent alone (d1, B's cancel-then-correct) or after X (d2, 16-9 as written)), U18 (a proxy), U9/U19, U14/U15 and the vendor half of 16-1, U26. Side effects go to `scratch-cwd/effects.txt` in the run. Facts in `summary.json` `backends.<b>.facts`; no stored oracle yet | up to 37 per vendor, plus U26 (Claude 2, agy 1); a case whose preconditions fail spends no further turn | — |
| `pi-smoke` | step 9: a real `pi --mode rpc` resident (this checkout's extension, sandbox HOME with `.claude` / `.gemini` linked to the operator's) over a real agent: birth, reuse, an answered cancel, a Pi compaction, quit, reopen and resume with recall, a second Pi on the holder lease, and what Pi stored (`responseId` on every answer). Each check is an observation in `summary.json`; not in `all` | 7 per backend, plus Pi's summary turn | step 9 |
| `pi-upgrade` | #176: an earlier Entwurf build (`ENTWURF_RAW_PI_EARLIER`, an installed package outside the repository) births a Pi resident's session and plants a word; this checkout reopens it twice. Records the record (vendor id, writer, signature) and Claude's transcripts after each step: same vendor session, recall, no further vendor transcript. Takes `[claude|agy]`, but the transcript checks are Claude's and only Claude was measured; not in `all` | 3 per backend (plant, two recalls) | #176 |
| `pi-unknown` | step 9: a prompt of unknown outcome and its reopen, one backend per run (default Claude). A real Pi resident sends X; once X is on the wire the run kills its own agent group (named by the holder lease); Pi is quit, reopened on the same session and sends Y. `wire-tee.mjs` in front of the agent records what Entwurf wrote: `session/resume` of the recorded id, one `session/new` in the whole run, and the reopened prompt (Claude: Y alone; agy: X and Y). Claude runs through `CLAUDE_AGENT_ACP_COMMAND` around the production launcher, agy through an `agy` first on PATH. The checks are made by `pi-unknown-judge.mjs <run-dir>` from the wire logs, the Pi session file and the record snapshots (it re-reads a stored run too, and `--self-test <run-dir>` requires that copies with one wire fact changed fail); a check that does not hold ends the run with exit 1; not in `all` | 3 per backend | step 9 |
| `pi-quit` | #175 M4: one Pi resident answers one short turn and quits (rpc stdin EOF; `ENTWURF_RAW_QUIT_VARIANT=compacted` adds a Pi compaction and a turn first, `tui` drives interactive mode under `script` and types `/quit`). `quit-trace.cjs` is preloaded into Pi only (`NODE_OPTIONS`, removed from Pi's own environment at once) and records whether Pi called `process.exit` or its event loop drained first, with the active resources; `ENTWURF_RAW_QUIT_KEEPALIVE=1` adds one ref'd interval (the counterfactual). The out-dir length decides whether Pi's control socket can listen (`summary.run.controlSocketEinval`) | 1 per run (2 with `compacted`) | #175 |
| `pi-compact` | #175 M1/M2: a Pi resident born with a codeword and a filler (`ENTWURF_RAW_FILLER_TOKENS`, a nominal size: 80000 measured about 187k Claude tokens, 40000 about 95k), then a Pi compaction: `manual` (rpc `compact`) or `threshold` (a SIMULATION: `ENTWURF_RAW_PI_RESERVE_TOKENS` lowers Pi's threshold). U0/U1/U2 are the vendor occupancy Pi stored before and after; the vendor's own transcript (assistant occupancy, compact boundaries) is read from the Claude overlay. GREEN U1 <= 0.5*U0 and U0-U1 >= 30000, RED U1 >= 0.9*U0, U0 >= 80000 required | 4 plus Pi's summary turns | #175 |
| `compact-resume` | #175 M1/M3: raw: session/new with a codeword and a filler (`ENTWURF_RAW_PLANT_PARTS` prompts; agy took about 59k tokens of one block whatever its length), the production close, then `session/resume` in a new child, `/compact` as the only block, a recall and one more prompt; every `usage_update.used`, PromptResponse.usage and compaction frame per prompt, and the Claude transcript. Model `PROBE_MODEL` | 4 + parts per backend | #175 |
| `all` | the regression scenarios, each checked by `compare.mjs check <scenario> <run> --write` against `expected.json` (stop on the first differing key, failed probe or comparator error), then `continuity`; one `all-<UTC stamp>/` with `order.txt`. `claude`: rail0, resume-unknown, experiments, z5. `agy`: agy, resume-unknown, experiments, z5. No filter: both sets, then `continuity` for both | up to about 52 per vendor | R1–R10, then U rows |

R11 is not from this folder. The receipt runs were made 2026-11-20 at `ddd78246`, n=1 per cell, with
claude-agent-acp 0.107.3 and agy 1.5.12; those versions describe that run, not the current pin.

## What it touches (Hard Rule 12)

- `HOME`, the four `XDG_*` roots and `PI_CODING_AGENT_DIR` point inside the run directory; the
  launcher clears the rest of the environment (`env -i`, keeping `PATH`, `LANG`, `TERM`). Every probe
  imports `common.mjs` first, which refuses unless that sandbox is in place and the run directory is
  outside the repository.
- Authentication is the vendors' own. The production overlay functions (`ensureClaudeConfigOverlay`,
  `ensureAgyGeminiOverlay`) create overlay directories inside the run that symlink to the operator's
  real directories: `ENTWURF_RAW_CLAUDE_DIR` (default `$HOME/.claude`) and `ENTWURF_RAW_GEMINI_DIR`
  (default `$HOME/.gemini`). The probes never open a file in either directory. The Claude credential
  file and the agy OAuth token are `stat()`ed for their mtime only, before and after
  (`summary.json` `mtimeBefore` / `mtimeAfter`; `agy` records `tokenMtimeBefore` / `After`). A
  vendor may still refresh a token through the link: that is a write to the operator's real file,
  which is why this is LIVE only and the mtimes are recorded. The Claude overlay also links `cache`,
  `debug`, `session-env`, `shell-snapshots`, `skills`, `stats-cache.json`, `statsig` and `telemetry`
  to the real directory (overlay.ts `OVERLAY_PASSTHROUGH`), so the vendor's writes there land in the
  operator's directory, not the run. `continuity` stat()s every link target before and after
  (`linkTargetsBefore` / `After`); a directory's mtime moves only when an entry directly inside it
  changes, so that is a lower bound.
- **The write boundary, stated once:** probe writes stay in the run directory, plus the launcher copy
  below. The vendor's own writes through the overlay links reach the operator's real directories and
  are recorded by mtime. Nothing contains them.
- `ENTWURF_RAW_CLAUDE_ACP_PREFIX` (optional) names a directory outside the repository holding
  `node_modules/@agentclientprotocol/claude-agent-acp`; Claude then runs that version in the raw probes (`claudeLauncherArg`); `pi-smoke`, `pi-unknown` and `pi-upgrade` launch the checkout's own launcher (`pi-upgrade`'s first, earlier build its own bundled one), so their provenance is not the prefix. A copy of
  `claude-acp-launch.js` is written to the prefix root (opened without following a symlink, refused
  unless it is a regular file you own): the one place, besides the run directory, a probe itself writes.
  Every run records `provenance.json`: the claude-agent-acp version launched and the ACP SDK it
  resolves, beside the SDK Entwurf's client uses.
  `ENTWURF_RAW_U26_AGY_SOURCE` (optional) names a stored `agy` run; `continuity` resumes a copy of its
  session for agy U26. `ENTWURF_RAW_U26_AGY_PAIR` (`<stored>:<launched>`) names the version pair agy
  U26 must cross; without it, or with another pair answering, the sample is inconclusive.
  `ENTWURF_RAW_U26_CLAUDE_PAIR` (`<stored>:<launched>`, with `ENTWURF_RAW_CLAUDE_ACP_PREFIX`) picks Claude
  U26's direction: the pin then the prefix (the default), or the prefix then the pin, an upgrade (#176).
  `ENTWURF_RAW_AGY_MODEL` (optional) sets `continuity`'s agy model (default `gemini-3.8-flash`), and
  `ENTWURF_RAW_ROWS` (optional, a comma list such as `U17`) runs only those rows and judges completeness
  on them; U23 and U25 need U21's live session.
- **Completeness and cleanup are separate.** Every mandatory U sample records `status`: `complete`, or
  `inconclusive` with `inconclusiveBecause` (a precondition failed, a call got no terminal frame, a
  re-send did not end its turn). A complete sample may say "no"; that is a result. `continuity` exits
  1 for a cleanup failure (a fatal row, an unverified reap, a surviving process, an interrupt) and 4
  when it was clean but a mandatory sample is inconclusive or missing (`run.incomplete`); compare
  checks `RUN.incomplete` as well. After every probe, `run.sh` runs `sweep.mjs`, which kills what still carries the run's
  token and reports anything else under the run directory (`sweep.json`); a survivor makes `run.sh`
  exit 5. That sweep is the shared evidence; a Pi run has no per-run `ps` group report of its own.
- The agy executable is `ENTWURF_AGY_BIN`, else `agy` on `PATH`. The two files the bridge dist does
  not carry (`claude-acp-launch.js`, `agy-acp-hook.mjs`) and the engraving prompt are taken from
  `pi-extensions/lib/acp/` in this checkout.
- Nothing is written into the repository by a live probe (the offline `pi-unknown-judge` self-test writes temporary copies under the system temp directory). The launcher records `git rev-parse HEAD` and
  `git status --porcelain` in the run directory. Build the dist from the HEAD you measure
  (`pnpm run build-bridge`); the launcher refuses when it is missing but cannot tell whether it is stale.
- Children are spawned detached and killed by process group (SIGTERM, then SIGKILL), and every raw probe
  lists what is left of that group with `ps`. `experiments` and `z5` also read `/proc/<pid>/cwd`
  (Linux only) at the end and report any process whose cwd is inside the run directory.

## Run directory

`repo-head.txt`, `repo-status.txt`, `summary.json`, `stdout.json`, `probe-stderr.log`, `events.jsonl`
(where the probe logs events), per child `<name>.wire-in.ndjson` / `.wire-out.ndjson` and, for
Claude, `.stderr.log`, plus the sandbox `home/` (agy's own server logs are under its overlay's
`antigravity-cli/log/`).

## Limits

- `rail0` sends `clientCapabilities: {}` on `initialize`, not the production
  `{ session: { compaction: {} } }`. Its load replay is therefore for a client without the compaction
  capability (R1 footnote); `experiments` repeats load and resume with the production value.
- One host, one run per cell, subscription models named in each probe. Timings are single
  observations, not bounds.
- `z5.mjs` carries a copy of the `experiments.mjs` harness; only `runBackend` differs.
