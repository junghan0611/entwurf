# NEXT — #160 OpenClaw citizen (branch `160-openclaw`)

# RAIL — 현재 좌표

- [x] **S0. 레일.** 브랜치·이 문서·팀 구성. GLG 결정 2026-11-13 thinkpad.
- [x] **S1. 측정 (11.3 lab).** M0–M5 완료, 9fc008 샘플 검수. 요지는 아래 "기록 — S1" 참조.
- [x] **S2. 결정 카드.** 4184c5 작성, GLG 7절 1–5 승인, 6은 oracle 측정으로 닫음(2026-11-13).
- [x] **S3. 구현.** 0c9e3a(flip 포함), 4184c5 리뷰 Blocker 0, Defect 3 반영.
- [~] **S4. LIVE (lab).** 왕복, busy steer, reset 뒤 같은 garden id, fresh (c)(d) 측정. 남은 것: fresh (a) 표시면, (b) agent-policy 폭, TUI 바인딩 증명. release stop 유지.
  - fresh 조합을 만들 때 `bin` 거절을 preflight에도 넣는다(S5.4 재확인 A1): 지금은 `openclawTuiLaunch`(tui 단계)에만 있어서, 조합이 생기면 `sessions.create`와 birth 뒤에 거절된다. tui 단계 throw는 마지막 방어선으로 남긴다.
- [~] **S5. oracle 운영 Docker 봇 연결.** S5.6에서 멈춤(admission이 S6에 달림). 설계 카드와 GLG 결정은 끝났다(아래 "S5 결정"). 구현 단계:
  - [x] **S5.0 merge·RED.** main `0c058cea` 37커밋 merge → `51ed755a`(충돌 0, ff08d4 승인 2026-11-14). 이름 붙은 RED 두 개: ① `check-harness-admission-parity` openclaw(GLG: 그냥 둠, flip 묶음에서만 닫힘) ② ~~`check-capability-bundle-reach` B3~~ — CLOSED: ff08d4가 GLG 승인으로 20:24:26 build-bridge, bundle-reach PASS(39) [상속: ff08d4 메시지]. build-bridge는 ff08d4 담당, 구현자는 돌리지 않는다. 영수증 `/tmp/ff08d4-next/impl-status.md`(oracle 로컬).
  - [x] **S5.1 1b: 선언별 `bin` 절대경로.** gateway 항목에 optional `bin`(absolute + normalized). 수신 어댑터 probe가 그 경로를 argv0로 쓰고 route에 찍어, send는 선언을 다시 읽지 않고 같은 program을 쓴다. `bin`+`configPath`는 파서가 이름 붙은 오류로 거절. DELIVERY.md OpenClaw 행 갱신. V3 불변. 옆 테스트 +8(파서 4, 어댑터 3, 수용 1), 손 mutant 2개 kill(거절 제거 → 1 fail, route.bin 무시 → 2 fail). focused gate green: lint, typecheck, tests-beside-behavior 1204, native-push-adapter, v2-contract, v2-production, meta-session, install-surface.
    - 경계: fresh의 `openclawTuiLaunch`는 `bin`을 읽지 않는다(production 호출자 0, fresh preflight가 거절 중). 컨테이너 TUI는 docker exec `-it`가 필요해 별도 설계 — fresh 단계에서 다룬다.
  - [x] **S5.2 wrapper invalid 계약.** 플러그인 분류표는 이미 맞았다(exit 2 + `{"kind":"invalid"}` 한 줄 → invalid, 0줄 → indeterminate, `plugins/openclaw/dist/core.js` classifyEntryResult). 이번에 계약으로 고정했다: core.js 헤더에 "operator wrapper" 문단, manifest `entwurfBin`/`declPath` 문구(card §R2 정돈안), 옆 테스트 +5(wrapper 표 4행: invalid 한 줄 / bare exit 2 / ssh 255 / remote 1, 그리고 실제 child process wrapper가 foreign declPath를 invalid로 거절). 손 mutant(2→invalid 매핑 제거) → 3 fail. wrapper 자체는 운영 측(nixos-config) 소유이고 entwurf는 받는 쪽 규칙만 가진다.
  - [x] **S5.3 merge 전 문구 묶음 (flip 전 몫).** O1–O3 끝냄: O1 birth `--cwd`는 "absolute and normalized; existence not checked"(ENTWURF-CLI.json + install-surface 리터럴 + scripts/openclaw-birth.ts USAGE), O2 send exit 3 = scope 거절 또는 record 0개, 중복 native id는 strict listing이 throw → exit 1, O3 S9h 라벨·주석을 #153/#157/#160 amendment로 갱신(QK 접두사 불변, mutant는 signature 매칭). 남은 것: **BRANCH 문구 4곳 → flip 묶음** (ff08d4 결정 2026-11-14: 출하 문구는 merge 시점의 사실과 함께 바꾼다). NEXT 정리는 merge 직전.
  - [x] **S5.4 리뷰.** 1eed2c, Blocker 0 / Defect 1 / Observation 7 (원문 `/tmp/ff08d4-next/review-s5.md` sha fda970b4…, oracle 로컬). amendment 한 묶음(이 커밋):
    - D1: 새 계약 넷에 QK + 커밋된 exact-once mutant. lane `openclaw`(`scripts/mutants/openclaw.json`, 5개 — 재확인 A2로 probe 쪽 +1, build 선언 없음), 실행 좌표 `check-openclaw-beside`(run.sh 함수 + ENTWURF-CLI.json 설명 + install-surface 카탈로그 리터럴 + check:contracts), `EXPECTED_LANE_MUTANTS.openclaw = 5`. QK: `OPENCLAW-BIN-CONFIGPATH-REFUSED`, `OPENCLAW-PROBE-USES-DECLARED-BIN`, `OPENCLAW-SEND-USES-PROBED-BIN`, `OPENCLAW-WRAPPER-INVALID-LINE`, `OPENCLAW-FRESH-TUI-REFUSES-BIN`. 손 실행으로 4/4 kill, 각각 자기 QK 제목에 귀속.
    - O1: `openclawTuiLaunch`가 선언된 `bin`을 받으면 `openclaw-fresh-bin-not-honoured`로 throw(주석에 이유). 타입은 좁히지 않음.
    - O2: plugin core.js wrapper 문단에 15s 여유 한 줄. wall-clock 측정은 lab/F 단계.
    - O7: ff08d4가 #160 진행 댓글로 처리(issuecomment-6876807402).
  - **S5.4 Observation (기록만, 이번에 고치지 않음):**
    - O3: shim timeout kill은 argv0(shim)에만 간다. 운영 shim은 `exec docker exec -i …`, 래핑 셸 없음으로 둔다. kill 뒤 컨테이너 안 `chat.send`가 계속 도는지는 lab에서 잰다(도는 경우 거짓 실패 방향, 재시도 없음).
    - O4: spawn 실패(ENOENT/EACCES)가 "exited 127: (empty)"로만 보인다(공용 runner `adapter.ts:81-82`). 고치려면 공용 runner 영향 범위부터.
    - O5: 끝 슬래시 `bin`(`/opt/oc/`)을 파서가 받는다. probe에서 127/indeterminate로 드러남. 선택적 개선.
    - O6: birth가 선언을 두 번 읽는다(scope 확인 + 어댑터 probe). 판정은 probe 쪽이라 거짓 birth 없음.
  - [ ] **flip 묶음 전 목록화: 브랜치 본체 openclaw 테스트의 QK 0.** S3 범위 계약(선언 파서, scope 선택, native id, probe 분류·archived, send 분류, claim·envelope, birth, plugin claim·commit point) 중 어느 것에 QK+mutant가 필요한지 목록부터 만든다. 지금은 고치지 않는다. archived 단언(4184c5 b)도 이 목록에 들어간다.
  - [x] **S5.5 PARTIAL (candidate f005e603).** 2026-11-14 21:06–21:45, HEAD 동결, 그룹마다 1회, 실패·재시도 0. 5그룹 모두 group-green, 107/107 killed, control ok, 모든 receipt의 candidate.head = f005e603, workSurfaceSha256 f6ed6c297c4a…: `check-openclaw-beside` 5/5, `check-install-surface` 44/44, `check-gate-manifests` 52/52, `check-entwurf-v2-contract` 1/1, `check-entwurf-v2-production` 5/5. receipt `/tmp/ff08d4-next/partial/<group>.json`(oracle 로컬, ff08d4가 직접 읽어 확인). PARTIAL은 FULL 통과가 아니고, 아래 SOL amendment로 후보가 바뀌었으므로 해당 그룹은 새 후보에서 다시 돈다.
  - [x] **SOL 독립 리뷰 (a30dda, f005e603 고정).** Blocker 0 / Defect 1 / Observation 0 (원문 `/tmp/ff08d4-next/review-s5-sol.md` sha a6d83017…). D1: `realNativePushRunner`가 계약("timeout kill → 124, stalled 호출이 dispatch를 붙잡지 못함")을 지키지 못함 — `execFile` timeout은 SIGTERM만 보내서, SIGTERM을 무시하고 1s 뒤 exit 0 하는 자식이 200ms timeout에 1051ms 뒤 code 0(probe alive, send accepted)으로 읽혔다 [SOL 측정]. main부터 있던 shared runner 결함이지만 S5의 bin/shim과 75/90s 계약이 직접 기대므로 이번에 닫았다.
  - [x] **SOL D1 amendment.** runner가 deadline을 상태로 기억한다: 지나면 SIGTERM, `NATIVE_PUSH_KILL_GRACE_MS`(1000) 뒤 SIGKILL과 파이프 닫기, `NATIVE_PUSH_KILL_SETTLE_MS`(500) 뒤 무조건 settle. deadline 이후 도착한 결과는 exit 0이어도 124. 원격 작업 취소는 주장하지 않는다(O3와 분리). 옆 테스트 `native-push/adapter.test.ts` + QK `NATIVE-PUSH-RUNNER-HARD-DEADLINE` + exact-once mutant(lane `native-push-runner`, 실행 좌표 `check-native-push-runner`). OpenClaw 예산은 overrun 1.5s를 포함한다: entry worst 75s → 79.5s(`OPENCLAW_RUNNER_OVERRUN_MS`, adapter.ts와는 순환 import라 값을 따로 두고 옆 테스트가 묶음), plugin 90s 그대로, wrapper 여유 15s → 10.5s.
  - [x] **SOL 재확인 (a30dda).** Blocker 0 / Defect 0 / Observation 2, D1 닫힘(원문 `/tmp/ff08d4-next/review-s5-sol-amend.md` sha 45158cf4…). O1(late exit 0 경우의 선택적 QK 보강)과 O2(운영 ssh 계획의 timeout 여유 산술, 이제 10.5s)는 아침 카드로, 코드 변경 없음.
  - [x] **S5.5b PARTIAL (candidate f13c3e99).** 2026-11-14 22:17–22:55, HEAD 동결, 그룹마다 1회, 실패·재시도 0, 끝날 때 status 0줄. 5그룹 모두 group-green, 107/107 killed, control ok, 모든 receipt의 candidate.head = f13c3e99, workSurfaceSha256 8a7d65bb602a…: `check-native-push-runner` 1/1, `check-openclaw-beside` 5/5, `check-install-surface` 44/44, `check-gate-manifests` 52/52, `check-entwurf-v2-production` 5/5. receipt `/tmp/ff08d4-next/partial-b/<group>.json`(oracle 로컬). `check-native-push-adapter`는 committed mutant가 0이라 그룹이 아니다(빈 argv는 qualification이 receipt 없이 거절, `scripts/check-gate-qualification.ts:1363-1371`). `check-entwurf-v2-contract`는 f005e603 후보 PARTIAL에서 1/1, 이후 그 gate·subject 변경 없음. PARTIAL은 FULL 통과가 아니다.
  - [ ] **S5.6 frozen FULL** ← NEXT, 오늘 밤 하지 않음: 이름 붙은 RED(admission-parity)가 admission 결정 전까지 FULL을 확정적으로 실패시키고, FULL 안의 pack 단계가 운영 dist를 지웠다 다시 쓴다(ff08d4 2026-11-14). → **S5.7 exact-SHA CI.** build-bridge/check-pack/check:full/prepack은 GLG가 정한 재시작 창 안에서만.
  - [ ] **S5.8 oracle 적용** (GLG 승인 단계별): host shim(PATH 밖) + 선언 → SSH 키·forced command(8216f4 계획) → 플러그인 `--link` → 책상 열기(birth). oracle birth는 main 병합·flip·reader 재시작 뒤에만.

- [~] **S6. 집 연결 재정의.** ← CURRENT. GLG 글 2026-11-15 09:15(journal week45 "entwurf 외연 확장 방식"): 1번 herdr 방식은 하네스에 가든 아이디를 주고 퇴근·출근(retire/resume)을 지원한다. 2번 OpenClaw 방식은 집주인이 봇의 집을 관리하고, 우리는 집 앞 편지함에 주소를 준다(retire/resume 무의미, workspace-abc에서 깨어나는 몸은 모두 abc 봇). 첫 질문을 "fresh 예외로 입장시킬까"에서 "주소를 받는 존재는 누구이며 그 생명주기는 누가 소유하는가"로 바꾼다. 실무 질문지는 ff08d4가 보냈고(68bd94 mailbox 2026-11-15 09:42), 68bd94가 보완 4개를 붙여 순서에 동의했다(09:43). 실행·구현 승인은 아니다.
  - [~] **S6.1 정체성 범위 (오프라인, 문서; (a) 결정, 계약 문구는 S6.3에 합류).** 지금 주소 단위는 편지함이다. record nativeId가 `openclaw:<scope>:<sessionKey>`이고(`openclaw-citizens.ts:51-54`), 선언이 한 agent 아래에 여러 key를 허용한다(:11-12, :25-29). 그래서 한 집에 garden이 여럿 생길 수 있다. birth와 send가 모두 key를 포함한 nativeId로 정확히 join하므로(`openclaw-birth.ts:41-42`, `openclaw-send.ts` → `receiveOpenclawClaim`) [68bd94 직접 읽음, ff08d4 재확인], 중복 birth 거절만으로는 "key를 바꿔도 같은 garden"이 성립하지 않는다. 비교할 두 안:
    - (a) 최소안: 한 집에 한 garden. 첫 key를 고정하고, key 교체는 미지원이며 교체 시 정직하게 거절한다.
    - (b) 집 정체성과 route를 분리하는 별도 계약. 문법 변경은 V3 스키마 변경과 구분하고, 기존 thinkpad lab record의 이동·재발급·dual reader를 미리 가정하지 않는다.
    - 여러 고정 key가 필요하다는 근거는 없다. 그 가능성을 미리 설계하지 않는다. workspace 경로는 집의 몸이지 두 번째 주소 원장이 아니다.
    - **GLG 결정 2026-11-15: (a).** "간단하게 가보는게 언제나 좋아. 되면서 견고해지면 확장할수 있으니까." (b)는 실사용에서 key 교체가 필요해질 때 별도 계약으로 연다.
  - [ ] **S6.2 OpenClaw 자체 봇 간 메시징 소스 읽기 (외부 artifact 획득, 읽기 전용).** 대상은 운영 버전 2026.11.3 `847611d`(NOW의 운영 전제와 같은 좌표). 10.9 결과를 승계하지 않는다. 그 커밋만 /tmp 별도 디렉터리에 shallow로 받는다. 이건 "완전 offline"이 아니다. 읽을 것은 세 가지다: 봇이 다른 봇을 부르는 도구(sessions_send류)와 설정 게이트, 수신 봇이 보는 발신자 문맥, 접수와 답신의 경계. 영수증에는 file:line@847611d를 단다. 컨테이너·Gateway에는 접촉하지 않는다.
  - [x] **S6.3 계약 delta 문서.** → v2.1 `/tmp/ff08d4-next/s6-contract-delta.md`(oracle 로컬, sha 1823a8fd…). 리뷰: 1eed2c B0/D3/O6(cd615e87…), SOL B0/D3/O2(351f0a7d…). 68bd94 운영 의견 반영(10:09). **GLG 채택 2026-11-15**: 아침 카드 ①의 B를 이 범주로 대체, #160 정책 규칙 5·6·7·15 개정, 구현 착수. 설치 모델은 remote-pair처럼 운영자가 먼저 설치한다: nixos-config가 세션 생성·pin·선언·birth를 맡고, agent-config 스킬이 주소록 안내를 맡는다. 주소 권위는 record다. archive 뒤 재birth는 승인된 출구가 아니다. 모호하면 거절하고 멈춘다. 원래 S6.3 메모: 범주명 후보는 "집주인 소유 생명주기의 기존 집 연결"이다. 새 형식 필드나 manager는 만들지 않는다. birth는 집 생성이 아니라 기존 집에 record-backed 주소를 연결하는 일이다. "fresh/resume/retire 미적용"만 적지 않고, 대체 행동을 실증한다: open, address, consume, reply, close, refusal, compact-reset. 필수 증거는 가시성, model/policy, 발신 scope다. 바꿀 문서는 adding-a-harness.md:676-677, `check-harness-admission-parity.ts:93`의 계산 방식, #160 정책 댓글(issuecomment-6876392683)의 규칙 15 merge 정지선이다(AGENTS Hard Rule 15 아님). 이 문서가 아침 카드 결정 ①의 B를 대체하는 형태로 GLG에게 올라간다. 리뷰는 1eed2c, SOL(a30dda)이다.
  - [x] **S6.5 구현 (ee14c7, 브랜치, 2026-11-15).** delta v2.1 §1b·§7(`/tmp/ff08d4-next/s6-contract-delta.md` sha 1823a8fd…). 묶음 4개 checkpoint, push 없음, build 없음:
    1. `28fc31da` fresh 경로 제거 + 빈 allow = 닫힌 선언. `openclaw-fresh.ts`·테스트·tsconfig 항목·`freshKeyPrefix`·`via` 삭제. strict parser가 `freshKeyPrefix`를 `keys must be allow, gateways, version`으로 거절. `git grep -E 'freshKeyPrefix|openclawTuiLaunch|openclaw-fresh|fresh-prefix|OPENCLAW-FRESH|openclaw-tui-binding-unproven|openclaw-visible-identity-unmeasured|tuiBinding'`(dist·NEXT 제외)에 남는 것은 그 거절을 증명하는 테스트(`openclaw-citizens.test.ts` QK `OPENCLAW-PREFIX-FIELD-REFUSED`)와 그 mutant뿐 — 필드 이름을 적어야 하는 증명이라 의도된 예외.
    2. `56ab6f15` 한 집 한 garden: 순수 predicate `checkOpenclawHome`(openclaw-citizens.ts)를 birth·send·probe가 공유. 선언은 집당 key 하나. birth는 다른 key(선언에서 빠진 것 포함)면 `openclaw-home-already-addressed`, 집에 record 둘 이상이면 send·probe·birth 모두 `openclaw-home-ambiguous`(pick-first 없음). 잠금 없음, 동시 birth 유일 쓰기 주장 없음(주석). probe와 birth entry는 send entry와 같은 strict store listing을 읽는다.
    3. `0c321a2e` pin, 정정 이 커밋(ff08d4 결정, 입력 9fc008 10:38 → b22677 → 68bd94): 판정은 `judgeOpenclawDeskPin`(openclaw-gateway.ts) 한 곳, 이미 소비하는 describe의 session 객체에서 `pinned === true` → pinned, `pinned === false` → unpinned, 그 밖(키 없음·null·문자열) → unknown. probe가 route `deskPin`에 싣고, birth는 unpinned면 `openclaw-desk-not-pinned`, unknown이면 `openclaw-desk-pin-indeterminate`로 쓰기 전 거절. `pinnedAt`은 조건 아님(관측값). fixture는 측정된 미pin shape(`pinned:false`, `pinnedAt` 키 부재, lab m5-rpc-1.txt [상속: 9fc008]). session-event payload(`pinnedAt ?? null`)는 다른 surface라 읽지 않는다. lab M3 [상속: 9fc008 n=1, `/tmp/ff08d4-next/s6-lab-m1-m5.md`]: pin 전 `pinned:false`·`pinnedAt` 부재, pin 후 `pinned:true`·`pinnedAt`=JSON number — 판정 그대로 맞음, fixture를 두 shape으로 맞춤. patch 응답(`entry.pinnedAt`, `pinned` 없음)은 다른 surface.
    4. (이 커밋) parity `LANDLORD_HOME` 닫힌 목록 + QK 5개(CLOSED·DOCUMENTED·EXCLUSIVE·SHAPE·RELEASE-MUST, lane `landlord-home` mutant 5). release MUST = `check-openclaw-home-receipt`(run_live_step, 영수증 없으면 SKIP 97, 빈 영수증·다른 후보·다른 대상·미통과 행은 exit 1; 판정기 `openclaw-home-receipt.ts` + 옆 테스트). 문서: adding-a-harness 38행·예외 문단·release stop 두 bullet, VERIFY criterion 11과 :421 노트, DELIVERY 136행(범주 문장, 한 집 한 garden, pin, 닫힌 선언, 발신 scope = 누가 보내는가, a2a로 턴이 일어날 수 있음; fresh 문장 제거). **이름 붙은 RED `check-harness-admission-parity`는 green이 됐다.** parity green은 admission이 아니다(MUST 영수증은 S6.4).
    - 경계: retire는 export된 집합이 없어 parity가 보지 않는다(`entwurf-v2-retire.ts:192` pi/claude-code 조건문이 막음). 영수증 형식(v1, 행 11개)은 구현자 제안이고 리뷰 대상이다. 정책 댓글 규칙 5·6·7·15 개정은 thread 몫(코디).
    - 다음: 1eed2c·SOL 리뷰 → amendment 한 묶음 → affected PARTIAL(`check-openclaw-beside` 17, `check-harness-admission-parity` 5+omp-fresh 쪽, `check-install-surface`, `check-gate-manifests`). build-bridge는 ff08d4가 clean tree에서만.
  - [x] **S6.5 리뷰 (동결 4fb7cf7e).** 1eed2c(`/tmp/ff08d4-next/review-s65.md` sha 3710306a…): Blocker 0 / Defect 2 / Observation 8. SOL(`review-s65-sol.md` sha 4ed24021…): Blocker 0 / Defect 2 / Observation 2. amendment 한 묶음(ff08d4 배정 A–D):
    - B `4d7d4a9e`: parse 불가 openclaw nativeId는 skip하지 않고 모든 OpenClaw home을 `openclaw-home-record-malformed`로 거절(birth·send·probe). D: probe의 store listing 실패는 `openclaw-store-unreadable` indeterminate(birth·send entry는 그대로 거절), pin-indeterminate 분기에 자기 QK·mutant.
    - C `37c94798`: fresh-cut이 닫힌 OpenClaw 책상(allow에서 빠짐 또는 선언 없음)을 probe 없이 quiesced로 셈. 선언된 책상은 그대로 probe(alive→LIVE, 그 밖→UNCERTAIN), 깨진 선언·nativeId는 UNCERTAIN. 다른 native-push는 불변. gate H7–H9, QK `FRESHCUT-OPENCLAW-CLOSED-QUIESCED`.
    - A (이 커밋): receipt v1 strict(모든 층 unknown key 거절) + `config`{scope, gatewayUrl, bin, openclawVersion}(scope는 target과 묶임) + evidence `{path, sha256}`(디스크 digest 대조) + `measuredAt` > 후보 커밋 시각 + unmeasured는 허용 목록 `compactReset`·`resources`만, 사유 필수(구현자 제안, 리뷰 대상) + 기대 target은 `ENTWURF_OPENCLAW_HOME_TARGET`(receipt 밖) + 테스트는 독립 literal row 집합.
    - compact-reset 결정적 oracle(GLG 지적, 이 다음 커밋): QK `OPENCLAW-RESET-KEEPS-GARDEN`(openclaw-birth.test.ts). 같은 scope/agent/key에서 describe의 sessionId·lifecycleRevision이 바뀌어도 probe route 동일, birth 재attach(새 record 0), send entry가 같은 garden에 join. fixture는 lab describe shape(key agent:main:s6pin-ca8f49, pinned+pinnedAt). lab id는 중계에서 잘려 앞 그룹만 lab 값. receipt `compactReset`의 unmeasured는 vendor 쪽 LIVE 관찰에만 해당.
    - SOL 재리뷰(0e748d7e, `/tmp/ff08d4-next/review-s65b-sol.md` sha a04ed4c7…): Blocker 0 / Defect 2 / Observation 1, 앞 SOL D1·D2와 1eed2c D2·O1·O9 닫힘. 마지막 amendment(ff08d4 결정): unmeasured 허용은 `compactReset`만(사유 = vendor compaction 뒤 소비 미관측, 주석·VERIFY), `resources`는 pass만(send가 만든 exec/ssh/plugin client 잔류 관측; "SSH hop 없음"은 관측, "잔류 미관측"은 pass 아님), `modelPolicy` pass = 보고된 이름·값 기록 + 못 본 effective 필드는 evidence에 unobserved. 판정기 보장 문구를 metadata + 참조 bytes 무결성으로 좁힘(새 측정인지는 리뷰·운영자 판단). `measuredAt`이 현재+5분보다 미래면 거절(QK `OPENCLAW-HOME-RECEIPT-NOT-FUTURE`).
    - SOL 3차 재리뷰(391a5500, `/tmp/ff08d4-next/review-s65c-sol.md` sha 1340d5c8…): Blocker 0 / Defect 0 / Observation 0.
  - [x] **S6.5 PARTIAL-c (candidate 391a5500).** 2026-11-15 03:04–03:48Z, HEAD 동결, 그룹마다 1회, 실패·재시도 0. 6그룹 모두 passed, control ok, treeClean·porcelainClean, 모든 receipt의 candidate.head·seal.headAfter = 391a5500, claimCount 1583. 158/158 KILLED: `check-openclaw-beside` 29/29, `check-fresh-cut-gate` 5/5, `check-harness-admission-parity` 7/7, `check-release-gate-outcomes` 21/21, `check-install-surface` 44/44, `check-gate-manifests` 52/52. receipt `/tmp/ff08d4-next/partial-c/<group>.json`(oracle 로컬, ff08d4가 직접 읽어 확인). PARTIAL은 FULL 통과가 아니다. frozen FULL·LIVE·exact-SHA CI는 따로 닫는다.
  - [ ] **S6.4 lab LIVE (thinkpad, 별도 GLG 승인).** 최소 증거 후보: 고정 key의 실제 run이 편지를 소비하고 집의 garden으로 답한다. 다른 세션이 즉시 아는지, memory 파일에 무엇이 남는지는 OpenClaw 소유의 탐색 측정(n=1)으로 분리하고 계약으로 강제하지 않는다. 자원 반납은 send 요청의 PID·parent·group을 묶어 종료 뒤 잔류를 확인한다. 범위는 새로 만든 exec/ssh/plugin client뿐이고, Gateway·vendor pool 같은 집주인의 상주 자원은 누수가 아니다. runner PARTIAL은 deadline 분류의 증거이지 프로세스 소멸 증거가 아니다.
    - consume 행 관찰 열 추가(agent-config 6f5c09 lead, 2026-11-15): 주입된 user entry의 provenance kind, senderIsOwner, sender 필드, 그리고 그 run의 답이나 memory가 발신자를 GLG로 혼동하는지(n=1, 판정 없음). S4에서는 provenance가 `external_user`/`cli`였고 발신자 표식이 없었다(:132). native-push 본문에 untrusted 안내가 없는 것은 #160만이 아니라 native-push 공통 질문이다.
    - 8216f4 장수성 조사에서 남은 lab 후보: 첫 줄 `/reset` 편지가 책상을 reset하는지, `resetByType` 읽기.
  - **봇의 연속성 증거 (GLG 2026-11-15):** "내 봇들은 memory에 기록 남기고 커밋푸시하는게 운영룰이야. 이런것은 운영룰로 잡아낼수 있어. 봇들은 세션의 기록보다는 그 몸(workspace-xxx)에 쌓인 기록이 증거야." 그래서 compaction이나 모델 전환으로 세션 맥락을 잃는 위험(8216f4 장수성 조사 `/tmp/ff08d4-next/s6-desk-longevity.md`, 0829a5be…)은 entwurf 코드가 아니라 봇 운영룰(memory 기록과 commit·push)이 맡는다. entwurf는 세션 transcript를 연속성 증거로 삼지 않는다. 장수성 조사에서 남은 lab 후보: 첫 줄 `/reset` 편지가 책상을 reset하는지, 운영 `resetByType` 값, 책상 생성 시 spawnedBy나 parent를 붙이지 않을 것(pinnable 조건).
  - **주소록 (agent-config 6f5c09 판단, 2026-11-15 11:51, 실행 없음):** 위치는 전역 `entwurf-peek`의 "봇 집 주소 찾기" 절이고, 목록은 companion `skills/entwurf-peek/references/bot-homes.md`에 둔다. 첫 설치 결과를 넘겨받을 때만 작성한다. 인계 흐름은 nixos-config가 설치·pin·선언·birth를 끝낸 직후 집 이름·garden·도달 영역·관측 시각·receipt 줄을 넘기고, agent-config가 record와 대조해 기록하는 것이다. 안내 한 줄은 SKILL.md의 첫 수와 description 트리거에 넣는다.
  - **출하 전 reader 하나 더 (Rule 7):** agent-config `entwurf-peek.py:1102-1104`의 V3 backend enum mirror에 openclaw가 없다[6f5c09 직접 읽음]. 운영에 첫 openclaw record를 넣기 전에 갱신해야 한다. 출하 직전 contract와 source SHA, 설치 예정 시점을 6f5c09에게 알린다.
  - **#151 경계:** #160은 "같은 key가 유지되는 동안 주소가 연속되고, 경계가 깨지면 refuse한다"까지만 맡는다. 여러 기록의 lineage는 #151 몫이다.
  - 이후: GLG 결정 → S6.4 → oracle 판단(S5.6~S5.8 재개).

- [ ] **S7. #163 ACP steer 대칭 (이 브랜치에서).** GLG 2026-11-15: "이건 대칭이 아닌 문제라 해결해야하니까", "근야 이브랜치에서 구현하자. 지금 dist 구조 바뀌어서 브랜치 바꾸면 연결 끊길수도 있으니까. … 이건 UX 상으로 매우 중요하다." 목표는 busy ACP receiver에도 remote `mode=steer`가 backend의 단계 경계에서 들어가게 해서, steer의 뜻을 모든 control-socket receiver에서 같게 만드는 것이다. ENTWURF.json에 ACP 전용 문구는 넣지 않는다. stop은 별개 동사이고 범위 밖이다(#163 11-14 결정 유지). 기록: #163 issuecomment-6887743866(측정), 6887769373(결정).
  - [x] **S7.0 ACP 측정 (n=1).** STEER-PROBE-21b4c2, receiver ee14c7: steer와 follow_up 모두 6개 도구 경계를 넘지 못했고, prompt가 끝난 뒤 송신 순서대로 각자 한 턴씩 들어왔다(`/tmp/ff08d4-next/steer-probe/RESULT.md`, oracle 로컬; 결정적인 줄은 #163 댓글에 있다).
  - [x] **S7.1 native Pi 기준선 (n=1).** receiver SOL(a30dda). steer는 첫 도구 경계(tick 1 직후)에 들어왔고, follow_up은 prompt가 끝난 뒤에 들어왔다. 비대칭이 양쪽 측정으로 닫혔다(#163 issuecomment-6887813050).
  - [x] **S7.2 정적 판독 + adapter 측정.** 1eed2c. 판독: `/tmp/ff08d4-next/issue163-design-read.md`(fba8342b…). 측정은 GLG 승인 LIVE 예외였고, adapter를 직접 구동했으며 ~/.claude/projects에 transcript 3개가 남았다(지우지 않음). 결과: `issue163-adapter-probe.md`(6f8c3217…). claude-agent-acp 0.107.0은 steering supported이다. 도구 사이에 보내면 `injected`이고 모델이 다음 도구 직전에 본다. foreground sleep 중에 보내면 `injected`이지만 도구는 끝까지 돌고, 끝난 뒤에 본다(stop 아님). idle이면 `promptRequired`이고 아무것도 시작하지 않는다. 방향 A의 전제가 성립한다. 우리 쪽 빈칸은 다섯이다: capability 읽기, steer 요청 경로, control→ACP seam, 이중 전달 정책, receipt 값. 가장 큰 함정은 주입한 steer를 Pi transcript에 user 메시지로 남기면 다음 delta가 깨지는 것이다(context.ts:169-184). 그래서 문맥 밖 기록으로 남긴다.
  - [x] **S7.3 설계 (1eed2c, /tmp/ff08d4-next/s7-design.md) → SOL 리뷰.** 닫힘: v2.1(sha 094e22f3…)이 정본이다. SOL 재리뷰 `review-s7-design-sol-b.md`(6bddd592…) F1을 ff08d4가 반영했다. SOL 1차(41afdb8, `review-s7-design-sol.md` sha 2eb264ae…): Blocker 1 / Defect 2 / Observation 2. B1 await 앞뒤 binding·garden·closing·idle 재검사, D1 fallback 분리(no-send·promptRequired만 재큐, injected·모호는 재큐 0, at-most-one), D2 "interrupt 아님" 문구를 cancel/stop과 backend 선점으로 구분. (a) transcript 밖 기록은 SDK projection으로 확인됨. → 1eed2c가 설계 v2 작성 중, 뒤이어 SOL 짧은 재리뷰. 작업 트리에는 쓰지 않는다. 새 receipt 값의 이름과 ENTWURF.json 열거 갱신은 GLG가 운영 코디와 마무리할 때 함께 정한다(GLG 2026-11-15).
  - [x] **S7.4 구현 (ee14c7) → 리뷰 → PARTIAL.** **순서(GLG 2026-11-15): "앞서 하던것 마무리 되고 검증 되면 이걸 진행하자."** S6.5가 재리뷰와 affected PARTIAL까지 통과한 뒤에 시작한다(조건 충족: S6.5 PARTIAL-c green, 391a5500). 작업 트리에 쓰는 형제는 한 번에 하나로 둔다.
    - **ee14c7 checkpoint 네 개(baseline e0c639f6, push·build 없음).**
      1. `5b3eb121` acp-client `requestAcpSteer`: 늘 `idleBehavior:"promptRequired"`, 5 s 상한, 늦은 답과 늦은 reject는 무시.
      2. `2951083b` backend: capability 읽기, prompt마다 owner-checked steer window, `ACP_STEER_SEAM`(`Symbol.for("entwurf.acp.steer.v1")`, 다른 객체는 `acp-steer-seam-duplicate`).
      3. `14db2928` `lib/control-steer.ts` `deliverControlSend`로 send 판정 추출(코디 승인). 결정표는 v2.1 그대로이고, 임시 receipt 두 값 `steer-in-turn`·`steer-unknown`을 쓴다. 기록은 plain entry `entwurf-steer-in-turn`이다.
      4. `115cc426` 문서: rail §11-9 채택으로 다시 씀, DELIVERY acceptance 표 임시 두 행 + probe 측정 단락, 이 기록. 뒤이어 seam reload 좁은 예외 커밋.
    - 새 실행 좌표 `check-acp-steer`(lane `acp-steer` 14 → 리뷰 수선 뒤 16). `control-send-receipt` lane은 +10(build-bridge 선언 동일)으로 33. QK와 mutant는 1:1이고, 새 mutant는 전부 손으로 kill해 각자 QK에 귀속을 확인했다.
    - 추출 때문에 기존 원문 모양 검사 둘(`SEND-RECEIVER-EMITS-BOUNDARY` @check-entwurf-v2-surface, `COMPACT-SEND-WIRE` @check-compaction-send-guard)과 그 mutant의 subject를 control-steer.ts로 옮겼다. 그래서 affected PARTIAL에 이 두 그룹이 더해진다.
    - `entwurf-control.test.ts`는 기존 compiled bridge로 돌아 green이지만, 새 send 판정을 거치지 않는다. build 금지라 다시 build하지 않았다.
    - **마무리 묶음으로 넘김:** 최종 receipt 이름, ENTWURF.json 열거("those four")와 `mode` 문구(SEND-PROSE-NO-INTERRUPT 축), check-entwurf-v2-surface의 그 문구 검사. sender 쪽 진단 표시는 리뷰 수선(아래)에서 들어왔다.
    - **출하 정지선 (1eed2c O2, ff08d4 2026-11-15):** 이 마무리 묶음이 들어오기 전에는 merge도 release도 하지 않는다. 지금 receiver는 임시 값 둘을 만들고 ACP 경로는 생성을 끊을 수 있는데, caller가 읽는 ENTWURF.json은 아직 "those four"와 "NEITHER is an interrupt"를 말한다.
    - **이연:** entry renderer, 로컬 TUI steer(§6), 생성 중 선점 LIVE cell.
    - **seam reload (ff08d4 결정 2026-11-15, 좁은 예외):** 옛 seam이 `hasOpenWindow()`로 열린 window가 없다고 답할 때만 다른 객체로 교체한다. 바쁘거나 모양이 깨졌거나 답하다 throw하면 예전처럼 `acp-steer-seam-duplicate`로 throw한다. QK는 `ACP-STEER-SEAM-RELOAD-IDLE-REPLACES`와 `-BUSY-REFUSED` 둘이고, `-DUPLICATE-REFUSED`는 깨진 옛 값 쪽으로 좁혔다. lane `acp-steer`는 14가 됐다. 실제 pi `/reload` 경로는 측정하지 않았다.
    - **리뷰 수선 묶음 (SOL `review-s7-impl-sol.md` 25fb9943…, 1eed2c `review-s7-impl-1eed2c.md` beee5c14…, probe 2 `issue163-adapter-probe-2.md` 5ab8cdaa…):**
      - A. steer 응답 상한 5 s → 1 s(측정 n=24, 최대 4.3 ms). sender RPC 기본값은 `CONTROL_RPC_DEFAULT_TIMEOUT_MS`(5 s)로 이름을 붙였고 값은 그대로다. `상한 + 2 s ≤ sender`를 `[QK:ACP-STEER-BOUND-BELOW-SENDER]`가 sender 상수와 직접 비교한다.
      - B. receiver가 `steer-*` 옆에 말한 것(unknown 이유와 detail, record 실패와 생략)이 caller 줄까지 간다. wire seam에서 닫힌 token과 한 줄(본문 120자 + 생략부호 = 최대 121 UTF-16 단위)로 정규화하고, 성공은 그대로 성공이다. `[QK:SEND-STEER-DIAGNOSTIC-REACHES-SURFACE]`는 생산 factory → control hand → surface 경로를 SOL probe의 세 wire 답으로 확인한다.
      - C. 이유 이름: JSON-RPC 오류 등 열린 연결에서의 실패는 `request-rejected`, seam throw는 `seam-threw`, `connection-closed`는 연결이 실제로 닫혔을 때만 쓴다(`isClosed` = SDK `signal.aborted`). QK `ACP-STEER-FAILURE-NAMED-BY-CONNECTION`, `CONTROL-STEER-SEAM-THREW-NAMED`.
      - D. `ACP-STEER-SEAM-DUPLICATE-REFUSED` mutant를 실제 덮어쓰기(깨진 옛 값 위에 새 seam을 쓰고 return)로 바꿨다. `CONTROL-STEER-AFTER-AWAIT-IDLE`는 제목을 실제 위험(틀린 옵션과 queued-steer receipt)으로 좁혔다. SOL O2로 BOUND에 context-only와 native-id-only 변화 사례를 더했다.
      - 기존 mutant 넷(SEND-BOUNDARY-CARRIED, SEND-FALLBACK-KEEPS-BOUNDARY, SEND-SURFACE-RENDERS-BOUNDARY, V2PROD-INBAND-ERROR-WIRED)은 같은 줄이 바뀌어 find만 새 줄로 옮겼다. 결함은 같다.
      - lane: `acp-steer` 16, `control-send-receipt` 35. 새 mutant와 옮긴 mutant는 모두 손으로 kill했고, 자기 QK에서 실패했다.
      - 문서: rail §11-9에 probe 2를 넣었다(생성 중 측정, burst, 권한 대기; thinking 중과 생성 중 burst는 미측정). DELIVERY 두 행에 증거 수준을 붙였다.
    - **재리뷰 (965ba297):** SOL `review-s7-impl-sol-b.md` 1aa3d3b9… B0/D0/O3, 1eed2c `review-s7-impl-1eed2c-b.md` 594d3768… B0/D0/O4. Observation(timeout 고정 지점을 production send 호출에도, rail n 표기 n=2·n=1, detail 상한 121자 문구, wire→surface fixture를 실제 executeDispatch로)은 S8 묶음에서 함께 닫는다. lock-dirty에서 부가 진단이 사라지는 것은 현 범위로 수용.
    - **S7 PARTIAL (candidate 965ba297).** 2026-11-15 05:58–06:08Z, HEAD 동결, 그룹마다 1회, 실패·재시도 0. 6그룹 모두 passed, control ok, treeClean·porcelainClean, candidate.head·seal.headAfter = 965ba297, claimCount 1611. 72/72 KILLED: `check-acp-steer` 16/16, `check-control-send-receipt` 19/19, `check-entwurf-v2-surface` 20/20, `check-compaction-send-guard` 7/7, `check-entwurf-v2-send` 5/5, `check-entwurf-v2-production` 5/5. receipt `/tmp/ff08d4-next/partial-s7/<group>.json`(oracle 로컬, ff08d4가 직접 읽음). PARTIAL은 FULL 통과가 아니고, 출하 정지선은 그대로다.

# NOW

- **현재 HEAD:** S5.5b 기록 커밋(NEXT만). 코드 후보는 `f13c3e99`(PARTIAL-b 통과, 운영 dist도 이 코드로 build됨 [상속: ff08d4]). push 안 함. 이 checkout은 oracle 운영 설치이기도 하고, 운영 dist는 ff08d4가 clean tree에서만 build한다.
- **금지 (GLG가 창을 정하기 전까지):** `pnpm run build-bridge`, `check-pack`, `check:full`, prepack을 일으키는 모든 것 — pi-durable 68bd94·145c2f가 dist로 돌고 있다. oracle store에 openclaw birth 금지. push 금지. `META_CITIZEN_BACKENDS`·`pi/entwurf-capabilities.json` 편집은 checkout src로 도는 bridge 전부를 throw시킨다(flip 경계, 아래 기록).
- **운영 전제 정정:** 옛 "운영 10.9 / 8b18b55" 전제는 낡았다. 운영 버전 SSOT는 nixos-config `ORACLE.md`의 LIVE 줄 하나다 [read ORACLE.md:140, 2026-11-14]: OpenClaw **2026.11.3** · `847611d` · image `openclaw-custom:11.3-candidate-20261113`. 컨테이너 node v24.22.1 / sqlite 3.53.4 [상속: 8216f4 s5-ops-facts]. 따라서 "운영을 11.3으로 맞추는 일"은 이미 끝났다.
- **경로 축 정정:** 옛 S5 줄의 "컨테이너 경로와 host 경로가 다르다"는 부분만 맞다. `~/repos/gh`, `~/.pi/agent`, `~/org`는 host와 같은 절대경로로도 마운트되어 있다 [측정 `docker inspect openclaw-gateway` Mounts, 2026-11-14]. 다른 것은 봇 workspace의 컨테이너 경로뿐이고, birth `--cwd`는 운영자 명시값(host 절대경로)으로 둔다. record cwd는 send envelope 표시에만 쓰인다.
- **Tier 1/2 측정 (8216f4, 운영 컨테이너, 읽기 전용):** 컨테이너 CLI에 `--expect-url` 있음. 선언 url `ws://127.0.0.1:18789`로 `sessions.describe` 없는 key → `{"session":null}` rc0 1.56s, 틀린 url → rc1 "Gateway destination changed", state 쓰기 0 [상속: `/tmp/ff08d4-next/s5-f0-tier2.md` sha a6f5853c…, oracle 로컬]. A1(수신 = docker exec shim) 성립.
- **다음 한 행동 (2026-11-15 15:10 KST):** S7.4는 PARTIAL green(965ba297)이다. 다음은 S8(ACP 컴팩트 정보 갭, GLG 2026-11-15 "pi 수동 컴팩트와 동일한 수준로서 정보의 갭은 없길", ACP만): ee14c7 설계 v3(`/tmp/ff08d4-next/s8-design.md`) → 운영 코디 68bd94·Fable 8200c5 리뷰(GLG 지정) → 구현 → PARTIAL. S7 Observation도 S8 묶음에서 닫는다. 출하는 마무리 묶음 뒤다(정지선 위). 운영 dist rebuild 여부는 GLG가 정한다. FULL·push·birth 금지는 유지한다.
- **역할 (2026-11-14):** 코디 = `20261113T043350-ff08d4`(Claude Code, oracle). 구현 = `20261114T193422-ee14c7`(이 문서의 writer). 운영 실행 = nixos-config 운영 담당(garden id는 코디가 앎). 운영 코디 68bd94, thinkpad 코디 b22677, thinkpad 검수 9fc008. 보고는 모두 ff08d4로. 커밋은 commit 스킬, push는 GLG.

# S5 결정 (GLG 2026-11-14, ff08d4 중계) — 공개 정책: #160 issuecomment-6876392683

- **책상 모델:** 봇당 명시 key 책상 하나(첫 책상은 agent `main`), pin, compaction·`/reset` 뒤에도 같은 garden. 삭제한 책상 이름은 재사용하지 않는다. 책상 열기·닫기는 운영자 행위 하나씩, 자동 birth 없음. 확장(다른 봇, 다중 책상, 채널 key)은 보류. GLG 원문: "어차피 workspace-xxx가 봇의 집이기 때문에 누가 답변하든 상관없다." garden id는 대화 주소(책상)이고 답하는 주체는 봇의 집 전체다.
- **수신 1b:** 선언의 gateway 항목에 `bin` 절대경로, 그 경로는 PATH 밖의 docker exec shim(nixos-config home-manager 소유). bare `openclaw` shim은 두지 않는다(host에서 `which openclaw` 실패가 안전장치).
- **송신 2a:** 컨테이너 → host SSH, forced command + restrict, 새 키페어(GLG: "오가는 길은 닦아놓자"). 신뢰: A(기존 rw mount)와 B(새 키: host user로 고정 entry와 decider 실행, native-push·pi socket·mailbox를 움직임, 임의 shell 아님)를 나눠 적는다. stdin claim의 sender는 scope 안 자기 신고다. 계획은 운영 측(8216f4) 소유.
- **플러그인 3a:** 병합 뒤 미러 경로를 `--link`. hot reload는 미측정(lab `--link`는 "Saved for the next Gateway start").
- **`~/.pi/agent` rw 유지 (4a).** 컨테이너는 meta-store writer가 아니다(store 쓰기는 모두 host entry). 컨테이너가 mailbox·record에 직접 쓰는 안은 Rule 7 위반으로 금지.
- **F0:** Tier 1·2 완료(위 NOW).
- 카드 원문(oracle 로컬): `/tmp/ff08d4-next/s5-card.md`, `/tmp/ff08d4-next/s5-identity-card.md`.

# 기록 — S1–S4 RAIL 원문과 thinkpad NOW (2026-11-13, 보존)

## 옛 RAIL

- [x] **S0. 레일.** 브랜치·이 문서·팀 구성. GLG 결정 2026-11-13 thinkpad.
- [x] **S1. 측정 (11.3).** M0–M5를 완료하고 9fc008이 영수증을 샘플 검수했다. 10.10은 M0와 무로그인 범위까지만 재고 일시정지했다. 원 영수증: `~/.local/share/entwurf-lab/160/openclaw-2026.11.3/receipts/`(51개).
  - M1: 플러그인 도구 ctx가 팩토리와 execute 모두에서 agentId·sessionKey·sessionId를 받는다. 따라서 sender join은 (agentId, sessionKey)로 할 수 있다.
  - M4: stdio `mcp.servers`에는 `_meta`·세션 식별자·OPENCLAW env가 0이고, 런마다 새 프로세스가 뜬다. MCP 경로로는 sender join이 불가하다.
  - M2: busy일 때 `steerActiveRun`은 steered:true, idle일 때 `enqueueNextTurnInjection`은 모델이 소비했다. 둘 다 hidden internal_system이므로 발신자 표식은 본문에 실어야 한다.
  - M3: reset은 sessionId를 유지한다(세대 식별자는 lifecycleRevision이고 ctx에는 없다). `session_start`는 생성 시 발화하지 않는다. 종료 시에는 `gateway_stop` 뒤 session_end(shutdown)가 온다.
  - M5: 첫 ack는 messageSeq를 포함하고, dedupe ack는 `status:"ok"`에 messageSeq가 없다. conflict는 `chat-request-conflict`다.
  - 제약: `mcp set`은 Gateway가 오프라인일 때만 가능하다. 기본 codex 런타임은 사용할 수 없다. 플러그인 설치에는 2단 동의 게이트가 있다.
- [x] **S2. 결정 카드.** 4184c5가 작성했고 9fc008이 영수증을 확인했다. GLG가 7절 1–5를 권고대로 승인했고, 6은 oracle 측정으로 닫았다(2026-11-13).
- [x] **S3. 구현.** 0c9e3a가 구현했다(0b74e38 flip 이전 + flip 커밋). 4184c5 교차 리뷰 Blocker 0, Defect 3은 반영했다.
- [~] **S4. LIVE.** ← CURRENT (부분 완료): 왕복, busy steer, reset 뒤 같은 garden id, fresh (c)(d)는 측정했다. 남은 것: (a) 표시면 확정, (b) `--width agent-policy`, TUI 바인딩 증명(vendor가 목적지를 읽어 주는 명령).
- [ ] **S5. 오라클 Docker.** 별도 단계로, 운영을 11.3으로 맞추는 일과 함께 한다. S4 전에는 손대지 않는다(운영 10.9 / 8b18b55). 수신 CLI는 `docker exec openclaw-gateway openclaw …` 후보다. **경로 축 [파일 openclaw-config/docker-compose.yml:89,103,111]:** 컨테이너 안의 절대경로(`/home/node/.openclaw/workspace`, `/home/node/repos/gh`)는 host의 경로(`~/openclaw/config`, `~/repos/gh`)와 다르다. birth의 cwd는 "운영자 명시값 또는 OpenClaw 응답값 그대로, 추측·fallback 없음"으로 한다(GLG 2026-11-13). S5에서는 (1) 안팎 경로를 같게 마운트할지, (2) record에 컨테이너 경로임을 표시할지를 측정한 뒤 정한다.

## 옛 NOW

- **Oracle 인계 (2026-11-13):** 이 브랜치 체크포인트는 미완성이며 main 병합·출하 승인이 아니다. Oracle에서 #160 최신 댓글과 이 문서를 읽고, 먼저 11.3 격리 lab에서 fresh의 TUI Gateway 바인딩·지속 garden-id 표시·model/agent-policy 폭을 증명할 최소 측정을 설계한다. 운영 Docker/봇 S5, 운영 설정·자격증명, LIVE 및 발송은 별도 승인 전 건드리지 않는다. 동일 key에 TUI만 붙이는 것은 fresh가 아니다.
- **검증 영수증 (thinkpad 이전 후보, HEAD 5ff91bd + 미커밋 diff):** PARTIAL 네 그룹 `check-tests-beside-behavior`, `check-entwurf-v2-production`, `check-entwurf-v2-contract`, `check-install-surface` exit 0 (`~/.local/share/entwurf-lab/160/partial/`; 각 receipt의 candidate가 권위). FULL `pnpm run check:full`은 96초 exit 1: `check-harness-admission-parity`의 `Unaccounted: openclaw`에서 중단; 뒤 contract 71개·hermetic 64개·package 10개는 그 FULL에서 미실행이다. start/end diff SHA256 `fc440e7296c7465f30c99694e1dfca7d09eb520286c4a77b9845355025619e9a` 일치는 양 끝 관측이지 실행 중 불변 전체의 증명은 아니다. 원본 `~/.local/share/entwurf-lab/160/full/`은 thinkpad 로컬이며 Oracle에 자동 전달되지 않는다. PARTIAL은 FULL 통과가 아니다. 최종 후보에서 리뷰·해당 PARTIAL·frozen FULL·LIVE 및 exact-SHA CI를 별도로 닫는다.
- **11.3 vendor 소스 판독 (Terra, 2026-11-13):** `dist/gateway-chat-Bfy_PuNc.mjs:542-577`의 TUI는 active local lock port를 `localPortOverride`로 적용할 수 있으나 `dist/status.scan.shared-By8BQ_gH.mjs:65-68`의 status는 이를 넘기지 않는다. 따라서 status URL만으로 TUI 바인딩을 증명하지 않는다. `dist/tui-DkdwhZg2.mjs:7084-7089,7251-7258`의 헤더는 실제 client URL/선택 key를, footer는 key/displayName을 그린다. S4 raw에서 label은 턴 뒤 표시되고 `/new` 뒤 사라졌다. 첫 렌더·재접속·reset·`/session`·잘림 및 자동 fence는 미측정. `docs/web/tui.md:347`에서 명시 `--url`은 설정 credential fallback을 끊으므로 단순 강제 대안이 아니다. 설치된 파일의 `dist` 경로는 `~/.local/share/entwurf-lab/160/openclaw-2026.11.3/prefix/node_modules/openclaw/` 아래다.
- **브랜치 상태 — 아직 완성된 브랜치가 아니다 (GLG 2026-11-13).** origin `160-openclaw`에 push했지만 main 병합·release 후보가 아니다. 병합 전에 닫아야 할 것:
  1. **fresh 미완:** (a) garden-id 표시면, (b) agent-policy 폭, TUI Gateway 바인딩 증명. 이것이 닫히기 전에는 fresh preflight가 production에서 계속 거절한다.
  2. **이름 붙은 RED 1개:** `check-harness-admission-parity`(openclaw가 FRESH_CALL 밖, GLG: 그냥 둠). install-surface S2·S9는 마무리 라운드에서 닫았다(0c9e3a, 4184c5 리뷰 Blocker 0·Defect 0, 2026-11-13).
  3. **merge 직전 문구 묶음 [4184c5 리뷰]:** (a) "#160, BRANCH candidate" 문구 4곳(ENTWURF-CLI.json 2곳 + check-install-surface.ts 리터럴 2곳)을 한 번에 고친다. O1: birth `--cwd`는 absolute + normalized이고 디렉터리 존재는 확인하지 않는다(`openclaw-birth.ts:63`). O2: send exit 3은 레코드 0개일 때만이고, 중복 native id는 exit 1이다(`scripts/openclaw-send.ts:83-86`). O3: S9h `ok()` 라벨과 948-950행 주석이 #153 이후 낡았다.
  4. **qualification:** 위 네 그룹의 이전 후보 PARTIAL 영수증을 보존한다. 변경된 gate/mutant/matrix의 정확한 영향을 최종 후보에서 다시 대조하고, 필요 그룹의 PARTIAL은 리뷰·amendment 뒤 실행한다. archived 단언(`openclaw-gateway.test.ts:100`)의 QK/exact-once mutant는 final candidate 전에 필요하다(4184c5 판단 b).
  5. **frozen FULL과 exact-SHA CI**는 그다음이다(AGENTS Scheduling).
  6. **S5 오라클 Docker**(11.3 정렬, 컨테이너 경로 축, `docker exec` shim)는 별도 단계다.
- **다음 한 행동:** Oracle에서 별도 격리 lab의 버전·경로와 승인 범위를 확인하고 fresh (a)(b) 및 TUI 바인딩의 첫 측정 하나를 정한다. 목적지 표시는 preflight fence가 아니며 sandbox 설명은 전체 tool 권한 증거가 아니다. 이후 구현·리뷰·검증은 해당 작업의 코디가 배치한다. main 병합·출하·운영 작업은 GLG가 따로 정한다.
- **보존 중인 LIVE 산물:** `~/.pi/agent/openclaw-citizens.json`(0600, scope `lab-a`)과 record `20261113T164129-222657`. host PATH에 `openclaw`가 없으므로 지금 이 시민으로 보내면 probe가 indeterminate다. 정리할지는 GLG가 정한다.
- **역할:** 실무 코디 = `20261015T085719-9fc008`(Claude Code). 운영 코디 = `20261007T132839-b22677`(pi-durable, 단계 전환마다 짧게 보고). S1 Sonnet 2 — 10.10 = `20261113T120646-e9a750`, 11.3 = `20261113T120652-6cc29a`(콜백 nonce 일치). S3 구현은 별도 Opus 형제가 맡는다(GLG: 실무 코디는 구현하지 않는다). S2 설계 Opus = `20261113T143538-4184c5`(콜백 nonce 일치, S3 교차 리뷰 예정). S3 구현 Opus = `20261113T145250-0c9e3a`(콜백 nonce 일치). 10.10 Sonnet은 종료됐다. 커밋·push는 GLG.
- **flip 경계 [측정 0c9e3a, meta-session.ts:772-777,808-812,850-851]:** 이 체크아웃의 소스로 직접 도는 bridge가 여럿이다(운영 코디와 실무 코디 포함). registry는 호출할 때마다 다시 읽고 backend 집합과 정확히 같아야 하므로, `META_CITIZEN_BACKENDS`나 `pi/entwurf-capabilities.json`을 편집하는 순간 그 bridge들의 entwurf_v2가 전부 거절된다(adding-a-harness.md:177-184의 omp 사건과 같은 모양). 그래서 이 편집은 마지막 flip 한 번으로 묶고, FRESH_CALL_BACKENDS 편입과 같은 묶음으로 만들어 parity RED 구간을 없앤다. flip은 GLG가 재시작 창을 정한 뒤에 한다. 카드와 다르게 승인한 것: wakeMode `direct-inject`, deliveryLevel `D0`, 송신 입구 이름 `openclaw-send`.
- **release stop [4184c5 O5]:** flip에서 `FRESH_CALL_BACKENDS += openclaw`가 되면 parity 게이트는 green이 된다. 하지만 fresh preflight가 (a)로 닫혀 있는 동안에는 "열리지 않는 backend가 표면에 광고되는" 상태다(#87 모양, adding-a-harness.md:728-732). parity green을 admission으로 읽지 않는다. S4 (a)–(d)가 닫히기 전에는 release·main 병합을 하지 않는다.
- **S3 리뷰 (4184c5, 15:14):** Blocker 0, Defect 3(D1 TUI Gateway 바인딩, D2 플러그인 timeout < entry 최악 경로, D3 fresh key 부재 미실행), Observation 9. D1–D3과 O2·O6·O7·O8·O9를 0c9e3a의 amendment 한 묶음에 넣었다. O3(session:null과 visibility 숨김 구분, archived)은 S4 측정 항목이다.
- **flip 적용 (2026-11-13 16:32, 0c9e3a, 미커밋):** `s3-flip.patch`(f08506cc…)를 0b74e38 위에 적용했고, 창 안에서 두 가지를 고쳤다(birth 포맷, roundtrip fixture의 sender marker). 보고서 원문: `~/.local/share/entwurf-lab/160/flip-report.md`, raw는 `flip-raw/`.
  - green: tsc 4펜스, biome, check-meta-session, entwurf-capabilities, meta-capability-source, native-push-adapter, v2-contract, v2-production, fresh-call-surfaces, tests-beside-behavior(1135), roundtrip 4/4.
  - **이름 붙은 브랜치 RED (S4까지 유지, merge 전 패키징+리뷰 번들에서 닫는다):** ① `check-harness-admission-parity` openclaw(GLG: 그냥 둠). ② `check-install-surface` S2: openclaw-send·birth가 build emit·check-pack 목록에 없음. ③ 같은 게이트 S9a*/S9b/S9h: help-all 바이트 고정과 reviewed case 고정을 옮기는 일은 리뷰가 필요한 amendment다. ④ `check-capability-bundle-reach` B3: build-bridge를 하지 않아 dist registry가 이전 값이다.
  - build-bridge·하네스 재설치·PARTIAL은 하지 않았다. S4는 checkout의 소스 bridge와 run_ts로 진행한다.
- **S4 LIVE (2026-11-13 16:42–16:49, 0c9e3a + 9fc008, 11.3 lab, named LIVE: 실제 store·mailbox) — 왕복 성공.** raw: `~/.local/share/entwurf-lab/160/s4-raw/`.
  - 준비: S4-0 roll-forward를 green으로 마쳤다(build-bridge로 B3가 닫혔고, Claude Code·copilot·omp×2·codex-birth를 재설치했으며 doctor는 PASS). 측정 동안 임시 shim `~/.local/bin/openclaw`(sha `cda65ef6…`)를 두었다가 제거했다(`which` exit 1). 선언 `~/.pi/agent/openclaw-citizens.json`(scope `lab-a`)과 record `20261113T164129-222657`(`openclaw:lab-a:agent:main:s4live`)은 보존했다. birth는 create 뒤 attach로 멱등이었다.
  - ①② 9fc008 → openclaw: `native-push → delivered`. openclaw → 9fc008: inbox에 `from: meta-session/openclaw`, `session 20261113T164129-222657 (replyable)`, `S4-ACK N160-7f3a91`가 들어왔다. 수신 행은 provenance `external_user`, client `cli`였고, idle이었으므로 새 턴이 시작됐다. 플러그인 도구는 code-mode catalog(`exec`)를 거쳐 호출됐다.
  - busy steer: 진행 중인 run `s4-busy-essay-1` 안에서 소비됐다(같은 runId의 tool call). `S4-BUSY-ACK`가 도착했다.
  - reset: sessionId는 그대로이고 lifecycleRevision만 바뀌었다. 같은 garden id로 `S4-RESET-ACK`가 도착했고, store 수는 변하지 않았다.
  - O3: 존재하지 않는 세션과 삭제된 세션이 모두 `session:null`이라 구분할 수 없다(경계). draft는 alive다. **archived는 describe가 alive를 주지만 chat.send에서 거절된다 → `classifyOpenclawDescribe`가 `archived:true`를 indeterminate(사유에 archived)로 분류하도록 고쳤다(9fc008 결정, 0c9e3a 2026-11-13, 5ff91bd에 커밋). 바로 옆 테스트 `openclaw-gateway.test.ts`.**
  - fresh: (c)는 측정했다(`tui --message`가 그 key의 첫 메시지가 됨). (d)는 측정했다(`/new`는 새 key로 전환하고 label이 사라짐). (a)는 부분 측정이다(`sessions.patch label`이 다음 턴 뒤 footer에 표시됨, 헤더에는 없음 — 후보). (b)는 측정하지 않았다. D1 n=1: 선언된 configPath로 lab Gateway에 붙었고, 잘못된 config는 연결을 거절했다. 다만 TUI에는 `--expect-url`이 없어서 `tuiBinding`은 unproven으로 둔다. 다음에 잴 것은 vendor CLI가 해석한 목적지를 읽는 명령이다(entwurf가 config 파일을 직접 읽는 방식은 기각, Rule 9).
  - 사고: 정지에 쓴 `pkill -f`가 측정자 셸까지 죽였다(Gateway는 정상 종료). 앞으로는 pid 파일로 정지한다.
- **보고 경로:** 형제 → 9fc008만 사용. 운영 코디와 #142 lane에 직접 보내지 않는다.

# 결정 (GLG 2026-11-13)

- 대상 버전: **2026.11.3 하나** (GLG 2026-11-13 갱신: 여러 버전을 고려하지 않는다. 운영도 S5에서 11.3으로 맞춘다). 처음에는 10.10과 11.3 둘이었다. 10.10 lane은 M0까지만 재고 종료했으며, 그 영수증은 `~/.local/share/entwurf-lab/160/openclaw-2026.10.10/receipts/`에 보존한다.
- 같은 날 갱신: 11.3을 먼저 끝까지 잰다(GLG는 11.x 이전을 유력하게 본다). 10.10 lane은 M0 이후 일시정지했고, 로그인하지 않았다.
- 두 lab 공통 [측정]: host node 24.18.1(SQLite 3.51.2)은 OpenClaw의 WAL 가드에 걸려 거부된다(engines는 24.x 허용과 불일치). lab에서는 Nix store의 nodejs-24.21.0(sqlite 3.53.3)을 쓴다. pnpm 11 ignored-builds는 `openclaw` 하나만 승인했다.
- 테스트 에이전트: OpenClaw 자체 GPT(openai-codex) 로그인, 모델 **luna**. 자격증명은 복사하지 않는다. 로그인은 GLG가 직접 한다.
- 구조: OpenClaw 쪽 플러그인은 `plugins/openclaw`(herdr 플러그인과 같은 결). entwurf 코어는 이름이 정해진 최소 diff만 받는다.
- 이름 메모: ROADMAP "Deprecated"의 옛 `plugins/openclaw`(2026-06, pi-shell-acp wrapper)는 다른 트랙이다. 착수 시 ROADMAP에 새 트랙임을 한 줄로 남긴다.

# S2 결정 카드 — OpenClaw 시민 (S2 설계 형제 작성, Claude Code, 2026-11-13 thinkpad, 미커밋)

읽는 법: **[측정]** = 영수증 있음(lab 경로는 `~/.local/share/entwurf-lab/160/openclaw-2026.11.3/receipts/`, 이하 `R/`), **[file:line]** = 소스·문서 판독, **[미측정]** = 열린 사실. 각 항목은 "사실" 상자와 "설계" 상자를 나눈다. 설계 상자는 제안이지 사실이 아니다. 이 카드는 S2 초안(remote-pair 차용)과 아래 운영 코디 검토를 흡수해 대체한다.

## 0. 이 카드가 S2 초안에서 바꾼 것 (먼저 읽을 것)

- **수신 doorbell을 플러그인 steer/next-turn에서 Gateway `chat.send {queueMode:"steer"}`로 바꾼다.** 근거: S1의 idle next-turn은 스스로 턴을 깨우지 않았다. `R/m2-nextturn-live.txt`는 enqueue 뒤 별도 `chat.send`("## normal turn")로 턴을 시작했고, 태그 문서도 "consuming an entry is not a receipt"이며 steer는 "does not automatically enqueue a later turn"이다(`docs/hooks/prompt-and-session.md`, `R/m2m3-doc-reading.txt`). 반면 이번 S2 측정에서 `chat.send queueMode:"steer"` 한 호출이 두 상태를 모두 덮었다 [측정 `R/s2-steer-live.txt`, `R/s2-steer-busy-live.txt`, 아래 4절].
- **플러그인 Gateway 메서드는 인증을 줄여 주지 않는다.** 그 메서드를 부르는 쪽도 operator scope 연결이 필요하다(echo-ctx 메서드가 `scope:"operator.write"`로 등록됨, `plugins/echo-ctx/dist/index.js`). 그리고 플러그인 안에서 다른 Gateway 메서드를 부르는 `api.runtime.gateway.request`는 "Calls from arbitrary external plugins are rejected" [태그문서 `docs/plugins/sdk-runtime/gateway-and-nodes.md` api.runtime.gateway]. 그래서 수신은 플러그인 밖, 코어의 native-push 어댑터가 맡는다.
- **선언 파일은 citizen 목록이 아니라 허용 범위(scope)다.** 고정 key와 fresh key 접두사를 함께 허용하고, 시민 여부는 V3 record가 정한다(1·2절).

## 1. 정체성과 birth

사실
- (agentId, sessionKey)는 플러그인 도구 ctx의 팩토리와 execute 양쪽에 채워진다 [측정 `R/m1-live-1.txt`: `{"agentId":"main","sessionKey":"agent:main:s1m1","sessionId":"2de2…"}`]. sessionKey 자체가 `agent:<agentId>:` 접두사를 갖는다 [측정 같은 줄].
- 세션 store는 Gateway state 루트 아래 에이전트별 SQLite다 (`state/agents/main/agent/openclaw-agent.sqlite`) [측정 `R/m5-rpc-1.txt` `"path"`]. `status`는 `runtimeVersion`만 주고 Gateway 인스턴스 id 같은 필드는 보이지 않았다 [측정 S2 `gateway call status`의 grep, 0건]. 따라서 key는 **한 Gateway state 루트 안에서만** 유일하다. 두 Gateway(예: lab 11.3과 oracle 컨테이너)는 둘 다 `agent:main:main`을 가질 수 있다 [추론, 미측정].
- `session_start`는 `sessions.create`에서 발화하지 않는다 [측정 M3]. birth를 훅에 걸 수 없다.
- record 쪽 계약: `nativeSessionId`는 store 전체에서 유일하고 writer는 store 전체를 certify한 뒤 쓴다 [AGENTS.md:37, `meta-session.ts:914-979`]. upsert는 nativeSessionId로 멱등이다 [`docs/adding-a-harness.md:223-224`].

설계
- **Gateway scope:** 운영자가 선언 파일에 Gateway마다 고정 라벨 `scope`(예: `lab-a`, `oracle`)를 적는다. 유일성 범위 = 그 scope 하나(= 한 Gateway state 루트). 라벨은 주소가 아니라 nativeSessionId의 namespace 성분일 뿐이다.
- **nativeSessionId = `openclaw:<scope>:<sessionKey>`** (예: `openclaw:lab-a:agent:main:s1m1`). 이 합성은 birth writer 한 곳에서만 하고, 송신 join과 수신 probe는 record에서 역으로 읽는다(record에서 sessionKey를 꺼내 쓰지, 선언에서 꺼내지 않는다).
- **단일 birth writer:** 코어 함수 하나 `birthOpenclawCitizen(decl, scope, sessionKey)`와 그것을 감싸는 entry 하나 `entwurf openclaw-birth --decl <abs> --scope <s> --session-key <k>`. 순서: 선언 범위 대조 → 해당 Gateway에 `sessions.describe {key}`로 존재 확인(`session:null`이면 거절) → `upsertMetaSession({backend:"openclaw", nativeSessionId, cwd: describe의 sessionRoot})`. 호출자는 둘뿐이다: 기존 고정 세션에 대한 운영자 실행, 그리고 fresh composition(2절). 플러그인·송신 entry는 record를 쓰지 않는다(첫 발화 시 lazy birth 없음 — 수신 대상이 되려면 말하기 전에 record가 있어야 한다).
- **재등록 멱등성:** 같은 (scope, sessionKey)를 다시 birth하면 upsert가 기존 garden id에 attach한다 [`meta-session.ts:1317-1348` 3-value merge]. 다른 garden id를 새로 찍지 않는다.
- **선언 파일의 지위:** `openclaw-citizens.json`(record store 옆, 0600, remote-pair처럼 매 호출 다시 읽고 캐시하지 않음). 내용은 `{version:1, gateways:[{scope, url, configPath?}], allow:[{scope, agentId, sessionKey}], freshKeyPrefix?: {scope, agentId, prefix}}`. **gardenId를 담지 않는다.** 선언은 "이 key는 시민이 될 수 있다"까지만 말하고, "이 key의 시민은 누구다"는 record만 말한다. 선언에서 빠진 key의 기존 record는 송신·수신 모두 범위 거절(데이터는 보존, Hard Rule 8).

## 2. "선언된 고정 세션만 시민"과 visible fresh (step 9)

사실
- `sessions.create`는 key·label·model을 받아 세션을 실제로 만든다 [측정 `R/m1-live-1.txt`: `modelOverride:"gpt-6-luna"`, `modelOverrideSource:"user"`; S2 `s2steer`도 같음]. label은 store 안에서 유일하게 claim된다 [태그문서 `docs/gateway/protocol/rpc-session-control.md:83`].
- TUI는 정확한 key로 열 수 있다: `openclaw tui --session <key>`, 첫 메시지 `--message <text>` [측정 `tui --help`]. 모델·권한 폭을 받는 TUI 인자는 없다 [측정 같은 help].
- TUI footer는 "agent + session + model …"을 늘 보인다 [태그문서 `docs/web/tui.md:57,70`]. footer에 label이 나오는지, 임의 문자열(garden id)을 띄울 표면이 있는지는 [미측정].
- tool 정책 같은 권한성 override는 `sessions.patch`에서 `operator.admin`이 필요하다 [태그문서 `rpc-session-control.md:65`].
- TUI 안의 `/new`·`/session`은 다른 key로 화면을 옮길 수 있다 [태그문서 `docs/web/tui.md` "Passing --session, /session, /new, or /reset remains explicit"]. `chat.send "/new"`는 같은 key의 sessionId·lifecycleRevision을 바꾸지 않았다 [측정 `R/m3-new-live.txt`] — 이 경로에서 `/new`가 무엇을 했는지는 [미측정].

설계 — 관계 정리
- 고정 세션과 fresh는 같은 규칙 하나로 묶는다: **시민 = V3 record가 있고, 그 key가 선언 범위 안에 있다.** 범위는 고정 key 목록(`allow`)과 fresh 전용 접두사(`freshKeyPrefix`, 예: `agent:main:entwurf-`) 두 형태다. fresh launcher는 접두사 안의 새 key만 만든다. 선언 파일을 entwurf가 고쳐 쓰는 일은 없다(쓰는 순간 두 번째 장부가 된다).

설계 — fresh composition 후보 (agy 예외 차용 없음)
1. 고정 managed 진입점 `entwurf openclaw --scope <s> --model <provider/model> --width agent-policy --entwurf-bootstrap <{v,target,nonce,task}>`. 임의 명령·env carrier 없음.
2. pre-mutation preflight(창을 열기 전): Gateway 도달(`--expect-url` 일치), 플러그인 설치·활성·로드, 선언에 scope와 접두사 존재, 그리고 4능력 — birth(1절 writer), MCP hand 대신 **플러그인 도구 손**, receive(4절 어댑터), visible identity.
3. `sessions.create {key: <prefix><nonce-derived>, label, model}` — 모델은 여기서 명시된다 [측정 M1].
4. `openclaw-birth` → garden id. 그다음 label을 garden id 표시용으로 바꾸거나(`sessions.patch` label, operator.write 범위로 추정 [미측정]) 처음부터 label에 nonce를 실어 둔다.
5. mux가 `openclaw tui --session <exact key> --message <callback-before-task 프레이밍>`을 연다.
6. callback: 플러그인 프로세스는 Gateway 안에서 돌기 때문에 TUI 창의 `ENTWURF_CALLBACK_*` env를 읽을 수 없다 [추론: 플러그인은 Gateway 프로세스, TUI는 WS 클라이언트 — 측정 `R/m1-live-1.txt` pid는 Gateway 쪽]. 그래서 no-arg callback 대신 **Codex 형태**를 쓴다: 첫 프롬프트가 target과 nonce를 담고, 모델이 플러그인 `entwurf_v2`로 nonce를 보낸다. sender envelope은 ctx join으로 정해지므로 nonce 상관은 표준 그대로다 [선례 `docs/adding-a-harness.md:36` codex 행].
7. LIVE: callback sender garden id = 4단계 garden id, 이어서 주소 지정 `entwurf_v2` → `native-push` 주입 → OpenClaw 자신의 턴이 답신.

판정: **성립 후보다. 다만 지금은 admission이 아니다.** 1·3·5(일부)·7의 표면은 측정되었거나 문서로 확인되지만, 다음 네 가지가 [미측정]이고 이 넷 중 하나라도 안 되면 harness를 admit하지 않는다(`docs/adding-a-harness.md:676-677`): (a) footer/header에 garden id가 보이는 표면, (b) `--width agent-policy`가 실제로 무엇을 제공하는지 — pi-durable의 "native installed-tool offering, no filter" 선례(`docs/adding-a-harness.md:650-653`)에 맞춰 명시 토큰으로만 둔다, (c) `tui --message`가 정확한 key에 첫 턴으로 들어가는지, (d) TUI 안 `/new`·`/session` 전환 때 화면과 record가 갈라지는 것을 어떻게 보이게 할지. 그때까지는 브랜치 실험이고 출하가 아니다(release stop, `docs/adding-a-harness.md:682-691`).

## 3. 송신 (OpenClaw → 형제)

사실
- ctx는 (agentId, sessionKey, sessionId)를 준다 [측정 M1]. `assertInvocationCurrent()`는 런이 끝난 뒤나 reset 뒤에 보관해 둔 ctx를 `refused: agent tool caller authority is no longer active`로 거절한다 [측정 `R/m1-stale-ctx.retry1.txt`].
- stdio MCP에는 발신자 식별이 0이다 [측정 M4]. 플러그인이 외부 명령을 띄우는 vendor 표면은 `api.runtime.system.runCommandWithTimeout(cmd,args,opts)`이며 timeout 결과를 code 124로 준다 [태그문서 `docs/plugins/sdk-runtime/state-and-system.md` api.runtime.system].
- remote-pair entry의 종료 계약과 strict claim 파서가 선례다 [`scripts/remote-pair-receive.ts:15-24`, `pi-extensions/lib/remote-pair-receive.ts:114-133`].

설계
- **경로:** 플러그인 도구 `entwurf_v2(target, message, wants_reply)` → execute에서 claim 생성 → `runCommandWithTimeout(<pluginConfig.entwurfBin 절대경로>, ["openclaw-send", "--decl", <pluginConfig.declPath 절대경로>], {stdin: claim})` → entry가 선언 범위 대조 → record join → 기존 `runAndRenderEntwurfV2FromSurface`. 플러그인은 entwurf 코드를 import하지 않는다.
- **claim 스키마 (정확히 이 키들, 그 외 키는 거절):** `{v:1, scope, agentId, sessionKey, target, message, wantsReply}`. `scope`는 pluginConfig에서(운영자가 OpenClaw 설정에 적은 값), `agentId`/`sessionKey`는 ctx에서, 나머지는 모델 인자에서 온다. sessionId는 싣지 않는다 — reset을 넘어 바뀌지 않으므로 검사할 것이 없다(5절). 검사: sessionKey가 `agent:<agentId>:`로 시작, 헤더 필드에 제어문자 없음, message ≤16000, target은 garden id 문법.
- **entry `entwurf openclaw-send --decl <abs>` 종료 계약** (remote-pair와 같은 번호, 같은 의미):
  - `0` dispatch 했고 오류 없음 — receipt JSON 1줄
  - `4` dispatch 했고 dispatch가 오류를 보고(`retry-safe:false` 포함 가능) — receipt
  - `3` 범위 거절, dispatch 안 함 — `openclaw-scope-not-declared`(scope/key가 선언 밖) 또는 `openclaw-sender-not-citizen`(선언 안이지만 record 없음/모호) — receipt
  - `2` `--decl`이 이 호스트의 정규 경로가 아님, 선언 부재·파손, claim 무효 — `{kind:"invalid"}` receipt (argv 오류는 usage만)
  - `1` 잡히지 않은 throw — receipt 없음, 플러그인은 indeterminate로 보고
  - 플러그인 쪽: 그 밖의 code, 124(timeout), 줄 수·JSON 불일치 → `indeterminate`. 재시도 없음.
- **sender envelope:** remote-pair와 달리 `external-mcp`가 아니다. entry가 (backend `openclaw`, nativeSessionId) record를 찾아 record-backed 시민 envelope을 만들고, replyable은 그 시민의 수신 probe(4절)가 alive일 때만 참이다(who-sent ≠ replyable, `docs/adding-a-harness.md:451-453`). ambient `PI_SESSION_ID` 등은 읽지 않는다.
- **`assertInvocationCurrent` 호출 시점:** execute 안에서 인자 검증과 claim 직렬화가 끝난 뒤, `runCommandWithTimeout` 직전에 **한 번**. 이것이 commit 지점이다. throw하면 도구 오류로 끝내고 프로세스를 띄우지 않는다. 띄운 뒤에는 되돌릴 수 없으므로 두 번째 호출은 의미가 없다(entry는 다른 프로세스라 ctx가 없다). 팩토리 시점 호출은 하지 않는다 — 팩토리 ctx는 보관용이지 송신 권한이 아니다.
- **신뢰 모델:** claim은 인증이 아니다. 같은 OS 계정이면 누구든 entry에 아무 선언된 (scope, sessionKey)를 주장할 수 있다. 선언은 범위 제한일 뿐이다(remote-pair 문구, `remote-pair-receive.ts:9-13`).

## 4. 수신 (형제 → OpenClaw)

사실
- **idle:** `chat.send {queueMode:"steer"}`가 새 턴을 시작했다. ack `{"runId":"s2-idle-steer","status":"started","messageSeq":1}`, 모델 답 `ALPHA` [측정 `R/s2-steer-live.txt`].
- **busy:** `sleep 30` 도구 실행 중 같은 호출이 실행 중인 run에 주입되었다. ack `{"runId":"s2-busy-steer","status":"started"}`(messageSeq 없음), transcript user 행에 `"steerTargetRunId":"s2-long"`, 최종 답 `DONE-LONG BRAVO` [측정 `R/s2-steer-busy-live.txt`]. Gateway 로그 `slow chat send 25192ms stage=steer ack=48ms` [측정 `R/s2-gateway.log`]. 문서 문구와 일치: "injects the message into that session's direct active run, or starts a new turn when the session is idle" [태그문서 `rpc-session-control.md:77`].
- **ack로는 steer와 새 턴을 구별할 수 없다**(둘 다 `status:"started"`). transcript를 봐야 안다 [측정 위 두 영수증].
- 주입된 행의 provenance는 `external_user`, transport client `cli`이다 [측정 같은 영수증]. 발신자 표식은 없으므로 envelope은 본문에 실어야 한다(native-push 공통 규칙, `docs/adding-a-harness.md:512-517`).
- **probe:** `sessions.describe {key}`는 없는 key에 `{session:null}`, 있는 key에 `hasActiveRun`·`sessionId`·`lifecycleRevision`을 준다 [측정 M5, `R/s2-steer-live.txt`].
- **dedupe:** 같은 idempotencyKey·같은 입력 재전송은 `{status:"ok"}`로 행이 늘지 않고, 다른 입력은 `chat-request-conflict` [측정 `R/m5-dedupe-live.txt`]. dedupe 보존 기간은 [미측정].
- **인증:** `openclaw gateway call`은 `--token` 없이 lab 설정의 `gateway.auth`(mode token)로 연결되었다 [측정 S2 전 호출 exit=0]. `--expect-url`은 "Fail if the resolved Gateway URL differs; preserves configured authentication" [측정 `gateway call --help`]. 필요한 scope는 `chat.send`=`operator.sessions.write`, `sessions.describe`=read 계열 [태그문서 10.9 `session-method-scopes-base.ts:7-66`, #160 comment; 11.3 재확인은 미측정].
- host node 24.18.1은 OpenClaw의 SQLite WAL 가드에 걸린다 [측정 S1]. `gateway call`이 그 가드를 타는지는 [미측정] — lab은 Nix node 24.21.0으로만 쟀다.

설계
- **rail class: native-push** (record + probe-alive, mailbox·receiver marker 없음, resume 권한 없음) [Hard Rule 10, AGENTS.md:40]. `NATIVE_PUSH_BACKENDS += "openclaw"` [`entwurf-v2-contract.ts:130`].
- **어댑터 `native-push/openclaw-gateway.ts`:**
  - probe = vendor CLI `openclaw gateway call sessions.describe --json --expect-url <decl.url> --params {"key":<record에서 꺼낸 sessionKey>}`. `session` 있음 → alive(route = {backend:"openclaw", url, configPath}), `session:null` → dead, 연결 실패·timeout·exit≠0 → indeterminate. `hasActiveRun`은 경로 선택에 쓰지 않는다(steer 호출 하나가 두 상태를 덮는다).
  - send = `openclaw gateway call chat.send --json --expect-url <url> --params {sessionKey, message:<렌더된 본문>, idempotencyKey:"entwurf-<dispatch uuid>", queueMode:"steer"}`. 성공 판정 = exit 0 ∧ `status ∈ {started, ok}`. `retriable:false`로 시작한다(Codex와 같은 보수적 선택; dedupe가 측정되어 있으니 같은 key 1회 재시도는 나중에 증거로 열 수 있다).
  - 실행은 execFile(셸 없음), bounded timeout, 선언에 `configPath`가 있으면 그 한 실행에만 `OPENCLAW_CONFIG_PATH`를 넘긴다(Copilot의 one-invocation flag 선례, `DELIVERY.md` Copilot "The flag"). entwurf는 토큰을 읽지도, argv에 싣지도, 복사하지도 않는다.
- **본문:** 메일박스 본문 SSOT로 envelope을 한 번 렌더해 그대로 주입한다(`makeNativePushSend`의 senderProvider 경로, `entwurf-v2-native-push.ts:64-90`).
- **보이는 것과 배달은 다르다:** 세션은 TUI가 닫혀 있어도 Gateway 안에 살아 있으므로 probe는 alive이고, 배달은 아무도 보지 않는 턴을 시작할 수 있다. 화면이 열려 있는지는 확인하지 않는다(remote-pair "Visibility" 문단과 같은 경계).
- **인증 소유 (GLG 결정 7-1):** 권고안 = "Gateway 인증은 그 Gateway의 운영자가 OpenClaw 자기 설정 안에 소유하고, entwurf는 vendor CLI를 실행할 뿐 credential을 만지지 않는다. entwurf가 거는 제약은 `--expect-url` 일치 하나." 경계: (i) 같은 호스트 Gateway — 운영자 계정의 OpenClaw 설정(또는 선언의 `configPath`), (ii) 컨테이너·원격 Gateway(S5) — 호스트 쪽 OpenClaw 설정의 `gateway.remote.url`+token을 운영자가 직접 둔다. 토큰 자동 발견·추출·복사·중계는 하지 않는다.

## 5. reset 세대 정책

사실
- `sessions.reset` 뒤 sessionId는 그대로, `lifecycleRevision`만 바뀐다 [측정 `R/m3-reset-live.txt`: `849027d7…` ← `f85f95ef…`]. ctx에는 lifecycleRevision이 없다 [측정 M1 ctx 키]. reset은 retained ctx를 무효화한다 [측정 `R/m1-stale-ctx.retry1.txt` "assert retained AFTER reset → refused"].
- `sessions.reset`·archive 류는 `expectedSessionId` CAS를 받지만 "does not reject changes that keep the same session ID, including … reset-in-place" [태그문서 `rpc-session-control.md:69`]. 즉 sessionId는 세대 fence가 될 수 없다.

설계
- **sessionId 불변을 세대 증거로 쓰지 않는다.**
- 권고 정책: **garden id는 (scope, sessionKey) 자리에 붙고 reset을 넘어 유지된다.** reset은 같은 시민의 대화 교체로 취급한다(record 갱신 없음, lifecycleRevision을 record에 저장하지 않음 — 저장하면 V3 키 추가 + reader roll-forward가 필요하다).
- 이 정책이 막는 것과 못 막는 것: 송신 쪽 stale ctx는 `assertInvocationCurrent`가 막는다 [측정]. 수신 쪽에는 fence가 없다 — reset 직전에 보낸 형제 메시지가 reset 뒤 새 대화에 들어갈 수 있다. 이것을 받아들이는 경계로 명시한다.
- 대안(GLG가 고르면): record가 birth 시점의 `lifecycleRevision`을 들고, probe가 다르면 `native-push-target-drifted`로 거절, 재-birth가 새 garden id를 찍는다. 비용: V3 스키마 키 + 모든 reader roll-forward + reset마다 시민이 바뀌는 UX.

## 6. 코어 diff 목록 vs `plugins/openclaw`

코어 (이름이 정해진 최소 diff, 각 항목 옆 테스트)
1. **backend 등록:** `META_BACKENDS`·`META_CITIZEN_BACKENDS`·`META_BACKEND_DESCRIPTORS`에 `openclaw`, `pi/entwurf-capabilities.json`에 `wakeMode: native-push` 행. **reader roll-forward:** 빌드 → 모든 공유 reader 재배포 + doctor → 살아 있는 MCP bridge child 재시작 계획 → 그 뒤에만 첫 record birth [`docs/adding-a-harness.md:168-190`].
2. **선언 reader** `openclaw-citizens.json` (strict 스키마, 경로 정규화, 매 호출 재독, 파손 시 이름으로 거절) — `remotePairOptInPath` 옆.
3. **birth entry** `entwurf openclaw-birth` + `birthOpenclawCitizen` (1절).
4. **송신 entry** `entwurf openclaw-send --decl` + claim 파서 + 종료 계약 + record-backed sender 조립(`meta-sender-identity.ts`에 openclaw claim join 한 갈래) (3절).
5. **수신 plan:** `NATIVE_PUSH_BACKENDS += openclaw`, `NativePushRoute` openclaw 변형, 어댑터 `native-push/openclaw-gateway.ts`, decider·self-address의 replyable 연결 (4절).
6. **fresh composition/preflight:** `FRESH_CALL_BACKENDS += openclaw`, 콜백 도구 이름 열(`FRESH_CALL_CALLBACK_TOOL`: Codex처럼 `entwurf_v2`), managed verb `entwurf openclaw`, 5축 preflight, 세 공개 표면 동기(`test/fresh-call-surfaces.contract.test.ts`), `check-harness-admission-parity`, LIVE `smoke-openclaw-fresh-live` (2절).
7. **CLI·문서:** `ENTWURF-CLI.json`에 새 verb들(S9가 비교), DELIVERY 행, `docs/adding-a-harness.md` source map 행, ROADMAP에 새 트랙 한 줄.

`plugins/openclaw` (OpenClaw 쪽, entwurf import 없음)
- `openclaw.plugin.json` + `dist/index.js`: `contextVersion: 2` 도구 `entwurf_v2`(필요하면 읽기 전용 `entwurf_peers`도 같은 entry 경유로), pluginConfig `{entwurfBin, declPath, scope}` — 셋 다 운영자가 OpenClaw 설정에 적는 절대값, 탐색 없음.
- `runCommandWithTimeout` 호출, receipt 분류(0/4/3/2 + 그 밖은 indeterminate), `assertInvocationCurrent` 위치.
- 설치·doctor 문서(2단 동의 게이트 [측정 S1]), 바로 옆 `*.test.mjs` hermetic 테스트(가짜 entry로 claim·종료코드 분류).
- **수신 코드는 플러그인에 두지 않는다**(4절). 플러그인 steer/next-turn/system-event 경로는 쓰지 않는다.

## 7. GLG만 정할 것

1. **수신 인증의 소유와 경계:** "OpenClaw 운영자가 자기 OpenClaw 설정에 소유, entwurf는 vendor CLI만 실행하고 `--expect-url`만 강제"(권고) — 이것으로 정하는가, 아니면 다른 경계(선언이 가리키는 토큰 파일 등)를 원하는가.
2. **수신 표면을 Gateway `chat.send queueMode:"steer"`로 바꾸는 것**(transcript에 `external_user` 행으로 남고 발신자 표식은 본문 envelope뿐) — S2 초안의 플러그인 steer/next-turn 대신.
3. **reset 정책:** garden id가 reset을 넘어 유지(권고, 수신 쪽 무 fence를 경계로 수용) vs reset마다 새 시민(lifecycleRevision을 record에 저장).
4. **backend 이름 `openclaw`와 nativeSessionId 합성 `openclaw:<scope>:<sessionKey>`**, scope는 운영자가 정하는 Gateway 라벨.
5. **fresh 경로 채택 여부:** 2절 후보(Codex 형 callback = `entwurf_v2` 인자형, `--width agent-policy` 명시 토큰)를 S3/S4 측정 대상으로 승인하는가. 미측정 (a)–(d) 중 하나라도 실패하면 OpenClaw를 admit하지 않고 브랜치 상태로 둔다는 것을 확인.
6. ~~host node 문제~~ **닫힘** [측정 2026-11-13 ssh oracle]: oracle host의 node는 24.18.1 / sqlite 3.51.2이고 `openclaw`는 없다. 운영 컨테이너 `openclaw-gateway`는 node 24.22.1 / sqlite 3.53.4, OpenClaw 2026.10.9 (8b18b55)다. 운영 OpenClaw는 이미지 node로 돌기 때문에 host node와 무관하다. S5의 수신 CLI는 `docker exec`로 컨테이너 쪽을 쓰므로 nixos-config의 node 정리는 필요 없다. host에 직접 설치하는 경우(thinkpad lab)만 node ≥24.19가 필요하다.

**GLG 승인 (2026-11-13):** 1–5를 권고대로 승인했다. 1은 운영자 OpenClaw 설정이 인증을 소유하고 `--expect-url`로 강제한다. 2는 `chat.send queueMode:"steer"`, 3은 garden id 유지, 4는 `openclaw` / `openclaw:<scope>:<sessionKey>`다. 5는 fresh를 S3/S4 측정 대상으로 삼되, (a)–(d) 중 하나라도 실패하면 브랜치에 남긴다.

## 남은 측정 (S3/S4가 닫을 것)

- footer/header의 garden id 표시면, `--width` 의미, `tui --message` 첫 턴, TUI `/new`·`/session` 전환 시 가시성 (2절 a–d).
- `sessions.patch label`이 operator.write로 되는지, footer에 label이 나오는지.
- chat.send dedupe 보존 기간, 11.3에서 메서드별 scope 재확인.
- 측정에 쓴 lab 세션 `agent:main:s2steer`는 lab store에 남아 있다. Gateway는 내렸다 [측정: 18811 listen 없음, openclaw 프로세스 없음].

GLG 동의 (2026-11-13, 초안 단계): 코디 검토 전부에 동의. agy native 행은 ACP로 대체되면 제거할 예정이므로 예외의 선례로 삼지 않는다.

## 운영 코디 검토 (b22677, 2026-11-13 14:32) — 방향에 억지는 없음. 그대로 입장시키지 말아야 할 두 지점

1. **선언 파일은 허용 범위일 뿐 두 번째 주소 원장이 아니다** (AGENTS.md:32,37).
   - gardenId는 기존 V3 record에서 얻는다. 선언에 gardenId를 적더라도 검증된 참조일 뿐이고, mint·갱신·조회 권위가 아니다.
   - S2에서 함께 명시할 것: birth의 단일 writer, 재등록 멱등성, (agentId, sessionKey) 유일성이 성립하는 Gateway 인스턴스 범위.
2. **c — agy 예외는 이식할 수 없다** (adding-a-harness.md:611–637,682–696; DELIVERY.md:129).
   - fresh 후보가 되는 조건: 새 세션을 실제로 만들고 → 그 정확한 key의 TUI를 고정 managed launcher로 연다 → 모델과 권한 폭을 명시한다 → garden-id 표시면을 둔다 → callback-before-task와 nonce → 주소 지정 수신 LIVE.
   - 기존 고정 key에 TUI만 붙이는 것은 fresh가 아니다.
   - "선언된 고정 세션만 시민"과 동적 fresh의 관계를 먼저 풀고, fresh composition과 preflight를 코어 diff 목록에 넣는다.
   - 미측정인 동안 브랜치 실험은 해도 되지만 지원·출하는 아니다.

나머지 판단:
- **a.** 토큰이 있다는 것만으로 credential mediation이 되지는 않는다. 다만 자동 발견·추출·복사·로그인·중계는 승인 범위 밖이다. 인증을 누가 소유하는지는 GLG 결정 카드에 둔다. 토큰을 피하려고 watcher+mount로 바꾸지 않는다. "#109 축을 피했다"는 아직 가설이다.
- **b.** reset 후 같은 garden id를 유지하는 것은 정책으로 선택할 수 있다. 다만 sessionId 불변을 세대 fence의 증거로 쓰지 않는다. run-current 검증과 reset 경계의 stale 거절은 별도 증거다.

# S1 브리프 — 측정 형제가 읽는 원본

## 근거 (원본을 읽을 것, 요약을 믿지 말 것)

- 이슈 본문: `gh issue view 160` (+ GLG 댓글: agy ACP는 별도 축).
- 하네스 경로: `docs/adding-a-harness.md` §0과 §1(벤더 측정 6항목). omp 행(프로세스 내 watch + announce-only doorbell)이 플러그인 가설의 선례다.
- 역사: #109 종료 코멘트(컨테이너 축, "argv 실측 없이 말하지 않는다").
- 태그 문서: `gh api "repos/openclaw/openclaw/contents/docs/<path>?ref=v2026.10.10" -H "Accept: application/vnd.github.raw"`. 라이브 docs 사이트는 main 기준이라 버전 증거가 아니다.

## 격리 규칙 (위반 시 즉시 STOP)

- 기존 `~/.openclaw`(2026-05 잔재)는 읽지도 쓰지도 않는다. state/config는 버전별 lab 루트로만 향하게 한다. 그것을 보장하는 env/flag부터 M0에서 재고, 보장되지 않으면 설치 후 첫 실행 전에 멈춘다.
- lab 루트: `~/.local/share/entwurf-lab/160/openclaw-<version>/`(prefix, state, receipts). 리포 안이나 /tmp 개발 클론에는 두지 않는다.
- 설치: NixOS pnpm으로 lab prefix에만 설치한다(`pnpm add --dir <lab>/prefix openclaw@<version>`). global·corepack·npm -g는 금지.
- Gateway: loopback만 사용한다. 포트는 10.10=18810, 11.3=18811. 채널(텔레그램 등)·`--deliver`·외부 발송은 금지한다.
- 오라클·운영 봇·`~/repos/gh/openclaw-config`·`~/.pi/agent` record/mailbox에는 쓰지 않는다. entwurf 소스도 편집하지 않는다.
- 첫 예상 밖 실패는 raw 출력과 exit을 보존하고 STOP한다. 다른 방법으로 다시 시도하지 않는다. 비밀값·토큰은 출력하지 않는다.

## 측정 항목

- **M0 설치 사실:** 정확한 버전·SHA·node 요구, state/config 경로를 정하는 env/flag, `openclaw --help` 상위 명령, plugin 설치 명령의 형태.
- **M1 플러그인 도구의 세션 문맥:** 플러그인이 등록한 도구가 호출될 때 agentId / session key / sessionId 중 무엇을 받는가. 플러그인 SDK 타입과 실제 호출로 확인한다(최소 echo 플러그인). 답신 sender join의 결정 측정이다.
- **M2 플러그인 → 자기 세션 메시지 주입:** 플러그인 API로 특정 session key에 user/system 메시지를 넣고 턴을 깨울 수 있는가(doorbell). 메시지가 busy일 때와 idle일 때 각각 어떻게 되는가.
- **M3 생명주기 hook:** 세션 시작·`/new`·`/reset`·gateway 재시작 때 플러그인이 받는 이벤트와 그 시점(record birth 후보).
- **M4 `mcp.servers`:** 에이전트용 stdio MCP 서버 프로세스가 받는 env·argv·요청 metadata에 세션 식별자가 들어 있는가. 세션마다 프로세스가 생기는가, 공유되는가.
- **M5 Gateway RPC 대조:** `sessions.describe`(exact key), `chat.send` idempotencyKey 재시도·충돌 응답, ack 필드(11.x의 admission/persistence 분리 여부)를 raw로 기록한다.

## 산출물

- `<lab>/receipts/`에 원 영수증을 남긴다. 9fc008에게 보내는 보고에는 판정을 가르는 줄을 붙여 넣는다(host-local 경로만 보내지 않는다).
- 각 항목: [측정] / [태그문서 file:line] / [미측정] 표기. 가설과 사실을 다른 상자에 둔다.
