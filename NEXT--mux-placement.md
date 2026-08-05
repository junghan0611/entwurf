# NEXT — mux B/C 절벽을 repo 밖 실측으로 판정한다

> `mux-placement` 브랜치 전용 boot sector. 이 handoff 직전 기준은 `e568980` = `origin/mux-placement`; 폐기된 T1-b 제품 코드는 남아 있지 않다.
> 새 팀은 이전 구현 세션을 다시 부르지 말고 이 문서와 `docs/mux-launch-rail.md`만 읽는다.

# RAIL — 현재 좌표

- [x] **1. placement + visible launch leaf 착지** — T0-a/T0-b `317387d`, T1-a `c55a070`
- [x] **2. 검증 감산 + branch landing** — `a1f27b9`, `e7a4ec4`, `e568980`
- [ ] **3. repo 밖 B/C baseline 실측** ← CURRENT: 코드·tool 없이 두 완료점의 차이를 손으로 확인
- [ ] **4. 제품 완료점 한 줄 확정** ← PAUSED: baseline 뒤 GLG가 B 또는 C를 명시
- [ ] **5. 선택된 완료점만 구현·검수** ← PAUSED: 4번 승인 전 구현자 호출 금지

현재 좌표: 제품 leaf는 착지됨 → B와 C 중 무엇이 제품인지 미결정 → 먼저 실측

# NOW

- **Stem:** mux가 제공할 제품 완료점을 B와 C 중 하나로 확정한다.
- **A — 이미 완료:** existing citizen 발견(`entwurf_peers`)과 전달(`entwurf_v2`).
- **B — 현재 T1-a:** 같은 tmux session 옆에 fixed plain `pi`를 열고 window/pane handle을 반환한다. garden identity와 delivery는 없다.
- **C — 별도 절벽:** 새 Pi를 exact garden identity에 결박하고 기존 `entwurf_v2` 전달까지 caller가 이어갈 수 있게 한다.
- **Next:** repo 파일을 수정하지 않는 임시 runner/raw tmux로 (1) B를 실제 호출하고, (2) 별도 수동 `pi --entwurf-control` 셀에서 identity 확인·delivery 연결의 통증을 관측한 뒤, 무엇이 제품 완료점인지 GLG에게 보고한다.
- **Verification:** 같은 tmux session, detached window, stable handle, focus 불변을 확인한다. C 셀은 사람이 창과 citizen을 확인한 사실과 correlation 단계 수만 기록하며 시간/cwd 추측을 제품 계약으로 승격하지 않는다.
- **Blocker:** 없음. 단, 현재 T1-a plain `pi`는 citizen을 만들지 않으므로 B만으로 `entwurf_v2`까지 간다고 주장하지 않는다.

## 구현자 호출 전 필수 한 줄

Coordinator는 구현 세션을 열기 전에 아래 문장을 채워 GLG의 확인을 받는다.

```text
이번 lane의 완료점은 [B: visible Pi + handle / C: exact gardenId correlation]이며,
포함하지 않는 것은 [identity / delivery / scheduler·queue·replacement]다.
```

이 문장이 비어 있으면 설계·구현·gate 작업을 시작하지 않는다. “mux 빈 곳을 채운다”는 완료점 문장이 아니다.

# STOP LINE

4번 완료점 승인 전에는 entwurf repo 소스를 수정하지 않는다.

- T1-a production consumer, public launch/spawn tool, generic driver/profile
- T1-b token mint, corpus/store preflight, identity lookup/wait, dispatch composition
- `entwurf_v2` 확장, peer-placement 저장·추측, situation-map surface
- watcher, retry, queue, worker pool, role/quota/default replacement
- 새 gate/mutant/receipt/cache/selector 또는 검증 구조 변경
- `agent-config`의 `entwurf-peek` 수선 — GLG 개인용 optional UX이며 이 제품 판정의 선행조건이 아니다
- 이 NEXT handoff를 닫는 docs commit 이후의 product commit, push, release

# RECENT

- **2026-08-05 — T1-b 초안 전량 폐기.** 완료점 B/C를 확정하지 않은 채 C 전체를 승인해 제품 691줄 + gate 433줄이 생겼다. GLG 정지 신호 직후 commit/push 없이 삭제했고 제품 코드를 `e568980` 상태로 복원했다. 구현자 문제가 아니라 coordinator의 완료점 확대 해석이었다.
- **2026-08-05 — PM 판정.** 반복 폐기의 공통 원인은 mux 코드 난이도 자체보다 B(visible launch)와 C(identity correlation)를 한 lane으로 부른 데 있다. 다음 팀은 규칙 복종이 아니라 어느 쪽이 실제 제품인지 모른다는 사실 때문에 repo 밖 baseline부터 한다.
- **2026-08-05 — 검증 감산.** closure receipt rail(+1,364줄)을 폐기하고 pre-commit을 정적 검사로 줄였다. qualification은 gate/mutant 변경 lane·CI·release-gate가 소유하고 full floor는 frozen candidate에서 1회만 돈다.

# 읽을 곳

1. 이 문서 — RAIL/NOW/필수 한 줄/STOP LINE
2. `docs/mux-launch-rail.md` §4–§6 — situation map, B(T1-a), C(T1-b) 절벽
3. `pi-extensions/lib/mux-launch.ts` — 현재 B의 정확한 receipt와 한계
4. AGENTS.md — verification scheduling / review triage / one manual action per step
