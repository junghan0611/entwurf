# NEXT — entwurf 0.12.1 release-cut handoff

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 둔다.
> 현재+미래 방향과 설계 SSOT = **`ROADMAP.md`**. 닫힌 변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git log.

## NOW — 0.12.1 C ready, release-gate GREEN, awaiting GLG cut authorization

- `0.12.0` 배포 후 발견된 설치 버그를 0.12.1로 닫는 WIP가 main working tree에 있음. 아직 commit/tag/push/publish 안 함.
- 핵심 수정:
  - npm/node_modules 설치에서 `node --experimental-strip-types src/index.ts`가 죽는 문제를 dist JS emit으로 해결.
  - `build-bridge = rm -rf dist && tsc -p mcp/entwurf-bridge/tsconfig.build.json`.
  - `prepare = husky 2>/dev/null || true; npm run --silent build-bridge` — git install은 prepack 대신 prepare를 타므로 dist 부재 gap을 닫기 위한 추가 수정.
  - `start.sh`는 위치 기반 dual-mode: `node_modules` 아래면 dist, dev clone이면 source strip-types.
  - `run.sh` / `start.sh` / `mcp/entwurf-bridge/test.sh`가 npm/pnpm bin symlink를 따라 package root를 찾음.
  - `package.json`은 neutral npm package로 `bin` (`entwurf`, `entwurf-bridge`)을 노출하고 pi peers를 optional로 표시.
  - README + `docs/setup-clean-host.md`는 npm-first / pi-adapter-second로 정리됨.
  - Concept primer에 **Garden / garden id** 설명 추가됨.
- 원격 `hejdev6` WIP tarball 실제 설치 검증 완료:
  - local `npm install /tmp/entwurf-0.12.1-wip.tgz`
  - package bins present
  - optional `@earendil-works/*` peers absent
  - installed `entwurf-bridge` answers `tools/list`
  - isolated HOME에서 `entwurf install` + `entwurf check-bridge` 통과
  - real HOME에는 기존 `~/.pi/agent/entwurf-targets.json -> .../pi-shell-acp/...` stale symlink가 있음. GLG는 force update 쪽이라고 말함. 릴리즈 후 canonical install path에서 `entwurf setup:links --force`가 맞다는 판단.

## Release-gate — RESOLVED (was MUST FAIL=1), now fully green

`/make-release 0.12.1` was correctly ABORTED on a MUST fail; Opus took over the review (GPT session filled). Root cause was **two live model-in-loop smokes whose observation contracts went stale**, NOT the 0.12.1 install change (no ACP code path touched) and NOT a product defect:

- `smoke-acp-carrier-augment-live`: asked the model to echo a `SECRET_PROJECT_CODE` from a `/tmp` `AGENTS.md` → current Claude refuses as injection. Fixed → benign factual marker (build codename) asked as a normal "answer from project context" task. LIVE rc=0.
- `smoke-acp-bundled-mcp-live`: prompt asked "values only" but the assertion matched field-name-labeled lines (`socketState: alive`) → bare-value reply dropped + `[tool:done]` notice truncated socketState. Fixed → prompt requests labeled 3 lines. LIVE rc=0 (14 checks).
- Both reviewed and **approved by GPT** as observation-contract realignments, not gate weakening (same MUST assertions, non-circular gid proof intact).

Re-run `LIVE=1 ./run.sh release-gate <fresh scratch>` (2026-06-29):
- `MUST: PASS=17 FAIL=0 SKIP=0`
- `BEHAVIOR: PASS=1 FAIL=0` (the earlier RGG-positive BEHAVIOR fail was flaky; green on re-run)
- `✅ release-gate MUST PASS + BEHAVIOR PASS — all green.`

CHANGELOG 0.12.1 records the two fixes + the green release-gate evidence.

## Verified floor (current working tree)

- `pnpm check` rc=0 · `check-pack` (215 files) rc=0 · `check-pack-install` rc=0 (neutral npm install + .bin/entwurf-bridge dist boot + stale sentinel + pi-free)
- `check-entwurf-bridge-boot` / `check-entwurf-bridge-pi-free` rc=0 · `biome` rc=0 · 3-config typecheck rc=0
- `LIVE=1 release-gate` MUST 17/0/0 + BEHAVIOR 1/0
- Adversarial probes: npm+pnpm `.bin/entwurf-bridge` boot, installed `test.sh` via start.sh (dist), dist-removed → `ERR_UNSUPPORTED` fail-loud

## 다음 한 걸음

1. **GLG cut 승인 대기** — necessary condition met (gate green + GPT 합의). commit/tag/push/publish는 GLG 결정.
2. 승인 시: `commit` 스킬로 release-prep 커밋 → `/make-release 0.12.1` (tag/push/GitHub-release). npm publish는 명시적 GLG/operator action.
3. 릴리즈 후: `hejdev6` real HOME의 stale `~/.pi/agent/entwurf-targets.json` (→ pi-shell-acp) 를 canonical npm install path 확정 후 `entwurf setup:links --force`로 정리. (지금 clone에서 force하면 canonical이 clone 경로로 잡힘 — 어느 path를 persistent로 둘지 GLG 결정.)

## Follow-up (cut blocker 아님, 다음 세션 cleanup)

- `smoke-acp-skill-live`의 "secret probe code" 표현을 "probe code/project marker"로 낮추기 (GPT 제안). 현재 green이지만 carrier-augment와 같은 injection-refusal 취약성 소지. 선제 cleanup 권장.

## 넘으면 안 되는 선

- Work on `main`; do **not** create a branch for this lane.
- `core.hooksPath` 건드리지 않음. `--no-verify` 금지.
- Do not publish/tag/push from agent without explicit GLG approval and green release preflight.
- If live release gate is requested, run with a scratch cwd and `LIVE=1`.

## 참조

- 설계 SSOT: `ROADMAP.md`
- 닫힌 변경: `CHANGELOG.md`
- 검증 calibration: `VERIFY.md`, `BASELINE.md`, `DELIVERY.md`
- repo baseline: `AGENTS.md`
- ACP 레일: `docs/acp-backend-rail.md`
