# NEXT.md — pi-shell-acp

> 시작할 때 무엇을 할지 몰라서 발생하는 진행 정체를 막는다.
> 일정은 의미 없다. 적은 만큼 할 수 있는 만큼만 — 진행은 진행된다.
> 핵심을 놓치지 않는 것이 본질.

다축 맥락 복원(recap)이 "직전에 뭐했지"를 풀어준다.
이 문서는 그 옆에서 "다음에 뭐하지"를 고정한다.
두 축이 같이 있을 때 세션 시작이 자연스럽다.

---

## Current Priority — 0.5.0: backend-native compaction escape hatch

Single focus until done: **separate pi-side compaction from ACP backend-native compaction.**

We do **not** implement compact→new-session handoff in 0.5.0. That is still the cleaner long-term model, but it is not a small bridge patch. For OpenClaw compatibility, the smaller ACP-native path is:

```text
pi-side /compact or pi auto compaction  → blocked by default
ACP backend native compaction           → optionally allowed and verified
ACP usage_update / command output       → observed by client, as agent-shell does
```

Research notes:

- `~/org/llmlog/20260510T181532--pishellacp-compact-핸드오프-연구__llmlog_pishellacp_compaction_openclaw.org`
- agent-shell finding: no dedicated compact RPC was found. `/compact` appears to be a backend-advertised slash command (`available_commands_update`) that the client sends as an ordinary `session/prompt`. The client tracks `usage_update` and command/message results; it does not run its own compaction engine.

### Decision

0.5.0 should not claim pi-shell-acp has safe pi-side compaction or recap handoff.

0.5.0 should provide a **small, explicit backend-native compaction mode**:

- keep pi `session_before_compact` blocked unless a separate pi-side override is set
- allow removing Claude/Codex backend auto-compaction guards with a separate env knob
- document that OpenClaw long-chat viability depends on backend-native compaction, not pi JSONL compaction
- verify at least that the guard split behaves as intended; deeper OpenClaw tuning moves to 0.6.0

### Why split the knobs?

Current `PI_SHELL_ACP_ALLOW_COMPACTION=1` is too broad: it relaxes both pi-side and backend-side guards.

But those are different responsibilities:

| Layer | Safe default | Why |
|---|---|---|
| pi-side compaction | blocked | pi compaction summary is stored in pi JSONL, but pi-shell-acp forwards only the latest prompt to the existing ACP session, so the backend does not receive the summary |
| backend-native compaction | guarded today, but should be separately opt-in | ACP backends own their session transcript; agent-shell-style clients rely on backend commands/usage updates rather than client-side compact rewriting |

Therefore the likely minimal interface is:

```text
PI_SHELL_ACP_ALLOW_BACKEND_COMPACTION=1  # remove backend native compaction guards only
PI_SHELL_ACP_ALLOW_PI_COMPACTION=1       # optional/debug escape hatch for pi-side compaction; not recommended
```

Compatibility note: keep `PI_SHELL_ACP_ALLOW_COMPACTION=1` only if needed as a legacy alias, but avoid documenting it as the preferred OpenClaw path because it conflates both layers.

---

## Evidence so far

### agent-shell compact/command flow

- `agent-shell-completion.el` — command completion reads `agent-shell--state :available-commands`.
- `agent-shell.el` — `available_commands_update` stores backend-provided slash commands.
- `agent-shell.el` + `acp.el` — prompt sending uses ordinary `session/prompt`; no dedicated `session/compact` surface was found.
- `agent-shell-usage.el` — `usage_update` stores `used`, `size`, and `cost`; agent-shell observes context pressure rather than compacting locally.

Interpretation: ACP clients can stay thin. Backend-native `/compact` is just a backend command/behavior surfaced through normal prompt/update flow.

### pi-shell-acp current guard coupling

- `index.ts` — `session_before_compact` currently checks `PI_SHELL_ACP_ALLOW_COMPACTION` and otherwise cancels pi compaction.
- `acp-bridge.ts` — the same `PI_SHELL_ACP_ALLOW_COMPACTION` affects backend guards:
  - Claude: strips `DISABLE_AUTO_COMPACT` / `DISABLE_COMPACT`
  - Codex: omits `-c model_auto_compact_token_limit=9223372036854775807`

Interpretation: the existing knob proves the mechanism is small, but the policy is too coarse for OpenClaw.

### Runtime smoke — explicit backend `/compact` works (2026-05-10)

Direct bridge smoke, not pi host `/compact`: with current broad `PI_SHELL_ACP_ALLOW_COMPACTION=1`, send `"/compact"` as an ordinary ACP prompt to backend sessions.

- Claude / `claude-sonnet-4-6`:
  - warmup `usage_update`: `used=5328→5331`, `size=200000`
  - `/compact` returned normal `stopReason=end_turn`
  - message chunks: `Compacting...` then `Compacting completed.`
  - post-compact `usage_update`: `used=0`, cost update followed
- Codex / `gpt-5.4`:
  - `available_commands_update` included `compact`
  - warmup `usage_update`: `used=18816`, `size=258400`
  - `/compact` returned normal `stopReason=end_turn`
  - message chunk: `Context compacted`
  - post-compact `usage_update`: `used=5711`

This confirms the minimum OpenClaw premise: backend-native compact can be invoked explicitly through normal ACP prompt/update flow and returns observable result/usage. Remaining work is to split the env knobs so this path can be enabled without enabling unsafe pi-side compaction.

---

## Tasks

### Task 0 — discard abandoned hint-slot patch ✅

The `PI_SHELL_ACP_RECAP_HINT(_FILE)` patch was reverted. It may return later only as an operator/debug hook, not as the center of 0.5.0.

### Task 1 — research / source audit ✅

Completed via entwurf `eb8d8219` + resumed investigation `d698cbdb`.

Result:

- ordinary pi compaction is not sufficient for ACP sessions
- compact→new-session handoff is not small enough for 0.5.0
- agent-shell suggests the smaller ACP-native path: backend slash command + usage updates, not client-side compaction
- next implementation should be guard split, not recap engine

### Task 2 — implement guard split (small)

Goal: separate pi-side and backend-side compaction toggles.

Likely code points:

- `index.ts`
  - replace pi-side check with `PI_SHELL_ACP_ALLOW_PI_COMPACTION` (or legacy alias decision)
  - default remains cancel
  - error message should point to the pi-side override and explain backend-native compaction separately
- `acp-bridge.ts`
  - backend guard removal should check `PI_SHELL_ACP_ALLOW_BACKEND_COMPACTION`
  - update comments naming backend-native compaction
  - keep identity-isolation env untouched
- `run.sh`
  - update check-backends assertions for split knobs
  - verify backend toggle drops only compaction guards, not overlay env

Keep implementation surgical. No session handoff. No recap generation.

### Task 2.5 — developer-only ACP compact resilience smoke hook

Need an explicit way for GLG to test backend-native compaction during a normal pi-shell-acp session, e.g. while working with Opus/Sonnet/Codex. This is **not** an end-user command and not an OpenClaw-facing workflow. It is a developer smoke hook for the bridge's durable-execution invariant:

```text
pi session must survive backend-native compaction even if the ACP backend
compacts in place, rotates/respawns its backend session, or breaks the current
ACP child process. The bridge may reconnect, resume/load, or start a fresh ACP
session as needed, but pi must remain the durable shell.
```

Preferred name:

```text
/acp-compact
→ send literal "/compact" to the current ACP backend session as a normal backend prompt/command
→ return/display backend message chunks and PromptResponse normally
→ observe subsequent usage_update in footer/logs
```

Rules:

- This must **not** invoke pi host `/compact`.
- This must not be documented as something OpenClaw users should call.
- This must require backend-native compaction to be enabled or clearly explain if guards are still active.
- It is a test/dev surface, not a recap engine and not user-facing session management.
- If pi slash-command registration from provider extension is not available, provide an equivalent minimal CLI/RPC/debug command and document exact usage.
- Record result shape: message text (`Compacting completed.`, `Context compacted`), `stopReason`, `usage_update` before/after, and whether the next pi turn reuses/resumes/loads/creates the ACP backend session.

Resilience question to answer before promoting the OpenClaw story:

- If `/acp-compact` succeeds in place, does the existing `acpSessionId` continue to accept prompts?
- If the backend rotates its internal session or child process, does pi-shell-acp recover on the next turn via `resume > load > new` without losing the pi session?
- If the compact command breaks the current ACP prompt/child, does the error close only the bridge child while preserving the pi session and persisted mapping for recovery?
- If recovery falls back to `new`, is the behavior explicit in diagnostics (`bootstrap-fallback`, `bootstrap-invalidate`, `bootstrap path=new`) rather than silent transcript hydration?

This is the durable-execution test: ACP may compact, respawn, change, or fail; pi-shell-acp should keep pi alive and reattach or restart the backend side without becoming a hidden transcript manager.

### Task 3 — docs alignment

- README Compaction policy:
  - pi-side compaction blocked by default because pi JSONL summary is not delivered to ACP backend session
  - backend-native compaction can be allowed via `PI_SHELL_ACP_ALLOW_BACKEND_COMPACTION=1`
  - OpenClaw path: rely on backend-native compaction first; tune in 0.6.0
- AGENTS:
  - Hard Rule / Compaction bullet should mention split responsibilities
  - do not claim recap/new-session exists
- VERIFY:
  - evidence target for split guard behavior and usage-update observation
- CHANGELOG:
  - 0.5.0 = compaction guard split / OpenClaw preparation, not recap engine

### Task 4 — minimal verification

Before commit:

- `pnpm typecheck`
- `./run.sh check-backends`
- if cheap: `./run.sh check-models`

Required runtime smoke before calling 0.5.0 OpenClaw-ready:

- launch with `PI_SHELL_ACP_ALLOW_BACKEND_COMPACTION=1` after guard split
- confirm Claude/Codex backend guard is absent while pi-side compaction remains blocked
- repeat the explicit backend `/compact` smoke above under the split knob
- confirm post-compact `usage_update` still appears and context usage drops or otherwise reflects backend compaction
- record which backends expose `/compact` through `available_commands_update` and which do not

### Task 5 — commit / push / stamp

After GLG review only.

Remember: after commit + push, agenda stamp and Google Chat notification are required by repo policy.

---

## Explicit non-goals for 0.5.0

Do not do these now:

- implement compact→new-session handoff
- call `ctx.newSession()` / `switchSession()` from `session_before_compact`
- create a hidden session manager in pi-shell-acp
- read backend transcript files
- hydrate ACP backend from pi JSONL manually
- add semantic-memory/day-query/llmlog recap policy
- change OpenClaw
- add `PI_SHELL_ACP_RECAP_HINT(_FILE)` as public 0.5.0 interface
- spend more time designing a grand recap engine

---

## How to use this file

| 시점 | 행동 |
|---|---|
| 새 세션 시작 | recap 후 이 문서 읽기. 다른 일이 우선순위 같으면 그 일부터, 아니면 NEXT.md 따라 진행 |
| Task 완료 | 한 줄 strikeout 또는 항목 자체 삭제. 다음 Task로 |
| Current Priority 완료 | 다음 우선순위로 통째로 갱신 |
| 우선순위 자체가 바뀜 | 드물다. 흔들리면 이 문서 의미 사라진다. 의식적으로만 |

이 문서는 commit하고 push한다. 누가 보더라도 "지금 이 repo가 다음에 갈 자리"가 같은 한 곳에 박혀 있다.
