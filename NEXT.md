# NEXT — one 0.34.0 delivery, then Herdr

Author: gpt-6.1-sol (pi-durable coordinator, 2026-10-09) — not GLG direct.
Main handoff only; implementation details belong to the active branch's NEXT and the live #133/#134 threads.

# RAIL — 현재 좌표

- [x] **1. SDK1.1.0 / Entwurf0.33.0 publication** — published `fea9b3dc4779ac5deb34e239abc8e0b5e3e95382`; final exact-SHA four-job CI and registry-byte acceptance completed.
- [ ] **2. #134 → #133 → ONE0.34.0** ← CURRENT: implementation, review and affected PARTIALs done; prepare and make 0.34.0 up to, not including, npm publication.
- [ ] **3. Herdr alignment** ← PAUSED: resume the preserved #132 B/C only after actual0.34.0 npm publication, against those actual bytes.

# NOW

- **Next:** #133 checkpoint commit → local main ff → `entwurf-release prepare 0.34.0` (P1–P9) → `make 0.34.0` (M0–M7) → STOP before `publish`. No #134-only release, no `land` push.
- **Authority:** GLG direct, 2026-10-09: “수고많았어. 진행하자. 이번 릴리즈 아주 중요하다. 나가기전에 꼼꼼히 문서들 검토추가로 맡기고 진행시작해 npm publish 전까지 가줘 오푸스에게 맡겨.” That grants the #133 checkpoint plus 0.34.0 prepare and make (one prepared main push, exact-SHA CI, one preserved artifact, tag, GitHub release). It does not grant npm publication, Herdr alignment, a writer replacement or a session restart. No old0.33 deadline waiver transfers.
- **Acceptance:** development whole BODY0; changed exact-argv groups receive scoped PARTIALs after review/amendment. The normal whole BODY owner is final exact prepared-SHA CI once; a prepared state awaits CI, never presumed PASS. Preserve native/LIVE MUST, installed/package/artifact acceptance and four required CI jobs. For 0.34.0, P6 (before P7) also owes, each unrun until it runs: `check-pack-install` including #134's directory cell; `check-pi-durable-contact`/`-send`/`-receive` against a private bridge bundle emitted from the candidate, plus the `native-module` send cell; GLG's visible terminal of the task badge; the consumer's installed integration; VERIFY §3 native leaves 4 (Claude meta-bridge), 7 (agy) and 8 (Codex). FULL P4/P5/M0 and CI repetition are not retired in this first repair. Actual0.34 counts, timings and savings remain unmeasured until execution.
- **Queue:** #132 closed not-planned/deferred, not completed; unfinished B/C remain in ROADMAP and the original issue body/thread. Reopen the same issue after actual0.34 publication. Current implementation destinations are #76/#78/#108/#133/#134 (five).
- **Read:** current #133/#134 issue bodies and threads; ROADMAP's #132 carry; AGENTS, VERIFY, release skill. Branch-local receipts are scoped evidence, not installed/native/full-cut acceptance.
- **Protect:** auth/settings/records/transcripts/SQLite, archives, foreign processes and all historical RED/abort/loss evidence. No inferred identity/model/trust, credential or CSRF extraction, unsafe hook override, worktree or development clone. A genuine blocker or unstable context means bookmark, STOP, report and wait—not an automatic reconnect/replacement/retry loop.

# RECENT

- #134 normal local checkpoint `74d5ff785fdf443adcc1c30361af5bc57452169b` is unpushed. Its old58/909 PARTIAL was never a whole-body or new-tree PASS; #133 changes run.sh in C0, so that receipt does not carry into the new tree.
- Historical0.33 cut/deadline/lifecycle decisions are preserved at `v0.33.0:NEXT.md` and the protected `.tmp-verify/033-coordination/` / `.tmp-verify/033-implementation/opus/` receipts. P5 rc143/322s remains aborted, not PASS; later exact-SHA CI/registry acceptance does not retroactively turn that abort green.
