# Herdr Core (hc) rail — same-id resume and the placement view

Status: #178, branch work toward 0.65.0. Measured on one host (`oracle`) with Herdr Core 0.1.20, n=1 per row; not a release acceptance. Herdr Core source was read at tag `v0.1.20` only.

This rail is narrow on purpose. It reopens an EXISTING dormant citizen in a terminal of the Herdr Core the caller already sits in, and it lets a peers listing show where a core runs a citizen. It does not create citizens, deliver messages, start a core, or decide anything about addresses.

## 1. What is in and what is out

| | |
|---|---|
| in | `entwurf resume [<garden-id>]` and `entwurf_resume_call` for `pi`, `pi-durable` and `claude-code`, launched from inside a Herdr Core terminal |
| in | a placement view: where the lister's own tmux server and one operator-named core show a Claude Code citizen |
| out | `entwurf_fresh_call` from a Herdr Core terminal: refused as `hc-fresh-unsupported`, nothing opened |
| out | any other backend, any remote core, any delivery through hc |

Unchanged by this rail: the record is the sole address; `entwurf_v2` and its delivery decisions; each backend's dormancy and owner proof; the lock; the observation step of a resume.

## 2. Which rail a resume takes

One table, read once at the shared dispatch root (`fresh-call-dispatch.ts` `selectResumeRail`). A marker is "present" when it is non-empty.

| `HC_TERMINAL_ID` or `HC_TERMINAL_SOCKET` | `HERDR_ENV=1` | rail |
|---|---|---|
| present | no | hc |
| present | yes | none — refused as `rail-markers-ambiguous` |
| absent | yes | herdr |
| absent | no | tmux |

No rail falls back to another. The hc rail is SELECTED by either variable and USABLE only with both (a local address such as `t7` and an absolute socket path). Half a context is refused as `hc-context-missing`: by `entwurf resume` before anything is read, locked or reserved; by `entwurf_resume_call` at its launch step, as that verb also does for a missing tmux anchor, with nothing created and a pi-durable reservation withdrawn.

Consequence worth knowing: a tmux pane whose shell inherited `HC_*` from a Herdr Core terminal keeps selecting the hc rail, so a fresh call from it is refused and a resume from it needs that core's terminal to still be live. Unset the two variables in that shell to return it to tmux.

The tmux resume leaf carries its own guard for a direct caller (`hc-resume-unsupported`), the twin of its herdr guard.

## 3. The launch (`pi-extensions/lib/hc-launch.ts`)

- Transport: one unix-socket connection per request to the caller's own `HC_TERMINAL_SOCKET`, line JSON-RPC. Never the `hc` CLI, which can start a core. No retry, no reconnect.
- Two reads before the one write: `hello {generation: 1}` (another generation is refused), then `terminal.get` of the caller's own terminal, which must be live on that socket.
- One write: `terminal.run` with an absolute `argv[0]`, the record's cwd, a fixed environment, a minted name `entwurf-resume-<16 hex>`, `no_parent: true` and `no_notify: true`. A reopened sibling is nobody's child: it outlives the caller's terminal and sends it no notes.
- `argv[0]` is resolved on the CALLER's `PATH` for `pi` and `claude`; for pi-durable it is the package's own `run.sh` with the closed adopt context.
- The fixed environment empties `PI_SESSION_ID`, `PI_AGENT_ID`, `HERDR_ENV`, `HERDR_PANE_ID`, `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`, `TMUX` and `TMUX_PANE`. The core cannot delete a variable, only set it, so "empty" is the spelling; Entwurf's readers treat empty as absent.
- The receipt names the core (`id`, `name`), the new terminal, the pid the core reports, the runtime path and the requested cwd. All of it is a VIEW.

What a failed launch may claim (`recovery`):

| class | when |
|---|---|
| `none` | the request was certainly not written, or the core declined it with `invalid_params`, `name_taken` or `config` |
| `left-open` | the core created a terminal whose echo does not match what was asked; its address is named |
| `unknown` | everything else, including `unavailable` and `spawn_failed` |

`unavailable` is `unknown` because the core answers it both before a terminal exists and after the program started, when saving its registry timed out. A pi-durable reservation is withdrawn only on `none`.

## 4. Observation is the backend's, not the core's

After the launch the existing same-id observation runs unchanged: pi — the control socket answers under the same id; pi-durable — a child adopted this call's reservation; Claude Code — a NEW live process re-armed the receiver marker, and that process is the terminal's own (the pid `terminal.run` reported). A core that reports no pid yields `pane-process-unread`. The core's own status for a terminal is not consulted.

Keep these apart; one does not imply the next: launch receipt, observation receipt, recall of earlier conversation, a real `entwurf_v2` round trip, and visibility in the Herdr App.

## 5. The placement view

Shown beside the garden id by `entwurf_peers` / `entwurf peer-facts`. It is computed for each listing and stored nowhere, so an old location cannot be shown as current. It is never an address, a liveness answer or an authority, and no send or launch path imports it (`hc-placement-wiring.test.ts` `HCP-VIEW-NOT-DISPATCH` holds the direct imports).

Three owners can hold a citizen, each read at most once per listing, each only from an explicit source:

| owner | read when | how | key |
|---|---|---|---|
| herdr | `HERDR_ENV=1` and `HERDR_BIN_PATH` | `pane list` | the official `agent_session` report (`docs/mux-launch-rail.md` §7) |
| tmux | `TMUX` is set — the lister's OWN server only | one `tmux list-panes -a`, no `-S`/`-L` | `pane_pid` |
| hc | `ENTWURF_HC_PLACEMENT_SOCKET=<absolute path>` — operator opt-in | one `hello`, one `terminal.list` | terminal `pid`, local live terminals only |

The tmux and hc joins compare that pid with the citizen's ACTIVE receiver owner — the owner the `receiver` column itself calls `active`. Claude Code only. Pi and pi-durable rows are never claimed by these two owners.

The column is the fold of the three answers (`placement-compose.ts`):

| value | meaning |
|---|---|
| `tmux <session>:<window>`, `herdr <pane>`, `hc <core>/<terminal>` | exactly one owner saw the citizen there |
| `ambiguous` | an owner reports the key twice, two owners see it in different places, or two citizens are shown in one pid-joined place |
| `none` | herdr, tmux AND hc were all read for this citizen and none has it |
| `unobserved` | anything else: at least one owner did not look |

So `none` still means "read, and not there", and it is rare: a lister that can read only one owner prints `unobserved`. A Claude Code citizen with no active owner, and every Pi or pi-durable citizen, can no longer read `none` at all, because tmux and hc cannot look for them. Before #178 a herdr-only listing printed `none` for a citizen in none of its panes; it prints `unobserved` now.

The hc opt-in variable:

| `ENTWURF_HC_PLACEMENT_SOCKET` | result |
|---|---|
| unset or empty | hc is not read |
| names a path that does not exist | hc is not read |
| the core does not answer, answers an error, or speaks another generation | hc is not read; no retry, no other endpoint |
| not absolute, or contains NUL | `HcPlacementConfigError: hc-placement-socket-malformed` — that listing stops |
| exists but is not a unix socket (a symlink to one included) | `HcPlacementConfigError: hc-placement-socket-not-a-socket` — that listing stops |

It is a same-host view input only. It is not a launch input, not an address, not liveness, and not part of remote pairing. The launch socket `HC_TERMINAL_SOCKET` is deliberately NOT borrowed: a lister inside a Herdr Core terminal that has not set the variable reads `unobserved` for hc.

## 6. Premises and known limits

- **PATH inside a core-started program.** A program a core starts has the CORE's environment. On the measured host the core's `PATH` (the user manager's) held neither `entwurf` nor `pi` nor `claude`. The resume itself resolves the runtime on the CALLER's `PATH`, so a human shell with a normal `PATH` works; a reopened citizen's own shell may not find `entwurf`. A resume call made BY such a citizen for a Pi or Claude Code target is expected to refuse `hc-runtime-unresolved` — an estimate, unmeasured. Entwurf adds no resolver or fallback for this; it is an operating premise (put the bins on the core's start `PATH`).
- **Same host is a documented contract.** Nothing can verify that the named socket belongs to a core on this host. Never name a forwarded remote socket: its local-address rows carry another machine's pids.
- **Waiting.** A core that does not answer costs up to 2 s for each of the two reads, and tmux up to 2 s: a listing can wait about 6 s in the worst case. A core with registered machines may spend up to 3 s per machine inside `terminal.list`, so with the 2 s bound it can read `unobserved` every time — the safe side.
- **A mis-set variable stops listings in that shell**, the no-argument `entwurf resume` list included. `entwurf resume <garden-id>` does not list and is unaffected.
- **Two panes of one window print the same `tmux <session>:<window>`.** The pane id is in the `peer-facts` export, not in the column.
- **Environment reach of the opt-in variable** is whatever environment the listing process has. `entwurf peer-facts` from a shell: measured. `entwurf_peers` inside a running MCP bridge: unmeasured — a bridge's environment is fixed when its harness starts it. Codex: unverified.
- **A citizen started by hand from a shell in a pane or terminal does not join**: the pane's process is the shell.
- **Herdr App status is not an Entwurf fact.** The App's Inbox lists what a program self-reports to the core. On the measured host Claude Code and Pi terminals appeared there and pi-durable's did not, while all three terminals were visible. Entwurf uses none of that for liveness, delivery or placement.
- **pi-durable** may leave a detached helper after a terminal is killed; this rail never kills a terminal.

## 7. Evidence

Local lab receipts on the implementing host, 2026-11-28 (paths under `~/.local/share/entwurf-lab/178/`; they do not travel with the repository):

| receipt | what it holds |
|---|---|
| `red/` | before: `entwurf resume` in a Herdr Core terminal exits 4 `no-tmux-context` |
| `live1/` | pi-durable, born and reopened in hc by the human CLI; adopted, recall, v2 round trip, survives the caller's terminal |
| `live2/` | Claude Code, same; marker owner pid equals the `terminal.run` pid; Bash and MCP tools work; a resume call asked of an hc citizen over mail was declined by that citizen (the tool needs its operator's own request) |
| `live3/` | citizens born in tmux reopened in hc: Claude Code, pi-durable, Pi; GLG's App observation |
| `live7/` | placement: control, hc opt-in, tmux, both; a citizen born in hc reopened in tmux |

Not measured: `entwurf_resume_call` made by an hc-seated citizen; the picker inside a Herdr Core terminal; a core started from a tmux or herdr seat; two cores on one host; a herdr-seated lister with the hc variable.

Gates: `check-entwurf-v2-visible-resume` (beside tests `hc-launch`, `hc-placement`, `hc-placement-wiring`, `placement-compose`, `resume-cli`), `check-fresh-call-dispatch`, `check-mux-resume-call`, `check-herdr-placement`, `check-install-surface`. Mutant manifests: `scripts/mutants/hc-launch.json`, `hc-placement.json`.
