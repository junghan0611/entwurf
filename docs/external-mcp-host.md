# Wiring `entwurf-bridge` into an external MCP host

Per-harness registration for Claude Code, Codex CLI, and Antigravity, plus the
PATH/env boundary and the external vs garden-native semantics. `README.md` keeps only
the one-line registration; everything an operator needs to actually wire a host is here.

`entwurf-bridge` can also be registered in a separate MCP-aware harness (Claude Code, Codex CLI, Antigravity/`agy`, …). That host does **not** become a pi session and does **not** need to be ACP-backed. There are now two honest cases:

- **plain external MCP host**: no garden meta-record / sender marker. It can call the read surfaces (`entwurf_peers`, `entwurf_inbox_read`), but `entwurf_v2` sends are **refused by default** (#50 C4: "if we don't know who sent it, we don't send it"). The operator may wire the explicit hatch below; the send then goes out external/non-replyable.
- **garden-native native session**: a trusted lifecycle hook minted a garden id and sender marker — `SessionStart` for Claude Code, `PreInvocation` for agy. It is not a pi control-socket session, but it can be replyable by garden id when its own mailbox/probe rail says so.

**Which verb an external agent should reach for:** to deliver to / reply to a garden id, use **`entwurf_v2`** — it is the canonical delivery surface and the only one that reads whether the target is live pi, dormant pi, mailbox-backed Claude Code, or native-push Antigravity and routes correctly. Discover targets with `entwurf_peers`, confirm your own identity with `entwurf_self`, drain a mailbox with `entwurf_inbox_read`, and use `entwurf_register_native` only as the explicit/manual fallback for binding an already-running agy conversation (normal agy birth is automatic through the installed hook). Fresh sibling creation from nothing is a deferred lane. (The old v1 verbs `entwurf` / `entwurf_resume` / `entwurf_send` are gone.)

Observed: Claude Code, Codex CLI, and Antigravity CLI all reach the read surfaces through this MCP bridge from a plain external host — `entwurf_peers` is a pure fact projection, while `entwurf_inbox_read` is a **mutating drain** (it archives the messages and stamps the read-receipt), so "read" here does not mean side-effect-free; **sending** needs an identity lane. Claude becomes symmetric/replyable through its mailbox-backed meta-session; agy becomes symmetric/replyable through its record-backed sender marker plus live native-push probe. Codex has no managed citizen lifecycle yet, so a Codex host cannot send without the explicit anonymous hatch below.

Prerequisites on the host running the external MCP client:

- `pi` on PATH (for the `owned-outcome` spawn-bg resume path).
- A live pi session launched with `--entwurf-control` populates `~/.pi/entwurf-control/<gardenId>.sock` — the key is the **record's** garden id, never a transcript/session id (`PI_SESSION_ID` only carries the id record birth already established). Required for `entwurf_v2` control-socket dispatch and `entwurf_peers`.

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

**Anonymous sender hatch (explicit, documented — never a default).** The bridge refuses an `entwurf_v2` send when the process has neither pi-session env (`PI_SESSION_ID` + `PI_AGENT_ID`) nor a trusted meta-sender marker (#50 C4). A deliberately-anonymous external host — e.g. a Codex CLI wiring, which has no managed citizen lifecycle — may opt out by adding `"ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER": "1"` to the MCP server `env`. The cost is honest and fixed: the send lands with `origin: "external-mcp"`, `replyable: false` (there is no reply address), and `wants_reply: true` stays pointless. The retired opt-in `ENTWURF_BRIDGE_REQUIRE_META_SENDER` is no longer read — its demand became the default, so a stale copy in an old install env is inert.

Emergency/manual workaround when the MCP server environment is wrong but an existing entwurf session must be resumed: run `pi --session /path/to/entwurf.jsonl ...` from an interactive shell whose PATH is known-good. Treat this as a debug escape hatch, not a replacement for fixing the MCP launch environment.

External/meta-session semantics:

- `entwurf_v2` from a plain external host is **refused by default** (no authoritative sender — #50 C4). With the explicit `ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER=1` hatch it delivers with `origin: "external-mcp"` / `replyable: false`; there is still no reply address.
- `entwurf_v2` from a trusted meta-session delivers with `origin: "meta-session"`, and `replyable` is **derived from that sender's own rail — not granted by being trusted**: a self-fetch sender (Claude Code) is replyable only while its receiver is live and armed, and a native-push sender (Antigravity) only while its adapter probe finds the live conversation. Identity survives either way; only `replyable` drops to `false`. When it is `true`, `wants_reply: true` is allowed and the receiver can reply to the sender's garden id.
- `entwurf_v2` with `intent: "owned-outcome"` to a dormant pi target needs `pi` on PATH (it spawns a `pi --entwurf-control` resume child); async completion followUp requires a replyable pi control-socket caller.
- `entwurf_self` returns the same authoritative identity for pi sessions **and** trusted meta-sessions. A plain external host with no pi env and no trusted sender marker still fails because there is no reply address to report.

#### Claude Code

Plain MCP registration works independently of the native lifecycle. A garden-native
mailbox citizen requires Claude Code >=2.1.217 plus the managed meta-bridge installer;
older versions silently drop exec-hook arguments and are refused.

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

Codex has no managed citizen lifecycle (no sender marker), so this wiring can read `entwurf_peers`/`entwurf_inbox_read` but `entwurf_v2` sends are refused by default (#50 C4). To send anonymously anyway, add the explicit hatch to the same block: `env = { ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER = "1" }` — the send is then marked external/non-replyable (see the hatch paragraph above).

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

- bridge: one `entwurf-bridge` server in `~/.gemini/config/mcp_config.json`, plus one narrow permission string per tool the normal agy workflow calls — `mcp(entwurf-bridge/entwurf_v2)`, `mcp(entwurf-bridge/entwurf_peers)`, `mcp(entwurf-bridge/entwurf_self)` — in `~/.gemini/antigravity-cli/settings.json`. agy defaults every `mcp` action to Ask, so a tool that ships without its own rule stops for a y/n on every call; `entwurf_inbox_read` is deliberately not granted (native-push has no inbox) and neither is the manual `entwurf_register_native` fallback;
- statusline: the complete `statusLine` subtree pointing at the bare stable bin `entwurf-agy-statusline`;
- hooks: one named `PreInvocation` hook pointing at the bare stable bin `entwurf-agy-imprint`.

Unrelated servers, permissions, settings, and hooks are preserved; every adapter has a state-backed honest inverse and refuses symlink-owned SSOTs. The installer never grants broad `command(*)`, `unsandboxed(*)`, or other YOLO policy — those remain operator decisions.

The **global** MCP config live agy reads is `~/.gemini/config/mcp_config.json`. `~/.gemini/antigravity-cli/mcp_config.json` is not the global MCP root; the bridge installer one-way cleans only a stale entwurf-owned entry there. After the first model invocation, the imprint hook binds the native `conversationId` to a garden id, the statusline shows `🪛 <garden-id> agy`, and sends from that MCP child carry `agentId=meta-session/antigravity` with `replyable:true` only when the record exists and the live native-push probe succeeds.

#### External-host skills and commands

MCP registration gives the external harness the tools; the host still needs workflow guidance. Put the Mitsein-over-MCP (cross-harness collaboration) rules in that host's instruction file or, when supported, as a host-native skill. Do not assume pi slash commands are portable across external hosts — if a workflow must work across Claude Code, Codex CLI, Antigravity, and future hosts, make it a skill or MCP tool rather than a command shortcut.

For the maintained multi-harness setup and skill/command packaging details, see
[agent-config](https://github.com/junghan0611/agent-config). See also the
[concept primer](../README.md#concept-primer), the sender-envelope contract in
[AGENTS.md](../AGENTS.md), and [custom skills](../README.md#custom-skills).
