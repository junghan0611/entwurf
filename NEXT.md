# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE / README / AGENTS / 코드로 보낸다.

## Top priority — 0.8.0 release campaign (dependency alignment + full test gate)

**Baseline:** 0.7.6 released (async-resume regression closed; see CHANGELOG 0.7.6 + commit chain `ff85fa9 → … → d198da0`). pi host is now `0.77.0`. GPT-5.5 reviewed five times (pi 0.77.0 release notes → NEXT 1차 → hardened plan → **code-level audit against local dep + pi 0.77 source** → final precision polish); all reinforcements folded into the steps (see reference below). The code-level pass confirmed dep bump has no breaking change, the #26 sentinel registers cleanly, and Opus 4.8 is real in the pi 0.77 registry — while upgrading `-xt` from "smoke candidate" to an ACP-backend-wide release-blocking fix. Target: **bump every dependency to latest, fix the auth-boundary bug ([#26](https://github.com/junghan0611/pi-shell-acp/issues/26), CRITICAL), consolidate a single all-pass release gate, then cut 0.8.0.**

Sequenced — each step verified before the next. **GLG makes the final commit.** Execution model: GPT-5.5 (sync) for design review, GPT-5.4 for test cycles, GLG + Claude for final verification. Test invocation is ALWAYS through `run.sh` subcommands — never call a script in `scripts/` directly.

> **Order note (GPT-5.5 third review, reinforcement 5):** gate plumbing comes FIRST, before the dependency bump — otherwise the bump has no consolidated gate to be verified against. Steps are: **gate hardening → dep bump → opus 4.8 → docs → final full-gate run + cut.**

### Step 1 — Gate hardening & consolidation (plumbing FIRST)

Build the single release gate *before* touching dependencies, so every later step is verified by it. Deliverable: **one `run.sh` subcommand that, when green, is sufficient to release.** Nothing in `scripts/` is ever called directly — always via `run.sh`.

**1a. Name the two axes clearly** (this is the "smoke vs check 뭐가 다른가" confusion — the `check-`/`smoke-` prefix does NOT currently separate static from live):
- **Static / deterministic** (no API, no backend subprocess; fast, free, pre-commit safe): `lint`, `typecheck`, `check:plugins`, `check-mcp`, `check-shell-quote`, `check-plugin-empty-final-recovery`, `check-plugin-prompt-format`, `check-async-resume-gate`, `check-models`, `check-backends`, `check-registration`, `check-dep-versions`, `check-sdk-surface`, `check-pack`, **`check-model-lock`**, **`verify-transcript-poison`**. → `pnpm check`'s job. (Confirmed 2026-05-29: pre-commit hook already runs `pnpm check` and it passes — so this set is the existing pre-commit floor.)
- **Live / runtime** (spawns a real backend, costs tokens — fine, all subscription): `smoke-all` (3-backend), `smoke-async-resume`, `smoke-continuity`, `smoke-cancel`, `smoke-model-switch`, `smoke-entwurf-resume`, `check-bridge`, `check-native-async`, `sentinel`, `session-messaging`, `smoke-compaction-policy`, `verify-resume`.
- **Naming smell to fix:** `check-bridge` / `check-native-async` are `check-`-prefixed but are LIVE. Rename or document so the prefix is honest.

**1b. Fold the two missing deterministic gates into `pnpm check`:** `check-model-lock` + `verify-transcript-poison` (both no-API per their usage text). The static set must be honestly complete.

**1c. Extend `check-dep-versions` (reinforcement 2):** today it only asserts `claude-agent-acp`, `codex-acp`, README codex pin (`run.sh:2515`, "6 assertions"). It does NOT check `@earendil-works/pi-{ai,coding-agent,tui}` nor the `check-pack-install` peer-install pin. Add those assertions BEFORE the bump so Step 2's bump is actually gated. (Doing 1c first means the bump can't drift silently.)

**1d. Dedup audit, then bundle** — GPT-5.5 third-review verdict on overlap:
- **`smoke-continuity` vs `smoke-entwurf-resume` → real overlap.** `smoke-entwurf-resume` is the superset (asserts `acpSessionId` identity + assistant turn count + blank-assistant guard + fallback/invalidate guard). Keep `smoke-entwurf-resume` in the release gate; demote `smoke-continuity` to a dev quick-smoke.
- **NOT duplicates — each a unique invariant, keep all:** `smoke-entwurf-resume` (bridge same-session ACP-id continuity) vs `sentinel` (real entwurf spawn/resume orchestration + target registry + identity + semantic recall matrix); `smoke-async-resume` (MCP replyable async resume + followUp + external non-replyable reject) vs `sentinel` (sync spawn/resume matrix); `check-bridge` (pi-tools-bridge MCP visibility/invocation across ACP backends) vs `check-native-async` (native extension async spawn, stale `explicitExtensions` regression class).
- **`verify-resume` (reinforcement 3):** carries a cross-cwd resume regression gate — NOT covered by the above. Either add it to the release gate or document explicitly that `smoke-entwurf-resume`/`sentinel` subsume it (they don't fully — keep it).

**1e. Build `./run.sh release-gate`** (working name): `pnpm check` (full static) → every surviving live gate → one consolidated PASS/FAIL/SKIP summary with artifact paths, fail-closed.
- **Gemini skip = FAIL at release (reinforcement 1), applied to EVERY skip-capable subcommand:** `smoke-all`, `check-bridge`, `smoke-async-resume` all currently exit 0 on Gemini SKIP. 0.8.0 makes a three-backend claim → release-gate must treat SKIP>0 as FAIL (via an internal `--require-gemini` mode or summary-artifact parsing). A dev-only `--allow-skip-gemini` may exist for iteration; the default release path does NOT skip.
  - **Precise rule (GPT-5.5 5th review):** distinguish **backend-availability SKIP** (Gemini not installed/authed) — which is FAIL at release — from a **documented N/A / observed-negative invariant outcome**. Example: `smoke-compaction-policy`'s Gemini `/compact` is a documented ACP-asymmetry "observed negative", not an availability skip. So the gate rule is: *backend-availability SKIP = FAIL; a documented N/A / observed row is allowed only when it is an explicit, recorded invariant outcome (not a silent skip).* The summary must label which kind each non-PASS is.
- **Coverage is per-invariant, not "all live across 3 backends" (reinforcement 2):** `sentinel` is a 6-cell diagonal with no Gemini cell; `session-messaging`'s ACP target is Claude-only. So state it precisely: *backend-runtime* invariants (`smoke-all` etc.) must PASS on Claude/Codex/Gemini; *orchestration* invariants (`sentinel`, `session-messaging`) PASS on their current matrix, and any Gemini-absent matrix is either documented-with-reason or gets a cell added — not silently labeled "3-backend".
- **`smoke-compaction-policy` must run LIVE (reinforcement 4):** pin `LIVE=1 ./run.sh smoke-compaction-policy` inside the gate, else its backend-observation steps are skipped.
- **ACP backend `exclude-tools` policy — a RELEASE-BLOCKING FIX, not just a smoke (code-level confirmed, GPT-5.5 4th review; scoped to all backends per 5th review).** Name it the **pi-shell-acp ACP backend exclude-tools policy**, NOT a "Claude fix" — Codex/Gemini have differently-named native tools and the same truthfulness problem applies. The divergence is real in code:
  - pi 0.77 removes `-xt` tools from the active set + system prompt: `cli/args.ts:117-121` (parse), `sdk.ts:282-288` (`excludedToolNames`), `agent-session.ts:2275-2358` (`isAllowedTool`), regression test `5109-exclude-tools.test.ts:42-53`.
  - BUT pi-shell-acp's backend keeps its own fixed tool list: `index.ts:630-648` (Claude default `Read/Bash/Edit/Write`), `index.ts:950-960` (`ensureBridgeSession({tools: providerSettings.tools})`), `acp-bridge.ts:1167-1186` (`_meta.claudeCode.options.tools = params.tools`). So `pi --provider pi-shell-acp -xt Bash` drops `bash` from pi's declared/prompt surface while Claude Code still receives `Bash` → **declared ≠ actual.** Codex (`exec_command/apply_patch/...`) and Gemini (`run_shell_command/...`) have the same gap under their own tool names.
  - **0.8.0 decision (pick one, applied across all three backends):** (a) implement per-backend exclusion mapping — translate pi's `-xt` names into each backend's `tools`/`disallowedTools` so the exclusion actually reaches the backend; OR (b) **fail-fast** in pi-shell-acp whenever `-xt` cannot be honestly reflected in the backend tool surface. Then add the live gate that asserts, per backend, that an excluded tool is either denied at the backend or rejected up front.
- **Auth-boundary static guards (#26, see Step 2b):** add two deterministic guards to the gate — (1) root bridge code contains no `ANTHROPIC_API_KEY` literal; (2) the bridge path does not consume `options.apiKey` as backend auth. These belong in `pnpm check` (static) and stay green permanently after the Step-2b fix.
  - **Scope the guard tightly (GPT-5.5 5th review):** restrict guard 1 to **root bridge code only — `index.ts`, `acp-bridge.ts`** — and bake that scope into the test name (e.g. `check-no-anthropic-key-literal-in-root-bridge`). `ANTHROPIC_API_KEY` legitimately survives as history in `NEXT.md` / `CHANGELOG.md` / issue #26 prose; a repo-wide grep would false-positive on those. The guard targets runtime bridge source, not docs.

**1f. `prepublishOnly` = static+pack subset (DECIDED, GPT-5.5 5th review).** Do NOT put the full live gate in `prepublishOnly`: it depends on auth/Gemini/tmux/token spend and would break the `npm publish` UX. Keep `prepublishOnly` = `pnpm check` + `check-pack-install` (static + pack). Instead, **make a green `./run.sh release-gate` artifact a documented publish prerequisite** — record it in CHANGELOG/VERIFY/BASELINE and the publish runbook, so the full live gate is a mandatory manual step *before* `npm publish`, not part of the lifecycle hook. No implicit shortcut; the requirement is written down, not enforced by the npm hook.

> Principle: **a release is valid only when the full set passed.** Adding a feature adds a test; the test joins the release gate. No backend-specific or sync-only shortcut counts as "tested."

### Step 2 — Dependency bump (verified by the Step-1 gate)

| Package | Current pin | Latest | Where |
|---|---|---|---|
| `@earendil-works/pi-{ai,coding-agent,tui}` | `0.75.4` | **`0.77.0`** | `package.json` devDeps |
| `@agentclientprotocol/claude-agent-acp` | `0.36.1` | **`0.38.0`** | `package.json` deps |
| `@zed-industries/codex-acp` | `0.14.0` | **`0.15.0`** | `package.json` deps |
| `@agentclientprotocol/sdk` | `0.22.1` | `0.22.1` | already latest — no change |

Pin sites to update in lockstep (grep `0.75.4` / `0.14.0` / `0.36.1`):
- `package.json` deps + devDeps.
- `run.sh` `CLAUDE_ACP_REQUIRED_VERSION` / `CODEX_ACP_REQUIRED_VERSION` (separate hardcoded pins, `run.sh` ~check-pack-install region).
- `README.md:113` install snippet (`@zed-industries/codex-acp@0.14.0`) + any pi-version prose in docs.
- After `pnpm install`, confirm **`pnpm-lock.yaml`** updated (reinforcement 5 extra).

`claude-agent-acp 0.36.1 → 0.38.0` and `codex-acp 0.14.0 → 0.15.0` are minor backend-SDK bumps — the Step-1 gate (`check-sdk-surface` + live `smoke-all` + 3-backend) is exactly what proves the bridge cast annotations and runtime still hold. The strengthened `check-dep-versions` (1c) now fails if any pin drifts.

**Code-level: no breaking change in the SDK surfaces we use (GPT-5.5 4th review).** Every method/event pi-shell-acp calls is preserved across the bump:
- Claude 0.38.0 (`claude-agent-acp/src/acp-agent.ts`): `loadSession`/`resume`/`close` caps (`:607-631`), `newSession`/`resumeSession`/`loadSession` (`:645-687`), `prompt` (`:726-790`), `cancel` (`:1372-1382`), `closeSession` (`:1404-1409`), `unstable_setSessionModel` (`:1422-1435`), `usage_update` shape (`:982-998`) — all match our calls in `acp-bridge.ts:2488-2505/3129-3199/2589-2603/3441-3452/2680-2683`. 0.37's `"cancelled"` stopReason is already handled (`index.ts:811-819` → `"aborted"`).
- Codex 0.15.0 (`codex-acp/src/codex_agent.rs`): the 0.14→0.15 release commit is version-bump-only (no protocol method change); `new_session`/`load_session`/`close_session`/`prompt`/`cancel`/`set_session_model` all present (`:543-794`), `resumeSession` still unadvertised so our detection correctly routes to `loadSession`.

### Step 2b — Auth-boundary correction (#26) — CRITICAL, must ship in 0.8.0

**Issue [#26](https://github.com/junghan0611/pi-shell-acp/issues/26).** The pi 0.77 bump (Step 2) surfaces a real boundary bug, so fix it here. `index.ts:1190` registers the provider with `apiKey: "ANTHROPIC_API_KEY"` — a validation shim, never real auth. (Precise: pi DOES pass `options.apiKey` into `streamSimple` via `sdk.ts:339-355`, but our `streamShellAcp` reads only `options.cwd`/`options.sessionId` — `index.ts:822-855` — so it never consumes it as backend auth; `index.ts:1190` is the only root occurrence.) Under pi 0.77 this prints a legacy-env-reference deprecation warning AND falsely presents pi-shell-acp as Anthropic-API-key dependent — even for Codex/Gemini routes, which share this single registration.

**Code-level confirmation the sentinel fix works (GPT-5.5 4th review):**
- Deprecation warning is gated by a legacy-env regex `/^[A-Z_][A-Z0-9_]*$/` (`resolve-config-value.ts:13`, warning emitted at `model-registry.ts:239-244`). `ANTHROPIC_API_KEY` matches → warns; `pi-shell-acp-no-auth` (lowercase + hyphen) does NOT match → no warning.
- Custom-model registration requires `baseUrl` + (`apiKey` or `oauth`) but does NO format validation — any truthy string passes (`model-registry.ts:911-925`); `hasConfiguredAuth` only checks `isConfigValueConfigured` (`model-registry.ts:713-718`), and a literal string is "configured" (`resolve-config-value.ts:135-140`). → the sentinel registers fine and `ANTHROPIC_API_KEY` unset does not block startup.

- **Fix: replace with an explicit no-auth sentinel**, not `$ANTHROPIC_API_KEY` (that would silence the warning but keep the wrong auth-boundary shape):
  ```ts
  const PI_SHELL_ACP_NO_AUTH_SENTINEL = "pi-shell-acp-no-auth";
  // Not real auth. pi.registerProvider requires apiKey/oauth for custom models;
  // streamShellAcp ignores options.apiKey. Backend auth belongs to the official
  // Claude/Codex/Gemini CLI child process.
  apiKey: PI_SHELL_ACP_NO_AUTH_SENTINEL,
  ```
- **Auth invariant (the reason this matters):** pi-shell-acp does not provide/proxy/copy/require Claude/Codex/Gemini credentials — it spawns the official backend CLI and lets that CLI use its own auth state. The pi-facing registration is only a model-catalog + `streamSimple` surface.
- **NOT this class:** `plugins/openclaw`'s `apiKey: "pi-shell-acp-delegated"` is a non-secret host-adapter sentinel, not a legacy-env reference — leave it.
- **Verification (folded into the Step-1 release gate):**
  - Live: startup on pi 0.77 emits NO `registerProvider("pi-shell-acp") apiKey` deprecation warning; `ANTHROPIC_API_KEY` unset does not block provider registration / smoke startup.
  - Static guard 1: root bridge code (`index.ts` / `acp-bridge.ts`) contains no `ANTHROPIC_API_KEY` literal.
  - Static guard 2: `streamShellAcp` / bridge path does not consume `options.apiKey` as backend auth.
  - Existing Claude/Codex/Gemini smokes still pass after the bump.
- **0.8.0 CHANGELOG:** frame transparently as an **auth-boundary correction**, not merely a warning cleanup.

### Step 3 — Opus 4.7 → 4.8 (REPLACE — 4.8 only)

**Decision (GLG, 2026-05-29): support 4.8 only.** Live surfaces replace `claude-opus-4-7` → `claude-opus-4-8`; VERIFY/CHANGELOG history rows keep `4-7` as historical evidence (do not rewrite history).

pi 0.77 added `claude-opus-4-8` metadata, but pi-shell-acp is a **curated surface** — it does NOT auto-expose. All live sites change in lockstep (grep `claude-opus-4-7`, ~20 sites):

- `index.ts:198` `SUPPORTED_ANTHROPIC_MODEL_IDS` + `:284`/`:288` placeholder injection (+ comments `:231`, `:317`)
- `pi/entwurf-targets.json` entry
- `run.sh` model gates: `:944` model-switch smoke, `:2382` / `:2422` / `:2480` `check-models` lists
- `scripts/check-model-lock.ts:214` `PSA_OPUS`
- `plugins/openclaw/src/index.ts:245-267` **AND `plugins/openclaw/dist/index.js:69-91`** — plugin `main` is `dist/index.js`, so source-only edits leave the runtime stale (reinforcement 4). Either `pnpm --filter ./plugins/openclaw build` to regenerate dist, or hand-sync both; `check:plugins` catches type drift but NOT a stale literal — verify `dist` matches `src` after (consider adding a src/dist literal-drift check).
- `plugins/openclaw/README.md`, `plugins/openclaw/examples/docker-lab/*` (README + `config/openclaw.json`)
- docs surfaces: `demo/README.md:115`, `docs/setup-clean-host.md:199/228`
- **4.8 is REAL in pi 0.77 — do NOT clone the placeholder, fail-fast instead (code-level confirmed, GPT-5.5 4th review).** `claude-opus-4-8` exists in `pi-mono/packages/ai/src/models.generated.ts:1866-1884` (`contextWindow: 1000000`, `maxTokens: 128000`). The `index.ts:282-292` placeholder branch only exists because `4-7` wasn't always in the registry; since `4-8` IS present, **remove/skip the placeholder for 4-8 and make a missing registry entry FAIL** rather than papering it with an injected placeholder. `check-models` asserts `claude-opus-4-8` present + 1M — a metadata gap must fail the gate.
- **Bonus:** `claude-agent-acp 0.38.0` already ships Opus 4.8 support (`CHANGELOG.md:3-13`) — so the backend SDK side is ready once Step 2's bump lands.
- Add Claude runtime smoke / interview evidence on 4-8 before release.

### Step 4 — README / docs / OpenClaw metadata corrections

OpenClaw publish status is self-contradictory across three files (reinforcement 3). `@junghan0611/openclaw-pi-shell-acp@0.0.1` IS live on npm (confirmed 2026-05-29) but parked. Separate the two axes — **npm: published-but-parked** vs **ClawHub: not published**:

- **`README.md:130`** says "not published to npm or ClawHub yet" — wrong on the npm half. Fix to: published to npm as `0.0.1` (parked, no work since), not on ClawHub.
- **`README.md:92`** already says "ships as its own npm package" — reconcile so :92 and :130 tell the same story.
- **`plugins/openclaw/package.json`** has `openclaw.release.publishToNpm: false` while 0.0.1 is on npm. Re-examine: either stale (flip) or means "no CI auto-publish" (document that). `publishToClawHub: false` stays correct.
- Reconcile any version strings touched in Steps 2–3 (`check-dep-versions` enforces most).

### Step 5 — Final full release-gate run + cut 0.8.0

- Run `./run.sh release-gate` end-to-end with **no skips** (Gemini included) — this is the gate that authorizes the release.
- Record live evidence in `CHANGELOG.md` / `VERIFY.md` / `BASELINE.md` (3-backend PASS + artifact paths).
- Version bump, CHANGELOG 0.8.0, publish, agenda stamp + Google Chat notify.

---

## GPT-5.5 review of pi 0.77.0 release notes (2026-05-29) — reference

Incorporated into Steps 1–3 above; kept here for trace.

- **devDependency alignment — confirmed.** 0.75.4 → 0.77.0, min gate: `pnpm install` + `typecheck` + `check-registration` + `check-dep-versions` + `check-models`.
- **`--exclude-tools` / `-xt` — the new axis to watch.** pi native can hide tools (`pi --provider pi-shell-acp -xt Bash`), but the Claude backend hands Read/Bash/Edit/Write to Claude Code itself → pi's declared tool surface and the backend's actual surface may diverge, conflicting with our "declared tools == actual tools" invariant. Not an immediate break, but needs a **focused smoke**: does `-xt Bash` make pi-shell-acp lie about its tool surface? Operationally: `-xt Read/Bash/Edit/Write` still risky on pi-shell-acp sessions; `-xt entwurf` / `-xt entwurf_send` (extension tools) disable as intended.
- **`session_shutdown` signal fix — positive.** 0.77 guarantees `session_shutdown` cleanup on SIGTERM/SIGHUP. This repo depends on it (ACP child cleanup, control-socket cleanup, session env/status cleanup) in `index.ts` + `pi-extensions/entwurf-control.ts`. Upstream leak reduction — verify our cleanup paths still fire under it.
- **`streamingBehavior` — no current impact.** Our extensions don't use `InputEvent.streamingBehavior` directly. Touches `entwurf_send` steer/follow_up semantics — reference for future live peer-messaging UX work.
- **Codex headless subscription login — indirect positive.** Default entwurf target is `openai-codex/gpt-5.4`; native Codex login on headless hosts gets easier. Candidate note for `docs/setup-clean-host.md`.
- **NEW axis to add as a Step-3 smoke candidate:** `-xt` tool-surface truthfulness check.

### GPT-5.5 second review — of this NEXT plan (2026-05-29)

Verdict: NEXT adoptable; four reinforcements needed. All four folded into the steps above:

1. **Release gate must NOT skip Gemini at final release** — three-backend claim ⇒ all three actually PASS; `--allow-skip-gemini` is dev-only, default = skip-is-fail. → Step 1e.
2. **`check-dep-versions` doesn't check pi devDeps** — only claude-agent-acp/codex-acp/README codex pin today; add `@earendil-works/pi-{ai,coding-agent,tui}` + `check-pack-install` peer pin. → Step 1.
3. **OpenClaw metadata conflict** — README:92 vs :130 vs `package.json publishToNpm:false`; split "ClawHub not published / npm published-but-parked". → Step 4.
4. **Opus 4.8 must sync generated dist** — `plugins/openclaw/dist/index.js` still has `claude-opus-4-7`; plugin main is dist, so source-only edit drifts. Also `check-models` must verify 4.8 registry presence + 1M context, not let placeholder injection hide a metadata gap. → Step 3.

### GPT-5.5 third review — of the hardened plan (2026-05-29, sync entwurf `a7c28e15`, 11 turns / $0.76)

Verdict: adoptable; **6 more fixes**. All folded into Steps 1–5 above:

1. **Gemini skip=fail must apply to EVERY skip-capable subcommand** (`smoke-all`, `check-bridge`, `smoke-async-resume` all exit 0 on SKIP today), not just the abstract "final gate". → Step 1e.
2. **"all live across 3 backends" is inaccurate** — `sentinel` is a 6-cell diagonal (no Gemini), `session-messaging` is Claude-only ACP. Restate as per-invariant coverage. → Step 1e.
3. **`verify-resume` is a missing audit candidate** — carries a cross-cwd resume regression gate not subsumed by `smoke-entwurf-resume`/`sentinel`. → Step 1a/1d.
4. **`smoke-compaction-policy` must be pinned `LIVE=1`** in the gate, else backend-observation steps skip. → Step 1e.
5. **Order: gate hardening BEFORE dep bump** — otherwise the bump isn't verified by the new gate. → step reordering (now Step 1 = gate, Step 2 = bump). Also: confirm `pnpm-lock.yaml`, add src/dist literal-drift check.
6. **`prepublishOnly` scope must be explicit** — full live gate vs static+pack subset; live gate is auth/Gemini/tmux-heavy for the publish lifecycle. → Step 1f.

Dedup verdict (Step 1d): only `smoke-continuity` is a real overlap (subset of `smoke-entwurf-resume`); all other pairs are distinct invariants — keep them.

### GPT-5.5 fourth review — code-level audit vs local source (2026-05-29, sync resume `a7c28e15`, 62 turns / $6.09)

Read the actual implementations in `3rd/acp/{claude-agent-acp@0.38,codex-acp@0.15,agent-client-protocol}` + `3rd/pi` (pi 0.77), not just type signatures. Verdict: **NEXT adoptable; 3 fixes.** All folded above.

- **Dep bump — no release blocker.** Claude 0.38.0 / Codex 0.15.0 preserve every method+event we call (file:line in Step 2). 0.15.0 release commit is version-only. → confidence the bump won't break the bridge.
- **#26 sentinel — works at code level.** Legacy-env regex won't match the lowercase-hyphen sentinel (warning avoided); custom-model registration does no format validation (sentinel registers). → Step 2b.
- **Opus 4.8 — real in registry** (`models.generated.ts:1866-1884`, 1M). → Step 3 hardened to fail-fast, not clone the placeholder.
- **session_shutdown — our handlers already on the pi 0.77 dispose path** (`interactive-mode.ts:3256-3345`, `print-mode.ts:40-58`, `agent-session-runtime.ts:377-383`). No new signal handler needed.
- **FIX 1 — `-xt` is release-blocking, not a smoke** (real `declared ≠ actual` path: `index.ts:630-648` + `acp-bridge.ts:1167-1186`). → Step 1e rewritten as a fix + gate.
- **FIX 2 — Opus 4.8 fail-fast, no placeholder clone.** → Step 3.
- **FIX 3 — #26 wording** ("pi passes `options.apiKey`; `streamShellAcp` doesn't consume it" — not "streamSimple doesn't pass it"). → Step 2b.

### GPT-5.5 fifth review — final polish (2026-05-29)

Verdict: NEXT is a solid 0.8.0 work map; order (gate→bump→#26→4.8→docs→full gate) is correct. 5 precision fixes, all folded:

1. **"no skips" precision** — backend-availability SKIP = FAIL, but a *documented N/A / observed-negative* invariant outcome (e.g. `smoke-compaction-policy` Gemini `/compact` ACP-asymmetry) is allowed when explicit. → Step 1e.
2. **`-xt` is an ACP-backend-wide policy, not a Claude fix** — Codex/Gemini have the same truthfulness gap under different tool names; decide per-backend mapping vs fail-fast across all three. → Step 1e renamed.
3. **Stale ref** — second review's `→ Step 3.3` is now `→ Step 1e`. → fixed.
4. **#26 guard scope** — restrict to root bridge (`index.ts`/`acp-bridge.ts`) and bake scope into the test name; `ANTHROPIC_API_KEY` stays as history in docs/issue. → Step 1e.
5. **`prepublishOnly` = static+pack subset** — full live gate is too auth/Gemini/tmux-heavy for the npm lifecycle; make a green `release-gate` artifact a documented publish prerequisite instead. → Step 1f decided.

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
1. **Claude Code → live pi session send**
   - `entwurf_peers` 로 sessionId 확인
   - `entwurf_send(mode=follow_up)` 로 pi session 에 작업 전달
   - receiver 는 sender envelope / external non-replyable 상태를 오해하지 않는지 확인
2. **Claude Code → pi-native entwurf**
   - external MCP host 에서 가능한 sync path 와 pi-native async path 의 차이를 명확히 기록
   - 긴 작업은 pi session 안에서 async entwurf 로 넘기는 패턴 확인
3. **pi session ↔ Claude Code 역할 분리**
   - Claude Code: 설계/리뷰/코드 읽기
   - pi-shell-acp: 실행/검증/entwurf orchestration
   - 서로 forward 하지 않고 GLG가 역할을 정하는 패턴 유지
4. **세션 연속성 + 비대칭 공존**
   - 아래 `session continuity hygiene` footgun 과 결합 테스트
   - 옵션 drift 로 backend session 이 새로 열릴 때 Claude Code 연계 시나리오가 어떻게 깨지는지 확인

성공 기준:
- 각 시나리오에서 “누가 outcome 을 소유하는가”가 명확하다.
- replyable / non-replyable, send-is-throw, MCP `entwurf_resume` 조건부 async default(0.7.6)와 external non-replyable sync-default/reject 경계가 agent 발화에 정확히 반영된다.
- 필요한 경우 README / AGENTS / VERIFY 중 한 곳에 운영 패턴으로 정리한다.

---

## Active hygiene — session continuity

오늘 발견: 같은 pi 세션을 resume할 때 실행 옵션이 달라지면 bridge config signature 가 달라져 ACP backend session 이 `incompatible_config` 로 invalidate 된다.

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
1. `incompatible_config` 로그에 diff 출력
   - 예: `emacsAgentSocket: null -> "server"`
   - 최소한 어떤 축 때문에 invalidate 됐는지 보여주기.
2. `PI_SHELL_ACP_STRICT_BOOTSTRAP=1` 운영 문서화 또는 UX 검토
   - silent new 대신 fail-fast 로 잡을 수 있는지 확인.
3. `emacsAgentSocket` 을 session compatibility 축에 넣는 게 맞는지 재검토
   - MCP child env / Emacs skill surface 정합 때문에 넣은 의도는 이해됨.
   - 다만 resume continuity 를 끊을 만큼 강한 config 인지 판단 필요.

검증 기준:
- alias 실행 → resume/load 유지
- plain 실행 후 alias 복귀 → 현재는 `incompatible_config`; 개선 후 원인 diff 명확
- `./run.sh verify-resume <project>` 또는 작은 live smoke 로 확인

---

## Main backlog — #25 lessons from OpenClaw audit

OpenClaw 5.22 native `claude-cli` audit 에서 얻은 lesson 을 **pi-shell-acp 본체 품질**로 흡수한다. OpenClaw plugin 기능 확장이 아니라 bridge hygiene 라운드다.

우선순위:
1. **Transcript pre-flight**
   - backend native jsonl 위치 verifier
   - Claude: `CLAUDE_CONFIG_DIR`
   - Codex: `CODEX_HOME` / `CODEX_SQLITE_HOME`
   - Gemini: `GEMINI_CLI_HOME`
2. **Invalidation reason taxonomy**
   - 지금 `incompatible_config` 가 너무 넓다.
   - 후보: `auth-profile`, `auth-epoch`, `system-prompt`, `mcp`, `transcript-missing`, `emacs-socket`, `tool-surface`.
3. **Session cache hygiene**
   - `acp-bridge.ts` bridge session cache 에 idle timeout / LRU / max-N cap 검토.

나중 후보:
- Fingerprint-keyed reuse: skills snapshot + extra system prompt hash 축
- Single-turn lock per session: 같은 sessionId 동시 prompt 진입 throw

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

이유: OpenClaw native `claude-cli` / `openai-codex` 가 이미 충분히 좋다. 우리 plugin 을 Claude/Codex lane 에서 쓸 이유가 줄었다. Gemini lane 은 필요 시 재개.

### Long-term / separate issues

- #11 remote SSH resume cwd alignment
- #10 broader ontology RFC
- #8 ACP `entwurf_send` message visibility UX
- #2 pi-first context meter
- L5 long soak with repeated context-pressure events
- ~~pi-tools-bridge MCP async surface~~ → 더 이상 deferred 아님. "Top regression — Phase B"로 승격.
- Remote entwurf cleanup

---

## Closed baseline reminders

- `@junghanacs/pi-shell-acp@0.7.6` published (latest before 0.8.0 campaign).
- `@junghan0611/openclaw-pi-shell-acp@0.0.1` published 2026-05-21 (confirmed live on npm 2026-05-29), parked — no work since publish. README must reflect *published-but-parked*, not "not yet published".
- Recommended routing as of 2026-05-26:
  - Claude: OpenClaw native `claude-cli`
  - Codex: OpenClaw native `openai-codex`
  - Gemini: `pi-shell-acp` ACP lane if richer MCP/skill surface is needed
