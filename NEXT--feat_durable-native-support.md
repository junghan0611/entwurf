# NEXT — Original에서 durable 0.31.0 닫기

# RAIL — 현재 좌표

- [x] **1. Core 원본 승격** — 49-path candidate 승격; 제품 미커밋.
- [x] **2. 설치·pack 최소 보수** — root-only workspace/실패 stderr, 설치본 bootstrap import GREEN.
- [ ] **3. 후보 닫기·커밋** ← CURRENT: qualification RED 구획 보수·Fable B 검수 완료 → 새 staging/동결 → 문제35개(기존3개 exact-argv group) 검증·훅 → 커밋 판단 통보. 전체871 재실행 지시 없음.
- [ ] **4. 0.31.0 수용·컷** — native caller/target/cross LIVE와 기존 exact-SHA CI/릴리즈 기준. push/publish는 별도 승인.

# NOW

- **자리/팀:** `/home/junghan/repos/gh/entwurf`, branch `feat/durable-native-support`; HEAD `eeb01c49522fab7f25755d36e632fbf9732fe87a`. 일반 Pi a30dda가 조율, Opus `20261006T173424-b9ffcb`가 구현·검증, Fable `20261006T180657-282bd0`가 읽기 전용 검수. 종료된 a269da의 임시 grants/라우팅은 현재 지시가 아니다.
- **다음 한 수:** 이전 동결 ab82a86e는 qualification 857/870 RED로 퇴역(원문/guard receipt 보존); FULL와 hook은 미실행. 9 Codex control RED는 긴TMPDIR, PIIMPORT baseline RED는 source-resolver 예외 누락, native3은 build/wrong-QK 변이 오류로 재현했다. Opus가5path 보수를 닫았고 patch938f04b9…406a313/현재5sha12는 조율자 확인 MATCH. Fable 새B예외 읽기전용 검수는 Blocker0/Defect0; 기존compat masking·소비자 주석 drift는 별도관찰로 남겼다. 조율자가 정확히6경로(실무5+NEXT)를 re-stage·새freeze하고 Opus가 짧은TMPDIR의 기존3group을 검증한다. 동시 build/pack 없음.
- **직접 지시:** 12:05Z “처음부터 다시 다 테스트하지말고 해당 문제 구획을 해결해서 가자.” 이전 전체BODY/FULL 재실행 계획은 철회했다. 기존 --group/PARTIAL receipt로 affected35개만(Codex9/import2/durable24), 전체871 green으로 합산하지 않는다. 이전 green/새구획/미실행FULL·release acceptance는 분리한다. 진행DM428/RED와복구방향DM429 전달 완료. 준비되면 커밋 판단을 요청하는DM 한 통; actual commit/push/tag/npm는 별도경계. 명령별 승인/새 grant 문서는 필요 없다.
- **기준:** Pi1.0.2/source `cd32f77`, package0.30.1/목표0.31.0. 범위를 넓히거나 새 검증틀/installer/manager를 만들지 않는다. 이후 Pi/ACP/UI 주제는 #130.

# PROOF / OPEN

- **조율자 실측:** Opus 최종 amendment patch SHA256 `a0262fce…7c2b6e`와 보고된 현재10파일 sha12 모두 MATCH. 승격49 manifest는 역사적 base이지 이후 수정된 frozen candidate가 아니다. 조율자의 CHANGELOG 상태 정정/VERIFY evidence-class 문단/NEXT 및 setup recipe의 상대 XDG fallback 정정은 이 보고 이후 의도적 변경이다.
- **읽은 원본 receipt:** `.tmp-verify/b9ffcb-pack-cause/close/sdk3-summary.txt`는 SDK3 세 gate rc0. receive raw log는21/0, root notice/SQLite row/owned cleanup/wire의 독립 oracle를 기록한다. Opus 보고 contact95/0·send19/0, dist80/tree8771f0e0. S + H이며 vendor V/전체 큐·crash 인증은 아니다.
- **검수 수정:** Fable Blocker0/Defect2. D1 최신 diagnostic은 root submissions와 분리된 마지막1개만 보관; committed splice→push mutant가 intended LATEST-ONLY와 collateral RING-COALESCES를 죽였다(raw mutant log 확인). 원본 byte-exact 복원·재build는 Opus 보고. D2 usage에 installed-bootstrap import cell 추가. 별도 소비자 QK/gate를 늘리지 않았다.
- **공급/설치:** 고정 operator runtime 공급과 pin 검증은 Opus 보고. 첫 copy의 `.manifest.json` 누락으로 실제 RED 후 dotfile을 포함해 수정; 새 tmp 개발 clone이나 기존 live fixture를 설치 증거로 사용하지 않았다. upstream 앱은 ordinary Pi npm에 없고 durable npm은 library라는 판독/수동 공급 recipe는 `docs/setup-clean-host.md` §2b에 있다. 이 계약은 향후 UX의 이상형 선언이 아니다.
- **남은 것:** 새후보의 affected-group receipt/안전검사·normal local hooks. FULL 미실행과 이전qualification RED를 감추지 않고 이번 문제구획 수용으로 커밋을 판단한다. native vendor/caller/target/cross LIVE, 최종0.31.0 package/version/exact-SHA 전체acceptance는 별도release경계이며 이 부분증거로 면제하거나 완수로 표시하지 않는다.

# BOUNDARIES / READ

- 개발은 이 checkout의 브랜치에서만. 격리 test fixture/qualification snapshot/보존 증거는 개발 checkout이 아니다(`AGENTS.md`). ignored `.tmp-verify/b9ffcb-pack-cause/`는 현재 실측; 옛 tmp receipts/RED는 역사이며 실행권한이 아니다.
- local `core.hooksPath=.husky/_`는 global scan을 연결하지 않는다(조율자 판독). 설정을 바꾸지 않고 기존 global `_scan.sh staged`를 명시 실행하며 normal local hooks도 통과시킨다. unsafe override/no-verify 금지.
- auth/settings/records/transcripts/SQLite/Emacs/foreign processes 보존. 임의 signal/stale-lock 삭제/전체 형제 shutdown 없음. Native runtime/TUI/queue/recovery/models/auth는 upstream 소유.
- 읽을 곳: `AGENTS.md`, `VERIFY.md`, `DELIVERY.md`, `docs/adding-a-harness.md`, `docs/durable-native-support.md`, `.claude/skills/entwurf-release/SKILL.md`, #129 live thread. 현재 checkpoint는 `.tmp-verify/b9ffcb-pack-cause/checkpoint.md`.
- 이전 NEXT/방향 문서 원본은 ignored `.agent-reports/original-closure-20261006/`에 보존돼 있다. 새 계획/복제 후보를 만들지 않는다.
