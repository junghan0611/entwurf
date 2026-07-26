# NEXT — 0.12.9 prepared locally — make→publish→#52·#54 close

> NEXT는 부트 섹터다. 닫힌 역사는 CHANGELOG/git/이슈에, 장기 방향은 ROADMAP/이슈에 둔다.

## NOW

- **0.12.9 release-prep가 로컬 clean commit으로 넘어간다.** pre-version HEAD `aaab00f`는 exact-SHA
  CI [30186472796](https://github.com/junghan0611/entwurf/actions/runs/30186472796)의 `check` ·
  `install-surface` · `artifact-consumer`가 모두 success다. package/CHANGELOG를 0.12.9로 올린 뒤
  독립 `pnpm check`와 fresh scratch `/tmp/entwurf-release-gate-0.12.9.8NSzz7`의 LIVE gate가
  **MUST 17/0/0 + BEHAVIOR 1/0, exit 0**으로 끝났다. 다음 권한 경계는 `make 0.12.9`; prepare는
  push/tag/candidate/publish를 하지 않는다. GLG 지시로 #52·#54는 npm publish와 registry proof 뒤
  닫고, #55는 수집함으로 계속 연다.
- **Stem: #52의 마지막 차단(final-component symlink swap)을 `ea7d00c`에 착지했다. Oracle 4차가
  clean으로 수렴했고 GLG가 commit/push와 0.12.9 release land를 승인했다.** 레코드 바이트는 이제
  `readStoreRecordFile` 하나에서만 나온다:
  `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` open → `fstat(fd).isFile()` → `readFileSync(fd)` →
  `finally closeSync`. `makeStoreRecordReader`(store-wide)와 `readMetaIdentityByGardenId`(targeted)가
  이 하나로 수렴하고 두 경계에 path-based `readFileSync`는 남지 않았다. errno는 감싸지 않는다 —
  rival scan의 raced-away skip이 `ENOENT` 식별에 걸려 있어서, 평평한 wrapper는 동시 출생마다
  dispatch를 거부하게 만든다. `O_NONBLOCK`은 fd 분류가 새로 들여온 위험(fifo가 `open`을 무한
  블록)을 되막는 것이고, classify-then-read에는 없던 창이다.
- **[교차검수 2·3차] GPT가 게이트 결함 2건과 내 오정정 1건을 잡았고 전부 수선했다.**
  ⓐ targeted ELOOP 매핑 셀이 공허했다 — 매핑 줄을 지워도 74/74 green(재현함). ⓑ fifo 셀은
  O_NONBLOCK 회귀 시 RED가 아니라 무한 정지였다(rc=124 재현) → read를 bounded child로 옮겨
  timeout이 곧 assertion failure가 되게 했고 `mkfifo` 부재는 loud fail로 바꿨다.
  ⓒ **ⓐ의 내 첫 수선이 틀렸다.** "집행점이 둘이면 하나는 실행되지 않는다"며 `lstat` 선판정을
  걷어냈는데, 두 층은 중복이 아니라 서로 다른 것을 지킨다. 선판정은 settled non-regular를 **열지
  않고** 분류하고, fd는 regular 스냅샷 뒤 swap을 잡는다. 걷어낸 결과 소켓 레코드가 `ENXIO`,
  mode-000 디렉터리가 `EACCES`로 새어 `inspection failure`가 됐다 — certification은 여전히
  non-regular라고 말하므로 **한 store에 계약이 둘**이 됐고, 이는 rule 1이 막으려던 바로 그 결함이다
  (직접 재현 확인). 선판정을 복원하고, race errno 매핑만 순수 함수 `classifyRecordReadFailure`로
  분리해 synthetic errno로 고정했다(도달 불가 분기는 디스크가 아니라 순수 함수로 증명한다).
- **검수 증거:** 구현 세션과 Oracle 교차검수가 각각 full `pnpm check` exit 0;
  `check-meta-identity-consumers` **87**(이전 62); `check-fresh-cut-gate` **166/0**;
  `check-bridge-delivery` 19; `check-agy-sender-identity` 37; `check-meta-receiver-marker` 51. full gate가
  소스 변경 뒤 dist를 재빌드했고 설치 경로도 `readStoreRecordFile`을 담아 stale-dist 착시가 아니다.
  **뮤테이션 2건으로 게이트가 무는 것을 확인했다** — store-wide
  reader를 path-based로 되돌리면 TOCTOU 런타임 셀이, targeted read를 되돌리면 source fence가 RED.
  **격리 사본 뮤테이션 4건 전부 rc=1로 물린다** — race 매핑 irregular 분기 삭제 / `ENXIO`만 삭제 /
  layer 1(`lstat` 선판정) 삭제 / `O_NONBLOCK` 삭제.
- **셀 역할 분담(혼동 금지):** layer 1을 잡는 것은 **mode-000 디렉터리 셀**이다. 소켓 셀은 `ENXIO`가
  race 매핑에 있어서 fd-only 빌드에서도 통과하므로, 그것이 지키는 것은 layer 1의 존재가 아니라
  **certification↔targeted 동일 계약**이다. 뮤테이션으로 확인했다(layer 1 제거 시 소켓 셀 green,
  mode-000 셀 RED). 둘 다 필요하고 서로를 대체하지 않는다.
- **증명 경계:** race 분기는 settled store에서 도달 불가라 디스크가 아니라 순수 함수로 고정한다.
  store-wide 쪽 TOCTOU 창은 호출자가 kind 스냅샷을 쥐는 구조라 게이트가 직접 재현하고, 두 caller가
  한 helper로 수렴한다는 것은 source fence가 잡는다.
- **직전 push: closure candidate `273be59` + `668f16f`.** #52는 discovery와 실제 dispatch/resume
  경계에서 중복 `nativeSessionId`를 거부하고 static symlink/drift false-rival과 unreadable-rival
  fail-open을 막았다. #54는 no-move / usage / incomplete transition /
  cut-complete-cleanup-incomplete를 서로 다른 exit로 고정했다.
- **0.12.8 stable 출하 완료.** `latest=0.12.8` ·
  `repair=0.12.8-repair.1` 보존. 태그 `v0.12.8` = `e31c28f`, make CI
  [30152323861](https://github.com/junghan0611/entwurf/actions/runs/30152323861), candidate sha256
  `7c7e8985823391ec6dfae918e08c4aed1fafd06b7415806b2d591b0cb95891f3`. 게이트가 본 바이트 =
  태그된 바이트 = 배포된 바이트. U3는 격리 HOME의 registry install과 entwurf model anchor 2개를
  확인했다.
- **[2026-07-25] #53 A+B 폐쇄.** 첫 커밋 `94799f6`이 owner claim을 shared
  `isPlausibleOwnerPid`로 묶고, pid 1 legacy/corrupt marker를 dead와 다른 `refuted:` residue로
  처리했다. B는 첫 라운드에서 `register-pi-package.py`만 닫아 같은 `.pi/settings.json`의 두 번째
  writer인 `register-pi-provider.py`를 놓쳤다. secondary-host post-push 검수가 같은 증상
  (`setup` → tracked bytes 재직렬화 → Biome RED)을 다시 잡았고, 두 writer의 serializer를
  `pi_settings_io.py`로 합쳤다. **candidate-index의 repo settings를 stand-in checkout에 심고 실제
  `run.sh install <checkout>` 전체를 구동한 뒤 sha256+mtime 불변을 요구하는 end-to-end 셀**이
  이제 두 writer와 user-scope side effect를 함께 본다. 교훈: 파일을 지키려면 helper가 아니라 그
  파일의 모든 writer와 실제 진입점을 열거한다.
- **#53 수용 증거:** full `pnpm check` green; `check-fresh-cut-gate` **153/0**;
  `check-agy-sender-identity` **37**; `check-meta-receiver-marker` **51**;
  `smoke-pi-provider-state` **34**; `smoke-user-scope-citizen` PASS; checkout-invisible Node 24 Docker
  artifact consumer PASS. 컨테이너에서 harness 자체가 pid 1인 형태는 실제 가능하지만 현재 certified
  Linux desktop/workstation 축 밖이며 marker writer가 fail-closed한다.
- **[2026-07-25] secondary Linux host acceptance.** pre-v3 565 records를 fresh-cut하고 dead
  marker/socket 1045개를 정리한 뒤 setup과 strict doctor가 PASS했다. 손으로 넘어야 했던 두 문
  (pid-1 marker, tracked settings rewrite)이 #53의 실제 재현이 되었고, 두 번째 문은 post-push 검수가
  다시 열어 end-to-end gate로 닫았다.

## OPEN

1. **▶ `/entwurf-release make 0.12.9` — 별도 GLG 승인 뒤에만 실행한다.** prepared HEAD를 ordinary
   push하고 그 exact SHA의 CI 3잡이 green인 뒤, 보존할 candidate 하나를 pack하고 checkout-invisible
   Linux consumer로 같은 바이트를 수용한다. 그 다음에만 `v0.12.9` tag와 GitHub release를 만든다.
   npm은 여전히 별도 `/entwurf-release publish 0.12.9 <candidate> latest` 권한 경계다. registry-installed
   U3와 `latest=0.12.9` / repair lane 보존을 증명한 뒤 준비된 원장으로 #52·#54를 닫는다.
2. **#47 — 다음 제품 축.** 착수 전 `docs/mux-launch-rail.md`를 다시 읽는다. mux lineage에서
   `callerGardenId`는 호출 사건이지 계보가 아니다. 0.13.0은 #48 Cortex 좌표를 예약한다.
3. **#49 E — floor purity.** 설계 SSOT는 #41의 두 코멘트. 첫 전체 floor 실행은 green 획득이 아니라
   churn 카탈로그 관측이며 RED가 데이터다.
4. **🔴 번들 MCP readiness race.** 인과가 서기 전에는 고치지 않는다(GLG 결정). SSOT는 ROADMAP의
   「🔴 OPEN — 번들 MCP readiness race」. 0.12.8 release gate에서는 재현되지 않았다.
5. **🟡 `check-fresh-cut-gate` G셀 flake.** archive collision seed가 `지금+0/1/2초`뿐이라 node 기동과
   quiesce scan이 늦으면 충돌 자체가 착지하지 않고 G1–G3이 제품 결함으로 오인한다. 제품의 collision
   preflight는 F15/F17이 별도로 지킨다. 수선은 창 확대 + seed 착지 증명 후 제품 판정; 미착지는
   `SETUP MISS`로 자기 원인을 말한다.
6. **#55 — subtraction fallout 수집함.** #52·#54는 0.12.9 npm publish와 registry proof 뒤 닫고,
   그때 이슈 본문에서 완료된 child로 이동한다. #55 자체에는 readiness race·G셀 flake와 새 비차단
   관측을 계속 남긴다.
7. **후속·별건:** ⓐ #50 readiness upstream 인과 확정 코멘트 정정(GLG 승인 후) ⓑ Meta sender 모델
   표기(optional display field) ⓒ refuted marker의 prune/doctor listing은 선택적 관측성 개선.

## 런북 — pre-cut 호스트가 이 컷을 받을 때

세션 quiesce(agy conversation 포함) → pull/install → `entwurf meta-bridge-fresh-cut` → `setup` →
재개. 이전 세대는 `meta-sessions.archive-<ts>`로 남고 runtime은 읽지 않는다. store unreadable은
cut이 아니라 권한/경로 수리다. doctor EXIT CONTRACT는 `0` certified / `1` 결함→cut / `2` usage /
`3` unreadable→access 수리. fresh-cut 자체는 `0` complete / `1` NOTHING MOVED / `2` usage /
`3` cut transition incomplete / `4` cut complete·residue cleanup incomplete다. Exit 4에서 `setup`은
가능하지만, 새 시민이 태어난 뒤 fresh-cut을 다시 돌리면 새 세대까지 archive한다. 따라서 재실행은
`setup` 전에만 하고, 이미 진행했다면 출력이 이름 붙인 residue를 수동으로 수선한다.

## 컷 불변

Claude Code `>=2.1.217` · Linux desktop/workstation 유일 certified axis · Node 24+ · active store
v3-only · 세대 간 주소/resume 연속성 없음 · record body가 identity authority ·
`MetaCitizenBackend` 어휘(`MetaBackendV2` 잔재 0).

## RECENT

- **[2026-07-26] address-read 수선 `ea7d00c`:** 레코드 바이트를 fd 하나로 모았다. 교훈은 #53과
  같은 모양이다 — 규칙을 "모든 호출자가 기억하기"가 아니라 "한 함수만 통과하기"로 만들면 구조가
  대신 지킨다. 다만 이번엔 한 겹 더 있다: **엔트리의 kind를 이름에 붙여 옮기는 것만으로는 부족하고,
  바이트를 내주는 그 file description 위에서 다시 판정해야 한다.** 이름은 두 syscall 사이에 뜻이
  바뀔 수 있다. 새 계약이 새 위험(fifo 블로킹)을 들여왔고 `O_NONBLOCK`으로 되막았다 — 뺄셈이
  아니라 교환이었음을 기록해 둔다.
- **[2026-07-26] #52·#54 closure candidate:** duplicate discovery/dispatch quarantine + kind-carrying
  static-symlink refusal, fresh-cut 5-state exit contract. Opus 구현 뒤 GPT 교차검수가 symlink/drift
  false-rival과 unreadable-rival fail-open을 잡았고, 제품 seam·mutation gate로 함께 수선했다. Full
  `pnpm check` green. 두 커밋은 Oracle 검수를 위해 `origin/main`에 push했다. Final-component
  regular→symlink 교체 경쟁은 위 OPEN 1로 남겼고 이슈 close는 다음 세션 판단이다.
- **[2026-07-25] 0.12.8 stable:** land `1345688` → prepare/tag `e31c28f` → make → GLG publish.
  CHANGELOG 0.12.8과 [#50 코멘트](https://github.com/junghan0611/entwurf/issues/50#issuecomment-5077959254)가 원장.
- **[2026-07-25] fresh-cut 뺄셈 (#50):** migration lane 14 files/2,404 lines 삭제; 동사 하나와
  `certifyActiveStore` 계약 하나로 교체. fresh-eyes 결함은 모두 새 계약과 그것을 모르는 기존
  read/probe consumer 사이의 갭이었다.
- **[2026-07-25] two-host installed-native proof:** `0.12.8-repair.1`이 maintainer + secondary
  Linux에서 doctor exit 0, physical `entwurf_v2` delivery, live owner join.
- **수동 항목:** `smoke-meta-async-drift`는 외부 바이너리 pin 의존으로 CI 제외. 2026-07-14 green:
  Claude 2.1.208 / Codex 0.144.1 / agy 1.1.2.
