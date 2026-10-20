# NEXT — core 0.40.0 prepare (다리는 건넜고, 질문은 남았다)

core 0.40.0은 #107의 "운영자가 선언한 한 쌍의 원격 전달"을 출하한다. 사람이 다리를 놓았고, 그 다리 건너 기존 형제에게 보낸 메시지가 한 번 돌아왔다. 신뢰·가시성 질문은 해결이 아니라 함께 싣는다. 승인 원장은 [#107](https://github.com/junghan0611/entwurf/issues/107) thread다(thread가 body보다 우선). 이 컷의 개시는 [#107 6279426845](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6279426845)에 기록돼 있다.

# RAIL — 현재 좌표

- [x] **1. core 0.39.0 + Herdr 0.39.0 snapshot.** `v0.39.0` = `551402c`(npm `latest` 0.39.0). `v2026.10.19-herdr.0.39.0`은 GitHub snapshot release로 끝났다.
- [x] **2. #107 구현과 문서.** `a7aaac7` 수신, `3afbfb6` 송신·표시, `d0cd075` 설치 증거, `e632294` branch 인계, `bddc8bd` owner 문서, `6ac477d` branch NEXT 퇴역, `c381a80` 원격 오류 header 보정(외부 review #107 6279637367, PARTIAL 38/38 receipt `c8d59ba79b6a`), `de0bf03` 원칙 문서 `docs/remote-sibling-principles.md`. 첫 실왕복은 `e632294`에서 했다(2026-10-20).
- [x] **3. 0.40.0 prepare.** 이 문서를 담은 release-prep commit(4 paths). non-static LIVE r1: MUST 23/23, BEHAVIOR 1/1 (2026-10-20 09:40–09:44 KST; head `de0bf03` + metadata `22d0a8b856ae`; receipt `.tmp-verify/release-0.40.0/live-r1/`). static floor는 make에서 그 SHA의 CI가 맡는다.
- [ ] **4. make** ← CURRENT: GLG의 make GO를 기다린다. main을 prepared SHA로 ff → push → exact-SHA CI 4 job → M3w preview run → 후보 tgz 수용(remote-pair installed gate 포함) → tag·GitHub release.
- [ ] **5. publish** ← PAUSED: 별도 GO가 필요하다. 수용된 bytes만 publish하고 dist-tag는 명시한다. Herdr re-pin은 그 뒤 별도 snapshot이다.

현재 좌표: 1–3 완료 → 4 make GO 대기 → 5 보류.

# NOW

- **make 순서 (GO를 받은 뒤에만):** 모든 pnpm·hook 실행에 guard env를 붙인다. 순서는 다음과 같다.
  1. `git switch main && git merge --ff-only feat/107-remote-pair`로 main을 prepared SHA에 맞춘다. ff가 안 되면 멈춘다.
  2. 평범한 `git push origin main`을 한다.
  3. `bash .claude/skills/entwurf-release/scripts/verify-exact-ci.sh <sha> wait`로 CI 4 job을 확인한다.
  4. 같은 SHA로 `windows-native-preview.yml`을 dispatch한다(M3w). 그 run의 `win32-preview-tgz`를 받아 SHA256SUMS와 Windows가 출력한 install hash를 대조한다.
  5. 받은 tgz로 Linux `check-install-container`와 `./run.sh check-remote-pair-installed --tgz <abs>`를 돌린다.
  6. §3.4 Claude host installed doctor를 돌린다. operator 쪽 wiring 계획을 먼저 세운다.
  7. tag와 GitHub release를 만든다.
  - npm publish는 별도 GO가 필요하다.
- **integration 순서(branch-local prepare):** prepare는 `feat/107-remote-pair`에서 한다. branch NEXT 삭제는 별도의 docs commit `6ac477d`로 끝냈다(push 없음). release-prep commit(`package.json`, `CHANGELOG.md`, `NEXT.md`, `plugins/herdr/runtime-lock.json`)은 필요한 precommit acceptance와 결정이 끝난 뒤에 만든다. floor 전에는 만들지 않는다. lockfile은 `pnpm install --lockfile-only --ignore-scripts`를 돌려도 바뀌지 않았다. make GO가 나면 `git switch main && git merge --ff-only feat/107-remote-pair`로 main을 정확히 prepared SHA로 옮긴다. 그러면 SHA identity와 그 SHA의 CI가 보존된다. ff가 실패하면 멈추고 다시 review한다. rebase나 추가 SHA는 만들지 않는다. 지금 local main은 움직이지 않는다.
- **Herdr lock:** 미발행 후보에서는 0.38.1·0.39.0 선례대로 closed `herdr-checkout` source로 되돌린다. runtime-bootstrap gate는 npm-source lock이 checkout의 package version과 같기를 요구한다(`scripts/check-herdr-runtime-bootstrap.ts:517` `npmCoherent`, assertion `:545`). 그래서 npm 0.39.0 pin은 package 0.40.0과 함께 둘 수 없다. 0.38.1의 첫 prepared SHA가 이 이유로 CI RED였다. manifest 버전과 registry pin은 바꾸지 않는다. npm re-pin은 publish 뒤 별도 snapshot이다.
- **pnpm guard (이 host의 모든 local pnpm·hook 실행에 적용):** 실행 앞에 `pnpm_config_verify_deps_before_run=error`를 붙인다(예: `pnpm_config_verify_deps_before_run=error git commit …`). deps가 stale이면 install하지 않고 ERR로 멈춘다. 그때는 자동 repair나 retry를 하지 않는다. 이 조치가 필요해진 계기가 있다: 6ac477d를 commit할 때 hook의 `pnpm lint`가 pnpm 11 기본값(`verifyDepsBeforeRun` 자동 install)으로 operator node_modules에 install을 돌렸고, 그 install의 `prepare`가 operator dist를 재빌드했다. 재빌드된 dist 내용은 같았다. 기록: `.tmp-verify/release-0.40.0/incident-pnpm-autoinstall/`. repo나 global pnpm 설정과 hook은 바꾸지 않았다.
- **operator bridge build (승인 1회, #107 6280460022):** 2026-10-20T00:33:24–30Z에 `bash scripts/with-dist-lock.sh bash scripts/build-bridge.sh`를 실행했다(pnpm 없음), rc 0. 결과 dist 87 files는 현재 후보를 private emit한 결과와 87/87 같다(manifest `ecda4ff194da`). 이전 dist와는 helper 2개(`remote-pair-send.js`, `scripts/remote-pair-receive.js`)만 다르다. source seal은 빌드 전후가 같다. 기록: `.tmp-verify/release-0.40.0/operator-build/`. 이미 실행 중인 bridge(B coordinator 포함)는 이전 모듈을 쓰고 있다. 새 test process는 이 build 뒤에 시작해야 한다.
- **static floor:** 이 operator host에서 local `check:full`은 돌리지 않는다(FULL에 Herdr build/sandbox가 들어 있어 이 host에서 금지). static floor 전체는 prepared SHA의 exact push CI 4 job(`check`, `install-surface`, `artifact-consumer`, `macos-install-surface`)이 진다. 그전까지 초록을 주장하지 않는다. qualification body는 release axis가 아니다(#144).
- **LIVE (§3.3):** `release_gate()` 본문은 0.39 후보 `32fcc1c`와 byte-identical이다(awk 추출 sha256 `486ff5825ea2`). 그래서 0.39가 쓴 방식, 즉 static step만 빼고 나머지 step을 그대로 도는 일회성 driver(`.tmp-verify/release-0.39.0/live-r2/` 형식)를 재사용할 수 있다. 이것은 aggregate `--cut` PASS가 아니며, static은 CI가 맡는다.
  - 전제조건:
    - Codex: test가 소유한 app-server를 자기 tmux session A에 띄우고, pane_pid와 start ticks를 receipt로 남긴다. app-server session A와 gate session S는 서로 달라야 한다. launch dir은 이미 trusted로 등록된 `/tmp/entwurf-codex-fresh-live`(`~/.codex/config.toml:41-42`, 읽기만 하고 고치지 않는다).
    - **이번 cut의 model tier(조율자가 선택, MODELS.md 2026-09-30·10-14 기준):** Codex `gpt-6-luna`, Pi `openai-codex/gpt-6-luna`. VERIFY 기본값 `gpt-5.6-luna`은 curated selector에 없다. 그래서 기본값 변경이나 0.39 PASS 이월이 아니라 이 tier로 새 receipt를 받는다. vendor가 이 model을 거부하면 그 축에서 멈춘다. 다른 model로 바꾸지 않는다.
    - 모델 선택은 MODELS.md의 구독 rail로만 한다. OpenRouter는 쓰지 않는다.
  - **GLG 결정 필요 축 (source 읽음, 실행 안 함):** 기존 operator peer를 고르는 step은 없다. 모든 step이 test 소유 scratch를 만든다.
    - visible tmux:
      - mux-lifecycle: fresh, 그다음 `closeWindow`로 dormant, 그다음 visible resume. `smoke-mux-lifecycle-live.ts:16-23`.
      - omp-fresh, codex-fresh, pi-durable-fresh: public `entwurf_fresh_call`. codex는 자기 window를 kill한다(`smoke-codex-fresh-live.ts:323`).
      - omp-receive: detached tmux session의 omp TUI. `smoke-omp-receive-live.ts:56,167`.
    - headless 실제 model 턴:
      - pi `--mode rpc` resident: v2-matrix, acp-socket-citizen, acp-bundled-mcp, acp-v2-send, chain.
      - pi `--mode … -p` one-shot: acp-provider, carrier-augment, mcp, skill.
      - ACP adapter를 직접 spawn: raw-turn, overlay, memory-containment, session-reuse(2턴, `smoke-acp-session-reuse-live.ts:7,23`).
      - `claude -p` 2회(첫 턴과 `--resume`): claude-native-resume. `smoke-claude-native-resume-live.sh:114,181`. chain hop1(`smoke-entwurf-chain-live.ts:362`)도 `claude -p`다.
    - 0-token: RGG MUST(`SMOKE_RGG_POSITIVE=0`), acp-rgg(같은 스크립트를 ACP target에 돌림), check-bridge, doctor-pi-provider. RGG BEHAVIOR는 1 turn이다.
    - 개수(24 step): visible 5, headless 실제 model 턴 14, 0-token 4, BEHAVIOR 1.
    - operator scope: ACP overlay는 realDir을 operator `~/.claude`로 둔다(`smoke-acp-overlay-live.ts:32-34`, `raw-turn:22-24`). claude-native-resume은 정상 Claude transcript를 쓴다(`.sh:13-15`). omp는 operator의 omp config와 model을 쓴다(`smoke-omp-receive-live.ts:121,149`).
    - **GLG 결정 (2026-10-20, 조율자 경유, [#107 6280460022](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6280460022)):** G1은 YES다. test 소유 scratch에 한해, headless 실제 model 턴과 자기 visible close·resume을 release 검증 용도로 허용한다. 기존 user·OFF peer는 건드리지 않는다. 운영 원칙의 예외가 아니다. G2도 YES다. static FULL은 exact prepared CI가 맡고, non-static 23 MUST + 1 BEHAVIOR는 일회성 driver로 돌린다(aggregate `--cut` PASS가 아니다). 모든 step 결과를 기록하고 MUST에는 SKIP·FAIL이 없어야 한다.
- **§3.4 Claude:** 설치된 0.40.0 Claude host에서 새 post-install 세션을 열고 strict `doctor-meta-bridge`를 돌린다. 운영자가 할 일이다.
- **§3.7 agy (G3):** GLG 결정(2026-10-20, "응 승인 agy는 빼고가바", [#107 6280460022](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6280460022))에 따라 **이번 0.40.0 cut에 한해 제외**한다. 미측정이고 PASS가 아니다. 0.39 예외를 이월한 것이 아니고 상시 waiver도 아니다.
- **remote-pair 설치 증거:** M3w로 받은 바로 그 후보 tgz에 대해 `./run.sh check-remote-pair-installed --tgz <abs>`를 server에서 돌린다. 노트북도 SSH도 모델도 필요 없다. 이전 11/11(manual producer tgz `023cc6e`)은 0.40 증거가 아니다.
- **배포 parity:** `pi-extensions/lib/meta-session.ts`는 v0.39.0 이후 바뀌지 않았다. 따라서 omp receiver와 Claude meta-bridge 재배포는 이 컷의 LIVE 전제가 아니다.
- **operator 상태:** 두 호스트에 pair 파일이 선언된 채 idle이다. 노트북은 닫혀 있다. 재시험, 노트북 접근, OFF wake는 하지 않는다.

# RECEIPTS

- #107: 첫 LIVE [6278665895](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6278665895), branch 인계·CI [6260030079](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6260030079), 0.40 개시 [6279426845](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6279426845).
- server-only: `.tmp-verify/107-live-first/`, `.tmp-verify/107-b-apply/HANDOFF.md`, `.tmp-verify/107-docs/`, `.tmp-verify/release-0.39.0/`(이전 컷 형식).

# GUARDRAILS

- 이 단계에서 하지 않는 것: main·branch·tag push, GitHub release, npm, carrier dispatch, 최종 artifact 생성(make 몫), Herdr manifest 버전이나 registry pin 변경(위 checkout-source 복귀만 예외).
- local whole FULL·BODY와 operator Herdr build/sandbox는 금지한다. operator rebuild·install·restart·network·trust·auth 변경, 노트북 SSH, 메시지, OFF peer wake, 숨은 model 턴도 하지 않는다.
- release-prep commit에는 구현을 섞지 않는다. 후보를 freeze한 뒤 worktree나 index가 움직이면 그 receipt는 무효다.
