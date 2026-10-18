# NEXT — core 0.39.0 released + published → Herdr 0.39.0 snapshot

core 0.39.0(native-Windows 실험 preview 포함)이 tag·GitHub release·npm `latest`까지 나갔다. 지금은 Herdr plugin을 published 0.39.0 registry bytes로 re-pin하는 별도 snapshot이다. 승인 원장: [#78](https://github.com/junghan0611/entwurf/issues/78) thread(thread가 body보다 우선), release 수용 [#78 6253393576](https://github.com/junghan0611/entwurf/issues/78#issuecomment-6253393576).

# RAIL — 현재 좌표

- [x] **1. core 0.38.1 release · #146 closed.** `v0.38.1` = `6c3c6f4`.
- [x] **2. WSL2 + native-Windows preview on main.** WSL2 `86f0eb5`; native 9 commits `95933c7`..`5da8f12` + supply contract `32fcc1c`. runtime 증거는 `3b65bdc` 자체 SHA(run 39123555360).
- [x] **3. core 0.39.0.** `v0.39.0` = `551402c`, exact CI 39145255865 four jobs GREEN, local LIVE r2 MUST 23/23 + BEHAVIOR 1/1. Candidate는 M3w로 preview run 39146098592의 tgz(sha256 `1d569324…`), Windows 8 cells + Linux container 수용. §3.4 installed Claude host PASS(테스트 세션 뒤 clone wiring 복구). §3.7 agy는 GLG cut 결정으로 이번 cut만 제외(PASS 아님). [GitHub release](https://github.com/junghan0611/entwurf/releases/tag/v0.39.0)(본문과 부록은 cut 시점 기록이라 아직 "npm 미발행"이라 적혀 있고 수정하지 않음). 그 뒤 GLG가 npm publish(2026-10-18T21:24:39Z, `latest` 0.39.0); registry tarball == accepted candidate.
- [ ] **4. Herdr 0.39.0 snapshot** ← CURRENT: `plugins/herdr/runtime-lock.json` npm 0.39.0 pin + manifest 0.39.0 + CHANGELOG snapshot 절. `ba46dec`로 commit됨. 남은 것: 문서 감사 amendment closure → main push(GO) → exact CI four jobs → public-ref install/use/deactivate journey → CalVer tag/GitHub snapshot release(GO).

현재 좌표: 1–3 완료 → 4 Herdr snapshot.

# NOW

- **Herdr snapshot 경계:** core `v0.39.0` tag와 bytes는 불변. operator Herdr 설치·live pane·runtime은 재설치/업데이트하지 않는다. `check-herdr-plugin-build`/`check-herdr-sandbox`는 이 host 금지라 pushed SHA의 CI가 대신한다.
- **native-Windows preview 경계:** experimental, shape-only. UNSUPPORTED·미측정 목록은 BASELINE 세 행. 이 carrier가 든 tarball의 macOS 설치는 미측정(CI macOS job은 addon-less pack).
- **Reader policy:** Windows record read는 N-API addon(final-component reparse → `ELOOP`, non-regular → `ENTWURF_ENOTREG`). POSIX `O_NOFOLLOW`와 ancestor policy는 불변.
- **배포 parity:** `pi-extensions/lib/meta-session.ts`가 바뀌는 release는 operator host의 omp receiver(`install-omp-receive`)와 Claude meta-bridge(`install-meta-bridge`) 재배포가 LIVE/doctor 전제다(0.39 r1 RED의 원인).
- **#146 운영 경계:** 0.37–0.38 프로세스의 forced `backgroundTokens: 0`은 설치만으로 바뀌지 않는다.
- **ACP/#142:** PAUSED, 0.90 유지.

# RECEIPTS

- core 0.39.0: `.tmp-verify/release-0.39.0/`(`P8-FINAL.md`는 publish 이전 기록 — 그 status 줄을 현재 사실로 읽지 않음; live-r2, accepted-artifact, host-claude, notes).
- Herdr 0.39.0: `.tmp-verify/herdr-0.39.0/`(registry, c3 swap 22/22).
- native Windows: `.tmp-verify/78-native-20261018/`.

# GUARDRAILS

- Herdr snapshot의 commit/push/tag/GitHub release는 coordinator checkpoint GO마다. npm 재publish 없음.
- Local whole BODY와 operator `check-herdr-plugin-build`/`check-herdr-sandbox` 금지. Operator DB/meta/transcripts, 기존 process, unrelated branch, 보호 artifact 건드리지 않음.
