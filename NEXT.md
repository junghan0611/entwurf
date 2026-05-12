# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 완료된 릴리즈/조사 기록은 `CHANGELOG.md`, GitHub issue, commit history로 보낸다.

---

## Current Priority — 0.5.0 backend-native compaction guard split

Goal: `PI_SHELL_ACP_ALLOW_COMPACTION=1`의 과도한 의미를 둘로 분리한다.

| Knob | Meaning | Default |
|---|---|---|
| `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1` | pi JSONL compaction 허용 | blocked |
| `PI_SHELL_ACP_ALLOW_BACKEND_COMPACTION=1` | Claude/Codex backend-native compaction guard 제거 | opt-in |

Principle:

- pi-side compaction은 ACP backend transcript에 summary가 전달되지 않으므로 기본 차단 유지.
- OpenClaw long-chat 생존은 backend-native compaction 경로에 의존.
- 0.5.0은 **guard split only**. recap engine, compact→new-session handoff, hidden transcript hydration, provider handoff UX, Gemini residue cleanup, OpenClaw 튜닝 전부 금지.

### Next Steps

#### 1. Source audit before edit

- `index.ts`
  - `session_before_compact` currently checks `PI_SHELL_ACP_ALLOW_COMPACTION`.
  - Replace policy with `PI_SHELL_ACP_ALLOW_PI_COMPACTION`.
  - Error/cancel message should explain pi-side vs backend-native split.
- `acp-bridge.ts`
  - Claude guard: `DISABLE_AUTO_COMPACT` / `DISABLE_COMPACT` handling.
  - Codex guard: `model_auto_compact_token_limit=9223372036854775807` handling.
  - Replace backend guard policy with `PI_SHELL_ACP_ALLOW_BACKEND_COMPACTION`.
  - Never weaken identity-isolation / overlay containment env.
- `run.sh`
  - Extend `check-backends` assertions for split knobs.

#### 2. Implement guard split surgically

- Add small helper names if useful, but avoid broad config refactor.
- Keep legacy `PI_SHELL_ACP_ALLOW_COMPACTION` only if needed as a temporary compatibility alias; do not document it as preferred OpenClaw path.
- Diagnostics must make fallback/blocked states explicit. No silent warning-only behavior.

#### 3. Developer smoke hook for backend compact

Need a developer-only way to send literal backend `/compact` through the ACP session without invoking pi host `/compact`.

Preferred shape:

```text
/acp-compact
→ send literal "/compact" to current ACP backend as a normal backend prompt/command
→ display backend result and usage updates normally
```

Rules:

- Not an OpenClaw user workflow.
- Must require/mention `PI_SHELL_ACP_ALLOW_BACKEND_COMPACTION=1`.
- If provider slash-command registration is awkward, use a minimal debug command/CLI and document exact usage.

Questions this smoke should answer:

- After backend compact succeeds in place, does the same `acpSessionId` accept the next prompt?
- If backend rotates/respawns internally, does bridge recovery remain explicit (`resume > load > new` diagnostics)?
- If compact breaks the ACP child, does only the bridge child close while pi session survives?

#### 4. Verification

Minimum before commit:

```bash
pnpm typecheck
./run.sh check-backends
./run.sh check-models
```

Runtime smoke before calling 0.5.0 ready:

- Launch with `PI_SHELL_ACP_ALLOW_BACKEND_COMPACTION=1`.
- Confirm backend guard is absent while pi-side compaction remains blocked.
- Send backend `/compact` through the developer hook.
- Confirm message result + `usage_update` behavior for Claude and Codex.
- Record whether context usage drops and whether next turn reuses/resumes/loads/creates the ACP session.

#### 5. Docs / release prep

Update only after behavior is verified:

- `README.md`: compaction policy and env split.
- `AGENTS.md`: compaction responsibility split; no recap/new-session claims.
- `VERIFY.md`: split guard evidence target + usage-update observation.
- `CHANGELOG.md`: 0.5.0 = compaction guard split / OpenClaw preparation.

### Explicit non-goals for 0.5.0

- compact→new-session handoff
- `ctx.newSession()` / `switchSession()` from `session_before_compact`
- hidden session manager inside pi-shell-acp
- reading backend transcript files
- manual ACP hydration from pi JSONL
- semantic-memory/day-query/llmlog recap policy
- OpenClaw changes
- public `PI_SHELL_ACP_RECAP_HINT(_FILE)` interface
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
