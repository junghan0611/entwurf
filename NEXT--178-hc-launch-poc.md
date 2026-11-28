# NEXT--178-hc-launch-poc — Herdr Core resume rail (branch lane)

Branch `178-hc-launch-poc` from main `be680a22`. Local checkpoint commits only: no push, no tag, no release, no GitHub write from the writer. Delete this file before any merge.

**Roles (routable garden ids).**
- Practical coordinator: `20261126T081804-885314` — receives every checkpoint, writes the issue comments.
- Ops coordinator: `20261014T212756-68bd94` — design rulings (through 885314).
- Implementer and SINGLE branch writer: `20261128T121810-b48126` (Claude Code, tmux seat on oracle), since 2026-11-28 12:18 KST.
- Review only, read-only: `20261128T113335-bf156a` (previous writer; returned the role), `20261128T115136-29f14e` (design, L3 draft).
- Operating siblings, never test targets: 68bd94, 885314, bf156a, 29f14e, 145c2f.

**Sources of truth.** Issue #178 (rewritten 2026-11-28) and its change record, comment 7232915191. Design: `~/.local/share/entwurf-lab/178/design/L3-draft.md` (rev 4, 29f14e) plus 885314's rulings by mailbox (D9-a: env `ENTWURF_HC_PLACEMENT_SOCKET`; fresh inside hc: named reject only). HC upstream `~/repos/3rd/herdr-core`, tag `v0.1.20` = `de97ea5b` only.

# RAIL

Target: Entwurf 0.65.0, not a ship guarantee. Scope: Core same-id resume for pi-durable, Claude Code, Pi + location view. Fresh call into hc is OUT (named reject only).

Contract to hold: the record stays the sole address; `entwurf_v2` unchanged; existing dormancy and owner proofs unchanged; no fallback between rails; no prompt submitted; hc placement is a displayed fact, never an address, liveness or authority, and a stale location is never shown as current. Launch receipt, App visibility, recall and a real v2 round trip stay SEPARATE evidence.

- [x] **(0) RED baseline** — `~/.local/share/entwurf-lab/178/red/RECEIPT.md`. `entwurf resume <id>` in an HC terminal: exit 4 `no-tmux-context`; a live HC citizen's placement: `unobserved`.
- [x] **(1) Checkpoint 1: hc launch leaf + rail table + v2/CLI wiring.** `hc-launch.ts` (one `terminal.run`, `no_parent`/`no_notify`, fixed env scrub, absolute argv[0], two reads before the write, none/unknown/left-open recovery), `selectResumeRail` (hc / herdr / tmux / ambiguous) in the shared root, `hc-fresh-unsupported`, v2 handle + receipts, CLI early check and picker line. LIVE L-1 (pi-durable, human CLI): `~/.local/share/entwurf-lab/178/live1/RECEIPT.md` — exit 0, adopted, recall and real v2 round trip with the tmux-seated writer, reopened terminal outlives the caller's. Test citizen `20261128T123102-a05627` left live in an hc terminal for GLG's App check.
- [x] **(1b) Checkpoint 2 `f0f251b9`: `unavailable` is `unknown`, never `none`** (bf156a B-1: hc answers it after the program started too, `[HC api/run.rs:60, runtime.rs:232-241]`). `scripts/mutants/hc-launch.json` (14 claims); five neighbouring mutants re-anchored.
- [x] **(2) Claude Code resume in Core** (L-2, n=1): `~/.local/share/entwurf-lab/178/live2/RECEIPT.md`. exit 0, `receiver-armed`, marker ownerPid === `terminal.run` pid, recall, Bash + MCP tools, v2 round trip.
- [x] **(2b) tmux-born → hc, human CLI, three backends** (L-3, n=1 each): `~/.local/share/entwurf-lab/178/live3/RECEIPT.md` (also GLG's App observation and the Inbox/Idle UX row, both GLG-observed).
- [x] **(3) Pi resume in Core** (n=1): same receipt, row `20261128T125432-ea3378`.
- [x] **(4) Placement view** (checkpoints 3 and 4): three owners folded into one column (`placement-compose.ts`). herdr as before; the lister's own tmux server (`tmux-placement.ts`: `TMUX` only, one `list-panes -a`, no `-S`/`-L`); an operator-named hc core (`hc-placement.ts`: `ENTWURF_HC_PLACEMENT_SOCKET`, one `hello` + one `terminal.list`). tmux and hc join `pane_pid` / terminal pid to the receiver axis's ACTIVE owner, Claude Code only; pi / pi-durable `unobserved`. `none` only when all three owners were read; two citizens in one pid-joined place are both `ambiguous`. L-7: `~/.local/share/entwurf-lab/178/live7/RECEIPT.md` (tmux-born seen at `hc oracle/t1g`, hc-born seen at `tmux entwurf:9`). BEHAVIOUR CHANGE to carry into docs: a herdr-only listing that printed `none` now prints `unobserved` (tmux and hc unread).
- [x] **(5) Text, guards, docs** (checkpoint 5). `entwurf help resume` + root page (reviewed amendment layer); guidance payload **revision 26** (`amendments-revision-26.json`: both resume descriptions, `launch-refused`, both fresh descriptions, and the added `resumeLaunchRejectHints.hc-resume-unsupported`) — the five amended literals were approved by 885314 before the producer edit, the added hint and the history text go to bf156a with the commit; the tmux resume leaf's hc guard (`hc-resume-unsupported`); the CLI's early hc row (`hc-context-missing` before anything is read — bf156a D-3; `entwurf_resume_call` has no early check on ANY rail, tmux included, so there half a context is refused at the launch step with nothing created); `docs/hc-launch-rail.md` (contract, premises, limits, evidence), `docs/mux-launch-rail.md` §7-b, CHANGELOG Unreleased, AGENTS.md reference. The resume MCP description is 2040 / 2048 characters.
- [x] **(5b) After GLG's "try everything that can be tried" (2026-11-28 via 68bd94/885314)**: `live8/` — the no-argument picker typed in a Herdr Core terminal; the opt-in variable reaching `entwurf_peers` inside a Claude Code citizen's bridge. `live9/` — the core's own PATH refuses a CLI resume `hc-runtime-unresolved` (the tool path stays unmeasured); pi-durable's receiver owner pid equals the `terminal.run` pid and the tmux `pane_pid`, so the owner-pid join now claims **Claude Code and pi-durable** (`OWNER_PID_PLACEMENT_BACKENDS`, `HCP-WIRED-DURABLE`); Pi stays unclaimed.
- [ ] **(6) Qualification owed before the frozen candidate**: every #178 claim now has a mutant (checkpoint 6 added the eleven checkpoint-1 claims: FCD-RESUME-RAIL-TABLE / -AMBIGUOUS-NO-RAIL / -HC-NO-FALLBACK and FCD-FRESH-HC-UNSUPPORTED in `fresh-call-dispatch.json`, gate `check-fresh-call-provider`; V2RESUME-CC-HC-JOIN / -PID-UNREPORTED, V2RESUME-PD-HC-LAUNCH / -RESERVATION, V2RESUME-PI-HC-RENDER in `v2-visible-resume.json`; RESUMECLI-CONTEXT-HC / -AMBIGUOUS in `resume-cli.json`; each fails its own title in a writer self-check). `hc-launch.json` (14), `hc-placement.json` (27: HCP-*, PLC-*, TMP-*), `MUXRESUME-HC-REFUSED` and `RESUMECLI-CONTEXT-HC-HALF` exist and were self-checked by the writer (each mutant fails its own title; nine placement mutants also fail a neighbouring title); that is NOT a PARTIAL receipt. The seven re-anchored mutants (five in checkpoint 2, `HP-ONE-READ-PER-LISTING` in 3 and 4, `MHSS-PEERS-RECEIVER-OBSERVED` in 4) and the two payload mutants moved by revision 26 (`GUIDANCE-REVIEWED-REVISION`, `GUIDANCE-RESUME-REJECT-HINTS-ORIGINAL`) have unmeasured kills. PARTIAL on 99f1f5c8 (`~/.local/share/entwurf-lab/178/partial/`): seven groups green — check-fresh-call-provider 7/7, check-mux-resume-call 18/18, check-fresh-call-dispatch 15/15, check-agent-guidance-beside 14/14, check-herdr-placement 13/13, check-meta-hook-session-switch 25/25, check-install-surface 44/44. The eighth, `check-entwurf-v2-visible-resume`, was stopped on purpose when the pi-durable join changed its subjects and is owed ONCE on the commit that carries that change. The groups as first listed: `["bash","run.sh","check-entwurf-v2-visible-resume"]`, `["bash","run.sh","check-fresh-call-dispatch"]`, `["bash","run.sh","check-fresh-call-provider"]`, `["bash","run.sh","check-herdr-placement"]`, `["bash","run.sh","check-meta-hook-session-switch"]`, `["bash","run.sh","check-mux-resume-call"]`, `["bash","run.sh","check-agent-guidance-beside"]`. FULL floor only on the frozen candidate.

# Path B — waiting for GLG (the only accepted measurement; decided by 68bd94 via 885314)

`entwurf_resume_call` made BY an hc-seated citizen. A test citizen asked over v2 declined, correctly: the tool needs the operator's explicit request in its own session (negative receipt, `live2/RECEIPT.md`). The writer must not type into its terminal (`hc send` was refused as impersonation) and must not open a citizen with a self-attributed request.

- Where: hc core `oracle`, terminal **t1g**, name `entwurf-resume-805657192fa247ad` — test Claude Code citizen `20261128T125309-d9ecc0` (claude-sonnet-5-5). In the App it is the Claude Code terminal whose cwd ends in `178/live3/cwd-cc`. If it has been quit, reopen it first from any hc terminal: `entwurf resume 20261128T125309-d9ecc0`.
- What GLG says there, one line: `entwurf_resume_call 도구로 20261128T123102-a05627 을 다시 열어줘. 도구가 돌려준 글을 그대로 보여줘.`
- Target: `20261128T123102-a05627` — test pi-durable citizen, dormant (quit from t19, exit 0). Its code word from L-1 is `LAB178-ROSE-4417`.
- Expected, each a separate observation: (launch) a receipt headed `[entwurf resume call ↻ hc]` naming a NEW terminal on core `oracle` and an attributed actor (d9ecc0, unlike the CLI's `unattributed`); (observation) `adopted`; (App) a new pi-durable terminal appears; (recall + round trip) the writer then sends a v2 message asking for the code word and expects `LAB178-ROSE-4417` back. A pi or Claude Code TARGET from this caller is expected to refuse `hc-runtime-unresolved` because the core's PATH has neither binary — an ESTIMATE, unmeasured.

# Test citizens (all test-only; quit cleanly, never retire)

Record vs observation: no location is recorded anywhere. Core observation at 2026-11-28 13:0x KST (`hc ls`), Entwurf `peer-facts` with the opt-in variable in parentheses.

| garden id | backend | born | now |
|---|---|---|---|
| `20261128T125309-d9ecc0` | claude-code | tmux @97 | live, hc t1g (`hc oracle/t1g`) |
| `20261128T125340-9f9443` | pi-durable | tmux @98 | dormant — quit 13:5x with ctrl+c in hc t1j |
| `20261128T125432-ea3378` | pi | tmux @99 | dormant — quit with `/quit` in hc t1m |
| `20261128T124035-5541ae` | claude-code | hc t1b | dormant — quit with `/exit` in tmux pane %100 |
| `20261128T123102-a05627` | pi-durable | hc | dormant (was t19) — path B target |
| `20261128T121853-7bc485` | pi | hc | dormant, never prompted (no transcript) |

Kept live on purpose: `d9ecc0` (hc t1g, the seat for path B). Kept dormant: `a05627` (path B target). No record or transcript was removed and nothing was retired.

To show the three backends in the App again, from any Herdr Core terminal whose `PATH` has `entwurf` (one new terminal each; the Claude Code one is already there as t1g): `entwurf resume 20261128T125340-9f9443` (pi-durable), `entwurf resume 20261128T125432-ea3378` (pi). To see one in tmux instead, run the same line from a tmux pane with no `HC_*` variables: `entwurf resume 20261128T124035-5541ae` (Claude Code). Quit them afterwards in their own terminals: `/exit` (Claude Code), `/quit` (pi), ctrl+c (pi-durable).

Quit: `/exit` (Claude Code), Ctrl-C (pi-durable), `/quit` (Pi) in the terminal. Sensitive absolute socket paths stay in the local receipts.

# Known hazards (885314 source reading, v0.1.20)

- On Linux with a systemd user manager the core is started as a transient `systemd-run` user unit, writes an environment file under the runtime dir, installs a shutdown guard and may attempt `loginctl enable-linger` (`crates/herdr-core/src/platform/systemd.rs` @v0.1.20: 60-63 manager check, 71-125 spawn, 320-335 linger). A sandbox HOME alone does NOT isolate this. Reading of 60-63: a private, non-default `XDG_RUNTIME_DIR` makes the manager check fail and the core starts the plain way — verify before relying on it.
- `hc connect` / `hc schema` / most CLI calls can auto-start a core (`client.rs` `connect_or_start`). Treat any hc invocation as a possible start.
- `terminal.run` defaults: parent = caller terminal, die-with-parent, parent notes typed into the parent agent. argv[0] matching a template name triggers a first message.

# P0 result (source read at v0.1.20 = de97ea5b; nothing was run)

All paths are `crates/herdr-core/src/` at the tag.

| touch | where | contained by |
|---|---|---|
| systemd-run transient unit `hc-serve-*` / `hc-hold-*` | `platform/systemd.rs:71-143`; gate `:58-65` | `XDG_RUNTIME_DIR` set, non-empty and != `/run/user/<uid>` → `manager()` Err(false) → `spawn` returns None → plain setsid spawn (`client.rs:209-217`, `platform/unix.rs:204-219`). **The NEXT reading is confirmed.** Unset or empty is NOT isolation: it defaults to the real dir (`:60`). |
| shutdown guard `hc-shutdown-<fnv(state dir)>.service` | `systemd.rs:147-184`, called at `:81` | same gate (only reached after `manager()` Ok) |
| `loginctl --no-ask-password enable-linger <user>` | `systemd.rs:309-343`, called at `:137-138` | same gate (only after a successful systemd-run) |
| env file `<run>/hc-*/environment` (caller env on disk) | `systemd.rs:206-219`, `:114` | same gate |
| `busctl --user` read of the manager environment into every program | `systemd.rs:347-359`; `platform/mod.rs:310-336` | same gate (`manager().ok()?`) |
| socket + holder sockets | `paths.rs:26-35`; `platform/unix.rs:130-137` | `HC_SOCKET`, else config `socket`, else `$XDG_RUNTIME_DIR/herdr-core/<session>.sock` |
| state (`core.lock`, `core.json`, registry, logs, `execs/`) | `paths.rs:22-23`; `server.rs:45-60` | `XDG_STATE_HOME` (+ `HC_SESSION` names the subfolder) |
| config + templates | `paths.rs:24`; `templates.rs:37-39` | `XDG_CONFIG_HOME` (an empty one also means no template can match argv[0]) |
| HOME fallbacks, cwd | `platform/unix.rs:117-120`; `exec.rs:121-125` | `HOME`; start from a cwd inside the root |
| program environment | `platform/mod.rs:310-336`; `api/run.rs:212-251` | not containable by the core: a program gets the core's START env minus systemd-service vars, ssh-login vars, TERM identity, `HC_TERMINAL_ID`/`HC_SCOPE`/`HC_RUNTIME`. `PI_SESSION_ID`, `HERDR_ENV`, `ENTWURF_*` pass through. Start the core under `env -i`. |
| process sweep by `HC_SCOPE` | `sweep.rs:74-130`, `:134-152`; callers `runtime.rs:908-918`, `exec.rs:103-116`, `:308` | cannot be scoped to a root: it reads `/proc/*/environ` of every process this uid can read and signals HUP/TERM/KILL any carrying a matching token plus descendants. Tokens are `<clock>-<32 hex>` per terminal (`sweep.rs:15-17`) and `HC_RUNTIME=1` processes are skipped, so a hit outside the core needs a process that inherited that exact token. Keep operator `HC_*` out of the fixture env. |
| read-only host reads | `platform/unix.rs:567-615`; `client.rs:143-149` | `/etc/machine-id`, `/proc/sys/kernel/random/boot_id`, `/proc/self/exe`: not containable, harmless |
| network / ssh | `releases.rs:26-38`; `machines.rs:174-177`; `remote.rs` | only `hc update`, `hc machine *`, or machines saved in state; a fresh state has none. No update check on start was found. |

Autostart: every CLI call except `server stop` can start a core (`client.rs:77-123`; `cli.rs:230-233`, `:806-809`; `platform/unix.rs:44-50`). A holder also restarts a lost core (`holder.rs:440-464`), so teardown must end the holder too.

Proposed isolation env (start under `env -i`): `HOME`, `TMPDIR`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_RUNTIME_DIR` (0700), `HC_SOCKET` all inside the root; `HC_SESSION=lab178`; PATH with tripwire shims for systemd-run/systemctl/loginctl/busctl/ssh/scp/sudo first.

Pin: `github:NixOS/nixpkgs/2786a2a72088ecf32aea5b3ec52099e6a7cff78f#herdr-core` → `/nix/store/rk0mgpwdf0av4wwb74iqf2k09hk8lnc0-herdr-core-0.1.20` (`nix eval --read-only`; not in the store on oracle). The package patches `releases.rs` and `machines.rs`, so the binary is not byte-for-byte the tag's source.

Not determined: every row above is a source reading, not a run; the JSON field names the cases parse; whether `HC_SPAWN_MS=1` reliably loses the race; where a real App viewer places an RPC-created terminal.

Earlier operating-host measurements (previous writer, n=1 each): `~/.local/share/entwurf-lab/178/ops/RECEIPT.md` — start env reaches every program unscrubbed; a parented child dies with its parent while `--no-parent` survives; `spawn_failed` leaves no record; RPC-created terminals are visible to `ls`, `events`, an observing attach and GLG's phone App.

# Do not touch

Operating citizens (never `entwurf_retire_call`), operating profile and Home Manager, the operator's real config files, SSH config/keys, `entwurf_v2` delivery, #156, #170. No push, tag, release or GitHub write. Tokens and whole environments are never printed: variable names only.
