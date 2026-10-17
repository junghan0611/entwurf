# NEXT — core 0.38.1 prepared (#146 SDK default compaction); make waits for coordinator checkpoint

# RAIL — 현재 좌표

- [x] **1. 0.38.0 core·Herdr snapshot 출하와 정리.** main = `beb5925`, tag `v0.38.0`, `v2026.10.16-herdr.0.38.0`. 장부: https://github.com/junghan0611/entwurf/issues/145#issuecomment-6209375125
- [x] **2. ACP/#142 보류 결정.** SSOT는 https://github.com/junghan0611/entwurf/issues/142#issuecomment-6211680027 . 0.90 유지, pi-durable은 native GPT.
- [x] **3. #146 구현과 검토.** `58c4d0f`(native-or-refuse 원칙 문서), `9229452`(SDK 기본 background compaction). 코디 리뷰 B0/D0, 추가 검수 ee20b5 B0/D0/O4.
- [ ] **4. core 0.38.1 make** ← CURRENT: prepare commit을 만든 뒤 코디 checkpoint를 기다린다. 그다음 순서:
  - push, exact-SHA push CI 4 jobs
  - same-SHA 수동 `qualify=true` whole BODY. **green 전 tag 금지.**
  - 후보 pack과 container acceptance
  - tag, GitHub Release(BODY 결과는 evidence appendix)
- [ ] **5. npm publish(GLG 전용) → U3 registry proof.** Herdr snapshot은 이번 범위가 아니다(runtime-lock 0.38.0 유지).

현재 좌표: 1–3 완료 → 4 make 대기(prepare checkpoint).

# NOW

- **0.38.1 증거(CHANGELOG `## 0.38.1`이 owning record):**
  - 로컬 LIVE r1: MUST(non-static) 23/23, BEHAVIOR 1/1. 2026-10-17 15:11–15:16, 영수증 `.tmp-verify/release-0.38.1/live-r1/`.
  - owned Codex app-server: 기동부터 TERM 종료까지 `.tmp-verify/release-0.38.1/codex-server/`. 첫 tee-pipeline 시도는 `attempt0-pipeline/`에 남겼다.
  - P9 census는 report만 했다. reparented holder 1개는 보호 대상 Emacs 3364025다.
  - 로컬 `check:full`은 운영 Herdr 금지 때문에 돌리지 않았고 PASS로 세지 않는다. prepared SHA의 push CI에 넘긴다.
- **BODY:** 이번 0.38.1 최종 SHA에서 CI `qualify=true`로 1회 돌린다. #142 예약을 앞당긴 것이고, 미래 #142 SHA의 증거가 아니다.
  - 결과는 #146 장부와 GitHub release에 기록하고, frozen CHANGELOG는 편집하지 않는다.
  - 실패하거나 중단되면 원문을 보존하고 판정을 받는다. 자동으로 다시 사지 않는다.
  - push run과 dispatch run이 FULL을 중복으로 돈다.
- **earlier candidate:** PARTIAL `[check-pi-durable-carrier]` 30/30 영수증(`.tmp-verify/durable-bg-defaults-20261017/partial-carrier-1/`)은 커밋 전 amendment-1 surface의 측정이다. 0.38.1 acceptance가 아니다.
- **실행 중 세션:** 0.37–0.38에서 로드된 프로세스는 `backgroundTokens: 0`을 유지한다. GLG가 수동으로 restart해야 바뀐다.
- **보류(재개 시 GLG 범위 재확정):**
  - `.tmp-verify/142-sizing-20261016/`(#142 사이즈 자료)
  - `.tmp-verify/compaction-receive-20261017/READING.md`(compact 중 수신 읽기 조사)
  - 브랜치 `docs/native-or-refuse`, `feat/pi-durable-sdk-default-compaction`는 main에 합쳐졌고 삭제하지 않았다.
- **유지되는 규칙:** #144 일반 정책. 운영 호스트에서는 Herdr 검사와 로컬 whole BODY 금지. npm publish는 GLG 전용.

# RECENT / RECEIPTS

- core 0.38.1 prepare: `.tmp-verify/release-0.38.1/`(live-r1, codex-server, fp.sh). #146 작업 영수증: `.tmp-verify/durable-bg-defaults-20261017/`(CONTRACT.md, opus-checkpoint-1, opus-amendment-1(-toolchain), partial-carrier-1, ADDITIONAL-REVIEW-ee20b5.md).
- homepage 0.38 반영(코디, 2026-10-16): commit `2f27313`, 배포 영수증 `.tmp-verify/homepage-0380-deployed.json`(EN/KO 200, footer 일치; 시각 검수 아님).
- core 0.38.0: `.tmp-verify/release-0.38.0/`(live-r1, make, records-r1..r3, codex-server, doctor-meta-bridge.txt). U3 r1 RED는 retired lexical wrapper 술어, r1b가 U3 축 완료.
- Herdr 0.38.0: `.tmp-verify/herdr-0.38.0/`(swap receipt, focused-summary, raw-install-main.log `95543bd4…`, exact-ci-beb5925.log, tag.txt, release.txt).
- 정리: `.tmp-verify/cleanup-20261016/`(AUTHORITY.md, census-r1, plan2/RESULT.md·delete.log·post-check.txt, archive-removal-verify.txt). 24 LIVE step 로그 원문은 `.tmp-verify/release-0.38.0/live-r1/steps/`로 옮겨 24/24 검증.
- 모듈 경로 소멸 노트: U3 receipt가 가리키던 sandbox helper 경로(`…/agent/npm/node_modules/@junghanacs/entwurf/scripts/herdr-runtime.mjs`)는 deps 정리로 사라졌다. helper bytes `f7066aa5…`는 checkout의 `scripts/herdr-runtime.mjs`, 보존 tgz, 공개 장부로 증명된다.

# GUARDRAILS / NEXT LANE

- 남겨 둔 것(삭제 안 함): forward-open 두 세계의 데이터·DB·기록·SHA256SUMS(원래 seal은 역사), 보존 tgz들, entwurf-chain·smoke-pi-durable 기록, Docker pi1.2 raw-install 이미지 2개와 현재 pi1.3 이미지, 출처 불명 /tmp 접두사(acp-cache-test·render-take·caption-take), /tmp/.pnpm-store, 운영 세션·transcript·DB/WAL·Emacs·서비스.
- 운영자 herdr를 돌리는 `check-herdr-plugin-build`·`check-herdr-sandbox`는 로컬 금지, CI FULL에서 수행한다. 운영 Herdr wiring·takeover·native 모델 turn은 자동 수행하지 않는다.
