# NEXT — #78 native-Windows preview landed on main → core 0.39.0 prepare/make (npm publish는 GLG)

WSL2 1단계와 native-Windows 실험 preview(N-API addon + loader + Pi citizen + `entwurf_v2` delivery)가 main에 정착했다. 다음은 core 0.39.0 prepare → make(tag·GitHub release)이고 npm publish는 별도 GLG 결정이다. 승인 원장: [#78](https://github.com/junghan0611/entwurf/issues/78) thread와 milestone [6249538509](https://github.com/junghan0611/entwurf/issues/78#issuecomment-6249538509)(thread가 body보다 우선).

# RAIL — 현재 좌표

- [x] **1. core 0.38.1 release · #146 closed.** `v0.38.1` = `6c3c6f4`, exact push CI four jobs GREEN, manual BODY 979/979 killed. #146 재진입 질문은 `docs/durable-native-support.md`의 `#146 decision closeout and re-entry`.
- [x] **2. WSL2 on main.** `86f0eb5`: exact-SHA ci 39103522711 + natural WSL run 39103522674 GREEN. BASELINE WSL2 두 행.
- [x] **3. native-Windows preview.** 9 commits `95933c7`..`5da8f12`(probe·E1a·E1b cell, 그다음 foundation `3e527cd` → `7d346d1` → `a86fc72` → `3b65bdc` → `5da8f12`), main에 FF. runtime 증거는 `3b65bdc` 자체 SHA: windows-native-preview run 39123555360 GREEN(6 addon cells + B1 + D1), ci 39123555224 four jobs green. docs SHA `5da8f12`의 ci 39124929928 four jobs green(preview는 path-filter라 native-cell claim 없음). BASELINE native Windows 세 행.
- [ ] **4. core 0.39.0 prepare** ← CURRENT: CHANGELOG/package/lock, focused deterministic gates, LIVE non-static MUST + BEHAVIOR. static FULL은 prepared SHA의 exact push CI 몫(local pass 아님).
- [ ] **5. core 0.39.0 make:** prepared main push → exact-SHA four jobs → carrier-bearing candidate(아래 공급) → Linux container 수용 → tag·stamp·GitHub release. **npm publish 없음.** **CUT BLOCKED:** VERIFY §3.4(설치된 0.39 Claude host + 새 post-install session의 strict `doctor-meta-bridge`)와 §3.7(agy 세 doctor + 새 operator conversation의 same-gid native-push reply)는 cut마다 필요하고 무인·무rewire로 채울 수 없다. 해결 또는 GLG 명시 결정 전 tag/GitHub release 없음. 그 전까지 prepared commit·exact CI·candidate(Win 8 + Linux container) 준비는 "준비"이지 MAKE 완료·release accepted·publish ready가 아니다. clone-mode Claude doctor는 §3.4 대체가 아니다.

현재 좌표: 1–3 완료 → 4 prepare → 5 candidate 준비, cut은 §3.4/§3.7 대기.

# NOW

- **CUT BLOCKERS (tag·GitHub release·npm HOLD):** §3.4 설치된 0.39 Claude host + 새 post-install session의 strict `doctor-meta-bridge`; §3.7 agy 세 doctor + 새 operator conversation의 post-install same-gid native-push reply. 둘 다 GLG/operator 손이 필요하고 waiver 없음. clone-mode Claude doctor는 더 약한 관찰이며 대체가 아니다. 무인으로 필요한 것: §3.8의 실제 MUST `smoke-codex-fresh-live`(기존 trust만, 새 trust receipt 없음)와 read-only `doctor-codex-{birth,mcp,statusline,terminal-title}`. 그 동안 prepared commit·exact CI·candidate 준비는 진행하되 "MAKE 완료"라 부르지 않는다.
- **공급(0.39.0부터):** candidate는 local Linux `npm pack`이 아니라(그건 `native/win32-x64/`를 빠뜨림) prepared SHA에서 `windows-native-preview.yml` dispatch 1회의 `win32-preview-tgz`다. build repro/imports·8 Windows cells green, 다운로드 sha == pack SHA256SUMS == Windows 설치 로그 hash, 그 같은 파일을 Linux `check-install-container`가 수용. repack·이전 carrier·추가 workflow 없음. 절차: release skill M3 carrier-bearing 절, VERIFY release acceptance axes.
- **Preview 경계:** experimental, shape-only. 다른 harness, `setup`/`.sh` bin, fresh/resume, mux/Herdr/ACP, ARM64, 16 MiB 초과 record, reparse-backed store folder는 UNSUPPORTED. 미측정: own pre-existing pipe-name birth refusal, record link/rename syscall, forced kill 뒤 descendant cleanup, cross-user·mixed elevation·remote caller, user-SID-only privacy(run은 elevated BA owner branch), physical user machine.
- **Reader policy:** Windows record read는 N-API addon(final-component reparse → `ELOOP`, non-regular → `ENTWURF_ENOTREG`, 둘 다 read handle 위). POSIX `O_NOFOLLOW`와 ancestor policy는 불변.
- **Workflow:** windows-native-preview/e1a/e1b/probe의 push trigger는 feature branch 이름이라 main에선 dispatch 전용. release oracle은 `ci.yml` four jobs만 읽는다.
- **#146 운영 경계:** 0.37–0.38 프로세스의 forced `backgroundTokens: 0`은 설치만으로 바뀌지 않는다. GLG 수동 restart를 자동 실행하지 않는다.
- **Herdr:** main lock은 closed `herdr-checkout` 유지. plugin manifest/npm re-pin/snapshot은 0.39 범위 밖. 그 전 기존 npm 활성화 host에서 main 기반 재설치/update를 하지 않는다(`activation-artifact-source-drifted`).
- **ACP/#142:** PAUSED, 0.90 유지.

# RECEIPTS

- native Windows: `.tmp-verify/78-native-20261018/`(ignored, 이 host 전용) — `trial-3e527cd/`, `trial-7d346d1/`, `trial-a86fc72/`, `trial-3b65bdc/`(run log·artifact·SHA256SUMS), `impl1/`(checkpoint·amendment·PARTIAL receipt), `b1d1/`, `docs-preview/`, review 파일. D1의 B-transcript 사실은 리뷰된 harness assertion이며 CI artifact는 citizen-cell 결과와 두 model log만 보관(B raw transcript 없음).
- WSL2: `.tmp-verify/78-wsl2-20261018/`.
- 0.38.1: [release evidence](https://github.com/junghan0611/entwurf/releases/tag/v0.38.1), `.tmp-verify/release-0.38.1/`.
- 0.39.0 계획: `.tmp-verify/release-0.39.0/`.

# GUARDRAILS

- 0.39.0: land/prepare/make(main·tag push, GitHub release)까지 GLG 승인. **npm publish 금지.** push는 coordinator GO 뒤. vendor LIVE는 기존 승인 subscription만, CI vendor/key/새 API rail 없음.
- Local whole BODY와 operator `check-herdr-plugin-build`/`check-herdr-sandbox` 금지(그래서 local FULL 없음). Operator DB/meta/transcripts, 기존 process, unrelated branch, 보호 artifact 건드리지 않음. O_NOFOLLOW/record guard 완화 없음.
