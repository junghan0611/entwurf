# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 완료된 릴리즈/조사 기록은 `CHANGELOG.md`, GitHub issue, commit history로 보낸다.

---

## Session resume entry — 2026-05-13 마지막 상태

코드 + deterministic gate는 green. 다음 세션은 §"Three-backend continuity table"의 **두 unverified 셀**로 바로 들어간다 — Axis 1 last column Gemini + Axis 3 Gemini. 다른 곳 손대지 말 것.

- 작업 중 PR 없음. uncommitted changes 보존됨 (`git status` 확인).
- llmlog: `~/org/llmlog/20260513T133346--acp-compaction-command-surface-investigation__acp_compaction_llmlog_pishellacp.org` — ACP 표준 + 3 backend source 조사 완료, 그대로 사용.
- LIVE 1차 baseline: Claude pass (wire), Codex pass (text), Gemini observed (`/compact` no-op). raw 결과는 §"Three-backend continuity table" 안에 인용됨.
- 다음 결정 GLG: A=Gemini context-fill LIVE / B=Gemini `unverified` 정직 record + BASELINE 작성 / C=Gemini ACP `available_commands_update` 먼저 capture.

---

## Current Priority — 0.5.0 context-pressure continuity policy

0.5.0 is **not ready for release**. The narrow guard split is implemented and static gates are green, but the real question is broader than the word "compact":

> When an ACP backend reaches context pressure, how does the session continue without pi-shell-acp becoming a second harness?

Working declaration:

| Layer | Default | Knob |
|---|---|---|
| pi JSONL compaction | blocked — pi-side summary does not reduce the backend transcript | `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1` |
| backend-native context management | allowed — pi-shell-acp does not inject disable guards | `PI_SHELL_ACP_DISABLE_BACKEND_COMPACTION=1` (escape hatch) |
| legacy `PI_SHELL_ACP_ALLOW_COMPACTION` | rejected at spawn intent with next-action message | — |

Static gates currently green: `pnpm typecheck`, `check-mcp` (15), `check-backends` (137), `check-models` (3 passes), `check-dep-versions` (6), `check-sdk-surface`, `check-registration` (8), `smoke-compaction-policy` default (4 deterministic pass, 2 live steps skipped without `LIVE=1`; step 05 covers both wrapper `resolveAcpBackendLaunch` AND production `createBridgeProcess` paths after a reviewer-found bypass).

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
| **Claude** (`claude-agent-acp`) | `available_commands_update` is emitted (`acp-agent.ts:1124-1135` + `getAvailableSlashCommands` at `:1796-1826`, filters only `cost/keybindings-help/login/logout/output-style:new/release-notes/todos`). Whether the SDK's `supportedCommands()` actually includes `/compact` for the current Claude SDK build is **✗ unverified** — needs an ACP-side advertised-command-list capture from a live session. | **✓ probe-confirmed (wire signal)** — LIVE 03 (2026-05-13): `meter=acpUsageUpdate source=backend used=0` compact_boundary observed; text reply was ordinary ("READY"), so this is wire-only evidence. SDK path is `compact_boundary` event → `acp-agent.ts:781-804`. | SDK has a token-threshold auto-compact (the `DISABLE_AUTO_COMPACT` env var our 0.4.x escape hatch toggles). Threshold is **✗ unverified** under 0.5.0 defaults — not exercised by our 3-prompt probe; would require filling the context window deliberately. | N/A — compact path exists. |
| **Codex** (`codex-acp`) | `available_commands_update` emission is **✗ unverified** at the wire level (no ACP-side capture yet). Source confirms first-line slash parsing at `codex-acp/src/thread.rs:3215-3234` (`compact => Op::Compact`) and `extract_slash_command` at `:4097-4116`. | **✓ probe-confirmed (text signal)** — LIVE 04 (2026-05-13): reply was literal `"Context compacted"`. Wire usage drop 17897→11918 (~34%, below our 50% wire threshold), so text is the load-bearing signal. | `model_auto_compact_token_limit` is the threshold knob (0.4.x pinned i64::MAX; 0.5.0 default unpinned). Actual threshold behavior under 0.5.0 defaults is **✗ unverified** (would require context-window fill). | N/A — compact path exists. |
| **Gemini** (`gemini --acp`) | **✓ source-confirmed negative** — `gemini-cli/packages/cli/src/acp/acpCommandHandler.ts:18-29` shows the ACP command registry does **not** include `compress` / `compact`. CLI body (`packages/cli/src/ui/commands/compressCommand.ts:10-49`) implements them, but the ACP adapter never advertises them. Unknown slash → regular prompt fallback (`acpSession.ts:240-259`). | **✓ probe-confirmed negative** — LIVE 07 (2026-05-13): no compact reply, no wire compact_boundary, sentinel not recalled. `/compact` lands as a normal user prompt. | Threshold auto-compact at the ACP layer: **✗ unverified** — Gemini CLI body has compaction, but whether the ACP adapter triggers it autonomously when context fills is **the critical unanswered question for this row**. | **✗ unverified — load-bearing for this release.** What is the expected user-visible continuation when a Gemini ACP session hits context limit? `max_tokens` stop reason? error? silent truncation? new session required? Until this is answered, the 0.5.0 claim about "bridge does not implement compaction" leaves Gemini behavior implicit. |

#### Axis 2 — Bridge / persisted-mapping behavior across the context-pressure event

| Backend | Same entwurf `taskId` across the event? | Same pi JSONL appended? | Bridge `bootstrapPath` after compact: `resume / load / new`? | Persisted `pi:<sessionId>` → `acpSessionId` reused or invalidated? | Bridge-side `usage_update` / `compact_boundary` observed? |
|---|---|---|---|---|---|
| **Claude** | ✓ probe-confirmed (LIVE 03 stderr) | ✓ same `plant.sessionFile` across all three turns | `new` → `resume` → `resume` (LIVE 03 stderr) | ✓ reused — `persistedAcpSessionId === acpSessionId` across all three turns (LIVE 03 stderr) | `[pi-shell-acp:usage] meter=acpUsageUpdate source=backend backend=claude used=0 size=200000` — explicit compact_boundary marker. |
| **Codex** | ✓ probe-confirmed (LIVE 04) | ✓ same `plant.sessionFile` | `new` → `resume` → `resume` (LIVE 04 stderr — needs capture) | ✓ reused (LIVE 04 stderr) | No wire compact_boundary; `meter=acpUsageUpdate ... used=11918` (drop, not boundary). Text "Context compacted" is the marker on this backend. |
| **Gemini** | ✓ probe-confirmed (LIVE 07) | ✓ same `plant.sessionFile` | `new` → `resume` → `resume` (LIVE 07 stderr) | ✓ reused (LIVE 07 stderr) | No wire compact_boundary; `meter=componentSum source=promptResponse used=0` is a **bridge fallback when the backend emitted no usage_update at all**, NOT a compact signal — flagged in `classifyUsageEvidence` after the false-positive was observed mid-probe. |

#### Axis 3 — Summary handoff boundary (how, if at all, summary reaches pi)

| Backend | Summary surface on the ACP wire | Does pi-shell-acp need to inject anything? | What does "continue pi session without second harness" actually require? |
|---|---|---|---|
| **Claude** | claude-agent-acp emits `"Compacting..."` + `"\n\nCompacting completed."` as `agent_message_chunk` text (`acp-agent.ts:466-503`). **✗ unverified whether these chunks actually reached pi JSONL** in our LIVE — `analyzeSessionFileLike` saw `lastAssistantText="READY"`, so either the chunks did not arrive, or they were overwritten by a later same-turn message. Needs a pi-side JSONL capture across `compact_boundary` to resolve. | **No** (provisional). Bridge surfaces backend ACP updates as-is; no hydration. | Same `acpSessionId` survives → next prompt continues. Provisional answer is "nothing required beyond keeping the persisted mapping intact" — confirmed by LIVE 03 recall succeeding. |
| **Codex** | "Context compacted" lands as ordinary assistant text. The *actual* summary (what the backend kept) is internal to codex-acp's state; ACP does not expose it. | **No**. Same as Claude. | Same `acpSessionId` survives. Confirmed by LIVE 04 recall succeeding. |
| **Gemini** | No summary path observed — `/compact` was treated as a regular prompt, no compaction occurred. **The real Axis 3 question for Gemini is unanswered: when context fills, what does Gemini surface on the ACP wire?** stop reason? error? silent? | Provisional **No** until Gemini's context-pressure path is observed. | Provisional same-`acpSessionId`. But the real continuation question depends on what Gemini does when full — see Axis 1 last column. |

#### What this table tells us about 0.5.0

- Claude / Codex `/compact` paths are sufficiently closed for the release claim *as worded today* (bridge stays alive, mapping reused, no hydration).
- Gemini `/compact` is closed as a **negative** (no ACP adapter surface) — sufficient.
- **Gemini's actual context-pressure continuation path is the one open question that blocks the release.** A claim about "what the bridge does when the backend is full" cannot be honest while one of the three backends' full-state behavior is unknown.
- The release tag is gated on filling Axis 1's last column (and Axis 3's Gemini row) with an actual observation, not a guess.

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
