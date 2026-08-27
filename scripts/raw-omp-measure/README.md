# raw-omp-measure — OMP v18.0.0 vendor measurement (issue #87)

Lane: `docs/adding-a-harness.md` step 1 (five measurements) + §3.5 LIVE discriminator +
one added axis, **pi-rail overlap** (GLG, 2026-08-27). Measurement only — no
implementation, no minting, no second Claude-MCP writer. The oracle is the vendor
artifact or the vendor process, never our assembler.

Evidence-state vocabulary used below: **[source]** = read at `file:line` in the vendor
checkout; **[host]** = measured on this host (oracle) with the receipt named;
**[LIVE — pending]** = slot the implementer fills from a real omp process; do not close
a slot from recollection.

Source-layer claims were independently re-verified by a second model:
[`source-audit.md`](./source-audit.md) (xai/grok-4.6 fresh sibling, 2026-08-27) —
**20 CONFIRMED / 6 CORRECTED / 0 UNRESOLVED**. Corrections are folded below and marked
`audited`; the audit file holds the deep receipts.

## Vendor identity

- Installed: `omp/18.0.0`, ELF aarch64 at `~/.local/bin/omp` **[host]** (`omp --help` header,
  `file` output; oracle, 2026-08-27).
- Source checkout used for `[source]` receipts: `~/repos/3rd/oh-my-pi` at tag `v18.0.0`
  (`02696f5b`) + 2 natives lint commits (`50368368…`, `4142f881` HEAD) — no runtime diff
  vs the tag claimed; treat `file:line` as v18.0.0 coordinates and remeasure at any
  vendor upgrade. All `packages/…` paths below are relative to that checkout.
- State root on this host: `~/.omp/` (`agent/config.yml`, `agent/sessions/<cwd-key>/*.jsonl`,
  `logs/omp.<date>.<pid>.log`, `natives/18.0.0`, `run/daemons`) **[host]**.

## M1 — Hook vocabulary and firing time

- **[source]** omp "hooks" are an **in-process extension event bus**, not spawned hook
  commands. `--hook` is an alias of `--extension`; JS/TS hook factories load as extension
  modules and bind via `pi.on(...)` (`docs/hooks.md` "Current status in runtime").
- **[source]** Event vocabulary (`docs/hooks.md` "Event surfaces",
  `packages/coding-agent/src/extensibility/shared-events.ts`): session_start,
  session_before_switch/switch, session_before_branch/branch, session_before_compact,
  session.compacting, session_compact, session_before_tree/tree, session_shutdown;
  context, before_agent_start, agent_start, agent_end, turn_start, turn_end,
  auto_compaction_start/end, auto_retry_start/end, ttsr_triggered, todo_reminder;
  tool_call (pre) / tool_result (post); mcp_notification; user_bash.
- **[source]** `session_start` emit sites — the NAME does not scope it to the visible host:
  - TUI host: `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts:311`
  - print/rpc runtime init: `packages/coding-agent/src/modes/runtime-init.ts:147`
  - ACP server mode: `packages/coding-agent/src/modes/acp/acp-agent.ts:2603`
  - **every task subagent**: `packages/coding-agent/src/task/executor.ts:3305`
- **[source, audited C1/C2]** Firing time: the TUI host fires after first paint, before
  the first prompt, once per process (`interactive-mode.ts:1221`, `:1238`,
  `extension-ui-controller.ts:309-311`). `/new`, fork, and in-TUI resume re-fire as
  `session_before_switch`/`session_switch` (reasons `"new"`/`"fork"`/`"resume"`,
  `agent-session.ts:6910-8074`), **not** as `session_start` — a birth hook must treat
  `session_switch` as a re-birth edge. The `:531` initialize site is test-only.
- **[LIVE 2026-08-27, observation]** on `/exit`, a `session_shutdown` with a `"print"`
  context fired before the tui one (same run) — shutdown events arrive from non-tui
  contexts too. No fence impact (shutdown is not a birth edge), but a future unit must
  not treat `session_shutdown` as host-scoped.
- **[LIVE 2026-08-27]** `/tmp/omp-probe-live.jsonl`. Host `session_start` at TUI open with **no model turn** (`2026-08-27T10:53:21.125Z`); `agent_start`/`turn_start` only after the typed prompt (`10:55:41.414Z` / `10:55:41.466Z`):
  `{"event":"session_start","pid":479624,"mode":"tui","hasUI":true,"cwd":"/tmp","sessionId":"01a042da-537a-7770-a275-7b8162eecca4","sessionFile":"/home/junghan/.omp/agent/sessions/-tmp/2026-08-27T10-53-19-610Z_01a042da-537a-7770-a275-7b8162eecca4.jsonl"}`

## M2 — Launch form and envelope

- **[source]** Declaration surfaces (`docs/extension-loading.md`): native roots
  `<cwd>/.omp/extensions` and `~/.omp/agent/extensions`; `extensions:` arrays in
  `~/.omp/agent/config.yml`, `<cwd>/.omp/config.yml`, legacy `settings.json`; CLI
  `-e/--extension/--hook`; installed plugin manifests (`omp.extensions`/`pi.extensions`).
- **[source]** Envelope: **no stdin, no per-event child process.** A module
  default-exports `function (pi: ExtensionAPI)`; handlers receive `(event, ctx)` where
  `ctx: ExtensionContext` carries `mode`, `hasUI`, `cwd`, `sessionManager`
  (`packages/coding-agent/src/extensibility/extensions/types.ts:456`).
- Consequence for a future birth unit: the payload runs **inside** the omp process
  (`process.pid` == host pid) — unlike Claude Code's exec'd launcher. Step-6 join-key
  design must start from that fact.
- **[source, audited A5/B1]** Subagent envelope: extension factories are re-executed per
  subagent against a fresh per-session API (`sdk.ts:2000-2028`, `loader.ts:362-443`);
  CLI `-e` paths flow into subagents via `session.extensionPaths` →
  `structured-subagent.ts:442` unless `restrictToolNames`.
- **[LIVE 2026-08-27]** `/tmp/omp-probe-live.jsonl` `pid:479624` equals `ps` omp pid `479624` (ppid `479023` = tmux-server bash). Extension is in-process.

## M3 — Config writer

- **[source]** omp-native writer layer (`docs/mcp-config.md` "Source of truth in code"):
  `packages/coding-agent/src/mcp/config-writer.ts`, targets project `.omp/mcp.json` /
  user `~/.omp/agent/mcp.json` (profile-aware). General settings: `omp config` CLI →
  `~/.omp/agent/config.yml`.
- **[host]** `~/.omp/agent/config.yml` exists (modelRoles.default
  `openai-codex/gpt-5.6-terra:high`, statusLine.separator ascii, plan.enabled). **No
  omp-native mcp.json exists anywhere on this host.**
- **[source]** Import layer (borrowed, not owned): translates Claude Code
  (`~/.claude.json`, `~/.claude/mcp.json`, project `.claude/.mcp.json`/`.claude/mcp.json`),
  Codex, Gemini, OpenCode, Cursor, Windsurf, VS Code (`docs/mcp-config.md` "Imported tool
  configs"); cross-provider precedence puts OMP-native first, Claude Code third
  (`docs/mcp-config.md` "Discovery and precedence").
- **[host]** The only effective entwurf-bridge source omp can see here is
  `~/.claude.json` user `mcpServers.entwurf-bridge` =
  `bash /home/junghan/repos/gh/entwurf/mcp/entwurf-bridge/start.sh` with
  `ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code`. **Borrowed-config
  finding:** an omp session riding the import would hand the bridge Claude Code's
  external id — wrong provenance for an omp citizen. This is evidence for the issue's
  fence (imported config is borrowed), not a request to clone a second Claude writer.
- **[LIVE 2026-08-27]** TUI `/mcp list` pane (O1 key): `Claude Code (~/.claude.json):` / `entwurf-bridge ● connected`. Bridge child `479695` ppid `479624`; `/proc/479695/environ` has `ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code`. Server key string is the plain `mcpServers` name **`entwurf-bridge`**.
- **Design stance (GLG, 2026-08-27):** treat OMP as an independent harness — model the
  operator who never used Claude Code. The Claude import path is never a support
  surface. The future MCP hand is an omp-native writer targeting `~/.omp/agent/mcp.json`
  (vendor writer layer above), whose same-named entry **shadows** the import by vendor
  precedence (OMP-native first, Claude Code third). Vendor-owned controls exist if ever
  needed: user-level `disabledServers` denylist (highest precedence) and
  `mcp.enableProjectConfig` (`docs/mcp-config.md:84-93`, `:426-441`, `:521`); the vendor
  itself never mutates another tool's config (`:441`).
- **[LIVE — deferred]** native-entry shadowing receipt (omp-native `entwurf-bridge` in `~/.omp/agent/mcp.json`) not taken this run — no omp config writes. O2 (`disabledServers` × equivalence) also deferred to the implementation lane.
- **[source, cross-review (3)]** Shadowing contract (external review Defect-1, accepted
  amended): the future native writer must pin the **same server key** as the imported
  entry — the literal `mcpServers` map key `entwurf-bridge` — gate-pinned. Same-key
  first-wins fully suppresses the import even when env differs
  (`capability/index.ts:203-207`; `equivalent` is never consulted on a key hit), which
  is exactly the label swap this stance wants. Never use
  `disabledServers: ["entwurf-bridge"]` to hide the import while a native entry exists —
  suppression is by name and kills **both** (`mcp/config.ts:123-127`,
  `capability/index.ts:191-196`).
- **[source, audited I1/F1/F4]** Writer shape and precedence in code: user file
  `~/.omp/agent/mcp.json` = `{ $schema, mcpServers: { <name>: { command, args?, env? } } }`
  (`mcp/config-writer.ts:111-143`, `config/mcp-schema.json`); discovery priority
  native=100 > omp-plugins=90 > **claude=80** > … > mcp-json=5 with first-wins dedupe
  (`capability/index.ts:84-91`, `:183`), project-before-user inside each provider; the
  vendor never mutates another tool's config (`config-writer.ts:301-304`) and toggles
  imported servers only via user `disabledServers`/`enabledServers` (`mcp/config.ts:104-127`).

## M4 — Statusline / receive surfaces

- **[source — CORRECTED, audited H2/H3]** Visible identity: `setStatus(...)`
  (`types.ts:284`) is the **only** rendering surface — the TUI maps it to hook-status
  lines under the status line (`extension-ui-controller.ts:110`,
  `status-line/component.ts:678-682`, `:2246-2251`), gated by
  `statusLine.showHookStatus` default **true** (`settings-schema.ts:952-956`).
  `setFooter`/`setHeader` are **TUI no-ops** at v18 (`extension-ui-controller.ts:139`).
  The built-in statusLine's segments are a closed enum with **no custom-text/command
  segment** (`status-line/segments.ts:731-757`) — no Copilot-style `statusLine.command`
  route exists. Step-4 visible identity must ride `setStatus`.
- **[source]** Wake surfaces: `pi.sendUserMessage(content, {deliverAs})` — **"idle
  starts a turn"** (`types.ts:1418`); `pi.sendMessage(..., {triggerTurn, deliverAs})`
  (`types.ts:1412`); contained `ctx.setInterval`/`setTimeout` for background watches;
  `mcp_notification` events can be bridged into a turn (`types.ts` McpNotificationEvent).
  Feature gate: extensions are on by default; `--no-extensions` disables discovery.
- Other surfaces that exist but are NOT measured here: `--mode rpc`, `omp acp`,
  `omp ps` daemons, collab `join`. Naming them is step-1 inventory, not a claim.
- **[LIVE — pending]** none required this branch — idle-wake demonstration is step 7
  work and needs its own lane; this branch only inventories the surfaces.

## M5 — Parent process topology

- **[source]** Extensions are in-process → the "hook process" IS the omp host process.
- **[source]** MCP stdio servers are spawned by the omp process; on Linux
  `detached: true` → setsid (own session, no controlling terminal) but still a direct
  child (`packages/coding-agent/src/mcp/transports/stdio.ts:41-57`, `:334`).
- Expected join: `extension process.pid == omp pid == mcp child ppid` — a one-process
  join, structurally simpler than Claude's hook-launcher/pid-marker join.
- **[source, audited G1/G2]** Child env is `{ ...Bun.env, ...this.config.env }`
  (`transports/stdio.ts:577-581`) — full parent env inherited, entry env merged on top,
  **no omp-injected session/agent id**; setsid does not reparent (ppid stays omp pid);
  teardown signals the process group then SIGKILLs after grace (`stdio.ts:474-494`).
- **[LIVE 2026-08-27]** same run (`ps -o pid,ppid,sid,args`):
  `479023 185520 479023 -bash` (tmux server child)
  `479624 479023 479023 omp --cwd /tmp -e …/probe-extension.ts`
  `479695 479624 479695 node …/mcp/entwurf-bridge/src/index.ts` (own SID = setsid; ppid = omp).
  Join: probe pid == omp pid == bridge ppid.

## §3.5 — Host-vs-subagent discriminator

- **[source]** `ExtensionMode = "tui" | "rpc" | "json" | "print"` and `ctx.hasUI`
  (`extensibility/extensions/types.ts:453`, `:465`).
- **[source]** Runner default `#mode = "print"` (`extensibility/extensions/runner.ts:438`,
  `:651`); only the interactive TUI controller passes `"tui"`
  (`modes/controllers/extension-ui-controller.ts:302`, `:531`); rpc passes `"rpc"`
  (`modes/rpc/rpc-mode.ts:961`).
- **[source]** Task subagents: `hasUI: false` (`task/executor.ts:3115`); their runner is
  initialized **without** a mode argument (`executor.ts:3252`) → `"print"`; each emits its
  own `session_start` (`executor.ts:3305`). Subagents inherit extensions AND parent MCP
  via proxy tools unless `restrictToolNames` (`executor.ts:3021-3024`, `:3096`) — so a
  birth extension WILL fire inside subagents; the discriminator is the only fence.
- **[source — CORRECTED, audited A1/A2/A4/B2]** Full host-mode matrix: plain TUI →
  `"tui"`; `-p`/`--mode text|json` → `"print"`/`"json"`; `--mode rpc|rpc-ui` and
  `omp acp` → `"rpc"`. **`ExtensionContext.hasUI` is NOT a fence**: rpc, rpc-ui, and ACP
  all pass a real uiContext so `hasUI === true` (`runner.ts:879-881`); the `types.ts:465`
  comment ("false in print/RPC mode") disagrees with code — a live instance of the §1(c)
  docs-vs-code trap. ACP loads discovered extensions and emits `session_start`
  (`main.ts:434-449`, `acp-agent.ts:2603`) but a `mode === "tui"` guard stays silent.
  Bundled task agents do **not** set `restrictToolNames` (it is a spawn option:
  plan-mode/security/compress, `structured-subagent.ts:386`) — default subagents DO load
  extensions, so the discriminator is load-bearing, and it is `mode` **alone**.
- **[LIVE 2026-08-27, decisive]** `/tmp/omp-probe-live.jsonl`. Discriminator **held**, same pid `479624`, different session ids/files:
  host `10:53:21.125Z` `{"event":"session_start","mode":"tui","hasUI":true,"sessionId":"01a042da-537a-7770-a275-7b8162eecca4","sessionFile":"…/-tmp/2026-08-27T10-53-19-610Z_01a042da-537a-7770-a275-7b8162eecca4.jsonl"}`
  subagent `10:55:47.906Z` `{"event":"session_start","mode":"print","hasUI":false,"sessionId":"01a042dc-9540-7643-b3ef-99d223b459a9","sessionFile":"…/-tmp/2026-08-27T10-53-19-610Z_01a042da-537a-7770-a275-7b8162eecca4/Greeting.jsonl"}`
  Record store `~/.pi/agent/meta-sessions` regular files: **519 before, 519 after**.
- **[source, cross-review (4)]** ACP sessions skip on-disk MCP discovery
  (`main.ts:446`) but client-supplied MCP still connects
  (`acp-agent.ts:2608-2669`) — `enableMCP:false` is NOT a second fence; the tui guard
  and the bridge's default send refusal remain the fences.
- Stop rule (issue #87): if the discriminator flips at any vendor upgrade, stop —
  do not pile heuristics.

## Tool-name dialect (step 5 pre-measurement)

- **[source]** Mint: `mcp__${sanitizedServerName}_${normalizedToolName}` capped at 64
  chars (`packages/coding-agent/src/mcp/tool-bridge.ts:396`); sanitizer lowercases,
  replaces `[^a-z_]+` runs with `_`, collapses `_+`, trims edges (`tool-bridge.ts:351`);
  redundant server-prefix stripping documented at `:344-349`.
- Computed for entwurf-bridge: `entwurf_v2` → `mcp__entwurf_bridge_entwurf_v` (digit
  dropped), `entwurf_peers` → `mcp__entwurf_bridge_entwurf_peers`, etc. **The live omp
  tool list is the acceptance oracle**, not this computation.
- **[source, audited E1]** All seven bridge tools computed in the audit (unique, ≤64
  chars, no prefix-strip triggers). The approval layer consults the **same minted
  string** — `tools.approval.<minted name>` (`tools/approval.ts:110`, `mcp__`
  special-case `:261`); MCP tools default `approval: "write"` (`tool-bridge.ts:490`).
  **No second Copilot-style permission dialect.**
- **[LIVE 2026-08-27]** `/tmp/omp-probe-live.jsonl` host `tool_dump_t25` (`10:53:46.128Z`, `mode:"tui"`, `toolCount:28`):
  `["mcp__entwurf_bridge_entwurf_fresh_call","mcp__entwurf_bridge_entwurf_inbox_read","mcp__entwurf_bridge_entwurf_peers","mcp__entwurf_bridge_entwurf_register_native","mcp__entwurf_bridge_entwurf_resume_call","mcp__entwurf_bridge_entwurf_self","mcp__entwurf_bridge_entwurf_v"]`
  Subagent dump (`mode:"print"`, `toolCount:26`) lists the **same seven names** (extensions inherited). Matches source computation; digit in `entwurf_v2` is eaten.

## M6 — pi-rail overlap (added axis, GLG 2026-08-27)

omp is a pi fork and keeps pi's env vocabulary. The entwurf pi rail and the omp rail
must never steer each other through shared knobs.

- **[source]** omp honors `PI_CONFIG_DIR` (default `.omp`) and `PI_CODING_AGENT_DIR`
  (`packages/utils/src/dirs.ts:4-5`, `resolvePreProfileAgentDir` `:338`), plus
  `PI_PROFILE`/`OMP_PROFILE` and `PI_SMOL_MODEL`-family role envs (`omp --help`).
  Entwurf's offline verification sandboxes `PI_CODING_AGENT_DIR` (AGENTS.md Hard Rule
  12) — the same knob now steers TWO harnesses. Any future omp gate/launcher must
  decide explicitly which harness each `PI_*` var is addressing.
- **[source]** `PI_SESSION_ID`/`PI_AGENT_ID` appear **nowhere** in
  `packages/coding-agent/src` — omp does not mint pi identity carriers itself (only
  `MNEMOPI_SESSION_ID`, `packages/mnemopi/src/mcp-tools.ts:434`). The §6 danger is
  pure **inheritance passthrough**: an omp launched from a pi citizen's shell hands the
  parent's pi garden id to its MCP children (`adding-a-harness.md` §6 sanitization).
- **[source — refined, audited G4]** Legacy `.pi` survives **only** as a package.json
  manifest alias (`pkg?.omp ?? pkg?.pi`, `discovery/helpers.ts:616-617`,
  `plugins/loader.ts:267-273`); native discovery roots are `.omp`-only
  (`discovery/builtin.ts:58-72`, `utils/src/dirs.ts:23`) — entwurf's pi extensions under
  `~/.pi/` cannot be ambiently loaded by omp.
- **[source, audited G3]** Identity-adjacent inventory also includes
  `PI_CODING_AGENT_SESSION_DIR` (`cli/args.ts:156`); the full PI_* read inventory
  (40+ non-identity vars included) is in the audit G3 table.
- **[LIVE 2026-08-27]** clean tmux window (preflight `env | grep PI_SESSION_ID|PI_AGENT_ID` → `CLEAN_NO_PI_IDENTITY`). `/proc/479624/environ` and `/proc/479695/environ` grep `PI_SESSION_ID|PI_AGENT_ID|PI_CODING_AGENT_DIR`: **all absent**. Probe path is only the `-e` file (`…/scripts/raw-omp-measure/probe-extension.ts`); no `~/.pi/` extension path in the JSONL. (Bridge still carries borrowed `ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code` — M3, not a PI_* carrier.)

## LIVE procedure (for the implementer sibling)

The probe is `scripts/raw-omp-measure/probe-extension.ts` (repo path). Adjust it freely
against the real API — the file is measurement scaffolding, not product.

1. Fresh tmux window, clean env (no `PI_SESSION_ID`/`PI_AGENT_ID` — verify with `env`).
   `export OMP_PROBE_LOG=<scratch>/omp-probe.jsonl`.
2. `omp --cwd <scratch> -e /home/junghan/repos/gh/entwurf/scripts/raw-omp-measure/probe-extension.ts`
   (default model is fine; turns below are tiny).
3. While idle at the TUI: capture `ps -eo pid,ppid,args | grep -E 'omp|entwurf'` and the
   two `/proc/*/environ` greps (M5, M6). Wait ≥25s for the tool dumps (dialect).
4. One tiny turn: ask the model to spawn exactly one trivial task subagent (e.g. "use
   the task tool to run a subagent that answers 'hi'; nothing else"). This produces the
   §3.5 subagent `session_start` line.
5. Exit. Paste the decisive JSONL/ps/environ lines into the `[LIVE — pending]` slots
   above (receipts must travel; host-local paths alone do not). Name the session file
   under `~/.omp/agent/sessions/` as the vendor-side receipt.
6. Record store safety: count entwurf meta-records before and after; must be identical.

Do NOT: install anything, write any omp config, register a backend, mint a record,
send via `entwurf_v2`, or demonstrate idle-wake (step 7, separate lane).
