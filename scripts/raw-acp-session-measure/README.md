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
`<out-dir>/<scenario>-<UTC stamp>/`. The backend filter is accepted by `experiments` and `z5` only.
Without `LIVE=1` the launcher and every probe refuse with exit 2 before spawning anything.

## Scenarios and receipts

| Scenario | Measures | `session/prompt` sent in the receipt run | Receipts |
|---|---|---|---|
| `rail0` | `initialize` (both), Claude build → `session/load` and `session/resume` in new children, Claude load of an unknown id and of an id from another overlay, agy `initialize` only | 4 (Claude) | R1, R2 (Claude) |
| `agy` | agy build → `session/load` and `session/resume`, load from another overlay and of a random uuid | 4 (agy) | R2 (agy), R8 (loads) |
| `resume-unknown` | `session/resume` of a random uuid, both vendors | 0 | R2 (unknown id) |
| `experiments` | items `Z2`, `L11`, `Z6`, `L7`, `L14`, `V1` on both vendors with the production `clientCapabilities`, plus a process scan after every child | 19 (Claude 9, agy 10) | R2b, R3, R4, R5, R6, R7, R8 (phantom prompt), R9 |
| `z5` | abandoned `session/new`: kill after the answer, `close` after the answer, SIGTERM before the answer; each checked from a new child by `session/list`, `session/resume` and the vendor's files | 0 | R10 |

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
  which is why this is LIVE only and the mtimes are recorded.
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
