# NEXT — entwurf 0.12.0 publish handoff

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 둔다.
> 현재+미래 방향과 설계 SSOT = **`ROADMAP.md`**. 닫힌 변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git log.

## NOW — 0.12.0 main landed, publish 직전 정렬

- `entwurf-rename`은 `main`으로 no-ff merge 완료: `5b5243f merge: cut 0.12.0 entwurf-first release`.
- 최종 release evidence: `LIVE=1 ./run.sh release-gate /tmp/psa-release-gate-0.12.0.np8FuB` → **MUST PASS=17 FAIL=0 SKIP=0 + BEHAVIOR PASS=1 FAIL=0** (2026-06-29 14:01–14:10 KST). Operator log: `/tmp/pi-tmux-entwurf-release-gate.log`; per-step artifact paths are printed in that log. 직전 `smoke-acp-bundled-mcp-live` red는 같은 트리 bounded retry green으로 flake 처리.
- `pnpm check` / `check-pack` / `check-pack-install` green. npm-managed install regression은 `check-pack-install` 안에서 real `npm install --legacy-peer-deps` + hoisted deps + isolated HOME으로 잠김.
- publish surface: package `@junghanacs/entwurf@0.12.0`, `publishConfig.access=public`, README/clean-host npm-first, hero image refreshed to GLGMAN Universe `entwurf` release art.
- 현재 tag/npm 상태는 GLG가 최종 실행한다. agent는 push/tag/npm publish 금지.

## 다음 한 걸음 — GLG publish loop

1. **최종 diff sanity**
   - `git status --short`
   - `git diff --stat` / hero asset + small docs/package diff 확인
   - `rg 'coming soon|not yet published|after publish' README.md docs/setup-clean-host.md package.json` → live publish 표면에 남으면 안 됨
2. **tag + publish (GLG only)**
   - tag는 main merge commit 이후 현재 HEAD에 `v0.12.0`.
   - `npm publish`는 manifest의 `publishConfig.access=public`을 사용.
   - publish가 실패하면 실패 로그를 그대로 보존하고, 원인별 patch로 대응한다. `--no-verify` / unsafe override 금지.
3. **post-publish smoke**
   - `npm view @junghanacs/entwurf version` → `0.12.0` 확인.
   - scratch에서 `pi install npm:@junghanacs/entwurf` → `~/.pi/agent/npm/node_modules/@junghanacs/entwurf/run.sh install .` → `run.sh check-bridge`.
   - 가능하면 authenticated `LIVE=1 run.sh smoke-acp-provider-live` 1회.
4. **old package / consumer follow-up**
   - old package deprecation 여부는 GLG 결정.
   - agent-config server 면(`*.server.json`, install spec/URL) repoint는 agent-config lane에서 처리.

## post-0.12 follow-ups — 내보낸 뒤 바로 볼 것

- **v2-native demo/GIF retake:** README의 GIF는 archived pre-0.12 evidence로 표시했다. demo scripts는 아직 v1 `entwurf` / `entwurf_resume` / `entwurf_send` 흐름이라 다음 minor에서 v2-native demo로 교체.
- **bundled-MCP deterministic split:** `smoke-acp-bundled-mcp-live`는 현재 MUST 안에 model-in-loop/socket-timing 축이 섞여 있다. 다음 작업은 deterministic bundled-MCP proof를 MUST로 세우고 autonomous model echo를 BEHAVIOR로 분리.
- **ACP backend adapter rail:** `docs/acp-backend-rail.md` 기준으로 Cortex/vendor-governed backend 추가는 adapter 객체 + registry 계약부터, 0.12.0에 구현 선점하지 않음.
- **fresh sibling minting:** `entwurf_v2`는 기존 garden citizen dispatch만 담당. 새 sibling minting은 `spawn-fresh` lane.
- **persisted ACP resume/load:** current reuse는 in-memory + record write. persisted read/use는 별도 hardening.

## 넘으면 안 되는 선

- `core.hooksPath` 건드리지 않음. `--no-verify` 금지.
- push / tag / npm publish / old package deprecate는 GLG 결정·실행 전용.
- 실패한 release gate를 기준 낮춰 통과시키지 않는다. retier가 필요하면 deterministic replacement MUST를 같이 만든다.
- demo v1 잔존은 숨기지 않는다. 현재는 archived pre-0.12 evidence로 명시하고, retake를 follow-up으로 둔다.

## 참조

- 설계 SSOT: `ROADMAP.md`
- 닫힌 변경: `CHANGELOG.md`
- 검증 calibration: `VERIFY.md`, `BASELINE.md`, `DELIVERY.md`
- repo baseline: `AGENTS.md`
