# NEXT — 0.41.2 버그픽스 릴리즈 (make)

core 0.41.2를 v0.41.1 이후 main 변경으로 자른다. 범위는 #149 remote pair 복수 route(하드 컷), pack argv 판정의 SIGPIPE 수선, 개발자 설치 배타성, #108 placement MCP wire 검증이다. 여기에 make 도중 열린 [#152](https://github.com/junghan0611/entwurf/issues/152) agy native-push pause가 더해진다. npm 재pin과 Herdr manifest bump는 없고, Herdr lock은 기존 `herdr-checkout` 검증 carrier로 전환한다. 원장은 `.tmp-verify/release-0.41.2/`(ignored, 조율 포인터 `COORDINATION.md`)와 각 이슈 thread다.

# RAIL — 현재 좌표

- [x] **0. 이전 cut 닫힘.** core `v0.41.1` = `6a88436`(GitHub Latest, npm `latest` 0.41.1). Herdr snapshot `v2026.10.23-herdr.0.41.1` = `439b399`. 0.41.1 기록은 CHANGELOG와 [#148](https://github.com/junghan0611/entwurf/issues/148#issuecomment-6353660427)가 SSOT다.
- [x] **1. 범위 landing + prepare.** `156bb62`(#149), `e7ed057`(pack argv), `3e2673b`(개발자 설치), `1d24a01`(#108), Herdr fixture 수선 `f0de5b7`, prepare `1e66466`(main fast-forward, push CI 4 job green).
- [x] **2. #152 pause 소스·증명.** agy native-push를 코드로 멈추는 묶음은 `100f618`로 커밋되어 main에 fast-forward됐고, `4f14a4d`와 함께 push됐다. 설계·코드 리뷰와 단일 amendment가 닫혔고, focused 검사와 PARTIAL 4그룹은 각자의 후보 receipt로 닫혔다. 이것은 FULL이나 출하 SHA의 kill-power가 아니다.
- [ ] **3. make 재개.** ← CURRENT: 종점 수선과 bootstrap 수선이 `4f14a4d`로 main에 push됐다(P5, M0, exact-SHA CI, M3w `37b46708`, container, Claude 설치 수용 PASS). 그 뒤 GLG가 agy 출하 범위를 바꿨다 → docs-only `fix/agy-paused-release-scope` 리뷰·checkpoint → main FF → 관리 빌드 1회 → M0 → push → exact-SHA CI → 새 M3w artifact → container 수용 → 최종 artifact와 `37b46708`의 byte 비교(허용 차이는 docs 4개) → tag `v0.41.2` + GitHub release. §3.4 Claude 수용은 `4f14a4d` receipt로, §3.7 agy는 VERIFY 7의 결정적 pause 셀과 `check:full` gate로 닫는다(legacy identity는 요청 시 선택 진단). 각 단계는 코디가 따로 GO한다.
- [ ] **4. publish.** ← PAUSED: npm publish는 승인되지 않았다.

# NOW

- **이전 후보는 상속하지 않는다.** `1e66466`의 M0·CI·M3w 후보 `df407c70`·container·Claude 설치 수용은 pause 이전 후보의 증거다. 보존하되 새 SHA의 증거로 쓰지 않는다.
- **agy 수용의 뜻이 바뀌었다.** 실 agy 송수신 왕복은 이번 cut의 MUST가 아니다. §3.7은 VERIFY criterion 7대로 결정적 `[QK:AGY-NATIVE-PUSH-PAUSED]` 셀(대화 불필요)과 `check:full`의 agy record·install·sender gate로 닫는다. doctor + fresh-conversation identity는 요청할 때만 하는 선택 진단이며 cut 필수가 아니고 송신 증거도 아니다(GLG 2026-10-24 범위 변경). pause를 원격으로 다시 살리는 시도는 하지 않는다.
- **P5′ 우회 (`fix/chain-terminus-publication-race`)는 닫혔다.** `100f618`의 P5′ RED(static의 dist mtime staleness, `smoke-entwurf-chain-live`의 `.msg`→`inbox.signal` 경쟁)는 대기 오라클 수선 `fb1cc13`으로 닫혔고, `4f14a4d`의 새 P5가 MUST 24/0/0으로 통과했다. 원 실패 기록은 `.tmp-verify/release-0.41.2/agy-pause-p5-r1/`에 보존한다.
- **`4f14a4d` 증거의 범위.** P5, OMP·herdr LIVE, Claude 설치 수용은 `4f14a4d`의 receipt다. 새 SHA에는 최종 artifact가 `37b46708`과 docs 4개(BASELINE, CHANGELOG, VERIFY, setup-clean-host)에서만 다를 때에만 그 receipt를 쓴다. 새 SHA에서 LIVE를 돌렸다고 하지 않는다. M0, exact CI, M3w, container는 새 SHA에서 다시 잰다.
- **#152는 0.41.2에 수록한다**(코디 결정). CHANGELOG 0.41.2 절의 "Antigravity native push paused (#152)"에 있고, Release evidence는 이전 후보 receipt와 #152 PARTIAL을 이 SHA의 증거와 분리해 적는다.
- **kill-power:** 출하 SHA에서 다시 측정하지 않는다(#144). PARTIAL receipt는 합산하지 않는다.
- **측정하지 않음:** #149 T3(실 두 호스트 교환, opt-in), 서로 다른 release의 sender/receiver, 실행 중인 bridge가 새 dist를 읽었는지.

# GUARDRAILS

- 모든 pnpm/commit/push hook에 `pnpm_config_verify_deps_before_run=error`. 첫 RED·deps·wrapper 오류면 중단하고 보고한다. 자동 수선과 재시도, unsafe override, force push는 금지다.
- 후보를 freeze한 뒤 worktree·index·dist가 움직이면 그 receipt는 무효다. records/native transcript/DB/색인, 후보와 사본, 증거, 옛 dist 보관본은 지우지 않는다.
- `.agent-reports/.envrc` 보존(루트 `.envrc`는 재생성하지 않는다). 넓은 /tmp 청소/프로세스 sweeper/자동 whole-floor rerun 금지.
