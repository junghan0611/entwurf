# NEXT — `acp-on-v2` 브랜치 (ACP plugin on v2 core, B 방향)

> 부트섹터: **지금 어디 · 다음 한 걸음 · 넘으면 안 되는 선**만.
> base = `v2-only`(clean floor / 지도, **불가침 보존**). 이 브랜치에서 v2 core 위에 ACP를 다시 심는다.
> 영속 invariant(ACP=plugin 경계, 트러스트 경계)는 **AGENTS.md가 SSOT**. 이 파일 = *현 방향 + 구현 reference*(소모성).
> 흔들릴 때 앵커: botlog `20260522T092950…__…mitsein_pi.org` heading `* [2026-06-18] ACP도 데리고 간다` + 그 안의 **GLG 원본 프롬프트 3블록**(요약 금지).

# NOW (boot) — branch stem + active detours aligned (2026-06-22)

> **Boot invariant:** this branch is still **ACP plugin on v2 core → PR-polish/merge**.
> Detours may block trust, but they do not silently become the stem.
> If GLG asks for “새 담당자/분신을 불러줘” and no suitable citizen exists, **do not route to a similar cwd/model.** Current `entwurf_v2` cannot fresh-mint; it only dispatches to an existing garden id or wakes an already-recorded dormant pi citizen.

## Current stem

- **Stem:** finish ACP-on-v2 trust blockers → PR-polish docs/release-gate → merge/cut decision by GLG.
- **Current repo state:** branch `acp-on-v2`, ahead by local docs commit `0cc2239` (`docs(next): open ACP memory containment detour`) plus this NEXT alignment edit until committed. Do not push unless GLG says so.
- **Next concrete move:** choose and execute the first trust blocker:
  1. **Detour C first if trust is the question:** ACP Claude memory containment regression.
  2. **Detour B fresh-session smoke if intent UX is the question:** prove fresh tool descriptions make live/meta replies choose `fire-and-forget`(+`wants_reply`) rather than `owned-outcome`.
  3. Only after B/C are clear, return to **PR-polish**: README/ROADMAP/CHANGELOG/release-gate stale claims.
- **Optional only:** rerun `LIVE=1 ./run.sh smoke-claude-native-resume-live` Sonnet-only when Claude service is stable; 529/service failures are not repo mutations.

## Active detours

### Detour C — ACP Claude memory containment regression (blocks trust)

Evidence: `pi-shell-acp/claude-opus-4-8` wrote backend-native memory under `~/.pi/agent/claude-config-overlay/projects/*/memory/` via explicit Claude `Write` calls after “기억해두겠습니다”. Current overlay pins only `{ permissions.defaultMode:"default", autoMemoryEnabled:false, hooks:{} }`; this does **not** block `Write(*)` into Claude project-memory paths and does not carry native suppressors (`awaySummaryEnabled:false`, `autoCompactEnabled:false`, etc.).

- **Next:** design and implement a containment policy that routes durable memory to pi/Denote/NEXT/botlog/semantic-memory only and blocks/refuses backend-native memory writes under the overlay.
- **Gate:** deterministic overlay/tool-surface check + LIVE smoke that asks ACP Claude to “remember X” and asserts no `projects/**/memory/**` appears.
- **Do not:** delete existing memory artifacts until promoted/handled as data.
- **Return:** C closes when memory writes are blocked/refused with deterministic + LIVE evidence, or GLG explicitly accepts a documented known issue.

### Detour B — live/meta peer intent UX (mostly closed, needs fresh uptake proof)

`5e260fd` already pinned both MCP and pi-native `entwurf_v2` descriptions: live pi/socket-citizen messages/replies/handoffs use `intent:fire-and-forget`; answer needed = `wants_reply:true`; meta-session replies are also fire-and-forget→mailbox; `owned-outcome` is dormant pi spawn-bg resume only and rejects live/unsupported targets.

- **Next:** start a fresh `/gnew` or new resident so the model sees the updated tool description, then verify a live peer handoff/reply chooses `fire-and-forget`.
- **Failure meaning:** if a fresh session still chooses `owned-outcome` for a live peer, this is a caller/schema uptake bug. Do not change the decider to auto-convert.
- **Return:** B closes when fresh-session behavior matches the pinned surface.

### Detour A — Claude Code native resume classifier (record-only unless evidence changes)

This is a Claude Code-native concern, not ACP-provider backend work. Meta-bridge may record `session_id`/`transcript_path`/cwd/model into garden meta-records; it must not touch Claude Code backend state. Existing smoke classifies 529/service vs 400 transcript poison vs context overflow; Opus fallback proved neutrality. Do not mutate repo/backend on 529/billing/service failures.

## Fresh-mint / v2 본궤도 alignment (not a hidden bug; deferred lane)

- **Current `entwurf_v2`:** one delivery verb for **existing** garden citizens.
  - live pi/socket-citizen + fire-and-forget → control-socket send
  - dormant recorded pi + owned-outcome → spawn-bg **resume**
  - active meta-session + fire-and-forget → mailbox enqueue
  - no row creates a brand-new sibling
- **v1 difference:** old `entwurf` could fresh-spawn “new task in cwd/model”. That capability was removed with v1 and is explicitly deferred.
- **Daily-driver rule until spawn-fresh exists:** first inspect `entwurf_peers`; if no exact cwd/role citizen exists, say so and ask GLG to open one (or use `/gnew` manually). Never send work to a merely similar repo such as `homeagent-config` when GLG asked for `agent-config`.
- **Future lane:** after ACP trust blockers/PR-polish, design v2 `spawn-fresh` as a fourth transport or companion creation verb with its own gate. It must be explicit about cwd/model/role and must not blur dispatch facts into `entwurf_peers`.
- **Bug bar:** if this confusion recurs after this NEXT/ROADMAP/tool-description alignment, treat it as an affordance bug, not user confusion.

## PR-polish return checklist

When B/C are clear, return to docs/release gate:
- README: remove false/current-stale claims (backend support, packaged docs, persisted continuity, config passthrough overclaim).
- ROADMAP: top fresh-mint lane is current; lower historical sections still contain old “legacy verbs maintained” language and must be marked historical or corrected.
- CHANGELOG/release-gate: update only closed, durable changes; no tag/cut without GLG.

## RECENT

- **[2026-06-22] NEXT alignment after fresh-mint confusion.** `entwurf_v2` is existing-citizen dispatch/resume/mailbox only; v1 fresh spawn is not present. If no exact cwd/role citizen exists, stop and report instead of routing to a similar repo. Future `spawn-fresh` is a deferred v2 lane.
- **[2026-06-22] Detour C opened and committed locally (`0cc2239`).** ACP Claude wrote backend-native memory under the overlay. Treat as trust blocker before claiming memory containment.
- **[2026-06-22] Detour A classifier smoke added.** Claude Code native resume smoke classifies service/529 vs transcript poison/context issues. Opus fallback proved meta-bridge neutrality; Sonnet-only 529 is not a repo mutation trigger.
- **[2026-06-19] Detour B preventive steer done (`5e260fd`).** `entwurf_v2` descriptions now instruct live/meta replies/handoffs to use `fire-and-forget`(+`wants_reply`) and reserve `owned-outcome` for dormant pi resume. Needs fresh-session uptake proof only.
- **[2026-06-19] ACP-on-v2 S0~S2g practical implementation done.** Provider/overlay/event mapping/reuse/carrier+augment/RGG/config passthrough are implemented and had GPT/Opus review trails. Remaining work is trust blockers + PR-polish, not reopening S2 casually.

## Durable guardrails still relevant to the next move

- **ACP is a plugin, not the boundary.** Host `--entwurf-control` pi session supplies socket-citizenship; ACP backend must not grow a peers/socket/mailbox/orchestrator/memory layer.
- **Carrier rule:** keep Claude `_meta.systemPrompt`/engraving short, pure, and stable; rich context belongs in first-user augment. Breaking this risks subscription billing turning metered/HTTP400.
- **Reuse prompt rule:** `new` may carry transcript; `reuse` is delta-only. Lifecycle notices are display-only and must not re-enter backend prompts/signatures.
- **Memory rule:** durable memory goes to pi/Denote/NEXT/botlog/semantic-memory. Backend-native memory writes under `~/.pi/agent/claude-config-overlay/projects/**/memory/**` are the current regression, not an accepted feature.
- **Entwurf rule:** v1 verbs stay dead. Current `entwurf_v2` does not mint fresh siblings; future fresh-mint must be explicit and gated.
- **Release rule:** commit/push/tag/publish/merge = GLG. No `--no-verify`; do not touch `core.hooksPath` / `.git-hooks-mode`.

## LEDGER / where to read old detail

This NEXT is now a boot sector again. The long S0~S2 implementation ledger and 0.11.0 behavior-oracle notes were intentionally removed from the live NEXT body; recover them from git history if needed. Durable/current references:

- `AGENTS.md` — invariants: ACP plugin boundary, v2 dispatch substrate, trust/auth boundaries, verification floor.
- `ROADMAP.md` — current lane, deferred lanes, fresh-mint status, release-gate philosophy. PR-polish must still clean lower historical contradictions there.
- `VERIFY.md` / `BASELINE.md` — evidence-level and operator verification record.
- Botlog anchor: `20260522T092950…__…mitsein_pi.org`, heading `* [2026-06-18] ACP도 데리고 간다`.
- Git history before this NEXT cleanup — detailed S0~S2 cut notes, GPT/Opus review trail, 0.11.0 oracle excerpts.

# 참고
- base 지도: `NEXT--v2-only.md`(v2-only 브랜치에 보존) = 무엇이 최소 생존 셋인지의 정찰 기록.
- 0.11.0 ACP 코어(되살릴 reference, v2-only에서 삭제됨): `acp-bridge.ts`(3544) / `engraving.ts`(125) / `event-mapper.ts`(720) / `pi-context-augment.ts`(183) / `index.ts`(1263) + `prompts/engraving.md` + `scripts/resolve-acp-bridge.ts`. read-only로 `git show v0.11.0:<file>`.
- overlay 실측: `~/.pi/agent/claude-config-overlay/` — auth/skills/cache symlink passthrough, sessions/projects/settings 로컬 격리, `settings.json` `hooks:{}`(메일박스 부재 by design).
