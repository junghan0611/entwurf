# NEXT — #176 Pi 1.6.1 · Claude ACP 0.112.0 · resume picker

# RAIL — 현재 좌표

- [x] **1. picker UI.** 키(Ctrl-J/K, Alt-J/K), 이름 먼저 오는 행과 구획선, 색과 NO_COLOR, 좁은 폭에서 이름 유지, 64×8 최소 크기. 구현 `20261126T081804-885314`.
- [x] **2. Claude ACP 0.112.0.** claude-agent-acp 0.109.0 → 0.112.0, ACP SDK 2.12.0. allow rule을 `mcp__entwurf-bridge__*`로 바꾸고, 런타임이 건너뛰는 두 부류는 로드에서 거절.
- [x] **3. 버전업이 `/new`를 강제하지 않음(GLG 2026-11-26).** `resume.upgradesFrom` ["0.109.0"]과 옛 allow-rule 서명의 일방향 재해석. raw U26과 `pi-upgrade`로 측정.
- [x] **4. Pi SDK 1.6.1(pi와 pi-durable 한 세대).** GLG 정확 release-age 예외(10종 × 1.6.1, 2026-11-26). host 범위 `>=1.6.1 <1.7`.
- [x] **5. 형제 교차 리뷰.** Codex `20261126T090855-59b82c`(코드·핀; workflow SRI Blocker를 잡아 고침)와 885314(문서 D1–D7·O 반영).
- [x] **6. frozen floor.** HEAD `0d512d35`. 아래 영수증.
- [ ] **7. GLG 운영 컷오버.** ← NEXT: GLG가 직접 Pi·pi-durable을 정상 종료하고, durable 세션을 WAL·SHM까지 백업한 뒤 host `pi update`(1.6.1)를 하고 같은 세션들을 다시 연다. 에이전트는 아무것도 kill/retire하지 않는다. (미확인: host Pi가 pnpm 전역 설치라 pnpm 11 기본 minimumReleaseAge 1일이 걸리면, 1.6.1 공개 2026-11-25T13:41:09Z 뒤 하루가 지난 2026-11-26 22:41 KST부터 예외 없이 `pi update`가 될 수 있다 — 실행해 본 적 없음.)
- [ ] **8. push·병합·릴리스.** GLG 결정. push는 GLG가 이 세션에서 명시적으로 요청할 때만 한다. 릴리스는 `entwurf-release` 네 모드를 따르고, npm publish는 GLG가 한다.

# HANDOFF — 다음 세션이 여기서 시작

- **브랜치:** `feat/176-picker-pi161-acp0112`. main `cafd54f1` 위 커밋 17개(이 NEXT 포함), 미푸시.
- **운영 경계:** oracle의 checkout이 곧 운영 런타임이다.
  - checkout에는 1.6.1이 이미 설치돼 있다(`pnpm install`, 2026-11-26). 그래서 새로 띄우는 pi-durable과 checkout 확장은 1.6.1 SDK를 읽는다.
  - 이미 떠 있는 세션은 예전에 로드한 바이트로 돈다.
  - host `pi --version`은 1.6.0이다. 그래서 `setup`은 pi FAIL을 낸다. 1.6.0 host 아래에서 이미 등록된 확장이 어떻게 도는지는 미측정이다.
- **frozen floor 영수증(HEAD 0d512d35):** `~/.local/share/entwurf-lab/176/final/` 아래 `floor-0d512d35e9b9.log`, `partial-0d512d35e9b9-*.json|log`, 첫 FULL `full-0d512d35e9b9.log`(red), 다시 돈 FULL `floor2-…`·`full2-…`. `floor-…log`의 `rc=` 값은 스크립트가 `date`의 종료값을 적은 것이라 믿지 않는다. 판정은 각 로그 본문이다.
  - PARTIAL 6그룹, 모두 group-green·control ok(이 후보의 그룹만 잰 것이고 릴리스를 대신하지 않는다):
    - `check-dep-versions` 12/12, receipt `acdd1d91f162`
    - `check-pack-pin-matcher` 2/2, receipt `fcbcf145dc45`
    - `check-peer-presentation` 30/30, receipt `2165a0a6797f`
    - `check-acp-vendor-rejection` 9/9, receipt `8b065cf4884f`
    - `check-acp-set-model-readback` 263/263, receipt `c194994df888`
    - `check-entwurf-v2-visible-resume` 151/151, receipt `f7de720b1a6b`
  - FULL `pnpm run check:full` exit 0, 1185s, frozen ok (`floor2-0d512d35e9b9.log`, `full2-0d512d35e9b9.log`).
  - 첫 FULL은 `check-bridge-delivery`의 stale dist 단언 하나로 빨갰다. 12:41 빌드 뒤에 amend가 `resume-picker.ts` 주석만 바꿨기 때문이다. `pnpm run build-bridge` 전후 dist manifest를 비교하니 그 파일 하나의 주석 바이트만 달랐고, 다시 돈 FULL이 위의 green이다. 빌드 전 dist 사본과 두 manifest는 `dist-before-rebuild/`에 있다.
- **미측정(CHANGELOG에 기록):**
  - 1.6.0이 쓴 durable 세션을 1.6.1로 다시 여는 경우, 그 반대
  - 운영 세션
  - Windows·WSL2 workflow 실행
  - 업그레이드를 넘는 미응답 prompt
  - 0.112.0에서 재개된 Fable 세션이 답한 행(#174)
  - 비-bridge MCP 도구 권한
  - picker: bare terminal의 CR, herdr 안의 paste·NO_COLOR·좁은 폭, light theme
- **GLG 결정 대기:**
  1. 운영 컷오버 시점(7)
  2. push(8)
  3. 릴리스 버전과 시점(8)
- **살아 있는 형제(은퇴는 GLG 요청이 있을 때만):**
  - picker 구현 885314
  - Codex 리뷰 59b82c
  - 운영코디 `20261014T212756-68bd94`
- **기존 결함(이번 범위 밖):** ROADMAP 원장에 #171 0.109.0 bump 항목이 없다. 0.61.0 CHANGELOG에는 있다.
