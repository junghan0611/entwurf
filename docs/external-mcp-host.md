# Wiring `entwurf-bridge` into an external MCP host

Per-harness registration for Claude Code, Codex CLI, Antigravity, GitHub Copilot CLI and OMP,
plus the PATH/env boundary and the external vs garden-native semantics. `README.md` keeps only
the one-line registration; everything an operator needs to actually wire a host is here.

`entwurf-bridge` can also be registered in a separate MCP-aware harness (Claude Code, Codex CLI, Antigravity/`agy`, GitHub Copilot CLI, OMP, …). That host does **not** become a pi session and does **not** need to be ACP-backed. There are now two honest cases:

- **plain external MCP host**: no garden meta-record or authoritative identity carrier. It can call the read surfaces (`entwurf_peers`, `entwurf_inbox_read`), but `entwurf_v2` sends are **refused by default** (#50 C4: "if we don't know who sent it, we don't send it"). The operator may wire the explicit hatch below; the send then goes out external/non-replyable.
- **garden-native native session**: a trusted lifecycle event minted a garden id — `SessionStart` for Claude Code and Codex, `PreInvocation` for agy, `userPromptSubmitted`/`sessionStart` for GitHub Copilot CLI, and for OMP an in-process extension on `session_start`/`session_switch` that mints only a `mode === "tui"` host. Claude/Copilot/agy/OMP then use record-backed process markers; Codex instead carries its matching native `threadId` on every MCP request. It is not a pi control-socket session, but it can be replyable by garden id when its own mailbox/probe rail says so.

  **Being garden-native is not the same as being replyable, and Copilot is the case that separates them.** Its hook writes a sender marker, so an `entwurf_v2` send carries its own garden id and the receiver learns who wrote — measured 2026-08-21 on Copilot CLI 1.0.80, where a live send arrived under its own garden id with `origin: "meta-session"` and `replyable: false`. Replyability arrived later and through a different process: a first-party extension (`run.sh install-copilot-receive`) that the CLI forks, which binds to the same V3 record and writes a receiver marker owned by its own pid (#82 RAIL 5). So a Copilot citizen is `replyable: true` exactly while that extension is armed for it, and `replyable: false` — honestly, with a real garden identity — when it is not installed, not launched with `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS` (which is what `entwurf copilot` sets for one invocation), not yet born, or gone. Read the two facts off different rails: the sender marker answers *who sent this*; the receiver marker answers *can a reply land*. The onboarding obligations are in [`adding-a-harness.md`](./adding-a-harness.md) step 7, and the evidence boundary — the managed LIVE acceptance that moved receive to D6, and what D7-partial / D3-pending still exclude — is in [`DELIVERY.md`](../DELIVERY.md).

**Which verb an external agent should reach for:** to deliver to / reply to a garden id, use **`entwurf_v2`** — it is the canonical delivery surface and the only one that reads whether the target is live pi, dormant pi, a mailbox-backed self-fetch citizen (Claude Code, Copilot, OMP), or native-push Antigravity/Codex and routes correctly. Discover targets with `entwurf_peers`, confirm your own identity with `entwurf_self`, drain a mailbox with `entwurf_inbox_read`, and use `entwurf_register_native` only as the explicit/manual fallback for binding an already-running agy conversation. Open a NEW sibling with **`entwurf_fresh_call {backend, model, task, cwd?, placement?}`**, and reopen a DORMANT pi citizen under the same id with **`entwurf_resume_call {target}`**.

Observed: Claude Code, Codex CLI, Antigravity CLI, GitHub Copilot CLI and OMP all reach this MCP bridge. Claude, Copilot and OMP become symmetric/replyable through mailbox-backed meta-sessions; agy and Codex use native-push. Codex's identity is request-scoped `_meta.threadId`, and its replyability requires that exact record plus a loaded app-server thread. Plain external hosts still need an identity lane to send.

Prerequisites on the host running the external MCP client:

- A live pi session launched with `--entwurf-control` populates `~/.pi/entwurf-control/<gardenId>.sock` — the key is the **record's** garden id, never a transcript/session id (`PI_SESSION_ID` only carries the id record birth already established). Required for `entwurf_v2` control-socket dispatch and `entwurf_peers`.

> **PATH boundary.** MCP servers are often launched by GUI/editor daemons and may not inherit the interactive shell's PATH. No `entwurf_v2` rail launches a process, so this does not affect delivery — but `entwurf_fresh_call` and `entwurf_resume_call` do open a fixed runtime. If that runtime works in your terminal but an external-host call fails with `spawn pi ENOENT`, `spawn claude ENOENT`, `spawn entwurf ENOENT`, `spawn omp ENOENT`, or `spawn codex ENOENT`, pass a full PATH in the MCP server `env`, set `ENTWURF_BRIDGE_ENV_FILE` to a small shell file that exports PATH, or point the host at a wrapper that can find the runtime. `start.sh` sources only the explicit `ENTWURF_BRIDGE_ENV_FILE`; it never reads personal dotfiles automatically.

> **Identity-carrier boundary.** The bridge reconciles every authoritative claim available to
> the request: the complete `PI_SESSION_ID` + `PI_AGENT_ID` pair, a native sender marker, and
> Codex request `_meta`. Zero claims is refused; multiple claims must name the same garden id or
> the call throws. Nothing silently wins. Those pi variables are correct only inside the pi
> process that planted them from record birth; they are foreign identity in another native
> harness. Every managed fresh launch therefore empties both variables at the tmux seam and lets
> the launched harness establish its own identity. Clearing only one is not a repair: an
> incomplete pair is itself invalid, while retaining either carrier invites future reader drift.
> An unmanaged launch that inherits them is unsupported. A native-harness admission must add a
> doctor or request-level contract that names contamination rather than trusting precedence.
>
> **The defenses are layered.** Copilot's managed launcher unsets both carriers before `exec`,
> and `doctor-copilot-receive` detects a contaminated live CLI. The shared fresh-call tmux seam
> empties them for every backend. OMP retains its process-environment doctor for manually opened
> sessions. Codex's request-level reconciler adds a different last line: a foreign pi claim and
> `_meta.threadId` claim cannot coexist under different garden ids. These are complementary;
> no backend's cell is evidence for another's unmanaged launch.
>
> **OMP has both halves, and the strip one is not an omp launcher** (#87 Bundle C). entwurf still
> owns no managed omp invocation — the bare vendor runtime IS this harness's clause 1 answer, and
> nothing here argues for a wrapper. The strip sits one level up instead, at the shared launch seam
> every `entwurf_fresh_call` backend passes through: `SCRUBBED_INHERITED_ENV` empties
> `PI_SESSION_ID` and `PI_AGENT_ID` on the `new-window` argv itself
> (`pi-extensions/lib/mux-fresh-call.ts`), for all five backends rather than only the one whose
> measurement surfaced it, because the leak is a property of tmux and not of a vendor. `-e VAR=`
> sets the variable empty rather than unsetting it — tmux has no per-window unset — and every
> carrier reader trims and tests truthiness, so empty and absent are the same answer by
> construction. Pinned by `[QK:FRESHCALL-IDENTITY-SCRUB]` in the `check-mux-fresh-call` vitest lane,
> inside `check:full`. The DETECT half is unchanged and still load-bearing, because a seam covers
> only the launches that pass through it: `doctor-omp-bridge` reads each live `omp`
> process's environment (on Linux, `/proc/<pid>/environ`) and goes RED on its own
> axis when one carries either carrier. The remaining uncertified Darwin axis is
> per-process environment DISCOVERY, not `/proc` absence; macOS rails are
> NOT CERTIFIED — pending physical host. An omp the operator started
> from a pi citizen's bash never touched the seam and is still unsupported, exactly
> as this boundary says.

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

**Anonymous sender hatch (explicit, documented — never a default).** The bridge refuses an `entwurf_v2` send when the process has neither pi-session env nor a trusted native identity claim. A deliberately-anonymous plain external host may opt out by adding `"ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER": "1"` to the MCP server `env`. The cost is honest and fixed: the send lands with `origin: "external-mcp"`, `replyable: false`, and `wants_reply: true` stays pointless. A managed Codex citizen does **not** use this hatch; request `_meta` supplies its authoritative identity.

Emergency/manual workaround when the MCP server environment is wrong but an existing entwurf session must be resumed: run `pi --session /path/to/entwurf.jsonl ...` from an interactive shell whose PATH is known-good. Treat this as a debug escape hatch, not a replacement for fixing the MCP launch environment.

External/meta-session semantics:

- `entwurf_v2` from a plain external host is **refused by default** (no authoritative sender — #50 C4). With the explicit `ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER=1` hatch it delivers with `origin: "external-mcp"` / `replyable: false`; there is still no reply address.
- `entwurf_v2` from a trusted meta-session delivers with `origin: "meta-session"`, and `replyable` is **derived from that sender's own rail — not granted by being trusted**: a self-fetch sender (Claude Code, Copilot, OMP) is replyable only while its receiver is live and armed; Antigravity requires a live native probe; Codex requires a matching request-scoped record and loaded app-server thread. Identity survives either way; only `replyable` drops to `false`.
- `entwurf_v2` never launches a process, so no delivery path needs `pi` on PATH. A dormant pi target is refused as `dormant-fire-forget-unsupported`: the hidden background resume that used to answer there was withdrawn under the visible-first rule, and re-opening the session is the separate `entwurf_resume_call` verb — which DOES need `pi` on PATH, because it starts one.
- `entwurf_self` returns the same authoritative identity for pi sessions **and** trusted meta-sessions. A plain external host with no pi env, native marker, or Codex request claim still fails because there is no reply address to report.

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

Use the owned surfaces rather than editing `~/.codex/config.toml`:

```bash
sudo entwurf install-codex-birth
entwurf install-codex-mcp
entwurf install-codex-statusline

sudo entwurf doctor-codex-birth
entwurf doctor-codex-mcp
entwurf doctor-codex-statusline
```

The system unit owns a prompt-free `/etc/codex` `SessionStart` hook; the user units own
only `[mcp_servers.entwurf-bridge]` and the `thread-title` status-line member. The MCP
entry carries `ENTWURF_BRIDGE_NATIVE_HOST=codex`, which tells the bridge to require and
reconcile Codex request `_meta`. Do not add the anonymous hatch.

Native receive and visible fresh require the operator-owned default app-server. Entwurf
does not start or supervise it:

```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
codex app-server --listen "unix://$CODEX_HOME/app-server-control/app-server-control.sock"
```

Birth occurs on the first turn, not window open. It mints
`record.nativeSessionId = threadId` and sets the visible thread title to the garden id.
`entwurf_v2` probes the loaded-thread list and sends once through `codex queue`; it never
retries. `entwurf_fresh_call` accepts `backend: "codex"` after all three owned units and
the default socket pass preflight. Codex remains outside ACP and has no resume surface.

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

- bridge: one `entwurf-bridge` server in `~/.gemini/config/mcp_config.json`, plus one narrow permission string per tool the normal agy workflow calls — `mcp(entwurf-bridge/entwurf_v2)`, `mcp(entwurf-bridge/entwurf_peers)`, `mcp(entwurf-bridge/entwurf_self)` — in `~/.gemini/antigravity-cli/settings.json`. agy defaults every `mcp` action to Ask, so a tool that ships without its own rule stops for a y/n on every call; `entwurf_inbox_read` is deliberately not granted (native-push has no inbox), neither is the manual `entwurf_register_native` fallback, and neither are `entwurf_fresh_call` / `entwurf_resume_call` (both launch into the caller's own tmux server, which an agy conversation has none of);
- statusline: the complete `statusLine` subtree pointing at the bare stable bin `entwurf-agy-statusline`;
- hooks: one named `PreInvocation` hook pointing at the bare stable bin `entwurf-agy-imprint`.

Unrelated servers, permissions, settings, and hooks are preserved; every adapter has a state-backed honest inverse and refuses symlink-owned SSOTs. The installer never grants broad `command(*)`, `unsandboxed(*)`, or other YOLO policy — those remain operator decisions.

The **global** MCP config live agy reads is `~/.gemini/config/mcp_config.json`. `~/.gemini/antigravity-cli/mcp_config.json` is not the global MCP root; the bridge installer one-way cleans only a stale entwurf-owned entry there. After the first model invocation, the imprint hook binds the native `conversationId` to a garden id, the statusline shows `🪛 <garden-id> agy`, and sends from that MCP child carry `agentId=meta-session/antigravity` with `replyable:true` only when the record exists and the live native-push probe succeeds.

#### OMP (`omp`, oh-my-pi)

Use the managed install surface rather than editing omp's files by hand:

```bash
entwurf install-omp-bridge     # the BIRTH extension (a garden id per visible TUI session)
entwurf install-omp-mcp        # the MCP hand (this section)
entwurf install-omp-config     # the operator setting (tools.xdev: false)
entwurf install-omp-receive    # the RECEIVER extension (mailbox watch + announce-only doorbell)

entwurf doctor-omp-bridge
entwurf doctor-omp-mcp
entwurf doctor-omp-receive
```

Four units, not two. The receiver is what makes the citizen answerable at all — without it omp
sends under its own garden id and every reply is refused as `mailbox-undeliverable` — and it is
also a prerequisite of visible fresh: the fresh preflight refuses this host before touching tmux
when the receive unit is missing, rather than opening a window that can never be reached.

`install-omp-mcp` writes ONE server into omp's own user MCP file,
`<omp agent dir>/mcp.json` (`~/.omp/agent/mcp.json`, profile-aware), in omp's own writer
shape — `{command, args?, env?}` with `type` omitted, since stdio is the default:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "entwurf-bridge": {
      "command": "bash",
      "args": ["/absolute/path/to/entwurf/mcp/entwurf-bridge/start.sh"],
      "env": { "ENTWURF_BRIDGE_EXTERNAL_AGENT_ID": "external-mcp/omp" }
    }
  }
}
```

**The server key is a pinned literal, and that is the whole point.** omp translates Claude
Code's `~/.claude.json` as an import provider, so a host that ever used Claude Code already
has an `entwurf-bridge` — carrying `external-mcp/claude-code`. An omp session riding that
import introduces itself to the bridge under Claude Code's name. Writing the native entry
under the byte-identical key shadows it: native provider priority 100 beats claude 80,
dedupe is first-wins on the server NAME, and on a key hit the equivalence check is never
consulted, so an entry whose env deliberately differs still suppresses the import outright
— not both-loaded, not merged, no warning. A different key would load BOTH.
`[측정]` 2026-08-27, omp/18.0.0: the vendor's own `/mcp list` pane flipped from
`Claude Code (~/.claude.json): entwurf-bridge ● connected` to
`User level (~/.omp/agent/mcp.json): entwurf-bridge ● connected [stdio]`, and the spawned
bridge child's environ flipped with it.

**`disabledServers` is never the way to hide the import.** Suppression is by name and a
suppressed item still claims the dedupe key, so denylisting `entwurf-bridge` kills the
native entry and the import together. `[측정]` with that denylist the pane shows
`entwurf-bridge ○ not connected` and no Claude Code section at all, and no MCP child is
spawned. The installer refuses to write into a config that denylists its own key, and
`doctor-omp-mcp` is red while one exists.

**The tool names are omp's dialect, not Claude's.** omp mints `mcp__<server>_<tool>` after
lowercasing and replacing every `[^a-z_]+` run with `_`, collapsing runs and trimming edges,
so `entwurf_v2` surfaces as `mcp__entwurf_bridge_entwurf_v` — the trailing digit is eaten by
the charset, not by the length cap. The live tool list is the acceptance oracle; a live
session mounts all seven.

**And the NAME is not the invocation. Under omp's default settings an MCP tool is not a
function the model calls — it is a virtual file it writes to.** `tools.xdev` (boolean,
**default on**) mounts "discoverable" tools as `xd://<tool>` devices and DROPS them from the
top-level toolset; the model then reads `xd://<tool>` for the schema and *writes* the JSON
argument object to `xd://<tool>` to execute it. `tools.xdevDocs` (**default `builtins`**)
keeps built-in docs inline while MCP and extension schemas stay off-prompt until read. That
default costs a real capability. `[측정]` 2026-08-28, omp/18.0.0: with the defaults, a plain
"send this message to garden id X" produced a `write` to `xd://…entwurf_peers` (a LISTING)
and then the sentence "보냈습니다" — no `entwurf_v2` call, nothing enqueued, `lastEnqueuedAt`
unchanged. Discovery and delivery share one verb (`write`) and neither schema was in the
prompt. The vendor has hit the same shape in its own toolset: its changelog records
`web_search` becoming unreachable under `tools.xdev: true` because the mount dropped it from
top-level (`Tool web_search not found`, upstream #5973), fixed by pinning it via
`XDEV_KEEP_TOP_LEVEL` — a pin no MCP tool has.

`read xd://` reports exactly what the default hides. `[측정]` on a host with only this
bridge registered, **11 devices**: omp's own `ast_edit`, `debug`, `lsp`, `browser`, plus all
seven `entwurf_*`. So the default does not merely wrap entwurf — it wraps omp's own LSP and
debugger too.

**`entwurf setup` writes this for a detected omp host, and `entwurf install-omp-config` is
the repair leaf. The value they own:**

```yaml
# ~/.omp/agent/config.yml
tools:
  xdev: false      # every enabled tool top-level — MCP is MCP again
```

Nothing is disabled by that: the setting's own text is *"Disable to expose every enabled tool
top-level"*, and it moves tools rather than removing them. `[측정]` with `xdev: false` the
same plain-language request produced a first-try `mcp__entwurf_bridge_entwurf_v` function
call carrying a correct `intent`, the marker landed in the target mailbox, `read xd://`
answered `xd:// is not mounted in this session.`, and `lsp` / `debug` / `browser` /
`ast_edit` were all present top-level. The cost is prompt size: the system prompt's
non-message tokens went 18,707 → 21,834 (+3,127, +17%) on that host.

Two boundaries worth carrying:

- **`xd://` resolution devices survive the switch.** omp's plan mode and every staged-action
  finalization write to `xd://propose` / `xd://resolve` / `xd://reject`, and its plan prompt
  names them unconditionally — so "turn xdev off" looks like it should break planning. It
  does not: the write dispatcher matches the resolution devices BEFORE the mount check.
  `[측정]` with `xdev: false`, plan mode reached `write xd://propose` and the approval dialog
  normally.
- **The narrow alternative keeps the wrapper.** `tools.xdevInlineDevices:
  ["mcp__entwurf_bridge_*"]` inlines only our schemas (+1,013 tokens instead of +3,127) and
  also fixed the send in the same measurement — but the 11 devices stay off top-level, `lsp`
  included, and the listing/delivery verb stays shared. Prefer it only on a host carrying so many MCP servers
  that the full top-level toolset is the larger problem.

All of the above is measured against omp 18.0.0 and is a setting, not a contract: re-measure
at a vendor upgrade.

Registration is tools, not identity: sending needs the birth extension
(`install-omp-bridge`), whose sender marker is keyed to the omp host's OWN pid — omp runs
its extensions in-process, so the marker's owner, the host, and the MCP child's parent are
one pid rather than the two-process join Claude and Copilot have. An omp session is a
citizen only in the operator-visible TUI; task subagents borrow its tools under its garden
id and never receive a second address.

#### External-host skills and commands

MCP registration gives the external harness the tools; the host still needs workflow guidance. Put the Mitsein-over-MCP (cross-harness collaboration) rules in that host's instruction file or, when supported, as a host-native skill. Do not assume pi slash commands are portable across external hosts — if a workflow must work across Claude Code, Codex CLI, Antigravity, OMP, and future hosts, make it a skill or MCP tool rather than a command shortcut.

For the maintained multi-harness setup and skill/command packaging details, see
[agent-config](https://github.com/junghan0611/agent-config). See also the
[concept primer](../README.md#concept-primer), the sender-envelope contract in
[AGENTS.md](../AGENTS.md), and [custom skills](../README.md#custom-skills).
