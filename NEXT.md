# NEXT — after core 0.36.0 and the Herdr plugin 0.36.0 snapshot
Author: Claude Opus 5.5 (claude-code 20261011T202615-521a11, 2026-10-14) on coordinator routing (pi-durable 20261008T113104-801621) — not GLG direct.

# RAIL — 현재 좌표
- [x] **1. Core 0.36.0** — `v0.36.0` at `daf8cab`; GLG published npm 0.36.0, registry bytes identical to the accepted artifact. The core CI's oracle refusal of stale step metadata is a GLG-accepted per-cut exception, not a PASS or a later waiver.
- [x] **2. Herdr plugin 0.36.0 on Herdr 0.9.4** — snapshot `v2026.10.14-herdr.0.36.0` at `9f33dd1` (GitHub release, not Latest). One main push, one CI (38479767989: four jobs, oracle PASS, `check-herdr-sandbox` 12 on 0.9.4, 971/971). Public-ref LIVE before publication: the first user path at `main` = `9f33dd1`, and a version-changing cross-ref reinstall (`install --ref main` over the 0.35.1 snapshot) across a pinned Pi 1.1 → 1.2 upgrade with a running session surviving (10/10); `plugin update` was a same-ref no-op only. #141 closed with its completion comment. Homepage `87940b5` pushed and its deployed gate `verify-deployed.mjs https://junghanacs.com 87940b5…` rc 0 (21 paths); the coordinator updated the steward note 052051 through the Emacs API.
- [ ] **3. #128 multi-harness inspection (ACP 0.90.0 · Codex · OMP · Copilot)** ← CURRENT: #128 read-only planning / GLG measurement-repair decision pending.

# NOW
- **Next:** #128, starting read-only. The issue body's top contract is current (coordinator-updated 2026-10-14). One measured open item: `scripts/smoke-codex-fresh-live.ts:777-785` (read at `9f33dd1`) labels the check "the explicit app-server PID owns the same default UDS" but its predicate compares only `--listen` argv spelling. The repair is a design decision (owner from the socket, not argv; a separate tmux-seat precondition), not yet approved. ACP pin stays 0.85.1 until its own measured move.
- **Carried limits from the plugin cut (unmeasured, not claimed):** session MCP/model continuity across a reinstall; `pi update self`; host Pi or Herdr upgrade; a `plugin update` that finds a new commit; herdr-pane ROW; x86_64 container; the tag as `--ref`; when Herdr reclaims a retained previous installation. The supply manifest's x86_64 `executed: false` is still the preparation-time declaration — flipping it is a separate, gate-bound change.
- **Documentation follow-up:** CHANGELOG/README/VERIFY/NEXT record the completed cut on main; this docs-only follow-up changes no package, version, runtime or supply declaration. Acceptance remains bound to the immutable snapshot at `9f33dd1`. GLG approved this commit/push without a CI run (`[skip ci]`), so the docs SHA claims no CI PASS.
- **Authority:** every step is routed by the coordinator; GLG decides commit, push and release. Agents never npm publish. Core tag `daf8cab`, plugin tag `9f33dd1` and the npm 0.36.0 bytes are immutable.

# GUARDRAILS
- Engine/auth/queues/storage/transcripts/recovery stay upstream (Rule 9). No second harness, source clone/worktree, ambient discovery, login probing or credential mediation.
- Never run local `check-herdr-sandbox`: its `operatorPanes()` reads actual host panes. No bypass/new seam/fake PASS; the full gate is CI's.
- No local qualification BODY or gratuitous FULL/model matrix; affected PARTIAL groups only; one CI per landing, not per checkpoint. No replay of healthy checks.
- Preserve the operator Codex app-server PID 851181 / tmux $443, records/transcripts/DB/WAL/credentials/stash/assets/unknown roots, and the protected drafts `content/blog/20260804T094556.ko.md` / `.md` in the homepage repo. No operator restart/upgrade/config change, inferred PID replacement, socket rewrite/reset/migration, historical worktree repair/prune or manual cleanup/GC. P9 is read-only.
- Verification drivers use explicit sandbox environment allowlists and names/versions only: no wildcard environment dumps or raw credential/transcript reads. Private incident chronology stays in owned ignored receipts, not public text.
- #78 and GLG's agent-config useful-extension investigations remain deferred. GLG is watching; no duplicate/progress DM.
