# NEXT — feat/78-macos-consumer-ci (disposable; delete before merge)

- **What landed:** one non-voting `macos-install-surface` job in `.github/workflows/ci.yml`
  (#78 macOS row = #86's "smallest proposed macOS measurement"), plus the two VERIFY.md lines
  that used to say "all three CI jobs".
- **Composition chosen (b), not (a).** `check-pack-install` CANNOT stand on Darwin: it RUNS three
  installers that refuse non-Linux by design — `scripts/meta-bridge-install.sh:70`
  (run.sh:3948/4463/4527), `scripts/copilot-bridge-install.sh:69` (run.sh:4050),
  `scripts/omp-bridge-install.sh:48` (run.sh:4094) — and uses `sha256sum` / `sort -z` /
  `xargs -0r`. Those refusals are calibrated facts; they were not touched.
- **Not verified here. The oracle is Linux.** Verified locally: YAML parses, 4 unique job names,
  `bash -n` on all five inline blocks, cell-8a `- run: ./run.sh check-gate-qualification` still
  exactly 1, existing three jobs byte-unchanged. Green-on-macOS is unknown until GLG pushes.
- **Expected failure points, in order (each is a real first-run candidate):**
  1. `validate_entwurf_bridge`'s 3000ms first-frame timeout (run.sh:4751) on a cold macOS node start.
  2. `pnpm install --frozen-lockfile` if any darwin optional dep is missing from the lockfile
     (53 darwin entries measured present, so this is the *second* worry, not the first).
  3. `npm install <tgz>` bin symlink / exec-bit on `run.sh`, `start.sh`, `test.sh` under Darwin tar.
  4. `python3` absent or <3 on the runner image (`setup` refuses by name at run.sh:4890).
  5. `entwurf setup` reaching an unpinned harness the runner ships (mitigated: five `*_BIN` pins).
- **Next move after the first run:** read the job log, fix ONE named step, do not widen scope.
  Promotion to a release axis = GLG decision + add the job to
  `.claude/skills/entwurf-release/scripts/verify-exact-ci.sh:67` `required` + rewrite VERIFY.md:290.
- **Do not:** touch the three Linux jobs · make the Darwin `die`s portable · open native Windows ·
  relabel WSL · comment on #78 (coordinator's) · touch #95.
