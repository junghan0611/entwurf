# NEXT — #148 Pi 1.4.0 validation checkpoint · not a release

The SDK compatibility implementation is committed. Version 0.41.1 is an unpublished validation candidate, not a completed release preparation. GLG authorized remote validation and an official whole-BODY CI run. Main promotion is deferred because its Herdr ref can affect existing installations; use an explicit validation branch first. Do not infer publication or operational cutover from the CI authorization.

# RAIL — 현재 좌표

- [x] **1. Operating/development split and implementation.** Operating 0.41.0/SDK 1.3 stays separate. Implementation `3ed079b` aligns the nine SDK members with 1.4.0 and changes only the owned shell/proof/supply surfaces.
- [x] **2. Independent review and offline evidence.** Source/proof review closed without blockers. Earlier-candidate affected PARTIAL 41/41; implementation-era FULL 885s and versioned working-candidate FULL 890s. Each receipt belongs to its own work surface, not automatically this committed SHA.
- [ ] **3. Validation-branch CI + whole BODY.** ← CURRENT: push this checkpoint on `feat/148-pi-1.4.0`, then record exact-SHA push CI's four required jobs and official `workflow_dispatch qualify=true` BODY. Keep main's existing npm-backed Herdr lock unchanged. No nearby-SHA green substitution; stop on failure and preserve evidence.
- [ ] **4. Consistent installed candidate + native LIVE.** ← PAUSED: call GLG before global installation; GLG controls normal shutdown/reopening of the coordinator and existing siblings. Never mix Pi 1.4 with the old registered 0.41.0 extension and call it candidate LIVE.
- [ ] **5. Main promotion / final preparation / artifact / release / operating acceptance.** ← PAUSED: operator decision on Herdr ref exposure, required LIVE, exact final-SHA evidence and explicit mode approvals. If the final SHA changes, renew its CI/BODY evidence. No tag or npm publication; no operating DB migration yet.

# NOW

- **Stem:** close #148 as a thin Pi 1.4 reference shell, not a second engine, supervisor or retry manager.
- **Next:** observe this checkpoint's exact-SHA CI/BODY. Use the four-job push run for the normal CI axis and the manual `qualify=true` run for BODY; they are separate receipts. A BODY failure is a finding, never an automatic rerun or reason to weaken a claim.
- **Thread:** [#148 evidence and boundaries](https://github.com/junghan0611/entwurf/issues/148#issuecomment-6339048361). The thread supersedes stale initial planning. #149 remains design-only and outside this work.
- **Do not expand:** no new retry UI, receiver policy, storage implementation, auth copying, alternative harness wrapper or broad scratch sweeper. GLG asked to separate procedure, measurement and genuinely necessary implementation.

# CLOSED BOUNDARIES / KNOWN LIMITS

- SDK storage conformance uses SDK 1.3 public-API-generated synthetic SQL fixtures and an independent SQLite oracle. It is not raw WAL recovery or a local mutation proof over the upstream engine. Fixture code/data are excluded from the package, with a packlist oracle and real tarball tripwire.
- Sandbox observations separately cover schema1→2, rollback refusal, pre-upgrade backup restoration (later work absent), replay/restart accounting, actual shell open/close, old-version-born fixture identity carried forward, and in-process failure releasing the lock. They do not prove an operating citizen's actual migration or real model-generation continuity.
- A parked non-generation Hold did not block new input. Existing conversation abort cancelled its non-background task, not its background task. Real parked-generation recovery remains unmeasured; do not advise blind resend after an unknown outcome.
- The old and new session lock code is identical: a stalled but live old owner can lose its stale lock. This is an operating cutover precondition, not a new lock-policy implementation lane.
- Aggregate LIVE is blocked at preflight: fresh Pi smokes load user-scope package registration, still the installed 0.41.0 extension. Candidate PATH alone changes the binary but not that extension. Checkout-explicit smoke subsets are not a `release-gate --cut` pass. The temporary test app-server was normally stopped without retiring any citizen.

# OPERATING CUTOVER — separate GO

Before the first new-SDK open: announce the transition, normally close the old owner, prove that owner has exited (a stale lock is insufficient), preserve the complete target session file set consistently, then select the intended session with the resume picker. Do not guess with operating `--continue`.

SDK 1.4 opens migrate that session to schema2, refused by SDK1.3/Entwurf0.41. Reinstalling a package is not data rollback. A pre-upgrade backup excludes subsequent work. Even a future-schema refusal can change the header/sidecars, so back up before probing with the new SDK.

Global installation must be explicitly announced to GLG first. Do not autonomously close/restart existing siblings, open/copy/migrate operating session DBs, update the notebook, or publish. Validate the actual installed artifact and contact/delivery after the approved transition; same ID alone is not semantic continuity or tool authority.

# GUARDRAILS / RETURN

- All pnpm and commit/push hooks run with `pnpm_config_verify_deps_before_run=error`. Dependency verification refusal stops the path; no policy-off, state hand-edit, unsafe hook bypass, blind retry or store prune.
- SDK14 consumers and operator SDK13 processes must not accidentally share mutable checkout execution. No global wiring change until the explicit transition checkpoint.
- Preserve records, transcripts, DBs, backups, candidates, invalid/unknown outcomes and current evidence. Earlier release fixture cleanup was separately authorized and archived; it does not authorize current scratch cleanup or a generic `/tmp` sweep.
- No `.env.local` read/source. Keep the operator's preserved `.agent-reports/.envrc`; do not recreate the removed root `.envrc`.
- Final release remains governed by `entwurf-release` / VERIFY: installed/native/model evidence, four exact-SHA CI jobs, and the carrier-bearing accepted candidate are independent. A later prepared SHA needs its own evidence; an interim BODY never becomes final acceptance by narration.
- Local private receipts and detailed operator/branch handoffs remain under ignored evidence storage. Promote decisive observations into cross-host/public handoffs rather than relying on host-local paths.
