# NEXT — 0.53.1 출하 뒤: Herdr 0.53.1 snapshot → 다음 레일

0.53.1은 #163(ACP Claude 품질 레일)을 npm으로 처음 출하했다. 0.53.0은 태그와 GitHub release만 있다. 다음 core 레일은 GLG가 정한다. 0.55.0은 #160이 준비될 때 간다(GLG 2026-11-14, ff08d4 전달).

# RAIL — 현재 좌표

- [x] **1. 0.53.0 cut.** tag `v0.53.0`(`72975b0`)과 GitHub release(2026-11-13)까지 했고, npm에는 게시하지 않았다(GLG 결정).
- [x] **2. #163 land.** claude-agent-acp 0.107.0, 정확한 manual `/compact`, Pi 같은 가시성. main `7a100e89`, exact-SHA CI run 43570025312의 4개 job 모두 success.
- [x] **3. BASELINE·VERIFY R2R (2026-11-14, ACP Opus 5.5).** 기록은 `docs/baseline-receipts.md`의 "0.53.1 BASELINE and VERIFY run" 항목에 있다.
- [x] **4. 0.53.1 prepare → make → publish.**
  - prepare `563b9334`, M0 FULL green.
  - exact-SHA CI run 43579212082의 4개 job 모두 success.
  - Windows preview run 43580235467.
  - candidate sha256 `45ea17e4…57e5`.
  - [release](https://github.com/junghan0611/entwurf/releases/tag/v0.53.1).
  - GLG가 npm에 publish했다. `latest`=0.53.1, `repair` 유지.
  - U2(registry bytes = candidate)와 U3(registry install smoke)는 green이다.
- [ ] **5. Herdr npm snapshot 0.53.1.** ← CURRENT: re-pin 커밋을 main에 push하고 exact-SHA CI를 확인한다. 이어서 tag-release로 `v2026.11.14-herdr.0.53.1`와 GitHub release를 만든다.

현재 좌표: 1–4 완료 → 5 Herdr snapshot(push·CI·tag) → 다음 레일은 GLG 결정

# NOW

- **다음 한 걸음:**
  - re-pin 커밋의 exact-SHA CI 4개 job이 green이면 snapshot tag와 GitHub release를 만들고 release stamp를 찍는다.
  - 그 뒤 ff08d4가 #163 결과 댓글과 종결을 맡는다.
  - 운영 host를 0.53.1로 옮기는 설치·재시작은 별도 승인이다.
- **0.53.1 증거:**
  - `CHANGELOG.md`의 0.53.1 Release evidence와 Herdr snapshot 항목.
  - candidate와 U0 receipt는 `~/.local/state/entwurf-releases/0.53.1-563b9334f786/candidate.XBHRFx/`에 있다(host-local).
- **사용감 기록 (자문 a30dda 제안, 결재 조건 아님):** 평소 일 한 건을 ACP로 끝낸 뒤 GLG에게 묻는다.
  1. 기다리는 동안 Claude가 무엇을 하는지 알았나.
  2. ESC 뒤 상태를 알고 이어서 말할 수 있었나.
  3. compact 뒤 최신 결정, 남은 일, 끝난 일이 구분됐나.
  - 불편은 "하려던 일 / 화면 / 관측 / 수습" 네 칸으로 적는다.
  - 관찰 항목: 턴이 끝난 뒤에도 사는 서브에이전트나 백그라운드 작업이 보이지 않는 사각.
- **#163 Observation (기록만):** 계약 문서는 `docs/acp-backend-rail.md` §11-10·§11-11이다.
  - O3: 요약 오라클은 pi `sdk`/`modelRuntime` 구간을 덮지 않는다.
  - O5: `/new`나 fork 뒤 `session_compact` 키가 어긋날 때 no-op인지 확인하지 않았다.
  - M2b: done/failed summary의 fence 꼴은 그대로 뒀다.
  - O-2: 미리보기를 Markdown으로 해석할 수 있다.
  - O-3: fence를 벗긴 뒤에도 `'`가 남을 수 있다.
  - O-4: 바이트 자르기는 code point 경계에서 한다.
  - O-5: title이 여러 번 바뀌면 running 줄도 여러 번 나온다.
  - 제어문자 정리는 pi 범위에 DEL·C1 제거를 더한 것이다.
- **범위 제외 (GLG 2026-11-14):** 실행 중인 턴에 `_session/steering` 주입, 정지 동사 노출. 정지 수단은 로컬 ESC다.
- **운영 관찰:**
  - Codex vendor managed daemon은 seat pane이 죽어 있으면 `smoke-codex-fresh-live`가 A 좌표를 해석하지 못한다. 0.53.0과 0.53.1 cut은 `entwurf codex-app-server`를 전용 tmux에서 띄워 측정했다. daemon 복원은 GLG가 결정한다.
  - `check-acp-backend-preflight`가 thinking level 없이 backend를 부른다(b3 O1).
  - `*resume-call.test.ts`가 `/tmp`에 디렉터리를 남긴다(P9). 0.53.1 U3 뒤에는 `mux-resume-call-pd`와 `herdr-resume-*` 세 종류가 각 105개였다.
  - U3 registry 설치에서 pi가 경고를 냈다: host-provided 패키지(`pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-tui`)는 dependencies가 아니라 `"*"` 범위의 peerDependencies여야 한다. 기록만 했다.
- **PAUSED:** #160(Oracle 실행, 0.55.0), durable ACP 통합.
- **역할 (2026-11-14):**
  - ff08d4: 실무 코디.
  - b3fc7c: make와 post-publish 작성자.
  - Sonnet f17cd8: prepare 문서.
  - 02055a: 리뷰.
  - a30dda: 자문.
  - 68bd94: 운영 코디. GLG에게 DM하는 것은 68bd94뿐이다.
- **Do not touch:**
  - 출하된 tag/release/npm bytes
  - push(GLG 승인 시만), `--no-verify`, worktree
  - 운영 profile·overlay·hook, credential
  - 자동 compaction 기준 논의, #160, andenken 리포

# 이월 (다음 레일과 결정 대기)

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
