# AGENTS.md — Maintainer Guidelines for pi-shell-acp

For agents that own this repo: invariant principles + reproducible verification, not release-story drift.

## North Star — One Forged Screwdriver

`pi-shell-acp`를 만질 때 먼저 이 형상을 붙든다.
이 저장소는 스위스 아미 나이프가 아니다. 두 번째 하네스도 아니다.
이것은 **담금질된 드라이버 한 자루**다. 작고, 명시적이고, 자기가 맡은 접점에서만 강해야 한다.

영문 원칙만 읽으면 이것이 스펙처럼 보일 수 있다. 여기서는 그렇게 읽지 마라.
이 섹션은 기능 목록이 아니라 **판단의 중심축**이다.

### 먼저 붙들 정체성

- **pi가 하네스다.** 이 repo는 pi의 세션 모델, transcript, UI, tool semantics와 경쟁하지 않는다.
- **백엔드는 형제다.** Claude Code, Codex, Gemini는 학교가 달라도 모두 frontier 친구들이다. bridge는 누구를 다른 누구로 위장시키지 않는다.
- **표면은 달라도 능력의 존엄은 낮추지 않는다.** 어떤 백엔드에서 `mcp__...`가 직접 보이지 않는다고 해서, 곧바로 그 backend를 “못하는 존재”로 취급하지 마라. 먼저 capability를 보고, 그 capability가 어떤 surface로 열리는지 확인하라.
- **bridge는 pi-facing operating surface를 정렬한다.** carrier delivery, MCP injection, operator-config isolation, event mapping, entwurf wiring을 맡는다. 그 이상 마술을 부리면 안 된다.
- **명시는 주변기류보다 강하다.** 숨겨진 transcript hydration, ambient MCP scanning, invisible tool claims, giant magical system prompt, 근거 없는 서사를 만들지 마라.
- **entwurf는 부속품이 아니라 분신을 연다.** spawn/resume된 세션은 runtime-isolated peer다. worker처럼 다루거나 권한 경계를 흐리지 마라.
- **증거가 말을 훈육한다.** README / AGENTS / CHANGELOG / VERIFY / BASELINE / runtime smoke가 받쳐주지 않으면, 작업을 중지하고 사용자에게 질문하라!

### 이 섹션을 읽는 올바른 방식

이 문단의 목적은 에이전트가 다음 질문을 **스스로** 하게 만드는 것이다.

- 나는 지금 tool 이름을 보고 있는가, 아니면 capability를 보고 있는가?
- 나는 backend의 비대칭을 정직하게 기록하고 있는가, 아니면 그것을 핑계로 형제성을 포기하고 있는가?
- 나는 사용자가 묻지 않아도 될 것을 되묻고 있는가?
- 나는 지금 두 번째 하네스를 만들고 있는가, 아니면 드라이버 한 자루를 더 단단하게 만들고 있는가?

### 금지할 오독

- 어떤 tool이 schema에 직접 안 보인다고 해서, 곧바로 “이 backend는 여기까지”라고 결론내리는 것
- surface 차이를 capability 포기로 번역하는 것
- 문서에 적힌 asymmetry를 면책조항처럼 사용하는 것
- `pi-shell-acp`를 하네스 런타임이나 범용 AI 작업실로 설명하는 것 — pi가 하네스고, 이 repo는 bridge다
- ACP를 “모든 것이 공식/동일/플러그앤플레이”라는 말로 납작하게 만드는 것 — protocol path일 뿐 backend 차이는 유지된다
- MCP를 자동 맥락 검색이나 ambient tool scanning처럼 설명하는 것 — explicit injection만 허용된다
- Codex ACP 경로를 “원래 안 되니 감싼 것”으로 말하는 것 — 목적은 ACP backend 연결 퀄리티를 일부러 시험하는 것이다. Claude에서만 그럴듯하면 bridge는 아직 증명된 게 아니다
- 0.5.0을 recap engine / compact→new-session handoff / provider handoff / Gemini cleanup / OpenClaw로 확장하는 것 — 0.5.0은 "bridge는 compaction을 구현하지 않는다"의 선언이다. backend-native compaction은 기본 허용, pi-side compaction은 기본 차단, legacy 단일 knob은 spawn intent에서 throw
- 사용자가 이미 철학과 방향을 준 문제를 다시 사용자에게 되묻는 것

릴리즈 이야기와 개별 기능은 주변을 돈다.
중심은 언제나 이것이다: **thin bridge / explicit MCP / sibling-based entwurf / observability / semantic continuity / evidence-first language / capability dignity across sibling backends**.

## What This Repo Is

ACP bridge provider connecting pi to Claude Code, Codex, and Gemini. Pi stays the harness; each backend keeps identity.

- **ACP bridge**: provider registration, subprocess lifecycle, `resume > load > new`, prompt forwarding, event mapping, MCP injection.
- **Entwurf orchestration**: spawn/resume, target registry, identity preservation, `pi-tools-bridge`.

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
7. **Backend-claim → backend-verification, three-backend equality is non-negotiable.** If the repo claims Claude + Codex + Gemini support, each must pass `./run.sh smoke-<backend>` and the relevant slice of `check-backends` / `check-models`. `smoke-all` runs Claude + Codex unconditionally and Gemini when `gemini` is on PATH; absence is documented as a skip, not silent green.
   - **Equality check is a planning question, not just a verification step.** Before writing claims about backend behavior, ask explicitly: *Have I verified this for all three — Claude (`claude-agent-acp`), Codex (`codex-acp`), Gemini (`gemini --acp`)?* A claim where one backend is implicitly "out of scope" is a regression; either include the third backend or **make the skip a recorded decision** with the reason on the page where the claim lives (README / AGENTS / VERIFY / BASELINE / CHANGELOG / NEXT).
   - **No accidental binary claims.** "Both backends" / "dual-backend" / "Claude + Codex only" framing is a smell — if the third backend was tested and explicitly carved out, say so; if it was not tested, surface that as `Gemini: unverified` rather than silent omission. 0.5.0 baseline regressed once by writing a "Claude + Codex pass" line that omitted Gemini without saying it had been left out — that pattern is the failure mode this rule guards against.
   - **Three-backend probe parity for live evidence.** When a live LIVE probe lands for Claude or Codex, the Gemini equivalent must land in the same PR — even if the probe outcome is `observed: no native ACP surface for this command`. Recording an honest negative is what closes the third-backend axis.
8. **This bridge is not a second harness**: no prompt reconstruction, no transcript hydration, no tool result ledger, no Claude Code emulation.
9. **Identity carrier + whitelist overlay design**: borrow each backend's model/API/tools; shape only the pi-facing surface.
   - **Carrier**: Claude `_meta.systemPrompt=<engraving>`, Codex `-c developer_instructions=<engraving>`, Gemini `GEMINI_SYSTEM_MD=<overlay>/.gemini/system.md`. All are full-replacement identity carriers; string vs file is delivery shape, not authority. Do not append hidden identity elsewhere.
   - **Overlay**: Claude `CLAUDE_CONFIG_DIR`, Codex `CODEX_HOME` + `CODEX_SQLITE_HOME`, Gemini `GEMINI_CLI_HOME`. Whitelist auth/runtime state; hide operator memory, history, rules, hooks, agents, sessions, project maps, trust, and personal config. Claude still writes an explicit empty `hooks: {}` in overlay `settings.json` because Claude SDK organic compaction needs the configured-empty shape; this does not inherit operator hook definitions. Gemini also authors `system.md`, `policies/admin.toml`, and a 16-key `settings.json` closure; `ensureGeminiConfigOverlay` sweeps `<configDir>/{tmp,history,projects}/` every spawn.
   - **Tool/MCP/skill surface**: Claude exposes explicit `Read/Bash/Edit/Write` (+ `Skill`) plus `~/.claude/skills/` passthrough; Codex is narrowed by `-c` flags + `codexDisabledFeatures` plus `~/.codex/skills/` passthrough; Gemini uses `tools.core` 8-name allow (Read-class split + Write/Edit/Exec + `activate_skill`) + deny-all admin policy plus `~/.gemini/skills/` passthrough. MCP enters only through `piShellAcpProvider.mcpServers`. The earlier "Gemini MCP function-schema advertise asymmetry" reading (0.4.8 / 0.4.9) was overlay-induced — `tools.core` excluded `activate_skill`, `skills.enabled` was false, `skills` was off the passthrough whitelist — and has been retracted at 0.4.11. Gemini now reaches the same skill + MCP capability dignity as Claude/Codex through its own native surfaces (`activate_skill` for skills, `acpSessionManager.newSessionConfig` → `discoverMcpTools` for MCP).
   - **Memory containment (L5)**: pi owns persistence (semantic-memory + Denote llmlog). Claude, Codex, and Gemini native memory layers are pinned off; Gemini also sweeps memory dirs and defuses `${...}` engraving literals with U+200B before `system.md` write.
   - **Compaction / evidence (0.5.0)**: The bridge does not implement compaction. ACP backends compact natively; the pi session survives that. Defaults — pi JSONL compaction blocked, backend-native compaction **always allowed (no bridge knob)**. The only remaining bridge knob is `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1`, which opts back into pi-side compact (rare; pi-side summary does not reduce the backend transcript). Operators who need to alter a specific backend's auto-compaction configure that backend through its own native interface — the bridge intentionally does not surface backend-specific compaction names. Legacy `PI_SHELL_ACP_ALLOW_COMPACTION=1` is rejected at spawn intent with a next-action message pointing at `PI_SHELL_ACP_ALLOW_PI_COMPACTION`. Identity-isolation env (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, `GEMINI_CLI_HOME`, `GEMINI_SYSTEM_MD`) is unrelated to compaction and ships unconditionally. README/AGENTS claims must fit VERIFY/BASELINE/runtime evidence; `./run.sh smoke-compaction-policy` is the deterministic gate (2 pass after the 0.5.0 maintainer cleanup — step 02 pi-block message honest, step 05 legacy knob throws; step 01's negative assertion on backend-specific knob names was retired as a thesis violation, see CHANGELOG). `LIVE=1 ./run.sh smoke-compaction-policy` adds live steps 03/04/06 against all three ACP backends (Claude, Codex, Gemini) as a uniform probe — NEXT.md tracks the broader context-pressure-continuity investigation that the 0.5.0 release actually rests on. Backend-compact is judged by a dual classifier — text reply ("Context compacted") OR wire-level usage signal (`used=0` from `meter=acpUsageUpdate source=backend`, NOT the `componentSum`/`promptResponse` fallback). Initial outcomes: Codex signals on text + sentinel preservation; Claude signals on wire; Gemini's ACP path does not honor literal `/compact` as a native compaction command. These are raw probe outcomes, not release claims — the release claim's scope is reconfirmed in NEXT.md after the ACP-standard + three-backend surface investigation lands.
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
- Live peer messaging (`entwurf_send`, `/entwurf-send`, in-process pi tool) carries the sender envelope by default: `{ sessionId, agentId, cwd, timestamp }`. `entwurf_self` returns the same envelope for the current session.
- Startup one-shot CLI keeps sender info opt-in (`--entwurf-send-include-sender-info`). A short-lived sender process must not imply a reply path it cannot receive.
- **Human-greeted 담당자** is a first-class pattern: GLG may open a pi-shell-acp session in repo B, greet it directly, then hand its `sessionId` to repo A via `entwurf_send`. Spawned siblings and human-opened peers share the same messaging semantics.

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
| `mcp/pi-tools-bridge/` | `entwurf`, `entwurf_resume`, `entwurf_send`, `entwurf_peers`, `entwurf_self` |

## Typecheck Boundary

Single fence — every `.ts` source file in this repo is reached by some `tsc --noEmit` pass. No opt-out file. The fence is composed of three configs because the surfaces run under different runtime models:

| Config | Covers | Runtime model |
|---|---|---|
| `tsconfig.json` (root) | `index.ts`, `acp-bridge.ts`, `engraving.ts`, `event-mapper.ts`, `pi-extensions/**` | emit-capable. `./run.sh check-models` tsc-emits the project entry into `.tmp-verify-models/` for runtime introspection, so the root config must not set `noEmit`. |
| `mcp/tsconfig.json` (extends root) | `mcp/pi-tools-bridge/**`, plus the `pi-extensions/lib/*` it imports | `node --experimental-strip-types`. Adds `allowImportingTsExtensions` + `noEmit` because the bridge imports the shared lib with explicit `.ts` suffixes — Node's strip-types resolver requires the suffix on the wire. |
| `scripts/tsconfig.json` (extends root) | `scripts/**` (verification scripts; e.g. `cross-cwd-resume-smoke.ts`), plus the `pi-extensions/lib/*` it imports | `node --experimental-strip-types`. Same trade-off as `mcp/tsconfig.json`: explicit `.ts` imports + `allowImportingTsExtensions` + `noEmit`. Scripts are runtime gates, not build inputs. |

`pnpm typecheck` runs all three passes. `pnpm check` runs them as part of the release gate; the husky pre-commit hook does too. Adding a new `.ts` file outside all three configs is a fence breach — either include it or split a fourth config with a documented runtime model, but never extend the root `exclude` beyond the existing `node_modules` / `mcp` / `scripts` triplet. The historical exclude entries (`pi-extensions/entwurf-control.ts`, `mcp/*`) hid real type drift; do not reintroduce that pattern.

Code-level invariants pinned at the same time:

- **typebox single-source.** `pi-extensions/entwurf-control.ts` and `pi-extensions/entwurf.ts` both import `Type` / `StringEnum` from `@mariozechner/pi-ai` (which re-exports typebox 1.x). `@sinclair/typebox` is not a direct dependency. Mixing the two universes silently widens `StringEnum`-typed parameters to `unknown`, which only surfaces under typecheck — i.e., it was hidden by the old fence breach.
- **sessionId-only addressing for entwurf.** Every entwurf addressing surface — in-process tool params, MCP `entwurf_send` / `entwurf_peers` / `entwurf_self`, the entwurf-control RPC, the `/entwurf-send` slash command, CLI `--entwurf-session` — takes a sessionId (UUID). No `sessionName` field is part of the 0.4.14 public envelope.
- **sender envelope contract.** The public 0.4.14 sender envelope is exactly `{ sessionId, agentId, cwd, timestamp }`. `agentId` is a single field (`pi-shell-acp/<model>`) because school × model is one identity.
- **pi-shell-acp session is locked to its starting model after the session starts.** The primary guard is `pi-extensions/model-lock.ts`: once a conversation is anchored (`agent_start`, resume/fork, reload with messages, or startup with existing messages), any in-session model switch that touches `pi-shell-acp` is immediately reverted. This covers `pi-shell-acp -> native`, `native -> pi-shell-acp`, and `pi-shell-acp/X -> pi-shell-acp/Y`; native-to-native switching remains free. Fresh startup/new sessions with no messages stay unlocked until the first prompt, so pre-turn model selection and CLI `--model` override remain configuration, not violations. The bridge-side `ensureBridgeSession` lock is the fallback/direct-call boundary: live reuse-path model mismatch throws `ModelSwitchLockedError` before close/invalidate/new ACP bootstrap, with required outcome `path=reuse outcome=locked`, no ACP turn dispatched, and the existing session continuing to serve its saved model. **This is not transcript-clean: pi-core may already append `model_change` (`X -> Y`, or `X -> Y -> X` when the extension reverts) before the guard runs. A clean refusal requires a pi-core preflight hook.** The 0.4.14 "must respawn" rule is retired.

When a future change requires extending the schema-to-type inference (TS2589 paths, new `StringEnum`-typed params), see the comment block in `registerSessionTool` for the two concrete revisit conditions that would let the explicit `EntwurfSendParams` annotation collapse back into a single source.

## Runtime Dependencies

- `@agentclientprotocol/claude-agent-acp` — resolved from this package dependency first; `claude-agent-acp` on PATH is fallback.
- `codex-acp` — resolved from PATH. Install globally when using Codex.
- `claude` CLI — Claude Code authentication, managed separately.

Versions follow the pins in `package.json` / `run.sh`. Mismatches are caught by `check-dep-versions`.

## Working Style

- Surgical changes. One thing at a time.
- Ask: does this belong in pi? In Claude Code? Or here?
- **Ask the three-backend equality question explicitly: "Is Claude / Codex / Gemini each accounted for in this change?"** A claim where one of the three is implicitly carved out is a defect. If a backend genuinely lacks the surface the change touches, the negative must be recorded as an evidence row, not omitted. 0.5.0's "Gemini is out of scope" line started as honest narrowing and became a defect the moment the live probe was written without a Gemini equivalent.
- Keep docs calibrated: strong language is fine; unbacked language is not.
- Resist the urge to make the bridge more magical than necessary.

## Next

Current priority + open decisions: [NEXT.md](./NEXT.md). Read it at session start. recap restores the past axis; NEXT.md fixes the future axis. 둘이 한 쌍.

For 0.5.0, the real question is broader than the word "compact" — **when an ACP backend reaches context pressure, how does the session continue without pi-shell-acp becoming a second harness?** The narrow guard split (pi blocked, backend allowed, legacy throw) is implemented and the deterministic gate is green, but the release does not tag until the three-backend continuity table in NEXT.md is honest: (1) each backend's own context-pressure continuation path, (2) how the bridge / persisted pi:<sessionId> mapping behaves when that happens, (3) what summary handoff (if any) the bridge surfaces to pi without inventing transcript hydration. Gemini is **part of** that table — "out of scope" is not an acceptable answer; the honest answer is whatever Gemini's actual ACP context-pressure path turns out to be, even if it is "no advertised /compact, regular prompt fallback, expected user action: new session." Do not implement recap policy, day/semantic hydration, compact→new-session handoff, provider handoff UX, Gemini residue cleanup, or deeper OpenClaw tuning under this release.

## References

- [VERIFY.md](./VERIFY.md) — agent-driven verification guide. Carries two distinct frameworks: **Evidence Levels L0–L5** (cross-doc rung ladder for any claim — narrative / transcript / MCP call / on-disk / direct-native / soak) and the **§1A Layer 0–4 interview** (main-agent evaluation: self-awareness / native-tool use / MCP boundary / focus / direct-Claude comparison). Do not conflate them — a claim's evidence-level rung and a §1A layer are independent axes.
- [BASELINE.md](./BASELINE.md) — operator-driven verification record (Junghan runs the interview directly; results recorded). Companion to VERIFY.md, not a replacement.
- [agent-shell](https://github.com/xenodium/agent-shell) — Emacs ACP client, origin of `resume > load > new`
- [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) — ACP server
- [agent-config](https://github.com/junghan0611/agent-config) — real consumer repo
