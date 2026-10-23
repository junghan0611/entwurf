# NEXT — 0.41.2 버그픽스 릴리즈 (make)

core 0.41.2를 v0.41.1 이후 main 변경으로 자른다. 범위는 #149 remote pair 복수 route(하드 컷), pack argv 판정의 SIGPIPE 수선, 개발자 설치 배타성, #108 placement MCP wire 검증이다. npm 재pin과 Herdr manifest bump는 없고, Herdr lock은 기존 `herdr-checkout` 검증 carrier로 전환한다. 원장은 `.tmp-verify/release-0.41.2/`(ignored)와 각 이슈 thread다.

# RAIL — 현재 좌표

- [x] **0. 이전 cut 닫힘.** core `v0.41.1` = `6a88436`(GitHub Latest, npm `latest` 0.41.1). Herdr snapshot `v2026.10.23-herdr.0.41.1` = `439b399`, GitHub release 생성됨(Latest 아님). 0.41.1 기록은 CHANGELOG와 [#148](https://github.com/junghan0611/entwurf/issues/148#issuecomment-6353660427)가 SSOT다.
- [x] **1. 범위 landing.** `156bb62`(#149), `e7ed057`(pack argv), `3e2673b`(개발자 설치), `1d24a01`(#108). 각 SHA의 push CI 4 job green, #108은 실 MCP LIVE 1회 green 후 닫힘.
- [x] **2. prepare** (`chore/prepare-0.41.2`): CHANGELOG 0.41.2 절, `package.json` 0.41.2, frozen offline sync, Herdr lock을 `herdr-checkout` 검증 carrier로 전환, README orchestration 정리.
  - 내용과 working tree 검증은 닫혔다. prepare 6파일 commit은 아직이며, make 진입의 첫 단계다.
  - Herdr acquire fixture 수선은 별도 commit `f0de5b7`이다.
  - prepare 검증은 working tree `80c40705`에서 닫혔다: P4 build 6s·`check:full` 905s exit 0, P5 `--cut` MUST 24/0/0·BEHAVIOR 1/0/0. receipt는 CHANGELOG "Release evidence"와 `.tmp-verify/release-0.41.2/`(`NIGHT-HANDOFF.md`)에 있다.
- [ ] **3. make.** ← CURRENT: 남은 prepare 6파일 commit → main fast-forward → M0 `check:full` 1회 → prepared HEAD push → exact-SHA CI 4 job → 그 SHA의 `windows-native-preview` dispatch(M3w)에서 회수한 exact tarball 1개를 후보로 수용(로컬 pack 금지) → container 수용 → tag 전에 그 후보 설치 후 native 수용(§3.4·§3.7) → tag `v0.41.2` + GitHub release. GLG가 2026-10-24에 commit·push·make를 승인했고, 각 단계는 코디가 따로 GO한다.
- [ ] **4. publish.** ← PAUSED: npm publish는 아직 승인되지 않았다. 수용한 후보를 명시한 dist-tag로 출판하고 registry 설치를 증명한다(U3는 별도 축).

# NOW

- **kill-power:** 이 SHA에서 다시 측정하지 않는다(#144). 이번 범위의 earlier-candidate PARTIAL 6개는 CHANGELOG 0.41.2 "Release evidence"에 receipt별로 적었고, 합산하지 않는다.
- **측정하지 않음:** #149 T3(실 두 호스트 교환, opt-in, release MUST 아님), 서로 다른 release의 sender/receiver.
- **native 설치 후 증거:** Claude(§3.4)와 agy(§3.7)의 설치 후 수용은 이 prepare의 source 검증이나 지금의 0.41.1 doctor로 닫지 않는다. make에서 exact 후보를 설치한 뒤 측정하며, 그 전에는 tag·배포하지 않는다. 그 시점의 새 conversation id와 설치 환경은 운영자와 확정한다.
- **receipt 경계:** prepare receipt는 측정한 working tree와 source hash로 불린다. commit해도 exact-SHA 증거가 되지 않는다. exact prepared-SHA CI, M3w, container는 make에서 따로 닫는다.
- **공간:** P9 census 기준 `/` 97%(3.3G 여유), `/home` 94%(6.4G 여유)이고, 큰 fixture 잔류가 있다(`NIGHT-HANDOFF.md`). 증거와 캐시는 보존하고 자동 정리는 하지 않는다. make 전에 공간을 다시 확인한다.

# GUARDRAILS

- 모든 pnpm/commit/push hook에 `pnpm_config_verify_deps_before_run=error`. deps 오류면 install/repair/우회 없이 중단. unsafe override/force push 금지.
- 후보를 freeze한 뒤 worktree나 index가 움직이면 그 receipt는 무효다. records/native transcript/DB/색인, 후보와 사본, 증거는 지우지 않는다.
- `.agent-reports/.envrc` 보존(루트 `.envrc`는 재생성하지 않는다). 넓은 /tmp 청소/프로세스 sweeper/자동 whole-floor rerun 금지.
