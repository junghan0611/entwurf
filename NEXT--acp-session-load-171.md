# NEXT--acp-session-load-171 — #171 ACP 코어 레일

**현재 (2026-11-21):** 브랜치 `acp-session-load-171` @ `ece98cf5`(로컬, 푸시는 `44e0e5fd`까지). 목표는 ACP 전체 스펙이 아니라 Pi가 쓰는 코어 능력(initialize, new, prompt, cancel, reuse, resume, load, close, record)을 잘 검증된 구현으로 닫는 것이다. plan 모드나 todo 같은 하네스 모드 기능은 의도적으로 거절한다("안되는게 더 pi 스타일", GLG). **이 레일 안에서 #171을 닫고, ACP용 다음 이슈는 만들지 않는다**(GLG 2026-11-21). 기준은 [`docs/acp-client-baseline.md`](docs/acp-client-baseline.md)의 표다. 표와 #171 댓글이 다르면 표를 고친다.

역할:
- 조율과 게이트: `20261113T043350-ff08d4`
- 구현: Opus `20261120T213316-793499`
- 리뷰와 표: Sonnet `20261120T204416-ad4dae`
- Terra `20261120T204430-b0194d`는 Pi 수선 중이라 대기한다.
- 외부 자문 B는 GLG를 거쳐 받는다.

# RAIL

- [x] **0. 측정.** RAIL 0(Claude와 agy의 resume·load), 모르는 id, Z5, U11/U12를 쟀다. 영수증은 `~/.local/share/entwurf-lab/171/`에 있다.
- [x] **1. 표와 오라클.** `e330d472`, `b87340a1`.
- [x] **2. L15 저장소 수선과 V5 결정.** `5fa8c225`.
- [x] **3. L5 reuse delta 유실 수정.** `44e0e5fd`.
- [x] **4. L1/V5와 문서.** `79157a17`(표 정정), `75415873`(initialize facts와 measured 가드), `ece98cf5`(짧은 개념 표, 전체본은 `.agent-reports/171-acp-client-baseline-full.md`). PARTIAL 127/127, 12/12. FULL exit 0.
- [ ] **5. L16 pendingDispatch.** ← CURRENT
  - 표식을 쓰고 지우는 일, 그리고 재접속 판정을 구현한다.
  - 정지 네 경우 모두 record를 버린다(G2).
  - fake agent 시나리오는 넷이다: 안 보낸 입력 여럿은 순서대로 보낸다 / 표식이 있으면 두 id 모두 전송 0회 / 표식 저장에 실패하면 전송 0회 / 정지 한 번 뒤 new.
  - 적용 범위는 retained·process-scoped 세션뿐이다.
  - 이 단계부터 표식을 쓰지 못하면 턴이 거절된다. 이 checkout을 쓰는 운영 세션도 포함된다.
- [ ] **6. 재측정 도구와 벤더 올리기 (G3).**
  - `scripts/raw-acp-session-measure/`를 명령 하나로 돌게 만든다: 시나리오를 실행하고, R1–R10의 결정적인 줄과 자동으로 대조한다. 같으면 `measured`만 올리고, 다른 줄만 사람이 본다.
  - 그 명령으로 agy 1.5.13을 재고, claude-agent-acp를 0.109.x로 올린다(`package.json` 핀, lockfile, 재측정).
  - `measured` 상수와 영수증을 함께 갱신한다.
- [ ] **7. L8/L9 묶음 (GLG 리뷰).**
  - resume과 load를 배선하고, "record not used" 핀(`scripts/check-acp-session-reuse.ts:320-351`)을 뒤집는다.
  - V5 가드 아래에서 결정 1의 실패 계약을 적용한다.
  - `decideBootstrap`을 initialize 뒤로 옮긴다(spawn → initialize → 판정).
  - 같은 단계에서 닫을 행: L7 close, L11/V2(attach 뒤 model·effort 재적용), L14(attach를 건너는 compaction), P1(`entwurf_resume_call`), Z3(typed load error와 stderr tail), Z4(load 응답 경계), V1(resume 우선), Z6/V3(Pi 프로세스 사이의 one-holder 가드, U9와 함께).
- [ ] **8. 마감.**
  - 6단계의 명령으로 마지막 LIVE를 한 번 돌린다: U12–U16, 그리고 P2/U4(`/renew` on ACP row, 오늘 동작이 맞으면 implemented).
  - 표의 모든 행이 종착 상태여야 한다.
  - PARTIAL과 동결 FULL을 돌린다.
  - 영수증을 #171에 붙이고 #171을 닫는다. main에 병합하기 전에 이 파일을 지운다.
  - 0.61.0에서 Entwurf ACP의 방향을 이야기한다.
- 이 레일 밖, 그다음: 0.62.0에서 Pi SDK 1.6.0에 맞춘다.

# GLG 결정 대기

- **G5. 실행됐을지 모르는 턴이 실패했을 때, Pi의 자동 재시도를 막을지** (Opus #O21 관찰, R12 `U12-timeout-retries-exhausted`).
  - 지금 동작: 같은 프로세스 안에서 prompt가 실패하고, 벤더 오류 문구가 Pi의 재시도 패턴(429/5xx 숫자)에 걸리면 Pi가 스스로 재시도한다. L16은 record를 버리므로, 그 재시도는 new 세션으로 가서 실행됐을지 모르는 입력을 사람 없이 다시 보낸다.
  - 오늘도 같은 동작이고 L16이 더 나쁘게 만들지 않는다. 다만 결정 8의 "자동 전송 0회"는 지금 재접속 경우만 막는다.
  - 권고: 표식을 쓴 뒤(입력이 이미 나간 뒤) 실패한 턴은 고정 문구로 끝낸다. 그러면 Pi가 재시도하지 않는다. 벤더의 원래 오류는 알림에 남긴다. 보내기 전의 실패는 지금처럼 재시도를 허용한다.
  - 비용: 벤더의 일시적 오류가 프롬프트를 보낸 뒤에 나면, 자동 재시도 대신 사람이 다시 입력해야 한다.

# 결정 (GLG)

2026-11-20 결정 1–5와 2026-11-21 결정 6(V5)은 표 문서의 Decisions 절에 있다. 2026-11-21에 더한 것:

7. **reuse delta.** 마지막 assistant 뒤의 user 메시지를 모두 보낸다. 첫 user skip은 버린다(유실보다 소음을 택함). `/compact`는 첫 블록으로 판정한다.
8. **L16 pendingDispatch** (B와 닷이 합의한 안, #171 issuecomment-7055533122).
   - `session/prompt` 직전에 record에 원자적으로 쓴다. 뜻은 "이 범위는 실행됐을 수 있다"이다. 프롬프트 원문은 넣지 않는다: 위치, 개수, 서명만.
   - 봉인할 때, record를 전진시키는 같은 쓰기에서 지운다.
   - 재접속 때 표식이 있으면 assistant가 보이더라도 정지한다. 기존 id와 새 id 모두 자동 전송은 0회다.
   - 표식 필드가 없는 구버전 record는 resume에 쓰지 않고 new로 간다.
   - 새 버전 record에 표식이 없을 때: 꼬리(record 이후)에서 user 메시지 뒤에 assistant가 오면 record가 뒤처진 것이므로 new로 간다. 그렇지 않으면 user들을 순서대로 보낸다. record의 prefix에는 봉인된 턴의 답이 들어가지 않으므로, 정상 연속은 늘 [A U…]이다(Opus #O20, R12에서 측정된 B의 판정식). 원래의 '꼬리에 assistant가 있으면 new'는 정상 연속까지 new로 보내므로 고쳤다.
   - **(a) 정지는 한 번이다.** 이유와 범위(위치와 개수)를 보이고 record를 버린다. 다음 턴은 new다.
   - **G2:** 이 규칙은 이름 붙은 정지 전부에 적용된다: 재시작 뒤 표식 발견, 살아 있는 프로세스의 prompt 실패, attach 성공 뒤 첫 prompt 실패, attach timeout이나 child 사망.
9. **표식 저장 실패 → 전송 0회.** 결정 3이 바뀐다: 저장소가 계속 실패하면 다음 턴은 이유를 보이며 거절된다. 같은 부류(전송 전 저장소 문제 → 거절): 읽을 수 없는 record(unreadable)도 거절하고, record 삭제(drop)에 실패하면 삭제될 때까지 전송 0회다(조율자, #O20). 봉인 뒤 지우기 실패는 결정 3대로 degraded 알림을 내고, 다음 재접속에서 한 번 정지한다.
10. **Claude에도 measured 가드.** resume과 load는 "보고된 버전 = 측정한 버전"일 때만 연다.
11. **G1:** Z5와 V4는 declined로 확정한다(R10).
12. **G3:** 재측정을 L8/L9 앞으로 옮기고, 명령 하나로 영수증과 자동 대조하게 만든다. 6단계에서 Claude 0.109.x와 agy 1.5.13을 함께 다룬다.
13. **G4:** P2는 마지막 LIVE에서 재서 닫는다. Z7은 declined로 둔다(복구 경로는 Pi resume).
14. **문서 분리.** docs에는 개념 비교용 짧은 표를 두고, 전체 문서는 `.agent-reports`에 둔다.

# 진행 방식

구현 → focused 게이트 → Sonnet 리뷰 → 수정 한 묶음 → 바뀐 mutant 그룹의 PARTIAL → 동결 FULL → 커밋. 푸시는 GLG가 요청할 때만 한다. mutant 대상 파일은 PARTIAL 전에 stage한다. FULL 전에는 build-bridge를 돌린다.

# 금지

- Entwurf가 transcript를 hydrate하거나 prompt를 재구성하지 않는다(Hard Rule 9).
- 실패를 조용한 full replay로 떨어뜨리지 않는다(Hard Rule 5).
- 운영자 HOME과 설정을 바꾸지 않는다. 운영 환경에 설치하지 않는다(#165). 자격증명을 열지 않는다.
- LIVE 측정은 `LIVE=1`로만 하고, 출력은 리포 밖에 둔다.
- BASELINE.md와 VERIFY.md를 늘리지 않는다.
