Author: claude-opus-5 (entwurf fresh sibling, 2026-09-08) — source-layer receipts for #95 step 1.
NOT an independent audit: the same reader took the measurements in `README.md` and wrote these
receipts. A second-school audit is the named next measurement; until it runs, treat every row
below as one reader's `file:line`, reopenable but unconfirmed.

Vendor: `~/repos/3rd/codex` at tag `rust-v0.153.4` (`3d2ee51`). Paths are relative to
`codex-rs/`. Code is the oracle.

# Item ledger

## H. Hooks — vocabulary, firing, declaration, execution

### H1. Event set is 12, not 0.136's 9
`hooks/src/lib.rs:23-36` — `HOOK_EVENT_NAMES: [&str; 12]`.
`hooks/src/lib.rs:43-52` — `HOOK_EVENT_NAMES_WITH_MATCHERS: [&str; 9]` (matcher-meaningful subset).
`config/src/hook_config.rs:36-61` — the same 12 as TOML keys, PascalCase via `serde(rename)`.
Added since the archived 0.136 note: `PermissionRequest`, `SessionEnd`, `Interrupt`.

### H2. SessionStart source is a 4-valued matcher
`hooks/src/events/session_start.rs:25-38` — `SessionStartSource::{Startup,Resume,Clear,Compact}`
with `as_str()` → `startup|resume|clear|compact`.
`hooks/src/events/session_start.rs:69-74` — `matcher_input()` returns that string for
`SessionStart`, and `agent_type` for `SubagentStart`.
`core/src/session/session.rs:1600-1606` — the mapping from `InitialHistory`:
`Resumed→Resume`, `New|Forked→Startup`, `Cleared→Clear`.
`core/src/session/mod.rs:3812` — compaction queues `Compact`.

### H3. Firing is turn-time, not construction-time — the decisive chain
1. `core/src/session/session.rs:1623` — construction only calls
   `state.queue_pending_session_start_source(session_start_source)`.
2. `core/src/state/session.rs:55` — the queue is a `VecDeque<SessionStartSource>`;
   `:348-352` push, `:355-358` pop.
3. `core/src/hook_runtime.rs:124-128` — `run_pending_session_start_hooks` DRAINS that queue
   (`while let Some(..) = sess.take_pending_session_start_source().await`).
4. `core/src/session/turn.rs:264` and `:504` — the only two production call sites, both inside
   turn execution. `grep -rn 'run_pending_session_start_hooks' core/src` returns no other
   non-test caller.
Nothing in the construction path invokes the hook engine. `[host]` receipt in README M1.

### H4. Handler kinds and TOML shape
`config/src/hook_config.rs:12-17` — `HooksFile { description?, hooks: HookEventsToml }`
(the `hooks.json` shape).
`config/src/hook_config.rs:19-25` — `HooksToml { #[serde(flatten)] events, state }`
(the `[hooks]` in-config shape, carrying `[hooks.state]`).
`config/src/hook_config.rs:27-33` — `HookStateToml { enabled?, trusted_hash? }`.
`config/src/hook_config.rs:153-159` — `MatcherGroup { matcher?, hooks: Vec<HookHandlerConfig> }`.
`config/src/hook_config.rs:161-200` — `#[serde(tag="type")] HookHandlerConfig`:
- `command { command, commandWindows?, timeout?, async, statusMessage?, additionalContextLimit? }`
- `mcp_tool { server, tool, input, timeout?, statusMessage? }`
- `prompt {}`, `agent {}`
The `mcp_tool` kind is executed through `HookMcpExecutor` (`hooks/src/mcp.rs:8-24`), whose
result text is "interpreted using ordinary command-hook output semantics".

### H5. Command execution is shell-form, with an env REPLAY
`hooks/src/engine/command_runner.rs:391-411` — `build_command`: when the configured shell
program is empty, `default_shell_command(environment)`, then the command line as ONE arg.
`hooks/src/engine/command_runner.rs:428-453` — non-Windows: program from `SHELL` (fallback
`/bin/sh`), argument `-lc`. A LOGIN shell: the operator's profile runs first.
`hooks/src/engine/command_runner.rs:419-423` — `command.env_clear()` then
`command.envs(environment)` then the per-handler `env` then `scrub_non_inheritable_env_vars`.
"Replay the session snapshot instead of inheriting the live process environment" is the
in-source comment; the snapshot is the HOST process's, which is what makes M5's mode split
visible in the hook's own env.
There is no exec-form (`argv[]`) handler kind anywhere in `HookHandlerConfig`.

### H6. Discovery sources and the trust/managed policy
`hooks/src/engine/discovery.rs:146-166` — two sources merged per config layer:
`load_hooks_json(layer.hooks_config_folder())` and the layer's own `hooks` TOML key
(`:387` reads `layer.config.get("hooks")`).
`hooks/src/engine/discovery.rs:339-343` — the JSON path is `<config folder>/hooks.json`.
`config/src/state.rs:239-243` — `hooks_config_folder()` = override else `config_folder()`.
`hooks/src/engine/discovery.rs:81-88` — `HookDiscoveryPolicy { allow_managed_hooks_only,
bypass_hook_trust }`; `:105-114` reads `allow_managed_hooks_only` from layer requirements.
`hooks/src/engine/discovery.rs:767` — the comment binding config-TOML and hooks.json hooks to
one trust identity.
`config/src/hook_config.rs:218-250` — `ManagedHooksRequirementsToml { managed_dir,
windows_managed_dir, #[serde(flatten)] hooks }` + `managed_dir_for_current_platform()`.
NOT exercised: no measurement drove `bypass_hook_trust` or a managed requirements file.

### H7. Stop is a turn boundary, not a wake
`hooks/src/events/stop.rs:97-104` — `StopOutcome { should_stop, stop_reason, should_block,
block_reason, continuation_fragments }`.
`hooks/src/schema.rs:455-464` — `StopCommandOutputWire { universal, decision?, reason? }`
with the in-source note that Claude requires `reason` when `decision == block`.
Same class as Copilot's `agentStop`; `docs/adding-a-harness.md` step 7(c) forbids using it as
an idle-wake substitute.

### H8. No filesystem-wake vocabulary
`grep -rn 'watchPaths|FileChanged|asyncRewake' --include=*.rs codex-rs/` returns exactly one
hit: `external-agent-migration/src/hooks_cla.rs:158-161`, inside a CLAUDE-HOOKS IMPORTER, in a
`continue` branch that SKIPS any imported hook object carrying `asyncRewake`, `shell` or
`once`. Codex reads Claude's doorbell vocabulary only to refuse it.

## E. Environment

### E1. Codex's non-inheritable set is five names, none of them ours
`protocol/src/shell_environment.rs:14-21` — `NON_INHERITABLE_ENV_VARS` =
`CODEX_EXEC_SERVER_NOISE_AUTH_TOKEN`, `NODE_REPL_AUTH_TOKEN`, `OPENAI_FEDERATION_RULE_ID`,
`OPENAI_IDENTITY_TOKEN_FILE`, `OPENAI_WORKLOAD_IDENTITY_CONTEXT`.
`:33-50` — `scrub_non_inheritable_env_vars` removes those and only those.

### E2. Default shell-env policy inherits everything
`protocol/src/config_types.rs:213-214` — `ShellEnvironmentPolicyInherit::All` is `#[default]`.
`protocol/src/config_types.rs:264-265` — the `Default` impl sets
`inherit: All, ignore_default_excludes: true`, so the `*KEY*`/`*SECRET*`/`*TOKEN*` filters at
`protocol/src/shell_environment.rs:124-131` are OFF by default.
Consequence: `PI_SESSION_ID` / `PI_AGENT_ID` pass through untouched. `[host]` confirmed in
README M5 (embedded mode).

### E3. CODEX_THREAD_ID is a shell-tool carrier, not a hook carrier
`protocol/src/shell_environment.rs:7` — the constant.
`protocol/src/shell_environment.rs:149-152` — inserted by `populate_env` only when a
`thread_id` argument is supplied, i.e. on the shell-environment construction path.
`[host]` a hook's `env | grep ^CODEX_` showed `CODEX_HOME`, `CODEX_MANAGED_BY_PNPM`,
`CODEX_MANAGED_PACKAGE_ROOT` and nothing else.

### E4. No entwurf/pi name collision
`grep -rn '"PI_SESSION_ID"|"PI_AGENT_ID"|PI_CODING_AGENT_DIR|ENTWURF' --include=*.rs codex-rs/`
→ 0 hits. Codex has no pi lineage, so #87's fork-collision class (step 1(6)) is inapplicable.

## T. MCP tool-name dialect

### T1. Prefix + delimiter constants
`core/src/tools/handlers/mcp.rs:46` — `LEGACY_MCP_TOOL_NAME_PREFIX = "mcp__"`.
`core/src/tools/handlers/mcp.rs:47` and `codex-mcp/src/tools.rs:225` — `MCP_TOOL_NAME_DELIMITER
= "__"`. (`codex-mcp/src/tools.rs:22` carries the prefix constant for the same crate.)

### T2. Namespace is the server name, prefixed unless a feature disables it
`codex-mcp/src/rmcp_client.rs:821` — `callable_namespace: server_name.to_string()`.
`codex-mcp/src/tools.rs:139-142` — `callable_namespace_with_prefix(sanitize(...), prefix &&
!non_prefixed_servers.contains(server))`.
`codex-mcp/src/tools.rs:228-234` — the prefixing function itself.
`core/src/config/mod.rs:1793-1796` — `prefix_mcp_tool_names()` is
`!features.enabled(NonPrefixedMcpToolNames) || non_prefixed_mcp_tool_servers.is_some()`.
So prefixing is the DEFAULT and a feature flag is required to lose it.

### T3. The sanitizer keeps digits and case
`codex-mcp/src/mcp/mod.rs:544-559` — every char not in `[A-Za-z0-9_]` becomes `_`; empty →
`"_"`. Contrast omp, whose `[a-z_]` charset deletes the `2` in `entwurf_v2`.
Derivation for this repo's server: `entwurf-bridge` → `entwurf_bridge`, `entwurf_v2` → itself,
giving `mcp__entwurf_bridge__entwurf_v2`. `[host]` the live tool list in README M7 matches this
derivation on all seven bridge tools.

### T4. Collision hardening exists and can mutate a name
`codex-mcp/src/tools.rs:152-193` — a namespace or tool name shared by two distinct raw
identities gets a 12-hex sha1 suffix (`callable_name_hash_suffix`, `:241-245`).
`codex-mcp/src/tools.rs:226` — `MAX_TOOL_NAME_LENGTH = 128`, with truncation-plus-hash at
`:263-285`. So the derived spelling is stable only while no second server collides on
`entwurf_bridge`. Not exercised.

### T5. Hook-facing tool names differ from model-facing ones
`core/src/tools/handlers/mcp.rs:95-97` — `hook_tool_name()` = `ensure_mcp_prefix(join_tool_name(
canonical))`, i.e. what `PreToolUse`/`PostToolUse` matchers compare against.
`core/src/tools/handlers/mcp.rs:100-109` — `join_tool_name` trims a trailing `_` from the
namespace and a leading `_` from the name before joining.
The Copilot lesson generalises: measure the string each argv/config position actually wants.

## S. §3.5 scope, statusline, app-server

### S1. Subagents raise a different event
`core/src/hook_runtime.rs:129-147` — the target selection. A `SubAgentSource::ThreadSpawn` with
source `Startup` becomes `StartHookTarget::SubagentStart{turn_id, agent_id, agent_type}`; any
other `SessionSource::SubAgent(_)` returns `false` WITHOUT dispatching (`:146`); everything else
is `StartHookTarget::SessionStart`.
`hooks/src/events/session_start.rs:52-74` — `event_name()` maps those to
`HookEventName::SubagentStart` / `::SessionStart`.
`hooks/src/events/session_start.rs:156-167` — the `SubagentStartCommandInput` carries
`session_id` (parent), `turn_id`, `agent_id`, `agent_type`.
`hooks/src/events/session_start.rs:271-274` — `continue:false` is honoured for `SessionStart`
ONLY; `SubagentStart` is context-injection-only.
`core/src/tools/handlers/multi_agents_spec.rs:85`, `:124` — the model-facing spawner is
`spawn_agent` (siblings: `send_input`, `wait_agent`, `list_agents`, `close_agent`, …).
`[host]` one `spawn_agent` call produced exactly one `SubagentStart` and zero additional
`SessionStart` (README M8).

### S2. Statusline is a closed enum with no command segment
`tui/src/bottom_pane/status_line_setup.rs:56-155` — `StatusLineItem`, ~28 variants, all
built-in facts. Nothing accepts operator text or a command.
`tui/src/chatwidget.rs:502` — `DEFAULT_STATUS_LINE_ITEMS = ["model-with-reasoning","current-dir"]`.
`tui/src/slash_command.rs:59`, `:118` — `/statusline` "configure which items appear in the
status line".
`tui/src/bottom_pane/status_line_setup.rs:137-139` — `SessionId` with
`strum(to_string="thread-id", serialize="session-id")`.
`tui/src/chatwidget/status_surfaces.rs:776-784` — `ThreadTitle` renders `thread_name`, else the
thread id.
`app-server-protocol/src/protocol/common.rs:566` — `ThreadSetName => "thread/name/set"`.
`[host]` the vendor auto-renames a thread after the first turn, so the name slot is contested.

### S3. App-server method surface at 0.153.4
`app-server-protocol/src/protocol/` — the measured route survives: `turn/start`, `turn/steer`,
`turn/interrupt`, `thread/inject_items`, `thread/status/changed`, `thread/resume`,
`thread/loaded/list`, `thread/list`.
New family since the archived 0.136 note: `thread/queue/{add,start,list,update,reorder,delete,
changed}`. Not exercised; a candidate to compare against `turn/start` in a later step, not a
claim about it now.

# Open at the source layer

- No independent second-model confirmation of any row above.
- H6: managed-hooks and `bypass_hook_trust` paths read, never run.
- T4: name-collision hardening read, never triggered.
- S3: the queue family read, never called.
- Gotcha 2 of the archived probe (`-c` disables auto-attach) was NOT re-derived at 0.153.4;
  `can_reuse_implicit_local_daemon` was not reopened.
