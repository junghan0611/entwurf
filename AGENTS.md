# AGENTS.md — Maintainer Guidelines for pi-shell-acp

For agents that own this repo: invariant principles + reproducible verification, not release-story drift.

## North Star — One Forged Screwdriver

Hold this shape before editing: `pi-shell-acp` is not a Swiss-army knife and not a second harness. It is a forged screwdriver — small, explicit, strong at the contact points it owns.

- **pi is the harness.** This repo must not compete with pi's session model, transcript, UI, or tool semantics.
- **Backends keep identity.** Claude Code, Codex, and Gemini remain themselves. The bridge does not impersonate them or normalize away their native surfaces.
- **The bridge aligns the pi-facing operating surface.** It owns carrier delivery, MCP injection, operator-config isolation, event mapping, and entwurf wiring — no more magic than that.
- **Explicit beats ambient.** No hidden transcript hydration, no ambient MCP scanning, no invisible tool claims, no giant magical system prompt, no unverified narrative.
- **Entwurf opens siblings, not workers.** A spawned/resumed session is a runtime-isolated peer with identity-preservation rules, not a subagent accessory whose authority boundary disappears.
- **Evidence disciplines language.** If README / AGENTS / CHANGELOG / VERIFY / BASELINE / runtime smoke do not support a claim, weaken or remove it.

When reviewing docs, keep release stories in orbit. The center is thin bridge / explicit MCP / sibling-based entwurf / observability / semantic continuity / evidence-first language.

## What This Repo Is

ACP bridge provider connecting pi to Claude Code, Codex, and Gemini. Pi stays the harness; each backend keeps identity.

- **ACP bridge**: provider registration, subprocess lifecycle, `resume > load > new`, prompt forwarding, event mapping, MCP injection.
- **Entwurf orchestration**: spawn/resume, target registry, identity preservation, `pi-tools-bridge`, `session-bridge`.

## Code Principle — Crash, Don't Warn

Code in this repo is used by agents as infrastructure.

> **Never warn. Throw.**

Warnings make agents blame themselves and flail. Broken tool state must surface as broken tool state.

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
9. **Identity carrier + whitelist overlay design**: borrow each backend's model/API/tools; shape only the pi-facing surface.
   - **Carrier**: Claude `_meta.systemPrompt=<engraving>`, Codex `-c developer_instructions=<engraving>`, Gemini `GEMINI_SYSTEM_MD=<overlay>/.gemini/system.md`. All are full-replacement identity carriers; string vs file is delivery shape, not authority. Do not append hidden identity elsewhere.
   - **Overlay**: Claude `CLAUDE_CONFIG_DIR`, Codex `CODEX_HOME` + `CODEX_SQLITE_HOME`, Gemini `GEMINI_CLI_HOME`. Whitelist auth/runtime state; hide operator memory, history, rules, hooks, agents, sessions, project maps, trust, and personal config. Gemini also authors `system.md`, `policies/admin.toml`, and a 16-key `settings.json` closure; `ensureGeminiConfigOverlay` sweeps `<configDir>/{tmp,history,projects}/` every spawn.
   - **Tool/MCP surface**: Claude exposes explicit `Read/Bash/Edit/Write` (+ `Skill` when configured); Codex is narrowed by `-c` flags + `codexDisabledFeatures`; Gemini uses `tools.core` 7-name allow + deny-all admin policy. MCP enters only through `piShellAcpProvider.mcpServers`. Gemini's MCP function-schema asymmetry is observed backend behaviour: accepted transport, shell-mediated use, no direct function-schema advertise.
   - **Memory containment (L5)**: pi owns persistence (semantic-memory + Denote llmlog). Claude, Codex, and Gemini native memory layers are pinned off; Gemini also sweeps memory dirs and defuses `${...}` engraving literals with U+200B before `system.md` write.
   - **Compaction / evidence**: `PI_SHELL_ACP_ALLOW_COMPACTION=1` may relax compaction guards, never identity-isolation env. README/AGENTS claims must fit VERIFY/BASELINE/runtime evidence; weaken unbacked claims.
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

**Agent-driven verification** ([VERIFY.md](./VERIFY.md)): self-recognition/transcript agreement ≈ L1; objective MCP calls L2; on-disk/process L3; direct-native L4; soak L5.

If a gate fails or a claim drops below its needed evidence level, do not commit. Pipes can be connected and the water can still taste wrong.

## Context Carriers

### Engraving

Optional short operator-authored personal text in [`prompts/engraving.md`](./prompts/engraving.md); empty/missing files are skipped. Delivered through Claude `_meta.systemPrompt`, Codex `developer_instructions`, or Gemini `GEMINI_SYSTEM_MD` (with carrier canary `GEMINI_SYSTEM_MD_CANARY_PISHELLACP_V1`). Template variables: `{{backend}}`, `{{mcp_servers}}`.

Do not put AGENTS.md, bridge narrative, tool catalogs, or long pi context here. Large Claude carriers can route OAuth sessions to metered "extra usage" billing.

### First-user pi context augment

Bridge identity, pi context, `~/AGENTS.md`, `cwd/AGENTS.md`, and date/cwd ride a one-shot first-user prepend (`pi-context-augment.ts`), not the system/developer carrier. Callable schema remains source of truth. Entwurf prompts already carry `cwd/AGENTS.md` in `<project-context ...>`; the augment removes only that duplicate.

## Entwurf

Uses `entwurf` instead of `delegate` to avoid ecosystem collisions.

- Spawning creates a sibling, not a worker.
- Default mode is `sync`; async is opt-in.
- Target registry: `pi/entwurf-targets.json`; native preferred, ACP route explicit with `provider="pi-shell-acp"`.
- Identity Preservation Rule: no model override on resume.

> **Naming pair.** *Entwurf* (기투, projection-of-self) lives here in pi-shell-acp — the mechanism by which a resident agent throws siblings forward (spawn / resume / messaging). The resident-side counterpart is *Mitsein* (공존, being-with), defined in the resident's own knowledge base (cwd-scoped, not a global persona). pi-shell-acp owns the entwurf surface; resident-side conventions live where the resident wakes.

### Send-is-throw

Messages are thrown, not awaited.

- `entwurf_send` is fire-and-forget: no `wait_until` on the MCP bridge. If you need a reply, say so in the message; if you need to own the outcome, use `entwurf(mode=async)` + `entwurf_resume`.

## File Structure

| File | Purpose |
|------|---------|
| `index.ts` | provider registration, settings, shutdown |
| `acp-bridge.ts` | ACP lifecycle, cache, `resume > load > new` |
| `event-mapper.ts` | ACP events → pi events |
| `engraving.ts` + `prompts/engraving.md` | optional operator personal engraving carrier |
| `pi-context-augment.ts` | first-user pi context augment (`~/AGENTS.md`, cwd AGENTS, bridge narrative, date/cwd) |
| `protocol.js` | dependency-free shared wire constants (`<project-context` marker), single source for tsc emit + strip-types MCP paths |
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
