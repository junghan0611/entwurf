# NEXT — mux B/C 절벽을 repo 밖 실측으로 판정한다

> `mux-placement` 브랜치 전용 boot sector. `e568980` = `origin/mux-placement`가 제품 base이고, 그 위 커밋은 전부 docs-only다. 폐기된 T1-b 제품 코드는 남아 있지 않다.
> 새 팀은 이전 구현 세션을 다시 부르지 말고 이 문서와 `docs/mux-launch-rail.md`만 읽는다.

# RAIL — 현재 좌표

- [x] **1. placement + visible launch leaf 착지** — T0-a/T0-b `317387d`, T1-a `c55a070`
- [x] **2. 검증 감산 + branch landing** — `a1f27b9`, `e7a4ec4`, `e568980`
- [ ] **3. repo 밖 B/C baseline 실측** ← CURRENT: repo 수정·public tool 없이 두 완료점의 차이를 손으로 확인
- [ ] **4. 제품 완료점 한 줄 확정** ← PAUSED: baseline 뒤 GLG가 B 또는 C를 명시
- [ ] **5. 선택된 완료점만 구현·검수** ← PAUSED: 4번 승인 전 구현자 호출 금지

현재 좌표: 제품 leaf는 착지됨 → B와 C 중 무엇이 제품인지 미결정 → 먼저 실측

# NOW

- **Stem:** mux가 제공할 제품 완료점을 B와 C 중 하나로 확정한다.
- **A — 이미 완료:** existing citizen 발견(`entwurf_peers`)과 전달(`entwurf_v2`).
- **B — 현재 T1-a:** 같은 tmux session 옆에 fixed plain `pi`를 열고 window/pane handle을 반환한다. garden identity와 delivery는 없다.
- **C — 별도 절벽:** 새 Pi를 exact garden identity에 결박하고 기존 `entwurf_v2` 전달까지 caller가 이어갈 수 있게 한다.
- **Next:** repo 밖 임시 runner와 raw tmux로 B와 C를 손으로 재현해, 어느 제품 약속이 실제로 필요한지 판정하고 GLG에게 보고한다. 절차는 아래 두 step이며 순서를 바꾸지 않는다.
- **Verification:** 같은 tmux session, detached window, stable handle, focus 불변을 확인한다. C 셀은 사람이 확인해준 사실과 correlation 통증만 기록하며, 시간/cwd 추측을 제품 계약으로 승격하지 않는다.
- **Blocker:** 없음. 단, 현재 T1-a plain `pi`는 citizen을 만들지 않으므로 B만으로 `entwurf_v2`까지 간다고 주장하지 않는다.

## Baseline 실행 절차 — repo 밖 2 step

**Step B — 현재 T1-a를 실제로 호출한다.**

- runner는 `/tmp/entwurf-mux-b-baseline.ts` **하나**다. Node 24 native type stripping으로 repo의
  `pi-extensions/lib/mux-placement.ts`·`mux-launch.ts`를 absolute import해 `inspectPlacement()` →
  `launchPi()`만 호출한다. 빌드·번들·설치 없이 `node /tmp/entwurf-mux-b-baseline.ts`로 돈다.
- 호출 계약: `inspectPlacement()`는 union이다. `ok:false`면 `reason`을 보고하고 **mutation 없이 종료**하며,
  `ok:true`의 `placement`만 `launchPi()`에 넘긴다. `launchPi()`가 던지는
  `LaunchPreconditionError`(runtime 미충족)와 handle 판독 실패(orphan window를 이름만 남기고 throw)도
  그대로 보고한다 — 추측으로 창을 고르거나 닫지 않는다.
- repo 파일 수정 0, public tool 0, 새 gate 0. baseline 종료 시 runner를 삭제한다.
- agent는 runner를 실행하고 handle(session·window·pane, focus 불변)을 보고한 뒤 **정지한다**.
- **GLG의 유일한 손:** 그 window로 전환해 plain Pi가 보이는지 `visible / not visible`로 확인한다.

**Step C — 별도 승인 뒤에만 연다.**

- Step B의 확인 뒤 GLG의 별도 승인이 있을 때만 진행한다. runner도 leaf도 쓰지 않는다.
- repo 밖 raw tmux로 fixed `pi --entwurf-control` 셀을 하나 연다.
- **GLG의 유일한 손:** 그 window로 전환해 아래 고정 prompt를 **한 번** 입력하고, 화면에 나온 gardenId를
  coordinator에게 전달한다.

  ```text
  entwurf_self를 호출하고 gardenId만 출력해
  ```

- 상태줄을 눈으로 읽어서 대신하지 않는다. 갓 뜬 셀의 상태줄은 `🪛 ready`이고, gardenId는 session
  파일이 생긴 뒤 — 즉 **첫 assistant turn 뒤** — 에야 표시된다. exact id를 얻는 수동 경로는 기존
  `entwurf_self` 하나다.
- **이 입력이 첫 turn을 만든다는 사실 자체가 비용이다.** 관측 기록에 그대로 적는다 — C 셀은 "열자마자
  주소를 얻는" 상태가 아니다.
- `entwurf_peers`의 최신순·cwd 추측으로 id를 대신 고르지 않는다. 그 추측이 제품 계약으로 올라가는 것이
  이 lane이 막으려는 것이다.
- caller는 그 exact id에 **기존** `entwurf_v2`를 보내고, 거기까지 가는 데 든 correlation 통증을 기록한다.
  이 셀은 실험이며 제품 구현이 아니다.

**산출물:** `.agent-reports/<KST>-mux-bc-baseline.md` (local-only, gitignored). repo docs/source/gate는
수정하지 않는다. B/C 판정 뒤에 갱신하는 것은 이 NEXT 하나뿐이다.

## B/C 판정 기준 — 측정 전에 고정한다

단계 수나 클릭 수를 사후 최적화하는 문제가 아니다. B와 C는 **제품이 하는 약속**이 다르다.

- **B로 충분하다:** 의도한 workflow가 GLG가 새 visible Pi 창으로 전환해 직접 task를 입력하는 데서
  끝난다. caller → fresh citizen의 address/delivery를 제품이 약속하지 않는다.
- **C가 필요하다:** 의도한 workflow가 caller agent가 GLG의 재입력 없이 exact fresh citizen에게 task를
  전달해야 한다. 이 경우 B는 **단계 수와 무관하게 구조적으로 불충분**하다.
- baseline은 어느 약속이 실제로 필요한지 판정하기 위한 것이다. 수동 timing/cwd correlation은 어떤
  경우에도 제품 계약으로 승격하지 않는다.

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
- RAIL 4의 GLG 완료점 승인 전 product commit·push·release 금지. NEXT-only handoff commit은 예외

# RECENT

- **2026-08-05 — T1-b 초안 전량 폐기.** 완료점 B/C를 확정하지 않은 채 C 전체를 승인해 제품 691줄 + gate 433줄이 생겼다. GLG 정지 신호 직후 commit/push 없이 삭제했고 제품 코드를 `e568980` 상태로 복원했다. 구현자 문제가 아니라 coordinator의 완료점 확대 해석이었다.
- **2026-08-05 — PM 판정.** 반복 폐기의 공통 원인은 mux 코드 난이도 자체보다 B(visible launch)와 C(identity correlation)를 한 lane으로 부른 데 있다. 다음 팀은 규칙 복종이 아니라 어느 쪽이 실제 제품인지 모른다는 사실 때문에 repo 밖 baseline부터 한다.
- **2026-08-05 — 검증 감산.** closure receipt rail(+1,364줄)을 폐기하고 pre-commit을 정적 검사로 줄였다. qualification은 gate/mutant 변경 lane·CI·release-gate가 소유하고 full floor는 frozen candidate에서 1회만 돈다.

# 읽을 곳

1. 이 문서 — RAIL/NOW/필수 한 줄/STOP LINE
2. `docs/mux-launch-rail.md` §4–§6 — situation map, B(T1-a), C(T1-b) 절벽
3. `pi-extensions/lib/mux-launch.ts` — 현재 B의 정확한 receipt와 한계
4. AGENTS.md — verification scheduling / review triage / one manual action per step
