# NEXT — 0.55.0 cut: #160 OpenClaw home + ACP in-turn steer and compaction record

0.55.0은 #160(OpenClaw 집 연결)과 ACP in-turn steer(S7)·compaction 기록(S8)을 묶는다. 브랜치 `160-openclaw`는 main `1255adbb`로 land했다(exact-SHA CI run 43717547419, 4개 job success). 브랜치 handoff의 지속 사실은 ROADMAP 맨 위 "0.55.0 후보" 절에 있다.

# RAIL — 현재 좌표

- [x] **1. land.** main `1255adbb`, CI 4 job green(2026-11-15 22:09 KST push, GLG 요청).
- [x] **2. landlord-home receipt.** `1255adbb` 위에서 11행 측정(10 pass, compactReset unmeasured), `check-openclaw-home-receipt` green. 정본 `~/.local/share/entwurf-lab/160/receipt-0.55.0-1255adbb/receipt.json`. visibility는 chat.history + GLG의 OpenClaw 노드 앱 관측.
- [x] **3. prepare 0.55.0.** FULL green(seal cd1bbd97, 1025s), `release-gate --cut` MUST 25/0/0 cut OK(3회차; 1·2회차 red는 stale installed writer와 OMP gave-up 로그 — CHANGELOG Release evidence). 원래 계획: CHANGELOG·버전·문서 → 리뷰(bc72e5) → build-bridge → frozen `check:full` → `release-gate --cut`(Codex triple + `ENTWURF_OPENCLAW_HOME_RECEIPT`/`_TARGET`) → release-prep 커밋.
- [x] **4. make → publish.** make 완료: main `40ff473d`, exact-SHA CI run 43730621013 green, Windows preview run 43731910023, candidate `~/.local/state/entwurf-releases/0.55.0-40ff473dd88d/candidate.b9MKgr/junghanacs-entwurf-0.55.0.tgz`(sha256 `7908bb49…98a3c`, container acceptance PASS), tag `v0.55.0`, GitHub release, U0 receipt `publish-u0.7OwVgF`. GLG가 npm에 직접 publish했다(2026-11-16 `npm view` dist-tags latest=0.55.0). publish U2/U3 registry proof는 아직 하지 않았다.
- [ ] **5. Herdr re-pin.** ← CURRENT: publish 뒤 `plugins/herdr/runtime-lock.json`을 npm 0.55.0 측정 바이트로 다시 pin하고 snapshot tag(prepare 동안은 herdr-checkout carrier).
- [x] **6. #167 agy ACP backend.** 브랜치 `167-agy-acp`(`5504cbd8` + 후속 문서 커밋)를 main에 land. `entwurf/agy-gemini-{4-hydrogen,4-argon,3.8-flash}`, fresh/resume 입장, global skillPlugins 투영, cwd AGENTS 중복 제거. 증거: PARTIAL 3그룹 green, frozen FULL green(1012s), LIVE n=1(fresh 왕복 a1f47f, 운영 HOME 스킬 투영 d8da36), 리뷰 4패스 Blocker 0, #167 영수증 댓글. 알려진 제한(백그라운드 고아 D6, 넓은 native 표면)은 `docs/acp-backend-rail.md`.

# NOW

- **receipt와 HEAD:** receipt의 candidate는 `1255adbb`(prepare 커밋의 부모)다. prepare 커밋 전에 다른 커밋을 넣으면 receipt가 무효가 되어 11행을 다시 재야 한다.
- **역할 (2026-11-15):** ff08d4 코디·prepare, bc72e5(ACP Opus) 리뷰, 8216f4 운영(OpenClaw Gateway). OpenClaw 책상 `agent:main:entwurf` = garden `20261115T215046-12438c`.
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
