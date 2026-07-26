# NEXT — #52·#54 closure candidate를 로컬 커밋 — 다음 세션에서 마지막 차단·close 판단

> NEXT는 부트 섹터다. 닫힌 역사는 CHANGELOG/git/이슈에, 장기 방향은 ROADMAP/이슈에 둔다.

## NOW

- **Stem: 현재 closure candidate는 로컬 커밋으로만 고정한다. push·#52/#54 close·0.12.9 prepare는
  다음 세션의 마지막 차단 검수 뒤 결정한다.** #52는 discovery와 실제 dispatch/resume 경계에서
  중복 `nativeSessionId`를 거부하고 static symlink/drift false-rival과 unreadable-rival fail-open을
  막았다. #54는 no-move / usage / incomplete transition / cut-complete-cleanup-incomplete를 서로 다른
  exit로 고정했다.
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

1. **▶ #52 마지막 차단 — final-component symlink swap.** `readActiveStoreEntries`/target `lstat`가
   regular를 확인한 뒤 실제 `readFileSync(path)` 전에 path가 symlink로 교체되면 foreign bytes를
   따라간다(재현: kind snapshot은 regular, reader 결과는 `FOREIGN`). Linux certified axis에서
   `O_RDONLY|O_NOFOLLOW`로 open → `fstat` regular 확인 → fd read/close하는 shared reader를 만들고
   `makeStoreRecordReader`와 `readMetaIdentityByGardenId`가 함께 써야 한다. 실제 symlink를 helper에
   직접 넣어 target bytes를 반환하지 않음과 fd close를 gate로 고정한다. 이 검수 전 #52·#54 close,
   push, 0.12.9 prepare 금지.
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
6. **#55 — subtraction fallout 수집함.** #52·#54가 push 후 닫히면 이슈 본문에서 완료된 child로
   이동하고, readiness race·G셀 flake와 새 비차단 관측만 남긴다.
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

- **[2026-07-26] #52·#54 closure candidate:** duplicate discovery/dispatch quarantine + kind-carrying
  static-symlink refusal, fresh-cut 5-state exit contract. Opus 구현 뒤 GPT 교차검수가 symlink/drift
  false-rival과 unreadable-rival fail-open을 잡았고, 제품 seam·mutation gate로 함께 수선했다. Full
  `pnpm check` green. Final-component regular→symlink 교체 경쟁은 위 OPEN 1로 남겼다; push와 이슈
  close는 다음 세션 판단이다.
- **[2026-07-25] 0.12.8 stable:** land `1345688` → prepare/tag `e31c28f` → make → GLG publish.
  CHANGELOG 0.12.8과 [#50 코멘트](https://github.com/junghan0611/entwurf/issues/50#issuecomment-5077959254)가 원장.
- **[2026-07-25] fresh-cut 뺄셈 (#50):** migration lane 14 files/2,404 lines 삭제; 동사 하나와
  `certifyActiveStore` 계약 하나로 교체. fresh-eyes 결함은 모두 새 계약과 그것을 모르는 기존
  read/probe consumer 사이의 갭이었다.
- **[2026-07-25] two-host installed-native proof:** `0.12.8-repair.1`이 maintainer + secondary
  Linux에서 doctor exit 0, physical `entwurf_v2` delivery, live owner join.
- **수동 항목:** `smoke-meta-async-drift`는 외부 바이너리 pin 의존으로 CI 제외. 2026-07-14 green:
  Claude 2.1.208 / Codex 0.144.1 / agy 1.1.2.
