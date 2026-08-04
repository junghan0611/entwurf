# NEXT — `mux-placement` T0-b local closure; 다음 홉은 caller-side situation map 문서다

> 이 파일은 `mux-placement` 브랜치 전용 boot sector다. merge 전 삭제하고, 살아남을 사실만 durable docs/source로 승격한다.

# NOW

- Branch: `mux-placement`, base `3b2bac1` (`v0.13.1`). M1 boundary와 T0-b placement leaf를 local commits로 닫았고 아직 push하지 않았다.
- T0-b는 네 안전 축(TMUX context, native selector grammar, tmux failure honesty, origin context binding)을 갖춘 optional leaf다. production consumer는 아직 없으며 `entwurf_v2` 동작은 바뀌지 않았다.
- verification: deterministic 23, real tmux 41, lint/typecheck/diff-check green, gate qualification **152/152 KILLED**, `pnpm check` exit 0, pack 313 files/invariants pass.
- 첫 `pnpm check`는 stale bridge artifact에서 정확히 red였고 `pnpm run build-bridge` 후 전체를 처음부터 다시 실행해 green을 얻었다.
- **T1-a visible Pi launch와 T1-b automatic delegation은 둘 다 미구현이다.** 다음 홉은 코딩이 아니라 상황 지도와 소유권을 durable doc에 고정하는 일이다.

# 왜 멈췄는가 — 기존 시민 전달과 fresh call은 다른 문제다

2026-08-04의 GPT↔Opus 협업은 mux 없이 성공했다. 그러나 Opus 세션은 GLG가 미리 열어둔 existing citizen이었다. 이것이 증명한 것은 `entwurf_v2` existing-citizen dispatch이지, 원하는 실무자가 아직 없을 때 5~10개의 새 sibling을 명시적으로 여는 능력이 아니다.

차이는 하나다.

```text
existing dispatch: garden identity가 입력이다
fresh explicit call: garden identity가 출력이다
```

fresh call은 process를 여는 것보다 **그 process가 낳은 정확한 record/garden id를 caller의 요청과 상관짓는 일**이 어렵다. 시각·cwd·새 파일 목록으로 “방금 뜬 것이 아마 이것”이라고 추측하면 watcher·timeout·retry·경합 처리가 따라오고, 그 순간 Entwurf는 교환기에서 supervisor로 자란다.

# 현재 판정

## T0-b — 유지하되 core capability가 아니라 optional leaf로 강등

`pi-extensions/lib/mux-placement.ts`의 세 동사는 장소만 다룬다.

```text
inspectPlacement()      inherited TMUX/TMUX_PANE의 server/session/window/pane 사실
appendWindow()          같은 session 끝에 detached default-shell window 하나
closeWindow()           origin context에 결박된 @window의 정직한 close receipt
```

- garden id, model, auth, transcript, task, delivery를 모른다.
- `entwurf-v2` contract/decider/runner/production은 이 leaf를 import하지 않는다. leaf도 entwurf core를 import하지 않는다.
- 아직 production consumer가 없다. T0-b가 안전하다는 사실과 Entwurf가 이를 제품 기능으로 소유해야 한다는 판단은 별개다.
- 한 커밋으로 삭제할 수 있어야 한다. pi/tmux/operator가 같은 배치를 제공하면 삭제가 진보다.

## T1을 둘로 나눈다 — visible launch와 automatic delegation은 같은 문제가 아니다

- **T1-a visible Pi launch:** 현재 tmux placement 확인 → 같은 session에 window append → 고정된 official `pi` 실행 → `@window/%pane/pid` 반환. garden identity나 task delivery를 기다리지 않는다. 환경적으로 가능하지만 아직 배선하지 않았다.
- **T1-b automatic delegation:** 새 Pi가 낳은 exact garden id를 launch 요청과 결박 → `entwurf_v2`로 task 전달. identity correlation 조건이 확인되기 전에는 PAUSED다.

GLG가 수동으로 하던 세 동작은 “내 위치 확인 / 옆 window 생성 / Pi 실행”이다. T1-a는 그 손동작만 한 단계씩 옮긴다. T1-b의 어려움을 T1-a에 미리 얹지 않고, 반대로 visible launch가 됐다고 automatic delegation까지 됐다고 말하지 않는다.

# Anti-Gas-Town 헌법

1. **Substrate는 작업자를 고르지 않지만, caller agent는 GLG의 명시 요청 아래 사실을 보고 판단한다.** “대기 중인 Sonnet에게 보내라”면 peer facts에서 exact target을 찾고, 없으면 현재 tmux 옆에 새 Pi를 열자는 한 단계 판단을 할 수 있다. 자동 backlog·대체자·scheduler 정책을 core에 넣지 않는다는 뜻이지, 협업 중인 agent가 아무 판단도 하지 말라는 뜻이 아니다.
2. **Placement는 delivery core의 의존성이 아니다.** 현재 `entwurf-v2-production.ts`는 delivery hands를 조립하는 기존 composition root이므로 “core가 adapter를 전혀 import하지 않는다”는 일반론을 말하지 않는다. 좁고 강제 가능한 금지선은 `entwurf-v2 contract/decider/runner/production → mux-placement` import 0과 `mux-placement → entwurf core` import 0이다. 미래 launch 조립은 기존 delivery composition에 슬쩍 넣지 않고 별도 소유권 판정을 받는다.
3. **모델의 현재 버릇을 보정하는 구조를 만들지 않는다.** stall 감시, quota 인식, 자동 재시도·재배정, “누가 잘하는가” 기록은 다음 모델/과금에서 함께 불탄다.
4. **실제 통증이 선행하지 않은 기능은 거절한다.** 미래의 조직을 위해 backlog, dependency graph, worker manager, 역할 체계를 미리 만들지 않는다.
5. **모든 adapter는 삭제 조건을 가진다.** pi/ACP/operator가 그 기능을 제공하면 adapter를 지운다. 삭제 조건을 말할 수 없는 기능은 core 밖이다.
6. **Receipt에서 책임을 멈춘다.** task outcome, 품질, 완료 시각, peer의 맥락·건강 상태는 Entwurf의 사실이 아니다.
7. **메타도구 자체를 고치는 일이 실제 위임보다 커지면 정지한다.** “두 가지만 더”를 반복해 공장이 자기 증축을 목적으로 삼지 못하게 한다.

# 소유권 표

| 층 | 소유하는 것 | 소유하지 않는 것 |
|---|---|---|
| `entwurf` contract/decider/runner | garden id 주소 해석, envelope, rail 선택, delivery receipt/reject | creation, model 선택, task 분해, supervision |
| 기존 delivery composition (`entwurf-v2-production.ts`) | contract와 이미 출하된 socket/mailbox/native-push/spawn-bg hands의 조립 | fresh launch, tmux placement, 프로젝트 정책 |
| tmux placement leaf | caller placement, same-session append, stable handle close | harness launch, identity, delivery |
| pi/ACP harness adapter | official runtime/session lifecycle, auth, model, transcript, record birth | 프로젝트의 작업자 선택·backlog |
| **미래 launch composition (아직 없음)** | caller가 완전히 명시한 placement + launch + dispatch의 기계적 조립 후보 | default worker, retry, 대체자 선정, queue |
| project policy (repo 밖) | 누구를·언제·무엇으로 부를지, fan-out 횟수, 실패 후 판단 | transport 내부 구현 |

미래 launch composition은 먼저 **repo 밖 GLG 소유 operator script/skill**로 시작한다. baseline 통증을 측정하기 전에는 기존 `entwurf-v2-production.ts`나 새 in-repo composition root로 들이지 않는다.

의존 방향의 현재 금지선은 다음이다.

```text
entwurf-v2 contract/decider/runner/production  -X-> mux-placement
mux-placement                                  -X-> entwurf core
operator-owned launch baseline                  -> mux-placement + official pi + entwurf_v2
```

# Receipt와 supervision의 절단선

| 사실 | 현재 상태 | 경계 |
|---|---|---|
| control-socket send / mailbox enqueue / native injection | **현재 출하된 `entwurf_v2` receipt** | 호출 시 rail이 즉시 진술 |
| mailbox `lastReadAt` | 현재 후속 evidence, **send receipt 아님** | self-fetch receiver가 나중에 읽은 사실 |
| window opened (`@window/%pane`) | T0-b leaf가 직접 호출되면 반환 가능하지만 **production consumer 없음** | Entwurf public receipt로 출하되지 않음 |
| process spawned (`pid`) | **T1 조건부·현재 미구현** | 동기 로컬 사실일 때만 receipt 후보 |
| launch가 동기 반환한 native session/garden identity | **T1 조건부·현재 미확인** | upstream이 실제 제공할 때만 receipt 후보 |
| unknown record가 나타날 때까지 감시·추측 | 금지된 supervision | 시간에 걸친 발견·상관짓기 |
| peer stall/context/task outcome, retry·재배정 | Entwurf 밖 supervision | 프로젝트 정책 |


`spawn-bg resume`의 bounded liveness wait는 identity가 입력으로 이미 알려진 예외다. 이것을 unknown fresh identity 탐색의 선례로 사용하지 않는다.

# 원하는 상황 판단 루프 — 전체 에이전트 지도를 보는 쪽은 caller다

GLG가 원하는 것은 거대 orchestrator가 아니라 다음 수동 판단의 재현이다.

```text
“Sonnet이 대기 중이면 거기로 메시지를 보내줘”
  → caller agent가 garden peer facts를 본다
  → exact Sonnet citizen이 하나면 garden id로 entwurf_v2 전달
  → tmux placement가 증명돼 있으면 “aaa session / window 3”도 함께 보고
  → 없으면 caller 자신의 placement를 확인
  → 현재 repo/session 옆에 window를 append하고 Pi를 visible launch할지 판단
  → 여러 후보가 모호하면 자동 선택하지 않고 GLG에게 묻는다
```

현재 능력과 빈칸:

| 질문 | 현재 상태 |
|---|---|
| 내가 어느 tmux server/session/window/pane에 있는가 | T0-b `inspectPlacement` focused green |
| 같은 tmux session에 새 window를 append할 수 있는가 | T0-b `appendWindow` focused green |
| existing garden citizen/model/cwd/liveness를 찾을 수 있는가 | `entwurf_peers` shipped |
| existing citizen에게 메시지를 보낼 수 있는가 | `entwurf_v2` shipped |
| peer가 어느 tmux session/window에 보이는가 | **아직 공백** — record/address/liveness와 분리된 ephemeral view가 필요 |
| 새 window에서 fixed `pi`를 실행할 수 있는가 | 환경적으로 가능, T1-a 미구현 |
| 새 Pi의 identity를 exact task와 결박해 자동 전달할 수 있는가 | T1-b PAUSED |

현재 `entwurf-peek` skill은 sync entwurf 자식의 JSONL/activity를 heuristic으로 보는 진단 손이다. garden peer와 tmux placement를 결박하는 SSOT가 아니며, GLG가 직접 호출해야 하는 public core surface도 아니다. 다음 문서 라운드는 이를 억지로 확장하기 전에 **caller-side situation map**이 무엇을 합성하는지 먼저 정한다.

peer placement는 garden address나 liveness가 아니다. record에 저장하지 않고, window title이나 cwd로 추측하지 않는다. launch receipt 또는 peer의 검증 가능한 self-report처럼 exact evidence가 있을 때만 optional view로 붙이며, 모르면 `unknown`이라고 말한다.

# T1-b를 여는 사실 조건 — identity를 만들거나 추측하지 않아도 되는가

둘 중 하나가 실제 pi lifecycle에서 증명돼야 한다.

1. **동기 반환:** official launch가 native session id 또는 garden id를 동기 반환하고, 그 값이 정확히 한 record/garden id로 결정적으로 이어진다.
2. **사전 주입:** caller가 native identity를 미리 정해 launch에 주입할 수 있고, pi의 native lifecycle이 그 identity로 정확히 한 record를 낳는다.

이 사실은 **현재 certified pi `0.83.0`, 확인일 2026-08-04**를 앵커로 source와 공식 문서에서 판정한다. 둘 다 아니면 N개의 동시 launch를 정확한 N개의 garden id와 결박하려면 discovery watcher가 필요하다. 그 경우 in-repo T1은 **닫는다**. operator-owned baseline에서 통증을 측정하더라도 watcher를 repo로 들이는 근거가 되지 않으며, 재개 조건은 미래 pi가 동기 identity 반환 또는 사전 identity 주입을 제공해 같은 버전-앵커 검증을 통과하는 경우뿐이다.

# 코딩 전 고백할 두 장면

## 장면 A — existing Sonnet이 있다

```text
GLG: “대기 중인 Sonnet에게 보내줘”
caller agent: entwurf_peers에서 cwd/model/liveness와 exact garden id 확인
  ├─ 후보 하나: “이 repo의 Sonnet <garden-id>에 보냅니다” → entwurf_v2
  ├─ 후보 여러 개: GLG에게 어느 시민인지 질문
  └─ placement evidence가 있으면 tmux session/window를 보조 view로 보고
```

## 장면 B — existing Sonnet이 없어 옆에 Pi를 연다

```text
GLG/caller (tmux 안, 현재 repo)
  ├─ inspectPlacement
  ├─ 같은 tmux session 끝에 window append
  └─ fixed official pi visible launch                     # T1-a 책임 끝
       ↓
Pi native lifecycle이 auth/session/transcript/record를 소유
       ↓
identity가 exact하게 결박되는 upstream 조건이 있을 때만 entwurf_v2 자동 전달  # T1-b
```

T1-a receipt는 window/process를 열었다는 로컬 사실이다. T1-b receipt는 그 뒤의 rail receipt다. peer의 task outcome은 어느 장면에서도 Entwurf 책임이 아니다.

# Baseline — in-repo composition보다 먼저

가장 얇은 baseline은 GLG가 소유한 script/skill이다.

1. placement leaf로 필요한 window를 append한다.
2. 각 window에서 official pi CLI를 실행한다.
3. 새 시민은 native lifecycle로 record를 낳는다.
4. caller가 정확한 identity를 얻은 뒤 `entwurf_v2`를 반복 호출한다.

이 baseline에서 “N개의 launch와 N개의 identity를 사람이 상관짓는 일”이 실제 병목인지 먼저 측정한다. 불편이 관측되기 전에 repo 안에 watcher나 composition product를 만들지 않는다.

# EXACT NEXT — 다음 홉은 상황 지도와 세 수동 동작을 문서로 고정한다

1. 두 정체성 문서를 다시 기준으로 둔다.
   - `/home/junghan/sync/org/notes/20240601T210854--힣-entwurf는-모두를-지원하지-않는다-—-pi-코어·acp-레일·부름의-mux__agent_autholog_entwurf_harness_orchestration.org`
   - `/home/junghan/Downloads/ChatGPT - entwurf-mux-조심할것.md`
2. `docs/mux-launch-rail.md`에 **caller-side situation map**을 먼저 쓴다: current placement + garden peer facts + optional proven peer placement. `entwurf-peek`은 heuristic diagnostic이지 이 지도의 SSOT가 아님을 명시한다.
3. 같은 문서에서 T1을 분리한다.
   - T1-a: current placement → same-session window → fixed visible `pi`; identity/delivery 없음.
   - T1-b: exact identity correlation → automatic `entwurf_v2`; upstream 사실 확인 전 PAUSED.
4. 현재 certified pi **`0.83.0`** 공식 문서와 source를 완전히 읽고, T1-b의 동기 identity 반환/사전 주입 조건을 2026-08-04 앵커로 확정한다. 추측이나 record-store 시간 비교는 답이 아니다.
5. peer placement의 exact evidence seam을 설계하되 record 저장·window title/cwd 추측을 금지한다. 모르는 placement는 `unknown`이다.
6. T0-b는 local commit으로 닫혔다. durable 문서 검수 뒤 별도 GLG 승인에서만 T1-a를 연다.

# STOP LINE

설계 판정 전에는 다음을 하지 않는다.

- T1-a fixed Pi launch와 T1-b identity/dispatch 구현
- peer-placement 저장·추측 또는 새 public situation-map surface
- public spawn verb 또는 `entwurf_v2` 확장
- record watcher, timeout/retry, unknown-id discovery
- task queue, dependency graph, worker pool, role, quota·context 판단
- command/cwd/env/model carrier 확장
- T1 implementation commit, push, release

T0-b는 검증·local commit으로 닫혔다. 다음 수정은 durable 문서뿐이다.

# RECENT

- 2026-08-04: GLG가 목표를 “내 위치 확인 → existing peer면 전달 → 없으면 현재 tmux 옆 window에 visible Pi launch”라는 수동 판단의 재현으로 다시 고정했다. T1-a visible launch와 T1-b automatic delegation을 분리했다.
- 2026-08-04: Gas Town/Wheelhouse 경고를 읽고 T1 자동 진행을 중단했다. existing dispatch와 fresh explicit call의 identity 축을 분리했다.
- 2026-08-04: T0-b local closure — deterministic 23, real tmux 41, qualification 152/152 KILLED, `pnpm check`/pack green. stale bridge artifact red는 rebuild 후 full rerun으로 닫았다.
- 2026-08-04: M1 boundary commit `609fbd3`. mux launch handle은 v2 delivery transport가 아니다.
- 2026-08-04: T0-a raw placement accepted. rc=0 함정과 index renumber 사실을 durable docs로 승격했다.
- 2026-08-02: placement 없이 별도 tmux session을 만들던 generic driver를 폐기했다.
