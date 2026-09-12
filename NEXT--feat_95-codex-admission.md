# NEXT — #95 Codex native sibling admission

Branch-only handoff for `feat/95-codex-admission`. Delete this file before any merge to main.

# RAIL — 현재 좌표

- [x] **1. Native candidate wiring** — USER birth/trust, strict identity, native-push, visible fresh.
- [x] **2. Earlier A receipt** — `6e28c9e` real same-session `Pi → Codex → Pi`, 50/50 green.
- [x] **3. Vendor source boundary** — official Codex 0.153.4 has no request→arbitrary-attached-TUI seat carrier.
- [x] **4. Product scope decision** — exact existing tmux session `codex` is the supported operator-owned home; unrestricted B is not required.
- [x] **5. Main intake** — #111 `77b2ade` + #112 `741cfcd`, merged here as `771eafb`.
- [x] **6. Home-topology implementation and focused proof.**
- [x] **7. Four-coordinate LIVE** — 2026-09-12, 57 assertions: initial Pi outside home → Codex in `codex` → outbound Pi in `codex`, callbacks/delivery both ways.
- [x] **8. Qualification + full floor** — 460/460 killed with both purity axes green; final floor exit 0 in 506s.
- [ ] **9. Commit → close #95 → merge to local main** ← CURRENT.
- [ ] **10. Prepare release `0.20.2`** — version change only inside explicitly authorized release prepare; no push/tag/publish.

현재 좌표: candidate wiring → A green → topology bounded → `codex` home selected → implementation/focused proof → **four-coordinate LIVE green** → **qualification/full green** → commit/close/local-main merge → release prepare

# NOW — explicit Codex home, no hidden manager

- **Current branch/head at intake:** `feat/95-codex-admission` / `771eafbb549cdb5bfd79b2f42433aaacb192b7db`, clean before current edits.
- **Decision receipt:** [Entwurf #95 home-session decision](https://github.com/junghan0611/entwurf/issues/95#issuecomment-5643212081).
- **Supported topology:** operator owns one existing exact tmux session named `codex`; app-server and supported Codex TUIs sit there. Omitted Codex fresh placement selects that name. Explicit placement remains an expert override.
- **Acceptance:** run the LIVE from a different tmux session. Record initial Pi, app-server, fresh Codex, and outbound Pi coordinates separately. Require exact callback correlation and addressed delivery both directions.
- **Boundary:** exact Codex 0.153.4 still has no request→arbitrary-attached-TUI seat join. That topology is unsupported and unclaimed, not a blocker to the explicit home.
- **Read:** `DELIVERY.md`, `VERIFY.md`, `docs/mux-launch-rail.md`, `scripts/smoke-codex-fresh-live.ts`, [openai/codex#44774](https://github.com/openai/codex/issues/44774).
- **Do not:** create/supervise the app-server in product code, infer/scrape panes, turn tmux placement into an address axis, weaken callback identity, push/tag/publish, or edit package version before release-prepare authority.

# RECENT — durable receipts

## Main intake

- #112: `741cfcd36bdda66d169256937d4f10508061f013` — bounded historical peer observation; qualification 394/394 and full floor green before landing.
- #111: `77b2adeed0bed6ab2b83c790a847c7ae390d5bbf` — compaction/busy send guard; qualification 401/401 green before landing.
- Feature merge: `771eafbb549cdb5bfd79b2f42433aaacb192b7db`; post-merge diff/typecheck/focused gates green.

## Earlier A green

- Product SHA: `6e28c9e`.
- Receipt: `.probe-artifacts/a95-live-20260911T162152-6e28c9e.log`.
- SHA-256: `e159f8fd1cf23cb1abd7782dc9e24cf9604add6b61ae24b7fd5260f16dfc2795`; 50 assertions, exit 0.
- Chain: Pi `20260911T162155-0db222` → Codex `20260911T162210-a974fe` → Pi `20260911T162238-7dcdaa`; all resolved to tmux `$158`.
- This proved the shared-seat mechanism, not the final cross-session-entry home default.

## Explicit-home acceptance green

- Receipt: `.probe-artifacts/20260912T140745-codex-home-live-green.log`; SHA-256 `09e79bd1b62962f8a11d647ee456a71b11965b6792c7972d97ac4992119c91d7`; 57 assertions, exit 0.
- Coordinates: initial Pi `20260912T140748-355654` at `$150/@397`; app-server PID `1693273` at `$158/@390/%390`; Codex `20260912T140800-8bc8d9` / thread `01a09403-e232-76b0-af9a-5cbaed8d94a9` at `$158/@398`; outbound Pi `20260912T140829-a08178` at `$158/@399`.
- Nonces: Codex `mux-fresh-call-5d28f8e5bc2acf275ded30ec`; outbound Pi `mux-fresh-call-7a5fb4960dbb172843eb14fe`. Pi → Codex native-push delivered; Codex → Pi callback exact; title read back as the Codex garden id.
- Two red LIVE runs mended the fixture: passive wait now forbids `wait_agent`/every wait tool, and exact raw receipts come from the Pi transcript/Codex thread rather than model-reformatted copies. Failure cleanup interrupts only the exact smoke-owned active Codex turn.
- First qualification was honestly 454/460, not accepted: one stale wait mutant, one safe-umask wrong-reason after the stronger parent-mode doctor, and four claims under one setup control-red. The manifest/attribution were repaired; setup's behavior gate now uses a strict pnpm fixture (no-op install, snapshot-local build emit removed on exit) so qualification never follows its shared `node_modules` symlink into the origin checkout.
- Second qualification killed 460/460 but was correctly rejected as snapshot-impure: the fixture's production dist-lock wrapper removed its lock yet left the ignored `.tmp-verify` parent. It now invokes the process-exclusive snapshot emit directly. Focused replay `bg22` measured identical pre/post tree manifests (`2014ed0f…`), 135 setup checks, and exit 0.
- Accepted qualification `bg23`: 460/460 killed across 43 lanes in 53m42s; origin HEAD/work-surface and snapshot tree/porcelain purity all green. Biome then collapsed only the new manifest arrays onto one line (same claim/subject/find/replace bytes and semantics); final `pnpm run check:full` `bg25` passed in 506s.

## Vendor boundary

- Pinned vendor: `rust-v0.153.4` / `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`.
- No official no-patch request→arbitrary-attached-TUI join survived source audit.
- `responsesapi_client_metadata` reaches MCP `_meta` and hooks, but official TUI hard-coded `None` for TurnStart/TurnSteer at that version.
- No further upstream question is required for #95; the home-topology scope is an Entwurf product decision.

# PRESERVE

- The operator-owned tmux session was renamed from `codex-server` to exact `codex` while preserving native id `$158` and original shell `@351/%351`. The accepted app-server is PID `1693273` at `$158/@390/%390`; Entwurf does not supervise it.
- Vendor trust remains GLG's visible consent; never compute, pre-seed, or bypass `trusted_hash`.
- Keep this branch handoff until #95 is ready to merge; delete it before merging to main.
- GLG decides commit/push/release boundaries. Current authorization includes implementation, verification, #95 completion, and release preparation only — never push/tag/publish.
