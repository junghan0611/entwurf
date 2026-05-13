# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 완료된 릴리즈/조사 기록은 `CHANGELOG.md`, GitHub issue, commit history로 보낸다.

---

## Session resume entry — 2026-05-13 마지막 상태

코드 + deterministic gate는 green. 0.5.0 핵심 결정 두 개 살아있음 — (1) backend escape hatch 완전 제거 commit 통과 (백엔드 auto-compact 전역 ON, no bridge knob), (2) Claude organic context-full 실험은 다음 단계로 잡혀있음.

- 작업 중 PR 없음. uncommitted: 0.5.0 compaction policy 단순화 변경분 (직전 commit `15abd44` 후속).
- llmlog: `~/org/llmlog/20260513T133346--acp-compaction-command-surface-investigation__acp_compaction_llmlog_pishellacp.org` — ACP 표준 + 3 backend source 조사 완료, 그대로 사용.
- LIVE 1차 baseline: Claude pass (wire), Codex pass (text), Gemini observed (`/compact` no-op). raw 결과는 §"Three-backend continuity table" 안에 인용됨.

### 다음 한 걸음 (잊지 말 것)

**Claude organic context-full 축은 닫혔다 (2026-05-13 15:48 KST).** Three-backend continuity table의 Claude Axis 1 last column + Axis 3 셀이 `✓ probe-confirmed`로 전환됨. 시나리오 C 수준 evidence 확보.

남은 두 셀:
- **Codex organic context-full** — 같은 fixture 패턴 필요 (saturated Codex pi-shell-acp 세션 → resume → cheap probe).
- **Gemini context-pressure ACP surface** — `/compact` no-op은 닫혔지만 context가 진짜로 찼을 때 wire에서 무엇이 나오는지 (stop reason / error / silent / 새 세션 필요)는 아직.

### Cross-validation 메모

- 직전 commit `15abd44`는 0.5.0 정책 split (pi/backend knob 분리). 그 위에 쌓인 이번 uncommitted는 *backend escape hatch 완전 제거* (단일 knob — `PI_SHELL_ACP_ALLOW_PI_COMPACTION`만 남음) **+ organic compact LIVE evidence** (Claude only, 2026-05-13).
- GPT-5.4 분신 cross-review 완료 — missed residue 3건과 Codex config 문구 정밀화 fix를 GLG가 직접 반영함 (CONTRIBUTING.md, demo README, scripts/compaction-policy-smoke.ts 모두 single-knob 모델로 정렬).
- Organic 재현 명령 (5/13 확정): `pias --session demo/compaction-policy-smoke/fixtures/pre-backend-compact--019e19e0--org-sonnet-97pct.jsonl -p "READY?"` (단 fixture는 read-only — 실제 실행 전 active session dir로 복사). `pias` alias = `PI_SHELL_ACP_DEBUG=1 pi --model pi-shell-acp/claude-sonnet-4-6 --entwurf-control --emacs-agent-socket server`. `--emacs-agent-socket server` flag는 `bridgeConfigSignature`에 포함되어 있어 빠지면 `incompatible_config`로 매핑 자동 무효화 → fresh `new` 세션으로 떨어짐 (signature는 `index.ts:836` `JSON.stringify({ base, emacsAgentSocket })`).

---

## Current Priority — 0.5.0 context-pressure continuity policy

0.5.0 is **not ready for release**. The narrow guard split is implemented and static gates are green, but the real question is broader than the word "compact":

> When an ACP backend reaches context pressure, how does the session continue without pi-shell-acp becoming a second harness?

Working declaration:

| Layer | Default | Knob |
|---|---|---|
| pi JSONL compaction | blocked — pi-side summary does not reduce the backend transcript | `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1` |
| backend-native context management | **always allowed (no bridge knob)** — bridge does not inject disable guards | — set backend's own native env/argv directly if needed (`DISABLE_AUTO_COMPACT=1` etc.) |
| legacy `PI_SHELL_ACP_ALLOW_COMPACTION` | rejected at spawn intent with next-action message | — |

Static gates currently green: `pnpm typecheck`, `check-mcp` (15), `check-backends` (137), `check-models` (3 passes), `check-dep-versions` (6), `check-sdk-surface`, `check-registration` (8), `smoke-compaction-policy` default (3 deterministic pass, 3 live steps skipped without `LIVE=1`; step 05 directly exercises wrapper `resolveAcpBackendLaunch` and source-verifies that the production spawn entry `createBridgeProcess` carries the same guard after a reviewer-found bypass).

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
| **Claude** (`claude-agent-acp`) | `available_commands_update` is emitted (`acp-agent.ts:1124-1135` + `getAvailableSlashCommands` at `:1796-1826`, filters only `cost/keybindings-help/login/logout/output-style:new/release-notes/todos`). Whether the SDK's `supportedCommands()` actually includes `/compact` for the current Claude SDK build is **✗ unverified** — needs an ACP-side advertised-command-list capture from a live session. | **✓ probe-confirmed (wire signal)** — LIVE 03 (2026-05-13): `meter=acpUsageUpdate source=backend used=0` compact_boundary observed; text reply was ordinary ("READY"), so this is wire-only evidence. SDK path is `compact_boundary` event → `acp-agent.ts:781-804`. | **✓ probe-confirmed (organic LIVE 2026-05-13 15:48 KST)** — fixture `demo/compaction-policy-smoke/fixtures/pre-backend-compact--019e19e0--org-sonnet-97pct.jsonl` resumed at 97.4 % / 200k via `pias --session <copy> -p "READY?"`. SDK auto-compact fires before prompt processing. Wire: 97 % → 7.3 % `used` drop (`used=14675 / 200000`, raw `output=1437 cacheRead=19952 cacheWrite=6889`). No `used=0` synthetic boundary on the organic path — that artifact is explicit `/compact` only (LIVE 03 path via `compact_boundary` SDK event). Text: leading `Compacting...\n\nCompacting completed.` chunks land in pi stdout (Axis 3 row). `DISABLE_AUTO_COMPACT` exported from the operator shell would suppress this; default does not. | N/A — compact path exists (explicit + organic, both confirmed). |
| **Codex** (`codex-acp`) | `available_commands_update` emission is **✗ unverified** at the wire level (no ACP-side capture yet). Source confirms first-line slash parsing at `codex-acp/src/thread.rs:3215-3234` (`compact => Op::Compact`) and `extract_slash_command` at `:4097-4116`. | **✓ probe-confirmed (text signal)** — LIVE 04 (2026-05-13): reply was literal `"Context compacted"`. Wire usage drop 17897→11918 (~34%, below our 50% wire threshold), so text is the load-bearing signal. | `model_auto_compact_token_limit` is the threshold knob (0.4.x pinned i64::MAX; 0.5.0 default unpinned). Actual threshold behavior under 0.5.0 defaults is **✗ unverified** (would require context-window fill). | N/A — compact path exists. |
| **Gemini** (`gemini --acp`) | **✓ source-confirmed negative** — `gemini-cli/packages/cli/src/acp/acpCommandHandler.ts:18-29` shows the ACP command registry does **not** include `compress` / `compact`. CLI body (`packages/cli/src/ui/commands/compressCommand.ts:10-49`) implements them, but the ACP adapter never advertises them. Unknown slash → regular prompt fallback (`acpSession.ts:240-259`). | **✓ probe-confirmed negative** — LIVE 06 (2026-05-13): no compact reply, no wire compact_boundary, sentinel not recalled. `/compact` lands as a normal user prompt. | Threshold auto-compact at the ACP layer: **✗ unverified** — Gemini CLI body has compaction, but whether the ACP adapter triggers it autonomously when context fills is **the critical unanswered question for this row**. | **✗ unverified — load-bearing for this release.** What is the expected user-visible continuation when a Gemini ACP session hits context limit? `max_tokens` stop reason? error? silent truncation? new session required? Until this is answered, the 0.5.0 claim about "bridge does not implement compaction" leaves Gemini behavior implicit. |

#### Axis 2 — Bridge / persisted-mapping behavior across the context-pressure event

| Backend | Same entwurf `taskId` across the event? | Same pi JSONL appended? | Bridge `bootstrapPath` after compact: `resume / load / new`? | Persisted `pi:<sessionId>` → `acpSessionId` reused or invalidated? | Bridge-side `usage_update` / `compact_boundary` observed? |
|---|---|---|---|---|---|
| **Claude** | ✓ probe-confirmed (LIVE 03 stderr) | ✓ same `plant.sessionFile` across all three turns | `new` → `resume` → `resume` (LIVE 03 stderr) | ✓ reused — `persistedAcpSessionId === acpSessionId` across all three turns (LIVE 03 stderr) | `[pi-shell-acp:usage] meter=acpUsageUpdate source=backend backend=claude used=0 size=200000` — explicit compact_boundary marker. |
| **Codex** | ✓ probe-confirmed (LIVE 04) | ✓ same `plant.sessionFile` | `new` → `resume` → `resume` (LIVE 04 stderr — needs capture) | ✓ reused (LIVE 04 stderr) | No wire compact_boundary; `meter=acpUsageUpdate ... used=11918` (drop, not boundary). Text "Context compacted" is the marker on this backend. |
| **Gemini** | ✓ probe-confirmed (LIVE 06) | ✓ same `plant.sessionFile` | `new` → `resume` → `resume` (LIVE 06 stderr) | ✓ reused (LIVE 06 stderr) | No wire compact_boundary; `meter=componentSum source=promptResponse used=0` is a **bridge fallback when the backend emitted no usage_update at all**, NOT a compact signal — flagged in `classifyUsageEvidence` after the false-positive was observed mid-probe. |

#### Axis 3 — Summary handoff boundary (how, if at all, summary reaches pi)

| Backend | Summary surface on the ACP wire | Does pi-shell-acp need to inject anything? | What does "continue pi session without second harness" actually require? |
|---|---|---|---|
| **Claude** | claude-agent-acp emits `"Compacting..."` + `"\n\nCompacting completed."` as `agent_message_chunk` text (`acp-agent.ts:466-503`). **✓ probe-confirmed (organic LIVE 2026-05-13 15:48 KST)** — both chunks land in pi stdout as ordinary assistant text on the organic auto-compact path. The earlier LIVE 03 `lastAssistantText="READY"` reading was the explicit `/compact` artifact (SDK suppresses the chunk in that path and emits a wire-only `used=0` synthetic `usage_update` via `compact_boundary` instead — see `acp-agent.ts:781-804`). Organic ≠ explicit: organic surfaces *text*, explicit surfaces *wire*. Dual classifier already covers both. | **No** — confirmed by the organic probe: bridge surfaces backend ACP updates as-is, no hydration, no second-harness behavior. The "Compacting..." chunks reach pi by riding the same `session/update` path as any assistant text. | Same `acpSessionId` survives across the compact event. Confirmed both by LIVE 03 (explicit) recall and by the organic probe stderr (`bootstrapPath=resume`, `persistedAcpSessionId === acpSessionId === a01cb05f-786a-4f9d-89c8-139a95506440`, `closeRemote=false invalidatePersisted=false`). |
| **Codex** | "Context compacted" lands as ordinary assistant text. The *actual* summary (what the backend kept) is internal to codex-acp's state; ACP does not expose it. | **No**. Same as Claude. | Same `acpSessionId` survives. Confirmed by LIVE 04 recall succeeding. |
| **Gemini** | No summary path observed — `/compact` was treated as a regular prompt, no compaction occurred. **The real Axis 3 question for Gemini is unanswered: when context fills, what does Gemini surface on the ACP wire?** stop reason? error? silent? | Provisional **No** until Gemini's context-pressure path is observed. | Provisional same-`acpSessionId`. But the real continuation question depends on what Gemini does when full — see Axis 1 last column. |

#### What this table tells us about 0.5.0

- **Claude axis closed at scenario-C level (2026-05-13 organic probe).** Both `/compact` paths (explicit via LIVE 03; organic via the fixture-resumed pre-saturation probe) confirm the bridge declaration: backend auto-compacts on its own, `Compacting...` / `Compacting completed.` chunks reach pi as ordinary assistant text, persisted mapping survives, no transcript hydration, no second-harness behavior. The artifact split between explicit (wire `used=0` synthetic boundary) and organic (text chunks + ≥90 % `used` drop) is documented; the dual classifier covers both.
- Codex `/compact` (explicit) is closed for the release claim. Organic auto-compact threshold under 0.5.0 defaults is still **✗ unverified** — same context-window-fill experiment shape as the Claude organic probe, with a saturated Codex pi-shell-acp session as the resume target.
- Gemini `/compact` is closed as a **negative** (no ACP adapter surface) — sufficient. Gemini's actual context-pressure continuation path on the ACP wire (Axis 1 last column, Axis 3) is still the unverified row that blocks "all three backends honest" for the tag.
- Release tag is gated on: (a) the Codex organic probe — same fixture pattern as Claude's; (b) Gemini's context-pressure ACP surface (stop reason / error / silent / new-session required). Until those two land, the 0.5.0 claim about "bridge does not implement compaction" leaves Codex organic + Gemini behavior implicit.

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
   - Claude + Codex `LIVE=1 ./run.sh smoke-compaction-policy` reportedly reached `6 pass, 0 fail, 0 observed`; keep the raw outcome, but do not turn it into a release claim until the three-backend scope is written correctly.
   - BASELINE should distinguish: command advertisement/invocation, compact evidence, `usage_update`/boundary evidence, sentinel recall, and mapping/session survival.

4. **Then clean docs, not before**
   - README should end up short. Detailed backend differences belong in VERIFY / BASELINE / llmlog.

5. **Follow-up verification after the simplification commit**
   - Add one small smoke for operator override usability: prove the bridge still loses to native operator override on purpose (`DISABLE_AUTO_COMPACT=1` for Claude; Codex via `CODEX_ACP_COMMAND` and/or exported `CODEX_HOME`).
   - Keep the claim precise until that lands: current smoke proves bridge policy and source-guard placement, not a full production runtime spawn for the operator override path.
   - Do not add a user-facing `/acp-compact` unless the investigation proves a true cross-backend semantic contract. Current evidence points against adding it.

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

## Parked, not current

- **#11** remote SSH resume cwd alignment — 나중에. 0.4.x 영역 아님.
- **#10** broader ontology RFC (peer handle, `contact_peer` verb, registry) — cwd-authority 부분은 0.4.17에서 닫음. 나머지는 새 evidence가 쌓일 때 재논의.
- **#8** ACP `entwurf_send` 메시지 UX visibility — #10 재논의 이후.
- **#2** pi-first context meter — 0.5.0 이후 영역.

---

## Completion rule

0.5.0 guard split이 끝나면 NEXT.md 전체를 다음 actual priority로 교체. 릴리즈 로그는 여기 남기지 않는다.
