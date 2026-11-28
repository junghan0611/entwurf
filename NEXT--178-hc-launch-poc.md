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
- [x] **(4) Placement view** (checkpoint 3): `hc-placement.ts` — operator env `ENTWURF_HC_PLACEMENT_SOCKET`, one `hello` + one `terminal.list`, Claude Code joined by validated receiver-marker owner pid, pi / pi-durable `unobserved`; absent or unanswered → `unobserved`, relative / not-a-socket → `HcPlacementConfigError`. `PlacementObservation` gained `hc-terminal`. L-7: `~/.local/share/entwurf-lab/178/live7/RECEIPT.md`. NOT done from design D9: a tmux placement arm (`tmux-pane`) — not in the coordinator's ruling for this cut; the lister's own `HC_TERMINAL_SOCKET` is deliberately not read (opt-in only).
- [ ] **(5) Text and guards** ← next. bf156a D-2: `ENTWURF-CLI.json` (`entwurf help resume` still says "only inside tmux or herdr") + `check-install-surface`; `ENTWURF.json` resume/fresh descriptions and hints (reviewed amendment layer + payload revision). O-2: the tmux resume leaf's hc guard twin (L3-draft rev 4 :134) — today `mux-resume-call.ts` is imported only by `visible-resume-launch.ts`, itself imported by `resume-cli.ts:84` and `mcp/entwurf-bridge/src/index.ts:134`, both through the dispatch root. Docs: `docs/hc-launch-rail.md`, AGENTS.md references, `docs/mux-launch-rail.md` §7 amendment for the pid join, README/VERIFY placement variable. Document as PREMISES, no Entwurf-side resolver: (a) a program an hc core starts has the CORE's PATH — `entwurf` / `pi` were not on it on oracle (L-0 pre-check, observation only); (b) `hasHcMarker` is true on either variable, so a tmux pane that inherited `HC_*` keeps refusing fresh calls; (c) env reach of `ENTWURF_HC_PLACEMENT_SOCKET` per harness only where verified (Codex unverified); (d) the App's Inbox status is the program's own OSC report, not an Entwurf fact.
- [ ] **(6) Qualification owed before the frozen candidate**: mutants still missing for FCD-RESUME-RAIL-TABLE / -AMBIGUOUS-NO-RAIL / -HC-NO-FALLBACK, FCD-FRESH-HC-UNSUPPORTED, V2RESUME-CC-HC-JOIN / -PID-UNREPORTED, V2RESUME-PD-HC-LAUNCH / -RESERVATION, V2RESUME-PI-HC-RENDER, RESUMECLI-CONTEXT-HC / -AMBIGUOUS. `hc-launch.json` (14) and `hc-placement.json` (16) exist and were self-checked by the writer (each mutant fails only its own title); that is NOT a PARTIAL receipt. The six re-anchored mutants (five in checkpoint 2, `HP-ONE-READ-PER-LISTING` in checkpoint 3) have unmeasured kills. Run the affected exact-argv groups once after review: `["bash","run.sh","check-entwurf-v2-visible-resume"]`, `["bash","run.sh","check-fresh-call-dispatch"]`, `["bash","run.sh","check-herdr-placement"]`. FULL floor only on the frozen candidate.

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
| `20261128T125340-9f9443` | pi-durable | tmux @98 | live, hc t1j (`unobserved`, G-P2) |
| `20261128T125432-ea3378` | pi | tmux @99 | live, hc t1m (`unobserved`, G-P2) |
| `20261128T124035-5541ae` | claude-code | hc t1b | dormant (was t1d) |
| `20261128T123102-a05627` | pi-durable | hc | dormant (was t19) — path B target |
| `20261128T121853-7bc485` | pi | hc | dormant, never prompted (no transcript) |

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
