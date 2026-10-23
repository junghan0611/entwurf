# NEXT — Herdr 0.41.1 snapshot (버전 쌍 맞추기) → 담당자 문서·홈페이지

core 0.41.1은 출하됐고 npm `latest`도 0.41.1이다. 이 snapshot은 Herdr plugin을 그 registry bytes에 다시 pin해서 core와 버전 쌍을 맞춘다. core `v0.41.1` tag와 그 bytes는 바꾸지 않는다. 원장은 [#148](https://github.com/junghan0611/entwurf/issues/148#issuecomment-6353660427) thread다.

# RAIL — 현재 좌표

- [x] **1. core 0.41.1 출하와 npm pin 로컬 증거.** `v0.41.1` = `6a88436`, GitHub release, main push CI 4 job green. npm `latest` 0.41.1이고 registry tarball은 수용된 Windows 포함 후보와 byte-equal이다. 누가 publish를 실행했는지는 관측하지 않았다. sandbox `pi install`(U3)과 sandbox global npm install의 installed `check-bridge`(9 tool), registry-shipped `herdr-runtime.mjs`로 0.41.0 → 0.41.1 runtime swap·torn-swap 22/22. model 턴은 없다.
- [ ] **2. snapshot branch `chore/herdr-npm-0.41.1`** ← CURRENT: runtime-lock을 npm 0.41.1 + 측정한 sha512로, manifest를 0.41.0→0.41.1로 바꿨다. plugin README·root README·setup guide의 설치·출판 문구를 출하 상태로 고치고 CHANGELOG에 snapshot 절을 넣었다. 조율자 경유 읽기 검토를 기다린다.
- [ ] **3. commit → push → 그 public ref의 raw install journey → 같은 SHA의 frozen FULL·exact-SHA CI 4 job → CalVer tag `v2026.10.23-herdr.0.41.1` + GitHub release `--latest=false`.** GitHub Latest는 core `v0.41.1`으로 남는다. 결과는 외부 ledger에 기록하고 이 SHA를 영수증 때문에 다시 움직이지 않는다.
- [ ] **4. 담당자 문서·홈페이지.** Herdr snapshot이 닫힌 뒤에만 시작한다.

# NOW

- **범위:** 버전 쌍과 runtime acquisition만 다룬다. Pi 1.4 업그레이드 요구, npm 0.41.0 → 0.41.1 같은 source rebind, checkout 후보 → npm의 명시적 deactivate를 구분한다. Herdr를 통한 retire·resume, pi-durable·DB 이관, model 인증은 측정하지 않는다.
- **아직 측정하지 않음:** public ref의 install/use/deactivate journey, push된 SHA의 CI, frozen FULL, tag ref install, Herdr relocation, real-kill recovery.

# GUARDRAILS

- npm publish·dist-tag 변경, core 재publish·새 core SemVer는 하지 않는다. operator Herdr install·runtime·pane·daemon·기존 시민, 다른 기기는 건드리지 않는다.
- 모든 pnpm/commit/push hook에 `pnpm_config_verify_deps_before_run=error`. deps 오류면 install/repair/우회 없이 중단. unsafe override/force push 금지.
- 후보를 freeze한 뒤 worktree나 index가 움직이면 그 receipt는 무효다. records/native transcript/DB/색인, 후보와 사본, 증거는 지우지 않는다.
- `.agent-reports/.envrc` 보존(루트 `.envrc`는 재생성하지 않는다). 넓은 /tmp 청소/프로세스 sweeper/자동 whole-floor rerun 금지.
