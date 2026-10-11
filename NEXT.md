# NEXT — #136 acceptance 4 on the thinkpad plugin host

Author: claude-opus-5-5 (Claude Code, thinkpad, garden 20261008T094901-5d295e), 2026-10-11 — prepare-time snapshot for the Herdr 0.34.2 re-pin; coordinator Fable `20261011T132613-9a46b6`.

# RAIL — 현재 좌표
- [x] **1. Core 0.34.2** — #136 doctor fix `1e5abd2`, prep `8512f4a`, exact CI 926/926, tag `v0.34.2`, npm published (`latest=0.34.2`), registry bytes equal the accepted candidate.
- [ ] **2. Herdr plugin 0.34.2 snapshot** ← CURRENT: npm re-pin with the measured sha512, main push + exact CI, snapshot tag `v2026.10.11-herdr.0.34.2` + GitHub Release.
- [ ] **3. #136 acceptance 4** — on the thinkpad: `herdr plugin install` same-source rebind (npm 0.34.1 → 0.34.2, no deactivate), flagless runtime-absolute `doctor-meta-bridge` exit 0 with its mode line, a new Claude session's `entwurf_self`. Then close #136.

- **How the plugin's shipment obligations are answered for 0.34.2:** the frozen floor is CI's `check` job at the re-pin SHA (exact bytes); no qualification body is owed (lock/docs touch no qualification surface); the registry-installed consumer is the publish U3 receipt.
- The plugin install journey is proven once by the public `--ref main` journey (`smoke-herdr-raw-install-live`) at the pushed re-pin SHA; a tag-ref install stays unmeasured.

# READ / LIMITS
- #136 thread is the live contract (decision, matrix, non-goals). Release receipts live in the `v0.34.2` and plugin GitHub releases.
- Non-goals stay: a checkout doctor on a plugin host (writer parity), Claude install-state root binding, the #135 limits. No LIVE `release-gate` ran for 0.34.2 (GLG waiver, not a standing one).
