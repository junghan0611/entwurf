# NEXT — #142 마무리: 출하 판단 대기

# RAIL — 현재 좌표

- [x] **1. #142 일반 Pi ACP Claude main 착지.** 드라이버 0.106.0 · wire SDK 2.6.0 · effort 실설정/readback · ESC 경계. main `28f1dd8`(CI 43352701293 4/4), **미출하**(출하된 최신 0.52.0은 0.90.0 / 1.8.0).
- [x] **2. 착지 정합과 #142 종결.** Terra c180ab·b3fc7c 발견 → `28f1dd8` 수선, #142 close(종결 댓글 6842246704), 남은 검증 주제는 [#161](https://github.com/junghan0611/entwurf/issues/161).
- [ ] **3. #142 출하(release / npm / 운영 설치).** ← CURRENT, GLG 판단 대기: 각각 별도 승인. 승인 전 착수 없음. Cortex 실 rail은 SDK major 이동의 release 전 위험 판단(#161 6).
- [ ] **4. #161 실사용 안정화.** 첫 측정이 설치된 패키지를 요구하므로 3 뒤. 구현은 #160(노트북 lane 검수) 뒤 — #161 본문.

현재 좌표: 1·2 완료 → 3 GLG 판단 대기 → 4 그 뒤

# NOW

- **다음 한 행동:** release의 mode·version 결정은 GLG 몫. 운영 코디가 GLG에게 한 번에 묻는다. 명시 승인이 오면 `entwurf-release`에서 승인된 mode 범위만 진행한다(prepare가 make·publish·install을 포함하지 않음). 그 전에는 임의 release·새 기능·실험·#160 조사 재개 없음.
- **담당과 층(GLG 2026-11-13):** #160 검수는 노트북 lane이 맡고, Oracle의 이 lane은 #142의 출하 마무리를 맡는다. #161 안정화와 durable은 후속이다. 앞서 기록한 "#160 먼저"는 #142 출하를 건너뛰라는 뜻이 아니다(S1 소스 읽기 댓글 6842442152는 기록으로 남김, 실행 보류·모델/로그인 요청 철회 6842470159). pi-durable × ACP Claude는 일반 Pi ACP Claude 안정화 뒤 별도 판단(ROADMAP "보류 방향 — pi-durable × ACP Claude"); durable 구현 issue는 열지 않는다.
- **후속:** [#161](https://github.com/junghan0611/entwurf/issues/161) — 수용 한계와 검증 주제를 분리한 일반 Pi ACP Claude 안정화. #160 뒤에 구현하며(#161 본문), 착수는 GLG 판단.
- **역할:** ff08d4 = ACP 담당·단일 writer·실무 코디. b3fc7c = 독립 검수. c180ab(Terra) = 넓은 readonly blindspot 검토, 발견은 ff08d4로. 68bd94 = 운영 코디·GLG DM 단독.
- **Do not touch:** 출하된 tag/npm bytes, 운영 profile·overlay·hook, credential, 회사 Cortex 실호출, worktree, `--no-verify`.

# 원자료

- #142 thread(최종 판정·n=1 영수증 댓글), `docs/acp-backend-rail.md`, `VERIFY.md` ACP 행, ROADMAP Dep bump 원장 2026-11-13.
- 0.52.0 출하·Herdr snapshot의 영수증은 `CHANGELOG.md`(core 0.52.0과 `v2026.11.12-herdr.0.52.0` 항목), Herdr tag `v2026.11.12-herdr.0.52.0`(= `a002d16`), `docs/setup-clean-host.md`가 소유한다. host-local 원본은 `~/.local/state/entwurf-releases/`.
