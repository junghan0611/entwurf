# NEXT — 0.41.2 버그픽스 릴리즈 (make)

core 0.41.2를 v0.41.1 이후 main 변경으로 자른다. 범위는 #149 remote pair 복수 route(하드 컷), pack argv 판정의 SIGPIPE 수선, 개발자 설치 배타성, #108 placement MCP wire 검증이다. 여기에 make 도중 열린 [#152](https://github.com/junghan0611/entwurf/issues/152) agy native-push pause가 더해진다. npm 재pin과 Herdr manifest bump는 없고, Herdr lock은 기존 `herdr-checkout` 검증 carrier로 전환한다. 원장은 `.tmp-verify/release-0.41.2/`(ignored, 조율 포인터 `COORDINATION.md`)와 각 이슈 thread다.

# RAIL — 현재 좌표

- [x] **0. 이전 cut 닫힘.** core `v0.41.1` = `6a88436`(GitHub Latest, npm `latest` 0.41.1). Herdr snapshot `v2026.10.23-herdr.0.41.1` = `439b399`. 0.41.1 기록은 CHANGELOG와 [#148](https://github.com/junghan0611/entwurf/issues/148#issuecomment-6353660427)가 SSOT다.
- [x] **1. 범위 landing + prepare.** `156bb62`(#149), `e7ed057`(pack argv), `3e2673b`(개발자 설치), `1d24a01`(#108), Herdr fixture 수선 `f0de5b7`, prepare `1e66466`(main fast-forward, push CI 4 job green).
- [x] **2. #152 pause 소스·증명.** agy native-push를 코드로 멈추는 묶음이 `fix/agy-native-push-paused`에 working tree로 있다(미커밋). 설계·코드 리뷰와 단일 amendment가 닫혔고, focused 검사와 PARTIAL 4그룹은 각자의 후보 receipt로 닫혔다. 이것은 FULL이나 출하 SHA의 kill-power가 아니다.
- [ ] **3. make 재개.** ← CURRENT: working-tree frozen `check:full`은 닫혔다(그 SHA의 floor 아님) → 정상 checkpoint → 깨끗한 checkpoint HEAD에서 새 P5(`release-gate --cut`)와 M0(P5 안의 같은 `check:full` 공유) → 새 prepared SHA push → exact-SHA CI → 그 SHA의 M3w exact artifact → container 수용 → 설치 후 native 수용(§3.4 Claude, §3.7 agy: VERIFY 7의 legacy identity와 paused 증명을 따로) → tag `v0.41.2` + GitHub release. 각 단계는 코디가 따로 GO한다.
- [ ] **4. publish.** ← PAUSED: npm publish는 승인되지 않았다.

# NOW

- **이전 후보는 상속하지 않는다.** `1e66466`의 M0·CI·M3w 후보 `df407c70`·container·Claude 설치 수용은 pause 이전 후보의 증거다. 보존하되 새 SHA의 증거로 쓰지 않는다.
- **agy 수용의 뜻이 바뀌었다.** 실 agy 송수신 왕복은 이번 cut의 MUST가 아니다. §3.7은 VERIFY criterion 7대로 (a) doctor + fresh-conversation identity(송신 증거 아님)와 (b) 결정적 `[QK:AGY-NATIVE-PUSH-PAUSED]` 셀(대화 불필요)로 나눠 닫는다. pause를 원격으로 다시 살리는 시도는 하지 않는다.
- **#152는 0.41.2에 수록한다**(코디 결정). CHANGELOG 0.41.2 절의 "Antigravity native push paused (#152)"에 있고, Release evidence는 이전 후보 receipt와 #152 PARTIAL을 이 SHA의 증거와 분리해 적는다.
- **kill-power:** 출하 SHA에서 다시 측정하지 않는다(#144). PARTIAL receipt는 합산하지 않는다.
- **측정하지 않음:** #149 T3(실 두 호스트 교환, opt-in), 서로 다른 release의 sender/receiver, 실행 중인 bridge가 새 dist를 읽었는지.

# GUARDRAILS

- 모든 pnpm/commit/push hook에 `pnpm_config_verify_deps_before_run=error`. 첫 RED·deps·wrapper 오류면 중단하고 보고한다. 자동 수선과 재시도, unsafe override, force push는 금지다.
- 후보를 freeze한 뒤 worktree·index·dist가 움직이면 그 receipt는 무효다. records/native transcript/DB/색인, 후보와 사본, 증거, 옛 dist 보관본은 지우지 않는다.
- `.agent-reports/.envrc` 보존(루트 `.envrc`는 재생성하지 않는다). 넓은 /tmp 청소/프로세스 sweeper/자동 whole-floor rerun 금지.
