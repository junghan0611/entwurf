# NEXT--acp-session-load-171 — #171 ACP 코어 레일

**현재 (2026-11-21):** 브랜치 `acp-session-load-171` @ `44e0e5fd`(푸시됨). 목표는 ACP 전체 스펙이 아니라 Pi가 쓰는 코어 능력(initialize, new, prompt, cancel, reuse, resume, load, close, record)을 잘 검증된 구현으로 닫는 것이다. plan 모드나 todo 같은 하네스 모드 기능은 의도적으로 거절한다("안되는게 더 pi 스타일", GLG). **이 레일 안에서 #171을 닫고, ACP용 다음 이슈는 만들지 않는다**(GLG 2026-11-21). 기준은 [`docs/acp-client-baseline.md`](docs/acp-client-baseline.md)의 표다. 표와 #171 댓글이 다르면 표를 고친다.

역할:
- 조율과 게이트: `20261113T043350-ff08d4`
- 구현: Opus `20261120T213316-793499`
- 리뷰와 표: Sonnet `20261120T204416-ad4dae`
- Terra `20261120T204430-b0194d`는 Pi 수선 중이라 대기한다.
- 외부 자문 B는 GLG를 거쳐 받는다.

# RAIL

- [x] **0. 측정.** RAIL 0(Claude와 agy의 resume·load), 모르는 id, Z5, U11/U12를 쟀다. 영수증은 `~/.local/share/entwurf-lab/171/`에 있고, 결정적인 줄은 표의 Receipts 절에 옮겼다.
- [x] **1. 표와 오라클.** `e330d472`, `b87340a1`: 표 44행, ROW-COVERAGE, receipt 버전 묶기.
- [x] **2. L15 저장소 수선과 V5 결정.** `5fa8c225`.
- [x] **3. L5 reuse delta 유실 수정.** `44e0e5fd`.
- [ ] **4. 표 정정, 그다음 L1/V5.** ← CURRENT
  - 4a 문서 커밋을 먼저 한다(GLG가 읽고 전체 얼개를 그린다).
    - L16 행을 아래 결정 8–9의 계약으로 다시 쓴다.
    - U11/U12를 측정한 칸과 아직 안 잰 칸으로 나눈다.
    - max_tokens 중복은 U 행으로 남긴다.
    - 결정 7–10을 적는다.
    - V5의 "Claude는 그대로"를 결정 10으로 고친다.
  - 4b 코드.
    - 실제로 띄운 child의 `initialize`에서 버전과 capability를 저장한다.
    - `measured` 상수를 Claude(0.107.3)와 agy(1.5.12) 양쪽에 두고, 영수증과 같은지 게이트로 묶는다.
    - "보고된 버전 = measured"일 때만 attach를 허용하는 판정을 QK와 mutant로 고정한다.
    - attach 배선은 하지 않는다. 기본 경로(new, prompt, cancel)는 바뀌지 않는다.
    - 지금 설치된 agy는 1.5.13이다. 4b가 들어가면 agy attach는 이유를 보이고 new로 간다. 이것은 가드가 정상 동작한 결과다.
- [ ] **5. L16 pendingDispatch.**
  - 표식을 쓰고 지우는 일, 그리고 재접속 때의 판정을 구현한다.
  - fake agent 시나리오는 넷이다: 안 보낸 입력 여럿은 순서대로 보낸다 / 표식이 있으면 두 id 모두 전송 0회 / 표식 저장에 실패하면 전송 0회 / 정지 한 번 뒤 new.
  - 아무도 record를 읽지 않으므로 L8보다 먼저 들어가도 된다.
- [ ] **6. L8/L9 (GLG 리뷰).**
  - resume과 load를 배선한다.
  - "record not used" 핀(`scripts/check-acp-session-reuse.ts:320-351`)을 뒤집는다.
  - V5 가드 아래에서 결정 1의 실패 계약을 적용한다.
  - L7 close도 함께 다룬다.
- [ ] **7. 벤더 재측정.**
  - claude-agent-acp를 0.109.x로 올린다: `package.json` 핀, lockfile, 재측정.
  - agy를 1.5.13으로 재측정한다.
  - 둘 다 `scripts/raw-acp-session-measure/`로 재고, `measured` 상수와 영수증을 함께 갱신한다.
- [ ] **8. 마감.**
  - 표의 모든 행이 종착 상태여야 한다: implemented, declined, 또는 이유가 붙은 unmeasured.
  - PARTIAL을 돌리고, 동결 FULL을 돌린다.
  - #171을 닫는다. main에 병합하기 전에 이 파일을 지운다.
  - 0.61.0에서 Entwurf ACP의 방향을 이야기한다.
- 이 레일 밖, 그다음: 0.62.0에서 Pi SDK 1.6.0에 맞춘다.

# 결정 (GLG)

2026-11-20 결정 1–5와 2026-11-21 결정 6(V5)은 표 문서의 Decisions 절에 있다. 2026-11-21에 더한 것:

7. **reuse delta.** 마지막 assistant 뒤의 user 메시지를 모두 보낸다. 첫 user skip은 버린다(유실보다 소음을 택함). `/compact`는 첫 블록으로 판정한다.
8. **L16 pendingDispatch** (B와 닷이 합의한 안).
   - `session/prompt` 직전에 record에 원자적으로 쓴다. 뜻은 "이 범위는 실행됐을 수 있다"이다.
   - 봉인할 때, record를 전진시키는 같은 쓰기에서 지운다.
   - 재접속 때 표식이 있으면 assistant가 보이더라도 정지한다. 기존 id와 새 id 모두 자동 전송은 0회다.
   - 표식 필드가 없는 구버전 record는 resume에 쓰지 않고 new로 간다.
   - 새 버전 record에 표식이 없을 때: 꼬리에 assistant가 없으면 순서대로 보내고, 있으면 new로 간다.
   - **(a) 정지는 한 번이다.** 이유를 보이고, 표식이 담은 범위를 알림에 적은 뒤 그 record를 버린다. 다음 턴은 new다. 오늘 같은 프로세스 안에서 child가 죽었을 때와 같은 동작이다(U12 영수증).
9. **표식 저장 실패 → 전송 0회.** 결정 3이 바뀐다: 저장소가 계속 실패하면 다음 턴은 이유를 보이며 거절된다.
10. **Claude에도 measured 가드.** resume과 load는 "보고된 버전 = 측정한 버전"일 때만 연다. `CLAUDE_AGENT_ACP_COMMAND` override는 하한만 검사하기 때문이다. 번들로 설치하면 동작은 바뀌지 않는다.

L16 계약은 B가 자기 이름으로 #171에 올린다.

# 진행 방식

구현 → focused 게이트 → Sonnet 리뷰 → 수정 한 묶음 → 바뀐 mutant 그룹의 PARTIAL → 동결 FULL → 커밋. 푸시는 GLG가 요청할 때만 한다. mutant 대상 파일은 PARTIAL 전에 stage한다. FULL 전에는 build-bridge를 돌린다.

# 금지

- Entwurf가 transcript를 hydrate하거나 prompt를 재구성하지 않는다(Hard Rule 9).
- 실패를 조용한 full replay로 떨어뜨리지 않는다(Hard Rule 5).
- 운영자 HOME과 설정을 바꾸지 않는다. 운영 환경에 설치하지 않는다(#165). 자격증명을 열지 않는다.
- LIVE 측정은 `LIVE=1`로만 하고, 출력은 리포 밖에 둔다.
- BASELINE.md와 VERIFY.md를 늘리지 않는다.
