# pi-durable owned surface — 0.36.0 execution contract (#141)

Author: gpt-6.1-sol (pi-durable/session20261008T113104-801621, 2026-10-13) — coordinator contract requested by GLG, not GLG direct.

## Decisions and roles

- [#141](https://github.com/junghan0611/entwurf/issues/141) is priority00; target0.36.0. Entwurf maintains its thin application/TUI composition using Pi TUI. Upstream SDK owns execution, scheduler, queues, storage/transcript, compaction, cancellation/recovery, providers and auth. Ownership is decided, not a Rule17 veto to revisit.
- Coordinator owns contract, issue/NEXT, review synthesis and handoffs. Existing Opus20261011T202615-521a11 is the single implementation writer. No new sibling, clone/worktree, provider/model experiment or competing CI lane.
- GLG requested a planning-coordinate commit, then implementation. That commit is not source/runtime qualification or push authority. Later commits/push/cut/publish retain their actual authorization gates.

## Operator workflow — settled by GLG

Develop/install the new version in this same checkout. At the1.2.0 install-ready checkpoint, tell GLG the precise restart point. GLG stops and restarts the existing sessions; then observe whether peers are visible and messages/dialog work before continuing release acceptance.

No automatic session relocation, separate installed0.35.1 runtime lane, agent-performed process stop/restart or new migration supervisor. The checkout also serving live sessions is an observation, **not a prerequisite blocker**. The coordinator's earlier runtime-protection hold is withdrawn. Installation success is not restart/delivery success, and a planning commit is not either.

Preserve original native stores, records/transcripts and DB/WAL. Do not open/drain/recover/reapply/copy original stores as development probes. Task transition/snapshot semantics are proved on isolated fixtures; no automatic production-store migration program. S1 includes coordination of the operator-loaded agent-config native tool result contract and ordinary Pi host floor. Report a concrete incompatibility, not a generic request to invent a protection policy.

## Reviewed evidence (not production implementation acceptance)

The coordinator read the full Opus design and R0 artifacts, matched their hashes, and inspected decisive receipts/drivers:

| Evidence | Result and limit |
| --- | --- |
| Upstream1.1.0 git objects + existing patch → Node strip + relocation | R0: all6 shipped carrier JS bytes/hashes and LICENSE reproduced; `allEqual:true` |
| Proposed strict source fence, installed1.1.0 declarations | R0:30 relative import uses →24 declared `dist/*.d.ts` targets, missing/extra0; removing rootDirs fails resolution |
| Type checking | R0 remains RED1: TS7016 proper-lockfile types missing; no fake declarations. Full typecheck PASS and1.2 compatibility are not established |
| Lint / formatter | R0 lint6files clean; upstream-width formatting leaves one existing patched TUI footer hunk |

Design artifact SHA256: `e71f76c0d781ebdd099707baa21b201583a33f7e258ba6605761fcc6877a0395`.
R0 artifact SHA256: `c8ab5320079c60ab9b00eb5d90bf5bdaf225123e00c385d9bf6b80025b3fc01f`.
Receipts are local under `.tmp-verify/141-kickoff/r0/`; decisive results are carried above and in the [public R0 review](https://github.com/junghan0611/entwurf/issues/141#issuecomment-6137406363). Some superseded initial CJS traces were removed by the probe author; corrected ESM diagnostics and original failure diagnostics remain. Preserve future failed receipts.

## Rail and bounded bundles

### S0 — own source, keep SDK1.1.0 and carrier bytes unchanged

1. Add canonical `pi/pi-durable/src/experimental/durable/{runtime,tui,harness-setup,prompt,sessions,subagent}.ts` and `src/LICENSE`, folding the existing patch into source. Historical origin is upstream1.1.0 `abe508e1b89912adde45528136c3221eb69acdd7`; read git objects without changing the upstream checkout.
2. Add a dedicated strict no-emit fence with NodeNext/ES2024, allowImportingTsExtensions, erasableSyntaxOnly, verbatimModuleSyntax and rootDirs to installed coding-agent/dist. **Explicit child `exclude:[]`** prevents inheritance of root's receiving-source exclusion. Root excludes source only in the same change that adds its fourth named typecheck fence. Verify6root files and real24declaration resolutions; no stubs/any/noCheck or24re-export fallback.
3. Acquire exact dev dependency `@types/proper-lockfile@4.1.4` with the provided pnpm; update lock normally. SDK set and host floor stay1.1.0.
4. Keep current pin path; v3 separates frozen origin/blob/license/retired-overlay/baselineCarrier from owned source/generated carrier and coherent sdk. Preserve installed reader shapes. Retire runtime-contacts.patch, its emitter application code, package entries and obsolete PATCH-SECTIONS claim/mutant together.
5. Make in-repo source emission a non-SKIP floor proof; missing source refuses. Preserve exact declared files/targets, strip/relocation and byte comparison. Historical provenance reads are optional, never rebuild authority.
6. Separate always-non-SKIP byte proof from exact emitter Node identity. CIcheck uses exact pinned Node strictly, other3jobs float24; coherence binds values. Local identity mismatch cannot be called full rebuild PASS. Preserve runtime floor.
7. Upstream-width source formatting; **temporary formatter-only exception for tui.ts**, with lint/typechecking on all6files. S0 never changes generated hashes for formatting. S1 removes this exception during its explicit byte-change review.
8. Keep tarball JS-only with source-forbidden tripwire; retain generated LICENSE. Update Rule17/supply/docs narrowly to affirm canonical composition without copying the engine. Resolver/bootstrap/relocation/install-reader behavior stays unchanged.

New proof subjects: EMIT-SOURCE-EQUAL (source drift), EMIT-NODE-EXACT (identity predicate), SOURCE-FENCE-RESOLVES (actual declarations/fence roots), SOURCE-NOT-SHIPPED (pack). Each claim gets an independent oracle, stable QK and discriminating exact-once mutant. Retain genuinely surviving claims; removal repairs source and proof together.

Affected focused commands:

```sh
pnpm lint
pnpm typecheck
node scripts/emit-pi-durable-carrier.ts --check
./run.sh check-pi-durable-beside
./run.sh check-dep-versions
./run.sh check-node-floor-coherence
./run.sh check-pack
git diff --exit-code 653becbe89657f38eaf3e47815b1db141bf04414 -- pi/pi-durable/carrier/
```

Return exact changed subjects/hashes, focused receipts and QK/oracle/mutant/exact-argv group table to coordinator **before PARTIAL**. Independent review → one amendment → affected PARTIAL once (pi-durable-beside, pack, any genuinely changed coherence group; receipts outside repo). No FULL/whole BODY in the development loop. S0 is not frozen acceptance or permission to start S1 automatically.

### S1 — coherent1.2.0 and actual contacts

One published SDK set, lock/minimum-release-age rules/pin/ordinary-Pi host floor together. Prove actual private imports and installed consumers, not tarball presence alone. Minimal subjects:

- Native bridge/subagent `output` reaches model-visible committed entries; reverse `output→content` mutant kills it. Ordinary Pi extension `content` remains its own contract.
- Fatal Session yields visible terminal UI/submit refusal and receiver retirement; retained compactionFailure is displayed.
- Preserve identity, sibling delivery, #140 inbox withdrawal, input/steer/follow-up, Esc/tool display/reopen behavior.
- Coordinate operator-loaded native-module `output` compatibility and1.2.x ordinary-Pi host alongside the declared restart checkpoint. No external repo edits hidden inside the S0 assignment.

Exclude nested-tool UX, codemode, tool_search, images, pi-env/cloud, new notice kinds, ACP driver bump and a second engine.

### Transition, restart and acceptance

- Generate old live-task fixture while the sandbox set is still1.1.0. Faux provider, no vendor turn. Actually run the1.2 scheduler and verify **persisted** migrated task records; `inspect()` only reports pending `ready/migrates` and does not migrate (`scheduler.ts:1255–1280`).
- Downgrade refusal `task_too_old` concerns actual migrated live v2 tasks, not every first open. If old-version proof is a one-time receipt, disclose that limit.
- Isolated snapshot proof checks latest committed WAL content and writer quiescence. Lock absence or `integrity_check` alone does not certify content completeness. Do not perform a production backup operation under this plan.
- Installed-consumer proofs, review/amendment, affected PARTIAL and frozen FULL/exact-SHA CI remain required under VERIFY. Coordinate their order with the operator restart; do not infer universal LIVE acceptance from a visibility/dialog check.
- Native Codex LIVE needs a fresh operator app-server/triple; absence is named SKIP→cut BLOCKED, not an inherited0.35.1 exception. Ask only at that actual checkpoint.
- GLG's manual restart is followed by measured mutual visibility and delivery/dialog; then continue separately authorized release state-machine steps. No publish/repack/push by implication.

## Stop conditions

Unexpected S0 byte drift; typing requires semantic changes; lost lint/type authority; undeclared installed-reader changes; unrelated implementation; two architecture blockers; proof cost exceeding capability; original store/process operations needed. Report the concrete leaf, not the retired generic runtime-protection objection.
