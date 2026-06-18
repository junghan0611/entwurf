# AGENTS.md — Maintainer Guidelines for pi-shell-acp

For agents that own this repo: invariant principles + reproducible verification, not release-story drift.

> **Direction (read first).** This repo is a **pi-native v2 dispatch substrate
> (entwurf-core) + a meta-bridge + an ACP plugin**. v1 entwurf verbs are done
> and gone; v2 is the spine. ACP is **not** the project's center — it is one
> **plugin** that supplies garden socket-citizens to the v2 core (#38: *"ACP is
> a plugin, not the boundary."*). The package keeps the name `pi-shell-acp` —
> ACP lives, so the name is honest; there is **no rename** (#38's eventual
> `entwurf` package extraction is a deferred coordinate, not this work). The
> transient current-state and the ACP re-implementation plan live in the branch
> NEXT ([NEXT--acp-on-v2.md](./NEXT--acp-on-v2.md)); this file holds only what
> does **not** change week-to-week. Fresh sibling minting (the old v1 `entwurf`
> verb) stays deferred — see the branch NEXT.

## North Star — One Forged Screwdriver

`pi-shell-acp`를 만질 때 먼저 이 형상을 붙든다.
이 저장소는 스위스 아미 나이프가 아니다. 두 번째 하네스도 아니다.
이것은 **담금질된 드라이버 한 자루**다. 작고, 명시적이고, 자기가 맡은 접점에서만 강해야 한다.

영문 원칙만 읽으면 이것이 스펙처럼 보일 수 있다. 여기서는 그렇게 읽지 마라.
이 섹션은 기능 목록이 아니라 **판단의 중심축**이다.

### 먼저 붙들 정체성

- **pi가 하네스다.** 이 repo는 pi의 세션 모델, transcript, UI, tool semantics와 경쟁하지 않는다.
- **다른 하네스의 세션은 형제다.** Claude Code, Codex, Antigravity는 학교가 달라도 모두 frontier 친구들이다. meta-bridge는 그들을 garden id로 호명 가능한 citizen으로 등록할 뿐, 누구를 다른 누구로 위장시키지 않는다.
- **표면은 달라도 능력의 존엄은 낮추지 않는다.** 어떤 backend에서 `mcp__...`가 직접 보이지 않는다고 해서, 곧바로 그 backend를 "못하는 존재"로 취급하지 마라. 먼저 capability를 보고, 그 capability가 어떤 surface로 열리는지 확인하라.
- **substrate는 결정적 dispatch만 맡는다.** target liveness를 fact로 읽고, intent와 곱해 transport를 고른다. 그 이상 마술을 부리면 안 된다.
- **명시는 주변기류보다 강하다.** 숨겨진 transcript hydration, ambient MCP scanning, invisible tool claims, giant magical system prompt, 근거 없는 서사를 만들지 마라.
- **entwurf는 부속품이 아니라 분신을 연다.** spawn-bg resume된 세션은 runtime-isolated peer다. worker처럼 다루거나 권한 경계를 흐리지 마라.
- **증거가 말을 훈육한다.** README / AGENTS / CHANGELOG / VERIFY / BASELINE / runtime smoke가 받쳐주지 않으면, 작업을 중지하고 사용자에게 질문하라!

### 이 섹션을 읽는 올바른 방식

이 문단의 목적은 에이전트가 다음 질문을 **스스로** 하게 만드는 것이다.

- 나는 지금 tool 이름을 보고 있는가, 아니면 capability를 보고 있는가?
- 나는 backend의 비대칭을 정직하게 기록하고 있는가, 아니면 그것을 핑계로 형제성을 포기하고 있는가?
- 나는 사용자가 묻지 않아도 될 것을 되묻고 있는가?
- 나는 지금 두 번째 하네스를 만들고 있는가, 아니면 드라이버 한 자루를 더 단단하게 만들고 있는가?

### 금지할 오독

- 어떤 tool이 schema에 직접 안 보인다고 해서, 곧바로 "이 backend는 여기까지"라고 결론내리는 것
- surface 차이를 capability 포기로 번역하는 것
- 문서에 적힌 asymmetry를 면책조항처럼 사용하는 것
- `pi-shell-acp`를 하네스 런타임이나 범용 AI 작업실로 설명하는 것 — pi가 하네스고, 이 repo는 dispatch substrate다
- MCP를 자동 맥락 검색이나 ambient tool scanning처럼 설명하는 것 — explicit injection만 허용된다
- `entwurf_v2`를 "새 분신을 만드는 도구"로 설명하는 것 — v2의 3 transport는 전부 **기존** garden citizen 대상이다. fresh sibling 생성은 0.12.x로 연기된 별개 능력이다
- 사용자가 이미 철학과 방향을 준 문제를 다시 사용자에게 되묻는 것

릴리즈 이야기와 개별 기능은 주변을 돈다.
중심은 언제나 이것이다: **thin substrate / explicit MCP / sibling-based entwurf / deterministic dispatch / observability / evidence-first language / capability dignity across sibling sessions**.

## What This Repo Is

A **pi-native garden-citizen dispatch substrate** + a **meta-bridge** + an **ACP plugin**. Pi stays the harness; every addressed session keeps its own identity.

- **Meta-bridge**: a global `SessionStart` hook registers a native-harness session (Claude Code / Codex / Antigravity) as a **garden-native meta-session** — a garden id, a mailbox, a trusted sender marker — without importing that harness's transcript or pretending pi owns it. Installed/inspected via `./run.sh install-meta-bridge` / `doctor-meta-bridge`.
- **v2 dispatch (`entwurf_v2`)**: one verb that delivers to / wakes an *already-identified* garden citizen. A pure decider reads target liveness as a fact and picks transport from a frozen table keyed on **target state × intent**: live pi + fire-and-forget → **control-socket** send; dormant pi + owned-outcome → **spawn-bg resume**; active self-fetch meta-session + fire-and-forget → **meta-mailbox** enqueue; every other state×intent pair is an honest reject. It does **not** mint new siblings.
- **ACP plugin** (the pi-harness ingress): drives an ACP backend (Claude first; vendor/governed CLIs like Cortex next) under an isolated config overlay and registers it as a **socket-citizen** of the v2 core. It *supplies* citizens — it is not the substrate and not a second harness. v1 entwurf verbs (`entwurf` / `entwurf_resume` / `entwurf_send`) are gone for good; the ACP plugin is a fresh build on the v2 core (0.11.0's `acp-bridge.ts` is a behavior oracle, not architecture to re-center). See §ACP Plugin Boundary.

## Code Principle — Crash, Don't Warn

Code in this repo is used by agents as infrastructure.

> **Never warn. Throw.**

Warnings make agents blame themselves and flail. Broken tool state must surface as broken tool state.

- Bad config → throw (e.g. `McpServerConfigError`); same for bad path / bad model id. No fallback.
- `catch {}` only for environment probing (optional package detection, ldd exit code variance).
- `console.warn` only in stderr diagnostic lines (read by operators, not agents).

## Hard Rules

1. **One surface name, no rename**: provider/model/routing strings stay `pi-shell-acp`. No legacy aliases. ACP lives, so the name is honest — there is no `entwurf` package rename on this lane. The `provider: "pi-shell-acp"` strings (`getRegistryRouting`, `model-lock.ts`) are the routing the returning ACP plugin re-uses — keep them, do not "trim as residue".
2. **Dispatch is a function of liveness, not session type.** `entwurf_v2` never asks "is this a resume or a send" up front — it probes liveness and routes: live→control-socket, dormant→spawn-bg resume, active self-fetch→meta-mailbox. State is computed, never stored (a stored liveness bit is a lie).
3. **A reject is honest, never cosmetic.** When a target cannot receive (dead, drifted identity, wrong state×intent), the decider returns a reject — no `✓ delivered`, no `.msg` written, no signal poke. Silent degraded "delivery" is forbidden.
4. **MCP injection**: only via explicit `mcpServers` wiring. No ambient `~/.mcp.json` scanning, no automatic retrieval.
5. **Meta-record authority is the record body, never the filename.** `scanByNativeId` scans `.meta.json` bodies, throws on duplicate `nativeSessionId` (authority ambiguity is fail-fast), and never derives identity from a filename. A meta-record is nullable-at-birth (`model`/`transcriptPath` null until known); a backend↔wakeMode contradiction is corrupt-and-crash.
6. **GC reclaims process resources only — never data.** meta-records and transcripts (the denote-id memory layer) are preserved; dormant/stale entries are archived/TTL'd, not deleted.
7. **This is not a second harness**: no prompt reconstruction, no transcript hydration, no tool result ledger, no harness emulation. The meta-bridge fronts a mailbox + a garden id; it does not scrape transcripts or run a control daemon for the native session.
8. **Auth boundary is deployment-surface-agnostic**. This repo does not provide, copy, proxy, decrypt, or mediate any backend's credentials. Native-harness sessions read whatever auth state is visible in their own process filesystem; nothing here moves that.

## ACP Plugin Boundary

`entwurf-core` (the v2 substrate) is the center; **ACP is one plugin**, never the boundary (#38). Plugins supply read-only facts the core already asks for; they do not become the core, a memory layer, or a second harness (#39).

| Layer | Owns |
|---|---|
| **entwurf-core (v2)** | garden id · peer identity · liveness fact interface · dispatch decision · delivery evidence · rail choice (socket / mailbox / spawn) |
| **ACP plugin** | ACP backend process lifecycle · config overlay (isolation + tool-narrowing + identity-carrier materialization) · per-backend ACP dialect quirks · socket-citizen registration · liveness/addressability facts · delivery evidence |
| **ACP plugin MUST NOT become** | a memory DB · a task planner · an orchestrator · a second harness · a mailbox-citizen impersonation |

- **Sibling equality is a citizen-level property, not a rail-level one.** Every sibling is addressable (peers-visible, garden-id-addressed, `entwurf_v2`-reachable, replyable). The *rail* differs by lifecycle: a live ACP backend is a **socket-citizen** (no mailbox — it is always live, so durable async delivery is unneeded, not withheld); a come-and-go native-harness session is a **mailbox-citizen**. Missing a mailbox is right-sizing, not discrimination.
- **Durable memory is the authored common record** (`~/org`, botlog, agenda, Denote, andenken). entwurf lets peers move across that record layer; it never replaces it.
- **ACP enters as a model/provider, not a socket layer.** The ACP plugin registers as a pi session's provider/model and spawns the backend under an overlay; **socket-citizenship is supplied by the host `--entwurf-control` pi session**, not minted by the plugin. The plugin never builds a new socket registry, peers layer, or citizen protocol — over-designing one is the failure mode to avoid (`socket-discovery` is model-agnostic, so an ACP-model session is already a citizen).

### Operating boundaries (trust invariants — survive any re-implementation, #15)

These claims must stay true on every install surface; they are the first thing a re-implementation silently drops, so they are pinned here:

- `pi-shell-acp` does **not** provide, resell, or bypass Claude/vendor credentials, tokens, or subscription access. It connects only to the operator's **existing local authenticated backend** through an explicit plugin boundary.
- No auth bypass, no subscription sharing, no hidden transcript restoration.
- Expert escape hatches are **explicit and documented**, never accidental backdoors.
- The plugin **fails loud / fails closed** when an invariant is broken.

## Verification

Two axes, both required.

**Deterministic + smoke gates** (`./run.sh`, wired into `pnpm check`):

```bash
pnpm typecheck                              # 3-config tsc fence (root + mcp + scripts)
pnpm check                                  # full static floor: lint + typecheck + every check-*/smoke-* below
./run.sh check-entwurf-v2-matrix            # the decider's state×intent table, read as an SSOT (REAL decideDispatch)
./run.sh check-entwurf-v2-decider           # + -contract / -lock / -release / -send / -send-fallback / -mailbox / -runner / -production / -surface / -spawn / -spawn-production
./run.sh check-meta-session                 # + -record-v2 / -dual-read / -migration / -mailbox-state-write / -receiver-marker / -capability-source / -dual-consumers / -listing
./run.sh check-pi-tools-bridge-boot         # the MCP pi-tools-bridge stands up + exposes the v2 tool set
./run.sh check-bridge /path/to/project      # pi-tools-bridge direct MCP smoke (tools/list + protocol/negative-path)
# sentinel / session-messaging / xt-tool-surface survive as on-demand subcommands but were
# DROPPED from the v2 release floor (2026-06-17): ACP/v1 surface (removed pi-shell-acp
# provider / entwurf_send v1 tool). v2 re-writes onto entwurf_v2 are a separate follow-up.
```

**Live release gate** (opt-in, owns the merge decision):

```bash
LIVE=1 ./run.sh release-gate /path/to/scratch   # two-tier: MUST (release-blocking, owns exit code) + BEHAVIOR (advisory)
```

The MUST tier is the necessary condition ("green" = MUST PASS, FAIL=0); BEHAVIOR is advisory — the `smoke-resident-garden-guard` positives (a model-in-loop garden identity turn). Run every live gate with `PWD=scratch` so sessions never land in the repo's own session dir.

**Agent-driven verification** ([VERIFY.md](./VERIFY.md)): self-recognition/transcript agreement ≈ L1; objective MCP calls L2; on-disk/process L3; direct-native L4; soak L5.

If a gate fails or a claim drops below its needed evidence level, do not commit. Pipes can be connected and the water can still taste wrong.

## Entwurf

Uses `entwurf` instead of `delegate` to avoid ecosystem collisions. spawn-bg resume creates a sibling, not a worker.

- **Surface** — MCP `pi-tools-bridge`: `entwurf_v2`, `entwurf_self`, `entwurf_peers`, `entwurf_inbox_read`. pi-native (`pi-extensions/entwurf-control.ts`): `entwurf_v2`, `entwurf_peers` tools + `/entwurf-sessions`, `/gnew` (`/garden-new`) commands. The v1 `entwurf` / `entwurf_resume` / `entwurf_send` tools and the `/entwurf` / `/entwurf-send` / `/entwurf-status` commands are **removed** on this branch.
- **`entwurf_v2` is the one delivery verb.** Given a garden id, it classifies the target (live pi vs. dormant pi vs. meta-session — a bare garden id does not reveal this) and routes correctly. It does **not** mint a fresh sibling: the `dormant pi → spawn-bg resume` row resumes an *already-identified* citizen. Fresh creation was the v1 `entwurf` verb and is deferred to 0.12.x.
- **`entwurf_peers`** is a read-only fact surface (liveness / capability / identity / cwd-history). Do not bake verb-routing (`resumable`/`sendable`) into the fact layer; routing is the decider's job.
- **`entwurf_self`** returns the authoritative identity envelope (pi-session env, or a trusted meta-session sender marker) and is identity-required.
- Target registry: `pi/entwurf-targets.json` (spawn-bg resume allowlist). Identity Preservation Rule: no model override on resume.
- `PI_SHELL_ACP_V2_ONLY=1` was the v1-refusal flag; with v1 removed on this branch its guard (`entwurf-v2-only.ts`) is gone too. `runEntwurfV2` was always flag-clean.

> **Source-agnostic does not mean harness-agnostic.** 어디서 던지든 — GLG / sibling / external MCP host — entwurf 의 *target* 은 garden citizen 이다. spawn-bg resume 의 spawn surface 는 pi 자식 프로세스만 띄운다 (`pi --entwurf-control` keep-alive resident). 외부 MCP host 가 닿을 때도 target 은 이미 식별된 citizen 이어야 한다. *Model* 은 free axis (어느 형제 학교 모델이든), *spawn target* 은 harness 정합 axis.

> **Naming pair.** *Entwurf* (기투, projection-of-self) — a resident agent throws siblings forward (resume / messaging). The resident-side counterpart is *Mitsein* (공존, being-with), defined in the resident's own knowledge base (cwd-scoped, not a global persona). This repo owns the entwurf substrate; resident-side conventions live where the resident wakes.

### Garden launcher — the resident session is garden-native or it blows up (0.9.0)

Garden identity covers the operator's OWN `--entwurf-control` session, not just spawned children. A `--entwurf-control` session's header `id` MUST be a garden sessionId (`YYYYMMDDTHHMMSS-[0-9a-f]{6}`); pi assigns a `uuidv7` when `--session-id` is absent, so the launcher injects it and `entwurf-control` only enforces.

- **Launch:** `pi --session-id "$(run.sh new-session-id)" --entwurf-control …` (operator alias). The id is fixed at launch — an extension cannot change it after pi's `newSession`. `run.sh new-session-id` is the `generateSessionId` SSOT; never reimplement the format in the shell.
- **In-process new:** builtin `/new` stays blocked under `--entwurf-control` because it mints a uuid before extensions can inject an id. Use `/gnew` (alias `/garden-new`) for a same-terminal fresh garden session; it pre-creates a valid garden JSONL header and `switchSession()`es into it, so no uuid moment exists. A `/gnew` session quit before the first turn may appear in resume lists with message count 0; that is intentional, not an orphan. (`/gnew` births a fresh *operator* session in the same terminal — it is not the deferred programmatic fresh-sibling-minting capability.)
- **Enforcement:** non-garden id under `--entwurf-control` → loud stderr + notify + `process.exit(1)` at `session_start`, **before any model turn**. A bare `throw` / `ctx.shutdown()` there is swallowed by pi's runner (verified: the turn ran, 26k tokens leaked), so the guard hard-exits. No uuid / back-compat path — "보이면 바로 터진다".
- **Status label = 🪛 (the forged screwdriver, the North Star), NOT the word "entwurf".** `🪛 ready` before the first assistant turn (file not on disk → model changeable), `🪛 <gardenId>` after (file written → model locked). The id's presence is the model-lock lifecycle signal.
- **Resident name is lazy + `control`-tagged, never `entwurf` — with one sessionId-bound exception.** Set on the first turn via `pi.setSessionName(buildGardenSessionName(...))`. `buildGardenSessionName` is registry-FREE and FORBIDS the `entwurf` tag — the `entwurf` tag is the v2 resume resident marker, so an **operator** resident must never carry it (else a general operator session becomes resumable as a child). The narrow exception: a **v2 spawn-bg authorized Entwurf child** — marked by env `PI_SHELL_ACP_V2_RESUME_RESIDENT_SESSION_ID` (sessionId-bound) — **keeps** its `entwurf`-tagged name and stays re-resumable when it dies. Only that marker-authorized child is exempt. Gates: `check-entwurf-session-identity` (deterministic) + the v2 child exception via `check-entwurf-v2-spawn-production` + `smoke-entwurf-v2-spawn-resume-live`.

### Send-is-throw

Messages are thrown, not awaited.

- v2 delivery is fire-and-forget. There is no `wait_until` / `subscribe` / `turn_end` channel and no caller-side baseline correlation. For a control-socket send the RPC ack is the entire delivery contract; for a meta-mailbox enqueue the receipt is the write. If you need a reply, say so in the message.
- The sender envelope rides every send by default: `{ sessionId, agentId, cwd, timestamp, origin?, replyable? }`. `origin` distinguishes pi-session senders (`replyable: true`) and trusted meta-session senders (`replyable: true` by garden id). `entwurf_self` is authoritative-identity-required.
- **Human-greeted 담당자** is a first-class pattern: GLG may open a session in repo B, greet it directly, then hand its garden id to repo A. Spawned siblings and human-opened peers share the same messaging semantics; only the creation sequence differs.

## File Structure

| File | Purpose |
|------|---------|
| `pi-extensions/entwurf-control.ts` | control plane: `--entwurf-control` socket, RPC, `entwurf_v2` / `entwurf_peers` tools, `/entwurf-sessions` / `/gnew` |
| `pi-extensions/model-lock.ts` | pi-shell-acp model lock (pi.extension) |
| `pi-extensions/meta-bridge-hook.ts` | global `SessionStart` hook: register native-harness session as a garden meta-session |
| `pi-extensions/lib/entwurf-v2-*.ts` | v2 substrate: contract / lock / decider / matrix / release / send / mailbox / runner / production / surface / spawn(+production) + resume-marker |
| `pi-extensions/lib/meta-*.ts` | meta-record authority, mailbox state, dual-read/migration, receiver marker |
| `pi-extensions/lib/entwurf-core.ts` | shared core (session-file lookup, identity read, explicit-extension args); some v1 exports now dead pending routing cleanup |
| `protocol.js` | dependency-free shared wire constants (`<project-context` marker); single source for tsc emit + strip-types MCP paths |
| `run.sh` | install (incl. `install-meta-bridge`), check-*/smoke-* gates, sentinel, release-gate |
| `pi/entwurf-targets.json` | spawn-bg resume target allowlist |
| `mcp/pi-tools-bridge/` | MCP server exposing `entwurf_v2`, `entwurf_self`, `entwurf_peers`, `entwurf_inbox_read` |

## Typecheck Boundary

Single fence — every `.ts` source file is reached by some `tsc --noEmit` pass. No opt-out file. Three configs because the surfaces run under different runtime models:

| Config | Covers | Runtime model |
|---|---|---|
| `tsconfig.json` (root) | `pi-extensions/**` | emit-capable. The root config must not set `noEmit`. |
| `mcp/tsconfig.json` (extends root) | `mcp/pi-tools-bridge/**`, plus the `pi-extensions/lib/*` it imports | `node --experimental-strip-types`. Adds `allowImportingTsExtensions` + `noEmit` because the bridge imports the shared lib with explicit `.ts` suffixes — Node's strip-types resolver requires the suffix on the wire. |
| `scripts/tsconfig.json` (extends root) | `scripts/**` (verification scripts), plus the `pi-extensions/lib/*` it imports | `node --experimental-strip-types`. Same trade-off: explicit `.ts` imports + `allowImportingTsExtensions` + `noEmit`. Scripts are runtime gates, not build inputs. |

`pnpm typecheck` runs all three passes; `pnpm check` and the husky pre-commit hook run them as part of the gate. Adding a new `.ts` file outside all three configs is a fence breach — include it or split a fourth config with a documented runtime model, but never extend the root `exclude` to hide drift.

Code-level invariants pinned at the same time:

- **typebox single-source.** `pi-extensions/entwurf-control.ts` imports `Type` / `StringEnum` from `@earendil-works/pi-ai` (which re-exports typebox 1.x). `@sinclair/typebox` is not a direct dependency. Mixing the two universes silently widens `StringEnum`-typed parameters to `unknown`.
- **garden-id addressing for entwurf.** Every entwurf addressing surface takes a sessionId / garden id, never a session name. Entwurf / resident garden sessions use garden ids (`YYYYMMDDTHHMMSS-[0-9a-f]{6}`); generic live pi peers may still surface pi-assigned uuids.
- **sender envelope contract.** `{ sessionId, agentId, cwd, timestamp, origin?, replyable? }`. `agentId` is one field (`<provider>/<model>` for `origin: "pi-session"`, `meta-session/<backend>` for `origin: "meta-session"`). `PI_SESSION_ID` + `PI_AGENT_ID` are the canonical pi-session carriers; meta-session markers are pid+start-key hints backed by the meta-record store — no cryptographic non-forgery; cross-process env injection is the operator's responsibility.
- **pi-shell-acp session model lock.** After a session is anchored, a model switch touching `pi-shell-acp` is reverted by `pi-extensions/model-lock.ts`; native-to-native switching stays free; fresh startup/new sessions stay unlocked until the first prompt.

## Runtime Dependencies

- `@modelcontextprotocol/sdk`, `zod` — the only runtime deps right now. The Claude ACP package (`@agentclientprotocol/claude-agent-acp`) returns as a pinned dep when the ACP plugin lands; the Codex/Gemini ACP packages stay out of scope (native already reaches Codex; Gemini/major tools use native).
- `pi` (`@earendil-works/pi-ai`) on PATH at the pinned floor (`>= 0.79.4`). Mismatches are caught by `check-dep-versions` / `check-pi-runtime-version`.

## Working Style

- Surgical changes. One thing at a time.
- Ask: does this belong in pi? In the resident's own repo? Or here?
- Removal on this branch is gate-verified: subtract source AND its gate/case/script together (the 결합 규칙) so `pnpm check` stays green and never goes silently red.
- Keep docs calibrated: strong language is fine; unbacked language is not.
- Resist the urge to make the substrate more magical than necessary.

## Next

Current priority + open decisions: [NEXT--acp-on-v2.md](./NEXT--acp-on-v2.md) (branch lane) and [NEXT.md](./NEXT.md) (main lane). Read at session start. `/recall` restores the past axis; NEXT fixes the future axis. Forward direction: [ROADMAP.md](./ROADMAP.md).

## References

- [ROADMAP.md](./ROADMAP.md) — current + future direction (the ACP-plugin-on-v2 lane; #38's eventual `entwurf` package extraction is a deferred coordinate).
- [VERIFY.md](./VERIFY.md) — agent-driven verification guide (Evidence Levels L0–L5 + the §1A interview; independent axes, do not conflate).
- [BASELINE.md](./BASELINE.md) — operator-driven verification record (companion to VERIFY.md).
- [agent-config](https://github.com/junghan0611/agent-config) — real consumer repo.
