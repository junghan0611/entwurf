# NEXT — #163 ACP 실사용 마무리: 0.107.0 · 정확한 manual /compact · Pi 같은 가시성

브랜치 `fix/163-acp-control`(main `72975b0`에서 출발). 병합 전에 이 파일을 지우고, 오래 남을 사실은 소유 문서로 옮긴다. 이슈 스레드: [#163](https://github.com/junghan0611/entwurf/issues/163).

# RAIL — 현재 좌표

- [x] **1. claude-agent-acp 0.106.0 → 0.107.0.** C0 dist 비교, C1 bump, focused 게이트 rc=0. 영수증은 ROADMAP Dep bump ledger 2026-11-14 항목에 있다.
- [x] **2. 정확한 manual `/compact`.** 코드·QK 10개·mutant 10개(로컬 10/10 KILLED, 02055a 리뷰 정정 포함)·문서(rail §11-10, VERIFY 행) 완료. LIVE `/compact` n=1은 RAIL 4에서 한다.
- [x] **3. Pi처럼 보이게 (#162 확장).** M1 서명 `[tool:running] <확정 title>`, M2 서명 `[tool:output]`(5줄·400B, 실패는 꼬리), M3 `[acp: compaction …]`. QK 9개, mutant 9개(로컬 9/9 KILLED), rail §11-11과 VERIFY 행 추가.
- [ ] **4. 후보 검증과 착지.** ← CURRENT: 영향받는 PARTIAL → frozen FULL → LIVE n=1(`/compact`, 가시성) → GLG의 commit/push 결정.

범위 제외 (GLG 2026-11-14): `_session/steering` 주입, 정지 동사 노출. steer 쪽 결론은 "queued steer는 인터럽트가 아니다"라는 기존 계약을 유지하는 것이고, 정지 수단은 로컬 ESC다.

현재 좌표: 1·2·3 완료 → 4 검증과 착지

# NOW

- **운영 (GLG 2026-11-14):** (A)로 진행한다. 이 체크아웃이 운영 pi의 원본이고, 작업하는 동안 pi ACP Claude는 GLG가 부르지 않는다. 앞으로 ff08d4가 요청하는 일은 진행한다.
- **다음 (RAIL 4):** PARTIAL 대상 lane을 한 번 돌린다(아래 C2 메모). 그 다음 frozen FULL, 그 다음 LIVE n=1이다. 순서와 명령은 VERIFY.md를 따른다. LIVE는 GLG가 pi ACP Claude를 다시 켜는 시점과 맞춰야 하므로, 시작 전에 ff08d4를 거쳐 GLG에게 묻는다.
- **C2 정정 (02055a 리뷰 → ff08d4 채택, 2026-11-14):** D1, O1, O2, O4를 반영하고 mutant 4개를 더했다(lane 31개, 로컬 10/10 KILLED).
  - D1: in-flight 세션은 닫지 않는다. `busy`는 in-flight 구간 안에서만 켜지므로(`backend.ts` claim 구간, `busy: true` 두 곳) 조건 하나만 지우는 mutant는 동등 mutant다. 그래서 두 조건을 함께 지우는 mutant로 증명했다.
  - O1: 요약 턴에서 pi가 abort하지 않았는데 `cancelled`가 오면 error로 봉인한다.
  - O2: 요약 자식의 `settingSources`를 []로 둔다.
  - O4: 판별자의 "도구 없음" 조건을 증명하는 mutant를 추가했다.
- **Observation (기록만, 작업 아님):**
  - O3: 오라클은 pi `sdk`/`modelRuntime` 구간(`agent.streamFunction`이 provider로 가는 길)을 덮지 않는다. streamFn을 직접 꽂는다.
  - O5: `/new`나 fork 뒤에 `session_compact`의 sessionId 키가 어긋날 때 무해한 no-op인지는 확인하지 않았다.
  - C3 리뷰(02055a → ff08d4, 2026-11-14)에서 나온 Observation:
    - O-2: 미리보기 본문은 pi-tui가 Markdown으로 해석할 수 있다.
    - O-3: Read/Edit 출력에서 fence를 벗긴 뒤에도 `'`가 남을 수 있다.
    - O-4: 바이트 자르기는 grapheme이 아니라 code point 경계에서 한다.
    - O-5: title이 여러 번 바뀌는 reporter는 running 줄을 여러 번 낼 수 있다.
  - M2b: done/failed summary의 `[fence]console …` 꼴은 replay 텍스트라 이번에 바꾸지 않는다(ff08d4 2026-11-14).
- **C2 메모:** 내 abandon 리팩터 때문에 기존 mutant `acp-prompt-lifecycle/IDLE-DEATH-ANNOUNCED`의 find를 고쳤다(로컬 KILLED 확인). 이 lane도 RAIL 4 PARTIAL에 넣는다. PARTIAL 대상 lane: `acp-set-model-readback`(#163 새 19개, 합계 40), `acp-prompt-lifecycle`(find 수정 1개), SDK-surface 오라클.
- **LIVE `/compact` n=1 측정 항목 (RAIL 4):** summary가 저장되는지, summary에 notice가 0인지, compact 직후 기존 자식이 닫히는지, 다음 턴이 새 자식을 여는지. 그리고 O6: `_meta.claudeCode.options.tools: []`가 실제로 도구 0으로 해석되는지(요약 자식이 도구를 부를 수 없는지).
- **C1 메모:** 남은 `0.106.0` 언급은 날짜가 붙은 측정 기록이라 그대로 둔다(`backend-adapter.ts:378`, `tool-surface.ts:177`, `probe-cli-target.ts:96`; 해당 dist 파일은 0.107에서 diff가 없다). PARTIAL은 RAIL 4에서 한 번에 돈다. 그때 바뀐 SDK-surface 오라클도 포함한다.
- **역할:**
  - b3fc7c: 이 체크아웃의 단일 작성자. GLG가 2026-11-14 이 세션에서 직접 승인했다.
  - ff08d4: 실무 코디. 결론·체크포인트·블로커·가시성 후보를 받는다.
  - 02055a: 논의 전용. 체크아웃에 쓰지 않는다.
  - 68bd94: 운영 코디. GLG에게 DM하는 것은 68bd94뿐이다.
- **손대지 말 것:**
  - push(GLG 승인 시에만), `--no-verify`, worktree
  - operator 설정·훅·profile, credential 읽기
  - 자동 compaction 기준 논의·확대(GLG: "지금 논의하지 않음")
  - steer 주입, 정지 동사
  - #160(openclaw)
  - 이 브랜치의 `NEXT.md`(main lane 문서)

# 체크포인트별 재료

## 2. manual /compact (GLG 기준: 단순하고 명확하게, 매우 정확하게)

- **GLG 결정:**
  - compact 뒤 기존 Claude 자식은 바로 닫는다.
  - 운영자가 도구를 조인 세션(pi-shell-acp 시절 설정)도 요약 턴을 받는다.
  - 요약 턴의 말이 engraving carrier나 augment에 잡아 둔 내용과 어긋나지 않게 한다.
  - 임베딩 대상은 pi 세션 파일이다. 그래서 summary에 bridge가 붙인 줄이 0이어야 하는 것은 필수다.
- **코드로 확인한 것:**
  - manual과 auto는 같은 `_runDefaultCompaction`을 탄다(pi-coding-agent 1.5.2 `agent-session.js:2302-2305`, manual은 `:2383`).
  - 요약 요청에는 도구가 없다(`compaction.js:499-509`). 그래서 ACP preflight에서 거절된다(`backend.ts:1596-1597`, `tool-surface.ts:98-118`). fa4d552f(v0.24.0)부터 이렇다.
  - 요약 키는 새 `uuidv7()`라서(`compaction.js:479-483`) `pi:<uuid>` 키가 된다.
  - 다음 턴은 prefix가 깨져서 기존 child를 닫고(`backend.ts:1702-1711`), 새 child에 augment, 요약, 남긴 꼬리를 보낸다(`backend.ts:1921-1932`).
  - system 메시지는 버려진다(`context.ts:110`).
  - `[acp:]`와 `[tool:*]` 알림 줄이 `contentText`에 섞인다(event-mapper.ts:343-352, :164-172; pi-ai `utils/text.js:2-9`).
- **설계 방향 (ff08d4·02055a 리뷰 반영):**
  - **판별자:** `options.cacheRetention === "none"`이면서 replay된 active 도구가 비어 있어야 한다.
    - `"none"`은 요약 요청에만 붙는다(`compaction.js:482`). 일반 loop config에는 없다(pi-agent-core `agent.js:306-330`).
    - "sessionId 없음"은 쓸 수 없다. pi가 `?? uuidv7()`로 채운다.
    - 판별이 모호하면 지금처럼 거부한다. 도구를 모두 끈 세션의 일반 턴도 계속 거부한다.
  - **범위:** branch summary(`/tree`, `branch-summarization.js:233-237`)도 같은 경로를 타므로 같이 증명한다.
  - **one-shot 턴:** tools, MCP, permissionAllow, augment, notice를 모두 0으로 하고 retain하지 않는다.
  - **지시 전달:**
    - carrier: 운영자 engraving을 그대로 두고 MCP 목록만 빈 목록으로 렌더한다.
    - 요약 지시: context의 system 텍스트를 읽어 wire의 첫 user 블록 앞에 붙인다. 문구를 복사하지 않고, `context.ts:110`은 그대로 둔다.
    - `_meta.systemPrompt`에 요약 지시를 넣는 relay 안은 철회됐다. 슬롯이 하나뿐이고 그 자리를 engraving이 쓴다.
  - **기존 자식:** `session_compact` 시점에 닫는다.
  - **QK oracle:** 설치된 pi의 `completeSummarization`을 실제로 호출해, provider가 받는 options를 캡처한다. `cacheRetention`은 pi 내부 관례라서 pi 버전 drift를 잡기 위해서다.
- **증명:**
  - QK ① 요약 형태의 컨텍스트 → `_meta.tools=[]`, `mcpServers=[]`, 비보존, summary 텍스트에 notice 0.
  - QK ② compact 이후 컨텍스트 → 자식 정리 + new 경로, 프롬프트에 요약 포함.
  - 각 QK에 exact-once mutant를 둔다. 그 뒤 scratch 세션에서 LIVE `/compact` n=1.
- **자세한 근거:** 02055a 댓글 [6871961225](https://github.com/junghan0611/entwurf/issues/163#issuecomment-6871961225) §1.

## 3. 가시성 최소 집합 (완료, GLG: "pi가 동작하듯이")

- 계약과 andenken 결합은 `docs/acp-backend-rail.md` §11-11에 있다. 증거는 VERIFY의 "Tool visibility (#163)" 행에 있다.
- **미룸:** plan/TodoWrite, subagent_*/async_task_*, 턴 사이 알림, compaction_update capability.
