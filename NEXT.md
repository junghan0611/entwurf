# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE / README / AGENTS / 코드로 보낸다.

## Active — plan 0.9.0 Entwurf garden-native session identity (#28), with 1.0.0 axis in view (#30)

0.8.x hotfix line is closed. 0.8.2 plus the #31 field report showed the runtime is strong enough for real 5-way async Opus Entwurf teams. The next work is not "can Entwurf run?" but **how Entwurf sessions are born, found, resumed, and later joined by external native sessions without faking transcript ownership**.

Read #28 + #30 + #31 as one set:
- **#28 / 0.9.0**: Pi-native Entwurf sessions become garden citizens: public handle `sessionId`, spawn with `--session-id` + `--name`, resume by header-scanned `sessionId` + saved header cwd.
- **#30 / 1.0.0**: external native sessions become garden citizens through opaque meta-session records, not fake Pi transcripts. The top-level concept is **garden session id**; Pi sessions are the first backend that can use it directly.
- **#31 field proof**: current 0.8.2 sustained 5 parallel Opus vision workers with repeated async resume. 0.9.0 must preserve this worker-team pattern while replacing `taskId` with `sessionId`.

### Current mode — planning only until unknowns close

Do **not** start implementation until the action plan below is closed enough that no hidden unknown can derail the rewrite. The largest guard remains:

> Resume must append to the existing `sessionId` session file from the saved header cwd; wrong cwd must not silently create a new session.

### Decisions to carry unless GLG overrides

1. `sessionId` grammar: `YYYYMMDDTHHMMSS-xxxxxx` (6 hex suffix) + parent-side collision pre-check against `*_<id>.jsonl` before spawn.
2. `session name`: denote-style `{sessionId}=={provider}/{model}--{titleSlug}__{tag}_{tag}`, assembled only via `buildSessionName(...)`; set on spawn only, never on resume. Full grammar in "Locked — session identity & name grammar". (이전 `·`-구분 displayName 폐기 — 오해 금지.)
3. Resume model identity: re-supply recorded `--provider/--model` on resume for 0.9.0. Inherit-without-model is a later stretch only after live smoke.
4. Async state: `activeEntwurfs` keyed by durable `sessionId`; add internal/diagnostic `runId` for per-process runs and resume notifications.
5. Public schema/result/help text: remove `taskId` as a handle. `sessionFile` is diagnostic only. No legacy fallback prose in docs/tool descriptions.
6. #28 issue body currently has a stale Compatibility Plan. Leave it visibly stale for trace; do **not** silently rewrite history. Local plan/NEXT governs implementation, and any later GitHub comment should explicitly say “stale / superseded by 0.9.0 breaking decision,” not pretend compatibility remains.

### Execution strategy — Phase 1 must prove Pi substrate before Entwurf rewrite

The previous slice plan is too large for the first move. The first milestone is smaller and stricter:

> Before changing Entwurf identity, prove that Pi 0.76 `--session-id` and Pi 0.78 `--name` behave exactly as needed under the normal pi-shell-acp release gate.

**Phase 1 — substrate proof, no Entwurf contract rewrite**

Goal: show that an ordinary Pi session born with explicit `--session-id` + `--name` is a safe foundation. This phase should not rename `taskId`, should not change public Entwurf schemas, and should not remove `entwurf-*.jsonl` yet.

What to add:
1. A small substrate smoke, likely `./run.sh smoke-session-id-name <scratch>`.
2. It should run one or a few direct `pi` invocations using the current bridge extension, not the Entwurf tools:
   - `pi --session-id <id> --name <name> --provider pi-shell-acp --model claude-sonnet-4-6 --mode json -p 'ok'`
   - verify exactly one JSONL session with header `id == <id>` in the expected cwd session dir
   - verify header `cwd` is the launch cwd
   - verify session name is persisted / discoverable in the JSONL. Per the Opus review (llmlog `20260530T123824` §1) the actual mechanism is a `session_info` entry appended at the first assistant turn, read back by Pi's `getSessionName()` (latest `session_info` wins) — parse that entry, and let the probe confirm it rather than assuming header-level name.
   - run a second turn with the same `--session-id` from the same cwd and verify it appends, not recreates
   - run or simulate wrong-cwd behavior to confirm the known footgun: same id from a different cwd can create a different local session unless caller aligns cwd. Record this as evidence, not failure.
3. Add a deterministic/static check for Pi version dependency:
   - package/dev peer pins are ready for Pi `0.78.0`
   - docs mention 0.9.0 requires Pi `>=0.78.0` for `--name`
4. Wire only this substrate smoke into release-gate first, before Entwurf live gates.
5. Run the release-gate with this addition. Passing means “the new Pi primitives do not poison existing behavior.” It does **not** mean the Entwurf rewrite is done.

Expected checks for Phase 1:
- `pnpm typecheck`
- `./run.sh smoke-session-id-name <scratch>`
- `./run.sh release-gate <scratch>` when GLG approves time/cost

Phase 1 acceptance:
- Existing Entwurf `taskId` flow still works unchanged.
- Explicit `--session-id` + `--name` direct Pi sessions pass under pi-shell-acp.
- Append behavior is proven for same cwd.
- Wrong-cwd create-if-missing behavior is observed/documented so the later resume control routine knows exactly what it must prevent.

Phase 1 substrate notes (Claude review boost, fold into the smoke before writing it):
- **This smoke is inherently LIVE (token + auth), not credential-free.** Because the session file only persists at the first assistant turn (review §1 F2), every assertion — header `id`, persisted name, append-not-recreate — needs a real model turn. The `--list-models` credential-free trick used by `smoke-installed-entwurf-acp` (#29) does **not** apply here. Use one cheap turn (`claude-sonnet-4-6`, `-p 'ok'`); accept the per-gate token cost, consistent with the existing live backend smokes already in `release-gate`.
- **One cheap backend is enough for Phase 1.** `--session-id` / `--name` / header / append are pure Pi session-manager behavior, backend-agnostic. Do not pull Hard Rule #7 (Claude+Codex+Gemini) into Phase 1 — multi-backend identity preservation is Phase 3's concern. One sonnet turn proves the substrate.
- **The smoke harness must guarantee the bridge extension is loaded for the direct `pi` call.** A bare `pi --provider pi-shell-acp` only resolves if pi-shell-acp is installed in the scratch settings or injected with `-e <bridge>`. Mirror `smoke-installed-entwurf-acp`'s bridge-loading (resolve the bridge root, pass `-e`) so the substrate proof also confirms the bridge and the new primitives coexist, rather than silently testing a bridge-less `pi`.
- **Grammar-agnostic:** Phase 1 may use any literal valid test id (e.g. `20260601T000000-test01`); it does **not** commit to the production `sessionId` grammar (decision #1) or the 1.0.0 garden-id namespace question. Those stay in Phase 2+.

**Phase 2 — control routines on top of proven substrate — ✅ LANDED (helpers + deterministic gate)**

Done in `entwurf-core.ts` (locked-grammar SSOT, merged here because it is the only strip-types-safe core that already owns SESSIONS_BASE / readSessionHeader / registry):
- `generateSessionId` / `isValidSessionId` / `formatSessionTimestamp`;
- `slugifyTitle` (raw → canonical slug; `_`/`__`/unicode destroyed);
- `isKnownProviderModel` (registry **exact tuple**, `.`-bearing models real);
- `buildSessionName(...)` (only assembly surface, fail-fast on bad id/tuple/tag) + `parseSessionName(...)` (canonical-only via `TITLE_SLUG_RE`) + `isEntwurfSessionName`;
- `findSessionFilesById` / `findSessionFileById` (header scan = authority, **throws on duplicate-across-cwd**) + `assertSessionIdAvailableForSpawn`;
- `readSessionHeader` hardened to a bounded 8192-byte prefix read (no whole-transcript load — Gemini OOM catch).
- Gate `check-entwurf-session-identity` (80 assertions, no backend) wired into `pnpm check` + `pnpm run` alias.
- Still NO public schema rename; `taskId` execution path untouched.

**Phase 3 precursor — bounded session-file readers — ← CURRENT NEXT**

Before leaning on resume as a hot path, harden the second whole-file reader (sessions are only ~1–2 MB, so this is hardening, not a crisis):
- `analyzeSessionFileLike` still does `readFileSync` + `content.trim().split("\n")`. Convert to a **sync chunked line reader** (fs.readSync loop, byte-level `\n` split, per-line utf8 decode so chunk boundaries never corrupt multibyte chars). **Keep the sync signature** — 5+ sync call sites (entwurf.ts, entwurf-async.ts, cross-cwd/compaction smokes; sentinel re-implements in bash). Behavior must stay byte-for-byte equal; existing cross-cwd/compaction smokes assert its output.
- Add a deterministic "1 MB+ body analysis stays bounded + correct" assertion to `check-entwurf-session-identity` (it already covers the bounded `readSessionHeader`).

**Phase 3a — direct-pi substrate smoke (no public API change) — ✅ LANDED**
- `scripts/smoke-session-id-name.ts` + `./run.sh smoke-session-id-name`: live 3-turn smoke dogfooding the locked helpers against a real `pi` process. Proven live: T1 header id==sessionId + header cwd==launch cwd + `session_info.name`==denote name (info layer); T2 append-not-recreate (turns 1→2, same file, name unchanged without `--name` = spawn-only); T3 wrong-cwd footgun (same id → 2 sessions under different cwds) recorded as evidence. Pi names the file `<created-at>_<sessionId>.jsonl` natively. Does NOT touch the Entwurf tool surface.
- TODO: wire `smoke-session-id-name` into `release-gate` before the Entwurf live gates (LIVE / token-costing — GLG decides placement).

**Phase 3b — atomic Entwurf sync migration (lockstep, single slice) — ← CURRENT NEXT**
- wire `runEntwurfSync` → `generateSessionId` + `assertSessionIdAvailableForSpawn` + `buildSessionName` + `--session-id`/`--name` (drop `${ts}_entwurf-${taskId}.jsonl` species);
- wire `runEntwurfResumeSync` → `findSessionFileById` (header scan) + header-cwd authority + `--session-id`;
- prove append-not-recreate (T4) and cross-cwd authority (T5).
- **Lockstep rule (non-negotiable):** the `taskId → sessionId` rename must change `entwurf-core` return type + `entwurf.ts` native tool + `mcp/pi-tools-bridge` Zod schema/tool descriptions + every test/smoke **in one commit**. A half-migrated state where core emits a `sessionId` but the MCP/native surface still advertises `taskId` would break external clients (Claude Code parsing "Task ID: …"). **Forbidden mid-state:** a `taskId` field carrying a `sessionId` value. No compatibility shim.

Later phases remain: async state (`sessionId` + internal `runId`), full MCP/control schema rename, sentinel/async-resume/compaction migration, docs/#31 recipe, and consumer lockstep (`entwurf-peek`, semantic-memory).

**Residual notes (not blockers):**
- `readSessionHeader`'s bounded read returns `null` if a header's first line exceeds 8192 bytes (truncated JSON.parse fails silently). Real pi headers are <1 KB so this is 8× margin; if ever tightened, when `newlineIdx < 0 && bytesRead === buffer.length` treat as "header did not fit" explicitly rather than silent null.
- `assertSessionIdAvailableForSpawn` is a **check, not a reservation** (TOCTOU): two same-millisecond parallel spawns could both pass the check before either writes. 6-hex suffix = 16,777,216 space makes a same-second collision ≈ 0, so this is accepted risk at the local-CLI scale. A future `O_EXCL` reservation lock is possible but overengineered now.

### Action plan before implementation

**A. Evidence refresh / source map**
- Re-read llmlog `20260530T123824` sections 2–8 before code.
- Fresh symbol scan only; ignore stale line numbers. Current quick scan after 0.8.2: `taskId` refs ≈ 180 across runtime/tests/docs.
- Produce a current touchpoint map by symbol: `runEntwurfSync`, `runEntwurfResumeSync`, `findEntwurfSessionFile`, `spawnEntwurfResumeAsync`, `activeEntwurfs`, MCP `entwurf_resume`, sentinel, async-resume, cross-cwd, compaction, VERIFY/README/CHANGELOG.

**B. Substrate / dependency gate**
- Bump `@earendil-works/pi-*` dev/peer pins and release-gate pack-install expectations to Pi `0.78.0` because `--name` is required.
- Document runtime requirement: pi `>=0.78.0` for 0.9.0 Entwurf identity.
- Run the 1-call substrate probe once before implementation: `pi --session-id <new-id> --name <test> --provider pi-shell-acp --model claude-sonnet-4-6 --mode json -p 'ok'`; verify header `id`, header `cwd`, persisted name, and file count.

**C. Test-gate design — map T1–T10 to concrete gates**
- Add deterministic gate, likely `./run.sh check-entwurf-session-identity`:
  - T1 grammar validator round-trip against Pi validator
  - T2 parent-side collision pre-check
  - T6 duplicate header-id fail-fast
  - T8 name-on-spawn/no-name-on-resume static or synthetic assertion
  - T10 MCP schema negative renamed to `sessionId`
- Add/extend live gate, likely `./run.sh smoke-entwurf-session-identity <project>`:
  - T3 sync spawn writes exactly one header-id file
  - T4 resume appends, never recreates (**F1 linchpin**)
  - T5 cross-cwd resume uses saved header cwd (#9 guard)
  - T7 identity preservation on resume
  - T9 async spawn has parent-known `sessionId` without stdout
- Wire the new deterministic gate into `pnpm check`/release-gate; wire the live gate into `release-gate` before sentinel/async-resume so identity breakage fails early.
- Update existing smokes instead of duplicating where possible: `cross-cwd-resume-smoke.ts`, `compaction-policy-smoke.ts`, `smoke-async-resume.sh`, `sentinel-runner.sh`, `mcp/pi-tools-bridge/test.sh`.

**D. Consumer blast radius / lockstep updates**
- `agent-config` must be handled in the same campaign or explicitly accepted as broken for new sessions:
  - `skills/entwurf-peek/scripts/entwurf-peek.py` currently discovers children by `entwurf-*.jsonl`.
  - `skills/semantic-memory/SKILL.md` mentions `--session-file-contains _entwurf-`.
- New discovery direction: session header id + session name carrying the `entwurf` tag (`…__entwurf…`), not filename species.
- This is also the bridge toward #30: discovery should be “garden session metadata” flavored, not Pi filename flavored.

**E. Implementation slices after plan is green**
1. Core identity helpers: generate `sessionId`, collision pre-check, `findSessionFileById` header scan, duplicate fail-fast, recorded provider/model extraction.
2. Sync spawn/resume in `entwurf-core.ts`: `--session-id`/`--name`; resume cwd = header cwd; no `--session <file>` in Entwurf path.
3. Async spawn/resume/status in `entwurf.ts` + `entwurf-async.ts`: sessionId-keyed active map, internal `runId`, lazy diagnostic `sessionFile` resolution.
4. MCP/control surfaces: `taskId` → `sessionId`, unknown-session negative, async replyable resume payloads.
5. Tests/smokes/release-gate wiring.
6. Docs and prompts: README/AGENTS/VERIFY/CHANGELOG/tool descriptions; add #31 “parallel Entwurf team” recipe using `sessionId`.
7. Consumer lockstep: update `entwurf-peek` and semantic-memory guidance or record an explicit break decision.

**F. Explicit scope boundaries**
- Remote resume/header discovery (#11) remains out of 0.9.0 unless GLG reopens. Do not pretend local header scan solves remote FS.
- 1.0.0 meta-bridge is not implemented in 0.9.0, but naming and docs must not block it: avoid saying `sessionId` is only a Pi transcript id; prefer garden-native session identity language where accurate.
- Do not build a generic worker-pool orchestrator from #31. Document the advanced pattern; keep the bridge thin.

## Released — 0.8.2 Claude Opus 4.8 transcript poison hotfix

0.8.2 was tagged/released/published on 2026-06-01 KST from `90d1e8d` / `v0.8.2`.

Evidence:
- Release gate: `/tmp/pi-tmux-release-gate-082.log` → `PASS=15 FAIL=0 SKIP=0`, scratch `/tmp/claude-1000/psa-rg-082.HVwOvk`.
- Sentinel: `/tmp/sentinel-20260601-121604.json` inside the release gate and `/tmp/sentinel-20260601-120416.json` focused run, both 6/6 PASS.
- GitHub Release: https://github.com/junghan0611/pi-shell-acp/releases/tag/v0.8.2
- npm: `@junghanacs/pi-shell-acp@0.8.2` published; post-publish registry smoke passed with `pi install npm:@junghanacs/pi-shell-acp@0.8.2` and `pi --no-extensions -e <registry bridge> --list-models pi-shell-acp` showing `claude-sonnet-4-6`.

Follow-up to record upstream, not block 0.9.0:
- `claude-agent-acp` / Claude agent SDK `newSession({mcpServers})` returns before injected MCP servers have deterministic connected/failed status. pi-shell-acp should not add a runtime probe barrier; deterministic readiness belongs upstream (`mcpServerStatus()` or equivalent).
- Avoid the earlier overclaim that the model retried a tool 39× — raw streaming partials inflated that count.

## Released — 0.8.1 package-installed Entwurf ACP routing (#29)

0.8.1 was released/published from `62c3714` / `v0.8.1` on 2026-05-31 KST. The historical prep board below is retained as trace only, not active next work.

## Hotfix before 0.9.0 — 0.8.1 package-installed Entwurf ACP routing (#29)

Oracle surfaced a current-release bug: when `pi-shell-acp` is installed in Pi settings as `git:github.com/junghan0611/pi-shell-acp`, Entwurf ACP spawn cannot resolve the bridge extension for the child `pi --no-extensions` process. `resolveExplicitExtensionSpec()` returns null for `git:` / `npm:` sources, so `provider=pi-shell-acp` child exits with `Unknown provider "pi-shell-acp"` before any session file exists.

Independent from #28 (0.9.0 session identity). This blocks reliable Entwurf routing on every package-installed machine and must ship in 0.8.1. Fix it before leaning on Entwurf for #28 implementation work.

### Root cause (code-confirmed)

- `pi-extensions/lib/entwurf-core.ts:573` — `resolveExplicitExtensionSpec()`:
  ```ts
  if (!source || source.startsWith("git:") || source.startsWith("npm:")) return null;
  ```
  Only local-path package sources are resolved; `git:` / `npm:` early-return null.
- `getRegistryRouting()` (entwurf-core.ts:696-703, spawn path) then only pushes a **warning** and spawns the child anyway → `pi --no-extensions --provider pi-shell-acp` → `Unknown provider`.
- `getEntwurfExplicitExtensions()` (entwurf-core.ts:658-664, **resume path** via `wantsAcpByRecordedProvider`) has the same warning-only hole — resume of a recorded `provider=pi-shell-acp` session also dies on git installs. Both paths must be fixed.
- `resolveConfiguredPackageSource()` (entwurf-core.ts:557) reads only user `~/.pi/agent/settings.json` (`PI_SETTINGS_PATH`, hardcoded at line 44). Project `-l` sources live in `./.pi/settings.json` and are never even seen — a separate scope gap, handle explicitly (resolve or fail-fast, never silent).

### Install-path mapping (from pi substrate, user scope)

Verified in `~/repos/3rd/pi-mono/packages/coding-agent/src/core/package-manager.ts` (`getGitInstallPath` / `getNpmInstallPath` / `getManagedNpmInstallPath`). Replicate the minimal equivalent locally — do **not** import pi internals into entwurf-core:

| source | installed root |
|---|---|
| `git:github.com/junghan0611/pi-shell-acp` | `~/.pi/agent/git/github.com/junghan0611/pi-shell-acp` (`agentDir/git/<host>/<path>`) |
| `npm:@junghanacs/pi-shell-acp` | `~/.pi/agent/npm/node_modules/@junghanacs/pi-shell-acp` (managed); if absent, pnpm/npm-global legacy fallback |
| git project `-l` | `./.pi/git/<host>/<path>` |
| npm project `-l` | `./.pi/npm/node_modules/<name>` |

### Current next — 0.8.1 cut coverage board (2026-05-31 KST)

0.8.1 is no longer just the #29 resolver patch. Treat it as a **deployment-channel reliability hotfix**. Before cut, close or explicitly classify every remaining blind spot below.

**Cut blockers / must close in 0.8.1:**

1. **Final green release-gate artifact.** Next action: create a fresh scratch dir and run `./run.sh release-gate <scratch>` from this commit. Previous run `tmux rg081c` (killed), log `/tmp/pi-tmux-release-gate-081c.log`, scratch `/tmp/claude-1000/psa-rg-081c.6qQznN`, failed at the old `check-bridge` Claude `entwurf_self` forced-call probe. That probe is now removed; `check-bridge` is direct MCP protocol only, while backend tool-callability is owned by `smoke-async-resume` + `sentinel` inside the same release gate.
2. **Hermetic launcher semantics watch.** Release gates must not depend on operator shell state. Current known leak (`PI_SESSION_ID` / `PI_AGENT_ID` into external negative MCP tests) is fixed in `mcp/pi-tools-bridge/test.sh`; no new ambient leak is known. If full release-gate fails in a way that depends on `pia`/shell env, add a `PI_BIN=${PI_BIN:-$(type -P pi)}` or clean-env wrapper then rerun.

**Closed in this 0.8.1 prep commit:**

- `PI_SETTINGS_PATH` env override + deterministic subprocess assertion.
- git+npm package-source live smoke (`smoke-installed-entwurf-acp`) using credential-free provider-registration proof.
- packed tarball topology added to `smoke-installed-entwurf-acp`: `npm pack` → temp managed npm root → settings `npm:@junghanacs/pi-shell-acp` → resolver `-e` → `pi --no-extensions -e <bridge> --list-models pi-shell-acp`; local targeted run passed 2026-05-31 KST.
- `mcp/pi-tools-bridge/test.sh` `[4b]` env-hermetic unknown-taskId negative path.
- `check-bridge` role split resolved: direct MCP `tools/list` + `test.sh` only; backend live tool-callability/orchestration is owned by `smoke-async-resume` + `sentinel`. Local `./run.sh check-bridge` passed 2026-05-31 KST.
- post-publish npm registry smoke checklist added to `.pi/prompts/make-release.md`: temp `PI_CODING_AGENT_DIR` + `pi install npm:@junghanacs/pi-shell-acp@<version>` + resolver `-e` + `pi --no-extensions --list-models`.
- remote topology proof classified/closed: local resolver with git package source produced remote `-e /home/junghan/.pi/agent/git/github.com/junghan0611/pi-shell-acp`; `ssh oracle 'pi --no-extensions -e <remote-bridge> --list-models pi-shell-acp'` passed. Log: `/tmp/psa-remote-routing-081-20260531-162412.log`.
- stale `scripts/sentinel-runner.sh` comment referencing deleted `validate_pi_tools_bridge_backend` removed after peer review.
- packed-tarball smoke peer installs now derive `@earendil-works/pi-*` version from `package.json` devDeps instead of hardcoding `0.77.0`.
- `CHANGELOG.md` / clean-host docs updated to say git+npm, `PI_SETTINGS_PATH`, and gate hardening.
- local gates before commit: `./run.sh check-bridge`, `./run.sh smoke-installed-entwurf-acp`, `./run.sh check-dep-versions`, `pnpm check`, `bash -n run.sh`, `bash -n scripts/sentinel-runner.sh`, `git diff --check` all passed.

### A. Code fix — entwurf-core.ts resolver

- In `resolveExplicitExtensionSpec`, compute `localRoot`/`remoteRoot` per source kind (local / `git:` / `npm:`), then reuse the existing candidate-probe loop (index.ts / extensions/index.ts / dist/... at line 580-601) unchanged.
- `git:` → strip prefix, `path.join(AGENT_DIR, "git", rest)`. `npm:` → managed `node_modules` root first, then decide legacy-global candidate vs explicit unsupported.
- Keep the no-pi-internals-import policy: implement the tiny host/path + node_modules mapping inline.

### B. Fail-fast routing (no warning-only)

- `getRegistryRouting()`: when `provider === "pi-shell-acp"` and bridge unresolved → **throw before spawn**, not warn. Message must list what was checked (local path / git install / npm install) and refuse the unknown-provider child.
- Source present in settings but install dir missing → also fail-fast.
- Apply the same to the resume path (`getEntwurfExplicitExtensions` recorded-provider branch).

### C. Deterministic test — `check-package-source-routing` (no backend, 0 tokens)

Exercise the resolver in isolation with a temp `PI_SETTINGS_PATH` + synthetic install trees. Cover the full matrix:
- local checkout → resolves
- git user, installed → `~/.pi/agent/git/<host>/<path>`
- git user, **install missing → fail-fast**
- npm user → managed root, or explicit unsupported
- project `-l` git/npm → mapped or **explicit unsupported-scope error** (never silent `Unknown provider`)
- no source → null

Consider making `PI_SETTINGS_PATH` env-overridable (like `PI_ENTWURF_TARGETS_PATH`) so the test needn't touch the real settings file.

### D. Live gate — `smoke-installed-entwurf-acp`

Git + npm user package-installed topologies, real Entwurf ACP spawn, assert child no longer dies with `Unknown provider`. Isolate with temp `HOME`/`PI_CODING_AGENT_DIR` so the operator's real `~/.pi/agent/settings.json` is untouched. Use credential-free `--list-models` registration proof before any backend turn.

### E. Release-gate wiring (cut condition)

`./run.sh release-gate <scratch>` is the cut condition, so install-topology must run there — `run.sh` `release_gate()` (line 3712-3810). Add both steps **before** the Entwurf live gates (after step 3 / before `smoke-all`):
```bash
run_step "check-package-source-routing"  gate bash "$self" check-package-source-routing
run_step "smoke-installed-entwurf-acp"    gate bash "$self" smoke-installed-entwurf-acp "$project_dir"
```
Why: current `check-pack-install` (run.sh:2845+) proves tarball shape + `pi -e <node_modules> --list-models` but does NOT simulate Pi settings package sources (`git:` / `npm:`) and never calls Entwurf (`--ignore-scripts` even skips prepare, line 2919). That blind spot is exactly why this bug shipped. Keep `check-pack-install` as-is; add the topology gates alongside.

### F. Docs / repro matrix

Cover all official install paths, not just local checkout:
- npm global `pi install npm:@junghanacs/pi-shell-acp`; npm project `-l`; git global `pi install git:github.com/junghan0611/pi-shell-acp`; git project `-l`; pi.dev/gallery (document exact source/layout, map to the same smoke).
- README install section: distinguish provider-registration smoke (`--list-models` / `smoke-all`) from Entwurf ACP-routing smoke.
- `docs/setup-clean-host.md` Stage 5: promote from two-session `entwurf_send` to a package-source Entwurf ACP spawn check (the bug is child extension injection, not peer messaging).

### G. husky prepare noise (fold in here)

`package.json:91` `"prepare": "husky 2>/dev/null || true"` — no behavior change, just silences the `husky: command not found` stderr on consumer/git-install machines (husky is dev-only; `|| true` already handles exit code, this drops the cosmetic line). Bundle into the same PR.

### Pre-implementation correction checklist (GPT-힣 review, code-verified)

Five corrections to fold into the A–F work so we don't backtrack. All verified against current code.

1. **Respect `PI_CODING_AGENT_DIR` / `PI_SETTINGS_PATH` env — required for the isolated smoke (D).** pi's `getAgentDir()` (pi-mono `config.ts:485`, `ENV_AGENT_DIR = PI_CODING_AGENT_DIR`) reads the env (expand-tilde) before falling back to `~/.pi/agent`. entwurf-core hardcodes `os.homedir()/.pi/agent` at **both line 43 (AGENT_DIR) and line 579 (remoteRoot)**. Make local resolution env-aware:
   ```ts
   const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
   const PI_SETTINGS_PATH = process.env.PI_SETTINGS_PATH
     ? expandTilde(process.env.PI_SETTINGS_PATH)
     : path.join(AGENT_DIR, "settings.json");
   ```
   Without this, `smoke-installed-entwurf-acp`'s temp-HOME isolation can't point the resolver at the synthetic install tree. (Keep remoteRoot on the *remote* homedir — env override is a local-resolution concern; don't leak local env into the SSH path.)

2. **npm root from parsed package name, not `source.slice(4)`.** `npm:@junghanacs/pi-shell-acp` may carry a version/spec (`npm:@scope/name@1.2.3`). Root must be `agentDir/npm/node_modules/<parsed.name>`, so a minimal parser must split `@scope/name` from optional `@version`/spec. Raw-slice would build a wrong path.

3. **Project `-l` gap includes local-path sources, not just git/npm.** pi resolves project local package sources against `cwd/.pi` too; the resolver reads only user `~/.pi/agent/settings.json`, so it misses *all three* project-scope kinds (git/npm/local). 0.8.1 decision: support project scope OR explicit unsupported-scope fail-fast — but **never silent `Unknown provider`**.

4. **Define fail-fast as "explicit ACP intent" — and decide the Claude legacy fallback.** Throw-before-spawn applies to: registry target `provider === "pi-shell-acp"`; resume `recordedProvider === "pi-shell-acp"`; opt-in Codex-via-ACP (`ENTWURF_CODEX_ACP_ENV`). Separately decide the Claude path: `entwurf-core.ts:20-21` says "Claude models always routed through pi-shell-acp, falls back to pi-claude-code-use, then warns" (fallback at line 644-655). Warning-only there is slightly off-principle — choose keep-as-warning vs promote-to-fail-fast explicitly, don't leave it implicit.

5. **Add an `import.meta.url` self-root fallback for local spawn (safety against fail-fast regressions).** entwurf.ts/index.ts currently have NO `import.meta`/`fileURLToPath` self-detection (confirmed). For a local-dev `pi -e /abs/path/pi-shell-acp` where settings has no matching source, fail-fast alone would now throw. The parent extension already knows its own load path: derive the loaded pi-shell-acp root from `import.meta.url` and add it as a resolution candidate — for **local** spawn this is more accurate than settings. Remote spawn still needs settings/source mapping (can't use a local self-root across SSH).

Implementation order (unchanged, with the 5 folded in):
1. resolver: env-aware AGENT_DIR/SETTINGS (1) + git/npm root mapping (2) + self-root candidate (5)
2. spawn + resume warning-only → fail-fast with explicit-intent scope (4), project-scope decision (3)
3. deterministic `check-package-source-routing`
4. live `smoke-installed-entwurf-acp` (relies on 1)
5. release-gate wiring
6. prepare stderr noise

Issue: https://github.com/junghan0611/pi-shell-acp/issues/29

---

## Top priority — 0.9.0 Entwurf garden-native session identity (#28)

Pi 0.76.0 `--session-id` + Pi 0.78.0 `--name` 가 준비되었으므로 Entwurf 세션을 더 이상 특수 `entwurf-*.jsonl` 파일종으로 만들지 않는다.

> **Sessions are born as garden citizens.**

### Non-negotiable direction

- **Breaking change allowed / intended.** 기존 `taskId` / `*entwurf-<taskId>*.jsonl` saved-session 호환은 유지하지 않는다. 이미 필요한 세션은 semantic-memory 축에 임베딩되었다고 보고, 잘못된 구버전 handle 은 깨져야 한다.
- **Public handle = `sessionId`.** `taskId` 는 public schema, help text, result text, docs, tests, comments 에서 제거한다. 필요하면 내부 process-run 식별자는 `runId` 같은 별도 이름으로만 둔다.
- **Spawn uses Pi primitives.** Entwurf spawn 은 직접 session file path 를 만들거나 `--session <file>` 을 넘기지 않고 `pi --session-id <id> --name <session-name>` (locked grammar) 을 넘긴다.
- **Resume uses `--session-id`.** Resume 은 먼저 JSONL header scan 으로 `sessionId` 의 saved session file / header cwd / recorded provider+model 을 찾고, child cwd 를 header cwd 에 맞춘 뒤 `pi --session-id <sessionId>` 로 이어붙인다. `--session <file>` 은 0.9.0 Entwurf path 에서 제거한다.
- **Session file is diagnostic only.** API/문서/테스트의 primary handle 로 `sessionFile` 을 쓰지 않는다. 있으면 디버그 출력에만 둔다.
- **No compatibility comments.** 구버전 taskId / filename convention 을 설명하는 주석·문서가 남아 있으면 agent 가 우회한다. 구현 버전에 맞는 주석·테스트·문서만 남긴다.

### Locked — session identity & name grammar (carry into 0.9.0 / 1.0.0)

규약 확정 (GLG + GPT-힣 + Claude 수렴, 2026-06-03). 이전 `·`-구분 displayName / 4-hex sessionId 예시는 **폐기** — 오해 금지. 이건 0.9.0 Entwurf 만이 아니라 1.0.0 garden session id 까지 잇는 protocol 이다.

**Authority 분리 (모순 없는 한 줄):**
- lookup / resume authority = JSONL header `id` + header `cwd`. **파일명 파싱 절대 금지.**
- model authority = JSONL 최초 `model_change` + resume 재공급 `provider/model`.
- name = 표시 / 검색 / 무결성 mirror. title·tags 는 로직 영향 0.
- name 의 `provider/model` mismatch 는 routing 근거가 아니라 **corrupt-metadata fail-fast** 로만 처리.

**파일명** = Pi 산물 `<created-at>_<sessionId>.jsonl`. Entwurf 특수 파일종(`*_entwurf-<taskId>.jsonl`) 폐기. 탐색 보조로 `*_<sessionId>.jsonl` glob 은 가능하나 최종 authority 는 header scan.

**sessionId** (durable handle = JSONL header id):
```
YYYYMMDDTHHMMSS-[0-9a-f]{6}
예: 20260603T191245-a3f09c
```
timestamp = garden sort 감각, 6 hex = 병렬 spawn collision 방지. 부모가 spawn 전 생성 + `*_<id>.jsonl` glob + header scan 으로 collision / duplicate-header-id (다른 cwd 포함) 를 사전 fail-fast.

**session name** (`--name`; session_info entry 로 저장, header 아님):
```
{sessionId}=={provider}/{model}--{titleSlug}__{tag}_{tag}
```
예:
```
20260603T191245-a3f09c==pi-shell-acp/claude-opus-4-8--review-substrate-smoke__entwurf_review
20260603T191245-b71d02==openai-codex/gpt-5.5--async-resume-check__entwurf_smoke
```
- `==` signature / `--` title / `__` tag-시작 delimiter / `_` tag separator (denote 문법 그대로).
- `{provider}/{model}` = `pi/entwurf-targets.json` **exact tuple**. 정규식으로 모델명 창조 금지 — `.` 있는 model 이 실재한다 (`openai-codex/gpt-5.5`, `pi-shell-acp/gemini-3.1-pro-preview`). exact-match only, `.` 허용.
- `{titleSlug}` = ascii slug, lowercase, hyphen ok, **underscore 금지**. raw title 은 자유 입력으로 받고 builder 가 canonicalize: 공백/유니코드/구두점 → `-`, raw 의 `__` → `-`, 빈 title → `untitled` 또는 task-hint fallback.
- tags = lowercase alnum, `_` separator. **entwurf 여부 = tag 중 `entwurf` 존재** (없으면 Entwurf 세션 아님). 모르면 `__entwurf` 만, 의미 생기면 `review`/`smoke`/`sync`/`async`/`phase1` 추가.
- spawn 때만 name. resume 때 name 재설정 안 함 (substrate 실측 OK).

**Builder / parser 계약:**
- name 직접 문자열 조립 금지. `buildSessionName({ sessionId, provider, model, rawTitle, tags })` 만 사용 — 에이전트가 raw title 을 그대로 붙여 canonical name 을 망가뜨리는 실수 차단.
- parser 는 canonical output 만 파싱. raw title 은 parser 가 보지 않는다 (builder 가 이미 slug 화).

### Smoke design (locked — refines C. T1–T10)

**A. Deterministic — `check-entwurf-session-identity` (no backend, 0 token, `pnpm check` 편입):**
- `T-grammar`: `buildSessionName` 조립 → parser round-trip, 동일 필드. sessionId validator `YYYYMMDDTHHMMSS-[0-9a-f]{6}`. provider/model 은 **registry exact tuple** 검증 (정규식 금지).
- `T-titleSlug`: raw title `"Review substrate smoke / --name 검증"` → `review-substrate-smoke-name` 류 **sanitize** (reject 아님). `__`/underscore/공백/유니코드 정규화 확인.
- `T-name-no-logic`: title/tags 가 바뀌어도 sessionId·lookup 불변.
- `T-model-immut`: spawn name model ≠ recorded model → fail-fast. lookup authority 는 header/model_change, name model 은 integrity mirror 비교만.
- `T-collision`: glob 보조 + header 최종 authority. duplicate header id across cwd 도 fail-fast 포함.

**B. Live — `smoke-session-id-name` (substrate, release-gate 편입). 정직하게 3 cheap sonnet turns:**
- `T1` (same cwd turn1): `pi --session-id <id> --name <denote-name> -e <bridge> --provider pi-shell-acp --model claude-sonnet-4-6 -p ok` → header id==id, header cwd==launch cwd, session_info.name==denote-name (header 아님).
- `T2` (same cwd turn2, `--name` 미공급): 파일 1개 + user/assistant count↑ + 같은 acpSessionId + path=resume + session_info 1개 유지 (**append + spawn-only name**).
- `T3` (wrong cwd turn1, 같은 id): 새 파일 + `incompatible_config` + 새 acp mapping. **실패 아님, footgun evidence** = 0.9.0 resume guard 가 막을 대상 (resume 은 header cwd 로 child cwd 강제, wrong-cwd `--session-id` 호출 금지).

핵심 불변식 (smoke 가 못 박는 것): 파일명 파싱 0회, lookup 은 header id/cwd, name 은 session_info 문자열로만 등장.

### Implementation touch points to specify before coding

- `pi-extensions/lib/entwurf-core.ts`
  - `EntwurfResult.taskId` → `sessionId` 중심으로 타입/formatter 변경.
  - `runEntwurfSync` 에서 `crypto.randomUUID().slice(0,8)` taskId + `cwdToSessionDir()` + `${timestamp}_entwurf-${taskId}.jsonl` 제거.
  - `findEntwurfSessionFile(taskId)` 제거, `findSessionFileById(sessionId)` / header scan helper 로 교체.
  - `runEntwurfResumeSync(taskId, ...)` → `runEntwurfResumeSync(sessionId, ...)` 로 contract 변경.
  - resume invocation 은 `--session-id <sessionId>` 사용. cwd authority 는 saved header cwd 유지 (#9 invariant).
  - `formatSyncSummary` 는 `Session ID:` 를 primary 로 출력. `Task ID:` 제거.
- `pi-extensions/entwurf.ts`
  - async spawn 도 `--session-id` + `--name` 사용.
  - active map key / tool schema / result details / status display 를 `sessionId` 로 변경.
  - `entwurf_status` 는 sessionId 기준으로 조회. process 실행 식별이 필요하면 내부 `runId` 로 분리.
  - `entwurf_resume` schema 의 `taskId` 제거 → `sessionId`.
- `pi-extensions/lib/entwurf-async.ts`
  - `AsyncEntwurfInfo.taskId` public field 제거/변경.
  - `findEntwurfSession(taskId)` filename scan 제거 → header id scan.
  - async resume ack/completion text 의 `Resume ID` / `Original` 표현 재검토: durable handle 은 같은 `sessionId`; 새 실행 구분이 필요하면 `runId` 만 내부/diagnostic 으로 표시.
- `mcp/pi-tools-bridge/src/index.ts`
  - `entwurf_resume` schema `taskId` → `sessionId`.
  - MCP help text 에서 “Task ID from prior entwurf”, “saved entwurf session by taskId”, “`*entwurf-<taskId>*` lookup” 제거.
  - `entwurf` result text도 `Session ID` 를 후속 resume handle 로 안내.
- Tests / smokes
  - `scripts/sentinel-runner.sh`: `*entwurf-*.jsonl` 검색·taskId regex 파싱 제거. tool result / JSON details 에서 `sessionId` 를 파싱.
  - `scripts/cross-cwd-resume-smoke.ts`: `spawn.taskId` → `spawn.sessionId`.
  - `scripts/compaction-policy-smoke.ts`: 동일.
  - `scripts/smoke-async-resume.sh`: taskId 중심 prompt/parsing/negative path 제거.
  - `mcp/pi-tools-bridge/test.sh`: unknown taskId negative → unknown sessionId negative.
  - `run.sh` smoke prose 중 Entwurf resume/taskId 문구 정리.
- Docs / comments
  - AGENTS.md Entwurf section, README, VERIFY, CHANGELOG, MCP descriptions, tool promptGuidelines 에서 taskId/file convention 제거.
  - “legacy fallback” 류 문구 금지. 0.9.0 기준으로만 설명.

### Pre-implementation review evidence

Opus review completed on oracle (code read only, no repo edits):

- Review sessionId: `20260530T123336-opus28`
- Review JSONL: `~/.pi/agent/sessions/--home-junghan-repos-gh-pi-shell-acp--/2026-05-30T03-33-38-357Z_20260530T123336-opus28.jsonl`
- Review stdout log: `/tmp/pi-shell-acp-28-opus-review-20260530T123336-opus28.jsonl`
- Derived llmlog note: `~/org/llmlog/20260530T123824--entwurf-090-가든네이티브-세션정체성-구현전-리뷰__entwurf_llmlog_pishellacp_review_session.org`

핵심 판정: Pi substrate 는 가능하나 `--session-id` cwd-local lookup 때문에 resume cwd 가 틀리면 조용히 새 세션을 만들 수 있다. 0.9.0 의 가장 중요한 guard 는 “resume 이 기존 세션에 append 하는가, 새 세션을 만들지 않는가”다. Async spawn 때문에 sessionId 는 부모가 생성해야 하며, durable `sessionId` 와 per-process `runId` 를 분리해야 한다.

0.9.0 방향 메모: llmlog 는 파생 artifact 일 뿐, garden-native Entwurf 에서는 **세션 자체가 llmlog** 가 된다. 세션 끝에 기록/요약을 남기고, 나중에 sessionId/name/header metadata 로 해당 session JSONL 위치를 찾아오는 기능이 필요하다. 그래야 리뷰/구현 세션을 직접 열어 “제대로 조사했는지”, “무엇을 실수했는지”를 판단할 수 있다.

---

## Ready but parked — 0.8.0 cut (awaiting GLG)

모든 게이트·문서·버전 작업 완료, 프리릴리즈 가능 상태. 결정 trace 와 evidence 는 CHANGELOG 0.8.0 / VERIFY / BASELINE / commit history 에 있다 (여기 로그로 다시 쓰지 않는다). 남은 것은 GLG 승인 후 릴리즈 시퀀스뿐:

1. GLG final review → `git diff` 확인 → commit → push
2. `pnpm publish --access public` (prepublishOnly 가 `pnpm check` + `check-pack-install` 재실행)
3. tag `v0.8.0` + push tag (GitHub release optional)
4. agenda stamp + Google Chat 알림

cut 직전 GLG 가 `./run.sh release-gate <scratch>` 를 한 번 더 돌려 기록용 evidence 를 남긴다 (npm latest 는 cut 전까지 0.7.6).

> **OpenClaw is a separate track.** `plugins/openclaw/` 의 `claude-opus-4-7` (src/dist/config/README) + README:24/61 "1M context on Sonnet 4.6 / Opus 4.7" prose 는 GLG 가 별도 마이그레이션. 0.8.0 cut 에서 건드리지 않는다.

> **Deferred decision — Sonnet async-resume variance.** resume step 2 에서 Sonnet 이 가끔 `mode:'sync'` 를 emit. 현재는 bounded-retry + `MODEL_ARG_OR_ENVELOPE_MISMATCH` 분류로 완화 (model-variance mitigation, product fix 아님). replyable caller 에 async 강제하는 real fix 는 contract 결정 — real-use 실패 shape repro 가 먼저다.

---

## Deferred — not part of 0.8.0 unless GLG reopens

- **`--session-id`** — new pi CLI flag for exact project-local session ids. Entwurf intentionally uses `--session <absolute sessionFile>` (file-identity dependent). Do not rewrite the entwurf path just because the flag exists. Possible pilot: small `run.sh` automation/smoke where fixed IDs improve determinism. Does NOT solve ACP backend continuity footguns from bridge config signature drift.
- **RPC `bash.excludeFromContext`** — pi 0.77 lets RPC clients run bash while keeping output out of the next model prompt. Matters beyond tokens: noisy output pollutes transcript / recall / semantic-memory embeddings. Audit pi-shell-acp / helper / MCP / session-control paths using pi RPC bash. Principle if adopted: operational probes should be observable to the caller without auto-becoming model/embedding context unless explicitly useful.

---

**OpenClaw 쪽은 당분간 진행하지 않는다.** `3a65072 docs(openclaw): recommend native lanes for Claude/Codex, narrow plugin to Gemini` 로 정리한 대로, OpenClaw 5.22 native `claude-cli` 가 Pro/Max 결제 + 1M ctx + workspace skill + live-session 재사용까지 충분히 동작함을 확인했다. Claude/Codex lane 은 OpenClaw native 를 쓰면 되고, 우리 OpenClaw plugin 은 더 밀 필요가 없다.

`pi-shell-acp` 본체는 계속 **pi extension / ACP bridge / entwurf surface** 로 유지한다. OpenClaw plugin 은 “Gemini lane 이 필요할 때 쓸 수 있는 보조 어댑터” 정도로 parked.

---

## Standing focus — Asymmetric Mitsein with Claude Code

(0.8.0 캠페인과 병행하는 상시 초점. 릴리즈 게이트 작업이 끝나면 다시 전면으로.)

당분간 초점은 **비대칭 공존(Asymmetric Mitsein)** 이다. `pi-shell-acp` 를 OpenClaw plugin 쪽으로 더 밀기보다, **pi session ↔ Claude Code / external MCP host ↔ pi-tools-bridge ↔ entwurf** 가 서로 다른 하네스 정체성을 유지하면서 함께 일하는 시나리오를 검증한다.

핵심 질문:
- Claude Code 쪽에서 `pi-tools-bridge` MCP surface 를 통해 pi session / entwurf 와 자연스럽게 협업하는가?
- 외부 MCP host 는 replyable 하지 않다는 비대칭을 agent 가 정확히 이해하는가?
- `entwurf_send` 는 fire-and-forget, `entwurf` / `entwurf_resume` 는 outcome ownership 이라는 역할 분담이 실제 워크플로에서 헷갈리지 않는가?
- Claude Code 가 설계/리뷰하고 pi-shell-acp 세션이 실행하거나, 반대로 pi 가 Claude Code 쪽 맥락을 불러 협업하는 시나리오가 문서/로그/UX 상 정직한가?

테스트 시나리오 후보:
1. **Claude Code → live pi session send** — `entwurf_peers` 로 sessionId 확인 → `entwurf_send(mode=follow_up)` 로 작업 전달 → receiver 가 sender envelope / external non-replyable 상태를 오해하지 않는지 확인.
2. **Claude Code → pi-native entwurf** — external MCP host 의 sync path 와 pi-native async path 차이를 명확히 기록; 긴 작업은 pi session 안에서 async entwurf 로 넘기는 패턴 확인.
3. **pi session ↔ Claude Code 역할 분리** — Claude Code: 설계/리뷰/코드 읽기, pi-shell-acp: 실행/검증/entwurf orchestration. 서로 forward 하지 않고 GLG가 역할을 정하는 패턴 유지.
4. **세션 연속성 + 비대칭 공존** — 아래 session continuity hygiene footgun 과 결합 테스트.

성공 기준:
- 각 시나리오에서 “누가 outcome 을 소유하는가”가 명확하다.
- replyable / non-replyable, send-is-throw, MCP `entwurf_resume` 조건부 async default(0.7.6)와 external non-replyable sync-default/reject 경계가 agent 발화에 정확히 반영된다.
- 필요한 경우 README / AGENTS / VERIFY 중 한 곳에 운영 패턴으로 정리한다.

---

## Active hygiene — session continuity

같은 pi 세션을 resume할 때 실행 옵션이 달라지면 bridge config signature 가 달라져 ACP backend session 이 `incompatible_config` 로 invalidate 된다.

대표 footgun:

```bash
pi --entwurf-control --emacs-agent-socket server   # 평소 alias
pi                                                  # 테스트로 plain 실행
```

현재 결론:
- 사용자가 일관되게 alias 로 실행하면 문제 없음.
- 직접 원인 후보는 `--emacs-agent-socket server` 누락. 이 값이 `bridgeConfigSignature` 에 들어감.
- pi JSONL 세션은 남지만, Claude ACP backend 세션 매핑이 새로 만들어져 모델이 이전 맥락을 모르는 것처럼 반응한다.

다음 작업 후보:
1. `incompatible_config` 로그에 diff 출력 (예: `emacsAgentSocket: null -> "server"`) — 어떤 축 때문에 invalidate 됐는지 보여주기.
2. `PI_SHELL_ACP_STRICT_BOOTSTRAP=1` 운영 문서화 또는 UX 검토 — silent new 대신 fail-fast 로 잡을 수 있는지.
3. `emacsAgentSocket` 을 session compatibility 축에 넣는 게 맞는지 재검토.

검증 기준: alias 실행 → resume/load 유지 / plain 실행 후 alias 복귀 → 현재는 `incompatible_config`, 개선 후 원인 diff 명확 / `./run.sh verify-resume <project>` 또는 작은 live smoke 로 확인.

---

## Main backlog — #25 lessons from OpenClaw audit

OpenClaw 5.22 native `claude-cli` audit lesson 을 **pi-shell-acp 본체 품질**로 흡수한다 (plugin 확장이 아니라 bridge hygiene).

우선순위:
1. **Transcript pre-flight** — backend native jsonl 위치 verifier (Claude `CLAUDE_CONFIG_DIR`, Codex `CODEX_HOME`/`CODEX_SQLITE_HOME`, Gemini `GEMINI_CLI_HOME`).
2. **Invalidation reason taxonomy** — 지금 `incompatible_config` 가 너무 넓다. 후보: `auth-profile`, `auth-epoch`, `system-prompt`, `mcp`, `transcript-missing`, `emacs-socket`, `tool-surface`.
3. **Session cache hygiene** — `acp-bridge.ts` bridge session cache 에 idle timeout / LRU / max-N cap 검토.

나중 후보: fingerprint-keyed reuse (skills snapshot + extra system prompt hash 축); single-turn lock per session (같은 sessionId 동시 prompt 진입 throw).

---

## Reference paths

- 본체: `~/repos/gh/pi-shell-acp/`
- OpenClaw source: `~/repos/3rd/openclaw/`
- OpenClaw plugin stub: `plugins/openclaw/`
- Consumer: `~/repos/gh/agent-config/`
- NixOS consumer: `~/repos/gh/nixos-config/`

---

## Parked — do not pick unless GLG reopens

### OpenClaw plugin / packaging

- Phase 3.6 self-contained install
- ClawHub trust mark elevation
- plugin embedded runtime / child `pi` removal
- OpenClaw delivery layer progress/final channel split
- Oracle Docker image 3-layer install
- agent-config server-mode `pi-shell-acp` ref 복귀
- Gemini bot usage 표시 갭

이유: OpenClaw native `claude-cli` / `openai-codex` 가 이미 충분히 좋다. Gemini lane 은 필요 시 재개.

### Long-term / separate issues

- #11 remote SSH resume cwd alignment
- #10 broader ontology RFC
- #8 ACP `entwurf_send` message visibility UX
- #2 pi-first context meter
- L5 long soak with repeated context-pressure events
- Remote entwurf cleanup

---

## Closed baseline reminders

- `@junghanacs/pi-shell-acp@0.7.6` published (latest before 0.8.0 campaign).
- `@junghan0611/openclaw-pi-shell-acp@0.0.1` published 2026-05-21 (confirmed live on npm 2026-05-29), parked — no work since publish. README must reflect *published-but-parked*, not "not yet published" (OpenClaw track, GLG handles).
- Recommended routing as of 2026-05-26: Claude → OpenClaw native `claude-cli`; Codex → OpenClaw native `openai-codex`; Gemini → `pi-shell-acp` ACP lane if richer MCP/skill surface is needed.
