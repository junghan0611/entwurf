# NEXT — #153 1단계 landing → #157 비대칭 해결

# RAIL — 현재 좌표

- [x] **1. #153 입구/help/소유권 기반.** 여섯 reviewed commits, 마지막 `674887d`; 해당 SHA의 frozen FULL943초·PARTIAL39/1327·push CI41236684330 네 jobs success.
- [ ] **2. 완료 bundle main landing·#153 종료.** ← CURRENT: GLG 직접 승인. 이 handoff/branch NEXT 제거 후보의 검증 → 정상 commit/main FF push → exact-SHA CI → #153에 #157 승계 링크를 남겨 종료.
- [ ] **3. #157에서 비대칭 해결.** main 기준 새 branch. Pi / Claude Code / pi-durable × tmux / Herdr의 사용행동 gap을 정하고 첫 leaf부터 닫는다.
- [ ] **4. 릴리즈.** ← PAUSED: #157까지 원목적을 완료한 뒤 GLG의 별도 release 승인. 버전/tag/npm/plugin 변경 없음.

# NOW

- **직접 승인:** GLG가 이 세션에서 “main에 올리고, 153을 닫고, 새 이슈에 후속을 만들고, 거기서 비대칭을 해결하자”라고 요청했다. 이어 직접 붙인 원문은 “pi claudecode pi-durable에 대해서는 tmux herdr의 비대칭성을 해결하면서, entwurf를 통합 커맨드로 세우는게153과후속의목표야”, “릴리즈는 새 이슈까지 끝나면 할거야”다. 이전 landing 유보와 pi-durable 검토-only 범위는 이 최신 직접 지시로 대체됐다.
- **Next:** [#157](https://github.com/junghan0611/entwurf/issues/157)에 원목적·완료 bundle·남은 요구·유한한 종료조건을 승계했다. 현재는 2단계의 정상 landing을 닫는다. 실제 후속 링크 없이 #153을 닫거나 help 승인만으로 전체 목적 완료라고 하지 않는다.
- **첫 후속 행동:** main에서 `feat/157-rail-symmetry`를 열고, 기존 source/receipts로 여섯 조합의 실행 입구·fresh/callback·self/peers/send/receive·same-id 복귀 gap을 짧게 대조한다. 해결 순서와 첫 leaf를 정한 뒤 구현/검증한다. 대조표는 설계자료이지 새 전수 실행 matrix나 모든 verb의 일괄 추가 GO가 아니다.
- **구분:** install route(dev/npm/plugin-only)와 placement(tmux/Herdr)는 별도 축이다. Herdr 창에서 checkout help를 읽은 관측은 plugin-only operator link의 운영 증거가 아니다. 기존 team/remote/skills 안내를 찾는 요구와 새 loader/manager/skill 엔진 구현을 구별한다. #132C의 원석과 CLOSED/not_planned 이력은 #157에 출처로 보존했고 중복 reopen하지 않는다.
- **검증 경계:** 674887d의 FULL/PARTIAL/CI는 그 후보의 증거다. 이번 handoff 후보와 후속 제품 SHA의 acceptance로 승격하지 않는다. 실행 결과/최종 main SHA/새 CI는 수행 뒤 issue thread에 기록한다. whole qualification은 재실행하지 않으며 기존 39/1327 PARTIAL의 다른1288은 미측정이다.
- **Do not touch:** SDK 업그레이드(#155), shell UX(#156), 운영 설치/repin/PATH/profile/auth, 시민 교체·retirement, 버전/tag/release는 이번 landing에 포함하지 않는다. 첫 예상 밖 RED/오류는 원자료·실제 exit를 남겨 STOP, named GO 전 수선/재시도 없음. normal hooks/shared scanner, `pnpm_config_verify_deps_before_run=error`; 모든 설치 scripts-off. 검증 중 source/index/NEXT/dist freeze. 이 checkout만 사용하고 worktree/개발 clone/넓은 cleanup은 금지한다.

# 읽을 곳

- [#157 — 후속 범위와 종료조건](https://github.com/junghan0611/entwurf/issues/157): 원목적의 현재 승계 좌표. #153을 닫아도 비대칭 해결은 여기서 계속한다.
- [#153 push/CI receipt](https://github.com/junghan0611/entwurf/issues/153#issuecomment-6548568758), [674 local receipt](https://github.com/junghan0611/entwurf/issues/153#issuecomment-6548203004): host-local 로그 없이도 핵심 측정과 한계를 읽을 수 있다.
- `ENTWURF-CLI.json`, `scripts/cli-help.mjs`, `README.md`, `docs/{mux,herdr}-launch-rail.md`, `DELIVERY.md`, `VERIFY.md`: 제품/rail/검증의 소유 계약.

# RECENT / 보존

- #153 완료 범위는 `c0c432f`, `ce92dc7`, `11f922d`, `c90ff8b`, `46fcbfd`, `674887d`다. default root는 의도된 UI 변경이며 command page/문서화 catalog는 유지됐다. 소스·package consumer green은 전체 rail 대칭 또는 운영 rollout을 의미하지 않는다.
- 원자료 `/tmp/e153h/root-help-r1/`는 Oracle-local이다. landing 전 branch NEXT 사본과 이전 root NEXT는 `/tmp/e153h/landing-r1/`에 보존한다. 제품·증거·목적은 위 공유 issue에 승계한다. 기존 frozen674 기록과 과거 RED/중단 경위는 사본/기존 git 이력에 남기며 새 green으로 지우지 않는다.
- 이전 root NEXT의 0.45.0 Herdr snapshot 순서는 `git show 674887d:NEXT.md`에 보존된 역사적 handoff다. 이번 #153→#157 승인으로 그 릴리즈/운영 전환 작업을 재개하지 않는다.
