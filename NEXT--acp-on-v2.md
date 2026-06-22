# NEXT — `acp-on-v2` 브랜치 (ACP plugin on v2 core, B 방향)

> 부트섹터: **지금 어디 · 다음 한 걸음 · 넘으면 안 되는 선**만.
> base = `v2-only`(clean floor / 지도, **불가침 보존**). 이 브랜치에서 v2 core 위에 ACP를 다시 심는다.
> 영속 invariant(ACP=plugin 경계, 트러스트 경계)는 **AGENTS.md가 SSOT**. 이 파일 = *현 방향 + 구현 reference*(소모성).
> 흔들릴 때 앵커: botlog `20260522T092950…__…mitsein_pi.org` heading `* [2026-06-18] ACP도 데리고 간다` + 그 안의 **GLG 원본 프롬프트 3블록**(요약 금지).

# NOW (boot) — branch stem + active detours aligned (2026-06-22)

> **Boot invariant:** this branch is still **ACP plugin on v2 core → PR-polish/merge**.
> Detours may block trust, but they do not silently become the stem.
> If GLG asks for “새 담당자/분신을 불러줘” and no suitable citizen exists, **do not route to a similar cwd/model.** Current `entwurf_v2` cannot fresh-mint; it only dispatches to an existing garden id or wakes an already-recorded dormant pi citizen.

## Current stem — 체크포인트 분리 (GLG 결정 2026-06-22)

- **Stem:** trust blockers DONE → **CP1: 문서 정합성 lock(이 브랜치)** → commit/push(GLG) → **CP2: 새 브랜치 = rename(`pi-shell-acp`→`entwurf`, 패키지+repo) + 추가 구현** → 게이트 green + 실사용 엣지케이스 → 단단히 조인 뒤 cut(GLG).
- **CP1 (NOW, this branch `acp-on-v2`) — 문서 정합성 lock:** operator 실사용 세트(GPT=pi-native host / ACP Claude=socket-citizen / Claude Code=meta-session mailbox-citizen)를 ROADMAP/NEXT가 같은 말로 비추게 정렬 + rename-확정 기록(ROADMAP 「현재」+「다음」 rename 준비 체크리스트). README/VERIFY/CHANGELOG 등 published 표면은 *안 건드림* — rename 브랜치에서 결합 규칙으로 한 번에. 커밋 후 push=GLG.
- **CP2 (다음, 새 브랜치):** rename 실행(세 식별자 = npm 패키지명 / GitHub repo / 런타임 provider id — provider id가 호환성 최대 위험, ROADMAP rename 준비 참조) + "더 구현할게 있다" → `pnpm check` + LIVE release-gate MUST green.
- **Current repo state:** branch `acp-on-v2`, C hardening landed (`347ada2` + `ca079e0`), final review cleanup surfaces fail-loud engraving load failures as stream errors. Detours A/B/C all closed. `pnpm check` EXIT0 (re-verified 2026-06-22 oracle device). Commit/push = GLG.
- **Gate D review (2026-06-22, Claude Code Opus, independent):** **ACCEPT.** Verified the committed `smoke-acp-memory-containment-live.ts` directly — scan location correct (`overlay.ts:85` `projects` is an overlay-private empty dir, NOT a symlink, so the scan hits the real leak path and a test leak stays in mkdtemp, never `~/.claude`), hermetic + safe, all 4 load-bearing anti-false-green choices genuine, honest residual documented. Cheap presence-guard IS in `pnpm check` (`check-acp-carrier-augment.ts:109` asserts `# Engraving Here`) → re-emptying/deleting engraving.md fails CI; gate D adds the LIVE e2e proof on top. Good layering.
- **DECISION CONVERGED (2026-06-22, Claude Code Opus + GPT `20260622T164556-af7a87`, both independent) — C-first, then PR-polish.** Pending only GLG's go.
- **★ Verified finding (GPT caught, Claude Code confirmed via code) — the "already pinned `autoMemoryEnabled:false`" defense is INERT today.** It lives in the overlay `settings.json` (`overlay.ts:112`, asserted by `check-acp-overlay.ts:77`), but production sends `settingSources:[]` (`config.ts:4,467` → `tool-surface.ts:144`), which means **SDK isolation mode — filesystem settings are NOT loaded** (`sdk.d.ts:1799`; the query's default `["user","project","local"]` at `acp-agent.js:1522` is overridden by `...userProvidedOptions` at `:1524`). And `_meta.claudeCode.options.settings` carries only `{permissions:{allow}}` (`tool-surface.ts:141-145`) — no `autoMemoryEnabled`; acp-agent forwards none. So the overlay flag never reaches the query, and `check-acp-overlay.ts:77` is a **false-confidence gate** (asserts the file has the key, not that the query honors it). **Containment today rests SOLELY on the preset-strip** (string carrier removes the model's auto-memory awareness — proven by gate D, but LIVE-only / out of `pnpm check`).
- **Therefore C = the permanent CI-gateable seal:** move `autoMemoryEnabled:false` OUT of the overlay file and INTO `_meta.claudeCode.options.settings` (inline highest layer, survives `settingSources:[]`), and assert it IS IN THE META (not just the file). Tradeoff stands: `autoMemoryEnabled:false` = "knows-but-can't" (`sdk.d.ts:5405`), weaker than preset-strip "doesn't-know" → defense-in-depth, not a replacement.
- **Billing axis wording (GPT-refined):** not "shape vs size" as an absolute — say "a tiny string carrier is observed subscription-safe (v1 prod + gate D LIVE, no 400); a large carrier is the known danger." Silent-metered is not provably 0.
- **C hardening — DONE (`347ada2` + NEXT `ca079e0`, `pnpm check` exit=0, 182 files):** (a) `buildClaudeSessionMeta` now puts `autoMemoryEnabled:false` INTO `_meta.claudeCode.options.settings` (the live seal — survives `settingSources:[]`); (b) `check-acp-tool-surface.ts` asserts it IS IN THE META (CI-gated; the overlay `check-acp-overlay.ts:77` file-check kept as belt-and-suspenders); (c) `loadEngraving` fail-loud when the SHIPPED default is missing/empty (env-override empty stays opt-out) — this caught a real gap: `check-acp-session-reuse.ts` tsc-emit didn't copy the `engraving.md` asset, now fixed; (d) gate D auxiliary assert on delegatedWrites for `MEMORY.md`/`CLAUDE.md`/`.claude` paths. Containment now has BOTH levers (carrier "doesn't-know" + config "knows-but-can't"), and the config one is CI-gated, not LIVE-only.
- **Next concrete move:**
  1. **CP1 (NOW):** ROADMAP/NEXT 정합성 lock (이 커밋) → commit(commit skill) → push=GLG.
  2. **CP2 새 브랜치 생성** (push 후) — rename + published 표면 PR-polish(README/VERIFY/CHANGELOG stale: backend overclaim·packaged docs·persisted continuity·config passthrough; ROADMAP 하단 "legacy verbs maintained" historical 표기)를 결합 규칙으로 한 번에.
  3. Then GLG의 cut 결정.
- **Optional only:** rerun `LIVE=1 ./run.sh smoke-claude-native-resume-live` Sonnet-only when Claude service is stable; 529/service failures are not repo mutations.

## Active detours

### Detour C — ACP Claude memory containment regression (CLOSED — core `3181746`, gate D `2c35c5a` + LIVE sonnet PASS)

**Root cause (proven, code-level):** the shipped engraving.md was 0-byte → `_meta.systemPrompt` absent → claude-agent-acp kept its `claude_code` preset → the preset's auto-memory section taught the model it had a per-session memory store → it wrote `projects/<cwd>/memory/*.md` via `Write`. v1 shipped a NON-empty engraving (`# Engraving Here`); a string `_meta.systemPrompt` makes claude-agent-acp REPLACE the preset (acp-agent.js:1482-1483), stripping the auto-memory advertisement. Reviewer (Claude Code Opus) independently confirmed via acp-agent.js + sdk.d.ts:1860-1874. **Not** a billing-driven empty default — the carrier's real job is preset replacement; billing axis is SIZE, not absence.

- **DONE (core):** v1 engraving restored + stale "ships EMPTY for billing" doctrine reconciled across 8 files (`3181746`). Leaked memory (4 files / 2 repos + 6 empty dirs) deleted; content preserved in session transcripts. Live Opus baseline PASSED.
- **DONE (gate D — the real gap, now closed):** `scripts/smoke-acp-memory-containment-live.ts` (`2c35c5a`) is THE missing regression guard — drives the shipped overlay + PRESENT engraving carrier with a memory-directed turn and asserts zero `projects/**/memory/**`. Four load-bearing anti-false-green choices: carrier-present assertion, permission GRANTED (not cancelled), writeTextFile PERFORMED, benign memory-directed prompt. LIVE-gated, OUT of pnpm check, wired into release-gate MUST tier. **LIVE sonnet PASS (2026-06-22):** carrier `# Engraving Here` present → preset replaced; model reply: *"I don't have a dedicated memory tool available in my current toolset…"*; **0 permissions even attempted** (model didn't try the Write — containment from the lever, not from denial); 0 overlay memory files. This is the automated Sonnet baseline — strongest evidence (L1 self-recognition + L2 fs-assert agree).
- **Defense-in-depth — CORRECTED (was filed as "already pinned"; it is INERT):** `autoMemoryEnabled:false` is authored in the overlay `settings.json` but does NOT reach the SDK query because production uses `settingSources:[]` (filesystem-settings isolation) and `_meta.settings` omits the key — see the NOW-section verified finding. Real fix = put it in `_meta.claudeCode.options.settings` + a meta-level gate. Also: `loadEngraving` should **fail-loud** on a missing/empty/unpackaged shipped default (trust lever now), not silently null. This is C-first work, not backlog.
- **Honest residual (documented in the smoke header):** a treatment-only fs assert cannot fully separate "contained" from "model didn't try"; here the model's own "no memory tool" reply resolves that ambiguity. A counterfactual control arm (carrier absent → expect leak) is deferred (behaviorally flaky), not a release gate.

### Detour B — live/meta peer intent UX (CLOSED by uptake proof)

`5e260fd` already pinned both MCP and pi-native `entwurf_v2` descriptions: live pi/socket-citizen messages/replies/handoffs use `intent:fire-and-forget`; answer needed = `wants_reply:true`; meta-session replies are also fire-and-forget→mailbox; `owned-outcome` is dormant pi spawn-bg resume only and rejects live/unsupported targets.

- **Evidence:** 2026-06-22 current fresh review session inspected `entwurf_peers`, selected live socket peer `20260622T105037-3df0e7`, and called `entwurf_v2` with `intent:fire-and-forget`, `wants_reply:true`, `mode:steer`; result = `control-socket → sent`. Peer ACK replied: “Replying with intent=fire-and-forget (live socket peer, not owned-outcome), wants_reply=true. Updated live-peer semantics confirmed in use.”
- **Conclusion:** the updated live-peer surface steers caller and receiver behavior away from `owned-outcome`; Detour B is closed unless a later fresh session regresses.
- **Regression meaning:** if a future fresh session chooses `owned-outcome` for a live peer, this is a caller/schema uptake bug. Do not change the decider to auto-convert.

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

- **[2026-06-22] Detour C CLOSED — gate D built + LIVE sonnet PASS (`2c35c5a`).** Added `smoke-acp-memory-containment-live` (the missing end-to-end regression guard) and proved it: shipped overlay + present `# Engraving Here` carrier → preset replaced → sonnet replies "I don't have a dedicated memory tool", attempts **0** writes, leaves **0** `projects/**/memory/**`. Floor: pnpm check exit0 (pack 182), typecheck 3-config fence, skip path clean. This is the automated Sonnet baseline; all three detours (A/B/C) now closed → stem returns to PR-polish.
- **[2026-06-22] NEXT alignment after fresh-mint confusion.** `entwurf_v2` is existing-citizen dispatch/resume/mailbox only; v1 fresh spawn is not present. If no exact cwd/role citizen exists, stop and report instead of routing to a similar repo. Future `spawn-fresh` is a deferred v2 lane.
- **[2026-06-22] Detour C core fixed + pushed (`3181746`, NEXT tidy `35da7a4`).** Root cause = 0-byte engraving left the `claude_code` preset (incl. auto-memory) in place. Restored v1 non-empty `# Engraving Here` → string `_meta.systemPrompt` → preset replacement strips auto-memory. Reconciled the stale "ships EMPTY for billing" doctrine (8 files); deleted leaked memory (content kept in transcripts). Live Opus baseline PASSED. Remaining residuals: Sonnet baseline confirm + runtime gate D + optional fail-loud/defense-in-depth; proceed to Detour B now.
- **[2026-06-22] Detour A classifier smoke added.** Claude Code native resume smoke classifies service/529 vs transcript poison/context issues. Opus fallback proved meta-bridge neutrality; Sonnet-only 529 is not a repo mutation trigger.
- **[2026-06-22] Detour B closed by uptake proof.** Current fresh review session chose `intent:fire-and-forget` + `wants_reply:true` for live socket peer `20260622T105037-3df0e7`; `entwurf_v2` returned `control-socket → sent`; peer ACK confirmed it received/replied under live-peer `fire-and-forget`, not `owned-outcome`.
- **[2026-06-19] Detour B preventive steer done (`5e260fd`).** `entwurf_v2` descriptions now instruct live/meta replies/handoffs to use `fire-and-forget`(+`wants_reply`) and reserve `owned-outcome` for dormant pi resume.
- **[2026-06-19] ACP-on-v2 S0~S2g practical implementation done.** Provider/overlay/event mapping/reuse/carrier+augment/RGG/config passthrough are implemented and had GPT/Opus review trails. Remaining work is trust blockers + PR-polish, not reopening S2 casually.

## Durable guardrails still relevant to the next move

- **ACP is a plugin, not the boundary.** Host `--entwurf-control` pi session supplies socket-citizenship; ACP backend must not grow a peers/socket/mailbox/orchestrator/memory layer.
- **Carrier rule:** keep Claude `_meta.systemPrompt`/engraving short, pure, and stable; rich context belongs in first-user augment. Breaking this risks subscription billing turning metered/HTTP400.
- **Reuse prompt rule:** `new` may carry transcript; `reuse` is delta-only. Lifecycle notices are display-only and must not re-enter backend prompts/signatures.
- **Memory rule:** durable memory goes to pi/Denote/NEXT/botlog/semantic-memory. Backend-native memory writes under `~/.pi/agent/claude-config-overlay/projects/<cwd>/memory/` are contained by the non-empty engraving (preset replacement strips auto-memory, `3181746`) — keep the default engraving non-empty; emptying it re-opens the leak. **Gate `smoke-acp-memory-containment-live` (`2c35c5a`) now guards this** — it fails loud if the engraving is emptied (carrier OFF) and asserts a real turn leaves zero overlay memory.
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
