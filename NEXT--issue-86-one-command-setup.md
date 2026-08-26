# NEXT — #86 one-command presence-driven setup

> Branch-only disposable handoff. Delete before merge. Durable contract: https://github.com/junghan0611/entwurf/issues/86

# RAIL

- [x] **1. Incident measurement** — ThinkPad source setup omitted `entwurf`; a correct PATH plus vendor Copilot and no global Entwurf package produced Copilot fresh `runtime-unresolved` before tmux mutation. Oracle's 2026-08-16 global checkout link had masked the source gap; it was measured and removed.
- [x] **2. #82 scope restored** — Copilot admission remains shipped in 0.15.0; #82 is closed and the install follow-up moved here.
- [x] **3. Source operator checkpoint** — `e08d937` makes dev-bin own `entwurf -> checkout/run.sh`; verify requires the owned target and exact PATH winner. Two source-install mutants were added. Focused receipts inherited from the checkpoint: `smoke-agy-install-state` 185 PASS; mux fresh 91 PASS.
- [x] **4. Product direction reset (GLG, 2026-08-26)** — Entwurf installs itself only. Pi has no mandatory exception. Setup composes operator-installed harnesses by presence; absent is zero-state SKIP, detected-but-incomplete is named non-green. The issue and maintainer docs carry this correction.
- [ ] **5. Platform and install-surface measurement** ← CURRENT — measure global npm, project-local npm and source bootstrap on Linux, macOS and native Windows; inventory every bash/symlink/`/proc`/path/process assumption, the unconditional credential-alias mutation, optional-wrapper false green, and project-local → user-scope lifetime before choosing the portable operator entry. WSL is Linux evidence, never native-Windows evidence.
- [ ] **6. Presence-driven composition** — one shared setup verdict for `pi`, `claude`, `copilot`, and `agy`; each is optional-by-presence. Add Copilot four-unit composition and its missing birth inverse. Remove setup credential copying and unconditional whole-host green. No model turn, binary install, credential or login.
- [ ] **7. Hermetic/package/platform proof** — Entwurf-only, each harness independently present, all present, corrupt/foreign, rerun, inverse; global/project/source consumers; Linux/macOS/Windows package entry and config lifecycle. Runtime rail claims remain separately measured per harness/platform.
- [ ] **8. Independent audit + frozen evidence** — Fable coordinates after GLG opens it; one review/amendment bundle, qualification once because gates/mutants changed, then frozen `pnpm run check:full` once.
- [ ] **9. Landing/release** — delete this file before merge. GLG controls commit/push and each `entwurf-release` mode for a later release.

# NOW

## Product rule

```text
install Entwurf
└─ Entwurf bytes + bins + bridge + integration artifacts only

setup (same composition semantics in every install mode)
├─ pi      present → complete Pi-owned wiring       absent → SKIP / zero state
├─ claude  present → complete Claude-owned wiring   absent → SKIP / zero state
├─ copilot present → birth + MCP + receive + footer absent → SKIP / zero state
└─ agy     present → bridge + permission + footer + imprint
            absent → SKIP / zero state
```

Entwurf never installs a harness binary, subscription, credential or login. Source `pnpm install` may install pinned Pi packages as this repo's development/test dependencies; that is not a neutral npm consumer promise and must not leak into package dependencies. Cortex remains an optional ACP backend with no setup-owned native composition to invent in this lane.

## Install modes

```text
global npm:   npm install -g @junghanacs/entwurf
              entwurf setup <project>

project npm:  npm install -D @junghanacs/entwurf
              npx entwurf setup <project>

source:       ./run.sh setup <project>
              (source-only dependency bootstrap, then the same composition)
```

Package installation and setup are different operations. Installed-package setup must never run a package-manager install inside `node_modules`. Source bootstrap may install repo dev dependencies, but setup does not recruit vendor harnesses in any mode.

## Verdict language

```text
core       PASS
pi         SKIP  not installed
claude     PASS  complete owned integration
copilot    FAIL  detected; receiver config foreign
agy        SKIP  not installed
RESULT     FAIL  core preserved; Copilot unavailable
```

Absent is a normal SKIP and writes no harness state. A detected harness that cannot be completed is not whole-host green and makes setup return nonzero while preserving already-valid core state. Static setup owns artifacts/config/inverses; it never reads, copies, aliases or backs up credentials. Authentication and model turns belong to the operator's harness and separate LIVE evidence.

# NEXT MEASUREMENTS — BEFORE DESIGN

1. **npm behavior:** pack one candidate and observe global/project-local bin propagation with no harness installed. Preserve the current pi-free neutral install as the control; do not move `@earendil-works/pi-*` into production dependencies.
2. **operator entry portability:** measure the shipped `entwurf -> run.sh` bin on Linux, macOS and native Windows PowerShell/cmd. Identify whether one Node entrypoint must replace the bash-only package front door; do not add a permanent wrapper family or second CLI.
3. **source exposure portability:** inventory `scripts/dev-bin.sh` symlink/readlink/PATH ownership semantics on macOS and Windows. Pick a platform-native ownership/inverse mechanism; developer mode or symlink privilege may not be assumed on Windows.
4. **process/config portability:** enumerate `/proc`, `pgrep`, `ps`, `flock`, `mktemp`, shell, Python and home/config path assumptions in every installer/doctor. Installation support and live rail certification are separate cells.
5. **credential boundary:** trace `setup_all → sync_auth` and every reader of the generated `entwurf` alias. GLG's rule is removal from setup and no credential copy/backup; do not relabel it an automatic convenience. Retire the standalone surface too unless a current explicit owner is measured and separately decided.
6. **install-scope lifetime:** table global npm, project-local npm and source package roots, stable command roots, user/project settings writes, stale-path behavior and inverses. In particular, explain or remove project-local → global user-scope registration.
7. **composition sources:** read `setup_all`, the Claude installer, three agy installers, and four Copilot installers/doctors. Compose those leaves; do not invent a generic harness manager. Replace non-fatal detected-harness wrappers and unconditional `DONE ... green` with computed component outcomes.
8. **Copilot lifecycle:** design the missing birth inverse around the qualified `plugin@marketplace` identity and package-owned artifact state; refuse unproven foreign removal.
9. **proof matrix:** define independent Linux/macOS/Windows package-consumer jobs. WSL may supplement Linux only. No platform is claimed from source inspection or another OS's green CI.

# DO NOT TOUCH

- Do not make Pi, Claude Code, Copilot CLI, agy or Cortex a production dependency of Entwurf.
- Do not install or log into a harness from setup; do not read/copy/alias/back up its credential store. The current unconditional `sync_auth` is a removal subject.
- Do not change `FRESH_CALL_RUNTIME.copilot = "entwurf"`, fresh-call schema, delivery, D3/D8, hidden `--ui-server`, OMP or ACP backend behavior.
- Do not turn platform setup into a second harness, generic package manager, wrapper collection or profile system.
- Do not describe macOS/native-Windows runtime support as landed before direct evidence; Linux `/proc` evidence does not travel.
- Do not run qualification/full before implementation, independent review and one amendment bundle close.
- Do not push/release without GLG's explicit current authority.

# READ FIRST

- Issue #86 body/thread — live product contract.
- `AGENTS.md` Hard Rule 17 — install/compose and platform-evidence boundary.
- `package.json` dependencies/optional peers/bin surface.
- `run.sh`: `sync_auth`, `preflight_dep_integrity`, `install_local_package`, `setup_all`, optional wrapper outcomes, installed-package gates.
- `scripts/dev-bin.sh` and `scripts/smoke-agy-install-state.sh` — first checkpoint and ownership semantics.
- `scripts/meta-bridge-install.sh`, `scripts/copilot-*-bridge.sh`, `scripts/agy-*-bridge.sh` — existing leaves to compose.
- `docs/setup-clean-host.md`, `README.md`, `VERIFY.md` — current shipped behavior; update only with behavior as it lands.

# RECEIPTS

- Issue #86: https://github.com/junghan0611/entwurf/issues/86
- Source operator checkpoint: `e08d93700b462fb78b1e0c13b2662703ad10b3bb`
- Opus first-slice review citizen: `20260826T165117-3c0465` (read-only; Blocker 0 after amendment, inherited from checkpoint comment).
- Qualification/full: NOT RUN on this branch checkpoint.
