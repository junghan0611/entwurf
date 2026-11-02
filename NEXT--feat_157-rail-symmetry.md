# NEXT — #157 rail symmetry

# RAIL — 현재 좌표

- [x] **1. Foundation/H1/G1a.** main2917917; feature0e04bf6/c203209 push와 exact-SHA CI.
- [x] **2. Herdr Pi same-id 복귀 n=1.** no-new-prompt/recall 관측, docs2aaf856.
- [x] **3. pi-durable × Herdr 개발·로컬 검증 묶음.** public same-id 채택·Terra 회상 n1, 종료 정리·R17·귀속 하네스 보정, 마지막 FULL/package green. 릴리즈/운영 갱신 수용과는 구분한다.
- [ ] **4. 요청한 로컬 커밋 → 기존 형제 합동 검수·보정 → Claude Code 대칭·entwurf 커맨드 통합.** ← CURRENT. 목표 **0.50.0**, push/version/tag/release/운영판 업데이트는 별도 지시.

# NOW

- **사용자 최신 요청:** 현재 미커밋 전체 검수 → 커밋 → 합동 검수. main은32파일(29tracked+3untracked)을직접검수했다. blocking없고 **P2두건을고치지않고공개한로컬checkpoint**로남긴다. 검증된productionbytes는변경안함. 이NEXT는완료한floor뒤handoff좌표만갱신했다. 루트NEXT/ROADMAP/CHANGELOG는변경하지않는다.
- **다음:** 로컬커밋완료를git log/status로확인 → notebook코디b22677·기존Terra·기존구현/검수형제들에게같은SHA로유한source/doc검수. 수정전발견사항을main에모아 **한보정bundle**로결정,새모델/운영probe/장시간gate를각자돌리지않음. 기존Terra의owner-facts관측: **20261101T123618-a20739**,exactcwd=이repo,backendpi/alive/modelopenai-codex/gpt-6.1-terra(13시대현재관측). 임의resume/fresh대체없음.
- **열린P2(커밋의knownnonblocking후속):** (1) entwurf-v2-visible-resume.ts824–826 철회실패catch가무조건‘예약유지’를단정. donorprojectioncommit뒤tx-release-failed면실제claim은이미복원될수있다. unknown상태를단정하지않는오류안내/한정회귀가필요. (2) 지원domain확장뒤README118/docs-durable-native-support67/AGENTS74·126 등live문서가pi·Claude-only로남음. 합동문서보정으로닫되역사oracle/이전실측은수정하지않음. **이둘은해결됐다고말하지않으며출하/운영갱신전열린사항**.
- **주검수 근거:** `/tmp/e157h/s3-carrier-a1/main-review-before-commit.md`(32파일/current source 직접판독,상속실측구분). root74를다시돌리거나sourcefix를몰래추가한것없음. userrequestednative review 도구는이대화검수준비일뿐독립reviewer/자동fixloop아님.

# 완료 증거 — 후보를 합치지 않는다

- **마지막 FULL(lead915040 8aee9e/main원receipt전문+exit/tail직접판독):** [portable6568776991](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6568776991), DM883. `/tmp/e157h/s3-carrier-a1/RECEIPT.md`d3c34dbe…。candidate **fd795676**(HEAD46c7c776+미커밋productiondiff,noNEXT). full-r1 12:45:32→13:01:52KST/**978s exit0**,core(lint/4types/vitest/root922/contracts)+hermetic+package/check-pack **664files/invariants pass**. qualification body가아니다.
- **최종 carrier PARTIAL:** candidatefd795676에**51/51 KILLED**,controls green,1643s. receipt d15d3d5e…。SELF-CLOSE mutant는이제ownQK로실패. unmutatedcontrol carrier62/type/lint/manifest1471 통과. 단일mutantdiag복원741files동일/Fablea743ce B0/D0/O2. 이전report전abort→QKskip은APP_ORACLEchosen reason기록+returned재단언한leaf로수선했고원가드/원SELF-CLOSE assert는그대로.
- **원0b0c728e의별도PARTIAL:** agent-guidance14/mux-resume17/v2-visible-resume80/PD-beside51/root74 green,carrier50/51 RED(WRONG-REASON). root **8424s/140분**은한번만실행,최종후보의kill로재명명안함. carrier하네스만달라root74의ownsubject/signature/oracle불변,새FULL에서rootunmutatedcontrol922를확인하는범위로main995784수용. root의너무넓은922테스트×74변이좌표는향후별도좁힘대상이지현재전체재실행이유아님.
- **FULL 원red/복구:** full/287s는coregreen뒤hermetic freshness red/package未실행. test.ts수정뒤managedbuild누락이원인. main6bc155로정상build1회후dist全99files/108entries의keyset/mode/bytes동일+새mtime검증→새frozen FULL green. 원실패raw보존. 성공floor의check-pack도declaredprepackbuild를실행해distmtime108개가13:01:48로변경됐지만source/index/Next/pin과distbytes는동일. **mtime불변인것처럼말하지않음**.
- **종료 잔류/API0:** `/tmp/e157h/s3-linger-r1/RECEIPT.md`b23bcc11…。pi-ai1.4 Codexsocket의ref'd5분idlecache,loopback/fake-token/vendor0/profile0에서cleanup전20s timeout124→정상cleanup후0.44s/handles[]。ownedruntime close finally `cleanupSessionResources()`/canonical emission·pin/WIRE_ORACLE연결종료QK로수선,강제exit/kill/새종료manager없음. R17문구도reviewedliteral층/Fablefcc4d1 B0/D0/O6,원oracle재생성안함.
- **실 Herdr public n1는이전82b5ec36후보:** [portable6566126053](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6566126053)/DM872, `/tmp/e157h/s3-pd-live-r1/RECEIPT.md`71c21b37…。T **20261102T091526-fdad9c**,N **1793578526845-ff5d0b8a-774c-4608-ae85-19fa17ea3bbd**. publicfresh→ACK→SDKclosed/released→target-onlypublicresume→ONE layout.apply/newtab→1503msadopted/newbinding+childowner→fact없는질문에 **scene-ember-0aa81435** 회상. resume새prompt없음,seed1+recall1/callers는합성fixture·모델turn0。10pids/2socketsgone/기록보존。종료수선전vendorLIVE를최종후보재실측으로바꾸지않는다.
- **LIVE허가:** 지정model **openai-codex/gpt-6.1-terra**,기존인가SDKprofile정상사용+새testcwdhash **72ded2f1571884c1945f79dd** 아래N1개만;인증과session이같은profile인제약을설명하고직접승인받았다. credential복사/symlink/proxy없음。HOME/XDG/meta/control/locks/socket/Herdr는private,운영설치/기존시민안건드림。SDK정상tokenrefresh가능고지/OAuth실제쓰기未測。운영업데이트·직접사용은사용자가나중에한다.

# 계약·남은 출하 경계

- 원계약 `/tmp/e157h/B3-RESERVATION-ADOPTION-CONTRACT-L2.md` + `...-L3-A1.md` **9166b9ff3d57fc8be2ab6ef407ffdf19c5f0cb365b0a0b1f7e58a279a54cb15b**. 실제fullfilename사용. record단독주소;parentper-target→arm→S_D/childarm→S_D/lease전내부lock해제;Rphysicalclaim/tx와Slogicalsidecar분리;rawprofile1+표준metaRoot파생4 fixed5;closed`--entwurf-adopt {v:1,gardenId,metaRoot,sourceGeneration}`。definite-nonecreated에만ownreserved철회,unknown유지;adopted는ready/turn성공이아님,readfailureunobserved。
- **未測/비승계:** finalcandidate의tmuxactual/실OAuthwrite/SQLite내용/G-abandon/운영readerrollout/exact-SHA CI·registry/releaseacceptance。QK4는cache/precheck자체가없어행동subject없는구조GAP。ownerclaim schema2/필수profile로구reader는새claim거절,롤아웃정합성필요。로컬FULL을실제배포/운영업데이트승인으로말하지않음.
- sourcecheckpoint부모HEAD **46c7c776c7fed9001be4498ea024cfd214f4347f**,branch **feat/157-rail-symmetry**. 이전I2 [6565190492](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6565190492)/DM869,I1 [6564439775](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6564439775)。로컬커밋요청만있고이번push/agenda/version/tag없음.

# 역할·안전

- main **20261014T212756-68bd94** 전체coord/NEXT/commit/DM,lead **20261030T190810-915040**,public·launch/doc **20261102T081752-169dd1**,독립검수 **20261102T063827-dff8a1**. 둘직접협업/lead↔Fable라우팅명시허용. 합동검수도한coordinator로모은다. notebook **20261007T132839-b22677**에게원portable/실측범위remoteFYI완료,별도implementationlane은열지않음.
- **Astra567753 추가호출금지**, **PiOpus150a5e 연락/resume/retire금지**. 이미켜진Terra만현재alive근거로확인,임의잠든기록/새모델로대체없음. 운영시민종료·프로필/SDK/PATH/설치·SSH/자격증명조작없음. SQL직접읽기·복사·수선/전수scan/lockrepair·TTLwatcher없음. rootNEXT/ROADMAP/CHANGELOG/Org변경금지.
- offline env-i/privateHOME·PI·XDG5/두verify_deps_before_run=error/**CI추가금지**. 정상hooks/scanner우회없음,이checkout/branch만개발。긴검증전구획·실측기반예상·재실행이유를먼저알림。실제hash/build/type/test/IO오류는raw/actualexit로STOP,단순nomatch와구분/정확주소한번교정허용。과거read/formatter/assert/사후계속/역재구성실패와모든원red는receipt·portable에보존,나중green으로소급clean주장안함。
- `g3-pd-birth-r1/raw/s06-ss-all.tmp` 격리유지。branchNEXT는durable승격후merge전에삭제。
