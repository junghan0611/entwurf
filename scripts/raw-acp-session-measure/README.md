# raw-acp-session-measure — what the vendor ACP agents do with session/load, resume, close and new

The probes behind receipts R1–R10 of the ACP client baseline (#171). The short table is
[docs/acp-client-baseline.md](../../docs/acp-client-baseline.md); the full receipts are pasted into #171 at
close. Not a gate; nothing here runs in any check tier. Each probe drives the real
`claude-agent-acp` and `agy` over raw JSON-RPC, imports the production overlay, adapter and enforce
functions from the compiled bridge dist, and writes one run directory of wire logs and a
`summary.json`. The code is kept as it produced the receipts; only host paths were replaced by the
launcher's environment (below).

```
LIVE=1 scripts/raw-acp-session-measure/run.sh <scenario> <out-dir> [claude|agy]
```

`<out-dir>` must already exist and lie outside this repository; each run creates
`<out-dir>/<scenario>-<UTC stamp>/`. The backend filter is accepted by `experiments`, `z5`, `continuity` and `all`.
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
  `node_modules/@agentclientprotocol/claude-agent-acp`; Claude then runs that version. A copy of
  `claude-acp-launch.js` is written to the prefix root (opened without following a symlink, refused
  unless it is a regular file you own): the one place, besides the run directory, a probe itself writes.
  Every run records `provenance.json`: the claude-agent-acp version launched and the ACP SDK it
  resolves, beside the SDK Entwurf's client uses.
  `ENTWURF_RAW_U26_AGY_SOURCE` (optional) names a stored `agy` run; `continuity` resumes a copy of its
  session for agy U26. `ENTWURF_RAW_U26_AGY_PAIR` (`<stored>:<launched>`) names the version pair agy
  U26 must cross; without it, or with another pair answering, the sample is inconclusive.
- **Completeness and cleanup are separate.** Every mandatory U sample records `status`: `complete`, or
  `inconclusive` with `inconclusiveBecause` (a precondition failed, a call got no terminal frame, a
  re-send did not end its turn). A complete sample may say "no"; that is a result. `continuity` exits
  1 for a cleanup failure (a fatal row, an unverified reap, a surviving process, an interrupt) and 4
  when it was clean but a mandatory sample is inconclusive or missing (`run.incomplete`); compare
  checks `RUN.incomplete` as well. After every probe, `sweep.mjs` kills what still carries the run's
  token and reports anything else under the run directory (`sweep.json`); a survivor makes `run.sh`
  exit 5.
- The agy executable is `ENTWURF_AGY_BIN`, else `agy` on `PATH`. The two files the bridge dist does
  not carry (`claude-acp-launch.js`, `agy-acp-hook.mjs`) and the engraving prompt are taken from
  `pi-extensions/lib/acp/` in this checkout.
- Nothing is written into the repository. The launcher records `git rev-parse HEAD` and
  `git status --porcelain` in the run directory. Build the dist from the HEAD you measure
  (`pnpm run build-bridge`); the launcher refuses when it is missing but cannot tell whether it is stale.
- Children are spawned detached and killed by process group (SIGTERM, then SIGKILL), and every probe
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
