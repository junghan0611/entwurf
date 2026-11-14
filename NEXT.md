# NEXT — 0.53.1: #163 ACP Claude 품질 레일 → 착지 → 실사용 검수 → 출하

0.53.1은 아직 ACP Claude 품질을 올리는 레일이고 내용은 [#163](https://github.com/junghan0611/entwurf/issues/163)이다. 0.55.0은 #160이 준비될 때 간다(GLG 2026-11-14, ff08d4 전달).

# RAIL — 현재 좌표

- [x] **1. 0.53.0 cut.** tag `v0.53.0`(`72975b0`)과 GitHub release(2026-11-13)까지 했다. npm에는 게시하지 않는다(GLG 결정). 2026-11-14 측정으로 npm `latest`는 0.52.0이다.
- [x] **2. #163 브랜치 `fix/163-acp-control`.** claude-agent-acp 0.107.0 `7c98f8b4`, 정확한 manual `/compact` `5b7f7c24`·`7eb200a9`, Pi 같은 가시성 `e96403ec`·`f25c78de`. PARTIAL green(`f25c78de`), frozen FULL green(`17244d48`, rc=0, 1011s).
- [x] **3. land.** main=origin/main=`7a100e89`, exact-SHA CI run 43570025312 의 4개 job 모두 success, 브랜치 `fix/163-acp-control` 삭제(b3fc7c 보고, ff08d4 전달).
- [ ] **4. 전역 설치 → ACP Opus 5.5로 BASELINE·VERIFY 검수.** 수동 `/compact` 셀과 가시성을 본다. 하지 못한 셀은 UNMEASURED로 명시한다. ← CURRENT (문서 커밋 BASELINE/VERIFY 다이어트 + WHY + /compact 셀 이후 02055a R2R).
- [ ] **5. prepare → make.** 문서·WHY 절·VERIFY compact 셀·CHANGELOG·버전 0.53.1. 작성자 바통은 Sonnet `20261114T155010-f17cd8`이 받는다. make의 M0 FULL이 prepared HEAD를 다시 덮는다. npm publish는 GLG가 직접 한다.

현재 좌표: 1·2·3 완료 → 4 실사용 검수(CURRENT) → 5 prepare/make

# NOW

- **다음 한 걸음:** main push의 exact-SHA CI 4개 job이 green이면 land가 닫힌다. 브랜치 `fix/163-acp-control`은 원격 반영을 확인한 뒤 지운다. 이 브랜치는 원격에 push된 적이 없다. 그 뒤 작성자 바통은 Sonnet(prepare 문서)에게 갔다가 b3fc7c(P4/P5 floor와 make)에게 돌아온다. Codex app-server는 ff08d4가 별도 tmux에서 띄우고, pid와 모델 triple을 전달한다.
- **RAIL 4 LIVE 항목:**
  - 수동 `/compact`는 c0–c6로 본다. 설계는 02055a, 셀 본문은 VERIFY.md §1B.7a이고 사전 점검 스크립트는 docs/baseline-receipts.md에 있다.
    - c0: would-compact 모양과 요약 자식 1–2개.
    - c1: summary에 `[acp:`·`[tool:`·제어문자가 없다.
    - c2: 다음 프롬프트 전에 옛 자식이 닫힌다.
    - c3: 다음 턴이 `[acp: preparing claude session]`으로 summary에서 시작한다.
    - c4: 이어지는 실제 작업에서 회상과 결정 구분이 되는지.
    - c5: O6 `tools: []`. 전달 경로 읽기와 비사용 관측으로 적고, 제공된 도구 목록 자체는 관측되지 않는다고 적는다.
    - c6(선택): ESC 취소.
  - 수동 `/compact`의 문턱은 Pi transcript 추정치다. 첫 user 이후 `keepRecentTokens` 20000 이상이어야 하고, 목표는 30000 이상(약 8만 자)이다. footer의 %는 Claude 점유량이라 판정 기준이 아니다.
  - 가시성: Bash가 "Terminal"에서 명령 이름으로 바뀌는 `[tool:running]` 줄, `[tool:output]` 미리보기(성공은 앞, 실패는 꼬리), 네이티브 compaction이 일어나면 `[acp: compaction …]` 줄.
- **사용감 기록 (자문 a30dda 제안, 결재 조건 아님):** 평소 일 한 건을 ACP로 끝낸 뒤 GLG에게 묻는다.
  1. 기다리는 동안 Claude가 무엇을 하는지 알았나.
  2. ESC 뒤 상태를 알고 이어서 말할 수 있었나.
  3. compact 뒤 최신 결정, 남은 일, 끝난 일이 구분됐나.
  - 불편은 "하려던 일 / 화면 / 관측 / 수습" 네 칸으로 적는다.
  - 관찰 항목: 턴이 끝난 뒤에도 사는 서브에이전트나 백그라운드 작업이 보이지 않는 사각.
- **#163 Observation (기록만):**
  - O3: 요약 오라클은 pi `sdk`/`modelRuntime` 구간을 덮지 않는다.
  - O5: `/new`나 fork 뒤 `session_compact`의 sessionId 키가 어긋날 때 무해한 no-op인지 확인하지 않았다.
  - M2b: done/failed summary의 fence 꼴은 replay 텍스트라 그대로 뒀다.
  - O-2: 미리보기를 pi-tui가 Markdown으로 해석할 수 있다.
  - O-3: fence를 벗긴 뒤에도 `'`가 남을 수 있다.
  - O-4: 바이트 자르기는 code point 경계에서 한다.
  - O-5: title이 여러 번 바뀌면 running 줄도 여러 번 나온다.
  - 제어문자 정리는 pi 범위에 DEL·C1 제거를 더한 것이다(`ACP-PREVIEW-MATCHES-PI`가 대조한다).
  - 계약 문서는 `docs/acp-backend-rail.md` §11-10·§11-11이다.
- **0.53.0에서 이월 (출하 시점은 코디가 확인):** npm publish 뒤 Herdr re-pin과 스냅샷 태그, #161 종결 판단.
- **범위 제외 (GLG 2026-11-14):** 실행 중인 턴에 `_session/steering` 주입, 정지 동사 노출. 정지 수단은 로컬 ESC다.
- **운영 관찰:**
  - Codex vendor managed daemon은 seat pane이 죽어 있으면 `smoke-codex-fresh-live`가 A 좌표를 해석하지 못한다. 0.53.0 cut은 `entwurf codex-app-server`를 전용 tmux에서 띄워 측정했다. daemon 복원은 GLG가 결정한다.
  - `check-acp-backend-preflight`가 thinking level 없이 backend를 부른다(b3 O1).
  - `*resume-call.test.ts`가 `/tmp` 디렉터리를 남긴다(P9).
- **PAUSED:** #160(Oracle 실행, 0.55.0), durable ACP 통합.
- **역할 (2026-11-14):**
  - ff08d4: 실무 코디.
  - b3fc7c: #163 작성자로 land까지 맡는다.
  - Sonnet f17cd8: prepare 작성자.
  - 02055a: 리뷰.
  - a30dda: 자문.
  - 68bd94: 운영 코디. GLG에게 DM하는 것은 68bd94뿐이다.
- **Do not touch:**
  - 출하된 tag/release bytes
  - npm publish(GLG 직접)
  - push(GLG 승인 시만), `--no-verify`, worktree
  - 운영 profile·overlay·hook, credential
  - 자동 compaction 기준 논의, #160, andenken 리포

# 원자료

- #163 thread, #161, `docs/acp-backend-rail.md`, VERIFY.md Part I, BASELINE.md core interview, `docs/baseline-receipts.md`.
- 0.53.0 증거는 `CHANGELOG.md` 0.53.0 Release evidence와 `.agent-reports/verify-1b-walk-20261113.md`(host-local)에 있다. 0.52.0 출하 영수증은 Herdr tag `v2026.11.12-herdr.0.52.0`, `docs/setup-clean-host.md`, `~/.local/state/entwurf-releases/`에 있다.
