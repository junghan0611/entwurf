# NEXT — #155 / Pi SDK 1.5.x → Entwurf 0.51.0

# RAIL — 현재 좌표

- [x] **HOP 0 · 좌표/승인/역할 고정.** 첫 local commit `9d424a3` 완료(normal hooks/tee exit0, clean, push 없음). Opus 공동 검토와 coordinator review로 운영 전환 보정을 정리했다. SDK/source/dist/운영 배선은 아직 바꾸지 않았다.
- [x] **HOP 1 · 전원 좌표 공유 → 개발과 운영 분리.** G4 원자료를 코디가 대조했다: 8개 identity 보존, 새 owner/직계 global bridge, stable0.50/SDK9종1.4·hostPi1.4, owning doctors0. 코드/SDK 변경 전 분리를 수용했다. 아래 미측정 경계와 첫 사후검사 실패는 보존하며 local checkpoint 후 HOP2를 연다.
- [x] **HOP 2 · 실제 SDK1.5 설치와 구현.** 10종 실제1.5.0·schema/carrier/fence·SDK14 합성 이관 proof·문서 통합 완료. scoped focused와 소비자 재설치 GREEN, Fable→Astra 및 코디 직접 검토에서 추가 수정 요구0. affected PARTIAL4그룹70/70 KILLED를 원자료로 대조했고 정상 local checkpoint로 묶는다. 아래 후보별 증거와 미측정 경계를 유지한다.
- [ ] **HOP 3 · 최종 floor·실행 증거.** ← CURRENT: HOP2 `0408a66`의 FULL947초0과 격리 S/H4셀145PASS를 코디가 원자료로 수용했다. 실제 모델/TUI/Native LIVE는 남았다. #148 전례대로 별도 로그인·인증 복사가 아닌 기존 native 인증/일관 운영 전환 뒤 실검증을 기본으로 고정했다. 다음은 정확 후보와 정상 종료·백업·설치/재개 창 준비이며 실제 운영 첫 write는 아직 실행하지 않았다.
- [ ] **HOP 4 · 0.51.0 출하 수용과 게시 인계.** 정상 landing/정확 SHA CI·Windows carrier/동일 TGZ Linux 수용·운영 cutover/registry/Herdr 후속을 owning release 절차대로 구분한다. push/Make/npm 게시 시점은 GLG와 조율하고 자동 실행하지 않는다.

# NOW

- **다음 한 행동 — HOP3 운영 창 준비:** [SDK upgrade 기본 반경](docs/setup-clean-host.md#default-radius-for-a-requested-pi-sdk-upgrade)을 따른다. 인증 전략을 다시 선택하라고 묻지 않는다. 정합 검수 후보·정확 대상·normal shutdown/reopen 명령·전체 native directory 일관 백업·old owner exit·host/extension/bridge/SDK 동일 root를 준비한 뒤 운영 창을 맞춘다. SDK1.5로 운영 DB를 사전 시험 open하거나 credential을 별도 sandbox로 복사하지 않는다. 운영 창 뒤 기존 인증/같은 identity의 실제 turn·tool·왕복과 owning Native LIVE를 측정하며 push/게시/다른 시민 retirement는 별도 권한이다.
- **HOP3 완료 축:** `0408a66` FULL run3 exit0/947초, HEAD/index/clean·dist 봉인 동일; run1/2는 추가한 private TMPDIR의117/109byte socket EINVAL로 보존하고 기존 per-gate mkdtemp격리의TMPDIR=/tmp로 fresh 전체 측정했다. B의 contact91(adapter-direct)/send19·native-module14/receive21(S+H),총145PASS/0FAIL/벤더0과 봉인 동일을 직접 대조했다. 원자료 `/tmp/i155/hop2-full-0408a66f8268-run3/`, `/tmp/i155/opusb/hop3/`. privateHOME guard는실운영HOME불변증거가아니다. 이 후속 docs/NEXT checkpoint나 준비0.51 SHA의 FULL/LIVE로 승계하지 않는다.
- **HOP2 근거:** reviewed source는 `fe4780e` 위42파일 snapshot `692c150a…002d`, stage tree `e1798498…a35b`. carrier70/contract247/surface96/ACP9·SDK14 migration9(기존 포함20)·4fence·emit 및 consumer run2 GREEN. consumer 최초RED는 과거1.2 fixture가 없는 pi-schema1.2를 요구한 것으로 보존했고 과거 fixture의 그 항목만 제외해 fresh 전체 재측정0. Fable report 최종 `8b6bb376…7e0c`와 Astra 수신 `6d543a`는0Blocker/0Defect, 코디 직접 검토도 추가 finding0. 이 읽기 검토는 실제 TUI/LIVE를 증명하지 않는다.
- **affected PARTIAL 수용:** `/tmp/i155/hop3-partial/01..04-*.receipt.json`을 코디가 직접 파싱해 passed/control/treeClean·각 declaredInput의 현재 sha를 대조했다. exact argv는 pin-matcher2/dep-versions5/ACP-vendor4/carrier59, 총70 KILLED. 모두 candidate `{head:fe4780e,workSurfaceSha256:811db89a…8d0}`이며 wrapper 전후 동일/exit0/gate-exit0. official manifest head242checks·1506mutants/94lanes는 별도이고 나머지1436mutants kill-power는 재측정하지 않았다. 이 후속 NEXT 갱신/commit SHA나 release 전체의 kill-power로 승계하지 않는다.
- **미측정:** SDK1.5 interactive TUI/실모델 turn·native LIVE(Pi↔durable/fresh/resume)·exact-SHA CI/Windows/artifact/release. SDK14 no-resume/no-input open은 두 fixture 관측뿐이며 kill은 metadata/tasks행이 변경됐다. downgrade 안전 보장이나 운영 데이터 복구 실측으로 확대하지 않는다. optional typebox peer 제거·SDKfloor 변경은 release prepare의 CHANGELOG에 반영해야 한다. published0.50 레시피/oracle은 sourceversion 상승만으로 지우지 않는다.
- **전원 출발점 공유 완료:** GLG의 “오늘 레일을 먼저 서술해서 좌표를 다 공유하고, 그 다음 진행”, “지금 역할이 없어도 지금 불러 좌표를 공유” 지시대로 공식resume각1회로기존4명을복귀시켰다. 공통초판SHA256 `963253d41cf64fe46808ee24067d2b4c41c074d5b924645a4528ac1baa3457ea`의8항목·역할표를 OpusA/B·Terra·Fable·Astra·Sorge코디가09:36까지읽고ACK했다. 각모델/담당은자기보고이며launch/주소관측을recall/실검수로확대하지않았다. 이후갱신은이완료시점과파일별writer규칙의명료화다. 새시민/대체모델없음. source-MCP로복귀한OpusB/Fable도R1재기동대상에포함한다.
- **G4 수용 근거:** OpusA 보고의 `/tmp/i155/g4/g4-join.txt`, `sdk-now.json`, `doctor-*.out`을 코디가 직접 읽었다. 8명 garden/native/cwd/createdAt/backend 보존, CC4 receiver의 새 PID/startKey/record binding, PD2 location의 새 owner/native/binding과 receiver PID/startKey가 일치한다. 새 main202521→202614, SorgePD201946→201976, SorgeCC201852→202068 및 나머지 host의 직계 bridge가 global0.50 compiled entry다. 코디는 main 새 argv/직계 bridge/oldPID 부재와 owner peer-facts도 직접 측정했다. G4 원자료의 checkout cmdline0, SDK9종1.4/store 해석, hostPi1.4, package/OMP/meta doctors0를 수용하며 meta live축은 이번 CC4 join 범위다. 설치공급 전단계는 [6591933746](https://github.com/junghan0611/entwurf/issues/155#issuecomment-6591933746).
- **G4의 경계:** 직접 JS load trace는 없다. SDK 근거는 global resolver/bootstrap argv·그 root의 해석·managed pre-exec pin 검사이며 maps/fd에서 store도0이므로 loaded bytes 증거로 쓰지 않는다. Pi2는 process title이 argv를 가려 extension root를 직접 측정하지 못했고 settings registration/직계 global bridge로 경로를 대조했다. Sorge Telegram 실제 송수신은 owning 확인 전 미측정. main bootstrap argv는--resume/Sorge는--continue로 관측됐으며 요청한--session 문자열 실행을 주장하지 않는다. 동일 native는 location/record로 확인했다.
- **R1 사후검사 정정:** installer자체0뒤초기strictpostchecker1은보존했다. otherClaudeJSONhash불일치를읽기전용으로좁혔고정확한before해시와일치한vendorbackup에서유일추가차이가 `pluginUsage.entwurf-meta-receive@meta-bridge-local` 삭제임을확인했다. 다른JSON/settings/bridgeenv동일을그한경로만분리해postcheck-only0으로검증,설치·설정원복재실행0. 원자료는 `r1-install-meta.*`, `r1-meta-unmanaged-before.json`, `r1-meta-postcheck-only.*`이며G4/운영1.5수용을뜻하지않는다.
- **추가 runtime:** main 외 대상은 Sorge durable71785c와 Sorge 운영CC002e68로 확인됐다. GLG가 Sorge의 잠시 중단을 허용했고 실제 종료/재개는 직접 한다고 지시했다. Sorge 전용MCP는 그 소유자가 맡고 코디68bd94가 시점을 맞춘다. PID/화면/단순 cwd 문자열을 주소나 runtime 의존 판정으로 삼지 않고 owner/entry/bridge/SDK를 결합한다.
- **base:** main `1e4c2204f47efa3a5ac0220e73f498588c33825f`(f45a95ad 대비 NEXT.md만 변경). immutable core0.50 tag `1cbf50fe`는 출하 비교점이다. reference `~/repos/3rd/pi/pi-mono`는 v1.5.0 `f9a26365568127461c47a07a37dcb42c140a3ac5`, clean으로 main도 직접 확인했다.
- **정본:** [#155 본문](https://github.com/junghan0611/entwurf/issues/155)의 SDK bump runbook과 최신 thread. 본문과 최신 결정이 다르면 최신 결정의 근거로 본문을 정정한다. 이 NEXT는 지금의 홉·승인·역할을 가리키며 runbook을 복제하지 않는다. `.tmp-verify/archives/cold-evidence-20261027.tar.zst`의 #148/#145 원근거를 Opus가 회수한 [runbook 이력](https://github.com/junghan0611/entwurf/issues/155#issuecomment-6591273358), [V3/PATH 정정](https://github.com/junghan0611/entwurf/issues/155#issuecomment-6591303789)을 읽는다.
- **오늘의 좌표:** 준비안만 쓰고 밤까지 기다리는 것이 아니다. 운영 분리 뒤 **실제 SDK를 오늘 설치해 개발·타입/실행 검증**을 한다. 목표 core0.51.0의 npm 게시 시점은 내일을 예상하지만 확정 약속이나 오늘 publish 권한이 아니다.

# 오늘 전원이 공유한 출발점 — 09:36 ACK 기록, 현재 지시는 NOW

1. **무엇을 끝내는가:** Entwurf를 실제 Pi SDK1.5.x에서 동작하게 만들고 검증한 core0.51.0 후보를 만든다. 오늘은 준비안만 쓰는 날이 아니다. npm 게시는 내일을 예상하되 상태를 보고 GLG가 정한다. 0.50.0 core/npm/운영 안착은 이미 끝난 이전 subject이며 새 SDK의 검증으로 승계하지 않는다.
2. **왜 운영 분리가 먼저인가:** 지금 SDK1.4 기반 운영자가 개발 checkout을 실행한다. 그 아래 SDK/emit/소스를 바꾸면 운영 코드가 섞일 수 있다. 안정0.50 global 공급과 Pi/OMP 등록·Sorge 전용MCP 준비는 완료 보고를 받았고, Claude 공통 배선과 현재 실행 중 host/bridge는 아직 전환 전이다. 다음은 모든 실행 경로·시민별 same-id 복귀를 안정판으로 옮겨 G4를 수용하는 일이다. 실제 닫고 다시 켜는 시점은 GLG와 맞추며 임의로 내리지 않는다.
3. **오늘 승인된 개발:** 필요한 정확 버전별 대기 예외와 SDK1.5.0 열 member 설치를 포함한다. 안전한 운영 분리 뒤 바로 설치해 타입 오류를 작업 목록으로 삼고 구현/fixture 검증을 한다. 밤까지 설치를 미루거나 세부 작업마다 GO를 재요청하지 않는다. host pi는 실제 cutover 전까지1.4.0, 개발 시험은 private HOME/PI/XDG에서1.5를 쓴다.
4. **핵심 구현 접점:** viewState/taskGraph/subscribeCommits 대체, ConversationTranscript window, SessionEnd.kind에 근거한 fence 저장 판정, report.error/runFailure/compaction.trigger 표시, pi-schema와 동등한 tool/contract schema·SDK10종/host floor다. 엔진/auth/저장/scheduler를 재구현하거나1.5 신기능/#156 UX를 섞지 않는다. source·upstream 주장·미측정은 #155에서 구분한다.
5. **역할:** Opus들이 긴 실무 구간을 소유하고, Terra는 docs/·AGENTS의 source 정합성과 폐기 제안을 지속 확인한다. 코디는 역할/파일 경계·홉 정리·review·commit을 맡고 매 명령 승인 창구가 되지 않는다. Fable/Astra는 지금 출발점을 읽고 대기하며 중요 검수 창에만 투입한다. 본검수는 Fable 종료 뒤 Astra, 그동안 모든 실무/문서 writer 정지다.
6. **증거와 홉:** HOP1 분리 → HOP2 실제 SDK/구현 → HOP3 순차 검수·proof·floor → HOP4 출하 인계. 홉이 끝날 때 원자료와 계약을 추스리고 review/정상 hooks/local commit 후 다음 홉으로 간다. 한 홉 안에서 같은 파일의 writer는 한 명이고, 겹침/막힘/계약 변경은 코디에게 모아서 보고한다. 정기 polling·watcher·추가 framework를 만들지 않는다.
7. **운영 데이터를 지킨다:** 개발1.5로 운영 대화를 시험 open하지 않는다. 문서 버전 상승은 단방향이므로 실제 cutover 전에 정상 종료/옛 owner exit/전체 세션의 일관 백업을 확인한다. package downgrade나 stale-lock 삭제를 rollback이라고 부르지 않는다. 예상 밖 운영 오류는 원exit와 상태를 보존하고 STOP한다.
8. **지금 할 일:** 모델·garden id·이전 담당 맥락을 자기보고하고, 이 출발점/맡을 역할/현재는 좌표 공유 pause임을 한 번 ack한다. 새로운 구현·문서 수정·검수·설치·실험·추가 위임은 코디가 전원 수신을 정리해 다음 구간을 열기 전 시작하지 않는다. GLG는 회사 업무에 집중하고, 코디가 홉 완료/실제 막힘/정상 재기동 시점에 DM한다.

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
| Opus A (현재 live, 모델 자기보고5.5) | 20261102T081752-169dd1 | #155/runbook·#148 경험, R1 운영 분리, SDK exact 집합/공급/pnpm·host floor·adapter/schema·패키지 proof의 integration writer. shared package/pin/overlay와 공식emit/generated carrier는 A가 단독 담당. optional `peerDependencies.typebox`의 유지/제거는 published 표면 변경으로 별도 audit/proof를 남기며, generated carrier는 수동 편집하지 않음. B의 carrier source와 파일 구획을 나누고 SDK/emit 경계는 코디로 모아 조율. 홉 종료/Blocker/contract 변경만 코디로 보고. |
| Opus B (복귀·모델 자기보고5.5 확인) | 20261030T190810-915040 | carrier authored runtime/TUI·ConversationTranscript·SessionEnd/fence·이관 fixture 담당. durable source와 동작 옆 proof를 맡고 package/pin/overlay/generated carrier는 수정하지 않음. 필요한 SDK/공식emit 조건은 코디로 모아 A에게 전달. G4 전에는 읽기 대조만. |
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
