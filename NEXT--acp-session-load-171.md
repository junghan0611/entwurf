# NEXT--acp-session-load-171 — #171 ACP 코어 레일

**현재 (2026-11-22):** 브랜치 `acp-session-load-171`(로컬, 푸시는 `8ecd6aef`까지, 로컬 HEAD `9ddf950a`). 8단계 구현 완료(8a–8e), 다음은 9단계(LIVE, FULL, mutant body). 목표는 ACP 전체 스펙이 아니라 Pi가 쓰는 코어 능력(initialize, new, prompt, cancel, reuse, resume, load, close, record)을 잘 검증된 구현으로 닫는 것이다. plan 모드나 todo 같은 하네스 모드 기능은 의도적으로 거절한다("안되는게 더 pi 스타일", GLG). **이 레일 안에서 #171을 닫고, ACP용 다음 이슈는 만들지 않는다**(GLG 2026-11-21). 기준은 [`docs/acp-client-baseline.md`](docs/acp-client-baseline.md)의 표다. 표와 #171 댓글이 다르면 표를 고친다.

역할 (8단계, GLG 2026-11-21):
- 조율: `20261113T043350-ff08d4`
- 8단계 설계와 구현(이 트리의 유일한 작성자): Fable `20261121T180949-b6d8f7`
- 검수: Codex Sol `20261121T135110-09fa15`. 체크포인트마다 커밋 전에 받는다.
- 측정과 raw-acp 도구: Opus `20261120T213316-793499`
- 표(`docs/acp-client-baseline.md`): Sonnet `20261120T204416-ad4dae`. 행 변경을 넘겨받을 때만 고친다.
- Terra `20261120T204430-b0194d`는 Pi 수선 중이라 대기한다.
- 외부 자문 B는 GLG를 거쳐 받는다.

# 원칙 (GLG 2026-11-21) — 세션은 붙어 있어야 한다

ACP 행도 네이티브 하네스처럼 하나의 벤더 세션에 붙어 있어야 한다. 실패, 중단, 재시작, 재시도가 일어나도 같은 세션을 잇는다.

같은 입력이 두 번 가는 것은 괜찮다. 모델은 중복을 알아보고 넘어간다.
- GPT가 overloaded일 때 사람이 같은 메시지를 몇 번 더 보내도, 네트워크가 풀린 뒤 GPT는 그 작업을 여러 번 하지 않는다. "같은 말을 여러 번 보냈군" 하고 만다.
- 형제가 같은 메일을 두 번 받아도, 읽고 "또 왔나 보군" 하고 넘어간다.

피해야 할 것은 new다.
- new가 되면 벤더 세션이 쌓아 온 맥락을 잃는다.
- 이 원칙이 서지 않으면 그 위에 올릴 renew와 pi-durable의 ACP 지원이 불안해진다.

new는 벤더 세션을 정말 쓸 수 없을 때만 이유를 보이며 만든다. 그런 경우는 세 가지다: 세션이 없을 때, 측정하지 않은 버전일 때, Pi 쪽 transcript가 바뀌었을 때.

이 원칙으로 결정 8(a)·9·G2·G5와 규칙 6을 다시 본다. new로 가는 모든 경로는 `.agent-reports/171-acp-continuity-inventory.md`에서 전수 검토한다.

# RAIL

- [x] **0. 측정.** RAIL 0(Claude와 agy의 resume·load), 모르는 id, Z5, U11/U12를 쟀다. 영수증은 `~/.local/share/entwurf-lab/171/`에 있다.
- [x] **1. 표와 오라클.** `e330d472`, `b87340a1`.
- [x] **2. L15 저장소 수선과 V5 결정.** `5fa8c225`.
- [x] **3. L5 reuse delta 유실 수정.** `44e0e5fd`.
- [x] **4. L1/V5와 문서.** `79157a17`(표 정정), `75415873`(initialize facts와 measured 가드), `ece98cf5`(짧은 개념 표, 전체본은 `.agent-reports/171-acp-client-baseline-full.md`). PARTIAL 127/127, 12/12. FULL exit 0.
- [x] **5. L16 기반.** `593c7a5f`.
  - 들어간 것: record v2, 표식(위치·개수·서명), 재접속 때 record 읽기, Pi 재시도 분류기에 걸리지 않는 고정 오류 문구.
  - 검증: PARTIAL 139/139, 1/1. FULL은 GLG 요청으로 중단했고, 이 체크포인트의 근거로 쓰지 않는다.
  - 이 체크포인트의 정지·record 버림·거절 동작은 결정 8(a)·9·G2를 따른 것이고, 6단계에서 원칙에 맞게 고친다.
- [x] **6. 연속성 설계.** 결정 15–18, #171 issuecomment-7057784167.
  - 6a. new로 가는 모든 경로를 전수 검토한다(Opus #O23, `.agent-reports/171-acp-continuity-inventory.md`). 경로마다 적을 것: 무엇이 new를 일으키는지, 벤더 세션을 아직 쓸 수 있는지, 목표(세션 유지 / 같은 id로 resume / 이유를 보이며 new), 필요한 것(코드·L8·측정·결정).
  - 6b. 결정 8(a)·9·G2·G5와 규칙 6을 원칙으로 다시 쓴다. 표식의 역할도 다시 정한다: 진단용인지, 같은 id로 이을 근거인지.
  - 6c. GLG 리뷰 → #171 댓글 → 표(짧은 표와 전체본)에 반영.
- [x] **7. 재측정 도구와 벤더 올리기.**
  - 측정 도구: `47778eac`, `c359e2d7`, `ec0f4fdd`, `8c7e0672`(`run.sh all`). 대조기는 키 146개를 정확히 비교하고, 전제 조건이 맞지 않으면 inconclusive로 표시한다. Codex Sol이 네 번 리뷰했다.
  - 핀: `d542d775`. claude-agent-acp 0.109.0, ACP SDK 2.8.0(클라이언트와 어댑터가 같은 버전), measured는 Claude 0.109.0과 agy 1.5.13이다.
  - LIVE 5회, 프롬프트 177개. 기존 동작은 모두 일치했다. 영수증은 `~/.local/share/entwurf-lab/171/step7/live/`에 있다.
    - run 1: Claude 0.107.3
    - run 2: Claude 0.109.0. U26에서 0.107.3 세션을 0.109.0으로 resume했다.
    - run 3: agy 1.5.13. U26에서 1.5.12 세션을 1.5.13으로 resume했다.
    - run 4: 새 핀, 클라이언트 2.8.0
    - run 5: agy gemini-4-hydrogen, U17만
  - **8단계로 가져갈 측정 사실 (두 벤더 공통)**
    - 연속성의 기반: 끊긴 턴은 세션에 남는다(U12). 운영 종료·그룹 kill·agent kill 뒤에도 같은 id로 resume되고 회상한다(U21). 버전을 건너도 resume된다(U26). 살아 있는 세션에서 모델 변경(U25), 새 `mcpServers`로 resume(U24), 오류 뒤 같은 세션 사용(U18, 대리 측정)이 된다.
    - U9: 두 프로세스가 같은 세션을 resume하면 둘 다 답한다. 벤더 쪽 가드가 없으므로 우리의 one-holder 가드(Z6)가 필수다.
    - U12: 도구가 띄운 셸 명령이 그룹 SIGKILL 뒤에도 살아남는다. 운영 teardown에서도 같은 누수가 생기는지 확인한다.
    - U14: `/compact`는 단독 블록일 때만 동작한다. agy는 `/compact`에 compaction을 하지 않는다.
    - U23: 거절된 resume도 벤더 저장소에 흔적을 남긴다. agy는 모르는 id에도 `-32603`을 돌려준다.
    - U24: 설정을 바꿔 resume할 때 carrier 변경은 확인되지 않았다.
    - agy는 여러 텍스트 블록을 구분자 없이 한 문장으로 붙인다. 운영의 여러 블록 전송(보강, 여러 user 메시지)에 구분자가 필요하다. 구분자를 넣으면 agy U17 결과가 바뀔 수 있으므로 9단계에서 다시 잰다.
- [ ] **8. L8/L9와 연속성 구현 (GLG 리뷰).** ← CURRENT
  - **체크포인트 (2026-11-21).** 기준은 plan v3(`.agent-reports/171-step8-plan-v3.md`)에 Sol 검수(#C9–#C14)를 반영한 것이다. 원칙은 "싸게 증명되는 경로만 잇고 나머지는 고정 문구로 멈춘다"이고, 모든 정지는 나가는 길을 문구 모듈에 함께 적는다.
    - [x] 8a.1 + 8a.2 `8a248bc9`: 정지 문구 26개(`stop-texts.ts`, Pi의 재시도·오버플로 분류기가 오라클)와 결정 18. resident 여부는 argv가 아니라 control extension이 보고한 파싱된 플래그로 판정한다(`lib/acp-host-facts.ts`). PARTIAL 144/144, 4/4.
    - [x] 8a.3 `6f9b268c`: agy 블록 구분자(L18). PARTIAL 145/145, 9/9, 10/10.
    - [x] 8b.1: 살아 있는 세션의 재사용 가드. 턴마다 마지막 메시지에 턴 id(`responseId`)를 찍고, Pi 브랜치의 마지막 답변이 세션이 마지막으로 완료한 바로 그 턴일 때만 delta를 보낸다(`branch-gate.ts`). 브랜치가 보여 주는 입력과 보낼 delta는 같은 렌더러의 전송 문자열로 비교하고, 다르거나 텍스트가 아니면 멈춘다. 상주 턴의 payload hook은 아무것도 바꿀 수 없다. 프롬프트 전에 거절된 재사용 턴은 세션을 유지한다. 정지 문구는 27개(`host` 추가). PARTIAL 157/157, 10/10, 9/9.
      - plan v3와 다른 점: 형제 메일(`custom_message`)은 입력으로 받는다(v3대로 멈추면 ACP 상주 시민이 메일마다 멈춘다). Pi의 system 메시지 엔트리는 건너뛴다.
      - 8c까지의 중간 상태: 프롬프트 전에 거절된 재사용 턴(ESC 포함) 뒤로는 `changed`로 멈춘다. 이미지가 든 재사용 입력도 멈춘다.
    - [x] 8b.2 `e8ec5840`: 상주 세션은 birth일 때만 `session/new`를 연다(record 없음, 예약 없음, Pi 브랜치에 ACP 흔적 없음). 그 밖은 모두 이름 붙은 정지이고 record는 지우지 않는다. `streamAcpTurn`의 단일 가드(`decideResident`), 영속 birth 예약(`birth-reservation.ts`, `wx` + 파일·디렉터리 체인 fsync), `session/new` 직전 재확인(호스트 세션 id, abort), record는 `session/new` 응답 직후 기록(fsync). 브랜치의 Entwurf 답변은 "no ACP session was started this turn" 스탬프가 붙은 것만 pre-birth로 본다. 응답된 cancel은 첫 턴 세션도 유지한다(B5 앞당김). 정지 문구 28개(`reserve` 추가). PARTIAL 10개 그룹 249/249(영수증 `~/.local/share/entwurf-lab/171/step8/8b2*-*.json`; `IDLE-DEATH-ANNOUNCED` mutant는 가드 쪽 공지 지점으로 옮겨 재실행). LIVE·FULL 미실행.
      - 9단계 Pi smoke에서 잴 가정 둘: 실제 Pi가 aborted 최종 메시지에 `responseId`를 저장하는가, 실패한 답변의 content 블록을 `textSignature`째 저장하는가. 둘 다 fake Pi host(`scripts/lib/acp-fake-pi-session.ts`)가 모델링한 것이지 측정한 것이 아니다.
      - rename 뒤 sync 오류는 롤백을 주장하지 않는다(Sol). 실패한 봉인 기록이 재사용을 막는 게이트는 8b.3.
    - [x] 8b.3 `567d10bb`: 답이 없는 상주 프롬프트를 `unknown`으로 봉인(마커 기준), 전송 격리, 종료 사유 분류.
    - [x] 8c `9ddf950a`: 같은 id `session/resume`(측정된 writer→reader 쌍만: Claude `0.109.0`, agy `1.5.13`/`1.5.12`), delta 증명(봉인된 턴 id 앵커, 마커의 entry id), holder lease, 설정 변경 분류. Sol 리뷰 1회 + 수선 1회(B1 lease 아래 record 재확인, B2 agent 추적, B3 text 변경은 저장 세션에서 정지).
      - GLG 2026-11-22: v1 record는 붙지 않는다(STOP `version`). `interim` 정지는 없앴다(정지 문구 29개).
      - 저장 세션은 setup text가 바뀌면 STOP `config`다. carrier가 MCP 서버 이름을 담으므로 서버 추가/제거도 여기에 걸린다. 같은 이름의 서버 정의 변경만 resume으로 넘어간다. resume 요청의 carrier를 vendor가 적용하는지 재면 풀 수 있다.
      - length-cut 답(U12) 뒤 다음 턴은 `changed`로 멈춘다(`context_edit` 엔트리에서 walk가 멈춤). 세션은 유지.
      - 앵커는 context의 `responseId` 정확 일치만 받는다. **9단계 Pi smoke 필수 측정:** 실제 Pi가 provider context의 assistant에 `responseId`를 실어 주는가(평범한 두 번째 턴), 실패·중단 답변에 `responseId`/`diagnostics`를 저장하는가(재개, 실패 답변 케이스). 아니면 모든 두 번째 턴이 `changed`로 멈춘다. Sol: 이것을 재기 전에는 reuse/resume을 LIVE 검증됐다고 부르지 않는다.
      - kill-power: 영향 그룹 12개는 PARTIAL green(`~/.local/share/entwurf-lab/171/step8/8c-*.json`, `8cr-*`). `check-acp-set-model-readback` 그룹(8b.3 + 8c 몫)은 돌리지 않았다. GLG 2026-11-22: 홉마다 body를 돌리지 않는다. 변경된 ACP 구획의 focused 게이트만 돌리며 나아가고, mutant body는 9단계에서 한 번 돌린다.
    - [x] 8d: Pi compaction 뒤에도 같은 vendor 세션(16-1). branch walk가 compaction을 지나가고, context는 Pi가 남긴 범위(`firstKeptEntryId`)에 따라 앵커 답변 또는 그 compaction의 summary head로만 증명된다. `compacted` 정지 제거(28개). 떠나는 idle 세션에는 `session/close`를 먼저 보낸다(L7, 최대 1.5초, 응답 무관).
      - 운영에서는 `session_compact` 핸들러가 child를 닫으므로(#163 그대로) 같은 vendor id에 agent만 바뀐다. vendor context는 vendor의 compaction이 관리한다.
    - [x] 8e: 표의 not-wired 행을 종착 상태로. **GLG 2026-11-22: L9(`session/load`)와 Z4는 declined로 확정. 지금 지원하는 ACP들에 집중한다.** P2는 deferred(9단계 U4), U 행은 9단계.
  - 같은 세션을 잇는다:
    - child가 살아 있으면 세션을 유지한다. 오류가 나면 세션을 닫던 GPT ④(`backend.ts:2711`)를 뒤집는다.
    - child가 죽었거나 Pi를 다시 열면 같은 id로 resume한다.
    - 재시도와 다음 입력도 같은 세션으로 보낸다.
  - V5 가드와 결정 1(resume 실패 계약)을 적용한다.
  - 같은 단계에서 닫을 행: L7, L11/V2, L14, P1, Z3, Z4, V1, Z6/V3(U9와 함께).
  - **설계 물음표에 대한 답 (2026-11-21, 조율자가 확인)**
    - 결정 18의 형태: ACP 모델 등록은 유지하고, `--entwurf-control` 없는 tui·rpc만 오류로 멈춘다. 다섯 LIVE smoke가 control 없이 `pi -p`로 ACP를 쓰기 때문이다(`smoke-acp-mcp`, `carrier-augment`, `provider`, `long-turn`, `skill`).
    - fork 출처: extension이 받는 `ctx.sessionManager`(ReadonlySessionManager, `types.d.ts:243`)의 `getHeader().parentSession`으로 판별한다. fork가 이 값을 채운다(`session-manager.js:1259`).
    - `/tree` 감지: 같은 manager의 `getLeafId()`와 `getBranch()`로 entry id를 얻는다. 봉인할 때 leaf entry id를 record에 남기고, 다음 턴에 비교한다. 지금의 서명은 내용만 보므로 가지 전환을 놓친다.
- [ ] **9. 마감.**
  - 7단계의 명령으로 마지막 LIVE를 돌린다: U12–U16, P2/U4.
  - 표의 모든 행이 종착 상태여야 한다.
  - PARTIAL과 동결 FULL을 돌린다.
  - 영수증을 #171에 붙이고 #171을 닫는다. main에 병합하기 전에 이 파일을 지운다.
  - 0.61.0에서 Entwurf ACP의 방향을 이야기한다.
- 이 레일 밖, 그다음: 0.62.0에서 Pi SDK 1.6.0에 맞춘다.

# 결정 (GLG)

2026-11-20 결정 1–5와 2026-11-21 결정 6(V5)은 표 문서의 Decisions 절에 있다. 2026-11-21에 더한 것:

7. **reuse delta.** 마지막 assistant 뒤의 user 메시지를 모두 보낸다. 첫 user skip은 버린다(유실보다 소음을 택함). `/compact`는 첫 블록으로 판정한다.
8. **L16 pendingDispatch** (B와 닷이 합의한 안, #171 issuecomment-7055533122).
   - `session/prompt` 직전에 record에 원자적으로 쓴다. 뜻은 "이 범위는 실행됐을 수 있다"이다. 프롬프트 원문은 넣지 않는다: 위치, 개수, 서명만.
   - 봉인할 때, record를 전진시키는 같은 쓰기에서 지운다.
   - 재접속 때 표식이 있으면 assistant가 보이더라도 정지한다. 기존 id와 새 id 모두 자동 전송은 0회다.
   - 표식 필드가 없는 구버전 record는 resume에 쓰지 않고 new로 간다.
   - 새 버전 record에 표식이 없을 때: 꼬리(record 이후)에서 user 메시지 뒤에 assistant가 오면 record가 뒤처진 것이므로 new로 간다. 그렇지 않으면 user들을 순서대로 보낸다. record의 prefix에는 봉인된 턴의 답이 들어가지 않으므로, 정상 연속은 늘 [A U…]이다(Opus #O20, R12에서 측정된 B의 판정식). 원래의 '꼬리에 assistant가 있으면 new'는 정상 연속까지 new로 보내므로 고쳤다.
   - **[6단계에서 재검토]** (a) 정지는 한 번이다. 이유와 범위(위치와 개수)를 보이고 record를 버린다. 다음 턴은 new다.
   - **[6단계에서 재검토] G2:** 이 규칙은 이름 붙은 정지 전부에 적용된다: 재시작 뒤 표식 발견, 살아 있는 프로세스의 prompt 실패, attach 성공 뒤 첫 prompt 실패, attach timeout이나 child 사망.
9. **[6단계에서 재검토] 표식 저장 실패 → 전송 0회.** 결정 3이 바뀐다: 저장소가 계속 실패하면 다음 턴은 이유를 보이며 거절된다. 같은 부류(전송 전 저장소 문제 → 거절): 읽을 수 없는 record(unreadable)도 거절하고, record 삭제(drop)에 실패하면 삭제될 때까지 전송 0회다(조율자, #O20). 봉인 뒤 지우기 실패는 결정 3대로 degraded 알림을 내고, 다음 재접속에서 한 번 정지한다.
10. **Claude에도 measured 가드.** resume과 load는 "보고된 버전 = 측정한 버전"일 때만 연다.
11. **G1:** Z5와 V4는 declined로 확정한다(R10).
12. **G3:** 재측정을 L8/L9 앞으로 옮기고, 명령 하나로 영수증과 자동 대조하게 만든다. 6단계에서 Claude 0.109.x와 agy 1.5.13을 함께 다룬다.
13. **G4:** P2는 마지막 LIVE에서 재서 닫는다. Z7은 declined로 둔다(복구 경로는 Pi resume).
14. **문서 분리.** docs에는 개념 비교용 짧은 표를 두고, 전체 문서는 `.agent-reports`에 둔다.
15. **연속성 원칙 (맨 위 "원칙" 절).** 결정 8(a)·9·G2는 이 원칙으로 다시 본다(6단계).
    - 한 문장(운영코디 제안, GLG 채택): 살아 있으면 그대로, 끊겼으면 같은 ID로, 불명이면 record를 남기고 그 턴만 멈춘다. new는 새 장을 열기로 했거나, 기존 세션을 쓸 수 없다는 근거가 있을 때만 이유를 보이며 한다.
    - 기준은 네이티브다. Pi 네이티브가 정답이라는 뜻이 아니라, Pi로 쓸 때 사용자 경험이 달라질 필요가 없다는 뜻이다(GLG).
    - G5: 프롬프트를 보낸 뒤 실패하면 세션을 유지하고 고정 문구로 멈춘다. Pi의 자동 재시도로 결과가 불명인 입력을 다시 보내지 않는다. 대화의 중복은 괜찮지만 작업의 중복은 다르기 때문이다(운영코디). 사람이 다음 입력을 보내면 실패한 입력도 같은 세션에 함께 간다(16-9).
16. **6단계 결정 (GLG 2026-11-21, 운영코디의 권고표를 채택).** 근거와 경로별 표는 `.agent-reports/171-acp-continuity-inventory.md`에 있다.
    1. Pi compaction: 같은 벤더 세션을 유지한다(#163 변경). 수동 `/compact` 뒤에 세 가지를 한 번 확인한다: 벤더 id가 같은지, 이전 맥락을 회상하는지, Pi 요약이 다시 주입되지 않는지.
    2. `/renew`: 의도된 new다. 같은 garden 아래 새 Pi 장과 새 벤더 세션을 열고, 합의한 얼개를 받는다.
    3. 같은 벤더 안의 모델 변경: 같은 세션 안에서 바꾼다. 실제로 지원하는 조합만 허용하고, 안 되면 이유를 보이며 거절한다. 조용히 new로 바꾸지 않는다.
    4. 다른 provider나 turn-scoped 실행 뒤에 돌아왔을 때: 맥락이 갈라졌다는 오류로 멈춘다(17이 이 칸의 "새 벤더 세션을 연다"를 대체). 빠진 답을 재구성해 끼워 넣지 않는다(Hard Rule 9). 기존 record는 보존한다.
    5. 미측정 버전: 업데이트만으로 세션을 버리지 않는다. 재개를 지원한다는 근거와 성공을 판정할 근거가 있으면 같은 id로 시도한다. 근거가 없으면 이유를 알리고 멈춘다.
    6. 모호한 resume 오류(agy `-32603`, Claude `-32002`도 포함): 오류 번호만으로 세션이 없다고 판정하지 않는다. 같은 id 재시도가 안전하다는 실측이 있으면 한 번 다시 시도한다. 그래도 불명이면 record를 남기고 그 턴만 멈춘다.
    7. 명시적인 `pi -p`(turn-scoped): 일회용으로 유지한다.
    8. 설정 변경(D3): 같은 id로 resume하면서 새 설정(`mcpServers` 등)을 넘긴다. 거절되면 멈춘다(17).
    9. 실패하거나 abort된 턴의 입력: 다음 턴에 다시 보낸다(네이티브와 같은 경계, F1).
       - abort 쪽은 측정한 뒤 나눈다(GLG 2026-11-21, B의 지적). error, 응답 없는 abort, child 사망 때는 벤더가 입력을 못 받았을 수 있으므로 다시 보낸다.
       - 응답된 abort 때는 벤더 세션이 취소된 입력을 이미 가지고 있다. 그래서 다시 보내면 정정 바로 앞에 두 번 들어간다.
       - 권고: 응답된 abort 때는 다시 보내지 않는다. 지금 코드(`context.ts:84-85`)가 이미 이렇게 동작한다.
       - 취소가 확인됐다는 증거는 원래 `session/prompt`가 stopReason `cancelled`로 끝난 것뿐이다(닷). `session/cancel`은 응답이 없는 알림이고, Pi의 `aborted` 표기는 운영자 abort와 벤더 cancelled를 구분하지 못한다. 취소를 보냈지만 확인을 받지 못한 경우는 "결과 불명"으로 따로 보고한다.
       - 8단계 구현 단서 (닷이 바로잡음):
         - "응답 없는 abort는 표식이 남는다"는 8단계에서 만들어야 할 동작이다. 지금 코드는 catch에서 표식이 있으면 record를 지운다(`backend.ts:1848-1857`, `:2666-2704`).
         - 응답된 취소를 "표식 없음 + aborted"로 판정하면 안 된다. 취소 버튼과 정상 응답이 엇갈리면, record가 봉인돼 표식이 지워진 채로 Pi에는 `aborted`로 보일 수 있다.
         - 예외를 둔다면 벤더의 stopReason `cancelled`를 record에 직접 남기고, 그것을 근거로 삼는다.
       - GLG(2026-11-21): "pi도 구분 못하면 우리도 구분 못하는 것도 좋은 일이다." 그러니 Pi보다 영리하게 가르려고 하지 않는다. 표식으로 나누는 안은 U17 d의 결과가 그만한 근거를 줄 때만 쓴다.
       - 4번의 판정 순서(닷): 먼저 같은 id에 정정 Y만 보냈을 때 맥락이 이어지는지, 그리고 취소한 X가 다시 실행되지 않는지를 본다. U17 d가 실질적인 차이를 보일 때만 벤더 `cancelled`를 근거로 예외를 둔다. 그렇지 않으면 Pi와 같은 규칙(다시 보냄)으로 간다. 0.109.0 핀은 그 LIVE 결과를 본 뒤 별도 커밋으로 올린다.
       - **7단계 LIVE 결과 (2026-11-21, Claude 0.107.3과 0.109.0, agy 1.5.13, 154 프롬프트).** 두 벤더 모두 끊긴 턴을 세션에 남긴다(U12).
         - 이미 받은 X를 다시 보냈을 때: Claude는 매번 다시 실행했다(b +1, c +1, d2 +1). agy(gemini-3.8-flash-low)는 모델 판단에 따라 달랐다(b +0, c +1, d2 +0). Y만 보낸 d1은 두 벤더 모두 +0이었다.
         - GLG 결정(Claude): 보낸 것은 다시 보내지 않는다. 메시지는 세션에 남아 유실되지 않고, 다시 보내면 작업이 중복되기 때문이다. GLG 결정(agy): gemini-4-hydrogen으로 U17을 한 번 더 잰 뒤, 별 차이가 없으면 다시 보낸다. GLG의 이유: "중복은 노이즈인데 메시지 안 주는 건 문제야."
         - hydrogen 측정 결과(run 5): b, c, d2가 모두 +0이었다. flash보다 중복이 적었고, 다시 보낸 메시지는 모든 경우 벤더 transcript에 들어 있었다. 그래서 GLG 규칙대로 **agy는 다시 보낸다.** 중복은 모델의 판단이고 보장은 아니다(n=1).
       - U17 경우 d로 판정한다: X를 요청하고, 응답된 취소를 받은 뒤, Y를 보낸다. Y만 보낼 때와 X와 Y를 함께 보낼 때를 비교해 X가 몇 번 실행되는지 센다. U12의 cancel 변형으로 취소 뒤 벤더 세션이 X를 가지고 있는지도 본다.

17. **내부 new 금지 (GLG 2026-11-21).**
    - 내부에서 new로 가는 조건은 기본값이 전부 "안 됨"이다. 박살이 나더라도 멈춘다.
      - new를 남겨 두는 것은 에이전트 도구에 warning을 남겨 두는 것과 같다. 오류가 나고 터져야 한다.
      - 멈춘 뒤에는 원인을 파악하고, 필요한 대응을 entwurf에 경우별로 추가해 살린다.
    - resume이 거절되거나 불명이면 오류로 멈춘다. 다음 경우도 모두 오류로 멈춘다:
      - agy `not_found`
      - cwd가 바뀜
      - Pi transcript가 편집됨(`/tree`)
      - 맥락이 갈라짐(16-4)
      - record가 없거나 읽을 수 없는데, 이 Pi 세션에 이미 ACP 답이 있음
    - new로 가도 되는 경우는 둘뿐이다.
      - 탄생: 이 Pi 세션에 아직 벤더 세션 id가 한 번도 생긴 적이 없을 때. 첫 ACP 턴과, id를 받지 못하고 실패한 뒤의 재시도가 여기에 든다.
      - 사람이 고른 것: Pi의 `/new`, `/fork`, `/renew`, 그리고 명시적인 `pi -p`.
    - 표식 쓰기에 실패하면 보내기 전에 오류로 멈춘다(Hard Rule 15). 세션은 유지한다.
    - 구버전(v1) record에도 벤더 id가 있으므로, 버리지 말고 읽어서 resume한다(결정 8의 "outdated → new"를 대체).

18. **ACP는 `entwurf pi`에서만 쓴다 (GLG 2026-11-21, A9b 안 c).**
    - 운영자의 Pi 설정은 이 checkout을 user scope 패키지로 불러온다(`~/.pi/agent/settings.json`의 `packages`, `package.json`의 `pi.extensions`). 그래서 지금은 플래그 없는 `pi`에서도 ACP 모델이 보이고, 매 턴 new로 열고 닫는다.
    - 바꾸는 것: `--entwurf-control` 없는 tui·rpc에서 ACP 턴을 시작하면 "`entwurf pi`로 띄우라"는 오류로 멈춘다.
      - 플래그가 없을 때 ACP 모델을 아예 등록하지 않는 형태가 가장 깔끔하다. 다만 명시적인 `pi -p`로 ACP를 쓰는 곳이 있는지(게이트, fresh call) 먼저 확인한다.
      - 그런 곳이 있으면 `pi -p`만 일회용으로 남긴다(16-7).
    - `entwurf` 커맨드가 정본이다. 필요하면 `entwurf help pi` 페이지(ENTWURF-CLI.json)에 ACP 이야기를 넣는다.
    - A10(`/tree`·compaction 요약용 별도 세션): 허용한다. 네이티브의 무상태 요약 호출에 해당한다. 대화 record는 읽지도 쓰지도 않으며, 이 성질을 테스트로 고정한다.
    - 16-4 수정(맥락이 갈라지면 오류로 멈춤)과 C14의 결과(Claude 첫 턴이 프롬프트 전에 끊기면 다음 턴도 멈춤)는 권고대로 확정한다.
    - claude-agent-acp 핀 올리기: 측정이 끝난 뒤 별도 커밋으로 한다. 이 checkout이 운영 런타임이므로(#165) ACP 행이 열려 있지 않은 시간에 한다. 오라클에서는 이 작업이 메인이며, 필요하면 다른 세션을 끌 수 있다(GLG). 끌 세션은 이름을 대서 확인한다.

# 진행 방식

구현 → focused 게이트 → Sonnet 리뷰 → 수정 한 묶음 → 바뀐 mutant 그룹의 PARTIAL → 동결 FULL → 커밋. 푸시는 GLG가 요청할 때만 한다. mutant 대상 파일은 PARTIAL 전에 stage한다. FULL 전에는 build-bridge를 돌린다.

# 금지

- Entwurf가 transcript를 hydrate하거나 prompt를 재구성하지 않는다(Hard Rule 9).
- 실패를 조용한 full replay로 떨어뜨리지 않는다(Hard Rule 5).
- 운영자 HOME과 설정을 바꾸지 않는다. 운영 환경에 설치하지 않는다(#165). 자격증명을 열지 않는다.
- LIVE 측정은 `LIVE=1`로만 하고, 출력은 리포 밖에 둔다.
- BASELINE.md와 VERIFY.md를 늘리지 않는다.
