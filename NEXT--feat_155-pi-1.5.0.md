# NEXT — #155 / Pi SDK 1.5.x → Entwurf 0.51.0

# RAIL — 현재 좌표

- [x] **HOP 0 · 좌표/승인/역할 고정.** 첫 local commit `9d424a3` 완료(normal hooks/tee exit0, clean, push 없음). Opus 공동 검토와 coordinator review로 운영 전환 보정을 정리했다. SDK/source/dist/운영 배선은 아직 바꾸지 않았다.
- [ ] **HOP 1 · 개발과 운영의 안전한 분리.** ← CURRENT: Opus169dd1이 추가 실행자의 canonical owner를 확정하고, 검증된 npm0.50.0을 pnpm global에 설치·owning 전환·시민별 재시작·새 runtime/owner 증거를 수용한다. 이후에만 SDK 설치/emit/build를 시작하고 기존 실무·문서 담당을 stable root에서 되부른다.
- [ ] **HOP 2 · 실제 SDK1.5.x 설치와 구현.** SDK 집합·carrier API/fence·schema·host 경계를 Opus들이 이관한다. 처음 typecheck RED는 진단이며 checkpoint가 아니다. normal hooks/affected focused가 green인 일관된 subject에서만 홉을 닫는다. 규모가 크면 완료 가능한 sub-hop으로 나누고 각각 review/commit한다.
- [ ] **HOP 3 · 독립 검수·이관/rollback proof·최종 floor.** 실무 freeze → Fable 검수/종료 → 필요 보정 → 다시 freeze → Astra 검수/종료 → amendment 수용·affected PARTIAL → frozen FULL·필수 Native/LIVE/artifact. 최종 floor 중 source/index/dist 이동 없음.
- [ ] **HOP 4 · 0.51.0 출하 수용과 게시 인계.** 정상 landing/정확 SHA CI·Windows carrier/동일 TGZ Linux 수용·운영 cutover/registry/Herdr 후속을 owning release 절차대로 구분한다. push/Make/npm 게시 시점은 GLG와 조율하고 자동 실행하지 않는다.

# NOW

- **다음 한 행동:** 첫commit 이후 순서는 HOP1/R1의 안정 runtime·G4 수용 → 기존 Opus915040/Terraa20739 same-id 복귀·역할 확인으로 조정한다. GLG의 commit 후 복귀 순서는 지키되 checkout에서 되불렀다가 다시 옮기는 중복 재기동을 피한다. 현재 Opus169dd1이 R1을 전담하고, 그 자신도 안정 runtime으로 재기동된 뒤에 HOP2를 시작한다. Fabledff8a1/Astra567753는 중요 검수 창 직전에만 순차 되부른다. 새 형제를 임의 생성하지 않는다.
- **운영 식별 중:** Opus의09:02 `/proc` 관측은 checkout runtime host2/compiled bridge2/source-TS bridge2다. main 외 durable 관측 PID4189268과 다른 CC source-bridge의 canonical garden/native/cwd/owner 결합을 Opus가 owning reader로 확인 중이다. PID를 주소로 삼거나 임의 접촉·종료하지 않는다. 확인된 모든 runtime의 전환/종료 계획을 수용하기 전 SDK/source 변경은 보류한다. `argv`의 무관한 cwd/reference 문자열까지0을 요구하지 않고 실제 executable/module/SDK 공급 경로를 판정한다.
- **base:** main `1e4c2204f47efa3a5ac0220e73f498588c33825f`(f45a95ad 대비 NEXT.md만 변경). immutable core0.50 tag `1cbf50fe`는 출하 비교점이다. reference `~/repos/3rd/pi/pi-mono`는 v1.5.0 `f9a26365568127461c47a07a37dcb42c140a3ac5`, clean으로 main도 직접 확인했다.
- **정본:** [#155 본문](https://github.com/junghan0611/entwurf/issues/155)의 SDK bump runbook과 최신 thread. 본문과 최신 결정이 다르면 최신 결정의 근거로 본문을 정정한다. 이 NEXT는 지금의 홉·승인·역할을 가리키며 runbook을 복제하지 않는다. `.tmp-verify/archives/cold-evidence-20261027.tar.zst`의 #148/#145 원근거를 Opus가 회수한 [runbook 이력](https://github.com/junghan0611/entwurf/issues/155#issuecomment-6591273358), [V3/PATH 정정](https://github.com/junghan0611/entwurf/issues/155#issuecomment-6591303789)을 읽는다.
- **오늘의 좌표:** 준비안만 쓰고 밤까지 기다리는 것이 아니다. 운영 분리 뒤 **실제 SDK를 오늘 설치해 개발·타입/실행 검증**을 한다. 목표 core0.51.0의 npm 게시 시점은 내일을 예상하지만 확정 약속이나 오늘 publish 권한이 아니다.

# GLG 직접 승인 — 2026-11-03 Oracle coordinator 대화

GLG는 “오늘 작업이 시작되어야 하니까, 여기에 필요한 모든것은 승인”, “브랜치를 파서 브랜치 넥스트로 레일”, “커밋을 한번하고 그 다음 앞서 작업했던 형제들을 다시 불러”, “실무는 오푸스 형제들”, “홉마다 리뷰하고 커밋”, “푸시 시점은 나랑 조율”을 직접 지시했다. 앞선 준비 전용 정지보다 이 최신 지시가 우선한다.

- **포함:** 오늘의 R1 운영0.50.0 분리, 해당 버전의 명시적 release-age 예외 한 줄과 승인된 설치·owning 전환, 필요한 SDK1.5.0 열 member의 버전별 예외·개발 설치, 구현과 affected focused 검증, 홉별 review와 local commit. 예외는 정확 버전만이며 광역 패턴/정책 비활성화는 하지 않는다. pnpm loose mode의 예상 밖 자동 예외/다른 global package 변경/미승인 lifecycle은 성공으로 넘기지 않는다.
- **구분:** HOP0는 동일 commit에서 branch를 만들고 인계 문서만 커밋하는 사용자 명시 순서다. runbook의 R1 전 branch 금지는 운영 소스/의존성/emit 변화를 막는 취지이며, 이 문서-only HOP0에는 최신 직접 순서를 적용한다. SDK/실행 코드 변경은 여전히 HOP1 수용 뒤다.
- **미포함:** 임의 push/force/tag/npm publish, 인증/설정/SDK 무단 복사, 운영 DB의1.5 시험 open, blanket kill/record 삭제/lock repair, 새 manager/watcher/worker 체계. 필수 release/LIVE와 실제 운영 cutover는 각각 owning 조건·시민별 종료 계획을 충족해 실행하며, all-approved를 출하 floor 면제로 쓰지 않는다.
- **추가 승인 질문 최소화:** routine 구현/시험/문구 보정마다 GLG에게 묻지 않는다. 홉의 subject·proof·checkpoint를 추슬러 다음 홉을 이어간다. 비가역 운영 데이터 첫1.5 write/예상 밖 소유권 충돌/미확정 publish·push 시점/자기 정상 종료 표면 부재처럼 실제로 사람 판단이 필요한 경계만 묻는다. 고의로 수집하는1.5 typecheck RED와 예기치 않은 운영 오류를 구분한다.

# 역할 / 실행 소유 — 공유 checkout, 파일 writer 한 명

| 담당 | garden id | 범위와 checkpoint |
|---|---|---|
| coordinator | 20261014T212756-68bd94 | 홉/승인/파일 경계·증거 대조·겹침 조정. 초기 NEXT와 첫commit writer. 각 홉 말 review extension으로 직접 읽고 local checkpoint를 정리. 세부 구현을 가져오거나 미시 승인 루프를 만들지 않음. |
| Opus A (현재 live, 모델 자기보고5.5) | 20261102T081752-169dd1 | #155/runbook·#148 경험, R1 운영 분리, SDK exact 집합/공급/pnpm·host floor·adapter/schema·패키지 proof를 맡을 제안. optional `peerDependencies.typebox`의 유지/제거는 published 표면 변경으로 별도 audit/proof를 남기며, generated carrier는 수동 편집하지 않음. 실제 writer 구획은 복귀한 Opus와 함께 확정. 홉 종료/Blocker/contract 변경만 코디로 보고. |
| Opus B (same-id 복귀 후 모델 확인) | 20261030T190810-915040 | carrier runtime/TUI·ConversationTranscript·SessionEnd/fence·이관 fixture를 맡을 제안. 서브모듈별 ownership을 A와 중복 없이 확정하며, shared package/pin/emit 최종 writer는 하나로 둠. |
| Terra | 20261101T123618-a20739 | 문서 수준 정합성을 지속 점검. README뿐 아니라 docs/의 live 계약·오래된 안내·폐기 후보를 실제 source/receipt와 연결해 제안. 구현과 동떨어진 선행 문구나 무관한 문서 삭제는 하지 않음. docs writer 범위를 코디와 합의하고 AGENTS.md의 Type Boundaries 문장도 실제1.5 schema import 결정과 맞춤. code/package/pin은 수정하지 않음. |
| Fable | 20261102T063827-dff8a1 | 중요한 frozen checkpoint의 독립 검수. 보고는 상태 변화/Blocker·Defect·Observation/파일 근거로. 검수 중 모든 실무자·문서 writer 정지. 종료/한정 보정 뒤 Astra로 넘김. |
| Astra | 20261030T185730-567753 | Fable과 겹치지 않는 다음 검수 창의 독립 검수. GLG가 이번 역할을 명시했으므로 이전 Astra 연락 금지는 이 요청 범위에서 갱신됨. 현재 모델/같은 id 확인 뒤 검수. |

- 이전 Pi Opus150a5e는 이번에 별도로 지목하지 않았으므로 기존 연락/resume/retire 금지를 유지한다. notebook 팀은 GLG가 같이 보자고 할 때만 참여시킨다.
- CC same-id resume은 model/permission flag를 복원하지 않는다. 정체성/모델을 자기보고로 확인한 뒤 모델별 본작업을 전달한다. 기존 model을 임의로 바꾸거나 실패 시 새 시민으로 대체하지 않는다.
- 배정한 긴 구간을 각자가 소유한다. 다른 peer와 별도 coordination lane을 만들지 않고 코디로 checkpoint를 전달한다. working sibling의 임의 retire·프로세스 kill 없음.

# 홉 종료 계약 / 검수 창

1. 실무 담당이 subject·실제 diff/측정 경로·pass/fail/not-run·남은 계약을 한 번에 보고한다. 증거 없는 사실은 가설로 둔다.
2. 코디가 홉 경계를 freeze하고 **review extension**으로 정확한 uncommitted/commit 범위를 읽는다. 이는 코디의 직접 검토이며 독립 reviewer를 가장하지 않는다.
3. 중요 창에서는 모든 source/docs writer를 정지시킨 뒤 **Fable → 완료/정리 → Astra → 완료/정리**로 순차 진행한다. 둘을 동시에 돌리거나 실무/문서 작업과 병렬 진행하지 않는다. 새 architecture Blocker2개면 설계로 복귀한다.
4. 합의된 amendment와 affected focused만 inner loop에서 확인한다. 정상 hooks/scanner 후 일관된 완료 bundle을 local commit. SDK/API가 어긋나 normal typecheck/hook가 깨지는 중간 상태를 거짓 green checkpoint로 남기거나 bypass하지 않는다.
5. 완료된 홉의 근거를 issue/owning docs에 승격하고 이 NEXT의 CURRENT를 옮겨 다음 홉으로 간다. 홉 checkpoint는 frozen-candidate FULL/native/artifact/정확SHA CI 수용이 아니다. gate/mutant 변경의 affected PARTIAL은 검수 보정 후 해당 exact argv만 실행하며 whole BODY는 추가하지 않는다.

# 운영 / 공급 / rollback 가드

- pnpm global은 #148에서 실제 수행한 경로를 이번에 선택한 안이며 모든 project-local/PATH 구성이 불가능하다는 뜻은 아니다. 등록 전 공급·SDK/carrier/bridge boot 확인과 등록 후 ownership doctor를 구분한다. owning takeover는 명시적 계획된 전환이며 오류 우회가 아니다.
- 안정 운영0.50.0은 Pi SDK1.4.0으로, 개발1.5.x와 물리적으로 분리한다. PATH bare bin, user/project shadow, Claude source-MCP, installed copy, 새 host/직계 bridge의 실제 entry와 SDK resolution을 각각 확인한다. 같은 native-session의 cwd는 checkout을 유지한다. 단순 경로 문자열0/grep만으로 새 loaded bytes를 인증하지 않는다.
- 운영 host pi는 안정판0.50의 범위에 맞는1.4.0으로 유지한다. 개발 SDK1.5는 격리 시험의 명시적 CLI/SDK에서만 쓰고, host pi1.5 전환은 후보와 맞춘 실제 cutover 때 한다. bare `pi update` 대신 승인한 exact 버전 명령을 사용한다. tmux durable resume은 호출 bridge의 PATH에서 entwurf를 찾으므로 dev-bin 해제·global 해석 확인 전에는 main을 재개하지 않는다. 새 bridge의 실제 executable 해석도 확인한다.
- main durable 정상 종료는 자체 retire 도구로 강제하지 않는다. 필요한 순간에는 GLG의 정상 종료 또는 승인된 native 정상 표면을 사용하고, 다음 안정 root에서 same-id 복귀를 관측한다. 자기 종료 표면이 없다고 raw tmux kill/send-keys나 DB/lock 수선으로 우회하지 않는다. R1에 참여할 다른 운영 시민은 정확한 대상·종료 계획을 먼저 기록한다.
- 같은 gardenId/nativeSessionId/cwd/createdAt을 보존하고 attachIncarnation/ownerPid/startKey/binding과 receiver join은 새 attach에 맞게 갱신한다. 오래된 #148의 recordUpdatedAt만 바뀜 조건을 복제하지 않는다.
- 첫1.5 운영 write 전 옛 owner의 실제 종료를 확인하고 native directory 전체를 WAL/SHM 포함 일관된 사본으로 보존한다. 개발 이관/실패/rollback 검증은 synthetic golden/격리 fixture로만 한다. SQLite schema2가 같아도 pi.live1→3/pi.generation1→2/pi.tool2→3 데이터는 package downgrade로 복구되지 않는다.
- 아직 실행하지 않은 rollback을 원자적 복구처럼 쓰지 않는다. 예상 밖 운영 오류는 단계·원exit·남은 owner를 보존하고 STOP; 필요한 named recovery만 결정한다. SDK가새 patch를내면freeze전diff/집합을다시감사하고새버전예외/측정은구분한다. FULL중간버전추적없음.

# 읽을 근거 / 기록

- [#155](https://github.com/junghan0611/entwurf/issues/155) / [#148](https://github.com/junghan0611/entwurf/issues/148) / [#145](https://github.com/junghan0611/entwurf/issues/145), `VERIFY.md`, `docs/setup-clean-host.md`, `docs/herdr-launch-rail.md`, `docs/acp-backend-rail.md`, carrier source-adjacent proof와 각 owning installer.
- 0.50 종결/실제main복귀: [6588856274](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6588856274), [release dated update](https://github.com/junghan0611/entwurf/releases/tag/v0.50.0). 이 근거는 새SDK검증으로 승계하지 않는다.
- Opus의 source/registry 준비 기록: `/tmp/i155/CHECKPOINT-{1,2}.md` 및 #155 공개 checkpoint(6590654749/6590824105). 로컬 경로는 cross-host 근거를 대신하지 않으며 결정적 source/hash/count는 공유 artifact에도 싣는다.
- 이 branch NEXT는 merge 전에 durable 결과를 승격하고 삭제한다. push/출판은 GLG가 시점을 정한다.
