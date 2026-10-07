# NEXT — 0.31.0 closed → approved docs push → #130 / 0.32.0 discussion

# RAIL — 현재 좌표

- [x] **1. 0.31.0 native admission/release** — #129 CLOSED, reviewed LIVE36, final P5 GREEN, prepared-SHA CI872/872, exact tarball Docker, tag/GitHub release complete.
- [x] **2. Public metadata/docs cleanup prepared** — description/topics updated; README + this handoff passed focused checks. GLG explicitly approved commit/main push; observe its receipt, do not re-cut0.31.0.
- [ ] **3. Registry result** — GLG reports npm publish done; first version lookup still404 during propagation. Observe accepted bytes/install result, never republish around delay.
- [ ] **4. #130 / 0.32.0** ← CURRENT: discussion after the approved docs push. Read the current issue thread and select the first narrow contract; do not reopen0.31.0 floors or silently start implementation.

# NOW

- **Next:** observe the explicitly approved documentation-only main push/stamp, then discuss [#130](https://github.com/junghan0611/entwurf/issues/130)'s live thread with GLG to establish0.32.0's first action. Runtime supply/Pi upgrade/ACP/UI follow-ups stay there, not retroactive 0.31.0 release blockers.
- **State:** release baseline/tag `a2c1aad0d89a33880d7b2f1ac43102d47a1ff207`; post-release docs are a separate commit, never a moved tag/repacked artifact. Read git and `.tmp-verify/031-release/post-release/` for the approved push's actual SHA/receipt. Package remains0.31.0. No0.32 version bump, code change, new sibling, or implementation grant is inferred from scheduling the next issue.
- **Public cleanup:** GitHub description now names pi-durable and describes messaging without claiming every backend can spawn. `pi-durable` topic added, existing topics retained. Earlier README blob matched GitHub main (`56793b40e2921bf4b12b0cd2078684af46057d7b`); missing overview/rail/mux lists and post-release candidate wording were the gaps, not a failed previous push. Current README corrects those while preserving operator-provided native runtime and Herdr pi/Claude-only boundaries.
- **npm:** inherited from GLG's direct2026-10-07 report: publish executed by GLG. Measured once at10:30KST: `npm view @junghanacs/entwurf@0.31.0` returned404. That is not evidence of a failed publication; registry propagation and full registry-installed proof remain unmeasured. Agent npm publish count0. Do not repack/re-publish or change dist-tags without a new request.
- **Protect:** runtime/TUI/models/auth/SQLite/recovery remain native-owned. No manager, queue, watcher, retry/restart or credential proxy. Native internal tasks/subagents mint no garden citizens. Preserve records/transcripts/live SQLite/Emacs/foreign hosts and old g2 fixtures. Only this Original checkout is product authority; fixtures are evidence.

# RECENT / DURABLE RECEIPTS

- **Final release:** [v0.31.0](https://github.com/junghan0611/entwurf/releases/tag/v0.31.0), published2026-10-07T01:19:04Z. Prepared/tag/remote main `a2c1aad0d89a33880d7b2f1ac43102d47a1ff207`; exact push [CI37548671179](https://github.com/junghan0611/entwurf/actions/runs/37548671179) four required jobs +official872/872 KILLED. Source/index/tracked freeze MATCH; separate reviewed docs commit87de9f7, Grok final Blocker0/Defect0.
- **Exact artifact:** canonical accepted `/tmp/entwurf-release-candidate-0.31.0.iniwdy/junghanacs-entwurf-0.31.0.tgz`, SHA256 `7a03bbe091a0ad9d2167fd6f1eb1fe2e7ff15402331c9f7f5d4042f429cf5c9f`; sibling `acceptance.log` proves mandatory Docker, caller-preserved exact artifact/no repack, consumer exit0. Archive copy is byte-identical; it is not a second pack or a separate canonical-path certification.
- **Durable archive:** `/home/junghan/archives/entwurf/20261007T102356-v0.31.0/` — `make-accepted.json`, `NEXT.md`, tarball, Docker log, full CI/qualification output, P4/P5/RED/focused receipts and Grok review. Image id `sha256:55ab623bfcd9ee77067924cf18e428841b64653b9521f086393266056e34c201`, repoDigest `node@sha256:6dac556d980b7f0e5498d08f08cee0ca67798b4ad6c23964a9214920e67758d0`.
- **P5:** final MUST25/0/0 +BEHAVIOR1/0/0/BODY872/872, frozen MATCH. First run RED23/2/0 remains RED; stale owned OMP writer and exact Codex relay newline were repaired/rechecked without product/oracle relaxation. Focused OMP11/Codex65/P6 seat×cwd39 PASS is separate from final aggregate GREEN. Native admission's original wrong-row15 receipt remains retired; corrected real Pi row19 +root doorbell LIVE36 is the accepted evidence.
- **P9:** post-prepared-CI census unused200/eligible7/344K; reparented1 is protected Emacs3364025. Lists read, deletion0/signal0. Main push stamp08:49, release stamp10:19, Google Chat rc0, final DM432 delivered once. Do not duplicate these stamps/notifications.
- **Bounds:** Pi1.0.2/sourcecd32f77+overlay, operator-provided runtime. agy1.2 remains NOT CERTIFIED; unchanged1.1 pin, explicit0.31 cut exception only. No live Claude↔pi-durable, macOS native rails, busy/nonroot/backlog/crash/global exactly-once or registry readiness is inferred from the native Linux/source/runtime receipts.

# READ / DO NOT REPEAT

- `AGENTS.md`, `VERIFY.md`, `docs/durable-native-support.md`, `docs/setup-clean-host.md`, then #130 body **and comments**; thread supersedes stale body. #130 is currently decision/research, not a silently approved implementation plan. Memory work belongs to agent-config/andenken.
- Preserve partial/full, S/H/V, SDK/import-only/native, pre-version/prepared-SHA/artifact/registry evidence boundaries. No entire 0.31.0 floor replay for this post-release documentation-only cleanup; future changed contracts own their affected gates and0.32 release acceptance.
- Normal hooks/shared `_scan.sh`; no unsafe override, no-verify, force, hook change, tag move or replacement0.31 candidate. GLG chooses commit/push and0.32 execution gates.
