# NEXT — repair/v2-core-debt

> Branch-only boot sector. Main stays usable while this lane repairs #49 §C and settles #50's v2 historical debt. Delete this file before merging after durable outcomes move to code/docs/issues.

## NOW — establish the 0.12.8 repair floor before touching the protocol

- **Stem:** make v2 survive beyond `pi-shell-acp`: every garden citizen is a sibling; socket/mailbox/native-push are transport facts; identity, call provenance, and liveness are separate axes.
- **Next:** (1) bump the single pi pin `0.80.6 → 0.80.7` using #49 §B's derived-pin/document gates → (2) `pnpm install` → (3) run `pnpm check` and record any upstream delta before changing §C.
- **Then:** write the rail/record/call truth table as a #50 comment and lock the subtractive protocol below before implementation.
- **Blocker:** none. This branch exists specifically so RED/protocol surgery cannot break main.
- **Read first:** #49 final §C thread and subtractive comments; #50 body + GLG's 03:00 comment; `AGENTS.md` North Star/Hard Rules; `ROADMAP.md` current rails and deferred fresh mint.
- **Do not touch:** main; fresh sibling mint/#47 mux; Cortex/#48; 0.12.9 ACP dependency work; same-gid digest/inode defense; a new DB/planner/worker tree.

## LOCKED DIRECTION — prove or revise before code

1. **No species hierarchy.** Garden id is identity. `control` is not a citizen type; `entwurf` is not an owned-child type. All are siblings and may call one another recursively.
2. **Rail ≠ identity.** pi native and pi-hosted ACP use the model-agnostic live socket rail; Claude Code uses mailbox/self-fetch; Antigravity uses native-push. Liveness is probed, never stored.
3. **Call ≠ parentage.** v2 dispatch/resume of an existing citizen does not create lineage. If provenance is authored, it records a call edge (`caller → callee`, time/intent/evidence), not permanent ownership.
4. **§C stays identity-only.** Birth uses upstream `--session-id`; strict resume hands the parent's exact absolute JSONL to upstream `--session`. Do not pull lineage/meta-record redesign into §C.
5. **Subtraction first.** The abandoned main-working-tree carrier design is gone. Do not reintroduce env marker capture/scrub, `globalThis` carrier, reload/new/fork state, or an expected-id registry unless existing authored filename/header/name facts are disproved.
6. **History is evidence.** `__entwurf`-resident rejection came from v1 one-shot semantics; v2 resident siblings invalidate it. Preserve the history in issue/docs, not as dead runtime code.

## EXECUTION ORDER

### A. Runtime floor — pi 0.80.7

- Change the one package pin and every gated declaration required by #49 §B; do not create a second literal authority.
- Verify runtime floor/ceiling, package install smoke, curated ACP model anchors, and full `pnpm check`.
- Commit separately so upstream-runtime movement is not mixed with protocol surgery.

### B. Protocol inventory — #50 before implementation

Produce one compact truth table covering each shipped/probed harness:

- durable citizen identity facts and where authored;
- call/reply sender facts and where evidenced;
- current liveness probe and transport;
- which fields/tags are production read, production write-only, test-only capacity, or dead;
- exact `pi-shell-acp`/v1 residue proposed for deletion.

Audit at least: `parentGardenId`, `isEntwurf`, `backend:"pi"`, `__control`, `__entwurf`, `--entwurf-control`, resume marker, sender envelope, delivery receipts, socket-only pi facts. Post the evidence to #50; do not invent a common record until the table proves what is missing.

### C. #49 §C — subtractive strict resume

Target shape (revise only with a concrete counterexample):

- v2-only builder emits exact `--session <absolute canonical JSONL>` once and upstream `--session-id` zero times;
- parent resolves by garden id, validates the existing `requireEntwurf` authored identity, and rejects a noncanonical v2 resume basename;
- child uses `ctx.sessionManager.getSessionFile()`; existing name/header mirror check runs before `startControlServer`;
- delete the v1 rule that `__entwurf` cannot be a live resident and delete its env-marker module/producer/gates;
- keep operator-name write-time protection only if the protocol table still justifies it;
- `spawn-bg child-exited` is always an error because socket-alive was not observed; state observation, not physical impossibility;
- same-gid content replacement remains explicitly out of scope.

Verification must expose the real holes, not argv cosmetics:

- wrong child session resolver still opens/appends only the parent's authoritative JSONL;
- missing/corrupt/empty/different-id negative cases use pinned pi, full HOME/XDG/agent-dir sandbox, hard timeout, stderr anchors, no expected/wrong socket, no user/assistant nonce;
- rendered v2 outcome is `isError:true` on child exit;
- canonical filename/header/name mismatch fails before socket/model/token (while honestly allowing pi's pre-session metadata write);
- RED is observed before production repair and never committed.

### D. #50 — v2 debt settlement

Only after C's identity path is small and green:

- decide whether pi needs a durable citizen record or whether socket-only remains the honest identity surface;
- separate identity record from optional append-only call evidence; never store liveness or mutable `lastCaller` as truth;
- remove or demote fields/tags that have no production meaning (`parentGardenId`, `isEntwurf`, `__control`) using hard-cut + gate coupling;
- make every harness explainable in one common citizen/call vocabulary while preserving its native rail;
- remove dead helpers, tests that are their only caller, and historical `pi-shell-acp`/v1 claims from live instruction surfaces;
- add Hard Rules only for concepts that production and gates actually enforce.

If call provenance needs new authored data, stop and show why existing sender envelope/delivery evidence cannot carry it. No new DB.

### E. Close the branch

- Run `pnpm check`, `check-pack`, `check-pack-install`, and the relevant sandbox/live gates from scratch cwd.
- Update #49/#50 with evidence and remaining honest limits.
- Promote durable protocol to `AGENTS.md`/README/docs; closed release history waits for the explicit release/tag workflow.
- Delete `NEXT--repair_v2-core-debt.md` before merge; GLG decides merge, release, and final push timing.

## BASELINE

- Branch cut from `main` at `aa93218` (`origin/main`), with yesterday's uncommitted carrier/C0 experiment discarded.
- Main is untouched and remains the daily usable lane.
- #49: 0.12.8 runtime/session contract repair.
- #50: positive historical debt settlement — the step that lets entwurf exceed its `pi-shell-acp` origin.
