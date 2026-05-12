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

- **Problem**: Claude Code subscribers had no stable, protocol-backed way to use that subscription inside pi. Proxy / CLI-wrapper paths were fragile or policy-sensitive.
- **Solution**: use ACP, the protocol path Zed uses for Claude Code. Pi stays the harness; each backend stays itself.
- **Codex / Gemini**: not because pi cannot run other models. Codex support is an intentional quality probe for the ACP backend path itself: if the bridge only feels correct with Claude, the bridge is not proven. Non-Claude backends keep each backend's native identity and asymmetry visible while testing the same pi-facing operating-surface discipline. Gemini CLI contributes its own `--acp` server. Release migration detail belongs in CHANGELOG, not the README top.
- **Entwurf**: not “delegate.” It means projection/draft: a sibling with its own runtime boundary, not a worker under a master.
- **Engraving**: optional short operator text in the backend's highest identity carrier. It is not a giant hidden prompt and not a tool catalog. Rich pi context now rides the first-user augment to keep subscription-sensitive carriers small.
- **MCP**: explicit bridge-injected tool servers only. MCP is not ambient context scanning, not automatic retrieval, and not proof that every backend exposes identical literal tool names.
- **Daily use**: friction compounds over a workday, so VERIFY.md records edge cases instead of relying on vibes.

### Common misreads to avoid

- `pi-shell-acp` is **not** the harness runtime; pi is the harness. This repo is a thin ACP provider/bridge.
- ACP here means a protocol path and backend subprocess contract, not a marketing claim that every behavior is “official” or interchangeable.
- Session persistence re-attaches pi to an ACP session; it does not hydrate backend transcripts into pi or make hidden memory authoritative.
- “Same operating surface” means comparable capability classes and explicit boundaries, not identical implementation, identical tools, or forced backend sameness.
- 0.5.0 is not a recap engine and not a compact→new-session handoff. Current focus: split pi-side compaction guards from backend-native compaction guards so backend-owned compaction can be tested without enabling unsafe pi-side JSONL compaction.

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

Recommended reference shape for a pi-shell-acp development session lives in [`pi/settings.reference.json`](./pi/settings.reference.json) (minimal — see the reference file for the full canonical shape including `disallowedTools` and `codexDisabledFeatures`):

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
      }
    }
  }
}
```

`mcpServers` is the **only** ACP MCP injection path: explicit allowlist, no ambient config scanning. `./run.sh install` writes the bundled `pi-tools-bridge` entry only and prunes the legacy bundled `session-bridge` entry from older installs; invalid entries fail fast with `McpServerConfigError`.

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
| Tool registry + policy | `tools.core` 8-name allow + `--admin-policy` deny-all + same 8-name allow | 4 capability classes (Read-class split into `read_file`/`list_directory`/`glob`/`grep_search`, plus `write_file` / `replace` / `run_shell_command`) + `activate_skill` — defense in depth at registry and policy layers |
| Memory / context | `context.fileName: <sentinel>` + `memoryBoundaryMarkers: []` + `includeDirectoryTree: false` | Suppress `GEMINI.md` cwd → parent → home discovery and cwd dir-tree auto-attach |
| MCP allowlist | `mcp.allowed: ["pi-tools-bridge"]` | Only the bundled pi-tools-bridge stdio MCP surfaces to the model in the 0.4.14 release surface |
| Memory containment (L5) | `experimental.memoryV2:false`, `experimental.autoMemory:false`, spawn-sweep `<configDir>/{tmp,history,projects}/`, stale-cleanup root `GEMINI.md`/`MEMORY.md`, U+200B defuse for engraving `${...}` | pi is canonical memory authority (semantic-memory + Denote llmlog). Gemini memory files do not survive across sessions; affected engraving literals are visually stable but byte-split so gemini-cli cannot interpolate them. |
| Misc closure | subagents / hooks / folder-trust / write_todos off via `settings.json`; skills stay on through `activate_skill` + `~/.gemini/skills/` passthrough | Close gemini surfaces pi does not surface without re-closing the skill channel reopened in 0.4.11 |

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

### Custom Skills

Add custom skills to a Claude session through the `skillPlugins` setting. **`skillPlugins` is a Claude-backend-only install surface.** Codex and Gemini expose skills through their native `~/.codex/skills/` and `~/.gemini/skills/` passthrough instead; `skillPlugins` is not consulted by those backends.

#### Minimum plugin shape

A `skillPlugins` entry must point at an absolute path to a directory containing the Claude Agent SDK plugin layout:

```
<your-plugin-root>/
├── .claude-plugin/
│   └── plugin.json          # required — metadata manifest
└── skills/
    └── <skill-name>/
        └── SKILL.md         # one per skill, YAML frontmatter + body
```

A self-contained minimum example lives in [`pi/skill-plugin-example/`](./pi/skill-plugin-example/). Copy that directory anywhere on disk, point `skillPlugins` at the absolute path, and replace the `hello` skill with your own.

#### Where to put the directory

Anywhere on disk; the bridge does not constrain the location, only that the path is absolute. Suggested: keep plugin roots under your own project tree (`<your-project>/.claude-plugin/...`) or under `~/.config/pi-skills/<plugin-name>/`. **Do not** place plugin roots under `~/.pi/agent/` — that path is pi's internal cache area, not a consumer-facing convention.

#### Settings shape

```json
{
  "piShellAcpProvider": {
    "skillPlugins": [
      "/absolute/path/to/your-plugin-root"
    ]
  }
}
```

`Skill` is auto-added to `tools` and `Skill(*)` to `permissionAllow` whenever `skillPlugins` is non-empty.

#### Fail-fast contract

The bridge validates each `skillPlugins` entry at settings parse time and throws when:

- the path is not absolute
- the path does not exist or is not a directory
- the directory is missing `.claude-plugin/plugin.json`

The Claude session does not start until the violation is fixed. This matches [§Code Principle](./AGENTS.md#code-principle--crash-dont-warn) (`crash, don't warn`): a malformed plugin must surface as a malformed plugin, not as a silently-missing skill.

The bridge does not validate the contents of `plugin.json` or the bodies of `SKILL.md` files — those are the Claude Agent SDK's contract.

#### Verifying install

After updating `skillPlugins`, start a fresh Claude session and ask the model to list its available skills. The skill names declared in your `SKILL.md` frontmatter should **appear among the visible skills** in the response (alongside any other built-in or operator-installed skills — the model is not expected to return only your skills). For the operator-driven version of this check see [VERIFY.md §1A `Q-SKILL-CALLABLE`](./VERIFY.md).

### Reference consumer

The minimum install for skills is documented in §Custom Skills above. For an example of how a real consumer arranges many skills, prompts, and themes on top of pi-shell-acp, see [agent-config](https://github.com/junghan0611/agent-config). Its directory layout — for instance the `~/.pi/agent/claude-plugin/` location — is agent-config's own convention, not a pi-shell-acp contract.

## Entwurf Orchestration

`pi-shell-acp` owns **entwurf**: sync/async spawn, resume, target registry, identity preservation, and MCP/Unix-socket bridges between pi and ACP sessions.

| Path | Purpose |
|------|---------|
| `pi-extensions/entwurf.ts` / `lib/entwurf-core.ts` | pi-native spawn + shared registry / Identity Preservation Rule |
| `pi-extensions/entwurf-control.ts` | Unix-socket control plane (from Armin Ronacher's `agent-stuff`, Apache 2.0) |
| `pi/entwurf-targets.json` | SSOT spawn target allowlist |
| `mcp/pi-tools-bridge/` | agent-facing MCP tools: `entwurf`, `entwurf_resume`, `entwurf_send`, `entwurf_peers`, `entwurf_self` |

0.4.14 retracts the old `session-bridge` sidecar and unifies cross-session messaging on one MCP surface: `pi-tools-bridge` only. `entwurf_self` absorbs the old self-introspection role; live messaging stays on `entwurf_send` / `entwurf_peers`.

Live peer messaging (`entwurf_send`, `/entwurf-send`, in-process tool) now carries a sender envelope by default: `{ sessionId, agentId, cwd, timestamp }`. `PI_SESSION_ID` and `PI_AGENT_ID` are routed structurally into the backend child and the MCP stdio entry, so Codex/Gemini do not depend on ambient env inheritance. Startup one-shot CLI keeps sender info opt-in (`--entwurf-send-include-sender-info`) because the sender process exits immediately and should not imply a reply path.

Reply hint marker is now `wants_reply` (renamed from `reply_requested`, default flipped from true to false): an etiquette field on the message, not a transport contract — no wait, no polling. Receiver renders a `(wants reply)` badge only when sender opts in.

The human-greeted 담당자 pattern is first-class in this release: the operator may open a pi-shell-acp session in repo B, greet it directly, then pass that `sessionId` to another session via `entwurf_send`. Spawned siblings and human-opened peers share the same messaging semantics; only the creation sequence differs.

Model switch on the reuse path now respawns instead of mutating in place. School × model is one identity, so a reused MCP child with stale `PI_AGENT_ID` is invalid by construction.

Agent MCP tools auto-attach; operator slash commands require `--entwurf-control` (`/entwurf`, `/entwurf-status`, `/entwurf-sessions`, `/entwurf-send`). Full narrative: [`AGENTS.md` § Entwurf](./AGENTS.md).

### Recorded demo

A two-pane tmux session covers the entwurf surface end-to-end: Scene 1 spawns a sibling and plants a fact, Scene 2 resumes it via MCP `entwurf_resume` (cross-process, cross-cwd) and recalls the fact, Scene 3 sends a greeting to a live peer with `entwurf_send`. This recording is also the regression evidence for [#9](https://github.com/junghan0611/pi-shell-acp/issues/9) — the cross-cwd resume hydration fix verified through the same flow.

<details>
<summary>Watch (518×1030 GIF, click to expand)</summary>

![entwurf demo](./docs/assets/pi-shell-acp-entwurf.gif)

</details>

Reproduce + debug docs: [`demo/README.md`](./demo/README.md).

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
- Gemini CLI: n/a — no equivalent toggle

The footer uses ACP `usage_update.used / size` (backend prompt/tools/cache/session included), with `[pi-shell-acp:usage] ...` diagnostics. Near limit, choose a visible action: clear, switch model, or opt into the appropriate compaction layer. 0.5.0's current focus is splitting pi-side compaction guards from backend-native compaction guards so backend-owned compaction can be tested without enabling unsafe pi-side JSONL compaction.

### Backend capability notes

The three backends share the same operating-surface shape (carrier, overlay, tool narrowing, MCP injection); each row calls out where the protocol forces a different concrete mechanism.

| Capability | Claude Code | Codex | Gemini CLI |
|---|---|---|---|
| ACP subprocess | `claude-agent-acp` | `codex-acp` | `gemini --acp` (CLI binary's own ACP mode) |
| Continuity path | `resumeSession` when available | `loadSession` when available | `loadSession` when available |
| Engraving carrier | `_meta.systemPrompt` (string, in-protocol) | `-c developer_instructions` (child arg) | `GEMINI_SYSTEM_MD` (file replacing native body) |
| Config overlay | `CLAUDE_CONFIG_DIR` | `CODEX_HOME` + `CODEX_SQLITE_HOME` | `GEMINI_CLI_HOME` + `settings.json` 16-key closure (suppresses `GEMINI.md` discovery + L5 memory containment) |
| Tool surface narrowing | `tools` allowlist + `disallowedTools` | `codexDisabledFeatures` + `-c features.*` | `tools.core` allowlist (Read-class split + Write/Edit/Exec + `activate_skill`) + `--admin-policy` deny-all + class allow |
| Skill install surface (declarative) | `skillPlugins` → `.claude-plugin/plugin.json` plugin roots (see §Custom Skills) | not exposed by pi-shell-acp — use `~/.codex/skills/` passthrough | not exposed by pi-shell-acp — use `~/.gemini/skills/` passthrough |
| Skill runtime callable surface | `Skill` tool + `~/.claude/skills/` passthrough | `~/.codex/skills/` passthrough | `activate_skill` + `~/.gemini/skills/` passthrough |
| MCP injection | `piShellAcpProvider.mcpServers` | `piShellAcpProvider.mcpServers` | `piShellAcpProvider.mcpServers` (merged into `settings.merged.mcpServers` by `acpSessionManager.newSessionConfig`; advertised by `discoverMcpTools` via the same path as native `tools.core`) |
| Backend auto-compaction | `DISABLE_AUTO_COMPACT=1` + `DISABLE_COMPACT=1` | `-c model_auto_compact_token_limit=i64::MAX` | n/a — no equivalent toggle |
| Operator context cap override | `PI_SHELL_ACP_CLAUDE_CONTEXT=<int>` | covered by codex-acp's own narrowing (272K) | `PI_SHELL_ACP_GEMINI_CONTEXT=<int>` |

**Capability parity restored — Gemini skill + MCP advertise (0.4.11).** Earlier baselines (0.4.8 / 0.4.9) recorded a "Gemini MCP function-schema advertise asymmetry"; that reading has been retracted. The asymmetry was overlay-induced, not upstream: `tools.core` excluded `activate_skill`, `skills.enabled` was pinned `false`, and `~/.gemini/skills/` was not on the passthrough whitelist. MCP parity also needed a Gemini admin-policy fix: `mcpName` had to match gemini-cli's string-only schema, and invocation ultimately converged on `mcpName = "*"` with the real per-server whitelist enforced one layer earlier by `settings.mcp.allowed` / `canLoadServer`. With the advertise + invocation channels reopened, Gemini gets the same skill + MCP capability dignity as Claude and Codex through its own native surfaces — `activate_skill` for skill activation, `discoverMcpTools` for MCP function-schema registration, and direct MCP invocation through the bridged path. See CHANGELOG 0.4.11 + BASELINE 2026-05-07 for the verification context.

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
| `mcp/pi-tools-bridge/` | pi-side tools → ACP hosts (`entwurf`, `entwurf_resume`, `entwurf_send`, `entwurf_peers`, `entwurf_self`) |

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
- **0.5.0 — Backend-native compaction escape hatch.** Keep unsafe pi-side JSONL compaction blocked by default, split the current broad compaction knob into pi-side vs backend-native guards, and verify backend-owned compaction through normal ACP prompt/update flow. This is not a recap engine and not compact→new-session handoff.
- **Later — Compact→new-session handoff, provider handoff, backend residue cleanup, and deeper OpenClaw tuning.** These are real follow-up areas, but not 0.5.0. Do not let them dilute the guard-split work.

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
| 2026-04-29 | `@agentclientprotocol/claude-agent-acp@0.31.0 → 0.33.1` | `Read` tool maps `input.offset` into ACP `locations[].line` without coercion. When the model emits a non-numeric offset (e.g. string range `"1010, 1075"`), the notification fails ACP SDK 0.20.0 zod validation (`-32602 Invalid params`) and is silently dropped by the SDK. Session survives; operator follow-along on that tool call breaks. | re-checked 2026-05-08 against `0.33.1`: `src/tools.ts:181` still emits `line: input.offset ?? 1` with no coercion; no upstream issue or PR filed. mitigation TODO marker in `acp-bridge.ts` at the transport creation site retained. | 1 |

## Next

Current priority and open decisions live in [NEXT.md](./NEXT.md). Read it at session start so this repo always knows what comes next. For 0.5.0, NEXT.md is authoritative: compaction guard split / backend-native compaction escape hatch, not recap hint slot.

## Status

Public, active development. The maintainer uses pi as his primary coding environment; this ACP bridge is working code, but it is still being proven through daily use.

## License

MIT
