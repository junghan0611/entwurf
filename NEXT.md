# NEXT — 0.55.1 shipped: #167 agy ACP backend + #164 Orca guide + opus-first entwurf row

**현재 레일 (2026-11-20):** #151 `/renew`(Pi native)는 브랜치 `151-renew`에서 끝났다. 설계·GLG 결정 원문·남은 경계는 [docs/renew-memory-outline.md](docs/renew-memory-outline.md), 증거(격리 실제 Pi 측정과 2026-11-19 첫 실제 renew 감사)는 [docs/baseline-receipts.md](docs/baseline-receipts.md)의 #151 절에 있다. 다음 순서(GLG, 2026-11-20 KST): #151 main 착지 → `168-acp-parity`를 main에 머지하고 #168의 추가 댓글 작업 → #169를 main에 문서로 넣기 → 0.60.0 릴리즈 준비(npm publish 전까지, publish는 GLG). 이후 작업은 이 기간 한정으로 main에서 진행한다(새 branch·worktree·clone 없음). **주체(GLG 원문): "응 main에 얼리고 168 169 실무코디는 클로드코드 오푸스가 담당한다 acp 레일 형제들은 이작업 못해"** — #168·#169의 실무와 공유 checkout writer는 native Claude Code Opus `20261113T043350-ff08d4`이고, 라우팅은 운영코디 `20261014T212756-68bd94`다. #151을 맡았던 `6a8b34`(Pi+ACP 레일)는 main 착지 뒤 writer 창을 운영코디에 돌려주고, 168·169 구현·검증·조율을 맡지 않는다. 아래는 main의 0.55.1 출하 기록이다.

0.55.0은 npm에 나갔다(GLG publish, 2026-11-16, dist-tags latest=0.55.0; 기록은 CHANGELOG 0.55.0). 0.55.1(2026-11-16 npm `latest`, GitHub release `v0.55.1`)은 세 묶음을 출하했다: #167 agy ACP backend 첫 출하(`5504cbd8` 어댑터와 `entwurf/agy-gemini-*` 3행, 설치 oracle `fc7d3d83`)와 그 prompt 단계 실패 재전송 차단(`39cadf51`), #164 Orca 안내(`plugins/orca/README.md`, 루트 README Orca 절), pi 기본 모델을 `claude-opus-5-5`로 고정하는 첫 행 등록(`6d7adf84`, QK ACP-ROWS-ANCHOR-FIRST). retired `claude-fable-5-1` 제거(`8f61e895`)도 0.55.0 뒤라 여기서 처음 나간다. #151 계획 문서는 브랜치 `151-renew`에만 있고 이 cut에 들어가지 않는다.

# RAIL — 현재 좌표

- [x] **1. main 후보.** main `8fabe6ac`(frozen FULL 1011s green, check-pack-install green, exact-SHA CI run 43821793109) → terra 73d3a8 문서 정리 `bcf906ab`(68bd94 리뷰 B0/D0, focused gates + PARTIAL dep-versions 5/5, exact-SHA CI run 43822526404; FULL 미승계). OpenClaw landlord-home receipt `bcf906ab` green(`~/.local/share/entwurf-lab/160/receipt-0.55.1-bcf906ab/receipt.json`, GLG 웹 관측 포함).
- [x] **2. prepare 0.55.1.** `2c0e36e5`: P4 FULL 1026s, P5 `release-gate --cut` MUST 25/0/0 BEHAVIOR 1/0/0 on seal `13f72abaf65ded3d`; saved-default 셀 run 2(sandbox) opus 선택, run 1은 사고 기록. 증거는 CHANGELOG 0.55.1 Release evidence.
- [x] **3. make → publish.** exact-SHA CI run 43834942508, Windows preview run 43836522833, candidate sha256 `8298b99f…71745`(container 수용), tag `v0.55.1`, GitHub release. GLG가 npm publish(2026-11-16); U2 latest=0.55.1/repair 유지, U3 registry 설치 6행 확인.
- [x] **4. Herdr re-pin.** `29594b9a`(exact-SHA CI run 43845189555): `runtime-lock.json` npm 0.55.1(registry sha512 = integrity, sha256 = 수용 후보), Orca 가이드 범위 문장 정렬. snapshot tag + GitHub release `v2026.11.16-herdr.0.55.1`(Latest는 v0.55.1 유지).
- [x] **5. 이슈와 브랜치 복귀.** #167·#164 닫음(2026-11-16, 출하 댓글 6913578444·6913579384). main을 `151-renew`에 merge하고 #151 lane(브랜치 `151-renew`의 `NEXT--151-renew.md`, main 착지 전에 삭제됨)으로 돌아간다.

# #164 Orca 증거 (노트북 lane에서 승격, oracle은 Orca를 설치하지 않는다)

- 측정 요약: #164 댓글 6906503079 — orcad v1.4.259 + 페어링된 GUI 클라이언트에서 `entwurf claude`·GUI가 띄운 plain Claude Code·`entwurf pi` 왕복 각 n=1 성공. Claude Code는 메일을 자동으로 읽되 실행은 pane 사람 승인 뒤, Pi는 즉시 회신.
- 소비자 수용: #164 댓글 6907955407 — README만 받은 새 Sonnet이 sandbox HOME에 npm 0.55.0 설치 → setup green → Orca 터미널 시민 출생.
- 영수증 원본은 노트북 host-local(`~/.local/share/entwurf-lab/164/*/receipts`)이다. 시험 자원은 회수했다.
- GLG 결정: 코어는 npm pin 설치, Orca 플러그인은 npm 패키징하지 않고 안내 문서만 둔다(점검 스크립트 없음). 대상 하네스는 pi·claude-code, opencode는 범위 밖.
- 0.55.0 소비자 관측(노트북): pi 첫 record·상태줄 모델이 `claude-fable-5-1`이었다(턴 실패 여부 미측정). 시작 화면에 `Extension issues … peerDependencies` 경고가 뜨지만 동작에는 지장이 없다(아래 U3 경고와 같은 것).

# NOW

- **역할 (2026-11-16):** 운영코디 68bd94, ff08d4 main 수용·prepare. #151 팀(6a8b34 구현, a30dda)은 이 cut 동안 공유 checkout 쓰기를 멈춘다.
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
