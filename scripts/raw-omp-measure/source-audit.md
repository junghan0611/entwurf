Author: xai/grok-4.6 (entwurf fresh sibling, 2026-08-27) — source audit for #87; review as a separate viewpoint.

Vendor: `~/repos/3rd/oh-my-pi` HEAD `4142f881` = tag `v18.0.0` (`02696f5b`) + 2 natives lint commits. Paths below are `packages/coding-agent/src/…` unless noted. Code is the oracle.

# CORRECTIONS SUMMARY

Only CORRECTED / UNRESOLVED. Fence-design impact first.

1. **A2 — `hasUI` is not the host predicate; `mode==="tui"` is stronger, not weaker.**
   rpc, rpc-ui, and ACP all pass a real `uiContext`, so `ExtensionRunner.hasUI()` is **true** (`runner.ts:879-881` = `uiContext !== noOpUIContext`). types.ts:465 comment ("false in print/RPC mode") **disagrees with code**. No initialize site other than `extension-ui-controller.ts` passes `"tui"`. **Do not gate birth on `hasUI`. Keep `mode==="tui"`.** Nothing in source weakens that fence.

2. **H2 — `setFooter` is a no-op on the TUI at v18.** `extension-ui-controller.ts:139` `setFooter: () => {}`. Visible identity cannot use `setFooter`. `setStatus` **does** render (hook-status lines under the status line; `statusLine.showHookStatus` default true).

3. **H3 — built-in `statusLine` has no custom-text / command segment.** Closed `StatusLineSegmentId` enum (`status-line/segments.ts:731-757`). Extension-owned persistent text = `setStatus`, not a Copilot-style `statusLine.command`.

4. **A1 — initialize call-site map was incomplete.** Direct `ExtensionRunner.initialize` sites: TUI `:302`/`:531` (`"tui"`), ACP `:2524` (`"rpc"`), executor `:3252` (default `"print"`), plus shared wrapper `runtime-init.ts:56` used by print/json/rpc and subagent revive. `rpc-mode.ts:961` is `initializeExtensions({mode:"rpc"})`, not a direct runner call. `runner.ts:651` is `initialize()` itself, not the field default (`:438`).

5. **A4 — `omp acp` does load discovered extensions.** `createAcpSessionFactory` (`main.ts:434`) calls `createAgentSession` without `disableExtensionDiscovery`. Mode `"rpc"`, `ExtensionContext.hasUI:true`, session-level `hasUI:false`, `enableMCP:false` at create (ACP then injects client servers). A `mode==="tui"` birth guard **stays silent**.

6. **B2 — bundled task agents do NOT set `restrictToolNames:true`.** That flag is a spawn option (planMode / host restrict / security coordinator), not agent frontmatter. scout/reviewer/librarian/security-reviewer have `tools:` allowlists but still inherit extensions unless the flag is set. Default `task`/`sonic` load extensions.

UNRESOLVED: none at source layer. LIVE slots in the ledger stay empty by design.

# Item ledger

## A. Discriminator completeness

### A1. Every `ExtensionRunner.initialize` call site — CORRECTED

Field default `#mode = "print"`: `extensibility/extensions/runner.ts:438`.
`initialize(..., mode: ExtensionMode = "print")`: `runner.ts:651-655`.

Direct call sites (grep `extensionRunner.initialize` / `runner.initialize`):

| site | mode passed | notes |
|---|---|---|
| `modes/controllers/extension-ui-controller.ts:302` | `"tui"` | `initHooksAndCustomTools`; **emits `session_start` :309-311** |
| `modes/controllers/extension-ui-controller.ts:531` | `"tui"` | `initializeHookRunner`; **no `session_start`**. Production callers of this method: none (only a unit test). |
| `modes/runtime-init.ts:56` | `options.mode` default `"print"` | shared wrapper; then `emit session_start` `:147` |
| `modes/acp/acp-agent.ts:2524` 5th arg `:2619` | `"rpc"` | then `emit session_start` `:2603` |
| `task/executor.ts:3252` | omitted → `"print"` | then `emit session_start` `:3305` |

`runtime-init` callers: `modes/print-mode.ts:120` (`mode === "json" ? "json" : "print"`); `modes/rpc/rpc-mode.ts:960-961` (`mode: "rpc"`); executor revive `executor.ts:3164` (no mode → print).

Claimed `rpc-mode.ts:961` as a direct initialize: **wrong shape, right mode** — it is `initializeExtensions({mode:"rpc"})`.

`cli/models-cli.ts:311` constructs `new ExtensionRunner` and does **not** call `initialize`.

### A2. CLI → ExtensionMode + hasUI — CORRECTED (hasUI); tui predicate still sound

CLI `Mode` (`cli/args.ts:23`): `"text" | "json" | "rpc" | "acp" | "rpc-ui"`.
Interactive TUI iff `!print && !autoPrint && mode === undefined` (`main.ts:1406-1407`).
`sessionOptions.hasUI = isInteractive || mode === "rpc-ui"` (`main.ts:1737`) — this is **session-level** `CreateAgentSessionOptions.hasUI`, not `ExtensionContext.hasUI`.

`ExtensionContext.hasUI` = `runner.hasUI()` = `this.#uiContext !== noOpUIContext` (`runner.ts:879-881`, wired at `runner.ts:1163`).

| CLI | host runner mode | ExtensionContext.hasUI | session.hasUI |
|---|---|---|---|
| plain interactive TUI | `"tui"` | true (TUI uiContext) | true |
| `-p` / `--print` / `--mode text` | `"print"` | false (no uiContext) | false |
| `--mode json` | `"json"` | false | false |
| `--mode rpc` | `"rpc"` | **true** (`rpcUiContext` always passed, `rpc-mode.ts:956-975`) | false |
| `--mode rpc-ui` | `"rpc"` (not `"tui"`) | **true** | true |
| `omp acp` / `--mode acp` | `"rpc"` | **true** (ACP uiContext) | false |

**Operator-visible TUI whose extensions see `mode !== "tui"`?** No. Only the TUI controller passes `"tui"`.
**rpc-ui:** operator-visible *elsewhere* (RPC UI client), extensions see `"rpc"`. Issue #87 forbids garden ids for non-tui — this is intended exclusion, not a hole.
**Non-visible session that sees `"tui"`?** No production path. `:531` is test-only rewire.

Fence: `mode==="tui"` is the sound top-level predicate. `hasUI` would admit rpc/rpc-ui/ACP.

### A3. Task subagents — CONFIRMED

`hasUI: false` at `task/executor.ts:3115` (`CreateAgentSessionOptions`).
`extensionRunner.initialize(actions, contextActions)` two-arg at `:3252` → default mode `"print"`, default uiContext no-op → `ExtensionContext.hasUI:false`.
`await extensionRunner.emit({ type: "session_start" })` at `:3305`.

### A4. `omp acp` — CORRECTED

ACP **does** load discovered extensions: `createAcpSessionFactory` (`main.ts:434-449`) spreads `baseOptions` into `createAgentSession` with `preloadedExtensions: trustedExtensions` (undefined unless `--trusted-extension`) and **does not** set `disableExtensionDiscovery`. Path 3 in `sdk.ts:2031-2034` then discovers + `loadExtensions`.
`enableMCP: false` at create (`main.ts:446`); client MCP is applied later (`acp-agent.ts:#configureMcpServers`).
Initialize: mode `"rpc"` (`:2619`), real `createAcpExtensionUiContext` (`:2496`) → `hasUI:true` on the extension context.
`session_start` at `:2603`.
A birth extension guarding `mode==="tui"` **stays silent**.

### A5. Subagent factory rebind — CONFIRMED

The "rebind" is not a later mutation of a live runner. Each subagent `createAgentSession` re-imports factories against **this** session's API:

```
sdk.ts:2000-2005  // preloadedExtensionPaths (subagent): skip FS scan, always re-call loadExtensions
sdk.ts:2024-2028  extensionPaths = options.preloadedExtensionPaths;
                  extensionsResult = await loadExtensions(extensionPaths, cwd, eventBus);
```

`loadExtensions` → `bindExtension` → `runExtensionFactory(factory, api, runtime)` (`loader.ts:362-422`, `:435-443`). `api` is a new `ConcreteExtensionAPI` for that session (`loader.ts:421`).

Host must never pass `preloadedExtensions` across the session boundary (`sdk.ts:441-443`).

## B. Subagent inheritance

### B1. CLI `-e` → subagent — CONFIRMED

`main.ts:1304-1306`: `cliExtensionPaths = [...extensions, ...hooks]` → `options.additionalExtensionPaths`.
`discoverSessionExtensionPaths` (`sdk.ts:720-721`) concatenates those onto discovery.
Host `createAgentSession` with `preloadedExtensions` captures `toolSession.extensionPaths` (`sdk.ts:2041`).
Task spawn: `structured-subagent.ts:442` `preloadedExtensionPaths: restrictToolNames ? [] : session.extensionPaths`.
Executor forwards at `:3096`.

**Yes: an `-e` probe extension loads inside task subagents by default**, re-executed per A5, unless `restrictToolNames`.

### B2. Bundled agents vs `restrictToolNames` — CORRECTED

`task/agents.ts` bundled defs: scout, designer, reviewer, security-reviewer, librarian, task, sonic. **None set `restrictToolNames`.**
`tools:` allowlists in markdown (not a discovery skip):
- scout: `read, grep, glob, web_search`
- reviewer / librarian: `read, grep, glob, bash, lsp, web_search, ast_grep`
- security-reviewer: `read, grep, glob, lsp, ast_grep`
- task / sonic / designer: no `tools:` → full host tool set

`restrictToolNames: true` is a **spawn option**:
- `structured-subagent.ts:386` `policy.planMode || session.restrictToolNames === true`
- `security/coordinator.ts:254` (security scan session, not a TUI task agent)
- `compress/session.ts:49`
- isolation runner **clears** paths (`isolation-runner.ts:170`)

Agents that would **not** load extensions: any spawn with `restrictToolNames:true` (plan-mode subagents, restricted host, isolated subprocess). Default `task` **does** load them.

### B3. Subagent MCP proxy — CONFIRMED

`executor.ts:3021-3024`:
```
restrictToolNames = options.restrictToolNames === true
enableMCP = !restrictToolNames && (options.enableMCP ?? true)
mcpManager = enableMCP ? options.mcpManager : undefined
mcpProxyTools = mcpManager ? createMCPProxyTools(mcpManager) : []
```
Passed as `mcpManager` + `customTools: mcpProxyTools` into `createAgentSession` (`:3123-3124`).
`createMCPProxyTools` (`executor.ts:807-813`) copies `tool.name` / `mcpServerName` / `mcpToolName` from the **parent** manager's `getTools()`. Same public `mcp__…` names. One bridge child (parent's). No per-subagent MCP process.

## C. session_start semantics (host)

### C1. When TUI host `session_start` fires — CONFIRMED

`interactive-mode.ts:1221` first `requestRender(true)` (window paints).
`:1238` `await this.initHooksAndCustomTools()` → `extension-ui-controller.ts:302` initialize `"tui"` then `:309-311` emit `session_start`.

Fires **after first paint, before first prompt**. No model turn required. **Once per process** for the host runner: `/new` does not re-emit `session_start` (C2).

Comment at `:1204-1207` notes session_start `sendMessage({display:true})` can race `renderInitialMessages`.

### C2. Re-fire on /new, --resume, --continue, switch/branch — CONFIRMED

Host process start (including CLI `--resume`/`--continue`/`--fork`): one `session_start` at TUI init, on whatever session was opened.

In-process thereafter, **`session_switch` / `session_branch`, not `session_start`:**

| action | events |
|---|---|
| `/new` | `session_before_switch` reason `"new"` (`agent-session.ts:6910-6913`) then `session_switch` reason `"new"` (`:6984-6987`) |
| fork | `session_before_switch` `"fork"` (`:7021`) then `session_switch` `"fork"` (`:7073-7076`) |
| switch / in-TUI resume | `session_before_switch` `"resume"` (`:7979-7982`) then `session_switch` `"resume"` (`:8071-8074`) |
| branch | `session_branch` (`:8350`, `:8481`) |

A birth hook that mints on `session_start` will not re-mint on `/new` unless it also listens to `session_switch`. Idempotent upsert on switch is the usual pattern; this audit does not implement it.

## D. Session identity API

### D1. ReadonlySessionManager + file naming — CONFIRMED

`session-manager.ts:359-376` `ReadonlySessionManager = Pick<SessionManager, "getCwd" | "getSessionDir" | "getSessionId" | "getSessionFile" | …>`.
- `getSessionId()` `:1946-1948` → `this.#sessionId`
- `getSessionFile()` `:1950-1952` → `this.#sessionFile` (`string | undefined`)
- mint: `mintSessionId()` `:95-97` `return Bun.randomUUIDv7();`
- file: `` `${fileSafeTimestamp(timestamp)}_${this.#sessionId}.jsonl` `` `:1134-1137`
- `fileSafeTimestamp` `:103-104` `iso.replace(/[:.]/g, "-")`
- dir: `getSessionsDir` → `~/.omp/agent/sessions/<cwd-encoded>/` (`utils/src/dirs.ts:781-783`; encoding `session-paths.ts:62-80`)

`nativeSessionId` candidate = UUIDv7 string (not the filename). Filename = `<iso-with-colons-as-dashes>_<uuidv7>.jsonl`. Persistence is lazy (`getSessionFile` may name a path not yet on disk).

### D2. Extension factory + probe — CONFIRMED (probe names were already right)

`ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>` (`types.ts:1592`).
`-e` files: default export **or** the module itself if it is a function (`loader.ts:57-61`).
`ExtensionAPI.on` (`types.ts:1222+`) and `ExtensionAPI.getAllTools` (`types.ts:1433`) exist with those names.

Probe guessed `getSessionFile` / `getSessionId` — those **are** the v18 names. Removed nonexistent `getId()` fallback; added `getSessionDir`. File: `scripts/raw-omp-measure/probe-extension.ts`.

## E. MCP tool-name dialect

### E1. — CONFIRMED

`sanitizeMCPToolNamePart` `mcp/tool-bridge.ts:351-357`: lower, `[^a-z_]+` → `_`, collapse `_`, trim edge `_`.
Redundant prefix strip `:368-374` if `sanitizedToolName.startsWith(sanitizedServerName + "_")`.
Mint `:375` `capMCPToolNameLength(\`mcp__${sanitizedServerName}_${normalizedToolName}\`)` cap 64 (`:365-366`, `:396`).

Server `"entwurf-bridge"` → `entwurf_bridge`.
None of the tools start with `entwurf_bridge_` → **no prefix-strip**.
Digit in `entwurf_v2`: `2` → `_` → `entwurf_v_` → trim → `entwurf_v` (end-digit is eaten, not kept as `_`).

| tool | minted (all ≤64, unique) |
|---|---|
| entwurf_v2 | `mcp__entwurf_bridge_entwurf_v` |
| entwurf_self | `mcp__entwurf_bridge_entwurf_self` |
| entwurf_peers | `mcp__entwurf_bridge_entwurf_peers` |
| entwurf_inbox_read | `mcp__entwurf_bridge_entwurf_inbox_read` |
| entwurf_register_native | `mcp__entwurf_bridge_entwurf_register_native` |
| entwurf_fresh_call | `mcp__entwurf_bridge_entwurf_fresh_call` |
| entwurf_resume_call | `mcp__entwurf_bridge_entwurf_resume_call` |

Permission/approval: **same string**. `MCPTool.name` is the minted name (`tool-bridge.ts:481`); `readonly approval = "write"` (`:490`). `tools/approval.ts:110` consults `tools.approval.<tool.name>` (or `policyKey`). `approval.ts:261` special-cases `tool.name.startsWith("mcp__")`. No second Copilot-style dialect.

Live tool list remains the acceptance oracle (ledger).

## F. MCP discovery / precedence

### F1. Source order — CONFIRMED (priority table)

Providers inserted highest-priority first (`capability/index.ts:84-91`). Dedupe **first wins** (`:183`).

MCP provider priorities:

| priority | id | role |
|---|---|---|
| 100 | `native` / builtin | OMP `~/.omp/agent/mcp.json`, `<cwd>/.omp/mcp.json` |
| 90 | `omp-plugins` | installed omp plugins |
| 80 | `claude` | Claude Code — **third** among these families |
| 70 | `claude-plugins` | marketplace plugins |
| 60 | gemini | |
| 55 | opencode | |
| 50 | cursor | |
| 20 | vscode | |
| 5 | `mcp-json` | standalone project `mcp.json`/`.mcp.json` |

Within native (`builtin.ts:207-210`) and Claude (`claude.ts:104-117`) loaders: **project entries pushed before user entries** so a project name claims the dedupe key first. Claude comment `:104-105` ("Load project entries before user entries"). Same-name shadowing = first (highest priority provider, and within a provider project-before-user).

### F2. disabledServers / enabledServers / mcp.enableProjectConfig — CONFIRMED

`mcp/config.ts:104-127`:
- `disabledServers` (user mcp.json): `suppressServer` `:123` — **highest-precedence denylist**; suppressed items still claim the dedupe key (`:163-165`).
- `enabledServers`: allowlist that overrides a source `enabled: false` (`:125`).
- `mcp.enableProjectConfig` default true (`settings-schema.ts:4660-4666`); when false, project-level items are **filtered out before dedupe** (`config.ts:115-116`) so they cannot shadow.

Wired at `sdk.ts:1864`.

### F3. Claude import env — CONFIRMED (with `${VAR}` expansion)

`discovery/claude.ts:87-97`: `expandEnvVarsDeep(json.mcpServers)` then `env: serverConfig.env as Record<string, string>`.
`expandEnvVars` (`helpers.ts:446-452`) only substitutes `${NAME}` / `${NAME:-default}`. A literal `ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code` **rides along unchanged**. Keys are not rewritten.

### F4. omp never writes another tool's config — CONFIRMED

`mcp/config-writer.ts:301-304`: sourcePath allowed only for native `.omp/mcp.json` and `mcp-json` files. "Tool-owned configs (opencode.json, claude.json, settings.json …) MUST be omitted; we never mutate another tool's file." Toggle of imported servers goes to user `disabledServers` / `enabledServers` (`:320-324`). Writer targets `writeMCPConfigFile` on those omp-owned paths only.

## G. MCP child process + env

### G1. Bun.spawn env — CONFIRMED

`mcp/transports/stdio.ts:577-581`:
```
const env = { ...Bun.env, ...this.config.env };
```
Full process env inherited, then config entry `env` merged on top. Spawn `:600-609` uses that `env`. **No omp-injected session/agent id.** No `OMP_*` / `PI_SESSION_ID` planted here. Danger is pure inheritance passthrough of the parent's env (M6).

### G2. Linux detached + cleanup — CONFIRMED

`stdio.ts:41-47`: Linux `detached: true` → setsid (own session, no controlling tty). macOS/Windows `false`.
`resolveStdioSpawnCommand` `:334` non-win32: `{ cmd, detached: platform !== "darwin" }`.
setsid does **not** reparent: child ppid stays the omp pid.
Kill: `signalStdioProcess` `:474-494` — if detached POSIX, `process.kill(-pid, SIGTERM)` (process group), then SIGKILL after grace (`:497+`). `manager.disconnectAll` `:946` discards every connection on teardown.

### G3. PI_* inventory (packages/, production) — CONFIRMED absence of PI_SESSION_ID / PI_AGENT_ID

Repo-wide `PI_SESSION_ID` / `PI_AGENT_ID`: **nowhere**. Only `MNEMOPI_SESSION_ID` at `packages/mnemopi/src/mcp-tools.ts:434`.

Identity-overlap knobs omp **does** read:

| var | where |
|---|---|
| `PI_CONFIG_DIR` | `packages/utils/src/dirs.ts:210` (default `.omp`) |
| `PI_CODING_AGENT_DIR` | `dirs.ts:358+` agent dir override |
| `PI_PROFILE` | `dirs.ts:38,90,120` (legacy; `OMP_PROFILE` wins) |
| `PI_SMOL_MODEL` / `PI_SLOW_MODEL` / `PI_PLAN_MODEL` | `coding-agent/src/main.ts:1467-1469`; help `cli/help-extra.ts:59-61` |
| `PI_CODING_AGENT_SESSION_DIR` | `cli/args.ts:156` |

Other PI_* omp reads (not identity carriers; incomplete-by-theme, not a second address axis): `PI_COMPILED`, `PI_BUNDLED`, `PI_TIMING`, `PI_DEBUG_STARTUP`, `PI_NO_PTY`, `PI_NO_TITLE`, `PI_NOTIFICATIONS`, `PI_CONFIG_FILES`, `PI_EDIT_VARIANT`, `PI_FORCE_IMAGE_PROTOCOL`, `PI_TINY_*`, `PI_DIALECT`, `PI_PROXY*`, `PI_STREAM_*`, `PI_OPENAI_STREAM_*`, `PI_OPENROUTER_RESPONSES`, `PI_CODEX_*`, `PI_CACHE_RETENTION`, `PI_NO_INTERLEAVED_THINKING`, `PI_NO_THINKING_LOOP_GUARD`, `PI_AUTH_NO_BORROW`, `PI_AI_ANTIGRAVITY_*`, `PI_AI_GEMINI_CLI_VERSION`, `PI_TUI_*`, `PI_BASH_NO_CI`, `PI_SHELL_PREFIX`, `PI_DISABLE_UUTILS_BUILTINS`, `PI_SUBPROCESS_CMD`, `PI_BLOCKED_AGENT`, `PI_TASK_MAX_OUTPUT_*`, `PI_RPC_EMIT_TITLE`, `PI_COMMIT_*`, `PI_PERPLEXITY_*`, `PI_CODEX_WEB_SEARCH_MODEL`, `PI_TOKENIZER_ACCURATE`, `PI_NO_INTENT`, `PI_NATIVE_VARIANT`, `PI_TEST_RUNTIME`, `PI_PACKAGE_DIR`, `PI_DOCS_EMBED`, `PI_TINY_TRANSFORMERS_VERSION`.

### G4. Legacy `.pi` — CONFIRMED not a native discovery root

Native extension dirs (`discovery/builtin.ts:58-72`, `:482-483`): `PATHS.projectDir` = `CONFIG_DIR_NAME` = **`.omp`** (`utils/src/dirs.ts:23`) and `getAgentDir()` = `~/.omp/agent` (or profile). Scans `<dir>/extensions`. **Not** `~/.pi/agent/extensions` or `<cwd>/.pi/extensions`.

`.pi` **is** honored as a **package.json manifest alias**:
- extension modules: `pkg?.omp ?? pkg?.pi` (`discovery/helpers.ts:616-617`)
- plugins: `pkg.omp ?? pkg.pi` (`extensibility/plugins/loader.ts:267-273`; `types.ts:27` "from package.json omp or pi field")

Examples still mention the old `~/.pi/agent/extensions` path; that is docs drift, not a loader root. **entwurf's pi extensions under `~/.pi/` cannot be ambiently loaded by omp.**

## H. Receive + visible identity

### H1. `pi.sendUserMessage` idle starts a turn — CONFIRMED

`types.ts:1417-1418`: "idle starts a turn; streaming queues as steer unless deliverAs is set."
`agent-session.ts:6515-6555`: omitted `deliverAs` → `this.prompt(...)` (starts a turn); `followUp`/`steer` only queue.
TUI wires `sendUserMessage: this.#sendExtensionUserMessage` (`extension-ui-controller.ts:176`) which calls `session.sendUserMessage`. `ctx.setTimeout` is `runner.ts:1178` managed timers — a background callback in TUI mode can call it. (Idle-wake demo is step 7 / out of this audit.)

### H2. setStatus / setFooter — CORRECTED

API: `types.ts:285` `setStatus`, `:294` `setFooter`.
TUI implementation (`extension-ui-controller.ts:110,139`):
```
setStatus: (key, text) => this.setHookStatus(key, text),  // real
setFooter: () => {},                                      // NO-OP
setHeader: () => {},                                      // NO-OP
```
`setHookStatus` → `statusLine.setHookStatus` (`:575-576` → `status-line/component.ts:678-682`).
Render: `component.ts:2246-2251`, gated by `statusLine.showHookStatus` default **true** (`settings-schema.ts:952-956`).
ACP uiContext: `setStatus`/`setFooter` both no-ops (`acp-agent.ts:574,577`).

**v18 TUI does not render extension `setFooter`.** Persistent garden-id surface = `setStatus` hook lines (or a built-in segment — H3).

### H3. Built-in statusLine — CORRECTED (no custom command)

`config.yml` `statusLine.*`: preset, leftSegments, rightSegments, separator, showHookStatus, sessionAccent, transparent, segmentOptions, compactThinkingLevel, contextLine (`interactive-mode.ts:1977-1987`).
Segments are a **closed enum** (`status-line/segments.ts:731-757`): pi, model, mode, path, git, pr, subagents, token_*, cost, context_*, time*, session, hostname, cache_*, session_name, usage, collab. **No `command`, no free-text, no argv renderer.**
Not an alternative garden-id surface unless one of those segments already shows an id (none does). Use `setStatus`.

## I. Config writer shapes

### I1. mcp/config-writer.ts — CONFIRMED

User file: `getMCPConfigPath("user")` = `path.join(getAgentDir(), "mcp.json")` = `~/.omp/agent/mcp.json` (profile-aware) (`utils/src/dirs.ts:922-926`).
Project file: `path.join(cwd, ".omp", "mcp.json")` (`getProjectAgentDir` uses literal `CONFIG_DIR_NAME` `.omp`).
`addMCPServer` (`config-writer.ts:111-143`) writes `{ $schema, mcpServers: { [name]: config } }` via `writeMCPConfigFile`.

Minimal valid stdio entry (`config/mcp-schema.json` `$defs/stdioServer`, `mcp/types.ts:99-112`):

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "entwurf-bridge": {
      "command": "/abs/path/to/start.sh",
      "args": [],
      "env": {
        "ENTWURF_BRIDGE_EXTERNAL_AGENT_ID": "external-mcp/omp"
      }
    }
  }
}
```

`type: "stdio"` optional (default). `command` required. `env` is a string map.

### I2. `omp config` → config.yml — CONFIRMED

`cli/config-cli.ts:4-5`, `handleSet` `:363-378`: `parseAndSetValue` then `await settings.flush()`.
`Settings.#configPath` = `path.join(this.#agentDir, MAIN_CONFIG_FILENAMES[0])` (`settings.ts:401`) with `MAIN_CONFIG_FILENAMES = ["config.yml", "config.yaml"]` (`utils/src/dirs.ts:26`).
`flush` → `#saveNow` → `#writeYamlAtomically` to that path. **Yes: `omp config set` writes `~/.omp/agent/config.yml`.**
