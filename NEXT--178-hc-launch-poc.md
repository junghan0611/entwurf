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
- [ ] **(2) Claude Code resume in Core** (L-2): the `marker.ownerPid === terminal.run pid` join is implemented and unit-tested, LIVE unmeasured. ← NEXT
- [ ] **(3) Pi resume in Core** (L-4): implemented, LIVE unmeasured (needs a prompted Pi test citizen so a transcript exists).
- [ ] **(4) Placement view**: `ENTWURF_HC_PLACEMENT_SOCKET` reader (same-host view only; absent / missing / connect / reply / join failure → `unobserved` once; malformed or non-socket → a named placement-config error with zero delivery effect; no discovery, retry or fallback), Claude Code join by validated owner pid; pi / pi-durable stay `unobserved` (G-P2). L-7 in two rows: control (no opt-in) and opt-in.
- [ ] **(5) Text and guards**: `ENTWURF-CLI.json` (`entwurf help resume` still says "only inside tmux or herdr"), `ENTWURF.json` resume/fresh descriptions and hints (reviewed amendment layer + payload revision), the tmux resume leaf's hc guard for a direct caller, `check-typing-call-fence` hc methods, docs (`docs/hc-launch-rail.md`, AGENTS.md references).
- [ ] **(6) Qualification owed before the frozen candidate**: mutant manifest for the HCL-* / FCD-RESUME-* / V2RESUME-*-HC / RESUMECLI-CONTEXT-HC* claims (QKs exist, exact-once mutants do not yet), affected PARTIAL groups, then the FULL floor once.

Path B (`entwurf_resume_call` from an hc citizen), the picker in an hc terminal, a tmux-born citizen reopened in hc, and a core started from a tmux or herdr seat: all unmeasured.

Known boundaries (checkpoint 1): the core's PATH on oracle has no `entwurf` / `pi` / `claude`; argv[0] is resolved on the CALLER's PATH to an absolute file, and the reopened program then runs with the CORE's environment (no PATH projection, same as tmux and herdr). Whether a reopened Claude Code or Pi finds its tools under that PATH is part of L-2 / L-4.

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
