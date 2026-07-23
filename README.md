# entwurf

`entwurf` is a garden-citizen dispatch substrate: a thin bridge that lets already-existing agent harnesses address one another by **garden id** without pretending to own each other's transcript, auth, or runtime.

![entwurf — a forged screwdriver for garden-citizen dispatch](docs/assets/entwurf-hero.jpg)

[![npm](https://img.shields.io/npm/v/@junghanacs/entwurf?logo=npm)](https://www.npmjs.com/package/@junghanacs/entwurf) · maintained by [junghanacs.com](https://junghanacs.com/)

npm package: <https://www.npmjs.com/package/@junghanacs/entwurf>

Legacy package: [`@junghanacs/pi-shell-acp`](https://www.npmjs.com/package/@junghanacs/pi-shell-acp). `entwurf` is its 0.12+ successor line: the same work renamed around the garden-citizen dispatch substrate rather than the pi adapter.

> **Repository shape.** This repo is **entwurf-core (v2 dispatch) + native-harness bridges + a pi adapter + an ACP plugin**. Pi is one supported harness adapter — important because it supplies control sockets and hosts the ACP plugin today — but it is not the project subject. Claude Code is shipped as a mailbox-backed meta-session; Antigravity (`agy`) is shipped as a native-push citizen with automatic `PreInvocation` birth, ambient garden-id status, and a managed MCP/permission install surface. Codex has a launch-mode-specific verified delivery probe documented in [DELIVERY.md](./DELIVERY.md), but no managed native-citizen install lane yet. The ACP plugin is Claude-first; Cortex/vendor-governed ACP backends are future lanes.

<details>
<summary>Watch archived pre-0.12 demo (2131×1142 GIF, click to expand)</summary>

> This GIF is historical pre-0.12 evidence and still shows the retired v1 demo flow. The current 0.12 tool surface is `entwurf_v2`; a v2-native demo retake is a follow-up.

![entwurf demo](docs/assets/entwurf-demo.gif)

</details>

```text
Claude Code / Codex / agy / pi
  → garden id
    → entwurf_v2
      → control-socket | spawn-bg resume | meta-mailbox | native-push
```

[`entwurf_v2`](#entwurf_v2--canonical-dispatch-verb) is the canonical dispatch surface over *existing* garden citizens — live control-socket send (including record-less socket-only pi sessions), spawn-bg resume, meta-mailbox enqueue, and native-push into a live Antigravity conversation. The v1 entwurf verbs are gone. Fresh sibling minting and non-Claude ACP backends are deferred lanes.

**Garden id is deliberate vocabulary.** It is not a decorative synonym for session id, worker, delegate, or subagent. The unfamiliar word is a guard: each harness keeps its own identity and transcript, while `entwurf` supplies a narrow addressable surface between siblings.

**A narrow harness tool surface is discipline, not a missing feature.** When entwurf drives a backend the way pi taught — the ACP Claude session, a pi-native sibling — it runs without a sub-agent tool or a todo tool, on a narrow tool surface in auto-approve (`yolo`) mode (the ACP backend yolo-runs inside its isolated overlay). That restraint is the point: it keeps the one forged screwdriver from drifting into a second orchestrator, and keeps the operator's own driver — not a hidden agent swarm — the thing actually steering. See [AGENTS.md](./AGENTS.md) North Star.

**The ACP plugin is one ingress, not the boundary.** It re-enters as a pi provider/model on a host `--entwurf-control` session that is *already* a v2 socket-citizen; it does not mint its own socket / peers / citizen layer (see [AGENTS.md](./AGENTS.md) §ACP Plugin Boundary). No OAuth proxy, no subscription bypass, no CLI transcript scraping, no Claude Code emulation.

```text
pi --entwurf-control
  → entwurf ACP plugin
    → claude-agent-acp
      → Claude backend under the operator's local auth
```

**Native bridges reach beyond ACP transport.** A global `SessionStart` hook registers native Claude Code sessions as **garden-native meta-sessions** with a garden id, a mailbox, and a trusted sender marker. That makes an already-running Claude Code terminal addressable through `entwurf_v2` (the mailbox path), self-identifying through `entwurf_self`, and replyable by garden id — without turning pi into a second harness or importing Claude's transcript.

```text
native Claude Code
  → SessionStart hook
    → mailbox-backed meta-session <garden-id>
      → entwurf-bridge MCP
        → entwurf_self | entwurf_v2 | entwurf_inbox_read
```

Antigravity uses a separate shipped rail. Its `PreInvocation` hook births or re-attaches the conversation by native `conversationId`, writes a record-backed sender marker, and leaves delivery to the live native LS gRPC route. There is no mailbox or receiver marker on this rail: `entwurf_v2` probes the conversation and direct-injects with native-push.

```text
native Antigravity / agy
  → PreInvocation imprint → meta-session <garden-id>
  → entwurf-bridge MCP sender identity
  ↔ entwurf_v2 native-push
```

Claude's `install-meta-bridge` and agy's `install-agy-{bridge,statusline,hooks}` are distinct managed install surfaces because their lifecycle and delivery transports are genuinely different. Codex remains verified probe evidence, not a shipped managed native-citizen lane; see [DELIVERY.md](./DELIVERY.md).

> **Direction.** Inverse of [`pi-acp`](https://github.com/svkozak/pi-acp). `pi-acp` lets external ACP clients talk *to* pi; `entwurf` lets garden citizens talk across harness boundaries — with pi as one adapter, not the center.

> **Project boundary.** `entwurf` is not a fork, plugin, dependency, or integration layer of `oh-my-pi`, and it is not developed in coordination with `oh-my-pi`. Issues in other Pi / ACP projects may be useful as general implementation references, but they are not `entwurf` integration issues unless this repository explicitly links them as such.

> **Anthropic subscription billing.** From 2026-06-15, Anthropic third-party agent paths (ACP, Agent SDK, `claude -p`, entwurf's Claude backend) consume a separate Agent SDK credit pool, distinct from Claude chat and the `claude` CLI used as an interactive terminal. `entwurf` respects that distinction — no bypass, no emulation — and preserves capability dignity across supported backends (see [AGENTS.md](./AGENTS.md) invariants #7, #9, #10). The recommended default runtime leans toward paths outside Anthropic's Agent SDK metering, with Claude invoked when its quality is worth the credit cost. The operator decides the mix.

> **Gemini CLI migration.** Google announced that Gemini CLI stops serving requests for Google AI Pro / Ultra and unpaid individual tiers on **2026-06-18**; those users should migrate to [Antigravity CLI](https://antigravity.google/product/antigravity-cli). See Google's migration note: [Transitioning Gemini CLI to Antigravity CLI](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/). The repository still carries existing Gemini adapter code for compatibility, but this README no longer presents Gemini CLI as a recommended setup path during the migration window.

## Concept primer

A few words that look unusual for a coding tool.

- **Entwurf** (기투, projection-of-self) — sibling sessions with their own runtime boundary. Not "delegate," not "worker," not "sub-agent." Spawn, resume, and live peer messaging are first-class.
- **Garden / garden id** — the garden is the shared address space where independent harness sessions become citizens without losing their own runtime or transcript. A garden id is the stable address of one such citizen (for pi, a garden-native session id like `YYYYMMDDTHHMMSS-<6hex>`; for native harnesses, a meta-session id minted from an authoritative lifecycle hook — Claude `SessionStart`, agy `PreInvocation`). It is not a worker name and not proof that pi owns the session. The same-looking id may name a live control socket, a dormant pi record, a mailbox-backed native session, or a native-push conversation, so callers discover facts with `entwurf_peers` and deliver with `entwurf_v2` instead of choosing a transport by hand.
- **Engraving** — optional short operator text delivered through each backend's native identity carrier. Not a giant hidden prompt, not a tool catalog.
- **MCP** — in this repo, MCP is just the transport by which ACP-backed sessions receive pi capabilities that native pi exposes directly as extensions. It is not a general MCP platform. Explicit `entwurfProvider.mcpServers` only; no ambient `~/.mcp.json` scanning, no automatic retrieval. The same `entwurf-bridge` entry can also be wired into another host's MCP catalog (Claude Code, Codex, Antigravity, …) when the operator chooses. `entwurf_self` returns an authoritative pi-session or trusted meta-session identity envelope; `entwurf_v2` can deliver from plain external MCP hosts, but only pi-session and trusted meta-session senders are replyable.
- **Session persistence** — re-attaches pi to the same remote ACP session. Does not hydrate backend transcripts into pi history.

## Install

`entwurf` is a neutral npm package first. Install the package with `npm` (or
`pnpm`/`yarn`) and then wire the harness you want to use. Pi is still the
adapter that hosts the ACP plugin and live control-socket surface, but the base
install is **not** `pi install npm:...` anymore.

The package exposes five bins:

- `entwurf` → `run.sh` (installer, checks, native-bridge doctors/installers)
- `entwurf-bridge` → the MCP stdio launcher (`mcp/entwurf-bridge/start.sh`)
- `entwurf-statusline` → the Claude Code statusline renderer (`scripts/meta-bridge-statusline.sh`)
- `entwurf-agy-statusline` → the Antigravity garden-id statusline renderer (`scripts/agy-statusline.sh`)
- `entwurf-agy-imprint` → the Antigravity `PreInvocation` birth/sender hook (`scripts/agy-imprint.sh`)

The bridge/renderers/hook use stable bin names so package upgrades do not bake versioned package-store paths into native-harness settings.

The bridge does not provide backend credentials, tokens, or subscription access,
and does not bypass any backend auth. Whatever the operator's local `claude` /
`codex` / `agy` / pi runtime already trusts is what entwurf can use.

### From npm — user/global install

```bash
npm install -g @junghanacs/entwurf

# wire a target project for the pi adapter / ACP plugin lane
cd /path/to/your-project
entwurf install .
entwurf check-bridge
```

This writes `.pi/settings.json` in the target project with the absolute path to
the installed `entwurf-bridge` launcher. It also links the target registry under
`~/.pi/agent/` for spawn-bg resume. The global install is the easiest path when
Claude Code's USER-scope MCP registration should work from every cwd.

### From npm — project-local install

```bash
cd /path/to/your-project
npm install --save-dev @junghanacs/entwurf

npx entwurf install .
npx entwurf check-bridge
```

For manual MCP registration from a project-local install, point the host at:

```text
/path/to/your-project/node_modules/.bin/entwurf-bridge
```

or at the package launcher directly:

```text
/path/to/your-project/node_modules/@junghanacs/entwurf/mcp/entwurf-bridge/start.sh
```

### From source — development clone

```bash
git clone https://github.com/junghan0611/entwurf ~/repos/gh/entwurf
cd ~/repos/gh/entwurf
pnpm install

./run.sh install /path/to/your-project
./run.sh check-bridge
```

A development clone runs the bridge source through Node's strip-types path;
an npm-installed package runs the prebuilt JS under `mcp/entwurf-bridge/dist/`
because Node refuses to strip `.ts` files under `node_modules`.

### Pi adapter / ACP plugin lane

To use the `entwurf` provider inside pi, install a compatible pi binary
separately (`@earendil-works/pi-coding-agent >=0.80.7 <0.81`). Then point pi at
the npm-installed package or development clone:

```bash
# global npm install path
pi -e "$(npm root -g)/@junghanacs/entwurf" --list-models entwurf

# project-local install path
pi -e ./node_modules/@junghanacs/entwurf --list-models entwurf
```

For daily operator sessions, launch pi with `--entwurf-control` and a garden id
from `entwurf new-session-id`; see [Garden launcher](#garden-launcher). Older pi
versions may silently miss the provider/extension surface, so treat the pi floor
as release-critical for the ACP/plugin lane. A host that only uses
`entwurf-bridge` from Claude Code / Codex / Antigravity does not need pi until it
tries an `owned-outcome` spawn-bg resume target.

### External MCP host lane

After any npm install, register `entwurf-bridge` with the external host:

```bash
claude mcp add --scope user entwurf-bridge \
  entwurf-bridge
```

If the host does not inherit the npm bin directory, use an absolute path to the
bin or `start.sh`. For a garden-native Claude Code meta-session (replyable by
garden id), run this on Linux. The #51 repair cut refuses new macOS meta-bridge
installs because its strict live-owner doctor currently depends on `/proc`; macOS
is **not yet verified/certified for this cut**, not permanently impossible, and
future native validation may reopen it. Package-level `os` is intentionally
unrestricted, and Darwin uninstall remains available for legacy cleanup.

```bash
entwurf install-meta-bridge
entwurf doctor-meta-bridge
```

> **Upgrade action:** after installing a package that moves the hook launch form, run `entwurf install-meta-bridge` and restart **every already-open Claude Code session** before trusting send/receive. A new hook reached through an old cached command fails closed: it may still mint a garden record, but the owner join it depends on is not the one the old command produces. Reinstall materializes the matching manifest; restart makes live Claude processes load it. This release moves to the exec form and requires Claude Code `>=2.1.217`; `install-meta-bridge` and `doctor-meta-bridge` refuse anything older outright, because an older Claude drops the hook's `args` silently and still reports success.

On npm/pnpm-installed packages, `doctor-meta-bridge` must use prebuilt JS for its
store scan and defer repo-only source-shape gates; Node refuses strip-types for
raw `.ts` helpers under `node_modules`. It also refuses any Claude Code below the
supported floor `>=2.1.217` (an older one silently drops the hook's `args` and still
reports success, so nothing else in the output could be trusted), checks Claude's
installed hooks are the exec form through the shipped `hook-launch.sh`, and on Linux
verifies every live Claude MCP process joins to live sender/receiver markers.
`launch form is UNSUPPORTED` means reinstall the meta-bridge; a live-owner-join failure after
that means restart the affected Claude session so it loads the new manifest. If no
matching MCP child exists the doctor reports `NOT CERTIFIED` and **exits nonzero** — a
host whose live tier could not be measured is not a certified host, and that is worded
differently from a broken install on purpose. If the doctor reports
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, reinstall a current package before
trusting the floor result.

**Repair-cut evidence boundary.** The required Linux `artifact-consumer` CI job
installs one read-only candidate tarball globally as a non-root user in a Node 24
container that cannot see the checkout, records the tarball digest and image
identity, freezes the package root, and drives the strict doctor. Its Claude cache,
owner process, and live bridge are deliberately synthetic fixtures; that job proves
the package-consumer/oracle shape, not a real Claude lifecycle. The direct B/B2
runtime evidence came from actual Claude 2.1.138/2.1.217 sessions on one NixOS host.
A production host is certified only when a **new session using the installed
artifact** makes `doctor-meta-bridge` exit 0 with the live join. See the explicit
support matrix and release order in [VERIFY.md](./VERIFY.md). For the release
artifact, first preserve one `npm pack` output, then run
`ENTWURF_CANDIDATE_TGZ=/absolute/path/to/candidate.tgz ./run.sh check-install-container`;
the gate prints that canonical path and sha256 and consumes it without re-packing.
Only that accepted file may be published with `--tag repair`.

After upgrading a globally installed package, reinstall the native-harness surface you use before trusting it:

```bash
entwurf install-meta-bridge
entwurf doctor-meta-bridge

entwurf install-agy-bridge
entwurf install-agy-statusline
entwurf install-agy-hooks
entwurf doctor-agy-bridge
entwurf doctor-agy-statusline
entwurf doctor-agy-hooks
```

The installed entries use stable bin shims, but Claude's plugin bundle/cache still has to be re-materialized and agy's three ownership records must be refreshed by their idempotent installers. Restart existing Claude Code and agy processes after reinstall.

For manual configuration, [`pi/settings.reference.json`](./pi/settings.reference.json)
shows the pi adapter settings shape, and the external-host examples below show
plain MCP registrations.

> **First time on a clean Linux host (Ubuntu / Debian / NixOS)?** See the [clean-host walk-through](./docs/setup-clean-host.md) — Node/npm install, auth-free bridge boot, optional pi adapter verification, and authenticated runtime smokes. The neutral package may install elsewhere, but Linux is this repair cut's only currently certified Claude meta-bridge axis: its installer refuses macOS and its doctor remains `NOT CERTIFIED`/nonzero because the live owner join is not yet instrumented. Future native validation may reopen the macOS lane.

> **Post-install checks.** `entwurf check-bridge` (or `./run.sh check-bridge` from a clone) proves the `entwurf-bridge` MCP surface loads with no backend auth needed. To prove the **ACP backend actually answers** — the bridge spawns Claude through the pi provider path and a real turn comes back — run `LIVE=1 entwurf smoke-acp-provider-live` from an installed package/clone with pi and Claude auth available. Package-source routing is pinned deterministically by `run.sh check-package-source-routing`, which runs inside `pnpm check` and the release gate.

> **Extension set — do not filter.** `entwurf` ships three `pi.extensions` entries as a single set: the ACP provider extension (`pi-extensions/acp-provider.ts`) plus `pi-extensions/entwurf-control.ts` and `pi-extensions/model-lock.ts`. Filtering some out via pi's object-form package configuration can leave the model lock or entwurf-control surface in a broken state. Disable the entire package or none of it unless you know precisely which boundary you are turning off.

### Backend prerequisites

The ACP plugin is **Claude-first**. The Claude ACP server package (`@agentclientprotocol/claude-agent-acp`, pinned with `@agentclientprotocol/sdk`) ships as a pinned `dependency` of `entwurf`; backend authentication still belongs to the operator's local `claude` CLI / runtime. Once the bridge is installed, the resolver picks the ACP server in this order:

1. **`CLAUDE_AGENT_ACP_COMMAND` env override** — explicit override for an alternative binary or a wrapper command.
2. **`require.resolve(...)` against the bundled package dependency** (`@agentclientprotocol/claude-agent-acp`). This is the default path; no extra global install needed.
3. **`PATH:claude-agent-acp` fallback** — used when the package resolution fails (e.g. a hand-edited `node_modules`).

The curated model registry exposes Claude models only, so the ACP backend is Claude. Codex is *not* an ACP backend here — a native Codex session is already a first-class garden citizen via direct injection, so it needs no ACP plugin (see [AGENTS.md](./AGENTS.md)). Vendor / governed CLIs (e.g. Cortex) are a later ACP backend lane.

### Emacs frontends

Works from terminals and from Emacs frontends that launch [pi-coding-agent](https://github.com/dnouri/pi-coding-agent).

<details>
<summary>Watch entwurf in Doom Emacs (1104×627 GIF, click to expand)</summary>

![entwurf in Doom Emacs](docs/assets/entwurf-doomemacs.gif)

</details>

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
  "entwurfProvider": {
    "appendSystemPrompt": false,
    "settingSources": [],
    "strictMcpConfig": true,
    "showToolNotifications": true,
    "tools": ["Read", "Bash", "Edit", "Write"],
    "skillPlugins": [],
    "permissionAllow": ["Read(*)", "Bash(*)", "Edit(*)", "Write(*)", "mcp__*"],
    "mcpServers": {
      "entwurf-bridge": {
        "command": "/path/to/entwurf/mcp/entwurf-bridge/start.sh",
        "args": []
      }
    }
  }
}
```

`mcpServers` is the only ACP MCP injection path. In practice this repo is about the bundled `entwurf-bridge`, which carries pi capabilities into ACP-backed sessions — not about being a general MCP catalog. Invalid entries throw `McpServerConfigError` — broken tool state surfaces as broken tool state. `./run.sh install` writes the bundled `entwurf-bridge` entry and prunes the legacy bundled `session-bridge` entry from older installs.

`appendSystemPrompt: false` is intentional. Pi / AGENTS context rides the first-user augment; putting it into the Claude `_meta.systemPrompt` carrier can route OAuth sessions to metered "extra usage" billing.

### Wiring `entwurf-bridge` into an external MCP host

`entwurf-bridge` can also be registered in a separate MCP-aware harness (Claude Code, Codex CLI, Antigravity/`agy`, …). That host does **not** become a pi session and does **not** need to be ACP-backed. There are now two honest cases:

- **plain external MCP host**: no garden meta-record / sender marker. It can call tools, but its sender envelope is external/non-replyable.
- **garden-native native session**: a trusted lifecycle hook minted a garden id and sender marker — `SessionStart` for Claude Code, `PreInvocation` for agy. It is not a pi control-socket session, but it can be replyable by garden id when its own mailbox/probe rail says so.

**Which verb an external agent should reach for:** to deliver to / reply to a garden id, use **`entwurf_v2`** — it is the canonical delivery surface and the only one that reads whether the target is live pi, dormant pi, mailbox-backed Claude Code, or native-push Antigravity and routes correctly. Discover targets with `entwurf_peers`, confirm your own identity with `entwurf_self`, drain a mailbox with `entwurf_inbox_read`, and use `entwurf_register_native` only as the explicit/manual fallback for binding an already-running agy conversation (normal agy birth is automatic through the installed hook). Fresh sibling creation from nothing is a deferred lane. (The old v1 verbs `entwurf` / `entwurf_resume` / `entwurf_send` are gone.)

Observed: Claude Code, Codex CLI, and Antigravity CLI all reach garden citizens through this MCP bridge from a plain external host. Claude becomes symmetric/replyable through its mailbox-backed meta-session; agy becomes symmetric/replyable through its record-backed sender marker plus live native-push probe. Codex remains a plain external/probe lane until it has a managed citizen lifecycle.

Prerequisites on the host running the external MCP client:

- `pi` on PATH (for the `owned-outcome` spawn-bg resume path).
- A live pi session launched with `--entwurf-control` populates `~/.pi/entwurf-control/<sessionId>.sock`; required for `entwurf_v2` control-socket dispatch and `entwurf_peers`.

> **PATH boundary.** MCP servers are often launched by GUI/editor daemons and may not inherit the interactive shell's PATH. If `pi` works in your terminal but an external-host `entwurf_v2` spawn-bg resume fails with `spawn pi ENOENT`, pass a full PATH in the MCP server `env`, set `ENTWURF_BRIDGE_ENV_FILE` to a small shell file that exports PATH, or point the host at a wrapper that can find `pi`. `start.sh` sources only the explicit `ENTWURF_BRIDGE_ENV_FILE`; it never reads personal dotfiles automatically.

Example env file:

```bash
# ~/.config/entwurf-bridge/env.sh
export PATH="$HOME/.local/share/pnpm:$HOME/.local/bin:$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
```

Then add it to the external MCP config:

```json
{
  "env": {
    "ENTWURF_BRIDGE_ENV_FILE": "/home/operator/.config/entwurf-bridge/env.sh",
    "ENTWURF_BRIDGE_EXTERNAL_AGENT_ID": "external-mcp/claude-code"
  }
}
```

Emergency/manual workaround when the MCP server environment is wrong but an existing entwurf session must be resumed: run `pi --session /path/to/entwurf.jsonl ...` from an interactive shell whose PATH is known-good. Treat this as a debug escape hatch, not a replacement for fixing the MCP launch environment.

External/meta-session semantics:

- `entwurf_v2` from a plain external host delivers with `origin: "external-mcp"` / `replyable: false`; `wants_reply: true` is rejected (no reply address).
- `entwurf_v2` from a trusted meta-session delivers with `origin: "meta-session"` / `replyable: true`; `wants_reply: true` is allowed and the receiver can reply to the sender's garden id.
- `entwurf_v2` with `intent: "owned-outcome"` to a dormant pi target needs `pi` on PATH (it spawns a `pi --entwurf-control` resume child); async completion followUp requires a replyable pi control-socket caller.
- `entwurf_self` returns the same authoritative identity for pi sessions **and** trusted meta-sessions. A plain external host with no pi env and no trusted sender marker still fails because there is no reply address to report.

#### Claude Code

Claude Code supports both CLI registration and a separated global MCP config. The separated file is recommended for dotfile / `agent-config` workflows because `~/.claude.json` also carries OAuth-bearing state.

**Option A — CLI add:**

```bash
claude mcp add --scope user entwurf-bridge \
  bash /absolute/path/to/entwurf/mcp/entwurf-bridge/start.sh
```

This writes the entry into `~/.claude.json`'s top-level `mcpServers`. Good for one-off setup; do not version-control the resulting `~/.claude.json`.

**Option B — separated `~/.mcp.json`:**

```json
{
  "mcpServers": {
    "entwurf-bridge": {
      "type": "stdio",
      "command": "bash",
      "args": [
        "/absolute/path/to/entwurf/mcp/entwurf-bridge/start.sh"
      ],
      "env": {
        "ENTWURF_BRIDGE_EXTERNAL_AGENT_ID": "external-mcp/claude-code"
      }
    }
  }
}
```

Claude Code reads `~/.mcp.json` in addition to `~/.claude.json`'s top-level `mcpServers`. The `env` block identifies the calling host on the receiver render — omit it and `entwurf_v2` shows `external-mcp/unknown-host`. If Claude Code permissions are locked down, allow `mcp__*` or `mcp__entwurf-bridge__*` in `~/.claude/settings.json`.

#### Codex CLI

Add the server to `~/.codex/config.toml`:

```toml
[mcp_servers.entwurf-bridge]
command = "/absolute/path/to/entwurf/mcp/entwurf-bridge/start.sh"
```

#### Antigravity CLI (`agy`)

Use the managed install surface rather than editing agy's files by hand:

```bash
entwurf install-agy-bridge
entwurf install-agy-statusline
entwurf install-agy-hooks

entwurf doctor-agy-bridge
entwurf doctor-agy-statusline
entwurf doctor-agy-hooks
```

The three adapters deliberately own different atoms:

- bridge: one `entwurf-bridge` server in `~/.gemini/config/mcp_config.json`, plus exactly one permission string — `mcp(entwurf-bridge/entwurf_v2)` — in `~/.gemini/antigravity-cli/settings.json`;
- statusline: the complete `statusLine` subtree pointing at the bare stable bin `entwurf-agy-statusline`;
- hooks: one named `PreInvocation` hook pointing at the bare stable bin `entwurf-agy-imprint`.

Unrelated servers, permissions, settings, and hooks are preserved; every adapter has a state-backed honest inverse and refuses symlink-owned SSOTs. The installer never grants broad `command(*)`, `unsandboxed(*)`, or other YOLO policy — those remain operator decisions.

The **global** MCP config live agy reads is `~/.gemini/config/mcp_config.json`. `~/.gemini/antigravity-cli/mcp_config.json` is not the global MCP root; the bridge installer one-way cleans only a stale entwurf-owned entry there. After the first model invocation, the imprint hook binds the native `conversationId` to a garden id, the statusline shows `🪛 <garden-id> agy`, and sends from that MCP child carry `agentId=meta-session/antigravity` with `replyable:true` only when the record exists and the live native-push probe succeeds.

#### External-host skills and commands

MCP registration gives the external harness the tools; the host still needs workflow guidance. Put the Mitsein-over-MCP (cross-harness collaboration) rules in that host's instruction file or, when supported, as a host-native skill. Do not assume pi slash commands are portable across external hosts — if a workflow must work across Claude Code, Codex CLI, Antigravity, and future hosts, make it a skill or MCP tool rather than a command shortcut.

For the maintained multi-harness setup and skill/command packaging details, see `agent-config`. See also the MCP entry in [Concept primer](#concept-primer), the sender envelope contract in [AGENTS.md](./AGENTS.md), and [Custom skills](#custom-skills) for the in-pi ACP skill surface.

## Per-backend operating surface

The Claude ACP backend keeps its native model / API / tools; entwurf shapes only what enters from pi. Claude honors an explicit `CLAUDE_CONFIG_DIR` export when set by the operator.

**Claude** uses `_meta.systemPrompt` for the engraving carrier (kept short and pure — billing-safe; rich operator context rides the first user message instead, see [Context carriers](#context-carriers)) and `CLAUDE_CONFIG_DIR` for a whitelist overlay so auth/runtime entries stay available while operator memory, hooks, agents, history, local settings, and project memory remain hidden. The overlay writes an explicit empty `hooks: {}` because Claude SDK organic compaction needs the configured-empty shape; no operator hook definitions are inherited. The four-tool baseline (`Read`, `Bash`, `Edit`, `Write`) is enforced through `tools` + `permissionAllow`; `Skill` is added automatically when `skillPlugins` is non-empty. Operator context cap override: `ENTWURF_ACP_CLAUDE_CONTEXT=<int>`.

(Codex is *not* an ACP backend here — it reaches the garden natively. Vendor / governed CLIs are a later ACP backend lane.)

Antigravity is also not an ACP backend. It is a native-push citizen: `PreInvocation` supplies birth/sender identity, `entwurf_v2` probes and direct-injects replies into the live conversation, and no mailbox/receiver marker is involved.

Pi is the canonical memory authority (semantic-memory + Denote llmlog); Claude's native memory layer is pinned off.

## Smoke commands

```bash
pnpm check                              # full deterministic floor (all check-* gates, incl. check-acp-*)
./run.sh check-bridge                   # entwurf-bridge direct MCP smoke (no backend auth)
./run.sh smoke-agy-install-state        # agy MCP + exact permission ownership (120 checks)
./run.sh smoke-agy-statusline-state     # agy ambient garden-id install surface (62 checks)
./run.sh smoke-agy-hooks-state          # agy PreInvocation birth hook (37 checks)
./run.sh check-agy-sender-identity      # record-backed pid/start-key sender identity (28 checks)

# agy LIVE acceptance — requires an already-running conversation:
LIVE=1 AGY_CONVERSATION_ID=<id> ./run.sh smoke-agy-native-push-live

# ACP plugin LIVE acceptance — need the operator's local Claude auth/credit:
LIVE=1 ./run.sh smoke-acp-socket-citizen-live   # turn-free socket citizenship (S1)
LIVE=1 ./run.sh smoke-acp-raw-turn-live         # pinned ACP pipe + raw 1 turn (S2a)
LIVE=1 ./run.sh smoke-acp-overlay-live          # config overlay + hooks:{} + tool meta (S2b)
LIVE=1 ./run.sh smoke-acp-provider-live         # real pi provider path + progress/L3 (S2c/S2f)
LIVE=1 ./run.sh smoke-acp-session-reuse-live    # process-scoped reuse + codeword recall (S2d)
LIVE=1 ./run.sh smoke-acp-carrier-augment-live  # augment delivery + empty-carrier billing clean (S2e-1)

LIVE=1 ./run.sh release-gate /tmp/scratch       # the single cut gate (MUST + BEHAVIOR, SKIP=0 for a real cut)
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
  "entwurfProvider": {
    "skillPlugins": ["/absolute/path/to/your-plugin-root"]
  }
}
```

`Skill` is auto-added to `tools` and `Skill(*)` to `permissionAllow` whenever `skillPlugins` is non-empty. Each entry is validated at settings parse time and throws when the path is missing, not absolute, not a directory, or missing `.claude-plugin/plugin.json`. The Claude session does not start until the violation is fixed. The bridge does not validate `plugin.json` contents or `SKILL.md` bodies — that is the Claude Agent SDK's contract.

To verify, start a fresh Claude session and ask the model to list its skills; the names declared in your `SKILL.md` frontmatter should appear among the visible skills. The operator-driven version of this check is `Q-SKILL-CALLABLE` in [VERIFY.md](./VERIFY.md).

`skillPlugins` is a Claude-backend-only install surface. Codex exposes skills through native `~/.codex/skills/` passthrough.

For a real consumer arranging many skills, see [agent-config](https://github.com/junghan0611/agent-config).

## Entwurf orchestration

**Entwurf is one dispatch capability with native-pi and MCP surfaces.** Native pi exposes it directly as extension tools; ACP-backed and external native-harness sessions reach it through `entwurf-bridge`. The purpose is not to invent a different sub-agent system, but to preserve the same sibling-based model across harnesses.

A sibling has its own runtime boundary and its own provider/model identity — not a worker, delegate, or sub-agent. Minting a brand-new sibling from nothing is a deferred v2 lane (`spawn-fresh`); today every transport targets an *existing* garden citizen. `entwurf_v2` routes from rail-specific liveness + intent: live pi fire-and-forget → control socket; dormant pi owned-outcome → spawn-bg resume; active self-fetch → meta-mailbox; probe-alive agy → native-push. Pi paths use the per-target lock; mailbox/native-push use their own deliverability evidence and remain lock-free.

A two-pane recording covers the surface end-to-end — sibling resume, cross-process MCP dispatch across a different cwd, and a live peer greeting:

<details>
<summary>Watch (2131×1142 GIF, click to expand)</summary>

![entwurf demo](./docs/assets/entwurf-entwurf.gif)

</details>

Live peer messaging carries a sender envelope `{ sessionId, agentId, cwd, timestamp }`; `entwurf_self` returns that authoritative envelope for the current pi session or trusted meta-session. Plain external MCP hosts are non-replyable; garden-native meta-sessions carry a trusted `meta-session` envelope and are replyable by garden id. `wants_reply` is an etiquette marker rendered as a `(wants reply)` badge — not a transport contract, no wait, no polling — and is rejected only from non-replyable external senders.

In ACP-backed and external native-harness sessions, `entwurf-bridge` exposes five tools: `entwurf_v2`, `entwurf_peers`, `entwurf_self`, `entwurf_inbox_read`, and the explicit/manual `entwurf_register_native` fallback. Native pi exposes the shared capability directly through the extension surface (`entwurf_v2`, `entwurf_peers` tools + the `/entwurf-sessions` command). **For garden-id delivery/reply use `entwurf_v2`** — the canonical surface that classifies the target and routes to live-pi / dormant-resume / Claude-Code-meta-mailbox / Antigravity-native-push. Fresh sibling creation from nothing is a deferred lane. (The v1 verbs `entwurf` / `entwurf_resume` / `entwurf_send` are gone.) Garden-native operator commands require `--entwurf-control`. The spawn target allowlist is [`pi/entwurf-targets.json`](./pi/entwurf-targets.json).

### `entwurf_v2` — canonical dispatch verb

`entwurf_v2` / `runEntwurfV2` is the canonical v2 dispatch verb over **existing** garden targets — record-backed citizens plus live socket-only `pi` endpoints (a record-less but live `pi --entwurf-control` peer is a *target*, intentionally **not** an owned citizen). You give a target garden id plus an intent (`fire-and-forget` or `owned-outcome`); one decider reads the target's liveness as a fact and picks the transport from a frozen table keyed on **both** the target's state **and** the intent — never on state alone — then reports one outcome under the v2 lock policy. Pi control-socket and spawn-bg paths take a per-target lock; mailbox and native-push are lock-free, with deliverability guarded by their own receiver/probe evidence:

| target state | intent | transport |
|---|---|---|
| live pi | fire-and-forget | control-socket send |
| live pi | owned-outcome | **reject** (a live peer is not an owned spawn target) |
| dormant pi | owned-outcome | spawn-bg resume (a real `pi --entwurf-control` child) |
| dormant pi | fire-and-forget | **reject** (`dormant-fire-forget-unsupported`) |
| active self-fetch receiver | fire-and-forget | meta-mailbox enqueue + doorbell |
| inactive / terminated self-fetch receiver | fire-and-forget | **reject** (`mailbox-undeliverable` — no `.msg`, no doorbell) |
| self-fetch | owned-outcome | **reject** (no owned result over a mailbox) |
| live native-push conversation | fire-and-forget | native-push direct injection |
| dead / indeterminate native-push conversation | fire-and-forget | **reject** (`native-push-target-dead` / `native-push-probe-indeterminate`) |
| native-push | owned-outcome | **reject** (`native-push-no-resume-authority`) |

**`entwurf_v2` is the canonical surface for garden-id delivery.** When you have a garden id and want to reach whoever it names — message, reply, or hand-off — `entwurf_v2` is the one surface that reads whether the target is live pi, dormant pi, mailbox-backed Claude Code, or native-push Antigravity and routes correctly; *when unsure which transport, use `entwurf_v2`*. This prevents callers from guessing a rail from the shape of an id.

What v2 provides is a **deterministic dispatch substrate** that moves the "which transport?" decision out of the fallible caller/model and into the decider, with transport-appropriate locking and an honest reject (no `✓ delivered`, no `.msg` garbage) when a target cannot receive. What it does **not** do is **fresh sibling creation** — minting a brand-new sibling from a provider/model/prompt is a deferred lane (the `dormant pi → spawn-bg resume` row above resumes an *already-identified* citizen, it does not mint one). The meta-mailbox row requires an **active** self-fetch receiver; native-push requires a record-backed, probe-alive native conversation and never borrows mailbox state. Claude↔Claude / Claude tmux-live transport is a later lane (the contract enum names `tmux-live` but no production path executes it).

A live pi target is addressed by its **control socket**, so a record-less but live `pi --entwurf-control` session (an operator-greeted peer with no meta-record) is accepted as a `fire-and-forget` control-send target, matching what `entwurf_peers` lists as alive. An `owned-outcome` resume, however, needs a record-backed citizen (its cwd/launch authority); a record-less endpoint is a socket-only fire-and-forget target only — record-less dormant resume is a later lane.

> **Direction.** An Entwurf core (peer identity / garden id / inbox / liveness / dispatch / replyability / evidence) could later extract into its own repo with per-backend plugins; today this repo holds the v2 core + meta-bridge + ACP plugin together. ACP is one plugin, not the boundary — rationale: [#38](https://github.com/junghan0611/entwurf/issues/38).

### Garden launcher

A `--entwurf-control` session must be garden-native — its header `id` must be a garden sessionId (`YYYYMMDDTHHMMSS-[0-9a-f]{6}`), not pi's default `uuidv7`. The session id is fixed at launch (pi assigns it before extensions load), so the launcher injects it; `entwurf-control` only enforces. Launch through:

```bash
pi --session-id "$(/path/to/entwurf/run.sh new-session-id)" \
   --entwurf-control --emacs-agent-socket server
```

`run.sh new-session-id` prints one fresh garden sessionId from the `generateSessionId` SSOT (do not reimplement the format in the shell — it would drift from the validator the guard enforces). An operator alias bakes this in, e.g.:

```bash
pia() { pi --session-id "$(/path/to/entwurf/run.sh new-session-id)" \
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

**Starting a new session in-process — pi's own `/new`.** Since the #50 C2 cut there is nothing to replace it with: `/new`, `/fork`, `/clone` and RPC session replacement are pi's again. The replacement session fires `session_start`, which upserts its own meta-record and rebinds the control socket to that record's garden id; the old socket is dropped. pi's session id (a uuidv7) is recorded as the citizen's `nativeSessionId` and is never an address. Gate: `run.sh smoke-resident-garden-guard` REPLACEMENT section (0-token RPC E2E).

Enforcement (no uuid / back-compat path): a `--entwurf-control` session whose id is not garden-native is refused at `session_start` and the process **hard-exits before any model turn** (a `uuidv7` from a raw `pi --entwurf-control` blows up immediately — nonzero exit, no socket, no tokens). The status bar reads `🪛 ready` until the first assistant turn writes the session file (model still changeable), then `🪛 <gardenId>` (model locked). The resident session name is set lazily on that first turn, tagged `control` (never `entwurf`, so it is not resumable as an Entwurf child). Gates: `run.sh check-entwurf-session-identity` (deterministic) + `run.sh smoke-resident-garden-guard` (live).

The human-greeted 담당자 pattern is first-class: the operator opens a entwurf session in repo B, greets it directly, then passes that `sessionId` to another session, which reaches it via `entwurf_v2`. Resumed citizens and human-opened peers share the same messaging semantics; only how they came to exist differs.

**Mitsein over MCP** (공존) — the cross-harness counterpart. Pi may collaborate with an external interactive coding session (Claude Code, Codex, Antigravity used as a human terminal) without spawning it. A plain external host is one-directional in shape: inbound `external → pi` returns through this bridge's `entwurf_v2`, but the host has no reply address. A garden-native native session closes that gap on its own rail: Claude Code through mailbox self-fetch, agy through probe-alive native-push. `wants_reply` is allowed only when the sender marker and rail-specific evidence prove replyability. Async `owned-outcome` still needs a dormant pi citizen with spawn authority; neither mailbox nor native-push has it. This is still not a second harness — no control daemon and no transcript scraping are introduced.

After a session is anchored, entwurf locks its model identity: switches that touch `entwurf` are reverted; native-to-native and pre-turn selection remain free. `ensureBridgeSession` refuses direct reuse-path mismatches before backend handoff.

Archived pre-0.12 demo notes: [`demo/README.md`](./demo/README.md). They remain as historical evidence until the v2-native demo retake.

## Context carriers

System / developer carriers and rich pi context are separate.

The carrier holds an optional short operator engraving; empty or missing is fine. The runtime default is the bundled `pi-extensions/lib/acp/prompts/engraving.md` (the `# Engraving Here` placeholder, pinned non-empty by a gate); [`prompts/engraving.md`](./prompts/engraving.md) is a documented sample you copy and point the runtime at with `ENTWURF_ACP_ENGRAVING_PATH=/path/to/alt.md`. Template variables: `{{backend}}`, `{{mcp_servers}}`. Do not put AGENTS.md, bridge narrative, or tool catalogs here — large Claude carriers can route OAuth sessions to metered "extra usage" billing.

Bridge identity, pi context, `~/AGENTS.md`, `cwd/AGENTS.md`, and date/cwd ride a one-shot first-user prepend (`pi-context-augment.ts`). Entwurf prompts already carry `cwd/AGENTS.md` inside `<project-context ...>`; the augment removes that duplicate. The augment describes capabilities, but the **actual callable schema remains source of truth** — `read` vs `Read` vs `exec_command`, MCP only when schema-visible.

## Compaction policy

**entwurf does not implement compaction.** When a backend compacts natively, the pi session and mapping survive that. The bridge exposes no backend-specific compaction knobs; operators who need to alter a backend's auto-compaction configure that backend through its own native interface. Do not rely on a pi-side JSONL summary to reduce a backend transcript — it does not.

The footer uses ACP `usage_update.used / size` (backend prompt/tools/cache/session included) with `[entwurf:usage]` diagnostics. Near limit, choose a visible action: clear, open a new session with a different model, or let the backend compact on its own.

## What this repo owns, and does not

Owns: provider registration (`entwurf/...`), ACP subprocess lifecycle + `resume > load > new`, prompt forwarding + ACP event mapping, the bridge surface that exposes pi capabilities such as entwurf to ACP-backed sessions, pi-facing MCP injection via `entwurfProvider.mcpServers`, and bridge-local cleanup and diagnostics.

Does not: reconstruct full history, hydrate backend transcripts into pi history, emulate Claude Code or Codex, run broad multi-agent orchestration (entwurf is narrow, registry-gated, identity-locked), or run a second session model competing with pi.

Only `pi:<sessionId>` mappings are persisted (`~/.pi/agent/cache/entwurf/sessions/`) — enough to re-attach pi to the same remote ACP session, never enough to act as a second harness. Backend stores (`~/.claude/`, `~/.codex/`) are interoperability side effects, not authority.

This repo also doubles as the maintainer's working laboratory for agent-harness boundaries — new workflow patterns (e.g. Mitsein over MCP) land here first as low-level instruments, before crystallizing into invariants or graduating into more polished surfaces elsewhere.

## Verification surfaces

- **[VERIFY.md](./VERIFY.md)** — agent-driven. One ACP-bridged identity runs the script against another and records what it sees. Carries the Evidence Levels L0–L5 rung ladder and the Claims Ledger so each claim is parked at the rung it has actually reached.
- **[BASELINE.md](./BASELINE.md)** — operator-driven. The maintainer runs the interview directly (no agent in the verifier seat) and the result is recorded.
- **[DELIVERY.md](./DELIVERY.md)** — capability-coordinate. The cross-harness yardstick for one question: can an already-running native session receive an async message without pretending pi owns the backend transcript? Records the per-backend async-delivery level (`D0–D8`) each harness actually reaches instead of collapsing into works/doesn't.

VERIFY + BASELINE are the verification pair — use both; either one alone leaves a blind spot the other closes. DELIVERY sits on the orthogonal delivery-capability axis.

## References

- File map + code-level invariants: [AGENTS.md](./AGENTS.md)
- Current priority + open decisions: [NEXT.md](https://github.com/junghan0611/entwurf/blob/main/NEXT.md)
- Release record: [CHANGELOG.md](./CHANGELOG.md)
- [xenodium/agent-shell](https://github.com/xenodium/agent-shell) — Emacs ACP client, `resume > load > new` idea origin
- [agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) — canonical ACP server for Claude Code
- [agent-config](https://github.com/junghan0611/agent-config) — real consumer repo

## License

MIT
