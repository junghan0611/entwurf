# NEXT.md — pi-shell-acp

> 시작할 때 무엇을 할지 몰라서 발생하는 진행 정체를 막는다.
> 일정은 의미 없다. 적은 만큼 할 수 있는 만큼만 — 진행은 진행된다.
> 핵심을 놓치지 않는 것이 본질.

다축 맥락 복원(recap)이 "직전에 뭐했지"를 풀어준다.
이 문서는 그 옆에서 "다음에 뭐하지"를 고정한다.
두 축이 같이 있을 때 세션 시작이 자연스럽다.

급한 일이 들어와도 이 자리는 비워두지 않는다.
치고 들어온 일이 끝나면 이 문서를 읽고 본궤도로 돌아온다.

---

## Current Priority — 0.5.0: compact-replacing recap mechanism

Single focus until done: **replace silent compaction with an explicit new-session + caller-supplied hint slot mechanism.**

This is a turning-point release, so the wording matters: do not let shallow summaries turn it into “a recap engine”, “a second harness”, or “same tools everywhere”.

### Why

Claude Code의 자동 compaction은 lossy + 시점 제어 불가 + 품질 일정치 않음. pi-shell-acp는 그 자리를 더 영리한 요약기로 채우지 않는다. 이 repo가 맡을 일은 더 작다.

1. silent compaction을 기본으로 막는다.
2. 새 세션 첫 prepend에 짧은 recap hint가 들어갈 **빈 slot**을 제공한다.
3. slot의 내용은 호출자가 만든다.

Ownership 분리 (참조: [llmlog/20260508T090911 — recap v2 노트](file:///home/junghan/sync/org/llmlog/20260508T090911--recap-v2-다축-맥락-복원-—-codex가-남긴-raw-evidence__agent_llmlog_memory_recap_session.org)):

- pi-shell-acp = **mechanism** (compact 막기 + prepend slot)
- agent-config = **policy** (slot에 무엇을 채울지, 다축 hydration workflow)
- 우리는 mechanism만. policy 침범 금지.

### Tasks

#### Task 1 — compact 비활성화 contract로 굳히기

- verified: `PI_SHELL_ACP_ALLOW_COMPACTION=1` opt-in 가드 존재. env가 없으면 `session_before_compact`에서 cancel한다.
- 목표: README/AGENTS Hard Rule에 **default non-compaction**을 명시하고, 코드 주석/검증이 그 문장과 맞는지 정렬한다.
- 비용: 거의 0 (문서 정리 + 필요 시 1~2줄 코드/검증 보강)

#### Task 2 — prev-session hint slot

- `pi-context-augment.ts`에 새 세션 첫 prepend slot 1개 추가
- pi-shell-acp 자체는 비워둠 (default empty)
- 호출자(agent-config 등)가 채울 수 있게 hook/path만 노출
- 비용: 소 (1 hook point + 문서 + 최소 검증)

### Open Decisions (시작 전 결정 필요)

1. **prepend slot 인터페이스**:
   - `PI_SHELL_ACP_RECAP_HINT=<text>` (env)
   - `PI_SHELL_ACP_RECAP_HINT_FILE=~/.pi/agent/recap-hint.md` (file path)
   - 둘 다
   - → 결정 후 pi-context-augment.ts 변경

### Out of Scope (0.5.0 아님)

다음은 0.5.0에서 손대지 않는다 — agent-config / 후속 release / 영역 외.
If a task sounds useful but needs policy, hidden transcript hydration, backend cleanup, or a new provider, it is not this release.

- recap 내용 생성 정책: session-recap, semantic-memory, day-query, llmlog/§ marker 해석
- `docs/recap.md` 같은 recap policy 문서 추가
- provider handoff UX 전체 설계
- Gemini backend residue cleanup
- BASELINE에 새 layer 추가
- entwurf cross-session structured marker
- timezone/device metadata invariant
- openclaw 백엔드 어댑터 / native provider

---

## How to use this file

| 시점 | 행동 |
|---|---|
| 새 세션 시작 | recap 후 이 문서 읽기. 다른 일이 우선순위 같으면 그 일부터, 아니면 NEXT.md 따라 진행 |
| Open Decision 결정됨 | Tasks 본문으로 흡수, Open Decision 항목 제거 |
| Task 완료 | 한 줄 strikeout 또는 항목 자체 삭제. 다음 Task로 |
| Current Priority 완료 | 다음 우선순위로 통째로 갱신 |
| 우선순위 자체가 바뀜 | 드물다. 흔들리면 이 문서 의미 사라진다. 의식적으로만 |

이 문서는 commit하고 push한다. 누가 보더라도 "지금 이 repo가 다음에 갈 자리"가 같은 한 곳에 박혀 있다.
