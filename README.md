# pi-shell-acp

Use Claude Code through the official Agent Client Protocol (ACP) path inside pi. Codex is supported as a second backend so the bridge's ACP boundary can be verified against a non-Anthropic ACP server. Gemini CLI is supported as a third backend (since 0.4.8) — pi-mono v0.71.0 removed its built-in Google provider, and Gemini CLI's `--acp` flag offers an official ACP server, so the bridge picks the path back up rather than going through API-key/Vertex provider paths.

> **Status: Public, active development.**
> This is real working code, but it is still young. Expect issues and verify it in your own workflow before relying on it all day.
>
> **Evidence calibration.** Claims about identity, tool visibility, and native-quality behaviour are tracked in [VERIFY.md](./VERIFY.md). Current public evidence is strongest at L1–L2 for identity/tool wiring; 8-hour/day native-quality claims remain unmeasured until L4/L5 runs.

![pi-shell-acp demo](docs/assets/pi-shell-acp-demo.gif)

![pi-shell-acp in Doom Emacs](docs/assets/pi-shell-acp-doomemacs.gif)

`pi-shell-acp` connects pi to Claude Code, Codex, and Gemini CLI through the same ACP path used by Zed's Claude Code integration — no OAuth proxy, no CLI transcript scraping, no Claude Code emulation. The bridge respects each backend's minimum identity boundary (the model is Claude, Codex, or Gemini) while shaping the pi-facing operating surface on top.

```text
pi
  -> pi-shell-acp
    -> claude-agent-acp | codex-acp | gemini --acp
      -> Claude Code | Codex | Gemini CLI
```

> **Direction note.** `pi-shell-acp` is the reverse of [`pi-acp`](https://github.com/svkozak/pi-acp): `pi-acp` lets external ACP clients talk *to* pi; `pi-shell-acp` lets pi talk *to* ACP backends.

## How to Read This Project

If you see words like *entwurf* or *engraving* and wonder why a coding tool has philosophical vocabulary — this section is for you.

**The problem.** Pi users who subscribe to Claude Code have no official way to use that subscription inside pi. The workarounds that exist either violate Anthropic's Terms of Service or rely on fragile hacks that break without warning. This project exists because the maintainer tried every one of those paths and needed something that wouldn't get his shared company account banned.

**The solution.** ACP (Agent Client Protocol) is the protocol Zed uses to connect to Claude Code. `pi-shell-acp` uses the same path — pi stays the harness, Claude Code stays itself.

**Why Codex too.** Codex already runs natively in pi, so the ACP path is not a workaround for Codex. It is supported here as a second backend kept to verify the bridge's ACP boundary against a non-Anthropic ACP server.

**Why "entwurf" (not "delegate").** Pi's ecosystem already has users building their own delegation logic. To avoid naming collisions, this project uses *entwurf* — German for "draft" or "projection." When you invoke entwurf, you don't spawn a worker subprocess; you summon a sibling that holds the same tool. The difference matters: workers report to a master, siblings coordinate through messages.

**Why "engraving."** Earlier releases used engraving as the bridge-identity carrier. In 0.4.5 that role moved to a one-shot first-user context augment so the subscription-sensitive system/developer carrier can stay small while still delivering pi context, `~/AGENTS.md`, and project `AGENTS.md` to both Claude ACP and Codex ACP. Engraving is now an optional operator-authored personal surface: a short note you may want in the backend's highest identity carrier, not the place for AGENTS.md, tool catalogs, or bridge narrative. Empty engraving files are valid and skipped.

**Why this matters for daily use.** Every friction point compounds across many interactions over a working day. The verification depth in [VERIFY.md](./VERIFY.md) exists because the maintainer uses this bridge daily and keeps hitting edge cases worth recording.

## History — How We Got Here

Before this bridge, pi users who wanted Claude tried several paths. Each taught something.

| Path | What it taught |
|------|----------------|
| [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | OAuth proxy works for chat, but tools need a deeper integration |
| [prateekmedia/claude-agent-sdk-pi](https://github.com/prateekmedia/claude-agent-sdk-pi) | Stateless turn accumulation degrades quality — sessions need to be turn-aware |
| [@benvargas/pi-claude-code-use](https://www.npmjs.com/package/@benvargas/pi-claude-code-use) | Native-level quality is achievable — proved the ceiling for what pi + Claude can feel like |
| [proxycli](https://github.com/junghan0611/proxycli) | CLI wrapping gives full tools + skills, but depends on policy that can change |
| **pi-shell-acp** | ACP is the protocol-level answer — official, turn-aware, session-persistent |

Each prior approach contributed to the understanding that led here. `pi-shell-acp` chose ACP because it is the protocol path used by Zed's Claude Code integration, not a proxy or transcript-scraping workaround.

## Install & Setup

### Consumer install

```bash
# 1. register with pi
pi install git:github.com/junghan0611/pi-shell-acp

# 2. wire MCP servers into your project
cd /path/to/your-project
~/.pi/agent/git/github.com/junghan0611/pi-shell-acp/run.sh install .

# 3. verify
pi --list-models pi-shell-acp
pi --model pi-shell-acp/claude-sonnet-4-6 -p 'reply with ok'
```

### Developer install

```bash
git clone https://github.com/junghan0611/pi-shell-acp ~/repos/gh/pi-shell-acp
cd ~/repos/gh/pi-shell-acp
pnpm install
pi install ./
./run.sh install /path/to/your-project
./run.sh smoke-all /path/to/your-project
```

### Codex backend

```bash
pnpm add -g @zed-industries/codex-acp@0.12.0
./run.sh smoke-codex /path/to/your-project
```

### Gemini backend

```bash
pnpm add -g @google/gemini-cli
gemini   # one-time interactive login (oauth-personal) or set GEMINI_API_KEY
./run.sh smoke-gemini /path/to/your-project
```

The Gemini path uses the same `--acp` flag the Gemini CLI exposes natively — pi-shell-acp does not bundle a separate `*-acp` server package for Gemini the way it does for Claude/Codex, since the gemini CLI binary itself is the ACP server. Operators install the CLI globally (PATH-resolved at spawn time) and authenticate with their preferred method (`oauth-personal` for the Google subscription path, `gemini-api-key` for `GEMINI_API_KEY`, `vertex-ai`, or `gateway`). Override the launch command via `GEMINI_ACP_COMMAND` for `gemini --acp --debug` or wrapper scripts; bridge args (`--admin-policy <overlay>/policies/admin.toml`) are appended to the override too — the same pattern as `CODEX_ACP_COMMAND`, so tool-surface narrowing always wins.

**Surface isolation (closed 2026-05-03 baseline).** Gemini CLI does not expose `*_CONFIG_DIR`-shaped env knobs, but it does honor `GEMINI_CLI_HOME` (`homedir()` swap) and `GEMINI_SYSTEM_MD` (native system-body file replacement). pi-shell-acp pins both at `~/.pi/agent/gemini-config-overlay/` (mirror of `CLAUDE_CONFIG_DIR` / `CODEX_HOME`). Five channels closed, baseline-verified:

- **L1 — native system body**: `GEMINI_SYSTEM_MD = <overlay>/system.md` replaces the bundled "Instruction and Memory Files" body. The overlay file always carries a canary line (`GEMINI_SYSTEM_MD_CANARY_PISHELLACP_V1`); a baseline operator can ask the model to quote it to confirm the carrier reaches the same prompt slot as Claude's `_meta.systemPrompt` and Codex's `developer_instructions`. 2026-05-03 baseline: model classified the canary under "actual system prompt (Developer Instruction)".
- **L2 — operator memory path**: `GEMINI_CLI_HOME` redirect closes Gemini's native `~/.gemini/tmp/<cwd-slug>/memory/MEMORY.md`. (Earlier baseline reading of `tmp/junghan/` was a `Storage.getProjectIdentifier()` cwd slug, not a username field — the closure handles both readings.)
- **L3 — tool surface**: `tools.core` 7-name allow + `--admin-policy` deny-all + same 7-name allow at priority tier 5.x. The 7 names are the read-class capability split (`read_file`, `list_directory`, `glob`, `grep_search`) + `write_file` + `replace` + `run_shell_command` — same 4 capability classes as Claude `Read/Bash/Edit/Write`, Gemini-specific naming. 2026-05-03 baseline: all 4 read-class tools invoke without `denied by admin policy`.
- **L4 — `GEMINI.md` hierarchical discovery**: `context.fileName` sentinel + `memoryBoundaryMarkers: []` + `includeDirectoryTree: false` suppress the cwd → parent → home walk. Baseline: model reports no `GEMINI.md` awareness.
- **MCP whitelist**: `mcp.allowed: [pi-tools-bridge, session-bridge]` + `excluded: ["*"]`. Baseline: model sees only those two.

**Documented asymmetry — MCP function-schema advertise.** Gemini ACP accepts the bridge's stdio MCP servers via `mcpServers`, but does *not* register them as model-visible function-schema entries the way Claude and Codex do. Models route MCP calls through `run_shell_command` (CLI invocation) rather than direct function calls. This is a Gemini ACP surface property, not something the overlay can close — recorded here so operators do not assume entwurf/semantic-memory appears as native function schema on the gemini backend.

Backend is inferred from the model: Anthropic models → `claude`, OpenAI models → `codex`, Gemini models → `gemini`. Set `backend` explicitly only when you want to pin it.

### Emacs frontends

pi-shell-acp works from ordinary terminals and from Emacs frontends that launch [pi-coding-agent](https://github.com/dnouri/pi-coding-agent). If your Emacs setup runs a dedicated server socket for agent work, pass the socket name with `--emacs-agent-socket`:

```elisp
(setq pi-coding-agent-extra-args
      '("--entwurf-control" "--emacs-agent-socket" "pi"))
```

The bridge exports the value to ACP children as `PI_EMACS_AGENT_SOCKET` and includes it in the first-user context augment. Skills can then call Emacs without hardcoding a socket name:

```bash
emacsclient -s "${PI_EMACS_AGENT_SOCKET:-server}" --eval '(... )'
```

For terminal sessions, omit the flag or pass `--emacs-agent-socket server` explicitly.

### Settings

Recommended reference shape for a pi-shell-acp development session lives in [`pi/settings.reference.json`](./pi/settings.reference.json):

```json
{
  "compaction": {
    "enabled": false
  },
  "piShellAcpProvider": {
    "appendSystemPrompt": false,
    "settingSources": [],
    "strictMcpConfig": true,
    "showToolNotifications": true,
    "tools": ["Read", "Bash", "Edit", "Write"],
    "skillPlugins": [],
    "permissionAllow": ["Read(*)", "Bash(*)", "Edit(*)", "Write(*)", "mcp__*"],
    "mcpServers": {
      "pi-tools-bridge": {
        "command": "/path/to/pi-shell-acp/mcp/pi-tools-bridge/start.sh",
        "args": []
      },
      "session-bridge": {
        "command": "/path/to/pi-shell-acp/mcp/session-bridge/start.sh",
        "args": []
      }
    }
  }
}
```

`mcpServers` is the **only** way to inject MCP servers into ACP sessions — explicit allowlist, no ambient config scanning. `./run.sh install` pre-populates the bundled `pi-tools-bridge` and `session-bridge` entries with the correct local paths. Invalid entries fail fast with `McpServerConfigError`.

`appendSystemPrompt: false` is intentional. Do not use it to deliver pi / AGENTS context; that context is delivered through the first-user pi context augment. Setting it true can put a large custom string into Claude's `_meta.systemPrompt` carrier and may route Claude Code OAuth sessions to metered "extra usage" billing.

Backend is inferred from the selected model. Set `backend` only when you intentionally want to pin one backend.

#### Operating-surface contract — Claude backend

Claude keeps its model/API identity, but pi-shell-acp replaces the Claude Code preset with the optional, short engraving via `_meta.systemPrompt = <string>` when engraving is configured. The hard-wired Claude Agent SDK identity prefix remains. Rich pi context is not delivered here; it rides the first-user pi context augment.

| Field | Default | Purpose |
|-------|---------|---------|
| `tools` | `["Read", "Bash", "Edit", "Write"]` | Match pi's declared 4-tool baseline. `Skill` is auto-added when `skillPlugins` is non-empty. |
| `settingSources` | `[]` | Do not inherit user/project/local Claude Code settings unless explicitly opted in. |
| `strictMcpConfig` | `true` | Only `piShellAcpProvider.mcpServers` reaches the backend. |
| `skillPlugins` | `[]` | Explicit Claude plugin roots (`.claude-plugin/plugin.json` + `skills/*/SKILL.md`). |
| `permissionAllow` | `["Read(*)", "Bash(*)", "Edit(*)", "Write(*)", "mcp__*"]` | Allow the declared tool surface without flipping the operator's native Claude Code defaults. |
| `disallowedTools` | deferred Claude Code tool set | Keep deferred tools (`Task*`, `Cron*`, `Web*`, etc.) from appearing outside pi's declared surface. |

`CLAUDE_CONFIG_DIR` points to a pi-owned whitelist overlay (`~/.pi/agent/claude-config-overlay/`) so auth/runtime state remains available while operator memory, hooks, agents, history, local settings, and project memory stay hidden by default. An explicitly exported `CLAUDE_CONFIG_DIR` wins.

#### Operating-surface contract — Codex backend

Codex has no `_meta.systemPrompt` lane, so pi-shell-acp uses codex-rs `-c` flags. When engraving is configured, it is delivered as `-c developer_instructions="<...>"`. Rich pi context is delivered separately through the first-user pi context augment.

| Flag / setting | Default | Purpose |
|---|---|---|
| `approval_policy` | `never` | Autonomous pi-style operation. |
| `sandbox_mode` | `danger-full-access` | Let pi skills read workspace-external state when needed. |
| `model_auto_compact_token_limit` | `i64::MAX` | Disable silent codex auto-compaction. |
| `web_search` | `disabled` | Use pi's explicit web surfaces instead. |
| `codexDisabledFeatures` | `image_generation`, `tool_suggest`, `tool_search`, `multi_agent`, `apps`, `memories` | Fail closed on tools/memory surfaces that would bypass pi's declared MCP/tool model. |

`PI_SHELL_ACP_CODEX_MODE=auto|read-only` narrows the default mode; invalid values throw. `codexDisabledFeatures: []` opts out of the fail-closed feature gate and emits a warning.

`CODEX_HOME` and `CODEX_SQLITE_HOME` point to `~/.pi/agent/codex-config-overlay/`. The overlay keeps auth/runtime entries and codex state DBs, but hides operator history, rules, top-level `AGENTS.md`, personal config, sessions, logs, and memories. Exported `CODEX_HOME` / `CODEX_SQLITE_HOME` win.

Known codex limit: some native tools are registered by codex-rs without config gates (`update_plan`, `request_user_input`, `view_image`, MCP resource readers). pi-shell-acp documents this mismatch; closing it requires codex-rs changes.

#### Operating-surface contract — Gemini backend

Gemini ACP exposes neither `_meta.systemPrompt` nor a `-c developer_instructions` equivalent, but the gemini CLI honors `GEMINI_SYSTEM_MD = <path>` which fully replaces the native system body with the file content. pi-shell-acp authors that file inside the overlay and pins the env at it, so the engraving reaches gemini through the same kind of full-replacement carrier as Claude and Codex — file rather than string, but identical in role.

| Layer | Setting | Purpose |
|---|---|---|
| Carrier | `GEMINI_SYSTEM_MD = <overlay>/system.md` | Replace native system body with operator engraving + carrier-isolation canary line |
| Config root | `GEMINI_CLI_HOME = ~/.pi/agent/gemini-config-overlay/` | Redirect `homedir()` so the binary reads from the pi-owned overlay, never from operator's `~/.gemini/` |
| Tool registry + policy | `tools.core` 7-name allow + `--admin-policy` deny-all + same 7-name allow | 4 capability classes (Read-class split into `read_file`/`list_directory`/`glob`/`grep_search`, plus `write_file` / `replace` / `run_shell_command`) — defense in depth at registry and policy layers |
| Memory / context | `context.fileName: <sentinel>` + `memoryBoundaryMarkers: []` + `includeDirectoryTree: false` | Suppress `GEMINI.md` cwd → parent → home discovery and cwd dir-tree auto-attach |
| MCP allowlist | `mcp.allowed: ["pi-tools-bridge","session-bridge"]` + `mcp.excluded: ["*"]` | Only bridge-injected stdio MCPs surface to the model |
| Misc closure | `agents.overrides.<id>.enabled: false` (10 subagents), `useWriteTodos: false`, `skills.enabled: false`, `hooksConfig.enabled: false`, `security.folderTrust.enabled: false`, `advanced.autoConfigureMemory: false` | Close gemini surfaces pi does not surface |

Auth files (`oauth_creds.json`, `google_accounts.json`, `installation_id`, `mcp-oauth-tokens-v2.json`) are surfaced via symlink from the operator's real `~/.gemini/`; everything else (history, projects.json, tmp memory, settings.json with operator prefs, trustedFolders.json) is overlay-private. The overlay is rebuilt on every gemini session bootstrap (idempotent). Explicit `GEMINI_CLI_HOME` export wins, mirroring `CLAUDE_CONFIG_DIR` / `CODEX_HOME`.

`PI_SHELL_ACP_GEMINI_CONTEXT=<int>` lets operators inline a tighter context cap when the registry's reported window (1M for `gemini-3-flash-preview`) is more than the workflow needs. Mirrors `PI_SHELL_ACP_CLAUDE_CONTEXT`.

Tool/permission notifications (`[tool:start]`, `[tool:done]`, `[permission:*]`) are enabled in the reference config because this repo is usually debugged by watching ACP-side tool activity. Set `showToolNotifications: false` for quieter day-to-day sessions.

`compaction.enabled: false` disables pi's auto-compaction switch and removes the TUI `(auto)` footer indicator. See **Compaction policy** below for the full gate.

Authentication is handled by Claude Code / claude-agent-acp; pi-shell-acp adds no separate auth layer.

### Smoke commands

```bash
./run.sh smoke-all .        # triple-backend gate (gemini auto-skips if `gemini` not on PATH)
./run.sh smoke-claude .     # Claude only
./run.sh smoke-codex .      # Codex only
./run.sh smoke-gemini .     # Gemini only
./run.sh verify-resume .    # cross-process continuity with acpSessionId diagnostics
```

### Reference consumer

For a real production setup — skills, prompts, themes on top of pi-shell-acp — see [agent-config](https://github.com/junghan0611/agent-config).

## Entwurf Orchestration

`pi-shell-acp` owns the **entwurf** surface — sync/async spawn, resume, target registry, identity preservation, and the MCP/Unix-socket bridges that let pi sessions and ACP sessions reach one another.

| Path | Purpose |
|------|---------|
| `pi-extensions/entwurf.ts` | pi-native entwurf spawn (sync + async, Phase 0.5) |
| `pi-extensions/lib/entwurf-core.ts` | shared core: registry resolution + Identity Preservation Rule |
| `pi-extensions/entwurf-control.ts` | Unix-socket control plane. Ingested from [Armin Ronacher's `agent-stuff`](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0). |
| `pi/entwurf-targets.json` | SSOT allowlist of `(provider, model)` spawn targets |
| `mcp/pi-tools-bridge/` | MCP adapter (agent-facing): `entwurf`, `entwurf_resume`, `entwurf_send`, `entwurf_peers` |
| `mcp/session-bridge/` | Claude Code ↔ pi session bridge (wire-compatible with entwurf-control) |

The same surface is split between agent-callable MCP tools and operator-callable slash commands. Both share the same `~/.pi/entwurf-control/` socket directory; the agent path is auto-attached, the slash path is an explicit `--entwurf-control` opt-in:

| Surface | Audience | Examples |
|---|---|---|
| MCP tools (above) | the agent (LLM tool calls) | `entwurf_send`, `entwurf_peers` |
| Slash commands (require `--entwurf-control`) | the operator (interactive pi session) | `/entwurf <task>`, `/entwurf-status`, `/entwurf-sessions` (lists peers with cwd / model / idle), `/entwurf-send <index\|sessionId> <message>` |

Full narrative and migration history: [`AGENTS.md` § Entwurf Orchestration](./AGENTS.md).

## Context carriers

pi-shell-acp intentionally separates **system/developer carriers** from **rich pi context**.

### Engraving

`prompts/engraving.md` is an optional operator-authored personal surface. Keep it short. Empty or missing engraving files are skipped.

- Claude carrier: `_meta.systemPrompt = <string>` → string-form preset replacement. This carrier must stay small; large custom system prompts can route Claude Code OAuth sessions to metered "extra usage" billing.
- Codex carrier: `-c developer_instructions="<...>"` at child spawn time → codex's developer-role config slot.
- Gemini carrier: `GEMINI_SYSTEM_MD = <overlay>/system.md` → file replacement of native system body. File equivalent of Claude `_meta.systemPrompt` and Codex `developer_instructions`; the overlay always appends a carrier-isolation canary line (`GEMINI_SYSTEM_MD_CANARY_PISHELLACP_V1`) so a baseline operator can verify the file actually reaches the model's system prompt slot.
- A/B: `PI_SHELL_ACP_ENGRAVING_PATH=/path/to/alt.md`.

### First-user pi context augment

Bridge identity, pi operating context, `~/AGENTS.md`, `cwd/AGENTS.md`, and date/cwd are delivered as a one-shot first user-message prepend, not through the system-prompt carrier. This keeps the Claude subscription-sensitive carrier small while making both Claude ACP and Codex ACP actually receive the operator/project instructions.

The augment describes capabilities, not guaranteed function names. The **actual callable tool schema exposed in the session is the source of truth**:

- Native pi may expose `read` / `bash` / `edit` / `write`.
- Claude ACP may expose `Read` / `Bash` / `Edit` / `Write` / `Skill`.
- Codex ACP may expose lower-level tools such as `exec_command`, `apply_patch`, `write_stdin`, and `update_plan`.
- MCP/custom tools are usable only when they appear in the actual tool schema. Do not assume a tool exists only because AGENTS.md or this context mentions it.

Entwurf-spawned first prompts already include `cwd/AGENTS.md` inside `<project-context ...>` tags. The bridge detects that marker and removes only the duplicate cwd AGENTS section from the augment, preserving the home AGENTS, bridge narrative, pi base, and date/cwd context.

## Design

### What this repo owns

- provider registration (`pi-shell-acp/...`)
- ACP subprocess lifecycle + session bootstrap (`resume > load > new`)
- prompt forwarding + ACP event mapping
- entwurf orchestration (spawn, resume, messaging, registry)
- pi-facing MCP injection via `piShellAcpProvider.mcpServers`
- bridge-local cleanup and diagnostics

### What it does not do

- full-history prompt reconstruction
- backend transcript hydration into pi history
- Claude Code / Codex emulation
- broad multi-agent orchestration (entwurf is narrow, registry-gated, identity-locked)
- a second session model competing with pi

### Session persistence

Only `pi:<sessionId>` mappings are persisted at `~/.pi/agent/cache/pi-shell-acp/sessions/`. The bridge persists enough to re-attach pi to the same remote ACP session — it does not ingest backend transcript files. Pi session state is the source of truth for pi UX; backend stores (`~/.claude/`, `~/.codex/`) are interoperability side effects.

### Compaction policy

Rule: **no silent rewrite**. pi-shell-acp cancels every pi-side compaction trigger through `session_before_compact` unless the operator starts the process with `PI_SHELL_ACP_ALLOW_COMPACTION=1`.

Backend guards mirror that policy:

- Claude Code: `DISABLE_AUTO_COMPACT=1` and `DISABLE_COMPACT=1`
- Codex: `-c model_auto_compact_token_limit=9223372036854775807`

The footer uses the ACP backend's `usage_update.used / size`, not pi's visible-transcript estimate. That number can be larger than the visible chat because the backend counts its own prompt, tools, cache, and session state. Each turn also emits `[pi-shell-acp:usage] ...` with raw component values and whether the meter came from `usage_update` or the fallback component sum.

Operationally: when the backend window is near its limit, choose a visible action — clear, opt into compaction, switch to a wider-context model, or in 0.5.0 use recap-as-new-question.

### Backend capability notes

The three backends are intentionally symmetric where the protocol allows. Claude Code is the primary daily-use ACP target; Codex was added to evaluate the bridge's ACP boundary against a non-Anthropic backend; Gemini joined as a third independent ACP server with the same shape of operator-config isolation overlay and tool-surface narrowing. Where the protocol forces an asymmetry (e.g. carrier surface — Claude has `_meta.systemPrompt`, Codex has `-c developer_instructions`, Gemini has `GEMINI_SYSTEM_MD` file), the table calls it out explicitly rather than papering over it.

| Capability | Claude Code | Codex | Gemini CLI |
|---|---|---|---|
| ACP subprocess | `claude-agent-acp` | `codex-acp` | `gemini --acp` (CLI binary's own ACP mode) |
| Continuity path | `resumeSession` when available | `loadSession` when available | `loadSession` when available (no `resumeSession` advertised) |
| Engraving delivery | `_meta.systemPrompt = <string>` (preset replacement, in-protocol) | `-c developer_instructions="<...>"` (developer-role injection, child arg) | `GEMINI_SYSTEM_MD = <overlay>/system.md` (file replacement of native body, env+file) |
| Config overlay | `CLAUDE_CONFIG_DIR` whitelist + `autoMemoryEnabled: false` + empty `projects/`, `sessions/` | `CODEX_HOME` + `CODEX_SQLITE_HOME` whitelist + empty `memories/`, `sessions/`, `log/`, `shell_snapshots/` + binary-managed `state_5.sqlite*` / `logs_2.sqlite*` | `GEMINI_CLI_HOME` whitelist + 14 settings keys (subagents off, skills/hooks/folder-trust/write_todos off, `tools.core` 7-name capability split, `mcp.allowed` 2 + `excluded:["*"]`, `context.fileName` sentinel + `memoryBoundaryMarkers:[]`) + empty `tmp/`, `history/`, `projects/` + binary-managed `state.json`, `projects.json` |
| Tool surface narrowing | `tools: ["Read","Bash","Edit","Write"]` (+`Skill` when configured) + `disallowedTools` (deferred Claude tools) | `codexDisabledFeatures: image_generation, tool_suggest, tool_search, multi_agent, apps, memories` (+ `-c features.<key>=false`) | `tools.core` 7-name allow + `--admin-policy` deny-all + same 7-name allow at priority tier 5.x. Capability classes: Read = `read_file`/`list_directory`/`glob`/`grep_search`, Write = `write_file`, Edit = `replace`, Exec = `run_shell_command` |
| Hierarchical memory file discovery | n/a — Claude Code does not auto-load `CLAUDE.md` chain in the bridge | n/a — codex does not advertise an equivalent | `GEMINI.md` cwd → parent → home discovery suppressed via `context.fileName` sentinel + `memoryBoundaryMarkers: []` + `includeDirectoryTree: false` |
| MCP injection (transport) | `piShellAcpProvider.mcpServers` | `piShellAcpProvider.mcpServers` | `piShellAcpProvider.mcpServers` (stdio passthrough; Gemini also advertises http/sse capability for non-pi MCPs but the bridge does not surface them) |
| MCP function-schema advertise | yes — MCP tools registered as `mcp__<server>__<tool>` function entries | yes — MCP tools registered as `mcp__<server>__<tool>` function entries | **no** — Gemini ACP accepts MCP servers via `mcpServers` but does not register them as model-visible function-schema entries; models route through `run_shell_command` instead. Documented asymmetry, not closable from the overlay |
| Backend auto-compaction | disabled by default (`DISABLE_AUTO_COMPACT=1` + `DISABLE_COMPACT=1`) | disabled by default (`-c model_auto_compact_token_limit=i64::MAX`; appended to `CODEX_ACP_COMMAND` override path too) | n/a — Gemini ACP exposes no equivalent toggle; pi remains the single context-management authority by default |
| Operator context cap override | `PI_SHELL_ACP_CLAUDE_CONTEXT=<int>` | covered by codex-acp's own narrowing (272K) | `PI_SHELL_ACP_GEMINI_CONTEXT=<int>` |

`PI_SHELL_ACP_ALLOW_COMPACTION=1` strips only the compaction-guard env vars (`DISABLE_AUTO_COMPACT`, `DISABLE_COMPACT`); identity-isolation env (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, `GEMINI_CLI_HOME`, `GEMINI_SYSTEM_MD`) stays regardless — those are invariants required by the operator-config-isolation design, not policy choices the compaction toggle controls.

## Repository Layout

| File | Purpose |
|------|---------|
| `index.ts` | provider registration, settings, shutdown |
| `acp-bridge.ts` | ACP lifecycle, cache, `resume > load > new` |
| `event-mapper.ts` | ACP updates → pi events |
| `engraving.ts` + `prompts/engraving.md` | optional operator personal engraving carrier |
| `pi-context-augment.ts` | one-shot first-user pi context augment (`~/AGENTS.md`, cwd AGENTS, bridge narrative, date/cwd) |
| `protocol.js` | dependency-free shared wire constants (`<project-context` marker). Single source for both tsc-emit and Node `--experimental-strip-types` paths. |
| `run.sh` | install, smoke, verify, sentinel |
| `pi-extensions/` | entwurf spawn + control plane + shared core |
| `pi/entwurf-targets.json` | default entwurf target allowlist |
| `mcp/pi-tools-bridge/` | pi-side tools → ACP hosts |
| `mcp/session-bridge/` | Claude Code ↔ pi session bridge |

## References

- [xenodium/agent-shell](https://github.com/xenodium/agent-shell) — Emacs ACP client, `resume > load > new` idea origin
- [agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) — canonical ACP server for Claude Code
- [agentclientprotocol](https://github.com/agentclientprotocol) — ACP protocol organization
- [junghan0611/agent-config](https://github.com/junghan0611/agent-config) — real consumer repo

## Real-world usage

The maintainer uses pi-shell-acp for most pi work unless a task needs a different harness. Public examples are ordinary working repos, not benchmarks.

- [junghan0611/legoagent-config](https://github.com/junghan0611/legoagent-config) — a small Lego/child-oriented project that also serves as a low-stakes daily testbed for pi-shell-acp.

## Roadmap

- **0.4.x — Documentation / evidence calibration.** Keep README, AGENTS.md, CHANGELOG.md, BASELINE.md, and VERIFY.md aligned with the current carrier design and Evidence Levels / Claims Ledger. Session-level verification data is published incrementally to [`junghanacs/pi-shell-acp-sessions`](https://huggingface.co/datasets/junghanacs/pi-shell-acp-sessions) using a dogfood-friendly fork at [`junghan0611/pi-share-hf`](https://github.com/junghan0611/pi-share-hf) (originally [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf)). The verification model is dogfooding: pi-shell-acp's own sessions are redacted and reviewed by pi-shell-acp's own provider surface, not by an external API key, so ACP-bridge behaviour can be reviewed at the session-record level, not only as narrative.
- **0.5.0 — Visible recap-as-new-question and provider handoff.** Replace silent compaction with explicit recap as the long-session strategy. Long sessions should end with a structured, operator-visible recap that seeds a fresh session, rather than a silently rewritten transcript. The same mechanism should cover model/provider switches: native pi providers share pi's visible transcript, but `native → pi-shell-acp` crosses into a separate ACP backend session, so the new backend does not automatically know the earlier native conversation. 0.5.0 should add an explicit handoff recap for these transitions instead of hidden transcript hydration. The design must specify who generates the recap, where it is stored, how the old ACP mapping is closed, how provider-switch handoff is triggered, and how VERIFY.md proves no hidden transcript hydration occurred.
- **0.6.0 — OpenClaw native provider.** Drop-in like ACPx — built-in provider, no extra ACP command surface, no entwurf needed (OpenClaw uses pi natively, so the bridge only has to wire the provider; the rest is pi's existing tool model).

## Verification surfaces

Two complementary documents, not redundant:

- **[VERIFY.md](./VERIFY.md)** — agent-driven. One ACP-bridged identity runs the script against another and records what it sees. Carries the Evidence Levels L0–L5 rung ladder and a Claims Ledger so each claim is parked at the rung it has actually reached.
- **[BASELINE.md](./BASELINE.md)** — operator-driven. Junghan runs the interview himself (no agent in the verifier seat) and the result is recorded. Companion to VERIFY.md — VERIFY exercises agent↔agent symmetry; BASELINE keeps a human's direct read on the same surfaces.

Use both. Either one alone leaves a blind spot the other closes.

## Upstream Dependencies

pi-shell-acp depends on a small upstream surface. Bugs are normal there as they are here — we run into them, defend locally, sometimes they resolve upstream on their own, sometimes we send a fixture-backed PR. Either is fine.

We don't send anecdote PRs. Fixtures first.

For agent-facing programs the rule is fail-loud, not warn-then-continue: silently-dropped errors get reframed by agents as "ok, moved on", which breaks operator visibility. Local mitigation follows the same rule — coerce + surface, or throw, never swallow.

Tracked issues:

| Date | Package | Issue | Status | Fixtures |
|---|---|---|---|---|
| 2026-04-29 | `@agentclientprotocol/claude-agent-acp@0.31.0` | `Read` tool maps `input.offset` into ACP `locations[].line` without coercion. When the model emits a non-numeric offset (e.g. string range `"1010, 1075"`), the notification fails ACP SDK 0.20.0 zod validation (`-32602 Invalid params`) and is silently dropped by the SDK. Session survives; operator follow-along on that tool call breaks. | observed; mitigation TODO marker in `acp-bridge.ts` at the transport creation site | 1 |

## Status

Public, active development. The maintainer uses pi as his primary coding environment; this ACP bridge is working code, but it is still being proven through daily use.

## License

MIT
