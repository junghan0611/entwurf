# AGENTS.md — Maintainer Guidelines for pi-shell-acp

For agents that own this repo. Invariant principles + reproducible verification, not specs that change.

## What This Repo Is

ACP bridge provider that connects pi to ACP backends (Claude Code, Codex). Pi stays the harness; each backend keeps its own identity. Two layers:

- **Layer A — ACP bridge**: provider registration, ACP subprocess lifecycle, session bootstrap (`resume > load > new`), prompt forwarding, event mapping, MCP injection
- **Layer B — Entwurf orchestration**: spawn/resume, target registry, identity preservation, MCP adapter (`pi-tools-bridge`), session bridge (`session-bridge`)

## Code Principle — Crash, Don't Warn

Code in this repo is used as a tool by agents. Core invariant:

> **Never warn. Throw.**

When an agent sees a warning, it interprets it as "I did something wrong" and starts flailing — rewording prompts, building workarounds, apologizing. The actual problem is the tool is broken, but the agent blames itself.

- Bad config → throw (e.g. `McpServerConfigError`); same for bad path / bad model id. No fallback.
- `catch {}` only for environment probing (optional package detection, ldd exit code variance).
- `console.warn` only in stderr diagnostic lines (read by operators, not agents).

## Hard Rules

1. **One surface name**: provider `pi-shell-acp`, model `pi-shell-acp/...`, settings `piShellAcpProvider`. No legacy aliases.
2. **Bootstrap order**: `resume > load > new`. Always.
3. **Session persistence**: only `pi:<sessionId>` is persisted. `cwd:<cwd>` is never persisted.
4. **MCP injection**: only via `piShellAcpProvider.mcpServers`. No ambient `~/.mcp.json` scanning.
5. **Config change → session invalidation**: backend or `mcpServers` change automatically invalidates the persisted session. No stale reuse.
6. **Shutdown → preserve mapping**: ordinary process exit keeps persisted mapping intact.
7. **Backend-claim → backend-verification (per backend on the README surface)**: if the repo claims Claude + Codex + Gemini support, each must pass `./run.sh smoke-<backend>` and the relevant slice of `check-backends` / `check-models`. `smoke-all` runs Claude + Codex unconditionally and Gemini when `gemini` is on PATH; absence is documented as a skip, not silent green.
8. **This bridge is not a second harness**: no prompt reconstruction, no transcript hydration, no tool result ledger, no Claude Code emulation.
9. **Identity carrier + whitelist overlay design** (per backend): pi-shell-acp borrows each backend's *model API behavior and tool implementations*, but shapes the pi-facing operating surface explicitly. The model remains Claude, codex GPT-5, or Gemini; pi-shell-acp owns the bridge carrier, MCP/tool exposure, and operator-config overlay design.
   - **Carrier**: Claude gets `_meta.systemPrompt = <engraving>` (preset replacement, in-protocol). Codex gets `-c developer_instructions=<engraving>` (developer-role injection at child-spawn, child arg). Gemini gets `GEMINI_SYSTEM_MD = <overlay>/system.md` (file replacement of native body, env+file). All three are full-replacement carriers reaching the same prompt slot kind in the model — string vs file is a delivery shape difference, not an authority difference. Do not append hidden identity copy elsewhere on any backend.
   - **Overlay**: Claude uses `CLAUDE_CONFIG_DIR=~/.pi/agent/claude-config-overlay/`; Codex uses `CODEX_HOME` and `CODEX_SQLITE_HOME` under `~/.pi/agent/codex-config-overlay/`; Gemini uses `GEMINI_CLI_HOME=~/.pi/agent/gemini-config-overlay/` (which gemini-cli reads as `<fakeHome>/.gemini/`). Whitelist only auth/runtime state via symlink; hide operator memory, history, rules, hooks, agents, sessions, project maps, trust state, and personal config by default. Gemini overlay also authors `system.md` (carrier), `policies/admin.toml` (tool surface narrowing at priority tier 5.x), and a 14-key `settings.json` closure (subagents off, skills/hooks/folder-trust/write_todos off, `tools.core` 7-name capability split, `mcp.allowed` 2 + `excluded:["*"]`, `context.fileName` sentinel + `memoryBoundaryMarkers:[]` to suppress `GEMINI.md` hierarchical discovery).
   - **Tool surface**: Claude tools are explicit (`Read`, `Bash`, `Edit`, `Write`, plus `Skill` when configured) with deferred Claude tools disallowed by default. Codex mode/feature gates are pinned via `-c` flags and `codexDisabledFeatures`. Gemini ships `tools.core` 7-name allow + `--admin-policy` deny-all + same 7-name allow at priority tier 5.x — defense in depth at registry and policy layers. The 7 names are 4 capability classes (Read = `read_file`/`list_directory`/`glob`/`grep_search`, Write = `write_file`, Edit = `replace`, Exec = `run_shell_command`); naming is backend-specific, the operating-surface boundary is the same. MCP enters only through `piShellAcpProvider.mcpServers` for all three backends. Gemini also accepts http/sse MCP transports natively, but the bridge's stdio MCPs flow through the same `mcpServers` parameter.
   - **MCP function-schema asymmetry (Gemini)**: Gemini ACP accepts MCP servers via `mcpServers` but does not register them as model-visible function-schema entries the way Claude and Codex do. Models route MCP calls through `run_shell_command` instead of direct function calls. This is a Gemini ACP surface property, not closable from the overlay — record it honestly in user-facing docs rather than papering over.
   - **Compaction vs isolation**: `PI_SHELL_ACP_ALLOW_COMPACTION=1` may relax compaction guards, but must not drop identity-isolation env (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, `GEMINI_CLI_HOME`, `GEMINI_SYSTEM_MD`). All five are operator-config-isolation invariants, not policy choices the compaction toggle controls.
   - **Evidence discipline**: README/AGENTS claims must not outrun [VERIFY.md](./VERIFY.md)'s Evidence Levels and Claims Ledger. If a statement is design intent rather than verified behaviour, say so.
10. **SDK surface calls must use the typed connection.** `(session.connection as any).METHOD()` is debt, not a workaround. ACP SDK methods (`prompt`, `cancel`, `loadSession`, `resumeSession`, `closeSession`, `unstable_setSessionModel`, …) are typed on `ClientSideConnection`; an `as any` cast there silently survives an SDK rename and ships a dead call. We learned this the hard way in 0.4.5 when SDK 0.20.0's `resumeSession` rename meant every bootstrap silently fell through to `load`, violating Hard Rule #2 for months. The fix is structural, not vigilance:
    - Prefer `session.connection.method(...)` directly. Let tsc fail on rename.
    - If a method genuinely isn't typed yet (rare, transitional), annotate the cast site with `// SDK_CAST_OK: <reason>` (permanent gap) or `// SDK_CAST_DEBT: <reason>` (tracked for removal at next deps bump).
    - The `./run.sh check-sdk-surface` static gate enforces the marker. Pre-commit blocks unannotated `(connection as any)` casts in `acp-bridge.ts`.

## Verification

Two axes, both required.

**Protocol smoke** (`./run.sh`):

```bash
./run.sh setup /path/to/consumer-project    # one-shot install + all gates
pnpm typecheck && ./run.sh check-backends && ./run.sh check-models && ./run.sh check-mcp && ./run.sh check-dep-versions && ./run.sh check-sdk-surface && ./run.sh check-registration
./run.sh smoke-all /path/to/project         # Claude + Codex runtime (Gemini joins when `gemini` is on PATH)
./run.sh verify-resume /path/to/project     # cross-process continuity
./run.sh check-bridge /path/to/project      # MCP bridge visibility + invocation
./run.sh sentinel /path/to/project          # 6-cell entwurf matrix
./run.sh session-messaging /path/to/project # 4-case cross-session messaging
```

**Agent-driven verification** ([VERIFY.md](./VERIFY.md), Evidence Levels L0–L5): self-recognition and transcript agreement are usually L1; objective MCP calls are L2; on-disk/process corroboration is L3; direct-native comparison is L4; long-haul soak is L5.

If any gate fails, or a claim drops below the evidence level it needs, do not commit. Pipes can be connected and the water can still taste wrong.

## Context Carriers

### Engraving

Optional operator-authored personal text delivered at session bootstrap. Lives in [`prompts/engraving.md`](./prompts/engraving.md). Keep it short; empty/missing files are skipped.

- Claude: `_meta.systemPrompt = <engraving>` (string-form preset replacement)
- Codex: `-c developer_instructions=<engraving>` at child spawn (developer-role injection — codex-acp has no `_meta.systemPrompt` surface)
- Gemini: `GEMINI_SYSTEM_MD = <overlay>/system.md` written by `ensureGeminiConfigOverlay()` at every spawn; gemini-cli reads it as the full replacement of the native "Instruction and Memory Files" body. File equivalent of Claude's string carrier. The overlay always appends a carrier-isolation canary line (`GEMINI_SYSTEM_MD_CANARY_PISHELLACP_V1`) so a baseline operator can verify `GEMINI_SYSTEM_MD` actually reaches the model's system prompt slot.
- Template variables: `{{backend}}`, `{{mcp_servers}}` — injected dynamically when present

Do not put AGENTS.md, bridge identity narrative, tool catalogs, or long pi operating context here. Large Claude system-prompt carriers can route Claude Code OAuth sessions to metered "extra usage" billing.

### First-user pi context augment

Bridge identity, pi operating context, `~/AGENTS.md`, `cwd/AGENTS.md`, and date/cwd ride a one-shot first user-message prepend (`pi-context-augment.ts`), not the system/developer carrier. The actual callable tool schema exposed by the backend remains the source of truth; the augment describes capabilities and tells agents not to assume a tool exists merely because docs mention it.

Entwurf-spawned first prompts already contain `cwd/AGENTS.md` in `<project-context ...>` tags. The bridge removes only that duplicate cwd AGENTS section from its augment while preserving home AGENTS, bridge narrative, pi base, and date/cwd.

## Entwurf

Uses `entwurf` instead of `delegate` to avoid collisions with existing pi ecosystem delegation terms.

- Spawning creates a sibling, not a worker
- Default mode is `sync`; async is opt-in (Phase 0.5)
- Target registry: `pi/entwurf-targets.json` (SSOT — bare model IDs auto-resolve here, native preferred; ACP route requires explicit `provider="pi-shell-acp"`)
- Identity Preservation Rule: model override is not allowed on resume

> **Naming pair.** *Entwurf* (기투, projection-of-self) lives here in pi-shell-acp — the mechanism by which a resident agent throws siblings forward (spawn / resume / messaging). The resident-side counterpart is *Mitsein* (공존, being-with), documented in [`agent-config/home/MITSEIN.md`](https://github.com/junghan0611/agent-config/blob/main/home/MITSEIN.md). pi-shell-acp owns the entwurf surface; resident-side conventions live in agent-config.

### Send-is-throw

Messages are thrown, not awaited.

- `entwurf_send`: fire-and-forget. No `wait_until` on the MCP bridge.
- If you need a reply, say so in the message itself.
- If you need to own the outcome, use `entwurf(mode=async)` + `entwurf_resume`.

## File Structure

| File | Purpose |
|------|---------|
| `index.ts` | provider registration, settings, shutdown |
| `acp-bridge.ts` | ACP lifecycle, cache, `resume > load > new` |
| `event-mapper.ts` | ACP events → pi events |
| `engraving.ts` + `prompts/engraving.md` | optional operator personal engraving carrier |
| `pi-context-augment.ts` | first-user pi context augment (`~/AGENTS.md`, cwd AGENTS, bridge narrative, date/cwd) |
| `protocol.js` | dependency-free shared wire constants (`<project-context` marker). Single source for both tsc-emit (root `allowJs: true`) and Node `--experimental-strip-types` (MCP bridges) paths. Authored as `.js` because strip-types resolves literal `.js` imports and root tsc cannot enable `allowImportingTsExtensions` without losing emit. |
| `run.sh` | install, smoke, verify, sentinel |
| `pi-extensions/` | entwurf spawn + control plane + shared core |
| `pi/entwurf-targets.json` | spawn target allowlist |
| `mcp/pi-tools-bridge/` | `entwurf`, `entwurf_resume`, `entwurf_send`, `entwurf_peers` |
| `mcp/session-bridge/` | Claude Code ↔ pi session bridge |

## Typecheck Boundary

Single fence — every `.ts` source file in this repo is reached by some `tsc --noEmit` pass. No opt-out file. The fence is composed of two configs because the two surfaces run under different runtime models:

| Config | Covers | Runtime model |
|---|---|---|
| `tsconfig.json` (root) | `index.ts`, `acp-bridge.ts`, `engraving.ts`, `event-mapper.ts`, `pi-extensions/**` | emit-capable. `./run.sh check-models` tsc-emits the project entry into `.tmp-verify-models/` for runtime introspection, so the root config must not set `noEmit`. |
| `mcp/tsconfig.json` (extends root) | `mcp/pi-tools-bridge/**`, `mcp/session-bridge/**`, plus the `pi-extensions/lib/*` they import | `node --experimental-strip-types`. Adds `allowImportingTsExtensions` + `noEmit` because the bridges import each other (and the shared lib) with explicit `.ts` suffixes — Node's strip-types resolver requires the suffix on the wire. |

`pnpm typecheck` runs both passes. `pnpm check` runs both as part of the release gate; the husky pre-commit hook does too. Adding a new `.ts` file outside both configs is a fence breach — either include it or split a third config with a documented runtime model, but never extend the root `exclude`. The historical exclude entries (`pi-extensions/entwurf-control.ts`, `mcp/*`) hid real type drift; do not reintroduce them.

Code-level invariants pinned at the same time:

- **typebox single-source.** `pi-extensions/entwurf-control.ts` and `pi-extensions/entwurf.ts` both import `Type` / `StringEnum` from `@mariozechner/pi-ai` (which re-exports typebox 1.x). `@sinclair/typebox` is not a direct dependency. Mixing the two universes silently widens `StringEnum`-typed parameters to `unknown`, which only surfaces under typecheck — i.e., it was hidden by the old fence breach.
- **sessionId-only addressing for entwurf.** Every entwurf addressing surface — in-process tool params, MCP `entwurf_send` / `entwurf_peers`, the entwurf-control RPC, the `/entwurf-send` slash command, CLI `--entwurf-session` — takes a sessionId (UUID). The `<sender_info>` payload still carries an optional `sessionName` because that is identity *broadcast* (display-only), not addressing. The asymmetry is documented inline at the `SenderInfo` declaration in `entwurf-control.ts`.
- **session-bridge surface boundary.** `mcp/session-bridge/` keeps a human-aliased addressing surface on purpose — a different audience (Claude Code operators typing readable names) and a different cost/benefit (one-shot alias write at startup via atomic symlink-into-tmp + rename, no polling timer, no race window). The divergence from the entwurf surface is documented at the top of `mcp/session-bridge/src/index.ts`. If the two are ever bridged, do not promote `sessionName` to a primary address on the entwurf side.

When a future change requires extending the schema-to-type inference (TS2589 paths, new `StringEnum`-typed params), see the comment block in `registerSessionTool` for the two concrete revisit conditions that would let the explicit `EntwurfSendParams` annotation collapse back into a single source.

## Runtime Dependencies

- `@agentclientprotocol/claude-agent-acp` — resolved from this package dependency first; `claude-agent-acp` on PATH is fallback.
- `codex-acp` — resolved from PATH. Install globally when using Codex.
- `claude` CLI — Claude Code authentication, managed separately.

Versions follow the pins in `package.json` / `run.sh`. Mismatches are caught by `check-dep-versions`.

## Working Style

- Surgical changes. One thing at a time.
- Ask: does this belong in pi? In Claude Code? Or here?
- Keep docs calibrated: strong language is fine; unbacked language is not.
- Resist the urge to make the bridge more magical than necessary.

## References

- [VERIFY.md](./VERIFY.md) — agent-driven verification guide. Carries two distinct frameworks: **Evidence Levels L0–L5** (cross-doc rung ladder for any claim — narrative / transcript / MCP call / on-disk / direct-native / soak) and the **§1A Layer 0–4 interview** (main-agent evaluation: self-awareness / native-tool use / MCP boundary / focus / direct-Claude comparison). Do not conflate them — a claim's evidence-level rung and a §1A layer are independent axes.
- [BASELINE.md](./BASELINE.md) — operator-driven verification record (Junghan runs the interview directly; results recorded). Companion to VERIFY.md, not a replacement.
- [agent-shell](https://github.com/xenodium/agent-shell) — Emacs ACP client, origin of `resume > load > new`
- [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) — ACP server
- [agent-config](https://github.com/junghan0611/agent-config) — real consumer repo
