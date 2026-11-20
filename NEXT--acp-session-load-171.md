# NEXT--acp-session-load-171 — #171 ACP persisted `session/load` (1b-2c)

**현재 (2026-11-20):** `main` `54f17888`(버전 언급 정리·스캐너, 미푸시)에서 갈라졌다. 목표는 Pi resume 뒤 ACP backend가 새 child로 transcript 전체를 replay받는 대신 자기 세션을 `session/load`로 잇게 하는 것이다. 계약·범위는 [#171](https://github.com/junghan0611/entwurf/issues/171) 스레드가 SSOT다. 역할: main writer·조율 `20261113T043350-ff08d4`, 페어 Opus(이 브랜치에서 새로 연다), 운영코디 `20261014T212756-68bd94`.

# RAIL — 현재 좌표

- [ ] **0. 측정 먼저 (코드 없음).** ← CURRENT: 격리 HOME에서 Claude ACP 행으로 두 턴 → backend session id 기록 → child 종료 → 손으로 `session/load` 호출 → adapter가 무엇을 replay하는지, 다음 prompt가 앞 턴을 보는지 기록. agy는 initialize의 `loadSession` capability만 읽는다. 영수증은 리포 밖 `~/.local/share/entwurf-lab/171/`, 결정적 줄은 #171 댓글로 옮긴다.
- [ ] **1. 결정 (GLG).** #171 범위 2–4: session id를 어디에 보존하나(record vs Pi 세션 메타), load replay 이벤트 처리(compaction 이중 기록 금지, `docs/acp-backend-rail.md:1142`), load 실패 계약(이름 있는 결과, 조용한 full-replay fallback 금지; visible `new` 허용 여부).
- [ ] **2. Claude ACP 구현.** `pi-extensions/lib/acp/backend.ts:1266-1270`, `:1991-1994`(1b-2b OFF 지점). 테스트는 동작 옆, QK·exact-once mutant.
- [ ] **3. agy.** capability 측정 결과에 따라 같은 경로 또는 명시 거부.
- [ ] **4. 리뷰 → PARTIAL → 동결 FULL → 체크포인트 커밋.** main 병합 전 이 파일 삭제.

# 읽을 곳

- #171 본문(측정 n=1: agy hydrogen 83,121 → 38,861, `afc87762`).
- `docs/acp-backend-rail.md:321-324`(우리는 `session/load`를 부르지 않는다), `:487`(Claude ACP `loadSession: true`), `:516`(#1430 load replay).
- ROADMAP.md:222(1b-2c 이월).

# 금지

- Entwurf가 transcript를 hydrate하거나 prompt를 재구성하지 않는다(Hard Rule 9). Pi가 transcript 주인이고, 이 일은 backend가 자기 세션을 잇게 할 뿐이다.
- load 실패를 full replay로 조용히 떨어뜨리지 않는다(Hard Rule 5).
- 운영자 HOME·설정 변경, 운영 환경 설치(#165), 자격증명 열람 금지.
