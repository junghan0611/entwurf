# NEXT — 0.12.8 stable이 prepare까지 섰다 — 다음은 GLG 승인 후 make

> NEXT는 부트 섹터다. 닫힌 역사는 CHANGELOG/git/이슈에, 장기 방향은 ROADMAP/이슈에 둔다.

## NOW

- **[2026-07-25] fresh-cut 뺄셈 main merge 완료 (#50 닫힘).** 마이그레이션 레인 전체가 부채로
  판정되어 삭제됐다: `meta-migration.ts` · `meta-bridge-migrate-v3.ts`(M1 3-verb) · 게이트 2개 ·
  `check-upgrade-gate.sh` · `fixtures/` 동결 바이트 장치. 대체물은 동사 하나
  (`meta-bridge-fresh-cut`)와 계약 하나(`certifyActiveStore`)다. **동결 정책 4문장의 SSOT는
  README 「Generations」 절**, 불변은 AGENTS #5.
- **fresh-eyes 재검수(페블·지피티, 오후)에서 blocker 6건이 나와 전부 수선했다.** 세 번째 검수
  라운드가 값을 냈다는 것이 이 컷의 기록에서 가장 중요한 사실이다 — **발견 6건은 전부 지피티
  손에서 나왔고**, 앞선 3자 검수(페블·오푸스·지피티)가 놓친 것들이다. 공통 형태가 하나였다:
  **이 컷이 새로 선언한 계약과, 그 계약을 모르는 기존 읽기/probe 경로 사이의 갭.**
  1. **marker 없는 live agy conversation을 cut이 archive했다.** `entwurf_register_native`는
     probe로 liveness를 증명한 뒤 record만 쓰고 marker를 쓰지 않으며(보정①), v2 decider는
     `nativePushProbe(identity)`로 record만 보고 dispatch한다(mailbox 분기만 receiver marker를
     요구) — 즉 **marker 부재가 배달 가능한 live 시민의 정상 상태**다. socket+marker 스캔만으로
     quiesce를 읽던 게이트가 그 주소를 발밑에서 archive했다. → `inspectNativePushCitizens`:
     읽히는 record 중 native-push backend를 **dispatch가 쓰는 그 adapter probe**로 확인
     (alive=LIVE / indeterminate·probe실패=UNCERTAIN / dead=통과).
     **읽히지 않는 record는 통과** — 근거는 "그 세션이 죽었다"가 아니라 "모든 targeted address
     경로가 그 바이트에서 refuse하므로 도달 가능한 시민이 아니다"이고, 대안(전부 refuse =
     이전 세대 store에서 영구 교착 / id salvage = 삭제한 legacy reader 부활)이 둘 다 더 나쁘다.
     살아남은 conversation은 **새 gardenId로 re-birth**(continuity 아님).
     escape hatch가 성립한다: agy를 닫으면 probe가 `dead`라 cut이 합법화된다.
  2. **targeted read가 symlink record를 follow했다.** certification은 거부하는데
     `readMetaIdentityByGardenId`가 `existsSync`+`readFileSync`로 링크를 따라가, 새 계약이
     "아무도 주소로 쓰지 않는 곳에서만" 참이었다. → `lstat` regular-file 계약을 read에도.
  3. **inspect 실패가 absent로 세탁됐다 — 두 층에서.** `existsSync`는 stat조차 못 한 항목에
     `false`를 주므로 (a) targeted: 읽을 수 없는 store가 v2에서 soft `bad-target`으로
     (b) store-wide: `certifyActiveStoreDir`가 **certified-empty**로 보였다(doctor·install이
     unreadable 호스트를 clean이라 보고). → shared `inspectRecordEntry` + readdir 직접 try:
     **ENOENT만 absence**, EACCES/ENOTDIR/기타는 hard throw.
  4. **`pgrep`의 모든 nonzero를 dead로 접었다.** exit 1(no match)과 2/3/124/127(scan 실패)이 한
     값이 되어, PATH에 pgrep이 없으면 live conversation이 "provably hostless"가 됐다. dispatch
     소비자에게는 false dead가 배달 거부로 끝나 무해했지만, destructive 소비자가 생긴 순간
     fail-open. → exit 1만 no-match, 나머지는 probe `indeterminate`.
  5. **drift/diagnostic 경로가 fresh-cut verb를 명명하지 않았다** ("Remove or fix it"). → 명명.
  6. **preflight가 doctor의 판정을 정반대 처방으로 덮었다.** doctor가 "ACCESS problem, a cut
     cannot fix it"이라 해도 `preflight_v3_store`/`meta-bridge-install.sh`의 **마지막 줄**은
     무조건 "archive the generation with fresh-cut"이었다 — 오퍼레이터(그리고 마지막 명령을
     따르는 에이전트)를 같은 errno로 실패할 명령에 보냈다. → doctor에 **EXIT CONTRACT**
     (`0` certified / `1` certification defects → cut / `2` usage / `3` store unreadable →
     access·path 수리)를 박고 두 호출자가 rc로 분기. access 분기는 cut 동사를 이름 대지 않는다.
- **증거 (수선 후 exact worktree, 3셀 전부 GREEN)**: ① `pnpm check` EXIT=0 —
  `check-fresh-cut-gate` **115/0**(H 8셀: native-push 3행 + 읽히지 않는 record 통과 + scan 실패
  refuse + 배선 / I 10셀: unreadable store는 uncertified store가 아니며, **두 install caller를
  모두 실제 구동**), `check-meta-identity-consumers` **39**, `check-native-push-adapter` **44**
  ② `check-pack-install` EXIT=0 ③ `ENTWURF_REQUIRE_DOCKER=1 check-install-container` exit=0
  (artifact sha256 `44a0405189fd901061008d9b91ff1648f6211b95a9048dec4b13c2e8d8573188`).
  주의: 이 container 증거는 워킹트리 수용 증거이지 release-preserved tgz가 아니다.
  **mutation 증거**: ①의 배선 한 줄을 지우면 H2/H2b/H2c/H3이 RED가 되고 출력이 정확히 그 구멍의
  형상(`archived: …/store.archive-…`)을 보인다.
- **검수 과정에서 배운 것 하나(다음 팀이 같은 데 빠지지 않게):** `.ts`를 고친 뒤 `pnpm check`가
  `check-bridge-delivery`의 **dist staleness** 단언에서 죽는다. 원인을 "검증 중 편집"으로 잘못
  진단해 한 바퀴 낭비했다. **소스 수정 → `pnpm run build-bridge` → 3셀** 순서를 지킬 것.
- **실호스트 사실**: 이 개발 PC의 store는 **213 record certified** — merge 후 fresh-cut 없이
  `setup`이 통과한다.
- **[2026-07-25] release 전 fresh-cut closure 완료 (4·5라운드).** 새 소비자인 destructive
  fresh-cut이 기존 read/dispatch helper의 `unknown→absent/dead` 안전 방향을 뒤집은 뒤 남아 있던
  도달면을 열거해 닫았다. 최종 4커밋은 `c408683`(surface dir ENOENT-only) → `eecb2d5`
  (directory kind · common parent-writability preflight · partial-move report · doctor rc 처방) →
  `e5cb4a1`(W_OK 증거보다 강한 산문 제거) → `9015431`(socket entry ENOENT-only · installed
  doctor compiled-entry guard). **정직한 수용 경계:** 결함 부류 전체가 영구히 사라졌다는 주장이
  아니라, 파괴적 동사의 열거된 도달 폐포(fresh-cut 본체 + 두 doctor caller) 안에서 존재·생존·
  판정 질문을 하는 자리를 fail-closed로 만들고 실제 위험마다 detector를 붙였다. 새 destructive
  소비자가 생길 때의 primitive 승격은 후속이다. GPT 최종 독립 실행:
  `pnpm run build-bridge && pnpm check` **EXIT=0**, fresh-cut gate **141/0**; exact HEAD
  `9015431`, clean tree. #52 duplicate read/birth race와 empty start-key 정책은 의도적 후속.
- **▶ 다음 걸음 — GLG 승인이 있으면 `entwurf-release make 0.12.8`, 그 뒤 #47.** land와 prepare가
  닫혔다. **land**: `0.12.8-repair.1`의 two-host installed-native proof(2026-07-25, BASELINE
  HISTORY) 뒤 발견한 `remove-dev-bin` dispatch 수선까지 얹은 pre-version HEAD `1345688`이
  exact-SHA CI [30150824225](https://github.com/junghan0611/entwurf/actions/runs/30150824225)에서
  `check`·`install-surface`·`artifact-consumer` 전부 success. **prepare**: package `0.12.8` +
  CHANGELOG 0.12.8 섹션 + release skill의 dist-tag별 U2 계약 + README/VERIFY/BASELINE/DELIVERY/
  setup의 stable 승격 문구가 로컬 커밋 하나로 서 있고 트리는 clean이다. LIVE 재획득 완료 —
  `LIVE=1 ./run.sh release-gate`가 **MUST 17/0/0 + BEHAVIOR 1/0, EXIT=0**
  (`/tmp/entwurf-release-gate-0.12.8.u9y9IX/release-gate.log`), 이번 실행에서는 번들 MCP
  readiness race가 뜨지 않았다(`smoke-acp-bundled-mcp-live` PASS). **push/tag/candidate/publish는
  하지 않았다** — 전부 make/publish 소유다. 0.13.0은 ROADMAP의 Cortex #48 예약. 착수 전
  `docs/mux-launch-rail.md`; mux lineage는 `callerGardenId`(호출 사건 ≠ 계보).
- **prepare 독립검수 4건, 전부 그 커밋 안에서 닫혔다.** ① **`check-install-surface` S7은 워킹트리가
  아니라 candidate index를 읽는다** — unstaged SKILL.md는 게이트에 보이지 않았고, stage하자마자
  새 문구의 em dash 3개가 S7e(ASCII-only)를 RED로 만들었다. **release-prep 바이트는 게이트를
  돌리기 전에 stage한다**(이번 컷이 준 재사용 가능한 교훈). ② U2 stable 분기가 "never a hand-kept
  literal"을 선언하면서 `repair` 리터럴을 단언했다(고치려던 `latest="0.12.7"`과 같은 형태) → U0가
  두 dist-tag를 모두 포획하고 "publish한 레인 = $VERSION, 건드리지 않은 레인 = U0 포획값" 대칭
  계약으로 교체, 6셀 예행 확인. ③ CHANGELOG의 "two gates / about 2,900 lines"가 재현되지 않는다 →
  게이트 3개 · 삭제 파일 2,404줄. ④ BASELINE 판정표의 두 Linux 행이 아직 `pending`이라 같은 파일
  HISTORY와 모순이었고, CHANGELOG/VERIFY의 "BASELINE HISTORY" 인용이 반대 문장으로 떨어졌다 →
  실측에 맞췄다. `repair cut` 문자열은 설치기가 실제로 뱉고 게이트가 단언하는 값이라
  (`meta-bridge-install.sh` ↔ `smoke-meta-install-state.sh`) 인용문은 보존하고 문서 자체 목소리인
  current claim만 정정했다.

## OPEN

1. **#52 — duplicate `nativeSessionId`가 read/discovery에서 라우팅된다.** 이 컷의 회귀가 아니라
   **미완의 개선**이다(main에서는 duplicate 생성 자체를 막지 않았고, 이 컷이 쓰기에서 막기
   시작했다). 유입 경로에 외부 오염뿐 아니라 **concurrent birth race**도 있다(upsert
   certification은 트랜잭션이 아님 — 두 writer가 같은 clean snapshot을 보고 서로 다른 gid를
   mint 가능). 읽기 전면 차단은 README가 명시적으로 좁힌 범위와 부딪히는 **정책 결정**이라 별건.
   표면 5개 + 재현 3줄은 이슈 본문에.
2. **#49 E — floor purity.** 설계 SSOT는 **#41의 두 코멘트**. 첫 전체 floor 실행은 green이
   목표가 아니라 churn 카탈로그를 뽑는 관측 실행이고, RED는 데이터다.
3. **🔴 release 차단 관측 — 번들 MCP readiness race (변동 없음).** 인과가 서기 전에는 고치지
   않는다(GLG 결정). SSOT는 **ROADMAP 「🔴 OPEN — 번들 MCP readiness race」**.
4. **release lane (0.12.8 stable, 방아쇠는 GLG):** 두 Linux installed-host proof · `land` ·
   `prepare` **완료**. 남은 것은 `make 0.12.8`(prepared HEAD push → exact-SHA CI → preserved
   candidate + container acceptance → tag → GitHub release) → `publish 0.12.8 <candidate> latest`.
   publish 후 `latest=0.12.8`, 기존 `repair=0.12.8-repair.1`을 보존한다. merge/push ≠ release.
   워킹트리 container 증거는 release-preserved tgz가 아니므로 `make` 때 exact candidate를 다시
   보존·결속한다.
5. **🟡 게이트 flake — fresh-cut G셀(archive-destination preflight)이 자기 setup 실패를 제품 결함으로
   읽는다.** 셀은 충돌지를 `지금+0/1/2초` 세 개로만 점유하는데, 컷은 node 기동과 quiesce 스캔을
   **끝낸 뒤에야** 스탬프를 찍는다(`meta-bridge-fresh-cut.ts:494`의 `const ts = stamp()`). 유휴에선
   0–1초라 창에 들어오지만 부하가 걸리면 벗어나 **충돌이 아예 생기지 않고**, 그런데도 G1–G3은
   "컷이 충돌을 무시했다"로 RED가 된다. 2026-07-25 prepare에서 같은 바이트 위 141/0 → 138/3 →
   141/0을 관측했다(pre-commit 1회 차단). **제품 결함 아님** — 충돌 preflight 자체는 F15/F17이
   따로 지킨다. 수선 방향은 두 가지를 함께: ⓐ 창을 30초로 넓히고 ⓑ **seed가 실제로 착지했는지
   증명한 뒤에만** 제품을 판정한다(컷이 고른 스탬프가 seed 집합 밖이면 `SETUP MISS`로 RED — 여전히
   빨갛지만 원인을 자기 이름으로 부른다). GLG 승인 시 release-prep과 **별개 커밋**으로 낸다 —
   release skill P0가 구현 수선을 prepare 커밋에 섞는 것을 금지한다.
6. **후속·별건:** ⓐ 오푸스가 #50에 남긴 readiness upstream 인과 확정 코멘트 정정 — GLG 승인 후
   ⓑ **판단 완료** — prepare에서 fresh-cut 전용 BASELINE HISTORY 항목은 만들지 않았다. operator
   면에 실제로 필요했던 수선은 판정표를 실측(두 호스트 doctor PASS)에 맞추는 것이었고, stable
   아티팩트의 host proof는 publish 뒤 작업이다 ⓒ #48 cortex(0.13.0, PR
   #40은 PARK) ⓓ Meta sender 모델 표기(비차단, optional display field).

## 런북 — pre-cut 호스트가 이 컷을 pull할 때

그 호스트 세션 quiesce(**agy conversation 포함** — 살아있으면 cut이 거부한다) → pull →
`entwurf meta-bridge-fresh-cut` → `setup` → 재개. 이전 세대는 `meta-sessions.archive-<ts>`로
남고 아무도 읽지 않는다. 순서를 외울 필요는 없다 — 게이트가 각 단계에서 거부하며 무엇을 할지
말한다. store를 **읽을 수 없는** 경우는 cut이 아니라 권한/경로 수리다(게이트가 구분해 말한다).

## 컷 불변 (재론 금지)

Claude floor `>=2.1.217` · Linux 유일 certified axis · Node 24+ 단일 지원축 ·
`MetaCitizenBackend` 어휘(`MetaBackendV2` 잔재 0).

## RECENT

- **[2026-07-25] fresh-cut 뺄셈** — 위 NOW. 페블 `7f10eaf`(뺄셈 본체) + 오푸스 `38b1e44`(GPT
  3라운드 수선) + fresh-eyes 재검수 수선(이 merge의 마지막 커밋). net −1,100줄 뺄셈에 수선분이
  얹혔다.
- **[2026-07-24] #50 hard-cut 브랜치 merge** — meta-record가 유일한 주소 권위(V3-only).
  증거 원장은 BASELINE HISTORY(`cbda097`)와 CHANGELOG/git.
- **[2026-07-13] evidence boundary:** 동일 agy pid 다중 conversation 동시 invocation 시 marker
  last-writer 덮임. process-per-session·직렬 invocation에 기댄다.
- **수동 항목:** `smoke-meta-async-drift`는 외부 바이너리 pin 의존으로 CI 제외. 컷 체크리스트의
  수동 항목 (2026-07-14 green: claude 2.1.208 / codex 0.144.1 / agy 1.1.2).
