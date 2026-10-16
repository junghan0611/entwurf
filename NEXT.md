# NEXT — core0.38.0 (#145: coherent Pi SDK1.3.0)

# RAIL — 현재 좌표

- [x] **1. SDK1.3.0 구현·체크포인트** — d25b71e,19파일, source/carrier 불변. focused·독립리뷰·선택 PARTIAL, 정확 branch CI4jobs green.
- [x] **2. 호스트 전환·실제 재개·왕복** — Pi/checkoutSDK1.3.0, GLG 전체 재기동 뒤 동일조율id/cwd, reviewer/author2명 v2응답. GLG compaction 완료 보고 뒤 연속성 확인(내부 prompt 보존 증명은 아님).
- [x] **3. 로컬 main 착륙** — d25b71e FF. 원격 main은 아직2fa0d821(core0.37.1), branch NEXT 보존 후 삭제.
- [x] **4. 0.38.0 prepare·동결 LIVE** — local LIVE r1 GREEN: MUST(비static23) PASS=23 FAIL=0 SKIP=0 UNRUN=0, BEHAVIOR PASS=1. 2026-10-16 14:00:43–14:05:43 KST, 후보 d25b71e+metadata4파일 지문12fca42c 동결=전=후. `.tmp-verify/release-0.38.0/live-r1/`. doctor-meta-bridge PASS(clone-mode operator bin → 이 checkout; tarball/consumer doctor 증명 아님). #145 댓글 issuecomment-6208532928·본문 대체 표시.
- [ ] **5. prepared SHA push·정확 CI** ← CURRENT — 문서 HOLD는 author 최종검토 e3c7b9(B0, D1 반영)·조율자 GO 78a75c로 해제: docs 커밋 → prepare 커밋 → main FF·push 1회. 정확CI 4jobs·태그·발행은 아직 빚. GLG가 main→local검증→CI 진행 승인. source main의 별도 중간 push 없이 prepared commit을 main으로 FF·ordinary push. 같은SHA4requiredjobs가 빚.
- [ ] **6. 최종 artifact·make/publish·Herdr** — 최종 preserved tarball 수용·태그/Release는 해당 mode권한 확인. npm은 별도 GLG 단계. 이후0.38 코어를 물린 Herdr snapshot/사용경로 수용.

현재 좌표: 1–4 완료 → 5 prepare commit·main push·정확CI(이 SHA의 push run이 빚) → 6 GLG와 최종컷·발행·Herdr.

# NOW

- **이번 컷 승인:** GLG가0.38.0·main착륙·local검증·CI를 요청하고, 질문 뒤 local LIVE / prepared-SHA CI static FULL 분담을 새로 승인했다. 이전0.37.1 승인을 상속한 것이 아니다. P4·P5첫static·M0의 로컬 FULL은 PASS가 아니라 CI에 위임된 빚이다. Whole mutant BODY는 돌리지 않는다.
- **준비 파일:** CHANGELOG0.38.0·package.json·필요 시 lockfile·NEXT·runtime-lock의 후보버전 comment만. app/SDK/carrier 추가개발, plugin manifest bump나 npm pin 조작 없음. 원래 구현자 c12925는 inactive. 조율자가4파일 초안을 작성한 뒤 GLG가 '오푸스한테 맡기고 기다리자'고 지시했다. 이후521a11(Opus1)이 릴리즈 실행·metadata 단일쓰기 소유자다. 조율자는 중복 gate/쓰기 없이 증거검토·GO routing·DM만 맡는다.
- **실행:** 기존 `.tmp-verify/release-0.37.1/fix-mux-first/p5-r3/drive.sh` 선례를0.38의 일회성외부driver로 재사용한다. production release_gate의 비static MUST/BEHAVIOR argv·순서·env·cwd·분류를 대조하고 첫MUST RED에 멈춘다. durable fresh LIVE는 이 안에 포함하며 따로 반복하지 않는다. 공식 aggregate를 통째 실행한 PASS라고 부르지 않는다.
- **실행·독립 검토:** executor521a11은 새Codex app-server·0.38 wrapper·비static LIVE·결과기록·prepare commit·승인된main push/정확CI를 소유한다. author ee20b5의62f2ba 읽기전용리뷰가 B0/D0이고 조율자 GO가 나기 전에는 유료LIVE를 시작하지 않는다. server의 정확pid/startticks/seat는 소유launch receipt에서, 모델triple은 gpt-5.6-luna / openai-codex/gpt-5.6-luna. 프로세스검색으로pid를 추정하지 않는다. 태그/Release/npm은 별도mode권한 경계 유지.
- **동결:** LIVE 전 review/수정 완료→HEAD/index/status/worksurface fingerprint. LIVE 동안 source·tracked/untrackedworksurface·index·branch 이동 금지. RED면 later UNRUN을 보존하고 한 amendment만 검토한다. 종료 즉시 P9 읽기전용census·명명된소유process 정리, 임의 전체삭제 금지. 기존synthetic sandbox/로그·대화는 보존.
- **다음 증거:** (local LIVE 실제counts/log·전후fingerprint는 RAIL 4에 기록됨) 준비commit의 exactpush CI4jobs, post-CI preserved tarball과 digest/consumer image. 미실행을green으로 쓰지 않는다. 네CI jobs는 check/install-surface/artifact-consumer/macos-install-surface. branchCI38843056373을 preparedSHA에 전용하지 않는다.
- **issue145:** Stage1 SDK수용만 이번0.38. Stage2 셸고도화·#142 thinking/default/ACP effort는 별도. 필요한 실제LIVE와 착륙근거를 기록한 뒤닫는다. 백업/rollback/운영DB·rawJSONL 조사·추가관리자는 GLG가 범위에서 뺐다.

# RECENT / RECEIPTS

- 0.38.0 LIVE r1: Opus1 소유 Codex app-server 383946(start386136806, session A $497)을 S $498과 분리해 사용, 종료 뒤 TERM1회로 정리(`.tmp-verify/release-0.38.0/codex-server/05-stop.txt`·`06-post-stop.txt`). P9 census는 삭제·kill 없음, 새 entwurf-chain world 1개(AHZBhR)는 기존 async mkdtemp 보존 관찰과 같다.
- core0.37.1/tag/main2fa0d821는 GitHub Release와 GLG npm발행 완료. registry latest/SRI와 보존artifact 일치·registry격리설치 확인. Herdr0.37.1 snapshot은GLG가 생략. 옛 NEXT의 make대기 문구는 현재과제가 아니다.
- d25 SDKbranchCI38843056373:4jobsgreen,620s wall/FULL571s. earlier6kills는 head2fa+dirty SDKdiff6f01+NEXT surface79f961d6의 PARTIAL뿐이며 prepared0.38 coverage아님. receipts5e787c54c298 / dc1abd661323, 나머지973미실행.
- synthetic forward-open `/tmp/opus145-c12925/fwd-open.lT2Zrc/`, checksum39cf9be8…, negative2/writer17/reader16 green, wire0, seal0. 독립612c81 B0/D0. 첫RED SyLwzg보존. 단일quiescent/faux/checkout 사례이지 universal/rollback/compaction/MCPschema교차호환 증명은아님. 비선택대화/SQLite불변이나 검사SDK재열기가 metadata갱신.
- Pi global1.3.0 installphase0, DM564 통지완료. 재설치·통지반복 금지. GLG 재기동뒤coordinator20261014T212756-68bd94 self/cwd동일. reviewer521a11/c69042·author ee20b5/3387f5 실제왕복 수신. oldwriter c12925는 ownerstartkey mismatch 비활성으로 거절; 복구완료로 세지 않음.
- 컴팩트 직후 anchor·NEXT재독/self04:35:19.179Z 대조완료. `.tmp-verify/pi-1.3.0/COMPACTION-ANCHOR.md`. GLG완료보고+관찰된연속성이지SDK내부검출기나vendorprompt순서proof아님.
- 현재 릴리즈외부장부 `.tmp-verify/release-0.38.0/PLAN.md`; 이전branchNEXT `NEXT-before-main-landing.md`. 중요완료·판단은DM(진행나레이션·중복알림은안함).

# GUARDRAILS / NEXT LANE

- 로컬 operational Herdr gates·whole qualification BODY 금지. CI FULL에는 기존Herdr 계약검사가 그대로 포함된다. 실제Herdr 설치/update/실행·npm acquisition 재수용은 core발행뒤plugin snapshot의별도축, 이core LIVE로대체하지않는다.
- records/history/DB/WAL·sandbox증거·Emacs·서비스는보존. 운영세션을자동종료/재시작하지않는다. Codex server는521a11소유신규서버만, 종료도소유자와정확receipt로.
- #142는별도: 기존담당20261014T115640-17d999와 `.tmp-verify/128-kickoff-037/COORDINATOR-142-REENTRY.md`. 이번컷에섞지않는다.
