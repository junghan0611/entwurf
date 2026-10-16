# NEXT — Herdr plugin snapshot v2026.10.16-herdr.0.38.0 (core 0.38.0 published)

# RAIL — 현재 좌표

- [x] **1. core 0.38.0 출하** — #145 Stage1 Pi SDK 1.3.0. 출하 시 main = tag `v0.38.0` = `0e504de`(Herdr 커밋 뒤 main은 전진, tag는 고정), exact push CI 38855474857 4 jobs success, 보존 tgz `6d21699b…` consumer PASS, GitHub Release latest, GLG npm publish, U3 registry proof r1b GREEN. #145 Stage1 CLOSED.
- [x] **2. Herdr pin·로컬 증거** — runtime-lock npm `@junghanacs/entwurf@0.38.0`(registry SRI), manifest 0.38.0, README Pi 1.3 선행. 실 registry swap+torn 22/22, focused 8 gates green, 독립검토 B0/D0.
- [x] **3. root 디스크 공간** — GLG 승인으로 미사용 Docker build cache만 정리(조율자 실행): root 여유 3407446016 → 15468449792 bytes, 운영 container·image 세트 전후 동일. `.tmp-verify/cleanup-20261016/pre-herdr-cache/`.
- [ ] **4. public main → 실측 → tag** ← CURRENT: 이 커밋의 main push 뒤 exact-SHA CI 4 jobs와 raw-install은 아직 빚(성공으로 세지 않음). main ordinary push 1회 → exact-SHA CI 4 jobs → `smoke-herdr-raw-install-live --ref main`(해석 commit == push SHA) → 둘 다 green일 때만 tag·GitHub Release(`--latest=false`).
- [ ] **5. 잔재 정리 lane** — 모든 릴리즈 뒤. 전수 읽기 census → 재생성 가능한 미사용 잔재만 명시 삭제 set.

현재 좌표: 1–3 완료 → 4 public main push 뒤 CI·raw-install 실측, 둘 다 green이면 tag·Release → 5 정리.

# NOW

- **Next:** branch `herdr/0.38.0`의 5파일(runtime-lock, herdr-plugin.toml, plugin README, CHANGELOG snapshot 절, NEXT)을 한 커밋으로 묶어 main FF·ordinary push 1회, 도장, `verify-exact-ci.sh <sha> wait`, 그 뒤 raw-install `--ref main`.
- **노출 경계:** main push 즉시 `--ref main` 기본 사용자에게 새 npm pin이 보인다. CI나 raw-install이 RED면 tag하지 않고 원본·현재 상태를 보존하고 즉시 보고한다. main 유지/ordinary revert/forward fix는 GLG 결정이며 자동 rollback·force는 없다.
- **증거 위치:** snapshot CHANGELOG 절의 "Pending" 줄은 그대로 둔다. public-ref raw-install·CI 실측은 조율자가 여는 "Herdr snapshot 별도 수용 장부" 공개 댓글(https://github.com/junghan0611/entwurf/issues/145#issuecomment-6209375125)에 날짜별로 추가하고, CHANGELOG/notes는 그 URL을 출처로 가리킨다. Release notes는 CHANGELOG 절의 whitespace-only 추출만 쓴다.
- **역할:** executor 521a11 단일 작성·실행, 조율자 20261014T212756-68bd94가 GO/DM/공개 댓글, author ee20b5 독립 검토.

# RECENT / RECEIPTS

- core 0.38.0 기록(당시 상태, 모두 닫힘): local LIVE r1 MUST 23/23·BEHAVIOR 1/1(`.tmp-verify/release-0.38.0/live-r1/`), docs-only `96d87b4` + prepare `0e504de`, doctor-meta-bridge PASS(clone-mode, tarball 증명 아님), make 영수증 `.tmp-verify/release-0.38.0/make/`, U3 r1 RED는 retired lexical wrapper 술어(제품 RED 아님)·r1b GREEN. 상세는 CHANGELOG 0.38.0과 #145 댓글 6208870560.
- Herdr 증거: `.tmp-verify/herdr-0.38.0/`(swap receipt `c7456f73…`, focused-summary, branch-diff). swap scratch `~/.cache/entwurf-0380-herdr-scratch.q694Ai` 보존.
- 공간: 구 raw-install 이미지 pi1.0.0·pi1.1.0 삭제(GLG 승인, 조율자 실행)로 실회수 32768 bytes. root 약 3.2GiB 여유. 새 pi1.3.0 raw-install 이미지 추정 0.57–0.6GB + 실행 수백 MB(측정 아님). `.tmp-verify/cleanup-20261016/`.

# GUARDRAILS / NEXT LANE

- 운영자 herdr를 돌리는 `check-herdr-plugin-build`·`check-herdr-sandbox`는 로컬 금지, CI FULL에서 수행한다. raw-install은 계약된 격리 container 경로만.
- 전체 mutation BODY(`check-gate-qualification` 전체)는 이번 컷의 로컬·push CI·FULL 어디서도 실행하지 않는다(주간/명시 수동만, #144). #142의 별도 1회 의무는 아래 줄.
- 운영자 Herdr 세션·프로젝트 wiring·takeover·deactivate·native 모델 turn을 자동 수행하지 않는다. records/history/DB/WAL·sandbox 증거·Emacs·운영 컨테이너는 보존.
- #142는 별도: 기존 담당 20261014T115640-17d999, `.tmp-verify/128-kickoff-037/COORDINATOR-142-REENTRY.md`. GLG 요구로 #142 완료 전 동결 후보에서 전체 mutation BODY 1회 필수(https://github.com/junghan0611/entwurf/issues/142#issuecomment-6208828744). 이번 컷에 섞지 않는다.
