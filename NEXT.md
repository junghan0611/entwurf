# NEXT — #142 마무리: 개발 checkout 운영 설치 → GLG 실사용

# RAIL — 현재 좌표

- [x] **1. #142 일반 Pi ACP Claude main 착지.** 드라이버 0.106.0 · wire SDK 2.6.0 · effort 실설정/readback · ESC 경계. main `28f1dd8`(CI 43352701293 4/4), **미출하**(출하된 최신 0.52.0은 0.90.0 / 1.8.0).
- [x] **2. 착지 정합과 #142 종결.** Terra c180ab·b3fc7c 발견 → `28f1dd8` 수선, #142 close(종결 댓글 6842246704), 남은 검증 주제는 [#161](https://github.com/junghan0611/entwurf/issues/161).
- [ ] **3. 개발 checkout 운영 설치 준비.** ← CURRENT: 경로는 측정한 현재 owner가 정한다. `use-dev-checkout.sh --check`(read-only)가 old owner를 출력하고, Herdr plugin이 owner면 `--apply`만 쓰며 takeover는 금지(setup-clean-host §1.1). 2026-11-13 Oracle 측정: Herdr activation ledger 없음(old owner: none), user-scope owner는 pnpm 전역 0.52.0(`doctor-pi-package` owned-by-other live) → 그 owner에 대한 operator-explicit `takeover-user-scope` 뒤 `--apply`. 설치 직전에 다시 측정한다. 준비는 설치가 아니다.
- [ ] **4. 사람 종료 창 → 설치 → 재개.** 관련 owner 전원이 정상 종료한 뒤 GLG가 직접 실행한다. 설치 exit 0, 실제 loaded bytes, ownership은 각각 따로 확인한다. 에이전트의 자율 kill/retire/takeover 없음.
- [ ] **5. GLG baseline.** 일반 Pi ACP `entwurf/claude-opus-5-5`(`entwurf pi`, control 재사용 경로)를 GLG가 쓰고, 그 ACP Opus에게 VERIFY.md 전체를 읽혀 실작업한다. 겪은 것은 #161 입력.
- **PAUSED:** release·prepare·version edit·npm(GLG 2026-11-13: "릴리즈 섣불리 못함"), #160의 Oracle 실행(노트북 lane 검수), durable ACP 통합.

현재 좌표: 1·2 완료 → 3 진행 → 4 사람 창 → 5 GLG 사용

# NOW

- **다음 한 행동:** 설치 준비물(전후 hash·backup manifest·설치/rollback 명령)을 운영 코디 68bd94에게 넘긴다. 종료·실행 안내와 GLG DM은 코디 단독이다.
- **담당과 층(GLG 2026-11-13):** #160 검수는 노트북 lane이 맡고, Oracle의 이 lane은 #142 실사용 마무리를 맡는다. #161 안정화와 durable은 후속이다. 앞서 기록한 "#160 먼저"는 이 마무리를 건너뛰라는 뜻이 아니다(S1 소스 읽기 댓글 6842442152는 기록으로 남김, 실행 보류·모델/로그인 요청 철회 6842470159). pi-durable × ACP Claude는 일반 Pi ACP Claude 안정화 뒤 별도 판단(ROADMAP "보류 방향 — pi-durable × ACP Claude"); durable 구현 issue는 열지 않는다.
- **후속:** [#161](https://github.com/junghan0611/entwurf/issues/161) — 수용 한계와 검증 주제를 분리한 일반 Pi ACP Claude 안정화. #160 뒤에 구현하며(#161 본문), 착수는 GLG 판단.
- **역할:** ff08d4 = ACP 담당·단일 writer·실무 코디. b3fc7c = 독립 검수. c180ab(Terra) = 넓은 readonly blindspot 검토, 발견은 ff08d4로. 68bd94 = 운영 코디·GLG DM 단독.
- **Do not touch:** 출하된 tag/npm bytes, 운영 profile·overlay·hook, credential, 회사 Cortex 실호출, worktree, `--no-verify`.

# 원자료

- #142 thread(최종 판정·n=1 영수증 댓글), `docs/acp-backend-rail.md`, `VERIFY.md` ACP 행, ROADMAP Dep bump 원장 2026-11-13.
- 0.52.0 출하·Herdr snapshot의 영수증은 `CHANGELOG.md`(core 0.52.0과 `v2026.11.12-herdr.0.52.0` 항목), Herdr tag `v2026.11.12-herdr.0.52.0`(= `a002d16`), `docs/setup-clean-host.md`가 소유한다. host-local 원본은 `~/.local/state/entwurf-releases/`.
