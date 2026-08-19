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
- **Copilot CLI 1.0.80 TUI+server**: official SDK `1.0.11` can resolve the
  foreground native session and enqueue into that exact idle TUI; D7 was
  demonstrated once (L4 direct-native, one Linux workstation). The launch flag
  `--ui-server` is hidden from CLI help and its loopback RPC authentication is
  not established, so this remains a probe, not a managed lane. Undocumented
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
- `copilot-ui-server-probe.mjs` — official-SDK D0 probe by default; `LIVE=1` performs one addressed idle enqueue and prints D0–D8

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

## Copilot CLI raw delivery status (1.0.80) — positive TUI+server probe, not a managed lane

Copilot is a GitHub **harness** (issues, PR, CI, model `auto`, mode `autopilot`,
remote/delegate), not a second GPT provider next to pi. This makes a native lane
product-distinct from the declined Codex lane: Copilot can own GitHub work while
implementation checkpoints arrive from another garden id. That split is operator
etiquette plus dispatch, not a substrate role system.

The cost premise must stay honest. Copilot reports AI Credits and a monthly
premium-interaction entitlement; model `auto` chooses a path within that budget.
The reason to use it is GitHub specialization and auto routing, not an unlimited
subscription claim. Model `auto` and mode `autopilot` are separate axes.

### Positive transport

The first-party `@github/copilot-sdk` exposes TUI+server coordination:
`getForegroundSessionId()`, `getSessionMetadata()`, `resumeSession(id)`, and
session-scoped `send({mode:"enqueue"|"immediate"})`. The native TUI launch mode is:

```bash
copilot --ui-server --port 43817 --model auto
```

`--ui-server` is accepted by CLI 1.0.80 and named by the official SDK API docs,
but hidden from `copilot --help`. Launch mode is therefore part of the capability,
and this evidence does not apply to an already-running plain `copilot` TUI.

Measured once on 2026-08-19 with SDK 1.0.11, **using the earlier chronological-slice
probe** (it scored the events following the marker's position in the history). The probe
in the tree today scores a named turn instead — see "Current probe contract" below — and
that contract has NOT been run LIVE, so nothing in this list is retroactively evidence
for it. Evidence level for the list: **L4 direct-native, ONE Linux workstation, one run**;
the receipt is host-local probe stdout and was NOT archived as a durable artifact, so what
follows is reproducible by instruction, not citable to a stored file:

- protocol v3 ping succeeded;
- foreground session id joined to metadata containing cwd/git root/branch;
- `resumeSession(id)` + idle `enqueue` woke the visible TUI with zero typing;
- the unique body appeared as `user.message` with `delivery:"idle"`;
- model `auto` selected `gpt-5.6-luna` and returned the exact marker;
- `assistant.message`, `assistant.turn_end`, and (in the one-session run)
  ephemeral `session.idle` gave completion/reply evidence;
- a two-session control then targeted A while B received no `user.message`, turn,
  or assistant event, so D3 passed too.

D0–D7 passed; D8 is unproven. One robustness defect surfaced in the two-session
shape: the target visibly replied and persisted `assistant.message` + `turn_end`,
but that joining SDK client did not receive ephemeral `session.idle`, so SDK
`sendAndWait()` timed out after 60 seconds. The probe therefore uses `send()` plus
bounded polling of the official session event-history API (`session.getEvents()` /
`getMessages()`) and reports completion at `turn_end`. Name that surface at its real
size: it is the SDK's own full event history — no narrower, no more privileged — and it
is **not** TUI, file, or database transcript scraping; the probe never reads Copilot's
storage. This is evidence, not a product retry/polling design.

### Current probe contract — designed, not yet run LIVE

Attribution is the load-bearing part, and it runs off the probe's own marker body:

```text
unique marker body  →  exactly one user.message
                    →  its interactionId
                    →  exactly one assistant.turn_start on that interaction
                    →  that turn_start's required turnId
                    →  only assistant.message / assistant.turn_end on that turnId
```

Every link is required and unambiguous; absent or matched twice, the probe FAILS CLOSED.
There is no positional fallback and no "the turn after ours" rule, because scoring "the
newest assistant.message" in a session a human is also typing into is how a probe reports
someone else's turn as its own delivery.

What is deliberately NOT the key: `session.send()` on the bundled CLI 1.0.80 resolves to a
`Promise<string>` that is the SDK's own submission handle. The server-side `user.message`
does not carry that string, and it is a different axis from that event's
`id`/`interactionId` — a join on it cannot hold, so the probe logs it as a diagnostic and
never matches on it.

The D3 control cell uses the same sentence it prints: across `onEvent` and `getEvents`, the
non-target session received no `user.message` and no `assistant.*` event of any kind.

Lifecycle, stated precisely rather than flatteringly: the probe never deletes target
session A and issues no `A.disconnect()` of its own. `client.stop()` DOES tear down every
tracked session — A included — as a wire `session.destroy`; because A's foreground
ownership is re-confirmed immediately before teardown, the TUI keeps A as its foreground
session, so the net effect on A is detach-equivalent, not removal. The probe deletes only
the control session it created itself, and reads `client.stop()`'s returned error list so a
failed teardown cannot exit 0 behind a printed verdict. Reaching past the SDK for a raw
detach wrapper is out of bounds — it would be a second lifecycle authority.

This contract has not been exercised by a LIVE turn. The next LIVE run is what would
demonstrate it, and it also confirms the real event key names.

### Reproduce with the pinned official SDK

The SDK is deliberately not an entwurf production dependency while this is only
a raw probe. Install it in scratch and point the probe at its ESM entry:

```bash
mkdir -p /tmp/copilot-sdk-probe
printf '{"private":true,"type":"module"}\n' >/tmp/copilot-sdk-probe/package.json
pnpm --dir /tmp/copilot-sdk-probe add --ignore-scripts @github/copilot-sdk@1.0.11

# terminal A: visible native session (accept folder trust)
copilot --ui-server --port 43817 --model auto

# terminal B: D0 only, no model call
COPILOT_SDK_MODULE=/tmp/copilot-sdk-probe/node_modules/@github/copilot-sdk/dist/index.js \
  ./copilot-ui-server-probe.mjs

# one paid/subscription turn: addressed idle enqueue through the official SDK
LIVE=1 COPILOT_SDK_MODULE=/tmp/copilot-sdk-probe/node_modules/@github/copilot-sdk/dist/index.js \
  ./copilot-ui-server-probe.mjs

# creates a second no-turn control session and proves only the target receives the marker
LIVE=1 COPILOT_D3_CONTROL=1 \
  COPILOT_SDK_MODULE=/tmp/copilot-sdk-probe/node_modules/@github/copilot-sdk/dist/index.js \
  ./copilot-ui-server-probe.mjs
```

### Admission blockers and negative evidence

- **Transport authentication is not established.** The TUI server bound loopback,
  but an SDK client without a token connected. Setting `COPILOT_CONNECTION_TOKEN`
  on the UI server did not enable auth: the unauthenticated client still connected,
  while a token-bearing client received `AUTHENTICATION_NOT_CONFIGURED`. Do not
  ship this as a rail until the supported same-user/fail-closed boundary is proved.
- Shell command-hook `sessionStart` input is `{timestamp,cwd,source,initialPrompt?}`;
  it does **not** carry `sessionId`. SDK callbacks receive `sessionId` separately in
  their invocation object. The discarded command-hook probe therefore could not
  establish D0, and UUID-only process-log scraping did not satisfy D0's cwd/liveness
  join. Do not revive that path.
- Hooks have no `FileChanged` / `watchPaths` / `asyncRewake`; the Claude mailbox
  mechanism cannot be copied.
- `--acp` is a pi-host child path, not this native TUI citizen path. `--remote` is
  GitHub web/mobile steering, not a local `entwurf_v2` API. Undocumented
  `~/.copilot/run/ws.*` remains out of bounds.

Do not add `backend:"copilot"`, `FRESH_CALL_BACKENDS`, a schema change, or an OPEN
issue from these positive probes. Next evidence is active-turn enqueue/immediate
behavior, TUI-vs-SDK permission ownership, the missing multi-session `session.idle`,
endpoint staleness/crash behavior, and a supported authenticated or equivalent local
boundary.

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
- Copilot TUI+server probe: SDK `ping` + `getForegroundSessionId()` +
  `getSessionMetadata()` identify the currently displayed native session, and
  the official session event-history API (`getEvents()` / `getMessages()`) reads
  a turn back — no transcript file or database is touched. The TCP port is a
  runtime endpoint, never an identity axis; no managed liveness join exists
  until its authentication and stale-endpoint behavior are proved.
