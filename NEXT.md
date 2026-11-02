# NEXT — Herdr 0.50.0 npm pin → public-ref 수용 → 운영 반영

# RAIL — 현재 좌표

- [x] **1. Core 0.50.0 cut.** tag/main source1cbf50f, exact push CI41466846260 required4PASS, Windows41469153131·동일 TGZ Linux 수용, GitHub Release·도장 완료. npm은 에이전트가 실행하지 않았다.
- [x] **2. GLG npm 게시·registry byte 확인.** GLG가 등록 완료를 알림. registry TGZ SHA25664ca1980…31afba가 accepted core artifact와 cmp0, independently computed sha512/sha1도 registry metadata와 같다. latest0.50.0/repair0.12.8-repair.1 관측.
- [x] **3. Herdr pin·한정 검수·최종 floor.** manifest0.50.0/npm0.50.0 measured integrity·owner docs 갱신. focused10개/registry-installed/실npm swap·복구 모두exit0, 독립 검수B0/D1 한 보정 완료. 동결 FULL981초/0, HEAD/index/tree/dist 전후동일. core tag/npm bytes/SDK는 바꾸지 않는다.
- [ ] **4. commit·main push·공개 ref 수용.** ← CURRENT: 정상 훅 commit/main FF·일반 push/도장, 그 exact SHA의4CI와 기존 raw-install LIVE의 main-ref install/use/activation/deactivation을 측정한다. 공개 ref가 있어야 하는 후자는 push 전 실행했다고 쓰지 않는다. 새 core/plugin tag는 요청되지 않았다.
- [ ] **5. 운영 반영·재시작.** ← PAUSED: GLG의 실제 대상/개별 종료·재개 권한과 새 loaded reader 증거. 자동 Herdr 업데이트/working 시민 restart/retire는 하지 않는다.

# NOW

- **다음 한 걸음:** 원exit/log로 focused10개·registry설치·실npm helper swap/torn복구/역상과 동결 FULL981초/0을 수용했다. D1은 혼동된 previous snapshot을 last Pi1.3 snapshot으로 명확히 했다. commit·main push 뒤 정확 SHA의CI/public-ref 영수증을 읽는다. 이미 완료됐으면 같은 push/검사를 다시 실행하지 않고 단계5의 대상 승인을 기다린다. 이 NEXT 진행 기록은 FULL 종료 뒤 갱신했으며 floor 원subject는 `pre-full.snap`/`full.stdout`(SHA f0362c5c…)로 보존했다. 구현·SDK·검증기 개발을 다시 열지 않는다.
- **직접 지시:** GLG “npm 등록 완료 …/0.50.0, herdr 플러그인 버전 맞추어 커밋 푸시”. 새 태그·npm 재출판·운영 설치 권한을 추가로 만들지 않는다. 현재 branch `chore/herdr-0.50.0`, base core1cbf50f. root README에 published-version 대시보드를 다시 넣지 않는다.
- **pin:** `plugins/herdr/runtime-lock.json` schema2/npm/@junghanacs/entwurf/0.50.0, SRI `sha512-ATV2abFt+/JKRmUj61mwPK0X2IVLqMYAjnIV8QI0N6sqoVieEW13TYk9rHU5M3fT3OzwbWBvChHFPVWoVXLCqw==`. manifest0.45→0.50, Pi SDK1.4.0/host>=1.4.0<1.5 그대로. Pi1.5/#155는 별도 준비다.
- **증거:** `/home/junghan/.local/state/entwurf-releases/herdr-0.50.0-repin/`의 registry metadata/download, focused/registry-installed/npm-runtime 로그와 exit. core artifact는 `~/.local/state/entwurf-releases/0.50.0-1cbf50fe545c/candidate.SHnHCd/`, SHA256 `64ca198067d8ad5265f89a903efdaa3e7946bfe7ba3a83dd27009a878631afba`. 동일 파일의 기존 package consumer 수용은 명시적 재사용이며 새로 실행했다고 하지 않는다.
- **source-specific re-proof:** unchanged registry-installed `scripts/herdr-runtime.mjs`를 sandbox에서 실제 npm0.45→0.50 swap, 수동 seeded torn-swap-with-candidate 복구(실제 kill 아님), exact re-request 무acquire, owned inverse로 관측한다. operator runtime/ledger/캐시는 만지지 않는다. 공개 remote 첫 사용자 여정은 기존 `LIVE=1 ENTWURF_REQUIRE_DOCKER=1 ./run.sh smoke-herdr-raw-install-live --ref <공개 branch>`로 실행하고 resolved SHA를 기록한다. branch가 바뀌면 옛 결과를 새 SHA로 승계하지 않는다.
- **registry-installed Pi:** private HOME/PI/XDG에서 공식 npm 설치·bridge root 확인·7 entwurf model rows·helper byte equality, 모델 turn0. 첫 CLI의 프로젝트 trust 질문에는 Ctrl-C를 보냈지만 그 CLI는 설치를 계속해 exit0으로 끝났다. exit130/중단이나 재실행 성공을 지어내지 않는다. npm audit 경고4개(3moderate/1high)는 이 install의 출력이며 관련성/악용 여부 미분류, 임의 dependency/audit-fix 없음.

# 운영·보존

- checkout carrier를 실제 설치한 host는 npm source로 바꾸기 전에 자기 runtime 절대경로로 deactivate가 필요하다. settled npm-source host는 기존 rebind/ownership 조건을 따른다. plugin activation은 Pi/CC, caller-context Herdr launch는 Pi/CC/PD로 서로 다른 축이다.
- 실제 Oracle CC installed writer는 core make에서 기존 installer로6a03에 맞췄고 새 post-install test citizen6e8f48/strict doctor PASS를 측정했다. Source/Pi compiled output·copied hooks·npm/Herdr pin·already-loaded modules는 서로 다르다. 모든 참여 reader의 새 PID/ownerjoin/전체 dist+SDK 확인 전 전체 rollout으로 쓰지 않는다.
- core 이전 RED, x02, 옛312 소실과 Codex0.162원인 UNKNOWN은 보존. core 원근거/현재 수용 한계는 [make완료6580910928](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6580910928), [v0.50.0](https://github.com/junghan0611/entwurf/releases/tag/v0.50.0), CHANGELOG.
- 정상 hooks/scanner, env-i/privateHOME·PI·XDG5/verifydeps2error/noCI, managed dist 보존. FULL 중 HEAD/index/tree/dist 동결. whole qualification/root74·새 gate/matrix/helper framework·별도 OMP/Codex 재현 없음. SQL/NativeDB전수scan/record삭제/lockrepair/광역cleanup/임의pkill·workingretire 금지. Astra567753/PiOpus150a5e 연락·resume·retire 금지. 기존 receipts/백업/Native memory와 idle Sol2b69db·Native6e8f48 보존.
