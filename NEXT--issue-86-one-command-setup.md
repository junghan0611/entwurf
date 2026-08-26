# NEXT — #86 one-command detected-harness setup

> Branch-only disposable handoff. Delete before merge. Durable contract: https://github.com/junghan0611/entwurf/issues/86

# RAIL

- [x] **1. Incident measurement** — ThinkPad source setup omitted `entwurf`; correct PATH + vendor Copilot + no global Entwurf package produced Copilot fresh `runtime-unresolved` before tmux mutation. Oracle's unrelated global package had masked the source gap and was removed.
- [x] **2. #82 scope restored** — Copilot admission remains shipped in 0.15.0; #82 closed with follow-up pointer to #86.
- [x] **3. Source operator candidate** — dev-bin owns `entwurf -> checkout/run.sh`; verify requires owned symlink, exact target, and exact PATH winner. Foreign/off-PATH/shadowed operator is red; later helper conflicts remain doctor-owned warnings. Two source-install mutants.
- [x] **4. First independent review** — Opus read-only review: initial Blocker 1 / Defect 7, amendment, final Blocker 0; follow-up N1–N4 amended. Focused gate currently `smoke-agy-install-state` 185 PASS; mux fresh 91 PASS.
- [ ] **5. Base harness + presence-driven composition** ← CURRENT — Entwurf package/source install supplies certified Pi (no separate Pi install); setup installs every detected optional harness completely: claude/copilot/agy optional-by-presence. Add Copilot four-unit composition and missing birth inverse; absent optional harness creates zero state.
- [ ] **6. Independent audit + frozen evidence** — focused matrix → Opus/Fable review as GLG directs → one amendment → qualification once → frozen `check:full` once.
- [ ] **7. Commit/landing/release** — implementation commit on branch; delete this file before merge. GLG controls push and each `entwurf-release` mode for 0.15.1.

# NOW

## Product rule

```text
npm global:       npm install -g @junghanacs/entwurf → entwurf setup <project>
npm project:      npm install -D @junghanacs/entwurf → npx entwurf setup <project>
source checkout:  ./run.sh setup <project>

shared composition
├─ pi      mandatory base harness; package/source install supplies the certified pin
├─ claude  present → complete Claude-owned install
├─ copilot present → birth + MCP + receive + statusline
└─ agy     present → bridge/permission + statusline + imprint
```

An Entwurf install with no pre-existing harness still yields a usable Pi base harness. Absent optional harness: explicit skip, zero state. Present optional harness: no half-install and no cosmetic green.

## Next implementation move

1. Replace the optional Pi peer contract with the exact certified base-runtime package contract; update pi-free package gates rather than working around them. Prove global and project-local package bins expose the matching Pi.
2. Split only the bootstrap: source setup runs pinned dependency installation; installed-package setup never runs pnpm inside node_modules. Both then call one shared host composition.
3. Read the three existing setup compositions and four Copilot installers as sources; do not invent a generic harness manager.
4. Put core operator exposure before optional Copilot config writers so bare `entwurf-bridge` / statusline names resolve.
5. Compose Copilot install in dependency order without model turns; prove its four filesystem/config preflight axes after setup.
6. Add package-owned Copilot birth inverse using qualified plugin+marketplace identity and conservative artifact ownership.
7. Extend the package/source hermetic surface with no-preexisting-harness Pi install plus absent/present/all-present/rerun/inverse optional cells; no raw vendor session or LIVE credit.

## Do not touch

- `FRESH_CALL_RUNTIME.copilot = "entwurf"`
- fresh-call schema, preflight semantics, delivery, D3/D8, hidden `--ui-server`
- OMP/ACP backend lanes
- optional harness binary or credential installation
- global npm Entwurf as a source prerequisite
- push/release without GLG's explicit current-mode grant

# RECEIPTS

- Issue #86: https://github.com/junghan0611/entwurf/issues/86
- #82 close comment is the scope handoff.
- Opus reviewer garden id: `20260826T165117-3c0465` (read-only; launch/callback/review receipts in parent conversation).
