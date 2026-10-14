# NEXT — core 0.36.1 patch cut from #128 checkpoints
Author: Claude Opus 5.5 (claude-code 20261011T202615-521a11, 2026-10-14) on coordinator routing (pi-durable 20261008T113104-801621) — not GLG direct.

# RAIL — 현재 좌표
- [x] **1. Core 0.36.0 / Herdr plugin 0.36.0** — `v0.36.0` at `daf8cab` and `v2026.10.14-herdr.0.36.0` at `9f33dd1`; their acceptance records stay in CHANGELOG and `452c461`. Both tags and the npm 0.36.0 bytes are immutable.
- [x] **2. #128 checkpoints** (branch `feat/128-codex-socket-ownership`, fast-forwarded onto main):
  - `fdf8c3d` — the Codex smoke reads app-server socket ownership from the kernel (CP-A1; PARTIAL 150/150);
  - `3da44be` — Claude ACP closure 0.85.1→0.90.0 (PARTIAL 4/4; first readback launch-and-overlay-seam only);
  - `3e4f52f` — five ACP turn-loop gates sandboxed off the operator overlay (PARTIAL 45/45);
  - `3242922` — the production-meta readback on 0.90.0 (no prompt; 3 curated answers unchanged).
  - PARTIALs are inner-loop evidence only, not a FULL, CI or LIVE pass.
- [ ] **3. Core 0.36.1 patch cut** ← CURRENT (GLG: "응 진행하자", 2026-10-14). prepare → make with the required LIVE `--cut` and exact-SHA CI; GLG publishes npm.

# NOW
- **Cut scope:** the Codex socket-ownership smoke, the ACP 0.90.0 compatibility move and the offline gate isolation. No #142 feature and no Herdr change; the plugin keeps core 0.36.0 / host 0.9.4.
- **Codex LIVE seat:** the 0.36.0-era app-server (PID 851181 / tmux $443) was stopped by approval at 11:26:50 KST. The cut starts its own owned server in a separate session A (A ≠ S) with the explicit `--listen` wrapper shape that CP-A1 admits. A vendor-managed daemon is not admitted; that is CP-A2.
- **Open in #128, not claimed by this cut:**
  - CP-A2 managed-daemon admission;
  - the Copilot 1.0.97 cell;
  - agy 1.3.1 (NOT CERTIFIED);
  - the OMP 18.10.4 doctors;
  - the remaining native cells (C).
- **Observations kept with their limits:** overlay `projects/` 524 → 469 during the first readback (cause unmeasured; GLG decided no retention change, which is not a deletion approval), and one inbound-tap stream error per readback.
- **Parked:** #142. When GLG switches to it, the coordinator re-opens session `20261014T115640-17d999`; memory file `.tmp-verify/128-kickoff-037/COORDINATOR-142-REENTRY.md`.
- **Carried limits from the Herdr plugin cut (unmeasured, not claimed):**
  - session MCP/model continuity across a reinstall;
  - `pi update self`;
  - host Pi or Herdr upgrade;
  - a `plugin update` that finds a new commit;
  - herdr-pane ROW;
  - x86_64 container;
  - the tag as `--ref`;
  - when Herdr reclaims a retained previous installation.
- **Authority:** the coordinator routes every step; GLG decides commit, push and release. Agents never npm publish.

# GUARDRAILS
- Engine/auth/queues/storage/transcripts/recovery stay upstream (Rule 9). No second harness, source clone/worktree, ambient discovery, login probing or credential mediation.
- Never run local `check-herdr-sandbox`: its `operatorPanes()` reads actual host panes. No bypass/new seam/fake PASS; the full gate is CI's.
- No local qualification BODY or gratuitous FULL/model matrix; affected PARTIAL groups only; one CI per landing, not per checkpoint. No replay of healthy checks.
- Preserve records/transcripts/DB/WAL/credentials/stash/assets/unknown roots and the protected drafts `content/blog/20260804T094556.ko.md` / `.md` in the homepage repo. Never infer a PID or rewrite/reset/unlink a socket; stop only the server this cut owns, gracefully. Clean only residue whose prefix and provenance are confirmed and not in use; no global prune.
- Verification drivers use explicit sandbox environment allowlists and names/versions only: no wildcard environment dumps or raw credential/transcript reads. Private incident chronology stays in owned ignored receipts, not public text.
- #78 and GLG's agent-config useful-extension investigations remain deferred. GLG is watching; no duplicate/progress DM.
