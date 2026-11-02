# NEXT — #153/#157 landing → 0.50.0 → 운영 반영·재시작

# RAIL — 현재 좌표

- [x] **1. #153 입구·#157 대칭성 구현/문서 checkpoint.** d189ff3, 요청한 push·도장·exact-SHA CI41423914510 required4jobs PASS.
- [ ] **2. main landing.** ← CURRENT: GLG 직접 승인. branch NEXT를 없앤 handoff commit → main FF·일반 push → 새 HEAD의 exact-SHA CI.
- [ ] **3. 0.50.0 prepare.** 오푸스 → Terra 순서로 준비·근거 대조, 그 뒤 Fable 검수. 버전/기록·최종 FULL/필수 LIVE는 자기 후보에서 측정한다.
- [ ] **4. 배포·운영 반영·재시작·관측.** ← PAUSED: prepare 수용과 make/publish 권한·정확한 설치 대상/안전조건이 먼저. 소스만 바뀌었다고 완료가 아니다.
- [ ] **5. 새 Pi Sol의 문서/목적 감수.** ← PAUSED: 앞 단계 뒤 GLG가 마무리됐다고 할 때 fresh. 구현 요약/코드 검수가 아니라 #153/#157의 인간 고민이 제품 설명에 표현됐는가를 본다.

# NOW

- **직접 승인:** GLG “main으로 올리고 0.50.0 준비하자. 운영본에 반영후 재시작하는것이 중요하다…동시에 던지지말고 오푸스랑 terra랑 릴리즈 준비하고, fable한테 검수 받고 나서…pi sol을 새로…153 157에서 내가 고민한것들이 표현되었는가”. 노트북은 꺼져 있으므로 연락/SSH/재개하지 않는다.
- **다음:** 정상 훅의 작은 handoff commit으로 이 root NEXT를 최신화하고 branch NEXT를 제거, main에 FF한다. source d189ff3와 달라지는 부분은 handoff뿐이지만 새 SHA CI를 받는다. main에서도 개발은 새 release branch에서만 한다.
- **역할/순서:** main68bd94 coord/landing/commit·push·증거. Opus915040에게 먼저 release·운영 대상 점검204e5a를 보냈다. 그 checkpoint 뒤 기존 live Terra a20739가 교차 준비, 이어 Fable dff8a1가 검수한다. 한꺼번에 뿌리거나 형제가 독자 새 형제를 만들지 않는다. Sol은 지금 생성하지 않는다. 169dd1는 이전 CLI/docs 작업 완료 상태.
- **권한:** 현재 GO는 main 반영과 prepare0.50.0이다. `.claude/skills/entwurf-release/SKILL.md`의 land/prepare/make/publish는 각기 별도 권한. tag/GitHubRelease/npm/운영 설치를 prepare라는 이름으로 미리 실행하지 않는다. 준비된 정확한 artifact와 운영 대상·재시작/회복선을 제시해 다음 GO를 받는다.
- **안전:** 실제 LIVE는 일반 prepare의 필수 축이지만 기존 운영 data 변이 제한을 면제하지 않는다. Opus가 기존 gate의 실 HOME/vendor 영향과 예산·전제부터 명시한다. 안전조건 미해결이면 그 축에서 STOP; MUST SKIP/FAIL을 PASS로 바꾸지 않는다. scripts-off version-sync 예외는 release skill P3 그대로, SDK/auth/PATH/로그인/설치 수선은 임의 확장하지 않는다.

# 읽을 곳 — 요약보다 원천

- [#153](https://github.com/junghan0611/entwurf/issues/153), [#157](https://github.com/junghan0611/entwurf/issues/157): thread가 live contract. 통합 `entwurf` 입구, Pi/Claude Code/pi-durable × tmux/Herdr 기본 사용 대칭, install route와 placement의 분리, skill/팀/remote 안내, 존재의 동등성과 좁은 드라이버라는 GLG의 목적을 Sol에게 원문으로 읽힌다. 작업 완료 목록을 정답 틀로 주지 않는다.
- [4번 구현/검증6573387199](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6573387199), [5번 문서6573733842](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6573733842), [d189exact-CI6574387591](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6574387591). BASELINE/VERIFY와 release skill이 실제 수용 경계를 소유한다.
- `/tmp/e157h/release-050/`는 새 lane 근거. 이전 `/tmp/e157h/stage4/`, `/tmp/e157h/s4-cli-169/stage5/`와 private Native 기록은 보존한다. 이후 operating source/npm/plugin pin/loaded process를 구분하고 모든 참여 reader의 coherence를 측정해야 rollout 완료다.

# 운영 사건·미측정 — green으로 지우지 않기

- H2 운영 Claude launcher가 fixture의2.1.316을 가리킨 사고는 GLG 승인 후 main이 원래 `~/.local/share/claude/versions/2.1.316`으로만 복구, link/realpath/SHA55cd 확인했다. N2 창 안에서 공유 vendor store의 옛2.1.312가 사라졌다(312/314/316→314/316). active316은 정상이나 writerPID/무해함/312의 실제 사용유무는 미측정; 이 작업에 복구 사본·옛SHA가 없다. 임의 다운로드/복구/fixture 삭제 없음.
- #67 launcher fence는 whole mutable vendor store를 보호하지 않는다. N1/N2 각 새1시민·2제출턴 승인은 소진됐다. 새 LIVE의 명명된 범위/안전조건 없이 같은 실험을 반복하지 않는다. working 시민/자기 coordinator/기존 app-server를 임의 종료하거나 전체 Herdr 서버 재시작으로 형제를 끊지 않는다.
- stage4 workSurface1075a5c8… PARTIAL94/14/12/44/17/20와 FULL1016초는 당시 snapshot의 증거; 후속 문서/릴리즈 후보에 승계하지 않는다. d189의 push CI4PASS는 별도 최신 source/package 증거이며 Native/LIVE/registry/운영 수용이 아니다. whole qualification/root74·검증기 개발 재개 없음.
- 과거3번 991초/XDG5와old978초/XDG4, 중단/실패 probe·unknown exit는 원기록 보존. PD 실제n1은82b5ec36, 최신candidate LIVE가 아니다. fixture 기록/Native database/metadata를 삭제·SQL 직접 열기·전수scan·lock repair하지 않는다.

# 금지선

- 이 checkout의 branch만; 개발 worktree/clone 금지. Offline env-i/privateHOME·PI·XDG5/verifydeps-error2/noCI, managed build·정상 hooks/scanner. 긴 명령은 scope/time/이유를 먼저 고지한다. 실제 오류는 raw·관측 exit로 STOP, 자동 수선/맹목 retry 없음.
- **Astra567753 연락 금지 / PiOpus150a5e 연락·resume·retire 금지.** notebook b22677 오프라인, 연락 금지. working 시민의 retirement는 개별 직접 요청 없이는 금지. `g3-pd-birth-r1/raw/s06-ss-all.tmp` 격리 유지. Sol은 나중 승인 신호까지 만들지 않는다.
