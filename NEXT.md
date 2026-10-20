# NEXT — Herdr 0.40.0 snapshot (버전 쌍 맞추기)

core 0.40.0은 출하됐고 npm `latest`도 0.40.0이다. 이 snapshot은 Herdr plugin을 그 registry bytes에 다시 pin해서 core와 버전 쌍을 맞춘다. core `v0.40.0` tag와 그 bytes는 바꾸지 않는다. 승인 원장은 [#107](https://github.com/junghan0611/entwurf/issues/107) thread다(thread가 body보다 우선). core cut의 수용 기록은 [#107 6281283301](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6281283301)에 있다.

# RAIL — 현재 좌표

- [x] **1. core 0.40.0.** `v0.40.0` = `1f7020a`. GitHub release는 Latest다. exact CI 39351755714(4 job), Windows preview 39352739774, 후보 sha256 `4a6906ac…fa55`. npm publish는 운영자가 직접 했다(published 2026-10-20T01:49:33Z). registry tarball은 수용된 후보와 byte-equal이다.
- [x] **2. registry 증거.** registry 설치(H1)는 branch를 만들기 전, clean HEAD `1f7020a`에서 돌렸다. sandbox 안에서 `npm install -g`와 installed `check-bridge`, `pi install` 뒤 `--list-models entwurf`를 돌렸다. model 턴은 없다. runtime swap(C3)은 registry-shipped `herdr-runtime.mjs`로 돌렸다. 0.39.0은 그 자신의 committed lock(`ba46dec`)에서 seed했고, 0.40.0 쪽은 이 branch의 새 npm lock(sha256 `67504fb0ad55`)을 썼다. 결과는 22/22다. 그래서 snapshot 입력이 모두 branch 밖에 있는 것은 아니다.
- [ ] **3. snapshot branch `feat/herdr-0.40.0`** ← CURRENT: runtime-lock을 npm 0.40.0 + 측정한 sha512로, manifest를 0.39.0→0.40.0으로 바꾸고 CHANGELOG에 snapshot 절을 넣었다. focused gate 10개는 초록이다. scoped review(Opus2·Grok, 조율자 경유)를 기다린다.
- [ ] **4. commit → ff main push → exact-SHA CI 4 job → public `main` ref raw install journey(C4) → CalVer tag `v2026.10.20-herdr.0.40.0` + GitHub release `--latest=false`.** GitHub Latest는 core `v0.40.0`으로 남는다.

현재 좌표: 1–2 완료 → 3 review 대기 → 4.

# NOW

- **review 대상:** `plugins/herdr/runtime-lock.json`, `plugins/herdr/herdr-plugin.toml`, `CHANGELOG.md`(`## v2026.10.20-herdr.0.40.0` 절), 이 `NEXT.md`. 근거 경로는 `.tmp-verify/herdr-0.40.0/`이다(`registry/`, `h1/`, `c3/`, `focused/`).
- **범위:** 버전 쌍과 runtime acquisition만 다룬다. 원격 pair·platform·model 인증이 아니다. Herdr를 통한 원격 전달, SSH, 두 번째 host는 측정하지 않는다.
- **pnpm guard (이 host의 모든 local pnpm·hook 실행에 적용):** 실행 앞에 `pnpm_config_verify_deps_before_run=error`를 붙인다. deps가 stale이면 install하지 않고 ERR로 멈춘다. 자동 repair나 retry는 하지 않는다. 기록: `.tmp-verify/release-0.40.0/incident-pnpm-autoinstall/`.
- **local에서 돌리지 않는 것:** `check-herdr-plugin-build`와 `check-herdr-sandbox`는 operator의 herdr를 돌리므로 local에서 실행하지 않는다. pushed SHA의 CI FULL floor가 맡는다.
- **C4 (push와 CI 뒤):** `LIVE=1 ./run.sh smoke-herdr-raw-install-live --ref main`을 ambient identity carrier를 지운 상태로 돌리고 fp before == after를 확인한다. 형식은 `.tmp-verify/herdr-0.39.0/c4/run-raw.sh`를 따른다. tag ref install, 실제 relocation, real-kill recovery, model 턴은 주장하지 않는다.

# GUARDRAILS

- npm publish, dist-tag 변경, operator Herdr install·runtime·pane 변경, operator upgrade는 하지 않는다. core tag와 source 0.40 bytes는 고치지 않는다.
- local whole FULL·BODY, local Herdr build·sandbox, 노트북 SSH, A 쪽 traffic, 숨은 model 턴은 하지 않는다.
- 후보를 freeze한 뒤 worktree나 index가 움직이면 그 receipt는 무효다. 수용된 후보 원본과 사본, 증거, host-proof prefix는 지우지 않는다.
