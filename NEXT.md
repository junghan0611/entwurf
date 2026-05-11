# NEXT.md — pi-shell-acp

> 시작할 때 무엇을 할지 몰라서 발생하는 진행 정체를 막는다.
> 일정은 의미 없다. 적은 만큼 할 수 있는 만큼만 — 진행은 진행된다.
> 핵심을 놓치지 않는 것이 본질.

다축 맥락 복원(recap)이 "직전에 뭐했지"를 풀어준다.
이 문서는 그 옆에서 "다음에 뭐하지"를 고정한다.
두 축이 같이 있을 때 세션 시작이 자연스럽다.

---

## 0.4.15 — ACP `entwurf_send` sent UX (issue #8) ✓

[Issue #8](https://github.com/junghan0611/pi-shell-acp/issues/8) — ACP `entwurf_send` sent messages are visually buried in tool logs vs received custom-message regions.

Release status:

- Native path: `[entwurf sent →]` via native `renderResult`. ✓
- ACP path: Armin-style customMessage + provider-level context filter. ✓
- All three ACP backends (Claude / Codex / Gemini) verified — visual parity with `[entwurf received ⟵]`. ✓
- Gemini integration is source-grounded:
  - args from `tool_call.content[].content.text` cached as `startContent`
  - result from `tool_call_update.content[].content.text` via `firstTextContent` fallback
  - evidence: `~/org/llmlog/20260511T152235--gemini-cli-acp-tool-call-실증__llmlog_pishellacp_gemini.org`
- Active stale model refs (`gpt-5.2`) removed from smoke/sentinel surfaces; `smoke-gemini` npm script added.

Known minor follow-up: Gemini transcript can show MCP args JSON inline before the box. The sent box itself is correct; the args echo is a separate cosmetic follow-up, not an issue #8 blocker.

### Why this is next

0.4.14 made cross-session messaging first-class on the **receive** side (`[entwurf received ⟵]` custom-message region with envelope header). The **send** side, when going through ACP, still falls into tool-log text — because `pi-shell-acp/event-mapper.ts` converts ACP tool updates into assistant text chunks via `pushNotice`. So in the human-greeted multi-session topology that 0.4.14 is supposed to support, the operator keeps losing track of which messages were sent from this session. Functional, but it undermines the very pattern 0.4.14 enables.

### Approach — pi-mono untouched, Armin-style UI/context split inside pi-shell-acp

Do **not** PR pi-mono for 0.4.15. The right boundary is not "make ACP look native by routing MCP through native pi" — that dirties pi. ACP sends must stay MCP sends. Native sends should use native tool rendering. The two paths are intentionally asymmetric because their surfaces are different.

Armin's extension pattern in `/home/junghan/repos/3rd/agent-stuff/extensions/` is the model:

- `control.ts` — custom message renderer uses `Box` / `Markdown` for visible session messages.
- `goal.ts` — `pi.sendMessage({ customType, content, display: true }, { triggerTurn: false })` creates a visible UI message, then `pi.on("context")` filters that `customType` out of LLM context.
- `btw.ts`, `review.ts`, `loop.ts` — `appendEntry` is for durable extension state, not for making a message visibly render like a conversation event.

Key correction: `pi.sendMessage` is not automatically context pollution if the extension also owns a `context` hook that removes the UI-only `customType`. This gives pi-shell-acp a pi-mono-compatible way to show first-class UI notices without changing upstream.

#### Layer A — native in-process path

Use the surface native tools already have:

- `pi-extensions/entwurf-control.ts`
- `entwurf_send.renderResult(...)`
- add a `renderSentMessage(...)` helper that mirrors `renderSessionMessage(...)`:
  - label: `[entwurf sent →]`
  - target: `to: <sessionId>`
  - source: `from: <agentId> @ <cwd>` from `buildLocalSenderEnvelope(ctx)`
  - mode / optional `(wants reply)` if native schema grows that field later
  - message body as Markdown

Do not use `pi.sendMessage` for the native tool result. Tool-result rendering is already the clean channel here.

Implementation note: `renderResult` is `(result, options, theme, ctx)` per `ToolDefinition` in `pi-mono/coding-agent/.../extensions/types.ts:467-472`. `ctx: ToolRenderContext` exposes `args: TArgs`, so original input params are reachable. The current `entwurf-control.ts` `renderResult` only destructures the first three parameters — extend it to take the 4th and read `ctx.args` for `sessionId` / `message` / `mode` / `wants_reply`. Values that come from the RPC response (`deliveredAs`, computed sender envelope) belong in `execute()` success `details` and stay there. `ctx.args` is the canonical channel; `details` is the fallback for fields that are no longer authoritative on input.

Evidence pin (so future sessions don't re-derive): `pi-mono/agent/src/agent-loop.ts:282-289` runs `transformContext` before `convertToLlm`. The `pi.on("context")` filter therefore catches our custom UI message while `customType` is still intact, and the message never reaches the LLM-shape `Message[]`. This is the structural reason Layer B's UI/context split actually works without a `CustomMessage.excludeFromContext` field.

#### Layer B — ACP/MCP path

Do not route ACP `entwurf_send` through native `entwurf_send`. ACP tool calls are MCP calls and must remain MCP calls.

Preferred direction is Armin-style UI/context split inside pi-shell-acp:

1. Detect completed MCP `entwurf_send` in `event-mapper.ts` / bridge event handling.
2. Extract the existing MCP result body from `mcp/pi-tools-bridge/src/index.ts` (`[entwurf sent →] ...`).
3. Emit a pi-shell-acp-owned custom UI message, e.g. `customType: "entwurf-sent"`, `display: true`, `triggerTurn: false`.
4. Register a renderer for that custom type that uses the same `Box` visual language as `renderSessionMessage(...)`.
5. Add a `pi.on("context")` filter that removes `customType === "entwurf-sent"` from LLM context, following `agent-stuff/extensions/goal.ts`.
6. Suppress ordinary `[tool:start]` / `[tool:done]` notice spam for successful `entwurf_send`; keep failed/cancelled surfaces visible. Optionally expose start/done under `PI_SHELL_ACP_DEBUG=1`.

Fallback if the bridge event layer cannot access `ExtensionAPI` cleanly in the first cut: special-case `entwurf_send` in `event-mapper.ts` and render the full result body as an emphasized ANSI notice. That is acceptable as a short-lived stepping stone, but the target design is the Armin-style custom message + context filter.

### Acceptance

- No pi-mono changes / no upstream PR required.
- ACP sends remain MCP sends; native sends remain native tool results.
- Sent peer messages are visually first-class (`[entwurf sent →]`) and directionally paired with `[entwurf received ⟵]`.
- Sent UI echo does **not** enter LLM context: either it is a native tool result, or it is a custom UI message filtered by `pi.on("context")`.
- ACP `entwurf_send` no longer appears as buried generic `[tool:start]` / `[tool:done]` noise on successful sends.
- Claude/Codex/Gemini promotion works on verified paths. Gemini must never emit an empty late sent box; if args/body cannot be recovered, fall back to raw visibility instead of inventing fields.

### Scope warning

This is a pi-shell-acp-internal rendering/context split, not a pi-mono protocol extension. The main design risk is finding the clean injection point from ACP event handling to `ExtensionAPI.sendMessage` plus a repo-owned context filter. If that seam is too large for the first cut, land the ANSI `event-mapper.ts` fallback first and keep the Armin-style custom-message path as the target.

---

## Blocker before 0.5.0 — `entwurf_resume` transcript hydration regression ([#9](https://github.com/junghan0611/pi-shell-acp/issues/9))

**0.5.0 cannot start until this is fixed.** A backend-native compaction guard split presumes `resumeSession` continuity is intact. It currently is not.

### Symptom

`entwurf_resume` keeps the same Task ID, the same model, and correctly appends the new turn to the saved session JSONL — but the resumed sibling has no memory of its own prior assistant turn. Identity Preservation Rule is satisfied at the routing layer and broken at the transcript layer.

### Evidence pinned

- demo flow: `demo/demo.sh` Scene 1 (spawn, stores "tempered indigo") → Scene 2 (resume, recall asks for the color) returns `"모르겠습니다 — 현재 컨텍스트에 해당 정보가 없습니다"`.
- saved session: `~/.pi/agent/sessions/--home-junghan-repos-gh-pi-shell-acp--/2026-05-11T08-56-18-077Z_entwurf-a3dce62b.jsonl`. 7 lines: line 5 holds the fact in an assistant turn; line 7's thinking confesses *"Looking through the AGENTS.md and system context provided, I don't have it"* — proof the model never saw line 5.
- 0.4.5 precedent: AGENTS.md Hard Rule #10 documents the same silhouette (SDK rename caused silent `resume → load` fallthrough). Fix must be structural, not vigilance.

### Acceptance

- `./run.sh verify-resume` covers **fact recall**, not just session-id continuity. A scripted spawn that plants a unique sentinel in turn 1 must read it back via `entwurf_resume` in turn 2 before the gate goes green.
- `demo/demo.sh` Scene 2 returns `tempered indigo` without further prompt edits.
- `check-sdk-surface` keeps its static gate on `resumeSession` and grows a runtime smoke that confirms the SDK method was actually invoked (counter or echo).
- Child `entwurf` stderr is captured (debug knob), not silently lost — the demo's `sender-debug.log` only showed the parent's bootstrap, not the spawned sibling's, which is why the regression hid through release.

### Out of scope here

- Inventing an alternate hydration path through extra `entwurf_resume` params. Saved JSONL is the carrier; fix the actual resume RPC, do not paper over it.

---

## Next — 0.5.0: backend-native compaction escape hatch

Single focus until done: **separate pi-side compaction from ACP backend-native compaction.** Gated by the resume-hydration fix above.

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
