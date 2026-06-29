# NEXT — entwurf 0.12.1 pi-decouple handoff

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 둔다.
> 현재+미래 방향과 설계 SSOT = **`ROADMAP.md`**. 닫힌 변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git log.

## NOW — A/B landed, C is intentionally RED until JS dist

- `0.12.0` 배포 완료 (`@junghanacs/entwurf@0.12.0`, npm latest, 2026-06-29).
- main is ahead with the 0.12.1 A/B commits:
  - `81fdeea docs(next): scope 0.12.1 pi-decouple lane handoff`
  - `bd9270e feat(bridge): boot the meta-bridge pi-free (0.12.1 A+B)`
- A/B status:
  - ✅ `scripts/check-entwurf-bridge-pi-free.ts` + run.sh verb + `pnpm check` pipeline.
  - ✅ `entwurf-v2-contract.ts` is pi-free core; TypeBox schema moved to `entwurf-v2-contract-schema.ts`.
  - ✅ `entwurf-v2-production.ts` preflight is lazy (`await import`) and decider preflight seam is MaybePromise.
  - ✅ Last reported verification after A/B: `pnpm check` rc=0, 3-config typecheck/lint clean, bridge eager value closure pi-free.
- C packaging attempt exposed a deeper pre-existing install bug:
  - Node native `--experimental-strip-types` **refuses `.ts` under `node_modules`** (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`; help says `no-node-modules`).
  - Therefore 0.12.0’s documented npm-installed Claude Code path (`bash <pkg>/mcp/entwurf-bridge/start.sh`) was already broken when `<pkg>` lives under `node_modules`.
  - Local clone worked because it is outside `node_modules`; pi extension worked because pi uses its own loader/jiti.
- Current local dirty WIP (do **not** commit as-is):
  - `package.json`: `bin`, optional peers, keyword reorder.
  - `mcp/entwurf-bridge/start.sh`: symlink-aware bin path fix, still points to `.ts` and therefore still fails from installed package.
  - `run.sh`: neutral pi-free npm install smoke; currently red for the right reason until JS dist exists.

## 다음 한 걸음 — C 정석 해법

1. **Do not commit the current C WIP until the installed bridge boots from `node_modules`.** The neutral smoke must stay RED until the fix is real.
2. Add a distribution JS artifact for the MCP bridge:
   - Preferred: a dedicated tsc emit for the bridge graph into `mcp/entwurf-bridge/dist/` (JS tree, not Node strip-types).
   - Acceptable: esbuild with code splitting/chunks. Avoid a naive single bundle if it hoists or inlines the lazy preflight edge.
3. Preserve dual-mode launcher:
   - published/npm install: `start.sh` runs `dist/index.js` with plain `node`.
   - dev clone: if `dist/index.js` is absent, fallback to `node --experimental-strip-types src/index.ts`.
4. Keep lazy pi boundary:
   - eager bridge boot must not import `@earendil-works/*`.
   - owned-outcome spawn-bg resume may lazy-load `entwurf-preflight` and require the pi lane.
5. Extend packaging gates:
   - tarball contains `dist/` JS entry/chunks and `bin`.
   - neutral `npm install <tgz>` without pi peers leaves `node_modules/@earendil-works` absent.
   - `node_modules/.bin/entwurf-bridge` answers MCP `tools/list` with `entwurf_v2`.
   - existing pi loader smoke remains the pi/ACP lane proof.
6. Then commit C. After C is green, do D docs.

## D — README/docs after C green

- Reframe Install as **neutral npm/npx base → harness-specific wiring**.
- Move `pi install` under “pi adapter / ACP plugin lane”; state pi `>=0.80.2 <0.81` floor and the silent-misregistration risk on older pi.
- Add Concept primer entry:
  - **Garden / garden id** — the garden is the shared address space where independent harness sessions become citizens without losing their own runtime or transcript. A garden id is the stable address of one such citizen (for pi, a garden-native session id like `YYYYMMDDTHHMMSS-<6hex>`; for native harnesses, a meta-session id minted by the SessionStart hook). It is not a worker name and not proof that pi owns the session. The same-looking id may name a live control socket, a dormant pi record, or a mailbox-backed native session, so callers discover facts with `entwurf_peers` and deliver with `entwurf_v2` instead of choosing a transport by hand.

## hvkiefer / PR #40 답변

- Cortex is an **ACP backend contribution**, so it lives on the pi/ACP-plugin lane (`pi install` + pi floor is correct there).
- Neutral meta-bridge install lane is being separated so pi is not the project boundary.
- Post only after GLG approval; do not post from agent.

## 넘으면 안 되는 선

- Work on `main`; do **not** create a branch for this lane.
- `core.hooksPath` 건드리지 않음. `--no-verify` 금지.
- Do not commit a RED neutral install smoke by lowering or skipping it.
- push/tag/npm publish/old package deprecate only when GLG explicitly asks. npm publish/tag still GLG-only.
- 0.12.1 핵심 불변식: bridge boot is pi-free; only owned-outcome spawn-bg resume needs the pi lane.

## 참조

- 설계 SSOT: `ROADMAP.md`
- 닫힌 변경: `CHANGELOG.md`
- 검증 calibration: `VERIFY.md`, `BASELINE.md`, `DELIVERY.md`
- repo baseline: `AGENTS.md`
- ACP 레일: `docs/acp-backend-rail.md`
