# NEXT — Herdr 0.41.0 snapshot (버전 쌍 맞추기) → #148 pi 1.4.0

core 0.41.0은 출하됐고 npm `latest`도 0.41.0이다. 이 snapshot은 Herdr plugin을 그 registry bytes에 다시 pin해서 core와 버전 쌍을 맞춘다. core `v0.41.0` tag와 그 bytes는 바꾸지 않는다. #147 원장은 [#147](https://github.com/junghan0611/entwurf/issues/147) thread다.

# RAIL — 현재 좌표

- [x] **1. core 0.41.0.** `v0.41.0` = `5349392`. GitHub release는 Latest다. exact CI 39718569526(4 job), Windows preview 39719422006, 후보 sha256 `2bd03ba9…7ad`. core 0.41.0은 npm에 게시돼 있다(published 2026-10-22T04:37:02.853Z) — registry로 확인한 사실이고, 누가 실행했는지는 관측하지 않았다. registry tarball은 수용된 후보와 byte-equal이다.
- [x] **2. registry 증거.** 본검증은 `h1-r1/`이다: carrier 정리(`PI_`·`ENTWURF_`·`CLAUDE`·`CODEX_HOME`·`TMUX`·`HERDR_`)를 보강한 뒤 branch worktree(HEAD `5349392` + 미커밋 5파일)에서 돌렸고, 쓰는 checkout 입력은 불변인 resolver 하나다. 초기 `h1/`(clean HEAD, `TMUX`·비identity `PI_*` 잔존)은 그 한계와 함께 보존하며 본 격리 수용으로 쓰지 않는다. 내용: sandbox `npm install -g`와 installed `check-bridge`(9 tool), `pi install` 뒤 `--list-models entwurf`. model 턴은 없다. C3 runtime swap은 registry-shipped `herdr-runtime.mjs`로 돌렸다. 0.40.0은 그 자신의 committed lock(`036e268`)에서 seed했고, 0.41.0 쪽은 이 branch의 새 npm lock을 썼다. 결과는 22/22다.
- [x] **3. pin commit `cfdae0e`.** runtime-lock을 npm 0.41.0 + 측정한 sha512로, manifest를 0.40.0→0.41.0으로 바꾸고 CHANGELOG에 snapshot 절을 넣었다. plugin README의 check-bridge 동사 수를 고쳤다. 읽기 검토 B0/D0, frozen FULL exit 0, main push, exact CI 39734649815 4 job green.
- [ ] **3a. C4 scaffolding 보정** ← CURRENT: `cfdae0e`의 첫 public-ref C4는 RED였다(container Claude Code 2.1.278 < floor 2.1.306, 제품의 정상 거절). branch `herdr-smoke-claude-floor`에서 smoke의 Claude pin을 `entwurf.claudeCodeFloor`에서 파생한다. 첫 C4 영수증은 `.tmp-verify/herdr-0.41.0/c4/`에 보존하고, 새 후보·새 image의 재측정은 별도로 기록한다.
- [ ] **4. (3a의) frozen FULL → commit → ff main push → exact-SHA CI 4 job → public `main` ref raw install journey(C4 재측정) → CalVer tag `v2026.10.22-herdr.0.41.0` + GitHub release `--latest=false`.** GitHub Latest는 core `v0.41.0`으로 남는다. 그 뒤 홈페이지 설치 명령·버전 경계 hunk를 조율자와 맞춘다.
- [ ] **5. #148 pi 1.4.0 반영·안정화.** Opus2의 선행 검토가 별도 이슈에 있다.

현재 좌표: 1–3 완료 → 3a 보정 → 4.

# NOW

- **review 대상:** `plugins/herdr/runtime-lock.json`, `plugins/herdr/herdr-plugin.toml`, `plugins/herdr/README.md`(한 문단), `CHANGELOG.md`(`## v2026.10.22-herdr.0.41.0` 절), 이 `NEXT.md`. 근거 경로는 `.tmp-verify/herdr-0.41.0/`이다(본검증 `h1-r1/`, 초기 원장 `h1/`, `c3/`, `focused/`).
- **범위:** 버전 쌍과 runtime acquisition만 다룬다. Herdr를 통한 retire·resume, 원격 pair, model 인증은 측정하지 않는다.
- **C4 (push와 CI 뒤):** `LIVE=1 ./run.sh smoke-herdr-raw-install-live --ref main`을 ambient identity carrier를 지운 상태로 돌리고 fp before == after를 확인한다. tag ref install, 실제 relocation, real-kill recovery, model 턴은 주장하지 않는다.
- **prepare 관측(보존):** `smoke-entwurf-chain-live` world `/tmp/entwurf-chain-vx90gR`가 PASS 뒤에도 남았다 — `finally`가 children만 끝내고 world를 지우지 않는다(`smoke-entwurf-chain-live.ts:474–483`). 같은 gate의 hop2 기본값 `openai-codex/gpt-5.6-luna`는 MODELS curated 목록과 어긋난다. 둘 다 Observation이고 이 snapshot에서 고치지 않는다.
- **팀 책갈피:** 실제 명부는 루트 `team.json`(gitignored), 공개 예시는 `team.json.example`(가짜 ID). record가 이기며 생존은 `entwurf peer-facts`로 재관측한다.

# GUARDRAILS

- npm publish·dist-tag 변경, core 재publish·새 core SemVer는 하지 않는다. operator Herdr install·runtime·pane·daemon·기존 시민, 노트북 pull/install/sync는 건드리지 않는다. pi 1.4/#148 SDK·catalog·DB 변경, whole qualification BODY는 0이다.
- 모든 pnpm/commit/push hook에 `pnpm_config_verify_deps_before_run=error`. deps 오류면 install/repair/direct-binary 우회 없이 중단. 정상 scanner/hooks/exact staging, unsafe override/force push0.
- 후보를 freeze한 뒤 worktree나 index가 움직이면 그 receipt는 무효다. core tag, 수용된 후보 원본과 사본, records/native transcript/DB/색인, 증거는 지우지 않는다.
- `.agent-reports/.envrc` 보존(루트 `.envrc`는 재생성하지 않는다). 넓은 /tmp 청소/프로세스 sweeper/자동 whole-floor rerun0.
