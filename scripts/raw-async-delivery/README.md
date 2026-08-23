# raw-async-delivery — RAW async message delivery into LIVE Claude Code / agy / Codex / Copilot sessions

Goal: deliver an async message INTO an already-running **subscription** session,
free, with no `claude -p` / backend CLI prompt spawn — and in particular wake an
**IDLE** session with zero typing (agy `send-message` parity).

Codex is split by launch surface:

- standalone **Embedded** Codex TUI: no external socket; not addressable, not
  retrofittable.
- **app-server-backed** Codex TUI (`codex --remote unix://` or plain `codex`
  auto-attached to a default-path app-server): raw `turn/start` over
  WebSocket-over-UDS wakes the live thread — **demonstrated, no managed
  standalone, no cloud**.

Copilot is no longer blocked on transport — it has one bundled extension door:

- **Copilot CLI 1.0.80 extension**: the CLI forks a first-party extension and
  speaks JSON-RPC over that child's **stdio**, so `fs.watch` -> `session.send()`
  wakes the idle TUI with **no network listener or token-authentication axis**. Idle wake
  and exact-marker attribution were demonstrated; addressed isolation was observed but its
  decisive control log was not preserved (2026-08-23, one Linux workstation). It needs the experimental
  `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS` flag at launch. The older
  hidden `--ui-server` loopback probe is retired — it found the capability
  through a door that could not pass admission. Undocumented
  `~/.copilot/run/ws.*` is still not a rail.

## TL;DR — three reception paths, ranked

| Path | Self-arms idle watch? | Portable / drop-in | Verdict |
|------|----------------------|--------------------|---------|
| **Plugin** (`.claude-plugin` + `hooks/hooks.json`) | ✅ yes | ✅ yes (`--plugin-dir` / install) | **best** — scoped AND works |
| Global/project `settings.json` hooks | ✅ yes | ⚠️ config edit, not a unit | works; less portable |
| **Bare skill** (`~/.claude/skills/x/` with `hooks:`) | ❌ **no** | ✅ yes | **structurally unfit for the watch** |

### Why a bare skill cannot arm the idle watch (mechanism, verified)

A bare skill's hooks register only when the model **invokes** the skill
(`getPromptForCommand` → `mL4(setAppState, …, H.hooks, …)`, 2.1.163). That is
mid-session — **after** `SessionStart` already fired. A `watchPath` can only be
emitted from `SessionStart` / `CwdChanged` / `FileChanged` hookSpecificOutput, so
a skill-declared `SessionStart` hook never runs and the watch is never armed.
The model may *read* `SKILL.md` and role-play "watching", but no hook is armed —
a dangerous false-positive for a delivery daemon. Measured: `hook.log` stays
empty; `loadSkillsAsPlugins` only loads dirs that contain `.claude-plugin`.

> The earlier conclusion "scoped delivery is impossible → use global settings"
> was only half right. It is true for a **bare skill**. It is **false** for a
> **plugin**, which is just as portable/drop-in and whose hooks load at startup.

### Why a plugin works

`hooks/hooks.json` inside a plugin is loaded at **startup** (not on invocation),
so its `SessionStart` hook actually fires and arms the `watchPath`. From there
`FileChanged(asyncRewake)` wakes the idle session on an external file write.
Verified live on 2.1.163 / Opus 4.8: idle session, zero typing, ~1–2 s, same
session + same model.

## Addressed, not broadcast

Delivery is **per-session addressed**: each receiving session arms a watchPath at
`<root>/<session_id>/inbox.signal` (session_id arrives on the SessionStart hook
stdin). A sender targets ONE `session_id`; only that session's signal changes, so
**only that session wakes** — siblings stay idle and undisturbed. This is the
entwurf sessionId-addressing model: "send to the one you want, only it processes."

```
$CC_MAILBOX_ROOT/<session_id>/inbox.signal     # watched (poked by the sender)
$CC_MAILBOX_ROOT/<session_id>/<ts>.msg          # message body (agent self-fetches)
$CC_MAILBOX_ROOT/<session_id>/hook.log          # per-session hook evidence
```

`CC_MAILBOX_ROOT` defaults to `~/.claude/mailbox`. Sender and receiver must agree
on the root. A fixed shared signal would broadcast and bother every session — we
do not ship that. Proven: deliver to A's sessionId → A wakes (FileChanged), B's
`hook.log` shows zero FileChanged, B pane unchanged (`repro-addressed-routing.sh`).

## Files

### Plugin (recommended reception unit)
- `plugin-entwurf-receive/.claude-plugin/plugin.json` — manifest
- `plugin-entwurf-receive/hooks/hooks.json` — SessionStart(watch) + FileChanged(asyncRewake)
- `plugin-entwurf-receive/scripts/watch-sessionstart.sh` — arms the **per-session** watchPath (reads session_id from stdin)
- `plugin-entwurf-receive/scripts/watch-filechanged.sh` — doorbell on external write; mailbox = `dirname(file_path)`, so it reads only its own session

### settings.json reception (alternative; global = every session arms its own watch)
- `cc-watch-sessionstart.sh` — SessionStart: register per-session watchPath
- `cc-watch-filechanged.sh` — FileChanged(asyncRewake): active idle-wake doorbell
- `cc-mailbox-rewake.sh` — Stop(asyncRewake): passive piggyback (next turn boundary), keyed by session_id

### Delivery (sender side, all free file writes, all addressed by sessionId)
- `cc-enqueue-addressed.sh <session_id> …` — ACTIVE: write `.msg` + poke that session's signal → wakes it from idle
- `raw-claude-enqueue.sh <session_id> …` — PIGGYBACK: write `.msg` only → delivered at the session's next turn boundary
- `raw-agy-send.sh <conv_id> …` — agy parity: PUSH into a live Antigravity session (LS gRPC)
- `raw-codex-ws-turn-start.py <sock> <thread_id> …` — Codex parity (no managed standalone, no cloud): PUSH `turn/start` over WebSocket-over-UDS into a bare `app-server --listen` socket
- `codex-local-appserver.sh [sock]` — start a bare local app-server so plain `codex` auto-attaches and becomes addressable
- `copilot-enqueue-addressed.sh <session_id> …` — Copilot raw sender: write `.msg` + poke one session's signal; refuses a missing marker, but deliberately does not claim production stale-receiver safety
- `copilot-extension-receive/extension.mjs` — Copilot reception unit: a first-party CLI extension that arms the per-session mailbox and calls `session.send()` (stdio JSON-RPC; no port, no token)
- `copilot-ui-server-probe.mjs` — RETIRED rail, kept as history; the hidden `--ui-server` loopback path whose authentication could not be established

### Reproduction drivers
- `repro-plugin-idle-wake.sh` — single-session smoke.
  - `probe` — deterministic (no tmux): plugin SessionStart hook fires at startup + arms per-session watch.
  - `live` — one session idle → addressed external write wakes it, zero typing.
- `repro-addressed-routing.sh` — **two sessions** A,B → deliver to A only → assert A wakes, B undisturbed.

## Quick start (plugin reception)

```bash
# 1. open a live receiving session with the plugin loaded
export CC_MAILBOX_ROOT=/tmp/cc-mbx
claude --plugin-dir ./plugin-entwurf-receive --dangerously-skip-permissions
#   (SessionStart hook arms <root>/<session_id>/inbox.signal automatically)

# 2. find the target session's id
cat ~/.claude/sessions/*.json   # pick the sessionId you want (match by cwd/pid)

# 3. from anywhere else, deliver async to THAT session only (no typing):
CC_MAILBOX_ROOT=/tmp/cc-mbx ./cc-enqueue-addressed.sh <session_id> "your async message"
#   -> only that session's FileChanged fires -> asyncRewake doorbell
#   -> that idle session wakes, self-fetches body; siblings stay idle
```

## Design notes / invariants

- **Doorbell only.** `asyncRewake` payload rides **stderr** (stdout is ignored).
  Announce "you have mail" + the body path; never push imperatives — strong
  models flag hook-injected commands as prompt injection. The agent self-fetches.
- **Body path in the doorbell.** The hook `mv`s `*.msg` → `*.msg.delivered`
  before announcing and reports the `.delivered` path, so the agent reads it in
  one step (measured: removes a filesystem-hunt round-trip).
- **Free.** Both active and piggyback are file writes + continuation of an
  already-running subscription session. No `claude -p` spawn for the wake.
  (`claude -p` spawn is the metered axis from 2026-06-15; delivery is not.)
- **Same session / same model.** The wake is an in-process continuation; the
  reply comes from the bound main model (verified `claude-opus-4-8`).
- **Version-pinned.** Behavior measured on Claude Code **2.1.163**. Re-verify on
  upgrade (claude ships ~weekly; undocumented fields drift).

## Gotchas — hard-won, do NOT re-debug (삽질 방지)

Each line below cost real debugging time. If you change this code or port it,
re-read these first. Two of them were flat-out wrong "impossible" conclusions
that a second pass reversed.

1. **Stop hook CANNOT wake an IDLE session.** `asyncRewake` on `Stop` fires at a
   *turn boundary*. An idle session has already passed its last `Stop`, so it
   never re-fires on its own — Stop only delivers *piggyback* at the session's
   NEXT turn. The idle active-wake path is **`FileChanged` + `watchPaths`**, not
   `Stop`. (Wrong conclusion #1 was "Claude can't idle-wake" — it was an *event
   selection* error, not a capability limit.)
2. **A bare skill cannot arm the watch; a plugin can.** Bare-skill hooks register
   at skill *invocation* (mid-session, after `SessionStart`); plugin
   `hooks/hooks.json` loads at *startup*. (Wrong conclusion #2 was "scoped is
   impossible → global settings only". See top of this file.)
3. **`asyncRewake` payload channel is `stderr` ONLY.** Anything on `stdout` is
   dropped and the model sees "No stderr output". The body must go to stderr.
4. **`asyncRewake` force-prepends `Stop hook feedback:\n[<script>]:`** and
   **ignores any configured `rewakeMessage`**. You cannot control the exact
   injected string — so use it as a *doorbell* (notify only) and let the agent
   self-fetch the body. Do not depend on injecting the literal message.
5. **Infinite-loop guard is mandatory.** Honor `stop_hook_active` (if `true`,
   `exit 0` — already continuing, let it stop) or you get a wake loop. The engine
   also caps re-wakes via `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`.
6. **`watchPaths` can be emitted from only 3 events:** `SessionStart`,
   `CwdChanged`, `FileChanged` (hookSpecificOutput). FileChanged/CwdChanged can
   *dynamically extend* the watch list mid-session; everything else cannot arm a
   watch. This is the whole reason the SessionStart-timing problem matters.
7. **Imperatives in an injected message get flagged as prompt injection** by
   strong models (Opus refused). Doorbell = notification framing only.
8. **Liveness SSOT is `~/.claude/sessions/<pid>.json`, NOT db-shm/db-wal.** WAL
   files vanish on SQLite checkpoint while the session is still live, and
   reappear on activity — a false "dead/alive" signal. See section below.
9. **Cost line: only `claude -p` *spawn* is metered (from 2026-06-15).** The
   wake/delivery is a continuation of an already-running subscription session and
   is free. Don't conflate "launch a new session" with "deliver to a live one".
10. **Test-harness quirk:** the Claude TUI sometimes needs a second `Enter` to
    submit a `tmux send-keys` prompt (the first keystroke only fills the input
    box). The repro drivers send `Enter` twice on purpose — not a bug.

## Codex raw delivery status (0.136.0)

Measured against `@openai/codex` 0.136.0 (source: `~/repos/3rd/codex`). **Codex IS
breakable for local raw idle-wake — without managed standalone and without cloud.**
Split by launch mode, not by "Codex".

### Embedded standalone TUI: negative (and not retrofittable)

A plain `codex` TUI launched standalone runs an **Embedded** in-process app-server
and binds **no external socket** (verified: the live PID has no listening socket;
its ~2400 inotify watches are project file-tracking for `fs_watch`/`skills_watcher`,
not a wake trigger). Codex hooks (`SessionStart`, `UserPromptSubmit`, `Pre/PostToolUse`,
`Pre/PostCompact`, `SubagentStart/Stop`, `Stop`) have **no `FileChanged`/`watchPaths`/
`asyncRewake`**, so there is no Claude-style filesystem wake either. The
Embedded/daemon decision is made once at launch (`run_main`), so an already-running
standalone TUI **cannot be retrofitted**. Identify it via `CODEX_THREAD_ID` /
`~/.codex/state_5.sqlite` / rollout JSONL, but do not write those as a wake path.

### Local app-server-backed TUI: POSITIVE — D6/D7, DEMONSTRATED

A TUI that is backed by a local app-server control socket **is** addressable. Two
launch shapes both reach it, neither needs the managed standalone or the cloud:

- `codex --remote unix://PATH` — explicit attach to an app-server on `PATH`.
- plain `codex` (no `-c` overrides) — auto-attaches to an app-server already
  listening on the **default** control socket path (`maybe_probe_default_daemon_socket`).

Make sessions addressable (see `codex-local-appserver.sh`):

```bash
# bare app-server on the default control socket — NO managed standalone, NO cloud
codex app-server --listen unix://$HOME/.codex/app-server-control/app-server-control.sock &
codex            # plain launch auto-attaches; its thread is now reachable
```

Deliver (WebSocket-over-UDS `turn/start`, no auth — the 0700 socket dir is the boundary):

```bash
# threadId = newest rollout's session_meta id
tid=$(head -1 "$(ls -t ~/.codex/sessions/**/rollout-*.jsonl | head -1)" \
      | python3 -c 'import json,sys;print(json.load(sys.stdin)["payload"]["id"])')
./raw-codex-ws-turn-start.py "$HOME/.codex/app-server-control/app-server-control.sock" \
    "$tid" "your async message"
```

Measured (0.136.0, 2026-06-05): idle plain `codex` (auto-attached) woke with **zero
typing**, the message body was injected, the model replied. `thread/status/changed`
(`active`→`idle`) notifications give completion observation (D7) on the same socket.
This is **stronger than Claude Code** — full message injection (like agy), not a
doorbell + self-fetch.

### Out of scope: the managed-daemon / cloud path

This repo ships only the **bare local** path (`codex app-server --listen` +
`raw-codex-ws-turn-start.py`). There is a second Codex surface we deliberately do
**not** use: the managed **daemon** control socket driven via `codex app-server
proxy` (newline JSON-RPC). It needs the managed standalone install
(`~/.codex/packages/standalone/current/codex`), and `codex remote-control start`
additionally enables the **cloud** bridge (ChatGPT app access). For a purely-local,
no-cloud setup the bare `--listen` socket above is sufficient, so no managed-daemon
sender is shipped here.

Method notes: `turn/steer` is active-turn steering (needs `expectedTurnId`), not idle
wake; `thread/inject_items` appends history without starting a turn; `debug app-server
send-message-v2` spins a fresh thread, not the live one.

### Gotchas (Codex)

1. **Socket dir mode 0700, owner-owned.** `prepare_private_socket_directory()` chmods
   the socket's parent dir to exactly 0700. Pointing `--listen` at a dir you don't own
   (e.g. `/tmp` directly, mode 1777) fails with **EPERM** — that is the chmod, not a
   capability limit. `~/.codex/app-server-control/` (Codex creates it 0700) is fine.
2. **`-c` overrides disable auto-attach.** `can_reuse_implicit_local_daemon` requires
   no `-c`, default loader, no `--strict-config`, no bypass-hook-trust. Launch plain
   `codex` for auto-attach, else use explicit `--remote`.
3. **Per-folder trust** (`config.toml [projects."<path>"]`) governs whether a thread
   loads project-local config/hooks/exec-policy — NOT whether it is addressable.
   Addressability is the app-server socket; trust is orthogonal.
4. **Unix-socket transport is WebSocket** (tokio-tungstenite), not newline JSON-RPC,
   and requires **no auth token** on the UDS. A plain WS client suffices.

## Copilot CLI delivery status (1.0.80) — idle wake DEMONSTRATED on the extension rail

Copilot is a GitHub **harness** (issues, PR, CI, model `auto`, mode `autopilot`,
remote/delegate), not a second GPT provider next to pi. This makes a native lane
product-distinct from the declined Codex lane: Copilot can own GitHub work while
implementation checkpoints arrive from another garden id. That split is operator
etiquette plus dispatch, not a substrate role system.

The cost premise must stay honest. Copilot reports AI Credits and a monthly
premium-interaction entitlement; model `auto` chooses a path within that budget.
The reason to use it is GitHub specialization and auto routing, not an unlimited
subscription claim. Model `auto` and mode `autopilot` are separate axes.

### The rail: a first-party CLI extension, stdio only

`copilot-extension-receive/extension.mjs` + `copilot-enqueue-addressed.sh`.

The CLI forks an extension as its own child and speaks JSON-RPC over that
child's stdio. `joinSession()` attaches it to the foreground session; from
there `session.send({mode:"enqueue"})` injects a user message. So the whole
delivery path is:

```
external file write  ->  fs.watch in the extension  ->  session.send()  ->  the idle session takes a turn
```

`fs.watch` -> `session.send()` is not a mechanism found by inspection: the
bundled SDK documents it (`copilot-sdk/docs/examples.md`, "Detecting when the
plan file is created or edited"). The SDK also ships *inside* the CLI package
(`<platform-pkg>/copilot-sdk/`) and is injected into extension children by
`preloads/extension_bootstrap.mjs`, so nothing has to be installed and the SDK
version cannot drift from the CLI.

**This is why the rail clears the network-boundary bar the old one could not.**
The `--ui-server` probe was refused because its loopback RPC authentication was
not established. An extension has no port, token, or listener, so that network
authentication axis does not exist. Product admission must instead certify the
installed extension's provenance and the CLI-owned parent/child lifecycle; the
fork is the transport boundary, not proof that every permission, liveness, and
integrity obligation is already closed.

### Launch contract

Extensions sit behind an experimental feature flag. Without it the CLI never
scans for extensions and the receiver is inert **with no error at all** —
budget for that when a receiver appears not to arm:

```bash
COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS copilot --model auto
```

`--experimental` is NOT required (measured: a session launched with the env var
alone armed its receiver). Discovery scopes are `user`
(`~/.copilot/extensions/`), `plugin`, `session`, and — interactive mode only —
`project` (`.github/extensions/`). Prompt mode (`-p`) drops `project` unless
`GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS=true`. The `plugin` scope matters most
here: the existing entwurf Copilot plugin is the candidate install scope for
this receiver, so product design need not start from a per-repository
`.github/extensions/` directory.

### Reproduce

```bash
mkdir -p /tmp/cop-lab/.github/extensions/entwurf-mailbox
cp copilot-extension-receive/extension.mjs /tmp/cop-lab/.github/extensions/entwurf-mailbox/

# terminal A: a visible session that arms its own receiver
cd /tmp/cop-lab
export COPILOT_MAILBOX_ROOT=/tmp/cop-lab/mbx COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS
copilot --model auto --allow-all-tools     # accept folder trust

# terminal B: find the armed receiver, then wake it with zero typing
ls /tmp/cop-lab/mbx/*/ready.json
COPILOT_MAILBOX_ROOT=/tmp/cop-lab/mbx \
  ./copilot-enqueue-addressed.sh <session_id> "Reply with exactly PING and nothing else."
```

### Measured — 2026-08-23, CLI 1.0.80, model `auto`, one Linux workstation (oracle, arm64)

Evidence level **L4 direct-native, one host**. The receiver log lines that still
travel are pasted here. Scratch was cleaned before the second-session control and
second-turn lines were copied, so those two observations are explicitly downgraded
below rather than being laundered into durable receipts:

```text
02:19:33.996 ARMED sessionId=4fc16d8d-473d-4258-a1fd-f99d3cb375e9
02:20:03.388 DELIVER (signal) 1787451603.msg bytes=96
02:20:03.422 SENT 1787451603.msg
02:20:06.141 EVENT user.message  {"content":"...Reply with exactly ENTWURF-WAKE-1787451603..."}
02:20:06.492 EVENT assistant.turn_start {"turnId":"0"}
02:20:09.935 EVENT assistant.message {"turnId":"0","content":"ENTWURF-WAKE-1787451603"}
02:20:10.024 EVENT session.idle {}
```

- **Idle wake: PASS.** The session had never been typed into — an empty timeline,
  already past any turn boundary. An external file write started a turn. ~2.7 s
  poke -> `user.message`, ~6.5 s poke -> reply. The visible TUI showed the prompt
  and the answer.
- **Attribution: PASS.** A unique per-run marker went in and came back exactly,
  on one `assistant.turn_start`/`assistant.message` pair.
- **Addressed routing: reported, receipt not preserved.** The measuring Opus
  reported that a second armed process B stayed at one `ARMED` line across two
  deliveries to A, with no `user.message` or `assistant.*` event. The decisive B
  line and A's second delivery were not copied before scratch cleanup, so this is
  a lead for the admission rerun, not durable D3 acceptance.
- **Continuity: one turn demonstrated.** The pasted chain shows one joined
  session taking the marker turn and replying; no `-p` process was spawned. A
  second same-session turn was reported but its lines were not preserved, so no
  stronger repeatability claim crosses from this checkpoint.

### Not proven — do not describe these as working

- **Active-turn delivery.** Every measured send landed on an idle session.
  `mode:"enqueue"` vs `"immediate"` against a busy turn is untested.
- **Multi-session inside ONE CLI process.** A and B were separate `copilot`
  processes. Whether a *background* session inside one process (sidebar tabs)
  can be woken while another holds the foreground is untested, and
  `joinSession()` attaching to "the foreground session" is the reason to doubt it.
- **`/clear` and foreground replacement.** The docs say extensions reload there;
  re-arming was not measured. `[문서]`, not `[측정]`.
- **Flag durability.** `EXTENSIONS` is an experimental flag with
  `experimental`/`staff-or-experimental` availability. It can move or be
  withdrawn between CLI releases; re-verify on upgrade. A flagged surface is an
  admission question for a managed lane even when the transport is sound.
- **Permission ownership, crash and ordering behavior, delivery under load.**

Do not add `backend:"copilot"` receive capability, a `FRESH_CALL_BACKENDS` entry,
a schema change, or an OPEN issue from this. What changed is that the transport
objection that closed the receive lane is gone; whether entwurf admits the lane
is a separate decision with its own evidence bar.

### Retired: the hidden `--ui-server` probe (kept for the lesson)

The 2026-08-19 probe reached the TUI through `copilot --ui-server --port 43817`
and the separately-installed SDK, and it did demonstrate an idle enqueue. It was
refused admission because the launch flag is hidden from `copilot --help` and its
loopback RPC authentication could not be established: an unauthenticated client
connected, while setting `COPILOT_CONNECTION_TOKEN` on the server made a
token-bearing client fail with `AUTHENTICATION_NOT_CONFIGURED`.

The lesson is not "that probe was wrong". It found a real capability through the
wrong door, and then the door — not the capability — was what failed admission.
The bundled extension door was in the same package the whole time: the SDK that
this probe installed from npm also ships inside the CLI, with an `extension.mjs` contract and
docs beside it. `copilot-ui-server-probe.mjs` remains in this tree as that history.
Do not revive `--ui-server` as a rail; use the extension.

Also still true, and still out of bounds: hooks have no `FileChanged` /
`watchPaths` / `asyncRewake`, so the Claude mailbox hook mechanism cannot be
copied; the shell command-hook `sessionStart` input carries no `sessionId`
(the receiver publishes its own `ready.json` instead of scraping for one);
`--acp` is a pi-host child path and `--remote` is GitHub web/mobile steering,
neither of which is a local `entwurf_v2` API; and undocumented
`~/.copilot/run/ws.*` is not a rail.

## Live SSOT for "is the target session alive?"

- Claude Code: `~/.claude/sessions/<pid>.json` (pid, sessionId, cwd, status). NOT
  db-shm/db-wal — those vanish on WAL checkpoint while the session is still live.
- agy: `pgrep -x agy` + an LS socket that answers `get-conversation-metadata`.
- Codex embedded TUI: `CODEX_THREAD_ID` + `~/.codex/state_5.sqlite` +
  `~/.codex/sessions/**/rollout-*.jsonl` identify the live thread/transcript,
  but a standalone Embedded TUI exposes no delivery socket.
- Codex app-server-backed: an app-server listening on
  `$HOME/.codex/app-server-control/app-server-control.sock` (or any owned 0700
  socket via `codex app-server --listen unix://PATH`) is the delivery surface.
  threadId comes from the newest rollout's `session_meta.id`.
- Copilot raw probe: `<COPILOT_MAILBOX_ROOT>/<session_id>/ready.json`, written by
  the receiver extension about itself (sessionId, pid, cwd, armedAt). `[번들]`
  `preloads/extension_bootstrap.mjs` monitors the CLI parent, but this is a
  discovery marker for the experiment, **not a production liveness SSOT**: the
  current sender checks only that the file exists, so a crashed extension can
  leave stale state and produce a false enqueue receipt. Product admission must
  bind the receiver to the V3 record and certify pid + start-key ownership before
  dispatch. Parent monitoring does not clean the marker by itself. Nothing
  scrapes `~/.copilot/session-store.db` or the session-state dirs, and the shell
  command-hook `sessionStart` input is NOT
  a source — it carries no `sessionId`. The retired `--ui-server` TCP port was
  never an identity axis.
