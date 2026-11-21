# NEXT--acp-session-load-171 — #171 ACP 코어 레일

**현재 (2026-11-21):** 브랜치 `acp-session-load-171` @ `593c7a5f`(로컬, 푸시는 `44e0e5fd`까지). 목표는 ACP 전체 스펙이 아니라 Pi가 쓰는 코어 능력(initialize, new, prompt, cancel, reuse, resume, load, close, record)을 잘 검증된 구현으로 닫는 것이다. plan 모드나 todo 같은 하네스 모드 기능은 의도적으로 거절한다("안되는게 더 pi 스타일", GLG). **이 레일 안에서 #171을 닫고, ACP용 다음 이슈는 만들지 않는다**(GLG 2026-11-21). 기준은 [`docs/acp-client-baseline.md`](docs/acp-client-baseline.md)의 표다. 표와 #171 댓글이 다르면 표를 고친다.

역할:
- 조율과 게이트: `20261113T043350-ff08d4`
- 구현: Opus `20261120T213316-793499`
- 리뷰와 표: Sonnet `20261120T204416-ad4dae`
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
- [ ] **6. 연속성 설계.** ← CURRENT
  - 6a. new로 가는 모든 경로를 전수 검토한다(Opus #O23, `.agent-reports/171-acp-continuity-inventory.md`). 경로마다 적을 것: 무엇이 new를 일으키는지, 벤더 세션을 아직 쓸 수 있는지, 목표(세션 유지 / 같은 id로 resume / 이유를 보이며 new), 필요한 것(코드·L8·측정·결정).
  - 6b. 결정 8(a)·9·G2·G5와 규칙 6을 원칙으로 다시 쓴다. 표식의 역할도 다시 정한다: 진단용인지, 같은 id로 이을 근거인지.
  - 6c. GLG 리뷰 → #171 댓글 → 표(짧은 표와 전체본)에 반영.
- [ ] **7. 재측정 도구와 벤더 올리기.**
  - `scripts/raw-acp-session-measure/`를 명령 하나로 만든다: 시나리오를 돌리고 R1–R10의 결정적인 줄과 자동으로 대조한다. 같으면 `measured`만 올리고, 다른 줄만 사람이 본다.
  - 그 명령으로 agy 1.5.13을 재고, claude-agent-acp를 0.109.x로 올린다(`package.json` 핀, lockfile, 재측정).
  - 연속성에 필요한 벤더 사실도 이 명령에 넣는다: 턴 도중 child가 죽으면 디스크의 벤더 세션에 무엇이 남는지(U12), 같은 프롬프트가 두 번 오면 벤더가 어떻게 받는지, 오류로 멈춘 뒤 같은 세션이 계속 쓸 만한지.
  - **들어가기 전 물음표 점검 (2026-11-21, 조율자가 확인)**
    - [x] 기존 probe 수정: `claudeLauncherArg`가 prefix 변수가 없으면 이전 동작 그대로다(`common.mjs`). 그래서 저장된 R1–R10 run은 계속 대조 기준이 된다.
    - [x] Claude 쿼터: 7일 창의 48%를 썼고, 속도는 0.6x다. 프롬프트 약 42회를 쓰기에 충분하다.
    - [ ] agy 토큰: quota 도구가 "agy token expired"라고 보고했다. GLG가 agy를 한 번 열어 갱신한다. 우리는 자격증명을 열지 않는다.
    - [x] agy 쓰기 도구: hook 정책 `v1:hidden-turns`는 모델 턴을 여는 도구만 막고 나머지는 허용한다(`agy-acp-hook.mjs:13`). agy 자체의 권한 요청을 하네스가 어떻게 받는지는 오푸스가 확인한다.
- [ ] **8. L8/L9와 연속성 구현 (GLG 리뷰).**
  - 같은 세션을 잇는다:
    - child가 살아 있으면 세션을 유지한다. 오류가 나면 세션을 닫던 GPT ④(`backend.ts:2711`)를 뒤집는다.
    - child가 죽었거나 Pi를 다시 열면 같은 id로 resume한다.
    - 재시도와 다음 입력도 같은 세션으로 보낸다.
  - resume과 load를 배선하고, "record not used" 핀(`scripts/check-acp-session-reuse.ts`)을 뒤집는다. `decideBootstrap`은 initialize 뒤로 옮긴다.
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
