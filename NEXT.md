# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 완료된 릴리즈/조사 기록은 `CHANGELOG.md`, GitHub issue, commit history로 보낸다.

## Reference paths — 매번 묻지 말 것

- **ACP backend source 전부**: `~/repos/3rd/acp/`
  - `agent-client-protocol/` — ACP 표준 docs/schema/rfds
  - `claude-agent-acp/` — Claude ACP adapter (Anthropic SDK 래핑)
  - `codex-acp/` — Codex ACP adapter (codex-rs Rust core)
  - `gemini-cli/` — Gemini CLI + ACP adapter (`packages/cli/src/acp/`)
  - `agent-shell/`, `acp.el`, `zed/`, `obsidian-agent-client/`, `openclaw-acpx/` — 다른 ACP clients (참고용)
- **이 repo**: `~/repos/gh/pi-shell-acp/` (현재 cwd)
- **consumer**: `~/repos/gh/agent-config/`
- **llmlog 작업 메모**: `~/org/llmlog/` (Denote ID로 검색)

---

## Session resume entry — 2026-05-13 마지막 상태

코드 + deterministic gate는 green. 0.5.0 핵심 결정 두 개 살아있음 — (1) backend escape hatch 완전 제거 commit 통과 (백엔드 auto-compact 전역 ON, no bridge knob), (2) Claude context-pressure 축은 `hooks: {}` overlay fix로 A/B clean 확인.

- 작업 중 PR 없음. uncommitted: 0.5.0 compaction policy 단순화 변경분 (직전 commit `15abd44` 후속).
- llmlog: `~/org/llmlog/20260513T133346--acp-compaction-command-surface-investigation__acp_compaction_llmlog_pishellacp.org` — ACP 표준 + 3 backend source 조사 완료, 그대로 사용.
- LIVE 1차 baseline: Claude pass (wire), Codex pass (text), Gemini observed (`/compact` no-op). raw 결과는 §"Three-backend continuity table" 안에 인용됨.

### 다음 한 걸음 (잊지 말 것)

**Claude context-pressure 축은 닫혔다 — `hooks: {}` overlay shape fix.** 2026-05-13 15:48 KST 첫 LIVE는 compact 발동 + 두 chunk + mapping 생존을 입증했고, 17:23 KST fresh `019e206a` probe는 overlay `settings.json`에 `hooks` key가 없을 때 organic compact turn이 meta-summary로 끝나는 prompt-sacrifice failure를 드러냈다. 이후 `hooks: {}`를 명시한 `2026-05-13-claude-hooks-empty` probe에서 같은 organic compact turn이 substantive reasoning + 원래 user prompt에 대한 직접 답으로 정상화됨. 즉:

### Three-pattern taxonomy (A / B / B') — release-grade 통과 기준

| Pattern | 정의 | Pass 기준 |
|---|---|---|
| **A** | explicit backend compact (`/compact` 명시 입력) | **단순 "Compacting completed" 표시는 부족.** 실제 summary content + 다음 user turn에서 substantive answer까지 받아야 한다. Claude는 이 함정을 `hooks: {}` overlay fix로 통과. |
| **B** | real context-fill organic compact (window를 진짜로 채움) | Sonnet했던 것처럼 backend의 실제 context window 끝까지 file-reading으로 밀어넣어 organic auto-compact 유도. 모든 backend에 공통 적용 가능한 일반 시나리오. Claude Sonnet 4.6 = 200k, GPT-5.4 = 258k. *Cheap stand-in*: backend가 노출하는 자기 native knob으로 threshold를 낮춰 빠르게 유도 (e.g., Codex는 codex-rs `-c` flag로 가능; 이건 backend native interface — bridge가 surface하지 않음). cheap stand-in이 통과한다고 진짜 native window saturation까지 검증된 것은 아님. |

**Claude 축 — A + B 통과로 닫힘.**
- Pattern A: `hooks: {}` overlay 후 compact-only turn (`Compacting...` / `Compacting completed.`, wire `used=0`) → 다음 user turn이 compacted context로 정상 답변.
- Pattern B (real context-fill): `019e206a` saturated fresh probe에서 organic compact turn이 substantive reasoning + 원래 user prompt 직접 답변까지 통과. file-reading 또는 자연 대화로 200k 끝까지 채워서 발동.

→ 원인은 backend compaction 한계가 아니라 pi-shell-acp overlay shape 결함이었다. fix는 `acp-bridge.ts` `overlaySettingsJson()`의 `hooks: {}` 한 줄.

**Codex 축 — A 닫힘. B 닫힘 (cheap stand-in + real saturation 둘 다).**
- **A: 5/14 통과** (`demo/compaction-policy-smoke/probes/2026-05-14-codex-step04-A/`). 우리 자동화 probe (LIVE=1 step 04)에서 plant → /compact → recall 3-turn 동안 sentinel `GLG-COMPACT-mp4plbzl-nk4iwv`가 그대로 보존됨. text=ack, sentinel=yes. wire는 17964→11822 (34% drop, 50% threshold 미달)로 `no_evidence`지만 text+sentinel 조합이 load-bearing. Claude A의 `hooks` 함정 같은 overlay 결함 없음. GLG가 5/14 agent-shell에서 직접 한 대화 (summary block 받음, 항목 enumerate 가능)와 cross-confirm.
- **B (cheap stand-in via lowered threshold): 5/14 통과** (`demo/compaction-policy-smoke/probes/2026-05-14-codex-B-threshold/`). codex native threshold knob으로 임계값을 12000으로 낮춰 organic auto-compact 발동. plant 후 used=17959 (>threshold) → (b) 던지면 turn 시작 시 `Context compacted` + Paris 답변 in same turn → (c) 또 `Context compacted` + sentinel 정확히 recall. native auto-compact path가 bridge 통해 end-to-end로 도달함을 증명. `bootstrapPath: load` + `persistedAcpSessionId === acpSessionId` 모든 3 turn 일관. env 주입도 자식 ACP까지 정확히 전파됨.
- **B (real native-window saturation): 5/14 통과** (`demo/compaction-policy-smoke/probes/2026-05-14-codex-B-saturation/`). 13-turn file-reading + heavy-analytic saturation으로 GPT-5.4 codex-acp 세션을 17961 → 244337 (~94.5%) 까지 채우고, turn (l)에서 heavy 700+w analytic 요청 시 **organic auto-compact 자동 발동**. wire `used` 244089 → 84549 (159k drop, **65% drop, 50% threshold 훨씬 초과 → wire classifier도 명확하게 pass**), text=`Context compacted`, 그리고 compact turn 안에서 substantive 982-word answer + 8+ line refs까지 정상 산출. turn (m) post-compact recall에서 sentinel `GLG-CODEX-SAT-1778718415-c251bd` 정확히 보존. mapping 13 turns 일관 생존 (acpSessionId=`019e23e1-3a43-...`), bridgeConfigSignature 안정. **Codex GPT-5.4 codex-rs native threshold ≈ 245k** (Claude Sonnet 4.6 ~120k의 ~2배 늦음 — 정직한 비대칭). 진짜 동일선상: Claude B와 동일한 surface에서 동일한 결과 (text-ack + wire-drop + sentinel-preserved + mapping-survives), threshold 위치만 다름.

**Gemini 축 — closed as an honest ACP asymmetry, NOT as a pass.**

5/14 GLG가 native `gemini` CLI에서 직접 `/compress` 실행 + source 추적 + PM 분신 (gpt-5.5 medium) cross-review 완료:

- **CLI UI command (Gemini TUI only)**: `compressCommand` name=`compress`, alias=`summarize, compact` (`compressCommand.ts:10-13`). 동작은 codex/Claude와 본질적으로 다르다 — 오래된 history를 골라 `UTILITY_COMPRESSOR` 역할로 summary 생성, `<state_snapshot>` 한 번 더 verification turn으로 보정, 그 결과를 **새 chat history의 첫 user turn으로 명시 주입**:
  ```ts
  [
    { role: 'user',  parts: [{ text: finalSummary }] },
    { role: 'model', parts: [{ text: 'Got it. Thanks for the additional context!' }] },
    ...historyToKeepTruncated
  ]
  ```
  → 모델은 "별도 요약을 받지 않았다"고 자기 인식이지만 실제로는 압축된 history 첫 user turn에 summary가 들어있다 ("무의식 주입" 시나리오). GLG가 native gemini CLI에서 직접 확인 (93620 → 12936 tokens, 5/14).
- **ACP command registry**: `acpCommandHandler.ts:23-31` 기준 `memory, extensions, init, restore, about, help`만 등록. `/compress`나 `/compact` ACP 경로 노출 없음 → agent-shell, pi-shell-acp 어느 쪽에서도 ACP를 통한 CLI compress 호출 불가능.
- **Organic compression on ACP path**: `client.ts:673-677` — 매 turn 시작 시 `tryCompressChat(prompt_id, false)` 자동 호출, 성공 시 `GeminiEventType.ChatCompressed` yield. 그러나 `acpSession.ts` switch에 `ChatCompressed` case 없음 → `default: break`로 silently drop. **즉 organic compression이 일어나도 ACP wire는 모름.**
- **Context pressure 끝까지 갔을 때 (1M saturation)**:
  1. compression이 충분히 줄이면 → 그냥 답변 계속 (pi에 압축 알림 없음, silent)
  2. compression 실패/부족 → `ContextWindowWillOverflow` → `acpSession.ts:369-371`에서 `stopReason: 'max_tokens'`로 turn 종료
  3. bridge는 몰래 요약/handoff 안 함 — 사용자가 `/clear`, 새 세션, native CLI `/compress`, 또는 작업 축소 같은 **가시적 조치** 필요
- **PM 분신 결론 (gpt-5.5 medium, 5/14)**: "Claude axis closed로 표현하는 것은 over-claim. 정확히는 'closed as an honest ACP asymmetry, not as a pass'."

### Gemini row 정확 release-grade phrasing

```text
Gemini axis is closed as an honest ACP asymmetry, not as a pass.
Native Gemini CLI supports /compress (alias /compact, /summarize), but
Gemini ACP does not expose that command. Organic compression may happen
inside Gemini CLI on the ACP path, but ACP does not surface ChatCompressed
on the wire today. If pressure remains, ACP surfaces max_tokens.
pi-shell-acp does not inject backend-specific Gemini compression knobs.

GLG direct CLI cross-check (2026-05-14) confirmed /compress exists outside
ACP (93620 → 12936 tokens). The asymmetry is recorded, not paved over.
```

### UX 문구 (operator-facing, when ACP Gemini session hits max_tokens stop)

> "Gemini ACP reached context pressure; native CLI has `/compress` but ACP does not expose it here. Start a fresh session or reduce context."

LIVE 추가 보강은 필수 아님:
- 1M context saturation은 비용 대비 낮음 (Codex 258k와 비교 불가)
- threshold 낮추는 settings inject는 **0.5.0 maintainer cleanup thesis 위반** (우리는 backend-specific compaction knob을 surface 안 함)
- source-level + 5/13 LIVE step 06 negative + GLG 5/14 native CLI cross-check + PM 분신 source confirmation 조합으로 release-grade 결론 충분

### Cross-validation 메모

- 직전 commit `15abd44`는 0.5.0 정책 split (pi/backend knob 분리). 그 위에 쌓인 이번 uncommitted는 *backend escape hatch 완전 제거* (단일 knob — `PI_SHELL_ACP_ALLOW_PI_COMPACTION`만 남음) **+ organic compact LIVE evidence** (Claude only, 2026-05-13).
- GPT-5.4 분신 cross-review 완료 — missed residue 3건과 Codex config 문구 정밀화 fix를 GLG가 직접 반영함 (CONTRIBUTING.md, demo README, scripts/compaction-policy-smoke.ts 모두 single-knob 모델로 정렬).
- Organic 재현 명령 (5/13 첫 확정, 17:23 KST 이후 fixture 무효): `pias --session demo/compaction-policy-smoke/fixtures/pre-backend-compact--019e19e0--org-sonnet-97pct.jsonl -p "READY?"` (단 fixture는 read-only — 실제 실행 전 active session dir로 복사). `pias` alias = `PI_SHELL_ACP_DEBUG=1 pi --model pi-shell-acp/claude-sonnet-4-6 --entwurf-control --emacs-agent-socket server`. `--emacs-agent-socket server` flag는 `bridgeConfigSignature`에 포함되어 있어 빠지면 `incompatible_config`로 매핑 자동 무효화 → fresh `new` 세션으로 떨어짐 (signature는 `index.ts:836` `JSON.stringify({ base, emacsAgentSocket })`).
- **Fixture reproducibility 위기 (2026-05-13 17:10 발견)**: 오늘 commit 3개(`15abd44`, `9e88668`, `6f433a9`) 중 어딘가에서 `providerSettings.bridgeConfigSignature` (`index.ts:666` — backend, mcpServersHash, tools, skillPlugins, permissionAllow, disallowedTools, codexDisabledFeatures, appendSystemPrompt, settingSources, strictMcpConfig)가 변해, BASELINE 15:48 fixture(`acpSessionId=a01cb05f...`)는 **resume 불가** — 매번 `incompatible_config`로 invalidate되어 fresh `new`로 떨어짐. fixture .jsonl만 보존하는 contract로는 reproducibility 보장 불가. 대안 둘 — (i) fixture에 mapping cache JSON도 페어로 묶어 보존, (ii) signature 결정 필드를 명시적으로 stable한 release 식별자에 묶기. 정리는 0.5.0 release 전 결정 사항.
- **Fresh saturated session evidence (2026-05-13 17:23 KST)** — fixture 대체 보존: `demo/compaction-policy-smoke/probes/2026-05-13-claude-organic-fresh/turn-{01..04}.{stdout,stderr}` 4-turn full trace. piSessionId `019e206a-a4c6-70b9-83b1-9d127428a7be`, acpSessionId `7666d892-1faf-4fea-9e94-cd53bba0a2e8`. 사용 진행: 25k → 121k → **18.7k (organic compact)** → 22.8k. `hooks` key absent failure baseline으로 보존.
- **Hooks-empty fix evidence (2026-05-13 18:05 KST)** — `demo/compaction-policy-smoke/probes/2026-05-13-claude-hooks-empty/turn-{01..03}.{stdout,stderr}`. 같은 organic trigger shape에서 `hooks: {}` 후 turn 3이 substantive answer로 종료. 이어 explicit `/compact` Pattern A regression도 clean.
- **pi `-p` mode stdin-EOF 함정**: `pi --print` 모드에서 `< /dev/null` 미부착 시 부모 stdin socket이 EOF 안 와서 pi가 bootstrap 후 무한 대기. 분명한 hang 증상. 모든 LIVE probe shell 호출에 `< /dev/null` 필수 — 이건 BASELINE recipe README에 명시 필요.

---

## Current Priority — 0.5.0 context-pressure continuity policy

0.5.0 is **not ready for release**. The narrow guard split is implemented and static gates are green, but the real question is broader than the word "compact":

> When an ACP backend reaches context pressure, how does the session continue without pi-shell-acp becoming a second harness?

Working declaration:

| Layer | Default | Knob |
|---|---|---|
| pi JSONL compaction | blocked — pi-side summary does not reduce the backend transcript | `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1` |
| backend-native context management | **always allowed (no bridge knob)** — bridge does not inject disable guards | — configure the backend through its own native interface if needed |
| legacy `PI_SHELL_ACP_ALLOW_COMPACTION` | rejected at spawn intent with next-action message | — |

Static gates currently green: `pnpm typecheck`, `check-mcp` (15), `check-backends` (136), `check-models` (3 passes), `check-dep-versions` (6), `check-sdk-surface`, `check-registration` (8), `smoke-compaction-policy` default (2 deterministic pass — step 01 removed in maintainer cleanup, 02 + 05 remain; 3 live steps skipped without `LIVE=1`; step 05 directly exercises wrapper `resolveAcpBackendLaunch` and source-verifies that the production spawn entry `createBridgeProcess` carries the same guard after a reviewer-found bypass).

### Required questions before 0.5.0 tag

For **all three ACP backends — Claude (`claude-agent-acp`), Codex (`codex-acp`), Gemini (`gemini --acp`) — ask the same questions. Do not let a Claude/Codex-only success become an accidental three-backend claim.**

1. **Backend-owned continuation path**
   - When the backend context fills, what does that backend itself do?
   - Is there an advertised ACP slash command (`available_commands_update`) such as `compact` / `compress`?
   - If a command exists, is it invoked via regular `session/prompt` text, or only through a native client-side CLI surface?
   - If there is no command, is the intended path auto-compact, new session from summary, refusal/error, or something else?

2. **Bridge/session mapping behavior**
   - When backend-side context management happens, does the existing ACP session continue, rotate, emit `compact_boundary` / `usage_update`, or require `resume > load > new`?
   - What happens to pi-shell-acp's persisted `pi:<sessionId>` → `acpSessionId` mapping?
   - Does the pi session stay alive without hidden transcript hydration?

3. **Summary handoff boundary**
   - If a backend produces a summary, does ACP expose it as ordinary assistant text, a status/update event, usage metadata, or not at all?
   - Is pi-shell-acp expected to forward anything into the pi JSONL, or should it only surface backend output as-is?
   - What would be required to continue a pi session from a backend-produced summary **without** inventing a second harness?

### Three-backend continuity table — fill BEFORE BASELINE / README cleanup

Source columns intentionally separated so each row stays honest about *where* the answer comes from (probe / source code / unverified). "✗ unverified" is a first-class entry; do not collapse it.

#### Axis 1 — Context-pressure continuation path (what the backend itself does when full)

| Backend | Advertised ACP slash command? | Literal `/compact` over `session/prompt` works? | Auto-compact / threshold behavior? | If no compact path — what is the expected continuation? |
|---|---|---|---|---|
| **Claude** (`claude-agent-acp`) | `available_commands_update` is emitted (`acp-agent.ts:1124-1135` + `getAvailableSlashCommands` at `:1796-1826`, filters only `cost/keybindings-help/login/logout/output-style:new/release-notes/todos`). Whether the SDK's `supportedCommands()` actually includes `/compact` for the current Claude SDK build is **✗ unverified** — needs an ACP-side advertised-command-list capture from a live session. | **✓ probe-confirmed (wire signal)** — LIVE 03 (2026-05-13): `meter=acpUsageUpdate source=backend used=0` compact_boundary observed; text reply was ordinary ("READY"), so this is wire-only evidence. SDK path is `compact_boundary` event → `acp-agent.ts:781-804`. Re-tested after `hooks: {}` overlay fix: explicit `/compact` remains clean and the next user turn answers from compacted context. | **✓ probe-confirmed and fixed.** Organic compact fires and same-session mapping survives. Initial `hooks`-absent overlay reproduced prompt-sacrifice (`2026-05-13-claude-organic-fresh`), but explicit empty `hooks: {}` in `overlaySettingsJson()` fixes the turn shape (`2026-05-13-claude-hooks-empty`): compact status + substantive reasoning + direct answer to the triggering prompt. Operator hooks are still not inherited. A backend-native interface can alter this behavior; bridge default allows it. | N/A — compact path exists (explicit + organic, both LIVE and clean after overlay fix). |
| **Codex** (`codex-acp`) | `available_commands_update` emission is **✗ unverified** at the wire level (no ACP-side capture yet). Source confirms first-line slash parsing at `codex-acp/src/thread.rs:3215-3234` (`compact => Op::Compact`) and `extract_slash_command` at `:4097-4116`. | **✓ probe-confirmed (text + sentinel signal)** — 5/14 LIVE step 04: reply was literal `"Context compacted"`, sentinel `GLG-COMPACT-mp4plbzl-nk4iwv` preserved across compact. Wire usage drop 17964→11822 (~34%, below 50% threshold) — text+sentinel is the load-bearing signal pair on Codex for explicit `/compact`. Cross-confirmed by agent-shell free-form dialogue (model directly reported receiving a summary block). | **✓ closed on both surfaces.** *Cheap stand-in* (`probes/2026-05-14-codex-B-threshold/`): codex-native threshold knob lowered to 12000 fires pre-turn auto-compact + sentinel preserved. *Real saturation* (`probes/2026-05-14-codex-B-saturation/`): natural file-reading + heavy-analytic across 11 turns drove `used` 17k → 244k (~94.5%); turn 12 fires organic auto-compact natively, wire `used` 244089 → 84549 (**65% drop — wire classifier crosses the 50% threshold on its own here**, unlike Pattern A), assistant produces a substantive 982-word answer with 8+ line refs in the same turn, and the post-compact recall returns the exact sentinel `GLG-CODEX-SAT-1778718415-c251bd`. Native threshold for GPT-5.4 ≈ 245k (versus Claude Sonnet 4.6 ≈ 120k — same probe shape, honest asymmetry). | N/A — compact path exists, both explicit (`/compact`) and organic (cheap-induced + real saturation). |
| **Gemini** (`gemini --acp`) | **✓ source-confirmed negative** — `gemini-cli/packages/cli/src/acp/acpCommandHandler.ts:23-31` shows the ACP command registry contains only `memory, extensions, init, restore, about, help`; `compress`/`compact`/`summarize` are NOT registered. CLI body (`packages/cli/src/ui/commands/compressCommand.ts:10-13`) implements them as `compress` with aliases `summarize, compact`. Unknown slash → regular prompt fallback (`acpSession.ts:240-259`). | **✓ probe-confirmed negative on ACP wire** — LIVE 06 (2026-05-13): no compact reply, no wire compact_boundary, sentinel not recalled. `/compact` lands as a normal user prompt. **5/14 native CLI cross-check (GLG)**: `/compress` 93620 → 12936 tokens succeeded outside ACP, in native gemini CLI; mechanism is to rewrite local chat history with a `<state_snapshot>` summary as the new first user message. This is a **CLI-only** surface — not reachable through ACP. **PM cross-review (gpt-5.5 medium, 5/14)** confirmed the asymmetry. | **✓ source-confirmed (silent on wire)** — `client.ts:673-677`: `tryCompressChat(prompt_id, false)` is called at every turn start; on success it yields `GeminiEventType.ChatCompressed`. But `acpSession.ts` switch has no `ChatCompressed` case → `default: break`. Organic compression *may* happen in Gemini CLI on the ACP path, but it is **silently dropped on the ACP wire** — pi-shell-acp cannot observe it. If pressure remains after compression, `ContextWindowWillOverflow` → `acpSession.ts:369-371` → `stopReason: 'max_tokens'` ends the turn. | **✓ scope clarified, surface deliberately small.** Gemini ACP at the native window edge surfaces either (a) silent organic compression continuing the turn or (b) `max_tokens` stop reason — no `ChatCompressed`, no compact_boundary, no usage_drop signal. The bridge does not inject backend-specific Gemini compression knobs, does not synthesize a compact event, and does not handoff. Operator-facing UX at `max_tokens`: "Gemini ACP reached context pressure; native CLI has `/compress` but ACP does not expose it here. Start a fresh session or reduce context." This is closed as an **honest ACP asymmetry**, not as a pass. |

#### Axis 2 — Bridge / persisted-mapping behavior across the context-pressure event

| Backend | Same entwurf `taskId` across the event? | Same pi JSONL appended? | Bridge `bootstrapPath` after compact: `resume / load / new`? | Persisted `pi:<sessionId>` → `acpSessionId` reused or invalidated? | Bridge-side `usage_update` / `compact_boundary` observed? |
|---|---|---|---|---|---|
| **Claude** | ✓ probe-confirmed (LIVE 03 stderr) | ✓ same `plant.sessionFile` across all three turns | `new` → `resume` → `resume` (LIVE 03 stderr) | ✓ reused — `persistedAcpSessionId === acpSessionId` across all three turns (LIVE 03 stderr) | `[pi-shell-acp:usage] meter=acpUsageUpdate source=backend backend=claude used=0 size=200000` — explicit compact_boundary marker. |
| **Codex** | ✓ probe-confirmed. Pattern A: 5/14 LIVE 04 (`taskId=55e95c41`). Pattern B saturation: `piSessionId=019e23e1-3684-7583-a4d8-c4823f8c1b19`. | ✓ same JSONL per probe. Pattern B saturation captured all 13 turns under `/tmp/codex-Bsat-2JPOdm/session.jsonl`. | Pattern A: `new` → `resume` → `resume`. Pattern B saturation: `new` at turn (a), then `load` for turns (b..m); compact did not reset the backend session. | ✓ reused. Pattern B saturation kept `acpSessionId=019e23e1-3a43-7903-a669-7fd305394e77` across all 13 turns; persisted mapping stayed equal. | Pattern A: no `compact_boundary`; 34% drop, text+sentinel load-bearing. Pattern B saturation: `meter=acpUsageUpdate` `used` 244089 → 84549 (65% drop, crosses classifier threshold) plus text `Context compacted` and post-compact sentinel recall. |
| **Gemini** | ✓ probe-confirmed (LIVE 06) | ✓ same `plant.sessionFile` | `new` → `resume` → `resume` (LIVE 06 stderr) | ✓ reused (LIVE 06 stderr) | No wire compact_boundary; `meter=componentSum source=promptResponse used=0` is a **bridge fallback when the backend emitted no usage_update at all**, NOT a compact signal — flagged in `classifyUsageEvidence` after the false-positive was observed mid-probe. |

#### Axis 3 — Summary handoff boundary (how, if at all, summary reaches pi)

| Backend | Summary surface on the ACP wire | Does pi-shell-acp need to inject anything? | What does "continue pi session without second harness" actually require? |
|---|---|---|---|
| **Claude** | claude-agent-acp emits `"Compacting..."` + `"\n\nCompacting completed."` as `agent_message_chunk` text (`acp-agent.ts:781-820`). **Pattern A (explicit `/compact`)**: compact-only turn + wire `used=0`; next user turn answers normally from compacted context. **Pattern B (organic auto-compact)**: with `hooks: {}` in the overlay, the compacting turn itself continues into substantive reasoning and a direct answer to the triggering prompt. The earlier self-summary leak was the `hooks`-absent overlay failure baseline, not the final 0.5.0 behavior. | **No** — bridge forwards backend chunks as-is. The backend owns the hidden continuation summary; pi-shell-acp does not inject, reconstruct, or hydrate transcript. The `hooks: {}` fix only gives Claude SDK the configured-empty hooks shape it expects while still inheriting no operator hooks. | Same `acpSessionId` survives both patterns. Explicit `/compact` and organic compact both keep the pi session alive; shutdown preserves mapping (`closeRemote=false invalidatePersisted=false`). |
| **Codex** | "Context compacted" lands as ordinary assistant text. The *actual* summary (what the backend kept) is internal to codex-acp's `replace_compacted_history`; ACP does not expose it. **5/14 cross-confirm** — in a separate agent-shell + pi-shell-acp + codex-acp session, the model directly reported receiving a summary block after `/compact` and enumerated its contents (gogcli calendar call result, MCP probe outcomes, prior user/assistant exchange); pi-shell-acp did not inject or hydrate that summary. The real saturation probe confirms the same summary handoff boundary under default-threshold organic compact. | **No**. Same as Claude. | Same `acpSessionId` survives. 5/14 LIVE 04 (Pattern A): sentinel preserved across explicit compact. 5/14 B saturation: 13-turn native-threshold compact preserved `GLG-CODEX-SAT-1778718415-c251bd` and continued on the same mapping. |
| **Gemini** | Native CLI summary path is **internal history rewrite, not assistant-visible text**: `tryCompressChat` produces a `<state_snapshot>` summary via UTILITY_COMPRESSOR, optionally runs a verification turn, and injects the summary as the new first user message in the chat history (`{ role: 'user', parts: [{ text: finalSummary }] }` followed by `{ role: 'model', parts: [{ text: 'Got it. Thanks for the additional context!' }] }` and the truncated kept history). The model has no explicit "summary received" wire signal — its memory is simply replaced. **Critically, this entire surface is CLI-only — the ACP command registry does not advertise compress/compact/summarize, so ACP clients (agent-shell, pi-shell-acp) cannot reach it.** On the ACP path, organic `tryCompressChat` can still fire at turn start (`client.ts:673-677`), but the resulting `ChatCompressed` event is silently dropped by `acpSession.ts` (no case in the switch); if compression is insufficient, `ContextWindowWillOverflow` becomes `stopReason: 'max_tokens'`. No summary content is ever surfaced on the ACP wire. | **No.** Same as Claude/Codex — pi-shell-acp does not inject, hydrate, or rewrite Gemini's chat history. The bridge forwards backend output as-is. The Gemini-specific asymmetry (silent compression, no wire signal) is preserved and surfaced as `max_tokens` only when compression is insufficient. | Same `acpSessionId` survives the silent-compression path (LIVE 06 confirmed mapping stability against `/compact`-as-regular-prompt). The bridge-relevant continuation surface at the native window edge is now characterized (see Axis 1 last cell + Three-pattern Gemini block above): either silent organic continue or visible `max_tokens` stop. The CLI `/compress` mechanism is **not reachable through ACP**, so it does not by itself unblock the bridge-relevant question — the operator-facing answer when ACP surfaces `max_tokens` is a visible action (`/clear`, new session, native CLI `/compress`, or reduce context), not a hidden bridge-side handoff. |

#### What this table tells us about 0.5.0

- **Claude axis is closed after the hooks-empty overlay fix.** Pattern A (explicit `/compact`) remains clean; Pattern B (organic auto-compact) now answers the triggering prompt in the compacting turn. The observed prompt-sacrifice was caused by the overlay `settings.json` omitting `hooks`, not by a backend-native compaction limitation. `hooks: {}` is now an overlay invariant and does not inherit operator hooks.
- Codex `/compact` (explicit) and organic auto-compact are closed for the release claim. The lowered-threshold cheap stand-in proved path reachability; the real GPT-5.4 saturation probe proved default-threshold behavior at ~245k with wire drop + substantive compacting turn + sentinel preservation.
- Gemini `/compact` is closed as a **negative** (no ACP adapter surface) and the ACP context-pressure surface is characterized as far as the current release needs: silent organic compression may continue the turn, and unresolved pressure surfaces as `max_tokens`. This is sufficient for "all three backends honest" because it records the real Gemini ACP asymmetry rather than forcing a fake pass.
- Release tag is no longer gated on Gemini compaction. Claude and Codex have explicit and organic/default-threshold evidence with mapping survival; Gemini has source-confirmed negative evidence plus operator-facing `max_tokens` UX wording. A real 1M saturation run remains optional L5 evidence, not a 0.5.0 blocker.

### Immediate next steps

1. **Finish ACP standard + backend surface investigation**
   - llmlog in progress: `/home/junghan/org/llmlog/20260513T133346--acp-compaction-command-surface-investigation__acp_compaction_llmlog_pishellacp.org`.
   - Use precise wording: ACP appears to define a **generic slash-command surface** (`available_commands_update` + regular `session/prompt` invocation), not a dedicated compaction RPC. Therefore compact/compress semantics are backend/adapter-specific.
   - Before README edits, check this against `/home/junghan/repos/3rd/acp/agent-client-protocol` and the three backend implementations.

2. **Update verification plan to include Gemini deliberately**
   - Do not leave Gemini out merely because Claude/Codex probes exist.
   - If Gemini ACP has no compact/compress command surface, record that as a first-class result: what is Gemini's context-pressure continuation path under ACP?
   - 0.5.0 may still choose to limit live compact-command evidence to Claude/Codex, but only after the Gemini answer is explicit.

3. **Record actual live evidence in BASELINE only after scope is clear**
   - Claude + Codex live probes passed under the dual classifier; Gemini step 06 remains exploratory and belongs to the open context-pressure investigation. Keep the raw outcomes, but do not turn them into a release claim until the three-backend scope is written correctly.
   - BASELINE should distinguish: command advertisement/invocation, compact evidence, `usage_update`/boundary evidence, sentinel recall, and mapping/session survival.

4. **Then clean docs, not before**
   - README should end up short. Detailed backend differences belong in VERIFY / BASELINE / llmlog.

5. **Do not reintroduce a user-facing compact surface**
   - Do not add `/acp-compact` unless a future investigation proves a true cross-backend semantic contract.
   - Current evidence points against adding it: compact/compress semantics are backend-owned and surfaced differently.

### Explicit non-goals for 0.5.0 (carried forward)

- compact→new-session handoff
- `ctx.newSession()` / `switchSession()` from `session_before_compact`
- hidden session manager inside pi-shell-acp
- reading backend transcript files
- manual ACP hydration from pi JSONL
- semantic-memory/day-query/llmlog recap policy
- OpenClaw changes
- public `PI_SHELL_ACP_RECAP_HINT(_FILE)` interface
- assuming Claude/Codex evidence automatically covers Gemini
- claiming a cross-backend `/compact` semantic unless the ACP standard + backend implementations prove it
- L5 50-turn soak with periodic context-pressure events + sentinel recall (a 0.6.x candidate)
- #10 peer-handle / contact_peer / sessionId-only carrier RFC implementation (parked; cwd-authority portion landed in 0.4.17)

---

## Session model lock — closed for 0.5.0 (issue #14)

**Policy**: after a session is anchored, any model switch that touches `pi-shell-acp` is refused by immediate revert. Native-to-native switching remains free. Fresh startup/new sessions with no messages stay unlocked until the first prompt, so pre-turn model selector changes and CLI `--model` override remain configuration.

### Final coverage

| Scenario | Result | Guard |
|---|---|---|
| fresh startup/new before first prompt | free | `sessionLocked=false` |
| first prompt sent (`agent_start`) | lock begins | extension |
| resume/fork | locked immediately | extension |
| reload with existing messages | locked | extension |
| reload after already locked module state | locked | extension |
| native -> native | free | `touchesPiShellAcp=false` |
| native -> pi-shell-acp | reverted to native | extension |
| pi-shell-acp -> native | reverted to pi-shell-acp | extension |
| pi-shell-acp/X -> pi-shell-acp/Y | reverted to X on normal path | extension; bridge fallback if direct/reuse mismatch reaches `ensureBridgeSession` |

### Evidence

- `scripts/check-model-lock.ts` + `./run.sh check-model-lock`: **18/18 pass**. Covers the four provider quadrants, same-model no-op, first selection, pre-turn freedom, `agent_start`, resume/fork, reload, reentry, and defensive lock if entries cannot be read.
- `./run.sh smoke-model-switch`: bridge fallback A remains green for within-backend Claude, within-backend Codex, and cross-backend Claude -> Codex. In normal UX B fires first, so A is a fallback/direct-call boundary, not the happy path.
- GLG direct UX verification completed on 2026-05-14. The important cases are now covered: pre-turn selection free, post-turn switch reverted, resume switch reverted, `pi-shell-acp -> native` reverted, `native -> pi-shell-acp` reverted, native-to-native free.

### Honest limit

This is **not transcript-clean**. pi-core mutates `agent.state.model` and appends `model_change` before the extension/provider boundary can refuse:

- Extension revert leaves `X -> Y -> X`.
- Bridge fallback leaves attempted `X -> Y`.
- Clean refusal needs a pi-core cancellable preflight hook; that is intentionally outside this repo for 0.5.0.

Release docs now need only stay calibrated to this split: B extension guard is primary, A bridge guard is fallback, native-to-native is free, and transcript dirt is explicit.

---

## Parked, not current

- **#11** remote SSH resume cwd alignment — 나중에. 0.4.x 영역 아님.
- **#10** broader ontology RFC (peer handle, `contact_peer` verb, registry) — cwd-authority 부분은 0.4.17에서 닫음. 나머지는 새 evidence가 쌓일 때 재논의.
- **#8** ACP `entwurf_send` 메시지 UX visibility — #10 재논의 이후.
- **#2** pi-first context meter — 0.5.0 이후 영역.

---

## Completion rule

0.5.0 guard split이 끝나면 NEXT.md 전체를 다음 actual priority로 교체. 릴리즈 로그는 여기 남기지 않는다.
