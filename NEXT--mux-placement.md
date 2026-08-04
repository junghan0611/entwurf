# NEXT — `mux-placement` T1-a 독립 검수 보정 완료; 현재 GLG 커밋 판단

> 이 파일은 `mux-placement` 브랜치 전용 boot sector다. merge 전 삭제하고, 살아남을 사실만 durable docs/source로 승격한다.

# RAIL — 현재 좌표

- [x] **1. T0-a — raw tmux placement 실측**
- [x] **2. T0-b — placement leaf 구현·검증**
- [ ] **3. T1-a — 같은 tmux session에 visible Pi launch** ← CURRENT: 독립 검수 보정 완료, GLG 커밋 판단 대기
- [ ] **4. T1-b — 새 Pi identity 결박 후 `entwurf_v2` 자동 전달** ← PAUSED: fresh-token 계약·lookup seam 없음

현재 좌표: 3 독립 검수 보정 완료 → GLG 커밋 판단 대기 → 4 보류.

# NOW

- Branch: `mux-placement`, base `3b2bac1` (`v0.13.1`). M1 boundary와 T0-b placement leaf를 local commits로 닫았고 아직 push하지 않았다.
- T0-b는 네 안전 축(TMUX context, native selector grammar, tmux failure honesty, origin context binding)을 갖춘 optional leaf다. production consumer는 아직 없으며 `entwurf_v2` 동작은 바뀌지 않았다.
- verification: deterministic 23, real tmux 41, lint/typecheck/diff-check green, gate qualification **152/152 KILLED**, `pnpm check` exit 0, pack 313 files/invariants pass.
- 첫 `pnpm check`는 stale bridge artifact에서 정확히 red였고 `pnpm run build-bridge` 후 전체를 처음부터 다시 실행해 green을 얻었다.
- **durable docs 승격 완료(uncommitted).** `docs/mux-launch-rail.md`가 situation map / T1-a·T1-b 분리 / pi `0.83.0` identity 판정 / peer placement evidence seam / 소유권·금지선을 SSOT로 진다. `README.md`의 stale prose(“placement controller로 옮기는 게 다음 단계”)도 현재 상태로 교체했다.
- **T1-a 구현 완료(uncommitted, GLG 승인 아래).** `pi-extensions/lib/mux-launch.ts` — placement leaf 위에 얹은 별도 composition이며 leaf에 네 번째 동사를 붙이지 않았다. verification: deterministic 21, real tmux 30, qualification **157/157 KILLED**(새 claim 5개 포함), `pnpm check` exit 0, pack 316 files. **production consumer는 없다** — `entwurf_v2` 동작은 그대로다.
- **T1-b automatic delegation은 여전히 미구현·PAUSED다.** T1-a가 섰다고 delegation까지 됐다고 말하지 않는다.
- **독립 검수(새 Opus, 2026-08-04) 보정 완료(uncommitted).** GPT coordinator가 세 건을 전부 수용해 반영을 지시했다.
  - (a) `resolvePiRuntime`의 refuse-vs-skip 계약을 `MUX-LAUNCH-PATH-HIT-NOT-SKIPPED` claim으로 분리하고, `assertLaunchTarget`을 PATH loop의 catch 안으로 옮기는 실제 결함 mutant를 exact-once로 추가했다. 실행 불가 후보는 skip(shell도 건너뛴다), whitespace 경로는 refuse(shell이라면 그것을 골랐다) — 흘려보내면 operator의 `pi`와 다른 install이 뜬다.
  - (b) `MUX-LAUNCH-CORE-IMPORT-FREE` oracle을 열거된 4파일에서 **출하 source 전체 walk**(`pi-extensions/**` + `mcp/**`, `dist`/`node_modules` 제외)로 일반화했다. corpus 자체를 별도 단언으로 못박아 나중에 좁혀서 거짓 green을 만들 수 없게 했다. import 판정은 module specifier 기준이라 주석의 언급은 위반이 아니다.
  - (c) leaf header와 docs §11에 `runTmux`/`requireSameContext` export가 T1-a composition을 위한 좁은 내부 seam이며 public operator surface가 아님을 명시했다. `runTmux`가 이 모듈이 작성하지 않은 argv를 받아 GRAMMAR 경계 밖이라는 위험도 숨기지 않고 적었다.
  - 보정 후 verification: deterministic **23**, real tmux 30, placement 23/41, lint/typecheck green, qualification **158/158 KILLED**(`mux-boundary` lane 14).
- **개발 속도 blocker — 검증 범위가 inner loop와 closure를 구분하지 않는다.** 현재 `pnpm check`는 93개 명령을 직렬 실행하며 mux와 무관한 meta/agy/v2/ACP 전체를 매번 다시 돈다. T1-a에서는 구현 후 full → 문서 후 full → 독립 검수 보정 후 full로 closure floor가 반복되어 작업보다 검증이 context와 시간을 더 썼다. 아래 Verification RAIL을 다음 코드 작업 전 durable policy로 승격한다.

# VERIFICATION RAIL — 개발 중에는 영향 범위, 전체 floor는 마지막 한 번

```text
구현·수정 → affected focused gates → 독립 검수 → 보정 묶음
          → qualification 1회 → pnpm check + pack 1회 → 커밋 판단
```

- **INNER LOOP:** 바뀐 production subject와 직접 oracle만 돌린다. mux lane은 lint/typecheck + `check-mux-placement` / `check-mux-launch` + 해당 real-tmux acceptance가 기본이다.
- **SURFACE-DEPENDENT:** `run.sh`/package/install surface를 건드린 경우에만 `check-shell-quote`, `check-install-surface`, `check-package-source-routing`, `check-pack`을 affected bundle에 더한다.
- **REVIEW BEFORE FLOOR:** 독립 검수와 non-blocking 보정을 먼저 한 묶음으로 닫는다. 검수 전에는 full `pnpm check`를 돌리지 않는다.
- **QUALIFICATION:** QK/mutant가 최종 모양이 된 뒤 한 번 돌린다. assertion 하나씩 추가할 때마다 158개 전체 mutant를 반복하지 않는다.
- **FREEZE WHILE FLOOR RUNS:** qualification과 `pnpm check`가 시작되면 종료할 때까지 worktree/index/NEXT를 포함해 아무 파일도 편집·stage하지 않는다. work-surface hash가 바뀌면 소스 결함이 없어도 qualification 증거가 무효가 되어 전체 사이클을 버린다.
- **CLOSURE FLOOR:** `pnpm check`는 커밋 후보가 고정된 뒤 마지막 한 번만 돈다. NEXT/README/docs-only 후속 수정은 production/gate/package hash가 그대로면 full floor를 다시 열지 않는다.
- **PRE-COMMIT DUPLICATION — 현재 결함:** `.husky/pre-commit`이 `pnpm check`를 무조건 다시 실행한다. 따라서 이미 green인 frozen commit candidate도 commit 순간 93개 직렬 floor를 중복 실행한다. 이 hook을 그대로 둔 채 “마지막 한 번”은 성립하지 않는다. 다음 durable policy 변경은 pre-commit을 빠른 safety/증거 확인으로 제한하고, full floor는 명시적 closure 단계가 소유하도록 해야 한다. exact staged/relevant-content hash에 결박된 evidence receipt 같은 fail-closed 모양을 먼저 설계하고, 단순 skip/cache나 무근거 green은 금지한다.
- **RELEASE:** release acceptance의 full/static/LIVE floor는 그대로다. 개발 inner loop를 줄이는 것이 최종 증거를 낮추는 뜻은 아니다.
- **다음 durable 변경:** 다음 코드 lane 전에 AGENTS/VERIFY의 `focused → qualification → pnpm check` 문구를 “보정 묶음이 끝난 commit candidate에서 1회”로 교정한다. 필요하면 그 뒤에만 fail-closed `check:mux`/changed-file impact map을 설계한다. 지금 성급한 test selector를 만들어 또 메타도구를 키우지 않는다.

## T1-b 판정 — 앵커 pi `0.83.0`, 2026-08-04

| 축 | 상태 |
|---|---|
| pi-side 사전 주입 (`--session-id`) | **성립** — caller가 native identity를 미리 정할 수 있다 |
| 동기 identity 반환 | **불성립** — visible launch는 id를 동기 채널로 주지 않는다 |
| fresh-token contract | **미설계** — 두 namespace preflight + 동시 mint 경합 처리 |
| `nativeSessionId → gardenId` caller lookup seam | **미구현** — 출하된 reader는 gardenId key 또는 전체 listing뿐 |
| end-to-end T1-b correlation | **미증명 → PAUSED 유지** |

막힌 곳이 바뀌었다. 더 이상 “upstream 조건 미확인”이 아니다 — **upstream pi-side는 확인됐고, 막힌 것은 entwurf 쪽의 fresh-token 계약과 lookup seam이다.** 근거와 함정은 `docs/mux-launch-rail.md` §6이 진다. 특히 기존 holder가 있으면 upsert는 실패하지 않고 **ATTACH해서 남의 gardenId를 재사용**한다는 사실이 이 판정의 중심이다.

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
- `entwurf-v2` contract/decider/runner/production은 이 leaf를 import하지 않는다. leaf도 entwurf core를 import하지 않고, leaf가 `mux-launch`를 import하지도 않는다 — 혼자 삭제 가능해야 하기 때문이다.
- 아직 production consumer가 없다. T0-b가 안전하다는 사실과 Entwurf가 이를 제품 기능으로 소유해야 한다는 판단은 별개다.
- 한 커밋으로 삭제할 수 있어야 한다. pi/tmux/operator가 같은 배치를 제공하면 삭제가 진보다.

## T1을 둘로 나눈다 — visible launch와 automatic delegation은 같은 문제가 아니다

- **T1-a visible Pi launch: 완료.** `mux-launch.ts` — runtime precondition 증명 → leaf binding 재확인 → `new-window … -- <runtime>` 한 번 → `@window/%pane/pane_pid` 반환. garden identity나 task delivery를 기다리지 않는다. leaf에 네 번째 동사를 붙이지 않고 그 위의 별도 composition으로 두어, leaf는 여전히 혼자 삭제 가능하다.
- **T1-b automatic delegation:** 새 Pi가 낳은 exact garden id를 launch 요청과 결박 → `entwurf_v2`로 task 전달. **PAUSED** — pi-side 주입은 성립하나 fresh-token 계약과 lookup seam이 없다(위 판정표).

GLG가 수동으로 하던 세 동작은 “내 위치 확인 / 옆 window 생성 / Pi 실행”이다. T1-a는 그 손동작만 한 단계씩 옮긴다. T1-b의 어려움을 T1-a에 미리 얹지 않고, 반대로 visible launch가 됐다고 automatic delegation까지 됐다고 말하지 않는다.

# Anti-Gas-Town 헌법

1. **Substrate는 작업자를 고르지 않지만, caller agent는 GLG의 명시 요청 아래 사실을 보고 판단한다.** “대기 중인 Sonnet에게 보내라”면 peer facts에서 exact target을 찾고, 없으면 현재 tmux 옆에 새 Pi를 열자는 한 단계 판단을 할 수 있다. 자동 backlog·대체자·scheduler 정책을 core에 넣지 않는다는 뜻이지, 협업 중인 agent가 아무 판단도 하지 말라는 뜻이 아니다.
2. **Placement는 delivery core의 의존성이 아니다.** 현재 `entwurf-v2-production.ts`는 delivery hands를 조립하는 기존 composition root이므로 “core가 adapter를 전혀 import하지 않는다”는 일반론을 말하지 않는다. 좁고 강제 가능한 금지선은 아래 §소유권 표의 import 블록이며, `check-mux-launch`가 source에서 직접 검사한다. T1-a는 delivery composition이 아니라 leaf 위의 별도 composition으로 섰고, 미래 dispatch 조립도 기존 delivery composition에 슬쩍 넣지 않고 별도 소유권 판정을 받는다.
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
| tmux placement leaf (`mux-placement.ts`) | caller placement, same-session append, stable handle close | harness launch, identity, delivery |
| T1-a launch composition (`mux-launch.ts`) | 고정 runtime precondition, window+runtime 한 번의 mutation, 로컬 handle receipt | garden identity, record 조회, task delivery, 모든 carrier |
| pi/ACP harness adapter | official runtime/session lifecycle, auth, model, transcript, record birth | 프로젝트의 작업자 선택·backlog |
| **미래 dispatch composition (아직 없음)** | launch receipt와 exact identity를 결박해 `entwurf_v2`까지 잇는 조립 후보 (T1-b) | default worker, retry, 대체자 선정, queue |
| project policy (repo 밖) | 누구를·언제·무엇으로 부를지, fan-out 횟수, 실패 후 판단 | transport 내부 구현 |

미래 dispatch composition(T1-b)은 먼저 **repo 밖 GLG 소유 operator script/skill**로 시작한다. baseline 통증을 측정하기 전에는 기존 `entwurf-v2-production.ts`나 새 in-repo composition root로 들이지 않는다. T1-a가 in-repo에 선 것은 GLG의 명시 승인 아래이며, 그 자체가 T1-b를 in-repo로 들이는 근거가 아니다.

의존 방향의 현재 금지선은 다음이다.

```text
entwurf-v2 contract/decider/runner/production  -X-> mux-placement / mux-launch
mux-placement / mux-launch                     -X-> entwurf core
mux-placement                                  -X-> mux-launch        (leaf는 혼자 삭제 가능해야 한다)
mux-launch                                      -> mux-placement       (허용된 유일한 방향)
operator-owned launch baseline                  -> mux-launch + entwurf_v2
```

이 줄들은 `check-mux-launch`가 source에서 직접 검사하고 `MUX-LAUNCH-CORE-IMPORT-FREE` mutant가 지킨다.

# Receipt와 supervision의 절단선

| 사실 | 현재 상태 | 경계 |
|---|---|---|
| control-socket send / mailbox enqueue / native injection | **현재 출하된 `entwurf_v2` receipt** | 호출 시 rail이 즉시 진술 |
| mailbox `lastReadAt` | 현재 후속 evidence, **send receipt 아님** | self-fetch receiver가 나중에 읽은 사실 |
| window opened (`@window/%pane`) | T0-b leaf가 직접 호출되면 반환 가능하지만 **production consumer 없음** | Entwurf public receipt로 출하되지 않음 |
| process spawned (`pane_pid`) | **T1-a가 반환하지만 production consumer 없음** | 동기 로컬 사실이며, 그 process가 살아 있다는 주장은 아니다 |
| launch가 동기 반환한 native session/garden identity | **없음** — pi `0.83.0` 조건 1 불성립 | upstream이 제공하지 않는다 |
| 사전 주입한 native token으로 조회한 gardenId | **T1-b 후보** — pi-side 주입은 성립하나 fresh-token contract 미설계, lookup seam 미구현 | key가 입력일 때의 strict known-key lookup + bounded wait만 |
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
| 새 window에서 fixed `pi`를 실행할 수 있는가 | **T1-a 완료** — `mux-launch.ts`, deterministic 21 / real tmux 30 green |
| 새 Pi에 native identity를 미리 주입할 수 있는가 | **가능** — pi `0.83.0` `--session-id` (앵커 2026-08-04) |
| 그 native id로 gardenId를 정확히 읽을 수 있는가 | **아직 공백** — caller lookup seam 미구현 |
| 새 Pi의 identity를 exact task와 결박해 자동 전달할 수 있는가 | T1-b PAUSED — fresh-token 계약 미설계 |

현재 `entwurf-peek` skill은 sync entwurf 자식의 JSONL/activity를 heuristic으로 보는 진단 손이다. garden peer와 tmux placement를 결박하는 SSOT가 아니며, GLG가 직접 호출해야 하는 public core surface도 아니다. **caller-side situation map이 무엇을 합성하는지는 `docs/mux-launch-rail.md` §4가 확정했고**, peek을 그 지도로 확장하는 것은 금지된다.

peer placement는 garden address나 liveness가 아니다. record에 저장하지 않고, window title이나 cwd로 추측하지 않는다. launch receipt 또는 peer의 검증 가능한 self-report처럼 exact evidence가 있을 때만 optional view로 붙이며, 모르면 `unknown`이라고 말한다.

# T1-b를 여는 사실 조건 — 판정 완료, 그러나 문은 아직 안 열렸다

두 조건은 판정됐다 (`docs/mux-launch-rail.md` §6, 앵커 pi `0.83.0` / 2026-08-04).

1. **동기 반환: 불성립.** visible interactive launch는 session/garden id를 caller가 읽을 동기 채널로 반환하지 않는다.
2. **사전 주입: pi 쪽에서 성립.** `--session-id`가 caller 문자열을 그 세션의 `nativeSessionId`로 고정한다.

따라서 in-repo T1을 **닫지는 않는다.** 그러나 여는 데 필요한 계약이 둘 다 아직 없다.

- **fresh-token contract (미설계).** 충돌 지점이 둘이고 서로 다르게 조용히 실패한다 — pi project-local corpus 충돌은 남의 대화를 열고, active meta-record store(**전역**) 충돌은 upsert가 ATTACH해 남의 gardenId를 재사용한다. 최소 조건은 두 namespace preflight 부재 확인 + caller-owned fresh opaque token이며, holder가 있으면 fail/re-mint다. **ATTACH를 fresh success로 받으면 안 된다.** 그리고 **동시 mint 경합에 대한 예약 authority가 없다** — preflight와 record birth 사이 창을 닫는 설계는 존재하지 않는다.
- **caller lookup seam (미구현).** native id 해석은 `upsertMetaSession` 내부(write path)에만 있다. 만들더라도 **입력으로 이미 알려진 key에 대한 strict lookup + bounded wait**이어야 한다. 시각·cwd를 비교하는 discovery watcher가 되는 순간 in-repo T1은 닫는다.

두 계약의 설계 자체가 GLG 별도 승인 사항이다. baseline에서 통증을 측정하는 일이 watcher나 예약 authority를 repo로 들이는 근거가 되지 않는다.

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
fresh-token 계약과 lookup seam이 설계된 뒤에만 entwurf_v2 자동 전달  # T1-b (PAUSED)
```

T1-a receipt는 window/process를 열었다는 로컬 사실이다. T1-b receipt는 그 뒤의 rail receipt다. peer의 task outcome은 어느 장면에서도 Entwurf 책임이 아니다.

# Baseline — in-repo composition보다 먼저

가장 얇은 baseline은 GLG가 소유한 script/skill이다.

1. `mux-launch`의 T1-a로 필요한 만큼 window+pi를 연다 (1·2단계가 이제 한 호출이다).
2. 새 시민은 native lifecycle로 record를 낳는다.
3. caller가 정확한 identity를 **사람 손으로** 확인한 뒤 `entwurf_v2`를 반복 호출한다.

이 baseline에서 “N개의 launch와 N개의 identity를 사람이 상관짓는 일”이 실제 병목인지 먼저 측정한다. 불편이 관측되기 전에 repo 안에 watcher나 composition product를 만들지 않는다.

# EXACT NEXT — T1-a 독립 검수 보정까지 끝났다. 현재는 GLG 커밋 판단이다

T1-a 구현·검증과 새 Opus의 독립 검수 보정까지 끝났다. checkpoint closure에는 GLG의 커밋 판단만 남았다. 다음은 더 만드는 일이 아니다.

1. **GLG의 커밋 판단.** 세 문서 + T1-a source/gate/mutant 변경 전부 uncommitted다. 커밋 단위를 어떻게 자를지(문서 / T1-a 분리 여부)는 GLG가 정한다.
2. **verification boundary를 durable policy로 승격한다.** 위 Verification RAIL을 AGENTS/VERIFY에 반영해, 독립 검수·보정 전 full floor 반복을 금지하고 commit candidate에서만 `pnpm check`를 한 번 돌리게 한다. `.husky/pre-commit`의 unconditional `pnpm check` 중복도 함께 제거하되, exact staged/relevant-content hash에 결박된 fail-closed evidence 확인 없이 단순 skip하지 않는다. 먼저 운영 순서를 고치고, 별도 `check:mux`/자동 selector는 실제로 더 필요할 때만 설계한다.
3. **operator dashboard detour — `entwurf-peek`을 수선한다** (`agent-config` 소유). GLG에게 이 도구는 단순 자식 진단기가 아니라 “지금 누가 무엇을 하고 있고 얼마나 남았는가”를 직접 보는 현재 상황 판단 대시보드다. 2026-08-04 native Claude Code session을 직접 지정했는데도 `state: unknown`, 메시지 0건, mtime 기반 `done`으로 오판했다. `session-recap`은 같은 transcript에서 진행 메시지를 정상 추출했고 실제 process도 살아 있었다. **Return:** Claude Code direct-session path에서도 model/state/recent messages가 나오고, process liveness를 증명하지 못하면 mtime 추정을 사실처럼 말하지 않는 검증 fixture가 선다. 단, 이 수선은 heuristic dashboard 품질이며 garden identity나 peer placement SSOT로 승격하지 않는다.
4. **operator-owned baseline의 최소 형태를 정한다** (repo 밖, GLG 소유 script/skill). 위 §Baseline 3단계보다 크지 않게. in-repo composition root나 새 public surface로 들이지 않는다.
5. **관측할 통증을 미리 이름 붙인다.** "N개 launch와 N개 identity를 사람이 상관짓는 일"이 실제 병목인지 — 몇 개부터, 어떤 실패 모양으로 아픈지. 측정 전에 해결책을 설계하지 않는다.
6. 통증이 관측된 뒤에야 fresh-token 계약과 lookup seam 설계를 **GLG에게 별도로 올린다.** 그 설계 자체가 승인 사항이며, 지금 착수하지 않는다.

읽을 곳: `docs/mux-launch-rail.md`(SSOT — situation map §4, T1 분리 §5, identity 판정 §6, evidence seam §7, 소유권·금지선 §11). 두 정체성 자료는 그 문서에 이미 흡수됐다.

# STOP LINE

GLG 별도 승인 전에는 다음을 하지 않는다.

- T1-b identity/dispatch 구현
- fresh-token 계약 / lookup seam / 예약(reservation) authority의 **설계 착수**
- T1-a에 production consumer를 붙이는 일 — 지금 어떤 출하 경로도 `mux-launch`를 import하지 않는다
- T1-a launch shape 확장: focus/switch, window 이름, resume, 다중 동시 launch
- peer-placement 저장·추측 또는 새 public situation-map surface
- public spawn verb 또는 `entwurf_v2` 확장
- record watcher, timeout/retry, unknown-id discovery
- task queue, dependency graph, worker pool, role, quota·context 판단
- command/cwd/env/model carrier 확장
- T1 implementation commit, push, release

T0-b · T1-a · durable 문서가 닫혔다. 세 문서와 T1-a source/gate/mutant 변경은 **전부 uncommitted**이며 commit/push는 GLG 결정이다.

# RECENT

- 2026-08-04: durable docs 승격 완료 — `docs/mux-launch-rail.md` 13절 재작성, `README.md` stale prose 교체. GPT 교차검수에서 blocker 1건을 받아 §6을 수정했다: `nativeSessionId` uniqueness를 "중복이면 throw"로 과장했으나, 실제로는 holder 하나면 **ATTACH해서 남의 gardenId를 재사용**하고 throw는 두 record가 한 id를 claim할 때(certification)와 backend drift뿐이다.
- 2026-08-04: pi `0.83.0` identity 판정 — 동기 반환 불성립, 사전 주입은 pi-side 성립. 막힌 곳이 upstream에서 **entwurf 쪽 fresh-token 계약 + lookup seam**으로 이동했다.
- 2026-08-04: GLG가 목표를 “내 위치 확인 → existing peer면 전달 → 없으면 현재 tmux 옆 window에 visible Pi launch”라는 수동 판단의 재현으로 다시 고정했다. T1-a visible launch와 T1-b automatic delegation을 분리했다.
- 2026-08-04: Gas Town/Wheelhouse 경고를 읽고 T1 자동 진행을 중단했다. existing dispatch와 fresh explicit call의 identity 축을 분리했다.
- 2026-08-04: T0-b local closure — deterministic 23, real tmux 41, qualification 152/152 KILLED, `pnpm check`/pack green. stale bridge artifact red는 rebuild 후 full rerun으로 닫았다.
- 2026-08-04: M1 boundary commit `609fbd3`. mux launch handle은 v2 delivery transport가 아니다.
- 2026-08-04: T0-a raw placement accepted. rc=0 함정과 index renumber 사실을 durable docs로 승격했다.
- 2026-08-02: placement 없이 별도 tmux session을 만들던 generic driver를 폐기했다.
