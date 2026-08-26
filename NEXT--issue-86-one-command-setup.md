# NEXT — #86 one-command presence-driven setup

> Branch-only disposable handoff. Delete before merge. Durable contract and evidence: https://github.com/junghan0611/entwurf/issues/86

# RAIL — 현재 좌표

- [x] **1. Incident + source operator checkpoint** — ThinkPad exposed missing `entwurf`; Oracle's masking global checkout link was removed; `e08d937` adds owned `entwurf -> checkout/run.sh` with focused source/install gates.
- [x] **2. Contract + living-harness audit** — GLG fixed “Entwurf installs itself only”; Terra, Fable and an independent citizen re-audited credentials, ownership, setup consumers and platform evidence. The issue body/thread owns the full matrix and errata.
- [x] **3. C1 setup kernel / all-absent truth — IMPLEMENTED (worktree, uncommitted)** ← CURRENT: one product+gate candidate landed by Fable `20260826T184719-89ff44` (2026-08-26); three independent review rounds + Grok READY applied, focused gates green, 7 lane mutants qualified. `check-gate-qualification` 261/261 GREEN (2026-08-26). Next: frozen `check:full` once, then C1 commit under GLG's grant (push stays GLG's).
- [ ] **4. C2 Pi install-scope ownership** — presence-gated `.pi`/user state, explicit multi-root takeover, moved/deleted root and inverse refusal.
- [ ] **5. C3 Copilot inverse → composition + platform consumers** — birth inverse first, then four-unit setup; consume each slice on Linux/macOS/native Windows under the stop rule.

현재 좌표: C1 구현 완료(미커밋) → review 3 rounds + Grok READY 완료 → qualification 261/261 GREEN → **frozen full 1회** → C1 commit(GLG grant, push 없음) → C2

# NOW — C1 implemented; reviewer starts here

## C1 delivered shape (all in the uncommitted worktree)

- `run.sh`: mode-first named branch (`setup_mode` on the `*/node_modules/*` seam, printed as the FIRST setup line, before every prerequisite); `sync_auth` function + `sync-auth` dispatch/usage surface REMOVED (comment documents the removal; legacy alias/`.bak` residue stays manual-only); setup-level + `install_local_package`-level named python3 verdicts before writes; pi presence+floor cell (`pi_supported_range` derived from the package.json devDep pin, `PI_BIN`/`CLAUDE_BIN` hermetic probe seams, absent=SKIP zero-wiring, below-floor=detected FAIL); per-component verdict engine `SETUP_RESULTS`/`setup_result` with computed summary replacing the unconditional `DONE ... green`; any FAIL → exit 1 with valid components preserved; `wire_agy_*` return 1 on detected failure; `expose_dev_bin` propagates rc 3 truthfully.
- `scripts/dev-bin.sh`: no-arg expose attempts every unit independently, prints `attempted/ok/refused=N: <names>` summary, exit 3 on any refusal; named expose stays fail-loud. Both `source-install` mutant claims intact and re-measured KILLED.
- `scripts/smoke-setup-verdict.sh` (NEW, in `check:package` tier + dispatch + usage): S-1 all-absent SKIP/computed-green/zero-write/credential-byte-identical, S-2 below-floor FAIL-not-SKIP, S-3 pi-at-pin wiring PASS, S-4 agy corrupt named FAIL + NON-GREEN + nonzero with core still attempted, S-5 installed-mode named-branch-first + no pnpm bootstrap. 51 checks (final, incl. S-2b and the round-2 S-5 pnpm scrub).
- `scripts/mutants/setup-verdict.json` (NEW): `[QK:SETUP-FALSE-GREEN]`, `[QK:SETUP-PI-FLOOR-SKIP]` — both manually verified KILLED.
- `scripts/smoke-agy-install-state.sh`: old NON-FATAL exit-0 assertions rewritten to nonzero truth (I-3/I-4, permission(setup)); J-3 wrapper cell now asserts rc=3 + later-units-attempted + truthful summary. 187 checks.
- `scripts/check-fresh-cut-gate.sh`: D4 re-anchored (gate before source bootstrap) + D4b credential tripwire (non-comment `sync_auth` in run.sh = RED). 167 checks.
- Docs moved WITH behavior: README (pi optional-by-presence), VERIFY (new expected tail + component list), setup-clean-host (Python row, pi optional row, computed-summary sentence).

## Amendment bundle (independent review round 1) — APPLIED 2026-08-26

- **Blocker 1 fixed**: real packed installed-package `setup` row added to `check-pack-install` (L1b extension, after the user-scope regression): consumer bin `node_modules/.bin/entwurf setup` on the same candidate, fresh sandbox home, harnesses pinned absent → mode-first, no bootstrap, 3× SKIP, bins PASS-as-npm-provided, core PASS, computed green, zero harness/auth writes. Measured PASS.
- **Defect 1 fixed**: `check-gate-qualification.ts` `EXPECTED_LANE_MUTANTS` += `"setup-verdict": 5`.
- **Defect 2 fixed**: 3 mutants added — `[QK:SETUP-INSTALLED-NO-BOOTSTRAP]` (bootstrap guard widened; killed by the new installed row, gate check-pack-install), `[QK:SETUP-CREDENTIAL-FREE]` (auth `.bak` write resurrected; killed by S-1), `[QK:DEV-BIN-ATTEMPTS-ALL]` (loop aborts at first refusal; killed by J-3). S-2 assertion ORDER redesigned so each mutant's first failing line carries its own claim token (verdict-label want before exit-code want). All 5 then-current lane mutants + 2 source-install mutants manually verified KILLED **with signature on the failure line** (round-1 receipt; the lane grew to 7 in round 2).
- **Defect 3 fixed**: bounded `pi_ver` capture (`|| pi_ver=""`); new S-2b cell (resolvable pi whose `--version` crashes → named pi FAIL, NON-GREEN, core still attempted, no wiring).
- **Doc defect fixed**: installed `bins` verdict changed SKIP → **PASS "provided by npm bin linking"** (capability present, SKIP reserved for absence) and asserted in the installed row; README package-consumer sentence and setup-clean-host §7 sentence repaired to the landed installed-mode behavior.
- No new architecture blockers surfaced. Verification remained smaller than the product slice.

## Amendment bundle (independent review round 2, Kimi K3 `20260826T192801-700639`) — APPLIED 2026-08-26

- **D1 fixed**: S-5 is now a genuinely pnpm-scrubbed installed-mode run — shim dir for pre-resolved bash/node/python3/coreutils, every PATH dir carrying an executable pnpm dropped, and the scrub itself asserted (`command -v pnpm` absent + needed tools present) BEFORE the cell. New distinct contract claim `[QK:SETUP-INSTALLED-NO-PNPM]` + production mutant (source-guard collapsed to unconditional `require_cmd pnpm`); mode-first and no-bootstrap wants stay separate/untagged so WRONG-REASON cannot pass.
- **D2 fixed**: `[QK:SETUP-AGY-COSMETIC-RETURN]` on I-3's nonzero want + one exact-once context-bound mutant restoring `wire_agy_bridge`'s failed-install `return 0` (bound via the doctor-agy-bridge WARN line; the other two leaves untouched — no mutant proliferation).
- Lane count 5 → **7** in `EXPECTED_LANE_MUTANTS`; manifest + exact-once signatures moved together.
- Stale `pinned pi peers (0.82.x)` usage/comment prose replaced with derived wording (no retyped version literal); check-dep-versions still green.
- Kimi observations O1/O3/O4/O6 (snapshot node_modules write-through, resident auth copy, etc.) deliberately NOT opened as C1 work — recorded future/security inputs per the coordinator's instruction.
- **9/9 manual kill receipts**: all 7 setup-verdict + 2 source-install mutants applied → gate nonzero AND claim signature on a failure line → restored. `smoke-setup-verdict` 51 PASS · `smoke-agy-install-state` 187 PASS · typecheck PASS · lint PASS (pre-existing warnings/infos) · check-install-surface PASS · check-dep-versions PASS.

## Amendment round 3 (Sol-approved thin oracle) — APPLIED 2026-08-26; implementer handoff point

- Qualification attempt receipts: run 1 = pre-mutant manifest schema refusal (timeoutSeconds 900>600; one-line fix approved+applied). Run 2 = **256/261**, RED only because the 5 aggregate-setup claims' gates (rich smoke / check-pack-install) are snapshot-inviable (tracked-only world: no usable node_modules for the source bootstrap, no pack). Log preserved: /tmp/agent-tmux-entwurf-qualification.log.
- Fix (4 files, no runner/product change): NEW `scripts/check-setup-qualification.sh` — snapshot-safe mutation-attribution oracle, invoked DIRECTLY by manifests, NOT a run.sh subcommand/tier. Fake installed tree (run.sh+package.json+named store-doctor precondition STUB, no bridge launcher → core FAIL by design, rc=1 expected). Cells: A installed/all-absent + fake-pnpm invocation marker (NO-BOOTSTRAP, FALSE-GREEN via rc==1, CREDENTIAL-FREE, honesty control), B stale pi 0.1.0 label oracle (PI-FLOOR-SKIP), C pnpm-scrubbed PATH with scrub proof (NO-PNPM). 7 checks green.
- `scripts/mutants/setup-verdict.json`: the 5 claims re-gated onto the oracle (timeout 120); DEV-BIN/AGY stay on smoke-agy-install-state. Lane count stays 7.
- Exact-once signatures now live ONLY in the oracle (5) + smoke-agy (2: DEV-BIN, AGY-COSMETIC); the 4 tokens removed from the rich smoke and the packed-row token removed from run.sh — behavior assertions/messages unchanged.
- **Authority boundary**: thin oracle = mutation attribution only; rich `smoke-setup-verdict` (51 checks, check:package) = behavior evidence; `check-pack-install` installed row = real packed consumer evidence.
- Receipts: oracle control 7 PASS · 5/5 moved mutants KILLED with their OWN token on the FIRST `FAIL:` line · rich smoke 51 PASS · check-pack-install installed row PASS · git diff --check clean · lint pre-existing-only.
- **NOT yet run (successor Sol 20260826T204453-356072 owns next)**: full `check-gate-qualification` (expected 261/261 now), then frozen `pnpm run check:full` once, then GLG commit decision. No known blockers; observations O1/O3/O4/O6/O7/O8/O9 remain recorded-not-opened.

## Amendment round 4 (full-RED gate repair, Grok-approved, GLG grant) — 2026-08-26

- Frozen `check:full` run 1 = **RED, exit 1, 179s**: first failure was the STALE sibling gate `scripts/smoke-agy-statusline-state.sh` I-3 (`wire(agy+symlink): exits 0 (NON-FATAL…)`) — a check:hermetic gate outside the 13-file candidate that still asserted the retired NON-FATAL exit-0 posture against the landed `wire_agy_statusline` return-1 truth. Log: /tmp/agent-tmux-entwurf-c1-checkfull.log.
- Amendment: statusline smoke I-3/I-4 recalibrated to the nonzero-truth contract (same shape as smoke-agy-install-state I-3/I-4) + repo-wide stale NON-FATAL/helper-WARN prose sweep (comments/docs only: smoke-agy-install-state, run.sh dispatch comments, agy-bridge.sh, VERIFY.md §1.3). No new cells/QK/mutants/manifest/matrix; production behavior unchanged.
- Qualification NOT rerun by decision: production, QK tokens, manifests and runner are byte-identical to the 261/261 GREEN run, and the statusline gate is no mutant's signatureSource.
- Commit gate: focused `smoke-agy-statusline-state` once, then the repaired candidate's frozen `check:full` rerun once — its result decides.

## Receipts (measured 2026-08-26, oracle; post-amendment round 1)

`smoke-setup-verdict` 49 PASS (incl. S-2b) · `smoke-agy-install-state` 187 PASS · `check-pack-install` PASS **including the new installed all-absent setup row** · `smoke-meta-install-state` PASS · `smoke-copilot-statusline-state` 15 PASS · `smoke-copilot-mcp-state` 16 PASS · `check-install-preflight` PASS · `check-install-surface` PASS · `check-fresh-cut-gate` 167 PASS · `check-node-floor-coherence` PASS · `check-dep-versions` PASS · `check-claude-floor-coherence` PASS · `check-pack` PASS · `check-package-source-routing` 16 PASS · `smoke-pi-provider-state` 52 PASS · `smoke-user-scope-citizen` PASS · `pnpm typecheck` PASS · `pnpm lint` PASS (pre-existing warnings/infos only). Mutants: 7/7 KILLED with signature-on-failure-line (5 setup-verdict + 2 source-install; round-1/2 manual receipts). Qualification: machine-run 261/261 GREEN (2026-08-26, post-round-3 oracle re-gating). `check:full`: frozen 1회 run follows this prose correction (receipt in the session report).

## Review focus suggestions

1. The `pi_version_in_range` node one-liner (exact-range shape `>=a.b.c <x.y`) — shape drift vs check-dep-versions.
2. S-5 asserts mode-line-first with a bare run.sh copy; full installed lifecycle intentionally stays with L1/L2 (setup rows there are LATER work, not C1).
3. agy WARN texts kept grep-compatible; "setup continues." wording retained (true: later components still attempted) — check for reviewer taste.
4. `bins` component: installed mode = PASS "provided by npm bin linking" (round-1 doc-defect fix; SKIP stays reserved for absence), source helper-refusal = FAIL owning nonzero — severity call confirmed in review.

## Purpose (fixed by GLG — unchanged)

> Entwurf installs itself only. `setup` composes harnesses the operator already installed: absent is zero-state SKIP; detected incomplete or below-floor is non-green. It never installs a harness or reads/copies credentials. Installation evidence is separate for Linux, macOS and native Windows; WSL is Linux.

## Current state

- Branch: `issue-86-one-command-setup`; local HEAD `c2907ef`, remote `e08d937` (push is GLG's decision).
- Worktree on handoff: C1 product+gate candidate is UNCOMMITTED across 9 modified + 2 new files (see delivered shape above; `git status` is the authority).
- Qualification: 261/261 GREEN (2026-08-26); full: frozen 1회 run follows the approved prose correction. `smoke-setup-verdict` is now the first automated consumer of aggregate `entwurf setup` (fixture-level); the L1/L2/U3 living-layer setup rows remain LATER work.
- Living layers: L1a pinned-Pi pnpm project consumer; L1b Pi-absent npm project install root whose loader assertion uses L1a's Pi; L2 checkout-invisible global candidate; U3 pi-managed registry smoke. Matrix + correction are linked below.

## C1 — original slice plan (implemented above; kept for review cross-check)

1. **Decide mode first.** Installed-vs-source predicate must produce a named branch/refusal before any prerequisite check or write. Reuse the existing `*/node_modules/*` seam; missing `pi`/`pnpm` is never a mode detector.
2. **Remove credential mutation.** Remove `setup_all → sync_auth` and the standalone `sync-auth` surface. Do not auto-delete existing `auth.json["entwurf"]` or `.bak`; cleanup is manual-only. Add a credential-free fixture proving no alias/backup write and unchanged/absent auth state.
3. **Make Pi optional in aggregate setup.** Replace `require_cmd pi` with a presence+floor verdict. Pi absent writes no `.pi`/user Pi wiring. The explicit `entwurf install` leaf remains an operator-selected repair surface until C2.
4. **Split bootstrap from composition.** Source may bootstrap repo dev dependencies. Installed package mode never runs npm/pnpm inside `node_modules`. Interpreter prerequisites are per-command named verdicts before writes: today installed writers call `python3`; either declare that supported prerequisite or remove it from the portable path. Never inherit it silently on Windows.
5. **Compute truthful outcomes.** Remove unconditional `DONE ... green`. Existing Claude/agy/dev-bin leaves return per-unit PASS/SKIP/FAIL; detected failure makes setup nonzero while preserving valid core state. Dev-bin must report attempted/refused/not-attempted truthfully rather than stopping at one helper and implying the rest ran.

### C1 fences

- **Do not** auto-compose Copilot in C1. Its birth has no package-owned inverse yet.
- **Do not** implement multi-root takeover in C1; that is C2. Do not call project-local setup “complete” before C2.
- Existing Claude/agy behavior may be made truthful, not generalized into a harness manager.
- Python is not a blanket package prerequisite: `--help`/`check-bridge` already work without it; decide only the installed commands that invoke Python leaves.
- macOS is not all-unknown: import existing Darwin install/doctor refusal and uninstall-only receipts into the later platform matrix.

### C1 files / old contract

- Production center: `run.sh` — `sync_auth`, `install_local_package`, `setup_all`, `wire_agy_*`, `expose_dev_bin`, command dispatch.
- Existing gate to repair with production: `scripts/smoke-agy-install-state.sh` currently asserts `NON-FATAL`/exit-0 WARN swallowing. Red-first is allowed inside the worktree, but **no gate-only checkpoint or commit**.
- Keep `scripts/mutants/source-install.json` ownership claims intact.
- Add the smallest aggregate setup-verdict fixture with kill-qualified claims for false-green resurrection and SKIP↔FAIL drift; do not build a new harness subsystem.
- Public docs (`README.md`, `VERIFY.md`, `docs/setup-clean-host.md`, help) move only with landed behavior.

## C1 focused acceptance

```text
installed all-harness-absent setup  → core PASS, all harnesses SKIP, zero harness/auth writes
source mode                         → source bootstrap only there, then same composition semantics
pi absent / below floor             → SKIP / detected FAIL, as pinned by the issue predicate
agy/claude detected failure         → named component FAIL + nonzero host result, no cosmetic green
credential fixture                  → no entwurf alias, no .bak, auth absent or byte-identical
```

Run affected focused gates only: `smoke-agy-install-state`, `smoke-meta-install-state`, `smoke-copilot-statusline-state`, `smoke-copilot-mcp-state`, `check-install-preflight`, `check-install-surface`, the relevant local `check-pack-install` rows, and the new credential-free fixture named by C1. Then independent review → one amendment bundle → qualification once (gates/mutants changed) → frozen `check:full` once. No commit until GLG decides.

# LATER — do not pull forward

## C2 Pi ownership

Preserve L1a/L1b while replacing silent last-writer-wins user registration with explicit reported takeover. Pin package root, stable command root, project/user writes, moved/deleted-root verdict and honest inverse; never delete another root's entry.

## C3 Copilot lifecycle then composition

Add `uninstall-copilot-bridge` with qualified `plugin@marketplace`, package-owned state and foreign refusal. Prove install/doctor/inverse symmetry **before or in the same slice** that composes birth + MCP + receiver + footer. Setup never auto-installs a birth whose inverse does not exist.

# STOP / DO NOT TOUCH

- Stop on any credential-store read/copy/write introduced by the lane; legacy residue is manual-only.
- Stop if fresh-call schema, delivery, D3/D8, hidden `--ui-server`, OMP or ACP backend behavior becomes necessary.
- Stop and return to GLG if native-Windows entry needs a product-scale front-door rewrite, if verification machinery grows larger than the slice, or if one amendment reveals 2+ new architecture blockers.
- No harness binary/auth installation; Pi has no exception. No generic harness manager, wrapper family, profile system, watcher or retry.
- Runtime LIVE support is not inferred from package/setup support. WSL never proves native Windows.

# READ / RECEIPTS

1. Issue body + thread: https://github.com/junghan0611/entwurf/issues/86
2. Living-layer matrix: https://github.com/junghan0611/entwurf/issues/86#issuecomment-5423133214
3. Matrix correction (L1a/L1b; npm claim calibration): https://github.com/junghan0611/entwurf/issues/86#issuecomment-5423166478
4. C1/C2/C3 sequencing: https://github.com/junghan0611/entwurf/issues/86#issuecomment-5423195110
5. Additional independent audit (Python/mode/L1b/macOS): https://github.com/junghan0611/entwurf/issues/86#issuecomment-5423359943
6. `AGENTS.md` Hard Rule 17; then the exact production/gate files listed above.

Security observation only, not C1 scope: `scripts/smoke-resident-garden-guard.sh` copies real Pi auth into a temp LIVE-smoke agent dir. Record it; do not copy that pattern into setup tests or silently open a detour.
