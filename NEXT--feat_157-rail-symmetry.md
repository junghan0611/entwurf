# NEXT — #157 rail symmetry

# RAIL — 현재 좌표

- [x] **1. Foundation/H1/G1a.** main2917917; feature0e04bf6/c203209 push·exact-SHA CI.
- [x] **2. Herdr Pi same-id 복귀 n=1.** no-new-prompt/recall, docs2aaf856.
- [x] **3. pi-durable × Herdr 개발·로컬 closing 완료.** public resume/recall n1, 합동 보정4건, 영향 PARTIAL4그룹, XDG5 FULL/package991s PASS. 출하·운영 수용은 아니다.
- [ ] **4. Claude Code 대칭·entwurf 커맨드 통합.** ← CURRENT: read-only 준비, 구현 착수 전. 목표0.50.0; push/version/tag/release/운영 갱신은 별도 지시.

# NOW

- **현재:** GLG “커밋푸시하자. 일단 3번 여기서 닫고, 4번을 준비하자.” 최종 보정의 구현 기준은 local checkpoint **43594eba588a51bdb9d58a4631e3ebc7b3a235ea**, branch `feat/157-rail-symmetry`; 정확한 최신 HEAD/upstream은 git log로 확인한다. main은 정상 commit/push 담당이며 source floor 완료 뒤 handoff만 갱신했다. root NEXT/ROADMAP/CHANGELOG/Org는 그대로다.
- **다음:** [stage3 closing 원문/한계](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6570499114)를 먼저 읽는다. 169dd1에게 **4번 read-only 준비만** 요청했다: CC 현행 gap/source 좌표, 통합 CLI의 실제 다음 사용자 행동, 첫 수동 측정·좁은 leaf 제안, 추가 승인 경계를 외부 artifact로 반환. 완료한 H1/help/R18/PD3를 다시 개발하지 않고, 새 전수 matrix·검증도구·manager부터 만들지 않는다. 구현·native/LIVE·운영 갱신은 아직 착수하지 않는다.
- **닫힌 보정:** 철회/예약 write 뒤 release 실패의 관측 가능한 상태만 보고; live 예약 부모와 실제 addressability 구분; PD resume 지원 문서·R18 정합성. guard·lock 순서·identity·영속 schema·retire domain 불변. Fable d17f30의 최종 raw 조건부 문구/미측정 test-title 두 건도 한 보정으로 닫았다.
- **멈출 선:** 검증 도구를 별도 개발 과제로 키우지 않는다. 외부 일회성 FULL driver만 수선했고 Fable d60fa0 B0/D0/O5의 조건부 수용/추가 probe 금지 권고로 종료했다. **중단/SIGKILL 경로는 미증명**이며 정상 run의 PASS를 그 증명으로 확장하지 않는다.

# 완료 증거 — 후보를 합치지 않는다

- **최종 FULL-r2:** `/tmp/e157h/s3-joint-a/full-r2/result.txt` SHA `2e68d808…`: commandExit0 / elapsed991 / 2026-11-02T15:13:54+09:00 / reasonsnone / driverExit0. 시작14:57:23. main이 result·command.exit·최종 stdout을 직접 읽고 표준 cmp3쌍을 직접 확인했다. core+hermetic+package, check-pack664files/invariants PASS; whole qualification body가 아니다. stdout `16a6fd47…`, driver `5d807a16…`.
- **후보/동결:** HEAD43594+미커밋 tracked diffNoNext **0c420b33…**(1361행); PARTIAL workSurface **eede92f3dc48be712775a04396fbb91adb332966b58b93e358169fea162b6f39**. candidate=pre / pre=post / untracked proof2파일 전후 동일. dist99files/108entries의 keyset/mode/size/bytes 동일; 알려진 prepack으로 **mtime108개 이동**. 실행 완료 후 NEXT 갱신을 당시 동결 증거와 구분한다.
- **최종 영향 PARTIAL:** visible-resume 88/88 KILLED (230.269s, `3634eaeb7043…`), guidance 14/14 (40.285s, `997eb11e3be3…`), surface 20/20 (13.432s, `d63c171fe084…`), mux-resume 17/17 (9.855s, `65daf45dfff2…`). `/tmp/e157h/s3-joint-a/partial/*.receipt.json`; 모두 controlok/clean/stable/동일surface, main이 원JSON·각rc0 직접 검산. 새8변이는 좁은 기존 reporter 좌표에 포함했다.
- **이전 후보 증거:** old0b0c의 root74(140분)/PD-beside51 등과 fd795의 carrier51은 각 후보 그대로 보존, 새 kill로 승계하지 않음. main은 oldroot74 entry·원oracle·37owner anchors와 guard 결정 불변, 새 QK의 좁은 좌표를 확인해 root74 재실행을 제외했고 최종 FULL은 unmutated930을 확인했다.
- **실제 Herdr public n1:** [6566126053](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6566126053), `/tmp/e157h/s3-pd-live-r1/RECEIPT.md`71c21b37, 후보 **82b5ec36**. T `20261102T091526-fdad9c`, N `1793578526845-ff5d0b8a-774c-4608-ae85-19fa17ea3bbd`. fresh→ACK→SDKclosed/released→target-only resume→ONE layout.apply→1503ms adopted→`scene-ember-0aa81435` 회상. seed1+recall1만 실제 target turn, caller들은 합성 fixture. 기록·새 native directory 보존, private10PID/2socket 종료 확인. 최신 후보의 LIVE로 바꾸지 않는다.

# 실행 incident — 원기록 보존

- copied FULL driver 계보는 XDG_RUNTIME_DIR를 빼고 **XDG4**였다. [이전 fd795 FULL978s/exit0](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6568776991)의 측정값은 유지하되 XDG5 준수 주장은 철회한다. 이번 첫 FULL도 main 요청으로114초에 중단; 제품 test RED가 아니며 actual.exit/elapsed는 **미기록**이다. final-r2만 XDG5/정상 완료로 수용.
- driver 수선의 fake 정상/실패/log-open은 측정했고, **중단 probe3회는 driver에 signal을 못 보낸 실패**라 PASS가 아니다. 4번째 시도 금지. repo/sharedseal.py/gate/mutant/framework 수선으로 번지지 않았다. `/tmp/e157h/s3-joint-a/driver-r2/RECEIPT.md`, `/tmp/e157h/s3-joint-review/FULL-DRIVER-REVIEW.md`, `RESULTS.md`에 원한계·복구 기록.
- earlier carrier WRONG-REASON50/51, freshness287s RED/managed-build recovery, formatter/assert/read/추측주소/사후계속 실패는 원 receipt·portable에 보존. main 임시 anchor checker의 요소별 count 오류도 정식 runner의 join("\n") 계약으로 1회 교정했으며 원실패를 지우지 않음. 나중 green이 이전 절차를 소급 clean으로 만들지 않는다.

# 계약·남은 수용 경계

- 계약 `/tmp/e157h/B3-RESERVATION-ADOPTION-CONTRACT-L2.md`와 `B3-RESERVATION-ADOPTION-CONTRACT-L3-A1.md`(SHA9166b9ff…). record 단독 주소; parent per-target→arm→S_D / child arm→S_D; lease 전 내부 lock 해제. R physical claim/tx와 S logical lease 분리. raw profile1+표준 meta roots4의 fixed5, closed `--entwurf-adopt {v:1,gardenId,metaRoot,sourceGeneration}`. definite-none-created에만 own reserve 철회, unknown 유지; adoption≠ready/attach/recall.
- 실제 profile 승인은 정상 SDK auth+test cwd hash **72ded2f1571884c1945f79dd** 아래 새 N1개만이었다. credential 복사/symlink/proxy 없음. 인증과 native data가 같은 profile인 제약/정상 token refresh 가능 고지 후 직접 승인. 추가 모델 turn/LIVE 권한이 아니다.
- **미측정:** 최종 후보의 actual tmux/Herdr·실 provider-close/실 CC caller/실 OAuth write/SQLite 내용/G-abandon/운영 reader rollout/exact-SHA CI/registry·release acceptance. provider socket close 수선은 loopback/fake-token API0 증거이며 실제 vendor 재측정이 아니다. schema2/필수profile의 reader 정합성도 운영 rollout에서 별도 확인한다.

# 역할·안전

- main `20261014T212756-68bd94` coord/NEXT/commit/DM; lead `20261030T190810-915040`; public·launch/docs `20261102T081752-169dd1`; 독립 Fable `20261102T063827-dff8a1`; Terra `20261101T123618-a20739`; notebook `20261007T132839-b22677`. 별도 coordination lane/임의 신규 형제 없음.
- **Astra567753 추가 호출 금지 / PiOpus150a5e 연락·resume·retire 금지.** working citizen 종료·SQL 직접 읽기/복사/수선·전수 scan·lock repair·SDK/profile/auth/PATH/install/SSH 변경 금지. 격리 `g3-pd-birth-r1/raw/s06-ss-all.tmp`는 미열람 유지.
- offline env-i/privateHOME·PI·XDG5/verify_deps_before_run=error 두 개/**CI 추가 금지**. 이 checkout/branch에서만 개발; worktree/개발 clone 금지. 긴 실행 전 범위·예상·이유 고지; 실제 오류는 raw/관측 exit 보존 STOP, unknown exit를 발명하지 않는다. 정상 hook/scanner 우회 없음. push/agenda/version/tag/release/운영 갱신 별도 승인. durable 승격 뒤 merge 전에 branch NEXT 삭제.
