# NEXT — #114 garden frontend branch lane

> 이 브랜치는 main에 올리지 않고 보존한다. #114의 구현·검증·GLG hands-on과
> #116에서 드러난 방향 전환을 여기서 다시 찾는다. live contract는 #114/#116 thread다.

# RAIL — 현재 좌표

- [x] **1. #114 read-only garden projection 구현** — tmux placement와 retained garden facts를 별도 vertical panel/JSON authority로 출하 가능한 상태까지 만들었다.
- [x] **2. #115 named reject reason detour** — 제품 수정은 별도 원본 commit `d49e6cb`; 이 브랜치에는 같은 patch의 cherry-pick `1f456df`가 섞여 있다.
- [x] **3. #114 proof amendment + GLG 첫 frame** — `ec49ada`, 486/486 qualification, GLG가 1,117-record 실제 frame을 읽었다.
- [ ] **4. #116에서 workbench/driver 경계 재판정** ← CURRENT: #114를 main에 넣지 않고 main에서 논의한다.
- [ ] **5. #114 재개·폐기·축소 결정** ← PAUSED: GLG가 #116 검토 뒤 명시적으로 이 lane으로 돌아올 때까지.

현재 좌표: #114는 기능·증거를 잃지 않은 채 branch에 주차 → main에는 #115만 착지 → #116에서 Herdr 작업대와 Entwurf 드라이버의 경계를 먼저 결정.

# NOW — PARKED, DO NOT IMPLEMENT

- **Current:** `feat/114-garden-frontend`는 #114 제품·proof와 #116 착상 기록을 보존한다. 이 브랜치 자체를 main에 merge하지 않는다.
- **Next:** main에서 #116을 다시 읽고, integration·install ownership·placement backend를 서로 다른 질문으로 판정한다.
- **Resume condition:** GLG가 #116 뒤 #114의 재개·축소·폐기를 명시한다.
- **Blocker:** 기술 blocker 없음. 제품 방향 결정 대기다.
- **Do not touch:** viewer를 위해 record/identity/liveness/delivery/mux 계약을 넓히기 · Herdr pane/status를 주소나 delivery receipt로 승격하기 · #114 branch 전체를 main에 merge하기 · push/tag/release를 다음 세션이 추론하기.

# BRANCH TOPOLOGY — MAIN과 섞지 말 것

기준은 `v0.21.0` / `031574a`다. handoff 직전 branch history:

```text
351c23f feat(garden): add read-only operator frontend
1f456df fix(delivery): preserve in-band reject reasons
ec49ada test(garden): enforce row-local fact proofs
ef31b8d docs(next): open the #116 plugin decision beside the #114 lane
```

- main에 넣을 #115 정본은 별도 branch `fix/115-reject-reason`의 **`d49e6cb`**다.
- `1f456df`는 같은 patch를 #114 branch 위에 cherry-pick한 commit이다.
- 따라서 미래 #114 landing 때 이 branch를 통째로 merge하지 않는다. 그때의 main(`#115` 포함)에서 새 lane을 만들고 #114-only commits/changes를 replay하거나, 중복 patch topology를 명시적으로 정리한 뒤 검증한다.
- 이 문서는 branch lane 전용이다. 실제 merge 전에는 durable facts를 issue/docs로 승격하고 이 파일을 삭제한다.

# #114 보존 좌표

## 제품 모양

- `entwurf garden`: TTY 기본 watch, pipe 기본 one-frame, `--once`, `--watch`, `--json`, `--interval-ms`.
- 위 panel: `placement.scope=whole-current-server-inventory`.
- 아래 panel: `garden.scope=retained-record-store`, owner `listEntwurfFacts` projection.
- `join.state=not-performed`, `attention.state=not-observed`.
- viewer는 send/launch/resume/install/pane switch/state write/PTY ownership/screen parsing을 하지 않는다.
- detail observation budget은 32다. 전수 probe나 attention 추론을 추가하지 않는다.

## 검증 영수증

- `351c23f`: focused 12, qualification 484/484, `check:full` exit 0 in 496s, installed-package proof green(492 files).
- `1f456df`의 정본 `d49e6cb`: focused 54, qualification 476/476, `check:full` exit 0 in 503s.
- `ec49ada`: focused 13, combined qualification **486/486**, garden claims **10/10 own-QK**, `check:full` exit 0 in 501s.
- amendment review: Fable coordinator `20260914T071543-a316b4`; Opus reviewer `20260914T072005-9e8cd9`; final Blocker 0 / Defect 0 after G1/G2/D1 closure.

## GLG hands-on receipt

GLG가 oracle에서 `./run.sh garden --once` 실제 frame을 읽었다.

- authority/scale 기계 receipt: pane rows `gd:?`, record rows `pl:?`, 두 vertical panels, `dormant(dead rail)` 명시.
- frame counts: `records=1117 observed=32 unobserved=1085`, `hidden records:1091`, native-push listing-liveness unknown=22.
- 이 frame은 사실을 정직하게 보여줬지만 Herdr 사진의 workspace/agent/sidebar + 실제 대화면과는 다른 물건이다.
- 56-column Q3와 watch `r/q` Q4는 완료 receipt가 없다. #114를 주차하는 데 blocker가 아니며, 재개할 때만 다시 잰다.

# 방향 판정 — #114는 작업대가 아니다

GLG direct (2026-09-14): 사용성 우선순위는 **1) 에이전트, 2) GLG, 3) 다른 사람**이다. Entwurf의 첫 기능은 형제를 부르는 것이고 사용자면은 GLG가 실제로 쓰며 정의한다. viewer 때문에 Entwurf core logic을 고치느라 고생하지 않는다.

- Herdr 사진의 핵심은 더 많은 fact가 아니라 workspace/agent 선택과 실제 하네스 대화가 한 작업대에 있다는 점이다.
- `entwurf garden`은 독립 read-only 진단·감사·fallback projection으로 보존할 수 있다. 이것을 미래의 주 workbench로 전제하지 않는다.
- #116의 중심 문장: **Herdr에게 배치를 빌리고, Entwurf는 신원·부름·거절·resume·퇴근·원격이라는 드라이버를 판다.**
- 단, “plugin”은 아직 가설이다. 현재 한 Claude에서만 측정된 `pane → nativeSessionId → gardenId` 조인을 모든 harness/lifecycle로 일반화하지 않는다.

# #116에서 먼저 나눌 질문

1. **공존:** Herdr와 Entwurf의 harness hooks/install ownership이 서로를 덮지 않는가.
2. **projection:** Herdr가 아는 native session과 Entwurf garden record를 stale/ambiguous 없이 표시할 수 있는가.
3. **placement:** agent가 `entwurf_fresh_call`로 부른 형제를 Herdr에 놓으려면 정말 mux backend 변경이 필요한가. 이것은 UI plugin과 별도 architecture 결정이며 #108 뒤에 판단한다.

Herdr `working/blocked/idle`, pane id, screen text, key injection은 Entwurf liveness/address/delivery evidence가 아니다. Herdr가 Entwurf bytes를 소유하거나 설치하지도 않는다(Hard Rules 2·5·16·17).

# READ

- #114: https://github.com/junghan0611/entwurf/issues/114
- #114 final proof/hands-on contract: https://github.com/junghan0611/entwurf/issues/114#issuecomment-5657112610
- #115: https://github.com/junghan0611/entwurf/issues/115
- #116: https://github.com/junghan0611/entwurf/issues/116
- GLG screwdriver/workbench decision: https://github.com/junghan0611/entwurf/issues/116#issuecomment-5657324177
- `docs/garden-view.md`
- `DELIVERY.md:22-26`
- `docs/mux-launch-rail.md`
- `~/repos/gh/agent-config/HERDR.md` — `[2026-09-14]` section
