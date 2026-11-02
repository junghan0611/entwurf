# NEXT — #157 rail symmetry

# RAIL — 현재 좌표

- [x] **1. Foundation/H1/G1a.** main2917917, feature0e04bf6/c203209 push·exact-SHA CI.
- [x] **2. Herdr Pi same-id 복귀 n=1.** no-new-prompt/recall, docs2aaf856.
- [x] **3. pi-durable × Herdr 개발·로컬 closing.** publicresume/recall + 합동보정 + PARTIAL4/FULL991s. 2734f524 push·CI41402607666 required4jobs 성공.
- [x] **4. CC 대칭·통합 CLI 개발·검수·로컬 closing.** thin `entwurf claude`, Herdr public same-id/recall, 교차/Fable/한보정, 같은후보 PARTIAL6/FULL1016s.
- [ ] **5. 문서 정리 완료 → 최종 수용 대기.** ← CURRENT: GLG 승인한 4+5 브랜치 checkpoint의 exact-SHA CI 확인, 이후 0.50 릴리즈·운영 갱신 별도 결정.

# NOW

- **다음 한 걸음:** GLG의 “커밋푸시하자” 승인으로 4+5 브랜치 checkpoint를 commit/push하고 그 정확한 HEAD의 required CI4jobs를 확인한다. 새 기능/Native 작업을 시작하지 않는다. 이후 0.50 준비·Native/LIVE·exact artifact 수용·publish/운영 갱신은 별도 승인과 commit/release skill·VERIFY 경계다. merge 전 durable근거승격과 branchNEXT삭제.
- **현재 subject:** `feat/157-rail-symmetry`, **2734f524bfeca6eb1a0ae092494d45576af9ebef** 기반 4+5를 이 NEXT와 함께 checkpoint한다. 최신 commit/push/CI 상태는 git과 exact-SHA run에서 확인한다. [4번 완료6573387199](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6573387199), [5번 문서 완료6573733842](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6573733842). 실제 최신 git상태부터 확인한다.
- **문서 완료:** 기존9mdfiles, stage5-onlydiff210줄/SHA **48d67027fc81370ac3b7b58ee4d9179f1b879c9273d717050442e7e7a92eebb4**. 915사실대조→Fable B0/D1/O7→날짜/후보범위·문구 한보정, main D1최종text와9doc/10sourcehash 검산. 최신 관련leaf raw herdr-plugin/install-surface/release-gate-outcomes 모두0, diffcheck0. 코드/gate/mutant/RootJSON/버전/pin 변경은 5번 범위에 없다.
- **후보 구분:** 4FULL완료 뒤 5docs/NEXT를 변경했다. 4receipt는 당시snapshot의 유효한 역사측정이며 새후보의 exactfloor가 아니다. 최신workingbundle의 exact-SHA CI/mainlanding/Native·LIVE/artifact·registry/0.50 출하·운영reader 수용은 아직 없다. root NEXT/ROADMAP/CHANGELOG/Org는 그대로다.
- **릴리즈 선행 주의:** 이후 실제vendor/Native gate 전에 아래 운영data변이와 기존#67보호의 한계를 다시 판단하고 범위승인 받는다. 지금은 모든 추가 실제실험/복구/SDK·설치/PATH/auth설정/운영repin 금지. localFULL로 namedLIVE/CI/reader coherence floor를 대체하지 않는다.

# 운영 사건 — BASELINE의 impact 표부터 읽기

- H2의 실제 `~/.local/bin/claude`가 fixture의2.1.316을 가리켰다(원본과 같은SHA55cd). GLG명시승인 뒤 main이 원래 `~/.local/share/claude/versions/2.1.316` 링크로만 복구하고 readlink/realpath/hash 확인. 현재316정상은 측정됐지만 전체운영data 무변경은 아니다.
- N2공유store에서2.1.312/314/316→314/316으로 변했다. old312의 SHA/복구사본은 이 작업에 없고 다운로드/재설치는 안 했다. 두writerPID미측정; H2는 link가 자기fixture를 가리켜귀속근거강함, N2는 같은시각fixture staging/locks 생성이라는 timing-only. 무해함/실제312사용유무는 미확정. #67fence는 launcher만 보호하며 wholemutable vendorstore를 보장하지 않는다.
- **N1/N2 각 새1시민·최대2제출턴 예산 모두 소진**,추가 Native/모델/vendor턴 없음. h2/h3와Native기록보존, 임의삭제/cleanup/복구없음. H2recall未측정480s/rc3, N2blindrecall성공2턴/7requests(Sonnet5.5)·11PID/listener종료를 구분한다. 화면연속성/전체HOME/OAuth/billing/.claude.json불변은 증명안됨.
- 읽을 곳: `BASELINE.md`의2026-11-02stage4행, `/tmp/e157h/s4-cc-a/RECEIPT.md`, `h3/raw/x01-vendor-version-loss.md`, `/tmp/e157h/stage4/LAUNCHER-RESTORE.md`. 장비밖에서도 위publicclosing에 결정적근거가 있다.

# RECENT — 출하 증거로 승계하지 않기

- 4PARTIAL6: visible94/guidance14/claude12/install44/mux17/surface20 모두KILLED/controlok/clean/stable. 공통workSurface **1075a5c8fc153e9a41c4e970d8827f4d66cd3e8bd91d725d5df6ed9297d1a4cb**. FULL17:51:36→18:08:32KST/1016s/command0·stream0/package666PASS. main 원결과·snapshot/distshapecmp직접확인. stdoutSHA53f9b075…,snap7c701a03…; prepackmtime는bytes/keyset/mode/size와다름. `/tmp/e157h/stage4/QUALIFICATION-AND-FULL.md`.
- 5최종: `/tmp/e157h/s4-cli-169/stage5/RECEIPT.md` A3c/`MAIN-CLOSING.md`. BASELINE469d9920/VERIFYae4e89f1, sourceherdrebfbdd6a/v2195535a4/runshf7f45271 unchanged. Fable352cd5와lead5c787f전문main읽음. 소스 재검수·whole qualification/root74/FULL 재실행 없음.
- 3이전층: [6570499114](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6570499114) final991s/XDG5와old978s/XDG4를구분. [PDactual6566126053](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6566126053)은82b5ec36후보,최신LIVE아님. 원114초중단exit未記録/driver·probe실패/기타실패는원기록그대로,후속green으로소급clean아님. driver중단/SIGKILL미증명,별도검증기개발재개금지.

# 역할·금지선

- main **20261014T212756-68bd94** coord/NEXT/commit/DM; lead **20261030T190810-915040**; CLI/docs **20261102T081752-169dd1**; Fable **20261102T063827-dff8a1**; Terra **20261101T123618-a20739**; notebook **20261007T132839-b22677**. 본작업editstop,추가형제/coordlane없음.
- **Astra567753 추가호출금지 / PiOpus150a5e 연락·resume·retire금지.** working시민실험/종료·SQL직접읽기/복사/수선·전수scan/lockrepair 없음. `g3-pd-birth-r1/raw/s06-ss-all.tmp` 격리유지.
- 이checkout/branch만, 개발clone/worktree금지. Offline env-i/privateHOME·PI·XDG5/verifydeps-error2/**CI추가금지**,managedbuild only/정상hooks·scanner. 긴gate전scope/time/reason고지,실제오류raw·관측exit STOP/unknown발명·맹목retry금지. commit≠push,후속release·운영갱신은 별도다.
