# NEXT--issue-66-meta-create-exclusive — meta-record CREATE fail-closed (#66)

# RAIL — 현재 좌표

- [x] Implement #66 CREATE/ATTACH write split + oracles + mutants
- [x] Focused gates green, checkpoint to coordinator
- [x] Independent review amendment bundles (D1–D9) closed
- [ ] Coordinator acceptance → qualification once + full floor once on the frozen candidate ← CURRENT: review amendment complete; coordinator acceptance/floor gate pending
- [ ] Commit (GLG gates commit/push)

# NOW

Review amendment is complete; await coordinator acceptance, then run
`check-gate-qualification` once and `pnpm check` once on the frozen
candidate. Nothing edits the worktree while the floor runs.

- Scope: `upsertMetaSession` CREATE/ATTACH write split in
  `pi-extensions/lib/meta-session.ts`, stale prose in
  `pi-extensions/lib/session-id.js`, oracles in
  `scripts/check-meta-session.ts`, mutants in
  `scripts/mutants/meta-identity.json` (+ `EXPECTED_LANE_MUTANTS`).
- Out of scope: #67, mux LIVE smokes, #63+, release, push, delegation.

## Acceptance (issue #66)

- CREATE publishes atomically WITHOUT replacement (same-dir temp +
  `linkSync`); occupied final path fails loud with a named cause, occupied
  entry bytes unmodified, no temp residue on the refusal path. No
  check-then-rename TOCTOU, no retry, no suffix growth, grammar unchanged.
- ATTACH keeps atomic in-place replace (temp + rename) of its own record.
- EEXIST → named `MetaRecordError` (gid/path, occupied entry unmodified, no
  ACTIVE record published); other I/O errors keep the original errno/cause.
  Post-publish temp cleanup failure never rolls final back and states the
  transport-neutral consequence loud (ENOENT = goal state, silent).
- Stale collision-precheck prose corrected (`session-id.js` header + suffix
  comment).
- Deterministic oracles + exact-once QK mutants (lane count 4) prove the
  primitive, the error contracts, and the CREATE wiring.

## Gates for this lane

```bash
./run.sh check-meta-session
./run.sh check-meta-manifest-schema
pnpm typecheck && pnpm lint
```

Qualification + full floor run once later per the scheduling contract — not
in this inner loop. Never run `smoke-mux-lifecycle-live` /
`smoke-mux-fresh-call-live`.
