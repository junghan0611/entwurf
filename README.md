# pi-shell-acp

Use Claude Code, Codex, and Gemini CLI through Agent Client Protocol (ACP) backends inside pi.

> **Status: Public, active development.**
> This is real working code, but it is still young. Expect issues and verify it in your own workflow before relying on it all day.
>
> **Evidence calibration.** Claims about identity, tool visibility, and native-quality behaviour are tracked in [VERIFY.md](./VERIFY.md). Current public evidence is strongest at L1–L2 for identity/tool wiring; 8-hour/day native-quality claims remain unmeasured until L4/L5 runs.

![pi-shell-acp demo](docs/assets/pi-shell-acp-demo.gif)

`pi-shell-acp` connects pi to Claude Code, Codex, and Gemini CLI through ACP — no OAuth proxy, no CLI transcript scraping, no Claude Code emulation. Backends keep identity; the bridge shapes only the pi-facing operating surface.

```text
pi
  -> pi-shell-acp
    -> claude-agent-acp | codex-acp | gemini --acp
      -> Claude Code | Codex | Gemini CLI
```

> **Direction note.** `pi-shell-acp` is the reverse of [`pi-acp`](https://github.com/svkozak/pi-acp): `pi-acp` lets external ACP clients talk *to* pi; `pi-shell-acp` lets pi talk *to* ACP backends.


## How to Read This Project

If words like *entwurf* or *engraving* feel unusual for a coding tool, this is the map.

- **Problem**: Claude Code subscribers had no official way to use that subscription inside pi. Proxy / CLI-wrapper paths were fragile or policy-sensitive.
- **Solution**: use ACP, the protocol path Zed uses for Claude Code. Pi stays the harness; each backend stays itself.
- **Codex / Gemini**: Codex verifies the ACP boundary against a non-Anthropic backend; Gemini CLI contributes its own `--acp` server. Release migration detail belongs in CHANGELOG, not the README top.
- **Entwurf**: not “delegate.” It means projection/draft: a sibling with its own runtime boundary, not a worker under a master.
- **Engraving**: optional short operator text in the backend's highest identity carrier. Rich pi context now rides the first-user augment to keep subscription-sensitive carriers small.
- **Daily use**: friction compounds over a workday, so VERIFY.md records edge cases instead of relying on vibes.

## History — How We Got Here

Before this bridge: OAuth proxy proved chat is easy but tools are not; stateless SDK accumulation degraded quality; `pi-claude-code-use` proved native-level feel; CLI wrapping exposed policy fragility. `pi-shell-acp` chooses ACP because it is protocol-level, turn-aware, and session-persistent.

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
pnpm add -g @zed-industries/codex-acp@0.13.0
./run.sh smoke-codex /path/to/your-project
```

### Gemini backend

```bash
pnpm add -g @google/gemini-cli
gemini   # one-time interactive login (oauth-personal) or set GEMINI_API_KEY
./run.sh smoke-gemini /path/to/your-project
```

The `gemini` binary is the ACP server; `GEMINI_ACP_COMMAND` may override launch, with bridge args (`--acp`, `--admin-policy`) appended. The curated Gemini ACP model is subscription-backed `pi-shell-acp/gemini-3.1-pro-preview`. Overlay/evidence details live in the Gemini operating-surface section, CHANGELOG 0.4.8/0.4.9, and BASELINE.md.

Backend is inferred from the model: Anthropic → `claude`, OpenAI → `codex`, Gemini → `gemini`; set `backend` only to pin.

### Emacs frontends

pi-shell-acp works from ordinary terminals and from Emacs frontends that launch [pi-coding-agent](https://github.com/dnouri/pi-coding-agent). If your Emacs setup runs a dedicated server socket for agent work, pass the socket name with `--emacs-agent-socket`:

![pi-shell-acp in Doom Emacs](docs/assets/pi-shell-acp-doomemacs.gif)

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

`mcpServers` is the **only** ACP MCP injection path: explicit allowlist, no ambient config scanning. `./run.sh install` writes bundled `pi-tools-bridge` / `session-bridge`; invalid entries fail fast with `McpServerConfigError`.

`appendSystemPrompt: false` is intentional. Pi / AGENTS context rides the first-user augment; putting it into Claude `_meta.systemPrompt` can trigger metered "extra usage" billing.

#### Operating-surface contract — Claude backend

Claude keeps model/API identity. Optional short engraving replaces the Claude Code preset via `_meta.systemPrompt=<string>`; the hard-wired Claude Agent SDK identity prefix remains. Rich pi context rides the first-user augment.

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

Codex has no `_meta.systemPrompt`, so pi-shell-acp uses codex-rs `-c` flags. Engraving becomes `-c developer_instructions="<...>"`; rich pi context still rides the first-user augment.

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

Gemini exposes neither `_meta.systemPrompt` nor `developer_instructions`, but honors `GEMINI_SYSTEM_MD=<path>` as full native-system-body replacement. pi-shell-acp authors that overlay file, so engraving reaches the same role by file rather than string.

| Layer | Setting | Purpose |
|---|---|---|
| Carrier | `GEMINI_SYSTEM_MD = <overlay-home>/.gemini/system.md` | Replace native system body with operator engraving + carrier-isolation canary line |
| Config root | `GEMINI_CLI_HOME = ~/.pi/agent/gemini-config-overlay/` | Redirect `homedir()` so the binary reads from the pi-owned overlay, never from operator's `~/.gemini/` |
| Tool registry + policy | `tools.core` 7-name allow + `--admin-policy` deny-all + same 7-name allow | 4 capability classes (Read-class split into `read_file`/`list_directory`/`glob`/`grep_search`, plus `write_file` / `replace` / `run_shell_command`) — defense in depth at registry and policy layers |
| Memory / context | `context.fileName: <sentinel>` + `memoryBoundaryMarkers: []` + `includeDirectoryTree: false` | Suppress `GEMINI.md` cwd → parent → home discovery and cwd dir-tree auto-attach |
| MCP allowlist | `mcp.allowed: ["pi-tools-bridge","session-bridge"]` + `mcp.excluded: ["*"]` | Only bridge-injected stdio MCPs surface to the model |
| Memory containment (L5) | `experimental.memoryV2:false`, `experimental.autoMemory:false`, spawn-sweep `<configDir>/{tmp,history,projects}/`, stale-cleanup root `GEMINI.md`/`MEMORY.md`, U+200B defuse for engraving `${...}` | pi is canonical memory authority (semantic-memory + Denote llmlog). Gemini memory files do not survive across sessions; affected engraving literals are visually stable but byte-split so gemini-cli cannot interpolate them. |
| Misc closure | subagents / skills / hooks / folder-trust / write_todos / auto-memory all off via `settings.json` | Close gemini surfaces pi does not surface (full 16-key list in CHANGELOG 0.4.9) |

Gemini symlinks only auth/runtime files (`oauth_creds.json`, `google_accounts.json`, `installation_id`, `mcp-oauth-tokens-v2.json`) from real `~/.gemini/`; history, projects, tmp memory, prefs, and trust state are overlay-private. Overlay rebuilds every bootstrap. Exported `GEMINI_CLI_HOME` wins.

`PI_SHELL_ACP_GEMINI_CONTEXT=<int>` lets operators inline a tighter context cap when the registry's reported window (1M for `gemini-3.1-pro-preview`) is more than the workflow needs. Mirrors `PI_SHELL_ACP_CLAUDE_CONTEXT`.

Tool/permission notifications are on in reference config for ACP debugging; set `showToolNotifications:false` for quiet sessions. `compaction.enabled:false` hides pi auto-compaction UI; the provider also blocks compaction below. Auth stays with the backend; pi-shell-acp adds no auth layer.

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

`pi-shell-acp` owns **entwurf**: sync/async spawn, resume, target registry, identity preservation, and MCP/Unix-socket bridges between pi and ACP sessions.

| Path | Purpose |
|------|---------|
| `pi-extensions/entwurf.ts` / `lib/entwurf-core.ts` | pi-native spawn + shared registry / Identity Preservation Rule |
| `pi-extensions/entwurf-control.ts` | Unix-socket control plane (from Armin Ronacher's `agent-stuff`, Apache 2.0) |
| `pi/entwurf-targets.json` | SSOT spawn target allowlist |
| `mcp/pi-tools-bridge/` | agent-facing MCP tools: `entwurf*`, `entwurf_peers` |
| `mcp/session-bridge/` | Claude Code ↔ pi session bridge |

Agent MCP tools auto-attach; operator slash commands require `--entwurf-control` (`/entwurf`, `/entwurf-status`, `/entwurf-sessions`, `/entwurf-send`). Full narrative: [`AGENTS.md` § Entwurf](./AGENTS.md).

## Context carriers

pi-shell-acp intentionally separates **system/developer carriers** from **rich pi context**.

### Engraving

`prompts/engraving.md` is optional short operator text; empty/missing files are skipped. Carriers: Claude `_meta.systemPrompt`, Codex `developer_instructions`, Gemini `GEMINI_SYSTEM_MD=<overlay>/.gemini/system.md` with canary `GEMINI_SYSTEM_MD_CANARY_PISHELLACP_V1`. A/B via `PI_SHELL_ACP_ENGRAVING_PATH=/path/to/alt.md`. Keep it short; large Claude carriers can route OAuth sessions to metered "extra usage" billing.

### First-user pi context augment

Bridge identity, pi context, `~/AGENTS.md`, `cwd/AGENTS.md`, and date/cwd are delivered as one-shot first-user prepend, not system carrier. It describes capabilities; the **actual callable schema is source of truth** (`read` vs `Read` vs `exec_command`, MCP only when schema-visible). Entwurf prompts already include `cwd/AGENTS.md` in `<project-context ...>`; the bridge removes only that duplicate.

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

The footer uses ACP `usage_update.used / size` (backend prompt/tools/cache/session included), with `[pi-shell-acp:usage] ...` diagnostics. Near limit, choose a visible action: clear, opt into compaction, switch model, or in 0.5.0 use recap-as-new-question.

### Backend capability notes

The three backends share the same operating-surface shape (carrier, overlay, tool narrowing, MCP injection); each row calls out where the protocol forces a different concrete mechanism.

| Capability | Claude Code | Codex | Gemini CLI |
|---|---|---|---|
| ACP subprocess | `claude-agent-acp` | `codex-acp` | `gemini --acp` (CLI binary's own ACP mode) |
| Continuity path | `resumeSession` when available | `loadSession` when available | `loadSession` when available |
| Engraving carrier | `_meta.systemPrompt` (string, in-protocol) | `-c developer_instructions` (child arg) | `GEMINI_SYSTEM_MD` (file replacing native body) |
| Config overlay | `CLAUDE_CONFIG_DIR` | `CODEX_HOME` + `CODEX_SQLITE_HOME` | `GEMINI_CLI_HOME` + `settings.json` 16-key closure (suppresses `GEMINI.md` discovery + L5 memory containment) |
| Tool surface narrowing | `tools` allowlist + `disallowedTools` | `codexDisabledFeatures` + `-c features.*` | `tools.core` allowlist + `--admin-policy` deny-all + class allow (4 Read-class names + Write/Edit/Exec) |
| MCP injection | `piShellAcpProvider.mcpServers` | `piShellAcpProvider.mcpServers` | `piShellAcpProvider.mcpServers` (transport accepted; see asymmetry below) |
| Backend auto-compaction | `DISABLE_AUTO_COMPACT=1` + `DISABLE_COMPACT=1` | `-c model_auto_compact_token_limit=i64::MAX` | n/a — no equivalent toggle |
| Operator context cap override | `PI_SHELL_ACP_CLAUDE_CONTEXT=<int>` | covered by codex-acp's own narrowing (272K) | `PI_SHELL_ACP_GEMINI_CONTEXT=<int>` |

**Documented asymmetry — Gemini MCP function-schema advertise.** Gemini ACP accepts MCP servers via `mcpServers` but does not register them as model-visible function-schema entries the way Claude and Codex do. Models route MCP calls through `run_shell_command` instead. Not closable from the overlay; see CHANGELOG 0.4.8 + BASELINE.md for the verification context.

**Memory containment (L5).** Backend memory persistence is silenced; pi owns memory (semantic-memory + Denote llmlog). Gemini's sixth channel closure is in CHANGELOG 0.4.9 + BASELINE 2026-05-06.

`PI_SHELL_ACP_ALLOW_COMPACTION=1` strips only compaction guards, never identity-isolation env (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, `GEMINI_CLI_HOME`, `GEMINI_SYSTEM_MD`).

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

- **0.4.x — Documentation / evidence calibration.** Keep README, AGENTS.md, CHANGELOG.md, BASELINE.md, and VERIFY.md aligned. Publish redacted session-level evidence to [`junghanacs/pi-shell-acp-sessions`](https://huggingface.co/datasets/junghanacs/pi-shell-acp-sessions) via [`junghan0611/pi-share-hf`](https://github.com/junghan0611/pi-share-hf).
- **0.5.0 — Visible recap-as-new-question, provider handoff, and backend residue cleanup.** Replace silent compaction with explicit, operator-visible recaps. Cover long sessions and `native → pi-shell-acp` provider switches without hidden transcript hydration. Close the Gemini session-end residual window (`tmp/<slug>/chats/session-*.jsonl`, `history/<slug>/.project_root`, overlay-private `projects.json`) with an explicit cleanup path rather than waiting for the next spawn sweep.
- **0.6.0 — OpenClaw native provider.** Drop-in native pi provider; no extra ACP command surface and no entwurf needed.

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
