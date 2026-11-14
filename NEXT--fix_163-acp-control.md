# NEXT — #163 ACP 실사용 마무리: 0.107.0 · 정확한 manual /compact · Pi 같은 가시성

브랜치 `fix/163-acp-control`(main `72975b0`에서 출발). 병합 전에 이 파일을 지우고, 오래 남을 사실은 소유 문서로 옮긴다. 이슈 스레드: [#163](https://github.com/junghan0611/entwurf/issues/163).

# RAIL — 현재 좌표

- [x] **1. claude-agent-acp 0.106.0 → 0.107.0.** `7c98f8b4`. 영수증은 ROADMAP Dep bump ledger 2026-11-14 항목에 있다.
- [x] **2. 정확한 manual `/compact`.** `5b7f7c24`과 리뷰 정정 `7eb200a9`. QK·mutant 10개. 계약은 `docs/acp-backend-rail.md` §11-10에 있다.
- [x] **3. Pi처럼 보이게 (#162 확장).** `e96403ec`과 리뷰 정정 `f25c78de`(제어문자 정리, 미리보기 들여쓰기). QK·mutant 13개. 계약은 §11-11에 있다.
- [ ] **4. 후보 검증과 착지.** ← PAUSED: 자원 부족(GLG 2026-11-14 "b가 집 짓고 있어서 자원이 없다. 이따가 하자"). 다음은 frozen FULL 재실행 → LIVE n=1 → GLG의 push 결정.

범위 제외 (GLG 2026-11-14): `_session/steering` 주입, 정지 동사 노출. 정지 수단은 로컬 ESC다.

현재 좌표: 1·2·3 완료 → 4 PAUSED(FULL 재실행 대기)

# NOW

- **다음 한 걸음:** GLG가 자원이 확보됐다고 하면 이 NEXT 커밋의 HEAD에서 frozen FULL을 다시 돌린다. 명령은 `pnpm run check:full`이고 5분 이상 걸린다. 도는 동안 worktree와 index를 움직이지 않는다. green이 나오면 ff08d4(또는 그 시점의 코디)에게 알린다.
  - FULL 앞에 bridge dist가 stale이면 `check-bridge-delivery`가 red가 된다. 처방은 `pnpm run build-bridge`다. 이 dist는 운영 bridge의 실행 바이트이기도 하다. 그래서 먼저 임시 outDir로 `tsc -p mcp/entwurf-bridge/tsconfig.build.json --outDir <tmp>`를 돌리고, 운영 dist와 diff해서 무해한지 확인한 뒤 다시 빌드한다. 2026-11-14에 확인한 차이는 `tool-surface.js`의 `isPiSummaryRequest` export 하나였다.
- **RAIL 4 기록 (2026-11-14, oracle):**
  - PARTIAL green. head `f25c78de`, workSurfaceSha256 `59cf75be0f025d8d…`.
    - `["bash","run.sh","check-acp-set-model-readback"]`: 44/44 killed, control ok, 464초, receiptSha256 `32bd052290f75afa…`
    - `["bash","run.sh","check-acp-prompt-lifecycle"]`: 15/15 killed, control ok, 207초, receiptSha256 `e6cf8a16e881cebe…`
    - 영수증은 oracle의 `/tmp/claude-1000/163-partial/`에 있다(휘발성 경로).
    - SDK-surface 오라클을 gate로 쓰는 mutant 그룹은 없다. 그래서 PARTIAL 대상이 아니고, focused `check-acp-sdk-surface` rc=0이 그 증거다.
  - 이 NEXT 커밋은 mutant 대상 파일을 바꾸지 않는다. 다만 HEAD와 work surface가 바뀐다. 그래서 위 PARTIAL은 `f25c78de` 후보의 측정으로 남고, FULL은 새 HEAD에서 돈다.
  - FULL 1회차: rc=1(314초). `check-bridge-delivery`의 stale-dist 판정이었고 코드 결함은 아니다. 위 절차대로 확인한 뒤 `build-bridge` rc=0.
  - FULL 2회차: Claude Code가 메모리 압박으로 백그라운드 셸을 종료했다(available 약 2.4GB). 판정 없음.
- **그 다음: LIVE n=1.** GLG가 pi ACP Claude를 다시 켜야 한다. 시점은 코디가 GLG에게 묻는다. scratch 세션에서 다음을 측정한다.
  - 수동 `/compact`: summary가 저장되는지, summary에 notice 줄이 0인지, compact 직후 기존 Claude 자식이 닫히는지, 다음 턴이 새 자식을 열고 그 프롬프트에 요약이 들어가는지.
  - O6: 요약 자식의 `_meta.claudeCode.options.tools: []`가 실제로 도구 0으로 해석되는지(요약 자식이 도구를 부를 수 없는지).
  - 가시성: Bash가 "Terminal"에서 명령 이름으로 바뀌는 `[tool:running]` 줄, `[tool:output]` 미리보기(성공은 앞, 실패는 꼬리), 네이티브 compaction이 일어나면 `[acp: compaction …]` 줄.
- **LIVE 때의 사용감 점검 (자문역 a30dda 제안, 결재 조건 아님):** 평소 일 한 건을 ACP로 끝낸 뒤 GLG에게 세 가지를 묻는다.
  1. 기다리는 동안 Claude가 무엇을 하는지 알았나.
  2. ESC 뒤에 상태를 알고 이어서 말할 수 있었나.
  3. compact 뒤에 최신 결정, 남은 일, 끝난 일이 구분됐나.
  - 불편은 "하려던 일 / 화면 / 관측 / 수습" 네 칸으로 기록한다.
  - 관찰 항목: 턴이 끝난 뒤에도 살아 있는 서브에이전트나 백그라운드 작업이 보이지 않는 사각.
- **Observation (기록만, 작업 아님):**
  - O3: 요약 오라클은 pi `sdk`/`modelRuntime` 구간을 덮지 않는다. streamFn을 직접 꽂는다.
  - O5: `/new`나 fork 뒤에 `session_compact`의 sessionId 키가 어긋날 때 무해한 no-op인지는 확인하지 않았다.
  - O-2: 미리보기 본문은 pi-tui가 Markdown으로 해석할 수 있다.
  - O-3: Read/Edit 출력에서 fence를 벗긴 뒤에도 `'`가 남을 수 있다.
  - O-4: 바이트 자르기는 grapheme이 아니라 code point 경계에서 한다.
  - O-5: title이 여러 번 바뀌는 reporter는 running 줄을 여러 번 낼 수 있다.
  - M2b: done/failed summary의 `[fence]console …` 꼴은 replay 텍스트라 바꾸지 않았다(ff08d4 2026-11-14).
  - 제어문자 정리는 pi 범위에 DEL·C1 제거를 더한 것이다. 엄격히 pi와 같은 범위를 원하면 `event-mapper.ts`의 `CONTROL_CHARS` 한 줄을 바꾸면 된다. `ACP-PREVIEW-MATCHES-PI`가 그 차이를 명시적으로 대조한다.
- **역할 (2026-11-14 기준):**
  - b3fc7c: 이 체크아웃의 단일 작성자(GLG 승인). 이 NEXT 커밋 뒤 GLG 지시로 retire되고, 기록은 보존된다.
  - ff08d4: 실무 코디. 체크포인트·블로커는 여기로 보낸다.
  - 02055a: 논의·독립 리뷰 전용. 체크아웃에 쓰지 않는다.
  - 68bd94: 운영 코디. GLG에게 DM하는 것은 68bd94뿐이다.
  - a30dda(sol): 자문역.
- **손대지 말 것:**
  - push(GLG 승인 시에만), `--no-verify`, worktree
  - operator 설정·훅·profile, credential 읽기
  - 자동 compaction 기준 논의·확대(GLG: "지금 논의하지 않음")
  - steer 주입, 정지 동사
  - #160(openclaw), andenken 리포(GLG가 처리한다. 읽기 전용 열람만 승인됐었다)
  - 이 브랜치의 `NEXT.md`(main lane 문서)

# 체크포인트별 재료

## 2. manual /compact

- 계약, 판별자, 요약 턴의 모양, compact 뒤 정리는 `docs/acp-backend-rail.md` §11-10과 VERIFY의 "Pi's summary request (#163)" 행에 있다.
- 오라클은 `pi-extensions/lib/acp/backend.summary-turn.test.ts`다. 설치된 pi의 `generateSummary`와 `generateBranchSummary`를 `streamAcpTurn`으로 구동한다.
- 진단 근거는 02055a 댓글 [6871961225](https://github.com/junghan0611/entwurf/issues/163#issuecomment-6871961225) §1에 있다.

## 3. 가시성 최소 집합 (GLG: "pi가 동작하듯이")

- 계약과 andenken `control-v1` 결합(HEAD `e5165ecc` 기준)은 `docs/acp-backend-rail.md` §11-11에 있다. 증거는 VERIFY의 "Tool visibility (#163)" 행에 있다.
- 오라클은 `pi-extensions/lib/acp/event-mapper.test.ts`다. 모든 mutant의 실행 좌표는 `check-acp-set-model-readback`이다(lane 44개).
- **미룸:** plan/TodoWrite, subagent_*/async_task_*, 턴 사이 알림, compaction_update capability.
