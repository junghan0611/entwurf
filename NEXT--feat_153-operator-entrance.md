# NEXT — #153: 명령과 help의 원천

# RAIL — 현재 좌표

- [x] **1. CLI 다이어트.** adapter/loader 안을 철회하고 pure dev arm148개 제거. ce92dc7 커밋, push 없음.
- [x] **2. help 원천 이전(slice1).** 독립 검수·수정, package/consumer PASS, 영향 PARTIAL28/28.
- [x] **3. 안전한 help 입구(slice2).** focused GREEN, cef89d 읽기검수 closure. 최종 mutant/package/FULL은 미측정.
- [x] **4. leaf synopsis 중복·선정 debt(slice3).** b329d3 focused GREEN, af86a6 읽기검수 closure. pointer4곳/pi설명/debt89/I9복구.
- [ ] **5. 최종 acceptance.** ← CURRENT: 최종 package·PARTIAL55/55 PASS. frozen FULL 한 번/결과 판독 → 완료 DM·GLG commit 결정 대기. push 별도 요청.

# NOW

- **Next:** Opus가 격리환경에서 `pnpm run check:full`을 frozen candidate에1회 실행한다. 결과는 `/tmp/e153h/full/`의 log/exit/지문/RESULT.md를 먼저 읽는다. source/index/dist/**이 NEXT까지 고정**. main은 결과·DM을 저장소 밖에 남겨 이 후보를 움직이지 않는다. 실패는 원로그 보존STOP, 자동수선·재시도없음. 성공 후 완료DM 한 번, commit/push는 GLG 결정 대기. 첫 RED라면 그 지점에서 멈추고 별도 GO 전 수선·재시도하지 않는다.
- **구현 owner:** Opus `20261030T190810-915040`. main은 이 NEXT만 편집한다. Astra `20261030T185730-567753`는 구현 checkpoint 후 검수 대기. 별도 peer 간 조율 lane 없음.
- **Read:** `/tmp/e153h/SLICE2-PLAN.md`의 A(원문)/B(main 결정)/C(보정), d3e50e GO와 ff9fb2 검수의 아래 계약. 사용자 원문은 `/tmp/entwurf-153-help.jeN1en/BRIEF.md`; PREP.md는 준비 당시 문서다.
- **현재 구현:** 58b012 범위를 완료했고 af86a6에서 잔여 Defect 없음. leaf4곳 canonical pointer/기존stream·exit·행동 유지, pi literal/debt89/help pi0, owner proof5개, I9 JSON+mjs 운반과 새 child 격리. 더 제품 편집하지 않는다. 남은 remote-pair-receive/store-doctor usage2곳과 debt89는 명시 미이관이며 이번 작업 완료를 전 corpus 이관이라 부르지 않는다.
- **아직 보류:** 새 pack/install/build/PARTIAL/FULL/commit/push. slice1의 각 승인·성공을 변경된 slice2 후보의 증거로 승격하지 않는다.
- **완료 통지:** GLG가 전체 help 작업과 최종 검증 완료 시 DM을 요청했다. main만 dm 스킬로 한 번 보낸다. 진행 중 DM은 보내지 않는다.

## Slice2 채택 계약 — 구현 중, 아직 실행 결과 아님

- `help <cmd>`와 Entwurf-owned `<cmd> -h|--help`의 정확한 형태만 안전한 개별 설명으로 받는다. 설명 없음/명백한 help 형태의 extra argv/`--help X` 별칭은 stdout0·한 줄 stderr·exit2, dispatch 진입 없음. 입력 이름은 escape하며 shell 문자열로 재해석하지 않는다. metadata missing/malformed는 기존 named failure/exit1.
- vendor4(`pi`, `pi-durable`, `copilot`, `codex-app-server`)의 기존 argv/exec는 그대로다. `copilot --help extra`는 vendor 전달, `help copilot extra`는 Entwurf 구문 거절. 임의 위치 flag·`--` 뒤 literal은 공통 해석하지 않고 안전 help라고 주장하지 않는다. `help pi`는 현 debt로 거절 가능; 별도 slice4는 없다.
- preflight는 `cmd=${1:-}`과 기존 `case "$cmd" in` 사이의 작은 if/elif 블록. **기존 case 본문은 불변**: ce92dc7의53603B/sha8c925ec8…4867(Opus 측정). raw label 집합만으로 owner 증거를 약화하지 않는다. 실제 Bash gate 정의/source provenance와 동명 heredoc 음성도 유지.
- case 앞 sentinel byte fixture에서 전체279 이름×`--help`와 대표 argv축을 **우선 순차** 검사. root/Unknown은 정상 S9 fixture에서 별도 검사한다. 새 pool/child manager 없음. 실제 비용/기존 mutant120s 예산 문제가 생기면 보고하며 자동 timeout 확장 없음.
- JSON schema2 + optional details, fs-only renderer의 정확 `--command <name>` 모드. cwd/HOME/env 검색·SDK/store/config/auth/network·leaf 실행 fallback 없음. Root MCP ENTWURF.json과 reader는 변경하지 않는다.
- root prefix `./run.sh`→`entwurf`, eight→nine은 고정 old root fixture에 대한 명시 literal amendment. nine은 EXPECTED_TOOLS와 실제 boot oracle의9개 계약에 대조한다.
- fresh-cut은 **ce92dc7 source-literal oracle**를 전체 보존하고, 새 details에서 옛 invocation2줄+직후 구분 빈 줄1개만 제외한다. 내부 공백·빈 줄 보존, 범용 trim 금지. fixture 마지막 LF framing과 마지막 빈 항목 구별. **실제 leaf 출력 캡처/측정이라고 부르지 않는다.** FRESH_CUT_EXIT import는 test에만 허용한다.
- leaf 직접 help/invalid usage/JSON 계약과 synopsis 중복은 이번에 바꾸지 않는다. 전체 corpus 사실 인증·debt90 일괄 창작·새 기능/registry/loader/일반 Bash·JSON parser는 범위 밖.

# RECENT — 최종 영향 PARTIAL55

- **df02e3**: 지정순서각1회, install-surface36/peer-facts9/meta-facts5/fresh-cut4/prune1 모두KILLED·controls ok·exit0. main도5개JSON을직접읽어 passed=true/controlok/전부KILLED/sealstable/core·input drift없음을확인했다. 전체1285개통과가아니다.
- 후보: HEAD ce92dc7 + workSurface **6dc76730ca08e8169c12b24e419104d4dd798d340b1e4006a46fedfa60df99d4**. 영수증 `/tmp/e153h/final-qual-{install-surface,peer-facts,meta-facts,fresh-cut,prune}.json`. source그룹928.1초, 전체실행중동결유지는Opus지문보고. dist는2cb6bd61… 유지.
- FULL 직전 변경은 main의 **이 NEXT 좌표 갱신/restage뿐**. 제품/게이트/변이는 변경하지 않았지만 workSurface가달라질수있으므로 PARTIAL후보와 FULL동결후보를같은hash라고부르지않는다. 최종FULL후이파일을고치지않고외부RESULT.md로판독한다.

# RECENT — 최종 package proof

- **bc0365 package PASS:** `/tmp/e153h/pack3/check-pack.exit`, `check-pack-install.exit` 각각0을 main도 직접 읽었다. 653파일/consumer root의 byte·설치title변경·renderer부재·복원cmp 성공. command page/installed leaf 직접 실행은 이 consumer셀에서 미측정이며 source증거로 승격하지 않는다.
- main이 파일별 dist hash를 직접 비교했다: 정상 emit 차이는 정확히 leaf4 JS뿐. 파일96개 유지, 집계432abf61…→2cb6bd61…. 두 pack 이후 dist해시/전체fp가 동일함도 직접 확인. source/index/NEXT 변동 없음은 Opus 지문 보고. 새compiledleaf의pointer 포함/옛usage없음은 byte검사이지 installed실행 측정 아님.
- 이후 main의 NEXT 좌표 갱신만 restage하고 PARTIAL 후보를 새로 잡는다. 제품 변경은 없으며 과거 후보hash를 승격하지 않는다.

# RECENT — 최종 preflight

- main이 알려진22파일만 stage, cached diff-check와 unstaged없음을 확인했다. 커밋은 아니다.
- 최초 scanner wrapper는 불필요한 stdin pipe+pipefail로141/출력없음. 즉시STOP하고 `/tmp/e153h/FINAL-SCANNER-WRAPPER-RED.md`에 보존. scanner staged는 자체gitdiff를 읽는다는 source진단 후 **07f5db** 정상 직접호출만 승인했다. 훅/정책/bypass 변경 없음.
- **684768 정상 scanner 직접1회: exit0/stdout0/stderr0**. main도 `/tmp/e153h/final-scanner.exit`를 직접 읽었다. 이는 staged preflight이며 pre-commit전체/pack/최종floor를 대신하지 않는다.

# RECENT — slice3 구현·읽기검수 닫힘

- **af86a6 Astra READ closure:** leaf4/실제 owner출력·stream/환경/I9/독립pi literal/새5mutant·문서 범위에 남은 Blocker/Defect 없음. 실행증거는 b329d3 상속, 실제 kill/최종 package/compiled twins/FULL은 아직 미측정. main은 production leaf4 diff와 영향그룹55개 집계를 직접 확인했다.

- **b329d3 Opus 측정 보고:** formatter/check/쉘구문2/source54/PF22/MF17/freshcut169·failed0/prunePASS/manifests1285·91/lint27/typecheck 모두 단독exit0, 예상 밖 stderr 없음. HOME/XDG4/PI 격리 wrapper는 `/tmp/e153h/s3run.sh`, 로그 `/tmp/e153h/s3-*.log`.
- main도 production leaf4개 diff를 직접 읽었다: usage 문구만 canonical pointer로 바뀌었고 argv/exit 로직 diff 없음. Astra에 새5mutant·owner gate·pi literal·I9/env 포함 독립검수를 요청, 1c96fd로 Opus 추가편집·실행 대기.
- main의 manifest 직접집계: **install-surface36 + peer-facts9 + meta-facts5 + fresh-cut-gate4 + smoke-meta-prune1 = 55**. 실제 kill/새후보package/FULL은 아직 미측정. leaf productionTS4개가 바뀌므로 최종pack에서 정상 compiled-twin emit 변화가 예상되며 이전dist/packageproof를 승격하지 않는다.

## 채택 계약/사전 읽기

- **1e5999 source READ 제안:** 네 leaf의 usage를 `entwurf help <cmd>`와 checkout `./run.sh help <cmd>` 안내1줄로 교체, stream/exit·JSON/store/action은 유지. fresh-cut directhelp의 rich25줄→안내1줄은 명시변경이며 공개 rich본문은 Root에 남는다. 새 공유모듈/두 경로 탐색 없음.
- main도 pi arm을 직접 읽었다. PATH파일/type-P/재귀거절/--entwurf-control선행/기존argv exec가 설명 후보를 지지한다. 공개Root literal 삽입·debt90→89·help pi2→0 제안이며 vendor동작/case본문은 불변.
- **main 추가 fixture lead(직접READ, 미실행):** fresh-cut gate I9:1458–1464는 run.sh+doctor.ts만 복사하고 빈argv로source한다. 새Roothelp JSON/mjs부재가 본래doctor-dist부재거절을 가릴 수 있다. fcfbfe로 Opus에 cp-runsh fixture closure 읽기sweep, Astra에 계약검수 요청. **cdf8b4 Opus 읽기sweep도 확인**: I9c의 ARTIFACT 판정이 실행 시 깨질 예측이며 실제 RED 영수증은 아니다. 다른 현 cp-runsh fixture는 help에 들어가지 않음. 해결은 I9에 JSON+mjs만 복사해 doctor-dist부재 음성 유지, 제품 sourced guard 추가 없음. 4ba5e6으로 지금 수선/시험은 열지 않았다. index의 subjectTracked는 추적 여부만이며 staged내용 검사가 아님을 main이 mutation-qualify.ts:1060–1067에서 직접 확인했다. 최종 동결 전 stage 범위는 별도 결정한다.

# RECENT — slice2 checkpoint, 읽기검수 닫힘

- **4e61b2 Opus 측정 보고:** 고지한 focused8종 실제 exit0. source gate23.5초/순차279이름축19.6초, peer고객장면21assert/boot21checks, manifest1278·91/lane24. install-surface PARTIAL은33개로 약14분 추정(미측정); 자동 최적화/timeout 확장 없음.
- main이 renderer 전체를 직접 읽었다: 고정 module-relative/fs-only/검증후출력/unknown JSON인용2/metadatafail1. **b83d3a EPIPE 경위**: 수동 `--help | head -3`에서 수선 전 Node EPIPE stderr 스택을 관측, pipefail 없고 최초 producer/pipeline exit은 미기록. main도 `/tmp/e153h/epipe-original-output.txt`를 직접 읽었다. 먼저 STOP/보고하지 않고 고친 절차 누락은 기록하고, **7f43e3**으로 현 patch 보존·읽기검수만 허용했다. quiet0 UX 정책은 Astra 판독 후 명시 수용 여부를 정한다. 과거 상태 재실행·원자료 재생성 없음. gate RED/운영 상태 손상으로 확대하지 않는다.
- Astra에 slice2 전체 계약·24mutant/source-literal/소유권·EPIPE 경계를 읽기검수 요청. main 실측 수량은 source-literal fixture25줄/details22줄이며, Opus의21줄 보고를 정정했다. 제품 누락 발견이라는 뜻은 아니다.
- **79dbbf 읽기검수**: runtime Blocker 없음. broken metadata 검사가 nonzero만 요구해 refuse2도 통과한다는 Defect. **2d78e0 GO**로 정확 exit1/stdout0/named stderr와 command-help 경로·독립 mutant를 보강한다. main은 **stdout EPIPE만 quiet0을 새 UX amendment로 채택**했고, 기존 cat exit 보존이라 부르지 않는다. producer/head status 증거 및 나머지오류 rethrow를 유지한다. root 역사내용 oracle와 page routing oracle의 주석 범위도 구별한다.
- **b14084 보정 측정 보고:** focused6종 exit0, source24.3초/ok53, manifest1280·91/lane26(install-surface그룹35). main도 정확status1 조건/PIPESTATUS 회수 코드와 두 QK 성공 로그를 직접 읽었다. Astra 재검수 중이며 f5110b로 Opus를 고정 대기시켰다. PARTIAL 약15분은 추정이며 미실행.
- **cef89d 재검수 closure:** exact metadatafail1/healthy refuse2와 EPIPE producer/head 각각0의 증거 연결·두 새 mutant를 닫음. 이는 읽기검수이며 실제 kill을 대신하지 않는다. **07a807**로 slice3의 작은 읽기만 열었다.
- 아직 수정된 후보의 pack/PARTIAL/FULL은 실행하지 않았다. JSON/mjs는 AM(index는slice1)이다. leaf 직접help/synopsis/debt는 slice3 범위 결정 전.

# RECENT — slice1 체크포인트

- 원천: ENTWURF-CLI.json + scripts/cli-help.mjs. 원문 fixture `test/fixtures/cli-help/usage-ce92dc7.txt`: 77018B, sha e67f1cb97e5022b865f525d8fb37e3cd0fd0adac927323efd2f27beb9c9e23e6. **189명령+비명령8줄**이며 초기 보고7줄은 정정됐다. 설명189/실행 inventory279/debt90.
- Astra7b7b2c가 stale peer gate/실제 owner/consumer 증거의 빈틈을 찾았고, f3de83 수정·afee3c 재검수·0a9cde 환경 격리 한 줄 복구로 닫았다. main도 renderer·Bash 정의 조회·음성·consumer_env를 직접 읽었다.
- 첫 manifest RED는 새 subject 미추적이었다. main이 JSON+mjs **두 파일만 stage**해 해결했다. slice2에서는 이 staged bytes와 worktree가 달라질 수 있으며 임의 commit 없음.
- Package df396a: check-pack/check-pack-install exit0, 653파일, installed title 변경/renderer 부재/정확 byte cmp·복원/self-fence PASS. main은 `/tmp/e153h/pack/*.exit`와 로그를 직접 읽었다. 개별 D3 raw 출력은 gate 임시폴더 정리로 미보존. 전후 source/index/dist 동일은 Opus 지문 보고.
- PARTIAL62435c: **install-surface20/20 + peer-facts8/8 KILLED**, controls ok/wrong-reason0/seal stable. main이 두 receipt를 직접 읽었다. 후보 HEAD ce92dc7 + workSurface `19cd03b2c4eace81f8add5daefd71880438822ec393718a00ef20572d368402c`. 이후 NEXT/제품 변경에 적용되는 receipt가 아니다.
- 영수증: `/tmp/e153h/qualification-install-surface.json`, `/tmp/e153h/qualification-peer-facts.json`. 내부 receiptSha256는 각각43e39ef8…/883e9eb1…이며 파일 전체 sha와 다르다. 전체1265 중 해당20/8만 실행했고 전체 qualification/릴리즈 증거가 아니다. 도움말 전체는 아직 완료되지 않았다.

# LEDGER — 돌아갈 근거

- 현재 branch `feat/153-operator-entrance`, HEAD `ce92dc7ac3452357db99c86b3242f822c9fbfb5d`. 이전 design checkpoint c0c432f와 diet 구현 ce92dc7은 정상 훅 커밋이며 push하지 않았다.
- 다이어트: run.sh429줄/제품·proof합계160줄 순감소. `/tmp/entwurf-153-diet.ZHps1u/`의 PARTIAL9/9, FULL922초 exit0, 전후 지문 동일. 원 FULL은 main이 TZDIR를 빠뜨려 RED였고 GLG GO 후 환경만 보충했다. 소스/시간 폭은 고치지 않았다. 이번 help의 FULL로 세지 않는다.
- 초기 논의와 승인·검수·오류 상세는 `/tmp/e153h/NEXT-before-slice2-tighten.md`에 보존했다. 이는 host-local 이력이고 새 현재 지시가 아니다. 새 검증 raw log/receipt는 `/tmp/e153h/`에 보존한다.
- #153은 확장 전에 core를 작고 견고하게 만드는 줄기다. Cloudflare/쿼터/자원 추천은 향후 예시이며 이번 구현 아님. Root CLI 원천은 MCP payload와 분리한다.
- GLG의 garden-id 위키독스35242 원문은 수정하지 않는다. Org/homepage/autholog/export·릴리즈 작업으로 샛길을 열지 않는다. 구조 작업 뒤 의미를 함께 논의할 예정.

# GUARDRAILS

- 현 checkout의 branch만 사용. worktree/개발 clone/새 형제/임의 resume·retire·운영 설정·인증 탐색 없음. 실제 명령들에 `--help`를 일괄 실행하지 않는다. 시험 소유 sentinel fixture만 사용.
- 첫 RED/dependency/wrapper 오류는 원 증거 보존 후 STOP. 명시 GO 전에 자동 수선·재실행하지 않는다. pnpm verify_deps=error, install은 --ignore-scripts. HOME/PI agent/쓰기 가능한 XDG·identity를 격리하고 Nix 시간대에 TZDIR=/etc/zoneinfo를 보존한다.
- pack gate는 기존 prepack build-bridge로 canonical dist를 재생성한다. 따라서 별도 pack GO에 그 부수효과를 명시하고 전후 지문을 확인한다. 최종 FULL 동안 source/index/dist/**NEXT까지 동결**한다. 전체 qualification body는 실행하지 않는다.
- main `20261014T212756-68bd94`, 기기 oracle. commit은 commit 스킬과 GLG 승인 때만, 실제 device와 이미 알려진 참여 garden IDs를 본문에 적는다. push/release는 별도 현재 요청이 필요하다. branch NEXT는 durable 결과 승격 후 merge 전에 삭제한다.
