# NEXT — #142 착지 뒤: 종결 → #160

# RAIL — 현재 좌표

- [x] **1. #142 일반 Pi ACP Claude main 착지.** 드라이버 0.106.0 · wire SDK 2.6.0 · effort 실설정/readback · ESC 경계. main `e102cf6`, **미출하**(출하된 최신 0.52.0은 0.90.0 / 1.8.0).
- [ ] **2. 착지 정합과 #142 종결.** ← CURRENT: Terra c180ab의 넓은 readonly 검토 → 최소 docs amendment(이 브랜치) → main 반영 + exact-SHA CI → #142 본문 정합 후 close.
- [ ] **3. #160 브리핑.** OpenClaw TUI + Gateway vs ACP. 최신 본문/thread/owner docs를 원문으로 읽고 가장 작은 test-owned 왕복 계획과 안전 경계를 코디에게 낸다. 구현 착수 아님.
- [ ] **4. release / npm / 운영 설치.** ← PAUSED: 각각 GLG 별도 승인. Cortex 실 rail은 SDK major 이동의 release 전 위험 판단.

현재 좌표: 1 완료 → 2 진행 → 3 다음 → 4 보류

# NOW

- **다음 한 행동:** Terra 1차 검토가 끝나면 남은 발견을 이 브랜치 한 묶음으로 고치고, 독립 delta 읽기(b3fc7c) 뒤 main에 반영한다. 새 SHA의 CI는 그 SHA로만 보고한다.
- **순서(GLG 2026-11-13):** #142 종결 → #161 후속 공개 → #160 먼저. pi-durable × ACP Claude는 일반 Pi ACP Claude 안정화 뒤 별도 판단(ROADMAP "보류 방향 — pi-durable × ACP Claude"); durable 구현 issue는 열지 않는다.
- **후속:** [#161](https://github.com/junghan0611/entwurf/issues/161) — 수용 한계와 검증 주제를 분리한 일반 Pi ACP Claude 안정화. #160보다 먼저 구현하지 않는다.
- **역할:** ff08d4 = ACP 담당·단일 writer·실무 코디. b3fc7c = 독립 검수. c180ab(Terra) = 넓은 readonly blindspot 검토, 발견은 ff08d4로. 68bd94 = 운영 코디·GLG DM 단독.
- **Do not touch:** 출하된 tag/npm bytes, 운영 profile·overlay·hook, credential, 회사 Cortex 실호출, worktree, `--no-verify`.

# 원자료

- #142 thread(최종 판정·n=1 영수증 댓글), `docs/acp-backend-rail.md`, `VERIFY.md` ACP 행, ROADMAP Dep bump 원장 2026-11-13.
- 0.52.0 출하·Herdr snapshot의 영수증은 `CHANGELOG.md`(core 0.52.0과 `v2026.11.12-herdr.0.52.0` 항목), Herdr tag `v2026.11.12-herdr.0.52.0`(= `a002d16`), `docs/setup-clean-host.md`가 소유한다. host-local 원본은 `~/.local/state/entwurf-releases/`.
