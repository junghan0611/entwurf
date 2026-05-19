# Changelog

All notable changes to this project will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The repo uses semver.

## Unreleased

## 0.7.2 — 2026-05-19

Patch release for a registry-artifact regression discovered after the first `npm publish`. Source repo tracks `100755` on `run.sh`, `mcp/pi-tools-bridge/start.sh`, the `demo/*.sh` pair, and `scripts/*.sh`, and the locally produced `npm pack` tarball preserved those modes. The artifact uploaded to the registry, however, normalized every `.sh` to `0644` — fresh `pi install npm:@junghanacs/pi-shell-acp@0.7.1` left the README-documented direct entry point (`"$(npm root -g)/@junghanacs/pi-shell-acp/run.sh" install .`) and the `pi-tools-bridge` MCP startup script non-executable, surfacing as `Permission denied` and a silent MCP launch failure on the consumer side. 0.7.2 restores the executable bit through a `postinstall` hook and locks the regression with a new dry-run gate.

### Fixed

- **Executable bit restored on every shipped `.sh` after install.** New `scripts/postinstall-chmod.cjs` runs at `postinstall` time and `chmod 0755` `run.sh`, `mcp/pi-tools-bridge/start.sh`, `mcp/pi-tools-bridge/test.sh`, `demo/demo.sh`, `demo/demo-baseline.sh`, and every `*.sh` under `scripts/`. Hand-written in CJS so it runs regardless of the consumer's package `type` and never depends on resolving its own `package.json`. Each `chmod` is wrapped in its own `try` — Windows, read-only mounts, or any other filesystem refusal logs a warning and continues, so an install can never fail because of a chmod refusal.

### Added

- **`.sh` mode regression gate in `./run.sh check-pack`.** The dry-run inspector now reads each entry's `mode` from `npm pack --dry-run --json` and fails closed if any tracked `.sh` ships without the executable bit. The repo's source files already track `100755` and the local pack preserves that, but a contributor's umask or a `git update-index --chmod=-x` would silently drop the bit; this gate makes that case fail at `pnpm check` time. The registry-side mode normalization (the actual root cause behind 0.7.1's break) remains outside our control — the `postinstall` hook above is the defense for that.
- `scripts/postinstall-chmod.cjs` added to the `check_pack` / `check_pack_install` required-file lists so an accidental drop of the chmod script itself is caught at publish gate time.

## 0.7.1 — 2026-05-19

Patch release for the first npm publish path. `v0.7.0` was tagged on GitHub but intentionally not published to npm after the final dry-run found a lifecycle-script interaction; 0.7.1 carries the same public package surface with the publish guard fixed.

### Fixed

- Fixed `prepublishOnly` under `npm publish --dry-run`: the nested `check-pack-install` smoke now runs `npm pack --dry-run=false`, overriding npm's inherited `npm_config_dry_run=true` lifecycle environment. Without the override, `npm pack` printed the scoped tarball name but did not create the `.tgz`, causing the publish guard to fail with `tarball not produced` before a real publish could be exercised.

## 0.7.0 — 2026-05-18

Phase 2 packaging-surface refactor closes and the clean-host install preflight clears on a real Ubuntu target (`cleanhost`: Stages 0–3, 4a, Stage 4 prep settings, and 4b authenticated runtime smoke for Claude / Codex / Gemini all verified — see [`docs/setup-clean-host.md`](./docs/setup-clean-host.md)). The 0.7.0 cut adopts the `@junghanacs` npm scope and pins the publish-ready surface; the actual `npm publish` is held for a separate round so the patch and the registry push do not blur into one another.

### Added

- Dry-run tarball invariant gate: `./run.sh check-pack` (also `pnpm check-pack`). Runs `npm pack --dry-run --json`, then asserts that runtime-critical files and the public verification/docs surface are present and that private/dev residue is absent. Part of the default `pnpm check` so every commit catches a packaging drift.
- Heavy publish gate: `./run.sh check-pack-install` (also `pnpm check-pack-install`). Closes the remaining three items in #13's publish checklist — actual `npm pack`, `tar -tf` invariant cross-check, and a fresh-temp project install smoke that `pnpm add`s the produced tarball plus the 0.74.x peer baseline (`@earendil-works/pi-{ai,coding-agent,tui}` + `typebox`) and probes the installed `@junghanacs/pi-shell-acp/package.json` to confirm `pi.extensions` arrives intact. A final **pi package loader smoke** then runs `pi -e <tmp>/node_modules/@junghanacs/pi-shell-acp --list-models pi-shell-acp` and grep-asserts the output contains both `pi-shell-acp` and the `claude-sonnet-4-6` model anchor — meaning pi accepted the package as a real extension and registered the provider, not just that the tarball was a well-shaped npm artifact. `--list-models` does not spawn the Claude/Codex/Gemini backends, so the smoke stays credential-free. Kept out of the default `pnpm check` because of the 5–15s dependency-resolution cost.
- `prepublishOnly` package script wires `pnpm run check && pnpm run check-pack-install` so any future `npm publish` fails closed if either the existing nine gates, the dry-run invariants, or the actual install path regress.
- `test:pack` package script — alias for `pnpm run check-pack && pnpm run check-pack-install`. Matches the `prepublishOnly` / `test:pack` pair named in #13's publish checklist; lets operators run the same dry-run + actual-install verification without invoking the full `pnpm check` pipeline.

### Changed

- **In-pi `entwurf` default mode flipped from `sync` to `async`.** `pi-extensions/entwurf.ts` now defaults to `async` — spawn returns a Task ID immediately and the parent turn is free; completion arrives as a follow-up notification. `sync` stays available as explicit opt-in for short status checks (<5s). The slash-command surface (`/entwurf`) matches: bare `/entwurf <task>` is async, `/entwurf sync <task>` opts into the blocking path, and `/entwurf async <task>` is preserved as a backward-compat no-op so pre-0.7.0 muscle memory keeps working. Rationale: review / research / build calls dominate spawn usage, and blocking the parent turn for >30 s reads as "stuck" to the operator — this UX failure was the 2026-05-19 publish-prep finding (sibling GPT-5.4 + GLG observation). External MCP host surface (`mcp/pi-tools-bridge/index.ts`) remains sync-only by design; the tool description carries that statement verbatim. Async via MCP is a deferred design round (see NEXT.md "pi-tools-bridge MCP async surface"). AGENTS.md "Entwurf Orchestration" updated to state the in-pi vs external-MCP asymmetry explicitly.
- **npm scope adopted — `pi-shell-acp` → `@junghanacs/pi-shell-acp`.** Bare name was never on npm and the OpenClaw plugin sibling already lives under the same scope (`@junghanacs/openclaw-pi-shell-acp`), so the scoped form is source-of-origin parity with that sibling and unambiguously points at the GitHub repo of record. The runtime provider id `pi-shell-acp` is **unchanged** — model strings (`pi-shell-acp/claude-sonnet-4-6`), settings keys (`piShellAcpProvider`), log prefixes (`[pi-shell-acp:bootstrap]`), and the `--provider pi-shell-acp` CLI surface keep their existing names. The scope migration affects only the npm publish identity and the install paths derived from it.
- **`package.json` version `0.6.0` → `0.7.0`** in the same patch as the scope rename so the first published version is unambiguously the scoped artifact. No 0.6.x is ever published under either name.
- **`run.sh` install / pack surface updated for the scope:**
  - `PACKAGE_NAME` constant rewritten as the scoped form with an SSOT comment block explaining why this is the npm identity and `PROVIDER_ID` is not.
  - `check_pack_install` tarball name updated from `pi-shell-acp-${version}.tgz` to `junghanacs-pi-shell-acp-${version}.tgz` — npm's scoped-pack naming rule (strip `@`, replace `/` with `-`).
  - `check_pack_install` install-probe `import('pi-shell-acp/package.json')` updated to `import('@junghanacs/pi-shell-acp/package.json')`.
  - `check_pack_install` pi loader smoke install path updated from `$tmp/node_modules/pi-shell-acp` to `$tmp/node_modules/@junghanacs/pi-shell-acp`.
  - Other `pi-shell-acp` substring grep / `endswith` checks in `run.sh` (install scanner discovery, MCP path detection) work unchanged against scoped paths — the trailing path segment is the same.
- **README install table swapped to the scoped form** in all four `npm:` install paths (global + project, `pi install` + `pi install -l`). The `git:github.com/junghan0611/pi-shell-acp` paths are unchanged — git source identity is the repo URL, not the npm name. The "not on npm yet" inline note was retitled from "tracked in #13" to "0.7.0 publish pending" to reflect where the work actually stands.
- README install surface restructured into the four `pi install` paths that `packages.md` defines — `npm:` and `git:`, each in **global** (default) and **project** (`-l` flag) scope — plus a fifth local-clone path for hacking on the bridge. Each path now shows the exact location of `run.sh install .` after install (`$(npm root -g)/@junghanacs/pi-shell-acp/`, `./.pi/npm/node_modules/@junghanacs/pi-shell-acp/`, `~/.pi/agent/git/...`, `./.pi/git/...`, or the cloned directory) so operators do not have to guess where the post-install hook lives. Lead paragraph carries the auth-boundary statement — pi-shell-acp does not provide Claude credentials or bypass any backend auth; the operator's local `claude`/`codex`/`gemini` trust is what the bridge uses. Codex/Gemini moved under a new `### Backend prerequisites` sub-section, and the OpenClaw plugin sibling (`@junghanacs/openclaw-pi-shell-acp`) is explicitly called out as separate from the root install. A second callout warns against filtering the four `pi.extensions` entries — they ship as one set (provider + entwurf + entwurf-control + model-lock) and partial filtering can leave the model lock or entwurf surface in a broken state.
- `package.json` metadata aligned with pi package gallery conventions (sample cross-check against `pi-synthetic-provider`, `pi-firecrawl`, `pi-exa-mcp`, `pi-claude-code-use`, `pi-telegram`):
  - `keywords` expanded to include `pi`, `pi-extension`, `pi-coding-agent`, `ai-provider`, `acp-bridge` for gallery discoverability.
  - Explicit `files` allowlist added — runtime sources (`index.ts`, `acp-bridge.ts`, `event-mapper.ts`, `engraving.ts`, `pi-context-augment.ts`, `protocol.js`, `pi-extensions/`, `mcp/`), public verification surface (`run.sh`, `scripts/`, `prompts/`, curated `demo/` entries, the three README-referenced gifs under `docs/assets/`, `pi/{entwurf-targets.json, settings.reference.json, skill-plugin-example/}`), and operator docs (`AGENTS.md`, `BASELINE.md`, `VERIFY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`). The OpenClaw plugin sibling (`plugins/openclaw/`, published separately as `@junghanacs/openclaw-pi-shell-acp`) is excluded.
  - `typebox` added to `peerDependencies` (`"*"` range) — `pi-extensions/entwurf.ts` uses `Type.Object` / `Type.Union` / `Type.Literal` and pi packages.md requires this peer.
- **peerDependencies range** confirmed at `"*"` for all peers (`@earendil-works/pi-{ai,coding-agent,tui}`, `typebox`) per the pi `packages.md` rule (L166: "list them in `peerDependencies` with a `"*"` range and do not bundle them"). Same pattern across every sample inspected (`pi-firecrawl`, `pi-exa-mcp`, `pi-claude-code-use`, `pi-synthetic-provider`, `pi-telegram`). No tightening to `^0.74.0` / `>=0.74.0 <0.75.0` — pi peer compat is tracked through the documented 0.74.x baseline, not through range pins.
- `resolveCodexAcpLaunch` now mirrors the Claude resolver pattern — `require.resolve("@zed-industries/codex-acp/package.json")` first, PATH `codex-acp` as fallback. Closes the three-backend equality gap noted in NEXT.md cross-repo follow-ups (`AGENTS.md` Hard Rule #7): operators no longer need a separate `pnpm add -g @zed-industries/codex-acp` step when `pi-shell-acp` is installed; the codex-acp bin already pinned in `dependencies` is used directly. `env:CODEX_ACP_COMMAND` override remains the highest-priority path; `source` field exposes `env:CODEX_ACP_COMMAND` / `package:@zed-industries/codex-acp` / `PATH:codex-acp` so the resolution path is observable. AGENTS.md "Runtime Dependencies" updated.

### Fixed

- **`files` allowlist leaked `.cast` artifacts into the npm tarball.** The initial Patch 1 entry included `docs/` as a directory, which pulled `*.cast` asciinema recordings into the tarball even though they are git-ignored (`*.cast` in `.gitignore`). Caught during reviewer cross-check of Phase 2 commits. Fix: replaced `docs/` with explicit entries for the three tracked gif assets the README actually references (`pi-shell-acp-demo.gif`, `pi-shell-acp-doomemacs.gif`, `pi-shell-acp-entwurf.gif`). Added `\.cast$` to the `check-pack` and `check-pack-install` forbidden patterns so the same drift cannot recur. Tarball drops from 43 → 41 files and ~390 kB smaller.

### Release invariant checklist (operator review at cut)

Phase 2 packaging-surface refactor closes the refactor axis; operational validation (NEXT.md 2.7 / 2.8 / 2.12) lives in a separate sprint. The automated half (`pnpm check` + `pnpm test:pack`) is green at the cut; this checklist is the human-eye half — operator review *before `npm publish`* (not before cut), so the boxes stay unchecked here and get walked through manually in the publish-prep round.

- [ ] **no Claude credentials in pi-shell-acp** — `grep -rE 'apiKey|token|secret|credential' acp-bridge.ts index.ts pi-extensions/` returns only env-var override names and the `.credentials.json` symlink passthrough in the Claude overlay. No bundled tokens, no fallback auth payload, no `package.json` dependency on any credential package.
- [ ] **no subscription resale** — README `## Install` lead paragraph and AGENTS.md "North Star" capability-dignity language are unchanged. The `npm pack` tarball ships no Claude / Anthropic OAuth payload (`tar -tf` output inspected against the publish-gate forbidden patterns).
- [ ] **no auth bypass** — backend spawn paths (`resolveClaudeAcpLaunch` / `resolveCodexAcpLaunch` / `resolveGeminiAcpLaunch`) launch the operator's native `claude` / `codex-acp` / `gemini` binary. The Claude overlay passes `.credentials.json` through as a symlink; Codex / Gemini rely on the binary's native auth flow. pi-shell-acp itself stores no auth state.
- [ ] **explicit local backend boundary** — every spawn site in `acp-bridge.ts` uses `node:child_process` `spawn` / `execFileSync` against a local executable (resolved via override → `require.resolve` → PATH). No `fetch` / `https.request` / network call to any non-pi backend; `engraving` and `pi-context-augment` carriers stay in-process.
- [ ] **fail-loud** — `McpServerConfigError`, `ModelSwitchLockedError`, `assertLegacyCompactionKnobUnset`, `isTranscriptPoisonError`, and the `check-sdk-surface` marker policy all in place. AGENTS.md "Crash, Don't Warn" honored. `check-sdk-surface` reports `0 cast(s) present, 0 OK + 0 DEBT — all annotated` at the current commit.
- [ ] **no hidden transcript restoration** — persisted session record schema (`parsePersistedSessionRecord`) carries only `{ sessionKey, acpSessionId, model, backend, capabilities }` plus identity fields — no transcript snapshot. `isTranscriptPoisonError` invalidates the persisted record when the backend rejects a resume; the session re-bootstraps fresh rather than silently masking the failure.
- [ ] **OpenClaw plugin separate package** — `plugins/openclaw/` ships as `@junghanacs/openclaw-pi-shell-acp` (separate npm name). Root `files` allowlist excludes `plugins/` (verified by the `^plugins/` forbidden pattern in `check-pack` and `check-pack-install`); `pnpm check:plugins` runs `tsc -p .` on each `plugins/*` workspace as an independent gate.

## 0.6.0 — 2026-05-17

Development release. Phase 1 feature-freeze closeout: OpenClaw plugin prerelease (Oracle daily-use verified) + Asymmetric Mitsein workflow surface (external MCP `entwurf_send`) shipped together ahead of the 2026-06-15 Anthropic third-party agent billing split. Phase 2/3 are refactor-only.

### Added

- **`entwurf_send` accepts identity-enhanced sender envelopes from external MCP hosts** (commit `5217e6c`). The pi-tools-bridge MCP surface previously required a pi session sender envelope from both `entwurf_self` and `entwurf_send`. The send path is now relaxed: when this MCP is wired into an external host (Claude Code, Codex, Gemini CLI), `entwurf_send` delivers into live pi sessions with `origin="external-mcp"` and `replyable=false`. The receive (`entwurf_self`) path still requires a pi session sender envelope — fail-loud, no silent coerce. `wants_reply=true` is rejected from external senders because there is no pi-session address to reply to. Receivers render `from: ... [external MCP]` and `sessionId: external-mcp (non-replyable)`. The asymmetry is by design: external hosts can push into pi, but receiving a reply requires being a pi session. See AGENTS.md "Entwurf Orchestration" and README "Entwurf" sections.

- **OpenClaw plugin (prerelease)** at `plugins/openclaw/`. New monorepo-lite sibling package — `pnpm-workspace.yaml` `packages: ["plugins/*"]`. Surfaces `pi-shell-acp/<model-id>` as a first-class OpenClaw provider; five curated models route through Claude / Codex / Gemini ACP backends via the upstream pi-shell-acp bridge:
  - `pi-shell-acp/claude-sonnet-4-6`, `pi-shell-acp/claude-opus-4-7`
  - `pi-shell-acp/gpt-5.4`, `pi-shell-acp/gpt-5.5`
  - `pi-shell-acp/gemini-3.1-pro-preview`

  Phase 1.8/1.9 verification on Oracle Docker (2026-05-15): `glg-b-bot` direct DM GREEN under both Sonnet and Opus, workspace/SOUL/USER/memory read, Telegram delivery (`sendMessage ok`), child pi clean exit/finalize. Manual install only — `openclaw plugins install <path> --dangerously-force-unsafe-install` until ClawHub registration. Not published to npm. Docker boundary, pi agent overlay (`~/.pi`) volume policies, Docker repro lab (`examples/docker-lab/`), and entwurf scope (`--no-tools --no-session --offline`) documented in `plugins/openclaw/README.md` and `AGENTS.md`. Plugin npm name reserved: `@junghanacs/openclaw-pi-shell-acp`.

- **Asymmetric Mitsein workflow pattern**. Documented operating shape between pi GPT힣 (Mattering, slow context-rich) and Claude Code Opus (fast effort surface) ahead of the 2026-06-15 Anthropic third-party agent billing split. tmux / copy-paste is the egress (operating-system tool, repo-zero); `entwurf_send` is the ingress (already implemented). External MCP caller patterns landed in `~/repos/gh/agent-config/home/AGENTS.md` "External MCP caller patterns" section. See NEXT.md "Immediate Priority — 2026-05-17 sprint" for the SSOT.

### Fixed

- Bumped `@agentclientprotocol/claude-agent-acp` from `0.32.0` to `0.33.1`, picking up upstream origin-aware handling for `task-notification` followups so autonomous background-task results no longer bleed into the user-turn lifecycle. First fix candidate for issue #16's background-notification / human-turn boundary failure.
- **ACP `entwurf_send` message visibility regression** (`e31823c`). Disabled the late `customMessage` promotion on the ACP path — the post-stream box arrived after sync tool calls, making the message look like a fresh send. In-stream `[tool:start]/[tool:done]` notice carries the visibility instead. Native and tool-result paths preserve the receive-side renderer + `ENTWURF_SENT_MESSAGE_TYPE` context filter. Re-entry condition: when pi gains an in-stream passive UI append/update path, this is reconsidered (parked as issue #8).

### Changed

- Bumped `@zed-industries/codex-acp` from `0.13.0` to `0.14.0`, aligning the bridge with the current Codex ACP release and its Codex 0.129 / exec-output handling updates.
- Reconfirmed the external `gemini-cli` `0.42.0` path-resolution invariant used by the Gemini overlay; pi-shell-acp still treats Gemini as a PATH runtime rather than a package dependency.
- README "External MCP wiring" split into two options: (A) `claude mcp add` registration (host-managed) vs (B) `~/.mcp.json` declarative (operator-managed). Both surface the same `pi-tools-bridge` entry. `entwurf_self` requires a pi session sender envelope; `entwurf_send` delivers from explicitly wired external MCP hosts, replyable only for pi-session senders.
- Root README gains an "Anthropic subscription billing" note framing the 2026-06-15 third-party agent billing split. `pi-shell-acp` respects that distinction — no bypass, no emulation — and preserves capability dignity across all three backends (invariants #7, #9, #10). The recommended runtime mix leans toward paths outside Anthropic's Agent SDK metering (Codex / Gemini); Claude remains a strong coding worker invoked when its quality is worth the credit cost.

### Plugin — `plugins/openclaw/` development trail (prerelease history, 2026-05-14 ~ 2026-05-16)

Documented here for replay; not part of the public 0.6.0 surface beyond the README/AGENTS files inside `plugins/openclaw/`.

- TS migration: `src/index.js` → `src/index.ts` (commit `6cea5c3`). Single-file TS stub; multi-file split (`src/provider.ts`, `src/stream/*`) is Phase 1.4 work.
- Compiled runtime shipped at `dist/` (commit `1c73569`). OpenClaw's `runtimeExtensions` slot consumes `dist/index.js`; source ships via `extensions: ["./src/index.ts"]`. `dist/` intentionally committed during prerelease (see `.gitignore` SSOT comment); transitions to `prepublishOnly: pnpm build` + `plugins/*/dist/` ignore at Phase 2 npm/ClawHub publish gate.
- Issue #17 outbound boundary hardening (`6cea5c3` fix, `918f5ef` ci guard, `1c73569` dist, `fa3b8f7` two-layer): outbound message boundary normalize + final-role guard + abnormal-flag fan-out + outbound text-only. DIAG 7-field probe (`finalRole`, `finalTextLen`, `finalTextHead`, `partialTextLen`, `partialOverridesFinal`, `abnormal`, `timeoutFired`) for telemetry. 1-stage streaming-off validation GREEN at release; 2-stage streaming-on validation and `[tool:trace]` inline resolution remain open follow-ups.
- Pre-install hardening (`340e58f`), Docker repro lab (`4e8237c`), Telegram delivery bridge shim (`98c8741` + `7071f4d` + `02c9c36`), curated catalog expansion to include `claude-opus-4-7` and `gpt-5.5` (`950e11b`), Docker install layers + three-backend auth (`169fa0b`), entwurf scope under invariant #9 (`635012b`), host-adapter pointer + auth boundary invariant in root (`b66e358`), Docker auth boundary R1/R3/R5/R6/R7 closeout (`61cfd4c`), install model split (prerelease vs self-contained) + pi agent overlay boundary (`8476104`).

### Docs

- AGENTS.md: "Entwurf Orchestration" section formalizes the sender envelope contract — `replyable=true` requires a pi sender envelope (`PI_AGENT_ID` / `PI_SESSION_ID`); `external-mcp` sender envelope is delivery-only.
- `plugins/openclaw/README.md`: Docker boundary section (in-container login default vs host passthrough advanced opt-in) + pi agent overlay (`~/.pi`) volume policies (4a persist runtime state vs 4b host overlay passthrough).
- NEXT.md realigned 2026-05-17: Phase 1 = 0.6.0 dev release (OpenClaw verification ✅ Phase 1.8/1.9 + Asymmetric Mitsein sprint); Phase 2/3 = refactor-only. Open question — endpoint envelope beyond pi sessions — and Design archive — receiver wake path via MCP mailbox + Claude Code `asyncRewake` — captured as design input for the operational-validation iteration.

### Known limitations (post-release operational validation continues)

- Asymmetric Mitsein workflow validation (Immediate Priority sprint Step 3a) is a 1-month fast iteration in progress at release time. Real-use trigger phrases, friction patterns, and frequency data are being captured ahead of `./run.sh smoke-external-mcp` automation (Step 3b) and demo materials (Step 3c). Step 3 work is **operational validation, not feature work** — 0.6.0 is the feature freeze; Step 3 outputs flow into Phase 2 4-axis verification.
- OpenClaw plugin remains manual-install-only; ClawHub registration is Phase 3.
- Plugin `mcpInjection`, `lockConflictPolicy`, `entwurfTargetsPath` configSchema keys are reserved (not yet wired); they land in Phase 1.4 ts refactor.
- Claude Code receiver wake path (MCP mailbox + `asyncRewake`) is design archive only — no implementation in 0.6.0. Real demand measurement happens during Step 3a; implementation considered only if friction accumulates.

## 0.5.0 — 2026-05-14

### Changed — pi-shell-acp session model lock

pi-shell-acp sessions are now locked to their starting model after the session starts. The lock has two layers:

- `pi-extensions/model-lock.ts` is the primary UX guard. Once a conversation is anchored (`agent_start`, resume/fork, reload with messages, or startup with existing messages), `model_select` transitions that touch `pi-shell-acp` are immediately reverted to the previous model. This covers `pi-shell-acp -> native`, `native -> pi-shell-acp`, and `pi-shell-acp/X -> pi-shell-acp/Y`. Native-to-native switching remains free.
- `ensureBridgeSession` is the bridge fallback/direct-call guard. If a live pi-shell-acp bridge session is asked to serve a different model, it throws `ModelSwitchLockedError` before closing the old ACP child, invalidating persisted state, or bootstrapping a new backend session.

Fresh startup/new sessions with no messages stay unlocked until the first prompt. Pre-turn model selector changes and CLI `--model` overrides are configuration, not violations. Resume/fork sessions lock immediately because their model identity was already anchored by the original session.

**Wire-level evidence the bridge fallback matters.** A live pi session that switched from Claude sonnet to Codex gpt-5.4 produced — *before* this change —

```text
[pi-shell-acp:shutdown]  closeRemote=true invalidatePersisted=true closedRemote=ok childExit=exited
[pi-shell-acp:bootstrap] path=new backend=codex acpSessionId=019e2481-...
```

The Claude backend was reaped and a fresh Codex backend bootstrapped, while pi JSONL still pointed at the original Sonnet conversation. With the bridge fallback active, the same direct/reuse-path flow produces

```text
[pi-shell-acp:model-switch] path=reuse outcome=locked
                            fromModel=claude-sonnet-4-6 toModel=gpt-5.4
                            reason=pi_shell_acp_session_locked_to_starting_model
```

— no `shutdown` line, no `bootstrap path=new`. The next prompt reuses the original ACP session (`path=reuse backend=claude`).

**This is not transcript-clean.** pi-core (`AgentSession.setModel()` in `packages/coding-agent/src/core/agent-session.ts`) mutates `agent.state.model` and calls `appendModelChange()` before the extension or provider boundary can refuse. Extension-side revert therefore leaves `model_change` as `X -> Y -> X`; bridge fallback leaves the attempted `X -> Y` record. A fully clean refusal requires a pi-core model-switch preflight/hook that this repo intentionally does not patch.

#### Surface changes

- `pi-extensions/model-lock.ts` + `package.json`
  - New extension-side model lock. It tracks when the session is anchored with `session_start`, `agent_start`, and existing message entries.
  - `startup` / `new` with no messages: unlocked until first prompt.
  - `resume` / `fork`: immediately locked.
  - `reload`: preserves an already locked module state or reconstructs lock from existing message entries.
  - Defensive fallback: if reading entries fails, lock rather than silently allowing a handoff.
  - Reentry guard prevents loops when the extension calls `pi.setModel(previousModel)` to revert.

- `acp-bridge.ts`
  - New exported `ModelSwitchLockedError` carrying `{ sessionKey, fromBackend, toBackend, fromModel, toModel }`.
  - `ModelSwitchOutcome` type: `"respawn"` → `"locked"`. The earlier `"respawn"` outcome is retired.
  - `ensureBridgeSession` reuse-path mismatch (previously: close + invalidate persisted + `startNewBridgeSession`) now logs `path=reuse outcome=locked reason=pi_shell_acp_session_locked_to_starting_model` and throws `ModelSwitchLockedError`.
  - The lock fires **above** `isSessionCompatible` so it catches same-backend AND cross-backend switches identically. An earlier prototype that lived inside the `existingCompatible` branch silently let cross-backend switches fall through to the incompatible-fallback and spawn a fresh session — the wire-level evidence above is exactly that hole.
  - `enforceRequestedSessionModel` (bootstrap path) is unchanged. Bootstrap is the lifetime starting point, not a mid-life switch.

- `run.sh`
  - New `check-model-lock` deterministic gate. `scripts/check-model-lock.ts` covers the 18-case policy matrix: four provider quadrants, same-model no-op, pre-turn free selection, post-`agent_start` lock, resume/fork immediate lock, reload with entries, reload preserving prior lock, and defensive lock on entry-read failure.
  - `smoke-model-switch` rewritten and generalized to four-argument form (`backend_a model_a backend_b model_b`). Three cases now run: within-backend Claude (sonnet → opus), within-backend Codex (gpt-5.4 → gpt-5.5), and cross-backend (Claude sonnet → Codex gpt-5.4). Pass criteria assert `outcome=locked`, exactly one `[pi-shell-acp:bootstrap] path=new backend=<backend_a>` line, `ModelSwitchLockedError instanceof` check, no `outcome=respawn` anywhere, no `path=new backend=<backend_b>` on cross-backend, and a successful post-refusal turn on the original session.

- Docs
  - AGENTS.md / README.md / VERIFY.md now describe the two-layer lock: extension-side revert as the normal path, bridge-side refusal as fallback, and the transcript-dirty caveat.

#### Scenarios covered by this guard

- Fresh startup/new before the first prompt: free. This preserves CLI `--model` override and pre-turn model selector configuration.
- After first prompt: any switch touching `pi-shell-acp` is reverted by the extension.
- Resume/fork: locked immediately, even before the next prompt.
- Reload: lock is preserved or reconstructed from existing message entries.
- Native-to-native switches: free.
- Direct bridge/reuse-path mismatch: refused by `ensureBridgeSession`. This is the fallback for direct calls or missing/failed extension coverage and prevents the silent-respawn hole.
- Bootstrap-time model resolution (`enforceRequestedSessionModel` after new/resume/load): unaffected — bootstrap is the lifetime starting point, not a mid-life switch.
- entwurf resume model override: already blocked separately by the Identity Preservation Rule (no `model` parameter on the entwurf resume surface).
- Different-process reopen of a saved JSONL under a different `--model`: out of scope by design. Saved persistent records do not carry `modelId`; lock applies only to live bridge sessions in this process.

#### Migration

- Operators who switched models mid-session by relying on the old respawn behavior must now open a new pi session for the new model once the current session is anchored. There is no in-process knob; this is the policy.
- Tooling that grepped for `outcome=respawn` on the model-switch log line must look for `outcome=locked` instead. The legacy outcome value is gone; any occurrence in fresh logs after the upgrade is a regression signal.

### Changed — 0.5.0 declaration: bridge does not implement compaction

The bridge no longer implements compaction. ACP backends compact natively; the pi session survives that. The bridge boundary stays explicit. This pays back the 0.4.x debt where both Claude (`DISABLE_AUTO_COMPACT=1` + `DISABLE_COMPACT=1`) and Codex (`-c model_auto_compact_token_limit=9223372036854775807`) auto-compaction were disabled at the bridge surface — a deliberate, temporary expedient while the bridge surface was being shaped, now removed.

| Layer | Default | Knob |
|---|---|---|
| pi JSONL compaction | blocked — pi-side summary does not reduce the backend transcript | `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1` opts back in |
| backend-native compaction | **always allowed (no bridge knob)** | — configure the backend through its own native interface if you need to alter it; the bridge intentionally does not surface backend-specific compaction names |
| legacy `PI_SHELL_ACP_ALLOW_COMPACTION` | — | **fail-fast** at spawn intent with a next-action message pointing at `PI_SHELL_ACP_ALLOW_PI_COMPACTION` |

#### Surface changes

- `acp-bridge.ts`
  - Claude `bridgeEnvDefaults` no longer ships `DISABLE_AUTO_COMPACT` / `DISABLE_COMPACT` at all. The adapter carries identity-isolation pins only (`CLAUDE_CONFIG_DIR`).
  - Claude overlay `settings.json` now includes an explicit empty `hooks: {}` map. This keeps operator hooks hidden while matching the Claude SDK's configured-hooks shape; LIVE A/B probes showed that omitting the key made organic auto-compact consume the triggering turn for a meta-summary instead of answering the user prompt.
  - Codex `resolveCodexAcpLaunch` no longer emits `-c model_auto_compact_token_limit=9223372036854775807` at all. The bridge does not inject the threshold pin anywhere.
  - `resolveBridgeEnvDefaults(backend)` returns the adapter's identity-isolation pins as-is — no compaction option, no filtering. The earlier `disableBackendCompaction` option, the `isBackendCompactionDisabledByOperator()` reader, the `codexAutoCompactArgs()` helper, the `CODEX_DISABLE_AUTO_COMPACT_ARGS` constant, and the `COMPACTION_GUARD_ENV_KEYS` filter set are all removed.
  - `resolveAcpBackendLaunch` calls `assertLegacyCompactionKnobUnset()` on entry. Every spawn path (Claude, Codex, Gemini) crosses this surface, so the legacy single knob is rejected before any ACP child can launch on stale semantics. The error message points at `PI_SHELL_ACP_ALLOW_PI_COMPACTION` (the only remaining bridge knob) and tells the operator that backend-native compaction is always allowed — there is no longer a bridge knob to opt out.
  - Identity-isolation env (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, `GEMINI_CLI_HOME`, `GEMINI_SYSTEM_MD`) is unrelated to compaction and ships unconditionally — pinned at `check-backends` as a hard contract.

- `index.ts`
  - `session_before_compact` cancels by default and emits an honest message: "pi-side compact does not reduce the backend transcript; backend-native compaction is handled by the ACP backend itself; send `/compact` as a backend prompt or let the backend auto-compact". The `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1` opt-back-in path is documented in the same message.

- `run.sh`
  - `check-backends` assertions inverted to the 0.5.0 contract: default Codex launch must NOT contain `model_auto_compact_token_limit`; default Claude env must NOT contain `DISABLE_AUTO_COMPACT`/`DISABLE_COMPACT`; legacy `PI_SHELL_ACP_ALLOW_COMPACTION=1` must throw at spawn intent. 137 assertions ok at this initial declaration. (See the *0.5.0 maintainer cleanup* entry below for the post-cleanup count.)
  - **Organic compact path closed for Claude (2026-05-13) and Codex (2026-05-14).** Initial Claude organic-context-full probes reproduced Claude SDK compaction on a saturated Sonnet session and showed the pi mapping survived, but also exposed a prompt-sacrifice failure when the Claude overlay omitted the `hooks` key. Adding `hooks: {}` fixed the turn shape: organic auto-compact now emits the compact status and then answers the triggering user prompt; explicit `/compact` still produces the expected compact-boundary turn and the next prompt answers from compacted context. Codex later passed both the lowered-threshold cheap stand-in and the real GPT-5.4 native-window saturation probe (`used` 244k → 84k, substantive compacting turn, sentinel preserved). The bridge still forwards backend output as-is and does not hydrate or rewrite transcript. Gemini context-pressure remains unverified.
  - New `./run.sh smoke-compaction-policy [--step=NN]` runner that wraps `scripts/compaction-policy-smoke.ts`. Originally six steps total (01/02/05 deterministic, 03/04/06 live); step 01 was retired in the later maintainer cleanup, leaving five steps with 02/05 forming the deterministic gate (no spawn, no network) and 03/04/06 the live release-evidence probe — under `LIVE=1` they drive a real ACP child per backend via `runEntwurfSync` + `runEntwurfResumeSync` (same infrastructure as cross-cwd-resume-smoke), plant a unique sentinel, send literal `/compact` as a backend prompt (NOT pi-host `/compact` — entwurf delivers the string as a normal user message into the ACP child), then send a recall prompt and assert the sentinel survives. Same `taskId` across all three turns, so persisted-mapping reuse is also covered. The probe uses a **dual-classifier** for backend-compact evidence: a text classifier over the (b)-turn reply (`compacted` / `summarized` / `context reduced`) AND a wire classifier over the bridge stderr's `[pi-shell-acp:usage]` lines (explicit `used=0` compact_boundary, or >=50% used drop). Pass requires positive evidence from EITHER classifier plus sentinel recall — survival alone is necessary but not sufficient. The dual shape exists because each backend signals compaction on a different ACP wire surface: codex-acp emits "Context compacted" in the assistant text, while claude-agent-acp suppresses the textual ack and posts an explicit `used=0` synthetic usage_update via the SDK's `compact_boundary` event (acp-agent.js:477-498). Text-only or wire-only would mis-judge them; both run together and either suffices. Cost a few cents per backend. This is NOT a product surface — there is no user-facing `/acp-compact` command; the probe is release evidence, not a feature. Step 06 (Gemini) is exploratory — Gemini ACP does not advertise `/compact` and the probe records the actual observation, not a release claim. Step 05 verifies the wrapper throw directly (5a `resolveAcpBackendLaunch`) and verifies at source level that the production spawn entry (`createBridgeProcess`) carries the same `assertLegacyCompactionKnobUnset()` guard — bypass between the two paths was a reviewer-found regression and the smoke now guards against it.

#### Migration

`PI_SHELL_ACP_ALLOW_COMPACTION=1` in 0.4.x meant two things at once: pi-side compact was allowed AND the backend guards were stripped (so backend-native compact could run). 0.5.0 keeps just the pi-side opt-in; backend-native compaction is now always allowed, so there is no second bridge knob.

- **0.4.x `PI_SHELL_ACP_ALLOW_COMPACTION=1` → 0.5.0 `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1`.** Backend-native compaction is already allowed by default in 0.5.0 (no knob needed), so the only piece of the old broad semantic that still needs an opt-in is the pi-side one. Setting just `ALLOW_PI_COMPACTION=1` reproduces the full 0.4.x `ALLOW_COMPACTION=1` behavior.
- **If you need to alter a specific backend's auto-compaction**, configure that backend through its own native interface. The bridge intentionally does not surface backend-specific compaction names; historical recipes are preserved below only as restoration context.
- **Bridge will refuse to spawn while `PI_SHELL_ACP_ALLOW_COMPACTION=1` is still set.** The throw at spawn intent names `PI_SHELL_ACP_ALLOW_PI_COMPACTION` and explains that backend-native compaction is now bridge-knob-free. No silent acceptance.

#### Docs

- README §Compaction policy rewritten around the declaration; the backend-auto-compaction matrix row inverted; `model_auto_compact_token_limit` reference settings row updated; roadmap 0.5.0 line restated as declaration rather than guard split.
- AGENTS / README Claude overlay notes now call out the explicit empty `hooks: {}` shape: operator hooks remain hidden, but Claude SDK organic compaction gets the configured-empty settings form that keeps the triggering turn clean.
- VERIFY §1A.4 compaction-policy note rewritten; new `0.5.0 compaction policy` evidence row at L3 backed by `smoke-compaction-policy`; the 0.4.x long-session fact-retention baseline annotated as needing a 0.5.0 re-baseline; cross-vendor §13 paragraph adjusted to reflect that the no-excuse-for-forgetting framing is 0.4.x-specific.
- New `demo/compaction-policy-smoke/README.md` documenting the six-step surface (later updated to five — see the maintainer cleanup entry below).

### Changed — 0.5.0 maintainer cleanup: backend-specific compaction knob references retired

After the 0.5.0 declaration ("bridge does not implement compaction") was validated end-to-end on 2026-05-14 — Codex Pattern A pass (LIVE step 04, our automated probe; cross-confirmed by GLG-direct agent-shell + pi-shell-acp + codex-acp dialogue), Codex Pattern B cheap-induction pass (lowered threshold; native auto-compact path reachable end-to-end through the bridge with sentinel preserved across two consecutive organic compacts), and Codex Pattern B real-saturation pass (default GPT-5.4 threshold, `used` 244k → 84k, substantive compacting turn, sentinel preserved) — the maintainer pass removed the remaining places where pi-shell-acp's code and operator-facing docs named backend-specific compaction knobs.

**Reason — symmetry / consistency, not loss of knowledge.** Knowing the names is itself an awareness of backend internals and inconsistent with the bridge thesis. Even a negative assertion ("our argv must NOT contain X") presumes we know X exists, and an operator-facing recipe ("for Codex inline `-c X=…` via Y") teaches an asymmetric "how to disable compact per backend" hint that quietly re-anchors the bridge as something that owns the compaction concern. The 0.4.x→0.5.0 transition needed those strings while the policy was being shaped and verified. Once the policy is verified, they are debt.

#### Removed

- `scripts/compaction-policy-smoke.ts` step 01 (`spawn intent has no backend compaction guard`). The step's negative assertion enumerated `DISABLE_AUTO_COMPACT`, `DISABLE_COMPACT`, and `model_auto_compact_token_limit` directly. LIVE steps 03/04/06 cover the same regression surface — if the bridge ever re-injects a backend-side compaction guard, backend-native compaction stops working end-to-end and those live probes turn red. `ALL_STEPS` is now `["02","03","04","05","06"]`; REGISTRY drops the `"01"` entry; the import of `resolveBridgeEnvDefaults` (only used by step 01) is dropped from the smoke driver.
- `run.sh` `check-backends`: the explicit `assert.ok(!codexLaunch.args.some(arg => arg.includes('model_auto_compact_token_limit')), ...)` line was removed. The `deepEqual` against the expected argv list is the single source of truth — anything not in that expected list is not pinned. The Claude env assertions were also generalized from two exact compaction-name negative assertions to one identity-isolation key-set assertion, paired with the same key-set assertion for Codex. Count remains 136 after the maintainer cleanup.
- `acp-bridge.ts` inline comments at `resolveCodexAcpLaunch`, the codex overlay TOML header, and the codex env block: generalized from "bridge does not pin `model_auto_compact_token_limit`" to "bridge does not pin any codex-side compaction knob". Behavior unchanged; only the comment surface stopped naming codex internals.
- `README.md` "Operating-surface contract — Codex backend" table: the `model_auto_compact_token_limit` row was removed (the bridge does not pin it, and the row's only operator-facing content was a per-backend recipe — which is precisely what the cleanup retires).
- `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `VERIFY.md` compaction-policy paragraphs: the "for Claude `DISABLE_AUTO_COMPACT=1` … for Codex inline `-c model_auto_compact_token_limit=…` via `CODEX_ACP_COMMAND`" recipe collapsed to "configure that backend through its own native interface — the bridge intentionally does not surface backend-specific compaction names".
- `demo/compaction-policy-smoke/README.md`: "Six steps" → "Five steps" with an explicit retirement note for step 01; the backend-specific recipe paragraph generalized.

#### Restoration recipe

If a future need ever requires reintroducing per-backend guard awareness — for a regression test, for a release-evidence probe targeting a specific backend behavior, or because a backend changes its compaction semantics in a way that defeats live-probe detection — the historical source is *this CHANGELOG* itself. Earlier entries in this 0.5.0 release block (above) still name the exact backend-specific strings:

- `acp-bridge.ts` `resolveCodexAcpLaunch` "no longer emits `-c model_auto_compact_token_limit=9223372036854775807`" — codex argv guard.
- `check-backends` "default Codex launch must NOT contain `model_auto_compact_token_limit`; default Claude env must NOT contain `DISABLE_AUTO_COMPACT`/`DISABLE_COMPACT`" — both guard names.
- Migration "If you need a specific backend's auto-compaction off, export the backend's own native env/argv from your shell (`DISABLE_AUTO_COMPACT=1` for Claude; for Codex, inline `-c model_auto_compact_token_limit=…` via `CODEX_ACP_COMMAND`, or export `CODEX_HOME`)" — the recipe shape.

These history entries are intentionally left in place. The retirement is a thesis-alignment choice, not a loss of knowledge.

#### Not removed

- Identity-isolation env carriers (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, `GEMINI_CLI_HOME`, `GEMINI_SYSTEM_MD`) keep their per-backend names. They are unrelated to compaction; they are the bridge's identity/overlay surface, which is per-backend by design.
- LIVE step 04's `PI_ENTWURF_ACP_FOR_CODEX=1` env extras and the Codex/Claude probe-time references inside `scripts/compaction-policy-smoke.ts` remain — those are spawn-routing and live-probe surfaces, not bridge-side compaction policy.
- The 0.4.x→0.5.0 transition fact entries above stay as-is. They are the restoration source.

#### Evidence

- `demo/compaction-policy-smoke/probes/2026-05-14-codex-step04-A/` — Pattern A pass (explicit `/compact`; text + sentinel signal).
- `demo/compaction-policy-smoke/probes/2026-05-14-codex-B-threshold/` — Pattern B cheap stand-in (lowered-threshold organic auto-compact, sentinel preserved across two consecutive compacts, bridge mapping survives).
- `demo/compaction-policy-smoke/probes/2026-05-14-codex-B-saturation/` — Pattern B real native-window saturation (13 turns drove `used` 17k → 244k ≈ 94.5% on GPT-5.4; codex-rs native default `auto_compact_token_limit` fired organic auto-compact on turn 12, wire `used` 244089 → 84549 = 65% drop crossing the 50% classifier threshold; substantive 982-word answer in the compact turn; post-compact sentinel recall preserved; bridge mapping intact across all 13 turns). Codex GPT-5.4 native threshold ≈ 245k versus Claude Sonnet 4.6 ≈ 120k — same probe shape, honestly asymmetric backend defaults, same thesis.

**Gemini axis closed as an honest ACP asymmetry, not as a pass** (5/14, evidence triangulated across source, native CLI cross-check, and PM sibling review):

- **ACP command registry source**: `gemini-cli/packages/cli/src/acp/acpCommandHandler.ts:23-31` registers `memory, extensions, init, restore, about, help` only. `compress`/`compact`/`summarize` are NOT in the ACP registry. CLI body (`packages/cli/src/ui/commands/compressCommand.ts:10-13`) implements `compress` with aliases `summarize, compact` — but this is a TUI-only surface.
- **Organic compression on ACP path**: `gemini-cli/packages/core/src/core/client.ts:673-677` — every turn start calls `tryCompressChat(prompt_id, false)`; on success it yields `GeminiEventType.ChatCompressed`. But `gemini-cli/packages/cli/src/acp/acpSession.ts` switch has no `ChatCompressed` case → `default: break` silently drops the event. **Compression may happen, but the ACP wire never sees it.**
- **Context-pressure final surface**: if compression is insufficient, `ContextWindowWillOverflow` → `acpSession.ts:369-371` → `stopReason: 'max_tokens'`.
- **GLG direct CLI cross-check (5/14)**: Native Gemini CLI `/compress` reduced 93620 → 12936 tokens in a real session, confirming the CLI mechanism is real and works *outside* ACP. The asymmetry — `/compress` exists, but only outside ACP — is recorded as honest negative, not paved over.
- **PM sibling review (gpt-5.5 medium, 5/14)**: explicitly corrected an earlier "Gemini axis closed" framing to "closed as honest ACP asymmetry, not as a pass". The release-grade phrasing committed: *"Native Gemini CLI supports /compress (alias /compact, /summarize), but Gemini ACP does not expose that command. Organic compression may happen inside Gemini CLI, but ACP does not surface ChatCompressed on the wire today. If pressure remains, ACP surfaces max_tokens. pi-shell-acp does not inject backend-specific Gemini compression knobs."*
- **No LIVE saturation probe for Gemini**: Gemini Pro 1M+ window saturation is cost-disproportionate (Codex 258k probe was already at the upper end of cheap), and inducing compression by injecting Gemini-specific knobs (`compressionThreshold`, `contextManagement`) into the overlay would violate the 0.5.0 maintainer cleanup thesis (bridge does not surface backend-specific compaction names). Source + native CLI cross-check + PM review is the release-grade evidence chain here.
- **Operator-facing UX at `max_tokens`**: "Gemini ACP reached context pressure; native CLI has `/compress` but ACP does not expose it here. Start a fresh session or reduce context."

## 0.4.17 — 2026-05-12

### Fixed

- Drop the persisted `pi:<sessionId>` → `acpSessionId` bridge mapping when a resumed/loaded session's prompt fails with an Anthropic transcript-validity 400 — currently the `cache_control cannot be set for empty text blocks` and `API Error: 400 messages: text content blocks must be non-empty` surfaces. The poison failure is surfaced via `[pi-shell-acp:prompt-error] reason=transcript_poison`; the dead mapping is invalidated before any subsequent bootstrap, so the next bootstrap — even if the host re-enters within the same CLI invocation — uses `path=new` instead of the poisoned `acpSessionId`. The bridge does not force a same-turn retry of its own; recovery is just the existing `resume → load → new` ladder running against the now-empty persisted record. Fixes [#12](https://github.com/junghan0611/pi-shell-acp/issues/12).

### Changed

- Cold resume now treats the saved session header cwd as the authority and fails fast when neither that header cwd nor an explicit `options.cwd` override is available, instead of silently falling back to the resumer's `process.cwd()`. This prevents #9-style hydration loss from reappearing through the `runEntwurfResumeSync` and async `entwurf_resume` paths — both now refuse to spawn against the resumer's cwd. The `entwurf_resume` tool descriptions (MCP and pi-native) and `EntwurfResumeOptions.cwd` doc-comments are updated to call out the header-cwd authority explicitly; the `cwd` override remains as a debug/migration escape hatch that may forfeit backend continuity. Addresses the cwd-authority portion of [#10](https://github.com/junghan0611/pi-shell-acp/issues/10); the broader ontology RFC (peer handle, `contact_peer` verb, registry) stays parked.

## 0.4.16 — 2026-05-12

### Fixed

- Restored cross-cwd `entwurf_resume` backend hydration for ACP-routed siblings. The resume child now starts from the saved session header cwd when no explicit cwd override is supplied, preserving the existing `pi:<sessionId>` → `acpSessionId` bridge record instead of silently falling back to `newSession` and losing prior-turn memory. This fixes [#9](https://github.com/junghan0611/pi-shell-acp/issues/9) without promoting `taskId` to an identity carrier.

### Added

- Added a `verify-resume` Phase 2 cross-cwd fact-recall gate (`scripts/cross-cwd-resume-smoke.ts`) that plants a unique sentinel in a spawned sibling, resumes it from a different cwd through the MCP-shaped path, asserts recall, and captures child stderr through the existing `PI_ENTWURF_CHILD_STDERR_LOG` knob so future bootstrap fallthroughs are visible.
- Added a recorded entwurf demo GIF under `docs/assets/` and linked it from the README. The recording covers spawn, MCP `entwurf_resume` recall, and live `entwurf_send`, serving as visible end-to-end evidence for the #9 fix.

### Changed

- Expanded the TypeScript fence to a third `scripts/tsconfig.json` pass so strip-types verification scripts with explicit `.ts` imports are typechecked alongside the root and MCP configs.

## 0.4.15 — 2026-05-11

### Changed

- Align README / AGENTS 0.5.0 direction with NEXT.md: the next release is a compaction guard split / backend-native compaction escape hatch, not a caller-supplied recap hint slot or compact→new-session handoff.
- Promote ACP `entwurf_send` success echoes into first-class `[entwurf sent →]` UI messages using the Armin-style custom message + context-filter pattern, while keeping MCP sends on the MCP path and native sends on native tool rendering. Claude, Codex, and Gemini are covered through backend-specific ACP payload shapes.
- Remove remaining active `gpt-5.2` smoke/sentinel references in favor of `gpt-5.4`, add the `smoke-gemini` npm script, and refresh stale verification comments around triple-backend smoke and typecheck coverage.

### Fixed

- Prevent `entwurf-sent` UI echoes from leaking into LLM context in pi-shell-acp sessions that do not load `--entwurf-control`, and avoid empty late Gemini sent boxes when ACP tool arguments cannot be recovered.
- Make ACP `entwurf_send` detection robust across Claude/Codex/Gemini title shapes and permission-result labels rely on ACP option `kind` instead of backend-specific optionId substrings.
- Repair `scripts/session-messaging-smoke.sh` for the 0.4.14 `sessionId` schema and sender-envelope requirement so the 4-case matrix is self-contained again.

## 0.4.14 — 2026-05-11

### Changed — issue #7 surface unification (session-bridge retracted)

`session-bridge` is removed from the bundled 0.4.14 surface. `pi-shell-acp` now ships one MCP server only — `pi-tools-bridge` — and that server owns the full cross-session surface across Claude, Codex, and Gemini. The bundled tool set is now exactly five tools: `entwurf`, `entwurf_resume`, `entwurf_send`, `entwurf_peers`, `entwurf_self`.

This is a release-surface retraction, not a history rewrite. Older docs and baseline rows that mention the two-server / eight-tool shape remain as historical evidence of what 0.4.8–0.4.13 exposed. Current README / AGENTS / VERIFY / BASELINE language now distinguishes that history from the 0.4.14 live surface.

### Added — `entwurf_self` and sender-envelope transparency

`entwurf_self` absorbs the old self-introspection role. It returns the current session envelope — `sessionId`, `agentId`, `cwd`, `timestamp` — plus the active control-socket path, making the session's own identity objectively checkable through the same MCP surface that messaging uses.

`entwurf_send` now defaults to the same sender envelope on live peer messaging paths (MCP tool, slash command, in-process tool). The receiver renders who sent the message, from which cwd, and when. `agentId` is a single field (`pi-shell-acp/<model>`): school × model is one identity.

Startup one-shot CLI intentionally keeps sender info opt-in (`--entwurf-send-include-sender-info`). A short-lived sender process exits immediately after delivery, so attaching a reply-shaped envelope by default would falsely imply a live reply path.

### Fixed — structural `PI_SESSION_ID` / `PI_AGENT_ID` MCP env wiring

The sender envelope no longer depends on ambient `process.env` timing. `index.ts` forwards `options.sessionId` structurally into `EnsureBridgeSessionParams.piSessionId`; `acp-bridge.ts` injects `PI_SESSION_ID` and `PI_AGENT_ID` into both the backend child env and the `pi-tools-bridge` stdio MCP entry via `enrichMcpServersWithEnvelope()`. This closes the live ACP failure GPT caught in `./run.sh check-bridge`: Codex/Gemini MCP children were not guaranteed to inherit the session envelope unless the env array was populated explicitly.

### Changed — install/remove migration and Gemini MCP allowlist

`./run.sh install` now writes only `pi-tools-bridge` and prunes the legacy bundled `session-bridge` entry from older installs when it matches the repo-managed launcher path. `pi/settings.reference.json` now lists only `pi-tools-bridge`. The Gemini overlay's MCP allowlist is correspondingly narrowed to `mcp.allowed:["pi-tools-bridge"]`.

### Changed — model-switch reuse path now respawns

Reuse-path model mismatch no longer attempts in-place `unstable_setSessionModel`. Doing so would leave the already-spawned MCP child broadcasting stale `PI_AGENT_ID`. 0.4.14 therefore requires `path=reuse outcome=respawn fallback=new_session reason=pi_agent_id_env_requires_respawn`, followed by a fresh bridge spawn. Bootstrap enforcement after a fresh spawn remains unchanged.

### Changed — `wants_reply` etiquette marker (was `reply_requested`)

Peer-message reply hint renamed from `reply_requested` to `wants_reply` and re-scoped from a transport contract into a human-conversation etiquette marker — no wait, no polling, no delivery tracking. Default flipped from `true` to `false`: most peer messages (notifications, handoff packets, status pings) leave it unset, and the receiver render shows the `(wants reply)` badge only when the sender explicitly opts in. `parseSenderInfo` keeps a legacy `reply_requested` fallback so pre-rename transcripts still render correctly.

Receiver / sender direction is now visually unambiguous: `renderSessionMessage` uses `[entwurf received ⟵]` and the MCP `entwurf_send` tool result uses `[entwurf sent →]` (with `to:` / `from:` / `mode:` / preview block). Same transport, opposite arrows — end-to-end transcripts never blur who-said-what.

The receiving model is no longer told it is "obliged" to ack; that wording (carried in the old `entwurf_send` description) recreated a topology gate the carrier paragraph split in `pi-context-augment.ts` removed. The receiver decides based on the message body; `wants_reply` only surfaces intent.

### Verification

Release-local gates closed on the unified surface: `pnpm typecheck`, `mcp/pi-tools-bridge/test.sh`, `./run.sh check-mcp`, `./run.sh check-backends`, and `./run.sh check-bridge` all passed green. `check-bridge` now expects the 5-tool `pi-tools-bridge` surface and validates visibility + invocation on Claude, Codex, and Gemini.

## 0.4.13 — 2026-05-07

### Fixed — `skillPlugins` fail-fast contract (silent silent-drop closed)

`index.ts` now validates each `skillPlugins` entry at settings parse time. Each path must be absolute, point at an existing directory, and contain `.claude-plugin/plugin.json`; any violation throws `settingsConfigError` and aborts session bootstrap. The previous shape parsed the field as a string array and forwarded it directly into `claudeCodeOptions.plugins` (`acp-bridge.ts:1059`), so a typo, a relative path, or a directory missing the manifest was silently dropped by the Claude Agent SDK at session-spawn time — leaving the operator's skill invisible without a failure signal. That is exactly the "warnings make agents flail; broken tool state must surface as broken tool state" anti-pattern from §Code Principle, just landing one layer up the stack.

This is a bugfix, not a behavior change: the README:149 line "Explicit Claude plugin roots (`.claude-plugin/plugin.json` + `skills/*/SKILL.md`)" was already the documented contract, and §Code Principle was already the documented enforcement style. The bridge simply was not enforcing them. Operators with valid `skillPlugins` paths see no change. Operators with an invalid path now get a precise error at session start that names the missing piece, instead of a Claude session that boots without their skill.

Backend scoping: this validator runs at settings parse time regardless of the configured backend, but only `buildClaudeSessionMeta` actually consumes `skillPlugins`. Codex and Gemini ignore the field entirely — they expose skills through `~/.codex/skills/` and `~/.gemini/skills/` passthrough — so the stricter validation cannot regress those backends. It only stops a malformed Claude install from booting silently.

### Added — Skill install surface, owned by pi-shell-acp

- README "Custom Skills" section — first-class install guide that previously lived as a single table cell on the `skillPlugins` row of the settings reference. Covers minimum plugin shape, where to put the directory (with the explicit "do not put plugin roots under `~/.pi/agent/`" guard), settings shape, the new fail-fast contract, and the verification one-liner that points at VERIFY §1A `Q-SKILL-CALLABLE`.
- `pi/skill-plugin-example/` — self-contained minimum plugin layout the bridge accepts. Two files (`.claude-plugin/plugin.json` + `skills/hello/SKILL.md`) plus a directory shape; consumers copy and rename. Lives inside this repo so a first-time consumer never has to navigate to agent-config to find a working starting point.
- README backend capability matrix — split the single "Skill surface" row into two rows ("Skill install surface (declarative)" vs "Skill runtime callable surface"). The previous shape conflated `skillPlugins` (a Claude-only declarative install field) with the per-backend `~/.{backend}/skills/` passthrough (a runtime callable surface available on all three), which made it hard for a consumer to map their question onto the right mechanism.

### Changed — Reference consumer link tone (surface ownership tightened)

The README "Reference consumer" line previously read "for a real production setup — skills, prompts, themes on top of pi-shell-acp — see agent-config", which positioned agent-config as the install starting point and routed careful readers into agent-config's own directory conventions (especially `~/.pi/agent/claude-plugin/`) as if they were pi-shell-acp contracts. The line now points at the new `§Custom Skills` for the install surface and explicitly names agent-config's path layout as agent-config's own convention, not a bridge contract. Same link, repositioned authority.

This is a documentation-side correction of the surface ownership leak that had `skillPlugins` as a row in a settings table while the install narrative lived in a separate consumer repo.

## 0.4.12 — 2026-05-07

### Fixed — Entwurf registry recovery (oracle install regression root cause)

`pi-extensions/lib/entwurf-core.ts` `loadEntwurfTargets` no longer caches `EntwurfRegistryError`. The previous shape stored both successful registries and validation errors in a single slot, so a missing/parse-failed registry on first call poisoned every subsequent call from the same MCP/pi process — even after the operator repaired the file. The oracle install regression manifested exactly this way: a stale operator-copied `~/.pi/agent/entwurf-targets.json` produced an `EntwurfRegistryError`, and the cached error survived a symlink relink within the same Gemini session, so every entwurf spawn kept failing until session restart.

The cache is now positive-only with `mtime`-based invalidation. A successful registry is hot-cached for spawn performance, but operator edits to the file are picked up on the next `loadEntwurfTargets()` call without restarting pi or the MCP bridge.

### Changed — Fail-fast install policy for `entwurf-targets.json`

`run.sh ensure_agent_dir_symlinks` no longer silently preserves a stale `~/.pi/agent/entwurf-targets.json`. The v0.4.x policy treated any pre-existing file or differently-pointing symlink as an "operator override" and let install pass; that hid the oracle drift for several releases until the symptom surfaced as a sentinel failure.

The new policy honors only two explicit exits:

- `./run.sh setup:links --force` — back up a stale regular file (timestamped `.bak`) or relink a wrong symlink to the canonical `pi/entwurf-targets.json`.
- `PI_ENTWURF_TARGETS_PATH=/path/to/custom.json` — entwurf-core opts out of `~/.pi/agent/entwurf-targets.json` entirely, freeing the slot from policy.

A regular file byte-identical to the canonical (via `cmp`) is still treated as "already correct, silent". A symlink already pointing at the canonical is also silent. Drift in either form (stale regular file or symlink to a different path) prints a `diff` plus the two exits and exits 1, which propagates through `set -euo pipefail` to fail `install` / `setup` immediately rather than at smoke or sentinel time.

This is observably breaking for any operator running on a v0.4.x install with a drifted local file; the failure message names both repair paths explicitly.

### Added

- `./run.sh setup:links [--force]` — repair `~/.pi/agent/entwurf-targets.json` without re-running the full `setup` flow. The `EntwurfRegistryError` message has named this command since v0.4.x but the subcommand did not exist; this release closes that gap so the error guidance is now executable.

## 0.4.11 — 2026-05-07

### Gemini capability parity restored — skills + MCP advertise + invocation

The 0.4.8 / 0.4.9 baselines recorded a "Gemini MCP function-schema advertise asymmetry" and shipped it as documented backend behaviour. After re-reading upstream `gemini-cli` (`packages/core/src/config/config.ts` `maybeRegister` 3744–3768; `packages/cli/src/acp/acpSessionManager.ts` `newSessionConfig` 278–334; `packages/core/src/tools/mcp-client.ts` `connectAndDiscover` 1235), that reading is retracted: the asymmetry was overlay-induced, not upstream. The bridge — not the gemini binary — was hiding the advertise channels. Three layers of closure (skills advertise, MCP advertise, MCP invocation) had to open in sequence.

#### Layer 1 — Skills advertise

- **`tools.core` widens 7 → 8 keys.** `activate_skill` joins the read/write/edit/exec quartet (Read-class split as `read_file`/`list_directory`/`glob`/`grep_search`). Without it, gemini's `maybeRegister(ActivateSkillTool, ...)` skips registration entirely, the tool never reaches `getFunctionDeclarations`, and the model cannot see any skill — even when `~/.gemini/skills/` is fully populated. Same `tools.core` gate that already controls Read/Write/Edit/Exec, no special path.
- **`skills.enabled` flips `false` → `true`.** The earlier closure was over-tight: it disabled the skill discovery system entirely (`Config.skillsSupport && this.adminSkillsEnabled` 1502–1518), so even if the tool registered, `discoverSkills` never ran. With the toggle on, `SkillManager.discoverSkills` (skillManager.ts:54) reads operator skill SKILL.md entries through `Storage.getUserSkillsDir()`.
- **`skills` joins `GEMINI_OVERLAY_PASSTHROUGH`.** Same shape as Claude (`OVERLAY_PASSTHROUGH` already includes `skills`) and Codex (`OVERLAY_PASSTHROUGH_CODEX` already includes `skills`). Operator-curated agent skills under `~/.gemini/skills/` (typically a symlink to `~/repos/gh/agent-config/skills/` in this fleet) flow through into the overlay's `Storage.getUserSkillsDir()` resolution.

#### Layer 2 — MCP advertise

The diagnostic that finally closed this layer: admin.toml's `mcpName = ["pi-tools-bridge", "session-bridge"]` array shape failed gemini-cli's policy zod schema. The schema (`packages/core/src/policy/toml-loader.ts:39–70`) declares `mcpName: z.string().optional()` — strings only — while `toolName` accepts both strings and arrays. The array form silently failed `safeParse`, which (`toml-loader.ts` `validationResult.success === false` → `continue`) invalidates the **entire admin policy file**, leaving the priority 5.x admin tier empty. The deny-all rules in lower tiers then statically excluded every advertised MCP tool from `getFunctionDeclarations`.

- **`geminiOverlayAdminPolicyToml()` rewrites the MCP allow rule.** First attempt split per-server (`mcpName = "pi-tools-bridge"` + `mcpName = "session-bridge"`) so zod validation passed, advertise opened. The text was later collapsed into a single `mcpName = "*"` allow when invocation diagnostics (Layer 3) showed per-server matching was unreliable across paths; the per-server *whitelist* role moved one layer earlier (see Layer 3).
- **`mcp.excluded:["*"]` removed from overlay settings.** `isInSettingsList` (mcpServerEnablement.ts:65–88) does only exact case-insensitive name matches — no wildcards. The string `"*"` matched nothing real and was decorative, not load-bearing. The `mcp.allowed` whitelist is what actually scopes the surface (`canLoadServer` 122–137). Keeping the bogus entry would have implied a wildcard semantic the engine does not implement.
- **Admin policy was not a direct `PolicyEngine.check()` advertise gate, but advertise was still shaped by policy-driven exclusions.** `tool-registry.ts:647 getFunctionDeclarations` builds its surface through `getActiveTools()` → `config.getExcludeTools()` → `policyEngine.getExcludedTools(...)`, so the model-visible schema can still be narrowed indirectly by policy/exclusion state even though advertise does not run the invocation-time `PolicyEngine.check()` path. The 7-name allow widens to 8 (the `activate_skill` addition) for invoke-time symmetry with the registered surface.

Net effect after Layer 1+2: Gemini sessions see the same skill catalog as Claude/Codex sessions in the same overlay (e.g. `semantic-memory`, `denotecli`, `entwurf-peek`) and the same MCP tool function-schema entries (`mcp_pi-tools-bridge_entwurf`, `mcp_session-bridge_session_info`, …) that Claude and Codex have always seen. MCP advertise needs no patch on the gemini side: ACP `newSession.mcpServers` already merges into `settings.merged.mcpServers` (acpSessionManager.ts:285) and registers via `discoverMcpTools` → `toolRegistry.registerTool` (mcp-client.ts:1235), bypassing `tools.core`.

#### Layer 3 — MCP invocation

After Layer 2, advertise was green but the model's `entwurf_send` call returned `Tool execution denied by policy.` The `[PolicyEngine.check]` debug log showed `MATCHED rule: priority=5.05, decision=deny` — the catch-all DENY at admin priority 50 (= tier 5.x slot 50/1000 = 5.05) was winning. The priority-100 per-server `mcpName="<name>"` allow rules (5.10) somehow did not match in the invocation path. Walking `policy-engine.ts:577 check` vs `:872 getExcludedTools` showed both call the same `ruleMatches`, but the `serverName` resolution differed in shape between the two paths in observed runtime. Rather than chase the upstream nuance, the rule was simplified.

- **`mcpName = "*"` single allow rule** at priority 100. The per-server **whitelist role moves to settings.mcp.allowed**, which `canLoadServer` (mcp-client-manager.ts `isBlockedBySettings` 260–278) enforces *before* the policy engine sees the tool. Only `pi-tools-bridge` and `session-bridge` ever reach the policy layer; an admin-policy MCP whitelist would be a redundant second filter. The trade is a slightly more permissive admin tier in exchange for `getExcludedTools` and `check` agreeing on every MCP tool call. Layered defense is preserved (settings whitelist still gates connection), the advertise/invoke asymmetry is gone.
- **Verified end-to-end.** Layer 3 closure validated by:
  1. `check-bridge` Gemini line — visibility shows all 4 `mcp_pi-tools-bridge_*` tools, invocation calls `entwurf_send` against a bogus target and surfaces the expected missing-target boundary (not a generic policy denial).
  2. Live operator session — `entwurf` spawn + `entwurf_resume` against a sibling GPT, full sync conversation context preserved across the two MCP calls.

#### Verification surface

- **`check-bridge` adds the Gemini line** (`validate_pi_tools_bridge_backend "gemini" "pi-shell-acp/gemini-3.1-pro-preview"`, conditional on `gemini` on PATH, mirroring `smoke-all`'s skip pattern). The `validate_pi_tools_bridge_backend` body already covers visibility (model self-report of `pi-tools-bridge` callable schema entries) + invocation (real `entwurf_send` call to a bogus target). With Gemini added, the same gate that proved Claude / Codex MCP parity now proves Gemini MCP parity automatically on every release. The earlier baselines could not have caught this regression because the gate did not exist for the Gemini backend; that gap is closed.
- **`check-backends` 134 → 137 assertions.** One swap (`mcp.excluded:["*"]` deepEqual → `'excluded' not in mcp` absence), three additions (skills passthrough seed/symlink/SKILL.md reachability), reflecting the new overlay shape.

#### Documentation surface

- **README, AGENTS.md, BASELINE.md, VERIFY.md retract the asymmetry framing.** The 0.4.8 / 0.4.9 BASELINE PASS rows now read as "closure was tighter than capability dignity required"; the closure remains valid for *operator* settings/memory/history isolation, but the skill + MCP channels are reopened for the pi-injected surface. Hard Rule #9 widens: the tool/MCP/skill surface row gains the symmetric passthrough + advertise wording. VERIFY claim row L1 → L4 (direct gemini comparison + bridged interview).

## 0.4.10 — 2026-05-06

### Changed

- Added `gemini-3.1-pro-preview` as the only curated pi-shell-acp Gemini ACP model and explicit-only Entwurf target. Flash is intentionally removed from the curated surface; 3.1 Pro is the subscription-backed high-quality Gemini ACP route.
- Hardened `.pi/prompts/make-release.md` release-note extraction: replaced the fragile `awk` range snippet with a small Python block keyed by `VERSION="$ARGUMENTS"`, so slash-command release runs do not fail with empty `--notes-file` output on a valid `## <version> — YYYY-MM-DD` section.
- Entwurf Codex surface narrowed to `gpt-5.4` + `gpt-5.5` only. `DEFAULT_ENTWURF_MODEL` is now `openai-codex/gpt-5.4`, and the target registry drops `gpt-5.2` / `gpt-5.4-mini` on both the native `openai-codex` and ACP-routed `pi-shell-acp` paths. This makes the natural no-model default match current policy instead of relying on callers to remember a preferred model.

## 0.4.9 — 2026-05-06

### L5 — Memory containment (gemini)

The 0.4.8 surface-isolation matrix closed five Gemini channels (native body, operator memory path, tool surface, GEMINI.md hierarchical discovery, MCP whitelist). 0.4.9 closes a sixth — **memory persistence**. pi-shell-acp is the canonical memory authority on the pi side (semantic-memory + Denote llmlog); no backend may run a parallel memory layer that survives across sessions. The Claude and Codex sides already enforce this (Claude via `CLAUDE_CONFIG_DIR` overlay + `disallowedTools` + `skillPlugins:[]`, Codex via `-c memories.{generate,use}_memories=false` + `-c history.persistence="none"` + `-c features.memories=false`). 0.4.9 adds the matching closure for Gemini.

- **`experimental.memoryV2:false` + `experimental.autoMemory:false` pinned in overlay `settings.json`.** memoryV2 is Gemini's "edit `GEMINI.md` / `MEMORY.md` directly via `edit/write_file`" mode (default `true` upstream); autoMemory is the background extraction agent that writes `.patch` files into a project memory inbox (default `false` upstream). The `GEMINI_SYSTEM_MD` override already replaces Gemini's system prompt body, so memoryV2's prompt steering never reaches the model — but the explicit pin holds even if the override path ever breaks (defense in depth). The overlay `settings.json` closure widens from 14 keys to 16.
- **`<configDir>/{tmp,history,projects}/` swept at every spawn.** `ensureGeminiConfigOverlay` now unconditionally `rmSync`s these three subtrees and recreates them empty, so any `tmp/<slug>/memory/MEMORY.md`, `tmp/<slug>/.inbox/<kind>/*.patch`, command-history subtree, or `projects/` directory content written by a previous gemini session does not carry. The binary-owned `<configDir>/projects.json` file is a separate overlay-private project map and is not part of this sweep; the operator's native `~/.gemini/projects.json` still never flows through. The L4 closure (`context.fileName` sentinel + `memoryBoundaryMarkers:[]`) already keeps Gemini from *reading* memory files; the L5 sweep is filesystem hygiene + defense-in-depth in case L4 ever breaks. The constant is renamed from `GEMINI_OVERLAY_EMPTY_DIRS` to `GEMINI_OVERLAY_SWEPT_DIRS` to reflect the stronger contract.
- **Root-level `<configDir>/GEMINI.md` and `<configDir>/MEMORY.md` swept by the existing stale-entry cleanup.** Neither name is on `GEMINI_OVERLAY_BINARY_OWNED`, so the cleanup loop's fall-through `rmSync` removes them at every spawn. The model can still try to write these files within a session via `write_file`, but they cannot survive into the next one.
- **`check-backends` 124 → 134 assertions.** Two assertions for the new `experimental.{memoryV2,autoMemory}` keys; five for the L5 sweep behaviour (pre-seed `tmp/<slug>/memory/MEMORY.md`, autoMemory inbox patch, root `GEMINI.md`, root `MEMORY.md` → confirm none survive the next `ensureGeminiConfigOverlay` call); three for the engraving substitution defuse below.

### Engraving substitution defuse (gemini)

Recent gemini-cli (post 0.42-nightly, [`packages/core/src/prompts/utils.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/prompts/utils.ts) `applySubstitutions`) walks the `GEMINI_SYSTEM_MD` override file and rewrites `${AgentSkills}`, `${SubAgents}`, `${AvailableTools}`, and `${<toolName>_ToolName}` with their runtime values. The substitution is intended for gemini-shipped templates, but the same pass runs over the operator-supplied override file — so any `${...}` literal inside an engraving (e.g. a shell example) silently mutates on the gemini backend only, while landing verbatim on Claude (`_meta.systemPrompt`) and Codex (`-c developer_instructions`).

- `defuseGeminiSubstitutions` slides the `$` and `{` apart with a zero-width space (U+200B) before writing `system.md`. Every substitution regex misses; the model still reads the same visual string, but Gemini's carrier bytes are intentionally not byte-identical to Claude/Codex for affected `${...}` literals. Restores the cross-backend invariant that the same engraving is not semantically interpolated differently on Gemini. Documented inline at the function definition with the gemini-cli source pointer.

### Internal — Backend dependency bumps

- **`@agentclientprotocol/claude-agent-acp` 0.31.4 → 0.32.0.** SDK pin stays at `@agentclientprotocol/sdk@0.21.0`; transitive `@anthropic-ai/claude-agent-sdk` advances 0.2.121 → 0.2.126. Visible bridge-side change: Claude session updates may now carry `_meta._claude/origin` on `usage_update` notifications when the underlying message is a task-notification followup (autonomous work triggered by a system message rather than the user prompt). The bridge's event-mapper passes `_meta` through unchanged, so the new field flows to pi without code change. Internal `toolUpdateFromEditToolResponse` → `toolUpdateFromDiffToolResponse` rename is consumed inside claude-agent-acp; bridge does not import the symbol.
- **`@zed-industries/codex-acp` 0.12.0 → 0.13.0.** Codex 0.124 → 0.128.0. Rust agent-client-protocol pin stays at `=0.11.1` (same as Zed and the TS SDK 0.21.0 wire). codex-acp internals shifted to async `AuthManager` + `EnvironmentManager` and added a `ThreadGoalUpdated` event — emitted as plain agent text via `client.send_agent_text("Goal updated (active): …")` and forwarded by the bridge as ordinary text. Mode IDs (`read-only` / `auto` / `full-access`) and the `-c features.<key>=false` gating surface are unchanged.
- **devDeps `@mariozechner/pi-{ai,coding-agent,tui}` 0.70.2 → 0.73.0.** Aligns the typecheck fence with the version operators are running. pi-mono 0.71.0 removed the built-in `gemini-cli` *provider* (Token Plan API route), not the `google` API source — `getModels("google")` still ships `gemini-3-flash-preview` (1,048,576 context, 65,536 maxTokens), so `check-models` assertions hold. ExtensionAPI gained `getEditorComponent()` accessor + `thinking_level_select` event + `ProviderConfig.name` + `MessageEndEventResult` — all additive; the bridge does not subscribe to any of these surfaces.

### Documentation

- AGENTS.md Hard Rule #9 widens the surface-isolation matrix to include L5 — Memory containment (per backend), and re-states pi-shell-acp's role as the canonical memory authority.
- Comment drift fix in `acp-bridge.ts`: the placeholder note "`if (systemMdResolution.value)` always takes the override branch" now reflects the upstream `value && !isDisabled` semantic gemini-cli adopted along with the prompt-provider refactor.

### Internal — Release flow standardization

- **Removed `scripts/release.sh`** and the `package.json` `release` script entry. The `--notes-from-tag --title v<version>` pattern paired with lightweight tags was the root cause of v0.4.7 / v0.4.6 / v0.4.1 / v0.3.x shipping with empty release bodies and bare-version titles. The script produced lightweight tags (no annotation message), then `--notes-from-tag` rendered an empty body — consistent low-quality releases by design. Removed rather than patched.
- **`.pi/prompts/make-release.md` rewritten** as a self-contained release procedure. Pre-flight 0–7 (argument shape / clean tree / tag absent / CHANGELOG section / version match / `pnpm check` / `gh` auth + repo/permission consistency / push dry-run) → tag → push → agenda stamp (`pi:release:` tag, release-page link) → CHANGELOG section extracted as `--notes-file` → `gh release create --title "v<version>" --notes-file …` → `gh release view` verify → Google Chat notify → temp-file cleanup. Each step's bash block restates `VERSION="$ARGUMENTS"` and re-derives `REMOTE`/`REPO_URL`/`REPO_NAME`/`REPO_TAG` so slash-command bash invocations split across the agent do not silently drop variables. Title is fixed to `v<version>`; theme lives in the CHANGELOG body's first H3, not the title. `npm publish` and downstream consumer bumps (agent-config 4-file pin) are explicitly out of scope.

## 0.4.8 — 2026-05-03

### Added

- **Gemini CLI as a third ACP backend.** `gemini --acp` joins Claude Code and Codex on the bridge surface. Two reasons converged: pi-mono v0.71.0 removed its built-in Google Gemini provider (operators were told to switch to another provider), and Gemini CLI promoted its `--acp` flag from `--experimental-acp` to the supported surface. The bridge picks the path back up rather than losing Gemini access entirely or routing through API-key/Vertex provider paths. Set `backend: "gemini"` in `piShellAcpProvider`, or pick `pi-shell-acp/gemini-3-flash-preview` and inference will route to the gemini adapter.
- **`run.sh smoke-gemini`** runs the new explicit Gemini smoke (initialize / newSession / single prompt round-trip / shutdown). `smoke-all` now invokes it after Claude and Codex when `gemini` is on PATH; if not, smoke-all skips with a clear notice rather than failing — operators who don't use the gemini backend stay green. The PATH dependency is documented (`pnpm add -g @google/gemini-cli`); pi-shell-acp does not bundle a separate `*-acp` server package for Gemini because the gemini CLI binary itself is the ACP server.
- **`GEMINI_ACP_COMMAND`** environment override mirrors `CLAUDE_AGENT_ACP_COMMAND` and `CODEX_ACP_COMMAND`. Operators can run `gemini --acp --debug` or wrap the launch in a script without touching settings.json.
- **One curated Gemini model**: `gemini-3-flash-preview`, sourced from pi-ai's `google` registry (1,048,576 context). This is what `gemini --acp` defaults to today — bootstrap logs show `fromModel=gemini-3-flash-preview` before the bridge calls `unstable_setSessionModel` to apply the requested model. 2.5 / 3.1 / lite / numbered-snapshot variants are intentionally excluded from the curated surface; non-curated ids still route to the gemini backend through the broader pi-ai registry fallback in `inferBackendFromModel`.
- **One entwurf target** under `provider: "pi-shell-acp"`: `gemini-3-flash-preview`, `explicitOnly: true`. There is no native pi google provider to disambiguate against on 0.4.8, but the flag keeps the policy stable if pi reintroduces one.

### Surface isolation — closed channels (baseline 2026-05-03)

Earlier 2026-05-01 baseline ran with the gemini adapter ACP-connected but not pi-surface-isolated. 0.4.8 ships the closure on five channels, each with both code-level (synthetic test in `check-backends`) and model-side (operator baseline interview) evidence.

- **L1 — native system body.** `GEMINI_SYSTEM_MD = <overlay-home>/.gemini/system.md` replaces gemini-cli's bundled "Instruction and Memory Files" body. The overlay always appends a carrier-isolation canary line (`GEMINI_SYSTEM_MD_CANARY_PISHELLACP_V1`); a baseline operator can ask the model to quote it (and only it) to confirm the carrier reaches the same prompt slot Claude reaches via `_meta.systemPrompt` and Codex reaches via `-c developer_instructions`. 2026-05-03 baseline: model classified the canary string under "actual system prompt (Developer Instruction)", confirming the file replaces native body rather than landing on a different surface.
- **L2 — operator memory path.** `GEMINI_CLI_HOME` redirects gemini's `homedir()` so the binary resolves `Storage.getGlobalGeminiDir()` to `<overlay-home>/.gemini/` instead of `~/.gemini/`. Earlier baseline read `~/.gemini/tmp/junghan/memory/MEMORY.md` as a username leak; the substring `junghan` was actually a `Storage.getProjectIdentifier()` slug of the `/home/junghan` cwd, not a username field — the closure handles both readings, and the operator's real `~/.gemini/{history, projects.json, tmp/<slug>/memory, trustedFolders.json, settings.json}` is now never read. 2026-05-03 baseline: model reports overlay tmp paths (`<overlay-home>/.gemini/tmp/<cwd-slug>`), not the operator's `~/.gemini/` tree.
- **L3 — tool surface.** `tools.core` 7-name allow + `--admin-policy` (priority tier 5.x — beats Default / Extension / Workspace / User policies) deny-all + same 7-name allow. The 7 names map to 4 capability classes (Read = `read_file` / `list_directory` / `glob` / `grep_search`; Write = `write_file`; Edit = `replace`; Exec = `run_shell_command`) — same operating-surface boundary as Claude `Read/Bash/Edit/Write`, with the read-class split admitted honestly so the model does not see "visible but deny'd" tools. 2026-05-03 baseline: model invoked all 4 read-class tools without any `denied by admin policy` response.
- **L4 — `GEMINI.md` hierarchical discovery.** `context.fileName` set to a sentinel (`__pi_shell_acp_disabled_context__`), `memoryBoundaryMarkers: []` to kill parent traversal, `includeDirectoryTree: false` to drop cwd dir-tree auto-attach. 2026-05-03 baseline: model reports no `GEMINI.md` awareness in cwd, parent chain, or home.
- **MCP whitelist.** `mcp.allowed: [pi-tools-bridge, session-bridge]` + `mcp.excluded: ["*"]` keep gemini-side ambient MCPs (operator-configured stdio in `~/.gemini/settings.json`, http/sse in extensions) from surfacing. 2026-05-03 baseline: model enumerates only the two bridge servers.

### Documented asymmetry — MCP function-schema advertise

Gemini ACP accepts the bridge's stdio MCP servers via `mcpServers`, but does **not** register them as model-visible function-schema entries the way Claude and Codex do. In the 2026-05-03 baseline, the model described MCP / custom-tool access as shell-mediated (`run_shell_command`) rather than direct function calls. This is recorded as an observed Gemini ACP surface asymmetry, not something the overlay can close. Operators on the gemini backend should not expect entwurf / semantic-memory / etc. to appear as `mcp__<server>__<tool>` function entries. Recorded in the README backend-capability matrix.

### Internal — Backend adapter shape

- **`AcpBackend` widened to `"claude" | "codex" | "gemini"`** with a third entry in `ACP_BACKEND_ADAPTERS`. The gemini adapter sets `buildSessionMeta` to `() => undefined` (Gemini ACP exposes no `_meta.systemPrompt`), uses the same `[{ type: "text", text }]` first-user augment as Claude and Codex, and pins `bridgeEnvDefaults` to `{ GEMINI_CLI_HOME: <overlay-home>/, GEMINI_SYSTEM_MD: <overlay-home>/.gemini/system.md }`. Both env pins survive `PI_SHELL_ACP_ALLOW_COMPACTION=1` — they are operator-config-isolation invariants, not policy choices.
- **Engraving delivery for the gemini backend** is via `GEMINI_SYSTEM_MD = <overlay-home>/.gemini/system.md`, written at every spawn by `ensureGeminiConfigOverlay()`. The file equivalent of Claude's `_meta.systemPrompt = <string>` and Codex's `-c developer_instructions="<...>"`. The carrier-isolation canary line keeps the file non-empty in the no-engraving placeholder branch (so `getCoreSystemPrompt`'s `if (systemMdResolution.value)` always takes the override branch) and gives baseline a deterministic quote target.
- **Session compatibility.** `geminiSystemPromptText` joins `systemPromptAppend` and `codexDeveloperInstructions` in `isSessionCompatible` / `isPersistedSessionCompatible` — changing the engraving on the gemini backend forces a fresh spawn, since the carrier is materialized at spawn time as a file.
- **`PI_SHELL_ACP_GEMINI_CONTEXT=<int>`** operator override mirrors `PI_SHELL_ACP_CLAUDE_CONTEXT`. Default surface exposes the full registry capacity (1,048,576 for `gemini-3-flash-preview`); operators inline a tighter ceiling for cost / context-management when needed.
- **`check-backends` 110 → 124 assertions.** Gemini launch resolution (PATH path + `GEMINI_ACP_COMMAND` override appending `--admin-policy`), env pins (`GEMINI_CLI_HOME`, `GEMINI_SYSTEM_MD`), absence of session-meta carrier, settings.json shape (14 closure keys), admin-policy 7-name read-class allow, system.md canary in both engraving and no-engraving branches, overlay-private empty dirs, symlink passthrough whitelist, idempotence.
- **`check-models`** widens the curated allowlist to seven ids (Claude 2 + Codex 4 + Gemini 1) and adds context-window assertions for the gemini line against pi-ai's `google` source.

### Notes

- **No subscription-billing parity claim.** Gemini ACP supports `oauth-personal` ("Log in with Google"), `gemini-api-key`, `vertex-ai`, and `gateway` auth methods. Whether ACP-mode quota under `oauth-personal` matches ordinary `gemini` CLI mode is a separate verification axis (cf. google-gemini/gemini-cli#20421); pi-shell-acp 0.4.8 does not assert parity.
- **No `resumeSession` advertisement from Gemini.** Gemini ACP advertises `loadSession: true` only — the bridge's existing `resume > load > new` fallback handles this without code changes. Continuity goes through `loadSession` for Gemini, identical to Codex.

## 0.4.7 — 2026-04-30

### Added

- **Added optional Emacs agent socket support.** `--emacs-agent-socket <name>` tells pi-shell-acp which Emacs server socket an agent should use for Emacs operations. The value is propagated to ACP children as `PI_EMACS_AGENT_SOCKET`, added to the first-user pi context augment, and folded into the bridge config signature so switching between terminal (`server`) and Emacs-internal (`pi`) sessions cannot accidentally reuse a child with stale socket context.
- **Documented Doom Emacs / pi-coding-agent usage.** README now shows the Emacs frontend shape `(setq pi-coding-agent-extra-args '("--entwurf-control" "--emacs-agent-socket" "pi"))` and includes a Doom Emacs demo GIF.

## 0.4.6 — 2026-04-30

### Fixed

- **Restored Hard Rule #2 (`resume > load > new`) on the resume path.** Since SDK 0.20.0 promoted `resumeSession` out of the `unstable_*` namespace, every call to `(session.connection as any).unstable_resumeSession({...})` had thrown `TypeError: ... is not a function`, been silently caught by the bootstrap fallback, and routed every session to `loadSession` instead. Capability check still advertised resume support, but Hard Rule #2 was quietly violated. The bridge now calls the typed `resumeSession` / `closeSession` methods directly. This matters because claude-agent-acp's `loadSession` replays the entire session JSONL back to the bridge as `sessionUpdate` notifications which the bridge discards under Hard Rule #8 (no transcript hydration); resume skips the replay entirely. The longer the session, the larger the wasted bootstrap; openclaw-style long-running sessions would have made the cost user-visible.
- **Dropped five redundant `as any` casts on typed SDK methods.** `prompt`, `cancel`, and `unstable_setSessionModel` (×2) on `ClientSideConnection` are typed by the SDK; the casts were leftover from when those methods were experimental. With strict mode on, dropping them means tsc will fail on the next SDK rename instead of shipping a dead call.

### Changed

- **Bumped ACP SDK pins.** `@agentclientprotocol/claude-agent-acp` 0.31.0 → 0.31.4 and `@agentclientprotocol/sdk` 0.20.0 → 0.21.0. Tracks the upstream stable surface and the `@anthropic-ai/claude-agent-sdk` 0.2.121 transitive.

### Internal — Static gate against ACP SDK casts

- **New `./run.sh check-sdk-surface` (and `pnpm check-sdk-surface`).** Static awk gate over `acp-bridge.ts` that requires every `(connection as any)` cast to have a `SDK_CAST_OK` (permanent gap) or `SDK_CAST_DEBT` (tracked for removal) marker on the same line or the immediately preceding line. Wired into `pnpm check` and the husky pre-commit hook. The 0.20.0 `unstable_resumeSession` rename would have been caught by tsc if the original code hadn't used `as any`; this gate makes the bypass visible at code-review time so the next class-of-bug doesn't ship silently.
- **AGENTS.md Hard Rule #10 documents the principle.** "SDK surface calls must use the typed connection." Markers are required, not optional. The fix is structural, not vigilance.

### Internal — Strict typing fence

- **Flipped root tsconfig `strict: false` → `strict: true`.** First run surfaced 24 errors: 23 implicit-any warnings on `registerTool` executor callbacks plus one real `RpcResponse | null` narrowing bug in `sendRpcCommand` that strict-false had been hiding. Pi-shell-acp tools are called by other agents that will silently accept malformed shapes; strict-on is the right floor.
- **Extended the `EntwurfSendParams` pattern to four more sites.** `entwurf`, `entwurf_status`, `entwurf_resume`, `entwurf_peers` now each define a local params type alongside their schema and type the `execute` signature explicitly (`_toolCallId: string`, `params: <Specific>`, `_signal: AbortSignal | undefined`, `_onUpdate: AgentToolUpdateCallback<unknown> | undefined`, `_ctx: ExtensionContext`). TS2589 on `pi.registerTool`'s generic keeps schema-to-type inference blocked; explicit annotation is the workaround.
- **Typed `entwurf_send`'s `renderResult`** with `AgentToolResult<unknown>`, `ToolRenderResultOptions`, and the same theme shape its sibling `renderCall` already used.
- **Dropped two `(params as { provider?: string }).provider` runtime casts** in `entwurf`'s execute body — `EntwurfParams` declares `provider` directly.
- **Fixed `sendRpcCommand`'s `RpcResponse | null` narrowing.** Resolves directly with the just-received message on the no-event path; only the event-waiting branch stashes the response. Behavior preserved; the type now narrows correctly.
- **Brought `pi-extensions/entwurf-control.ts` into the biome formatter fence.** Removed the `!pi-extensions/entwurf-control.ts` exclude from `biome.json`. Auto-fix surface was tiny (import organize + format); three dead suppression comments (`biome-ignore` / `eslint-disable` for `noExplicitAny`, which is project-wide off) were removed.

### Internal — Single-source `protocol.js`

- **Deleted `protocol.ts`; `protocol.js` is now the only source for the shared `<project-context` wire marker.** The duplication carried no sync invariant — an export added to one would have silently missed the other. With only one string-literal export, JSDoc types are unnecessary; `.js` can serve as the single source.
- **Added `allowJs: true` to root tsconfig** so `protocol.js` enters the tsc program and is emitted through `check-models`. `checkJs` is intentionally left off — the file's surface is a single string-literal export with nothing for strict-check to gain.

### Internal — fence consolidation

Every `.ts` source file in the repo is now reached by `pnpm typecheck`. Previously two surfaces lived outside the fence:

- `pi-extensions/entwurf-control.ts` was excluded from the root tsconfig. The exclude hid type drift introduced by the 0.5.0 sessionId-only refactor: residual `sessionName` / `session.name` reads in `renderCall`, `entwurf_peers` description, and peers output; `pi.on("session_switch", ...)` and `pi.on("session_fork", ...)` handlers registered against event names that pi-coding-agent 0.70.x does not expose (`session_start{reason: "fork" | "new" | "resume"}` covers them); a renderer reading `result.isError` against an `AgentToolResult<T>` type that does not declare it (the framework spreads it onto the result at runtime); a typebox-version mismatch (`@sinclair/typebox` 0.34 mixed with pi-coding-agent's typebox 1.x via `StringEnum`) silently widening parameters to `unknown`; a dead `getMessagesSinceLastPrompt` helper.
- `mcp/` was excluded wholesale. Both bridges run via `node --experimental-strip-types` and were never type-checked anywhere. Inside, `mcp/session-bridge/src/index.ts` still resolved targets via `<sessionName>.alias` symlinks and a name scan — the same alias surface that `entwurf-control.ts` declared dead since 0.5.0, but on a different physical directory and a different audience (humans operating Claude Code, not AI peers).

Both surfaces are now inside the fence and the invariants are reconciled:

- Root `tsconfig.json` stays emit-capable so `./run.sh check-models` can keep tsc-emitting the project entry into `.tmp-verify-models/` for runtime introspection. A new `mcp/tsconfig.json` extends the root and adds the strip-types-runtime concessions (`allowImportingTsExtensions`, `noEmit`); `pnpm typecheck` runs both as a sequential pair. `AGENTS.md` § Typecheck Boundary documents the new shape and pins the rule that no `.ts` source file may sit outside both configs.
- `pi-extensions/entwurf-control.ts`: dead handlers (`session_switch`, `session_fork`) and dead helper (`getMessagesSinceLastPrompt`) removed; defensive runtime cast at the post-exhaustive-switch fallback; `result.isError` access replaced with a documented runtime cast that reads the framework's spread-injected field plus a `details.error` fallback (with the `||` vs `?:` precedence bug fixed); residual `sessionName`/`session.name` reads removed at the addressing surfaces; `Type` imported from `@mariozechner/pi-ai` to align the typebox universe with `StringEnum` and with what `pi.registerTool` consumes; `execute(params)` and `renderCall(args)` annotated with an explicit `EntwurfSendParams` type so the schema (runtime) and the type (compile-time) describe the same contract on both sides — schema-to-type inference is then bypassed and TS2589 cannot resurface. The two concrete revisit conditions for collapsing back to schema-inferred params are documented inline.
- `pi-extensions/entwurf.ts` and `package.json` finish the typebox single-source: `Type` is imported from `@mariozechner/pi-ai` here too, and `@sinclair/typebox` is removed as a direct dependency. pi-coding-agent's typebox 1.x continues to flow in transitively.
- `mcp/session-bridge/`: the alias-claim path in `createAlias` is now atomic — `fs.symlink` into a unique tmp path, then `fs.rename` onto the alias path. POSIX rename atomically replaces the destination, closing the unlink-then-symlink window where two concurrent same-name starts could both observe "no alias" and both write one. The file header documents why the human-aliased addressing surface is intentionally kept here while entwurf addressing is sessionId-only — different audience, different cost/benefit, no polling timer, fall-through to live-session scan if the alias is stale.

Why this is in the changelog and not folded into a feature release: the previous "typecheck green" state was green only because the broken files were outside the fence. Closing the fence forced every silent invariant violation to surface and be reconciled. The maintainer treats fence breaches as latent bugs, not as test-coverage choices, and the public log should reflect that.

## 0.4.5 — 2026-04-29

### Fixed

- **Restored pi / AGENTS context for ACP backends without growing the system-prompt carrier.** `appendSystemPrompt: false` remains the safe default: Claude still receives only the short engraving through `_meta.systemPrompt`, and Codex still receives engraving through `developer_instructions`. The rich pi context now rides a one-shot first user-message augment so both backends actually receive the bridge identity narrative, pi operating context, `~/AGENTS.md`, `cwd/AGENTS.md`, and date/cwd.
- **Avoided Claude Code OAuth "extra usage" failures from large custom system prompts.** The pi context no longer needs to be inserted into Claude's `_meta.systemPrompt = <string>` carrier, which had caused subscription sessions to be classified as metered usage when the carrier grew beyond the SDK-default shape.
- **Made entwurf-spawned ACP sessions receive the home context without duplicating project AGENTS.** Entwurf tasks already carry `cwd/AGENTS.md` in `<project-context ...>` tags; the bridge now detects that marker, removes only the duplicate cwd AGENTS section from the first-user augment, and preserves `~/AGENTS.md`, bridge narrative, pi base context, and date/cwd.
- **Failed loudly when configured AGENTS files cannot be read.** Missing AGENTS files are still allowed, but if `~/AGENTS.md` or `cwd/AGENTS.md` exists and cannot be read, bootstrap throws instead of silently starting a context-poor agent.
- **Separated capability descriptions from concrete tool names.** The first-user augment now tells agents to treat the actual callable tool schema as source of truth. Native pi, Claude ACP, and Codex ACP expose different tool names for similar capabilities (`read/bash/edit/write`, `Read/Bash/Edit/Write/Skill`, `exec_command/apply_patch/...`), so agents must not claim a tool exists only because AGENTS.md or the augment mentions it.
- **Fixed prompt hygiene around first-message prepends.** The augment is separated from the original user prompt with a blank line, preventing `Current working directory: ...<project-context ...>` concatenation in entwurf first prompts.

### Changed

- **Engraving is now an optional operator personal surface.** `prompts/engraving.md` ships as a minimal placeholder (`각인이라고 여기`); empty or missing engraving files are skipped. Bridge identity and operating context moved to the first-user augment.
- **Shared the `<project-context` wire marker through `protocol.ts`.** Entwurf generation and ACP-side de-dup detection now import the same dependency-free constant, keeping the wire-format marker single-sourced across root emit and MCP strip-types execution paths.

### Verification

- Re-ran paired identity interviews against Claude ACP and Codex ACP. Both now recognize pi-shell-acp, receive home/project AGENTS context, and distinguish prompt/context claims from actual callable tool schemas. Entwurf resume against a Sonnet sibling confirmed both `~/AGENTS.md` and project AGENTS context were retained across resume.

## 0.4.1 — 2026-04-29

Patch release closing a release blocker carried since 0.3.0 and adding the missing direct human-facing entwurf surface, plus removing the alias addressing layer the operating model has outgrown.

### Fixed

- **Entwurf extensions actually load.** `pi-extensions/entwurf.ts` and `pi-extensions/entwurf-control.ts` have lived in the repo since 0.3.0 but were never wired into `package.json`'s `pi.extensions` array, so neither the `--entwurf-control` flag nor the `/entwurf` / `/entwurf-status` / `/entwurf-sessions` slash commands actually loaded. The MCP bridge expected sockets at `~/.pi/entwurf-control/`, which an unloaded control extension never creates — leaving the entwurf surface documented in README/AGENTS.md effectively dead at runtime. Both entries are now in `pi.extensions`.

### Added

- **`/entwurf-sessions`** now surfaces cwd, model id, and idle state per live session via a new `get_info` RPC command, with `[N]` indices for direct addressing and per-session error rows when an individual peer fails to respond. The displayed list is cached so `/entwurf-send` can address by index.
- **`/entwurf-send <index|sessionId> <message>`** — the previously missing interactive surface for a human operator to message another live entwurf session directly. Defaults to `follow_up` mode and auto-attaches `<sender_info>` so the receiving side can reply via the `entwurf_send` MCP tool. The MCP `entwurf_send` tool path remains the agent-facing surface (errors crash the call so the agent cannot paper over a misroute); the new slash command is the human surface and reports failures as ordinary notifications.
- **`get_info` RPC command** on the entwurf control socket — returns `sessionId`, `cwd`, `model { id, provider }`, and `idle` for the serving session. Used by `/entwurf-sessions` enrichment; reusable by future tooling.
- **`gcStaleSockets()`** runs once per `startControlServer()` and cleans dead `.sock` entries from `~/.pi/entwurf-control/`. Pre-0.4.1 `.alias` symlinks left in the directory by older builds are also swept on encounter, retiring the GC TODO at `pi-extensions/entwurf-control.ts:213`.

### Removed (BREAKING — entwurf-control surface only)

The alias layer — `<sessionName>.alias` symlinks under `~/.pi/entwurf-control/` mirroring pi's `SessionManager.sessionName` via a 1s `setInterval` polling timer — is removed entirely. With per-session compaction disabled, the operating model is short-lived sessions ending in recap+new (see roadmap), so a human-friendly alias has little time to accumulate value, and the polling timer was the sole reason a kernel-driven socket-push design needed wall-clock work at all. The three race surfaces it carried — concurrent `syncAlias`, timer-vs-shutdown, symlink-vs-listener — are now structurally absent.

- `entwurf_send` MCP tool: `target` parameter renamed to `sessionId`; alias resolution removed. Use `entwurf_peers` to discover live ids.
- `entwurf_peers` MCP response: `name` and `aliases` fields removed from each session entry.
- `entwurf_send` extension tool (in-process): `sessionName` parameter removed; `sessionId` is now required.
- `--entwurf-session` CLI flag: only accepts a sessionId (UUID).
- `/entwurf-sessions` output drops the parenthetical `(alias)` label.
- `/entwurf-send`: `<alias>` form removed; `<index|sessionId>` only.

This change is independent of agent-config's `--session-control` extension under `~/.pi/session-control/` (its ingested copy of the alias surface is intentionally kept — different cost/benefit, no polling timer, no race surface) and of the bundled `mcp/session-bridge/` MCP (Claude Code-side; its `SESSION_NAME` alias is set once from cwd at `start.sh` and is the stable identity surface that side needs).

### Identity verification

A four-case identity interview was captured against 0.4.0 + this patch — OpenRouter Sonnet, pi-shell-acp Sonnet, native Codex, pi-shell-acp Codex. Both pi-shell-acp cases recognize `pi-shell-acp` as the bridge surface and enumerate `mcp__pi-tools-bridge__*` and `mcp__session-bridge__*` correctly. The two non-bridge cases honestly report that the entwurf MCP is "described in AGENTS.md but not in my schema" — the boundary is real and the agent sees it. The transcripts are being moved to BASELINE.md as part of 0.4.x, alongside the longer-term plan to publish session-level verification data (see roadmap).

## 0.4.0 — 2026-04-28

PI-native identity carriers for both ACP backends — Claude via system-prompt replacement, Codex via codex `Config` `developer_instructions` — with whitelist overlays isolating operator config, memory, sessions, rules, history, and (codex-specific) the SQLite thread/memory state DB. The model API itself is unchanged on each side; pi-shell-acp now owns everything above the model's minimum identity prefix and below the backend authentication.

### Changed

- **Engraving carrier — Claude.** Previously delivered via `_meta.systemPrompt.append`, additive on top of the claude_code preset. Now delivered via `_meta.systemPrompt = <engraving string>` (claude-agent-acp `acp-agent.ts:1685`, sdk.d.ts:1695), which makes claude-agent-acp pass the string directly into the SDK's `Options.systemPrompt` slot — full preset replacement. The claude_code preset's `# auto memory` guidance, per-cwd MEMORY.md path advertisement, working-directory section, git-status section, and todo-handling guidance all drop out of the system prompt. The engraving sits directly above the SDK's hard-wired minimum identity prefix (_"You are a Claude agent, built on Anthropic's Claude Agent SDK."_), which is the boundary pi-shell-acp deliberately respects. Verified by interview against the Claude backend (BASELINE.md, first run): the agent correctly identifies as a PI-native operating surface on top of the Claude API, refuses to claim auto-memory it does not have, and asks before running side-effecting capability checks.
- **Engraving carrier — Codex.** Previously delivered as a first-prompt `ContentBlock` prepend, which lands at user-message authority. Now delivered as `-c developer_instructions="<engraving>"` at codex-acp child spawn time, which materializes inside the codex `developer` role between the binary's `permissions` / `apps` / `skills` instruction blocks. codex-acp does not honor `_meta.systemPrompt` (verified against the Rust source — `codex-acp/src/thread.rs` `meta.get(...)` call sites all target MCP tool approval keys, none target prompt-level surfaces); `developer_instructions` is the highest stable identity carrier the codex stack offers. Structurally one config layer below the Claude side's preset replacement, but equivalent in authority intent. The new carrier participates in `bridgeConfigSignature` / session compatibility, so changing the engraving forces a fresh codex-acp spawn — reusing an existing child against a stale carrier would surface the previous identity to the model.
- **Compaction toggle no longer affects identity isolation.** Previously, `PI_SHELL_ACP_ALLOW_COMPACTION=1` set the entire `bridgeEnvDefaults` block to `undefined`, which dropped `CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `CODEX_SQLITE_HOME` along with the Claude compaction-guard pair. That silently turned operator config inheritance back on the moment compaction was allowed. The toggle now strips only the compaction-guard env keys (`DISABLE_AUTO_COMPACT`, `DISABLE_COMPACT`); identity-isolation env stays regardless. Identity isolation is an invariant; the compaction knob is policy.

### Added

- **Whitelist overlay — Claude.** `~/.pi/agent/claude-config-overlay/` is now built from a fixed allowlist instead of mirroring `~/.claude/` minus `settings.json`. Author-controlled `settings.json` (`permissions.defaultMode = "default"`, `autoMemoryEnabled: false`); passthrough symlinks for `auth.json`, `cache`, `debug`, `session-bridge`, `session-env`, `shell-snapshots`, `skills`, `stats-cache.json`, `statsig`, `telemetry`; overlay-private empty `projects/` and `sessions/`; binary-managed `.claude.json` and `backups/`. Anything else (`CLAUDE.md`, `hooks/`, `agents/`, `todos/`, `tasks/`, `history.jsonl`, `settings.local.json` carrying personal env / GitHub PAT, `plugins/` operator enablement, ...) is intentionally not in the overlay. Stale entries from earlier blacklist-style overlays are wiped on first bootstrap with this code.
- **Whitelist overlay — Codex.** Narrower than Claude because codex's leak surfaces run deeper. `CODEX_HOME` *and* the new `CODEX_SQLITE_HOME` env both pinned to `~/.pi/agent/codex-config-overlay/` so the codex thread/memory state DB cannot drift outside the overlay through env or future code paths. Author-controlled `config.toml`; passthrough symlinks for nine entries (`auth.json`, install metadata, non-data caches, `skills`); overlay-private empty `memories/`, `sessions/`, `log/`, `shell_snapshots/`; binary-managed `state_5.sqlite{,-shm,-wal}` + `logs_2.sqlite{,-shm,-wal}` (both DB groups). Operator entries hidden by the whitelist: `history.jsonl`, `rules/` (codex execution policy, not narrative memory), `AGENTS.md` (auto-loaded by `codex-rs/agents_md.rs` as user instructions), the operator's personal `config.toml` fields. Pre-migration overlays carrying stale operator-side symlinks for the binary-managed entries get those symlinks stripped on first bootstrap with this code, so codex re-initializes fresh state.
- **Three-layer codex memory isolation.** `codexDisabledFeatures` default gains `memories` so codex stops loading operator memory entries into the developer-role context. Two more layers pinned at launch via the new `CODEX_OPERATOR_ISOLATION_ARGS` group: `memories.generate_memories=false`, `memories.use_memories=false`, `history.persistence="none"`. Plus the overlay's empty `memories/` directory itself. Defense in depth against a future codex build flipping the feature gate or renaming the keys.
- **`resolveBridgeEnvDefaults(backend, { allowCompaction })` exported helper.** Single source of truth for how the spawned child's env defaults compose with the compaction toggle. Routed through `createBridgeProcess` and exercised directly by `check-backends` so the compaction-vs-isolation separation is pinned at unit-test time, not just at production startup.
- **`tomlBasicString(value)` helper** for the Codex carrier. JSON's escape rules are a strict subset of TOML basic-string escapes (`\\`, `\"`, `\n`, `\r`, `\t`, `\uXXXX`), so `JSON.stringify(value)` produces a TOML-valid quoted form usable directly as the value half of `-c developer_instructions=<...>`. Used by both the spawn-array path and the `CODEX_ACP_COMMAND` shell-override path.
- **`BASELINE.md`** — paired-language identity-check interview (Korean + English) any human operator can run against a fresh pi-shell-acp session, plus history entries for the first PI-native baseline runs on both backends.

### Removed

- `buildCodexBootstrapPromptAugment` and the codex adapter's `buildBootstrapPromptAugment` handler. The first-prompt `ContentBlock` prepend was the previous codex carrier; `developer_instructions` replaces it. The interface point on `AcpBackendAdapter` remains for future backends that lack a higher-authority carrier.

### Verification

`check-backends` grew from 52 → 110 assertions across the two PI-native commits and the migration / compaction-isolation fix that followed. The new invariants:

- TOML escape contract for `developer_instructions` (presence/absence based on input, multi-line + embedded-quote escaping).
- Claude overlay leak canaries — operator-side `MEMORY.md` and `hooks/` must not be reachable through the overlay.
- Codex overlay leak canaries — operator-side memory, sessions data, `history.jsonl`, `rules/`, `AGENTS.md`, `log/`, `shell_snapshots/`, and the four state/logs DB files (state_5.sqlite + WAL/SHM, logs_2.sqlite + WAL/SHM) must not be reachable through the overlay.
- Migration regression — pre-migration overlays carrying stale operator-side symlinks for binary-managed entries get those symlinks stripped on first run with the new code.
- `resolveBridgeEnvDefaults` — Claude with compaction allowed strips compaction-guard env but keeps `CLAUDE_CONFIG_DIR`; Codex with compaction allowed keeps both `CODEX_HOME` and `CODEX_SQLITE_HOME` (codex's compaction guard is a launch-arg threshold, not env).
- Idempotence on second call.

### Notes for upgraders

The first session bootstrap after upgrading from 0.3.x will silently migrate the existing overlay shape. Stale symlinks carrying operator data — including, on the codex side, symlinks pointing at the operator's real `state_5.sqlite*` thread/memory state DB — are wiped automatically. The upgrade path needs no manual intervention. After the first session, `~/.pi/agent/{claude,codex}-config-overlay/` should match the whitelist shape described above; if it doesn't, the migration ran in a different process and the overlay rebuild on the next bootstrap will converge.

## 0.3.1 — 2026-04-28

### Added

- **Operator warning when `codexDisabledFeatures: []` is set explicitly.** The empty-array case opts the codex backend fully out of bridge feature gating (codex native `multi_agent` / `apps` / `image_generation` / `tool_suggest` / `tool_search` all become callable), which differs from key-absent (default `DEFAULT_CODEX_DISABLED_FEATURES` applies). The two cases were conflated in agent-config 0.2.x as "redundant defense-in-depth" — the `[]` was originally a workaround for the 0.2.1 `params.codexDisabledFeatures.spread` crash, then survived the 0.2.2 nullish-guard fix and silently flipped the codex tool surface from fail-closed to fail-open. Bridge now emits a one-shot stderr warning on first bootstrap whenever explicit `[]` is observed (`[pi-shell-acp:warn] codexDisabledFeatures=[] in settings.json explicitly opts out ... To restore the fail-closed default, remove the codexDisabledFeatures key`). Throttled to once per process — does not repeat on prompt or model switch. Key-absent and partial-disable cases stay silent. Surfaced after a Codex identity-check session reported `spawn_agent` / `mcp__codex_apps__github_*` as available native tools on a fresh 0.3.0 install where the operator's `~/.pi/agent/settings.json` carried the legacy `[]` knob.

## 0.3.0 — 2026-04-27

### Fixed

- **claude-agent-acp child no longer silently exits when the SDK's auto-detect resolves the wrong libc variant.** claude-agent-acp 0.31.0 (`dist/acp-agent.js:1298`) reads `process.env.CLAUDE_CODE_EXECUTABLE` only and ignores the `_meta.claudeCode.options.pathToClaudeCodeExecutable` pi-shell-acp passes. NODE_PATH (set by the pnpm-installed pi-coding-agent wrapper) hoists both musl and glibc variants of `@anthropic-ai/claude-agent-sdk-linux-<arch>-*`; the SDK's `[musl, glibc]` resolution order picks musl first and spawn fails with ENOENT on glibc hosts → child silent exit → "Internal error" after retry. pi-shell-acp now sets `CLAUDE_CODE_EXECUTABLE` in the child env from `resolveClaudeCodeExecutable()` (libc-aware). Operator's exported var still wins (process.env spread last). Surfaced as "Internal error" on oracle ARM aarch64.

- **`~/.pi/agent/entwurf-targets.json` auto-symlinked at install time.** `pi-extensions/lib/entwurf-core.ts:45` reads `~/.pi/agent/entwurf-targets.json`, but the package shipped the canonical version only at `<install_dir>/pi/entwurf-targets.json`. Without manual setup, any `entwurf` tool call threw `EntwurfRegistryError` (lazy — no surface during plain `pi --model ...` runs but blocks delegation immediately). `run.sh install_local_package` now creates the symlink idempotently and preserves any operator override (file or differently-targeted symlink left untouched).

## 0.2.2 — 2026-04-27

### Fixed

- `ensureBridgeSession` no longer crashes with `TypeError: params.codexDisabledFeatures is not iterable` when callers omit the `codexDisabledFeatures` field. The 0.2.0 introduction of the `codexDisabledFeatures` knob added required spreads in `createBridgeProcess` and the reuse path, but `loadProviderSettings`'s default fallback only covers callers that go through `index.ts` (i.e. the production `pi --model ...` path). Smoke embed scripts in `run.sh` (and any third-party caller) bypass that fallback and were exposed to the spread crash. Both spread sites now normalize via `params.codexDisabledFeatures ?? DEFAULT_CODEX_DISABLED_FEATURES`, matching what `loadProviderSettings` would have applied. Universal — any backend (claude, codex), any caller path. Surfaced as "Internal error" in pi sessions on a fresh consumer install.
- `run.sh` smoke embed scripts (`smoke-claude/codex`, `smoke-cancel`, `smoke-model-switch`) now declare `codexDisabledFeatures: []` explicitly so caller intent is visible at the embed site, not only via the `acp-bridge.ts` fallback.

### Docs

- `AGENTS.md` § Entwurf: cross-reference the resident-side naming pair `MITSEIN.md` in agent-config (Mitsein/Entwurf as Heidegger pair — pi-shell-acp owns the entwurf side, resident conventions live in agent-config). Also clarify the bare-model auto-resolution rule in the target-registry bullet.

## 0.2.1 — 2026-04-27

### Fixed

- Consumer install no longer breaks when `husky` is not installed (dev-only dep). The `prepare` script falls through with `|| true`, so `pi install git:github.com/junghan0611/pi-shell-acp` works on machines that don't have husky. Previously failed with `husky: command not found (sh: line 1, exit 127)` on consumer install paths (e.g. Oracle).

## 0.2.0 — 2026-04-27

First public release. Used daily by the maintainer; not promised to work elsewhere yet.

### ACP bridge

- Provider `pi-shell-acp` registers with pi. Models route to backends by curated allowlist (`claude-sonnet-4-6` / `claude-opus-4-7` → Claude, `gpt-5.x` from `openai-codex` → Codex), with prefix fallback for non-curated IDs.
- Bootstrap order is `resume > load > new`, with `pi:<sessionId>` persisted under `~/.pi/agent/cache/pi-shell-acp/sessions/`.
- Per-turn `usage_update` (or `PromptResponse.usage` fallback) drives the pi footer context meter; the bridge does not maintain a separate meter.

### Operating-surface contract

- Claude side: `tools` defaults to `[Read, Bash, Edit, Write]` (auto-adds `Skill` when `skillPlugins` is non-empty). `disallowedTools` default blocks the SDK's deferred-tool advertisement (`Cron*`, `Task*`, `Worktree*`, `EnterPlanMode`/`ExitPlanMode`, `Monitor`, `NotebookEdit`, `PushNotification`, `RemoteTrigger`, `WebFetch`, `WebSearch`, `AskUserQuestion`). `settingSources: []` + `strictMcpConfig: true` by default. `permissionAllow` wildcards thread into `Options.settings.permissions.allow`.
- Codex side: `approval_policy=never` + `sandbox_mode=danger-full-access` + `model_auto_compact_token_limit=i64::MAX` pinned at every launch. `web_search="disabled"` and `tools.view_image=false` pinned. `codexDisabledFeatures` (settings.json) materializes as `-c features.<key>=false` flags; defaults to `image_generation`, `tool_suggest`, `tool_search`, `multi_agent`, `apps`. Operator can opt fully out with `[]` or override.
- Both backends launched with config overlays (`CLAUDE_CONFIG_DIR=~/.pi/agent/claude-config-overlay/`, `CODEX_HOME=~/.pi/agent/codex-config-overlay/`) — pi-authored config file + symlinks for every other entry, idempotent rebuild on each launch. Operator's exported env wins.

### Compaction policy

- Host: `session_before_compact` returns `{cancel: true}` for every pi compaction trigger (silent overflow recovery, threshold compaction, explicit-error overflow, manual `/compact`). Opt out with `PI_SHELL_ACP_ALLOW_COMPACTION=1`.
- Backend: `DISABLE_AUTO_COMPACT=1` + `DISABLE_COMPACT=1` (Claude), `model_auto_compact_token_limit=i64::MAX` (Codex).

### Entwurf

- Sync + async spawn (`pi-extensions/entwurf.ts`), shared registry + identity preservation (`lib/entwurf-core.ts`), Unix-socket control plane (`entwurf-control.ts`, ingested from Armin Ronacher's `agent-stuff` under Apache 2.0).
- Spawn target allowlist at `pi/entwurf-targets.json`.
- MCP adapter `pi-tools-bridge` exposes `entwurf`, `entwurf_resume`, `entwurf_send`, `entwurf_peers`. Send is fire-and-forget.
- `mcp/session-bridge/` carries Claude Code ↔ pi session messages (`list_sessions`, `send_message`, `receive_messages`, `session_info`).

### Engraving

- Short additive text from `prompts/engraving.md`, delivered via `_meta.systemPrompt.append` (Claude) or first-prompt `ContentBlock` prepend (Codex). `{{backend}}` and `{{mcp_servers}}` substituted at bootstrap. The engraving appends to the backend's native system prompt; it does not replace it.

### Tooling

- `./run.sh` covers install, smoke (Claude / Codex / both), resume verification, MCP bridge check, sentinel, session-messaging.
- `check-backends` (52 assertions) gates launch flag composition, override paths, and `codexDisabledFeatures` empty / partial cases.
- `check-dep-versions` catches version-pin drift between `package.json` and `run.sh`.
- Husky pre-commit hook runs typecheck + check-backends + check-models + check-mcp + check-dep-versions; skipping requires explicit acknowledgement.
- Release flow lives at `.pi/prompts/make-release.md` + `scripts/release.sh`.

### Pinned versions

- `@agentclientprotocol/claude-agent-acp@0.31.0`
- `@zed-industries/codex-acp@0.12.0`
- `@agentclientprotocol/sdk@0.20.0`
