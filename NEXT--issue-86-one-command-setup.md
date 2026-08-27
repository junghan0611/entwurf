# NEXT — #86 one-command presence-driven setup

> Branch-only disposable handoff. Delete before merge. Durable contract and evidence: https://github.com/junghan0611/entwurf/issues/86

# RAIL — 현재 좌표

- [x] **1. Source operator + contract** — `e08d937` exposed the source `entwurf` bin; GLG fixed the rule: Entwurf installs itself only and composes operator-installed harnesses.
- [x] **2. C1 presence-driven setup kernel** — `32d161c`; mode-first setup, credential-mutation removal, truthful PASS/SKIP/FAIL, optional Pi, package consumer evidence.
- [x] **3. C2 ownership + C3a Copilot lifecycle** — `096a5cd` + review anchor `47a5ae3` + accepted corrective `93575f0`; B's seven findings closed, qualification 274/274, final full green.
- [x] **4. C3b Copilot composition** — `ba13f84`; setup composes present Copilot birth→MCP→receiver→footer as independent outcomes; qualification 277/277, frozen full 500s green.
- [ ] **5. Branch close** ← CURRENT: platform obstruction matrix delivered with zero edits; #86 stops at Linux one-command setup, while macOS/native-Windows portability continues in #78. Update the issue boundary, commit this handoff, and ask B for final branch review.

현재 좌표: **#86 product work complete** → issue #86/#78 boundary comments + handoff commit → B final branch review → GLG push/merge decision. No platform implementation remains on this branch.

# NOW — close #86 cleanly

- **Current:** HEAD `ba13f84`, worktree contains only this branch-handoff rewrite. Linux one-command setup is complete through C3b. The platform matrix fired the native-Windows product-scale stop rule; no macOS/Windows product or CI bytes were added.
- **Next:** (1) commit this NEXT closure → (2) amend issue #86's title/body so the original cross-platform clauses are explicitly transferred, not silently deleted → (3) post the matrix to #86 and the existing portability rail #78 → (4) ask B to review the full local branch through the handoff commit.
- **Blocker:** none.
- **Do not touch:** macOS CI, native-Windows front door, credentials, delivery/ACP/mux behavior, push/release. Platform implementation belongs to #78 after a separate GLG decision.

# RECENT — accepted branch evidence

## C2 corrective + C3a lifecycle — `93575f0`

- B final GO: https://github.com/junghan0611/entwurf/issues/86#issuecomment-5433159224
- Pi user scope uses one exact-owner classifier; provider `installerRoot` is typed and fail-closed across writers/doctor.
- Copilot birth uses shared marketplace/plugin/assembly oracles; duplicate, malformed and whitespace-drift states refuse before mutation.
- Qualification 274/274: `/tmp/agent-glm-qualification.log`, sha256 `2a07719bace99a2c723788d4d362f40d665fe12242fb69e7783a6fbddabb0657`.
- Final full: `/tmp/agent-glm-checkfull-final.log`, 499s exit 0, sha256 `9dc566881ea27844fae6c5c8adb41464b7543d9d81885b5633a216ee9d3cc720`.

## C3b composition — `ba13f84`

- Issue checkpoint: https://github.com/junghan0611/entwurf/issues/86#issuecomment-5433918890
- Absent Copilot is zero-state SKIP; present Copilot runs four independent setup outcomes and any failure owns aggregate nonzero without suppressing later attempts.
- Setup-verdict lane 7→10; packed absent/present consumers share the executable child-process fake vendor.
- Qualification 277/277: `/tmp/agent-fable-c3b-qualification.log`, sha256 `b20bead53d2637997c6873f82e9be4392f7c2d4e79339b5bd3217d268a4ce4fd`.
- Frozen full: `/tmp/agent-fable-c3b-checkfull.log`, 500s exit 0, sha256 `ed6343c9cd5fe4809dc643e538f3496d97259ab3d0e02c3ce6d327d621dcc57c`.

## Platform boundary — measurement only

- Artifact: `/tmp/agent-fable-platform-matrix.md`, sha256 `cd951fe588bd2abeac123badc72cd377ca4a64e4d5f609108089b0085f93b489`.
- Linux global npm / project-local npm / source modes are measured and supported; WSL is Linux.
- macOS Entwurf-only install is plausible but unmeasured; existing Claude/Copilot harness refusals stay named and no runtime support is claimed.
- Native Windows is product-scale obstructed: all six package bins are Bash, the operator front door is the 6,245-line `run.sh`, source exposure is symlink-shaped, and process seams are POSIX. The recorded stop rule fired; no wrapper or Node rewrite began.
- Existing issue #78 owns the unified portability rail. Keep macOS and native Windows together there rather than leaving #86 half-cross-platform.

# B FINAL REVIEW PACKET

Review the local branch range `e08d937..HEAD`, with product emphasis on:

1. `32d161c` — presence-driven setup kernel;
2. `096a5cd` + `93575f0` — Pi ownership and the corrective amendment;
3. `47a5ae3` + `93575f0` — Copilot birth lifecycle and parser/oracle correction;
4. `ba13f84` — C3b presence-only composition and package-consumer proof;
5. this handoff commit — #86 stops at Linux setup; platform implementation transfers to #78 without a macOS/Windows support claim.

B should report Blocker/Defect/Observation with file:line or named receipts. No new implementation starts before that verdict.

# CLOSE RULES

- Push, merge, close and release remain separate GLG decisions.
- Before merge: repo-wide stale-prose sweep; promote any durable fact not already in issue #86/#78; delete this branch NEXT.
- Do not reopen platform work on this branch. #78 begins from its own explicit grant and physical target-OS evidence.
