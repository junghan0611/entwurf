# NEXT — 0.60.0 shipped: #151 /renew + #168 ACP parity + #169 Herdr App guide

**현재 (2026-11-22):** #171(ACP 세션 연속성)을 main에 병합한다(GLG 2026-11-22, 실무 Opus `20261120T213316-793499`; 설계 물음은 조율자를 거쳐 Fable `20261121T180949-b6d8f7`). 병합 뒤 #171을 닫고, 다음은 0.61.0 prepare다. npm `latest`는 0.60.0이다(#151 `/renew`, #168 ACP parity, #169 Herdr App·core 안내). 역할: 운영코디 `20261014T212756-68bd94`, main writer·릴리스 실무 `20261113T043350-ff08d4`.

# RAIL — 현재 좌표

- [x] **1. 문서 검토.** `5839be8a`: Sol(b3c436)·Terra(4677a7) 두 차례 리뷰, #151 거짓 성공 Blocker 해소. PARTIAL acp-vendor-rejection 8/8, readback 101/101, provider-surface 2/2, session-reuse 1/1.
- [x] **2. prepare 0.60.0.** `c2f15ced`: P4 FULL 1078s(seal `7f32b505ebf5d8ea`; 첫 FULL은 Herdr lock 미전환으로 red), P5 `release-gate --cut` MUST 25/0/0 BEHAVIOR 1/0/0, OpenClaw home receipt 새 실측(GLG 승인, `~/.local/share/entwurf-lab/160/receipt-0.60.0-5839be8a/`). 증거는 CHANGELOG 0.60.0 Release evidence.
- [x] **3. make → publish.** exact-SHA CI run 44685553830, Windows preview run 44687247725, candidate sha256 `85b4d7fc…1427`(container 수용), tag `v0.60.0`, GitHub release. GLG npm publish; U2 latest=0.60.0/repair 유지, U3 registry 설치 6행. gog 알림은 토큰 만료로 실패, GLG 결정으로 생략.
- [x] **4. Herdr re-pin.** `3d4d5f55`(exact-SHA CI run 44691169782): `runtime-lock.json` npm 0.60.0(registry sha512 = integrity, sha256 = 수용 후보), setup/durable 문서 현재 버전 0.60.0(배포된 tarball 문서는 0.55.1 표기 그대로), `PI-FLOOR-PUBLISHED-SCOPE` 앵커 이동(PARTIAL dep-versions 5/5). snapshot tag + GitHub release `v2026.11.20-herdr.0.60.0`(Latest는 v0.60.0 유지).
- [x] **5. 이슈.** #151(이미 닫힘)·#168·#169에 출하 댓글, #168·#169 닫음(2026-11-20). #171은 열림.
- [ ] **6. #171 병합과 0.61.0 준비.** ← CURRENT
  - #171을 main에 병합한다(`acp-session-load-171`, `--no-ff`). 무엇이 바뀌고 무엇을 재지 않았는지는 CHANGELOG `## Unreleased`의 #171 항목, 결정은 `docs/acp-client-baseline.md`의 Decisions, 영수증은 #171 닫는 댓글에 있다. 브랜치의 FULL·PARTIAL은 브랜치 SHA의 것이고 병합 커밋으로 상속하지 않는다.
  - 다음: 0.61.0 prepare. 그 전에 형제 전체가 문서부터 검토한다(GLG). 0.61.0에서 Entwurf ACP의 방향도 이야기한다.
  - GLG가 main에서 ACP 턴을 직접 돌려 본다. 이 checkout이 운영 Pi의 package다(#165).
    - ACP는 `entwurf pi`로 띄운 Pi에서만 돈다. 플래그 없는 tui·rpc의 ACP 턴은 `mode`로 멈춘다(결정 18).
    - 0.60.0 이전에 ACP를 쓴 Pi 세션은 v1 record라 `version`으로 멈춘다(record는 남는다). `/new`나 새 Pi 세션에서 시작한다.
    - LIVE는 sandbox HOME에서만 쟀고 이 host의 운영 ACP 행은 아직 돌지 않았다. 사용감은 아래 "사용감 기록"의 네 칸으로 적는다.
  - 남은 후보: `agy-adapter.test.ts:320` sandbox 회수, prepare 체크리스트에 Herdr lock 전환·문서 버전 문구 넣기.
  - 그다음 레일: 0.62.0에서 Pi SDK 1.6.0에 맞춘다.

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
