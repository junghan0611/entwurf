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
- [x] **3. Core 0.36.1 prepared** (`91cc080` smoke fix + `chore(release): prepare v0.36.1`). Local FULL RED on the Herdr sandbox cell only (owed to CI by GLG's per-cut decision); `check:package` PASS; LIVE taken step by step, MUST 23/23 (22 + the fixed pi-durable step), BEHAVIOR not run. Evidence: CHANGELOG 0.36.1 "Release boundary and verification".
- [ ] **4. Make 0.36.1** ← CURRENT (GLG: "0.36.1로 npm publish 전까지 가자"). One main push → exact-SHA CI (4 jobs + whole body + `check-herdr-sandbox` on pinned 0.9.4, which must pass) → one preserved candidate + container acceptance → tag `v0.36.1` → GitHub release. GLG publishes npm, then the Herdr lock is re-pinned in a separate verified commit.

# NOW
- **Cut scope:** the Codex socket-ownership smoke, the ACP 0.90.0 compatibility move, the offline gate isolation and the pi-durable smoke timing fix. No #142 feature. The Herdr manifest stays 0.36.0, its host pin 0.9.4 and the plugin implementation unchanged, but the runtime acquisition source does change while the carrier below stands.
- **Herdr runtime-lock carrier:** as in every core prepare, `plugins/herdr/runtime-lock.json` rides the closed `herdr-checkout` source while 0.36.1 has no published integrity (an npm lock must equal the checkout's version). Effect: a `--ref main` Herdr install acquires this cut's checkout runtime until the re-pin; the Herdr 0.36.0 tag and npm 0.36.0 bytes are unchanged, and a source switch needs explicit deactivate/activate. After GLG publishes 0.36.1, a separate verified commit re-pins the measured registry bytes; it is not part of this cut.
- **Codex LIVE seat:** this cut started its own app-server (`./run.sh codex-app-server`, PID 2345801, tmux $469 ≠ gate $470) and stopped it with one TERM at 16:15:33 KST; the vendor removed its alias. A vendor-managed daemon is not admitted; that is CP-A2.
- **Follow-up, unresolved (not this cut):** the release floor and the local Herdr guardrail conflict. `check:full` ends `check:hermetic` with `check-herdr-sandbox`, and `release-gate`'s first MUST re-runs `check:full`, so neither can be run locally without the forbidden cell. Before the next prepare, expand the FULL and release-gate chains against GUARDRAILS first. A host Herdr install does not lift the guardrail, and this cut's per-cut exception is not inherited. Separating the floor is a design question for the owning docs (VERIFY / the release skill), not a change made here.
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
