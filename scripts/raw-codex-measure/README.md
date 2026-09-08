# raw-codex-measure — Codex CLI 0.153.4 vendor measurement (issue #95)

Lane: `docs/adding-a-harness.md` step 1 (six measurements) + §3.5 citizen scope + step 5's
tool-name dialect + step 6's join. The oracle is the vendor artifact or the vendor process,
never our assembler.

This file is a MEASUREMENT-ONLY ledger. Nothing here was written by an entwurf installer,
no meta-record was minted, and no operator config was edited. The one entwurf-owned artifact
touched at all is the pre-existing `[mcp_servers.entwurf-bridge]` entry in the operator's own
`~/.codex/config.toml`, which was READ, not written.

Evidence-state vocabulary: **[source]** = read at `file:line` in the vendor checkout;
**[host]** = measured on this host (`oracle`, 2026-09-08 KST) with the receipt named;
**[hypothesis]** = a structure→behaviour inference not yet confirmed by a run.

Source-layer claims here were independently audited on 2026-09-08 (terra, against commit
`87ac7ad`): 20/20 quotations CONFIRMED, 0 corrected. Its three prose defects are folded in and
marked `Corrected 2026-09-08 after independent audit`. `source-audit.md` holds the per-claim
receipts a reviewer opens instead of re-deriving. The **S1b-*** sections were measured after
that audit and have not been through it.

**Section ids.** `M1`–`M8` are the step-1 measurements and `M-B` is the raw delivery probe —
those ids are cited by the first commit and by the independent audit, so they do not move.
The follow-up round is `S1b-A`–`S1b-D`, on its own axis, because the first draft named one of
them `M-B` too and two sections cannot share an id.

## Vendor identity

- Installed: `codex-cli 0.153.4` **[host]** (`codex --version`), launcher
  `/home/junghan/.local/share/pnpm/bin/codex` → `bin/codex.js` → the Rust binary
  `@openai+codex@0.153.4-linux-arm64/.../vendor/aarch64-unknown-linux-musl/bin/codex`
  (observed in every `/proc/<pid>/cmdline` below).
- Source checkout for `[source]` receipts: `~/repos/3rd/codex` at tag `rust-v0.153.4`
  (`3d2ee51`), the exact tag `gh release list -R openai/codex` names for `0.153.4` **[host]**.
  All paths below are relative to `codex-rs/` in that checkout.
- Operator state root: `~/.codex/` — `config.toml` is a symlink into
  `~/repos/gh/agent-config/codex/config.toml`, plus `sessions/YYYY/MM/DD/rollout-*.jsonl`,
  `state_5.sqlite`, `skills`, `plugins`, `shell_snapshots` **[host]**.
- Distance from the archived probe: `0.136.0` → `0.153.4` is **17 minor lines**. The delivery
  probe survived unchanged (M-B below); the hook surface did not (M1).

## M1 — Hook vocabulary and firing time

- **[source]** 12 hook events, not 0.136's 9: `PreToolUse, PermissionRequest, PostToolUse,
  PreCompact, PostCompact, SessionStart, SessionEnd, UserPromptSubmit, SubagentStart,
  SubagentStop, Stop, Interrupt` (`hooks/src/lib.rs:23`). New since the 0.136 note in
  `scripts/raw-async-delivery/README.md`: `PermissionRequest`, `SessionEnd`, `Interrupt`.
- **[source]** `SessionStart` carries a 4-valued `source` matcher: `startup | resume | clear |
  compact` (`hooks/src/events/session_start.rs:25-38`); the matcher input for `SessionStart`
  is that source string (`:69-74`).
- **[source]** **Firing is deferred to the first turn, not to window open.** Session
  construction only QUEUES the source (`core/src/session/session.rs:1623`,
  `queue_pending_session_start_source`); the hook runs from
  `run_pending_session_start_hooks` (`core/src/hook_runtime.rs:124`), whose only production
  call sites are inside turn execution (`core/src/session/turn.rs:264` and `:504`).
- **[host]** Confirmed on a live TUI, and the gap is 49 seconds wide:
  ```
  LAUNCH_AT=2026-09-08T13:49:03.030Z          # tmux window opened, TUI drew, model loaded
  PROMPT_SENT_AT=2026-09-08T13:49:50.758Z     # first user prompt
  === 2026-09-08T13:49:52.380Z label=SessionStart
  === 2026-09-08T13:49:52.433Z label=UserPromptSubmit
  ```
  The TUI sat fully open and idle for ~47s with the hook log EMPTY. **A Codex citizen is born
  when it is first spoken to, not when its window opens** — the same shape as Copilot, and the
  same trap `docs/adding-a-harness.md` §1(c) names ("a lifecycle event's NAME does not tell you
  when it fires").
- **[host]** There is a **hook trust gate** in front of all of this, and it is interactive.
  A first launch with three new hook entries stopped at a full-screen prompt:
  ```
  Hooks need review
  3 hooks are new or changed.
  Hooks can run outside the sandbox after you trust them.
  › 1. Review hooks
    2. Trust all and continue
    3. Continue without trusting (hooks won't run)
  ```
  Choosing (2) wrote per-handler trust state back into the same `config.toml`:
  ```
  [hooks.state."<CODEX_HOME>/config.toml:session_start:0:0"]
  trusted_hash = "sha256:679495a037c2aaa8bbbe9b304c5cdeb256a3b56a30575867ca8b60bb766257d1"
  ```
  Until an operator answers that prompt, **a USER-level birth hook does not run**. This has no
  analogue on any shipped backend.
  `[source]` the trust decision itself: `hook_trust_status` returns `Managed` for a managed
  handler and only consults `trusted_hash` for a non-managed one
  (`hooks/src/engine/discovery.rs:794-819`); `hook_enabled` is
  `is_builtin || is_managed || …` (`:813-815`); managed requirement handlers enter with
  `is_managed: true` (`:208-240`), and the enabled/trust state is resolved per handler at
  `:676-733`. The CLI bypass and its warning are at `core/src/config/mod.rs:3253-3260`.
  **Corrected 2026-09-08 after independent audit (terra): the earlier draft cited
  `discovery.rs:84-114` / `:339-343`, which are the policy struct and the `hooks.json` path —
  they do not carry the claim.**

  **[host] The escape is not a hypothesis any more — it was run, and it works.** See
  **S1b-A** below. A hook declared in the managed `/etc/codex/config.toml` layer runs with **no
  trust prompt at all**, in both the embedded and the app-server-attached mode. The price is
  named there and it is the real constraint: that path is `/etc`, i.e. **root**, not something
  an operator-level `entwurf setup` can write.
- **[source]** There is **no filesystem-wake vocabulary**: `watchPaths`, `FileChanged` and
  `asyncRewake` appear nowhere in the Rust workspace except in a Claude-hooks IMPORTER, which
  SKIPS any hook carrying them (`external-agent-migration/src/hooks_cla.rs:158-161`). Codex
  does not have Claude's doorbell and does not pretend to.
- **[source]** `Stop` output is `{decision?: "block", reason?}` (`hooks/src/schema.rs:455-464`).
  That is a turn-boundary continuation, exactly like Copilot's `agentStop`, and — per
  `docs/adding-a-harness.md` step 7(c) — **must not be used as an idle-wake substitute**.

## M2 — Launch form and stdin envelope

- **[source]** Hooks are declared in TOML under a `[hooks]` table keyed by the event's
  PascalCase name, each entry a matcher group holding handlers
  (`config/src/hook_config.rs:36-61`, `:153-159`). A `hooks.json` beside the config folder is
  the second accepted source (`hooks/src/engine/discovery.rs:339-343`); both converge on one
  trust identity (`:767`).
- **[source]** Handler kinds are a tagged enum: `command`, **`mcp_tool`**, `prompt`, `agent`
  (`config/src/hook_config.rs:161-200`). The `mcp_tool` kind takes `{server, tool, input,
  timeout, statusMessage}` — a hook can call an MCP tool DIRECTLY, with no spawned process.
- **[host]** The declaration that actually loaded:
  ```toml
  [hooks]
  [[hooks.SessionStart]]
  [[hooks.SessionStart.hooks]]
  type = "command"
  command = "<scratch>/hook-probe.sh SessionStart"
  timeout = 30
  ```
- **[source]** `command` is a SHELL STRING, never an exec-form argv — and that, not the
  particular shell, is the load-bearing fact. `HookHandlerConfig::Command` carries one
  `command: String` (`config/src/hook_config.rs:161-184`) and no argv variant exists in the
  enum. How it is run depends on the configured shell: `build_command`
  (`hooks/src/engine/command_runner.rs:396-418`) uses `shell.program` + `shell.args` when a
  program is configured, and only falls back to `default_shell_command` — `$SHELL`, fallback
  `/bin/sh`, argument `-lc` (`:428-453`) — when `shell.program.is_empty()`. The turn's shell
  can supply that program (`core/src/session/mod.rs:4666-4674`). **Corrected 2026-09-08 after
  independent audit (terra): the earlier draft claimed `$SHELL -lc` unconditionally. It is the
  DEFAULT path, not the only one.** The conclusion is unchanged and does not depend on the
  correction: **codex offers no exec-form hook launcher at all**, so entwurf's Hard Rule 14
  ("no shell-form fallback", derived from Claude's exec manifest) has no counterpart to bind
  to here; a codex unit's provenance story has to be built on something else.
- **[host]** SessionStart stdin envelope, verbatim (secrets redacted nowhere — there are none
  in it):
  ```json
  {"session_id":"01a08147-fbad-78d2-b266-e058f322125e",
   "transcript_path":"<CODEX_HOME>/sessions/2026/09/08/rollout-2026-09-08T22-49-33-01a08147-fbad-78d2-b266-e058f322125e.jsonl",
   "cwd":"/home/junghan/repos/gh/entwurf",
   "hook_event_name":"SessionStart",
   "model":"gpt-6-astra",
   "permission_mode":"default",
   "source":"startup"}
  ```
  **The thread id IS on the wire** (`session_id`), and so is an absolute transcript path — the
  two fields a birth payload needs, with nothing to guess. `[source]` the wire struct is
  `hooks/src/schema.rs:499-524`.
- **[host]** `UserPromptSubmit` adds `turn_id` and the raw `prompt`; `SubagentStart` adds
  `agent_id` + `agent_type` (see M8).

## M3 — Config writer

- **[host]** `codex mcp add <NAME> -- <COMMAND...>` writes `$CODEX_HOME/config.toml`:
  ```
  $ CODEX_HOME=<scratch> codex mcp add entwurf-bridge -- <scratch>/mcp-probe.sh
  Added global MCP server 'entwurf-bridge'.
  $ cat <scratch>/config.toml
  [mcp_servers.entwurf-bridge]
  command = "<scratch>/mcp-probe.sh"
  ```
- **[host]** The writer is **table-preserving**: an existing `[hooks]` table with three matcher
  groups survived the add byte-intact, and the new table was appended. So the file is a single
  shared TOML surface — hooks, MCP servers, trust state and project trust all live in it. An
  entwurf writer here owns keys inside a file the operator also hand-edits, and cannot use the
  "own a whole file" shape Copilot's `mcp-config.json` allowed.
- **[host]** One refusal worth knowing before writing a gate: with `CODEX_HOME` under `/tmp`,
  codex prints `WARNING: proceeding, even though we could not create PATH aliases: Refusing to
  create helper binaries under temporary dir "/tmp"`. All measurement below therefore used a
  scratch `CODEX_HOME` under `$HOME/.cache/`, deleted afterwards.
- **[host]** Other writer surfaces: `-c key=value` CLI overrides, and `--enable/--disable
  <FEATURE>` as sugar for `-c features.<name>=true|false` (`codex mcp --help`). **`-c` is not
  free** — see M-B gotcha 2.

## M4 — Statusline / visible identity, and the receive surface

**Statusline.** `[source]` Codex's status line is a CLOSED ENUM of items
(`tui/src/bottom_pane/status_line_setup.rs:56-155`), configured by the `/statusline` slash
command (`tui/src/slash_command.rs:59`, `:118`); default is
`["model-with-reasoning","current-dir"]` (`tui/src/chatwidget.rs:502`). **There is no
`statusLine.command` and no custom-text segment** — Copilot's "is the command executable"
predicate does not exist here, exactly as it did not for omp.

Two enum members are candidate carriers, and both are weak:

- `thread-id` (alias `session-id`) renders the full thread UUID — the CODEX id, not a garden id.
- `thread-title` renders `thread_name`, falling back to the thread id when unset
  (`tui/src/chatwidget/status_surfaces.rs:776-784`). `[source]` the name is settable over the
  app-server as `thread/name/set` (`app-server-protocol/src/protocol/common.rs:566`).
  **[host]** but the vendor AUTO-TITLES: after the first turn the TUI printed
  `Session renamed to List every tool you have whose name`. A garden id parked in the thread
  name is therefore contested by the vendor's own titler. **[hypothesis]** it would be
  overwritten on the next auto-title; not yet measured.

*(The paragraph above is the pre-Step-1b reading and its `[hypothesis]` was **wrong**. The
auto-titler does NOT overwrite an explicitly set name: it is guarded on the thread having no
name at all, and an explicit set wins in both orderings — measured in **S1b-B**. Clause 4 is
CLOSED for codex, with the two costs named there. The paragraph is kept because the hypothesis
it carried is what S1b-B was run to settle.)*

**Receive.** `[source]` the app-server JSON-RPC surface still carries `turn/start`,
`turn/steer`, `thread/inject_items`, `thread/status/changed` — and now also a queue family
(`thread/queue/add|start|list|…`) that did not exist at 0.136. No hook or extension wake
surface was added (see M1). The measured route is unchanged and green: **M-B** below.

## M5 — Parent process topology (the step-6 join)

The join `docs/adding-a-harness.md` step 6 requires is `hook.ppid == mcp.ppid == the harness
host pid`. **It holds on Codex — but WHICH process is the host depends on the launch mode, and
that difference is the finding.**

**Embedded mode** (a standalone `codex` TUI with its own `CODEX_HOME`, no app-server):

```
# hook
self_pid=4583 ppid=3570
  pid=3570 comm=(codex) cmdline=.../vendor/aarch64-unknown-linux-musl/bin/codex
# MCP child (the same run)
pid=4167 ppid=3570 cmd=node ... mcp/entwurf-bridge/src/index.ts
```
`hook.ppid == mcp.ppid == 3570 == the TUI process.` The join key exists and is per-window.

**App-server-attached mode** (a plain `codex` auto-attached to `codex app-server --listen` —
i.e. the ONLY mode in which the measured delivery rail works):

```
# hook, on a thread woken through turn/start
self_pid=11749 ppid=10664
  pid=10664 comm=(codex) cmdline=.../bin/codex app-server --listen unix://<CODEX_HOME>/app-server-control/app-server-control.sock
  pid=10649 node .../bin/codex.js app-server --listen ...
# the visible TUI for that same thread was pid 10833 — NOT in this chain
```
and, on the operator's real home with its pre-existing `entwurf-bridge` entry:
```
pid=1733 (entwurf-bridge) ppid=1393   # 1393 = codex app-server --listen
pid=1616                              # = the plain codex TUI. Not the parent.
```

So in the delivery-capable mode the join still holds — `hook.ppid == mcp.ppid` — but both
resolve to the app-server.

**That the app-server is SHARED across citizens was an inference in the first draft, and it
was published without a label.** `[source]` supports it
(`app-server/src/request_processors/initialize_processor.rs:63-68` is a multi-client
shared-thread surface), but the run above shows the parent of ONE attached TUI; reading N from
one is not a measurement. Independent audit (terra, 2026-09-08) caught the missing label.
**It has since been measured directly — see S1b-C below — and the answer is the one the
inference guessed:** two live threads on one app-server, two separate visible TUIs, and every
hook and every MCP child of BOTH threads reports the same `ppid`.

**[host]** So this is now a measured fact rather than a structural read: **a sender marker
keyed by parent pid would be one marker for N citizens**, which is precisely the uniqueness the
V3 store contract (Hard Rule 7, `nativeSessionId` ownership) forbids. **This is the
load-bearing result of the whole step**, and it is a design input for step 6, not a defect to
fix here.

**[host]** A second consequence, measured on the same two runs: the hook's environment is the
HOST process's snapshot, so it changes with the mode.
- Embedded: the TUI was launched with a synthetic `PI_SESSION_ID=SYNTH-PI-GID`, and the hook
  saw `env_pi=PI_AGENT_ID=SYNTH-PI-AGENT ... PI_SESSION_ID=SYNTH-PI-GID`.
- App-server-attached: the same TUI env was set, and the hook saw **no `PI_SESSION_ID` at
  all** — only the app-server's own environment.

Two things follow. (a) The foreign-identity-carrier hazard of step 6 is REAL on codex in
embedded mode: a codex opened from a pi citizen's shell hands `PI_SESSION_ID`/`PI_AGENT_ID`
straight to its hook, and the MCP bridge reads that pair before trying a native marker.
`[source]` codex does not strip them — `NON_INHERITABLE_ENV_VARS` is five OpenAI/Node token
names (`protocol/src/shell_environment.rs:14-21`), and the default shell-env policy is
`inherit: All` with `ignore_default_excludes: true`
(`protocol/src/config_types.rs:213-214`, `:264-265`). (b) In app-server mode **no launch-time
env of the visible window reaches the hook at all**, so any design that plants a provenance
token in the launcher's environment is dead there before it starts.

## M6 — Environment vocabulary

- **[source]** Codex's own names: `CODEX_HOME`, `CODEX_THREAD_ID`, `CODEX_SESSION_ID`,
  `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`, `CODEX_SANDBOX*`, `CODEX_PERMISSION_PROFILE`,
  `CODEX_EXEC_SERVER_*`, `CODEX_APPS_*`, `CODEX_SQLITE_HOME`, … (241 `CODEX_HOME` references
  alone; `protocol/src/shell_environment.rs:6-11` for the identity three).
- **[source]** **No collision with any name entwurf owns.** `grep -rn '"PI_SESSION_ID"|
  "PI_AGENT_ID"|PI_CODING_AGENT_DIR|ENTWURF' --include=*.rs` over the whole workspace returns
  ZERO hits. Codex is not a pi fork, so the #87 B1 fork-collision failure mode does not apply.
- **[host]** What a hook actually sees: `CODEX_HOME`, `CODEX_MANAGED_BY_PNPM=1`,
  `CODEX_MANAGED_PACKAGE_ROOT=<pnpm global>/@openai/codex`. Note that **`CODEX_THREAD_ID` is
  NOT in the hook environment** — `[source]` it is inserted only by `create_env`/`populate_env`
  for shell-tool commands (`protocol/src/shell_environment.rs:150-152`). The hook learns the
  thread from stdin (M2), not from env.

## M7 — MCP tool-name dialect (a fourth spelling)

- **[source]** The model-facing name is `mcp__` + sanitized server name + `__` + sanitized tool
  name. Prefix constant `LEGACY_MCP_TOOL_NAME_PREFIX = "mcp__"` and delimiter
  `MCP_TOOL_NAME_DELIMITER = "__"` (`core/src/tools/handlers/mcp.rs:46-47`,
  `codex-mcp/src/tools.rs:22`, `:225`); the namespace IS the server name
  (`codex-mcp/src/rmcp_client.rs:821`); prefixing is on unless the `NonPrefixedMcpToolNames`
  feature is enabled (`core/src/config/mod.rs:1793-1796`).
- **[source]** The sanitizer maps every char outside `[A-Za-z0-9_]` to `_` and preserves case
  and DIGITS (`codex-mcp/src/mcp/mod.rs:544-559`). So `entwurf-bridge` → `entwurf_bridge`,
  while `entwurf_v2` survives intact — unlike omp, whose `[a-z_]` charset eats the `2`.
- **[host]** LIVE oracle, one turn in a real TUI with the bridge registered. Asked for the
  verbatim names, the model printed:
  ```
  mcp__entwurf_bridge__entwurf_fresh_call
  mcp__entwurf_bridge__entwurf_inbox_read
  mcp__entwurf_bridge__entwurf_peers
  mcp__entwurf_bridge__entwurf_register_native
  mcp__entwurf_bridge__entwurf_resume_call
  mcp__entwurf_bridge__entwurf_self
  mcp__entwurf_bridge__entwurf_v2
  ```
  **The callback spelling for codex is `mcp__entwurf_bridge__entwurf_v2`** — hyphen to
  underscore, digit kept. Four harnesses, four spellings; source and live agree exactly.
- **[host]** Invocation form is the ordinary function-call surface — the model listed and could
  call these as tools, with no `xd://`-style virtual-device layer to disarm. No non-default
  setting was needed for the tools to be visible.

## M8 — §3.5 citizen scope

**Answered, and the predicate is free.** `[source]` a spawned agent does not raise
`SessionStart` at all — it raises a DIFFERENT event, `SubagentStart`, chosen by
`StartHookTarget` on `SessionSource::SubAgent(SubAgentSource::ThreadSpawn{..})`
(`core/src/hook_runtime.rs:129-147`, `hooks/src/events/session_start.rs:52-74`); every other
subagent source returns before dispatch (`core/src/hook_runtime.rs:146`).

**[host]** One live session, one `spawn_agent` call, both hooks armed:
```
=== 2026-09-08T13:49:52.380Z label=SessionStart      # 1 (one) for the whole session
=== 2026-09-08T13:49:52.433Z label=UserPromptSubmit
=== 2026-09-08T13:51:14.531Z label=UserPromptSubmit
=== 2026-09-08T13:51:20.275Z label=SubagentStart
$ grep -c "label=SessionStart" measure.log
1
```
and the `SubagentStart` envelope keeps the PARENT's thread id while naming the child
separately:
```json
{"session_id":"01a08147-fbad-78d2-b266-e058f322125e",   // parent
 "agent_id":"01a08149-959a-7113-9d35-1845ab19a17f",     // child
 "agent_type":"default", "hook_event_name":"SubagentStart", ...}
```
So the top-level predicate is **"the event name is `SessionStart`"** — vendor-authoritative,
requiring no `mode === "tui"`-style heuristic and no cwd/pid inference. This is the cheapest
§3.5 answer of any harness measured so far.

## M-B — raw delivery probe, re-run at 0.153.4

The 0.136.0 result reproduces **unchanged**. `scripts/raw-async-delivery/codex-local-appserver.sh`
and `raw-codex-ws-turn-start.py` were run as shipped; neither script needed an edit.

```
$ codex app-server --listen unix://$HOME/.codex/app-server-control/app-server-control.sock &
$ codex                                  # plain launch, no -c: auto-attached
2026-09-08T13:47:54.633Z
$ ./raw-codex-ws-turn-start.py "$HOME/.codex/app-server-control/app-server-control.sock" \
      01a08145-ce6d-77d0-b7a4-cfb57c608282 \
      "raw-probe 0.153.4: reply with exactly the token CODEX-RAW-0153-OK and nothing else"
{"ok": true, "threadId": "01a08145-ce6d-77d0-b7a4-cfb57c608282",
 "turnId": "01a08146-7c06-7b83-9e65-32e3814ee490",
 "status_seen": ["active", "active", "idle"]}
EXIT=0
2026-09-08T13:47:58.595Z
```
and the visible TUI, with zero typing into it:
```
› raw-probe 0.153.4: reply with exactly the token CODEX-RAW-0153-OK
  and nothing else

• CODEX-RAW-0153-OK
```
Full message injection (not a doorbell), model reply in the same native session, `active` →
`idle` completion observation on the same socket. D6 with D7 observation, reproduced.

Reproduced a second time on a scratch `CODEX_HOME` with its own app-server, twice
(`TOPO-OK`, `TOPO2-OK`), which is where the M5 app-server topology was taken.

**One script improvement is owed, and it is not a protocol change.** The shipped README tells
you to read the threadId from the newest `rollout-*.jsonl`. At 0.153.4 the rollout is
MATERIALIZED LAZILY — for the first ~40 seconds after launch the newest rollout on this host
was a file from 2026-08-06, and the live thread had no file at all. The app-server answers the
question directly:
```
$ <ws-client> thread/loaded/list {}
{"id":2,"result":{"data":["01a08145-ce6d-77d0-b7a4-cfb57c608282"],"nextCursor":null}}
```
`thread/loaded/list` is the correct threadId source; rollout scraping is a fallback that races
the first turn. Recorded here rather than changed in the shipped script, because that script is
the archived 0.136 probe and B was asked to re-run it as shipped.

### Gotchas — the 0.136 four, re-checked

1. **Socket dir 0700, owner-owned** — unchanged; `~/.codex/app-server-control/` is created 0700
   by codex itself **[host]**.
2. **`-c` overrides disable auto-attach** — not re-measured at 0.153.4. **[hypothesis]** still
   true; the plain launch used here carried no `-c` precisely because of it.
3. **Per-folder trust is orthogonal to addressability** — **[host]** a first launch in an
   untrusted cwd shows `Do you trust the contents of this directory?` and, separately, the hook
   trust prompt of M1. Neither blocked `turn/start` addressability.
4. **WS transport, no auth on the UDS** — **[host]** unchanged: the shipped python client's
   handshake returned `HTTP/1.1 101 Switching Protocols` with no token.

## S1b-A — the hook-trust escape, RUN (2026-09-08)

M1 left "is there a non-interactive path?" open. It is now closed, in the affirmative, with a
constraint that matters more than the answer.

**Method note first, because it is the part that must not be copied carelessly.** `/etc` was
never written. Each run used a user namespace carrying an overlayfs whose `lowerdir` is the
real `/etc` and whose `upperdir` supplied only `codex/config.toml`:

```
unshare --map-root-user --mount bash -c \
  'mount -t overlay overlay -o lowerdir=/etc,upperdir=<scratch>/etc-upper,workdir=<scratch>/etc-work /etc \
   && exec env CODEX_HOME=<scratch>/home codex'
```
Before and after every run, `ls /etc/codex` on the host is `No such file or directory`.

**A1 — a managed hook runs with NO trust prompt.** `[host]` The hook was declared in the
overlay's `/etc/codex/config.toml`, which is the `System` config layer and therefore
`is_managed: true` (`hooks/src/engine/discovery.rs:826`). The TUI showed the ordinary
directory-trust question and **never showed the "Hooks need review" screen**. After one turn:

```
=== 2026-09-08T14:17:32.016Z MANAGED-HOOK-FIRED label=SessionStart-MANAGED pid=42169 ppid=41459
```

**A2 — `--dangerously-bypass-hook-trust` also works, and it costs the delivery rail.** `[host]`
A USER-level hook, no trust prompt, a banner instead:

```
⚠ `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
=== 2026-09-08T14:18:46.837Z USER-HOOK-FIRED label=SessionStart-USER pid=43308 ppid=42714
```
But an app-server was listening on that `CODEX_HOME`'s default control socket for the whole
run, and both before and after the turn:
```
thread/loaded/list -> {"id": 2, "result": {"data": [], "nextCursor": null}}
```
**The flag is a loader override, so auto-attach never happens and the session is unaddressable.**
This is the archived 0.136 gotcha 2 measured at 0.153.4 on the flag that matters: for entwurf,
`--dangerously-bypass-hook-trust` and the delivery rail are mutually exclusive.

**A3 — the managed path does NOT have that problem.** `[host]` Same overlay, plus an app-server
on the scratch `CODEX_HOME`'s default control socket. A plain `codex` (no flags) attached, and
a raw `turn/start` woke it:
```
thread/loaded/list -> {"data": ["01a08163-5040-7830-bf24-dcba2e3b47c4"]}
{"ok": true, "threadId": "01a08163-5040-…", "turnId": "01a08163-a403-7752-9a96-31484a5bfca5",
 "status_seen": ["active","active","idle"]}
  • A3-OK          # visible TUI, zero typing
=== 2026-09-08T14:19:46.479Z MANAGED-HOOK-FIRED label=SessionStart-MANAGED pid=44298 ppid=43784
```
Managed hook + auto-attach + raw wake, all three at once.

**What this closes and what it does not.** It closes "can a codex birth hook run without an
operator answering a prompt" — yes, through the managed layer, with the delivery rail intact.
It does NOT make that an installer capability: `/etc/codex/` is **root-owned**, so
`entwurf setup` running as the operator cannot write it, and Hard Rule 17 ("setup composes what
the operator already chose") points the same way. The honest shape is a **root-level operator
step**, comparable in kind to a system service install — not a per-user unit. Nothing here was
tested with `/etc/codex` genuinely present on a host; the overlay proves codex's behaviour, not
an installer's.

## S1b-B — clause 4's carrier, RUN (2026-09-08)

M4 left `thread-title` as a candidate the vendor might auto-title over. **It survives, in both
orderings, and the source says why.**

`[source]` The automatic titler is guarded on the thread having no name at all:
`tui/src/app/thread_routing.rs:1841` — `if self.chat_widget.thread_name().is_none() && …`. A
named thread never enters the branch that generates a title. The explicit setter
(`thread/name/set` → `thread_set_name`, `app-server/src/request_processors/thread_processor.rs:639-658`)
carries no such guard.

`[host]` With `[tui] status_line = ["thread-title", "model", "current-dir"]`:

```
# unset -> falls back to the thread UUID, as source predicts
  01a0815b-d30d-7b63-a257-9011682f0e3a · gpt-6-astra · ~/repos/gh/ent…

# thread/name/set {"threadId":"01a0815b-…","name":"entwurf 20260908T224329-2680e2"} -> {"result":{}}
  entwurf 20260908T224329-2680e2 · gpt-6-astra · ~/repos/gh/entwurf ·…

# first turn  (TITLE-PROBE-OK)  -> name UNCHANGED
# second turn (TITLE-PROBE-2)   -> name UNCHANGED
  entwurf 20260908T224329-2680e2 · gpt-6-astra · ~/repos/gh/entwurf ·…
```

And the ordering race, which is the question a birth-at-first-turn hook actually raises — the
auto-titler wins first, then entwurf sets the name:

```
# fresh thread, no name, one turn (RACE-1): the vendor claims the slot
  Reply with RACE-1 · gpt-6-astra · ~/repos/gh/entwurf · ← for agents
# thread/name/set {"name":"entwurf 20260908T999999-race02"} -> {"result":{}}
  entwurf 20260908T999999-race02 · gpt-6-astra · ~/repos/gh/entwurf ·…
# one more turn (RACE-2) -> still ours
  entwurf 20260908T999999-race02 · gpt-6-astra · ~/repos/gh/entwurf ·…
```

**So clause 4 has a working carrier and the ordering does not matter** — a birth payload may set
the name after the first turn and still win. Two costs to carry into step 4/10, neither
hypothetical: the carrier is reached over the **app-server**, not from the hook process, so it
is only available in the auto-attach mode; and `[tui] status_line` is an operator config key,
so it needs a writer that owns exactly that key (the `scripts/omp-config-xdev.py` shape).

Not established: whether any OTHER persistent operator-visible surface exists. `thread-title`
is the only enum member that can hold arbitrary text (`status_line_setup.rs:56-155`), and no
non-statusline persistent surface was found — but absence of a find is not a proof of absence.

## S1b-C — two citizens, one app-server (2026-09-08)

The M5 sharing claim, measured instead of inferred. Two plain `codex` TUIs auto-attached to one
`codex app-server --listen`, each with its own thread and its own visible window, each woken by
its own `turn/start`. `[host]`:

```
app-server pid = 39226
visible TUI pids = 39410, 39956          # two separate windows

=== label=MCP-child      self_pid=39797 ppid=39226
=== label=MCP-child      self_pid=40074 ppid=39226
=== label=SessionStart   self_pid=40507 ppid=39226   session_id=01a0815f-c28e-7080-894c-05200f91ef6b
=== label=UserPromptSubmit self_pid=40530 ppid=39226 session_id=01a0815f-c28e-7080-894c-05200f91ef6b
=== label=SessionStart   self_pid=40632 ppid=39226   session_id=01a0815f-e2d1-7f30-930f-da4c1728906d
=== label=UserPromptSubmit self_pid=40655 ppid=39226 session_id=01a0815f-e2d1-7f30-930f-da4c1728906d
```

Two DIFFERENT `session_id`s, two different windows, **one `ppid` for every hook and every MCP
child of both**, and neither TUI pid appears anywhere in the chain. The parent-pid join key
cannot distinguish these two citizens. `[host]`, not `[source]`, and not an inference from one.

(Timing incidentally re-confirms M1: the MCP children start at attach — 14:15:31 / 14:15:40 —
while `SessionStart` waits for the first turn — 14:16:01 / 14:16:05.)

## S1b-D — the join key, found on the wire (2026-09-08)

S1b-C proved the parent-pid join cannot separate two codex citizens. It did not prove there is
no key at all — and there is one. Three reads, no new unit, no marker written.

**D1 — nothing in the MCP child's process image distinguishes the thread. `[host]`** Two live
threads on one app-server, each with its OWN bridge child (`51517` and `51767` — separate pids,
so the children are not shared):

```
cmdline:  node --experimental-strip-types … mcp/entwurf-bridge/src/index.ts     # both, identical
cwd:      /home/junghan/repos/gh/entwurf                                        # both, identical
environ:  diff -> no output                                                     # BYTE-IDENTICAL
env var names (10, values withheld):
  HOME LANG LC_ALL LOGNAME PATH PWD SHELL SHLVL TERM USER
```
**[host]** What is measured: there is **no `CODEX_THREAD_ID`, no `CODEX_SESSION_ID`, no `CODEX_*`
at all** in an MCP child, and no `PI_*` either — even though this host's hook processes DID see a
planted `PI_SESSION_ID` (M5). The child env is 10 names wide against a hook env that carried the
launching shell's whole environment. So on the evidence, **the foreign-identity-carrier hazard
of M5 does not reach the bridge on codex.**

**[hypothesis]** that this is `inherit: Core` rather than `All`. It is only *consistent* with
`UNIX_CORE_ENV_VARS` (`protocol/src/shell_environment.rs:162-165`) and does not match it: the
child has `PWD`, `SHLVL` and `TERM`, which that list does not contain (a `bash` wrapper sat in
this probe's chain and could add all three), and it lacks `TMPDIR`/`TEMP`/`TMP`/`LC_CTYPE`, which
may simply be unset in the parent. **Nobody read the MCP child's env-composition site in source.**
The negative above stands on the observed absence; the mechanism behind it does not.

**D2 — the identity rides the CALL. `[host]`** One real `tools/call`, captured on the child's
own stdin:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"_meta":{
  "callId":"exec-1ef58158-c495-4225-85cc-e7e15075ff78",
  "x-codex-turn-metadata":{
    "session_id":"01a0816b-976f-7061-96e4-0d7f9ae53838",
    "thread_id":"01a0816b-976f-7061-96e4-0d7f9ae53838",
    "turn_id":"01a0816c-f799-7431-a41a-a95e94a9b7f9",
    "turn_started_at_unix_ms":1788877797276,
    "workspaces":{"/home/junghan/repos/gh/entwurf":{…,"latest_git_commit_hash":"e2711ae…"}},
    "thread_source":"user","sandbox":"seccomp","sandbox_mode":"workspace-write",
    "model":"gpt-6-astra","reasoning_effort":"low", …},
  "threadId":"01a0816b-976f-7061-96e4-0d7f9ae53838",
  "itemId":"ctc_0f30971853352535016aa01bea708487d0ad36b74408dc1e98",
  "progressToken":1},
  "name":"entwurf_peers","arguments":{}}}
```
`[source]` Every key above is a member of `_meta` (none is a top-level `params` member), and
three of the four are traced:
- `callId` and `x-codex-turn-metadata` — `core/src/mcp_tool_call.rs:1238-1263`
  (`build_mcp_tool_call_request_meta`), the metadata object itself built by
  `core/src/turn_metadata.rs:230-…` (`current_meta_value_for_mcp_request`).
- `threadId` and `itemId` — `core/src/mcp_tool_call.rs:1328-1349`
  (`with_mcp_tool_call_ids_meta` inserts `MCP_TOOL_THREAD_ID_META_KEY` unconditionally and
  `MCP_TOOL_ITEM_ID_META_KEY` only when an originating item exists; the two key constants are
  the literals `"threadId"` / `"itemId"` at `:1183-1184`), called for the MCP tool call at
  `:506-516`. **Corrected 2026-09-08 after independent audit (terra).** The first draft said
  these were capture-only; that was wrong, and the reason it was wrong is worth keeping: the
  keys are inserted through CONSTANTS, so a grep for the string `"threadId"` in the call path
  finds nothing. A literal search is not a source search.

**Honest limit, now one key instead of three:** `progressToken` has no located insertion site.
The vendor tree carries the constant `MCP_PROGRESS_TOKEN_META_KEY`
(`rmcp-client/src/elicitation_client_service.rs:32`) and downstream readers, but nothing that
puts it on an outgoing `tools/call`. That key rests on the wire capture alone.

The vendor also tests it: `core/src/mcp_tool_call_tests.rs:1753-1791`
(`mcp_tool_call_ids_are_added_to_request_meta`) calls `with_mcp_tool_call_ids_meta` directly and
pins three cases — a stale `threadId`/`itemId` is OVERWRITTEN with the live pair, a `None` prior
meta becomes `{"threadId": …}` with no `itemId`, and a non-object meta passes through unchanged.

*(Finding that test took two passes, and the miss is the reusable part. `:1753-1791` was first
looked for inside `mcp_tool_call.rs`, where that line is unrelated `_meta` UI-resource
extraction — so the search concluded the test did not exist. It does, one file over. The cause is
ordinary and therefore general: **a line range cited without its file path is ambiguous across
any multi-file source**, and the two files here happen to both have content at 1753
(`mcp_tool_call.rs:1753` is `meta.and_then(|meta| {`; `mcp_tool_call_tests.rs:1753` is
`fn mcp_tool_call_ids_are_added_to_request_meta() {`). It is NOT that they share a line-number
space — the `#[cfg(test)] #[path = "mcp_tool_call_tests.rs"] mod tests;` at
`core/src/mcp_tool_call.rs:2392-2394` includes the sibling as a module and nothing more. Read
here, 2026-09-08, after that mechanism was itself asserted wrongly once. Sibling of the constants
trap two paragraphs up: counting occurrences in the file you happen to have open is not counting
them in the crate.)*

By contrast `initialize` carries no identity at all and is byte-identical between the two
children — `clientInfo` is the fixed literal `Implementation::new("codex-mcp-client",
CARGO_PKG_VERSION).with_title("Codex")` (`codex-mcp/src/rmcp_client.rs:1035-1039`):
```json
{"method":"initialize","params":{"protocolVersion":"2025-06-18",
 "capabilities":{"elicitation":{"form":{},"url":{}}},
 "clientInfo":{"name":"codex-mcp-client","title":"Codex","version":"0.153.4"}}}
```
So a codex bridge child cannot know who it serves at startup, and does not need to: **it learns
per call, which is exactly when it needs to know.**

**D3 — the hook's `session_id` and the app-server's `threadId` are the same string. `[host]`**
Two threads, hook stdin beside `thread/loaded/list`:

```
HOOK 14:29:57.725 label=SessionStart session_id=01a0816b-976f-7061-96e4-0d7f9ae53838
HOOK 14:30:02.910 label=SessionStart session_id=01a0816b-bb92-7c81-abde-90820345d58e
thread/loaded/list -> ["01a0816b-976f-7061-96e4-0d7f9ae53838",
                       "01a0816b-bb92-7c81-abde-90820345d58e"]
```
Byte-identical, both of them. So **birth, delivery and the tool-call `_meta` all name the same
identifier**, and `record.nativeSessionId = threadId` needs no mapping layer. The pre-existing
`nativeIdLabel: "threadId"` in `pi/entwurf-capabilities.json` is, on this axis, correct — which
is worth saying precisely, because its `deliveryLevel: "D6"` on the same row still is not.

**What this changes.** The step-6 question "who sent this?" does not need a parent-pid marker on
codex, and the answer S1b-C ruled out was the wrong shape rather than a dead end: the caller is
named on every call. `[source]` today's bridge reads a `PI_SESSION_ID`/`PI_AGENT_ID` pair or a
native marker looked up by parent pid, and neither exists here — so consuming `_meta` would be
new bridge code. **That is step 6, and nothing here implements it.**

One vendor fact this run also surfaced, recorded because it belongs to step 9 clause 2: the
first `tools/call` raised an interactive approval prompt —
`Allow the entwurf-bridge MCP server to run tool "entwurf_peers"?` — under the default approval
mode, and the permission surface spells the tool `entwurf-bridge.entwurf_peers`, a THIRD dialect
beside the model-facing `mcp__entwurf_bridge__entwurf_peers`. Copilot's "one tool, two dialects"
lesson repeats here. `entwurf_peers` itself answered from that session, which is the plain
external-MCP-host row of `docs/external-mcp-host.md` behaving as designed.

## What this measurement does NOT establish

- The source layer WAS independently audited on 2026-09-08 (terra, on commit `87ac7ad`):
  **20/20 quotations CONFIRMED, 0 corrected, 0 unverifiable**, tag identity re-derived
  independently (`rust-v0.153.4^{}` = `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`). Three prose
  defects it raised are folded in above and marked as corrections; none was a wrong vendor
  fact. The S1b-* sections were added AFTER that audit and carry no second reader yet.
- Evidence level L4 at best: one Linux host (`oracle`, aarch64, NixOS), one CLI version, one
  run per claim except M-B (three runs).
- **No entwurf unit was built or installed.** No record, no hook, no marker, no doctor.
  Steps 3–10 are untouched by design; this ledger is step 1 only.
- **Step 2 is a pre-existing surprise, not this lane's work, and it is wrong.** `codex` is
  ALREADY in `META_BACKENDS` (`pi-extensions/lib/meta-session.ts:84`) and
  `META_CITIZEN_BACKENDS` (`:308`), and `pi/entwurf-capabilities.json` grades it
  `wakeMode: "direct-inject"`, `deliveryLevel: "D6"`, `nativeIdLabel: "threadId"` — a grade
  with no channel behind it, the exact failure `docs/adding-a-harness.md` step 8(c) names.
  It is also the declared pre-#82 legacy exception `check-harness-admission-parity` reads out
  of `DELIVERY.md`. Nothing here changes it; a reader should not take that D6 as evidence.
- *(Two entries lived here until 2026-09-08 and are now **closed by measurement**, not moved:
  "clause 4 has no working candidate" was retired by **S1b-B**, and "the hook trust gate has no
  measured non-interactive path" by **S1b-A**. What each one costs is stated in its section.)*
- Of the MCP tool-call `_meta` observed in **S1b-D**, `callId`, `x-codex-turn-metadata`,
  `threadId` and `itemId` are traced to vendor insertion sites there. **`progressToken` alone**
  has no located construction site and rests on the wire capture.
- Whether `/new`, resume or fork returns `thread_name` to `None` — and therefore whether a birth
  payload must re-arm the visible id — is **not measured**. Observation, not a claim (terra,
  2026-09-08).
