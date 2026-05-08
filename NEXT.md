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

Single focus until done.

### Why

Claude Code의 자동 compaction은 lossy + 시점 제어 불가 + 품질 일정치 않음. pi-shell-acp는 그 자리에서 **명시적 새 세션 + 이전 세션 짧은 hint prepend** 흐름을 받쳐준다.

Ownership 분리 (참조: [llmlog/20260508T090911 — recap v2 노트](file:///home/junghan/sync/org/llmlog/20260508T090911--recap-v2-다축-맥락-복원-—-codex가-남긴-raw-evidence__agent_llmlog_memory_recap_session.org)):

- pi-shell-acp = **mechanism** (compact 막기 + prepend slot)
- agent-config = **policy** (slot에 무엇을 채울지, 다축 hydration workflow)
- 우리는 mechanism만. policy 침범 금지.

### Tasks

#### Task 1 — compact 비활성화 굳히기

- 현재: `PI_SHELL_ACP_ALLOW_COMPACTION=1` opt-in 가드 존재 (의도적 opt-in 외 compact 안 일어남이 의도된 default)
- 목표: 그 default를 README/AGENTS Hard Rule로 격상하고 코드에서 명시
- 비용: 거의 0 (문서 정리 + 1~2줄 코드)

#### Task 2 — prev-session hint slot

- `pi-context-augment.ts`에 새 세션 첫 prepend slot 1개 추가
- pi-shell-acp 자체는 비워둠 (default empty)
- 호출자(agent-config 등)가 채울 수 있게 hook/path만 노출
- 비용: 소 (1 hook point + 문서)

### Open Decisions (시작 전 결정 필요)

1. **compact guard default 상태 verify** — 코드에서 ALLOW_COMPACTION default off 맞는지 직접 확인
2. **prepend slot 인터페이스**:
   - `PI_SHELL_ACP_RECAP_HINT=<text>` (env)
   - `PI_SHELL_ACP_RECAP_HINT_FILE=~/.pi/agent/recap-hint.md` (file path)
   - 둘 다
   - → 결정 후 pi-context-augment.ts 변경

### Out of Scope (0.5.0 아님)

다음은 0.5.0에서 손대지 않는다 — agent-config / 후속 release / 영역 외.

- agent-config의 다축 hydration recap workflow 자체 (agent-config 영역)
- BASELINE에 새 layer 추가 (후속)
- entwurf cross-session structured marker (후속)
- timezone/device metadata invariant (후속)
- openclaw 백엔드 어댑터 (0.6.0 이후, 격락 명시 필요)

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
