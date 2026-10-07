# NEXT — #130 / 0.32.0 설치면

# RAIL — 현재 좌표

- [x] **1. 기준선·방향·형성** — 0.31 종료, Pi 1.0.4/npm 설치 단순화/완전 목업. 실제 env-loader는 release 후 agent-config.
- [x] **2. P1 공급 체크포인트** — local `da8450ec77eb64383648ee835768e6427e49bd76`, source+proof/hook/scanner PASS. Push·최종 후보 수용 아님.
- [x] **3. Host 업데이트·경고 결정** — actual Pi CLI 1.0.4, 동일 a30dda 재실행. GLG가 경고를 알려진 제약으로 수용(D-A); 설치 detour 닫힘, 추가 측정/포장 변경 없음.
- [ ] **4. P2 native 목업 구현·리뷰·체크포인트** ← CURRENT: GLG가 generic placeholder 수선/normal retry 승인. 같은 beside105 PASS, coordinator 정상 scanner/hooks local commit 재시도.
- [ ] **5. 최종 0.32 수용** — 필요한 changed qualification 1회/frozen FULL/native vendor LIVE/exact-SHA release floors. Version/release/push/publication은 별도 권한.

# NOW

- **Stem:** 0.32를 잘 닫는다. 상류 변화 추종이나 경고 한 줄 제거를 위해 설치 체계·하네스·검증 프레임워크를 늘리지 않는다.
- **Next:** 정상 scanner/hooks local P2 commit 재시도→새 receipt 확인. GLG 직접 승인으로 test-only local 변수/literal을 generic marker로 변경, 값이 오류 문구에 노출되지 않는 assertion은 유지했다. Production subject/QK/mutants 불변, coor beside105 재실행 PASS(19:13:42 KST). 새 digest/receipt `p2-commit/retry-1/`; 원 scanner RED/scrollback 보존. Unsafe override/bypass 없음.
- **Accepted review:** Amendment SHA701b0a58…6947, files v2 SHA d28a8267…197b 확인 완료; v1 대비 setup prose/send oracle만 수정. Native15/raw7 logs digest OK, 이후 marker test만 추가 수선(v2를 현 tree에 소급하지 않음). 리뷰 `coordinator-p2-review.md`/`p2-commit/retry-1/authorization.md`.
- **P2:** 명시 CLI module 1개/일반 ESM init+native Extension default 그대로/import 전 identity+cwd guards/node:* synthetic fixture. Beside8 exactmutants(lane47/전체897), scripted S+native H는 기존 **send** gate native-module cell 소유, installed pack-install 별도. Coor focused beside105 PASS. Bridge env spec까지만/optional static-env receipt UNRUN. ClassicAPI shim/새 plugin grammar/profile/fresh_call 입력 확장/실제 dotenv·agent-config 없음.
- **Final proof 책갈피:** 최종 후보 checkout SDK focused checks에 `ENTWURF_PI_DURABLE_SEND_CELL=native-module`을 명시한다. 기본 send cell과 혼동하지 않는다. Body/FULL/vendor LIVE는 아직 미실행.
- **State:** branch `feat/130-install-surface`, HEAD da8450e, package0.31.0 유지. SDK9개 exact1.0.4+proper-lockfile4.1.2, pinned strip carrier6개+LICENSE. Postcommit conventional dist build PASS. GLG가 operator CLI를1.0.4로 업데이트; a30dda self08:24:43Z alive/replyable. 전체 cachedSDK/NativeLIVE 인증으로 올리지 않는다.
- **Warning:** root manifest가 host extension과 별도 native 앱 공급을 겸해 기존 Pi 선언 검사가 경고한다. Native용 SDK copies는 의도지만 hostloader bypass는 의도 아님. Known constraint 문단을 P2 owning docs에 남긴다. 전체 무해함/peer*계약 준수/새 버전 수용 주장 금지. 실제 사용 문제가 있으면 근거로 후속 upstream 요청 판단; 2주 자동 예약/현재 issue·PR 생성 없음.
- **Commit:** GLG rolling checkpoint 허가 유지. Scoped review/affected checks→normal hooks+shared scanner→coordinator commit. Opus 임의 stage/commit/push 없음; local commit에 agenda stamp 없음. 최종 qualification/FULL/LIVE floors는 interim green으로 상속하지 않는다.
- **Protect:** 원 checkout만 개발, fake fixtures는 증거. Operator auth/settings/records/transcripts/SQLite/Emacs/old runtime/원 RED/foreign hosts 변경·cleanup·hidden repair 금지. Branch NEXT는 coordinator 소유, main NEXT 미변경; merge 전 branch NEXT 삭제.

# RECENT

- P1 depth3 reachable SDK closure/name 검증·공유/중복/cycle, operator registration 불변 guard 수선. Contact91/send19/receive21(S+H), independentbeside96/emit equality PASS. SDK/consumer closure 증거와 native vendor LIVE는 별개.
- P1 staged head241 selftests/889 mutants/69 lanes PASS, body0. Strip padding은 좁은 `.gitattributes`로 보존, 11 missing build 선언 통일. 모든 failed attempts/raw 유지; local checkpoint60 files.
- Host warning 원인 Opus05ec561a…f142, 완료 후 STOP 영수증4b55e924…0701, Fable 권고9fae2fb2…2d01. Help/open·일반 RPC startup 증거는 active `--entwurf-control`/MCP child/HEAD-exact consumer/turn 전체 인증 아님. 추가 strace oracle는 미채택(native installed cell에서는 native SDK opens가 정상).
- GLG D-A 결정과 P2 복귀: [#130 comment6035028937](https://github.com/junghan0611/entwurf/issues/130#issuecomment-6035028937). 경고 제거 목적 package 재편과 무관 workspace 잔재2행은 이번 구획 제외.
- P2 첫 checkpoint/리뷰·2곳 수선 경계: [#130 comment6035644467](https://github.com/junghan0611/entwurf/issues/130#issuecomment-6035644467). 아직 P2 commit은 없음; 수정 receipt 확인이 다음 한 걸음.
- DM433 discussion-ready/DM434 restart-ready 각1회 전달 완료. 재발송·peer 중복·진행 DM 없음.

# SOURCES / GUARDS

모든 `.tmp-verify` 경로는 `.tmp-verify/032-implementation/` 아래:

- `p2-commit/blocked.md`, `p2-commit/first-attempt.screen.txt`, `exit.rc=1` 보존. Retry는 새 dir를 tee 전에 mkdir. GLG 승인 후 `p2-commit/retry-1/authorization.md`, `final-files.sha256`, `beside.log` 사용.
- `coordinator-p2-review.md`, `opus/p2/checkpoint.md`, `opus/p2/p2-files.sha256`, `opus/p2/raw/`; 새 amendment `opus/p2/checkpoint-amend.md`, `p2-files.v2.sha256`, `raw-amend/`, `raw-amend.sha256` 확인 완료.
- `p2-implementation-grant.md`, `p2-proposal-review.md`, `opus/p2/p2-proposal-v3.md`, `fable-scope-discussion.md`, `issue130-warning-decision-p2.md`.
- `p1-commit/accepted.json`, `p1-commit/retry-2/run.log`, `post-p1-build/`, `coordinator-p1-review/final-files.sha256`, `receipt-state.md`. 덮어쓴 원 repro JSON 재구성 금지; 원 stdout+새 독립 receipt를 사용.
- [live #130](https://github.com/junghan0611/entwurf/issues/130), `AGENTS.md` Hard6/9/17+checkpoint cadence, `docs/durable-native-support.md`, `VERIFY.md`.
- Coordinator a30dda, implementer Opus66f712, Fableff2015 이번 readonly 논의 종료/STOP. 별도 peer-to-peer lane/새 형제 없음. OlderOpus27ebf3 해제; 늦게 온 STOP/실패 알림을 최신 권한으로 해석하지 않는다.
- 0.31 tag a2c1aad/tar7a03bbe0…5c9f/archive immutable. 새 pin/모듈은 그 release green을 상속하지 않는다.
