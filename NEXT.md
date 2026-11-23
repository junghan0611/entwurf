# NEXT — 0.62.0 shipped (Pi SDK 1.6.0, #172); Herdr pinned to 0.62.0

**현재 (2026-11-23):** #172(Pi SDK 1.6.0 + pi-durable carrier)가 main에 들어왔고(브랜치 fast-forward, 마지막 코드 커밋 `9d7aa52e`), 운영 창 2부도 끝났다. 0.62.0이 npm `latest`이고 Herdr lock도 0.62.0을 가리킨다. 역할: 운영코디 `20261014T212756-68bd94`(pi-durable), main writer·릴리스 실무 `20261113T043350-ff08d4`, prepare 실무 Opus `20261120T213316-793499`, 설계·수정 Fable `20261121T180949-b6d8f7`, 리뷰 Sol `20261121T135110-09fa15`.

# RAIL — 현재 좌표

- [x] **1. #171 병합.** `0d8c22d9`(exact-SHA CI run 44978371312 4/4, #171 닫힘). U4·U16은 #156으로 미뤘다(댓글 7069232824). 커밋된 main sandbox LIVE: Claude·agy 각 pi-smoke 15/15, pi-unknown 12/12(n=1, `~/.local/share/entwurf-lab/171/main-cover/`).
- [x] **2. 문서 검토.** `d40a8779`(Sonnet 가독성 + Sol 코드 대조 D1–D6), Herdr checkout carrier `2c6df36e`.
- [x] **3. prepare 0.61.0.** 첫 후보 `2c6df36e`는 P5 MUST 23/2/0으로 red(`smoke-mux-lifecycle-live` pi-acp 행: 턴 중 창을 닫으면 죽은 holder lease로 재부팅 전까지 STOP / S2d smoke가 #171 host 계약 이전). Fable 수정 `12e54b5c`(증명된 죽은 holder·agent·process group이면 lease 인계, 같은 machine·boot·pidNs)·`2b31b8c6`·`bc88aa91`·`213be3a3`(lane inventory 66→69), Sol 수락. 재후보 `e1e43354`: FULL 1156s, P5 MUST 25/0/0 BEHAVIOR 1/0/0, OpenClaw home receipt `receipt-0.61.0-213be3a3`, GLG 사용 시나리오 LIVE n=1(`171/f12/f15-two-send.log`). 증거는 CHANGELOG 0.61.0 Release evidence.
- [x] **4. make → publish.** exact-SHA CI run 45003209370, Windows preview run 45004229146, candidate sha256 `3bfe8a55…fbfe1a`(container 수용), tag `v0.61.0`, GitHub release. GLG npm publish; U2 latest=0.61.0/repair 유지, U3 registry 설치 6행. gog 알림은 토큰 만료로 실패.
- [x] **5. Herdr re-pin.** `df92c155`(`runtime-lock.json` npm 0.61.0, registry sha512 = integrity), exact-SHA CI run 45007351262 4/4, snapshot `v2026.11.22-herdr.0.61.0` GitHub release(latest는 v0.61.0 유지).
- [x] **6. #172 Pi SDK 1.6.0 + pi-durable.** 구현 Fable, 리뷰 Sol 3회, durable 판독 Opus. frozen FULL `9d7aa52e` 1151s. PARTIAL은 dep-versions 12/12, pack-pin-matcher 2/2, acp-prompt-lifecycle 15/15, acp-set-model-readback 206/206(`2c59d4a0`), pi-durable-carrier 65/65(`3dfd0ead` work surface `8508192d…`). M1 fixture `pi-extensions/lib/fixtures/pi-durable-sdk152/`. 영수증 `~/.local/share/entwurf-lab/172/`, #172 댓글.
  - **운영 창 2부 (2026-11-23 07:05 KST, GLG 승인):**
    - 전역 pi: `pi update --self`로 1.5.2→1.6.0, exit 0. updater가 `minimumReleaseAge=0`을 스스로 넘긴다. 이때 SDK는 약 59시간 된 상태였다.
    - 점검: `doctor-pi-package` owned, `doctor-pi-provider` ok.
    - durable 저장소: 열기 직전 manifest가 백업과 같았다(`3bff6531ece1260b`).
    - 68bd94: `entwurf pi-durable --session <native id> --native-module …/agent-config/pi-durable/index.mjs`로 같은 id로 재오픈했다. `entwurf_resume_call`은 module을 빼고 연다. `entwurf_self` 왕복은 13초였다(n=1).
- [x] **7. 0.62.0 cut.** prepare `9dfe3fa0`: FULL 1160s, P5 MUST 25/0/0 BEHAVIOR 1/0/0(Codex managed daemon 381279 재사용, GLG 지시), OpenClaw home receipt `receipt-0.62.0-0dbcf114`, dep-versions PARTIAL 12/12. README에 ACP 꼭지(Fable·Sol·68bd94·Opus 리뷰). make: exact-SHA CI run 45086261925 4/4, Windows preview run 45087432832, candidate sha256 `2220d0cb…`(container 수용), tag `v0.62.0`, GitHub release. GLG npm publish; U2 latest=0.62.0/repair 유지, U3 registry 설치 6행. gog 알림은 토큰 만료로 실패.
- [x] **8. Herdr re-pin 0.62.0.** `805fce26`(`runtime-lock.json` npm 0.62.0, registry sha512 = integrity; 0.61.0 region은 이전 pin으로 유지; setup guide·ACP/mux rail·ROADMAP floor 줄의 "미출하 후보" 문구 정리), exact-SHA CI run 45090634277 4/4, snapshot `v2026.11.23-herdr.0.62.0` GitHub release(latest는 v0.62.0 유지).
- [ ] **9. 다음 레일.** ← CURRENT. GLG가 고른다. 아래 미측정·남은 후보가 재료다.
  - 미측정(이월): installed-consumer LIVE(1.6.0), RPC 세션 교체의 socket 수·switch/fork, summary 실패 때 원문 유지를 고정하는 테스트, Codex 외 provider와 비정상 종료 때 소켓 해제.
  - 남은 후보: `agy-adapter.test.ts:320` sandbox 회수(floor마다 4개). release skill P9의 OWNED 목록이 `pi-extensions`·`plugins`의 `mkdtempSync` 접두사를 읽지 않는다(이번 cut은 확장해서 회수). 68bd94 관찰: rail:673이 옛 #168 new-after-compact를 provided로 적는다(현재 계약과 어긋나 보임).

**0.62.0 cut 관찰:** U3 registry 설치에서 npm 11.16.0이 `allow-scripts` 정책으로 entwurf `postinstall`(chmod)을 돌리지 않았다. tarball이 이미 실행 비트를 갖고 있어 영향은 없었다.

**0.61.0 cut 관찰:** 턴 중에 창을 닫은 LIVE 실행 두 번이 operator HOME에 fixture holder lease를 남겼다(`~/.pi/agent/entwurf-acp-holders/claude/` `e505…`·`f531…`, 지우지 않음; `e505…`는 pidNs 없는 옛 형식이라 재부팅 전까지 인계되지 않는다). 두 P5가 각각 `/tmp/entwurf-s2b-overlay-*` 한 개를 남겼다(P9에서 회수). PARTIAL은 공유 checkout에 mutant를 실제로 심는다(`mutation-qualify.ts:921-944`) — 도는 동안 FULL·LIVE·OpenClaw 실측을 같이 돌리지 않는다.

**0.60.0 cut 관찰:** `pi-extensions/lib/acp/agy-adapter.test.ts:320`이 `/tmp/acp-agy-thinking-*` sandbox를 지우지 않는다(P9에서 112개). prepare 체크리스트에서 Herdr lock 전환과 `docs/setup-clean-host.md`·`docs/durable-native-support.md` 버전 문구가 빠지기 쉽다(이번에 둘 다 놓침; 후자는 `PI-FLOOR-PUBLISHED-SCOPE` mutant 앵커와 묶여 있다).

# #164 Orca 증거 (노트북 lane에서 승격, oracle은 Orca를 설치하지 않는다)

- 측정 요약: #164 댓글 6906503079 — orcad v1.4.259 + 페어링된 GUI 클라이언트에서 `entwurf claude`·GUI가 띄운 plain Claude Code·`entwurf pi` 왕복 각 n=1 성공. Claude Code는 메일을 자동으로 읽되 실행은 pane 사람 승인 뒤, Pi는 즉시 회신.
- 소비자 수용: #164 댓글 6907955407 — README만 받은 새 Sonnet이 sandbox HOME에 npm 0.55.0 설치 → setup green → Orca 터미널 시민 출생.
- 영수증 원본은 노트북 host-local(`~/.local/share/entwurf-lab/164/*/receipts`)이다. 시험 자원은 회수했다.
- GLG 결정: 코어는 npm pin 설치, Orca 플러그인은 npm 패키징하지 않고 안내 문서만 둔다(점검 스크립트 없음). 대상 하네스는 pi·claude-code, opencode는 범위 밖.
- 0.55.0 소비자 관측(노트북): pi 첫 record·상태줄 모델이 `claude-fable-5-1`이었다(턴 실패 여부 미측정). 시작 화면에 `Extension issues … peerDependencies` 경고가 뜨지만 동작에는 지장이 없다(아래 U3 경고와 같은 것).

# NOW

- **역할 (2026-11-20):** 운영코디 68bd94, ff08d4 main writer·릴리스 실무.
- **운영 관찰:**
  - oracle의 pi는 이 checkout을 package로 로드한다(`pi.extensions`가 `.ts` 소스). 새로 뜨는 pi는 미커밋 작업트리를 그대로 쓰고, 편집 중간 상태에서 뜨면 entwurf provider 전체가 등록에 실패할 수 있다. MCP bridge는 dist라 `build-bridge` 전까지 src/dist가 어긋난다(#167 리뷰 895788 관찰, #165 맥락).
  - 새 backend를 store에 처음 쓰기 전에는 installed writer 전부(`doctor-codex-birth`는 helper bytes staleness를 보지 않으므로 `install-state.json`의 unit 버전도), omp·copilot doctor를 확인한다. 0.55.0 cut에서 Codex birth helper(0.41.1)·OMP·Copilot receive가 `openclaw` record를 보고 store 쓰기를 거절했다.
  - `doctor-omp-receive`는 receive 로그에 남은 `arm-gave-up` 줄을 평생 센다. 한 번의 실패가 영구 RED가 된다(0.55.0 cut에서 로그를 보존용 이름으로 바꿔 넘김).
  - Codex vendor managed daemon은 seat pane이 죽어 있으면 `smoke-codex-fresh-live`가 A 좌표를 해석하지 못한다. cut은 `entwurf codex-app-server`를 전용 tmux에서 띄워 측정한다. daemon 복원은 GLG가 결정한다.
  - `check-acp-backend-preflight`가 thinking level 없이 backend를 부른다(b3 O1).
  - `*resume-call.test.ts`가 `/tmp`에 디렉터리를 남긴다(P9).
  - U3 registry 설치 경고: host-provided pi 패키지는 `"*"` peerDependencies여야 한다는 pi 경고. 기록만 했다.
  - OpenClaw 플러그인은 oracle checkout `plugins/openclaw/dist/index.js`에 link되어 있다. checkout 브랜치를 바꾸지 않는다.
- **범위 제외 (GLG 2026-11-14, 유지):** 정지 동사 노출. 정지 수단은 로컬 ESC다. (같은 결정의 steer 절반은 0.55.0 S7로 출하됐다.)
- **PAUSED:** durable ACP 통합.
- **Do not touch:** 출하된 tag/release/npm bytes, push(GLG 승인 시만), `--no-verify`, worktree, 운영 profile·overlay·hook, credential, 자동 compaction 기준 논의(S8은 기록만 하고 기준은 바꾸지 않는다), andenken 리포.

# 이월 (다음 레일과 결정 대기)

- **#163 Observation (0.53.1, 기록만):** 계약 문서 `docs/acp-backend-rail.md` §11-10·§11-11. O3 요약 오라클이 pi `sdk`/`modelRuntime` 구간을 덮지 않음, O5 `/new`·fork 뒤 `session_compact` 키 어긋남 no-op 미확인, M2b fence 꼴 유지, O-2 미리보기 Markdown 해석, O-3 fence 뒤 `'`, O-4 code point 경계 자르기, O-5 title 변경마다 running 줄; 제어문자 정리는 pi 범위에 DEL·C1 제거를 더한 것.
- **사용감 기록 (a30dda 제안, 결재 조건 아님):** 평소 일 한 건을 ACP로 끝낸 뒤 GLG에게 묻는다 — 기다리는 동안 무엇을 하는지 알았나, ESC 뒤 이어서 말할 수 있었나, compact 뒤 최신 결정·남은 일·끝난 일이 구분됐나. 불편은 "하려던 일 / 화면 / 관측 / 수습" 네 칸.
- **0.53.1 CHANGELOG kill-power 줄:** `none (all committed claims not re-proved, #144)`에 claim 개수 N이 빠졌다. 0.53.0은 1532였다. 2026-11-14 PARTIAL receipt(`563b9334` 위)에는 committed mutant가 1547개(5개 실행 + 1542개 미실행)로 나온다. 이미 태그된 섹션이라 고치지 않았다(ff08d4 2026-11-14).
- **D1(다음 레일):** AGENTS.md Rule 11의 "run_ts is the sole TS crossing"과 `mcp/entwurf-bridge/start.sh:47-68`이 어긋난다. start.sh는 소스 체크아웃에서 src를 strip-types로 실행한다. 문안은 GLG가 정한다. 같은 owner 체크아웃에서 ACP 쪽 bridge는 src를 쓰고 Pi 내장은 dist를 써서, dist가 낡으면 둘이 갈라질 수 있다(미측정).
- **O3(다음 레일):** R2R에서 summary에는 옛 사실만 있었고, 갱신된 사실은 kept tail이 운반했다. 다음 VERIFY 다이어트 후보는 §1A Layers 1–4다.
- **run.sh:7787 주석:** "VERIFY.md:61"은 낡았다. 다만 check-install-surface S9h가 검토된 dispatch case를 바이트로 비교하므로, 고칠 때는 S9h의 reviewed 바이트와 함께 고친다.
- **GLG 결정 대기:**
  - #161 판단.
  - 형제 262958과 b3e007 처리.
  - O4: b3e007 summary에 gog·scope·calendar 단어가 있다. andenken이 summary를 그대로 임베딩하므로 그 세션 파일을 memory-sync에서 뺄지.

# 원자료

- #163 thread, #161, `docs/acp-backend-rail.md`, VERIFY.md Part I, BASELINE.md, `docs/baseline-receipts.md`.
- 출하 영수증은 `CHANGELOG.md`에 있다(0.53.1, Herdr snapshot 항목, 0.53.0). host-local 원본은 `~/.local/state/entwurf-releases/`에 있다.
