# NEXT — #78 WSL2 first stage settled in source; landing CI pending → Windows-native probe

WSL2 실험 CI 증거 문서·trigger와 #146 closeout 문서를 source에 정착했다. main FF push와 그 exact-SHA CI·natural WSL run 수용은 아직이다. 그 결과를 기록한 뒤 새 native branch에서 제품 미설치·무모델 Windows capability probe 계약 하나로 간다. 승인 원장: [#78 phase decision](https://github.com/junghan0611/entwurf/issues/78#issuecomment-6245990618)과 그 뒤 thread(thread가 body보다 우선).

# RAIL — 현재 좌표

- [x] **1. core 0.38.1 release · #146 closed.** `v0.38.1` = `6c3c6f4`, exact push CI four jobs GREEN, manual BODY 979/979 killed. #146 재진입 질문은 `docs/durable-native-support.md`의 `#146 decision closeout and re-entry`.
- [x] **2. WSL2 cells 1+2.** `b03d646`, WSL run 39098773010 + exact-SHA ci 39098773011 GREEN. [Measured receipt](https://github.com/junghan0611/entwurf/issues/78#issuecomment-6245947301). BASELINE WSL2 두 행에 기록.
- [x] **3. WSL2 정착 source (이 commit).** BASELINE/VERIFY/README/CHANGELOG 기록 + `.github/workflows/wsl2-install-surface.yml` trigger = main push 중 이 파일 변경 + `workflow_dispatch`. 릴리스 없음.
- [ ] **4. main FF push 수용** ← CURRENT: main 한 번만 push. exact-SHA `ci.yml` 네 job과 workflow path 변경으로 생기는 natural WSL run의 결과를 #78 thread에 기록한다. WSL run이 생기지 않으면 그 사실을 기록하고 hold — 자동 dispatch·빈 commit 없음.
- [ ] **5. Windows-native capability probe:** 4의 결과 기록 뒤에만 시작. 새 branch에서 작은 contract + 독립 review 먼저, 그다음 실험 workflow 하나와 feature-branch CI trial 1회.

현재 좌표: 1–3 완료 → 4 landing CI 수용 → 5 contract.

# NOW

- **Next:** 4의 push 결과(ci 네 job, WSL natural run)를 #78에 기록한다. 그 뒤 수용된 main에서 새 native branch를 열고 probe contract를 쓴다. 출발 자료 `.tmp-verify/78-native-20261018/OPUS2-NATIVE-FIRST-RAIL.md`(b2a2c362…). PowerShell 아래 host native Node 24.18.1에서 `process.platform === "win32"`와 host filesystem을 증명한다(WSL/Git Bash 실행이 아님). flags/file metadata·link, pipe, process primitive를 관찰하고, 단정은 선언한 관찰만 검사한다(Windows 의미론을 추측해 기대값을 쓰지 않음). symlink 권한 부재(optional)와 positive capability를 구분한다.
- **Probe가 하지 않는 것:** Entwurf 설치, 제품 변경, auth/vendor/model turn, O_NOFOLLOW guard 대체, Entwurf 인증. post-open file identity 후보는 미증명이며 O_NOFOLLOW 대체가 아니다. start-key 필요성은 backend별·미확인.
- **권한:** native probe workflow 하나 + feature-branch CI trial 1회까지 승인됨. 그 뒤 main/release/native 제품 구현은 새 결정. blind CI retry, 숨은 dispatch, 빈 commit 없음.
- **WSL2 workflow:** non-voting. release oracle은 `ci.yml`의 네 required job만 읽는다(변경 없음). 제품 drift는 수동 dispatch로 측정하고, 넓은 path filter 승격(C)은 별도 결정.
- **#146 운영 경계:** 0.37–0.38 프로세스의 forced `backgroundTokens: 0`은 설치만으로 바뀌지 않는다. GLG 수동 restart를 자동 실행하지 않는다.
- **Herdr:** main lock은 미발행 후보 때의 closed `herdr-checkout`. published 0.38.1 npm re-pin/snapshot은 별도 요청 사항이며, 그 전 기존 npm 활성화 host에서 main 기반 재설치/update를 하지 않는다(`activation-artifact-source-drifted`).
- **ACP/#142:** PAUSED, 0.90 유지.

# RECEIPTS

- WSL2: cell 1 RED `afcda79`/39096827653(native curl path, MSYS scope) 보존 → `f0da4b9`/39097392671 GREEN → `b03d646`/39098773010 GREEN. 보고·contract·raw log: `.tmp-verify/78-wsl2-20261018/`(ignored, 이 host 전용). 정착 계획 `landing/LANDING-PLAN.md`(51d9ffbb…), 인계 전 원본 `landing/handover-preserve/`.
- 0.38.1: [release evidence](https://github.com/junghan0611/entwurf/releases/tag/v0.38.1), `.tmp-verify/release-0.38.1/`(accepted-artifact 사본 포함).
- 증명 안 된 것: WSL2 physical user machine, non-pi harness, delivery, vendor turn, fresh/resume; native Windows는 UNSUPPORTED.

# GUARDRAILS

- No npm publish/tag/release, vendor login/model turn, operator rewiring/restart, credential 접근, O_NOFOLLOW/record guard 완화, native 제품 구현, Windows SDK/process framework.
- Local whole BODY와 operator `check-herdr-plugin-build`/`check-herdr-sandbox` 금지. Operator DB/meta/transcripts, 기존 process, unrelated branch, 보호 artifact 건드리지 않음.
