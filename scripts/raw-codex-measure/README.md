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

Source-layer claims here have **not** been independently audited by a second model. That
audit is the named next measurement for this step; `source-audit.md` holds the per-claim
receipts a reviewer opens instead of re-deriving.

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
  Until an operator answers that prompt, **an installed birth hook does not run**. This has no
  analogue on any shipped backend and is the largest single admission question for step 3.
  `[source]` the non-interactive escapes exist but are policy-level, not installer-level:
  `bypass_hook_trust` and managed requirements (`allow_managed_hooks_only`, `managed_dir`)
  in `hooks/src/engine/discovery.rs:84-114`, `:339-343`.
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
- **[source]** `command` is a SHELL STRING, not an exec-form argv: it is handed to
  `$SHELL -lc` (fallback `/bin/sh -lc`) — `hooks/src/engine/command_runner.rs:391-411`,
  `:428-453`. **Codex offers no exec-form hook launcher**, so entwurf's Hard Rule 14
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

So `docs/adding-a-harness.md` clause 4 is **OPEN** for codex: an operator-visible persistent
identity surface exists, but no measured way to hold entwurf's own string in it. This is a
step-9 admission question, not a step-1 gap to paper over.

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

So in the delivery-capable mode the join still holds — `hook.ppid == mcp.ppid` — but **both
resolve to the app-server, which is SHARED by every attached thread**. A sender marker keyed
by parent pid would be one marker for N citizens, which is precisely the uniqueness the V3
store contract (Hard Rule 7, `nativeSessionId` ownership) forbids. **This is the load-bearing
result of the whole step**, and it is a design input for step 6, not a defect to fix here.

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

## What this measurement does NOT establish

- No independent source audit yet (see the header). Every `[source]` line above is one
  reader's.
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
- Clause 4 (visible identity) has no working candidate yet — see M4.
- The hook trust gate (M1) has no measured non-interactive path. `bypass_hook_trust` and the
  managed-requirements route were read in source, never exercised.
