# pi-shell-acp

> **Successor project:** `pi-shell-acp` continues as [`@junghanacs/entwurf`](https://www.npmjs.com/package/@junghanacs/entwurf) / [github.com/junghan0611/entwurf](https://github.com/junghan0611/entwurf). The new `entwurf` package is the 0.12+ line: the same work, renamed around the garden-citizen dispatch substrate rather than the pi adapter. Use `npm:@junghanacs/entwurf` for new installs.

Use Claude Code and Codex through Agent Client Protocol (ACP) inside pi — and make native Claude Code sessions garden-addressable peers.

![pi-shell-acp — a reproducible agent harness for pi](docs/assets/pi-shell-acp-hero.jpg)

[![npm](https://img.shields.io/npm/v/@junghanacs/pi-shell-acp.svg?logo=npm&label=%40junghanacs%2Fpi-shell-acp)](https://www.npmjs.com/package/@junghanacs/pi-shell-acp) · maintained by [junghanacs.com](https://junghanacs.com/)

> **Public, active development.** Real working code, still young. Verify it in your own workflow before relying on it all day. Evidence calibration: [VERIFY.md](./VERIFY.md); native async-delivery capability levels: [DELIVERY.md](./DELIVERY.md).

> **0.11.0** is a compatibility-preserving Stage 0 for [`entwurf_v2`](#entwurf_v2--additive-dispatch-verb-0110): the pi-only dispatch substrate now proves live control-socket send (including record-less socket-only pi sessions) and spawn-bg resident resume, while the v1 verbs remain available by default and `PI_SHELL_ACP_V2_ONLY=1` is a staging hard-refusal mode. Claude Code tmux-live and the broader Entwurf extraction stay in the next lane.

![pi-shell-acp demo](docs/assets/pi-shell-acp-demo.gif)

```text
pi
  → pi-shell-acp
    → claude-agent-acp | codex-acp
      → Claude Code | Codex
```

`pi-shell-acp` is a thin ACP provider for pi: no OAuth proxy, no CLI transcript scraping, no Claude Code emulation. It connects pi to locally authenticated ACP backends with no core patch and no bypass. Each backend keeps its own model, API, and tool semantics; the bridge shapes only the pi-facing operating surface.

**0.10.0 expands the bridge beyond ACP transport.** The same narrow surface now also fronts native Claude Code sessions: a global `SessionStart` hook registers each native Claude session as a **garden-native meta-session** with a garden id, a mailbox, and a trusted sender marker. That makes an already-running Claude Code terminal addressable through `entwurf_send`, self-identifying through `entwurf_self`, and replyable by garden id — without turning pi into a second harness or importing Claude's transcript. ACP is one transport; the durable address is the garden id.

```text
native Claude Code
  → SessionStart hook
    → meta-session <garden-id>
      → pi-tools-bridge MCP
        → entwurf_self | entwurf_send | entwurf_inbox_read
```

For 0.10.0 this meta-bridge installer/doctor is **Claude Code only**. Codex and Antigravity delivery probes are recorded in [DELIVERY.md](./DELIVERY.md) as future adapter evidence, not shipped install surfaces.

> **Direction.** Inverse of [`pi-acp`](https://github.com/svkozak/pi-acp). `pi-acp` lets external ACP clients talk *to* pi; `pi-shell-acp` lets pi talk *to* ACP backends — and, from 0.10.0, lets native Claude Code sessions join the same garden-id messaging surface.

> **Project boundary.** `pi-shell-acp` is not a fork, plugin, dependency, or integration layer of `oh-my-pi`, and it is not developed in coordination with `oh-my-pi`. Issues in other Pi / ACP projects may be useful as general implementation references, but they are not `pi-shell-acp` integration issues unless this repository explicitly links them as such.

> **Anthropic subscription billing.** From 2026-06-15, Anthropic third-party agent paths (ACP, Agent SDK, `claude -p`, pi-shell-acp's Claude backend) consume a separate Agent SDK credit pool, distinct from Claude chat and the `claude` CLI used as an interactive terminal. `pi-shell-acp` respects that distinction — no bypass, no emulation — and preserves capability dignity across supported backends (see [AGENTS.md](./AGENTS.md) invariants #7, #9, #10). The recommended default runtime leans toward paths outside Anthropic's Agent SDK metering, with Claude invoked when its quality is worth the credit cost. The operator decides the mix.

> **Gemini CLI migration.** Google announced that Gemini CLI stops serving requests for Google AI Pro / Ultra and unpaid individual tiers on **2026-06-18**; those users should migrate to [Antigravity CLI](https://antigravity.google/product/antigravity-cli). See Google's migration note: [Transitioning Gemini CLI to Antigravity CLI](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/). The repository still carries existing Gemini adapter code for compatibility, but this README no longer presents Gemini CLI as a recommended setup path during the migration window.

## Concept primer

A few words that look unusual for a coding tool.

- **Entwurf** (기투, projection-of-self) — sibling sessions with their own runtime boundary. Not "delegate," not "worker," not "sub-agent." Spawn, resume, and live peer messaging are first-class.
- **Engraving** — optional short operator text delivered through each backend's native identity carrier. Not a giant hidden prompt, not a tool catalog.
- **MCP** — in this repo, MCP is just the transport by which ACP-backed sessions receive pi capabilities that native pi exposes directly as extensions. It is not a general MCP platform. Explicit `piShellAcpProvider.mcpServers` only; no ambient `~/.mcp.json` scanning, no automatic retrieval. The same `pi-tools-bridge` entry can also be wired into another host's MCP catalog (Claude Code, Codex, Antigravity, …) when the operator chooses. `entwurf_self` returns an authoritative pi-session or trusted meta-session identity envelope; `entwurf_send` can deliver from plain external MCP hosts, but only pi-session and trusted meta-session senders are replyable.
- **Session persistence** — re-attaches pi to the same remote ACP session. Does not hydrate backend transcripts into pi history.

## Install

`pi-shell-acp` is a thin ACP bridge — it connects pi to a local Claude or Codex backend the operator has already installed and authenticated. The bridge does not provide Claude credentials, tokens, or subscription access, and does not bypass any backend auth. Whatever the operator's local `claude` / `codex` already trusts is what pi-shell-acp uses.

`pi` accepts four install sources for the bridge — `npm:` or `git:`, each in **global** (default, writes to `~/.pi/agent/settings.json`) or **project** (`-l` flag, writes to `.pi/settings.json`) scope. A fifth path is a local clone for hacking on the bridge.

After installing the package, run `run.sh install .` in your target project. The script writes the `piShellAcpProvider` block into `.pi/settings.json` with the correct absolute path for `pi-tools-bridge/start.sh` — no hand-editing required. The exact location of `run.sh` depends on which install path was used (each section below shows it). For manual configuration, [`pi/settings.reference.json`](./pi/settings.reference.json) is the reference shape — see [Settings](#settings) below.

### From npm — global

```bash
pi install npm:@junghanacs/pi-shell-acp
cd /path/to/your-project
"$(npm root -g)/@junghanacs/pi-shell-acp/run.sh" install .
"$(npm root -g)/@junghanacs/pi-shell-acp/run.sh" smoke-all .
```

### From npm — project (`-l` flag)

```bash
cd /path/to/your-project
pi install -l npm:@junghanacs/pi-shell-acp
./.pi/npm/node_modules/@junghanacs/pi-shell-acp/run.sh install .
./.pi/npm/node_modules/@junghanacs/pi-shell-acp/run.sh smoke-all .
```

### From source via pi — global (alternative)

```bash
pi install git:github.com/junghan0611/pi-shell-acp
cd /path/to/your-project
~/.pi/agent/git/github.com/junghan0611/pi-shell-acp/run.sh install .
~/.pi/agent/git/github.com/junghan0611/pi-shell-acp/run.sh smoke-all .
```

### From source via pi — project (`-l` flag)

```bash
cd /path/to/your-project
pi install -l git:github.com/junghan0611/pi-shell-acp
./.pi/git/github.com/junghan0611/pi-shell-acp/run.sh install .
./.pi/git/github.com/junghan0611/pi-shell-acp/run.sh smoke-all .
```

### Local development clone

```bash
git clone https://github.com/junghan0611/pi-shell-acp ~/repos/gh/pi-shell-acp
cd ~/repos/gh/pi-shell-acp
pnpm install
pi install ./
./run.sh install /path/to/your-project
./run.sh smoke-all /path/to/your-project
```

> **First time on a clean Ubuntu / Debian / macOS host?** See the [clean-host walk-through](./docs/setup-clean-host.md) — Stages 0–4b verified end-to-end: `nvm` + `pnpm` + `pi` install, `pi install git:...`, `run.sh install .`, missing-auth boundary surface, and authenticated runtime smoke for Claude / Codex.

> **Two independent post-install checks.** `run.sh smoke-all .` proves *provider registration + backend runtime* (the bridge loads and Claude answers — `smoke-all` is the claude-only floor as of 0.11.0; verify Codex on demand with `smoke-codex`). It does **not** exercise Entwurf's package-source routing. If you delegate to a `provider=pi-shell-acp` Entwurf target from a package-installed setup (`git:` / `npm:` source, not a local checkout), also run `run.sh smoke-installed-entwurf-acp` — it confirms the installed bridge resolves so an Entwurf child does not die with `Unknown provider "pi-shell-acp"` (#29). The resolver math behind it is pinned deterministically by `run.sh check-package-source-routing`, which runs inside `pnpm check` and the release gate.

> The OpenClaw plugin sibling at [`plugins/openclaw`](https://github.com/junghan0611/pi-shell-acp/tree/main/plugins/openclaw) is **deprecated and unmaintained** as of 2026-06-10. It is not part of the root `pi-shell-acp` install above — see [Host adapters](#host-adapters).

> **Extension set — do not filter.** `pi-shell-acp` ships four `pi.extensions` entries as a single set: the provider extension (`index.ts`) plus three `pi-extensions/*.ts` modules (entwurf, entwurf-control, model-lock). Filtering some out via pi's object-form package configuration can leave the model lock or entwurf surface in a broken state. Disable the entire package or none of it unless you know precisely which boundary you are turning off.

### Backend prerequisites

Claude / Codex ACP server packages (`@agentclientprotocol/claude-agent-acp`, `@zed-industries/codex-acp`) ship as pinned `dependencies` of `pi-shell-acp`; backend authentication still belongs to the operator's local CLI / runtime. Once the bridge is installed, the resolver picks the ACP server in this order:

1. **`CLAUDE_AGENT_ACP_COMMAND` / `CODEX_ACP_COMMAND` env override** — explicit override for an alternative binary or a wrapper command.
2. **`require.resolve(...)` against the bundled package dependency** — `@agentclientprotocol/claude-agent-acp` for Claude, `@zed-industries/codex-acp` for Codex. This is the default path; no extra global install needed.
3. **`PATH:claude-agent-acp` / `PATH:codex-acp` fallback** — used when the package resolution fails (e.g. a hand-edited `node_modules`).

Codex smoke (no global install required — the codex-acp pinned in `dependencies` is resolved automatically):

```bash
./run.sh smoke-codex /path/to/your-project
```

To force a global `codex-acp` (PATH fallback or development override):

```bash
pnpm add -g @zed-industries/codex-acp@0.15.0
```

Backend is inferred from the model — Anthropic → `claude`, OpenAI → `codex`. Set `backend` only to pin.

### Host adapters

This repo also carries `plugins/*` — sibling packages that adapt the same bridge to non-pi hosts. Currently:

- [`plugins/openclaw`](https://github.com/junghan0611/pi-shell-acp/tree/main/plugins/openclaw) — OpenClaw plugin, published on npm as [`@junghan0611/openclaw-pi-shell-acp`](https://www.npmjs.com/package/@junghan0611/openclaw-pi-shell-acp) (`0.0.1`). **Deprecated and unmaintained** as of 2026-06-10 — the npm version is marked deprecated and the source is frozen for reference.

Each adapter has its own `README.md`. They do not change the pi-facing surface above.

### Emacs frontends

Works from terminals and from Emacs frontends that launch [pi-coding-agent](https://github.com/dnouri/pi-coding-agent).

![pi-shell-acp in Doom Emacs](docs/assets/pi-shell-acp-doomemacs.gif)

For a dedicated agent socket, pass the socket name:

```elisp
(setq pi-coding-agent-extra-args
      '("--entwurf-control" "--emacs-agent-socket" "pi"))
```

The bridge exports the socket name to ACP children as `PI_EMACS_AGENT_SOCKET`, so skills call Emacs without hardcoding:

```bash
emacsclient -s "${PI_EMACS_AGENT_SOCKET:-server}" --eval '(...)'
```

## Settings

Reference shape lives in [`pi/settings.reference.json`](./pi/settings.reference.json). Minimum:

```json
{
  "compaction": { "enabled": false },
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

`mcpServers` is the only ACP MCP injection path. In practice this repo is about the bundled `pi-tools-bridge`, which carries pi capabilities into ACP-backed sessions — not about being a general MCP catalog. Invalid entries throw `McpServerConfigError` — broken tool state surfaces as broken tool state. `./run.sh install` writes the bundled `pi-tools-bridge` entry and prunes the legacy bundled `session-bridge` entry from older installs.

`appendSystemPrompt: false` is intentional. Pi / AGENTS context rides the first-user augment; putting it into the Claude `_meta.systemPrompt` carrier can route OAuth sessions to metered "extra usage" billing.

### Wiring `pi-tools-bridge` into an external MCP host

`pi-tools-bridge` can also be registered in a separate MCP-aware harness (Claude Code, Codex CLI, Antigravity/`agy`, …). That host does **not** become a pi session and does **not** need to be ACP-backed. There are now two honest cases:

- **plain external MCP host**: no garden meta-record / sender marker. It can call tools, but its sender envelope is external/non-replyable.
- **garden-native meta-session**: the native `SessionStart` hook minted a garden id and wrote a trusted sender marker. It is not a pi control-socket session, but it **is replyable by garden id**.

**Which verb an external agent should reach for (0.11.0):** to deliver to / reply to a garden id, use **`entwurf_v2`** — it is the canonical delivery surface and the only one that reads the target's type (live pi vs. dormant pi vs. Claude Code meta-session, which a bare garden id does not reveal) and routes correctly. **Do not default to `entwurf_send` for an arbitrary garden id** — it is the lower-level direct control-socket compat tool, and poking a live-socket transport at a Claude Code meta-session that needs the mailbox is exactly the failure mode `entwurf_v2` exists to prevent. Fresh sibling creation remains v1 `entwurf`. Installing the bridge wires *both* the v1 verbs and `entwurf_v2`; the rule is **send/reply → `entwurf_v2`, create → v1 `entwurf`.**

Observed 2026-05-28: Claude Code, Codex CLI, and Antigravity CLI all successfully called `entwurf` and then `entwurf_resume` through this MCP bridge against `gpt-5.4`. In all three plain external-host cases, sync result delivery was the correct baseline. Meta-sessions keep that sync baseline for `entwurf_resume` (no pi followUp channel), but `entwurf_send` is symmetric/replyable over the mailbox once sender identity is proven.

Prerequisites on the host running the external MCP client:

- `pi` on PATH (for `entwurf` / `entwurf_resume` spawn paths).
- `~/.pi/agent/entwurf-targets.json` (target registry) when calling `entwurf`.
- A live pi session launched with `--entwurf-control` populates `~/.pi/entwurf-control/<sessionId>.sock`; required for `entwurf_send` and `entwurf_peers`.

> **PATH boundary.** MCP servers are often launched by GUI/editor daemons and may not inherit the interactive shell's PATH. If `pi` works in your terminal but external-host `entwurf` fails with `spawn pi ENOENT`, pass a full PATH in the MCP server `env`, set `PI_TOOLS_BRIDGE_ENV_FILE` to a small shell file that exports PATH, or point the host at a wrapper that can find `pi`. `start.sh` sources only the explicit `PI_TOOLS_BRIDGE_ENV_FILE`; it never reads personal dotfiles automatically.

Example env file:

```bash
# ~/.config/pi-tools-bridge/env.sh
export PATH="$HOME/.local/share/pnpm:$HOME/.local/bin:$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
```

Then add it to the external MCP config:

```json
{
  "env": {
    "PI_TOOLS_BRIDGE_ENV_FILE": "/home/operator/.config/pi-tools-bridge/env.sh",
    "PI_TOOLS_BRIDGE_EXTERNAL_AGENT_ID": "external-mcp/claude-code"
  }
}
```

Emergency/manual workaround when the MCP server environment is wrong but an existing entwurf session must be resumed: run `pi --session /path/to/entwurf.jsonl ...` from an interactive shell whose PATH is known-good. Treat this as a debug escape hatch, not a replacement for fixing the MCP launch environment.

External/meta-session semantics:

- `entwurf` works directly and returns the sync spawn result inline.
- `entwurf_resume` defaults to sync for plain external hosts **and** meta-sessions; explicit `mode="async"` is rejected unless the caller is a replyable pi control-socket session, because completion followUp needs a pi session address.
- `entwurf_send` from a plain external host delivers with `origin: "external-mcp"` / `replyable: false`; `wants_reply: true` is rejected.
- `entwurf_send` from a trusted meta-session delivers with `origin: "meta-session"` / `replyable: true`; `wants_reply: true` is allowed and the receiver can reply to the sender's garden id.
- `entwurf_self` returns the same authoritative identity for pi sessions **and** trusted meta-sessions. A plain external host with no pi env and no trusted sender marker still fails because there is no reply address to report.

#### Claude Code

Claude Code supports both CLI registration and a separated global MCP config. The separated file is recommended for dotfile / `agent-config` workflows because `~/.claude.json` also carries OAuth-bearing state.

**Option A — CLI add:**

```bash
claude mcp add --scope user pi-tools-bridge \
  bash /absolute/path/to/pi-shell-acp/mcp/pi-tools-bridge/start.sh
```

This writes the entry into `~/.claude.json`'s top-level `mcpServers`. Good for one-off setup; do not version-control the resulting `~/.claude.json`.

**Option B — separated `~/.mcp.json`:**

```json
{
  "mcpServers": {
    "pi-tools-bridge": {
      "type": "stdio",
      "command": "bash",
      "args": [
        "/absolute/path/to/pi-shell-acp/mcp/pi-tools-bridge/start.sh"
      ],
      "env": {
        "PI_TOOLS_BRIDGE_EXTERNAL_AGENT_ID": "external-mcp/claude-code"
      }
    }
  }
}
```

Claude Code reads `~/.mcp.json` in addition to `~/.claude.json`'s top-level `mcpServers`. The `env` block identifies the calling host on the receiver render — omit it and `entwurf_send` shows `external-mcp/unknown-host`. If Claude Code permissions are locked down, allow `mcp__*` or `mcp__pi-tools-bridge__*` in `~/.claude/settings.json`.

#### Codex CLI

Add the server to `~/.codex/config.toml`:

```toml
[mcp_servers.pi-tools-bridge]
command = "/absolute/path/to/pi-shell-acp/mcp/pi-tools-bridge/start.sh"
```

#### Antigravity CLI (`agy`)

Documented global config path:

```text
~/.gemini/antigravity-cli/mcp_config.json
```

Current runtime-compatible path also observed:

```text
~/.gemini/config/mcp_config.json
```

Use the same server entry in either file:

```json
{
  "mcpServers": {
    "pi-tools-bridge": {
      "command": "/absolute/path/to/pi-shell-acp/mcp/pi-tools-bridge/start.sh"
    }
  }
}
```

#### External-host skills and commands

MCP registration gives the external harness the tools; the host still needs workflow guidance. Put the Mitsein-over-MCP (cross-harness collaboration) rules in that host's instruction file or, when supported, as a host-native skill. Do not assume pi slash commands are portable across external hosts — if a workflow must work across Claude Code, Codex CLI, Antigravity, and future hosts, make it a skill or MCP tool rather than a command shortcut.

For the maintained multi-harness setup and skill/command packaging details, see `agent-config`. See also the MCP entry in [Concept primer](#concept-primer), the sender envelope contract in [AGENTS.md](./AGENTS.md), and [Custom skills](#custom-skills) for the in-pi ACP skill surface.

## Per-backend operating surface

Each backend keeps its native model / API / tools; pi-shell-acp shapes only what enters from pi. Claude and Codex honor explicit `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `CODEX_SQLITE_HOME` exports when set by the operator.

**Claude** uses `_meta.systemPrompt` for engraving and `CLAUDE_CONFIG_DIR` for a whitelist overlay so auth/runtime entries stay available while operator memory, hooks, agents, history, local settings, and project memory remain hidden. The overlay writes an explicit empty `hooks: {}` because Claude SDK organic compaction needs the configured-empty shape; no operator hook definitions are inherited. The four-tool baseline (`Read`, `Bash`, `Edit`, `Write`) is enforced through `tools` + `permissionAllow`; `Skill` is added automatically when `skillPlugins` is non-empty. Operator context cap override: `PI_SHELL_ACP_CLAUDE_CONTEXT=<int>`.

**Codex** has no `_meta.systemPrompt`, so engraving rides codex-rs `-c developer_instructions="<...>"`. Defaults: `approval_policy=never`, `sandbox_mode=danger-full-access`, `web_search=disabled`. `codexDisabledFeatures` (default: `image_generation`, `tool_suggest`, `tool_search`, `multi_agent`, `apps`, `memories`) fails closed on surfaces that would bypass pi's MCP/tool model; `codexDisabledFeatures: []` opts out and emits a warning. `PI_SHELL_ACP_CODEX_MODE=auto|read-only` narrows the default mode. `CODEX_HOME` + `CODEX_SQLITE_HOME` point at a pi-owned overlay that keeps auth/runtime entries and codex state DBs but hides operator history, rules, top-level `AGENTS.md`, personal config, sessions, logs, and memories. codex-rs registers some native tools (`update_plan`, `request_user_input`, `view_image`, MCP resource readers) without config gates; pi-shell-acp documents this mismatch — closing it requires codex-rs changes.

Pi is the canonical memory authority (semantic-memory + Denote llmlog); Claude and Codex native memory layers are pinned off.

## Smoke commands

```bash
./run.sh smoke-all .        # claude-only floor (0.11.0); codex via smoke-codex below
./run.sh smoke-claude .
./run.sh smoke-codex .
./run.sh verify-resume .    # cross-process continuity with acpSessionId diagnostics
```

## Custom skills

Claude sessions accept custom skills through `skillPlugins` — an array of absolute paths to directories matching the Claude Agent SDK plugin layout:

```
<your-plugin-root>/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── <skill-name>/
        └── SKILL.md
```

A self-contained example lives at [`pi/skill-plugin-example/`](./pi/skill-plugin-example/). Put plugin roots anywhere on disk except under `~/.pi/agent/` (pi's internal cache).

```json
{
  "piShellAcpProvider": {
    "skillPlugins": ["/absolute/path/to/your-plugin-root"]
  }
}
```

`Skill` is auto-added to `tools` and `Skill(*)` to `permissionAllow` whenever `skillPlugins` is non-empty. Each entry is validated at settings parse time and throws when the path is missing, not absolute, not a directory, or missing `.claude-plugin/plugin.json`. The Claude session does not start until the violation is fixed. The bridge does not validate `plugin.json` contents or `SKILL.md` bodies — that is the Claude Agent SDK's contract.

To verify, start a fresh Claude session and ask the model to list its skills; the names declared in your `SKILL.md` frontmatter should appear among the visible skills. The operator-driven version of this check is `Q-SKILL-CALLABLE` in [VERIFY.md](./VERIFY.md).

`skillPlugins` is a Claude-backend-only install surface. Codex exposes skills through native `~/.codex/skills/` passthrough.

For a real consumer arranging many skills, see [agent-config](https://github.com/junghan0611/agent-config).

## Entwurf orchestration

**Entwurf is a pi capability with two surfaces.** Native pi exposes it directly as an extension tool; ACP-backed sessions reach the same capability through pi-shell-acp's MCP/Unix-socket bridge. The purpose is not to invent a different sub-agent system, but to preserve the same sibling-based model across backends.

Spawning creates a sibling, not a worker, delegate, or sub-agent — the spawned session has its own runtime boundary and its own provider/model identity. Resume preserves model identity (no override). Native pi `entwurf` / `entwurf_resume` default to `async`; `sync` is opt-in for short status checks (<5s). On the MCP bridge, `entwurf` spawn remains sync-only, while `entwurf_resume` uses a conditional default: only pi-session callers with a control socket get async followUp delivery; plain external hosts and garden-native meta-sessions get sync and cannot request async.

A two-pane recording covers the surface end-to-end — sibling spawn, cross-process MCP resume across a different cwd, and a live peer greeting through `entwurf_send`:

<details>
<summary>Watch (518×1030 GIF, click to expand)</summary>

![entwurf demo](./docs/assets/pi-shell-acp-entwurf.gif)

</details>

Live peer messaging (`entwurf_send`, `/entwurf-send`, in-process tool) carries a sender envelope `{ sessionId, agentId, cwd, timestamp }` by default; `entwurf_self` returns the same authoritative envelope for the current pi session or trusted meta-session. Plain external MCP hosts can call `entwurf_send` with a marked non-replyable envelope. Garden-native meta-sessions call it with a trusted `meta-session` envelope and are replyable by garden id. `wants_reply` is an etiquette marker rendered as a `(wants reply)` badge — not a transport contract, no wait, no polling — and is rejected only from non-replyable external senders.

In ACP-backed sessions, agent tools (`entwurf`, `entwurf_resume`, `entwurf_send`, `entwurf_peers`, `entwurf_self`, `entwurf_v2`, `entwurf_inbox_read`) auto-attach through `pi-tools-bridge`; in native pi sessions, the same capability is available directly through the extension surface. **Picking the right verb (0.11.0): for garden-id delivery/reply use `entwurf_v2` (the canonical surface — it classifies the target and routes to live-pi / dormant-resume / Claude-Code-meta-mailbox); `entwurf_send` is the lower-level direct control-socket compat tool (use only with a known live pi socket); fresh sibling creation is v1 `entwurf`. "send/reply → v2, create → v1."** Operator slash commands (`/entwurf`, `/entwurf-status`, `/entwurf-sessions`, `/entwurf-send`) require `--entwurf-control`. The spawn target allowlist is [`pi/entwurf-targets.json`](./pi/entwurf-targets.json).

### `entwurf_v2` — additive dispatch verb (0.11.0)

`entwurf_v2` / `runEntwurfV2` is an **additive** v2 dispatch verb over **existing** garden targets — record-backed citizens plus live socket-only `pi` endpoints (a record-less but live `pi --entwurf-control` peer is a *target*, intentionally **not** an owned citizen). You give a target garden id plus an intent (`fire-and-forget` or `owned-outcome`); one decider reads the target's liveness as a fact (via the `entwurf_peers` fact surface) and picks the transport from a frozen table keyed on **both** the target's state **and** the intent — never on state alone — then reports one outcome under the v2 lock policy (the pi control-socket and spawn-bg paths take a per-target lock; the meta-mailbox path is lock-free but guarded by active-receiver deliverability):

| target state | intent | transport |
|---|---|---|
| live pi | fire-and-forget | control-socket send |
| live pi | owned-outcome | **reject** (a live peer is not an owned spawn target) |
| dormant pi | owned-outcome | spawn-bg resume (a real `pi --entwurf-control` child) |
| dormant pi | fire-and-forget | **reject** (`dormant-fire-forget-unsupported`) |
| active self-fetch receiver | fire-and-forget | meta-mailbox enqueue + doorbell |
| inactive / terminated self-fetch receiver | fire-and-forget | **reject** (`mailbox-undeliverable` — no `.msg`, no doorbell) |
| self-fetch | owned-outcome | **reject** (no owned result over a mailbox) |

**`entwurf_v2` is the canonical surface for garden-id delivery.** When you have a garden id and want to reach whoever it names — message, reply, or hand-off — reach for `entwurf_v2`, **not** `entwurf_send`. A garden id alone does not tell you whether the target is a live pi session, a dormant pi session, or a Claude Code meta-session — they look alike — and `entwurf_v2` is the one surface that reads that and routes correctly; *when unsure which transport, use `entwurf_v2`*. `entwurf_send` is the **lower-level direct control-socket** compatibility tool: use it only when you already hold a known live pi control socket (or for its `get_message`/`clear` debug actions). Defaulting to `entwurf_send` for an unclassified garden id is the wrong move — it is exactly how an agent ends up poking a live-socket transport at a Claude Code meta-session that needs the mailbox. (The deeper convergence — folding `entwurf_send` delivery into `entwurf_v2` and keeping only the debug actions — is a 0.11.x / `entwurf`-repo lane.)

What v2 **newly provides** is exactly this: a **deterministic dispatch substrate** that moves the "which transport?" decision out of the fallible caller/model and into the decider, under a per-target lock, with an honest reject (no `✓ delivered`, no `.msg` garbage) when a target cannot receive. What it does **not** do is **fresh sibling creation** — making a brand-new sibling from a provider/model/prompt is still the v1 `entwurf` verb's job (the `dormant pi → spawn-bg resume` row above resumes an *already-identified* citizen, it does not mint a new one). It does **not** replace the v1 verbs: `entwurf`, `entwurf_resume`, and `entwurf_send` remain available and unchanged. The meta-mailbox row requires an **active** self-fetch receiver; Claude↔Claude / Claude tmux-live transport is **out of scope for 0.11.0** (the contract enum names `tmux-live` but no production path executes it).

A live pi target is addressed by its **control socket**, so a record-less but live `pi --entwurf-control` session (an operator-greeted peer with no meta-record) is accepted as a `fire-and-forget` control-send target, matching what `entwurf_peers` lists as alive. An `owned-outcome` resume, however, needs a record-backed citizen (its cwd/launch authority); a record-less endpoint is a socket-only fire-and-forget target only — record-less dormant resume is out of scope for 0.11.0 (a 0.11.1 lane).

`PI_SHELL_ACP_V2_ONLY=1` is a **staging** switch, not a removal. It hard-refuses every v1 entrypoint so a deployment can rehearse the v2-only world ahead of the **0.12** cutover, but it does not delete or unregister v1 — v1 sibling-create and v1 followUp are intentionally unavailable *under the flag* until 0.12 removes them. 0.11.0 ships v2 as Stage 0 (pi-only substrate); Claude↔Claude live (Stage 1) is out of scope.

> 0.12+ direction: extract an Entwurf core (peer identity / garden id / inbox / liveness / dispatch / replyability / evidence) with per-backend plugins, leaving `pi-shell-acp` as the compatibility adapter. ACP is one plugin, not the boundary. Rationale: [#37](https://github.com/junghan0611/pi-shell-acp/issues/37).

### Garden launcher

A `--entwurf-control` session must be garden-native — its header `id` must be a garden sessionId (`YYYYMMDDTHHMMSS-[0-9a-f]{6}`), not pi's default `uuidv7`. The session id is fixed at launch (pi assigns it before extensions load), so the launcher injects it; `entwurf-control` only enforces. Launch through:

```bash
pi --session-id "$(/path/to/pi-shell-acp/run.sh new-session-id)" \
   --entwurf-control --emacs-agent-socket server
```

`run.sh new-session-id` prints one fresh garden sessionId from the `generateSessionId` SSOT (do not reimplement the format in the shell — it would drift from the validator the guard enforces). An operator alias bakes this in, e.g.:

```bash
pia() { pi --session-id "$(/path/to/pi-shell-acp/run.sh new-session-id)" \
            --entwurf-control --emacs-agent-socket server "$@"; }
```

**Resuming an existing garden session.** `--session-id` is idempotent — pi documents it as *"exact id, creating it if missing"*, so passing an **existing** garden id resumes (appends to) that session, guard and all. Resume by reusing the id, NOT pi's `--session` / `--resume` pickers: those are a separate, mutually-exclusive flag (`--session-id cannot be combined with --session`) and bypass the garden-id discipline. Same flag for new and resume; only the id source differs (a fresh `new-session-id` vs an existing id):

```bash
# resume an existing garden session under --entwurf-control
piar() {
  local sid="$1"; shift
  [ -n "$sid" ] || { echo "usage: piar <garden-session-id> [pi args]" >&2; return 1; }
  pi --session-id "$sid" --entwurf-control --emacs-agent-socket server "$@"
}
piar 20260603T191245-a3f09c
```

The resumed session keeps its garden header id (so the guard passes) and carries over the recorded model/identity. In-process `/new`, `/fork`, `/clone` are **blocked** under `--entwurf-control` (they would mint a non-garden uuid — pi's pre-switch hook can only `cancel`, it cannot inject an id).

**Starting a new garden session in-process — `/gnew`.** Instead of the blocked `/new`, type `/gnew` (alias `/garden-new`) to birth a fresh garden-native session in the SAME terminal, at zero tokens. It pre-creates an empty garden session file and `switchSession()`es into it, so the new session is born on a garden id from the first bind — header, control socket, and `PI_SESSION_ID` all garden, no torn uuid (the trap `/new`'s `ctx.newSession()` falls into, where the uuid is minted before the id could be re-stamped). The new session immediately carries the `control` resident name and a fresh control socket; the old session's socket is dropped. If you `/gnew` and quit before sending a turn, the empty session remains visible in resume lists with message count 0; that is intentional, because the switch succeeded and the file is now a legitimate resident session. Gate: `run.sh smoke-resident-garden-guard` GNEW section (0-token RPC E2E + a backend-identity `entwurf_self` turn).

Enforcement (no uuid / back-compat path): a `--entwurf-control` session whose id is not garden-native is refused at `session_start` and the process **hard-exits before any model turn** (a `uuidv7` from a raw `pi --entwurf-control` blows up immediately — nonzero exit, no socket, no tokens). The status bar reads `🪛 ready` until the first assistant turn writes the session file (model still changeable), then `🪛 <gardenId>` (model locked). The resident session name is set lazily on that first turn, tagged `control` (never `entwurf`, so it is not resumable as an Entwurf child). Gates: `run.sh check-entwurf-session-identity` (deterministic) + `run.sh smoke-resident-garden-guard` (live).

The human-greeted 담당자 pattern is first-class: the operator opens a pi-shell-acp session in repo B, greets it directly, then passes that `sessionId` to another session via `entwurf_send`. Spawned siblings and human-opened peers share the same messaging semantics; only the creation sequence differs.

**Mitsein over MCP** (공존) — the cross-harness counterpart. Pi may collaborate with an external interactive coding session (Claude Code, Codex, Antigravity used as a human terminal) without spawning it. A plain external host is one-directional in shape: outbound `pi → external` rides whatever the operator already uses (tmux send-keys, manual paste, any interactive input path), while inbound `external → pi` returns through this bridge's `entwurf_send`. A garden-native meta-session closes that gap for `entwurf_send` — both sides are addressable by garden id through the mailbox, and `wants_reply` is allowed when the sender marker proves the native session identity, so send/inbox is symmetric. The one remaining asymmetry is the followUp channel: `entwurf_resume` async delivery still needs a pi control socket, which a meta-session does not have. This is still not a second harness — no control daemon and no transcript scraping are introduced; the bridge only fronts the mailbox/send surface.

After a session is anchored, pi-shell-acp locks its model identity: switches that touch `pi-shell-acp` are reverted; native-to-native and pre-turn selection remain free. `ensureBridgeSession` refuses direct reuse-path mismatches before backend handoff.

Reproduce + debug: [`demo/README.md`](./demo/README.md).

## Context carriers

System / developer carriers and rich pi context are separate.

The carrier holds an optional short operator engraving from [`prompts/engraving.md`](./prompts/engraving.md); empty or missing is fine. Template variables: `{{backend}}`, `{{mcp_servers}}`. A/B with `PI_SHELL_ACP_ENGRAVING_PATH=/path/to/alt.md`. Do not put AGENTS.md, bridge narrative, or tool catalogs here — large Claude carriers can route OAuth sessions to metered "extra usage" billing.

Bridge identity, pi context, `~/AGENTS.md`, `cwd/AGENTS.md`, and date/cwd ride a one-shot first-user prepend (`pi-context-augment.ts`). Entwurf prompts already carry `cwd/AGENTS.md` inside `<project-context ...>`; the augment removes that duplicate. The augment describes capabilities, but the **actual callable schema remains source of truth** — `read` vs `Read` vs `exec_command`, MCP only when schema-visible.

## Compaction policy

**pi-shell-acp does not implement compaction.** When a backend compacts natively, the pi session and mapping survive that.

Pi-side JSONL compaction is blocked by default — `session_before_compact` returns `{cancel: true}` because pi-side summary does not reduce the backend transcript. Opt back in only with `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1`.

Backend-native compaction is always allowed. The bridge does not surface backend-specific compaction knobs; operators who need to alter a backend's auto-compaction configure that backend through its own native interface.

The legacy single knob `PI_SHELL_ACP_ALLOW_COMPACTION` is rejected at spawn intent with a next-action message pointing at `PI_SHELL_ACP_ALLOW_PI_COMPACTION`.

The footer uses ACP `usage_update.used / size` (backend prompt/tools/cache/session included) with `[pi-shell-acp:usage] ...` diagnostics. Near limit, choose a visible action: clear, open a new session with a different model, or let the backend compact on its own.

Identity-isolation env (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CODEX_SQLITE_HOME`) is unrelated to compaction and ships unconditionally.

Verification: `./run.sh smoke-compaction-policy` (deterministic). `LIVE=1 ./run.sh smoke-compaction-policy` adds backend-owned continuation probes for Claude and Codex. Probe outcomes live in [demo/compaction-policy-smoke/README.md](./demo/compaction-policy-smoke/README.md), with the release baseline and verification framing in [BASELINE.md](./BASELINE.md) and [VERIFY.md](./VERIFY.md); the probe is not a product surface (no user-facing `/acp-compact`).

## What this repo owns, and does not

Owns: provider registration (`pi-shell-acp/...`), ACP subprocess lifecycle + `resume > load > new`, prompt forwarding + ACP event mapping, the bridge surface that exposes pi capabilities such as entwurf to ACP-backed sessions, pi-facing MCP injection via `piShellAcpProvider.mcpServers`, and bridge-local cleanup and diagnostics.

Does not: reconstruct full history, hydrate backend transcripts into pi history, emulate Claude Code or Codex, run broad multi-agent orchestration (entwurf is narrow, registry-gated, identity-locked), or run a second session model competing with pi.

Only `pi:<sessionId>` mappings are persisted (`~/.pi/agent/cache/pi-shell-acp/sessions/`) — enough to re-attach pi to the same remote ACP session, never enough to act as a second harness. Backend stores (`~/.claude/`, `~/.codex/`) are interoperability side effects, not authority.

This repo also doubles as the maintainer's working laboratory for agent-harness boundaries — new workflow patterns (e.g. Mitsein over MCP) land here first as low-level instruments, before crystallizing into invariants or graduating into more polished surfaces elsewhere.

## Verification surfaces

- **[VERIFY.md](./VERIFY.md)** — agent-driven. One ACP-bridged identity runs the script against another and records what it sees. Carries the Evidence Levels L0–L5 rung ladder and the Claims Ledger so each claim is parked at the rung it has actually reached.
- **[BASELINE.md](./BASELINE.md)** — operator-driven. The maintainer runs the interview directly (no agent in the verifier seat) and the result is recorded.
- **[DELIVERY.md](./DELIVERY.md)** — capability-coordinate. The cross-harness yardstick for one question: can an already-running native session receive an async message without pretending pi owns the backend transcript? Records the per-backend async-delivery level (`D0–D8`) each harness actually reaches instead of collapsing into works/doesn't.

VERIFY + BASELINE are the verification pair — use both; either one alone leaves a blind spot the other closes. DELIVERY sits on the orthogonal delivery-capability axis.

## References

- File map + code-level invariants: [AGENTS.md](./AGENTS.md)
- Current priority + open decisions: [NEXT.md](https://github.com/junghan0611/pi-shell-acp/blob/main/NEXT.md)
- Release record: [CHANGELOG.md](./CHANGELOG.md)
- [xenodium/agent-shell](https://github.com/xenodium/agent-shell) — Emacs ACP client, `resume > load > new` idea origin
- [agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) — canonical ACP server for Claude Code
- [agent-config](https://github.com/junghan0611/agent-config) — real consumer repo

## License

MIT
